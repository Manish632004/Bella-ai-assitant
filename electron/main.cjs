/* ===========================================================================
 * BELLA â€” Electron main process (Phase 1)
 * ---------------------------------------------------------------------------
 * Responsibilities in this phase:
 *   1. Enforce a single running instance.
 *   2. Launch the existing Node backend (server.ts, bundled to dist/server.cjs)
 *      silently as a child process â€” no console window, no browser tab.
 *   3. Show a splash window while the backend boots, then load the real UI
 *      (http://localhost:3000) into the main application window.
 *   4. Clean up the backend (and its child Python agent) on quit.
 *
 * Tray, window-state persistence, close-to-tray and notifications arrive in
 * Phase 2; installer/auto-update/PyInstaller in later phases. The backend and
 * AI logic are reused verbatim â€” nothing here reimplements chat/memory/voice.
 * ========================================================================= */

'use strict';

const { app, BrowserWindow, Menu, shell, dialog, ipcMain, screen, desktopCapturer, session } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

// Suppress internal Chromium network debug logs (e.g. chunked_data_pipe stream logs from Web Speech API)
app.commandLine.appendSwitch('log-level', '3');

// --- Constants -------------------------------------------------------------
const SERVER_PORT = 3000;
const SERVER_ORIGIN = `http://localhost:${SERVER_PORT}`;
const SERVER_READY_TIMEOUT_MS = 40_000;

let isMiniModeActive = false;
let previousBounds = { x: 100, y: 100, width: 1280, height: 800 };
let wasMaximized = false;

function restoreFullScreenMode() {
  if (!mainWindow) return;
  isMiniModeActive = false;
  mainWindow.setAlwaysOnTop(false);

  // Remove the max-size lock BEFORE restoring bounds.
  // On Windows setMaximumSize(0,0) does NOT clear the cap — use the full
  // screen dimensions so the window can grow back to any size.
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setMaximumSize(sw, sh);
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(940, 600);

  if (wasMaximized) {
    // Restore to maximized state, not just bounds
    mainWindow.setBounds(previousBounds, false);
    mainWindow.maximize();
  } else {
    mainWindow.setBounds(previousBounds, true);
  }
  mainWindow.webContents.send('restore-full-mode');
}

ipcMain.on('toggle-mini-mode', (_event, enabled) => {
  if (!mainWindow) return;
  try {
    isMiniModeActive = Boolean(enabled);
    if (enabled) {
      wasMaximized = mainWindow.isMaximized();
      if (wasMaximized) mainWindow.unmaximize();
      previousBounds = mainWindow.getBounds();

      const primaryDisplay = screen.getPrimaryDisplay();
      const { workArea } = primaryDisplay;

      // Lock size: set min == max == 280 so OS can't resize at all
      mainWindow.setResizable(false);
      mainWindow.setMinimumSize(280, 280);
      mainWindow.setMaximumSize(280, 280);
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setBounds({
        width: 280,
        height: 280,
        x: workArea.x + workArea.width - 300,
        y: workArea.y + workArea.height - 300
      }, true);
    } else {
      restoreFullScreenMode();
    }
  } catch (err) {
    console.error('[Electron Mini Mode Error]:', err);
  }
});

ipcMain.on('move-window', (_event, { deltaX, deltaY }) => {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  if (isMiniModeActive) {
    // Force exact 280x280 on every move frame so the OS can never resize
    mainWindow.setBounds({
      x: Math.round(bounds.x + deltaX),
      y: Math.round(bounds.y + deltaY),
      width: 280,
      height: 280
    });
  } else {
    mainWindow.setPosition(Math.round(bounds.x + deltaX), Math.round(bounds.y + deltaY));
  }
});

// Window control handlers for frameless window
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

