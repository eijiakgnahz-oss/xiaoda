// ============================================================
// 小搭 · 角色选择页
// 3 个默认角色 + 自定义角色库（可删）+ 第 4 格透明加号：
// 上传图片 → 本地像素化（16×16 降采样 + 颜色量化，零联网）→ 确认入库
// ============================================================
/* global BUILTIN_CHARS, SHEET, buildCustomFrames, drawGrid */

const $ = (id) => document.getElementById(id);
let selectedId = null;
let pendingGrid = null; // 待确认的像素化结果

// ---------- 渲染角色卡片 ----------
function makeCard({ id, name, preview, sheetChar, deletable }) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = id;

  const cvs = document.createElement('canvas');
  cvs.width = 96; cvs.height = 96;
  if (sheetChar) { // 图集角色：取待机第一帧（精确包围盒）做缩略图
    const img = new Image();
    img.onload = () => {
      const f = sheetChar.rows && sheetChar.rows[0] && sheetChar.rows[0][0];
      if (!f) return;
      const x = cvs.getContext('2d');
      x.imageSmoothingEnabled = false;
      const s = Math.min(96 / f.w, 96 / f.h);
      x.drawImage(img, f.x, f.y, f.w, f.h, (96 - f.w * s) / 2, 96 - f.h * s, f.w * s, f.h * s);
    };
    img.src = sheetChar.sheet;
  } else {
    drawGrid(cvs.getContext('2d'), preview, Math.floor(96 / preview.length));
  }
  card.appendChild(cvs);

  const label = document.createElement('div');
  label.className = 'cname';
  label.textContent = name;
  card.appendChild(label);

  if (deletable) {
    const del = document.createElement('div');
    del.className = 'del';
    del.textContent = '✕';
    del.title = '删除这个角色';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`确定删除「${name}」吗？删除后无法恢复。`)) return;
      await window.xiaoda.deleteCharacter(id);
      if (selectedId === id) { selectedId = null; $('btn-ok').disabled = true; }
      render();
    });
    card.appendChild(del);
  }

  card.addEventListener('click', () => {
    selectedId = id;
    document.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', c.dataset.id === id));
    $('btn-ok').disabled = false;
  });
  return card;
}

async function render() {
  const grid = $('grid');
  grid.innerHTML = '';

  const { customChars, selectedId: saved } = await window.xiaoda.getCharacters();
  if (!selectedId && saved) selectedId = saved;

  // 内置角色（形象库图集）
  for (const c of BUILTIN_CHARS) {
    grid.appendChild(makeCard({ id: c.id, name: c.name, sheetChar: c, deletable: false }));
  }
  // 用户生成的角色（可删除）
  for (const c of customChars) {
    grid.appendChild(makeCard({ id: c.id, name: c.name, preview: c.grid, deletable: true }));
  }
  // 第 4 格起：透明加号卡片
  const plus = document.createElement('div');
  plus.className = 'card plus';
  plus.innerHTML = '<div class="plus-sign">＋</div><div class="cname">上传图片生成</div>';
  plus.addEventListener('click', () => $('file-input').click());
  grid.appendChild(plus);

  // 恢复选中态
  if (selectedId) {
    const cur = document.querySelector(`.card[data-id="${selectedId}"]`);
    if (cur) { cur.classList.add('selected'); $('btn-ok').disabled = false; }
    else selectedId = null;
  }
}

// ---------- 上传图片 → 本地像素化 ----------
// 原理：把图片居中裁成正方形，用 canvas 缩到 48×48（降采样），
// 再把每个像素的颜色量化到 16 级台阶（像素画的"色块感"），透明像素保留透明
const PX = 48;
function pixelate(img) {
  const off = document.createElement('canvas');
  off.width = PX; off.height = PX;
  const octx = off.getContext('2d');
  const s = Math.min(img.width, img.height);
  const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
  octx.drawImage(img, sx, sy, s, s, 0, 0, PX, PX);

  const data = octx.getImageData(0, 0, PX, PX).data;
  const q = (v) => Math.min(255, Math.round(v / 16) * 16);
  const out = [];
  for (let r = 0; r < PX; r++) {
    const row = [];
    for (let c = 0; c < PX; c++) {
      const i = (r * PX + c) * 4;
      if (data[i + 3] < 64) { row.push(null); continue; }
      const hex = '#' + ((q(data[i]) << 16) | (q(data[i + 1]) << 8) | q(data[i + 2]))
        .toString(16).padStart(6, '0');
      row.push(hex);
    }
    out.push(row);
  }
  return out;
}

// ---------- 纯色背景抠图（零联网） ----------
// 原理：取图片四角的颜色当"背景参考色"，从边缘做泛洪填充，
// 把所有与背景色相近、且与边缘连通的像素抹成透明——主体（人物/宠物）保留
function removeBackground(grid) {
  const n = grid.length;
  const rgb = (hex) => hex ? [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] : null;
  const refs = [[0, 0], [0, n - 1], [n - 1, 0], [n - 1, n - 1]]
    .map(([r, c]) => rgb(grid[r][c])).filter(Boolean);
  if (!refs.length) return grid; // 四角全透明：本来就是抠好的图
  const isBg = (hex) => {
    const p = rgb(hex);
    if (!p) return false;
    return refs.some((q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < 120);
  };
  const seen = Array.from({ length: n }, () => Array(n).fill(false));
  const queue = [];
  for (let i = 0; i < n; i++) {
    for (const [r, c] of [[0, i], [n - 1, i], [i, 0], [i, n - 1]]) {
      if (!seen[r][c] && isBg(grid[r][c])) { seen[r][c] = true; queue.push([r, c]); }
    }
  }
  while (queue.length) {
    const [r, c] = queue.pop();
    grid[r][c] = null;
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && !seen[nr][nc] && isBg(grid[nr][nc])) {
        seen[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }
  return grid;
}

$('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    pendingGrid = removeBackground(pixelate(img));
    const gcv = $('gen-cv');
    gcv.width = PX * 6; gcv.height = PX * 6;
    drawGrid(gcv.getContext('2d'), pendingGrid, 6);
    $('gen-name').value = '';
    $('gen-mask').classList.remove('hidden');
    $('gen-name').focus();
  };
  img.onerror = () => alert('这张图片读取失败，换一张试试？');
  img.src = URL.createObjectURL(file);
});

$('gen-ok').addEventListener('click', async () => {
  if (!pendingGrid) return;
  const name = $('gen-name').value.trim() || '自定义小人';
  const res = await window.xiaoda.addCharacter({ name, grid: pendingGrid });
  $('gen-mask').classList.add('hidden');
  pendingGrid = null;
  if (res.error) { alert(res.error); return; }
  selectedId = res.id; // 新生成的自动选中
  await render();
  $('btn-ok').disabled = false;
});
$('gen-cancel').addEventListener('click', () => {
  pendingGrid = null;
  $('gen-mask').classList.add('hidden');
});

// ---------- 确定 / 关闭 ----------
$('btn-ok').addEventListener('click', async () => {
  if (!selectedId) return;
  const res = await window.xiaoda.chooseCharacter(selectedId);
  if (res && res.error) alert(res.error);
  // 成功时主进程会开桌宠窗口并关掉本页
});
$('btn-close').addEventListener('click', () => window.xiaoda.closeSelector());

render();
