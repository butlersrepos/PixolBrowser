#!/usr/bin/env node
// Build a searchable index of the MiniFantasy asset library.
//
//   node index-minifantasy.js [assetsRoot] [outDir]
//
// Defaults: assetsRoot = ~/dev/pixel-art/MiniFantasy, outDir = ./out
//
// Zero dependencies. Reads image dimensions straight from file headers (same
// byte-parsing PixolBrowser's main.js uses). Emits:
//   out/minifantasy-index.jsonl        one line per image, for grepping
//   out/MiniFantasy.pixol-browser.json PixolBrowser config (rules + excludes)
//   out/minifantasy-catalog.md         pack + tag summary
//
// It also drops a copy of the .pixol-browser.json into the assets root so the
// app auto-detects it as a sidecar when you open that folder.

const fs = require('fs');
const path = require('path');
const os = require('os');
const tax = require('./taxonomy');

const HOME = os.homedir();
const ASSETS_ROOT = process.argv[2] || path.join(HOME, 'dev/pixel-art/MiniFantasy');
const OUT_DIR = process.argv[3] || path.join(__dirname, 'out');
const IMG_RE = /\.(png|gif)$/i;

// ---- dimension parsing (PNG + GIF), from raw header bytes -------------------
function readDims(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const h = Buffer.alloc(32);
    fs.readSync(fd, h, 0, 32, 0);
    if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) {
      return { w: h.readUInt32BE(16), h: h.readUInt32BE(20) };
    }
    if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) { // GIF
      return { w: h.readUInt16LE(6), h: h.readUInt16LE(8) };
    }
  } catch { /* skip */ } finally { if (fd !== undefined) fs.closeSync(fd); }
  return null;
}

// Cheap "is this a multi-frame strip/grid?" hint from the aspect ratio.
function stripHint(w, h) {
  if (!w || !h) return false;
  const [a, b] = w >= h ? [w, h] : [h, w];
  return b > 0 && a % b === 0 && a / b >= 2;
}

function walk(dir, onFile) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, onFile);
    else if (e.isFile() && IMG_RE.test(e.name)) onFile(full);
  }
}

