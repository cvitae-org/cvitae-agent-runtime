export const MAX_FRAME=4*1024*1024;
export function encodeFrame(value:unknown,limit=MAX_FRAME):Buffer {
 const data=Buffer.from(JSON.stringify(value),'utf8');if(!data.length||data.length>limit)throw new Error('Browser message exceeds its size limit.');
 const header=Buffer.alloc(4);header.writeUInt32LE(data.length);return Buffer.concat([header,data]);
}
export function decodeFrames(onFrame:(value:unknown)=>void,onError:(error:Error)=>void,limit=MAX_FRAME):(chunk:Buffer)=>void {
 let buffered=Buffer.alloc(0),failed=false;
 return chunk=>{if(failed)return;try{buffered=Buffer.concat([buffered,chunk]);while(buffered.length>=4){const length=buffered.readUInt32LE();if(!length||length>limit)throw new Error('Invalid browser message length.');if(buffered.length<length+4)return;const frame=JSON.parse(buffered.subarray(4,4+length).toString('utf8')) as unknown;buffered=buffered.subarray(4+length);if(!frame||typeof frame!=='object'||Array.isArray(frame))throw new Error('Browser messages must be objects.');onFrame(frame);}}catch(error){failed=true;buffered=Buffer.alloc(0);onError(error as Error);}};
}
