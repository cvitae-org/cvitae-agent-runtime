import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IntegrationSource } from './integration-providers.js';

type Icon = NonNullable<IntegrationSource['presentation']['icon']>;
/** Decode only bounded raster headers, before the UI asks its image decoder to run. */
function validRaster(bytes: Buffer, mime: Icon['mimeType']) {
  let width = 0, height = 0;
  if (mime === 'image/png' && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (mime === 'image/webp' && bytes.length >= 30 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') {
    const kind = bytes.toString('ascii',12,16);
    if (kind === 'VP8X' && !(bytes[20]! & 2)) { width = 1 + bytes.readUIntLE(24,3); height = 1 + bytes.readUIntLE(27,3); }
    if (kind === 'VP8 ' && bytes.subarray(23,26).equals(Buffer.from([157,1,42]))) { width = bytes.readUInt16LE(26) & 16383; height = bytes.readUInt16LE(28) & 16383; }
    if (kind === 'VP8L' && bytes[20] === 47) { const bits=bytes.readUInt32LE(21); width=1+(bits&16383); height=1+((bits>>>14)&16383); }
  }
  return width > 0 && height > 0 && width <= 2048 && height <= 2048 && width * height <= 4_000_000;
}
export function createIntegrationAssets(directory: string, request = globalThis.fetch) {
  return {
    async read(icon: Icon, signal: AbortSignal) {
      const path = join(directory, icon.sha256 + '.raster');
      const valid = (bytes: Buffer) => bytes.length === icon.byteLength
        && createHash('sha256').update(bytes).digest('hex') === icon.sha256 && validRaster(bytes, icon.mimeType);
      let bytes: Buffer | undefined;
      try { const cached = await readFile(path); if (valid(cached)) bytes = cached; } catch { /* Cache miss. */ }
      if (!bytes) {
        const response = await request(icon.url, { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
          headers: { Accept: icon.mimeType } });
        if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim() !== icon.mimeType || !response.body) throw new Error('Invalid icon');
        const reader=response.body.getReader(), chunks: Uint8Array[]=[]; let length=0;
        try {
          for (;;) { const item=await reader.read(); if(item.done)break; length+=item.value.length;
            if(length>icon.byteLength)throw new Error('Icon exceeds declared size'); chunks.push(item.value); }
        } finally { await reader.cancel().catch(()=>{}); }
        bytes=Buffer.concat(chunks);
        if(!valid(bytes))throw new Error('Invalid icon bytes');
        signal.throwIfAborted(); await mkdir(directory,{recursive:true,mode:0o700});
        const temporary=path+'.'+randomUUID()+'.tmp';
        try { await writeFile(temporary,bytes,{flag:'wx',mode:0o600}); signal.throwIfAborted(); await rename(temporary,path); }
        finally { await rm(temporary,{force:true}).catch(()=>{}); }
      }
      signal.throwIfAborted();
      return { mimeType:icon.mimeType, sha256:icon.sha256, base64:bytes.toString('base64') };
    },
  };
}
