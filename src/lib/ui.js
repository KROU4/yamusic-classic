import { signal } from "@preact/signals";

const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
const persisted = (key, fallback) => {
  const s = signal(read(key, fallback));
  s.subscribe((v) => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // without persistence
    }
  });
  return s;
};

/** Whether full-screen Now Playing is open. */
export const nowPlayingOpen = signal(false);

/** Whether the keyboard shortcuts help is open. */
export const shortcutsOpen = signal(false);

/** My Wave animation: full — shader reacting to music; lite — light CSS animation; off — static background. */
export const vibeMode = persisted("ymc-vibe-mode", "full");

/** Collapsed sidebar (icons only). */
export const sidebarCollapsed = persisted("ymc-sidebar-collapsed", false);

/** Home tab: «Для вас» or «Тренды». */
export const homeTab = persisted("ymc-home-tab", "foryou");

/** Lyrics: show a (machine) translation under each line. */
export const lyricsTranslate = persisted("ymc-lyrics-translate", false);
