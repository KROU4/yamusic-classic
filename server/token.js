// Поиск OAuth-сессии, уже созданной официальным клиентом Яндекс Музыки.
// Значение токена никогда не логируется и не отдаётся в renderer:
// оно живёт только в памяти серверного процесса.
import fs from "node:fs";
import path from "node:path";

const TOKEN_RE = /y0_[A-Za-z0-9_-]{30,}/g;

/** Каталоги Local Storage официального приложения (и стабильной, и beta-сборки). */
export function officialStorageDirs(env = process.env) {
  const appData = env.APPDATA || (env.HOME ? path.join(env.HOME, ".config") : "");
  if (!appData) return [];
  return ["YandexMusic", "YandexMusicBeta", "yandex-music"].map((name) =>
    path.join(appData, name, "Local Storage", "leveldb"),
  );
}

/**
 * Достаёт кандидатов из файлов LevelDB.
 * LevelDB дописывает новые значения в конец самого свежего .log,
 * поэтому порядок такой: свежие файлы раньше, внутри файла последние вхождения раньше.
 */
export function extractCandidates(files) {
  const ordered = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  const seen = new Set();
  const out = [];
  for (const file of ordered) {
    const text = file.content.toString("latin1");
    const matches = [...text.matchAll(TOKEN_RE)].map((m) => m[0]).reverse();
    for (const token of matches) {
      if (!seen.has(token)) {
        seen.add(token);
        out.push(token);
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
        // файл может быть заблокирован запущенным приложением — пропускаем
      }
    }
  }
  return extractCandidates(files);
}

/**
 * Выбирает первый рабочий токен. validate(token) -> Promise<account|null>.
 * Источники по приоритету: YM_TOKEN из окружения, сохранённый вручную, официальное приложение.
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
