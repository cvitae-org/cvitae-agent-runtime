/**
 * What the HTTP boundary permits, and why it depends on where it is listening.
 *
 * The runtime was built for one deployment: a loopback listener with no
 * authentication, holding the provider keys and the user's CV on the machine
 * that runs it. Every "this is safe" argument in this project rests on that —
 * a caller who can post to the socket can already read `cv.json` and spend the
 * server's credential, so nothing the request asks for is a new grant.
 *
 * None of that survives being reachable from the internet, and the honest
 * response is not to weaken the arguments but to serve a smaller thing. Hosted
 * mode is that smaller thing: a stateless proxy to the model providers,
 * spending only the key the caller sent, over the four capabilities that never
 * touch storage.
 *
 * `RUNTIME_MODE` selects it and defaults to `local`, so an existing setup sees
 * no change from this file existing. The refusals below are all boundary
 * checks: they run before the capability does, and they exist so that the
 * fallbacks underneath them — `credentialFor` reading the environment,
 * `readSources` opening a path, `assertLoopbackUrl` accepting localhost — are
 * never reached rather than being trusted to be harmless.
 *
 * Each refusal carries a `reason` and a message written for the person who will
 * read it in cvitae's UI. That is the whole point of doing this here: a hosted
 * deployment with no key configured would otherwise answer "Missing
 * OPENROUTER_API_KEY", naming an environment variable of a process the user has
 * no access to and no reason to know exists.
 */

/** `local` is the deployment this project was designed for, and the default. */
export type RuntimeMode = 'local' | 'hosted';

/**
 * A boundary refusal: the status to answer with, and the two fields every
 * error in this service carries.
 */
export type Refusal = {
  status: number;
  error: string;
  reason: string;
};

export const runtimeMode = (): RuntimeMode =>
  process.env.RUNTIME_MODE?.trim() === 'hosted' ? 'hosted' : 'local';

export const isHosted = (): boolean => runtimeMode() === 'hosted';

/**
 * The capabilities a hosted deployment serves.
 *
 * Exactly the ones that read and write nothing: `extract_cv` (which cvitae
 * always calls with `persist: false`), `translate_cv`, `analyze_offer` and
 * `verify_recipient`. The two that are missing — `ask_profile` and
 * `draft_application` — need the chunk index, which needs an embedding model
 * and a LanceDB directory, neither of which exists on a serverless host.
 *
 * They are refused rather than left to fail on their own. A tool loop with an
 * empty index does not error; it answers from nothing and says the CV appears
 * to be blank, which is a wrong answer dressed as a real one.
 */
export const HOSTED_CAPABILITIES: ReadonlySet<string> = new Set([
  'extract_cv',
  'translate_cv',
  'analyze_offer',
  'verify_recipient'
]);

/**
 * The capabilities this deployment will actually run.
 *
 * `/health` exists to answer "what will you do if I ask", and a list that names
 * `ask_profile` on a runtime that answers 501 for it is worse than no list —
 * it is a list that has to be tested against to be believed.
 */
export const servedCapabilities = <T extends { name: string }>(
  all: readonly T[]
): T[] => (isHosted() ? all.filter((one) => HOSTED_CAPABILITIES.has(one.name)) : [...all]);

/**
 * The tools this deployment will actually offer a model.
 *
 * All three read the store, and the only capability that calls them is
 * `ask_profile`, which hosted mode does not serve. So the honest hosted answer
 * is none, rather than three tools that would each report an empty index.
 */
export const servedTools = <T>(all: readonly T[]): T[] => (isHosted() ? [] : [...all]);

/**
 * The source kinds a hosted deployment accepts.
 *
 * `file` is absent, and this is the one refusal that would be a security bug to
 * omit: `kind: 'file'` carries an absolute path that reaches `readFile`, and
 * the text it yields is returned to the caller. On a laptop that is the user
 * reading their own disk. On a shared host it is a stranger reading the
 * server's, and cvitae already filters the kind out on its own side for the
 * same reason.
 */
const HOSTED_SOURCE_KINDS: ReadonlySet<string> = new Set(['text', 'upload']);

