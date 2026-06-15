import WebSocket from 'ws';
const WALLET='TESTWALLET123';
function run(send){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:3000'); const got={};
  ws.on('message',d=>{ const m=JSON.parse(d); got[m.type]=m; if(m.type==='init'){ ws.send(JSON.stringify({type:'profile',name:'Tester',wallet:WALLET})); if(send) send(ws); setTimeout(()=>{ws.close();res(got);},500); } });
  ws.on('error',e=>res({err:e.message})); });}
await run(ws=>ws.send(JSON.stringify({type:'sync',inv:{iron:5},level:7,xp:123,maxHp:140,stats:{health:40,strength:6,agility:4,resistance:10},statPoints:3})));
await new Promise(r=>setTimeout(r,400));
const g=await run();
const pl=g.profileLoad;
console.log('RESTORED → level:',pl?.level,'xp:',pl?.xp,'maxHp:',pl?.maxHp,'inv:',JSON.stringify(pl?.profile?.inv),'stats:',JSON.stringify(pl?.profile?.stats),'pts:',pl?.profile?.statPoints);
