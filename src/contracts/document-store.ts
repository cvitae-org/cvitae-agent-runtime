/**
 * Documents, with the read-merge-write hole closed by the shape of the API.
 *
 * There is deliberately no `write(document)`. The previous runtime had one, and
 * extraction used it the obvious way — read the document, merge a section into
 * it, write it back — with no lock between the read and the write and every
 * write going through the same `<path>.<pid>.tmp` filename. Concurrent updates
 * were reproduced twenty times and all twenty had a rejected write. Unique
 * temporary names would have fixed the crash and left the lost update.
 *
 * So the only way to change a document is to hand over the merge itself.
 * `update` runs the mutator inside one transaction with the revision checked on
 * the way out, which makes the interleaving unrepresentable rather than
 * unlikely.
 *
 * The body is untyped here on purpose. A CV's shape is domain knowledge and
 * domain knowledge lives in `capabilities/`; a `CvDocument` in `contracts/`
 * would make every module that merely passes a document around depend on the
 * details of one capability's schema.
 */

export type DocumentBody = Readonly<Record<string, unknown>>;

export type DocumentRecord = {
  readonly id: string;
  readonly kind: string;
  /** Bumped by every successful `update`. Compare-and-swap, not a version log. */
  readonly revision: number;
  readonly body: DocumentBody;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export interface DocumentStore {
  read(id: string): DocumentRecord | undefined;

  /**
   * Reads, applies `mutate`, and writes back inside a single transaction with
   * the revision checked. The mutator must be pure: it may be run again if the
   * write loses a race, and it must not perform effects.
   *
   * `kind` is used only when the document does not exist yet.
   */
  update(
    id: string,
    kind: string,
    mutate: (current: DocumentBody | undefined) => DocumentBody
  ): DocumentRecord;
}