/**
 * The envelope ceiling, under Netlify's 6MB buffered request limit.
 *
 * The platform's own refusal is a bare 502 with no body, which tells a user who
 * attached a large PDF nothing at all. Checking first costs one header read and
 * buys a message that names the real number and the real remedy. `upload`
 * sources are base64, so this is roughly 4MB of actual file.
 */
const MAX_HOSTED_BODY_BYTES = 5_500_000;

/**
 * How many inputs one hosted batch may carry.
 *
 * A synchronous function on Netlify is killed at 60s whatever it is doing, so a
 * twenty-offer batch cannot finish there. The stream makes that survivable
 * rather than catastrophic — the caller has already persisted every result that
 * landed — but a ceiling is still worth having, because a batch that is killed
 * at 60s every time is a feature that never appears to work.
 */
const MAX_HOSTED_BATCH_INPUTS = 8;

/**
 * The optional shared secret.
 *
 * Unset by default, and the reason it can be is that hosted mode spends no
 * credential of its own: whoever finds the URL can use the compute, not the
 * money. That is a deliberate trade — an open BYOK proxy is a much smaller
 * liability than an open wallet — but it leaves function minutes exposed, and
 * this is the lever for when that stops being theoretical.
 */
const configuredToken = (): string | undefined =>
  process.env.RUNTIME_TOKEN?.trim() || undefined;

/**
 * Checks the bearer token, when one is configured.
 *
 * Length-independent comparison is not attempted. The token is compared once
 * per request against a value that is either present and correct or absent
 * entirely; a timing oracle over an equality check on a random secret is not
 * the way this endpoint gets abused, and pretending otherwise would be
 * security theatre in a file whose whole job is to be honest about what it
 * protects.
 */
export const refuseToken = (authorization?: string): Refusal | undefined => {
  const expected = configuredToken();

  if (!expected) return undefined;

  const supplied = authorization?.replace(/^Bearer\s+/i, '').trim();

  if (supplied === expected) return undefined;

  return {
    status: 401,
    error: 'This runtime requires a token. Set RUNTIME_TOKEN on the caller to match the one it is configured with.',
    reason: 'unauthorized'
  };
};

/** Refuses a capability this deployment does not serve. */
export const refuseCapability = (name: string): Refusal | undefined => {
  if (!isHosted() || HOSTED_CAPABILITIES.has(name)) return undefined;

  return {
    // 501 rather than 404: the capability exists and is named in the code the
    // caller is written against. It is this deployment that cannot run it.
    status: 501,
    error: `"${name}" needs the CV index and the local store, which a hosted runtime does not have. Run cvitae-agent-runtime on your own machine for it. Available here: ${[...HOSTED_CAPABILITIES].join(', ')}.`,
    reason: 'capability_unavailable'
  };
};

/**
 * The credential rules, which are the whole reason a hosted deployment is
 * defensible.
 *
 * Three refusals, and they are different failures.
 *
 * A missing key means the environment would answer instead. On a laptop that is
 * correct and is how the project has always worked; here it would mean a
 * stranger spending the operator's quota, so hosted mode has no provider key
 * set at all and refuses before `credentialFor` can look for one. Checking here
 * rather than relying on the empty environment is what makes that a policy
 * rather than a deployment detail somebody can undo by pasting a key into the
 * Netlify UI.
 *
 * A `local` provider means the user has Ollama running and has selected it in
 * Settings. `assertLoopbackUrl` would accept `http://localhost:11434/v1`
 * happily — and then the hosted process would dial its own loopback, find
 * nothing, and report a connection error from a machine the user has never
 * heard of. The two localhosts are not the same computer, and saying so is the
 * only useful thing this check can do.
 *
 * A key without a provider is the third, and it is the one that could leak
 * rather than merely fail. See the comment on that branch.
 */
