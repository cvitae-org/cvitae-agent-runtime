/**
 * Ranking: what the two halves each find, and what happens when they disagree.
 *
 * Split in two on purpose. The fusion tests run against a fake reader, because
 * the property under test is "a chunk both halves rank mid beats one a single
 * half ranks first" and that needs the two rank orders controlled exactly. The
 * folding tests run against the real SQLite index, because the thing being
 * checked is what FTS5 does with Polish, and a fake would only assert what this
 * file already believes.
 *
 * The `ł` test is not a curiosity. `remove_diacritics 2` folds every Polish
 * letter that decomposes into a base plus a combining mark — ą ć ę ń ó ś ź ż
 * all fold — but U+0142 is a distinct letter with a stroke and has no NFD
 * decomposition, so there is no diacritic to remove. Measured: `żółw` indexes
 * as `zołw`, and `MATCH 'zolw'` returns nothing. Polish users routinely type
 * ASCII when they have no Polish layout, so that is a live recall hole rather
 * than a trivium.
 *
 * Confirmed by breaking things. Making `foldForSearch` the identity fails the
 * `ł` test and leaves the eight-letter test green, which is the whole claim in
 * two halves: those eight are the tokenizer's work, `ł` is this function's.
 * The two tests report every query that missed rather than stopping at the
 * first, because "which letters" is the answer either one exists to give.
 * Dropping the fingerprint filter from `neighbours` makes the model-swap test
 * return hits marked `vector` that were embedded by a different model.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AiGateway,
  ChunkReader,
  EmbedRequest,
  EmbeddingFingerprint,
  Retriever,
  ScoredChunk
} from '../src/contracts/index.js';
import { RuntimeError } from '../src/contracts/index.js';
import { createRetriever } from '../src/retrieval/search.js';
import { CHUNKER_VERSION } from '../src/retrieval/fingerprint.js';
import { createChunkIndex } from '../src/storage/sqlite/chunk-index.js';
import { scratch, seedDocument } from './support/db.js';

const signal = new AbortController().signal;

const DIM = 16;

/**
 * A deterministic stand-in for an embedding model: tokens hashed into buckets,
 * then L2-normalised, exactly as the real gateway normalises. Two texts sharing
 * words end up near each other, which is all these tests need of it.
 */
const bagOfWords = (text: string): Float32Array => {
  const vector = new Float32Array(DIM);

  for (const token of text.toLowerCase().split(/\W+/u).filter(Boolean)) {
    let hash = 0;
    for (let index = 0; index < token.length; index += 1) {
      hash = (Math.imul(hash, 31) + token.charCodeAt(index)) >>> 0;
    }
    vector[hash % DIM] = (vector[hash % DIM] ?? 0) + 1;
  }

  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (length > 0) for (let i = 0; i < DIM; i += 1) vector[i] = (vector[i] ?? 0) / length;

  return vector;
};

const stubEmbedder = (provider = 'local', model = 'nomic-embed') => {
  const asked: string[][] = [];

  const ai = {
    embed: async (request: EmbedRequest) => {
      asked.push([...request.values]);
      return {
        vectors: request.values.map(bagOfWords),
        provider,
        model,
        dim: DIM
      };
    }
  } as unknown as AiGateway;

  return { ai, asked };
};

const fingerprint = (model = 'nomic-embed'): EmbeddingFingerprint => ({
  provider: 'local',
  model,
  dim: DIM,
  normalisation: 'l2',
  chunkerVersion: CHUNKER_VERSION
});

/* ------------------------------------------------------------- the fusion */

const scored = (id: string, score: number): ScoredChunk => ({
  id,
  documentId: 'cv-1',
  kind: 'highlight',
  text: `text of ${id}`,
  position: 0,
  meta: {},
  score
});

/** Two hand-ordered lists, so rank is the only variable. */
const fakeReader = (lexical: ScoredChunk[], vector: ScoredChunk[]): ChunkReader => ({
  lexical: () => lexical,
  neighbours: () => vector,
  fingerprintOf: () => fingerprint()
});

test('agreement between the two halves beats a single strong opinion', async () => {
  // `agreed` is third in both lists. `lexOnly` is first in one and absent from
  // the other. Any blend of the raw scores would put lexOnly on top.
  const reader = fakeReader(
    [scored('lexOnly', 99), scored('b', 5), scored('agreed', 4)],
    [scored('vecOnly', 0.99), scored('c', 0.5), scored('agreed', 0.4)]
  );

  const retriever = createRetriever({ reader, ai: stubEmbedder().ai, traceId: 'trace-1' });
  const hits = await retriever.search({ text: 'react work', limit: 3 }, signal);

  assert.equal(hits[0]?.id, 'agreed');
  assert.deepEqual(hits[0]?.found, ['lexical', 'vector']);

  // And the two single-half firsts follow, tied on rank and broken by id.
  assert.deepEqual(hits.slice(1).map((hit) => hit.id).sort(), ['lexOnly', 'vecOnly']);
});

