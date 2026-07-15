'use strict';
/* ============================================================
   MOBILE NINJA — прототип
   1v1 по правилам кастомки Dota 2 "Hardcore Ninja":
   1 HP, 4 скилла (Щит / Блинк / Волна / Кинжал), раунды до 15.
   Управление в стиле Brawl Stars: джойстик слева, скиллы справа.
   ============================================================ */

// ---------- Поле (логические координаты; режим выбирается в меню) ----------
// Горизонтальный: мир 21x33 блока (бой по вертикали), экран показывает всю ширину,
// камера следует за игроком, как в Brawl Stars. Вертикальный: оригинальный 480x854.
let W = 672, H = 1056;
const WIN_SCORE = 15;

const SKILLS = {
  shield: { cd: 2.0, label: 'ЩИТ',    color: '#3fd9ff', aim: false, duration: 0.7 },
  blink:  { cd: 4.0, label: 'БЛИНК',  color: '#c46bff', aim: true,  range: 250 },
  // Волна Магнуса (Shockwave): выпуклая вперёд дуга, фронт перпендикулярен направлению,
  // проходит сквозь стены. Пропорции из Dota 2 (скорость ~2x бега, широкий фронт)
  wave:   { cd: 2.0, label: 'ВОЛНА',  color: '#ff9d3b', aim: true,  range: 820, speed: 400, arcR: 95, halfAngle: 0.62, castTime: 0.3 },
  // Кинжал ФА: самонаводится на цель; спастись можно только щитом или блинком
  dagger: { cd: 5.0, label: 'КИНЖАЛ', color: '#8aff6b', aim: false, speed: 390, r: 6, castTime: 0.3 },
};
const MOVE_SPEED = 195;
const NINJA_R = 14;

// Препятствия и кнопки зависят от режима — заполняются в applyMode()
let OBSTACLES = [];
let BUTTONS = [];
let MODE = 'landscape'; // 'landscape' | 'portrait'

function applyMode(mode) {
  MODE = mode;
  try { localStorage.setItem('mn_mode', mode); } catch (e) {}

  if (mode === 'portrait') {
    // оригинальная вертикальная арена, спавны сверху и снизу
    W = 480; H = 854;
    OBSTACLES = [
      { x: W/2 - 62, y: H/2 - 21, w: 124, h: 42 },
      { x: 48, y: 236, w: 96, h: 30 },
      { x: W - 48 - 96, y: 236, w: 96, h: 30 },
      { x: 48, y: H - 236 - 30, w: 96, h: 30 },
      { x: W - 48 - 96, y: H - 236 - 30, w: 96, h: 30 },
    ];
    player.spawnX = W / 2; player.spawnY = H - 170;
    bot.spawnX = W / 2;    bot.spawnY = 170;
  } else {
    // горизонтальный режим: мир 21 блок в ширину x 33 в высоту, бой сверху-вниз;
    // вся ширина в кадре, по вертикали работает камера
    const T = 32;
    W = 21 * T; H = 33 * T; // 672 x 1056
    OBSTACLES = [
      { x: 8 * T,  y: 16 * T, w: 5 * T, h: T },     // центральная стена
      { x: 4 * T,  y: 7 * T,  w: T, h: 3 * T },     // четыре блока по углам
      { x: 16 * T, y: 7 * T,  w: T, h: 3 * T },
      { x: 4 * T,  y: 23 * T, w: T, h: 3 * T },
      { x: 16 * T, y: 23 * T, w: T, h: 3 * T },
      { x: 10 * T, y: 2 * T,  w: T, h: 2 * T },     // укрытия у спавнов
      { x: 10 * T, y: 29 * T, w: T, h: 2 * T },
    ];
    player.spawnX = W / 2; player.spawnY = H - 170;
    bot.spawnX = W / 2;    bot.spawnY = 170;
  }

  player.x = player.spawnX; player.y = player.spawnY;
  bot.x = bot.spawnX;       bot.y = bot.spawnY;
  resize();
}

// ---------- Telegram Mini App ----------
const TG = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.platform !== 'unknown')
  ? window.Telegram.WebApp : null;
const TG_APP_LINK = 'https://t.me/mobileninjjabot/mobileninja';
if (TG) {
  try {
    TG.ready();
    TG.expand();
    if (TG.requestFullscreen) { try { TG.requestFullscreen(); } catch (e) {} }
    if (TG.disableVerticalSwipes) { try { TG.disableVerticalSwipes(); } catch (e) {} }
    if (TG.onEvent) {
      TG.onEvent('viewportChanged', () => resize());
      TG.onEvent('fullscreenChanged', () => resize());
      TG.onEvent('safeAreaChanged', () => resize());
    }
  } catch (e) {}
}

// ---------- Спрайты (assets/, вырезаны из спрайт-листа) ----------
const IMG = {};
for (const name of ['ninja_blue', 'ninja_red', 'fx_shuriken', 'crate', 'box', 'floor',
                    'icon_shield', 'icon_blink', 'icon_wave', 'icon_dagger']) {
  const im = new Image();
  im.src = 'assets/' + name + '.png';
  IMG[name] = im;
}
// направленные кадры: 8 осей (0=вниз, по 45°) x (стойка + 3 кадра бега) x 2 цвета
for (const c of ['blue', 'red']) {
  for (let d = 0; d < 8; d++) {
    for (const k of ['idle', 'run1', 'run2', 'run3']) {
      const nm = c + '_' + k + '_' + d;
      const im = new Image();
      im.src = 'assets/anim/' + nm + '.png';
      IMG[nm] = im;
    }
  }
}
const imgReady = (im) => im && im.complete && im.naturalWidth > 0;

// индекс направления 0..7 по сглаженному углу взгляда
// (0° листа = взгляд вниз, 90° листа = взгляд вправо)
function dirIndex(dispAngle) {
  const deg = dispAngle * 180 / Math.PI;
  const theta = ((90 - deg) % 360 + 360) % 360;
  let di = Math.round(theta / 45) % 8;
  // на листе ячейки 135° и 225° перепутаны местами — верхние диагонали меняем
  if (di === 3) di = 5;
  else if (di === 5) di = 3;
  return di;
}

// ---------- Канвас и масштабирование ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let dpr = 1, scale = 1, offX = 0, offY = 0;

// Камера: видимая область VW x VH, левый верхний угол (camX, camY)
let camX = 0, camY = 0;
let VW = W, VH = H;

function resize() {
  dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  if (MODE === 'landscape' && canvas.height / (canvas.width / W) < H) {
    // камера отдалена: в кадре ~15 блоков по высоте; если экран шире арены —
    // арена по центру, по бокам тёмные поля (как за краем карты в Brawl Stars)
    const targetVH = 12 * 32; // зум под полноэкранный режим
    scale = Math.min(canvas.width / W, canvas.height / targetVH);
    VW = canvas.width / scale;
    VH = Math.min(canvas.height / scale, H);
    offX = 0;
    offY = (canvas.height - VH * scale) / 2;
  } else {
    // вся арена в кадре (вертикальный режим или очень высокий экран)
    scale = Math.min(canvas.width / W, canvas.height / H);
    VW = W; VH = H;
    offX = (canvas.width - W * scale) / 2;
    offY = (canvas.height - H * scale) / 2;
  }
  layoutButtons();
}

// кинжал — большая кнопка в углу экрана, остальные дугой слева: волна-блинк-щит
function layoutButtons() {
  BUTTONS = [
    { skill: 'wave',   x: VW - 74,  y: VH - 166, r: 30 }, // сверху
    { skill: 'blink',  x: VW - 139, y: VH - 139, r: 30 }, // по диагонали
    { skill: 'shield', x: VW - 166, y: VH - 74,  r: 30 }, // слева
    { skill: 'dagger', x: VW - 74,  y: VH - 74,  r: 46 },
  ];
}
window.addEventListener('resize', resize);
resize();

function toGame(clientX, clientY) {
  return { x: (clientX * dpr - offX) / scale, y: (clientY * dpr - offY) / scale };
}

// ---------- Утилиты ----------
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const rand = (a, b) => a + Math.random() * (b - a);

function norm(x, y) {
  const d = Math.hypot(x, y);
  return d > 0.0001 ? { x: x / d, y: y / d } : { x: 0, y: -1 };
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return dist(px, py, ax + dx * t, ay + dy * t);
}

function circleInRect(x, y, r, rect) {
  const cx = clamp(x, rect.x, rect.x + rect.w);
  const cy = clamp(y, rect.y, rect.y + rect.h);
  return dist(x, y, cx, cy) < r;
}

function pointBlocked(x, y, r) {
  if (x < r || x > W - r || y < r || y > H - r) return true;
  for (const o of OBSTACLES) if (circleInRect(x, y, r, o)) return true;
  return false;
}

// Проверка прямой видимости (для кинжала бота)
function hasLOS(ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by);
  const steps = Math.ceil(d / 10);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    for (const o of OBSTACLES) {
      if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) return false;
    }
  }
  return true;
}

