'use strict';
/* ============================================================
 * 《朱厚照出居庸关》 像素跑酷 · juyong_escape（v1.0.0-wip 本地预览版）
 * ------------------------------------------------------------
 * v1.0.0：八幕扩关 + 关卡选择——
 *   - LEVELS 3 幕 → 8 幕（数据驱动，NES 难度锯齿：教学→施压→爆发→喘息→极速→最密→终局）
 *   - 幕 2 夜色 / 幕 6 破晓：tint 色罩（AI 背景 PNG 之上叠半透明色层）
 *   - 每幕 title screen 新增「史册」页：明史 + 实录双源文献节录（story 屏翻页）
 *   - 幕 5 奏折挂谏言彩蛋（随机文案）
 *   - 幕 8 终局字幕更新为应州大捷终章 + 「史辨」三行对照
 *   - 主菜单「出关记」选关页：通关一幕解锁下一幕（localStorage 持久化）
 * 双模式引擎：
 *   1) 关卡模式「出关记」：八幕叙事（LEVELS 数据驱动）
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
 *   Shiwei.png（侍卫，1 帧）
 *   Zhangqin_standing.png（张钦，站立单帧；未被玩家碰撞前用）
 *   Zhangqin.png（张钦，追击奔跑动画，N 帧横排；追玩家时用，帧数见 SHEET_FRAMES.zhangqin）
 *   yin.png（大将军印，1 帧）
 *   zhangqin_crying.png（张钦痛哭，8 帧横排，终局演出用）
 *   Gudayong_standing.png（谷大用站立态，1 帧；未被玩家碰触前）
 *   Gudayong_moving.png（谷大用跟随态，4 帧横排奔跑循环）
 * ============================================================ */

/* ---------- 渲染与物理常量 ---------- */
let PIXEL_SCALE = 3;           // 逻辑坐标 → 物理像素比例（layout() 按窗口尺寸与 DPR 动态计算）
const GRAVITY = 2400;
const JUMP_V = -820;
const JUMP_CUT = -300;         // 提前松手截断跳跃
const PLAYER_X = 72;
const PLAYER_W = 28;
const PLAYER_H = 57;   // 比侍卫障碍物(44)高，玩家更醒目（约原生13×27的2.1×）
const TRANSFORM_TIME = 6;      // 变身朱寿持续秒数
const PX_PER_LI = 150;         // 像素 → 里（显示用）
const FLY_OBST_OFFSET = 100;   // 飞行障碍物(奏折)离地高度偏移：越大越高（原 74）
const PORTRAIT_SPEED = 0.8;    // 竖屏速度补偿（横向视野短 → 放慢）
const COMP_W = 30;             // 谷大用（同伴）碰撞/绘制宽
const COMP_H = 52;             // 谷大用比玩家（57）略矮：年长微驼的老太监
const COMP_FOLLOW_DX = 36;     // 跟随时与玩家的水平间距

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
  alert: function () { this.tone(330, 0.09, 'square', 0.09, 0, 240); this.tone(330, 0.09, 'square', 0.09, 0.14, 240); },
  smash: function () { this.tone(90, 0.3, 'sawtooth', 0.12, 0, 40); this.tone(320, 0.12, 'square', 0.06, 0.02, 80); },
  /* 千斤闸（v1.2.0）：前摇 = 铁链绞盘咔哒（读时机的听觉通道）；落闸 = 闷雷砸地 */
  gateTele: function () { this.tone(150, 0.07, 'square', 0.06); this.tone(150, 0.07, 'square', 0.06, 0.1); this.tone(150, 0.07, 'square', 0.06, 0.2); },
  gateSlam: function () { this.tone(65, 0.22, 'sawtooth', 0.11, 0, 38); this.tone(200, 0.08, 'square', 0.05, 0.01, 90); },
  clear: function () { this.tone(523, 0.12, 'square', 0.07); this.tone(659, 0.12, 'square', 0.07, 0.12); this.tone(784, 0.2, 'square', 0.07, 0.24); },
  cry: function () { this.tone(392, 0.5, 'triangle', 0.06, 0, 330); this.tone(311, 0.8, 'triangle', 0.06, 0.6, 250); },
  /* 出关号角：上行大调琶音（出关是通关，不是碰撞） */
  victory: function () { this.tone(523, 0.14, 'square', 0.08); this.tone(659, 0.14, 'square', 0.08, 0.13); this.tone(784, 0.14, 'square', 0.08, 0.26); this.tone(1047, 0.42, 'square', 0.09, 0.39); }
};

