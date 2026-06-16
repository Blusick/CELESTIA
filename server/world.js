// ─────────────────────────────────────────────────────────────
//  Lunaris world — a Central City hub ringed by themed zones,
//  linked by bridges across open space. Organic island shapes.
//  Coordinates are in TILES unless suffixed _px.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR can point at a Render persistent disk so saves survive redeploys.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SAVE_FILE = path.join(DATA_DIR, 'world.json');

export const TILE = 32;
export const GRID_W = 200;
export const GRID_H = 200;

// cell chars: '.'=void  g=grass s=sand w=water r=rock n=snow l=lava
//             p=path b=bridge m=metal/city h=hostile d=dust/desert
const LAND = new Set(['g', 's', 'w', 'r', 'n', 'l', 'p', 'b', 'm', 'h', 'd']);
const isLandCell = ch => LAND.has(ch);

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

function genBlob(w, h, seed, base, rough = 0.22) {
  const rand = rng(seed), N = 20, ang = [];
  for (let i = 0; i < N; i++) ang.push(1 - rough + rand() * rough * 2);
  for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) ang[i] = (ang[i] + ang[(i + 1) % N] + ang[(i + N - 1) % N]) / 3;
  const cx = w / 2, cy = h / 2, rx = w / 2 - 0.5, ry = h / 2 - 0.5, cells = [];
  for (let y = 0; y < h; y++) { const row = [];
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      let a = (Math.atan2(dy, dx) / (Math.PI * 2) + 0.5) * N;
      const i0 = Math.floor(a) % N, i1 = (i0 + 1) % N, f = a - Math.floor(a);
      row.push(Math.hypot(dx, dy) < ang[i0] * (1 - f) + ang[i1] * f ? base : '.');
    } cells.push(row);
  } return cells;
}
const inb = (c, x, y) => y >= 0 && y < c.length && x >= 0 && x < c[0].length;
function stamp(cells, cx, cy, rad, ch, onlyOn) {
  for (let y = 0; y < cells.length; y++) for (let x = 0; x < cells[0].length; x++)
    if (Math.hypot(x + .5 - cx, y + .5 - cy) < rad && inb(cells, x, y) && (!onlyOn || onlyOn.includes(cells[y][x]))) cells[y][x] = ch;
}
function scatter(cells, features, type, n, allow, rand, extra = {}) {
  let placed = 0, guard = 0;
  while (placed < n && guard++ < n * 50) {
    const x = 1 + Math.floor(rand() * (cells[0].length - 2)), y = 1 + Math.floor(rand() * (cells.length - 2));
    if (allow.includes(cells[y][x]) && !features.some(f => Math.abs(f.tx - x) < 2 && Math.abs(f.ty - y) < 2)) { features.push({ t: type, tx: x, ty: y, ...extra }); placed++; }
  }
}

// ── island registry ──────────────────────────────────────────
export const ISLANDS = [];
function register(def) {
  const seed = hash(def.id);
  const cells = genBlob(def.w, def.h, seed, def.base, def.rough);
  const features = [];
  def.build?.(cells, features, rng(seed ^ 0x9e3779b9));
  ISLANDS.push({ ...def, cells: cells.map(r => r.join('')), features });
}
function islandById(id) { return ISLANDS.find(i => i.id === id); }

