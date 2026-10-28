import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { renderPng, SHAPES } from "../electron/png.js";

describe("иконки панели задач", () => {
  it("рисует валидный PNG с прозрачностью", () => {
    const png = renderPng(16, SHAPES.play);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // распаковываем IDAT и проверяем, что есть и прозрачные, и закрашенные пиксели
    const idatStart = png.indexOf("IDAT") + 4;
    const len = png.readUInt32BE(idatStart - 8);
    const raw = zlib.inflateSync(png.subarray(idatStart, idatStart + len));
    const alphas = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) alphas.push(raw[y * 65 + 1 + x * 4 + 3]);
    expect(alphas).toContain(0);
    expect(alphas).toContain(255);
  });
});
