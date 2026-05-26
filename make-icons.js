'use strict';
// Generates PWA icons as minimal PNG files (no external deps)
// Uses pure Node.js Buffer to write valid PNG files

const fs = require('fs');
const path = require('path');

// Minimal PNG generator using raw deflate
const zlib = require('zlib');

function makePNG(size) {
  const w = size, h = size;
  const channels = 4; // RGBA

  // Create pixel buffer
  const pixels = Buffer.alloc(w * h * channels);

  // Background color: #0d1117 (dark)
  const bg   = [13, 17, 23, 255];
  // Card color: #1f3a5f
  const card = [31, 58, 95, 255];
  // Blue bar: #3b82f6
  const blue = [59, 130, 246, 255];
  // Green bar: #22c55e
  const green = [34, 197, 94, 255];
  // Line color: #58a6ff
  const line = [88, 166, 255, 255];

  function setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = (y * w + x) * channels;
    pixels[idx]     = color[0];
    pixels[idx + 1] = color[1];
    pixels[idx + 2] = color[2];
    pixels[idx + 3] = color[3];
  }

  function fillRect(x0, y0, x1, y1, color) {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        setPixel(x, y, color);
  }

  function drawLine(x0, y0, x1, y1, color, thick) {
    const dx = Math.abs(x1-x0), dy = Math.abs(y1-y0);
    const sx = x0<x1?1:-1, sy = y0<y1?1:-1;
    let err = dx-dy, x=x0, y=y0;
    while(true) {
      for(let tx=-thick; tx<=thick; tx++)
        for(let ty=-thick; ty<=thick; ty++)
          setPixel(x+tx, y+ty, color);
      if(x===x1&&y===y1) break;
      const e2=2*err;
      if(e2>-dy){err-=dy;x+=sx;}
      if(e2< dx){err+=dx;y+=sy;}
    }
  }

  // Fill background
  fillRect(0, 0, w, h, bg);

  // Card
  const pad = Math.round(w * 0.1);
  fillRect(pad, pad, w-pad, h-pad, card);

  // Bars
  const barData = [0.55, 0.75, 0.45, 0.9, 0.65];
  const bw      = Math.round(w * 0.1);
  const gap     = Math.round(w * 0.04);
  const startX  = Math.round(w * 0.18);
  const baseY   = Math.round(h * 0.75);
  const maxBarH = Math.round(h * 0.45);

  const barTops = [];
  barData.forEach((frac, i) => {
    const bh = Math.round(maxBarH * frac);
    const x  = startX + i * (bw + gap);
    const y  = baseY - bh;
    barTops.push({ x: x + Math.round(bw/2), y });
    fillRect(x, y, x + bw, baseY, i === 3 ? green : blue);
  });

  // Line connecting bar tops
  const thick = Math.max(1, Math.round(w * 0.012));
  for (let i = 0; i < barTops.length - 1; i++) {
    drawLine(barTops[i].x, barTops[i].y, barTops[i+1].x, barTops[i+1].y, line, thick);
  }

  // Build PNG
  function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const crcData = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcData));
    return Buffer.concat([len, t, data, crc]);
  }

  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8]=8; ihdr[9]=2; // 8-bit RGB — wait we have 4 channels
  // Use RGBA: color type 6
  ihdr[9] = 6;
  ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;

  // Build raw image data (filter byte 0 per row) using RGBA
  const rowSize = 1 + w * 4;
  const raw = Buffer.alloc(h * rowSize);
  for (let y = 0; y < h; y++) {
    raw[y * rowSize] = 0; // filter None
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = y * rowSize + 1 + x * 4;
      raw[dst]   = pixels[src];
      raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2];
      raw[dst+3] = pixels[src+3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

['192','512'].forEach(s => {
  const size = parseInt(s);
  const buf  = makePNG(size);
  const p    = path.join(__dirname, 'public', `icon-${s}.png`);
  fs.writeFileSync(p, buf);
  console.log(`icon-${s}.png  (${buf.length} bytes)`);
});