/* ---------- 精灵表加载（缺失自动回退代码占位绘制） ---------- */
const SHEET_FRAMES = { zhuhouzhao: 4, zhushou: 4, shiwei: 1, zhangqin: 4, zhangqin_standing: 1, yin: 1, cry: 8, gudayong_standing: 1, gudayong_moving: 4 };
const Sprites = {
  map: {},
  load: function () {
    const files = {
      zhuhouzhao: 'Zhuhouzhao.png',
      zhushou: 'Zhushou.png',
      shiwei: 'Shiwei.png',
      zhangqin: 'Zhangqin.png',
      zhangqin_standing: 'Zhangqin_standing.png',
      yin: 'assets/yin.png',
      cry: 'Zhangqin_crying.png',
      gudayong_standing: 'Gudayong_standing.png',   // 站立态（未被玩家碰触前）
      gudayong_moving: 'Gudayong_moving.png',       // 跟随态（4 帧奔跑循环）
      bg_palace: 'scene_palace.png',
      bg_road: 'scene_road.png',
      bg_pass: 'scene_pass.png'
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
 * LEVELS：数据驱动关卡（八幕完整剧情 v1.0）
 * 八幕 = 正德十二年出关始末（史实骨架：《明史·武宗本纪》+《张钦传》+《梁储传》）
 * 难度曲线（NES 式锯齿）：250 → 270 → 290 → 300 → 240(喘息) → 410(极速) → 320(最密) → 330(终局)
 * 字段：quotes = title screen「史册」页节录（每幕两条：明史 + 实录）
 *       tint  = 背景 PNG 之上的半透明色罩（夜色/破晓）
 * ============================================================ */
const LEVELS = [
  {
    id: 1, act: '第一幕', title: '紫禁城 · 起心动念',
    before: '正德十二年，秋。\n蒙古小王子屡犯边境，\n紫禁城里的朱厚照坐不住了——\n这一次，他要亲自去看看边关。\n可拦住他的不是蒙古人，\n是满朝的奏折。',
    after: '《明史 · 武宗本纪》：\n「十二年八月，帝微服如昌平。」\n出京的念头，再也按不住了。',
    scene: 'palace',
    sky: ['#ffd9a0', '#ffab6b'], far: '#9c4f3f', mid: '#c25e43', ground: '#6b4226',
    speed: 250, interval: [1.9, 2.6], types: ['shiwei', 'zouzhe'], length: 5000,
    sealAt: [],
    hint: '前两个侍卫：看到「现在起跳！」再跳（长按更高）；奏折：不好跳——别跳，跑过去！',
    gate: false,
    quotes: [
      { src: '《明史 · 梁储传》', text: '「帝好微行，尝出西安门，经宿返。储等谏，不听。」' },
      { src: '《明武宗实录》', text: '「江彬，宣府人，欲挟上自恣，始诱为西北之行。」' }
    ]
  },
  {
    id: 2, act: '第二幕', title: '微服昌平 · 夜驰出京',
    before: '趁夜出京，没有大臣拦得住\n这位向往战场的皇帝。\n他连名字都换了——「朱寿」，\n一个自己封的「大将军」。\n夜路疾驰，居庸关越来越近。',
    after: '《明史 · 梁储传》：\n「八月朔，微服从数十骑幸昌平。\n次日，储、冕、纪始觉，\n追至沙河不及，连疏请回銮。」',
    scene: 'road', tint: 'rgba(24,34,78,0.42)',
    sky: ['#f6c06a', '#d97a4a'], far: '#6f5a6e', mid: '#8d6a5f', ground: '#4e3a2a',
    speed: 270, interval: [1.6, 2.2], types: ['shiwei', 'zouzhe'], length: 6000,
    sealAt: [0.4],
    hint: '拾「大将军印」变身朱寿——无敌撞碎一切！',
    gate: false,
    quotes: [
      { src: '《明史 · 梁储传》', text: '「微服从数十骑幸昌平。储、冕、纪始觉，追至沙河不及。」' },
      { src: '《明武宗实录》', text: '「八月甲辰朔，上微服从德胜门出幸昌平，外廷犹无知者。」' }
    ]
  },
  {
    id: 3, act: '第三幕', title: '抵关 · 张钦闭关藏钥',
    before: '居庸关下，巡关御史张钦\n早得密报。他做了两件事：\n闭关门，藏钥匙。\n朱厚照第一次出关，被挡了回去。',
    after: '《明史 · 武宗本纪》：\n「己酉，至居庸关，\n巡关御史张钦闭关拒命，乃还。」',
    scene: 'road',
    sky: ['#f6c06a', '#d97a4a'], far: '#6f5a6e', mid: '#8d6a5f', ground: '#4e3a2a',
    speed: 290, interval: [1.4, 2.0], types: ['shiwei', 'suo'], length: 5500,
    sealAt: [0.6],
    hint: '「锁」出现了——跳过它！谷大用也会赶来接驾！',
    gate: false,
    quotes: [
      { src: '《明史 · 武宗本纪》', text: '「己酉，至居庸关，巡关御史张钦闭关拒命，乃还。」' },
      { src: '《明武宗实录》', text: '张钦疏：「臣职守关，陛下即欲出，臣万死不敢奉诏。」' }
    ]
  },
  {
    id: 4, act: '第四幕', title: '关门对峙 · 敢言开关者斩',
    before: '关门之下，张钦负敕印，\n仗剑坐于门中：\n「敢言开关者，斩！」\n无人敢应——\n皇帝悻悻而回。',
    after: '第一次出关失败。\n但奏折拦不住、关门拦不住——\n他在等一个关防空虚的日子。',
    scene: 'pass',
    sky: ['#f6c06a', '#d97a4a'], far: '#3a3652', mid: '#4d4360', ground: '#2f2a3a',
    speed: 300, interval: [1.1, 1.6], types: ['shiwei', 'suo', 'zouzhe', 'zhangqin'], length: 6500,
    sealAt: [0.3, 0.7],
    hint: '张钦亲自坐镇！跳过他，或引他撞上障碍！',
    gate: false,
    quotes: [
      { src: '《明史 · 张钦传》', text: '「钦乃负敕印，仗剑坐关门下曰：敢言开关者，斩！」' },
      { src: '《明武宗实录》', text: '「是奏达于朝，上亦不闻也。」' }
    ]
  },
  {
    id: 5, act: '第五幕', title: '暂退修整 · 奏折如雨',
    before: '悻悻而回后，\n群臣劝谏的奏折铺天盖地。\n最难拦住他的不是关，\n是奏折。\n——这一幕，小心奏折雨。',
    after: '《明史 · 梁储传》：\n「储等忧惧，请回銮益急。\n章十余上，帝不为动。」',
    scene: 'palace',
    sky: ['#ffd9a0', '#ffab6b'], far: '#9c4f3f', mid: '#c25e43', ground: '#6b4226',
    speed: 240, interval: [0.9, 1.4], types: ['zouzhe'], length: 5000,
    sealAt: [],
    hint: '小心奏折雨——这一幕，折子会从天上掉下来！',
    gate: false,
    quotes: [
      { src: '《明史 · 梁储传》', text: '「储等忧惧，请回銮益急。章十余上，帝不为动。」' },
      { src: '《明武宗实录》', text: '「臣等及府部各衙门官俱日诣左顺门跪进章奏，伏请回銮。」' }
    ]
  },
  {
    id: 6, act: '第六幕', title: '趁虚疾驰 · 白羊口',
    before: '数日后，张钦前往白羊口巡视，\n关防空虚。\n探子飞马来报：\n皇帝的车驾，\n正朝居庸关疾驰而来！',
    after: '《明史 · 武宗本纪》：\n「丙寅，夜微服出德胜门，如居庸关。\n辛未，出关，幸宣府。」\n——这一次，没人拦得住他。',
    scene: 'road', tint: 'rgba(255,140,50,0.22)',
    sky: ['#f6c06a', '#d97a4a'], far: '#6f5a6e', mid: '#8d6a5f', ground: '#4e3a2a',
    speed: 410, interval: [1.5, 2.2], types: ['shiwei', 'suo', 'zouzhe', 'zhangqin'], length: 7000,
    sealAt: [0.5],
    hint: '极速疾驰！破晓时分，冲向居庸关！',
    gate: false,
    quotes: [
      { src: '《明史 · 武宗本纪》', text: '「丙寅，夜微服出德胜门，如居庸关。辛未，出关，幸宣府。」' },
      { src: '《明史 · 张钦传》', text: '帝疾驰出关，「数问『御史安在』」——一路狂奔，一路回头。' }
    ]
  },
  {
    id: 7, act: '第七幕', title: '断后 · 谷大用守关',
    before: '谷大用奉命守居庸关，\n为皇帝断后、拒追谏诸臣。\n关门，近在眼前。\n——中段的他，会为你护驾。',
    after: '《明史 · 武宗本纪》：\n「令太监谷大用守关，无纵出者。」\n这一次，守关的太监\n成了皇帝的内应。',
    scene: 'pass',
    sky: ['#2d3a5e', '#7a5a72'], far: '#3a3652', mid: '#4d4360', ground: '#2f2a3a',
    speed: 320, interval: [0.95, 1.4], types: ['shiwei', 'suo', 'zouzhe'], length: 8000,
    sealAt: [0.85],
    hint: '障碍最密！谷大用中段登场——碰触他获得护驾！',
    gate: false,
    quotes: [
      { src: '《明史 · 武宗本纪》', text: '「令太监谷大用守关，无纵出者。」' },
      { src: '《明武宗实录》', text: '「辛未，上度居庸关，遂幸宣府。」' }
    ]
  },
  {
    id: 8, act: '第八幕', title: '出关 · 痛哭失声',
    before: '最后一关。\n变身朱寿，撞开关门！\n或由谷大用开门相送——\n而张钦追至关下，\n将痛哭失声。',
    after: '',
    scene: 'pass',
    sky: ['#2d3a5e', '#7a5a72'], far: '#3a3652', mid: '#4d4360', ground: '#2f2a3a',
    speed: 330, interval: [1.0, 1.6], types: ['shiwei', 'suo', 'zouzhe', 'zhangqin'], length: 12000,
    sealAt: [0.92],                 // 印贴着关口出：变身 6s 足以裹挟到关门，保证以大将军形态出关
    compAt: 0.82,                   // 谷大用提前赶到关下候驾（守关放行，史实：谷大用守关纵帝出）
    hint: '疾驰！变身朱寿，撞开关门，出关！',
    gate: true,
    quotes: [
      { src: '《明史 · 武宗本纪》', text: '「丁未，亲督诸军御之，战五日。辛亥，寇引去，驻跸大同。」' },
      { src: '《明武宗实录》', text: '「是役也，斩虏首十六级，而我军死者五十二人，乘舆几陷。」' }
    ]
  }
];

/* 幕 5 彩蛋：奏折随机挂载的谏言文案（drawZouzhe 漂字） */
const ZOUZHE_MEMOS = [
  '臣恳请陛下回銮！', '伏惟陛下珍重圣躬', '章十上，伏乞圣断',
  '祖宗之法不可废！', '臣等泣血恳谏', '伏阙上书，请罢巡幸'
];

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
  shiwei: { w: 26, h: 44, fly: false },       // 守关侍卫（地面 · 跳过他）
  suo: { w: 28, h: 20, fly: false },          // 侍卫掷出的锁（明代横式广锁 · 地面 · 跳过）
  zouzhe: { w: 24, h: 14, fly: true },        // 飞来的奏折（空中 · 千万别跳）
  zhangqin: { w: 30, h: 48, fly: false },     // 追击型 BOSS：巡关御史张钦（巡逻→追击，不会跳跃）
  qianjin: { w: 24, h: 240, fly: false }      // v1.2.0 千斤闸（关城吊闸 · 定点时间障碍 · 四拍相位机）
};

/* ---------- 千斤闸（v1.2.0 wip1 · 四拍相位机，调研修订见 Wiki §3.1.1） ----------
 * 拍① 升 1.2s（无碰撞）→ 拍② 顶停 0.7s（通过窗口+节奏锚点）→ 拍③ 前摇 0.35s（震动+音效）→ 拍④ 落闸贴地 0.5s（唯一致死态）
 * 竖屏公平性：玩家不能停——spawn 相位校验保证抵达时必处安全相位带（升半开~顶停），永不「入屏即必死」 */
const QJ = {
  up: 1.2, top: 0.7, tele: 0.35, down: 0.5,   // 四拍时长（s）
  slam: 0.1,                                   // 拍④头部砸地段（0.1s 内 150→0，余下 0.4s 贴地封死）
  w: 24,                                       // 闸体宽（与 OBST_DEF.qianjin.w 一致）
  raise: 150,                                  // 全升后闸底离地净空（玩家高 57 的 2.6 倍，跑过无需操作）
  leaf: 240,                                   // 闸体全高（顶到地；满跳顶点 197px 也越不过）
  warnDist: 420                                // 预警距离 = 生成点外推距离：闸一生成即在预警带内，屏外全程亮灯（≈1.0-1.4s）
};
/* 相位推进：o.phase 0=升 1=顶停 2=前摇 3=落闸；o.pt 拍内计时。进前摇/落闸播报音效（读时机关键通道） */
function qjAdvance(o, dt) {
  o.pt += dt;
  const durs = [QJ.up, QJ.top, QJ.tele, QJ.down];
  while (o.pt >= durs[o.phase]) {
    o.pt -= durs[o.phase];
    o.phase = (o.phase + 1) % 4;
    if (o.phase === 3) { AudioSys.gateSlam(); burst(o.x + QJ.w / 2, G - 4, 6, '#8a8494'); }
    else if (o.phase === 2) AudioSys.gateTele();
  }
}
/* 闸体落放比例 0=全升 1=贴地；净空 = 闸底离地高度（<57 即物理不可通过）。
   拍①匀速升起；拍②③全升；拍④前 0.1s 快速砸地（ slamming），余下 0.4s 贴地封死 */
function qjDrop(o) {
  if (o.phase === 0) return 1 - o.pt / QJ.up;
  if (o.phase === 1 || o.phase === 2) return 0;
  return Math.min(1, o.pt / QJ.slam);
}
function qjOpening(o) { return QJ.raise * (1 - qjDrop(o)); }
/* spawn 相位校验：让闸在玩家抵达时恰处安全相位带 A∈[0.6, 1.76]（升半开 75px ~ 顶停末端，留 0.14s 余量）。
   A − t_a 可为负 → 取模回卷，闸可能以「贴地/前摇」态入屏再升起——玩家看得见完整四拍，抵达时必安全 */
function qjCalibrate(o) {
  const tA = (o.x - (PLAYER_X + PLAYER_W)) / Math.max(60, speed);   // 抵达耗时（speed 为生成帧实测值）
  const cycle = QJ.up + QJ.top + QJ.tele + QJ.down;
  const A = 0.6 + Math.random() * (1.76 - 0.6);
  let pos = ((A - tA) % cycle + cycle) % cycle;
  const durs = [QJ.up, QJ.top, QJ.tele, QJ.down];
  o.phase = 0;
  while (pos >= durs[o.phase]) { pos -= durs[o.phase]; o.phase++; }
  o.pt = pos;
}

/* ---------- 运行时状态 ---------- */
let state = 'menu';            // menu / story / play / clear / finale / gameover
let paused = false;            // 游戏内暂停（仅 play 态有效；暂停时逻辑冻结、渲染暂停菜单）
let mode = 'level';            // level / endless
let levelIndex = 0;
let gt = 0, last = 0;
let player, obstacles, items, particles, gate;
let dist, speed, spawnT, sealT, transformT, hintT, shakeT;
let usedSeals, gateDone, finaleT, finaleSmashed, finaleCry;
let outro = false, outroT = 0;          // v1.0.0 出关演出（马里奥式走关）
let outroNext = 'finale';               // 演出去向：幕8='finale' 终章字幕；其余幕='clear' 结算页（v1.0.3 各幕均有驰出演出，不再瞬间冻结）
let jumpCueStage = 0;                   // v1.0.3 幕1 教学：0=无 1=预备（长按教学） 2=现在起跳 3=本局已完成
let jumpCuePassed = 0;                  // v1.0.3 幕1：已过身侍卫计数（教满前 2 个侍卫后收课）
let zouzheCueStage = 0;                 // v1.0.3 幕1 教学：0=无 2=「不好跳」提示中 3=已完成（奏折：别跳跑过去）
let spawnCount = 0;                     // v1.0.3 幕1 教学脚本计数（第1、2障碍=侍卫、第3=奏折）
let firstObstDone = false;              // 幕 3 首障碍必为「锁」的一次性开关
let qjTaught = false;                   // v1.2.0 千斤闸首见教学（每跑一次）
let hintText = '';
let hintStory = false;   // v1.0.3 提示双通道：剧情播报（true）不受提示开关屏蔽，教学提示（false）受 hintsOn 控制
let endlessBest = parseInt(store.get('ming_escape_best') || '0', 10) || 0;
let companion = null, companionSpawnAt = -1, companionUsed = false;
let uiButtons = [];
/* v1.0.0 八幕扩关：story 翻页（剧情页/史册页）、菜单选关页、进度解锁 */
let storyPage = 0;              // story 态：0=剧情页 1=史册页
let menuPage = 'main';          // menu 态：main=主菜单 levels=选关页
let unlockedActs = parseInt(store.get('ming_escape_unlocked') || '0', 10) || 0;
let hintsOn = store.get('ming_escape_hints') !== '0';   // v1.0.3 游戏提示开关（默认开，localStorage 持久化）
let tutorUsed = false;          // v1.0.3 幕1教学：首个地面障碍挂起跳提示标（每跑一次）
let assist = false;             // v1.0.3 幕1辅助模式（本幕累计死亡≥3次自动开启，节奏放慢）
function unlockAct(i) {
  if (i > unlockedActs) { unlockedActs = i; store.set('ming_escape_unlocked', String(unlockedActs)); }
}

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
  /* 先按手动 \n 分段，再按实际宽度自动断行（中文无空格，逐字贪心断行），
     防止竖屏长引文水平溢出屏幕 */
  const paras = String(text).split('\n');
  let yy = y;
  for (let p = 0; p < paras.length; p++) {
    let line = '';
    for (let i = 0; i < paras[p].length; i++) {
      const test = line + paras[p][i];
      if (line && ctx.measureText(test).width > maxW) {
        ctx.fillText(line, x, yy);
        yy += lh;
        line = paras[p][i];
      } else {
        line = test;
      }
    }
    if (line) { ctx.fillText(line, x, yy); yy += lh; }
  }
  return yy;
}

/* ---------- 流程控制 ---------- */
function currentLevel() { return mode === 'level' ? LEVELS[levelIndex] : null; }

function resetRun() {
  player = { y: G - PLAYER_H, vy: 0, onGround: true, form: 'zhuhouzhao', animT: 0, landT: 0 };
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
  companion = null;
  companionUsed = false;
  companionSpawnAt = mode === 'endless' ? 1500 + Math.random() * 2000 : -1;
  outro = false; outroT = 0;
  firstObstDone = false;
  tutorUsed = false;
  jumpCueStage = 0;
  jumpCuePassed = 0;
  zouzheCueStage = 0;
  spawnCount = 0;
  paused = false;
}

function startLevel(i) {
  mode = 'level';
  levelIndex = i;
  resetRun();
  hintText = LEVELS[i].hint; hintStory = (i !== 0);   // 幕1开场=基本操作教学（可屏蔽）；幕2-8开场=剧情导览（不屏蔽）
  /* v1.0.3 幕1辅助：本幕累计死亡≥3次自动开启（隐性防卡关，不改变判定只放慢节奏） */
  assist = (i === 0 && (parseInt(store.get('ming_escape_a1dies') || '0', 10) || 0) >= 3);
  if (assist) hintText = '辅助模式：节奏放慢 15% —— 长按跳得更高，看到「跳！」再起跳！'; hintStory = true;
  storyPage = 0;
  state = 'story';
}

function startEndless() {
  mode = 'endless';
  assist = false;
  resetRun();
  hintText = '点按跳跃 · 拾「大将军印」变身朱寿！'; hintStory = true;
  state = 'play';
}

function toMenu() { paused = false; menuPage = 'main'; state = 'menu'; }

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
  if (state !== 'play' || paused) return;
  if (player.onGround) {
    player.onGround = false;
    player.vy = JUMP_V;
    player.takeoffT = 0.07;          // wip16 起跳蹬伸窗口（约4帧，快速衰减，只此一段形变）
    player.cut = false;
    AudioSys.jump();
    dust(PLAYER_X + PLAYER_W / 2, G, 4);
  }
}
function releaseJump() {
  /* wip16：松手不再瞬间把 vy 拍到 JUMP_CUT（那一下就是「半空被拽住」），
     改为打标记，物理更新里按指数衰减平滑滑向 JUMP_CUT */
  if (state === 'play' && !player.onGround && player.vy < JUMP_CUT) player.cut = true;
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
  if (e.code === 'KeyP' || e.code === 'Escape') {
    e.preventDefault();
    togglePause();
    return;
  }
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    AudioSys.ensure();
    if (state === 'play') {
      if (paused) { paused = false; return; }   // 暂停中按空格 = 继续游戏
      if (!outro) jump();                        // 出关演出中自动奔跑，不响应跳跃
    } else {
      confirmAction();
    }
  }
});
window.addEventListener('keyup', function (e) {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') releaseJump();
});

