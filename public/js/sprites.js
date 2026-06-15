// ── Procedural pixel-art (no image assets) — smooth & shaded ──
export const TILE = 32;
function r(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
function rnd(seed) { let s = (seed * 2654435761) >>> 0; return () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff); }

// ── smooth-drawing helpers (anti-aliased vector shapes) ─────
function ell(ctx, cx, cy, rx, ry, c) { if (c) ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.fill(); }
function rr(ctx, x, y, w, h, rad, c) { if (c) ctx.fillStyle = c; const r = Math.min(rad, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill(); }
function vgrad(ctx, y0, y1, c0, c1) { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; }
function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); const cl = v => Math.max(0, Math.min(255, v)); return `rgb(${cl((n >> 16) + amt)},${cl(((n >> 8) & 255) + amt)},${cl((n & 255) + amt)})`; }

// per-cell terrain palettes (base, hi, lo, detail)
const PAL = {
  g: ['#5bbb54', '#6fd267', '#479a43', '#3c8a39'],
  s: ['#e8d191', '#f3e0a6', '#d8bd78', '#cdae66'],
  r: ['#8f95a4', '#a3a9b8', '#777d8e', '#666b7a'],
  n: ['#e3f0fb', '#f4fbff', '#cadcec', '#bcd0e2'],
  l: ['#5a241c', '#7a3326', '#3e1812', '#2c110c'],
  p: ['#3c4a6a', '#4f6090', '#2a3550', '#1c2538'],   // tech walkway / avenue
  b: ['#9c6b3f', '#b07d4c', '#7f5531', '#684427'],
  w: ['#2f86d8', '#4aa3ec', '#2168b4', '#19518f'],
  m: ['#33405b', '#45547a', '#212c40', '#161f2e'],   // metal / city floor (see drawCityPanel)
  h: ['#3a2a4d', '#4d3a6e', '#2a1d39', '#1d1428'],   // hostile ground
  d: ['#c7b287', '#d8c79e', '#b09a6f', '#9c875d'],   // dust / desert
};

// ── SEAMLESS terrain ────────────────────────────────────────
// Every decoration is positioned in WORLD space on a deterministic grid and
// only clipped to the current tile, so neighbouring tiles join with NO border.
function hash2(x, y) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return h >>> 0; }
function fr(seed) { let s = (seed ^ 0x9e3779b9) >>> 0; s = Math.imul(s ^ (s >>> 15), 0x85ebca6b) >>> 0; return ((s ^ (s >>> 13)) >>> 0) / 4294967296; }
function leaf(ctx, x, y, ang, len, w, color) {
  const tx = x + Math.cos(ang) * len, ty = y + Math.sin(ang) * len;
  const ax = x + Math.cos(ang + 1.5708) * w, ay = y + Math.sin(ang + 1.5708) * w;
  const bx = x + Math.cos(ang - 1.5708) * w, by = y + Math.sin(ang - 1.5708) * w;
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo((ax + tx) / 2, (ay + ty) / 2, tx, ty);
  ctx.quadraticCurveTo((bx + tx) / 2, (by + ty) / 2, bx, by); ctx.closePath(); ctx.fill();
}

