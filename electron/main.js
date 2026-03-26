const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const net = require('net');
const path = require('path');

let mainWindow = null;
let serverInstance = null;
let activePort = 3001;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${activePort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function findFreePort(startPort) {
  return new Promise((resolve) => {
    function tryPort(port) {
      if (port > startPort + 10) {
        // All ports taken, let OS pick
        const srv = net.createServer();
        srv.listen(0, '0.0.0.0', () => {
          const p = srv.address().port;
          srv.close(() => resolve(p));
        });
        return;
      }
      const srv = net.createServer();
      srv.listen(port, '0.0.0.0', () => {
        srv.close(() => resolve(port));
      });
      srv.on('error', () => tryPort(port + 1));
    }
    tryPort(startPort);
  });
}

async function startServer() {
  // Find a free port BEFORE importing server.js (which creates the http.Server)
  activePort = await findFreePort(3001);

  const backend = require('../backend/server.js');
  serverInstance = backend.server;

  await new Promise((resolve, reject) => {
    backend.server.once('error', reject);
    backend.server.listen(activePort, '0.0.0.0', () => {
      backend.server.removeListener('error', reject);
      console.log(`Pilot server running at http://localhost:${activePort}`);
      if (backend.advertisePilot) backend.advertisePilot(activePort);
      // Auto-start tunnel if configured
      if (backend.loadTunnelConfig && backend.startTunnel) {
        const tc = backend.loadTunnelConfig();
        if (tc?.autoStart && (tc.token || tc.tunnelId)) {
          console.log('Auto-starting tunnel...');
          backend.startTunnel(activePort);
        }
      }
      resolve();
    });
  });
}

// --- IPC Handlers ---

ipcMain.handle('dialog:openFolder', async () => {
  const isMas = process.mas === true;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose Project Folder',
    // MAS sandbox: request security-scoped bookmark for persistent access
    securityScopedBookmarks: isMas,
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  // In MAS builds, start accessing the security-scoped resource
  if (isMas && result.bookmarks && result.bookmarks[0]) {
    app.startAccessingSecurityScopedResource(result.bookmarks[0]);
    // Store bookmark so we can re-access on next launch
    const bookmarkStore = require('path').join(app.getPath('userData'), 'bookmarks.json');
    const fs = require('fs');
    let bookmarks = {};
    try { bookmarks = JSON.parse(fs.readFileSync(bookmarkStore, 'utf-8')); } catch {}
    bookmarks[result.filePaths[0]] = result.bookmarks[0];
    fs.writeFileSync(bookmarkStore, JSON.stringify(bookmarks));
  }

  return result.filePaths[0];
});

// --- App lifecycle ---

app.whenReady().then(async () => {
  // MAS: restore security-scoped bookmarks for previously accessed folders
  if (process.mas === true) {
    const fs = require('fs');
    const bookmarkStore = path.join(app.getPath('userData'), 'bookmarks.json');
    try {
      const bookmarks = JSON.parse(fs.readFileSync(bookmarkStore, 'utf-8'));
      for (const [, bookmark] of Object.entries(bookmarks)) {
        app.startAccessingSecurityScopedResource(bookmark);
      }
    } catch {}
  }

  await startServer();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('before-quit', () => {
  // Server cleanup happens via process exit handlers in server.js
});
