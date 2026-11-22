const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("dm", {
  getState: () => ipcRenderer.invoke("get-state"),
  saveSetup: (cfg) => ipcRenderer.invoke("save-setup", cfg),
  setSharing: (on) => ipcRenderer.invoke("set-sharing", on),
  unpair: () => ipcRenderer.invoke("unpair"),
  changeSetup: () => ipcRenderer.invoke("change-setup"),
  onState: (fn) => ipcRenderer.on("state", (_e, s) => fn(s)),
});
