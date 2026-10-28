// Bottom player bar: track on the left, controls and progress in the center, extra buttons on the right.
import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Icon } from "./Icon.jsx";
import { ExplicitBadge, Artists } from "./TrackList.jsx";
import { seconds } from "../lib/format.js";
import { href } from "../lib/router.js";
import { nowPlayingOpen } from "../lib/ui.js";
import { isDesktop, setMini } from "../lib/desktop.js";
import { EqButton } from "./Equalizer.jsx";
import * as p from "../player/engine.js";

export const panel = signal(null); // null | "lyrics" | "queue"
export const togglePanel = (name) => (panel.value = panel.value === name ? null : name);

export function Progress() {
  const bar = useRef(null);
  const [hover, setHover] = useState(null);
  const dur = p.duration.value || 0;
  const pos = p.position.value || 0;
  const pct = dur ? (pos / dur) * 100 : 0;
  const buf = dur ? Math.min(100, (p.buffered.value / dur) * 100) : 0;
  const at = (e) => {
    const r = bar.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
  };
  const onDown = (e) => {
    if (!dur) return;
    p.seek(at(e));
    const move = (ev) => p.seek(at(ev));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      class="progress"
      ref={bar}
      onPointerDown={onDown}
      onPointerMove={(e) => dur && setHover({ x: e.clientX - bar.current.getBoundingClientRect().left, t: at(e) })}
      onPointerLeave={() => setHover(null)}
      role="slider"
      aria-label="Позиция трека"
      aria-valuemin={0}
      aria-valuemax={Math.round(dur)}
      aria-valuenow={Math.round(pos)}
    >
      <div class="progress-buf" style={{ width: `${buf}%` }} />
      <div class="progress-fill" style={{ width: `${pct}%` }} />
      {hover && (
        <div class="progress-tip" style={{ left: `${hover.x}px` }}>
          {seconds(hover.t)}
        </div>
      )}
    </div>
  );
}

