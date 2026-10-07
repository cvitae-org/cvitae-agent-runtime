/**
 * The gateway, with a person's own identifiers kept out of what it sends.
 *
 * A wrapper over `AiGateway` and nothing more: it is handed the real one, and
 * every call that carries text to a model goes through `mask.ts` on the way out
 * and back through it on the way in. Everything above the gateway — the steps,
 * the tools, the capabilities — is handed this object as `context.effects.ai` and
 * cannot tell the difference, which is the point of putting it here and not in
 * each of them. A call site that had to remember to mask is a call site that one
 * day does not.
 *
 * **When it applies** is a property of the call and not of the run: `hosted`
 * masks every call to a provider that is not on the machine, `always` masks every
 * call. A call to a local model under `hosted` is handed on untouched, request
 * and result, so what a person who never leaves their machine sees is what they
 * saw before this existed.
 *
 * **One vault per call.** Placeholders are numbered inside a call and mean
 * nothing outside it (`mask.ts`). A tool loop is one call however many tools the
 * model uses, so a placeholder it was given in the prompt is the one a tool
 * result carries.
 *
 * **What the model does is undone, and what the person's own code does is not
 * masked.** A tool is run by this process on this machine, so what the model asks
 * of it is restored first (the model said `[EMAIL_1]` and meant the address) and
 * what it returns is masked on the way back to the model. The trace of the tool
 * is written by the tool's own wrapper, below this one, and so it holds the real
 * values: masking is about what leaves, and what a person reads on their own
 * machine is theirs.
 *
 * **What it leaves, said once.** `embed` and `transcribeImage` are handed on as
 * they are. An image is pixels, and a vector is made of the text it stands for:
 * masking either would change what they are for, and the embedding provider is
 * the local one unless a person chose otherwise (`resolve.ts`). Both are named in
 * the protocol doc, and the plan has a step for the second of them.
 */

import { RuntimeError } from '../contracts/index.js';
import type {
  AiGateway,
  EmbedRequest,
  EmbedResult,
  ImageRequest,
  MaskMode,
  MaskSeed,
  ObjectRequest,
  ObjectResult,
  TextRequest,
  TextResult,
  ToolHandle,
  ToolLoopRequest,
  ToolLoopResult
} from '../contracts/index.js';
import { createVault, type Vault } from './mask.js';

export type MaskingOptions = {
  readonly mode: MaskMode;
  /**
   * What to keep from the model, asked at the start of each call that is masked.
   *
   * Asked then and not once, because the CV a run is about can be changed by the
   * run (an edit), and a value that was not on it when the run began is on it
   * when the model is next asked about it.
   */
  readonly seeds: () => readonly MaskSeed[];
  /**
   * Also keep from the model what has the shape of an identifier, whoever's it is
   * (`detect.ts`). Off, a call with no seeds goes as it is; on, no call is without
   * a vault.
   */
  readonly detect?: boolean;
};

/** Whether a call to this gateway is to be masked, from what it resolves to now. */
export const masks = (mode: MaskMode, gateway: Pick<AiGateway, 'describe'>): boolean =>
  mode === 'always' || gateway.describe().providerId !== 'local';

/**
 * A sink for restored fragments that cannot break the call, as the gateway's own.
 * Whoever is watching an answer being written is not who the call fails for.
 */
const quietly = (sink: ((text: string) => void) | undefined): ((text: string) => void) | undefined =>
  sink === undefined
    ? undefined
    : (text) => {
        try {
          sink(text);
        } catch {
          // As in `ai.ts`: a window that threw while drawing a token is not a
          // provider that failed.
        }
      };

/**
 * What a tool tells the model when it fails, with the person's values out of it.
 *
 * A message is built by code that was handed the model's own arguments — which are
 * restored values by now — so it can quote one. The code stays: a cancelled run
 * has to stay a cancelled run, and a missing key a missing key.
 */
const maskedFailure = (vault: Vault, error: unknown): Error => {
  if (error instanceof RuntimeError) return new RuntimeError(vault.mask(error.message), error.code);

  const message = error instanceof Error ? error.message : String(error);
  const failure = new Error(vault.mask(message));
  if (error instanceof Error) failure.name = error.name;
  return failure;
};

const maskedTool = (handle: ToolHandle, vault: Vault): ToolHandle => ({
  ...handle,
  invoke: async (input) => {
    const restored = vault.restoreDeep(input);

    try {
      return vault.maskDeep(await handle.invoke(restored));
    } catch (error) {
      throw maskedFailure(vault, error);
    }
  }
});

export const maskedGateway = (inner: AiGateway, options: MaskingOptions): AiGateway => {
  /** A vault for this call, or none when the call is to go as it is. */
  const begin = (): Vault | undefined => {
    if (!masks(options.mode, inner)) return undefined;

    const vault = createVault(options.seeds(), { detect: options.detect === true });
    return vault.empty ? undefined : vault;
  };

  return {
    describe: () => inner.describe(),

    async generateObject<T>(request: ObjectRequest<T>): Promise<ObjectResult<T>> {
      const vault = begin();
      if (vault === undefined) return inner.generateObject(request);

      vault.reserve(request.system, request.prompt);
      const result = await inner.generateObject({
        ...request,
        system: vault.mask(request.system),
        prompt: vault.mask(request.prompt)
      });

      return { ...result, object: vault.restoreDeep(result.object) };
    },

    async generateText(request: TextRequest): Promise<TextResult> {
      const vault = begin();
      if (vault === undefined) return inner.generateText(request);

      vault.reserve(request.system, request.prompt);
      const sink = quietly(request.onDelta);
      const restorer = sink === undefined ? undefined : vault.restorer(sink);
      const result = await inner.generateText({
        ...request,
        system: vault.mask(request.system),
        prompt: vault.mask(request.prompt),
        ...(restorer === undefined ? {} : { onDelta: (text: string) => restorer.push(text) })
      });

      restorer?.end();
      return { ...result, text: vault.restore(result.text) };
    },

    async runToolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
      const vault = begin();
      if (vault === undefined) return inner.runToolLoop(request);

      const history = request.history ?? [];
      vault.reserve(request.system, request.prompt, ...history.map((turn) => turn.text));

      const sink = quietly(request.onDelta);
      const restorer = sink === undefined ? undefined : vault.restorer(sink);
      const result = await inner.runToolLoop({
        ...request,
        system: vault.mask(request.system),
        prompt: vault.mask(request.prompt),
        ...(request.history === undefined
          ? {}
          : { history: history.map((turn) => ({ role: turn.role, text: vault.mask(turn.text) })) }),
        tools: request.tools.map((handle) => maskedTool(handle, vault)),
        ...(restorer === undefined ? {} : { onDelta: (text: string) => restorer.push(text) })
      });

      restorer?.end();
      return { ...result, text: vault.restore(result.text) };
    },

    // Neither is masked. See the note at the top.
    transcribeImage: (request: ImageRequest): Promise<TextResult> => inner.transcribeImage(request),
    embed: (request: EmbedRequest): Promise<EmbedResult> => inner.embed(request)
  };
};
