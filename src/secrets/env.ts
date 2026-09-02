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
  /** Empty when the provider needs no credential — a local server. */
  readonly envVar: string;
  /** A key sent with the call. Wins over the environment; never stored. */
  readonly supplied?: string;
};

/**
 * A local server accepts any bearer token, so there is no secret to manage and
 * nothing to prompt anyone for. The literal is a placeholder the transport
 * requires, not a credential.
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
