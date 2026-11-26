// Main-window bridge: a few desktop-only actions for Settings (no Node access for the page itself).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pandichDesktop', {
  info: () => ipcRenderer.invoke('app:info'),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  openData: () => ipcRenderer.invoke('app:openData'),
  openSetup: () => ipcRenderer.invoke('app:openSetup'),
  setAutostart: on => ipcRenderer.invoke('app:setAutostart', !!on),
  checkUpdates: () => ipcRenderer.invoke('app:checkUpdates'),
  updateState: () => ipcRenderer.invoke('app:updateState'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  restartServer: () => ipcRenderer.invoke('app:restartServer'),
  logTail: () => ipcRenderer.invoke('app:logTail'),
});
