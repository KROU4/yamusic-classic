// Bottom player bar: track on the left, transport and progress in the center; on the right only what is
// used on every track (lyrics, queue, devices, volume) — everything else sits behind «Ещё».
import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Icon } from "./Icon.jsx";
import { ExplicitBadge, Artists } from "./TrackList.jsx";
import { seconds } from "../lib/format.js";
import { href } from "../lib/router.js";
import { nowPlayingOpen } from "../lib/ui.js";
import { isDesktop, setMini } from "../lib/desktop.js";
import { EqPanel } from "./Equalizer.jsx";
import { eq, webAudioSupported as webAudio } from "../player/audiograph.js";
import { DevicesButton } from "./Devices.jsx";
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
  [15, "15 мин"],
  [30, "30 мин"],
  [45, "45 мин"],
  [60, "1 ч"],
  [90, "1,5 ч"],
  ["track", "До конца трека"],
];
const RATES = [0.75, 1, 1.25, 1.5, 2];
const rateLabel = (r) => `${String(r).replace(".", ",")}×`;

function qualityLabel(st) {
  if (!st) return "";
  if (st.codec === "local") return "Свой файл вместо звука Яндекса";
  if (st.codec === "flac" || st.codec === "flac-mp4") return "Без потерь · FLAC";
  return `${st.bitrate} кбит/с · ${String(st.codec || "").replace("-mp4", "").toUpperCase()}`;
}

/** Closes a popover on an outside pointer press or Esc (Esc doesn't reach views underneath). */
function useDismiss(open, setOpen, box) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !box.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
}

/**
 * Everything that isn't used on every track lives here instead of in the bar: where the music plays from,
 * stream quality, sleep timer, speed, equalizer, mini player. The button shows a dot while any of them
 * is changed from its default, so a running timer or a non-1× speed is never invisible.
 */
