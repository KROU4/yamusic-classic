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

/** Frame rate cap for the wave animation: 30, 60 or 0 (the screen's own rate). Above 30 the 25 fps official loop gets blended in-between frames. */
export const vibeFps = persisted("ymc-vibe-fps", 60);

/** The orb breathes with the bass and flares on a like; off — it just loops. */
export const vibeReact = persisted("ymc-vibe-react", true);

/** Accent colour of buttons, the play control and highlights (see ACCENTS in theme.js). */
export const accent = persisted("ymc-accent", "yellow");

/** The player bar takes a hint of the cover colour. */
export const playerTint = persisted("ymc-player-tint", true);

/** Arrow keys: seek step in seconds and volume step in percent (player bar sliders and global hotkeys alike). */
export const seekStep = persisted("ymc-seek-step", 10);
export const volumeStep = persisted("ymc-volume-step", 5);

/** The player shows the time left instead of the track length. */
export const timeLeft = persisted("ymc-time-left", false);

/** A Windows notification with the cover when the track changes while the window is in the background. */
export const trackNotify = persisted("ymc-track-notify", false);

/** Fewer interface animations regardless of the system setting. */
export const calmUi = persisted("ymc-calm-ui", false);

/** Accents offered in the settings: the swatch colour (dark theme) for the picker. */
export const ACCENTS = [
  ["yellow", "Жёлтый", "#ffcc33"],
  ["orange", "Оранжевый", "#ff8a3d"],
  ["pink", "Розовый", "#ff6fae"],
  ["violet", "Сиреневый", "#b69cff"],
  ["sky", "Голубой", "#5cb8ff"],
  ["mint", "Мятный", "#3ddc97"],
];

// both live as attributes on <html>, the stylesheet does the rest
accent.subscribe((v) => (document.documentElement.dataset.accent = ACCENTS.some(([k]) => k === v) ? v : "yellow"));
calmUi.subscribe((v) => (document.documentElement.dataset.motion = v ? "calm" : "full"));

/** Collapsed sidebar (icons only). */
export const sidebarCollapsed = persisted("ymc-sidebar-collapsed", false);

/** Home tab: «Для вас» or «Тренды». */
export const homeTab = persisted("ymc-home-tab", "foryou");

/** Lyrics: show a (machine) translation under each line. */
export const lyricsTranslate = persisted("ymc-lyrics-translate", false);
