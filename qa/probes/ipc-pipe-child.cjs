'use strict';
const net = require('node:net');
try {
  const media = new net.Socket({fd:4, readable:true, writable:true});
  let received=Buffer.alloc(0);
  media.on('data',chunk=>{received=Buffer.concat([received,chunk]);if(received.length>1024)process.exit(2);if(received.length===4){media.write(Buffer.from([received[3],received[2],received[1],received[0]]));process.send({type:'media-received',bytes:received.length});}});
  process.on('message',message=>{if(message&&message.type==='stop'){media.destroy();process.disconnect();}});
  process.on('disconnect',()=>media.destroy());
  process.send({type:'ready',electron:process.versions.electron,node:process.versions.node});
} catch { process.send?.({type:'unsupported-pipe'}); process.exitCode=1; process.disconnect?.(); }
