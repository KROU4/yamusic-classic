// Electron shell: starts the local backend and opens a window with the UI.
// Plus Windows integration: taskbar thumbnail buttons, tray, mini player,
// autostart, global hotkeys.
import { app, BrowserWindow, Tray, Menu, shell, nativeImage, screen, session, ipcMain, globalShortcut, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Service } from "../server/service.js";
import { createServer } from "../server/http.js";
import { renderPng, SHAPES } from "./png.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const t0 = Date.now();

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// playback via media keys until the first click on the window
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.setAppUserModelId("dev.krou4.ymclassic");

const dataDir = app.getPath("userData");
const boundsFile = path.join(dataDir, "window.json");
const log = (...a) => console.log("[ymc]", ...a);
const launchedHidden = process.argv.includes("--hidden");

let win = null;
let tray = null;
let backend = null;
let quitting = false;
let miniMode = false;
let pendingMaximize = false; // the window started in the tray, and it must be maximized on first show
let normalBounds = null; // window size before switching to the mini player
let playerState = { playing: false };

const MINI_SIZE = { width: 360, height: 600 };
const FULL_MIN = { width: 980, height: 620 };

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile, "utf8"));
    // the window must not end up off a disconnected monitor
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 20 && b.y < a.y + a.height - 100;
    });
    return visible ? b : { width: b.width, height: b.height, maximized: b.maximized };
  } catch {
    return { width: 1320, height: 860 };
  }
}

function saveBounds() {
  if (!win) return;
  // in mini mode remember the normal size, not the tiny window
  // a window started in the tray "maximized" isn't maximized yet, but that's how it should be saved
  const b = miniMode && normalBounds ? normalBounds : { ...win.getNormalBounds(), maximized: win.isMaximized() || pendingMaximize };
  try {
    fs.writeFileSync(boundsFile, JSON.stringify(b));
  } catch {
    // not critical
  }
}

function appIcon() {
  const file = path.join(root, "build", "icon.png");
  return fs.existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
}

async function startBackend() {
  const svc = new Service({ dataDir, log });
  await svc.init().catch((e) => log("init failed", e.message));
  const srv = createServer({ svc, staticDir: path.join(root, "dist"), log });
  // a fixed port = a fixed origin, otherwise localStorage (volume, theme, queue) would be lost on every launch
  const { url } = await srv.listen(Number(process.env.YMC_PORT || 47819), { fallback: true });
  return { svc, srv, url };
}

const prefs = () => backend?.svc.prefs || {};

function control(method) {
  win?.webContents.executeJavaScript(`window.__ymcControl && window.__ymcControl.${method}()`).catch(() => {});
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- taskbar thumbnail buttons ----------
const thumbIcons = {};
const thumbIcon = (name) => (thumbIcons[name] ||= nativeImage.createFromBuffer(renderPng(32, SHAPES[name])));

function updateThumbar() {
  if (!win || process.platform !== "win32") return;
  const has = !!playerState.id;
  const flags = has ? [] : ["disabled"];
  win.setThumbarButtons([
    { tooltip: "Предыдущий", icon: thumbIcon("prev"), flags, click: () => control("prev") },
    { tooltip: playerState.playing ? "Пауза" : "Играть", icon: thumbIcon(playerState.playing ? "pause" : "play"), click: () => control("toggle") },
    { tooltip: "Следующий", icon: thumbIcon("next"), flags, click: () => control("next") },
  ]);
}

// ---------- tray ----------
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: playerState.id ? `${playerState.title} — ${playerState.artist}`.slice(0, 60) : "YM Classic", enabled: false },
    { type: "separator" },
    { label: "Показать", click: showWindow },
    { label: playerState.playing ? "Пауза" : "Играть", click: () => control("toggle") },
    { label: "Следующий трек", click: () => control("next") },
    { label: "Предыдущий трек", click: () => control("prev") },
    { label: "Мне нравится", enabled: !!playerState.id, click: () => control("like") },
    { type: "separator" },
    {
      label: "Выход",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(playerState.id ? `${playerState.playing ? "▶" : "❚❚"} ${playerState.title} — ${playerState.artist}`.slice(0, 127) : "YM Classic");
  tray.setContextMenu(trayMenu());
}

function createTray() {
  const icon = appIcon();
  if (icon.isEmpty()) return;
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  updateTray();
  // by visibility, not focus: clicking the tray in Windows takes focus from the window itself
  tray.on("click", () => (win?.isVisible() && !win.isMinimized() ? win.hide() : showWindow()));
}

