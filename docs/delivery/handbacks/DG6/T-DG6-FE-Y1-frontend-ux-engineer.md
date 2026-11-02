# Handback T-DG6-FE-Y1 (frontend-ux-engineer): DG6 round-1 repair, F-DG6-102, F-DG6-143, F-DG6-144

- **Stage:** P6, gate DG6 (FIXING after review round 1). Branch `dg6/fe-y1`, base `b702011e4` (Merge T-DG6-BE-Y3). All changes are left **uncommitted**.
- **Invocation:** `DG6-T-DG6-FE-Y1-frontend-ux-engineer-20261101T225800Z-5928d10e`, session `5928d10e-ceae-412a-99af-8db65871a9a6`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-Y1.md` (sha256 `da799fb3…8d05`, verified).
- **Time:** started `2026-11-01T22:58:23Z`; ended 2026-11-02T00:42:30Z.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited **0** (`T-DG6-FE-Y1-evidence/00-validate-historical-DG5.log`).
- **Scope:** the three findings only. No business, Finance or IT approval is granted or implied. Seed and demo data are synthetic. Product gates G1–G6 aren't touched, and nothing here touches DG7.

Evidence lives in `docs/delivery/handbacks/DG6/T-DG6-FE-Y1-evidence/`, abbreviated `EV/` below.

## 1. Per finding: cause, fix, test, result

### F-DG6-102 (Low, REQ-S17-001): the retry-chain wait in `integrations.test.tsx`

- **Cause.** After the Retry click, `RunDetailView.retry()` (`ConnectorsPage.tsx`) posts the retry, awaits `refresh()` (a refetch of the integrations queries), navigates to the new attempt's route, and that route fetches `GET …/runs/<new id>` and renders. The test covered that whole chain with a single `findByRole("link", "Open the previous attempt")` on the default async-utility timeout. The finding says 1 s, but `apps/web/test/setup.ts` raises the default to 5 s, and the failing run's 5.9 s test time matches that. Under load the chain took longer than that one window. The initial `findByText(firstAttempt)` also had only the default wait.
- **Fix (test only, no product change).** Each step is now awaited separately with a measured budget, `RETRY_CHAIN_WAIT = { timeout: 15_000 }`:
  1. the POST `…/retry` is recorded;
  2. the navigation: the new attempt's detail `GET …/runs/<RUN_RETRY>` is requested. Only the new route asks for it, and only after `refresh()` has resolved;
  3. the new attempt is rendered: the `h1` reads exactly `t("integrations.run.heading", { trigger: Manual, attempt: 2 })`, and then the "Open the previous attempt" link appears.

  The first render's wait gets the same budget. The test's own timeout is `RETRY_CHAIN_TEST_TIMEOUT_MS = 60_000`, which is ≥ 2× the worst whole-test time measured. `MTH_UNIT_WEB_TIMING_REPORT=1` prints the step marks, using the same opt-in pattern as the warm-up report in `setup.ts`.
- **Measurement** (in the constants' comment):
  - `EV/f102-measure-chain.log`, 5 runs of the test alone at a 1-minute load of 24–29 on 4 CPUs: click → rendered took 0.99–1.87 s. The slowest single step was navigation → rendered, 1.39 s.
  - `EV/f102-before-after-loaded.log`, the whole file at a load of 31–36: the new test took 27.3 s in its worst run. Each step's 15 s budget is about 8× the slowest chain, and the 60 s test budget is 2× that 27.3 s.
- **Test before/after** (`EV/f102-before-after-loaded.log`). This ran the HEAD version of the file as a temporary copy (`zz-old-integrations.test.tsx`, since deleted) against the new one, under 12 synthetic CPU burners plus the host's own load (load 12–36):

  | Run | OLD (HEAD) | NEW |
  |---|---|---|
  | 1 | **FAILED**: `Unable to find role="link" and name "Open the previous attempt"`. This is the reviewer's failure, reproduced. | All 17 skipped: `setup.ts`'s 60 s page warm-up `beforeAll` hook timed out at load 24–28. |
  | 2 | All 17 skipped: the same warm-up hook timeout. | Retry-chain test **passed** (27.3 s). 4 *other* tests in the file failed at load ~35 (see below). |
  | 3 | Passed (6.1 s, at load 31–36). | 17/17 passed. |

  The OLD failure reproduces the finding. The NEW test never failed. The HEAD version also passed once, so this is a timing defect and not a deterministic red/green pair; the reviewer saw the same (2 of 3 runs).
- **Disclosed, outside this finding:**
  - At load ~35 on 4 CPUs (12 burners: more than 2× the review's load of ~20), four *other* tests in `integrations.test.tsx` failed on their own default 5 s waits: "connectors > shows Not verified…", and three "import batch (en)" tests. The review's load did not reproduce these (only the retry test failed there), and my repeat runs at normal load passed 17/17.
  - The `setup.ts` warm-up hook (60 s, owned by the unit-web harness, F-DG4-148) timed out twice at the same synthetic overload.

  I did not change either, because they are outside F-DG6-102's scope. If the orchestrator wants the file hardened at that load, the separable follow-up is to give the remaining `findBy*` in that file explicit waits.
- **Result:** the retry-chain test passed in every run where the file's tests ran (8 of 8), including the `pnpm test` runs in §3.

### F-DG6-143 (Low, REQ-S15-009): Upload policy scrolls sideways at 360 px in English

- **Cause.** The "current policy" card heading on `/admin/upload-policy` renders a status `Chip` whose label is a whole sentence: "Default policy: no organization setting has been saved". The base `.status-chip` is `white-space: nowrap` by design, for short chips. The sentence-long chip therefore kept its one-line width (x 29..385) and widened the document to 385 px in a 360 px viewport. The Arabic label is shorter, so it fitted.
- **Fix.**
  - `apps/web/src/pages/automation/ui.tsx`: `Chip` gets an opt-in `wrap` prop (default `false`, so the other 68 callers are unchanged). With `wrap`, it adds the existing `.status-chip--wrap` modifier (F-DG3-170: `white-space: normal`, `overflow-wrap: anywhere`, `max-inline-size: 100%`, logical properties only, so it works the same in RTL) and wraps the label in the `<span>` that modifier styles. The icon and the text label stay, so the status never relies on colour alone.
  - `apps/web/src/pages/admin/upload-policy/UploadPolicyPage.tsx`: both heading chips ("Default policy …" and "Organization setting") pass `wrap`.
  - No CSS or token change, and no string change.
- **Test.** I added `apps/web/e2e/p6-admin-screens.spec.ts`, "P6 upload policy: no page-level horizontal scroll at 360 px or with 200 % text; the status chip wraps". It runs in both language projects:
  - at 360 × 800 it checks `documentElement.scrollWidth <= clientWidth`;
  - it checks that the chip carries `status-chip--wrap`;
  - at 1280 × 900 with the root font at 200 % it checks the same width;
  - it takes screenshots at each size.

  It sits before the narrowing test, so on a fresh stack it measures the default (long) chip. The failure message names the policy state it measured. Its budget is the spec's existing measured 60 s (`BUDGET_MS`, T-DG6-FE-B), and this test took ≤ 5 s.
- **Before the fix** (`EV/f143-before-fix-e2e.log`, the pre-fix `apps/web/dist`): chromium-en **failed** with `360 px (policy default: true) Expected: <= 360 Received: 385`, the reviewer's reading exactly. chromium-ar kept within 360 but failed the wrap-class check.
- **After the fix** (`EV/f143-after-fix-e2e.log`, rebuilt dist): **2 passed**, en and ar, with the policy at default in both. The whole `p6-admin-screens.spec.ts` alone also passed: 28/28, `EV/f144/verify-p6-admin-screens.log`.
- **Screenshots** (default policy, chip wrapped onto two lines in English):
  - `EV/screenshots/upload-policy-en-360.png`
  - `EV/screenshots/upload-policy-ar-360.png`
  - `EV/screenshots/upload-policy-en-200pct.png`
  - `EV/screenshots/upload-policy-ar-200pct.png`

  I viewed the 360 px pair: no sideways overflow, and both the label and the icon are visible.

### F-DG6-144 (Low, REQ-DLV-038): the 17 product-journey specs on the default 30 s budget

- **Cause.** These 17 specs had no `test.setTimeout`, so each test ran on Playwright's default 30 s. Several journeys need more than that under review load:
  - `journeys`
  - `p2-blank-text`
  - `p3-business-cases`
  - `p3-inherited-approval`
  - `p3-portfolio`
  - `p3-seams`
  - `p4-adoption-bau`
  - `p4-execution`
  - `p4-governance`
  - `p4-kpi`
  - `p4-route-splitting`
  - `p4-traceability`
  - `p4-value-headlines`
  - `p5-reader-branding-demo`
  - `p5-shell`
  - `p6-shell`
  - `session-end`

  `grep -L "test.setTimeout\|describe.configure.*timeout" apps/web/e2e/*.spec.ts` listed exactly these 17, as the review did.
- **Fix.** Each spec now has one file-level `test.setTimeout(<budget>)`. Playwright 1.56.1 applies it to every test and hook in the file (`testType.js` `_setTimeout`: the loading file suite's `_timeout`), as `p6-flows-360.spec.ts` already does. A comment above it gives the measurement, the review's observation, the log paths and the rule.
- **Rule.** Budget = at least 2 × the larger of:
  - (a) my loaded measurement;
  - (b) the slowest time the DG6 QA round-1 logs report for that spec.

  It is rounded up to 15 s and is never below 60 s. Where (b) was a timeout at 30 s, the true duration is at least that, so the doubled figure is a lower bound. Rule (b) exists because running alone on a fresh stack underestimates a full-suite run on a stack holding every earlier spec's data, and some of my lane runs fell to a load of 5–12.
- **Measurement pass** (`EV/f144/measure-<spec>.log`, plus `.load` with the 1-minute load sampled every 15 s). Each spec ran alone in its own disposable stack, both projects, with a temporary `--timeout=300000` CLI override (measurement only; nothing in the files). Three stacks ran in parallel to load the host, on ports 28360–28389. All 17 specs passed with 0 failures. The table is in `EV/f144/budget-table.txt`:

  | Spec | Mine: worst (load) | Review round 1 | Budget |
  |---|---|---|---|
  | journeys | 22.1 s (26–38) | 36.5 s, timeout | 75 s |
  | p2-blank-text | 17.8 s (26–38) | 23.3 s | 60 s |
  | p3-business-cases | 28.0 s (14–18) | 33.1 s, timeout | 75 s |
  | p3-inherited-approval | 13.8 s (12–15) | 22.7 s | 60 s |
  | p3-portfolio | 22.8 s (13–17) | 32.2 s, timeout | 75 s |
  | p3-seams | 34.3 s (15–18) | 35.9 s, timeout | 75 s |
  | p4-adoption-bau | **49.0 s** (24–38) | 30.9 s, timeout | **105 s** |
  | p4-execution | 21.4 s (9–13) | 35.1 s, timeout | 75 s |
  | p4-governance | 20.5 s (15–26) | 33.1 s, timeout | 75 s |
  | p4-kpi | 31.7 s (16–35) | 35.2 s, timeout | 75 s |
  | p4-route-splitting | 10.2 s (16–17) | 32.2 s, timeout | 75 s |
  | p4-traceability | 37.2 s (16–36) | 32.2 s, timeout | 75 s |
  | p4-value-headlines | 25.6 s (12–14) | 31.8 s, timeout | 75 s |
  | p5-reader-branding-demo | 9.6 s (5–9) | 31.5 s, timeout | 75 s |
  | p5-shell | 5.2 s (10–12) | 24.0 s | 60 s |
  | p6-shell | 4.4 s (14–17) | 5.4 s | 60 s |
  | session-end | 12.8 s (13–16) | 19.5 s | 60 s |

- **Re-run of each changed spec alone with the budgets in force** (no CLI override; `EV/f144/verify-<spec>.log`; summarised by `python3 vsum.py`, output in §3). Every spec passed alone, both projects. Three needed a re-run, explained below:
  - 15 specs passed on the first verify run. The slowest test against its budget was p3-seams at 36.4 s of 75 s, at load 13–15. The others were between 3 s and 31 s.
  - `journeys` (1 failed, 2 did not run), `p2-blank-text` (1 failed) and `p4-adoption-bau` (1 failed) failed on the first verify run **because I ran `pnpm -r build` while those lanes were running**. The Vite build empties and rewrites `apps/web/dist`, which the stacks serve. All three failures fell in 23:35–23:39, the build window, and each was a page that never rendered, not a slow one:
    - the sign-in field was not found within 5 s (p2-blank-text);
    - `main#main h1` was not found within 5 s (p4-adoption-bau);
    - the register's filter search box never appeared, so the test hit its 75 s budget (journeys, ar admin test).

    Re-run alone after the build (`EV/f144/verify-<spec>.rerun.log`): **journeys 18/18, p2-blank-text 18/18, p4-adoption-bau 16/16 passed**. The slowest was 30.7 s of 105 s.
  - `p6-admin-screens.spec.ts` (changed for F-DG6-143): 28/28 passed alone.
- **Not done.** `p4-benefits` test 8 and `p4-gates-closure` test 6 were also seen timing out in the review. They already carry per-test budgets on specific tests only: `p4-benefits` has 180 s on its worker test, and `p4-gates-closure` has 240 s and 60 s on two tests. Their other tests, including the two named above, still run on 30 s. They are outside the 17 the finding lists, so I did not change them. That is a separable follow-up if the reviewer wants every test in those files budgeted.

## 2. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/integrations/integrations.test.tsx` | F-DG6-102: staged, measured waits for the retry chain; test timeout 60 s; opt-in timing report. |
| `apps/web/src/pages/automation/ui.tsx` | F-DG6-143: `Chip` gets an opt-in `wrap` prop (uses the existing `.status-chip--wrap`). This file belongs to the FE-D slice: a named-line addition, default off. |
| `apps/web/src/pages/admin/upload-policy/UploadPolicyPage.tsx` | F-DG6-143: both policy-status heading chips wrap. |
| `apps/web/e2e/p6-admin-screens.spec.ts` | F-DG6-143 regression test: 360 px and 200 % text, en and ar, chip wraps; screenshots. |
| `apps/web/e2e/{journeys,p2-blank-text,p3-business-cases,p3-inherited-approval,p3-portfolio,p3-seams,p4-adoption-bau,p4-execution,p4-governance,p4-kpi,p4-route-splitting,p4-traceability,p4-value-headlines,p5-reader-branding-demo,p5-shell,p6-shell,session-end}.spec.ts` | F-DG6-144: one measured file-level `test.setTimeout` each, with its measurement comment. No assertion or wait changed. |
| `docs/delivery/handbacks/DG6/T-DG6-FE-Y1-frontend-ux-engineer.md`, `…/T-DG6-FE-Y1-evidence/**` | This handback and its logs and screenshots. |

I also removed an empty, untracked `apps/web/e2e/.claude/.cc-writes/` directory (and its then-empty parent) before the tests, as the assignment asks.

## 3. Checks (real exit codes)

Host: 4 CPUs, shared with the other concurrent round-1 repair tasks. The 1-minute load is in each log. Node 24.21.0, offline. Harness ports were 28350–28399 only.

| # | Command | Log | Exit | Result |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | `EV/00-validate-historical-DG5.log` | **0** | `PASS gate DG5 (historical)` |
| 1a | `pnpm -r typecheck` (first run, before the budgets were inserted) | `EV/10-typecheck.log` | **0** | all packages Done |
| 1b | `pnpm -r typecheck` (final tree) | `EV/10b-typecheck-final.log` | **0** | see the log |
| 2 | `pnpm -r build` | `EV/13-build.log` | **0** | all packages Done. This is the build that overlapped the verify lanes (§1, F-DG6-144). |
| 3a | `pnpm lint` (first run) | `EV/11-lint.log` | **0** | `eslint . --max-warnings=0` |
| 3b | `pnpm lint` (final tree) | `EV/11b-lint-final.log` | **0** | see the log |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | `EV/14-prettier.log` | **0** | "All matched files use Prettier code style!". Run after the budgets were inserted. This handback, written afterwards, was checked on its own (row 4b). |
| 4b | `npx prettier --check <this handback>` | (run at handback) | **0** | "All matched files use Prettier code style!" |
| 5 | `pnpm openapi:lint` | `EV/12-openapi-lint.log` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` |
| 6 | `env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE pnpm test` | `EV/15-unit-unset.log` | **0** | unit-node: 187 files, **2817 passed**. unit-web: 120 files, **2018 passed**. unit-formula-nocodegen: 3 files, **259 passed, 2 skipped**. |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | `EV/15-unit-cutf8.log` | **1** | unit-node: 187 files, **2817 passed**, plus **1 Vitest unhandled error**: `[vitest-worker]: Timeout calling "onTaskUpdate"`. That is the worker's RPC to the main process timing out under load (load 13–17 with the integration suite running), not a test failure. unit-web: 120 files, **2018 passed**. formula: **259 passed, 2 skipped**. No test failed. Vitest counts the RPC error, so the script exits 1. |
| 7b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-node` (re-run of the invocation that hit the RPC timeout) | `EV/16-unit-node-cutf8-rerun.log` | **0** | 187 files, **2817 passed**, no error |
| 8 | `QA_PG_PORT=28390 MTH_PORT_POOL=28391-28399 tests/qa/support/with-pg.sh pnpm test:integration` | `EV/20-integration.log` | **NOT FINISHED (killed)** | Started 23:51:54Z. The background runner's 1-hour time limit killed it at about 00:52Z, after **286 test files had passed, with 0 failed files and 0 failed tests**. It never printed a summary and has no exit code. I did not restart it, because the task was past its 2-hour limit. My change touches no file in the integration project: the web UI, web unit tests and Playwright specs only. Pinned counts are unchanged. |
| e2e | each spec alone, both projects (see §1) | `EV/f143-*.log`, `EV/f144/measure-*.log`, `EV/f144/verify-*.log`, `EV/f144/verify-summary.txt` | as §1 | F-DG6-143: 2/2 after the fix (2 failed before, as intended). F-DG6-144: all 17 specs and `p6-admin-screens` passed alone with their budgets. Three needed a re-run after the build overlap, explained in §1. |
| unit | F-DG6-102 loaded runs | `EV/f102-*.log` | as §1 | |

The helper scripts used (lane runner, budget calculator, verify summary) are in `EV/tools/`.

## 4. Requirement rows (acceptance quoted)

- **REQ-S17-001.** "A17: a test connector run records last success, row counts, errors and retries, all visible in the UI".
  - What this task did: it makes the unit test for the retries part, "retry chain visible and retry once", deterministic under load.
  - Product behaviour: unchanged.
- **REQ-S15-009.** "A20: e2e tests at 360 px approve a gate item and submit a KPI actual in Arabic and English".
  - What this task did: it removes the page-level overflow on Upload policy at 360 px, and adds a 360 px / 200 % text regression test for that screen in en and ar.
  - Not covered here: the A20 flows themselves (gate approval, KPI actual at 360 px) are FE-F2's `p6-flows-360.spec.ts`. I didn't change them.
- **REQ-DLV-038.** "A12;A13;A14;A17;A21;A22;A23: the applicable A01-A22 executable tests pass on the DG6 candidate and the load report states the actual results against REQ-S20-029".
  - What this task did: it gives the 17 product-journey specs measured budgets, so their result is not decided by host load. Every one passed alone with its budget.
  - Not covered here: this task doesn't produce the load report.

## 5. Operations routed, contract, schema, dependencies

- **Pending operations:** none routed. Delta to any `p6-pending-*.ts`: **none**. The `contract.test.ts` pinned counts are unchanged.
- **Contract, schema, migration:** none. No new dependency.

## 6. User-facing texts

No en/ar string was added or changed, and none became untrue.

## 7. What remains

1. **Acceptance item 3 is not complete.** The integration suite (`pnpm test:integration` under `with-pg.sh`) was killed by the 1-hour background time limit after 286 files had passed, with 0 failures. No final count and no exit code exist. The orchestrator should run it on the integrated candidate. My diff can't affect it: there is no API, worker, db or shared change.
2. **Acceptance item 2:**
   - With the locale unset it passed, exit 0.
   - With C.UTF-8 the full `pnpm test` exited 1. Every test passed, but the unit-node invocation counted one Vitest worker-RPC timeout, which is load and infrastructure. That invocation alone re-ran to exit 0.

   A clean single full `pnpm test` under C.UTF-8 on a quieter host would close this.
3. **Optional follow-ups, outside the three findings:**
   - give the other `findBy*` waits in `integrations.test.tsx` explicit timeouts; they failed only at a synthetic load of ~35 on 4 CPUs;
   - budget the remaining default-30 s tests in `p4-benefits.spec.ts` and `p4-gates-closure.spec.ts`. The review saw test 8 and test 6 of those files time out, but they weren't among the finding's 17.
4. **Merge notes.**
   - No migration, no operation routed, no dependency.
   - `apps/web/src/pages/automation/ui.tsx` (FE-D's file) gains only the optional `wrap` prop.
   - The 17 spec edits are each a single inserted comment-and-`test.setTimeout` block after the imports or `describe.configure`. A conflict with another task touching the same spec headers would be trivial.
   - Run `pnpm -r build` **before** starting e2e stacks, never during: a rebuild empties `apps/web/dist` under a running stack.
