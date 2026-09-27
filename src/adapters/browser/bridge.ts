/** User-scoped native messaging relay. It exposes browser capabilities, never general IPC. */
import {createServer, connect, type Server, type Socket} from 'node:net';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,chmodSync,rmSync,existsSync,lstatSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extensionOrigin,hostName,defaultBridgeDirectory} from './settings.js';
import {decodeFrames,encodeFrame} from './framing.js';
export type BrowserDispatch=(sessionId:string,method:string,payload:unknown)=>unknown;
export function createBrowserBridge(directory:string,dispatch:BrowserDispatch,disconnect:(id:string)=>void,options:{home?:string;platform?:string;extensionPath?:string}={}) {
 const home=options.home??homedir(),platform=options.platform??process.platform;
 const configPath=join(directory,'config.json'),endpointPath=join(directory,'endpoint.json');
 const socketDirectory=join(tmpdir(),`cvitae-browser-${createHash('sha256').update(directory).digest('hex').slice(0,16)}`);
 const socketPath=join(socketDirectory,'runtime.sock');
 const clients=new Set<Socket>();let server:Server|undefined,lastError:string|undefined;let starting:Promise<void>|undefined;let closing=false;
 const enabled=()=>{try{return JSON.parse(readFileSync(configPath,'utf8')).enabled===true;}catch{return false;}};
 const privateDir=(path:string)=>{mkdirSync(path,{recursive:true,mode:0o700});const st=lstatSync(path);if(st.isSymbolicLink()||st.uid!==process.getuid?.())throw new Error('Browser connection directory is not owned by this user.');chmodSync(path,0o700);};
 const status=()=>({supported:platform==='darwin',enabled:enabled(),connected:clients.size>0,connections:clients.size,extensionId:extensionOrigin.split('/')[2],extensionPath:options.extensionPath??resolve(dirname(fileURLToPath(import.meta.url)),'../../../../../browser-extension'),error:lastError??null});
 const stop=async()=>{
  await starting?.catch(()=>undefined);
  for(const client of clients)client.destroy();clients.clear();
  const listener=server;server=undefined;
  if(listener){await new Promise<void>(done=>listener.close(()=>done()));rmSync(endpointPath,{force:true});}
 };
 const removeStaleSocket=async()=>{
  if(!existsSync(socketPath))return;
  const stat=lstatSync(socketPath);
  if(!stat.isSocket()||stat.uid!==process.getuid?.())throw new Error('Browser socket is not owned by this user.');
  const live=await new Promise<boolean>((done,reject)=>{
   const probe=connect(socketPath);const timer=setTimeout(()=>{probe.destroy();reject(new Error('The browser connection is busy. Close other Studio instances and repair it.'));},1000);
   probe.once('connect',()=>{clearTimeout(timer);probe.destroy();done(true);});
   probe.once('error',(error:NodeJS.ErrnoException)=>{clearTimeout(timer);probe.destroy();if(error.code==='ENOENT'||error.code==='ECONNREFUSED')done(false);else reject(error);});
  });
  if(live)throw new Error('Another Studio instance owns the browser connection.');
  // A crashed process may leave a socket without an endpoint file.
  if(existsSync(socketPath)&&lstatSync(socketPath).ino===stat.ino)rmSync(socketPath);
 };
 const start=async()=>{
  if(starting)return starting;if(server||closing)return;
  starting=(async()=>{
   privateDir(directory);privateDir(socketDirectory);await removeStaleSocket();
   return new Promise<void>((resolveStart,reject)=>{
   try{
    const token=randomBytes(32).toString('hex');
    const listener=createServer(socket=>{
     let sessionId:string|undefined;const timeout=setTimeout(()=>socket.destroy(),5000);
     const send=(frame:unknown)=>{try{socket.write(encodeFrame(frame,900_000));}catch{socket.destroy();}};
     socket.on('data',decodeFrames(frame=>{
      const value=frame as Record<string,unknown>;
      if(!sessionId){
       if(value.type!=='connect'||value.origin!==extensionOrigin||typeof value.token!=='string'||value.token.length!==token.length||!timingSafeEqual(Buffer.from(value.token),Buffer.from(token))){socket.destroy();return;}
       clearTimeout(timeout);sessionId=randomUUID();clients.add(socket);send({connected:true,sessionId});return;
      }
      if(typeof value.id!=='string'||value.id.length>100||typeof value.method!=='string'){socket.destroy();return;}
      void Promise.resolve().then(()=>dispatch(sessionId!,value.method as string,value.payload)).then(data=>send({id:value.id,ok:true,data})).catch(error=>{const e=error as {code?:string;message?:string};send({id:value.id,ok:false,error:{code:e.code??'invalid_request',message:e.message??'Browser operation failed.'}});});
     },()=>socket.destroy()));
     socket.on('error',()=>socket.destroy());socket.on('close',()=>{clearTimeout(timeout);clients.delete(socket);if(sessionId)disconnect(sessionId);});
    });
    listener.once('error',error=>{lastError=error.message;if(server===listener)server=undefined;reject(error);});
    listener.listen(socketPath,()=>{chmodSync(socketPath,0o600);writeFileSync(endpointPath,JSON.stringify({socketPath,token,pid:process.pid}),{mode:0o600});lastError=undefined;resolveStart();});server=listener;
   }catch(error){lastError=(error as Error).message;reject(error);}
  });})().catch(error=>{lastError=(error as Error).message;throw error;}).finally(()=>{starting=undefined;});return starting;
 };
 const manifests=['Google/Chrome','Microsoft Edge'].map(browser=>join(home,'Library/Application Support',browser,'NativeMessagingHosts',`${hostName}.json`));
 const configure=async(enable:boolean)=>{
  if(platform!=='darwin')throw new Error('Browser Companion setup is currently supported on macOS.');
  privateDir(directory);
  if(enable){
   if(server||starting)await stop();
   const wrapper=join(directory,'native-host'),script=fileURLToPath(new URL('./native-host.js',import.meta.url));
   const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
   writeFileSync(wrapper,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,{mode:0o700});chmodSync(wrapper,0o700);
   for(const manifest of manifests){mkdirSync(dirname(manifest),{recursive:true});writeFileSync(manifest,JSON.stringify({name:hostName,description:'Cvitae Browser Companion',path:wrapper,type:'stdio',allowed_origins:[extensionOrigin]},null,2),{mode:0o600});}
   writeFileSync(configPath,JSON.stringify({enabled:true}),{mode:0o600});await start();
  }else{writeFileSync(configPath,JSON.stringify({enabled:false}),{mode:0o600});await stop();for(const manifest of manifests){if(existsSync(manifest)){try{if(JSON.parse(readFileSync(manifest,'utf8')).name===hostName)rmSync(manifest);}catch{/* Already removed or no longer readable. */}}}}
  return status();
 };
 if(enabled())void start().catch(()=>undefined);
 return {status,configure,close(){closing=true;void stop().catch(()=>undefined);}};
}
export {defaultBridgeDirectory};
