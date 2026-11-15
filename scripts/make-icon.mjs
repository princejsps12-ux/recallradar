// Renders marketplace/icon-144.png (the same design as marketplace/icon.svg) with no dependencies:
// 4x supersampled shapes, then a hand-written PNG encoder (zlib from Node). Run: node scripts/make-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 144;
const SS = 4; // supersampling: 4x4 samples per pixel for smooth edges
const BLUE = [12, 102, 228];
const WHITE = [255, 255, 255];
const RED = [248, 113, 104];

// Colour (and alpha 0..1) of the design at a point, in 144-unit coordinates.
function sample(x, y) {
  // rounded square, radius 28
  const r = 28;
  const cx = Math.min(Math.max(x, r), SIZE - r);
  const cy = Math.min(Math.max(y, r), SIZE - r);
  if (Math.hypot(x - cx, y - cy) > r) return null; // outside the rounded square: transparent
  let color = BLUE;
  const d = Math.hypot(x - 72, y - 72);
  const mix = (c, a) => color.map((v, i) => Math.round(v * (1 - a) + c[i] * a));
  if (Math.abs(d - 50) <= 2.5) color = mix(WHITE, 0.35);
  if (Math.abs(d - 32) <= 2.5) color = mix(WHITE, 0.6);
  if (d <= 6) color = WHITE;
  // sweep line from the centre to (112, 40), width 6
  const [x1, y1, x2, y2] = [72, 72, 112, 40];
  const t = Math.min(Math.max(((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2), 0), 1);
  if (Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1))) <= 3) color = WHITE;
  // the red blip with a white outline
  const b = Math.hypot(x - 104, y - 52);
  if (b <= 12) color = WHITE;
  if (b <= 9) color = RED;
  return color;
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let py = 0; py < SIZE; py += 1) {
  raw[py * (SIZE * 4 + 1)] = 0; // filter type: none
  for (let px = 0; px < SIZE; px += 1) {
    let r = 0, g = 0, b = 0, hits = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const c = sample(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS);
        if (c) { r += c[0]; g += c[1]; b += c[2]; hits += 1; }
      }
    }
    const o = py * (SIZE * 4 + 1) + 1 + px * 4;
    if (hits) { raw[o] = Math.round(r / hits); raw[o + 1] = Math.round(g / hits); raw[o + 2] = Math.round(b / hits); }
    raw[o + 3] = Math.round((255 * hits) / (SS * SS));
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(new URL('../marketplace/icon-144.png', import.meta.url), png);
console.log('wrote marketplace/icon-144.png', png.length, 'bytes');
