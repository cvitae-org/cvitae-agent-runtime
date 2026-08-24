/**
 * The capabilities the runtime exposes.
 *
 * Each is one of two kinds, and the kind should be stated when adding another.
 * `extract_cv`, `translate_cv`, `analyze_offer` and `draft_application` are
 * declared pipelines of narrow schema'd calls; `ask_profile` is a bounded tool
 * loop. Declared should stay the majority — it is reproducible, runs on models
 * that cannot call tools, and costs a known number of requests.
 *
 * `verify_recipient` is the odd one: a declared pipeline of three transforms
 * and **no model call at all**. It reads pages written by strangers and its
 * output lands beside a Send button, so nothing on those pages is allowed to
 * decide anything — see the note at the top of that file.
 *
 * `draft_application` writes an application email and deliberately cannot send
 * one: it has no access to `mail/`, and returns a suggested recipient for a
 * person to confirm. A capability that could both read an offer and send mail
 * would put attacker-written text one step from an outbound channel.
 */

import { analyzeOffer } from './analyzeOffer.js';
import { askProfile } from './askProfile.js';
import { draftApplication } from './draftApplication.js';
import { extractCv } from './extractCv.js';
import { verifyRecipient } from './verifyRecipient.js';
import { translateCv } from './translateCv.js';
import type { CapabilityMap } from '../core/router.js';

export const defaultCapabilities: CapabilityMap = {
  [extractCv.name]: extractCv,
  [translateCv.name]: translateCv,
  [analyzeOffer.name]: analyzeOffer,
  [draftApplication.name]: draftApplication,
  [verifyRecipient.name]: verifyRecipient,
  [askProfile.name]: askProfile
};

export {
  analyzeOffer,
  askProfile,
  draftApplication,
  extractCv,
  translateCv,
  verifyRecipient
};
