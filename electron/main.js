// Оболочка Electron: поднимает локальный бэкенд и открывает окно с интерфейсом.
import { app, BrowserWindow, Tray, Menu, shell, nativeImage, screen } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Service } from "../server/service.js";
import { createServer } from "../server/http.js";

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

let win = null;
let tray = null;
let backend = null;
let quitting = false;

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
  const b = { ...win.getNormalBounds(), maximized: win.isMaximized() };
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
  const { url } = await srv.listen(0);
  return { svc, srv, url };
}

function createWindow(url, key) {
  const b = loadBounds();
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: "#141414",
    autoHideMenuBar: true,
    title: "YM Classic",
    icon: appIcon(),
    webPreferences: {
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
    win.show();
    log(`окно показано через ${Date.now() - t0} мс после старта`);
    if (process.env.YMC_SHOTS) runShots(process.env.YMC_SHOTS);
  });
  win.on("close", saveBounds);
  win.on("closed", () => {
    win = null;
  });
  win.loadURL(`${url}#k=${key}`);
}

// Smoke-режим для визуальной проверки: YMC_SHOTS=путь к JSON [{ hash?, js?, wait?, file }].
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

function control(js) {
  win?.webContents.executeJavaScript(js).catch(() => {});
}

function createTray() {
  const icon = appIcon();
  if (icon.isEmpty()) return;
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("YM Classic");
  const menu = Menu.buildFromTemplate([
    { label: "Показать", click: () => (win ? (win.show(), win.focus()) : null) },
    { type: "separator" },
    { label: "Играть / пауза", click: () => control("navigator.mediaSession && document.querySelector('.play-main')?.click()") },
    { label: "Следующий трек", click: () => control("document.querySelector('[aria-label=\"Следующий\"]')?.click()") },
    { label: "Предыдущий трек", click: () => control("document.querySelector('[aria-label=\"Предыдущий\"]')?.click()") },
    { type: "separator" },
    {
      label: "Выход",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => (win?.isVisible() && win.isFocused() ? win.hide() : (win?.show(), win?.focus())));
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  backend = await startBackend();
  log(`бэкенд готов через ${Date.now() - t0} мс`);
  createWindow(backend.url, backend.srv.key);
  createTray();
});

app.on("before-quit", () => {
  quitting = true;
  backend?.svc.store.saveNow();
});

app.on("window-all-closed", () => {
  if (quitting || process.platform !== "darwin") app.quit();
});
