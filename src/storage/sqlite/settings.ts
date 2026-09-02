/**
 * `SettingsStore` over the one-row `settings` table.
 *
 * Small enough that the only thing worth saying is what the mapping does with
 * blanks. A column is NULL when the setting is not configured, and the store
 * folds the empty string into NULL on the way in — a text field someone typed
 * into and then emptied is the same statement as one they never touched, and
 * letting "" through would mean an empty model id reaching the resolver as a
 * configured value.
 */

import type { Settings, SettingsStore } from '../../contracts/index.js';
import type { Db } from './open.js';

type SettingsRow = {
  provider_id: string | null;
  model_id: string | null;
  local_base_url: string | null;
  embedding_provider_id: string | null;
  embedding_model_id: string | null;
};

/** Blank is unset, and `undefined` never becomes the string "undefined". */
const pack = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const unpack = (value: string | null): string | undefined => value ?? undefined;

const toSettings = (row: SettingsRow): Settings => ({
  providerId: unpack(row.provider_id),
  modelId: unpack(row.model_id),
  localBaseUrl: unpack(row.local_base_url),
  embeddingProviderId: unpack(row.embedding_provider_id),
  embeddingModelId: unpack(row.embedding_model_id)
});

export const createSettingsStore = (db: Db, now: () => number = Date.now): SettingsStore => {
  const select = db.prepare<[]>('SELECT * FROM settings WHERE id = 1');

  const update = db.prepare<
    [string | null, string | null, string | null, string | null, string | null, number]
  >(
    `UPDATE settings
        SET provider_id = ?, model_id = ?, local_base_url = ?,
            embedding_provider_id = ?, embedding_model_id = ?, updated_at = ?
      WHERE id = 1`
  );

  const read = (): Settings => toSettings(select.get() as SettingsRow);

  return {
    read,
    replace(next) {
      update.run(
        pack(next.providerId),
        pack(next.modelId),
        pack(next.localBaseUrl),
        pack(next.embeddingProviderId),
        pack(next.embeddingModelId),
        now()
      );

      // Read back rather than echo the argument. What a caller gets is what the
      // next launch will read, blanks folded and all, which is the only version
      // of the answer worth showing in a settings page.
      return read();
    }
  };
};
