// Главная в духе Яндекс Музыки 2023–2024: «Моя волна» сверху, ниже вкладки «Для вас» и «Тренды».
import { useState } from "preact/hooks";
import { useLoad } from "../lib/useLoad.js";
import { homeTab } from "../lib/ui.js";
import { WaveHero, StationGrid } from "../components/Wave.jsx";
import { Section, Row, AlbumCard, PlaylistCard, ArtistCard } from "../components/Cards.jsx";
import { TrackList } from "../components/TrackList.jsx";
import { Loading, ErrorState } from "../components/States.jsx";

const STATION_TABS = [
  ["genre", "Жанры"],
  ["mood", "Настроения"],
  ["activity", "Занятия"],
  ["epoch", "Эпохи"],
];

function Stations({ stations }) {
  const [tab, setTab] = useState("genre");
  if (!stations) return null;
  return (
    <Section title="Настроения и жанры" link="/radio" linkText="Всё радио">
      <div class="subtabs">
        {STATION_TABS.map(([k, label]) => (
          <button key={k} class={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <StationGrid stations={stations[tab] || []} limit={tab === "genre" ? 16 : 18} />
    </Section>
  );
}

function ForYou({ data }) {
  return (
    <>
      {data.personal.length > 0 && (
        <Section title="Собрано для вас">
          <Row>
            {data.personal.map((pl) => (
              <PlaylistCard key={`${pl.uid}-${pl.kind}`} playlist={pl} note={pl.note || pl.description} />
            ))}
          </Row>
        </Section>
      )}
      {data.recent.length > 0 && (
        <Section title="Вы недавно слушали">
          <Row>
            {data.recent.map((r, i) =>
              r.type === "album" ? <AlbumCard key={i} album={r.item} /> : r.type === "artist" ? <ArtistCard key={i} artist={r.item} /> : <PlaylistCard key={i} playlist={r.item} />,
            )}
          </Row>
        </Section>
      )}
      {data.newReleases.length > 0 && (
        <Section title="Новые релизы" link="/new">
          <Row>
            {data.newReleases.slice(0, 12).map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Row>
        </Section>
      )}
    </>
  );
}

function Trends({ data }) {
  return (
    <>
      {data.chart.length > 0 && (
        <Section title="Чарт" link="/chart">
          <div class="chart-columns">
            <TrackList tracks={data.chart} chart ctx={{ title: "Чарт", link: "/chart", from: "desktop_win-chart-chart-default" }} />
          </div>
        </Section>
      )}
      {data.newReleases.length > 0 && (
        <Section title="Новые релизы" link="/new">
          <Row>
            {data.newReleases.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Row>
        </Section>
      )}
      {data.playlists.length > 0 && (
        <Section title="Популярные плейлисты">
          <Row>
            {data.playlists.map((pl) => (
              <PlaylistCard key={`${pl.uid}-${pl.kind}`} playlist={pl} />
            ))}
          </Row>
        </Section>
      )}
      <Stations stations={data.stations} />
    </>
  );
}

export function Home() {
  const { data, loading, error } = useLoad("/home", 5 * 60 * 1000);
  const tab = homeTab.value;
  return (
    <div class="page home">
      <WaveHero />
      <div class="home-tabs" role="tablist" aria-label="Разделы главной">
        {[
          ["foryou", "Для вас"],
          ["trends", "Тренды"],
        ].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} class={tab === k ? "on" : ""} onClick={() => (homeTab.value = k)}>
            {label}
          </button>
        ))}
      </div>
      {loading && !data && <Loading />}
      {error && !data && <ErrorState error={error} retry={() => location.reload()} />}
      {data && (tab === "trends" ? <Trends data={data} /> : <ForYou data={data} />)}
    </div>
  );
}