test('a hit says which halves found it', async () => {
  const reader = fakeReader([scored('a', 5)], [scored('b', 0.9)]);
  const retriever = createRetriever({ reader, ai: stubEmbedder().ai, traceId: 'trace-1' });

  const hits = await retriever.search({ text: 'react', limit: 5 }, signal);
  const found = new Map(hits.map((hit) => [hit.id, hit.found]));

  assert.deepEqual(found.get('a'), ['lexical']);
  assert.deepEqual(found.get('b'), ['vector']);
});

test('lexicalOnly asks no model anything', async () => {
  const embedder = stubEmbedder();
  const reader = fakeReader([scored('a', 5)], [scored('b', 0.9)]);
  const retriever = createRetriever({ reader, ai: embedder.ai, traceId: 'trace-1' });

  const hits = await retriever.search({ text: 'react', limit: 5, lexicalOnly: true }, signal);

  assert.deepEqual(embedder.asked, []);
  assert.deepEqual(hits.map((hit) => hit.id), ['a']);
});

test('a query the embedder cannot take is searched by keyword; a cancelled one is not searched', async () => {
  const reader = fakeReader([scored('a', 5)], [scored('b', 0.9)]);
  const refusing = {
    embed: async () => { throw new RuntimeError('the provider refused the key', 'credential_rejected'); }
  } as unknown as AiGateway;

  const hits = await createRetriever({ reader, ai: refusing, traceId: 'trace-1' })
    .search({ text: 'react', limit: 5 }, signal);

  assert.deepEqual(hits.map((hit) => [hit.id, hit.found]), [['a', ['lexical']]]);

  const cancel = new AbortController();
  const cancelled = {
    embed: async () => { cancel.abort(); throw new Error('aborted'); }
  } as unknown as AiGateway;

  await assert.rejects(
    createRetriever({ reader, ai: cancelled, traceId: 'trace-1' }).search({ text: 'react', limit: 5 }, cancel.signal),
    /aborted/
  );
});

test('an empty query is not a search', async () => {
  const embedder = stubEmbedder();
  const reader = fakeReader([scored('a', 5)], [scored('b', 0.9)]);
  const retriever = createRetriever({ reader, ai: embedder.ai, traceId: 'trace-1' });

  assert.deepEqual(await retriever.search({ text: '   ', limit: 5 }, signal), []);
  assert.deepEqual(embedder.asked, []);
});

test('the pool the halves are asked for is deeper than the limit', async () => {
  const asked: number[] = [];

  const reader: ChunkReader = {
    lexical: (query) => {
      asked.push(query.limit);
      return [];
    },
    neighbours: (query) => {
      asked.push(query.limit);
      return [];
    },
    fingerprintOf: () => fingerprint()
  };

  const retriever = createRetriever({ reader, ai: stubEmbedder().ai, traceId: 'trace-1' });

  await retriever.search({ text: 'react', limit: 10 }, signal);

  // Fusion needs candidates below the cut, or a chunk both halves rank just
  // outside the limit is invisible to exactly the mechanism meant to promote it.
  assert.deepEqual(asked, [40, 40]);
});

/* ------------------------------------------------- the index, for real */

const indexed = (
  s: ReturnType<typeof scratch>,
  texts: readonly string[],
  model = 'nomic-embed'
) => {
  const index = createChunkIndex(s.db);

  seedDocument(s.db);

  index.replace(
    'cv-1',
    fingerprint(model),
    texts.map((text, position) => ({
      id: `c${position}`,
      kind: 'highlight',
      text,
      position,
      meta: {},
      vector: bagOfWords(text)
    }))
  );

  return index;
};

const POLISH = [
  // ł in four positions. None of these fold in the tokenizer.
  'Wdrożyłem żółw oraz zespół w Łodzi dla platformy internetowej',
  // ą ć ę ń ó ś ź ż, and not one ł. All eight decompose, so the tokenizer
  // handles them and `foldForSearch` never sees them.
  'Zarządzanie gęstą siecią późno w Gdańsku ćwiczenia żagle ósemka ściśle'
];

