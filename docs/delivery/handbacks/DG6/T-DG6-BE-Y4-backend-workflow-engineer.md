# Handback T-DG6-BE-Y4 (backend-workflow-engineer): DG6 round-1 repair, F-DG6-141 and F-DG6-147

- **Stage / gate:** P6, DG6 (FIXING after review round 1). Branch `dg6/be-y4`, base `HEAD` `eb75a6aa6`. Changes are
  left **uncommitted**, as the assignment asks.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-Y4-backend-workflow-engineer-20261101T211021Z-0df556b9","session_id":"0df556b9-ee6b-4335-b8c1-f5eb429a0e8d"}`.
  Assignment file sha256 `8fda86c3…bd3619`, verified.
- **Time:** started `2026-11-01T21:10:36Z`. End time is at the bottom.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and
  exited **0** (run at the start).
- **Migrations:** none. **New operations:** none. **New dependencies:** none.
- Engineering work only. Nothing here grants or implies a business, Finance or IT approval (G1–G6), and nothing
  touches DG0–DG7. All data is synthetic.

## Summary per finding

| Finding | State after this task |
|---|---|
| F-DG6-141 (Medium) | **Fixed.** The tests fail before the fix and pass after it. |
| F-DG6-147 (Medium) | **Not fixed.** The root cause is identified and measured. Redundant synchronous work was removed, but the end-to-end gain could not be told apart from host noise. The real fix needs a design and contract decision (see "What remains"). |

### F-DG6-141: rate-limit classes `export` and `upload` (import upload)

- **Cause.** `RATE_LIMIT_CLASSES` (`apps/api/src/modules/platform/hooks.ts`) listed the `export` class with
  `operationIds: []` and the `upload` class with only `uploadEvidenceContent`. No route used `rateLimitClass("export")`,
  and `createImport` did not use `rateLimitClass("upload")`. So `EXPORT_RATE_LIMIT_PER_MINUTE` had no effect, and the
  import upload ignored `UPLOAD_RATE_LIMIT_PER_MINUTE`. The class limiter also wrote no log line of its own: a refusal
  appeared only as the generic 429 response.
- **Reproduction on this branch, before the fix.** I copied QA's probe unchanged into a temporary file and ran it after
  the fix (log 03). Before the fix, the new `rate-limits.test.ts` cases fail
  (`01-rate-limits-BEFORE-fix.log`: **9 failed | 9 passed**):
  - createExport and createImport: the second call is 400, not 429;
  - every budgeted class: no class log line;
  - the matrix and coverage pins fail.
- **Fix.**
  - `createExport` (`POST /api/v1/exports`, export start, ADR-0046) declares `...rateLimitClass("export")`.
  - `createImport` (`POST /api/v1/transformations/{id}/imports`, the import upload, ADR-0056) declares
    `...rateLimitClass("upload")`.
  - `RATE_LIMIT_CLASSES` lists them: `upload: ["uploadEvidenceContent", "createImport"]` and
    `export: ["createExport"]`. This is the read model of `getSecurityRateLimits`, so Administration > Security now
    shows them.
  - The shared class limiter writes one `warn` line per refusal: `"rate limit class exceeded"` with
    `{ rateLimitClass, route: "<METHOD> <route template>" }` plus the request's `requestId`. It never logs the key, the
    user id, the client IP or any request content. Every budgeted class (upload, search, assistant, webhook, export)
    produces the same line.
  - `exportFormRecords` (a synchronous, capped CSV/XLSX download from ADR-0044) is **not** an ADR-0046 export start.
    It stays in the global class only.
- **Tests.**
  - `apps/api/test/integration/security/rate-limits.test.ts`:
    - one case per operation of every class, including the new `upload/createImport` and `export/createExport`
      cases (the `it.todo` for export is removed);
    - a pin that every operation id of every budgeted class has a case, and that no class except `global` is left
      without an operation;
    - for every user-keyed class, the per-user bucket: a second signed-in user's call in the same minute is not
      429, while the first user stays 429;
    - for every budgeted class, the log line: one per refusal, with `rateLimitClass` equal to the class and a
      `requestId`, and no `127.0.0.1` or user id in it;
    - 429 `rate_limited` problem+json with `Retry-After > 0` (unchanged assertion).
  - `apps/api/test/integration/admin/security.test.ts`: the matrix expectation now carries the two operation ids.
    The route-to-matrix pin passes with the new routes.
