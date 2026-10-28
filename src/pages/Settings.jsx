// Settings: a header with the app and its version, a section index and one card per area. Areas the
// official client doesn't have are marked «Только в YM Classic».
import { useEffect, useRef, useState } from "preact/hooks";
import { api, dropCache } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { theme, setTheme } from "../lib/theme.js";
import { isDesktop, zoom, setZoom, ZOOM_STEPS } from "../lib/desktop.js";
import { vibeMode, vibeFps, vibeReact, accent, ACCENTS, playerTint, seekStep, volumeStep, timeLeft, trackNotify, calmUi, shortcutsOpen } from "../lib/ui.js";
import { Loading } from "../components/States.jsx";
import { Icon } from "../components/Icon.jsx";
import { Logo } from "../components/Logo.jsx";
import { EqPanel } from "../components/Equalizer.jsx";
import { VibeCanvas, paletteFor, officialAssets } from "../components/VibeCanvas.jsx";
import { canUpdate, update, updateLabel, updateReady, checkUpdate, installUpdate } from "../lib/updates.js";
import * as player from "../player/engine.js";
import "../styles/settings.css";

const VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
const REPO = "https://github.com/KROU4/yamusic-classic";

/** The update state for the header, next to the version (which is already shown): only what is news. */
function heroStatus(st) {
  switch (st?.status) {
    case "latest":
      return "последняя версия";
    case "checking":
    case "downloading":
    case "ready":
    case "available":
    case "error":
      return updateLabel(st);
    default:
      return "";
  }
}

