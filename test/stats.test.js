import { describe, it, expect } from "vitest";
import { computeStats, PlayLog } from "../server/stats.js";

const DAY = 86400000;
const now = Date.UTC(2026, 9, 28, 20, 0, 0);
const e = (id, artists, s, ago) => ({ id, t: `t${id}`, a: artists, al: null, c: null, s, ts: now - ago });

describe("статистика", () => {
  const log = [
    e("1", [[10, "A"]], 200, 1000),
    e("1", [[10, "A"]], 200, 2 * DAY),
    e("2", [[10, "A"], [11, "B"]], 100, 3 * DAY),
    e("3", [[12, "C"]], 300, 10 * DAY), // вне недельного окна
  ];

  it("считает время, прослушивания и топы за окно", () => {
    const s = computeStats(log, { days: 7, now });
    expect(s.plays).toBe(3);
    expect(s.totalSeconds).toBe(500);
    expect(s.uniqueTracks).toBe(2);
    expect(s.topTracks[0]).toMatchObject({ id: "1", plays: 2 });
    // фит делит время поровну: A = 200+200+50, B = 50
    expect(s.topArtists.map((a) => [a.name, a.seconds])).toEqual([
      ["A", 450],
      ["B", 50],
    ]);
  });

  it("серия дней и раскладка по дням", () => {
    const s = computeStats([e("1", [[1, "x"]], 60, 0), e("1", [[1, "x"]], 60, DAY), e("1", [[1, "x"]], 60, 3 * DAY)], { days: 7, now });
    expect(s.streak).toBe(2);
    expect(s.byDay).toHaveLength(7);
    expect(s.byDay.at(-1).seconds).toBe(60);
  });

  it("первый день окна учитывается целиком, с локальной полуночи", () => {
    // now = 20:00 UTC; окно 7 дней начинается в 00:00 UTC шесть дней назад
    const firstDayMorning = Date.UTC(2026, 9, 22, 1, 0, 0);
    const beforeWindow = Date.UTC(2026, 9, 21, 23, 0, 0);
    const s = computeStats(
      [
        { id: "1", t: "a", a: [[1, "x"]], s: 100, ts: firstDayMorning },
        { id: "2", t: "b", a: [[1, "x"]], s: 50, ts: beforeWindow },
      ],
      { days: 7, now },
    );
    expect(s.totalSeconds).toBe(100);
    expect(s.byDay[0]).toEqual({ day: "2026-10-22", seconds: 100 });
    // в UTC+3 (tz = -180) те же события — уже другие локальные дни
    const msk = computeStats([{ id: "1", t: "a", a: [[1, "x"]], s: 100, ts: beforeWindow }], { days: 7, now, tzOffsetMin: -180 });
    expect(msk.totalSeconds).toBe(100);
    expect(msk.byDay[0].day).toBe("2026-10-22");
  });

  it("пустой журнал", () => {
    const s = computeStats([], { days: 30, now });
    expect(s).toMatchObject({ plays: 0, totalSeconds: 0, streak: 0, peakHour: null });
  });

  it("журнал ограничен и игнорирует пустые записи", () => {
    const mem = { data: {}, get(k) { return this.data[k]; }, set(k, v) { this.data[k] = v; } };
    const pl = new PlayLog(mem);
    pl.add({ id: "1", title: "x", artists: [] }, 0);
    pl.add(null, 10);
    pl.add({ id: "2", title: "y", artists: [{ id: 1, name: "a" }] }, 12.6);
    expect(pl.entries).toHaveLength(1);
    expect(pl.entries[0].s).toBe(13);
  });
});
