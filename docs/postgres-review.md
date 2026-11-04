# Postgres review package

This document shows what the database layer really does, so it can be approved before anything is built on it. The SQL and query plans below were captured from the code on `main` at `31d3c8b`, not written by hand.

**Verdict:** every claim, every read in the save transaction and the limited timeline uses the intended index or scan, and finishes in under a millisecond on a 1M-row table. The exception is the timeline with no `limit`. That query doesn't use the backward scan, and it's the one to watch (finding 1).

## Findings

| # | Finding | Evidence | Suggested action |
|---|---|---|---|
| 1 | The timeline with no `limit` doesn't use a backward scan. It reads every row and sorts them, and each row sat on its own table page. | Section 4.5: 3,504 rows, 3,537 buffers, about 4 ms with everything in cache | Decide in step 6 or 7. The brief wants full history from the API, but the UI refetches every 5s, so it should probably pass `?limit=`. |
| 2 | Parallel `VACUUM` failed on the default compose setup, because Docker gives the container only 64 MB of `/dev/shm`. | `could not resize shared memory segment ... to 67128736 bytes: No space left on device` on `VACUUM ANALYZE` of this dataset | Set `shm_size` on the `db` service in step 8. |
| 3 | The timeline with a `limit`, and the previous-snapshot lookup, do use a backward scan of `(competitor_id, id)`. This settles the question left open in step 2: the index doesn't need to be `DESC`. | Sections 4.4, 4.6 and 4.7 | None. |
| 4 | Both claim queries put `LockRows` under `Limit`, so skipped rows don't use up the batch. | Sections 4.1 and 4.2 | None. |
| 5 | The partial index keeps the summary claim independent of table size: 16 kB against a 457 MB table. | Section 4.2 and the dataset table | None. |
| 6 | Lookups by primary key on `competitors` use a sequential scan. This is the right choice at this size, because the table is only 3 pages. | Sections 4.1b and 4.3 | None. |

**Finding 1 in numbers.** These are projections from the measurements here, not measurements. One competitor gains about 35,000 rows a year. At about 435 bytes per row (457 MB / 1.05M rows), that is roughly 15 MB read per request. The sort used 1,576 kB for 3,504 rows, so it would need about 16 MB and overflow Postgres's default 4 MB `work_mem` onto disk. Each row is on its own page, so with a cold cache one request could mean tens of thousands of page reads.

**Finding 2 in context.** Autovacuum doesn't use parallel workers in Postgres 16, so normal operation doesn't hit this. A manual `VACUUM` does, and so can other parallel operations such as index builds. No query in this document ran in parallel.

## How this was produced

- **Server:** PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2), from the compose `db` service with default settings.
- **Database:** a throwaway `competitor_pulse_review` database inside dev Postgres. It was dropped afterwards, so dev data wasn't touched.
- **SQL capture:** a TypeORM `Logger` recorded every statement while the real `SnapshotQueries` and `SummaryQueries` methods ran. The capture script isn't committed, because this step only adds this document. Section 5 reproduces the migration, the data and the key plans.
- **Plans:** `EXPLAIN (ANALYZE, BUFFERS)` of the captured SQL, run in a transaction that was rolled back. Each query ran once first, so the plans show a warm cache. Timings are from a laptop, and are useful only for comparing queries with each other.

| Dataset | Value |
|---|---|
| Competitors | 300 (10 due) |
| Snapshots | 1,051,200: 3,504 per competitor, about 36 days at one poll per 15 minutes |
| Pending summaries | 25 (20 due, 5 waiting on a retry time) |
| `snapshots` table | 457 MB |
| `snapshots_competitor_id_id_idx` | 72 MB |
| `snapshots_summary_due_idx` | 16 kB |

Rows were inserted round by round, so one competitor's snapshots are spread across the table, as they would be in production. Seeded descriptions are 264 characters, longer than the fixtures, so the sizes above lean high.

## 1. Entities

