// Curating the wave feed: removing repeats that the official client lets through.
// Pure functions, state is passed explicitly, so they are easy to test.

const DAY = 24 * 60 * 60 * 1000;

// Markers of "reworks" of the same song that the wave feed is full of
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

/** Base song title without rework marks: "Song (Slowed + Reverb)" -> "song". */
export function baseTitle(title = "", version = "") {
  let s = `${title}`.toLowerCase();
  // strip brackets if they contain a rework marker
  s = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (m, inner) => (REWORK_RE.test(inner) ? " " : m));
  // «Song - Sped Up», «Song x Something (hardtekk)»
  s = s.replace(/\s[-–—]\s.*$/, (m) => (REWORK_RE.test(m) ? " " : m));
  if (version && REWORK_RE.test(version)) version = "";
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return s;
}

// These markers are unambiguous even in the title itself; the others (mix, edit, slow...) only in marks
const STRONG_REWORK_RE = /\b(slowed|sped\s*up|speed\s*up|hardtekk|nightcore|bass\s*boost(ed)?|reverb)\b/i;

/** Track marks: bracket contents, the tail after a dash, and the version field. */
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
  repeatWindowDays: 14, // don't repeat a track played in the last N days
  artistGap: 5, // minimum tracks between two tracks by the same artist
  likedEvery: 8, // at most one liked track per N (0 = don't skip liked)
  skipReworks: false, // drop slowed/sped up/hardtekk reworks
  dedupeSongs: true, // one song in different versions counts as a repeat
};

/**
 * @param candidates normalized tracks from the wave
 * @param ctx { history: Map<id, ts>, songHistory: Map<songKey, ts>, recent: Track[] (last played, newest at the end),
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
  // "feed" = recently played + already accepted in this pass
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
      // likedEvery=1 means no limit (slice(-0) would return the whole feed)
      const window = s.likedEvery > 1 ? tape.slice(-(s.likedEvery - 1)) : [];
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
