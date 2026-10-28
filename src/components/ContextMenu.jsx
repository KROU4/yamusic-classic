// Контекстное меню трека: правый клик по строке или кнопка «…».
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Icon } from "./Icon.jsx";
import { api, dropCache } from "../lib/api.js";
import { go } from "../lib/router.js";
import { toast } from "../lib/toast.js";
import { nowPlayingOpen } from "../lib/ui.js";
import * as player from "../player/engine.js";

/** { x, y, track, playlist?: { kind, index, onRemoved } } */
export const menu = signal(null);

export function openTrackMenu(e, track, extra = {}) {
  e.preventDefault();
  e.stopPropagation();
  const r = e.currentTarget?.getBoundingClientRect?.();
  // из кнопки «…» меню открывается под ней, из правого клика — у курсора
  const x = e.type === "contextmenu" || !r ? e.clientX : r.right;
  const y = e.type === "contextmenu" || !r ? e.clientY : r.bottom;
  menu.value = { x, y, track, ...extra, seq: ++menuSeq };
}
let menuSeq = 0;

const close = () => (menu.value = null);

// переход из меню сворачивает «Сейчас играет»: адрес может и не измениться (тот же альбом), hashchange тогда не придёт
const goTo = (path) => {
  nowPlayingOpen.value = false;
  go(path);
};