function togglePause() {
  if (state !== 'play') return;
  paused = !paused;
}
function toggleHints() {   // v1.0.3 游戏提示开关：教学底条 + HUD 提示条一并屏蔽，偏好持久化
  hintsOn = !hintsOn;
  store.set('ming_escape_hints', hintsOn ? '1' : '0');
}

function handleTap(lx, ly) {
  /* 按钮优先（含游戏内右上角暂停键与暂停菜单按钮），再落到跳跃 */
  for (let i = 0; i < uiButtons.length; i++) {
    const b = uiButtons[i];
    if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) { b.cb(); return; }
  }
  if (state === 'play') { if (!paused && !outro) jump(); return; }
  if (state === 'story') {
    /* 两页翻页：剧情页 → 史册页 → 出关 */
    if (storyPage === 0) storyPage = 1; else state = 'play';
    return;
  }
  if (state === 'finale' && finaleT > 9) { toMenu(); return; }
}

function confirmAction() {
  if (state === 'story') {
    if (storyPage === 0) storyPage = 1; else state = 'play';
  }
  else if (state === 'menu') { if (menuPage === 'main') startLevel(0); }
  else if (state === 'clear') nextLevel();
  else if (state === 'gameover') retry();
  else if (state === 'finale' && finaleT > 9) toMenu();
}

/* ---------- 生成 ---------- */
function spawnObstacle() {
  let types;
  if (mode === 'endless') {
    types = dist > 3000 ? ['shiwei', 'suo', 'zouzhe'] : ['shiwei', 'suo'];
    if (dist > 120 * PX_PER_LI) types.push('zhangqin');   // 无限模式：过 120 里后张钦登场
    /* v1.2.0 wip1 千斤闸：过 60 里后登场。按 2026-09-15 约定，新障碍先只在无限模式实测
       效果（数值手感/可读性/节奏），玩家反馈确认后再回头配关卡（幕 4/幕 7）与难度参数 */
    if (dist > 60 * PX_PER_LI) types.push('qianjin');
  } else {
    types = currentLevel().types.slice();                 // 张钦写在 L2/L3 types 里（与锁同规则）
  }
  /* 张钦全场唯一：已在场则本次改为生成其他障碍 */
  if (types.indexOf('zhangqin') >= 0 && obstacles.some(function (o) { return o.type === 'zhangqin'; })) {
    types = types.filter(function (t) { return t !== 'zhangqin'; });
  }
  /* 千斤闸同屏唯一：升降周期 + 长驻屏（全高门洞横穿全屏），双闸叠屏在实测期密度过高 */
  if (types.indexOf('qianjin') >= 0 && obstacles.some(function (o) { return o.type === 'qianjin'; })) {
    types = types.filter(function (t) { return t !== 'qianjin'; });
  }
  const type = types[Math.floor(Math.random() * types.length)];
  /* v1.0.0 幕 3 教学点：本幕第一个障碍必为「锁」（hint 里教的正是它）
     v1.0.3 幕 4 教学点：本幕第一个障碍必为「张钦」并挂教学标（教「跳过他或引他撞障碍」） */
  let firstType = type;
  let isTutorZq = false;
  if (mode === 'level' && !firstObstDone) {
    firstObstDone = true;
    if (levelIndex === 2) firstType = 'suo';
    else if (levelIndex === 3) { firstType = 'zhangqin'; isTutorZq = true; }
  }
  /* v1.0.3 幕 1 教学脚本：第 1、2 个障碍=侍卫（各配起跳提示）、第 3 个=奏折（配「不好跳」提示），其余随机。
     spawnCount 先自增再判断——保证每次开启第一关顺序恒定（此前判断在自增前导致首障碍随机） */
  spawnCount++;
  if (mode === 'level' && levelIndex === 0) {
    if (spawnCount <= 2) firstType = 'shiwei';
    else if (spawnCount === 3) firstType = 'zouzhe';
  }
  /* v1.2.0-wip3 无限模式教学脚本（与幕1同款节奏，「大约头五个」）：前 2 个=侍卫（起跳教学）、
     第 3 个=奏折（别跳教学）、第 4 个=锁（跳过它）；第 5 个起回归随机池自然混出 */
  if (mode === 'endless') {
    if (spawnCount <= 2) firstType = 'shiwei';
    else if (spawnCount === 3) firstType = 'zouzhe';
    else if (spawnCount === 4) firstType = 'suo';
  }
  /* v1.0.0 幕 5 彩蛋：奏折随机挂谏言文案 */
  const memo = (firstType === 'zouzhe' && mode === 'level' && levelIndex === 4)
    ? ZOUZHE_MEMOS[Math.floor(Math.random() * ZOUZHE_MEMOS.length)] : null;
  const ob = { type: firstType, x: VW + 50, t: 0, dead: false, chasing: false, chaseT: 0, cool: 0, memo: memo, tutor: isTutorZq };
  /* v1.2.0 千斤闸初始化：spawn 相位校验（抵达必安全）+ 首闸教学播报（教学通道，受提示开关控制）。
     wip2b：默认生成点 VW+50 太贴屏，预警只亮 ~0.15s——改为生成点=预警带外缘（VW+420），
     一生成即亮灯、屏外全程预警；qjCalibrate 按实际 x 动态校准相位，安全带结论不受生成距离影响 */
  if (firstType === 'qianjin') {
    ob.x = VW + QJ.warnDist;   // 生成点 = 预警带外缘：一生成即亮灯，屏外全程预警（≈1.0-1.4s，随速度反比）
    qjCalibrate(ob);
    if (!qjTaught) {
      qjTaught = true;
      hintText = '千斤闸升降有时——趁它升起时跑过去，千万别跳！'; hintT = 3; hintStory = false;
    }
  }
  /* v1.0.3 幕1教学：本跑首个「地面」障碍（侍卫）挂起跳提示标——
     奏折是飞行障碍（不能跳），提示必须出现在玩家遇到的第一个地上障碍上
     v1.2.0-wip3：无限模式同款（首个侍卫即首个障碍） */
  if ((mode === 'endless' || (mode === 'level' && levelIndex === 0)) && !tutorUsed && firstType === 'shiwei') {
    ob.tutor = true;
    tutorUsed = true;
  }
  /* v1.2.0-wip3 无限模式教学：第 4 个障碍=锁，一次性提示（教学通道，受「教学播报」开关控制） */
  if (mode === 'endless' && spawnCount === 4 && firstType === 'suo') {
    hintText = '地上有锁——跳过去！'; hintT = 2.5; hintStory = false;
  }
  /* v1.0.0 幕 5「奏折雨」：一半奏折从高空掉落——落地成路障（影子预警，引玩家跳过），
     与贴地飞行的奏折（不能跳）形成上下夹击，把「奏折如雨」具象化 */
  if (firstType === 'zouzhe' && mode === 'level' && levelIndex === 4 && Math.random() < 0.5) {
    ob.fall = true;
    ob.fy = G - 250 - Math.random() * 60;   // 当前高度（动态）
    ob.vy = 0;
    ob.landed = false;
  }
  obstacles.push(ob);
}

