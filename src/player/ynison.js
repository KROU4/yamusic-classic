// Ynison in the UI: long-polls the backend's view of the shared state, follows commands from other devices while
// this client is the active player, and publishes local playback while it is (or explicitly becomes) active.
// The backend owns the connection and does nothing unless the setting is on.
import { signal, effect } from "@preact/signals";
import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import * as p from "./engine.js";
import { queueMatches, sameListIndex, statusPlan, statusDiffers, sharedProgressNow, contextFor, windowIds } from "./ynisonLogic.js";

export const ynison = signal({ enabled: false, status: "off", devices: [], track: null });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let started = false;
let rev = null;

export function startYnison() {
  if (started) return;
  started = true;
  poll();
  watchLocal();
}

async function poll() {
  for (;;) {
    try {
      const v = await api.get(`/ynison/state${rev == null ? "" : `?rev=${rev}`}`);
      rev = v.rev;
      ynison.value = v;
      follow(v);
    } catch {
      await sleep(5000);
    }
  }
}

// ---------- following the shared state ----------
let wasActive = false;
let lastActive = null; // device that played before us: its "I paused" after a handover is not a command
let activatedAt = 0;
let seenQueue = "";
let seenStatus = "";
let adoptGen = 0;
let adopting = false;

function follow(v) {
  const online = v.enabled && v.status === "online";
  const active = online && v.activeIsMe;
  if (active && !wasActive) {
    activatedAt = Date.now();
    adoptAll(v);
  } else if (active) {
    if (v.queueVer?.key !== seenQueue && v.queueVer?.author !== v.me) adoptQueue(v);
    else if (v.statusVer?.key !== seenStatus && v.statusVer?.author !== v.me) adoptStatus(v);
  } else if (wasActive && online && v.active && p.playing.value) {
    // another device took over: like the official client, stop here and stop publishing
    p.toggle();
  }
  if (!active && online) lastActive = v.active || null;
  // nobody is active while we play (we just (re)connected, or the old device left): offer to become active
  if (online && !v.active && p.playing.value) schedule(600);
  seenQueue = v.queueVer?.key || "";
  seenStatus = v.statusVer?.key || "";
  wasActive = active;
}

const localIds = () => p.queue.value.map((t) => t.id);

/** Just became active (phone chose us, or «Слушать здесь»): pick up what played elsewhere. */
function adoptAll(v) {
  if (v.queueVer?.author === v.me) return; // we became active with our own queue (local play): nothing to take over
  if (v.index < 0 || !(v.ids || []).some(Boolean)) return; // nothing shared: the publisher sends ours
  adoptQueue(v);
}

async function adoptQueue(v) {
  const gen = ++adoptGen;
  const ids = localIds();
  const same = sameListIndex(ids, p.index.value, v);
  if (same >= 0) {
    if (same !== p.index.value) p.playAt(same);
    adoptStatus(v);
    return;
  }
  adopting = true;
  try {
    const r = await api.get("/ynison/queue");
    if (gen !== adoptGen || !ynison.value.activeIsMe) return;
    if (!r.tracks.length) return toast("В очереди другого устройства нет треков, которые можно включить здесь");
    const latest = ynison.value;
    const cur = r.tracks[r.index];
    // the position belongs to the shared current track; if that one can't play here, start from the beginning
    const startAt = cur && latest.track?.id === cur.id ? sharedProgressNow(latest) / 1000 : 0;
    await p.playList(r.tracks, r.index, contextFor(r), { autoplay: !latest.paused, startAt, keepOrder: true });
  } catch (e) {
    if (gen === adoptGen) toast(`Не удалось перенести воспроизведение: ${e.message}`);
  } finally {
    if (gen === adoptGen) adopting = false;
  }
}

function adoptStatus(v) {
  // right after a handover the previous device reports its own pause: that's not a command to us
  if (v.paused && Date.now() - activatedAt < 3000 && v.statusVer?.author && v.statusVer.author === lastActive) return;
  const plan = statusPlan({ hasTrack: !!p.current.value, playing: p.playing.value, loading: p.loading.value, position: p.position.value }, v);
  if (plan.toggle && !(p.loading.value && v.paused)) p.toggle();
  if (plan.seekTo != null) p.seek(plan.seekTo);
}

// ---------- publishing local playback ----------
let timer = null;
let lastPlaying = false;
let stoppedAt = 0;
let userStartAt = 0; // a real start (not a track switch): may take over from another device
let sentAt = 0;
let sentRev = null;
let ifNoneAt = 0;

function snapshot() {
  const list = p.queue.value;
  const i = p.index.value;
  const start = Math.max(0, i - 100);
  const ctx = p.context.value || {};
  return {
    tracks: list.slice(start, i + 100).map((t) => ({ id: t.id, albumId: t.albumId, title: t.title, cover: t.cover })),
    index: i - start,
    context: { type: ctx.type, stationId: ctx.stationId, link: ctx.link, from: ctx.from, resumeWave: !!ctx.resumeWave },
    repeat: p.repeat.value,
    playing: p.playing.value,
    positionMs: Math.round(p.position.value * 1000),
    durationMs: Math.round(p.duration.value * 1000),
    rate: p.rate.value,
  };
}

function schedule(ms = 400) {
  clearTimeout(timer);
  timer = setTimeout(publish, ms);
}

function watchLocal() {
  effect(() => {
    const playing = p.playing.value;
    // dependencies: anything that changes what other devices should show
    void (p.index.value, p.queue.value, p.seekGen.value, p.repeat.value, p.duration.value, p.loading.value);
    if (playing && !lastPlaying && Date.now() - stoppedAt > 1500) userStartAt = Date.now();
    if (!playing && lastPlaying) stoppedAt = Date.now();
    lastPlaying = playing;
    schedule();
  });
}

function send(kind, intercept) {
  sentAt = Date.now();
  sentRev = rev;
  api.post("/ynison/publish", { ...snapshot(), kind, ...(intercept ? { intercept } : {}) }).catch(() => {});
}

function publish() {
  const v = ynison.value;
  if (!v.enabled || v.status !== "online" || !p.current.value) return;
  // mid-load or mid-takeover the local state is half-built: wait for it to settle
  if (adopting || p.loading.value) return schedule(800);
  // the answer to our last send hasn't arrived yet: comparing against the old shared state would send twice
  if (sentRev === rev && Date.now() - sentAt < 2000) return schedule(500);
  const ids = localIds();
  const i = p.index.value;
  if (v.activeIsMe) {
    userStartAt = 0;
    if (!queueMatches(ids, i, v)) return send("queue");
    const s = snapshot();
    if (statusDiffers({ playing: s.playing, positionMs: s.positionMs, durationMs: s.durationMs }, v)) send("status");
    return;
  }
  // passive: only an explicit local start takes over — eagerly if someone else plays (the official client's
  // interceptActivity), otherwise only if nobody is active
  if (userStartAt && p.playing.value && Date.now() - userStartAt < 10000) {
    userStartAt = 0;
    send("queue", v.active ? "eager" : "if_none");
  } else if (!v.active && p.playing.value && Date.now() - ifNoneAt > 30000) {
    // only takes effect if still nobody is active; rate-limited so a server that refuses can't make us spin
    ifNoneAt = Date.now();
    send("queue", "if_none");
  }
}

// diagnostics for smoke runs
window.__ymcYnison = () => ({ view: ynison.value, wasActive, adopting, local: { ids: windowIds(localIds(), Math.max(0, p.index.value)).ids.length, playing: p.playing.value } });
