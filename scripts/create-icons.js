#!/usr/bin/env node
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([len, t, d, crc]);
}

function createIcon(size) {
  const cx = size / 2, cy = size / 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(0); // filter None
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      const ro = size * 0.47, ri = size * 0.36;
      if (d <= ro) {
        // Circle fill: dark green gradient top→bottom
        const t  = y / size;
        const g  = Math.floor(255 - 80 * t);
        const b  = Math.floor(136 - 100 * t);
        // Inner ring slightly lighter
        const r  = d < ri ? 20 : 10;
        rows.push(r, g, b, 255);
      } else {
        rows.push(10, 10, 10, 255); // dark bg
      }
    }
  }

  const raw  = Buffer.from(rows);
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const dir = path.join(__dirname, '..', 'electron', 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), createIcon(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), createIcon(512));
console.log('✓ Icons created:', dir);