// ── CENTRAL CITY (hub) ───────────────────────────────────────
register({
  id: 'hub', name: 'Central City', sub: 'The Main Hub', type: 'main', color: '#48b6ff',
  x: 67, y: 75, w: 52, h: 44, base: 'm', rough: 0.1,   // ~3× the previous footprint
  build(cells, features, rand) {
    const W = cells[0].length, H = cells.length, cx = W / 2 | 0, cy = H / 2 | 0;
    const ringR = Math.min(W, H) * 0.30;
    // central arena footprint (hub-relative) — kept clear of city features
    const AR = { x0: 16, y0: 14, x1: 36, y1: 29 };
    const inAr = (x, y) => x >= AR.x0 && x <= AR.x1 && y >= AR.y0 && y <= AR.y1;
    // ring road circling the arena + radial avenues
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (cells[y][x] === '.') continue;
      if (Math.abs(Math.hypot(x - cx, y - cy) - ringR) < 0.9) cells[y][x] = 'p';
    }
    const reach = Math.max(W, H);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) for (let r = 0; r < reach; r++) { const x = cx + dx * r, y = cy + dy * r; if (inb(cells, x, y) && cells[y][x] !== '.') cells[y][x] = 'p'; }
    // fountain plaza (kept) + The Arena Guardian at the foot of the stairs
    const fy = AR.y1 + 4;
    features.push({ t: 'fountain', tx: cx, ty: fy });
    features.push({ t: 'npc', tx: cx, ty: AR.y1, name: 'The Arena Guardian', role: 'guardian', color: '#ffcf4d', shop: 1 });
    // service NPCs scattered around the city, each with a themed building behind them
    const shops = [
      { name: 'Banker James', role: 'bank', color: '#48b6ff' },
      { name: 'Luna the Alchemist', role: 'alchemist', color: '#b07bff' },
      { name: 'Trader Joe', role: 'marketplace', color: '#ffcf4d' },
    ];
    const spots = [];
    for (const s of shops) {
      let bx = 0, by = 0, ok = false;
      for (let tries = 0; tries < 400 && !ok; tries++) {
        bx = 6 + (rand() * (W - 12) | 0); by = 9 + (rand() * (H - 15) | 0);
        if (inAr(bx, by) || inAr(bx, by - 2)) continue;                        // not over the arena
        if (Math.abs(bx - cx) < 4 && Math.abs(by - fy) < 5) continue;          // not on the fountain plaza
        if (cells[by]?.[bx] !== 'm' || cells[by - 2]?.[bx] !== 'm') continue;  // on solid city floor
        if (spots.some(p => Math.hypot(p.x - bx, p.y - by) < 15)) continue;    // keep them well apart
        ok = true;
      }
      if (!ok) continue;
      features.push({ t: 'shopbuilding', kind: s.role, tx: bx, ty: by - 2 });
      features.push({ t: 'npc', tx: bx, ty: by, name: s.name, role: s.role, color: s.color, shop: 1 });
      spots.push({ x: bx, y: by });
    }
    // Furnace just NORTH of the arena (no NPC — opens on click)
    features.push({ t: 'furnace', tx: cx, ty: AR.y0 - 3 });
    // Tom the Colonist + his geodesic dome habitat on the WEST side of the city
    const tcx = 9, tcy = (H * 0.5) | 0;
    features.push({ t: 'colony', tx: tcx, ty: tcy - 2 });
    features.push({ t: 'npc', tx: tcx, ty: tcy, name: 'Tom the Colonist', role: 'colonise', color: '#7fb0d0', shop: 1 });
    spots.push({ x: tcx, y: tcy });
    // (blinking blue towers removed)
    // lamps along the avenues (not under the arena)
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) for (let r = 4; r < reach; r += 5) { const x = cx + dx * r + (dx ? 0 : 1), y = cy + dy * r + (dy ? 0 : 1); if (inb(cells, x, y) && !inAr(x, y) && cells[y][x] === 'p') features.push({ t: 'lamp', tx: x, ty: y }); }
  },
});

// ── ARENA — an elevated platform in the CENTRE of the city (≈⅓ its size) ──
register({
  id: 'arena', name: 'Arena', type: 'arena', color: '#ffcf4d',
  x: 84, y: 90, w: 18, h: 13, base: 'm', rough: 0.06,   // original size, centred on the city
  build(cells, features) {
    const W = cells[0].length, H = cells.length;
    features.push({ t: 'arenacenter', tx: W / 2 | 0, ty: H / 2 | 0 });
  },
});

