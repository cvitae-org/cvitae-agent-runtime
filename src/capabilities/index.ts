/**
 * The capabilities the runtime exposes.
 *
 * Each is one of two kinds, and the kind should be stated when adding another.
 * `extract_cv` and `analyze_offer` are declared pipelines of narrow schema'd
 * calls; `ask_profile` is a bounded tool loop. Declared should stay the
 * majority — it is reproducible, runs on models that cannot call tools, and
 * costs a known number of requests.
 */

import { analyzeOffer } from './analyzeOffer.js';
import { askProfile } from './askProfile.js';
import { extractCv } from './extractCv.js';
import type { CapabilityMap } from '../core/router.js';

export const defaultCapabilities: CapabilityMap = {
  [extractCv.name]: extractCv,
  [analyzeOffer.name]: analyzeOffer,
  [askProfile.name]: askProfile
};

export { analyzeOffer, askProfile, extractCv };
