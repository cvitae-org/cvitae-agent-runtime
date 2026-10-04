/**
 * The address of a piece, as text.
 *
 *   well ":" scope [ "@" version ] { "/" segment } [ "#" digest ]
 *
 *   tickets:support/open/T-1042
 *   tickets:support@12/open/T-1042#9f86d081884c7d65
 *
 * At most two segments follow the scope (a section, then an item); none names
 * the whole scope. The `@version` and `#digest` parts are what turn an address
 * into a citation, and neither takes part in deciding whether two refs name the
 * same piece.
 *
 * There is exactly one way to write a given ref, and `parseRef` accepts only
 * that. A ref compared as text, stored in a column, or matched by prefix then
 * means the same thing everywhere, and two spellings of one piece cannot slip
 * past a wall. A segment is percent-encoded byte by byte (UTF-8), keeping only
 * `A-Z a-z 0-9 . _ ~ -`, with upper-case hex; a segment of nothing but dots is
 * encoded in full, so `.` and `..` never read as a path.
 */

import { OperationError } from '../contracts/index.js';
import type { PieceRef } from '../contracts/index.js';
import { isDigest } from './digest.js';

export const MAX_REF_LENGTH = 1024;
export const MAX_PATH = 2;

const WELL = /^[a-z][a-z0-9-]{0,31}$/;
const SHAPE = /^([a-z][a-z0-9-]{0,31}):([^@/#]+)(?:@([^/#]+))?((?:\/[^/#]+){0,2})(?:#([0-9a-f]{16}))?$/;

const refuse = (message: string, text?: string): never => {
  const shown = text === undefined ? '' : ` (${JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}...` : text)})`;
  throw new OperationError('invalid_ref', `${message}${shown}`);
};

export const isWellId = (value: unknown): value is string => typeof value === 'string' && WELL.test(value);

const unreserved = (byte: number): boolean =>
  (byte >= 0x30 && byte <= 0x39) ||
  (byte >= 0x41 && byte <= 0x5a) ||
  (byte >= 0x61 && byte <= 0x7a) ||
  byte === 0x2d ||
  byte === 0x2e ||
  byte === 0x5f ||
  byte === 0x7e;

export const encodeSegment = (segment: string): string => {
  if (segment === '') return refuse('A ref segment cannot be empty.');
  // A lone surrogate has no UTF-8 form; `Buffer` would write U+FFFD for it, and
  // two different strings would then share an address.
  if (/\p{Surrogate}/u.test(segment)) return refuse('A ref segment must be well-formed Unicode.');
  const dots = /^\.+$/.test(segment);
  let out = '';
  for (const byte of Buffer.from(segment, 'utf8')) {
    out +=
      unreserved(byte) && !(dots && byte === 0x2e)
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
};

const decodeSegment = (encoded: string, text: string): string => {
  const bytes: number[] = [];
  for (let at = 0; at < encoded.length; at += 1) {
    const code = encoded.charCodeAt(at);
    if (code === 0x25) {
      const hex = encoded.slice(at + 1, at + 3);
      if (!/^[0-9A-F]{2}$/.test(hex)) return refuse('A ref has a malformed escape.', text);
      bytes.push(Number.parseInt(hex, 16));
      at += 2;
    } else if (code > 0x7f) {
      return refuse('A ref is not ASCII.', text);
    } else {
      bytes.push(code);
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return refuse('A ref segment is not valid UTF-8.', text);
  }
};

export const formatRef = (ref: PieceRef): string => {
  if (!isWellId(ref.well)) return refuse('A ref needs a well id of lower-case letters, digits and hyphens.', ref.well);
  if (ref.path.length > MAX_PATH) return refuse(`A ref has at most ${MAX_PATH} segments after its scope.`);
  if (ref.digest !== undefined && !isDigest(ref.digest)) return refuse('A ref digest is 16 lower-case hex characters.', ref.digest);

  const text =
    `${ref.well}:${encodeSegment(ref.scope)}` +
    (ref.version === undefined ? '' : `@${encodeSegment(ref.version)}`) +
    ref.path.map((segment) => `/${encodeSegment(segment)}`).join('') +
    (ref.digest === undefined ? '' : `#${ref.digest}`);

  if (text.length > MAX_REF_LENGTH) return refuse(`A ref is at most ${MAX_REF_LENGTH} characters.`);
  return text;
};

export const parseRef = (text: string): PieceRef => {
  if (text.length > MAX_REF_LENGTH) return refuse(`A ref is at most ${MAX_REF_LENGTH} characters.`, text);
  const match = SHAPE.exec(text);
  if (match === null) return refuse('Not a ref.', text);

  const [, well, scope, version, path, digest] = match;
  const ref: PieceRef = {
    well: well as string,
    scope: decodeSegment(scope as string, text),
    path: path ? path.slice(1).split('/').map((segment) => decodeSegment(segment, text)) : [],
    ...(version === undefined ? {} : { version: decodeSegment(version, text) }),
    ...(digest === undefined ? {} : { digest })
  };

  // Spelled any other way (a needless escape, lower-case hex) it is the same
  // piece under a second name, which is exactly what a wall must not meet.
  if (formatRef(ref) !== text) return refuse('A ref is not in canonical form.', text);
  return ref;
};

export const isRef = (text: unknown): text is string => {
  if (typeof text !== 'string') return false;
  try {
    parseRef(text);
    return true;
  } catch {
    return false;
  }
};

/** The ref with its version and digest taken off: what a selection names. */
export const refAddress = (ref: PieceRef): PieceRef => ({ well: ref.well, scope: ref.scope, path: ref.path });

/** The canonical address as text. Two citations of one piece share it. */
export const refKey = (ref: PieceRef): string => formatRef(refAddress(ref));
