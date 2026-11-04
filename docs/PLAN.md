# CompetitorPulse: system overview and implementation plan

## Context

The repo holds only the brief (`instructions.md`), fixtures, the mock LLM and two reference screenshots. We need a system that polls competitor listings, stores every snapshot, has an LLM summarise each change, and shows this in a small React UI.

Most of the grade is backend design: persistence, scheduling and LLM integration, at a few hundred competitors polled every 15 minutes with LLM calls billed per request. This plan records the choices made after comparing the alternatives, so each one can be defended in the interview.

## Decisions

| Area | Choice | Why |
|---|---|---|
| Backend | NestJS, TypeScript, Node 22 | Modules suit the API, poller and summarizer split |
| Database | Postgres 16, TypeORM through `@nestjs/typeorm`, generated migrations | Durable history and transactions; TypeORM is the standard NestJS pairing and supports `SKIP LOCKED` |
| Job design | Postgres only, no Redis or BullMQ | 0.33 polls/s doesn't justify a second datastore; the snapshot and its pending summary commit together |
| LLM | DeepSeek first, failing over to other providers with keys in `.env` | Summaries survive a provider outage, with attempts capped |
| Frontend | React, Vite, TypeScript, `react-router` | Required by the brief; no styling effort |
| Packaging | Dockerfile and `docker compose up` | Bonus; one command to run everything |

## System overview (also goes in the README)

```text
 ┌──────────────┐
 │ React UI     │  refetches the timeline every 5s
 └──────┬───────┘
        │ HTTP
┌───────▼──────────────────────────────────────────┐
│ NestJS app (one or more instances)               │
│                                                  │
│  ┌───────┐   ┌──────────────┐  ┌──────────────┐  │
│  │ API   │   │ Poll worker  │  │ Summary      │  │
│  │       │   │ 15s check    │  │ worker       │  │
│  │       │   │              │  │ 15s check    │  │
│  │       │   │              │  │ + failover   │  │
│  └───┬───┘   └──┬───────┬───┘  └──┬────────┬──┘  │
└──────┼──────────┼───────┼─────────┼────────┼─────┘
       │     fetch│       │claim    │claim   │call
       │          ▼       │+ save   │+ save  ▼
       │   ┌───────────┐  │         │  ┌─────────────────┐
       │   │ Data      │  │         │  │ DeepSeek →      │
       │   │ source    │  │         │  │ other providers │
       │   │ (stub)    │  │         │  │ with keys       │
       │   └───────────┘  │         │  └─────────────────┘
┌──────▼──────────────────▼─────────▼──────────────┐
│ Postgres: source of truth and work queue         │
│ competitors, snapshots, source_cursors           │
└──────────────────────────────────────────────────┘
```

**How a change flows through the system**

1. Every 15s, the poll worker claims due competitors with `FOR UPDATE SKIP LOCKED` and moves `next_poll_at` forward in the same short transaction. Each competitor is still fetched only once per 15-minute poll interval.
2. It fetches the listing with no transaction open.
3. In one short transaction, it compares content hashes and saves the snapshot.
   - **Unchanged or first snapshot:** `changed = false`, and no LLM call is ever made.
   - **Changed:** `changed = true`, `summary_status = 'pending'`.
4. Every 15s, the summary worker claims pending rows and sets a retry time, so a crash brings the row back.
5. It calls the LLM with a timeout. A failed attempt backs off and moves to the next available provider.
6. It saves the summary on the same snapshot row, or marks `failed` once attempts run out. The snapshot itself is never at risk.
7. The API returns the snapshot and its summary together, and the timeline shows them.

**Why these choices hold up**

