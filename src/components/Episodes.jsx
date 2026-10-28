// Podcast episodes and audiobook chapters: rows with date, length and listening progress, show cards,
// and the "mark as played" menu items.
import { useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { ExplicitBadge } from "./TrackList.jsx";
import { openTrackMenu } from "./ContextMenu.jsx";
import { href } from "../lib/router.js";
import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { ALBUM_TYPES, duration as fmtDuration } from "../lib/format.js";
import { isEpisode, progressOf, pubDateLabel, statusLabel, minutesLabel } from "../lib/episodes.js";
import { episodeLocal, markPlayed } from "../player/podcast.js";
import * as player from "../player/engine.js";

export const showCtx = (album) => ({ title: album.title, link: `/album/${album.id}`, from: "desktop_win-album-album-default", ordered: true });

/** Index to start a show from: the server's resume point, else the first item of the list as shown. */
export function resumeIndex(album, episodes) {
  const id = album?.resumeFrom?.trackId;
  const i = id ? episodes.findIndex((t) => t.id === id) : -1;
  return i >= 0 ? i : 0;
}

/** Play a podcast/book from a card or the shelf: all episodes in the server's order, from trackId or the resume point. */
export async function playShow(albumId, trackId) {
  try {
    const { album, episodes } = await api.get(`/podcast/${albumId}`);
    if (!episodes.length) return toast("Нечего играть");
    const at = trackId ? episodes.findIndex((t) => t.id === String(trackId)) : -1;
    player.playList(episodes, at >= 0 ? at : resumeIndex(album, episodes), showCtx(album));
  } catch (e) {
    toast(e.message);
  }
}

/** Progress of a row: the playing episode shows the live position. */
function liveProgress(track) {
  const local = episodeLocal.value.get(track.id);
  const cur = player.current.value;
  if (cur && cur.id === track.id && player.position.value > 0) return progressOf(track, { ...local, pos: player.position.value });
  return progressOf(track, local);
}

export function ProgressBar({ pct }) {
  return (
    <span class="ep-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(pct * 100)}>
      <i style={{ width: `${Math.max(2, Math.round(pct * 100))}%` }} />
    </span>
  );
}

function EpisodeRow({ track, i, list, ctx, showCover, numbered, showAlbum }) {
  const cur = player.current.value;
  const isCurrent = cur && cur.id === track.id;
  const isPlaying = isCurrent && player.playing.value;
  const unavailable = !track.available && !track.substituted?.available;
  const pr = liveProgress(track);
  const played = pr.finished && !(pr.pos > 0);
  const onPlay = () => (isCurrent ? player.toggle() : player.playList(list, i, ctx));
  const date = pubDateLabel(track.pubDate);
  return (
    <div
      class={`episode ${isCurrent ? "is-current" : ""} ${played ? "is-played" : ""} ${unavailable ? "is-unavailable" : ""}`}
      onDblClick={onPlay}
      onContextMenu={(e) => openTrackMenu(e, track)}
      title={unavailable ? "Недоступно для прослушивания" : undefined}
    >
      <div class="ep-lead">
        {showCover && (track.cover ? <img class="ep-cover" src={track.cover} alt="" loading="lazy" /> : <div class="ep-cover ph" />)}
        {numbered && !showCover && <span class="ep-num">{i + 1}</span>}
        <button class="ep-play" onClick={onPlay} aria-label={isPlaying ? "Пауза" : "Слушать"}>
          {isPlaying ? <Icon name="pause" size={18} /> : isCurrent && player.loading.value ? <span class="spinner sm" /> : <Icon name="play" size={18} />}
        </button>
      </div>
      <div class="ep-main">
        {(date || (showAlbum && track.album)) && (
          <div class="ep-top">
            {showAlbum && track.album && (
              <a href={href(`/album/${track.album.id}`)} onClick={(e) => e.stopPropagation()}>
                {track.album.title}
              </a>
            )}
            {showAlbum && track.album && date && " · "}
            {date}
          </div>
        )}
        <div class="ep-title">
          <span class="t">{track.title}</span>
          {track.explicit && <ExplicitBadge />}
        </div>
        {track.description && <div class="ep-desc">{track.description}</div>}
        {/* not started: the length is already in the right column */}
        {(pr.pos > 0 || played) && (
          <div class="ep-status">
            {pr.pct > 0 && !played && <ProgressBar pct={pr.pct} />}
            {played && <Icon name="check" size={14} class="ep-done" />}
            <span>{statusLabel(pr, track.durationMs)}</span>
          </div>
        )}
      </div>
      <div class="ep-actions">
        <button
          class={`icon-btn ${played ? "on" : "hover-only"}`}
          onClick={() => markPlayed({ track }, !played)}
          aria-label={played ? "Снять отметку «Прослушано»" : "Отметить прослушанным"}
          title={played ? "Снять отметку «Прослушано»" : "Отметить прослушанным"}
        >
          <Icon name="check" size={18} />
        </button>
        <button class="icon-btn hover-only" onClick={(e) => openTrackMenu(e, track)} aria-label="Ещё" title="Ещё">
          <Icon name="more" size={18} />
        </button>
      </div>
      <div class="ep-dur">{fmtDuration(track.durationMs)}</div>
    </div>
  );
}

/** limit: show the first N with a «Показать все» toggle. */
export function EpisodeList({ tracks, ctx = {}, showCover = false, numbered = false, showAlbum = false, limit }) {
  const [all, setAll] = useState(false);
  if (!tracks.length) return <div class="empty">Здесь пока пусто</div>;
  const list = limit && !all ? tracks.slice(0, limit) : tracks;
  return (
    <>
      <div class="episodes">
        {list.map((t, i) => (
          <EpisodeRow key={`${t.id}-${i}`} track={t} i={i} list={tracks} ctx={ctx} showCover={showCover} numbered={numbered} showAlbum={showAlbum} />
        ))}
      </div>
      {limit && tracks.length > limit && (
        <button class="btn ghost more" onClick={() => setAll(!all)}>
          {all ? "Свернуть" : `Показать все (${tracks.length})`}
        </button>
      )}
    </>
  );
}

/** Podcast or book card. note: replaces the subtitle (e.g. «Осталось 20 мин»); pct: listening progress bar. */
export function ShowCard({ show, note, pct, trackId }) {
  const link = `/album/${show.id}`;
  const sub = note || [show.chart?.position ? `№ ${show.chart.position}` : null, show.artists.map((a) => a.name).join(", ") || null, ALBUM_TYPES[show.type] || null].filter(Boolean).join(" · ");
  return (
    <a class="card show-card" href={href(link)}>
      <div class="cover">
        {show.cover ? <img src={show.cover} alt="" loading="lazy" /> : <div class="ph" />}
        {show.bookmate && <span class="show-badge" title="Книга из каталога Букмейта: может понадобиться опция подписки">Букмейт</span>}
        {pct > 0 && <ProgressBar pct={pct} />}
        <button
          class="cover-play"
          aria-label="Слушать"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            playShow(show.id, trackId);
          }}
        >
          <Icon name="play" size={22} />
        </button>
      </div>
      <div class="card-title" title={show.title}>
        {show.title}
      </div>
      <div class="card-sub">{sub}</div>
    </a>
  );
}