`server/src/competitors/competitor.entity.ts`

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'competitors' })
export class Competitor {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // Defaults to now() so a newly added competitor is due immediately.
  @Index('competitors_next_poll_at_idx')
  @Column({ name: 'next_poll_at', type: 'timestamptz', default: () => 'now()' })
  nextPollAt!: Date;
}
```

`server/src/poller/snapshot.entity.ts`

```ts
import { SUMMARY_STATUSES, type SummaryStatus } from '@competitor-pulse/shared';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Competitor } from '../competitors/competitor.entity';

@Entity({ name: 'snapshots' })
@Index('snapshots_competitor_id_id_idx', ['competitorId', 'id'])
@Index('snapshots_summary_due_idx', ['summaryNextAttemptAt'], {
  where: `summary_status = 'pending'`,
})
export class Snapshot {
  // The pg driver returns bigint as a string, because it can exceed 2^53.
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'competitor_id', type: 'text' })
  competitorId!: string;

  // Declared only for the foreign key. Queries never load it.
  @ManyToOne(() => Competitor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'competitor_id' })
  competitor?: Competitor;

  @Column({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt!: Date;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text' })
  tagline!: string;

  @Column({ type: 'text' })
  price!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'content_hash', type: 'text' })
  contentHash!: string;

  @Column({ type: 'boolean' })
  changed!: boolean;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({
    name: 'summary_status',
    type: 'enum',
    enum: SUMMARY_STATUSES,
    enumName: 'summary_status',
    default: 'none',
  })
  summaryStatus!: SummaryStatus;

  @Column({ name: 'summary_attempts', type: 'integer', default: 0 })
  summaryAttempts!: number;

  @Column({
    name: 'summary_next_attempt_at',
    type: 'timestamptz',
    nullable: true,
  })
  summaryNextAttemptAt!: Date | null;

  @Column({ name: 'summary_error', type: 'text', nullable: true })
  summaryError!: string | null;

  @Column({ name: 'summary_provider', type: 'text', nullable: true })
  summaryProvider!: string | null;

  @Column({ name: 'summary_model', type: 'text', nullable: true })
  summaryModel!: string | null;
}
```

`server/src/source/source-cursor.entity.ts`

```ts
import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Competitor } from '../competitors/competitor.entity';

@Entity({ name: 'source_cursors' })
export class SourceCursor {
  @PrimaryColumn({ name: 'competitor_id', type: 'text' })
  competitorId!: string;

  // Declared only for the foreign key. Queries never load it.
  @OneToOne(() => Competitor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'competitor_id' })
  competitor?: Competitor;

  @Column({ type: 'integer', default: 0 })
  position!: number;
}
```

## 2. Generated migration SQL

The statements as executed by `InitialSchema1793780521662`, without TypeORM's own bookkeeping. The generated migration is committed at `server/migrations/1793780521662-InitialSchema.ts`, and an integration test checks it for drift against the entities.

```sql
CREATE TABLE "competitors" (
    "id" text NOT NULL,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "next_poll_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT "PK_76a451dd0c8a51a0e0fb6284389" PRIMARY KEY ("id")
)

CREATE INDEX "competitors_next_poll_at_idx" ON "competitors" ("next_poll_at")

CREATE TYPE "public"."summary_status" AS ENUM('none', 'pending', 'done', 'failed')

CREATE TABLE "snapshots" (
    "id" BIGSERIAL NOT NULL,
    "competitor_id" text NOT NULL,
    "fetched_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "title" text NOT NULL,
    "tagline" text NOT NULL,
    "price" text NOT NULL,
    "description" text NOT NULL,
    "content_hash" text NOT NULL,
    "changed" boolean NOT NULL,
    "summary" text,
    "summary_status" "public"."summary_status" NOT NULL DEFAULT 'none',
    "summary_attempts" integer NOT NULL DEFAULT '0',
    "summary_next_attempt_at" TIMESTAMP WITH TIME ZONE,
    "summary_error" text,
    "summary_provider" text,
    "summary_model" text,
    CONSTRAINT "PK_f5661b5fd4224d23e26a631986b" PRIMARY KEY ("id")
)

CREATE INDEX "snapshots_summary_due_idx" ON "snapshots" ("summary_next_attempt_at")
WHERE summary_status = 'pending'

CREATE INDEX "snapshots_competitor_id_id_idx" ON "snapshots" ("competitor_id", "id")

