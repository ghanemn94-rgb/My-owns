# Handback T-DG6-BE-Y6 (backend-workflow-engineer): DG6 round-1 follow-up — export assembly guard, persisted retry bound, problem-text pin

- **Stage / gate:** P6, DG6 (FIXING after review round 1). Branch `dg6/be-y6`, base `HEAD` `310d0b5af`. Changes are
  left **uncommitted**, as the assignment asks.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-Y6-backend-workflow-engineer-20261102T015629Z-0cc6fb1c","session_id":"0cc6fb1c-a4d4-4605-9980-b7233eab1ae3"}`.
  Assignment file sha256 `1ea0b887…dba32b`, verified with `sha256sum`.
- **Time:** started `2026-11-02T01:56:43Z` (`date -u`). The end time is at the bottom.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)`
  and exited **0**, both at the start and at the end (`T-DG6-BE-Y6-evidence/09-validate-DG5-historical.log`).
- **Migration:** **`0125_p6_export_assembly_attempts.sql`**. It is the next id above the highest file on this branch
  (0124, D-196). The orchestrator renumbers at merge if needed. The seed free-id example moves to **0126**.
- **New operations:** none. **New dependencies:** none. **Contract (OpenAPI / zod) change:** none.
- Engineering work only. Nothing here grants or implies a business, Finance or IT approval (G1–G6), and nothing
  touches DG0–DG7. All test data is synthetic.

## Changed files

| File | Purpose |
|---|---|
| `packages/db/migrations/0125_p6_export_assembly_attempts.sql` (new) | Column `export_job.assembly_attempt_count` and its CHECK; `export_job_guard()` replaced: refuses a snapshot whose `definition_code` differs from `selection ->> 'definitionCode'` (`export_job_snapshot_selection`), and lets the attempt count move only by +1 while the job is pending (`export_job_assembly_attempt_step`); a job is created with 0 attempts (`export_job_created_queued`). Every 0124 rule is kept verbatim. |
| `packages/db/src/schema.ts` | `ExportJobTable.assembly_attempt_count` and the `SCHEMA_COLUMNS` entry. |
| `packages/db/src/seed.test.ts` | Free-id example 0125 → 0126, with the history comment. |
| `packages/db/test/integration/catalogue.test.ts` | New case "0125: …": the column (integer, NOT NULL, default 0), its CHECK, and that the guard carries all 0124 constraint names plus the two new ones and the definition comparison. |
| `apps/api/src/modules/reporting/exports/assembly.ts` | The in-memory `errorCounts` map is gone. `assembleNextExport` now runs on one connection holding the job's `exportJob` advisory lock as a **session** lock, and in two transactions: (0) claim and **count the attempt, committed on its own**, or fail the job `export.assembly_failed` when the count has reached `EXPORT_ASSEMBLY_MAX_ERRORS`; (1–5) the unchanged assembly transaction. New hook `afterAttemptCounted` (tests). Header comments updated. |
| `apps/api/test/integration/reporting/exports-assembly.test.ts` | 5 new tests (below). Existing expectations moved by the counted attempt: versions +1, and one extra audit row `export_job.assembly_attempt`. |
| `apps/api/test/integration/reporting/exports.test.ts` | One expectation: the assembled live job is version 3, not 2 (the counted attempt). |
| `apps/web/src/pages/reports/fee.test.tsx` | "slice F problem texts" reads ADR-0046 R5's `job (assembly)` rows (`JOB_ROW`), checks that exactly the two codes are read, binds their English text to the ADR and their Arabic text to differ and be Arabic; pin 24 → 26. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Y6-*` | This handback and its logs. |

## Behaviour delivered

Requirement row **REQ-S13-005** (the row the three findings cite). Its acceptance text, quoted: *"A15: an XLSX export
of T15 contains exactly the filtered RAID rows; a PPTX gate pack contains the gate's criteria"*. Its async clause:
*"Long export -> async job with progress"*. This task does not change what an export contains. The a15 QA files still
pass (see checks). It hardens the async job's assembly step.

### 1. F-DG6-sa12-1: the database refuses a snapshot of another definition (migration 0125)

- `export_job_guard()`: when a snapshot is assigned to a job (insert with a snapshot, or the pending NULL → snapshot
  assignment) **and** the job carries a stored `selection`, a snapshot whose `definition_code` is distinct from
  `selection ->> 'definitionCode'` raises `check_violation`, constraint **`export_job_snapshot_selection`**.
