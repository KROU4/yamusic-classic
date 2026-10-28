// Курирование выдачи волны: убираем повторы, которые официальный клиент пропускает.
// Чистые функции, состояние передаётся явно — так их легко тестировать.

const DAY = 24 * 60 * 60 * 1000;

// Маркеры «переделок» одной и той же песни, которыми забита выдача волны
const REWORK_WORDS = [
  "slowed",
  "slow",
  "sped up",
  "speed up",
  "spedup",
  "reverb",
  "remix",
  "rmx",
  "hardtekk",
  "hardstyle",
  "tekk",
  "nightcore",
  "bass boost",
  "bassboost",
  "bass boosted",
  "phonk",
  "edit",
  "tiktok",
  "version",
  "mix",
  "8d",
  "super slowed",
  "ultra slowed",
  "extended",
];
const REWORK_RE = new RegExp(`\\b(${REWORK_WORDS.map((w) => w.replace(/\s+/g, "\\s*")).join("|")})\\b`, "i");

/** Базовое название песни без пометок о переделке: «Song (Slowed + Reverb)» -> «song». */
export function baseTitle(title = "", version = "") {
  let s = `${title}`.toLowerCase();
  // убираем скобки, если внутри есть маркер переделки
  s = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (m, inner) => (REWORK_RE.test(inner) ? " " : m));
  // «Song - Sped Up», «Song x Something (hardtekk)»
  s = s.replace(/\s[-–—]\s.*$/, (m) => (REWORK_RE.test(m) ? " " : m));
  if (version && REWORK_RE.test(version)) version = "";
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return s;
}

// Эти маркеры однозначны даже в самом названии; остальные (mix, edit, slow…) — только в пометках
const STRONG_REWORK_RE = /\b(slowed|sped\s*up|speed\s*up|hardtekk|nightcore|bass\s*boost(ed)?|reverb)\b/i;

/** Пометки трека: содержимое скобок, хвост после тире и поле version. */
function decorations(track) {
  const title = track.title || "";
  const parts = [...title.matchAll(/[([{]([^)\]}]*)[)\]}]/g)].map((m) => m[1]);
  const dash = title.match(/\s[-–—]\s(.*)$/);
  if (dash) parts.push(dash[1]);
  if (track.version) parts.push(track.version);
  return parts;
}

export function isRework(track) {
  if (STRONG_REWORK_RE.test(track.title || "")) return true;
  return decorations(track).some((p) => REWORK_RE.test(p));
}

export const songKey = (t) => `${(t.artists?.[0]?.name || "").toLowerCase()}|${baseTitle(t.title, t.version)}`;

export const DEFAULT_CURATION = {
  repeatWindowDays: 14, // не повторять трек, сыгранный за последние N дней
  artistGap: 5, // минимум треков между двумя треками одного исполнителя
  likedEvery: 8, // не чаще одного лайкнутого трека на N (0 = лайкнутые не пропускать)
  skipReworks: false, // выкидывать slowed/sped up/hardtekk-переделки
  dedupeSongs: true, // одна песня в разных версиях считается повтором
};

/**
 * @param candidates нормализованные треки от волны
 * @param ctx { history: Map<id, ts>, songHistory: Map<songKey, ts>, recent: Track[] (последние сыгранные, новые в конце),
 *              liked: Set<id>, disliked: Set<id>, settings, now }
 * @returns { accepted: Track[], rejected: {track, reason}[] }
 */
export function curate(candidates, ctx) {
  const s = { ...DEFAULT_CURATION, ...(ctx.settings || {}) };
  const now = ctx.now ?? Date.now();
  const windowMs = s.repeatWindowDays * DAY;
  const history = ctx.history || new Map();
  const songHistory = ctx.songHistory || new Map();
  const liked = ctx.liked || new Set();
  const disliked = ctx.disliked || new Set();
  // «лента» = недавно сыгранное + уже принятое в этом проходе
  const tape = [...(ctx.recent || [])];
  const accepted = [];
  const rejected = [];
  const reject = (track, reason) => rejected.push({ track, reason });

  for (const t of candidates) {
    if (!t) continue;
    if (!t.available && !t.substituted?.available) {
      reject(t, "unavailable");
      continue;
    }
    if (disliked.has(t.id)) {
      reject(t, "disliked");
      continue;
    }
    const last = history.get(t.id);
    if (last && now - last < windowMs) {
      reject(t, "recently-played");
      continue;
    }
    if (tape.some((x) => x.id === t.id)) {
      reject(t, "duplicate");
      continue;
    }
    const key = songKey(t);
    if (s.dedupeSongs) {
      const lastSong = songHistory.get(key);
      if ((lastSong && now - lastSong < windowMs) || tape.some((x) => songKey(x) === key)) {
        reject(t, "same-song");
        continue;
      }
    }
    if (s.skipReworks && isRework(t)) {
      reject(t, "rework");
      continue;
    }
    if (s.artistGap > 0) {
      const ids = new Set(t.artists.map((a) => a.id));
      const window = tape.slice(-s.artistGap);
      if (window.some((x) => x.artists.some((a) => ids.has(a.id)))) {
        reject(t, "artist-gap");
        continue;
      }
    }
    if (liked.has(t.id)) {
      if (s.likedEvery === 0) {
        reject(t, "liked");
        continue;
      }
      const window = tape.slice(-(s.likedEvery - 1));
      if (window.some((x) => liked.has(x.id))) {
        reject(t, "liked-quota");
        continue;
      }
    }
    accepted.push(t);
    tape.push(t);
  }
  return { accepted, rejected };
}
