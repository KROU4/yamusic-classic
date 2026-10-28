import { describe, it, expect, beforeEach } from "vitest";
import { pins, pinKey, togglePin, isPinned, movePin, unpin } from "../src/lib/pins.js";

const album = { type: "album", id: "1", title: "A" };
const artist = { type: "artist", id: "2", title: "B" };
const wave = { type: "wave", title: "Спокойное", settings: { activity: "any", diversity: "default", moodEnergy: "calm", language: "any" } };

describe("закрепы бокового меню", () => {
  beforeEach(() => {
    pins.value = [];
  });

  it("ключ не зависит от названия и обложки", () => {
    expect(pinKey(album)).toBe(pinKey({ ...album, title: "другое", cover: "x" }));
    expect(pinKey({ type: "playlist", uid: "u", kind: "3" })).toBe("playlist:u:3");
    expect(pinKey(wave)).not.toBe(pinKey({ ...wave, settings: { ...wave.settings, moodEnergy: "sad" } }));
  });

  it("повторный клик открепляет, новые закрепы сверху", () => {
    expect(togglePin(album)).toBe(true);
    expect(togglePin(artist)).toBe(true);
    expect(pins.value.map((p) => p.id)).toEqual(["2", "1"]);
    expect(isPinned(album)).toBe(true);
    expect(togglePin({ ...album, title: "иначе" })).toBe(false);
    expect(isPinned(album)).toBe(false);
  });

  it("перестановка и удаление", () => {
    togglePin(album);
    togglePin(artist);
    togglePin(wave);
    movePin(0, 2);
    expect(pins.value.map((p) => p.type)).toEqual(["artist", "album", "wave"]);
    movePin(5, 0); // за пределами — без изменений
    expect(pins.value).toHaveLength(3);
    unpin(artist);
    expect(pins.value.map((p) => p.type)).toEqual(["album", "wave"]);
  });
});
