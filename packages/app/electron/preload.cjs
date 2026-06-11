const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  ping: (ip) => ipcRenderer.invoke('ping', ip),
  getFilePath: (file) => webUtils.getPathForFile(file),
  readLargeFile: (path) => ipcRenderer.invoke('read-large-file', path),
});
