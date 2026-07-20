// ============================================================
// 小搭 · 角色系统 v6
// builtin — 图集角色（形象库导入的 spritesheet 逐帧动画）
//           布局：8 列 × 9 行，每行一种动作，空格子自动跳过
// custom  — 用户上传图片本地像素化的颜色网格（尺寸自适应）
// ============================================================

// 图集角色清单来自 pets.js（浏览器走全局变量，主进程走 require）
const BUILTIN_CHARS = (typeof SHEET_CHARS !== 'undefined')
  ? SHEET_CHARS
  : require('./pets.js').SHEET_CHARS;

// "状态 → 行号"映射（帧包围盒已在 pets.js 里预计算；空行自动回退到待机行）
const SHEET = {
  STATE_ROWS: { idle: 0, walk: 1, greet: 3, drink: 6, sleep: 5, work: 7, snack: 8 },
};

// ---- 自定义角色用的公共色 ----
const SNACK = '#ffb340';
const LAPTOP = '#8d93a8';
const CUP = '#4fd8a8';

// ---- 网格工具（尺寸自适应） ----
function emptyGrid(n) { return Array.from({ length: n }, () => Array(n).fill(null)); }
function cloneGrid(g) { return g.map((r) => r.slice()); }
function shiftGrid(g, dr) {
  const n = g.length;
  const out = emptyGrid(n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const nr = r + dr;
    if (nr >= 0 && nr < n) out[nr][c] = g[r][c];
  }
  return out;
}
function overlayGrid(g, pixels) {
  const out = cloneGrid(g);
  for (const [r, c, col] of pixels) if (out[r] && c >= 0 && c < out.length) out[r][c] = col;
  return out;
}
function dimColor(col) {
  if (!col) return null;
  const v = parseInt(col.slice(1), 16);
  const f = (x) => Math.round(x * 0.5);
  return '#' + ((f((v >> 16) & 255) << 16) | (f((v >> 8) & 255) << 8) | f(v & 255))
    .toString(16).padStart(6, '0');
}
// 居中绘制：不同尺寸的网格都画在画布正中
function drawGrid(ctx, grid, scale) {
  const n = grid.length;
  const ox = Math.floor((ctx.canvas.width - n * scale) / 2);
  const oy = Math.floor((ctx.canvas.height - n * scale) / 2);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const col = grid[r][c];
    if (col) { ctx.fillStyle = col; ctx.fillRect(ox + c * scale, oy + r * scale, scale, scale); }
  }
}

// ---- 自定义角色：单张颜色网格 → 道具叠加 + 位移（按比例适配任意尺寸） ----
function buildCustomFrames(colorGrid) {
  const n = colorGrid.length;
  const Pr = (f) => Math.round(f * (n - 1));
  const g = cloneGrid(colorGrid);
  const bob = shiftGrid(g, 1);

  const box = (r0, c0, col) => [[r0, c0, col], [r0, c0 + 1, col], [r0 + 1, c0, col], [r0 + 1, c0 + 1, col]];

  const laptop = [];
  for (let r = Pr(0.68); r <= Pr(0.78); r++)
    for (let c = Pr(0.3); c <= Pr(0.7); c++) laptop.push([r, c, LAPTOP]);
  const laptopFlick = laptop.concat([
    [Pr(0.72), Pr(0.4), '#ffffff'], [Pr(0.72), Pr(0.5), '#ffffff'], [Pr(0.72), Pr(0.6), '#ffffff'],
  ]);

  const mouthR = Pr(0.45), mouthC = Pr(0.5);

  const dimmed = g.map((row) => row.map(dimColor));
  const WL = overlayGrid(g, laptop);

  return {
    idle: [g, g, g, g, g, bob],
    walk: [g, bob],
    sleep: [dimmed, shiftGrid(dimmed, 1)],
    work: [WL, WL, WL, overlayGrid(g, laptopFlick)],
    snack: [overlayGrid(g, box(mouthR, mouthC, SNACK)), overlayGrid(g, box(mouthR + 1, mouthC, SNACK))],
    drink: [overlayGrid(g, box(mouthR, mouthC, CUP)), overlayGrid(g, box(mouthR + 1, mouthC, CUP))],
    greet: [shiftGrid(g, -1), g],
  };
}

// 供 main 进程 require 和校验脚本使用
if (typeof module !== 'undefined') {
  module.exports = { BUILTIN_CHARS, SHEET, buildCustomFrames, drawGrid };
}
