// Local replacement files: the user's own audio played instead of a track (e.g. an uncensored copy
// when Yandex edited the master itself). Desktop only: the file is chosen in a native dialog.
import { signal } from "@preact/signals";
import { api } from "./api.js";
import { toast } from "./toast.js";
import * as player from "../player/engine.js";

const bridge = window.ymcDesktop || null;
export const canReplace = !!bridge?.pickAudioFile;

/** trackId -> { path, name } */
export const overrides = signal({});

export function loadOverrides() {
  return api
    .get("/overrides")
    .then((o) => (overrides.value = o || {}))
    .catch(() => {});
}

export async function replaceWithFile(track) {
  const file = await bridge.pickAudioFile();
  if (!file) return;
  try {
    const o = await api.post("/overrides", { trackId: track.id, path: file });
    overrides.value = { ...overrides.value, [track.id]: o };
    player.forgetResolved(track.id);
    toast(`«${track.title}» будет играть из файла ${o.name}`);
  } catch (e) {
    toast(e.message);
  }
}

export async function restoreYandexAudio(track) {
  try {
    await api.post("/overrides/remove", { trackId: track.id });
    const next = { ...overrides.value };
    delete next[track.id];
    overrides.value = next;
    player.forgetResolved(track.id);
    toast("Снова играет звук Яндекса");
  } catch (e) {
    toast(e.message);
  }
}