/* 障碍当前纵向位置：掉落型奏折用动态 fy，其余按 fly/地面固定 */
function obstY(o) {
  const d = OBST_DEF[o.type];
  if (o.fall) return o.fy;
  return d.fly ? G - FLY_OBST_OFFSET : G - d.h;
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
  else baseSpeed = lv.speed * (assist ? 0.85 : 1);   // v1.0.3 幕1辅助：死亡≥3次放慢 15%
  speed = baseSpeed * SF * (transformT > 0 ? 1.15 : 1);

  /* 出关演出：世界继续滚动，玩家驰出门洞；变身形态冻结；数秒后进终章字幕 */
  if (outro) {
    outroT += dt;
    if (transformT > 0) transformT = Math.max(transformT, 0.5);
    if (outroT > (outroNext === 'clear' ? 2.4 : 2.8)) {
      outro = false;
      if (outroNext === 'clear') {
        AudioSys.clear();
        state = 'clear';          // 谷大用留在结算页背景（v1.0.3：幕终不消失，仅摘「护驾」标）
      } else {
        companion = null;         // 幕8 终章字幕为独立画面，随演出结束退场
        state = 'finale';
        finaleT = 0;
      }
    }
  }
  player.animT += dt;
  if (player.landT > 0) player.landT -= dt;
  if (player.takeoffT > 0) player.takeoffT -= dt;
  if (!player.onGround) {
    /* wip16 截跳平滑衰减：约 70ms 时间常数滑向 JUMP_CUT，到值即止；
       期间重力照常作用，视觉上是「升势放缓」而非「急刹车」 */
    if (player.cut && player.vy < JUMP_CUT) {
      player.vy += (JUMP_CUT - player.vy) * Math.min(1, dt * 14);
      if (player.vy >= JUMP_CUT) player.vy = JUMP_CUT;
    }
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y >= G - PLAYER_H) {
      player.y = G - PLAYER_H;
      player.vy = 0;
      player.onGround = true;
      player.landT = 0.10;                               // 落地压扁回弹（wip13：减半减短）
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
    if (!nearGate && !outro) spawnObstacle();
  }

  /* 随机大将军印：仅无限模式。关卡模式的印一律走 sealAt 剧情印——
     教学节奏必须可控（幕 1 纯教学无印、幕 5 奏折关无印），不允许随机补印 */
  sealT -= dt;
  if (sealT <= 0) {
    sealT = 9 + Math.random() * 5;
    if (mode === 'endless' && transformT <= 0) spawnSeal(VW + 40, -(59 - Math.random() * 12));
  }
  /* 剧情保证印（按关卡进度比例触发，确保关键演出必有变身）
     关卡（gate:true）的印贴地摆放（rel -34），奔跑路径上直接拾取，不可能错过 */
  if (mode === 'level' && lv.sealAt && !outro) {
    for (let i = 0; i < lv.sealAt.length; i++) {
      const p = lv.sealAt[i];
      if (dist >= lv.length * p && usedSeals.indexOf(p) < 0) {
        usedSeals.push(p);
        spawnSeal(VW + 40, lv.gate ? -34 : -54);
      }
    }
  }

  /* 终局关门 */
  if (mode === 'level' && lv.gate && !gate && dist >= lv.length - 460) {
    gate = { x: VW + 60, w: 96, broken: false, opened: false };
  }

  const mv = speed * dt;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    o.x -= mv; o.t += dt;
    if (o.type === 'qianjin') qjAdvance(o, dt);   // v1.2.0 千斤闸四拍相位机（含前摇/落闸音效与落闸扬尘）
    /* v1.0.0 幕 5 掉落型奏折：加速下坠，落地成路障（扬尘提示） */
    if (o.fall && !o.landed) {
      o.vy += 1400 * dt;
      o.fy += o.vy * dt;
      if (o.fy >= G - OBST_DEF.zouzhe.h) {
        o.fy = G - OBST_DEF.zouzhe.h;
        o.landed = true;
        burst(o.x + 12, G - 2, 5, '#d8cba8');
        AudioSys.hit();
      }
    }
    if (o.type === 'zhangqin') {
      if (o.chasing) {
        if (transformT > 0) {
          /* 玩家变身：张钦追不上「威武大将军」，放弃追击被甩在身后（shaken：不再参与碰撞） */
          o.chasing = false;
          o.shaken = true;
          hintText = '张钦追不上「大将军」，被远远甩在身后！'; hintT = 2; hintStory = true;
        } else {
          o.chaseT += dt;
          if (o.cool > 0) o.cool -= dt;
          /* 追击：前馈（抵消世界流速）+ 比例修正 → 稳定贴在玩家身后。
             「身后」= 玩家左侧（世界左卷 = 玩家向右跑，右侧是玩家的前方）。
             精灵边缘间距 10px；双方碰撞盒各内缩 2px → 盒间净距 15px。
             谷大用护驾时张钦退到内应身后：谷大用正挡在皇帝与追兵之间
             （对应「谷大用守关，毋纵廷臣出」的位置关系）。 */
          const zqGap = (companion && companion.following) ? 14 + COMP_W : 10;
          const err = o.x - (PLAYER_X - OBST_DEF.zhangqin.w - zqGap);
          const corr = Math.max(-240, Math.min(300, err * 3));  // 正=向前贴，负=回落
          o.x += (speed - corr) * dt;
        }
      } else {
        /* 巡逻：原地左右踱步（被甩状态同此：随世界流速漂向屏幕左侧退场） */
        o.x += Math.sin(o.t * 1.6) * 42 * dt;
      }
    }
  }
  /* 追击中的张钦撞上其他障碍物 → 被撞晕退场（奏折飞得太高撞不到他） */
  for (let i = 0; i < obstacles.length; i++) {
    const a = obstacles[i];
    if (a.type !== 'zhangqin' || !a.chasing || a.dead) continue;
    const ad = OBST_DEF.zhangqin;
    const abox = { x: a.x + 2, y: G - ad.h + 2, w: ad.w - 4, h: ad.h - 4 };
    for (let j = 0; j < obstacles.length; j++) {
      if (j === i) continue;
      const b = obstacles[j], bd = OBST_DEF[b.type];
      const boy = obstY(b);
      if (rectsOverlap(abox, { x: b.x + 2, y: boy + 2, w: bd.w - 4, h: bd.h - 4 })) {
        a.dead = true;
        burst(a.x + ad.w / 2, G - ad.h / 2, 14, '#e0705a');
        AudioSys.smash();
        shakeT = 0.18;
        hintText = '张钦撞晕了！'; hintT = 1.5; hintStory = true;
        break;
      }
    }
  }
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
    const oy = obstY(o);
    /* 千斤闸特例：碰撞盒 = 当前闸体（升起时闸底悬空，跳进闸洞同样撞闸体——物理一致） */
    const obox = (o.type === 'qianjin')
      ? { x: o.x + 2, y: G - qjOpening(o) - QJ.leaf + 2, w: QJ.w - 4, h: QJ.leaf - 4 }
      : { x: o.x + 2, y: oy + 2, w: d.w - 4, h: d.h - 4 };
    if (rectsOverlap(pr, obox)) {
      if (o.type === 'zhangqin' && o.shaken) {
        /* 被甩的张钦：漂离途中不再参与任何碰撞（玩家从他身边跑过） */
      } else if (transformT > 0) {
        /* 变身朱寿：无敌撞碎——迎面遇上张钦也一样撞碎；护驾不受影响、不消耗 */
        o.dead = true;
        burst(o.x + d.w / 2, oy + d.h / 2, 12, '#ffd76a');
        AudioSys.smash();
        shakeT = 0.12;
      } else if (o.type === 'zhangqin' && !o.chasing && companion && companion.following) {
        /* 谷大用护驾：直接拦下巡逻张钦，玩家脱身（护驾消耗） */
        o.dead = true;
        burst(o.x + d.w / 2, oy + d.h / 2, 16, '#e0705a');
        burst(companion.x + COMP_W / 2, companion.y + COMP_H / 2, 10, '#d8d0e8');
        AudioSys.smash();
        AudioSys.hit();
        shakeT = 0.2;
        companion = null;
        hintText = '谷大用拦下张钦：「休得惊驾，陛下快走！」'; hintT = 2.5; hintStory = true;
      } else if (o.type === 'zhangqin' && !o.chasing) {
        /* 普通形态碰到巡逻中的张钦：不判死，触发追击 */
        o.chasing = true; o.chaseT = 0; o.cool = 0.9;
        AudioSys.alert();
        hintText = '张钦追上来了！跳过他，或引他撞上其他障碍！'; hintT = 2.5; hintStory = true;
      } else if (o.type === 'zhangqin' && o.cool > 0) {
        /* 追击触发后的宽限期，不判死 */
      } else if (companion && companion.following) {
        /* 谷大用护驾：替陛下挡下一次撞击，护驾解除（玩家不死）——含追击张钦的抓捕 */
        o.dead = true;
        burst(o.x + d.w / 2, oy + d.h / 2, 16, '#e8b4c8');
        burst(companion.x + COMP_W / 2, companion.y + COMP_H / 2, 10, '#d8d0e8');
        AudioSys.smash();
        AudioSys.hit();
        shakeT = 0.2;
        companion = null;
        hintText = '谷大用挡下了这一击：「奴婢……告退！」'; hintT = 2.5; hintStory = true;
      } else {
        die();
        return;
      }
    }
  }
  obstacles = obstacles.filter(function (o) { return !o.dead; });

  /* ---------- 谷大用（ companion 护驾） ----------
   * 规则：幕 3 起、关卡中段（默认 45%，可用 lv.compAt 覆写）从右侧入画；无限模式随机出现。
   * 公平性：登场前检查玩家前方空档——附近有障碍则推迟（下一帧重判），避免接驾路径被障碍切断。
   * 玩家碰触后跟随（同步跳跃），直到关卡结束 / 终局 / 玩家未变身时
   * 撞上障碍物——由谷大用替陛下挡下一次，护驾即解除。
   * 变身朱寿（无敌）时撞碎障碍物不算，护驾不受变身影响。 */
  if ((mode === 'level' && levelIndex >= 2 && !companionUsed && dist >= lv.length * (lv.compAt || 0.45)) ||
      (mode === 'endless' && !companion && dist >= companionSpawnAt)) {
    if (!companion) {
      /* 空档判定：玩家前方至屏幕右缘（含即将入屏者）均无存活障碍才登场 */
      let crowded = false;
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        if (!o.dead && o.x > PLAYER_X + 20 && o.x < VW + 80) { crowded = true; break; }
      }
      if (!crowded) {
        companion = { x: VW + 40, y: G - COMP_H, vy: 0, onGround: true, following: false, animT: 0 };
        if (mode === 'level') {
          companionUsed = true;                            // 关卡模式每幕只登场一次：错过/护驾消耗后不再刷新
          hintText = '谷大用赶来接驾——碰触他获得护驾！'; hintT = 2.5; hintStory = true;
          AudioSys.alert();
        } else {
          companionSpawnAt = dist + 2500 + Math.random() * 2000;
          /* v1.2.0-wip3b：无限模式登场也播同款提示（剧情通道不屏蔽）+ 登场音效，与关卡模式对齐 */
          hintText = '谷大用赶来接驾——碰触他获得护驾！'; hintT = 2.5; hintStory = true;
          AudioSys.alert();
        }
      }
    }
  }
  if (companion) {
    companion.animT += dt;
    if (companion.following) {
      /* 贴身护驾：横坐标钉死在玩家身后，纵坐标与玩家同步（脚底对齐 → 玩家跳他也跳） */
      companion.x = PLAYER_X - COMP_FOLLOW_DX;
      companion.y = player.y + (PLAYER_H - COMP_H);
      companion.vy = player.vy;
      companion.onGround = player.onGround;
    } else {
      companion.x -= mv;
      if (!companion.onGround) {
        companion.vy += GRAVITY * dt;
        companion.y += companion.vy * dt;
        if (companion.y >= G - COMP_H) {
          companion.y = G - COMP_H;
          companion.vy = 0;
          companion.onGround = true;
        }
      }
      const cr = { x: companion.x + 3, y: companion.y + 3, w: COMP_W - 6, h: COMP_H - 5 };
      if (rectsOverlap(pr, cr)) {
        companion.following = true;
        AudioSys.seal();
        AudioSys.transform();
        hintText = '谷大用：「陛下，奴婢护驾！」'; hintT = 2.5; hintStory = true;
      }
      if (companion.x < -60) companion = null;
    }
  }

  /* 关门判定 → 出关演出（outro）：变身朱寿=撞碎门（隐藏成就）；否则谷大用开门放行。
     音效用出关号角（victory）而非碰撞声——这不是撞墙，是通关。
     演出：清场（守军望驾而退）→ 世界继续滚动、玩家自动驰出门洞 → 数秒后进终章字幕 */
  if (gate && !gateDone && gate.x <= PLAYER_X + PLAYER_W) {
    gateDone = true;
    unlockAct(levelIndex + 1);
    if (transformT > 0) {
      finaleSmashed = true;
      gate.broken = true;
      shakeT = 0.6;
      burst(gate.x + 20, G - 70, 30, '#e7c26a');
      burst(gate.x + 50, G - 40, 20, '#8a6a4a');
    } else {
      gate.opened = true;
      burst(gate.x + 48, G - 40, 18, '#e7c26a');
    }
    AudioSys.victory();
    /* 守军望驾而退：清空障碍与道具（带粒子退场），出关路上不再有任何威胁 */
    for (let i = 0; i < obstacles.length; i++) {
      if (obstacles[i].type !== 'zhangqin') burst(obstacles[i].x + 10, G - 20, 3, '#b8a890');
    }
    obstacles = [];
    items = [];
    outro = true;
    outroT = 0;
    outroNext = 'finale';
    return;
  }

  /* v1.0.3 幕1 教学：前两个地面侍卫各给一次起跳时机提示——
     预备级（提前约170px）：「长按跳得更高」；起跳级（到理想起跳点）：脉冲标记 +「现在起跳！」。
     理想起跳点 = 侍卫距玩家前沿约 speed*0.40 px（满跳滞空 0.68s，起跳后恰在侍卫上方过顶）。
     cueCounted 标记过身侍卫只登记一次，两个都过身后收课 */
  if ((mode === 'endless' || (mode === 'level' && levelIndex === 0)) && jumpCueStage < 3 && !outro) {
    jumpCueStage = 0;
    const cueDist = Math.max(85, speed * 0.40);
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.type !== 'shiwei' || o.dead || o.cueCounted) continue;
      const gap = o.x - (PLAYER_X + PLAYER_W);
      if (gap < -40) { o.cueCounted = true; jumpCuePassed++; continue; }
      if (gap <= cueDist) jumpCueStage = 2;             // 到理想起跳点：现在起跳！
      else if (gap <= cueDist + 170) jumpCueStage = 1;  // 接近中：先教长按
      break;                                            // 只看最近一个未登记的侍卫
    }
    if (jumpCuePassed >= 2) jumpCueStage = 3;           // 前两个侍卫教完：收课
  }

  /* v1.0.3 幕1 教学：第一个奏折接近时提示「不好跳」——奏折离地100px，站立可跑过（玩家高57），
     跳跃顶点140px会撞上，正解是别跳。提示挂在最近的奏折上，过身即收课 */
  if ((mode === 'endless' || (mode === 'level' && levelIndex === 0)) && zouzheCueStage < 3 && !outro) {
    zouzheCueStage = 0;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.type !== 'zouzhe' || o.dead) continue;
      const gap = o.x - (PLAYER_X + PLAYER_W);
      if (gap < -40) zouzheCueStage = 3;                // 奏折已过：教学完成
      else if (gap <= 180) zouzheCueStage = 2;          // 接近中：提示别跳
      break;                                            // 只看最近的奏折
    }
  }

  /* 普通关完成：不再瞬间冻结切结算页（观感等同按暂停），同样走驰出演出——
     胜利号角 + 障碍粒子退场清场 → 世界继续滚动、玩家继续奔跑 →「第X幕 · 完」横幅 → 结算页 */
  if (mode === 'level' && !lv.gate && dist >= lv.length && !outro) {
    unlockAct(levelIndex + 1);
    AudioSys.victory();
    for (let i = 0; i < obstacles.length; i++) {
      if (obstacles[i].type !== 'zhangqin') burst(obstacles[i].x + 10, G - 20, 3, '#b8a890');
    }
    obstacles = [];
    items = [];
    outro = true;
    outroT = 0;
    outroNext = 'clear';
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
  /* v1.0.3 幕1辅助计数：卡关玩家累计死亡≥3次后自动放慢节奏 */
  if (mode === 'level' && levelIndex === 0) {
    store.set('ming_escape_a1dies', String((parseInt(store.get('ming_escape_a1dies') || '0', 10) || 0) + 1));
  }
  companion = null;
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
  /* 优先用 AI 生成的像素画背景 PNG（1:1 同步滚动：每 480px 世界距离完整循环一次，等比铺满画布） */
  const bgKey = lv.scene === 'palace' ? 'bg_palace' : lv.scene === 'road' ? 'bg_road' : 'bg_pass';
  const img = Sprites.map[bgKey];
  if (img) {
    const destH = VH;
    const destW = img.width * destH / img.height;
    const dx = -(dist % destW);
    for (let x = dx - destW; x < VW; x += destW) {
      ctx.drawImage(img, 0, 0, img.width, img.height, x, 0, destW, destH);
    }
  } else if (lv.scene === 'palace') bgPalace(lv);
  else if (lv.scene === 'road') bgRoad(lv);
  else bgPass(lv);
  drawGround(lv);
  /* v1.0.0：夜色/破晓色罩（叠在 AI 背景 PNG 与地面之上，实体绘制之前） */
  if (lv.tint) {
    ctx.fillStyle = lv.tint;
    ctx.fillRect(0, 0, VW, VH);
  }
}

