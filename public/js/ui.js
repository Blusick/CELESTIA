// ── Modal panels: Inventory, Marketplace, Stats, Army, Shipyard, Build ──
import { G } from './state.js';
import * as S from './sprites.js';
import { api } from './net.js';
import { wallet, payMany } from './wallet.js';

let env = {};
let active = null;
const root = () => document.getElementById('modalRoot');

export function initUI(e) { env = e; }

export function openPanel(name) {
  active = name;
  root().innerHTML = '';
  if (!name) return;
  const back = document.createElement('div'); back.className = 'modal-back';
  back.onclick = ev => { if (ev.target === back) openPanel(null); };
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = PANELS[name] ? PANELS[name]() : '<p>—</p>';
  back.appendChild(m); root().appendChild(back);
  WIRE[name]?.(m);
}
export function refreshActivePanel() { if (active && ['inventory', 'marketplace', 'army', 'shipyard', 'bank', 'alchemist'].includes(active)) openPanel(active); }

function close(label = 'Close') { return `<button class="close" data-x>${label}</button>`; }

const PANELS = {};
const WIRE = {};

// ── ARENA — The Guardian (entry to the Battle Royale) ───────
function fmt(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
PANELS.guardian = () => {
  const a = G.arena || {};
  const status = a.phase === 'battle' ? `<b style="color:var(--red)">Battle in progress — ${fmt(a.remaining || 0)} left</b>`
    : `Next Battle Royale in <b style="color:var(--gold)">${fmt(a.remaining || 0)}</b>${a.winner ? `<br>Last champion: <b style="color:var(--grn)">🏆 ${a.winner}</b>` : ''}`;
  return `${close()}<h2>🛡️ The Guardian</h2>
    <p class="muted"><b>The Guardian:</b> "The Arena rests above the city. None pass without tribute — and once you enter, there is no leaving until the battle is decided."</p>
    <div style="text-align:center;margin:10px 0;font-size:11px">${status}<br><span style="font-size:8px;color:var(--dim)">Fighters waiting: ${a.count || 0}</span></div>
    <div class="grid" style="border:2px solid var(--edge);border-radius:5px;padding:10px;margin-bottom:12px">
      <b style="font-size:9px;color:var(--gold)">Entry tribute</b>
      <div class="row">${[['cookedmeat', 1, 'cooked steak'], ['plank', 3, 'planks'], ['ingot', 3, 'iron ingots']].map(([k, n, lbl]) => `<div class="slot" style="width:auto;padding:6px 10px"><img src="${itemIcon(k)}" style="width:20px;height:20px"> ${n} ${lbl}</div>`).join('')}</div>
    </div>
    <button class="cta sky" id="enterArenaBtn"${a.phase === 'battle' ? ' disabled' : ''}>${a.phase === 'battle' ? 'Battle underway…' : 'Enter the Arena'}</button>`;
};
WIRE.guardian = (m) => { const b = m.querySelector('#enterArenaBtn'); if (b) b.onclick = () => G.actions.enterArena(); };

// ── WORKSHOPS (Lumberjack / Miner / Builder) ────────────────
const WORKSHOPS = {
  lumberjack: { name: 'Lumberjack Workshop', npc: 'Timber Tom', recipes: [{ output: 'plank', cost: { wood: 5 }, ms: 10000 }] },
  miner: { name: 'Miner Workshop', npc: 'Rocky Pete', recipes: [{ output: 'ingot', cost: { iron: 5 }, ms: 10000 }, { output: 'goldingot', cost: { gold: 5 }, ms: 12000 }] },
  builder: { name: 'Builder Workshop', npc: 'Forge Fred', recipes: [{ output: 'sword', cost: { ingot: 5, plank: 5 }, ms: 30000 }, { output: 'goldsword', cost: { goldingot: 5, plank: 5 }, ms: 40000 }] },
};
function workshopPanel(id) {
  const w = WORKSHOPS[id];
  const rows = w.recipes.map((r, i) => {
    const costStr = Object.entries(r.cost).map(([k, n]) => `${n} ${k}`).join(' + ');
    return `<div class="unit"><img class="av" src="${itemIcon(r.output)}" style="background:#10162b;padding:6px">
      <div class="meta"><b>1 ${r.output}</b><p>Cost: ${costStr}<br>Production: ${r.ms / 1000}s each</p></div>
      <button class="cta sky" data-recipe="${i}">Craft</button></div>`;
  }).join('');
  return `${close()}<h2>🛠️ ${w.name}</h2>
    <p class="muted"><b>${w.npc}:</b> "Drop the materials, I'll craft them one by one."</p>
    ${rows}
    <div id="craftProg" style="margin-top:14px"></div>`;
}
for (const id of Object.keys(WORKSHOPS)) { PANELS[id] = () => workshopPanel(id); WIRE[id] = (m) => { m.querySelectorAll('[data-recipe]').forEach(b => b.onclick = () => G.actions.startCraft(id, WORKSHOPS[id].recipes[+b.dataset.recipe])); }; }

// ── FURNACE (no NPC — opens on click): cooks meat ──
const FURNACE_RECIPE = { output: 'cookedmeat', cost: { meat: 10 }, ms: 10000 };
PANELS.furnace = () => `${close()}<h2>🔥 Furnace</h2>
  <p class="muted">Cook raw meat over the fire — one piece at a time.</p>
  <div class="unit"><img class="av" src="${itemIcon('cookedmeat')}" style="background:#10162b;padding:6px">
    <div class="meta"><b>1 Cooked Meat</b><p>Cost: 10 meat<br>Production: 10s · double-click it in your inventory to restore 60 HP</p></div>
    <button class="cta sky" id="cookBtn">Cook</button></div>
  <div id="craftProg" style="margin-top:14px"></div>`;
WIRE.furnace = (m) => { m.querySelector('#cookBtn').onclick = () => G.actions.startCraft('furnace', FURNACE_RECIPE); };
function craftProgHTML() {
  const c = G.craft;
  if (!c) return `<p class="muted">Idle.${G.craftQ?.length ? ' Queued: ' + G.craftQ.length : ''}</p>`;
  const p = Math.max(0, Math.min(1, 1 - (c.endAt - performance.now()) / c.ms));
  return `<div style="font-size:8px;color:var(--dim);margin-bottom:5px">Producing <b style="color:var(--sky)">${c.output}</b>… ${G.craftQ.length ? '(+' + G.craftQ.length + ' queued)' : ''}</div>
    <div class="bar" style="height:16px"><div class="fill" style="width:${(p * 100) | 0}%;background:linear-gradient(var(--sky),#2a6fb0)"></div><span>${Math.ceil((c.endAt - performance.now()) / 1000)}s</span></div>`;
}
setInterval(() => { const el = document.getElementById('craftProg'); if (el) el.innerHTML = craftProgHTML(); }, 150);

// ── BUY TERRITORY — pick a floor texture, then pay ──────────
const TERRAINS = [
  { id: 'grass', name: 'Grass', sw: '#5fae4e' },
  { id: 'sand', name: 'Sand', sw: '#e0c587' },
  { id: 'construction', name: 'Construction', sw: '#c2a877' },
];
export function openBuyPanel(tiles, total) {
  active = 'buy'; root().innerHTML = '';
  const back = document.createElement('div'); back.className = 'modal-back'; back.onclick = e => { if (e.target === back) openPanel(null); };
  const m = document.createElement('div'); m.className = 'modal'; back.appendChild(m); root().appendChild(back);
  let chosen = 'grass';
  m.innerHTML = `${close('Cancel')}<h2>🪙 Buy Territory</h2>
    <p class="muted">${tiles.length} tile(s) · total <b style="color:var(--gold)">${total.toLocaleString()} $Lunaris</b>. Choose the floor before paying:</p>
    <div class="row" id="terr" style="margin:8px 0 14px">
      ${TERRAINS.map((t, i) => `<div class="ptile ${i === 0 ? 'sel' : ''}" data-t="${t.id}"><div class="sw" style="background:${t.sw}"></div>${t.name}</div>`).join('')}
    </div>
    <button class="cta sky" id="payBtn">Pay ${total.toLocaleString()} $Lunaris in Phantom</button>`;
  m.querySelectorAll('[data-t]').forEach(p => p.onclick = () => { chosen = p.dataset.t; m.querySelectorAll('[data-t]').forEach(x => x.classList.remove('sel')); p.classList.add('sel'); });
  m.querySelector('#payBtn').onclick = () => G.payForTerritory(tiles, chosen);
}

// ── INVENTORY ───────────────────────────────────────────────

const ITEM_ICON = {
  iron: c => { c.fillStyle = '#5b6270'; c.beginPath(); c.roundRect(4, 6, 14, 11, 2); c.fill(); c.fillStyle = '#e9eef6'; c.fillRect(7, 9, 3, 2); c.fillRect(12, 12, 2, 2); },
  meat: c => { c.fillStyle = '#d9708a'; c.beginPath(); c.ellipse(11, 12, 7, 5, 0, 0, 7); c.fill(); c.fillStyle = '#f0e6d0'; c.fillRect(3, 10, 4, 2); c.fillRect(16, 12, 4, 2); },
  wood: c => { c.fillStyle = '#6b4a30'; c.fillRect(8, 6, 3, 12); c.fillStyle = '#3f8a39'; c.beginPath(); c.ellipse(10, 7, 7, 5, 0, 0, 7); c.fill(); },
  plank: c => { c.fillStyle = '#c89a5e'; c.beginPath(); c.roundRect(3, 9, 18, 6, 1); c.fill(); c.strokeStyle = '#8a6638'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(8, 9); c.lineTo(8, 15); c.moveTo(14, 9); c.lineTo(14, 15); c.stroke(); },
  ingot: c => { c.fillStyle = '#aab2c4'; c.beginPath(); c.moveTo(5, 16); c.lineTo(20, 16); c.lineTo(17, 9); c.lineTo(8, 9); c.closePath(); c.fill(); c.fillStyle = '#e9eef6'; c.fillRect(9, 10, 7, 2); },
  sword: c => { c.strokeStyle = '#d6dae0'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(6, 18); c.lineTo(18, 5); c.stroke(); c.strokeStyle = '#7e1d24'; c.lineWidth = 2; c.beginPath(); c.moveTo(4, 20); c.lineTo(9, 15); c.stroke(); c.fillStyle = '#8a4fd0'; c.beginPath(); c.arc(4, 20, 1.6, 0, 7); c.fill(); },
  gold: c => { c.fillStyle = '#5b6270'; c.beginPath(); c.roundRect(4, 6, 14, 11, 2); c.fill(); c.fillStyle = '#ffd34d'; c.fillRect(7, 9, 3, 2); c.fillRect(12, 12, 2, 2); c.fillStyle = '#fff3b0'; c.fillRect(7, 9, 2, 1); },
  goldingot: c => { c.fillStyle = '#e0b542'; c.beginPath(); c.moveTo(5, 16); c.lineTo(20, 16); c.lineTo(17, 9); c.lineTo(8, 9); c.closePath(); c.fill(); c.fillStyle = '#fff3b0'; c.fillRect(9, 10, 7, 2); },
  goldsword: c => { c.strokeStyle = '#ffd34d'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(6, 18); c.lineTo(18, 5); c.stroke(); c.strokeStyle = '#7a5a10'; c.lineWidth = 2; c.beginPath(); c.moveTo(4, 20); c.lineTo(9, 15); c.stroke(); c.fillStyle = '#fff3b0'; c.beginPath(); c.arc(4, 20, 1.6, 0, 7); c.fill(); },
  cookedmeat: c => { c.fillStyle = '#9a5a32'; c.beginPath(); c.ellipse(11, 11, 7, 5.5, 0, 0, 7); c.fill(); c.fillStyle = '#7a3f22'; c.beginPath(); c.ellipse(11, 12.5, 6, 3.5, 0, 0, 7); c.fill(); c.strokeStyle = '#f0e6d0'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(15, 13); c.lineTo(20, 16); c.stroke(); c.fillStyle = '#ffcaa0'; c.fillRect(6, 8, 3, 2); },
};
function itemIcon(kind) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 22; const c = cv.getContext('2d');
  (ITEM_ICON[kind] || ITEM_ICON.iron)(c); return cv.toDataURL();
}
// equip slots + which item kinds go where; armour slots hold a gear object, weapon holds a kind string
const EQUIP_SLOTS = [['top', 'Top'], ['bottom', 'Bottom'], ['weapon', 'Weapon'], ['shield', 'Shield'], ['shoes', 'Shoes']];
const EQUIP_OF = { sword: 'weapon', goldsword: 'weapon' };
// creature-themed gear icons (faithful palettes per source creature)
const GEAR_PAL = { sheep: { m: '#f3f4f6', d: '#cfd3d8', a: '#6b6f78' }, skeleton: { m: '#e6e9ef', d: '#aab0bd', a: '#3a3f48' }, alien: { m: '#b06bff', d: '#7e3fd0', a: '#c9ff6a' } };
function drawGearIcon(c, slot, src) {
  const p = GEAR_PAL[src] || GEAR_PAL.skeleton;
  if (slot === 'top') { c.fillStyle = p.m; c.beginPath(); c.moveTo(5, 7); c.lineTo(9, 5); c.lineTo(13, 5); c.lineTo(17, 7); c.lineTo(15, 10); c.lineTo(15, 18); c.lineTo(7, 18); c.lineTo(7, 10); c.closePath(); c.fill(); c.fillStyle = p.d; c.fillRect(7, 15, 8, 3); c.fillStyle = p.a; c.fillRect(10, 6, 2, 11); }
  else if (slot === 'bottom') { c.fillStyle = p.m; c.fillRect(6, 6, 10, 4); c.fillRect(6, 6, 4, 12); c.fillRect(12, 6, 4, 12); c.fillStyle = p.d; c.fillRect(6, 15, 4, 3); c.fillRect(12, 15, 4, 3); c.fillStyle = p.a; c.fillRect(10, 7, 2, 10); }
  else if (slot === 'shoes') { c.fillStyle = p.m; c.fillRect(4, 9, 6, 5); c.fillRect(12, 9, 6, 5); c.fillStyle = p.d; c.fillRect(3, 14, 8, 3); c.fillRect(11, 14, 8, 3); c.fillStyle = p.a; c.fillRect(5, 10, 4, 2); c.fillRect(13, 10, 4, 2); }
  else { c.fillStyle = p.d; c.beginPath(); c.moveTo(11, 3); c.lineTo(18, 6); c.lineTo(16, 15); c.lineTo(11, 19); c.lineTo(6, 15); c.lineTo(4, 6); c.closePath(); c.fill(); c.fillStyle = p.m; c.beginPath(); c.moveTo(11, 6); c.lineTo(15, 8); c.lineTo(14, 14); c.lineTo(11, 16); c.lineTo(8, 14); c.lineTo(7, 8); c.closePath(); c.fill(); c.fillStyle = p.a; c.fillRect(10, 8, 2, 6); c.fillRect(8, 10, 6, 2); }
}
function gearIconURL(it) { const cv = document.createElement('canvas'); cv.width = cv.height = 22; drawGearIcon(cv.getContext('2d'), it.slot, it.src); return cv.toDataURL(); }
function slotIconURL(v) { return (v && typeof v === 'object') ? gearIconURL(v) : itemIcon(v); }
// each armour slot maps to a stat + a display noun, e.g. sheep shoes = "Sheep Boots (+2 Agility)"
const SLOT_STAT = { top: 'Strength', bottom: 'Health', shoes: 'Agility', shield: 'Resistance' };
const SLOT_NOUN = { top: 'Top', bottom: 'Bottom', shoes: 'Boots', shield: 'Shield' };
const capw = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const gearName = it => `${capw(it.src)} ${SLOT_NOUN[it.slot] || it.slot}`;
const gearStat = it => `+${it.bonus} ${SLOT_STAT[it.slot] || ''}`;
function eqSlotHTML([key, label]) {
  const v = G.equip?.[key];
  const title = (v && typeof v === 'object') ? `${gearName(v)} (${gearStat(v)})` : label;
  const inner = v ? `<img src="${slotIconURL(v)}" style="width:28px;height:28px;image-rendering:auto">` : '<span class="eqx">+</span>';
  return `<div class="slot eqslot${v ? ' filled' : ''}${key === 'shoes' ? ' eqslot-wide' : ''}" data-eslot="${key}"${v ? ' draggable="true"' : ''} title="${title}"><span class="eqlab">${label}</span>${inner}</div>`;
}
PANELS.inventory = () => {
  const resAll = [['iron', G.inv.iron], ['meat', G.inv.meat], ['wood', G.inv.wood], ['plank', G.inv.plank], ['ingot', G.inv.ingot], ['gold', G.inv.gold], ['goldingot', G.inv.goldingot], ['cookedmeat', G.inv.cookedmeat], ['sword', G.inv.sword], ['goldsword', G.inv.goldsword]];
  const res = resAll.filter(([k, v]) => (v || 0) >= 1);                 // only owned resources
  const used = G.actions.invCount();
  const slots = res.map(([k, v]) => {
    const eq = EQUIP_OF[k], consume = k === 'cookedmeat', label = k === 'cookedmeat' ? 'cooked' : k;
    return `<div class="slot${eq ? ' equippable' : ''}${consume ? ' consumable' : ''}" data-item="${k}"${eq ? ' draggable="true"' : ''}${consume ? ` data-consume="${k}"` : ''}><img src="${itemIcon(k)}" style="width:26px;height:26px;image-rendering:auto"><span style="font-size:11px;font-weight:700">${label}</span><b>${v}</b></div>`;
  }).join('');
  // stack identical gear (same creature + slot) into one cell with a count
  const groups = {};
  for (const it of (G.inv.gear || [])) { const key = it.slot + '|' + it.src + '|' + it.bonus; (groups[key] ||= []).push(it); }
  const gear = Object.values(groups).map(arr => { const it = arr[0], n = arr.length;
    return `<div class="slot gearitem" data-gear="${it.id}" draggable="true" title="${gearName(it)} (${gearStat(it)})"><img src="${gearIconURL(it)}" style="width:24px;height:24px;image-rendering:auto"><span style="font-size:9px;font-weight:700;text-align:center;line-height:1.1">${gearName(it)}<br><span style="color:var(--gold)">${gearStat(it)}</span></span>${n > 1 ? `<b>${n}</b>` : ''}</div>`;
  }).join('');
  const count = res.length + Object.keys(groups).length;
  const pad = Array.from({ length: Math.max(0, 24 - count) }, () => '<div class="slot"></div>').join('');
  return `${close()}<h2>🎒 Inventory <span style="font-size:8px;color:var(--dim)">${used} / ${G.invMax}</span></h2>
    <div class="row" style="align-items:flex-start;gap:16px">
      <div style="text-align:center">
        <canvas id="doll" width="104" height="132" style="image-rendering:pixelated;background:#10162b;border:3px solid var(--edge);border-radius:6px"></canvas>
        <div class="equips">${EQUIP_SLOTS.map(eqSlotHTML).join('')}</div>
        <div class="stats" style="width:150px;text-align:left">
          <div class="statshead">Stat points: <b style="color:var(--gold)">${G.statPoints || 0}</b></div>
          ${[['health', 'Health'], ['strength', 'Strength'], ['agility', 'Agility'], ['resistance', 'Resistance']].map(([k, l]) =>
            `<div class="statrow"><span style="flex:1">${l}</span><b>${G.stats?.[k] || 0}</b><button class="statplus" data-stat="${k}"${(G.statPoints || 0) > 0 ? '' : ' disabled'}>+</button></div>`).join('')}
          <p class="muted" style="margin-top:6px">+5 points per level. Health +1 HP · Strength +1 dmg/2 · Agility +1 speed/2 · Resistance reduces damage.</p>
        </div>
      </div>
      <div style="flex:1">
        <div class="inv">${slots}${gear}${pad}</div>
        <p class="muted">Double-click or drag an item onto a slot to equip it. To unequip, double-click the slot or drag it back here. Double-click Cooked Meat to restore 60 HP.</p>
      </div>
    </div>`;
};
WIRE.inventory = (m) => {
  const c = m.querySelector('#doll').getContext('2d');
  const dollGear = { weapon: typeof G.equip.weapon === 'string' ? G.equip.weapon : null };
  for (const s of ['top', 'bottom', 'shoes', 'shield']) dollGear[s] = (G.equip[s] && typeof G.equip[s] === 'object') ? G.equip[s].src : null;
  c.clearRect(0, 0, 104, 132); c.save(); c.scale(2.5, 2.5); S.drawPlayer(c, 21, 40, G.appearance, 'down', 0, false, 'scout', dollGear); c.restore();
  const done = () => { G.actions.applyStats?.(); G.actions.refreshHUD?.(); G.actions.syncProfile?.(); G.actions.sendProfile?.(); openPanel('inventory'); };
  const equipKind = (kind) => {
    const slot = EQUIP_OF[kind]; if (!slot) return env.toast("This item can't be equipped.");
    if ((G.inv[kind] || 0) <= 0) return;
    const cur = G.equip[slot]; if (cur && typeof cur === 'string') G.inv[cur] = (G.inv[cur] || 0) + 1; else if (cur) (G.inv.gear ||= []).push(cur);
    G.inv[kind]--; G.equip[slot] = kind; done();
  };
  const equipGear = (id) => {
    const gi = (G.inv.gear || []).findIndex(g => g.id === id); if (gi < 0) return;
    const it = G.inv.gear[gi], slot = it.slot, cur = G.equip[slot];
    if (cur && typeof cur === 'object') G.inv.gear.push(cur); else if (cur) G.inv[cur] = (G.inv[cur] || 0) + 1;
    G.inv.gear.splice(gi, 1); G.equip[slot] = it; done();
  };
  const unequip = (slot) => { const cur = G.equip[slot]; if (!cur) return; if (typeof cur === 'string') G.inv[cur] = (G.inv[cur] || 0) + 1; else (G.inv.gear ||= []).push(cur); G.equip[slot] = null; done(); };
  m.querySelectorAll('[data-item].equippable').forEach(el => { const kind = el.dataset.item; el.ondblclick = () => equipKind(kind); el.ondragstart = e => e.dataTransfer.setData('text/kind', kind); });
  m.querySelectorAll('[data-gear]').forEach(el => { const id = el.dataset.gear; el.ondblclick = () => equipGear(id); el.ondragstart = e => e.dataTransfer.setData('text/gear', id); });
  m.querySelectorAll('[data-eslot]').forEach(el => {
    const slot = el.dataset.eslot;
    el.ondblclick = () => unequip(slot);
    el.ondragstart = e => { if (G.equip[slot]) e.dataTransfer.setData('text/uneq', slot); };
    el.ondragover = e => e.preventDefault();
    el.ondrop = e => {
      e.preventDefault();
      const kind = e.dataTransfer.getData('text/kind'), gid = e.dataTransfer.getData('text/gear');
      if (kind && EQUIP_OF[kind] === slot) equipKind(kind);
      else if (gid) { const g = (G.inv.gear || []).find(x => x.id === gid); if (g && g.slot === slot) equipGear(gid); else env.toast("That item doesn't go in this slot."); }
      else env.toast("That item doesn't go in this slot.");
    };
  });
  // drop an equipped slot back onto the inventory grid to unequip it
  const invEl = m.querySelector('.inv');
  if (invEl) {
    invEl.ondragover = e => { if ([...e.dataTransfer.types].includes('text/uneq')) e.preventDefault(); };
    invEl.ondrop = e => { const slot = e.dataTransfer.getData('text/uneq'); if (slot) { e.preventDefault(); unequip(slot); } };
  }
  // consume cooked meat → restore 60 HP
  m.querySelectorAll('[data-consume]').forEach(el => el.ondblclick = () => {
    const k = el.dataset.consume; if ((G.inv[k] || 0) <= 0) return;
    G.inv[k]--; G.actions.heal?.(60); env.toast('+60 HP'); G.actions.syncProfile?.(); openPanel('inventory');
  });
  m.querySelectorAll('.statplus').forEach(b => b.onclick = () => { G.actions.addStatPoint?.(b.dataset.stat); openPanel('inventory'); });
};

