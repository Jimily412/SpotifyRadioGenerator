const { app, BrowserWindow } = require('electron');
const path = require('path');
const { setupIpcHandlers, setMainWindow } = require('./ipc-handlers');
const { handleOAuthCallback } = require('./spotify-auth');

// Must call before app 'ready'
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Register custom protocol before ready
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('tasteengine', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('tasteengine');
}

let mainWindow = null;
let authTimeoutId = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const indexPath = path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
  mainWindow.loadFile(indexPath).catch(err => {
    console.error('Failed to load renderer:', err);
  });

  setMainWindow(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
    setMainWindow(null);
    if (authTimeoutId) clearTimeout(authTimeoutId);
  });
}

app.on('second-instance', (event, commandLine) => {
  const url = commandLine.find(arg => arg.startsWith('tasteengine://'));
  if (url) {
    if (authTimeoutId) { clearTimeout(authTimeoutId); authTimeoutId = null; }
    handleOAuthCallback(url, mainWindow);
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('tasteengine://')) {
    if (authTimeoutId) { clearTimeout(authTimeoutId); authTimeoutId = null; }
    handleOAuthCallback(url, mainWindow);
  }
});

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});

      autoUpdater.on('update-available', () => {
        mainWindow?.webContents.send('update:status', { type: 'available' });
      });
      autoUpdater.on('update-downloaded', () => {
        mainWindow?.webContents.send('update:status', { type: 'downloaded' });
      });
      autoUpdater.on('error', (err) => {
        console.error('[AutoUpdater]', err.message);
      });
    } catch (err) {
      console.error('[AutoUpdater setup]', err.message);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function startAuthTimeout() {
  if (authTimeoutId) clearTimeout(authTimeoutId);
  authTimeoutId = setTimeout(() => {
    mainWindow?.webContents.send('auth:status', {
      type: 'timeout',
      message: 'Auth timed out — try again'
    });
    authTimeoutId = null;
  }, 3 * 60 * 1000);
}

module.exports = { startAuthTimeout };