CREATE TABLE "source_cursors" (
    "competitor_id" text NOT NULL,
    "position" integer NOT NULL DEFAULT '0',
    CONSTRAINT "PK_e270718e6f70f28d30254dfd82a" PRIMARY KEY ("competitor_id")
)

ALTER TABLE "snapshots"
ADD CONSTRAINT "FK_4c88bf4c55ff4fa8268120d3c1d" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE NO ACTION

ALTER TABLE "source_cursors"
ADD CONSTRAINT "FK_e270718e6f70f28d30254dfd82a" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE NO ACTION
```

`DEFAULT '0'` on the integer columns is how TypeORM writes the default. Postgres casts it to an integer, so it behaves the same as `DEFAULT 0`.

## 3. SQL TypeORM actually runs

Parameters are shown as captured. `IN ($n)` holds one id here because the capture used one row; a real batch gets one placeholder per id.

### `claimDueCompetitors`

```sql
START TRANSACTION

SELECT "competitor"."id" AS "competitor_id" FROM "competitors" "competitor" WHERE "competitor"."next_poll_at" <= now() ORDER BY "competitor"."next_poll_at" ASC LIMIT 10 FOR UPDATE SKIP LOCKED

UPDATE "competitors" SET "next_poll_at" = now() + make_interval(secs => $1::double precision
              * (1 + $2::double precision * (2 * random() - 1))) WHERE "id" IN ($3)
-- parameters: [900,0.1,"competitor-0001"]

COMMIT
```

### `saveSnapshot`, first snapshot

`summary_next_attempt_at` is bound to `null`, and the status is `none`.

```sql
START TRANSACTION

SELECT "Competitor"."id" AS "Competitor_id" FROM "competitors" "Competitor" WHERE (("Competitor"."id" = $1)) LIMIT 1 FOR UPDATE
-- parameters: ["competitor-0001"]

SELECT "Snapshot"."content_hash" AS "Snapshot_content_hash", "Snapshot"."id" AS "Snapshot_id" FROM "snapshots" "Snapshot" WHERE (("Snapshot"."competitor_id" = $1)) ORDER BY "Snapshot"."id" DESC LIMIT 1
-- parameters: ["competitor-0001"]

INSERT INTO "snapshots"("competitor_id", "fetched_at", "title", "tagline", "price", "description", "content_hash", "changed", "summary", "summary_status", "summary_attempts", "summary_next_attempt_at", "summary_error", "summary_provider", "summary_model") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, DEFAULT, $9, DEFAULT, $10, DEFAULT, DEFAULT, DEFAULT) RETURNING "id", "summary_status", "summary_attempts"
-- parameters: ["competitor-0001","2026-11-04T09:12:34.806Z","Acme","Fast","$1","A listing","c6f47966cadabb1164dfabdbcabbd739361d0a65fd86054b539f91afdf3577f3",false,"none",null]

COMMIT
```

### `saveSnapshot`, changed listing

Only the insert differs: the status is `pending`, and `summary_next_attempt_at` is `now()`, the database's clock.

```sql
START TRANSACTION

SELECT "Competitor"."id" AS "Competitor_id" FROM "competitors" "Competitor" WHERE (("Competitor"."id" = $1)) LIMIT 1 FOR UPDATE
-- parameters: ["competitor-0001"]

SELECT "Snapshot"."content_hash" AS "Snapshot_content_hash", "Snapshot"."id" AS "Snapshot_id" FROM "snapshots" "Snapshot" WHERE (("Snapshot"."competitor_id" = $1)) ORDER BY "Snapshot"."id" DESC LIMIT 1
-- parameters: ["competitor-0001"]

INSERT INTO "snapshots"("competitor_id", "fetched_at", "title", "tagline", "price", "description", "content_hash", "changed", "summary", "summary_status", "summary_attempts", "summary_next_attempt_at", "summary_error", "summary_provider", "summary_model") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, DEFAULT, $9, DEFAULT, now(), DEFAULT, DEFAULT, DEFAULT) RETURNING "id", "summary_status", "summary_attempts"
-- parameters: ["competitor-0001","2026-11-04T09:12:34.821Z","Acme","Fast","$2","A listing","98c22fe64cc4fd0c5f54fb9073ca9b43d9fb0b877f662469903f4d3ce90af898",true,"pending"]

