/**
 * What an import is allowed to conclude, and what it must refuse to.
 *
 * The smoke test already proves `extract_cv` walks — plan, steps, aggregate, a
 * terminal run row with its events. What it cannot prove is any of the domain
 * judgment, because it answers every step from the step's own schema and every
 * string it produces is the same placeholder. This file supplies real strings,
 * and every assertion is about a rule that was written in response to a
 * measured failure rather than an imagined one.
 *
 * Two of those rules are the reason the file exists at all. A technology must
 * never become a spoken language or a certificate — both were observed against
 * a real CV, repeatedly, and both guards are silent when they work. And an
 * import that finds nothing must fail rather than save an empty document,
 * except when the caller narrowed the run to one section, where finding nothing
 * is the correct answer.
 *
 * The indexing tests at the bottom are about a different kind of judgment: what
 * a CV is worth searching for, and what should be read off it instead. That one
 * is silent in both directions — a field indexed by mistake never fails, it
 * just crowds out better neighbours.
 *
 * Mutations run, not assumed. Each was applied, the whole suite run, the
 * failures counted, and the mutation reverted:
 *
 *   `NOT_SPOKEN` emptied                    1  a technology never becomes …
 *   the technical cross-check dropped       3  a technology never becomes … /
 *                                              a section run alone … /
 *                                              a second import adds …
 *   `known_skills` ignored by `assemble`    1  a section run alone …
 *   the `present` sentinel not converted    1  a run merges what the steps …
 *   the empty-entry filter removed          2  a run merges what the steps … /
 *                                              a second import adds …
 *   `isEmpty` dropped entirely              1  nothing extractable is a failure
 *   `isEmpty` stops checking `sections`     1  a named section that finds …
 *   a skipped source fails the read step    2  one unreadable source among … /
 *                                              no readable source at all …
 *   the read step tolerates an empty corpus 1  no readable source at all …
 *   `persist: false` writes anyway          2  a section run alone … /
 *                                              a preview leaves no document
 *   the index step made critical            1  an embedder that is down …
 *   a preview is indexed anyway             1  a preview indexes nothing
 *   `aggregate` drops the index outcome     3  what gets indexed … / a second
 *                                              import … / a CV with no prose …
 *   pieces lose their employer context      1  what gets indexed …
 *   pieces include the contact details      3  what gets indexed … / a second
 *                                              import … / a CV with no prose …
 *   the fingerprint stops recording l2      2  the index records what … /
 *                                              (one in the retrieval suite)
 *   `MIN_LENGTH` stops dropping anything    2  what gets indexed … /
 *                                              a second import …
 *
 * One mutation survives, recorded rather than papered over: emptying the
 * `clear` branch kills nothing. Nothing here can reach it, because merging
 * never removes — a CV's prose can appear and change but not vanish, so the
 * branch's own case is unreachable through an import. It is called on every
 * prose-free import and removes zero rows. The day it removes something is the
 * day a capability exists that can delete an experience entry, and the test
 * belongs beside that capability.
 *
 * The number that matters most is one none of these rows shows: the smoke suite
 * killed **nothing**. All eighteen mutations leave `extract_cv` planning,
 * walking, aggregating and checkpointing exactly as before — which is the
 * honest limit of a rung whose answers come from the schemas themselves, and
 * the reason this file is not redundant with it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { inputSchema } from '../src/capabilities/cv/extract.js';
import { CV_ID, asCvDocument } from '../src/capabilities/cv/document.js';
import { RuntimeError } from '../src/contracts/index.js';
import { startRun } from '../src/runtime/run.js';
import { objectsFrom, spine, type Spine } from './support/spine.js';
import type {
  AiGateway,
  EffectSet,
  ObjectRequest,
  ObjectResult,
  SourceInput,
  SourceText
} from '../src/contracts/index.js';

/* ---------------------------------------------------------------- fixtures */

