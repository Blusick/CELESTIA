// ─────────────────────────────────────────────────────────────
//  Skyland server: static hosting + REST + realtime MMO loop.
// ─────────────────────────────────────────────────────────────
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import { config, publicConfig } from './config.js';
import { verifyPayment } from './solana.js';
import * as W from './world.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── REST ─────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => res.json(publicConfig()));
app.get('/api/world', (_req, res) => res.json(W.worldDescriptor()));

// Solana RPC proxy — the public mainnet RPC blocks browser CORS (403),
// so the client routes JSON-RPC through the server instead.
app.post('/api/rpc', async (req, res) => {
  try {
    const r = await fetch(config.SOLANA_RPC_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    res.set('Content-Type', 'application/json'); res.send(await r.text());
  } catch (e) { res.status(502).json({ error: 'rpc proxy failed: ' + e.message }); }
});

// Verify a territory purchase payment, then grant the tiles.
app.post('/api/buy-territory', async (req, res) => {
  const { signature, wallet, tiles } = req.body || {};
  const texture = ['grass', 'sand', 'construction', 'rock', 'snow'].includes(req.body?.texture) ? req.body.texture : 'grass';
  if (!Array.isArray(tiles) || tiles.length === 0)
    return res.json({ ok: false, error: 'no tiles selected' });

  // Reject tiles that sit on an island or are already owned.
  for (const t of tiles) {
    if (W.isOnIsland(t.x, t.y)) return res.json({ ok: false, error: 'cannot buy island tiles' });
    const ex = W.state.tiles[W.tileKey(t.x, t.y)];
    if (ex && ex.owner && ex.owner !== wallet) return res.json({ ok: false, error: 'a tile is already owned' });
  }

  const total = config.TERRITORY_PRICE_SKY * tiles.length;
  const v = await verifyPayment(signature, total, wallet);
  if (!v.ok) return res.json({ ok: false, error: v.error });

  for (const t of tiles) {
    const k = W.tileKey(t.x, t.y);
    W.state.tiles[k] = { ...(W.state.tiles[k] || {}), owner: wallet, texture };
  }
  W.saveState();
  broadcast({ type: 'tiles', tiles: tiles.map(t => ({ ...t, ...W.state.tiles[W.tileKey(t.x, t.y)] })) });
  res.json({ ok: true, granted: tiles.length, paid: v.amount });
});

// Edit an owned tile (texture / decor / fence / mine).
app.post('/api/edit-tile', (req, res) => {
  const { wallet, x, y, patch } = req.body || {};
  const k = W.tileKey(x, y);
  const tile = W.state.tiles[k];
  if (!tile || tile.owner !== wallet) return res.json({ ok: false, error: 'not your tile' });
  Object.assign(tile, patch || {});
  W.saveState();
  broadcast({ type: 'tiles', tiles: [{ x, y, ...tile }] });
  res.json({ ok: true, tile });
});

// Marketplace: create a listing (resources for $CELESTIA).
app.post('/api/market/list', (req, res) => {
  const { wallet, resource, qty, price } = req.body || {};
  if (!['iron', 'meat', 'wood', 'plank', 'ingot'].includes(resource)) return res.json({ ok: false, error: 'bad resource' });
  if (!(qty > 0) || !(price > 0)) return res.json({ ok: false, error: 'qty/price must be > 0' });
  const listing = { id: 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e4),
    seller: wallet, resource, qty: Math.floor(qty), price: Number(price), ts: Date.now() };
  W.state.market.unshift(listing);
  W.saveState();
  broadcast({ type: 'market', market: W.state.market });
  res.json({ ok: true, listing });
});

app.get('/api/market', (_req, res) => res.json({ market: W.state.market }));

// Marketplace: buyer paid the seller (+fee to treasury) on-chain → settle.
app.post('/api/market/buy', async (req, res) => {
  const { signature, wallet, listingId } = req.body || {};
  const idx = W.state.market.findIndex(l => l.id === listingId);
  if (idx < 0) return res.json({ ok: false, error: 'listing gone' });
  const l = W.state.market[idx];
  const v = await verifyPayment(signature, l.price * l.qty * config.MARKETPLACE_FEE, wallet);
  if (!v.ok) return res.json({ ok: false, error: v.error });
  W.state.market.splice(idx, 1);
  W.saveState();
  broadcast({ type: 'market', market: W.state.market });
  res.json({ ok: true, bought: l });
});

// ── WebSocket realtime ───────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const players = new Map(); // ws -> player

