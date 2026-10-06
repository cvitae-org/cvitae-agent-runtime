import { CvContextError, OperationError } from '../../contracts/index.js';
import type { CvContextStore, CvLifecycle, CvProposalBase, CvProposalDetails, DocumentBody, DocumentChange, DocumentRecord, DocumentStore, DocumentValue, ChunkIndex, StoredCvProposal, CvClearResult } from '../../contracts/index.js';
import { ChangesDoNotApply, applyCv, cvChangesSchema, outside, same, touched } from '../../capabilities/cv/diff.js';
import { asCvDocument } from '../../capabilities/cv/document.js';
import { sectionOf } from '../../capabilities/cv/target.js';
import type { Db } from './open.js';

type Row = {
  id: string; context_id: string; base_revision: number; generation: number;
  document: string; status: StoredCvProposal['status']; accepted_record: string | null; created_at: number;
  target: string | null; changes: string | null;
};
const fromRow = (row: Row): StoredCvProposal => ({
  id: row.id, base: { contextId: row.context_id, revision: row.base_revision, generation: row.generation },
  document: JSON.parse(row.document) as DocumentBody,
  // Kept when they were made with it; a proposal from before has neither.
  ...(row.target === null ? {} : { target: row.target }),
  ...(row.changes === null ? {} : { changes: JSON.parse(row.changes) as DocumentChange[] }),
  status: row.status, createdAt: row.created_at
});

/**
 * What an accept writes: the stored CV with the proposal's changes applied.
 *
 * Only what the proposal says it changes is written. A change outside the section
 * it was aimed at is refused whoever stored it, and a list that does not apply to
 * the document, or that does not make the document the proposal holds, is refused
 * as a conflict and writes nothing. The second is what lets a person trust that
 * what was shown is what was saved: the changes are the proposal.
 */
const written = (row: Row, current: DocumentBody | undefined): DocumentBody => {
  const document = JSON.parse(row.document) as DocumentBody;
  if (row.changes === null) return document;

  const parsed = cvChangesSchema.safeParse(JSON.parse(row.changes));
  if (!parsed.success || row.target === null) {
    throw new OperationError('proposal_out_of_scope', 'The changes of this proposal cannot be read, so it cannot be accepted.');
  }

  const section = sectionOf(row.target, row.context_id);
  const elsewhere = outside(parsed.data, section);
  if (elsewhere.length > 0) {
    throw new OperationError(
      'proposal_out_of_scope',
      `This proposal also changes ${touched(elsewhere).join(', ')}, which it was not aimed at (${section}).`
    );
  }

  let result: DocumentBody;
  try {
    result = applyCv(asCvDocument(current), parsed.data) as unknown as DocumentBody;
  } catch (error) {
    if (error instanceof ChangesDoNotApply) throw new CvContextError('context_conflict', error.message);
    throw error;
  }
  if (!same(result as unknown as DocumentValue, document as unknown as DocumentValue)) {
    throw new CvContextError('context_conflict', 'The changes of this proposal do not make the document it holds.');
  }
  return result;
};