const CV_TEXT = [
  'Ada Lovelace',
  'ada@example.test · Warszawa',
  '',
  'Summary',
  '',
  'Backend engineer with eight years on payment systems, mostly TypeScript and',
  'PostgreSQL. Comfortable owning a service end to end, from schema to on-call.',
  '',
  'Experience'
].join('\n');

/**
 * One answer per step, written to carry the two failures that were measured.
 *
 * `React` appears in `frameworks` *and* in the languages answer; `ICP
 * Blockchain SDK` appears in `libraries_and_tools` *and* in the certificates
 * answer. Neither is invented for the test — both are what a small local model
 * returned from a real CV, and each is caught by a different mechanism, which
 * is why both are here. `Javascript` is the third case: nothing else in the run
 * mentions it, so only the fixed list can reject it.
 */
const ANSWERS: Readonly<Record<string, Record<string, unknown>>> = {
  personal: {
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    phone: '',
    location: 'Warszawa',
    links: [
      { name: 'github', url: 'https://github.test/ada' },
      // A link with no name is not a link. It should not become `{'': url}`.
      { name: '', url: 'https://nowhere.test' }
    ]
  },
  skills: {
    role: 'Backend Engineer',
    programming_languages: ['TypeScript'],
    frameworks: ['React'],
    libraries_and_tools: ['ICP Blockchain SDK']
  },
  experience: {
    experience: [
      {
        company: 'Acme',
        title: 'Senior Engineer',
        started: '2019-03',
        finished: 'present',
        // The second is under `MIN_LENGTH`. Real CVs are full of these, and
        // they match every query about process while distinguishing nothing.
        highlights: ['Rewrote the billing pipeline.', 'Agile'],
        skills: ['TypeScript']
      },
      {
        company: 'Globex',
        title: 'Engineer',
        started: '2016',
        finished: '2019-02',
        highlights: [],
        skills: []
      },
      // The model filling the array because the schema said array.
      { company: '', title: '', started: '', finished: '', highlights: ['orphan'], skills: [] }
    ]
  },
  education: {
    education: [
      { university: 'Cambridge', degree: 'MSc', started: '2012', finished: '2016', thesis: '', mark: '' }
    ]
  },
  certificates: {
    certificates: [
      { name: 'CKA', issuer: 'CNCF', started: '2022', finished: '' },
      { name: 'ICP Blockchain SDK', issuer: '', started: '', finished: '' }
    ]
  },
  languages: {
    languages: [
      { name: 'Polish', level: 'native' },
      { name: 'Javascript', level: '' },
      { name: 'React', level: 'Proficient' }
    ]
  }
};

const textSource = { kind: 'text', label: 'cv.txt', text: CV_TEXT };

/** Records what it was handed, so a test can assert the bytes survived. */
type Reader = Pick<EffectSet, 'sources'> & { readonly seen: SourceInput[] };

const reader = (options: { unreadable?: readonly string[] } = {}): Reader => {
  const seen: SourceInput[] = [];
  const unreadable = new Set(options.unreadable ?? []);

  return {
    seen,
    sources: {
      read: async (input): Promise<SourceText> => {
        seen.push(input);

        if (input.kind === 'text') return { text: input.text, via: 'plain' };

        if (unreadable.has(input.mime)) {
          throw new RuntimeError(`Nothing could be read from ${input.mime}.`, 'unreadable_source');
        }

        return { text: `Transcribed from ${input.mime}.`, via: 'ocr' };
      }
    }
  };
};

/**
 * Vectors without a model: three dimensions, derived from the text.
 *
 * Deliberately not constant. Identical vectors would let `replace` write rows
 * that violate the dimension check in exactly the same way whatever the input
 * is, and would make a mixed-up pairing of chunk to vector undetectable — which
 * is the failure `embedChunks` counts vectors to catch.
 */