const GREENS = ['#56922f', '#6cab39', '#82c44e', '#9bd65f', '#3f7a28', '#8fce57'];
function paintGrass(ctx, x, y, h) {
  if (fr(h ^ 0xa1) < 0.1) { // pebble
    ell(ctx, x, y + 1, 3.2, 2.1, 'rgba(0,0,0,.2)'); ell(ctx, x, y, 3.1, 2, '#b08a8a'); ell(ctx, x - 0.6, y - 0.6, 1.6, 1, '#cda9a9'); return;
  }
  const dark = fr(h ^ 0xb2) < 0.3, col = dark ? '#2f5e22' : GREENS[fr(h ^ 0xc3) * GREENS.length | 0];
  const blades = 5 + (fr(h ^ 0xd4) * 6 | 0);
  for (let b = 0; b < blades; b++) { const j = fr(h ^ (b * 131 + 7)); leaf(ctx, x, y, -1.5708 + (j - 0.5) * 1.5, 6 + fr(h ^ (b * 17 + 3)) * (dark ? 11 : 9), 1.2 + j * 1.4, col); }
}
function paintDust(ctx, x, y, h) {
  const r1 = fr(h ^ 0x51);
  if (r1 < 0.16) { // sand-stone block
    const s = 8 + fr(h ^ 0x52) * 6, beige = '#e7d6ab', bHi = '#f3e7c4', bSh = '#c9b585';
    rr(ctx, x - s / 2 + 1.5, y - s / 2 + 2.5, s, s, 2, 'rgba(0,0,0,.22)');     // drop shadow
    rr(ctx, x - s / 2, y - s / 2, s, s, 2, beige);
    rr(ctx, x - s / 2, y - s / 2, s, 2, 4 > 0 ? bHi : beige);
    ctx.fillStyle = bHi; ctx.fillRect(x - s / 2, y - s / 2, s, 1.6); ctx.fillRect(x - s / 2, y - s / 2, 1.6, s);
    ctx.fillStyle = bSh; ctx.fillRect(x - s / 2, y + s / 2 - 1.6, s, 1.6); ctx.fillRect(x + s / 2 - 1.6, y - s / 2, 1.6, s);
    ctx.strokeStyle = bSh; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x - s / 2 + 2, y + s / 2 - 3); ctx.lineTo(x + s / 2 - 3, y - s / 2 + 2); ctx.stroke();
  } else if (r1 < 0.46) { // pebble
    const s = 1.6 + fr(h ^ 0x53) * 2; ell(ctx, x, y + s * 0.5, s, s * 0.7, 'rgba(0,0,0,.18)'); ell(ctx, x, y, s, s * 0.8, '#b6a584'); ell(ctx, x - s * 0.3, y - s * 0.3, s * 0.5, s * 0.4, '#cdbf9c');
  } else { ctx.fillStyle = fr(h ^ 0x54) < 0.5 ? '#b09a6f' : '#d8c79e'; ctx.globalAlpha = 0.6; ctx.fillRect(x, y, 1.4, 1.4); ctx.globalAlpha = 1; }
}
function paintRock(ctx, x, y, h) {
  const r1 = fr(h ^ 0x61);
  if (r1 < 0.3) { // raised embossed stud
    const s = 7 + fr(h ^ 0x62) * 5, g0 = '#b9bcc4', gHi = '#d2d5db', gSh = '#8d9099';
    rr(ctx, x - s / 2 + 1.5, y - s / 2 + 2, s, s, 2, 'rgba(0,0,0,.2)');
    rr(ctx, x - s / 2, y - s / 2, s, s, 2, g0);
    ctx.fillStyle = gHi; ctx.fillRect(x - s / 2, y - s / 2, s, 1.6); ctx.fillRect(x - s / 2, y - s / 2, 1.6, s);
    ctx.fillStyle = gSh; ctx.fillRect(x - s / 2, y + s / 2 - 1.6, s, 1.6); ctx.fillRect(x + s / 2 - 1.6, y - s / 2, 1.6, s);
  } else if (r1 < 0.5) { ctx.fillStyle = fr(h ^ 0x63) < 0.5 ? '#80858f' : '#9aa0a9'; ctx.globalAlpha = 0.5; const s = 1.4 + fr(h ^ 0x64) * 2; ctx.fillRect(x, y, s, s); ctx.globalAlpha = 1; }
}
function paintHostile(ctx, x, y, h) {
  const r1 = fr(h ^ 0x71);
  if (r1 < 0.12) { // purple crystal shard cluster
    const purp = ['#7e3fd0', '#9a5cf0', '#c79bff'][fr(h ^ 0x72) * 3 | 0];
    ell(ctx, x, y + 3, 5, 2, 'rgba(0,0,0,.25)');
    for (const [dx, dy, w, hh] of [[-3, 0, 3.5, 11], [1.5, -2, 3.5, 14], [-0.5, 1, 3, 8]]) {
      ctx.fillStyle = purp; ctx.beginPath(); ctx.moveTo(x + dx, y + dy + 3); ctx.lineTo(x + dx - w / 2, y + dy); ctx.lineTo(x + dx, y + dy - hh); ctx.lineTo(x + dx + w / 2, y + dy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d9b8ff'; ctx.globalAlpha = 0.6; ctx.fillRect(x + dx - 0.5, y + dy - hh + 1, 1, hh - 2); ctx.globalAlpha = 1;
    }
  } else if (r1 < 0.38) { const s = 2 + fr(h ^ 0x73) * 2.5; ell(ctx, x, y + s * 0.5, s, s * 0.6, 'rgba(0,0,0,.25)'); ell(ctx, x, y, s, s * 0.75, '#5a3f86'); ell(ctx, x - s * 0.3, y - s * 0.3, s * 0.5, s * 0.4, '#7e5fb0'); }
  else { ctx.strokeStyle = 'rgba(20,12,32,.5)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (fr(h ^ 0x74) * 8 - 4), y + (fr(h ^ 0x75) * 8 - 4)); ctx.stroke(); }
}
function paintSnow(ctx, x, y, h) {
  if (fr(h ^ 0x81) < 0.2) { const s = 2 + fr(h ^ 0x82) * 3; ell(ctx, x, y + 1, s, s * 0.6, 'rgba(150,180,210,.4)'); ell(ctx, x, y, s, s * 0.7, '#f4fbff'); }
  else if (fr(h ^ 0x83) < 0.4) { ctx.fillStyle = '#cadcec'; ctx.globalAlpha = 0.6; ctx.fillRect(x, y, 1.5, 1.5); ctx.globalAlpha = 1; }
}
const BIOME = {
  g: { base: '#6aa53a', tones: ['#578d2b', '#7cba48', '#5f9c33'], step: 11, margin: 18, density: 0.85, paint: paintGrass },
  d: { base: '#cdb98c', tones: ['#bca678', '#dccba0', '#c2ad80'], step: 13, margin: 16, density: 0.85, paint: paintDust },
  r: { base: '#a7abb3', tones: ['#9398a1', '#b8bcc4', '#8f949d'], step: 13, margin: 14, density: 0.7, paint: paintRock },
  h: { base: '#2c2240', tones: ['#241a36', '#3a2b56', '#1f1730'], step: 12, margin: 16, density: 0.8, paint: paintHostile },
  n: { base: '#dce9f4', tones: ['#cadcec', '#eef7ff', '#d2e2f2'], step: 12, margin: 12, density: 0.6, paint: paintSnow },
};
function drawTerrain(ctx, px, py, tx, ty, t, kind) {
  const C = BIOME[kind]; if (!C) return;
  ctx.save(); ctx.beginPath(); ctx.rect(px, py, TILE, TILE); ctx.clip();
  ctx.fillStyle = C.base; ctx.fillRect(px - 1, py - 1, TILE + 2, TILE + 2);
  // low-frequency tonal patches (mottled background)
  const TP = 22, tm = 14;
  for (let gy = Math.floor((py - tm) / TP); gy <= Math.floor((py + TILE + tm) / TP); gy++)
    for (let gx = Math.floor((px - tm) / TP); gx <= Math.floor((px + TILE + tm) / TP); gx++) {
      const hh = hash2(gx + 7, gy + 3), jx = gx * TP + fr(hh) * TP, jy = gy * TP + fr(hh >>> 3) * TP;
      ctx.globalAlpha = 0.5; ell(ctx, jx, jy, 9 + fr(hh >>> 6) * 9, 8 + fr(hh >>> 9) * 8, C.tones[fr(hh >>> 12) * C.tones.length | 0]);
    }
  ctx.globalAlpha = 1;
  // scattered decorations on a world grid
  const S = C.step, em = C.margin;
  for (let gy = Math.floor((py - em) / S); gy <= Math.floor((py + TILE + em) / S); gy++)
    for (let gx = Math.floor((px - em) / S); gx <= Math.floor((px + TILE + em) / S); gx++) {
      const hh = hash2(gx + 211, gy + 97);
      if (fr(hh) > C.density) continue;
      C.paint(ctx, gx * S + fr(hh >>> 4) * S, gy * S + fr(hh >>> 7) * S, hh);
    }
  ctx.restore();
}

// draw one terrain cell. `nb` = neighbour-land bitmask (T,R,B,L) for edge shading.
export function drawCell(ctx, px, py, ch, tx, ty, t, nb = 15) {
  if (ch === '.' ) return;
  const pal = PAL[ch] || PAL.g;
  r(ctx, px, py, TILE, TILE, pal[0]);
  const rand = rnd(tx * 73856 ^ ty * 19349 ^ ch.charCodeAt(0));
  if (ch === 'w') { // animated water
    for (let i = 0; i < 5; i++) {
      const yy = py + 4 + ((i * 7 + (t * 18 + tx * 5)) % TILE);
      r(ctx, px + 2 + ((i * 11 + (t * 9 | 0)) % (TILE - 8)), yy, 7, 2, pal[1]);
    }
    r(ctx, px, py, TILE, 2, pal[3]);
  } else if (ch === 'm' || ch === 'p') {
    drawCityPanel(ctx, px, py, tx, ty, t);     // seamless city floor (avenues share it)
  } else if (BIOME[ch]) {
    drawTerrain(ctx, px, py, tx, ty, t, ch);   // seamless biome terrain (grass/rock/hostile/dust/snow)
  } else {
    // remaining accents (lava, sand, bridge cell)
    for (let i = 0; i < 6; i++) { const x = px + (rand() * TILE | 0), y = py + (rand() * TILE | 0); r(ctx, x, y, 3, 3, pal[1 + (i & 1) * 2 - (i & 1)]); }
    if (ch === 'l') { r(ctx, px + 6, py + 18, 9, 4, '#ff7a38'); r(ctx, px + 18, py + 8, 6, 3, '#ffb15e'); r(ctx, px + 10, py + 10, 3, 3, '#ffd089'); }
    if (ch === 'b') { r(ctx, px, py + 3, TILE, 3, pal[3]); r(ctx, px, py + TILE - 6, TILE, 3, pal[3]); for (let i = 0; i < TILE; i += 6) r(ctx, px + i, py, 2, TILE, pal[2]); }
  }
  // subtle rim only where the tile borders the void (no seams between land tiles)
  if (nb !== 15) {
    const e = 'rgba(0,0,0,.16)';
    if (!(nb & 1)) r(ctx, px, py, TILE, 2, 'rgba(255,255,255,.10)');
    if (!(nb & 4)) r(ctx, px, py + TILE - 3, TILE, 3, e);
    if (!(nb & 2)) r(ctx, px + TILE - 2, py, 2, TILE, e);
    if (!(nb & 8)) r(ctx, px, py, 2, TILE, 'rgba(0,0,0,.08)');
  }
}

// Seamless sci-fi city floor. The whole pattern is keyed to WORLD coords and
// only clipped to the current tile, so adjacent tiles join with no borders.
// One recessed panel spans a 2×2-tile block; a continuous cyan grid runs along
// the block boundaries with dark nodes (and an occasional glow) at intersections.
function drawCityPanel(ctx, px, py, tx, ty, t) {
  const base = '#28354c';
  ctx.save();
  ctx.beginPath(); ctx.rect(px, py, TILE, TILE); ctx.clip();
  ctx.fillStyle = base; ctx.fillRect(px - 1, py - 1, TILE + 2, TILE + 2);

  const P = 2, PS = P * TILE, m = 6, b = 8;
  const bx = Math.floor(tx / P) * P, by = Math.floor(ty / P) * P;
  const X0 = bx * TILE, Y0 = by * TILE;
  const oct = (x, y, w, h, bv) => { ctx.beginPath(); ctx.moveTo(x + bv, y); ctx.lineTo(x + w - bv, y); ctx.lineTo(x + w, y + bv); ctx.lineTo(x + w, y + h - bv); ctx.lineTo(x + w - bv, y + h); ctx.lineTo(x + bv, y + h); ctx.lineTo(x, y + h - bv); ctx.lineTo(x, y + bv); ctx.closePath(); };

  const cxw = X0 + PS / 2, cyw = Y0 + PS / 2;
  // recessed octagonal panel for this 2×2 block (matches the reference floor)
  oct(X0 + m, Y0 + m, PS - 2 * m, PS - 2 * m, b); ctx.fillStyle = '#243353'; ctx.fill();
  // inner ambient-occlusion gradient → recessed 3D depth
  const ao = ctx.createRadialGradient(cxw, cyw - 2, 4, cxw, cyw, PS * 0.62);
  ao.addColorStop(0, 'rgba(54,76,116,.35)'); ao.addColorStop(0.6, 'rgba(30,42,64,0)'); ao.addColorStop(1, 'rgba(4,8,16,.5)');
  oct(X0 + m, Y0 + m, PS - 2 * m, PS - 2 * m, b); ctx.fillStyle = ao; ctx.fill();
  ctx.strokeStyle = 'rgba(140,190,250,.16)'; ctx.lineWidth = 1; oct(X0 + m, Y0 + m, PS - 2 * m, PS - 2 * m, b); ctx.stroke();
  oct(X0 + m + 4, Y0 + m + 4, PS - 2 * m - 8, PS - 2 * m - 8, b - 3); ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1; ctx.stroke();
  // small recessed node in each panel centre (the little dark squares)
  rr(ctx, cxw - 4, cyw - 4, 8, 8, 1.5, '#16203a'); rr(ctx, cxw - 2.5, cyw - 2.5, 5, 5, 1, '#0d1525');

  // ── bright cyan grid on the MAJOR lattice (every 4 tiles) ──
  const MS = 4 * TILE;
  ctx.fillStyle = 'rgba(72,186,238,.55)';
  for (let lx = Math.floor((px - 2) / MS) * MS; lx <= px + TILE + 2; lx += MS) if (lx >= px - 2 && lx <= px + TILE + 2) ctx.fillRect(lx - 1.6, py - 1, 3.2, TILE + 2);
  for (let ly = Math.floor((py - 2) / MS) * MS; ly <= py + TILE + 2; ly += MS) if (ly >= py - 2 && ly <= py + TILE + 2) ctx.fillRect(px - 1, ly - 1.6, TILE + 2, 3.2);

  // ── big cyan-framed junction boxes at major intersections ──
  for (let mx = Math.floor((px - 22) / MS) * MS; mx <= px + TILE + 22; mx += MS)
    for (let my = Math.floor((py - 22) / MS) * MS; my <= py + TILE + 22; my += MS) {
      const nseed = (((mx / TILE) * 131 + (my / TILE) * 977) >>> 0), glow = (nseed % 7 === 0);
      rr(ctx, mx - 19, my - 19, 38, 38, 5, glow ? '#5fe0ff' : '#3fb4e6');   // bright cyan frame
      rr(ctx, mx - 15, my - 15, 30, 30, 3, '#16202f');                       // dark interior
      if (glow) { const p = 0.55 + 0.45 * Math.abs(Math.sin(t * 1.5 + nseed)); ctx.globalAlpha = p; rr(ctx, mx - 8, my - 8, 16, 16, 2, '#6fe6ff'); ctx.globalAlpha = 1; }
      else rr(ctx, mx - 7, my - 7, 14, 14, 2, '#0c1424');
    }
  ctx.restore();
}

// soft rocky underside + glow that animates to feel like the island floats
export function drawIslandUnderside(ctx, px, py, w, h, t, biome) {
  ctx.save();
  // glow
  const grad = ctx.createRadialGradient(px + w / 2, py + h, h * 0.2, px + w / 2, py + h, h * 0.95);
  grad.addColorStop(0, 'rgba(120,180,255,.22)'); grad.addColorStop(1, 'rgba(120,180,255,0)');
  ctx.fillStyle = grad; ctx.fillRect(px - 20, py, w + 40, h + 60);
  // rocky underside hanging below, wavering
  const base = biome === 'lava' ? '#5a2a20' : biome === 'snow' ? '#5a6470' : '#6a5236';
  const dark = biome === 'lava' ? '#3a1812' : biome === 'snow' ? '#3c444e' : '#4d3a25';
  ctx.fillStyle = base;
  ctx.beginPath(); ctx.moveTo(px, py + h - 2);
  const segs = Math.max(4, Math.round(w / 26));
  for (let i = 0; i <= segs; i++) {
    const x = px + (w * i) / segs;
    const drop = 14 + Math.sin(t * 1.4 + i * 0.9) * 4 + (i % 2 ? 8 : 18);
    ctx.lineTo(x, py + h - 2 + drop);
  }
  ctx.lineTo(px + w, py + h - 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.moveTo(px + w * 0.25, py + h);
  ctx.lineTo(px + w * 0.5, py + h + 26 + Math.sin(t * 1.4) * 3); ctx.lineTo(px + w * 0.75, py + h); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ── Fountain ────────────────────────────────────────────────
// ── tiered stone fountain (matches the reference) — bigger than the shop buildings ──
function fountTicks(ctx, cx, cy, rx, ry, col, n) {
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rx * 0.86, cy + Math.sin(a) * ry * 0.86); ctx.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); ctx.stroke(); }
}
function fountSparkle(ctx, cx, cy, rx, ry, t, n) {
  for (let i = 0; i < n; i++) { const a = i * 2.4, r = ((i * 37) % 100) / 100, tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i)); ctx.fillStyle = `rgba(222,246,255,${0.55 * tw})`; ctx.fillRect(cx + Math.cos(a) * rx * 0.72 * r, cy + Math.sin(a) * ry * 0.72 * r, 1.5, 1.5); }
}
function fountJet(ctx, x, baseY, h, w, t, ph) {
  const top = baseY - h;
  const g = ctx.createLinearGradient(0, top, 0, baseY); g.addColorStop(0, 'rgba(236,247,255,.95)'); g.addColorStop(1, 'rgba(150,200,240,.35)');
  ctx.fillStyle = g; ctx.beginPath();
  ctx.moveTo(x - w * 0.32, top); ctx.quadraticCurveTo(x - w * 0.75, baseY - h * 0.45, x - w, baseY);
  ctx.lineTo(x + w, baseY); ctx.quadraticCurveTo(x + w * 0.75, baseY - h * 0.45, x + w * 0.32, top); ctx.closePath(); ctx.fill();
  ell(ctx, x, top + 1, w * 0.5, w * 0.55, 'rgba(240,248,255,.95)');               // rounded crown
  for (let i = 0; i < 4; i++) { const yy = top + ((t * 55 + ph * 40 + i * h / 4) % h); ell(ctx, x + Math.sin(i * 1.7 + t * 2) * w * 0.7, yy, 1.4, 1.9, 'rgba(212,236,255,.8)'); }
  ell(ctx, x, baseY, w * 1.25, w * 0.5, 'rgba(226,243,255,.55)');                 // splash
}
export function drawFountain(ctx, cx, cy, t) {
  ctx.save(); ctx.lineJoin = 'round';
  const stone = '#c7cad1', stoneD = '#9aa0ab', stoneL = '#e3e6ec', seam = 'rgba(92,98,110,.5)';
  const wA = '#4f8a5e', wB = '#74b079';
  ell(ctx, cx, cy + 28, 52, 15, 'rgba(8,12,20,.28)');                              // ground shadow
  ell(ctx, cx, cy + 18, 52, 26, stoneD); ell(ctx, cx, cy + 15, 52, 25, stone);     // base step 1
  ell(ctx, cx, cy + 9, 46, 22, stoneD); ell(ctx, cx, cy + 7, 46, 21, stoneL);      // base step 2
  ell(ctx, cx, cy, 44, 24, stone); ell(ctx, cx, cy - 1.5, 44, 23, stoneL);         // lower basin rim
  fountTicks(ctx, cx, cy, 44, 24, seam, 22);
  ell(ctx, cx, cy, 35, 18, vgrad(ctx, cy - 16, cy + 16, wB, wA));                  // lower water
  ell(ctx, cx - 7, cy - 4, 13, 5, 'rgba(190,230,205,.22)');
  fountSparkle(ctx, cx, cy, 35, 18, t, 14);
  fountJet(ctx, cx - 20, cy - 2, 24, 5, t, 0.0);                                   // back jets
  fountJet(ctx, cx + 20, cy - 2, 24, 5, t, 1.3);
  ctx.fillStyle = stoneD; rr(ctx, cx - 7, cy - 27, 14, 30, 3); ctx.fillStyle = stone; rr(ctx, cx - 7, cy - 27, 6, 30, 3);   // pedestal
  ell(ctx, cx, cy - 27, 18, 10, stoneD); ell(ctx, cx, cy - 28.5, 18, 9.5, stoneL); // upper basin rim
  fountTicks(ctx, cx, cy - 27, 18, 10, seam, 14);
  ell(ctx, cx, cy - 27, 12, 6, vgrad(ctx, cy - 33, cy - 21, wB, wA));              // upper water
  fountSparkle(ctx, cx, cy - 27, 12, 6, t, 6);
  fountJet(ctx, cx, cy - 31, 42, 7, t, 0.6);                                       // central tall jet
  fountJet(ctx, cx - 9, cy + 4, 26, 5, t, 2.0);                                    // front jets
  fountJet(ctx, cx + 9, cy + 4, 26, 5, t, 0.9);
  ctx.restore();
}

