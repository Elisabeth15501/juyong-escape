'use strict';
/* ============================================================
 * 《朱厚照出居庸关》 像素跑酷 · ming_escape（MVP v0.7.0）
 * ------------------------------------------------------------
 * 双模式引擎：
 *   1) 关卡模式「出关记」：3 幕叙事（LEVELS 数据驱动，可扩至 8 幕）
 *   2) 无限跑酷「居庸关」：速度递增，比拼奔袭里数（背景=居庸关夜色）
 * 核心机制：拾取「大将军印」→ 变身威武大将军朱寿（无敌 + 提速）
 *           第 3 幕终局：撞开/通过居庸关门 → 张钦痛哭失声演出
 * 自适应布局（v0.4）：
 *   - 横屏（桌面/手机横持）：逻辑 480×270，与原版一致
 *   - 竖屏（手机竖持）：逻辑 270×480，世界层下移、天空拉高、UI 重排
 *   - 竖屏速度 ×0.8 补偿横向视野变短的反应距离
 * 小红书小工具合规：脚本外置 / addEventListener / 零网络 / 零 eval
 * ------------------------------------------------------------
 * 自定义美术（可选，丢进 ./assets/ 自动生效，缺失则代码占位绘制）：
 *   zhuhouzhao.png（朱厚照，4 帧横排）   zhushou.png（朱寿，4 帧）
 *   zhangqin.png（张钦，4 帧）           yin.png（大将军印，1 帧）
 *   zhangqin_cry.png（张钦痛哭，8 帧横排，终局演出用）
 * ============================================================ */

/* ---------- 渲染与物理常量 ---------- */
let PIXEL_SCALE = 3;           // 逻辑坐标 → 物理像素比例（layout() 按窗口尺寸与 DPR 动态计算）
const GRAVITY = 2400;
const JUMP_V = -820;
const JUMP_CUT = -300;         // 提前松手截断跳跃
const PLAYER_X = 72;
const PLAYER_W = 24;
const PLAYER_H = 40;
const TRANSFORM_TIME = 6;      // 变身朱寿持续秒数
const PX_PER_LI = 150;         // 像素 → 里（显示用）
const PORTRAIT_SPEED = 0.8;    // 竖屏速度补偿（横向视野短 → 放慢）

/* ---------- 运行时布局（横/竖屏切换） ---------- */
let VW = 480;                  // 逻辑宽
let VH = 270;                  // 逻辑高
let G = 224;                   // 地面线（竖屏时下移）
let portrait = false;          // 竖屏标记

/* ---------- 安全存储（沙箱可能禁用 localStorage，需 try/catch） ---------- */
const store = {
  get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
};

/* ---------- Web Audio 运行时合成音效（零音频文件、零体积） ---------- */
const AudioSys = {
  ctx: null,
  ensure: function () {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone: function (freq, dur, type, vol, delay, slideTo) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol || 0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  },
  jump: function () { this.tone(420, 0.12, 'square', 0.05, 0, 680); },
  seal: function () { this.tone(660, 0.09, 'square', 0.07); this.tone(880, 0.1, 'square', 0.07, 0.09); },
  transform: function () {
    this.tone(523, 0.1, 'square', 0.08);
    this.tone(659, 0.1, 'square', 0.08, 0.1);
    this.tone(784, 0.14, 'square', 0.08, 0.2);
    this.tone(1047, 0.22, 'square', 0.08, 0.3);
  },
  hit: function () { this.tone(220, 0.28, 'sawtooth', 0.09, 0, 60); },
  smash: function () { this.tone(90, 0.3, 'sawtooth', 0.12, 0, 40); this.tone(320, 0.12, 'square', 0.06, 0.02, 80); },
  clear: function () { this.tone(523, 0.12, 'square', 0.07); this.tone(659, 0.12, 'square', 0.07, 0.12); this.tone(784, 0.2, 'square', 0.07, 0.24); },
  cry: function () { this.tone(392, 0.5, 'triangle', 0.06, 0, 330); this.tone(311, 0.8, 'triangle', 0.06, 0.6, 250); }
};

/* ---------- 精灵表加载（缺失自动回退代码占位绘制） ---------- */
const SHEET_FRAMES = { zhuhouzhao: 4, zhushou: 4, zhangqin: 1, yin: 1, cry: 8 };
const Sprites = {
  map: {},
  load: function () {
    const files = {
      zhuhouzhao: 'Zhuhouzhao.png',
      zhushou: 'Zhushou.png',
      zhangqin: 'Zhangqin.png',
      yin: 'assets/yin.png',
      cry: 'assets/zhangqin_cry.png'
    };
    const keys = Object.keys(files);
    for (let i = 0; i < keys.length; i++) {
      (function (k) {
        const img = new Image();
        img.onload = function () { Sprites.map[k] = img; };
        img.onerror = function () { /* 缺失则用代码占位绘制 */ };
        img.src = files[k];
      })(keys[i]);
    }
  }
};

/* ============================================================
 * LEVELS：数据驱动关卡（叙事骨架）
 * 现为 3 幕 v1。扩展到 8 幕 = 直接往数组里插对象，引擎零改动。
 * ============================================================ */
