// Lyrics: synced from Yandex; when missing or censored, LRCLIB (uncensored).

/** LRC parsing: "[01:23.45]line" -> { t: seconds, text }. Several timestamps per line are supported. */
export function parseLrc(src = "") {
  const lines = [];
  for (const raw of src.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      lines.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

// "b***", "***", "f**k", "█" are typical traces of removed words in the text
const CENSOR_RE = /(\p{L}\*{2,}|\*{3,}|█|\[цензура\]|\[censored\])/iu;

export const isCensoredText = (text = "") => CENSOR_RE.test(text);

const LRCLIB = "https://lrclib.net/api";
const UA = "YMClassic/0.1 (https://github.com/KROU4/yamusic-classic)";

async function lrclibFetch(fetchImpl, path, query) {
  const q = new URLSearchParams(query);
  const res = await fetchImpl(`${LRCLIB}${path}?${q}`, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  return res.json();
}

export async function fromLrclib(track, fetchImpl = globalThis.fetch) {
  const artist = track.artists.map((a) => a.name).join(", ");
  const mainArtist = track.artists[0]?.name || "";
  const duration = Math.round(track.durationMs / 1000);
  const exact = await lrclibFetch(fetchImpl, "/get", {
    artist_name: mainArtist,
    track_name: track.title,
    album_name: track.album?.title || "",
    duration,
  }).catch(() => null);
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
    .map((x) => ({ x, d: Math.abs((x.duration || 0) - duration) + (x.syncedLyrics ? 0 : 5) }))
    .sort((a, b) => a.d - b.d);
  // difference over 15 seconds: most likely a different song
  return scored.length && scored[0].d <= 15 ? scored[0].x : null;
}

function shape(source, synced, plain) {
  const lines = synced ? parseLrc(synced) : [];
  return {
    source,
    synced: lines.length > 0,
    lines,
    plain: plain || (lines.length ? lines.map((l) => l.text).join("\n") : ""),
  };
}

/**
 * @param api YandexMusic
 * @param track normalized track
 * @param prefer "auto" | "yandex" | "lrclib"
 */
export async function getLyrics(api, track, { prefer = "auto", fetchImpl = globalThis.fetch } = {}) {
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
  if (yandex && yandex.synced && !censored && prefer === "auto") return { ...yandex, censored };

  const lr = await fromLrclib(track, fetchImpl).catch(() => null);
  if (lr) {
    const result = shape("lrclib", lr.syncedLyrics, lr.plainLyrics);
    // unsynced LRCLIB is worse than Yandex's synced lyrics that have no censorship
    if (result.synced || !yandex || censored) return { ...result, censored: false, replacedCensored: censored };
  }
  return yandex ? { ...yandex, censored } : null;
}
