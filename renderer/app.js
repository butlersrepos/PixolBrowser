// ===== State =====
const state = {
  baseDirectory: null,
  recursive: true,
  allImages: [],       // All PNG paths found
  filteredImages: [],  // After filters/exclusions
  metadata: null,      // Persisted metadata
  currentFilter: 'all',
  searchQuery: '',
  selectedImages: new Set(),
  lastClickedIndex: -1,  // for shift+click range select
  allTags: new Map(),    // tag -> count
  zoomLevel: 1,
  dimensions: {},      // path -> { width, height }
  dimFilter: null,     // null = no filter, or { min, max } on max(w,h)
};

let grid = null;
let saveTimeout = null;
let searchDebounce = null;

// ===== Config Accessors =====
// All rule/tag access goes through the active config
function activeConfig() {
  const name = state.metadata?.activeConfig || 'Default';
  if (!state.metadata.configs) state.metadata.configs = {};
  if (!state.metadata.configs[name]) {
    state.metadata.configs[name] = { autoTagRules: [], excludePatterns: [], excludedFiles: [], tags: {} };
  }
  return state.metadata.configs[name];
}

function migrateMetadata(m) {
  // Migrate flat metadata to configs model
  if (m.configs) return m;
  const config = {
    autoTagRules: m.autoTagRules || [],
    excludePatterns: m.excludePatterns || [],
    excludedFiles: m.excludedFiles || [],
    tags: m.tags || {},
  };
  m.configs = { 'Default': config };
  m.activeConfig = 'Default';
  // Remove old top-level keys
  delete m.autoTagRules;
  delete m.excludePatterns;
  delete m.excludedFiles;
  delete m.tags;
  return m;
}
let cachedVisibleImages = null; // images after excludes, before tag/search filters
let lowercaseIndex = null; // Map<imagePath, lowercasedPath> for fast search

// ===== Tag Colors =====
function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 55%, 55%)`;
}

function tagBg(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsla(${hue}, 55%, 55%, 0.15)`;
}

// ===== Virtual Grid =====
class VirtualGrid {
  constructor(container, options = {}) {
    this.container = container;
    this.cellWidth = options.cellWidth || 140;
    this.cellHeight = options.cellHeight || 160;
    this.gap = options.gap || 8;
    this.padding = options.padding || 8;
    this.bufferRows = options.bufferRows || 4;
    this.items = [];
    this.onCellRender = options.onCellRender || (() => {});
    this.onCellClick = options.onCellClick || (() => {});
    this.onCellDblClick = options.onCellDblClick || (() => {});

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'virtual-grid-scroll';
    this.spacer = document.createElement('div');
    this.spacer.className = 'virtual-grid-spacer';
    this.scrollEl.appendChild(this.spacer);
    this.container.appendChild(this.scrollEl);

    this.renderedCells = new Map();
    this.prevStartRow = -1;
    this.prevEndRow = -1;
    this.prevCols = 0;
    this._rafPending = false;

    this.scrollEl.addEventListener('scroll', () => this._scheduleUpdate());
    this._ro = new ResizeObserver(() => {
      this.prevCols = 0; // Force re-render on resize
      this._scheduleUpdate();
    });
    this._ro.observe(this.scrollEl);
  }

  _scheduleUpdate() {
    if (!this._rafPending) {
      this._rafPending = true;
      requestAnimationFrame(() => {
        this._rafPending = false;
        this.update();
      });
    }
  }

  setItems(items) {
    this.items = items;
    this.scrollEl.scrollTop = 0;
    // Clear all rendered cells
    for (const el of this.renderedCells.values()) el.remove();
    this.renderedCells.clear();
    this.prevStartRow = -1;
    this.prevEndRow = -1;
    this.update();
  }

  refreshCell(index) {
    const el = this.renderedCells.get(index);
    if (el) {
      const newEl = el.cloneNode(false);
      newEl.className = 'grid-cell';
      newEl.style.cssText = el.style.cssText;
      this.onCellRender(newEl, this.items[index], index);
      newEl.addEventListener('click', (e) => this.onCellClick(this.items[index], index, e));
      newEl.addEventListener('dblclick', (e) => this.onCellDblClick(this.items[index], index, e));
      el.replaceWith(newEl);
      this.renderedCells.set(index, newEl);
    }
  }

  update() {
    const width = this.scrollEl.clientWidth - this.padding * 2;
    const height = this.scrollEl.clientHeight;
    const scrollTop = this.scrollEl.scrollTop;

    const cols = Math.max(1, Math.floor((width + this.gap) / (this.cellWidth + this.gap)));
    const rows = Math.ceil(this.items.length / cols);
    const rowHeight = this.cellHeight + this.gap;
    const totalHeight = rows * rowHeight + this.padding * 2;

    this.spacer.style.height = totalHeight + 'px';

    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - this.bufferRows);
    const endRow = Math.min(rows, Math.ceil((scrollTop + height) / rowHeight) + this.bufferRows);

    if (startRow === this.prevStartRow && endRow === this.prevEndRow && cols === this.prevCols) {
      return;
    }

    // Determine visible indices
    const visible = new Set();
    for (let r = startRow; r < endRow; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx < this.items.length) visible.add(idx);
      }
    }

    // Remove cells no longer visible
    for (const [idx, el] of this.renderedCells) {
      if (!visible.has(idx)) {
        el.remove();
        this.renderedCells.delete(idx);
      }
    }

    // Add new cells
    const leftOffset = this.padding;
    const topOffset = this.padding;
    for (let r = startRow; r < endRow; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= this.items.length) break;
        if (this.renderedCells.has(idx)) {
          // Reposition if columns changed
          if (cols !== this.prevCols) {
            const el = this.renderedCells.get(idx);
            el.style.left = (leftOffset + c * (this.cellWidth + this.gap)) + 'px';
            el.style.top = (topOffset + r * rowHeight) + 'px';
          }
          continue;
        }

        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.style.position = 'absolute';
        cell.style.left = (leftOffset + c * (this.cellWidth + this.gap)) + 'px';
        cell.style.top = (topOffset + r * rowHeight) + 'px';
        cell.style.width = this.cellWidth + 'px';
        cell.style.height = this.cellHeight + 'px';

        this.onCellRender(cell, this.items[idx], idx);
        cell.addEventListener('click', (e) => this.onCellClick(this.items[idx], idx, e));
        cell.addEventListener('dblclick', (e) => this.onCellDblClick(this.items[idx], idx, e));

        this.spacer.appendChild(cell);
        this.renderedCells.set(idx, cell);
      }
    }

    this.prevStartRow = startRow;
    this.prevEndRow = endRow;
    this.prevCols = cols;
  }

  scrollToTop() {
    this.scrollEl.scrollTop = 0;
  }

  destroy() {
    this._ro.disconnect();
  }
}

// ===== Filtering =====
function invalidateVisibleCache() {
  cachedVisibleImages = null;
}

function getVisibleImages() {
  if (cachedVisibleImages) return cachedVisibleImages;
  const excludeSet = new Set(activeConfig().excludedFiles || []);
  const excludePatterns = activeConfig().excludePatterns || [];
  const hasExcludes = excludePatterns.length > 0;

  cachedVisibleImages = state.allImages.filter(img => {
    if (excludeSet.has(img)) return false;
    if (hasExcludes) {
      const rel = relativePath(img);
      for (const pat of excludePatterns) {
        if (globMatch(rel, pat) || globMatch(img, pat)) return false;
      }
    }
    return true;
  });
  return cachedVisibleImages;
}

function applyFilters() {
  let images = getVisibleImages();

  // Tag filter
  if (state.currentFilter === 'untagged') {
    images = images.filter(img => !getTagsForImage(img).length);
  } else if (state.currentFilter !== 'all') {
    images = images.filter(img => getTagsForImage(img).includes(state.currentFilter));
  }

  // Search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    images = images.filter(img => (lowercaseIndex?.get(img) || img.toLowerCase()).includes(q));
  }

  // Dimension filter
  if (state.dimFilter) {
    const { min, max } = state.dimFilter;
    images = images.filter(img => {
      const d = state.dimensions[img];
      if (!d) return false;
      const maxDim = Math.max(d.width, d.height);
      return maxDim >= min && maxDim <= max;
    });
  }

  state.filteredImages = images;
}

function relativePath(img) {
  if (state.baseDirectory && img.startsWith(state.baseDirectory)) {
    return img.slice(state.baseDirectory.length + 1);
  }
  return img;
}

function getTagsForImage(img) {
  const manual = activeConfig().tags[img] || [];
  const auto = [];
  const rel = relativePath(img);
  for (const rule of activeConfig().autoTagRules || []) {
    if (globMatch(rel, rule.pattern) || globMatch(img, rule.pattern)) {
      for (const t of rule.tags) {
        if (!manual.includes(t) && !auto.includes(t)) auto.push(t);
      }
    }
  }
  return [...manual, ...auto];
}

