// CommonJS preload: most reliable way to expose a tiny bridge in Electron.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chOverlay", {
  minimize: () => ipcRenderer.send("window:minimize"),
  quit: () => ipcRenderer.send("window:quit"),
  setZoom: (factor) => ipcRenderer.send("window:zoom", Number(factor) || 1),
  exportSave: (payload) => ipcRenderer.invoke("save:export", payload),
  openSave: () => ipcRenderer.invoke("save:open"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
});