/** Every query that missed, rather than only the first — the list is the point. */
const missing = async (
  retriever: Retriever,
  queries: readonly string[],
  expected: string
): Promise<string[]> => {
  const missed: string[] = [];

  for (const query of queries) {
    const hits = await retriever.search({ text: query, limit: 5, lexicalOnly: true }, signal);
    if (hits[0]?.id !== expected) missed.push(query);
  }

  return missed;
};

test('ASCII input matches the letter the tokenizer cannot fold', async () => {
  const s = scratch();

  try {
    const retriever = createRetriever({
      reader: indexed(s, POLISH),
      ai: stubEmbedder().ai,
      traceId: 'trace-1'
    });

    // U+0142 is a letter with a stroke, not a base plus a combining mark, so
    // `remove_diacritics 2` has nothing to remove and leaves it. Without
    // `foldForSearch` on both sides, none of these four reach the chunk.
    assert.deepEqual(
      await missing(retriever, ['zolw', 'wdrozylem', 'zespol', 'lodzi'], 'c0'),
      []
    );
  } finally {
    s.dispose();
  }
});

test('ASCII input matches the eight letters the tokenizer does fold', async () => {
  const s = scratch();

  try {
    const retriever = createRetriever({
      reader: indexed(s, POLISH),
      ai: stubEmbedder().ai,
      traceId: 'trace-1'
    });

    // Read by the test rather than by eye: `źródeł` and `źródła` both looked
    // like clean examples and both carry a stroke.
    assert.ok(!POLISH[1]?.includes('ł'), 'the ł-free fixture is not ł-free');

    // The complement of the test above, and the reason the fix is two
    // characters wide rather than a tokenizer plugin: everything else already
    // works.
    assert.deepEqual(
      await missing(
        retriever,
        ['zarzadzanie', 'gesta', 'pozno', 'gdansku', 'cwiczenia', 'zagle', 'osemka', 'scisle'],
        'c1'
      ),
      []
    );
  } finally {
    s.dispose();
  }
});

test('the Polish spelling still matches itself', async () => {
  const s = scratch();

  try {
    const index = indexed(s, ['Wdrożyłem żółw w zespole', 'Databases and caching']);
    const retriever = createRetriever({ reader: index, ai: stubEmbedder().ai, traceId: 'trace-1' });

    // Folding the query must not cost the exact spelling its own match — the
    // stored text is folded the same way, which is what keeps both directions
    // working.
    const hits = await retriever.search({ text: 'żółw', limit: 5, lexicalOnly: true }, signal);

    assert.equal(hits[0]?.id, 'c0');
  } finally {
    s.dispose();
  }
});

test('a query FTS5 would read as an expression is searched as words', async () => {
  const s = scratch();

  try {
    const index = indexed(s, ['Worked on search AND ranking for the platform team']);
    const retriever = createRetriever({ reader: index, ai: stubEmbedder().ai, traceId: 'trace-1' });

    // Bare, these are FTS5 operators and a syntax error. Quoted per token they
    // are three words.
    const hits = await retriever.search(
      { text: 'search AND ranking*', limit: 5, lexicalOnly: true },
      signal
    );

    assert.equal(hits.length, 1);
  } finally {
    s.dispose();
  }
});

test('vectors from another model are not ranked against this query', async () => {
  const s = scratch();

  try {
    // Indexed by one model, queried through another. The dimensions match, so
    // nothing crashes; the numbers are simply from a different space.
    const index = indexed(s, ['Zbudowałem system rekomendacji'], 'old-embedder');

    const retriever = createRetriever({
      reader: index,
      ai: stubEmbedder('local', 'new-embedder').ai,
      traceId: 'trace-1'
    });

    const hits = await retriever.search({ text: 'system rekomendacji', limit: 5 }, signal);

    // The lexical half still answers. The vector half finds nothing, and says
    // so — no hit comes back claiming a vector found it.
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0]?.found, ['lexical']);

    assert.equal(index.fingerprintOf('cv-1')?.model, 'old-embedder');
  } finally {
    s.dispose();
  }
});

test('both halves find the same chunk when the query is a good one', async () => {
  const s = scratch();

  try {
    const index = indexed(s, [
      'Built a recommendation system with TypeScript and Node',
      'Ran the hiring process for the platform team'
    ]);

    const retriever = createRetriever({ reader: index, ai: stubEmbedder().ai, traceId: 'trace-1' });
    const hits = await retriever.search({ text: 'recommendation system', limit: 5 }, signal);

    assert.equal(hits[0]?.id, 'c0');
    assert.deepEqual(hits[0]?.found, ['lexical', 'vector']);
  } finally {
    s.dispose();
  }
});
