// ============================================================
// 小搭 · Electron 主进程
// 职责：创建透明置顶窗口 / 读取本机系统信息 / 对接用户自选模型 /
//       执行"控制电脑"白名单工具（打开软件、新建、移动文件）
// 安全原则：联网类工具在这里根本不存在，模型无从调用（代码强制，非提示词约束）
// ============================================================
const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const { BUILTIN_CHARS } = require('./renderer/sprites.js');

let petWin = null;  // 桌宠窗口
let selWin = null;  // 角色选择窗口

// 单实例锁：重复双击启动图标时，聚焦已有窗口而不是跑出第二个小搭
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWin) petWin.focus();
    else if (selWin) selWin.focus();
  });
}

// ---------- 桌宠窗口 ----------
function createPetWindow() {
  if (petWin) return;
  const { workArea } = screen.getPrimaryDisplay();
  petWin = new BrowserWindow({
    width: 640,
    height: 560,
    x: workArea.x + workArea.width - 660,
    y: workArea.y + workArea.height - 570,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  petWin.setAlwaysOnTop(true, 'floating');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 默认整个窗口对鼠标"隐形"，渲染进程检测到鼠标悬停在小人/面板上时才恢复
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  petWin.on('closed', () => { petWin = null; });
}

// ---------- 角色选择窗口 ----------
function createSelectorWindow() {
  if (selWin) { selWin.focus(); return; }
  selWin = new BrowserWindow({
    width: 580,
    height: 480,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  selWin.loadFile(path.join(__dirname, 'renderer', 'select.html'));
  selWin.on('closed', () => { selWin = null; });
}

// ---------- 角色数据 ----------
function findCharacter(id, cfg) {
  if (!id) return null;
  const b = BUILTIN_CHARS.find((c) => c.id === id);
  if (b) return { type: 'builtin', id: b.id, name: b.name };
  const cu = (cfg.customChars || []).find((c) => c.id === id);
  if (cu) return { type: 'custom', id: cu.id, name: cu.name, grid: cu.grid };
  return null;
}

app.whenReady().then(() => {
  const cfg = loadConfig();
  // 记住上次选择：选过角色 → 直接上桌面；否则（首次启动）→ 先进角色选择页
  if (findCharacter(cfg.selectedId, cfg)) createPetWindow();
  else createSelectorWindow();
});
app.on('window-all-closed', () => app.quit());

ipcMain.handle('get-characters', () => {
  const cfg = loadConfig();
  return { customChars: cfg.customChars || [], selectedId: cfg.selectedId || null };
});
ipcMain.handle('add-character', (e, { name, grid }) => {
  const n = Array.isArray(grid) ? grid.length : 0;
  if (n < 8 || n > 64 || grid.some((r) => !Array.isArray(r) || r.length !== n)) {
    return { error: '素材格式不对' };
  }
  const cfg = loadConfig();
  cfg.customChars = cfg.customChars || [];
  const id = 'custom-' + Date.now();
  cfg.customChars.push({ id, name: String(name || '自定义小人').slice(0, 12), grid });
  saveConfig(cfg);
  return { id };
});
ipcMain.handle('delete-character', (e, id) => {
  if (!String(id).startsWith('custom-')) return { error: '默认角色不能删除' };
  const cfg = loadConfig();
  cfg.customChars = (cfg.customChars || []).filter((c) => c.id !== id);
  if (cfg.selectedId === id) cfg.selectedId = null;
  saveConfig(cfg);
  return { ok: true };
});
ipcMain.handle('choose-character', (e, id) => {
  const cfg = loadConfig();
  if (!findCharacter(id, cfg)) return { error: '角色不存在' };
  cfg.selectedId = id;
  saveConfig(cfg);
  createPetWindow();               // 先开桌宠再关选择页，避免触发"全部窗口关闭即退出"
  if (selWin) selWin.close();
  return { ok: true };
});
ipcMain.handle('get-selected', () => {
  const cfg = loadConfig();
  return findCharacter(cfg.selectedId, cfg) || { type: 'builtin', id: BUILTIN_CHARS[0].id };
});
ipcMain.on('open-selector', () => {  // 桌宠右键菜单「更换角色」
  createSelectorWindow();
  if (petWin) petWin.close();
});
ipcMain.on('close-selector', () => {
  // 桌宠还在 → 只关选择页；首次启动没有桌宠 → 关掉等于退出应用
  if (selWin) selWin.close();
  if (!petWin) app.quit();
});

// ---------- 配置（API Key 存在用户目录，不进代码库） ----------
const configPath = () => path.join(app.getPath('userData'), 'xiaoda-config.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
ipcMain.handle('get-config', () => {
  const c = loadConfig();
  return {
    hasKey: !!c.apiKey,
    apiUrl: c.apiUrl || '',
    model: c.model || '',
    profession: c.profession || null,
    interests: c.interests || [],
  };
});
// s14 自定义提醒：渲染进程定时拉取并触发
ipcMain.handle('get-reminders', () => loadConfig().reminders || []);
ipcMain.handle('remove-reminder', (e, id) => {
  const c = loadConfig();
  c.reminders = (c.reminders || []).filter((r) => r.id !== id);
  saveConfig(c);
  return { ok: true };
});
ipcMain.handle('save-config', (e, cfg) => {
  const c = loadConfig();
  if (typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) c.apiKey = cfg.apiKey.trim();
  if (typeof cfg.apiUrl === 'string') c.apiUrl = cfg.apiUrl.trim();
  if (typeof cfg.model === 'string') c.model = cfg.model.trim();
  saveConfig(c);
  return { ok: true };
});

ipcMain.handle('test-model-config', async (e, draft) => {
  const saved = loadConfig();
  const apiUrl = String((draft && draft.apiUrl) || saved.apiUrl || '').trim();
  const model = String((draft && draft.model) || saved.model || '').trim();
  const apiKey = String((draft && draft.apiKey) || saved.apiKey || '').trim();
  if (!apiUrl || !model || !apiKey) return { ok: false, error: '请先填写 API 地址、模型名和 API Key' };
  if (!/^https?:\/\/\S+$/i.test(apiUrl)) return { ok: false, error: 'API 地址需要以 http:// 或 https:// 开头' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(apiUrl, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        max_tokens: 8,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 401) return { ok: false, error: 'API Key 无效或没有权限' };
      return { ok: false, error: `连接失败（${r.status}）：${t.slice(0, 120)}` };
    }
    const data = await r.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) return { ok: false, error: '接口可访问，但返回格式不像 OpenAI Chat Completions' };
    return { ok: true, model };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? '连接超时，请检查网络或 API 地址' : '连接失败：' + err.message };
  } finally {
    clearTimeout(timer);
  }
});

// ---------- 窗口交互 ----------
ipcMain.on('set-ignore-mouse', (e, flag) => {
  if (petWin) petWin.setIgnoreMouseEvents(flag, { forward: true });
});
ipcMain.on('move-window', (e, dx, dy) => {
  if (!petWin) return;
  const [x, y] = petWin.getPosition();
  petWin.setPosition(x + Math.round(dx), y + Math.round(dy));
});
ipcMain.on('quit', () => app.quit());

// ---------- 本机系统信息（全部为本地只读命令，零联网） ----------
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}
function cpuSnapshot() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const k in c.times) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total };
}
ipcMain.handle('get-stats', async () => {
  // CPU：间隔 400ms 采样两次算占用率
  const a = cpuSnapshot();
  await new Promise((r) => setTimeout(r, 400));
  const b = cpuSnapshot();
  const dTotal = b.total - a.total, dIdle = b.idle - a.idle;
  const cpuUsage = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0;

  const memTotal = os.totalmem() / 1024 ** 3;
  const memUsed = memTotal - os.freemem() / 1024 ** 3;

  // 磁盘：df 读 APFS 数据卷
  let disk = null;
  const dfOut = (await run('df', ['-k', '/System/Volumes/Data'])) || (await run('df', ['-k', '/']));
  const dfLine = dfOut.split('\n')[1];
  if (dfLine) {
    const parts = dfLine.trim().split(/\s+/);
    const totalKB = Number(parts[1]), usedKB = Number(parts[2]);
    if (totalKB) disk = { used: usedKB / 1024 ** 2, total: totalKB / 1024 ** 2 };
  }

  // 电池：pmset（台式机无电池时优雅降级）
  let battery = { has: false };
  const batt = await run('pmset', ['-g', 'batt']);
  const pctMatch = batt.match(/(\d+)%/);
  if (pctMatch) {
    battery = {
      has: true,
      pct: Number(pctMatch[1]),
      charging: /charging|AC Power/i.test(batt) && !/discharging/i.test(batt),
    };
  }

  // 网络：读本机网卡状态（这是"读取信息"，不是"联网行为"）
  let net = { online: false, ip: '—', wifi: '—' };
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    const v4 = (ifs[name] || []).find((i) => i.family === 'IPv4' && !i.internal);
    if (v4) { net = { online: true, ip: v4.address, wifi: '—' }; break; }
  }
  if (net.online) {
    const wifiOut = await run('networksetup', ['-getairportnetwork', 'en0']);
    const m = wifiOut.match(/Current Wi-Fi Network:\s*(.+)/);
    if (m) net.wifi = m[1].trim();
  }

  return {
    cpu: { usage: cpuUsage, cores: os.cpus().length },
    mem: { used: memUsed, total: memTotal },
    disk,
    battery,
    net,
  };
});