// ---------- Звук (WebAudio, крошечные синтезированные эффекты) ----------
let AC = null;
function initAudio() {
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; }
  }
  if (AC && AC.state === 'suspended') AC.resume();
}
function sfx(freq, dur, type, vol, slideTo) {
  if (!AC) return;
  const t = AC.currentTime;
  const osc = AC.createOscillator();
  const g = AC.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol || 0.06, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(AC.destination);
  osc.start(t); osc.stop(t + dur);
}
const SND = {
  dagger: () => sfx(900, 0.12, 'square', 0.05, 300),
  wave:   () => sfx(160, 0.3, 'sawtooth', 0.07, 60),
  blink:  () => sfx(500, 0.18, 'sine', 0.08, 1400),
  shield: () => sfx(700, 0.25, 'triangle', 0.07, 1100),
  block:  () => sfx(1200, 0.1, 'triangle', 0.08, 800),
  charge: () => sfx(300, 0.25, 'sine', 0.05, 700),
  death:  () => sfx(220, 0.5, 'sawtooth', 0.1, 40),
  count:  () => sfx(600, 0.09, 'square', 0.05),
  go:     () => sfx(880, 0.2, 'square', 0.06),
};

// ---------- Состояние игры ----------
let tNow = 0;              // игровое время, сек
let state = 'menu';        // menu | countdown | fight | roundend | gameover
let stateEnd = 0;          // когда закончится текущее состояние
let countdownVal = 3;
let banner = '';
let round = 1;
let score = { you: 0, bot: 0 };
let shake = 0;

const projectiles = [];
const particles = [];
const deathAnims = []; // затухающие спрайты убитых
const pendingCasts = []; // замахи: скилл сработает после castTime

function makeNinja(x, y, color, darkColor, isBot, sprite) {
  return {
    x, y, spawnX: x, spawnY: y,
    vx: 0, vy: 0,
    r: NINJA_R, color, darkColor, isBot, sprite,
    alive: true,
    face: { x: isBot ? -1 : 1, y: 0 },
    dispAngle: isBot ? Math.PI : 0, // сглаженный угол разворота спрайта
    stepPhase: 0, moving: false,
    shieldUntil: 0,
    blinkSeq: 0, lastBlinkFrom: { x, y },
    cds: { shield: 0, blink: 0, wave: 0, dagger: 0 },
    // поля бота
    strafeDir: 1, strafeTimer: 0,
    dodgeAt: 0, dodgePlanned: false,
    aggroTimer: rand(0.5, 1.5),
  };
}

let player = makeNinja(170,     H / 2, '#4db8ff', '#1d5f92', false, 'ninja_blue');
let bot    = makeNinja(W - 170, H / 2, '#ff5964', '#8f2430', true,  'ninja_red');

// восстанавливаем последний выбранный режим
try { applyMode(localStorage.getItem('mn_mode') === 'portrait' ? 'portrait' : 'landscape'); }
catch (e) { applyMode('landscape'); }

function resetRound() {
  projectiles.length = 0;
  deathAnims.length = 0;
  pendingCasts.length = 0;
  for (const n of [player, bot]) {
    n.x = n.spawnX; n.y = n.spawnY;
    n.vx = 0; n.vy = 0;
    n.alive = true;
    n.shieldUntil = 0;
    n.cds = { shield: 0, blink: 0, wave: 0, dagger: 0 };
    // в обоих режимах спавны сверху и снизу — смотрим друг на друга по вертикали
    n.face = { x: 0, y: n.isBot ? 1 : -1 };
    n.dispAngle = n.isBot ? Math.PI / 2 : -Math.PI / 2;
    n.stepPhase = 0; n.moving = false;
    n.dodgePlanned = false;
  }
  bot.aggroTimer = rand(0.6, 1.4);
  guestInput.jx = 0; guestInput.jy = 0;
  joy.active = false;
  aimDrag.skill = null;
  state = 'countdown';
  countdownVal = 3;
  stateEnd = tNow + 1;
  SND.count();
}

function newGame() {
  score = { you: 0, bot: 0 };
  round = 1;
  resetRound();
}

// ---------- Ввод ----------
const joy = { active: false, id: -1, bx: 0, by: 0, dx: 0, dy: 0 }; // джойстик
const aimDrag = { skill: null, id: -1, sx: 0, sy: 0, dx: 0, dy: 0 }; // прицеливание скилла
const keys = {};
let mouse = { x: W / 2, y: 100 };

const JOY_RADIUS = 56;

window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (state === 'fight') {
    const wm = screenToWorld(mouse.x, mouse.y);
    const dir = norm(wm.x - me().x, wm.y - me().y);
    const k = e.key.toLowerCase();
    if (k === 'q' || k === '1') requestCast('shield', dir);
    if (k === 'w' || k === '2') requestCast('blink', dir, SKILLS.blink.range);
    if (k === 'e' || k === '3') requestCast('wave', dir);
    if (k === 'r' || k === '4') requestCast('dagger', dir);
  }
  if ((state === 'menu' || state === 'gameover') && (e.key === ' ' || e.key === 'Enter') && !netRole) {
    initAudio(); newGame();
  }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

canvas.addEventListener('contextmenu', e => e.preventDefault());

// На телефоне: полный экран + поворот под выбранный режим (где браузер разрешает)
function tryFullscreen() {
  if (TG) {
    // внутри Telegram — его собственный полноэкранный режим
    try { TG.requestFullscreen && TG.requestFullscreen(); } catch (e) {}
    return;
  }
  if (!('ontouchstart' in window)) return; // только сенсорные устройства
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen().then(() => {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock(MODE === 'portrait' ? 'portrait' : 'landscape').catch(() => {});
      }
    }).catch(() => {});
  }
}

// Кнопки меню: переключатели режима + три способа играть (координаты экрана)
function menuButtons() {
  const btns = [];
  if (VW > VH) {
    // низкий ландшафтный экран: якорим ряды кнопок к низу экрана
    btns.push(
      { act: 'mode_land', label: 'ГОРИЗОНТАЛЬНЫЙ', x: VW / 2 - 175, y: VH - 118, w: 170, h: 40 },
      { act: 'mode_port', label: 'ВЕРТИКАЛЬНЫЙ',   x: VW / 2 + 5,   y: VH - 118, w: 170, h: 40 },
      { act: 'bot',    label: 'С БОТОМ',        x: VW / 2 - 308, y: VH - 66, w: 200, h: 44 },
      { act: 'create', label: 'СОЗДАТЬ ИГРУ',   x: VW / 2 - 100, y: VH - 66, w: 200, h: 44 },
      { act: 'join',   label: 'ВОЙТИ ПО КОДУ',  x: VW / 2 + 108, y: VH - 66, w: 200, h: 44 },
    );
  } else {
    // портрет: всё столбиком
    btns.push(
      { act: 'mode_land', label: 'ГОРИЗОНТ.',  x: VW / 2 - 165, y: VH / 2 + 120, w: 160, h: 40 },
      { act: 'mode_port', label: 'ВЕРТИКАЛЬН.', x: VW / 2 + 5,  y: VH / 2 + 120, w: 160, h: 40 },
      { act: 'bot',    label: 'ИГРА С БОТОМ',          x: VW / 2 - 160, y: VH / 2 + 180, w: 320, h: 46 },
      { act: 'create', label: 'СОЗДАТЬ ИГРУ С ДРУГОМ', x: VW / 2 - 160, y: VH / 2 + 240, w: 320, h: 46 },
      { act: 'join',   label: 'ВОЙТИ ПО КОДУ',         x: VW / 2 - 160, y: VH / 2 + 300, w: 320, h: 46 },
    );
  }
  return btns;
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  initAudio();
  tryFullscreen(); // при любом касании, если ещё не в полном экране
  const p = toGame(e.clientX, e.clientY);
  mouse = p;

  if (state === 'menu') {
    for (const mb of menuButtons()) {
      if (p.x >= mb.x && p.x <= mb.x + mb.w && p.y >= mb.y && p.y <= mb.y + mb.h) {
        if (mb.act === 'mode_land') applyMode('landscape');
        else if (mb.act === 'mode_port') applyMode('portrait');
        else if (mb.act === 'bot') { netMsg = ''; tryFullscreen(); newGame(); }
        else if (mb.act === 'create') { tryFullscreen(); createRoom(); }
        else if (mb.act === 'join') { tryFullscreen(); joinRoom(); }
        return;
      }
    }
    return;
  }
  if (state === 'lobby') {
    if (roomCode) {
      const b = inviteBtnRect();
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        shareInvite();
        return;
      }
    }
    netReset(''); // тап мимо кнопки — отмена ожидания
    return;
  }
  if (state === 'gameover') {
    if (netRole === 'guest') { netReset(''); }
    else { tryFullscreen(); newGame(); }
    return;
  }
  if (state !== 'fight' && state !== 'countdown' && state !== 'roundend') return;

  // Кнопки скиллов
  for (const b of BUTTONS) {
    if (dist(p.x, p.y, b.x, b.y) <= b.r + 10) {
      const s = SKILLS[b.skill];
      if (!s.aim) {
        // мгновенный каст: щит — на себя, кинжал — автонаводка на противника
        requestCast(b.skill, norm(foe().x - me().x, foe().y - me().y));
      } else {
        aimDrag.skill = b.skill; aimDrag.id = e.pointerId;
        aimDrag.sx = p.x; aimDrag.sy = p.y; aimDrag.dx = 0; aimDrag.dy = 0;
      }
      return;
    }
  }

  // Джойстик — левая половина экрана
  if (p.x < VW * 0.5 && !joy.active) {
    joy.active = true; joy.id = e.pointerId;
    joy.bx = p.x; joy.by = p.y; joy.dx = 0; joy.dy = 0;
  }
});

