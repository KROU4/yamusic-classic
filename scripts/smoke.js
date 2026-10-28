// Live backend check on a real session: `node scripts/smoke.js`.
// Prints only summaries, no tokens.
import os from "node:os";
import path from "node:path";
import { Service } from "../server/service.js";

const svc = new Service({ dataDir: path.join(os.tmpdir(), "ymc-smoke"), log: (...a) => console.error("[log]", ...a) });
const step = async (name, fn) => {
  const t = performance.now();
  try {
    const r = await fn();
    console.log(`OK   ${name} (${Math.round(performance.now() - t)} мс)`, r);
    return true;
  } catch (e) {
    console.log(`FAIL ${name}:`, e.status || "", e.message);
    process.exitCode = 1;
    return false;
  }
};

await step("init", async () => (await svc.init()).authorized && svc.me().login);
await step("home", async () => {
  const h = await svc.home();
  return { personal: h.personal.map((p) => p.title), chart: h.chart.length, releases: h.newReleases.length, genres: h.stations?.genre?.length, moods: h.stations?.mood?.length };
});
let first;
await step("wave start (discover)", async () => {
  const r = await svc.waveStart({ settings: { diversity: "discover", moodEnergy: "all", language: "any" } });
  first = r.tracks[0];
  return { got: r.tracks.map((t) => `${t.artists[0]?.name} — ${t.title}${t.explicit ? " [E]" : ""}`), stats: r.wave.stats };
});
await step("wave next", async () => (await svc.waveNext(5)).tracks.map((t) => `${t.artists[0]?.name} — ${t.title}`));
await step("resolve play", async () => {
  const r = await svc.resolvePlay(first);
  return { codec: r.stream.codec, bitrate: r.stream.bitrate, quality: r.stream.quality, host: new URL(r.stream.url).host };
});
await step("lyrics", async () => {
  const s = await svc.search("Кино Группа крови", "track");
  const t = s.tracks[0];
  const l = await svc.lyrics(t);
  return { track: t.title, source: l.source, synced: l.synced, lines: l.lines.length, censored: l.censored };
});
await step("album", async () => {
  const a = await svc.album(3389008);
  return { title: a.album.title, tracks: a.tracks.length };
});
await step("artist", async () => {
  const a = await svc.artist(3120);
  return { name: a.artist.name, popular: a.popular.length, albums: a.albums.length };
});
await step("collection", async () => {
  const c = await svc.collection();
  return { liked: c.likedCount, playlists: c.playlists.length, artists: c.artists.length };
});
await step("likes", async () => (await svc.likedTracks()).tracks.length);
await step("chart", async () => (await svc.chart()).tracks.length);
await step("new releases", async () => (await svc.newReleases()).length);
svc.store.saveNow();
