// Bridge renderer -> shell. Only narrow methods are exposed, with no Node access.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("ymcDesktop", {
  /** Player state: taskbar buttons, tray. */
  state: (s) => ipcRenderer.send("ymc:state", s),
  /** Toggle the mini player. */
  setMini: (on) => ipcRenderer.send("ymc:mini", !!on),
  /** UI zoom 0.75–1.5. */
  setZoom: (f) => webFrame.setZoomFactor(Math.max(0.75, Math.min(1.5, Number(f) || 1))),
  /** Updates from GitHub Releases: state stream, current state, manual check, install/download. */
  onUpdate: (cb) => ipcRenderer.on("ymc:update", (_e, st) => cb(st)),
  updateState: () => ipcRenderer.invoke("ymc:update-state"),
  checkUpdate: () => ipcRenderer.send("ymc:update-check"),
  installUpdate: () => ipcRenderer.send("ymc:update-install"),
  /** Native dialog to choose an audio file; resolves to its path or null. */
  pickAudioFile: () => ipcRenderer.invoke("ymc:pick-audio"),
  /** Window visibility (minimized / in the tray) — to pause purely visual work. */
  onVisibility: (cb) => ipcRenderer.on("ymc:visibility", (_e, visible) => cb(!!visible)),
});
