// Finding the OAuth session already created by the official Yandex Music client.
// The token value is never logged or sent to the renderer:
// it lives only in the memory of the server process.
import fs from "node:fs";
import path from "node:path";

const TOKEN_RE = /y0_[A-Za-z0-9_-]{30,}/g;
const TOKEN_LENGTHS = [53, 58];

/** Local Storage directories of the official app (both stable and beta builds). */
export function officialStorageDirs(env = process.env) {
  const appData = env.APPDATA || (env.HOME ? path.join(env.HOME, ".config") : "");
  if (!appData) return [];
  return ["YandexMusic", "YandexMusicBeta", "yandex-music"].map((name) =>
    path.join(appData, name, "Local Storage", "leveldb"),
  );
}

/**
 * Extracts candidates from LevelDB files.
 * LevelDB appends new values to the end of the newest .log,
 * so the order is: newest files first, and within a file the latest occurrences first.
 */
export function extractCandidates(files) {
  const ordered = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  const seen = new Set();
  const out = [];
  for (const file of ordered) {
    const text = file.content.toString("latin1");
    const matches = [...text.matchAll(TOKEN_RE)].map((m) => m[0]).reverse();
    for (const match of matches) {
      // ASCII bytes of the next record may follow the value in LevelDB right away,
      // so besides the exact match we also try typical token lengths
      const variants = [match, ...TOKEN_LENGTHS.filter((n) => match.length > n).map((n) => match.slice(0, n))];
      for (const token of variants) {
        if (!seen.has(token)) {
          seen.add(token);
          out.push(token);
        }
      }
    }
  }
  return out;
}

export function readCandidatesFromDisk(dirs = officialStorageDirs()) {
  const files = [];
  for (const dir of dirs) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/\.(log|ldb)$/.test(name)) continue;
      const full = path.join(dir, name);
      try {
        files.push({ name, mtimeMs: fs.statSync(full).mtimeMs, content: fs.readFileSync(full) });
      } catch {
        // the file may be locked by the running app: skip it
      }
    }
  }
  return extractCandidates(files);
}

/**
 * Picks the first working token. validate(token) -> Promise<account|null>.
 * Sources by priority: YM_TOKEN from the environment, one saved manually, the official app.
 */
export async function resolveSession({ validate, stored = null, env = process.env, dirs } = {}) {
  const sources = [];
  if (env.YM_TOKEN) sources.push({ token: env.YM_TOKEN, source: "env" });
  if (stored) sources.push({ token: stored, source: "stored" });
  for (const token of readCandidatesFromDisk(dirs)) sources.push({ token, source: "official-app" });

  for (const candidate of sources) {
    const account = await validate(candidate.token).catch(() => null);
    if (account) return { ...candidate, account };
  }
  return null;
}
