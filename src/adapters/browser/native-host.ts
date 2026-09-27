/** Browser-spawned relay only: never loads the runtime, credentials, or database. */
import {connect} from 'node:net';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {defaultBridgeDirectory,extensionOrigin} from './settings.js';
import {decodeFrames,encodeFrame} from './framing.js';
const origin=process.argv[2];
if(origin!==extensionOrigin)process.exitCode=1;
else {
 let ended=false,ready=false;let pending:Buffer[]=[];let pendingBytes=0;
 const send=(v:unknown)=>process.stdout.write(encodeFrame(v,900_000));
 const fail=(message:string)=>{if(ended)return;ended=true;send({event:'disconnected',error:{code:'studio_offline',message}});process.stdin.pause();process.exitCode=1;};
 try {
  const endpoint=JSON.parse(readFileSync(join(defaultBridgeDirectory(),'endpoint.json'),'utf8')) as {socketPath:string;token:string};
  const socket=connect(endpoint.socketPath);
  const timer=setTimeout(()=>{fail('Open Cvitae Studio to import.');socket.destroy();},5000);
  socket.once('connect',()=>socket.write(encodeFrame({type:'connect',origin,token:endpoint.token})));
  socket.on('data',decodeFrames(value=>{const v=value as Record<string,unknown>;if(v.connected===true){ready=true;clearTimeout(timer);for(const item of pending)socket.write(item);pending=[];pendingBytes=0;return;}send(value);},()=>socket.destroy(),900_000));
  process.stdin.on('data',decodeFrames(value=>{const frame=encodeFrame(value);if(ready)socket.write(frame);else {pendingBytes+=frame.length;if(pendingBytes>4194304){socket.destroy();return;}pending.push(frame);}},()=>socket.destroy()));
  process.stdin.on('end',()=>{ended=true;clearTimeout(timer);socket.end();});
  socket.on('error',()=>{clearTimeout(timer);fail('Open Cvitae Studio to import. If it is running, repair Browser Companion in Settings.');});
  socket.on('close',()=>{clearTimeout(timer);fail('The Studio connection closed. Reconnect after opening Studio.');});
 }catch{fail('Open Cvitae Studio and enable Browser Companion in Settings.');}
}
