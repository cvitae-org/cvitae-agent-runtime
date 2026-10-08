/**
 * What a person handed in, sent to a model only where they agreed it may go.
 *
 * A CV import sends what it was given as it is: the text of a document, a
 * screenshot. Masking cannot help there, because reading the person's details is
 * what the call is for, so the person is asked instead (`Capability.consented`).
 * A run that sends such sources is held to a provider on this machine, or to the
 * one hosted provider the person agreed to, and any other call is refused before
 * it goes, with `egress_consent_required`.
 *
 * **At every call, and not once.** The provider is read from the settings at each
 * call, so a person who changes it in the middle of an import has agreed to the
 * old one and not to the new one. The run asks first as well (`runtime/needs.ts`),
 * so that a run that would be refused is refused before it reads anything, with
 * its own code, rather than as an import that found nothing. Nothing is awaited
 * between the check and the call it guards, and the gateway below reads its
 * provider as a call begins and sends the call there even if it then waits for a
 * slot (`effects/ai.ts`), so a setting cannot change between the provider asked
 * about and the provider called.
 *
 * **One provider, and not a model.** A person agrees to a company reading their
 * CV; which of its models reads it is not a new question for them.
 *
 * **What it leaves, said once.** `embed` is not held to it. A CV's index is
 * embedded after every save, an import's included, and its text is masked for a
 * hosted embedder whatever the run is. `describe` and `describeEmbedding` say
 * where a call would go and send nothing.
 */

import { RuntimeError } from '../contracts/index.js';
import type {
  AiGateway,
  EmbedRequest,
  EmbedResult,
  ImageRequest,
  ObjectRequest,
  ObjectResult,
  TextRequest,
  TextResult,
  ToolLoopRequest,
  ToolLoopResult
} from '../contracts/index.js';

/**
 * Why a call to `providerId` may not carry what a person handed in, or nothing
 * when it may: a provider on this machine always may, and a hosted one only when
 * it is the one agreed to.
 */
export const consentRefusal = (providerId: string, consented: string | undefined): RuntimeError | undefined =>
  providerId === 'local' || providerId === consented
    ? undefined
    : new RuntimeError(
        `This would send what was handed in, as it is, to the hosted provider "${providerId}", `
          + 'which has not been agreed to. Agree to it for this import, or choose a model on this machine.',
        'egress_consent_required'
      );

/** The gateway, with every call that would send a person's sources where they did not agree refused. */
export const consentedGateway = (inner: AiGateway, consented: string | undefined): AiGateway => {
  const check = (): void => {
    const refusal = consentRefusal(inner.describe().providerId, consented);
    if (refusal !== undefined) throw refusal;
  };

  return {
    describe: () => inner.describe(),
    ...(inner.describeEmbedding === undefined ? {} : { describeEmbedding: () => inner.describeEmbedding!() }),

    // Async, so a refusal is a rejected call, as a failed call is.
    async generateObject<T>(request: ObjectRequest<T>): Promise<ObjectResult<T>> {
      check();
      return inner.generateObject(request);
    },

    async generateText(request: TextRequest): Promise<TextResult> {
      check();
      return inner.generateText(request);
    },

    async transcribeImage(request: ImageRequest): Promise<TextResult> {
      check();
      return inner.transcribeImage(request);
    },

    async runToolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
      check();
      return inner.runToolLoop(request);
    },

    // Not held to it. See the note at the top.
    embed: (request: EmbedRequest): Promise<EmbedResult> => inner.embed(request)
  };
};