// ── ZONES (organic) ──────────────────────────────────────────
register({
  id: 'mining', name: 'Mining Zone', resources: 'Minerals · Crystals · Rare Stones', color: '#ffcf4d',
  type: 'creature', biome: 'mining', level: 2, x: 80, y: 43, w: 28, h: 20, base: 'r', rough: 0.3,
  build(cells, features, rand) {
    stamp(cells, cells[0].length * 0.7, cells.length * 0.35, 2.4, 'n', ['r']); // icy crystal shelf
    scatter(cells, features, 'crystal', 7, ['r', 'n'], rand);
    scatter(cells, features, 'rock', 8, ['r'], rand);   // (decorative mining rigs removed)
    features.push({ t: 'workshop', kind: 'miner', tx: cells[0].length * 0.5 | 0, ty: (cells.length * 0.55 | 0) - 2 });
    features.push({ t: 'npc', tx: cells[0].length * 0.5 | 0, ty: cells.length * 0.55 | 0, name: 'Rocky Pete', role: 'miner', color: '#9aa0b0', shop: 1 });
  },
});
register({
  id: 'agri', name: 'Agricultural Zone', resources: 'Plants · Food · Biomass', color: '#5fd16a',
  type: 'creature', biome: 'agri', level: 1, x: 31, y: 85, w: 26, h: 24, base: 'g', rough: 0.26,
  build(cells, features, rand) {
    stamp(cells, cells[0].length * 0.35, cells.length * 0.5, 2.0, 'w', ['g']);
    scatter(cells, features, 'tree', 26, ['g'], rand);   // lots of farmable pines on random tiles (greenhouse & farm plots removed)
    scatter(cells, features, 'bigtree', 4, ['g'], rand); // rare big trees → 2× wood
    scatter(cells, features, 'flower', 12, ['g'], rand);
    features.push({ t: 'workshop', kind: 'lumberjack', tx: cells[0].length * 0.5 | 0, ty: (cells.length * 0.5 | 0) - 2 });
    features.push({ t: 'npc', tx: cells[0].length * 0.5 | 0, ty: cells.length * 0.5 | 0, name: 'Timber Tom', role: 'lumberjack', color: '#8a5a32', shop: 1 });
  },
});
register({
  id: 'hostile', name: 'Hostile Zone', resources: 'Alien DNA · Rare Materials · Loot', color: '#ff5a6e',
  type: 'creature', biome: 'hostile', level: 4, x: 129, y: 83, w: 26, h: 24, base: 'h', rough: 0.32,
  build(cells, features, rand) {
    stamp(cells, cells[0].length * 0.55, cells.length * 0.35, 2.2, 'l', ['h']);
    features.push({ t: 'spire', tx: cells[0].length * 0.45 | 0, ty: cells.length * 0.4 | 0, dark: 1 });
    scatter(cells, features, 'crystal', 6, ['h', 'l'], rand, { dark: 1 });
    // (removed the dark purple rock clusters — they read like little sheep)
  },
});
register({
  id: 'build', name: 'Construction Zone', resources: 'Processed Materials · Modules', color: '#ff9b3d',
  type: 'creature', biome: 'build', level: 2, x: 80, y: 129, w: 28, h: 20, base: 'd', rough: 0.28,
  build(cells, features, rand) {
    for (let y = 0; y < cells.length; y++) for (let x = 0; x < cells[0].length; x++) if (cells[y][x] === 'd' && (x + y) % 2 === 0 && Math.random() < 0.04) cells[y][x] = 'm';
    scatter(cells, features, 'rock', 5, ['d'], rand);   // (decorative cranes & towers removed)
    features.push({ t: 'workshop', kind: 'builder', tx: cells[0].length * 0.5 | 0, ty: (cells.length * 0.55 | 0) - 2 });
    features.push({ t: 'npc', tx: cells[0].length * 0.5 | 0, ty: cells.length * 0.55 | 0, name: 'Forge Fred', role: 'builder', color: '#b0843c', shop: 1 });
  },
});
register({
  id: 'explore', name: 'Exploration Zone', resources: 'Diamonds · Artifacts · Data', color: '#b06bff',
  type: 'creature', biome: 'explore', level: 6, x: 140, y: 137, w: 24, h: 20, base: 'd', rough: 0.3,
  build(cells, features, rand) {
    // bare terrain — only the diamond mines (client-placed) live here
  },
});

