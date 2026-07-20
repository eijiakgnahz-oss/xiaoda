// ============================================================
// 小搭 · 渲染进程主逻辑
// ① 像素动画引擎  ② 作息状态机（读系统时间）  ③ 问候 + 吃饭/休息提醒
// ④ 点击弹出系统信息面板  ⑤ 聊天窗（走主进程调用户自选模型）
// ⑥ 鼠标穿透管理 + 拖拽 + 散步/缩放
// ============================================================
/* global BUILTIN_CHARS, SHEET, buildCustomFrames, drawGrid */

const $ = (id) => document.getElementById(id);

// ---------------- ① 像素动画引擎 ----------------
const PET_PX = 160; // 32×32 角色 ×5 倍；旧 16/24 自定义网格按整数倍居中绘制
const cv = $('cv');
cv.width = PET_PX;
cv.height = PET_PX;
const ctx = cv.getContext('2d');
const petmotion = $('petmotion');

let state = 'idle';     // idle | sleep | work | snack | drink | greet
let frameIdx = 0;
let FRAMES = null;      // 启动时根据用户选择的角色构建

// 图集角色加载：帧包围盒已由 pets.js 预计算，这里只做状态映射和统一缩放基准
function loadSheetFrames(char) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const rows = char.rows || [];
      let maxW = 1, maxH = 1;
      for (const r of rows) for (const f of r) {
        if (f.w > maxW) maxW = f.w;
        if (f.h > maxH) maxH = f.h;
      }
      const states = {};
      for (const [k, row] of Object.entries(SHEET.STATE_ROWS)) {
        states[k] = (rows[row] && rows[row].length) ? rows[row] : (rows[0] || []);
      }
      resolve({ sheet: true, img, states, maxW, maxH });
    };
    img.onerror = () => resolve(null);
    img.src = char.sheet;
  });
}

async function initCharacter() {
  const sel = await window.xiaoda.getSelected();
  charName = sel.name || (BUILTIN_CHARS.find((x) => x.id === sel.id) || {}).name || '小搭';
  if (sel.type === 'custom') {
    FRAMES = buildCustomFrames(sel.grid);
  } else {
    const c = BUILTIN_CHARS.find((x) => x.id === sel.id) || BUILTIN_CHARS[0];
    FRAMES = await loadSheetFrames(c);
  }
  drawFrame();
  // 聊天室左下角的小头像
  const mini = $('mini-cv');
  if (!mini || !FRAMES) return;
  if (FRAMES.sheet) {
    mini.width = 48; mini.height = 48;
    const f = FRAMES.states.idle[0];
    const mctx = mini.getContext('2d');
    mctx.imageSmoothingEnabled = false;
    const ms = Math.min(48 / f.w, 48 / f.h);
    mctx.drawImage(FRAMES.img, f.x, f.y, f.w, f.h,
      (48 - f.w * ms) / 2, 48 - f.h * ms, f.w * ms, f.h * ms);
  } else {
    const g = FRAMES.idle[0];
    mini.width = g.length * 2;
    mini.height = g.length * 2;
    drawGrid(mini.getContext('2d'), g, 2);
  }
}

function drawFrame() {
  if (!FRAMES) return;
  if (FRAMES.sheet) { // 图集角色：按包围盒逐帧绘制，全角色统一缩放基准、贴地居中
    const frames = FRAMES.states[state] || FRAMES.states.idle;
    const f = frames[frameIdx % frames.length];
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    const s = Math.min(cv.width / FRAMES.maxW, cv.height / FRAMES.maxH);
    const dw = f.w * s, dh = f.h * s;
    ctx.drawImage(FRAMES.img, f.x, f.y, f.w, f.h, (cv.width - dw) / 2, cv.height - dh, dw, dh);
    return;
  }
  const frames = FRAMES[state] || FRAMES.idle;
  const g = frames[frameIdx % frames.length];
  drawGrid(ctx, g, Math.floor(PET_PX / g.length));
}
setInterval(() => { frameIdx++; drawFrame(); }, 300);

