import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const project=fileURLToPath(new URL('../../',import.meta.url));
const root=path.join(project,'.cache/qa/companion-qq-codec');
assert.equal(await realpath(root),root);
const pin=JSON.parse(await readFile(path.resolve(process.argv[2]),'utf8'));
const require=createRequire(import.meta.url);
const {build}=await import(pathToFileURL(require.resolve('esbuild',{paths:[path.join(project,'plugins/tts-magpie')]})).href);
const compiled=await build({entryPoints:[path.join(project,'plugins/qq-media-codec/src/job.ts')],bundle:true,format:'esm',platform:'node',target:'node26',write:false,
  alias:{'@pet/contracts':path.join(project,'packages/contracts/src/index.ts'),'@pet/host-kernel':path.join(project,'packages/host-kernel/src/kernel-fault.ts')}});
const source=compiled.outputFiles[0].contents;
const bundle=path.join(root,`lifecycle-runner-${createHash('sha256').update(source).digest('hex').slice(0,16)}.mjs`);
let old;try{old=await readFile(bundle)}catch(e){if(e.code!=='ENOENT')throw e}
if(old)assert.ok(old.equals(source));else await writeFile(bundle,source,{flag:'wx',mode:0o600});
const {CodecDockerRunner}=await import(pathToFileURL(bundle).href);
const directory=path.join(root,`lifecycle-${randomUUID()}`);await mkdir(directory,{mode:0o700});
const receipts=[],runners=[],cases=[];
async function create(options={}){const value=await CodecDockerRunner.create({directory:path.join(directory,`owner-${runners.length}`),pin,observe:r=>receipts.push(r),...options});runners.push(value);return value}
async function* stream(bytes){yield bytes}
const pcm=Buffer.alloc(24_000*20*2);for(let at=0;at<pcm.length/2;at++)pcm.writeInt16LE(Math.round(12000*Math.sin(at*2*Math.PI*220/24000)),at*2);
const settled=()=>{const r=receipts.at(-1);assert.equal(r.stopped,true);assert.equal(r.removed,true);assert.equal(r.workspaceRemoved,true)};
let failure;
try{
  for(const reason of ['source-revocation','source-close']){
    const source=new AbortController();let ready;const running=new Promise(r=>ready=r);
    const codec=await create({sourceSignal:source.signal,cpus:0.1,onStarted:r=>{assert.ok(r.pid>0);ready(r)}});
    let consumed=false;const work=codec.encode(stream(pcm),async()=>{consumed=true},new AbortController().signal).then(()=>null,e=>e);
    const observed=await running;let closing;
    if(reason==='source-revocation')source.abort();else closing=codec.close();
    assert.equal((await work)?.error?.code,'cancelled');if(closing)await closing;
    settled();assert.equal(codec.activeJobs,0);assert.equal(codec.reusable,false);assert.equal(consumed,false);
    cases.push({name:reason,containerId:observed.containerId,pid:observed.pid,consumed});
  }
  const tail=await create();
  const nonAligned=pcm.subarray(0,48_002);
  const encoded=await tail.encode(stream(nonAligned),async(meta,data)=>{const chunks=[];for await(const chunk of data)chunks.push(chunk);return{meta,bytes:Buffer.concat(chunks)}},new AbortController().signal);
  assert.equal(encoded.meta.frames,24_480);assert.equal(encoded.meta.durationMs,1020);
  const decoded=await tail.decode(stream(encoded.bytes),async(meta,data)=>{for await(const _chunk of data){void _chunk}return meta},new AbortController().signal);
  assert.equal(decoded.frames,16_320);settled();cases.push({name:'non-20ms-tail-complete-with-declared-codec-padding',sourceFrames:24_001,encodedFrames:encoded.meta.frames,decodedFrames:decoded.frames});
  const consumerOwner=await create();
  const {mock}=await import('node:test');mock.timers.enable({apis:['setTimeout']});
  let entered,releaseConsumer;const consumerEntered=new Promise(r=>entered=r),consumerGate=new Promise(r=>releaseConsumer=r);
  const consuming=consumerOwner.encode(stream(pcm.subarray(0,48_000)),async(meta,data,signal)=>{for await(const _chunk of data){void _chunk}entered(signal);await consumerGate;return meta},new AbortController().signal);
  try{const consumerSignal=await consumerEntered;mock.timers.tick(60_001);await Promise.resolve();assert.equal(consumerSignal.aborted,false);releaseConsumer();await consuming;settled();cases.push({name:'actual-codec-exit-clears-job-clock-before-long-scoped-consumer'})}
  finally{releaseConsumer();mock.timers.reset();await consuming}
  const partial=await create();
  await assert.rejects(partial.encode(stream(pcm.subarray(0,48_000)),async()=>{},new AbortController().signal),e=>e.error?.code==='invalid-input');
  settled();assert.equal(partial.activeJobs,0);cases.push({name:'partial-consumer-return-does-not-complete',activeJobs:partial.activeJobs});
  const staging=await create();let release;const gate=new Promise(r=>release=r);
  async function* parked(){await gate;yield pcm.subarray(0,48_000)}
  const one=staging.encode(parked(),async()=>{},new AbortController().signal).then(()=>null,e=>e);
  const two=staging.encode(parked(),async()=>{},new AbortController().signal).then(()=>null,e=>e);
  assert.equal(staging.activeJobs,2);
  await assert.rejects(staging.encode(stream(pcm),async()=>{},new AbortController().signal),e=>e.error?.code==='quota-exceeded');
  let done=false;const closing=staging.close().then(()=>done=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
  release();assert.equal((await one)?.error?.code,'cancelled');assert.equal((await two)?.error?.code,'cancelled');await closing;
  assert.equal(staging.activeJobs,0);cases.push({name:'two-preparations-and-real-staging-drain',activeJobs:0,third:'quota-exceeded'});
  const wrong=CodecDockerRunner.create({directory:path.join(directory,'wrong-pin'),pin:{...pin,manifestSha256:'0'.repeat(64)}});
  await assert.rejects(wrong,e=>e.error?.code==='not-ready');cases.push({name:'wrong-manifest-no-availability'});
}catch(error){failure=error;console.error(error)}
const closed=await Promise.allSettled(runners.map(r=>r.close()));if(closed.some(v=>v.status==='rejected'))failure??=new Error('Unconfirmed cleanup');
const evidence={version:1,imageId:pin.imageId,manifestSha256:pin.manifestSha256,success:!failure,cases,receipts,activeJobs:runners.map(r=>r.activeJobs)};
const output=path.join(root,`${path.basename(directory)}.json`);await writeFile(output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({evidence:output,success:!failure,cases,activeJobs:evidence.activeJobs}));
if(!failure){assert.equal(path.dirname(directory),root);assert.equal(await realpath(directory),directory);await rm(directory,{recursive:true})}else process.exitCode=1;