// ---------- 本机 Claude Code 监控（只读 ~/.claude 会话记录，零联网） ----------
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const CLAUDE_CONTEXT_WINDOW = 200000;

function newestTranscript() {
  let best = null;
  let dirs = [];
  try { dirs = fs.readdirSync(CLAUDE_PROJECTS); } catch { return null; }
  for (const d of dirs) {
    const dir = path.join(CLAUDE_PROJECTS, d);
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dir, f);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs, size: st.size };
    }
  }
  return best;
}

ipcMain.handle('get-claude-stats', () => {
  const t = newestTranscript();
  if (!t) return { found: false };
  // 只读文件尾部 400KB，大会话文件也不卡顿
  const TAIL = 400 * 1024;
  const start = Math.max(0, t.size - TAIL);
  let text = '';
  try {
    const fd = fs.openSync(t.path, 'r');
    const buf = Buffer.alloc(t.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { return { found: false }; }

  let last = null, outSum = 0;
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    try {
      const obj = JSON.parse(line);
      const u = obj.message && obj.message.usage;
      if (u && u.input_tokens != null) {
        outSum += u.output_tokens || 0;
        last = { u, model: obj.message.model || '' };
      }
    } catch { /* 尾部截断的半行，跳过 */ }
  }
  if (!last) return { found: true, active: false, mtimeMs: t.mtimeMs };

  const ctxTokens = (last.u.input_tokens || 0)
    + (last.u.cache_read_input_tokens || 0)
    + (last.u.cache_creation_input_tokens || 0);
  return {
    found: true,
    active: true,
    model: last.model,
    ctxTokens,
    ctxPct: Math.min(100, Math.round((ctxTokens / CLAUDE_CONTEXT_WINDOW) * 100)),
    outSum,
    mtimeMs: t.mtimeMs,
  };
});

// ---------- 对话大脑：OpenAI 兼容接口 + Function Calling ----------
// 接口地址、模型名、API Key 全部由用户在本机配置，不在客户端内置任何可用账号。

const SYSTEM_PROMPT_BASE = [
  '你是生活在用户 macOS 桌面上的像素风私人助理桌宠（产品名"小搭"）。',
  '性格活泼、说话简短（两三句以内），偶尔用颜文字卖萌。',
  '你可以联网帮用户解决日常问题：搜电影、查名词解释、看资讯等（需要时系统会给你联网搜索结果，引用时注明来源）。',
  '一切行为必须合法合规：拒绝违法、侵权、色情、危险内容的请求。',
  '你可以用工具操作这台电脑：打开应用、打开网页、新建/移动文件、查看文件夹——只能通过这些工具，别无其他。',
  '用户提到名字、习惯等长期信息时主动调用 remember；提到自己职业时调用 set_profession；',
  '表达对某话题的兴趣（喜欢看X、最近在研究X、关注X）时调用 add_interest；说"提醒我…"时调用 set_reminder。',
  '当用户说"看今日情报"或想了解动态时：结合用户的职业和关注话题，用联网搜索结果总结 3~6 条今天的相关资讯，短句列出并注明来源。',
  '文件操作只允许在用户主目录内；执行前系统可能向用户弹窗确认，被拒绝时礼貌接受。',
].join('\n');

// s09 记忆系统：把日期、职业、长期记忆拼进系统提示词，小搭"认识"用户
function buildSystemPrompt(cfg) {
  const ch = findCharacter(cfg.selectedId, cfg);
  let p = `你的名字叫「${(ch && ch.name) || '小搭'}」，说话时以这个名字自称。\n` + SYSTEM_PROMPT_BASE
    + `\n今天是 ${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}。`;
  if (cfg.profession) p += `\n用户的职业：${cfg.profession}。`;
  if (cfg.interests && cfg.interests.length) p += `\n用户关注的话题：${cfg.interests.join('、')}。`;
  const mems = cfg.memories || [];
  if (mems.length) {
    p += '\n\n你对用户的长期记忆（可靠，可直接引用）：\n'
      + mems.map((m) => `- ${m.text}（${m.time} 记）`).join('\n');
  }
  return p;
}

// ============================================================
// 工具系统（s02 查表分发 + s03 分级权限）
// permission: 'allow' 直接执行；'ask' 先弹系统确认框
// 加一个新工具 = 在注册表里加一项，其余全自动
// 注意：注册表里没有、也永远不会有任何联网工具
// ============================================================
function moveTarget(src, dst) {
  if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) return path.join(dst, path.basename(src));
  return dst;
}

