// Lyrics: synced from Yandex; when missing or censored, LRCLIB (uncensored).
import { attachWords, finishWords, parseLyricsfile, parseWordTags } from "./lyrics-words.js";

/**
 * LRC parsing: "[01:23.45]line" -> { t: seconds, text }. Several timestamps per line are supported.
 * Enhanced LRC word tags ("<01:23.80>word") become { words: [{ t, end, text }] } and never leak into text.
 */
export function parseLrc(src = "") {
  const lines = [];
  for (const raw of src.replace(/^﻿/, "").split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const body = raw.replace(/\[[^\]]*\]/g, "");
    const times = stamps.map((m) => Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 ** m[3].length : 0));
    const base = times.length ? Math.min(...times) : undefined;
    const tagged = parseWordTags(body, base);
    if (!times.length) {
      // a line with word tags but no line stamp starts at its first word
      if (tagged) lines.push({ t: tagged.words[0].t, text: tagged.text, words: tagged.words });
      continue;
    }
    const text = tagged ? tagged.text : body.trim();
    for (const t of times) {
      // word tags are absolute for the first occurrence; repeats of a chorus get them shifted along
      const words = tagged?.words.map((w) => ({ t: w.t + t - base, end: w.end != null ? w.end + t - base : undefined, text: w.text }));
      lines.push(words ? { t, text, words } : { t, text });
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return lines.some((l) => l.words) ? finishWords(lines) : lines;
}

// "b***", "***", "f**k", "█" are typical traces of removed words in the text
const CENSOR_RE = /(\p{L}\*{2,}|\*{3,}|█|\[цензура\]|\[censored\])/iu;

export const isCensoredText = (text = "") => CENSOR_RE.test(text);

const LRCLIB = "https://lrclib.net/api";
const UA = "YMClassic/0.1 (https://github.com/KROU4/yamusic-classic)";

