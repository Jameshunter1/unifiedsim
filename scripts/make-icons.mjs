#!/usr/bin/env node
/**
 * Generates the desktop app's icons.
 *
 * Written as a generator rather than committed binaries so the mark can be
 * tweaked in one place and every size stays consistent. No image library: a
 * PNG is a zlib-deflated scanline stream plus four CRC'd chunks, and an ICO is
 * a small header wrapping PNGs.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps', 'desktop', 'resources');

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes RGBA pixel data as a PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // Each scanline is prefixed with its filter byte; 0 means "none".
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- mark */

const BLUE = [42, 120, 214];
const AQUA = [27, 175, 122];

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Signed distance to a rounded rectangle, used for crisp antialiased edges. */
function roundedRectDistance(px, py, halfW, halfH, radius) {
  const dx = Math.abs(px) - (halfW - radius);
  const dy = Math.abs(py) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Distance to a thick line segment — the strokes of the chart glyph. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/**
 * A rising two-segment line on a rounded tile — the DPS trend the app exists
 * to show. Readable at 16px because it is one shape with one thick stroke.
 */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 256; // design the mark at 256 and scale
  const stroke = 22 * s;

  // Polyline in design space, origin at the tile centre.
  const points = [
    [-74, 54],
    [-16, -4],
    [18, 26],
    [74, -56],
  ].map(([x, y]) => [x * s, y * s]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - size / 2;
      const py = y + 0.5 - size / 2;

      const tile = roundedRectDistance(px, py, size / 2, size / 2, 56 * s);
      const tileAlpha = clamp01(0.5 - tile);
      if (tileAlpha <= 0) continue;

      // Diagonal blue -> aqua wash so the tile is not a flat block.
      const mix = clamp01((px + py) / (size * 1.1) + 0.5);
      let r = BLUE[0] + (AQUA[0] - BLUE[0]) * mix;
      let g = BLUE[1] + (AQUA[1] - BLUE[1]) * mix;
      let b = BLUE[2] + (AQUA[2] - BLUE[2]) * mix;

      let lineDistance = Infinity;
      for (let i = 0; i < points.length - 1; i++) {
        lineDistance = Math.min(
          lineDistance,
          segmentDistance(px, py, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]),
        );
      }
      // End marker on the peak, matching the chart's own end-dot.
      const dot = Math.hypot(px - points[3][0], py - points[3][1]) - stroke * 0.85;

      const glyphAlpha = clamp01(0.5 - (Math.min(lineDistance - stroke / 2, dot)));
      r += (255 - r) * glyphAlpha;
      g += (255 - g) * glyphAlpha;
      b += (255 - b) * glyphAlpha;

      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(r);
      rgba[offset + 1] = Math.round(g);
      rgba[offset + 2] = Math.round(b);
      rgba[offset + 3] = Math.round(tileAlpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

/* ------------------------------------------------------------------ ICO */

/** Wraps PNGs in an ICO container. Windows accepts PNG-compressed entries. */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;

  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 means 256
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32BE(0, 8);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

/* ----------------------------------------------------------------- main */

mkdirSync(OUT, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const rendered = sizes.map((size) => ({ size, data: renderIcon(size) }));

writeFileSync(path.join(OUT, 'icon.png'), rendered.find((r) => r.size === 256).data);
writeFileSync(path.join(OUT, 'tray.png'), rendered.find((r) => r.size === 32).data);
writeFileSync(path.join(OUT, 'tray@2x.png'), rendered.find((r) => r.size === 64).data);
writeFileSync(path.join(OUT, 'icon.ico'), encodeIco(rendered));

for (const name of ['icon.png', 'tray.png', 'tray@2x.png', 'icon.ico']) {
  console.log('  ' + path.relative(ROOT, path.join(OUT, name)));
}
