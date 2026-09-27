import { createHash, randomUUID } from 'node:crypto';
import { OperationError } from '../../contracts/operation-error.js';
import { preparationSteps, type BoardEntry, type BoardSummary, type BoardWrite, type BoardCv, type BoardRunInput, type BoardChatMessage, type BoardSubmission, type BoardArtifact } from '../../contracts/board.js';
import type { OfferStore } from '../../contracts/index.js';
import type { Db } from './open.js';

export const emptyBoardSteps = (): BoardEntry['preparation']['steps'] => Object.fromEntries(preparationSteps.map(step => [step, { status: 'pending', attempts: 0 }])) as BoardEntry['preparation']['steps'];
export const currentCv = (entry: BoardEntry) => entry.cvs.find(cv => cv.id === entry.currentCvId);
export const currentPosting = (entry: BoardEntry) => entry.postings.find(posting => posting.id === entry.currentPostingId);
export const boardSummary = (entry: BoardEntry): BoardSummary => ({
  id: entry.id, offerId: entry.offerId, opportunityId: entry.opportunityId, addedAt: entry.addedAt, updatedAt: entry.updatedAt,
  revision: entry.revision, applicationStage: entry.applicationStage, preparation: entry.preparation,
  currentCvId: entry.currentCvId, languageOverride: entry.languageOverride, language: entry.language?.detected,
  title: entry.discovery.position ?? '', company: entry.discovery.company ?? '', url: entry.discovery.url ?? '', board: entry.discovery.board ?? '', archived: entry.archived
});
export const boardEvent = (entry: BoardEntry, type: string, data: Record<string, unknown> = {}, at = Date.now()) => {
  entry.history.push({ id: randomUUID(), at, type, data });
};

