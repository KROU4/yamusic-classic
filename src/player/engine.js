// Движок воспроизведения: очередь, волна, отчёты о прослушивании, Media Session.
import { signal, computed, batch } from "@preact/signals";
import { api } from "../lib/api.js";
import { artistNames } from "../lib/format.js";
import { toast } from "../lib/toast.js";

const LS = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // хранилище недоступно — не критично
    }
  },
};

export const queue = signal([]);
export const index = signal(-1);
export const playing = signal(false);
export const loading = signal(false);
export const position = signal(0);
export const duration = signal(0);
export const buffered = signal(0);
export const volume = signal(LS.get("ymc-volume", 0.8));
export const muted = signal(false);
export const shuffle = signal(LS.get("ymc-shuffle", false));
export const repeat = signal(LS.get("ymc-repeat", "none")); // none | all | one
export const context = signal(null); // { type: "wave"|"list", title, from, stationId?, link? }
export const stream = signal(null);
export const current = computed(() => queue.value[index.value] || null);
export const authError = signal(false);

// Лайки, поставленные в этой сессии, поверх значений из ответов API
export const likeOverrides = signal(new Map());
export const dislikeOverrides = signal(new Map());
export const isLiked = (t) => (t ? (likeOverrides.value.has(t.id) ? likeOverrides.value.get(t.id) : !!t.liked) : false);
export const isDisliked = (t) => (t ? (dislikeOverrides.value.has(t.id) ? dislikeOverrides.value.get(t.id) : !!t.disliked) : false);

const audio = new Audio();
audio.preload = "auto";
audio.volume = volume.value;

const resolved = new Map(); // trackId -> { track, stream, at }
const RESOLVE_TTL = 4 * 60 * 1000;
let session = null; // учёт текущего прослушивания
let loadToken = 0;
let waveFetching = null;

const playable = (t) => t && (t.available || t.substituted?.available);

async function resolveTrack(track) {
  const hit = resolved.get(track.id);
  if (hit && Date.now() - hit.at < RESOLVE_TTL) return hit;
  const r = await api.post("/play/resolve", { track });
  const entry = { ...r, at: Date.now() };
  resolved.set(track.id, entry);
  return entry;
}

function startSession(track) {
  session = { track, playId: crypto.randomUUID(), played: 0, lastPos: 0, from: context.value?.from };
}

/** Закрывает учёт трека: локальная история + отчёт Яндексу + фидбэк волны. */
function finishSession(reason, opts) {
  const s = session;
  session = null;
  if (!s || !s.track) return;
  const durationSeconds = (s.track.durationMs || 0) / 1000 || duration.value;
  api.post("/played", { track: s.track, from: s.from, playedSeconds: s.played, durationSeconds, playId: s.playId }, opts).catch(() => {});
  if (context.value?.type === "wave") {
    const type = reason === "ended" ? "trackFinished" : "skip";
    api.post("/wave/feedback", { type, track: s.track, playedSeconds: s.played }, opts).catch(() => {});
  }
}

// Подряд пропущенные недоступные треки: защита от бесконечного перебора (например, альбом закрыт в регионе + повтор всего)
let skipStreak = 0;
const MAX_SKIP_STREAK = 25;

function skipUnplayable(message) {
  toast(message);
  skipStreak += 1;
  if (skipStreak >= Math.min(MAX_SKIP_STREAK, Math.max(1, queue.value.length))) {
    skipStreak = 0;
    loading.value = false;
    playing.value = false;
    audio.pause();
    toast("Доступных для воспроизведения треков не нашлось");
    return;
  }
  // асинхронно, чтобы цепочка пропусков не превращалась в синхронную рекурсию
  setTimeout(() => next({ auto: true }), 0);
}

