import { z } from 'zod';
import type { OfferSnapshot } from './offer-snapshot.js';

const id = z.string().min(1).max(200);
const text = z.string().max(30000);
export const applicationFieldSchema = z.object({
  id, key: z.string().max(500), label: z.string().min(1).max(2000),
  type: z.enum(['text','email','tel','url','textarea','select','radio','checkbox','date','number','file','unsupported']),
  required: z.boolean(), value: text, valid: z.boolean(),
  options: z.array(z.object({value:z.string().max(2000),label:z.string().max(2000)}).strict()).max(300),
  autocomplete: z.string().max(200), maxLength: z.number().int().min(-1).max(1000000),
  cv: z.boolean(), attached: z.boolean()
}).strict();
export const applicationControlSchema = z.object({id,label:z.string().max(2000),kind:z.enum(['apply','next','submit']),href:z.string().max(8192)}).strict();
export const applicationFrameSchema = z.object({
  id, url:z.string().max(8192), title:z.string().max(1000), text:z.string().max(16000),
  form:z.boolean(), blocked:z.string().max(1000),
  fields:z.array(applicationFieldSchema).max(150), controls:z.array(applicationControlSchema).max(60)
}).strict();
export const applicationObservationSchema = z.object({id:z.string().uuid(),frames:z.array(applicationFrameSchema).min(1).max(12)}).strict();
export type ApplicationField = z.infer<typeof applicationFieldSchema>;
export type ApplicationObservation = z.infer<typeof applicationObservationSchema>;
export type ApplicationStatus = 'running' | 'paused' | 'needsInput' | 'review' | 'cancelled' | 'failed';
export type ApplicationAction = {
  id: string; observationId: string; kind:'navigate'|'fill'|'attach'|'review'|'wait'|'pause';
  frameId?: string; targetId?: string; values?: {fieldId:string;value:string}[]; message: string;
};
export type ApplicationAgentState = {
  id:string; status:ApplicationStatus; step:string; message:string; startedAt:number; updatedAt:number;
  cvVersionId:string; url:string; iterations:number; generation:number;
  profile:OfferSnapshot; preferences:Record<string,unknown>;
  observation?:ApplicationObservation; action?:ApplicationAction; modelRunId?:string;
  visited:string[]; filled:string[]; attached:boolean;
};
const owner=z.object({entryId:id,sessionId:z.string().uuid()}).strict();
export const applicationPayloads = {
  'board.application.start': z.object({entryId:id,sessionId:z.string().uuid(),cvVersionId:id,preferences:z.record(z.string(),z.unknown()).refine(value=>JSON.stringify(value).length<=20000,'Profile preferences are too large.')}).strict(),
  'board.application.observe': owner.extend({observation:applicationObservationSchema}).strict(),
  'board.application.report': owner.extend({actionId:z.string().uuid(),ok:z.boolean(),message:z.string().max(2000),observation:applicationObservationSchema.optional()}).strict(),
  'board.application.control': owner.extend({action:z.enum(['pause','resume','cancel']),resetBrowser:z.boolean().optional(),message:z.string().max(2000).optional()}).strict(),
};
export const fieldDraftSchema = z.object({
  answers:z.array(z.object({fieldId:id,value:text,source:z.enum(['profile','draft']),evidence:z.array(z.string().max(500)).max(30)}).strict()).max(150),
  missing:z.array(z.object({fieldId:id,reason:z.string().max(1000)}).strict()).max(150)
}).strict();