const TOOL_REGISTRY = {
  open_app: {
    description: '打开本机已安装的应用程序',
    parameters: { type: 'object', properties: {
      name: { type: 'string', description: '应用名称，如 备忘录、Safari、访达' },
    }, required: ['name'] },
    permission: 'allow',
    run: (args) => new Promise((resolve) => {
      const appName = String(args.name || '').trim();
      if (!appName) return resolve('失败：没有给出应用名');
      execFile('open', ['-a', appName], (err) =>
        resolve(err ? `打开失败：可能没有安装「${appName}」` : `已打开「${appName}」`));
    }),
  },
  list_directory: {
    description: '查看某个文件夹里有哪些文件（只读）',
    parameters: { type: 'object', properties: {
      path: { type: 'string', description: '文件夹路径，支持 ~' },
    }, required: ['path'] },
    permission: 'allow',
    run: (args) => {
      const dir = expandPath(args.path);
      if (!dir || !insideHome(dir)) return '拒绝：只能查看用户主目录内的文件夹';
      const items = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 50)
        .map((d) => (d.isDirectory() ? '📁 ' : '📄 ') + d.name);
      return items.length ? items.join('\n') : '（空文件夹）';
    },
  },
  create_file: {
    description: '在本机新建一个文本文件（仅限用户主目录内）',
    parameters: { type: 'object', properties: {
      path: { type: 'string', description: '文件路径，支持 ~ 开头；相对路径默认放在桌面' },
      content: { type: 'string', description: '文件内容，可为空字符串' },
    }, required: ['path'] },
    permission: 'ask',
    validate: (args) => {
      const file = expandPath(args.path);
      if (!file || !insideHome(file)) return '拒绝：只能在用户主目录内新建文件';
      if (fs.existsSync(file)) return `失败：${file} 已存在，不覆盖已有文件`;
      return null;
    },
    confirmText: (args) => `新建文件 ${expandPath(args.path)}`,
    run: (args) => {
      const file = expandPath(args.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(args.content || ''), 'utf8');
      return `已新建 ${file}`;
    },
  },
  move_file: {
    description: '移动或重命名本机文件/文件夹（仅限用户主目录内）',
    parameters: { type: 'object', properties: {
      source: { type: 'string', description: '原路径' },
      destination: { type: 'string', description: '目标路径' },
    }, required: ['source', 'destination'] },
    permission: 'ask',
    validate: (args) => {
      const src = expandPath(args.source), dst = expandPath(args.destination);
      if (!src || !dst || !insideHome(src) || !insideHome(dst)) return '拒绝：只能在用户主目录内移动文件';
      if (!fs.existsSync(src)) return `失败：找不到 ${src}`;
      const target = moveTarget(src, dst);
      if (fs.existsSync(target)) return `失败：目标位置已存在 ${target}`;
      return null;
    },
    confirmText: (args) => {
      const src = expandPath(args.source);
      return `把 ${src} 移动到 ${moveTarget(src, expandPath(args.destination))}`;
    },
    run: (args) => {
      const src = expandPath(args.source);
      const target = moveTarget(src, expandPath(args.destination));
      fs.renameSync(src, target);
      return `已移动到 ${target}`;
    },
  },
  open_url: {
    description: '用默认浏览器打开一个网页（http/https 链接）',
    parameters: { type: 'object', properties: {
      url: { type: 'string', description: '完整网址，以 http:// 或 https:// 开头' },
    }, required: ['url'] },
    permission: 'allow',
    validate: (args) => (/^https?:\/\/\S+$/i.test(String(args.url || '')) ? null : '失败：需要 http/https 开头的完整网址'),
    run: (args) => new Promise((resolve) => {
      execFile('open', [String(args.url)], (err) =>
        resolve(err ? '打开失败' : `已在浏览器打开 ${args.url}`));
    }),
  },
  set_profession: {
    description: '记录用户的职业（用于每日行业情报推送）。用户提到自己的职业时调用',
    parameters: { type: 'object', properties: {
      profession: { type: 'string', description: '职业名称，如 设计师、程序员、教师' },
    }, required: ['profession'] },
    permission: 'allow',
    run: (args) => {
      const p = String(args.profession || '').trim().slice(0, 20);
      if (!p) return '失败：职业为空';
      const cfg = loadConfig();
      cfg.profession = p;
      saveConfig(cfg);
      return `已记录职业：${p}。以后每天上午会提醒一次行业新鲜事，用户想看时说「看今日情报」即可`;
    },
  },
  add_interest: {
    description: '记录用户感兴趣的话题（用于每日情报推送）。用户表达对某领域/话题的兴趣时调用，如 AI、篮球、摄影、美股',
    parameters: { type: 'object', properties: {
      topic: { type: 'string', description: '一个简短的话题词，如 AI、摄影' },
    }, required: ['topic'] },
    permission: 'allow',
    run: (args) => {
      const t = String(args.topic || '').trim().slice(0, 12);
      if (!t) return '失败：话题为空';
      const cfg = loadConfig();
      cfg.interests = (cfg.interests || []).filter((x) => x !== t);
      cfg.interests.push(t);
      if (cfg.interests.length > 10) cfg.interests = cfg.interests.slice(-10);
      saveConfig(cfg);
      return `已关注话题：${t}（当前关注：${cfg.interests.join('、')}）`;
    },
  },
  remove_interest: {
    description: '取消关注某个话题。用户说"不用再推X了/取消关注X"时调用',
    parameters: { type: 'object', properties: {
      topic: { type: 'string', description: '要取消的话题词' },
    }, required: ['topic'] },
    permission: 'allow',
    run: (args) => {
      const cfg = loadConfig();
      const before = (cfg.interests || []).length;
      cfg.interests = (cfg.interests || []).filter((x) => x !== String(args.topic || '').trim());
      if (cfg.interests.length === before) return '本来就没在关注这个话题';
      saveConfig(cfg);
      return `已取消关注（剩余：${cfg.interests.join('、') || '无'}）`;
    },
  },
  // ---- s09 记忆 ----
  remember: {
    description: '把关于用户的长期信息记进记忆（名字、喜好、习惯、忌口等）。用户提到这类信息时应主动调用',
    parameters: { type: 'object', properties: {
      fact: { type: 'string', description: '一句话描述要记住的事实，如：用户叫老张，不吃辣' },
    }, required: ['fact'] },
    permission: 'allow',
    run: (args) => {
      const fact = String(args.fact || '').trim().slice(0, 80);
      if (!fact) return '失败：没有要记的内容';
      const cfg = loadConfig();
      cfg.memories = (cfg.memories || []).filter((m) => m.text !== fact);
      cfg.memories.push({ text: fact, time: new Date().toLocaleDateString('zh-CN') });
      if (cfg.memories.length > 40) cfg.memories = cfg.memories.slice(-40);
      saveConfig(cfg);
      return `已记住：${fact}`;
    },
  },
  // ---- s14 定时提醒 ----
  set_reminder: {
    description: '给用户设一个本地定时提醒。用户说"每天X点提醒我…"或"X点提醒我…"时调用',
    parameters: { type: 'object', properties: {
      time: { type: 'string', description: '24小时制 HH:MM，如 15:00' },
      text: { type: 'string', description: '提醒内容，如：该喝水啦' },
      repeat: { type: 'string', enum: ['daily', 'once'], description: 'daily=每天重复，once=只提醒一次' },
    }, required: ['time', 'text'] },
    permission: 'allow',
    run: (args) => {
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(args.time || ''))) return '失败：时间格式要用 HH:MM，比如 15:00';
      const cfg = loadConfig();
      cfg.reminders = cfg.reminders || [];
      if (cfg.reminders.length >= 20) return '失败：提醒已达上限 20 条，先删掉一些吧';
      const id = 'r' + Date.now();
      const text = String(args.text).slice(0, 40);
      const repeat = args.repeat === 'once' ? 'once' : 'daily';
      cfg.reminders.push({ id, time: args.time, text, repeat });
      saveConfig(cfg);
      return `已设好：${repeat === 'once' ? '最近一次' : '每天'} ${args.time}「${text}」（编号 ${id}）`;
    },
  },
  list_reminders: {
    description: '查看已设置的所有定时提醒',
    parameters: { type: 'object', properties: {} },
    permission: 'allow',
    run: () => {
      const list = loadConfig().reminders || [];
      if (!list.length) return '目前没有任何提醒';
      return list.map((r) => `${r.id}｜${r.repeat === 'once' ? '单次' : '每天'} ${r.time}｜${r.text}`).join('\n');
    },
  },
  delete_reminder: {
    description: '删除一个定时提醒',
    parameters: { type: 'object', properties: {
      id: { type: 'string', description: '提醒编号，可先用 list_reminders 查询' },
    }, required: ['id'] },
    permission: 'allow',
    run: (args) => {
      const cfg = loadConfig();
      const before = (cfg.reminders || []).length;
      cfg.reminders = (cfg.reminders || []).filter((r) => r.id !== args.id);
      if (cfg.reminders.length === before) return '没找到这个编号的提醒';
      saveConfig(cfg);
      return '已删除该提醒';
    },
  },
};

