# Generic provider engines

Configured v2 connections support HTTP JSON, embedded JSON, DOM listing, DOM
detail and sitemap recipes. The runtime advertises these capabilities when
resolving signed definitions; the local scraper must independently advertise
each HTTP engine and `recipeBinding: provider-source-v1`.

DOM listings run over fetched HTML and in the browser. Detail recipes validate
one declared URL and any known listing ID. Browser detail tokens bind to that
URL, tab/session and expiry; listing tokens retain the full search scope and
original recipe throughout pagination. Selectors and taxonomy dictionaries are
bounded data, with no downloaded code execution.

With provider connections configured, offer details use only those providers.
Saved offers keep their latest listing's scoped source reference. An unbound URL
needs one matching provider or a unique configured priority. Disablement,
revocation, identity mismatch or failed extraction does not fall back to an
installed named-board adapter. Generic website reading remains a separate port.

Detail facts and immutable recipe/acquisition provenance commit in one SQLite
transaction. Cancelled fetches cannot publish late facts. Repeated canonical URLs
keep the same offer, notes and application status. Browser listing/detail imports
use the same acquisition history and retain original provider-local recipe IDs.

DOM salaries remain published text; unknown mappings remain absent. Sitemap
search matches URL slugs and labels provisional titles and partial coverage.
The shared HTTP transport retains public-DNS, robots, throttle, body/request
limits and cancellation. Provider credentials never reach the job site.

`scripts/integration-details.test.ts` covers browser imports, selected-provider
detail resolution, withdrawal, mismatched identity and transactional history.
Shared HTML/document and sitemap tests live in the scraper. Studio additionally
checks Chromium and WebKit capture against intercepted fictional pages.

Build the scraper's `packages/job-pages` and refresh this runtime's local file
dependency before compiling. These source tests/builds do not update an installed
Studio bundle. Removing legacy board code is M5; settings UI is M6; production
activation remains a separate acceptance gate.
