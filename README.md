# jobs-radar

A job search and monitoring service. It reads my resume, queries vacancy sources, scores how well
each vacancy matches me using an LLM, and writes a daily markdown file with the ones that pass a
threshold.

I built it because job boards optimise for the company, not for the candidate. I wanted the
filtering to happen on my machine, with my criteria, against my resume, and to end up in a file I
can open in my notes app and tick off.

The LLM provider is your choice: Claude, OpenAI, or a local model through Ollama. Nothing in the
core depends on which one you pick, and with Ollama the project runs without an account or an API
key.

## Status

The project is being built commit by commit and it is not runnable end to end yet. What exists
today:

| Piece | State |
| --- | --- |
| Domain types and ports | Done |
| Resume and profile loading | Done |
| Greenhouse source | Done |
| Normalisation and dedup keys | Done |
| Dedup store (SQLite) | Done |
| Hard filters | Done |
| LLM scoring (Claude, OpenAI, Ollama) | Done |
| Markdown output | Not yet |
| CLI | Not yet |
| Lever, Ashby and Gmail sources | Not yet |

There is no command to run yet. The pieces are tested individually; the pipeline that joins them is
the next commit. The roadmap at the end of this file tracks the rest.

## How it works

One run is a pipeline of six stages:

```
ingest -> normalize -> dedup -> hard filters -> score -> emit
```

**Ingest.** Every source is asked for the vacancies it has seen since a given date. Sources run
with `Promise.allSettled`, never `Promise.all`: an API that is down produces a warning and the run
continues with whatever the other sources returned.

**Normalize.** Titles, companies and locations get their whitespace collapsed, HTML descriptions
are turned into text, and the work mode is inferred when the source did not state it. Each vacancy
also gets a dedup key, which is a hash of the company and the title after both have been stripped
down: lowercased, accents removed, legal suffixes dropped, bracketed noise removed, seniority
abbreviations expanded. Without that, "Nu Colombia S.A.S." and "Nu Colombia" are two different
companies, and "Sr. Java Developer" and "Senior Java Developer" are two different jobs.

**Dedup.** Duplicates inside the same run are removed first, in memory, because two sources can
return the same vacancy before either has been recorded. What survives is checked against a SQLite
database of everything already seen. A vacancy is only recorded as seen after it has been written
out, so a run that fails halfway does not silently swallow vacancies.

**Hard filters.** Cheap, deterministic checks that run in code before any LLM call, so that no
money is spent on vacancies that were never going to qualify. The split between these and what the
model decides is explained below.

**Score.** What is left goes to the model together with the resume and the criteria. The answer is
structured: a score from 0 to 100, a confidence, the parts of the stack that match, the critical
and the minor gaps, any red flags, the keywords an ATS would look for and the resume does not have,
and one sentence of reasoning.

**Emit.** Everything at or above the threshold is written to a daily markdown file.

## Requirements

Node 22.5 or newer. The dedup store uses the built-in `node:sqlite` module, so there is no native
module to compile and no build toolchain to install. On Node 22 that module prints an experimental
warning on startup; it is harmless.

## Install

```
git clone https://github.com/Giancho2000/jobs-radar.git
cd jobs-radar
npm install
```

## Configure your profile

Two files at the root of the project. Neither one is versioned, and both are in `.gitignore`.

### cv.md

Your resume, in markdown. There is no required structure: it is sent to the model as it is, so
write it the way you would want a recruiter to read it. Technologies, years, and the scope of what
you actually did matter more than the formatting.

### profile.yml

Your hard criteria. Copy the example and edit it:

```
cp src/examples/profile.example.yml profile.yml
```

```yaml
seniorityLevels: [mid, senior]
workModes: [remote, hybrid]
# Locations are matched as whole words against what the source publishes. A country does not imply
# its cities, so list the cities you would take as well.
locations: [Colombia, Cali, Bogota, LATAM, Remote]
minimumSalaryUsd: 3500
dealBreakers:
  - onsite outside Valle del Cauca
  - primary stack is PHP or .NET Framework
excludedKeywords: [internship, trainee, apprentice]
scoreThreshold: 75
```

| Field | Required | What it does |
| --- | --- | --- |
| `seniorityLevels` | yes | Read as a range. `[mid, senior]` also rejects `Staff`, `Principal` and `Tech Lead` from above, and `Junior` and `Intern` from below. Add `lead` if you want those. |
| `workModes` | yes | Any of `remote`, `onsite`, `hybrid`. |
| `locations` | yes | Matched as whole words, accents and case ignored. Region names have aliases built in, so `LATAM` also matches "Latin America". City names do not, so list them. |
| `minimumSalaryUsd` | no | Judged by the model, not by code. Almost no posting publishes salary as structured data. |
| `dealBreakers` | no | Free prose. Judged by the model. |
| `excludedKeywords` | no | Matched against the title only. |
| `scoreThreshold` | yes | 0 to 100. Below this, a vacancy does not reach the daily file. |

Unknown fields are rejected rather than ignored, so a typo in a key fails loudly instead of quietly
disabling a criterion.

## Configure the AI provider

Everything about the provider is read from the environment, not from `profile.yml`. Credentials and
machine setup do not belong in a file that gets shared as an example.

