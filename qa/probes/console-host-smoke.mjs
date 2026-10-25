import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'.cache/m2-console-host');
for(const name of ['profile','console','pet','builtin','plugins'])await fs.mkdir(path.join(out,name),{recursive:true});
for(const name of ['console','pet'])await fs.writeFile(path.join(out,name,'index.html'),'<!doctype html><meta charset="utf-8"><title>Console host fixture</title><h1>Console host fixture</h1>');
for(const [origin,id,name] of [['builtin','test.builtin-console','内置示例'],['plugins','test.user-console','用户示例']]){const directory=path.join(out,origin,id);await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'plugin.json'),JSON.stringify({schemaVersion:1,id,version:'1.0.0',displayName:{'zh-CN':name},description:{'zh-CN':'宿主窗口验证夹具'},license:'MIT',host:'^1.0.0',platforms:['win32-x64'],entries:{runtime:'private-entry.mjs'}}));await fs.writeFile(path.join(directory,'private-entry.mjs'),'export default {activate(){}};');}
await build({entryPoints:[path.join(root,'qa/probes/console-host-smoke.ts')],outfile:path.join(out,'main.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron']});
const require=createRequire(import.meta.url),pkg=require.resolve('electron/package.json'),env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
const started=Date.now();const child=spawn(path.join(path.dirname(pkg),'dist/electron.exe'),[path.join(out,'main.cjs')],{cwd:root,env,stdio:'inherit',windowsHide:true});const timer=setTimeout(()=>child.kill(),30000);child.once('error',()=>{clearTimeout(timer);process.exitCode=1;});child.once('exit',async code=>{clearTimeout(timer);let passed=false;try{const file=path.join(out,'report.json'),stat=await fs.stat(file),value=JSON.parse(await fs.readFile(file,'utf8'));passed=stat.mtimeMs>=started&&value.status==='passed';}catch{}process.exitCode=code===0&&passed?0:1;});
