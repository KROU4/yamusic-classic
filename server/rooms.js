// "My Wave for two" (Multivibe): a room shared by two listeners whose wave merges both tastes.
// Endpoints and the Room shape follow the official client 5.124.1 (waveResource):
// POST /wave/rooms creates a DRAFT room, PUT .../enter accepts an invite, PUT .../exit leaves,
// and an ENABLED room carries wave.seeds that play through the usual rotor/session/new.
// Room ids and invite links are bearer capabilities (anyone with the link can join), so they travel
// in request bodies, never in our URL paths, and are never logged.
import { ApiError } from "./yandex.js";
import { cleanSeeds } from "./wave.js";

export const INVITE_HOST = "https://music.yandex.ru";
const ROOM_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

/** Room id from an invite link (…/multivibe/<id> or …/multivibe?roomId=<id>) or a bare code. */
export function parseRoomRef(input) {
  const s = String(input ?? "").trim();
  if (!s || s.length > 512) return null;
  let id = null;
  const path = s.match(/\/multivibe\/([^/?#\s]+)/i);
  const query = s.match(/[?&]roomId=([^&#\s]+)/i);
  if (path) id = decode(path[1]);
  else if (query) id = decode(query[1]);
  else if (!/[/\s?#&=]/.test(s)) id = s;
  return id && ROOM_ID.test(id) ? id : null;
}

export const inviteLink = (id) => `${INVITE_HOST}/multivibe/${encodeURIComponent(id)}`;

/** Avatars come as Yandex avatar URIs, usually without a scheme and with a %% size placeholder. */
export function roomCover(uri) {
  if (typeof uri !== "string" || !uri) return null;
  const sized = uri.replace("%%", uri.includes("get-yapic") ? "islands-middle" : "200x200");
  const url = sized.startsWith("http") ? sized : `https://${sized.replace(/^\/+/, "")}`;
  return /^https:\/\/[\w.-]+\.yandex\.(net|ru)\//.test(url) ? url : null;
}

const person = (m) => (m && typeof m === "object" ? { uid: m.uid ?? null, name: String(m.name || ""), cover: roomCover(m.cover?.uri), status: m.status || null } : null);

/** UI shape of a room; null when the payload isn't a room (the official guard needs id, owner, members, status). */
export function normRoom(r, myUid) {
  if (!r || typeof r !== "object" || typeof r.id !== "string" || !r.owner || !Array.isArray(r.members)) return null;
  const owner = person(r.owner);
  const same = (a, b) => a != null && b != null && String(a) === String(b);
  // members include the owner; the official client filters him out to show "the other one"
  const members = r.members.filter((m) => !(owner.uid != null && same(m?.uid, owner.uid))).map(person).filter(Boolean);
  const seeds = cleanSeeds(r.wave?.seeds);
  const isOwner = same(owner.uid, myUid);
  const status = typeof r.status === "string" ? r.status : "DRAFT";
  return {
    id: r.id,
    name: typeof r.name === "string" ? r.name : "",
    status,
    link: inviteLink(r.id),
    owner,
    members,
    isOwner,
    isMember: isOwner || members.some((m) => same(m.uid, myUid)),
    partner: isOwner ? members[0] || null : owner,
    wave: seeds.length ? { name: String(r.wave.name || ""), description: String(r.wave.description || ""), seeds } : null,
    playable: status === "ENABLED" && seeds.length > 0,
  };
}

/**
 * Error name and details from a failed wave/rooms call. The official parser reads the raw body's top-level
 * `name`/`details`, while the 404 we saw live came wrapped in `result`; both (and `error`) are checked.
 */
export function roomError(e) {
  const body = e?.body && typeof e.body === "object" ? e.body : {};
  const layers = [body, body.result, body.error].filter((x) => x && typeof x === "object");
  const name = layers.map((x) => x.name).find((x) => typeof x === "string") || (e?.status === 404 ? "ROOM_NOT_FOUND" : null);
  const correctRoomId = layers.map((x) => x.details?.correctRoomId).find((x) => typeof x === "string" && ROOM_ID.test(x)) || null;
  return { name, correctRoomId, status: e?.status ?? null };
}

const MESSAGES = {
  ROOM_NOT_FOUND: "Приглашение не найдено. Проверьте ссылку",
  NOT_FOUND: "Приглашение не найдено. Проверьте ссылку",
  ROOM_LIMIT_EXCEEDED: "У вас уже 50 волн на двоих. Выйдите из одной, чтобы создать новую",
  INVALID_SEEDS: "Яндекс не смог собрать общую волну для этого приглашения",
  ROOM_DUPLICATION: "Вы уже слушаете общую волну с этим человеком",
};

function friendly(e, fallback) {
  if (!(e instanceof ApiError)) return e;
  if (e.status === 401) return e;
  const { name } = roomError(e);
  if (name && MESSAGES[name]) return new ApiError(MESSAGES[name], e.status === 404 ? 404 : 400);
  if (e.status === 429) return e;
  // the feature sits behind Yandex experiments; a refusal we can't name most likely means it's off for this account
  return new ApiError(`${fallback} (${e.message}). Возможно, Яндекс ещё не включил «Мою волну на двоих» для вашего аккаунта`, e.status || 502);
}

export class WaveRooms {
  /** @param deps { api: YandexMusic, requireAuth: () => void } */
  constructor({ api, requireAuth = () => {} }) {
    this.api = api;
    this.requireAuth = requireAuth;
  }

  path(id, tail = "") {
    return `/wave/rooms/${encodeURIComponent(id)}${tail}`;
  }

  id(ref) {
    const id = parseRoomRef(ref);
    if (!id) throw new ApiError("Не похоже на ссылку или код приглашения", 400);
    return id;
  }

  async list() {
    this.requireAuth();
    const r = await this.api.get("/wave/rooms").catch((e) => {
      throw friendly(e, "Не удалось загрузить волны на двоих");
    });
    const list = Array.isArray(r) ? r : Array.isArray(r?.rooms) ? r.rooms : [];
    return { rooms: list.map((x) => normRoom(x, this.api.uid)).filter(Boolean) };
  }

  async get(ref) {
    this.requireAuth();
    const id = this.id(ref);
    const r = await this.api.get(this.path(id)).catch((e) => {
      throw friendly(e, "Не удалось открыть приглашение");
    });
    const room = normRoom(r, this.api.uid);
    if (!room) throw new ApiError("Яндекс вернул неожиданный ответ на приглашение", 502);
    return { room };
  }

  /** Account write: creates a DRAFT room (counts toward the 50-room limit). Only on an explicit click. */
  async create() {
    this.requireAuth();
    const r = await this.api.post("/wave/rooms").catch((e) => {
      throw friendly(e, "Не удалось создать приглашение");
    });
    const room = normRoom(r, this.api.uid);
    if (!room) throw new ApiError("Яндекс вернул неожиданный ответ при создании приглашения", 502);
    return { room };
  }

  /** Accepts an invite. ROOM_DUPLICATION points at the room already shared with this person: enter that one. */
  async enter(ref) {
    this.requireAuth();
    const id = this.id(ref);
    let r;
    try {
      r = await this.api.request("PUT", this.path(id, "/enter"));
    } catch (e) {
      const info = e instanceof ApiError ? roomError(e) : {};
      if (info.name !== "ROOM_DUPLICATION" || !info.correctRoomId || info.correctRoomId === id) throw friendly(e, "Не удалось принять приглашение");
      r = await this.api.request("PUT", this.path(info.correctRoomId, "/enter")).catch((e2) => {
        throw friendly(e2, "Не удалось принять приглашение");
      });
    }
    const room = normRoom(r, this.api.uid);
    if (!room) throw new ApiError("Яндекс вернул неожиданный ответ на приглашение", 502);
    return { room };
  }

  /** Leaves the room (for the owner of a draft this withdraws the invite). */
  async exit(ref) {
    this.requireAuth();
    const id = this.id(ref);
    await this.api.request("PUT", this.path(id, "/exit")).catch((e) => {
      throw friendly(e, "Не удалось выйти из волны на двоих");
    });
    return { ok: true };
  }
}
