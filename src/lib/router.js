// Минимальный hash-роутер: #/album/123 -> { name: "album", params: { id: "123" } }.
import { signal } from "@preact/signals";

const ROUTES = [
  ["home", /^\/?$/],
  ["search", /^\/search(?:\/(?<q>.+))?$/],
  ["album", /^\/album\/(?<id>\d+)$/],
  ["artist", /^\/artist\/(?<id>\d+)$/],
  ["playlist", /^\/playlist\/(?<uid>[\w.-]+)\/(?<kind>\d+)$/],
  ["collection", /^\/collection(?:\/(?<tab>\w+))?$/],
  ["chart", /^\/chart$/],
  ["new", /^\/new$/],
  ["radio", /^\/radio$/],
  ["settings", /^\/settings$/],
  ["stats", /^\/stats$/],
];

function parse() {
  const path = decodeURIComponent(location.hash.replace(/^#/, "") || "/");
  for (const [name, re] of ROUTES) {
    const m = path.match(re);
    if (m) return { name, params: { ...(m.groups || {}) }, path };
  }
  return { name: "home", params: {}, path };
}

export const route = signal(parse());

// Сохраняем прокрутку каждой страницы: возврат «назад» не сбрасывает позицию (частая жалоба)
const scrollPositions = new Map();
let current = route.value.path;

window.addEventListener("hashchange", () => {
  const main = document.querySelector(".main");
  if (main) scrollPositions.set(current, main.scrollTop);
  const next = parse();
  current = next.path;
  route.value = next;
  requestAnimationFrame(() => {
    const el = document.querySelector(".main");
    if (el) el.scrollTop = scrollPositions.get(next.path) || 0;
  });
});

export const go = (path) => {
  location.hash = path;
};
export const href = (path) => `#${path}`;
