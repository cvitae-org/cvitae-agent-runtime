import { createHash } from 'node:crypto';
import type { IntegrationExecution, IntegrationProvenance } from '../contracts/integration.js';
import type { ScopedIntegration, IntegrationProviders } from './integration-providers.js';
import { OperationError } from '../contracts/operation-error.js';

export function executionFor(source: ScopedIntegration, engine: IntegrationProvenance['engine']): IntegrationExecution {
  const recipe = [source.source.recipe, source.source.browserRecipe, source.source.detailRecipe].find(recipe => recipe?.kind === engine);
  if (!recipe) throw new OperationError('unsupported_source', 'This integration does not support the requested engine.');
  return { recipe: structuredClone(recipe), provenance: { ...source.reference, sourceKey: source.key,
    recipeRevision: recipe.revision, releaseRevision: source.releaseRevision, releaseSequence: source.releaseSequence,
    engine, engineVersion: '1', recipeHash: createHash('sha256').update(JSON.stringify(recipe)).digest('hex') } };
}

export function connectionEnabled(providers: IntegrationProviders, source: ScopedIntegration): boolean {
  return (source.generation === undefined || source.generation === providers.generation(source.reference.connectionId)) && providers.connections().some(connection => connection.id === source.reference.connectionId && connection.enabled && connection.providerId === source.reference.providerId);
}
