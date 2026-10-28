// Minimal dependency-free PNG renderer: taskbar button icons are drawn in code.
import zlib from "node:zlib";

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

/** inside(x, y) -> 0..1 coverage at a point; 4×4 supersampling for smooth edges. The color is white. */
export function renderPng(size, inside, color = [255, 255, 255]) {
  const SS = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) if (inside((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)) hit++;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = color[0];
      raw[o + 1] = color[1];
      raw[o + 2] = color[2];
      raw[o + 3] = Math.round((hit / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Shapes in normalized coordinates 0..1
const tri = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, cx, cy), d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const any = (...fs) => (x, y) => fs.some((f) => f(x, y));

export const SHAPES = {
  play: tri(0.3, 0.2, 0.3, 0.8, 0.8, 0.5),
  pause: any(rect(0.25, 0.2, 0.42, 0.8), rect(0.58, 0.2, 0.75, 0.8)),
  next: any(tri(0.2, 0.2, 0.2, 0.8, 0.65, 0.5), rect(0.68, 0.2, 0.8, 0.8)),
  prev: any(tri(0.8, 0.2, 0.8, 0.8, 0.35, 0.5), rect(0.2, 0.2, 0.32, 0.8)),
};
