// Звуковой граф Web Audio: эквалайзер и анализатор частот для анимации волны.
// Работает только в оболочке Electron: она добавляет CORS-заголовок к ответам аудио-CDN Яндекса,
// без него MediaElementSource отдаёт тишину. В обычном браузере граф не строится, звук идёт напрямую.
import { signal } from "@preact/signals";

export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_LABELS = ["32", "64", "125", "250", "500", "1К", "2К", "4К", "8К", "16К"];
export const MAX_DB = 12;

export const EQ_PRESETS = {
  flat: { name: "Ровно", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { name: "Больше баса", gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  bassTreble: { name: "Бас и верха", gains: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5] },
  vocal: { name: "Вокал", gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  rock: { name: "Рок", gains: [4, 3, 1, -1, -2, -1, 1, 3, 4, 4] },
  electronic: { name: "Электроника", gains: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5] },
  acoustic: { name: "Акустика", gains: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1] },
  night: { name: "Тихо ночью", gains: [-3, -2, -1, 0, 1, 2, 2, 1, -1, -3] },
  treble: { name: "Больше верхов", gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
};

const LS_KEY = "ymc-eq";
function readEq() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY));
    if (v && Array.isArray(v.gains) && v.gains.length === BANDS.length) return { enabled: !!v.enabled, preset: v.preset || "custom", gains: v.gains.map(clampDb) };
  } catch {
    // повреждённое значение — берём настройки по умолчанию
  }
  return { enabled: false, preset: "flat", gains: [...EQ_PRESETS.flat.gains] };
}
function clampDb(v) {
  return Math.max(-MAX_DB, Math.min(MAX_DB, Math.round((+v || 0) * 2) / 2));
}

export const eq = signal(readEq());
/** Граф собран и звук реально идёт через него (эквалайзер и реакция анимации на музыку доступны). */
export const graphReady = signal(false);
// window.ymcDesktop читаем напрямую: lib/desktop.js сам импортирует движок плеера
export const webAudioSupported = !!window.ymcDesktop && typeof AudioContext !== "undefined";

let ctx = null;
let preamp = null;
let filters = [];
let analyser = null;
let freq = null;
const sources = new WeakMap(); // элемент -> { src, gain }

function build() {
  if (ctx || !webAudioSupported) return ctx;
  try {
    ctx = new AudioContext({ latencyHint: "playback" });
    preamp = ctx.createGain();
    filters = BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? "lowshelf" : i === BANDS.length - 1 ? "highshelf" : "peaking";
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    freq = new Uint8Array(analyser.frequencyBinCount);
    let node = preamp;
    for (const f of filters) node = node.connect(f);
    node.connect(ctx.destination);
    applyEq();
    graphReady.value = true;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Готовит новый аудиоэлемент: CORS-режим ставится до src, источник графа создаётся один раз на элемент. */
export function prepare(el) {
  if (!webAudioSupported) return;
  el.crossOrigin = "anonymous";
  if (!build() || sources.has(el)) return;
  try {
    // громкость элемента Chromium к выходу MediaElementSource не применяет — у каждого элемента свой GainNode.
    // Анализатор подключён до громкости: анимация реагирует на музыку и при тихом звуке
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = el.volume;
    src.connect(gain).connect(preamp);
    src.connect(analyser);
    sources.set(el, { src, gain });
  } catch {
    // элемент уже подключён к другому контексту — играет мимо графа
  }
}

/** Элемент больше не нужен (кроссфейд завершён): отключаем его от графа. */
export function release(el) {
  const node = sources.get(el);
  if (!node) return;
  try {
    node.src.disconnect();
    node.gain.disconnect();
  } catch {
    // уже отключён
  }
  sources.delete(el);
}

/** Громкость элемента 0..1: через граф, если элемент к нему подключён, иначе обычным свойством volume. */
export function setVolume(el, v) {
  const node = sources.get(el);
  if (!node) {
    el.volume = v;
    return;
  }
  el.volume = 1;
  // короткое сглаживание убирает щелчки при перетаскивании ползунка; шаги кроссфейда идут раз в 50 мс
  node.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.015);
}

export function getVolume(el) {
  const node = sources.get(el);
  return node ? node.gain.gain.value : el.volume;
}

/** Контекст мог уснуть (система, долгая пауза) — будим на каждом старте воспроизведения. */
export function resume() {
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

function applyEq() {
  if (!ctx) return;
  const { enabled, gains } = eq.value;
  const g = enabled ? gains : BANDS.map(() => 0);
  const t = ctx.currentTime;
  filters.forEach((f, i) => f.gain.setTargetAtTime(g[i], t, 0.03));
  // запас по громкости: самый сильный подъём компенсируется, чтобы не было клиппинга
  const headroom = Math.max(0, ...g);
  preamp.gain.setTargetAtTime(10 ** (-headroom / 20), t, 0.03);
}

export function setEq(patch) {
  const next = { ...eq.value, ...patch };
  next.gains = next.gains.map(clampDb);
  eq.value = next;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // без сохранения
  }
  applyEq();
}

export function setBand(i, db) {
  const gains = [...eq.value.gains];
  gains[i] = db;
  setEq({ gains, preset: "custom", enabled: true });
}

export function usePreset(key) {
  const p = EQ_PRESETS[key];
  if (p) setEq({ gains: [...p.gains], preset: key, enabled: true });
}

const avg = (a, from, to) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return s / Math.max(1, to - from) / 255;
};

/** Уровни бас/середина/верх 0..1 для визуализации; null, если анализ недоступен. */
export function levels() {
  if (!analyser || ctx.state !== "running") return null;
  analyser.getByteFrequencyData(freq);
  const hz = ctx.sampleRate / analyser.fftSize; // ширина одного бина
  const bin = (f) => Math.min(freq.length, Math.max(1, Math.round(f / hz)));
  const bass = avg(freq, bin(30), bin(160));
  const mid = avg(freq, bin(160), bin(2000));
  const high = avg(freq, bin(2000), bin(9000));
  return { bass, mid, high, energy: bass * 0.55 + mid * 0.3 + high * 0.15 };
}
