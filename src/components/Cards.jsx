import { Icon } from "./Icon.jsx";
import { href } from "../lib/router.js";
import { ALBUM_TYPES, plural } from "../lib/format.js";
import { api } from "../lib/api.js";
import * as player from "../player/engine.js";
import { toast } from "../lib/toast.js";

function Cover({ src, round, children }) {
  return (
    <div class={`cover ${round ? "round" : ""}`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <div class="ph" />}
      {children}
    </div>
  );
}

function PlayOverlay({ onPlay }) {
  return (
    <button
      class="cover-play"
      aria-label="Играть"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onPlay();
      }}
    >
      <Icon name="play" size={22} />
    </button>
  );
}

const playFrom = async (path, pick, ctx) => {
  try {
    const data = await api.get(path);
    const tracks = pick(data);
    if (!tracks.length) return toast("Нечего играть");
    player.playList(tracks, 0, ctx);
  } catch (e) {
    toast(e.message);
  }
};

export function AlbumCard({ album }) {
  const link = `/album/${album.id}`;
  return (
    <a class="card" href={href(link)}>
      <Cover src={album.cover}>
        <PlayOverlay onPlay={() => playFrom(`/album/${album.id}`, (d) => d.tracks, { title: album.title, link, from: "desktop_win-album-album-default" })} />
      </Cover>
      <div class="card-title" title={album.title}>
        {album.title}
      </div>
      <div class="card-sub">
        {album.artists.map((a) => a.name).join(", ")}
        {album.year ? ` · ${album.year}` : ""}
        {ALBUM_TYPES[album.type] ? ` · ${ALBUM_TYPES[album.type]}` : ""}
      </div>
    </a>
  );
}

export function PlaylistCard({ playlist, note }) {
  const link = `/playlist/${playlist.uid}/${playlist.kind}`;
  return (
    <a class="card" href={href(link)}>
      <Cover src={playlist.cover}>
        <PlayOverlay
          onPlay={() => playFrom(`/playlist/${playlist.uid}/${playlist.kind}`, (d) => d.tracks, { title: playlist.title, link, from: "desktop_win-playlist-playlist-default" })}
        />
      </Cover>
      <div class="card-title" title={playlist.title}>
        {playlist.title}
      </div>
      <div class="card-sub">{note || (playlist.trackCount ? plural(playlist.trackCount, "трек", "трека", "треков") : playlist.owner)}</div>
    </a>
  );
}

export function ArtistCard({ artist }) {
  return (
    <a class="card artist-card" href={href(`/artist/${artist.id}`)}>
      <Cover src={artist.cover} round />
      <div class="card-title center">{artist.name}</div>
    </a>
  );
}

export function Row({ children }) {
  return <div class="row">{children}</div>;
}

export function Section({ title, link, linkText = "Смотреть всё", children }) {
  return (
    <section class="section">
      <div class="section-head">
        <h2>{link ? <a href={href(link)}>{title}</a> : title}</h2>
        {link && (
          <a class="section-more" href={href(link)}>
            {linkText}
          </a>
        )}
      </div>
      {children}
    </section>
  );
}
