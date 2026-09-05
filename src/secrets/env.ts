/**
 * Where a credential is read, and the only place it is read.
 *
 * Every API key in this process comes through `credentialFor`. That is worth a
 * dedicated module for one reason: a key read in five places is a key that
 * leaks from whichever of the five forgot. Here there is one function to audit,
 * and a test asserts no file outside this directory names an API-key variable.
 *
 * The keys stay in this process and go nowhere else. Nothing above `effects/`
 * ever sees one — a step is handed a gateway, not a client, and the gateway is
 * handed a resolver, not a secret.
 *
 * **A supplied key wins over the environment.** That ordering exists for the
 * caller who holds a credential this machine's environment does not, and it is
 * not a new grant: anything that can reach this process can already spend
 * whatever key the environment holds, so arriving with your own is strictly
 * less privileged. The key travels only to the provider named in the same
 * request, whose endpoint is fixed in `providers/resolve.ts` and, for a local
 * server, put through the loopback guard. There is nowhere else for it to go —
 * and it is never cached, so it cannot outlive the call that carried it.
 */

import { RuntimeError } from '../contracts/index.js';

export type Env = Readonly<Partial<Record<string, string>>>;

export type CredentialRequest = {
  readonly providerId: string;
  /** For the message a person reads when it is missing. */
  readonly label: string;
  /** Empty when the provider has no credential at all to read. */
  readonly envVar: string;
  /** A key sent with the call. Wins over the environment; never stored. */
  readonly supplied?: string;
  /**
   * Whether the call works without one. An optional credential that is not set
   * falls back to [NO_CREDENTIAL] instead of refusing, which is what lets a
   * local server be configured with a key on the machines that want one and
   * left alone on the machines that do not.
   */
  readonly optional?: boolean;
};

/**
 * What is sent when a provider wants no key. The literal is a placeholder the
 * transport requires — every OpenAI-compatible client insists on an
 * `Authorization` header — and not a credential.
 *
 * It used to be documented as "a local server accepts any bearer token". Most
 * do; oMLX does not, and answers `401 API key required` to this exact string.
 * That is why a local server's credential is now *optional* rather than absent:
 * this is the fallback when nobody has set one, not a claim that none is
 * wanted.
 */
export const NO_CREDENTIAL = 'local';

export const credentialFor = (
  request: CredentialRequest,
  env: Env = process.env
): string => {
  const supplied = request.supplied?.trim();
  if (supplied) return supplied;

  if (request.envVar === '') return NO_CREDENTIAL;

  const key = env[request.envVar]?.trim();

  if (!key) {
    if (request.optional === true) return NO_CREDENTIAL;

    throw new RuntimeError(
      `Missing ${request.envVar}, which ${request.label} needs. `
        + 'Set it in the environment, or send a key with the request.',
      'misconfigured'
    );
  }

  return key;
};

/** Whether a credential is available, without reading its value. */
export const hasCredential = (envVar: string, env: Env = process.env): boolean =>
  envVar === '' || Boolean(env[envVar]?.trim());
