import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { fileInfoSign, lyricsSign, PLAYER_KEYS } from "../server/sign.js";
import { extractCandidates, resolveSession } from "../server/token.js";
import { curate, baseTitle, isRework, songKey } from "../server/curate.js";
import { parseLrc, isCensoredText } from "../server/lyrics.js";
import { preferOriginal, isExplicitTwin } from "../server/uncensor.js";
import { normTrack, coverUrl } from "../server/normalize.js";
import { settingsSeeds } from "../server/wave.js";

const track = (id, artistId, title, extra = {}) => ({
  id: String(id),
  title,
  version: null,
  artists: [{ id: artistId, name: `artist${artistId}` }],
  available: true,
  durationMs: 180000,
  ...extra,
});

describe("signatures", () => {
  it("file-info: HMAC-SHA256 in base64 without the last character", () => {
    const expected = crypto
      .createHmac("sha256", PLAYER_KEYS.win32)
      .update("100123lossless" + "flacmp3" + "raw")
      .digest("base64")
      .slice(0, -1);
    expect(fileInfoSign({ ts: 100, trackId: "123", quality: "lossless", codecs: ["flac", "mp3"], transports: ["raw"] })).toBe(expected);
  });
  it("lyrics: trackId + ts, full base64", () => {
    const expected = crypto.createHmac("sha256", PLAYER_KEYS.win32).update("555" + "100").digest("base64");
    expect(lyricsSign({ trackId: "555", ts: 100 })).toBe(expected);
  });
});

describe("session lookup", () => {
  const tok = (c) => `y0_${c.repeat(40)}`;
  it("fresh files and latest entries come first, duplicates are removed", () => {
    const files = [
      { name: "000005.ldb", mtimeMs: 1, content: Buffer.from(`xx${tok("A")}\x00yy`) },
      { name: "000350.log", mtimeMs: 5, content: Buffer.from(`${tok("B")}..${tok("C")}..${tok("A")}`) },
    ];
    expect(extractCandidates(files)).toEqual([tok("A"), tok("C"), tok("B")]);
  });
  it("glued ASCII bytes: also tries the variant trimmed to a typical length", () => {
    const real = `y0_${"Z".repeat(50)}`; // 53 characters
    const out = extractCandidates([{ name: "1.log", mtimeMs: 1, content: Buffer.from(`\x01${real}Ab9\x00`) }]);
    expect(out[0]).toBe(`${real}Ab9`);
    expect(out).toContain(real);
  });
  it("picks the first token that passes validation", async () => {
    const dir = await import("node:fs").then((fs) => fs.mkdtempSync(`${(process.env.TEMP || "/tmp")}/ymc-`));
    const r = await resolveSession({
      env: { YM_TOKEN: "bad" },
      stored: "good",
      dirs: [dir],
      validate: async (t) => (t === "good" ? { account: { uid: 1 } } : null),
    });
    expect(r.source).toBe("stored");
    expect(r.token).toBe("good");
  });
  it("returns null when there is no working token", async () => {
    const r = await resolveSession({ env: {}, dirs: [], validate: async () => null });
    expect(r).toBeNull();
  });
});

