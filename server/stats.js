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

const formatters = new Map(); // timeZone -> Intl.DateTimeFormat (создавать его дорого)

function zoneFormatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Календарный сдвиг ключа YYYY-MM-DD на n дней — без привязки к часовому поясу. */
const shiftDay = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Локальные часы: ts -> { day: YYYY-MM-DD, hour }. С IANA-поясом учитывает переходы на летнее время,
 * без него (или с неизвестным поясом) — фиксированное смещение tzOffsetMin, как getTimezoneOffset().
 */
function localClock(timeZone, tzOffsetMin) {
  if (timeZone) {
    try {
      const fmt = zoneFormatter(timeZone);
      const memo = new Map(); // все смещения поясов кратны 15 минутам — кэшируем по четвертям часа
      return (ts) => {
        const slot = Math.floor(ts / 900000);
        let v = memo.get(slot);
        if (!v) {
          const p = {};
          for (const { type, value } of fmt.formatToParts(new Date(ts))) p[type] = value;
          v = { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
          memo.set(slot, v);
        }
        return v;
      };
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      // неизвестный пояс — откатываемся на смещение
    }
  }
  return (ts) => {
    const local = new Date(ts - tzOffsetMin * 60000);
    return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
  };
}

/** Сводка за последние `days` дней. Чистая функция — удобно тестировать. */
export function computeStats(entries, { days = 7, now = Date.now(), tzOffsetMin = 0, timeZone = null } = {}) {
  const clock = localClock(timeZone, tzOffsetMin);
  const today = clock(now).day;
  // окно начинается с локальной полуночи (days-1) дней назад: первый столбец «по дням» — полный день
  const firstDay = shiftDay(today, -(days - 1));
  const list = entries.filter((e) => e.ts <= now && clock(e.ts).day >= firstDay);
  const artists = new Map();
  const tracks = new Map();
  const byHour = Array(24).fill(0);
  const byDay = new Map(); // YYYY-MM-DD -> секунды
  let total = 0;

  for (const e of list) {
    total += e.s;
    const { day: dayKey, hour } = clock(e.ts);
    byHour[hour] += e.s;
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
  const allDays = new Set(entries.map((e) => clock(e.ts).day));
  let streak = 0;
  for (let d = 0; d < 3650; d++) {
    if (allDays.has(shiftDay(today, -d))) streak++;
    else if (d > 0) break; // сегодня можно ещё не успеть послушать
  }

  const dayList = [];
  for (let d = days - 1; d >= 0; d--) {
    const key = shiftDay(today, -d);
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
