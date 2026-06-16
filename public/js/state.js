// ── Shared client game state ────────────────────────────────
export const G = {
  me: null,
  guest: true,
  world: null,
  tiles: {},                 // "x,y" -> tile data
  players: new Map(),        // id -> player
  creatures: new Map(),      // id -> creature
  nodes: [],                 // farmable resource nodes (client-deterministic)
  market: [],

  inv: { iron: 0, meat: 0, wood: 0, plank: 0, ingot: 0, sword: 0, gold: 0, goldingot: 0, goldsword: 0, diamond: 0, diamondsword: 0, cookedmeat: 0, gear: [], items: [] },
  equip: { top: null, bottom: null, weapon: null, shield: null, shoes: null },   // weapon = kind string; armour slots = gear object
  invMax: 300,
  bank: { iron: 0, meat: 0, wood: 0, plank: 0, ingot: 0 },
  level: 1, xp: 0, xpNeed: 95, hp: 100, maxHp: 100,
  stats: { health: 0, strength: 0, agility: 0, resistance: 0 },   // points the player allocated
  statPoints: 0,                                                  // unspent points (+5 per level)

  appearance: { skin: '#f0c080', shirt: '#7c8a4a', pants: '#2b3a63', shoes: '#5a3a22', hat: 'none', hatColor: '#ff5577', glasses: false },
  ship: 'scout',
  ownedShips: ['scout'],     // ships the player has unlocked
  builtShips: [],            // ships placed on island {kind,x,y}
  army: { Pilot: 0, Fighter: 0, Healer: 0, Mage: 0 },

  buildMode: false,
  buildBrush: { type: 'texture', value: 'grass' },
  selection: null,           // {x0,y0,x1,y1} during drag
  soundOn: true,
  camera: { x: 0, y: 0 },
};

export function tileKey(x, y) { return `${x},${y}`; }
export function xpForLevel(l) { return (50 + l * 45) * 3; }   // 3× harder to level up
