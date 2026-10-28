// Calls to the local backend. The launch key arrives in the address (#k=...) and is kept in sessionStorage.

function readKey() {
  const m = location.hash.match(/(?:^#|&)k=([a-f0-9]+)/);
  if (m) {
    try {
      sessionStorage.setItem("ymc-key", m[1]);
    } catch {
      // private mode — live without persistence
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
// the key may arrive after the page loads (hash change without reload)
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
    keepalive, // the request outlives page close
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

/** Simple page cache for the session: revisiting a page is instant. */
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