// ── BRIDGES ──────────────────────────────────────────────────
export const BRIDGES = [];
const bridgeTiles = new Set();      // open, walkable bridge tiles
function tkey(x, y) { return `${x},${y}`; }

function hBridge(id, label, x0, x1, yc, locked) {
  const tiles = []; const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  for (let x = lo; x <= hi; x++) for (let w = -1; w <= 0; w++) tiles.push([x, yc + w]);
  push(id, label, tiles, [x0, yc], 'h', locked);
}
function vBridge(id, label, y0, y1, xc, locked) {
  const tiles = []; const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
  for (let y = lo; y <= hi; y++) for (let w = -1; w <= 0; w++) tiles.push([xc + w, y]);
  push(id, label, tiles, [xc, y0], 'v', locked);
}
function dBridge(id, label, x0, y0, x1, y1, locked) {
  const tiles = [], steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) { const x = Math.round(x0 + (x1 - x0) * i / steps), y = Math.round(y0 + (y1 - y0) * i / steps); for (let w = 0; w <= 1; w++) tiles.push([x, y + w]); }
  push(id, label, tiles, [x0, y0], 'd', locked);
}
function push(id, label, tiles, gate, dir, locked) {
  BRIDGES.push({ id, label, dir, locked: !!locked, tiles, gate });
  if (!locked) for (const [x, y] of tiles) bridgeTiles.add(tkey(x, y));
}
// island containing a world tile
function islandContaining(tx, ty) { return ISLANDS.find(i => tx >= i.x && tx < i.x + i.w && ty >= i.y && ty < i.y + i.h) || null; }
function setCellWorld(tx, ty, ch) { const i = islandContaining(tx, ty); if (!i) return; const lx = tx - i.x, ly = ty - i.y, row = i.cells[ly].split(''); if (row[lx] === '.') row[lx] = ch; i.cells[ly] = row.join(''); }
// carve a guaranteed land corridor from a bridge end to that island's centre
function carveCorridor(tx, ty) {
  const i = islandContaining(tx, ty); if (!i) return;
  const cx = i.x + (i.w >> 1), cy = i.y + (i.h >> 1), steps = Math.max(Math.abs(cx - tx), Math.abs(cy - ty)) || 1;
  for (let s = 0; s <= steps; s++) { const x = Math.round(tx + (cx - tx) * s / steps), y = Math.round(ty + (cy - ty) * s / steps); setCellWorld(x, y, i.base); setCellWorld(x + 1, y, i.base); }
}

const hub = islandById('hub'); const HC = { x: hub.x + hub.w / 2 | 0, y: hub.y + hub.h / 2 | 0 };
const mining = islandById('mining'), agri = islandById('agri'), build = islandById('build');
// (bridges removed — travel between islands is by spaceship across the void)

// ── deterministic placement RNG (seeded → identical layout on every restart) ──
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const place = mulberry32(0x5EED1A);
// true if a w×h box at (x,y) comes within margin m of ANY already-registered island
function overlaps(x, y, w, h, m) { return ISLANDS.some(i => !(x > i.x + i.w + m || x + w < i.x - m || y > i.y + i.h + m || y + h < i.y - m)); }

// ── 5 colonisable planets (locked) — placed FIRST and kept clear of the city & zones ──
const PLANET_NAMES = ['Planet Vesk', 'Planet Orun', 'Planet Tahl', 'Planet Zeph', 'Planet Myra'];
for (let i = 0; i < 5; i++) {
  const edge = i % 4, r = 16 + Math.floor(place() * 8);
  let x = 4, y = 4, guard = 0;
  do {
    if (edge === 0) { x = 6 + place() * (GRID_W - 40); y = 4; }
    else if (edge === 1) { x = GRID_W - r - 6; y = 6 + place() * (GRID_H - 40); }
    else if (edge === 2) { x = 6 + place() * (GRID_W - 40); y = GRID_H - r - 6; }
    else { x = 4; y = 6 + place() * (GRID_H - 40); }
    x = Math.round(x); y = Math.round(y);
  } while (overlaps(x, y, r, r, 4) && guard++ < 80);
  register({ id: 'planet-' + i, name: PLANET_NAMES[i], type: 'planet', locked: true, color: '#5a6070', x, y, w: r, h: r, base: 'r', rough: 0.18, build() {} });
}