- Test: `F-DG6-sa12-1 and the attempt step … > refuses a snapshot of another definition than the stored selection's;
  accepts the selection's own`. It creates a pending `registers` job in `pdf` (charter offers pdf too, so only the
  definition differs), generates a real `charter` snapshot through the API, and assigns it as `mth_owner`: refused
  with `export_job_snapshot_selection`, row unchanged. The watch then assigns the selection's own snapshot (accepted).
- **Fails before:** with 0125 minus the new check, this test fails (`00-before-fix.log`). There the `mth_owner`
  autocommit UPDATE is still refused, but only at COMMIT by the deferred `export_job_audit_required` trigger (no audit
  event), not by a definition check. The test asserts the constraint name, so it distinguishes the two; a mismatched
  assignment that carried its audit event would have committed before 0125.

### 2. F-DG6-sa12-3: the assembly attempt count is persisted, so the bound holds across restarts

- **Column** `export_job.assembly_attempt_count integer NOT NULL DEFAULT 0`, CHECK
  `export_job_assembly_attempt_count_check (>= 0)`. Existing rows get 0.
- **Flow** (`assembleNextExport`), on one pooled connection:
  - **Step 0, its own committed transaction:** claim the oldest pending job `FOR UPDATE SKIP LOCKED`, then
    `pg_try_advisory_lock` (session level) on class `exportJob` (730264, ADR-0016; no new number). If
    `assembly_attempt_count >= EXPORT_ASSEMBLY_MAX_ERRORS` (3), fail the job `export.assembly_failed` (audited
    `export_job.fail`, as before). Otherwise set `assembly_attempt_count + 1`, version + 1, audit
    **`export_job.assembly_attempt`** (service actor on behalf of the requester; `changes.assembly_attempt_count`
    from → to), and **COMMIT before anything is assembled**. A crash that kills the process in the middle of the
    assembly therefore leaves the attempt counted.
  - **Steps 1–5, one transaction:** re-read the job `FOR UPDATE` at the counted version (still pending), then
    exactly the BE-Y5 flow: access check, assembly on its own read-only connection, commit-time access check, D-199,
    snapshot + assignment + `export_job.requested` outbox event together.
  - **`finally`:** `pg_advisory_unlock`. A connection lost with the process loses the lock with it.
- **Why a session lock:** between step 0's COMMIT and step 1 the row is not locked. The session lock keeps every
  other watcher out (their try-lock fails, and they skip the job), and keeps cancel waiting as before. Without it,
  two watchers racing on one job would each count an attempt, and a healthy job could reach the bound without ever
  failing. The worker and cancel take the same class with `pg_advisory_xact_lock` (blocking) and take no row lock
  first, so the order is unchanged and no deadlock is possible. The claim transaction is now short (it never
  assembles), so the row locks it holds while skipping jobs end quickly.
- **At-most-once is unchanged:** the snapshot, the assignment and the outbox event still commit together in one
  transaction; the 0124 "assigned once" rule and the unique outbox key still back it up.
- **D-207 behaviour is unchanged:** 202 with `snapshotId: null`; the same error codes for the same causes
  (`export.source_unavailable`, `export.includes_restricted_records`, `export.assembly_failed`); exports of an
  existing snapshot never touch the watch; cancel of a pending job as before; the same `EXPORT_ASSEMBLY_*` values.
  **One observable difference, disclosed:** each attempt is a versioned, audited mutation (the generic
  `p2_row_guard` requires version + 1 and `p2_audit_required` an audit event on every `export_job` update), so a
  live job that is assembled at the first attempt now ends assembly at **version 3** (1 created, 2 attempt,
  3 assigned) instead of 2, and its audit trail has one more row. The API contract is unchanged (the version is
  already an opaque ETag; a client holding version 1 already got 409 after the assembly).
- **Guard:** the count is 0 on insert; it changes only by exactly +1, only while the job is queued with no snapshot
  before and after (`export_job_assembly_attempt_step`); a finished job stays frozen.
