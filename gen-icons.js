/* gen-icons.js — 生成简单的 PNG 图标（白底下载箭头 + 橙色圆角底）
 * 用 Node 内置 zlib 手写 PNG，不依赖任何包。
 * 运行：node gen-icons.js
 */
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function makePng(size, pixels /* RGBA Buffer, size*size*4 */) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const orange = [255, 107, 53, 255];
  const white = [255, 255, 255, 255];
  const transparent = [0, 0, 0, 0];
  const r = size * 0.22; // 圆角半径
  const set = (x, y, c) => {
    const i = (y * size + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
  };
  // 圆角矩形底
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 距四角的距离用于圆角
      let cx = x, cy = y;
      const rx = Math.min(x, size - 1 - x), ry = Math.min(y, size - 1 - y);
      let inside = true;
      if (rx < r && ry < r) {
        const dx = r - rx, dy = r - ry;
        if (dx * dx + dy * dy > r * r) inside = false;
      }
      set(x, y, inside ? orange : transparent);
    }
  }
  // 画下载箭头（白色）：垂直线 + V 头 + 下划线
  // 归一化坐标 0..1
  const arrowW = size * 0.16;    // 箭杆宽度的一半
  const cx = size / 2;
  const top = size * 0.26;       // 箭杆顶端 y
  const vBot = size * 0.58;      // 箭杆底端 y（V 起点）
  const vTip = size * 0.74;      // V 尖端 y
  const vHalf = size * 0.20;     // V 半宽
  const barY1 = size * 0.80, barY2 = size * 0.86;
  const barHalf = size * 0.30;

  const fillWhite = (x, y) => {
    // 只覆盖橙色区域内的点
    const i = (Math.floor(y) * size + Math.floor(x)) * 4;
    if (px[i + 3] === 255) { px[i] = white[0]; px[i + 1] = white[1]; px[i + 2] = white[2]; }
  };

  // 箭杆（粗矩形）
  for (let y = top; y <= vBot; y++) {
    for (let x = cx - arrowW; x <= cx + arrowW; x++) fillWhite(x, y);
  }
  // V 头：两条斜线（左上到中下、右上到中下）
  for (let t = 0; t <= 1; t += 1 / size) {
    // 左斜：从 (cx - vHalf, vBot) 到 (cx, vTip)
    let x = (cx - vHalf) + (cx - (cx - vHalf)) * t;
    let y = vBot + (vTip - vBot) * t;
    for (let w = -arrowW; w <= arrowW; w += 1) fillWhite(x + w, y);
    // 右斜：从 (cx + vHalf, vBot) 到 (cx, vTip)
    x = (cx + vHalf) + (cx - (cx + vHalf)) * t;
    y = vBot + (vTip - vBot) * t;
    for (let w = -arrowW; w <= arrowW; w += 1) fillWhite(x + w, y);
  }
  // 底部托盘横条
  for (let y = barY1; y <= barY2; y++) {
    for (let x = cx - barHalf; x <= cx + barHalf; x++) fillWhite(x, y);
  }
  return makePng(size, px);
}

const outDir = path.join(__dirname, "icons");
fs.mkdirSync(outDir, { recursive: true });
[16, 32, 48, 128].forEach((s) => {
  const buf = drawIcon(s);
  fs.writeFileSync(path.join(outDir, `icon-${s}.png`), buf);
  console.log("wrote icons/icon-" + s + ".png (" + buf.length + " bytes)");
});