- **Result after the fix.**
  - `02-rate-limits-AFTER-fix.log`: **2 files, 18 passed**. The clause summary line reads: `PASS REQ-S16-030 rate
    limiting: 7 classes, 8 operations (...) at budget 1 -> second call 429 rate_limited with Retry-After; user-keyed
    classes counted per user; one class log line per refusal`.
  - QA's own probe (`03-qa-probe-AFTER-fix.log`):
    - `upload/uploadEvidenceContent {"first":404,"second":429}`
    - `export/createExport {"first":400,"second":429}`
    - `upload/createImport {"first":400,"second":429}`
    - **3 passed**.

### F-DG6-147: export start latency with 50 simultaneous starts

- **Procedure.**
  - The driver is `T-DG6-BE-Y4-evidence/export-start-measure.sh`. It follows QA's
    `export-proof-idle-driver.sh`, with these changes:
    - generator profile **`smoke`** (the small local dataset), using the same RFC-UUID generator patch from
      `T-DG6-DO-F-evidence/generate-rfc-uuid.patch` that QA used (the patched copy's sha256 `6b2a9007…`, identical
      to QA's);
    - `deploy/load/export-proof.mjs` runs unchanged (sha256 `7865d9d3…`);
    - the reindex step is skipped (export start reads no search index);
    - no idle wait (this shared host never got near load 1.0). The load average is printed before every
      measurement instead;
    - `EXPORT_RATE_LIMIT_PER_MINUTE=100000`, because of the F-DG6-141 interaction below.
  - The smoke profile has only 3 transformations, so export-proof's part B can only match 3 of the needed 50, and
    the proof exits 1 for that reason alone (part A passes).
  - To reproduce part B's 50 simultaneous starts, `export-burst.mjs` fires 50 `createExport` live selections at
    once. They use part B's body (`registers`/`raid`, csv), spread round-robin over all 21 exporter (user,
    transformation) pairs of 9 users. Every start has its own `Idempotency-Key`, and every job is followed until it
    finishes.
- **Reproduced before the fix** (`11-export-start-BEFORE.log`, load avg 17–19 on 4 vCPU):
  - bursts of 50: p95 **4.97 s / 2.22 s / 2.15 s**; 50, 30 and 22 starts over 2 s;
  - all 150 jobs got 202 and `succeeded`.
- **Cause (profiled).**
  - Temporary phase timing was added to the *built JS only*. It was never in the sources and was removed by the
    rebuild (`17-phase-timing-BEFORE.txt`).
  - In bursts 2–3, the mean per start was:

    | Phase | Mean per start |
    |---|---|
    | handler total | 2.1–2.7 s |
    | `generateSnapshot` (live-selection assembly + snapshot insert in its own transaction) | 1.2–1.4 s (**≈55 %**) |
    | export-job transaction | 0.5–0.6 s |
    | restricted-source check before the transaction | 0.2–0.35 s |
    | remaining permission checks | ≈0.2–0.4 s |

  - The request does far more than "validate, authorize, persist the job":
    - it assembles the whole report;
    - it writes the snapshot and its sources in one transaction, then the job in a second;
    - it reloads grants twice;
    - it runs the export.create and report.generate checks three times each;
    - it runs the restricted-source check twice.
  - The CPU profile (`15-cpu-profile-BEFORE-summary.txt`) shows the canonical-JSON key sort as a hotspot:
    `compareCodePoints` allocates two code-point arrays per comparison (419 ms self).
- **What I changed (contract unchanged).**
  1. `reports/snapshots.ts`: `compareCodePoints` no longer allocates. It compares UTF-16 code units and fixes up
     surrogates, which gives exactly code-point order, so canonical JSON and every `content_sha256` are unchanged.
     The new unit test compares its sign with the old algorithm on every pair from a BMP, astral and Arabic set.
  2. `exports/jobs.ts` and `reports/snapshots.ts`: a live-selection start now runs as follows:
     - the checks run once: 404/403 `export.create`, `report.generate`, and the format check;
     - the report is assembled read-only, before any write;
     - then **one** write transaction does everything:
       - reloads the grants;
       - re-checks export.create and report.generate at commit time;
       - writes the snapshot through the new `insertGeneratedSnapshot` (identical rows and the same
         `report_snapshot.generate` audit event);
       - runs the D-199 restricted-source check once;
       - writes the job, its progress row (taken from `RETURNING`, not re-read), the `export_job.create` audit
         event and the outbox event.
     - The snapshotId path is unchanged except for the progress `RETURNING`.
     - Visible effect: a refused start (D-199 403) no longer leaves an **orphan snapshot**. Before, the snapshot was
       committed in its own transaction and then the export was refused.
