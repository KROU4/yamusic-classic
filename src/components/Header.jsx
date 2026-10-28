// Верхняя панель: навигация назад/вперёд и поиск с подсказками.
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { route, go } from "../lib/router.js";
import { api } from "../lib/api.js";

function Search() {
  const initial = route.value.name === "search" ? route.value.params.q || "" : "";
  const [q, setQ] = useState(initial);
  const [sugg, setSugg] = useState([]);
  const [open, setOpen] = useState(false);
  const input = useRef(null);
  const timer = useRef(0);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey && e.key.toLowerCase() === "f") || (e.key === "/" && document.activeElement?.tagName !== "INPUT")) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onInput = (e) => {
    const v = e.currentTarget.value;
    setQ(v);
    clearTimeout(timer.current);
    if (v.trim().length < 2) return setSugg([]);
    timer.current = setTimeout(() => {
      api
        .get(`/suggest?q=${encodeURIComponent(v)}`)
        .then((r) => setSugg((r.suggestions || []).slice(0, 7)))
        .catch(() => setSugg([]));
    }, 180);
  };
  const submit = (text = q) => {
    const v = text.trim();
    if (!v) return;
    setOpen(false);
    go(`/search/${encodeURIComponent(v)}`);
    input.current?.blur();
  };
  return (
    <form
      class="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Icon name="search" size={18} />
      <input
        ref={input}
        value={q}
        onInput={onInput}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Трек, альбом, исполнитель"
        aria-label="Поиск"
      />
      {open && sugg.length > 0 && (
        <ul class="suggest">
          {sugg.map((s) => (
            <li key={s}>
              <button type="button" onMouseDown={() => (setQ(s), submit(s))}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** Верхняя панель над страницей: назад/вперёд и поиск. Разделы и профиль — в боковом меню. */
export function Topbar() {
  return (
    <div class="topbar">
      <div class="topbar-nav">
        <button class="icon-btn" onClick={() => history.back()} aria-label="Назад" title="Назад (Alt+←)">
          <Icon name="chevronLeft" size={22} />
        </button>
        <button class="icon-btn" onClick={() => history.forward()} aria-label="Вперёд" title="Вперёд (Alt+→)">
          <Icon name="chevronRight" size={22} />
        </button>
      </div>
      <Search />
    </div>
  );
}
