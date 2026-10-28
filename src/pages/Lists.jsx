// Search, collection, chart, new releases, radio.
import { useState } from "preact/hooks";
import { useLoad } from "../lib/useLoad.js";
import { TrackList } from "../components/TrackList.jsx";
import { Section, Row, AlbumCard, ArtistCard, PlaylistCard } from "../components/Cards.jsx";
import { StationGrid } from "../components/Wave.jsx";
import { Loading, ErrorState, PageHead } from "../components/States.jsx";
import { Icon } from "../components/Icon.jsx";
import { href, go } from "../lib/router.js";
import { plural } from "../lib/format.js";
import { api, dropCache } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import * as player from "../player/engine.js";

export function SearchPage({ q }) {
  const query = q || "";
  const { data, loading, error } = useLoad(query ? `/search?q=${encodeURIComponent(query)}` : null);
  if (!query) return <div class="page"><div class="state">Введите запрос в поиске сверху</div></div>;
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} />;
  const ctx = { title: `Поиск: ${query}`, from: "desktop_win-search-track-default" };
  const best = data.best;
  return (
    <div class="page">
      <h1 class="page-title">
        Результаты по запросу «{query}»{data.corrected && <span class="muted"> (исправлено на «{data.corrected}»)</span>}
      </h1>
      {best?.item && (
        <Section title="Лучший результат">
          <div class="best">
            {best.type === "track" && (
              // the best track plays together with the other results, not alone
              <TrackList tracks={[best.item, ...data.tracks.filter((t) => t.id !== best.item.id)]} ctx={ctx} limit={1} />
            )}
            {best.type === "album" && <Row><AlbumCard album={best.item} /></Row>}
            {best.type === "artist" && <Row><ArtistCard artist={best.item} /></Row>}
            {best.type === "playlist" && <Row><PlaylistCard playlist={best.item} /></Row>}
          </div>
        </Section>
      )}
      {data.tracks.length > 0 && (
        <Section title="Треки">
          <TrackList tracks={data.tracks} ctx={ctx} limit={10} />
        </Section>
      )}
      {data.artists.length > 0 && (
        <Section title="Исполнители">
          <Row>{data.artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</Row>
        </Section>
      )}
      {data.albums.length > 0 && (
        <Section title="Альбомы">
          <Row>{data.albums.map((a) => <AlbumCard key={a.id} album={a} />)}</Row>
        </Section>
      )}
      {data.playlists.length > 0 && (
        <Section title="Плейлисты">
          <Row>{data.playlists.map((p) => <PlaylistCard key={`${p.uid}-${p.kind}`} playlist={p} />)}</Row>
        </Section>
      )}
      {!best && !data.tracks.length && !data.albums.length && !data.artists.length && <div class="state">Ничего не нашлось</div>}
    </div>
  );
}

const COLLECTION_TABS = [
  ["likes", "Мне нравится"],
  ["playlists", "Плейлисты"],
  ["albums", "Альбомы"],
  ["artists", "Исполнители"],
];

function Likes() {
  const { data, loading, error } = useLoad("/collection/likes", 30000);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} />;
  const ctx = { title: "Мне нравится", link: "/collection/likes", from: "desktop_win-own_tracks-track-default" };
  return (
    <>
      <div class="page-actions">
        <button class="btn primary" onClick={() => player.playList(data.tracks, 0, ctx)} disabled={!data.tracks.length}>
          <Icon name="play" size={18} /> Слушать
        </button>
        <span class="muted">{plural(data.tracks.length, "трек", "трека", "треков")}</span>
      </div>
      <TrackList tracks={data.tracks} ctx={ctx} />
    </>
  );
}

export function CollectionPage({ tab = "likes" }) {
  const { data, loading, error } = useLoad(tab === "likes" ? null : "/collection", 60000);
  return (
    <div class="page">
      <h1 class="page-title">Коллекция</h1>
      <div class="subtabs big">
        {COLLECTION_TABS.map(([k, label]) => (
          <a key={k} href={href(`/collection/${k}`)} class={tab === k ? "on" : ""}>
            {label}
          </a>
        ))}
      </div>
      {tab === "likes" && <Likes />}
      {tab === "playlists" && (
        <div class="page-actions">
          <button
            class="btn ghost"
            onClick={async () => {
              const title = prompt("Название нового плейлиста", "Новый плейлист");
              if (!title) return;
              try {
                const r = await api.post("/my/playlists", { title });
                dropCache("/collection");
                go(`/playlist/${r.playlist.uid}/${r.playlist.kind}`);
              } catch (e) {
                toast(e.message);
              }
            }}
          >
            <Icon name="plus" size={16} /> Создать плейлист
          </button>
        </div>
      )}
      {tab !== "likes" && loading && !data && <Loading />}
      {tab !== "likes" && error && !data && <ErrorState error={error} />}
      {tab !== "likes" && data && (
        <div class="grid">
          {tab === "playlists" && (data.playlists.length ? data.playlists.map((p) => <PlaylistCard key={`${p.uid}-${p.kind}`} playlist={p} />) : <div class="empty">У вас пока нет плейлистов</div>)}
          {tab === "albums" && (data.albums.length ? data.albums.map((a) => <AlbumCard key={a.id} album={a} />) : <div class="empty">Нет сохранённых альбомов</div>)}
          {tab === "artists" && (data.artists.length ? data.artists.map((a) => <ArtistCard key={a.id} artist={a} />) : <div class="empty">Нет любимых исполнителей</div>)}
        </div>
      )}
    </div>
  );
}

export function ChartPage() {
  const { data, loading, error } = useLoad("/chart");
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} />;
  const ctx = { title: "Чарт", link: "/chart", from: "desktop_win-chart-chart-default" };
  return (
    <div class="page">
      <PageHead
        title="Чарт"
        actions={
          <button class="btn primary" onClick={() => player.playList(data.tracks, 0, ctx)}>
            <Icon name="play" size={18} /> Слушать
          </button>
        }
      >
        <div class="page-meta">Треки, популярные на Яндекс Музыке прямо сейчас</div>
      </PageHead>
      <TrackList tracks={data.tracks} ctx={ctx} chart />
    </div>
  );
}

export function NewPage() {
  const { data, loading, error } = useLoad("/new-releases", 10 * 60 * 1000);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} />;
  return (
    <div class="page">
      <h1 class="page-title">Новые релизы</h1>
      <div class="grid">{data.map((a) => <AlbumCard key={a.id} album={a} />)}</div>
    </div>
  );
}

const RADIO_GROUPS = [
  ["genre", "Жанры"],
  ["mood", "Настроения"],
  ["activity", "Занятия"],
  ["epoch", "Эпохи"],
  ["local-language", "Языки"],
];

export function RadioPage() {
  const { data, loading, error } = useLoad("/stations", 60 * 60 * 1000);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} />;
  return (
    <div class="page">
      <h1 class="page-title">Радио</h1>
      <p class="page-desc">Станции по жанрам, настроениям и занятиям. Анти-повтор работает и здесь.</p>
      {RADIO_GROUPS.map(([k, label]) =>
        data[k]?.length ? (
          <Section key={k} title={label}>
            <StationGrid stations={data[k]} />
          </Section>
        ) : null,
      )}
    </div>
  );
}
