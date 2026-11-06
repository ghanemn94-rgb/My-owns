# Handback T-DG6-AN-Z4 (transformation-analyst): register rows after the DG6 round-5 repairs

- **Stage:** DG6 (P6), FIXING after review round 5. **Task:** T-DG6-AN-Z4.
- **Invocation:** `DG6-T-DG6-AN-Z4-transformation-analyst-20261106T025617Z-b3f70ae9`, session `b3f70ae9-3fa6-442c-a4d4-b46d6221b48c`.
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-AN-Z4.md`. Its sha256 `7b9313218d5dd6ec2b82026f98624417d47b3aa9cdfcde55f799b501151c7c4b` matched before I read it.
- **Base:** branch `dg6/an-z4` at `fe546d2310d69f40609d3ee171aacb809ad46edd`, with a clean tree. The base has BE-Z7B merged at `48360e6c3`, BE-Z8 at `cbc78af0b` and ARCH-15 at `1bdd588e7`.
- **Round-5 candidate:** `832e5c82`, source `d7b21bad3`. I checked that its product tree equals `8a24a1c62`: `git diff 8a24a1c62 d7b21bad3 -- . ':!docs'` is empty.
- **Changes:** uncommitted, as instructed.
- **Approvals:** I am an engineering agent and granted no business, Finance or IT approval. No G1–G6 product gate was touched, and nothing here implies DG6 or DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | 8 DG6 rows: `notes` and `evidence` only. No status changed. |
| `docs/delivery/handbacks/DG6/T-DG6-AN-Z4-transformation-analyst.md` | This handback. |

**How the edits were made:**
- Every edit is an insertion. Earlier analyst checks are kept word for word (a `difflib` check shows only `insert`/`equal` opcodes, §3.4).
- Statements that are now out of date get an inline `[T-DG6-AN-Z4: …]` correction. Examples: "stays OPEN until a round-5 reviewer verifies it" and "the final verification is review round 5".
- Each changed row ends with a new check, `DG6 analyst check (T-DG6-AN-Z4, …)`.

## 2. Rows changed: acceptance clause, the test that asserts it, and the log that shows it passing

Common facts used in several rows:
- **Round-5 product tree:** the orchestrator's verification of `8a24a1c62` passed every step (`orchestrator-final-8a24a1c/summary.txt`, all exit 0). Integration was 422/422 files (4238 passed, 1 skipped, 1 todo). Web e2e was 552 passed and 2 skipped, with the locale unset and with C.UTF-8. Root e2e was 288 passed and 18 skipped; demo e2e 10 passed. I confirmed these numbers in the logs.
- **Merged tree with BE-Z7B, BE-Z8 and ARCH-15:** it has **no full run yet**. Each changed row says so: the binding re-run is the orchestrator's final verification, which comes after me, and the final verification is review round 6.

### REQ-S10-002 (BE-Z7B, ARCH-15; F-DG6-360, 361, 362, 340)

- **Acceptance:** *A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant.*
- **Tests:**
  - `apps/api/test/integration/access/sensitive-reach-dashboards-reports.test.ts` (8 tests): overview, every drill-down metric and value class, value.gap, live and snapshot register totals, a synthetic workstream, no member when nothing is sensitive.
  - The rewritten `sensitive-reach-sweep.test.ts` (2 tests).
  - `apps/web/src/pages/reports/restricted-labels.test.tsx` (8 tests, en and ar).
- **Logs:**
  - With the product source reverted, the API tests fail: `01-before-fix-sweep-and-z7b.log`, `Tests 6 failed | 4 passed (10)`, `EXIT=1`.
  - After the fix they pass: `02-after-fix-sweep-and-z7b.log`, `Tests 10 passed (10)`, `EXIT=0`. The sweep reports `555 requests per reader over 371 operations (520 ids); 75 operations not fillable`, `2428 pages read` and `364 operations read (2xx) by an admitted reader`.
  - The web label test passes in pnpm test logs 20 and 21 (`restricted-labels.test.tsx (8 tests)`, `EXIT=0`).
- **Notes now say:**
  - the overview, drill-down and dashboard restriction;
  - that `includesRestrictedRecords` is set by `restrictedFieldAfter`;
  - the report-section read-time member and the en/ar label;
  - that the sweep is a real guard: contract-filled parameters, maximum limit, every page, the admitted-reader 4xx/5xx guard with 7 justified entries, and a floor counted on reads;
  - the two additive contract members, and ARCH-15's ADR-0037, ADR-0045 and ADR-0051 amendments;
  - that F-DG6-280 and F-DG6-300 are CLOSED_VERIFIED in round 5.
- **Residuals disclosed (BE-Z7B §7):**
  1. 75 unfillable GET operations;
  2. the empty search index;
  3. the flag-only adoption filter;
  4. the omitted-table totals placeholder.
- **Disclosed failure:** BE-Z7B's 49-file batch (`30-integration-touched.log`) **exited 1**. 48 files passed; the one failure was the new file's `beforeAll`, caused by a workstream code in the test. That file passes in `02-…`, but the batch was not re-run.

### REQ-S12-019 (BE-Z8, BE-Z6, ARCH-15; F-DG6-380, 341)

- **Acceptance:** *A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date.*
- **Tests:**
  - `apps/api/test/integration/operations/concurrent-exception-recurrence.test.ts` (7 tests).
  - `exception-recurrence-race.test.ts` (7 tests, BE-Z6).
  - KPI Stale: `exception-last-known-value`, `run-failure-kpi-links`, `connector-failure-exception` and `operations-freshness`.
- **Logs:**
  - BE-Z8 before the fix: `01-new-test-before-fix.log`, `Tests 7 failed (7)`, `exit=1`.
  - After the fix: `02-new-test-after-fix.log`, `7 passed`, `exit=0`.
  - `03-targeted-integration.log`: 25 files, 368 passed, `exit=0`.
  - `04-new-and-race-repeat.log`: 14/14 three times.
  - BE-Z6: `race-before-fix.log` 5 failed and 2 passed; `race-after-fix.log` 7 passed. The race test also passes 7 tests in `orchestrator-final-8a24a1c/integration.log`.
- **Gap noted in the row:** `e2e/a17-failing-connector-exception.spec.ts` was not re-run after BE-Z8. It last passed in `orchestrator-final-8a24a1c/root.log` (en and ar).
- F-DG6-320 is now recorded as CLOSED_VERIFIED by qa in round 5.

### REQ-S20-013 (BE-Z8; F-DG6-380)

- **Acceptance:** *A13: Retried events, worker restarts and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable.*
- **Tests:**
  - `concurrent-exception-recurrence.test.ts`, part 1: the QA burst at N = 4 and N = 8. It asserts one `operational_failure` row and one `job.failed` row per job, one exception, occurrences equal to the total, and no backwards move.
  - `a13-durable-automation` and `a13-starters-run`, in BE-Z8's 25-file run.
  - `e2e/a13-automation-recovery.spec.ts`.
- **Logs:** BE-Z8 `01-…` (exit 1) and `02-…` (exit 0); `03-…` (exit 0); `30-e2e-a22-a13.log` (`4 passed`, `exit=0`).
- **Notes now say:** one capture per failure whatever the commit order; nothing is duplicated (ledger, one-active index, outbox key); the BE-Z6 acknowledge rule.
- **Gap noted:** the QA-C kill-and-restart drills were not re-run after BE-Z8. They last passed in `orchestrator-final-8a24a1c/integration.log`.

### REQ-S20-022 (BE-Z6 rule, ARCH-15, BE-Z8; F-DG6-341, 380)

- **Acceptance:** *A22: Health checks, logs, error alerts, admin job visibility and production/demo separation are demonstrated.*
- **Tests:** `e2e/a22-p6-operability.spec.ts`, which forces the recurrence-then-stale-acknowledge race; `exception-recurrence-race.test.ts`; `concurrent-exception-recurrence.test.ts` (the API interleaving covers the heartbeat watch).
- **Logs:**
  - The A22 spec passed in `orchestrator-final-8a24a1c/root.log` (lines 293 and 456: chromium-en and chromium-ar) and again in BE-Z8 `30-e2e-a22-a13.log` (exit 0).
  - BE-Z8 `02-…` shows the API interleaving fix.
- **Notes now say:** the BE-Z6 acknowledge/resolve rule; that ARCH-15 recorded it in ADR-0053 §2 and §9 (F-DG6-341); the BE-Z8 recurrence fix; and that F-DG6-320 is CLOSED_VERIFIED in round 5.
- **Gap noted:** `tests/qa/integration/a22-p6-operability.test.ts` was not re-run after BE-Z8. It last passed in `8a24a1c`.

### REQ-S17-001 (BE-Z8 raiser table)

- **Acceptance:** *A17: a test connector run records last success, row counts, errors and retries, all visible in the UI.*
- **Why this row changed:** before BE-Z8, a rejected connector recurrence rolled back the run outcome, and pg-boss retried the job (BE-Z8 handback, "Raisers checked").
- **Tests:** the worker-twin interleaving case of `concurrent-exception-recurrence.test.ts`; `integrations/runs`, `run-failure-kpi-links` and the worker's `connector-failure-exception`.
- **Logs:** BE-Z8 `01-…` (exit 1), `02-…` (exit 0) and `03-…` (exit 0).
- F-DG6-281 is now recorded as CLOSED_VERIFIED by the domain reviewer in round 5.
- The UI clause is unchanged.

### REQ-S15-007 (BE-Z7B labels)

- **Acceptance:** *A20;A15: a test finds no missing ar or en key; a validation error returned by the API is shown in the selected language; an Arabic export keeps 'KPI-001' and '12.5%' readable.*
- **What changed:** BE-Z7B renders the label on the overview and on report sections using the existing key `access.includesRestrictedRecords`, so no key was added.
- **Test:** `restricted-labels.test.tsx`, which asserts en and ar.
- **Logs:** BE-Z7B pnpm test logs 20 and 21 (exit 0).
- F-DG6-301 and F-DG6-320 are now recorded as CLOSED_VERIFIED in round 5.
- **Residual:** the Arabic text is provisional.

### REQ-DLV-038

- **Acceptance:** *the applicable A01–A22 executable tests pass on the DG6 candidate and the load report states the actual results against REQ-S20-029.*
- **Evidence:** the `8a24a1c62` run (README, summary, integration, both e2e logs, root and demo logs) is the A01–A22 evidence of the round-5 candidate.
- **Notes now say:** where the round-5 findings were filed and repaired, and that the round-4 findings are verified.
- The merged tree's run is pending (orchestrator, then round 6).

### REQ-S20-029 (notes cite dashboards)

- **Acceptance:** *the load report … gives actual p95 figures for reads/updates and dashboards …*
- **Added:** a disclosure, not a measurement. BE-Z7B changed the overview, drill-down and dashboard read paths, and no load run has measured them since. The p95 dashboard figures describe the tree before BE-Z7B.
- Flagged as a **real gap** (§4).

### Rows considered and left unchanged

- **REQ-S02-006, S13-011, S13-013, S15-001, S15-011:** a keyword match only (for example "static dashboard", "approved totals"). No round-5 repair touches their clauses.
- **REQ-S10-004, S15-010, S20-012** (search and export scope): BE-Z7B's search-index residual concerns the sensitive-benefit sweep, which is recorded on REQ-S10-002. These rows' notes name no round-5 finding or task.
- **Rows with `final_gate` DG7:** none touched.

## 3. Checks run (real output)

**Environment:** the worktree, Node from PATH, offline.

### 3.1 Register validator

```
$ node tools/gates/validate.mjs --register DG6
PASS register rules at DG6
exit=0 (DG6)
$ node tools/gates/validate.mjs --register DG5
PASS register rules at DG5
exit=0 (DG5)
$ node tools/gates/validate.mjs --register DG4
PASS register rules at DG4
exit=0 (DG4)
```

No failures to list. The same three commands also printed PASS on the unchanged base before I edited anything.

### 3.2 CSV integrity, my rows only, evidence paths

The script is in my run's scratchpad, `check.py`. It parses with `csv.reader(strict=True)` and compares against `git show HEAD:docs/delivery/requirements.csv`. Exit 0:

```
CSV integrity: rows (incl. header) 413 base 413
column counts [19] header cols 19
header unchanged True
re-serialises byte-identical True
same ids, same order True
changed rows:
  REQ-DLV-038 final_gate=DG6 status IMPLEMENTED->IMPLEMENTED cols=['evidence', 'notes']
  REQ-S10-002 final_gate=DG6 status IMPLEMENTED->IMPLEMENTED cols=['evidence', 'notes']
  REQ-S12-019 final_gate=DG6 status IMPLEMENTED->IMPLEMENTED cols=['evidence', 'notes']
  REQ-S15-007 final_gate=DG6 status IMPLEMENTED->IMPLEMENTED cols=['evidence', 'notes']
  REQ-S17-001 final_gate=DG6 status IMPLEMENTED->IMPLEMENTED cols=['evidence', 'notes']
  REQ-S20-013 final_gate=DG6 status IMPLEMENTED->IMPLEMENTED cols=['evidence', 'notes']
  REQ-S20-022 final_gate=DG6 status IMPLEMENTED->IMPLEMENTED cols=['evidence', 'notes']
  REQ-S20-029 final_gate=DG6 status IMPLEMENTED->IMPLEMENTED cols=['evidence', 'notes']
