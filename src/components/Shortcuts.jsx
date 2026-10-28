// Справка по горячим клавишам: открывается клавишей «?» или из настроек.
import { useEffect } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { shortcutsOpen } from "../lib/ui.js";
import { isDesktop } from "../lib/desktop.js";

const GROUPS = [
  [
    "Плеер",
    [
      ["Пробел", "Пауза / играть"],
      ["→ / ←", "Перемотка на 10 секунд"],
      ["Shift + → / ←", "Следующий / предыдущий трек"],
      ["↑ / ↓", "Громкость"],
      ["L", "Мне нравится"],
    ],
  ],
  [
    "Навигация",
    [
      ["Ctrl + F или /", "Поиск"],
      ["Alt + ← / →", "Назад / вперёд"],
      ["?", "Эта справка"],
      ["Esc", "Закрыть окно, меню или «Сейчас играет»"],
    ],
  ],
];
const DESKTOP = [
  "Приложение",
  [
    ["Ctrl + плюс / минус", "Масштаб интерфейса"],
    ["Ctrl + 0", "Масштаб 100%"],
    ["Ctrl + Alt + P", "Пауза — из любой программы"],
    ["Ctrl + Alt + → / ←", "Трек — из любой программы"],
    ["Ctrl + Alt + ↑ / ↓", "Громкость — из любой программы"],
    ["Ctrl + Alt + L", "Лайк — из любой программы"],
  ],
];

export function Shortcuts() {
  const open = shortcutsOpen.value;
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && (shortcutsOpen.value = false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  const groups = isDesktop ? [...GROUPS, DESKTOP] : GROUPS;
  return (
    <div class="modal-scrim" onClick={(e) => e.target === e.currentTarget && (shortcutsOpen.value = false)}>
      <div class="modal" role="dialog" aria-label="Горячие клавиши">
        <div class="modal-head">
          <h2>Горячие клавиши</h2>
          <button class="icon-btn" onClick={() => (shortcutsOpen.value = false)} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </div>
        <div class="kbd-groups">
          {groups.map(([title, rows]) => (
            <section key={title}>
              <h3>{title}</h3>
              <dl>
                {rows.map(([k, d]) => (
                  <div key={k} class="kbd-row">
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{d}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