COMMIT
```

### `saveSnapshot`, competitor already deleted

The lock finds nothing, so nothing is written.

```sql
START TRANSACTION

SELECT "Competitor"."id" AS "Competitor_id" FROM "competitors" "Competitor" WHERE (("Competitor"."id" = $1)) LIMIT 1 FOR UPDATE
-- parameters: ["competitor-gone"]

COMMIT
```

### `listTimeline`, with and without `limit`

There's no extra id-lookup query, because these queries have no joins.

```sql
SELECT "Snapshot"."id" AS "Snapshot_id", "Snapshot"."competitor_id" AS "Snapshot_competitor_id", "Snapshot"."fetched_at" AS "Snapshot_fetched_at", "Snapshot"."title" AS "Snapshot_title", "Snapshot"."tagline" AS "Snapshot_tagline", "Snapshot"."price" AS "Snapshot_price", "Snapshot"."description" AS "Snapshot_description", "Snapshot"."content_hash" AS "Snapshot_content_hash", "Snapshot"."changed" AS "Snapshot_changed", "Snapshot"."summary" AS "Snapshot_summary", "Snapshot"."summary_status" AS "Snapshot_summary_status", "Snapshot"."summary_attempts" AS "Snapshot_summary_attempts", "Snapshot"."summary_next_attempt_at" AS "Snapshot_summary_next_attempt_at", "Snapshot"."summary_error" AS "Snapshot_summary_error", "Snapshot"."summary_provider" AS "Snapshot_summary_provider", "Snapshot"."summary_model" AS "Snapshot_summary_model" FROM "snapshots" "Snapshot" WHERE (("Snapshot"."competitor_id" = $1)) ORDER BY "Snapshot"."id" DESC LIMIT 50
-- parameters: ["competitor-0001"]

SELECT "Snapshot"."id" AS "Snapshot_id", "Snapshot"."competitor_id" AS "Snapshot_competitor_id", "Snapshot"."fetched_at" AS "Snapshot_fetched_at", "Snapshot"."title" AS "Snapshot_title", "Snapshot"."tagline" AS "Snapshot_tagline", "Snapshot"."price" AS "Snapshot_price", "Snapshot"."description" AS "Snapshot_description", "Snapshot"."content_hash" AS "Snapshot_content_hash", "Snapshot"."changed" AS "Snapshot_changed", "Snapshot"."summary" AS "Snapshot_summary", "Snapshot"."summary_status" AS "Snapshot_summary_status", "Snapshot"."summary_attempts" AS "Snapshot_summary_attempts", "Snapshot"."summary_next_attempt_at" AS "Snapshot_summary_next_attempt_at", "Snapshot"."summary_error" AS "Snapshot_summary_error", "Snapshot"."summary_provider" AS "Snapshot_summary_provider", "Snapshot"."summary_model" AS "Snapshot_summary_model" FROM "snapshots" "Snapshot" WHERE (("Snapshot"."competitor_id" = $1)) ORDER BY "Snapshot"."id" DESC
-- parameters: ["competitor-0001"]
```

### `claimPendingSummaries`

```sql
START TRANSACTION

SELECT "snapshot"."id" AS "snapshot_id", "snapshot"."summary_attempts" AS "snapshot_summary_attempts" FROM "snapshots" "snapshot" WHERE "snapshot"."summary_status" = 'pending' AND "snapshot"."summary_next_attempt_at" <= now() ORDER BY "snapshot"."summary_next_attempt_at" ASC LIMIT 5 FOR UPDATE SKIP LOCKED