// ---------------- 气泡 ----------------
let bubbleTimer = null;
function bubble(text, ms = 6000) {
  const el = $('bubble');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------------- 关怀语料库 ----------------
let charName = '小搭'; // 当前角色名，所有问候语以此自称

// ---------------- 语料库（按场景分类） ----------------
const LINES = {
  daily: [ // 日常问候
    '你回来啦，我一直在这里等你。',
    '今天也辛苦啦，先休息一下吧。',
    '见到你真好，今天过得怎么样？',
    '不着急，慢慢来就好。',
    '欢迎回来，这里一直为你留着位置。',
    '今天也要对自己温柔一点。',
    '我来陪你一会儿吧。',
    '不管今天发生了什么，你已经做得很好了。',
  ],
  morning: [ // 早晨问候
    '早上好，新的一天开始啦。',
    '睡醒了吗？记得先喝一点水。',
    '今天也会有一些小小的好事发生。',
    '早安，希望你今天一切顺利。',
    '慢慢醒来，不用急着开始忙碌。',
    '新的一天，我也会陪着你。',
    '今天也请带着轻松的心情出发吧。',
  ],
  work: [ // 工作陪伴
    '忙了这么久，要不要休息一会儿？',
    '别忘了眨眨眼睛，看看远处。',
    '一点一点来，你正在慢慢接近目标。',
    '已经很努力了，不用把自己逼得太紧。',
    '喝口水吧，我会帮你看着时间。',
    '遇到困难也没关系，我们慢慢解决。',
    '现在的你，已经比刚开始进步很多了。',
    '专注很重要，但你的身体也很重要。',
  ],
  comfort: [ // 情绪安慰
    '今天是不是有点累？我陪你安静一会儿。',
    '不开心的时候，也不用假装没事。',
    '没关系，偶尔脆弱一下也可以。',
    '你不需要一直坚强。',
    '有些事情暂时没有答案，也没关系。',
    '今天过得不好，不代表你不好。',
    '先抱抱自己吧，剩下的事情明天再说。',
    '我不知道该怎么让你开心，但我愿意陪着你。',
    '难过可以慢慢消化，不用急着振作。',
  ],
  encourage: [ // 鼓励提醒
    '相信自己一点，你比想象中更厉害。',
    '能走到这里，已经很不容易了。',
    '今天完成一点点，也值得被表扬。',
    '不用和别人比较，按照自己的节奏就好。',
    '做不到完美也没关系，完成就很棒。',
    '你走的每一步，都算数。',
    '再坚持一小会儿，然后好好休息。',
    '你可以慢一点，但不要忘记肯定自己。',
  ],
  night: [ // 晚间问候
    '天色不早啦，今天辛苦了。',
    '该休息啦，剩下的事情明天再做。',
    '晚安，希望你今晚做个轻松的梦。',
    '今天已经结束了，不开心的事情先放下吧。',
    '好好睡一觉，明天又是新的开始。',
    '夜晚是用来休息的，不是用来责怪自己的。',
    '关掉烦恼，盖好被子，我陪你说晚安。',
    '今天也平安度过啦，晚安。',
  ],
  cute: [ // 可爱语气
    '检测到你有点累，需要补充一点抱抱能量。',
    '今日陪伴任务已开启，我会一直待在这里。',
    '你负责认真生活，我负责悄悄陪你。',
    '别皱眉啦，我把今天的小幸运分给你一点。',
    '发现一只努力的人类，正在申请夸奖。',
    '今日份温柔已送达，请记得签收。',
    '休息不是偷懒，是在给自己充电。',
    '不许偷偷难过太久，我会担心的。',
    '你一出现，我的桌面都变得热闹了。',
    '无论你忙不忙，我都会在这里陪着你。',
  ],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 按当前场景选台词池：工作时说工作陪伴，深夜偏安慰/晚安，白天在可爱/鼓励/日常/安慰间轮转
function carePool() {
  if (state === 'work') return LINES.work;
  const h = new Date().getHours();
  if (h >= 21) return Math.random() < 0.5 ? LINES.night : LINES.comfort;
  const r = Math.random();
  if (r < 0.35) return LINES.cute;
  if (r < 0.6) return LINES.encourage;
  if (r < 0.85) return LINES.daily;
  return LINES.comfort;
}
// 关怀消息：头顶像素消息框
function care(text, ms = 9000) {
  bubble(text, ms);
}

// 不经意的嘘寒问暖：首次上线 1 分钟左右来一句，之后每 5~12 分钟随机一句
function scheduleCare(first) {
  const delay = first ? (45 + Math.random() * 45) * 1000 : (5 + Math.random() * 7) * 60 * 1000;
  setTimeout(() => {
    if (!isSleepTime() && !dragging) {
      care(pick(carePool()));
      if (!greetLock) { // 说话时挥挥手，更有生气
        setState('greet');
        setTimeout(() => { if (state === 'greet') setState(isSleepTime() ? 'sleep' : activity); }, 4000);
      }
    }
    scheduleCare(false);
  }, delay);
}

// ---------------- ② 作息状态机 ----------------
// 00:00–08:00、22:00–24:00 睡觉；其余时间在 工作/吃零食/喝水/待机 间轮换
let activity = 'work';
let nextSwitch = 0;
let greetLock = false; // 问候动画期间不被轮换打断

function isSleepTime(d = new Date()) {
  const h = d.getHours();
  return h >= 22 || h < 8;
}
function setState(s) {
  state = s;
  frameIdx = 0;
  petmotion.classList.toggle('sleeping', s === 'sleep'); // 睡觉时呼吸更深更慢
  drawFrame();
}

function tick() {
  const now = new Date();
  if (isSleepTime(now)) {
    if (state !== 'sleep') {
      setState('sleep');
      $('zzz').classList.remove('hidden');
      bubble(`到点啦，${charName}去睡觉了 zZ…${pick(LINES.night)}`);
    }
    return;
  }
  $('zzz').classList.add('hidden');
  if (state === 'sleep') { setState('idle'); bubble(`${charName}醒来啦！${pick(LINES.morning)}`); }

  if (Date.now() > nextSwitch) {
    const pool = ['work', 'work', 'idle', 'walk', 'walk', 'snack', 'drink'];
    activity = pool[Math.floor(Math.random() * pool.length)];
    nextSwitch = Date.now() + (8 + Math.random() * 7) * 60 * 1000; // 8~15 分钟换一个动作
    if (!greetLock) setState(activity);
  }
  // 醒着时偶尔开心地蹦一下
  if (!greetLock && state !== 'walk' && Math.random() < 0.3) {
    petmotion.classList.add('hop');
    setTimeout(() => petmotion.classList.remove('hop'), 950);
  }
  checkGreetings(now);
  checkReminders(now);
}
setInterval(tick, 30 * 1000);

// ---------------- ③ 问候（早/中/晚各一次）+ 提醒 ----------------
const GREET_SLOTS = [
  { id: 'morning', from: 8, to: 11, pool: 'morning' },
  { id: 'noon', from: 11.5, to: 13.5, pool: 'daily' },
  { id: 'evening', from: 18, to: 21, pool: 'night' },
];
function todayKey(id) {
  const d = new Date();
  return `greet-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${id}`;
}
function playGreet(text) {
  greetLock = true;
  setState('greet');
  care(text, 8000);
  setTimeout(() => {
    greetLock = false;
    if (!isSleepTime()) setState(activity);
  }, 6000);
}
function checkGreetings(now) {
  const h = now.getHours() + now.getMinutes() / 60;
  for (const s of GREET_SLOTS) {
    if (h >= s.from && h < s.to && !localStorage.getItem(todayKey(s.id))) {
      localStorage.setItem(todayKey(s.id), '1');
      playGreet(pick(LINES[s.pool]));
      break;
    }
  }
}

let lastRest = Date.now();
let customReminders = [];  // 通过聊天设置的自定义提醒（s14）
function checkReminders(now) {
  const h = now.getHours(), m = now.getMinutes();
  // 自定义提醒：到点弹消息框，单次提醒触发后即删除
  window.xiaoda.getReminders().then((l) => { customReminders = l; }).catch(() => {});
  const dkey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  for (const rm of customReminders) {
    const [hh, mm] = String(rm.time).split(':').map(Number);
    const fired = `crem-${rm.id}-${dkey}`;
    if (h === hh && m >= mm && m < mm + 2 && !localStorage.getItem(fired)) {
      localStorage.setItem(fired, '1');
      care('⏰ ' + rm.text, 12000);
      if (rm.repeat === 'once') window.xiaoda.removeReminder(rm.id);
    }
  }
  // 每日行业情报：每天上午 10 点强提醒一次，内容等用户来聊天室要（不打扰原则）
  if (h === 10 && m < 2 && !localStorage.getItem(`brief-${dkey}`)) {
    window.xiaoda.getConfig().then((c) => {
      const topics = [c.profession, ...(c.interests || [])].filter(Boolean);
      if (!topics.length || localStorage.getItem(`brief-${dkey}`)) return;
      localStorage.setItem(`brief-${dkey}`, '1');
      care(`📮 ${topics.slice(0, 3).join('、')}的今日新鲜事我备好啦！来聊天室对我说「看今日情报」～`, 15000);
    }).catch(() => {});
  }
  // 饭点提醒（每天一次）
  if (h === 12 && m < 2 && !localStorage.getItem(todayKey('lunch'))) {
    localStorage.setItem(todayKey('lunch'), '1');
    care('🍚 12 点啦！放下工作去吃饭～', 10000);
  }
  if (h === 18 && m < 2 && !localStorage.getItem(todayKey('dinner'))) {
    localStorage.setItem(todayKey('dinner'), '1');
    care('🍜 晚饭时间到！吃饱了才有力气～', 10000);
  }
  // 每 50 分钟提醒休息
  if (Date.now() - lastRest > 50 * 60 * 1000) {
    lastRest = Date.now();
    care('👀 盯屏幕好久了，起来走走、看看远处吧！', 10000);
  }
}

// ---------------- ⑦ 鼠标穿透管理 ----------------
// 窗口默认对鼠标"隐形"；指到小人/面板上时才接管鼠标
let ignored = true;
window.addEventListener('mousemove', (e) => {
  if (dragging) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const hit = !!(el && el.closest('.hit'));
  if (hit === ignored) {
    ignored = !hit;
    window.xiaoda.setIgnoreMouse(!hit);
  }
});

// ---------------- 拖拽 + 点击判定 ----------------
let dragging = false, moved = 0, lastX = 0, lastY = 0;
const pet = $('pet');
pet.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true; moved = 0;
  lastX = e.screenX; lastY = e.screenY;
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastX, dy = e.screenY - lastY;
  lastX = e.screenX; lastY = e.screenY;
  moved += Math.abs(dx) + Math.abs(dy);
  window.xiaoda.moveBy(dx, dy);
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  if (moved < 6) { // 几乎没动 → 视为点击：弹性挤压 + 开关面板
    petmotion.classList.add('boing');
    setTimeout(() => petmotion.classList.remove('boing'), 500);
    togglePanels();
  }
});

