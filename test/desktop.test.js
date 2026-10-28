import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { renderPng, SHAPES } from "../electron/png.js";

describe("taskbar icons", () => {
  it("draws a valid PNG with transparency", () => {
    const png = renderPng(16, SHAPES.play);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // unpack IDAT and check that there are both transparent and filled pixels
    const idatStart = png.indexOf("IDAT") + 4;
    const len = png.readUInt32BE(idatStart - 8);
    const raw = zlib.inflateSync(png.subarray(idatStart, idatStart + len));
    const alphas = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) alphas.push(raw[y * 65 + 1 + x * 4 + 3]);
    expect(alphas).toContain(0);
    expect(alphas).toContain(255);
  });
});

import { newerVersion } from "../electron/version.js";

describe("update version check", () => {
  it("compares release tags numerically", () => {
    expect(newerVersion("v0.3.0", "0.2.0")).toBe(true);
    expect(newerVersion("v0.2.10", "0.2.9")).toBe(true);
    expect(newerVersion("v0.2.0", "0.2.0")).toBe(false);
    expect(newerVersion("v0.1.9", "0.2.0")).toBe(false);
    expect(newerVersion("v1.0.0-rc.1", "0.9.9")).toBe(true);
  });
});
