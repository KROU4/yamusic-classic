// Мост renderer → оболочка. Наружу торчат только узкие методы, без доступа к Node.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("ymcDesktop", {
  /** Состояние плеера: кнопки на панели задач, трей. */
  state: (s) => ipcRenderer.send("ymc:state", s),
  /** Переключить мини-плеер. */
  setMini: (on) => ipcRenderer.send("ymc:mini", !!on),
  /** Масштаб интерфейса 0.75–1.5. */
  setZoom: (f) => webFrame.setZoomFactor(Math.max(0.75, Math.min(1.5, Number(f) || 1))),
});