UPDATE "snapshots" SET "summary_next_attempt_at" = now() + make_interval(secs => $1::double precision), "summary_attempts" = "summary_attempts" + 1 WHERE "id" IN ($2)
-- parameters: [60,"2"]

  SELECT cur.id, cur.competitor_id, cur.summary_attempts,
         cur.title, cur.tagline, cur.price, cur.description,
         prev.title AS previous_title, prev.tagline AS previous_tagline,
         prev.price AS previous_price, prev.description AS previous_description
  FROM snapshots cur
  JOIN LATERAL (
    SELECT p.title, p.tagline, p.price, p.description
    FROM snapshots p
    WHERE p.competitor_id = cur.competitor_id AND p.id < cur.id
    ORDER BY p.id DESC
    LIMIT 1
  ) prev ON true
  WHERE cur.id = ANY($1::bigint[])
  ORDER BY cur.id
-- parameters: [["2"]]

COMMIT
```

### `claimPendingSummaries`, row already at the attempt cap

The row is marked `failed`, and no attempt is counted.

```sql
START TRANSACTION

SELECT "snapshot"."id" AS "snapshot_id", "snapshot"."summary_attempts" AS "snapshot_summary_attempts" FROM "snapshots" "snapshot" WHERE "snapshot"."summary_status" = 'pending' AND "snapshot"."summary_next_attempt_at" <= now() ORDER BY "snapshot"."summary_next_attempt_at" ASC LIMIT 5 FOR UPDATE SKIP LOCKED

UPDATE "snapshots" SET "summary_status" = $1, "summary_next_attempt_at" = $2, "summary_error" = $3 WHERE "id" IN ($4)
-- parameters: ["failed",null,"Attempts exhausted: the last attempt never reported a result","2"]

COMMIT
```

### `scheduleSummaryRetry`

```sql
START TRANSACTION

UPDATE "snapshots" SET "summary_error" = $1 WHERE ("id" = $2 AND "summary_status" = $3 AND "summary_attempts" = $4)
-- parameters: ["timeout","2","pending",1]

UPDATE "snapshots" SET "summary_next_attempt_at" = now() + make_interval(secs => $1::double precision) WHERE "id" IN ($2)
-- parameters: [60,"2"]

COMMIT
```

### `completeSummary`

```sql
UPDATE "snapshots" SET "summary" = $1, "summary_status" = $2, "summary_provider" = $3, "summary_model" = $4, "summary_next_attempt_at" = $5, "summary_error" = $6 WHERE ("id" = $7 AND "summary_status" = $8)
-- parameters: ["Price changed","done","deepseek","m",null,null,"2","pending"]
```

### `failSummary`

```sql
UPDATE "snapshots" SET "summary_status" = $1, "summary_error" = $2, "summary_next_attempt_at" = $3 WHERE ("id" = $4 AND "summary_status" = $5 AND "summary_attempts" = $6)
-- parameters: ["failed","bad request",null,"2","pending",1]
```

## 4. Query plans

### 4.1 Claim due competitors, 10 due

The check every 15 seconds when there's work. `LockRows` sits under `Limit`, so a row locked by another instance is skipped and the batch still fills up.

```text
Limit  (cost=0.15..7.09 rows=10 width=30) (actual time=0.005..0.010 rows=10 loops=1)
  Buffers: shared hit=22
  ->  LockRows  (cost=0.15..8.48 rows=12 width=30) (actual time=0.005..0.009 rows=10 loops=1)
        Buffers: shared hit=22
        ->  Index Scan using competitors_next_poll_at_idx on competitors competitor  (cost=0.15..8.36 rows=12 width=30) (actual time=0.002..0.003 rows=10 loops=1)
              Index Cond: (next_poll_at <= now())
              Buffers: shared hit=2
Planning:
  Buffers: shared hit=2
Planning Time: 0.023 ms
Execution Time: 0.016 ms
```

### 4.1a Claim due competitors, none due

The usual check. It reads a single index page.

```text
Limit  (cost=0.15..4.86 rows=1 width=30) (actual time=0.004..0.005 rows=0 loops=1)
  Buffers: shared hit=1
  ->  LockRows  (cost=0.15..4.86 rows=1 width=30) (actual time=0.004..0.004 rows=0 loops=1)
        Buffers: shared hit=1
        ->  Index Scan using competitors_next_poll_at_idx on competitors competitor  (cost=0.15..4.85 rows=1 width=30) (actual time=0.003..0.003 rows=0 loops=1)
              Index Cond: (next_poll_at <= now())
              Buffers: shared hit=1
