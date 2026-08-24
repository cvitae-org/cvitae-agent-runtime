## Verdict

  The core architecture is strong and worth keeping as a modular monolith. The Capability → Plan → Orchestrator → Executor pipeline, narrow
  Zod schemas, explicit degradation, and scoped tool registry are all good choices.

  Before wiring it into cvitae or exposing the HTTP service beyond development, I would address these in order.

  ## Highest-priority changes

  1. Harden the HTTP boundary.

     The generic run endpoint currently permits extract_cv inputs containing arbitrary local paths. Those paths reach readFile(), and the
     extracted corpus is returned to the caller. Offer URLs also accept any HTTP(S) destination and follow redirects, creating an SSRF path.

     Relevant code: src/server/index.ts:251, src/sources/index.ts:184, src/offers/fetch.ts:110.

     I would:
      - Allow kind: "file" only for trusted in-process callers; HTTP should accept uploads and text.
      - Reject loopback, private, link-local, and metadata IPs for offer fetching, including every redirect.
      - Enforce loopback binding at startup. If remote binding is required, make authentication mandatory.
      - Add response/file byte limits before buffering.

  2. Make document updates transactional.

     Extraction performs an unlocked read–merge–write, while every write uses the same <path>.<pid>.tmp filename: src/capabilities/
     extractCv.ts:495, src/store/cvDocument.ts:154.

     I reproduced concurrent writes 20 times; all 20 iterations had a rejected write. Even unique temporary names would still allow lost
     updates.

     Add a repository-level update(mutator) operation with:
      - Per-document serialization.
      - UUID temporary names.
      - A revision/CAS or cross-process lock.
      - Explicit 0700 directory and 0600 file permissions.

     Also, POST /document currently treats a missing document as {}, which validates into an empty CV and overwrites the existing one: src/
     server/index.ts:390. Require a full document and preferably an expected revision; make reset a separate explicit operation.

  3. Introduce one process-wide model gateway.

     Local concurrency is limited only within a single plan. Two simultaneous requests can still hit the same local GPU concurrently. Planner,
     router, and image calls also bypass the executor entirely: src/core/orchestrator.ts:35, src/core/planner.ts:84, src/sources/image.ts:84.

     A shared ModelGateway should own:
      - Process-wide provider concurrency and rate limiting.
      - Abort propagation.
      - Retry policy.
      - Sanitized logging.
      - Data-egress policy.
      - Critical-step fail-fast cancellation.

     Currently a critical parallel step is examined only after the complete pool settles, so queued model calls still run even though the
     result is already invalid: src/core/orchestrator.ts:114.

  4. Correct the canonical-versus-derived storage split.

     LanceDB is described as entirely derived, but saved offer text and analysis exist only in its offers table. reindex() rebuilds CV chunks,
     not offers: src/store/store.ts:32, src/store/store.ts:73.

     I would store canonical offers in SQLite or JSON and treat LanceDB strictly as a rebuildable search index.

     The index also needs an embedding fingerprint containing provider, model, dimensions, normalization, and index schema version. At
     present, unchanged content IDs reuse old vectors after an embedding-model change, which can silently corrupt ranking or fail on dimension
     mismatch.

  5. Fix the stated privacy boundary.

     The tool boundary provides least privilege, but it does not mean user data stays on the machine. Hosted extraction receives the full CV
     corpus, and hosted tool loops receive whatever CV data tools return: README.md:11, src/capabilities/extractCv.ts:451.

     I would describe the guarantee as “storage stays local” and add an explicit policy such as local_only versus allow_hosted, with consent
     for sensitive capabilities.

     Additionally, raw AI SDK errors are written to stderr in several places. I confirmed those errors can contain request prompts and
     response bodies despite the metadata-only JSONL logger. Replace raw console.warn(error) calls with a central redacted formatter: src/
     core/orchestrator.ts:94.

  6. Give plans explicit stages.

     Scheduling currently means “all non-transforms, then all transforms,” so preparation work cannot be represented as a step. Source
     reading, fetching, and vision calls consequently happen inside plan(), outside normal timing and failure policies: src/core/
     orchestrator.ts:44, src/capabilities/extractCv.ts:426.

     A simple staged model is sufficient:

     prepare → parallel extraction → assemble → persist/index

     This would also make elapsedMs cover the entire operation instead of only plan execution.

  7. Repair batch delivery semantics.

     executeBatch catches failures from both computation and onItem in the same block. If the persistence callback fails, it reports the
     successful computation as failed, invokes the callback again, and can silently discard the second rejection: src/core/batch.ts:132.
    broken.

  - Restrict runFromText; it routes over every capability but always constructs {question}, which only ask_profile accepts.
  - Move shared offer enums out of the analyzeOffer ↔ boardFacts circular dependency.
  - Turn deterministic smoke checks into real node:test tests, export a buildServer() factory for route testing, and add CI.

  All existing checks passed: typecheck, lint, seven AI-logging tests, and the full smoke run against LanceDB and the available local model.
  No repository files were changed. The review covered the current working tree, including its pre-existing uncommitted changes.