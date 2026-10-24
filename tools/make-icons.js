// Generates the app icons (no dependencies). Run: node tools/make-icons.js
// To use your own logo, replace the PNG files in web/icons/ with 192x192, 512x512 and a maskable 512x512 image.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'icons');
mkdirSync(outDir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, { maskable }) {
  const BG = [15, 118, 110];
  const FG = [255, 255, 255];
  const rows = [];
  // Drawing: a white "receipt" with a zig-zag bottom edge and three lines, on a teal square.
  const pad = maskable ? 0.28 : 0.2;
  const left = size * (pad + 0.06);
  const right = size * (1 - pad - 0.06);
  const top = size * pad;
  const bottom = size * (1 - pad);
  const tooth = Math.max(4, size / 24);
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let color = BG;
      const inside = x >= left && x <= right && y >= top && y <= bottom - tooth * (((x - left) / tooth) % 2 < 1 ? 0 : 1) * 0.9;
      if (inside) {
        color = FG;
        const lineH = size * 0.04;
        for (const f of [0.3, 0.45, 0.6]) {
          const ly = size * f;
          const lx1 = left + size * 0.07;
          const lx2 = f === 0.6 ? left + (right - left) * 0.55 : right - size * 0.07;
          if (y >= ly && y <= ly + lineH && x >= lx1 && x <= lx2) color = BG;
        }
      }
      const i = 1 + x * 4;
      row[i] = color[0];
      row[i + 1] = color[1];
      row[i + 2] = color[2];
      row[i + 3] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(join(outDir, 'icon-192.png'), png(192, { maskable: false }));
writeFileSync(join(outDir, 'icon-512.png'), png(512, { maskable: false }));
writeFileSync(join(outDir, 'maskable-512.png'), png(512, { maskable: true }));
console.log('Icons written to', outDir);
