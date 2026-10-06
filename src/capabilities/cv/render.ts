/**
 * A piece of the CV as a model reads it.
 *
 * Plain lines and no markup, as the rest of what a prompt carries is
 * (`context/render.ts`), and in English whatever language the CV is in: the
 * heading is the runtime's, the body is the person's. Both the whole form here
 * and the shortened one (`compact.ts`) are made from the same few helpers, so a
 * piece reads the same way whichever form it is in.
 */

import { OVERVIEW } from './well.js';

export const lines = (...parts: (string | false | undefined)[]): string =>
  parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '').join('\n');

/**
 * When something started and ended, as the document says it. `null` is ongoing,
 * and an empty end is one nobody wrote down, such as a certificate that does not
 * expire, which is the start alone and not a question mark.
 */
export const span = (started: string, finished: string | null | undefined): string => {
  if (finished === null) return `${started === '' ? '?' : started} - present`;
  if (finished === undefined || finished === '') return started;
  return `${started === '' ? '?' : started} - ${finished}`;
};

export type Row = Record<string, unknown>;

export const text = (value: unknown): string => (typeof value === 'string' ? value : '');
export const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];

/**
 * One leaf as the model reads it: a heading, then what the piece says.
 *
 * Empty when the piece says nothing, so a CV with no role description has no
 * block for it and the record has no entry.
 */
export const render = (section: string, item: unknown): string => {
  const row = (typeof item === 'object' && item !== null ? item : {}) as Row;

  switch (section) {
    case OVERVIEW + '/personal': {
      const links = Object.entries((row.links ?? {}) as Record<string, string>).map(([name, url]) => `${name}: ${url}`);
      const body = lines(text(row.name), text(row.email), text(row.phone), text(row.location), ...links);
      return body === '' ? '' : `Personal details:\n${body}`;
    }
    case OVERVIEW + '/role_description': {
      const body = typeof item === 'string' ? item.trim() : '';
      return body === '' ? '' : `Role description:\n${body}`;
    }
    case OVERVIEW + '/skills': {
      const groups = (Array.isArray(row.groups) ? row.groups : []) as { label?: string; items?: string[] }[];
      const body = lines(
        text(row.role) !== '' && `Role: ${text(row.role)}`,
        ...groups.map((group) => `${text(group.label) || 'Skills'}: ${list(group.items).join(', ')}`)
      );
      return body === '' ? '' : `Skills:\n${body}`;
    }
    case 'experience': {
      const body = lines(
        span(text(row.started), row.finished as string | null | undefined),
        ...list(row.highlights).map((highlight) => `- ${highlight}`),
        list(row.skills).length > 0 && `Skills: ${list(row.skills).join(', ')}`
      );
      const head = [text(row.title), text(row.company)].filter((part) => part !== '').join(' at ');
      return `Experience, ${head || 'entry'}:\n${body}`.trimEnd();
    }
    case 'education': {
      const body = lines(
        span(text(row.started), row.finished as string | null | undefined),
        text(row.thesis) !== '' && `Thesis: ${text(row.thesis)}`,
        text(row.mark) !== '' && `Mark: ${text(row.mark)}`
      );
      const head = [text(row.degree), text(row.university)].filter((part) => part !== '').join(', ');
      return `Education, ${head || 'entry'}:\n${body}`.trimEnd();
    }
    case 'certificates': {
      const body = lines(
        text(row.issuer) !== '' && `Issued by ${text(row.issuer)}`,
        span(text(row.started), row.finished as string | null | undefined)
      );
      return `Certificate, ${text(row.name) || 'entry'}:\n${body}`.trimEnd();
    }
    case 'languages':
      return `Language, ${text(row.name) || 'entry'}${text(row.level) === '' ? '' : `: ${text(row.level)}`}`;
    default:
      return '';
  }
};
