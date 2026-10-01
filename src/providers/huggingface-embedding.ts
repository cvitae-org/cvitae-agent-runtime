import { APICallError, type EmbeddingModel } from 'ai';
import { RuntimeError } from '../contracts/index.js';

/** HF's OpenAI-compatible router is chat-only; embeddings use the native task. */
export const createHuggingFaceEmbedding = (
  modelId: string,
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Exclude<EmbeddingModel<string>, string> => ({
  specificationVersion: 'v2',
  provider: 'huggingface',
  modelId,
  maxEmbeddingsPerCall: 32,
  supportsParallelCalls: true,
  async doEmbed({ values, abortSignal }) {
    abortSignal?.throwIfAborted();
    // Encode path components individually: model IDs legitimately contain '/'.
    const modelPath = modelId.split('/').map(encodeURIComponent).join('/');
    const url = `https://router.huggingface.co/hf-inference/models/${modelPath}/pipeline/feature-extraction`;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: values }),
      ...(abortSignal ? { signal: abortSignal } : {})
    });
    if (!response.ok) {
      // Never attach the credential, request text, or provider's response body.
      throw new APICallError({
        message: `Hugging Face embeddings returned HTTP ${response.status}.`,
        url, requestBodyValues: undefined, statusCode: response.status
      });
    }
    let body: unknown;
    try { body = await response.json(); }
    catch {
      abortSignal?.throwIfAborted();
      throw new RuntimeError('Hugging Face returned invalid embedding data.', 'invalid_model_output');
    }
    abortSignal?.throwIfAborted();
    const embeddings = values.length === 1 && Array.isArray(body) && typeof body[0] === 'number'
      ? [body] : body;
    if (!Array.isArray(embeddings) || embeddings.length !== values.length
      || !embeddings.every((vector): vector is number[] => Array.isArray(vector)
        && vector.length > 0 && vector.every(value => typeof value === 'number' && Number.isFinite(value)))
      || !embeddings.every(vector => vector.length === embeddings[0]?.length)) {
      throw new RuntimeError('Hugging Face returned invalid embedding data.', 'invalid_model_output');
    }
    return { embeddings };
  }
});
