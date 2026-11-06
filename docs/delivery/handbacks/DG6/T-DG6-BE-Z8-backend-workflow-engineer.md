# Handback T-DG6-BE-Z8 (backend-workflow-engineer): concurrent job failures on one queue (F-DG6-380)

- **Stage:** DG6, FIXING after review round 5. Branch `dg6/be-z8` at `2aec893a2abe2f4646e69c9384fc20e56a0d6326` (`git status` was clean at the start).
- **Invocation:** `DG6-T-DG6-BE-Z8-backend-workflow-engineer-20261106T015320Z-c681f0ca`, session `c681f0ca-42b0-438d-b5bb-679795b10614`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z8.md` (sha256 `3107dd2c…c2ed`, verified).
- **Time:** started `2026-11-06T01:53:33Z`. The end time is at the bottom.
- **Changes:** left uncommitted, as the assignment asks.
- **Approvals:** none. No business, Finance or IT approval was granted, and no G1–G6 gate was touched. DG6 is not implied. All test data is synthetic.

## Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0.

## Root cause

`raiseOperationalException` (API) and `raiseOperationalExceptionTwin` (worker) both recur an exception by writing:

```
last_occurred_at = greatest(now(), ${current.last_occurred_at}::timestamptz)
```

`current.last_occurred_at` is the stored value read back into a JavaScript `Date`, which keeps only milliseconds. The column keeps microseconds.

The race:
1. Two raises of one exception overlap. They are already serialized by the advisory lock `operationalExceptionUpsert` plus `FOR UPDATE`.
2. The raise that commits second can have the earlier transaction start, so its `now()` is older than the stored value.
3. `greatest()` then returns the truncated copy, which is earlier than the stored value.
4. The 0101 guard rejects it (`operational_exception_occurrence_step`).

`captureJobFailure` raises in the same transaction as the job's `operational_failure` row and its `job.failed` outbox row, so all three were rolled back.

## Fix chosen and why

The recurrence now reads the stored value in SQL. In both functions the expression is:

```
greatest(now(), operational_exception.last_occurred_at)
```

**Why it is correct:**
- The `UPDATE` runs under the exception's advisory lock and after the `FOR UPDATE` read, in a READ COMMITTED transaction. The row it updates is therefore the latest committed version.
- `operational_exception.last_occurred_at` in `SET` is that row's own microsecond value (`OLD`). So `NEW.last_occurred_at >= OLD.last_occurred_at` always holds.
- The count still steps by exactly one, guarded by `WHERE version = current.version`.

**The guard is unchanged:**
- No migration.
- No retry loop.
- No upsert that could mask a real violation.

A real backwards move or a double count still raises `check_violation`.

**Why not the alternatives:**
- *Locking the row:* it is already locked, and the lock was not the problem.
- *Retrying on conflict:* that would hide the bug behind a retry, and a retried capture would still lose the record if every retry failed.
- *A per-job idempotent upsert:* per-job idempotency already exists (the `processed_message` ledger `JOB_EXCEPTION_LEDGER` on `queue:jobId`).

### Raisers checked

Every raiser reaches the defect only through these two functions, so all of them are fixed by this one change.

| Raiser | Path | Shared the defect? | Result |
|---|---|---|---|
| Job last-attempt failure | worker `kit.ts` `captureJobFailure` → `raiseJobException` → twin | Yes (F-DG6-380): lost the `operational_failure` row, the occurrence and `job.failed` | Fixed. The test covers N = 4 and N = 8 |
| Connector run failure | worker `handlers/integrations.ts:201` → twin, in the run-outcome transaction | Yes. A rejected recurrence rolled back the run outcome; pg-boss would retry the job | Fixed. The twin interleaving test covers it |
| Stale data (freshness scan) | worker `handlers/operations.ts:366` → twin | Yes. Same effect as the connector run (a job error that pg-boss retries) | Fixed (twin) |
| Notification delivery failure | worker `handlers/notifications.ts:537` → twin | Yes. Same twin code | Fixed (twin) |
| Heartbeat watch | API `operations/heartbeat.ts:123` → `raiseOperationalException` | Yes in principle: a step was rejected and logged, then retried at the next tick. Only one API process raises it, and 30 s apart, so it was rarely hit | Fixed. The API interleaving test covers it |
| BE-Z6 re-raise / rebase rule | `rebaseOverSystemOccurrences`, acknowledge and resolve | **No.** It only reads `operational_exception_event` and changes status and acknowledgement fields, never `last_occurred_at` or the count | Unchanged. The BE-Z6 race test is still green |

The same `${row.timestamp}` round-trip pattern does not appear in any other monotonic-timestamp write. I searched `apps/*/src` and `packages/*/src` for `greatest(`: the only other matches are integer columns.

## Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/operations/exceptions.ts` | The recurrence's `last_occurred_at` uses the column reference instead of the millisecond `Date` round-trip, with a comment |
| `apps/worker/src/kit.ts` | The same change in `raiseOperationalExceptionTwin` |
| `apps/api/test/integration/operations/concurrent-exception-recurrence.test.ts` | **New** product integration test (port of the QA probe, plus deterministic cases), 7 tests |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-backend-workflow-engineer.md` | This handback |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-evidence/*.log` | Logs of every check below |

**Migrations:** none. There are no API endpoints or OpenAPI changes, no zod changes and no new dependency.

## The new test

`apps/api/test/integration/operations/concurrent-exception-recurrence.test.ts` runs on a real disposable PostgreSQL and uses no mocks.

1. **The QA burst, ported.** N = 4 and N = 8 concurrent `captureJobFailure` calls for distinct jobs on one queue, with the exception not yet open and already open: 4 cases, 5 rounds each. Each round asserts:
   - no rejection;
   - `operational_failure` rows equal to the total;
   - `job.failed` outbox rows (one per failure row) equal to the total;
   - exactly one open exception, whose `occurrence_count` equals the total;
   - `recurred` history events equal to the total minus 1;
   - the final `last_occurred_at` is at or after every history event's `occurred_at` (it never moved backwards).
2. **Deterministic interleaving, with gates and no timers.** Transaction A starts first and B starts after it. B commits a recurrence, then A recurs. This runs for the worker twin (connector, freshness, job raisers) and for the API raise (heartbeat, data_stale), 5 rounds each. Expected: one open exception with count 3 and 2 `recurred` events.
3. **Deterministic precision.** A stored `last_occurred_at` that is later than `now()` and ends in `…123 µs` is kept exactly, to the microsecond, by the next recurrence. The count goes to 2. Both raises are covered.

**Before the fix** (`01-new-test-before-fix.log`): exit 1, all 7 tests failed.
- Bursts lost 1 or 2 captures in every round. For example: `rejected 1 ["operational_exception: each recurrence counts once and moves last_occurred_at forward"]; failures 3/4; job.failed 3/4; … occurrences 3/4`.
- The interleaving and precision cases rejected with `constraint: 'operational_exception_occurrence_step'`.
- An earlier attempt of this run used an invalid queue name (`bez8.`, which has a digit and breaks the 0101 `queue_name` rule). That error was in my test, not the product. I corrected it to `bezeight.` and re-recorded the run into the same log, so the log shows the valid run.

**After the fix** (`02-new-test-after-fix.log`): exit 0, 7 of 7 passed.

## Behaviour delivered, per requirement row

- **REQ-S20-013.** Acceptance: *"A13: Retried events, worker restarts and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable"*.
  - Concurrent last-attempt failures on one queue are now each captured exactly once, whatever the commit order:
    - one `operational_failure` row per job (retryable from the failure queue);
    - one `job.failed` event per job;
    - one recurrence per job on the queue's single open exception.
  - Nothing is duplicated:
    - the exception is still deduplicated by the one-active index and the advisory lock;
    - the job-exception ledger still stops a replay of the same pg-boss job id from recurring again;
    - the outbox idempotency key `job.failed:<failureId>:<jobId>` is unchanged.
- **REQ-S12-019.** Acceptance: *"A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date"*.
  - A concurrent recurrence of a connector, stale-data or heartbeat exception is no longer rejected. A connector failure still produces one exception, whose count rises with each failure.
  - The KPI Stale behaviour is unchanged. `run-failure-kpi-links`, `connector-failure-exception`, `operations-freshness` and a22 are green.

## Checks run

**Environment:** Node 24.21.0 offline; harness ports 31050–31099; disposable PostgreSQL through `tests/qa/support/with-pg.sh`; empty `.claude/.cc-writes` folders removed before the tests.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` | (stdout, quoted above) |
| 1 | `with-pg.sh npx vitest run --configLoader runner --project integration …/concurrent-exception-recurrence.test.ts`, **before the fix** | 1 (expected) | 7 failed of 7 | `01-new-test-before-fix.log` |
| 2 | The same, **after the fix** | 0 | 7 passed of 7 | `02-new-test-after-fix.log` |
| 3 | `with-pg.sh npx vitest run --configLoader runner --project integration <25 files>` (list in `03-files.txt`) | 0 | **25 files, 368 tests passed** | `03-targeted-integration.log` |
| 4 | New test + BE-Z6 race test (`exception-recurrence-race.test.ts`), repeated 3×, while `pnpm test` ran alongside | 0, 0, 0 | 14 of 14 passed each time | `04-new-and-race-repeat.log` |
| 5 | `pnpm -r typecheck` | 0 | all packages Done | `10-typecheck.log` |
| 6 | `pnpm lint` | 0 | `eslint . --max-warnings=0`, clean | `11-lint.log` |
| 7 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | all files formatted | `12-prettier.log` |
| 8 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `13-openapi-lint.log` |
| 9 | `pnpm -r build` | 0 | all packages Done | `14-build.log` |
| 10 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | unit-node 190 files / 2899 tests; unit-web 122 / 2062; unit-formula-nocodegen 3 / 259 passed + 2 skipped | `20-unit-locale-unset.log` |
| 11 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | the same counts | `21-unit-c-utf8.log` |
| 12 | `apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` | 0 | **4 passed** (a13 en 11.7 s / ar 6.8 s; a22 en 1.6 m / ar 1.8 m), real stack with the built API, SPA and worker | `30-e2e-a22-a13.log` |

The 25 files in row 3:
- `apps/api/test/integration/operations/` (all 7 files, including the new test and the BE-Z6 race test);
- `apps/api/test/integration/jobs/` (`job-operations`, `job-schedules`);
- `automation/automation-failures`;
- `integrations/run-failure-kpi-links` and `integrations/runs`;
- `contract/` (including `contract.test.ts`);
- the worker's `automation-failure-queue`, `batch-settlement`, `connector-failure-exception`, `heartbeat`, `job-runs`, `operations-freshness`, `worker-attempt` and `outbox`;
- `tests/qa/integration/a13-durable-automation` and `a13-starters-run`.

**Disclosures:**
- **The 2 skipped tests** in row 10/11 are in `packages/shared/src/formula/fuzz.test.ts`. They were already skipped before this task, and I did not touch that file.
- **Row 3 and formatting:** while the row-3 run was in progress, `prettier --write` reformatted the new test file. The change was formatting only. The formatted file was then run again in row 4 (3 times, all green).
- **The QA probe file itself** (`docs/delivery/test-evidence/…/zz-qa-dg6r5-concurrent-job-failure.test.ts`) was not copied into the tree and run. Its assertions are reproduced in part 1 of the new test.
- **The full `pnpm test:integration`** was not run, as the assignment says. The orchestrator runs it on the merged tree.

## Operations routed (delta to the pending list)

None. This repair adds and changes no API operation, so there is no `p6-pending-*.ts` or `p6-exercises-*.ts` change. `contract/` is green (row 3).

## Contract, schema or dependency needs

None. There is no migration (the next free id would have been `0126`), no OpenAPI or zod change and no new dependency.

## User-facing texts made untrue

None. The change is internal to the persistence path and no en/ar string describes it.

## What remains

- Nothing in this assignment's scope.
- F-DG6-380 closes only when a non-author reviewer adds a verification. It can use the new test and the QA probe.
- **Merge notes:** two one-expression changes plus one new test file. A conflict is possible only if another branch edited the same `.set({...})` blocks in `exceptions.ts` or `kit.ts`.

Ended: `2026-11-06T02:21:27Z` (`date -u`). `pnpm lint` was rerun after the final formatting pass and exited 0.
