const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth
  connectSpotify: () => ipcRenderer.invoke('spotify-connect'),
  getSpotifyStatus: () => ipcRenderer.invoke('spotify-status'),
  reauthorizeSpotify: () => ipcRenderer.invoke('spotify-reauthorize'),
  onOAuthCallback: (cb) => ipcRenderer.on('oauth-callback', (_, url) => cb(url)),
  onAuthSuccess: (cb) => ipcRenderer.on('auth-success', (_, data) => cb(data)),
  onAuthError: (cb) => ipcRenderer.on('auth-error', (_, err) => cb(err)),

  // Data
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickZip: () => ipcRenderer.invoke('pick-zip'),
  parseExport: (folderPath) => ipcRenderer.invoke('parse-export', folderPath),
  analyzeFingerprint: () => ipcRenderer.invoke('analyze-fingerprint'),

  // Generation
  generatePlaylist: (opts) => ipcRenderer.invoke('generate-playlist', opts),
  onProgressLog: (cb) => ipcRenderer.on('progress-log', (_, msg) => cb(msg)),
  removeProgressLog: () => ipcRenderer.removeAllListeners('progress-log'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  clearCache: (type) => ipcRenderer.invoke('clear-cache', type),

  // Updates
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', () => cb()),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_, data) => cb(data)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Last run info
  getLastPlaylist: () => ipcRenderer.invoke('get-last-playlist'),

  // Onboarding
  getOnboardingState: () => ipcRenderer.invoke('get-onboarding-state'),
  completeOnboarding: () => ipcRenderer.invoke('complete-onboarding'),
  resetOnboarding: () => ipcRenderer.invoke('reset-onboarding'),
});
