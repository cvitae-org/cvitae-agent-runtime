import type { Db } from './open.js';
// Older migration fixtures can construct stores before this feature exists.
export const discoveryVisibility = (db: Db) => {
 const enabled = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='discovery_blacklist'").get();
 return {
  blacklisted: (id: string) => enabled && !!db.prepare('SELECT 1 FROM discovery_blacklist WHERE offer_id=?').get(id),
  suppressed: (searchId: string, id: string) => enabled && !!db.prepare('SELECT 1 FROM discovery_blacklist WHERE offer_id=? UNION ALL SELECT 1 FROM discovery_offer_visibility WHERE search_id=? AND offer_id=?').get(id,searchId,id),
  sql: (offer: string, search?: string) => !enabled ? '1=1' : `NOT EXISTS (SELECT 1 FROM discovery_blacklist b WHERE b.offer_id=${offer})${search ? ` AND NOT EXISTS (SELECT 1 FROM discovery_offer_visibility v WHERE v.offer_id=${offer} AND v.search_id=${search})` : ''}`
 };
};
