// Sidebar in the spirit of Yandex Music 2023–2024: sections, «Мне нравится» and pinned items.
import { useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { paletteFor } from "./VibeCanvas.jsx";
import { route, href, go } from "../lib/router.js";
import { pins, unpin, movePin, pinKey } from "../lib/pins.js";
import { sidebarCollapsed } from "../lib/ui.js";
import * as p from "../player/engine.js";

const NAV = [
  ["home", "/", "home", "Главная"],
  ["chart", "/chart", "trend", "Чарт"],
  ["new", "/new", "sparkle", "Новинки"],
  ["radio", "/radio", "radio", "Радио"],
  ["collection", "/collection", "library", "Коллекция"],
  ["stats", "/stats", "stats", "Статистика"],
];

const KIND = { playlist: "Плейлист", album: "Альбом", artist: "Исполнитель", wave: "Моя волна" };

function pinLink(pin) {
  if (pin.type === "playlist") return `/playlist/${pin.uid}/${pin.kind}`;
  if (pin.type === "album") return `/album/${pin.id}`;
  if (pin.type === "artist") return `/artist/${pin.id}`;
  return null;
}

function PinThumb({ pin }) {
  if (pin.type === "wave") {
    const [a, b, c] = paletteFor(pin.settings);
    return <span class="pin-thumb wave" style={{ background: `radial-gradient(circle at 35% 35%, ${a}, ${b} 55%, ${c})` }} />;
  }
  return <span class={`pin-thumb ${pin.type === "artist" ? "round" : ""}`}>{pin.cover ? <img src={pin.cover} alt="" loading="lazy" /> : <Icon name={pin.type === "artist" ? "artist" : "album"} size={18} />}</span>;
}

function PinItem({ pin, i, collapsed }) {
  const [over, setOver] = useState(false);
  const link = pinLink(pin);
  const ctx = p.context.value;
  const isWaveOn = pin.type === "wave" && ctx?.type === "wave" && ctx.stationId === "user:onyourwave" && pinKey({ type: "wave", settings: ctx.settings }) === pinKey(pin);
  const active = link ? route.value.path === link : isWaveOn;
  const open = () => (link ? go(link) : isWaveOn ? p.toggle() : p.playWave({ settings: pin.settings }));
  return (
    <li
      class={`pin ${active ? "on" : ""} ${over ? "drop" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/ymc-pin", String(i));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("text/ymc-pin")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const from = Number(e.dataTransfer.getData("text/ymc-pin"));
        if (Number.isInteger(from)) movePin(from, i);
      }}
    >
      <button class="pin-main" onClick={open} title={collapsed ? `${pin.title} · ${KIND[pin.type]}` : undefined}>
        <PinThumb pin={pin} />
        {!collapsed && (
          <span class="pin-text">
            <span class="pin-title">{pin.title}</span>
            <span class="pin-sub">{isWaveOn && p.playing.value ? "Играет" : KIND[pin.type]}</span>
          </span>
        )}
      </button>
      {!collapsed && (
        <button class="pin-x" onClick={() => unpin(pin)} aria-label={`Открепить «${pin.title}»`} title="Открепить">
          <Icon name="close" size={14} />
        </button>
      )}
    </li>
  );
}

export function Sidebar({ me }) {
  const name = route.value.name;
  const collapsed = sidebarCollapsed.value;
  const tab = route.value.params?.tab;
  // no avatar or it failed to load (offline) — the initial stays
  const [avatarFailed, setAvatarFailed] = useState(false);
  return (
    <aside class={`sidebar ${collapsed ? "is-collapsed" : ""}`} aria-label="Боковое меню">
      <div class="sb-head">
        <a class="logo" href={href("/")} aria-label="Главная">
          <span class="logo-mark">
            <Icon name="play" size={14} />
          </span>
          {!collapsed && (
            <span class="logo-text">Музыка</span>
          )}
        </a>
        <button class="icon-btn sb-collapse" onClick={() => (sidebarCollapsed.value = !collapsed)} aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"} title={collapsed ? "Развернуть меню" : "Свернуть меню"}>
          <Icon name="sidebar" size={18} />
        </button>
      </div>

      <nav class="sb-nav" aria-label="Разделы">
        {NAV.map(([key, path, icon, label]) => {
          const on = name === key && !(key === "collection" && tab && tab !== "likes");
          return (
            <a key={key} href={href(path)} class={on ? "on" : ""} aria-current={on ? "page" : undefined} title={collapsed ? label : undefined}>
              <Icon name={icon} size={22} />
              {!collapsed && <span>{label}</span>}
            </a>
          );
        })}
      </nav>

      <div class="sb-sep" />
      <div class="sb-scroll">
        <a class={`pin fav ${name === "collection" && (!tab || tab === "likes") ? "on" : ""}`} href={href("/collection/likes")} title={collapsed ? "Мне нравится" : undefined}>
          <span class="pin-main">
            <span class="pin-thumb like">
              <Icon name="heart" size={18} />
            </span>
            {!collapsed && (
              <span class="pin-text">
                <span class="pin-title">Мне нравится</span>
                <span class="pin-sub">Плейлист</span>
              </span>
            )}
          </span>
        </a>
        {pins.value.length > 0 ? (
          <ul class="pins">
            {pins.value.map((pin, i) => (
              <PinItem key={pinKey(pin)} pin={pin} i={i} collapsed={collapsed} />
            ))}
          </ul>
        ) : (
          !collapsed && <p class="sb-hint">Закрепляйте плейлисты, альбомы, исполнителей и настройки волны кнопкой «Закрепить» — они появятся здесь.</p>
        )}
      </div>

      <div class="sb-foot">
        <a class={`sb-user ${name === "settings" ? "on" : ""}`} href={href("/settings")} title="Настройки">
          <span class={`avatar ${me?.hasPlus ? "plus" : ""}`}>
            {me?.avatar && !avatarFailed ? (
              <img src={me.avatar} alt="" onError={() => setAvatarFailed(true)} referrerpolicy="no-referrer" />
            ) : (
              (me?.name || "?").slice(0, 1).toUpperCase()
            )}
            {me?.hasPlus && <span class="plus-dot" />}
          </span>
          {!collapsed && (
            <span class="pin-text">
              <span class="pin-title">{me?.name || "Профиль"}</span>
              <span class="pin-sub">{me?.hasPlus ? "Плюс" : "Настройки"}</span>
            </span>
          )}
          {!collapsed && <Icon name="settings" size={18} />}
        </a>
      </div>
    </aside>
  );
}
