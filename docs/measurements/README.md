# Measurements

How well a real model does with what the runtime sends it. The tests check what
is sent; these check what comes back. Each one is a script run by hand against a
local model, never in CI, with the raw answers kept beside it.

Each folder holds:

- `measure.mts`: the script, as it was run
- `results.json`: every answer, with what it was scored on
- `run.txt`: the lines it printed

To run one again, from the repository root, with Ollama serving the model and
Node 24 on the path:

```bash
node --import tsx docs/measurements/step-4-assembly/measure.mts "$PWD" /tmp/out.json
```

The script header says which settings it reads. Every run uses the GPU for a
while; the header says roughly how long.

## Step 4: pieces attached to a message

2026-10-09, `gemma4:12b` through Ollama, runtime at `f75f129`.
[Folder](step-4-assembly/).

The question: does a message answered from the CV pieces attached to it do as
well as one where the model looks things up with its own tools?

One CV, indexed as the app indexes it. Four questions (the Acme job, the Globex
job, the level of English, education), each in English and Polish, each asked
in four ways, three rounds: 96 chats, each a fresh conversation. An answer is
correct when it holds the facts asked for and none of the wrong facts set as
traps.

| Way | English | Polish | Median seconds (en / pl) |
|---|---|---|---|
| tools only, as before | 12/12 | 12/12 | 12 / 15 |
| piece attached, tools still offered | 12/12 | 12/12 | 13 / 14 |
| piece attached, `reach: selected` (no tools) | 12/12 | 12/12 | 6 / 10.5 |
| `auto: on` | 8/12 | 6/12 | 13 / 18.5 |

- Attached pieces answer as well as tools, and with no tools offered they are
  the fastest.
- `auto` was right on the two jobs every time and on languages and education 2
  times in 12. The search index holds only job bullets and the role description
  (`src/retrieval/chunk.ts`), so `auto` handed the model the two jobs, and the
  model took them for the whole CV and said there was nothing on the subject.
  In English it called `read_cv` 2 times in 6; in Polish never.
- No answer in any way held a wrong fact. Every miss was a wrong "the CV does
  not say".

Decided: `auto` stays off, and `reach: selected` stays.

## Step 6: comparing saved offers

2026-10-09, `gemma4:12b` through Ollama's OpenAI endpoint, as the app calls it,
runtime at `f75f129` (the card before the contract label was fixed).
[Folder](step-6-offers/).

The question: given five saved offers, a CV and preferences, does the model put
the best fit first and the partial fit before the ones that do not fit, and when
asked to cite, do its `[n]` numbers stand for blocks it was given and say what
those blocks say?

Five offers (one clear fit, one partial fit that breaks two preferences, three
that do not fit), one CV, "remote, no on-call, B2B". English and Polish, `cite`
off and on, 8 chats each: 32, each a fresh runtime.

| | best first | partial before the rest | used numbers | unresolved numbers | median seconds |
|---|---|---|---|---|---|
| English, cite off | 8/8 | 8/8 | | | 248 |
| English, cite on | 8/8 | 8/8 | 8/8 | 0 of 238 | 346 |
| Polish, cite off | 8/8 | 8/8 | | | 140 |
| Polish, cite on | 8/8 | 8/8 | 8/8 | 0 of 253 | 216 |

- No empty answer and no failure in 32. The attempt of 2026-10-06 got empty
  text in 14 of 26; it called Ollama's own `/api/chat` with an 8,192-token
  window instead of the OpenAI endpoint the app uses, which most likely
  explains it (not tested separately).
- With cite on, a word check counts 203 of 238 English numbers and 169 of 253
  Polish ones as sitting in a sentence that shares a name, skill or preference
  with the block. That is a floor: of 15 Polish numbers it rejected, read by hand,
  14 cited the right block ("preferencji [1]" for the preferences, "hybrydową
  [3]" for the hybrid offer) and one sentence was too short to judge. The check
  misses Polish endings and the English words of a card.
- With cite on, an answer may name offers only by number ("Offer [2]"); the
  table counts those as the offer, so it was tallied again from `results.json`
  and differs from the `first=` in `run.txt` for one chat.
- Slow: 1 to 8 minutes an answer on this machine, and cite adds about half.
- Found on the way: the card said a contract as `Level: B2B`. Fixed in #20,
  and checked again with the new card (`Contract: B2B`), 4 chats of each kind,
  16 in all (`results-new-card.json`): best first 16/16, partial before the rest
  16/16, no empty answer, 0 of 263 numbers unresolved, and no answer called the
  contract a level.

Decided: the one shape that is built stays, and `cite` is on by default in
Studio (2026-10-10), since its numbers held; the price is about half again the
wait, and the person can turn it off. The runtime's default stays off: a client
that does not ask gets no numbers. Not decided here: the plan shapes B and C
were never built, and no hosted model was asked.
