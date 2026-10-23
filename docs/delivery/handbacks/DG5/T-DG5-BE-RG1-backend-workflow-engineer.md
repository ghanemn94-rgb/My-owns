# T-DG5-BE-RG1 handback: DG5 round-5 repair of F-DG5-121, F-DG5-101, F-DG5-142, F-DG5-100 (backend-workflow-engineer)

- **Stage / gate:** P5, DG5 **FIXING** after clean re-gate round 1 on candidate `sha256:8df7f922…` (D-184, D-185).
- **Invocation:** `DG5-T-DG5-BE-RG1-backend-workflow-engineer-20261023T101259Z-38a88ef3` (session `38a88ef3-ccb5-47cc-b8cc-0174356efd90`).
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-BE-RG1.md`. Its sha256 was verified as `a98e48f3…2958` before I started.
- **Working tree:** `/home/user/wt/dg5-be-rg1`, branch `dg5/be-rg1`, base `HEAD` = `1190cb6699b026d22b997f375620cd257a2bb229`. All changes are left **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-23T10:13:12Z`, end `2026-10-23T11:28:08Z` (about 75 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0 at the start. At the end: `PASS gate DG4 (historical)`, exit 0 (`T-DG5-BE-RG1-evidence/validate-dg4-end.log`).
- **Not done by me:** no business approval, Finance validation or IT approval of any kind. All seed and demo data is synthetic. A seeded Day-90 test is open and unanswered; it approves nothing. Product gates G1–G6 and engineering gates DG0–DG7 are untouched.

## 1. Files changed

| File | Purpose |
|---|---|
| `packages/db/src/migrate.ts` | F-DG5-100: `MigrationStatus.outOfOrderPending`. `compareStatus` reports a pending file whose id is not above the highest applied id, and `migrate()` refuses it before running any file (en error text). |
| `packages/db/src/cli.ts` | F-DG5-100: `mth-db status` prints `ORDER <file>` lines and treats an out-of-order file as DRIFT (exit 4), like CHANGED and UNKNOWN. |
| `apps/api/src/modules/platform/health.ts` | F-DG5-100: `/readyz` reports `migrations: fail` (not `pending`) for an out-of-order pending file, since the runner refuses it. The enum is unchanged and the contract is unchanged. |
| `packages/db/src/migrate.test.ts` (new) | F-DG5-100 unit tests: the reviewer's reproduction through `compareStatus`, every P5 gap, an id equal to the highest applied, and the positive cases. |
| `packages/db/test/integration/migrate.test.ts` | F-DG5-100 integration tests on real PostgreSQL: the refusal, with nothing applied and the exact en message; positive: an id above the highest applied is applied. |
| `packages/db/src/seed.test.ts` | F-DG5-100: the numbering test pins `P5_RETIRED_MIGRATION_IDS` = 0066, 0067, 0073, 0077, 0078, 0079, 0083, 0084 as permanently unused. The rule is now a function (`numberingViolations`) that is also tested against an injected gap file. The old comment saying implementers "fill" unused numbers is replaced. |
| `apps/api/test/integration/platform.test.ts` | F-DG5-100: `/readyz` is 503 with `migrations: fail` for a build that fills the 0066 gap. |
| `packages/reporting/src/csv.ts` | F-DG5-101: `csvCell` writes the apostrophe from the cell's `quotePrefix`, which is decided once for XLSX and CSV, instead of re-neutralizing every text cell. `textRow` builds its cells through `textCell`, so header, frame and label text stays neutralized. |
| `packages/reporting/src/csv.test.ts` | F-DG5-101 tests: the reviewer's reproduction; positive and negative, long and short decimals; a long negative total; a real injection string in en and ar; `csvCell` against the `quotePrefix` decision. |
| `packages/reporting/src/xlsx/xlsx.test.ts` | F-DG5-101: the other `valueCell` export path. A long negative decimal is an inline string without `quotePrefix`. |
| `packages/db/src/demo/data/roaming-states.ts` | F-DG5-121: `seedLaunchPlan` also inserts the plan's `day_ninety_test`, with the row shape and scheduling of `plan.ts`. |
| `packages/db/test/integration/demo-roaming.test.ts` | F-DG5-121 seed test: one test per plan, open, 0 answered, scheduled on start + 90 (= the template's due day), same creator as the plan, audited `day_ninety_test.create` v1, registered as a seed record. |
| `apps/api/test/integration/environment/demo-day-ninety.test.ts` (new) | F-DG5-121 API test on the real demo dataset: the reviewer's reproduction (GET `day-90-test` is 200); the six B0136–B0141 questions verbatim; equality with the test the product path (`POST launch-plan`) creates from the same start date, ids aside; TL can respond (If-Match), WL gets 403. |
| `e2e/a22-operations-jobs.spec.ts` | F-DG5-142: rows are compared with the jobs response the **screen itself** loaded. That snapshot is bracketed by the test's API reads before and after. `QA_A22_CROSS_BOUNDARY=1` forces a quarter-hour boundary between the test's read and the screen's. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-RG1-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-RG1-evidence/**` | Logs, the disposable probe source, and demo-stack API, text and screenshot evidence. |

There are no migrations: no migration was added or changed. There are no new API endpoints, no OpenAPI change and no new dependency.

## 2. Findings: cause, fix, regression test, before and after

### F-DG5-101 (Low, REQ-S13-006): a long negative decimal got the formula apostrophe in CSV

- **Cause.** `model.ts` `valueCell` writes a decimal that does not fit a double (more than 15 significant digits) as a text cell with `quotePrefix: false`, because it is a system number. `csv.ts` `csvCell` ignored `quotePrefix` and ran `neutralizeSpreadsheetText` again on every text cell, so a leading `-` got `'`. XLSX already honoured `quotePrefix`.
- **Fix.**
  - `packages/reporting/src/csv.ts:54`: `csvField(c.quotePrefix ? `'${c.text}` : c.text)`. CSV now follows the single XLSX/CSV decision of ADR-0046 §4.
  - `packages/reporting/src/csv.ts:59`: `textRow` uses `textCell(t)`, which sets `quotePrefix` through `neutralizeSpreadsheetText`. Plain texts (titles, frame values, provenance, legend) keep their protection.
  - Every other text cell comes from `textCell` (neutralized), or from `valueCell`/`statusText`, which are system values (a canonical decimal validated by `DECIMAL_PATTERN`, or a validation label). The forms CSV in `apps/api/src/modules/forms/export.ts` has its own `csvCell`. It already wrote decimals unprefixed and is unchanged.
- **Regression test.** `packages/reporting/src/csv.test.ts` describe "renderCsv: long decimals are canonical and unprefixed; injection text stays neutralized (F-DG5-101)". Its first test is the reviewer's reproduction, with the reviewer's final assertion kept: `{ r902: "-12345678901.23456", r903: "-1234567890.123456" }`. It also covers:
  - positive and negative, long and short decimals, and a 24-digit negative;
  - a long negative total (`valueCell`, never a partial SUM);
  - `'-2+3+cmd|' /C calc'!A0` keeping its apostrophe in en and ar;
  - `csvCell` against `textCell` and `valueCell`.

  An XLSX test was added in `xlsx/xlsx.test.ts`.
- **Before** (`T-DG5-BE-RG1-evidence/101-before-fix.log`, the new tests against HEAD `csv.ts`, exit 1): `Tests 3 failed | 9 passed (12)`. The reproduction's assertion failed with `+ "r902": "'-12345678901.23456"`, `+ "r903": "'-1234567890.123456"`.
- **After** (`101-after-fix.log`, the whole `packages/reporting` unit project, exit 0): `Test Files 10 passed (10)`, `Tests 92 passed (92)`. The XLSX test was added after this run. It runs in the `unit-*.log` runs of §3: 33 files and 329 tests, exit 0.

### F-DG5-100 (Low, REQ-S19-013): the runner applied a pending id below the highest applied id; the P5 gaps were fillable

- **Cause.**
  - `compareStatus` computed `pending` as every unapplied file, and `migrate()` applied them in lexical order. It refused only a changed checksum or an unknown applied file.
  - `seed.test.ts` allowed any id from 0058 to 0099, and its comment told implementers to "fill" unused numbers.
- **Fix.**
  - `packages/db/src/migrate.ts:102–103`: `outOfOrderPending` = the pending files whose id is ≤ the highest applied id. "≤" also covers a same-id, different-name file.
  - `migrate.ts:168–174`: a refusal **before the first file**. The en message is: `refusing to run: pending migration(s) 0066_p6_example.sql have an id not above the highest applied migration 0097_p5_config_review_contributors.sql; forward-only migrations must apply in one order on every database, so give each new migration an id above 0097`.
  - `cli.ts:90–96`: `status` reports it as DRIFT.
  - `apps/api/src/modules/platform/health.ts:50`: `/readyz` reports it as `fail`.
  - On a fresh database nothing is out of order, so the runner alone cannot see a filled gap there. `packages/db/src/seed.test.ts:761` (`P5_RETIRED_MIGRATION_IDS`) and `:792` pin the eight gaps, so the build refuses one in CI.
  - No existing migration changed.
- **Regression tests.**
  - `packages/db/src/migrate.test.ts`: the reviewer's reproduction (`migration-gap-order.mjs`) with its final state, a later build adding `0066_p6_example.sql` on an upgraded database. The new assertion is `outOfOrderPending` = `["0066_p6_example.sql"]`, where the reviewer's script showed nothing refused it.
  - `packages/db/test/integration/migrate.test.ts`: the refusal on real PostgreSQL.
  - `seed.test.ts`: the pinned gaps.
  - `platform.test.ts`: `/readyz`.
- **Before:**
  - `100-unit-before-fix.log` (exit 1): `Tests 3 failed | 2 passed | 51 skipped`. The reproduction failed with `expected undefined to deeply equal [ '0066_p6_example.sql' ]`.
  - `100-integration-before-fix.log` (HEAD `migrate.ts`, exit 1): `Tests 2 failed | 7 passed (9)`. The refusal test received `[ '0066_p6_example.sql', '0098_p6_forward.sql' ]`, which shows the old runner **applied** the gap file on an upgraded database.
  - `100-numbering-probe.log`: with a temporary `packages/db/migrations/0066_p6_example.sql` (removed afterwards), the **original** numbering test passed (exit 0, so the gap was accepted) and the new one failed (exit 1: `expected [ 67, 73, 77, 78, 79, 83, 84 ] to deeply equal [ 66, … ]` and the numbering violation).
- **After:**
  - `100-unit-after-fix.log` (`packages/db/src`, exit 0): `Test Files 5 passed (5)`, `Tests 76 passed (76)`.
  - `100-integration-after-fix.log` (exit 0): `Tests 9 passed (9)`.
  - `100-platform-integration.log` (exit 0): `Tests 13 passed (13)`.
  - The new `/readyz` test was written after the runner fix, so it has no failing-before run. Before the fix the same input reported `pending`.

### F-DG5-121 (Low, REQ-PB-087): the demo roaming plan had no Day-90 test

- **Cause.** `roaming-states.ts` `seedLaunchPlan` inserted `launch_plan` and its 33 `launch_task` rows directly, but no `day_ninety_test`. That bypassed the invariant of `apps/api/src/modules/launch/plan.ts` `generateLaunchPlanInTx`, which creates one with every plan.
- **Fix.** `packages/db/src/demo/data/roaming-states.ts:82–113`. While reading the template it takes the `day_ninety_test` item's due day, then inserts `day_ninety_test` (`roaming.day_ninety_test`, id `rtId(launchPlan, 2)`) with the same row shape as `plan.ts:192–212`:
  - organization, transformation and plan;
  - `scheduled_date` = start + the template's day 90, in calendar days (`2026-10-01`);
  - status `open` and `answered_count` 0 (the table defaults and its created-open guard);
  - created and updated by the plan's creator (the demo TL);
  - one audit event `day_ninety_test.create`, version 1, through `ctx.insert`, which is the same action name `plan.ts` writes.

  `packages/db` cannot import `apps/api` (ADR-0002), so this follows the row shape and scheduling, as the assignment allows. `demo-day-ninety.test.ts` proves the equality against the product path.
- **Regression tests.**
  - `apps/api/test/integration/environment/demo-day-ninety.test.ts`: the reviewer's reproduction, ending in `GET …/day-90-test` → **200**.
  - `packages/db/test/integration/demo-roaming.test.ts`, "F-DG5-121: the launch plan carries its Day-90 leadership test…".
- **Before** (`121-before-fix.log`, HEAD `roaming-states.ts`, exit 1): `Tests 5 failed | 68 passed (73)`. The reproduction failed with `{"status":404,"code":"not_found",…}: expected 404 to be 200`, and the seed test with `expected [] to have a length of 1 but got +0`.
- **After** (`121-after-fix.log`, exit 0): `Test Files 2 passed (2)`, `Tests 73 passed (73)`.
- **Demo-stack check** (`121-demo-stack-probe.log`, exit 0, 2 passed). The reviewer's unchanged probe `zz-dom-r1-day90.spec.ts` ran on `e2e/support/with-demo-stack.sh` in chromium-en and chromium-ar. It was copied into `e2e/` for the run and deleted afterwards.
  - The roaming `GET day-90-test` is **200** in both languages: `scheduledDate 2026-10-01`, `open`, `completion {answered 0, total 6, complete false}`, `q1…q6 = B0136…B0141` (`121-demo-stack/{en,ar}/roaming-day-90-test.json`).
  - The roaming Day-90 page shows:
    - en: "Day-90 leadership test", "Incomplete (0/6)", "Scheduled for 1 Oct 2026", "1. Can leaders explain the same case for change and North Star?" and "Complete the Day-90 test";
    - ar (`dir=rtl`): «اختبار القيادة في اليوم 90», «غير مكتمل (0/6)», «مجدول في 01‏/10‏/2026», «1. هل يستطيع القادة شرح مبررات التغيير والنجم الشمالي ذاتهما؟»

    The files are `121-demo-stack/{en,ar}/roaming-day-90-test.txt` and `.png`.
  - The untrue hint "No Day-90 test yet … Generate the launch plan first" / «أنشئ خطة الإطلاق أولًا» occurs **0** times in both texts.
  - The probe itself asserts only that every step ran. The evidence is the recorded content above.

### F-DG5-142 (Low, REQ-S12-022): the A22 spec raced a schedule boundary

- **Cause.** The spec read `GET /api/v1/admin/jobs` itself and then compared the screen, which made its **own** later GET, with that earlier read. A `*/15` job's `nextRunAt` (and, with the production worker running, its `lastSuccessAt`) changes at every quarter hour, so a boundary between the two reads failed a correct product.
- **Fix** (`e2e/a22-operations-jobs.spec.ts`).
  - `screenJobs` (`:47`) captures every `GET /api/v1/admin/jobs` 200 response the **page** receives.
  - Each row is asserted, inside `toPass`, against the latest response the screen got (`:121–150`). That covers last success or "Never run", next run or the no-next-run status, and every job of the snapshot.
  - The snapshot is bracketed by the test's own reads: the read before the screen's and a new read after it (`:152–166`). The job sets must be equal, a disabled job stays disabled with the same reason, and every `lastSuccessAt`/`nextRunAt` must lie within `[before, after]`.
  - So the spec still proves that the screen shows exactly what the API computed, and adds that the value belongs to the window of the screen's load.
  - `QA_A22_CROSS_BOUNDARY=1` (`:85–103`, `:168–176`) waits after the first read until the next quarter hour + 3 s, and then asserts that `approval.escalation_scan`'s next run really moved. A default run does not wait.
- **Before** (`142-before-fix-probe.log`, exit 1). The disposable probe (`142-before-probe.spec.ts.txt`) is the HEAD spec with one inserted wait past the quarter hour between its API read and the screen load. It was run as `e2e/zz-be-rg1-a22-before-probe.spec.ts` and deleted afterwards. It fails exactly as in QA's report: `Error: approval.escalation_scan: next run … locator('[data-next-run='2026-10-23T11:00:00.000Z']') Expected: 1 Received: 0` (screenshot `142-before-fix-probe-failed.png`).
- **After:**
  - Across a boundary, chromium-en with the locale unset (`142-e2e-cross-boundary-en-unset.log`, exit 0, 1 passed, 13.3 min): `approval.escalation_scan next run 2026-10-23T10:45:00.000Z (test read) -> 2026-10-23T11:00:00.000Z (screen read, 1 response(s))`.
  - Across a boundary, chromium-ar with C.UTF-8 (`142-e2e-cross-boundary-ar-cutf8.log`): exit 0, 1 passed, 13.8 min: `approval.escalation_scan next run 2026-10-23T11:15:00.000Z (test read) -> 2026-10-23T11:30:00.000Z (screen read, 1 response(s))`.
  - Normal runs, both projects: locale unset `142-e2e-a22-unset.log` exit 0, 2 passed; C.UTF-8 `142-e2e-a22-cutf8.log` exit 0, 2 passed.

## 3. Checks actually run (node v24.21.0, offline; harness ports 23150–23199 only)

| # | Command | Locale | Result |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | unset | `PASS gate DG4 (historical)`, exit 0 |
| 2 | `pnpm -r typecheck` | unset | exit 0 (`check-typecheck.log`) |
| 3 | `pnpm -r build` | unset | exit 0 (`check-build.log`) |
| 4 | `pnpm lint` | unset | exit 0, `eslint . --max-warnings=0` (`check-lint.log`) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | unset | exit 0, "All matched files use Prettier code style!" (`check-prettier.log`). Re-run on the final tree including this handback: exit 0 (`check-prettier-final.log`) |
| 6 | `pnpm openapi:lint` | unset | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` (`check-openapi-lint.log`) |
| 7 | `npx vitest run --project unit-node packages/reporting/src packages/db/src apps/api/src/modules/platform` | unset | exit 0, 33 files, **329 passed** (`unit-unset.log`) |
| 8 | same | C.UTF-8 | exit 0, 33 files, **329 passed** (`unit-cutf8.log`) |
| 9 | `tests/qa/support/with-pg.sh npx vitest run --project integration <reached files>` | unset | exit 0, **14 files, 220 passed** (`integration-unset.log`). The first attempt failed for lack of disk space (see below). |
| 10 | same | C.UTF-8 | exit 0, **14 files, 220 passed** (`integration-cutf8.log`) |
| 11 | `apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-operations-jobs.spec.ts --workers=1` | unset | exit 0, 2 passed (en, ar) |
| 12 | same | C.UTF-8 | exit 0, 2 passed (en, ar) |
| 13 | same with `QA_A22_CROSS_BOUNDARY=1 --project=chromium-en` | unset | exit 0, 1 passed, across 10:45Z |
| 14 | same with `QA_A22_CROSS_BOUNDARY=1 --project=chromium-ar` | C.UTF-8 | exit 0, 1 passed, across 11:15Z |
| 15 | `e2e/support/with-demo-stack.sh npx playwright test <reviewer's Day-90 probe> --workers=1` | unset | exit 0, 2 passed (en, ar); content in §2 |
| 16 | before-fix runs (101, 100 unit/integration/numbering, 121, 142 probe) | unset | exit 1 each, **by design**. Each shows the defect; see §2 |
| 17 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | unset | `PASS gate DG4 (historical)`, exit 0 (`T-DG5-BE-RG1-evidence/validate-dg4-end.log`) |

Integration files reached (rows 9–10):
- `packages/db/test/integration/migrate.test.ts`
- `packages/db/test/integration/demo-roaming.test.ts`
- `packages/db/test/integration/demo.test.ts`
- `packages/db/test/integration/demo-numbers.test.ts`
- `packages/db/test/integration/demo-numbers-spec.test.ts`
- `packages/db/test/integration/demo-dev-binding.test.ts`
- `apps/api/test/integration/platform.test.ts`
- `apps/api/test/integration/environment/` (all files, including the new `demo-day-ninety.test.ts`)

**Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. They run once on the merged tree in the orchestrator's verification. They are reported here as **not run**, not as passed.

Non-zero exits, disclosed:
- The before-fix runs in row 16 fail by design.
- My first after-fix run of the reporting tests failed once (`101-after-fix.log`, first version, overwritten): a sweep assertion I wrote also matched the injection string's description column, which is meant to keep its apostrophe. I narrowed the sweep to the amount column (`csv.test.ts`, "No amount field … carries the apostrophe") and re-ran: exit 0. The recorded `101-before-fix.log` was re-run with that final test file against HEAD `csv.ts`.
- **Disk exhaustion, environmental** (`integration-unset-attempt1-ENOSPC.log`, exit 1). The first unset-locale integration batch failed in 9 suites with PostgreSQL `could not extend file …: No space left on device`, followed by `the database system is in recovery mode`. The shared disk allowance had about 540 MB free; my own `$TMPDIR` used 45 MB, which I removed after copying its evidence. No assertion failed. I re-ran the same files with the same harness, lowering only the **disposable** cluster's WAL footprint first, inside `with-pg.sh`: `ALTER SYSTEM SET max_wal_size = '48MB'`, `min_wal_size = '32MB'`, `SELECT pg_reload_conf()`. That is test-environment tuning, not a product change, and `tests/qa/**` is unchanged. Both locale runs then passed (lowest free space 165–188 MB). **The orchestrator's merged-tree `pnpm test:integration` may hit the same limit if the shared disk stays this full.**
- I saw no flaky test or timeout.
- The first cross-boundary run outlived my shell's 10-minute foreground timeout and finished in the background (exit 0). That is a tool limit, not a test timeout.

## 4. Contract, schema or dependency needs

None. No OpenAPI operation or response shape changed: `/readyz` keeps `ok | pending | fail`. There is no new migration, no table change and no new dependency.

- `MigrationStatus` (a TypeScript type of `@mth/db`) gains the field `outOfOrderPending`. Its consumers in the repository are updated: `cli.ts`, `health.ts` and the tests.

## 5. ADR and data-dictionary statements made untrue or incomplete (for T-DG5-ARCH-R7)

1. **ADR-0003 §Migrations** (`docs/architecture/adr/ADR-0003-persistence.md:24–29`) lists what the runner refuses: a changed checksum (and, in code, a database newer than the build). It now also **refuses a pending file whose id is not above the highest applied id** (F-DG5-100). "applies each pending file in lexical order" is still true, but only above the highest applied id.
2. **p5-work-split shared rule 16** (`docs/architecture/p5-work-split.md:30`) says "P5 ranges have gaps by design … every id from 0058 at most 0099". Now add: the eight P5 gaps 0066, 0067, 0073, 0077, 0078, 0079, 0083 and 0084 are **retired, never filled** (`seed.test.ts` `P5_RETIRED_MIGRATION_IDS`), and a new id is above the highest shipped id. The §B.5 sentence "A task that needs none leaves its number unused" (`:167`) stays true; the number is now unused permanently. The older `p4-work-split.md:83` note ("Each range's unused numbers must be filled …") is superseded for P5.
3. **ADR-0007 / readiness:** `migrations: fail` now also means an out-of-order pending migration, not only checksum drift or an unknown applied file. The OpenAPI `/readyz` summary is still true.
4. **ADR-0046 §4 / implementation notes:**
   - Line 162 says "CSV (`packages/reporting/src/csv.ts:66–68`) … written through `csvCell`, so `neutralizeSpreadsheetText` applies". This is still true in effect: `textRow` → `textCell` → `neutralizeSpreadsheetText` decides `quotePrefix`, and `csvCell` writes it. But the line range is now about `csv.ts:71–73`, and the mechanism is the shared `quotePrefix` decision rather than a second neutralization inside `csvCell`.
   - ADR-0046 §4's "a decimal is its canonical string, unprefixed" is now true for long negative decimals as well.
5. **ADR-0050 (demo dataset) and the data dictionary:**
   - The roaming dataset's launch plan now includes its Day-90 test (`roaming.day_ninety_test`, scheduled `2026-10-01`, open, 0/6). Where ADR-0050 §4/§5 enumerate the seeded workflow states, "the launch plan with its template tasks" is now incomplete.
   - The data dictionary `day_ninety_test` row ("Who writes: the plan's generation, `day_ninety_test.respond`") could add "and the demo seed (`mth-db seed-demo`, synthetic)".

## 6. User-facing texts made untrue, and what I did

- None were made untrue. The fix makes one existing text true again. The roaming Day-90 page no longer shows "No Day-90 test yet – … Generate the launch plan first." / «أنشئ خطة الإطلاق أولًا» while a plan exists. It shows the test in en and ar (§2, F-DG5-121). The FE text itself is unchanged; it is FE-owned and still true for a transformation without a plan.
- The new migration-runner error and `mth-db status` line are operator log text, en only, as the assignment asks.

## 7. For the orchestrator

- **Merge.** There are no migrations to run. The changes are disjoint from T-DG5-FE-RG1 (`apps/web/**`): I edited nothing under `apps/web/**`. The changes rebuild with `pnpm -r build`. The demo stack seeds from `packages/db/dist`, so a demo database must be re-seeded or reset to get the Day-90 row.
- **Side effect to expect on demo stacks.** The roaming Day-90 test is scheduled `2026-10-01` and is open. When a demo stack's worker runs `launch.day_ninety_tests` (daily at 00:50 Asia/Riyadh, or as a run-now), it creates one `day_ninety_test_due` My Work item per holder of `day_ninety_test.respond` in the roaming transformation (the demo SP and TL). This is correct product behaviour for an open, due test. A demo e2e that counts those users' My Work items after a worker run would see them. No spec in my ownership counts them, and I did not run the demo e2e specs I don't own (D-164).
- **Ownership note.** F-DG5-142's file is a qa acceptance spec, and I edited it under this assignment's ownership. The proof that a boundary can no longer fail it is `QA_A22_CROSS_BOUNDARY=1`. The QA reviewer can rerun it.
- **Disposable files.** Both probes, `e2e/zz-be-rg1-a22-before-probe.spec.ts` and `e2e/zz-be-rg1-dom-r1-day90-probe.spec.ts`, were deleted after their runs. Their sources are recorded in the evidence (`142-before-probe.spec.ts.txt`; the reviewer's own file for 121). A temporary `packages/db/migrations/0066_p6_example.sql` existed only during the numbering probe and was removed, and `git status` shows no migration change. My temporary databases and outputs were under `$TMPDIR` and were removed by the harnesses.
- The untracked top-level files in the worktree (`.bashrc`, `.profile`, `.gitconfig`, `.idea`, `.vscode`, `CLAUDE.local.md`, …) were there before I started. I did not create or touch them.

## 8. What remains

- Nothing in the assigned scope remains. All four findings are repaired, with failing-before and passing-after evidence.
- The fixes still need verification by non-authors in round 2. Each fix is recorded with `import-findings --fix` and the merge commit (D-185). I do not close my own findings.
- For the architect (T-DG5-ARCH-R7): the ADR, work-split and data-dictionary amendments listed in §5. I did not edit `docs/architecture/**`, which is outside my ownership.
- Not run (D-164), left for the orchestrator's merged-tree verification: `pnpm test`, `pnpm test:integration`, and the full e2e suite. That includes the demo e2e specs (A02 and others), which see the new Day-90 row on the demo stack (§7).