// ── small satellite islands around the big zones — never touch anything ──
let smallSeq = 1;
function addSmallIslands(parent, n) {
  for (let i = 0; i < n; i++) {
    let x = 2, y = 2, w = 0, h = 0, ok = false;
    for (let tryN = 0; tryN < 40 && !ok; tryN++) {
      const ang = (i / n) * Math.PI * 2 + place() * 0.9 + tryN * 0.5;
      const d = Math.max(parent.w, parent.h) * 0.75 + 10 + place() * 16 + tryN * 1.5;
      w = 12 + Math.floor(place() * 11); h = 5 + Math.floor(place() * 4);
      const cx = parent.x + parent.w / 2 + Math.cos(ang) * d;
      const cy = parent.y + parent.h / 2 + Math.sin(ang) * d * 0.65;
      x = Math.max(2, Math.min(GRID_W - w - 2, Math.round(cx - w / 2)));
      y = Math.max(2, Math.min(GRID_H - h - 2, Math.round(cy - h / 2)));
      if (!overlaps(x, y, w, h, 3)) ok = true;
    }
    if (!ok) continue;                                   // couldn't fit without touching → skip
    register({
      id: 'small-' + smallSeq++, name: '', type: 'small', biome: parent.biome, color: parent.color,
      level: parent.level, x, y, w, h, base: parent.base, rough: 0.4,
      build(cells, features, rand) {
        if (parent.biome === 'agri') scatter(cells, features, 'tree', 3, ['g'], rand);
        else scatter(cells, features, 'rock', 3, [parent.base], rand);
      },
    });
  }
}
addSmallIslands(agri, 5);
addSmallIslands(mining, 5);
addSmallIslands(build, 5);

// ── extra scattered small islands — clear of everything (city, zones, planets) ──
function addRandomSmalls(n) {
  const opts = [['g', 'agri', '#5fd16a'], ['r', 'mining', '#ffcf4d'], ['d', 'build', '#ff9b3d'], ['n', 'mining', '#9fd8ff']];
  let placed = 0, guard = 0;
  while (placed < n && guard++ < n * 40) {
    const w = 9 + Math.floor(place() * 14), h = 5 + Math.floor(place() * 4);
    const x = 4 + Math.floor(place() * (GRID_W - w - 8)), y = 4 + Math.floor(place() * (GRID_H - h - 8));
    if (overlaps(x, y, w, h, 4)) continue;
    const [base, biome, color] = opts[Math.floor(place() * opts.length)];
    register({
      id: 'small-' + smallSeq++, name: '', type: 'small', biome, color, level: 1 + Math.floor(place() * 3), x, y, w, h, base, rough: 0.42,
      build(cells, features, rand) { if (base === 'g') scatter(cells, features, 'tree', 2 + Math.floor(rand() * 3), ['g'], rand); else scatter(cells, features, 'rock', 2, [base], rand); },
    });
    placed++;
  }
}
addRandomSmalls(30);