Planning:
  Buffers: shared hit=3
Planning Time: 0.084 ms
Execution Time: 0.015 ms
```

### 4.1b Move the next poll forward, batch of 10

A sequential scan, for the reason given in 4.3. The 93 buffers are mostly index maintenance, because `next_poll_at` is indexed and these updates therefore can't be HOT (heap-only tuple) updates.

```text
Update on competitors  (cost=0.03..7.75 rows=0 width=0) (actual time=0.069..0.070 rows=0 loops=1)
  Buffers: shared hit=93
  ->  Seq Scan on competitors  (cost=0.03..7.75 rows=10 width=14) (actual time=0.007..0.026 rows=10 loops=1)
        Filter: (id = ANY ('{competitor-0001,competitor-0002,competitor-0003,competitor-0004,competitor-0005,competitor-0006,competitor-0007,competitor-0008,competitor-0009,competitor-0010}'::text[]))
        Rows Removed by Filter: 290
        Buffers: shared hit=3
Planning Time: 0.025 ms
Execution Time: 0.076 ms
```

### 4.2 Claim pending summaries, limit 5

It uses the partial index, so cost doesn't depend on the size of `snapshots`. The `Filter` line looks redundant, but it's expected. Postgres keeps the condition for a `FOR UPDATE` query, so it can recheck a row that changed while the query waited on it. It removes nothing here, because every row in the index already matches.

```text
Limit  (cost=0.13..8.16 rows=1 width=26) (actual time=0.006..0.010 rows=5 loops=1)
  Buffers: shared hit=12
  ->  LockRows  (cost=0.13..8.16 rows=1 width=26) (actual time=0.006..0.009 rows=5 loops=1)
        Buffers: shared hit=12
        ->  Index Scan using snapshots_summary_due_idx on snapshots snapshot  (cost=0.13..8.15 rows=1 width=26) (actual time=0.003..0.004 rows=5 loops=1)
              Index Cond: (summary_next_attempt_at <= now())
              Filter: (summary_status = 'pending'::summary_status)
              Buffers: shared hit=3
Planning Time: 0.023 ms
Execution Time: 0.016 ms
```

### 4.2a Read claimed rows with their previous listing

One backward index probe per claimed row, each reading about 4 pages, rather than one per row in the table.

```text
Nested Loop  (cost=0.85..48.56 rows=5 width=676) (actual time=0.015..0.048 rows=5 loops=1)
  Buffers: shared hit=38
  ->  Index Scan using "PK_f5661b5fd4224d23e26a631986b" on snapshots cur  (cost=0.43..26.23 rows=5 width=352) (actual time=0.004..0.007 rows=5 loops=1)
        Index Cond: (id = ANY ('{1051186,1051184,1051192,1051189,1051197}'::bigint[]))
        Buffers: shared hit=18
  ->  Limit  (cost=0.43..4.45 rows=1 width=332) (actual time=0.008..0.008 rows=1 loops=5)
        Buffers: shared hit=20
        ->  Index Scan Backward using snapshots_competitor_id_id_idx on snapshots p  (cost=0.43..4695.73 rows=1168 width=332) (actual time=0.008..0.008 rows=1 loops=5)
              Index Cond: ((competitor_id = cur.competitor_id) AND (id < cur.id))
              Buffers: shared hit=20
Planning Time: 0.047 ms
Execution Time: 0.058 ms
```

### 4.2b Count the attempt, batch of 5

```text
Update on snapshots  (cost=0.43..26.26 rows=0 width=0) (actual time=0.060..0.060 rows=0 loops=1)
  Buffers: shared hit=83
  ->  Index Scan using "PK_f5661b5fd4224d23e26a631986b" on snapshots  (cost=0.43..26.26 rows=5 width=18) (actual time=0.007..0.013 rows=5 loops=1)
        Index Cond: (id = ANY ('{1051186,1051184,1051192,1051189,1051197}'::bigint[]))
        Buffers: shared hit=29
