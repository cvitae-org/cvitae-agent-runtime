import { createHash } from 'node:crypto';
import { integrationProvenanceSchema, type IntegrationExecution, type IntegrationAcquisition } from '../../contracts/integration.js';
import { OperationError } from '../../contracts/operation-error.js';
import type { Db } from './open.js';

export function createIntegrationAcquisitions(db: Db) {
  // Upgrade fixtures may construct a legacy catalogue before this migration.
  const present = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='discovery_integration_acquisitions'").get();
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    record(offerId: string, execution: IntegrationExecution | undefined, board: string, retrievedAt: string, seenAt: number) {
      if (!execution) return;
      const provenance = integrationProvenanceSchema.parse(execution.provenance);
      if (!present || provenance.sourceKey !== board || hash(execution.recipe) !== provenance.recipeHash
        || execution.recipe.sourceId !== provenance.sourceId || execution.recipe.revision !== provenance.recipeRevision || execution.recipe.kind !== provenance.engine) {
        throw new OperationError('invalid_response', 'Invalid acquisition provenance or recipe.');
      }
      const id = hash(provenance);
      db.prepare('INSERT INTO discovery_integration_definitions(id,provenance,recipe) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING')
        .run(id, JSON.stringify(provenance), JSON.stringify(execution.recipe));
      db.prepare(`INSERT INTO discovery_integration_acquisitions VALUES(?,?,?,?,?,?)
        ON CONFLICT(offer_id,definition_id) DO UPDATE SET
          first_retrieved_at=min(first_retrieved_at,excluded.first_retrieved_at),last_retrieved_at=max(last_retrieved_at,excluded.last_retrieved_at),
          first_seen_at=min(first_seen_at,excluded.first_seen_at),last_seen_at=max(last_seen_at,excluded.last_seen_at)`)
        .run(offerId, id, retrievedAt, retrievedAt, seenAt, seenAt);
    },
    list(offerId: string): IntegrationAcquisition[] {
      if (!present) return [];
      return (db.prepare(`SELECT d.provenance,a.first_retrieved_at AS firstRetrievedAt,a.last_retrieved_at AS lastRetrievedAt,
        a.first_seen_at AS firstSeenAt,a.last_seen_at AS lastSeenAt FROM discovery_integration_acquisitions a
        JOIN discovery_integration_definitions d ON d.id=a.definition_id WHERE a.offer_id=? ORDER BY a.last_seen_at DESC,d.id LIMIT 1000`)
        .all(offerId) as {provenance: string; firstRetrievedAt: string; lastRetrievedAt: string; firstSeenAt: number; lastSeenAt: number}[])
        .map(row => ({ ...row, provenance: integrationProvenanceSchema.parse(JSON.parse(row.provenance)) }));
    },
  };
}

/** A saved offer keeps the acquisition source selected by its latest sighting. */
export function createIntegrationOfferLookup(db: Db) {
  const query = db.prepare(`SELECT s.listing FROM discovery_sources s JOIN offers o ON o.id=s.offer_id
    WHERE (o.url=? OR o.final_url=?) AND json_extract(s.listing,'$.provenance.sourceKey') IS NOT NULL
    ORDER BY s.seen_at DESC,s.board LIMIT 1`);
  return (url: string): {sourceKey:string;externalId?:string}|undefined => {
    const row = query.get(url,url) as {listing:string}|undefined;
    if (!row) return;
    const listing = JSON.parse(row.listing) as {provenance:unknown;external_id?:string};
    const provenance = integrationProvenanceSchema.parse(listing.provenance);
    return {sourceKey:provenance.sourceKey,externalId:listing.external_id};
  };
}
