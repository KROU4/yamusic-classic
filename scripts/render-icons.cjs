// Renders the logo SVGs into the PNG files the app and the installer use (Chromium does the rasterizing):
//   npx electron scripts/render-icons.cjs
// build/logo.svg → build/icon.png (1024, installer/exe/window), build/tray.svg → build/tray.png + tray@2x.png (16/32, the tray picks by screen scale),
// build/social.svg → docs/social-preview.png (1280×640, the GitHub social preview).
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const JOBS = [
  ["build/logo.svg", "build/icon.png", 1024, 1024],
  ["build/tray.svg", "build/tray.png", 16, 16],
  ["build/tray.svg", "build/tray@2x.png", 32, 32],
  ["build/social.svg", "docs/social-preview.png", 1280, 640],
];

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL("data:text/html,<!doctype html><title>icons</title>");
  for (const [src, out, w, h] of JOBS) {
    const file = path.join(root, src);
    if (!fs.existsSync(file)) continue;
    const svg = fs.readFileSync(file, "utf8");
    const url = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    // drawn on a canvas at the exact pixel size, so the screen's scale factor doesn't matter
    const data = await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = ${w};
        c.height = ${h};
        c.getContext("2d").drawImage(img, 0, 0, ${w}, ${h});
        ok(c.toDataURL("image/png"));
      };
      img.onerror = () => fail(new Error("bad svg"));
      img.src = ${JSON.stringify(url)};
    })`);
    fs.writeFileSync(path.join(root, out), Buffer.from(data.split(",")[1], "base64"));
    console.log(`${out} ${w}×${h}`);
  }
  })
  .then(
    () => app.quit(),
    (err) => {
      console.error(err);
      app.exit(1);
    },
  );
