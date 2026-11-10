# Handback T-DG6-BE-Y5 (backend-workflow-engineer): DG6 round-1 repair, asynchronous live-export assembly (F-DG6-147, D-207)

- **Stage / gate:** P6, DG6 (FIXING after review round 1). Branch `dg6/be-y5`, base `HEAD` `8268ac5a6`. Changes are
  left **uncommitted**, as the assignment asks.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-Y5-backend-workflow-engineer-20261101T230727Z-c643b27b","session_id":"c643b27b-11ea-4496-a67c-868676d1ec9c"}`.
  Assignment file sha256 `dbfd0800…b110ea`, verified.
- **Time:** started `2026-11-01T23:07:53Z` (`date -u`). End time is at the bottom.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)`
  and exited **0** (`T-DG6-BE-Y5-evidence/00-validate-DG5-historical.log`).
- **Migration:** **`0124_p6_export_live_selection_pending.sql`**. It is the next id above the highest file on this
  branch (0123, D-196). The orchestrator renumbers at merge if needed. The seed free-id example moves to **0125**.
- **New operations:** none. **New dependencies:** none. **Contract change:** yes (below).
- Engineering work only. Nothing here grants or implies a business, Finance or IT approval (G1–G6), and nothing
  touches DG0–DG7. All data is synthetic.

## What D-207 asked, and what was delivered

| D-207 item | Delivered |
|---|---|
| (1) The live selection is validated, authorized and checked for restricted sources **synchronously** (D-199's 403 unchanged). The job, its stored selection, its progress and its audit event are written, and the answer is 202 with no snapshot. | Yes. See "createExport (live selection)". `sensitive-reads.test.ts`: all 15 pass. Its 403 assertions are unchanged; one case changed where it reads the snapshot id (see "Tests changed"). |
| (2) A durable API-process snapshot watch claims jobs `FOR UPDATE SKIP LOCKED`, re-checks access, assembles and writes the snapshot, and only then writes `export_job.requested`. Access lost in between gives a failed job with an `errorCode` and en/ar text, never a file. | Yes. New file `apps/api/src/modules/reporting/exports/assembly.ts`. |
| (3) `ExportJob.snapshotId` is nullable until assigned. An idempotent replay compares the stored selection. | Yes. Changed in OpenAPI, the zod mirror and the web. |
| (4) Migration 0124: snapshot nullable while pending, a selection column and a CHECK. The seed free-id example moves to 0125. | Yes. |
| (5) Exports of an existing snapshot are unchanged. The snapshot's data-as-of is the assembly time. | Yes. The snapshot-id path is byte-for-byte the same flow: snapshot, job, progress, audit and outbox in one transaction. |

### createExport (live selection), `apps/api/src/modules/reporting/exports/jobs.ts`

- **In the request, read-only:**
  - 403 for AUD (`holdsAnywhere`);
  - the definition and the subject's transformation (404 for an unknown subject);
  - `export.create` and `report.generate` (404/403);
  - `export.format_not_offered`;
  - the report request's own checks, through the new `checkReportRequest` (definition, subject, period, parameters:
    the 422 `report.*` refusals stay **synchronous**);
  - then **D-199**:
    - `transformationHasRestricted` reads the transformation's `record_sensitivity` rows (one indexed query,
      `record_sensitivity_transformation_idx`) and applies the requester's admission (the same `restrictionOf` rule
      as before).
    - **If the requester is restricted from no record of the transformation**, no assembly of it can include a
      restricted record of it, so nothing is assembled in the request.
    - **Otherwise** the report is assembled read-only in the request, exactly as before D-207, and its sources decide
      the 403 `export.includes_restricted_records`. That assembly is discarded; the watch assembles the snapshot.
    - So the 403 is unchanged for every request, and the request is cheap in the common case (no restricted record
      for this requester).
- **One write transaction:**
  - the grants are reloaded and `export.create` and `report.generate` re-checked (commit-time denial);
  - the job is inserted with `snapshot_id NULL` and `selection` (the request's `ExportLiveSelection` members);
  - the progress row;
  - the `export_job.create` audit event (its changes carry `snapshot_id: null` and the `selection`);
  - **no outbox event and no snapshot**.
- **Answer:** 202 with `snapshotId: null`. The route then wakes the watch (`kick`).
- **Idempotent replay** (D-207 (3)) compares the **stored** selection: definition, subject, period and parameters
  (canonical JSON). This holds before and after the assembly. A different selection or a snapshot-id body under the
  same key is 422 `idempotency.key_reused`.
  - Note: the old live comparison ignored `parameters`. It now compares them, as D-207 says.
  - A job created **before 0124** has no stored selection. Replaying its key with a live body therefore answers 422,
    not 200. This is a deploy-boundary edge only.
- **Download** of a job with no snapshot skips the snapshot's restricted-source check (there is none) and answers as
  before: 409 `export.not_ready` while pending, and 422 `export.failed` once failed.

### The export assembly watch, `apps/api/src/modules/reporting/exports/assembly.ts`

It follows the connector-run-watch precedent: the assembler is API code, and the worker imports none (ADR-0002 rule 5).

- **One transaction per job:**
  1. **Claim:** the oldest pending job (`snapshot_id IS NULL AND status = 'queued'`, partial index
     `export_job_pending_assembly_idx`), locked `FOR UPDATE SKIP LOCKED`. Then `pg_try_advisory_xact_lock` on the
     job's `exportJob` lock class (the class that cancel and the worker hold). It is tried and never waited for, so
     there is no lock-order deadlock with cancel, which takes the advisory lock first and then the row. A job another
     watcher holds is skipped.
  2. **Access re-check** on the current grants: an active user with `transformation.read`, `export.create` and
     `report.generate` in the job's transformation. Otherwise the job fails with `export.source_unavailable`.
  3. **Assembly** (`assembleReport`, read-only REPEATABLE READ on its own connection, while the claim is held). Its
     data-as-of is the assembly time, recorded on the snapshot as before. A refusal of the report itself (422
     subject/period/parameters, `report.too_large`, 404) fails the job with `export.assembly_failed`.
  4. **Commit-time access re-check** after the assembly, on grants reloaded again.
  5. **D-199 on the assembly's actual sources:** a restricted source fails the job with
     `export.includes_restricted_records`. Nothing is written but the failure: no snapshot, no outbox event, no file.
  6. **Writes:**
     - the snapshot, through `insertGeneratedSnapshot`: the same rows and the same `report_snapshot.generate` audit
       event as `generateSnapshot`; `created_by` = the requester; actor = service, on behalf of the requester;
     - the job's `snapshot_id` (version 2, audited `export_job.assemble`);
     - the `export_job.requested` outbox event.

     The worker then renders after COMMIT, exactly as for an export of an existing snapshot.
- **Failures:** every failure is `queued -> failed`, audited `export_job.fail` (prior and new version), in the same
  transaction.
- **Durable and idempotent:**
  - The pending state is the job row itself. A restart, or a crash in the middle of a job (its transaction rolls
    back), leaves the job pending, and the next step assembles it.
  - A job is assembled at most once: the claim, the snapshot, the assignment and the outbox event commit together.
  - Migration 0124's guard refuses a second assignment, and the outbox key `export_job.requested:<id>` is unique.
  - It is safe on several API instances: each one runs the watch, and `SKIP LOCKED` together with the try-lock
    separates them.
- **Bounded retry:**
  - An unexpected error (not a refusal) rolls back and is retried at the next tick.
  - After `EXPORT_ASSEMBLY_MAX_ERRORS` (3) such errors for one job in this process, the job fails with
    `export.assembly_failed`.
  - The count is per process, so a restart starts it again.
- **Who drives it:**
  - every API process, every 1 s (`EXPORT_ASSEMBLY_INTERVAL_MS`), with 2 concurrent claims
    (`EXPORT_ASSEMBLY_CONCURRENCY`);
  - and immediately after a 202 of a live selection (`kick`).
  - It is registered by `exports/routes.ts` at `onReady` and stopped at `onClose`.
  - It is not started under `NODE_ENV=test` (the suites call `exportAssemblyWatchStep`), nor by a route-only
    instance. This is the same rule as the connector watch.

### Migration `0124_p6_export_live_selection_pending.sql`

- `export_job.snapshot_id` is made nullable.
- `selection jsonb NULL` is added.
- CHECK `export_job_selection_pending`:
  - a job without a snapshot carries a selection and is `queued`, `failed` or `cancelled`;
  - the selection is an object with a string `definitionCode`.
- `export_job_error_code_check` accepts `export.includes_restricted_records` and `export.assembly_failed`.
- The partial index `export_job_pending_assembly_idx`.
- `export_job_guard()` is replaced:
  - a pending job's format is checked against its selection's definition;
  - the snapshot is assigned exactly once (NULL -> a snapshot, while queued), and is then immutable as before;
  - the selection never changes;
  - an assigned snapshot is checked as on insert (not discarded, format offered).
- No row changes.
- Applied by every integration run here (116 migrations on a fresh database). The DB catalogue test passes (37).
- `packages/db/src/schema.ts`: `snapshot_id: string | null`, `selection: NullableJson`, and the column list.
- **For ARCH-11 (data dictionary, ERD):** the column, the CHECK, the index, the error codes and the guard above.

### Contract (D-207 (3))

- `docs/api/openapi.yaml`, `ExportJob`:
  - `snapshotId` is `NullableUuid`, with a description of D-207;
  - `errorCode` gains `export.includes_restricted_records` and `export.assembly_failed`;
  - `createExport`'s summary and 202 description are updated.
- `pnpm openapi:lint`: PASS, 932 operations (no operation added).
- Zod mirror `packages/shared/src/schemas/export-jobs.ts`: `snapshotId: z.uuid().nullable()`, and the two error
  codes added to `EXPORT_ERROR_CODES`.
- Every API call in the integration tests is validated against the contract by the harness `call`. That includes the
  202 and GET/list responses with `snapshotId: null` and the failed job's new error code.

### Web (en and ar)

- `apps/web/src/pages/exports/ExportsPage.tsx`:
  - a job with `snapshotId === null` shows no "Open the snapshot" link. It shows instead:
    - *"Preparing the report: its snapshot is assembled from the current records before the file is produced."* while
      queued;
    - *"No snapshot was produced."* once failed or cancelled.
  - Both strings have Arabic texts in `ar/reportsP5.json`.
- Failed jobs show the translated error, including the new codes. New problem text `export__assembly_failed` in en
  and ar. `export__includes_restricted_records` already existed in both.
- New `fee.test.tsx` cases, **en and ar**:
  - the pending row's text and no snapshot link;
  - the "no snapshot" row;
  - the translated `export.includes_restricted_records` error;
  - `dir` rtl/ltr.

  Both pass (`fee.test.tsx` verbose run; and unit-web in `pnpm test`, logs 25 and 26).
- The web itself starts only exports of a snapshot (`ExportForm`), so its own starts are unchanged.

## Measurement: 50 simultaneous starts, before and after (BE-Y4's driver, unchanged)

- **Driver:** `export-start-measure.sh` and `export-burst.mjs`, copied unchanged from `T-DG6-BE-Y4-evidence/`
  (identical sha256 `174d49b9…` and `1a974546…`), into my evidence folder.
- **Settings:** generator profile `smoke` (patched copy sha256 `6b2a9007…`), `deploy/load/export-proof.mjs` unchanged
  (sha256 `7865d9d3…`), `EXPORT_RATE_LIMIT_PER_MINUTE=100000`, `N=50`, `BURSTS=3`, inside
  `tests/qa/support/with-pg.sh`, ports 28400–28410.
- **BEFORE:**
  - It ran on HEAD's build: the `dist` the orchestrator built at `8268ac5a6`, before I rebuilt anything.
  - Migration 0124 was moved out of `packages/db/migrations/` during that run, so the database had HEAD's
    115 migrations (log line `applied 115 migration(s)`), then it was moved back.

| Run | Log | Load avg (1 min) | p50 per burst (s) | p95 per burst (s) | Max (s) | Over 2 s per burst | Final |
|---|---|---|---|---|---|---|---|
| BEFORE (HEAD build) | `10-export-start-BEFORE.log` | 31–32 | 3.00 / 2.26 / 2.71 | **3.48 / 2.93 / 3.11** | 3.49 | **50 / 33 / 33** | 150 of 150 202, 150 succeeded |
| AFTER | `11-export-start-AFTER.log` | 13–14 | 1.02 / 0.54 / 0.43 | **1.21 / 0.76 / 0.53** | 1.21 | **0 / 0 / 0** | 150 of 150 202, 150 succeeded |
| AFTER, second run (integration + `pnpm test` running at the same time) | `12-export-start-AFTER-loaded.log` | 11.7–12.7 | 0.63 / 0.95 / 0.97 | **0.74 / 1.29 / 1.23** | 1.38 | **0 / 0 / 0** | 150 of 150 202, 150 succeeded |

- Part A of export-proof (16 starts): every start was 202 and every job succeeded in all three runs. The slowest
  part A start was 325 ms BEFORE and 256 ms AFTER.
- Part A's other-user and AUD checks were 404 on the job and the download in every run.
- `export-proof exit=1` in all three runs, for the reason BE-Y4 documented: the smoke profile has 3 transformations,
  so part B cannot find its 50 pairs. That is why the bursts exist.
- API error lines: 0 in every run.
- **Honest reading:**
  - The host was more loaded during BEFORE (load about 31) than during the AFTER runs (about 12–14). I could not
    control that on this shared 4-vCPU host, so the before/after figures are not a controlled A/B.
  - Two points still hold:
    - (a) in both AFTER runs, 0 of 300 starts went over 2 s, and the worst was 1.38 s;
    - (b) the change removes the assembly, measured by BE-Y4 at about 55 % of a start, from the request whenever the
      requester is restricted from no record of the transformation. That is the case for every load user (there is no
      sensitive mark in the load dataset).
- **The time to completion is not the start latency.** With 50 queued at once, the jobs are assembled by 2 claims per
  API process, so the last job's snapshot comes later than before. Every job of every burst still reached
  `succeeded` within the burst driver's wait.
- Sandbox figures on one shared host, **provisional**, not Mobily capacity.
- **The full-dataset re-measurement is devops's** (T-DG6-DO-Y2, D-207), on the merged tree, with
  `EXPORT_RATE_LIMIT_PER_MINUTE` set high.

## Behaviour delivered, per requirement row

- **REQ-S20-030.** Acceptance: *"A15;A13: exporting the full load dataset returns immediately with a job ID,
  progress rises to 100%, and the file downloads only for the requester"*.
  - "Returns immediately with a job ID": the 202 no longer waits for the assembly (above). On the smoke dataset, 0
    of 300 starts were over the 2 s target in the AFTER runs.
  - "Progress rises to 100 %": the worker is unchanged. Every job succeeded with percents rising to 100 (export-proof
    part A; `exports.test.ts`; the new "watch assembles, then the worker exports" test).
  - "Downloads only for the requester": the requester gets 200; another member of the same transformation gets 404
    on the job and the download (new test, and export-proof part A).
  - **The full load dataset is not measured by this task** (devops, T-DG6-DO-Y2).
- **REQ-S10-004.** Acceptance: *"A12: a user without access to transformation Y receives no Y records in search,
  export, evidence URL or AI retrieval; a user scoped to transformation X exports a portfolio report and receives no Y
  records, and search returns no Y hits"*.
  - The export half holds with the asynchronous assembly:
    - a member restricted from a record is refused 403 in the request, as before;
    - a record marked sensitive between the start and the assembly fails the job with no snapshot and no file (new
      test);
    - a revoked grant fails the job `export.source_unavailable`;
    - X's TL cannot export Y's assembled snapshot: QA's `a12-p6-scope-isolation.test.ts`, 26 passed, and the a12 e2e
      spec passed.
- **REQ-S13-005 / REQ-S13-006.** Acceptance (S13-005): *"A15: an XLSX export of T15 contains exactly the filtered RAID
  rows; a PPTX gate pack contains the gate's criteria"*. Acceptance (S13-006): *"A15;A12: a RAID description
  '=HYPERLINK(...)' exports as text; a system SUM total remains a formula"*.
  - Unchanged. QA's `a15-outputs-every-definition.test.ts` (5 passed) and `a07-historical-integrity.test.ts`
    (12 passed) pass, and the `a15-reporting` e2e spec passed in en and ar.

## Tests

### New: `apps/api/test/integration/reporting/exports-assembly.test.ts` (13 tests, all pass)

- **The 202 with no snapshot:**
  - `snapshotId: null`;
  - the stored selection;
  - only the `export_job.create` audit event;
  - no outbox event and no snapshot;
  - GET and list show `snapshotId: null`;
  - the download is 409 `export.not_ready`.
- **Request-time refusals stay synchronous:** 422 `report.subject_invalid` and `report.*` for bad parameters; 403
  for AUD.
- **The 0124 CHECK:** a job without a snapshot cannot be `running`.
- **The watch assembles, then the worker exports:**
  - one snapshot, with `created_by` = the requester;
  - `report_snapshot.generate` with actor service on behalf of the requester;
  - `export_job.assemble` at version 2;
  - one outbox event;
  - a second step does nothing;
  - the real worker runner succeeds;
  - the requester's download is 200; another member gets 404.
- **Access lost between the start and the assembly:**
  - a revoked grant: failed `export.source_unavailable`, version 2, `export_job.fail` audited, no snapshot, no
    outbox event, no file;
  - a benefit marked sensitive after the start: failed `export.includes_restricted_records`, no snapshot, no file,
    download 422 `export.failed`. A new start by that member is then the synchronous D-199 403. The admitted owner's
    job assembles and exports.
- **Idempotent replay:**
  - the same key and selection give 200 with the same job, both pending (version 1) and after assembly (version 2,
    with a snapshot);
  - other parameters, or a snapshot-id body, give 422 `idempotency.key_reused`;
  - one job and one outbox event per key.
- **A restart in the middle of a job:**
  - a crash injected after the assembly and before the commit leaves the job pending with no snapshot and no outbox
    event;
  - the next step (a restarted process) assembles it once.
- **The running watch:** the timer and kick path assembles a pending job on its own and stops cleanly.
- **Bounded retries:** 3 unexpected errors, then failed `export.assembly_failed`.
- **Two watchers race:**
  - two concurrent steps (2 claims each) over 6 pending jobs: each job assembled exactly once (one snapshot, one
    outbox event, one assemble audit, version 2, 6 distinct snapshots);
  - a second watcher skips a job the first holds (`SKIP LOCKED`), and the job is assembled once.
- **Cancel:** a cancelled pending job is never assembled.

### Tests changed (the assertions keep their meaning)

| File | Change | Why |
|---|---|---|
| `apps/api/test/integration/access/sensitive-reads.test.ts` | One case, "the owner's snapshot exported by the member (by snapshot id) is 403 too": it now asserts the 202's `snapshotId` is null, runs one watch step and reads the snapshot id from GET. **The 403 assertion is unchanged.** The two other export cases (the D-199 403, including "writes nothing" and "no snapshot", and the RAID 202) are unchanged. | The 202 has no snapshot id any more (D-207 (3)). |
| `apps/api/test/integration/reporting/exports.test.ts` | `envelopeOf` runs a scoped watch step first. The live-selection case asserts `snapshotId: null` at 202, then `assembled` at version 2, then the snapshot, then the worker. | D-207 |
| `apps/api/test/integration/reporting/exports-orphan.test.ts`, `contract/p5-exercises-be-m.ts` | Their `work` helpers run a scoped watch step first. It is a no-op for their snapshot exports. | D-207 |
| `tests/qa/support/a15.ts` (QA support) | `runWorker` runs a scoped watch step first. It is a no-op for snapshot exports. | QA's live-selection exports need the assembly before their outbox event exists. |
| `tests/qa/integration/a12-p6-scope-isolation.test.ts` (QA) | Y's snapshot id is read from the job row after the worker, not from the 202. The disclosure assertions are unchanged. | D-207 (3) |
| `tests/qa/integration/a13-jobs-rerun.test.ts` (QA) | One scoped watch step before counting the job's `export_job.requested` events. It also asserts that a second step does nothing. "One event" and the SIGKILL/replay cases are unchanged. | Before this change, 3 of 5 failed (log 02): the first case counted 0 events, and the other two depend on it. After it, 5 of 5 pass (log 04). |
| `apps/api/src/modules/reporting/reports/provisional.test.ts` | BE-Y4's comparator reference loop uses `entries()`/`at()` instead of `x[i]`. | **Already failing on HEAD:** the ADR-0002 boundary walk (`architecture.test.ts`, `reporting.test.ts`) flags `x[i]` as a computed member (2 failures in log 21). It was not caused by this change, but `pnpm test` must pass. |
| `packages/db/src/seed.test.ts` | The free-id example is 0125. | 0124 shipped |
| `apps/web/src/pages/reports/fee.test.tsx` | The pending-row cases, en and ar. | The web contract |

The QA files under `tests/qa/**` are qa-verifier's. The edits are minimal and listed here so that QA can review them.

## Files changed

| File | Purpose |
|---|---|
| `packages/db/migrations/0124_p6_export_live_selection_pending.sql` | **New.** Pending live selections (above). |
| `packages/db/src/schema.ts` | `export_job.snapshot_id` nullable; `selection`; column list. |
| `packages/db/src/seed.test.ts` | Free-id example 0125. |
| `apps/api/src/modules/reporting/exports/assembly.ts` | **New.** The export assembly watch. |
| `apps/api/src/modules/reporting/exports/jobs.ts` | Live start without assembly or outbox; D-199 kept synchronous (`transformationHasRestricted`, `restrictedAmong`); stored-selection replay; download of a pending job. |
| `apps/api/src/modules/reporting/exports/routes.ts` | Starts and stops the watch; kick after a pending 202. |
| `apps/api/src/modules/reporting/reports/snapshots.ts` | `checkReportRequest` (sync 422s); `insertSnapshot` / `insertGeneratedSnapshot` take an audit context (the watch has no request). |
| `packages/shared/src/schemas/export-jobs.ts` | Zod mirror: nullable `snapshotId`; two error codes. |
| `docs/api/openapi.yaml` | `ExportJob.snapshotId` nullable; error codes; createExport descriptions. |
| `apps/web/src/pages/exports/ExportsPage.tsx` | Pending and no-snapshot rows. |
| `apps/web/src/i18n/{en,ar}/reportsP5.json` | `exports.preparing`, `exports.noSnapshot`. |
| `apps/web/src/i18n/{en,ar}/problems.json` | `export__assembly_failed`. |
| `apps/api/test/integration/reporting/exports-assembly.test.ts` | **New** (13 tests). |
| The test files in the table above | As described. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Y5-evidence/*` | Logs, the copied drivers, the measurement JSONs. |

## Operations routed (pending-list delta)

None. `createExport`, `getExport`, `listExports`, `downloadExport` and `cancelExport` already existed and are
exercised. No `p6-pending-*.ts` or `p6-exercises-*.ts` change was needed. `contract.test.ts` passed (105 tests; the
pinned operation count is unchanged).

## For the orchestrator: contract, schema, dependency and coordination needs

1. **Contract change** (D-207 (3)):
   - `ExportJob.snapshotId` is nullable;
   - `ExportJob.errorCode` gains `export.includes_restricted_records` and `export.assembly_failed`.

   It is in `openapi.yaml` and the zod mirror. The web handles both.
2. **ARCH-11 (ADR-0046 §2, §8; ADR-0058 §7; data dictionary). Please carry:**
   - the new error code and its proposed exact English text (shared rule 17). `export.assembly_failed`: "The report
     could not be assembled from the current records (its subject or period changed, or it became too large); start a
     new export." `fee.test.tsx`'s "slice F problem texts" test reads ADR-0046 §8's `` `export.x` "text" `` pairs, so
     if ADR-0046 §8 lists the new codes, the texts must equal the en catalogue;
   - `export.includes_restricted_records` as a **job** error code. Its text is D-199's and already exists;
   - the audit actions `export_job.assemble`, and `export_job.fail` with a service actor on behalf of the requester;
   - the 0124 column, CHECK, index and guard.
3. **Migration id 0124.** Renumber at merge if another task ships 0124 first. The seed free-id example then moves
   with it.
4. **QA test edits** (`tests/qa/support/a15.ts`, `a12-…`, `a13-…`): listed above for qa-verifier.
5. **No new dependency.**

## User-facing texts made untrue

- No en/ar UI string said that a live export assembles its snapshot first; the web starts only snapshot exports. The
  "Open the snapshot" link would have pointed at `/reports/null` for a pending live job, so it is now replaced by the
  en/ar pending text.
- `docs/architecture/adr/ADR-0046…md` §2 ("An export of a live report first generates a snapshot from the request")
  and ADR-0058 §7 are now untrue. **ARCH-11 owns them** (D-207). I did not edit them.

## What remains

- The full-dataset re-measurement on the merged tree (devops, T-DG6-DO-Y2).
- ARCH-11's ADR, dictionary and ERD amendments (item 2 above).
- **The full integration suite** (acceptance item 3): stopped after 93 files with 0 failures. It must be run on the
  integrated tree (about 2 h serial on this host).
- See "Final check status" for anything not exit 0.

## Merge notes

- Migration 0124 (renumber if needed). There is no ordering constraint against other tasks' migrations: it only
  touches `export_job`.
- Expect conflicts only where another repair also touches `exports/jobs.ts`, `reports/snapshots.ts`,
  `export-jobs.ts`, `openapi.yaml` (ExportJob) or the web exports page.

## Checks (real exit codes)

Environment: Node 24.21.0, offline, harness ports 28400–28449. The host was shared with other repair tasks: load
average about 11–35 on 4 vCPU.

All logs are under `docs/delivery/handbacks/DG6/T-DG6-BE-Y5-evidence/`.

| Command | Exit | Result / log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` (log 00) |
| `vitest --project integration exports-assembly.test.ts` (first run) | 0 | 13 passed (log 01) |
| Targeted integration: `reporting/exports*` (5 files), `access/sensitive-reads*` (2), `report-snapshots`, `report-synthetic`, `contract/contract.test.ts`, `packages/db` catalogue, QA `a07`, `a12`, `a13`, `a15-outputs-every-definition` | **1** | 15 files: **260 passed, 3 failed**. All 3 are in QA's `a13-jobs-rerun.test.ts`: the first case counted 0 `export_job.requested` events right after the 202, and the other two depend on its job. Cause: the D-207 change, which the QA test did not yet run the assembly for (log 02). |
| The same a13 file after its fix, plus `exports-assembly` | **0** | 2 files, **18 passed** (log 04) |
| `pnpm -r typecheck` | **0** | log 03 (mid-task) and log 07 (final, after the last source change) |
| `pnpm -r build` | **0** | log 05 (before the AFTER measurement) and log 08 (final) |
| `pnpm lint` | **0** | `eslint . --max-warnings=0` (log 06; re-run at the end, log 09) |
| `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (log 06) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | run mid-task, and again after this handback was written (log 09) |
| `pnpm test`, locale unset (first run, 23:55Z) | **1** | unit-node **2 failed** / 2816 passed (187 files). Both failures are the ADR-0002 boundary walk flagging `reports/provisional.test.ts:198` (BE-Y4's `x[i]`, **already on HEAD**). unit-web 2020 passed (120 files); unit-formula-nocodegen 259 passed, 2 skipped (3 files) (log 21). |
| `vitest --project unit-node` on `provisional`, `reporting`, `architecture` tests, after the fix | 0 | 3 files, 168 passed |
| `pnpm test`, **locale unset** (re-run after the fix) | **0** | unit-node **2818 passed** (187 files); unit-web **2020 passed** (120 files); unit-formula-nocodegen **259 passed, 2 skipped** (3 files) (log 25) |
| `pnpm test`, **`LANG=C.UTF-8 LC_ALL=C.UTF-8`** | **0** | the same counts: 2818 / 2020 / 259 + 2 skipped (log 26) |
| e2e: `e2e/support/qa-stack.sh npx playwright test e2e/a15-reporting.spec.ts e2e/a02-demo-labels.spec.ts e2e/a12-p6-scope-isolation.spec.ts --workers=1` (ports 28411–28420) | **1** | **14 passed** (a15 and a12, chromium-en and chromium-ar), **6 failed: all of a02**, at `dev-login roaming.user.tl`. a02 needs the demo stack (its header: `e2e/support/with-demo-stack.sh`); I started it on the wrong stack (log 22). |
| e2e: `e2e/support/with-demo-stack.sh npx playwright test e2e/a02-demo-labels.spec.ts --workers=1` | **0** | **6 passed** (en and ar), including "an export generated by the worker in a demo database prints the illustrative label" (log 23) |
| Web `vitest fee.test.tsx` (verbose) | 0 | 19 passed, including the 2 new pending-row cases (en, ar) |
| Measurement BEFORE / AFTER / AFTER under load | 0 / 0 / 0 | logs 10, 11, 12 (driver exit 0; export-proof exit 1 as explained) |
| `QA_PG_PORT=28441 MTH_PORT_POOL=28442-28449 tests/qa/support/with-pg.sh pnpm test:integration` | **INCOMPLETE (stopped)** | Started 23:55Z. **93 files reported, 1527 tests passed, 0 failed**, then the run was **stopped at about 00:25Z by my tool's 30-minute background time limit**: I started it without a longer timeout. The project runs its files serially (about 411 files; about 3 files per minute on this host), so a complete run takes about 2 h or more and cannot fit in what is left of this task's 2-hour limit. **Acceptance item 3 is therefore not met by this handback.** The export, sensitive-reads, contract, catalogue and QA a07/a12/a13/a15 files, the ones this change touches, passed in the targeted runs (logs 02 and 04). (log 20) |

No pinned-count changes: `contract.test.ts` passed with its operation count unchanged. The new test file adds 13
integration tests. `fee.test.tsx` gains 2 cases.

## Final check status against the assignment's acceptance

| Acceptance item | State |
|---|---|
| 1. typecheck, build, lint, prettier, openapi lint all exit 0 | **Met** (logs 06–09) |
| 2. `pnpm test` passes with the locale unset and with C.UTF-8, in every Vitest invocation | **Met**: both runs exit 0, all three invocations each (logs 25, 26). The pre-existing HEAD failure was fixed first. |
| 3. Full `pnpm test:integration` inside `with-pg.sh` | **Not met: INCOMPLETE.** 93 files, 1527 passed, 0 failed before the stop. It must be run on the integrated tree. |
| 4. `validate.mjs --historical --stage DG5` exits 0 | **Met** (log 00) |

The measurement JSONs (`before/`, `after/`, `after-loaded/export-proof.json`) were reformatted by `prettier --write`
(whitespace only) so that the repository-wide prettier check passes. Their values are unchanged.

End time: `2026-11-02T00:42:17Z` (`date -u` after the final lint and prettier run), about 95 minutes after the start.
