// «Без цензуры»: как устроено ограничение в Яндекс Музыке и что с ним делает клиент.
//
// 1. Волна. Сервер получает allowExplicit. Официальный клиент выставляет его по настройке
//    «Фильтрация контента для взрослых»/детскому режиму; мы всегда шлём true (если не отключено).
// 2. Подмена. Вместо оригинала отдаётся другой трек (clean-версия, лайв, кавер), оригинал при этом
//    лежит в поле `substituted`. Если оригинал доступен — играем его.
// 3. «Чистые» релизы (contentWarning=clean). Ищем explicit-версию той же песни того же артиста
//    с близкой длительностью и подставляем её.
// Слова в аудио «на лету» никто не вырезает: это отдельные мастер-версии от правообладателей.
import { normTrack } from "./normalize.js";
import { baseTitle } from "./curate.js";

export function preferOriginal(track) {
  if (track?.substituted && track.substituted.available) {
    return { ...track.substituted, replacedFrom: track.id, uncensorReason: "substituted" };
  }
  return track;
}

/** Подходит ли кандидат как explicit-версия трека. */
export function isExplicitTwin(track, candidate) {
  if (!candidate || candidate.id === track.id || !candidate.explicit || !candidate.available) return false;
  const mainArtist = track.artists[0]?.id;
  if (!candidate.artists.some((a) => a.id === mainArtist)) return false;
  if (baseTitle(candidate.title) !== baseTitle(track.title)) return false;
  return Math.abs(candidate.durationMs - track.durationMs) <= 12000;
}

export class Uncensor {
  constructor(api, store) {
    this.api = api;
    this.store = store;
    this.cache = new Map(Object.entries(store?.get("uncensorCache") || {}));
  }

  async findExplicitTwin(track) {
    if (this.cache.has(track.id)) return this.cache.get(track.id);
    let twin = null;
    try {
      const q = `${track.artists[0]?.name || ""} ${track.title}`;
      const r = await this.api.search(q, "track", 0);
      const list = (r?.tracks?.results || []).map(normTrack).filter(Boolean);
      twin = list.find((c) => isExplicitTwin(track, c)) || null;
    } catch {
      twin = null;
    }
    this.cache.set(track.id, twin ? twin.id : null);
    this.store?.set("uncensorCache", Object.fromEntries(this.cache));
    return twin ? twin.id : null;
  }

  /** Возвращает трек, который на самом деле нужно играть. */
  async resolve(track, { enabled = true } = {}) {
    if (!enabled || !track) return track;
    const original = preferOriginal(track);
    if (original !== track) return original;
    if (!track.clean) return track;
    const twinId = await this.findExplicitTwin(track);
    if (!twinId) return track;
    const [full] = await this.api.tracks([twinId]).catch(() => []);
    const twin = normTrack(full);
    return twin?.available ? { ...twin, replacedFrom: track.id, uncensorReason: "explicit-version" } : track;
  }
}