/** All Board writes, snapshots, receipts and change notifications share one transaction. */
export const createBoardStore = (db: Db, offers: OfferStore, resolve: (ids: string[]) => Map<string, string | null>, now = Date.now) => {
  const get = (id: string): BoardEntry | undefined => {
    const row = db.prepare('SELECT body FROM board_entries WHERE id = ?').get(id) as {body: string} | undefined;
    return row ? JSON.parse(row.body) as BoardEntry : undefined;
  };
  const requireEntry = (id: string) => {
    const entry = get(id);
    if (!entry) throw new OperationError('board_missing', 'This Board entry is unavailable.');
    return entry;
  };
  const all = (): BoardEntry[] => (db.prepare('SELECT body FROM board_entries ORDER BY change_seq DESC').all() as {body: string}[]).map(row => JSON.parse(row.body) as BoardEntry);
  const publish = (entry: BoardEntry): BoardEntry => {
    entry.revision++;
    entry.updatedAt = now();
    const seq = db.prepare('INSERT INTO board_changes(entry_id) VALUES (?)').run(entry.id).lastInsertRowid;
    db.prepare('INSERT INTO board_entries VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, change_seq=excluded.change_seq')
      .run(entry.id, entry.offerId, JSON.stringify(entry), seq);
    return structuredClone(entry);
  };
  const receipt = <T>(id: string, request: unknown, action: () => T): T => {
    const key = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const prior = db.prepare('SELECT request,result FROM board_operations WHERE id=?').get(id) as { request: string; result: string } | undefined;
    if (prior) {
      if (prior.request !== key) throw new OperationError('operation_conflict', 'This operation ID belongs to another request.');
      const result = JSON.parse(prior.result);
      if (result.removed && (request as unknown[])[0] !== 'drop') {
        throw new OperationError('board_missing', 'This Board entry was removed. Add the offer again to start fresh.');
      }
      return result as T;
    }
    const result = action();
    db.prepare('INSERT INTO board_operations VALUES (?,?,?)').run(id, key, JSON.stringify(result));
    return result;
  };
  const mutate = <T extends BoardWrite>(request: T, type: string, change: (entry: BoardEntry) => void): BoardEntry => db.transaction(() => receipt(request.operationId, [type, request], () => {
    const entry = requireEntry(request.entryId);
    if (entry.revision !== request.expectedRevision) throw new OperationError('board_conflict', 'This offer changed while you were editing. Reload it before saving again.');
    change(entry);
    return publish(entry);
  })).immediate();
  const internal = (id: string, generation: number, change: (entry: BoardEntry) => void): BoardEntry | undefined => db.transaction(() => {
    const entry = get(id);
    if (!entry || entry.preparation.generation !== generation || entry.archived) return undefined;
    change(entry);
    return publish(entry);
  }).immediate();
  const newEntry = (offerId: string, opportunityId: string | undefined, automatic: boolean): BoardEntry => {
    const at = now();
    const offer = offers.get(offerId);
    if (!offer && automatic) throw new OperationError('offer_missing', 'This listing is no longer available.');
    return { id: randomUUID(), offerId, opportunityId, addedAt: at, updatedAt: at, revision: 0, archived: false,
      discovery: structuredClone(offer ?? { id: offerId, text: '', processing: 'candidate', disposition: 'active', firstSeenAt: at, lastSeenAt: at }),
      applicationStage: 'notApplied', preparation: { status: automatic ? 'queued' : 'notStarted', generation: 1, step: 'fetch', steps: emptyBoardSteps() },
      postings: [], cvs: [], answers: [], submissions: [], artifacts: [], history: [] };
  };
  const add = (request: { offerId: string; operationId: string }): BoardEntry => db.transaction(() => receipt(request.operationId, ['add', request], () => {
    const entries = all();
    const ids = resolve([request.offerId, ...entries.map(entry => entry.offerId)]);
    const identity = ids.get(request.offerId);
    const existing = entries.find(entry => entry.offerId === request.offerId || (identity != null && ids.get(entry.offerId) === identity));
    if (existing) {
      if (existing.archived) { existing.archived = false; boardEvent(existing, 'restored', {}, now()); return publish(existing); }
      return existing;
    }
    const entry = newEntry(request.offerId, identity ?? undefined, true);
    boardEvent(entry, 'added', { offerId: request.offerId }, now());
    return publish(entry);
  })).immediate();
  const addCv = (entry: BoardEntry, cv: Omit<BoardCv, 'id' | 'createdAt'>) => {
    const version = { ...cv, id: randomUUID(), createdAt: now() };
    entry.cvs.push(version); entry.currentCvId = version.id;
    boardEvent(entry, 'cvVersion', { cvVersionId: version.id, reason: version.reason }, now());
    return version;
  };
  const storeRun = (value: BoardRunInput) => {
    requireEntry(value.entryId);
    const prior = getRun(value.runId);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(value)) throw new OperationError('operation_conflict', 'Run identity is already in use.');
      return prior;
    }
    db.prepare('INSERT INTO board_run_inputs VALUES (?,?,?)').run(value.runId, value.entryId, JSON.stringify(value));
    return value;
  };
  const getRun = (id: string): BoardRunInput | undefined => {
    const row = db.prepare('SELECT body FROM board_run_inputs WHERE run_id=?').get(id) as {body: string} | undefined;
    return row ? JSON.parse(row.body) as BoardRunInput : undefined;
  };
  const chatMessages = (id: string): BoardChatMessage[] => {
    requireEntry(id);
    return (db.prepare('SELECT body FROM board_chat_messages WHERE entry_id=? ORDER BY rowid').all(id) as {body: string}[]).map(row => JSON.parse(row.body) as BoardChatMessage);
  };
  const appendChat = (id: string, message: BoardChatMessage) => {
    requireEntry(id);
    return db.prepare('INSERT OR IGNORE INTO board_chat_messages VALUES (?,?,?,?,?)').run(message.id, id, message.runId, message.role, JSON.stringify(message));
  };
  const removal = (id: string) => {
    const row = db.prepare('SELECT offer_id FROM board_removals WHERE entry_id=?').get(id) as {offer_id: string} | undefined;
    return row ? {id, offerId: row.offer_id, archived: true as const, removed: true as const} : undefined;
  };
  const drop = (request: BoardWrite) => db.transaction(() => receipt(request.operationId, ['drop', request], () => {
    const prior = removal(request.entryId);
    if (prior) return prior;
    const entry = requireEntry(request.entryId);
    if (entry.revision !== request.expectedRevision) throw new OperationError('board_conflict', 'This offer changed while you were editing. Reload it before removing it.');
    const result = {id: entry.id, offerId: entry.offerId, archived: true as const, removed: true as const};
    // Receipts contain complete workspace snapshots. Keep only identities and
    // request hashes so a delayed write cannot resurrect a deleted workspace.
    db.prepare("UPDATE board_operations SET result=? WHERE json_extract(result,'$.id')=?").run(JSON.stringify(result), entry.id);
    db.prepare('DELETE FROM board_artifacts WHERE entry_id=?').run(entry.id);
    db.prepare('DELETE FROM board_chat_messages WHERE entry_id=?').run(entry.id);
    db.prepare('DELETE FROM runs WHERE id IN (SELECT run_id FROM board_run_inputs WHERE entry_id=?)').run(entry.id);
    db.prepare('DELETE FROM board_run_authorizations WHERE run_id IN (SELECT run_id FROM board_run_inputs WHERE entry_id=?)').run(entry.id);
    db.prepare('DELETE FROM board_run_inputs WHERE entry_id=?').run(entry.id);
    db.prepare('DELETE FROM board_entries WHERE id=?').run(entry.id);
    db.prepare('INSERT INTO board_removals VALUES (?,?)').run(entry.id, entry.offerId);
    db.prepare('INSERT INTO board_changes(entry_id) VALUES (?)').run(entry.id);
    return result;
  })).immediate();
  return {
    get, requireEntry, all, add, drop, mutate, internal, addCv, storeRun, getRun, chatMessages, appendChat,
    updateWorkspace(id: string, change: (entry: BoardEntry) => void): BoardEntry {
      return db.transaction(() => {const entry=requireEntry(id);change(entry);return publish(entry);}).immediate();
    },
    authorizeRun(runId: string, input: unknown) {
      const serialized=JSON.stringify(input);
      const prior=db.prepare('SELECT input FROM board_run_authorizations WHERE run_id=?').get(runId) as {input:string}|undefined;
      if(prior && prior.input!==serialized) throw new OperationError('operation_conflict','Board run input changed.');
      db.prepare('INSERT OR IGNORE INTO board_run_authorizations VALUES (?,?)').run(runId,serialized);
    },
    transaction: <T>(action: () => T): T => db.transaction(action).immediate(),
    queued(at: number): BoardEntry[] { return (db.prepare("SELECT body FROM board_entries WHERE json_extract(body,'$.preparation.status')='queued' AND json_extract(body,'$.archived')=0 AND COALESCE(json_extract(body,'$.preparation.retryAt'),0)<=? ORDER BY change_seq").all(at) as {body:string}[]).map(row=>JSON.parse(row.body) as BoardEntry); },
    list: () => all().filter(entry => !entry.archived).map(boardSummary),
    poll(after = 0) {
      const rows = db.prepare('SELECT seq,entry_id FROM board_changes WHERE seq>? ORDER BY seq LIMIT 200').all(after) as {seq: number; entry_id: string}[];
      return { after: rows.at(-1)?.seq ?? after, hasMore: rows.length === 200, entries: [...new Set(rows.map(row => row.entry_id))].map(id => { const entry = get(id); return entry ? boardSummary(entry) : removal(id)!; }) };
    },
    recover() { for (const entry of all()) if (entry.preparation.status === 'running') internal(entry.id, entry.preparation.generation, current => { current.preparation.status = 'queued'; }); },
    runsFor(id: string) { return (db.prepare('SELECT body FROM board_run_inputs WHERE entry_id=? ORDER BY rowid').all(id) as {body: string}[]).map(row => JSON.parse(row.body) as BoardRunInput); },
    importLegacy(request: {operationId: string; entries: Record<string, unknown>[]}) {
      return db.transaction(() => receipt(request.operationId, ['importLegacy', request], () => {
        const imported: string[] = [];
        for (const row of request.entries) {
          const offerId = String(row.offerId ?? '');
          if (!offerId) throw new OperationError('invalid_input', 'A legacy Board entry is missing its offer ID.');
          const previous = all().find(entry => entry.offerId === offerId);
          if (previous) { imported.push(previous.id); continue; }
          const entry = newEntry(offerId, typeof row.opportunityId === 'string' ? row.opportunityId : undefined, false);
          const addedAt = Date.parse(String(row.addedAt));
          if (!Number.isFinite(addedAt)) throw new OperationError('invalid_input', 'A legacy Board date is invalid.');
          entry.addedAt = addedAt; entry.legacy = row;
          const app = row.application as Record<string, unknown> | undefined;
          if (app) {
            const stages: Record<string, BoardEntry['applicationStage']> = { awaiting: 'applied', acknowledged: 'applied', interviewing: 'interviewing', rejected: 'rejected', offer: 'offerReceived', withdrawn: 'withdrawn' };
            entry.applicationStage = stages[String(app.outcome)] ?? 'applied';
            const submittedAt = Date.parse(String(app.submittedAt));
            if (!Number.isFinite(submittedAt)) throw new OperationError('invalid_input', 'A legacy application date is invalid.');
            entry.submissions.push({ id: randomUUID(), kind: 'application', submittedAt, recordedAt: now(), destination: '', channel: '',
              answers: Object.entries((app.submitted ?? {}) as Record<string,string>).map(([label,value]) => ({ id: randomUUID(), label, value })),
              note: String(app.note ?? ''), legacyCvDocumentId: typeof app.cvDocumentId === 'string' ? app.cvDocumentId : undefined });
          } else if (row.stage === 'applied') entry.applicationStage = 'applied';
          if (row.stage === 'closed' && !['rejected','withdrawn'].includes(entry.applicationStage)) entry.applicationStage = 'closed';
          boardEvent(entry, 'legacyImported', { stage: row.stage ?? null, application: app ?? null }, now());
          publish(entry); imported.push(entry.id);
        }
        return { imported };
      })).immediate();
    },
    recordSubmission(request: BoardWrite & Omit<BoardSubmission, 'id' | 'recordedAt'>) {
      return mutate(request, 'submission', entry => {
        if (request.kind === 'correction' && !entry.submissions.some(item => item.id === request.correctsId)) throw new OperationError('invalid_input', 'Select the record being corrected.');
        if (request.kind !== 'correction' && request.correctsId) throw new OperationError('invalid_input', 'Only a correction can reference an earlier record.');
        if (request.cvVersionId && !entry.cvs.some(cv => cv.id === request.cvVersionId)) throw new OperationError('board_conflict', 'The CV version does not belong to this offer.');
        const artifact = entry.artifacts.find(item => item.id === request.artifactId);
        if (request.artifactId && !artifact) throw new OperationError('board_conflict', 'The file does not belong to this offer.');
        if (artifact?.cvVersionId && request.cvVersionId !== artifact.cvVersionId) throw new OperationError('board_conflict', 'The selected file and CV version do not match.');
        const submission: BoardSubmission = { id: randomUUID(), recordedAt: now(), kind: request.kind, correctsId: request.correctsId, submittedAt: request.submittedAt, destination: request.destination, channel: request.channel, answers: request.answers, note: request.note, cvVersionId: request.cvVersionId, artifactId: request.artifactId, legacyCvDocumentId: request.legacyCvDocumentId };
        entry.submissions.push(submission);
        if (request.kind === 'application') entry.applicationStage = 'applied';
        boardEvent(entry, 'submitted', { submissionId: submission.id, kind: submission.kind, note: submission.note, answers: submission.answers }, now());
      });
    },
    putArtifact(request: BoardWrite & {name: string; mime: string; base64: string; cvVersionId?: string}) {
      return mutate(request, 'artifact', entry => {
        if (request.cvVersionId && !entry.cvs.some(cv => cv.id === request.cvVersionId)) throw new OperationError('board_conflict', 'The CV version does not belong to this offer.');
        const content = Buffer.from(request.base64, 'base64');
        if (content.length === 0 || content.length > 20 * 1024 * 1024 || content.toString('base64') !== request.base64) throw new OperationError('invalid_input', 'Choose a valid file of at most 20 MB.');
        const artifact: BoardArtifact = { id: randomUUID(), name: request.name, mime: request.mime, sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length, createdAt: now(), cvVersionId: request.cvVersionId };
        db.prepare('INSERT INTO board_artifacts VALUES (?,?,?)').run(artifact.id, entry.id, content);
        entry.artifacts.push(artifact); boardEvent(entry, 'artifactSaved', { artifactId: artifact.id, name: artifact.name }, now());
      });
    },
    artifact(entryId: string, id: string) {
      const artifact = requireEntry(entryId).artifacts.find(item => item.id === id);
      const row = db.prepare('SELECT content FROM board_artifacts WHERE id=? AND entry_id=?').get(id,entryId) as {content: Buffer} | undefined;
      if (!artifact || !row) throw new OperationError('board_missing', 'This file is unavailable.');
      return { ...artifact, base64: row.content.toString('base64') };
    }
  };
};
