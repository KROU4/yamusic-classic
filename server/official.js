// Assets borrowed at runtime from the official Yandex Music app installed on this PC — the same app whose
// sign-in session the client already uses. Nothing is bundled or redistributed: the files are read from the
// user's own installation (inside its app.asar, which Electron's fs reads transparently) and cached locally.
// Currently: the official "My Wave" orb animation loops (the official client's own fallback/lite animation).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VIBE = {
  dark: "app/media/vibe_animation_fallback/vibe_animation_fallback_dark.mp4",
  light: "app/media/vibe_animation_fallback/vibe_animation_fallback_light.mp4",
  darkPoster: "app/media/vibe_animation_fallback/vibe_animation_fallback_dark.jpeg",
  lightPoster: "app/media/vibe_animation_fallback/vibe_animation_fallback_light.jpeg",
};

/** Where the official app keeps its resources (per-user install by default). */
export function officialAsarCandidates(env = process.env) {
  const out = [];
  if (env.YMC_OFFICIAL_APP) out.push(path.join(env.YMC_OFFICIAL_APP, "resources", "app.asar"));
  const local = env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  out.push(path.join(local, "Programs", "YandexMusic", "resources", "app.asar"));
  if (env.ProgramFiles) out.push(path.join(env.ProgramFiles, "YandexMusic", "resources", "app.asar"));
  return out;
}

/**
 * Copies the official orb loops into cacheDir once (re-copied when the official app updates them) and
 * returns { dark, light, darkPoster, lightPoster } absolute paths, or null when unavailable
 * (no official app, or running outside Electron where app.asar can't be read).
 */
export function officialVibeFiles(cacheDir, { candidates = officialAsarCandidates(), fsImpl = fs } = {}) {
  for (const asar of candidates) {
    try {
      if (!fsImpl.existsSync(asar)) continue;
      fsImpl.mkdirSync(cacheDir, { recursive: true });
      const out = {};
      for (const [key, rel] of Object.entries(VIBE)) {
        const src = path.join(asar, rel);
        const dst = path.join(cacheDir, path.basename(rel));
        const size = fsImpl.statSync(src).size;
        if (!fsImpl.existsSync(dst) || fsImpl.statSync(dst).size !== size) fsImpl.writeFileSync(dst, fsImpl.readFileSync(src));
        out[key] = dst;
      }
      return out;
    } catch {
      // unreadable (plain Node can't open asar, or the layout changed): try the next candidate
    }
  }
  return null;
}