// ---------- mini player ----------
function setMini(on) {
  if (!win || on === miniMode) return;
  if (on) {
    // always remember the normal window rectangle and whether it was maximized, both for restoring and for saveBounds
    normalBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    if (win.isMaximized()) win.unmaximize();
    miniMode = true;
    win.setMinimumSize(300, 460);
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    // the mini player goes to the bottom-right corner of the current monitor
    win.setBounds({ ...MINI_SIZE, x: area.x + area.width - MINI_SIZE.width - 24, y: area.y + area.height - MINI_SIZE.height - 24 });
    win.setAlwaysOnTop(true, "floating");
  } else {
    miniMode = false;
    win.setAlwaysOnTop(false);
    win.setMinimumSize(FULL_MIN.width, FULL_MIN.height);
    if (normalBounds) {
      const { maximized, ...rect } = normalBounds;
      win.setBounds(rect);
      if (maximized) win.maximize();
    }
  }
}

// ---------- global hotkeys ----------
// Ctrl+Alt+Space is often taken (PowerToys, layout switchers), so the main pause key is Ctrl+Alt+P
const HOTKEYS = {
  "CommandOrControl+Alt+P": "toggle",
  "CommandOrControl+Alt+Space": "toggle",
  "CommandOrControl+Alt+Right": "next",
  "CommandOrControl+Alt+Left": "prev",
  "CommandOrControl+Alt+Up": "volumeUp",
  "CommandOrControl+Alt+Down": "volumeDown",
  "CommandOrControl+Alt+L": "like",
};

function applyHotkeys(enabled) {
  globalShortcut.unregisterAll();
  if (!enabled) return;
  for (const [accel, method] of Object.entries(HOTKEYS)) {
    if (!globalShortcut.register(accel, () => control(method))) log("hotkey taken by another program:", accel);
  }
}

// ---------- shell settings ----------
function applyPrefs(p) {
  // register autostart only for the packaged app, otherwise the developer's electron.exe would end up in autostart
  // the portable build unpacks to a temp folder: write the portable exe itself to autostart
  // (same path/args on disable too, otherwise Windows won't find and remove the right entry)
  if (app.isPackaged) {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE;
    app.setLoginItemSettings({ openAtLogin: !!p.autostart, args: ["--hidden"], ...(exe ? { path: exe } : {}) });
  }
  applyHotkeys(!!p.globalHotkeys);
}

/** Renderer state coerced to a strict shape: strings trimmed, links https only, numbers are numbers. */
function sanitizeState(s) {
  const str = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
  const num = (v) => (Number.isFinite(+v) && +v >= 0 ? +v : 0);
  if (!s || typeof s !== "object" || !s.id) return { playing: !!s?.playing };
  return {
    playing: !!s.playing,
    id: /^\d+$/.test(String(s.id)) ? String(s.id) : "",
    title: str(s.title),
    artist: str(s.artist),
    album: str(s.album),
    albumId: /^\d+$/.test(String(s.albumId ?? "")) ? String(s.albumId) : null,
    cover: typeof s.cover === "string" && s.cover.startsWith("https://") ? str(s.cover, 300) : null,
    durationSec: num(s.durationSec),
    positionSec: num(s.positionSec),
  };
}

ipcMain.on("ymc:state", (e, state) => {
  if (e.sender !== win?.webContents) return;
  playerState = sanitizeState(state);
  updateThumbar();
  updateTray();
});

ipcMain.on("ymc:mini", (e, on) => {
  if (e.sender !== win?.webContents) return;
  setMini(!!on);
});

