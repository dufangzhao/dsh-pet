import {app,BrowserWindow} from 'electron';
import {spawn} from 'node:child_process';
import type {Duplex} from 'node:stream';
import * as fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {ControlEndpoint} from '../../packages/host-kernel/src/ipc/control-endpoint.js';
import {childProcessControl} from '../../packages/host-kernel/src/ipc/node-control-transport.js';
import {FramedMediaPort} from '../../packages/host-kernel/src/ipc/media-port.js';
import {CreditMediaSender} from '../../packages/host-kernel/src/tasks/credit-sender.js';
import type {Result} from '../../packages/contracts/src/index.js';
const unwrap=<T>(r:Result<T>):T=>{assert.equal(r.ok,true);if(!r.ok)throw new Error('Fixture failed');return r.value;};
app.setPath('userData',path.join(__dirname,'profile'));const report:Record<string,unknown>={status:'starting',fixtureOnly:true};
void app.whenReady().then(async()=>{
 const env:NodeJS.ProcessEnv={ELECTRON_RUN_AS_NODE:'1'};for(const name of ['SystemRoot','WINDIR','TEMP','TMP','PATH'])if(process.env[name])env[name]=process.env[name];
 const child=spawn(process.execPath,[path.join(__dirname,'child.cjs')],{env,stdio:['ignore','inherit','inherit','ipc','pipe'],windowsHide:true});
 const exited=new Promise<number|null>((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 const owner={pluginId:'core.runtime',instanceId:'probe',generation:1};const identity={owner,streamId:'stream',taskId:'media-task'};const signal=new AbortController();
 const media=new FramedMediaPort(child.stdio[4] as Duplex,()=>({ok:false,error:{code:'invalid-input',messageKey:'errors.invalid-input',retryable:false}}),()=>{});
 const sender=new CreditMediaSender(identity,frame=>media.write(frame),signal.signal);
 const endpoint=new ControlEndpoint(childProcessControl(child),{sessionId:'ipc-probe',owner,live:()=>true,onStreamControl:message=>{assert.equal(message.streamId,'stream');assert.equal(message.taskId,'media-task');if(message.type==='stream-credit')unwrap(sender.grant(message.credits));}});
 const watchdog=setTimeout(()=>child.kill(),15000);
 try{
  report['runtime']={electron:process.versions.electron,node:process.versions.node};report['stage']='rpc';assert.deepEqual(unwrap(await endpoint.request('echo',{fixture:1})),{fixture:1});
  unwrap(await endpoint.request('open',null));report['stage']='media-window';
  const frame=(sequence:number)=>({header:{...identity,sequence,byteLength:1},payload:new Uint8Array([sequence])});
  for(let i=0;i<8;i++)unwrap(await sender.send(frame(i)));assert.equal((await sender.send(frame(8))).ok,false);assert.equal(unwrap(await endpoint.request('buffered',null)),8);
  const wait=sender.waitWritable();assert.equal(sender.snapshot().waiters,1);assert.deepEqual(unwrap(await endpoint.request('consume',null)),{sequence:0,byte:0});unwrap(await wait);unwrap(await sender.send(frame(8)));
  for(let i=1;i<9;i++)assert.deepEqual(unwrap(await endpoint.request('consume',null)),{sequence:i,byte:i});unwrap(await sender.drain());const sequence=unwrap(sender.end());unwrap(endpoint.streamControl({type:'stream-end',streamId:'stream',taskId:'media-task',sequence}));assert.deepEqual(unwrap(await endpoint.request('end',null)),{done:true});
  report['stage']='cancellation';const cancel=new AbortController();const pending=endpoint.request('hold',null,{signal:cancel.signal});unwrap(await endpoint.request('holding',null));cancel.abort();assert.equal((await pending).ok,false);assert.deepEqual(unwrap(await endpoint.request('stats',null)),{cancellations:1,consumed:9});
  report['stage']='crash';const crash=endpoint.request('crash',null);assert.equal((await crash).ok,false);const code=await exited;assert.equal(code,17);assert.equal(endpoint.diagnostics().pendingRequests,0);assert.equal(endpoint.diagnostics().closed,true);
  report['checks']=['native-control-rpc','separate-framed-media','8-frame-credit-window','consumer-credit-return','ordered-9-frame-drain','cancel-forwarded','owned-child-exit17-invalidates-rpc'];report['childExitCode']=code;report['windowCount']=BrowserWindow.getAllWindows().length;assert.equal(report['windowCount'],0);report['status']='passed';
 }finally{clearTimeout(watchdog);signal.abort();endpoint.close();media.close();if(child.exitCode===null)child.kill();await exited.catch(()=>{});report['cleanup']='complete';}
}).catch(()=>{report['status']='failed';process.exitCode=1;}).finally(async()=>{await fs.writeFile(path.join(__dirname,'report.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+String.fromCharCode(10));app.exit(report['status']==='passed'?0:1);});