const LEVELS = [
  {
    id: 1, act: '第一幕', title: '紫禁城 · 起心动念',
    before: '正德十二年，秋。\n蒙古小王子屡犯边境，\n紫禁城里的朱厚照坐不住了——\n这一次，他要亲自去看看边关。',
    after: '《明史 · 武宗本纪》：\n「十二年八月，帝微服如昌平。」\n趁夜出京——没有大臣拦得住\n这位向往战场的皇帝。',
    scene: 'palace',
    sky: ['#ffd9a0', '#ffab6b'], far: '#9c4f3f', mid: '#c25e43', ground: '#6b4226',
    speed: 250, interval: [1.7, 2.4], types: ['zhangqin', 'zouzhe'], length: 9000,
    sealAt: [0.45],
    hint: '点按跳跃 · 拾「大将军印」变身朱寿！',
    gate: false
  },
  {
    id: 2, act: '第二幕', title: '居庸关下 · 负敕印仗剑',
    before: '居庸关下，巡关御史张钦\n早得密报。他做了两件事：\n闭关门，藏钥匙。\n朱厚照第一次出关，被挡了回去。',
    after: '《明史 · 张钦传》：\n「钦乃负敕印，仗剑坐关门下曰：\n敢言开关者，斩！」\n皇帝悻悻而回——但没人相信，\n他会就此罢休。',
    scene: 'road',
    sky: ['#f6c06a', '#d97a4a'], far: '#6f5a6e', mid: '#8d6a5f', ground: '#4e3a2a',
    speed: 290, interval: [1.25, 1.9], types: ['zhangqin', 'suo', 'zouzhe'], length: 11000,
    sealAt: [0.3, 0.7],
    hint: '跳过张钦与「锁」· 别撞飞来的「奏折」！',
    gate: false
  },
  {
    id: 3, act: '第三幕', title: '白羊口 · 疾驰出关',
    before: '数日后，张钦前往白羊口巡视，\n关防空虚。\n探子飞马来报：\n皇帝的车驾，正朝居庸关疾驰而来！',
    after: '',
    scene: 'pass',
    sky: ['#2d3a5e', '#7a5a72'], far: '#3a3652', mid: '#4d4360', ground: '#2f2a3a',
    speed: 330, interval: [1.0, 1.6], types: ['zhangqin', 'suo', 'zouzhe'], length: 12000,
    sealAt: [0.8],
    hint: '疾驰！变身朱寿，撞开关门，出关！',
    gate: true
  }
];

/* ------------------------------------------------------------
 * 《八幕规划》—— v1.1 叙事扩展插槽（史实节拍）
 * 加关 = 往 LEVELS 插对象。建议切分：
 *   1 起心动念（紫禁城）        —— 现 L1
 *   2 微服昌平（夜路）          —— 从现 L1 后半拆出，正式引入大将军印
 *   3 抵关 · 张钦闭关藏钥       —— 现 L2 前半，「锁」障碍登场
 *   4 关门对峙 · 敢言开关者斩   —— 现 L2 后半，锁最密
 *   5 暂退修整（奏折如雨）      —— 喘息关：速度慢，但奏折铺天盖地
 *   6 趁虚疾驰（白羊口）        —— 高速关（speed 400+）
 *   7 断后 · 谷大用守关         —— 障碍最密的一关
 *   8 出关 · 痛哭失声+应州大捷  —— 现 L3（终局演出 + 隐藏成就扩展）
 * ------------------------------------------------------------ */

/* ---------- 无限跑酷模式（背景：居庸关夜色） ---------- */
const ENDLESS = {
  scene: 'pass',
  sky: ['#1c2748', '#4a3d66'],
  far: '#2c2a45',
  mid: '#3d3355',
  ground: '#262138'
};

/* ---------- 主菜单背景 ---------- */
const MENU_BG = {
  scene: 'pass',
  sky: ['#2a3560', '#7a5a72'],
  far: '#3a3652',
  mid: '#4d4360',
  ground: '#2f2a3a'
};

/* ---------- 障碍物定义 ---------- */
const OBST_DEF = {
  zhangqin: { w: 26, h: 44, fly: false },     // 巡关御史（地面 · 跳过他）
  suo: { w: 18, h: 18, fly: false },          // 张钦掷出的锁（地面 · 跳过）
  zouzhe: { w: 24, h: 14, fly: true }         // 飞来的奏折（空中 · 千万别跳，y=G-74 动态）
};

/* ---------- 运行时状态 ---------- */
let state = 'menu';            // menu / story / play / clear / finale / gameover
let mode = 'level';            // level / endless
let levelIndex = 0;
let gt = 0, last = 0;
let player, obstacles, items, particles, gate;
let dist, speed, spawnT, sealT, transformT, hintT, shakeT;
let usedSeals, gateDone, finaleT, finaleSmashed, finaleCry;
let hintText = '';
let endlessBest = parseInt(store.get('ming_escape_best') || '0', 10) || 0;
let uiButtons = [];

/* ---------- 画布与自适应布局 ---------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  portrait = h > w;
  if (portrait) { VW = 270; VH = 480; } else { VW = 480; VH = 270; }
  const newG = portrait ? 300 : 224;
  if (player) player.y += (newG - G);   // 旋转中保持相对高度
  G = newG;
  /* 高清渲染：画布位图直接匹配窗口设备像素（含 DPR），不再固定 3 倍拉伸 */
  const cssScale = Math.min(w / VW, h / VH);
  const cssW = Math.floor(VW * cssScale);
  const cssH = Math.floor(VH * cssScale);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  let dpr = window.devicePixelRatio || 1;
  if (dpr > 3) dpr = 3;                              // 高 DPR 设备性能保护
  if (cssW * dpr > 3840) dpr = 3840 / cssW;          // 超大屏位图上限（4K）
  if (cssH * dpr > 3840) dpr = Math.min(dpr, 3840 / cssH);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  PIXEL_SCALE = canvas.width / VW;                   // 逻辑 → 物理像素（等比）
}
window.addEventListener('resize', layout);
layout();

/* ---------- 工具 ---------- */
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function fmtLi(px) { return Math.floor(px / PX_PER_LI); }
function wrapText(text, x, y, maxW, lh) {
  const lines = String(text).split('\n');
  let yy = y;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, yy);
    yy += lh;
  }
  return yy;
}

/* ---------- 流程控制 ---------- */
function currentLevel() { return mode === 'level' ? LEVELS[levelIndex] : null; }

