/**
 * Deciding which address an application should actually go to.
 *
 * Every function here is pure and none of them calls a model, and that is the
 * security property rather than a style preference. This feature reads pages
 * written by strangers — a job posting, a careers page, a listing on a board —
 * and its output lands in the `To:` field of a mail carrying the user's CV.
 * That is an exfiltration path if anything on those pages gets to *decide*
 * something, and a poisoned posting saying "send applications to
 * harvest@not-the-company.com" is not hypothetical: fake listings that collect
 * CVs are a common fraud, because a CV is a complete identity package.
 *
 * So nothing here reads instructions. Pages are scanned for `@` by a regex that
 * has no opinions, and the result is sorted by facts the page cannot assert
 * about itself:
 *
 *   · does the address sit on the employer's own domain
 *   · was it found on the employer's own site, or only in the posting
 *   · did more than one independent source name it
 *
 * The last one is the point. An address printed in a posting is whatever the
 * posting says. The same address on the company's own careers page took control
 * of that company's website to forge.
 *
 * **Nothing here picks.** `rankRecipients` returns an ordered list with the
 * evidence attached, and a person chooses. The one thing it does assert is a
 * warning, and it warns rather than blocks — a recruitment agency mailing from
 * its own domain on behalf of a client is legitimate and common, and a check
 * that refused it would be turned off within a week.
 */

import { findApplicationEmails } from './applicationText.js';

/** Where a candidate was seen. Ordered by how hard it is to forge. */
export type EvidenceSource =
  /** The board's own structured data named this address. Nothing beats it. */
  | 'board_stated'
  /**
   * A page on the employer's own domain — whether it was reached by following
   * a link from the homepage or by a web search that landed on the same
   * registrable domain. The route does not change what the page is; owning the
   * domain is the thing that is hard to forge.
   */
  | 'company_site'
  | 'offer'
  | 'other_board'
  /**
   * A page a search engine returned, on a domain nobody has established as the
   * employer's — an applicant tracking system most often, since that is where
   * an "Apply" button lands. Real evidence and weak evidence: it corroborates,
   * and on its own it never lifts an address above `low`.
   */
  | 'web_page';

export type Evidence = {
  source: EvidenceSource;
  /** The page it was read from, so a person can go and look. */
  url: string;
  /** For a company page: home, careers or contact. */
  page?: string;
};

export type RecipientCandidate = {
  address: string;
  evidence: Evidence[];
  /** On the employer's own domain, as the board or the site itself stated it. */
  domain_match: boolean;
  /** A role inbox rather than a person — `kariera@`, `recruitment@`. */
  role_address: boolean;
  /** A consumer mail provider. Ordinary for a small firm, worth seeing. */
  free_mail: boolean;
  /** Named by more than one source that does not depend on the others. */
  corroborated: boolean;
  confidence: 'high' | 'medium' | 'low';
  /** Plain reasons, for showing under the address rather than a bare score. */
  why: string[];
};

/**
 * Second-level registries, so `stxnext.com.pl` compares as one domain rather
 * than as `com.pl`.
 *
 * A deliberate approximation of the public suffix list: the real one is ~10k
 * entries updated continuously, and carrying it to rank six email addresses
 * would be a dependency far larger than the feature. These are the suffixes
 * this project actually meets. A miss degrades to comparing one label too few,
 * which loses a domain match and shows a warning — the safe direction.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'com.pl', 'net.pl', 'org.pl', 'edu.pl', 'gov.pl', 'waw.pl', 'krakow.pl', 'wroc.pl',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'com.br', 'co.jp', 'co.nz', 'co.za', 'com.tr', 'com.ua'
]);

/**
 * The registrable part of a host: `mail.stxnext.com` and `www.stxnext.com` both
 * reduce to `stxnext.com`, which is the comparison that matters.
 */
export const registrableDomain = (hostOrUrl: string): string => {
  let host = hostOrUrl.trim().toLowerCase();

  if (host.includes('://')) {
    try {
      host = new URL(host).hostname;
    } catch {
      return '';
    }
  }

  host = host.replace(/^www\./, '').replace(/\.$/, '');

  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');

  const lastTwo = labels.slice(-2).join('.');

  return MULTI_LABEL_SUFFIXES.has(lastTwo)
    ? labels.slice(-3).join('.')
    : lastTwo;
};

const domainOfAddress = (address: string): string =>
  registrableDomain(address.slice(address.lastIndexOf('@') + 1));

/** Consumer providers. Legitimate for a small employer, never conclusive. */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com',
  'wp.pl', 'o2.pl', 'interia.pl', 'onet.pl', 'op.pl', 'gazeta.pl', 'tlen.pl'
]);

/** Local parts that mean "applications go here" rather than "this is Anna". */
const ROLE = /^(recruit|rekrutacj|hr|kadry|kariera|career|jobs?|praca|apply|aplikacj|cv|talent|hiring|work|people)/i;

