// 生成 PWA 图标（纯 Node + zlib，无需第三方依赖）。
// 设计：深色圆角底色 + 居中蓝色圆点 + 白色 "h" 字形（用像素绘制）。
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "public");

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // 每行前加 filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- 绘制 ----
function inRoundedRect(x, y, size, radius) {
  const r = radius;
  if (x < r && y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r;
  if (x >= size - r && y < r) return (x - (size - r - 1)) ** 2 + (y - r) ** 2 <= r * r;
  if (x < r && y >= size - r) return (x - r) ** 2 + (y - (size - r - 1)) ** 2 <= r * r;
  if (x >= size - r && y >= size - r) return (x - (size - r - 1)) ** 2 + (y - (size - r - 1)) ** 2 <= r * r;
  return true;
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = [18, 20, 34, 255];       // 深蓝黑 #121422
  const accent = [91, 140, 255, 255]; // 蓝 #5B8CFF
  const white = [236, 240, 255, 255];
  const radius = Math.round(size * 0.22);
  const cy = size / 2;
  const barH = size * 0.30;           // "h" 竖杠粗细
  const leftX = size * 0.30;
  const rightX = size * 0.70;
  const midY = cy;
  const topY = size * 0.24;
  const botY = size * 0.76;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 圆角背景
      if (!inRoundedRect(x, y, size, radius)) {
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
        continue;
      }
      const d = Math.hypot(x - cy, y - cy);
      // 居中蓝色圆
      const circleR = size * 0.34;
      const inCircle = d <= circleR;
      // "h" 字形（在圆内挖出白色）：左竖 + 右竖(短) + 中间横
      const bar = barH / 2;
      const leftBar = Math.abs(x - leftX) <= bar && y >= topY && y <= botY;
      const rightBar = Math.abs(x - rightX) <= bar && y >= midY - bar && y <= botY;
      const midBar = y >= midY - bar && y <= midY + bar && x >= leftX - bar && x <= rightX + bar;
      const glyph = leftBar || rightBar || midBar;

      if (inCircle && glyph) {
        rgba[i] = white[0]; rgba[i + 1] = white[1]; rgba[i + 2] = white[2]; rgba[i + 3] = white[3];
      } else if (inCircle) {
        rgba[i] = accent[0]; rgba[i + 1] = accent[1]; rgba[i + 2] = accent[2]; rgba[i + 3] = accent[3];
      } else {
        rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2]; rgba[i + 3] = bg[3];
      }
    }
  }
  return encodePng(size, size, rgba);
}

writeFileSync(join(OUT, "icon-192.png"), makeIcon(192));
writeFileSync(join(OUT, "icon-512.png"), makeIcon(512));
console.log("icons generated");
