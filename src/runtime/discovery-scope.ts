import { OperationError } from '../contracts/index.js';
import type { RuntimeDeps } from './run.js';
import { createToolRegistry } from '../tools/registry.js';
export const bindDiscoveryScope = (deps: RuntimeDeps): RuntimeDeps => {
 const reject=():never=>{throw new OperationError('search_scope','Discover cannot access Profile, notes or external sources.');};
 return {...deps,scopeLegacy:()=>undefined,tools:createToolRegistry([]),documents:{read:reject,update:reject},
  retrieval:{search:reject},index:{lexical:reject,neighbours:reject,fingerprintOf:reject,countOf:reject,replace:reject,keepText:reject,clear:reject},
  effects:{...deps.effects,ai:{...deps.effects.ai,generateObject:request=>deps.effects.ai.generateObject({...request,maxRetries:0,strictSchema:true}),generateText:request=>deps.effects.ai.generateText({...request,maxRetries:0})},offers:{resolve:reject},sites:{readPage:reject,readCompany:reject,listBoard:reject},search:{search:reject,engine:()=>undefined},sources:{read:reject,through(){return this;}},attempts:{begin:reject,settle:reject,unsettled:reject}}
 };
};