canvas.addEventListener('pointermove', e => {
  const p = toGame(e.clientX, e.clientY);
  mouse = p;
  if (joy.active && e.pointerId === joy.id) {
    let dx = p.x - joy.bx, dy = p.y - joy.by;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) { dx = dx / d * JOY_RADIUS; dy = dy / d * JOY_RADIUS; }
    joy.dx = dx; joy.dy = dy;
  }
  if (aimDrag.skill && e.pointerId === aimDrag.id) {
    aimDrag.dx = p.x - aimDrag.sx;
    aimDrag.dy = p.y - aimDrag.sy;
  }
});

function pointerEnd(e) {
  if (joy.active && e.pointerId === joy.id) {
    joy.active = false; joy.dx = 0; joy.dy = 0;
  }
  if (aimDrag.skill && e.pointerId === aimDrag.id) {
    const skillName = aimDrag.skill;
    const dragLen = Math.hypot(aimDrag.dx, aimDrag.dy);
    if (state === 'fight') {
      let dir, blinkDist = SKILLS.blink.range;
      if (dragLen < 14) {
        // быстрый каст: блинк — куда смотрит моделька, остальное — в противника
        dir = skillName === 'blink'
          ? norm(me().face.x, me().face.y)
          : norm(foe().x - me().x, foe().y - me().y);
      } else {
        dir = norm(aimDrag.dx * dirSign(), aimDrag.dy * dirSign());
        blinkDist = clamp(dragLen / 95, 0.3, 1) * SKILLS.blink.range;
      }
      requestCast(skillName, dir, blinkDist);
    }
    aimDrag.skill = null;
  }
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);

// ---------- Скиллы ----------
function castSkill(ninja, name, dir, blinkDist) {
  if (!ninja.alive || state !== 'fight') return;
  const s = SKILLS[name];
  if (tNow < ninja.cds[name]) return; // на перезарядке
  ninja.cds[name] = tNow + s.cd;
  ninja.face = dir;

  if (s.castTime) {
    // замах: эффект сработает после задержки, вокруг персонажа крутится индикатор
    pendingCasts.push({ ninja, name, dir, blinkDist, t0: tNow, at: tNow + s.castTime });
    SND.charge();
    return;
  }
  releaseSkill(ninja, name, dir, blinkDist);
}

function releaseSkill(ninja, name, dir, blinkDist) {
  const s = SKILLS[name];
  ninja.face = dir;

  if (name === 'shield') {
    ninja.shieldUntil = tNow + s.duration;
    SND.shield();
    burst(ninja.x, ninja.y, SKILLS.shield.color, 10, 60);
  } else if (name === 'blink') {
    // запоминаем точку блинка: летящие кинжалы дойдут до неё и исчезнут
    ninja.lastBlinkFrom = { x: ninja.x, y: ninja.y };
    ninja.blinkSeq++;
    burst(ninja.x, ninja.y, SKILLS.blink.color, 14, 90);
    let d = Math.min(blinkDist || s.range, s.range);
    // ищем свободную точку приземления, отступая назад по направлению
    let tx = ninja.x, ty = ninja.y;
    for (; d >= 0; d -= 8) {
      const nx = clamp(ninja.x + dir.x * d, ninja.r, W - ninja.r);
      const ny = clamp(ninja.y + dir.y * d, ninja.r, H - ninja.r);
      if (!pointBlocked(nx, ny, ninja.r)) { tx = nx; ty = ny; break; }
    }
    ninja.x = tx; ninja.y = ty;
    burst(ninja.x, ninja.y, SKILLS.blink.color, 14, 90);
    SND.blink();
  } else if (name === 'wave') {
    projectiles.push({
      type: 'wave', owner: ninja,
      x: ninja.x + dir.x * (ninja.r + 10), y: ninja.y + dir.y * (ninja.r + 10),
      dx: dir.x, dy: dir.y,
      speed: s.speed, traveled: 0, range: s.range, arcR: s.arcR, halfAngle: s.halfAngle,
    });
    SND.wave();
  } else if (name === 'dagger') {
    const target = ninja === player ? bot : player;
    projectiles.push({
      type: 'dagger', owner: ninja, target,
      homing: true, seq: target.blinkSeq, destX: 0, destY: 0,
      x: ninja.x + dir.x * (ninja.r + 8), y: ninja.y + dir.y * (ninja.r + 8),
      dx: dir.x, dy: dir.y,
      speed: s.speed, traveled: 0, r: s.r, spin: 0,
    });
    SND.dagger();
  }
}

function tryKill(victim, killer) {
  if (!victim.alive || state !== 'fight') return false;
  if (tNow < victim.shieldUntil) {
    burst(victim.x, victim.y, SKILLS.shield.color, 12, 100);
    SND.block();
    return false;
  }
  victim.alive = false;
  deathAnims.push({
    sprite: victim.sprite, x: victim.x, y: victim.y,
    angle: victim.dispAngle - Math.PI / 2,
    t0: tNow, dur: 0.55,
    spin: (Math.random() < 0.5 ? -1 : 1) * 6,
  });
  burst(victim.x, victim.y, victim.color, 30, 160);
  burst(victim.x, victim.y, '#ffffff', 12, 90);
  SND.death();
  shake = 10;

  if (victim === bot) { score.you++; banner = 'УБИЙСТВО!'; }
  else { score.bot++; banner = 'ВЫ ПОГИБЛИ'; }

  state = 'roundend';
  stateEnd = tNow + 1.6;
  return true;
}

// ---------- Частицы ----------
function burst(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = rand(speed * 0.3, speed);
    particles.push({
      x, y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: rand(0.25, 0.6), maxLife: 0.6,
      color, size: rand(2, 5),
    });
  }
}

// ---------- Сеть: игра с другом через комнаты ----------
// Хост считает всю игру; гость шлёт свой ввод и рисует присланное состояние.
// Сервер комнат: локально — тот же хост :8001; в облаке (GitHub Pages) — Render.
// Переопределяется параметром ?ws=host (для туннелей и отладки).
const CLOUD_ROOMS = 'wss://mobile-ninja-rooms.onrender.com';
const wsParam = new URLSearchParams(location.search).get('ws');
const WS_URL = wsParam
  ? (wsParam.includes('://') ? wsParam : 'wss://' + wsParam)
  : (location.hostname.endsWith('github.io')
      ? CLOUD_ROOMS
      : (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.hostname + ':8001');
let ws = null;
let netRole = null;      // null (с ботом) | 'host' | 'guest'
let roomCode = '';
let netMsg = '';
let netFrame = 0;
const guestInput = { jx: 0, jy: 0 };

// чей ниндзя мой: у хоста — синий (player), у гостя — красный (bot)
const me = () => netRole === 'guest' ? bot : player;
const foe = () => netRole === 'guest' ? player : bot;

// экран <-> мир: сдвиг камеры, у гостя дополнительно поворот мира на 180°
const screenToWorld = (x, y) => {
  const qx = x + camX, qy = y + camY;
  return netRole === 'guest' ? { x: W - qx, y: H - qy } : { x: qx, y: qy };
};
const worldToScreen = (x, y) => {
  const qx = netRole === 'guest' ? W - x : x;
  const qy = netRole === 'guest' ? H - y : y;
  return { x: qx - camX, y: qy - camY };
};
// знак для направлений из экранных жестов (свайпы гостя инвертируются)
const dirSign = () => netRole === 'guest' ? -1 : 1;

// цель камеры: центр на моём ниндзя (в повёрнутых координатах гостя), в меню — центр арены
function camTarget() {
  if (state === 'menu' || state === 'lobby') {
    return { x: (W - VW) / 2, y: (H - VH) / 2 };
  }
  const m = me();
  const qx = netRole === 'guest' ? W - m.x : m.x;
  const qy = netRole === 'guest' ? H - m.y : m.y;
  return {
    // если видимая область шире/выше мира — держим арену по центру
    x: VW >= W ? (W - VW) / 2 : clamp(qx - VW / 2, 0, W - VW),
    y: VH >= H ? (H - VH) / 2 : clamp(qy - VH / 2, 0, H - VH),
  };
}

function netSend(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function netReset(msg) {
  if (ws) { try { ws.close(); } catch (e) {} }
  ws = null; netRole = null; roomCode = '';
  netMsg = msg || '';
  state = 'menu';
}

function netOpen(onOpen) {
  try { ws = new WebSocket(WS_URL); } catch (e) { netReset('Сервер недоступен'); return; }
  ws.onopen = onOpen;
  ws.onclose = () => { if (netRole !== null || state === 'lobby') netReset('Соединение потеряно'); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    netHandle(m);
  };
}

function createRoom() {
  state = 'lobby'; netMsg = 'Создание комнаты…'; roomCode = '';
  netOpen(() => netSend({ t: 'create' }));
}

function joinRoomWithCode(code) {
  state = 'lobby'; netMsg = 'Вход в комнату…'; roomCode = '';
  netOpen(() => netSend({ t: 'join', code }));
}

function joinRoom() {
  const code = (window.prompt('Код комнаты (4 символа):') || '').trim().toUpperCase();
  if (!code) return;
  joinRoomWithCode(code);
}

// Инвайт для Telegram: ссылка сразу заводит друга в комнату
function inviteBtnRect() {
  return { x: VW / 2 - 160, y: VH / 2 + 40, w: 320, h: 48 };
}

function shareInvite() {
  const url = TG_APP_LINK + '?startapp=' + roomCode;
  const text = 'Дуэль в Mobile Ninja! Открой ссылку — попадёшь сразу в мой матч.';
  if (TG && TG.openTelegramLink) {
    TG.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(url) +
                        '&text=' + encodeURIComponent(text));
  } else if (navigator.share) {
    navigator.share({ text: text + ' ' + url }).catch(() => {});
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => { netMsg = 'Ссылка скопирована!'; }).catch(() => {});
  }
}

