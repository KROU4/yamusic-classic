// «Устройства» in the player bar: the account's other devices (Ynison), what plays there, remote controls
// and «Слушать здесь». Rendered only when the user turned the sync on in Settings.
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { seconds } from "../lib/format.js";
import { ynison } from "../player/ynison.js";
import { sharedProgressNow, deviceIcon } from "../player/ynisonLogic.js";

const control = (action, extra = {}) => api.post("/ynison/control", { action, ...extra }).catch((e) => toast(e.message));

function deviceNote(d, v) {
  if (d.active) return d.me ? "Играет здесь" : v.paused ? "На паузе" : "Сейчас играет";
  if (d.me) return "Это устройство";
  return d.offline ? "Не в сети" : "В сети";
}

/** What another device plays, with controls; the bar seeks there. */
function RemoteCard({ v }) {
  const bar = useRef(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (v.paused) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [v.paused, v.rev]);
  const t = v.track;
  const pos = sharedProgressNow(v);
  const dur = v.durationMs || 0;
  const onSeek = (e) => {
    if (!dur) return;
    const r = bar.current.getBoundingClientRect();
    control("seek", { positionMs: Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur) });
  };
  return (
    <div class="ynison-remote">
      <div class="ynison-where">
        <Icon name={deviceIcon(v.activeDevice.type)} size={16} />
        <span>Играет на «{v.activeDevice.title}»</span>
      </div>
      {t ? (
        <div class="menu-head ynison-track">
          {t.cover ? <img src={t.cover} alt="" /> : <div class="ph" />}
          <div>
            <div class="menu-title">{t.title || "Без названия"}</div>
            <div class="menu-artist">{t.artists.map((a) => a.name).join(", ") || (t.playable ? "" : "Нельзя включить здесь")}</div>
          </div>
        </div>
      ) : (
        <div class="menu-note">Очередь пуста</div>
      )}
      {dur > 0 && (
        <div class="ynison-progress">
          <span>{seconds(pos / 1000)}</span>
          <div class="ynison-bar" ref={bar} onClick={onSeek} role="slider" aria-label="Позиция на другом устройстве" aria-valuemin={0} aria-valuemax={Math.round(dur / 1000)} aria-valuenow={Math.round(pos / 1000)}>
            <div style={{ width: `${Math.min(100, (pos / dur) * 100)}%` }} />
          </div>
          <span>{seconds(dur / 1000)}</span>
        </div>
      )}
      <div class="ynison-controls">
        <button class="icon-btn" onClick={() => control("prev")} aria-label="Предыдущий на другом устройстве" title="Предыдущий">
          <Icon name="prev" />
        </button>
        <button class="icon-btn ynison-play" onClick={() => control("toggle")} aria-label={v.paused ? "Играть на другом устройстве" : "Пауза на другом устройстве"} title={v.paused ? "Играть" : "Пауза"}>
          <Icon name={v.paused ? "play" : "pause"} />
        </button>
        <button class="icon-btn" onClick={() => control("next")} aria-label="Следующий на другом устройстве" title="Следующий">
          <Icon name="next" />
        </button>
        <button
          class="btn primary sm ynison-take"
          disabled={!t?.playable}
          onClick={() =>
            api
              .post("/ynison/take")
              .then(() => toast("Переключаю воспроизведение сюда"))
              .catch((e) => toast(e.message))
          }
        >
          Слушать здесь
        </button>
      </div>
    </div>
  );
}

export function DevicesButton() {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const v = ynison.value;
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !box.current?.contains(e.target) && setOpen(false);
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  if (!v.enabled) return null;
  const remote = v.status === "online" && v.activeDevice && !v.activeIsMe;
  const others = (v.devices || []).filter((d) => !d.me);
  const label = remote ? `Играет на «${v.activeDevice.title}»` : v.activeIsMe ? "Устройства: играет здесь" : "Устройства";
  return (
    <div class="popover-wrap" ref={box}>
      <button class={`icon-btn ${remote ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label={label} title={label} aria-expanded={open}>
        <Icon name="devices" />
        {remote && <span class="icon-dot" />}
      </button>
      {open && (
        <div class="popover ynison-pop" role="dialog" aria-label="Устройства">
          <div class="popover-title">Устройства</div>
          {v.status !== "online" ? (
            <div class="menu-note">
              {v.status === "connecting" ? "Подключаюсь к Ynison…" : v.error || "Нет соединения"}
              {(v.status === "stopped" || v.status === "waiting") && (
                <button class="btn ghost sm ynison-retry" onClick={() => api.post("/ynison/reconnect").catch((e) => toast(e.message))}>
                  Подключиться
                </button>
              )}
            </div>
          ) : (
            <>
              {remote && <RemoteCard v={v} />}
              {v.activeIsMe && <div class="menu-note">Играет здесь. Телефон может ставить паузу и переключать треки.</div>}
              {others.length ? (
                others.map((d) => (
                  <div key={d.id} class={`ynison-device ${d.active ? "on" : ""} ${d.offline ? "off" : ""}`}>
                    <Icon name={deviceIcon(d.type)} />
                    <div class="ynison-device-text">
                      <span class="menu-label">{d.title}</span>
                      <span class="ynison-device-note">{deviceNote(d, v)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div class="menu-note">Других устройств нет. Откройте Яндекс Музыку на телефоне — он появится здесь.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