describe("wave curation", () => {
  const now = 1_000_000_000_000;
  it("drops recently played but lets through long-ago played", () => {
    const history = new Map([
      ["1", now - 1000],
      ["2", now - 40 * 86400000],
    ]);
    const { accepted, rejected } = curate([track(1, 1, "a"), track(2, 2, "b")], { history, now });
    expect(accepted.map((t) => t.id)).toEqual(["2"]);
    expect(rejected[0].reason).toBe("recently-played");
  });
  it("keeps distance between tracks by the same artist", () => {
    const { accepted } = curate([track(1, 7, "a"), track(2, 7, "b"), track(3, 8, "c")], { now, settings: { artistGap: 5 } });
    expect(accepted.map((t) => t.id)).toEqual(["1", "3"]);
  });
  it("treats slowed/sped up/hardtekk versions as one song", () => {
    const list = [track(1, 1, "Sometimes"), track(2, 1, "SOMETIMES - HARDTEKK"), track(3, 1, "Sometimes (Slowed + Reverb)")];
    const { accepted, rejected } = curate(list, { now, settings: { artistGap: 0 } });
    expect(accepted).toHaveLength(1);
    expect(rejected.every((r) => r.reason === "same-song")).toBe(true);
  });
  it("limits the share of liked tracks", () => {
    const liked = new Set(["1", "2", "3"]);
    const list = [track(1, 1, "a"), track(2, 2, "b"), track(3, 3, "c"), track(4, 4, "d")];
    expect(curate(list, { now, liked, settings: { likedEvery: 0 } }).accepted.map((t) => t.id)).toEqual(["4"]);
    expect(curate(list, { now, liked, settings: { likedEvery: 8 } }).accepted.map((t) => t.id)).toEqual(["1", "4"]);
    // "No limit" really lets all liked tracks through
    expect(curate(list, { now, liked, settings: { likedEvery: 1 } }).accepted.map((t) => t.id)).toEqual(["1", "2", "3", "4"]);
  });
  it("disliked and unavailable tracks don't pass, an available original rescues a substituted track", () => {
    const sub = track(9, 9, "orig");
    const list = [track(1, 1, "a", { available: false }), track(2, 2, "b", { available: false, substituted: sub }), track(3, 3, "c")];
    const { accepted } = curate(list, { now, disliked: new Set(["3"]) });
    expect(accepted.map((t) => t.id)).toEqual(["2"]);
  });
  it("rework filter tells 'Slow Dancing' from '(slowed)'", () => {
    expect(isRework(track(1, 1, "Slow Dancing in the Dark"))).toBe(false);
    expect(isRework(track(1, 1, "Song (Slowed)"))).toBe(true);
    expect(isRework(track(1, 1, "Song", { version: "Radio Edit" }))).toBe(true);
    expect(isRework(track(1, 1, "MONTAGEM XONADA (Super Slowed)"))).toBe(true);
    expect(isRework(track(1, 1, "Mix Tape"))).toBe(false);
  });
  it("baseTitle normalizes marks", () => {
    expect(baseTitle("Too Much (hardtekk)")).toBe("too much");
    expect(baseTitle("Decode - Sped Up")).toBe("decode");
    expect(baseTitle("Song (feat. X)")).toBe("song feat x");
    expect(songKey(track(1, 1, "A (Slowed)"))).toBe(songKey(track(2, 1, "A")));
  });
});

describe("lyrics", () => {
  it("parses LRC, including several timestamps per line", () => {
    const lines = parseLrc("[ar:x]\n[00:01.50]first\n[00:03.00][00:10.25]chorus\n[00:05.123]third");
    expect(lines.map((l) => [l.t, l.text])).toEqual([
      [1.5, "first"],
      [3, "chorus"],
      [5.123, "third"],
      [10.25, "chorus"],
    ]);
  });
  it("recognizes traces of censorship", () => {
    expect(isCensoredText("какой-то б*** текст")).toBe(true);
    expect(isCensoredText("*** ***")).toBe(true);
    expect(isCensoredText("обычный текст с 5*2 = 10")).toBe(false);
  });
});

describe("uncensored", () => {
  it("plays the available original instead of the substitute", () => {
    const orig = track(2, 1, "x");
    const t = track(1, 1, "x", { substituted: orig });
    expect(preferOriginal(t).id).toBe("2");
    expect(preferOriginal(t).replacedFrom).toBe("1");
    expect(preferOriginal(track(1, 1, "x", { substituted: { ...orig, available: false } })).id).toBe("1");
  });
  it("explicit twin: same artist, same title, close duration", () => {
    const clean = track(1, 5, "Song", { clean: true });
    expect(isExplicitTwin(clean, track(2, 5, "Song", { explicit: true }))).toBe(true);
    expect(isExplicitTwin(clean, track(2, 5, "Song", { explicit: false }))).toBe(false);
    expect(isExplicitTwin(clean, track(2, 6, "Song", { explicit: true }))).toBe(false);
    expect(isExplicitTwin(clean, track(2, 5, "Song", { explicit: true, durationMs: 240000 }))).toBe(false);
  });
});