async function load(i, { autoplay = true } = {}) {
  const list = queue.value;
  const track = list[i];
  if (!track) {
    loading.value = false;
    return;
  }
  const token = ++loadToken;
  batch(() => {
    index.value = i;
    loading.value = true;
    position.value = 0;
    duration.value = (track.durationMs || 0) / 1000;
  });
  if (!playable(track)) {
    loading.value = false;
    return skipUnplayable(`«${track.title}» недоступен, пропускаю`);
  }
  try {
    const r = await resolveTrack(track);
    if (token !== loadToken) return;
    skipStreak = 0;
    // трек мог быть заменён на версию без цензуры — показываем, что играет на самом деле
    if (r.track && r.track.id !== track.id) {
      const copy = [...queue.value];
      copy[i] = { ...r.track, liked: track.liked };
      queue.value = copy;
      if (r.track.uncensorReason) toast(`Играет оригинальная версия «${r.track.title}»`);
    }
    stream.value = r.stream;
    audio.src = r.stream.url;
    startSession(queue.value[i]);
    if (context.value?.type === "wave") api.post("/wave/feedback", { type: "trackStarted", track: queue.value[i] }).catch(() => {});
    if (autoplay) await audio.play().catch(() => {});
    updateMediaSession();
    persistQueue();
    maybeExtendWave();
  } catch (e) {
    if (token !== loadToken) return;
    loading.value = false;
    if (e.status === 401) {
      authError.value = true;
      playing.value = false;
      return;
    }
    skipUnplayable(`Не удалось включить «${track.title}»: ${e.message}`);
  }
}