let pidSeq = 1;
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) { const s = JSON.stringify(msg); for (const ws of wss.clients) if (ws !== except && ws.readyState === 1) ws.send(s); }

const ipSessions = new Map();   // ip -> ws (one session per IP)
const IP_SECURITY = false;      // TESTING: allow multiple sessions per IP

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown').trim();
  if (IP_SECURITY) {
    const prev = ipSessions.get(ip);
    if (prev && prev !== ws && prev.readyState === 1) { try { send(prev, { type: 'kicked', reason: 'another session opened from your network' }); prev.close(); } catch {} }
    ipSessions.set(ip, ws);
  }

  const id = 'p' + pidSeq++;
  const p = {
    id, ip, name: 'Pilot' + id.slice(1), wallet: null,
    x: W.SPAWN_PX.x, y: W.SPAWN_PX.y, dir: 'down', moving: false,
    level: 1, xp: 0, hp: 100, maxHp: 100, inAir: false, lastChat: 0, inArena: false, arenaAlive: false,
    stats: { health: 0, strength: 0, agility: 0, resistance: 0 }, statPoints: 0,
    appearance: { skin: '#f0c080', shirt: '#7c8a4a', pants: '#2b3a63', shoes: '#5a3a22', hat: 'none', hatColor: '#ff5577', glasses: false },
    ship: 'scout',
  };
  players.set(ws, p);

  send(ws, { type: 'init', id, you: p, world: W.worldDescriptor(),
    tiles: W.state.tiles, market: W.state.market,
    players: [...players.values()].filter(x => x.id !== id),
    creatures: [...W.creatures.values()], online: players.size, arena: arenaPub() });
  broadcast({ type: 'join', player: pub(p), online: players.size }, ws);

  ws.on('message', (raw) => {
    if (raw.length > 4096) return;                 // reject oversized frames
    let m; try { m = JSON.parse(raw); } catch { return; }
    handle(ws, p, m);
  });
  ws.on('close', () => { saveProfile(p); players.delete(ws); arena.parts.delete(ws); if (ipSessions.get(ip) === ws) ipSessions.delete(ip); broadcast({ type: 'leave', id, online: players.size }); });
});

function pub(p) {
  return { id: p.id, name: p.name, wallet: p.wallet, x: p.x, y: p.y, dir: p.dir,
    moving: p.moving, level: p.level, hp: p.hp, maxHp: p.maxHp, inAir: p.inAir,
    appearance: p.appearance, ship: p.ship, inArena: p.inArena, gear: p.gear || null };
}
function resist(p, dmg) { return dmg * 100 / (100 + (p.res != null ? p.res : (p.stats?.resistance || 0))); }   // Resistance (incl. equipped shield) mitigates incoming damage
// creature equipment drops: 10% chance per slot; bonus by creature (sheep +2, skeleton +4, alien +10)
const DROP_SRC = { sheep: 'sheep', gargoyle: 'skeleton', alien: 'alien' };
const DROP_BONUS = { sheep: 2, skeleton: 4, alien: 10 };
function rollDrops(kind) {
  const src = DROP_SRC[kind] || 'skeleton', bonus = DROP_BONUS[src] || 2, out = [];
  for (const slot of ['shoes', 'bottom', 'top', 'shield']) if (Math.random() < 0.10) out.push({ slot, src, bonus });
  return out;
}
function saveProfile(p) {                                            // persist a wallet's progress to disk
  if (!p.wallet) return;
  W.state.profiles[p.wallet] = { name: p.name, appearance: p.appearance, ship: p.ship,
    level: p.level, xp: p.xp, maxHp: p.maxHp, stats: p.stats || null, statPoints: p.statPoints || 0,
    inv: p.inv || null, bank: p.bank || null, equip: p.equip || null, ts: Date.now() };
  W.saveState();
}

