const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDirectory: () => ipcRenderer.invoke('open-directory'),
  scanDirectory: (dirPath, recursive) => ipcRenderer.invoke('scan-directory', dirPath, recursive),
  countImages: (dirPath, recursive) => ipcRenderer.invoke('count-images', dirPath, recursive),
  getImageInfo: (filePath) => ipcRenderer.invoke('get-image-info', filePath),
  getRelativePath: (filePath, basePath) => ipcRenderer.invoke('get-relative-path', filePath, basePath),
  loadMetadata: () => ipcRenderer.invoke('load-metadata'),
  saveMetadata: (metadata) => ipcRenderer.invoke('save-metadata', metadata),
  copyFileToClipboard: (filePath) => ipcRenderer.invoke('copy-file-to-clipboard', filePath),
  getAllDimensions: (filePaths) => ipcRenderer.invoke('get-all-dimensions', filePaths),
  onScanProgress: (callback) => {
    ipcRenderer.on('scan-progress', (_event, count) => callback(count));
  },
});
