// Движок воспроизведения: очередь, волна, кроссфейд, выравнивание громкости, таймер сна,
// отчёты о прослушивании, Media Session.
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
// Настройки звука с бэкенда: кроссфейд (секунды) и выравнивание громкости
export const audioConfig = signal({ crossfade: LS.get("ymc-crossfade", 0), normalize: LS.get("ymc-normalize", false) });
// Таймер сна: null | { mode: "time", at } | { mode: "track" }
export const sleepTimer = signal(null);
// Счётчик перемоток: оболочка (Discord, трей) переотправляет состояние после seek
export const seekGen = signal(0);

// Лайки, поставленные в этой сессии, поверх значений из ответов API
export const likeOverrides = signal(new Map());
export const dislikeOverrides = signal(new Map());
export const isLiked = (t) => (t ? (likeOverrides.value.has(t.id) ? likeOverrides.value.get(t.id) : !!t.liked) : false);
export const isDisliked = (t) => (t ? (dislikeOverrides.value.has(t.id) ? dislikeOverrides.value.get(t.id) : !!t.disliked) : false);

const resolved = new Map(); // trackId -> { track, stream, at }
const RESOLVE_TTL = 4 * 60 * 1000;
const TARGET_LUFS = -14; // ориентир громкости стримингов
let session = null; // учёт текущего прослушивания
let loadToken = 0;
// трек, которому принадлежит src текущего элемента: «Играть» на паузе возобновляет элемент,
// только если это действительно текущий трек (иначе — загрузить текущий заново)
let srcTrack = null;
// Поколение намерений пользователя: растёт только от его действий, не от автоперехода и кроссфейда
let intentGen = 0;
let waveFetching = null;
let fade = null; // активный кроссфейд: { old, oldTrack, timer }
let fadeMul = 1; // множитель громкости входящего трека во время кроссфейда
let sleepMul = 1; // множитель затухания таймера сна (отдельно от кроссфейда, чтобы не драться за громкость)
let sleepFadeTimer = null;

const playable = (t) => t && (t.available || t.substituted?.available);

// ---------- аудиоэлементы ----------
function createElement() {
  const el = new Audio();
  el.preload = "auto";
  attachListeners(el);
  return el;
}
let audio = createElement();

/** Множитель выравнивания: громкие треки приглушаются до общего уровня (усиливать тихие <audio> не умеет). */
export function loudnessFactor(track, normalize = audioConfig.value.normalize) {
  if (!normalize || typeof track?.loudness !== "number") return 1;
  const gainDb = Math.min(0, TARGET_LUFS - track.loudness);
  return Math.max(0.1, 10 ** (gainDb / 20));
}

