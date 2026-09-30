# cvitae-agent-runtime

> **Consolidation in progress.** This tree is the harness spine — the engine,
> the contracts, the storage and the boundary rules. The offer-discovery
> pipeline, the source readers and the AI audit log are parked in
> [`port/`](port/README.md) and land on top of it commit by commit. `port/` is
> empty before this branch merges; the runtime it holds is described by the
> README at `git show offer-discovery-foundations:README.md`.

A local-first agent harness. One process, one SQLite file, and a set of
capabilities that turn job postings and CVs into structured work a person can
check before it leaves the machine.

## Quick start

```bash
pnpm install
```

```bash
cp .env.example .env
```

No model credential in `.env` is required. Generation defaults to a local
provider. The optional companion scraper does require a shared
`SCRAPER_API_TOKEN` when its HTTP service is enabled.

```bash
pnpm check
```

Typecheck, lint, the boundary rules and the test suite. None of it needs a model
or a network.

The [independent integration provider client](docs/integration-providers-v2.md)
supports scoped discovery and browser listing capture, with durable acquisition
provenance. Enable it through runtime configuration; provider management UI and
removing legacy integrations remain separate migration milestones.

## How it is put together

```
contracts/     the vocabulary. Imports nothing. Everything else agrees here.
runtime/       the only composition root. The one place anything is wired.
core/          router → planner → orchestrator → executor → aggregator.
               Knows steps, not subjects.
capabilities/  the only home for domain knowledge. One file per capability,
               holding its schema, its plan, its prompts and the reasons for all three.
context/       what the model is allowed to see: the text for a step, built by
               the orchestrator before the step begins and frozen once it does,
               and the tools for a loop, chosen while the capability plans it.
retrieval/     reads the index. It has no write handle — indexing is a
               capability step, carried out like any other work.
effects/       the outside world: sources, offers, ai, mail.
tools/         the model-facing wrappers over effects. Nothing wraps mail.
runs/ events/  run state is canonical, events are derived, and both are
               written in one transaction.
storage/sqlite/ the only directory containing SQL.
adapters/      hosts, not logic: an IPC dispatch surface and a CLI.
```

Those are not conventions. Each one is a rule in `.dependency-cruiser.cjs`, and
`pnpm boundaries` fails the build when a rule is broken.

### Why the boundaries are shaped this way

**`contracts/` imports nothing.** Two modules that share a type do not thereby
depend on each other. It is what lets `storage/sqlite/` implement a port that
`capabilities/` uses without either one knowing the other exists.

**`core/` never imports `capabilities/`.** The orchestrator walks a list of
steps. If it knew what a CV was, every new capability would be a change to the
engine rather than a file beside the others.

**`tools/` imports `effects/`, never the reverse — and nothing wraps mail.** The
harness reads pages written by strangers and puts that text into model context.
An outbound channel one tool call away from attacker-written text is an
exfiltration path, so mail is built by `runtime/` and handed only to
`adapters/`. A step cannot reach it.

**`retrieval/` holds no write handle.** Not by agreement: it is typed against a
`ChunkReader` interface that has no write method, so there is no handle to hold.

**Run state is canonical; events are derived.** A checkpoint and the event
announcing it are written in one `BEGIN IMMEDIATE` transaction, and events carry
a per-run sequence number. The log therefore cannot claim a step whose state was
not saved. There is no outbox and no event sourcing — an outbox exists to bridge
two systems that cannot share a transaction, and these are two tables in one file.

**An external call is preceded by a committed attempt record.** On recovery, an
attempt with no recorded outcome means *ask a person*. It never means *retry*.

## Running a capability

```bash
pnpm cli capabilities
```

```bash
pnpm cli run analyze_offer --url 'https://example.com/job/12345'
```

A capability's own flags are whatever its input schema declares — `analyze_offer`
takes either a `--url` or `--offerText`, and a misspelled one comes back naming
the field. `--json` prints the whole result, `--db` points at another file.

Anything that reads sources takes `--file` and `--text`, both repeatable, in the
order given:

```bash
pnpm cli run extract_cv --file cv.pdf --file profile-screenshot.png
```

