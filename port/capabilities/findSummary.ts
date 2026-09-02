/**
 * Finding the summary paragraph without asking a model.
 *
 * This step used to be a `generateObject` call and should not have been. The
 * summary is the one artefact in a CV that is *already* the text you want:
 * every other step restructures prose into fields, but this one only has to
 * copy a contiguous paragraph. Asking a small model to quote is asking it to do
 * the thing it is worst at — measured against the real cvitae CV on gemma3:4b,
 * five different phrasings of the instruction each returned the *instruction*,
 * restated, between four and five times out of five:
 *
 *   "Copy the professional summary paragraph from the CV."   1/5
 *   "Copy the summary paragraph from the CV."                1/5
 *   "Quote the professional summary from the CV."            0/5
 *   (no system prompt, field description only)               0/5
 *   "Return the professional summary from the CV, word …"    1/5
 *
 * Every one of those failures produced text like "Summarize the provided CV
 * text into a concise paragraph" — plausible, well-formed, and not in the CV.
 * No amount of rewording fixes a model that has decided the field wants a
 * prompt, and the verbatim guard downstream can only turn a wrong answer into
 * an empty one.
 *
 * Parsing gets it right every time, costs nothing, and cannot hallucinate. The
 * model is still the right tool for the other six artefacts, where the output
 * genuinely is not present in the input.
 */

/** Headings a CV puts above its summary, in the languages this project sees. */
const SUMMARY_HEADINGS =
  /^(summary|profile|about( me)?|professional summary|career summary|objective|profil|podsumowanie|o mnie)\s*:?\s*$/i;

/** Headings that end it. Anything that starts the next section will do. */
const SECTION_HEADINGS =
  /^(experience|work experience|employment|professional experience|skills|technical skills|education|certificates|certifications|languages|projects|contact|doświadczenie|umiejętności|edukacja|certyfikaty|języki)\s*:?\s*$/i;

/** Marks a line as a heading in CVs that use capitals instead of a keyword. */
const isHeadingLike = (line: string): boolean =>
  line.length > 0 &&
  line.length <= 40 &&
  line === line.toUpperCase() &&
  /[A-Z]/.test(line) &&
  !line.endsWith('.');

/** Lines that are contact details rather than prose. */
const isContactLine = (line: string): boolean =>
  /@/.test(line) ||
  /https?:\/\//.test(line) ||
  /\b(github|linkedin|gitlab)\b/i.test(line) ||
  /^[+\d][\d\s()+-]{6,}$/.test(line);

/**
 * A paragraph has to be long enough to be a summary rather than a job title.
 * The shortest real summary seen is around 150 characters; 80 leaves room
 * without admitting single lines like "Frontend Developer, Warsaw".
 */
const MIN_SUMMARY_LENGTH = 80;

/**
 * How far into the document to keep looking.
 *
 * A summary sits near the top by convention. Without a bound, the fallback
 * scan will happily return the first long paragraph it finds anywhere — which
 * on a CV with no summary at all is a job description, silently presented as
 * the person's own words.
 */
const HEAD_LINES = 40;

const collectFrom = (lines: string[], start: number): string => {
  const collected: string[] = [];

  for (let index = start; index < lines.length; index++) {
    const line = (lines[index] ?? '').trim();

    // A blank line ends the paragraph, but only once something is collected —
    // CVs often leave one between the heading and the text.
    if (!line) {
      if (collected.length > 0) break;
      continue;
    }

    if (SECTION_HEADINGS.test(line) || isHeadingLike(line)) break;

    // A summary never contains an email address or a phone number. Stopping
    // here is what keeps the unlabelled-paragraph fallback from returning the
    // contact block that sits directly under the name.
    if (isContactLine(line)) break;

    collected.push(line);
  }

  return collected.join(' ').replace(/\s+/g, ' ').trim();
};

/**
 * Returns the summary, or an empty string when the CV has none.
 *
 * Empty is a legitimate answer and deliberately not filled in with a guess: a
 * CV without a summary paragraph is ordinary, and inventing one from the
 * experience section would put words in the user's mouth.
 */
export const findSummary = (corpus: string): string => {
  const lines = corpus.split('\n');

  // Preferred: an explicit heading. Unambiguous wherever it appears.
  for (const [index, raw] of lines.entries()) {
    if (!SUMMARY_HEADINGS.test((raw ?? '').trim())) continue;

    const paragraph = collectFrom(lines, index + 1);
    if (paragraph.length >= MIN_SUMMARY_LENGTH) return paragraph;
  }

  // Fallback: the first substantial prose paragraph near the top, before any
  // section heading. This is the shape of a CV that opens with a paragraph
  // under the name and no label on it.
  for (let index = 0; index < Math.min(lines.length, HEAD_LINES); index++) {
    const line = (lines[index] ?? '').trim();

    // Order matters: a section heading is also heading-like, so testing for it
    // second means `continue` fires first and the scan runs straight past the
    // boundary into the experience section — which then reads as the summary.
    if (SECTION_HEADINGS.test(line)) break;
    if (!line || isContactLine(line) || isHeadingLike(line)) continue;

    const paragraph = collectFrom(lines, index);
    if (paragraph.length >= MIN_SUMMARY_LENGTH) return paragraph;
  }

  return '';
};
