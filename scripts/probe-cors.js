// Probes: (1) CORS headers on audio CDN responses (needed for Web Audio), (2) wave seeds accepted by rotor.
// Prints only summaries, never the token or signed URLs.
import os from "node:os";
import path from "node:path";
import { Service } from "../server/service.js";

const svc = new Service({ dataDir: path.join(os.tmpdir(), "ymc-smoke"), log: () => {} });
await svc.init();
const s = await svc.search("Radiohead Airbag", "track");
const r = await svc.resolvePlay(s.tracks[0]);
for (const origin of ["http://127.0.0.1:47819", "https://music.yandex.ru"]) {
  const res = await fetch(r.stream.url, { headers: { Origin: origin, Range: "bytes=0-1023" } });
  console.log(origin, "->", res.status, "ACAO:", res.headers.get("access-control-allow-origin"));
}
const api = svc.api;
for (const seeds of [["user:onyourwave", "activity:workout"], ["user:onyourwave", "settingActivity:workout"], ["activity:workout"]]) {
  try {
    const x = await api.sessionNew({ seeds, queue: [] });
    console.log(seeds.join("+"), "OK", (x.sequence || []).slice(0, 3).map((i) => i.track?.title).join(" | "), "seed:", x.descriptionSeed?.value);
  } catch (e) {
    console.log(seeds.join("+"), "FAIL", e.status, e.message);
  }
}
