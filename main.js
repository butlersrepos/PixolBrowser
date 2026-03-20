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