The file is opened here, in the adapter, and reaches the runtime as bytes. No
capability input carries a path, so nothing a caller sends can name a file for
the harness to open. An import merges into the stored CV rather than replacing
it — it may add and may fill a blank, and never overwrites — so a correction
survives a later import of the same profile. `--persist false` returns the same
answer without writing.

A saved import also makes the CV searchable, as a separate step. What gets
indexed is the prose — the experience bullets and the role description, each
bullet embedded with the job it was written under so a query can ask about work
at a kind of company. Everything a caller reads off the document instead — names,
dates, contact details, certificate issuers — stays out of the index, where it
would only crowd better answers. Indexing is not critical: an embedder that is
down costs the vector half of search over that import, not the import, and the
result says so in `indexed` — a count when it ran, `null` when nothing tried.
The passages are kept for keyword search meanwhile, and a rebuild queued with
the new revision embeds them in the background. It backs off on a failure that
may pass and stops on one a person has to fix, a refused or missing key, until
the key or the settings change or `profile.context.reindex` asks again.
`profile.context.indexStatus` says which of these the index is in.

`translate_cv` takes the stored CV into another language:

```bash
pnpm cli run translate_cv --source_language en --target_language pl
```

Any language tag the platform can name works, not a fixed pair — `pl`, `pt-BR`,
`zh-Hant` — and a tag that names no language is refused rather than translated
into. A run can be narrowed to particular sections through the `sections` input,
which is a list and so has no spelling as a command-line flag; the CLI
translates the whole CV.

Either way the whole CV comes back, not just the sections that were touched,
with `translated` naming which of them are in the target language. Returning
only the translated parts would make four empty sections and a person with no
education look identical.

Nothing is written. There is one CV document and no locale in its key, so a
translation that saved itself would either destroy the original or start a
second document that goes stale the next time an import touches the first.

What it will refuse to return is the interesting half. Each section is checked
against the source field by field, and a translation that drops a percentage,
spells a digit out, or comes back with four highlights where the source had five
fails the run with the field named. That kind of error reads perfectly well, and
the person sending the CV does not speak the language it is now in.

`ask_profile` answers a question about that CV whose steps are not known in
advance:

```bash
pnpm cli run ask_profile --question 'What have I worked on that involved payments?'
```

Every other capability here declares its steps. This one cannot: how many
searches an answer takes, and what to search for next, both depend on what the
last search returned. So the model gets a loop and decides as it goes — which is
the pattern with the reputation, and the two things that earned it that
reputation are the two bounded here.

The first is spending. Model turns are capped, at six unless the caller says
otherwise, and a loop that spends all of them still reaching for tools fails the
step instead of returning what it had so far. A confident half-answer is worse
than an error, because only one of the two gets checked.

The second is reach. Before the loop starts, the model is asked which of the
registered tools the question needs, and it is granted those and nothing else.
The registry it is choosing from is reads over local storage — nothing runs a
query, opens a path, fetches a URL or sends anything anywhere — so a loop that
has been confused, by a vague question or by text inside a document it read,
returns something unhelpful rather than mailing the CV somewhere.

It answers about the CV alone. Saved offers are canonical rows rather than
indexed text and no tool searches them, and promising an answer the tools cannot
source is how a fluent invented one gets produced. It also needs a model that
can call tools at all, which the small local ones that answer an extraction step
five times faster cannot.

`draft_application` writes the application email for one offer:

```bash
pnpm cli run draft_application --url 'https://example.com/job/12345' --tone warm
```

It spends exactly one model call, and the reason is worth stating because the
obvious version spends three. Three of the four things a covering email needs
are already known here — who the candidate is, what the position is called, and
where applications go — so the subject line is assembled from a template and the
recipient is read out of the offer with a regex. Neither can invent anything.
Only the body is generated, because a paragraph arguing that this person suits
this job is genuinely not sitting anywhere in the inputs.

The address is the part where that distinction pays. A model asked to copy one
out will occasionally produce a plausible address that nobody reads, and the
cost of that mistake is not a clumsy sentence — it is an application that was
never received, discovered weeks later or never. So every address found in the
posting comes back, ordered with the recruiting ones first and the send-only
ones dropped, as `to_suggestion` rather than `to`. Which one to write to is the
applicant's decision, and collapsing it here would make it silently.

