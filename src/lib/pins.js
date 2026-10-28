// Pinned items in the sidebar: playlists, albums, artists and My Wave settings.
// Stored locally; order is newest first, like the Yandex Music 2023 sidebar.
import { signal } from "@preact/signals";

const KEY = "ymc-pins";
const MAX = 30;

/** Pin key: the same entity can't be pinned twice. */
export function pinKey(p) {
  switch (p.type) {
    case "playlist":
      return `playlist:${p.uid}:${p.kind}`;
    case "album":
    case "artist":
      return `${p.type}:${p.id}`;
    case "wave":
      return `wave:${["activity", "diversity", "moodEnergy", "language"].map((k) => p.settings?.[k] || "").join(":")}`;
    default:
      return `${p.type}:?`;
  }
}

const valid = (p) => p && typeof p === "object" && ["playlist", "album", "artist", "wave"].includes(p.type) && typeof p.title === "string";

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v.filter(valid).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export const pins = signal(read());

function save(list) {
  pins.value = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // without persistence
  }
}

export const isPinned = (p) => pins.value.some((x) => pinKey(x) === pinKey(p));

export function togglePin(p) {
  const key = pinKey(p);
  if (pins.value.some((x) => pinKey(x) === key)) {
    save(pins.value.filter((x) => pinKey(x) !== key));
    return false;
  }
  save([p, ...pins.value].slice(0, MAX));
  return true;
}

export function unpin(p) {
  const key = pinKey(p);
  save(pins.value.filter((x) => pinKey(x) !== key));
}

/** Refresh a pin's stored snapshot (e.g. after renaming a playlist); no-op if it isn't pinned. */
export function updatePin(p, patch) {
  const key = pinKey(p);
  if (!pins.value.some((x) => pinKey(x) === key)) return;
  save(pins.value.map((x) => (pinKey(x) === key ? { ...x, ...patch } : x)));
}

/** Reordering by drag in the sidebar. */
export function movePin(from, to) {
  const list = [...pins.value];
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  save(list);
}
