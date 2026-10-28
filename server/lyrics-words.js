// Word-level (karaoke) timings for lyrics. Yandex only serves line-level LRC, so words come from
// LRCLIB's Lyricsfile (YAML, lines[].words[] with start_ms/end_ms) or from enhanced-LRC "<mm:ss.xx>" tags.
// Line shape everywhere: { t, text, words?: [{ t, end, text }] }, times in seconds.
import { parseYaml } from "./yaml-lite.js";

// the last word of a line has no natural end when the next line is far away (instrumental break):
// cap it so the highlight finishes instead of crawling across the silence
const MAX_LAST_WORD = 3;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
const round = (x) => Math.round(x * 1000) / 1000;

/**
 * Fills in missing/broken word ends and keeps words monotonic, in place.
 * End fallback: own end -> next word start -> line end -> next line start (capped) -> +MAX_LAST_WORD.
 */
export function finishWords(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.words?.length) {
      delete line.words;
      continue;
    }
    const nextLineT = lines.slice(i + 1).find((l) => l.t > line.t)?.t;
    const ws = line.words;
    for (let k = 0; k < ws.length; k++) {
      const w = ws[k];
      if (k > 0 && w.t < ws[k - 1].t) w.t = ws[k - 1].t; // overlapping/out-of-order starts
      const next = ws[k + 1];
      let end = w.end;
      if (end == null || end <= w.t) end = next ? next.t : line.end ?? (nextLineT != null ? Math.min(nextLineT, w.t + MAX_LAST_WORD) : w.t + MAX_LAST_WORD);
      if (next && end > next.t && next.t > w.t) end = next.t; // never run into the next word
      if (end <= w.t) end = w.t + 0.05;
      w.t = round(w.t);
      w.end = round(end);
    }
    // a word starting before its line (sloppy files) pulls the line start back with it
    if (ws[0].t < line.t) line.t = ws[0].t;
    delete line.end;
  }
  return lines;
}

const TAG_RE = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const tagTime = (m) => Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 ** m[3].length : 0);

/**
 * Enhanced LRC body (after the [mm:ss] line stamps are removed): "<00:01.00>Hel <00:01.40>lo<00:02.00>".
 * A chunk before the first tag starts at the line time; a trailing tag with no text closes the last word.
 * Returns { text, words } or null when the body has no word tags.
 */
export function parseWordTags(body, lineT) {
  const tags = [...body.matchAll(TAG_RE)];
  if (!tags.length) return null;
  const words = [];
  let cursor = 0;
  let t = lineT;
  for (const m of tags) {
    const chunk = body.slice(cursor, m.index);
    const last = words[words.length - 1];
    if (chunk.trim()) words.push({ t: t ?? tagTime(m), text: chunk });
    else if (last && chunk) {
      // "<a>one<b> <c>two": the space still separates the words, and <b> is where "one" ends
      last.text += chunk;
      if (last.end == null && t > last.t) last.end = t;
    }
    else if (last && last.end == null && t > last.t) last.end = t; // back-to-back tags: the first closes the word
    t = tagTime(m);
    cursor = m.index + m[0].length;
  }
  const tail = body.slice(cursor);
  if (tail.trim()) words.push({ t, text: tail });
  else if (words.length) {
    const last = words[words.length - 1];
    if (last.end == null && t > last.t) last.end = t; // trailing "<mm:ss>" closes the last word
  }
  if (!words.length) return null;
  // words keep inner spacing (renders as-is), but the edges of the line are trimmed
  words[0].text = words[0].text.trimStart();
  words[words.length - 1].text = words[words.length - 1].text.trimEnd();
  for (const w of words) if (w.end != null && w.end <= w.t) delete w.end;
  return { text: words.map((w) => w.text).join("").replace(/\s+/g, " ").trim(), words };
}

/**
 * LRCLIB Lyricsfile v1 -> { lines, wordSync } or null (null, bad YAML or a version we don't know).
 * metadata.offset_ms follows the LRC [offset:] convention: positive = lyrics come earlier.
 */
export function parseLyricsfile(src) {
  if (typeof src !== "string" || !src.trim()) return null;
  let doc;
  try {
    doc = parseYaml(src);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.lines)) return null;
  const version = doc.version == null ? "1" : String(doc.version);
  if (!/^1(\.|$)/.test(version)) return null;
  const offset = (num(doc.metadata?.offset_ms) || 0) / 1000;
  const lines = [];
  for (const raw of doc.lines) {
    if (!raw || typeof raw !== "object") continue;
    const start = num(raw.start_ms);
    const words = [];
    if (Array.isArray(raw.words)) {
      for (const w of raw.words) {
        const ws = num(w?.start_ms);
        if (ws == null || typeof w.text !== "string" || !w.text) continue;
        const we = num(w.end_ms);
        words.push({ t: Math.max(0, (ws / 1000) - offset), end: we != null ? Math.max(0, we / 1000 - offset) : undefined, text: w.text });
      }
    }
    const text = (typeof raw.text === "string" ? raw.text : words.map((w) => w.text).join("")).trim();
    const t = start != null ? Math.max(0, start / 1000 - offset) : words[0]?.t;
    if (t == null) continue; // an unsynced line cannot be placed on the timeline
    const end = num(raw.end_ms);
    const line = { t, text };
    if (end != null && end / 1000 - offset > t) line.end = end / 1000 - offset;
    if (words.length) {
      words[0].text = words[0].text.trimStart();
      words[words.length - 1].text = words[words.length - 1].text.trimEnd();
      line.words = words;
    }
    lines.push(line);
  }
  lines.sort((a, b) => a.t - b.t);
  finishWords(lines);
  for (const l of lines) l.t = round(l.t);
  return { lines, wordSync: lines.some((l) => l.words) };
}

/** Comparable form of a lyric line: case, ё/е, punctuation, apostrophes and spacing don't matter. */
export const normLine = (s = "") =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Puts LRCLIB words onto Yandex lines that say the same thing at (nearly) the same time.
 * Each LRCLIB line is used once per occurrence; words are shifted by the line start difference so they
 * stay in step with Yandex's own line timing. `matched` counts lines whose text agrees (with or without
 * words), so a file with word sync on only some lines still proves it is the same text.
 * Returns { lines, matched, total } — lines are new objects.
 */
export function attachWords(lines, wordLines, { tolerance = 1.5 } = {}) {
  const pool = wordLines.map((l) => ({ l, key: normLine(l.text), used: false })).filter((c) => c.key);
  let matched = 0;
  let total = 0;
  const out = lines.map((line) => {
    const key = normLine(line.text);
    if (!key) return { ...line };
    total++;
    let best = null;
    for (const c of pool) {
      if (c.used || c.key !== key) continue;
      const d = Math.abs(c.l.t - line.t);
      if (d <= tolerance && (!best || d < best.d)) best = { c, d };
    }
    if (!best) return { ...line };
    best.c.used = true;
    matched++;
    if (!best.c.l.words?.length) return { ...line };
    const shift = line.t - best.c.l.t;
    return { ...line, words: best.c.l.words.map((w) => ({ t: round(w.t + shift), end: round(w.end + shift), text: w.text })) };
  });
  return { lines: out, matched, total };
}
