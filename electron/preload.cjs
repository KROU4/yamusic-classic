// Мост renderer → оболочка. Наружу торчат только три узких метода, без доступа к Node.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ymcDesktop", {
  /** Состояние плеера: кнопки на панели задач, трей, Discord. */
  state: (s) => ipcRenderer.send("ymc:state", s),
  /** Переключить мини-плеер. */
  setMini: (on) => ipcRenderer.send("ymc:mini", !!on),
});
