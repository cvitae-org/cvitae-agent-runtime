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