/** A row: text on the left, the control on the right (or below it in narrow windows). */
function Row({ label, hint, children, wide = false }) {
  return (
    <div class={`st-row ${wide ? "is-wide" : ""}`}>
      <div class="st-text">
        <span class="st-label">{label}</span>
        {hint && <span class="st-hint">{hint}</span>}
      </div>
      {children && <div class="st-control">{children}</div>}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange, disabled = false }) {
  return (
    <label class={`st-row is-toggle ${disabled ? "is-disabled" : ""}`}>
      <span class="st-text">
        <span class="st-label">{label}</span>
        {hint && <span class="st-hint">{hint}</span>}
      </span>
      <input type="checkbox" class="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

/** Mutually exclusive options as one pill; each option is a toggle button that says whether it's on. */
function Segmented({ label, value, options, onChange, disabled = false }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" class="seg-btn" aria-pressed={value === v} disabled={disabled} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Choice({ label, hint, value, options, onChange, disabled }) {
  return (
    <Row label={label} hint={hint} wide={options.length > 4}>
      <Segmented label={label} value={value} options={options} onChange={onChange} disabled={disabled} />
    </Row>
  );
}

function Section({ id, icon, title, intro, only = false, children }) {
  return (
    <section class="st-card" id={`st-${id}`} aria-labelledby={`st-${id}-h`} data-section={id}>
      <header class="st-card-head">
        <span class="st-card-icon">
          <Icon name={icon} size={20} />
        </span>
        <div class="st-card-title">
          <h2 id={`st-${id}-h`} tabIndex={-1}>
            {title}
            {only && (
              <span class="st-only" title="Этого нет в официальном приложении">
                Только в YM Classic
              </span>
            )}
          </h2>
          {intro && <p>{intro}</p>}
        </div>
      </header>
      <div class="st-rows">{children}</div>
    </section>
  );
}

/** The screen's refresh rate, measured once from animation frames (for «Как у экрана · 144 Гц»). */
let measuredHz = 0;
function useRefreshRate() {
  const [hz, setHz] = useState(measuredHz);
  useEffect(() => {
    if (measuredHz) return;
    let raf = 0;
    let last = 0;
    const gaps = [];
    const step = (now) => {
      if (last) gaps.push(now - last);
      last = now;
      if (gaps.length < 40) raf = requestAnimationFrame(step);
      else {
        gaps.sort((a, b) => a - b);
        const raw = 1000 / gaps[gaps.length >> 1];
        // snap to the usual panel rates so a 59.94 Hz screen reads as 60
        measuredHz = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 170, 180, 200, 240, 360].reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
        setHz(measuredHz);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return hz;
}

/** The section index: a column at the side in wide windows, a scrolling row on top in narrow ones. */
function SectionNav({ items }) {
  const [active, setActive] = useState(items[0]?.[0]);
  const navRef = useRef(null);
  // a jump from the index keeps its item lit while the page scrolls there (the last sections can't reach the top)
  const chosen = useRef({ id: null, until: 0 });
  // as a scrolling row (narrow windows) the current section stays in view; only the row scrolls, never the page
  useEffect(() => {
    const nav = navRef.current;
    const btn = nav?.querySelector(".st-nav-item.on");
    if (!nav || !btn || nav.scrollWidth <= nav.clientWidth) return;
    const left = btn.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft || left + btn.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: left - (nav.clientWidth - btn.offsetWidth) / 2 });
  }, [active]);
  useEffect(() => {
    const scroller = document.getElementById("main");
    const nav = navRef.current;
    if (!scroller || !nav) return;
    let raf = 0;
    // the current section is the last one whose top has passed a line just under the index
    // (under the top bar for the side column); at the very bottom the last section wins
    const pick = () => {
      raf = 0;
      if (chosen.current.until > performance.now()) return setActive(chosen.current.id);
      const els = items.map(([id]) => document.getElementById(`st-${id}`)).filter(Boolean);
      if (!els.length) return;
      const r = nav.getBoundingClientRect();
      const row = r.width > r.height; // the scrolling row of narrow windows
      const line = (row ? r.bottom : scroller.getBoundingClientRect().top + 64) + 40;
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      let cur = els[0];
      for (const el of els) if (el.getBoundingClientRect().top <= line) cur = el;
      setActive((atEnd ? els[els.length - 1] : cur).dataset.section);
    };
    const onScroll = () => (raf ||= requestAnimationFrame(pick));
    scroller.addEventListener("scroll", onScroll, { passive: true });
    pick();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [items.map(([id]) => id).join()]);
  const go = (id) => {
    const el = document.getElementById(`st-${id}`);
    if (!el) return;
    const calm = calmUi.peek() || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chosen.current = { id, until: performance.now() + 1200 };
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    setActive(id);
    // keyboard users land on the section, not back at the index
    el.querySelector("h2")?.focus({ preventScroll: true });
  };
  return (
    <nav class="st-nav" ref={navRef} aria-label="Разделы настроек">
      {items.map(([id, icon, title]) => (
        <button key={id} type="button" class={`st-nav-item ${active === id ? "on" : ""}`} aria-current={active === id ? "true" : undefined} onClick={() => go(id)}>
          <Icon name={icon} size={18} />
          <span>{title}</span>
        </button>
      ))}
    </nav>
  );
}

/** Animation modes as cards with a tiny still of each look. */
function WaveModes({ assets }) {
  const modes = [
    ["official", "Как в Яндекс Музыке", assets ? "Шар из официального приложения" : "Нужна установленная Яндекс Музыка"],
    ["shader", "Своя", "Рисуется шейдером"],
    ["lite", "Облегчённая", "Почти не нагружает видеокарту"],
    ["off", "Без анимации", "Статичная картинка"],
  ];
  // read through the signal so the still follows a theme switch made on this page
  const light = theme.value === "light" || (theme.value === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  return (
    <div class="wave-modes" role="group" aria-label="Анимация «Моей волны»">
      {modes.map(([v, title, note]) => (
        <button key={v} type="button" class={`wave-mode is-${v}`} aria-pressed={vibeMode.value === v} onClick={() => (vibeMode.value = v)}>
          <span class="wave-mode-still" aria-hidden="true">
            {v === "official" && assets ? <img src={light ? assets.lightPoster : assets.darkPoster} alt="" /> : <i />}
          </span>
          <span class="wave-mode-title">{title}</span>
          <span class="wave-mode-note">{note}</span>
          <span class="wave-mode-check" aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
        </button>
      ))}
    </div>
  );
}

function ThemeTiles() {
  const tiles = [
    ["dark", "Тёмная"],
    ["light", "Светлая"],
    ["system", "Как в системе"],
  ];
  return (
    <div class="theme-tiles" role="group" aria-label="Тема">
      {tiles.map(([v, l]) => (
        <button key={v} type="button" class={`theme-tile is-${v}`} aria-pressed={theme.value === v} onClick={() => setTheme(v)}>
          <span class="theme-tile-mock" aria-hidden="true">
            <i class="m-side" />
            <i class="m-main" />
            <i class="m-bar" />
          </span>
          <span>{l}</span>
        </button>
      ))}
    </div>
  );
}

function AccentPicker() {
  return (
    <div class="accent-picker" role="group" aria-label="Акцентный цвет">
      {ACCENTS.map(([k, name, color]) => (
        <button key={k} type="button" class="accent-dot" style={{ "--dot": color }} aria-pressed={accent.value === k} aria-label={name} title={name} onClick={() => (accent.value = k)}>
          <Icon name="check" size={16} />
        </button>
      ))}
    </div>
  );
}

export function SettingsPage({ me, onReconnect }) {
  const [prefs, setPrefs] = useState(null);
  const [assets, setAssets] = useState(null);
  const hz = useRefreshRate();
  useEffect(() => {
    api.get("/prefs").then(setPrefs).catch((e) => toast(e.message));
    officialAssets().then(setAssets);
  }, []);
  if (!prefs) return <Loading />;

  const save = async (patch) => {
    const optimistic = { ...prefs, ...patch, curation: { ...prefs.curation, ...(patch.curation || {}) } };
    setPrefs(optimistic);
    try {
      setPrefs(await api.post("/prefs", patch));
    } catch (e) {
      toast(e.message);
    }
  };
  const cur = prefs.curation;
  const setCur = (patch) => save({ curation: patch });
  const animated = vibeMode.value === "official" || vibeMode.value === "shader";
  const notifySupported = typeof Notification !== "undefined";

  const nav = [
    ["wave", "wave", "Моя волна"],
    ["curation", "sliders", "Подборка"],
    ["uncensored", "ban", "Без цензуры"],
    ["sound", "volume", "Звук"],
    ["player", "play", "Плеер"],
    ["look", "moon", "Оформление"],
    isDesktop && ["window", "desktop", "Окно и Windows"],
    ["devices", "devices", "Устройства"],
    canUpdate && ["updates", "sparkle", "Обновления"],
    ["account", "artist", "Аккаунт"],
  ].filter(Boolean);

  const st = update.value;
  return (
    <div class="page settings">
      <header class="st-hero">
        <Logo size={56} />
        <div class="st-hero-text">
          <h1 class="page-title">Настройки</h1>
          <p>
            YM Classic {VERSION && <b>{VERSION}</b>}
            {heroStatus(st) && <span class="st-hero-status"> · {heroStatus(st)}</span>}
          </p>
        </div>
        <div class="st-hero-actions">
          {updateReady() ? (
            <button class="btn primary" onClick={installUpdate}>
              {st.status === "ready" ? "Перезапустить и обновить" : `Скачать ${st.version}`}
            </button>
          ) : (
            canUpdate && (
              <button class="btn ghost" onClick={checkUpdate} disabled={st?.status === "checking" || st?.status === "downloading"}>
                Проверить обновления
              </button>
            )
          )}
          <a class="btn ghost" href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </header>

      <div class="st-layout">
        <SectionNav items={nav} />
        <div class="st-sections">
          <Section id="wave" icon="wave" title="Моя волна" intro="Как выглядит шар на главной: режим, плавность и реакция на музыку" only>
            <div class="wave-top">
              <div class="wave-preview" aria-label="Предпросмотр анимации">
                <VibeCanvas colors={paletteFor()} active={false} />
                <span class="wave-preview-tag">Предпросмотр</span>
              </div>
              <WaveModes assets={assets} />
            </div>
            <Choice
              label="Плавность анимации"
              hint={
                animated
                  ? "Шар из Яндекс Музыки снят в 25 кадров в секунду: на 60 и выше промежуточные кадры досчитываются плавным смешиванием. На слабой видеокарте выберите 30"
                  : "Работает в режимах «Как в Яндекс Музыке» и «Своя»"
              }
              value={vibeFps.value}
              options={[
                [30, "30 к/с · экономно"],
                [60, "60 к/с"],
                [0, hz ? `Как у экрана · ${hz} Гц` : "Как у экрана"],
              ]}
              onChange={(v) => (vibeFps.value = v)}
              disabled={!animated}
            />
            <Toggle
              label="Реакция на музыку"
              hint="Шар дышит в такт басу и вспыхивает, когда вы ставите лайк. Без неё он просто плавно переливается"
              checked={vibeReact.value}
              onChange={(v) => (vibeReact.value = v)}
              disabled={vibeMode.value === "off" || vibeMode.value === "lite"}
            />
          </Section>

          <Section id="curation" icon="sliders" title="Подборка без повторов" intro="Правила поверх рекомендаций Яндекса для «Моей волны» и всех радиостанций. Сыгранные треки запоминаются на этом компьютере" only>
            <Choice
              label="Не повторять трек"
              hint="Трек, который уже звучал, не вернётся в волну в течение этого срока"
              value={cur.repeatWindowDays}
              options={[
                [1, "День"],
                [7, "Неделю"],
                [14, "2 недели"],
                [30, "Месяц"],
                [90, "3 месяца"],
              ]}
              onChange={(v) => setCur({ repeatWindowDays: v })}
            />
            <Choice
              label="Исполнитель не чаще"
              hint="Сколько треков должно пройти между двумя песнями одного артиста"
              value={cur.artistGap}
              options={[
                [0, "Без ограничений"],
                [3, "Через 3"],
                [5, "Через 5"],
                [10, "Через 10"],
              ]}
              onChange={(v) => setCur({ artistGap: v })}
            />
            <Choice
              label="Треки из «Мне нравится»"
              hint="Как часто в волну попадают треки, которые вы уже лайкнули"
              value={cur.likedEvery}
              options={[
                [0, "Не включать"],
                [8, "Изредка"],
                [3, "Часто"],
                [1, "Без ограничений"],
              ]}
              onChange={(v) => setCur({ likedEvery: v })}
            />
            <Toggle
              label="Одна песня в разных версиях — это повтор"
              hint="Slowed, sped up, remix и hardtekk-версии одного трека считаются одной песней"
              checked={cur.dedupeSongs}
              onChange={(v) => setCur({ dedupeSongs: v })}
            />
            <Toggle label="Убрать переделки" hint="Не включать slowed, sped up, nightcore, bass boosted и hardtekk-версии вовсе" checked={cur.skipReworks} onChange={(v) => setCur({ skipReworks: v })} />
            <Toggle label="Меньше ИИ-музыки" hint="Просить Яндекс реже ставить треки, сгенерированные нейросетью" checked={prefs.aiReduced} onChange={(v) => save({ aiReduced: v })} />
            <Row label="История прослушиваний клиента" hint="Сбросьте её, если хочется снова слышать уже сыгранное">
              <button
                class="btn ghost"
                onClick={async () => {
                  try {
                    await api.post("/history/clear");
                    toast("История очищена");
                  } catch (e) {
                    toast(e.message);
                  }
                }}
              >
                Очистить
              </button>
            </Row>
          </Section>

          <Section id="uncensored" icon="ban" title="Без цензуры" intro="Оригинальные версии треков и полные тексты песен" only>
            <Toggle label="Explicit-контент в волне" hint="Просить волну не заменять треки «чистыми» версиями" checked={prefs.allowExplicit} onChange={(v) => save({ allowExplicit: v })} />
            <Toggle
              label="Играть оригинал вместо подменённого трека"
              hint="Если Яндекс подменил трек или отдал clean-версию, клиент найдёт и включит оригинальную explicit-версию"
              checked={prefs.uncensor}
              onChange={(v) => save({ uncensor: v })}
            />
            <Choice
              label="Источник текстов"
              hint="Авто: синхронный текст Яндекса, а если он с цензурой или его нет — полный текст из LRCLIB"
              value={prefs.lyricsPrefer}
              options={[
                ["auto", "Авто"],
                ["yandex", "Яндекс"],
                ["lrclib", "LRCLIB"],
              ]}
              onChange={(v) => save({ lyricsPrefer: v })}
            />
          </Section>

          <Section id="sound" icon="volume" title="Звук">
            <Choice
              label="Качество"
              hint="«Без потерь» — FLAC там, где он есть у трека (нужна подписка Плюс), иначе AAC 192. Применяется со следующего трека"
              value={prefs.quality === "lq" || prefs.quality === "nq" ? prefs.quality : "lossless"}
              options={[
                ["lq", "Экономия · 64"],
                ["nq", "Обычное · 192"],
                ["lossless", "Без потерь · FLAC"],
              ]}
              onChange={(v) => {
                save({ quality: v });
                player.forgetResolved();
              }}
            />
            <Choice
              label="Кроссфейд"
              hint="Конец трека плавно накладывается на начало следующего"
              value={prefs.crossfade}
              options={[
                [0, "Выкл."],
                [3, "3 с"],
                [5, "5 с"],
                [8, "8 с"],
                [12, "12 с"],
              ]}
              onChange={(v) => {
                save({ crossfade: v });
                player.setAudioConfig({ crossfade: v });
              }}
            />
            <Toggle
              label="Выравнивание громкости"
              hint="Громкие треки приглушаются до общего уровня по данным R128, чтобы волна не «прыгала» по громкости"
              checked={prefs.normalize}
              onChange={(v) => {
                save({ normalize: v });
                player.setAudioConfig({ normalize: v });
              }}
            />
            <Choice
              label="Скорость воспроизведения"
              hint="Для подкастов и аудиокниг; высота голоса не меняется"
              value={player.rate.value}
              options={[
                [0.5, "0,5×"],
                [0.75, "0,75×"],
                [1, "1×"],
                [1.25, "1,25×"],
                [1.5, "1,5×"],
                [2, "2×"],
              ]}
              onChange={player.setRate}
            />
            <div class="st-row is-block">
              <EqPanel />
            </div>
          </Section>

          <Section id="player" icon="play" title="Плеер" intro="Клавиши, время и то, как плеер выглядит и сообщает о новом треке">
            <Choice
              label="Перемотка стрелками"
              hint="← и → на клавиатуре, кнопки перемотки в Windows и на ползунке трека"
              value={seekStep.value}
              options={[
                [5, "5 с"],
                [10, "10 с"],
                [15, "15 с"],
                [30, "30 с"],
              ]}
              onChange={(v) => (seekStep.value = v)}
            />
            <Choice
              label="Шаг громкости"
              hint="↑ и ↓, колесо мыши над громкостью и глобальные клавиши Ctrl+Alt+↑/↓"
              value={volumeStep.value}
              options={[
                [2, "2%"],
                [5, "5%"],
                [10, "10%"],
              ]}
              onChange={(v) => (volumeStep.value = v)}
            />
            <Toggle label="Показывать, сколько осталось" hint="Справа от полосы трека вместо длительности. Переключается и щелчком по времени" checked={timeLeft.value} onChange={(v) => (timeLeft.value = v)} />
            <Toggle label="Цвет плеера под обложку" hint="Панель плеера слегка окрашивается в цвет обложки текущего трека" checked={playerTint.value} onChange={(v) => (playerTint.value = v)} />
            {notifySupported && (
              <Toggle
                label="Уведомлять о смене трека"
                hint={
                  st?.portable
                    ? "Работает в установленной версии: портативной Windows уведомления не показывает"
                    : "Беззвучное уведомление Windows с обложкой, когда окно свёрнуто или в фоне"
                }
                disabled={!!st?.portable}
                checked={trackNotify.value}
                onChange={(v) => {
                  trackNotify.value = v;
                  if (v && Notification.permission === "default") Notification.requestPermission().catch(() => {});
                }}
              />
            )}
            <Row label="Горячие клавиши" hint="Все сочетания клавиш, также по клавише «?»">
              <button class="btn ghost" onClick={() => (shortcutsOpen.value = true)}>
                Показать
              </button>
            </Row>
          </Section>

          <Section id="look" icon="moon" title="Оформление">
            <Row label="Тема" wide>
              <ThemeTiles />
            </Row>
            <Row label="Акцентный цвет" hint="Кнопка воспроизведения, переключатели, выделение и логотип">
              <AccentPicker />
            </Row>
            {isDesktop && (
              <Choice
                label="Масштаб интерфейса"
                hint="Также Ctrl + плюс / минус, Ctrl+0 — сбросить"
                value={zoom.value}
                options={ZOOM_STEPS.map((z) => [z, `${Math.round(z * 100)}%`])}
                onChange={setZoom}
              />
            )}
            <Toggle label="Меньше анимаций" hint="Без плавных переходов и всплывающих эффектов интерфейса. Анимация волны настраивается отдельно" checked={calmUi.value} onChange={(v) => (calmUi.value = v)} />
          </Section>

          {isDesktop && (
            <Section id="window" icon="desktop" title="Окно и Windows">
              <Toggle label="Сворачивать в трей при закрытии" hint="Крестик прячет окно, музыка продолжает играть. Выйти — через меню значка в трее" checked={prefs.closeToTray} onChange={(v) => save({ closeToTray: v })} />
              <Toggle label="Запускать вместе с Windows" checked={prefs.autostart} onChange={(v) => save({ autostart: v })} />
              <Toggle label="Запускать свёрнутым" hint="При автозапуске окно сразу уходит в трей" checked={prefs.startMinimized} onChange={(v) => save({ startMinimized: v })} disabled={!prefs.autostart} />
              <Toggle
                label="Глобальные горячие клавиши"
                hint="Работают, даже когда окно не в фокусе: Ctrl+Alt+P — пауза, Ctrl+Alt+→/← — трек, Ctrl+Alt+↑/↓ — громкость, Ctrl+Alt+L — лайк"
                checked={prefs.globalHotkeys}
                onChange={(v) => save({ globalHotkeys: v })}
              />
            </Section>
          )}

          <Section id="devices" icon="devices" title="Другие устройства">
            <Toggle
              label="Ynison: синхронизация с телефоном (бета)"
              hint="Клиент появится в списке устройств Яндекс Музыки: можно переключать воспроизведение между телефоном и компьютером и управлять телефоном из кнопки «Устройства» в плеере. Пока выключено, клиент не подключается к Ynison"
              checked={prefs.ynison}
              onChange={(v) => save({ ynison: v })}
            />
          </Section>

          {canUpdate && (
            <Section id="updates" icon="sparkle" title="Обновления">
              <Toggle
                label="Обновляться автоматически"
                hint={st?.portable ? "Портативная версия не может обновить себя сама: при новой версии появится ссылка на скачивание" : "Новая версия скачивается в фоне и устанавливается при перезапуске"}
                checked={prefs.autoUpdate !== false}
                onChange={(v) => save({ autoUpdate: v })}
              />
              <Row label={updateLabel(st) || `Версия ${VERSION}`} hint={st?.status === "error" ? st.error : "Что нового — на странице релизов"}>
                <a class="btn ghost" href={`${REPO}/releases`} target="_blank" rel="noreferrer">
                  Релизы
                </a>
              </Row>
            </Section>
          )}

          <Section id="account" icon="artist" title="Аккаунт">
            {me?.authorized ? (
              <div class="st-row st-account">
                <span class={`avatar ${me.hasPlus ? "plus" : ""}`}>{me.avatar ? <img src={me.avatar} alt="" referrerpolicy="no-referrer" /> : (me.name || "?").slice(0, 1).toUpperCase()}</span>
                <div class="st-text">
                  <span class="st-label">
                    {me.name}
                    {me.hasPlus && <span class="plus-badge">Плюс</span>}
                  </span>
                  <span class="st-hint">
                    {me.login} · сессия взята из официального приложения Яндекс Музыки на этом компьютере, повторный вход не нужен. Токен не покидает локальный сервер клиента
                  </span>
                </div>
                <div class="st-control">
                  <a class="btn ghost" href="https://id.yandex.ru/" target="_blank" rel="noreferrer">
                    Яндекс ID
                  </a>
                  <button
                    class="btn ghost"
                    onClick={async () => {
                      dropCache();
                      await onReconnect();
                      toast("Сессия обновлена");
                    }}
                  >
                    Обновить сессию
                  </button>
                </div>
              </div>
            ) : (
              <Row label="Сессия не найдена" hint="Войдите один раз в официальное приложение Яндекс Музыки и нажмите «Повторить»">
                <button class="btn primary" onClick={onReconnect}>
                  Повторить
                </button>
              </Row>
            )}
          </Section>

          <p class="st-foot">
            YM Classic {VERSION} — неофициальный клиент с открытым кодом, не связан с Яндексом.{" "}
            <a href={`${REPO}/issues/new/choose`} target="_blank" rel="noreferrer">
              Сообщить об ошибке
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
