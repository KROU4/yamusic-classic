// Live check of playlist operations: creates a private test playlist,
// adds and removes a track, renames and deletes the playlist. `node scripts/probe-playlists.js`
import os from "node:os";
import path from "node:path";
import { Service } from "../server/service.js";

const svc = new Service({ dataDir: path.join(os.tmpdir(), "ymc-smoke") });
await svc.init();
const [a, b] = (await svc.album(3389008)).tracks;
const { playlist } = await svc.createPlaylist("YMC test (удалится)", [a]);
console.log("создан:", playlist.kind, playlist.title);
try {
  await svc.addToPlaylist(playlist.kind, [b]);
  let p = await svc.playlist(svc.api.uid, playlist.kind);
  console.log("после добавления:", p.tracks.map((t) => t.title));
  await svc.removeFromPlaylist(playlist.kind, a, 0);
  p = await svc.playlist(svc.api.uid, playlist.kind);
  console.log("после удаления:", p.tracks.map((t) => t.title));
  const r = await svc.renamePlaylist(playlist.kind, "YMC test renamed");
  console.log("переименован:", r.playlist.title);
} finally {
  await svc.deletePlaylist(playlist.kind);
  const left = (await svc.myPlaylists()).playlists.filter((x) => x.kind === playlist.kind);
  console.log("удалён:", left.length === 0);
}