function netHandle(m) {
  if (m.t === 'created') { roomCode = m.code; netMsg = ''; }
  else if (m.t === 'error') { netReset(m.msg || 'Ошибка'); }
  else if (m.t === 'peer_left') { netReset('Противник вышел'); }
  else if (m.t === 'start') {
    netRole = m.role; netMsg = '';
    if (netRole === 'host') { netSend({ t: 'init', mode: MODE }); newGame(); }
    // гость ждёт init от хоста
  } else if (m.t === 'init' && netRole === 'guest') {
    applyMode(m.mode === 'portrait' ? 'portrait' : 'landscape');
    score.you = 0; score.bot = 0; round = 1;
    state = 'countdown'; countdownVal = 3;
  } else if (m.t === 'c' && netRole === 'host') {
    // гость кастует своим ниндзя (bot)
    if (m.d) castSkill(bot, m.s, norm(m.d[0], m.d[1]), m.bd > 0 ? m.bd : undefined);
  } else if (m.t === 'i' && netRole === 'host') {
    guestInput.jx = m.j[0]; guestInput.jy = m.j[1];
  } else if (m.t === 's' && netRole === 'guest') {
    applySnapshot(m);
  }
}

// каст от лица своего ниндзя: хост и одиночка — локально, гость — запрос хосту
function requestCast(name, dir, blinkDist) {
  if (state !== 'fight') return;
  if (netRole === 'guest') {
    if (tNow < bot.cds[name]) return; // по данным последнего снапшота
    netSend({ t: 'c', s: name, d: [dir.x, dir.y], bd: blinkDist || 0 });
  } else {
    castSkill(player, name, dir, blinkDist);
  }
}

// --- Снапшот состояния (хост -> гость, ~30 раз/с) ---
function buildSnapshot() {
  const packN = (n) => [
    Math.round(n.x), Math.round(n.y),
    Math.round(n.face.x * 100) / 100, Math.round(n.face.y * 100) / 100,
    n.alive ? 1 : 0,
    Math.round(Math.max(0, n.shieldUntil - tNow) * 100) / 100,
  ];
  return {
    t: 's', st: state, cd: countdownVal, rd: round,
    sc: [score.you, score.bot],
    ban: banner === 'УБИЙСТВО!' ? 1 : (banner ? 2 : 0),
    p: packN(player), b: packN(bot),
    k: ['shield', 'blink', 'wave', 'dagger'].map(k => Math.round(Math.max(0, bot.cds[k] - tNow) * 10) / 10),
    pr: projectiles.map(pr => [pr.type === 'wave' ? 1 : 0, Math.round(pr.x), Math.round(pr.y),
      Math.round(pr.dx * 100) / 100, Math.round(pr.dy * 100) / 100, pr.owner === player ? 0 : 1]),
    pc: pendingCasts.map(pc => [pc.ninja === player ? 0 : 1, pc.name,
      Math.round((tNow - pc.t0) / (pc.at - pc.t0) * 100) / 100]),
  };
}

function applySnapshot(m) {
  const unpack = (n, a) => {
    const wasAlive = n.alive;
    const hadShield = tNow < n.shieldUntil;
    const jump = dist(n.x, n.y, a[0], a[1]);
    n.tx = a[0]; n.ty = a[1];
    if (jump > 120) { // блинк или новый раунд — мгновенный перенос
      if (wasAlive && a[4] && state === 'fight') {
        burst(n.x, n.y, SKILLS.blink.color, 14, 90);
        burst(a[0], a[1], SKILLS.blink.color, 14, 90);
        SND.blink();
      }
      n.x = a[0]; n.y = a[1];
    }
    n.face = { x: a[2], y: a[3] };
    n.alive = !!a[4];
    n.shieldUntil = a[5] > 0 ? tNow + a[5] : 0;
    if (!hadShield && a[5] > 0.05) SND.shield();
    if (wasAlive && !n.alive) {
      deathAnims.push({
        sprite: n.sprite, x: n.x, y: n.y, angle: n.dispAngle - Math.PI / 2,
        t0: tNow, dur: 0.55, spin: (Math.random() < 0.5 ? -1 : 1) * 6,
      });
      burst(n.x, n.y, n.color, 30, 160);
      burst(n.x, n.y, '#ffffff', 12, 90);
      SND.death();
      shake = 10;
    }
  };
  unpack(player, m.p);
  unpack(bot, m.b);

  // кулдауны моего ниндзя (bot) для кнопок
  ['shield', 'blink', 'wave', 'dagger'].forEach((k, i) => { bot.cds[k] = tNow + m.k[i]; });

  // снаряды: пересоздаём, между снапшотами летят локально
  let dBefore = 0, wBefore = 0;
  for (const p of projectiles) { if (p.type === 'wave') wBefore++; else dBefore++; }
  projectiles.length = 0;
  let dAfter = 0, wAfter = 0;
  for (const a of m.pr) {
    if (a[0] === 1) {
      wAfter++;
      projectiles.push({
        type: 'wave', x: a[1], y: a[2], dx: a[3], dy: a[4],
        speed: SKILLS.wave.speed, arcR: SKILLS.wave.arcR, halfAngle: SKILLS.wave.halfAngle,
        owner: a[5] ? bot : player, traveled: 0, range: 1e9,
      });
    } else {
      dAfter++;
      projectiles.push({
        type: 'dagger', x: a[1], y: a[2], dx: a[3], dy: a[4],
        speed: SKILLS.dagger.speed, r: SKILLS.dagger.r, spin: (tNow * 20) % (Math.PI * 2),
        owner: a[5] ? bot : player, traveled: 0, homing: false,
        destX: a[1] + a[3] * 4000, destY: a[2] + a[4] * 4000,
      });
    }
  }
  if (dAfter > dBefore) SND.dagger();
  if (wAfter > wBefore) SND.wave();

  // замахи для колец
  pendingCasts.length = 0;
  for (const a of m.pc) {
    const ct = SKILLS[a[1]].castTime || 0.3;
    const t0 = tNow - clamp(a[2], 0, 1) * ct;
    pendingCasts.push({ ninja: a[0] ? bot : player, name: a[1], dir: { x: 0, y: 0 }, t0, at: t0 + ct });
  }

  // счёт, раунды, состояние
  score.you = m.sc[0]; score.bot = m.sc[1];
  round = m.rd;
  if (m.st === 'countdown' && m.cd !== countdownVal) SND.count();
  countdownVal = m.cd;
  if (m.st === 'fight' && state === 'countdown') { lastGoTime = tNow; SND.go(); }
  if (m.st !== 'menu') state = m.st;
  banner = m.ban === 1 ? (netRole === 'guest' ? 'ВЫ ПОГИБЛИ' : 'УБИЙСТВО!')
         : m.ban === 2 ? (netRole === 'guest' ? 'УБИЙСТВО!' : 'ВЫ ПОГИБЛИ') : '';
}

// --- Кадр гостя: лерп к снапшоту, локальный полёт снарядов, отправка ввода ---
function guestUpdate(dt) {
  for (const n of [player, bot]) {
    if (n.tx !== undefined && n.alive) {
      n.moving = dist(n.x, n.y, n.tx, n.ty) > 2;
      n.x += (n.tx - n.x) * Math.min(1, dt * 15);
      n.y += (n.ty - n.y) * Math.min(1, dt * 15);
      if (n.moving) n.stepPhase += dt * 10;
    }
    const targetA = Math.atan2(n.face.y, n.face.x);
    n.dispAngle += angDiff(targetA, n.dispAngle) * Math.min(1, dt * 14);
  }
  for (const pr of projectiles) {
    pr.x += pr.dx * pr.speed * dt;
    pr.y += pr.dy * pr.speed * dt;
    if (pr.type === 'dagger') pr.spin += dt * 20;
  }
  // ввод ~20 раз/с
  netFrame++;
  if (netFrame % 3 === 0 && state === 'fight') {
    let jx = 0, jy = 0;
    if (joy.active) {
      jx = joy.dx / JOY_RADIUS; jy = joy.dy / JOY_RADIUS;
    } else {
      jx = (keys['arrowright'] ? 1 : 0) - (keys['arrowleft'] ? 1 : 0);
      jy = (keys['arrowdown'] ? 1 : 0) - (keys['arrowup'] ? 1 : 0);
    }
    // мир у гостя повёрнут на 180° — жесты инвертируются в мировые координаты
    jx *= dirSign(); jy *= dirSign();
    netSend({ t: 'i', j: [Math.round(jx * 100) / 100, Math.round(jy * 100) / 100] });
  }
}

