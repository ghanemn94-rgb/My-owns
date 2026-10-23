# Handback T-DG5-FE-AB2 (continued as T-DG5-FE-AB2B), frontend-ux-engineer, DG5 round-5 repair (D-181)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-AB2B-frontend-ux-engineer-20261022T174328Z-92e7f206","session_id":"92e7f206-660d-49cf-9d6c-d9b96dc132b2"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-AB2B.md` (sha256 `a3166f21…a9e74`, verified).
- **Starting revision:** `69ac4f0` (branch `dg5/fe-ab2`; WIP commit of the orphaned T-DG5-FE-AB2 on top of `3ed31c0`, merged base `d3bcb4a`). Tree clean at start, apart from untracked home dotfiles that are not mine.
- **Time:** start `2026-10-22T17:57:37Z`, end `2026-10-22T18:30:05Z` (about 33 min, inside the limit).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start (`T-DG5-FE-AB2-evidence/validate-dg4-start-AB2B.log`) and at the end (`validate-dg4-end-AB2B.log`).

All data in the tests is synthetic. Nothing here grants a business, Finance or IT approval. Product gates G1–G6 are not touched, and this is not an engineering-gate DG5/DG7 verdict.

## 1. Review of the salvaged WIP

I reviewed the WIP commit line by line against D-181 and the binding scope. I did not take it on trust.

- **Hook:** it follows `nextCursor` of the existing `GET /api/v1/transformations`, with `PAGINATION.maxLimit` (100) per page and no contract change.
  - It passes the query `signal` to every page request and uses the key `["transformations","all",params]`. That key starts with `"transformations"`, so the existing invalidation after a transformation mutation refreshes it too.
  - A page that fails fails the whole query, so no partial list is shown.
  - A repeated cursor, or more than 1000 pages, is an error, never a shortened list.
  - Errors reach `QueryState`/`ErrorState`. An `ApiError` shows the translated status text. Any other error shows `problems.unexpected`, in en and ar (`lib/problem.ts errorMessage`). The guard's English `Error.message` is never shown to the user.
- **Screens:** all 12 screens named in the assignment, plus `MyProceduresPage`, use the hook. Every one shows a loading and an error state.
  - I checked for a `QueryState` with a disabled query, which would show a permanent spinner. `AssignmentsPage` renders its `QueryState` only when `canListTransformations`, so the case does not arise.
- **Remaining single-page callers:** `grep` finds `useTransformations(` only in `TransformationListPage.tsx:85`. That screen is the paginated transformation register itself (cursor pagination with Next/Previous), not a picker, so it is correctly left as it is.
- **Recent shortlists:** none. No screen was kept as a "recent" shortlist, so no shortlist wording or link was needed.
- **One defect in the WIP evidence (not the code):** the old before-fix e2e log had been recorded during the interrupted run. To be certain it matches the spec as committed, I recorded the before-fix failure again, see §3.

**Verdict:** the WIP source is complete and correct for the scope. I made **no further source changes**. My only additions are evidence files and this handback, all uncommitted.

## 2. Changed files (WIP commit `69ac4f0`, now verified; plus my uncommitted evidence)

| File | Purpose |
|---|---|
| `apps/web/src/api/queries.ts:230-282` | `AllTransformationsParams`, `ALL_TRANSFORMATIONS_MAX_PAGES` (:237), `fetchAllTransformations` (:245), `useAllTransformations` (:276), key `allTransformations` (:55) |
| `apps/web/src/pages/procedures/MyProceduresPage.tsx:205` | launch-procedure transformation picker: all pages; select inside `QueryState` |
| `apps/web/src/pages/admin/AssignmentsPage.tsx:405` | grant-form transformation scope picker: all pages of the organization; loading/error under the select |
| `apps/web/src/pages/automation/RulesPage.tsx:202` | create-rule scope picker and rule-action target picker: all pages; form inside `QueryState` |
| `apps/web/src/pages/automation/RulePage.tsx:415` | edit-rule content: the action target picker: all pages |
| `apps/web/src/pages/delegations/DelegationsPage.tsx:249` | create-delegation transformation option list: all pages (previously the 50 most recently updated); loading/error in the dialog description |
| `apps/web/src/pages/launch-plan/ui.tsx:87` | `TransformationPicker` (launch plan, health check entries): all pages |
| `apps/web/src/pages/AreaPages.tsx:38` | area entry list "Choose a transformation": all pages |
| `apps/web/src/pages/dashboards/DashboardsPage.tsx:128` | transformation/workstream dashboard chooser: all pages |
| `apps/web/src/pages/playbook/BlockPage.tsx:218` | playbook-block launch form: all pages (the preset `defaultTid` is always an option) |
| `apps/web/src/pages/reports/ui.tsx:520` | `TransformationEntry` (reports, presentation entries): all pages |
| `apps/web/src/pages/methodology-migrations/MigrationsEntryPage.tsx:14` | migrations entry list: all pages |
| `apps/web/src/pages/walkthrough/WalkthroughPage.tsx:36` | walkthrough transformation filter: all pages (the one in the URL is always an option) |
| `apps/web/src/api/all-transformations.test.tsx` | unit tests H1–H5 (hook), P1–P2 (picker, en and ar) |
| `apps/web/e2e/p5-transformation-picker-complete.spec.ts` | e2e regression: more than 100 transformations; the launch picker offers the newest one (en, ar) |
| `docs/delivery/handbacks/DG5/T-DG5-FE-AB2-evidence/*AB2B*`, `before-fix-AB2B/`, `after-fix/` | my logs and screenshots (uncommitted) |
| this file | handback (uncommitted) |

