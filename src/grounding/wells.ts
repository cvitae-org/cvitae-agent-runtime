/**
 * The wells an engine instance knows by name.
 *
 * Deliberately small. The engine's whole question about a well is whether its
 * id was registered, so a ref or a record entry cannot name a source nobody
 * stands behind. How a well keys its scopes, derives its item keys and reads
 * its data is the well's own code, next to the data, and none of it is asked
 * for here.
 *
 * Built once and never changed, like the capability map: a registry that can
 * grow while a run is in flight is one more thing a record can disagree with.
 */

import { OperationError } from '../contracts/index.js';
import type { PieceRef } from '../contracts/index.js';
import { isWellId } from './ref.js';

export type WellDef = {
  readonly id: string;
  /** One line, for a person reading a record or the protocol notes. */
  readonly describe: string;
};

export interface WellRegistry {
  has(id: string): boolean;
  get(id: string): WellDef | undefined;
  ids(): readonly string[];
  /** Throws `unknown_well` for a ref whose well is not registered. */
  check(ref: PieceRef): void;
}

export const createWellRegistry = (defs: readonly WellDef[]): WellRegistry => {
  const byId = new Map<string, WellDef>();
  for (const def of defs) {
    if (!isWellId(def.id)) {
      throw new OperationError('invalid_well', `Not a well id: ${JSON.stringify(def.id)}.`);
    }
    if (byId.has(def.id)) throw new OperationError('invalid_well', `Well registered twice: ${def.id}.`);
    byId.set(def.id, def);
  }

  return {
    has: (id) => byId.has(id),
    get: (id) => byId.get(id),
    ids: () => [...byId.keys()],
    check(ref) {
      if (!byId.has(ref.well)) throw new OperationError('unknown_well', `No well is registered as ${JSON.stringify(ref.well)}.`);
    }
  };
};