// ---------------- 散步（walk 状态时在窗口内左右溜达） ----------------
let walkX = 0, walkTarget = 0;
function applyPetTransform() { pet.style.transform = `translateX(${walkX}px)`; }
setInterval(() => {
  const chatOpen = !$('chatbox').classList.contains('hidden');
  if (dragging) return;
  if (state !== 'walk' || panelsOpen || chatOpen) {
    if (walkX !== 0) { // 非散步状态：缓缓走回中心
      walkX *= 0.85;
      if (Math.abs(walkX) < 1) { walkX = 0; cv.style.transform = ''; }
      applyPetTransform();
    }
    return;
  }
  if (Math.abs(walkTarget - walkX) < 2) walkTarget = Math.random() * 180 - 90;
  const dir = walkTarget > walkX ? 1 : -1;
  walkX += dir * 1.3;
  cv.style.transform = dir < 0 ? 'scaleX(-1)' : ''; // 面朝行走方向
  applyPetTransform();
}, 50);

// ---------------- 缩放（悬停小人右上角的 ＋/－） ----------------
let petScale = parseFloat(localStorage.getItem('pet-scale') || '1');
function applyScale() {
  const px = Math.round(160 * petScale);
  pet.style.width = px + 'px';
  pet.style.height = px + 'px';
  pet.style.left = (320 - px / 2) + 'px';  // 脚底位置不变，横向居中
  pet.style.top = (360 - px) + 'px';
  $('bubble').style.top = (360 - px - 64) + 'px';
  $('zzz').style.top = (360 - px - 12) + 'px';
}
function setScale(s) {
  petScale = Math.min(1.5, Math.max(0.5, Math.round(s * 100) / 100));
  localStorage.setItem('pet-scale', String(petScale));
  applyScale();
}
for (const [id, delta] of [['zoom-in', 0.25], ['zoom-out', -0.25]]) {
  $(id).addEventListener('mousedown', (e) => e.stopPropagation()); // 不触发拖拽
  $(id).addEventListener('click', (e) => { e.stopPropagation(); setScale(petScale + delta); });
}
applyScale();

