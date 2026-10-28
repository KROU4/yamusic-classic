import { describe, it, expect } from "vitest";
import { parseRoomRef, inviteLink, normRoom, roomError, roomCover, WaveRooms } from "../server/rooms.js";
import { ApiError } from "../server/yandex.js";

const owner = { uid: 1, name: "Аня", cover: { uri: "avatars.mds.yandex.net/get-yapic/123/abc/%%" }, status: "ACTIVE" };
const guest = { uid: 2, name: "Борис", cover: { uri: "avatars.yandex.net/get-music-user/x/%%" } };

describe("My Wave for two: invite links", () => {
  it("parses both link forms and bare codes", () => {
    expect(parseRoomRef("https://music.yandex.ru/multivibe/abc-123")).toBe("abc-123");
    expect(parseRoomRef("music.yandex.ru/multivibe/abc-123?utm=1#x")).toBe("abc-123");
    expect(parseRoomRef("https://music.yandex.ru/multivibe?roomId=r_42&x=1")).toBe("r_42");
    expect(parseRoomRef("  r_42  ")).toBe("r_42");
    expect(parseRoomRef("https://music.yandex.ru/multivibe/a%2Fb")).toBeNull(); // slash inside the id
    expect(parseRoomRef("")).toBeNull();
    expect(parseRoomRef("два слова")).toBeNull();
    expect(parseRoomRef("https://music.yandex.ru/album/1")).toBeNull();
  });

  it("builds the official invite link", () => {
    expect(inviteLink("abc-123")).toBe("https://music.yandex.ru/multivibe/abc-123");
  });

  it("avatar URIs get a size and a scheme, foreign hosts are dropped", () => {
    expect(roomCover("avatars.mds.yandex.net/get-yapic/123/abc/%%")).toBe("https://avatars.mds.yandex.net/get-yapic/123/abc/islands-middle");
    expect(roomCover("avatars.yandex.net/get-music-user/x/%%")).toBe("https://avatars.yandex.net/get-music-user/x/200x200");
    expect(roomCover("https://evil.example/x.png")).toBeNull();
    expect(roomCover(null)).toBeNull();
  });
});

describe("My Wave for two: room shape", () => {
  it("owner view of a draft: no partner yet, not playable", () => {
    const r = normRoom({ id: "r1", status: "DRAFT", owner, members: [owner] }, 1);
    expect(r).toMatchObject({ id: "r1", status: "DRAFT", isOwner: true, isMember: true, partner: null, playable: false, wave: null, link: "https://music.yandex.ru/multivibe/r1" });
  });

  it("enabled room: partner is the other member, seeds are playable", () => {
    const room = { id: "r1", status: "ENABLED", owner, members: [owner, guest], wave: { name: "Моя волна", seeds: ["multivibe:r1"], description: "" } };
    const mine = normRoom(room, 1);
    expect(mine.partner.name).toBe("Борис");
    expect(mine.playable).toBe(true);
    expect(mine.wave.seeds).toEqual(["multivibe:r1"]);
    const theirs = normRoom(room, 2);
    expect(theirs).toMatchObject({ isOwner: false, isMember: true });
    expect(theirs.partner.name).toBe("Аня");
    expect(normRoom(room, 3).isMember).toBe(false);
  });

  it("rejects payloads that aren't rooms", () => {
    expect(normRoom(null, 1)).toBeNull();
    expect(normRoom({ id: "r" }, 1)).toBeNull();
    expect(normRoom({ id: 5, owner, members: [] }, 1)).toBeNull();
  });

  it("reads error names at the top level, under result and from a bare 404", () => {
    expect(roomError(new ApiError("x", 400, { name: "ROOM_DUPLICATION", details: { correctRoomId: "r9" } }))).toMatchObject({ name: "ROOM_DUPLICATION", correctRoomId: "r9" });
    expect(roomError(new ApiError("x", 400, { result: { name: "ROOM_LIMIT_EXCEEDED", details: {} } }))).toMatchObject({ name: "ROOM_LIMIT_EXCEEDED", correctRoomId: null });
    expect(roomError(new ApiError("x", 404, "not json")).name).toBe("ROOM_NOT_FOUND");
  });
});

describe("My Wave for two: calls", () => {
  function fakeApi(handler) {
    const calls = [];
    const api = {
      uid: 2,
      async request(method, url) {
        calls.push(`${method} ${url}`);
        return handler(method, url);
      },
      get(url) {
        return this.request("GET", url);
      },
      post(url) {
        return this.request("POST", url);
      },
    };
    return { api, calls };
  }
  const room = (id, status = "ENABLED") => ({ id, status, owner, members: [owner, guest], wave: { name: "w", seeds: [`multivibe:${id}`] } });

  it("enter retries with correctRoomId on ROOM_DUPLICATION", async () => {
    const { api, calls } = fakeApi((m, url) => {
      if (url.includes("/r1/")) throw new ApiError("dup", 400, { name: "ROOM_DUPLICATION", details: { correctRoomId: "r0" } });
      return room("r0");
    });
    const r = await new WaveRooms({ api }).enter("https://music.yandex.ru/multivibe/r1");
    expect(calls).toEqual(["PUT /wave/rooms/r1/enter", "PUT /wave/rooms/r0/enter"]);
    expect(r.room.id).toBe("r0");
    expect(r.room.playable).toBe(true);
  });

  it("maps known errors to Russian messages and refuses a bad link without calling Yandex", async () => {
    const { api, calls } = fakeApi(() => {
      throw new ApiError("HTTP 400", 400, { name: "ROOM_LIMIT_EXCEEDED" });
    });
    const rooms = new WaveRooms({ api });
    await expect(rooms.create()).rejects.toThrow(/50 волн/);
    await expect(rooms.get("не ссылка вовсе")).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual(["POST /wave/rooms"]);
  });

  it("an unnamed refusal hints that the feature may be off; list tolerates both shapes", async () => {
    const off = new WaveRooms({ api: fakeApi(() => { throw new ApiError("HTTP 403", 403, {}); }).api });
    await expect(off.create()).rejects.toThrow(/не включил/);
    const list = new WaveRooms({ api: fakeApi(() => [room("a"), { junk: true }]).api });
    expect((await list.list()).rooms.map((r) => r.id)).toEqual(["a"]);
    const wrapped = new WaveRooms({ api: fakeApi(() => ({ rooms: [room("b", "DRAFT")] })).api });
    expect((await wrapped.list()).rooms[0]).toMatchObject({ id: "b", playable: false });
  });

  it("exit uses PUT and requires auth first", async () => {
    const { api, calls } = fakeApi(() => null);
    let checked = 0;
    await new WaveRooms({ api, requireAuth: () => checked++ }).exit("r5");
    expect(checked).toBe(1);
    expect(calls).toEqual(["PUT /wave/rooms/r5/exit"]);
  });
});
