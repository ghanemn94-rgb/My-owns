# T-DG6-QA-A2 handback: A17 failing-connector assertion (qa-verifier, authoring)

- **Stage:** DG6 (BUILDING), authoring task, not a gate review.
- **Run:** `DG6-T-DG6-QA-A2-qa-verifier-20261031T002529Z-b6e20754`.
- **Working tree:** `/home/user/wt/dg6-qa-a2`, branch `dg6/qa-a2`, HEAD `88aa129a8a17421a910a566b7b7bf4fd201114c0` (checked at start).
- **Started:** 2026-10-31T00:25:45Z. **Ended:** 2026-10-31T01:04Z.
- **Data:** all synthetic. No real business, Finance or IT approval was granted, and no DG0–DG7 gate is named in product text.

## 0. Summary

D-202 option (a) is applied as decided:
- the linked KPI is now read by holders of `transformation.read` at the KPI's transformation (its KDS and the organization's AUD);
- the technical administrator's view is asserted as count only: `linkedKpiCount 1`, `hiddenKpiCount 1`, `linkedKpis []`.

**The admin-side assertions pass.** The data-owner assertions **fail on a product defect** (QA-A2-F1, §6). The KDS and AUD get the KPI by name, but as `freshness: "unknown"`, `lastValue: null`, `lastValueAt: null`. The KPI's last accepted value is 250.75 as of 2026-01-31, and its own KPI panel shows Stale.

BE-X2's probe did not show this, because it ran the scenario alone (`-t 'failing connector'`). The KPI's 2026-01 period was then the organization's newest monthly period. As soon as a later period is open, the exception detail drops the last known value. That later-period case is the real-world one: a failing connector is exactly what leaves the new period without data.

I made the scenario open that later period itself, so the result no longer depends on test order. It now fails the same way alone, in the file and in the whole suite. Per the assignment, I kept the failing test and did not work around it.

A sandbox repair probe (R, §5) shows the test passes once the last known value is retained. Five mutations on top of R are all killed.

## 1. Files written (uncommitted)

| File | Purpose |
|---|---|
| `tests/qa/integration/a17-import-and-integration.test.ts` (modified; only the "failing connector" test and one header comment line pair) | D-202 (a). (1) Opens a later monthly period, so the scenario is order-independent and models the real case. (2) The admin reads the detail and asserts `linkedKpiCount 1 / hiddenKpiCount 1 / linkedKpis []`. (3) KDS and AUD each assert `hiddenKpiCount 0` and one linked KPI (id, transformation, `freshness "stale"`, `lastValue` 250.75 compared as a canonical decimal string, `lastValueAt` = 2026-01-31 in Asia/Riyadh). These are soft per role, so one run reports both readers; any soft failure still fails the test. (4) Negative: an org-B user gets 403/404 and never the KPI id. The previous soft admin-reads-linkedKpis assertion is removed. |
| `e2e/a17-failing-connector-exception.spec.ts` (new) | The user-visible path of REQ-S12-019, on the real stack plus the built production worker, in chromium-en and chromium-ar. The data owner (KDS) opens Administration > Operations > the exception: the linked KPI with Stale, 250.75 and its date. `dev.admin` opens the same page and sees "1 hidden" and no KPI name. Also checks `<html lang/dir>`, axe (0 serious/critical), screenshots, no change to the KPI's actuals, and no foreign requests. |
| `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-A2-authoring/**` | This handback, logs and screenshots. |

I didn't touch any `apps/**`, `packages/**`, `tools/**`, `.claude/**`, `docs/source/**` or delivery-record file. Before the tests, `find apps packages tests e2e -type d -name .cc-writes -empty` found nothing.

## 2. Checks run (real exit codes)