Planning Time: 0.027 ms
Execution Time: 0.067 ms
```

### 4.3 Save: lock the competitor

A sequential scan rather than the primary key, because the table is 3 pages and reading it directly is cheaper. It should switch to the primary key by itself as the table grows, which wasn't tested here.

```text
Limit  (cost=0.00..6.76 rows=1 width=22) (actual time=0.013..0.014 rows=1 loops=1)
  Buffers: shared hit=2
  ->  LockRows  (cost=0.00..6.76 rows=1 width=22) (actual time=0.013..0.013 rows=1 loops=1)
        Buffers: shared hit=2
        ->  Seq Scan on competitors "Competitor"  (cost=0.00..6.75 rows=1 width=22) (actual time=0.008..0.008 rows=1 loops=1)
              Filter: (id = 'competitor-0001'::text)
              Buffers: shared hit=1
Planning Time: 0.061 ms
Execution Time: 0.023 ms
```

### 4.4 Save: previous snapshot

A backward scan that stops at the first row.

```text
Limit  (cost=0.43..4.37 rows=1 width=41) (actual time=0.009..0.009 rows=1 loops=1)
  Buffers: shared hit=4
  ->  Index Scan Backward using snapshots_competitor_id_id_idx on snapshots "Snapshot"  (cost=0.43..13701.13 rows=3479 width=41) (actual time=0.009..0.009 rows=1 loops=1)
        Index Cond: (competitor_id = 'competitor-0001'::text)
        Buffers: shared hit=4
Planning Time: 0.024 ms
Execution Time: 0.013 ms
```

### 4.5 Timeline, full history

**No backward scan.** When every row of a competitor is needed, Postgres estimates that a bitmap scan and a sort cost less than visiting rows one at a time in index order. `Heap Blocks: exact=3504` for 3,504 rows shows the cost of the spread-out layout: every row is on its own page.

```text
Sort  (cost=11477.92..11486.61 rows=3479 width=529) (actual time=3.589..4.043 rows=3504 loops=1)
  Sort Key: id DESC
  Sort Method: quicksort  Memory: 1576kB
  Buffers: shared hit=3537
  ->  Bitmap Heap Scan on snapshots "Snapshot"  (cost=151.39..11273.27 rows=3479 width=529) (actual time=0.599..3.166 rows=3504 loops=1)
        Recheck Cond: (competitor_id = 'competitor-0001'::text)
        Heap Blocks: exact=3504
        Buffers: shared hit=3537
        ->  Bitmap Index Scan on snapshots_competitor_id_id_idx  (cost=0.00..150.52 rows=3479 width=0) (actual time=0.298..0.299 rows=3504 loops=1)
              Index Cond: (competitor_id = 'competitor-0001'::text)
              Buffers: shared hit=33
Planning Time: 0.071 ms
Execution Time: 4.166 ms
```

The same query took about 23 ms when section 5's commands ran it for the first time, against about 4 ms here, which gives a small sense of the cache's effect. It isn't a true cold-cache figure, because the data had only just been written.

### 4.6 Timeline, limit 50

**Backward scan confirmed**, and it stops after 50 rows. It reads 53 buffers against 3,537 for the full history.

```text
Limit  (cost=0.43..197.33 rows=50 width=529) (actual time=0.010..0.033 rows=50 loops=1)
  Buffers: shared hit=53
  ->  Index Scan Backward using snapshots_competitor_id_id_idx on snapshots "Snapshot"  (cost=0.43..13701.13 rows=3479 width=529) (actual time=0.009..0.030 rows=50 loops=1)
        Index Cond: (competitor_id = 'competitor-0001'::text)
        Buffers: shared hit=53
