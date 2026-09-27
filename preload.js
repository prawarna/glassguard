const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('glass', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  monitor: {
    snapshot: () => ipcRenderer.invoke('monitor:snapshot'),
  },
  cleaner: {
    scan: () => ipcRenderer.invoke('cleaner:scan'),
    clean: (categoryIds) => ipcRenderer.invoke('cleaner:clean', categoryIds),
  },
  security: {
    scan: () => ipcRenderer.invoke('security:scan'),
    onProgress: (cb) => ipcRenderer.on('security:progress', (_e, stage) => cb(stage)),
  },
  shell: {
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  },
});