| Variable | Default | What it does |
| --- | --- | --- |
| `JOBS_RADAR_LLM_PROVIDER` | inferred | `anthropic`, `openai` or `ollama`. |
| `JOBS_RADAR_LLM_MODEL` | per provider | Overrides the default model. |
| `JOBS_RADAR_LLM_BASE_URL` | per provider | Points the client at a different endpoint. |
| `ANTHROPIC_API_KEY` | none | Required for `anthropic`. |
| `OPENAI_API_KEY` | none | Required for `openai`. |
| `OLLAMA_HOST` | `http://localhost:11434` | Where your Ollama server listens. |

When `JOBS_RADAR_LLM_PROVIDER` is not set, the provider is inferred from the key that exists:
`ANTHROPIC_API_KEY` first, then `OPENAI_API_KEY`, then Ollama. A machine that has only one of them
has already answered the question.

### Claude

```
export ANTHROPIC_API_KEY=sk-ant-...
```

Default model: `claude-opus-5`. For high volume, a cheaper model is one variable:

```
export JOBS_RADAR_LLM_MODEL=claude-haiku-4-5
```

The resume and the criteria are identical for every vacancy in a run, so they are sent as a cached
prompt prefix. From the second vacancy onward that part is billed at the cache rate and only the
vacancy itself is billed in full.

### OpenAI

```
export OPENAI_API_KEY=sk-...
```

Default model: `gpt-4.1-mini`. Set `JOBS_RADAR_LLM_MODEL` if that model has been retired or if you
want a different one.

### Ollama

No key, no account, and nothing leaves your machine:

```
ollama pull llama3.1
ollama serve
```

Default model: `llama3.1`. Local models are noticeably worse at holding to the output format and at
weighing a resume against a posting, so expect more retries and rougher verdicts. It is the right
choice if you do not want your resume sent to a third party, and the right way to try the project
before deciding whether to pay for anything.

### Any OpenAI-compatible endpoint

OpenRouter, Groq, vLLM, LM Studio and anything else that speaks the same protocol work through the
OpenAI client:

```
export JOBS_RADAR_LLM_PROVIDER=openai
export OPENAI_API_KEY=your-gateway-key
export JOBS_RADAR_LLM_BASE_URL=https://openrouter.ai/api/v1
export JOBS_RADAR_LLM_MODEL=the-model-the-gateway-expects
```

## What is filtered in code and what is left to the model

The split is deliberate. Code decides what a machine can decide on its own, and everything else is
the model's job. Rejecting on a guess is worse than paying for one call.

Checked in code, before any request:

- `excludedKeywords`, against the title only. A posting that says "this is not an internship" would
  otherwise be dropped by the word "internship".
- Seniority, when the title states one. A title that states none is never rejected: unknown is not
  a reason to discard.
- Work mode. A vacancy that is explicitly remote loses against a profile that does not take remote
  work, and the reverse.
- Location, unless the vacancy is remote and the profile accepts remote work.

Left to the model:

- `dealBreakers`. They are prose, and prose is what a language model is for.
- `minimumSalaryUsd`. There is nothing to compare in code when the posting does not publish it.

Every rejection is recorded together with the rule that caused it, so a run can report why a
hundred vacancies never reached the model instead of only how many.

## LinkedIn and its terms of service

This project never touches LinkedIn programmatically. No scraping, no headless browser driving a
logged-in session, no extension automating actions on the site. That is not caution, it is section
8.2 of the LinkedIn User Agreement, and the practical consequence of ignoring it is a banned
account: yours, not mine.

LinkedIn vacancies are meant to enter through the job alert emails LinkedIn sends you voluntarily,
read through the Gmail API with your own credentials. Mail that was delivered to your inbox and
read by you is not scraping.

That also sets the latency, and I would rather state it than hide it. LinkedIn alerts arrive daily,
not instantly. ATS sources can be polled every few minutes. Each vacancy carries a freshness
indicator for exactly this reason. If you need to apply within minutes of a LinkedIn posting going
up, this is not the tool.

## Your data

`cv.md` and `profile.yml` are in `.gitignore` with a leading slash and are never committed.

Be clear about what a scoring run does send. With Claude or OpenAI selected, your resume and your
criteria go to that provider on every scored vacancy, as part of the prompt. That is inherent to
scoring with a hosted model, not something this project adds on top. If it is not acceptable to
you, use Ollama, where the resume never leaves your machine.

The SQLite database of already seen vacancies lives in `data/` and is also gitignored. Deleting it
costs you nothing except the memory of what you have already been shown.

## Project layout

```
src/
  core/         domain types, ports, and everything pure: normalize, dedup, filters
  profile/      loads cv.md and profile.yml
  sources/      one adapter per vacancy source
  scoring/      prompt, provider adapters, retry policy
  store/        the SQLite dedup store
  examples/     profile.example.yml
```

The architecture is ports and adapters. `src/core/` defines the ports (`SourcePort`, `ScorerPort`,
`SinkPort`, `DedupStore`) and imports nothing from `sources/`, `scoring/` or `store/`. Adding a
source or swapping a provider does not touch the core.

## Development

```
npm run typecheck
npm run build
npm test
```

TypeScript is strict, including `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. The
project is ESM, so relative imports carry the `.js` extension. Every external input, meaning config
files, API responses and model output, is validated with zod before it is trusted.

## Roadmap

Done: project setup, domain types and ports, resume and profile loading, Greenhouse source,
normalisation, SQLite dedup, hard filters, LLM scoring.

Next: markdown output, checkbox preservation across runs, daily rotation and history, Lever and
Ashby sources, LinkedIn alerts through Gmail, enrichment through the ATS, the CLI, parser fixtures
and tests, CI.

## License

ISC.