// ── SHOPS: full commerce only when standing next to the NPC; otherwise a locator ──
const NPC_LABEL = { bank: ['Banker James', '🏦 Bank'], alchemist: ['Luna the Alchemist', '⚗️ Alchemist'], marketplace: ['Trader Joe', '🛒 Marketplace'], colonise: ['Tom the Colonist', '🪐 Colonise'] };
const nearNpc = (role) => !!G.actions?.nearNpc?.(role);
function locatorPanel(role) {
  const [npc, title] = NPC_LABEL[role];
  return `${close()}<h2>${title}</h2>
    <p class="muted"><b>${npc}:</b> "You're too far, pilot — come find me in the city to trade!"</p>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="cta sky" data-locate="${role}">📍 Go to see ${npc}</button></div>`;
}
function wireLocator(m) { const b = m.querySelector('[data-locate]'); if (b) b.onclick = () => { G.actions.locateNpc?.(b.dataset.locate); openPanel(null); }; }

// ── MARKETPLACE (Trader Joe) ─────────────────────────────────
function marketPanel() {
  const rows = G.market.length ? G.market.map(l => `
    <tr><td>${l.resource}</td><td>${l.qty}</td><td>${l.price} $Lunaris</td><td>${(l.price * l.qty).toLocaleString()}</td>
    <td>${l.seller === wallet.pubkey ? '<i>yours</i>' : `<button class="cta sky" data-buy="${l.id}" style="padding:5px 8px;font-size:7px">Buy</button>`}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No listings yet.</td></tr>';
  return `${close()}<h2>🛒 Marketplace</h2>
    <p class="muted"><b>Trader Joe:</b> "Buy low, sell high, pilot."</p>
    <div class="grid" style="border:2px solid var(--edge);border-radius:5px;padding:10px;margin-bottom:14px">
      <b style="font-size:9px;color:var(--gold)">Sell resources for $Lunaris</b>
      <div class="row">
        <div class="field"><label>Resource</label><select id="mRes"><option>iron</option><option>meat</option><option>wood</option><option>plank</option><option>ingot</option><option>gold</option><option>goldingot</option></select></div>
        <div class="field"><label>Quantity</label><input id="mQty" type="number" min="1" value="10" style="width:80px"></div>
        <div class="field"><label>Price / unit ($Lunaris)</label><input id="mPrice" type="number" min="1" value="100" style="width:90px"></div>
        <button class="cta" id="mList" style="align-self:flex-end">List</button>
      </div>
    </div>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">Buying pays the seller in $Lunaris (+${((wallet.cfg?.marketplaceFee || 0.02) * 100)}% treasury fee) through Phantom.</p>`;
}
function wireMarket(m) {
  m.querySelector('#mList').onclick = async () => {
    const resource = m.querySelector('#mRes').value;
    const qty = +m.querySelector('#mQty').value, price = +m.querySelector('#mPrice').value;
    if ((G.inv[resource] || 0) < qty) return env.toast(`Not enough ${resource}.`);
    if (G.guest || !wallet.connected) return env.toast('Connect Phantom to sell on-chain.');
    G.inv[resource] -= qty; G.actions.refreshHUD(); G.actions.syncProfile?.();
    const r = await api('/api/market/list', { wallet: wallet.pubkey, resource, qty, price });
    if (r.ok) { env.toast('Listed!'); openPanel('marketplace'); } else { G.inv[resource] += qty; env.toast(r.error); }
  };
  m.querySelectorAll('[data-buy]').forEach(b => b.onclick = async () => {
    const l = G.market.find(x => x.id === b.dataset.buy); if (!l) return;
    if (G.guest || !wallet.connected) return env.toast('Connect Phantom to buy.');
    const total = l.price * l.qty, fee = total * (wallet.cfg.marketplaceFee || 0.02);
    env.toast(`Approve ${total.toLocaleString()} $Lunaris in Phantom…`, 6000);
    try {
      const sig = await payMany([{ owner: l.seller, amount: total - fee }, { owner: wallet.cfg.treasury, amount: fee }]);
      const r = await api('/api/market/buy', { signature: sig, wallet: wallet.pubkey, listingId: l.id });
      if (r.ok) { G.inv[l.resource] = (G.inv[l.resource] || 0) + l.qty; G.actions.refreshHUD(); G.actions.syncProfile?.(); env.toast('Purchased!'); env.refreshBalance(); openPanel('marketplace'); }
      else env.toast(r.error);
    } catch (e) { env.toast('Cancelled: ' + (e.message || e)); }
  });
}
function marketSoonPanel() { return `${close()}<h2>🛒 Marketplace</h2><p class="muted" style="text-align:center;margin-top:14px"><b>Trader Joe:</b> "The marketplace will open soon!"</p>`; }
PANELS.marketplace = () => nearNpc('marketplace') ? marketSoonPanel() : locatorPanel('marketplace');
WIRE.marketplace = (m) => { if (!nearNpc('marketplace')) wireLocator(m); };

// ── ARMY ────────────────────────────────────────────────────
const UNITS = {
  Pilot:   { res: 'stone', cost: 20, desc: 'Boosts ship speed & upgrades your aerial transport.' },
  Fighter: { res: 'iron',  cost: 30, desc: 'Hits harder — adds melee damage in combat.' },
  Healer:  { res: 'meat',  cost: 25, desc: 'Regenerates your health over time.' },
  Mage:    { res: 'iron',  cost: 40, desc: 'Channels arcane damage to support the fight.' },
};
PANELS.army = () => `${close()}<h2>⚔️ Army <span style="font-size:8px;color:var(--gold)">— COMING SOON</span></h2><div class="grid">
  ${Object.entries(UNITS).map(([role, u]) => `<div class="unit" style="opacity:.5;filter:grayscale(.8)">
    <img class="av" src="${S.unitAvatarURL(role)}">
    <div class="meta"><b>${role}</b><p>${u.desc}</p></div>
    <button class="cta" disabled style="padding:8px 10px;font-size:8px;background:#39456e;color:#9fb0d8;cursor:not-allowed">🔒 Locked</button>
  </div>`).join('')}
  </div><p class="muted">Recruiting soldiers (Pilot · Fighter · Healer · Mage) is <b>coming soon</b>.</p>`;
WIRE.army = () => {};

// ── SHIPYARD — buy bigger ships with crafted materials ──────
const SHIPS = {
  scout:   { name: 'Scout',       desc: 'Light & nimble starter craft.' },
  cruiser: { name: 'Cruiser',     desc: 'Sleek silver interceptor — faster flight.' },
  frigate: { name: 'Frigate',     desc: 'Navy heavy fighter — strong thrust.' },
  dread:   { name: 'Dreadnought', desc: 'White triple-engine fortress — maximum speed.' },
};
const SHIP_RES = { plank: 'planks', ingot: 'iron ingots', goldingot: 'gold ingots' };
PANELS.shipyard = () => {
  const owned = G.ownedShips || ['scout'];
  return `${close()}<h2>🛸 Shipyard</h2>
  <div class="grid">
  ${Object.entries(SHIPS).map(([k, s]) => {
    const cost = G.SHIP_COST?.[k], have = owned.includes(k), active = G.ship === k;
    const costStr = cost ? Object.entries(cost).map(([r, n]) => `${n} ${SHIP_RES[r] || r}`).join(' + ') : 'free';
    const btn = active ? '<button class="cta" disabled style="padding:8px 10px;font-size:7px;background:#39456e;color:#9fb0d8;cursor:default">Active</button>'
      : have ? `<button class="cta sky" data-use="${k}" style="padding:8px 10px;font-size:7px">Use</button>`
      : `<button class="cta sky" data-buy="${k}" style="padding:8px 10px;font-size:7px">Buy</button>`;
    return `<div class="unit">
      <canvas class="av" width="66" height="46" data-ship="${k}" style="width:66px"></canvas>
      <div class="meta"><b>${s.name.toUpperCase()} ${active ? '<span class="count">(active)</span>' : have ? '<span class="count">(owned)</span>' : ''}</b><p>${s.desc}${cost ? '<br><span style="color:var(--gold)">' + costStr + '</span>' : ''}</p></div>
      ${btn}</div>`;
  }).join('')}</div>
  <p class="muted">Buy bigger ships with crafted materials, then <b>Use</b> to fly them. You board your active ship when you leave an island.</p>`;
};
WIRE.shipyard = (m) => {
  m.querySelectorAll('[data-ship]').forEach(cv => { const c = cv.getContext('2d'); c.save(); c.translate(33, 25); S.drawShip(c, 0, 0, cv.dataset.ship, 'right', 0); c.restore(); });
  m.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { G.actions.buyShip?.(b.dataset.buy); });
  m.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { G.actions.useShip?.(b.dataset.use); });
};

