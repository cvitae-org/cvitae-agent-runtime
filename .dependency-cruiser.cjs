/**
 * The boundaries, enforced.
 *
 * Every rule here restates something the README argues for in prose. That
 * duplication is deliberate: an architecture that lives only in a document
 * describes the code it was written against, and stops describing the code
 * about eight commits later. These rules fail the build instead.
 *
 * `tsPreCompilationDeps: true` is load-bearing and not an optimisation. Without
 * it, dependency-cruiser reads the emitted JavaScript, where `import type` has
 * been erased — and since `contracts/` is almost entirely types, the rule that
 * contracts imports nothing would pass by having nothing to look at.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'sqlite-driver-is-sealed',
      comment:
        'Only storage/sqlite/ may touch the driver. The point of a port is that ' +
        'the engine is replaceable; an import of better-sqlite3 anywhere else ' +
        'makes that false without anyone deciding it.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/storage/sqlite/' },
      to: { dependencyTypes: ['npm'], path: 'better-sqlite3' }
    },
    {
      name: 'contracts-import-nothing',
      comment:
        'contracts/ is vocabulary. It depends on no implementation, which is ' +
        'what lets every other module depend on it without depending on each other.',
      severity: 'error',
      from: { path: '^src/contracts/' },
      to: { path: '^src/', pathNot: '^src/contracts/' }
    },
    {
      name: 'core-knows-steps-not-subjects',
      comment:
        'core/ walks a plan. It has no idea what a CV or a job offer is, and the ' +
        'moment it does, every capability added afterwards has to be taught to it.',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^src/capabilities/' }
    },
    {
      name: 'capabilities-sit-below-core',
      comment:
        'A capability declares work; it does not drive it. Importing the ' +
        'orchestrator from a capability is how the plan-as-data property gets lost.',
      severity: 'error',
      from: { path: '^src/capabilities/' },
      to: { path: '^src/(core|runtime|adapters)/' }
    },
    {
      name: 'capabilities-never-touch-sql',
      comment:
        'Capabilities reach storage through the ports on RunContext, never a store.',
      severity: 'error',
      from: { path: '^src/capabilities/' },
      to: { path: '^src/storage/' }
    },
    {
      name: 'effects-know-no-core',
      comment:
        'effects/ is the outside world with no opinion about who is calling. An ' +
        'effect that knows about runs or capabilities is a capability.',
      severity: 'error',
      from: { path: '^src/effects/' },
      to: { path: '^src/(core|capabilities|runtime)/' }
    },
    {
      name: 'no-tool-wraps-mail',
      comment:
        'Scraped offer text reaches model context. An outbound channel one tool ' +
        'call away from attacker-written text is an exfiltration path with a ' +
        'plausible cover story. Mail is built by runtime/ and handed to adapters/.',
      severity: 'error',
      from: { path: '^src/tools/' },
      to: { path: '^src/effects/mail\\.ts$' }
    },
    {
      name: 'no-channel-wraps-mail',
      comment:
        'The same rule as no-tool-wraps-mail, one step further out. An IPC caller ' +
        'is a renderer, and a renderer hosts remote content — a page it loaded, a ' +
        'script that page pulled in. runtime/ hands the sender to a host directly, ' +
        'and a host is a program someone wrote rather than a page someone loaded.',
      severity: 'error',
      from: { path: '^src/adapters/ipc/' },
      to: { path: '^src/effects/mail\\.ts$' }
    },
    {
      name: 'retrieval-holds-no-write-handle',
      comment:
        'retrieval/ is typed against ChunkReader, which has no write method. This ' +
        'rule stops the type being sidestepped by importing the implementation.',
      severity: 'error',
      from: { path: '^src/retrieval/' },
      to: { path: '^src/storage/' }
    },
    {
      name: 'credentials-stay-below-effects',
      comment:
        'Only the provider catalogue and the effects that hold a connection may ' +
        'reach secrets/. Nothing in core/, capabilities/, tools/ or an adapter ' +
        'has any business holding a key, and a module that cannot import one ' +
        'cannot leak one. Reading a key is narrower still — see the grep in ' +
        'scripts/boundaries.test.ts.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/(secrets|providers|effects)/' },
      to: { path: '^src/secrets/' }
    },
    {
      name: 'no-circular',
      comment:
        'The previous runtime had analyzeOffer <-> boardFacts, and neither file ' +
        'could be read without the other. Shared vocabulary belongs in contracts/; ' +
        'shared judgment belongs in exactly one capability.',
      severity: 'error',
      from: { pathNot: 'node_modules' },
      to: { circular: true }
    }
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.ts$' }
  }
};