## 3. Finding D-181: transformation pickers silently truncate

- **Cause:** each picker called `useTransformations({ …, limit: 100 })` or `limit: 50` once and rendered `data.items`. It never followed `nextCursor`, so it never offered anything past the first page, and the screen did not say so. On the shared e2e database, wave AB's new spec pushed the count past 100 before the chromium-ar project ran.
- **Fix:** the shared hook at `apps/web/src/api/queries.ts:245/:276`, used at the 13 call sites listed in §2. Errors fail the whole list and loading is visible. The contract, response shape and page limit are unchanged.
- **Regression tests:**
  - **Unit** (`apps/web/src/api/all-transformations.test.tsx`):
    - H1: one page.
    - H2: three pages; every cursor is sent once, in order, and the filters are kept.
    - H3: a 500 on page 2 leaves no partial data and requests no page 3.
    - H4: a repeated cursor is an error.
    - H5: the signal reaches every page.
    - P1 (en and ar): the launch picker offers all 250 transformations over 3 pages, including ids 101 and 250.
    - P2 (en and ar): a failed page shows the translated error state with "Try again" and no partial picker.
  - **E2E** (`apps/web/e2e/p5-transformation-picker-complete.spec.ts`), on the real API:
    - It creates fillers through the API until more than 100 transformations exist, then one more, the newest.
    - It asserts from the API that the first `code:asc` page (limit 100) does **not** contain the newest one.
    - It asserts that the launch picker offers the newest one and exactly as many options as the API lists across all pages, then selects it. It also checks `dir`, runs axe, and takes a screenshot.
- **Failing before the fix:**
  - **Unit** (from the WIP run, `unit-before-fix-picker.log`): `Tests 4 failed | 5 passed (9)`, exit 1. P1 and P2 fail in en and ar; the hook tests H1–H5 pass.
  - **E2E, re-recorded by me** with the committed spec. `MyProceduresPage.tsx` was temporarily restored to `HEAD~1`, the web was rebuilt, then the file was restored from a saved copy, verified with `git status`, and rebuilt by the later `pnpm -r build`.
    - Log: `e2e-before-fix-AB2B.log`, `2 failed` (chromium-en, chromium-ar), exit 1.
    - Both fail at spec `:83` with `toHaveCount(1)`: `Expected: 1, Received: 0`. The newest transformation is not an option.
    - Screenshots: `before-fix-AB2B/chromium-{en,ar}-test-failed.png`.
    - The earlier WIP log `e2e-before-fix.log` shows the same failure.
- **Passing after the fix:**
  - **Unit:** `AB2B-unit-after-fix-picker.log`, `Tests 9 passed (9)`, exit 0.
  - **E2E:** see §4.3.
  - **Screenshots:** `after-fix/{en,ar}-fe-ab2-launch-picker-all-transformations.png`. In the ar (RTL) run, `TR-0112 · Synthetic FE-AB2 AR newest` is selected in the picker.
- **The two failing specs, unchanged:** `git diff --stat d3bcb4a -- apps/web/e2e/p5-procedure-outputs.spec.ts apps/web/e2e/p5-procedures-automation.spec.ts apps/web/e2e/p5-record-name-reflow.spec.ts` prints nothing.
  - In both e2e runs below, chromium-ar `p5-procedure-outputs.spec.ts:39` and `p5-procedures-automation.spec.ts:256` ran **after** chromium-en's picker spec had already put more than 100 transformations in the database. That is the original failure condition, and both pass.

## 4. Checks (run one at a time, D-164)

| # | Command | Env | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` | start | `PASS gate DG4 (historical)`, exit 0 | `validate-dg4-start-AB2B.log` |
| 1 | `pnpm -r typecheck` | | exit 0 | `AB2B-typecheck.log` |
| 2 | `pnpm -r build` | | exit 0 | `AB2B-build.log` |
| 3 | `pnpm lint` | | exit 0 (eslint `--max-warnings=0`) | `AB2B-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | | "All matched files use Prettier code style!", exit 0 | `AB2B-prettier.log` |
| 5 | `pnpm openapi:lint` | | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations`, exit 0 | `AB2B-openapi-lint.log` |
| 6 | `npx vitest run --project unit-web` | LANG/LC_ALL/LC_CTYPE unset | `Test Files 91 passed (91)`, `Tests 1722 passed (1722)`, exit 0 | `AB2B-unit-web-unset.log` |
| 7 | `npx vitest run --project unit-web` | `LANG=LC_ALL=C.UTF-8` | `Test Files 91 passed (91)`, `Tests 1722 passed (1722)`, exit 0 | `AB2B-unit-web-cutf8.log` |
| 8 | e2e, 4 specs, `--workers=1` (below) | locale unset | **20 passed** (10 chromium-en, 10 chromium-ar), 0 failed, 0 flaky, exit 0 | `AB2B-e2e-unset.log` |
| 9 | the same | `LANG=LC_ALL=C.UTF-8` | **20 passed**, 0 failed, 0 flaky, exit 0 | `AB2B-e2e-cutf8.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG4` | end | `PASS gate DG4 (historical)`, exit 0 | `validate-dg4-end-AB2B.log` |

