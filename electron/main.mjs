// Frameless, transparent, always-on-top window for the overlay UI.
// Quit with Ctrl+Shift+Q, hide/show with Ctrl+Shift+H, reload with Ctrl+Shift+R.
import { app, BrowserWindow, dialog, globalShortcut, shell, screen, ipcMain } from "electron";
import updaterPkg from "electron-updater";
const { autoUpdater } = updaterPkg;
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = process.env.CH_OVERLAY_PORT || 8787;
const URL = `http://127.0.0.1:${PORT}/`;
const Y = Number(process.env.CH_OVERLAY_Y || 80);
const W = Number(process.env.CH_OVERLAY_W || 460);
const H = Number(process.env.CH_OVERLAY_H || 820);

// XWayland keeps always-on-top predictable under KWin; native Wayland ignores it.
if (process.env.CH_OVERLAY_WAYLAND === "1") {
  app.commandLine.appendSwitch("ozone-platform", "wayland");
} else {
  app.commandLine.appendSwitch("ozone-platform", "x11");
}
app.disableHardwareAcceleration();

app.setName("clicker-heroes-companion");
// WM_CLASS must match StartupWMClass in the .desktop file, otherwise the
// taskbar shows a generic icon even though the app has one.
app.commandLine.appendSwitch("class", "clicker-heroes-companion");
if (process.platform === "win32") app.setAppUserModelId("dev.geenutz.clickerheroeslive");

let win = null;

function create() {
  // KWin double-applies the scale factor to setPosition, so the default is a
  // plain top-left anchor; drag the panel anywhere (header is a drag region)
  // or override with CH_OVERLAY_X / CH_OVERLAY_Y.
  const X = Number(process.env.CH_OVERLAY_X || 40);
  win = new BrowserWindow({
    x: X,
    y: Y,
    width: W,
    height: H,
    frame: false,
    transparent: false,
    backgroundColor: "#0b0d12",
    icon: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "icon.png"),
    resizable: true,
    movable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.cjs"),
    },
  });

  // "floating" keeps it above normal windows without the aggressive
  // screen-saver level, which reasserted itself above the game on focus changes.
  win.setAlwaysOnTop(true, "floating");
  const d = screen.getPrimaryDisplay();
  console.log("display", JSON.stringify(d.bounds), "scale", d.scaleFactor, "bounds", JSON.stringify(win.getBounds()));
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  try {
    // Linux/Wayland sometimes ignores the BrowserWindow icon option; setting it
    // after creation populates _NET_WM_ICON so the taskbar can show it.
    win.setIcon(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "icon.png"));
  } catch { /* Windows-only API on some builds */ }
  win.loadURL(process.env.CH_SELFTEST === "1" ? URL + "?selftest=minimize" : URL);
  win.once("ready-to-show", () => {
    win.show();
    // "floating" keeps it above normal windows without the aggressive
  // screen-saver level, which reasserted itself above the game on focus changes.
  win.setAlwaysOnTop(true, "floating");
    console.log("shown", JSON.stringify(win.getBounds()), "visible", win.isVisible());
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => {
    win = null;
  });
}

async function startServer() {
  // Inside an installed app the asar is read-only, so settings live in userData.
  try {
    const { app: electronApp } = await import("electron");
    const userData = electronApp.getPath("userData");
    fs.mkdirSync(userData, { recursive: true });
    const target = path.join(userData, "settings.json");
    if (!fs.existsSync(target)) {
      const seed = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "settings.json");
      try {
        fs.copyFileSync(seed, target);
      } catch {
        fs.writeFileSync(target, JSON.stringify({ build: "idle", theme: "dark", fontScale: 1.15 }, null, 2));
      }
    }
    process.env.CH_SETTINGS_FILE = target;
  } catch {
    /* dev fallback: repo settings.json */
  }
  await import("../src/server.mjs");
}

app.whenReady().then(() => {
  ipcMain.on("window:minimize", () => { console.log("ipc minimize"); win?.minimize(); });
  ipcMain.on("window:quit", () => app.quit());
  // User-selected location for exported/imported saves.
  ipcMain.handle("save:export", async (_e, { text, defaultName }) => {
    const r = await dialog.showSaveDialog(win, {
      title: "Export save",
      defaultPath: path.join(app.getPath("downloads"), defaultName || "playerSaveData.txt"),
      filters: [{ name: "Clicker Heroes save", extensions: ["txt"] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, text);
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle("save:open", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "Open a save file",
      properties: ["openFile"],
      filters: [{ name: "Clicker Heroes save", extensions: ["txt", "json"] }],
    });
    if (r.canceled || !r.filePaths?.length) return { ok: false, canceled: true };
    return { ok: true, text: fs.readFileSync(r.filePaths[0], "utf8"), path: r.filePaths[0] };
  });

  ipcMain.on("window:zoom", (_e, factor) => {
    const f = Math.min(2, Math.max(0.75, Number(factor) || 1));
    win?.webContents.setZoomFactor(f);
  });
  // Auto-update from GitHub Releases (AppImage / exe / dmg builds only).
  autoUpdater.autoDownload = true;
  const updateState = { status: "idle", version: null, error: null };
  autoUpdater.on("checking-for-update", () => { updateState.status = "checking"; });
  autoUpdater.on("update-available", (i) => {
    updateState.status = "available"; updateState.version = i?.version ?? null;
  });
  autoUpdater.on("update-not-available", () => { updateState.status = "current"; });
  autoUpdater.on("download-progress", () => { if (updateState.status === "available") updateState.status = "downloading"; });
  autoUpdater.on("update-downloaded", (i) => {
    updateState.status = "downloaded"; updateState.version = i?.version ?? null;
  });
  autoUpdater.on("error", (e) => {
    updateState.status = "error"; updateState.error = String(e?.message || e);
  });
  ipcMain.handle("update:check", async () => {
    updateState.status = "checking";
    updateState.error = null;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      updateState.status = "error";
      updateState.error = String(err?.message || err);
    }
    const deadline = Date.now() + 12000;
    while (["checking", "available", "downloading"].includes(updateState.status) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
    }
    return { ok: updateState.status !== "error", ...updateState, current: app.getVersion() };
  });
  ipcMain.handle("update:install", async () => {
    try {
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  startServer()
    .catch((err) => console.error("server failed:", err))
    .finally(() => create());

  globalShortcut.register("Control+Shift+M", () => win?.minimize());
  globalShortcut.register("Control+Shift+H", () => {
    if (!win) return create();
    win.isVisible() ? win.hide() : win.show();
  });
  globalShortcut.register("Control+Shift+R", () => win?.reload());
  globalShortcut.register("Control+Shift+Q", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
