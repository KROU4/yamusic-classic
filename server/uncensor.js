// "Uncensored": how the restriction works in Yandex Music and what the client does about it.
//
// 1. Wave. The server receives allowExplicit. The official client sets it from the setting
//    "Adult content filtering"/kids mode; we always send true (unless disabled).
// 2. Substitution. Another track (clean version, live, cover) is returned instead of the original, and the original
//    is kept in the `substituted` field. If the original is available, we play it.
// 3. "Clean" releases (contentWarning=clean). We look for an explicit version of the same song by the same artist
//    with a close duration and substitute it.
// Nobody cuts words out of the audio on the fly: these are separate master versions from rights holders.
import { normTrack } from "./normalize.js";
import { baseTitle } from "./curate.js";

const MAX_CACHE = 5000;

export function preferOriginal(track) {
  if (track?.substituted && track.substituted.available) {
    return { ...track.substituted, replacedFrom: track.id, uncensorReason: "substituted" };
  }
  return track;
}

/** Whether the candidate fits as an explicit version of the track. */
export function isExplicitTwin(track, candidate) {
  if (!candidate || candidate.id === track.id || !candidate.explicit || !candidate.available) return false;
  const mainArtist = track.artists[0]?.id;
  if (!candidate.artists.some((a) => a.id === mainArtist)) return false;
  if (baseTitle(candidate.title) !== baseTitle(track.title)) return false;
  return Math.abs(candidate.durationMs - track.durationMs) <= 12000;
}

export class Uncensor {
  constructor(api, store) {
    this.api = api;
    this.store = store;
    this.cache = new Map(Object.entries(store?.get("uncensorCache") || {}));
  }

  async findExplicitTwin(track) {
    if (this.cache.has(track.id)) return this.cache.get(track.id);
    let twin;
    try {
      const q = `${track.artists[0]?.name || ""} ${track.title}`;
      const r = await this.api.search(q, "track", 0);
      const list = (r?.tracks?.results || []).map(normTrack).filter(Boolean);
      twin = list.find((c) => isExplicitTwin(track, c)) || null;
    } catch {
      return null; // don't cache a network error: try again next time
    }
    this.cache.set(track.id, twin ? twin.id : null);
    // cache is bounded: the oldest entries are evicted
    while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
    this.store?.set("uncensorCache", Object.fromEntries(this.cache));
    return twin ? twin.id : null;
  }

  /** Returns the track that should actually be played. */
  async resolve(track, { enabled = true } = {}) {
    if (!enabled || !track) return track;
    const original = preferOriginal(track);
    if (original !== track) return original;
    if (!track.clean) return track;
    const twinId = await this.findExplicitTwin(track);
    if (!twinId) return track;
    const [full] = await this.api.tracks([twinId]).catch(() => []);
    const twin = normTrack(full);
    return twin?.available ? { ...twin, replacedFrom: track.id, uncensorReason: "explicit-version" } : track;
  }
}
