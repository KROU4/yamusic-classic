// Менеджер волны поверх rotor/session: буфер уже отфильтрованных треков и фидбэк серверу.
import { normTrack } from "./normalize.js";
import { curate } from "./curate.js";
import { ApiError } from "./yandex.js";

// Значения сидов настроек — как в «Настроить волну» классического интерфейса
export const WAVE_SETTINGS = {
  diversity: ["default", "favorite", "discover", "popular"],
  moodEnergy: ["all", "active", "fun", "calm", "sad"],
  language: ["any", "russian", "not-russian", "without-words"],
};

export function settingsSeeds({ diversity = "default", moodEnergy = "all", language = "any" } = {}) {
  const seeds = [];
  if (diversity !== "default") seeds.push(`settingDiversity:${diversity}`);
  if (moodEnergy !== "all") seeds.push(`settingMoodEnergy:${moodEnergy}`);
  if (language !== "any") seeds.push(`settingLanguage:${language}`);
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
    // пока ждали ответ, пользователь запустил другую станцию — этот запуск устарел
    if (gen !== this.startGen) throw new ApiError("Запуск станции отменён более новым", 409);
    this.session = {
      id: r.radioSessionId,
      batchId: r.batchId,
      stationId,
      seeds,
      settings,
      buffer: [],
      served: new Set(),
      description: r.descriptionSeed?.value || null,
    };
    this.stats = { fetched: 0, rejected: {} };
    this.filling = null; // фоновое дозаполнение прежней станции к новой отношения не имеет
    this.absorb(r.sequence);
    this.feedback("radioStarted", null).catch(() => {});
    await this.fill();
    return { sessionId: this.session.id, seeds, stationId };
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

  /** Отдаёт следующие треки и в фоне дозаполняет буфер. */
  async next(count = 3) {
    if (!this.session) await this.start();
    if (this.session.buffer.length < count) await this.fill();
    const out = this.session.buffer.splice(0, count);
    this.fill().catch((e) => this.deps.log?.("wave fill failed", e.message));
    return out;
  }

  /** События: radioStarted, trackStarted, trackFinished, skip, like, dislike. */
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