**Nothing is sent.** The result carries `confirmation_required` unconditionally,
even when the checks below could not run, so an interface that sends without
asking is visibly ignoring the contract rather than merely unaware of it. That
is a promise about this capability; the structural half is that mail is not
reachable from a capability at all. This step reads text written by whoever
posted the offer, and a send function one capability away from that text is an
exfiltration path with a cover story — so the mail sender is absent from the
effects a step receives and a boundary rule keeps it out of the tool registry.

The draft is then checked against what the runtime already knows. Small models
writing letters emit `[Your Name]` and `[Company Name]` constantly; the ones
whose real value is in hand are substituted rather than re-prompted for, and the
rest are reported rather than deleted — an empty gap where a company name
belongs reads as a typo, while the bracket reads as what it is. A body too short
to send, an opening that answers the operator instead of the reader, a newline
smuggled into the subject line: all warnings on the result, none of them fatal.
A draft with one leftover placeholder is still worth far more than an error to
someone who was going to read it before sending anyway.

Which parts of the CV it argues from are chosen by search against the posting,
and `used_passages` names them, so a claim in the letter can be traced back to
the bullet it came from. When no embedder is available the letter is written
from recent experience in CV order instead — unranked bullets write a decent
letter, and no bullets write a generic one.

Two limits worth knowing. `--language` accepts any tag the platform can name and
the letter is written in it, but the subject line has templates for English and
Polish only, so a German letter arrives under an English subject. And
`--max_words` caps the body at 180 by default: a covering email that runs longer
than that is not read.

`generate_evidence_summary` writes the paragraph at the top of a CV, aimed at
one offer:

```bash
pnpm cli run generate_evidence_summary --max_chars 600 \
  --offer '{"required_skills":["TypeScript","React"],"responsibilities":["Own the checkout"]}'
```

The offer goes in as JSON because it is two arrays and two strings and a shell
has no syntax for that; it is `analyze_offer`'s own output, so the normal route
is to pass that result straight through.

This is the one place on a CV where the writing is an argument rather than a
record, and that is exactly what makes it the riskiest thing here to generate.
Everywhere else a model is restructuring facts that already exist, so a wrong
answer is a mangled fact and looks like one. Here it is asked to persuade — and
a model persuading rounds B2 up to fluent, four years up to five, and reaches
for a technology it saw in the vacancy rather than in the CV. Each of those
improves the paragraph and puts something in front of an employer that the
candidate will have to answer for.

So the model is not asked for a paragraph. It is asked for claims with their
sources attached, one per line:

```
EVIDENCE(job:0:2,skill:7) REQUIREMENTS(req:1) :: Four years building payment services in Go.
```

and the ids are minted by the same code that later resolves them, so `job:0:2`
means the third highlight of the first position and nothing else. That is the
difference between a citation that is well-formed and one that is *checkable*.
Everything downstream rests on it: a claim is compared against the exact
sentences it cites rather than against the CV in general, and a fabricated id
fails to resolve instead of matching something nearby.

What comes back is then checked, and the checks split two ways. A claim is
**refused**, failing the run, when keeping it would put something false in front
of a reader: a number its cited facts do not state, a contact detail, a sentence
lifted whole from the previous summary, no citation at all. A claim is
**dropped**, with a warning, when it is merely unusable: a sentence that does not
finish, a duplicate, a language level higher than the one the CV gives. The line
is whether a person reading the result would be misled or merely underserved,
and dropping is survivable because the paragraph is built from several claims.
One bad sentence out of five costs a sentence rather than a run.

Length sits on the underserved side of that line. A summary shorter than the
request is returned with a warning rather than refused: since there is exactly
one model call, refusing would trade a checked, correctly cited paragraph for no
paragraph at all, over a length preference. The caller can ask again knowing
what it got. Prose that runs *over* the ceiling is different, and still refuses
when nothing fits, because there the alternatives are breaking the ceiling or
cutting a sentence in half.

That ceiling is enforced by deleting whole sentences, never by truncating.
This paragraph sits in a fixed block at the top of a page, so the constraint is
real — but prose cut to a character budget ends `with hands-on.` and reads as
broken rather than short, which is worse in this document than in any other. At
most eight claims makes trying every subset 255 string joins, so the longest
combination that still fits is found exactly.

