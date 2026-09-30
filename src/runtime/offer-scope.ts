import { CvContextError } from '../contracts/index.js';
import type { EffectSet, OfferSnapshot, ChunkIndex, Retriever, DocumentStore } from '../contracts/index.js';
import { CV_ID, cvDocumentSchema } from '../capabilities/cv/document.js';
import { CV_PHOTO_ID } from '../capabilities/cv/photo.js';
import { cvPieces } from '../capabilities/cv/pieces.js';
import { chunkPieces } from '../retrieval/chunk.js';

/** Historical evidence is derived only from saved content; no live index or network offer fetch. */
export const bindOfferScope = (snapshot: OfferSnapshot, effects: EffectSet): {
  documents: DocumentStore; index: ChunkIndex; retrieval: Retriever; effects: EffectSet;
  contextGeneration: number; contextRevision: number;
} => {
  const reject = (): never => { throw new CvContextError('context_conflict', 'Offer snapshot inputs are read-only.'); };
  const check = (id?: string): void => {
    if (id !== undefined && id !== CV_ID && id !== snapshot.context.id) {
      throw new CvContextError('context_conflict', 'Snapshot cannot access another document.');
    }
  };
  const pieces = chunkPieces(cvPieces(cvDocumentSchema.parse(snapshot.document.body)));
  const index: ChunkIndex = {
    lexical: (query) => {
      check(query.documentId);
      const words = query.text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      return pieces.filter((piece) => !query.kinds || query.kinds.includes(piece.kind))
        .map((piece) => ({ ...piece, id: `${snapshot.id}:${piece.id}`, documentId: snapshot.context.id,
          sourceRevision: snapshot.document.revision,
          score: words.filter((word) => piece.text.toLocaleLowerCase().includes(word)).length }))
        .filter((piece) => piece.score > 0).sort((a, b) => b.score - a.score || a.position - b.position)
        .slice(0, Math.max(0, query.limit));
    },
    neighbours: (query) => { check(query.documentId); return []; },
    fingerprintOf: (id) => { check(id); return undefined; },
    replace: reject, clear: reject, keepText: reject
  };
  return {
    contextGeneration: snapshot.context.generation, contextRevision: snapshot.document.revision,
    documents: {
      read: (id) => {
        if (id === CV_PHOTO_ID) return { id, kind: 'cv_photo', revision: snapshot.photo.revision,
          createdAt: snapshot.createdAt, updatedAt: snapshot.createdAt, body: { photo: structuredClone(snapshot.photo.photo) } };
        check(id); return structuredClone(snapshot.document);
      }, update: reject
    }, index,
    retrieval: { search: async (query) => index.lexical(query).map((hit) => ({ ...hit, found: ['lexical'] })) },
    effects: { ...effects, offers: { resolve: async (url) => {
      if (!snapshot.offer.url || url !== snapshot.offer.url) reject();
      return { url, finalUrl: url, text: snapshot.offer.text,
        ...(snapshot.offer.stated ? { stated: snapshot.offer.stated } : {}) };
    } } }
  };
};

/** Caller may supply task instructions, but never replacement historical inputs. */
export const snapshotInput = (snapshot: OfferSnapshot, capability: string, raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CvContextError('invalid_input', 'Expected input object.');
  const input = raw as Record<string, unknown>;
  for (const key of ['document', 'candidate', 'offer', 'offerText', 'url', 'stated']) {
    if (key in input) throw new CvContextError('invalid_input', `Snapshot owns ${key}; omit it from task input.`);
  }
  if (['extract_cv', 'search_offers', 'rescore_offers'].includes(capability)) {
    throw new CvContextError('invalid_input', 'This capability requires live inputs.');
  }
  const facts = { company: snapshot.offer.company ?? '', position: snapshot.offer.position ?? '',
    location: snapshot.offer.location ?? '', required_skills: snapshot.offer.skills ?? [], ...snapshot.offer.analysis };
  if (capability === 'ask_profile') return { ...input, offerText: snapshot.offer.text };
  if (capability === 'generate_evidence_summary') {
    return { language: snapshot.context.language, ...input, offer: facts };
  }
  if (capability === 'verify_recipient') {
    for (const key of ['company', 'company_url', 'position', 'location']) {
      if (key in input) throw new CvContextError('invalid_input', `Snapshot owns ${key}.`);
    }
    return { ...input, company: facts.company, position: facts.position, location: facts.location,
      offerText: snapshot.offer.text };
  }
  if (capability === 'analyze_offer' || capability === 'draft_application') {
    return { ...(capability === 'draft_application' ? { language: snapshot.context.language } : {}), ...input, offerText: snapshot.offer.text,
      ...(capability === 'analyze_offer' ? { stated: snapshot.offer.stated } : { offer: facts }) };
  }
  return input;
};
