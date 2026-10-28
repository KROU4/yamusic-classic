// Bridge to the Electron shell (window.ymcDesktop from preload). In the browser all of this is silently disabled.
import { effect, signal } from "@preact/signals";
import * as p from "../player/engine.js";
import { artistNames } from "./format.js";

const bridge = window.ymcDesktop || null;
export const isDesktop = !!bridge;
export const mini = signal(false);

/** Interface zoom: in the app — window zoom, in the browser the browser itself handles zoom. */
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
  // the mini player has a fixed window size and always stays at 100%
  if (!mini.peek()) bridge?.setZoom?.(z);
  try {
    localStorage.setItem("ymc-zoom", String(z));
  } catch {
    // without persistence
  }
}
export function stepZoom(dir) {
  const i = ZOOM_STEPS.indexOf(zoom.value);
  setZoom(dir === 0 ? 1 : ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))]);
}
if (zoom.value !== 1) bridge?.setZoom?.(zoom.value);

/** Whether the window is on screen (not minimized, not in the tray). Always true in the browser. */
export const windowVisible = signal(true);
bridge?.onVisibility?.((v) => (windowVisible.value = v));

export function setMini(value) {
  mini.value = value;
  // zoom would crop the fixed-size mini player; the chosen zoom comes back with the full window
  bridge?.setZoom?.(value ? 1 : zoom.peek());
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

// the shell knows what's playing: taskbar buttons, tray tooltip.
// Track changes and pause are sent immediately; seeking — with a delay, so dragging the slider
// doesn't flood the shell with messages
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