Planning Time: 0.067 ms
Execution Time: 0.042 ms
```

### 4.7 Why the index doesn't need `DESC`

Step 2 used `(competitor_id, id)` because TypeORM's index decorators can't declare `DESC`. A B-tree can be read in either direction, and every scan with a limit in this document (4.2a, 4.4, 4.6) reads this index backward with no `Sort` node. A `DESC` index would add nothing for these queries.

### 4.8 Things these plans don't show

- **Real concurrency.** `LockRows` shows that locking happens, not that two instances avoid each other. The integration tests cover that. The check from step 2 of removing the lock and watching the tests fail is still incomplete for the two claim queries.
- **Cold-cache cost.** Every plan here ran on a warm cache.
- **Larger `competitors`.** At 300 rows the planner picks sequential scans for lookups by id.
- **`DELETE` cascade cost.** The query doesn't exist until step 6. `(competitor_id, id)` should serve the foreign key, but that isn't measured.
- **Dead-row build-up.** Every poll rewrites a `competitors` row, and retries rewrite `snapshots` rows. This dataset was freshly vacuumed, so autovacuum's ability to keep up isn't tested.

## 5. Reproduce

These commands were run as written. They need Docker, and took about 20 seconds. Run them from the repo root; they only touch `competitor_pulse_review`.

```bash
[ -f .env ] || cp .env.example .env
docker compose up -d --wait db

psql_as() { docker compose exec -T db sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -v ON_ERROR_STOP=1"; }

echo 'CREATE DATABASE competitor_pulse_review' | psql_as postgres

# Real variables override .env. Query logging prints the migration SQL.
POSTGRES_DB=competitor_pulse_review npm run migration:run -w server

psql_as competitor_pulse_review <<'SQL'
-- 300 competitors, polled 3504 times each: about 36 days at one poll per 15 minutes.
-- Rows are inserted round by round, so one competitor's snapshots are spread across
-- the table, as they would be in production.
INSERT INTO competitors (id, next_poll_at)
SELECT format('competitor-%s', lpad(g::text, 4, '0')),
       CASE WHEN g <= 10 THEN now() - interval '1 minute'
            ELSE now() + g * interval '3 seconds' END
FROM generate_series(1, 300) g;

INSERT INTO snapshots (competitor_id, fetched_at, title, tagline, price, description,
                       content_hash, changed, summary, summary_status)
SELECT format('competitor-%s', lpad(g::text, 4, '0')),
       now() - (3504 - r) * interval '15 minutes',
       'Acme Analytics', 'Know what your rivals ship', '$49 per month',
       repeat('A realistic listing description. ', 8),
       md5(g::text || (r / 100)::text),
       r % 100 = 0,
       CASE WHEN r % 100 = 0 THEN 'Price and tagline changed.' END,
       (CASE WHEN r % 100 = 0 THEN 'done' ELSE 'none' END)::summary_status
FROM generate_series(1, 3504) r
CROSS JOIN generate_series(1, 300) g
ORDER BY r, g;

-- 20 changed snapshots due for a summary and 5 waiting on a retry time.
UPDATE snapshots
SET changed = true, summary_status = 'pending',
    summary_next_attempt_at = now() - interval '1 minute'
WHERE id IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 20);

UPDATE snapshots
SET changed = true, summary_status = 'pending',
    summary_next_attempt_at = now() + interval '1 minute'
WHERE id IN (SELECT id FROM snapshots ORDER BY id DESC OFFSET 20 LIMIT 5);
-- PARALLEL 0 avoids finding 2.
VACUUM (ANALYZE, PARALLEL 0);
SQL

psql_as competitor_pulse_review <<'SQL'
-- Expect Index Scan using competitors_next_poll_at_idx, under LockRows and Limit.
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM competitors
WHERE next_poll_at <= now() ORDER BY next_poll_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED;

-- Expect Index Scan using snapshots_summary_due_idx, under LockRows and Limit.
EXPLAIN (ANALYZE, BUFFERS) SELECT id, summary_attempts FROM snapshots
WHERE summary_status = 'pending' AND summary_next_attempt_at <= now()
ORDER BY summary_next_attempt_at ASC LIMIT 5 FOR UPDATE SKIP LOCKED;

-- Expect Index Scan Backward using snapshots_competitor_id_id_idx.
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM snapshots
WHERE competitor_id = 'competitor-0001' ORDER BY id DESC LIMIT 50;

-- Expect Sort over Bitmap Heap Scan, with no backward scan.
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM snapshots
WHERE competitor_id = 'competitor-0001' ORDER BY id DESC;
SQL

echo 'DROP DATABASE competitor_pulse_review WITH (FORCE)' | psql_as postgres
```