function getAllTags() {
  const counts = new Map();
  const visible = getVisibleImages();

  // Count manual tags
  for (const [path, tags] of Object.entries(activeConfig().tags || {})) {
    if (!visible.includes(path)) continue;
    for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1);
  }

  // Count auto-tag rule matches (iterate rules, not images)
  for (const rule of activeConfig().autoTagRules || []) {
    if (!rule.pattern || !rule.tags.length) continue;
    const re = globCompile(rule.pattern);
    if (!re) continue;
    let ruleCount = 0;
    for (const img of visible) {
      const rel = relativePath(img);
      if (re.test(rel) || re.test(img)) ruleCount++;
    }
    for (const t of rule.tags) {
      counts.set(t, (counts.get(t) || 0) + ruleCount);
    }
  }

  return counts;
}

// Simple glob matching (supports *, **, ?) with compiled regex cache
const globCache = new Map();

function globCompile(pattern) {
  let re = globCache.get(pattern);
  if (re) return re;
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*')
    .replace(/\?/g, '[^/]');
  try {
    re = new RegExp('^' + regex + '$', 'i');
  } catch {
    re = null;
  }
  globCache.set(pattern, re);
  return re;
}

function globMatch(str, pattern) {
  const re = globCompile(pattern);
  return re ? re.test(str) : false;
}

// ===== UI Updates =====
function updateGrid() {
  applyFilters();
  if (grid) {
    grid.setItems(state.filteredImages);
  }
  updateSidebar();
  updateStatus();
}

function updateSidebar() {
  state.allTags = getAllTags();

  // Update counts
  const excludeSet = new Set(activeConfig().excludedFiles || []);
  const visibleImages = state.allImages.filter(img => !excludeSet.has(img));
  document.getElementById('count-all').textContent = visibleImages.length;

  const untaggedCount = visibleImages.filter(img => !getTagsForImage(img).length).length;
  document.getElementById('count-untagged').textContent = untaggedCount;

  // Build custom tag list
  const container = document.getElementById('tag-list-custom');
  container.innerHTML = '';

  const sorted = [...state.allTags.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [tag, count] of sorted) {
    const item = document.createElement('div');
    item.className = 'tag-item' + (state.currentFilter === tag ? ' active' : '');
    item.dataset.filter = tag;
    item.innerHTML = `
      <span class="tag-color-dot" style="background: ${tagColor(tag)}"></span>
      <span class="tag-name">${escHtml(tag)}</span>
      <span class="tag-count">${count}</span>
    `;
    item.addEventListener('click', () => {
      state.currentFilter = tag;
      activateFilter();
      updateGrid();
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTagContextMenu(e, tag, count);
    });
    container.appendChild(item);
  }
}