- **Cost:** the hash check decides whether the LLM runs. The separate summary step means a retry repeats only the LLM call, and the attempt cap bounds spend.
- **Parallel work:** claims don't wait on each other, and no lock is held during network calls.
- **Crashes:** delivery is at-least-once. A crash can repeat a billed call, and the attempt count limits that.
- **Restarts:** the schedule is in Postgres, so polling resumes where it left off and overdue competitors are polled once.
- **Failover limits:** any instance can do the work, with no leader. Postgres is the one critical dependency. Production should use managed Postgres with a standby in another zone, automatic failover and point-in-time backups. A brief outage pauses the system, and a poll in progress can lose its snapshot if its write retries run out.
- **Scale:** the first real limit is snapshot volume, about 10M rows a year at 300 competitors. The next step is time partitioning and a retention policy. Move to a dedicated queue only if volume or job types outgrow this design.

## Typing rules

Everything is TypeScript, including tests, migrations and config.

- **Compiler:** `strict: true` plus `noUncheckedIndexedAccess` and `noImplicitOverride` in server and web.
- **Lint:** ESLint with type-aware rules, with `no-explicit-any` and the `no-unsafe-*` rules as errors. No `@ts-ignore`; `@ts-expect-error` only in tests, with a reason.
- **Shared contract:** API types (`Snapshot`, `Competitor`, `SummaryStatus`) live in a `shared/` npm workspace used by both server and web, so a contract change breaks the compile on both sides.
- **Untrusted data:** env vars, request bodies, fixtures and LLM responses are parsed with `zod`, with types inferred from the schemas. `unknown` is narrowed, never cast.
- **Database:** prefer typed repository methods. Query builder strings can't be compiler-checked, so integration tests cover them. Raw queries declare an explicit row type.
- **Closed sets:** statuses and provider names are string-literal unions, with exhaustive `switch` checks.
- **Check:** `npm run test:all` runs type checks, lint, unit tests and integration tests.

## Database layer rules

- **Migrations:** `typeorm migration:generate` from the entities, reviewed and committed, with `synchronize: false` everywhere. Compose runs `migration:run` as a one-shot service before the app starts, so multiple instances don't race to apply migrations.
- **Queries:** repositories and the query builder only. No eager or lazy relations, so every query stays visible. Foreign keys are still declared, including `ON DELETE CASCADE`.
- **Claims:** a short transaction using `setLock('pessimistic_write')`, `setOnLocked('skip_locked')` and `limit`, then a batch `update` with `In(ids)`. It commits before any network call.
- **Raw SQL:** allowed through `dataSource.query` where the query builder obscures a query, with an explicit row type.
- **Query logging:** enabled in development, so the real SQL is available for review.
- **Configuration:** the environment is the only source. All five `POSTGRES_*` variables are required everywhere, with no defaults in the code or in compose, and a missing one stops startup. Locally they come from the repo root's `.env` (`cp .env.example .env`); real variables override the file. Integration tests never read `.env`; they use the Testcontainers settings.

## Schema

- `competitors(id PK, created_at, next_poll_at)`
  - Index on `next_poll_at`.
- `snapshots(id bigserial PK, competitor_id FK CASCADE, fetched_at, title, tagline, price, description, content_hash, changed, summary, summary_status, summary_attempts, summary_next_attempt_at, summary_error, summary_provider, summary_model)`
  - `summary_status` is one of `none | pending | done | failed`.
  - Index on `(competitor_id, id)` for the timeline and previous-snapshot lookup, scanned backward for newest first.
  - Partial index on `summary_next_attempt_at WHERE summary_status = 'pending'`.
- `source_cursors(competitor_id PK FK CASCADE, position)` for the stub's counter.

## Behaviour details

**Polling**
- `POLL_INTERVAL_SECONDS` defaults to 900; compose uses a short value for demos. `CHECK_INTERVAL_SECONDS` defaults to 15. About 10% jitter spreads polls out.
- Each check drains due work in batches up to the concurrency cap (10 polls). A guard stops checks overlapping.
- The claim works on the whole batch, with no per-row awaits. Awaiting in a loop is only used where work must run in sequence, such as fetching the next batch.
- A failed fetch writes no snapshot; it logs and tries again at the next due time. Source data is validated with `zod`.
- The diff hash is SHA-256 of the four fields after trimming and collapsing whitespace.
- The save transaction locks the competitor row, so a competitor deleted mid-fetch drops the result.

