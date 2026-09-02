/**
 * The capability map: everything this runtime knows how to do.
 *
 * A plain object rather than a registry class, because it is read once at
 * startup and never mutated. `runtime/create.ts` passes it to the router, and
 * the router's only question is whether a name is in it.
 *
 * The dependency rule worth stating: `core/` must never import this file. The
 * orchestrator walks steps and knows nothing about offers, CVs or mail, which
 * is what lets a capability be added here without touching it. A boundary rule
 * fails the build if that ever stops being true.
 */

import type { CapabilityMap } from '../contracts/index.js';
import { analyzeOffer } from './analyzeOffer.js';
import { draftApplication } from './apply/draft.js';
import { askProfile } from './askProfile.js';
import { generateEvidenceSummary } from './cv/evidence.js';
import { extractCv } from './cv/extract.js';
import { translateCv } from './cv/translate.js';
import { verifyRecipient } from './recipient/verify.js';

export const capabilities: CapabilityMap = {
  [analyzeOffer.name]: analyzeOffer as CapabilityMap[string],
  [askProfile.name]: askProfile as CapabilityMap[string],
  [draftApplication.name]: draftApplication as CapabilityMap[string],
  [extractCv.name]: extractCv as CapabilityMap[string],
  [generateEvidenceSummary.name]: generateEvidenceSummary as CapabilityMap[string],
  [translateCv.name]: translateCv as CapabilityMap[string],
  [verifyRecipient.name]: verifyRecipient as CapabilityMap[string]
};

export {
  analyzeOffer,
  askProfile,
  draftApplication,
  extractCv,
  generateEvidenceSummary,
  translateCv,
  verifyRecipient
};
