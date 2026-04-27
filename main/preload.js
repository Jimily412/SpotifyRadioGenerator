const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value)
  },
  spotify: {
    connect: () => ipcRenderer.invoke('spotify:connect'),
    disconnect: () => ipcRenderer.invoke('spotify:disconnect'),
    getStatus: () => ipcRenderer.invoke('spotify:getStatus')
  },
  data: {
    pickFolder: () => ipcRenderer.invoke('data:pickFolder'),
    loadFolder: (path) => ipcRenderer.invoke('data:loadFolder', path),
    analyze: () => ipcRenderer.invoke('data:analyze')
  },
  generate: {
    run: (options) => ipcRenderer.invoke('generate:run', options),
    estimate: (options) => ipcRenderer.invoke('generate:estimate', options)
  },
  cache: {
    clear: (type) => ipcRenderer.invoke('cache:clear', type)
  },
  updates: {
    install: () => ipcRenderer.invoke('updates:install')
  },
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  onProgress: (cb) => {
    ipcRenderer.removeAllListeners('progress');
    ipcRenderer.on('progress', (_, data) => cb(data));
  },
  onAuthStatus: (cb) => {
    ipcRenderer.removeAllListeners('auth:status');
    ipcRenderer.on('auth:status', (_, data) => cb(data));
  },
  onUpdateStatus: (cb) => {
    ipcRenderer.removeAllListeners('update:status');
    ipcRenderer.on('update:status', (_, data) => cb(data));
  },
  removeListener: (channel) => ipcRenderer.removeAllListeners(channel)
});
