// «Моя волна» в классическом виде: компактный блок и окно «Настроить волну» вместо колеса.
import { useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Icon } from "./Icon.jsx";
import { api } from "../lib/api.js";
import { artistNames } from "../lib/format.js";
import * as p from "../player/engine.js";

const OPTIONS = {
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
const LABELS = { diversity: "Характер", moodEnergy: "Настроение", language: "Язык" };

export const waveSettings = signal(null);

export async function loadWaveSettings() {
  if (waveSettings.value) return waveSettings.value;
  const r = await api.get("/wave");
  waveSettings.value = r.current;
  return r.current;
}

function Equalizer({ active }) {
  return (
    <span class={`eq ${active ? "on" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function Settings({ onClose }) {
  const cur = waveSettings.value || { diversity: "default", moodEnergy: "all", language: "any" };
  const [draft, setDraft] = useState(cur);
  const apply = () => {
    waveSettings.value = draft;
    onClose();
    p.playWave({ settings: draft });
  };
  const reset = () => setDraft({ diversity: "default", moodEnergy: "all", language: "any" });
  return (
    <div class="wave-settings" role="dialog" aria-label="Настроить волну">
      <div class="ws-head">
        <h3>Настроить волну</h3>
        <button class="icon-btn" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size={18} />
        </button>
      </div>
      {Object.entries(OPTIONS).map(([key, opts]) => (
        <div class="ws-group" key={key}>
          <div class="ws-label">{LABELS[key]}</div>
          <div class="chips">
            {opts.map(([value, label]) => (
              <button key={value} class={`chip ${draft[key] === value ? "on" : ""}`} onClick={() => setDraft({ ...draft, [key]: value })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p class="ws-note">«Незнакомое» и включённый анти-повтор (Настройки) заметно разнообразят выдачу.</p>
      <div class="ws-actions">
        <button class="btn ghost" onClick={reset}>
          Сбросить
        </button>
        <button class="btn primary" onClick={apply}>
          Слушать
        </button>
      </div>
    </div>
  );
}

export function WaveBlock() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    loadWaveSettings().catch(() => {});
  }, []);
  const ctx = p.context.value;
  const isWave = ctx?.type === "wave" && ctx.stationId === "user:onyourwave";
  const active = isWave && p.playing.value;
  const t = isWave ? p.current.value : null;
  const s = waveSettings.value;
  const summary = s
    ? Object.entries(OPTIONS)
        .map(([k, opts]) => (s[k] && opts[0][0] !== s[k] ? opts.find((o) => o[0] === s[k])?.[1] : null))
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <section class={`wave-block ${active ? "is-active" : ""}`}>
      <button
        class="wave-play"
        onClick={() => (isWave ? p.toggle() : p.playWave({ settings: s || undefined }))}
        aria-label={active ? "Пауза" : "Слушать Мою волну"}
      >
        {p.loading.value && isWave && !p.playing.value ? <span class="spinner dark" /> : <Icon name={active ? "pause" : "play"} size={30} />}
      </button>
      <div class="wave-info">
        <div class="wave-title">
          Моя волна <Equalizer active={active} />
        </div>
        <div class="wave-sub">
          {t ? (
            <>
              Сейчас: <b>{t.title}</b> — {artistNames(t)}
            </>
          ) : (
            summary || "Бесконечный поток музыки по вашему вкусу"
          )}
        </div>
      </div>
      <div class="wave-actions">
        {isWave && (
          <button class="btn ghost" onClick={() => p.playWave({ settings: s || undefined })} title="Перезапустить волну с новыми треками">
            Встряхнуть
          </button>
        )}
        <button class="btn ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="settings" size={16} /> Настроить
        </button>
      </div>
      {open && <Settings onClose={() => setOpen(false)} />}
    </section>
  );
}

/** Сетка станций: круглые цветные иконки жанров/настроений, как на старой странице «Радио». */
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
              {on && p.playing.value && <span class="station-playing"><Icon name="pause" size={18} /></span>}
            </span>
            <span class="station-name">{st.name}</span>
          </button>
        );
      })}
    </div>
  );
}
