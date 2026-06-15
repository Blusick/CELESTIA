import * as W from './server/world.js';
const isl = W.worldDescriptor().islands;
const h = isl.find(i=>i.id==='hostile');
const rocks = (h.features||[]).filter(f=>f.t==='rock').length;
const crys = (h.features||[]).filter(f=>f.t==='crystal').length;
console.log('hostile rock features:', rocks, '| crystals:', crys);
