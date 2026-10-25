import {app} from 'electron';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {RemoteRuntimeDriver,PluginManager,discoverPlugins} from '../../packages/host-kernel/src/index.js';
import type {Result} from '../../packages/contracts/src/index.js';
import {consoleSnapshot} from '../../apps/desktop/src/main/console-snapshot.js';
const root=path.resolve(__dirname,'../..'),report:Record<string,unknown>={status:'starting',fixtureOnly:true};
const take=<T>(value:Result<T>):T=>{if(!value.ok)throw new Error('fixture operation failed');return value.value;};
app.setPath('userData',path.join(__dirname,'profile'));
void app.whenReady().then(async()=>{
 const directory=path.join(__dirname,'plugins'),driver=new RemoteRuntimeDriver({executable:process.execPath,workerEntry:path.join(root,'apps/desktop/dist/runtime/worker.cjs'),roots:[{directory,origin:'user'}]});
 const manager=new PluginManager({driver,hostApiVersion:'1.0.0',platform:'win32-x64',trust:async()=>true,readiness:async()=>null});
 try{
  await driver.ready();const discovered=await discoverPlugins([{directory,origin:'user'}]);assert.equal(discovered.plugins.length,2);
  for(const candidate of discovered.plugins)take(manager.install(candidate.manifest,{directory:candidate.directory,origin:'user'}));
  const id={pluginId:'test.contribution-runtime',instanceId:'default'},first=take(await manager.enable(id)).owner;
  report['stage']='active';const rows=manager.contributions();assert.equal(rows.length,5);assert.deepEqual(rows.map(row=>row.declaration.kind).sort(),['command','hotkey','panel','settings','shortcut-button']);
  const snapshot=consoleSnapshot({version:1,runtime:'ready',installedPlugins:2,activePlugins:1,unreadyPlugins:0,pendingRestartPlugins:0,runningTasks:0,pendingWork:0},manager.list(),{name:'AI 桌宠',version:'0.0.0',electron:process.versions.electron!,node:process.versions.node,platform:process.platform+'-'+process.arch},rows);
  assert.equal(snapshot.contributions.length,5);assert.equal(JSON.stringify(snapshot.contributions).includes('panel.html'),false);assert.equal(JSON.stringify(snapshot.contributions).includes('handler'),false);
  report['stage']='stop';const stopping=manager.disable(id);assert.equal(manager.contributions().length,0);take(await stopping);
  const fresh=take(await manager.enable(id)).owner;assert.ok(fresh.generation>first.generation);assert.ok(manager.contributions().every(row=>row.owner.generation===fresh.generation));
  report['stage']='rollback';assert.equal((await manager.enable({pluginId:'test.contribution-failure',instanceId:'default'})).ok,false);assert.equal(manager.contributions().length,5);assert.ok(manager.contributions().every(row=>row.owner.pluginId===id.pluginId));
  take(await manager.reportFault(fresh));assert.equal(manager.contributions().length,0);
  report['status']='passed';report['checks']=['real-worker-five-kinds','atomic-active-publication','metadata-only-console-projection','immediate-disable-removal','fresh-generation-registration','failed-plugin-rollback','runtime-fault-removal'];
 }finally{await manager.shutdown();report['shutdown']=await driver.dispose();}
}).catch(()=>{report['status']='failed';}).finally(async()=>{await fs.writeFile(path.join(__dirname,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(report['status']==='passed'?0:1);});
