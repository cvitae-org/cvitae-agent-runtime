/**
 * Naming a language, for capabilities that have to write in one.
 *
 * Any language tag the platform can name, not a fixed list. The previous
 * runtime had both a hard-coded `'en' | 'pl'` union in one capability and a
 * five-entry lookup table in another, whose documented behaviour was that an
 * unknown code passes through — so `--language zz` reached a prompt as "Write
 * in zz" and the model wrote something. `Intl` knows the names already and
 * needs no table to maintain.
 *
 * Measured on Node 20 and up: a known tag returns its English name
 * (`pl` → `Polish`, `pt-BR` → `Brazilian Portuguese`), a structurally valid but
 * unassigned tag returns the tag back unchanged (`zz` → `zz`), and a malformed
 * one throws `RangeError`. Both rejections are folded into one check below.
 *
 * It sits beside the capabilities rather than in `context/` because which
 * language to write in is the caller's request, not a rendering decision, and
 * two capabilities asking the same question of the platform should not be able
 * to disagree about the answer.
 */

import { z } from 'zod';

export const languageName = (locale: string): string | undefined => {
  try {
    const named = new Intl.DisplayNames(['en'], { type: 'language' }).of(locale);
    // `of` returning its own argument means the tag parsed but names no
    // language. Writing "in zz" would produce something, which is worse than
    // refusing.
    return named && named.toLowerCase() !== locale.toLowerCase() ? named : undefined;
  } catch {
    return undefined;
  }
};

export const localeSchema = z
  .string()
  .min(2)
  .refine((value) => languageName(value) !== undefined, {
    message: 'Not a language tag this platform can name, e.g. "en", "pl", "pt-BR".'
  });
