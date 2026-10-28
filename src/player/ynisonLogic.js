// Pure decisions for Ynison sync (no DOM, no signals): what to apply from the shared state, what to publish.
// `v` is the backend's view (/api/ynison/state): ids, index, paused, progressMs, durationMs, speed, at.

export const WINDOW = 100; // the backend publishes ±100 tracks around the current one

/** Shared position now, extrapolated from the view's snapshot time. Milliseconds. */
export function sharedProgressNow(v, now = Date.now()) {
  if (!v) return 0;
  if (v.paused) return v.progressMs || 0;
  const x = (v.progressMs || 0) + Math.max(0, now - (v.at || now)) * (v.speed || 1);
  return v.durationMs > 0 ? Math.min(x, v.durationMs) : x;
}

/** The slice of the local queue the backend would publish. */
export function windowIds(ids, index) {
  const start = Math.max(0, index - WINDOW);
  return { ids: ids.slice(start, index + WINDOW), index: index - start };
}

/** Local queue already is the shared one (same catalogue tracks, same current track). */
export function queueMatches(localIds, localIndex, v) {
  if (!v || !Array.isArray(v.ids) || localIndex < 0) return false;
  const shared = v.ids.filter(Boolean);
  const w = windowIds(localIds, localIndex);
  if (shared.length !== w.ids.length) return false;
  for (let i = 0; i < shared.length; i++) if (shared[i] !== w.ids[i]) return false;
  return (v.ids[v.index] ?? null) === (localIds[localIndex] ?? null);
}

/** Same tracks, possibly another current one: position of the shared current track in the local queue, else -1. */
export function sameListIndex(localIds, localIndex, v) {
  if (!v || !Array.isArray(v.ids)) return -1;
  const shared = v.ids.filter(Boolean);
  const w = windowIds(localIds, Math.max(0, localIndex));
  if (shared.length !== w.ids.length || shared.some((id, i) => id !== w.ids[i])) return -1;
  const cur = v.ids[v.index];
  if (!cur) return -1;
  // the shared index counts non-track items too: count catalogue tracks before it
  const pos = v.ids.slice(0, v.index).filter(Boolean).length;
  const start = Math.max(0, localIndex - WINDOW);
  return localIds[start + pos] === cur ? start + pos : -1;
}

/**
 * What to do locally to follow a status another device sent while we are the active player.
 * local: { hasTrack, playing, loading, position (s) }. Returns { toggle?, seekTo? (s) }.
 */
export function statusPlan(local, v, now = Date.now()) {
  const plan = {};
  if (local.hasTrack) {
    if (v.paused && local.playing) plan.toggle = true;
    else if (!v.paused && !local.playing && !local.loading) plan.toggle = true;
  }
  const target = sharedProgressNow(v, now) / 1000;
  // receivers ignore sub-second drift, as the official client does
  if (local.hasTrack && Math.abs((local.position || 0) - target) > 1.5) plan.seekTo = target;
  return plan;
}

/** Whether our local status differs enough from the shared one to be worth publishing (±2 s, like the official client). */
export function statusDiffers(local, v, now = Date.now()) {
  if (!v) return true;
  if (!!v.paused !== !local.playing) return true;
  if (Math.abs(sharedProgressNow(v, now) - local.positionMs) > 2000) return true;
  return local.durationMs > 0 && Math.abs((v.durationMs || 0) - local.durationMs) > 2000;
}

/** Local playback context for a queue taken over from another device. */
export function contextFor(r) {
  const base = { title: r.title || "С другого устройства", ...(r.from ? { from: r.from } : {}) };
  const id = String(r.entityId || "");
  if (r.entityType === "RADIO" && /^[\w.-]+:[\w.-]+$/.test(id)) {
    // when these tracks run out, the engine starts a fresh wave on the same station
    return { ...base, resumeWave: true, stationId: id };
  }
  if (r.entityType === "ALBUM" && /^\d+$/.test(id)) return { ...base, link: `/album/${id}` };
  if (r.entityType === "ARTIST" && /^\d+$/.test(id)) return { ...base, link: `/artist/${id}` };
  const pl = /^([\w.-]+):(\d+)$/.exec(id);
  if (r.entityType === "PLAYLIST" && pl) return { ...base, link: `/playlist/${pl[1]}/${pl[2]}` };
  return base;
}

/** Icon for a Ynison device type. */
export function deviceIcon(type) {
  if (/^(ANDROID|IOS|ANDROID_WEAR)$/.test(type)) return "phone";
  if (type === "SMART_SPEAKER") return "speaker";
  if (/TV$/.test(type)) return "tv";
  if (/^(WEB|WEB_DESKTOP)$/.test(type)) return "desktop";
  return "devices";
}