function resetRun() {
  player = { y: G - PLAYER_H, vy: 0, onGround: true, form: 'zhuhouzhao', animT: 0 };
  obstacles = [];
  items = [];
  particles = [];
  gate = null;
  dist = 0;
  speed = 0;
  spawnT = 1.4;
  sealT = 9 + Math.random() * 5;
  transformT = 0;
  hintT = 4.5;
  shakeT = 0;
  usedSeals = [];
  gateDone = false;
  finaleT = 0;
  finaleSmashed = false;
  finaleCry = false;
}

function startLevel(i) {
  mode = 'level';
  levelIndex = i;
  resetRun();
  hintText = LEVELS[i].hint;
  state = 'story';
}

function startEndless() {
  mode = 'endless';
  resetRun();
  hintText = '点按跳跃 · 拾「大将军印」变身朱寿！';
  state = 'play';
}

function toMenu() { state = 'menu'; }

function retry() {
  if (mode === 'level') startLevel(levelIndex);
  else startEndless();
}

function nextLevel() {
  if (levelIndex + 1 < LEVELS.length) startLevel(levelIndex + 1);
  else toMenu();
}

/* ---------- 输入 ---------- */
function jump() {
  if (state !== 'play') return;
  if (player.onGround) {
    player.onGround = false;
    player.vy = JUMP_V;
    AudioSys.jump();
    dust(PLAYER_X + PLAYER_W / 2, G, 4);
  }
}
function releaseJump() {
  if (state === 'play' && !player.onGround && player.vy < JUMP_CUT) player.vy = JUMP_CUT;
}

canvas.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  AudioSys.ensure();
  const r = canvas.getBoundingClientRect();
  const lx = (e.clientX - r.left) / r.width * VW;
  const ly = (e.clientY - r.top) / r.height * VH;
  handleTap(lx, ly);
});
canvas.addEventListener('pointerup', function (e) { e.preventDefault(); releaseJump(); });

window.addEventListener('keydown', function (e) {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    AudioSys.ensure();
    if (state === 'play') jump();
    else confirmAction();
  }
});
window.addEventListener('keyup', function (e) {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') releaseJump();
});

function handleTap(lx, ly) {
  if (state === 'play') { jump(); return; }
  for (let i = 0; i < uiButtons.length; i++) {
    const b = uiButtons[i];
    if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) { b.cb(); return; }
  }
  if (state === 'story') { state = 'play'; return; }
  if (state === 'finale' && finaleT > 9) { toMenu(); return; }
}

function confirmAction() {
  if (state === 'story') state = 'play';
  else if (state === 'menu') startLevel(0);
  else if (state === 'clear') nextLevel();
  else if (state === 'gameover') retry();
  else if (state === 'finale' && finaleT > 9) toMenu();
}

/* ---------- 生成 ---------- */
function spawnObstacle() {
  let types;
  if (mode === 'endless') {
    types = dist > 3000 ? ['zhangqin', 'suo', 'zouzhe'] : ['zhangqin', 'suo'];
  } else {
    types = currentLevel().types;
  }
  const type = types[Math.floor(Math.random() * types.length)];
  obstacles.push({ type: type, x: VW + 50, t: 0, dead: false });
}

/* rel：相对地面线 G 的负偏移（旋转屏幕后自动跟随） */
function spawnSeal(x, rel) {
  items.push({ x: x, rel: rel, y: G + rel, bob: Math.random() * 6, got: false });
}