export const refuseModel = (
  model: { providerId?: string; apiKey?: string } | undefined
): Refusal | undefined => {
  if (!isHosted()) return undefined;

  if (model?.providerId === 'local') {
    return {
      status: 400,
      error:
        'A local model runs on your own machine, and this runtime is not on it — its "localhost" is the server\'s, not yours. Choose a hosted provider in Settings, or run cvitae-agent-runtime locally to keep using the local one.',
      reason: 'local_provider_unreachable'
    };
  }

  if (!model?.apiKey?.trim()) {
    return {
      status: 400,
      error:
        'This runtime holds no API key of its own and spends only the one you send. Add a key for your provider in Settings, or run cvitae-agent-runtime locally with a key in its environment.',
      reason: 'missing_client_key'
    };
  }

  // A key belongs to exactly one account at one company, and `resolveModel`
  // would otherwise fall back to `AI_PROVIDER` or to the built-in default — so
  // an OpenRouter key arriving without a provider named could be posted to
  // OpenAI. That is not a failed request; it is handing a live secret to a
  // third party. cvitae states the provider on every call; anything that does
  // not is refused rather than guessed for.
  if (!model.providerId?.trim()) {
    return {
      status: 400,
      error:
        'A key must arrive with the provider it belongs to. Send "model.providerId" alongside "model.apiKey" so the key can only ever reach the company it was issued by.',
      reason: 'missing_provider'
    };
  }

  return undefined;
};

/**
 * Refuses source kinds this deployment will not read.
 *
 * Reaches into the input rather than being enforced by the capability's own
 * schema, because the schema is shared with the in-process library where
 * `kind: 'file'` is legitimate and useful. The restriction belongs to the
 * transport, not to extraction.
 */
export const refuseSources = (input: unknown): Refusal | undefined => {
  if (!isHosted()) return undefined;

  const sources = (input as { sources?: unknown } | null)?.sources;

  if (!Array.isArray(sources)) return undefined;

  const rejected = sources.find((source) => {
    const kind = (source as { kind?: unknown } | null)?.kind;
    return typeof kind === 'string' && !HOSTED_SOURCE_KINDS.has(kind);
  });

  if (!rejected) return undefined;

  return {
    status: 400,
    error: `A hosted runtime reads only "text" and "upload" sources — it has no access to your filesystem. Attach the file's bytes as an "upload" instead.`,
    reason: 'invalid_input'
  };
};

/** Refuses a body over the platform's buffering limit, with the real number. */
export const refuseEnvelopeSize = (
  contentLength: string | number | undefined
): Refusal | undefined => {
  if (!isHosted() || contentLength === undefined) return undefined;

  const bytes = Number(contentLength);

  if (!Number.isFinite(bytes) || bytes <= MAX_HOSTED_BODY_BYTES) return undefined;

  return {
    status: 413,
    error: `That request is ${Math.round(bytes / 1024 / 1024)}MB; a hosted runtime accepts about 4MB of attachments per import. Import fewer files at once, or run cvitae-agent-runtime locally, which takes 12MB per file.`,
    reason: 'invalid_input'
  };
};

/** Refuses a batch too large to have a chance of finishing inside 60s. */
export const refuseBatchSize = (count: number): Refusal | undefined => {
  if (!isHosted() || count <= MAX_HOSTED_BATCH_INPUTS) return undefined;

  return {
    status: 400,
    error: `A hosted runtime is stopped by its platform after 60 seconds, so it takes at most ${MAX_HOSTED_BATCH_INPUTS} inputs per batch. Send them in smaller batches, or run cvitae-agent-runtime locally, which has no such ceiling.`,
    reason: 'invalid_input'
  };
};

/**
 * Warns when a hosted deployment has been given a credential.
 *
 * Not a refusal — a key in the environment is only reachable by a request that
 * omits its own, and `refuseModel` has already rejected those, so this cannot
 * be spent. It is still worth one line at startup, because a key sitting in a
 * public deployment's environment is a key that will eventually be spent by the
 * next person who relaxes one of these checks.
 */
export const credentialWarning = (): string | undefined => {
  if (!isHosted()) return undefined;

  const present = ['OPENROUTER_API_KEY', 'HF_TOKEN', 'OPENAI_API_KEY'].filter(
    (name) => process.env[name]?.trim()
  );

  if (present.length === 0) return undefined;

  return `RUNTIME_MODE is "hosted" but ${present.join(' and ')} ${present.length === 1 ? 'is' : 'are'} set. Nothing can spend ${present.length === 1 ? 'it' : 'them'} — every hosted run must bring its own key — but a hosted deployment should hold no credential at all. Remove ${present.length === 1 ? 'it' : 'them'} from the environment.`;
};