// 右键菜单
pet.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  $('ctxmenu').classList.toggle('hidden');
});
$('mi-quit').addEventListener('click', () => window.xiaoda.quit());
$('mi-switch').addEventListener('click', () => window.xiaoda.openSelector());

// ---------------- ④ 系统信息面板 ----------------
let panelsOpen = false, statsTimer = null;
function fmtGB(n) { return n >= 100 ? Math.round(n) + ' GB' : n.toFixed(1) + ' GB'; }

function claudeText(cl) {
  if (!cl || !cl.found) return '未找到会话记录\n这台电脑还没用过 Claude Code';
  if (!cl.active) return '会话空闲\n暂无用量数据';
  const blocks = Math.min(10, Math.round(cl.ctxPct / 10));
  const bar = '▮'.repeat(blocks) + '▯'.repeat(10 - blocks);
  const mins = Math.round((Date.now() - cl.mtimeMs) / 60000);
  const when = mins < 2 ? '● 正在活跃' : `○ ${mins} 分钟前活跃`;
  const model = (cl.model || '未知模型').replace(/^claude-/, '');
  return `上下文 ${cl.ctxPct}%\n${bar} ${Math.round(cl.ctxTokens / 1000)}k / 200k\n${model}\n输出 ${(cl.outSum / 1000).toFixed(1)}k tokens\n${when}`;
}

