// Full-screen Now Playing: large cover on a blurred background in the track's color + synced lyrics.
import { useEffect } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { nowPlayingOpen } from "../lib/ui.js";
import { Progress, Volume } from "./PlayerBar.jsx";
import { Lyrics } from "./SidePanels.jsx";
import { ExplicitBadge, Artists } from "./TrackList.jsx";
import { openTrackMenu, menu } from "./ContextMenu.jsx";
import { VibeCanvas, paletteFor } from "./VibeCanvas.jsx";
import { isPromptStation, promptFromSeed, promptMood } from "../lib/q2v.js";
import { seconds } from "../lib/format.js";
import * as p from "../player/engine.js";

const bigCover = (url) => (url ? url.replace(/\d+x\d+$/, "800x800") : null);

export function NowPlaying() {
  const open = nowPlayingOpen.value;
  useEffect(() => {
    if (!open) return;
    const hide = () => (nowPlayingOpen.value = false);
    // Esc with a context menu open closes only the menu (our handler runs first, menu is still set)
    const onKey = (e) => {
      if (e.key !== "Escape" || menu.value) return;
      hide();
    };
    window.addEventListener("keydown", onKey);
    // navigation from inside (artist, «Перейти к альбому») collapses us, otherwise the new page stays hidden beneath
    window.addEventListener("hashchange", hide);
    // a click on an inner link (artist) collapses immediately, even if the address matches the current one
    const onClick = (e) => e.target.closest?.(".np a[href^=\"#\"]") && hide();
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", hide);
      document.removeEventListener("click", onClick, true);
    };
  }, [open]);
  const t = p.current.value;
  if (!open || !t) return null;
  const liked = p.isLiked(t);
  const cover = bigCover(t.cover);
  const ctx = p.context.value;
  return (
    <div class="np" role="dialog" aria-label="Сейчас играет" style={{ "--np-accent": t.color || "#333" }}>
      <div class="np-bg" style={cover ? { backgroundImage: `url(${cover})` } : undefined} />
      <div class="np-shade" />
      {/* during a wave its animation lives behind the cover */}
      {ctx?.type === "wave" && <VibeCanvas colors={paletteFor(isPromptStation(ctx.stationId) ? promptMood(promptFromSeed(ctx.stationId) || ctx.title || "") : ctx.settings)} active />}
      <button class="icon-btn np-close" onClick={() => (nowPlayingOpen.value = false)} aria-label="Свернуть" title="Свернуть (Esc)">
        <Icon name="down" size={22} />
      </button>
      <div class="np-body">
        <div class="np-left">
          <div class="np-cover">{cover ? <img src={cover} alt="" /> : <div class="ph" />}</div>
          <div class="np-meta">
            <div class="np-title">
              {t.title} {t.explicit && <ExplicitBadge />}
            </div>
            {t.version && <div class="np-version">{t.version}</div>}
            <Artists track={t} />
          </div>
          <div class="np-progress">
            <Progress />
            <div class="np-times">
              <span>{seconds(p.position.value)}</span>
              <span>{seconds(p.duration.value)}</span>
            </div>
          </div>
          <div class="np-controls">
            <button class={`icon-btn ${p.shuffle.value ? "on" : ""}`} onClick={p.toggleShuffle} aria-label="Перемешать">
              <Icon name="shuffle" />
            </button>
            <button class="icon-btn big" onClick={p.prev} aria-label="Предыдущий">
              <Icon name="prev" size={28} />
            </button>
            <button class="play-main xl" onClick={p.toggle} aria-label={p.playing.value ? "Пауза" : "Играть"}>
              <Icon name={p.playing.value ? "pause" : "play"} size={32} />
            </button>
            <button class="icon-btn big" onClick={() => p.next()} aria-label="Следующий">
              <Icon name="next" size={28} />
            </button>
            <button class={`icon-btn ${p.repeat.value !== "none" ? "on" : ""}`} onClick={p.cycleRepeat} aria-label="Повтор">
              <Icon name={p.repeat.value === "one" ? "repeatOne" : "repeat"} />
            </button>
          </div>
          <div class="np-actions">
            <button class={`icon-btn like ${liked ? "on" : ""}`} onClick={() => p.like(t)} aria-label="Мне нравится">
              <Icon name={liked ? "heart" : "heartOutline"} />
            </button>
            <button class={`icon-btn ${p.isDisliked(t) ? "on-bad" : ""}`} onClick={() => p.dislike(t)} aria-label="Не нравится">
              <Icon name="ban" />
            </button>
            <button class="icon-btn" onClick={(e) => openTrackMenu(e, t)} aria-label="Ещё">
              <Icon name="more" />
            </button>
            <Volume />
          </div>
        </div>
        <div class="np-right">
          <Lyrics />
        </div>
      </div>
    </div>
  );
}
