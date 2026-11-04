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
| Frontend | React, Vite, TypeScript, `react-router`, shadcn/ui (step 9) | React is required by the brief. The brief doesn't grade polish, so shadcn/ui is your choice for the demo |
| API contract | `@nestjs/swagger` with response DTOs; `openapi-typescript` and `openapi-fetch` generate the web client (step 8) | The spec comes from the code and is the one contract between server and web |
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
- **API contract:** the OpenAPI spec generated from the server's DTOs and committed at `server/openapi.json` is the one contract. The web app's types and requests are generated from it, so a contract change breaks the web compile once regenerated, and tests fail if the spec or the generated types are out of date. (updated by step 8)
- **Untrusted data:** env vars, request bodies, fixtures and LLM responses are parsed with `zod`, with types inferred from the schemas. `unknown` is narrowed, never cast. The web app is the exception for success responses from its own API: it trusts the generated types, and contract tests check real responses against the spec. Error bodies are still narrowed, because they can come from a proxy. (updated by step 8)
- **Database:** prefer typed repository methods. Query builder strings can't be compiler-checked, so integration tests cover them. Raw queries declare an explicit row type.
- **Closed sets:** statuses and provider names are string-literal unions, with exhaustive `switch` checks.
- **Check:** `npm run test:all` runs type checks, lint, unit tests and integration tests.

## Database layer rules

