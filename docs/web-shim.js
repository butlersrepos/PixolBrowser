/**
 * Browser shim for Electron's window.api
 * Uses File System Access API + localStorage to replicate Electron IPC
 */

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const METADATA_KEY = 'pixel-browser-metadata';

// Global blob URL map — checked by toFileUrl() in app.js
window._blobUrls = new Map();

// Store directory handles for rescanning
let _dirHandle = null;
let _scanProgressCb = null;

async function walkDirectoryHandle(dirHandle, basePath, recursive, onFile) {
  for await (const [name, handle] of dirHandle) {
    const fullPath = basePath + '/' + name;
    if (handle.kind === 'file' && IMAGE_RE.test(name)) {
      onFile(fullPath, handle);
    } else if (handle.kind === 'directory' && recursive && !name.startsWith('.')) {
      await walkDirectoryHandle(handle, fullPath, recursive, onFile);
    }
  }
}

window.api = {
  openDirectory: async () => {
    try {
      _dirHandle = await window.showDirectoryPicker();
      return _dirHandle.name;
    } catch {
      return null;
    }
  },

  findSidecars: async (dirName) => {
    if (!_dirHandle) return [];
    const results = [];
    for await (const [name, handle] of _dirHandle) {
      if (handle.kind === 'file' && name.endsWith('.pixol-browser.json')) {
        results.push({ filename: name, name: name.replace('.pixol-browser.json', ''), handle });
      }
    }
    return results;
  },

  readSidecar: async (pathOrHandle) => {
    try {
      // In web mode, pathOrHandle is the handle stored during findSidecars
      const file = await pathOrHandle.getFile();
      return JSON.parse(await file.text());
    } catch {
      return null;
    }
  },

  scanDirectory: async (dirName, recursive) => {
    if (!_dirHandle) return [];
    const entries = [];
    window._blobUrls.clear();
    let count = 0;

    await walkDirectoryHandle(_dirHandle, dirName, recursive, (path, fileHandle) => {
      entries.push({ path, fileHandle });
      count++;
      if (_scanProgressCb && count % 200 === 0) _scanProgressCb(count);
    });

    // Create blob URLs
    for (const { path, fileHandle } of entries) {
      try {
        const file = await fileHandle.getFile();
        window._blobUrls.set(path, URL.createObjectURL(file));
      } catch { /* skip unreadable */ }
    }

    return entries.map(e => e.path);
  },

  countImages: async (dirName, recursive) => {
    if (!_dirHandle) return 0;
    let count = 0;
    await walkDirectoryHandle(_dirHandle, dirName, recursive, () => { count++; });
    return count;
  },

  getImageInfo: async (filePath) => {
    const url = window._blobUrls.get(filePath);
    if (!url) return null;
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      return { size: blob.size, modified: new Date().toISOString() };
    } catch {
      return null;
    }
  },

  getRelativePath: (filePath, basePath) => {
    if (filePath.startsWith(basePath)) {
      return filePath.slice(basePath.length + 1);
    }
    return filePath;
  },

  loadMetadata: async () => {
    try {
      const data = localStorage.getItem(METADATA_KEY);
      if (data) return JSON.parse(data);
    } catch { /* ignore */ }
    return {
      version: 1,
      lastDirectory: null,
      lastRecursive: true,
      autoTagRules: [],
      excludePatterns: [],
      excludedFiles: [],
      tags: {}
    };
  },

  getAllDimensions: async (filePaths) => {
    const dims = {};
    const BATCH = 30;
    for (let i = 0; i < filePaths.length; i += BATCH) {
      const batch = filePaths.slice(i, i + BATCH);
      await Promise.all(batch.map(p => {
        const url = window._blobUrls.get(p);
        if (!url) return Promise.resolve();
        return new Promise(resolve => {
          const img = new Image();
          img.onload = () => { dims[p] = { width: img.naturalWidth, height: img.naturalHeight }; resolve(); };
          img.onerror = resolve;
          img.src = url;
        });
      }));
      if (_scanProgressCb && (i + BATCH) % 300 === 0) _scanProgressCb(i + BATCH);
    }
    return dims;
  },

  onDimensionsProgress: (callback) => { /* handled via scanProgress in web */ },

  saveMetadata: async (metadata) => {
    try {
      localStorage.setItem(METADATA_KEY, JSON.stringify(metadata));
      return true;
    } catch {
      return false;
    }
  },

  copyFileToClipboard: async (filePath) => {
    // Web can copy image data to clipboard (not the file itself)
    const url = window._blobUrls.get(filePath);
    if (!url) return false;
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      // Clipboard API requires image/png
      if (blob.type === 'image/png') {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        return true;
      }
      // For non-PNG, convert via canvas
      const img = new Image();
      img.src = url;
      await new Promise(r => { img.onload = r; });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob })
      ]);
      return true;
    } catch {
      return false;
    }
  },

  onScanProgress: (callback) => {
    _scanProgressCb = callback;
  },
};
