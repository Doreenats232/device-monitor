const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const agent = require("./agent-core");

const cfgPath = () => path.join(app.getPath("userData"), "config.json");
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgPath(), "utf8")); } catch { return {}; } };
const saveCfg = (c) => fs.writeFileSync(cfgPath(), JSON.stringify(c));

let win, tray, quitting = false;
let stopLoop = null;
let status = "";

const isMonitor = (c) => c.mode === "monitor" || c.mode === "both";
const isMonitored = (c) => (c.mode === "monitored" || c.mode === "both") && c.token;

function state() {
  const c = loadCfg();
  return { mode: c.mode || null, server: c.server || "", name: c.name || "", hostname: os.hostname(), sharing: Boolean(stopLoop), status };
}
function push() { if (win && !win.isDestroyed()) win.webContents.send("state", state()); refreshTray(); }

function startSharing() {
  const c = loadCfg();
  if (stopLoop || !isMonitored(c)) return;
  stopLoop = agent.startLoop(c, {
    onStatus: (t) => { status = t; push(); },
    onRemoved: () => { stopLoop = null; const n = loadCfg(); delete n.token; if (n.mode === "both") n.mode = "monitor"; else n.mode = null; saveCfg(n); status = ""; push(); showUI(); },
  });
  status = "Starting…";
  push();
}
function stopSharing() { if (stopLoop) { stopLoop(); stopLoop = null; } status = "Stopped"; push(); }

function showUI() {
  const c = loadCfg();
  if (!c.mode || !c.server) return win.loadFile(path.join(__dirname, "setup.html"));
  if (c.mode === "monitored") return win.loadFile(path.join(__dirname, "status.html"));
  win.loadURL(c.server).catch(() => win.loadFile(path.join(__dirname, "setup.html")));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 800, minHeight: 560,
    backgroundColor: "#070b14", title: "Device Monitor", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("did-fail-load", (_e, code) => { if (code !== -3) win.loadFile(path.join(__dirname, "setup.html")); });
  // In "both" mode show a visible sharing pill on top of the dashboard.
  win.webContents.on("did-finish-load", () => {
    const url = win.webContents.getURL();
    if (!stopLoop || !url.startsWith("http")) return;
    win.webContents.executeJavaScript(`(()=>{if(document.getElementById('dm-pill'))return;const d=document.createElement('div');d.id='dm-pill';
      d.style.cssText='position:fixed;left:14px;bottom:14px;z-index:99999;display:flex;gap:10px;align-items:center;padding:8px 14px;border-radius:999px;background:#0b1220;color:#e2e8f0;border:1px solid rgba(52,211,153,.5);font:13px Segoe UI,sans-serif';
      d.innerHTML='<span style="color:#34d399">●</span> This PC is being monitored <button style="border:0;border-radius:999px;padding:4px 10px;background:#2a1218;color:#fca5a5;cursor:pointer">Stop</button>';
      d.querySelector('button').onclick=()=>{window.dm.setSharing(false);d.remove()};document.body.appendChild(d)})()`).catch(() => {});
  });
  // Closing hides to the tray so sharing/alerts keep running; "Quit" really exits.
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  showUI();
}

function refreshTray() {
  if (!tray) return;
  const c = loadCfg();
  const sharing = Boolean(stopLoop);
  tray.setToolTip(sharing ? "Device Monitor — this PC is being monitored" : "Device Monitor");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open", click: () => win.show() },
    ...(isMonitored(c) ? [{ label: sharing ? "● Sharing this PC — stop" : "Start sharing this PC", click: () => (sharing ? stopSharing() : startSharing()) }] : []),
    { label: "Change mode / dashboard", click: () => { win.loadFile(path.join(__dirname, "setup.html")); win.show(); } },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const icon = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABBElEQVR4nO3XTyuEYRiF8etjKQtloSxmoWahLJSFxZSFsrCYslAW/jYxhkwmjWaIRCSS73XfNse9VuLlfWeexfMNfqvTuZh4NybfjKlXY/rFmHk2Zp+M2qMx92DU7435O2Ph1li8MZaujeUrozEwVi6N1b6zduGs95zmubPRdTbPnK1TZ7vj7B07rSOnfeictJzugdPbd/q7znDnAwoCFAAFQAFQABQABUABUAAUAJUNUAAUABUAKAAKgP4LUAkA/RWgEgEqClAFAP0WoAoB+gmgEQD0HUAjBCgDvgI0BoAyIAMyIAOSAox9ijMgiUOSxCVL4pQmccuTCJMk0iyJOK00zz8B2tIOIpP8engAAAAASUVORK5CYII=");
  tray = new Tray(icon);
  tray.on("click", () => win.show());
  refreshTray();
}

ipcMain.handle("get-state", () => state());

ipcMain.handle("save-setup", async (_e, { mode, server, code, name }) => {
  const old = loadCfg();
  const cfg = { mode, server, name: name || os.hostname() };
  try {
    if (mode !== "monitor") {
      if (old.token && old.server === server) cfg.token = old.token; // already paired with this dashboard
      else { const r = await agent.pair(server, code, cfg.name); cfg.token = r.token; }
    }
  } catch (err) { return { error: err.message }; }
  if (mode === "monitor" && stopLoop) stopSharing();
  saveCfg(cfg);
  showUI();
  if (isMonitored(cfg)) startSharing();
  push();
  return { ok: true };
});

ipcMain.handle("set-sharing", (_e, on) => { on ? startSharing() : stopSharing(); });
ipcMain.handle("unpair", () => { stopSharing(); const c = loadCfg(); delete c.token; c.mode = c.mode === "both" ? "monitor" : null; saveCfg(c); status = ""; showUI(); push(); });
ipcMain.handle("change-setup", () => { win.loadFile(path.join(__dirname, "setup.html")); });

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { win && win.show(); });
app.whenReady().then(() => { createWindow(); createTray(); startSharing(); });
app.on("before-quit", () => { quitting = true; });
