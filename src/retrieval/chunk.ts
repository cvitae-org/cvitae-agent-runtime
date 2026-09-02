/**
 * Turning pieces of a document into the units that get embedded.
 *
 * What this file knows: how a piece becomes a chunk with a stable id, how long
 * is long enough to be worth embedding, and how to keep two identical pieces
 * from becoming two rows with the same primary key.
 *
 * What it deliberately does not know: which parts of a document are pieces.
 * That is domain judgment — a CV's retrievable content is its experience
 * bullets and its role description, and its dates, contact details and
 * certificate issuers are looked up rather than searched for — and domain
 * judgment lives in `capabilities/`. A chunker that imported a CV schema would
 * put one capability's shape in the path of every other.
 *
 * One piece is one chunk. The usual sliding-window chunker exists for documents
 * with no structure, and the documents here have plenty: a bullet is already
 * the unit a person wrote as a single claim, already about one thing, and
 * already the right size to hand back to a model. Splitting by character count
 * would cut across two of them and retrieve half of each.
 */

/**
 * A candidate unit, as the caller sees it.
 *
 * `context` rides along in the embedded text rather than only in `meta`,
 * because "React work at an e-commerce company" should match a bullet whose own
 * wording never names the employer. Filtering on metadata cannot do that; the
 * words have to be in the vector.
 */
export type Piece = {
  readonly kind: string;
  readonly text: string;
  /** Prepended to the embedded text, e.g. `'Senior Engineer at Acme'`. */
  readonly context?: string;
  readonly position: number;
  readonly meta?: Readonly<Record<string, unknown>>;
};

export type Chunk = {
  /** Content-addressed, so an unedited piece keeps its row across a re-index. */
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly position: number;
  readonly meta: Readonly<Record<string, unknown>>;
};

/**
 * Long enough to carry meaning.
 *
 * "Agile" and "Scrum" are real bullets and retrieve nothing useful: they match
 * every query about process and distinguish nothing. Below this they cost an
 * embedding call and a row and pay back neither.
 */
export const MIN_LENGTH = 25;

/**
 * A short deterministic hash of the source text.
 *
 * Keying by index alone would reassign every id below an edit when a piece is
 * inserted, so the whole tail re-embeds for nothing. Keying by content means
 * only what changed is recomputed, which is the difference between a re-index
 * measured in milliseconds and one measured in seconds against a local server.
 *
 * FNV-1a: not cryptographic, and does not need to be. A collision would reuse
 * one embedding for two different strings, and the inputs are a user's own
 * documents rather than anything adversarial.
 */
const hash = (value: string): string => {
  let digest = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    digest ^= value.charCodeAt(index);
    digest = Math.imul(digest, 0x01000193) >>> 0;
  }

  return digest.toString(36);
};

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Chunks a document's pieces, in order.
 *
 * Pieces shorter than `MIN_LENGTH` are dropped, and pieces that produce the
 * same id are dropped after the first. That second rule is not tidiness: ids
 * are content-addressed and the index stores them as a primary key, so two
 * identical bullets — which a real CV does contain, the same claim repeated
 * under two employers — would otherwise be a constraint violation at write
 * time rather than a duplicate in a result list.
 */
export const chunkPieces = (pieces: readonly Piece[]): Chunk[] => {
  const chunks: Chunk[] = [];
  const seen = new Set<string>();

  for (const piece of pieces) {
    const text = clean(piece.text);

    if (text.length < MIN_LENGTH) continue;

    const context = clean(piece.context ?? '');
    const embedded = context ? `${context}: ${text}` : text;

    // The id is derived from everything that goes into the vector, so two
    // bullets identical in wording but attached to different employers are
    // different chunks — which they are, and which the vectors reflect.
    const id = `${piece.kind}:${hash(embedded)}`;

    if (seen.has(id)) continue;

    seen.add(id);

    chunks.push({
      id,
      kind: piece.kind,
      text: embedded,
      position: piece.position,
      meta: piece.meta ?? {}
    });
  }

  return chunks;
};
