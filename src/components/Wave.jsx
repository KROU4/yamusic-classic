// My Wave in the spirit of Yandex Music 2023–2024: a large block with generative animation,
// a centered «▶ Моя волна» and settings by activity, character, mood and language. No wheel.
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { VibeCanvas, paletteFor } from "./VibeCanvas.jsx";
import { api } from "../lib/api.js";
import { artistNames } from "../lib/format.js";
import { isPinned, togglePin } from "../lib/pins.js";
import { toast } from "../lib/toast.js";
import { nowPlayingOpen } from "../lib/ui.js";
import { waveSettings, setWaveSettings, DEFAULT_WAVE_SETTINGS as DEFAULT_SETTINGS } from "../player/waveState.js";
import * as p from "../player/engine.js";

export { DEFAULT_SETTINGS };

export const OPTIONS = {
  activity: [
    ["any", "Любое"],
    ["wake-up", "Просыпаюсь"],
    ["workout", "Тренируюсь"],
    ["road-trip", "В дороге"],
    ["work-background", "Работаю"],
    ["study-background", "Учусь"],
    ["party", "Вечеринка"],
    ["fall-asleep", "Засыпаю"],
  ],
  diversity: [
    ["default", "Любое"],
    ["favorite", "Любимое"],
    ["discover", "Незнакомое"],
    ["popular", "Популярное"],
  ],
  moodEnergy: [
    ["all", "Любое"],
    ["active", "Бодрое"],
    ["fun", "Весёлое"],
    ["calm", "Спокойное"],
    ["sad", "Грустное"],
  ],
  language: [
    ["any", "Любой"],
    ["russian", "Русский"],
    ["not-russian", "Иностранный"],
    ["without-words", "Без слов"],
  ],
};
const LABELS = { activity: "Занятие", diversity: "Характер", moodEnergy: "Настроение", language: "Язык" };

export { waveSettings };

export async function loadWaveSettings() {
  if (waveSettings.value) return waveSettings.value;
  const r = await api.get("/wave");
  // a wave started meanwhile already filled the settings with what the server actually used
  if (!waveSettings.value) setWaveSettings(r.current);
  return waveSettings.value;
}

/** Short settings caption: «Тренируюсь · Бодрое». Empty means default settings. */
export function settingsSummary(s) {
  if (!s) return "";
  return Object.entries(OPTIONS)
    .map(([k, opts]) => (s[k] && opts[0][0] !== s[k] ? opts.find((o) => o[0] === s[k])?.[1] : null))
    .filter(Boolean)
    .join(" · ");
}

const isDefault = (s) => !settingsSummary(s);
export const wavePin = (s) => ({ type: "wave", title: settingsSummary(s) || "Моя волна", settings: { ...DEFAULT_SETTINGS, ...s } });

