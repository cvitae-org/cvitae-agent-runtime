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
 * **`embed` is masked like the rest, by its own provider.** The texts it is given
 * go through the vault and the vectors that come back are numbers, so there is
 * nothing to put right. Whether it is masked is decided by the provider the
 * embedding resolves to and not by the one that writes the answers
 * (`describeEmbedding`): a person can chat with a hosted model and embed on their
 * own machine, and the other way round, and the second is the case that leaks if
 * the two are taken for one. A text with nothing to keep in it is sent as it was,
 * so the vector is the one it always was.
 *
 * **What it leaves, said once.** `transcribeImage` is handed on as it is: an image
 * is pixels, and masking it would change what it is for. It is named in the
 * protocol doc, and the plan has a step for it.
 *
 * **What it did, in numbers.** Each call is counted before it goes, as masked or
 * as sent as it was, with the placeholders it holds (`tally`), and what a tool
 * adds is counted before the model is handed it: a call that cannot be counted is
 * not made. The call's own log line asks the same count when it is written
 * (`MaskedCall`). Counts only: what a placeholder stood for is the vault's, and
 * goes with it.
 */

import { RuntimeError } from '../contracts/index.js';
import type {
  AiGateway,
  EmbedRequest,
  EmbedResult,
  ImageRequest,
  MaskCounts,
  MaskedCall,
  MaskMode,
  MaskSeed,
  MaskTally,
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
  /**
   * A function is asked at each call, for a gateway that outlives a run: the
   * setting can be changed while it is held.
   */
  readonly mode: MaskMode | (() => MaskMode);
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
  /**
   * Told of each call before it goes, and of what a tool adds to one before the
   * model is handed it: counts to add to what was told before. A run gives its
   * record (`RecordSink.masking`); absent, nothing is told.
   */
  readonly tally?: (add: MaskTally) => void;
};

/** Whether a call to this gateway is to be masked, from what it resolves to now. */
export const masks = (mode: MaskMode, gateway: Pick<AiGateway, 'describe'>): boolean =>
  mode === 'always' || gateway.describe().providerId !== 'local';

/**
 * Whether an embedding is to be masked: asked of the provider that embeds, which
 * is the one that generates only when the gateway does not say otherwise.
 */
export const masksEmbedding = (
  mode: MaskMode,
  gateway: Pick<AiGateway, 'describe' | 'describeEmbedding'>
): boolean => mode === 'always' || (gateway.describeEmbedding?.() ?? gateway.describe()).providerId !== 'local';

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

/** What `now` has that `before` had not, kind by kind. */
const added = (now: MaskCounts, before: MaskCounts): MaskCounts =>
  Object.fromEntries(
    Object.entries(now).flatMap(([kind, count]) => {
      const more = count - (before[kind as keyof MaskCounts] ?? 0);
      return more > 0 ? [[kind, more]] : [];
    })
  );

/** What a tool hands the model is told of before it is handed: `more` is that. */
const maskedTool = (handle: ToolHandle, vault: Vault, more: () => void): ToolHandle => ({
  ...handle,
  invoke: async (input) => {
    const restored = vault.restoreDeep(input);

    let result: unknown;
    try {
      result = vault.maskDeep(await handle.invoke(restored));
    } catch (error) {
      const failure = maskedFailure(vault, error);
      more();
      throw failure;
    }
    more();
    return result;
  }
});