function PlaylistPicker({ track, onDone }) {
  const [lists, setLists] = useState(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const input = useRef(null);
  // autoFocus срабатывает не всегда, а без фокуса нажатия уходят в глобальные горячие клавиши
  useEffect(() => {
    if (creating) input.current?.focus();
  }, [creating]);
  useEffect(() => {
    api
      .get("/my/playlists")
      .then((r) => setLists(r.playlists))
      .catch((e) => {
        toast(e.message);
        setLists([]);
      });
  }, []);
  const add = async (pl) => {
    onDone();
    try {
      await api.post(`/my/playlists/${pl.kind}/add`, { tracks: [track] });
      dropCache(`/playlist/`);
      toast(`Добавлено в «${pl.title}»`);
    } catch (e) {
      toast(`Не удалось добавить: ${e.message}`);
    }
  };
  const create = async (e) => {
    e.preventDefault();
    onDone();
    try {
      const r = await api.post("/my/playlists", { title: name || "Новый плейлист", tracks: [track] });
      dropCache("/collection");
      // плейлист мог создаться, а трек в него — не добавиться (сервер сообщает addError)
      if (r.addError) toast(`Плейлист «${r.playlist.title}» создан, но трек не добавился: ${r.addError}`);
      else toast(`Создан плейлист «${r.playlist.title}»`);
    } catch (err) {
      toast(`Не удалось создать: ${err.message}`);
    }
  };
  return (
    <div class="menu-sub">
      {creating ? (
        <form onSubmit={create} class="menu-create">
          <input ref={input} autoFocus value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Название плейлиста" maxLength={100} aria-label="Название нового плейлиста" />
          <button class="btn primary sm" type="submit">
            Создать
          </button>
        </form>
      ) : (
        <button class="menu-item" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> Новый плейлист
        </button>
      )}
      <div class="menu-sep" />
      {lists === null && <div class="menu-note">Загружаю…</div>}
      {lists?.length === 0 && <div class="menu-note">Своих плейлистов пока нет</div>}
      {lists?.map((pl) => (
        <button key={pl.kind} class="menu-item" onClick={() => add(pl)}>
          <Icon name="queue" size={16} /> <span class="menu-label">{pl.title}</span>
        </button>
      ))}
    </div>
  );
}

/** Каждое открытие — новый экземпляр (key), поэтому позиция и подменю сбрасываются сами. */
export function ContextMenu() {
  const m = menu.value;
  return m ? <MenuBody key={m.seq} m={m} /> : null;
}

function MenuBody({ m }) {
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  const [sub, setSub] = useState(false);

  // меню не должно вылезать за край окна: позиция считается от точки открытия по текущему размеру меню
  const place = () => {
    if (!box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = Math.min(m.x, window.innerWidth - r.width - 8);
    const y = m.y + r.height > window.innerHeight - 8 ? Math.max(8, m.y - r.height) : m.y;
    const next = { x: Math.max(8, x), y: Math.max(8, y) };
    setPos((p) => (p && p.x === next.x && p.y === next.y ? p : next));
  };
  // первый расчёт до отрисовки, чтобы меню не мигнуло не на своём месте
  useLayoutEffect(place, []);
  // и при любом изменении размера: раскрыли подменю, догрузился список плейлистов, открылась форма
  useEffect(() => {
    if (!box.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && close();
    const onDown = (e) => !box.current?.contains(e.target) && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", close);
    document.querySelector(".main")?.addEventListener("scroll", close, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", close);
      document.querySelector(".main")?.removeEventListener("scroll", close);
    };
  }, []);

  const t = m.track;
  const liked = player.isLiked(t);
  const act = (fn) => () => {
    close();
    fn();
  };
  const link = t.albumId ? `https://music.yandex.ru/album/${t.albumId}/track/${t.id}` : `https://music.yandex.ru/track/${t.id}`;

  return (
    <div class="menu" ref={box} role="menu" style={{ left: `${(pos || m).x}px`, top: `${(pos || m).y}px`, visibility: pos ? "visible" : "hidden" }}>
      <div class="menu-head">
        {t.cover ? <img src={t.cover} alt="" /> : <div class="ph" />}
        <div>
          <div class="menu-title">{t.title}</div>
          <div class="menu-artist">{t.artists.map((a) => a.name).join(", ")}</div>
        </div>
      </div>
      <button class="menu-item" role="menuitem" onClick={act(() => player.enqueueNext([t]))}>
        <Icon name="addQueue" size={16} /> Играть следующим
      </button>
      <button class="menu-item" role="menuitem" onClick={act(() => player.enqueueEnd([t]))}>
        <Icon name="queue" size={16} /> В конец очереди
      </button>
      <button class="menu-item" role="menuitem" onClick={act(() => player.playWave({ stationId: `track:${t.id}`, title: `Волна по треку «${t.title}»` }))}>
        <Icon name="wave" size={16} /> Моя волна по треку
      </button>
      <div class="menu-sep" />
      <button class={`menu-item ${sub ? "on" : ""}`} role="menuitem" aria-expanded={sub} onClick={() => setSub(!sub)}>
        <Icon name="plus" size={16} /> Добавить в плейлист <span class="menu-arrow">{sub ? "▾" : "▸"}</span>
      </button>
      {sub && <PlaylistPicker track={t} onDone={close} />}
      {m.playlist && (
        <button
          class="menu-item danger"
          role="menuitem"
          onClick={act(async () => {
            try {
              await api.post(`/my/playlists/${m.playlist.kind}/remove`, { track: t, index: m.playlist.index });
              toast("Удалено из плейлиста");
              m.playlist.onRemoved?.();
            } catch (e) {
              toast(`Не удалось: ${e.message}`);
            }
          })}
        >
          <Icon name="close" size={16} /> Удалить из плейлиста
        </button>
      )}
      <div class="menu-sep" />
      <button class="menu-item" role="menuitem" onClick={act(() => player.like(t))}>
        <Icon name={liked ? "heart" : "heartOutline"} size={16} /> {liked ? "Убрать из «Мне нравится»" : "Мне нравится"}
      </button>
      <button class="menu-item" role="menuitem" onClick={act(() => player.dislike(t))}>
        <Icon name="ban" size={16} /> {player.isDisliked(t) ? "Снова предлагать" : "Не нравится"}
      </button>
      <div class="menu-sep" />
      {t.albumId && (
        <button class="menu-item" role="menuitem" onClick={act(() => goTo(`/album/${t.albumId}`))}>
          <Icon name="album" size={16} /> Перейти к альбому
        </button>
      )}
      {t.artists.slice(0, 3).map((a) => (
        <button key={a.id} class="menu-item" role="menuitem" onClick={act(() => goTo(`/artist/${a.id}`))}>
          <Icon name="artist" size={16} /> <span class="menu-label">{a.name}</span>
        </button>
      ))}
      <button
        class="menu-item"
        role="menuitem"
        onClick={act(async () => {
          try {
            await navigator.clipboard.writeText(link);
            toast("Ссылка скопирована");
          } catch {
            toast(link);
          }
        })}
      >
        <Icon name="link" size={16} /> Скопировать ссылку
      </button>
    </div>
  );
}