function handle(ws, p, m) {
  switch (m.type) {
    case 'move': {
      p.x = clamp(m.x, 0, W.GRID_W * W.TILE);
      p.y = clamp(m.y, 0, W.GRID_H * W.TILE);
      if (p.inArena) { const c = W.clampArena(p.x, p.y); p.x = c.x; p.y = c.y; }  // locked inside the round arena floor
      p.dir = m.dir || p.dir; p.moving = !!m.moving;
      p.inAir = W.isAir(Math.floor(p.x / W.TILE), Math.floor(p.y / W.TILE));
      break;
    }
    case 'profile': {
      if (typeof m.name === 'string') p.name = m.name.slice(0, 16);
      if (m.appearance) p.appearance = { ...p.appearance, ...m.appearance };
      if (m.gear) p.gear = m.gear;                                   // worn equipment (for visible armour)
      if (m.ship) p.ship = m.ship;
      if (typeof m.wallet === 'string' && m.wallet) {
        p.wallet = m.wallet;
        const sv = W.state.profiles[p.wallet];                       // restore a saved profile
        if (sv) {
          if (typeof sv.level === 'number') p.level = sv.level;
          if (typeof sv.xp === 'number') p.xp = sv.xp;
          if (typeof sv.maxHp === 'number') { p.maxHp = sv.maxHp; p.hp = sv.maxHp; }
          if (sv.appearance) p.appearance = sv.appearance;
          if (sv.ship) p.ship = sv.ship;
          if (sv.name) p.name = sv.name;
          if (sv.inv) p.inv = sv.inv; if (sv.bank) p.bank = sv.bank; if (sv.equip) p.equip = sv.equip;
          if (sv.stats) p.stats = sv.stats; if (typeof sv.statPoints === 'number') p.statPoints = sv.statPoints;
          send(ws, { type: 'profileLoad', profile: sv, level: p.level, xp: p.xp, xpNeed: xpForLevel(p.level), hp: p.hp, maxHp: p.maxHp });
        }
      }
      broadcast({ type: 'profile', id: p.id, player: pub(p) });
      break;
    }
    case 'sync': {                                                   // client persists inventory/bank/equipment/progress
      if (m.inv) p.inv = m.inv;
      if (m.bank) p.bank = m.bank;
      if (m.equip) p.equip = m.equip;
      if (typeof m.level === 'number') p.level = m.level;
      if (typeof m.xp === 'number') p.xp = m.xp;
      if (typeof m.maxHp === 'number') p.maxHp = m.maxHp;
      if (m.stats) p.stats = m.stats;
      if (typeof m.statPoints === 'number') p.statPoints = m.statPoints;
      if (typeof m.res === 'number') p.res = m.res;
      saveProfile(p);
      break;
    }
    case 'whisper': {                                               // private message: /w Player: text
      const to = String(m.to || '').toLowerCase().trim();
      const text = String(m.text || '').slice(0, 200);
      if (!to || !text.trim()) break;
      const ent = [...players.entries()].find(([, pp]) => pp.name.toLowerCase() === to);
      if (!ent) { send(ws, { type: 'whisperFail', to: m.to }); break; }
      send(ent[0], { type: 'whisper', from: p.name, text });
      break;
    }
    case 'chat': {
      const now = Date.now();
      if (now - p.lastChat < 10000) { send(ws, { type: 'chat', id: 'sys', name: '', text: `Please wait ${Math.ceil((10000 - (now - p.lastChat)) / 1000)}s before sending another message.`, sys: true }); break; }
      const text = String(m.text || '').slice(0, 200);
      if (text.trim()) { p.lastChat = now; broadcast({ type: 'chat', id: p.id, name: p.name, text }); }
      break;
    }
    case 'attackCreature': {
      const c = W.creatures.get(m.cid);
      if (!c || c.dead) return;
      if (dist(p, c) > 64) return;
      c.hp -= m.dmg || 8; c.target = p.id; c.aggressive = true;   // provoked → it fights back
      if (c.hp <= 0) {
        c.dead = true; c.respawnAt = Date.now() + (c.respawnMs || W.CREATURE_RESPAWN_MS);
        p.xp += c.xp;
        const need = xpForLevel(p.level);
        if (p.xp >= need) { p.xp -= need; p.level++; p.hp = p.maxHp; }   // maxHp now comes from Health points (client)
        const drops = rollDrops(c.kind);                            // 10% per equipment slot
        send(ws, { type: 'kill', cid: c.id, kind: c.kind, xp: c.xp, level: p.level, xpNow: p.xp, xpNeed: xpForLevel(p.level), hp: p.hp, maxHp: p.maxHp, drops });
        saveProfile(p);                                              // persist level/xp gains
        broadcast({ type: 'creatureDead', cid: c.id });
      } else {
        broadcast({ type: 'creatureHp', cid: c.id, hp: c.hp });
      }
      break;
    }
    case 'respawn': { // player chose to revive at fountain
      p.hp = p.maxHp; p.x = W.SPAWN_PX.x; p.y = W.SPAWN_PX.y;
      send(ws, { type: 'revived', x: p.x, y: p.y, hp: p.hp });
      break;
    }
    case 'enterArena': { // Guardian let the player in (client already paid the entry items)
      if (arena.phase !== 'waiting') { send(ws, { type: 'arenaDenied', reason: 'A battle is already underway — wait for the next round.' }); break; }
      if (p.inArena) break;
      p.inArena = true; p.arenaAlive = false; arena.parts.add(ws);
      const sp = W.ARENA.spawn; p.x = sp.x; p.y = sp.y; p.hp = p.maxHp;
      send(ws, { type: 'enteredArena', x: p.x, y: p.y, arena: W.ARENA });
      broadcastArena();
      break;
    }
    case 'attackPlayer': { // PvP, only inside the arena during a battle
      if (arena.phase !== 'battle' || !p.inArena || !p.arenaAlive) break;
      const ent = [...players.entries()].find(([, pp]) => pp.id === m.tid); if (!ent) break;
      const [tws, tp] = ent;
      if (!tp.inArena || !tp.arenaAlive || dist(p, tp) > 70) break;
      tp.hp = Math.max(0, tp.hp - resist(tp, m.dmg || 10));           // mitigated by target's Resistance
      send(tws, { type: 'hurt', hp: tp.hp, by: 'player' });
      if (tp.hp <= 0) { tp.arenaAlive = false; send(tws, { type: 'died' }); broadcast({ type: 'chat', id: 'sys', name: '', text: `${tp.name} was eliminated from the Arena.`, sys: true }); }
      break;
    }
  }
}