// BELLA 6.0 — voice HUD control: snap window to a named corner / center
ipcMain.on('position-hud-corner', (_event, corner) => {
  if (!mainWindow) return;
  try {
    const { workArea } = screen.getPrimaryDisplay();
    const bounds = mainWindow.getBounds();
    const w = Math.min(bounds.width, isMiniModeActive ? 280 : bounds.width);
    const h = Math.min(bounds.height, isMiniModeActive ? 280 : bounds.height);
    const margin = 12;
    let x = workArea.x + margin;
    let y = workArea.y + margin;
    switch (String(corner || '').toLowerCase()) {
      case 'top-left': break;
      case 'top-right': x = workArea.x + workArea.width - w - margin; break;
      case 'center':
        x = workArea.x + Math.floor((workArea.width - w) / 2);
        y = workArea.y + Math.floor((workArea.height - h) / 2);
        break;
      case 'bottom-right':
        x = workArea.x + workArea.width - w - margin;
        y = workArea.y + workArea.height - h - margin; break;
      case 'bottom-left':
      default:
        y = workArea.y + workArea.height - h - margin; break;
    }
    mainWindow.setPosition(Math.round(x), Math.round(y));
    if (!mainWindow.isVisible()) mainWindow.show();
  } catch (err) {
    console.error('[HUD Position Error]:', err);
  }
});

// BELLA 6.0 — hide/show the HUD by voice
ipcMain.on('set-hud-visibility', (_event, visible) => {
  if (!mainWindow) return;
  try {
    if (visible) { mainWindow.show(); mainWindow.focus(); }
    else mainWindow.hide();
  } catch (err) {
    console.error('[HUD Visibility Error]:', err);
  }
});

// BELLA 6.0 — persist screen recordings from the renderer to disk
ipcMain.handle('save-recording', async (_event, arrayBuffer, fileName) => {
  try {
    const { dialog } = require('electron');
    const pathMod = require('path');
    const fsMod = require('fs');
    const videosDir = pathMod.join(require('os').homedir(), 'Videos', 'BellaRecordings');
    fsMod.mkdirSync(videosDir, { recursive: true });
    const safeName = String(fileName || `bella-recording-${Date.now()}.webm`).replace(/[\\/:*?"<>|]/g, '-');
    const dest = pathMod.join(videosDir, safeName);
    fsMod.writeFileSync(dest, Buffer.from(arrayBuffer));
    return { ok: true, path: dest };
  } catch (err) {
    console.error('[Recording Save Error]:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// BELLA 6.0 — persist whiteboard PNGs from the renderer to disk
ipcMain.handle('save-image', async (_event, arrayBuffer, fileName) => {
  try {
    const pathMod = require('path');
    const fsMod = require('fs');
    const dir = pathMod.join(require('os').homedir(), 'Pictures', 'BellaBoards');
    fsMod.mkdirSync(dir, { recursive: true });
    const safeName = String(fileName || `whiteboard-${Date.now()}.png`).replace(/[\\/:*?"<>|]/g, '-');
    const dest = pathMod.join(dir, safeName);
    fsMod.writeFileSync(dest, Buffer.from(arrayBuffer));
    return { ok: true, path: dest };
  } catch (err) {
    console.error('[Image Save Error]:', err);
    return { ok: false, error: err.message };
  }
});

// IPC Handler to query screen and window capture sources
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 }
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id
    }));
  } catch (err) {
    console.error('[desktopCapturer Error]:', err);
    return [];
  }
});

// In development we run from the repo root; when packaged the app files live in
// resources/app (asar-unpacked handling is added in the packaging phase).
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');

const SERVER_ENTRY = path.join(APP_ROOT, 'dist', 'server.cjs');

/** @type {import('child_process').ChildProcess | null} */
let serverProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let splashWindow = null;
let isQuitting = false;
let tray = null;

// ---------------------------------------------------------------------------
// Single-instance guard â€” second launches focus the existing window instead of
// starting a second backend on the same port.
// ---------------------------------------------------------------------------
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (isMiniModeActive) {
        restoreFullScreenMode();
      }
    }
  });

  app.on('activate', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (isMiniModeActive) {
        restoreFullScreenMode();
      }
    }
  });

  app.whenReady().then(bootstrap);
}

// ---------------------------------------------------------------------------
// Backend lifecycle — supervised: crashes are logged and the backend is
// restarted automatically instead of killing the whole app.
// ---------------------------------------------------------------------------
const BACKEND_LOG = path.join(APP_ROOT, 'logs', 'backend.log');
let backendLogStream = null;
let backendRespawns = 0;
let backendRespawnTimer = null;

function logBackend(line) {
  try {
    if (!backendLogStream) {
      fs.mkdirSync(path.dirname(BACKEND_LOG), { recursive: true });
      backendLogStream = fs.createWriteStream(BACKEND_LOG, { flags: 'a' });
    }
    backendLogStream.write(line);
  } catch { /* logging must never crash the app */ }
}

