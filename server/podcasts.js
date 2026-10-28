// Podcasts and audiobooks («Подкасты и книги»): the non-music landing, the bookshelf, episode lists and
// listening progress. Endpoints and rules follow the official client 5.124.1 (landing skeleton "non_music",
// getAlbumWithRichTracks, ContinuePlayingPlugin). None of the GET endpoints need a signature.
import { ApiError } from "./yandex.js";
import { normTrack, normAlbum, coverUrl } from "./normalize.js";

// Test runs (YMC_NO_REPORT=1) must not touch the account: progress sync and "mark as played" become no-ops
const NO_REPORT = () => process.env.YMC_NO_REPORT === "1";

// Block types we can render; the rest (banners, Bookmate ads, dynamic banners) are skipped like unknown ones
const ALBUM_BLOCKS = new Set(["NON_MUSIC_EDITORIAL_COMPILATION", "EDITORIAL_COMPILATION", "CHART_ALBUMS"]);
const SUPPORTED = new Set([...ALBUM_BLOCKS, "NON_MUSIC_OPEN_PLAYLIST", "MIXES_GRID", "EDITORIAL_PROMOTIONS"]);

const isId = (v) => /^\d+$/.test(String(v ?? ""));

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–" };

/** Removes tags until none are left: one pass would turn "<<b>i>" into a fresh "<i>". */
function stripTags(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^<>]*>/g, "");
  } while (s !== prev);
  return s;
}

