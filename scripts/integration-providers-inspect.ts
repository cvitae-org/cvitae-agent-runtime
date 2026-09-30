import { configuredIntegrationProviders } from '../src/effects/integration-providers.js';

if (process.argv.slice(2).length) {
  console.log('Set INTEGRATION_PROVIDERS_JSON and INTEGRATION_PROVIDERS_CACHE_DIR, then run this script without arguments.');
  console.log('Connections contain explicitly trusted public keys and optional credential references. Only signed integration metadata is downloaded.');
  process.exitCode = process.argv[2] === '--help' ? 0 : 2;
} else {
  try {
    const providers = configuredIntegrationProviders();
    if (!providers) throw new Error('No provider connections configured.');
    try {
      const result = await providers.resolve(new AbortController().signal, true);
      console.log(JSON.stringify({ providers: result.providers.map(({ connectionId, providerId, name, status, detail, snapshot }) => ({
        connectionId, providerId, name, status, ...(detail ? { detail } : {}),
        ...(snapshot ? { revision: snapshot.revision, releaseSequence: snapshot.releaseSequence, validUntil: snapshot.validUntil } : {}),
      })), sources: result.sources.map(({ key, reference, source }) => ({ key, ...reference, label: source.label, revision: source.revision, modes: source.modes })) }, null, 2));
      if (result.providers.some(provider => provider.status === 'unavailable')) process.exitCode = 1;
    } finally { providers.close(); }
  } catch {
    console.error('Provider inspection failed. Check connection settings, trusted keys, credential references and the absolute cache directory.');
    process.exitCode = 1;
  }
}