// 发给模型的工具清单由注册表自动生成
const TOOLS = Object.entries(TOOL_REGISTRY).map(([name, t]) => ({
  type: 'function',
  function: { name, description: t.description, parameters: t.parameters },
}));

// 搜索/资讯类意图识别：命中则本次请求切换到带联网搜索的模型变体（平时用普通模型，省成本）
const WEB_RE = /(搜索|搜一下|搜一搜|搜个|百度|谷歌|google|bing|必应|查一查|查查|查一下|电影|资讯|情报|新闻|天气|股价|股票|汇率|最新|今日|今天有什么|上网|联网|网上|评分|豆瓣|上映)/i;

function expandPath(p) {
  if (!p || typeof p !== 'string') return null;
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  if (!path.isAbsolute(p)) p = path.join(os.homedir(), 'Desktop', p);
  return path.resolve(p);
}
function insideHome(p) {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep);
}
async function confirmAction(text) {
  const r = await dialog.showMessageBox(petWin, {
    type: 'question',
    buttons: ['允许', '拒绝'],
    defaultId: 0,
    cancelId: 1,
    title: '小搭请求确认',
    message: '小搭想要：' + text,
    detail: '确认后才会执行，拒绝不会有任何改动。',
  });
  return r.response === 0;
}

// 执行管线（s03）：参数结构由 API 层保证 → validate 校验 → 权限判定 → 执行
async function executeTool(name, args) {
  const tool = TOOL_REGISTRY[name];
  if (!tool) return `未知工具 ${name}`;
  try {
    if (tool.validate) {
      const err = tool.validate(args);
      if (err) return err;
    }
    if (tool.permission === 'ask') {
      const ok = await confirmAction(tool.confirmText(args));
      if (!ok) return '用户拒绝了这次操作';
    }
    return await tool.run(args);
  } catch (err) {
    return '执行出错：' + err.message;
  }
}