- **Tests (new, `exports-assembly.test.ts`):**
  - *a job whose assembly kills the process is attempted at most 3 times across restarts, then fails
    export.assembly_failed*: each "process" is a fresh copy of `assembly.ts` (`vi.resetModules()` + dynamic import,
    so no in-process state survives) whose assembly dies before COMMIT; the count is 1, 2, 3 on the job; the fourth
    fresh process fails the job with no snapshot, no outbox event; audit trail `create, attempt ×3, fail`.
  - *the attempt is committed before the assembly starts …*: from another connection, inside the
    `afterAttemptCounted` hook, the row already shows count 1 / version 2; after a kill there, the next fresh
    process assembles once (count 2, version 4, one outbox event, one `export_job.assemble`).
  - *a watcher holding a job keeps a second one out between its two transactions (session lock), and releases the
    lock after the job*: a second `assembleNextExport` returns `none` while the first is between its transactions;
    the count stays 1; afterwards `pg_locks` shows no advisory lock for the job.
  - *the assembly attempt count is 0 on insert and steps by exactly 1, only while the job is pending*: +2, −1, a
    cancelled job, an assembled job and an insert with 1 are all refused with the named constraint.
  - The existing BE-Y5 tests (crash before commit, bounded retries, two watchers racing over 6 jobs, SKIP LOCKED,
    cancel) all still pass, with the moved versions.
- **Fails before:** with the HEAD `assembly.ts` (in-memory `errorCounts`) the three F-DG6-sa12-3 tests fail
  (`00-before-fix.log`: the kill test finds no persisted count; the "committed before the assembly" test sees the job
  assembled because there is no `afterAttemptCounted` step; the session-lock test times out at 30 s because the hook
  never runs. That last test carried an earlier title in that log, "the session lock is released after each job (a
  cancel that waits for it proceeds) …", renamed afterwards because it exercises no cancel). The
  guard-step test passes there because it exercises the 0125 guard only.

### 3. F-DG6-sa12-2: the two assembly job codes' texts are bound to ADR-0046 R5

- The en texts already equal the ADR exactly, so no en/ar string changed.
- **Fails before:** `02-fee-before-after.log`. With `export__assembly_failed`'s en text perturbed (that one key only),
  the HEAD test (pin 24) still passes (exit 0), and the new test fails on `export.assembly_failed`. The files were
  restored afterwards (`git diff` of `apps/web/src/i18n/` is empty).

## Checks (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; PostgreSQL from `tests/qa/support/with-pg.sh`
(disposable cluster) on ports 28600–28649 only. All logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Y6-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | (start, shown in session; repeated at the end in 09) |
| 1 | `with-pg.sh npx vitest run --project integration exports-assembly.test.ts -t "F-DG6-sa12"` on the **pre-fix** code (HEAD `assembly.ts`, 0125 without the definition check) | 1 | 4 failed, 1 passed, 13 skipped (expected: the before state) | `00-before-fix.log` |
| 2 | `with-pg.sh npx vitest run --project integration exports-assembly.test.ts catalogue.test.ts` | 0 | 2 files, 56 tests passed | `01-assembly-catalogue.log` |
| 3 | perturbation of `export__assembly_failed` en text: HEAD `fee.test.tsx` vs new | old 0 / new 1 | the old test misses it, the new one catches it (expected) | `02-fee-before-after.log` |
| 4 | `with-pg.sh npx vitest run --project integration reporting/exports access/sensitive-reads contract/ catalogue a13 a15` (first run) | 1 | 24 files passed, 1 failed; 398 passed, **1 failed**: `exports.test.ts` "a live selection is accepted …" still expected version 2 after assembly. Cause: the counted attempt (by design, see item 2). Fixed in the test (version 3); re-run in row 5. | `03-integration-touched.log` |
| 5 | `with-pg.sh npx vitest run --project integration` on `reporting/exports*` (5 files), `access/sensitive-reads*` (2), `contract/` (all), `branding/branding`, `reporting/report-synthetic`, `reporting/table-totals-demo`, `security/rate-limits`, `packages/db/.../catalogue`, QA `a13*` (all 11), `a15*` (all 4), `a02-a21-complete-lifecycle`, `a07-historical-integrity`, `a12-p6-scope-isolation` (every integration file that reads `export_job` or calls the exports API or the watch) | **0** | **33 files, 499 tests passed**, 813 s | `03b-integration-touched-final.log` |
| 6 | `pnpm -r typecheck` | **0** | all packages done | `04-typecheck.log` |
| 7 | `pnpm lint` | **0** | `eslint . --max-warnings=0` clean | `05-lint.log` |
| 8 | `pnpm -r build` | **0** | all packages done | `06-build.log` |
| 9 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `07-openapi-lint.log` |
| 10 | `pnpm test`, `LANG`/`LC_ALL`/`LC_CTYPE` unset | **0** | unit-node 189 files / 2,851 tests passed; unit-web 120 / 2,020 passed; unit-formula-nocodegen 3 / 259 passed, 2 skipped (skips are in that project and untouched by this task) | `08a-unit-locale-unset.log` |
| 11 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | **0** | the same counts | `08b-unit-c-utf8.log` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | **0** | `PASS gate DG5 (historical)` | `09-validate-DG5-historical.log` |
| 13 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `All matched files use Prettier code style!` (run last, after this handback was final) | `10-prettier-check.log` |

