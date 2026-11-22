const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const cfgPath = () => path.join(app.getPath("userData"), "config.json");
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgPath(), "utf8")); } catch { return {}; } };
const saveCfg = (c) => fs.writeFileSync(cfgPath(), JSON.stringify(c));

let win, tray, quitting = false;

function show() {
  const { server } = loadCfg();
  if (server) win.loadURL(server).catch(() => win.loadFile(path.join(__dirname, "setup.html")));
  else win.loadFile(path.join(__dirname, "setup.html"));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 800, minHeight: 560,
    backgroundColor: "#070b14", title: "Device Monitor", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("did-fail-load", (_e, code) => {
    if (code !== -3) win.loadFile(path.join(__dirname, "setup.html"));
  });
  // Closing hides to the tray so alerts keep working; "Quit" really exits.
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  show();
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABBElEQVR4nO3XTyuEYRiF8etjKQtloSxmoWahLJSFxZSFsrCYslAW/jYxhkwmjWaIRCSS73XfNse9VuLlfWeexfMNfqvTuZh4NybfjKlXY/rFmHk2Zp+M2qMx92DU7435O2Ph1li8MZaujeUrozEwVi6N1b6zduGs95zmubPRdTbPnK1TZ7vj7B07rSOnfeictJzugdPbd/q7znDnAwoCFAAFQAFQABQABUABUAAUAJUNUAAUABUAKAAKgP4LUAkA/RWgEgEqClAFAP0WoAoB+gmgEQD0HUAjBCgDvgI0BoAyIAMyIAOSAox9ijMgiUOSxCVL4pQmccuTCJMk0iyJOK00zz8B2tIOIpP8engAAAAASUVORK5CYII=",
  );
  tray = new Tray(icon);
  tray.setToolTip("Device Monitor");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open", click: () => win.show() },
    { label: "Change dashboard address", click: () => { saveCfg({}); show(); win.show(); } },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", () => win.show());
}

ipcMain.handle("save-server", (_e, url) => { saveCfg({ server: url.replace(/\/+$/, "") }); show(); });

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { win && win.show(); });
app.whenReady().then(() => { createWindow(); createTray(); });
app.on("before-quit", () => { quitting = true; });