// ── COLONISE — only by visiting Tom the Colonist; shows upcoming planets ────
function planetsPanel() {
  const planets = (G.world?.islands || []).filter(i => i.type === 'planet');
  return `${close()}<h2>🪐 Colonise <span style="font-size:8px;color:var(--gold)">— COMING SOON</span></h2>
  <p class="muted"><b>Tom the Colonist:</b> "These are the worlds we'll claim, pilot. Soon."</p>
  <div class="grid">
  ${planets.map(p => `<div class="unit" style="opacity:.5;filter:grayscale(.7)">
    <div class="av" style="width:38px;height:38px;border-radius:50%;background:radial-gradient(circle at 35% 30%, #6a7180, #2b3140)"></div>
    <div class="meta"><b>${p.name}</b><p>An uncharted world awaiting colonisation.</p></div>
    <button class="cta" disabled style="padding:8px 10px;font-size:8px;background:#39456e;color:#9fb0d8;cursor:not-allowed">🔒 Locked</button>
  </div>`).join('')}
  </div><p class="muted">Claim and develop your own <b>planets</b> in an upcoming update.</p>`;
}
PANELS.colonise = () => nearNpc('colonise') ? planetsPanel() : locatorPanel('colonise');
WIRE.colonise = (m) => { if (!nearNpc('colonise')) wireLocator(m); };

