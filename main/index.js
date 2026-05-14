const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');

// Must be called before 'ready'
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

if (process.defaultApp) {
  app.setAsDefaultProtocolClient('tasteengine', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('tasteengine');
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default',
    title: 'TasteEngine',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

function handleOAuthCallback(url) {
  if (mainWindow) {
    mainWindow.webContents.send('oauth-callback', url);
  }
  const { handleProtocolCallback } = require('./spotify-auth');
  handleProtocolCallback(url, mainWindow);
}

app.on('second-instance', (event, commandLine) => {
  const url = commandLine.find(arg => arg.startsWith('tasteengine://'));
  if (url) handleOAuthCallback(url);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleOAuthCallback(url);
});

app.whenReady().then(async () => {
  createWindow();

  const { initStore } = require('./store');
  initStore();

  const { registerIpcHandlers } = require('./ipc-handlers');
  registerIpcHandlers(mainWindow);

  const { checkAndRefreshToken } = require('./spotify-auth');
  await checkAndRefreshToken(mainWindow);

  if (app.isPackaged) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('update-available', () => {
      mainWindow && mainWindow.webContents.send('update-available');
    });
    autoUpdater.on('update-downloaded', () => {
      mainWindow && mainWindow.webContents.send('update-downloaded');
    });
    autoUpdater.on('error', (err) => {
      console.error('AutoUpdater error:', err);
    });
    autoUpdater.checkForUpdatesAndNotify().catch(err => console.error('Update check failed:', err));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