// ── Arena: 30-minute Battle Royale cycle ─────────────────────
const ARENA_PERIOD = 5 * 60 * 1000, BATTLE_MS = 90 * 1000;   // battle every 5 minutes
const arena = { phase: 'waiting', nextAt: Date.now() + ARENA_PERIOD, endsAt: 0, winner: null, parts: new Set() };
function arenaPub() { return { phase: arena.phase, remaining: Math.max(0, (arena.phase === 'battle' ? arena.endsAt : arena.nextAt) - Date.now()), winner: arena.winner, count: arena.parts.size }; }
function broadcastArena() { broadcast({ type: 'arena', ...arenaPub() }); }
setInterval(() => {
  const now = Date.now();
  if (arena.phase === 'waiting' && now >= arena.nextAt) {
    const alive = [...arena.parts].filter(ws => players.has(ws) && players.get(ws).inArena);
    if (alive.length >= 1) {
      arena.phase = 'battle'; arena.endsAt = now + BATTLE_MS; arena.winner = null;
      for (const ws of alive) { const p = players.get(ws); p.hp = p.maxHp; p.arenaAlive = true; }
      broadcast({ type: 'chat', id: 'sys', name: '', text: '⚔️ The Arena Battle Royale has begun!', sys: true });
    } else arena.nextAt = now + ARENA_PERIOD;
    broadcastArena();
  } else if (arena.phase === 'battle') {
    const alive = [...arena.parts].filter(ws => players.has(ws) && players.get(ws).arenaAlive && players.get(ws).hp > 0);
    if (alive.length <= 1 || now >= arena.endsAt) {
      let winWs = alive[0];
      if (!winWs) { let best = -1; for (const ws of arena.parts) if (players.has(ws) && players.get(ws).hp > best) { best = players.get(ws).hp; winWs = ws; } }
      const wp = winWs && players.has(winWs) ? players.get(winWs) : null;
      arena.winner = wp ? wp.name : 'No one';
      const waddr = wp && wp.wallet ? wp.wallet : 'guest (no wallet)';
      broadcast({ type: 'chat', id: 'sys', name: '', text: `🏆 Arena champion: ${arena.winner} — wallet ${waddr}`, sys: true });
      for (const ws of arena.parts) if (players.has(ws)) { const p = players.get(ws); p.inArena = false; p.arenaAlive = false; p.x = W.SPAWN_PX.x; p.y = W.SPAWN_PX.y; p.hp = p.maxHp; send(ws, { type: 'revived', x: p.x, y: p.y, hp: p.hp }); }
      arena.parts.clear(); arena.phase = 'waiting'; arena.nextAt = now + ARENA_PERIOD;
      broadcastArena();
    }
  }
}, 1000);
setInterval(broadcastArena, 1000);