/* ---------- 实体绘制 ---------- */
function drawShiwei(x, y, t) {
  const img = Sprites.map.shiwei;
  if (img) {
    const n = SHEET_FRAMES.shiwei;
    const fw = img.width / n;
    const f = Math.floor(t * 8) % n;
    const bw = OBST_DEF.shiwei.w, bh = OBST_DEF.shiwei.h;
    const scale = Math.min(bw / fw, bh / img.height);
    const dw = fw * scale, dh = img.height * scale;
    ctx.drawImage(img, f * fw, 0, fw, img.height, x + (bw - dw) / 2, y + (bh - dh) / 2, dw, dh);
    return;
  }
  /* 占位：蓝袍侍卫，仗剑而立 */
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
function drawZhangqin(x, y, t, o) {
  const chasing = o && o.chasing;
  const bw = OBST_DEF.zhangqin.w, bh = OBST_DEF.zhangqin.h;
  // 站立：优先 Zhangqin_standing.png（单帧）；缺失则回退到追击表首帧
  // 追击：Zhangqin.png（横排奔跑动画，帧数见 SHEET_FRAMES.zhangqin）
  const standImg = Sprites.map.zhangqin_standing || Sprites.map.zhangqin;
  const img = chasing ? Sprites.map.zhangqin : standImg;
  if (img) {
    const n = chasing ? SHEET_FRAMES.zhangqin : 1;     // 站立恒取单帧（首帧）
    const fw = img.width / n;
    const f = chasing ? (Math.floor(t * 10) % n) : 0;
    const scale = Math.min(bw / fw, bh / img.height);
    const dw = fw * scale, dh = img.height * scale;
    ctx.drawImage(img, f * fw, 0, fw, img.height, x + (bw - dw) / 2, y + (bh - dh) / 2, dw, dh);
  } else {
    /* 占位：绯袍御史张钦（乌纱帽），追击时前倾+怒目 */
    const lean = chasing ? 2 : 0;
    ctx.fillStyle = '#141420';                        // 乌纱帽+帽翅
    ctx.fillRect(x + 7 + lean, y - 2, 12, 5);
    ctx.fillRect(x + 2 + lean, y - 1, 5, 2); ctx.fillRect(x + 19 + lean, y - 1, 5, 2);
    ctx.fillStyle = '#f0c8a0';                        // 脸
    ctx.fillRect(x + 10 + lean, y + 3, 8, 7);
    if (chasing) {                                    // 怒目
      ctx.fillStyle = '#301810';
      ctx.fillRect(x + 11 + lean, y + 5, 2, 1); ctx.fillRect(x + 15 + lean, y + 5, 2, 1);
    }
    ctx.fillStyle = '#8c2f39';                        // 绯袍
    ctx.fillRect(x + 6 + lean, y + 10, 16, 24);
    ctx.fillStyle = '#c04040'; ctx.fillRect(x + 6 + lean, y + 12, 16, 2);
    ctx.fillStyle = '#d4a017';                        // 金腰带
    ctx.fillRect(x + 6 + lean, y + 20, 16, 2);
    ctx.fillStyle = '#26263a';                        // 腿
    ctx.fillRect(x + 8, y + 34, 5, 12); ctx.fillRect(x + 16, y + 34, 5, 12);
    ctx.fillStyle = '#101018';                        // 脚
    ctx.fillRect(x + 7, y + 45, 7, 3); ctx.fillRect(x + 15, y + 45, 7, 3);
    ctx.fillStyle = '#9aa0aa';                        // 佩剑
    ctx.fillRect(x + 24, y + 6, 3, 30);
    ctx.fillStyle = '#d4a017'; ctx.fillRect(x + 22, y + 22, 7, 3);
  }
  if (chasing && Math.floor(t * 6) % 2 === 0) {       // 追击感叹号
    ctx.fillStyle = '#e05a4a';
    ctx.fillRect(x + 13, y - 12, 4, 7);
    ctx.fillRect(x + 13, y - 3, 4, 2);
  }
}
/* 明代横式广锁（14×10 原生像素格，游戏内 2×）：
   纯长方枕形锁体（横式锁/枕头锁，无斜收不显圆）、顶部凹槽嵌直梁（V&A 嘉靖锁直梁形制）、
   正面无锁孔（广锁钥孔开在端面，正面本不可见）、一道弦纹、
   红绳绑钥匙缠于梁右端（台史博「红铜一字广锁」记载，红=威胁语义）。
   锁体静止绘制（用户要求不摆动）。 */
const SUO_GRID = [
  'OLLOMMMMMMRRLO',
  'OLLOMMMMMMMRLO',
  'OLBBBBBBBBBBDO',
  'OLBBBBBBBBBBDO',
  'OLBBBBBBBBBBDO',
  'OLDDDDDDDDDDDO',
  'OLBBBBBBBBBBDO',
  'OLBBBBBBBBBBDO',
  'OLBBBBBBBBBBDO',
  'OOOOOOOOOOOOOO'
];
const SUO_PAL = { O: '#241a08', L: '#d8ac48', B: '#bc9333', D: '#99732a', M: '#6b4e1c', R: '#a94438' };
function drawSuo(x, y) {
  const d = OBST_DEF.suo;
  const pw = d.w / 14, ph = d.h / 10;
  ctx.save();
  ctx.translate(x + d.w / 2, y + 2);
  for (let r = 0; r < SUO_GRID.length; r++) {
    const row = SUO_GRID[r];
    let c = 0;
    while (c < row.length) {
      const ch = row[c];
      let c2 = c;
      while (c2 < row.length && row[c2] === ch) c2++;
      if (ch !== '.') {
        ctx.fillStyle = SUO_PAL[ch];
        ctx.fillRect((c - 7) * pw, -2 + r * ph, (c2 - c) * pw + 0.5, ph + 0.5);
      }
      c = c2;
    }
  }
  ctx.restore();
}
function drawZouzhe(x, y, t, o) {
  /* 幕 5 彩蛋：谏言小字（深色底条 + 加大加亮，保证可读） */
  if (o && o.memo) {
    ctx.font = 'bold 10px sans-serif';
    const tw = ctx.measureText(o.memo).width;
    ctx.fillStyle = 'rgba(24,18,30,0.78)';
    ctx.fillRect(x + 12 - tw / 2 - 5, y - 21, tw + 10, 14);
    ctx.fillStyle = '#ffe9a8';
    ctx.textAlign = 'center';
    ctx.fillText(o.memo, x + 12, y - 10);
  }
  /* 掉落型：快速翻滚；飞行型：轻微摇摆 */
  const wob = (o && o.fall && !o.landed) ? o.t * 9 : Math.sin(t * 6) * 0.15;
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
/* v1.2.0 千斤闸：门框先行（入屏第一帧即见石柱/横梁/闸槽——定点障碍的位置预告免费，玩家只需学相位）。
   闸叶只画在门框窗口内的可见段（升起时缩到门洞顶部，不悬出梁外）；拍③震动；拍④贴地一线红警示 */
/* v1.2.0-wip2 屏缘预警：闸体尚在屏右外侧逼近时，右缘闪双红感叹号（天天酷跑验证过的可读性手段）。
   入屏即收（门框先行已接管位置预告）；判定/透明度拆成纯函数便于测试 */
function qjWarnVisible(o) {
  return o.type === 'qianjin' && !o.dead && o.x > VW + 8 && o.x - VW < QJ.warnDist;
}
function qjWarnAlpha(t) {
  return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 9));   // ≈1.4Hz 呼吸脉冲（gt 驱动，暂停也走）
}
function drawQjWarn() {
  const gate = obstacles.find(qjWarnVisible);
  if (!gate) return;
  const a = qjWarnAlpha(gt);
  /* 两个像素感叹号：竖条+点，右缘竖向中段（跑道核心区），深红衬底防浅色背景吞色 */
  const bx = VW - 30, by = G - 118;
  ctx.globalAlpha = a;
  for (let k = 0; k < 2; k++) {
    const x = bx + k * 13;
    ctx.fillStyle = '#501313';
    ctx.fillRect(x + 1, by + 1, 6, 18); ctx.fillRect(x + 1, by + 23, 6, 6);
    ctx.fillStyle = '#E24B4A';
    ctx.fillRect(x, by, 6, 18); ctx.fillRect(x, by + 22, 6, 6);
  }
  ctx.globalAlpha = 1;
}

