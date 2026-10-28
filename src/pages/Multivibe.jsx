// «Моя волна на двоих» (Multivibe): invite someone by link, accept an invite, play the shared wave.
// Creating and accepting are account writes on Yandex's side, so they happen only on an explicit click;
// opening a link (#/multivibe/<code>) only looks the invite up.
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { Loading } from "../components/States.jsx";
import { api } from "../lib/api.js";
import { useLoad } from "../lib/useLoad.js";
import { toast } from "../lib/toast.js";
import * as p from "../player/engine.js";

const POLL_MS = 8000;

function statusText(room) {
  if (room.status === "DISABLED") return "Это приглашение больше не действует";
  if (room.status === "DRAFT") return room.isOwner ? "Приглашение пока не принято" : "Ожидает подтверждения";
  return room.playable ? "Общая волна готова" : "Яндекс собирает общую волну";
}

function partnerName(room) {
  return room.partner?.name || (room.isOwner ? "Пока никого" : room.owner?.name || "Без имени");
}

export function playRoom(room) {
  if (!room?.playable) return;
  const [stationId, ...extraSeeds] = room.wave.seeds;
  const who = room.partner?.name;
  p.playWave({ stationId, extraSeeds, title: who ? `Моя волна на двоих · ${who}` : "Моя волна на двоих" });
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Ссылка скопирована");
  } catch {
    toast("Не удалось скопировать — выделите ссылку и нажмите Ctrl+C");
  }
}

function Avatar({ person, size = 44 }) {
  const [failed, setFailed] = useState(false);
  const initial = (person?.name || "?").slice(0, 1).toUpperCase();
  return (
    <span class="mv-avatar" style={{ width: `${size}px`, height: `${size}px` }}>
      {person?.cover && !failed ? <img src={person.cover} alt="" referrerpolicy="no-referrer" onError={() => setFailed(true)} /> : initial}
    </span>
  );
}

function RoomRow({ room, onChanged }) {
  const [confirmExit, setConfirmExit] = useState(false);
  const [busy, setBusy] = useState(false);
  const leave = async () => {
    if (!confirmExit) return setConfirmExit(true);
    setBusy(true);
    try {
      await api.post("/rooms/exit", { ref: room.id });
      toast(room.isOwner && room.status === "DRAFT" ? "Приглашение отозвано" : "Вы вышли из волны на двоих");
      onChanged();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
      setConfirmExit(false);
    }
  };
  return (
    <li class="mv-room">
      <Avatar person={room.partner} />
      <div class="mv-room-text">
        <div class="mv-room-title">{room.name || partnerName(room)}</div>
        <div class="mv-room-sub">{statusText(room)}</div>
      </div>
      <div class="mv-room-actions">
        {room.playable && (
          <button class="btn primary sm" onClick={() => playRoom(room)}>
            <Icon name="play" size={16} /> Слушать
          </button>
        )}
        {room.isOwner && room.status === "DRAFT" && (
          <button class="btn ghost sm" onClick={() => copy(room.link)}>
            <Icon name="link" size={16} /> Ссылка
          </button>
        )}
        <button class={`btn ghost sm ${confirmExit ? "is-danger" : ""}`} onClick={leave} onBlur={() => setConfirmExit(false)} disabled={busy}>
          {confirmExit ? "Точно выйти?" : room.isOwner && room.status === "DRAFT" ? "Отозвать" : "Выйти"}
        </button>
      </div>
    </li>
  );
}

