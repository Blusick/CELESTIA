import * as W from './server/world.js';
const h = W.worldDescriptor().islands.find(i=>i.id==='hub');
const tom = (h.features||[]).find(f=>f.role==='colonise');
const dome = (h.features||[]).find(f=>f.t==='colony');
console.log('Tom NPC:', tom? `${tom.name} @${tom.tx},${tom.ty}`:'MISSING', '| dome @', dome?`${dome.tx},${dome.ty}`:'MISSING');
