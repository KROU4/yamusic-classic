// Страницы сущностей: альбом, исполнитель, плейлист.
import { useState } from "preact/hooks";
import { useLoad } from "../lib/useLoad.js";
import { api, dropCache } from "../lib/api.js";
import { me } from "../lib/session.js";
import { TrackList, ExplicitBadge } from "../components/TrackList.jsx";
import { Section, Row, AlbumCard, ArtistCard, PlaylistCard } from "../components/Cards.jsx";
import { Loading, ErrorState, PageHead } from "../components/States.jsx";
import { Icon } from "../components/Icon.jsx";
import { href, go } from "../lib/router.js";
import { plural, totalDuration, ALBUM_TYPES } from "../lib/format.js";
import { toast } from "../lib/toast.js";
import { unpin } from "../lib/pins.js";
import { PinButton } from "../components/PinButton.jsx";
import * as player from "../player/engine.js";

function PlayButtons({ tracks, ctx, extra, pin }) {
  return (
    <>
      <button class="btn primary" onClick={() => player.playList(tracks, 0, ctx)} disabled={!tracks.length}>
        <Icon name="play" size={18} /> Слушать
      </button>
      <button
        class="btn ghost"
        onClick={() => {
          const shuffled = [...tracks].sort(() => Math.random() - 0.5);
          player.playList(shuffled, 0, ctx);
        }}
        disabled={!tracks.length}
      >
        <Icon name="shuffle" size={18} /> Вперемешку
      </button>
      {pin && <PinButton pin={pin} />}
      {extra}
    </>
  );
}

export function AlbumPage({ id }) {
  const { data, loading, error } = useLoad(`/album/${id}`);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} />;
  const { album, tracks } = data;
  const ctx = { title: album.title, link: `/album/${id}`, from: "desktop_win-album-album-default" };
  return (
    <div class="page">
      <PageHead
        cover={album.cover}
        kicker={ALBUM_TYPES[album.type] || "Альбом"}
        title={
          <>
            {album.title} {album.version && <span class="muted">{album.version}</span>} {album.explicit && <ExplicitBadge />}
          </>
        }
        actions={<PlayButtons tracks={tracks} ctx={ctx} pin={{ type: "album", id: String(id), title: album.title, cover: album.cover || null }} />}
      >
        <div class="page-meta">
          {album.artists.map((a, i) => (
            <>
              {i > 0 && ", "}
              <a href={href(`/artist/${a.id}`)}>{a.name}</a>
            </>
          ))}
          {album.year && ` · ${album.year}`}
          {` · ${plural(tracks.length, "трек", "трека", "треков")}, ${totalDuration(tracks)}`}
        </div>
        {album.labels?.length > 0 && <div class="page-meta small">{album.labels.join(", ")}</div>}
      </PageHead>
      <TrackList tracks={tracks} ctx={ctx} showCover={false} numbered />
    </div>
  );
}

export function ArtistPage({ id }) {
  const { data, loading, error } = useLoad(`/artist/${id}`);
  const [allTracks, setAllTracks] = useState(null);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} />;
  const { artist, popular, albums, similar } = data;
  const ctx = { title: artist.name, link: `/artist/${id}`, from: "desktop_win-artist-track-default" };
  const loadAll = async () => {
    try {
      const r = await api.get(`/artist/${id}/tracks`);
      setAllTracks(r.tracks);
    } catch (e) {
      toast(e.message);
    }
  };
  const own = albums.filter((a) => a.type !== "compilation");
  return (
    <div class="page">
      <PageHead
        cover={artist.cover}
        round
        kicker="Исполнитель"
        title={artist.name}
        actions={
          <PlayButtons
            tracks={popular}
            ctx={ctx}
            extra={
              <button class="btn ghost" onClick={() => player.playWave({ stationId: `artist:${id}`, title: `Волна по исполнителю ${artist.name}` })}>
                <Icon name="wave" size={18} /> Волна по исполнителю
              </button>
            }
            pin={{ type: "artist", id: String(id), title: artist.name, cover: artist.cover || null }}
          />
        }
      >
        <div class="page-meta">
          {artist.genres?.join(", ")}
          {artist.likes ? ` · в «Мне нравится» у ${artist.likes.toLocaleString("ru-RU")}` : ""}
        </div>
      </PageHead>
      <Section title="Популярные треки">
        <TrackList tracks={allTracks || popular} ctx={ctx} />
        {!allTracks && (
          <button class="btn ghost more" onClick={loadAll}>
            Все треки
          </button>
        )}
      </Section>
      {own.length > 0 && (
        <Section title="Альбомы и синглы">
          <div class="grid">
            {own.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </div>
        </Section>
      )}
      {similar.length > 0 && (
        <Section title="Похожие исполнители">
          <Row>
            {similar.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </Row>
        </Section>
      )}
    </div>
  );
}

export function PlaylistPage({ uid, kind }) {
  const { data, loading, error, reload } = useLoad(`/playlist/${uid}/${kind}`);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} />;
  const { playlist, tracks } = data;
  const own = me.value?.uid != null && String(me.value.uid) === String(uid);
  // перечитать плейлист после правки на месте: старые данные остаются на экране до прихода новых
  const refresh = () => reload();
  const ctx = { title: playlist.title, link: `/playlist/${uid}/${kind}`, from: "desktop_win-playlist-playlist-default" };
  const rename = async () => {
    const title = prompt("Новое название плейлиста", playlist.title);
    if (!title || title === playlist.title) return;
    try {
      await api.post(`/my/playlists/${kind}/rename`, { title });
      dropCache("/collection");
      refresh();
    } catch (e) {
      toast(e.message);
    }
  };
  const remove = async () => {
    if (!confirm(`Удалить плейлист «${playlist.title}»? Это нельзя отменить.`)) return;
    try {
      await api.post(`/my/playlists/${kind}/delete`);
      dropCache("/collection");
      unpin({ type: "playlist", uid: String(uid), kind: String(kind) });
      toast("Плейлист удалён");
      go("/collection/playlists");
    } catch (e) {
      toast(e.message);
    }
  };
  return (
    <div class="page">
      <PageHead
        cover={playlist.cover}
        kicker={own ? "Мой плейлист" : "Плейлист"}
        title={playlist.title}
        actions={
          <PlayButtons
            tracks={tracks}
            ctx={ctx}
            extra={
              <>
                <PinButton pin={{ type: "playlist", uid: String(uid), kind: String(kind), title: playlist.title, cover: playlist.cover || null }} />
                {own && (
                <>
                  <button class="icon-btn" onClick={rename} aria-label="Переименовать" title="Переименовать">
                    <Icon name="edit" />
                  </button>
                  <button class="icon-btn" onClick={remove} aria-label="Удалить плейлист" title="Удалить плейлист">
                    <Icon name="trash" />
                  </button>
                </>
                )}
              </>
            }
          />
        }
      >
        <div class="page-meta">
          {playlist.owner && `${playlist.owner} · `}
          {plural(tracks.length, "трек", "трека", "треков")}, {totalDuration(tracks)}
        </div>
        {playlist.description && <p class="page-desc">{playlist.description}</p>}
      </PageHead>
      {own && !tracks.length ? (
        <div class="empty">Плейлист пуст. Добавляйте треки через меню «…» или правым кликом по треку.</div>
      ) : (
        <TrackList tracks={tracks} ctx={ctx} playlist={own ? { kind, onRemoved: refresh } : undefined} />
      )}
    </div>
  );
}

export { PlaylistCard };