// ── Resource nodes ──────────────────────────────────────────
export function drawNode(ctx, x, y, kind, t = 0) {
  if (kind === 'stone') { // a cluster of many stones in the ground
    r(ctx, x - 13, y + 3, 26, 6, 'rgba(0,0,0,.18)');
    const cl = ['#9aa0ad', '#868c9a', '#b0b6c4', '#777d8b'];
    const pts = [[-9, 0], [-3, -3], [3, -1], [9, 1], [-6, 4], [2, 5], [7, -4], [-1, 1]];
    pts.forEach((p, i) => { r(ctx, x + p[0] - 3, y + p[1] - 3, 7, 6, cl[i % 4]); r(ctx, x + p[0] - 2, y + p[1] - 3, 3, 2, '#c3c9d6'); });
  } else if (kind === 'iron') { // dark rock with glinting ore veins
    r(ctx, x - 11, y + 3, 22, 6, 'rgba(0,0,0,.2)');
    rr(ctx, x - 12, y - 9, 24, 18, 3, '#0c0c0c');                                  // black border
    r(ctx, x - 10, y - 7, 20, 14, '#5b6270'); r(ctx, x - 7, y - 5, 14, 9, '#6c7484');
    r(ctx, x - 5, y - 3, 4, 3, '#d9dfe9'); r(ctx, x + 3, y + 1, 3, 3, '#e9eef6'); r(ctx, x - 2, y + 3, 3, 2, '#cfd6e6');
    if ((t * 2 | 0) % 3 === 0) r(ctx, x + 3, y + 1, 2, 2, '#fff');
  } else if (kind === 'gold') { // grey rock with bright gold veins
    r(ctx, x - 11, y + 3, 22, 6, 'rgba(0,0,0,.2)');
    rr(ctx, x - 12, y - 9, 24, 18, 3, '#0c0c0c');                                  // black border
    r(ctx, x - 10, y - 7, 20, 14, '#5b6270'); r(ctx, x - 7, y - 5, 14, 9, '#6c7484');
    r(ctx, x - 5, y - 3, 4, 3, '#ffd34d'); r(ctx, x + 3, y + 1, 3, 3, '#ffe89a'); r(ctx, x - 2, y + 3, 3, 2, '#f0c33a');
    if ((t * 2 | 0) % 3 === 0) r(ctx, x + 3, y + 1, 2, 2, '#fff7d0');
  } else if (kind === 'meat') { // grazing sky-critter
    r(ctx, x - 9, y + 4, 18, 4, 'rgba(0,0,0,.18)');
    r(ctx, x - 8, y - 6, 16, 11, '#d9b08c'); r(ctx, x + 6, y - 9, 6, 6, '#c89a72');
    r(ctx, x - 8, y + 4, 3, 5, '#6b4f37'); r(ctx, x + 4, y + 4, 3, 5, '#6b4f37'); r(ctx, x + 9, y - 7, 2, 2, '#000');
  } else if (kind === 'wood') { // a farmable pine tree
    drawPine(ctx, x, y - 6, 1.15, Math.sin(t + x) * 0.6);
  } else if (kind === 'bigwood') { // big leafy deciduous tree → 2× wood (rare)
    ell(ctx, x, y + 11, 16, 4.5, 'rgba(0,0,0,.24)');
    const OL = '#0c160c', sway = Math.sin(t * 1.2 + x) * 1.2;
    const g = ['#2f7a32', '#3f9a3c', '#54b84e', '#74cf64'];
    const blobs = [[0, -22, 12], [-9, -15, 9], [9, -15, 9], [-5, -25, 7], [6, -26, 7], [0, -29, 8], [-13, -19, 6], [13, -19, 6]];
    // black outline: trunk + canopy silhouette (enlarged)
    ctx.fillStyle = OL; ctx.beginPath(); ctx.moveTo(x - 6.4, y + 11.5); ctx.quadraticCurveTo(x - 4, y, x - 4, y - 9); ctx.lineTo(x + 4, y - 9); ctx.quadraticCurveTo(x + 4, y, x + 6.4, y + 11.5); ctx.closePath(); ctx.fill();
    for (const [dx, dy, r] of blobs) { ctx.beginPath(); ctx.arc(x + dx + sway, y + dy, r + 1.8, 0, 7); ctx.fill(); }
    // colored trunk
    ctx.fillStyle = '#6b4a2f'; ctx.beginPath(); ctx.moveTo(x - 5, y + 11); ctx.quadraticCurveTo(x - 3, y, x - 2.5, y - 9); ctx.lineTo(x + 2.5, y - 9); ctx.quadraticCurveTo(x + 3, y, x + 5, y + 11); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a3d26'; ell(ctx, x - 6, y + 11, 3.5, 2.2); ell(ctx, x + 6, y + 11, 3.5, 2.2);   // roots
    ctx.strokeStyle = '#4e3420'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x - 1, y + 8); ctx.lineTo(x - 1, y - 7); ctx.stroke();
    for (const [dx, dy, r] of blobs) { ctx.fillStyle = g[(Math.abs(dx) + r) % g.length]; ctx.beginPath(); ctx.arc(x + dx + sway, y + dy, r, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#8fe06a'; for (const [dx, dy] of [[-7, -24], [4, -27], [-10, -17], [9, -18]]) { ctx.beginPath(); ctx.arc(x + dx + sway, y + dy, 2.6, 0, 7); ctx.fill(); }
  }
}

// ── Buildings: drawn at 2× with a black silhouette outline ──
const BUILDINGS = {
  house: (c, x, y, f, t) => drawHouse(c, x, y, f.v || 0),
  house9: (c, x, y, f, t) => drawHouse9(c, x, y, f.v || 0, t),
  tower: (c, x, y, f, t) => drawTower(c, x, y, f.v || 0, f.build),
  greenhouse: (c, x, y, f, t) => drawGreenhouse(c, x, y, t),
  crane: (c, x, y, f, t) => drawCrane(c, x, y, t),
  workshop: (c, x, y, f, t) => drawWorkshop(c, x, y, f.kind || 'lumberjack', t),
  shopbuilding: (c, x, y, f, t) => drawShopBuilding(c, x, y, f.kind || 'bank', t),
  furnace: (c, x, y, f, t) => drawFurnace(c, x, y, t),
  spire: (c, x, y, f, t) => drawSpire(c, x, y, t, f.dark),
  obelisk: (c, x, y, f, t) => drawObelisk(c, x, y, t),
  ruin: (c, x, y, f, t) => drawRuin(c, x, y),
  rig: (c, x, y, f, t) => drawRig(c, x, y, t),
};
// reusable offscreen buffer pool (keyed by size)
const _bufs = {};
function _getBuf(sz) { let o = _bufs[sz]; if (!o) { const a = document.createElement('canvas'); a.width = a.height = sz; const b = document.createElement('canvas'); b.width = b.height = sz; o = _bufs[sz] = { a, ac: a.getContext('2d'), b, bc: b.getContext('2d') }; } return o; }
// render a sprite to a buffer, stamp a black silhouette outline around it, then the colour on top (optional ×scale)
export function drawOutlined(ctx, px, py, render, opts = {}) {
  const sz = opts.sz || 96, ax = opts.ax == null ? sz / 2 : opts.ax, ay = opts.ay == null ? sz * 0.62 : opts.ay, SC = opts.scale || 1, off = opts.off || 2;
  const o = _getBuf(sz);
  o.ac.clearRect(0, 0, sz, sz); render(o.ac, ax, ay);                                     // colour pass
  o.bc.clearRect(0, 0, sz, sz); o.bc.drawImage(o.a, 0, 0);                                 // → black silhouette
  o.bc.globalCompositeOperation = 'source-in'; o.bc.fillStyle = '#0b0b0b'; o.bc.fillRect(0, 0, sz, sz); o.bc.globalCompositeOperation = 'source-over';
  const bx = px - ax * SC, by = py - ay * SC, dw = sz * SC, dh = sz * SC;
  for (const [dx, dy] of [[-off, 0], [off, 0], [0, -off], [0, off], [-off, -off], [off, -off], [-off, off], [off, off]]) ctx.drawImage(o.b, bx + dx, by + dy, dw, dh);
  ctx.drawImage(o.a, bx, by, dw, dh);
}
function drawBuildingOutlined(ctx, px, py, render) { drawOutlined(ctx, px, py, render, { sz: 240, ax: 120, ay: 172, scale: 2, off: 2.5 }); }

// ── Features (houses, ships, lamps, flowers, trees) ─────────
export function drawFeature(ctx, f, px, py, t) {
  if (BUILDINGS[f.t]) { drawBuildingOutlined(ctx, px, py, (c, x, y) => BUILDINGS[f.t](c, x, y, f, t)); return; }
  switch (f.t) {
    case 'roundship': return drawRoundShip(ctx, px, py, t);
    case 'ship': return drawShip(ctx, px + 2, py, f.kind || 'scout', 'right', (t * 2 | 0) % 2);
    case 'lamp': return drawLamp(ctx, px, py, t);
    case 'flower': return drawFlower(ctx, px, py);
    case 'tree': return drawTree(ctx, px, py, t);
    case 'crystal': return drawCrystal(ctx, px, py, t, f.dark);
    case 'farm': return drawFarm(ctx, px, py);
    case 'colony': return drawColonyDome(ctx, px, py, t);
    case 'rock': { const c = f.dark ? ['#3a2a4d', '#52407a'] : ['#8f95a4', '#a3a9b8']; r(ctx, px - 7, py - 4, 14, 10, c[0]); r(ctx, px - 4, py - 7, 9, 6, c[1]); return; }
  }
}
// ── Colonist habitat — geodesic glass dome on a ribbed silo (≈ fountain size) ──
function drawColonyDome(ctx, x, y, t) {
  ctx.save(); ctx.lineJoin = 'round';
  const W = 76, bh = 58, gy = y + 14, dcy = gy - bh, dr = 42, dry = 36;
  ell(ctx, x, gy + 4, W * 0.6, 12, 'rgba(8,12,20,.3)');                              // shadow
  // ribbed cylindrical body
  rr(ctx, x - W / 2, gy - bh, W, bh, 9, '#d3d6db'); ell(ctx, x, gy, W / 2, 9, '#c4c7ce');
  rr(ctx, x - W / 2, gy - bh, 9, bh, 6, 'rgba(255,255,255,.28)'); rr(ctx, x + W / 2 - 9, gy - bh, 9, bh, 6, 'rgba(0,0,0,.12)');
  ctx.strokeStyle = 'rgba(120,126,138,.45)'; ctx.lineWidth = 1; for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(x + i * 10, gy - bh + 8); ctx.lineTo(x + i * 10, gy - 3); ctx.stroke(); }
  // dome base ring
  ell(ctx, x, dcy, W / 2 + 1, 8, '#aeb2ba');
  // glass dome
  const g = ctx.createLinearGradient(x, dcy - dry, x, dcy); g.addColorStop(0, '#aebfce'); g.addColorStop(0.6, '#7e8ea2'); g.addColorStop(1, '#5e6e84');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, dcy, dr, dry, 0, Math.PI, 2 * Math.PI); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.ellipse(x, dcy, dr, dry, 0, Math.PI, 2 * Math.PI); ctx.clip();
  ctx.strokeStyle = 'rgba(50,60,76,.55)'; ctx.lineWidth = 1.1;
  for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(x + i * 9, dcy); ctx.lineTo(x + i * 3, dcy - dry); ctx.stroke(); }           // vertical seams
  for (const f2 of [0.34, 0.64]) { ctx.beginPath(); ctx.ellipse(x, dcy, dr * (1 - f2 * 0.55), dry * (1 - f2), 0, Math.PI, 2 * Math.PI); ctx.stroke(); }   // bands
  for (let i = -3; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * 9, dcy - dry * 0.34); ctx.lineTo(x + (i + 1) * 9, dcy); ctx.stroke(); }            // zig facets
  ctx.fillStyle = 'rgba(255,255,255,.20)'; ctx.beginPath(); ctx.ellipse(x - dr * 0.34, dcy - dry * 0.48, dr * 0.3, dry * 0.38, 0, 0, 7); ctx.fill();    // glass sheen
  ctx.restore();
  ctx.strokeStyle = '#8a8f99'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, dcy, dr, dry, 0, Math.PI, 2 * Math.PI); ctx.stroke();
  // arched doorway
  ctx.fillStyle = '#3a3f48'; ctx.beginPath(); ctx.moveTo(x - 8, gy - 2); ctx.lineTo(x - 8, gy - 16); ctx.arc(x, gy - 16, 8, Math.PI, 0); ctx.lineTo(x + 8, gy - 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#12161d'; ctx.beginPath(); ctx.moveTo(x - 5, gy - 2); ctx.lineTo(x - 5, gy - 15); ctx.arc(x, gy - 15, 5, Math.PI, 0); ctx.lineTo(x + 5, gy - 2); ctx.closePath(); ctx.fill();
  // ladder up to the door
  ctx.strokeStyle = '#9aa0ab'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 4, gy + 10); ctx.lineTo(x - 4, gy - 2); ctx.moveTo(x + 4, gy + 10); ctx.lineTo(x + 4, gy - 2); ctx.stroke();
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x - 4, gy + 8 - i * 3); ctx.lineTo(x + 4, gy + 8 - i * 3); ctx.stroke(); }
  // right control panel
  rr(ctx, x + W / 2 - 22, gy - bh + 20, 15, 17, 2, '#bcc0c8'); ctx.fillStyle = '#7fb0d0'; for (let r2 = 0; r2 < 3; r2++) for (let c2 = 0; c2 < 3; c2++) r(ctx, x + W / 2 - 20 + c2 * 4, gy - bh + 23 + r2 * 4, 2.6, 2.6, (r2 + c2) % 2 ? '#7fb0d0' : '#cdd6df');
  // left details: window, hazard square, red light
  rr(ctx, x - W / 2 + 9, gy - bh + 18, 9, 9, 1, '#7fb0d0'); r(ctx, x - W / 2 + 10, gy - bh + 19, 3, 8, 'rgba(255,255,255,.4)');
  r(ctx, x - W / 2 + 10, gy - 20, 6, 6, '#e0c23a');
  ell(ctx, x - W / 2 + 7, gy - 10, 1.8, 1.8, (t * 2 | 0) % 2 ? '#ff6a5a' : '#a83a30');
  ctx.restore();
}
// ── Furnace / brick oven (cooks meat — no NPC) ──
function drawFurnace(ctx, x, y, t) {
  const W = 30, H = 24, gy = y + 7, fl = 0.6 + 0.4 * Math.sin(t * 6);
  ctx.save(); ctx.lineJoin = 'round';
  ell(ctx, x, gy + 3, W * 0.55, 5, 'rgba(0,0,0,.28)');
  r(ctx, x - W / 2, gy - H, W, H, '#6b6f78');                                        // stone body
  r(ctx, x - W / 2, gy - H, 4, H, '#7c818b'); r(ctx, x + W / 2 - 4, gy - H, 4, H, 'rgba(0,0,0,.16)');
  ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1;                            // brick courses
  for (let yy = gy - H + 5, row = 0; yy < gy; yy += 5, row++) { ctx.beginPath(); ctx.moveTo(x - W / 2, yy); ctx.lineTo(x + W / 2, yy); ctx.stroke(); for (let xx = x - W / 2 + (row % 2 ? 5 : 0); xx < x + W / 2; xx += 10) { ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + 5); ctx.stroke(); } }
  r(ctx, x - W / 2 - 2, gy - H - 3, W + 4, 4, '#8a8f99');                            // top slab
  r(ctx, x + 5, gy - H - 12, 7, 10, '#5a5e66'); r(ctx, x + 5, gy - H - 12, 7, 2, '#7c818b'); // chimney
  ctx.fillStyle = '#2a1a12'; ctx.beginPath(); ctx.moveTo(x - 8, gy - 2); ctx.lineTo(x - 8, gy - 12); ctx.arc(x, gy - 12, 8, Math.PI, 0); ctx.lineTo(x + 8, gy - 2); ctx.closePath(); ctx.fill();   // mouth
  ctx.fillStyle = `rgba(255,140,40,${0.7 * fl + 0.3})`; ctx.beginPath(); ctx.moveTo(x - 6, gy - 2); ctx.lineTo(x - 6, gy - 9); ctx.arc(x, gy - 9, 6, Math.PI, 0); ctx.lineTo(x + 6, gy - 2); ctx.closePath(); ctx.fill();   // glow
  ctx.fillStyle = '#ffd34d'; for (const dx of [-3, 0, 3]) { ctx.beginPath(); ctx.moveTo(x + dx - 2, gy - 3); ctx.quadraticCurveTo(x + dx, gy - 9 - fl * 3, x + dx + 2, gy - 3); ctx.fill(); }   // flames
  ctx.strokeStyle = '#1a1410'; ctx.lineWidth = 1; for (const dx of [-4, 0, 4]) { ctx.beginPath(); ctx.moveTo(x + dx, gy - 2); ctx.lineTo(x + dx, gy - 7); ctx.stroke(); }   // grate
  for (let i = 0; i < 3; i++) ell(ctx, x + 8.5 + Math.sin(t + i) * 3, gy - H - 18 - i * 7 + Math.sin(t * 2 + i) * 2, 2.5 + i, 2 + i, `rgba(200,205,215,${0.4 - i * 0.1})`);   // smoke
  ctx.restore();
}