// ---------- ИИ бота ----------
function updateBot(dt) {
  if (!bot.alive || state !== 'fight') return;

  const toP = { x: player.x - bot.x, y: player.y - bot.y };
  const d = Math.hypot(toP.x, toP.y);
  const dirToP = norm(toP.x, toP.y);
  bot.face = dirToP;

  // --- Движение: держим дистанцию 150–320, страйфимся ---
  bot.strafeTimer -= dt;
  if (bot.strafeTimer <= 0) {
    bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
    bot.strafeTimer = rand(0.7, 1.6);
  }
  let mx = 0, my = 0;
  const perp = { x: -dirToP.y * bot.strafeDir, y: dirToP.x * bot.strafeDir };
  if (d > 320) { mx += dirToP.x; my += dirToP.y; }
  else if (d < 150) { mx -= dirToP.x; my -= dirToP.y; }
  mx += perp.x * 0.9; my += perp.y * 0.9;
  const mv = norm(mx, my);
  bot.vx = mv.x * MOVE_SPEED;
  bot.vy = mv.y * MOVE_SPEED;

  // --- Уклонение: замечаем летящие в нас снаряды с задержкой реакции ---
  let threat = null;
  for (const pr of projectiles) {
    if (pr.owner === bot) continue;
    const pd = dist(pr.x, pr.y, bot.x, bot.y);
    if (pr.type === 'dagger') {
      if (pr.homing && pd < 300) { threat = pr; break; }
    } else {
      const toBot = norm(bot.x - pr.x, bot.y - pr.y);
      const facing = toBot.x * pr.dx + toBot.y * pr.dy;
      if (facing > 0.86 && pd < 300) { threat = pr; break; }
    }
  }
  if (threat && !bot.dodgePlanned) {
    bot.dodgePlanned = true;
    bot.dodgeAt = tNow + rand(0.16, 0.34); // человеческая реакция
  }
  if (!threat) bot.dodgePlanned = false;
  if (threat && bot.dodgePlanned && tNow >= bot.dodgeAt) {
    bot.dodgePlanned = false;
    if (threat.type === 'dagger') {
      // от самонаводящегося кинжала спасают только щит или блинк
      if (tNow >= bot.cds.shield && (Math.random() < 0.55 || tNow < bot.cds.blink)) {
        castSkill(bot, 'shield', dirToP);
      } else if (tNow >= bot.cds.blink) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const bdir = norm(-threat.dy * side, threat.dx * side);
        castSkill(bot, 'blink', bdir, rand(150, 250));
      }
      // оба на перезарядке — бот обречён, это и есть хардкор
    } else {
      const roll = Math.random();
      if (roll < 0.4 && tNow >= bot.cds.shield) {
        castSkill(bot, 'shield', dirToP);
      } else if (roll < 0.8 && tNow >= bot.cds.blink) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const bdir = norm(-threat.dy * side + dirToP.x * 0.3, threat.dx * side + dirToP.y * 0.3);
        castSkill(bot, 'blink', bdir, rand(140, 250));
      } else {
        bot.strafeDir *= -1; // просто резко меняем страйф
        bot.strafeTimer = rand(0.5, 1);
      }
    }
  }

  // --- Атака ---
  bot.aggroTimer -= dt;
  if (bot.aggroTimer <= 0) {
    bot.aggroTimer = rand(0.25, 0.7);
    // упреждение по скорости игрока + человеческая ошибка прицела
    const lead = (spd) => {
      const t = d / spd;
      const px = player.x + player.vx * t * rand(0.5, 1);
      const py = player.y + player.vy * t * rand(0.5, 1);
      const err = rand(-0.11, 0.11);
      const dir0 = norm(px - bot.x, py - bot.y);
      const cos = Math.cos(err), sin = Math.sin(err);
      return { x: dir0.x * cos - dir0.y * sin, y: dir0.x * sin + dir0.y * cos };
    };
    if (tNow >= bot.cds.dagger && d < 620) {
      castSkill(bot, 'dagger', dirToP); // самонаводится, прицел не нужен
    } else if (tNow >= bot.cds.wave && d < 480 && Math.random() < 0.6) {
      castSkill(bot, 'wave', lead(SKILLS.wave.speed)); // волна бьёт сквозь стены
    } else if (tNow >= bot.cds.blink && d > 400 && Math.random() < 0.25) {
      castSkill(bot, 'blink', dirToP, d - 260); // агрессивное сближение
    }
  }
}

// ---------- Обновление ----------
function moveNinja(n, dt) {
  n.x += n.vx * dt;
  n.y += n.vy * dt;
  n.x = clamp(n.x, n.r, W - n.r);
  n.y = clamp(n.y, n.r, H - n.r);
  for (const o of OBSTACLES) {
    const cx = clamp(n.x, o.x, o.x + o.w);
    const cy = clamp(n.y, o.y, o.y + o.h);
    const dx = n.x - cx, dy = n.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < n.r * n.r) {
      if (d2 === 0) { n.y = o.y - n.r; }
      else {
        const dd = Math.sqrt(d2);
        n.x = cx + dx / dd * n.r;
        n.y = cy + dy / dd * n.r;
      }
    }
  }
}

function update(dt) {
  if (netRole === 'guest') {
    // гость не считает игру — только плавно следует за снапшотами хоста
    guestUpdate(dt);
  } else if (state === 'countdown') {
    if (tNow >= stateEnd) {
      countdownVal--;
      if (countdownVal <= 0) { state = 'fight'; SND.go(); }
      else { stateEnd = tNow + 1; SND.count(); }
    }
  } else if (state === 'roundend') {
    if (tNow >= stateEnd) {
      if (score.you >= WIN_SCORE || score.bot >= WIN_SCORE) {
        state = 'gameover';
      } else {
        round++;
        resetRound();
      }
    }
  }

  if (state === 'fight' && netRole !== 'guest') {
    // Игрок: джойстик или клавиатура
    // Джойстик приоритетнее; на ПК движение — стрелки (Q/W/E/R заняты скиллами)
    let ix = joy.dx, iy = joy.dy;
    if (!joy.active) {
      ix = (keys['arrowright'] ? 1 : 0) - (keys['arrowleft'] ? 1 : 0);
      iy = (keys['arrowdown'] ? 1 : 0) - (keys['arrowup'] ? 1 : 0);
    }
    const im = Math.hypot(ix, iy);
    const deadzone = joy.active ? 5 : 0.1;
    if (im > deadzone) {
      const nd = norm(ix, iy);
      const spdK = joy.active ? clamp(im / JOY_RADIUS * 1.6, 0, 1) : 1;
      player.vx = nd.x * MOVE_SPEED * spdK;
      player.vy = nd.y * MOVE_SPEED * spdK;
      if (!aimDrag.skill) player.face = nd;
    } else {
      player.vx = 0; player.vy = 0;
    }
    moveNinja(player, dt);

    if (netRole === 'host') {
      // красным ниндзя управляет гость
      const gm = Math.hypot(guestInput.jx, guestInput.jy);
      if (gm > 0.08) {
        const nd = norm(guestInput.jx, guestInput.jy);
        const k = clamp(gm * 1.6, 0, 1);
        bot.vx = nd.x * MOVE_SPEED * k;
        bot.vy = nd.y * MOVE_SPEED * k;
        bot.face = nd;
      } else {
        bot.vx = 0; bot.vy = 0;
      }
    } else {
      updateBot(dt);
    }
    moveNinja(bot, dt);

    // сглаживание разворота и фаза шагов
    for (const n of [player, bot]) {
      const targetA = Math.atan2(n.face.y, n.face.x);
      n.dispAngle += angDiff(targetA, n.dispAngle) * Math.min(1, dt * 14);
      const spd = Math.hypot(n.vx, n.vy);
      n.moving = spd > 10;
      if (n.moving) n.stepPhase += dt * (6 + spd / 22);
    }

    // Замахи: по истечении задержки скилл срабатывает
    for (let i = pendingCasts.length - 1; i >= 0; i--) {
      const pc = pendingCasts[i];
      if (tNow >= pc.at) {
        pendingCasts.splice(i, 1);
        if (pc.ninja.alive) {
          burst(pc.ninja.x + pc.dir.x * pc.ninja.r, pc.ninja.y + pc.dir.y * pc.ninja.r,
                SKILLS[pc.name].color, 6, 70);
          releaseSkill(pc.ninja, pc.name, pc.dir, pc.blinkDist);
        }
      }
    }

    // Снаряды
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      let dead = false;

      // самонаведение кинжала; препятствия его не блокируют —
      // спастись можно только щитом или блинком
      if (pr.type === 'dagger') {
        if (pr.homing && pr.target.blinkSeq !== pr.seq) {
          // цель ушла блинком: летим в точку, откуда был сделан блинк, и исчезаем там
          pr.homing = false;
          pr.destX = pr.target.lastBlinkFrom.x;
          pr.destY = pr.target.lastBlinkFrom.y;
        }
        if (pr.homing && pr.target.alive) {
          const d0 = norm(pr.target.x - pr.x, pr.target.y - pr.y);
          pr.dx = d0.x; pr.dy = d0.y;
        } else if (!pr.homing) {
          const d0 = norm(pr.destX - pr.x, pr.destY - pr.y);
          pr.dx = d0.x; pr.dy = d0.y;
        }
      }

      const step = pr.speed * dt;
      if (pr.type === 'dagger' && !pr.homing && dist(pr.x, pr.y, pr.destX, pr.destY) <= step) {
        burst(pr.destX, pr.destY, '#aaaaaa', 6, 60);
        projectiles.splice(i, 1);
        continue;
      }
      pr.x += pr.dx * step;
      pr.y += pr.dy * step;
      pr.traveled += step;
      if (pr.type === 'dagger') pr.spin += dt * 20;

      if (pr.type === 'wave') {
        dead = pr.traveled >= pr.range ||
               pr.x < -60 || pr.x > W + 60 || pr.y < -60 || pr.y > H + 60;
      }

      if (!dead) {
        for (const n of [player, bot]) {
          if (n === pr.owner || !n.alive) continue;
          let hit = false;
          if (pr.type === 'dagger') {
            hit = dist(pr.x, pr.y, n.x, n.y) < n.r + pr.r;
          } else {
            // дуга волны: центр кривизны позади фронта
            const ccx = pr.x - pr.dx * pr.arcR, ccy = pr.y - pr.dy * pr.arcR;
            const dc = dist(n.x, n.y, ccx, ccy);
            const dAng = Math.abs(angDiff(Math.atan2(n.y - ccy, n.x - ccx), Math.atan2(pr.dy, pr.dx)));
            hit = Math.abs(dc - pr.arcR) < n.r + 9 && dAng < pr.halfAngle;
            if (hit && pr.hitSet && pr.hitSet.has(n)) hit = false;
          }
          if (hit) {
            const killed = tryKill(n, pr.owner);
            if (pr.type === 'dagger') { dead = true; }
            else {
              // волна не исчезает: помечаем, чтобы щит не триггерился каждый кадр
              if (!pr.hitSet) pr.hitSet = new Set();
              pr.hitSet.add(n);
            }
            if (killed) break;
          }
        }
      }
      if (dead) projectiles.splice(i, 1);
    }
  }

  // Частицы
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
  }

  if (shake > 0) shake = Math.max(0, shake - dt * 30);
}

