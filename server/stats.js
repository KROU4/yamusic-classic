// Журнал прослушиваний для страницы «Моя статистика». Живёт отдельно от истории анти-повтора:
// её очистка (чтобы снова слышать сыгранное) не стирает статистику.

const DAY = 24 * 60 * 60 * 1000;
const MAX_LOG = 20000;

export class PlayLog {
  constructor(store) {
    this.store = store;
    this.entries = store.get("playlog") || [];
  }

  add(track, seconds, now = Date.now()) {
    if (!track?.id || !(seconds > 0)) return;
    this.entries.push({
      id: track.id,
      t: track.title,
      a: (track.artists || []).map((x) => [x.id, x.name]),
      al: track.albumId || null,
      c: track.cover || null,
      s: Math.round(seconds),
      ts: now,
    });
    if (this.entries.length > MAX_LOG) this.entries = this.entries.slice(-MAX_LOG);
    this.store.set("playlog", this.entries);
  }

  clear() {
    this.entries = [];
    this.store.set("playlog", this.entries);
  }
}

/** Сводка за последние `days` дней. Чистая функция — удобно тестировать. */
export function computeStats(entries, { days = 7, now = Date.now(), tzOffsetMin = 0 } = {}) {
  const from = now - days * DAY;
  const list = entries.filter((e) => e.ts >= from && e.ts <= now);
  const artists = new Map();
  const tracks = new Map();
  const byHour = Array(24).fill(0);
  const byDay = new Map(); // YYYY-MM-DD -> секунды
  let total = 0;

  for (const e of list) {
    total += e.s;
    const local = new Date(e.ts - tzOffsetMin * 60000);
    byHour[local.getUTCHours()] += e.s;
    const dayKey = local.toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) || 0) + e.s);

    const tr = tracks.get(e.id) || { id: e.id, title: e.t, artists: e.a.map(([id, name]) => ({ id, name })), albumId: e.al, cover: e.c, plays: 0, seconds: 0 };
    tr.plays += 1;
    tr.seconds += e.s;
    tracks.set(e.id, tr);

    // время делим между соавторами, чтобы фиты не раздували статистику
    const share = e.s / Math.max(1, e.a.length);
    for (const [id, name] of e.a) {
      const ar = artists.get(id) || { id, name, seconds: 0, plays: 0, cover: e.c };
      ar.seconds += share;
      ar.plays += 1;
      artists.set(id, ar);
    }
  }

  // серия: сколько дней подряд до сегодняшнего включительно была музыка
  const allDays = new Set(entries.map((e) => new Date(e.ts - tzOffsetMin * 60000).toISOString().slice(0, 10)));
  let streak = 0;
  for (let d = 0; d < 3650; d++) {
    const key = new Date(now - tzOffsetMin * 60000 - d * DAY).toISOString().slice(0, 10);
    if (allDays.has(key)) streak++;
    else if (d > 0) break; // сегодня можно ещё не успеть послушать
  }

  const dayList = [];
  for (let d = days - 1; d >= 0; d--) {
    const key = new Date(now - tzOffsetMin * 60000 - d * DAY).toISOString().slice(0, 10);
    dayList.push({ day: key, seconds: byDay.get(key) || 0 });
  }

  return {
    days,
    plays: list.length,
    totalSeconds: total,
    uniqueTracks: tracks.size,
    uniqueArtists: artists.size,
    streak,
    topArtists: [...artists.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 10).map((a) => ({ ...a, seconds: Math.round(a.seconds) })),
    topTracks: [...tracks.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, 15),
    byHour,
    byDay: dayList,
    peakHour: byHour.some(Boolean) ? byHour.indexOf(Math.max(...byHour)) : null,
  };
}
