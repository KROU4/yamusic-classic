import { describe, it, expect, vi, afterEach } from "vitest";
import {
  episodeProgress,
  normEpisode,
  normShow,
  blockUrl,
  skeletonId,
  internalLink,
  parseSkeleton,
  parseBlock,
  parseContinue,
  parseShelfEntities,
  splitLikedShows,
  progressSyncBody,
  plainText,
  Podcasts,
  podcastRoutes,
} from "../server/podcasts.js";
import { normTrack } from "../server/normalize.js";
import { syncPayload, progressOf, pubDateLabel, statusLabel, minutesLabel, nextSpeed, isEpisode } from "../src/lib/episodes.js";

const ep = (over = {}) => ({ id: 101, title: "Выпуск", durationMs: 3600_000, type: "podcast-episode", rememberPosition: true, pubDate: "2026-10-23", albums: [{ id: 7, title: "Шоу" }], ...over });

describe("episode progress (official client rules)", () => {
  it("no streamProgress — not started", () => {
    expect(episodeProgress(ep())).toEqual({ pos: 0, finished: false });
  });
  it("position mid-way resumes from endPositionSec", () => {
    expect(episodeProgress(ep({ streamProgress: { endPositionSec: 800.287, everFinished: false } }))).toEqual({ pos: 800.287, finished: false });
  });
  it("everFinished keeps the position (re-listening) but counts as played", () => {
    expect(episodeProgress(ep({ streamProgress: { endPositionSec: 120, everFinished: true } }))).toEqual({ pos: 120, finished: true });
  });
  it("less than a second left — played, start over", () => {
    expect(episodeProgress(ep({ streamProgress: { endPositionSec: 3599.5, everFinished: false } }))).toEqual({ pos: 0, finished: true });
  });
  it("finished album — every item played, positions reset", () => {
    expect(episodeProgress(ep({ streamProgress: { endPositionSec: 500, everFinished: false } }), true)).toEqual({ pos: 0, finished: true });
  });
});

describe("normalization", () => {
  it("normEpisode adds date, kind, resume flag and progress", () => {
    const e = normEpisode(ep({ shortDescription: "О разном", streamProgress: { endPositionSec: 60, everFinished: false } }));
    expect(e).toMatchObject({ id: "101", albumId: "7", kind: "podcast-episode", rememberPosition: true, pubDate: "2026-10-23", description: "О разном", progress: { pos: 60, finished: false } });
  });
  it("plainText turns description HTML into text with line breaks", () => {
    expect(plainText("Мозг.<br/><br/><br/>В этом ей помогут&nbsp;учёные &amp; врачи &#171;тут&#187;")).toBe("Мозг.\n\nВ этом ей помогут учёные & врачи «тут»");
    expect(plainText("<p>Один</p><p>Два <b>жирно</b></p>")).toBe("Один\nДва жирно");
    expect(plainText(null)).toBe("");
  });
  it("normTrack keeps the resume flag for episodes and leaves music untouched", () => {
    expect(normTrack(ep())).toMatchObject({ kind: "podcast-episode", rememberPosition: true });
    const music = normTrack({ id: 1, title: "Song", type: "music" });
    expect("rememberPosition" in music).toBe(false);
    expect("kind" in music).toBe(false);
  });
  it("normShow reads cover.uri of landing items and the Bookmate flag", () => {
    const s = normShow({ id: 5, title: "Книга", type: "audiobook", cover: { uri: "avatars.yandex.net/x/%%" }, durationSec: 7200 }, { bookmateOptionRequired: true });
    expect(s).toMatchObject({ id: 5, type: "audiobook", cover: "https://avatars.yandex.net/x/300x300", bookmate: true, durationSec: 7200 });
    // podcasts carry availableForOptions:["bookmate"] too: it must not mark them as Bookmate-only
    expect(normShow({ id: 6, title: "П", availableForOptions: ["bookmate"] }).bookmate).toBe(false);
    expect(normShow({ id: 8, title: "Ш", albumType: "podcast" }).type).toBe("podcast");
    expect(normShow(null)).toBe(null);
  });
});

