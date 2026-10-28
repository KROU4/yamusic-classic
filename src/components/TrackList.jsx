import { Icon } from "./Icon.jsx";
import { duration, artistNames } from "../lib/format.js";
import { href } from "../lib/router.js";
import * as player from "../player/engine.js";
import { openTrackMenu } from "./ContextMenu.jsx";

function Artists({ track }) {
  return (
    <span class="artists">
      {track.artists.map((a, i) => (
        <>
          {i > 0 && ", "}
          <a href={href(`/artist/${a.id}`)} onClick={(e) => e.stopPropagation()}>
            {a.name}
          </a>
        </>
      ))}
    </span>
  );
}

export function ExplicitBadge() {
  return (
    <span class="badge-e" title="Explicit — версия без цензуры">
      E
    </span>
  );
}

function TrackRow({ track, i, list, ctx, showCover, numbered, chart, playlist }) {
  const cur = player.current.value;
  const isCurrent = cur && (cur.id === track.id || cur.replacedFrom === track.id);
  const isPlaying = isCurrent && player.playing.value;
  const liked = player.isLiked(track);
  const unavailable = !track.available && !track.substituted?.available;
  const onPlay = () => {
    if (isCurrent) return player.toggle();
    player.playList(list, i, ctx);
  };
  const menuExtra = playlist ? { playlist: { ...playlist, index: i } } : {};
  return (
    <div
      class={`track ${isCurrent ? "is-current" : ""} ${unavailable ? "is-unavailable" : ""}`}
      onDblClick={onPlay}
      onContextMenu={(e) => openTrackMenu(e, track, menuExtra)}
      title={unavailable ? "Трек недоступен в вашем регионе" : undefined}
    >
      <div class="track-lead">
        {chart && track.position ? (
          <span class="chart-pos">
            {track.position}
            {track.progress === "up" && <Icon name="up" size={12} class="up" />}
            {track.progress === "down" && <Icon name="down" size={12} class="down" />}
          </span>
        ) : numbered ? (
          <span class="num">{i + 1}</span>
        ) : null}
        {showCover && (track.cover ? <img class="track-cover" src={track.cover} alt="" loading="lazy" /> : <div class="track-cover ph" />)}
        <button class="track-play" onClick={onPlay} aria-label={isPlaying ? "Пауза" : "Играть"}>
          {isPlaying ? <Icon name="pause" size={18} /> : isCurrent && player.loading.value ? <span class="spinner sm" /> : <Icon name="play" size={18} />}
        </button>
      </div>
      <div class="track-main">
        <div class="track-title">
          <span class="t">{track.title}</span>
          {track.version && <span class="v">{track.version}</span>}
          {track.explicit && <ExplicitBadge />}
          {track.substituted?.available && <span class="badge-sub" title="Яндекс подменил трек — при включении сыграет оригинал">ориг.</span>}
        </div>
        <Artists track={track} />
      </div>
      <div class="track-actions">
        <button class={`icon-btn like ${liked ? "on" : ""}`} onClick={() => player.like(track)} aria-label={liked ? "Убрать из «Мне нравится»" : "Мне нравится"}>
          <Icon name={liked ? "heart" : "heartOutline"} size={18} />
        </button>
        <button class="icon-btn hover-only" onClick={() => player.enqueueNext([track])} aria-label="Играть следующим" title="Играть следующим">
          <Icon name="addQueue" size={18} />
        </button>
        <button class="icon-btn hover-only" onClick={(e) => openTrackMenu(e, track, menuExtra)} aria-label="Ещё" title="Ещё">
          <Icon name="more" size={18} />
        </button>
      </div>
      <div class="track-dur">{duration(track.durationMs)}</div>
    </div>
  );
}

/**
 * ctx: { title, from, link } — откуда включили, для отчётов и подписи в плеере.
 * playlist: { kind, onRemoved } — для своего плейлиста в меню появляется «Удалить из плейлиста».
 */
export function TrackList({ tracks, ctx = {}, showCover = true, numbered = false, chart = false, limit, playlist }) {
  const list = limit ? tracks.slice(0, limit) : tracks;
  if (!list.length) return <div class="empty">Здесь пока пусто</div>;
  return (
    <div class="tracklist">
      {list.map((t, i) => (
        <TrackRow key={`${t.id}-${i}`} track={t} i={i} list={tracks} ctx={ctx} showCover={showCover} numbered={numbered} chart={chart} playlist={playlist} />
      ))}
    </div>
  );
}

export { Artists, artistNames };
