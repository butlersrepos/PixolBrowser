const { app, BrowserWindow, ipcMain, dialog, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

// Metadata storage path
const userDataPath = app.getPath('userData');
const metadataPath = path.join(userDataPath, 'metadata.json');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'PixolBrowser',
    icon: path.join(__dirname, 'icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    app.dock.setIcon(icon);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ===== IPC Handlers =====

// Open directory dialog
ipcMain.handle('open-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Scan directory for PNGs
ipcMain.handle('scan-directory', async (event, dirPath, recursive) => {
  const files = [];
  await walkDirectory(dirPath, recursive, (file) => {
    files.push(file);
    if (files.length % 500 === 0) {
      event.sender.send('scan-progress', files.length);
    }
  });
  return files;
});

async function walkDirectory(dir, recursive, onFile) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // Skip unreadable directories
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && /\.(png|jpe?g|gif|webp|bmp)$/i.test(entry.name)) {
      onFile(fullPath);
    } else if (entry.isDirectory() && recursive && !entry.name.startsWith('.')) {
      await walkDirectory(fullPath, recursive, onFile);
    }
  }
}

// Quick count of image files in a directory
ipcMain.handle('count-images', async (_event, dirPath, recursive) => {
  let count = 0;
  await walkDirectory(dirPath, recursive, () => { count++; });
  return count;
});

// Batch read image dimensions from file headers (no dependencies, just raw bytes)
ipcMain.handle('get-all-dimensions', async (event, filePaths) => {
  const fsSync = require('fs');
  const dims = {};
  for (let i = 0; i < filePaths.length; i++) {
    try {
      dims[filePaths[i]] = readImageDimensions(fsSync, filePaths[i]);
    } catch { /* skip */ }
    if ((i + 1) % 2000 === 0) {
      event.sender.send('dimensions-progress', i + 1, filePaths.length);
    }
  }
  return dims;
});

function readImageDimensions(fsSync, filePath) {
  const fd = fsSync.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(32);
    fsSync.readSync(fd, header, 0, 32, 0);

    // PNG: bytes 16-23 contain width and height as 32-bit big-endian
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
      return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
    }

    // GIF: bytes 6-9 contain width and height as 16-bit little-endian
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
      return { width: header.readUInt16LE(6), height: header.readUInt16LE(8) };
    }

    // BMP: bytes 18-25 contain width and height as 32-bit little-endian
    if (header[0] === 0x42 && header[1] === 0x4D) {
      return { width: header.readUInt32LE(18), height: Math.abs(header.readInt32LE(22)) };
    }

    // JPEG: need to scan for SOF marker
    if (header[0] === 0xFF && header[1] === 0xD8) {
      const buf = Buffer.alloc(65536);
      fsSync.readSync(fd, buf, 0, buf.length, 0);
      let offset = 2;
      while (offset < buf.length - 10) {
        if (buf[offset] !== 0xFF) break;
        const marker = buf[offset + 1];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
        }
        const len = buf.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }

    // WebP: RIFF header then VP8 chunk
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
      const buf = Buffer.alloc(64);
      fsSync.readSync(fd, buf, 0, 64, 0);
      // VP8L (lossless)
      if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x4C) {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
      }
      // VP8 (lossy)
      if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x20) {
        return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
      }
      // VP8X (extended)
      if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x58) {
        const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
        const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
        return { width: w, height: h };
      }
    }
  } finally {
    fsSync.closeSync(fd);
  }
  return null;
}

// Get image info (dimensions + file size)
ipcMain.handle('get-image-info', async (_event, filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      modified: stats.mtime.toISOString(),
    };
  } catch {
    return null;
  }
});

// Load metadata
ipcMain.handle('load-metadata', async () => {
  try {
    const data = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      version: 1,
      lastDirectory: null,
      lastRecursive: true,
      autoTagRules: [],
      excludePatterns: [],
      excludedFiles: [],
      tags: {}
    };
  }
});

// Save metadata
ipcMain.handle('save-metadata', async (_event, metadata) => {
  try {
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save metadata:', e);
    return false;
  }
});

// Get relative path from a base directory
ipcMain.handle('get-relative-path', (_event, filePath, basePath) => {
  return path.relative(basePath, filePath);
});

// Copy file to system clipboard (macOS: pasteboard, so user can Cmd+V into Finder/apps)
ipcMain.handle('copy-file-to-clipboard', async (_event, filePath) => {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      const escaped = filePath.replace(/'/g, "'\\''");
      exec(`osascript -e 'set the clipboard to (POSIX file "${escaped}")' `, (err) => {
        resolve(!err);
      });
    } else {
      resolve(false);
    }
  });
});