const embedder = (): AiGateway['embed'] => async (request) => ({
  vectors: request.values.map((value) => {
    const size = Math.hypot(value.length, 1, 1) || 1;
    return Float32Array.from([value.length / size, 1 / size, 1 / size]);
  }),
  provider: 'test',
  model: 'stub-embed',
  dim: 3
});

const harness = async <T>(
  options: {
    answers?: Readonly<Record<string, Record<string, unknown>>>;
    reader?: Reader;
    /** Replaces the working embedder, for the test that takes it away. */
    embed?: AiGateway['embed'];
  },
  body: (s: Spine, reader: Reader) => Promise<T>
): Promise<T> => {
  const answers = options.answers ?? ANSWERS;
  const sources = options.reader ?? reader();

  const s = spine(capabilities, {
    ai: {
      generateObject: objectsFrom((step) => answers[step] ?? {}),
      embed: options.embed ?? embedder()
    },
    effects: { sources: sources.sources }
  });

  try {
    return await body(s, sources);
  } finally {
    s.dispose();
  }
};

const importCv = (s: Spine, input: Record<string, unknown>) =>
  startRun(s.deps, { capability: 'extract_cv', input });

const stored = (s: Spine) => {
  const record = s.deps.documents.read(CV_ID);
  return record ? asCvDocument(record.body) : undefined;
};

/* ------------------------------------------------------------- the document */

test('a run merges what the steps found into the stored document', async () => {
  await harness({}, async (s) => {
    const result = await importCv(s, { sources: [textSource] });
    const document = stored(s);

    assert.equal(result.data.persisted, true);
    assert.equal(result.data.revision, 1);

    assert.equal(document?.personal.name, 'Ada Lovelace');
    assert.equal(document?.personal.location, 'Warszawa');
    assert.deepEqual(document?.personal.links, { github: 'https://github.test/ada' });

    // Parsed out of the corpus by `findSummary`, not produced by the gateway —
    // the gateway is answering every other step and would have said "sample".
    assert.match(document?.role_description ?? '', /^Backend engineer with eight years/);

    assert.equal(document?.skills.role, 'Backend Engineer');

    // The nameless third entry is gone; the sentinel became `null`; a real end
    // date stayed a string.
    assert.equal(document?.experience.length, 2);
    assert.equal(document?.experience[0]?.finished, null, 'the "present" sentinel was not converted');
    assert.equal(document?.experience[1]?.finished, '2019-02');

    assert.equal(document?.education[0]?.university, 'Cambridge');
    assert.deepEqual(document?.sources.map((source) => source.reference), ['cv.txt']);
    assert.equal(document?.sources[0]?.kind, 'plain');
  });
});

test('a technology never becomes a certificate or a spoken language', async () => {
  await harness({}, async (s) => {
    await importCv(s, { sources: [textSource] });
    const document = stored(s);

    assert.deepEqual(
      document?.certificates.map((entry) => entry.name),
      ['CKA'],
      'a line from the tools list was saved as a certificate'
    );
    assert.deepEqual(
      document?.languages.map((entry) => entry.name),
      ['Polish'],
      'a programming language was saved as a language the person speaks'
    );
  });
});

test('a section run alone keeps the guards, but only if told what the skills are', async () => {
  // The regression that `known_skills` exists for. Asked for certificates on
  // their own, the run has no skills step to cross-check against, so the guard
  // that caught `ICP Blockchain SDK` has nothing to catch it with — unless the
  // caller passes back what it already knows.
  await harness({}, async (s) => {
    const blind = await importCv(s, {
      sources: [textSource],
      sections: ['certificates'],
      persist: false
    });

    const told = await importCv(s, {
      sources: [textSource],
      sections: ['certificates'],
      persist: false,
      known_skills: ['ICP Blockchain SDK']
    });

    const names = (result: { data: Record<string, unknown> }): string[] =>
      (result.data.document as { certificates: { name: string }[] }).certificates.map((c) => c.name);

    assert.deepEqual(names(blind), ['CKA', 'ICP Blockchain SDK']);
    assert.deepEqual(names(told), ['CKA'], 'known_skills did not reach the guard');
  });
});