export const maskedGateway = (inner: AiGateway, options: MaskingOptions): AiGateway => {
  const tally = options.tally;

  /** A vault for this call, or none when the call is to go as it is. */
  const begin = (embedding = false): Vault | undefined => {
    const mode = typeof options.mode === 'function' ? options.mode() : options.mode;
    if (!(embedding ? masksEmbedding(mode, inner) : masks(mode, inner))) return undefined;

    const vault = createVault(options.seeds(), { detect: options.detect === true });
    return vault.empty ? undefined : vault;
  };

  /**
   * A call that goes as it came, counted. Handed on as the very same request
   * unless it says it was masked, which only this gateway may say.
   */
  const asIs = <R extends MaskedCall>(request: R): R => {
    tally?.({ masked: 0, unmasked: 1, placeholders: {} });
    return request.masked === undefined ? request : { ...request, masked: undefined };
  };

  /**
   * A masked call, counted with what it holds once its texts are masked and before
   * it goes, with a way for its log line to ask what it has sent by then. `more`
   * counts what its tools have added since.
   */
  const going = (vault: Vault): { readonly masked: () => MaskCounts; readonly more: () => void } => {
    let told = vault.placeholders();
    tally?.({ masked: 1, unmasked: 0, placeholders: told });

    return {
      masked: () => vault.placeholders(),
      more: () => {
        const now = vault.placeholders();
        const fresh = added(now, told);
        told = now;
        if (Object.keys(fresh).length > 0) tally?.({ masked: 0, unmasked: 0, placeholders: fresh });
      }
    };
  };

  return {
    describe: () => inner.describe(),
    describeEmbedding: () => inner.describeEmbedding?.() ?? inner.describe(),

    async generateObject<T>(request: ObjectRequest<T>): Promise<ObjectResult<T>> {
      const vault = begin();
      if (vault === undefined) return inner.generateObject(asIs(request));

      vault.reserve(request.system, request.prompt);
      const system = vault.mask(request.system);
      const prompt = vault.mask(request.prompt);
      const result = await inner.generateObject({ ...request, system, prompt, masked: going(vault).masked });

      return { ...result, object: vault.restoreDeep(result.object) };
    },

    async generateText(request: TextRequest): Promise<TextResult> {
      const vault = begin();
      if (vault === undefined) return inner.generateText(asIs(request));

      vault.reserve(request.system, request.prompt);
      const sink = quietly(request.onDelta);
      const restorer = sink === undefined ? undefined : vault.restorer(sink);
      const system = vault.mask(request.system);
      const prompt = vault.mask(request.prompt);
      const result = await inner.generateText({
        ...request,
        system,
        prompt,
        masked: going(vault).masked,
        ...(restorer === undefined ? {} : { onDelta: (text: string) => restorer.push(text) })
      });

      restorer?.end();
      return { ...result, text: vault.restore(result.text) };
    },

    async runToolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
      const vault = begin();
      if (vault === undefined) return inner.runToolLoop(asIs(request));

      const history = request.history ?? [];
      vault.reserve(request.system, request.prompt, ...history.map((turn) => turn.text));

      const sink = quietly(request.onDelta);
      const restorer = sink === undefined ? undefined : vault.restorer(sink);
      const system = vault.mask(request.system);
      const prompt = vault.mask(request.prompt);
      const turns = history.map((turn) => ({ role: turn.role, text: vault.mask(turn.text) }));
      const count = going(vault);
      const result = await inner.runToolLoop({
        ...request,
        system,
        prompt,
        ...(request.history === undefined ? {} : { history: turns }),
        tools: request.tools.map((handle) => maskedTool(handle, vault, count.more)),
        masked: count.masked,
        ...(restorer === undefined ? {} : { onDelta: (text: string) => restorer.push(text) })
      });

      restorer?.end();
      return { ...result, text: vault.restore(result.text) };
    },

    async embed(request: EmbedRequest): Promise<EmbedResult> {
      const vault = begin(true);
      if (vault === undefined) return inner.embed(asIs(request));

      // One vault for the whole batch, so a value is the same placeholder in every
      // text it is in, as the chunks of one document would be.
      const values = request.values.map((value) => vault.mask(value));
      return inner.embed({ ...request, values, masked: going(vault).masked });
    },

    // Not masked. See the note at the top. Counted, as a call that went as it was.
    // Async, so a count that fails is a call that fails, as for the others.
    transcribeImage: async (request: ImageRequest): Promise<TextResult> => {
      tally?.({ masked: 0, unmasked: 1, placeholders: {} });
      return inner.transcribeImage(request);
    }
  };
};