function main() {
  if (!fs.existsSync(ASSETS_ROOT)) {
    console.error(`Assets root not found: ${ASSETS_ROOT}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const records = [];
  let scanned = 0;
  walk(ASSETS_ROOT, (full) => {
    const rel = path.relative(ASSETS_ROOT, full).split(path.sep).join('/');
    const ext = path.extname(full).slice(1).toLowerCase();
    const { pack, kind, tags, excluded } = tax.classify(rel);
    const d = readDims(full);
    const rec = {
      path: rel,
      pack,
      kind,
      ext,
      w: d ? d.w : null,
      h: d ? d.h : null,
      tags,
    };
    if (d && stripHint(d.w, d.h)) rec.strip = true;
    if (excluded) rec.excluded = true;
    records.push(rec);
    if (++scanned % 2000 === 0) process.stderr.write(`  scanned ${scanned}...\n`);
  });

  records.sort((a, b) => a.path.localeCompare(b.path));

  // ---- 1) JSONL index ------------------------------------------------------
  const jsonlPath = path.join(OUT_DIR, 'minifantasy-index.jsonl');
  fs.writeFileSync(jsonlPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  // ---- 2) PixolBrowser config (autoTagRules + excludePatterns) -------------
  // One rule per taxonomy entry, easy to read/edit in Settings > Rules & Tags.
  // The app's substring-glob engine can't do CamelCase word boundaries, so these
  // rules approximate the precise word matching per facet (see tokenAppGlobs);
  // the JSONL index is the exact artifact.
  const config = {
    autoTagRules: tax.appAutoTagRules(),
    excludePatterns: tax.appExcludePatterns(),
    excludedFiles: [],
    tags: {},
  };
  const configName = 'MiniFantasy.pixol-browser.json';
  const configOut = path.join(OUT_DIR, configName);
  fs.writeFileSync(configOut, JSON.stringify(config, null, 2));
  // Sidecar copy next to the assets so the app offers to import it on open.
  try {
    fs.writeFileSync(path.join(ASSETS_ROOT, configName), JSON.stringify(config, null, 2));
  } catch (e) { console.error('Could not write sidecar:', e.message); }

  // ---- 3) Catalog markdown -------------------------------------------------
  const byKind = tally(records, (r) => r.kind);
  const byTag = tally(records.flatMap((r) => r.tags), (t) => t);
  const packs = {};
  for (const r of records) {
    (packs[r.pack] ||= { n: 0, kinds: {}, tags: {} });
    const p = packs[r.pack];
    p.n++;
    p.kinds[r.kind] = (p.kinds[r.kind] || 0) + 1;
    for (const t of r.tags) p.tags[t] = (p.tags[t] || 0) + 1;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const md = renderCatalog({ records, byKind, byTag, packs, stamp, jsonlPath });
  const mdPath = path.join(OUT_DIR, 'minifantasy-catalog.md');
  fs.writeFileSync(mdPath, md);

  console.log(`\nIndexed ${records.length} images across ${Object.keys(packs).length} packs.`);
  console.log(`  ${jsonlPath}`);
  console.log(`  ${configOut}  (+ sidecar in ${ASSETS_ROOT})`);
  console.log(`  ${mdPath}`);
}

function tally(arr, key) {
  const m = {};
  for (const x of arr) { const k = key(x); m[k] = (m[k] || 0) + 1; }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function topTags(tagMap, n) {
  return Object.entries(tagMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t, c]) => `${t}(${c})`)
    .join(', ');
}

function renderCatalog({ records, byKind, byTag, packs, stamp, jsonlPath }) {
  const rel = jsonlPath.replace(HOME, '~');
  const sortedPacks = Object.entries(packs).sort((a, b) => b[1].n - a[1].n);
  const TOP = 70;
  const packRows = sortedPacks.slice(0, TOP).map(([name, p]) => {
    const kinds = Object.entries(p.kinds).sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `${k}(${c})`).join(' ');
    return `| ${name} | ${p.n} | ${kinds} | ${topTags(p.tags, 6)} |`;
  });
  if (sortedPacks.length > TOP) {
    const rest = sortedPacks.slice(TOP);
    const restImgs = rest.reduce((s, [, p]) => s + p.n, 0);
    packRows.push(`| _+${rest.length} smaller packs_ | ${restImgs} | _(grep the JSONL by pack)_ | |`);
  }

  return `# MiniFantasy Asset Catalog

_Generated ${stamp} · ${records.length} images across ${Object.keys(packs).length} packs._

This is the fast lookup surface for the MiniFantasy pixel-art library. Use it to
pick the right **pack** and **tags** before drilling in. The full per-image index
(one JSON object per line: \`path, pack, kind, ext, w, h, tags, strip?\`) lives at:

    ${rel}

**To search it** (examples):
\`\`\`sh
# every poison spell effect that's an animated strip
grep '"poison"' ${rel} | grep '"strip":true' | grep spell-effect
# all druid character sheets, ignoring drop-shadow layers
grep '"druid"' ${rel} | grep -v '"excluded":true'
# tilesets in the dungeon environment
grep '"kind":"tileset"' ${rel} | grep -i dungeon
\`\`\`

**Regenerate** after adding packs:
\`\`\`sh
node ~/dev/pixel-art/pixel-browser/tools/indexer/index-minifantasy.js
\`\`\`

**Richer descriptive tags** (mossy / ornate / torch-lit …) are an optional
one-time Claude vision pass over one representative image per subject — see
\`tools/indexer/vision-pass.js\`. Not run by default; the tags below are 100%
deterministic (derived from folder + filename, no AI).

## Kinds
${byKind.map(([k, c]) => `- **${k}** — ${c}`).join('\n')}

## Top tags
${byTag.slice(0, 40).map(([t, c]) => `\`${t}\`(${c})`).join(' · ')}

## Packs
| Pack | images | kinds | top tags |
|------|-------:|-------|----------|
${packRows.join('\n')}
`;
}

main();
