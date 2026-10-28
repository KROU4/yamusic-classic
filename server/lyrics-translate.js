// Lyrics translation. Neither Yandex nor LRCLIB serves translated lyrics (the lyrics endpoint ignores
// translation/lang params and the official client has no such view), so this is machine translation,
// requested only when the user turns «Перевод» on, and labelled as such in the UI.
// Google's keyless "gtx" endpoint: one request per ~4.5K chars, lines joined with "\n" and split back.

const GTX = "https://translate.googleapis.com/translate_a/single";
const CHUNK_CHARS = 4500;
const MAX_LINES = 400;
const MAX_LINE = 500;

/** Cyrillic share among letters: lyrics already in Russian need no translation toggle. */
export function cyrillicShare(text = "") {
  const letters = text.match(/\p{L}/gu) || [];
  if (!letters.length) return 0;
  return letters.filter((c) => /[Ѐ-ӿ]/.test(c)).length / letters.length;
}

/** Groups lines into requests under the size limit; a line never gets split across requests. */
export function chunkLines(lines, max = CHUNK_CHARS) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const l of lines) {
    if (cur.length && size + l.length + 1 > max) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * gtx response: [[["перевод\n", "source\n", ...], ...], null, "en", ...] -> { text, lang }.
 * Segments are sentences, not lines, so the full text is rebuilt and split on "\n" by the caller.
 */
export function parseGtx(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  let text = "";
  for (const seg of data[0]) if (Array.isArray(seg) && typeof seg[0] === "string") text += seg[0];
  const lang = typeof data[2] === "string" ? data[2] : null;
  return text ? { text, lang } : null;
}

/**
 * Translates distinct lyric lines -> { lang, lines: { [original]: translation } }.
 * A chunk that comes back with a different line count is dropped (misaligned lines are worse than none).
 */
export async function translateLines(input, { target = "ru", fetchImpl = globalThis.fetch } = {}) {
  const lines = [...new Set((Array.isArray(input) ? input : []).filter((l) => typeof l === "string").map((l) => l.trim().slice(0, MAX_LINE)).filter(Boolean))].slice(0, MAX_LINES);
  const out = {};
  let lang = null;
  for (const chunk of chunkLines(lines)) {
    const res = await fetchImpl(`${GTX}?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ q: chunk.join("\n") }).toString(),
    });
    if (!res.ok) throw new Error(`Переводчик ответил ${res.status}`);
    const parsed = parseGtx(await res.json());
    if (!parsed) continue;
    lang = lang || parsed.lang;
    const back = parsed.text.replace(/\n$/, "").split("\n");
    if (back.length !== chunk.length) continue;
    chunk.forEach((l, k) => {
      const tr = back[k].trim();
      if (tr && tr !== l) out[l] = tr;
    });
  }
  return { lang, target, lines: out };
}
