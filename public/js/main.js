// ── Lunaris client: engine, render, input, gameplay ─────────
import { G, tileKey, xpForLevel } from './state.js';
import * as S from './sprites.js';
import { net, on, connectWS, send, api } from './net.js';
import { loadConfig, connect as walletConnect, disconnect as walletDisconnect,
         hasPhantom, skyBalance, wallet, payTreasury } from './wallet.js';
import { initUI, openPanel, refreshActivePanel, openBuyPanel } from './ui.js';

const TILE = S.TILE;
let zoom = 2;                 // current zoom (mouse wheel changes it)
let intro = null;             // spawn-in camera animation { t0, dur, from, target }
function startIntro() { intro = { t0: performance.now(), dur: 1000, from: 0.35, target: 1 }; camMode = 'follow'; }
const MAX_ZOOM = 3.2;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = true;

let VW = 0, VH = 0, DPR = 1;   // VW/VH in CSS px; DPR for crisp hi-res rendering
function resize() {
  DPR = Math.min(2.5, window.devicePixelRatio || 1);
  VW = innerWidth; VH = innerHeight;
  canvas.width = Math.round(VW * DPR); canvas.height = Math.round(VH * DPR);
  canvas.style.width = VW + 'px'; canvas.style.height = VH + 'px';
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
}
addEventListener('resize', resize); resize();

// floor on how far you can zoom out (≈5× less than fitting the whole map).
const ZOOM_FLOOR = 0.75;   // max dezoom reduced (÷3)
G.SHIP_COST = { cruiser: { plank: 10, ingot: 10 }, frigate: { plank: 20, ingot: 20 }, dread: { plank: 50, ingot: 50, goldingot: 10 } };
function minZoom() { return ZOOM_FLOOR; }

// ── input ───────────────────────────────────────────────────
const keys = {};
const mouse = { x: 0, y: 0, down: false, wx: 0, wy: 0 };
let mode = null;             // null | 'buy' | 'build'
let camMode = 'follow';      // 'follow' | 'free'
let moveTarget = null;       // {x,y} click-to-move destination
let moveQueue = [];          // remaining waypoints (e.g. routed around the arena)
let attackTarget = null;     // creature id
let farmTarget = null;       // node ref
// ── route a move around the locked arena instead of bumping into it ──
function arenaLockRect() {
  const a = G.world?.islands?.find(i => i.type === 'arena'); if (!a || G.me?.inArena) return null;
  const m = 6;
  return { x0: (a.x - 1) * TILE - m, y0: (a.y - 1) * TILE - m, x1: (a.x + a.w + 1) * TILE + m, y1: (a.y + a.h + 1) * TILE + m };
}
function segRect(x1, y1, x2, y2, R) {
  const inside = (x, y) => x >= R.x0 && x <= R.x1 && y >= R.y0 && y <= R.y1;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  const ss = (ax, ay, bx, by, cx, cy, dx, dy) => { const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (d === 0) return false; const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1; };
  return ss(x1, y1, x2, y2, R.x0, R.y0, R.x1, R.y0) || ss(x1, y1, x2, y2, R.x1, R.y0, R.x1, R.y1) || ss(x1, y1, x2, y2, R.x1, R.y1, R.x0, R.y1) || ss(x1, y1, x2, y2, R.x0, R.y1, R.x0, R.y0);
}
function routeAroundArena(px, py, tx, ty) {
  const R = arenaLockRect(); if (!R || !segRect(px, py, tx, ty, R)) return [{ x: tx, y: ty }];
  const m = 12, C = [{ x: R.x0 - m, y: R.y0 - m }, { x: R.x1 + m, y: R.y0 - m }, { x: R.x1 + m, y: R.y1 + m }, { x: R.x0 - m, y: R.y1 + m }];
  const near = (x, y) => { let bi = 0, bd = 1e18; C.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const a = near(px, py), b = near(tx, ty);
  const build = (dir) => { const wp = []; let i = a; for (let s = 0; s < 4; s++) { wp.push(C[i]); if (i === b) break; i = (i + dir + 4) % 4; } return wp; };
  const len = (wp) => { let d = Math.hypot(C[a].x - px, C[a].y - py); for (let i = 1; i < wp.length; i++) d += Math.hypot(wp[i].x - wp[i - 1].x, wp[i].y - wp[i - 1].y); return d + Math.hypot(tx - wp[wp.length - 1].x, ty - wp[wp.length - 1].y); };
  const f = build(1), g = build(-1);
  return [...(len(f) <= len(g) ? f : g), { x: tx, y: ty }];
}
function setMoveTo(x, y) { moveQueue = routeAroundArena(G.me.x, G.me.y, x, y); moveTarget = moveQueue.shift(); attackTarget = farmTarget = null; }
let lastAttack = 0;

// double-click + drag to pan
let lastClickT = 0, panning = false, panLast = null;

let invOpen = false;
addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); invOpen = !invOpen; openPanel(invOpen ? 'inventory' : null); return; }
  if (document.activeElement?.tagName === 'INPUT') return;
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ') { e.preventDefault(); tryFarm(); }
  if (e.key === 'Enter') { document.getElementById('chatText').focus(); }
  if (e.key === 'Escape') { exitModes(); openPanel(null); invOpen = false; }
  if (e.key === '+' || e.key === '=') setZoom(zoom * 1.2);
  if (e.key === '-' || e.key === '_') setZoom(zoom / 1.2);
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

function screenToWorld(sx, sy) { return { x: G.camera.x + sx / zoom, y: G.camera.y + sy / zoom }; }
function setZoom(z) { zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, z)); }

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey) {
    // trackpad pinch (or Ctrl+wheel) → zoom toward cursor
    const before = screenToWorld(e.clientX, e.clientY);
    setZoom(zoom * (e.deltaY < 0 ? 1.08 : 0.93));
    const after = screenToWorld(e.clientX, e.clientY);
    G.camera.x += before.x - after.x; G.camera.y += before.y - after.y; camMode = 'free';
  } else {
    // two-finger drag (trackpad) → pan the view
    camMode = 'free';
    G.camera.x += e.deltaX / zoom; G.camera.y += e.deltaY / zoom;
  }
}, { passive: false });

// touchscreen: two-finger drag to pan, pinch to zoom
let pinchD = 0, twoMid = null;
canvas.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const [a, b] = e.touches, mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (twoMid) { G.camera.x -= (mx - twoMid.x) / zoom; G.camera.y -= (my - twoMid.y) / zoom; camMode = 'free'; }
    if (pinchD) setZoom(zoom * (d / pinchD));
    twoMid = { x: mx, y: my }; pinchD = d;
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { pinchD = 0; twoMid = null; });

canvas.addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  const w = screenToWorld(e.clientX, e.clientY); mouse.wx = w.x; mouse.wy = w.y;
  if (panning) {
    const dx = (e.clientX - panLast.x) / zoom, dy = (e.clientY - panLast.y) / zoom;
    G.camera.x -= dx; G.camera.y -= dy; panLast = { x: e.clientX, y: e.clientY }; camMode = 'free';
  }
});

canvas.addEventListener('mousedown', e => {
  mouse.down = true;
  // minimap click takes priority
  if (handleMinimapClick(e.clientX, e.clientY)) return;
  const now = performance.now();
  const isDouble = now - lastClickT < 320;
  lastClickT = now;

  if (mode === 'buy' || mode === 'build') { startDrag(); return; }
  if (isDouble) { panning = true; panLast = { x: e.clientX, y: e.clientY }; moveTarget = attackTarget = farmTarget = null; G.me && (G.me.moving = false); return; } // double-click → drag-pan
  clickToCommand();          // single left click → move / attack / farm
});

addEventListener('mouseup', () => {
  if (mouse.down && (mode === 'buy' || mode === 'build')) endDrag();
  panning = false; mouse.down = false;
});

// touch: tap to move, drag with two fingers to pan
canvas.addEventListener('touchstart', e => {
  const t = e.touches[0]; mouse.x = t.clientX; mouse.y = t.clientY;
  const w = screenToWorld(t.clientX, t.clientY); mouse.wx = w.x; mouse.wy = w.y;
  if (handleMinimapClick(t.clientX, t.clientY)) return;
  if (mode === 'buy' || mode === 'build') startDrag(); else clickToCommand();
}, { passive: true });

// ── world helpers (cell-based) ──────────────────────────────
const LAND = new Set(['g', 's', 'w', 'r', 'n', 'l', 'p', 'b', 'm', 'h', 'd']);
let bridgeOpen = new Set();    // "x,y" walkable bridge tiles
let bridgeLocked = new Set();  // "x,y" tiles of locked bridges
function buildBridges() {
  bridgeOpen = new Set(); bridgeLocked = new Set();
  for (const b of (G.world.bridges || [])) {
    const set = b.locked ? bridgeLocked : bridgeOpen;
    for (const [x, y] of b.tiles) set.add(x + ',' + y);
  }
}
function islandAt(tx, ty) {
  return G.world?.islands.find(i => tx >= i.x && tx < i.x + i.w && ty >= i.y && ty < i.y + i.h) || null;
}
function cellAt(tx, ty) {
  const i = islandAt(tx, ty);
  if (!i) return '.';
  return i.cells[ty - i.y][tx - i.x];
}
function isWalkable(tx, ty) { return LAND.has(cellAt(tx, ty)) || bridgeOpen.has(tx + ',' + ty); }
function isAir(tx, ty) { return !isWalkable(tx, ty); }
function isOnIsland(tx, ty) { return !isAir(tx, ty); }
function canStand(px, py) { return isWalkable(Math.floor(px / TILE), Math.floor(py / TILE)); }

// farm-node generation on solid land cells (fixed spots, deterministic per island)
function buildNodes() {
  G.nodes = [];
  let seq = 0;
  const KINDS = { mining: ['iron', 'iron', 'iron'], hostile: ['meat'], build: ['iron', 'iron'] };   // no iron in the hostile zone
  for (const isl of G.world.islands) {
    if (isl.type === 'main' || isl.locked || isl.biome === 'agri') continue;  // agri farms WOOD (trees) only + meat from sheep
    const kinds = KINDS[isl.biome] || ['iron', 'meat'];
    const target = Math.round(isl.w * isl.h / 34);
    let s = (isl.x * 73856093 ^ isl.y * 19349663) >>> 0;
    let made = 0, guard = 0;
    while (made < target && guard++ < target * 30) {
      s = (s * 1103515245 + 12345) & 0x7fffffff; const lx = s % isl.w;
      s = (s * 1103515245 + 12345) & 0x7fffffff; const ly = s % isl.h;
      const ch = isl.cells[ly][lx];
      if (ch === '.' || ch === 'w' || ch === 'p' || ch === 'b' || ch === 'm') continue; // skip void/water/paths/city
      const tx = isl.x + lx, ty = isl.y + ly;
      if (G.nodes.some(n => Math.abs(n.tx - tx) < 1 && Math.abs(n.ty - ty) < 1)) continue;
      const kind = kinds[made % kinds.length];
      G.nodes.push({ id: 'n' + seq++, kind, tx, ty, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, hp: 3, dead: false });
      made++;
    }
  }
  // 5 gold mines in the Hostile Zone (farmed like iron)
  const hostile = G.world.islands.find(i => i.biome === 'hostile' && i.type !== 'small');
  if (hostile) {
    let gs = (hostile.x * 2654435761 ^ hostile.y * 40503) >>> 0, placed = 0, g = 0; const goldPts = [];
    while (placed < 6 && g++ < 2000) {
      gs = (gs * 1103515245 + 12345) & 0x7fffffff; const lx = gs % hostile.w;
      gs = (gs * 1103515245 + 12345) & 0x7fffffff; const ly = gs % hostile.h;
      const ch = hostile.cells[ly][lx];
      if (ch === '.' || ch === 'w' || ch === 'p' || ch === 'b' || ch === 'm') continue;
      const tx = hostile.x + lx, ty = hostile.y + ly;
      if (G.nodes.some(n => Math.abs(n.tx - tx) < 1 && Math.abs(n.ty - ty) < 1)) continue;
      if (goldPts.some(p => Math.hypot(p.x - tx, p.y - ty) < 7)) continue;          // spread the gold mines apart
      G.nodes.push({ id: 'n' + seq++, kind: 'gold', tx, ty, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, hp: 3, dead: false });
      goldPts.push({ x: tx, y: ty }); placed++;
    }
  }
  // agricultural trees are farmable for WOOD (replace the decorative tree with a node)
  for (const isl of G.world.islands) {
    if (isl.biome !== 'agri') continue;
    isl.features = isl.features.filter(f => {
      if (f.t !== 'tree' && f.t !== 'bigtree') return true;
      const big = f.t === 'bigtree';
      G.nodes.push({ id: 'n' + seq++, kind: big ? 'bigwood' : 'wood', res: 'wood', yield: big ? 2 : 1, tx: isl.x + f.tx, ty: isl.y + f.ty, x: (isl.x + f.tx + 0.5) * TILE, y: (isl.y + f.ty + 0.6) * TILE, hp: big ? 6 : 4, dead: false });
      return false;
    });
  }
}

// ── camera ──────────────────────────────────────────────────
function updateCamera() {
  if (!G.me) return;
  if (intro) {                                   // spawn-in: ease the camera down from the sky onto the player
    const p = Math.min(1, (performance.now() - intro.t0) / intro.dur);
    const e = 1 - Math.pow(1 - p, 3);            // easeOutCubic
    zoom = intro.from + (intro.target - intro.from) * e;
    G.camera.x = G.me.x - VW / zoom / 2;
    G.camera.y = G.me.y - VH / zoom / 2;
    if (p >= 1) { intro = null; zoom = 1; }
    return;
  }
  if (camMode === 'follow') {
    G.camera.x = G.me.x - VW / zoom / 2;
    G.camera.y = G.me.y - VH / zoom / 2;
  }
}
const w2sx = wx => (wx - G.camera.x) * zoom;
const w2sy = wy => (wy - G.camera.y) * zoom;

