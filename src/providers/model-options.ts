import { providers, type ProviderId } from './resolve.js';

/** Studio's supported choices. Provider defaults are never duplicated here. */
export type ModelOption = {
  readonly id: 'openai' | 'bielik' | 'local';
  readonly label: string;
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly embeddingProviderId: ProviderId;
  readonly embeddingModelId: string;
};

const choices = [
  { id: 'openai', label: 'OpenAI', providerId: 'openai' },
  { id: 'bielik', label: 'Bielik', providerId: 'huggingface' },
  { id: 'local', label: 'Local', providerId: 'local' }
] as const;

export const modelOptions: readonly ModelOption[] = choices.map(({ id, label, providerId }) => ({
  id, label, providerId,
  modelId: providers[providerId].defaultModel,
  embeddingProviderId: providerId,
  embeddingModelId: providers[providerId].defaultEmbeddingModel!
}));
