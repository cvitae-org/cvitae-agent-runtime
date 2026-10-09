/**
 * A piece of the CV in a shorter form, for a message that would not otherwise fit.
 *
 * Over its budget a message is refused and nothing is cut to fit, because a piece
 * cut short would be sent under the name of the whole. This is the other thing a
 * person may ask for instead: the same piece with some of what it says left out,
 * and the page saying so in the piece itself, so the model is never given half of
 * a piece as though it were all of it. The record says it too: the entry names the
 * original and its digest, and its `shown` is the digest of this text.
 *
 * A pure function of the piece. The same piece gives the same bytes, and the form
 * is not stored anywhere, so it cannot be out of date: the digest of the original
 * on the entry is what a resumed run is checked against (`staleCv`). What it keeps
 * is what a person scanning the piece would keep, and no more than a model needs
 * to know the piece is there and what it is about:
 *
 *   an experience entry   its heading and dates, and the first two highlights
 *   an education entry    its heading, dates and mark
 *   a role description    its first sentences, up to 300 characters
 *   skills                its role and the first six of each group
 *
 * Personal details, certificates and languages are already as short as a piece
 * gets, and have no shorter form. Neither does a piece that has less than the
 * limits above: a form that is not shorter than the whole is not a form.
 *
 * Made from what the model would be shown of the piece (`view.shown`), never from
 * the original, so a part an exclusion has taken out of it is not here either.
 */

import { OVERVIEW } from './well.js';
import { lines, list, render, span, text } from './render.js';
import type { Row } from './render.js';

/** How many highlights of an experience entry its shorter form keeps. */
export const COMPACT_HIGHLIGHTS = 2;

/** How much of a role description its shorter form keeps, in characters. */
export const COMPACT_TEXT = 300;

/** How many skills of each group its shorter form keeps. */
export const COMPACT_SKILLS = 6;

const count = (amount: number, one: string): string => `${amount} ${one}${amount === 1 ? '' : 's'}`;

/** What the form leaves out, said in the piece. Plain words, as the headings are. */
const shortened = (left: readonly string[]): string => `(shortened: ${left.join(' and ')} not shown)`;

/**
 * The first part of a text, ending where a sentence does when one ends in the
 * second half of it, and at a word otherwise.
 */
const head = (body: string, limit: number): string => {
  const cut = body.slice(0, limit);
  const sentence = [...cut.matchAll(/[.!?](?=\s|$)/g)].at(-1);
  if (sentence?.index !== undefined && sentence.index + 1 > limit / 2) return cut.slice(0, sentence.index + 1);

  const word = /\s/.test(body.charAt(limit)) ? -1 : cut.search(/\s\S*$/);
  return (word > 0 ? cut.slice(0, word) : cut).trimEnd();
};

/**
 * The shorter form of a piece, or nothing when it has none shorter than the whole.
 * `section` is named as `render` names it: an overview item as `overview/<item>`,
 * an entry by its list section.
 */
export const renderCompact = (section: string, item: unknown): string | undefined => {
  const row = (typeof item === 'object' && item !== null ? item : {}) as Row;
  const form = ((): string | undefined => {
    switch (section) {
      case OVERVIEW + '/role_description': {
        const body = typeof item === 'string' ? item.trim() : '';
        return body.length <= COMPACT_TEXT
          ? undefined
          : `Role description:\n${head(body, COMPACT_TEXT)}\n${shortened(['the rest of it'])}`;
      }
      case OVERVIEW + '/skills': {
        const groups = (Array.isArray(row.groups) ? row.groups : []) as { label?: string; items?: string[] }[];
        const more = groups.reduce((total, group) => total + Math.max(0, list(group.items).length - COMPACT_SKILLS), 0);
        if (more === 0) return undefined;

        return `Skills:\n${lines(
          text(row.role) !== '' && `Role: ${text(row.role)}`,
          ...groups.map((group) => `${text(group.label) || 'Skills'}: ${list(group.items).slice(0, COMPACT_SKILLS).join(', ')}`),
          shortened([count(more, 'more skill')])
        )}`;
      }
      case 'experience': {
        const highlights = list(row.highlights);
        const skills = list(row.skills);
        const left = [
          ...(highlights.length > COMPACT_HIGHLIGHTS ? [count(highlights.length - COMPACT_HIGHLIGHTS, 'more highlight')] : []),
          ...(skills.length > 0 ? [`its ${count(skills.length, 'skill')}`] : [])
        ];
        if (left.length === 0) return undefined;

        const title = [text(row.title), text(row.company)].filter((part) => part !== '').join(' at ');
        const body = lines(
          span(text(row.started), row.finished as string | null | undefined),
          ...highlights.slice(0, COMPACT_HIGHLIGHTS).map((highlight) => `- ${highlight}`),
          shortened(left)
        );
        return `Experience, ${title || 'entry'}:\n${body}`.trimEnd();
      }
      case 'education': {
        if (text(row.thesis) === '') return undefined;

        const title = [text(row.degree), text(row.university)].filter((part) => part !== '').join(', ');
        const body = lines(
          span(text(row.started), row.finished as string | null | undefined),
          text(row.mark) !== '' && `Mark: ${text(row.mark)}`,
          shortened(['its thesis'])
        );
        return `Education, ${title || 'entry'}:\n${body}`.trimEnd();
      }
      default:
        return undefined;
    }
  })();

  return form !== undefined && form.length < render(section, item).length ? form : undefined;
};