// ── movement ────────────────────────────────────────────────
let lastSend = 0;
function updateMovement(dt) {
  if (!G.me || G.hp <= 0 || intro) return;       // locked during the spawn-in animation
  const inAir = !isOnIsland(Math.floor(G.me.x / TILE), Math.floor(G.me.y / TILE));
  let sp = (inAir
    ? 3.2 + G.army.Pilot * 0.35 + shipTier() * 0.5
    : 2.3) / 1.3 * speedFactor();   // reduced base speed (×1.3 slower) × agility
  let dx = 0, dy = 0;
  // optional keyboard movement (still supported) — cancels click target
  if (keys['w'] || keys['arrowup']) dy -= 1;
  if (keys['s'] || keys['arrowdown']) dy += 1;
  if (keys['a'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;
  if (dx || dy) { moveTarget = attackTarget = farmTarget = null; moveQueue = []; camMode = 'follow'; }

  // resolve attack / farm targets into a move destination
  let dest = moveTarget;
  if (attackTarget) {
    const c = G.creatures.get(attackTarget);
    if (!c || c.dead) { attackTarget = null; }
    else {
      const d = Math.hypot(c.x - G.me.x, c.y - G.me.y);
      if (d > 56) dest = { x: c.x, y: c.y };
      else { dest = null; G.me.moving = false; hitCreature(c); }
    }
  } else if (farmTarget) {
    if (farmTarget.dead) { farmTarget = null; }
    else {
      const d = Math.hypot(farmTarget.x - G.me.x, farmTarget.y - G.me.y);
      if (d > 30) dest = { x: farmTarget.x, y: farmTarget.y };
      else { dest = null; G.me.moving = false; harvest(farmTarget); }
    }
  }

  if (dx || dy) {
    const l = Math.hypot(dx, dy);
    moveStep(dx / l * sp, dy / l * sp); G.me.moving = true;
  } else if (dest) {
    const ddx = dest.x - G.me.x, ddy = dest.y - G.me.y, l = Math.hypot(ddx, ddy);
    const arriveR = (dest === moveTarget && moveQueue.length) ? 7 : 3;   // looser radius for intermediate waypoints
    if (l < arriveR) {
      if (dest === moveTarget && moveQueue.length) { moveTarget = moveQueue.shift(); G.me.moving = true; }
      else { moveTarget = null; G.me.moving = false; }
    } else { moveStep(ddx / l * sp, ddy / l * sp); G.me.moving = true; }
  } else if (!attackTarget && !farmTarget) {
    G.me.moving = false;
  }
  G.me.inAir = inAir;
  // healer regen
  if (G.army.Healer && G.hp < G.maxHp) { G.hp = Math.min(G.maxHp, G.hp + G.army.Healer * 0.02); refreshHUD(); }

  const now = performance.now();
  if (now - lastSend > 60) {
    lastSend = now;
    send({ type: 'move', x: Math.round(G.me.x), y: Math.round(G.me.y), dir: G.me.dir, moving: G.me.moving });
  }
}
function shipTier() { return { scout: 0, cruiser: 1, frigate: 2, dread: 3 }[G.ship] || 0; }
let lockToastT = 0;
function lockedAt(px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  return G.world.islands.some(i => (i.locked || (i.type === 'arena' && !G.me.inArena)) && tx >= i.x - 1 && tx < i.x + i.w + 1 && ty >= i.y - 1 && ty < i.y + i.h + 1);
}
function arenaRect() { const a = G.world.islands.find(i => i.type === 'arena'); if (!a) return null; return { cx: (a.x + a.w / 2) * TILE, cy: (a.y + a.h / 2) * TILE, hw: (a.w * TILE) / 2 * 0.7, hh: (a.h * TILE) / 2 * 0.7 }; }
function moveStep(dx, dy) {
  let nx = G.me.x + dx, ny = G.me.y + dy, blocked = false;
  if (lockedAt(nx, ny)) {
    blocked = true;
    if (!lockedAt(nx, G.me.y)) ny = G.me.y;            // slide along the barrier
    else if (!lockedAt(G.me.x, ny)) nx = G.me.x;
    else { nx = G.me.x; ny = G.me.y; }
  }
  if (G.me.inArena) { const e = arenaRect(); if (e) { nx = Math.max(e.cx - e.hw, Math.min(e.cx + e.hw, nx)); ny = Math.max(e.cy - e.hh, Math.min(e.cy + e.hh, ny)); } }  // locked inside the rectangular arena floor
  if (blocked && performance.now() - lockToastT > 2500) { lockToastT = performance.now(); toast('🔒 This zone is locked. The Arena is reachable only through The Guardian.', 3000); moveTarget = null; }
  G.me.x = Math.max(0, Math.min(G.world.gridW * TILE, nx));
  G.me.y = Math.max(0, Math.min(G.world.gridH * TILE, ny));
  G.me.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
}

function buildNpcs() {
  G.npcs = []; G.furnaces = [];
  for (const isl of G.world.islands) for (const f of (isl.features || [])) {
    if (f.t === 'npc') G.npcs.push({ name: f.name, role: f.role, x: (isl.x + f.tx + 0.5) * TILE, y: (isl.y + f.ty + 0.6) * TILE });
    else if (f.t === 'furnace') G.furnaces.push({ x: (isl.x + f.tx + 0.5) * TILE, y: (isl.y + f.ty + 0.6) * TILE });
  }
}

// ── click-to-command: move, attack, or farm ─────────────────
function clickToCommand() {
  if (!G.me || G.hp <= 0 || intro) return;       // ignore input during the spawn-in animation
  camMode = 'follow';
  // NPC under cursor → talk (open its building) if close, else walk over
  const npc = (G.npcs || []).find(n => Math.hypot(n.x - mouse.wx, n.y - mouse.wy) < 16);
  if (npc) {
    if (Math.hypot(npc.x - G.me.x, npc.y - G.me.y) < TILE * 3) openPanel(npc.role);
    else { setMoveTo(npc.x, npc.y); markers.push({ x: npc.x, y: npc.y, life: 1 }); toast('Walk closer to talk to ' + npc.name); }
    return;
  }
  // furnace under cursor → open it (no NPC) if close, else walk over
  const fur = (G.furnaces || []).find(f => Math.abs(f.x - mouse.wx) < 30 && mouse.wy < f.y + 14 && mouse.wy > f.y - 70);
  if (fur) {
    if (Math.hypot(fur.x - G.me.x, fur.y - G.me.y) < TILE * 3) openPanel('furnace');
    else { setMoveTo(fur.x, fur.y); markers.push({ x: fur.x, y: fur.y, life: 1 }); toast('Walk closer to the Furnace.'); }
    return;
  }
  // Arena PvP: during a battle, clicking another fighter attacks them
  if (G.me.inArena && G.arena?.phase === 'battle') {
    let tp = null, bd = 22; for (const p of G.players.values()) { if (!p.inArena) continue; const d = Math.hypot(p.x - mouse.wx, p.y - mouse.wy); if (d < bd) { bd = d; tp = p; } }
    if (tp) { if (Math.hypot(tp.x - G.me.x, tp.y - G.me.y) < 70) { const dmg = Math.round((10 + G.level * 2 + strBonus()) * weaponMul()); send({ type: 'attackPlayer', tid: tp.id, dmg }); sfx('hit'); startSwing(tp.x, tp.y); spawnFloater('-' + dmg, tp.x, tp.y - 12, '#ffd34d'); } else { moveTarget = { x: tp.x, y: tp.y }; } return; }
  }
  // creature under cursor → attack it (walk there first)
  let c = pickCreature(mouse.wx, mouse.wy);
  if (c) { attackTarget = c.id; moveTarget = farmTarget = null; moveQueue = []; return; }
  // node under cursor → farm it (walk there first)
  let n = pickNode(mouse.wx, mouse.wy);
  if (n) { farmTarget = n; moveTarget = attackTarget = null; moveQueue = []; return; }
  // otherwise walk to the clicked point + flash a blue marker (routed around the arena)
  setMoveTo(mouse.wx, mouse.wy);
  markers.push({ x: mouse.wx, y: mouse.wy, life: 1 });
}
function pickCreature(wx, wy) {
  let best = null, bd = 22;
  for (const c of G.creatures.values()) { if (c.dead) continue; const d = Math.hypot(c.x - wx, c.y - wy); if (d < bd) { bd = d; best = c; } }
  return best;
}
function pickNode(wx, wy) {
  let best = null, bd = 20;
  for (const n of G.nodes) { if (n.dead) continue; const d = Math.hypot(n.x - wx, n.y - wy); if (d < bd) { bd = d; best = n; } }
  return best;
}

// ── farming ─────────────────────────────────────────────────
function harvest(n) {
  if (n.dead || G.hp <= 0) return;
  if (performance.now() - (n._t || 0) < 420) return; // swing cadence
  if (invCount() >= G.invMax) { if (performance.now() - (n._t || 0) > 1500) toast('Inventory full (300). Sell or bank items.'); n._t = performance.now(); return; }
  n._t = performance.now(); n.hp--;
  const res = n.res || n.kind, amt = n.yield || 1;
  const tool = res === 'wood' ? 'axe' : (res === 'iron' || res === 'gold') ? 'pickaxe' : 'sword';
  G.inv[res] = (G.inv[res] || 0) + amt; addXP(3); sfx('hit'); startSwing(n.x, n.y, tool);
  spawnFloater('+' + amt + ' ' + res, n.x, n.y, '#fff');
  if (n.hp <= 0) { n.dead = true; n.respawn = performance.now() + 20000; addXP(4); farmTarget = null; }
  refreshHUD(); refreshActivePanel();
}
function invCount() { const i = G.inv; return i.iron + i.meat + i.wood + i.plank + i.ingot + i.sword + (i.gold || 0) + (i.goldingot || 0) + (i.goldsword || 0) + (i.cookedmeat || 0) + (i.gear || []).length + (i.items || []).reduce((a, b) => a + (b.qty || 0), 0); }
// creature equipment drops
const SLOT_NAMES = { top: 'Top', bottom: 'Bottom', shoes: 'Boots', shield: 'Shield' };   // equipment drops are rolled server-side
let gearSeq = 1;
function tryFarm() { // Space key: harvest nearest node in range
  if (!G.me) return;
  const n = pickNode(G.me.x, G.me.y) || G.nodes.find(nn => !nn.dead && Math.hypot(nn.x - G.me.x, nn.y - G.me.y) < 34);
  if (n && Math.hypot(n.x - G.me.x, n.y - G.me.y) < 34) harvest(n);
}

// ── combat ──────────────────────────────────────────────────
function hitCreature(c) {
  if (performance.now() - lastAttack < 480) return;
  lastAttack = performance.now();
  G.me.dir = c.x < G.me.x ? 'left' : 'right';
  const dmg = Math.round((8 + G.level * 2 + strBonus() + G.army.Fighter * 4 + G.army.Mage * 3) * weaponMul());
  send({ type: 'attackCreature', cid: c.id, dmg }); sfx('hit'); startSwing(c.x, c.y);
  spawnFloater('-' + dmg, c.x, c.y - 12, '#ffd34d');
}

// derived stats — allocated points + bonuses from equipped armour
const SLOT_OF_STAT = { health: 'bottom', strength: 'top', agility: 'shoes', resistance: 'shield' };
function gearBonus(slot) { const it = G.equip?.[slot]; return (it && typeof it === 'object') ? (it.bonus || 0) : 0; }
function effStat(name) { return (G.stats?.[name] || 0) + gearBonus(SLOT_OF_STAT[name]); }
function applyStats() { G.maxHp = 100 + (G.level - 1) * 5 + effStat('health'); if (G.hp > G.maxHp) G.hp = G.maxHp; }   // +5 HP per level + 1 per Health point
function strBonus() { return Math.floor(effStat('strength') / 2); }                                      // 2 Strength = +1 dmg
function speedFactor() { return (100 + Math.floor(effStat('agility') / 2)) / 100; }                      // 2 Agility = +1 move speed (base 100)
function weaponMul() { return G.equip?.weapon === 'goldsword' ? 2.8 : G.equip?.weapon === 'sword' ? 1.4 : 1; }   // swords −30% power (gold = 2× iron)
// compact view of equipped gear (creature src per slot + weapon kind) shown on the body & sent to others
function gearVis() { const e = G.equip || {}, g = {}; for (const s of ['top', 'bottom', 'shoes', 'shield']) g[s] = (e[s] && typeof e[s] === 'object') ? e[s].src : null; g.weapon = (typeof e.weapon === 'string') ? e.weapon : null; return g; }
function addXP(n) {
  if (G.level >= 50) { G.xp = 0; refreshHUD(); return; }              // level cap 50
  G.xp += n;
  while (G.xp >= G.xpNeed && G.level < 50) { G.xp -= G.xpNeed; G.level++; G.statPoints += 5; applyStats(); G.hp = G.maxHp; G.xpNeed = xpForLevel(G.level); sfx('level'); spawnFloater('LEVEL UP! +5 pts', G.me.x, G.me.y - 28, '#5fd16a'); }
  if (G.level >= 50) G.xp = 0;
  refreshHUD();
}

// ── floaters (damage / pickup text) + click markers ─────────
const floaters = [];
const markers = [];
const smoke = [];
let smokeT = 0;
let swing = 0, swingAng = 0;                 // sword swing animation
let swingTool = 'sword';
function startSwing(tx, ty, tool = 'sword') { swing = 16; swingAng = Math.atan2(ty - G.me.y, tx - G.me.x); swingTool = tool; }
function spawnFloater(text, x, y, color) { floaters.push({ text, x, y, color, life: 1 }); }
function spawnSmoke(x, y) {
  if (frameT - smokeT < 3) return; smokeT = frameT;
  smoke.push({ x: x - 8 + Math.random() * 16, y: y + 6 + Math.random() * 4, r: 2 + Math.random() * 2, life: 1 });
  if (smoke.length > 60) smoke.shift();
}
function updateSmoke() { for (let i = smoke.length - 1; i >= 0; i--) { const s = smoke[i]; s.life -= 0.03; s.r += 0.25; s.y += 0.15; if (s.life <= 0) smoke.splice(i, 1); } }

// ── build / buy modes ───────────────────────────────────────
let dragStart = null;
function startDrag() { const tx = Math.floor(mouse.wx / TILE), ty = Math.floor(mouse.wy / TILE); dragStart = { x: tx, y: ty }; G.selection = { x0: tx, y0: ty, x1: tx, y1: ty }; }
function endDrag() {
  if (!G.selection) return;
  if (mode === 'buy') confirmBuy();
  else if (mode === 'build') applyBrush();
  dragStart = null;
}
function updateSelection() {
  if (mode && dragStart && mouse.down) {
    const tx = Math.floor(mouse.wx / TILE), ty = Math.floor(mouse.wy / TILE);
    G.selection = { x0: Math.min(dragStart.x, tx), y0: Math.min(dragStart.y, ty), x1: Math.max(dragStart.x, tx), y1: Math.max(dragStart.y, ty) };
  }
}
function selectedTiles() {
  if (!G.selection) return [];
  const out = [];
  for (let y = G.selection.y0; y <= G.selection.y1; y++)
    for (let x = G.selection.x0; x <= G.selection.x1; x++) out.push({ x, y });
  return out;
}

function buyable(t) { return !islandAt(t.x, t.y) && isAir(t.x, t.y) && !(G.tiles[tileKey(t.x, t.y)]?.owner); }
function confirmBuy() {
  const tiles = selectedTiles().filter(buyable);
  G.selection = null;
  if (!tiles.length) { toast('Pick empty sky tiles away from the islands.'); return; }
  if (G.guest || !wallet.connected) { toast('Connect Phantom to buy territory.'); return; }
  const total = tiles.length * wallet.cfg.territoryPrice;
  // choose the floor texture FIRST, then pay (Pay button = the Phantom gesture)
  openBuyPanel(tiles, total);
}
// called by the Buy panel's Pay button (a user gesture → Phantom opens)
G.payForTerritory = async (tiles, texture) => {
  const total = tiles.length * wallet.cfg.territoryPrice;
  toast(`Approve ${total.toLocaleString()} $Lunaris in Phantom…`, 8000);
  let signature;
  try { signature = await payTreasury(total); }
  catch (e) { toast('Payment cancelled: ' + (e.message || e)); return; }
  toast('Verifying on-chain… (can take ~10s)', 9000);
  try {
    const res = await api('/api/buy-territory', { signature, wallet: wallet.pubkey, tiles, texture });
    if (res.ok) { toast(`Territory acquired! (${res.granted} tiles)`); refreshBalance(); openPanel(null); }
    else toast('Purchase failed: ' + res.error, 5000);
  } catch (e) { toast('Network error: ' + (e.message || e)); }
};

async function applyBrush() {
  const mine = selectedTiles().filter(t => G.tiles[tileKey(t.x, t.y)]?.owner === (wallet.pubkey || 'guest'));
  G.selection = null;
  if (!mine.length) { toast('You can only build on tiles you own.'); return; }
  const b = G.buildBrush;
  for (const t of mine) {
    const patch = {};
    if (b.type === 'texture') patch.texture = b.value;
    else if (b.type === 'decor') patch.decor = b.value;
    else if (b.type === 'fence') patch.fence = !G.tiles[tileKey(t.x, t.y)]?.fence;
    else if (b.type === 'mine') {
      const cost = b.value === 'stone' ? 30 : 50;
      const resKind = b.value === 'stone' ? 'stone' : 'iron';
      if (G.inv[resKind] < cost) { toast(`Need ${cost} ${resKind} to build that mine.`); continue; }
      G.inv[resKind] -= cost; patch.mine = b.value; refreshHUD();
    }
    if (G.guest) { Object.assign(G.tiles[tileKey(t.x, t.y)] ||= { owner: 'guest' }, patch); }
    else await api('/api/edit-tile', { wallet: wallet.pubkey, x: t.x, y: t.y, patch });
  }
  toast('Built!');
}

function enterBuyMode() { mode = 'buy'; openPanel(null); toast('Drag over empty sky tiles to buy. Esc to cancel.'); }
function enterBuildMode() { mode = 'build'; toast('Drag over your tiles to build. Esc to cancel.'); }
function exitModes() { mode = null; G.selection = null; camMode = 'follow'; document.querySelectorAll('.tool').forEach(t => t.classList.remove('active')); }

// ── mine passive production ─────────────────────────────────
setInterval(() => {
  let gained = false;
  for (const k in G.tiles) { const t = G.tiles[k]; if (t.mine && t.owner === (wallet.pubkey || 'guest')) { G.inv[t.mine] += 1; gained = true; } }
  if (gained) { refreshHUD(); refreshActivePanel(); }
}, 5000);

// ── workshop crafting (queue + cooldown, one item at a time) ─
G.craft = null; G.craftQ = [];
function startNextCraft() { if (!G.craftQ.length) { G.craft = null; return; } const r = G.craftQ.shift(); G.craft = { output: r.output, ms: r.ms, endAt: performance.now() + r.ms }; }
setInterval(() => {
  if (G.craft && performance.now() >= G.craft.endAt) {
    const out = G.craft.output;
    const capped = out === 'cookedmeat' && (G.inv.cookedmeat || 0) >= 5;   // cooked steak max 5
    if (!capped && invCount() < G.invMax) { G.inv[out] = (G.inv[out] || 0) + 1; if (G.me) spawnFloater('+1 ' + out, G.me.x, G.me.y - 30, '#cfe2ff'); refreshHUD(); refreshActivePanel(); }
    startNextCraft();
  }
}, 250);

// ── rendering ───────────────────────────────────────────────
let frameT = 0;
// smooth remote players & creatures toward their last server position (updates arrive at 10 Hz)
function interpolateEntities() {
  const k = 0.3;
  for (const p of G.players.values()) { if (p.id === G.me?.id || p.tx == null) continue; p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; }
  for (const c of G.creatures.values()) { if (c.tx == null || c.x == null) continue; c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k; }
}
function render() {
  frameT += 1;
  interpolateEntities();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // deep-space gradient
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, '#05060f'); g.addColorStop(.5, '#0b1030'); g.addColorStop(1, '#160b2e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  drawSpace();

  if (!G.world || !G.me) { requestAnimationFrame(render); return; }
  updateSelection();

  // one world transform → draw everything in world coordinates
  ctx.setTransform(zoom * DPR, 0, 0, zoom * DPR, -G.camera.x * zoom * DPR, -G.camera.y * zoom * DPR);
  const tt = frameT * 0.03;

  // viewport (world coords) for culling
  const vx0 = G.camera.x, vy0 = G.camera.y, vx1 = G.camera.x + VW / zoom, vy1 = G.camera.y + VH / zoom;

  // islands: cached terrain (huge perf win) + relief border + fog + features
  for (const isl of G.world.islands) {
    if ((isl.x + isl.w) * TILE < vx0 - 40 || isl.x * TILE > vx1 + 60 ||
        (isl.y + isl.h) * TILE < vy0 - 60 || isl.y * TILE > vy1 + 80) continue; // off-screen
    const bob = Math.sin(tt + islandPhase(isl)) * 1.6;
    ctx.save(); ctx.translate(0, bob);
    if (isl.type === 'arena') { drawArenaBase(isl); drawArena(isl, tt); ctx.restore(); continue; }  // gladiator arena (custom render)
    drawIslandFog(isl, tt);                                  // drifting smoke all around
    const cache = islandCache(isl), P = ISLAND_PAD;
    ctx.globalAlpha = isl.locked ? 0.4 : 1;
    ctx.drawImage(cache, isl.x * TILE - P, isl.y * TILE - P, isl.w * TILE + 2 * P, isl.h * TILE + 2 * P);
    ctx.globalAlpha = 1;
    if (isl.locked) { drawLockBadge(isl); ctx.restore(); continue; }   // colonisable planet → no live content
    // resource nodes that sit on this island
    for (const n of G.nodes) { if (n.tx >= isl.x && n.tx < isl.x + isl.w && n.ty >= isl.y && n.ty < isl.y + isl.h) drawNode(n); }
    // features
    for (const f of isl.features) {
      const fx = (isl.x + f.tx + 0.5) * TILE, fy = (isl.y + f.ty + 0.6) * TILE;
      if (f.t === 'fountain') { ctx.save(); ctx.translate(fx, fy); ctx.scale(2, 2); S.drawFountain(ctx, 0, 0, frameT * 0.05); ctx.restore(); }
      else if (f.t === 'npc') {
        S.drawOutlined(ctx, fx, fy, (c, ox, oy) => S.drawNpc(c, ox, oy, f.role, f.color, tt), { sz: 110, ax: 55, ay: 72, off: 2 });
        if (f.role === 'guardian') drawNameTag({ name: f.name, x: fx, y: fy + 44 }, '#ffe08a');   // name BELOW the guardian
        else drawNameTag({ name: f.name, x: fx, y: fy - 16 }, '#ffe08a');
        const say = npcSpeech(f); if (say) drawSpeechBubble(fx, fy - (f.role === 'guardian' ? 18 : 50), say);
      }
      else S.drawFeature(ctx, f, fx, fy, tt);
    }
    ctx.restore();
  }

  // owned sky tiles (off-island)
  for (const k in G.tiles) {
    const t = G.tiles[k]; if (!t.owner) continue;
    const [tx, ty] = k.split(',').map(Number);
    if (!isAir(tx, ty)) { drawTileExtras(tx, ty, t); continue; }
    S.drawCell(ctx, tx * TILE, ty * TILE, texChar(t.texture) || 'g', tx, ty, frameT * 0.06, 15);
    drawTileExtras(tx, ty, t);
  }

  // nodes off-island (rare) + ensure respawn ticking handled in drawNode
  for (const n of G.nodes) { if (!islandAt(n.tx, n.ty)) drawNode(n); }

  // built ships parked on island
  for (const s of G.builtShips) S.drawShip(ctx, s.x, s.y, s.kind, 'right', (frameT >> 3) % 2);

  // creatures (only those on screen)
  for (const c of G.creatures.values()) {
    if (c.dead || c.x == null) continue;
    if (c.x < vx0 - 40 || c.x > vx1 + 40 || c.y < vy0 - 60 || c.y > vy1 + 40) continue;   // off-screen → skip
    S.drawOutlined(ctx, c.x, c.y, (cc, ox, oy) => S.drawCreature(cc, ox, oy, c, frameT >> 3), { sz: 80, ax: 40, ay: 50, off: 2 });
    drawBar(c.x, c.y - 16, c.hp / c.maxHp, '#ff5a6e', 18);
  }

  // ship smoke trails (drawn under the craft)
  updateSmoke();
  for (const s of smoke) { ctx.globalAlpha = s.life * 0.5; ctx.fillStyle = '#cdd6e6'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;

  // players (only those on screen)
  for (const p of G.players.values()) {
    if (p.x == null || p.x < vx0 - 40 || p.x > vx1 + 40 || p.y < vy0 - 70 || p.y > vy1 + 40) continue;   // off-screen → skip
    if (p.inAir && p.moving) spawnSmoke(p.x, p.y);
    drawNameTag(p);
    S.drawPlayer(ctx, p.x, p.y, p.appearance, p.dir, p.moving ? (frameT >> 2) : 0, p.inAir, p.ship, p.gear);
  }
  if (G.me.inAir && G.me.moving) spawnSmoke(G.me.x, G.me.y);
  drawNameTag({ name: G.me.name || 'You', x: G.me.x, y: G.me.y, level: G.level });
  S.drawPlayer(ctx, G.me.x, G.me.y, G.appearance, G.me.dir, G.me.moving ? (frameT >> 2) : 0, G.me.inAir, G.ship, gearVis());
  drawLocator();   // NPC beacon + guide line
  // sword swing on farm / combat
  if (swing > 0 && !G.me.inAir) {
    const p = 1 - swing / 16, arc = (-1 + p * 2) * 1.25;
    const hx = G.me.x + Math.cos(swingAng) * 6, hy = G.me.y - 2 + Math.sin(swingAng) * 6;
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(swingAng + Math.PI / 2 + arc);
    ctx.globalAlpha = 0.25; ctx.strokeStyle = '#eaf2ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 22, -1.2, 1.2); ctx.stroke(); ctx.globalAlpha = 1; // slash arc
    if (swingTool === 'pickaxe') S.drawPickaxe(ctx, 0, 0, 0.95);
    else if (swingTool === 'axe') S.drawAxe(ctx, 0, 0, 0.95);
    else S.drawSword(ctx, 0, 0, 0.95);
    ctx.restore();
    swing--;
  }

  // click-to-move marker: a blue square that flashes for ~0.5s
  for (let i = markers.length - 1; i >= 0; i--) {
    const mk = markers[i]; mk.life -= 0.034;
    if (mk.life <= 0) { markers.splice(i, 1); continue; }
    ctx.globalAlpha = Math.max(0, mk.life) * 0.9;
    ctx.fillStyle = '#3da5ff'; ctx.fillRect(Math.floor(mk.x / TILE) * TILE, Math.floor(mk.y / TILE) * TILE, TILE, TILE);
    ctx.strokeStyle = '#bfe6ff'; ctx.lineWidth = 1; ctx.strokeRect(Math.floor(mk.x / TILE) * TILE + .5, Math.floor(mk.y / TILE) * TILE + .5, TILE - 1, TILE - 1);
    ctx.globalAlpha = 1;
  }

  // buy/build selection — blue tiles while dragging
  if (G.selection && mode) {
    const sel = G.selection;
    ctx.globalAlpha = 0.32; ctx.fillStyle = mode === 'buy' ? '#3da5ff' : '#5fd16a';
    ctx.fillRect(sel.x0 * TILE, sel.y0 * TILE, (sel.x1 - sel.x0 + 1) * TILE, (sel.y1 - sel.y0 + 1) * TILE);
    ctx.globalAlpha = 1;
    if (mode === 'buy') drawBuyHint();
  }

  // floaters
  ctx.font = '11px "Vanilla Caramel", sans-serif'; ctx.textAlign = 'center';
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i]; f.y -= 0.4; f.life -= 0.012;
    if (f.life <= 0) { floaters.splice(i, 1); continue; }
    ctx.globalAlpha = Math.max(0, f.life); ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawBanners();
  drawMinimap();
  drawIntro();
  requestAnimationFrame(render);
}
// green spatial smoke that clears as the camera settles onto the player
function drawIntro() {
  if (!intro) return;
  const p = Math.min(1, (performance.now() - intro.t0) / intro.dur), a = 1 - p;
  ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.08, VW / 2, VH / 2, VH * 0.85);
  g.addColorStop(0, 'rgba(40,120,70,0)'); g.addColorStop(1, `rgba(18,70,46,${0.65 * a})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  for (let i = 0; i < 16; i++) {
    const ang = i * 1.7 + p * 3.2, r = VH * (0.18 + 0.55 * p);
    const x = VW / 2 + Math.cos(ang) * r * 1.35, y = VH / 2 + Math.sin(ang) * r;
    ctx.fillStyle = `rgba(${90 + (i % 6) * 6}, 200, 130, ${0.16 * a})`;
    ctx.beginPath(); ctx.arc(x, y, 42 + (i % 5) * 18, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// helpers used by render
const _phases = {};
function islandPhase(isl) { return _phases[isl.id] ??= (isl.x * 0.7 + isl.y * 1.3) % 6.28; }
function landLocal(isl, lx, ly) { return ly >= 0 && ly < isl.h && lx >= 0 && lx < isl.w && isl.cells[ly][lx] !== '.'; }
function texChar(tex) { return tex ? ({ grass: 'g', sand: 's', rock: 'r', snow: 'n', wood: 'b', cloud: 'n', construction: 'd', dust: 'd' }[tex] || null) : null; }

// pre-render an island's whole terrain once → cheap drawImage per frame (fixes dezoom lag)
const ISLAND_PAD = 9;
function islandCache(isl) {
  if (isl._cache) return isl._cache;
  const SC = 2, P = ISLAND_PAD, W = isl.w * TILE + 2 * P, H = isl.h * TILE + 2 * P;
  const cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC;
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = true; c.scale(SC, SC); c.translate(P, P);
  for (let y = 0; y < isl.h; y++) { const row = isl.cells[y];
    for (let x = 0; x < isl.w; x++) { const ch = row[x]; if (ch === '.') continue;
      let nb = 0; if (landLocal(isl, x, y - 1)) nb |= 1; if (landLocal(isl, x + 1, y)) nb |= 2; if (landLocal(isl, x, y + 1)) nb |= 4; if (landLocal(isl, x - 1, y)) nb |= 8;
      S.drawCell(c, x * TILE, y * TILE, ch, isl.x + x, isl.y + y, 0, nb);
    } }
  // irregular relief rim hugging the silhouette (imperfect, varied per cell)
  const rim = isl.biome === 'hostile' ? '#241a36' : isl.biome === 'agri' ? '#39521f' : isl.biome === 'mining' ? '#474a54' : isl.locked ? '#3a3f4a' : '#403a30';
  for (let y = 0; y < isl.h; y++) for (let x = 0; x < isl.w; x++) {
    if (isl.cells[y][x] === '.') continue;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      if (landLocal(isl, x + dx, y + dy)) continue;
      const seed = ((isl.x + x) * 131 + (isl.y + y) * 977 + (dx + 2) * 7 + (dy + 2) * 13) >>> 0;
      const j = 2.5 + (seed % 5);
      const cxp = x * TILE + TILE / 2 + dx * TILE / 2, cyp = y * TILE + TILE / 2 + dy * TILE / 2;
      c.fillStyle = rim; c.beginPath(); c.ellipse(cxp + dx * j * 0.5, cyp + dy * j * 0.5, dx ? j : TILE * 0.58, dy ? j : TILE * 0.58, 0, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.ellipse(cxp, cyp, dx ? 1.2 : TILE * 0.5, dy ? 1.2 : TILE * 0.5, 0, 0, 7); c.fill();
    }
  }
  return isl._cache = cv;
}
function drawIslandFog(isl, t) {
  if (!isl._fog) {
    isl._fog = []; const n = Math.max(7, Math.round((isl.w + isl.h) / 3));
    for (let i = 0; i < n; i++) isl._fog.push({ a: (i / n) * 6.283, r: 6 + Math.random() * 7, ph: Math.random() * 6.28 });
    isl._fogC = { cx: (isl.x + isl.w / 2) * TILE, cy: (isl.y + isl.h / 2) * TILE, rx: isl.w * TILE / 2, ry: isl.h * TILE / 2 };
  }
  const { cx, cy, rx, ry } = isl._fogC;
  for (const f of isl._fog) {
    const wob = Math.sin(t * 1.4 + f.ph) * 5;
    const x = cx + Math.cos(f.a) * (rx + 7 + wob), y = cy + Math.sin(f.a) * (ry + 7 + wob);
    ctx.globalAlpha = Math.max(0, 0.1 + 0.07 * Math.sin(t * 1.4 + f.ph));
    ctx.fillStyle = '#aebfdd'; ctx.beginPath(); ctx.arc(x, y, f.r + Math.sin(t + f.ph) * 2, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawLockBadge(isl) {
  const cx = (isl.x + isl.w / 2) * TILE, cy = (isl.y + isl.h / 2) * TILE;
  ctx.fillStyle = 'rgba(8,10,18,.55)'; ctx.beginPath(); ctx.arc(cx, cy, 11, 0, 7); ctx.fill();
  ctx.fillStyle = '#cfd6e6'; ctx.fillRect(cx - 4, cy - 1, 8, 7); ctx.strokeStyle = '#cfd6e6'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy - 1, 3, Math.PI, 0); ctx.stroke();
}
function fmtTime(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
// rounded rectangle path (centre + half-extents)
function rrect(cx, cy, hw, hh, r) {
  const x0 = cx - hw, y0 = cy - hh, x1 = cx + hw, y1 = cy + hh; r = Math.min(r, hw, hh);
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0); ctx.lineTo(x1 - r, y0); ctx.quadraticCurveTo(x1, y0, x1, y0 + r);
  ctx.lineTo(x1, y1 - r); ctx.quadraticCurveTo(x1, y1, x1 - r, y1);
  ctx.lineTo(x0 + r, y1); ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
  ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
  ctx.closePath();
}
function drawArenaBase(isl) {
  const px = isl.x * TILE, py = isl.y * TILE, w = isl.w * TILE, h = isl.h * TILE, cx = px + w / 2, cy = py + h / 2, hw = w / 2, hh = h / 2, R = Math.min(hw, hh) * 0.14;
  ctx.fillStyle = 'rgba(8,12,22,.4)'; ctx.beginPath(); ctx.ellipse(cx, cy + hh * 0.5 + 10, hw * 1.06, hh * 0.55, 0, 0, 7); ctx.fill();  // cast shadow on the city
  rrect(cx, cy + 9, hw * 1.02, hh, R); ctx.fillStyle = '#39435e'; ctx.fill();                                                        // platform thickness (side wall)
  rrect(cx, cy + 14, hw * 0.98, hh * 0.95, R); ctx.fillStyle = '#2a3450'; ctx.fill();
  // grand stairs at the south
  ctx.fillStyle = '#7a8093'; for (let i = 0; i < 4; i++) ctx.fillRect(cx - 15 + i * 2, cy + hh + 2 + i * 4, 30 - 4 * i, 4);
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.8; for (let i = 0; i < 4; i++) ctx.strokeRect(cx - 15 + i * 2, cy + hh + 2 + i * 4, 30 - 4 * i, 4);
}
function drawArena(isl, t) {
  const px = isl.x * TILE, py = isl.y * TILE, w = isl.w * TILE, h = isl.h * TILE, cx = px + w / 2, cy = py + h / 2, hw = w / 2, hh = h / 2, R = Math.min(hw, hh) * 0.14;
  // outer cobblestone ground
  rrect(cx, cy, hw, hh, R); ctx.fillStyle = '#5e636e'; ctx.fill();
  rrect(cx, cy, hw * 0.97, hh * 0.97, R); ctx.fillStyle = '#6c7280'; ctx.fill();
  // wooden seating tiers (concentric rectangles)
  const woods = ['#7a5230', '#6b4828', '#86603a'];
  for (let k = 0; k < 3; k++) { const f = 0.92 - k * 0.085; rrect(cx, cy, hw * f, hh * f, R * 0.9); ctx.fillStyle = woods[k % 3]; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1; ctx.stroke(); }
  // seat dividers across the seating band
  ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 0.8;
  const inF = 0.66, outF = 0.9;
  for (let gx = -0.86; gx <= 0.86; gx += 0.17) { const X = cx + gx * hw; ctx.beginPath(); ctx.moveTo(X, cy - hh * outF); ctx.lineTo(X, cy - hh * inF); ctx.stroke(); ctx.beginPath(); ctx.moveTo(X, cy + hh * inF); ctx.lineTo(X, cy + hh * outF); ctx.stroke(); }
  for (let gy = -0.82; gy <= 0.82; gy += 0.2) { const Y = cy + gy * hh; ctx.beginPath(); ctx.moveTo(cx - hw * outF, Y); ctx.lineTo(cx - hw * inF, Y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx + hw * inF, Y); ctx.lineTo(cx + hw * outF, Y); ctx.stroke(); }
  // colourful awnings at the corners
  for (const [col, ax, ay] of [['#b6492f', -0.8, -0.78], ['#d9a23a', 0.8, -0.78], ['#d9a23a', -0.8, 0.78], ['#b6492f', 0.8, 0.78]]) {
    const X = cx + ax * hw, Y = cy + ay * hh; ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(X - 12, Y - 7); ctx.lineTo(X + 12, Y - 9); ctx.lineTo(X + 10, Y + 7); ctx.lineTo(X - 10, Y + 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(X + i * 4, Y - 8); ctx.lineTo(X + i * 4, Y + 6); ctx.stroke(); }
  }
  // inner stone barrier around the pit
  rrect(cx, cy, hw * 0.64, hh * 0.64, R * 0.7); ctx.fillStyle = '#aeb3bd'; ctx.fill(); ctx.strokeStyle = '#838893'; ctx.lineWidth = 2; ctx.stroke();
  // stone block segments on the barrier (top & bottom edges)
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; for (let gx = -0.58; gx <= 0.58; gx += 0.14) { const X = cx + gx * hw; ctx.beginPath(); ctx.moveTo(X, cy - hh * 0.64); ctx.lineTo(X, cy - hh * 0.6); ctx.stroke(); ctx.beginPath(); ctx.moveTo(X, cy + hh * 0.6); ctx.lineTo(X, cy + hh * 0.64); ctx.stroke(); }
  // sand pit
  rrect(cx, cy, hw * 0.58, hh * 0.58, R * 0.6); ctx.fillStyle = '#d8c29a'; ctx.fill();
  ctx.fillStyle = 'rgba(150,120,80,.18)'; for (let i = 0; i < 10; i++) { const a = i * 1.7, rr2 = (i % 3) / 3; ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * hw * 0.32 * rr2, cy + Math.sin(a) * hh * 0.32 * rr2, 6, 4, a, 0, 7); ctx.fill(); }
  // south entrance gate
  ctx.fillStyle = '#3a2e22'; ctx.fillRect(cx - 7, cy + hh * 0.58 - 2, 14, 6);
  // centre brazier
  ctx.fillStyle = '#3a3038'; ctx.beginPath(); ctx.arc(cx, cy + 2, 4, 0, 7); ctx.fill();
  ctx.fillStyle = '#ff8a3d'; ctx.beginPath(); ctx.arc(cx, cy - 1 + Math.sin(t * 4) * 1, 3, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffd08a'; ctx.beginPath(); ctx.arc(cx, cy - 2, 1.6, 0, 7); ctx.fill();
  // arena texts: header inside top, countdown inside bottom (symmetric)
  const a = G.arena || {}; ctx.textAlign = 'center';
  ctx.font = '22px "Vanilla Caramel", sans-serif'; ctx.fillStyle = '#3a2614'; ctx.fillText('⚔ ARENA', cx, cy - hh * 0.40);
  ctx.font = '18px "Vanilla Caramel", sans-serif'; ctx.fillStyle = '#1f8f4d'; ctx.fillText('1M $Lunaris for the Winner', cx, cy - hh * 0.40 + 20);
  ctx.font = '28px "Vanilla Caramel", sans-serif';
  if (a.phase === 'battle') { ctx.fillStyle = '#b02030'; ctx.fillText('BATTLE  ' + fmtTime(a.remaining || 0), cx, cy + hh * 0.44); }
  else { ctx.fillStyle = '#5a3a1a'; ctx.fillText('Next: ' + fmtTime(a.remaining || 0), cx, cy + hh * 0.44); if (a.winner) { ctx.font = '12px "Vanilla Caramel", sans-serif'; ctx.fillStyle = '#2f7a32'; ctx.fillText('🏆 ' + a.winner, cx, cy + hh * 0.44 - 18); } }
}
function drawNode(n) {
  if (n.dead) { if (performance.now() > n.respawn) { n.dead = false; n.hp = 3; } else return; }
  S.drawNode(ctx, n.x, n.y, n.kind, frameT * 0.05);
}

// ── Bridges (world space) — sci-fi steel deck w/ blue light ─
function drawBridges(t) {
  for (const b of (G.world.bridges || [])) {
    const xs = b.tiles.map(p => p[0]), ys = b.tiles.map(p => p[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const px = minx * TILE, py = miny * TILE, w = (maxx - minx + 1) * TILE, h = (maxy - miny + 1) * TILE;
    const horiz = w >= h;
    if (b.dir === 'd') { // locked: dim red diagonal deck + gate
      for (const [tx, ty] of b.tiles) { ctx.fillStyle = '#3a2e44'; ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE); ctx.fillStyle = 'rgba(255,90,110,.4)'; ctx.fillRect(tx * TILE, ty * TILE + 14, TILE, 3); }
      drawGate(b.gate[0], b.gate[1], t); continue;
    }
    // hanging support struts into the void
    ctx.fillStyle = 'rgba(16,22,40,.6)';
    if (horiz) { for (let x = px; x < px + w; x += TILE) { ctx.fillRect(x + 9, py + h, 5, 13); ctx.fillRect(x + TILE - 14, py + h, 5, 13); } }
    else { for (let y = py; y < py + h; y += TILE) { ctx.fillRect(px - 13, y + 9, 13, 5); ctx.fillRect(px + w, y + 9, 13, 5); } }
    drawScifiDeck(px, py, w, h, horiz, t, minx, miny);
  }
}
function drawScifiDeck(px, py, w, h, horiz, t, sx, sy) {
  const steelL = '#b6bdca', steel = '#8b94a4', steelD = '#5c6576', edge = '#363d4b';
  const blue = '#2aa8ff', blueB = '#bfe6ff';
  const glow = 0.6 + Math.sin(t * 3) * 0.3;
  if (horiz) {
    const g = ctx.createLinearGradient(0, py, 0, py + h);
    g.addColorStop(0, steelD); g.addColorStop(.18, steel); g.addColorStop(.5, steelL); g.addColorStop(.82, steel); g.addColorStop(1, steelD);
    ctx.fillStyle = g; ctx.fillRect(px, py, w, h);
    const spineT = py + h * 0.36, spineB = py + h * 0.64, rail = 4;
    // glowing ribs in the two side bands
    for (let x = px; x < px + w; x += 7) {
      ctx.globalAlpha = glow; ctx.fillStyle = blue;
      ctx.fillRect(x, py + rail, 3, spineT - (py + rail) - 1); ctx.fillRect(x, spineB + 1, 3, (py + h - rail) - spineB - 1);
      ctx.globalAlpha = 1; ctx.fillStyle = edge; ctx.fillRect(x + 3, py + rail, 4, spineT - (py + rail) - 1); ctx.fillRect(x + 3, spineB + 1, 4, (py + h - rail) - spineB - 1);
    }
    // raised centre spine
    ctx.fillStyle = steelL; ctx.fillRect(px, spineT, w, spineB - spineT);
    ctx.fillStyle = edge; ctx.fillRect(px, spineT, w, 1); ctx.fillRect(px, spineB - 1, w, 1);
    ctx.globalAlpha = glow; ctx.fillStyle = blueB; ctx.fillRect(px, (spineT + spineB) / 2 - 1, w, 2); ctx.globalAlpha = 1;
    for (let x = px + 6; x < px + w; x += 22) { ctx.fillStyle = steelD; ctx.fillRect(x, spineT + 2, 8, spineB - spineT - 4); ctx.globalAlpha = glow; ctx.fillStyle = blue; ctx.fillRect(x + 2, spineT + 3, 4, spineB - spineT - 6); ctx.globalAlpha = 1; }
    // edge rails + underglow
    ctx.fillStyle = steelD; ctx.fillRect(px, py, w, rail); ctx.fillRect(px, py + h - rail, w, rail);
    ctx.globalAlpha = glow; ctx.fillStyle = blue; ctx.fillRect(px, py + rail, w, 1); ctx.fillRect(px, py + h - rail - 1, w, 1); ctx.globalAlpha = 1;
    sparks(px, py, w, h, true, t, sx, sy);
    tornEdge(px, py, w, true, 1, (sx * 131 + sy * 977) >>> 0);
    tornEdge(px, py + h, w, true, -1, (sx * 977 + sy * 131 + 53) >>> 0);
  } else {
    const g = ctx.createLinearGradient(px, 0, px + w, 0);
    g.addColorStop(0, steelD); g.addColorStop(.18, steel); g.addColorStop(.5, steelL); g.addColorStop(.82, steel); g.addColorStop(1, steelD);
    ctx.fillStyle = g; ctx.fillRect(px, py, w, h);
    const spineL = px + w * 0.36, spineR = px + w * 0.64, rail = 4;
    for (let y = py; y < py + h; y += 7) {
      ctx.globalAlpha = glow; ctx.fillStyle = blue;
      ctx.fillRect(px + rail, y, spineL - (px + rail) - 1, 3); ctx.fillRect(spineR + 1, y, (px + w - rail) - spineR - 1, 3);
      ctx.globalAlpha = 1; ctx.fillStyle = edge; ctx.fillRect(px + rail, y + 3, spineL - (px + rail) - 1, 4); ctx.fillRect(spineR + 1, y + 3, (px + w - rail) - spineR - 1, 4);
    }
    ctx.fillStyle = steelL; ctx.fillRect(spineL, py, spineR - spineL, h);
    ctx.fillStyle = edge; ctx.fillRect(spineL, py, 1, h); ctx.fillRect(spineR - 1, py, 1, h);
    ctx.globalAlpha = glow; ctx.fillStyle = blueB; ctx.fillRect((spineL + spineR) / 2 - 1, py, 2, h); ctx.globalAlpha = 1;
    for (let y = py + 6; y < py + h; y += 22) { ctx.fillStyle = steelD; ctx.fillRect(spineL + 2, y, spineR - spineL - 4, 8); ctx.globalAlpha = glow; ctx.fillStyle = blue; ctx.fillRect(spineL + 3, y + 2, spineR - spineL - 6, 4); ctx.globalAlpha = 1; }
    ctx.fillStyle = steelD; ctx.fillRect(px, py, rail, h); ctx.fillRect(px + w - rail, py, rail, h);
    ctx.globalAlpha = glow; ctx.fillStyle = blue; ctx.fillRect(px + rail, py, 1, h); ctx.fillRect(px + w - rail - 1, py, 1, h); ctx.globalAlpha = 1;
    sparks(px, py, w, h, false, t, sx, sy);
    tornEdge(px, py, h, false, 1, (sx * 131 + sy * 977) >>> 0);
    tornEdge(px + w, py, h, false, -1, (sx * 977 + sy * 131 + 53) >>> 0);
  }
}
function srnd(seed) { let s = (seed >>> 0) || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
// rough, torn metal/concrete edge hugging a deck side (deterministic per seed)
function tornEdge(a, b, len, horiz, dir, seed) {
  const rnd = srnd(seed), grey = '#6c717b', greyD = '#3c4049', greyL = '#9197a2';
  ctx.fillStyle = grey; ctx.beginPath();
  if (horiz) {
    const outer = b - dir * 6; ctx.moveTo(a, outer); ctx.lineTo(a + len, outer);
    for (let x = a + len; x >= a; x -= 3 + rnd() * 3) ctx.lineTo(x, b + dir * (rnd() * 6 - 1));
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = greyL; ctx.fillRect(a, dir > 0 ? outer : outer + 5, len, 1);
    ctx.fillStyle = greyD; const r2 = srnd(seed ^ 7); for (let x = a; x < a + len; x += 6) if (r2() < 0.5) ctx.fillRect(x, b - dir * (1 + r2() * 3), 2, 2);
  } else {
    const outer = a - dir * 6; ctx.moveTo(outer, b); ctx.lineTo(outer, b + len);
    for (let y = b + len; y >= b; y -= 3 + rnd() * 3) ctx.lineTo(a + dir * (rnd() * 6 - 1), y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = greyL; ctx.fillRect(dir > 0 ? outer : outer + 5, b, 1, len);
    ctx.fillStyle = greyD; const r2 = srnd(seed ^ 7); for (let y = b; y < b + len; y += 6) if (r2() < 0.5) ctx.fillRect(a - dir * (1 + r2() * 3), y, 2, 2);
  }
  // a couple of exposed wires dangling from the broken edge
  const wr = srnd(seed ^ 31), cols = ['#c84040', '#3a78c9', '#d8b23a', '#cfd6e6'];
  for (let k = 0; k < 2; k++) {
    const p = 0.2 + wr() * 0.6, wx = horiz ? a + p * len : a + dir * 2, wy = horiz ? b + dir * 2 : b + p * len;
    const ex = horiz ? wx + (wr() * 8 - 4) : wx + dir * (5 + wr() * 7), ey = horiz ? wy + dir * (5 + wr() * 7) : wy + (wr() * 8 - 4);
    ctx.strokeStyle = cols[k % cols.length]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(wx, wy);
    ctx.quadraticCurveTo((wx + ex) / 2 + (wr() * 6 - 3), (wy + ey) / 2 + (wr() * 6 - 3), ex, ey); ctx.stroke();
    ctx.fillStyle = '#bfe6ff'; ctx.globalAlpha = 0.8; ctx.fillRect(ex - 1, ey - 1, 2, 2); ctx.globalAlpha = 1;
  }
}
function sparks(px, py, w, h, horiz, t, sx, sy) {
  // occasional electric arcs near the rails (animated, deterministic positions)
  const n = horiz ? Math.floor(w / TILE) : Math.floor(h / TILE);
  for (let i = 0; i < n; i += 3) {
    if (((t * 6 | 0) + i * 7 + sx + sy) % 23 !== 0) continue;
    const ax = horiz ? px + i * TILE + 8 : (Math.random() < 0.5 ? px + 2 : px + w - 4);
    const ay = horiz ? (Math.random() < 0.5 ? py + 2 : py + h - 6) : py + i * TILE + 8;
    ctx.strokeStyle = '#bfe6ff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(ax, ay);
    for (let s = 0; s < 4; s++) ctx.lineTo(ax + (Math.random() * 10 - 5), ay + (horiz ? -s * 3 : s * 3 - 6) + (Math.random() * 4 - 2));
    ctx.stroke(); ctx.globalAlpha = 1;
  }
}
function drawGate(tx, ty, t) {
  const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
  ctx.fillStyle = '#2a2030'; ctx.fillRect(x - 14, y - 18, 5, 36); ctx.fillRect(x + 9, y - 18, 5, 36);
  ctx.fillStyle = '#ff5a6e'; ctx.fillRect(x - 14, y - 20, 28, 4);
  const pulse = 0.25 + Math.abs(Math.sin(t * 2)) * 0.3;
  ctx.globalAlpha = pulse; ctx.fillStyle = '#ff5a6e'; ctx.fillRect(x - 9, y - 16, 18, 32); ctx.globalAlpha = 1;
  // lock icon
  ctx.fillStyle = '#ffd9de'; ctx.fillRect(x - 4, y - 3, 8, 7); ctx.strokeStyle = '#ffd9de'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y - 3, 3, Math.PI, 0); ctx.stroke();
}

// ── Zone banners (screen space) ─────────────────────────────
function drawBanners() {
  ctx.textAlign = 'left';
  for (const isl of G.world.islands) {
    if (!isl.name) continue;                                  // skip unnamed satellite islets
    const sx = w2sx((isl.x + isl.w / 2) * TILE), sy = w2sy(isl.y * TILE) - 14;
    if (sx < -40 || sx > VW + 40 || sy < -10 || sy > VH) continue;
    const title = (isl.name || '').toUpperCase() + (isl.locked ? '  🔒' : '');
    const sub = isl.resources || isl.sub || '';
    ctx.font = '14px "Vanilla Caramel", sans-serif';
    const tw = Math.max(ctx.measureText(title).width, sub ? measure8(sub) : 0) + 22;
    const bx = Math.round(sx - tw / 2), by = Math.round(sy - 26), bh = sub ? 34 : 22;
    ctx.fillStyle = 'rgba(10,14,26,.82)'; roundRect(bx, by, tw, bh, 5); ctx.fill();
    ctx.fillStyle = isl.color || '#48b6ff'; ctx.fillRect(bx, by + 4, 4, bh - 8);
    ctx.fillStyle = '#fff'; ctx.font = '14px "Vanilla Caramel", sans-serif'; ctx.fillText(title, bx + 12, by + 14);
    if (sub) { ctx.fillStyle = '#9fb0d8'; ctx.font = '10px "Vanilla Caramel", sans-serif'; ctx.fillText(sub, bx + 12, by + 27); }
  }
}
function measure8(s) { ctx.font = '10px "Vanilla Caramel", sans-serif'; return ctx.measureText(s).width; }
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ── Minimap (screen-space, top-right) — continent view ──────
const mm = { x: 0, y: 0, w: 180, h: 180, s: 1, ox: 0, oy: 0, content: null };
const MM_BIOME = { main: '#6f8fd0', mining: '#8a7b66', agri: '#4e8a44', hostile: '#4a2d6a', build: '#b39a6a', explore: '#8f7c58' };
function mmContent() {
  if (mm.content) return mm.content;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const i of G.world.islands) { x0 = Math.min(x0, i.x); y0 = Math.min(y0, i.y); x1 = Math.max(x1, i.x + i.w); y1 = Math.max(y1, i.y + i.h); }
  for (const b of (G.world.bridges || [])) for (const [x, y] of b.tiles) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  return (mm.content = { x0: (x0 - 2) * TILE, y0: (y0 - 2) * TILE, w: (x1 - x0 + 4) * TILE, h: (y1 - y0 + 4) * TILE });
}
function mmLayout() {
  mm.w = mm.h = Math.min(200, Math.max(140, VW * 0.18));
  mm.x = VW - mm.w - 14; mm.y = 72;
  const c = mmContent();
  mm.s = Math.min(mm.w / c.w, mm.h / c.h) * 0.94;
  mm.ox = mm.x + (mm.w - c.w * mm.s) / 2 - c.x0 * mm.s;
  mm.oy = mm.y + (mm.h - c.h * mm.s) / 2 - c.y0 * mm.s;
}
const mwx = v => mm.ox + v * mm.s, mwy = v => mm.oy + v * mm.s;
function drawMinimap() {
  if (!G.world || !G.me) return;
  mmLayout();
  const cp = Math.max(1, Math.ceil(TILE * mm.s));
  // frame + space background
  ctx.fillStyle = '#070b16'; ctx.fillRect(mm.x - 3, mm.y - 3, mm.w + 6, mm.h + 6);
  ctx.strokeStyle = '#38456e'; ctx.lineWidth = 2; ctx.strokeRect(mm.x - 2, mm.y - 2, mm.w + 4, mm.h + 4);
  ctx.save(); ctx.beginPath(); ctx.rect(mm.x, mm.y, mm.w, mm.h); ctx.clip();
  ctx.fillStyle = '#0a1124'; ctx.fillRect(mm.x, mm.y, mm.w, mm.h);

  // hub glow
  const hub = G.world.islands.find(i => i.type === 'main');
  if (hub) { const hx = mwx((hub.x + hub.w / 2) * TILE), hy = mwy((hub.y + hub.h / 2) * TILE);
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, mm.w * 0.32); g.addColorStop(0, 'rgba(90,150,255,.35)'); g.addColorStop(1, 'rgba(90,150,255,0)'); ctx.fillStyle = g; ctx.fillRect(mm.x, mm.y, mm.w, mm.h); }

  // bridges (under islands)
  for (const b of (G.world.bridges || [])) { ctx.fillStyle = b.locked ? '#7a3340' : '#3a5f88'; for (const [x, y] of b.tiles) ctx.fillRect(mwx(x * TILE), mwy(y * TILE), cp, cp); }

  // land cells, tinted by zone
  for (const isl of G.world.islands) {
    const base = MM_BIOME[isl.biome] || MM_BIOME[isl.type] || '#7d7d7d';
    ctx.globalAlpha = isl.locked ? 0.55 : 1;
    for (let ly = 0; ly < isl.h; ly++) { const row = isl.cells[ly];
      for (let lx = 0; lx < isl.w; lx++) { const ch = row[lx]; if (ch === '.') continue;
        ctx.fillStyle = ch === 'w' ? '#27598f' : ch === 'p' || ch === 'm' ? lighten(base) : base;
        ctx.fillRect(mwx((isl.x + lx) * TILE), mwy((isl.y + ly) * TILE), cp, cp);
      } }
    ctx.globalAlpha = 1;
  }
  // dashed zone outlines in zone colour
  for (const isl of G.world.islands) {
    ctx.fillStyle = isl.color || '#fff';
    for (let ly = 0; ly < isl.h; ly++) for (let lx = 0; lx < isl.w; lx++) {
      if (isl.cells[ly][lx] === '.') continue;
      const edge = isl.cells[ly - 1]?.[lx] === '.' || isl.cells[ly + 1]?.[lx] === '.' || isl.cells[ly][lx + 1] === '.' || isl.cells[ly][lx - 1] === '.' || lx === 0 || ly === 0 || lx === isl.w - 1 || ly === isl.h - 1;
      if (edge && ((lx + ly) & 1) === 0) ctx.fillRect(mwx((isl.x + lx) * TILE) - 0.5, mwy((isl.y + ly) * TILE) - 0.5, cp + 1, cp + 1);
    }
  }
  // owned tiles
  ctx.fillStyle = '#ffcf4d';
  for (const k in G.tiles) { if (!G.tiles[k].owner) continue; const [tx, ty] = k.split(',').map(Number); ctx.fillRect(mwx(tx * TILE), mwy(ty * TILE), cp, cp); }
  // creatures, players, me
  ctx.fillStyle = '#ff5a6e'; for (const c of G.creatures.values()) if (!c.dead) ctx.fillRect(mwx(c.x) - 1, mwy(c.y) - 1, 2, 2);
  ctx.fillStyle = '#cfe2ff'; for (const p of G.players.values()) ctx.fillRect(mwx(p.x) - 1, mwy(p.y) - 1, 2, 2);
  const pulse = 1 + Math.sin(frameT * 0.15) * 0.4;
  ctx.fillStyle = '#fff'; ctx.fillRect(mwx(G.me.x) - pulse, mwy(G.me.y) - pulse, pulse * 2, pulse * 2);
  ctx.strokeStyle = '#48b6ff'; ctx.lineWidth = 1; ctx.strokeRect(mwx(G.me.x) - 3, mwy(G.me.y) - 3, 6, 6);
  // viewport rectangle
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1;
  ctx.strokeRect(mwx(G.camera.x), mwy(G.camera.y), (VW / zoom) * mm.s, (VH / zoom) * mm.s);
  ctx.restore();
  // label
  ctx.fillStyle = '#9fb0d8'; ctx.font = '10px "Vanilla Caramel", sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('MAP · click to look', mm.x, mm.y - 6);
}
function lighten(hex) {
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) + 30, g = ((n >> 8) & 255) + 30, b = (n & 255) + 30;
  r = Math.min(255, r); g = Math.min(255, g); b = Math.min(255, b);
  return `rgb(${r},${g},${b})`;
}
function handleMinimapClick(sx, sy) {
  if (!G.world) return false;
  if (sx < mm.x || sx > mm.x + mm.w || sy < mm.y || sy > mm.y + mm.h) return false;
  const wxw = (sx - mm.ox) / mm.s, wyw = (sy - mm.oy) / mm.s;
  G.camera.x = wxw - VW / zoom / 2; G.camera.y = wyw - VH / zoom / 2;
  camMode = 'free';
  toast('Looking at region · click the world to send your pilot there');
  return true;
}

function drawTileExtras(tx, ty, t) {
  const x = tx * TILE, y = ty * TILE;
  if (t.fence) { ctx.fillStyle = '#9c6b3f'; ctx.fillRect(x + 1, y + 1, TILE - 2, 3); ctx.fillRect(x + 1, y + 1, 3, TILE - 2); }
  if (t.decor === 'flower') { ctx.fillStyle = '#ff6ea8'; ctx.fillRect(x + 13, y + 12, 5, 5); ctx.fillStyle = '#5fd16a'; ctx.fillRect(x + 15, y + 17, 2, 5); }
  else if (t.decor === 'lamp') { ctx.fillStyle = '#333'; ctx.fillRect(x + 14, y + 8, 3, 14); ctx.fillStyle = '#ffe08a'; ctx.fillRect(x + 12, y + 5, 7, 5); }
  else if (t.decor === 'tree') { ctx.fillStyle = '#6b4f37'; ctx.fillRect(x + 14, y + 14, 4, 10); ctx.fillStyle = '#4f9a41'; ctx.fillRect(x + 9, y + 4, 14, 12); }
  if (t.mine) { ctx.fillStyle = t.mine === 'stone' ? '#8d93a3' : '#cfd6e6'; ctx.fillRect(x + 6, y + 8, 20, 16); ctx.fillStyle = '#0008'; ctx.fillRect(x + 12, y + 14, 8, 10); }
}

function drawBar(x, y, frac, color, w = 18) {
  ctx.fillStyle = '#000a'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
  ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * Math.max(0, frac), 3);
}
function drawNameTag(p, color) {
  ctx.font = '10px "Vanilla Caramel", sans-serif';
  const lvl = (p.level != null) ? ('Lv' + p.level + ' ') : '';
  const name = p.name || '';
  ctx.textAlign = 'left';
  const wL = ctx.measureText(lvl).width, wN = ctx.measureText(name).width;
  const sx = p.x - (wL + wN) / 2, y = p.y - 24;
  ctx.fillStyle = '#0009'; ctx.fillText(lvl + name, sx + 1, y + 1);                 // shadow
  if (lvl) { ctx.fillStyle = '#ffcf4d'; ctx.fillText(lvl, sx, y); }                 // level in gold
  ctx.fillStyle = color || '#cfe2ff'; ctx.fillText(name, sx + wL, y);              // name
  ctx.textAlign = 'center';
}
// ── NPC automatic speech (every 20s, visible for 10s) ──
const NPC_LINES = {
  bank: ['Deposit your loot before the Arena!', 'Your $Lunaris is safe with me.'],
  alchemist: ['Potions brewing — mind the fumes!', 'Need a strength elixir?'],
  marketplace: ['Buy low, sell high, pilot!', 'Fresh goods from the void!'],
  guardian: ['None pass without tribute.', 'The Arena awaits the brave.'],
  lumberjack: ['Timber! Bring me your logs.', 'Five wood makes a plank.'],
  miner: ['The ore runs deep here.', 'Five iron makes an ingot.'],
  builder: ['I forge the finest blades.', 'Bring ingots & planks for a sword.'],
  colonise: ['New worlds await us, pilot!', 'Soon we colonise the stars.'],
};
function npcHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function npcSpeech(f) {
  const lines = NPC_LINES[f.role]; if (!lines) return null;
  const tsec = performance.now() / 1000 + (npcHash(f.name) % 40);
  if (tsec % 40 >= 5) return null;                        // talk 5s every 40s
  return lines[Math.floor(tsec / 40) % lines.length];
}
function drawSpeechBubble(cx, by, text) {
  ctx.font = '9px "Vanilla Caramel", sans-serif'; ctx.textAlign = 'left';
  const w = ctx.measureText(text).width + 12, h = 15, x0 = cx - w / 2, y0 = by - h;
  ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 5); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx - 3, by - 1); ctx.lineTo(cx + 3, by - 1); ctx.lineTo(cx, by + 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1a2a'; ctx.fillText(text, x0 + 6, y0 + 10); ctx.textAlign = 'center';
}
// ── beacon: blinking marker + guide line toward an NPC the player asked to find ──
function drawLocator() {
  if (!G.locate || !G.me) return;
  const lx = G.locate.x, ly = G.locate.y;
  if (Math.hypot(lx - G.me.x, ly - G.me.y) < TILE * 2.5) { G.locate = null; return; }
  ctx.save();
  ctx.strokeStyle = 'rgba(255,207,77,.5)'; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
  ctx.beginPath(); ctx.moveTo(G.me.x, G.me.y); ctx.lineTo(lx, ly); ctx.stroke(); ctx.setLineDash([]);
  const a = 0.45 + 0.45 * Math.sin(performance.now() / 200);
  ctx.fillStyle = `rgba(255,207,77,${a})`; ctx.beginPath(); ctx.arc(lx, ly - 30, 6, 0, 7); ctx.fill();
  ctx.strokeStyle = `rgba(255,207,77,${a})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(lx, ly - 30, 11, 0, 7); ctx.stroke();
  ctx.restore();
}
function drawBuyHint() {
  const n = selectedTiles().filter(t => isAir(t.x, t.y)).length;
  const el = document.getElementById('toast');
  el.classList.remove('hidden');
  el.textContent = `${n} tile(s) · ${(n * (wallet.cfg?.territoryPrice || 10000)).toLocaleString()} $Lunaris — release to buy`;
}

// twinkling starfield + drifting nebula backdrop
let stars = [], nebula = [], starsW = 0, starsH = 0;
function initStars() {
  starsW = VW; starsH = VH; stars = []; nebula = [];
  const n = Math.round((VW * VH) / 4500);
  for (let i = 0; i < n; i++) stars.push({
    x: Math.random() * VW, y: Math.random() * VH,
    z: 0.3 + Math.random() * 0.9,               // size / brightness
    p: Math.random() * 6.28,                     // twinkle phase
    c: Math.random() < 0.15 ? '#bcd0ff' : (Math.random() < 0.12 ? '#ffd9c0' : '#ffffff'),
  });
  for (let i = 0; i < 4; i++) nebula.push({
    x: Math.random() * VW, y: Math.random() * VH, r: 140 + Math.random() * 220,
    c: ['rgba(90,60,180,', 'rgba(40,90,190,', 'rgba(150,60,140,', 'rgba(40,120,160,'][i % 4],
    s: 0.02 + Math.random() * 0.03,
  });
}
function drawSpace() {
  if (stars.length === 0 || starsW !== VW || starsH !== VH) initStars();
  // soft nebula clouds
  for (const nb of nebula) {
    nb.x += nb.s; if (nb.x - nb.r > VW) nb.x = -nb.r;
    const g = ctx.createRadialGradient(nb.x, nb.y, 0, nb.x, nb.y, nb.r);
    g.addColorStop(0, nb.c + '0.10)'); g.addColorStop(1, nb.c + '0)');
    ctx.fillStyle = g; ctx.fillRect(nb.x - nb.r, nb.y - nb.r, nb.r * 2, nb.r * 2);
  }
  // stars (slow drift + twinkle)
  const t = frameT * 0.05;
  for (const s of stars) {
    s.x -= s.z * 0.06; if (s.x < 0) s.x = VW;
    const tw = 0.55 + 0.45 * Math.sin(t + s.p);
    const sz = Math.max(1, s.z * 2);
    ctx.globalAlpha = tw; ctx.fillStyle = s.c;
    ctx.fillRect(s.x, s.y, sz, sz);
    if (s.z > 0.9 && tw > 0.85) { ctx.fillRect(s.x - 1, s.y, 1, sz); ctx.fillRect(s.x + sz, s.y, 1, sz); ctx.fillRect(s.x, s.y - 1, sz, 1); ctx.fillRect(s.x, s.y + sz, sz, 1); }
  }
  ctx.globalAlpha = 1;
}

// ── HUD ─────────────────────────────────────────────────────
function refreshHUD() {
  document.getElementById('statName').textContent = G.me?.name || 'Pilot';
  document.getElementById('statLevel').textContent = 'Lv ' + G.level;
  const hpf = document.getElementById('hpFill'); hpf.style.width = (G.hp / G.maxHp * 100) + '%';
  document.getElementById('hpText').textContent = Math.ceil(G.hp) + '/' + G.maxHp;
  const xpf = document.getElementById('xpFill'); xpf.style.width = (G.xp / G.xpNeed * 100) + '%';
  document.getElementById('xpText').textContent = G.xp + '/' + G.xpNeed + ' XP';
  document.getElementById('rIron').textContent = G.inv.iron;
  document.getElementById('rMeat').textContent = G.inv.meat;
  document.getElementById('rWood').textContent = G.inv.wood || 0;
}
// resource icons (same art as the inventory)
const RES_ICON = {
  iron: c => { c.fillStyle = '#5b6270'; c.beginPath(); c.roundRect(4, 6, 14, 11, 2); c.fill(); c.fillStyle = '#e9eef6'; c.fillRect(7, 9, 3, 2); c.fillRect(12, 12, 2, 2); },
  meat: c => { c.fillStyle = '#d9708a'; c.beginPath(); c.ellipse(11, 12, 7, 5, 0, 0, 7); c.fill(); c.fillStyle = '#f0e6d0'; c.fillRect(3, 10, 4, 2); c.fillRect(16, 12, 4, 2); },
  wood: c => { c.fillStyle = '#6b4a30'; c.fillRect(8, 6, 3, 12); c.fillStyle = '#3f8a39'; c.beginPath(); c.ellipse(10, 7, 7, 5, 0, 0, 7); c.fill(); },
  plank: c => { c.fillStyle = '#c89a5e'; c.beginPath(); c.roundRect(3, 9, 18, 6, 1); c.fill(); c.strokeStyle = '#8a6638'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(8, 9); c.lineTo(8, 15); c.moveTo(14, 9); c.lineTo(14, 15); c.stroke(); },
  ingot: c => { c.fillStyle = '#aab2c4'; c.beginPath(); c.moveTo(5, 16); c.lineTo(20, 16); c.lineTo(17, 9); c.lineTo(8, 9); c.closePath(); c.fill(); c.fillStyle = '#e9eef6'; c.fillRect(9, 10, 7, 2); },
  sword: c => { c.strokeStyle = '#d6dae0'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(6, 18); c.lineTo(18, 5); c.stroke(); c.strokeStyle = '#7e1d24'; c.lineWidth = 2; c.beginPath(); c.moveTo(4, 20); c.lineTo(9, 15); c.stroke(); c.fillStyle = '#8a4fd0'; c.beginPath(); c.arc(4, 20, 1.6, 0, 7); c.fill(); },
};
function setTrayIcons() {
  for (const [k, id] of [['iron', 'icIron'], ['meat', 'icMeat'], ['wood', 'icWood']]) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 22; const c = cv.getContext('2d'); RES_ICON[k](c);
    const img = document.getElementById(id); if (img) img.src = cv.toDataURL();
  }
}

// ── cartoon UI icons (replace emojis on buttons) ────────────
const OLN = '#241a10';
function ic(draw) { const cv = document.createElement('canvas'); cv.width = cv.height = 30; const c = cv.getContext('2d'); c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = 1.6; c.strokeStyle = OLN; draw(c); return cv.toDataURL(); }
function rrI(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
const ICONS = {
  inventory: c => { c.fillStyle = '#8a5a32'; rrI(c, 7, 9, 16, 16, 4); c.fill(); c.stroke(); c.fillStyle = '#a06a3c'; rrI(c, 7, 7, 16, 7, 4); c.fill(); c.stroke(); c.fillStyle = '#caa86e'; rrI(c, 12, 13, 6, 6, 2); c.fill(); c.stroke(); },
  bank: c => { c.fillStyle = '#cfd6e6'; c.beginPath(); c.moveTo(15, 5); c.lineTo(25, 11); c.lineTo(5, 11); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#e8edf5'; for (const x of [8, 13, 18]) { rrI(c, x, 12, 3, 9, 1); c.fill(); c.stroke(); } c.fillStyle = '#cfd6e6'; rrI(c, 5, 22, 20, 3, 1); c.fill(); c.stroke(); },
  alchemist: c => { c.fillStyle = '#cdeafe'; c.beginPath(); c.moveTo(12, 5); c.lineTo(12, 13); c.lineTo(7, 24); c.arc(15, 22, 8, Math.PI, 0, true); c.lineTo(18, 13); c.lineTo(18, 5); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#9b6bff'; c.beginPath(); c.moveTo(9, 17); c.lineTo(21, 17); c.lineTo(22, 22); c.arc(15, 22, 8, 0.2, Math.PI - 0.2); c.closePath(); c.fill(); c.fillStyle = '#fff'; c.fillRect(11, 4, 8, 2); },
  market: c => { c.fillStyle = '#ffcf4d'; rrI(c, 6, 11, 18, 9, 2); c.fill(); c.stroke(); c.fillStyle = '#ff9b3d'; c.beginPath(); c.moveTo(5, 11); c.lineTo(9, 5); c.lineTo(21, 5); c.lineTo(25, 11); c.closePath(); c.fill(); c.stroke(); c.strokeStyle = OLN; for (const x of [11, 15, 19]) { c.beginPath(); c.moveTo(x, 5); c.lineTo(x, 11); c.stroke(); } },
  stats: c => { c.fillStyle = '#5fd16a'; rrI(c, 6, 16, 4, 8, 1); c.fill(); c.stroke(); c.fillStyle = '#48b6ff'; rrI(c, 13, 10, 4, 14, 1); c.fill(); c.stroke(); c.fillStyle = '#ffcf4d'; rrI(c, 20, 13, 4, 11, 1); c.fill(); c.stroke(); },
  army: c => { for (const s of [-1, 1]) { c.save(); c.translate(15, 15); c.scale(s, 1); c.strokeStyle = OLN; c.fillStyle = '#d6dae0'; c.beginPath(); c.moveTo(-8, 9); c.lineTo(6, -8); c.lineTo(8, -6); c.lineTo(-6, 11); c.closePath(); c.fill(); c.stroke(); c.strokeStyle = '#7e1d24'; c.lineWidth = 2; c.beginPath(); c.moveTo(-8, 9); c.lineTo(-4, 5); c.stroke(); c.restore(); } },
  ship: c => { c.fillStyle = '#5b6068'; c.beginPath(); c.moveTo(15, 4); c.lineTo(19, 16); c.lineTo(15, 24); c.lineTo(11, 16); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#df6c95'; c.beginPath(); c.moveTo(15, 7); c.lineTo(17, 15); c.lineTo(13, 15); c.closePath(); c.fill(); c.fillStyle = '#5b6068'; c.beginPath(); c.moveTo(11, 13); c.lineTo(5, 19); c.lineTo(11, 18); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(19, 13); c.lineTo(25, 19); c.lineTo(19, 18); c.closePath(); c.fill(); c.stroke(); },
  planet: c => { c.fillStyle = '#7e8aa6'; c.beginPath(); c.arc(15, 15, 8, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#9aa6c2'; c.beginPath(); c.arc(12, 12, 3, 0, 7); c.fill(); c.strokeStyle = '#ffcf4d'; c.lineWidth = 2; c.save(); c.translate(15, 15); c.rotate(-0.4); c.beginPath(); c.ellipse(0, 0, 13, 4, 0, 0, 7); c.stroke(); c.restore(); },
  coin: c => { c.fillStyle = '#ffcf4d'; c.beginPath(); c.arc(15, 15, 10, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#e0a72e'; c.beginPath(); c.arc(15, 15, 7, 0, 7); c.fill(); c.fillStyle = '#7a5a16'; c.font = 'bold 13px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('$', 15, 16); },
  home: c => { c.fillStyle = '#e7d9c3'; rrI(c, 8, 14, 14, 11, 1); c.fill(); c.stroke(); c.fillStyle = '#b9543f'; c.beginPath(); c.moveTo(6, 14); c.lineTo(15, 5); c.lineTo(24, 14); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#6b4a30'; rrI(c, 13, 18, 4, 7, 1); c.fill(); c.stroke(); },
  sound: c => { c.fillStyle = '#3a3f4a'; c.beginPath(); c.moveTo(6, 12); c.lineTo(11, 12); c.lineTo(16, 7); c.lineTo(16, 23); c.lineTo(11, 18); c.lineTo(6, 18); c.closePath(); c.fill(); c.stroke(); c.strokeStyle = '#48b6ff'; c.lineWidth = 2; c.beginPath(); c.arc(17, 15, 4, -0.8, 0.8); c.arc(17, 15, 7, -0.8, 0.8); c.stroke(); },
};
function setButtonIcons() {
  const cache = {};
  document.querySelectorAll('[data-ic]').forEach(img => { const k = img.dataset.ic; if (ICONS[k]) img.src = (cache[k] ||= ic(ICONS[k])); });
}

// ── sound ───────────────────────────────────────────────────
let actx = null;
function audio() { if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); startMusic(); } return actx; }
function sfx(kind) {
  if (!G.soundOn || !actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.connect(g); g.connect(actx.destination);
  const f = kind === 'level' ? 660 : kind === 'hit' ? 220 : 440;
  o.frequency.value = f; o.type = 'square'; g.gain.value = 0.06;
  o.start(); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.18); o.stop(actx.currentTime + 0.18);
}
// background music: the uploaded space-ambient track, looped forever
function startMusic() {
  const bgm = document.getElementById('bgm');
  if (!bgm) return;
  bgm.volume = 0.5; bgm.loop = true;
  bgm.addEventListener('ended', () => { bgm.currentTime = 0; bgm.play().catch(() => {}); }); // safety re-loop
  const tryPlay = () => { if (G.soundOn) bgm.play().catch(() => {}); };
  tryPlay();
  // browsers block autoplay without a user gesture (e.g. right after a refresh) → resume on first interaction
  const resume = () => { tryPlay(); if (!bgm.paused) { removeEventListener('pointerdown', resume); removeEventListener('keydown', resume); } };
  addEventListener('pointerdown', resume); addEventListener('keydown', resume);
}

// ── toast ───────────────────────────────────────────────────
function setOnline(n) { if (n == null) return; const el = document.getElementById('onlineChip'); if (el) el.textContent = `🟢 ${n} online`; }
let toastT = null;
function toast(msg, ms = 2600) {
  const el = document.getElementById('toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), ms);
}
let announceT;
function showAnnounce(text, ms = 5000) {
  const el = document.getElementById('announce'); if (!el) return;
  el.textContent = text; el.classList.remove('hidden');
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');   // restart the entry animation
  clearTimeout(announceT); announceT = setTimeout(() => el.classList.add('hidden'), ms);
}

// ── network wiring ──────────────────────────────────────────
function wireNet() {
  on('init', m => {
    G.world = m.world; G.tiles = m.tiles || {};
    G.me = m.you; G.me.dir = 'down'; G.me.moving = false;
    buildBridges(); buildNodes(); buildNpcs();
    for (const p of m.players) G.players.set(p.id, p);
    for (const c of m.creatures) G.creatures.set(c.id, c);
    G.market = m.market || [];
    G.arena = m.arena || {}; setOnline(m.online); refreshHUD();
    if (G.chosenName) { G.me.name = G.chosenName; G.actions.sendProfile(); }   // apply the username picked at login
    applyStats(); startIntro();                                                // recompute derived stats + play the spawn-in animation
  });
  on('profileLoad', m => {
    const sv = m.profile || {};
    if (sv.inv) G.inv = { ...G.inv, ...sv.inv, items: sv.inv.items || G.inv.items, gear: sv.inv.gear || G.inv.gear || [] };
    if (sv.bank) G.bank = { ...G.bank, ...sv.bank };
    if (sv.equip) G.equip = { ...G.equip, ...sv.equip };
    if (sv.appearance) G.appearance = { ...G.appearance, ...sv.appearance };
    if (sv.ship) G.ship = sv.ship;
    if (Array.isArray(sv.ownedShips)) G.ownedShips = sv.ownedShips.includes('scout') ? sv.ownedShips : ['scout', ...sv.ownedShips];
    if (sv.name && G.me) G.me.name = sv.name;
    if (typeof m.level === 'number') G.level = m.level;
    if (typeof m.xp === 'number') G.xp = m.xp;
    if (typeof m.xpNeed === 'number') G.xpNeed = m.xpNeed; else G.xpNeed = xpForLevel(G.level);
    if (sv.stats) G.stats = { health: 0, strength: 0, agility: 0, resistance: 0, ...sv.stats };
    if (typeof sv.statPoints === 'number') G.statPoints = sv.statPoints;
    applyStats(); G.hp = G.maxHp;                                   // recompute maxHp from Health, full heal on load
    G.actions.sendProfile?.();                                      // broadcast restored gear so others see it
    refreshHUD(); refreshActivePanel(); toast('Progress restored.');
  });
  on('join', m => { G.players.set(m.player.id, m.player); setOnline(m.online); });
  on('leave', m => { G.players.delete(m.id); setOnline(m.online); });
  on('kicked', m => { toast('Disconnected: ' + (m.reason || 'another session opened'), 6000); });
  on('players', m => { for (const p of m.list) { if (p.id === G.me?.id) continue; const ex = G.players.get(p.id); if (ex) { ex.tx = p.x; ex.ty = p.y; ex.dir = p.dir; ex.moving = p.moving; ex.inAir = p.inAir; if (p.level != null) ex.level = p.level; if (p.inArena != null) ex.inArena = p.inArena; } else G.players.set(p.id, { ...p, tx: p.x, ty: p.y }); } });
  on('profile', m => { if (m.id !== G.me?.id) { const ex = G.players.get(m.id) || {}; G.players.set(m.id, { ...ex, ...m.player, tx: ex.tx, ty: ex.ty }); } });
  on('creatures', m => { for (const u of m.list) { const c = G.creatures.get(u.id); if (c) { c.tx = u.x; c.ty = u.y; if (c.x == null) { c.x = u.x; c.y = u.y; } c.target = u.target; c.aggressive = u.aggressive; } } });
  on('creatureHp', m => { const c = G.creatures.get(m.cid); if (c) c.hp = m.hp; });
  on('creatureDead', m => { const c = G.creatures.get(m.cid); if (c) c.dead = true; });
  on('creatureSpawn', m => G.creatures.set(m.creature.id, m.creature));
  on('kill', m => {
    const meat = m.kind === 'gargoyle' ? 2 : m.kind === 'sheep' ? 2 : m.kind === 'alien' ? 3 : 1;
    if (invCount() + meat <= G.invMax) G.inv.meat += meat;
    addXP(m.xp); spawnFloater('+' + meat + ' meat', G.me.x, G.me.y - 30, '#e0606b');
    // equipment drops (rolled server-side, 10% per slot)
    if (Array.isArray(m.drops)) {
      let off = 44;
      for (const d of m.drops) {
        if (invCount() >= G.invMax) break;
        (G.inv.gear ||= []).push({ id: 'g' + (gearSeq++) + Date.now().toString(36) + (Math.random() * 1e4 | 0), slot: d.slot, src: d.src, bonus: d.bonus });
        spawnFloater('+ ' + d.src[0].toUpperCase() + d.src.slice(1) + ' ' + (SLOT_NAMES[d.slot] || d.slot), G.me.x, G.me.y - off, '#9fd16a'); off += 14;
      }
    }
    refreshHUD(); refreshActivePanel(); syncProfile();
  });
  on('hurt', m => { G.hp = m.hp; sfx('hit'); refreshHUD(); });
  on('died', () => { G.hp = 0; if (!G.me.inArena) document.getElementById('deathBanner').classList.remove('hidden'); });
  on('revived', m => { G.me.x = m.x; G.me.y = m.y; G.hp = m.hp; G.me.inArena = false; document.getElementById('deathBanner').classList.add('hidden'); refreshHUD(); });
  on('arena', m => { G.arena = m; });
  on('announce', m => showAnnounce(m.text));
  on('enteredArena', m => { G.me.inArena = true; G.me.x = m.x; G.me.y = m.y; camMode = 'follow'; setZoom(2.2); toast('⚔️ You entered the Arena! You cannot leave until the battle ends.', 5000); });
  on('arenaDenied', m => toast('🔒 ' + (m.reason || 'Entry refused.'), 4000));
  on('tiles', m => { for (const t of m.tiles) G.tiles[tileKey(t.x, t.y)] = { ...t }; });
  on('market', m => { G.market = m.market; refreshActivePanel(); });
  on('chat', m => addChat(m.name, m.text));
  on('whisper', m => addChat(m.from, m.text, false, true));
  on('whisperFail', m => addChat('', `No player named "${m.to}" is online.`, true));
}

// ── two-channel chat: GENERAL (public + system) and PRIVATE (whispers) ──
const chatMsgs = { general: [], private: [] };
let chatChannel = 'general';
function renderChat() {
  const log = document.getElementById('chatLog'); if (!log) return;
  log.innerHTML = chatMsgs[chatChannel].join('');
  log.scrollTop = log.scrollHeight;
}
function addChat(name, text, sys, whisper) {
  const ch = whisper ? 'private' : 'general';
  const html = sys ? `<div><span class="sys">${text}</span></div>`
    : `<div><span class="who"${whisper ? ' style="color:#c79bff"' : ''}>${esc(name)}${whisper ? ' (whisper)' : ''}:</span> ${esc(text)}</div>`;
  const arr = chatMsgs[ch]; arr.push(html); while (arr.length > 60) arr.shift();
  if (ch === chatChannel) renderChat();
  else if (ch === 'private') { const u = document.getElementById('privUnread'); if (u) u.classList.add('on'); }
}
function setChatChannel(ch) {
  chatChannel = ch;
  document.querySelectorAll('#chatTabs button').forEach(b => b.classList.toggle('active', b.dataset.ch === ch));
  if (ch === 'private') { const u = document.getElementById('privUnread'); if (u) u.classList.remove('on'); }
  const inp = document.getElementById('chatText'); if (inp) inp.placeholder = ch === 'private' ? 'Whisper:  /w Name: message' : 'Press Enter to chat…';
  renderChat();
}
const esc = s => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ── balance ─────────────────────────────────────────────────
async function refreshBalance() {
  const el = document.getElementById('balance'); if (!el) return;
  if (!wallet.connected) { el.textContent = '— $Lunaris'; return; }
  const b = await skyBalance();
  el.textContent = Math.floor(b).toLocaleString() + ' $Lunaris';
}

function syncProfile() { if (wallet.pubkey) send({ type: 'sync', inv: G.inv, bank: G.bank, equip: G.equip, level: G.level, xp: G.xp, xpNeed: G.xpNeed, maxHp: G.maxHp, stats: G.stats, statPoints: G.statPoints, res: effStat('resistance'), ownedShips: G.ownedShips, ship: G.ship }); }

// ── boot ────────────────────────────────────────────────────
async function startGame(asGuest) {
  document.getElementById('login').classList.add('hidden');
  for (const id of ['topLeft', 'topRight', 'status', 'toolbar', 'chat', 'resTray', 'btnChat', 'btnTwitter']) document.getElementById(id).classList.remove('hidden');
  setTrayIcons(); setButtonIcons();
  audio();
  await loadConfig();
  connectWS(wallet.cfg.wsUrl);
  wireNet();
  // send our profile once connected
  on('open', () => send({ type: 'profile', name: G.me?.name, appearance: G.appearance, ship: G.ship, wallet: wallet.pubkey }));
  // periodically persist inventory / bank / equipment (wallet players only)
  setInterval(syncProfile, 8000);
  window.addEventListener('beforeunload', syncProfile);
  document.getElementById('btnTwitter').onclick = () => window.open('https://x.com/CelestiaSol1', '_blank');
  addChat('', 'Welcome to Central City! Left-click to move · fly your ship across the void to reach the zones · click creatures to fight, nodes to farm.', true);
  addChat('', 'Press Tab for inventory. Locked zones (planets, Exploration) cannot be entered yet.', true);
  refreshHUD();
}

// expose actions to UI layer
G.actions = {
  enterBuyMode, enterBuildMode, exitModes, toast, refreshHUD, refreshBalance,
  sendProfile: () => send({ type: 'profile', name: G.me?.name, appearance: G.appearance, ship: G.ship, wallet: wallet.pubkey, gear: gearVis() }),
  syncProfile,
  addStatPoint: (stat) => { if (G.statPoints > 0 && G.stats[stat] != null) { G.stats[stat]++; G.statPoints--; applyStats(); refreshHUD(); syncProfile(); } },
  applyStats,
  locateNpc: (role) => { const n = (G.npcs || []).find(x => x.role === role); if (n) { G.locate = { x: n.x, y: n.y, name: n.name }; toast('Follow the beacon to ' + n.name + '.'); } else toast('Cannot find that NPC.'); },
  nearNpc: (role) => { const n = (G.npcs || []).find(x => x.role === role); return !!(n && G.me && Math.hypot(n.x - G.me.x, n.y - G.me.y) < TILE * 3.2); },
  buyShip: (kind) => {
    const cost = G.SHIP_COST[kind]; if (!cost) return;
    if ((G.ownedShips ||= ['scout']).includes(kind)) return;
    for (const [r, n] of Object.entries(cost)) if ((G.inv[r] || 0) < n) return toast(`Need ${n} ${r === 'goldingot' ? 'gold ingot' : r === 'ingot' ? 'iron ingot' : r}.`);
    for (const [r, n] of Object.entries(cost)) G.inv[r] -= n;
    G.ownedShips.push(kind); G.ship = kind;
    refreshHUD(); syncProfile(); sendProfile(); toast('🛸 ' + kind + ' acquired & active!'); refreshActivePanel();
  },
  useShip: (kind) => { if ((G.ownedShips || ['scout']).includes(kind)) { G.ship = kind; syncProfile(); sendProfile(); refreshActivePanel(); toast('Now flying the ' + kind + '.'); } },
  placeShip: (kind) => { if (!G.me) return; G.builtShips.push({ kind, x: G.me.x + 40, y: G.me.y }); toast(kind + ' parked on your island.'); },
  setBuildBrush: (b) => { G.buildBrush = b; },
  chat: (text) => {
    const w = text.match(/^\/w\s+([^:]+):\s*(.+)$/i);          // /w Player: message  → private whisper
    if (w) { send({ type: 'whisper', to: w[1].trim(), text: w[2].trim() }); addChat('→ ' + w[1].trim(), w[2].trim(), false, true); return; }
    send({ type: 'chat', text });
  },
  invCount, heal: (n) => { G.hp = Math.min(G.maxHp, G.hp + n); refreshHUD(); },
  enterArena: () => {
    if (G.me.inArena) return toast('You are already in the Arena.');
    if (G.arena?.phase === 'battle') return toast('A battle is already underway — wait for the next round.');
    const cost = { cookedmeat: 1, plank: 3, ingot: 3 };
    for (const [k, n] of Object.entries(cost)) if ((G.inv[k] || 0) < n) return toast(`The Guardian needs ${n} ${k === 'cookedmeat' ? 'cooked steak' : k === 'ingot' ? 'iron ingot' : k}.`);
    for (const [k, n] of Object.entries(cost)) G.inv[k] -= n;
    refreshHUD(); syncProfile(); send({ type: 'enterArena' }); openPanel(null);
    toast('🛡️ The Guardian lets you through…');
  },
  startCraft: (id, w) => {
    if (w.output === 'cookedmeat' && (G.inv.cookedmeat || 0) + G.craftQ.filter(q => q.output === 'cookedmeat').length + (G.craft?.output === 'cookedmeat' ? 1 : 0) >= 5) return toast('Cooked Steak max reached (5).');
    for (const [k, n] of Object.entries(w.cost)) if ((G.inv[k] || 0) < n) return toast(`Need ${n} ${k}.`);
    if (invCount() + G.craftQ.length >= G.invMax) return toast('Inventory full.');
    for (const [k, n] of Object.entries(w.cost)) G.inv[k] -= n;
    refreshHUD(); G.craftQ.push({ output: w.output, ms: w.ms });
    if (!G.craft) startNextCraft();
    toast(`${w.output} queued (${G.craftQ.length + (G.craft ? 1 : 0)} in production).`);
    refreshActivePanel();
  },
};

// ── UI buttons ──────────────────────────────────────────────
function chosenUsername() { return (document.getElementById('userName')?.value || '').trim().slice(0, 16); }
function chosenWallet() { return (document.getElementById('userWallet')?.value || '').trim(); }
const isSolAddr = a => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
try { if (localStorage.getItem('lunaris_sound') === '0') { G.soundOn = false; const b = document.getElementById('btnSound'); if (b) { b.style.filter = 'grayscale(1) brightness(.7)'; b.title = 'Sound off'; } } } catch {}
const SAVED_KEY = 'lunaris_profile';
function loginWith(name, w) {
  G.chosenName = name;
  wallet.pubkey = w;                        // players are identified by their entered wallet (no on-chain signing yet)
  try { localStorage.setItem(SAVED_KEY, JSON.stringify({ name, wallet: w })); } catch {}   // remember across refreshes
  G.guest = true; startGame(true);
}
document.getElementById('btnGuest').onclick = async () => {
  if (!chosenUsername()) return toast('Please choose a username first.');
  const w = chosenWallet();
  if (!isSolAddr(w)) return toast('Enter a valid Solana wallet address to play as guest.');
  loginWith(chosenUsername(), w);
};
// auto-reconnect a returning player with the last profile they used (Leave clears it)
(function autoLogin() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null');
    if (s && s.name && isSolAddr(s.wallet)) {
      document.getElementById('userName').value = s.name;
      document.getElementById('userWallet').value = s.wallet;
      loginWith(s.name, s.wallet);
    }
  } catch {}
})();
document.getElementById('btnChat').onclick = () => document.getElementById('chat').classList.toggle('hidden');
document.getElementById('btnBuyTerritory').onclick = () => toast('🔒 Buy Territory is locked for now.');
document.getElementById('btnHome').onclick = () => { if (G.me) { camMode = 'follow'; setZoom(2); updateCamera(); exitModes(); openPanel(null); } };
document.getElementById('btnSound').onclick = () => {
  G.soundOn = !G.soundOn;
  try { localStorage.setItem('lunaris_sound', G.soundOn ? '1' : '0'); } catch {}   // remember across refreshes
  const b = document.getElementById('btnSound'); b.style.filter = G.soundOn ? '' : 'grayscale(1) brightness(.7)'; b.title = G.soundOn ? 'Sound on' : 'Sound off';
  const bgm = document.getElementById('bgm'); if (bgm) { if (G.soundOn) bgm.play().catch(() => {}); else bgm.pause(); }
};
document.getElementById('btnRespawn').onclick = () => send({ type: 'respawn' });
document.getElementById('btnDisconnect').onclick = async () => {
  try { syncProfile(); } catch {}                                   // persist progress before leaving
  try { localStorage.removeItem(SAVED_KEY); } catch {}              // forget the saved profile so refresh returns to login
  try { if (wallet.connected) await walletDisconnect(); } catch {}
  setTimeout(() => location.reload(), 120);                          // back to the login screen
};

document.querySelectorAll('.tool').forEach(btn => btn.onclick = () => {
  exitModes(); openPanel(btn.dataset.panel);
});

const chatForm = document.getElementById('chatForm');
chatForm.onsubmit = e => { e.preventDefault(); const i = document.getElementById('chatText'); const t = i.value.trim(); if (t) G.actions.chat(t); i.value = ''; i.blur(); };
document.querySelectorAll('#chatTabs button').forEach(b => b.onclick = () => setChatChannel(b.dataset.ch));

initUI({ toast, refreshBalance });
requestAnimationFrame(render);
setInterval(() => { updateMovement(); updateCamera(); }, 1000 / 60);

// ── animated login scene: starry night, Milky Way, moving shooting stars, mountains + a pixel hero ──
function initLoginBg() {
  const cv = document.getElementById('loginBg'); if (!cv) return;
  const c = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const rnd = (a, b) => a + Math.random() * (b - a);
  // a stable seeded random so the scene (stars / mountains) doesn't reshuffle on resize
  let seed = 0x9e3779b1; const srnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  // the Milky Way runs diagonally from upper-left to lower-right through the centre
  function bandDist(nx, ny) { // signed distance of a normalised point to the galaxy centre line
    const ax = 0.30, ay = 0.10, bx = 0.78, by = 0.92;          // line endpoints (normalised)
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    return Math.abs((nx - ax) * dy - (ny - ay) * dx) / L;
  }
  let stars = [], clouds = [];
  function build() {
    seed = 0x9e3779b1;
    // stars — fill the whole sky, denser and brighter close to the Milky Way band
    stars = [];
    for (let i = 0; i < 560; i++) {
      const nx = srnd(), ny = srnd();
      const near = Math.max(0, 1 - bandDist(nx, ny) / 0.16);
      if (srnd() > 0.35 + near * 0.6) continue;                 // thin out away from the band
      stars.push({ x: nx, y: ny, z: srnd(), p: srnd() * 6.28, warm: srnd() < 0.12, big: srnd() < 0.05 });
    }
    // soft nebula clouds strung along the band
    clouds = [];
    for (let i = 0; i <= 14; i++) {
      const f = i / 14, nx = 0.30 + (0.78 - 0.30) * f + (srnd() - 0.5) * 0.06, ny = 0.10 + (0.92 - 0.10) * f + (srnd() - 0.5) * 0.06;
      clouds.push({ x: nx, y: ny, r: rnd(0.10, 0.20), hue: srnd() < 0.5 ? 'b' : 'p', a: rnd(0.05, 0.12) });
    }
  }
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; c.setTransform(dpr, 0, 0, dpr, 0, 0); build(); };
  resize(); addEventListener('resize', resize);

  // shooting stars
  const shooters = []; let nextShot = 0;
  function spawnShot() {
    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? rnd(-0.1, 0.45) * W : rnd(0.55, 1.1) * W;
    const y = rnd(0.02, 0.42) * H;
    const ang = (fromLeft ? rnd(0.18, 0.42) : Math.PI - rnd(0.18, 0.42));   // shallow, heading down + inward
    const sp = rnd(620, 980);
    shooters.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: rnd(0.9, 1.5), len: rnd(120, 230) });
  }

  // hero: runs left→right, then takes off in the tier-4 ship, then loops
  const hero = { mode: 'run', x: -80, y: 0, t: 0 };
  const t0 = performance.now(); let last = t0;
  function frame(now) {
    const login = document.getElementById('login');
    if (!login || login.classList.contains('hidden')) return;     // stop once the game starts
    const t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;

    // ── sky (full height — just the starry night, no ground) ──
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#050912'); sky.addColorStop(0.5, '#070d1c'); sky.addColorStop(1, '#060b18');
    c.fillStyle = sky; c.fillRect(0, 0, W, H);

    // ── Milky Way nebula clouds ──
    for (const cl of clouds) {
      const x = cl.x * W, y = cl.y * H, r = cl.r * Math.min(W, H) * 1.4;
      const g2 = c.createRadialGradient(x, y, 0, x, y, r);
      const col = cl.hue === 'b' ? '120,165,235' : '150,120,210';
      g2.addColorStop(0, `rgba(${col},${cl.a})`); g2.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g2; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }

    // ── stars ──
    for (const s of stars) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.2 + s.p)), b = (0.35 + s.z * 0.65) * tw;
      const sz = (s.big ? 1.7 : 1) * (0.7 + s.z * 1.4);
      c.fillStyle = s.warm ? `rgba(255,225,195,${0.7 * b})` : `rgba(214,228,255,${0.8 * b})`;
      c.fillRect(s.x * W, s.y * H, sz, sz);
      if (s.big) { c.fillStyle = `rgba(220,235,255,${0.18 * b})`; c.fillRect(s.x * W - sz, s.y * H - sz, sz * 3, sz * 3); }
    }

    // ── shooting stars ──
    if (t > nextShot) { spawnShot(); if (Math.random() < 0.3) spawnShot(); nextShot = t + rnd(0.7, 2.0); }
    for (let i = shooters.length - 1; i >= 0; i--) {
      const sh = shooters[i]; sh.life += dt; sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      const k = sh.life / sh.max; if (k >= 1 || sh.y > H * 0.95) { shooters.splice(i, 1); continue; }
      const fade = k < 0.15 ? k / 0.15 : (1 - k);                  // ease in then out
      const ux = sh.vx / Math.hypot(sh.vx, sh.vy), uy = sh.vy / Math.hypot(sh.vx, sh.vy);
      const tx = sh.x - ux * sh.len, ty = sh.y - uy * sh.len;
      const tg = c.createLinearGradient(sh.x, sh.y, tx, ty);
      tg.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`); tg.addColorStop(0.4, `rgba(190,215,255,${0.4 * fade})`); tg.addColorStop(1, 'rgba(170,200,255,0)');
      c.strokeStyle = tg; c.lineWidth = 2; c.lineCap = 'round'; c.beginPath(); c.moveTo(sh.x, sh.y); c.lineTo(tx, ty); c.stroke();
      c.fillStyle = `rgba(255,255,255,${0.95 * fade})`; c.beginPath(); c.arc(sh.x, sh.y, 1.8, 0, 7); c.fill();
      c.fillStyle = `rgba(200,225,255,${0.3 * fade})`; c.beginPath(); c.arc(sh.x, sh.y, 5, 0, 7); c.fill();
    }

    // ── hero: run across, then blast off in the tier-4 ship, then loop ──
    const base = H * 0.80;                                         // invisible run line
    const runSpeed = Math.max(170, W * 0.24);
    if (hero.mode === 'run') {
      hero.y = base; hero.x += runSpeed * dt;
      if (hero.x >= W * 0.66) hero.mode = 'fly';
    } else if (hero.mode === 'fly') {
      hero.x += runSpeed * 1.25 * dt; hero.y -= Math.max(240, H * 0.45) * dt;
      if (hero.y < -H * 0.25 || hero.x > W * 1.25) { hero.mode = 'wait'; hero.t = t; }
    } else if (t - hero.t > 1.3) { hero.mode = 'run'; hero.x = -80; hero.y = base; }
    const scale = Math.min(H * 0.26, 230) / 34;                    // sprite ≈ 34px tall incl. shadow
    c.save();
    c.translate(hero.x, hero.y); c.scale(scale, scale);
    if (hero.mode === 'fly') S.drawPlayer(c, 0, -16, G.appearance, 'right', t * 10, true, 'dread', null);   // tier-4 ship takeoff
    else S.drawPlayer(c, 0, -16, G.appearance, 'right', t * 10, false, null, null);                          // running right
    c.restore();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
initLoginBg();
