import { describe, it, expect } from "vitest";
import { q2vSeed, promptFromSeed, normalizePrompt, promptTitle, promptMood, promptPin, isPromptStation, MAX_PROMPT } from "../src/lib/q2v.js";
import { pinKey } from "../src/lib/pins.js";
import { stationFrom, isPureStation, cleanSeeds, WaveManager } from "../server/wave.js";

describe("prompt wave seed (q2v)", () => {
  it("matches the seed the server returned for a known prompt byte for byte", () => {
    // live: search returned q2v:<base64(0a 2f + "Спокойный джаз для работы")> (47 UTF-8 bytes)
    const text = "Спокойный джаз для работы";
    const utf8 = Buffer.from(text, "utf8");
    expect(utf8.length).toBe(47);
    const expected = "q2v:" + Buffer.concat([Buffer.from([0x0a, 0x2f]), utf8]).toString("base64");
    expect(q2vSeed(text)).toBe(expected);
  });

  it("uses a two-byte varint for prompts longer than 127 bytes", () => {
    const text = "очень длинный запрос ".repeat(5).trim(); // Cyrillic: 2 bytes per letter
    const bytes = Buffer.from(q2vSeed(text).slice(4), "base64");
    const len = Buffer.byteLength(normalizePrompt(text), "utf8");
    expect(len).toBeGreaterThan(127);
    expect(bytes[0]).toBe(0x0a);
    expect(bytes[1]).toBe((len & 0x7f) | 0x80);
    expect(bytes[2]).toBe(len >> 7);
    expect(bytes.length).toBe(3 + len);
  });

  it("standard base64 with padding, decodes back to the prompt", () => {
    for (const text of ["энергичный рок для пробежки", "lo-fi beats 🎧", "a", "x".repeat(MAX_PROMPT)]) {
      const seed = q2vSeed(text);
      expect(seed).toMatch(/^q2v:[A-Za-z0-9+/]+=*$/);
      expect(promptFromSeed(seed)).toBe(normalizePrompt(text));
    }
  });

  it("empty or whitespace prompt gives no seed; newlines and long text are normalized", () => {
    expect(q2vSeed("")).toBeNull();
    expect(q2vSeed("   \n\t ")).toBeNull();
    expect(normalizePrompt("  джаз \n\n для   работы ")).toBe("джаз для работы");
    expect(normalizePrompt("y".repeat(500))).toHaveLength(MAX_PROMPT);
  });

  it("promptFromSeed rejects other stations and garbage", () => {
    expect(promptFromSeed("user:onyourwave")).toBeNull();
    expect(promptFromSeed("q2v:!!!")).toBeNull();
    expect(promptFromSeed("q2v:" + Buffer.from([0x12, 0x01, 0x41]).toString("base64"))).toBeNull(); // wrong field tag
    expect(promptFromSeed("q2v:" + Buffer.from([0x0a, 0x05, 0x41]).toString("base64"))).toBeNull(); // truncated
    expect(isPromptStation("q2v:abc")).toBe(true);
    expect(isPromptStation("genre:jazz")).toBe(false);
  });

  it("title capitalises like the server; mood follows the words, stable for unknown words", () => {
    expect(promptTitle("спокойный джаз")).toBe("Спокойный джаз");
    expect(promptMood("спокойный джаз для работы").moodEnergy).toBe("calm");
    expect(promptMood("энергичный рок для пробежки").moodEnergy).toBe("active");
    expect(promptMood("грустные песни под дождь").moodEnergy).toBe("sad");
    expect(promptMood("танцевальное на вечеринку").moodEnergy).toBe("fun");
    expect(promptMood("что-то про космос")).toEqual(promptMood("что-то про космос"));
  });

  it("prompt pins are keyed by the text; settings-wave keys are unchanged", () => {
    const a = promptPin("  спокойный джаз ");
    expect(a).toEqual({ type: "wave", title: "Спокойный джаз", prompt: "спокойный джаз" });
    expect(pinKey(a)).toBe("wave:q2v:спокойный джаз");
    expect(pinKey(a)).not.toBe(pinKey(promptPin("бодрый рок")));
    // the key existing pins were stored under must stay the same
    expect(pinKey({ type: "wave", title: "x", settings: { activity: "any", diversity: "default", moodEnergy: "calm", language: "any" } })).toBe("wave:any:default:calm:any");
  });
});

describe("wave plumbing for prompt and shared waves", () => {
  it("stationFrom keeps the classic format and shortens base64 ids", () => {
    expect(stationFrom("user:onyourwave")).toBe("desktop_win-radio-user_onyourwave-default");
    expect(stationFrom("genre:rock")).toBe("desktop_win-radio-genre_rock-default");
    expect(stationFrom(q2vSeed("спокойный джаз для работы"))).toBe("desktop_win-radio-q2v-default");
  });

  it("pure stations skip My Wave settings; extra seeds are filtered", () => {
    expect(isPureStation("q2v:abc")).toBe(true);
    expect(isPureStation("multivibe:1")).toBe(true);
    expect(isPureStation("user:onyourwave")).toBe(false);
    expect(cleanSeeds(["multivibe:1", 5, "no-colon", "a:b c", "x:" + "y".repeat(2000)])).toEqual(["multivibe:1"]);
    expect(cleanSeeds("nope")).toEqual([]);
  });

  const deps = (r) => ({
    api: { sessionNew: async () => r, sessionTracks: async () => ({ sequence: [] }), sessionFeedback: async () => ({}) },
    history: { tape: [], tracks: [], songs: [] },
    getLibrary: () => ({ liked: new Set(), disliked: new Set() }),
    getPrefs: () => ({ allowExplicit: true, aiReduced: false, curation: {} }),
  });

  it("a prompt rotor didn't accept is an error, not a generic wave", async () => {
    const seed = q2vSeed("абв");
    const w = new WaveManager(deps({ radioSessionId: "s", batchId: "b", acceptedSeeds: [], sequence: [] }));
    await expect(w.start({ stationId: seed })).rejects.toMatchObject({ status: 422 });
    const ok = new WaveManager(deps({ radioSessionId: "s", batchId: "b", acceptedSeeds: [{ type: "q2v", tag: "x", value: "x" }], sequence: [] }));
    const info = await ok.start({ stationId: seed });
    expect(info.seeds).toEqual([seed]);
    expect(ok.info().from).toBe("desktop_win-radio-q2v-default");
  });
});
