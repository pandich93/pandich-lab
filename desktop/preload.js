// Setup-wizard bridge (only the setup window uses this preload; the main app window has no Node access).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('setup', {
  status: () => ipcRenderer.invoke('setup:status'),
  installClaude: () => ipcRenderer.invoke('setup:installClaude'),
  loginClaude: () => ipcRenderer.invoke('setup:loginClaude'),
  installMT5: () => ipcRenderer.invoke('setup:installMT5'),
  installPython: () => ipcRenderer.invoke('setup:installPython'),
  testClaude: () => ipcRenderer.invoke('setup:testClaude'),
  installGit: () => ipcRenderer.invoke('setup:installGit'),
  setLang: l => ipcRenderer.invoke('setup:setLang', l),
  platform: process.platform,
  setClaudePath: p => ipcRenderer.invoke('setup:setClaudePath', p),
  openUrl: u => ipcRenderer.invoke('setup:openUrl', u),
  finish: opts => ipcRenderer.invoke('setup:finish', opts),
  onLog: cb => ipcRenderer.on('setup:log', (_e, line) => cb(line)),
});