/** Descriptions come with HTML (<br/>, <p>, entities); the UI renders plain text with line breaks. */
export function plainText(s) {
  if (typeof s !== "string" || !s) return "";
  return stripTags(s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*/gi, "\n"))
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Episode state as the official client computes it: "finished" is everFinished, a finished album, or less than
 * a second left. The resume position is endPositionSec, except for a played-out tail or a finished album (start over).
 * The raw field is streamProgress.everFinished (hasEverFinished is only the client model's name).
 */
export function episodeProgress(t, albumFinished = false) {
  const dur = (t?.durationMs || 0) / 1000;
  const sp = t?.streamProgress;
  if (albumFinished) return { pos: 0, finished: true };
  if (!sp || typeof sp.endPositionSec !== "number") return { pos: 0, finished: false };
  const tail = dur > 0 && dur - sp.endPositionSec < 1;
  return { pos: tail ? 0 : Math.max(0, sp.endPositionSec), finished: !!sp.everFinished || tail };
}

/** A track plus what an episode/chapter row needs (publication date, progress, resume flag). */
export function normEpisode(t, albumFinished = false) {
  const base = normTrack(t);
  if (!base) return null;
  return {
    ...base,
    kind: t.type || null,
    rememberPosition: t.rememberPosition === true,
    pubDate: t.pubDate || null,
    description: plainText(t.shortDescription),
    progress: episodeProgress(t, albumFinished),
  };
}

/** Podcast/audiobook album; landing items carry the cover as cover.uri instead of coverUri. */
export function normShow(a, extra = {}) {
  const base = normAlbum(a);
  if (!base || base.id == null) return null;
  return {
    ...base,
    type: a.type || a.albumType || base.type, // continue-listen albums name it albumType
    cover: coverUrl(a.coverUri || a.cover?.uri, 300),
    // books that need the Bookmate option on top of Plus; availableForOptions:["bookmate"] is set on podcasts too,
    // so only the explicit flag counts
    bookmate: extra.bookmateOptionRequired === true || a.bookmateOptionRequired === true,
    finished: a.listeningFinished === true,
    durationSec: typeof a.durationSec === "number" ? a.durationSec : null,
    durationLeft: typeof a.durationLeft === "number" ? a.durationLeft : null,
  };
}

/**
 * URL of a landing block. source.uri is relative to the API base; countWeb > 0 asks for that many items
 * (limit for track charts). The uri may already carry a query (?type=ALL), hence & vs ?.
 */
export function blockUrl(source, type) {
  const uri = source?.uri;
  if (typeof uri !== "string" || !uri.startsWith("/") || uri.startsWith("//")) return null;
  const n = Number(source.countWeb) || 0;
  if (n <= 0) return uri;
  return `${uri}${uri.includes("?") ? "&" : "?"}${type === "CHART_TRACKS" ? "limit" : "count"}=${n}`;
}

/** Category skeleton id from a mix card link: /landing/category_non-music_comedy -> category_non-music_comedy. */
export function skeletonId(weblink) {
  const m = /^\/landing\/([\w.-]+)\/?$/.exec(String(weblink || ""));
  return m ? m[1] : null;
}

/** Official web links that have a page in this client; anything else is shown without a link. */
export function internalLink(weblink) {
  const s = String(weblink || "").replace(/^https?:\/\/music\.yandex\.\w+/, "");
  let m;
  if ((m = /^\/album\/(\d+)(?:[/?#]|$)/.exec(s))) return `/album/${m[1]}`;
  if ((m = /^\/artist\/(\d+)(?:[/?#]|$)/.exec(s))) return `/artist/${m[1]}`;
  if ((m = /^\/users\/([\w.-]+)\/playlists\/(\d+)(?:[/?#]|$)/.exec(s))) return `/playlist/${m[1]}/${m[2]}`;
  const sk = skeletonId(s.split(/[?#]/)[0]);
  return sk ? `/podcasts/category/${sk}` : null;
}

/** Promotion banners only exist in a few sizes (square ones like 600x600 fail); "orig" is the wide original. */
export function promoImage(uri) {
  if (typeof uri !== "string" || !uri) return null;
  const clean = uri.replace("%%", "orig");
  return clean.startsWith("http") ? clean : `https://${clean}`;
}

/** Skeleton -> the "continue listening" source and tabs of loadable blocks. */
export function parseSkeleton(sk) {
  const out = { title: sk?.title || "", continueUrl: null, tabs: [] };
  const loose = [];
  const blockRef = (b) => (SUPPORTED.has(b?.type) && blockUrl(b.data?.source, b.type) ? { id: b.id, type: b.type, title: b.data?.title || "", url: blockUrl(b.data.source, b.type) } : null);
  for (const b of sk?.blocks || []) {
    if (b?.type === "CONTINUE_LISTEN") out.continueUrl = blockUrl(b.data?.source, b.type);
    else if (b?.type === "TABS") {
      for (const tab of b.data?.tabs || []) {
        const blocks = (tab.blocks || []).map(blockRef).filter(Boolean);
        if (blocks.length) out.tabs.push({ id: String(tab.id || out.tabs.length), title: tab.title || "", blocks });
      }
    } else {
      const ref = blockRef(b);
      if (ref) loose.push(ref);
    }
  }
  // category skeletons may come without tabs: their blocks form one untitled tab
  if (loose.length) out.tabs.unshift({ id: "main", title: "", blocks: loose });
  return out;
}

/** A loaded block -> what the page renders; null when the block is empty or of an unknown shape. */
export function parseBlock(ref, body) {
  const base = { id: ref.id, type: ref.type, title: ref.title };
  if (ALBUM_BLOCKS.has(ref.type)) {
    const items = (body?.items || [])
      .map((it) => {
        const show = normShow(it?.data?.album, it?.data || {});
        if (!show) return null;
        const chart = it.data.chart;
        return chart ? { ...show, chart: { position: chart.position ?? null, progress: chart.progress || null } } : show;
      })
      .filter(Boolean);
    return items.length ? { ...base, kind: "shows", items } : null;
  }
  if (ref.type === "NON_MUSIC_OPEN_PLAYLIST") {
    const tracks = (body?.tracks || []).map((t) => normEpisode(t)).filter(Boolean);
    return tracks.length ? { ...base, kind: "episodes", title: ref.title || body?.playlist?.title || "", tracks } : null;
  }
  if (ref.type === "MIXES_GRID") {
    const items = (body?.items || [])
      .map((it) => {
        const d = it?.data;
        const sk = skeletonId(d?.action?.weblink);
        return d && sk ? { id: String(d.id || sk), title: d.title || "", cover: coverUrl(d.covers?.[0]?.uri, 200), color: d.covers?.[0]?.color || null, skeleton: sk } : null;
      })
      .filter(Boolean);
    return items.length ? { ...base, kind: "categories", items } : null;
  }
  if (ref.type === "EDITORIAL_PROMOTIONS") {
    const items = (body?.promotions || [])
      .map((p) => (p ? { id: String(p.featureId || p.title || ""), title: p.title || "", subtitle: p.subtitle || "", heading: p.heading || "", image: promoImage(p.imageUrl), link: internalLink(p.action?.weblink) } : null))
      .filter((p) => p && (p.title || p.image));
    return items.length ? { ...base, kind: "promos", items } : null;
  }
  return null;
}

/** continue-listen block: the last played episode (absent for users without history). */
export function parseContinue(body) {
  const lp = body?.lastPlayed?.data;
  const show = normShow(lp?.album);
  const track = lp?.track ? normEpisode(lp.track, lp.album?.listeningFinished === true) : null;
  if (!show || !track) return null;
  return { album: show, track, durationLeft: lp.durationLeft ?? null, durationTotal: lp.durationTotal ?? null };
}

/** Bookshelf entities ({type:"album", album, track, listeningDate}) -> { album, track, date }. */
export function parseShelfEntities(list) {
  return (list || [])
    .map((e) => {
      const album = e?.album ? normShow(e.album) : null;
      const raw = e?.track || (e?.type === "track" ? e.data || null : null);
      const track = raw ? normEpisode(raw, e?.album?.listeningFinished === true) : null;
      return album || track ? { album, track, date: e.listeningDate || null } : null;
    })
    .filter(Boolean);
}

/** Liked non-music albums come in one list (audiobooks also have metaType "podcast"); split by album.type. */
export function splitLikedShows(albums) {
  const out = { podcasts: [], books: [] };
  for (const x of albums || []) {
    const raw = x?.album || x;
    const show = normShow(raw);
    if (!show) continue;
    (show.type === "audiobook" ? out.books : out.podcasts).push(show);
  }
  return out;
}

/** Body of POST /streams/progress/sync exactly as ContinuePlayingPlugin builds it. */
export function progressSyncBody({ trackId, positionSec, trackLengthSec, finished }, now = new Date()) {
  const ts = now.toISOString();
  return { lastSyncTimestamp: ts, trackStreams: [{ trackId: String(trackId), positionSec, trackLengthSec, finished, timestamp: ts }] };
}

const MAX_PAGES = 40; // a podcast with thousands of episodes: stop at 40 extra pages instead of hammering the API

export class Podcasts {
  constructor(svc) {
    this.svc = svc;
  }

  get api() {
    return this.svc.api;
  }

  async loadBlocks(tabs) {
    // ~30 blocks per landing: at most 6 requests in flight, so the API doesn't answer 429
    const refs = tabs.flatMap((tab) => tab.blocks);
    const results = new Map();
    let next = 0;
    const worker = async () => {
      while (next < refs.length) {
        const ref = refs[next++];
        // one broken block must not take the whole page down
        results.set(ref, await this.api.get(ref.url).then((b) => parseBlock(ref, b)).catch((e) => (this.svc.log("podcast block failed", ref.type, e.message), null)));
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, refs.length) }, worker));
    return tabs.map((tab) => ({ id: tab.id, title: tab.title, blocks: tab.blocks.map((ref) => results.get(ref)).filter(Boolean) })).filter((t) => t.blocks.length);
  }

  /** Landing (skeleton "non_music") or a category skeleton; editorial blocks are cached, "continue" is always fresh. */
  async landing(id = "non_music") {
    this.svc.requireAuth();
    if (!/^[\w.-]{1,80}$/.test(id)) throw new ApiError("Неверная категория", 400);
    const page = await this.svc.cached(`podcasts:${id}`, 5 * 60 * 1000, async () => {
      const sk = parseSkeleton(await this.api.get(`/landing/skeleton/${id}`));
      return { title: sk.title, continueUrl: sk.continueUrl, tabs: await this.loadBlocks(sk.tabs) };
    });
    const cont = page.continueUrl ? await this.api.get(page.continueUrl).then(parseContinue).catch(() => null) : null;
    return { title: page.title, continue: cont, tabs: page.tabs };
  }

  /** «Моя полка»: recently played, saved episodes, new episodes of subscriptions, liked podcasts and books. */
  async shelf() {
    this.svc.requireAuth();
    const uid = this.api.uid;
    const soft = (p) => p.catch((e) => (this.svc.log("shelf part failed", e.message), null));
    const [recent, saved, fresh, liked] = await Promise.all([
      soft(this.api.get("/non-music/bookshelf/recently-played", { query: { page: 0, pageSize: 20 } })),
      soft(this.api.get("/non-music/bookshelf/liked", { query: { page: 0, pageSize: 20 } })),
      soft(this.api.get("/non-music/new-episodes")),
      soft(this.api.get(`/users/${uid}/likes/albums/page`, { query: { rich: "true", page: 0, pageSize: 50, metaType: "podcast" } })),
    ]);
    const newEpisodes = (fresh?.blocks || []).flatMap((b) => parseShelfEntities(b.entities)).filter((e) => e.track);
    const decorate = (list) => list.map((e) => (e.track ? { ...e, track: this.svc.decorate([e.track])[0] } : e));
    return {
      recent: decorate(parseShelfEntities(recent?.entities)),
      saved: decorate(parseShelfEntities(saved?.entities).filter((e) => e.track)),
      newEpisodes: decorate(newEpisodes),
      liked: splitLikedShows(liked?.albums),
    };
  }

  /** Podcast or audiobook with all episodes/chapters, progress and the resume point. sort: desc|asc|undefined (server default). */
  async album(id, sort) {
    this.svc.requireAuth();
    const query = { richTracks: "true", withListeningFinished: "true", resumeStream: "true" };
    if (sort === "asc" || sort === "desc") query["sort-order"] = sort;
    const r = await this.api.get(`/albums/${id}/with-tracks`, { query });
    let raw = (r?.volumes || []).flat();
    // the full list normally comes at once; if the server paged it, collect the rest so resumeFrom is never off-page
    const total = r?.pager?.total || 0;
    const perPage = r?.pager?.perPage || 0;
    for (let page = (r?.pager?.page || 0) + 1; perPage > 0 && raw.length < total && page <= MAX_PAGES; page++) {
      const more = await this.api.get(`/albums/${id}/with-tracks`, { query: { ...query, page, pageSize: perPage } });
      const got = (more?.volumes || []).flat();
      if (!got.length) break;
      raw = raw.concat(got);
    }
    const finished = r?.listeningFinished === true;
    const episodes = this.svc.decorate(raw.map((t) => normEpisode(t, finished)).filter(Boolean));
    const show = normShow(r) || {};
    return {
      album: {
        ...show,
        cover: coverUrl(r?.coverUri || r?.cover?.uri, 400),
        description: plainText(r?.description || r?.shortDescription),
        labels: (r?.labels || []).map((l) => l?.name).filter(Boolean),
        sort: r?.sortOrder || sort || null,
        total: total || r?.trackCount || episodes.length,
        resumeFrom: r?.resumeFrom?.trackId != null ? { trackId: String(r.resumeFrom.trackId), pos: Number(r.resumeFrom.startPositionSec) || 0 } : null,
        lastListened: r?.lastListened?.trackId != null ? { trackId: String(r.lastListened.trackId), pos: Number(r.lastListened.endPositionSec) || 0, finished: !!r.lastListened.finished } : null,
      },
      episodes,
    };
  }

  /** Fresh progress for the given tracks (POST /tracks with withProgress; without it streamProgress is absent). */
  async progress(ids) {
    this.svc.requireAuth();
    const list = [...new Set((ids || []).map(String).filter(isId))].slice(0, 100);
    if (!list.length) return {};
    const tracks = await this.api.post("/tracks", { form: { "track-ids": list.join(","), withProgress: "true" } });
    const out = {};
    for (const t of tracks || []) if (t?.id != null) out[String(t.id)] = episodeProgress(t);
    return out;
  }

  /**
   * Saves the position of a rememberPosition track (pause, track change, every 30 s while playing).
   * Positions of zero are never sent (the official client skips them too): that is what protects the saved
   * position from a few seconds played before the resume seek landed.
   */
  async sync(b) {
    this.svc.requireAuth();
    const positionSec = Math.floor(Number(b?.positionSec));
    const trackLengthSec = Math.floor(Number(b?.trackLengthSec));
    if (!isId(b?.trackId) || !(positionSec > 0) || !(trackLengthSec > 0)) return { skipped: true };
    const pos = Math.min(positionSec, trackLengthSec);
    if (NO_REPORT()) return { skipped: true };
    await this.api.post("/streams/progress/sync", { json: progressSyncBody({ trackId: b.trackId, positionSec: pos, trackLengthSec, finished: pos === trackLengthSec }) });
    return { ok: true };
  }

  /** «Отметить прослушанным» / «непрослушанным» for an episode or the whole podcast/book. */
  async mark({ trackId, albumId, finished }) {
    this.svc.requireAuth();
    const verb = finished ? "finished" : "unfinished";
    let url;
    let query;
    if (isId(trackId)) [url, query] = [`/streams/progress/mark-${verb}`, { trackId: String(trackId) }];
    else if (isId(albumId)) [url, query] = [`/streams/progress/mark-album-${verb}`, { albumId: String(albumId) }];
    else throw new ApiError("Не указан выпуск", 400);
    if (NO_REPORT()) return { skipped: true };
    await this.api.post(url, { query });
    this.svc.cache.delete("podcasts:non_music");
    return { ok: true };
  }
}

/** Routes appended to the server's table (see http.js); svc.podcasts is looked up per request. */
export function podcastRoutes(svc) {
  return [
    ["GET", /^\/api\/podcasts$/, () => svc.podcasts.landing()],
    ["GET", /^\/api\/podcasts\/category\/([\w.-]+)$/, (q, m) => svc.podcasts.landing(m[1])],
    ["GET", /^\/api\/podcasts\/shelf$/, () => svc.podcasts.shelf()],
    ["GET", /^\/api\/podcast\/(\d+)$/, (q, m) => svc.podcasts.album(m[1], q.get("sort") || undefined)],
    ["POST", /^\/api\/podcasts\/progress$/, (q, m, b) => svc.podcasts.progress(b.ids)],
    ["POST", /^\/api\/podcasts\/sync$/, (q, m, b) => svc.podcasts.sync(b)],
    ["POST", /^\/api\/podcasts\/mark$/, (q, m, b) => svc.podcasts.mark(b)],
  ];
}
