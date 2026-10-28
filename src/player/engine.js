// Playback engine: queue, wave, crossfade, loudness normalization, sleep timer,
// listening reports, Media Session.
import { signal, computed, batch } from "@preact/signals";
import { api } from "../lib/api.js";
import { artistNames } from "../lib/format.js";
import { toast } from "../lib/toast.js";
import * as graph from "./audiograph.js";
import { setWaveSettings, waveEdits, DEFAULT_WAVE_SETTINGS } from "./waveState.js";

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
      // storage unavailable — not critical
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
// Audio settings from the backend: crossfade (seconds) and loudness normalization
export const audioConfig = signal({ crossfade: LS.get("ymc-crossfade", 0), normalize: LS.get("ymc-normalize", false) });
// Sleep timer: null | { mode: "time", at } | { mode: "track" }
export const sleepTimer = signal(null);
/** Playback speed (podcasts, audiobooks); pitch is preserved. */
const clampRate = (v) => (Number.isFinite(+v) ? Math.max(0.5, Math.min(2, Math.round(+v * 100) / 100)) : 1);
// a corrupted stored value must not break element creation at import time
export const rate = signal(clampRate(LS.get("ymc-rate", 1)));
// Seek counter: the shell (tray, taskbar) resends state after a seek
export const seekGen = signal(0);

// Likes set in this session, layered over values from API responses
export const likeOverrides = signal(new Map());
export const dislikeOverrides = signal(new Map());
export const isLiked = (t) => (t ? (likeOverrides.value.has(t.id) ? likeOverrides.value.get(t.id) : !!t.liked) : false);
export const isDisliked = (t) => (t ? (dislikeOverrides.value.has(t.id) ? dislikeOverrides.value.get(t.id) : !!t.disliked) : false);

const resolved = new Map(); // trackId -> { track, stream, at }
const RESOLVE_TTL = 4 * 60 * 1000;
const TARGET_LUFS = -14; // streaming loudness reference
let session = null; // tracking of the current listen
let loadToken = 0;
// the track that owns the current element's src: "Play" while paused resumes the element
// only if it really is the current track (otherwise — load the current one again)
let srcTrack = null;
// Generation of user intents: grows only from user actions, not from auto-advance or crossfade
let intentGen = 0;
let waveFetching = null;
let fade = null; // active crossfade: { old, oldTrack, timer }
let fadeMul = 1; // volume multiplier of the incoming track during a crossfade
let sleepMul = 1; // sleep-timer fade multiplier (separate from the crossfade, so they don't fight over volume)
let sleepFadeTimer = null;

const playable = (t) => t && (t.available || t.substituted?.available);

// ---------- audio elements ----------
function createElement() {
  const el = new Audio();
  el.preload = "auto";
  graph.prepare(el); // CORS mode and equalizer hookup — before the first src
  // defaultPlaybackRate survives a src change (loading resets playbackRate to it)
  el.defaultPlaybackRate = el.playbackRate = rate.value;
  attachListeners(el);
  return el;
}
let audio = createElement();

/**
 * Normalization multiplier: loud tracks are attenuated to a common level. Quiet ones are boosted (up to +4 dB)
 * only through the sound graph — the <audio> itself can't exceed volume 1; the result is still capped at one.
 */
export function loudnessFactor(track, normalize = audioConfig.value.normalize, boost = graph.graphReady.value) {
  if (!normalize || typeof track?.loudness !== "number") return 1;
  const gainDb = Math.min(boost ? 4 : 0, TARGET_LUFS - track.loudness);
  return Math.max(0.1, 10 ** (gainDb / 20));
}

function targetVolume(track) {
  return muted.value ? 0 : volume.value * loudnessFactor(track);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function applyVolume() {
  graph.setVolume(audio, clamp01(targetVolume(current.value) * fadeMul * sleepMul));
}

const isFresh = (id) => {
  const hit = resolved.get(id);
  return !!hit && Date.now() - hit.at < RESOLVE_TTL;
};
const resolving = new Map(); // trackId -> Promise: one request per track, no matter how many times it's asked for
const prefetchFailedAt = new Map(); // trackId -> time of the failed prefetch

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

/** Closes the track's accounting: local history + report to Yandex + wave feedback. */
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

// Electron calls this before closing the window and waits until the listen is written to history
window.__ymcFinalize = () => finishSession("skip");

/** Stops the fading track immediately (the user intervened during a crossfade). */
function cancelFade() {
  if (!fade) return;
  clearInterval(fade.timer);
  fade.old.pause();
  fade.old.removeAttribute("src");
  fade.old.load();
  graph.release(fade.old);
  fade = null;
  fadeMul = 1;
  applyVolume();
}

// Consecutively skipped unavailable tracks: protection against endless cycling (e.g. an album blocked in the region + repeat all)
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
  // asynchronous, so a chain of skips doesn't turn into synchronous recursion;
  // reason: "error" is not "track finished", so the "until end of track" sleep timer ignores it
  setTimeout(() => next({ auto: true, reason: "error" }), 0);
}