/** Everything one verification pass collected, before it is weighed. */
export type GatheredSource = {
  source: EvidenceSource;
  url: string;
  page?: string;
  /** Raw page or posting text. Scanned, never interpreted. */
  text: string;
};

/**
 * How much the employer's domain is worth believing.
 *
 * `board` is `hiringOrganization.url` from the posting's structured data — the
 * board vouching for it. `discovered` was guessed from the name and checked
 * against a fact from the posting. `guessed` matched the name and nothing else,
 * which measurably picks the wrong company: "Devapo" reaches a German firm at
 * `devapo.com` while the employer is `devapo.io`.
 */
export type AnchorTrust = 'board' | 'discovered' | 'guessed';

export type RankInput = {
  gathered: GatheredSource[];
  /** Defaults to `board`, which is what a caller with a stated URL has. */
  anchorTrust?: AnchorTrust;
  /**
   * The employer's own domains — the site the board named, plus wherever it
   * redirected to. Both count: a Polish company holding `x.pl` and `x.com` and
   * serving one from the other is the norm.
   */
  companyDomains: string[];
};

const confidenceOf = (
  candidate: Omit<RecipientCandidate, 'confidence' | 'why'>,
  anchorTrust: AnchorTrust
): RecipientCandidate['confidence'] => {
  // The board naming the address outright needs no domain reasoning at all.
  if (candidate.evidence.some((entry) => entry.source === 'board_stated')) {
    return 'high';
  }

  const onCompanySite = candidate.evidence.some(
    (entry) => entry.source === 'company_site'
  );

  const raw: RecipientCandidate['confidence'] =
    candidate.domain_match && onCompanySite
      ? 'high'
      : candidate.domain_match && candidate.corroborated
        ? 'high'
        : candidate.domain_match || onCompanySite
          ? 'medium'
          : 'low';

  /**
   * A conclusion is never stronger than the domain it was reached through.
   *
   * Everything above compares an address against "the employer's domain". When
   * that domain was guessed rather than stated, the comparison inherits the
   * guess — and a badge saying "strong match" on a domain that may belong to a
   * different company with the same name is worse than no badge at all.
   */
  const ceiling: Record<AnchorTrust, RecipientCandidate['confidence']> = {
    board: 'high',
    discovered: 'medium',
    guessed: 'low'
  };

  const order = { low: 0, medium: 1, high: 2 } as const;

  return order[raw] <= order[ceiling[anchorTrust]] ? raw : ceiling[anchorTrust];
};

const reasonsFor = (
  candidate: Omit<RecipientCandidate, 'confidence' | 'why'>,
  companyDomains: string[]
): string[] => {
  const why: string[] = [];

  if (candidate.domain_match) {
    why.push("On the employer's own domain.");
  } else if (companyDomains.length > 0) {
    why.push(
      `Not on the employer's domain (${companyDomains.join(', ')}). That can be an agency, and it can be a fake posting.`
    );
  } else {
    why.push("The employer's own domain is unknown, so this could not be checked.");
  }

  const sources = new Set(candidate.evidence.map((entry) => entry.source));

  if (sources.has('company_site')) why.push("Found on the company's own site.");
  if (sources.has('offer')) why.push('Printed in the posting.');
  if (sources.has('board_stated')) why.push('Named by the board as the application address.');
  if (sources.has('other_board')) why.push('Also named by another board.');
  if (sources.has('web_page')) {
    why.push('Found on a page a web search reached, not on the employer\u2019s own site.');
  }
  if (candidate.corroborated) why.push('Named by more than one independent source.');
  if (candidate.role_address) why.push('A recruitment inbox rather than a person.');
  if (candidate.free_mail) {
    why.push('A consumer mail provider — ordinary for a small firm, worth a look.');
  }

  return why;
};

/**
 * The order candidates should be offered in.
 *
 * Sorting rather than choosing. The top of this list is a suggestion with its
 * reasons attached, not a decision — see the note at the top of the file.
 */
