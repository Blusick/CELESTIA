import WebSocket from 'ws';
const ws=new WebSocket('ws://localhost:3000'); let me, creatures=[], kills=0, drops=0, perKill={};
ws.on('message', d=>{ const m=JSON.parse(d);
  if(m.type==='init'){ me=m.you; creatures=m.creatures.filter(c=>!c.dead); tick(); }
  if(m.type==='kill'){ kills++; const n=(m.drops||[]).length; drops+=n; if(!perKill[n])perKill[n]=0; perKill[n]++; }
});
function tick(){
  // teleport near each creature and one-shot it
  let i=0;
  const iv=setInterval(()=>{
    if(i>=creatures.length || kills>=40){ clearInterval(iv); setTimeout(()=>{ console.log('kills',kills,'totalDrops',drops,'dist',JSON.stringify(perKill)); ws.close(); },300); return; }
    const c=creatures[i++];
    ws.send(JSON.stringify({type:'move', x:c.x, y:c.y, dir:'down', moving:false}));
    ws.send(JSON.stringify({type:'attackCreature', cid:c.id, dmg:9999}));
  }, 30);
}
