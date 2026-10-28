// «Моя статистика» — что и когда вы слушали. Считается по локальному журналу клиента.
import { useState } from "preact/hooks";
import { useLoad } from "../lib/useLoad.js";
import { api, dropCache } from "../lib/api.js";
import { href } from "../lib/router.js";
import { plural } from "../lib/format.js";
import { toast } from "../lib/toast.js";
import { TrackList } from "../components/TrackList.jsx";
import { Section } from "../components/Cards.jsx";
import { Loading, ErrorState } from "../components/States.jsx";
import * as player from "../player/engine.js";
import { Icon } from "../components/Icon.jsx";

const PERIODS = [
  [7, "Неделя"],
  [30, "Месяц"],
  [90, "3 месяца"],
  [365, "Год"],
];

function hours(sec) {
  if (sec < 60) return `${Math.round(sec)} с`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

function Tile({ value, label }) {
  return (
    <div class="tile">
      <div class="tile-value">{value}</div>
      <div class="tile-label">{label}</div>
    </div>
  );
}

function Bars({ items, labelOf, titleOf, highlight }) {
  const max = Math.max(1, ...items.map((x) => x.v));
  return (
    <div class="bars" role="img" aria-label="График прослушиваний">
      {items.map((x, i) => (
        <div key={i} class="bar-col" title={titleOf(x, i)}>
          <div class={`bar ${highlight === i ? "hl" : ""}`} style={{ height: `${Math.max(2, (x.v / max) * 100)}%` }} />
          <span class="bar-label">{labelOf(x, i)}</span>
        </div>
      ))}
    </div>
  );
}

export function StatsPage() {
  const [days, setDays] = useState(30);
  const tz = new Date().getTimezoneOffset();
  const path = `/stats?days=${days}&tz=${tz}`;
  const { data, loading, error } = useLoad(path, 30000);

  const clear = async () => {
    if (!confirm("Удалить всю локальную статистику прослушиваний? Это нельзя отменить.")) return;
    await api.post("/stats/clear");
    dropCache("/stats");
    toast("Статистика очищена");
    location.reload();
  };

  return (
    <div class="page stats">
      <div class="stats-head">
        <div>
          <h1 class="page-title">Моя статистика</h1>
          <p class="page-desc">Считается на этом компьютере по тому, что вы слушали в YM Classic. Никуда не отправляется.</p>
        </div>
        <div class="chips">
          {PERIODS.map(([d, l]) => (
            <button key={d} class={`chip ${days === d ? "on" : ""}`} onClick={() => setDays(d)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {loading && !data && <Loading />}
      {error && !data && <ErrorState error={error} />}
      {data && data.plays === 0 && (
        <div class="state">
          <Icon name="stats" size={40} />
          <p>За этот период прослушиваний пока нет. Включите «Мою волну» — статистика начнёт собираться.</p>
        </div>
      )}
      {data && data.plays > 0 && (
        <>
          <div class="tiles">
            <Tile value={hours(data.totalSeconds)} label="музыки" />
            <Tile value={data.plays} label={plural(data.plays, "прослушивание", "прослушивания", "прослушиваний").replace(/^\d+ /, "")} />
            <Tile value={data.uniqueTracks} label="разных треков" />
            <Tile value={data.uniqueArtists} label="исполнителей" />
            <Tile value={data.streak} label={`${plural(data.streak, "день", "дня", "дней").replace(/^\d+ /, "")} подряд`} />
          </div>

          <div class="stats-charts">
            <Section title="По дням">
              <Bars
                items={(days > 31 ? data.byDay.slice(-31) : data.byDay).map((d) => ({ v: d.seconds, day: d.day }))}
                labelOf={(x, i, arr) => (days <= 7 ? new Date(x.day).toLocaleDateString("ru-RU", { weekday: "short" }) : i % 5 === 0 ? x.day.slice(8) : "")}
                titleOf={(x) => `${new Date(x.day).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}: ${hours(x.v)}`}
              />
            </Section>
            <Section title="По времени суток">
              <Bars
                items={data.byHour.map((v) => ({ v }))}
                labelOf={(x, i) => (i % 3 === 0 ? String(i).padStart(2, "0") : "")}
                titleOf={(x, i) => `${String(i).padStart(2, "0")}:00 — ${hours(x.v)}`}
                highlight={data.peakHour}
              />
              {data.peakHour != null && <p class="muted small">Чаще всего вы слушаете музыку около {String(data.peakHour).padStart(2, "0")}:00</p>}
            </Section>
          </div>

          <Section title="Любимые исполнители">
            <div class="top-artists">
              {data.topArtists.map((a, i) => (
                <a key={a.id} class="top-artist" href={href(`/artist/${a.id}`)}>
                  <span class="top-rank">{i + 1}</span>
                  {a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <div class="ph" />}
                  <span class="top-name">{a.name}</span>
                  <span class="muted small">{hours(a.seconds)}</span>
                </a>
              ))}
            </div>
          </Section>

          <Section title="Самые частые треки">
            <div class="page-actions">
              <button class="btn primary" onClick={() => player.playList(data.topTracks, 0, { title: "Моя статистика", link: "/stats", from: "desktop_win-own_tracks-track-default" })}>
                <Icon name="play" size={18} /> Слушать топ
              </button>
            </div>
            <TrackList tracks={data.topTracks} numbered ctx={{ title: "Моя статистика", link: "/stats", from: "desktop_win-own_tracks-track-default" }} />
          </Section>

          <div class="stats-foot">
            <button class="btn ghost" onClick={clear}>
              <Icon name="trash" size={16} /> Очистить статистику
            </button>
          </div>
        </>
      )}
    </div>
  );
}
