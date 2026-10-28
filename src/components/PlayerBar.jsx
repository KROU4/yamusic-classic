// Нижняя панель плеера в духе классической Яндекс Музыки.
import { useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Icon } from "./Icon.jsx";
import { ExplicitBadge, Artists } from "./TrackList.jsx";
import { seconds } from "../lib/format.js";
import { href } from "../lib/router.js";
import * as p from "../player/engine.js";

export const panel = signal(null); // null | "lyrics" | "queue"
export const togglePanel = (name) => (panel.value = panel.value === name ? null : name);

function Progress() {
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

function Volume() {
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

export function PlayerBar() {
  const t = p.current.value;
  const ctx = p.context.value;
  const st = p.stream.value;
  const liked = p.isLiked(t);
  return (
    <footer class={`player ${t ? "" : "is-empty"}`}>
      <Progress />
      <div class="player-inner">
        <div class="player-controls">
          <button class="icon-btn" onClick={p.prev} aria-label="Предыдущий" disabled={!t}>
            <Icon name="prev" size={22} />
          </button>
          <button class="play-main" onClick={() => (t ? p.toggle() : p.playWave())} aria-label={p.playing.value ? "Пауза" : "Играть"}>
            {p.loading.value && !p.playing.value ? <span class="spinner" /> : <Icon name={p.playing.value ? "pause" : "play"} size={24} />}
          </button>
          <button class="icon-btn" onClick={() => p.next()} aria-label="Следующий" disabled={!t}>
            <Icon name="next" size={22} />
          </button>
        </div>

        <div class="player-track">
          {t ? (
            <>
              <a class="player-cover" href={t.albumId ? href(`/album/${t.albumId}`) : undefined}>
                {t.cover ? <img src={t.cover} alt="" /> : <div class="ph" />}
              </a>
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

        <div class="player-time">
          {t ? `${seconds(p.position.value)} / ${seconds(p.duration.value)}` : ""}
        </div>

        <div class="player-extra">
          {ctx && (
            <span class="player-ctx" title={ctx.title}>
              {ctx.type === "wave" ? <Icon name="wave" size={16} /> : null}
              {ctx.link ? <a href={href(ctx.link)}>{ctx.title}</a> : ctx.title}
            </span>
          )}
          {st && (
            <span class="player-quality" title={`${st.codec}, ${st.bitrate} кбит/с`}>
              {st.codec === "flac" || st.codec === "flac-mp4" ? "FLAC" : `${st.bitrate}`}
            </span>
          )}
          <button class={`icon-btn ${p.shuffle.value ? "on" : ""}`} onClick={p.toggleShuffle} aria-label="Перемешать" title="Перемешивать">
            <Icon name="shuffle" />
          </button>
          <button class={`icon-btn ${p.repeat.value !== "none" ? "on" : ""}`} onClick={p.cycleRepeat} aria-label="Повтор" title={{ none: "Повтор выключен", all: "Повторять всё", one: "Повторять трек" }[p.repeat.value]}>
            <Icon name={p.repeat.value === "one" ? "repeatOne" : "repeat"} />
          </button>
          <button class={`icon-btn ${panel.value === "lyrics" ? "on" : ""}`} onClick={() => togglePanel("lyrics")} aria-label="Текст песни" title="Текст песни" disabled={!t}>
            <Icon name="lyrics" />
          </button>
          <button class={`icon-btn ${panel.value === "queue" ? "on" : ""}`} onClick={() => togglePanel("queue")} aria-label="Очередь" title="Очередь">
            <Icon name="queue" />
          </button>
          <Volume />
        </div>
      </div>
    </footer>
  );
}
