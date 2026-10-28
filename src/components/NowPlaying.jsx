// Full-screen Now Playing: large cover on a blurred background in the track's color + synced lyrics.
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { nowPlayingOpen } from "../lib/ui.js";
import { Progress, Volume } from "./PlayerBar.jsx";
import { Lyrics } from "./SidePanels.jsx";
import { ExplicitBadge, Artists } from "./TrackList.jsx";
import { openTrackMenu, menu } from "./ContextMenu.jsx";
import { seconds } from "../lib/format.js";
import * as p from "../player/engine.js";

const bigCover = (url) => (url ? url.replace(/\d+x\d+$/, "800x800") : null);
// the app behind the dialog: unreachable for Tab and screen readers while it is open
const BEHIND = [".sidebar", ".body", ".player"];

export function NowPlaying() {
  const open = nowPlayingOpen.value;
  const t = p.current.value;
  // narrow windows have room for one column: the cover or the lyrics, switched in the header
  const [view, setView] = useState("cover");
  const closeBtn = useRef(null);
  useEffect(() => setView("cover"), [t?.id]);
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
    // a modal dialog: focus moves in, the page behind goes inert, focus comes back on close
    const back = document.activeElement;
    const behind = BEHIND.map((s) => document.querySelector(s)).filter(Boolean);
    behind.forEach((el) => (el.inert = true));
    requestAnimationFrame(() => closeBtn.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", hide);
      document.removeEventListener("click", onClick, true);
      behind.forEach((el) => (el.inert = false));
      if (back && document.contains(back)) back.focus?.();
    };
  }, [open]);
  if (!open || !t) return null;
  const liked = p.isLiked(t);
  const cover = bigCover(t.cover);
  return (
    <div class="np" role="dialog" aria-modal="true" aria-label="Сейчас играет" style={{ "--np-accent": t.color || "#333" }}>
      <div class="np-bg" style={cover ? { backgroundImage: `url(${cover})` } : undefined} />
      <div class="np-shade" />
      <button class="icon-btn np-close" ref={closeBtn} onClick={() => (nowPlayingOpen.value = false)} aria-label="Свернуть" title="Свернуть (Esc)">
        <Icon name="down" size={22} />
      </button>
      <div class="np-switch" role="tablist" aria-label="Что показывать">
        {[
          ["cover", "Обложка"],
          ["lyrics", "Текст"],
        ].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} class={`chip ${view === k ? "on" : ""}`} onClick={() => setView(k)}>
            {l}
          </button>
        ))}
      </div>
      <div class={`np-body show-${view}`}>
        <div class="np-left">
          <div class="np-cover">{cover ? <img src={cover} alt="" /> : <div class="ph" />}</div>
          <div class="np-meta">
            <div class="np-title">
              <span class="np-title-text">{t.title}</span>
              {t.explicit && <ExplicitBadge />}
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
            <button class={`icon-btn ${p.shuffle.value ? "on" : ""}`} onClick={p.toggleShuffle} aria-label="Перемешать" aria-pressed={p.shuffle.value}>
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
            <button class={`icon-btn ${p.repeat.value !== "none" ? "on" : ""}`} onClick={p.cycleRepeat} aria-label={{ none: "Повтор выключен", all: "Повторять всё", one: "Повторять трек" }[p.repeat.value]}>
              <Icon name={p.repeat.value === "one" ? "repeatOne" : "repeat"} />
            </button>
          </div>
          <div class="np-actions">
            <button class={`icon-btn like ${liked ? "on" : ""}`} onClick={() => p.like(t)} aria-label="Мне нравится" aria-pressed={liked}>
              <Icon name={liked ? "heart" : "heartOutline"} />
            </button>
            <button class={`icon-btn ${p.isDisliked(t) ? "on-bad" : ""}`} onClick={() => p.dislike(t)} aria-label="Не нравится" aria-pressed={p.isDisliked(t)}>
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
