import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { CordisRuntimeDriver, PluginManager } from '../../packages/host-kernel/src/index.js';
import { makeProviderPlugin, makeRecordingPlugin, makeFailingPlugin } from '../../packages/contract-tests/src/index.js';
import type { PluginManifest, Result } from '../../packages/contracts/src/index.js';
const manifest=(id:string,extra:Partial<PluginManifest>={}):PluginManifest=>({schemaVersion:1,id,version:'1.0.0',displayName:{'zh-CN':'测试'},description:{'zh-CN':'公开测试'},license:'MIT',host:'^1.0.0',platforms:['win32-x64'],entries:{runtime:'index.js'},...extra});
const id=(pluginId:string)=>({pluginId,instanceId:'default'});const unwrap=<T>(result:Result<T>):T=>{if(!result.ok)throw new Error('Fixture failed');return result.value;};
const report:Record<string,unknown>={status:'starting',fixtureOnly:true};
const a=makeProviderPlugin('main',{run:async()=> 'a'}),b=makeProviderPlugin('main',{run:async()=> 'b'}),consumer=makeRecordingPlugin(),bad=makeFailingPlugin();
const modules=new Map([['test.a',a.module],['test.b',b.module],['test.consumer',consumer.module],['test.bad',bad.module]]);
const driver=new CordisRuntimeDriver(async request=>{const module=modules.get(request.owner.pluginId);if(!module)throw new Error('Fixture missing');return module;});
const manager=new PluginManager({driver,hostApiVersion:'1.0.0',platform:'win32-x64',trust:async()=>true});
void(async()=>{
 assert.equal(process.versions.electron,'45.0.0');assert.equal(process.platform,'win32');
 for(const plugin of ['test.a','test.b']){unwrap(manager.install(manifest(plugin,{provides:[{id:'main',capability:'test.echo@1'}]}),{origin:'user',directory:__dirname}));unwrap(await manager.enable(id(plugin)));}
 unwrap(manager.install(manifest('test.consumer',{consumes:[{capability:'test.echo@1',optional:false}]}),{origin:'user',directory:__dirname}));assert.equal(unwrap(await manager.enable(id('test.consumer'))).state,'unready');
 unwrap(manager.select(id('test.consumer'),'test.echo@1',{...id('test.a'),providerId:'main'}));const c=unwrap(await manager.enable(id('test.consumer')));const bound=unwrap(manager.capabilities.bind(c.owner,'test.echo@1'));
 unwrap(manager.select(id('test.consumer'),'test.echo@1',{...id('test.b'),providerId:'main'}));assert.equal(await unwrap(manager.capabilities.resolveBound(bound,'run'))({taskId:'smoke',signal:new AbortController().signal},null),'a');
 await manager.disable(id('test.a'));assert.equal(manager.capabilities.resolveBound(bound,'run').ok,false);
 unwrap(manager.select(id('test.consumer'),'test.echo@1',{...id('test.a'),providerId:'main'}));assert.equal(manager.get(id('test.consumer'))?.state,'unready');
 const generations:number[]=[];for(let cycle=0;cycle<3;cycle++){const current=unwrap(await manager.enable(id('test.a')));generations.push(current.owner.generation);assert.equal(manager.get(id('test.consumer'))?.state,'active');await manager.disable(id('test.a'));}
 assert.ok(generations.every((generation,index)=>index===0||generation>generations[index-1]!));
 unwrap(manager.install(manifest('test.bad'),{origin:'user',directory:__dirname}));assert.equal((await manager.enable(id('test.bad'))).ok,false);assert.equal(manager.get(id('test.bad'))?.state,'failed');
 report['runtime']={electron:process.versions.electron,node:process.versions.node,platform:process.platform};report['generations']=generations;report['checks']=['explicit-selection','fixed-old-binding','owner-invalidation','dependency-degradation','three-enable-disable-cycles','failed-activation-rollback'];report['status']='passed';
})().catch(()=>{report['status']='failed';process.exitCode=1;}).finally(async()=>{
 try{await manager.shutdown();await driver.dispose();const residual=driver.diagnostics();report['residual']=residual;assert.deepEqual(residual,{sessions:0,fibers:0});report['cleanup']='complete';}catch{report['cleanup']='failed';report['status']='failed';process.exitCode=1;}
 await fs.writeFile(path.join(__dirname,'report.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+String.fromCharCode(10));
});