describe("landing blocks", () => {
  it("blockUrl appends count with & when the uri has a query, limit for track charts", () => {
    expect(blockUrl({ uri: "/landing-blocks/non-music/continue-listen?type=ALL", countWeb: 0 })).toBe("/landing-blocks/non-music/continue-listen?type=ALL");
    expect(blockUrl({ uri: "/a?type=ALL", countWeb: 10 })).toBe("/a?type=ALL&count=10");
    expect(blockUrl({ uri: "/a", countWeb: 5 })).toBe("/a?count=5");
    expect(blockUrl({ uri: "/c", countWeb: 5 }, "CHART_TRACKS")).toBe("/c?limit=5");
  });
  it("blockUrl refuses absolute and protocol-relative uris", () => {
    expect(blockUrl({ uri: "https://evil.example/x" })).toBe(null);
    expect(blockUrl({ uri: "//evil.example/x" })).toBe(null);
    expect(blockUrl(null)).toBe(null);
  });
  it("category links: skeleton id from /landing/<id>, other links mapped or dropped", () => {
    expect(skeletonId("/landing/category_non-music_comedy")).toBe("category_non-music_comedy");
    expect(skeletonId("/non-music/category/comedy")).toBe(null);
    expect(internalLink("/album/30251608")).toBe("/album/30251608");
    expect(internalLink("https://music.yandex.ru/album/5?x=1")).toBe("/album/5");
    expect(internalLink("/users/music-blog/playlists/2453")).toBe("/playlist/music-blog/2453");
    expect(internalLink("/landing/category_non-music_kids")).toBe("/podcasts/category/category_non-music_kids");
    expect(internalLink("/promo/whatever")).toBe(null);
  });
  it("parseSkeleton: continue source, tabs with supported blocks only", () => {
    const sk = parseSkeleton({
      title: "Книги и подкасты",
      blocks: [
        { id: "my_shelf", type: "CONTINUE_LISTEN", data: { source: { uri: "/landing-blocks/non-music/continue-listen?type=ALL", countWeb: 0 } } },
        {
          id: "TABS_BLOCK",
          type: "TABS",
          data: {
            tabs: [
              { id: "audiobooks", title: "Книги", blocks: [{ id: "b1", type: "NON_MUSIC_EDITORIAL_COMPILATION", data: { title: "Новинки", source: { uri: "/landing/block/non-music/editorial/compilation/1" } } }, { id: "d", type: "DYNAMIC_BANNER", data: {} }] },
              { id: "podcasts", title: "Подкасты", blocks: [{ id: "b2", type: "NON_MUSIC_BANNER", data: { source: { uri: "/landing-blocks/non-music/banner/1" } } }] },
            ],
          },
        },
      ],
    });
    expect(sk.continueUrl).toBe("/landing-blocks/non-music/continue-listen?type=ALL");
    expect(sk.tabs).toEqual([{ id: "audiobooks", title: "Книги", blocks: [{ id: "b1", type: "NON_MUSIC_EDITORIAL_COMPILATION", title: "Новинки", url: "/landing/block/non-music/editorial/compilation/1" }] }]);
  });
  it("parseSkeleton: loose blocks of a category skeleton form an untitled tab", () => {
    const sk = parseSkeleton({ blocks: [{ id: "x", type: "CHART_ALBUMS", data: { title: "Чарт", source: { uri: "/landing/block/chart/album/podkst_chart_web" } } }] });
    expect(sk.tabs[0]).toMatchObject({ id: "main", title: "", blocks: [{ type: "CHART_ALBUMS" }] });
  });
  it("parseBlock: album compilations and charts", () => {
    const ref = { id: "b", type: "CHART_ALBUMS", title: "Чарт подкастов" };
    const out = parseBlock(ref, { items: [{ type: "chart_album_item", data: { album: { id: 1, title: "MINAEV LIVE", type: "podcast", cover: { uri: "a/%%" } }, chart: { position: 1, progress: "same" } } }, { type: "x", data: {} }] });
    expect(out.kind).toBe("shows");
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ id: 1, chart: { position: 1, progress: "same" } });
    expect(parseBlock(ref, { items: [] })).toBe(null);
  });
  it("parseBlock: open playlist of episodes, mixes grid, promotions; unknown types dropped", () => {
    const eps = parseBlock({ id: "p", type: "NON_MUSIC_OPEN_PLAYLIST", title: "" }, { playlist: { title: "Лучшее" }, tracks: [ep()] });
    expect(eps).toMatchObject({ kind: "episodes", title: "Лучшее" });
    expect(eps.tracks[0].pubDate).toBe("2026-10-23");
    const mixes = parseBlock({ id: "m", type: "MIXES_GRID", title: "Категории" }, { items: [{ type: "mix_card_item", data: { id: "podcasts_category_comedy", title: "Юмор", action: { weblink: "/landing/category_non-music_comedy" }, covers: [{ uri: "c/%%", color: "#f00" }] } }, { data: { id: "bad", title: "Без ссылки", action: { weblink: "/somewhere" } } }] });
    expect(mixes.items).toEqual([{ id: "podcasts_category_comedy", title: "Юмор", cover: "https://c/200x200", color: "#f00", skeleton: "category_non-music_comedy" }]);
    const promos = parseBlock({ id: "e", type: "EDITORIAL_PROMOTIONS", title: "" }, { promotions: [{ featureId: "f1", title: "Новый сезон", action: { weblink: "/album/30251608" }, imageUrl: "i/%%" }] });
    expect(promos.items[0]).toMatchObject({ id: "f1", link: "/album/30251608", image: "https://i/orig" });
    expect(parseBlock({ id: "z", type: "NON_MUSIC_BANNER" }, { id: 1 })).toBe(null);
  });
  it("parseContinue: last played episode or nothing", () => {
    const c = parseContinue({ lastPlayed: { type: "album", data: { album: { id: 19, title: "Шоу", albumType: "podcast", cover: { uri: "x/%%" } }, track: ep({ streamProgress: { endPositionSec: 800, everFinished: false } }), durationTotal: 6000, durationLeft: 4915 } } });
    expect(c).toMatchObject({ album: { id: 19 }, track: { id: "101", progress: { pos: 800 } }, durationLeft: 4915 });
    expect(parseContinue({ bookshelf: {} })).toBe(null);
  });
  it("shelf entities and liked shows split by album.type", () => {
    const list = parseShelfEntities([{ type: "album", album: { id: 1, title: "А", listeningFinished: false, durationLeft: 100 }, track: ep(), listeningDate: "2026-10-27T10:00:00Z" }, null]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ album: { id: 1, durationLeft: 100 }, track: { id: "101" }, date: "2026-10-27T10:00:00Z" });
    const split = splitLikedShows([{ album: { id: 1, title: "П", type: "podcast" } }, { album: { id: 2, title: "К", type: "audiobook" } }]);
    expect(split.podcasts.map((s) => s.id)).toEqual([1]);
    expect(split.books.map((s) => s.id)).toEqual([2]);
  });
});

