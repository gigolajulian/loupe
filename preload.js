const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('loupe', {
  onState: cb => ipcRenderer.on('state', (_, list) => cb(list)),
  onFront: cb => ipcRenderer.on('front', (_, on) => cb(on)),
  hover: on => ipcRenderer.send('hover', on),
  onLeave: cb => ipcRenderer.on('leave', () => cb()),
  answer: (req, choice) => ipcRenderer.send('answer', { req, choice }),
  open: id => ipcRenderer.send('open', id),  onConfig: cb => ipcRenderer.on('config', (_, c) => cb(c)),
  focus: on => ipcRenderer.send('focus', on), // Other's text box: take the keyboard while typing
  drag: dx => ipcRenderer.send('drag', dx), // Windows: slide the island along the top edge
  setConfig: patch => ipcRenderer.send('config', patch),
  glass: rect => ipcRenderer.send('glass', rect),
  onProcs: cb => ipcRenderer.on('procs', (_, p) => cb(p)), // Processes: { leftovers, sessions } or null when off
  procs: () => ipcRenderer.send('procs'), // the panel opened: refresh soon
  kill: pids => ipcRenderer.invoke('kill', pids), // after the confirm; resolves with reap's result lines
  trim: () => webFrame.clearCache(), // all threads went quiet: hand Blink's caches back (MEM-2)
  onLink: cb => ipcRenderer.on('link', (_, l) => cb(l)), // a bad Claude link { state, problem }, or null
  link: a => ipcRenderer.send('link', a), // Link Claude / Repair link, or 'node' to open nodejs.org
  onMenubar: cb => ipcRenderer.on('menubar', (_, m) => cb(m)), // Mac: where app menus end and icons start
});