Contacts are stripped from the catalogue before the model sees it, so a phone
number cannot be copied into the summary by accident; the check on the output
covers the case where one is invented. That redaction is deliberately conservative
about digits — the shape of a phone number and the shape of `2019-2023` are the
same shape, and redacting the second would strip years out of the evidence and
then refuse a claim that cited them. A check that turns true statements into run
failures costs more than the leak it was guarding.

What the checks do not cover is worth knowing before trusting the word
"cited". Numbers, contact details, language levels and sentences lifted from the
previous summary are checked against the cited facts; whether the sentence
*follows* from them is not, and deciding that would take a second model call.
In a real run, one claim cited the position where the fact it rested on was one
of that position's highlights, and another joined facts from two different jobs
into a sentence that reads as one. Neither was false; both were looser than the
citation implied. The checks are aimed at numbers because a number is the thing
an interview asks about.

There is no retry. The executor retries nothing by design, and a second attempt
at a paragraph the first one got wrong is a second chance to invent the same
number; dropping claims individually is the cheaper answer and usually leaves
enough of them.

`verify_recipient` answers the question that comes last and matters most —
whether the address about to receive an application is the employer's:

```bash
pnpm cli run verify_recipient --url 'https://example.com/job/12345' --current 'rekrutacja@acme.pl'
```

It reads four things, in descending order of how much they are worth. The
employer's own site, reached from the URL the board published in its structured
data. The posting itself. The same role on another board, because a second
board's copy of the listing either corroborates the address or contradicts it,
and a contradiction is the loudest signal this produces. Then the open web,
which is only ever a way of finding pages to open.

Almost none of that is a model call. There is one optional step, off by default,
that asks a model for the employer's likely domains when `--search_web` is on
and nothing has stated one; everything else is fetching and comparing. That is a
security property rather than a cost saving. The pages being read are written by
strangers, the result is rendered beside a Send button, and a page that can
suggest a recipient to a model is a page that can redirect an application. So
nothing here believes a page about itself: an address is ranked by the domain it
sits on, how many independent sources printed it, and whether the board or the
company said it — never by a page claiming to be official.

The same rule governs search results. A title or a snippet is written by
whoever wrote the page and ordered by an engine with its own incentives, so
results move a URL up the fetch queue and do nothing else. An address that
appears only in a snippet is not a candidate, and the test suite pins that.

Two things are worth knowing before reading the output. `suggestion_only` is
always true — these belong beside the field, never in it — and `anchor_trust`
says how much the employer's domain itself is worth believing: `board` when the
posting stated it, `discovered` when it was guessed from the name and something
in the posting confirmed it, `guessed` when only the name matched. A guessed
domain is still read, and its pages still produce candidates, but it is kept out
of the comparison every other address is measured against. Believing the wrong
company's site would warn about the right answer, which is worse than having no
yardstick and saying so.

`company_publishes_no_address` is the other half of a useful answer. Most
employers now publish a form and no address at all, so the honest reply is often
an empty candidate list, that flag, and `apply_routes` — the careers page, the
ATS link, the form the board named.

The web tier is optional and degrades rather than fails: `WEB_SEARCH=off`, or no
engine reachable, costs the fourth tier and names itself in `degraded_note`. The
company tier needs the scraper, which is the one thing here with no fallback —
finding an origin, probing it and following its careers link has no cheaper
version that fits behind a single GET.

```bash
pnpm cli runs list
```

```bash
pnpm cli runs show 7f3a9c2 --events
```

Runs are addressed by id or by any unambiguous prefix of one, and `--events`
prints the run's whole timeline beside the step states behind it:

```
   0  ok         source
   1  ok         facts
   ...
    4  step.started    source
    5  step.succeeded  source
```

Every event has a saved step state behind it, and the sequence numbers are
gapless — that is the one transaction doing its job, and it is checkable
directly:

```bash
sqlite3 ~/.cvitae/runtime.db "SELECT seq, type, step FROM events WHERE run_id = (SELECT id FROM runs ORDER BY created_at DESC LIMIT 1) ORDER BY seq;"
```

Ctrl-C cancels a run rather than killing the process, so it reaches a terminal
`cancelled` state with the event to match instead of leaving a half-written row.

### When a run stops to ask

A step that needs a person's answer does not block. It parks the run:

