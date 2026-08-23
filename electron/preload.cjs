/* ===========================================================================
 * BELLA â€” Electron preload
 * ---------------------------------------------------------------------------
 * Runs in an isolated context and exposes a minimal, explicit API surface to
 * the renderer via contextBridge. In Phase 1 this only advertises that the UI
 * is running inside the desktop shell (so the web UI can adapt if it wants);
 * tray/notification/window controls are added alongside those features.
 * ========================================================================= */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bella', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
  setMiniMode: (enabled) => ipcRenderer.send('toggle-mini-mode', enabled),
  moveWindow: (deltaX, deltaY) => ipcRenderer.send('move-window', { deltaX, deltaY }),
  onRestoreFullMode: (callback) => ipcRenderer.on('restore-full-mode', () => callback()),
  // Window controls for frameless window
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  // Screen sharing source discovery
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  // BELLA 6.0 — screen recorder persistence (dialog + fs in main)
  saveRecording: (arrayBuffer, fileName) => ipcRenderer.invoke('save-recording', arrayBuffer, fileName),
  // BELLA 6.0 — whiteboard PNG persistence
  saveImage: (arrayBuffer, fileName) => ipcRenderer.invoke('save-image', arrayBuffer, fileName),
  // BELLA 6.0 — voice HUD control
  positionHudCorner: (corner) => ipcRenderer.send('position-hud-corner', corner),
  setHudVisibility: (visible) => ipcRenderer.send('set-hud-visibility', visible),
});
