// «Подкасты и книги»: the non-music landing (continue listening, my shelf, editorial tabs), category pages,
// and the podcast/audiobook page that AlbumPage switches to.
import { useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { useLoad } from "../lib/useLoad.js";
import { href } from "../lib/router.js";
import { plural, totalDuration } from "../lib/format.js";
import { nextSpeed, minutesLabel } from "../lib/episodes.js";
import { Section, Row } from "../components/Cards.jsx";
import { Loading, ErrorState, PageHead } from "../components/States.jsx";
import { Icon } from "../components/Icon.jsx";
import { PinButton } from "../components/PinButton.jsx";
import { ExplicitBadge } from "../components/TrackList.jsx";
import { EpisodeList, ShowCard, ContinueCard, showCtx, resumeIndex } from "../components/Episodes.jsx";
import { markPlayed } from "../player/podcast.js";
import * as player from "../player/engine.js";

// remembered between visits: the landing reopens on the tab the user left
const landingTab = signal(null);

function Block({ block }) {
  if (block.kind === "shows")
    return (
      <Section title={block.title}>
        <Row>
          {block.items.map((s) => (
            <ShowCard key={s.id} show={s} />
          ))}
        </Row>
      </Section>
    );
  if (block.kind === "episodes")
    return (
      <Section title={block.title}>
        <EpisodeList tracks={block.tracks} showCover showAlbum limit={5} ctx={{ title: block.title, link: "/podcasts", from: "desktop_win-non_music-playlist-default", ordered: true }} />
      </Section>
    );
  if (block.kind === "categories")
    return (
      <Section title={block.title || "Категории"}>
        <div class="pod-cats">
          {block.items.map((c) => (
            <a key={c.id} class="pod-cat" href={href(`/podcasts/category/${c.skeleton}`)} style={c.color ? { "--cat": c.color } : undefined}>
              <span>{c.title}</span>
              {c.cover && <img src={c.cover} alt="" loading="lazy" />}
            </a>
          ))}
        </div>
      </Section>
    );
  if (block.kind === "promos")
    return (
      <Section title={block.title}>
        <div class="row pod-promos">
          {block.items.map((p) => {
            const body = (
              <>
                {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div class="ph" />}
                <span class="pp-text">
                  {p.heading && <span class="pp-heading">{p.heading}</span>}
                  <span class="pp-title">{p.title}</span>
                  {p.subtitle && <span class="pp-sub">{p.subtitle}</span>}
                </span>
              </>
            );
            return p.link ? (
              <a key={p.id} class="pod-promo" href={href(p.link)}>
                {body}
              </a>
            ) : (
              <div key={p.id} class="pod-promo">
                {body}
              </div>
            );
          })}
        </div>
      </Section>
    );
  return null;
}

function Tabs({ tabs }) {
  const pick = landingTab.value && tabs.some((t) => t.id === landingTab.value) ? landingTab.value : tabs.find((t) => t.id === "podcasts")?.id || tabs[0]?.id;
  const tab = tabs.find((t) => t.id === pick);
  if (!tab) return null;
  return (
    <>
      {tabs.length > 1 && (
        <div class="home-tabs pod-tabs" role="tablist" aria-label="Разделы">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === pick} class={t.id === pick ? "on" : ""} onClick={() => (landingTab.value = t.id)}>
              {t.title || "Подборка"}
            </button>
          ))}
        </div>
      )}
      {tab.blocks.map((b) => (
        <Block key={b.id || b.title} block={b} />
      ))}
    </>
  );
}

function Shelf() {
  const { data } = useLoad("/podcasts/shelf", 60 * 1000);
  if (!data) return null;
  const { recent, saved, newEpisodes, liked } = data;
  const empty = !recent.length && !saved.length && !newEpisodes.length && !liked.podcasts.length && !liked.books.length;
  if (empty) return <p class="pod-hint">Подписывайтесь на подкасты и добавляйте книги в «Мне нравится» — здесь появится ваша полка.</p>;
  return (
    <>
      {recent.length > 0 && (
        <Section title="Вы недавно слушали">
          <Row>
            {recent
              .filter((e) => e.album)
              .map((e) => {
                const left = e.album.durationLeft > 0 ? `Осталось ${minutesLabel(e.album.durationLeft)}` : e.album.finished ? "Прослушано" : null;
                const pct = e.track?.durationMs && e.track.progress?.pos ? e.track.progress.pos / (e.track.durationMs / 1000) : 0;
                return <ShowCard key={e.album.id} show={e.album} note={left} pct={pct} trackId={e.track?.id} />;
              })}
          </Row>
        </Section>
      )}
      {newEpisodes.length > 0 && (
        <Section title="Новые выпуски">
          <EpisodeList tracks={newEpisodes.map((e) => e.track)} showCover showAlbum limit={5} ctx={{ title: "Новые выпуски", link: "/podcasts", from: "desktop_win-bookshelf-new-episodes-default", ordered: true }} />
        </Section>
      )}
      {liked.podcasts.length > 0 && (
        <Section title="Мои подкасты">
          <Row>
            {liked.podcasts.map((s) => (
              <ShowCard key={s.id} show={s} />
            ))}
          </Row>
        </Section>
      )}
      {liked.books.length > 0 && (
        <Section title="Мои книги">
          <Row>
            {liked.books.map((s) => (
              <ShowCard key={s.id} show={s} />
            ))}
          </Row>
        </Section>
      )}
      {saved.length > 0 && (
        <Section title="Вы отложили">
          <EpisodeList tracks={saved.map((e) => e.track)} showCover showAlbum limit={5} ctx={{ title: "Вы отложили", link: "/podcasts", from: "desktop_win-bookshelf-liked-default", ordered: true }} />
        </Section>
      )}
    </>
  );
}

