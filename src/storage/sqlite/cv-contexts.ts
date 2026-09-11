import { CvContextError, LEGACY_CV_CONTEXT_ID, cvLanguages } from '../../contracts/index.js';
import type { CvContext, CvContextStore, CvLanguage } from '../../contracts/index.js';
import type { Db } from './open.js';

type Row = {
  include_photo: number;
  generation: number;
  id: string;
  language: CvLanguage | null;
  revision: number;
  created_at: number;
  updated_at: number;
};
const contextOf = (row: Row): CvContext => ({
  includePhoto: row.include_photo === 1,
  generation: row.generation,
  id: row.id, language: row.language, revision: row.revision,
  createdAt: row.created_at, updatedAt: row.updated_at
});

const validateLanguage = (language: CvLanguage): void => {
  if (!cvLanguages.includes(language)) {
    throw new CvContextError('invalid_input', 'CV language must be pl or en.');
  }
};

export const createCvContextStore = (db: Db, now: () => number = Date.now): CvContextStore => {
  const select = db.prepare<[string]>('SELECT * FROM cv_contexts WHERE id = ?');
  const get = (id: string): CvContext | undefined => {
    const row = select.get(id) as Row | undefined;
    return row ? contextOf(row) : undefined;
  };
  const languageOwner = db.prepare<[string]>('SELECT id FROM cv_contexts WHERE language = ?');
  const assertLanguageAvailable = (language: CvLanguage): void => {
    if (languageOwner.get(language)) {
      throw new CvContextError('language_in_use', `A ${language} CV context already exists.`);
    }
  };
  const create = db.transaction((id: string, language: CvLanguage): CvContext => {
    validateLanguage(language);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      throw new CvContextError('invalid_input', 'New context IDs must be lowercase UUIDs.');
    }
    const existing = get(id);
    if (existing) {
      if (existing.language === language) return existing;
      throw new CvContextError('context_conflict', 'Context ID is already used by another language.');
    }
    if (get(LEGACY_CV_CONTEXT_ID)?.language === null) {
      throw new CvContextError('language_assignment_required', 'Assign the existing CV language first.');
    }
    assertLanguageAvailable(language);
    if (db.prepare('SELECT id FROM documents WHERE id = ?').get(id)) {
      throw new CvContextError('context_conflict', 'Context ID is already used by a document.');
    }
    const at = now();
    db.prepare(`INSERT INTO cv_contexts (id, language, created_at, updated_at)
      VALUES (?, ?, ?, ?)`).run(id, language, at, at);
    return get(id)!;
  }).immediate;
  const assignLanguage = db.transaction((id: string, language: CvLanguage, expectedRevision: number): CvContext => {
    validateLanguage(language);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new CvContextError('invalid_input', 'Expected context revision must be a positive safe integer.');
    }
    const existing = get(id);
    if (!existing) throw new CvContextError('context_not_found', `No such CV context: ${id}`);
    if (existing.language === language) return existing;
    if (existing.language !== null || existing.revision !== expectedRevision) {
      throw new CvContextError('context_conflict', 'Context changed since language assignment was opened.');
    }
    assertLanguageAvailable(language);
    db.prepare(`UPDATE cv_contexts SET language = ?, revision = revision + 1, updated_at = ?
      WHERE id = ?`).run(language, now(), id);
    return get(id)!;
  }).immediate;
  return {
    list: () => (db.prepare('SELECT * FROM cv_contexts ORDER BY created_at, id').all() as Row[]).map(contextOf),
    get,
    create,
    assignLanguage
  };
};