export function Volume() {
  const ref = useRef(null);
  const v = p.muted.value ? 0 : p.volume.value;
  const set = (e) => {
    const r = ref.current.getBoundingClientRect();
    p.setVolume((e.clientX - r.left) / r.width);
  };
  const onDown = (e) => {
    set(e);
    const up = () => {
      window.removeEventListener("pointermove", set);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", set);
    window.addEventListener("pointerup", up);
  };
  return (
    <div class="volume">
      <button class="icon-btn" onClick={p.toggleMute} aria-label={p.muted.value ? "Включить звук" : "Выключить звук"}>
        <Icon name={v === 0 ? "mute" : "volume"} />
      </button>
      <div
        class="volume-bar"
        ref={ref}
        onPointerDown={onDown}
        onWheel={(e) => p.setVolume(p.volume.value + (e.deltaY < 0 ? 0.05 : -0.05))}
        role="slider"
        aria-label="Громкость"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
      >
        <div class="volume-fill" style={{ width: `${v * 100}%` }} />
      </div>
    </div>
  );
}

const SLEEP_OPTIONS = [
  [15, "15 минут"],
  [30, "30 минут"],
  [45, "45 минут"],
  [60, "1 час"],
  [90, "1,5 часа"],
  ["track", "До конца трека"],
];

/** Sleep timer: moon button with a dropdown list. */
function SleepTimer() {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const st = p.sleepTimer.value;
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !box.current?.contains(e.target) && setOpen(false);
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  // refresh the remaining time every 15 seconds while the timer is active
  useEffect(() => {
    if (st?.mode !== "time") return;
    const id = setInterval(() => tick((x) => x + 1), 15000);
    return () => clearInterval(id);
  }, [st]);
  const left = st?.mode === "time" ? Math.max(1, Math.ceil((st.at - Date.now()) / 60000)) : null;
  const label = st ? (st.mode === "track" ? "Таймер сна: до конца трека" : `Таймер сна: ${left} мин`) : "Таймер сна";
  return (
    <div class="popover-wrap" ref={box}>
      <button class={`icon-btn ${st ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label={label} title={label} aria-expanded={open}>
        <Icon name="moon" />
        {left != null && <span class="icon-badge">{left}</span>}
      </button>
      {open && (
        <div class="popover" role="menu">
          <div class="popover-title">Остановить музыку</div>
          {SLEEP_OPTIONS.map(([v, l]) => (
            <button
              key={v}
              class="menu-item"
              role="menuitem"
              onClick={() => {
                p.setSleepTimer(v);
                setOpen(false);
              }}
            >
              {l}
            </button>
          ))}
          {st && (
            <>
              <div class="menu-sep" />
              <button
                class="menu-item danger"
                role="menuitem"
                onClick={() => {
                  p.setSleepTimer(null);
                  setOpen(false);
                }}
              >
                Выключить таймер
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PlayerBar() {
  const t = p.current.value;
  const ctx = p.context.value;
  const st = p.stream.value;
  const liked = p.isLiked(t);
  return (
    <footer class={`player ${t ? "" : "is-empty"}`}>
      <div class="player-track">
        {t ? (
          <>
            <button class="player-cover" onClick={() => (nowPlayingOpen.value = true)} aria-label="Открыть «Сейчас играет»" title="Сейчас играет">
              {t.cover ? <img src={t.cover} alt="" /> : <div class="ph" />}
              <span class="player-cover-hint">
                <Icon name="expand" size={18} />
              </span>
            </button>
            <div class="player-meta">
              <div class="player-title">
                <span class="t">{t.title}</span>
                {t.version && <span class="v">{t.version}</span>}
                {t.explicit && <ExplicitBadge />}
              </div>
              <Artists track={t} />
            </div>
            <button class={`icon-btn like ${liked ? "on" : ""}`} onClick={() => p.like(t)} aria-label="Мне нравится">
              <Icon name={liked ? "heart" : "heartOutline"} />
            </button>
            <button class={`icon-btn ${p.isDisliked(t) ? "on-bad" : ""}`} onClick={() => p.dislike(t)} aria-label="Не нравится" title="Не нравится — и не предлагать">
              <Icon name="ban" />
            </button>
          </>
        ) : (
          <div class="player-hint">Включите «Мою волну» или любой трек</div>
        )}
      </div>

      <div class="player-center">
        <div class="player-controls">
          <button class={`icon-btn ${p.shuffle.value ? "on" : ""}`} onClick={p.toggleShuffle} aria-label="Перемешать" title="Перемешивать">
            <Icon name="shuffle" />
          </button>
          <button class="icon-btn" onClick={p.prev} aria-label="Предыдущий" disabled={!t}>
            <Icon name="prev" size={24} />
          </button>
          <button class="play-main" onClick={() => (t ? p.toggle() : p.playWave())} aria-label={p.playing.value ? "Пауза" : "Играть"}>
            {p.loading.value && !p.playing.value ? <span class="spinner" /> : <Icon name={p.playing.value ? "pause" : "play"} size={24} />}
          </button>
          <button class="icon-btn" onClick={() => p.next()} aria-label="Следующий" disabled={!t}>
            <Icon name="next" size={24} />
          </button>
          <button
            class={`icon-btn ${p.repeat.value !== "none" ? "on" : ""}`}
            onClick={p.cycleRepeat}
            aria-label="Повтор"
            title={{ none: "Повтор выключен", all: "Повторять всё", one: "Повторять трек" }[p.repeat.value]}
          >
            <Icon name={p.repeat.value === "one" ? "repeatOne" : "repeat"} />
          </button>
        </div>
        <div class="player-progress">
          <span class="player-time">{t ? seconds(p.position.value) : ""}</span>
          <Progress />
          <span class="player-time end">{t ? seconds(p.duration.value) : ""}</span>
        </div>
      </div>

      <div class="player-extra">
        {ctx && (
          <span class="player-ctx" title={ctx.title}>
            {ctx.type === "wave" ? <Icon name="wave" size={16} /> : null}
            {ctx.link ? <a href={href(ctx.link)}>{ctx.title}</a> : ctx.title}
          </span>
        )}
        {st && (
          <span
            class={`player-quality ${st.quality === "lossless" ? "hq" : ""}`}
            title={st.codec === "local" ? "Играет ваш файл вместо звука Яндекса" : `${st.codec}, ${st.bitrate} кбит/с`}
          >
            {st.codec === "local" ? "Свой файл" : st.codec === "flac" || st.codec === "flac-mp4" ? "FLAC" : `${st.bitrate}`}
          </span>
        )}
        {p.rate.value !== 1 && (
          <button class="player-quality rate" onClick={() => p.setRate(1)} title="Скорость воспроизведения. Нажмите, чтобы вернуть обычную">
            {String(p.rate.value).replace(".", ",")}×
          </button>
        )}
        <button class={`icon-btn ${panel.value === "lyrics" ? "on" : ""}`} onClick={() => togglePanel("lyrics")} aria-label="Текст песни" title="Текст песни" disabled={!t}>
          <Icon name="lyrics" />
        </button>
        <button class={`icon-btn ${panel.value === "queue" ? "on" : ""}`} onClick={() => togglePanel("queue")} aria-label="Очередь" title="Очередь">
          <Icon name="queue" />
        </button>
        <EqButton />
        <SleepTimer />
        {isDesktop && (
          <button class="icon-btn" onClick={() => setMini(true)} aria-label="Мини-плеер" title="Мини-плеер поверх окон">
            <Icon name="mini" />
          </button>
        )}
        <Volume />
      </div>
    </footer>
  );
}
