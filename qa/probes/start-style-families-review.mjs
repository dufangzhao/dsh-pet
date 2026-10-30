import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
const root=process.cwd(),require=createRequire(import.meta.url);
const profileId='styles-review-'+Date.now();
const output=path.join(root,'qa/screenshots/style-families',profileId);
const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
const report={status:'running',profileId,mode:'real-window-style-review',available:[],pending:[],screenshots:[],errors:[],shutdown:null};
let app,page;
try{
 await fs.mkdir(output,{recursive:true});
 app=await _electron.launch({executablePath:path.join(path.dirname(require.resolve('electron/package.json')),'dist/electron.exe'),args:[path.join(root,'apps/desktop'),'--demo-acceptance='+profileId,'--start-design-lab','--show-settings'],env,timeout:30000});
 await expect.poll(()=>app.windows().some(p=>p.url().includes('/console/index.html')),{timeout:20000}).toBe(true);
 page=app.windows().find(p=>p.url().includes('/console/index.html'));
 page.on('pageerror',error=>report.errors.push(String(error)));
 await expect(page.getByTestId('style-family-gallery')).toBeVisible({timeout:20000});
 await expect.poll(async()=>{const s=await page.evaluate(()=>window.petApplication.getSnapshot());return s.ok?s.value.agent.state:'unavailable';},{timeout:20000}).toBe('ready');
 const pet=app.windows().find(p=>p.url().includes('/pet/index.html'));
 const state=await page.evaluate(()=>window.petApplication.getSnapshot());
 if(pet&&state.ok&&state.value.dialog?.choices.some(c=>c.id==='later'))await pet.getByTestId('pet-dialog-choice-later').click();
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/console/index.html'));if(!w)throw new Error('No console');w.setContentSize(1200,800);w.webContents.setZoomFactor(1);});
 await expect.poll(()=>page.evaluate(()=>[innerWidth,innerHeight])).toEqual([1200,800]);
 for(const id of ['precision','hearth','folio','prism','workbench']){
  const pick=page.getByTestId('style-pick-'+id);
  if(!await pick.isEnabled()){report.pending.push(id);continue;}
  report.available.push(id);await pick.click();await expect(page.getByTestId('style-family-gallery')).toHaveAttribute('data-family',id);
  for(const view of ['start','board']){
   await page.getByTestId('style-view-'+view).click();
   await page.evaluate(()=>{for(const n of document.querySelectorAll('.sf-stage,main'))n.scrollTo(0,0);});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const file=id+'-'+view+'-1200x800.png';await page.screenshot({path:path.join(output,file)});
   report.screenshots.push({family:id,view,file:path.relative(root,path.join(output,file)).split(path.sep).join('/'),width:1200,height:800});
  }
 }
 report.status=report.pending.length?'partial':'captured';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;}
finally{
 if(app){const proc=app.process();const exited=new Promise(resolve=>proc.once('exit',(code,signal)=>resolve({code,signal})));await app.close();report.shutdown=await exited;}
 await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'review-report.json'),JSON.stringify(report,null,2)+String.fromCharCode(10));
 console.log(JSON.stringify({status:report.status,available:report.available,pending:report.pending,report:path.relative(root,path.join(output,'review-report.json')),failure:report.failure,shutdown:report.shutdown}));
}