/* ---------- 主更新 ---------- */
function updatePlay(dt) {
  const lv = currentLevel();
  const SF = portrait ? PORTRAIT_SPEED : 1.0;
  let baseSpeed;
  if (mode === 'endless') baseSpeed = 280 + Math.min(240, dist / 60);
  else baseSpeed = lv.speed;
  speed = baseSpeed * SF * (transformT > 0 ? 1.15 : 1);

  player.animT += dt;
  if (!player.onGround) {
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y >= G - PLAYER_H) {
      player.y = G - PLAYER_H;
      player.vy = 0;
      player.onGround = true;
      dust(PLAYER_X + PLAYER_W / 2, G, 5);
    }
  } else if (Math.random() < dt * 6) {
    dust(PLAYER_X + 4, G, 1);
  }

  if (transformT > 0) {
    transformT -= dt;
    if (transformT <= 0) { transformT = 0; player.form = 'zhuhouzhao'; }
  }
  if (hintT > 0) hintT -= dt;

  dist += speed * dt;

  /* 障碍生成节奏（竖屏放慢速度 → 间隔略放宽） */
  let ivMin, ivMax;
  if (mode === 'endless') {
    const k = Math.min(1, dist / 22000);
    ivMin = 1.5 - 0.75 * k;
    ivMax = 2.1 - 1.0 * k;
  } else {
    ivMin = lv.interval[0];
    ivMax = lv.interval[1];
  }
  if (portrait) { ivMin += 0.1; ivMax += 0.15; }
  spawnT -= dt;
  const nearGate = mode === 'level' && lv.gate && dist > lv.length - 1000;
  if (spawnT <= 0) {
    spawnT = ivMin + Math.random() * (ivMax - ivMin);
    if (!nearGate) spawnObstacle();
  }

  /* 随机大将军印 */
  sealT -= dt;
  if (sealT <= 0) {
    sealT = 9 + Math.random() * 5;
    if (transformT <= 0) spawnSeal(VW + 40, -(59 - Math.random() * 12));
  }
  /* 剧情保证印（按关卡进度比例触发，确保关键演出必有变身） */
  if (mode === 'level' && lv.sealAt) {
    for (let i = 0; i < lv.sealAt.length; i++) {
      const p = lv.sealAt[i];
      if (dist >= lv.length * p && usedSeals.indexOf(p) < 0) {
        usedSeals.push(p);
        spawnSeal(VW + 40, -54);
      }
    }
  }

  /* 终局关门 */
  if (mode === 'level' && lv.gate && !gate && dist >= lv.length - 460) {
    gate = { x: VW + 60, w: 96, broken: false, opened: false };
  }

  const mv = speed * dt;
  for (let i = 0; i < obstacles.length; i++) { obstacles[i].x -= mv; obstacles[i].t += dt; }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    it.x -= mv;
    it.bob += dt;
    it.y = G + it.rel + Math.sin(it.bob * 4) * 4;
  }
  if (gate) gate.x -= mv;
  obstacles = obstacles.filter(function (o) { return o.x > -60; });
  items = items.filter(function (it) { return it.x > -40 && !it.got; });

  /* 碰撞：道具 */
  const pr = { x: PLAYER_X + 3, y: player.y + 3, w: PLAYER_W - 6, h: PLAYER_H - 5 };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.got && rectsOverlap(pr, { x: it.x, y: it.y, w: 18, h: 18 })) {
      it.got = true;
      pickupSeal();
    }
  }
  items = items.filter(function (it) { return !it.got; });

  /* 碰撞：障碍 */
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const d = OBST_DEF[o.type];
    const oy = d.fly ? G - 74 : G - d.h;
    const obox = { x: o.x + 2, y: oy + 2, w: d.w - 4, h: d.h - 4 };
    if (rectsOverlap(pr, obox)) {
      if (transformT > 0) {
        o.dead = true;
        burst(o.x + d.w / 2, oy + d.h / 2, 12, '#ffd76a');
        AudioSys.smash();
        shakeT = 0.12;
      } else {
        die();
        return;
      }
    }
  }
  obstacles = obstacles.filter(function (o) { return !o.dead; });

  /* 关门判定：变身朱寿=撞碎门（隐藏成就）；否则谷大用开门 */
  if (gate && !gateDone && gate.x <= PLAYER_X + PLAYER_W) {
    gateDone = true;
    if (transformT > 0) {
      finaleSmashed = true;
      gate.broken = true;
      shakeT = 0.6;
      burst(gate.x + 20, G - 70, 30, '#e7c26a');
      burst(gate.x + 50, G - 40, 20, '#8a6a4a');
      AudioSys.smash();
    } else {
      gate.opened = true;
    }
    state = 'finale';
    finaleT = 0;
    return;
  }

  /* 普通关完成 */
  if (mode === 'level' && !lv.gate && dist >= lv.length) {
    AudioSys.clear();
    state = 'clear';
  }
}

function pickupSeal() {
  AudioSys.seal();
  AudioSys.transform();
  transformT = TRANSFORM_TIME;
  player.form = 'zhushou';
  shakeT = 0.15;
  burst(PLAYER_X + PLAYER_W / 2, player.y + PLAYER_H / 2, 16, '#ffd76a');
}

function die() {
  AudioSys.hit();
  shakeT = 0.4;
  burst(PLAYER_X + PLAYER_W / 2, player.y + PLAYER_H / 2, 18, '#e05a4a');
  if (mode === 'endless') {
    const li = fmtLi(dist);
    if (li > endlessBest) { endlessBest = li; store.set('ming_escape_best', String(li)); }
  }
  state = 'gameover';
}