export const rankRecipients = ({
  gathered,
  companyDomains,
  anchorTrust = 'board'
}: RankInput): RecipientCandidate[] => {
  const stated = new Set(
    companyDomains.map((domain) => registrableDomain(domain)).filter(Boolean)
  );

  /**
   * Domains the employer's own site puts in writing.
   *
   * One stated domain is not enough, and Allegro is the example that made this
   * obvious: a board naming `allegro.tech` turned `kontakt@allegro.pl` — plainly
   * the same company — into a mismatch warning. Companies hold a national
   * domain, an international one and an engineering-brand one, and warning
   * about two of the three trains the user to ignore the warning that matters.
   *
   * So any address printed on the employer's own site contributes its domain.
   * That is not circular: the question is whether an address is plausibly the
   * employer's, and one they publish on their own site is theirs by definition.
   * What it adds is reach — the same domain named in the *posting* now matches
   * too, because the company's site vouched for it.
   *
   * It also quietly handles the third-party ATS case. A careers page that says
   * "apply at jobs@lever.co" is the employer telling you to apply there.
   */
  const attested = new Set<string>();

  for (const entry of gathered) {
    // Only the employer's own domain may vouch for another domain. A page found
    // by search on somebody else's domain cannot: an ATS page carrying
    // `careers@some-agency.com` would otherwise attest that agency's domain and
    // hand every address on it a match against this employer.
    if (entry.source !== 'company_site') continue;

    for (const address of findApplicationEmails(entry.text, 20)) {
      const domain = domainOfAddress(address);
      // A consumer provider on a company page is a personal address, not a
      // corporate domain. Attesting `gmail.com` would match every consumer
      // address anywhere, which is the opposite of a signal.
      if (domain && !FREE_MAIL.has(domain)) attested.add(domain);
    }
  }

  const domains = new Set([...stated, ...attested]);

  const byAddress = new Map<string, Evidence[]>();

  for (const entry of gathered) {
    for (const address of findApplicationEmails(entry.text, 20)) {
      const evidence = byAddress.get(address) ?? [];

      // One page naming an address twice is one piece of evidence, not two.
      if (!evidence.some((seen) => seen.url === entry.url)) {
        evidence.push({ source: entry.source, url: entry.url, page: entry.page });
      }

      byAddress.set(address, evidence);
    }
  }

  const candidates = [...byAddress.entries()].map(([address, evidence]) => {
    const partial = {
      address,
      evidence,
      domain_match: domains.has(domainOfAddress(address)),
      role_address: ROLE.test(address),
      free_mail: FREE_MAIL.has(domainOfAddress(address)),
      // Independent means different sources, not different pages: a careers
      // page and a contact page on one site are one site agreeing with itself.
      corroborated: new Set(evidence.map((entry) => entry.source)).size > 1
    };

    const viaAttestation =
      partial.domain_match && !stated.has(domainOfAddress(address));

    return {
      ...partial,
      confidence: confidenceOf(partial, anchorTrust),
      why: [
        ...reasonsFor(partial, [...domains]),
        ...(viaAttestation
          ? ["That domain also appears on the employer's own site."]
          : []),
        ...(partial.evidence.some((entry) => entry.source === 'board_stated')
          ? ['The board states this is where applications go.']
          : []),
        ...(anchorTrust === 'guessed'
          ? ["The employer's website was guessed from their name alone, so this may be a different company with the same name."]
          : anchorTrust === 'discovered'
            ? ["The employer's website was worked out from their name, not stated by the board."]
            : [])
      ]
    };
  });

  const rank = { high: 0, medium: 1, low: 2 } as const;

  return candidates.sort(
    (a, b) =>
      rank[a.confidence] - rank[b.confidence] ||
      Number(b.domain_match) - Number(a.domain_match) ||
      Number(b.corroborated) - Number(a.corroborated) ||
      Number(b.role_address) - Number(a.role_address) ||
      a.address.localeCompare(b.address)
  );
};

export type RecipientCheck = {
  address: string;
  /** Whether the verification pass saw this address anywhere at all. */
  found: boolean;
  domain_match: boolean;
  /** Empty when nothing is worth saying. Never blocks. */
  warnings: string[];
};

/**
 * What to say about the address already in the field.
 *
 * Separate from ranking because it answers a different question. Ranking asks
 * "what could this be"; this asks "is what you have there a problem" — and the
 * answer is usually no, so it returns an empty warning list rather than
 * manufacturing something to display.
 */
export const checkRecipient = (
  address: string,
  candidates: RecipientCandidate[],
  companyDomains: string[]
): RecipientCheck => {
  const normalised = address.trim().toLowerCase();
  const domains = new Set(
    companyDomains.map((domain) => registrableDomain(domain)).filter(Boolean)
  );

  const match = candidates.find((candidate) => candidate.address === normalised);
  const domainMatch = domains.has(domainOfAddress(normalised));
  const warnings: string[] = [];

  if (!normalised.includes('@')) {
    return { address: normalised, found: false, domain_match: false, warnings: [] };
  }

  if (domains.size > 0 && !domainMatch) {
    warnings.push(
      `This address is not on ${[...domains].join(' or ')}, which the posting names as the employer.`
    );
  }

  if (!match) {
    warnings.push(
      'This address was not found in the posting, on the company site, or on any other board.'
    );
  }

  if (match?.free_mail && !domainMatch) {
    warnings.push('It is a consumer mail address rather than a company one.');
  }

  return {
    address: normalised,
    found: Boolean(match),
    domain_match: domainMatch,
    warnings
  };
};