- **Tests.**
  - `sensitive-reads.test.ts` "writes nothing" now also asserts that the member has no new `report_snapshot`.
    - **Before the fix:** `06-orphan-snapshot-test-BEFORE-fix.log`, `1 failed | 14 passed`. The member's snapshot
      list grew from 1 to 2.
    - **After the fix:** passes (log 04).
  - `provisional.test.ts`: the comparator equivalence test, **23 passed**.
  - The exports, report-snapshot, report-synthetic and sensitive-reads integration files pass (logs 04 and 05).
- **Measured after the fix, honestly.**
  - The first AFTER run (`12-export-start-AFTER.log`, load avg 11–13): p95 1.70 / 1.12 / 1.09 s, 0 of 150 over 2 s.
    But the host was less loaded than for the BEFORE run, so this does not prove anything.
  - I then ran the procedure **back to back** (BEFORE rebuilt from HEAD's sources, then AFTER; 5 bursts each):

    | Run | Load avg | p95 per burst (s) | Starts over 2 s, per burst |
    |---|---|---|---|
    | BEFORE (`13-export-start-BEFORE-ab.log`) | 13–15 | 2.14 / 1.54 / 1.65 / 1.94 / 2.30 | 24 / 0 / 0 / 0 / 30 |
    | AFTER (`14-export-start-AFTER-ab.log`) | 16–18 | 2.11 / 2.11 / 2.31 / 1.77 / 1.78 | 14 / 13 / 28 / 0 / 0 |

  - **On this saturated, shared host the difference is within the noise.** I do not claim an improvement in start
    latency.
  - The whole-run CPU profile does show less work:
    - `compareCodePoints` is gone from the top 30;
    - `insertSnapshot` inclusive time fell from 913 ms to 481 ms;
    - total sampled time fell from 62.6 s to 53.7 s.

    These are profile figures, not latency figures.
  - All jobs in every run got 202 and `succeeded`. Part A started 16 of 16 with no failure in each run.
  - These are provisional sandbox figures on one shared 4-vCPU host, not Mobily capacity.
- **Why the root cause is not removed here.** About 55 % of the start is report assembly, and it runs in the request
  by design:
  - ADR-0046 §2: "An export of a live report first generates a snapshot from the request (ADR-0045 §2) and exports
    that".
  - The assembler lives in the API, and the worker imports no API code (ADR-0002 rule 5).

  Moving the assembly out of the request is a design change that needs the orchestrator's decision. It is the
  separable second half below.

## Behaviour delivered, per requirement row

- **REQ-S16-030.**
  - Acceptance: *"A12: security tests cover CSRF, SQL injection, XSS in rich text, disallowed upload type, oversized
    upload and rate limiting, and all pass"*.
  - The rate-limiting clause now covers every class of ADR-0052 §4, with every wired operation (8 operations,
    7 classes) at budget 1: the second call is 429 with Retry-After.
  - The export class and the import-upload half of the upload class now take effect. The tests also cover the
    per-user bucket and the class log line.
- **REQ-S20-030.**
  - Acceptance: *"A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%,
    and the file downloads only for the requester"*.
  - **Not re-established by this task.** "Immediately" (ADR-0058 §7: 2 s, including part B's 50 concurrent starts)
    was not shown to hold. On the small dataset it still sits around 2 s on this host, before and after.
  - The job-id, progress, succeeded and download clauses held in every run.
  - The full-dataset re-measurement is devops's, on the merged tree (assignment).

## Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/platform/hooks.ts` | The matrix lists `createImport` (upload) and `createExport` (export); one class log line per refusal; header comment updated. |
| `apps/api/src/modules/reporting/exports/routes.ts` | `createExport` joins the `export` class. |
| `apps/api/src/modules/integrations/routes.ts` | `createImport` joins the `upload` class. |
| `apps/api/src/modules/reporting/exports/jobs.ts` | Live-selection start: checks once, assembly before the write, one transaction for snapshot and job; progress from `RETURNING`. |
| `apps/api/src/modules/reporting/reports/snapshots.ts` | Allocation-free `compareCodePoints` (exported for the test); `insertGeneratedSnapshot` (the snapshot rows in the caller's transaction). |
| `apps/api/src/modules/reporting/reports/provisional.test.ts` | The comparator equivalence test. |
| `apps/api/test/integration/security/rate-limits.test.ts` | Cases for every class operation, the per-user bucket and the log line; todo removed. |
| `apps/api/test/integration/admin/security.test.ts` | Matrix expectation with the two new operation ids. |
| `apps/api/test/integration/access/sensitive-reads.test.ts` | A refused export leaves no snapshot. |
| `docs/operations/configuration.md` | The upload and export rows of the "operations wired" table are made true. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Y4-evidence/*` | Logs, drivers (`export-start-measure.sh`, `export-burst.mjs`, `cpu-profile-summary.mjs`) and measurement JSONs. |

## Checks (real exit codes)

Environment: Node 24.21.0, offline, harness ports 28250–28299. The host was shared with the other repair tasks: load
average 11–29 on 4 vCPU, at times under 4 GB free memory.

| Command | Exit | Result / log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` |
| targeted integration, before the fix (rate-limits and security) | 1 | 9 failed / 9 passed (expected, log 01) |
| targeted integration, after the fix (rate-limits and security) | 0 | 18 passed (log 02) |
| QA probe after the fix | 0 | 3 passed (log 03) |
| targeted integration (exports ×4, report-snapshots, report-synthetic, sensitive-reads ×2, rate-limits, admin security, `integrations/**`) | 1 | **19 files passed, 0 tests failed**. Then Vitest's pool lost a worker (`ERR_IPC_CHANNEL_CLOSED`, likely OOM on the shared host), so 2 files never reported (log 04). |
| the 2 unreported files alone (`exports-orphan`, `exports-xml-chars`) | 0 | 3 passed (log 05) |
| `sensitive-reads.test.ts` on HEAD's sources (fails before) | 1 | 1 failed / 14 passed (log 06) |
| `vitest --project unit-node provisional.test.ts` | 0 | 23 passed |
| `pnpm --filter @mth/api typecheck` / `build` (alone, 21:4x) | 0 / 0 | |
| `pnpm -r typecheck` (first run) | 137 | `apps/api typecheck: Killed`: the kernel OOM-killed tsc while the integration suite and other agents ran (log 07). Re-run below. |
| `pnpm -r build` (first run) | 137 | `apps/api build: Killed`, same cause (log 07). Re-run below. |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` (log 07) |
| `pnpm openapi:lint` | 0 | (log 07) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | (log 07) |
| `pnpm -r typecheck` / `pnpm -r build` (re-run) | see "Final check status" | log 08 |
| `pnpm test`, locale unset and `C.UTF-8` | see "Final check status" | |
| `QA_PG_PORT=28270 MTH_PORT_POOL=28271-28299 tests/qa/support/with-pg.sh pnpm test:integration` | see "Final check status" | log 09 |

No pinned-count changes. The `rate-limits.test.ts` test count changes from 8 + 1 todo to 10 tests (two new operation
cases; the todo is removed).

## Operations routed (pending-list delta)

None. `createExport` and `createImport` already existed and were already exercised, so no `p6-pending-*.ts` or
`p6-exercises-*.ts` change was needed.

## For the orchestrator: contract, schema, dependency and coordination needs

1. **Load runs and the new export class (affects devops's F-DG6-147 re-measurement).**
   - `deploy/load/export-proof.mjs` part A starts 16 exports from **one** user within a minute. With the `export`
     class now wired at its default of 10 per minute, starts 11–16 would get **429**.
   - QA's driver explicitly `unset`s `EXPORT_RATE_LIMIT_PER_MINUTE`. Any load driver (export-proof, and the workload
     if a user's `createExport` rate exceeds 10 per minute) must set `EXPORT_RATE_LIMIT_PER_MINUTE` high, as mine
     does (`100000`).
   - This is not my file to change; it is the devops/load owner's. The e2e stacks start at most 2 exports per user
     per minute and are unaffected. `apps/api/test/support/harness.ts` and `tests/qa/support/a13c-child-api.ts`
     already set 100000.
2. **F-DG6-147's real fix needs a decision.** It needs an ADR-0046 §2 amendment and a contract change (see "What
   remains").
3. No new dependency, no migration, no contract change in this task.

## User-facing texts made untrue

- `docs/operations/configuration.md`, rate-limit table: the upload row ("the import upload joins when it ships") and
  the export row ("none yet") were untrue after this change. **Corrected.**
- The same table still says the **search**, **assistant** and **webhook** classes have "none yet" (a planned P6
  item). Those classes have been wired since T-DG6-BE-P2, BE-T and BE-N. The paragraph above the table also says the
  Administration > Security page "is a planned P6 item … not yet in this tree", and that page exists. These were
  untrue before my task and are outside my repair. **Listed for the owner of `docs/operations/configuration.md`**
  (devops). I left them alone to avoid colliding with DO-Y1.
- No en/ar UI string mentions the export or import rate limits. The Administration > Security matrix reads the live
  `getSecurityRateLimits`, so it now shows the new operations.

## What remains

- **F-DG6-147, the separable second half (not done): move the live-selection assembly off the request path.** The
  smallest design I see:
  - **(a) migration 0124:**
    - `export_job.snapshot_id` becomes nullable while the job is pending;
    - add a `selection jsonb` column;
    - add a CHECK that a job without a snapshot carries a selection and is `queued`, `failed` or `cancelled`.
  - **(b) createExport (live)** validates, authorizes and writes the job, its progress and its audit event, with no
    outbox event yet, and answers 202.
  - **(c) a durable API-process "export snapshot watch"**, following the connector run watch precedent
    (`integrations/runs.ts`), because the assembler is API code (ADR-0002 rule 5). It:
    - claims pending jobs `FOR UPDATE SKIP LOCKED`;
    - re-checks the requester's grants;
    - assembles and writes the snapshot;
    - writes the `export_job.requested` outbox event for the worker.
  - **(d) a contract change:**
    - `ExportJob.snapshotId` becomes nullable until it is assigned;
    - the D-199 refusal of a live selection becomes a failed job with `errorCode`
      `export.includes_restricted_records` instead of a synchronous 403. That needs a decision against D-199 and the
      `sensitive-reads` test, plus en/ar UI text for the new job error;
    - idempotent replay compares the stored selection.
  - **(e) an ADR-0046 §2 amendment.**

  This needs the orchestrator's decision, and it is larger than this task's budget.
- **The full-dataset re-measurement:** devops, on the merged tree (assignment), with the rate-limit setting from
  item 1.
- Any check in "Final check status" that is not reported as exit 0.

## Merge notes

- Expect conflicts only in `apps/api/src/modules/platform/hooks.ts` (`RATE_LIMIT_CLASSES`) and in
  `docs/operations/configuration.md`, if another repair touches them.
- No migration, no ordering constraint.
- The `jobs.ts` and `snapshots.ts` hunks (F-DG6-147 part) are independent of the rate-limit hunks (F-DG6-141). If the
  orchestrator prefers the async redesign, the single-transaction hunk can be dropped separately. The orphan-snapshot
  assertion in `sensitive-reads.test.ts` goes with it.

## Final check status

| Check | Exit | Result |
|---|---|---|
| `pnpm -r typecheck` (re-run 22:36Z) | **0** | every package `Done` (log 08) |
| `pnpm -r build` (re-run 22:45Z) | **0** | every package `Done` (log 08) |
| `pnpm lint` | **0** | log 07 |
| `pnpm openapi:lint` | **0** | log 07 |
| prettier check over `git ls-files -co --exclude-standard` | **0** | log 07; re-run after this handback was written, see below |
| `QA_PG_PORT=28270 MTH_PORT_POOL=28271-28299 tests/qa/support/with-pg.sh pnpm test:integration` | **1, INCOMPLETE** | Ran 22:08–22:38Z (log 09). **47 files reported: 902 tests, 1 failed.** The failure is `connection-hygiene.test.ts` "SIGTERM: the API process (src/main.ts) exits 0 within the grace period with a stalled upload in flight" (20 s timeout, load average about 29). The run then aborted: Vitest's tinypool lost a worker (`ERR_IPC_CHANNEL_CLOSED`, at the same time as the kernel OOM-killed two tsc runs). The remaining files **did not run**. |
| `connection-hygiene.test.ts` re-run alone | **0** | 13 passed (log 10): the failure is load-induced, not caused by this change |
| `pnpm test`, locale unset and `C.UTF-8` | **NOT RUN** | Time limit: this task reached about 100 min at 22:50Z. On this host a single `pnpm test` took over 30 min in QA's round. Only `provisional.test.ts` (unit-node, 23 passed) was run. **BLOCKED by the time budget**, not passed. |

**Acceptance items 2 (pnpm test, both locales) and 3 (full integration suite) are therefore not met by this
handback.** They must be run on the integrated tree. Item 1 (typecheck, build, lint, prettier, openapi lint) and
item 4 (DG5 historical validation) are met.

End time: see the last `date -u` in the session (about 22:52Z, about 102 min).