/** The track may have been replaced by an uncensored version — put what is actually playing into the queue. */
function applyResolved(i, r, original) {
  if (r.track && r.track.id !== original.id) {
    const copy = [...queue.value];
    copy[i] = { ...r.track, liked: original.liked };
    queue.value = copy;
    if (r.track.uncensorReason) toast(`Играет оригинальная версия «${r.track.title}»`);
  }
}

/** Common part of "track started playing": accounting, wave feedback, system overlay, queue persistence. */
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
  // the old element is muted at once (src is kept): otherwise its ended/timeupdate would fire with the new index
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
    // while waiting for the link the queue could have been edited (reorder, removal, insertion) — find the track again
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
 * Crossfade: the next track starts in a new element and fades in, the current one fades out.
 * Logically we switch to the next track immediately; the old element just plays out its tail.
 */
function startCrossfade() {
  // the fade starts when `crossfade` seconds of *media* time remain; at 1.5× that is less wall-clock time
  const seconds = audioConfig.value.crossfade / (rate.value || 1);
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
    // equal power: cosine/sine, no volume dip in the middle.
    // The old track's volume is recomputed at every step — mute and the slider affect it too
    graph.setVolume(old, clamp01(targetVolume(oldTrack) * sleepMul * Math.cos((k * Math.PI) / 2)));
    fadeMul = Math.sin((k * Math.PI) / 2);
    applyVolume();
    if (k >= 1) {
      clearInterval(timer);
      old.pause();
      old.removeAttribute("src");
      old.load();
      graph.release(old);
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

// Queue generation: responses requested for the previous queue don't land in the new one
let queueGen = 0;

/** Play a list of tracks. ctx: { title, from, link } */
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

/** Start the wave (My Wave by default). */
export async function playWave({ stationId = "user:onyourwave", settings, title = "Моя волна" } = {}) {
  // loadToken — to cancel a load that's already in progress; we check against user intents, though:
  // auto-advance or a crossfade during the request must not cancel a click on the wave
  ++loadToken;
  const gen = ++intentGen;
  const edits = waveEdits.gen; // settings chips touched after this point win over what this start reports
  const isMyWave = stationId === "user:onyourwave";
  // a failed restart leaves the previous wave playing: the settings UI goes back to what is really playing
  const rollback = () => {
    const ctx = context.peek();
    if (isMyWave && waveEdits.gen === edits && ctx?.type === "wave" && ctx.stationId === stationId && ctx.settings) setWaveSettings(ctx.settings);
  };
  loading.value = true;
  try {
    const r = await api.post("/wave/start", { stationId, settings });
    if (gen !== intentGen) return; // while waiting, the user started something else
    if (!r.tracks?.length) {
      loading.value = false;
      rollback();
      toast("Волна ничего не нашла — ослабьте фильтры анти-повтора в настройках");
      return;
    }
    // close the previous track's accounting only now: if the wave didn't start, it keeps playing
    finishSession("skip");
    queueGen++;
    skipStreak = 0;
    waveFetching = null;
    // the server reports the settings it really used (saved ones when none were passed) — the hero,
    // pins and Now Playing follow them instead of a stale local copy
    // (normalized: older saved settings may lack newer keys such as activity, and pin keys compare all four)
    const raw = r.wave?.settings || settings;
    const used = raw ? { ...DEFAULT_WAVE_SETTINGS, ...raw } : null;
    batch(() => {
      queue.value = r.tracks;
      context.value = { type: "wave", title, stationId, settings: used, from: `desktop_win-radio-${stationId.replace(":", "_")}-default` };
      if (isMyWave && used && waveEdits.gen === edits) setWaveSettings(used);
    });
    return load(0);
  } catch (e) {
    if (gen !== intentGen) return;
    loading.value = false;
    rollback();
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

/** auto — the track changed by itself; reason: "error" — skipping an unavailable/broken track, not "played to the end". */
export async function next({ auto = false, reason } = {}) {
  const finished = auto && reason !== "error";
  if (!auto) intentGen++;
  finishSession(finished ? "ended" : "skip");
  // the "until end of track" timer: finished playing — stop
  if (finished && sleepTimer.value?.mode === "track") {
    sleepTimer.value = null;
    audio.pause();
    playing.value = false;
    toast("Таймер сна: воспроизведение остановлено");
    return;
  }
  const i = index.value;
  if (i < queue.value.length - 1) return load(i + 1);
  // wave restored after a restart (a single track saved): the queue ended — a new wave session, not a track repeat
  if (context.value?.resumeWave) return playWave({ stationId: context.value.stationId, title: context.value.title });
  if (context.value?.type === "wave") {
    const gen = queueGen;
    const ig = intentGen;
    const cur = queue.value[i];
    await maybeExtendWave();
    // while waiting for tracks, the user started another queue or another track in this one.
    // Editing the queue above the current track shifts index.value along with it, so we check that the same object is at the current
    // position (an indexOf lookup would stumble on a duplicate of this track in the queue)
    const j = queue.value[index.value] === cur ? index.value : -1;
    if (gen !== queueGen || ig !== intentGen || j < 0 || j !== index.value) return;
    if (j < queue.value.length - 1) return load(j + 1);
  }
  if (repeat.value === "all" && queue.value.length) return load(0);
  audio.pause();
  playing.value = false;
}

/** The element is already playing the current track (rather than waiting for a link to a new one while still holding the old stream). */
const elementIsCurrent = () => !!audio.src && srcTrack === current.value;

export function prev() {
  // while a new track loads, the old element's position means nothing — "previous" goes to the previous track
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
  // after an app restart the wave continues as a new session, not as a single saved track
  if (!audio.src && context.value?.resumeWave) return playWave({ stationId: context.value.stationId, title: context.value.title });
  if (!audio.src || (audio.paused && srcTrack !== current.value)) {
    // the element is empty or played another track (loading is still going, was interrupted or failed) —
    // play the current track again instead of resuming a foreign stream
    intentGen++;
    return load(index.value);
  }
  if (audio.paused) {
    cancelSleepFade(); // "Play" during the sleep-timer fade means they changed their mind about sleeping
    // the queue finished (or the "until end of track" timer stopped it) — the new listen also goes into the report
    if (!session && current.value) startSession(current.value);
    audio.play().catch(() => {});
  } else {
    cancelFade();
    audio.pause();
  }
}

export function seek(sec) {
  if (!Number.isFinite(sec)) return;
  // seeking while another track is loading would touch the old stream and send its position to the shell
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

/** Drops cached stream links (quality changed, local replacement set or removed); the next start resolves again. */
export function forgetResolved(trackId) {
  if (trackId == null) resolved.clear();
  else resolved.delete(trackId);
}

export function setAudioConfig(patch) {
  audioConfig.value = { ...audioConfig.value, ...patch };
  LS.set("ymc-crossfade", audioConfig.value.crossfade);
  LS.set("ymc-normalize", audioConfig.value.normalize);
  applyVolume();
}

export function setRate(v) {
  const r = clampRate(v);
  rate.value = r;
  for (const el of [audio, fade?.old]) if (el) el.defaultPlaybackRate = el.playbackRate = r;
  LS.set("ymc-rate", r);
}

// ---------- sleep timer ----------
let sleepInterval = null;

function cancelSleepFade() {
  if (!sleepFadeTimer) return;
  clearInterval(sleepFadeTimer);
  sleepFadeTimer = null;
  sleepMul = 1;
  applyVolume();
}

/** minutes: number of minutes, "track" — until the end of the current track, null — turn off. */
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
    // finish an ongoing crossfade at once: only one track fades
    cancelFade();
    // soft fade over 8 seconds rather than an abrupt cut
    const start = performance.now();
    sleepFadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - start) / 8000);
      sleepMul = 1 - k;
      applyVolume();
      if (k >= 1) {
        clearInterval(sleepFadeTimer);
        sleepFadeTimer = null;
        cancelFade(); // the crossfade must not outlive the fade and come back at full volume after sleepMul is reset
        // loading the next track and waiting for wave tracks still in flight would otherwise start music
        // after "good night" (next() and playWave check intentGen, load checks loadToken)
        ++intentGen;
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
    intentGen++; // an empty queue means a start by a user action
    load(0);
  } else persistQueue();
  toast(tracks.length > 1 ? "Добавлено в очередь" : `«${tracks[0].title}» будет следующим`);
}

export function enqueueEnd(tracks) {
  queue.value = [...queue.value, ...tracks];
  if (index.value < 0) {
    intentGen++; // an empty queue means a start by a user action
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

/** Reordering in the queue (drag-and-drop in the «Очередь» panel). */
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
    // roll back only this track, without clobbering likes set while the request was in flight
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

// ---------- <audio> events (current element only) ----------
function attachListeners(el) {
  const on = (type, fn) => el.addEventListener(type, (e) => el === audio && fn(e));
  on("play", () => graph.resume());
  on("playing", () => {
    playing.value = true;
    loading.value = false;
    skipStreak = 0; // reset only when sound actually started, not when the link was obtained
  });
  on("pause", () => {
    playing.value = false;
    graph.idle();
  });
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
      if (delta > 0 && delta < 2) session.played += delta; // seeking doesn't count as listening
      session.lastPos = t;
    }
    const dur = duration.value;
    const xf = audioConfig.value.crossfade;
    // get the next track's link in advance (with headroom for the crossfade)
    const nxt = queue.value[index.value + 1];
    if (nxt && dur - t < 25 + xf && !isFresh(nxt.id) && playable(nxt) && Date.now() - (prefetchFailedAt.get(nxt.id) || 0) > 15000) {
      // on error don't hammer the server on every timeupdate — pause 15 seconds
      resolveTrack(nxt).catch(() => prefetchFailedAt.set(nxt.id, Date.now()));
    }
    if (context.value?.type === "wave" && dur - t < 30) maybeExtendWave();
    // crossfade: not for track repeat, not for the "until end of track" timer, not during the sleep-timer fade, not for short tracks
    if (xf > 0 && !fade && !sleepFadeTimer && !el.paused && repeat.value !== "one" && sleepTimer.value?.mode !== "track" && dur > xf * 3 && dur - t <= xf) startCrossfade();
    if ("mediaSession" in navigator && Number.isFinite(el.duration)) {
      try {
        navigator.mediaSession.setPositionState({ duration: el.duration, position: Math.min(t, el.duration), playbackRate: rate.value });
      } catch {
        // position may be invalid during a seek
      }
    }
  });
  on("ended", () => {
    // the "until end of track" sleep timer outranks track repeat — otherwise the music would never stop
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
    // the link may have expired — try to get a new one once per listen
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

// ---------- system media keys and Windows SMTC ----------
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
  // toggle, not audio.play(): after a restart the <audio> has no src yet
  ms.setActionHandler("play", () => toggle());
  ms.setActionHandler("pause", () => toggle());
  ms.setActionHandler("nexttrack", () => next());
  ms.setActionHandler("previoustrack", () => prev());
  ms.setActionHandler("seekto", (e) => seek(e.seekTime));
  ms.setActionHandler("seekbackward", () => seek(audio.currentTime - 10));
  ms.setActionHandler("seekforward", () => seek(audio.currentTime + 10));
}

// control from the shell: global hotkeys, taskbar buttons, tray
window.__ymcControl = {
  toggle,
  next: () => next(),
  prev,
  like: () => current.value && like(current.value),
  volumeUp: () => setVolume(volume.value + 0.05),
  volumeDown: () => setVolume(volume.value - 0.05),
};

// window closed mid-track: the listen still makes it into history and the report to Yandex
window.addEventListener("pagehide", () => finishSession("skip", { keepalive: true }));

// ---------- queue restore (no autoplay) ----------
function persistQueue() {
  const list = queue.value;
  const i = index.value;
  // for a wave we save only the current track: the rest is re-requested anyway
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

/** Current playback time (for syncing lyrics in full-screen mode). */
export const currentTime = () => audio.currentTime;

// diagnostics for smoke tests: whether a crossfade is running and at what volume both tracks sound
window.__ymcDebug = () => ({ graph: graph.graphReady.value, levels: graph.levels(), ...graph.debugInfo(), fading: !!fade, oldVolume: fade ? graph.getVolume(fade.old) : null, volume: graph.getVolume(audio), fadeMul });
