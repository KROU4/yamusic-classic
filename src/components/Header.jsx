// Шапка классической Яндекс Музыки: логотип, разделы вкладками, поиск.
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { route, go, href } from "../lib/router.js";
import { api } from "../lib/api.js";

const TABS = [
  ["home", "/", "Главное"],
  ["radio", "/radio", "Радио"],
  ["chart", "/chart", "Чарт"],
  ["new", "/new", "Новинки"],
  ["collection", "/collection", "Коллекция"],
];

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

export function Header({ me }) {
  const name = route.value.name;
  return (
    <header class="header">
      <a class="logo" href={href("/")} aria-label="Главная">
        <span class="logo-mark">
          <Icon name="play" size={14} />
        </span>
        <span class="logo-text">
          Музыка <small>classic</small>
        </span>
      </a>
      <nav class="tabs" aria-label="Разделы">
        {TABS.map(([key, path, label]) => (
          <a key={key} href={href(path)} class={name === key ? "on" : ""} aria-current={name === key ? "page" : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <Search />
      <a class={`icon-btn header-settings ${name === "settings" ? "on" : ""}`} href={href("/settings")} aria-label="Настройки" title="Настройки">
        <Icon name="settings" />
      </a>
      {me?.authorized && (
        <a class="avatar" href={href("/settings")} title={`${me.name}${me.hasPlus ? " · Плюс" : ""}`}>
          {(me.name || "?").slice(0, 1).toUpperCase()}
          {me.hasPlus && <span class="plus-dot" />}
        </a>
      )}
    </header>
  );
}