describe("normalization", () => {
  it("builds the cover URL and extracts the substitution", () => {
    expect(coverUrl("avatars.yandex.net/get-music-content/1/a/%%", 200)).toBe("https://avatars.yandex.net/get-music-content/1/a/200x200");
    const t = normTrack({
      id: 1,
      title: "t",
      artists: [{ id: 2, name: "a" }],
      albums: [{ id: 3, title: "al" }],
      contentWarning: "explicit",
      substituted: { id: 4, title: "orig", artists: [], albums: [], available: true },
    });
    expect(t).toMatchObject({ id: "1", albumId: "3", explicit: true, substituted: { id: "4" } });
  });
  it("wave settings seeds", () => {
    expect(settingsSeeds({ diversity: "discover", moodEnergy: "all", language: "russian" })).toEqual(["settingDiversity:discover", "settingLanguage:russian"]);
    expect(settingsSeeds({})).toEqual([]);
    expect(settingsSeeds({ activity: "workout", moodEnergy: "calm" })).toEqual(["activity:workout", "settingMoodEnergy:calm"]);
    // unknown values don't turn into seeds
    expect(settingsSeeds({ activity: "x:y", diversity: "evil" })).toEqual([]);
  });
});

describe("service", () => {
  // service with a fake API: no network, only application logic is checked
  async function makeService() {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { Service } = await import("../server/service.js");
    const svc = new Service({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ymc-svc-")) });
    svc.account = { account: { uid: 1, login: "t" } };
    svc.api.uid = 1;
    svc.api.sessionFeedback = async () => ({});
    return svc;
  }
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it("edits of one playlist go in order with a fresh revision, an error doesn't break the queue", async () => {
    const svc = await makeService();
    let revision = 1;
    let count = 0;
    svc.api.playlist = async () => ({ revision, trackCount: count, tracks: [] });
    svc.api.changePlaylist = async (uid, kind, rev, diff) => {
      await tick();
      if (rev !== revision) throw new Error("stale revision");
      if (diff[0].tracks[0].id === "bad") throw new Error("boom");
      revision++;
      count += diff[0].tracks.length;
      return { kind, revision, trackCount: count };
    };
    const results = await Promise.allSettled([
      svc.addToPlaylist(5, [{ id: "1" }]),
      svc.addToPlaylist(5, [{ id: "bad" }]),
      svc.addToPlaylist(5, [{ id: "2" }]),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(results[1].reason.message).toBe("boom");
    expect(count).toBe(2);
    expect(svc.playlistLocks.size).toBe(0);
  });

  it("creating a playlist isn't a failure if the tracks weren't added", async () => {
    const svc = await makeService();
    svc.api.createPlaylist = async (uid, title) => ({ kind: 7, title, uid });
    svc.api.playlist = async () => ({ revision: 1, trackCount: 0 });
    svc.api.changePlaylist = async () => {
      throw new Error("нет связи");
    };
    const r = await svc.createPlaylist("Новый", [{ id: "1" }]);
    expect(r.playlist.kind).toBe(7);
    expect(r.addError).toBe("нет связи");
    expect((await svc.createPlaylist("Пустой")).addError).toBeNull();
  });

  it("statistics keep top tracks that couldn't be loaded", async () => {
    const svc = await makeService();
    svc.playlog.add({ id: "9", title: "Песня", artists: [{ id: 1, name: "A" }], albumId: "3", cover: null }, 120);
    svc.api.tracks = async () => {
      throw new Error("offline");
    };
    const s = await svc.stats(7);
    expect(s.topTracks).toHaveLength(1);
    expect(s.topTracks[0]).toMatchObject({ id: "9", albumId: "3", title: "Песня", durationMs: 0, available: true, plays: 1, seconds: 120 });
  });

  it("a refill failure doesn't crash the wave launch", async () => {
    const svc = await makeService();
    svc.api.sessionNew = async () => ({ radioSessionId: "s1", batchId: "b1", sequence: [] });
    svc.api.sessionTracks = async () => {
      throw new Error("timeout");
    };
    const r = await svc.wave.start({ stationId: "genre:rock" });
    expect(r.sessionId).toBe("s1");
    expect(svc.wave.session.stationId).toBe("genre:rock");
  });

  it("a stale station launch doesn't take the buffer of a newer one", async () => {
    const svc = await makeService();
    let n = 0;
    svc.api.sessionNew = async () => ({ radioSessionId: `s${++n}`, batchId: "b", sequence: [] });
    let release;
    const gate = new Promise((r) => (release = r));
    svc.api.sessionTracks = async (id) => {
      if (id === "s1") await gate;
      return { sequence: [] };
    };
    const first = svc.waveStart({ stationId: "genre:rock" });
    await tick();
    const second = await svc.waveStart({ stationId: "genre:jazz" });
    release();
    await expect(first).rejects.toMatchObject({ status: 409 });
    expect(second.sessionId).toBe("s2");
    expect(svc.wave.session.stationId).toBe("genre:jazz");
  });
});
