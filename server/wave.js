// Wave manager on top of rotor/session: a buffer of already filtered tracks and feedback to the server.
import { normTrack } from "./normalize.js";
import { curate } from "./curate.js";
import { ApiError } from "./yandex.js";

// Settings seed values match "Customize wave" in the classic UI
export const WAVE_SETTINGS = {
  diversity: ["default", "favorite", "discover", "popular"],
  moodEnergy: ["all", "active", "fun", "calm", "sad"],
  language: ["any", "russian", "not-russian", "without-words"],
  // "Activity": an activity:* station seed next to user:onyourwave, the wave stays personal but fits the activity
  activity: ["any", "wake-up", "workout", "road-trip", "work-background", "study-background", "party", "fall-asleep"],
};

export function settingsSeeds({ diversity = "default", moodEnergy = "all", language = "any", activity = "any" } = {}) {
  const ok = (key, v) => WAVE_SETTINGS[key].includes(v);
  const seeds = [];
  if (activity !== "any" && ok("activity", activity)) seeds.push(`activity:${activity}`);
  if (diversity !== "default" && ok("diversity", diversity)) seeds.push(`settingDiversity:${diversity}`);
  if (moodEnergy !== "all" && ok("moodEnergy", moodEnergy)) seeds.push(`settingMoodEnergy:${moodEnergy}`);
  if (language !== "any" && ok("language", language)) seeds.push(`settingLanguage:${language}`);
  return seeds;
}

const MAX_FETCH_ROUNDS = 6;
const TARGET_BUFFER = 6;

export class WaveManager {
  /**
   * @param deps { api, history: PlayHistory, getLibrary: () => {liked:Set, disliked:Set}, getPrefs: () => prefs, log }
   */
  constructor(deps) {
    this.deps = deps;
    this.session = null;
    this.stats = { fetched: 0, rejected: {} };
  }

  get prefs() {
    return this.deps.getPrefs();
  }

  async start({ stationId = "user:onyourwave", settings = {}, extraSeeds = [] } = {}) {
    const { api, history } = this.deps;
    const seeds = [stationId, ...settingsSeeds(settings), ...extraSeeds];
    const queue = history.tape.slice(-30).map((t) => t.id);
    const gen = (this.startGen = (this.startGen || 0) + 1);
    const r = await api.sessionNew({ seeds, queue, allowExplicit: this.prefs.allowExplicit, aiReduced: this.prefs.aiReduced });
    // while waiting for the response, the user started another station: this launch is stale
    if (gen !== this.startGen) throw new ApiError("Запуск станции отменён более новым", 409);
    const session = (this.session = {
      id: r.radioSessionId,
      batchId: r.batchId,
      stationId,
      seeds,
      settings,
      buffer: [],
      served: new Set(),
      description: r.descriptionSeed?.value || null,
    });
    this.stats = { fetched: 0, rejected: {} };
    this.filling = null; // background refill of the previous station has nothing to do with the new one
    this.absorb(r.sequence);
    this.feedback("radioStarted", null).catch(() => {});
    // the session is already new: a refill failure must not crash the launch, otherwise the client stays on the old wave
    try {
      await this.fill();
    } catch (e) {
      this.deps.log?.("wave fill failed", e.message);
    }
    // use the id of our own session, not the current one: another station may have started during fill
    return { sessionId: session.id, seeds, stationId };
  }

  absorb(sequence = []) {
    const s = this.session;
    const candidates = sequence.map((x) => normTrack(x.track)).filter((t) => t && !s.served.has(t.id));
    this.stats.fetched += candidates.length;
    const { liked, disliked } = this.deps.getLibrary();
    const { accepted, rejected } = curate(candidates, {
      history: this.deps.history.tracks,
      songHistory: this.deps.history.songs,
      recent: [...this.deps.history.tape, ...s.buffer],
      liked,
      disliked,
      settings: this.prefs.curation,
    });
    for (const r of rejected) this.stats.rejected[r.reason] = (this.stats.rejected[r.reason] || 0) + 1;
    for (const t of accepted) {
      s.served.add(t.id);
      s.buffer.push(t);
    }
  }

  async fill() {
    const s = this.session;
    if (!s) return;
    if (this.filling && this.fillingFor === s) return this.filling;
    const p = (async () => {
      for (let i = 0; i < MAX_FETCH_ROUNDS && s.buffer.length < TARGET_BUFFER && this.session === s; i++) {
        const queue = [...this.deps.history.tape.slice(-20).map((t) => t.id), ...s.served].slice(-60);
        const r = await this.deps.api.sessionTracks(s.id, { queue, aiReduced: this.prefs.aiReduced });
        if (this.session !== s) break;
        if (r.batchId) s.batchId = r.batchId;
        if (!r.sequence?.length) break;
        this.absorb(r.sequence);
      }
    })().finally(() => {
      if (this.filling === p) this.filling = null;
    });
    this.filling = p;
    this.fillingFor = s;
    return p;
  }

  /** Returns the next tracks and refills the buffer in the background. */
  async next(count = 3) {
    if (!this.session) await this.start();
    const s = this.session;
    // a refill error doesn't break the response: return what is already in the buffer
    if (s.buffer.length < count) await this.fill().catch((e) => this.deps.log?.("wave fill failed", e.message));
    // while waiting, another station was started: don't touch its buffer
    if (this.session !== s) throw new ApiError("Запуск станции отменён более новым", 409);
    const out = s.buffer.splice(0, count);
    this.fill().catch((e) => this.deps.log?.("wave fill failed", e.message));
    return out;
  }

  /** Events: radioStarted, trackStarted, trackFinished, skip, like, dislike. */
  async feedback(type, track, totalPlayedSeconds) {
    const s = this.session;
    if (!s) return;
    const event = { type, timestamp: new Date().toISOString(), from: `desktop_win-radio-${s.stationId.replace(":", "_")}-default` };
    if (track) event.trackId = track.albumId ? `${track.id}:${track.albumId}` : track.id;
    if (totalPlayedSeconds != null) event.totalPlayedSeconds = Math.round(totalPlayedSeconds);
    await this.deps.api.sessionFeedback(s.id, s.batchId, event);
  }

  info() {
    const s = this.session;
    return s
      ? { active: true, stationId: s.stationId, settings: s.settings, buffered: s.buffer.length, description: s.description, stats: this.stats }
      : { active: false, stats: this.stats };
  }
}