// ── Trade workshop building (stands behind its NPC) ──
const WS_ICON = { lumberjack: '🪓', miner: '⛏️', builder: '🔨' };
function drawWorkshop(ctx, x, y, kind, t) {
  const W = 36, H = 26, gy = y + 7;
  const pal = ({
    lumberjack: { wall: '#7a5230', wallHi: '#8c6440', roof: '#3f7a43', roofHi: '#54a04e', sign: '#caa84a' },
    miner: { wall: '#888e9c', wallHi: '#9aa0ad', roof: '#566070', roofHi: '#6c7686', sign: '#aab0bd' },
    builder: { wall: '#9a5240', wallHi: '#b06450', roof: '#b0843c', roofHi: '#caa052', sign: '#d6ad52' },
  })[kind] || { wall: '#7a5230', wallHi: '#8c6440', roof: '#566070', roofHi: '#6c7686', sign: '#caa84a' };
  ctx.save(); ctx.lineJoin = 'round';
  ell(ctx, x, gy + 3, W * 0.55, 5, 'rgba(0,0,0,.28)');                                   // ground shadow
  // body
  r(ctx, x - W / 2, gy - H, W, H, pal.wall);
  r(ctx, x - W / 2, gy - H, 4, H, pal.wallHi); r(ctx, x + W / 2 - 4, gy - H, 4, H, 'rgba(0,0,0,.16)');
  ctx.strokeStyle = 'rgba(0,0,0,.14)'; ctx.lineWidth = 1; for (let yy = gy - H + 6; yy < gy; yy += 6) { ctx.beginPath(); ctx.moveTo(x - W / 2, yy); ctx.lineTo(x + W / 2, yy); ctx.stroke(); }
  // roof (overhanging gable)
  ctx.fillStyle = pal.roof; ctx.beginPath(); ctx.moveTo(x - W / 2 - 5, gy - H + 3); ctx.lineTo(x, gy - H - 13); ctx.lineTo(x + W / 2 + 5, gy - H + 3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = pal.roofHi; ctx.beginPath(); ctx.moveTo(x, gy - H - 13); ctx.lineTo(x - W / 2 - 5, gy - H + 3); ctx.lineTo(x - W / 2 + 3, gy - H + 3); ctx.closePath(); ctx.fill();
  // windows + open doorway
  r(ctx, x - W / 2 + 5, gy - H + 8, 6, 6, '#bfe6ff'); r(ctx, x + W / 2 - 11, gy - H + 8, 6, 6, '#bfe6ff');
  r(ctx, x - 6, gy - 14, 12, 14, '#241b14'); r(ctx, x - 6, gy - 14, 12, 2, 'rgba(0,0,0,.45)');
  // trade-specific props
  if (kind === 'lumberjack') { for (const [lx, ly] of [[-W / 2 - 6, -2], [-W / 2 - 4, -6]]) { ell(ctx, x + lx, gy + ly, 4, 3, '#6b4a30'); ell(ctx, x + lx, gy + ly, 2, 1.6, '#caa06a'); } }
  else if (kind === 'miner') { r(ctx, x + W / 2 + 1, gy - 6, 9, 6, '#4a4f5a'); r(ctx, x + W / 2 + 2, gy - 8, 7, 3, '#7fd0ff'); ell(ctx, x + W / 2 + 3, gy + 1, 1.6, 1.6, '#2a2e36'); ell(ctx, x + W / 2 + 8, gy + 1, 1.6, 1.6, '#2a2e36'); }
  else if (kind === 'builder') { r(ctx, x + W / 2 - 7, gy - H - 8, 6, 8, '#6b4a40'); for (let i = 0; i < 3; i++) { const yy = gy - H - 10 - i * 5 + Math.sin(t * 2 + i) * 1.5; ell(ctx, x + W / 2 - 4 + Math.sin(t + i) * 2, yy, 2.5 + i, 2 + i, 'rgba(200,205,215,.4)'); } r(ctx, x - W / 2 - 9, gy - 6, 8, 5, '#3a3f48'); r(ctx, x - W / 2 - 8, gy - 8, 6, 3, '#52585f'); }
  // hanging sign with the trade icon
  r(ctx, x - 10, gy - H - 3, 20, 10, pal.sign); ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1; ctx.strokeRect(x - 10, gy - H - 3, 20, 10);
  ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#1a1a1a'; ctx.fillText(WS_ICON[kind] || '🛠️', x, gy - H + 2.5);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.restore();
}
function drawTower(ctx, x, y, v, build) {
  const w = 16, h = 30 + v * 6;
  r(ctx, x - w / 2 - 1, y + 6, w + 2, 4, 'rgba(0,0,0,.3)');
  const body = ['#46577a', '#3d4d6e', '#52608a'][v % 3];
  r(ctx, x - w / 2, y + 6 - h, w, h, body);
  r(ctx, x - w / 2, y + 6 - h, w, h, body); r(ctx, x - w / 2, y + 6 - h, 3, h, 'rgba(255,255,255,.12)'); r(ctx, x + w / 2 - 3, y + 6 - h, 3, h, 'rgba(0,0,0,.18)');
  // lit windows (blue neon)
  for (let yy = y + 2 - h; yy < y; yy += 5) for (let xx = x - w / 2 + 2; xx < x + w / 2 - 2; xx += 5) r(ctx, xx, yy, 2, 3, Math.random() < 0.8 ? '#7fd0ff' : '#26405e');
  r(ctx, x - 2, y + 6 - h - 5, 4, 5, '#26405e'); r(ctx, x - 1, y + 2 - h - 6, 2, 4, '#9fe3ff'); // antenna
  if (build) { ctx.strokeStyle = '#ffcf4d'; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 - 1.5, y + 6 - h * 0.55, w + 3, h * 0.55); r(ctx, x - w / 2 - 2, y + 6 - h * 0.55, 2, h * 0.55, '#caa23a'); }
}
function drawSpire(ctx, x, y, t, dark) {
  const h = 48, c1 = dark ? '#3a2358' : '#3a557e', c2 = dark ? '#6a3fb0' : '#5b86c4', glow = dark ? '#c06bff' : '#9fe3ff';
  r(ctx, x - 10, y + 6, 20, 5, 'rgba(0,0,0,.32)');
  // tapered tower
  for (let i = 0; i < 6; i++) { const ww = 16 - i * 2, yy = y + 6 - (i + 1) * (h / 6); r(ctx, x - ww / 2, yy, ww, h / 6 + 1, i % 2 ? c1 : c2); }
  r(ctx, x - 1, y + 6 - h - 8, 2, 10, c2);
  const pulse = 0.5 + Math.sin(t * 2) * 0.5;
  ctx.globalAlpha = pulse; r(ctx, x - 2, y + 6 - h - 10, 4, 4, glow); ctx.globalAlpha = 1;
  for (let i = 1; i < 5; i++) r(ctx, x - 1, y + 6 - i * (h / 5), 2, 2, glow);
}
function drawCrystal(ctx, x, y, t, dark) {
  const c = dark ? ['#7e3fd0', '#b06bff', '#d9b8ff'] : ['#3f9fe0', '#6fd0ff', '#cdeeff'];
  r(ctx, x - 8, y + 3, 16, 4, 'rgba(0,0,0,.25)');
  const tw = 0.6 + Math.sin(t * 2 + x) * 0.4;
  const shards = [[-5, 0, 5, 14], [2, -3, 5, 17], [-1, 2, 4, 11]];
  ctx.globalAlpha = 1;
  for (const [dx, dy, w, hh] of shards) { r(ctx, x + dx - w / 2, y + dy - hh + 6, w, hh, c[0]); r(ctx, x + dx - w / 2, y + dy - hh + 6, 2, hh, c[1]); }
  ctx.globalAlpha = tw; r(ctx, x - 1, y - 4, 2, 2, c[2]); r(ctx, x + 2, y - 8, 2, 2, c[2]); ctx.globalAlpha = 1;
}
function drawGreenhouse(ctx, x, y, t) {
  r(ctx, x - 14, y + 7, 28, 5, 'rgba(0,0,0,.28)');
  r(ctx, x - 14, y - 2, 28, 11, '#cfe0ef'); // base
  // glass dome
  ctx.fillStyle = 'rgba(150,220,200,.5)'; ctx.beginPath(); ctx.arc(x, y - 2, 14, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1;
  for (let a = -2; a <= 2; a++) { ctx.beginPath(); ctx.moveTo(x + a * 6, y - 2); ctx.lineTo(x + a * 3, y - 16); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(x, y - 2, 9, Math.PI, 0); ctx.stroke();
  r(ctx, x - 10, y, 5, 6, '#5fae4e'); r(ctx, x + 5, y, 5, 6, '#69bd57'); // plants inside
}
function drawFarm(ctx, x, y) {
  r(ctx, x - 12, y - 8, 24, 18, '#7a5a37');
  for (let i = 0; i < 4; i++) { r(ctx, x - 12, y - 8 + i * 5, 24, 3, '#8a6a44'); for (let j = -10; j < 12; j += 4) r(ctx, x + j, y - 8 + i * 5, 2, 2, '#5fae4e'); }
}
function drawCrane(ctx, x, y, t) {
  r(ctx, x - 6, y + 8, 12, 4, 'rgba(0,0,0,.3)');
  r(ctx, x - 2, y + 8 - 34, 4, 34, '#ffb347'); r(ctx, x - 2, y + 8 - 34, 4, 34, '#d98f2e');
  const sway = Math.sin(t * 1.2) * 2;
  r(ctx, x - 2, y + 6 - 34, 26 + sway, 3, '#ffcf4d');         // jib
  r(ctx, x - 14, y + 6 - 34, 12, 3, '#ffcf4d');               // counter-jib
  r(ctx, x + 20 + sway, y + 9 - 34, 2, 8, '#888');            // cable
  r(ctx, x + 19 + sway, y + 17 - 34, 4, 3, '#cfcfcf');        // hook
  r(ctx, x - 4, y + 6, 8, 4, '#3a3f4a');
}
function drawObelisk(ctx, x, y, t) {
  r(ctx, x - 6, y + 6, 12, 4, 'rgba(0,0,0,.3)');
  r(ctx, x - 5, y + 6 - 26, 10, 26, '#9a8f7a'); r(ctx, x - 5, y + 6 - 26, 3, 26, '#b3a78f');
  r(ctx, x - 3, y + 6 - 30, 6, 5, '#867c68');
  const pulse = 0.4 + Math.sin(t * 2) * 0.4; ctx.globalAlpha = pulse;
  r(ctx, x - 2, y - 8, 4, 10, '#b06bff'); r(ctx, x - 1, y - 16, 2, 5, '#d9b8ff'); ctx.globalAlpha = 1;
}
function drawRuin(ctx, x, y) {
  r(ctx, x - 10, y + 6, 20, 4, 'rgba(0,0,0,.28)');
  r(ctx, x - 9, y + 6 - 16, 4, 16, '#a89878'); r(ctx, x + 5, y + 6 - 12, 4, 12, '#9a8a6c');
  r(ctx, x - 9, y + 6 - 18, 14, 4, '#b3a382'); r(ctx, x + 1, y - 2, 3, 3, '#7a6c52');
}
function drawRig(ctx, x, y, t) {
  r(ctx, x - 8, y + 6, 16, 4, 'rgba(0,0,0,.3)');
  // derrick
  ctx.strokeStyle = '#8a8d99'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 8, y + 6); ctx.lineTo(x, y + 6 - 26); ctx.lineTo(x + 8, y + 6); ctx.moveTo(x - 5, y - 6); ctx.lineTo(x + 5, y - 6); ctx.stroke();
  const drill = (t * 4 | 0) % 2; r(ctx, x - 1, y + 6 - 24 + drill, 2, 18, '#cfd6e6');
  r(ctx, x - 6, y + 2, 12, 5, '#46577a');
}
// ── Big 3×3 cartoon houses for the city (4 variants) ────────
function drawHouse9(ctx, x, y, v, t) {
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ell(ctx, x, y + 18, 44, 8, 'rgba(0,0,0,.25)');           // ground shadow
  const OL = '#2a2018'; ctx.lineWidth = 1.4;
  const poly = (col, pts) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); ctx.fill(); ctx.strokeStyle = OL; ctx.stroke(); };
  const box = (col, X, Y, W, H, r = 2) => { rr(ctx, X, Y, W, H, r, col); ctx.strokeStyle = OL; ctx.beginPath(); ctx.moveTo(X + r, Y); ctx.arcTo(X + W, Y, X + W, Y + H, r); ctx.arcTo(X + W, Y + H, X, Y + H, r); ctx.arcTo(X, Y + H, X, Y, r); ctx.arcTo(X, Y, X + W, Y, r); ctx.stroke(); };
  const smoke = (sx, sy) => { ctx.fillStyle = 'rgba(220,225,235,.5)'; for (let i = 0; i < 3; i++) { const a = t * 1.2 + i; ctx.beginPath(); ctx.arc(sx + Math.sin(a) * 3, sy - 6 - i * 6, 3 - i * 0.4, 0, 7); ctx.fill(); } };

  if (v === 0) { // modern villa
    box('#b9b3a8', x - 40, y - 22, 34, 40);             // left wing
    box('#cfcabf', x - 6, y - 40, 30, 58);              // tall block
    box('#8a8479', x + 24, y - 14, 18, 32);             // right wing (dark)
    poly('#5a5650', [[x + 24, y - 14], [x + 44, y - 22], [x + 44, y - 18], [x + 24, y - 10]]); // slanted roof
    box('#6e6a62', x - 36, y - 6, 26, 22);              // garage (striped)
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x - 36, y - 6 + i * 3.5); ctx.lineTo(x - 10, y - 6 + i * 3.5); ctx.stroke(); }
    box('#7fd0ff', x - 2, y - 32, 20, 12, 1);           // balcony window
    ctx.fillStyle = '#3a3530'; ctx.fillRect(x - 2, y - 18, 20, 2);
    box('#2a2622', x + 2, y - 6, 10, 22, 1);            // door
  } else if (v === 1) { // red-roof cottage
    box('#e7dcc4', x - 30, y - 18, 60, 36);             // walls
    ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 1.2;   // timber framing
    ctx.beginPath(); ctx.moveTo(x - 30, y); ctx.lineTo(x + 30, y); ctx.moveTo(x - 8, y - 18); ctx.lineTo(x - 8, y + 18); ctx.moveTo(x + 8, y - 18); ctx.lineTo(x + 8, y + 18); ctx.stroke();
    poly('#c0432f', [[x - 36, y - 18], [x, y - 44], [x + 36, y - 18]]);   // red roof
    poly('#a8362544'.slice(0, 7), [[x - 36, y - 18], [x, y - 44], [x - 30, y - 18]]);
    ctx.strokeStyle = '#7a241a'; for (let i = -28; i < 36; i += 7) { ctx.beginPath(); ctx.moveTo(x + i, y - 18); ctx.lineTo(x + i + 13, y - 31); ctx.stroke(); }
    box('#6b4a30', x + 18, y - 40, 7, 14, 1); smoke(x + 21, y - 40);      // chimney
    box('#cdeafe', x - 24, y - 12, 12, 12, 1); box('#cdeafe', x + 12, y - 12, 12, 12, 1); // windows
    box('#5a3a22', x - 5, y, 10, 18, 1);                // door
    poly('#e7d9c3', [[x - 30, y + 6], [x - 8, y + 6], [x - 8, y + 14], [x - 30, y + 14]]); // awning base
    ctx.fillStyle = '#d6543f'; for (let i = 0; i < 4; i++) ctx.fillRect(x - 30 + i * 6, y + 6, 3, 8);
  } else if (v === 2) { // tavern / bar
    box('#d8c39a', x - 30, y - 16, 60, 34);
    poly('#b6492f', [[x - 36, y - 16], [x - 4, y - 46], [x + 36, y - 16]]);
    ctx.strokeStyle = '#7a2a1c'; for (let i = -30; i < 36; i += 7) { ctx.beginPath(); ctx.moveTo(x + i, y - 16); ctx.lineTo(x + i + 15, y - 30); ctx.stroke(); }
    box('#6b4a30', x - 18, y - 42, 7, 14, 1); smoke(x - 15, y - 42);
    box('#3a2e22', x - 16, y - 30, 12, 7, 1); ctx.fillStyle = '#ffcf4d'; ctx.font = '6px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BAR', x - 10, y - 24);
    box('#cdeafe', x + 6, y - 10, 14, 12, 1);           // window
    box('#5a3a22', x - 22, y - 2, 11, 20, 1);           // door
    box('#8a5a32', x + 22, y + 4, 8, 12, 2);            // barrel
    ctx.strokeStyle = '#5a3a22'; ctx.beginPath(); ctx.moveTo(x + 22, y + 8); ctx.lineTo(x + 30, y + 8); ctx.stroke();
  } else { // fantasy house (glowing)
    box('#dcd0b6', x - 28, y - 16, 56, 34);
    poly('#3f8aa0', [[x - 34, y - 16], [x - 2, y - 44], [x + 30, y - 16]]);  // teal roof
    ctx.strokeStyle = '#2c6576'; for (let i = -28; i < 30; i += 6) { ctx.beginPath(); ctx.moveTo(x + i, y - 16); ctx.lineTo(x + i + 13, y - 28); ctx.stroke(); }
    box('#c8bca0', x + 16, y - 34, 14, 52, 2);          // side tower
    poly('#3f8aa0', [[x + 13, y - 34], [x + 23, y - 50], [x + 33, y - 34]]); // tower roof
    const lit = 0.6 + 0.4 * Math.abs(Math.sin(t * 2));
    ctx.globalAlpha = lit; box('#ffe08a', x - 20, y - 10, 11, 11, 1); box('#ffe08a', x + 18, y - 26, 8, 8, 1); box('#ffe08a', x - 2, y - 6, 9, 9, 1); ctx.globalAlpha = 1;
    box('#5a3a22', x + 1, y + 2, 10, 16, 1);
    ctx.fillStyle = '#4f9a45'; for (const [ix, iy] of [[-28, 4], [-24, 10], [28, 6]]) ell(ctx, x + ix, y + iy, 3, 4, '#4f9a45'); // ivy
  }
  ctx.restore();
}
function drawHouse(ctx, x, y, v) {
  const walls = ['#e7d9c3', '#cfe0ef', '#f0d3c2'][v % 3];
  const roof = ['#b9543f', '#3f6fae', '#7e5bb0'][v % 3];
  r(ctx, x - 11, y + 8, 22, 5, 'rgba(0,0,0,.2)');     // shadow
  r(ctx, x - 10, y - 6, 20, 16, walls);               // wall
  r(ctx, x - 10, y - 6, 20, 3, 'rgba(255,255,255,.25)');
  r(ctx, x - 13, y - 6, 26, 4, roof); r(ctx, x - 9, y - 12, 18, 7, roof); r(ctx, x - 9, y - 12, 18, 2, 'rgba(255,255,255,.2)'); // roof
  r(ctx, x - 3, y, 6, 10, '#6b4a30');                  // door
  r(ctx, x - 8, y - 2, 4, 4, '#9fd8ff'); r(ctx, x + 4, y - 2, 4, 4, '#9fd8ff'); // windows
}
function drawRoundShip(ctx, x, y, t) {
  const bob = Math.sin(t * 2) * 2;
  r(ctx, x - 16, y + 12 + bob, 32, 5, 'rgba(0,0,0,.18)');
  // saucer body (stepped ellipse)
  const yy = y + bob;
  ctx.fillStyle = '#c2c8d6';
  for (const [w, dy] of [[30, 0], [24, -3], [16, -6]]) r(ctx, x - w / 2, yy + dy - 2, w, 4, '#c2c8d6');
  r(ctx, x - 15, yy - 1, 30, 4, '#9aa1b2');            // rim shadow
  r(ctx, x - 15, yy - 2, 30, 1, '#e6eaf2');            // rim highlight
  // glass dome
  r(ctx, x - 7, yy - 12, 14, 7, '#7fd0ff'); r(ctx, x - 7, yy - 12, 14, 2, '#bfe6ff'); r(ctx, x - 5, yy - 11, 4, 3, '#eaf7ff');
  // blinking lights
  const on = (t * 3 | 0) % 2;
  for (let i = -1; i <= 1; i++) r(ctx, x + i * 9 - 1, yy + 1, 2, 2, on ? '#ffd34d' : '#ff5a6e');
}
function drawLamp(ctx, x, y, t) {
  r(ctx, x - 1, y - 4, 3, 16, '#3a3f4a'); r(ctx, x - 4, y + 11, 9, 3, 'rgba(0,0,0,.2)');
  const glow = 0.5 + Math.sin(t * 2 + x) * 0.2;
  ctx.fillStyle = `rgba(255,224,138,${glow})`; ctx.beginPath(); ctx.arc(x, y - 5, 6, 0, 7); ctx.fill();
  r(ctx, x - 3, y - 8, 6, 6, '#ffe08a'); r(ctx, x - 3, y - 9, 6, 2, '#fff3c4');
}
function drawFlower(ctx, x, y) {
  r(ctx, x, y, 1, 5, '#3f8a39');
  const c = ['#ff6ea8', '#ffd34d', '#9b7bff', '#ff7a4d'][(x + y) % 4];
  r(ctx, x - 2, y - 2, 5, 4, c); r(ctx, x - 1, y - 1, 2, 2, '#fff7cf');
}
function drawTree(ctx, x, y, t) { drawPine(ctx, x, y - 4, 1, Math.sin(t * 1.5 + x)); }
// layered conifer pine (matches the reference)
function drawPine(ctx, x, y, s, sway = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.lineJoin = 'round';
  ell(ctx, 0, 13, 10, 3, 'rgba(0,0,0,.22)');
  const dk = '#256a2a', md = '#34883a', lt = '#54ad4d', hl = '#74c862', OL = '#0c160c';
  const tiers = [ { y: 9, w: 11, n: 7 }, { y: 3, w: 9, n: 6 }, { y: -3, w: 7, n: 5 }, { y: -9, w: 4.5, n: 3 } ];
  // black outline underlay (trunk + foliage silhouette + top), enlarged
  rr(ctx, -3.9, 6.2, 7.8, 9.8, 2, OL);
  ctx.fillStyle = OL;
  tiers.forEach((T, i) => { const sx = sway * (0.4 + i * 0.5);
    for (let k = 0; k < T.n; k++) { const f = T.n === 1 ? 0 : (k / (T.n - 1)) * 2 - 1, bx = sx + f * T.w, by = T.y + Math.abs(f) * 3;
      ctx.beginPath(); ctx.ellipse(bx, by, 3.4 + 1.7, 2.4 + 1.7, f * 0.5, 0, 7); ctx.fill(); } });
  ctx.beginPath(); ctx.moveTo(0, -16.8); ctx.lineTo(-4.8, -8.4); ctx.lineTo(4.8, -8.4); ctx.closePath(); ctx.fill();
  // colored trunk
  rr(ctx, -2.6, 7, 5.2, 8, 1.4, '#6b4a2f'); rr(ctx, -2.6, 7, 2, 8, 1, '#83633f');
  tiers.forEach((T, i) => {
    const sx = sway * (0.4 + i * 0.5);
    for (let k = 0; k < T.n; k++) {
      const f = T.n === 1 ? 0 : (k / (T.n - 1)) * 2 - 1, bx = sx + f * T.w, by = T.y + Math.abs(f) * 3;
      ctx.fillStyle = i < 1 ? dk : md;
      ctx.beginPath(); ctx.ellipse(bx, by, 3.4, 2.4, f * 0.5, 0, 7); ctx.fill();
    }
    // lighter top sheen of each tier
    for (let k = 0; k < Math.max(1, T.n - 2); k++) {
      const f = (k / Math.max(1, T.n - 2)) * 1.4 - 0.7, bx = sx + f * T.w * 0.8;
      ctx.fillStyle = i >= 2 ? hl : lt;
      ctx.beginPath(); ctx.ellipse(bx, T.y - 1.4, 2.4, 1.8, f * 0.4, 0, 7); ctx.fill();
    }
  });
  // pointed top
  ctx.fillStyle = lt; ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(-3, -9); ctx.lineTo(3, -9); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ── worn equipment overlays (creature-themed armour shown on the body) ──
const ARMOR_PAL = {
  sheep: { m: '#f3f4f6', d: '#cfd3d8', e: '#8b9096' },
  skeleton: { m: '#e6e9ef', d: '#aab0bd', e: '#3a3f48' },
  alien: { m: '#8a4fd0', d: '#5e2fa0', e: '#c9ff6a' },
};
function armorOverlay(ctx, x, y, gear, sw) {
  if (!gear) return;
  const P = s => ARMOR_PAL[s] || ARMOR_PAL.skeleton;
  // leg guards (bottom)
  if (gear.bottom) { const p = P(gear.bottom);
    rr(ctx, x - 5.4, y + 4, 4.6, 7 + (sw > 0 ? sw : 0), 2, p.m); rr(ctx, x + 0.8, y + 4, 4.6, 7 + (sw < 0 ? -sw : 0), 2, p.m);
    rr(ctx, x - 5.4, y + 4, 4.6, 2.5, 2, p.d); rr(ctx, x + 0.8, y + 4, 4.6, 2.5, 2, p.d); }
  // boots (shoes)
  if (gear.shoes) { const p = P(gear.shoes);
    rr(ctx, x - 6, y + 10 + (sw > 0 ? sw : 0), 5.4, 6, 2.4, p.m); rr(ctx, x + 0.6, y + 10 + (sw < 0 ? -sw : 0), 5.4, 6, 2.4, p.m);
    ell(ctx, x - 3.2, y + 15 + (sw > 0 ? sw : 0), 2.9, 1.5, p.d); ell(ctx, x + 3.3, y + 15 + (sw < 0 ? -sw : 0), 2.9, 1.5, p.d);
    r(ctx, x - 5.5, y + 12 + (sw > 0 ? sw : 0), 4.5, 1.2, p.e); r(ctx, x + 1.1, y + 12 + (sw < 0 ? -sw : 0), 4.5, 1.2, p.e); }
  // chest plate (top)
  if (gear.top) { const p = P(gear.top);
    ctx.fillStyle = p.m; ctx.beginPath();
    ctx.moveTo(x - 6.5, y - 4); ctx.quadraticCurveTo(x - 7.5, y - 7, x - 4.5, y - 7); ctx.lineTo(x + 4.5, y - 7); ctx.quadraticCurveTo(x + 7.5, y - 7, x + 6.5, y - 4);
    ctx.lineTo(x + 6, y + 4.5); ctx.quadraticCurveTo(x + 6, y + 6.5, x + 4, y + 6.5); ctx.lineTo(x - 4, y + 6.5); ctx.quadraticCurveTo(x - 6, y + 6.5, x - 6, y + 4.5); ctx.closePath(); ctx.fill();
    rr(ctx, x - 6, y + 4, 12, 2.5, 1, p.d);
    ctx.strokeStyle = p.e; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 5); ctx.stroke();
    ell(ctx, x - 6, y - 5, 3.2, 2.6, p.d); ell(ctx, x + 6, y - 5, 3.2, 2.6, p.d);     // shoulder pads
    ell(ctx, x - 6, y - 5.6, 2, 1.4, p.m); ell(ctx, x + 6, y - 5.6, 2, 1.4, p.m);
    if (gear.top === 'sheep') { for (const dx of [-3, 0, 3]) ell(ctx, x + dx, y - 3, 2, 1.6, '#ffffff'); }                                   // wool tufts
    else if (gear.top === 'skeleton') { ctx.strokeStyle = 'rgba(60,65,72,.6)'; ctx.lineWidth = 0.8; for (const yy of [-2, 0, 2]) { ctx.beginPath(); ctx.moveTo(x - 4, y + yy); ctx.quadraticCurveTo(x, y + yy + 1.5, x + 4, y + yy); ctx.stroke(); } }   // ribs
    else { ell(ctx, x, y - 1, 2, 2.4, p.e); ell(ctx, x, y - 1, 1, 1.3, '#eaffea'); }                                                      // alien gem
  }
  // shield on the back
  if (gear.shield) { const p = P(gear.shield), sx = x - 8.5, sy = y + 0.5;
    ctx.fillStyle = p.d; ctx.beginPath(); ctx.moveTo(sx, sy - 5); ctx.lineTo(sx + 4, sy - 3.5); ctx.lineTo(sx + 3, sy + 4); ctx.lineTo(sx, sy + 6.5); ctx.lineTo(sx - 3, sy + 4); ctx.lineTo(sx - 4, sy - 3.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.m; ctx.beginPath(); ctx.moveTo(sx, sy - 3.5); ctx.lineTo(sx + 2.6, sy - 2.4); ctx.lineTo(sx + 2, sy + 3); ctx.lineTo(sx, sy + 4.6); ctx.lineTo(sx - 2, sy + 3); ctx.lineTo(sx - 2.6, sy - 2.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.e; r(ctx, sx - 0.8, sy - 2, 1.6, 5, p.e); r(ctx, sx - 2.2, sy - 0.3, 4.4, 1.6, p.e); }
  // sword sheathed on the back
  if (gear.weapon) { const gold = gear.weapon === 'goldsword', blade = gold ? '#ffd34d' : '#d6dae0', grip = gold ? '#7a5a10' : '#7e1d24';
    ctx.strokeStyle = blade; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + 5, y - 2); ctx.lineTo(x + 11, y - 12); ctx.stroke();
    ctx.strokeStyle = grip; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x + 7, y - 4); ctx.stroke(); }
}