async function lrclibFetch(fetchImpl, path, query) {
  const q = new URLSearchParams(query);
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${LRCLIB}${path}?${q}`, { headers: { "User-Agent": UA } });
    // LRCLIB answers bursts with 503 ServerOverloaded: that is "try again", not "no lyrics". One retry only,
    // so a struggling server isn't hammered
    if (res.status === 503 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    if (!res.ok) return null;
    return res.json();
  }
}

/** LRCLIB's exact match (/get): one request, also used to look for word-level timings. */
export function lrclibExact(track, fetchImpl = globalThis.fetch) {
  return lrclibFetch(fetchImpl, "/get", {
    artist_name: track.artists[0]?.name || "",
    track_name: track.title,
    album_name: track.album?.title || "",
    duration: Math.round(track.durationMs / 1000),
  }).catch(() => null);
}

export async function fromLrclib(track, fetchImpl = globalThis.fetch, exactPromise = null) {
  const artist = track.artists.map((a) => a.name).join(", ");
  const mainArtist = track.artists[0]?.name || "";
  const duration = Math.round(track.durationMs / 1000);
  const exact = await (exactPromise || lrclibExact(track, fetchImpl));
  if (exact && (exact.syncedLyrics || exact.plainLyrics)) return exact;

  const list = await lrclibFetch(fetchImpl, "/search", { track_name: track.title, artist_name: mainArtist }).catch(() => null);
  if (!Array.isArray(list) || !list.length) {
    const loose = await lrclibFetch(fetchImpl, "/search", { q: `${artist} ${track.title}` }).catch(() => null);
    if (!Array.isArray(loose) || !loose.length) return null;
    return pickClosest(loose, duration);
  }
  return pickClosest(list, duration);
}

function pickClosest(list, duration) {
  const scored = list
    .filter((x) => x.syncedLyrics || x.plainLyrics)
    // word-level records win a near tie: same song, richer sync
    .map((x) => ({ x, d: Math.abs((x.duration || 0) - duration) + (x.syncedLyrics ? 0 : 5) - (x.hasWordSync ? 0.5 : 0) }))
    .sort((a, b) => a.d - b.d);
  // difference over 15 seconds: most likely a different song
  return scored.length && scored[0].d <= 15 ? scored[0].x : null;
}

function shape(source, synced, plain, parsedLines = null) {
  const lines = parsedLines || (synced ? parseLrc(synced) : []);
  return {
    source,
    synced: lines.length > 0,
    wordSync: lines.some((l) => l.words),
    lines,
    plain: plain || (lines.length ? lines.map((l) => l.text).join("\n") : ""),
  };
}

/** Word-level Lyricsfile of an LRCLIB record, when it has one (hasWordSync is the server's own flag). */
function recordWords(rec) {
  if (!rec || typeof rec.lyricsfile !== "string" || rec.hasWordSync === false) return null;
  const file = parseLyricsfile(rec.lyricsfile);
  return file?.wordSync && file.lines.length ? file : null;
}

function shapeLrclib(rec) {
  const file = recordWords(rec);
  return file ? shape("lrclib", null, rec.plainLyrics, file.lines) : shape("lrclib", rec.syncedLyrics, rec.plainLyrics);
}

/**
 * Good Yandex lines + an LRCLIB record: borrow LRCLIB's word timings when it is the same recording
 * (duration within 3 s) and most lines say the same thing; with different wording, LRCLIB's own text
 * and words are shown instead, since karaoke is the richer view of the same song.
 */
export function withWords(yandex, rec, durationSec) {
  const file = recordWords(rec);
  if (!file || Math.abs((Number(rec.duration) || 0) - durationSec) > 3) return yandex;
  const m = attachWords(yandex.lines, file.lines);
  if (m.total && m.matched / m.total >= 0.6) {
    return m.lines.some((l) => l.words) ? { ...yandex, lines: m.lines, wordSync: true, wordSource: "lrclib" } : yandex;
  }
  return shape("lrclib", null, rec.plainLyrics, file.lines);
}

const LATE = Symbol("late");
const withBudget = (promise, ms) =>
  Promise.race([promise, new Promise((r) => setTimeout(() => r(LATE), ms))]).catch(() => null);

/**
 * @param api YandexMusic
 * @param track normalized track
 * @param prefer "auto" | "yandex" | "lrclib"
 */
export async function getLyrics(api, track, { prefer = "auto", fetchImpl = globalThis.fetch, wordBudgetMs = 2000 } = {}) {
  // LRCLIB's exact lookup runs alongside Yandex: it is both the fallback for missing/censored text and the
  // only source of word timings. With prefer=yandex it is asked only when Yandex has nothing
  const exactP = prefer === "yandex" ? null : lrclibExact(track, fetchImpl);
  let yandex = null;
  if (prefer !== "lrclib" && (track.lyrics.sync || track.lyrics.text)) {
    // if the LRC wasn't returned, still try plain text
    const lrc = track.lyrics.sync ? await api.lyrics(track.id, "LRC").catch(() => null) : null;
    const txt = !lrc ? await api.lyrics(track.id, "TEXT").catch(() => null) : null;
    if (lrc) yandex = shape("yandex", lrc.text, null);
    else if (txt) yandex = shape("yandex", null, txt.text);
  }
  const censored = yandex ? isCensoredText(yandex.plain) : false;
  if (yandex && prefer === "yandex") return { ...yandex, censored };
  if (yandex && yandex.synced && !censored && prefer === "auto") {
    // a slow LRCLIB must not hold the lyrics back: past the budget Yandex lines are shown without words
    const rec = await withBudget(exactP, wordBudgetMs);
    // LRCLIB was late: words may still exist — the caller keeps this result only briefly
    if (rec === LATE) return { ...yandex, censored, wordsPending: true };
    return { ...withWords(yandex, rec, track.durationMs / 1000), censored };
  }

  const lr = await fromLrclib(track, fetchImpl, exactP).catch(() => null);
  if (lr) {
    const result = shapeLrclib(lr);
    // unsynced LRCLIB is worse than Yandex's synced lyrics that have no censorship
    if (result.synced || !yandex || censored) return { ...result, censored: false, replacedCensored: censored };
  }
  return yandex ? { ...yandex, censored } : null;
}
