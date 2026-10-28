// Мост к оболочке Electron (window.ymcDesktop из preload). В браузере всё это молча отключено.
import { effect, signal } from "@preact/signals";
import * as p from "../player/engine.js";
import { artistNames } from "./format.js";

const bridge = window.ymcDesktop || null;
export const isDesktop = !!bridge;
export const mini = signal(false);

export function setMini(value) {
  mini.value = value;
  bridge?.setMini(value);
}

// оболочка знает, что играет: кнопки на панели задач, подсказка в трее, Discord
let last = "";
effect(() => {
  const t = p.current.value;
  const playing = p.playing.value;
  if (!bridge) return;
  const state = t
    ? {
        playing,
        id: t.id,
        title: t.title,
        artist: artistNames(t),
        album: t.album?.title || "",
        albumId: t.albumId,
        cover: t.cover ? t.cover.replace(/\d+x\d+$/, "400x400") : null,
        durationSec: Math.round(p.duration.peek() || (t.durationMs || 0) / 1000),
        positionSec: Math.round(p.position.peek() || 0),
      }
    : { playing: false };
  const key = JSON.stringify({ ...state, positionSec: 0 });
  if (key === last) return;
  last = key;
  bridge.state(state);
});