function InviteCard({ onChanged }) {
  const [room, setRoom] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.post("/rooms/create");
      setRoom(r.room);
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  // the owner learns that the invite was accepted only by asking again: poll while the draft is on screen
  useEffect(() => {
    if (!room || room.status !== "DRAFT") return;
    const id = setInterval(() => {
      if (document.hidden) return;
      api
        .post("/rooms/get", { ref: room.id })
        .then((r) => {
          if (r.room.status === room.status && r.room.playable === room.playable) return;
          setRoom(r.room);
          onChanged();
          if (r.room.status === "ENABLED") toast("Приглашение приняли — можно слушать вместе");
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [room?.id, room?.status]);
  return (
    <div class="mv-card">
      <h2>Пригласить</h2>
      {!room ? (
        <>
          <p class="mv-text">Создайте ссылку-приглашение и отправьте её одному человеку любым способом. Когда он её примет, у вас появится общая волна.</p>
          <button class="btn primary" onClick={create} disabled={busy}>
            {busy ? <span class="spinner sm" /> : <Icon name="plus" size={18} />} Создать приглашение
          </button>
        </>
      ) : (
        <>
          <p class="mv-text">{statusText(room)}</p>
          <div class="mv-link">
            <input class="text-input mv-input" value={room.link} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Ссылка-приглашение" />
            <button class="btn ghost sm" onClick={() => copy(room.link)}>
              <Icon name="link" size={16} /> Копировать
            </button>
          </div>
          {room.playable && (
            <button class="btn primary" onClick={() => playRoom(room)}>
              <Icon name="play" size={18} /> Слушать вместе
            </button>
          )}
        </>
      )}
      {error && (
        <p class="mv-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function JoinCard({ initial, onChanged }) {
  const [text, setText] = useState(initial || "");
  const [room, setRoom] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const check = async (value = text) => {
    if (!value.trim()) return setError("Вставьте ссылку-приглашение или код");
    setBusy(true);
    setError("");
    setNote("");
    setRoom(null);
    try {
      setRoom((await api.post("/rooms/get", { ref: value })).room);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.post("/rooms/enter", { ref: room.id });
      setRoom(r.room);
      onChanged();
      if (r.room.playable) playRoom(r.room);
      else setNote("Приглашение принято. Общая волна появится, когда Яндекс её соберёт");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  // a link opened in the app only looks the invite up; accepting stays a click
  const first = useRef(true);
  useEffect(() => {
    if (first.current && initial) check(initial);
    first.current = false;
  }, []);
  return (
    <div class="mv-card">
      <h2>Присоединиться</h2>
      <p class="mv-text">Получили приглашение? Вставьте ссылку вида music.yandex.ru/multivibe/… или код.</p>
      <form
        class="mv-link"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
      >
        <input
          class="text-input mv-input"
          value={text}
          placeholder="Ссылка или код приглашения"
          autocomplete="off"
          spellcheck={false}
          onInput={(e) => {
            setText(e.currentTarget.value);
            if (error) setError("");
          }}
        />
        <button class="btn ghost sm" type="submit" disabled={busy}>
          {busy && !room ? <span class="spinner sm" /> : null} Проверить
        </button>
      </form>
      {room && (
        <div class="mv-found">
          <Avatar person={room.owner} size={48} />
          <div class="mv-room-text">
            <div class="mv-room-title">{room.isOwner ? "Это ваше приглашение" : `Приглашение от ${room.owner?.name || "пользователя"}`}</div>
            <div class="mv-room-sub">{room.isOwner && room.status === "DRAFT" ? "Отправьте ссылку другому человеку" : statusText(room)}</div>
          </div>
          {room.playable && room.isMember ? (
            <button class="btn primary sm" onClick={() => playRoom(room)}>
              <Icon name="play" size={16} /> Слушать
            </button>
          ) : !room.isMember && room.status !== "DISABLED" ? (
            <button class="btn primary sm" onClick={accept} disabled={busy}>
              {busy ? <span class="spinner sm" /> : null} Принять приглашение
            </button>
          ) : null}
        </div>
      )}
      {note && <p class="mv-text">{note}</p>}
      {error && (
        <p class="mv-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function MultivibePage({ room: roomParam }) {
  const { data, loading, error, reload } = useLoad("/rooms", 30000);
  const rooms = data?.rooms || [];
  return (
    <div class="page mv-page">
      <h1 class="page-title">Моя волна на двоих</h1>
      <p class="page-desc">Слушайте Мою волну с объединёнными рекомендациями. Ваши персональные рекомендации не изменятся.</p>
      <p class="mv-beta">
        Яндекс пока включает эту функцию не всем. Если для вашего аккаунта она ещё не работает, создать или принять приглашение не получится — здесь будет ответ Яндекса.
      </p>
      <div class="mv-grid">
        <InviteCard onChanged={reload} />
        <JoinCard initial={roomParam} onChanged={reload} key={roomParam || ""} />
      </div>
      <section class="section">
        <div class="section-head">
          <h2>Ваши волны на двоих</h2>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error && !data ? (
          <p class="mv-error">Не удалось загрузить: {error.message}</p>
        ) : rooms.length ? (
          <ul class="mv-rooms">
            {rooms.map((r) => (
              <RoomRow key={r.id} room={r} onChanged={reload} />
            ))}
          </ul>
        ) : (
          <p class="mv-text">Пока ни одной. Создайте приглашение или примите чужое.</p>
        )}
      </section>
    </div>
  );
}
