// Mini-player: compact always-on-top window (PulseSync style), cover art with controls.
import { Icon } from "./Icon.jsx";
import { Progress } from "./PlayerBar.jsx";
import { ExplicitBadge } from "./TrackList.jsx";
import { artistNames, seconds } from "../lib/format.js";
import { setMini } from "../lib/desktop.js";
import * as p from "../player/engine.js";

export function MiniPlayer() {
  const t = p.current.value;
  const liked = p.isLiked(t);
  const cover = t?.cover ? t.cover.replace(/\d+x\d+$/, "600x600") : null;
  return (
    <div class="mini" style={{ "--np-accent": t?.color || "#333" }}>
      <div class="mini-drag" />
      <div class="mini-cover">
        {cover ? <img src={cover} alt="" /> : <div class="ph" />}
        <button class="icon-btn mini-restore" onClick={() => setMini(false)} aria-label="Развернуть" title="Развернуть">
          <Icon name="expand" size={18} />
        </button>
      </div>
      <div class="mini-info">
        <div class="mini-title">
          <span class="t">{t ? t.title : "Ничего не играет"}</span>
          {t?.explicit && <ExplicitBadge />}
        </div>
        <div class="mini-artist">{t ? artistNames(t) : "Включите что-нибудь в основном окне"}</div>
      </div>
      <div class="mini-progress">
        <Progress />
        <div class="np-times">
          <span>{seconds(p.position.value)}</span>
          <span>{seconds(p.duration.value)}</span>
        </div>
      </div>
      <div class="mini-controls">
        <button class={`icon-btn like ${liked ? "on" : ""}`} onClick={() => t && p.like(t)} aria-label="Мне нравится" disabled={!t}>
          <Icon name={liked ? "heart" : "heartOutline"} />
        </button>
        <button class="icon-btn big" onClick={p.prev} aria-label="Предыдущий" disabled={!t}>
          <Icon name="prev" size={26} />
        </button>
        <button class="play-main" onClick={() => (t ? p.toggle() : p.playWave())} aria-label={p.playing.value ? "Пауза" : "Играть"}>
          <Icon name={p.playing.value ? "pause" : "play"} size={24} />
        </button>
        <button class="icon-btn big" onClick={() => p.next()} aria-label="Следующий" disabled={!t}>
          <Icon name="next" size={26} />
        </button>
        <button class={`icon-btn ${p.isDisliked(t) ? "on-bad" : ""}`} onClick={() => t && p.dislike(t)} aria-label="Не нравится" disabled={!t}>
          <Icon name="ban" />
        </button>
      </div>
    </div>
  );
}
