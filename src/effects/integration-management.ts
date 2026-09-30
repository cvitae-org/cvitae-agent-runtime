import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { descriptorSchema, connectionsSchema } from '../../vendor/integration-protocol/index.mjs';
import { cacheKey, sourceKey } from '../../vendor/integration-protocol/node.mjs';
import type { z } from 'zod';
import type { IntegrationInput } from '../contracts/integration-settings.js';
import { OperationError } from '../contracts/operation-error.js';
import { createIntegrationProviders, type IntegrationConnection, type IntegrationProviders } from './integration-providers.js';
import { createIntegrationAssets } from './integration-assets.js';

type Descriptor = z.infer<typeof descriptorSchema>;
type Store = {read(): IntegrationConnection[] | undefined; write(value: IntegrationConnection[]): void};
type Options = { directory: string; env?: Readonly<Record<string,string|undefined>>; fetch?: typeof globalThis.fetch;
  now?: () => number; providers?: IntegrationProviders };
const fail = (message: string): never => { throw new OperationError('misconfigured',message); };
const fingerprints = (keys: Record<string,string>) => Object.entries(keys).map(([id,pem]) => {
  const key=createPublicKey(pem);
  if(key.asymmetricKeyType!=='ed25519')return fail('The provider must use Ed25519 signing keys.');
  return {id,sha256:createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex')};
});

/** Desktop management only. This surface is never exposed to a recipe or AI tool. */
export function createIntegrationManagement(store: Store, options: Options) {
  const request=options.fetch??globalThis.fetch, now=options.now??Date.now, env=options.env??{};
  const secrets=new Map<string,string>(), cleared=new Set<string>();
  const stored=store.read();
  const initial=stored??connectionsSchema.parse(JSON.parse(env.INTEGRATION_PROVIDERS_JSON??env.INTEGRATION_PROVIDERS_DEFAULTS_JSON??'[]') as unknown);
  const credential=(reference:string) => secrets.get(reference)??(!cleared.has(reference)?env[reference]:undefined);
  const providers=options.providers??createIntegrationProviders(initial,{cacheDirectory:options.directory,fetch:request,now,resolveCredential:credential});
  // Product defaults are a one-time seed. Persist even [] so a later host
  // preset cannot replace a user's saved choice, including explicit removal.
  if(stored===undefined&&env.INTEGRATION_PROVIDERS_JSON===undefined
    &&env.INTEGRATION_PROVIDERS_DEFAULTS_JSON!==undefined&&!options.providers)store.write(initial);
  const inspections=new Map<string,{descriptor:Descriptor;expires:number}>();
  const lifetime=new AbortController();
  const connection=(id:string) => providers.connections().find(item=>item.id===id)??fail('This job provider is no longer configured.');
  const editable=()=>{if(options.providers)fail('This host manages provider connections externally.');};
  const commit=(next:IntegrationConnection) => {
    editable(); const values=connectionsSchema.parse([...providers.connections().filter(item=>item.id!==next.id),next]);
    store.write(values); providers.upsert(next);
  };
  const clear=(item:IntegrationConnection) => {if(item.credentialRef){secrets.delete(item.credentialRef);cleared.add(item.credentialRef);}};
  const signal=()=>AbortSignal.any([lifetime.signal,AbortSignal.timeout(15000)]);
  const summary=(item:IntegrationConnection) => {
    const status=providers.status(item.id);
    return {...item, fingerprints:fingerprints(item.publicKeys), credentialConfigured:!!item.credentialRef&&!!credential(item.credentialRef),
      status:!item.enabled?'disabled':status?.status??'not-checked',detail:status?.detail??null,
      sources:(status?.snapshot?.sources??[]).map(source=>({id:source.id,key:sourceKey(item.id,source.id),label:source.label,modes:source.modes,health:source.health}))};
  };
  return {
    providers,
    list() { return {connections:providers.connections().map(summary),editable:!options.providers}; },
    async inspect(input: IntegrationInput<'integrations.inspect'>, expected: {expectedProviderId?:string;signal?:AbortSignal} = {}) {
      let raw: unknown=input.descriptor;
      if(input.url){
        const response=await request(input.url,{redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json'},signal:expected.signal?AbortSignal.any([signal(),expected.signal]):signal()});
        if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('json'))return fail('Could not read a provider descriptor at this URL.');
        const reader=response.body.getReader(), chunks:Uint8Array[]=[];let size=0;
        try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>100000) return fail('The provider descriptor exceeds the size limit.');chunks.push(part.value);}}
        finally{await reader.cancel().catch(()=>{});}
        try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{return fail('The provider descriptor is not valid JSON.');}
      }
      const parsed=descriptorSchema.safeParse(raw);
      if(!parsed.success)return fail('This is not a supported v2 job provider descriptor.');
      const descriptor=parsed.data;
      if(expected.expectedProviderId&&descriptor.providerId!==expected.expectedProviderId)return fail('The provider identity differs from the directory listing.');
      const keys=fingerprints(descriptor.signing.publicKeys);
      for(const [id,item]of inspections)if(item.expires<=now())inspections.delete(id);
      if(inspections.size>=16)inspections.delete(inspections.keys().next().value!);
      const inspectionId=randomUUID();inspections.set(inspectionId,{descriptor,expires:now()+15*60000});
      return structuredClone({inspectionId,descriptor,fingerprints:keys});
    },
    save(input: IntegrationInput<'integrations.save'>) {
      editable();
      const review=inspections.get(input.inspectionId);
      if(!input.trusted||!review||review.expires<=now())return fail('Inspect the provider and confirm its identity and signing keys again.');
      const descriptor=review.descriptor, existing=input.id?connection(input.id):undefined;
      if(existing&&existing.providerId!==descriptor.providerId)return fail('A different provider requires a new connection.');
      const id=existing?.id??'c_'+randomUUID().replaceAll('-','');
      const next:IntegrationConnection={id,providerId:descriptor.providerId,name:input.name,resolveUrl:descriptor.resolveUrl,
        authentication:descriptor.authentication,...(descriptor.authentication==='bearer'?{credentialRef:'INTEGRATION_'+id.toUpperCase()}:{}),
        publicKeys:descriptor.signing.publicKeys,scope:input.scope,priority:input.priority,enabled:false};
      commit(next);if(existing)clear(existing);inspections.delete(input.inspectionId);
      return summary(next);
    },
    configure(input: IntegrationInput<'integrations.configure'>) {
      const previous=connection(input.id),next={...previous,name:input.name,scope:input.scope,priority:input.priority};
      commit(next);return summary(next);
    },
    enabled(id:string,enabled:boolean) {
      const previous=connection(id),next={...previous,enabled};commit(next);
      if(!enabled)clear(next);return summary(next);
    },
    secret(id:string,token:string|null) {
      editable();const item=connection(id);
      if(!item.credentialRef)return fail('This job provider does not use a bearer credential.');
      if(token){secrets.set(item.credentialRef,token);cleared.delete(item.credentialRef);}else clear(item);
      // Cancel any request using the previous token and reset its refresh cooldown.
      providers.upsert(item);return {id,credentialConfigured:!!token};
    },
    async refresh(id:string) {await providers.resolveConnection(id,signal(),true);return summary(connection(id));},
    async remove(id:string) {
      editable();const item=connection(id);
      store.write(providers.connections().filter(value=>value.id!==id));clear(item);providers.remove(id);
      await providers.purge(id);await rm(join(options.directory,'assets',id),{recursive:true,force:true});
      return {id,removed:true};
    },
    async icon(key:string) {
      try{
        const resolved=await providers.resolve(signal());
        const source=resolved.sources.find(item=>item.key===key),icon=source?.source.presentation.icon;
        if(!source||!icon)return null;
        const original=connection(source.reference.connectionId),binding=cacheKey(original);
        const bytes=await createIntegrationAssets(join(options.directory,'assets',original.id),request).read(icon,AbortSignal.any([signal(),providers.signal(original.id)!]));
        const current=connection(original.id);
        if(!current.enabled||cacheKey(current)!==binding)return null;
        return bytes;
      }catch{return null;}
    },
    close(){lifetime.abort();secrets.clear();inspections.clear();providers.close();},
  };
}
