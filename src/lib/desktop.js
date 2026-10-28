// Мост к оболочке Electron (window.ymcDesktop из preload). В браузере всё это молча отключено.
import { effect, signal } from "@preact/signals";
import * as p from "../player/engine.js";
import { artistNames } from "./format.js";

const bridge = window.ymcDesktop || null;
export const isDesktop = !!bridge;
export const mini = signal(false);

/** Масштаб интерфейса: в приложении — зум окна, в браузере масштабом управляет сам браузер. */
export const ZOOM_STEPS = [0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.5];
const readZoom = () => {
  try {
    const v = Number(localStorage.getItem("ymc-zoom"));
    return ZOOM_STEPS.includes(v) ? v : 1;
  } catch {
    return 1;
  }
};
export const zoom = signal(readZoom());
export function setZoom(v) {
  const z = ZOOM_STEPS.includes(v) ? v : 1;
  zoom.value = z;
  bridge?.setZoom?.(z);
  try {
    localStorage.setItem("ymc-zoom", String(z));
  } catch {
    // без сохранения
  }
}
export function stepZoom(dir) {
  const i = ZOOM_STEPS.indexOf(zoom.value);
  setZoom(dir === 0 ? 1 : ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))]);
}
if (zoom.value !== 1) bridge?.setZoom?.(zoom.value);

export function setMini(value) {
  mini.value = value;
  bridge?.setMini(value);
}

function snapshot() {
  const t = p.current.peek();
  if (!t) return { playing: false };
  return {
    playing: p.playing.peek(),
    id: t.id,
    title: t.title,
    artist: artistNames(t),
    album: t.album?.title || "",
    albumId: t.albumId,
    cover: t.cover ? t.cover.replace(/\d+x\d+$/, "400x400") : null,
    durationSec: Math.round(p.duration.peek() || (t.durationMs || 0) / 1000),
    positionSec: Math.round(p.position.peek() || 0),
  };
}

// оболочка знает, что играет: кнопки на панели задач, подсказка в трее.
// Смена трека и пауза уходят сразу; перемотка — с задержкой, чтобы перетаскивание ползунка
// не засыпало оболочку сообщениями
let last = "";
let seekTimer = null;
let lastSeekGen = p.seekGen.peek();

effect(() => {
  p.current.value;
  p.playing.value;
  const seekGen = p.seekGen.value;
  if (!bridge) return;
  const state = snapshot();
  const key = JSON.stringify({ ...state, positionSec: 0 });
  if (key !== last) {
    clearTimeout(seekTimer);
    last = key;
    lastSeekGen = seekGen;
    bridge.state(state);
    return;
  }
  if (seekGen !== lastSeekGen) {
    lastSeekGen = seekGen;
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => bridge.state(snapshot()), 700);
  }
});
