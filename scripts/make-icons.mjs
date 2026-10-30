// Renders src/icons/icon.svg's shapes into the PNG sizes Chrome needs (Chrome
// doesn't accept SVG icons). No dependencies: shapes are rasterized with 4×4
// supersampling and written with a minimal PNG encoder.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZES = [16, 32, 48, 128];
const SS = 4; // samples per axis
// Diagonal background gradient, top left → bottom right.
const BG_FROM = [0x8f, 0x7c, 0xff];
const BG_TO = [0x5a, 0x3f, 0xe6];

// Geometry in the SVG's 64×64 viewBox.
const inRoundRect = (x, y, rx, ry, w, h, r) => {
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return x >= rx && x <= rx + w && y >= ry && y <= ry + h && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

// Level bars whose outline forms a play triangle: [x, y, width, height, radius].
const BARS = [[14, 15, 7, 34, 3.5], [25, 20, 7, 24, 3.5], [36, 25, 7, 14, 3.5], [47, 29.5, 7, 5, 2.5]];
const inBars = (x, y) => BARS.some(([bx, by, w, h, r]) => inRoundRect(x, y, bx, by, w, h, r));

const background = (x, y) => {
  const t = Math.min(Math.max((x + y) / 128, 0), 1);
  return BG_FROM.map((c, i) => c + (BG_TO[i] - c) * t);
};

function render(size) {
  const px = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((pxl + (sx + 0.5) / SS) / size) * 64;
          const y = ((py + (sy + 0.5) / SS) / size) * 64;
          if (!inRoundRect(x, y, 0, 0, 64, 64, 14)) continue;
          const [cr, cg, cb] = inBars(x, y) ? [255, 255, 255] : background(x, y);
          r += cr;
          g += cg;
          b += cb;
          a += 1;
        }
      }
      const i = (py * size + pxl) * 4;
      if (a) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
      }
      px[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Each row starts with filter type 0.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  const file = new URL(`../src/icons/icon-${size}.png`, import.meta.url);
  writeFileSync(file, png(size, render(size)));
  console.log(`wrote icons/icon-${size}.png`);
}
