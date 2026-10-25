import {app,BrowserWindow} from 'electron';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import path from 'node:path';
import {ConfigService,FileConfigStore,RemoteRuntimeDriver,PluginManager,discoverPlugins} from '../../packages/host-kernel/src/index.js';
import type {PluginManifest,Result} from '../../packages/contracts/src/index.js';
const unwrap=<T>(r:Result<T>)=>{assert.equal(r.ok,true);if(!r.ok)throw new Error('Fixture failed');return r.value;};
const report:Record<string,unknown>={status:'starting',fixtureOnly:true};app.setPath('userData',path.join(__dirname,'profile'));
void app.whenReady().then(async()=>{
 const root=await fs.mkdtemp(path.join(__dirname,'run-')),plugins=path.join(root,'plugins'),configRoot=path.join(root,'config');await fs.mkdir(plugins);await fs.mkdir(configRoot);const directory=path.join(plugins,'package');await fs.mkdir(directory);
 const id={pluginId:'test.migration',instanceId:'default'};
 const oldManifest:PluginManifest={schemaVersion:1,id:id.pluginId,version:'1.0.0',displayName:{'zh-CN':'测试'},description:{'zh-CN':'自有配置夹具'},license:'MIT',host:'^1.0.0',platforms:['win32-x64'],entries:{runtime:'entry.mjs'},config:{version:1,schema:{type:'object',additionalProperties:false,properties:{value:{type:'integer',default:1}},required:['value']}}};
 const target=structuredClone(oldManifest);target.version='2.0.0';target.config!.version=2;target.config!.schema={type:'object',additionalProperties:false,properties:{value:{type:'integer'},workerPid:{type:'integer'}},required:['value','workerPid']};
 await fs.writeFile(path.join(directory,'plugin.json'),JSON.stringify(target));
 await fs.writeFile(path.join(directory,'entry.mjs'),'export default {activate(){throw new Error("fixture activation failure");},async migrateConfig(request){return {value:request.data.value+1,workerPid:process.pid};}};');
 const store=new FileConfigStore(configRoot),configs=new ConfigService(store);unwrap(configs.register(id,oldManifest));const before=unwrap(await configs.initialize(id));assert.equal(before.revision,1);unwrap(configs.register(id,target));
 const driver=new RemoteRuntimeDriver({executable:process.execPath,workerEntry:path.resolve(__dirname,'../../apps/desktop/dist/runtime/worker.cjs'),roots:[{directory:plugins,origin:'user'}]});const manager=new PluginManager({driver,hostApiVersion:'1.0.0',platform:'win32-x64',trust:async()=>true,readiness:async()=>null});
 try{report['stage']='migration';await driver.ready();const discovered=await discoverPlugins([{directory:plugins,origin:'user'}]);const candidate=discovered.plugins[0]!;unwrap(manager.install(candidate.manifest,{directory:candidate.directory,origin:candidate.origin}));
 const tx=unwrap(await configs.prepareMigration(id,source=>driver.migrateConfig({owner:{...id,generation:1},manifest:target,entryPath:path.join(directory,'entry.mjs')},source)));
 assert.equal((await store.read(id))?.schemaVersion,1);assert.equal(tx.preview.data['workerPid'],driver.status().pid);assert.notEqual(tx.preview.data['workerPid'],process.pid);
 const committed=unwrap(await tx.commit());assert.equal(committed.schemaVersion,2);assert.equal(committed.data['value'],2);report['stage']='activation-failure';assert.equal((await manager.enable(id,committed.data)).ok,false);
 const rollback=unwrap(await tx.rollback());assert.equal(rollback.schemaVersion,1);assert.equal(rollback.revision,3);assert.deepEqual(rollback.data,{value:1});unwrap(configs.register(id,oldManifest));assert.deepEqual(unwrap(await configs.get(id)).data,{value:1});
 const reread=await new FileConfigStore(configRoot).read(id);assert.equal(reread?.revision,3);assert.deepEqual(reread?.data,{value:1});assert.equal(BrowserWindow.getAllWindows().length,0);
 report['checks']=['real-file-defaults','migration-only-in-worker','staged-no-write','target-schema-validation','atomic-commit','new-activation-rejected','revision-guarded-config-rollback','fresh-store-roundtrip'];report['runtime']={electron:process.versions.electron,node:process.versions.node};report['status']='passed';
 }finally{configs.close();await manager.shutdown();const shutdown=await driver.dispose();assert.equal(shutdown.exitConfirmed,true);report['shutdown']=shutdown;}
}).catch(()=>{report['status']='failed';}).finally(async()=>{await fs.writeFile(path.join(__dirname,'report.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+String.fromCharCode(10));app.exit(report['status']==='passed'?0:1);});
