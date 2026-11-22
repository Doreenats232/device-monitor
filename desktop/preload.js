const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("dm", { saveServer: (url) => ipcRenderer.invoke("save-server", url) });
