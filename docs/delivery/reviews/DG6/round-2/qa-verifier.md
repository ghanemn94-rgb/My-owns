# DG6 review round 2: qa-verifier (T-DG6-REV-QA-R2)

- **Candidate:** `sha256:cf40705b734ba75d1a80f4df0e38d9dde46a95b93e2601cabfe51be49bc5bf0d` (2720 files), recomputed on a complete clone at the source commit `9bb2207667d8ef68e32e351a3782c4e9dfcdecd1` (`00-candidate.log`). The repository HEAD at the start (`e56b3d2fc`, later moved by the other reviewers' auto-committed runs) differs from the source commit only in delivery metadata (assignments, manifest, progress, stages, run folders). A clone of that HEAD gave the same candidate id, so the frozen tree is the one reviewed.
- **Verdict: FAIL.** Seven of my eight round-1 findings verify closed on this candidate. **F-DG6-144 (Low) does not**: it stays OPEN. The assignment allows PASS only if every one verifies CLOSED_VERIFIED. I raise two new Low, non-blocking findings (F-DG6-200, F-DG6-201). Nothing Critical, High, Medium or mandatory is open in my scope.
- **Evidence:** `docs/delivery/test-evidence/DG6/qa/round-2/` (logs, each with a `-samples.log` load sampler). My tests are in `docs/delivery/test-evidence/DG6/qa/tests/round-2/`.
- **Environment:** a disposable clone under `$TMPDIR` with an offline pnpm install from a copy of the pre-installed store (writable `node_modules`, so `--configLoader runner` was not needed), and disposable PostgreSQL 16.15 clusters (UTF8, C collation) on ports 28800–28899. Node 24.21.0; the Node 22 present is **22.22.0**, not the 22.22.2 the assignment names. Pre-installed Chromium is used; `E2E_SCREENSHOT_DIR` points to `$TMPDIR`. The host has 4 vCPUs and 16 GB, shared by three concurrent reviews: the 1-minute load was mostly 15–37, and free memory sometimes fell under 2 GB.

## The round-1 findings, re-verified adversarially

| Finding | Result | How |
|---|---|---|
| F-DG6-140 (Medium) | CLOSED_VERIFIED | My round-1 probe, unchanged, now passes: the last data is in the previous period and the current period is open and empty; `kpiFreshness` reports stale, 0.4125, 2026-01-15; the scan gives stale 1 and emitted 1; there is one `data.stale` event. Three new adversarial cases also pass: two empty later periods; a fresher value in a later period wins (no false stale); and recovery after a stale episode. Reverting `operations.ts` to round 1 makes 4 of my 5 probe tests and 3 of the candidate's tests fail (`10b`, `11-mutants-run.log`). |
| F-DG6-141 (Medium) | CLOSED_VERIFIED | With a budget of 1, the second call is `429 rate_limited` with `Retry-After 60`, for `createExport` and `createImport` as for `uploadEvidenceContent`. `loadConfig` resolves `export` 10 and `upload` 30. At those documented defaults, call 11 (export) and call 31 (import) are 429, and a second session is not counted. The mutant that unwires both is caught by the candidate's `rate-limits.test.ts` and by my probe. My first part-2 run omitted the variables and so measured the harness's 100000 (3 expected failures). That error was mine and is disclosed in `10-probe-f140-f141.log`; the corrected run is `10b`. |
| F-DG6-142 (Medium) | CLOSED_VERIFIED | The tree's `generate.mjs` is sha256 `6b2a9007…`. The smoke profile gives 30/30 initiatives and 3/3 transformations served 200 by the API. On the default profile, 770,559 UUID values were checked; the only 120 non-RFC ones are DG5 catalogue rows that exist in an **empty** migrated database (migrations 0069/0070, keyed by step key, not by path id). The pre-repair generator fails 4/4 of `load-generate-ids` (`12`, `12b`, `14-load-driver.log`, `14b`). |
| F-DG6-143 (Low) | CLOSED_VERIFIED | `/admin/upload-policy` is 360 = 360 at 360 px and 1280 = 1280 at 200 % text, in en and ar, unset and C.UTF-8. A web build with the `wrap` prop removed reproduces round 1 exactly: 385 > 360, from `span.status-chip` (`13b`, screenshots in `13-f143-shots/`). |
| **F-DG6-144 (Low)** | **OPEN** | The 17 named specs now carry measured budgets. But the finding's own round-1 reproduction named `p4-benefits` test 8 and `p4-gates-closure` test 6, and FE-Y1's handback lists both as "Not done". On this candidate, `p4-benefits` 8 timed out at 30 s in 3 of the 4 full product runs (en unset, ar unset, en C.UTF-8; it passed in ar C.UTF-8). `p4-gates-closure` 6 and `p3-journeys` 2a also timed out at 30 s, in the full run and again when re-run alone at load ~20. With a measurement-only `--timeout=120000` all three pass (36/36; 43.3 s for `p4-benefits` 8), so there is no product defect behind them, only the missing budget. A static scan finds 14 specs that budget some tests but not others (`16-f144-budget-static.txt`). |
| F-DG6-145 (Low) | CLOSED_VERIFIED | `route-inventory` (cases lasting 131 s, well over the 60 s touch interval) and `dependency-slip-relay` pass in both integration runs, at loads of 18–30. A mutant that compares the session table's sliding columns again fails the new F-DG6-145 test with `public.session` changed (`15`). |
| F-DG6-146 (Low) | CLOSED_VERIFIED | Route-inventory case 4 gives statuses `{"400":482}`, and `REPORTED_DEVIATIONS` is empty. Restoring `tomGapCreateLenient` brings back `422 t03.dimension_required`, and the candidate test catches it (`11-mutants-run.log`). |
| F-DG6-147 (Medium) | see below | The start is now answered before assembly (D-207). See the export-proof section. |

## What failed in my logs, and why (evidence honesty)

- **Integration run 1, half B:**
  - The Vitest fork crashed with `ERR_IPC_CHANNEL_CLOSED` after 99 files, at about 2 GB of free memory, the same crash BE-Y3 reports. The remaining 107 files ran as a continuation (`B2`).
  - Three tests failed:
    - two `response-validation` cases timed out (30 s and 90 s) under load; they pass alone (113/113);
    - `exports-assembly` › the 0125 guard test, and `change-requests-in-tx` › round-2 resubmission: both are test-side races, reproduced and explained by probes with controls (**F-DG6-200**). The product behaviour behind them was verified correct.
- **Integration run 2:** 413/413 files, 4,190 tests passed, 1 skipped (a `runIf` pair), 1 todo. The todo is a stale `it.todo` "PENDING T-DG6-BE-B" in `audit-events.test.ts`; its behaviour is covered by `sensitive-reach.test.ts`.
- **Unit tests:** the failures were load timeouts:
  - unit-node: `server.test.ts` (5 s) and `architecture.test.ts`;
  - unit-web: four files whose findBy waits timed out.

  All six files pass alone on Node 24 and Node 22, with the locale unset and with C.UTF-8 (`02b`). The first Node 22 unset run was stopped by the tool's 2-hour background limit after unit-node passed 189/189; its unit-web and formula parts were re-run (`02-unit-node22-unset-web-formula.log`).
- **Root e2e, unset:** 10 failures:
  - Chromium "Page crashed" / "Target crashed" during memory pressure, plus two timeouts;
  - 47 serial followers did not run.

  The re-run passed every one of them (en 67/67; ar 103 passed, 9 skipped). The C.UTF-8 run under the connection log passed 288 with 18 skipped, all axe NOT SCANNED by design.
- **Demo:** the unset run had two renderer crashes and one axe timeout; the re-run passed them. C.UTF-8: 16/16.
- **My walkthrough-keyboard probe** exits 1 on its conservative rule:
  - it flags the breadcrumb links, which the breadcrumb diagnostic shows are Tab stops right after the skip link, in en and ar;
  - it flags the collapsed `<details>` table on `/prioritization`.

  This is the round-1 artifact, not a product gap. The candidate's `p6-walkthrough-keyboard` passes in en and ar, unset and C.UTF-8.
- **Product journeys:** the only failures are 30 s timeouts on tests without a budget (F-DG6-144).

## New findings (Low, not blocking)

- **F-DG6-200:** two gate-suite integration tests fail intermittently through test-side races.
  - The new 0125 guard test claims the job while its own refused UPDATE is still aborting: 5 of 40 misses as-is, 0 of 40 with a 250 ms pause, 0 of 40 without the refused UPDATE.
  - `change-requests-in-tx` indexes `submitX[1]` of an unordered query. Atomicity holds in 15 of 15 cases; the round-1 xid is always the resubmit's minus 2, which is the value the failing run read.
- **F-DG6-201:** the register notes of REQ-S12-019, REQ-S16-030, REQ-S20-029 and REQ-S20-030 still describe round-1 gaps that the repairs closed. They understate the candidate. This is documentation drift only.

## Export start (F-DG6-147, REQ-S20-030) and load (REQ-S20-029), provisional

All figures come from one sandbox host and are provisional, not Mobily capacity.

- **Export proof at D-202's idle criterion** (1-minute load 0.99, then 0.94). Setup: the full dataset from the **in-tree** generator, and `export-proof.mjs` unchanged.
  - **Latency:** 0 of 132 starts over 2 s. Part B (50 simultaneous starts) had p95 771 ms and 626 ms, max 772 ms; in round 1 it was 38 of 50 over 2 s.
  - **Other clauses:** every one held: 202 with a job id; progress non-decreasing to 100; every job succeeded; requester-only download; 404 for the other same-scope user and for AUD.
  - **Exit status:** each proof exits 1 on the known LOAD-T20 dataset assertion only.
  - **On the saturated host** (load 31–37), 22 and 24 of 50 starts took more than 2 s. That run is reported, but it falls outside the measuring condition: every API class was 17–40× slower than at idle.
- **Workload on the quiet host** (load ~0.8; 100 users; full dataset), p95 per class:

  | Class | p95 |
  |---|---|
  | Reads | 20.7 ms |
  | Updates | 30.3 ms |
  | Search | 18.3 ms |
  | Dashboards | 39.8 ms |
  | Export start | 35.5 ms |

  There were 0 errors. `report.mjs` states the dataset, workload and infrastructure. My earlier run on the saturated host is kept and labelled as such.

## Coverage of the 48 rows (summary)

- **Static checks:** all exit 0. That covers contrast, 932 operations, no CDN and format.
- **Unit tests:** run in four settings.
- **Integration:** run twice; run 2 is 413/413.
- **`tests/qa`:** run on its own, 45 + 6 files.
- **Root acceptance specs:** run in both languages and both locale settings. The C.UTF-8 run used a connection log, and every logged connection was loopback-only (REQ-S17-009). axe found 0 serious or critical issues on every scanned route.
- **Demo specs:** run with role users and include the guided walkthrough by keyboard (REQ-S15-012). The 1440 px pass shows decisions, outcomes and next actions (REQ-S15-001).
- **Product journeys:** run in both languages and both locale settings. They include the 1,000-initiative register (REQ-S15-013) and the 360 px flows (REQ-S15-009).
- **My probes:**
  - AUD is read-only;
  - an API validation error is shown in the selected language;
  - connector counts are shown on screen;
  - clearing browser storage loses no data;
  - reflow at 360 px, 390 px and 200 % text.
- **Reliability:** the A13 kill-and-restart drills pass, and so does the D-203 burst (26–50 jobs/s, with one execution per event).
- **Validators:** register, pipeline, and historical DG1–DG5 all PASS.
- **Environmental residuals:** as the assignment lists them (Keycloak, real IdP and stores, external systems, production capacity).

Product gates G1–G6 are business approvals inside the product, and nothing here approves anything. Product G6 never implies DG7.