function MoreMenu({ t, ctx, st }) {
  const [open, setOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);
  const [, tick] = useState(0);
  const box = useRef(null);
  useDismiss(open, setOpen, box);
  const sleep = p.sleepTimer.value;
  // the remaining minutes refresh while the menu is open
  useEffect(() => {
    if (!open || sleep?.mode !== "time") return;
    const id = setInterval(() => tick((x) => x + 1), 15000);
    return () => clearInterval(id);
  }, [open, sleep]);
  const left = sleep?.mode === "time" ? Math.max(1, Math.ceil((sleep.at - Date.now()) / 60000)) : null;
  const rate = p.rate.value;
  const eqOn = webAudio && eq.value.enabled;
  const changed = !!sleep || rate !== 1 || eqOn;
  const label = sleep ? (sleep.mode === "track" ? "Ещё · таймер сна: до конца трека" : `Ещё · таймер сна: ${left} мин`) : "Ещё";
  return (
    <div class="popover-wrap" ref={box}>
      <button class={`icon-btn more-btn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog">
        <Icon name="more" />
        {changed && <span class="more-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div class="popover more-menu" role="dialog" aria-label="Ещё">
          {(ctx || st) && (
            <div class="more-source">
              {ctx && (
                <div class="more-source-title">
                  {ctx.type === "wave" && <Icon name="wave" size={16} />}
                  {ctx.link ? (
                    <a href={href(ctx.link)} onClick={() => setOpen(false)}>
                      {ctx.title}
                    </a>
                  ) : (
                    <span>{ctx.title}</span>
                  )}
                </div>
              )}
              {st && <div class={`more-source-sub ${st.quality === "lossless" ? "hq" : ""}`}>{qualityLabel(st)}</div>}
            </div>
          )}

          <div class="more-group">
            <div class="more-label">
              Таймер сна{left != null ? <span class="more-value"> · осталось {left} мин</span> : sleep?.mode === "track" ? <span class="more-value"> · до конца трека</span> : null}
            </div>
            <div class="chips">
              {SLEEP_OPTIONS.map(([v, l]) => (
                <button key={v} class={`chip ${(v === "track" ? sleep?.mode === "track" : sleep?.mode === "time" && sleep?.minutes === v) ? "on" : ""}`} onClick={() => p.setSleepTimer(v)}>
                  {l}
                </button>
              ))}
              {sleep && (
                <button class="chip ghost" onClick={() => p.setSleepTimer(null)}>
                  Выключить
                </button>
              )}
            </div>
          </div>

          <div class="more-group">
            <div class="more-label">Скорость</div>
            <div class="chips">
              {RATES.map((r) => (
                <button key={r} class={`chip ${rate === r ? "on" : ""}`} onClick={() => p.setRate(r)}>
                  {rateLabel(r)}
                </button>
              ))}
            </div>
          </div>

          {webAudio && (
            <div class="more-group">
              <button class={`menu-item more-row ${eqOpen ? "on" : ""}`} onClick={() => setEqOpen(!eqOpen)} aria-expanded={eqOpen}>
                <Icon name="eq" size={18} /> Эквалайзер
                <span class="more-row-value">{eqOn ? "включён" : "выключен"}</span>
              </button>
              {eqOpen && <EqPanel />}
            </div>
          )}

          {isDesktop && (
            <button
              class="menu-item more-row"
              onClick={() => {
                setOpen(false);
                setMini(true);
              }}
              disabled={!t}
            >
              <Icon name="mini" size={18} /> Мини-плеер поверх окон
            </button>
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
  const [coverFailed, setCoverFailed] = useState(null);
  return (
    <footer
      class={`player ${t ? "" : "is-empty"}`}
      style={t?.color && /^#[0-9a-f]{6}$/i.test(t.color) ? { "--player-tint": `color-mix(in srgb, ${t.color} 14%, var(--player-bg))` } : undefined}
    >
      <div class="player-track">
        {t ? (
          <>
            <button class="player-cover" onClick={() => (nowPlayingOpen.value = true)} aria-label="Открыть «Сейчас играет»" title="Сейчас играет">
              {t.cover && coverFailed !== t.cover ? <img src={t.cover} alt="" onError={() => setCoverFailed(t.cover)} /> : <div class="ph" />}
              <span class="player-cover-hint">
                <Icon name="expand" size={18} />
              </span>
            </button>
            <div class="player-meta">
              <div class="player-title">
                <span class="t" title={t.title}>
                  {t.title}
                </span>
                {t.explicit && <ExplicitBadge />}
              </div>
              <Artists track={t} />
            </div>
            <button class={`icon-btn like ${liked ? "on" : ""}`} onClick={() => p.like(t)} aria-label={liked ? "Убрать из «Мне нравится»" : "Мне нравится"} aria-pressed={liked}>
              <Icon name={liked ? "heart" : "heartOutline"} />
            </button>
            {/* as in the official bar: «не нравится» only where it steers recommendations — on the wave */}
            {ctx?.type === "wave" && (
              <button class={`icon-btn dislike ${p.isDisliked(t) ? "on-bad" : ""}`} onClick={() => p.dislike(t)} aria-label="Не нравится" title="Не нравится — и не предлагать">
                <Icon name="ban" />
              </button>
            )}
          </>
        ) : (
          <div class="player-hint">Включите «Мою волну» или любой трек</div>
        )}
      </div>

      <div class="player-center">
        <div class="player-controls">
          <button class={`icon-btn opt ${p.shuffle.value ? "on" : ""}`} onClick={p.toggleShuffle} aria-label="Перемешать" aria-pressed={p.shuffle.value} title="Перемешивать">
            <Icon name="shuffle" />
          </button>
          <button class="icon-btn" onClick={p.prev} aria-label="Предыдущий" title="Предыдущий" disabled={!t}>
            <Icon name="prev" size={24} />
          </button>
          <button class="play-main" onClick={() => (t ? p.toggle() : p.playWave())} aria-label={p.playing.value ? "Пауза" : "Играть"}>
            {p.loading.value && !p.playing.value ? <span class="spinner" /> : <Icon name={p.playing.value ? "pause" : "play"} size={24} />}
          </button>
          <button class="icon-btn" onClick={() => p.next()} aria-label="Следующий" title="Следующий" disabled={!t}>
            <Icon name="next" size={24} />
          </button>
          <button
            class={`icon-btn opt ${p.repeat.value !== "none" ? "on" : ""}`}
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
        <button class={`icon-btn ${panel.value === "lyrics" ? "on" : ""}`} onClick={() => togglePanel("lyrics")} aria-label="Текст песни" aria-pressed={panel.value === "lyrics"} title="Текст песни" disabled={!t}>
          <Icon name="lyrics" />
        </button>
        <button class={`icon-btn ${panel.value === "queue" ? "on" : ""}`} onClick={() => togglePanel("queue")} aria-label="Очередь" aria-pressed={panel.value === "queue"} title="Очередь">
          <Icon name="queue" />
        </button>
        <DevicesButton />
        <Volume />
        <MoreMenu t={t} ctx={ctx} st={st} />
      </div>
    </footer>
  );
}