// ── BANK (Banker James) — store up to 1000 items ────────────
const BANK_RES = ['iron', 'meat', 'wood', 'plank', 'ingot', 'gold', 'goldingot'];
function bankCount() { return BANK_RES.reduce((a, k) => a + (G.bank[k] || 0), 0); }
function bankPanel() {
  const b = G.bank, used = bankCount();
  const row = k => `<tr><td>${k}</td><td>${G.inv[k] || 0}</td><td>${b[k] || 0}</td>
    <td><button class="cta sky" data-dep="${k}" style="padding:4px 7px;font-size:7px">Deposit</button>
        <button class="cta" data-wd="${k}" style="padding:4px 7px;font-size:7px">Withdraw</button></td></tr>`;
  return `${close()}<h2>🏦 Bank <span style="font-size:8px;color:var(--dim)">${used} / 1000</span></h2>
    <p class="muted"><b>Banker James:</b> "Store your goods safe with me — up to a thousand."</p>
    <table><thead><tr><th>Item</th><th>On you</th><th>Banked</th><th></th></tr></thead><tbody>
    ${BANK_RES.map(row).join('')}</tbody></table>
    <div class="row" style="margin-top:10px"><button class="cta sky" id="bankAll">Deposit all overflow</button></div>`;
}
function wireBank(m) {
  const refresh = () => { G.actions.refreshHUD(); G.actions.syncProfile?.(); openPanel('bank'); };
  m.querySelectorAll('[data-dep]').forEach(btn => btn.onclick = () => { const k = btn.dataset.dep; const n = Math.min(G.inv[k] || 0, 1000 - bankCount()); if (n <= 0) return env.toast('Nothing to deposit / bank full.'); G.inv[k] -= n; G.bank[k] = (G.bank[k] || 0) + n; refresh(); });
  m.querySelectorAll('[data-wd]').forEach(btn => btn.onclick = () => { const k = btn.dataset.wd; const room = G.invMax - G.actions.invCount(); const n = Math.min(G.bank[k] || 0, room); if (n <= 0) return env.toast('Nothing to withdraw / inventory full.'); G.bank[k] -= n; G.inv[k] = (G.inv[k] || 0) + n; refresh(); });
  m.querySelector('#bankAll').onclick = () => { for (const k of BANK_RES) { const n = Math.min(G.inv[k] || 0, 1000 - bankCount()); if (n > 0) { G.inv[k] -= n; G.bank[k] = (G.bank[k] || 0) + n; } } refresh(); env.toast('Deposited.'); };
}
PANELS.bank = () => nearNpc('bank') ? bankPanel() : locatorPanel('bank');
WIRE.bank = (m) => nearNpc('bank') ? wireBank(m) : wireLocator(m);

