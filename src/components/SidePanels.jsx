// Right-hand panels: synced lyrics and the playback queue.
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { panel } from "./PlayerBar.jsx";
import { api } from "../lib/api.js";
import { artistNames, duration } from "../lib/format.js";
import * as p from "../player/engine.js";
import { openTrackMenu } from "./ContextMenu.jsx";
import { KaraokeLine, LyricsTools, useLyricsTranslation } from "./LyricsExtras.jsx";

const SOURCE_NAMES = { yandex: "Яндекс Музыка", lrclib: "LRCLIB" };

export function Lyrics() {
  const t = p.current.value;
  const [state, setState] = useState({ status: "idle" });
  const box = useRef(null);
  const userScrolled = useRef(0);

  useEffect(() => {
    if (!t) return;
    let alive = true;
    setState({ status: "loading" });
    api
      .post("/lyrics", { track: t })
      .then((data) => alive && setState({ status: data.lines.length || data.plain ? "ok" : "empty", data }))
      .catch((e) => alive && setState({ status: "error", error: e.message }));
    return () => {
      alive = false;
    };
  }, [t?.id]);

  const data = state.data;
  const tr = useLyricsTranslation(t?.id, state.status === "ok" ? data : null);
  const pos = p.position.value;
  let active = -1;
  if (data?.synced) {
    for (let i = 0; i < data.lines.length; i++) {
      if (data.lines[i].t <= pos + 0.25) active = i;
      else break;
    }
  }

  useEffect(() => {
    if (active < 0 || !box.current || Date.now() - userScrolled.current < 4000) return;
    const el = box.current.querySelector(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  if (!t) return <div class="panel-empty">Ничего не играет</div>;
  const trOn = tr.on && tr.status === "ok";
  return (
    <>
      <LyricsTools tr={tr} />
      <div class="lyrics" ref={box} onWheel={() => (userScrolled.current = Date.now())}>
        <div class="lyrics-head">
          <div class="lyrics-title">{t.title}</div>
          <div class="lyrics-artist">{artistNames(t)}</div>
        </div>
        {state.status === "loading" && <div class="panel-empty"><span class="spinner" /></div>}
        {state.status === "empty" && <div class="panel-empty">Текста для этой песни пока нет ни у Яндекса, ни в LRCLIB</div>}
        {state.status === "error" && <div class="panel-empty">Не удалось загрузить текст: {state.error}</div>}
        {state.status === "ok" &&
          (data.synced ? (
            <div class="lyrics-lines">
              {data.lines.map((l, i) => {
                const line = tr.of(l.text);
                return (
                  <button key={i} data-i={i} class={`lyric ${l.text ? "" : "gap"} ${i === active ? "on" : i < active ? "past" : ""}`} onClick={() => p.seek(l.t)}>
                    {i === active && l.words ? <KaraokeLine words={l.words} /> : l.text || "♪"}
                    {line && <span class="lyric-tr">{line}</span>}
                  </button>
                );
              })}
            </div>
          ) : trOn ? (
            <div class="lyrics-plain">
              {data.plain.split("\n").map((s, i) => (
                <div key={i}>
                  {s || " "}
                  {tr.of(s) && <span class="lyric-tr">{tr.of(s)}</span>}
                </div>
              ))}
            </div>
          ) : (
            <pre class="lyrics-plain">{data.plain}</pre>
          ))}
        {state.status === "ok" && (
          <div class="lyrics-source">
            Источник: {SOURCE_NAMES[data.source] || data.source}
            {data.replacedCensored && " — текст Яндекса был с цензурой, показан полный"}
            {data.censored && " — в тексте есть цензура"}
            {data.wordSync && ` · пословная синхронизация${data.wordSource ? ` из ${SOURCE_NAMES[data.wordSource] || data.wordSource}` : ""}`}
            {trOn && " · перевод машинный (Google Переводчик)"}
          </div>
        )}
      </div>
    </>
  );
}

function Queue() {
  const list = p.queue.value;
  const idx = p.index.value;
  const ctx = p.context.value;
  const box = useRef(null);
  const [drag, setDrag] = useState(null); // { from, over }
  useEffect(() => {
    box.current?.querySelector(".q-item.on")?.scrollIntoView({ block: "center" });
  }, []);
  if (!list.length) return <div class="panel-empty">Очередь пуста</div>;
  return (
    <div class="queue" ref={box}>
      <div class="queue-head">
        {ctx?.type === "wave" ? "Волна подбирает треки на ходу" : ctx?.title || "Очередь"}
        <span class="queue-count">{list.length}</span>
      </div>
      {list.map((t, i) => (
        <div
          key={`${t.id}-${i}`}
          class={`q-item ${i === idx ? "on" : ""} ${i < idx ? "past" : ""} ${drag?.over === i && drag.from !== i ? (drag.from < i ? "drop-after" : "drop-before") : ""}`}
          onDblClick={() => p.playAt(i)}
          onContextMenu={(e) => openTrackMenu(e, t)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            setDrag({ from: i, over: i });
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (drag && drag.over !== i) setDrag({ ...drag, over: i });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (drag) p.moveInQueue(drag.from, i);
            setDrag(null);
          }}
          onDragEnd={() => setDrag(null)}
          title="Перетащите, чтобы изменить порядок"
        >
          {t.cover ? <img src={t.cover} alt="" loading="lazy" draggable={false} /> : <div class="ph" />}
          <button class="q-main" onClick={() => p.playAt(i)}>
            <span class="q-title">{t.title}</span>
            <span class="q-artist">{artistNames(t)}</span>
          </button>
          <span class="q-dur">{duration(t.durationMs)}</span>
          {i !== idx && (
            <button class="icon-btn hover-only" onClick={() => p.removeFromQueue(i)} aria-label="Убрать из очереди">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function SidePanel() {
  if (!panel.value) return null;
  return (
    <aside class="side-panel" aria-label={panel.value === "lyrics" ? "Текст песни" : "Очередь"}>
      <div class="side-tabs">
        <button class={panel.value === "lyrics" ? "on" : ""} onClick={() => (panel.value = "lyrics")}>
          Текст
        </button>
        <button class={panel.value === "queue" ? "on" : ""} onClick={() => (panel.value = "queue")}>
          Очередь
        </button>
        <button class="icon-btn side-close" onClick={() => (panel.value = null)} aria-label="Закрыть">
          <Icon name="close" size={18} />
        </button>
      </div>
      {panel.value === "lyrics" ? <Lyrics /> : <Queue />}
    </aside>
  );
}
