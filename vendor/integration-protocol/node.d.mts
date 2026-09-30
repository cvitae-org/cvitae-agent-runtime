/** @param {unknown} value @param {string} privateKey @param {string} keyId
 * @returns {import('zod').infer<typeof envelopeSchema>} */
export function signSnapshot(value: unknown, privateKey: string, keyId: string): import("zod").infer<typeof envelopeSchema>;
/** @param {unknown} raw @param {{providerId: string, publicKeys: Record<string, string>, scope: {categories: string[], markets: string[]}, now?: number, allowExpired?: boolean}} trusted
 * @returns {import('zod').infer<typeof snapshotSchema>} */
export function verifySnapshot(raw: unknown, trusted: {
    providerId: string;
    publicKeys: Record<string, string>;
    scope: {
        categories: string[];
        markets: string[];
    };
    now?: number;
    allowExpired?: boolean;
}): import("zod").infer<typeof snapshotSchema>;
/** Stable local key; never replaces the original signed recipe source ID.
 * @param {string} connectionId @param {string} sourceId */
export function sourceKey(connectionId: string, sourceId: string): string;
/** Binds a cache to one connection, endpoint, scope and trust configuration.
 * @param {{id: string, providerId: string, resolveUrl: string, scope: {categories: string[], markets: string[]}, publicKeys: Record<string, string>}} connection */
export function cacheKey(connection: {
    id: string;
    providerId: string;
    resolveUrl: string;
    scope: {
        categories: string[];
        markets: string[];
    };
    publicKeys: Record<string, string>;
}): string;
import { envelopeSchema } from './index.mjs';
import { snapshotSchema } from './index.mjs';