describe("progress sync", () => {
  it("server body matches ContinuePlayingPlugin", () => {
    const now = new Date("2026-10-28T12:00:00.000Z");
    expect(progressSyncBody({ trackId: 101, positionSec: 800, trackLengthSec: 3600, finished: false }, now)).toEqual({
      lastSyncTimestamp: "2026-10-28T12:00:00.000Z",
      trackStreams: [{ trackId: "101", positionSec: 800, trackLengthSec: 3600, finished: false, timestamp: "2026-10-28T12:00:00.000Z" }],
    });
  });
  it("client payload: floors, never sends zero, reports the tail as finished", () => {
    expect(syncPayload("1", 800.9, 3600.4)).toEqual({ trackId: "1", positionSec: 800, trackLengthSec: 3600, finished: false });
    expect(syncPayload("1", 0.4, 3600)).toBe(null);
    expect(syncPayload("1", 10, 0)).toBe(null);
    expect(syncPayload("1", 3599.7, 3600.2)).toEqual({ trackId: "1", positionSec: 3600, trackLengthSec: 3600, finished: true });
  });
});

describe("Podcasts service", () => {
  const OLD = process.env.YMC_NO_REPORT;
  afterEach(() => {
    if (OLD === undefined) delete process.env.YMC_NO_REPORT;
    else process.env.YMC_NO_REPORT = OLD;
  });
  const make = (api) => new Podcasts({ api, log: () => {}, requireAuth: () => {}, decorate: (t) => t, cache: new Map(), cached: (k, ttl, fn) => fn() });

  it("sync posts the official JSON body and skips zero positions", async () => {
    delete process.env.YMC_NO_REPORT;
    const post = vi.fn().mockResolvedValue("ok");
    const p = make({ post });
    expect(await p.sync({ trackId: "5", positionSec: 0, trackLengthSec: 100 })).toEqual({ skipped: true });
    expect(post).not.toHaveBeenCalled();
    await p.sync({ trackId: "5", positionSec: 100, trackLengthSec: 100 });
    expect(post).toHaveBeenCalledTimes(1);
    const [url, opts] = post.mock.calls[0];
    expect(url).toBe("/streams/progress/sync");
    expect(opts.json.trackStreams[0]).toMatchObject({ trackId: "5", positionSec: 100, trackLengthSec: 100, finished: true });
  });
  it("YMC_NO_REPORT turns sync and marks into no-ops", async () => {
    process.env.YMC_NO_REPORT = "1";
    const post = vi.fn();
    const p = make({ post });
    expect(await p.sync({ trackId: "5", positionSec: 10, trackLengthSec: 100 })).toEqual({ skipped: true });
    expect(await p.mark({ trackId: "5", finished: true })).toEqual({ skipped: true });
    expect(post).not.toHaveBeenCalled();
  });
  it("mark uses query parameters for episodes and albums", async () => {
    delete process.env.YMC_NO_REPORT;
    const post = vi.fn().mockResolvedValue("ok");
    const p = make({ post });
    await p.mark({ trackId: "5", finished: true });
    await p.mark({ albumId: "9", finished: false });
    expect(post.mock.calls).toEqual([
      ["/streams/progress/mark-finished", { query: { trackId: "5" } }],
      ["/streams/progress/mark-album-unfinished", { query: { albumId: "9" } }],
    ]);
    await expect(p.mark({ finished: true })).rejects.toThrow();
  });
  it("progress asks /tracks withProgress and maps by id", async () => {
    const post = vi.fn().mockResolvedValue([ep({ id: 5, streamProgress: { endPositionSec: 42, everFinished: false } })]);
    const p = make({ post });
    expect(await p.progress(["5", "bad", "5"])).toEqual({ 5: { pos: 42, finished: false } });
    expect(post).toHaveBeenCalledWith("/tracks", { form: { "track-ids": "5", withProgress: "true" } });
  });
  it("album collects every page when the server pages the list, resume point included", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ id: 7, title: "Шоу", type: "podcast", pager: { page: 0, perPage: 2, total: 3 }, volumes: [[ep({ id: 1 }), ep({ id: 2 })]], resumeFrom: { trackId: 3, startPositionSec: 12 } })
      .mockResolvedValueOnce({ volumes: [[ep({ id: 3 })]] });
    const p = make({ get });
    const r = await p.album("7", "desc");
    expect(r.episodes.map((e) => e.id)).toEqual(["1", "2", "3"]);
    expect(r.album.resumeFrom).toEqual({ trackId: "3", pos: 12 });
    expect(get.mock.calls[0][1].query).toMatchObject({ richTracks: "true", withListeningFinished: "true", resumeStream: "true", "sort-order": "desc" });
    expect(get.mock.calls[1][1].query).toMatchObject({ page: 1, pageSize: 2 });
  });
  it("one failing landing block doesn't break the page", async () => {
    const get = vi.fn(async (url) => {
      if (url.startsWith("/landing/skeleton/")) return { title: "Книги и подкасты", blocks: [{ type: "TABS", data: { tabs: [{ id: "podcasts", title: "Подкасты", blocks: [{ id: "a", type: "CHART_ALBUMS", data: { title: "Чарт", source: { uri: "/ok" } } }, { id: "b", type: "CHART_ALBUMS", data: { source: { uri: "/fail" } } }] }] } }] };
      if (url === "/ok") return { items: [{ data: { album: { id: 1, title: "A" } } }] };
      throw new Error("boom");
    });
    const r = await make({ get }).landing();
    expect(r.continue).toBe(null);
    expect(r.tabs[0].blocks).toHaveLength(1);
    await expect(make({ get }).landing("../../x")).rejects.toThrow();
  });
  it("routes are registered without touching svc.podcasts at build time", () => {
    const routes = podcastRoutes({});
    expect(routes.some(([m, re]) => m === "GET" && re.test("/api/podcast/123"))).toBe(true);
    expect(routes.some(([m, re]) => m === "GET" && re.test("/api/podcasts/category/category_non-music_comedy"))).toBe(true);
  });
});

