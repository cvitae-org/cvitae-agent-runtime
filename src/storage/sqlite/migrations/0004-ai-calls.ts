/**
 * Somewhere for the model-call log to land.
 *
 * The log itself is not new — `effects/ai.ts` has wrapped every call since it
 * was written, and `AiLogEntry` says exactly what a line carries. What was
 * missing is a sink: the default wrote to `console.info`, which is stdout, and
 * stdout is about to belong to the desktop app's transport. A log that lands in
 * the middle of a JSON-RPC frame is worse than no log.
 *
 * Metadata only, and the table shape is the enforcement rather than a rule
 * someone has to remember. There is no column for a prompt, a completion, a
 * tool argument or an error message — only sizes, counts, timings and a code.
 * A log that carried the text would carry whatever the user pasted into it, and
 * this file ships inside the application: a second copy of a CV in a table
 * nobody remembers rotating is not worth a debugging convenience. `usage` is
 * spread into three columns instead of a JSON blob because tokens are what gets
 * summed, and summing across a blob means unpacking every row.
 *
 * No foreign key to `runs`. Two reasons, and the second is the load-bearing
 * one: a call can be made outside a run at all — retrieval embeds under its own
 * trace — and an accounting record that a cascade can delete is not an
 * accounting record. The log outlives what it describes, which is the point of
 * writing it down.
 */

export const aiCalls0004 = /* sql */ `

CREATE TABLE ai_calls (
  id               INTEGER PRIMARY KEY,
  at               INTEGER NOT NULL,
  trace_id         TEXT NOT NULL,
  run_id           TEXT,
  step             TEXT,
  operation        TEXT NOT NULL CHECK (operation IN
                     ('object','text','image','tool_loop','embed')),
  provider_id      TEXT NOT NULL,
  model_id         TEXT NOT NULL,
  prompt_chars     INTEGER NOT NULL,
  input_bytes      INTEGER,
  completion_chars INTEGER NOT NULL,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  total_tokens     INTEGER,
  latency_ms       INTEGER NOT NULL,
  finish_reason    TEXT,
  outcome          TEXT NOT NULL CHECK (outcome IN ('ok','failed')),
  error_code       TEXT
);

-- Newest first is how the log is read, and how it is pruned.
CREATE INDEX ai_calls_at ON ai_calls(at DESC);

-- Partial, because most rows have a run and the ones that do not are exactly
-- the ones this index would never be asked about.
CREATE INDEX ai_calls_run ON ai_calls(run_id, at) WHERE run_id IS NOT NULL;
`;
