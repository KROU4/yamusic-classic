// 10-band equalizer with presets: a panel (for settings) and a button with a dropdown panel (for the player).
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import * as g from "../player/audiograph.js";

function Band({ i }) {
  const db = g.eq.value.gains[i];
  return (
    <label class="eq-band" title={`${g.BAND_LABELS[i]} Гц: ${db > 0 ? "+" : ""}${db} дБ`}>
      <span class="eq-db">{db > 0 ? `+${db}` : db}</span>
      <input
        type="range"
        min={-g.MAX_DB}
        max={g.MAX_DB}
        step={0.5}
        value={db}
        orient="vertical"
        onInput={(e) => g.setBand(i, +e.currentTarget.value)}
        onDblClick={() => g.setBand(i, 0)}
        aria-label={`Полоса ${g.BAND_LABELS[i]} Гц`}
      />
      <span class="eq-hz">{g.BAND_LABELS[i]}</span>
    </label>
  );
}

export function EqPanel() {
  if (!g.webAudioSupported) return <p class="setting-hint">Эквалайзер работает в приложении для Windows: в браузере звук нельзя пропустить через обработку.</p>;
  const { enabled, preset } = g.eq.value;
  return (
    <div class={`eq-panel ${enabled ? "" : "is-off"}`}>
      <div class="eq-top">
        <label class="switch-row">
          <input type="checkbox" class="switch" checked={enabled} onChange={(e) => g.setEq({ enabled: e.currentTarget.checked })} />
          <span>Эквалайзер</span>
        </label>
        <select class="select" value={preset in g.EQ_PRESETS ? preset : "custom"} onChange={(e) => g.usePreset(e.currentTarget.value)} aria-label="Пресет эквалайзера">
          {Object.entries(g.EQ_PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.name}
            </option>
          ))}
          {!(preset in g.EQ_PRESETS) && <option value="custom">Свой</option>}
        </select>
      </div>
      <div class="eq-bands">
        {g.BANDS.map((_, i) => (
          <Band key={i} i={i} />
        ))}
      </div>
      <p class="eq-note">Двойной клик по ползунку — вернуть к нулю. Подъёмы компенсируются общим уровнем, чтобы не было искажений.</p>
    </div>
  );
}

export function EqButton() {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !box.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!g.webAudioSupported) return null;
  const on = g.eq.value.enabled;
  return (
    <div class="popover-wrap" ref={box}>
      <button class={`icon-btn ${on ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label="Эквалайзер" title="Эквалайзер" aria-expanded={open}>
        <Icon name="eq" />
      </button>
      {open && (
        <div class="popover eq-popover" role="dialog" aria-label="Эквалайзер">
          <EqPanel />
        </div>
      )}
    </div>
  );
}
