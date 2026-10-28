// «Моя волна» в духе Яндекс Музыки 2023–2024: большой блок с генеративной анимацией,
// «▶ Моя волна» по центру и настройки по занятию, характеру, настроению и языку. Без колеса.
import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Icon } from "./Icon.jsx";
import { VibeCanvas, paletteFor } from "./VibeCanvas.jsx";
import { api } from "../lib/api.js";
import { artistNames } from "../lib/format.js";
import { isPinned, togglePin } from "../lib/pins.js";
import { toast } from "../lib/toast.js";
import * as p from "../player/engine.js";

export const DEFAULT_SETTINGS = { activity: "any", diversity: "default", moodEnergy: "all", language: "any" };

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

export const waveSettings = signal(null);

export async function loadWaveSettings() {
  if (waveSettings.value) return waveSettings.value;
  const r = await api.get("/wave");
  waveSettings.value = { ...DEFAULT_SETTINGS, ...(r.current || {}) };
  return waveSettings.value;
}

/** Короткая подпись настроек: «Тренируюсь · Бодрое». Пусто — настройки по умолчанию. */
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
  const ctx = p.context.value;
  const waveOn = ctx?.type === "wave" && ctx.stationId === "user:onyourwave";
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    const onDown = (e) => !box.current?.contains(e.target) && !e.target.closest?.(".vibe-tune") && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      clearTimeout(timer.current);
    };
  }, []);
  // как в оригинале: выбор сразу перестраивает играющую волну (с паузой на случай нескольких кликов подряд)
  const set = (next) => {
    waveSettings.value = next;
    clearTimeout(timer.current);
    if (waveOn) timer.current = setTimeout(() => p.playWave({ settings: next }), 450);
  };
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
        {!waveOn && (
          <button
            class="btn primary"
            onClick={() => {
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
  // лайк текущего трека волны — вспышка анимации, как в официальном клиенте
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
      <VibeCanvas colors={paletteFor(s)} active={isWave} pulseAt={pulseAt} />
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

/** Сетка станций: круглые цветные иконки жанров, настроений и занятий. */
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
