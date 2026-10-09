/**
 * What masking is told, and what a person may choose about it.
 *
 * Masking replaces a person's own identifiers with placeholders before a prompt
 * leaves for a hosted model and puts them back into what comes home. It is not
 * anonymisation and nothing here says it is: a city and a run of dates still
 * describe a person, an employer and a school do unless the person chose the
 * strict scope, and a processor that receives masked text still receives
 * personal data. The interface says "mask".
 *
 * The words are fixed here because three places have to agree on them: the
 * engine that matches, the setting a person edits, and the host that draws it.
 */

/**
 * What a value is, which is what its placeholder is called (`[EMAIL_1]`).
 *
 * `name` covers a full name and each part of it, so that "Anna" alone in a
 * message is masked as well as "Anna Kowalska" in a CV. `org` is an employer or
 * a school, whole, and only in the strict scope (`MaskScope`). `term` is a word
 * or a phrase the person asked to have kept (`MaskTerms`), whole, in every scope.
 */
export const maskSeedKinds = ['name', 'email', 'phone', 'link', 'org', 'term'] as const;
export type MaskSeedKind = (typeof maskSeedKinds)[number];

/**
 * What a placeholder can stand for: what a person said (`MaskSeedKind`), and two
 * kinds found only by their shape (`effects/detect.ts`), `id` (a PESEL, a NIP, an
 * IBAN, an account number) and `dob` (a date of birth).
 */
export const maskKinds = [...maskSeedKinds, 'id', 'dob'] as const;
export type MaskKind = (typeof maskKinds)[number];

/**
 * How many placeholders of each kind a model was sent: counts, and never what
 * they stood for. A kind with none is left out, so `{}` is a call that was masked
 * and held nothing to keep.
 *
 * A placeholder is one spelling of one value in one call (`effects/mask.ts`), so
 * `Anna Kowalska` and `ANNA KOWALSKA` in one call are two, and a name sent in two
 * calls is counted in each.
 */
export type MaskCounts = Readonly<Partial<Record<MaskKind, number>>>;

/** The two counts as one, kind by kind. */
export const addMaskCounts = (a: MaskCounts, b: MaskCounts): MaskCounts => {
  const sum: Partial<Record<MaskKind, number>> = { ...a };
  for (const kind of maskKinds) {
    const more = b[kind];
    if (more !== undefined) sum[kind] = (sum[kind] ?? 0) + more;
  }
  return sum;
};

/**
 * What masking did in some model calls, as the record of a run keeps it.
 *
 * `masked` is how many calls went through masking, `unmasked` how many were sent
 * as they were: a call to a model on this machine when only hosted calls are
 * masked, a call with nothing at all to keep, and every image, which is never
 * masked. `placeholders` is summed over the masked calls.
 */
export type MaskTally = {
  readonly masked: number;
  readonly unmasked: number;
  readonly placeholders: MaskCounts;
};

/** One value to keep from a hosted model: as the person's CV states it. */
export type MaskSeed = {
  readonly kind: MaskSeedKind;
  readonly value: string;
};

/**
 * When a call is masked.
 *
 * `hosted` masks a call that leaves this machine and leaves one to a local
 * server as it always was. `always` masks every call, for a person who wants the
 * local path to behave as the hosted one will. There is no third value: a model
 * call that a capability, a setting or a flag could exempt is a model call that
 * is not covered, and the guarantee is that it is.
 */
export const maskModes = ['hosted', 'always'] as const;
export type MaskMode = (typeof maskModes)[number];

/** What a runtime that has not been told otherwise does. */
export const defaultMaskMode: MaskMode = 'hosted';

export const isMaskMode = (value: unknown): value is MaskMode =>
  typeof value === 'string' && (maskModes as readonly string[]).includes(value);

/**
 * The mode a stored value stands for.
 *
 * Nothing stored is the default. A value this release does not know — written by
 * a later one, or by hand — is `always`, because the error that costs nothing is
 * masking more than was asked, and reading it as `hosted` would unmask a call a
 * person had asked to have masked.
 */
export const maskModeOf = (stored: string | undefined): MaskMode =>
  stored === undefined ? defaultMaskMode : isMaskMode(stored) ? stored : 'always';

/**
 * What is masked, as far as a person's own values go.
 *
 * `personal` is what identifies the person to anyone who reads a message: the
 * name, the email, the phone and the links the CV states. `strict` adds the
 * employers and the schools it names, which describe a person without
 * identifying them to most readers and are hidden from a model that does not
 * need them. A scope is chosen apart from the mode: the mode says which calls
 * are masked, the scope says which values are.
 */
export const maskScopes = ['personal', 'strict'] as const;
export type MaskScope = (typeof maskScopes)[number];

/** What a runtime that has not been told otherwise does. */
export const defaultMaskScope: MaskScope = 'personal';

export const isMaskScope = (value: unknown): value is MaskScope =>
  typeof value === 'string' && (maskScopes as readonly string[]).includes(value);

/**
 * The scope a stored value stands for.
 *
 * As for the mode: nothing stored is the default, and a value this release does
 * not know is `strict`, because masking more than was asked costs nothing a
 * person can see and masking less is the error that cannot be taken back.
 */
export const maskScopeOf = (stored: string | undefined): MaskScope =>
  stored === undefined ? defaultMaskScope : isMaskScope(stored) ? stored : 'strict';

/**
 * How many terms a person may have kept, and how long one may be, in characters
 * once the white space around it is taken off.
 *
 * The length is the engine's for every seed (`MIN_SEED_LENGTH`, `MAX_SEED_LENGTH`
 * in `effects/mask.ts`), so a term the runtime takes is one it masks: a shorter
 * one would be accepted and kept from nothing.
 */
export const maskTermLimits = { count: 100, shortest: 3, longest: 300 } as const;

/**
 * What a person has asked to have kept from a model besides what their CV states:
 * a client, a project, a nickname, a place. Studio keeps the list and sends it
 * when it connects and whenever it changes; the runtime holds it in memory and
 * never writes it down.
 */
export type MaskTerms = {
  /** The terms in force, in the order they were given, one of each. */
  read(): readonly string[];
  /**
   * Replaces the list. Each term is taken without the white space around it, and
   * a term that folds to one already given is given once. Throws `invalid_input`
   * for a term outside `maskTermLimits` or a list longer than it, and keeps what
   * was there.
   */
  set(terms: readonly string[]): readonly string[];
  /**
   * Whether a list has been given since the runtime started, an empty one
   * included. Until then a background call that would be masked is not made
   * (`index-recovery.ts`): the runtime cannot know what it would have to keep.
   */
  declared(): boolean;
};
