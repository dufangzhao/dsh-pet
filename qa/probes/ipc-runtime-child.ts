import net from 'node:net';
import { ControlEndpoint } from '../../packages/host-kernel/src/ipc/control-endpoint.js';
import { parentProcessControl } from '../../packages/host-kernel/src/ipc/node-control-transport.js';
import { FramedMediaPort } from '../../packages/host-kernel/src/ipc/media-port.js';
import { BoundedMediaChannel } from '../../packages/host-kernel/src/tasks/media-channel.js';
const owner={pluginId:'core.runtime',instanceId:'probe',generation:1};const identity={owner,streamId:'stream',taskId:'media-task'};const task=new AbortController();const channel=new BoundedMediaChannel(identity,()=>true,task.signal);const reader=channel[Symbol.asyncIterator]();let buffered!:()=>void;const full=new Promise<void>(r=>{buffered=r;});let held!:()=>void;const holding=new Promise<void>(r=>{held=r;});let cancellations=0;let consumed=0;
const socket=new net.Socket({fd:4,readable:true,writable:true});
const media=new FramedMediaPort(socket,frame=>{const result=channel.push(frame);if(channel.snapshot().queuedChunks===8)buffered();return result;},error=>channel.cancel(error));
const endpoint=new ControlEndpoint(parentProcessControl(),{sessionId:'ipc-probe',owner,live:()=>true,onStreamControl:message=>{if(message.type==='stream-end'){const result=channel.close(message.sequence);if(!result.ok)throw new Error('Invalid end');}},handlers:{
 echo:async(_context,payload)=>({ok:true,value:payload}),
 open:async()=>{endpoint.streamControl({type:'stream-credit',streamId:'stream',taskId:'media-task',credits:8});return {ok:true,value:true};},
 buffered:async()=>{await full;return {ok:true,value:channel.snapshot().queuedChunks};},
 consume:async()=>{const next=await reader.next();if(next.done)return {ok:true,value:{done:true}};consumed++;endpoint.streamControl({type:'stream-credit',streamId:'stream',taskId:'media-task',credits:1});return {ok:true,value:{sequence:next.value.header.sequence,byte:next.value.payload[0]??-1}};},
 end:async()=>({ok:true,value:{done:(await reader.next()).done??false}}),
 hold:async context=>{held();await new Promise<void>(resolve=>{if(context.signal.aborted){cancellations++;resolve();}else context.signal.addEventListener('abort',()=>{cancellations++;resolve();},{once:true});});return {ok:true,value:null};},
 holding:async()=>{await holding;return {ok:true,value:true};},
 stats:async()=>({ok:true,value:{cancellations,consumed}}),
 crash:async()=>{process.exit(17);},
}});
process.once('disconnect',()=>{task.abort();media.close();endpoint.close();});
