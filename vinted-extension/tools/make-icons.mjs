#!/usr/bin/env node
/**
 * make-icons.mjs — Génère les icônes PNG de l'extension (cercle turquoise
 * avec un "V" blanc), sans dépendance externe. Lancer : node tools/make-icons.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Distance d'un point au segment [a,b]. */
function distSeg(px, py, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}
function icon(size) {
  const rows = [];
  const r = size / 2;
  const stroke = size * 0.11;
  for (let y = 0; y < size; y++) {
    const row = [0]; // filtre PNG "none"
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const inCircle = Math.hypot(cx - r, cy - r) <= r - 0.5;
      const v = Math.min(
        distSeg(cx, cy, size * 0.3, size * 0.3, size * 0.5, size * 0.72),
        distSeg(cx, cy, size * 0.7, size * 0.3, size * 0.5, size * 0.72),
      ) < stroke / 2;
      if (!inCircle) row.push(0, 0, 0, 0);
      else if (v) row.push(255, 255, 255, 255);
      else row.push(0, 119, 130, 255);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const out = new URL('../icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(new URL(`icon${s}.png`, out), icon(s));
console.log('Icônes générées dans icons/');