function startBackend() {
  if (serverProcess && !serverProcess.killed) return; // already running
  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error(
      `Backend bundle not found at ${SERVER_ENTRY}. Run "npm run build" first.`,
    );
  }

  // Use the Node runtime bundled with Electron (ELECTRON_RUN_AS_NODE) so the
  // machine does not need a separate Node install once packaged.
  // In development, share the project root so web app and electron share the exact same memories.
  const dataDir = app.isPackaged
    ? app.getPath('userData')
    : APP_ROOT;

  // Seed memories and settings if running in packaged mode for the first time
  if (app.isPackaged && fs.existsSync(APP_ROOT)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const rootMemories = path.join(APP_ROOT, 'memories.json');
      const userMemories = path.join(dataDir, 'memories.json');
      if (fs.existsSync(rootMemories) && !fs.existsSync(userMemories)) {
        fs.copyFileSync(rootMemories, userMemories);
      }
      const rootSettings = path.join(APP_ROOT, 'settings.json');
      const userSettings = path.join(dataDir, 'settings.json');
      if (fs.existsSync(rootSettings) && !fs.existsSync(userSettings)) {
        fs.copyFileSync(rootSettings, userSettings);
      }
    } catch (e) {
      console.warn('[Electron Seed Sync Error]:', e);
    }
  }

  // Frozen Python desktop agent (bundled as an extraResource when packaged).
  // In development, run the agent from live source with local Python interpreter.
  const agentExe = app.isPackaged
    ? path.join(process.resourcesPath, 'agent', 'bella-agent.exe')
    : null;

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    ELECTRON_RUN_AS_NODE: '1',
    BELLA_LAUNCHED_BY: 'electron',
    BELLA_DATA_DIR: dataDir,
    BELLA_APP_ROOT: APP_ROOT,
  };
  if (agentExe && fs.existsSync(agentExe)) {
    env.BELLA_AGENT_EXE = agentExe;
  }

  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: APP_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  logBackend(`[supervisor] spawned pid=${serverProcess.pid} at ${new Date().toISOString()}\n`);

  // Stable for 5 minutes? forgive past crashes.
  setTimeout(() => {
    if (serverProcess && !serverProcess.killed) backendRespawns = 0;
  }, 5 * 60_000);

  serverProcess.stdout?.on('data', (d) => {
    process.stdout.write(`[server] ${d}`);
    logBackend(d);
  });
  serverProcess.stderr?.on('data', (d) => {
    process.stderr.write(`[server] ${d}`);
    logBackend(d);
  });
  serverProcess.on('exit', (code, signal) => {
    logBackend(`[supervisor] backend exited code=${code} signal=${signal} at ${new Date().toISOString()}\n`);
    serverProcess = null;
    if (isQuitting) return;

    // Crash policy: restart with backoff. Only bother the user after
    // repeated failures — a single hiccup should never kill BELLA.
    if (backendRespawns < 8) {
      backendRespawns += 1;
      const delayMs = Math.min(30_000, 1500 * backendRespawns);
      console.warn(`[supervisor] backend died (code ${code}) — restarting in ${delayMs}ms`);
      backendRespawnTimer = setTimeout(() => {
        try { startBackend(); } catch (e) {
          console.error('[supervisor] respawn failed:', e.message);
        }
      }, delayMs);
    } else {
      dialog.showErrorBox(
        'BELLA backend stopped',
        `The BELLA backend exited repeatedly (last code ${code}, signal ${signal}). ` +
        `See logs\\backend.log for details.`,
      );
      app.quit();
    }
  });
}

function stopBackend() {
  if (backendRespawnTimer) {
    clearTimeout(backendRespawnTimer);
    backendRespawnTimer = null;
  }
  if (serverProcess && !serverProcess.killed) {
    try {
      if (process.platform === 'win32') {
        // Kill the whole tree so the auto-spawned Python agent goes too.
        spawn('taskkill', ['/pid', String(serverProcess.pid), '/T', '/F']);
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch {
      /* best-effort */
    }
  }
  serverProcess = null;
}

/** Poll the backend until it answers, or reject on timeout. */
function waitForBackend(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(SERVER_ORIGIN, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error('Backend did not become ready in time.'));
        } else {
          setTimeout(tryOnce, 400);
        }
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tryOnce();
  });
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
function createSplashWindow() {
  const iconPath = path.join(APP_ROOT, 'assets', 'icon.png');
  splashWindow = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.on('closed', () => (splashWindow = null));
}

