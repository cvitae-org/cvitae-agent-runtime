import { applicationPayloads } from './application-agent.js';
import { z } from 'zod';
import { applicationStages } from './board.js';
const id = z.string().min(1).max(200);
const time = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const write = z.object({entryId:id,operationId:id,expectedRevision:z.number().int().min(1)});
const answer = z.object({id, label:z.string().trim().min(1).max(2000),value:z.string().max(30000)}).strict();
const answers = z.array(answer).max(300).refine(items=>new Set(items.map(item=>item.id)).size===items.length,'Answer IDs must be unique');
export const boardPayloads = {
  ...applicationPayloads,
  'board.entries.list': z.object({}).strict(),
  'board.entries.get': z.object({entryId:id}).strict(),
  'board.entries.add': z.object({offerId:id,operationId:id}).strict(),
  'board.entries.importLegacy': z.object({operationId:id,entries:z.array(z.record(z.string(),z.unknown())).max(10000)}).strict(),
  'board.entries.drop': write.strict(),
  'board.poll': z.object({after:time.default(0)}).strict(),
  'board.preparation.control': write.extend({action:z.enum(['prepare','pause','resume','retry','refreshPosting','refreshCv','regenerate'])}).strict(),
  'board.context.configure': write.extend({language:z.enum(['pl','en']).optional(),contextId:id.optional(),postingText:z.string().trim().min(1).max(1000000).optional()}).strict(),
  'board.summary.update': write.extend({summary:z.string().trim().min(1).max(30000),cvVersionId:id}).strict(),
  'board.answers.save': write.extend({answers}).strict(),
  'board.notes.add': write.extend({text:z.string().trim().min(1).max(30000),at:time}).strict(),
  'board.stage.set': write.extend({stage:z.enum(applicationStages),note:z.string().max(30000).optional()}).strict(),
  'board.submissions.record': write.extend({kind:z.enum(['application','followup','correction']),correctsId:id.optional(),submittedAt:time,destination:z.string().max(4000),channel:z.string().max(1000),answers,note:z.string().max(30000),cvVersionId:id.optional(),artifactId:id.optional()}).strict(),
  'board.artifacts.put': write.extend({name:z.string().min(1).max(1000),mime:z.string().min(1).max(200),base64:z.string().max(28000000),cvVersionId:id.optional()}).strict(),
  'board.artifacts.get': z.object({entryId:id,artifactId:id}).strict()
};