// ── ALCHEMIST (Luna) — brew potions ─────────────────────────
const POTIONS = {
  Health:   { cost: { meat: 8 }, color: '#ff5a6e', desc: 'Restores 40 HP instantly.' },
  Strength: { cost: { iron: 8 }, color: '#ffcf4d', desc: 'Boosts your damage (60s).' },
};
function alchemistPanel() {
  return `${close()}<h2>⚗️ Alchemist</h2>
    <p class="muted"><b>Luna the Alchemist:</b> "Fresh brews, straight from the stars."</p>
    <div class="grid">
    ${Object.entries(POTIONS).map(([name, p]) => `<div class="unit">
      <div class="av" style="width:38px;height:46px;display:flex;align-items:center;justify-content:center;background:#10162b;border:2px solid var(--edge);border-radius:4px"><div style="width:14px;height:20px;border-radius:0 0 7px 7px;background:${p.color}"></div></div>
      <div class="meta"><b>${name} Potion</b><p>${p.desc}<br>Cost: ${Object.entries(p.cost).map(([r, n]) => n + ' ' + r).join(', ')}</p></div>
      <button class="cta sky" data-brew="${name}" style="padding:8px 10px;font-size:8px">Brew</button>
    </div>`).join('')}
    </div>`;
}
function wireAlchemist(m) {
  m.querySelectorAll('[data-brew]').forEach(btn => btn.onclick = () => {
    const name = btn.dataset.brew, p = POTIONS[name];
    for (const [r, n] of Object.entries(p.cost)) if ((G.inv[r] || 0) < n) return env.toast(`Need ${n} ${r}.`);
    for (const [r, n] of Object.entries(p.cost)) G.inv[r] -= n;
    if (name === 'Health') { G.actions.heal(40); env.toast('+40 HP'); }
    else { const it = (G.inv.items ||= []).find(i => i.name === name + ' Potion'); if (it) it.qty++; else G.inv.items.push({ name: name + ' Potion', qty: 1 }); env.toast(name + ' Potion brewed!'); }
    G.actions.refreshHUD(); G.actions.syncProfile?.(); openPanel('alchemist');
  });
}
PANELS.alchemist = () => nearNpc('alchemist') ? alchemistPanel() : locatorPanel('alchemist');
WIRE.alchemist = (m) => nearNpc('alchemist') ? wireAlchemist(m) : wireLocator(m);

// close buttons (event delegation)
document.addEventListener('click', e => { if (e.target.matches('[data-x]')) openPanel(null); });