test('a preview leaves no document behind', async () => {
  await harness({}, async (s) => {
    const result = await importCv(s, { sources: [textSource], persist: false });

    assert.equal(result.data.persisted, false);
    assert.equal(result.data.revision, null);
    assert.equal(stored(s), undefined, 'a preview wrote the document');

    // Still a full answer, so a caller can show it before deciding to keep it.
    assert.equal((result.data.document as { personal: { name: string } }).personal.name, 'Ada Lovelace');
  });
});

test('a second import adds rather than duplicates', async () => {
  await harness({}, async (s) => {
    await importCv(s, { sources: [textSource] });
    const second = await importCv(s, { sources: [textSource] });
    const document = stored(s);

    assert.equal(second.data.revision, 2);
    assert.equal(document?.experience.length, 2, 'the same two jobs were saved twice');
    assert.equal(document?.certificates.length, 1);

    // Provenance is the one append-only part: two imports happened.
    assert.equal(document?.sources.length, 2);
  });
});

/* --------------------------------------------------------------- the guards */

test('nothing extractable is a failure, not an empty CV', async () => {
  await harness({ answers: {} }, async (s) => {
    await assert.rejects(
      () => importCv(s, { sources: [{ kind: 'text', text: 'A shopping list.' }] }),
      /Nothing could be extracted/
    );

    assert.equal(stored(s), undefined, 'an empty document was saved anyway');
  });
});

test('a named section that finds nothing is not a failed import', async () => {
  // The same emptiness, and the opposite conclusion. Asking only for
  // certificates, from a CV that has none, is a correct answer that looks
  // identical to a failed import — so the guard may not fire here.
  await harness({ answers: { certificates: { certificates: [] } } }, async (s) => {
    const result = await importCv(s, {
      sources: [{ kind: 'text', text: 'A CV with no certificates on it.' }],
      sections: ['certificates']
    });

    assert.equal(result.data.persisted, true);
    assert.deepEqual(stored(s)?.certificates, []);
  });
});

/* -------------------------------------------------------------- the sources */

test('one unreadable source among several is a skip, not a failure', async () => {
  await harness({ reader: reader({ unreadable: ['image/png'] }) }, async (s) => {
    const result = await importCv(s, {
      sources: [
        textSource,
        { kind: 'bytes', label: 'profile.png', mime: 'image/png', base64: 'AAAA' }
      ]
    });

    assert.deepEqual(
      (result.data.skipped as { reference: string }[]).map((entry) => entry.reference),
      ['profile.png']
    );
    assert.equal(stored(s)?.personal.name, 'Ada Lovelace', 'the readable source was dropped too');
    assert.deepEqual(stored(s)?.sources.map((source) => source.reference), ['cv.txt']);
  });
});

test('no readable source at all is unreadable_source, not a bad extraction', async () => {
  await harness({ reader: reader({ unreadable: ['image/png'] }) }, async (s) => {
    await assert.rejects(
      () =>
        importCv(s, {
          sources: [{ kind: 'bytes', label: 'profile.png', mime: 'image/png', base64: 'AAAA' }]
        }),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeError, `not a RuntimeError: ${String(error)}`);
        assert.equal(error.code, 'unreadable_source');
        assert.match(error.message, /profile\.png/, 'the message does not say which source');
        return true;
      }
    );
  });
});

