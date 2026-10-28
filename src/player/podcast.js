// Podcast/audiobook progress: saves the position the way the official ContinuePlayingPlugin does
// (on pause/stop, on track change, every 30 s while playing) and keeps this session's progress changes for the UI.
import { signal, effect } from "@preact/signals";
import { api, dropCache } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { isEpisode, syncPayload } from "../lib/episodes.js";
import { current, playing, position, duration, resumeReady } from "./engine.js";

const SYNC_MS = 30000;

/** trackId -> { pos?, finished? } changed in this session (synced positions, marks), layered over loaded lists. */
export const episodeLocal = signal(new Map());

function setLocal(id, patch) {
  const m = new Map(episodeLocal.value);
  m.set(String(id), { ...(m.get(String(id)) || {}), ...patch });
  episodeLocal.value = m;
}

let last = null; // latest position of the current episode, taken only once its resume point was applied
let lastSent = "";
let timer = null;

function send(snap, opts) {
  if (!snap) return Promise.resolve();
  const body = syncPayload(snap.id, snap.pos, snap.dur);
  if (!body) return Promise.resolve();
  const key = `${body.trackId}:${body.positionSec}`;
  if (key === lastSent) return Promise.resolve(); // pause right after a periodic sync: nothing new
  lastSent = key;
  setLocal(body.trackId, body.finished ? { pos: 0, finished: true } : { pos: body.positionSec });
  return api.post("/podcasts/sync", body, opts).catch(() => {});
}

// track change (beforeEntityChange): the episode that was playing gets its final position
let prevId = null;
effect(() => {
  const t = current.value;
  const id = t?.id ?? null;
  if (id === prevId) return;
  prevId = id;
  if (last && last.id !== id) send(last);
  last = null;
});

// position of the current episode, armed only after the resume seek
effect(() => {
  const pos = position.value;
  const t = current.peek();
  if (!isEpisode(t) || resumeReady.value !== t.id || !(pos > 0)) return;
  last = { id: t.id, pos, dur: duration.peek() || (t.durationMs || 0) / 1000 };
});

// pause/stop -> save at once; playing -> every 30 s
effect(() => {
  const on = playing.value;
  clearTimeout(timer);
  timer = null;
  if (!on) {
    send(last);
    return;
  }
  const tick = () => {
    send(last);
    timer = setTimeout(tick, SYNC_MS);
  };
  timer = setTimeout(tick, SYNC_MS);
});

// the window is closing mid-episode: the position still reaches the server
window.addEventListener("pagehide", () => send(last, { keepalive: true }));
const finalize = window.__ymcFinalize;
window.__ymcFinalize = () => Promise.all([finalize?.(), send(last)]);

/** «Отметить прослушанным / непрослушанным»: an episode (track) or a whole podcast/book (albumId + its tracks). */
export async function markPlayed({ track, albumId, tracks = [] }, finished) {
  try {
    const r = await api.post("/podcasts/mark", track ? { trackId: track.id, finished } : { albumId, finished });
    for (const t of track ? [track] : tracks) setLocal(t.id, { pos: 0, finished });
    dropCache("/podcast");
    if (r?.skipped) toast("Тестовый режим: отметка не отправлена");
    else toast(finished ? (track ? "Отмечено как прослушанное" : "Всё отмечено как прослушанное") : "Отметка снята");
  } catch (e) {
    toast(`Не удалось: ${e.message}`);
  }
}