export const createCvLifecycle = (
  db: Db, contexts: CvContextStore, documents: DocumentStore, chunks: ChunkIndex,
  empty: () => DocumentBody, now: () => number = Date.now
): CvLifecycle => {
  const requiredContext = (id: string) => {
    const context = contexts.get(id);
    if (!context) throw new CvContextError('context_not_found', `No such CV context: ${id}`);
    return context;
  };
  const guard = <T>(id: string, generation: number, write: () => T): T => db.transaction(() => {
    if (requiredContext(id).generation !== generation) {
      throw new CvContextError('context_conflict', 'The CV was cleared after this operation started.');
    }
    return write();
  }).immediate();
  const proposal = (contextId: string, id: string): Row => {
    const row = db.prepare('SELECT * FROM cv_proposals WHERE id = ? AND context_id = ?').get(id, contextId) as Row | undefined;
    if (!row) throw new CvContextError('context_not_found', 'No such proposal in this CV context.');
    return row;
  };
  return {
    guard,
    clearContent: db.transaction((contextId: string, expectedRevision: number, operationId: string): CvClearResult => {
      if (!operationId.trim() || operationId.length > 200 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new CvContextError('invalid_input', 'Clear requires an operation ID and a non-negative revision.');
      }
      const receipt = db.prepare('SELECT * FROM cv_clear_receipts WHERE operation_id = ?').get(operationId) as
        { context_id: string; expected_revision: number; result: string } | undefined;
      if (receipt) {
        if (receipt.context_id !== contextId || receipt.expected_revision !== expectedRevision) {
          throw new CvContextError('context_conflict', 'Operation ID was already used for a different clear request.');
        }
        return JSON.parse(receipt.result) as CvClearResult;
      }
      requiredContext(contextId);
      // Old runs have no captured generation. They must finish or be cancelled
      // before clearing their legacy destination during protocol rollout.
      if (contextId === 'cv' && db.prepare(`SELECT id FROM runs WHERE context_id IS NULL
        AND status IN ('queued', 'running', 'suspended') LIMIT 1`).get()) {
        throw new CvContextError('context_conflict', 'Finish or cancel legacy runs before clearing this CV.');
      }
      const record = documents.update(contextId, 'cv', empty, { expectedRevision });
      db.prepare(`UPDATE cv_contexts SET generation = generation + 1, revision = revision + 1,
        updated_at = ? WHERE id = ?`).run(now(), contextId);
      chunks.clear(contextId);
      db.prepare("UPDATE cv_proposals SET status = 'invalidated' WHERE context_id = ? AND status = 'pending'").run(contextId);
      const result = { context: requiredContext(contextId), record };
      db.prepare('INSERT INTO cv_clear_receipts VALUES (?, ?, ?, ?)').run(operationId, contextId, expectedRevision, JSON.stringify(result));
      return result;
    }).immediate,
    propose: db.transaction((runId: string, base: CvProposalBase, document: DocumentBody, details?: CvProposalDetails): StoredCvProposal => {
      const context = requiredContext(base.contextId);
      const run = db.prepare('SELECT context_id, context_generation FROM runs WHERE id = ?').get(runId) as
        { context_id: string | null; context_generation: number | null } | undefined;
      if (!run || run.context_id !== base.contextId || run.context_generation !== base.generation ||
          !Number.isSafeInteger(base.revision) || base.revision < 0) {
        throw new CvContextError('context_conflict', 'Proposal base does not match its originating run.');
      }
      const stored = db.prepare('SELECT * FROM cv_proposals WHERE id = ?').get(runId) as Row | undefined;
      if (stored) {
        if (stored.context_id !== base.contextId || stored.base_revision !== base.revision ||
            stored.generation !== base.generation || stored.document !== JSON.stringify(document) ||
            stored.target !== (details?.target ?? null) || stored.changes !== (details === undefined ? null : JSON.stringify(details.changes))) {
          throw new CvContextError('context_conflict', 'A run cannot replace an already stored proposal.');
        }
        return fromRow(stored);
      }
      db.prepare(`INSERT INTO cv_proposals (id, context_id, base_revision, generation, document, status, created_at, target, changes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, base.contextId, base.revision, base.generation,
        JSON.stringify(document), context.generation === base.generation ? 'pending' : 'invalidated', now(),
        details?.target ?? null, details === undefined ? null : JSON.stringify(details.changes));
      return fromRow(proposal(base.contextId, runId));
    }).immediate,
    list: (contextId) => {
      requiredContext(contextId);
      return (db.prepare('SELECT * FROM cv_proposals WHERE context_id = ? ORDER BY created_at DESC, id').all(contextId) as Row[]).map(fromRow);
    },
    accept: db.transaction((contextId: string, id: string): DocumentRecord => {
      const row = proposal(contextId, id);
      if (row.status === 'accepted') return JSON.parse(row.accepted_record!) as DocumentRecord;
      if (row.status !== 'pending') throw new CvContextError('context_conflict', 'This proposal is no longer pending.');
      return guard(contextId, row.generation, () => {
        const record = documents.update(contextId, 'cv', (current) => written(row, current),
          { expectedRevision: row.base_revision });
        chunks.clear(contextId);
        db.prepare("UPDATE cv_proposals SET status = 'accepted', accepted_record = ? WHERE id = ?").run(JSON.stringify(record), id);
        return record;
      });
    }).immediate,
    discard: db.transaction((contextId: string, id: string) => {
      const row = proposal(contextId, id);
      if (row.status === 'accepted') throw new CvContextError('context_conflict', 'An accepted proposal cannot be discarded.');
      db.prepare("UPDATE cv_proposals SET status = 'discarded' WHERE id = ?").run(id);
      return fromRow(proposal(contextId, id));
    }).immediate
  };
};
