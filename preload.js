const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('loupe', {
  onState: cb => ipcRenderer.on('state', (_, list) => cb(list)),
  onFront: cb => ipcRenderer.on('front', (_, on) => cb(on)),
  hover: on => ipcRenderer.send('hover', on),
  onLeave: cb => ipcRenderer.on('leave', () => cb()),
  answer: (req, choice) => ipcRenderer.send('answer', { req, choice }),
  open: id => ipcRenderer.send('open', id),  onConfig: cb => ipcRenderer.on('config', (_, c) => cb(c)),
  setConfig: patch => ipcRenderer.send('config', patch),
  glass: rect => ipcRenderer.send('glass', rect),
  onMenubar: cb => ipcRenderer.on('menubar', (_, m) => cb(m)), // Mac: where app menus end and icons start
});