// fountain / spawn at the city plaza
const fpx = hub.features.find(f => f.t === 'fountain');
export const FOUNTAIN = { x: hub.x + fpx.tx, y: hub.y + fpx.ty };
export const SPAWN_PX = { x: (FOUNTAIN.x + 0.5) * TILE, y: (FOUNTAIN.y + 3) * TILE };
// arena geometry (pixels) for teleport + bounds
const _ar = islandById('arena');
const _acx = (_ar.x + _ar.w / 2) * TILE, _acy = (_ar.y + _ar.h / 2) * TILE;
const _ahw = (_ar.w * TILE) / 2 * 0.7, _ahh = (_ar.h * TILE) / 2 * 0.7;   // playable rectangle (factor 0.7)
export const ARENA = { x0: _ar.x * TILE, y0: _ar.y * TILE, x1: (_ar.x + _ar.w) * TILE, y1: (_ar.y + _ar.h) * TILE,
  cx: _acx, cy: _acy, hw: _ahw, hh: _ahh,
  spawn: { x: _acx, y: _acy + _ahh * 0.7 } };
// keep a point inside the arena's rectangular floor
export function clampArena(x, y) {
  return { x: Math.max(ARENA.cx - ARENA.hw, Math.min(ARENA.cx + ARENA.hw, x)),
           y: Math.max(ARENA.cy - ARENA.hh, Math.min(ARENA.cy + ARENA.hh, y)) };
}
export function randomArenaPoint() { return { x: ARENA.cx + (Math.random() * 2 - 1) * ARENA.hw * 0.85, y: ARENA.cy + (Math.random() * 2 - 1) * ARENA.hh * 0.85 }; }

export function worldDescriptor() {
  return { tile: TILE, gridW: GRID_W, gridH: GRID_H, fountain: FOUNTAIN, spawn: SPAWN_PX,
    islands: ISLANDS.map(i => ({ id: i.id, name: i.name, sub: i.sub, resources: i.resources, color: i.color,
      type: i.type, biome: i.biome, level: i.level, locked: !!i.locked, x: i.x, y: i.y, w: i.w, h: i.h, cells: i.cells, features: i.features })),
    bridges: BRIDGES };
}

export function tileKey(x, y) { return `${x},${y}`; }
export function cellAt(tx, ty) {
  for (const i of ISLANDS) if (tx >= i.x && tx < i.x + i.w && ty >= i.y && ty < i.y + i.h) { const ch = i.cells[ty - i.y][tx - i.x]; if (ch !== '.') return ch; }
  return '.';
}
export function isWalkable(tx, ty) { return isLandCell(cellAt(tx, ty)) || bridgeTiles.has(tkey(tx, ty)); }
export function isAir(tx, ty) { return !isWalkable(tx, ty); }
export function isOnIsland(tx, ty) { return ISLANDS.find(i => tx >= i.x - 1 && tx < i.x + i.w + 1 && ty >= i.y - 1 && ty < i.y + i.h + 1) || (bridgeTiles.has(tkey(tx, ty)) ? true : null); }

export function randomLandPoint(isl) {
  for (let k = 0; k < 250; k++) { const lx = Math.floor(Math.random() * isl.w), ly = Math.floor(Math.random() * isl.h), ch = isl.cells[ly][lx]; if (ch !== '.' && ch !== 'w') return { x: (isl.x + lx + 0.5) * TILE, y: (isl.y + ly + 0.5) * TILE }; }
  return { x: (isl.x + isl.w / 2) * TILE, y: (isl.y + isl.h / 2) * TILE };
}

// ── Persistent state ─────────────────────────────────────────
export const state = { tiles: {}, market: [], profiles: {}, banned: [] };
export function loadState() {
  console.log(`[world] save file → ${SAVE_FILE}`);
  try { if (fs.existsSync(SAVE_FILE)) { const raw = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); state.tiles = raw.tiles || {}; state.market = raw.market || []; state.profiles = raw.profiles || {}; state.banned = raw.banned || []; console.log(`[world] loaded ${Object.keys(state.tiles).length} tiles, ${state.market.length} listings, ${Object.keys(state.profiles).length} profiles, ${state.banned.length} banned`); } }
  catch (e) { console.warn('[world] load failed:', e.message); }
}
let saveTimer = null;
export function saveState() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SAVE_FILE, JSON.stringify({ tiles: state.tiles, market: state.market, profiles: state.profiles, banned: state.banned })); } catch (e) { console.warn('[world] save failed:', e.message); } }, 400); }

