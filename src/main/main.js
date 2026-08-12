const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc');
const serverproc = require('./serverproc');

let mainWindow = null;

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    title: 'MC Server Studio',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) {
      console.log(`[renderer:${level === 3 ? 'error' : 'warn'}] ${message} (${sourceId}:${line})`);
    }
  });
}

app.whenReady().then(() => {
  registerIpc(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await serverproc.stopAll();
  app.quit();
});

app.on('before-quit', () => {
  serverproc.killAll();
});