async function refreshStats() {
  try {
    const [s, cl] = await Promise.all([window.xiaoda.getStats(), window.xiaoda.getClaudeStats()]);
    $('p-claude').querySelector('.p-body').textContent = claudeText(cl);
    $('p-cpu').querySelector('.p-body').textContent = `使用率 ${s.cpu.usage}%\n${s.cpu.cores} 核心`;
    $('p-mem').querySelector('.p-body').textContent = `已用 ${fmtGB(s.mem.used)}\n共 ${fmtGB(s.mem.total)}`;
    $('p-disk').querySelector('.p-body').textContent = s.disk
      ? `已用 ${fmtGB(s.disk.used)}\n共 ${fmtGB(s.disk.total)}`
      : '读取失败';
    $('p-batt').querySelector('.p-body').textContent = s.battery.has
      ? `电量 ${s.battery.pct}%\n${s.battery.charging ? '⚡ 充电中' : '🔋 使用电池'}`
      : '无电池（台式机）';
    $('p-net').querySelector('.p-body').textContent = s.net.online
      ? `已连接 ${s.net.wifi !== '—' ? s.net.wifi : ''}\nIP ${s.net.ip}`
      : '未连接网络';
  } catch { /* 面板读取失败不影响小人 */ }
}
function togglePanels() {
  $('ctxmenu').classList.add('hidden');
  if (!$('chatbox').classList.contains('hidden')) { closeChat(); return; }
  panelsOpen = !panelsOpen;
  $('panels').classList.toggle('hidden', !panelsOpen);
  clearInterval(statsTimer);
  if (panelsOpen) {
    refreshStats();
    statsTimer = setInterval(refreshStats, 2500);
  }
}

// ---------------- ⑤ 聊天窗 ----------------
const chatHistory = []; // [{role, content}]
function addMsg(kind, text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + kind;
  if (kind === 'pet') {
    const nm = document.createElement('div');
    nm.className = 'name';
    nm.textContent = charName;
    wrap.appendChild(nm);
  }
  const t = document.createElement('div');
  t.className = 'txt';
  t.textContent = text;
  wrap.appendChild(t);
  $('chat-msgs').appendChild(wrap);
  $('chat-msgs').scrollTop = $('chat-msgs').scrollHeight;
  return t;
}
function openChat() {
  panelsOpen = false;
  $('panels').classList.add('hidden');
  clearInterval(statsTimer);
  $('chatbox').classList.remove('hidden');
  $('chat-input').focus();
  if (!$('chat-msgs').children.length) {
    addMsg('pet', `你好呀，我是${charName}！桌宠动画、问候提醒和系统信息不用模型配置；聊天、联网搜索、打开应用/网页、文件操作、记忆、对话设提醒和今日情报，需要先点右上角 ⚙ 填入你自己的 API 地址、模型名和 API Key。`);
  }
}
function closeChat() { $('chatbox').classList.add('hidden'); }
$('p-chat').addEventListener('click', openChat);
$('btn-chat-close').addEventListener('click', closeChat);