/* ---------- 粒子 ---------- */
function dust(x, y, n) {
  for (let i = 0; i < n; i++) {
    particles.push({ x: x, y: y - 2, vx: -40 - Math.random() * 60, vy: -20 - Math.random() * 40, life: 0.3 + Math.random() * 0.2, max: 0.5, color: '#9a8a72', size: 1 + Math.random() * 2 });
  }
}
function burst(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    particles.push({ x: x, y: y, vx: (Math.random() * 2 - 1) * 180, vy: -Math.random() * 220 - 40, life: 0.5 + Math.random() * 0.4, max: 0.9, color: color, size: 1 + Math.random() * 3 });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}
function drawParticles() {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

/* ---------- 背景（三套场景，视差滚动，y 全部锚定地面线 G） ---------- */
function drawSky(sky) {
  const g = ctx.createLinearGradient(0, 0, 0, G);
  g.addColorStop(0, sky[0]);
  g.addColorStop(1, sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, G);
}
function drawGround(lv) {
  ctx.fillStyle = lv.ground;
  ctx.fillRect(0, G, VW, VH - G);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, G, VW, 3);
  const off = -(dist % 48);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = off; x < VW; x += 48) ctx.fillRect(x, G + 8, 2, VH - G - 8);
}
function bgPalace(lv) {
  drawSky(lv.sky);
  /* 远景宫墙与金顶 */
  const period = 130, off = -(dist * 0.15 % period);
  for (let x = off - period; x < VW + period; x += period) {
    ctx.fillStyle = lv.far;
    ctx.fillRect(x, G - 104, period - 14, 60);
    ctx.fillStyle = '#d4a017';
    ctx.beginPath();
    ctx.moveTo(x - 8, G - 104);
    ctx.lineTo(x + (period - 14) / 2, G - 120);
    ctx.lineTo(x + period - 6, G - 104);
    ctx.closePath();
    ctx.fill();
  }
  /* 云 */
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  const cp = 240, coff = -((dist * 0.05 + gt * 6) % cp);
  for (let x = coff; x < VW + cp; x += cp) {
    ctx.fillRect(x, G - 178, 44, 8);
    ctx.fillRect(x + 8, G - 184, 28, 6);
  }
}
function bgRoad(lv) {
  drawSky(lv.sky);
  /* 远山 */
  const p1 = 300, o1 = -(dist * 0.1 % p1);
  ctx.fillStyle = lv.far;
  for (let x = o1 - p1; x < VW + p1; x += p1) {
    ctx.beginPath();
    ctx.moveTo(x, G - 64);
    ctx.lineTo(x + 150, G - 146);
    ctx.lineTo(x + 300, G - 64);
    ctx.closePath();
    ctx.fill();
  }
  /* 中景丘陵 + 松树 */
  const p2 = 220, o2 = -(dist * 0.25 % p2);
  for (let x = o2 - p2; x < VW + p2; x += p2) {
    ctx.fillStyle = lv.mid;
    ctx.beginPath();
    ctx.moveTo(x, G - 34);
    ctx.quadraticCurveTo(x + 110, G - 104, x + 220, G - 34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2e4a33';
    ctx.fillRect(x + 60, G - 74, 3, 12);
    ctx.beginPath();
    ctx.moveTo(x + 52, G - 72);
    ctx.lineTo(x + 61.5, G - 86);
    ctx.lineTo(x + 71, G - 72);
    ctx.closePath();
    ctx.fill();
  }
}
function bgPass(lv) {
  drawSky(lv.sky);
  /* 星 */
  ctx.fillStyle = '#e8e4ff';
  for (let i = 0; i < 26; i++) {
    const sx = (i * 97 + 31) % VW;
    const sy = (i * 53) % (G - 130) + 8;
    const tw = 0.5 + 0.5 * Math.sin(gt * 2 + i);
    ctx.globalAlpha = 0.3 + tw * 0.7;
    ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.globalAlpha = 1;
  /* 月 */
  ctx.fillStyle = '#f5edd0';
  ctx.fillRect(VW - 88, 26, 18, 18);
  ctx.fillStyle = lv.sky[1];
  ctx.fillRect(VW - 94, 22, 10, 10);
  /* 远景：长城、敌楼与山 */
  const p1 = 340, o1 = -(dist * 0.12 % p1);
  ctx.fillStyle = lv.far;
  for (let x = o1 - p1; x < VW + p1; x += p1) {
    ctx.fillRect(x, G - 92, p1, 4);
    for (let c = 0; c < p1; c += 14) ctx.fillRect(x + c, G - 96, 7, 4);
    ctx.fillRect(x + 130, G - 118, 34, 30);
    ctx.fillRect(x + 136, G - 124, 22, 6);
    ctx.beginPath();
    ctx.moveTo(x, G - 92);
    ctx.lineTo(x + 170, G - 158);
    ctx.lineTo(x + 340, G - 92);
    ctx.closePath();
    ctx.fill();
  }
  /* 中景：关城轮廓（云台 + 门楼） */
  const p2 = 500, o2 = -(dist * 0.3 % p2);
  ctx.fillStyle = lv.mid;
  for (let x = o2 - p2; x < VW + p2; x += p2) {
    ctx.fillRect(x, G - 74, 70, 46);
    ctx.fillRect(x + 8, G - 86, 54, 12);
    ctx.beginPath();
    ctx.moveTo(x + 2, G - 86);
    ctx.lineTo(x + 35, G - 102);
    ctx.lineTo(x + 68, G - 86);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 26, G - 56, 18, 28);
    ctx.fillStyle = lv.mid;
  }
}
function drawBackground(lv) {
  if (lv.scene === 'palace') bgPalace(lv);
  else if (lv.scene === 'road') bgRoad(lv);
  else bgPass(lv);
  drawGround(lv);
}

/* ---------- 实体绘制 ---------- */
function drawZhangqin(x, y, t) {
  const img = Sprites.map.zhangqin;
  if (img) {
    const n = SHEET_FRAMES.zhangqin;
    const fw = img.width / n;
    const f = Math.floor(t * 8) % n;
    const bw = OBST_DEF.zhangqin.w, bh = OBST_DEF.zhangqin.h;
    const scale = Math.min(bw / fw, bh / img.height);
    const dw = fw * scale, dh = img.height * scale;
    ctx.drawImage(img, f * fw, 0, fw, img.height, x + (bw - dw) / 2, y + (bh - dh) / 2, dw, dh);
    return;
  }
  /* 占位：蓝袍御史，仗剑而立 */
  ctx.fillStyle = '#f0c8a0'; ctx.fillRect(x + 8, y + 2, 10, 9);
  ctx.fillStyle = '#1e293b'; ctx.fillRect(x + 6, y - 2, 14, 5);
  ctx.fillStyle = '#1e3a8a'; ctx.fillRect(x + 5, y + 11, 16, 22);
  ctx.fillStyle = '#93c5fd'; ctx.fillRect(x + 5, y + 13, 16, 2);
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(x + 1, y + 13, 4, 12);
  ctx.fillRect(x + 21, y + 13, 4, 12);
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(x + 6, y + 33, 5, 11);
  ctx.fillRect(x + 15, y + 33, 5, 11);
  ctx.fillStyle = '#9aa0aa'; ctx.fillRect(x + 24, y + 4, 3, 34);
  ctx.fillStyle = '#d4a017'; ctx.fillRect(x + 22, y + 20, 7, 3);
}
function drawSuo(x, y) {
  ctx.fillStyle = '#8a8f9c';
  ctx.fillRect(x + 4, y + 8, 10, 9);
  ctx.strokeStyle = '#8a8f9c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + 9, y + 8, 4, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = '#d4a017';
  ctx.fillRect(x + 8, y + 11, 2, 4);
}
function drawZouzhe(x, y, t) {
  const wob = Math.sin(t * 6) * 0.15;
  ctx.save();
  ctx.translate(x + 12, y + 7);
  ctx.rotate(wob);
  ctx.fillStyle = '#f5f0e0';
  ctx.fillRect(-12, -7, 24, 14);
  ctx.fillStyle = '#c04040';
  ctx.fillRect(-8, -3, 16, 2);
  ctx.fillRect(-8, 1, 16, 2);
  ctx.restore();
}
function drawObstacles() {
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const d = OBST_DEF[o.type];
    const oy = d.fly ? G - 74 : G - d.h;
    if (o.type === 'zhangqin') drawZhangqin(o.x, oy, o.t);
    else if (o.type === 'suo') drawSuo(o.x, oy);
    else drawZouzhe(o.x, oy, o.t);
  }
}
function drawSealItem(it) {
  const img = Sprites.map.yin;
  if (img) {
    ctx.drawImage(img, 0, 0, img.width, img.height, it.x, it.y, 18, 18);
    return;
  }
  ctx.fillStyle = '#ffd76a';
  ctx.fillRect(it.x + 2, it.y + 4, 14, 12);
  ctx.fillStyle = '#c04040';
  ctx.fillRect(it.x + 7, it.y, 4, 6);
  ctx.fillStyle = '#a02020';
  ctx.fillRect(it.x + 5, it.y + 8, 8, 2);
  ctx.fillRect(it.x + 5, it.y + 8, 2, 6);
  ctx.fillRect(it.x + 11, it.y + 8, 2, 6);
}
function drawItems() {
  for (let i = 0; i < items.length; i++) drawSealItem(items[i]);
}
function drawPlayer() {
  const t = player.animT;
  const x = PLAYER_X;
  const y = Math.floor(player.y);
  const zhushou = player.form === 'zhushou';
  const img = zhushou ? Sprites.map.zhushou : Sprites.map.zhuhouzhao;
  if (img) {
    const n = SHEET_FRAMES[zhushou ? 'zhushou' : 'zhuhouzhao'];
    const fw = img.width / n;
    const f = player.onGround ? Math.floor(t * 10) % n : Math.max(0, n - 2);
    /* 等比缩放，避免 32×32 源帧被拉伸变形（仅改绘制，不动碰撞盒） */
    const scale = Math.min(PLAYER_W / fw, PLAYER_H / img.height);
    const dw = fw * scale, dh = img.height * scale;
    ctx.drawImage(img, f * fw, 0, fw, img.height, x + (PLAYER_W - dw) / 2, y + (PLAYER_H - dh) / 2, dw, dh);
  } else {
    /* 占位像素小人：朱厚照=黄龙袍 / 朱寿=红甲金盔 */
    const skin = '#f0c8a0';
    const robe = zhushou ? '#c0342c' : '#e2b007';
    const trim = zhushou ? '#ffd76a' : '#7a1f1f';
    if (zhushou) {
      ctx.fillStyle = 'rgba(255,215,106,0.28)';
      ctx.fillRect(x - 4, y - 4, PLAYER_W + 8, PLAYER_H + 8);
    }
    ctx.fillStyle = skin;
    ctx.fillRect(x + 6, y, 12, 10);
    ctx.fillStyle = zhushou ? '#ffd76a' : '#2b2b2b';
    ctx.fillRect(x + 5, y - 2, 14, 5);
    if (zhushou) ctx.fillRect(x + 10, y - 6, 4, 5);
    ctx.fillStyle = robe;
    ctx.fillRect(x + 4, y + 10, 16, 20);
    ctx.fillStyle = trim;
    ctx.fillRect(x + 4, y + 12, 16, 2);
    ctx.fillRect(x + 4, y + 18, 16, 2);
    ctx.fillStyle = robe;
    ctx.fillRect(x + 1, y + 12, 4, 10);
    ctx.fillRect(x + 19, y + 12, 4, 10);
    ctx.fillStyle = '#3a2a1a';
    if (player.onGround) {
      if (Math.floor(t * 10) % 2) {
        ctx.fillRect(x + 5, y + 30, 6, 10);
        ctx.fillRect(x + 13, y + 30, 6, 8);
      } else {
        ctx.fillRect(x + 5, y + 30, 6, 8);
        ctx.fillRect(x + 13, y + 30, 6, 10);
      }
    } else {
      ctx.fillRect(x + 5, y + 30, 6, 8);
      ctx.fillRect(x + 13, y + 28, 6, 8);
    }
  }
  /* 变身将尽：闪烁提示 */
  if (zhushou && transformT > 0 && transformT < 1 && Math.floor(transformT * 8) % 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(x - 2, y - 2, PLAYER_W + 4, PLAYER_H + 4);
  }
}
function drawGate() {
  if (!gate) return;
  const x = Math.floor(gate.x);
  const w = gate.w;
  const top = portrait ? 60 : 44;
  /* 城台 */
  ctx.fillStyle = '#6b6470';
  ctx.fillRect(x, top, w, G - top);
  ctx.fillStyle = '#57505e';
  for (let yy = top + 8; yy < G - 80; yy += 14) ctx.fillRect(x + 4, yy, w - 8, 2);
  /* 垛口 */
  ctx.fillStyle = '#7d7686';
  for (let c = 0; c < w; c += 16) ctx.fillRect(x + c, top - 8, 9, 8);
  /* 匾额 */
  ctx.fillStyle = '#20242e';
  ctx.fillRect(x + w * 0.2, top + 10, w * 0.6, 20);
  ctx.fillStyle = '#e7c26a';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('居庸关', x + w / 2, top + 25);
  /* 券门与门板 */
  const dx = x + w * 0.28;
  const dw = w * 0.44;
  ctx.fillStyle = '#241d18';
  ctx.fillRect(dx, G - 66, dw, 66);
  ctx.beginPath();
  ctx.arc(dx + dw / 2, G - 66, dw / 2, Math.PI, 0);
  ctx.fill();
  if (gate.broken) {
    ctx.fillStyle = '#7a4a2a';
    ctx.fillRect(dx - 14, G - 60, 12, 58);
    ctx.fillRect(dx + dw + 2, G - 50, 12, 48);
  } else if (gate.opened) {
    ctx.fillStyle = '#7a4a2a';
    ctx.fillRect(dx - 6, G - 60, 8, 58);
    ctx.fillRect(dx + dw - 2, G - 60, 8, 58);
  } else {
    ctx.fillStyle = '#7a4a2a';
    ctx.fillRect(dx, G - 64, dw / 2 - 2, 64);
    ctx.fillRect(dx + dw / 2 + 2, G - 64, dw / 2 - 2, 64);
    ctx.fillStyle = '#d4a017';
    for (let sy = G - 56; sy < G - 8; sy += 12) {
      ctx.fillRect(dx + 4, sy, 2, 2);
      ctx.fillRect(dx + dw - 6, sy, 2, 2);
    }
    ctx.fillRect(dx + dw / 2 - 1, G - 40, 2, 8);
  }
}

