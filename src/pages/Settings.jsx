// Настройки: подборка (анти-повтор), без цензуры, звук, окно, оформление, аккаунт.
import { useEffect, useState } from "preact/hooks";
import { api, dropCache } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { theme, setTheme } from "../lib/theme.js";
import { isDesktop, zoom, setZoom, ZOOM_STEPS } from "../lib/desktop.js";
import { vibeMode, shortcutsOpen } from "../lib/ui.js";
import { Loading } from "../components/States.jsx";
import { EqPanel } from "../components/Equalizer.jsx";
import * as player from "../player/engine.js";

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label class="setting">
      <span class="setting-text">
        <span class="setting-label">{label}</span>
        {hint && <span class="setting-hint">{hint}</span>}
      </span>
      <input type="checkbox" class="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

function Choice({ label, hint, value, options, onChange }) {
  return (
    <div class="setting">
      <span class="setting-text">
        <span class="setting-label">{label}</span>
        {hint && <span class="setting-hint">{hint}</span>}
      </span>
      <div class="chips">
        {options.map(([v, l]) => (
          <button key={v} class={`chip ${value === v ? "on" : ""}`} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage({ me, onReconnect }) {
  const [prefs, setPrefs] = useState(null);
  useEffect(() => {
    api.get("/prefs").then(setPrefs).catch((e) => toast(e.message));
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

  return (
    <div class="page settings">
      <h1 class="page-title">Настройки</h1>

      <section class="settings-group">
        <h2>Подборка без повторов</h2>
        <p class="settings-intro">
          Эти правила применяются к «Моей волне» и всем радиостанциям поверх рекомендаций Яндекса. Сыгранные треки запоминаются на этом компьютере.
        </p>
        <Choice
          label="Не повторять трек"
          hint="Трек, который уже звучал, не вернётся в волну в течение этого срока"
          value={cur.repeatWindowDays}
          options={[
            [1, "1 день"],
            [7, "Неделю"],
            [14, "2 недели"],
            [30, "Месяц"],
            [90, "3 месяца"],
          ]}
          onChange={(v) => setCur({ repeatWindowDays: v })}
        />
        <Choice
          label="Исполнитель не чаще"
          hint="Минимум треков между двумя песнями одного артиста"
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
          label="Треки из «Мне нравится» в волне"
          hint="Главная жалоба на волну: она крутит уже знакомое"
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
        <Toggle
          label="Убрать переделки"
          hint="Не включать slowed / sped up / nightcore / bass boosted / hardtekk-версии вовсе"
          checked={cur.skipReworks}
          onChange={(v) => setCur({ skipReworks: v })}
        />
        <Toggle label="Меньше ИИ-музыки" hint="Просить у Яндекса сократить сгенерированные нейросетью треки" checked={prefs.aiReduced} onChange={(v) => save({ aiReduced: v })} />
        <div class="setting">
          <span class="setting-text">
            <span class="setting-label">История прослушиваний клиента</span>
            <span class="setting-hint">Сбросить, если хочется снова слышать уже сыгранное</span>
          </span>
          <button
            class="btn ghost"
            onClick={async () => {
              await api.post("/history/clear");
              toast("История очищена");
            }}
          >
            Очистить
          </button>
        </div>
      </section>

      <section class="settings-group">
        <h2>Без цензуры</h2>
        <Toggle
          label="Explicit-контент в волне"
          hint="Просить волну не заменять треки «чистыми» версиями (allowExplicit)"
          checked={prefs.allowExplicit}
          onChange={(v) => save({ allowExplicit: v })}
        />
        <Toggle
          label="Играть оригинал вместо подменённого трека"
          hint="Если Яндекс подменил трек или отдал clean-версию, искать и включать оригинальную explicit-версию"
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
      </section>

      <section class="settings-group">
        <h2>Звук</h2>
        <Choice
          label="Кроссфейд"
          hint="Плавное наложение конца трека на начало следующего"
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
            [0.75, "0,75×"],
            [1, "1×"],
            [1.25, "1,25×"],
            [1.5, "1,5×"],
            [2, "2×"],
          ]}
          onChange={player.setRate}
        />
        <div class="setting column">
          <EqPanel />
        </div>
      </section>

      {isDesktop && (
        <section class="settings-group">
          <h2>Окно и Windows</h2>
          <Toggle label="Сворачивать в трей при закрытии" hint="Крестик прячет окно, музыка продолжает играть. Выйти — через меню значка в трее" checked={prefs.closeToTray} onChange={(v) => save({ closeToTray: v })} />
          <Toggle label="Запускать вместе с Windows" checked={prefs.autostart} onChange={(v) => save({ autostart: v })} />
          <Toggle label="Запускать свёрнутым" hint="При автозапуске окно сразу уходит в трей" checked={prefs.startMinimized} onChange={(v) => save({ startMinimized: v })} />
          <Toggle
            label="Глобальные горячие клавиши"
            hint="Работают, даже когда окно не в фокусе: Ctrl+Alt+P (или Ctrl+Alt+Пробел) — пауза, Ctrl+Alt+→/← — трек, Ctrl+Alt+↑/↓ — громкость, Ctrl+Alt+L — лайк"
            checked={prefs.globalHotkeys}
            onChange={(v) => save({ globalHotkeys: v })}
          />
        </section>
      )}

      <section class="settings-group">
        <h2>Оформление</h2>
        <Choice
          label="Тема"
          value={theme.value}
          options={[
            ["dark", "Тёмная"],
            ["light", "Светлая"],
            ["system", "Как в системе"],
          ]}
          onChange={setTheme}
        />
        <Choice
          label="Анимация «Моей волны»"
          hint="Полная реагирует на музыку; облегчённая почти не нагружает видеокарту"
          value={vibeMode.value}
          options={[
            ["full", "Полная"],
            ["lite", "Облегчённая"],
            ["off", "Без анимации"],
          ]}
          onChange={(v) => (vibeMode.value = v)}
        />
        {isDesktop && (
          <Choice
            label="Масштаб интерфейса"
            hint="Также Ctrl + плюс / минус, Ctrl+0 — сбросить"
            value={zoom.value}
            options={ZOOM_STEPS.map((z) => [z, `${Math.round(z * 100)}%`])}
            onChange={setZoom}
          />
        )}
        <div class="setting">
          <span class="setting-text">
            <span class="setting-label">Горячие клавиши</span>
            <span class="setting-hint">Список всех сочетаний — также по клавише «?»</span>
          </span>
          <button class="btn ghost" onClick={() => (shortcutsOpen.value = true)}>
            Показать
          </button>
        </div>
      </section>

      <section class="settings-group">
        <h2>Аккаунт</h2>
        {me?.authorized ? (
          <div class="setting">
            <span class="setting-text">
              <span class="setting-label">
                {me.name} ({me.login}){me.hasPlus && <span class="plus-badge">Плюс</span>}
              </span>
              <span class="setting-hint">
                Сессия взята из официального приложения Яндекс Музыки на этом компьютере — повторный вход не нужен. Токен не покидает локальный сервер клиента.
              </span>
            </span>
            <button
              class="btn ghost"
              onClick={async () => {
                dropCache();
                await onReconnect();
                toast("Сессия обновлена");
              }}
            >
              Обновить
            </button>
          </div>
        ) : (
          <div class="setting">
            <span class="setting-text">
              <span class="setting-label">Сессия не найдена</span>
              <span class="setting-hint">Войдите один раз в официальное приложение Яндекс Музыки и нажмите «Повторить».</span>
            </span>
            <button class="btn primary" onClick={onReconnect}>
              Повторить
            </button>
          </div>
        )}
        <div class="setting">
          <span class="setting-text">
            <span class="setting-label">Горячие клавиши</span>
            <span class="setting-hint">
              Пробел — пауза · ←/→ — перемотка на 10 с · Shift+←/→ — трек назад/вперёд · ↑/↓ — громкость · L — лайк · Ctrl+F или / — поиск · медиа-клавиши работают системно
            </span>
          </span>
        </div>
      </section>
    </div>
  );
}