**Write failures**
- The snapshot write retries a few times with short backoff, reusing the listing already fetched.
- The stub reads its position without advancing, then advances the cursor in the same transaction as the snapshot. A failed save therefore can't skip a version, and a restart can't cause a false change. The stub sits behind a `ListingSource` interface so a real fetcher can replace it.

**Summaries**
- Each check drains pending rows up to the concurrency cap (5 calls), claiming only what it can start at once, so the 60s retry time stays longer than the 30s call timeout.
- The attempt number stored in Postgres selects the provider, so failover survives a crash.
- The user message opens with the changed field names, because the mock echoes only its first 160 characters.
- Listing text is untrusted: it is passed as delimited JSON, the system prompt says to treat it as data, field lengths and `max_tokens` are capped, and React renders the summary as plain text.

**LLM failover**
- **Providers:** DeepSeek, OpenAI, Anthropic, Gemini, Mistral, Groq and xAI, in one small table of base URL and default model. Check current model names against each provider's docs. OpenAI-compatible providers share the `openai` SDK with `maxRetries: 0`. Anthropic may need a small adapter; load the `claude-api` skill before writing it.
- **Enabling:** a provider is available only if its key is set (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, and so on). Startup logs the order and refuses to start with no provider.
- **Configuration:** `LLM_PROVIDER_ORDER` sets the order, with DeepSeek first by default. `<PROVIDER>_MODEL` and `<PROVIDER>_BASE_URL` override defaults.
- **Attempt cap:** `LLM_MAX_ATTEMPTS` defaults to 3, or the number of available providers if higher.
- **Cooldown:** a provider that just failed is skipped for a short in-memory period, so an outage doesn't cost 30s per summary.
- **Secrets:** keys live in a gitignored `.env`; `.env.example` holds placeholders.

| Failure | Action |
|---|---|
| 429, 5xx, timeout, network error, empty response | Back off, then try the next provider |
| 401, 402, 403, 404 (bad key, no balance, wrong model) | Log an error, cool down for longer, try the next provider |
| Other 400 | Mark `failed`, since the request itself is probably at fault |
| All attempts used | Mark `failed` with the error recorded |

**API**

The four contract endpoints are implemented as specified. Where the brief is silent:

| Case | Behaviour |
|---|---|
| POST with a malformed id | 400 |
| POST with an id the source doesn't know | 422 |
| POST with an already tracked id | 409 |
| DELETE or GET snapshots for an untracked id | 404 |
| After a successful POST | Due immediately |
| DELETE | Removes snapshots and the cursor, so re-adding starts again at v1 (documented assumption) |

Additions that don't change contract fields: `summaryStatus`, `summaryProvider` and `summaryModel` on `Snapshot`; optional `?limit=` on snapshots, returning full history without it; `GET /healthz`, which reports whether Postgres is reachable.

**Frontend**
- **List view:** add form showing API errors, tracked list with links, remove button.
- **Timeline view:** newest first, with fetched time, listing fields, and one of: AI summary, "No change since previous snapshot", "Summary pending…", "Summary failed". Refetches every 5s.

## Layout

```
server/src/{main,app.module,config}.ts
server/src/database/       # TypeORM data source config
server/src/competitors/    # controller, service, Competitor entity
server/src/source/         # ListingSource interface + fixture stub, cursor entity
server/src/poller/         # check loop, Snapshot entity and queries
server/src/summarizer/     # check loop, status queries
server/src/llm/            # provider table, clients, failover
server/migrations/
web/src/                   # CompetitorList, Timeline, typed api client
shared/                    # API contract types used by server and web
files/                     # provided, unchanged
.github/workflows/ci.yml
Dockerfile, docker-compose.yml, .env.example, .gitignore, README.md
```

## Status

Managed by `/plan-step`. A step is ticked only when you run `/plan-step approve`.