test('bytes survive the round trip through the run input', async () => {
  const original = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

  await harness({ reader: reader() }, async (s, sources) => {
    await importCv(s, {
      sources: [
        { kind: 'bytes', label: 'shot.png', mime: 'image/png', base64: Buffer.from(original).toString('base64') }
      ]
    });

    const seen = sources.seen[0];
    assert.equal(seen?.kind, 'bytes');
    assert.deepEqual(
      seen?.kind === 'bytes' ? [...seen.bytes] : [],
      [...original],
      'base64 did not decode back to the bytes that went in'
    );

    // A vision reading is recorded as one. `plain` here would claim the text
    // was copied out of the file rather than guessed at by a model.
    assert.equal(stored(s)?.sources[0]?.kind, 'ocr');
  });
});

test('a base64 field that is not base64 is refused at the boundary', () => {
  // `Buffer.from(s, 'base64')` drops what it does not recognise, so without a
  // shape check garbage decodes to an empty file and the run reports "that
  // source was empty" instead of "that was not base64".
  const parsed = inputSchema.safeParse({
    sources: [{ kind: 'bytes', mime: 'image/png', base64: 'not base64!' }]
  });

  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues[0]?.message ?? '', /base64/i);
});

test('the capability is registered under the name its plan claims', () => {
  assert.equal(capabilities.extract_cv?.name, 'extract_cv');
});

/* ------------------------------------------------------------- the index */

/** Every chunk stored for the CV, by a query broad enough to match all of them. */
const indexed = (s: Spine) =>
  s.chunks.lexical({
    text: 'engineer billing pipeline systems agile cambridge polish ada',
    documentId: CV_ID,
    limit: 50
  });

test('what gets indexed is the prose, not the fields that are looked up', async () => {
  await harness({}, async (s) => {
    const result = await importCv(s, { sources: [textSource] });

    // The summary and one highlight. Globex has no highlights, and the entry
    // with no company and no title never reached the document — so its
    // 'orphan' highlight cannot reach the index either.
    assert.equal(result.data.indexed, 2);

    const texts = indexed(s).map((hit) => hit.text);
    assert.equal(texts.length, 2);

    // A bullet does not name its own employer, so the employer is prepended
    // before embedding. Without it, "React work at an e-commerce company"
    // matches on nothing.
    assert.ok(
      texts.some((text) => text === 'Senior Engineer at Acme: Rewrote the billing pipeline.'),
      `no contextualised highlight in ${JSON.stringify(texts)}`
    );

    // Contact details, dates, degrees and certificate issuers are read off the
    // document. Indexing them would give every query a set of short,
    // high-scoring, uninformative neighbours to beat.
    const all = texts.join(' ');
    // 'Agile' is the other kind of exclusion: it is a real highlight on the
    // document, and it is dropped for being too short to distinguish anything.
    for (const absent of ['ada@example.test', 'Cambridge', 'CKA', '2019-03', 'Polish', 'Agile']) {
      assert.ok(!all.includes(absent), `${absent} was indexed`);
    }
  });
});

test('the index records what produced its vectors', async () => {
  await harness({}, async (s) => {
    await importCv(s, { sources: [textSource] });

    // Without this stored beside the chunks, a model swap leaves vectors that
    // still have the right width and still answer queries, wrongly.
    assert.deepEqual(s.chunks.fingerprintOf(CV_ID), {
      provider: 'test',
      model: 'stub-embed',
      dim: 3,
      normalisation: 'l2',
      chunkerVersion: 1
    });
  });
});

test('a preview indexes nothing', async () => {
  await harness({}, async (s) => {
    const result = await importCv(s, { sources: [textSource], persist: false });

    // `null`, not `0`: nobody tried. Indexing a preview would make search
    // answer from a document that was never written.
    assert.equal(result.data.indexed, null);
    assert.deepEqual(indexed(s), []);

    // The load-bearing half of this test. Without the guard the index write is
    // still refused — `chunks.document_id` has nowhere to point — but it is
    // refused as a degraded step, and a preview that reports damage is a
    // preview nobody trusts.
    assert.deepEqual([...result.degraded], []);
  });
});

