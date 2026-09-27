const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const monitor = require('./lib/monitor');
const cleaner = require('./lib/cleaner');
const security = require('./lib/security');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#00000000',
    transparent: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Window controls ---
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());

// --- System monitor ---
ipcMain.handle('monitor:snapshot', async () => {
  return monitor.getSnapshot();
});

// --- Junk cleaner ---
ipcMain.handle('cleaner:scan', async () => {
  return cleaner.scanJunk();
});

ipcMain.handle('cleaner:clean', async (_event, categoryIds) => {
  return cleaner.cleanJunk(categoryIds);
});

// --- Security scan ---
ipcMain.handle('security:scan', async (event) => {
  return security.runSecurityScan((stage) => {
    event.sender.send('security:progress', stage);
  });
});

ipcMain.handle('shell:openPath', async (_event, targetPath) => {
  return shell.showItemInFolder(targetPath);
});