function targetVolume(track) {
  return muted.value ? 0 : volume.value * loudnessFactor(track);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function applyVolume() {
  audio.volume = clamp01(targetVolume(current.value) * fadeMul * sleepMul);
}

const isFresh = (id) => {
  const hit = resolved.get(id);
  return !!hit && Date.now() - hit.at < RESOLVE_TTL;
};
const resolving = new Map(); // trackId -> Promise: один запрос на трек, сколько бы раз его ни попросили
const prefetchFailedAt = new Map(); // trackId -> время неудачной предзагрузки

function resolveTrack(track) {
  if (isFresh(track.id)) return Promise.resolve(resolved.get(track.id));
  if (resolving.has(track.id)) return resolving.get(track.id);
  const p = api
    .post("/play/resolve", { track })
    .then((r) => {
      const entry = { ...r, at: Date.now() };
      resolved.set(track.id, entry);
      return entry;
    })
    .finally(() => resolving.delete(track.id));
  resolving.set(track.id, p);
  return p;
}

function startSession(track) {
  session = { track, playId: crypto.randomUUID(), played: 0, lastPos: 0, from: context.value?.from };
}

/** Закрывает учёт трека: локальная история + отчёт Яндексу + фидбэк волны. */
function finishSession(reason, opts) {
  const s = session;
  session = null;
  if (!s || !s.track) return Promise.resolve();
  const durationSeconds = (s.track.durationMs || 0) / 1000 || duration.value;
  const jobs = [api.post("/played", { track: s.track, from: s.from, playedSeconds: s.played, durationSeconds, playId: s.playId }, opts).catch(() => {})];
  if (context.value?.type === "wave") {
    const type = reason === "ended" ? "trackFinished" : "skip";
    jobs.push(api.post("/wave/feedback", { type, track: s.track, playedSeconds: s.played }, opts).catch(() => {}));
  }
  return Promise.all(jobs);
}

// Electron вызывает это перед закрытием окна и ждёт, пока прослушивание уйдёт в историю
window.__ymcFinalize = () => finishSession("skip");

/** Останавливает затухающий трек немедленно (пользователь вмешался во время кроссфейда). */
function cancelFade() {
  if (!fade) return;
  clearInterval(fade.timer);
  fade.old.pause();
  fade.old.removeAttribute("src");
  fade.old.load();
  fade = null;
  fadeMul = 1;
  applyVolume();
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
  // асинхронно, чтобы цепочка пропусков не превращалась в синхронную рекурсию;
  // reason: "error" — это не «трек доигран», таймер сна «до конца трека» на него не реагирует
  setTimeout(() => next({ auto: true, reason: "error" }), 0);
}

/** Трек мог быть заменён версией без цензуры — подставляем в очередь то, что играет на самом деле. */
function applyResolved(i, r, original) {
  if (r.track && r.track.id !== original.id) {
    const copy = [...queue.value];
    copy[i] = { ...r.track, liked: original.liked };
    queue.value = copy;
    if (r.track.uncensorReason) toast(`Играет оригинальная версия «${r.track.title}»`);
  }
}

/** Общая часть «трек начал играть»: учёт, фидбэк волне, системная плашка, сохранение очереди. */
function afterStart(i) {
  startSession(queue.value[i]);
  if (context.value?.type === "wave") api.post("/wave/feedback", { type: "trackStarted", track: queue.value[i] }).catch(() => {});
  updateMediaSession();
  persistQueue();
  maybeExtendWave();
}

async function load(i, { autoplay = true } = {}) {
  cancelFade();
  const list = queue.value;
  const track = list[i];
  if (!track) {
    loading.value = false;
    return;
  }
  const token = ++loadToken;
  // старый элемент глушим сразу (src оставляем): иначе его ended/timeupdate сработают уже с новым индексом
  audio.pause();
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
    // пока ждали ссылку, очередь могли поправить (перестановка, удаление, вставка) — ищем трек заново
    const at = queue.value[index.value] === track ? index.value : queue.value.indexOf(track);
    if (at < 0) {
      loading.value = false;
      return;
    }
    if (at !== index.value) index.value = at;
    applyResolved(at, r, track);
    stream.value = r.stream;
    audio.src = r.stream.url;
    srcTrack = queue.value[at];
    applyVolume();
    afterStart(at);
    if (autoplay) await audio.play().catch(() => {});
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

/**
 * Кроссфейд: следующий трек стартует в новом элементе и нарастает, текущий затухает.
 * Логически переключаемся на следующий трек сразу, старый элемент просто доигрывает хвост.
 */
function startCrossfade() {
  const seconds = audioConfig.value.crossfade;
  const i = index.value + 1;
  const nextTrack = queue.value[i];
  if (!nextTrack || !playable(nextTrack) || !isFresh(nextTrack.id)) return false;
  const entry = resolved.get(nextTrack.id);

  finishSession("ended");
  loadToken++;
  const old = audio;
  const oldTrack = current.value;
  const incoming = createElement();
  incoming.src = entry.stream.url;

  batch(() => {
    index.value = i;
    position.value = 0;
    duration.value = (nextTrack.durationMs || 0) / 1000;
  });
  applyResolved(i, entry, nextTrack);
  stream.value = entry.stream;
  audio = incoming;
  srcTrack = queue.value[i];
  fadeMul = 0;
  applyVolume();
  afterStart(i);
  incoming.play().catch(() => {});

  const t0 = performance.now();
  const timer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    // равная мощность: косинус/синус, без провала громкости посередине.
    // Громкость старого трека считается заново на каждом шаге — mute и ползунок действуют и на него
    old.volume = clamp01(targetVolume(oldTrack) * sleepMul * Math.cos((k * Math.PI) / 2));
    fadeMul = Math.sin((k * Math.PI) / 2);
    applyVolume();
    if (k >= 1) {
      clearInterval(timer);
      old.pause();
      old.removeAttribute("src");
      old.load();
      fade = null;
      fadeMul = 1;
      applyVolume();
    }
  }, 50);
  fade = { old, oldTrack, timer };
  return true;
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

// Поколение очереди: ответы, запрошенные для прежней очереди, в новую не попадают
let queueGen = 0;

/** Включить список треков. ctx: { title, from, link } */
export function playList(tracks, startIndex = 0, ctx = {}) {
  finishSession("skip");
  const { list, start } = order(tracks.filter(Boolean), startIndex);
  intentGen++;
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
  // loadToken — чтобы отменить загрузку, которая уже идёт; сверяемся же с намерениями пользователя:
  // автопереход или кроссфейд во время запроса не должен отменять клик по волне
  ++loadToken;
  const gen = ++intentGen;
  loading.value = true;
  try {
    const r = await api.post("/wave/start", { stationId, settings });
    if (gen !== intentGen) return; // пока ждали, пользователь включил что-то другое
    if (!r.tracks?.length) {
      loading.value = false;
      toast("Волна ничего не нашла — ослабьте фильтры анти-повтора в настройках");
      return;
    }
    // учёт прошлого трека закрываем только сейчас: если волна не стартовала, он продолжает играть
    finishSession("skip");
    queueGen++;
    skipStreak = 0;
    waveFetching = null;
    batch(() => {
      queue.value = r.tracks;
      context.value = { type: "wave", title, stationId, from: `desktop_win-radio-${stationId.replace(":", "_")}-default` };
    });
    return load(0);
  } catch (e) {
    if (gen !== intentGen) return;
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

/** auto — трек сменился сам; reason: "error" — пропуск недоступного/сломанного трека, а не «доиграл». */
export async function next({ auto = false, reason } = {}) {
  const finished = auto && reason !== "error";
  if (!auto) intentGen++;
  finishSession(finished ? "ended" : "skip");
  // таймер «до конца трека»: доиграли — останавливаемся
  if (finished && sleepTimer.value?.mode === "track") {
    sleepTimer.value = null;
    audio.pause();
    playing.value = false;
    toast("Таймер сна: воспроизведение остановлено");
    return;
  }
  const i = index.value;
  if (i < queue.value.length - 1) return load(i + 1);
  // волна, восстановленная после перезапуска (сохранён один трек): очередь кончилась — новая сессия волны, а не повтор трека
  if (context.value?.resumeWave) return playWave({ stationId: context.value.stationId, title: context.value.title });
  if (context.value?.type === "wave") {
    const gen = queueGen;
    const ig = intentGen;
    const cur = queue.value[i];
    await maybeExtendWave();
    // пока ждали треки, пользователь включил другую очередь или другой трек в этой.
    // Сравниваем сам трек, а не позицию: правка очереди выше текущего трека не должна глушить волну
    const j = queue.value.indexOf(cur);
    if (gen !== queueGen || ig !== intentGen || j < 0 || j !== index.value) return;
    if (j < queue.value.length - 1) return load(j + 1);
  }
  if (repeat.value === "all" && queue.value.length) return load(0);
  audio.pause();
  playing.value = false;
}

/** Элемент уже играет текущий трек (а не ждёт ссылку на новый, оставаясь со старым потоком). */
const elementIsCurrent = () => !!audio.src && srcTrack === current.value;

export function prev() {
  // пока грузится новый трек, позиция старого элемента ничего не значит — «назад» идёт к предыдущему треку
  const pos = elementIsCurrent() ? audio.currentTime : 0;
  if (pos > 3 || index.value <= 0) {
    if (!elementIsCurrent()) return;
    cancelFade();
    audio.currentTime = 0;
    return;
  }
  intentGen++;
  finishSession("skip");
  load(index.value - 1);
}

export function playAt(i) {
  if (i === index.value) return toggle();
  intentGen++;
  finishSession("skip");
  load(i);
}

export function toggle() {
  if (!current.value) return;
  // после перезапуска приложения волна продолжается новой сессией, а не одним сохранённым треком
  if (!audio.src && context.value?.resumeWave) return playWave({ stationId: context.value.stationId, title: context.value.title });
  if (!audio.src || (audio.paused && srcTrack !== current.value)) {
    // элемент пуст или звучал другой трек (загрузка ещё идёт, была перебита или сорвалась) —
    // включаем текущий трек заново, а не возобновляем чужой поток
    intentGen++;
    return load(index.value);
  }
  if (audio.paused) {
    cancelSleepFade(); // «Играть» во время затухания таймера сна — значит, спать передумали
    // очередь доиграла (или остановил таймер «до конца трека») — новое прослушивание тоже идёт в отчёт
    if (!session && current.value) startSession(current.value);
    audio.play().catch(() => {});
  } else {
    cancelFade();
    audio.pause();
  }
}

export function seek(sec) {
  if (!Number.isFinite(sec)) return;
  // перемотка во время загрузки другого трека задела бы старый поток и отправила бы его позицию в Discord
  if (!elementIsCurrent()) return;
  cancelFade();
  if (session) session.lastPos = sec;
  audio.currentTime = Math.max(0, Math.min(sec, audio.duration || duration.value));
  batch(() => {
    position.value = audio.currentTime;
    seekGen.value++;
  });
}

export function setVolume(v) {
  const val = Math.max(0, Math.min(1, v));
  volume.value = val;
  if (val > 0 && muted.value) muted.value = false;
  applyVolume();
  LS.set("ymc-volume", val);
}

export function toggleMute() {
  muted.value = !muted.value;
  applyVolume();
}

export function toggleShuffle() {
  shuffle.value = !shuffle.value;
  LS.set("ymc-shuffle", shuffle.value);
}

export function cycleRepeat() {
  repeat.value = { none: "all", all: "one", one: "none" }[repeat.value];
  LS.set("ymc-repeat", repeat.value);
}

export function setAudioConfig(patch) {
  audioConfig.value = { ...audioConfig.value, ...patch };
  LS.set("ymc-crossfade", audioConfig.value.crossfade);
  LS.set("ymc-normalize", audioConfig.value.normalize);
  applyVolume();
}

// ---------- таймер сна ----------
let sleepInterval = null;

function cancelSleepFade() {
  if (!sleepFadeTimer) return;
  clearInterval(sleepFadeTimer);
  sleepFadeTimer = null;
  sleepMul = 1;
  applyVolume();
}

/** minutes: число минут, "track" — до конца текущего трека, null — выключить. */
export function setSleepTimer(minutes) {
  clearInterval(sleepInterval);
  sleepInterval = null;
  cancelSleepFade();
  if (minutes == null) {
    sleepTimer.value = null;
    return;
  }
  if (minutes === "track") {
    sleepTimer.value = { mode: "track" };
    toast("Остановлю после этого трека");
    return;
  }
  sleepTimer.value = { mode: "time", at: Date.now() + minutes * 60000 };
  toast(`Остановлю через ${minutes} мин`);
  sleepInterval = setInterval(() => {
    const st = sleepTimer.value;
    if (!st || st.mode !== "time") return clearInterval(sleepInterval);
    if (Date.now() < st.at) return;
    clearInterval(sleepInterval);
    sleepTimer.value = null;
    // идущий кроссфейд дожимаем сразу: затухает только один трек
    cancelFade();
    // мягкое затухание за 8 секунд, а не резкий обрыв
    const start = performance.now();
    sleepFadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - start) / 8000);
      sleepMul = 1 - k;
      applyVolume();
      if (k >= 1) {
        clearInterval(sleepFadeTimer);
        sleepFadeTimer = null;
        cancelFade(); // кроссфейд не должен пережить затухание и зазвучать на полную после сброса sleepMul
        // загрузка следующего трека, которая ещё идёт, иначе включит музыку уже после «спокойной ночи»
        ++loadToken;
        loading.value = false;
        audio.pause();
        sleepMul = 1;
        applyVolume();
        toast("Таймер сна: спокойной ночи");
      }
    }, 100);
  }, 1000);
}