function Settings({ onClose }) {
  const cur = waveSettings.value || DEFAULT_SETTINGS;
  const box = useRef(null);
  const timer = useRef(0);
  const pending = useRef(null);
  const ctx = p.context.value;
  const waveOn = ctx?.type === "wave" && ctx.stationId === "user:onyourwave";
  const flush = () => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next) p.playWave({ settings: next });
  };
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    const onDown = (e) => !box.current?.contains(e.target) && !e.target.closest?.(".vibe-tune") && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      // closing the panel right after a click must not lose the restart
      flush();
    };
  }, []);
  // as in the original: a choice rebuilds the playing wave right away (with a delay in case of several clicks in a row).
  // A paused wave is not started by a chip click: the choice is kept and «Слушать» starts it
  const set = (next) => {
    setWaveSettings(next);
    clearTimeout(timer.current);
    pending.current = null;
    if (waveOn && p.playing.peek()) {
      pending.current = next;
      timer.current = setTimeout(flush, 450);
    }
  };
  const playingWave = waveOn && p.playing.value;
  const pinned = isPinned(wavePin(cur));
  return (
    <div class="vibe-settings" ref={box} role="dialog" aria-label="Настроить волну">
      {Object.entries(OPTIONS).map(([key, opts]) => (
        <div class="ws-group" key={key}>
          <div class="ws-label">{LABELS[key]}</div>
          <div class="chips">
            {opts.map(([value, label]) => (
              <button key={value} class={`chip ${cur[key] === value ? "on" : ""}`} onClick={() => set({ ...cur, [key]: value })} aria-pressed={cur[key] === value}>
                {key === "moodEnergy" && value !== "all" && <span class="mood-dot" style={{ background: paletteFor({ moodEnergy: value })[0] }} />}
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div class="ws-actions">
        <button class="btn ghost" onClick={() => set({ ...DEFAULT_SETTINGS })} disabled={isDefault(cur)}>
          Сбросить
        </button>
        <button
          class={`btn ghost ${pinned ? "is-on" : ""}`}
          onClick={() => toast(togglePin(wavePin(cur)) ? "Настройка закреплена в боковом меню" : "Откреплено")}
          title="Закрепить эту настройку волны в боковом меню"
        >
          <Icon name="pin" size={16} /> {pinned ? "Закреплено" : "Закрепить"}
        </button>
        {!playingWave && (
          <button
            class="btn primary"
            onClick={() => {
              pending.current = null;
              onClose();
              p.playWave({ settings: cur });
            }}
          >
            <Icon name="play" size={16} /> Слушать
          </button>
        )}
      </div>
    </div>
  );
}

export function WaveHero() {
  const [open, setOpen] = useState(false);
  const [pulseAt, setPulseAt] = useState(0);
  useEffect(() => {
    loadWaveSettings().catch(() => {});
  }, []);
  const ctx = p.context.value;
  const isWave = ctx?.type === "wave" && ctx.stationId === "user:onyourwave";
  const active = isWave && p.playing.value;
  const t = isWave ? p.current.value : null;
  const s = waveSettings.value;
  const summary = settingsSummary(s);
  // like on the current wave track — animation flash, as in the official client
  const liked = t ? p.isLiked(t) : false;
  const prevLiked = useRef(liked);
  const prevId = useRef(t?.id);
  useEffect(() => {
    if (t?.id === prevId.current && liked && !prevLiked.current) setPulseAt(performance.now());
    prevLiked.current = liked;
    prevId.current = t?.id;
  }, [liked, t?.id]);
  const start = () => (isWave ? p.toggle() : p.playWave({ settings: s || undefined }));
  return (
    <section class={`vibe ${active ? "is-active" : ""} ${open ? "is-tuning" : ""}`}>
      {/* under the full-screen Now Playing the hero is hidden — one WebGL loop at a time */}
      <VibeCanvas colors={paletteFor(s)} active={isWave} pulseAt={pulseAt} paused={nowPlayingOpen.value} />
      <div class="vibe-center">
        <button class="vibe-title" onClick={start} aria-label={active ? "Пауза" : "Слушать Мою волну"}>
          <span class="vibe-title-icon">
            {p.loading.value && isWave && !p.playing.value ? <span class="spinner" /> : <Icon name={active ? "pause" : "play"} size={30} />}
          </span>
          Моя волна
        </button>
        <div class="vibe-now">
          {t ? (
            <>
              <b>{t.title}</b> — {artistNames(t)}
            </>
          ) : (
            summary || "Бесконечный поток музыки по вашему вкусу"
          )}
        </div>
        <div class="vibe-actions">
          <button class={`vibe-tune ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
            <Icon name="sliders" size={16} /> {summary && !open ? summary : "Настроить"}
          </button>
          {isWave && (
            <button class="vibe-tune" onClick={() => p.playWave({ settings: s || undefined })} title="Перезапустить волну с новыми треками">
              <Icon name="shuffle" size={16} /> Встряхнуть
            </button>
          )}
        </div>
        {open && <Settings onClose={() => setOpen(false)} />}
      </div>
    </section>
  );
}

/** Station grid: round colored icons of genres, moods and activities. */
export function StationGrid({ stations, limit }) {
  const list = limit ? stations.slice(0, limit) : stations;
  const ctx = p.context.value;
  return (
    <div class="stations">
      {list.map((st) => {
        const on = ctx?.type === "wave" && ctx.stationId === st.id;
        return (
          <button key={st.id} class={`station ${on ? "on" : ""}`} onClick={() => (on ? p.toggle() : p.playWave({ stationId: st.id, title: st.name }))} title={`Радио «${st.name}»`}>
            <span class="station-icon" style={{ background: st.color }}>
              {st.icon && <img src={st.icon} alt="" loading="lazy" />}
              {on && p.playing.value && (
                <span class="station-playing">
                  <Icon name="pause" size={18} />
                </span>
              )}
            </span>
            <span class="station-name">{st.name}</span>
          </button>
        );
      })}
    </div>
  );
}
