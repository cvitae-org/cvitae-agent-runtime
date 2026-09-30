import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { envelopeSchema, snapshotSchema, providerIdSchema, scopeSchema, sourceIdSchema } from './index.mjs';

/** @param {unknown} value @param {string} privateKey @param {string} keyId
 * @returns {import('zod').infer<typeof envelopeSchema>} */
export function signSnapshot(value, privateKey, keyId) {
  const payload = Buffer.from(JSON.stringify(snapshotSchema.parse(value)));
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Expected Ed25519 key');
  return envelopeSchema.parse({ algorithm: 'Ed25519', keyId, payloadBase64: payload.toString('base64'), signatureBase64: sign(null, payload, key).toString('base64') });
}

/** @param {unknown} raw @param {{providerId: string, publicKeys: Record<string, string>, scope: {categories: string[], markets: string[]}, now?: number, allowExpired?: boolean}} trusted
 * @returns {import('zod').infer<typeof snapshotSchema>} */
export function verifySnapshot(raw, trusted) {
  providerIdSchema.parse(trusted.providerId);
  const expectedScope = scopeSchema.parse(trusted.scope), envelope = envelopeSchema.parse(raw);
  if (!Object.hasOwn(trusted.publicKeys, envelope.keyId)) throw new Error('Unknown signing key');
  const payload = Buffer.from(envelope.payloadBase64, 'base64'), signature = Buffer.from(envelope.signatureBase64, 'base64');
  const key = createPublicKey(trusted.publicKeys[envelope.keyId]);
  if (payload.toString('base64') !== envelope.payloadBase64 || signature.toString('base64') !== envelope.signatureBase64
    || signature.length !== 64 || key.asymmetricKeyType !== 'ed25519' || !verify(null, payload, key, signature)) throw new Error('Invalid signature');
  const snapshot = snapshotSchema.parse(JSON.parse(payload.toString('utf8')));
  const now = trusted.now ?? Date.now();
  if (snapshot.providerId !== trusted.providerId || Date.parse(snapshot.publishedAt) > now + 300000
    || !trusted.allowExpired && Date.parse(snapshot.validUntil) <= now) throw new Error('Invalid provider identity or release validity');
  for (const field of ['categories', 'markets']) if (JSON.stringify([...snapshot.scope[field]].sort()) !== JSON.stringify([...expectedScope[field]].sort())) throw new Error('Response scope differs from the connection');
  return snapshot;
}

/** Stable local key; never replaces the original signed recipe source ID.
 * @param {string} connectionId @param {string} sourceId */
export function sourceKey(connectionId, sourceId) {
  sourceIdSchema.parse(connectionId); sourceIdSchema.parse(sourceId);
  return `p_${createHash('sha256').update(JSON.stringify([connectionId, sourceId])).digest('hex').slice(0, 40)}`;
}

/** Binds a cache to one connection, endpoint, scope and trust configuration.
 * @param {{id: string, providerId: string, resolveUrl: string, scope: {categories: string[], markets: string[]}, publicKeys: Record<string, string>}} connection */
export function cacheKey(connection) {
  return createHash('sha256').update(JSON.stringify([connection.id, connection.providerId, connection.resolveUrl,
    [...connection.scope.categories].sort(), [...connection.scope.markets].sort(), Object.entries(connection.publicKeys).sort(([a], [b]) => a.localeCompare(b))])).digest('hex');
}