ipcMain.handle('chat', async (e, history) => {
  const cfg = loadConfig();
  const apiUrl = String(cfg.apiUrl || '').trim();
  let model = String(cfg.model || '').trim();
  if (!cfg.apiKey || !apiUrl || !model) return { error: 'no_model_config' };
  // 搜索/资讯类意图 → 本次请求用 OpenRouter 的 :online 联网变体
  const last = history[history.length - 1];
  if (last && WEB_RE.test(String(last.content)) && apiUrl.includes('openrouter') && !model.includes(':online')) {
    model += ':online';
  }

  const messages = [{ role: 'system', content: buildSystemPrompt(cfg) }, ...history];
  const actions = [];

  // Function Calling 循环：模型要求调工具 → 本地执行 → 结果回传 → 直到模型给出文字回复
  for (let round = 0; round < 5; round++) {
    let data;
    try {
      const r = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model, messages, tools: TOOLS }),
      });
      if (!r.ok) {
        const t = await r.text();
        if (r.status === 401) return { error: 'API Key 无效，请检查后重新填写' };
        return { error: `API 请求失败（${r.status}）：${t.slice(0, 160)}` };
      }
      data = await r.json();
    } catch (err) {
      return { error: '连不上模型服务器：' + err.message };
    }

    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) return { error: 'API 返回了意外格式' };
    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length) {
      for (const tc of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        const result = await executeTool(tc.function.name, args);
        actions.push(result);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    } else {
      return { reply: msg.content || '（小搭愣住了…）', actions };
    }
  }
  return { reply: '这个任务绕了太多圈，小搭先歇会儿…', actions };
});
