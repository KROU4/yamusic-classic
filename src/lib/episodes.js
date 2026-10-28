// Pure helpers for podcast episodes and audiobook chapters (no imports: shared by the UI, the player and tests).

/** Episode or chapter: the server marks them rememberPosition (the official client keys resume on this flag). */
export const isEpisode = (t) => t?.rememberPosition === true;

/** Speed steps of the official client's speed button. */
export const SPEED_STEPS = [1, 1.25, 1.5, 1.75, 2];
/** Next step after the current speed, wrapping back to 1× (any value set in Settings snaps to the next step). */
export function nextSpeed(cur) {
  const i = SPEED_STEPS.findIndex((s) => s > Number(cur) + 0.001);
  return i < 0 ? SPEED_STEPS[0] : SPEED_STEPS[i];
}

/**
 * Body for /api/podcasts/sync, or null when nothing should be sent.
 * Positions are floored like the official client; a zero position or length is never sent. The last second is
 * reported as the full length (finished): floor(position) of an ended element can lag the duration by a fraction,
 * and the end of an episode would otherwise never reach the server as "finished".
 */
export function syncPayload(trackId, pos, dur) {
  const len = Math.floor(Number(dur) || 0);
  let p = Math.floor(Number(pos) || 0);
  if (len <= 0 || p <= 0 || !trackId) return null;
  if (len - Number(pos) < 1) p = len;
  p = Math.min(p, len);
  return { trackId: String(trackId), positionSec: p, trackLengthSec: len, finished: p === len };
}

/** Progress shown in a row: local changes of this session (sync, marks) win over what the list was loaded with. */
export function progressOf(track, local) {
  const base = track?.progress || { pos: 0, finished: false };
  const pos = local && typeof local.pos === "number" ? local.pos : base.pos || 0;
  const finished = local && typeof local.finished === "boolean" ? local.finished : !!base.finished;
  const dur = (track?.durationMs || 0) / 1000;
  return { pos, finished, pct: dur > 0 && pos > 0 ? Math.min(1, pos / dur) : 0 };
}

const MONTHS = ["янв.", "февр.", "марта", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."];

/** "2026-10-23" -> «Сегодня» / «Вчера» / «23 окт.» / «23 окт. 2025» (the year only when it differs). */
export function pubDateLabel(date, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ""));
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = Date.UTC(y, mo - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  return `${d} ${MONTHS[mo - 1]}${y !== now.getFullYear() ? ` ${y}` : ""}`;
}

/** Minutes in a compact Russian form: «45 мин», «1 ч 05 мин». */
export function minutesLabel(sec) {
  const min = Math.max(1, Math.round((Number(sec) || 0) / 60));
  return min >= 60 ? `${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, "0")} мин` : `${min} мин`;
}

/** Row status: «Прослушано», «Осталось 12 мин» or the full length. */
export function statusLabel(progress, durationMs) {
  const dur = (durationMs || 0) / 1000;
  if (progress.finished && !(progress.pos > 0)) return "Прослушано";
  if (progress.pos > 0 && dur > 0) return `Осталось ${minutesLabel(dur - progress.pos)}`;
  return dur > 0 ? minutesLabel(dur) : "";
}
