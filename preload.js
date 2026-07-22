// 安全桥梁：渲染进程（界面）只能通过这里暴露的接口和系统打交道
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xiaoda', {
  setIgnoreMouse: (flag) => ipcRenderer.send('set-ignore-mouse', flag),
  moveBy: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
  getStats: () => ipcRenderer.invoke('get-stats'),
  getClaudeStats: () => ipcRenderer.invoke('get-claude-stats'),
  chat: (history) => ipcRenderer.invoke('chat', history),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  testModelConfig: (cfg) => ipcRenderer.invoke('test-model-config', cfg),
  quit: () => ipcRenderer.send('quit'),
  getReminders: () => ipcRenderer.invoke('get-reminders'),
  removeReminder: (id) => ipcRenderer.invoke('remove-reminder', id),
  // 角色系统
  getCharacters: () => ipcRenderer.invoke('get-characters'),
  addCharacter: (c) => ipcRenderer.invoke('add-character', c),
  deleteCharacter: (id) => ipcRenderer.invoke('delete-character', id),
  chooseCharacter: (id) => ipcRenderer.invoke('choose-character', id),
  getSelected: () => ipcRenderer.invoke('get-selected'),
  openSelector: () => ipcRenderer.send('open-selector'),
  closeSelector: () => ipcRenderer.send('close-selector'),
});