function order(tracks, startIndex) {
  if (!shuffle.value) return { list: tracks, start: startIndex };
  const first = tracks[startIndex];
  const rest = tracks.filter((_, i) => i !== startIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return { list: first ? [first, ...rest] : rest, start: 0 };
}

/** Включить список треков. ctx: { title, from, link } */
// Поколение очереди: ответы, запрошенные для прежней очереди, в новую не попадают
let queueGen = 0;

export function playList(tracks, startIndex = 0, ctx = {}) {
  finishSession("skip");
  const { list, start } = order(tracks.filter(Boolean), startIndex);
  queueGen++;
  skipStreak = 0;
  batch(() => {
    queue.value = list;
    context.value = { type: "list", ...ctx };
  });
  return load(start);
}

/** Запустить волну (по умолчанию «Моя волна»). */
export async function playWave({ stationId = "user:onyourwave", settings, title = "Моя волна" } = {}) {
  finishSession("skip");
  const token = ++loadToken;
  loading.value = true;
  try {
    const r = await api.post("/wave/start", { stationId, settings });
    if (token !== loadToken) return; // пока ждали, пользователь включил что-то другое
    if (!r.tracks?.length) {
      loading.value = false;
      toast("Волна ничего не нашла — ослабьте фильтры анти-повтора в настройках");
      return;
    }
    queueGen++;
    skipStreak = 0;
    waveFetching = null;
    batch(() => {
      queue.value = r.tracks;
      context.value = { type: "wave", title, stationId, from: `desktop_win-radio-${stationId.replace(":", "_")}-default` };
    });
    return load(0);
  } catch (e) {
    if (token !== loadToken) return;
    loading.value = false;
    if (e.status === 401) authError.value = true;
    toast(`Волна не запустилась: ${e.message}`);
  }
}

function maybeExtendWave() {
  if (context.value?.type !== "wave") return Promise.resolve();
  if (waveFetching) return waveFetching;
  if (queue.value.length - index.value > 3) return Promise.resolve();
  const gen = queueGen;
  const p = api
    .get("/wave/next?count=4")
    .then((r) => {
      if (gen !== queueGen) return;
      const known = new Set(queue.value.map((t) => t.id));
      const fresh = r.tracks.filter((t) => !known.has(t.id));
      if (fresh.length) queue.value = [...queue.value, ...fresh];
    })
    .catch(() => {})
    .finally(() => {
      if (waveFetching === p) waveFetching = null;
    });
  waveFetching = p;
  return p;
}

export async function next({ auto = false } = {}) {
  finishSession(auto ? "ended" : "skip");
  const i = index.value;
  if (i < queue.value.length - 1) return load(i + 1);
  if (context.value?.type === "wave") {
    await maybeExtendWave();
    if (i < queue.value.length - 1) return load(i + 1);
  }
  if (repeat.value === "all" && queue.value.length) return load(0);
  audio.pause();
  playing.value = false;
}

export function prev() {
  if (audio.currentTime > 3 || index.value <= 0) {
    audio.currentTime = 0;
    return;
  }
  finishSession("skip");
  load(index.value - 1);
}

export function playAt(i) {
  if (i === index.value) return toggle();
  finishSession("skip");
  load(i);
}

export function toggle() {
  if (!current.value) return;
  // после перезапуска приложения волна продолжается новой сессией, а не одним сохранённым треком
  if (!audio.src && context.value?.resumeWave) return playWave({ stationId: context.value.stationId, title: context.value.title });
  if (!audio.src) return load(index.value);
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function seek(sec) {
  if (!Number.isFinite(sec)) return;
  if (session) session.lastPos = sec;
  audio.currentTime = Math.max(0, Math.min(sec, audio.duration || duration.value));
}

export function setVolume(v) {
  const val = Math.max(0, Math.min(1, v));
  volume.value = val;
  audio.volume = val;
  if (val > 0 && muted.value) toggleMute();
  LS.set("ymc-volume", val);
}

export function toggleMute() {
  muted.value = !muted.value;
  audio.muted = muted.value;
}

export function toggleShuffle() {
  shuffle.value = !shuffle.value;
  LS.set("ymc-shuffle", shuffle.value);
}

export function cycleRepeat() {
  repeat.value = { none: "all", all: "one", one: "none" }[repeat.value];
  LS.set("ymc-repeat", repeat.value);
}

export function enqueueNext(tracks) {
  const list = [...queue.value];
  list.splice(index.value + 1, 0, ...tracks);
  queue.value = list;
  if (index.value < 0) load(0);
  toast(tracks.length > 1 ? "Добавлено в очередь" : `«${tracks[0].title}» будет следующим`);
}

export function removeFromQueue(i) {
  if (i === index.value) return;
  const list = [...queue.value];
  list.splice(i, 1);
  queue.value = list;
  if (i < index.value) index.value -= 1;
}

export async function like(track, value = !isLiked(track)) {
  const m = new Map(likeOverrides.value);
  m.set(track.id, value);
  likeOverrides.value = m;
  if (value && isDisliked(track)) {
    const d = new Map(dislikeOverrides.value);
    d.set(track.id, false);
    dislikeOverrides.value = d;
  }
  try {
    await api.post("/like", { trackId: track.id, liked: value });
    if (context.value?.type === "wave" && value) api.post("/wave/feedback", { type: "like", track }).catch(() => {});
  } catch (e) {
    // откатываем только этот трек, не затирая лайки, поставленные за время запроса
    const rollback = new Map(likeOverrides.value);
    rollback.set(track.id, !value);
    likeOverrides.value = rollback;
    toast(`Не удалось: ${e.message}`);
  }
}

export async function dislike(track) {
  const value = !isDisliked(track);
  const d = new Map(dislikeOverrides.value);
  d.set(track.id, value);
  dislikeOverrides.value = d;
  try {
    await api.post("/dislike", { trackId: track.id, disliked: value });
    if (value) {
      if (context.value?.type === "wave") api.post("/wave/feedback", { type: "dislike", track }).catch(() => {});
      if (current.value?.id === track.id) next();
      toast("Больше не будем такое предлагать");
    }
  } catch (e) {
    toast(`Не удалось: ${e.message}`);
  }
}

// ---------- события <audio> ----------
audio.addEventListener("playing", () => {
  playing.value = true;
  loading.value = false;
});
audio.addEventListener("pause", () => (playing.value = false));
audio.addEventListener("waiting", () => (loading.value = true));
audio.addEventListener("canplay", () => (loading.value = false));
audio.addEventListener("durationchange", () => {
  if (Number.isFinite(audio.duration)) duration.value = audio.duration;
});
audio.addEventListener("progress", () => {
  if (audio.buffered.length) buffered.value = audio.buffered.end(audio.buffered.length - 1);
});
audio.addEventListener("timeupdate", () => {
  const t = audio.currentTime;
  position.value = t;
  if (session) {
    const delta = t - session.lastPos;
    if (delta > 0 && delta < 2) session.played += delta; // перемотка не считается прослушиванием
    session.lastPos = t;
  }
  // за 25 секунд до конца заранее получаем ссылку на следующий трек
  const nxt = queue.value[index.value + 1];
  if (nxt && duration.value - t < 25 && !resolved.has(nxt.id) && playable(nxt)) resolveTrack(nxt).catch(() => {});
  if ("mediaSession" in navigator && Number.isFinite(audio.duration)) {
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(t, audio.duration), playbackRate: 1 });
    } catch {
      // позиция может быть невалидной во время перемотки
    }
  }
});
audio.addEventListener("ended", () => {
  if (repeat.value === "one") {
    finishSession("ended");
    startSession(current.value);
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  next({ auto: true });
});
audio.addEventListener("error", async () => {
  const track = current.value;
  const s = session;
  if (!track || !audio.src) return;
  const token = loadToken;
  // ссылка могла протухнуть — пробуем получить новую один раз за прослушивание
  if (s && !s.retried) {
    s.retried = true;
    resolved.delete(track.id);
    const pos = audio.currentTime;
    try {
      const r = await resolveTrack(track);
      if (token !== loadToken) return;
      audio.src = r.stream.url;
      audio.currentTime = pos;
      await audio.play();
      return;
    } catch {
      if (token !== loadToken) return;
    }
  }
  skipUnplayable(`Ошибка воспроизведения «${track.title}», переключаю`);
});

// ---------- системные медиа-клавиши и SMTC Windows ----------
function updateMediaSession() {
  const t = current.value;
  if (!("mediaSession" in navigator) || !t) return;
  const art = t.cover ? t.cover.replace(/\d+x\d+$/, "400x400") : null;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title + (t.version ? ` (${t.version})` : ""),
    artist: artistNames(t),
    album: t.album?.title || "",
    artwork: art ? [{ src: art, sizes: "400x400", type: "image/jpeg" }] : [],
  });
  document.title = `${t.title} — ${artistNames(t)}`;
}

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  // toggle, а не audio.play(): после перезапуска у <audio> ещё нет src
  ms.setActionHandler("play", () => toggle());
  ms.setActionHandler("pause", () => audio.pause());
  ms.setActionHandler("nexttrack", () => next());
  ms.setActionHandler("previoustrack", () => prev());
  ms.setActionHandler("seekto", (e) => seek(e.seekTime));
  ms.setActionHandler("seekbackward", () => seek(audio.currentTime - 10));
  ms.setActionHandler("seekforward", () => seek(audio.currentTime + 10));
}

// закрытие окна посреди трека: прослушивание всё равно попадёт в историю и в отчёт Яндексу
window.addEventListener("pagehide", () => finishSession("skip", { keepalive: true }));

// ---------- восстановление очереди (без автозапуска) ----------
function persistQueue() {
  const list = queue.value;
  const i = index.value;
  // для волны сохраняем только текущий трек: остальное всё равно перезапросится
  const keep = context.value?.type === "wave" ? list.slice(i, i + 1) : list.slice(Math.max(0, i - 50), i + 200);
  const ni = context.value?.type === "wave" ? 0 : i - Math.max(0, i - 50);
  LS.set("ymc-queue", { tracks: keep, index: ni, context: context.value });
}

export function restoreQueue() {
  const saved = LS.get("ymc-queue", null);
  if (!saved?.tracks?.length) return;
  batch(() => {
    queue.value = saved.tracks;
    index.value = Math.min(saved.index, saved.tracks.length - 1);
    context.value = saved.context?.type === "wave" ? { ...saved.context, type: "list", resumeWave: true } : saved.context;
    duration.value = (queue.value[index.value]?.durationMs || 0) / 1000;
  });
}

export const audioElement = audio;
