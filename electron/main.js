// Оболочка Electron: поднимает локальный бэкенд и открывает окно с интерфейсом.
// Плюс интеграция с Windows: кнопки на миниатюре в панели задач, трей, мини-плеер,
// автозапуск, глобальные горячие клавиши, статус в Discord.
import { app, BrowserWindow, Tray, Menu, shell, nativeImage, screen, session, ipcMain, globalShortcut } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Service } from "../server/service.js";
import { createServer } from "../server/http.js";
import { renderPng, SHAPES } from "./png.js";
import { DiscordPresence, activityFromState } from "./discord.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const t0 = Date.now();

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// воспроизведение по медиа-клавишам до первого клика по окну
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
let normalBounds = null; // размер окна до перехода в мини-плеер
let playerState = { playing: false };
const discord = new DiscordPresence({ log });

const MINI_SIZE = { width: 360, height: 600 };
const FULL_MIN = { width: 980, height: 620 };

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile, "utf8"));
    // окно не должно оказаться за пределами отключённого монитора
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
  // в мини-режиме запоминаем обычный размер, а не крошечное окно
  const b = miniMode && normalBounds ? { ...normalBounds, maximized: false } : { ...win.getNormalBounds(), maximized: win.isMaximized() };
  try {
    fs.writeFileSync(boundsFile, JSON.stringify(b));
  } catch {
    // не критично
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
  // постоянный порт = постоянный origin, иначе localStorage (громкость, тема, очередь) терялся бы при каждом запуске
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

// ---------- кнопки на миниатюре в панели задач ----------
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

// ---------- трей ----------
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
  tray.on("click", () => (win?.isVisible() && win.isFocused() ? win.hide() : showWindow()));
}

// ---------- мини-плеер ----------
function setMini(on) {
  if (!win || on === miniMode) return;
  if (on) {
    normalBounds = win.isMaximized() ? null : win.getBounds();
    if (win.isMaximized()) win.unmaximize();
    miniMode = true;
    win.setMinimumSize(300, 460);
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    // мини-плеер встаёт в правый нижний угол текущего монитора
    win.setBounds({ ...MINI_SIZE, x: area.x + area.width - MINI_SIZE.width - 24, y: area.y + area.height - MINI_SIZE.height - 24 });
    win.setAlwaysOnTop(true, "floating");
  } else {
    miniMode = false;
    win.setAlwaysOnTop(false);
    win.setMinimumSize(FULL_MIN.width, FULL_MIN.height);
    if (normalBounds) win.setBounds(normalBounds);
    else win.maximize();
  }
}

// ---------- глобальные горячие клавиши ----------
const HOTKEYS = {
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
    if (!globalShortcut.register(accel, () => control(method))) log("хоткей занят другой программой:", accel);
  }
}

// ---------- Discord ----------
function updateDiscord() {
  const p = prefs();
  if (!p.discordRpc || !/^\d{15,22}$/.test(p.discordAppId || "")) {
    discord.disconnect();
    return;
  }
  discord.connect(p.discordAppId).catch(() => {});
  discord.setActivity(playerState.playing ? activityFromState(playerState) : null);
}

// ---------- настройки оболочки ----------
function applyPrefs(p) {
  // автозапуск регистрируем только у собранного приложения, иначе в автозагрузку попал бы electron.exe разработчика
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!p.autostart, args: ["--hidden"] });
  applyHotkeys(!!p.globalHotkeys);
  updateDiscord();
}

ipcMain.on("ymc:state", (e, state) => {
  if (e.sender !== win?.webContents) return;
  playerState = state && typeof state === "object" ? state : { playing: false };
  updateThumbar();
  updateTray();
  updateDiscord();
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
      backgroundThrottling: false, // таймеры плеера не должны засыпать в свёрнутом окне
    },
  });
  if (b.maximized) win.maximize();

  const origin = new URL(url).origin;
  // всё, что ведёт наружу, открываем в системном браузере
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
    // запуск из автозагрузки с «Запускать свёрнутым» — окно остаётся в трее
    const stayHidden = launchedHidden && prefs().startMinimized && !process.env.YMC_SHOTS;
    if (!stayHidden) win.show();
    updateThumbar();
    log(`окно ${stayHidden ? "готово (в трее)" : "показано"} через ${Date.now() - t0} мс после старта`);
    if (process.env.YMC_SHOTS) runShots(process.env.YMC_SHOTS);
  });
  win.on("show", updateThumbar);

  // перед закрытием окно отправляет текущее прослушивание в историю (анти-повтор и отчёт Яндексу)
  let finalized = false;
  win.on("close", (e) => {
    saveBounds();
    if (!quitting && prefs().closeToTray && tray) {
      // «свернуть в трей при закрытии»: музыка продолжает играть
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

// Smoke-режим для визуальной проверки: YMC_SHOTS=путь к JSON [{ hash?, js?, wait?, file, mini? }].
// Шаги выполняются по очереди в настоящем окне, после каждого с file — снимок окна.
async function runShots(specFile) {
  const steps = JSON.parse(fs.readFileSync(specFile, "utf8"));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(3000);
  for (const step of steps) {
    try {
      if (step.hash) await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(step.hash)}`);
      if (step.js) {
        const out = await win.webContents.executeJavaScript(`(async () => { ${step.js} })()`);
        if (out !== undefined) log("js:", JSON.stringify(out));
      }
      await sleep(step.wait ?? 1500);
      if (step.file) {
        fs.writeFileSync(step.file, (await win.webContents.capturePage()).toPNG());
        log("снимок:", path.basename(step.file));
      }
    } catch (e) {
      log("шаг упал:", e.message);
    }
  }
  quitting = true;
  app.quit();
}

app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // музыкальному клиенту не нужны ни камера, ни микрофон, ни уведомления сайтов
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  backend = await startBackend();
  log(`бэкенд готов через ${Date.now() - t0} мс`);
  createWindow(backend.url, backend.srv.key);
  createTray();
  applyPrefs(prefs());
  backend.svc.onPrefs((next) => applyPrefs(next));
});

app.on("before-quit", () => {
  quitting = true;
});

// will-quit наступает после закрытия окон — к этому моменту финальное прослушивание уже записано
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  discord.disconnect();
  backend?.svc.store.saveNow();
});

app.on("window-all-closed", () => {
  if (quitting || process.platform !== "darwin") app.quit();
});