export function PodcastsPage({ category }) {
  const path = category ? `/podcasts/category/${category}` : "/podcasts";
  const { data, loading, error, reload } = useLoad(path, 5 * 60 * 1000);
  return (
    <div class="page podcasts">
      {category && (
        <a class="pod-back" href={href("/podcasts")}>
          <Icon name="chevronLeft" size={18} /> Подкасты и книги
        </a>
      )}
      <h1 class="page-title">{category ? data?.title || "Подборка" : "Подкасты и книги"}</h1>
      {!category && data?.continue && <ContinueCard item={data.continue} />}
      {!category && <Shelf />}
      {loading && !data && <Loading />}
      {error && !data && <ErrorState error={error} retry={reload} />}
      {data && (data.tabs.length ? <Tabs tabs={data.tabs} /> : <div class="empty">Подборки пока пусты</div>)}
    </div>
  );
}

/** Podcast or audiobook page (#/album/<id> of type podcast/audiobook). */
export function ShowPage({ id }) {
  const [sort, setSort] = useState(null); // null: the server's default (podcasts newest first, books in chapter order)
  const [more, setMore] = useState(false);
  const { data, loading, error, reload } = useLoad(`/podcast/${id}${sort ? `?sort=${sort}` : ""}`, 30 * 1000);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  const { album, episodes } = data;
  const book = album.type === "audiobook";
  const ctx = showCtx(album);
  const order = album.sort || (book ? "asc" : "desc");
  const start = resumeIndex(album, episodes);
  const resuming = !!album.resumeFrom && (album.resumeFrom.pos > 0 || start > 0);
  const length = book && album.durationSec ? minutesLabel(album.durationSec) : totalDuration(episodes);
  const rate = player.rate.value;
  const onAllPlayed = () => {
    const finished = !album.finished;
    if (!confirm(finished ? `Отметить ${book ? "всю книгу" : "все выпуски"} прослушанными? Сохранённые позиции сбросятся.` : "Снять отметку «Прослушано» со всех выпусков?")) return;
    markPlayed({ albumId: album.id, tracks: episodes }, finished).then(reload);
  };
  return (
    <div class="page show-page">
      <PageHead
        cover={album.cover}
        kicker={book ? "Аудиокнига" : "Подкаст"}
        title={
          <>
            {album.title} {album.explicit && <ExplicitBadge />}
          </>
        }
        actions={
          <>
            <button class="btn primary" onClick={() => player.playList(episodes, start, ctx)} disabled={!episodes.length}>
              <Icon name="play" size={18} /> {resuming ? "Продолжить" : "Слушать"}
            </button>
            {!book && (
              <button class="btn ghost" onClick={() => setSort(order === "desc" ? "asc" : "desc")} title="Порядок выпусков">
                <Icon name={order === "desc" ? "down" : "up"} size={16} /> {order === "desc" ? "Сначала новые" : "Сначала старые"}
              </button>
            )}
            <button class="btn ghost" onClick={() => player.setRate(nextSpeed(rate))} title="Скорость воспроизведения (для всего плеера)">
              {String(rate).replace(".", ",")}×
            </button>
            <PinButton pin={{ type: "album", id: String(id), title: album.title, cover: album.cover || null }} />
            <button class={`icon-btn ${album.finished ? "on" : ""}`} onClick={onAllPlayed} aria-label={album.finished ? "Снять отметку «Прослушано»" : "Отметить всё прослушанным"} title={album.finished ? "Снять отметку «Прослушано»" : "Отметить всё прослушанным"}>
              <Icon name="check" />
            </button>
          </>
        }
      >
        <div class="page-meta">
          {album.artists.map((a, i) => (
            <>
              {i > 0 && ", "}
              <a href={href(`/artist/${a.id}`)}>{a.name}</a>
            </>
          ))}
          {album.artists.length > 0 && " · "}
          {plural(album.total || episodes.length, book ? "глава" : "выпуск", book ? "главы" : "выпуска", book ? "глав" : "выпусков")}
          {episodes.length > 0 && `, ${length}`}
        </div>
        {album.labels?.length > 0 && <div class="page-meta small">{album.labels.join(", ")}</div>}
        {album.description && (
          <p class={`page-desc show-desc ${more ? "open" : ""}`} onClick={() => setMore(!more)} title={more ? undefined : "Показать полностью"}>
            {album.description}
          </p>
        )}
        {album.bookmate && <div class="page-meta small">Книга из каталога Букмейта: без этой опции подписки главы могут не включиться.</div>}
      </PageHead>
      <EpisodeList tracks={episodes} ctx={ctx} numbered={book} />
    </div>
  );
}
