import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'.cache/m2-contributions');
await fs.mkdir(path.join(out,'profile'),{recursive:true});
const contributes=[{id:'run',kind:'command',title:{'zh-CN':'运行'},handler:'execute'},{id:'quick',kind:'shortcut-button',title:{'zh-CN':'快捷'},command:'run'},{id:'key',kind:'hotkey',title:{'zh-CN':'热键'},command:'run'},{id:'settings',kind:'settings',title:{'zh-CN':'设置'},section:'general'},{id:'panel',kind:'panel',title:{'zh-CN':'面板'},entry:'panel.html'}];
for(const id of ['test.contribution-runtime','test.contribution-failure']){const directory=path.join(out,'plugins',id);await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'plugin.json'),JSON.stringify({schemaVersion:1,id,version:'1.0.0',displayName:{'zh-CN':'贡献点夹具'},description:{'zh-CN':'原生运行区验证'},license:'MIT',host:'^1.0.0',platforms:['win32-x64'],entries:{runtime:'entry.mjs'},contributes}));await fs.writeFile(path.join(directory,'panel.html'),'<p>fixture</p>');await fs.writeFile(path.join(directory,'entry.mjs'),'export default {activate(ctx){ctx.contribute("run",async()=>true);for(const id of ["quick","key","settings","panel"])ctx.contribute(id);if(ctx.owner.pluginId.endsWith("failure"))throw new Error("fixture activation failure");}};');}
await build({entryPoints:[path.join(root,'qa/probes/contribution-runtime-smoke.ts')],outfile:path.join(out,'main.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron']});
const require=createRequire(import.meta.url),pkg=require.resolve('electron/package.json'),env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
const started=Date.now(),child=spawn(path.join(path.dirname(pkg),'dist/electron.exe'),[path.join(out,'main.cjs')],{cwd:root,env,stdio:'inherit',windowsHide:true});const timer=setTimeout(()=>child.kill(),30000);child.once('error',()=>{clearTimeout(timer);process.exitCode=1;});child.once('exit',async code=>{clearTimeout(timer);let passed=false;try{const file=path.join(out,'report.json');passed=(await fs.stat(file)).mtimeMs>=started&&JSON.parse(await fs.readFile(file,'utf8')).status==='passed';}catch{}process.exitCode=code===0&&passed?0:1;});
