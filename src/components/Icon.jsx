// Набор SVG-иконок (24×24, currentColor).
const PATHS = {
  play: "M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z",
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  next: "M6 6.5v11a.8.8 0 0 0 1.2.7l8.3-5.5a.8.8 0 0 0 0-1.4L7.2 5.8A.8.8 0 0 0 6 6.5zM17 6h2v12h-2z",
  prev: "M18 6.5v11a.8.8 0 0 1-1.2.7l-8.3-5.5a.8.8 0 0 1 0-1.4l8.3-5.5A.8.8 0 0 1 18 6.5zM5 6h2v12H5z",
  heart: "M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z",
  heartOutline:
    "M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4zm0-2.4c2.2-1.5 6.2-4.6 7.3-7.6.8-2.3-.6-4.1-2.5-4.1-1.5 0-2.7 1-3.6 2.6L12 10.4l-1.2-1.4C9.9 7.4 8.7 6.4 7.2 6.4c-1.9 0-3.3 1.8-2.5 4.1 1.1 3 5.1 6.1 7.3 7.6z",
  ban: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 0 1 5.6 11.2L7.8 6.4A7 7 0 0 1 12 5zM5 12c0-1.6.5-3 1.4-4.2l9.8 9.8A7 7 0 0 1 5 12z",
  shuffle: "M16.5 4.5 20 8l-3.5 3.5V9h-2.1l-6.6 8H4v-2h2.9l6.6-8h3V4.5zM4 7h3.8l2.2 2.6-1.3 1.6L6.9 9H4zm12.5 7.5L20 18l-3.5 3.5V19h-3.1l-2.4-2.9 1.3-1.6 2 2.5h2.2z",
  repeat: "M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z",
  repeatOne: "M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2zM11 10h1.8v5H11v-3.4l-.9.3v-1.3z",
  volume: "M4 9v6h4l5 4V5L8 9zm11.5 3a4 4 0 0 0-2-3.5v7a4 4 0 0 0 2-3.5zm-2-7.8v2.1a7 7 0 0 1 0 11.4v2.1a9 9 0 0 0 0-15.6z",
  mute: "M4 9v6h4l5 4V5L8 9zm16.6-.2-1.4-1.4-2.6 2.6-2.6-2.6-1.4 1.4 2.6 2.6-2.6 2.6 1.4 1.4 2.6-2.6 2.6 2.6 1.4-1.4-2.6-2.6z",
  search: "M10.5 4a6.5 6.5 0 0 1 5.2 10.4l4.4 4.4-1.4 1.4-4.4-4.4A6.5 6.5 0 1 1 10.5 4zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z",
  lyrics: "M4 5h16v2H4zm0 4h10v2H4zm0 4h16v2H4zm0 4h10v2H4z",
  queue: "M4 6h12v2H4zm0 5h12v2H4zm0 5h8v2H4zm14-2v-5l4 3.5z",
  settings:
    "M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z",
  close: "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z",
  more: "M6 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  wave: "M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0",
  up: "M12 6l6 8H6z",
  down: "M12 18l-6-8h12z",
  back: "M15.4 6.4 14 5l-7 7 7 7 1.4-1.4L9.8 12z",
  addQueue: "M4 6h12v2H4zm0 5h12v2H4zm0 5h8v2H4zm15-3V10h-2v3h-3v2h3v3h2v-3h3v-2z",
};

export function Icon({ name, size = 20, class: cls = "", title }) {
  const d = PATHS[name];
  if (name === "wave") {
    return (
      <svg class={`icon ${cls}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : "true"}>
        <path d={d} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
      </svg>
    );
  }
  return (
    <svg class={`icon ${cls}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : "true"} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <path d={d} fill="currentColor" fill-rule="evenodd" />
    </svg>
  );
}