/* ---------- HUD 与界面（横/竖屏双布局） ---------- */
function button(x, y, w, h, label, cb, primary) {
  uiButtons.push({ x: x, y: y, w: w, h: h, cb: cb });
  ctx.fillStyle = primary ? '#b3541e' : 'rgba(20,24,34,0.85)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = primary ? '#ffd76a' : '#8a8fa0';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = primary ? '#fff8e8' : '#d8dbe4';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2 + 4);
}
function drawHUD() {
  ctx.textAlign = 'left';
  if (mode === 'level') {
    const lv = LEVELS[levelIndex];
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(8, 8, 190, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(lv.act + ' · ' + lv.title, 14, 19);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(14, 22, 160, 5);
    ctx.fillStyle = '#ffd76a';
    ctx.fillRect(15, 23, Math.min(1, dist / lv.length) * 158, 3);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(8, 8, 120, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('奔袭 ' + fmtLi(dist) + ' 里', 14, 19);
    ctx.fillStyle = '#9a9ab0';
    ctx.font = '9px sans-serif';
    ctx.fillText('最远 ' + endlessBest + ' 里', 14, 29);
  }
  if (transformT > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(VW - 96, 8, 88, 20);
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('威武大将军 朱寿', VW - 52, 18);
    ctx.fillRect(VW - 90, 21, 76 * (transformT / TRANSFORM_TIME), 4);
  }
  if (hintT > 0 && state === 'play') {
    ctx.globalAlpha = Math.min(1, hintT);
    const tw = Math.min(VW - 10, hintText.length * 8.5 + 20);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect((VW - tw) / 2, VH - 34, tw, 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(hintText, VW / 2, VH - 21);
    ctx.globalAlpha = 1;
  }
}
function drawStoryOverlay() {
  const lv = LEVELS[levelIndex];
  ctx.fillStyle = 'rgba(8,10,18,0.72)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  const yAct = portrait ? 90 : 62;
  const yTitle = portrait ? 122 : 88;
  const yText = portrait ? 165 : 120;
  const lh = portrait ? 20 : 18;
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText(lv.act, VW / 2, yAct);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(lv.title, VW / 2, yTitle);
  ctx.fillStyle = '#e8e4d8';
  ctx.font = '11px sans-serif';
  wrapText(lv.before, VW / 2, yText, VW - 40, lh);
  if (Math.floor(gt * 2) % 2) {
    ctx.fillStyle = '#9a9ab0';
    ctx.font = '10px sans-serif';
    ctx.fillText('—— 点按任意处，开始 ——', VW / 2, VH - 46);
  }
}
function drawClearOverlay() {
  const lv = LEVELS[levelIndex];
  ctx.fillStyle = 'rgba(8,10,18,0.72)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7dd87d';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('本幕完成', VW / 2, portrait ? 110 : 58);
  ctx.fillStyle = '#e8e4d8';
  ctx.font = '11px sans-serif';
  wrapText(lv.after, VW / 2, portrait ? 150 : 92, VW - 40, 18);
  button(VW / 2 - 70, VH - 64, 140, 26, '下一幕 ▶', nextLevel, true);
}
function drawGameOverOverlay() {
  ctx.fillStyle = 'rgba(30,8,8,0.6)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  const yTitle = portrait ? 140 : 78;
  const yLine1 = portrait ? 172 : 104;
  const yLine2 = portrait ? 196 : 124;
  const yBtn = portrait ? 240 : 150;
  ctx.fillStyle = '#ff8a7a';
  ctx.font = 'bold 18px sans-serif';
  if (mode === 'level') {
    ctx.fillText('被拦下了！', VW / 2, yTitle);
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '11px sans-serif';
    ctx.fillText('张钦：「想出关？先过本官这一关！」', VW / 2, yLine1);
  } else {
    ctx.fillText('追之不及？不，是抓个正着', VW / 2, yTitle);
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '11px sans-serif';
    ctx.fillText('巡关御史张钦把你押回了京城……', VW / 2, yLine1);
    ctx.fillStyle = '#ffd76a';
    ctx.fillText('本次奔袭 ' + fmtLi(dist) + ' 里 · 最远 ' + endlessBest + ' 里', VW / 2, yLine2);
  }
  button(VW / 2 - 120, yBtn, 110, 26, mode === 'level' ? '重试本幕' : '再来一次', retry, true);
  button(VW / 2 + 10, yBtn, 110, 26, '回到主页', toMenu, false);
}
function drawCryingZhangqin(x, y) {
  const img = Sprites.map.cry;
  if (img) {
    const n = SHEET_FRAMES.cry;
    const fw = img.width / n;
    const f = Math.floor(finaleT * 6) % n;
    ctx.drawImage(img, f * fw, 0, fw, img.height, x, y, 48, 48);
    return;
  }
  /* 占位：掩面痛哭的御史 */
  const bob = Math.sin(finaleT * 10) * 1.5;
  const yy = y + bob;
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(x + 14, yy - 20, 20, 6);
  ctx.fillStyle = '#f0c8a0';
  ctx.fillRect(x + 16, yy - 14, 16, 12);
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(x + 12, yy - 2, 24, 26);
  ctx.fillStyle = '#93c5fd';
  ctx.fillRect(x + 12, yy, 24, 2);
  ctx.fillStyle = '#f0c8a0';
  ctx.fillRect(x + 14, yy - 12, 6, 8);
  ctx.fillRect(x + 28, yy - 12, 6, 8);
  ctx.fillStyle = '#7ec8f0';
  ctx.fillRect(x + 18, yy - 6 + (finaleT * 40) % 26, 2, 5);
  ctx.fillRect(x + 28, yy - 6 + (finaleT * 34) % 26, 2, 5);
}
function drawFinale() {
  ctx.fillStyle = 'rgba(6,8,18,0.66)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  if (finaleT > 0.3) {
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('—— 终 ——', VW / 2, portrait ? 60 : 46);
  }
  if (portrait) {
    /* 竖屏：人物居中，字幕在下方 */
    drawCryingZhangqin((VW - 48) / 2, 180);
    ctx.fillStyle = '#8a86a0';
    ctx.font = '9px sans-serif';
    ctx.fillText('巡关御史 · 张钦', VW / 2, 246);
  } else {
    drawCryingZhangqin(330, 170);
    ctx.fillStyle = '#8a86a0';
    ctx.font = '9px sans-serif';
    ctx.fillText('巡关御史 · 张钦', 354, 232);
  }

  /* 字幕（按时间顺序切换） */
  let sub = '';
  let subSize = 12;
  let subColor = '#e8e4d8';
  let subBold = true;
  if (finaleT > 8.6) {
    sub = '你，成功出关！\n（八幕完整篇章，敬请期待）';
    subSize = 13;
    subColor = '#ffd76a';
  } else if (finaleT > 6.4) {
    if (finaleSmashed) {
      sub = '隐藏成就【威武大将军】解锁！\n此后你以『朱寿』之名巡边宣府——\n次年十月，应州之战，边境安定十余年。';
      subColor = '#ffd76a';
    } else {
      sub = '谷大用奉命代守关门。\n张钦，永远慢了一步。';
    }
  } else if (finaleT > 4.2) {
    sub = '「负敕印，仗剑坐关门者，\n终究没能拦住他的皇帝。」\n——《明史 · 张钦传》';
    subSize = 10;
    subColor = '#b8b4c8';
    subBold = false;
  } else if (finaleT > 2.2) {
    sub = '御史张钦闻报疾追，\n但为时已晚——痛哭失声。';
  } else if (finaleT > 0.4) {
    sub = '居庸关外，尘烟未散。';
  }
  if (sub) {
    ctx.fillStyle = subColor;
    ctx.font = (subBold ? 'bold ' : '') + subSize + 'px sans-serif';
    if (portrait) wrapText(sub, VW / 2, 300, VW - 30, subSize + 8);
    else wrapText(sub, VW / 2 - 60, 84, 300, subSize + 6);
  }
  if (finaleT > 9) {
    const yBtn = portrait ? VH - 70 : VH - 52;
    button(VW / 2 - 120, yBtn, 110, 26, '再看一遍演出', function () { startLevel(levelIndex); }, false);
    button(VW / 2 + 10, yBtn, 110, 26, '返回主页', toMenu, true);
  }
}
function drawMenu() {
  drawBackground(MENU_BG);
  ctx.fillStyle = 'rgba(8,10,18,0.35)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText('正德十二年 · 像素跑酷', VW / 2, portrait ? 120 : 52);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('朱厚照出居庸关', VW / 2, portrait ? 158 : 84);
  ctx.fillStyle = '#b8b4c8';
  ctx.font = '10px sans-serif';
  ctx.fillText('一场说走就走的出走', VW / 2, portrait ? 184 : 104);
  button(VW / 2 - 90, portrait ? 240 : 128, 180, 30, '出关记 · 关卡模式（三幕）', function () { startLevel(0); }, true);
  button(VW / 2 - 90, portrait ? 285 : 168, 180, 30, '居庸关 · 无限跑酷', startEndless, false);
  ctx.fillStyle = '#8a86a0';
  ctx.font = '9px sans-serif';
  ctx.fillText('史料：《明史 · 张钦传》《明史 · 武宗本纪》', VW / 2, portrait ? 400 : 216);
  ctx.fillStyle = '#6a6680';
  ctx.fillText('点按或空格跳跃 · 拾取大将军印可变身朱寿', VW / 2, portrait ? 420 : 230);
}

/* ---------- 总渲染 ---------- */
function render() {
  uiButtons.length = 0;
  ctx.setTransform(PIXEL_SCALE, 0, 0, PIXEL_SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (state === 'menu') {
    drawMenu();
    return;
  }
  const bg = mode === 'level' ? LEVELS[levelIndex] : ENDLESS;
  ctx.save();
  if (shakeT > 0) ctx.translate(Math.floor(Math.random() * 8 - 4), Math.floor(Math.random() * 8 - 4));
  drawBackground(bg);
  if (state === 'finale') {
    drawFinale();
  } else {
    drawGate();
    drawObstacles();
    drawItems();
    drawPlayer();
    drawParticles();
  }
  ctx.restore();
  drawHUD();
  if (state === 'story') drawStoryOverlay();
  else if (state === 'clear') drawClearOverlay();
  else if (state === 'gameover') drawGameOverOverlay();
}

/* ---------- 主循环 ---------- */
function frame(now) {
  if (!last) last = now;
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  gt += dt;
  if (state === 'play') {
    updatePlay(dt);
  } else if (state === 'finale') {
    finaleT += dt;
    if (!finaleCry && finaleT > 1.0) { finaleCry = true; AudioSys.cry(); }
  }
  updateParticles(dt);
  if (shakeT > 0) shakeT -= dt;
  render();
  requestAnimationFrame(frame);
}

/* ---------- 启动 ---------- */
Sprites.load();
resetRun();
requestAnimationFrame(frame);
