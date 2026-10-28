// Оболочка Electron: поднимает локальный бэкенд и открывает окно с интерфейсом.
// Плюс интеграция с Windows: кнопки на миниатюре в панели задач, трей, мини-плеер,
// автозапуск, глобальные горячие клавиши.
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
let pendingMaximize = false; // окно стартовало в трее, а развернуть его надо при первом показе
let normalBounds = null; // размер окна до перехода в мини-плеер
let playerState = { playing: false };

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
  // окно, запущенное в трей «развёрнутым», ещё не развёрнуто — но таким его и надо сохранить
  const b = miniMode && normalBounds ? normalBounds : { ...win.getNormalBounds(), maximized: win.isMaximized() || pendingMaximize };
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
  // по видимости, а не по фокусу: клик по трею в Windows сам забирает фокус у окна
  tray.on("click", () => (win?.isVisible() && !win.isMinimized() ? win.hide() : showWindow()));
}

// ---------- мини-плеер ----------
function setMini(on) {
  if (!win || on === miniMode) return;
  if (on) {
    // всегда помним обычный прямоугольник окна и был ли он развёрнут — и для возврата, и для saveBounds
    normalBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
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
    if (normalBounds) {
      const { maximized, ...rect } = normalBounds;
      win.setBounds(rect);
      if (maximized) win.maximize();
    }
  }
}

// ---------- глобальные горячие клавиши ----------
// Ctrl+Alt+Пробел часто занят (PowerToys, переключатели раскладок), поэтому основная пауза — Ctrl+Alt+P
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
    if (!globalShortcut.register(accel, () => control(method))) log("хоткей занят другой программой:", accel);
  }
}

// ---------- настройки оболочки ----------
function applyPrefs(p) {
  // автозапуск регистрируем только у собранного приложения, иначе в автозагрузку попал бы electron.exe разработчика
  // портативная сборка распаковывается во временную папку — в автозагрузку пишем сам portable-exe
  // (те же path/args и при выключении, иначе Windows не найдёт и не удалит нужную запись)
  if (app.isPackaged) {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE;
    app.setLoginItemSettings({ openAtLogin: !!p.autostart, args: ["--hidden"], ...(exe ? { path: exe } : {}) });
  }
  applyHotkeys(!!p.globalHotkeys);
}

/** Состояние из renderer приводим к строгой форме: строки обрезаны, ссылки только https, числа — числа. */
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
      backgroundThrottling: false, // таймеры плеера не должны засыпать в свёрнутом окне
    },
  });
  // maximize() у скрытого окна сразу его показывает — разворачиваем только в ready-to-show
  const startMaximized = !!b.maximized;

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
    // запуск из автозагрузки с «Запускать свёрнутым» — окно остаётся в трее (только если трей есть, иначе окно недостижимо)
    const stayHidden = launchedHidden && prefs().startMinimized && !!tray && !process.env.YMC_SHOTS;
    if (!stayHidden) {
      if (startMaximized) win.maximize(); // maximize заодно и показывает окно
      else win.show();
    } else if (startMaximized) {
      pendingMaximize = true;
      win.once("show", () => {
        pendingMaximize = false;
        win.maximize();
      });
    }
    updateThumbar();
    log(`окно ${stayHidden ? "готово (в трее)" : "показано"} через ${Date.now() - t0} мс после старта`);
    if (process.env.YMC_SHOTS) runShots(process.env.YMC_SHOTS);
  });
  win.on("show", updateThumbar);
  // выключение/выход из Windows: before-quit не приходит, а «свернуть в трей» не должно мешать закрытию
  win.on("session-end", () => {
    quitting = true;
  });

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
      // порядок: переход → ожидание загрузки страницы → проверка; без перехода — действие → ожидание результата
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
  // Аудио-CDN Яндекса разрешает CORS только для music.yandex.ru. Без заголовка Web Audio (эквалайзер,
  // реакция анимации волны на музыку) получает тишину, поэтому добавляем его к ответам аудиохостов.
  session.defaultSession.webRequest.onHeadersReceived({ urls: ["https://*.yandex.net/*"] }, (d, cb) => {
    if (d.resourceType !== "media") return cb({});
    const headers = { ...d.responseHeaders };
    for (const k of Object.keys(headers)) if (/^access-control-allow-(origin|credentials)$/i.test(k)) delete headers[k];
    headers["Access-Control-Allow-Origin"] = ["*"];
    cb({ responseHeaders: headers });
  });
  try {
    backend = await startBackend();
    log(`бэкенд готов через ${Date.now() - t0} мс`);
    createWindow(backend.url, backend.srv.key);
    createTray();
    applyPrefs(prefs());
    backend.svc.onPrefs((next) => applyPrefs(next));
  } catch (e) {
    // иначе невидимый процесс без окна держал бы блокировку единственного экземпляра
    log("запуск не удался:", e.stack || e.message);
    dialog.showErrorBox("YM Classic", "Не удалось запустить локальный сервер: " + e.message);
    app.exit(1);
  }
});

app.on("before-quit", () => {
  quitting = true;
});

// will-quit наступает после закрытия окон — к этому моменту финальное прослушивание уже записано
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  backend?.svc.store.saveNow();
});

app.on("window-all-closed", () => {
  if (quitting || process.platform !== "darwin") app.quit();
});
