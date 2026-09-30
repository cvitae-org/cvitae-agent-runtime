/**
 * What counts as a public URL, on its own.
 *
 * The full table lives in the studio, at `test/contracts/public-url-vectors.json`,
 * where the app's Swift and this module are held to the same answers line by
 * line. This is the short version, so that this repository's `pnpm check` still
 * fails a change to the rule without the studio checked out beside it. It is not
 * a second source of truth: when the two disagree, the studio's table is right
 * and this one is stale.
 *
 * The cases are grouped by what a shortcut would get wrong. Each group was
 * confirmed by breaking the rule it covers: dropping the numeric-last-label test
 * lets every address through, dropping the trailing-dot strip lets `localhost.`
 * through, and matching reserved names by string ending refuses `xlan`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { refuseUrl } from '../src/effects/offers.js';
import { RESERVED_NAMES, isPublicUrl, isReservedName } from '../src/public-url.js';

const accepted = [
  'https://jobs.example.com/apply',
  'HTTPS://Jobs.Example.COM/Apply',
  'https://jobs.example.com:443/apply',
  'https://jobs.example.com./apply',
  'https://jobs.example.com/apply?next=https://127.0.0.1/',
  'https://xn--r8jz45g.jp/',
  'https://intranet.example.com/',
  'https://jobs.example.xlan/'
];

const refused: Array<[url: string, why: string]> = [
  ['http://jobs.example.com/', 'not https'],
  ['https:jobs.example.com', 'a browser reads a host here that Foundation does not'],
  ['https:///jobs.example.com', 'an empty authority'],
  ['https://user:pw@jobs.example.com/', 'credentials'],
  ['https://@jobs.example.com/', 'empty credentials'],
  ['https://jobs.example.com@127.0.0.1/', 'the host is after the @'],
  ['https://jobs.example.com:8443/', 'a port'],
  ['https://jobs.example.com\\@127.0.0.1/', 'a backslash'],
  ['https://jobs.exa\tmple.com/', 'a tab'],
  ['https://router/', 'one label'],
  ['https://localhost./', 'a trailing dot is not another host'],
  ['https://foo.localhost./', 'nor under .localhost'],
  ['https://nas.lan/', '.lan'],
  ['https://router.home.arpa/', '.home.arpa'],
  ['https://files.corp/', '.corp'],
  ['https://wiki.intranet/', '.intranet'],
  ['https://nas.%6c%61%6e/', 'percent-encoded .lan'],
  ['https://127.0.0.1/', 'loopback'],
  ['https://169.254.169.254/latest/meta-data', 'the metadata address'],
  ['https://100.64.0.1/', 'carrier-grade NAT'],
  ['https://0x7f.0.0.1/', 'hex'],
  ['https://0177.0.0.1/', 'octal'],
  ['https://127.1/', 'two parts'],
  ['https://2130706433/', 'one decimal number'],
  ['https://8.8.8.8/', 'a public address is still an address'],
  ['https://[::1]/', 'IPv6 loopback'],
  ['https://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback'],
  ['https://[fe80::1]/', 'IPv6 link-local']
];

test('a public URL is an https URL on a name', () => {
  for (const url of accepted) assert.equal(isPublicUrl(url), true, url);
});

test('anything a browser and a strict parser might read differently is refused, and so is every address', () => {
  for (const [url, why] of refused) assert.equal(isPublicUrl(url), false, `${url} (${why})`);
});

test('the length limit is 8192 bytes', () => {
  const prefix = 'https://jobs.example.com/';

  assert.equal(isPublicUrl(prefix + 'a'.repeat(8192 - prefix.length)), true);
  assert.equal(isPublicUrl(prefix + 'a'.repeat(8193 - prefix.length)), false);
});

test('a reserved name is matched as whole labels at the end of the host', () => {
  for (const name of RESERVED_NAMES) {
    assert.equal(isReservedName(name), true, name);
    assert.equal(isReservedName(`router.${name}`), true, `router.${name}`);
    assert.equal(isReservedName(`router.${name}.`), true, `router.${name}.`);
    assert.equal(isReservedName(`x${name}`), false, `x${name}`);
    assert.equal(isReservedName(`${name}.example.com`), false, `${name}.example.com`);
  }
});

test('the offer fetcher refuses reserved names before it asks a resolver anything', async () => {
  const asked: string[] = [];
  const resolver = async (host: string) => {
    asked.push(host);
    return ['93.184.216.34'];
  };

  for (const url of ['https://localhost./x', 'http://nas.lan/', 'https://files.corp/', 'https://printer.home/']) {
    assert.match((await refuseUrl(url, resolver)) ?? '', /not a public host/, url);
  }

  assert.deepEqual(asked, [], 'a name that is refused on its face is not resolved');
  assert.equal(await refuseUrl('https://jobs.example.com/', resolver), undefined);
  assert.deepEqual(asked, ['jobs.example.com']);
});