```
Run 7f3a9c2e-… is waiting on step "send".

Send this to the address shown?

Answer it with: cvitae-runtime approve 7f3a9c2e-…
```

Nothing is held open — no timer, no awaited callback, no process that has to
survive until the answer arrives. The run's entire progress is rows in a file,
so the answer can come an hour later or after a restart:

```bash
pnpm cli approve 7f3a9c2 --note 'checked the address'
```

```bash
pnpm cli approve 7f3a9c2 --deny
```

A denial resumes the run too. The step asked, it has an answer, and what it does
with a refusal is its own decision.

## The database file

Everything a person keeps — the CV, offers, conversations, settings — is one
SQLite file: `~/.cvitae/runtime.db`, or wherever `CVITAE_DB` points. Four things
protect it, and each is a way the file could otherwise be lost or exposed without
an error.

**It is versioned, and never opened by a build that does not know it.** The
schema version is `PRAGMA user_version`, and `migrate` applies the steps newer
than it, each in its own transaction. A file whose version is *newer* than the
last step this build has was written by a later build, so it is refused with
`db_newer_than_app` before a single query runs. Running older code against a
newer schema is how a rolled-back app corrupts what the newer one saved.

**It is copied before it is changed.** When migrations are pending on a file that
has content, it is first set aside as `runtime.db.bak-<version>`, the version
being the schema the copy holds. The copy is taken by folding the write-ahead log
into the file and cloning it (copy-on-write on APFS, so a large database costs
neither time nor space until one side changes), or by `VACUUM INTO` when another
connection still holds the file. It is renamed into place only once complete, so
a process killed half way never leaves something that looks like a backup and is
not one. The newest two are kept — the one just made, and the newest schema among
the others — and each is a whole database. If the copy cannot be made the upgrade
does not start (`db_backup_failed`): migrating anyway would be trading the only
copy of someone's data for a full disk they can fix in a minute.

To go back: quit the app, move `runtime.db` aside, copy the backup to
`runtime.db`, delete `runtime.db-wal` and `runtime.db-shm` if they exist, and
start the build that wrote the backup.

**It is private.** The file and the `-wal` and `-shm` files beside it are created
readable by their owner only (`0600`), and a directory this process creates is
`0700`. A `~/.cvitae` from an earlier build, which was readable by every account
on the machine, is tightened at startup — bits are only ever removed — and with
it everything inside, including files this runtime no longer reads. A directory
that already existed and is not `.cvitae` is left as it was, because `CVITAE_DB`
can name any folder and the folder may hold other things.

**Deleted rows are overwritten.** `secure_delete = FAST` zeroes freed content
whenever that costs no extra I/O, so a deleted conversation does not sit in the
file's free pages until the space happens to be reused.

The two refusals are the only startup failures this process reports on purpose.
It writes one line to stderr, `cvitae-runtime: <code>: <message>`, and exits with
a status of its own — 78 for `db_newer_than_app`, 73 for `db_backup_failed`,
after `sysexits.h` — so that a parent that restarts a crashed runtime can tell a
refusal, which a restart cannot fix, from a crash. The numbers are in
`src/adapters/stdio/refusals.ts` and are mirrored by the desktop app; anything
else that goes wrong at startup is a crash and keeps exiting with 1.

Not done: a vacuum policy (`auto_vacuum` is still 0, so the file never shrinks;
changing it takes one full `VACUUM`, which needs room for a second copy), a
retention setting for the AI-call log, and removing the legacy `cv.json`,
`offers.jsonl` and `ai-logs/` that older builds left in `~/.cvitae`. Nothing here
reads them any more, but nothing has verified that everything in them is in the
database either, so they are left for the person to delete.

## Hosting it elsewhere

`adapters/ipc` is one function:

```ts
const dispatch = createDispatch(createHarness());
```

```ts
ipcMain.handle('runtime', (_event, channel, payload) => dispatch(channel, payload));
```

There is no Electron dependency in this repo and none is needed — a websocket
server, an HTTP route table and the test suite all wire up the same call. Every
channel validates its payload before anything runs, and every answer is an
envelope rather than a thrown error, because a thrown error does not survive
being serialised: the prototype goes, the code goes, and the far side receives
an empty object where the reason was.