function drawQianjin(o) {
  const drop = qjDrop(o);
  const open = qjOpening(o);
  const bx = o.x + ((o.phase === 2) ? Math.sin(o.pt * 80) * 1.2 : 0);   // 拍③ 前摇震动（音效同步）
  const leafBottom = G - open;
  const leafTop = leafBottom - QJ.leaf;
  /* 门框：两侧石柱 + 顶部横梁 + 闸槽阴影（恒定可见） */
  ctx.fillStyle = '#4e4660';
  ctx.fillRect(o.x - 6, G - QJ.leaf - 14, 6, QJ.leaf + 14);
  ctx.fillRect(o.x + QJ.w, G - QJ.leaf - 14, 6, QJ.leaf + 14);
  ctx.fillStyle = '#5f5772';
  ctx.fillRect(o.x - 8, G - QJ.leaf - 20, QJ.w + 16, 10);
  ctx.fillStyle = '#2e2940';
  ctx.fillRect(o.x - 2, G - QJ.leaf - 12, QJ.w + 4, 4);
  /* 闸体：铁制横棂闸叶，可见段裁切到门框窗口 [G-QJ.leaf, G] */
  const visTop = Math.max(leafTop, G - QJ.leaf);
  const visBottom = Math.min(leafBottom, G);
  if (visBottom > visTop) {
    ctx.fillStyle = '#332e40';
    ctx.fillRect(bx, visTop, QJ.w, visBottom - visTop);
    ctx.fillStyle = '#4a4358';
    for (let y = leafTop + 6; y < leafBottom - 4; y += 14) {
      if (y >= visTop && y + 4 <= visBottom) ctx.fillRect(bx + 2, y, QJ.w - 4, 4);
    }
    ctx.fillStyle = '#5c5468';
    ctx.fillRect(bx, visTop, 3, visBottom - visTop);
    ctx.fillStyle = '#241f30';
    ctx.fillRect(bx + QJ.w - 3, visTop, 3, visBottom - visTop);
    ctx.fillStyle = '#8a8494';
    for (let y = leafTop + 10; y < leafBottom - 6; y += 28) {
      if (y >= visTop && y + 2 <= visBottom) { ctx.fillRect(bx + 5, y, 2, 2); ctx.fillRect(bx + QJ.w - 7, y, 2, 2); }
    }
  }
  /* 唯一致死态强信号：贴地时闸底一线红 */
  if (o.phase === 3 && drop > 0.85) {
    ctx.fillStyle = '#c04040';
    ctx.fillRect(bx, G - 3, QJ.w, 3);
  }
}
function drawObstacles() {
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const d = OBST_DEF[o.type];
    const oy = obstY(o);
    /* 掉落型奏折：地面落点影子预警（引玩家提前起跳） */
    if (o.fall && !o.landed) {
      ctx.fillStyle = 'rgba(10,8,14,0.30)';
      ctx.beginPath();
      ctx.ellipse(o.x + 12, G - 2, 12, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (o.type === 'zhangqin') drawZhangqin(o.x, oy, o.t, o);
    else if (o.type === 'shiwei') drawShiwei(o.x, oy, o.t);
    else if (o.type === 'suo') drawSuo(o.x, oy);
    else if (o.type === 'qianjin') drawQianjin(o);
    else drawZouzhe(o.x, oy, o.t, o);
    /* v1.0.3 幕1教学：起跳提示——「预备…」→ 进入起跳窗闪「跳！」+ 长按教学副行。
       窗口按满跳滞空 0.68s × 幕1速度 250px/s ≈ 170px 设定 */
    if (o.tutor && (mode === 'endless' || (mode === 'level' && levelIndex === 0)) && !outro) {
      const gap = o.x - (PLAYER_X + PLAYER_W);
      if (o.x < VW + 30 && gap > -60) {
        const bob = Math.sin(gt * 6) * 3;
        const cx = o.x + d.w / 2;
        ctx.textAlign = 'center';
        if (gap <= 170) {
          ctx.globalAlpha = 0.75 + 0.25 * Math.sin(gt * 14);
          ctx.fillStyle = '#ffd76a';
          ctx.font = 'bold 20px sans-serif';
          ctx.fillText('跳！', cx, oy - 46 + bob);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = 'rgba(232,228,216,0.85)';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText('预备…', cx, oy - 46 + bob);
        }
        ctx.fillStyle = '#ffd76a';
        ctx.beginPath();
        ctx.moveTo(cx, oy - 32 + bob);
        ctx.lineTo(cx - 6, oy - 40 + bob);
        ctx.lineTo(cx + 6, oy - 40 + bob);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(232,228,216,0.78)';
        ctx.font = '9px sans-serif';
        ctx.fillText('长按跳得更高', cx, oy - 64 + bob);
      }
    }
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
    /* v1.0.3-wip13 跳跃手感·去果冻版：
       空中完全不形变（拉伸/压扁/前倾叠在一起读起来像果冻，还显得人脱离跑道），
       动感只靠上升/下落换帧（跑步姿势本身就有腾跃感）；
       仅保留落地一瞬的小幅压扁（0.10s、≤5%，脚底锚点头下沉，不破坏贴地）。 */
    let f;
    if (player.onGround) f = Math.floor(t * 10) % n;
    else f = player.vy < 0 ? n - 2 : n - 1;
    /* 跑动颠步（与谷大用同款）：地面时每两帧整体上抬 1px，纯位移不形变，
       只在 onGround 生效——跳起/落地压扁期间自动归零，不会与 squash 打架 */
    const bob = player.onGround && player.landT <= 0 ? Math.floor(t * 10) % 2 : 0;
    /* 等比缩放，避免源帧被拉伸变形（仅改绘制，不动碰撞盒） */
    const scale = Math.min(PLAYER_W / fw, PLAYER_H / img.height);
    const dw = fw * scale, dh = img.height * scale;
    let sx = 1, sy = 1;
    if (player.onGround && player.landT > 0) {
      const k = player.landT / 0.10;
      sy = 1 - 0.05 * k; sx = 1 + 0.04 * k;                          // 落地压扁→弹回（减半减短）
    } else if (!player.onGround && player.takeoffT > 0) {
      /* wip16 起跳蹬伸：只在离地头几帧（0.07s 内 1→0 衰减），
         幅度 ≤6% 且快速收敛——是「蹬地一蹬」的脉冲，不是 wip12 那种全程拉伸的果冻 */
      const s = player.takeoffT / 0.07;
      sy = 1 + 0.06 * s; sx = 1 - 0.04 * s;
    }
    ctx.save();
    ctx.translate(x + PLAYER_W / 2, y + PLAYER_H - bob);
    ctx.scale(sx, sy);
    /* 锚点=脚底中心：精灵从 -dh 画到 0，脚底正好落在锚点上 */
    ctx.drawImage(img, f * fw, 0, fw, img.height, -dw / 2, -dh, dw, dh);
    ctx.restore();
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
function drawGudayong(x, y, t, c) {
  const following = c && c.following;
  const img = following ? Sprites.map.gudayong_moving : Sprites.map.gudayong_standing;
  if (img) {
    const n = following ? SHEET_FRAMES.gudayong_moving : 1;
    const fw = img.width / n;
    /* 跳跃表现与朱厚照完全同款（wip14）：空中不播跑步循环，改用上升/下落两帧；
       落地一瞬小幅压扁（复用玩家的 landT——跟随态纵坐标与玩家同步，落地同帧）；
       地面跑动保留 1px 颠步，压扁/腾空时归零 */
    let f;
    if (following) {
      if (c.onGround) f = Math.floor(t * 10) % n;
      else f = player.vy < 0 ? n - 2 : n - 1;
    } else f = 0;                                       // 站立恒取首帧
    const bob = following && c.onGround && player.landT <= 0 ? Math.floor(t * 10) % 2 : 0;
    /* 等比缩放：各图原生尺寸 → COMP_W×COMP_H 盒内 */
    const scale = Math.min(COMP_W / fw, COMP_H / img.height);
    const dw = fw * scale, dh = img.height * scale;
    let sx = 1, sy = 1;
    if (following && c.onGround && player.landT > 0) {
      const k = player.landT / 0.10;
      sy = 1 - 0.05 * k; sx = 1 + 0.04 * k;            // 落地压扁→弹回（与玩家同款）
    } else if (following && !c.onGround && player.takeoffT > 0) {
      const s = player.takeoffT / 0.07;
      sy = 1 + 0.06 * s; sx = 1 - 0.04 * s;            // 起跳蹬伸（与玩家同款）
    }
    ctx.save();
    /* 锚点=盒底中心（颠步整体上抬、压扁时头下沉，脚底不脱离地面线） */
    ctx.translate(x + COMP_W / 2, y + COMP_H - bob);
    ctx.scale(sx, sy);
    ctx.drawImage(img, f * fw, 0, fw, img.height, -dw / 2, -dh, dw, dh);
    ctx.restore();
  } else {
    /* 占位：提督西厂的谷大用——大红蟒衣 · 乌纱描金曲脚帽 · 拂尘 · 无须老太监 */
    const bob = following && player.onGround ? Math.floor(t * 10) % 2 : 0;
    const yy = y + bob;
    ctx.fillStyle = '#141420';                          // 乌纱描金曲脚帽（帽体+两侧上翘曲脚）
    ctx.fillRect(x + 8, yy - 2, 14, 6);
    ctx.fillRect(x + 2, yy - 4, 6, 2);                  // 左曲脚
    ctx.fillRect(x + 22, yy - 4, 6, 2);                 // 右曲脚
    ctx.fillStyle = '#e8d0b8';                          // 苍白无须老脸
    ctx.fillRect(x + 11, yy + 4, 9, 8);
    ctx.fillStyle = '#301810';                          // 细眼
    ctx.fillRect(x + 13, yy + 7, 2, 1); ctx.fillRect(x + 17, yy + 7, 2, 1);
    ctx.fillStyle = '#8a1f2e';                          // 大红蟒衣（曳撒）
    ctx.fillRect(x + 5, yy + 12, 20, 28);
    ctx.fillStyle = '#c8a04a';                          // 金线蟒纹（胸背点缀）
    ctx.fillRect(x + 10, yy + 17, 3, 3); ctx.fillRect(x + 17, yy + 20, 3, 3);
    ctx.fillRect(x + 5, yy + 14, 20, 1);                // 领缘
    ctx.fillStyle = '#701822';                          // 下摆开衩阴影
    ctx.fillRect(x + 5, yy + 34, 20, 6);
    ctx.fillStyle = '#1a1a24';                          // 皂靴
    ctx.fillRect(x + 8, yy + 40, 6, 4); ctx.fillRect(x + 16, yy + 40, 6, 4);
    ctx.fillStyle = '#5a4a3a';                          // 拂尘杆（右手侧）
    ctx.fillRect(x + 25, yy + 12, 2, 16);
    ctx.fillStyle = '#e8e4dc';                          // 拂尘白丝
    ctx.fillRect(x + 24, yy + 28, 4, 9);
    ctx.fillStyle = '#d4a017';                          // 镶金腰带来一点权宦气派
    ctx.fillRect(x + 5, yy + 24, 20, 2);
  }
  if (following && !outro && state === 'play') {        // 护驾状态小标（幕终驰出/结算页不再显示，v1.0.3）
    ctx.fillStyle = 'rgba(20,24,34,0.72)';
    ctx.fillRect(x + 3, y - 16, 24, 12);
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('护驾', x + 15, y - 7);
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
  /* 游戏内暂停键：左上角、进度条面板下方（与面板左对齐）；仅竖屏下移 15px 方便拇指触达 */
  if (state === 'play' && !paused) {
    const pbx = 8, pby = (portrait ? 53 : 38);
    uiButtons.push({ x: pbx, y: pby, w: 18, h: 18, cb: togglePause });
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(pbx, pby, 18, 18);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pbx + 0.5, pby + 0.5, 17, 17);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(pbx + 5, pby + 4, 3, 10);
    ctx.fillRect(pbx + 10, pby + 4, 3, 10);
  }
  if (mode === 'level') {
    const lv = LEVELS[levelIndex];
    const hy = portrait ? 23 : 8;   /* 竖屏整体下移 15px，方便拇指操作；横版贴顶 */
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(8, hy, 190, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(lv.act + ' · ' + lv.title, 14, hy + 11);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(14, hy + 14, 160, 5);
    ctx.fillStyle = '#ffd76a';
    ctx.fillRect(15, hy + 15, Math.min(1, dist / lv.length) * 158, 3);
  } else {
    const hy = portrait ? 23 : 8;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(8, hy, 120, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('奔袭 ' + fmtLi(dist) + ' 里', 14, hy + 11);
    ctx.fillStyle = '#9a9ab0';
    ctx.font = '9px sans-serif';
    ctx.fillText('最远 ' + endlessBest + ' 里', 14, hy + 21);
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
  if (hintT > 0 && state === 'play' && (hintsOn || hintStory)) {   // 剧情播报不受提示开关屏蔽（wip18）
    ctx.globalAlpha = Math.min(1, hintT);
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    /* 竖屏逻辑宽仅 270px：超宽播报自动折两行（优先就近标点/空格断行），底条随之加高（wip21） */
    var hLines = [hintText];
    if (ctx.measureText(hintText).width > VW - 16) {
      var hMid = Math.ceil(hintText.length / 2), hCut = -1, hd;
      var hPunc = '，。！？：；、·…—　 ';
      for (hd = 0; hd < hMid && hCut < 0; hd++) {
        if (hPunc.indexOf(hintText.charAt(hMid - 1 - hd)) >= 0) hCut = hMid - hd;
        else if (hPunc.indexOf(hintText.charAt(hMid + hd)) >= 0) hCut = hMid + hd + 1;
      }
      if (hCut < 0) hCut = hMid;
      hLines = [hintText.slice(0, hCut), hintText.slice(hCut)];
    }
    var hW = 0;
    for (var hi = 0; hi < hLines.length; hi++) {
      var hw = ctx.measureText(hLines[hi]).width;
      if (hw > hW) hW = hw;
    }
    var htw = Math.min(VW - 10, Math.ceil(hW) + 20);
    var hbh = hLines.length > 1 ? 32 : 20;
    var hby = VH - 14 - hbh;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect((VW - htw) / 2, hby, htw, hbh);
    ctx.fillStyle = '#ffffff';
    for (hi = 0; hi < hLines.length; hi++) {
      ctx.fillText(hLines[hi], VW / 2, hby + 13 + hi * 12);
    }
    ctx.globalAlpha = 1;
  }
}
function drawPauseOverlay() {
  ctx.fillStyle = 'rgba(8,10,18,0.72)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('圣驾暂驻', VW / 2, portrait ? VH / 2 - 52 : VH / 2 - 44);
  ctx.fillStyle = '#b8b4c8';
  ctx.font = '10px sans-serif';
  ctx.fillText('途中暂停 · 不计胜负', VW / 2, portrait ? VH / 2 - 30 : VH / 2 - 24);
  button(VW / 2 - 70, portrait ? VH / 2 - 4 : VH / 2 - 2, 140, 30, '继续亲政', function () { paused = false; }, true);
  button(VW / 2 - 70, portrait ? VH / 2 + 40 : VH / 2 + 40, 140, 30, '回銮 · 主菜单', toMenu, false);
  button(VW / 2 - 70, portrait ? VH / 2 + 80 : VH / 2 + 80, 140, 26, '教学播报：' + (hintsOn ? '开' : '关'), toggleHints, false);
  ctx.fillStyle = '#6a6680';
  ctx.font = '9px sans-serif';
  ctx.fillText('按 P / Esc / 空格 也可继续', VW / 2, portrait ? VH / 2 + 122 : VH / 2 + 120);
}
function drawStoryOverlay() {
  const lv = LEVELS[levelIndex];
  ctx.fillStyle = 'rgba(8,10,18,0.72)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  if (storyPage === 0) {
    /* 页 1：剧情 */
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
      ctx.fillText('—— 点按任意处，翻页 ——', VW / 2, VH - 46);
    }
  } else {
    /* 页 2：史册（文献节录，明史 + 实录双源） */
    const yAct = portrait ? 80 : 56;
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('—— 史 册 ——', VW / 2, yAct);
    ctx.fillStyle = '#8a86a0';
    ctx.font = '9px sans-serif';
    ctx.fillText(lv.act + ' · ' + lv.title, VW / 2, yAct + 18);
    let yy = yAct + (portrait ? 58 : 42);
    for (let q = 0; q < lv.quotes.length; q++) {
      const qu = lv.quotes[q];
      ctx.fillStyle = '#c8a04a';
      ctx.font = 'bold 8px sans-serif';
      ctx.fillText(qu.src, VW / 2, yy);
      ctx.fillStyle = '#e8e4d8';
      ctx.font = '10px sans-serif';
      yy = wrapText(qu.text, VW / 2, yy + 15, VW - 56, 15) + 14;
    }
    if (Math.floor(gt * 2) % 2) {
      ctx.fillStyle = '#9a9ab0';
      ctx.font = '10px sans-serif';
      ctx.fillText('—— 点按任意处，出发 ——', VW / 2, VH - 46);
    }
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
    /* 横屏：立绘放字幕文字块右侧、与其垂直对齐（字幕居中 x=180，右缘最坏 ~330；
     * 立绘底部 y124、标签 y138，远离按钮行 y218——v1.0.0-r4 自右上角左移贴字） */
    drawCryingZhangqin(336, 76);
    ctx.fillStyle = '#8a86a0';
    ctx.font = '9px sans-serif';
    ctx.fillText('巡关御史 · 张钦', 360, 138);
  }

  /* 字幕（按时间顺序切换） */
  let sub = '';
  let subSize = 12;
  let subColor = '#e8e4d8';
  let subBold = true;
  if (finaleT > 8.6) {
    sub = '你，成功出关！\n十月，应州之战，亲冒矢石——\n自此边境安定十余年。';
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
    /* 引文为《明史 · 张钦传》原文（已核对：「钦闻，追之，已不及」「钦感愤，西望痛哭」） */
    sub = '「钦闻，追之，已不及。」\n「钦感愤，西望痛哭。」\n——《明史 · 张钦传》';
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
  /* v1.0.0 终章实录节录：仅保留《明武宗实录》一手史料（原文已核对卷154：
     「是役也，斩虏首十六级，而我军死者五十二人」） */
  if (finaleT > 11) {
    ctx.fillStyle = '#b8b4c8';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('「是役也，斩虏首十六级。」——《明武宗实录》', VW / 2, portrait ? 364 : 170);
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
  ctx.fillText('正德十二年·逃', VW / 2, portrait ? 120 : 52);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('朱厚照出居庸关', VW / 2, portrait ? 158 : 84);
  ctx.fillStyle = '#b8b4c8';
  ctx.font = '10px sans-serif';
  ctx.fillText('一场说走就走的出走 · 八幕完整篇章', VW / 2, portrait ? 184 : 104);
  button(VW / 2 - 90, portrait ? 240 : 128, 180, 30, '出关记 · 八幕选关', function () { menuPage = 'levels'; }, true);
  button(VW / 2 - 90, portrait ? 285 : 168, 180, 30, '居庸关 · 无限跑酷', startEndless, false);
  button(VW / 2 - 90, portrait ? 340 : 240, 180, 24, '教学播报：' + (hintsOn ? '开' : '关'), toggleHints, false);
  ctx.fillStyle = '#8a86a0';
  ctx.font = '9px sans-serif';
  ctx.fillText('史料：《明史 · 张钦传》《明史 · 武宗本纪》《明武宗实录》', VW / 2, portrait ? 400 : 216);
  ctx.fillStyle = '#6a6680';
  ctx.fillText('点按或空格跳跃 · 拾取大将军印可变身朱寿', VW / 2, portrait ? 420 : 230);
}

/* v1.0.0 选关页：通关一幕解锁下一幕（unlockedActs 持久化于 localStorage） */
function drawLevelSelect() {
  drawBackground(MENU_BG);
  ctx.fillStyle = 'rgba(8,10,18,0.5)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('出关记 · 选幕', VW / 2, portrait ? 66 : 42);
  ctx.fillStyle = '#8a86a0';
  ctx.font = '9px sans-serif';
  ctx.fillText('通关一幕，解锁下一幕 · 已解锁 ' + Math.min(8, unlockedActs + 1) + ' / 8', VW / 2, portrait ? 84 : 58);
  const bw = 58, bh = 44, gx = 6, gy = 10;
  const x0 = (VW - (bw * 4 + gx * 3)) / 2;
  const y0 = portrait ? 108 : 72;
  for (let i = 0; i < 8; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const x = x0 + col * (bw + gx);
    const y = y0 + row * (bh + gy);
    if (i <= unlockedActs) {
      const lv = LEVELS[i];
      button(x, y, bw, bh, '第' + (i + 1) + '幕', function () { startLevel(i); }, true);
      ctx.fillStyle = '#e8d8b0';
      ctx.font = '7px sans-serif';
      ctx.textAlign = 'center';
      /* 幕名两行截取（首 6 字） */
      const nm = lv.title.split(' · ')[0];
      ctx.fillText(nm.length > 6 ? nm.slice(0, 6) : nm, x + bw / 2, y + bh - 6);
    } else {
      ctx.fillStyle = 'rgba(20,24,34,0.7)';
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = '#4a4658';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = '#6a6680';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('第' + (i + 1) + '幕', x + bw / 2, y + bh / 2 - 2);
      ctx.font = '8px sans-serif';
      ctx.fillText('未解锁', x + bw / 2, y + bh / 2 + 12);
    }
  }
  button(VW / 2 - 70, portrait ? VH - 92 : VH - 58, 140, 28, '◀ 返回', function () { menuPage = 'main'; }, false);
}

/* ---------- 总渲染 ---------- */
function render() {
  uiButtons.length = 0;
  ctx.setTransform(PIXEL_SCALE, 0, 0, PIXEL_SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (state === 'menu') {
    if (menuPage === 'levels') drawLevelSelect();
    else drawMenu();
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
    drawQjWarn();
    drawItems();
    if (companion) drawGudayong(Math.floor(companion.x), Math.floor(companion.y), companion.animT, companion);
    drawPlayer();
    drawParticles();
    /* v1.0.3 幕1 起跳教学标记（世界坐标；深色底条保证任何背景下可读；wip23 教学播报「关」时屏蔽） */
    if (hintsOn && jumpCueStage === 1) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px sans-serif';
      const tw1 = ctx.measureText('长按跳得更高').width;
      ctx.fillStyle = 'rgba(20,24,34,0.8)';
      ctx.fillRect(PLAYER_X + PLAYER_W / 2 - tw1 / 2 - 7, G - PLAYER_H - 50, tw1 + 14, 19);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText('长按跳得更高', PLAYER_X + PLAYER_W / 2, G - PLAYER_H - 36);
    } else if (hintsOn && jumpCueStage === 2) {
      const pulse = 0.55 + 0.45 * Math.sin(gt * 9);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffd76a';
      /* 地面脉冲三角（起跳点，加大版） */
      ctx.beginPath();
      ctx.moveTo(PLAYER_X + PLAYER_W / 2, G - 17 - pulse * 6);
      ctx.lineTo(PLAYER_X + PLAYER_W / 2 - 12, G - 2);
      ctx.lineTo(PLAYER_X + PLAYER_W / 2 + 12, G - 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.font = 'bold 16px sans-serif';
      const tw2 = ctx.measureText('现在起跳！').width;
      ctx.fillStyle = 'rgba(20,24,34,0.82)';
      ctx.fillRect(PLAYER_X + PLAYER_W / 2 - tw2 / 2 - 8, G - 96, tw2 + 16, 24);
      ctx.fillStyle = '#ffd76a';
      ctx.fillText('现在起跳！', PLAYER_X + PLAYER_W / 2, G - 78);
      ctx.font = 'bold 11px sans-serif';
      const tw3 = ctx.measureText('按住不放跳更高').width;
      ctx.fillStyle = 'rgba(20,24,34,0.8)';
      ctx.fillRect(PLAYER_X + PLAYER_W / 2 - tw3 / 2 - 7, G - 68, tw3 + 14, 18);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText('按住不放跳更高', PLAYER_X + PLAYER_W / 2, G - 55);
    }
    /* v1.0.3 幕1 奏折「不好跳」提示（深色底条 + 警示红，区别于起跳金） */
    if (hintsOn && zouzheCueStage === 2) {
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(gt * 9);
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px sans-serif';
      const tw4 = ctx.measureText('不好跳——别跳，跑过去！').width;
      ctx.fillStyle = 'rgba(40,12,12,0.85)';
      ctx.fillRect(PLAYER_X + PLAYER_W / 2 - tw4 / 2 - 8, G - PLAYER_H - 52, tw4 + 16, 21);
      ctx.fillStyle = '#ff9a8a';
      ctx.fillText('不好跳——别跳，跑过去！', PLAYER_X + PLAYER_W / 2, G - PLAYER_H - 37);
      ctx.globalAlpha = 1;
    }
    /* v1.0.3 教学延伸（与幕1教学同体系）：幕2印拾取 / 幕3护驾 / 幕4张钦应对——
       均为条件持续显示（道具/角色在屏内即显示，完成或过身后自动消失）；
       教学播报「关」时整体屏蔽（wip23），播报类 HUD 提示不受开关影响 */
    if (hintsOn && mode === 'level' && !outro) {
      /* 幕2：大将军印在屏内且未变身——玩家头顶金字提示 */
      if (levelIndex === 1 && transformT <= 0) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it.got && it.x < VW) {
            ctx.globalAlpha = 0.75 + 0.25 * Math.sin(gt * 8);
            ctx.textAlign = 'center';
            ctx.font = 'bold 13px sans-serif';
            const twS = ctx.measureText('接住大将军印！').width;
            const sx = Math.max(twS / 2 + 8, Math.min(PLAYER_X + PLAYER_W / 2, VW - twS / 2 - 8));
            ctx.fillStyle = 'rgba(30,22,4,0.85)';
            ctx.fillRect(sx - twS / 2 - 8, G - PLAYER_H - 52, twS + 16, 21);
            ctx.fillStyle = '#ffd76a';
            ctx.fillText('接住大将军印！', sx, G - PLAYER_H - 37);
            ctx.globalAlpha = 1;
            break;
          }
        }
      }
      /* 幕3：谷大用在屏内未跟随——他头顶绿字提示（跟随成功即消失） */
      if (levelIndex === 2 && companion && !companion.following && companion.x < VW - 10) {
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(gt * 8);
        ctx.textAlign = 'center';
        ctx.font = 'bold 13px sans-serif';
        const twC = ctx.measureText('碰触谷大用——获得护驾！').width;
        const cx = Math.max(twC / 2 + 10, Math.min(companion.x + COMP_W / 2, VW - twC / 2 - 10));
        ctx.fillStyle = 'rgba(14,26,20,0.85)';
        ctx.fillRect(cx - twC / 2 - 8, companion.y - 32, twC + 16, 21);
        ctx.fillStyle = '#9fe8b8';
        ctx.fillText('碰触谷大用——获得护驾！', cx, companion.y - 17);
        ctx.globalAlpha = 1;
      }
      /* 幕4：首个张钦在屏内未触发追击——玩家头顶红字预教学（触发追击后由 HUD hint 接管） */
      if (levelIndex === 3) {
        for (let i = 0; i < obstacles.length; i++) {
          const o = obstacles[i];
          if (o.tutor && !o.chasing && !o.dead && o.x < VW) {
            ctx.globalAlpha = 0.75 + 0.25 * Math.sin(gt * 8);
            ctx.textAlign = 'center';
            ctx.font = 'bold 13px sans-serif';
            /* 竖屏逻辑宽仅 270px：用短文案 + 水平钳制，保证底条完全在屏内 */
            const zqText = portrait ? '张钦拦路！跳过或引他撞障碍' : '张钦拦路！跳过他，或引他撞上其他障碍';
            const twZ = ctx.measureText(zqText).width;
            const zx = Math.max(twZ / 2 + 8, Math.min(PLAYER_X + PLAYER_W / 2, VW - twZ / 2 - 8));
            ctx.fillStyle = 'rgba(40,12,12,0.85)';
            ctx.fillRect(zx - twZ / 2 - 8, G - PLAYER_H - 52, twZ + 16, 21);
            ctx.fillStyle = '#ff9a8a';
            ctx.fillText(zqText, zx, G - PLAYER_H - 37);
            ctx.globalAlpha = 1;
            break;
          }
        }
      }
    }
  }
  ctx.restore();
  drawHUD();
  /* v1.0.0 出关演出横幅：幕8「出关」金字；其余幕「第X幕 · 完」+ 本幕标题（v1.0.3） */
  if (outro) {
    const a = outroT < 0.4 ? outroT / 0.4 : (outroT > 2.2 ? Math.max(0, 1 - (outroT - 2.2) / 0.6) : 1);
    const lvB = LEVELS[levelIndex];
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    if (outroNext === 'clear') {
      ctx.fillStyle = '#ffd76a';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(lvB.act + ' · 完', VW / 2, portrait ? 130 : 104);
      ctx.fillStyle = '#e8e4d8';
      ctx.font = '11px sans-serif';
      ctx.fillText(lvB.title, VW / 2, (portrait ? 130 : 104) + 24);
    } else {
      ctx.fillStyle = '#ffd76a';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText('出 关', VW / 2, portrait ? 130 : 104);
      ctx.fillStyle = '#e8e4d8';
      ctx.font = '11px sans-serif';
      ctx.fillText('居庸关外，天高海阔', VW / 2, (portrait ? 130 : 104) + 26);
    }
    ctx.globalAlpha = 1;
  }
  if (state === 'story') drawStoryOverlay();
  else if (state === 'clear') drawClearOverlay();
  else if (state === 'gameover') drawGameOverOverlay();
  else if (state === 'play' && paused) drawPauseOverlay();
}

/* ---------- 主循环 ---------- */
function frame(now) {
  if (!last) last = now;
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  gt += dt;
  if (paused) {
    /* 暂停：逻辑全部冻结，仅渲染暂停菜单（gt 继续走只影响装饰动画） */
    render();
    requestAnimationFrame(frame);
    return;
  }
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