/** The big «Продолжить слушать» card: the last played episode. */
export function ContinueCard({ item }) {
  const { album, track } = item;
  const pr = liveProgress(track);
  const isCurrent = player.current.value?.id === track.id;
  const isPlaying = isCurrent && player.playing.value;
  return (
    <div class="pod-continue">
      <a class="pc-cover" href={href(`/album/${album.id}`)}>
        {album.cover ? <img src={album.cover} alt="" /> : <div class="ph" />}
      </a>
      <div class="pc-info">
        <div class="kicker">Продолжить слушать</div>
        <div class="pc-title" title={track.title}>
          {track.title}
        </div>
        <a class="pc-sub" href={href(`/album/${album.id}`)}>
          {album.title}
          {ALBUM_TYPES[album.type] ? ` · ${ALBUM_TYPES[album.type]}` : ""}
        </a>
        <div class="ep-status">
          {pr.pct > 0 && <ProgressBar pct={pr.pct} />}
          <span>{statusLabel(pr, track.durationMs)}</span>
          {item.durationLeft > 0 && album.type === "audiobook" && <span class="muted"> · до конца книги {minutesLabel(item.durationLeft)}</span>}
        </div>
      </div>
      <button class="btn primary" onClick={() => (isCurrent ? player.toggle() : playShow(album.id, track.id))}>
        <Icon name={isPlaying ? "pause" : "play"} size={18} /> {isPlaying ? "Пауза" : "Продолжить"}
      </button>
    </div>
  );
}

/** Context-menu items for an episode; nothing for music. act wraps the handler so the menu closes first. */
export function EpisodeMenuItems({ track, act }) {
  if (!isEpisode(track)) return null;
  const pr = progressOf(track, episodeLocal.value.get(track.id));
  const played = pr.finished && !(pr.pos > 0);
  return (
    <button class="menu-item" role="menuitem" onClick={act(() => markPlayed({ track }, !played))}>
      <Icon name="check" size={16} /> {played ? "Отметить непрослушанным" : "Отметить прослушанным"}
    </button>
  );
}