// ---------- Отрисовка ----------
let floorPattern = null;

function drawArena() {
  // пол: тайлящаяся текстура (или градиент, пока не загрузилась)
  if (imgReady(IMG.floor)) {
    if (!floorPattern) {
      const t = document.createElement('canvas');
      t.width = t.height = 128; // масштаб плитки
      t.getContext('2d').drawImage(IMG.floor, 0, 0, 128, 128);
      floorPattern = ctx.createPattern(t, 'repeat');
    }
    ctx.fillStyle = floorPattern;
    ctx.fillRect(0, 0, W, H);
    // лёгкое затемнение к краям для глубины
    const vg = ctx.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, 'rgba(0,0,0,0.25)');
    vg.addColorStop(0.5, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#141c26');
    g.addColorStop(0.5, '#101720');
    g.addColorStop(1, '#141c26');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  // центральная линия — по короткой оси арены
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.setLineDash([10, 12]);
  ctx.beginPath();
  if (W > H) { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); }
  else { ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); }
  ctx.stroke();
  ctx.setLineDash([]);

  // препятствия — текстура «коробка» (запасной вариант — ящик из спрайт-листа)
  const crate = imgReady(IMG.box) ? IMG.box : IMG.crate;
  for (const o of OBSTACLES) {
    if (imgReady(crate)) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(o.x - 2, o.y + 4, o.w + 4, o.h);
      // укладываем ящики вдоль длинной стороны
      if (o.w >= o.h) {
        const tiles = Math.max(1, Math.round(o.w / o.h));
        const tw = o.w / tiles;
        for (let i = 0; i < tiles; i++) ctx.drawImage(crate, o.x + i * tw, o.y - 4, tw, o.h + 4);
      } else {
        const tiles = Math.max(1, Math.round(o.h / o.w));
        const th = o.h / tiles;
        for (let i = 0; i < tiles; i++) ctx.drawImage(crate, o.x, o.y + i * th - 2, o.w, th + 2);
      }
    } else {
      ctx.fillStyle = '#26313f';
      ctx.fillRect(o.x, o.y + 4, o.w, o.h);
      ctx.fillStyle = '#39485c';
      ctx.fillRect(o.x, o.y, o.w, o.h - 4);
      ctx.strokeStyle = 'rgba(120,160,200,0.25)';
      ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 5);
    }
  }

  // рамка арены
  ctx.strokeStyle = 'rgba(120,160,200,0.3)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
}