function createWindow(url, key) {
  const b = loadBounds();
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: FULL_MIN.width,
    minHeight: FULL_MIN.height,
    show: false,
    backgroundColor: "#141414",
    autoHideMenuBar: true,
    title: "YM Classic",
    icon: appIcon(),
    webPreferences: {
      preload: path.join(root, "electron", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false, // player timers must not fall asleep in a minimized window
    },
  });
  // maximize() on a hidden window shows it immediately, so maximize only in ready-to-show
  const startMaximized = !!b.maximized;

  const origin = new URL(url).origin;
  // everything that leads outside is opened in the system browser
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (new URL(target).origin !== origin) {
      e.preventDefault();
      if (/^https?:/.test(target)) shell.openExternal(target);
    }
  });

  win.once("ready-to-show", () => {
    // launch from autostart with "Start minimized": the window stays in the tray (only if a tray exists, otherwise the window is unreachable)
    const stayHidden = launchedHidden && prefs().startMinimized && !!tray && !process.env.YMC_SHOTS;
    if (!stayHidden) {
      if (startMaximized) win.maximize(); // maximize also shows the window
      else win.show();
    } else if (startMaximized) {
      pendingMaximize = true;
      win.once("show", () => {
        pendingMaximize = false;
        win.maximize();
      });
    }
    updateThumbar();
    log(`window ${stayHidden ? "ready (in tray)" : "shown"} ${Date.now() - t0} ms after start`);
    if (process.env.YMC_SHOTS) runShots(process.env.YMC_SHOTS);
  });
  win.on("show", updateThumbar);
  // backgroundThrottling is off, so the page never sees document.hidden: tell it explicitly
  // when the window is out of sight (minimized or in the tray) to stop purely visual work
  const sendVisibility = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send("ymc:visibility", win.isVisible() && !win.isMinimized());
  };
  for (const ev of ["show", "hide", "minimize", "restore"]) win.on(ev, sendVisibility);
  // Windows shutdown/logoff: before-quit doesn't arrive, and "minimize to tray" must not block closing
  win.on("session-end", () => {
    quitting = true;
  });

  // before closing the window sends the current listening to the history (anti-repeat and report to Yandex)
  let finalized = false;
  win.on("close", (e) => {
    saveBounds();
    if (!quitting && prefs().closeToTray && tray) {
      // "minimize to tray on close": music keeps playing
      e.preventDefault();
      win.hide();
      return;
    }
    if (finalized) return;
    e.preventDefault();
    finalized = true;
    const close = () => win?.destroy();
    const timer = setTimeout(close, 2000);
    win.webContents
      .executeJavaScript("window.__ymcFinalize ? window.__ymcFinalize() : null")
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        close();
      });
  });
  win.on("closed", () => {
    win = null;
  });
  win.loadURL(`${url}#k=${key}`);
}

// Smoke mode for visual checks: YMC_SHOTS=path to JSON [{ window?: "minimize"|"restore", hash?, js?, wait?, file? }].
// Steps run in order in a real window, a window screenshot after each one with file.
async function runShots(specFile) {
  const steps = JSON.parse(fs.readFileSync(specFile, "utf8"));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(3000);
  for (const step of steps) {
    try {
      // order: window action -> navigate -> wait for page load -> check; without navigation: action -> wait for the result
      if (step.window === "minimize") win.minimize();
      if (step.window === "restore") win.restore();
      if (step.hash) {
        await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(step.hash)}`);
        await sleep(step.wait ?? 1500);
      }
      if (step.js) {
        const out = await win.webContents.executeJavaScript(`(async () => { ${step.js} })()`);
        if (out !== undefined) log("js:", JSON.stringify(out));
      }
      if (!step.hash) await sleep(step.wait ?? 1500);
      if (step.file) {
        fs.writeFileSync(step.file, (await win.webContents.capturePage()).toPNG());
        log("screenshot:", path.basename(step.file));
      }
    } catch (e) {
      log("step failed:", e.message);
    }
  }
  quitting = true;
  app.quit();
}

app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // a music client needs neither camera, nor microphone, nor site notifications
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // Yandex's audio CDN allows CORS only for music.yandex.ru. Without the header Web Audio (equalizer,
  // wave animation reacting to music) gets silence, so we add it to audio host responses.
  // All media responses, not just *.yandex.net: the renderer sets crossOrigin on every <audio>, and a stream
  // served from an unexpected host or redirect without the header would not play at all. This window only
  // ever loads media from Yandex stream URLs, so widening the filter exposes nothing else.
  session.defaultSession.webRequest.onHeadersReceived({ urls: ["http://*/*", "https://*/*"] }, (d, cb) => {
    if (d.resourceType !== "media") return cb({});
    const headers = { ...d.responseHeaders };
    for (const k of Object.keys(headers)) if (/^access-control-allow-(origin|credentials)$/i.test(k)) delete headers[k];
    headers["Access-Control-Allow-Origin"] = ["*"];
    cb({ responseHeaders: headers });
  });
  try {
    backend = await startBackend();
    log(`backend ready ${Date.now() - t0} ms after start`);
    createWindow(backend.url, backend.srv.key);
    createTray();
    applyPrefs(prefs());
    backend.svc.onPrefs((next) => applyPrefs(next));
  } catch (e) {
    // otherwise an invisible process without a window would hold the single-instance lock
    log("startup failed:", e.stack || e.message);
    dialog.showErrorBox("YM Classic", "Не удалось запустить локальный сервер: " + e.message);
    app.exit(1);
  }
});

app.on("before-quit", () => {
  quitting = true;
});

// will-quit happens after windows are closed: by then the final listening is already recorded
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  backend?.svc.store.saveNow();
});

app.on("window-all-closed", () => {
  if (quitting || process.platform !== "darwin") app.quit();
});
