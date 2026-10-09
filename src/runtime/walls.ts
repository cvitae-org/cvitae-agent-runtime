/**
 * The ports a conversation run reads through, with what the person excluded
 * taken out of them.
 *
 * Rule: excluded means unreachable. A wall in front of one port is not enough
 * when another reaches the same text, so the document, the retrieval over it and
 * the index under that are cut together, from one list of walls that is read
 * again at every access. Read again, because a run that waited for a person and
 * is resumed must honour what was excluded while it waited, and a run that is
 * mid-way must honour it for the reads it has still to make.
 *
 *   documents   a CV comes back with the excluded pieces taken out. The record
 *               remembers what it was cut from (`capabilities/cv/walls.ts`), so
 *               an edit that has to write against the stored document, and the
 *               recorder that has to name pieces by their stored keys, can get
 *               back to it. Nothing that reads `body` can.
 *   retrieval   a passage is placed in the stored document, and dropped when the
 *   index       piece it came from is excluded. A passage that cannot be placed
 *               is dropped as well, whenever something of the CV is excluded
 *               now: whether it came from an excluded piece is then not known,
 *               and not knowing is not a reason to hand it over.
 *
 * Writes go through untouched. A wall decides what a model may be shown; the
 * document an edit is written against is the stored one, and cutting it would
 * make every edit made under an exclusion delete what was excluded.
 */

import { OperationError } from '../contracts/index.js';
import type { ChunkIndex, DocumentRecord, DocumentStore, Retriever, Walls } from '../contracts/index.js';
import { CV_ID, CV_KIND } from '../capabilities/cv/document.js';
import { CV_WELL, cvOf, placePath, placer } from '../capabilities/cv/well.js';
import type { CvHit } from '../capabilities/cv/well.js';
import { cvView, cvWallsOf, rememberView } from '../capabilities/cv/walls.js';
import { isWalled } from '../grounding/index.js';

export type WalledPorts = {
  readonly documents: DocumentStore;
  readonly retrieval: Retriever;
  readonly index: ChunkIndex;
};

/**
 * The ports of a run bound to the CV `scope`, behind the walls of its conversation.
 *
 * `ports` are the run's own, already bound to that CV: they are the ones that
 * answer to `CV_ID`.
 */
export const wallPorts = <P extends WalledPorts>(ports: P, walls: Walls, scope: string): P => {
  /** The stored CV as a document, for placing passages in it. */
  const stored = () => {
    const found = ports.documents.read(CV_ID);
    return found !== undefined && found.kind === CV_KIND ? cvOf(found.body) : undefined;
  };

  /** Keeps the passages whose piece is not excluded, and drops the rest. */
  const allowed = <T extends CvHit>(hits: readonly T[]): T[] => {
    const mine = cvWallsOf(walls.pieces(), scope);
    if (mine.length === 0) return hits as T[];

    const document = stored();
    if (document === undefined) return [];
    // Walls that name nothing the CV holds now cut nothing, and there is then no
    // excluded text for any passage to carry.
    if (!cvView(document, mine, scope).walled) return hits as T[];

    const place = placer(document);
    return hits.filter((hit) => {
      const found = place(hit);
      return found !== undefined && !isWalled(mine, { well: CV_WELL, scope, path: placePath(found.place) });
    });
  };

  const documents: DocumentStore = {
    read: (id) => {
      const found = ports.documents.read(id);
      if (found === undefined || found.kind !== CV_KIND) return found;

      const mine = cvWallsOf(walls.pieces(), scope);
      if (mine.length === 0) return found;

      const document = cvOf(found.body);
      if (document === undefined) {
        throw new OperationError(
          'walled_unreadable',
          'This CV has excluded parts and its stored body is not a CV, so what is left of it cannot be told from what is not.'
        );
      }

      const view = cvView(document, mine, scope);
      if (!view.walled) return found;

      const cut: DocumentRecord = { ...found, body: view.shown };
      rememberView(cut, view);
      return cut;
    },
    update: (id, kind, mutate, options) => ports.documents.update(id, kind, mutate, options)
  };

  const retrieval: Retriever = {
    search: async (query, signal) => allowed(await ports.retrieval.search(query, signal)),
    countOf: (id) => ports.retrieval.countOf?.(id)
  };

  const index: ChunkIndex = {
    lexical: (query) => allowed(ports.index.lexical(query)),
    neighbours: (query) => allowed(ports.index.neighbours(query)),
    fingerprintOf: (id) => ports.index.fingerprintOf(id),
    countOf: (id) => ports.index.countOf(id),
    replace: (id, fingerprint, chunks, options) => ports.index.replace(id, fingerprint, chunks, options),
    clear: (id, options) => ports.index.clear(id, options),
    keepText: (id, chunks, options) => ports.index.keepText(id, chunks, options)
  };

  return { ...ports, documents, retrieval, index };
};