// ── lightweight per-tick player state (static data — name/appearance/gear —
//    is sent only on join/profile, not every tick) ──
function pubLite(p) { return { id: p.id, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir, moving: p.moving, inAir: p.inAir, level: p.level, inArena: p.inArena }; }
// area-of-interest: each client only receives entities near it (covers full dezoom)
const VIEW_PX = 64 * W.TILE;
let syncCount = 0;
function sendWorldUpdates() {
  syncCount++;
  const full = (syncCount % 10 === 0);                 // ~once per second: resend idle players to correct any drift
  const plist = [...players.values()];
  for (const p of plist) p._send = full || p.moving || p.moving !== p._sm || Math.abs(p.x - (p._sx || 0)) > 1 || Math.abs(p.y - (p._sy || 0)) > 1;
  const clist = []; for (const c of W.creatures.values()) if (!c.dead) clist.push(c);
  for (const [ws, me] of players) {
    if (ws.readyState !== 1) continue;
    const ps = [];
    for (const p of plist) { if (p.id === me.id || !p._send) continue; if (Math.abs(p.x - me.x) < VIEW_PX && Math.abs(p.y - me.y) < VIEW_PX) ps.push(pubLite(p)); }
    send(ws, { type: 'players', list: ps });
    const cs = [];
    for (const c of clist) { if (Math.abs(c.x - me.x) < VIEW_PX && Math.abs(c.y - me.y) < VIEW_PX) cs.push({ id: c.id, x: Math.round(c.x), y: Math.round(c.y), target: c.target, aggressive: c.aggressive }); }
    if (cs.length) send(ws, { type: 'creatures', list: cs });
  }
  for (const p of plist) { p._sx = p.x; p._sy = p.y; p._sm = p.moving; }
}

// ── Game loop: creature AI + combat on players ───────────────
const TICK = 1000 / 20;
let netTick = 0;
setInterval(() => {
  const now = Date.now();
  for (const c of W.creatures.values()) {
    if (c.dead) { if (now >= c.respawnAt) { W.respawnCreature(c); broadcast({ type: 'creatureSpawn', creature: c }); } continue; }
    const isl = W.ISLANDS.find(i => i.id === c.islandId);
    const b = W.islandBounds(isl);

    // Find nearest player inside this island's bounds (passive creatures only chase once provoked).
    let tgt = null, best = 9999;
    if (!c.passive || c.aggressive) for (const p of players.values()) {
      if (p.hp <= 0) continue;
      if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) continue;
      const d = dist(p, c); if (d < (c.aggro || 3) * W.TILE && d < best) { best = d; tgt = p; }
    }

    if (tgt) {
      const ang = Math.atan2(tgt.y - c.y, tgt.x - c.x);
      c.x += Math.cos(ang) * c.speed; c.y += Math.sin(ang) * c.speed;
      if (best < 28 && now - (c.lastHit || 0) > 800) {
        c.lastHit = now; tgt.hp = Math.max(0, tgt.hp - resist(tgt, c.dmg));
        const wsOf = [...players.entries()].find(([, pp]) => pp.id === tgt.id)?.[0];
        if (wsOf) send(wsOf, { type: 'hurt', hp: tgt.hp, by: c.kind });
        if (tgt.hp <= 0 && wsOf) send(wsOf, { type: 'died' });
      }
    } else {
      // wander, leashed to home
      c.wanderT -= TICK;
      if (c.wanderT <= 0) { c.wanderT = 600 + Math.random() * 1200; const a = Math.random() * Math.PI * 2; c.vx = Math.cos(a) * 0.5; c.vy = Math.sin(a) * 0.5; }
      c.x += c.vx; c.y += c.vy;
      const dx = c.x - c.homeX, dy = c.y - c.homeY;
      if (Math.hypot(dx, dy) > 90) { c.x -= c.vx * 2; c.y -= c.vy * 2; c.wanderT = 0; }
    }
    // keep inside leash bounds always
    c.x = clamp(c.x, b.x0, b.x1); c.y = clamp(c.y, b.y0, b.y1);
  }
  netTick++;
  if (netTick % 2 === 0) sendWorldUpdates();   // network at 10 Hz, interest-filtered & compact
}, TICK);

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function xpForLevel(lvl) { return (50 + lvl * 45) * 3; }   // 3× harder to level up

W.loadState();
W.spawnCreatures();
server.listen(config.PORT, () => {
  console.log(`\n  🛸  CELESTIA running → http://localhost:${config.PORT}`);
  console.log(`      $CELESTIA mint:  ${config.SKY_TOKEN_MINT}`);
  console.log(`      treasury:   ${config.TREASURY_WALLET}`);
  console.log(`      cluster:    ${config.SOLANA_CLUSTER}\n`);
});