Environment for all of them:
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline;
- PostgreSQL 16.15 disposable clusters;
- ports 27000–27049 only;
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` was not run.

Free disk was checked before each full run: the worktree tmpfs had 7.9 G free, `$TMPDIR` 8.6–9.1 G.

| # | Check | Command (abridged; full command at the top of each log) | Exit | Result | Log |
|---|---|---|---|---|---|
| 1 | Historical DG5 gate, start | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` | `validate-dg5-start.log` |
| 2 | A17 file, attempt 0 | `QA_PG_PORT=27000 MTH_PORT_POOL=27001-27019 tests/qa/support/with-pg.sh pnpm vitest run --project integration <a17 file>` | 1 | **Not a test result.** Vite could not create `node_modules/.vite-temp`, because `node_modules` is read-only in this sandbox. Repeated with `--configLoader runner`, as T-DG6-QA-A did. | `vitest-a17-file-attempt0-readonly-node_modules.log` |
| 3 | A17 file, run with JSON diagnostics (before the later-period step was added) | same, plus `--configLoader runner` | 1 | 9 passed, 1 failed: KDS `freshness unknown, lastValue null` | `vitest-a17-file-run2.log` |
| 4 | Failing-connector scenario alone (`-t "failing connector"`), with the later period | same, plus `-t` | 1 | 1 failed, 9 skipped: KDS and AUD Unknown/null (deterministic) | `vitest-a17-alone.log` |
| 5 | A17 file, with the later period | same | 1 | 9 passed, 1 failed (the same assertions) | `vitest-a17-file.log` |
| 6 | **A17 file, final content** (after prettier and a comment fix; sha256 in `files-final.sha256`) | `QA_PG_PORT=27020 MTH_PORT_POOL=27021-27039 … <a17 file>` | **1** | **9 passed, 1 failed**: only the KDS/AUD last-value assertions (QA-A2-F1); the admin count, the outsider negative, the KPI panel, one exception and the no-change snapshot all pass | `vitest-a17-file-final.log` |
| 7 | **Whole `tests/qa` integration** | `QA_PG_PORT=27000 MTH_PORT_POOL=27001-27019 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | **1** | **42 files: 41 passed, 1 failed; 403 tests: 402 passed, 1 failed** (1167 s). The only failure is the A17 "failing connector" test (QA-A2-F1). Per-file counts are in `vitest-tests-qa-full-per-file.txt`: every file passes except `a17-import-and-integration.test.ts` (10 tests, 1 failed); `a17-s01-005-external-change.test.ts` 4/4. | `vitest-tests-qa-full.log` |
| 8 | **Root e2e, A17** (both specs, chromium-en and chromium-ar, `--workers=1`) | `QA_A17_WEBHOOK_SIGNING_SECRET=<synthetic> E2E_SCREENSHOT_DIR=<evidence>/screenshots E2E_PG_PORT=27040 E2E_API_PORT=27041 MTH_PORT_POOL=27042-27049 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a17-import-and-integration.spec.ts e2e/a17-failing-connector-exception.spec.ts --workers=1 --reporter=list` | **1** | **10 passed, 2 failed** in 5.2 min. The 2 failures are the new spec in en and ar, only on the soft data-owner assertions (QA-A2-F1). There were no timeouts, so no re-run was needed. | `e2e-run1.log` |
| 9 | Lint | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | clean | `lint.log` |
| 10 | Prettier, my files, before formatting | `npx prettier --check <my 2 files>` | 1 | the integration file needed formatting; I ran `prettier --write` on that file only | `prettier-mine-pre.log` |
| 11 | Prettier, whole tree (assignment command) | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | all matched files use Prettier code style | `prettier.log` |
| 12 | Typecheck of my 2 files | scratch tsconfig in `$TMPDIR` (removed): `cd apps/api && npx tsc -p $TMPDIR/tsconfig.qa-a2.json` | 2 | **0 errors in my files.** The one error is in product source, `src/modules/evidence/preview.ts(45,33)` (`ReadableStream.from` typing). It is pre-existing: T-DG6-QA-A's `typecheck-a17-files.log` shows the same error. Not mine to fix. | `typecheck.log` |
| 13 | Mutation checks | §5 | — | baseline 1 failed; R passes; 5 of 5 mutations killed | `mutation-*.log` |
| 14 | Historical DG5 gate, end | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` | `validate-dg5-end.log` |