Not run: the full `pnpm test:integration` (the assignment says the orchestrator runs it on the merged tree). No e2e
spec was added or changed, so no e2e budget applies.

## Operations routed (pending-list delta)

None. No operation was added, removed or routed; no `p6-pending-*.ts` or `p6-exercises-*.ts` file changed. The
contract suite (`contract/`, including `response-validation`: 932 of 932 live operations validated) passes in row 5.

## For the orchestrator: contract, schema and dependency needs

- **Contract:** none. `ExportJob` is unchanged; `assembly_attempt_count` is not exposed.
- **Schema (for the data dictionary owner, solution-architect):** migration **0125** adds
  - `export_job.assembly_attempt_count` — `integer NOT NULL DEFAULT 0`, CHECK
    `export_job_assembly_attempt_count_check (assembly_attempt_count >= 0)`. Meaning: the assembly attempts of a
    pending live selection that were started (counted and committed before each assembly). Written only by the API
    export assembly watch, with version + 1 and the audit action `export_job.assembly_attempt`. Not in the API.
  - `export_job_guard()` replaced: new constraint names `export_job_snapshot_selection` (an assigned snapshot's
    definition must equal `selection ->> 'definitionCode'`) and `export_job_assembly_attempt_step` (+1 only while
    queued with no snapshot); `export_job_created_queued` now also requires `assembly_attempt_count = 0`.
  - No index, no privilege change (mth_app already has SELECT/INSERT/UPDATE on `export_job`; the catalogue test's
    privilege check passes).
- **ADR-0046 text now untrue (for the architect):**
  - R4 "Bounded retry": "The count is in memory per process, so a restart starts it again. The bound therefore holds
    per process lifetime" — now the count is on the job, counted in its own committed transaction, and the claim's
    advisory lock is a **session** lock held across the attempt and the job transaction (still class 730264, still
    only tried). The data dictionary row "Watch (`assembly.ts`, API process)" says "`EXPORT_ASSEMBLY_MAX_ERRORS` 3
    (per job, per process)" — now per job, persisted.
  - R4 "One transaction per job" — now one committed attempt transaction, then one transaction per job. R4 "Pool use"
    is unchanged (the attempt and the job transaction use the same connection; the assembly its own).
  - R6 audit actions per job transition: add `export_job.assembly_attempt` (service actor on behalf of the
    requester).
  - R2 "The guard does not check that the assigned snapshot's `definition_code` equals `selection.definitionCode`" —
    it now does (0125).
  - R5 parenthesis "`fee.test.tsx` pins the number of §8 codes it reads to 24, and it does not read this table" — it
    now reads the table, pin 26.
- **Dependency:** none.

## User-facing texts made untrue

None. No feature that an en/ar string calls planned or later shipped here. The en texts of
`export.includes_restricted_records` and `export.assembly_failed` already equalled ADR-0046 R5, so neither the en nor
the ar string changed. The `export.assembly_failed` text ("…start a new export") stays true: a job that hit the bound
is failed and must be restarted.

## Merge instructions

- Apply migration `0125_p6_export_assembly_attempts.sql` after 0124 (renumber if another task took 0125, and move
  the seed free-id example and the catalogue test title with it).
- Expect conflicts only in `packages/db/src/schema.ts` (`ExportJobTable`, `SCHEMA_COLUMNS.export_job`) and
  `packages/db/src/seed.test.ts` (free-id comment) if another task touched them.

## What remains

- Nothing of the three findings' scope. F-DG6-sa12-1/2/3 stay open until a reviewer verifies them.
- The ADR-0046 and data-dictionary text listed above, for the architect.

Nothing here grants a G1–G6 business, Finance or IT approval, or implies any DG0–DG7 gate result.

End time: see `10-prettier-check.log` (its first line is `date -u` at the final check).