function showTagContextMenu(e, tag, count) {
  // Remove any existing context menu
  const old = document.getElementById('tag-context-menu');
  if (old) old.remove();

  const menu = document.createElement('div');
  menu.id = 'tag-context-menu';
  menu.className = 'context-menu';
  menu.innerHTML = `<div class="context-menu-item danger">Remove "${escHtml(tag)}" from all (${count})</div>`;
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);

  menu.querySelector('.context-menu-item').addEventListener('click', () => {
    menu.remove();
    if (confirm(`Remove tag "${tag}" from all ${count} image${count === 1 ? '' : 's'}?\n\nThis cannot be undone.`)) {
      for (const path of Object.keys(activeConfig().tags)) {
        const tags = activeConfig().tags[path];
        const idx = tags.indexOf(tag);
        if (idx >= 0) {
          tags.splice(idx, 1);
          if (tags.length === 0) delete activeConfig().tags[path];
        }
      }
      // Also remove from auto-tag rules
      for (const rule of activeConfig().autoTagRules) {
        rule.tags = rule.tags.filter(t => t !== tag);
      }
      activeConfig().autoTagRules = activeConfig().autoTagRules.filter(r => r.tags.length > 0);
      scheduleSave();
      if (state.currentFilter === tag) state.currentFilter = 'all';
      updateGrid();
      updateDetailTags();
    }
  });

  // Close on click elsewhere
  const close = (ev) => {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

function activateFilter() {
  document.querySelectorAll('.tag-item').forEach(el => {
    el.classList.toggle('active', el.dataset.filter === state.currentFilter);
  });
}

function updateStatus() {
  const el = document.getElementById('grid-status');
  if (!state.baseDirectory) {
    el.textContent = '';
    return;
  }
  const filtered = state.filteredImages.length;
  const total = state.allImages.length;
  el.textContent = filtered === total
    ? `${total.toLocaleString()} images`
    : `${filtered.toLocaleString()} of ${total.toLocaleString()} images`;
}

// ===== Selection =====
function handleCellClick(imagePath, index, event) {
  const isMeta = event.metaKey || event.ctrlKey;
  const isShift = event.shiftKey;

  if (isShift && state.lastClickedIndex >= 0) {
    // Range select: select everything between lastClickedIndex and index
    const from = Math.min(state.lastClickedIndex, index);
    const to = Math.max(state.lastClickedIndex, index);
    if (!isMeta) state.selectedImages.clear();
    for (let i = from; i <= to; i++) {
      state.selectedImages.add(state.filteredImages[i]);
    }
  } else if (isMeta) {
    // Toggle this image in the selection
    if (state.selectedImages.has(imagePath)) {
      state.selectedImages.delete(imagePath);
    } else {
      state.selectedImages.add(imagePath);
    }
    state.lastClickedIndex = index;
  } else {
    // Normal click: toggle if already the only selection, otherwise select only this
    if (state.selectedImages.size === 1 && state.selectedImages.has(imagePath)) {
      state.selectedImages.clear();
      state.lastClickedIndex = -1;
    } else {
      state.selectedImages.clear();
      state.selectedImages.add(imagePath);
      state.lastClickedIndex = index;
    }
  }

  syncSelectionClasses();
  updateDetailPanel();
}

function syncSelectionClasses() {
  // Just toggle CSS classes — don't replace DOM elements
  if (!grid) return;
  for (const [idx, el] of grid.renderedCells) {
    const imagePath = grid.items[idx];
    el.classList.toggle('selected', state.selectedImages.has(imagePath));
  }
}

// ===== Detail Panel =====
function updateDetailPanel() {
  const content = document.getElementById('detail-content');
  const empty = document.getElementById('detail-empty');
  const inspectBtn = document.getElementById('btn-inspect');
  const inspectBadge = document.getElementById('inspect-badge');
  const inspectHint = document.getElementById('inspect-hint');
  const count = state.selectedImages.size;

  inspectBtn.disabled = count === 0;
  inspectBadge.textContent = count > 0 ? count : '';
  inspectBadge.style.display = count > 0 ? '' : 'none';
  inspectHint.style.visibility = count === 0 ? 'visible' : 'hidden';

  if (count === 0) {
    content.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  content.classList.remove('hidden');
  empty.classList.add('hidden');

  const imageWrapper = document.getElementById('detail-image-wrapper');
  const img = document.getElementById('detail-image');
  const filenameEl = document.getElementById('detail-filename');
  const pathEl = document.getElementById('detail-path');
  const metaEl = document.getElementById('detail-meta');
  const excludeBtn = document.getElementById('btn-exclude');
  const copyBtn = document.getElementById('btn-copy-name');

  if (count === 1) {
    // Single selection: show full detail with preview
    const imagePath = [...state.selectedImages][0];
    imageWrapper.style.display = '';
    copyBtn.style.display = '';
    img.src = toFileUrl(imagePath);

    filenameEl.textContent = basename(imagePath);
    pathEl.textContent = relativePath(imagePath);
    excludeBtn.textContent = 'Exclude This Image';

    metaEl.textContent = '';
    window.api.getImageInfo(imagePath).then(info => {
      if (info) {
        const sizeKb = (info.size / 1024).toFixed(1);
        const dimText = img.naturalWidth ? `${img.naturalWidth} x ${img.naturalHeight} px | ` : '';
        metaEl.textContent = `${dimText}${sizeKb} KB`;
      }
    });

    img.addEventListener('load', function onLoad() {
      img.removeEventListener('load', onLoad);
      const existing = metaEl.textContent;
      if (existing && !existing.includes(' x ')) {
        metaEl.textContent = `${img.naturalWidth} x ${img.naturalHeight} px | ${existing}`;
      } else if (!existing) {
        metaEl.textContent = `${img.naturalWidth} x ${img.naturalHeight} px`;
      }
    });
  } else {
    // Multi selection: hide preview, show count
    imageWrapper.style.display = 'none';
    copyBtn.style.display = 'none';
    filenameEl.textContent = `${count} images selected`;
    pathEl.textContent = 'Tags applied will affect all selected images';
    metaEl.textContent = '';
    excludeBtn.textContent = `Exclude ${count} Images`;
  }

  updateDetailTags();
}

function hideDetail() {
  state.selectedImages.clear();
  state.lastClickedIndex = -1;
  document.getElementById('detail-content').classList.add('hidden');
  document.getElementById('detail-empty').classList.remove('hidden');
  syncSelectionClasses();
}

function updateDetailTags() {
  const selected = [...state.selectedImages];
  if (selected.length === 0) return;
  const container = document.getElementById('detail-tags');
  container.innerHTML = '';

  if (selected.length === 1) {
    // Single image: show all tags, allow removal of manual ones
    const imagePath = selected[0];
    const tags = getTagsForImage(imagePath);
    const manualTags = activeConfig().tags[imagePath] || [];

    for (const tag of tags) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.style.background = tagBg(tag);
      chip.style.color = tagColor(tag);
      const isManual = manualTags.includes(tag);
      chip.innerHTML = `${escHtml(tag)}${isManual ? '<span class="remove-tag">&times;</span>' : ''}`;
      if (isManual) {
        chip.querySelector('.remove-tag').addEventListener('click', (e) => {
          e.stopPropagation();
          removeTagFromImages([imagePath], tag);
        });
      }
      container.appendChild(chip);
    }
  } else {
    // Multi image: show tags common to ALL selected, plus tags on SOME
    const tagCounts = new Map(); // tag -> how many selected images have it
    for (const img of selected) {
      for (const tag of getTagsForImage(img)) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [tag, count] of sorted) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.style.background = tagBg(tag);
      chip.style.color = tagColor(tag);
      const label = count === selected.length ? tag : `${tag} (${count}/${selected.length})`;
      chip.innerHTML = `${escHtml(label)}<span class="remove-tag">&times;</span>`;
      chip.querySelector('.remove-tag').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Remove tag "${tag}" from ${selected.length} image${selected.length === 1 ? '' : 's'}?`)) {
          removeTagFromImages(selected, tag);
        }
      });
      container.appendChild(chip);
    }
  }
}

function addTagToImages(imagePaths, tag) {
  tag = tag.trim().toLowerCase();
  if (!tag) return;
  for (const p of imagePaths) {
    if (!activeConfig().tags[p]) activeConfig().tags[p] = [];
    if (!activeConfig().tags[p].includes(tag)) {
      activeConfig().tags[p].push(tag);
    }
  }
  scheduleSave();
  updateDetailTags();
  updateSidebar();
  for (const p of imagePaths) refreshImageInGrid(p);
}

function removeTagFromImages(imagePaths, tag) {
  for (const p of imagePaths) {
    if (!activeConfig().tags[p]) continue;
    activeConfig().tags[p] = activeConfig().tags[p].filter(t => t !== tag);
    if (activeConfig().tags[p].length === 0) delete activeConfig().tags[p];
  }
  scheduleSave();
  updateDetailTags();
  updateSidebar();
  for (const p of imagePaths) refreshImageInGrid(p);
}

function refreshImageInGrid(imagePath) {
  const idx = state.filteredImages.indexOf(imagePath);
  if (idx >= 0 && grid) {
    grid.refreshCell(idx);
  }
}

// ===== Tag Autocomplete =====
function setupTagAutocomplete() {
  const input = document.getElementById('detail-tag-input');
  const dropdown = document.getElementById('tag-autocomplete');
  let selectedIdx = -1;

  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    if (!val) { dropdown.classList.add('hidden'); return; }

    const allTagNames = [...state.allTags.keys()];
    const matches = allTagNames.filter(t => t.includes(val) && t !== val).slice(0, 8);

    if (matches.length === 0) { dropdown.classList.add('hidden'); return; }

    dropdown.innerHTML = '';
    selectedIdx = -1;
    for (const m of matches) {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = m;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        addTagToImages([...state.selectedImages], m);
        input.value = '';
        dropdown.classList.add('hidden');
      });
      dropdown.appendChild(item);
    }
    dropdown.classList.remove('hidden');
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('selected', i === selectedIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      items.forEach((it, i) => it.classList.toggle('selected', i === selectedIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targets = [...state.selectedImages];
      if (selectedIdx >= 0 && items[selectedIdx]) {
        addTagToImages(targets, items[selectedIdx].textContent);
      } else {
        addTagToImages(targets, input.value);
      }
      input.value = '';
      dropdown.classList.add('hidden');
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.add('hidden'), 150);
  });
}

// ===== Rules Modal =====
function showRulesModal() {
  const modal = document.getElementById('rules-modal');
  modal.classList.remove('hidden');
  renderRulesModal();
}

function hideRulesModal() {
  document.getElementById('rules-modal').classList.add('hidden');
}

function getMatchingFiles(pattern) {
  if (!pattern) return [];
  return state.allImages.filter(img => {
    const rel = relativePath(img);
    return globMatch(rel, pattern) || globMatch(img, pattern);
  });
}

function buildMatchPreview(container, inputEl) {
  const preview = document.createElement('div');
  preview.className = 'rule-match-preview';
  preview.innerHTML = '<span class="match-count"></span>';
  container.appendChild(preview);

  const countEl = preview.querySelector('.match-count');
  let showBtn = null;
  let fileListEl = null;
  let fileListOpen = false;
  let debounceTimer = null;

  function getCurrentMatches() {
    const pattern = inputEl.value.trim();
    return pattern ? getMatchingFiles(pattern) : [];
  }

  function renderFileList(matches) {
    if (!fileListEl) {
      fileListEl = document.createElement('div');
      fileListEl.className = 'rule-file-list';
      preview.appendChild(fileListEl);
    }
    const display = matches.slice(0, 200);
    fileListEl.innerHTML = display.map(f => {
      const rel = relativePath(f);
      return `<div class="rule-file-item" title="${escAttr(rel)}">${escHtml(rel)}</div>`;
    }).join('')
      + (matches.length > 200 ? `<div class="rule-file-item muted">...and ${(matches.length - 200).toLocaleString()} more</div>` : '');
  }

  function update() {
    const pattern = inputEl.value.trim();
    const matches = getCurrentMatches();

    if (!pattern) {
      countEl.textContent = '';
      if (showBtn) { showBtn.remove(); showBtn = null; }
      if (fileListEl) { fileListEl.remove(); fileListEl = null; }
      fileListOpen = false;
      return;
    }

    countEl.textContent = `Matches ${matches.length.toLocaleString()} file${matches.length === 1 ? '' : 's'}`;

    if (matches.length > 0 && !showBtn) {
      showBtn = document.createElement('button');
      showBtn.className = 'btn-show-files';
      showBtn.textContent = 'Show files';
      showBtn.addEventListener('click', () => {
        fileListOpen = !fileListOpen;
        if (fileListOpen) {
          renderFileList(getCurrentMatches());
          showBtn.textContent = 'Hide files';
        } else {
          if (fileListEl) { fileListEl.remove(); fileListEl = null; }
          showBtn.textContent = 'Show files';
        }
      });
      preview.appendChild(showBtn);
    } else if (matches.length === 0 && showBtn) {
      showBtn.remove(); showBtn = null;
      if (fileListEl) { fileListEl.remove(); fileListEl = null; }
      fileListOpen = false;
    }

    // Refresh open file list with current matches
    if (fileListOpen) {
      renderFileList(matches);
    }
  }

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(update, 300);
  });

  update();
}

function renderRulesModal() {
  // Auto-tag rules
  const rulesList = document.getElementById('rules-list');
  rulesList.innerHTML = '';
  for (let i = 0; i < activeConfig().autoTagRules.length; i++) {
    const rule = activeConfig().autoTagRules[i];
    const block = document.createElement('div');
    block.className = 'rule-block';
    block.innerHTML = `
      <div class="rule-row">
        <span class="rule-label">Glob:</span>
        <input type="text" class="rule-pattern" value="${escAttr(rule.pattern)}" placeholder="**/Tileset/**" />
        <span class="rule-label">Tags:</span>
        <input type="text" class="rule-tags" value="${escAttr(rule.tags.join(', '))}" placeholder="tileset, terrain" />
        <button class="rule-delete" data-idx="${i}">&times;</button>
      </div>
    `;
    rulesList.appendChild(block);
    buildMatchPreview(block, block.querySelector('.rule-pattern'));
  }

  rulesList.querySelectorAll('.rule-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      collectRulesFromModal();
      const idx = parseInt(btn.dataset.idx);
      activeConfig().autoTagRules.splice(idx, 1);
      renderRulesModal();
    });
  });

  // Exclude patterns
  const excludeList = document.getElementById('exclude-list');
  excludeList.innerHTML = '';
  for (let i = 0; i < (activeConfig().excludePatterns || []).length; i++) {
    const pat = activeConfig().excludePatterns[i];
    const block = document.createElement('div');
    block.className = 'rule-block';
    block.innerHTML = `
      <div class="rule-row">
        <span class="rule-label">Glob:</span>
        <input type="text" class="exclude-pattern" value="${escAttr(pat)}" placeholder="**/_GIF/**" />
        <button class="rule-delete" data-eidx="${i}">&times;</button>
      </div>
    `;
    excludeList.appendChild(block);
    buildMatchPreview(block, block.querySelector('.exclude-pattern'));
  }

  excludeList.querySelectorAll('.rule-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      collectRulesFromModal();
      const idx = parseInt(btn.dataset.eidx);
      activeConfig().excludePatterns.splice(idx, 1);
      renderRulesModal();
    });
  });
}

function collectRulesFromModal() {
  // Collect auto-tag rules
  const ruleRows = document.querySelectorAll('#rules-list .rule-row');
  activeConfig().autoTagRules = [];
  ruleRows.forEach(row => {
    const pattern = row.querySelector('.rule-pattern').value.trim();
    const tagsStr = row.querySelector('.rule-tags').value.trim();
    if (pattern && tagsStr) {
      const tags = tagsStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      if (tags.length) {
        activeConfig().autoTagRules.push({ pattern, tags });
      }
    }
  });

  // Collect exclude patterns
  const excludeRows = document.querySelectorAll('#exclude-list .rule-row');
  activeConfig().excludePatterns = [];
  excludeRows.forEach(row => {
    const pattern = row.querySelector('.exclude-pattern').value.trim();
    if (pattern) {
      activeConfig().excludePatterns.push(pattern);
    }
  });
}

// ===== Persistence =====
function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    window.api.saveMetadata(state.metadata);
  }, 500);
}

// ===== Helpers =====
function escHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escAttr(s) {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function basename(p) {
  return p.split('/').pop();
}

function shortLabel(p) {
  const parts = p.split('/');
  // Show up to 2 parent segments for context (e.g. "Paladin/Shadows/attack.png")
  const depth = Math.min(parts.length - 1, 2);
  return parts.slice(parts.length - 1 - depth).join('/');
}

async function readAllDimensions(files, onProgress) {
  // Use IPC for Electron (reads file headers), Image objects for web
  if (window.api.getAllDimensions) {
    return window.api.getAllDimensions(files, onProgress);
  }
  // Web fallback: batch Image loading
  const dims = {};
  const BATCH = 50;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    await Promise.all(batch.map(p => new Promise(resolve => {
      const img = new Image();
      img.onload = () => { dims[p] = { width: img.naturalWidth, height: img.naturalHeight }; resolve(); };
      img.onerror = resolve;
      img.src = toFileUrl(p);
    })));
    if (onProgress && (i + BATCH) % 500 < BATCH) onProgress(Math.min(i + BATCH, files.length));
  }
  return dims;
}

function toFileUrl(absolutePath) {
  // Web mode: use blob URLs created during scan
  if (window._blobUrls && window._blobUrls.has(absolutePath)) {
    return window._blobUrls.get(absolutePath);
  }
  return 'file://' + absolutePath.split('/').map(encodeURIComponent).join('/');
}

// ===== Carousel =====
const carousel = {
  items: [],
  currentIndex: 0,
  active: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  baseW: 0,
  baseH: 0,
  isPanning: false,
  didDrag: false,
  panStartX: 0,
  panStartY: 0,
  panStartPanX: 0,
  panStartPanY: 0,
  viewStates: new Map(), // index -> { zoom, panX, panY }
};

function openCarousel(items, startIndex) {
  carousel.items = items;
  carousel.currentIndex = startIndex || 0;
  carousel.active = true;
  carousel.viewStates.clear();
  document.getElementById('carousel').classList.remove('hidden');
  const bg = getCarouselBg();
  document.getElementById('carousel-image-wrapper').style.background = bg;
  document.getElementById('carousel-bg-input').value = bg;
  const multi = items.length > 1;
  document.getElementById('carousel-prev').style.display = multi ? '' : 'none';
  document.getElementById('carousel-next').style.display = multi ? '' : 'none';
  document.getElementById('carousel-counter').style.display = multi ? '' : 'none';
  loadCarouselImage();
}

function closeCarousel() {
  carousel.active = false;
  carousel.viewStates.clear();
  document.getElementById('carousel').classList.add('hidden');
}

function saveCarouselView() {
  carousel.viewStates.set(carousel.currentIndex, {
    zoom: carousel.zoom,
    panX: carousel.panX,
    panY: carousel.panY,
  });
}

function loadCarouselImage() {
  const img = document.getElementById('carousel-image');
  img.src = toFileUrl(carousel.items[carousel.currentIndex]);
  document.getElementById('carousel-filename').textContent = basename(carousel.items[carousel.currentIndex]);
  document.getElementById('carousel-counter').textContent = `${carousel.currentIndex + 1} / ${carousel.items.length}`;
  // Reset zoom on image change — computeBase + resetView called from img load handler
}

function carouselNav(delta) {
  if (carousel.items.length <= 1) return;
  saveCarouselView();
  carousel.currentIndex = (carousel.currentIndex + delta + carousel.items.length) % carousel.items.length;
  loadCarouselImage();
}

function setupCarousel() {
  const overlay = document.getElementById('carousel');
  const wrapper = document.getElementById('carousel-image-wrapper');
  const img = document.getElementById('carousel-image');
  const resetBtn = document.getElementById('carousel-reset');

  function computeBase() {
    const wW = wrapper.clientWidth;
    const wH = wrapper.clientHeight;
    const nW = img.naturalWidth || 1;
    const nH = img.naturalHeight || 1;
    const fitScale = Math.min(wW / nW, wH / nH);
    carousel.baseW = nW * fitScale;
    carousel.baseH = nH * fitScale;
    img.style.width = carousel.baseW + 'px';
    img.style.height = carousel.baseH + 'px';
  }

  function centerImage() {
    carousel.panX = (wrapper.clientWidth - carousel.baseW * carousel.zoom) / 2;
    carousel.panY = (wrapper.clientHeight - carousel.baseH * carousel.zoom) / 2;
  }

  function resetView() {
    carousel.zoom = 1;
    centerImage();
    applyTransform();
  }

  function applyTransform() {
    img.style.transform = `translate(${carousel.panX}px, ${carousel.panY}px) scale(${carousel.zoom})`;
    const isZoomed = carousel.zoom > 1;
    wrapper.classList.toggle('zoomed-in', isZoomed && !carousel.isPanning);
    wrapper.classList.toggle('panning', carousel.isPanning);
  }

  img.addEventListener('load', () => {
    computeBase();
    const saved = carousel.viewStates.get(carousel.currentIndex);
    if (saved) {
      carousel.zoom = saved.zoom;
      carousel.panX = saved.panX;
      carousel.panY = saved.panY;
      applyTransform();
    } else {
      resetView();
    }
  });

  // Click to zoom
  wrapper.addEventListener('click', (e) => {
    if (carousel.didDrag) { carousel.didDrag = false; return; }
    if (!carousel.baseW) return;

    const rect = wrapper.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const wcx = rect.width / 2;
    const wcy = rect.height / 2;

    if (carousel.zoom <= 1) {
      const nz = 3;
      const ix = (cx - carousel.panX) / carousel.zoom;
      const iy = (cy - carousel.panY) / carousel.zoom;
      carousel.panX = wcx - ix * nz;
      carousel.panY = wcy - iy * nz;
      carousel.zoom = nz;
    } else {
      carousel.zoom = 1;
      centerImage();
    }
    applyTransform();
  });

  // Scroll wheel zoom
  wrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!carousel.baseW) return;
    const rect = wrapper.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const oldZoom = carousel.zoom;
    const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
    carousel.zoom = Math.max(1, Math.min(40, carousel.zoom * factor));
    if (carousel.zoom <= 1) {
      carousel.zoom = 1;
      centerImage();
    } else {
      const ix = (mx - carousel.panX) / oldZoom;
      const iy = (my - carousel.panY) / oldZoom;
      carousel.panX = mx - ix * carousel.zoom;
      carousel.panY = my - iy * carousel.zoom;
    }
    applyTransform();
  });

  // Drag to pan
  wrapper.addEventListener('mousedown', (e) => {
    if (carousel.zoom <= 1) return;
    if (e.button !== 0) return;
    e.preventDefault();
    carousel.isPanning = true;
    carousel.didDrag = false;
    carousel.panStartX = e.clientX;
    carousel.panStartY = e.clientY;
    carousel.panStartPanX = carousel.panX;
    carousel.panStartPanY = carousel.panY;
    applyTransform();
  });

  window.addEventListener('mousemove', (e) => {
    if (!carousel.isPanning) return;
    carousel.panX = carousel.panStartPanX + (e.clientX - carousel.panStartX);
    carousel.panY = carousel.panStartPanY + (e.clientY - carousel.panStartY);
    applyTransform();
  });

  window.addEventListener('mouseup', (e) => {
    if (!carousel.isPanning) return;
    const dx = Math.abs(e.clientX - carousel.panStartX);
    const dy = Math.abs(e.clientY - carousel.panStartY);
    carousel.isPanning = false;
    carousel.didDrag = dx > 3 || dy > 3;
    applyTransform();
  });

  // Buttons
  document.getElementById('carousel-close').addEventListener('click', closeCarousel);
  document.getElementById('carousel').addEventListener('click', (e) => {
    if (e.target.id === 'carousel') closeCarousel();
  });
  document.getElementById('carousel-prev').addEventListener('click', () => carouselNav(-1));
  document.getElementById('carousel-next').addEventListener('click', () => carouselNav(1));
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    carousel.didDrag = true;
    resetView();
  });

  // Copy file to clipboard
  const copyFileBtn = document.getElementById('carousel-copy-file');
  copyFileBtn.addEventListener('click', async () => {
    const filePath = carousel.items[carousel.currentIndex];
    const ok = await window.api.copyFileToClipboard(filePath);
    const orig = copyFileBtn.innerHTML;
    copyFileBtn.textContent = ok ? 'Copied!' : 'Failed';
    setTimeout(() => { copyFileBtn.innerHTML = orig; }, 1500);
  });

  // Carousel background color picker
  const bgInput = document.getElementById('carousel-bg-input');
  bgInput.addEventListener('input', (e) => {
    wrapper.style.background = e.target.value;
    // Persist per theme
    if (state.metadata) {
      if (!state.metadata.carouselBg) state.metadata.carouselBg = {};
      state.metadata.carouselBg[getThemeKey()] = e.target.value;
      scheduleSave();
    }
  });
}

function getThemeKey() {
  // Generate a simple key from current theme colors to identify which theme is active
  return currentTheme.bg + currentTheme.accent;
}

function getCarouselBg() {
  const saved = state.metadata?.carouselBg?.[getThemeKey()];
  return saved || currentTheme.bg;
}

// ===== Cell Rendering =====
function renderCell(cell, imagePath, index) {
  const tags = getTagsForImage(imagePath);
  if (state.selectedImages.has(imagePath)) cell.classList.add('selected');

  const wrapper = document.createElement('div');
  wrapper.className = 'cell-image-wrapper';
  const img = document.createElement('img');
  img.src = toFileUrl(imagePath);
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = basename(imagePath);
  wrapper.appendChild(img);
  cell.appendChild(wrapper);

  const nameEl = document.createElement('div');
  nameEl.className = 'cell-filename';
  nameEl.textContent = shortLabel(imagePath);
  nameEl.title = relativePath(imagePath);
  cell.appendChild(nameEl);

  if (tags.length > 0) {
    const dots = document.createElement('div');
    dots.className = 'cell-tag-dots';
    for (const tag of tags.slice(0, 5)) {
      const dot = document.createElement('span');
      dot.className = 'cell-tag-dot';
      dot.style.background = tagColor(tag);
      dot.title = tag;
      dots.appendChild(dot);
    }
    cell.appendChild(dots);
  }
}

// ===== Zoom & Pan on Detail Image =====
function setupDetailZoom() {
  const wrapper = document.getElementById('detail-image-wrapper');
  const img = document.getElementById('detail-image');
  const resetBtn = document.getElementById('btn-reset-view');

  // panX/panY = position of image top-left in wrapper-space
  // zoom = scale multiplier on the base (fit-to-wrapper) size
  // baseW/baseH = image display size at zoom=1
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let baseW = 0;
  let baseH = 0;
  let isPanning = false;
  let didDrag = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;

  function computeBase() {
    const wW = wrapper.clientWidth;
    const wH = wrapper.clientHeight;
    const nW = img.naturalWidth || 1;
    const nH = img.naturalHeight || 1;
    const fitScale = Math.min(wW / nW, wH / nH);
    baseW = nW * fitScale;
    baseH = nH * fitScale;
    // Set the image element to its base display size so scale(1) = fit
    img.style.width = baseW + 'px';
    img.style.height = baseH + 'px';
  }

  function resetView() {
    zoom = 1;
    state.zoomLevel = 1;
    centerImage();
    applyTransform();
  }

  function centerImage() {
    panX = (wrapper.clientWidth - baseW * zoom) / 2;
    panY = (wrapper.clientHeight - baseH * zoom) / 2;
  }

  function applyTransform() {
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    const isZoomed = zoom > 1;
    wrapper.classList.toggle('zoomed-in', isZoomed && !isPanning);
    wrapper.classList.toggle('panning', isPanning);
  }

  // Recompute base size when image loads
  img.addEventListener('load', () => {
    computeBase();
    resetView();
  });

  // Click to zoom centered on click point (or zoom out)
  wrapper.addEventListener('click', (e) => {
    if (didDrag) { didDrag = false; return; }
    if (!baseW) return;

    const rect = wrapper.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const wcx = rect.width / 2;
    const wcy = rect.height / 2;

    if (zoom <= 1) {
      const newZoom = 3;
      // Find what image-base-coord is under the click
      const imgX = (clickX - panX) / zoom;
      const imgY = (clickY - panY) / zoom;
      // Position so that coord is at wrapper center
      panX = wcx - imgX * newZoom;
      panY = wcy - imgY * newZoom;
      zoom = newZoom;
    } else {
      zoom = 1;
      centerImage();
    }

    state.zoomLevel = zoom;
    applyTransform();
  });

  // Scroll wheel: multiplicative zoom anchored to cursor
  wrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!baseW) return;

    const rect = wrapper.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const oldZoom = zoom;
    // ~8% per tick — smooth and precise
    const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
    zoom = Math.max(1, Math.min(40, zoom * factor));

    if (zoom <= 1) {
      zoom = 1;
      centerImage();
    } else {
      // Keep the image point under the cursor stationary
      const imgX = (mx - panX) / oldZoom;
      const imgY = (my - panY) / oldZoom;
      panX = mx - imgX * zoom;
      panY = my - imgY * zoom;
    }

    state.zoomLevel = zoom;
    applyTransform();
  });

  // Drag to pan
  wrapper.addEventListener('mousedown', (e) => {
    if (zoom <= 1) return;
    if (e.button !== 0) return;
    e.preventDefault();
    isPanning = true;
    didDrag = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
    applyTransform();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = panStartPanX + (e.clientX - panStartX);
    panY = panStartPanY + (e.clientY - panStartY);
    applyTransform();
  });

  window.addEventListener('mouseup', (e) => {
    if (!isPanning) return;
    const dx = Math.abs(e.clientX - panStartX);
    const dy = Math.abs(e.clientY - panStartY);
    isPanning = false;
    didDrag = dx > 3 || dy > 3;
    applyTransform();
  });

  // Reset button
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    didDrag = true; // prevent the click from also triggering zoom
    resetView();
  });

  // Expose for showDetail
  window._resetDetailView = resetView;
  window._recomputeDetailBase = () => {
    if (img.naturalWidth) { computeBase(); resetView(); }
  };
}

// ===== Theme System =====
const defaultTheme = {
  bg: '#0d1117',
  surface: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#58a6ff',
  accentHover: '#79c0ff',
  text: '#e6edf3',
  muted: '#8b949e',
  green: '#3fb950',
  orange: '#d29922',
  red: '#f85149',
};

const themeLabels = {
  bg: 'App Background',
  surface: 'Surface',
  card: 'Card / Panel',
  border: 'Border',
  accent: 'Accent',
  accentHover: 'Accent Hover',
  text: 'Text',
  muted: 'Muted Text',
  green: 'Success',
  orange: 'Warning',
  red: 'Error',
};

const themeGroups = [
  { label: 'Backgrounds', keys: ['bg', 'surface', 'card'] },
  { label: 'Text', keys: ['text', 'muted'] },
  { label: 'Borders', keys: ['border'] },
  { label: 'Accent', keys: ['accent', 'accentHover'] },
  { label: 'Status', keys: ['green', 'orange', 'red'] },
];

const builtInThemes = {
  'Dark (Default)': { ...defaultTheme },
  'Light': {
    bg: '#f0f0f0', surface: '#ffffff', card: '#f5f5f5', border: '#d4d4d4',
    accent: '#1971c2', accentHover: '#1864ab', text: '#1a1a1a', muted: '#6b6b6b',
    green: '#2b8a3e', orange: '#e67700', red: '#c92a2a',
  },
  'Game Boy': {
    bg: '#0f380f', surface: '#306230', card: '#8bac0f', border: '#0f380f',
    accent: '#9bbc0f', accentHover: '#9bbc0f', text: '#9bbc0f', muted: '#8bac0f',
    green: '#9bbc0f', orange: '#8bac0f', red: '#306230',
  },
  'Pip-Boy': {
    bg: '#0a0a0a', surface: '#0f1a10', card: '#162416', border: '#1a3a1a',
    accent: '#14fe83', accentHover: '#17ff90', text: '#14fe83', muted: '#0eb85e',
    green: '#14fe83', orange: '#b8e600', red: '#fe4a14',
  },
  'Virtual Boy': {
    bg: '#000000', surface: '#1a0000', card: '#330000', border: '#4d0000',
    accent: '#ff0000', accentHover: '#ff3333', text: '#ff0000', muted: '#aa0000',
    green: '#ff0000', orange: '#cc0000', red: '#ff3333',
  },
  'C64': {
    bg: '#40318d', surface: '#3b2d82', card: '#4a3a9a', border: '#6c5eb5',
    accent: '#a59dff', accentHover: '#b8b2ff', text: '#a59dff', muted: '#7b72d5',
    green: '#6ec56e', orange: '#c5c56e', red: '#c56e6e',
  },
  'SNES RPG': {
    bg: '#000033', surface: '#0a0a5c', card: '#14148a', border: '#2828a8',
    accent: '#e8a030', accentHover: '#f0b848', text: '#ffffff', muted: '#9090d0',
    green: '#50e850', orange: '#e8a030', red: '#e83030',
  },
  'NES': {
    bg: '#bcbcbc', surface: '#d4d4d4', card: '#e8e8e8', border: '#9c9c9c',
    accent: '#cc0000', accentHover: '#e01010', text: '#000000', muted: '#4c4c4c',
    green: '#00a800', orange: '#f8a000', red: '#cc0000',
  },
};

const themeCssMap = {
  bg: '--bg', surface: '--surface', card: '--card', border: '--border',
  accent: '--accent', accentHover: '--accent-hover', text: '--text', muted: '--muted',
  green: '--green', orange: '--orange', red: '--red',
};

let currentTheme = { ...defaultTheme };

function applyTheme(colors) {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(themeCssMap)) {
    root.style.setProperty(cssVar, colors[key]);
  }
  currentTheme = { ...colors };
}

function saveThemeToMetadata() {
  if (state.metadata) {
    state.metadata.theme = { ...currentTheme };
    scheduleSave();
  }
}

function showSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
  // Reset to theme tab
  document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.toggle('active', i.dataset.section === 'theme'));
  document.getElementById('settings-theme').classList.remove('hidden');
  document.getElementById('settings-configs').classList.add('hidden');
  renderSettingsTheme();
}

function hideSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

function renderSettingsTheme() {
  // Presets
  const presetsEl = document.getElementById('theme-presets');
  presetsEl.innerHTML = '';
  for (const [name, colors] of Object.entries(builtInThemes)) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.innerHTML = `
      <span class="preset-swatches">
        <span class="preset-swatch" style="background:${colors.bg}"></span>
        <span class="preset-swatch" style="background:${colors.surface}"></span>
        <span class="preset-swatch" style="background:${colors.accent}"></span>
        <span class="preset-swatch" style="background:${colors.text}"></span>
      </span>
      <span class="preset-name">${escHtml(name)}</span>
    `;
    btn.addEventListener('click', () => {
      applyTheme(colors);
      saveThemeToMetadata();
      renderSettingsTheme();
    });
    presetsEl.appendChild(btn);
  }

  // Saved themes
  const savedList = document.getElementById('theme-saved-list');
  const savedThemes = state.metadata?.savedThemes || {};
  const names = Object.keys(savedThemes);
  if (names.length === 0) {
    savedList.innerHTML = '<div class="empty-hint">No saved themes yet</div>';
  } else {
    savedList.innerHTML = '';
    for (const name of names) {
      const item = document.createElement('div');
      item.className = 'saved-theme-item';
      item.innerHTML = `
        <button class="saved-theme-name">${escHtml(name)}</button>
        <button class="saved-theme-delete" title="Delete">&times;</button>
      `;
      item.querySelector('.saved-theme-name').addEventListener('click', () => {
        applyTheme(savedThemes[name]);
        saveThemeToMetadata();
        renderSettingsTheme();
      });
      item.querySelector('.saved-theme-delete').addEventListener('click', () => {
        if (confirm(`Delete saved theme "${name}"?`)) {
          delete state.metadata.savedThemes[name];
          scheduleSave();
          renderSettingsTheme();
        }
      });
      savedList.appendChild(item);
    }
  }

  // Color pickers
  const groupsEl = document.getElementById('theme-color-groups');
  groupsEl.innerHTML = '';
  for (const group of themeGroups) {
    const div = document.createElement('div');
    div.className = 'color-group';
    div.innerHTML = `<div class="color-group-label">${escHtml(group.label)}</div>`;
    for (const key of group.keys) {
      const row = document.createElement('label');
      row.className = 'color-row';
      row.innerHTML = `
        <span class="color-label">${escHtml(themeLabels[key])}</span>
        <span class="color-value">${currentTheme[key]}</span>
        <input type="color" class="color-input" value="${currentTheme[key]}" data-key="${key}" />
      `;
      row.querySelector('.color-input').addEventListener('input', (e) => {
        const k = e.target.dataset.key;
        currentTheme[k] = e.target.value;
        applyTheme(currentTheme);
        saveThemeToMetadata();
        row.querySelector('.color-value').textContent = e.target.value;
      });
      div.appendChild(row);
    }
    groupsEl.appendChild(div);
  }
}

function setupSettings() {
  document.getElementById('btn-settings').addEventListener('click', showSettingsModal);
  document.querySelector('#settings-modal .modal-backdrop').addEventListener('click', hideSettingsModal);
  document.querySelector('#settings-modal .modal-close').addEventListener('click', hideSettingsModal);

  // Save current
  document.getElementById('theme-save-btn').addEventListener('click', () => {
    const name = prompt('Enter a name for this theme:');
    if (!name?.trim()) return;
    if (!state.metadata.savedThemes) state.metadata.savedThemes = {};
    state.metadata.savedThemes[name.trim()] = { ...currentTheme };
    scheduleSave();
    renderSettingsTheme();
  });

  // Reset
  document.getElementById('theme-reset-btn').addEventListener('click', () => {
    applyTheme(defaultTheme);
    saveThemeToMetadata();
    renderSettingsTheme();
  });

  // Copy as JSON
  document.getElementById('theme-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(currentTheme, null, 2));
    const btn = document.getElementById('theme-copy-btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  // Export
  document.getElementById('theme-export-btn').addEventListener('click', () => {
    const data = JSON.stringify(state.metadata.savedThemes || {}, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pixel-browser-themes.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import
  const fileInput = document.getElementById('theme-import-file');
  document.getElementById('theme-import-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const feedback = document.getElementById('theme-import-feedback');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!state.metadata.savedThemes) state.metadata.savedThemes = {};
      let count = 0;
      for (const [name, colors] of Object.entries(parsed)) {
        if (colors && typeof colors === 'object') {
          state.metadata.savedThemes[name] = colors;
          count++;
        }
      }
      scheduleSave();
      feedback.textContent = `Imported ${count} theme${count !== 1 ? 's' : ''}`;
      feedback.classList.remove('hidden');
      renderSettingsTheme();
      setTimeout(() => feedback.classList.add('hidden'), 2000);
    } catch {
      feedback.textContent = 'Invalid JSON file';
      feedback.classList.remove('hidden');
      setTimeout(() => feedback.classList.add('hidden'), 2000);
    }
    fileInput.value = '';
  });

  // Nav items (for future categories)
  // Nav switching
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.settings-section').forEach(s => s.classList.add('hidden'));
      const section = item.dataset.section;
      document.getElementById('settings-' + section).classList.remove('hidden');
      if (section === 'configs') renderConfigsUI();
    });
  });

  // Config management
  document.getElementById('config-save-as').addEventListener('click', () => {
    const name = prompt('Name for new configuration:');
    if (!name?.trim()) return;
    const trimmed = name.trim();
    if (!state.metadata.configs) state.metadata.configs = {};
    // Clone the active config
    state.metadata.configs[trimmed] = JSON.parse(JSON.stringify(activeConfig()));
    state.metadata.activeConfig = trimmed;
    scheduleSave();
    renderConfigsUI();
    invalidateVisibleCache();
    updateGrid();
  });

  document.getElementById('config-export').addEventListener('click', () => {
    const name = state.metadata.activeConfig || 'Default';
    const data = JSON.stringify(activeConfig(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.pixol-browser.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const configFileInput = document.getElementById('config-import-file');
  document.getElementById('config-import').addEventListener('click', () => configFileInput.click());
  configFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const feedback = document.getElementById('config-feedback');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Derive name from filename: "Foo.pixol-browser.json" -> "Foo"
      let name = file.name.replace(/\.pixol-browser\.json$/, '').replace(/\.json$/, '');
      if (!name) name = 'Imported';
      if (!state.metadata.configs) state.metadata.configs = {};
      state.metadata.configs[name] = {
        autoTagRules: parsed.autoTagRules || [],
        excludePatterns: parsed.excludePatterns || [],
        excludedFiles: parsed.excludedFiles || [],
        tags: parsed.tags || {},
      };
      state.metadata.activeConfig = name;
      scheduleSave();
      invalidateVisibleCache();
      updateGrid();
      renderConfigsUI();
      feedback.textContent = `Imported "${name}"`;
      feedback.classList.remove('hidden');
      setTimeout(() => feedback.classList.add('hidden'), 2000);
    } catch {
      feedback.textContent = 'Invalid JSON file';
      feedback.classList.remove('hidden');
      setTimeout(() => feedback.classList.add('hidden'), 2000);
    }
    configFileInput.value = '';
  });
}

function renderConfigsUI() {
  const activeName = state.metadata.activeConfig || 'Default';
  document.getElementById('config-active-name').textContent = activeName;

  const list = document.getElementById('config-list');
  list.innerHTML = '';
  const configs = state.metadata.configs || {};

  for (const name of Object.keys(configs)) {
    const isActive = name === activeName;
    const config = configs[name];
    const ruleCount = (config.autoTagRules || []).length;
    const tagCount = Object.keys(config.tags || {}).length;

    const item = document.createElement('div');
    item.className = 'config-item' + (isActive ? ' active' : '');
    item.innerHTML = `
      <button class="config-item-name">${escHtml(name)}</button>
      <span class="config-item-badge">${ruleCount} rules, ${tagCount} tagged</span>
      ${name !== 'Default' ? '<button class="config-item-delete" title="Delete">&times;</button>' : ''}
    `;

    item.querySelector('.config-item-name').addEventListener('click', () => {
      if (isActive) return;
      state.metadata.activeConfig = name;
      scheduleSave();
      invalidateVisibleCache();
      updateGrid();
      renderConfigsUI();
    });

    const delBtn = item.querySelector('.config-item-delete');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (!confirm(`Delete configuration "${name}"?`)) return;
        delete state.metadata.configs[name];
        if (activeName === name) state.metadata.activeConfig = 'Default';
        scheduleSave();
        invalidateVisibleCache();
        updateGrid();
        renderConfigsUI();
      });
    }

    list.appendChild(item);
  }
}

// ===== Drag Select =====
function setupDragSelect() {
  const container = document.getElementById('grid-container');
  const rectEl = document.getElementById('select-rect');
  let dragging = false;
  let startX = 0;
  let startY = 0;
  const THRESHOLD = 5;
  let started = false;
  let preDragSelection = new Set();

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // Don't start drag if clicking on scrollbar
    const scrollEl = container.querySelector('.virtual-grid-scroll');
    if (scrollEl && e.clientX > scrollEl.getBoundingClientRect().right - 12) return;

    dragging = true;
    started = false;
    startX = e.clientX;
    startY = e.clientY;
    // Capture existing selection for Cmd+drag additive mode
    preDragSelection = (e.metaKey || e.ctrlKey) ? new Set(state.selectedImages) : new Set();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (!started && (dx > THRESHOLD || dy > THRESHOLD)) {
      started = true;
      rectEl.classList.remove('hidden');
    }
    if (!started) return;
    e.preventDefault();

    // Draw rectangle in screen coordinates
    const left = Math.min(startX, e.clientX);
    const top = Math.min(startY, e.clientY);
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);
    rectEl.style.left = left + 'px';
    rectEl.style.top = top + 'px';
    rectEl.style.width = width + 'px';
    rectEl.style.height = height + 'px';

    // Find intersecting cells
    const selRect = { left, top, right: left + width, bottom: top + height };
    state.selectedImages = new Set(preDragSelection);

    if (grid) {
      for (const [idx, cellEl] of grid.renderedCells) {
        const cr = cellEl.getBoundingClientRect();
        if (cr.right > selRect.left && cr.left < selRect.right &&
            cr.bottom > selRect.top && cr.top < selRect.bottom) {
          state.selectedImages.add(grid.items[idx]);
        }
      }
    }

    syncSelectionClasses();
    updateDetailPanel();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    if (started) {
      started = false;
      rectEl.classList.add('hidden');
      // Suppress the click that follows so it doesn't deselect
      container.addEventListener('click', suppressOnce, { capture: true, once: true });
    }
  });

  function suppressOnce(e) {
    e.stopPropagation();
  }
}

// ===== Dimension Filter =====
function setupDimFilter() {
  const presets = document.querySelectorAll('.dim-preset');
  const minInput = document.getElementById('dim-min');
  const maxInput = document.getElementById('dim-max');
  const clearBtn = document.getElementById('dim-clear');

  presets.forEach(btn => {
    btn.addEventListener('click', () => {
      presets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const min = parseInt(btn.dataset.min);
      const max = parseInt(btn.dataset.max);
      if (min === 0 && max === 999999) {
        state.dimFilter = null;
        clearBtn.classList.add('hidden');
      } else {
        state.dimFilter = { min, max };
        clearBtn.classList.remove('hidden');
      }
      minInput.value = '';
      maxInput.value = '';
      updateGrid();
    });
  });

  // Custom range: apply on Enter
  function applyCustomDim() {
    const min = parseInt(minInput.value) || 0;
    const max = parseInt(maxInput.value) || 999999;
    state.dimFilter = { min, max };
    presets.forEach(b => b.classList.remove('active'));
    clearBtn.classList.remove('hidden');
    updateGrid();
  }

  minInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomDim(); });
  maxInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomDim(); });

  clearBtn.addEventListener('click', () => {
    state.dimFilter = null;
    minInput.value = '';
    maxInput.value = '';
    presets.forEach(b => b.classList.remove('active'));
    document.querySelector('.dim-preset[data-min="0"][data-max="999999"]').classList.add('active');
    clearBtn.classList.add('hidden');
    updateGrid();
  });
}

function updateDimFilterUI() {
  // Reset filter UI when new directory loaded
  document.querySelectorAll('.dim-preset').forEach(b => b.classList.remove('active'));
  document.querySelector('.dim-preset[data-min="0"][data-max="999999"]').classList.add('active');
  document.getElementById('dim-min').value = '';
  document.getElementById('dim-max').value = '';
  document.getElementById('dim-clear').classList.add('hidden');
}

// ===== Initialization =====
async function init() {
  // Load metadata
  state.metadata = migrateMetadata(await window.api.loadMetadata());

  // Setup grid
  grid = new VirtualGrid(document.getElementById('grid-container'), {
    cellWidth: 140,
    cellHeight: 160,
    gap: 8,
    bufferRows: 4,
    onCellRender: renderCell,
    onCellClick: (imagePath, index, event) => {
      handleCellClick(imagePath, index, event);
    },
    onCellDblClick: (imagePath, index, event) => {
      // Open carousel with selected images, starting at the double-clicked one
      const items = state.selectedImages.size > 1
        ? [...state.selectedImages]
        : [imagePath];
      const startIdx = items.indexOf(imagePath);
      openCarousel(items, startIdx >= 0 ? startIdx : 0);
    },
  });

  // Click on empty gallery space to deselect
  document.getElementById('grid-container').addEventListener('click', (e) => {
    if (e.target.closest('.grid-cell')) return;
    if (state.selectedImages.size > 0) {
      state.selectedImages.clear();
      state.lastClickedIndex = -1;
      syncSelectionClasses();
      updateDetailPanel();
    }
  });

  // Show empty state
  showEmptyState();

  // Setup event handlers
  setupOpenModal();

  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('btn-search-clear');
  searchInput.addEventListener('input', (e) => {
    searchClear.classList.toggle('hidden', !e.target.value);
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.searchQuery = e.target.value;
      updateGrid();
    }, 150);
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    searchClear.classList.add('hidden');
    updateGrid();
  });

  document.getElementById('btn-rules').addEventListener('click', showRulesModal);

  // Sidebar "All" and "Untagged" clicks
  document.querySelectorAll('#tag-list > .tag-item').forEach(item => {
    item.addEventListener('click', () => {
      state.currentFilter = item.dataset.filter;
      activateFilter();
      updateGrid();
    });
  });

  // Left panel — inspect button
  document.getElementById('btn-inspect').addEventListener('click', () => {
    if (state.selectedImages.size > 0) {
      openCarousel([...state.selectedImages], 0);
    }
  });

  // Details panel
  document.getElementById('btn-copy-name').addEventListener('click', () => {
    if (state.selectedImages.size === 1) {
      const name = basename([...state.selectedImages][0]);
      navigator.clipboard.writeText(name);
      const btn = document.getElementById('btn-copy-name');
      btn.textContent = '\u2713';
      setTimeout(() => { btn.textContent = '\u2388'; }, 1200);
    }
  });

  document.getElementById('btn-exclude').addEventListener('click', () => {
    const count = state.selectedImages.size;
    if (count === 0) return;
    const msg = count === 1
      ? 'Exclude this image from the gallery?\n\nYou can undo this by editing your rules.'
      : `Exclude ${count} images from the gallery?\n\nYou can undo this by editing your rules.`;
    if (!confirm(msg)) return;
    if (!activeConfig().excludedFiles) activeConfig().excludedFiles = [];
    for (const img of state.selectedImages) {
      activeConfig().excludedFiles.push(img);
    }
    invalidateVisibleCache();
    scheduleSave();
    hideDetail();
    updateGrid();
  });

  setupTagAutocomplete();
  setupDetailZoom();
  setupCarousel();
  setupSettings();
  setupDragSelect();
  setupDimFilter();

  // Apply saved theme
  if (state.metadata.theme) {
    applyTheme({ ...defaultTheme, ...state.metadata.theme });
  }

  // Rules modal
  document.querySelector('#rules-modal .modal-backdrop').addEventListener('click', hideRulesModal);
  document.querySelector('#rules-modal .modal-close').addEventListener('click', hideRulesModal);
  document.getElementById('btn-cancel-rules').addEventListener('click', hideRulesModal);

  document.getElementById('btn-add-rule').addEventListener('click', () => {
    collectRulesFromModal();
    activeConfig().autoTagRules.push({ pattern: '', tags: [] });
    renderRulesModal();
  });

  document.getElementById('btn-add-exclude').addEventListener('click', () => {
    collectRulesFromModal();
    if (!activeConfig().excludePatterns) activeConfig().excludePatterns = [];
    activeConfig().excludePatterns.push('');
    renderRulesModal();
  });

  document.getElementById('btn-apply-rules').addEventListener('click', () => {
    collectRulesFromModal();
    invalidateVisibleCache();
    scheduleSave();
    hideRulesModal();
    updateGrid();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const inInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';

    // Carousel keys take priority when active
    if (carousel.active) {
      if (e.key === 'Escape') { closeCarousel(); e.preventDefault(); return; }
      if (e.key === 'ArrowLeft') { carouselNav(-1); e.preventDefault(); return; }
      if (e.key === 'ArrowRight') { carouselNav(1); e.preventDefault(); return; }
      return;
    }

    if (e.key === 'Escape') {
      if (!document.getElementById('settings-modal').classList.contains('hidden')) {
        hideSettingsModal();
      } else if (!document.getElementById('open-modal').classList.contains('hidden')) {
        hideOpenModal();
      } else if (!document.getElementById('rules-modal').classList.contains('hidden')) {
        hideRulesModal();
      } else if (state.selectedImages.size > 0) {
        hideDetail();
      }
    }

    // Enter: open carousel with selected images
    if (e.key === 'Enter' && !inInput && state.selectedImages.size > 0) {
      e.preventDefault();
      const items = [...state.selectedImages];
      openCarousel(items, 0);
    }

    // Cmd/Ctrl+A: select all images in gallery
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      if (inInput) return;
      e.preventDefault();
      state.selectedImages = new Set(state.filteredImages);
      if (state.filteredImages.length > 0) {
        state.lastClickedIndex = state.filteredImages.length - 1;
      }
      syncSelectionClasses();
      updateDetailPanel();
    }
  });

  // Scan progress
  window.api.onScanProgress((count) => {
    document.getElementById('scan-text').textContent = `Scanning... ${count.toLocaleString()} files found`;
  });

  // Auto-load last directory
  if (state.metadata.lastDirectory) {
    const recursive = state.metadata.lastRecursive !== false;
    await scanDirectory(state.metadata.lastDirectory, recursive);
  }
}

function showEmptyState() {
  const container = document.getElementById('grid-container');
  if (container.querySelector('.empty-state')) return;
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.innerHTML = `
    <div class="big-icon">&#128444;</div>
    <div>Click <strong>Open Folder</strong> to choose a directory</div>
  `;
  container.appendChild(empty);
}

function removeEmptyState() {
  const empty = document.querySelector('.empty-state');
  if (empty) empty.remove();
}

// ===== Open Folder Modal =====
let openModalState = { path: null, counting: false, abortId: 0 };

function showOpenModal() {
  const modal = document.getElementById('open-modal');
  modal.classList.remove('hidden');
  // Pre-fill with last directory if available
  if (state.metadata.lastDirectory) {
    openModalState.path = state.metadata.lastDirectory;
    document.getElementById('open-path-display').textContent = state.metadata.lastDirectory;
    document.getElementById('open-path-display').classList.add('has-path');
    document.getElementById('open-recursive').checked = state.metadata.lastRecursive !== false;
    document.getElementById('open-confirm-btn').disabled = false;
    runOpenCount();
  } else {
    openModalState.path = null;
    document.getElementById('open-path-display').textContent = 'No folder selected';
    document.getElementById('open-path-display').classList.remove('has-path');
    document.getElementById('open-confirm-btn').disabled = true;
    document.getElementById('open-preview').classList.add('hidden');
  }
}

function hideOpenModal() {
  document.getElementById('open-modal').classList.add('hidden');
  openModalState.abortId++; // cancel any in-flight count
}

async function runOpenCount() {
  if (!openModalState.path) return;
  const myId = ++openModalState.abortId;
  const preview = document.getElementById('open-preview');
  const icon = document.getElementById('open-preview-icon');
  const text = document.getElementById('open-preview-text');
  const recursive = document.getElementById('open-recursive').checked;

  preview.classList.remove('hidden');
  icon.classList.remove('hidden');
  text.textContent = 'Counting images...';

  const count = await window.api.countImages(openModalState.path, recursive);
  if (myId !== openModalState.abortId) return; // stale

  icon.classList.add('hidden');
  text.textContent = `${count.toLocaleString()} image${count === 1 ? '' : 's'} found`;
}

function setupOpenModal() {
  const modal = document.getElementById('open-modal');

  document.getElementById('btn-open').addEventListener('click', showOpenModal);
  modal.querySelector('.modal-backdrop').addEventListener('click', hideOpenModal);
  modal.querySelector('.modal-close').addEventListener('click', hideOpenModal);
  document.getElementById('open-cancel-btn').addEventListener('click', hideOpenModal);

  document.getElementById('open-browse-btn').addEventListener('click', async () => {
    const dirPath = await window.api.openDirectory();
    if (!dirPath) return;
    openModalState.path = dirPath;
    document.getElementById('open-path-display').textContent = dirPath;
    document.getElementById('open-path-display').classList.add('has-path');
    document.getElementById('open-confirm-btn').disabled = false;
    runOpenCount();
  });

  document.getElementById('open-recursive').addEventListener('change', () => {
    runOpenCount();
  });

  document.getElementById('open-confirm-btn').addEventListener('click', async () => {
    if (!openModalState.path) return;
    const recursive = document.getElementById('open-recursive').checked;
    hideOpenModal();
    await scanDirectory(openModalState.path, recursive);
  });
}

async function scanDirectory(dirPath, recursive) {
  // Show scan overlay
  const overlay = document.getElementById('scan-overlay');
  const scanText = document.getElementById('scan-text');
  overlay.classList.remove('hidden');
  scanText.textContent = 'Scanning...';
  removeEmptyState();

  try {
    const files = await window.api.scanDirectory(dirPath, recursive);

    state.baseDirectory = dirPath;
    state.allImages = files.sort();
    // Build lowercase index for fast search
    lowercaseIndex = new Map();
    for (const img of state.allImages) {
      lowercaseIndex.set(img, img.toLowerCase());
    }
    invalidateVisibleCache();
    state.currentFilter = 'all';
    state.searchQuery = '';
    state.dimFilter = null;
    document.getElementById('search-input').value = '';

    // Read dimensions in renderer (works in both Electron and web)
    scanText.textContent = `Reading dimensions for ${files.length.toLocaleString()} images...`;
    state.dimensions = await readAllDimensions(files, (done) => {
      scanText.textContent = `Reading dimensions... ${done.toLocaleString()} / ${files.length.toLocaleString()}`;
    });

    // Update metadata
    state.metadata.lastDirectory = dirPath;
    state.metadata.lastRecursive = recursive;
    scheduleSave();

    // Activate "All" filter
    activateFilter();
    updateGrid();
    updateDimFilterUI();

  } finally {
    overlay.classList.add('hidden');
  }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