test('a second import replaces the index rather than adding to it', async () => {
  await harness({}, async (s) => {
    await importCv(s, { sources: [textSource] });
    const second = await importCv(s, { sources: [textSource] });

    // The same CV merges into the same document, so the same two pieces come
    // back out. Upserting instead of replacing would leave the first run's
    // rows behind whenever a re-chunk produced fewer of them.
    assert.equal(second.data.indexed, 2);
    assert.equal(indexed(s).length, 2);
  });
});

test('an embedder that is down costs search, not the import', async () => {
  await harness(
    {
      embed: async () => {
        throw new Error('embedding server refused the connection');
      }
    },
    async (s) => {
      const result = await importCv(s, { sources: [textSource] });

      // The document is already saved by the time indexing runs, which is the
      // whole reason it is a separate, non-critical step: losing search over an
      // import is not a reason to lose the import.
      assert.deepEqual([...result.degraded], ['index']);
      assert.equal(result.data.persisted, true);
      assert.equal(stored(s)?.personal.name, 'Ada Lovelace');

      // `null` rather than `0`. A broken embedder is not an empty CV.
      assert.equal(result.data.indexed, null);
      assert.deepEqual(indexed(s), []);
    }
  );
});

test('a CV with no prose in it is indexed as nothing, not as a failure', async () => {
  const bare = {
    ...ANSWERS,
    experience: {
      experience: [
        { company: 'Acme', title: 'Senior Engineer', started: '2019-03', finished: 'present',
          highlights: [], skills: [] }
      ]
    }
  };

  // No `Summary` heading, so `findSummary` finds nothing and there is no
  // role description to index either.
  const noSummary = { kind: 'text', label: 'cv.txt', text: 'Ada Lovelace\nada@example.test\n\nExperience' };

  await harness({ answers: bare }, async (s) => {
    const result = await importCv(s, { sources: [noSummary] });

    assert.equal(result.data.persisted, true);
    assert.equal(result.data.indexed, 0);
    assert.deepEqual([...result.degraded], []);
  });
});

/* --------------------------------------------------------- the corpus seam */

/** Captures what each extraction step was actually asked to read. */
const promptCapture = (): { prompts: string[]; generateObject: AiGateway['generateObject'] } => {
  const prompts: string[] = [];
  const answer = objectsFrom((step) => ANSWERS[step] ?? {});
  return {
    prompts,
    generateObject: async <T>(request: ObjectRequest<T>): Promise<ObjectResult<T>> => {
      prompts.push(request.prompt);
      return answer(request);
    }
  };
};

test('two sources are labelled where they meet, one is not', async () => {
  const capture = promptCapture();
  const s = spine(capabilities, {
    ai: { generateObject: capture.generateObject, embed: embedder() },
    effects: { sources: reader().sources }
  });

  try {
    await startRun(s.deps, {
      capability: 'extract_cv',
      input: {
        sources: [
          textSource,
          { kind: 'text', label: 'linkedin profile', text: 'Ada Lovelace — Analytical Engines' }
        ]
      }
    });

    const corpus = capture.prompts[0] ?? '';
    // The label is a boundary. A model reading a wall of concatenated text
    // merges employers across the join; one reading the marker does not.
    assert.ok(corpus.includes('=== SOURCE: cv.txt ==='), corpus.slice(0, 200));
    assert.ok(corpus.includes('=== SOURCE: linkedin profile ==='));
  } finally {
    s.dispose();
  }

  const single = promptCapture();
  const one = spine(capabilities, {
    ai: { generateObject: single.generateObject, embed: embedder() },
    effects: { sources: reader().sources }
  });

  try {
    await startRun(one.deps, { capability: 'extract_cv', input: { sources: [textSource] } });

    // One source has no boundary to mark, and the line would cost one of the
    // forty `findSummary` reads before giving up.
    assert.ok(!(single.prompts[0] ?? '').includes('=== SOURCE:'));
  } finally {
    one.dispose();
  }
});