// ── Creatures ────────────────────────────────────────────────
export const creatures = new Map();
let creatureSeq = 1;
export const CREATURE_RESPAWN_MS = 20000;
const KINDS = {
  mining:  { kind: 'gargoyle', hp: 45,  dmg: 7,  speed: 1.1, xp: 16, color: '#9aa0b0' },
  hostile: { kind: 'alien',    hp: 120, dmg: 17, speed: 1.5, xp: 55, color: '#b06bff' },
  explore: { kind: 'zombie',   hp: 600, dmg: 51, speed: 6, xp: 80, color: '#5fbf3a' },   // 5× alien HP, 3× alien dmg, faster than players (20Hz × 6 ≈ 120 px/s)
  build:   { kind: 'gargoyle', hp: 60,  dmg: 9,  speed: 1.1, xp: 24, color: '#c79a5a' },
  sheep:   { kind: 'sheep',    hp: 30,  dmg: 4,  speed: 1.0, xp: 10, color: '#eef0f2', passive: true },
};
export function spawnCreatures() {
  // Hostile Zone: TWICE as many aliens, 2× speed, 2× damage, 2× aggro range (no sheep here)
  const hostile = islandById('hostile');
  const alienCount = hostile ? Math.max(3, Math.round((hostile.w * hostile.h) / 80)) * 2 : 16;
  if (hostile) {
    const buffed = { ...KINDS.hostile, speed: KINDS.hostile.speed * 2, dmg: KINDS.hostile.dmg * 2, aggro: 6, roam: true };
    for (let i = 0; i < alienCount; i++) spawnOne(hostile, buffed, hostile.level, 20000);
  }
  // Exploration Zone: as many green zombies as there are aliens — fast roamers, aggressive
  const explore = islandById('explore');
  if (explore) {
    const z = { ...KINDS.explore, aggro: 7, roam: true };
    for (let i = 0; i < alienCount; i++) spawnOne(explore, z, explore.level, 20000);
  }
  // 4 skeletons (gargoyles) on each big Mining & Construction island
  for (const zid of ['mining', 'build']) { const isl = islandById(zid); if (isl) for (let i = 0; i < 4; i++) spawnOne(isl, { ...KINDS[zid], roam: true }, isl.level || 2, 20000); }
  // Agricultural Zone (main island): a flock of passive sheep in random spots
  const agri = islandById('agri');
  if (agri) for (let i = 0; i < 6; i++) spawnOne(agri, KINDS.sheep, 1, 20000);
  // every small satellite island gets one mob (agri islets → a passive sheep), 20s respawn
  for (const isl of ISLANDS) {
    if (isl.type !== 'small') continue;
    spawnOne(isl, isl.biome === 'agri' ? KINDS.sheep : (KINDS[isl.biome] || KINDS.mining), isl.level || 1, 20000);
  }
  console.log(`[world] spawned ${creatures.size} creatures`);
}
function spawnOne(isl, tmpl, level, respawnMs) {
  const id = 'c' + creatureSeq++, p = randomLandPoint(isl);
  creatures.set(id, { id, islandId: isl.id, ...tmpl, level, maxHp: tmpl.hp, hp: tmpl.hp, x: p.x, y: p.y, homeX: p.x, homeY: p.y, target: null, aggressive: false, wanderT: 0, vx: 0, vy: 0, dead: false, respawnAt: 0, respawnMs: respawnMs || 20000 });
}
export function respawnCreature(c) { const isl = islandById(c.islandId), p = randomLandPoint(isl); c.dead = false; c.hp = c.maxHp; c.x = p.x; c.y = p.y; c.homeX = p.x; c.homeY = p.y; c.target = null; c.aggressive = false; }
export function islandBounds(isl) { const m = TILE * 1.5; return { x0: isl.x * TILE - m, y0: isl.y * TILE - m, x1: (isl.x + isl.w) * TILE + m, y1: (isl.y + isl.h) * TILE + m }; }
