const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  ping: (ip) => ipcRenderer.invoke('ping', ip),
  getFilePath: (file) => webUtils.getPathForFile(file),
  readFileChunk: (path, offset, length) => ipcRenderer.invoke('read-file-chunk', path, offset, length),
  readLargeFile: (path) => ipcRenderer.invoke('read-large-file', path),
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    create: (name) => ipcRenderer.invoke('project:create', name),
    rename: (oldName, newName) => ipcRenderer.invoke('project:rename', oldName, newName),
    delete: (name) => ipcRenderer.invoke('project:delete', name),
    importFile: (projectName, sourcePath, fileName) => ipcRenderer.invoke('project:import-file', projectName, sourcePath, fileName),
    listTree: (projectName, subDir) => ipcRenderer.invoke('project:list-tree', projectName, subDir),
    writeFile: (projectName, subPath, data) => ipcRenderer.invoke('project:write-file', projectName, subPath, data),
  },
});
