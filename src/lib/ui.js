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

/** My Wave animation: official — the official app's orb (when installed); shader — own WebGL orb; lite — CSS; off — static. */
export const vibeMode = persisted("ymc-vibe-mode", "official");
// earlier builds stored "full" for the own shader; the official orb is the new default for everyone
if (vibeMode.peek() === "full") vibeMode.value = "official";

/** Collapsed sidebar (icons only). */
export const sidebarCollapsed = persisted("ymc-sidebar-collapsed", false);

/** Home tab: «Для вас» or «Тренды». */
export const homeTab = persisted("ymc-home-tab", "foryou");

/** Lyrics: show a (machine) translation under each line. */
export const lyricsTranslate = persisted("ymc-lyrics-translate", false);