// ── Character — smooth anime-style adventurer with cloak ────
export function drawPlayer(ctx, x, y, app, dir, frame, inAir, ship, gear) {
  if (inAir) { drawShip(ctx, x, y, ship, dir, frame); return; }
  const a = app || {};
  const skin = a.skin || '#f6d2a8', skinSh = shade(skin, -34), skinHi = shade(skin, 18);
  const tunic = a.shirt || '#7c8a4a', tunicSh = shade(tunic, -30), tunicHi = shade(tunic, 26);
  const pants = a.pants || '#2b3a63', pantsSh = shade(pants, -22);
  const boots = a.shoes || '#5a3a22', bootsSh = shade(boots, -26);
  const hair = a.hair || '#5a3a24', hairHi = shade(hair, 36), hairDk = shade(hair, -26);
  const cloak = '#7b818c', cloakSh = '#565b66', cloakHi = '#9aa0ab', trim = '#d8a23e', wrap = '#3c4150';
  const back = dir === 'up', flip = dir === 'right', side = dir === 'left' || dir === 'right';
  const bob = Math.sin(frame * 0.5) * 0.7, sw = Math.sin(frame * 0.5) * 1.8;

  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ell(ctx, x, y + 16, 8.5, 2.6, 'rgba(0,0,0,.22)');                       // ground shadow
  ctx.translate(0, bob);
  if (flip) { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }

  // legs + boots (slight walk swing)
  rr(ctx, x - 5.4, y + 3, 4.6, 8 + (sw > 0 ? sw : 0), 2.2, vgrad(ctx, y + 3, y + 12, pants, pantsSh));
  rr(ctx, x + 0.8, y + 3, 4.6, 8 + (sw < 0 ? -sw : 0), 2.2, vgrad(ctx, y + 3, y + 12, pants, pantsSh));
  rr(ctx, x - 6, y + 10 + (sw > 0 ? sw : 0), 5.4, 6, 2.4, boots); rr(ctx, x + 0.6, y + 10 + (sw < 0 ? -sw : 0), 5.4, 6, 2.4, boots);
  ell(ctx, x - 3.2, y + 15 + (sw > 0 ? sw : 0), 2.9, 1.5, bootsSh); ell(ctx, x + 3.3, y + 15 + (sw < 0 ? -sw : 0), 2.9, 1.5, bootsSh);

  // cloak draped behind (smooth wavy hem)
  ctx.fillStyle = cloak; ctx.beginPath();
  ctx.moveTo(x - 8, y - 7);
  ctx.quadraticCurveTo(x - 10, y + 2, x - 7.5, y + 9);
  ctx.quadraticCurveTo(x - 4, y + 6, x - 1.5, y + 10);
  ctx.quadraticCurveTo(x + 1, y + 6, x + 4, y + 10);
  ctx.quadraticCurveTo(x + 7, y + 6, x + 8, y - 7);
  ctx.quadraticCurveTo(x, y - 11, x - 8, y - 7); ctx.closePath(); ctx.fill();
  ctx.fillStyle = cloakSh; ctx.beginPath(); ctx.moveTo(x + 1, y - 8); ctx.quadraticCurveTo(x + 6, y - 2, x + 4, y + 9); ctx.quadraticCurveTo(x + 7, y + 5, x + 8, y - 7); ctx.quadraticCurveTo(x + 5, y - 10, x + 1, y - 8); ctx.fill();

  // torso / tunic (rounded shoulders → hem)
  ctx.fillStyle = vgrad(ctx, y - 6, y + 6, tunicHi, tunicSh); ctx.beginPath();
  ctx.moveTo(x - 7, y - 4);
  ctx.quadraticCurveTo(x - 8, y - 7, x - 5, y - 7);
  ctx.lineTo(x + 5, y - 7); ctx.quadraticCurveTo(x + 8, y - 7, x + 7, y - 4);
  ctx.lineTo(x + 6.5, y + 5); ctx.quadraticCurveTo(x + 6.5, y + 7, x + 4.5, y + 7);
  ctx.lineTo(x - 4.5, y + 7); ctx.quadraticCurveTo(x - 6.5, y + 7, x - 6.5, y + 5); ctx.closePath(); ctx.fill();
  // collar + hem trim
  ctx.strokeStyle = trim; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 6, y - 5.5); ctx.quadraticCurveTo(x, y - 3.5, x + 6, y - 5.5); ctx.stroke();
  ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 6, y + 6); ctx.lineTo(x + 6, y + 6); ctx.stroke();
  if (!back) { ctx.strokeStyle = tunicSh; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 6); ctx.stroke(); }

  // arms with wraps
  for (const s of [-1, 1]) { const ax = x + s * 7.2;
    ell(ctx, ax, y - 1, 2.2, 4.2, vgrad(ctx, y - 4, y + 4, skin, skinSh));
    rr(ctx, ax - 2, y + 1.5, 4, 4, 1.6, wrap); }

  // grey cape over the (left) shoulder
  ctx.fillStyle = cloakHi; ctx.beginPath();
  ctx.moveTo(x - 8.5, y - 6.5); ctx.quadraticCurveTo(x - 1, y - 7.5, x - 1, y - 6);
  ctx.quadraticCurveTo(x - 2.5, y + 4, x - 4, y + 8);
  ctx.quadraticCurveTo(x - 6.5, y + 4.5, x - 8.5, y + 8.5);
  ctx.quadraticCurveTo(x - 9.5, y + 1, x - 8.5, y - 6.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = cloakSh; ctx.beginPath(); ctx.moveTo(x - 4.5, y - 6); ctx.quadraticCurveTo(x - 4, y + 2, x - 4, y + 8); ctx.quadraticCurveTo(x - 6, y + 4.5, x - 7, y + 6); ctx.quadraticCurveTo(x - 6.5, y - 2, x - 6, y - 6); ctx.fill();
  ell(ctx, x - 6.4, y - 6.4, 1.7, 1.4, trim);                            // clasp

  armorOverlay(ctx, x, y, gear, sw);                                     // worn equipment (creature-themed)

  // head
  ctx.fillStyle = vgrad(ctx, y - 16, y - 2, skinHi, skin); ell(ctx, x, y - 9, 6.3, 7);
  ctx.fillStyle = skinSh; ctx.globalAlpha = 0.5; ell(ctx, x + (back ? 0 : 2.5), y - 7, 3.6, 5); ctx.globalAlpha = 1;
  if (!back) {
    const e = side ? (flip ? 1.6 : 1.6) : 0;     // (mirrored by flip transform)
    const eo = side ? 1.8 : 0;
    // anime eyes
    for (const s of side ? [1] : [-1, 1]) {
      const exx = x + (side ? 1.5 : s * 2.6) + e * 0;
      ctx.fillStyle = '#fff'; ell(ctx, exx, y - 8, 1.5, 2.1);
      ctx.fillStyle = '#3a2b1c'; ell(ctx, exx + 0.2, y - 7.6, 1.0, 1.7);
      ctx.fillStyle = '#fff'; ell(ctx, exx + 0.5, y - 8.4, 0.5, 0.6);
      ctx.strokeStyle = hairDk; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(exx - 1.5, y - 9.6); ctx.quadraticCurveTo(exx, y - 10.2, exx + 1.6, y - 9.6); ctx.stroke();
    }
    // nose + mouth hint
    ctx.fillStyle = skinSh; ell(ctx, x + (side ? 3.2 : 0), y - 5.4, 0.6, 0.5);
    ctx.strokeStyle = shade(skin, -40); ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(x + (side ? 1.5 : -1), y - 4); ctx.quadraticCurveTo(x + (side ? 2.6 : 0), y - 3.3, x + (side ? 3.6 : 1), y - 4); ctx.stroke();
    if (a.glasses) { ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x - 2.6, y - 8, 2, 2, 0, 0, 7); ctx.ellipse(x + 2.6, y - 8, 2, 2, 0, 0, 7); ctx.stroke(); }
  }

  // big messy anime hair
  ctx.fillStyle = hair; ctx.beginPath();
  ctx.moveTo(x - 7.5, y - 4);
  ctx.quadraticCurveTo(x - 10.5, y - 9, x - 8.5, y - 15);
  ctx.quadraticCurveTo(x - 10, y - 20, x - 5.5, y - 20);
  ctx.quadraticCurveTo(x - 6, y - 25, x - 1.5, y - 22.5);
  ctx.quadraticCurveTo(x - 1, y - 27, x + 2.5, y - 23.5);
  ctx.quadraticCurveTo(x + 4.5, y - 26, x + 5, y - 21);
  ctx.quadraticCurveTo(x + 10, y - 21, x + 8.5, y - 14);
  ctx.quadraticCurveTo(x + 10.5, y - 9, x + 7.5, y - 4);
  // spiky fringe across the brow
  ctx.quadraticCurveTo(x + 6, y - 8, x + 4, y - 5);
  ctx.quadraticCurveTo(x + 2.5, y - 9, x + 0.5, y - 6);
  ctx.quadraticCurveTo(x - 1, y - 10, x - 3, y - 6);
  ctx.quadraticCurveTo(x - 4.5, y - 9, x - 6, y - 5);
  ctx.quadraticCurveTo(x - 7, y - 8, x - 7.5, y - 4); ctx.closePath(); ctx.fill();
  // ahoge (stray strand)
  ctx.strokeStyle = hair; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x + 0.5, y - 23); ctx.quadraticCurveTo(x + 5, y - 31, x + 7, y - 27); ctx.stroke();
  // highlight sheen
  ctx.fillStyle = hairHi; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.ellipse(x - 1.5, y - 17, 5, 2.3, -0.18, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = hairDk; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(x - 4, y - 19); ctx.quadraticCurveTo(x - 2, y - 12, x - 5, y - 6); ctx.moveTo(x + 3, y - 19); ctx.quadraticCurveTo(x + 5, y - 12, x + 3, y - 6); ctx.stroke();
  if (back) { ctx.strokeStyle = hairDk; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(x + 0.5, y - 13, 4.5, -0.4, 2.6); ctx.stroke(); }

  // hats over hair
  if (a.hat === 'cap') { ctx.fillStyle = a.hatColor; ctx.beginPath(); ctx.ellipse(x, y - 20, 8.5, 4.5, 0, Math.PI, 0); ctx.fill(); rr(ctx, x + 4, y - 19, 7, 2.6, 1.3, a.hatColor); }
  else if (a.hat === 'top') { ctx.fillStyle = a.hatColor; rr(ctx, x - 5, y - 31, 10, 9, 1.5, a.hatColor); rr(ctx, x - 9, y - 23, 18, 2.6, 1.3, a.hatColor); }
  else if (a.hat === 'crown') { ctx.fillStyle = a.hatColor; ctx.beginPath(); ctx.moveTo(x - 6, y - 21); ctx.lineTo(x - 6, y - 25); ctx.lineTo(x - 3, y - 22); ctx.lineTo(x, y - 27); ctx.lineTo(x + 3, y - 22); ctx.lineTo(x + 6, y - 25); ctx.lineTo(x + 6, y - 21); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

// ── Spaceship — sleek grey fighter (pink cockpit, blue engines) ──
const SHIP_SCALE = { scout: 0.92, cruiser: 1.12, frigate: 1.32, dread: 1.55 };
export function drawShip(ctx, x, y, kind, dir, frame) {
  const sc = SHIP_SCALE[kind] || 0.92;
  const ang = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[dir];
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang == null ? Math.PI / 2 : ang); ctx.scale(sc, sc);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const OL = '#191b22', hull = '#5b6068', hullHi = '#878d97', hullDk = '#3a3d44', pink = '#df6c95', pinkHi = '#f6a7c4', blue = '#46c8ff';
  const fill = (col, pts, close = true) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); if (close) ctx.closePath(); ctx.fill(); };
  const outline = (pts) => { ctx.strokeStyle = OL; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); ctx.stroke(); };
  // engine flames + smoke at the tail (+y)
  const f = 5 + (frame % 2 ? 4 : 0);
  for (const ex of [-5, 5]) { ctx.fillStyle = '#ffb15e'; ctx.beginPath(); ctx.ellipse(ex, 17 + f * 0.4, 2.4, f, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#ffe49a'; ctx.beginPath(); ctx.ellipse(ex, 16 + f * 0.3, 1.2, f * 0.6, 0, 0, 7); ctx.fill(); }
  // rear wing pods
  for (const s of [-1, 1]) { const pod = [[s * 7, 4], [s * 13, 7], [s * 13, 16], [s * 7, 15]]; fill(hullDk, pod); outline(pod); ctx.fillStyle = blue; for (let i = 0; i < 3; i++) ctx.fillRect(s * 9 - 1, 9 + i * 2.2, 2, 1.4); }
  // swept wings with pink leading edge
  for (const s of [-1, 1]) {
    const wing = [[s * 4, -2], [s * 20, 9], [s * 16, 13], [s * 4, 8]]; fill(hull, wing); outline(wing);
    fill(pink, [[s * 4, -2], [s * 20, 9], [s * 17, 10], [s * 4, 1]]);
    fill(pinkHi, [[s * 5, -1], [s * 13, 4], [s * 12, 5.5], [s * 5, 1]]);
  }
  // fuselage (pointed nose up)
  const body = [[0, -18], [5, -6], [6, 10], [3, 18], [-3, 18], [-6, 10], [-5, -6]];
  fill(hull, body); fill(hullHi, [[0, -18], [3, -6], [2, 14], [-2, 14], [-3, -6]]); outline(body);
  ctx.fillStyle = hullDk; ctx.fillRect(-1.4, -4, 2.8, 20);
  // cockpit canopy (pink, glowing)
  fill(pink, [[0, -15], [4, -7], [3, 4], [-3, 4], [-4, -7]]);
  fill(pinkHi, [[0, -13], [2.4, -7], [1.6, -1], [-1.6, -1], [-2.4, -7]]);
  ctx.fillStyle = '#ffd9e8'; ctx.beginPath(); ctx.ellipse(-0.6, -9, 1, 2.4, 0, 0, 7); ctx.fill();
  // nose tip + chin
  ctx.strokeStyle = OL; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(0, -15); ctx.stroke();
  fill(hullDk, [[-3, 17], [3, 17], [2, 21], [-2, 21]]);
  ctx.restore();
}

// ── Sword (red/silver) for the swing animation ──────────────
export function drawSword(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.lineJoin = 'round';
  const sil = '#d6dae0', silHi = '#f4f6f8', silDk = '#9aa0a8', red = '#b22a33', redDk = '#7e1d24', OL = '#2a2024';
  // blade (tip up at y = -27)
  ctx.fillStyle = sil; ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(2.6, -19); ctx.lineTo(2.6, -3); ctx.lineTo(-2.6, -3); ctx.lineTo(-2.6, -19); ctx.closePath(); ctx.fill();
  ctx.fillStyle = silHi; ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(0.9, -19); ctx.lineTo(0.9, -3); ctx.lineTo(-0.7, -3); ctx.lineTo(-0.9, -19); ctx.closePath(); ctx.fill();
  ctx.fillStyle = red; ctx.fillRect(-0.5, -23, 1, 17);
  ctx.strokeStyle = OL; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(2.6, -19); ctx.lineTo(2.6, -3); ctx.lineTo(-2.6, -3); ctx.lineTo(-2.6, -19); ctx.closePath(); ctx.stroke();
  // crossguard
  ctx.fillStyle = sil; ctx.beginPath(); ctx.roundRect(-7.5, -3.6, 15, 3.6, 1.6); ctx.fill();
  ctx.fillStyle = red; ctx.fillRect(-5.5, -3.2, 11, 1.5); ctx.fillStyle = silDk; ctx.fillRect(-7.5, -0.6, 15, 0.9);
  // handle
  ctx.fillStyle = red; ctx.beginPath(); ctx.roundRect(-1.5, 0, 3, 7, 1.3); ctx.fill();
  ctx.fillStyle = redDk; for (let i = 1; i < 6; i += 2) ctx.fillRect(-1.5, i, 3, 0.8);
  // pommel gem
  ctx.fillStyle = '#8a4fd0'; ctx.beginPath(); ctx.ellipse(0, 8.6, 2.1, 2.3, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#e0c2ff'; ctx.beginPath(); ctx.ellipse(-0.5, 8, 0.8, 1, 0, 0, 7); ctx.fill();
  ctx.restore();
}

// ── Creatures (smooth anime / chibi) ────────────────────────
export function drawCreature(ctx, x, y, c, frame) {
  const bob = Math.sin(frame * 0.6) * 0.7;
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ell(ctx, x, y + 8, 8, 2.6, 'rgba(0,0,0,.22)');
  ctx.translate(0, bob);
  if (c.kind === 'alien') drawAlien(ctx, x, y, c.color || '#b06bff');
  else if (c.kind === 'sporeling') drawSporeling(ctx, x, y, c.color || '#74c365');
  else if (c.kind === 'sheep') drawSheep(ctx, x, y, !!c.aggressive);
  else drawSkeletonMob(ctx, x, y, c.color || '#9aa0b0');   // gargoyle / default
  ctx.restore();
}
function drawSheep(ctx, x, y, angry) {
  const wool = '#f3f4f6', woolSh = '#d6dade', face = '#3a3540';
  // fluffy body (overlapping bumps)
  for (const [dx, dy] of [[-5, 0], [-2, -2], [2, -2], [5, 0], [-3, 2], [3, 2], [0, 1]]) ell(ctx, x + dx, y + dy, 4, 3.4, dy < 0 ? wool : woolSh);
  ctx.fillStyle = wool; ctx.beginPath(); ctx.ellipse(x, y - 1, 7, 5, 0, 0, 7); ctx.fill();
  // legs
  ctx.fillStyle = face; ctx.fillRect(x - 4, y + 4, 1.6, 4); ctx.fillRect(x + 2.4, y + 4, 1.6, 4);
  // head
  ell(ctx, x + 6, y - 1, 3, 3.4, face); ell(ctx, x + 4.6, y - 4, 2, 1.6, wool);   // head + wool tuft
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x + 7, y - 1.6, 0.8, 1, 0, 0, 7); ctx.fill();
  ctx.fillStyle = angry ? '#ff3b3b' : '#1a1410'; ell(ctx, x + 7, y - 1.6, 0.5, 0.7, angry ? '#ff3b3b' : '#1a1410');
  // ear
  ell(ctx, x + 4.5, y - 1.5, 1.4, 0.9, face);
  if (angry) { ctx.strokeStyle = '#ff5a3a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x + 4.6, y - 5.5); ctx.lineTo(x + 5.6, y - 4); ctx.moveTo(x + 8, y - 5); ctx.lineTo(x + 7.4, y - 3.6); ctx.stroke(); }
}
function drawSkeletonMob(ctx, x, y, accent) {
  const bone = '#e9e4d6', boneSh = '#c2bca9', cloth = '#3a2e36', red = '#7a2230';
  rr(ctx, x - 5, y + 2, 4, 6, 1.6, boneSh); rr(ctx, x + 1, y + 2, 4, 6, 1.6, boneSh);   // legs
  rr(ctx, x - 5, y + 7, 5, 2.5, 1, '#5a3a22'); rr(ctx, x + 1, y + 7, 5, 2.5, 1, '#5a3a22'); // boots
  rr(ctx, x - 6, y - 4, 12, 9, 3, cloth);                                                 // torso (dark armor)
  ctx.fillStyle = red; ctx.beginPath(); ctx.moveTo(x - 5, y + 4); ctx.lineTo(x, y + 1); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x + 4, y + 6); ctx.lineTo(x - 4, y + 6); ctx.closePath(); ctx.fill();
  rr(ctx, x - 9, y - 4, 3.5, 7, 1.5, accent); rr(ctx, x + 5.5, y - 4, 3.5, 7, 1.5, accent); // shoulder pauldrons
  ell(ctx, x, y - 10, 6.5, 6.5, bone); ell(ctx, x, y - 8.5, 5.5, 5, bone);                 // skull
  ell(ctx, x - 2.4, y - 10, 1.7, 2, '#1a1410'); ell(ctx, x + 2.4, y - 10, 1.7, 2, '#1a1410'); // eye sockets
  ctx.fillStyle = '#ff5a3a'; ctx.globalAlpha = 0.8; ell(ctx, x - 2.4, y - 10, 0.7, 0.9); ell(ctx, x + 2.4, y - 10, 0.7, 0.9); ctx.globalAlpha = 1;
  ctx.strokeStyle = boneSh; ctx.lineWidth = 0.7; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * 1.3, y - 6.5); ctx.lineTo(x + i * 1.3, y - 5); ctx.stroke(); } // teeth
  // tiny sword
  ctx.strokeStyle = '#aeb4c0'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x + 7, y + 4); ctx.lineTo(x + 11, y - 6); ctx.stroke();
  ctx.strokeStyle = '#6b4a30'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + 5.5, y + 5); ctx.lineTo(x + 8, y + 3.5); ctx.stroke();
}
function drawAlien(ctx, x, y, col) {
  const sh = shade(col, -34), hi = shade(col, 26);
  rr(ctx, x - 4, y + 2, 3.5, 6, 1.5, sh); rr(ctx, x + 0.5, y + 2, 3.5, 6, 1.5, sh);       // legs
  rr(ctx, x - 6, y - 3, 12, 9, 4, vgrad(ctx, y - 3, y + 6, hi, sh));                      // body
  ell(ctx, x, y - 9, 7, 6.5, vgrad(ctx, y - 15, y - 3, hi, col));                          // big head
  ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 3, y - 14); ctx.quadraticCurveTo(x - 6, y - 19, x - 4, y - 20); ctx.moveTo(x + 3, y - 14); ctx.quadraticCurveTo(x + 6, y - 19, x + 4, y - 20); ctx.stroke(); // antennae
  ell(ctx, x - 4, y - 20, 1.4, 1.4, '#d9b8ff'); ell(ctx, x + 4, y - 20, 1.4, 1.4, '#d9b8ff');
  ell(ctx, x - 2.6, y - 9, 2.2, 2.8, '#0d0a14'); ell(ctx, x + 2.6, y - 9, 2.2, 2.8, '#0d0a14'); // big eyes
  ctx.fillStyle = '#c9ff6a'; ell(ctx, x - 2.6, y - 9.5, 0.9, 1.1); ell(ctx, x + 2.6, y - 9.5, 0.9, 1.1);
  ctx.fillStyle = '#fff'; ell(ctx, x - 2.2, y - 10, 0.4, 0.5); ell(ctx, x + 3, y - 10, 0.4, 0.5);
}
function drawSporeling(ctx, x, y, col) {
  const sh = shade(col, -30), hi = shade(col, 28), cap = '#b5543f';
  rr(ctx, x - 5, y - 2, 10, 9, 4.5, vgrad(ctx, y - 2, y + 7, hi, sh));                    // round body
  ell(ctx, x - 2.2, y, 1.7, 2.2, '#16331a'); ell(ctx, x + 2.2, y, 1.7, 2.2, '#16331a');   // eyes
  ctx.fillStyle = '#fff'; ell(ctx, x - 1.8, y - 0.5, 0.5, 0.6); ell(ctx, x + 2.6, y - 0.5, 0.5, 0.6);
  ctx.strokeStyle = '#16331a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(x, y + 3, 2, 0.2, Math.PI - 0.2); ctx.stroke(); // smile
  ctx.fillStyle = cap; ctx.beginPath(); ctx.ellipse(x, y - 4, 8, 5, 0, Math.PI, 0); ctx.fill();   // mushroom cap
  ell(ctx, x - 3, y - 5, 1.5, 1.1, '#e8d9c4'); ell(ctx, x + 2.5, y - 4, 1.2, 0.9, '#e8d9c4'); ell(ctx, x, y - 6.5, 1.3, 1, '#e8d9c4'); // spots
}

