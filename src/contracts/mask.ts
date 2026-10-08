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
 * a school, whole, and only in the strict scope (`MaskScope`).
 */
export const maskSeedKinds = ['name', 'email', 'phone', 'link', 'org'] as const;
export type MaskSeedKind = (typeof maskSeedKinds)[number];

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
