// Рисует build/icon.png (256×256): жёлтый круг с тёмным треугольником «play». Без зависимостей.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const SS = 4; // суперсэмплинг для сглаживания краёв

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const inTriangle = (x, y) => {
  // треугольник, смещённый вправо для оптического центра
  const ax = 98, ay = 72, bx = 98, by = 184, cx = 190, cy = 128;
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, cx, cy), d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    let circle = 0, tri = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
        const inC = (px - 128) ** 2 + (py - 128) ** 2 <= 124 ** 2;
        if (inC) {
          circle++;
          if (inTriangle(px, py)) tri++;
        }
      }
    const n = SS * SS;
    const a = circle / n, t = tri / Math.max(1, circle);
    const yellow = [255, 219, 77], dark = [18, 18, 18];
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    for (let i = 0; i < 3; i++) raw[o + i] = Math.round(yellow[i] * (1 - t) + dark[i] * t);
    raw[o + 3] = Math.round(a * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // глубина
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "build", "icon.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log("icon:", out, png.length, "bytes");
