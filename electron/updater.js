// Updates from GitHub Releases.
// Installed build (NSIS): electron-updater downloads the new version in the background and installs it
// on restart (or when the user presses «Перезапустить»). Portable build: it cannot replace itself, so we
// only check the latest release and offer the download page.
import { app, shell } from "electron";
import updaterPkg from "electron-updater";
import { newerVersion } from "./version.js";

const { autoUpdater } = updaterPkg;
const REPO = "KROU4/yamusic-classic";
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

export function createUpdater({ send, log, enabled }) {
  const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
  let state = { status: "idle", version: null, current: app.getVersion(), portable, url: RELEASES };
  let timer = null;
  let startTimer = null;
  let armed = null; // last effective "automatic checks" value: prefs saves that don't change it re-arm nothing
  let downloaded = false; // an installer is waiting: later checks or errors must not hide the restart button
  const set = (patch) => {
    state = { ...state, ...patch };
    send(state);
  };

  if (!portable) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: () => {}, warn: (m) => log("update:", m), error: (m) => log("update error:", m), debug: () => {} };
    autoUpdater.on("checking-for-update", () => set({ status: "checking" }));
    autoUpdater.on("update-available", (i) => set({ status: "downloading", version: i.version, percent: 0 }));
    autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded", (i) => {
      downloaded = true;
      set({ status: "ready", version: i.version });
    });
    autoUpdater.on("update-not-available", () => set({ status: "latest" }));
    autoUpdater.on("error", (e) => (downloaded ? set({ status: "ready" }) : set({ status: "error", error: String(e?.message || e).slice(0, 200) })));
  }

  async function checkPortable() {
    set({ status: "checking" });
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
      const rel = await r.json();
      if (newerVersion(rel.tag_name, app.getVersion())) set({ status: "available", version: String(rel.tag_name).replace(/^v/, ""), url: rel.html_url || RELEASES });
      else set({ status: "latest" });
    } catch (e) {
      set({ status: "error", error: String(e.message).slice(0, 200) });
    }
  }

  function check() {
    // a dev run (electron .) has no app-update.yml and nothing to update
    if (!app.isPackaged) return set({ status: "dev" });
    if (portable) return checkPortable();
    if (downloaded) return set({ status: "ready" });
    autoUpdater.checkForUpdates().catch((e) => set({ status: "error", error: String(e.message).slice(0, 200) }));
  }

  return {
    get state() {
      return state;
    },
    check,
    /** Applies automatic checks: soon after start and then every few hours. */
    schedule(on) {
      const want = !!on && enabled;
      if (want === armed) return;
      armed = want;
      clearTimeout(startTimer);
      clearInterval(timer);
      startTimer = timer = null;
      if (!portable) autoUpdater.autoDownload = want; // turning updates off also stops background downloads
      if (!want) return;
      startTimer = setTimeout(check, 15_000);
      timer = setInterval(check, CHECK_EVERY);
    },
    install() {
      if (portable) return shell.openExternal(state.url || RELEASES);
      if (downloaded) autoUpdater.quitAndInstall(false, true);
    },
  };
}
