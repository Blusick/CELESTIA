import * as W from './server/world.js';
const isl = W.worldDescriptor().islands;
const hub = isl.find(i=>i.id==='hub');
const f = hub.features;
const npcs = f.filter(x=>x.t==='npc');
const shops = f.filter(x=>x.t==='shopbuilding');
const houses = f.filter(x=>x.t==='house9');
console.log('npcs:', npcs.map(n=>n.name+'@'+n.tx+','+n.ty).join(' | '));
console.log('shopbuildings:', shops.map(s=>s.kind+'@'+s.tx+','+s.ty).join(' | '));
console.log('house9 count:', houses.length);
// spacing between the 3 shop NPCs
const shopNpcs = npcs.filter(n=>n.role!=='guardian');
for(let i=0;i<shopNpcs.length;i++)for(let j=i+1;j<shopNpcs.length;j++){const a=shopNpcs[i],b=shopNpcs[j];console.log(`dist ${a.role}-${b.role}:`, Math.round(Math.hypot(a.tx-b.tx,a.ty-b.ty)));}