- **Migrations:** `typeorm migration:generate` from the entities, reviewed and committed, with `synchronize: false` everywhere. Compose runs `migration:run` as a one-shot service before the app starts, so multiple instances don't race to apply migrations.
- **Queries:** repositories and the query builder only. No eager or lazy relations, so every query stays visible. Foreign keys are still declared, including `ON DELETE CASCADE`.
- **Claims:** a short transaction using `setLock('pessimistic_write')`, `setOnLocked('skip_locked')` and `limit`, then a batch `update` with `In(ids)`. It commits before any network call.
- **Raw SQL:** allowed through `dataSource.query` where the query builder obscures a query, with an explicit row type.
- **Query logging:** off unless `LOG_SQL=true`, so the normal logs stay readable and the SQL is available on request. (updated by step 7)
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
server/src/health/         # GET /healthz
server/migrations/
server/src/web/            # serves the built web app
web/src/                   # CompetitorList, Timeline, api client on openapi-fetch
server/src/openapi/        # Swagger setup, spec generation, error DTO
server/openapi.json        # committed spec, from npm run openapi:generate
web/src/generated/         # types generated from the spec
files/                     # provided, unchanged
.github/workflows/ci.yml
Dockerfile, docker-compose.yml, .env.example, .gitignore, README.md
```

## Status

Managed by `/plan-step`. A step is ticked only when you run `/plan-step approve`.

- [x] Step 1: Scaffold (PR #2)
- [x] Step 2: Postgres layer (PR #3)
- [x] Step 3: Postgres review package (dropped, PR #4 closed unmerged)
- [x] Step 4: Polling (PR #5)
- [x] Step 5: Summaries (PR #6)
- [x] Step 6: API (PR #7)
- [x] Step 7: Frontend (PR #8)
- [x] Step 8: Swagger and generated client (PR #9)
- [ ] Step 9: shadcn/ui
- [ ] Step 10: Packaging
- [ ] Step 11: README
- [ ] Step 12: Study doc

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
- **Step 10:** 32 low and moderate audit findings remain in dev tooling and are accepted. The Dockerfile's production image must omit dev dependencies.
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

**Step 3 (dropped)**

You decided the review document wasn't needed, so PR #4 was closed unmerged. Its branch `step/3-postgres-review` is kept as source material for step 12. Facts from its measurements on 1M snapshots:

- **Backward scan confirmed:** the timeline with a `limit` and the previous-snapshot lookup both read `(competitor_id, id)` backward with no sort, so the index doesn't need `DESC`.
- **Claims:** both claim queries use their intended index, with `LockRows` under `Limit`.
- **Step 7:** the timeline with no `limit` reads and sorts every row. It took about 4 ms for 3,504 rows, but a year's history is projected at about 15 MB per request, and the UI refetches every 5s. The UI should pass `?limit=`.
- **Step 10:** a parallel `VACUUM` failed on Docker's default 64 MB `/dev/shm`. Set `shm_size` on the `db` service.

**Step 4**

Deviations:

- **Module boot test:** `app.module.spec.ts` became `app.module.integration.spec.ts`, because booting `AppModule` now needs Postgres. Its assertions are unchanged, with one new test added.
- **`fsync=off` on the test container:** `DROP DATABASE` checkpoints queued past Jest's 5s hook timeout with more spec files. This only affects the throwaway Testcontainers Postgres.

Facts later steps need:

- **Registered modules:** `DatabaseModule`, `PollerModule` (exports `SnapshotQueries`) and `SummarizerModule` (exports `SummaryQueries`). `SummarizerModule` holds only the queries so far.
- **`.env` loading:** `main.ts` loads the repo root's `.env` before creating the app, so settings read in Nest factories can use `process.env`.
- **Worker pattern for step 5:** `PollWorker.check()` never rejects and joins a check already running. It starts in `onApplicationBootstrap`, and waits in `beforeApplicationShutdown`, because the database closes in the later shutdown hook. Tests call `check()` directly and pass config in, so they don't sleep.
- **Step 6:** `ListingSource` only has `fetchListing`, so the 422 for an id the source doesn't know needs a new method on it.
- **Port:** 3000 is still hardcoded in `main.ts`.

**Step 5**

Deviations:

- **`mock` provider:** an eighth row in the provider table, so stored summaries say `mock` rather than naming a real provider. It is last in the default order and is enabled by `MOCK_API_KEY`.
- **Anthropic:** a small adapter on `@anthropic-ai/sdk`, not the OpenAI-compatible endpoint. Default model `claude-opus-5-5`, overridable with `ANTHROPIC_MODEL`. Its server-side `fallbacks` option isn't used; a refusal has no text, so it fails over like an empty reply.
- **Token limit setting:** the provider table says whether to send `max_tokens` or `max_completion_tokens`, which OpenAI's newer models are reported to need. The limit is 1000, because thinking models count their thinking against it.
- **Mock LLM in tests:** specs start the provided mock on free ports, so CI no longer starts instances on 4001 and 4002. Integration tests now need `python3`.
- **Test changes:** the Anthropic test asserts `Authorization: Bearer`, which SDK 1.4.0 sends, not `x-api-key`. "Refuses to start" moved to `llm.module.spec.ts`, because booting `AppModule` left a database connection retrying after Jest shut down, which failed one CI run after all tests had passed.

Choices made during the step, which the user reviewed at approval:

- `LLM_PROVIDER_ORDER` is also an allow-list, and rejects unknown or repeated names.
- An explicit `LLM_MAX_ATTEMPTS` is used as given, even below the provider count.
- 408 is transient, and any other 4xx outside the failover table is treated like a 400.
- A bad key retries on the next provider with no delay; transient failures back off from 5s, doubling up to 60s. Cooldowns are 30s and 5 minutes.
- Fields stay capped at 2,000 characters in the prompt. See the known limit in step 11.

Facts later steps need:

- **Starting the app needs a provider key:** any test that boots `AppModule` must remove real keys from `process.env` and set a dummy one, as `app.module.integration.spec.ts` does. Otherwise it could call a real provider, or fail to start.
- **Test helper:** `MockLlm` in `server/src/testing/mock-llm.ts` starts the provided mock on a free port.
- **Modules:** `LlmModule` exports `LLM_CONFIG`, `ProviderFailover` and `LLM_CLIENT`. `SummarizerModule` now runs `SummaryWorker`.
- **Checked by hand:** the built app ran against a throwaway Postgres and the mock. It refused to start with no key (exit 1), made 3 calls for 6 snapshots, retried after an injected 500, and showed no false change after a restart.

Known gaps, accepted at approval:

- **No real provider has been called.** `gemini-3.8-flash` came from Google's docs, the other default models from third-party sources, and `grok-4` from no source. Each can be overridden with `<PROVIDER>_MODEL`.
- **Gemini with a bad key** may return 400 rather than 401, which would mark summaries `failed` instead of failing over. This is untested.
- **A slow call holds its batch:** the next claim waits for the whole batch, for up to the 30s timeout.

**Step 6**

Deviations:

- **Health folder:** `GET /healthz` lives in `server/src/health/`, which the layout above didn't list.
- **Test doubles:** the two `ListingSource` doubles in `poll-worker.integration.spec.ts` gained `isKnown` in the tests commit, because the interface grew.

Choices made during the step, which the user reviewed at approval:

- A competitor id is 1 to 100 lowercase letters, digits and single hyphens. A malformed id gets 400 on POST and 404 on DELETE and GET snapshots.
- `?limit=` is a positive integer with no upper limit. An invalid value gets 400.
- POST returns `{ "id": ... }`, and `GET /api/competitors` sorts by id.
- `/healthz` returns `{ "status": "ok" }`, or 503 with `{ "status": "unavailable" }`. The error goes to the log, not the response.

Facts later steps need:

- **Errors:** responses use Nest's default shape, `{ message, error, statusCode }`, and `message` is written to be shown to the user. `shared` has no type for this yet.
- **No snapshot id in the API:** `Snapshot` has no `id` field, so the timeline needs another React key, such as `fetchedAt`.
- **Port:** `PORT` sets the port, defaulting to 3000. `.env.example` lists it.
- **API tests:** they set `CHECK_INTERVAL_SECONDS=3600` so the worker timers stay quiet, and call `check()` directly.
- **Checked by hand:** the built app ran against a throwaway Postgres and the mock. With Postgres stopped, `/healthz` returned 503 and the list returned 500; both returned 200 once it was back.

Known gaps, accepted at approval:

- **Unresponsive Postgres:** `/healthz` has no timeout of its own, so a host that never answers could leave the request hanging.
- **Delete and re-add during a poll:** a fetch already in progress could save a stale version into the new history. The window is narrow and has no test.
- **API errors while Postgres is down:** endpoints other than `/healthz` return a generic 500, not a 503.
- **503 test:** the automated `/healthz` 503 test uses a fake `DataSource`. Only the manual run used a really stopped Postgres.

**Step 7**

Deviations:

- **Query logging:** opt-in through `LOG_SQL=true`, not on in development, because you found the logs unreadable. Polls, summaries, adds, removes and startup each write a plain line instead.
- **Test change:** `web.integration.spec.ts` boots with `NestFactory.create`, agreed during the step. Under `Test.createTestingModule`, `serve-static` finds no HTTP adapter at compile time and silently uses a no-op loader. The `config.spec.ts` table for query logging was replaced because the behaviour changed.
- **Layout:** adds `server/src/web/` and `web/src/testing/`.

Choices made during the step, which the user reviewed at approval:

- "Show older" asks for 100 snapshots and adds 100 per click, so the whole history stays reachable.
- The web app parses responses with `zod`. Step 8 removes this.
- `WEB_DIST_DIR` overrides where the built web app is served from, so tests can serve a stand-in, because CI doesn't build the web app first.
- Remove has no confirmation, although it deletes the competitor's history.

Facts later steps need:

- **Step 8:** `web/vite.config.ts` aliases `@competitor-pulse/shared` to its source, because the CommonJS build can't load in the browser. Remove this with `shared/`. `web/src/testing/fake-api.ts` stubs `fetch` with a string URL, and `openapi-fetch` calls it differently, so the stub needs adapting. The "reports a response that breaks the contract" test goes with `zod`. `/api/*` is excluded from static serving, so Swagger UI can live there.
- **Step 9:** the web tests find elements by role and text, so they should mostly carry over.
- **Step 10:** the app serves `web/dist`, found relative to `server/dist/src/web`, so the image must build the web app and keep that layout, or set `WEB_DIST_DIR`. From the library's code, a missing build should still boot and return 404 on non-API paths; this hasn't been run.
- **Step 11:** for development, `npm run start:dev -w @competitor-pulse/server` restarts on source changes, but not on `.env` or `shared` changes. `npm start` runs `dist` once. Document `LOG_SQL`. Checking the DeepSeek result is still open: you reported "all is good" after adding a key, but the run wasn't confirmed from the database.
- **Checked by hand:** the built app ran against a throwaway Postgres and the mock in headless Chromium, covering add, remove, the 400, 409 and 422 messages, a timeline filling in with no reload, and a deep-link reload. The proxy and alias were checked through Vite. The browser skill's expected Chromium wasn't installed, so this used an older cached build.

Known gaps, accepted at approval:

- **A hung request** pauses that timeline's refetching until the browser gives up, with no client timeout or test.
- **Idle checks log nothing,** so a quiet log can look like a stopped worker. Each poll logs a line, including `no change`; lower that to debug level in production.
- **Exclude list:** tests prove the `/api` entry. The `/healthz` entry is unproven, because its controller answers first with or without it.

**Step 8**

Deviations:

- **Swagger UI path:** `/api/docs`, with the document at `/api/docs-json`, not `/api` itself. `/api` stays a JSON 404 and its test is unchanged.
- **Static serving:** `WebModule` limits the app's fallback route with `renderPath`, not `exclude`. `serve-static`'s error handler answers 404 to any error on an excluded path, so malformed JSON on POST returned 404 in the real app since step 7. It now returns 400, and an oversized body returns 413. This also replaces the step 7 gap about the exclude list.
- **Test changes, in the tests commit:** removed the web test "reports a response that breaks the contract", which went with `zod`; removed the `SUMMARY_STATUSES` assertion from the `AppModule` boot test; pointed contract imports at the server's `contract.ts` and the web's `api.ts`; replaced `zod` with a type check in a `CompetitorList.spec.tsx` helper.
- **Test change after the tests commit, agreed in review:** the Swagger UI test reads the asset responses. Unread responses held connections open, so `app.close()` stalled and `afterAll` timed out.

Choices made during the step, which the user reviewed at approval:

- `@ApiSchema` keeps the contract names (`Snapshot`, not `SnapshotDto`) in the spec and generated types.
- Swagger UI and the document are served in every environment, with no auth.
- `ajv` and `ajv-formats` are dev dependencies, used to check real responses against the spec. The test helper `closeObjects` makes undeclared fields fail, because the generated schemas allow them.

Facts later steps need:

- **Refreshing the contract:** after changing a controller or DTO, run `npm run openapi:generate`. It writes `server/openapi.json` and `web/src/generated/api.ts`, and tests fail if either is stale. It needs no database, because Nest's preview mode creates no providers.
- **Contract files:** `server/src/competitors/contract.ts` holds the contract types and `SUMMARY_STATUSES`. DTOs in `competitors.dto.ts` implement them. `openapi-typescript` installs its own TypeScript 5.9, because it doesn't declare support for 6; the repo stays on 6 with no override.
- **Tests:** `web/src/testing/fake-api.ts` stubs `fetch` with a `Request`, and the client looks up `globalThis.fetch` on each call so the stub applies. `server/src/testing/openapi-contract.ts` provides `specViolations`. A test that uses `fetch` must read each response, or `app.close()` stalls.
- **Step 10:** there is no `shared` workspace to build any more. `@nestjs/swagger` is a production dependency, the document is built at startup, and the image doesn't need `server/openapi.json`.
- **Step 11:** `npm start` has no root script, so use `npm start -w @competitor-pulse/server`. The README entry above lists the rest.
- **Checked by hand:** the built app ran against a throwaway Postgres and the mock in headless Chromium, using cached build 1243 because the browser skill's expected one isn't installed. It covered add, remove, the 400, 409 and 422 messages, a timeline filling in with a summary, a deep-link reload and Swagger UI.

Known gaps, accepted at approval:

- **Failed `DELETE` report:** the browser reported the `DELETE` as a failed request, although the competitor was removed and the refreshed list was empty. The cause wasn't found. `openapi-fetch` doesn't cancel the 204 body.
- **No run-time check in the web app:** a response that breaks the spec reaches the UI unchecked, and a 200 with a non-JSON body shows "Could not reach the server".
- **500 responses** are declared in the spec, but no test checks a real one. The 503 check uses a fake `DataSource`.
- **Vite dev proxy:** not run in this step. Its config is unchanged apart from removing the alias.
- **CI at merge:** CI passed on the final code (`9d4e8f8`). The merge didn't wait for the runs on the commits after it, which only change this file.

## Implementation steps

**Each step is one PR, run with `/plan-step`:** it writes failing tests, implements, verifies, opens a PR and lists what you should check. It merges and ticks the step only after `/plan-step approve`. Later plan changes are made in this file.

**Every step follows test-first development:**

1. **Write the tests first,** from the brief and this plan.
2. **Run them and confirm they fail.** They must fail on an assertion because the behaviour is missing, not because of a typo or setup error. Only the type signatures and empty stubs needed to compile may exist at this point.
3. **Implement** until the tests pass.
4. **Run `npm run test:all`** before moving on.
5. **Report both runs,** failing and passing, for each step.

**When a test fails after implementation, fix the code, not the test.** Tests are never weakened, skipped, deleted or edited just to pass. If a test itself looks wrong against the brief, stop and show you why, and change it only with your agreement.

**Steps with no behaviour of their own:** step 1 has one failing smoke test of the test setup itself. Step 10 starts with a failing script that checks `docker compose up` brings the system to a healthy state and serves the API. Step 11 (README) has no tests; instead, its run instructions get followed from a clean checkout. Step 12 (study doc) has no tests either.

1. **Scaffold:** npm workspaces (`server`, `web`, `shared`), NestJS project, strict TypeScript and ESLint config, Jest, `npm run test:all`, compose with Postgres, `.gitignore`, the GitHub Actions CI workflow, and remove the committed `.DS_Store` files.
2. **Postgres layer:** entities, generated migrations and all queries (claim due competitors, save snapshot with diff, claim and complete summaries, read timeline), with integration tests including concurrent claims.
3. **Postgres review package:** dropped. See the implementation log.
4. **Polling:** source stub, poll worker, write retries. Also wires the database into Nest: install `@nestjs/typeorm` 11, register the query classes, and load `.env` in `main.ts`. `app.module.spec.ts` is a unit test that boots `AppModule` with no services, so importing the database there means deciding how that test changes, with your agreement. (updated by step 2)
5. **Summaries:** LLM providers, failover, summary worker.
6. **API:** competitor and snapshot endpoints, `/healthz`. API tests that boot `AppModule` need the provider setup described in the step 5 log. (updated by step 5)
7. **Frontend:** both views, served by NestJS (`@nestjs/serve-static`) with a Vite proxy in development. Show the API's `message` field for errors, and pass `?limit=` on the timeline. Exclude `/api` and `/healthz` from static serving. (updated by step 6)
8. **Swagger and generated client:** `@nestjs/swagger` with response DTO classes that `implements` the contract, Swagger UI under `/api`, and a committed spec file. `openapi-typescript` and `openapi-fetch` generate the web client's types and requests. Tests: real responses are checked against the spec, and a test fails if the committed spec is out of date. Remove `shared/` (server types move into the server) and `zod` from the web app, including the Vite alias. Chosen after comparing `nestjs-zod` and a hand-written spec, and Orval and Hey API. (added by step 7)
9. **shadcn/ui:** add Tailwind and shadcn/ui, and restyle both views. Behaviour doesn't change, so the existing web tests are the check, with any test change explained. (added by step 7)
10. **Packaging:** Dockerfile, and compose with db, a one-shot migrate service, mock-llm and app, including restart policies. The production image has no dev dependencies, so the migrate service must run the compiled `dist/migrations` without `ts-node`, using a compiled data source. Compose needs `.env`, so `docker compose up` from a clean checkout needs `cp .env.example .env` first. The image must include `files/fixtures/listings.json` at the same path relative to `server/dist`, because the stub reads it at startup. The app needs a provider key to start, so compose sets `MOCK_API_KEY` and points `MOCK_BASE_URL` at the mock-llm service. Set `stop_grace_period` above the 30s LLM timeout, so a stop can finish calls in progress. An app healthcheck on `/healthz` must set its own timeout, because the endpoint has none. (updated by step 2, step 4, step 5 and step 6)
11. **README:** the last change to the repo, written once everything else is merged, so it describes the system as delivered. It covers what the brief asks for and what a developer new to the repo would expect.
   - **Asked for by the brief:**
     - How to install, build and run locally, with and without compose, including `cp .env.example .env` as a required first step.
     - Which LLM option was used and how to configure it, including running against the mock.
     - Assumptions made.
     - AI tools used (Claude Code).
     - How it was deployed and how to access it, only if the cloud bonus is done.
   - **What it is:** a short description, the system overview above, and the tech stack.
   - **Prerequisites:** Node version, Docker, and `python3` for the mock LLM and integration tests.
   - **Configuration:** a table of every environment variable, with its default, whether it's required, and what it does, including `LOG_SQL`.
   - **API:** the endpoints and their status codes, the fields added beyond the brief, Swagger UI at `/api/docs`, and the committed spec. (updated by step 8)
   - **Development:** the dev commands, including that `npm run start:dev -w @competitor-pulse/server` restarts on source changes but not on `.env` changes, and the Vite dev server and its proxy.
   - **Common tasks:** running each test command and what it needs, creating and running migrations, and refreshing the spec and web types with `npm run openapi:generate`. (updated by step 8)
   - **Project layout:** the main folders and what each one holds.
   - **Troubleshooting:** the app refusing to start with no provider key, missing `POSTGRES_*` variables, and a port already in use.
   - **Scale and production notes:** including the Postgres standby, snapshot growth, and the cost controls.
   - **Known limits:**
     - The prompt caps each listing field at 2,000 characters, so a change past the cap is detected and stored but the LLM can't see it, and its summary may be vague or wrong. The stub's fields are far shorter, so this can't happen today; a real fetcher should send an excerpt around the change. (updated by step 5)
     - Any other gaps still open in the implementation log.
   - **Which real providers were actually tested.**
   - **Not in the README:** interview preparation, which stays in the study doc outside the repo.
12. **Study doc:** a document for you to study so you can defend the design in the interview, kept outside the repo, so step 12 opens no PR: each decision and its alternatives, how the code implements it, and likely interview questions with answers. Explain the Postgres concepts carefully (row locks, `SKIP LOCKED`, transactions, indexes, query plans), and compare them with Redis and BullMQ, which you know better. Reuse the measurements on the `step/3-postgres-review` branch. Include the step 8 and step 9 choices.

## Verification

**CI (GitHub Actions):** `.github/workflows/ci.yml` runs on every pull request, and again on each new push to it. Type checks, lint, unit tests and integration tests are separate named steps, so a PR shows which one failed. It sets no provider keys, and the specs start their own mock LLM servers. (updated by step 5) A step can't be approved until CI is green.

**Test commands:**

| Command | Runs | Needs |
|---|---|---|
| `npm run test:unit` (also `npm test`) | `*.spec.ts` | Nothing |
| `npm run test:integration` | `*.integration.spec.ts` | Docker, `python3` |
| `npm run test:all` | Types, lint, unit tests, integration tests | Docker, `python3` |

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

- Response shape checked against the server's contract and the committed OpenAPI spec, including `summary` being `null` when unchanged, pending or failed. (updated by step 8)
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