**Disclosures.**
- (a) Check 2's exit 1 is the read-only `node_modules` startup error, not a test outcome.
- (b) A first full-suite start was killed within seconds: I had backgrounded it with an inner `&`, so the wrapper exited and took the run with it. Its 1-line log was deleted, and check 7 is the clean re-run.
- (c) The very first A17 run (before the JSON messages were added) also ended 9 passed, 1 failed, with KDS freshness `unknown`. Its log file name was reused by check 5, so it was overwritten. Check 3 records the same result.
- (d) Checks 3–5, 7, 13 and 8 used the test file before the final prettier formatting and one comment rewording. Checks 3–5 also predate other edits. Check 6 is the run on the final bytes; the formatting and comment changes are semantically neutral.

## 3. Rows citing A17 (stage DG6) and the test that proves each

The binding `acceptance` texts come from `docs/delivery/requirements.csv`. My assignment covers only the failing-connector scenario. The other rows are mapped to T-DG6-QA-A's tests, and their status is from my runs (checks 7 and 8).

| Row | Binding acceptance | Test | Status in my runs |
|---|---|---|---|
| **REQ-S12-019** | "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date" | `tests/qa/integration/a17-import-and-integration.test.ts` › "failing connector (REQ-S12-019, A17) …"; `e2e/a17-failing-connector-exception.spec.ts` (en, ar) | **FAIL (QA-A2-F1).** Passing parts: one exception; the KPI panel shows Stale with 250.75 and 2026-01-31; the admin sees the count only; the outsider is refused; no data change. Failing part: the exception shown to data owners has Unknown with no value and no date. |
| REQ-S17-001 | "a test connector run records last success, row counts, errors and retries, all visible in the UI" | integration › "REQ-S17-001 …" (2 tests); e2e › "a failing/stopped test connector shows the right state …" (last success "never", not verified, error) | API: pass. UI: last success, error and state pass. Retry history and row counts in the UI are **not asserted** by the root e2e (T-DG6-QA-A's scope; not re-derived here). |
| REQ-S17-002 | "a file with 8 valid rows, 1 invalid row and 1 duplicate commits 8 rows with provenance and shows the 2 others with row-level reasons" | integration › "REQ-S17-002/003 …" (CSV, XLSX, nothing partial); e2e CSV/XLSX | pass |
| REQ-S17-003 | "CSV and XLSX KPI imports and a signed webhook call each commit valid data; an unsigned webhook is rejected" | integration › "REQ-S17-003 …" (2 tests) + CSV/XLSX; e2e webhook | pass |
| REQ-S17-005 | "with the test connector stopped, a KPI actual can still be submitted by form, and the connector page shows an actionable error message" | integration › "stopped connector (REQ-S17-005, A17) …"; e2e › "a stopped test connector …" | pass |
| REQ-S01-005 | "marking the task complete leaves the deliverable Unconfirmed; a filename-only link does not confirm it; reviewed evidence or a test-adapter confirmation sets it and records the source" | `tests/qa/integration/a17-s01-005-external-change.test.ts` | pass (4/4 in check 7) |
| REQ-S20-017 | "A17: Invalid rows are isolated, duplicates detected, valid rows committed with provenance; unavailable connector shows an actionable error" | the A17 integration file + both root A17 e2e specs | Each named clause passes. The A17 file as a whole is **not green**, because of REQ-S12-019 (QA-A2-F1). |
| REQ-DLV-038 | "the applicable A01-A22 executable tests pass on the DG6 candidate and the load report states the actual results against REQ-S20-029" | **NOT COVERED** by this task: it aggregates A12–A23 and a load report. For A17, this task contributes one failing test (QA-A2-F1). | — |

## 4. Product defect QA-A2-F1 (proposed severity High, mandatory_violation true; for the orchestrator to allocate an F-DG6 ID)

**Requirement:** REQ-S12-019 (M0239 "retain last known values with freshness labels"; row "values display as Stale with last update time"; acceptance "the KPI shows Stale with its last value and date").

**Contract:** `getOperationalException` `linkedKpis[].lastValue`: "Last known accepted value as a decimal string; null = Unknown (never 0)". ADR-0053 §2 acceptance fixture.

**Reproduction** (synthetic; `tests/qa/integration/a17-import-and-integration.test.ts` › "failing connector"):
1. A monthly KPI (direct accept) gets the accepted actual `value "250.75", dataAsOf "2026-01-31"` in period 2026-01. The worker recalculates.
2. `GET /api/v1/transformations/{tid}/kpi-definitions/{kpi}/status?scopeKind=transformation&scopeId={tid}&reportingPeriodId={2026-01}` (AUD) → 200, `freshness {status:"stale", dataAsOf:"2026-01-31"}`, `actual` 250.75. **Correct.**
3. A later monthly period is opened (`POST /api/v1/organizations/{org}/reporting-periods`, then `…/open`).
4. A `test_adapter` connector in mode `failing` feeding that KPI runs and fails twice (attempt and retry). The worker opens exactly one exception (`connector_unreachable`, `connector.source_unavailable`). **Correct.**
5. `GET /api/v1/admin/operations/exceptions/{id}` as the admin (ADM_TECH + ADM_ACCESS) → 200, `linkedKpiCount 1, hiddenKpiCount 1, linkedKpis []`. **Correct** (D-202 / ADR-0053 §2).
6. The same request as the transformation's KDS, and as the org AUD → 200, `linkedKpiCount 1, hiddenKpiCount 0`, and
   `linkedKpis: [{"kpiDefinitionId":"01a18f71-eb27-743b-998d-62e48d2cf56d","transformationId":"01a18f71-84ce-722d-a917-3de9f1b436be","name":"Synthetic KPI 8bb851","unitKind":"count","freshness":"unknown","lastValue":null,"lastValueAt":null}]` (`vitest-a17-file-final.log`).

**Expected vs actual:**
- Expected: `freshness "stale"`, `lastValue "250.75"`, `lastValueAt` = 2026-01-31 00:00 Asia/Riyadh (`2026-01-30T21:00:00.000Z`).
- Actual: Unknown, null, null. In the UI (en and ar), the data owner sees "Unknown | Unknown | Unknown" (`screenshots/{en,ar}/a17-exception-data-owner.png`).
- The defect is on the API side; the UI renders what the API sends.

**Without step 3** (BE-X2's probe, `docs/delivery/handbacks/DG6/T-DG6-BE-X2-evidence/probe-F2-link-exists-hidden-for-adm-tech.log`), the same read returns Stale, 250.75 and the date. So the last value is lost exactly when a newer period exists. The failing-connector case always looks like that in production, because the current month's period is open and the connector is what failed to fill it.

**Observed cause (diagnosis only; the fix belongs to the implementer or architect):** `apps/api/src/modules/operations/exceptions.ts` `linkedKpiStatus`:
- takes the organization's newest `open`/`closed` reporting period of the KPI's frequency;
- reads only that period's `kpi_evaluation`;
- returns `unknown` with nulls when there is none.

That function's comment says it mirrors the DG4 panel "for its current reporting period". ADR-0053 §2 and the contract, by contrast, promise the **last known** value. This tension may need an architect ruling: either the exception shows the last known evaluation with its freshness, or the ADR changes. Repair probe R (§5) shows that choosing the newest period that has an evaluation for the KPI makes the test pass.

**Why High and mandatory:** it breaks the binding acceptance of a DG6 row (REQ-S12-019) in its real-world condition, and data owners lose the last known value on the screen meant to show it.

## 5. Mutation checks (sandbox copy; product source in this tree never edited)

**Sandbox:** `$TMPDIR/mutq` (16 MB), a minimal copy of HEAD `88aa129a`:
- `apps/api` and `apps/worker` copied (src, test, configs), with `node_modules`/`dist` symlinked;
- `tests/qa` and the root config files copied; everything else symlinked.

The driver (`scratchpad/mutate.py`) applies exact textual replacements (each must match exactly once), writes the diff at the top of the log, runs `… vitest run --configLoader runner --project integration <a17 file> -t "failing connector"` on ports 27020–27039, and restores the files. Every mutation M1–M5 is applied **on top of R**, so that only the mutated behaviour can fail the test. The sandbox is deleted afterwards.

| ID | Central assertion | Change (`apps/api/src/modules/operations/exceptions.ts`) | Expected | Actual | Log |
|---|---|---|---|---|---|
| 00 | baseline (no change) | — | same as the worktree | 1 failed (KDS/AUD Unknown), exit 1 | `mutation-00-baseline.log` |
| R | **repair probe**, not a mutation: the last known value is retained | period query adds `exists(kpi_evaluation for this KPI, transformation scope)` | test passes | **1 passed, exit 0** | `mutation-R-repair-probe-last-known-period.log` |
| M1 | the admin sees only the count (ADR-0053 §2) | `if (!may)` → `if (false && !may)` (unreadable KPIs shown) | fails | **killed**: the admin detail had `linkedKpis` non-empty / `hiddenKpiCount 0` | `mutation-01-admin-sees-hidden-kpi.log` |
| M2 | the data owner sees the KPI | `.allowed` → `.allowed && false` | fails | **killed**: `AUD: [] expected length 1`, `hiddenKpiCount` mismatch | `mutation-02-reader-denied.log` |
| M3 | Stale label (never shown as fresh/green) | `freshness: status` → `"fresh"` | fails | **killed**: `"freshness":"fresh"` | `mutation-03-freshness-forced-fresh.log` |
| M4 | last value 250.75 (never 0) | `lastValue` → `"0"` | fails | **killed**: `expected '0' to be '250.75'` | `mutation-04-last-value-zeroed.log` |
| M5 | last value date = 2026-01-31 in Asia/Riyadh | `startOfBusinessDate`: `date` → `date - 1` | fails | **killed**: `lastValueAt 2026-01-29T21:00…` → 2026-01-30 | `mutation-05-date-off-by-one-day.log` |

Earlier mutations M1–M7 of T-DG6-QA-A cover the other A17 scenarios. Mine all target the one scenario in my scope.

## 6. Other observations (not asserted by my tests; for triage)

- **O1 (proposed Low):** in Arabic, the exception page shows the stored error message in English ("The source system did not respond.") under "آخر خطأ" (last error). With RTL bidi, the full stop appears at the start of the line (`screenshots/ar/a17-exception-tech-admin.png`). CLAUDE.md requires Arabic and English for every user-facing string. `lastErrorMessage` is a stored (redacted) server message, so this may be intended as technical text; the frontend or architect should decide.

## 7. What remains

- QA-A2-F1 needs a product fix (or an ADR ruling) by the owning implementer. After that, re-run the A17 file and `e2e/a17-failing-connector-exception.spec.ts`. No test change is expected.
- The root e2e does not assert REQ-S17-001's "retries … visible in the UI" or the UI row counts (T-DG6-QA-A's scope; not in this assignment).
- REQ-DLV-038 is an aggregate row, not covered by this task.
- Acceptance items 1 and 2 of the assignment are **not met**: they can't pass while QA-A2-F1 is open. Items 3, 5 and 6 are met (§2). Item 4 is §3.

## 8. Merge instructions

Leave as is for the orchestrator to integrate:
- one modified test file;
- one new e2e spec;
- this evidence folder.

There are no migrations. Expect a conflict only if another task edited the same "failing connector" block of `a17-import-and-integration.test.ts`.

## 9. End

Ended 2026-10-31T01:04Z (about 39 min). The mutation sandbox `$TMPDIR/mutq` and the scratch tsconfig were deleted. `test-results/` (gitignored, Playwright output) is left in the tree; the two failure screenshots were copied to `screenshots/{en,ar}/a17-exception-FAILED-end-of-test.png`.
