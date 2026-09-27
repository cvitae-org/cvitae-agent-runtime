import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHarness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
const offer = { id: 'a', url: 'https://justjoin.it/job-offer/a', text: '', firstSeenAt: 1, lastSeenAt: 1, processing: 'candidate' as const, disposition: 'active' as const };
test('notes reject stale edits and deletions, allow response replay, and survive offer updates', () => {
 const h = createHarness({ databasePath: ':memory:', env: {}, scraperUrl: '' });
 try {
  h.offers.save(offer);
  assert.equal(h.offerNotes.get('a').revision, 0);
  const saved = h.offerNotes.save('a', 'Call recruiter', 0);
  assert.deepEqual(h.offerNotes.save('a', 'Call recruiter', 0), saved);
  assert.throws(() => h.offerNotes.save('a', 'Stale edit', 0));
  h.offers.save({ ...offer, text: 'Enriched source', analysis: { company: 'Acme' } });
  assert.equal(h.offerNotes.get('a').text, 'Call recruiter');
  h.offerNotes.save('a', '', 1);
  assert.throws(() => h.offerNotes.save('a', 'Call recruiter', 1));
  assert.equal(h.offerNotes.get('a').text, '');
  assert.throws(() => h.offerNotes.save('missing', 'Orphan', 0));
 } finally { h.close(); }
});
test('notes survive database restart', () => {
 const dir = mkdtempSync(join(tmpdir(), 'notes-')); const path = join(dir, 'runtime.db');
 let h = createHarness({ databasePath: path, env: {}, scraperUrl: '' });
 try {
  h.offers.save(offer); h.offerNotes.save('a', 'Polski tekst — ✓', 0); h.close();
  h = createHarness({ databasePath: path, env: {}, scraperUrl: '' });
  assert.equal(h.offerNotes.get('a').text, 'Polski tekst — ✓');
  assert.equal(h.offerNotes.get('a').revision, 1);
 } finally { h.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('note IPC validates size, revisions and unknown fields', async () => {
 const h = createHarness({ databasePath: ':memory:', env: {}, scraperUrl: '' });
 try {
  h.offers.save(offer); const call = createDispatch(h);
  for (const payload of [{ offerId: 'a', text: 'x'.repeat(10001), revision: 0 }, { offerId: 'a', text: 'x', revision: -1 }, { offerId: 'a', text: 'x', revision: 0, analysis: {} }]) {
   assert.equal((await call('offers.note.save', payload)).ok, false);
  }
  assert.equal((await call('offers.note.save', { offerId: 'a', text: 'Saved', revision: 0 })).ok, true);
  const stale = await call('offers.note.save', { offerId: 'a', text: 'Conflict', revision: 0 });
  assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.error.code, 'note_conflict');
 } finally { h.close(); }
});