// ── Themed city shop buildings (Bank / Alchemist / Market), house-sized ──
function drawShopBuilding(ctx, x, y, kind, t) {
  const W = 34, H = 26, gy = y + 7;
  const pal = ({
    bank: { wall: '#e7e0cf', wallHi: '#f4efe2', roof: '#3d6fb0', roofHi: '#5a90d8', trim: '#caa84a', label: 'BANK' },
    alchemist: { wall: '#5a4a86', wallHi: '#6f5da0', roof: '#3a2d62', roofHi: '#52437f', trim: '#c79bff', label: 'ALCHEMY' },
    marketplace: { wall: '#caa06a', wallHi: '#dcb87f', roof: '#b6492f', roofHi: '#d96a4a', trim: '#ffcf4d', label: 'MARKET' },
  })[kind] || { wall: '#cccccc', wallHi: '#dddddd', roof: '#888888', roofHi: '#aaaaaa', trim: '#ffcf4d', label: 'SHOP' };
  ctx.save(); ctx.lineJoin = 'round';
  ell(ctx, x, gy + 3, W * 0.55, 5, 'rgba(0,0,0,.28)');
  r(ctx, x - W / 2, gy - H, W, H, pal.wall);
  r(ctx, x - W / 2, gy - H, 4, H, pal.wallHi); r(ctx, x + W / 2 - 4, gy - H, 4, H, 'rgba(0,0,0,.16)');
  // gable roof
  ctx.fillStyle = pal.roof; ctx.beginPath(); ctx.moveTo(x - W / 2 - 5, gy - H + 3); ctx.lineTo(x, gy - H - 13); ctx.lineTo(x + W / 2 + 5, gy - H + 3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = pal.roofHi; ctx.beginPath(); ctx.moveTo(x, gy - H - 13); ctx.lineTo(x - W / 2 - 5, gy - H + 3); ctx.lineTo(x - W / 2 + 3, gy - H + 3); ctx.closePath(); ctx.fill();
  r(ctx, x - 6, gy - 14, 12, 14, '#33271c');                                            // door
  if (kind === 'bank') {
    for (const c2 of [-12, -6, 6, 12]) r(ctx, x + c2 - 1.5, gy - H + 7, 3, H - 9, '#f6f1e6');   // columns
    ctx.strokeStyle = pal.trim; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - W / 2, gy - H + 5); ctx.lineTo(x + W / 2, gy - H + 5); ctx.stroke();
    ctx.fillStyle = pal.trim; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', x, gy - H - 4);
  } else if (kind === 'alchemist') {
    r(ctx, x - W / 2 + 5, gy - H + 8, 6, 6, '#caa6ff'); r(ctx, x + W / 2 - 11, gy - H + 8, 6, 6, '#caa6ff');
    r(ctx, x + W / 2 - 10, gy - 7, 8, 7, '#2a2440');                                     // potion table
    ctx.fillStyle = '#6ad0a0'; ctx.beginPath(); ctx.moveTo(x + W / 2 - 8, gy - 7); ctx.lineTo(x + W / 2 - 3, gy - 7); ctx.lineTo(x + W / 2 - 4, gy - 2); ctx.lineTo(x + W / 2 - 7, gy - 2); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 3; i++) { const yy = gy - 9 - i * 3 + Math.sin(t * 3 + i) * 1; ell(ctx, x + W / 2 - 5.5, yy, 1 + i * 0.3, 1 + i * 0.3, 'rgba(150,240,190,.55)'); }
    ctx.fillStyle = pal.trim; ctx.beginPath(); ctx.arc(x, gy - H - 4, 3.2, 0, 7); ctx.fill(); ctx.fillStyle = pal.roof; ctx.beginPath(); ctx.arc(x + 1.6, gy - H - 4, 3.2, 0, 7); ctx.fill();
  } else {
    for (let i = 0; i < 6; i++) r(ctx, x - W / 2 + 2 + i * 5.3, gy - H + 6, 5.3, 5, i % 2 ? '#f4efe2' : '#b6492f');   // striped awning
    r(ctx, x - W / 2 - 2, gy - 6, 8, 6, '#7a5230'); ell(ctx, x - W / 2 + 1, gy - 7, 1.7, 1.7, '#e0606b'); ell(ctx, x - W / 2 + 4, gy - 7, 1.7, 1.7, '#5fd16a');   // fruit crate
  }
  // hanging sign
  r(ctx, x - 14, gy - H - 2, 28, 9, pal.trim); ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1; ctx.strokeRect(x - 14, gy - H - 2, 28, 9);
  ctx.fillStyle = '#1a1a1a'; ctx.font = '6px "Vanilla Caramel", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(pal.label, x, gy - H + 2.6);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.restore();
}

