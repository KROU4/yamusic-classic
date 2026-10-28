// Bridge renderer -> shell. Only narrow methods are exposed, with no Node access.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("ymcDesktop", {
  /** Player state: taskbar buttons, tray. */
  state: (s) => ipcRenderer.send("ymc:state", s),
  /** Toggle the mini player. */
  setMini: (on) => ipcRenderer.send("ymc:mini", !!on),
  /** UI zoom 0.75–1.5. */
  setZoom: (f) => webFrame.setZoomFactor(Math.max(0.75, Math.min(1.5, Number(f) || 1))),
  /** Window visibility (minimized / in the tray) — to pause purely visual work. */
  onVisibility: (cb) => ipcRenderer.on("ymc:visibility", (_e, visible) => cb(!!visible)),
});
