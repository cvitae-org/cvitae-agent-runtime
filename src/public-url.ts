/**
 * What "a public URL" means here, in one place.
 *
 * The question is asked wherever a URL that came from a page — an offer's apply
 * link, a form's `action`, an address someone typed — is about to be opened or
 * filled in by this program or the app around it. It was answered three times,
 * each a little differently: the app's native browser blocked private IPv4
 * ranges by regex and three name suffixes, the application agent checked only
 * for `https:` and no credentials, and the offer fetcher resolved the name and
 * checked the addresses. Each was right about what it checked and silent about
 * what the others did, so a URL could be public to one and local to the next:
 * `https://127.0.0.1/` was public to the application agent and refused by the
 * app, and `https://0x7f.0.0.1/` was public to both.
 *
 * The rules are the same in the app's Swift (`StudioBrowserWindow.publicURL`),
 * and `test/contracts/public-url-vectors.json` in the studio is the table both
 * run. Change one side without the other and a vector fails.
 *
 * A URL is public when all of these hold:
 *
 *  1. It is at most 8192 bytes, starts with `https://` in any case, and holds no
 *     control character and no backslash. A browser deletes a tab, trims a
 *     space and reads `\` as `/`; a strict parser does none of it. A string the
 *     two would read differently is refused rather than argued about.
 *  2. The part between `//` and the first `/`, `?` or `#` is not empty and has
 *     no `@`. A browser skips surplus slashes (`https:///host` is
 *     `https://host`) and Foundation reads no host at all; empty credentials
 *     (`https://@host/`) are dropped by one parser and kept by the other. Both
 *     are looked for in the text.
 *  3. It parses, with no user name, no password and no port but 443.
 *  4. The host is a name: two or more labels of letters, digits, `-` and `_`,
 *     none empty, after one trailing dot is taken off. That refuses IPv6
 *     literals, percent-escapes and anything the parser left in Unicode.
 *  5. The last label is not a number — all digits, or `0x` and hex digits. That
 *     is how a URL parser recognises an IPv4 address in *any* notation, and it
 *     refuses `127.1`, `0x7f.0.0.1`, `0177.0.0.1` and `2130706433` without
 *     parsing them. No top-level domain is numeric, so no site is lost.
 *  6. The host is not under a reserved name (below).
 *
 * Addresses are refused whether or not they are private. A careers page that
 * means to be found has a name, and this rule needs no table of ranges to keep
 * in step with the rest of the internet.
 *
 * What this does not do: resolve the name. `https://127.0.0.1.nip.io/` is a
 * public name that answers with loopback, and so is anything an attacker points
 * a domain at. That needs a resolver and still races the connection (see
 * `refuseUrl` in `effects/offers.ts`, which resolves for the fetches this
 * process makes itself). The app's browser cannot ask the resolver at all.
 *
 * At the root beside `hash.ts` and imports nothing, so anything may import it.
 */

/**
 * Names that are never an employer's public site, matched as whole labels at the
 * end of the host: `router.lan` and `lan` are under `lan`, `xlan` is not.
 *
 * `localhost` is RFC 6761 and `local` is mDNS (RFC 6762). `internal` and
 * `home.arpa` (RFC 8375) are reserved for private use, and `intranet` and
 * `localdomain` are what people reach for anyway. `home` and `corp` are
 * name-collision strings that ICANN keeps out of the root because networks
 * already use them privately; `lan` is the same by convention.
 *
 * `example`, `test` and `invalid` are absent on purpose: they are reserved so
 * that documentation and fixtures can use them, and fixtures do.
 */
export const RESERVED_NAMES: readonly string[] = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'home.arpa'
];

const withoutRootDot = (host: string): string => host.toLowerCase().replace(/\.$/, '');

/** Whether `host` is one of {@link RESERVED_NAMES}, or under one. */
export const isReservedName = (host: string): boolean => {
  const name = withoutRootDot(host);

  return RESERVED_NAMES.some((reserved) => name === reserved || name.endsWith(`.${reserved}`));
};

const MAX_BYTES = 8192;

/** At least two labels, none empty. */
const NAME = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/;

/** How a URL parser tells that a label is an IPv4 number. */
const NUMBER = /^(?:[0-9]+|0x[0-9a-f]*)$/;

const HTTPS = /^https:\/\//i;

/** A character no URL should carry raw, and the backslash. */
const unsafe = (raw: string): boolean => {
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;

    if (code <= 0x1f || code === 0x7f || char === '\\') return true;
  }

  return false;
};

/** Whether `raw` is an HTTPS URL on a public name. See the rules above. */
export const isPublicUrl = (raw: string): boolean => {
  if (new TextEncoder().encode(raw).length > MAX_BYTES) return false;
  if (!HTTPS.test(raw) || unsafe(raw)) return false;

  // `https://` is eight characters. What follows, up to the first `/`, `?` or
  // `#`, is the authority: where credentials hide, and what a browser would
  // fill in for itself if it were empty.
  const authority = raw.slice(8).split(/[/?#]/, 1)[0] ?? '';

  if (authority === '' || authority.includes('@')) return false;

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // `port` is empty for 443 as well as for none: the default is dropped.
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;

  const host = withoutRootDot(url.hostname);

  if (!NAME.test(host)) return false;
  if (NUMBER.test(host.slice(host.lastIndexOf('.') + 1))) return false;

  return !isReservedName(host);
};