### 4.1 E2E command

```
E2E_PG_PORT=23201 E2E_API_PORT=23210 MTH_PORT_POOL=23220-23249 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
apps/web/e2e/support/with-stack.sh npx playwright test \
  apps/web/e2e/p5-transformation-picker-complete.spec.ts apps/web/e2e/p5-procedure-outputs.spec.ts \
  apps/web/e2e/p5-procedures-automation.spec.ts apps/web/e2e/p5-record-name-reflow.spec.ts --workers=1 --reporter=list
```

There is one disposable database per run. Ports are within my range (23200–23249).

### 4.2 Run order (disclosure)

Playwright runs projects in order (chromium-en, then chromium-ar), and files within a project in path order, not in command-line order. So the actual order was:

- chromium-en: procedure-outputs → procedures-automation → record-name-reflow → picker spec;
- then the same for chromium-ar.

This differs from the "your spec first" wording of the assignment. It does reproduce the failure condition of D-181 for the chromium-ar project.

### 4.3 E2E tail (unset)

```
  ✓  10 [chromium-en] › apps/web/e2e/p5-transformation-picker-complete.spec.ts:15:1 › Transformation picker: … offers the newest one (15.7s)
  ✓  11 [chromium-ar] › apps/web/e2e/p5-procedure-outputs.spec.ts:39:1 › Procedure outputs: … (11.2s)
  ✓  14 [chromium-ar] › apps/web/e2e/p5-procedures-automation.spec.ts:256:1 › My procedures: launch baseline validation; … (7.4s)
  ✓  20 [chromium-ar] › apps/web/e2e/p5-transformation-picker-complete.spec.ts:15:1 › … (4.0s)
  20 passed (4.3m)
exit=0
```

The C.UTF-8 run gave `20 passed (4.2m)`, `exit=0`.

The reporter prints the picker spec's location as `:15:1`, while `test(` is at line 32 of the source. It does the same before and after the fix. It is a reporter location quirk of this spec, not a different test.

### 4.4 Other non-zero exits

The only non-zero exit is the deliberate before-fix run (`e2e-before-fix-AB2B.log`, exit 1, explained in §3). There were no timeouts and no flaky tests.

### 4.5 Not run (D-164)

The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite were **not run (D-164)**. They are for the orchestrator's merged-tree verification. No integration path is reached by this change, which is web only.

### 4.6 Clean-up

I removed the `test-results/` and `playwright-report/` folders. `with-stack.sh` deletes its database on exit. Before testing I removed four empty `.claude/.cc-writes` directories in `apps/web`.

## 5. Contract, schema or dependency needs

None. The fix uses the existing `GET /api/v1/transformations` operation, its response shape and `PAGINATION.maxLimit`. It adds no dependency and no migration.

## 6. ADR and data-dictionary statements made untrue or incomplete

- I found no statement that is now untrue. `grep` over `docs/architecture` finds no ADR describing the one-page picker loads.
- **Incomplete (optional, for T-DG5-ARCH-R7):** ADR-0007 (API conventions: cursor pagination, `{ items, nextCursor }`) could gain a dated note covering:
  - client-side pickers that select a transformation load every page through `useAllTransformations` (D-181);
  - a failed page fails the whole list;
  - the register screen stays page-by-page.

## 7. User-facing texts

- The entry and picker texts were **untrue before the fix**, because the lists were silently cut at 50 or 100:
  - `nav.entry.body` ("…Choose a transformation:");
  - `launchHealthP5.entry.body` ("Choose a transformation to open this screen for it.");
  - the picker labels.
- They are **true now**, in en and ar, since every visible transformation is offered. No text changed.
- No shortlist text exists, so none was needed.
- The new loading and error states reuse the existing translated `common.state.*`, `problems.status.*` and `problems.unexpected` keys (en and ar). The P2 unit test checks them in both languages.

## 8. What remains

- Nothing in my scope.
- For the orchestrator:
  - integrate the WIP commit with these uncommitted evidence files;
  - run the merged-tree verification (full `pnpm test`, `pnpm test:integration`, full e2e) in both locale settings for round 7.

## 9. Merge instructions

There are no migrations and no ordering constraints. This branch only touches `apps/web/**` (13 files) plus the evidence and this handback. I expect no conflicts, because the assignment says there are no concurrent owners.