function drawNinja(n) {
  if (!n.alive) return;
  ctx.save();
  ctx.translate(n.x, n.y);

  // тень (в направленных кадрах тень уже запечена в спрайт)
  if (!imgReady(IMG[(n.sprite === 'ninja_red' ? 'red' : 'blue') + '_idle_' + dirIndex(n.dispAngle)])) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, n.r * 0.7, n.r * 0.9, n.r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }

  // направленный кадр: стойка или цикл бега (1-2-3-2) по фазе шагов
  const di = dirIndex(n.dispAngle);
  const runF = [1, 2, 3, 2][Math.floor(n.stepPhase / 1.3) % 4];
  const kind = n.moving ? 'run' + runF : 'idle';
  const animSet = n.sprite === 'ninja_red' ? 'red' : 'blue';
  const dirIm = IMG[animSet + '_' + kind + '_' + di];
  const im = IMG[n.sprite];
  if (imgReady(dirIm)) {
    // кадры нормализованы: холст 170x170, ноги на y=162 — якорим к низу хитбокса
    let sy = 1;
    if (n.moving) sy = 1 + Math.sin(n.stepPhase * 2) * 0.03;
    else sy = 1 + Math.sin(tNow * 2.6) * 0.015; // дыхание в покое
    const dw = 62;
    ctx.scale(1, sy);
    ctx.drawImage(dirIm, -dw / 2, n.r - dw * (162 / 170), dw, dw);
    ctx.scale(1, 1 / sy);
  } else if (imgReady(im)) {
    // запасной вариант: одиночный спрайт с программным поворотом
    const a = n.dispAngle - Math.PI / 2;
    let sx = 1, sy = 1;
    if (n.moving) {
      const hop = 1 + Math.abs(Math.sin(n.stepPhase)) * 0.05;
      sx = (1 - Math.sin(n.stepPhase * 2) * 0.035) * hop;
      sy = (1 + Math.sin(n.stepPhase * 2) * 0.05) * hop;
    } else {
      sy = 1 + Math.sin(tNow * 2.6) * 0.02;
    }
    const dw = 46, dh = dw * im.naturalHeight / im.naturalWidth;
    ctx.rotate(a);
    ctx.scale(sx, sy);
    ctx.drawImage(im, -dw / 2, -dh * 0.52, dw, dh);
    ctx.scale(1 / sx, 1 / sy);
    ctx.rotate(-a);
  } else {
    // запасная отрисовка, пока спрайт не загрузился
    ctx.fillStyle = n.darkColor;
    ctx.beginPath(); ctx.arc(0, 0, n.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = n.color;
    ctx.beginPath(); ctx.arc(0, -1.5, n.r - 2.5, 0, Math.PI * 2); ctx.fill();
    const a = Math.atan2(n.face.y, n.face.x);
    ctx.rotate(a);
    ctx.fillStyle = '#111820';
    ctx.fillRect(2, -5.5, n.r - 3, 11);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(n.r - 7, -3.2, 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(n.r - 7, 3.2, 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(-a);
  }

  // щит
  if (tNow < n.shieldUntil) {
    const k = (n.shieldUntil - tNow) / SKILLS.shield.duration;
    ctx.strokeStyle = SKILLS.shield.color;
    ctx.globalAlpha = 0.4 + 0.5 * k + Math.sin(tNow * 20) * 0.1;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, n.r + 6 + Math.sin(tNow * 12) * 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // индикатор замаха: заполняющееся кольцо цвета скилла
  for (const pc of pendingCasts) {
    if (pc.ninja !== n) continue;
    const prog = clamp((tNow - pc.t0) / (pc.at - pc.t0), 0, 1);
    ctx.strokeStyle = SKILLS[pc.name].color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, n.r + 10, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // метка "ВЫ" рисуется в drawHUD — в экранных координатах, чтобы не переворачивалась у гостя
}

function drawProjectiles() {
  for (const pr of projectiles) {
    if (pr.type === 'dagger') {
      ctx.save();
      ctx.translate(pr.x, pr.y);
      // след
      ctx.strokeStyle = 'rgba(196,107,255,0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-pr.dx * 20, -pr.dy * 20);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.rotate(pr.spin);
      const sh = IMG.fx_shuriken;
      if (imgReady(sh)) {
        const sw = 24, shh = sw * sh.naturalHeight / sh.naturalWidth;
        ctx.drawImage(sh, -sw / 2, -shh / 2, sw, shh);
      } else {
        ctx.fillStyle = SKILLS.dagger.color;
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(0, 0); ctx.lineTo(8, -2); ctx.lineTo(8, 2);
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
    } else {
      // волна Магнуса: выпуклая вперёд светящаяся дуга со шлейфом
      ctx.save();
      const ang = Math.atan2(pr.dy, pr.dx);
      const ccx = pr.x - pr.dx * pr.arcR, ccy = pr.y - pr.dy * pr.arcR;
      ctx.translate(ccx, ccy);
      ctx.rotate(ang);
      // шлейф из затухающих дуг позади фронта
      for (let k = 3; k >= 1; k--) {
        ctx.strokeStyle = 'rgba(255,157,59,' + (0.13 * k) + ')';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, pr.arcR - k * 9, -pr.halfAngle * 0.96, pr.halfAngle * 0.96);
        ctx.stroke();
      }
      // фронт
      ctx.strokeStyle = 'rgba(255,157,59,0.9)';
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(0, 0, pr.arcR, -pr.halfAngle, pr.halfAngle); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,236,190,0.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, pr.arcR + 2.5, -pr.halfAngle * 0.9, pr.halfAngle * 0.9); ctx.stroke();
      ctx.restore();
      // искры на фронте
      if (Math.random() < 0.6) {
        const a2 = ang + rand(-pr.halfAngle, pr.halfAngle);
        particles.push({
          x: ccx + Math.cos(a2) * pr.arcR, y: ccy + Math.sin(a2) * pr.arcR,
          vx: pr.dx * 50 + rand(-20, 20), vy: pr.dy * 50 + rand(-20, 20),
          life: 0.25, maxLife: 0.3, color: '#ffcf8a', size: 2.5,
        });
      }
    }
  }
}

function drawDeaths() {
  for (let i = deathAnims.length - 1; i >= 0; i--) {
    const d = deathAnims[i];
    const k = (tNow - d.t0) / d.dur;
    if (k >= 1) { deathAnims.splice(i, 1); continue; }
    const im = IMG[d.sprite];
    if (!imgReady(im)) continue;
    const sc = 1 - k * 0.6;
    const dw = 46 * sc, dh = dw * im.naturalHeight / im.naturalWidth;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.globalAlpha = 1 - k;
    ctx.rotate(d.angle + d.spin * k); // тело закручивается и тает
    ctx.drawImage(im, -dw / 2, -dh * 0.52, dw, dh);
    ctx.restore();
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawAimIndicator() {
  if (!aimDrag.skill || state !== 'fight') return;
  const my = me(), en = foe();
  const dragLen = Math.hypot(aimDrag.dx, aimDrag.dy);
  let dir;
  if (dragLen < 14) {
    dir = aimDrag.skill === 'blink'
      ? norm(my.face.x, my.face.y)
      : norm(en.x - my.x, en.y - my.y);
  } else dir = norm(aimDrag.dx * dirSign(), aimDrag.dy * dirSign());

  const s = SKILLS[aimDrag.skill];
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.globalAlpha = 0.65;

  if (aimDrag.skill === 'blink') {
    const d = dragLen < 14 ? s.range : clamp(dragLen / 95, 0.3, 1) * s.range;
    const tx = clamp(my.x + dir.x * d, NINJA_R, W - NINJA_R);
    const ty = clamp(my.y + dir.y * d, NINJA_R, H - NINJA_R);
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(my.x, my.y); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(tx, ty, NINJA_R + 4, 0, Math.PI * 2); ctx.stroke();
  } else if (aimDrag.skill === 'wave') {
    // пунктирная линия направления + предпросмотр фронта дуги
    const wAng = Math.atan2(dir.y, dir.x);
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(my.x + dir.x * (NINJA_R + 6), my.y + dir.y * (NINJA_R + 6));
    ctx.lineTo(my.x + dir.x * 340, my.y + dir.y * 340);
    ctx.stroke();
    ctx.setLineDash([]);
    const pcx = my.x + dir.x * (120 - s.arcR), pcy = my.y + dir.y * (120 - s.arcR);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(pcx, pcy, s.arcR, wAng - s.halfAngle, wAng + s.halfAngle);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSkillIcon(name, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#eaf6ff';
  ctx.fillStyle = '#eaf6ff';
  ctx.lineWidth = 2.5;
  const k = r / 35;
  ctx.scale(k, k);

  if (name === 'shield') {
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.quadraticCurveTo(12, -10, 12, -2);
    ctx.quadraticCurveTo(12, 9, 0, 14);
    ctx.quadraticCurveTo(-12, 9, -12, -2);
    ctx.quadraticCurveTo(-12, -10, 0, -13);
    ctx.stroke();
  } else if (name === 'blink') {
    ctx.beginPath();
    ctx.moveTo(3, -14); ctx.lineTo(-7, 2); ctx.lineTo(0, 2);
    ctx.lineTo(-3, 14); ctx.lineTo(7, -2); ctx.lineTo(0, -2);
    ctx.closePath();
    ctx.fill();
  } else if (name === 'wave') {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(-12 + i * 8, 0, 10, -Math.PI / 2.6, Math.PI / 2.6);
      ctx.stroke();
    }
  } else if (name === 'dagger') {
    ctx.rotate(-Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, -16); ctx.lineTo(4, -4); ctx.lineTo(4, 6);
    ctx.lineTo(-4, 6); ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-8, 6, 16, 3);
    ctx.fillRect(-2, 9, 4, 7);
  }
  ctx.restore();
}

function drawHUD() {
  // метка "ВЫ" над моим ниндзя (экранные координаты — мир у гостя повёрнут)
  const my = me();
  if (my.alive && (state === 'fight' || state === 'countdown' || state === 'roundend')) {
    const sp = worldToScreen(my.x, my.y);
    ctx.fillStyle = 'rgba(180,220,255,0.8)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ВЫ', sp.x, sp.y + my.r + 14);
  }

  // Кнопки скиллов
  for (const b of BUTTONS) {
    const s = SKILLS[b.skill];
    const cdLeft = me().cds[b.skill] - tNow;
    const ready = cdLeft <= 0;
    const active = aimDrag.skill === b.skill;

    ctx.save();
    ctx.globalAlpha = ready ? 1 : 0.75;
    // подложка
    ctx.fillStyle = active ? 'rgba(255,255,255,0.22)' : 'rgba(10,16,24,0.72)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();

    // иконка скилла (картинка в круге; запасной вариант — рисованная)
    const icon = IMG['icon_' + b.skill];
    if (imgReady(icon)) {
      ctx.save();
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 2.5, 0, Math.PI * 2); ctx.clip();
      const ir = b.r - 2.5;
      ctx.drawImage(icon, b.x - ir, b.y - ir, ir * 2, ir * 2);
      ctx.restore();
    } else {
      drawSkillIcon(b.skill, b.x, b.y - 3, b.r);
    }

    // цветное кольцо поверх иконки
    ctx.strokeStyle = ready ? s.color : 'rgba(140,150,165,0.7)';
    ctx.lineWidth = active ? 5 : 3.5;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 2, 0, Math.PI * 2); ctx.stroke();

    // название (с тёмной обводкой — читается поверх иконки)
    ctx.font = `bold ${Math.round(b.r * 0.22)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8,12,20,0.85)';
    ctx.strokeText(s.label, b.x, b.y + b.r * 0.62);
    ctx.fillStyle = 'rgba(230,240,255,0.92)';
    ctx.fillText(s.label, b.x, b.y + b.r * 0.62);

    // перезарядка: затемняющий сектор + секунды
    if (!ready) {
      const frac = clamp(cdLeft / s.cd, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, b.r - 2, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(b.r * 0.5)}px sans-serif`;
      ctx.fillText(Math.ceil(cdLeft), b.x, b.y + b.r * 0.18);
    }
    ctx.restore();
  }

  // Джойстик
  if (joy.active) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#a8c6e8';
    ctx.beginPath(); ctx.arc(joy.bx, joy.by, JOY_RADIUS, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#dcecff';
    ctx.beginPath(); ctx.arc(joy.bx + joy.dx, joy.by + joy.dy, 26, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else if (state === 'fight' || state === 'countdown') {
    // подсказка зоны джойстика
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = '#a8c6e8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(92, VH - 130, JOY_RADIUS, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Счёт (в Telegram — ниже, чтобы не попадать под его шапку в полном экране)
  ctx.save();
  ctx.textAlign = 'center';
  const dy = TG ? 46 : 0;
  ctx.fillStyle = 'rgba(8,14,22,0.7)';
  const swW = 200, swH = 46;
  roundRect(VW / 2 - swW / 2, 10 + dy, swW, swH, 12);
  ctx.fill();
  const myScore = netRole === 'guest' ? score.bot : score.you;
  const foeScore = netRole === 'guest' ? score.you : score.bot;
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = me().color;
  ctx.fillText(myScore, VW / 2 - 46, 42 + dy);
  ctx.fillStyle = 'rgba(230,240,255,0.85)';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(':', VW / 2, 40 + dy);
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = foe().color;
  ctx.fillText(foeScore, VW / 2 + 46, 42 + dy);
  ctx.fillStyle = 'rgba(180,195,215,0.8)';
  ctx.font = '11px sans-serif';
  ctx.fillText('РАУНД ' + round + ' • ДО ' + WIN_SCORE, VW / 2, 68 + dy);
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawOverlays() {
  ctx.textAlign = 'center';

  if (state === 'menu') {
    ctx.fillStyle = 'rgba(5,10,16,0.78)';
    ctx.fillRect(0, 0, VW, VH);
    const compact = VW > VH; // низкий ландшафтный экран
    ctx.fillStyle = '#eaf6ff';
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText('MOBILE', VW / 2, compact ? 60 : VH / 2 - 130);
    ctx.fillStyle = '#ff5964';
    ctx.fillText('NINJA', VW / 2, compact ? 112 : VH / 2 - 74);
    ctx.fillStyle = 'rgba(200,215,235,0.9)';
    ctx.font = '17px sans-serif';
    ctx.fillText('Хардкор 1 на 1 • одно попадание = смерть', VW / 2, compact ? 146 : VH / 2 - 24);
    ctx.fillText('Побеждает первый набравший ' + WIN_SCORE, VW / 2, compact ? 170 : VH / 2 + 4);
    if (!compact || VH > 430) {
      ctx.font = '14px sans-serif';
      ctx.fillStyle = 'rgba(160,180,205,0.85)';
      const hy = compact ? 202 : VH / 2 + 42;
      ctx.fillText('Джойстик слева — движение, скиллы справа', VW / 2, hy);
      ctx.fillText('Кинжал наводится сам — спасут лишь щит и блинк', VW / 2, hy + 24);
      ctx.fillText('ПК: стрелки + Q/W/E/R по курсору', VW / 2, hy + 48);
    }
    // сообщение сети (ошибка/выход противника)
    if (netMsg) {
      ctx.fillStyle = '#ff8a94';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(netMsg, VW / 2, compact ? 190 : VH / 2 + 34);
    }
    // кнопки меню
    for (const mb of menuButtons()) {
      const isMode = mb.act === 'mode_land' || mb.act === 'mode_port';
      const sel = (mb.act === 'mode_land' && MODE === 'landscape') ||
                  (mb.act === 'mode_port' && MODE === 'portrait');
      ctx.fillStyle = sel ? 'rgba(255,209,102,0.16)' : 'rgba(255,255,255,0.06)';
      roundRect(mb.x, mb.y, mb.w, mb.h, 12);
      ctx.fill();
      ctx.strokeStyle = sel ? '#ffd166' : (isMode ? 'rgba(200,215,235,0.35)' : 'rgba(200,215,235,0.55)');
      ctx.lineWidth = 2.5;
      roundRect(mb.x, mb.y, mb.w, mb.h, 12);
      ctx.stroke();
      ctx.fillStyle = sel ? '#ffd166' : 'rgba(230,240,255,0.92)';
      ctx.font = `bold ${isMode ? 15 : 18}px sans-serif`;
      ctx.fillText(mb.label, mb.x + mb.w / 2, mb.y + mb.h / 2 + 6);
    }
  } else if (state === 'lobby') {
    ctx.fillStyle = 'rgba(5,10,16,0.85)';
    ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#eaf6ff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('ИГРА С ДРУГОМ', VW / 2, VH / 2 - 110);
    if (roomCode) {
      ctx.fillStyle = 'rgba(200,215,235,0.9)';
      ctx.font = '17px sans-serif';
      ctx.fillText('Код комнаты:', VW / 2, VH / 2 - 60);
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 64px monospace';
      ctx.fillText(roomCode, VW / 2, VH / 2 + 10);
      // кнопка приглашения (Telegram-ссылка или системный шаринг/буфер)
      const b = inviteBtnRect();
      ctx.fillStyle = 'rgba(255,209,102,0.16)';
      roundRect(b.x, b.y, b.w, b.h, 14);
      ctx.fill();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2.5;
      roundRect(b.x, b.y, b.w, b.h, 14);
      ctx.stroke();
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 19px sans-serif';
      ctx.fillText('ПРИГЛАСИТЬ ДРУГА', VW / 2, b.y + 31);
      const blinkOn = Math.sin(tNow * 4) > -0.3;
      ctx.font = '15px sans-serif';
      if (netMsg) {
        ctx.fillStyle = '#8aff6b';
        ctx.fillText(netMsg, VW / 2, VH / 2 + 122);
      } else if (blinkOn) {
        ctx.fillStyle = 'rgba(160,180,205,0.9)';
        ctx.fillText('Ожидание друга… (или скажи ему код)', VW / 2, VH / 2 + 122);
      }
    } else {
      ctx.fillStyle = 'rgba(200,215,235,0.9)';
      ctx.font = '18px sans-serif';
      ctx.fillText(netMsg || 'Подключение…', VW / 2, VH / 2);
    }
    ctx.fillStyle = 'rgba(160,180,205,0.7)';
    ctx.font = '14px sans-serif';
    ctx.fillText('Коснись пустого места, чтобы отменить', VW / 2, VH / 2 + 156);
  } else if (state === 'countdown') {
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 90px sans-serif';
    ctx.fillText(countdownVal, VW / 2, VH / 2 - 60);
  } else if (state === 'roundend') {
    ctx.fillStyle = 'rgba(5,10,16,0.45)';
    ctx.fillRect(0, VH / 2 - 110, VW, 120);
    ctx.fillStyle = banner === 'УБИЙСТВО!' ? '#8aff6b' : '#ff5964';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(banner, VW / 2, VH / 2 - 40);
  } else if (state === 'gameover') {
    ctx.fillStyle = 'rgba(5,10,16,0.82)';
    ctx.fillRect(0, 0, VW, VH);
    const myS = netRole === 'guest' ? score.bot : score.you;
    const foeS = netRole === 'guest' ? score.you : score.bot;
    const won = myS >= WIN_SCORE;
    ctx.fillStyle = won ? '#8aff6b' : '#ff5964';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText(won ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ', VW / 2, VH / 2 - 80);
    ctx.fillStyle = '#eaf6ff';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(myS + ' : ' + foeS, VW / 2, VH / 2 - 20);
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 20px sans-serif';
    if (Math.sin(tNow * 4) > -0.3) {
      ctx.fillText(netRole === 'guest' ? 'КОСНИСЬ ДЛЯ ВЫХОДА В МЕНЮ' : 'КОСНИСЬ ДЛЯ НОВОЙ ИГРЫ', VW / 2, VH / 2 + 60);
    }
  }

  if (state === 'fight' && tNow - lastGoTime < 0.8) {
    ctx.fillStyle = '#8aff6b';
    ctx.globalAlpha = 1 - (tNow - lastGoTime) / 0.8;
    ctx.font = 'bold 70px sans-serif';
    ctx.fillText('БОЙ!', VW / 2, VH / 2 - 60);
    ctx.globalAlpha = 1;
  }
}

let lastGoTime = -10;

function render() {
  // фон за пределами арены (леттербокс)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#06090d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sx = shake > 0 ? rand(-shake, shake) : 0;
  const sy = shake > 0 ? rand(-shake, shake) : 0;
  ctx.setTransform(scale, 0, 0, scale,
    offX + (sx * 0.4 - camX) * scale,
    offY + (sy * 0.4 - camY) * scale);

  // мир: гость видит арену повёрнутой на 180° — свой ниндзя всегда снизу/слева
  if (netRole === 'guest') {
    ctx.translate(W, H);
    ctx.rotate(Math.PI);
  }
  drawArena();
  drawAimIndicator();
  drawDeaths();
  drawNinja(bot);
  drawNinja(player);
  drawProjectiles();
  drawParticles();

  // интерфейс — всегда в экранных координатах, без поворота
  ctx.setTransform(scale, 0, 0, scale, offX, offY);
  drawHUD();
  drawOverlays();
}

// ---------- Главный цикл ----------
let lastFrame = performance.now();
let prevState = state;

function loop(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.033);
  lastFrame = now;
  tNow += dt;

  update(dt);
  if (prevState === 'countdown' && state === 'fight') lastGoTime = tNow;
  prevState = state;

  // камера следует за моим ниндзя (плавно; при больших скачках — мгновенно)
  const ct2 = camTarget();
  if (Math.abs(ct2.x - camX) + Math.abs(ct2.y - camY) > 500) {
    camX = ct2.x; camY = ct2.y;
  } else {
    const ck = Math.min(1, dt * 8);
    camX += (ct2.x - camX) * ck;
    camY += (ct2.y - camY) * ck;
  }

  // хост шлёт состояние гостю ~30 раз/с
  netFrame++;
  if (netRole === 'host' && netFrame % 2 === 0 && state !== 'menu' && state !== 'lobby') {
    netSend(buildSnapshot());
  }

  render();
  requestAnimationFrame(loop);
}

// Авто-вход по инвайт-ссылке Telegram: t.me/<бот>/<приложение>?startapp=КОД
const tgStart = (TG && TG.initDataUnsafe && TG.initDataUnsafe.start_param) ||
                new URLSearchParams(location.search).get('tgWebAppStartParam') || '';
if (/^[A-Za-z0-9]{4}$/.test(tgStart)) {
  joinRoomWithCode(tgStart.toUpperCase());
}

requestAnimationFrame(loop);
