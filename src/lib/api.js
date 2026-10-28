// Обращения к локальному бэкенду. Ключ запуска приходит в адресе (#k=...) и хранится в sessionStorage.

function readKey() {
  const m = location.hash.match(/(?:^#|&)k=([a-f0-9]+)/);
  if (m) {
    try {
      sessionStorage.setItem("ymc-key", m[1]);
    } catch {
      // приватный режим — живём без сохранения
    }
    history.replaceState(null, "", location.pathname + location.search + "#/");
    return m[1];
  }
  try {
    return sessionStorage.getItem("ymc-key") || "";
  } catch {
    return "";
  }
}

let KEY = readKey();
// ключ может прийти и после загрузки страницы (смена хеша без перезагрузки)
window.addEventListener("hashchange", () => {
  if (/(?:^#|&)k=/.test(location.hash)) {
    KEY = readKey();
    location.reload();
  }
});

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(method, path, body, { keepalive = false } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    keepalive, // запрос переживёт закрытие страницы
    headers: { "x-ymc-key": KEY, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(data?.error || `Ошибка ${res.status}`, res.status);
  return data;
}

export const api = {
  get: (path) => call("GET", path),
  post: (path, body = {}, opts) => call("POST", path, body, opts),
};

/** Простой кэш страниц на время сессии: повторный заход на страницу — мгновенный. */
const pageCache = new Map();
export async function cachedGet(path, ttlMs = 120000) {
  const hit = pageCache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await api.get(path);
  pageCache.set(path, { at: Date.now(), data });
  return data;
}
export const peekCache = (path) => pageCache.get(path)?.data;
export const dropCache = (prefix = "") => {
  for (const k of pageCache.keys()) if (k.startsWith(prefix)) pageCache.delete(k);
};
