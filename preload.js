const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('loupe', {
  onState: cb => ipcRenderer.on('state', (_, list) => cb(list)),
  hover: on => ipcRenderer.send('hover', on),
  answer: (req, choice) => ipcRenderer.send('answer', { req, choice }),
  open: id => ipcRenderer.send('open', id),  onConfig: cb => ipcRenderer.on('config', (_, c) => cb(c)),
  setConfig: patch => ipcRenderer.send('config', patch),
  glass: rect => ipcRenderer.send('glass', rect),
});