- [x] Step 1: Scaffold (PR #2)
- [x] Step 2: Postgres layer (PR #3)
- [ ] Step 3: Postgres review package
- [ ] Step 4: Polling
- [ ] Step 5: Summaries
- [ ] Step 6: API
- [ ] Step 7: Frontend
- [ ] Step 8: Packaging
- [ ] Step 9: README

## Implementation log

Facts later steps need, and deviations from this plan, added as each step is approved.

**Step 1 (no deviations)**

- **Nest 11, not 12:** Nest 12 is ESM-only, and Jest can only load it on Node 22 through `--experimental-vm-modules`. Stay on the 11-compatible lines: `@nestjs/typeorm` 11 and `@nestjs/serve-static` 5. `@nestjs/typeorm` 12 is ESM and breaks Jest. TypeORM 1.x worked with this pairing in a spike.
- **TypeScript `~6.0.3`:** version 7 is outside the supported range of `typescript-eslint` and `ts-jest`.
- **`shared` must be built first:** it compiles to CommonJS in `dist`, and consumers import that. `test:all` and CI build it first. Run `npm run build:shared` after changing it.
- **Step 7:** `web` imports only types from `shared` so far. Importing a runtime value may need a Vite alias to `shared/src`, which hasn't been tested.
- **Jest doesn't type-check:** `isolatedModules` makes `ts-jest` transpile only, so type errors in specs are caught by `npm run typecheck`.
- **Port 3000 is hardcoded** in `server/src/main.ts`. `server/src/config.ts` exists since step 2 but only covers the database. Replace the port when the API step adds its config.
- **Postgres (updated by step 2):** compose and the migration CLI read `POSTGRES_*` from `.env`, with no defaults. `.env.example` uses port 5432, with user, password and database all `competitor_pulse`.
- **CI services (updated by step 2):** mock LLM instances on ports 4001 and 4002, which no test uses yet. Integration tests start their own Postgres, so CI no longer has a Postgres service.
- **`multer` override:** root `package.json` forces `multer` to 2.5.0 because `@nestjs/platform-express` 11.2.8 pins the vulnerable 2.4.0. Remove it once Nest updates the pin. Changing an override also needs the lockfile updated (`npm update multer`), because `npm install` alone left 2.4.0 in place.
- **Step 8:** 32 low and moderate audit findings remain in dev tooling and are accepted. The Dockerfile's production image must omit dev dependencies.
- **Merge gate:** GitHub doesn't enforce CI, because branch protection is unavailable on this private repo's plan. `/plan-step approve` is the only gate.

**Step 2**

Deviations:

- **Timeline index:** `(competitor_id, id)` rather than `DESC`, because TypeORM's index decorators can't declare `DESC`. It relies on a backward scan, which step 3's `EXPLAIN` should confirm.
- **Drift test:** calls the schema builder's `log()` directly, the same comparison `migration:generate --check` makes, rather than spawning the CLI.
- **Build layout:** migrations sit outside `src`, so the compiled entry point is `dist/src/main.js` and migrations are in `dist/migrations`.
- **Test commands:** `verify` became `test:all`, with `test:unit` (also `npm test`) and `test:integration`. Integration specs are named `*.integration.spec.ts` and use Testcontainers, so CI has no Postgres service.
- **No configuration defaults:** see Database layer rules. Compose and the migration CLI need `.env`, so `cp .env.example .env` is a required setup step.
- **Nest wiring deferred:** `@nestjs/typeorm` isn't installed and `AppModule` doesn't load the database. See step 4.

Choices made during the step, which the user reviewed at approval:

- `summary_status` is a Postgres enum built from the shared `SUMMARY_STATUSES`, not `text` with a `CHECK`.
- Jitter is plus or minus the ratio, so the average stays at the interval. `claimDueCompetitors` takes `jitterRatio`; 0.1 is the plan's value.
- Each integration spec file creates its own database inside the test container.

Facts later steps need:

- **Query classes:** `SnapshotQueries` (`server/src/poller/`) and `SummaryQueries` (`server/src/summarizer/`) are `@Injectable()` and take a `DataSource`. Nothing registers them yet.
- **Step 4:** `saveSnapshot`'s `inTransaction` callback is where the cursor advance goes, so it commits with the snapshot. `saveSnapshot` returns `null` when the competitor was deleted. `server/src/source/listing.ts` is a plain interface for now; the source's `zod` schema should replace it.
- **Step 5:** `claimPendingSummaries` takes `limit`, `retryAfterSeconds` and `maxAttempts`, and counts the attempt at claim time. `attempt` starts at 1 and selects the provider. A claim can return fewer rows than it locked, because rows already at the cap are marked `failed` there. Pass `attempt` back to `scheduleSummaryRetry` and `failSummary`, which ignore a superseded attempt and return `false`. `completeSummary` accepts a result from any attempt while the row is pending.
- **Step 6:** `listTimeline` returns entities, so the API maps them to the shared contract. `Snapshot.id` is a string, because `bigint` can exceed 2^53.
- **`.env` loading:** `data-source.ts` loads the repo root's `.env` for the CLI, using a path that is correct only when run from source. From `dist` it finds no file and relies on real variables, which is the intended production behaviour. Integration tests must never import `data-source.ts`.

Known gaps, accepted at approval:

- **Unexplained failure:** one early full test run had 2 failures, and the test names weren't captured. The next 32 full runs passed, on dev Postgres rather than Testcontainers. If it recurs, capture the names.
- **Lock checks:** removing the lock from `saveSnapshot` makes its concurrency test fail, but the same check was never validly completed for the two claim queries.
- **`.agents/`:** an untracked `.agents/skills/plan-step/SKILL.md` appeared during this step from outside the session. It isn't committed and still says `npm run verify`.

## Implementation steps

**Each step is one PR, run with `/plan-step`:** it writes failing tests, implements, verifies, opens a PR and lists what you should check. It merges and ticks the step only after `/plan-step approve`. Later plan changes are made in this file.

**Every step follows test-first development:**

1. **Write the tests first,** from the brief and this plan.
2. **Run them and confirm they fail.** They must fail on an assertion because the behaviour is missing, not because of a typo or setup error. Only the type signatures and empty stubs needed to compile may exist at this point.
3. **Implement** until the tests pass.
4. **Run `npm run test:all`** before moving on.
5. **Report both runs,** failing and passing, for each step.

**When a test fails after implementation, fix the code, not the test.** Tests are never weakened, skipped, deleted or edited just to pass. If a test itself looks wrong against the brief, stop and show you why, and change it only with your agreement.

**Steps with no behaviour of their own:** step 1 has one failing smoke test of the test setup itself. Step 8 starts with a failing script that checks `docker compose up` brings the system to a healthy state and serves the API. Step 3 only adds a review document, generated from the running code, so it has no tests. Step 9 (README) has no tests; instead, its run instructions get followed from a clean checkout.

1. **Scaffold:** npm workspaces (`server`, `web`, `shared`), NestJS project, strict TypeScript and ESLint config, Jest, `npm run test:all`, compose with Postgres, `.gitignore`, the GitHub Actions CI workflow, and remove the committed `.DS_Store` files.
2. **Postgres layer:** entities, generated migrations and all queries (claim due competitors, save snapshot with diff, claim and complete summaries, read timeline), with integration tests including concurrent claims.
3. **Postgres review package:** a PR adding `docs/postgres-review.md` with the entities, the generated migration SQL, the SQL TypeORM actually runs, and `EXPLAIN` output for the claim and timeline queries, including whether the timeline uses a backward scan of `(competitor_id, id)`. Generating it needs `.env` and dev Postgres. Nothing further gets built until you've approved it. (updated by step 2)
4. **Polling:** source stub, poll worker, write retries. Also wires the database into Nest: install `@nestjs/typeorm` 11, register the query classes, and load `.env` in `main.ts`. `app.module.spec.ts` is a unit test that boots `AppModule` with no services, so importing the database there means deciding how that test changes, with your agreement. (updated by step 2)
5. **Summaries:** LLM providers, failover, summary worker.
6. **API:** competitor and snapshot endpoints, `/healthz`.
7. **Frontend:** both views, served by NestJS (`@nestjs/serve-static`) with a Vite proxy in development.
8. **Packaging:** Dockerfile, and compose with db, a one-shot migrate service, mock-llm and app, including restart policies. The production image has no dev dependencies, so the migrate service must run the compiled `dist/migrations` without `ts-node`, using a compiled data source. Compose needs `.env`, so `docker compose up` from a clean checkout needs `cp .env.example .env` first. (updated by step 2)
9. **README:**
   - Install, build and run, with and without compose, including `cp .env.example .env` as a required first step.
   - The system overview above.
   - LLM setup, including running against the mock; config table.
   - Assumptions, scale and production notes, including the Postgres standby.
   - Which real providers were actually tested.
   - AI tools used (Claude Code), as the brief asks.

## Verification

**CI (GitHub Actions):** `.github/workflows/ci.yml` runs on every pull request, and again on each new push to it. Type checks, lint, unit tests and integration tests are separate named steps, so a PR shows which one failed. It starts the mock LLM instances, with no provider keys. A step can't be approved until CI is green.

**Test commands:**

| Command | Runs | Needs |
|---|---|---|
| `npm run test:unit` (also `npm test`) | `*.spec.ts` | Nothing |
| `npm run test:integration` | `*.integration.spec.ts` | Docker |
| `npm run test:all` | Build `shared`, types, lint, unit tests, integration tests | Docker |

Integration tests start a throwaway `postgres:16` on a random port with Testcontainers, so they don't need or touch dev Postgres. Each spec file creates its own database in that container, so spec files can run in parallel.

Automated tests never call a real provider, so they spend no money. Tables are truncated between tests, and retry times are set directly in the database, so tests don't sleep.

**Unit tests (`test:unit`; Jest, no services):**

- Hash normalisation: whitespace-only differences match, and a real change in any field doesn't.
- Provider order from env, including skipped keys and cycling by attempt number.
- Failure classification for each row of the failover table, plus backoff and cooldown.
- Prompt building: changed fields come first, and long fields are capped.
- Config parsing rejects invalid values and refuses to start with no provider.

**Migration tests (`test:integration`):**

- All migrations apply to an empty database, and `down` rolls them back.
- `migration:generate --check` reports no drift between entities and migrations.

**API tests (`test:integration`; Jest, Supertest, real Postgres):**

- Response shape checked against the shared contract, including `summary` being `null` when unchanged, pending or failed.
- Each row of the API behaviour table.
- Deleting a competitor removes its snapshots and cursor.

**Frontend tests (Vitest, Testing Library, mocked API):**

- The timeline shows each of the four summary states, newest first.
- Adding and removing a competitor, and showing API errors.

**Worker integration tests (`test:integration`; Jest, real Postgres, mock LLM), calling the worker check functions directly:**

- Stub advances through v1 to v4, then repeats v4.
- The first snapshot and unchanged polls make no LLM call (`callCount` stays flat); each change makes exactly one.
- `failNext` moves to the next provider and succeeds, using two mock instances; providers without keys are never called.
- Persistent failure ends as `failed` with the snapshot intact.
- With `latencyMs` above the timeout, the call aborts and polling continues during the slow call.
- A crash mid-summary is retried after the retry time, and the attempt cap holds.
- Two concurrent checks don't double-poll or double-summarise.
- A failed snapshot write retries without fetching again and doesn't skip a stub version.
- A restart doesn't create a false change.
- API status codes and newest-first ordering.

End to end:

1. Run `cp .env.example .env`, then `docker compose up`, from a clean checkout.
2. Add all three competitors and watch the timelines fill with real DeepSeek summaries (only once you've provided a key; a full run is about 9 billed calls).
3. Restart the app container and confirm no false change appears.
4. Stop Postgres briefly and confirm the app recovers.
5. Remove a competitor.
6. Check the UI in a browser with the `browser-automation` skill.

Each real provider gets one live check only if you supply its key.

## Not included until you confirm

- Creating the new GitHub repo and pushing (deliverable). The active `gh` account is `Mottoweb`.
- Cloud deployment (bonus), which needs your choice of provider and account.

Commits and PRs on `step/*` branches are part of `/plan-step`. Merges happen only through `/plan-step approve`.
