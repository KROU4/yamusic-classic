import { describe, it, expect } from "vitest";
import { sharedProgressNow, queueMatches, sameListIndex, statusPlan, statusDiffers, contextFor, deviceIcon, windowIds } from "../src/player/ynisonLogic.js";

const view = (o = {}) => ({ ids: ["a", "b", "c"], index: 1, paused: false, progressMs: 10000, durationMs: 60000, speed: 1, at: 1000, ...o });

describe("Ynison sync decisions (UI side)", () => {
  it("shared progress extrapolates from the snapshot time, stops when paused, caps at duration", () => {
    expect(sharedProgressNow(view(), 3000)).toBe(12000);
    expect(sharedProgressNow(view({ paused: true }), 9000)).toBe(10000);
    expect(sharedProgressNow(view(), 1e9)).toBe(60000);
  });
  it("queue match: same tracks in the published window and the same current track", () => {
    expect(queueMatches(["a", "b", "c"], 1, view())).toBe(true);
    expect(queueMatches(["a", "b", "c"], 2, view())).toBe(false);
    expect(queueMatches(["a", "c", "b"], 1, view())).toBe(false);
    // a non-track item on the other device (null id) is skipped when comparing lists
    expect(queueMatches(["a", "b", "c"], 1, view({ ids: ["a", null, "b", "c"], index: 2 }))).toBe(true);
    // long local queue: only the ±100 window is compared
    const long = Array.from({ length: 400 }, (_, i) => `t${i}`);
    const w = windowIds(long, 250);
    expect(queueMatches(long, 250, { ids: w.ids, index: w.index })).toBe(true);
  });
  it("same list with another current track: the local position to jump to", () => {
    expect(sameListIndex(["a", "b", "c"], 0, view({ index: 2 }))).toBe(2);
    expect(sameListIndex(["a", "b", "c"], 0, view({ ids: ["a", null, "b", "c"], index: 3 }))).toBe(2);
    expect(sameListIndex(["x", "b", "c"], 0, view())).toBe(-1);
    expect(sameListIndex(["a", "b", "c"], 0, view({ ids: ["a", "b", "c", null], index: 3 }))).toBe(-1);
  });
  it("following a status: pause/play only on a real difference, seek beyond 1.5 s", () => {
    const local = (o) => ({ hasTrack: true, playing: true, loading: false, position: 12, ...o });
    expect(statusPlan(local(), view(), 3000)).toEqual({});
    expect(statusPlan(local(), view({ paused: true, progressMs: 12000 }), 3000)).toEqual({ toggle: true });
    expect(statusPlan(local({ playing: false }), view(), 3000)).toEqual({ toggle: true });
    expect(statusPlan(local({ playing: false, loading: true }), view(), 3000)).toEqual({});
    expect(statusPlan(local({ position: 40 }), view(), 3000)).toEqual({ seekTo: 12 });
    expect(statusPlan(local({ hasTrack: false }), view(), 3000)).toEqual({});
  });
  it("publishing a status only when it moved: play state, ±2 s position, a newly known duration", () => {
    const l = (o) => ({ playing: true, positionMs: 12000, durationMs: 60000, ...o });
    expect(statusDiffers(l(), view(), 3000)).toBe(false);
    expect(statusDiffers(l({ playing: false }), view(), 3000)).toBe(true);
    expect(statusDiffers(l({ positionMs: 15000 }), view(), 3000)).toBe(true);
    expect(statusDiffers(l(), view({ durationMs: 0 }), 3000)).toBe(true);
  });
  it("context of a taken-over queue: wave continues as a wave, entities link back", () => {
    expect(contextFor({ entityType: "RADIO", entityId: "user:onyourwave", title: "Моя волна" })).toEqual({ title: "Моя волна", resumeWave: true, stationId: "user:onyourwave" });
    expect(contextFor({ entityType: "RADIO", entityId: "bogus", title: "Моя волна" })).toEqual({ title: "Моя волна" });
    expect(contextFor({ entityType: "ALBUM", entityId: "123", title: "A", from: "f" })).toEqual({ title: "A", from: "f", link: "/album/123" });
    expect(contextFor({ entityType: "PLAYLIST", entityId: "user.x:7", title: "P" }).link).toBe("/playlist/user.x/7");
    expect(contextFor({ entityType: "VARIOUS", entityId: "" }).title).toBe("С другого устройства");
  });
  it("device icons by type", () => {
    expect(deviceIcon("ANDROID")).toBe("phone");
    expect(deviceIcon("IOS")).toBe("phone");
    expect(deviceIcon("SMART_SPEAKER")).toBe("speaker");
    expect(deviceIcon("ANDROID_TV")).toBe("tv");
    expect(deviceIcon("WEB_DESKTOP")).toBe("desktop");
    expect(deviceIcon("UNSPECIFIED")).toBe("devices");
  });
});
