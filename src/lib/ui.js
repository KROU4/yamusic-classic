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
      // без сохранения
    }
  });
  return s;
};

/** Открыт ли полноэкранный «Сейчас играет». */
export const nowPlayingOpen = signal(false);

/** Открыта ли справка по горячим клавишам. */
export const shortcutsOpen = signal(false);

/** Анимация «Моей волны»: full — шейдер, реагирующий на музыку; lite — лёгкая CSS-анимация; off — статичный фон. */
export const vibeMode = persisted("ymc-vibe-mode", "full");

/** Свёрнутое боковое меню (только иконки). */
export const sidebarCollapsed = persisted("ymc-sidebar-collapsed", false);

/** Вкладка главной: «Для вас» или «Тренды». */
export const homeTab = persisted("ymc-home-tab", "foryou");