describe("episode UI helpers", () => {
  it("isEpisode keys on rememberPosition", () => {
    expect(isEpisode({ rememberPosition: true })).toBe(true);
    expect(isEpisode({ id: 1 })).toBe(false);
  });
  it("progressOf: local changes win, percentage of duration", () => {
    const t = { durationMs: 100_000, progress: { pos: 50, finished: false } };
    expect(progressOf(t)).toEqual({ pos: 50, finished: false, pct: 0.5 });
    expect(progressOf(t, { pos: 0, finished: true })).toEqual({ pos: 0, finished: true, pct: 0 });
    expect(progressOf(t, { pos: 75 })).toMatchObject({ pos: 75, finished: false });
  });
  it("dates, lengths and status labels in Russian", () => {
    const now = new Date(2026, 9, 28, 12);
    expect(pubDateLabel("2026-10-28", now)).toBe("Сегодня");
    expect(pubDateLabel("2026-10-27", now)).toBe("Вчера");
    expect(pubDateLabel("2026-10-23", now)).toBe("23 окт.");
    expect(pubDateLabel("2025-05-02", now)).toBe("2 мая 2025");
    expect(pubDateLabel(null, now)).toBe("");
    expect(minutesLabel(45 * 60)).toBe("45 мин");
    expect(minutesLabel(65 * 60)).toBe("1 ч 05 мин");
    expect(statusLabel({ pos: 0, finished: true }, 60_000)).toBe("Прослушано");
    expect(statusLabel({ pos: 30 * 60, finished: false }, 3600_000)).toBe("Осталось 30 мин");
    expect(statusLabel({ pos: 0, finished: false }, 3600_000)).toBe("1 ч 00 мин");
  });
  it("speed button cycles the official steps and wraps to 1×", () => {
    expect(nextSpeed(1)).toBe(1.25);
    expect(nextSpeed(1.75)).toBe(2);
    expect(nextSpeed(2)).toBe(1);
    expect(nextSpeed(0.75)).toBe(1);
  });
});