const PROVIDER_PRESETS = {
  deepseek: { apiUrl: 'https://api.deepseek.com/chat/completions' },
  openrouter: { apiUrl: 'https://openrouter.ai/api/v1/chat/completions' },
  openai: { apiUrl: 'https://api.openai.com/v1/chat/completions' },
};

function showModelSettings(show = true) {
  $('settings-row').classList.toggle('hidden', !show);
}

async function hydrateModelSettings() {
  const cfg = await window.xiaoda.getConfig();
  $('api-url-input').value = cfg.apiUrl || '';
  $('model-input').value = cfg.model || '';
  $('key-input').value = '';
  return cfg;
}

$('provider-select').addEventListener('change', () => {
  const preset = PROVIDER_PRESETS[$('provider-select').value];
  if (!preset) return;
  $('api-url-input').value = preset.apiUrl;
});

$('btn-settings').addEventListener('click', async () => {
  await hydrateModelSettings();
  showModelSettings(true);
});
$('btn-cancel-settings').addEventListener('click', () => showModelSettings(false));

// 设置用户自己的 OpenAI 兼容模型配置
$('btn-save-key').addEventListener('click', async () => {
  const apiUrl = $('api-url-input').value.trim();
  const model = $('model-input').value.trim();
  const apiKey = $('key-input').value.trim();
  if (!apiUrl || !model) {
    addMsg('sys', '请先填写 API 地址和模型名');
    return;
  }
  const cfg = await window.xiaoda.getConfig();
  if (!cfg.hasKey && !apiKey) {
    addMsg('sys', '请填入你自己的 API Key');
    return;
  }
  await window.xiaoda.saveConfig({ apiKey, apiUrl, model });
  $('key-input').value = '';
  showModelSettings(false);
  addMsg('sys', `✓ 模型配置已保存：${model}`);
});

// 发送消息
let sending = false;
async function send() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text || sending) return;
  input.value = '';
  addMsg('user', text);
  chatHistory.push({ role: 'user', content: text });
  if (chatHistory.length > 20) chatHistory.splice(0, chatHistory.length - 20);

  sending = true;
  const thinking = addMsg('sys', `${charName}思考中…`);
  const res = await window.xiaoda.chat([...chatHistory]);
  thinking.parentElement.remove();
  sending = false;

  if (res.error === 'no_model_config') {
    await hydrateModelSettings();
    showModelSettings(true);
    addMsg('pet', '我还没有可用的大脑配置呢。请选择服务模板或填写接口地址，再填入你自己的模型名和 API Key；保存后就能使用聊天和助理功能啦。');
    return;
  }
  if (res.error) {
    addMsg('sys', '⚠ ' + res.error);
    return;
  }
  if (res.actions && res.actions.length) {
    addMsg('sys', '🔧 ' + res.actions.join('\n🔧 '));
  }
  addMsg('pet', res.reply);
  chatHistory.push({ role: 'assistant', content: res.reply });
}
$('btn-send').addEventListener('click', send);
$('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

// ---------------- 启动 ----------------
// 清理过期的"今日已触发"标记（问好/饭点/情报/自定义提醒按天生成，防止无限堆积）
function pruneDatedKeys() {
  const d = new Date();
  const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (/^(greet-|crem-|brief-)/.test(k) && !k.includes(today)) localStorage.removeItem(k);
  }
}

(async () => {
  pruneDatedKeys();
  await initCharacter();
  tick();
  scheduleCare(true);
  const cfg = await window.xiaoda.getConfig();
  setTimeout(() => {
    bubble(cfg.hasKey && cfg.apiUrl && cfg.model
      ? `${charName}上线啦！${pick(LINES.daily)}`
      : `${charName}上线啦！点我 → 聊天 → ⚙ 配置你自己的模型就能和我说话～`, 9000);
  }, 1200);
})();