evidence paths of changed rows:
  REQ-DLV-038: 71 paths, 7 added, missing 0 []
  REQ-S10-002: 104 paths, 27 added, missing 0 []
  REQ-S12-019: 57 paths, 21 added, missing 0 []
  REQ-S15-007: 49 paths, 8 added, missing 0 []
  REQ-S17-001: 37 paths, 10 added, missing 0 []
  REQ-S20-013: 32 paths, 22 added, missing 0 []
  REQ-S20-022: 57 paths, 22 added, missing 0 []
  REQ-S20-029: 29 paths, 1 added, missing 0 []
missing total 0
exit=0
```

Every evidence entry is checked as an existing regular file (`os.path.isfile`).

### 3.3 `git diff --stat`

Run before this handback existed:

```
 docs/delivery/requirements.csv | 16 ++++++++--------
 1 file changed, 8 insertions(+), 8 deletions(-)
```

The handback is the only other file: new and untracked. No `docs/analysis/**` note was needed.

### 3.4 Earlier text preserved

A `difflib` comparison of each changed row's notes against the base finds only `insert` and `equal` opcodes. Each evidence field is the base value with paths appended. Exit 0.

## 4. Known gaps (real, not papered over)

1. **No full run of the merged tree** (BE-Z7B + BE-Z8 + ARCH-15). Every changed row rests on the repairs' targeted runs plus the `8a24a1c62` run of the tree before them. Final verification: the orchestrator's run after me, then review round 6.
2. **BE-Z7B's 49-file batch exited 1.** The failure was in its own test fixture, which was fixed and passes alone; the batch was not re-run. Recorded on REQ-S10-002.
3. **Not re-run after BE-Z8**, recorded on each row:
   - `e2e/a17-failing-connector-exception.spec.ts` (REQ-S12-019);
   - the QA-C A13 kill-and-restart drills (REQ-S20-013);
   - `tests/qa/integration/a22-p6-operability.test.ts` (REQ-S20-022).
4. **REQ-S20-029:** the dashboard p95 figures predate BE-Z7B's dashboard read-path change, and nothing has measured it since. Status left IMPLEMENTED because the row's acceptance (a load report with actual figures) is met by the existing report. The current tree's dashboard latency is unmeasured.
5. **Open findings:** F-DG6-340, 341, 360, 361, 362 and 380 stay OPEN until a non-author reviewer verifies them. I closed nothing.
6. **REQ-S10-002 residuals** (BE-Z7B §7):
   - 75 unswept GET operations;
   - the search index is not built in the sweep;
   - no response member labels the adoption filter;
   - the omitted-table totals placeholder.

## 5. Merge instructions

- Notes and evidence only, in 8 rows. No migration, code or contract change.
- A conflict is possible only if another branch edits the same 8 rows of `requirements.csv`.