// ── NPC (villagers / shopkeepers) — bigger & distinct from players ──
const NPC_ICON = { bank: '💰', alchemist: '⚗️', marketplace: '🛒', guardian: '🛡️', lumberjack: '🪓', miner: '⛏️', builder: '🔨', colonise: '🪐' };
export function drawNpc(ctx, x, y, role, color, t) {
  const c = color || '#caa84a';
  const robe = c, robeSh = shade(c, -30), robeHi = shade(c, 24);
  const skin = '#f2c79a', skinSh = shade(skin, -26);
  const tt = t || 0, bob = Math.sin(tt * 1.6 + x) * 0.6;
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // ground shadow
  ell(ctx, x, y + 19, 11, 3.6, 'rgba(0,0,0,.22)');
  ctx.translate(0, bob);
  // wide bell robe (no visible legs → clearly not a player)
  ctx.fillStyle = vgrad(ctx, y - 2, y + 19, robeHi, robeSh); ctx.beginPath();
  ctx.moveTo(x - 6.5, y - 2);
  ctx.quadraticCurveTo(x - 14, y + 16, x - 12, y + 19);
  ctx.quadraticCurveTo(x, y + 16, x + 12, y + 19);
  ctx.quadraticCurveTo(x + 14, y + 16, x + 6.5, y - 2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#efd89a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 11.5, y + 18); ctx.quadraticCurveTo(x, y + 15, x + 11.5, y + 18); ctx.stroke();
  ctx.strokeStyle = robeSh; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x, y + 16); ctx.stroke();
  // stubby sleeves + hands
  for (const s of [-1, 1]) { ell(ctx, x + s * 8.5, y + 4, 3.1, 5.2, robeSh); ell(ctx, x + s * 9, y + 8.5, 2.4, 2.4, skin); }
  // big round head
  ctx.fillStyle = vgrad(ctx, y - 17, y - 4, shade(skin, 12), skinSh); ctx.beginPath(); ctx.arc(x, y - 9, 8, 0, 7); ctx.fill();
  // hood / cap in the role colour
  ctx.fillStyle = robe; ctx.beginPath(); ctx.arc(x, y - 10.5, 8.6, Math.PI * 1.03, Math.PI * 1.97); ctx.closePath(); ctx.fill();
  ctx.fillStyle = robeHi; ctx.beginPath(); ctx.arc(x, y - 12.5, 4.8, Math.PI * 1.1, Math.PI * 1.9); ctx.fill();
  // friendly face
  ctx.fillStyle = '#3a2a22'; ctx.beginPath(); ctx.arc(x - 2.8, y - 8.4, 1.2, 0, 7); ctx.arc(x + 2.8, y - 8.4, 1.2, 0, 7); ctx.fill();
  ctx.strokeStyle = '#3a2a22'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y - 6.4, 2.4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.fillStyle = 'rgba(232,120,110,.4)'; ctx.beginPath(); ctx.arc(x - 4.6, y - 6.2, 1.4, 0, 7); ctx.arc(x + 4.6, y - 6.2, 1.4, 0, 7); ctx.fill();
  // floating role-icon bubble
  const icon = NPC_ICON[role] || '❔';
  const fy = y - 23 + Math.sin(tt * 2 + x) * 1.4;
  ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.beginPath(); ctx.arc(x, fy, 7, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#1a1a1a'; ctx.fillText(icon, x, fy + 0.5);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.restore();
}

// ── UI avatars ──────────────────────────────────────────────
export function avatarDataURL(app, size = 38) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'); ctx.scale(size / 38, size / 38);
  drawPlayer(ctx, 19, 22, app, 'down', 0, false, 'scout'); return cv.toDataURL();
}
export function unitAvatarURL(role, size = 38) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const colors = { Pilot: '#48b6ff', Fighter: '#ff5a6e', Healer: '#5fd16a', Mage: '#b07bff' };
  ctx.fillStyle = '#10162b'; ctx.fillRect(0, 0, size, size);
  drawPlayer(ctx, size / 2, size * .62, { skin: '#f0c080', shirt: colors[role] || '#888', pants: '#333', shoes: '#222' }, 'down', 0, false, 'scout');
  return cv.toDataURL();
}
