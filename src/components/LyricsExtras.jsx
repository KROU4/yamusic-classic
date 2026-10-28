// Lyrics extras: karaoke (word-by-word) highlighting of the active line and the «Перевод» toggle.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api } from "../lib/api.js";
import { lyricsTranslate } from "../lib/ui.js";
import * as p from "../player/engine.js";

// words light up slightly ahead of the audio: the eye lags the ear, and timeupdate itself lags a bit
const WORD_LEAD = 0.08;

/**
 * The active line, word by word. Progress is driven by requestAnimationFrame straight from the audio clock
 * (position signal ticks only ~4 times a second, too coarse for a sweep), and written as a CSS variable
 * so the 60 fps loop never re-renders the component.
 */
export function KaraokeLine({ words }) {
  const refs = useRef([]);
  useEffect(() => {
    let raf = 0;
    const last = [];
    const tick = () => {
      const pos = p.currentTime() + WORD_LEAD;
      for (let i = 0; i < words.length; i++) {
        const el = refs.current[i];
        if (!el) continue;
        const w = words[i];
        const f = pos <= w.t ? 0 : pos >= w.end ? 1 : (pos - w.t) / (w.end - w.t);
        const v = Math.round(f * 1000) / 10;
        if (last[i] !== v) {
          last[i] = v;
          el.style.setProperty("--p", `${v}%`);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [words]);
  return (
    <span class="karaoke">
      {words.map((w, i) => (
        <span key={i} class="kw" ref={(el) => (refs.current[i] = el)}>
          {w.text}
        </span>
      ))}
    </span>
  );
}

/** Share of Cyrillic among letters: Russian lyrics don't get the translation toggle. */
function cyrillicShare(text) {
  const letters = text.match(/\p{L}/gu) || [];
  if (!letters.length) return 1;
  return letters.filter((c) => /[Ѐ-ӿ]/.test(c)).length / letters.length;
}

/** Distinct non-empty lines of a lyrics payload, in order (a repeated chorus is translated once). */
function lyricTexts(data) {
  if (!data) return [];
  const src = data.synced ? data.lines.map((l) => l.text) : (data.plain || "").split("\n");
  return [...new Set(src.map((s) => s.trim()).filter(Boolean))];
}

/**
 * Translation state for the current lyrics. Fetched only while the toggle is on, once per lyrics payload.
 * Returns { applicable, on, status, lang, of(text) }.
 */
export function useLyricsTranslation(trackId, data) {
  const on = lyricsTranslate.value;
  const texts = useMemo(() => lyricTexts(data), [data]);
  const applicable = texts.length > 0 && cyrillicShare(texts.join(" ")) < 0.5;
  const [tr, setTr] = useState({ status: "idle" });
  useEffect(() => {
    setTr({ status: "idle" });
    if (!on || !applicable) return;
    let alive = true;
    setTr({ status: "loading" });
    api
      .post("/lyrics/translate", { id: trackId, lines: texts })
      .then((d) => alive && setTr({ status: Object.keys(d.lines || {}).length ? "ok" : "none", lang: d.lang, lines: d.lines || {} }))
      .catch((e) => alive && setTr({ status: "error", error: e.message }));
    return () => {
      alive = false;
    };
  }, [on, applicable, texts]);
  return {
    applicable,
    on,
    status: tr.status,
    lang: tr.lang,
    of: (text) => (on && tr.status === "ok" && text ? tr.lines[text.trim()] || null : null),
  };
}

/** The toggle row above the lyrics; rendered only when a translation makes sense. */
export function LyricsTools({ tr }) {
  if (!tr.applicable) return null;
  return (
    <div class="lyrics-tools">
      {tr.on && tr.status === "loading" && <span class="spinner sm" aria-label="Переводим" />}
      {tr.on && tr.status === "error" && <span class="lyrics-tools-note">Перевод недоступен</span>}
      {tr.on && tr.status === "none" && <span class="lyrics-tools-note">Нечего переводить</span>}
      <button
        class={`chip ${tr.on ? "on" : ""}`}
        aria-pressed={tr.on}
        title="Машинный перевод на русский (Google Переводчик). У Яндекса и LRCLIB переводов текстов нет"
        onClick={() => (lyricsTranslate.value = !lyricsTranslate.value)}
      >
        Перевод
      </button>
    </div>
  );
}