export function enqueueNext(tracks) {
  const list = [...queue.value];
  list.splice(index.value + 1, 0, ...tracks);
  queue.value = list;
  if (index.value < 0) {
    intentGen++; // пустая очередь — это запуск по действию пользователя
    load(0);
  } else persistQueue();
  toast(tracks.length > 1 ? "Добавлено в очередь" : `«${tracks[0].title}» будет следующим`);
}

export function enqueueEnd(tracks) {
  queue.value = [...queue.value, ...tracks];
  if (index.value < 0) {
    intentGen++; // пустая очередь — это запуск по действию пользователя
    load(0);
  } else persistQueue();
  toast(tracks.length > 1 ? `Добавлено в конец очереди: ${tracks.length}` : `«${tracks[0].title}» — в конце очереди`);
}

export function removeFromQueue(i) {
  if (i === index.value) return;
  const list = [...queue.value];
  list.splice(i, 1);
  batch(() => {
    queue.value = list;
    if (i < index.value) index.value -= 1;
  });
  persistQueue();
}

/** Перестановка в очереди (drag-and-drop в панели «Очередь»). */
export function moveInQueue(from, to) {
  if (from === to || from < 0 || to < 0) return;
  const list = [...queue.value];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  const cur = index.value;
  let ni = cur;
  if (from === cur) ni = to;
  else if (from < cur && to >= cur) ni = cur - 1;
  else if (from > cur && to <= cur) ni = cur + 1;
  batch(() => {
    queue.value = list;
    index.value = ni;
  });
  persistQueue();
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

// ---------- события <audio> (только для текущего элемента) ----------
function attachListeners(el) {
  const on = (type, fn) => el.addEventListener(type, (e) => el === audio && fn(e));
  on("playing", () => {
    playing.value = true;
    loading.value = false;
    skipStreak = 0; // сбрасываем только когда звук реально пошёл, а не когда получена ссылка
  });
  on("pause", () => (playing.value = false));
  on("waiting", () => (loading.value = true));
  on("canplay", () => (loading.value = false));
  on("durationchange", () => {
    if (Number.isFinite(el.duration)) duration.value = el.duration;
  });
  on("progress", () => {
    if (el.buffered.length) buffered.value = el.buffered.end(el.buffered.length - 1);
  });
  on("timeupdate", () => {
    const t = el.currentTime;
    position.value = t;
    if (session) {
      const delta = t - session.lastPos;
      if (delta > 0 && delta < 2) session.played += delta; // перемотка не считается прослушиванием
      session.lastPos = t;
    }
    const dur = duration.value;
    const xf = audioConfig.value.crossfade;
    // заранее получаем ссылку на следующий трек (с запасом на кроссфейд)
    const nxt = queue.value[index.value + 1];
    if (nxt && dur - t < 25 + xf && !isFresh(nxt.id) && playable(nxt) && Date.now() - (prefetchFailedAt.get(nxt.id) || 0) > 15000) {
      // при ошибке не долбим сервер на каждом timeupdate — пауза 15 секунд
      resolveTrack(nxt).catch(() => prefetchFailedAt.set(nxt.id, Date.now()));
    }
    if (context.value?.type === "wave" && dur - t < 30) maybeExtendWave();
    // кроссфейд: не для повтора трека, не для таймера «до конца трека», не во время затухания таймера сна, не для коротких треков
    if (xf > 0 && !fade && !sleepFadeTimer && !el.paused && repeat.value !== "one" && sleepTimer.value?.mode !== "track" && dur > xf * 3 && dur - t <= xf) startCrossfade();
    if ("mediaSession" in navigator && Number.isFinite(el.duration)) {
      try {
        navigator.mediaSession.setPositionState({ duration: el.duration, position: Math.min(t, el.duration), playbackRate: 1 });
      } catch {
        // позиция может быть невалидной во время перемотки
      }
    }
  });
  on("ended", () => {
    // таймер сна «до конца трека» важнее повтора трека — иначе музыка не остановится никогда
    if (repeat.value === "one" && sleepTimer.value?.mode !== "track") {
      finishSession("ended");
      startSession(current.value);
      el.currentTime = 0;
      el.play().catch(() => {});
      return;
    }
    next({ auto: true });
  });
  on("error", async () => {
    const track = current.value;
    const s = session;
    if (!track || !el.src) return;
    const token = loadToken;
    // ссылка могла протухнуть — пробуем получить новую один раз за прослушивание
    if (s && !s.retried) {
      s.retried = true;
      resolved.delete(track.id);
      const pos = el.currentTime;
      try {
        const r = await resolveTrack(track);
        if (token !== loadToken) return;
        el.src = r.stream.url;
        el.currentTime = pos;
        await el.play();
        return;
      } catch {
        if (token !== loadToken) return;
      }
    }
    skipUnplayable(`Ошибка воспроизведения «${track.title}», переключаю`);
  });
}

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
  ms.setActionHandler("pause", () => toggle());
  ms.setActionHandler("nexttrack", () => next());
  ms.setActionHandler("previoustrack", () => prev());
  ms.setActionHandler("seekto", (e) => seek(e.seekTime));
  ms.setActionHandler("seekbackward", () => seek(audio.currentTime - 10));
  ms.setActionHandler("seekforward", () => seek(audio.currentTime + 10));
}

// управление из оболочки: глобальные хоткеи, кнопки на панели задач, трей
window.__ymcControl = {
  toggle,
  next: () => next(),
  prev,
  like: () => current.value && like(current.value),
  volumeUp: () => setVolume(volume.value + 0.05),
  volumeDown: () => setVolume(volume.value - 0.05),
};

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

/** Текущее время воспроизведения (для синхронизации текста в полноэкранном режиме). */
export const currentTime = () => audio.currentTime;

// диагностика для smoke-тестов: идёт ли кроссфейд и с какой громкостью звучат оба трека
window.__ymcDebug = () => ({ fading: !!fade, oldVolume: fade?.old.volume ?? null, volume: audio.volume, fadeMul });
