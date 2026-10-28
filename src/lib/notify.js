// «Уведомлять о смене трека»: a silent Windows notification with the cover while the window is in the
// background. Nothing is shown when the window has focus: the player bar already says it.
import { trackNotify } from "./ui.js";
import { artistNames } from "./format.js";
import * as p from "../player/engine.js";

let lastId = null;
let shown = null;

p.current.subscribe((t) => {
  const id = t?.id ?? null;
  const changed = id !== lastId;
  lastId = id;
  if (!t || !changed || !trackNotify.peek() || typeof Notification === "undefined") return;
  if (document.hasFocus() || Notification.permission === "denied") return;
  try {
    shown?.close(); // one notification at a time: a fast skip doesn't stack them up
    shown = new Notification(t.title || "Без названия", { body: artistNames(t), icon: t.cover || undefined, silent: true, tag: "ymc-track" });
    shown.onclick = () => window.ymcDesktop?.focus?.();
  } catch {
    // notifications are off in Windows: nothing to do
  }
});