function createMainWindow() {
  const iconPath = path.join(APP_ROOT, 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 220,
    minHeight: 220,
    show: false, // revealed on ready-to-show to avoid a white flash
    frame: false, // removes invisible OS resize handles on transparent windows
    transparent: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    title: 'BELLA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  Menu.setApplicationMenu(null);

  // Open external links (http/https to non-local hosts) in the real browser
  // instead of navigating the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.startsWith(SERVER_ORIGIN)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('minimize', (e) => {
    if (isMiniModeActive) {
      e.preventDefault();
      restoreFullScreenMode();
    }
  });

  // BELLA 6.0 — close-to-tray: keep her alive in the background so wake word,
  // reminders and phone link keep working when the window is dismissed.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('restore', () => {
    if (isMiniModeActive) {
      restoreFullScreenMode();
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) splashWindow.close();
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on('closed', () => (mainWindow = null));

  mainWindow.loadURL(SERVER_ORIGIN);
}

// ---------------------------------------------------------------------------
// Bootstrap sequence
// ---------------------------------------------------------------------------
async function bootstrap() {
  app.setAppUserModelId('com.bella.desktop');

  // Configure Electron session handlers for screen sharing & media access
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      // Pick the primary screen or first available display source
      const primary = sources.find(s => s.id.startsWith('screen')) || sources[0];
      if (primary) {
        callback({ video: primary });
      } else {
        callback({});
      }
    }).catch((err) => {
      console.error('[DisplayMedia Handler Error]:', err);
      callback({});
    });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true);
  });

  session.defaultSession.setPermissionCheckHandler(() => {
    return true;
  });

  createSplashWindow();

  try {
    startBackend();
    await waitForBackend(SERVER_READY_TIMEOUT_MS);
    createMainWindow();
    try { createTray(); } catch (err) { console.error('[Tray] failed:', err); }
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) startToastWatcher();
    } catch (err) { console.error('[Toast watcher] failed:', err); }
  } catch (err) {
    if (splashWindow) splashWindow.close();
    dialog.showErrorBox(
      'BELLA failed to start',
      `${err instanceof Error ? err.message : String(err)}`,
    );
    app.quit();
  }
}

// ---------------------------------------------------------------------------
// BELLA 6.0 — Toast bridge: surface server-side events (reminders, finished
// agents) as native Windows notifications, even with the HUD closed.
// ---------------------------------------------------------------------------
let lastToastTs = 0;
function startToastWatcher() {
  const fsMod = require('fs');
  const pathMod = require('path');
  const dataDir = process.env.BELLA_DATA_DIR || APP_ROOT;
  const toastFile = pathMod.join(dataDir, 'toasts.json');
  const showNew = () => {
    try {
      if (!fsMod.existsSync(toastFile)) return;
      const list = JSON.parse(fsMod.readFileSync(toastFile, 'utf-8'));
      const fresh = list.filter(t => t.t > lastToastTs);
      for (const t of fresh) {
        lastToastTs = Math.max(lastToastTs, t.t);
        try {
          const n = new Notification({
            title: String(t.title || 'BELLA'),
            body: String(t.body || '').slice(0, 200),
            icon: fs.existsSync(pathMod.join(APP_ROOT, 'public', 'icon.png')) ? pathMod.join(APP_ROOT, 'public', 'icon.png') : undefined,
            silent: false,
          });
          n.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
          n.show();
        } catch (e) { console.error('[Toast] show failed:', e); }
      }
    } catch { /* file mid-write — next poll picks it up */ }
  };
  setInterval(showNew, 5000);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('window-all-closed', () => {
  // With close-to-tray the window is only hidden, so this fires on real quit.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
});

// ---------------------------------------------------------------------------
// BELLA 6.0 — System tray
// ---------------------------------------------------------------------------
function createTray() {
  const { Tray, nativeImage } = require('electron');
  const candidates = [path.join(APP_ROOT, 'assets', 'icon.png'), path.join(APP_ROOT, 'public', 'icon.png')];
  const iconPath = candidates.find(p => fs.existsSync(p));
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('BELLA — voice-first desktop AI');

  const showWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  tray.on('click', showWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show BELLA', click: showWindow },
    { label: 'Hide', click: () => mainWindow && mainWindow.hide() },
    { type: 'separator' },
    { label: 'Quit BELLA', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

process.on('exit', stopBackend);
