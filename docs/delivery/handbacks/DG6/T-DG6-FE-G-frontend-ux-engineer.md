# Handback T-DG6-FE-G (frontend-ux-engineer): the DG5 carry-forward (p6-work-split §I/K.5, ADR-0061 §9)

- **Run:** `DG6-T-DG6-FE-G-frontend-ux-engineer-20261029T151636Z-1cd5f3d1`, session `1cd5f3d1-3001-4b99-9ee6-dd897768bd1a`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-G.md`, sha256 `407eb783ff8adb9a81f340828db9d0302fe557e6dfd84b12508962347ade3694` (verified with `sha256sum`).
- **Working tree:** `/home/user/wt/dg6-fe-g`, branch `dg6/fe-g`. Starting `HEAD` `4951f16f31272bbdbb47525161531a7939cd028e`, clean.
- **Time:** start `2026-10-29T15:16:55Z` (`date -u`). The end time is the last `date -u` in §8. The work ran past the ~2 h limit because of the long background checks; see §7.
- **Changes:** left **uncommitted**, as the assignment asks. Evidence is under `docs/delivery/handbacks/DG6/T-DG6-FE-G-evidence/` (written `E/` below).
- **No migration, no contract change, no dependency, no API operation.**

## 1. Summary

| Finding | State |
|---|---|
| F-DG5-120 (Studio element labels in the page language) | Done: code, component tests en/ar, real-browser probe en/ar. |
| F-DG5-121 (rubric diff readable; "Changed" means "differs from the base", with a legend) | Done: code, component tests en/ar, real-browser probe en/ar. |
| F-DG5-125 (`fetchAllPages` never stops silently) | Done for the two named screens, with the unit test at 2,150 and a probe en/ar. The "load dataset (slice G)" check is **not done**; see §7. |
| F-DG5-150 (Traceability note wraps the record name) | Done: code, component test en/ar, real-browser probe at 390/360/320 px and at 1280 px with 200 % text, en/ar. |
| F-DG5-145/146/151, the two named waits | Done: `session-end.spec.ts` and `p5-launch-health-kpi.spec.ts`. |
| F-DG5-145/146/151, the budget sweep | **Not done.** This is the separable second half (§7). A loaded measurement of my tree and a measurement tool are delivered. |

FE-G never closes its own findings. Each one waits for a non-author reviewer in a DG6 round.

## 2. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/studio/api.ts` | `elementLabel()`: en `labelEn` → `sourceLabelEn` → `labelAr`; ar `labelAr` → `labelEn` → `sourceLabelEn`; then the stable key (F-DG5-120). New pure `rubricLevelChanges()` and `RubricLevel`/`RubricLevelChange` types (F-DG5-121). |
| `apps/web/src/pages/studio/VersionPage.tsx` | Diff section: the legend `studio.diff.changedLegend`. A `scoring_rubric` `levels` field renders one row per **changed** level: score label, English and Arabic descriptors, "No descriptor defined" for null. Never `JSON.stringify`. |
| `apps/web/src/pages/studio/ElementsSection.tsx` | The "Change in this version" column now follows the version diff when the version has a base: Changed/Added/Removed/Unchanged. Before, it followed "the version has a row", which made all five weights read "Changed" (F-DG5-121). A version without a base reads "Set in this version". While the diff loads it shows "Loading…"; if the diff fails it shows Unknown with a hint, never a guess. The same legend is shown above the table. |
| `apps/web/src/api/queries.ts` | **FE-A's file (orchestrator merge).** New `fetchPages()` returns `{ items, complete }` and `ALL_PAGES_MAX_PAGES = 20`. `fetchAllPages()` delegates to it, with the same behaviour as before for every other caller. Needed because the notice needs to know the cap was hit. |
| `apps/web/src/pages/traceability/api.ts` | `useReadableTransformations` (the executive-overview filter's source) returns `fetchPages` (`{ items, complete }`). |
| `apps/web/src/pages/dashboards/ui.tsx` | Named lines: `FilterBar` reads `.items` and shows the notice under the transformation select (`role=note`, `data-state=list-incomplete`, linked by `aria-describedby`); `useOrgQuery` reads `.items`. |
| `apps/web/src/pages/benefits/api.ts` | Named lines: the Finance queue's `useReadableTransformations` returns `fetchPages`. |
| `apps/web/src/pages/finance-validation/FinanceValidationPages.tsx` | Named lines: the organization queue reads `.items` and shows the notice (warning banner with an icon) as soon as the list is read. The notice does not wait for every queue to load. |
| `apps/web/src/pages/traceability/StructurePages.tsx` | Named lines: the portfolio "Add transformation" dialog reads `.items` and adds the notice to its description when the list is incomplete. This is a third consumer of the same hook, so it is not silent either. |
| `apps/web/src/pages/traceability/TraceabilityPage.tsx` | `RootedNote`: the note's sentence comes from the catalogue, split around a private-use placeholder, with the record name inside `<span class="record-name">` (F-DG5-150). The existing `.record-name { overflow-wrap: anywhere }` rule (app.css) applies. |
| `apps/web/src/pages/health-check/HealthCheckPage.tsx` | **One attribute, outside my named lines:** `data-assessment-version={a.version}` on the facts section. It is the only on-screen marker of the saved version, which the F-DG5-151 acceptance requires the spec to wait for. FE-F owns this file's E5 lines; there is no textual overlap. |
| `apps/web/e2e/session-end.spec.ts` | Wait line only: `apiPaging(page, lang).settled()`. It waits for no `/api/` request in flight for 500 ms and no "Loading…" in `main`. It is called after sign-in (My Work's paging) before each of the three "sign out elsewhere" steps. No step or assertion was removed or weakened. |
| `apps/web/e2e/p5-launch-health-kpi.spec.ts` | Wait line only, at the old `:202`, the acceptance's ":159" (the file has grown since): after the PUT `/actions` answers 200, the spec waits for `[data-assessment-version=<the PUT's version>]` on screen instead of "any GET of the assessment". The assertions are unchanged. |
| `apps/web/src/i18n/{en,ar}/studio.json` | Append-only: `elements.setInVersion`, `elements.changeUnknown`, `diff.changedLegend`, `diff.level`, `diff.levelAbsent`. |
| `apps/web/src/i18n/{en,ar}/common.json` | Append-only: `table.listIncomplete` = "This list is incomplete: showing the first {{n}} of more than {{n}}." |
| `apps/web/src/pages/studio/studio.test.tsx` | +5 tests (F-DG5-120 pure and en/ar render, F-DG5-121 en/ar render, the literal "one changed and one unchanged level" test, the no-base version). |
| `apps/web/src/pages/executive-overview/list-incomplete.test.tsx` (new) | F-DG5-125: `fetchPages` at 2,150 and 1,500, and both screens en/ar at 2,150 (notice, N = 2000, 2,000 options or 2,000 queues) and at 1,500 (everything, no notice). 11 tests. |
| `apps/web/src/pages/traceability/rooted-note.test.tsx` (new) | F-DG5-150: the name is in `.record-name` exactly once, and the sentence equals the catalogue's, en and ar; the CSS rule exists. 3 tests. |

Evidence-only files (not product): `E/probe/fe-g-probe.spec.ts` and `E/probe/probe.config.ts` (the real-browser probe), and `E/e2e-durations.mjs` (the e2e duration extractor).

## 3. Behaviour delivered, per acceptance text (ADR-0061 §9, verbatim)

**F-DG5-120.** "On the English Studio Elements table, every element row shows its English label: `elementLabel()` in `pages/studio/api.ts` uses `labelEn`, then `sourceLabelEn`, and only then `labelAr`; on the Arabic page it uses `labelAr` first. A component test with an element that has only `sourceLabelEn` and `labelAr` (the `0062` seed shape) shows the English text on the English page and the Arabic text on the Arabic page. No migration and no published configuration changes."

- **Delivered.**
  - `studio.test.tsx` "DG5 carry-forward … %s": the en page row `scoring_weight:strategic_fit` contains "Strategic fit" and not the Arabic; the ar page row is the reverse.
  - There is also a pure order test.
  - No migration, and no configuration is written by the fix.
- **Probe on a real stack, en and ar:** `E/screens/{en,ar}/f120-f121-elements-scoring-weights.png`.

**F-DG5-121.** "In the Studio rubric diff, 'Changed' means 'the value differs from the base version', and its legend says so in en and ar. Each changed row shows a readable before and after descriptor (the level label and its text), never raw JSON; a component test with one changed and one unchanged level shows exactly one 'Changed' marker and no `{` or `\"` character in the rendered diff."

- **Delivered.**
  - Legend: en "Changed: the value differs from the base version."; ar "معدّل: القيمة تختلف عن قيمتها في الإصدار الأساس." It is shown above the diff table and above the Elements table.
  - The test "one changed and one unchanged level give exactly one Changed marker and no { or \" in the rendered diff" passes. Without the fix, the raw JSON would put `{` in the table.
  - The Elements column now agrees with the diff. Probe: weights 30/20 → those two "Changed", the other three "Unchanged".
- **Probe screenshots:** `E/screens/{en,ar}/f121-rubric-diff.png`, `f120-f121-elements-scoring-weights.png`.

**F-DG5-125.** "`fetchAllPages` never stops silently at a page cap. The executive-overview transformation filter and the organization Finance queue either load every readable transformation, or show the plain notice 'This list is incomplete: showing the first N of more than N.' (en and ar) with N the number loaded. A unit test with 2,150 transformations in the mocked API shows either all 2,150 options or the notice with N = 2000; on the load dataset (slice G) the same screens are checked once."

- **Delivered for the two screens:** `list-incomplete.test.tsx`, 11/11.
- **Probe on a real stack:** the transformation list is answered by `page.route` with 2,150 synthetic rows. Screenshots: `E/screens/{en,ar}/f125-*.png`.
- **Two disclosures:**
  - (a) `fetchAllPages` itself still returns a plain array to its **other** ~70 callers (catalogues, registers). It now has a completeness-reporting sibling, `fetchPages`, but those callers don't show a notice. The acceptance's first sentence, read literally for every caller, is therefore **not met**. Throwing at the cap was rejected because it would turn long lists into error states. The open decision is in §6.
  - (b) "On the load dataset (slice G) the same screens are checked once": **not done**. DO-E's load dataset isn't on this branch (W8 runs in parallel). It needs a run after merge.

**F-DG5-150.** "On the Traceability page, the note 'Showing the links of <record>' renders the record name inside `.record-name` (`overflow-wrap: anywhere`). With a 200-character unbroken record name, there is no page-level horizontal scroll at 390, 360 and 320 px wide and at 1280 px with 200 % text, in en and ar."

- **Delivered.**
  - `rooted-note.test.tsx` passes, 3/3.
  - The probe (`E/probe-run1.log`) shows "page overflow 0 px, .record-name overflow-wrap anywhere" for each of the 8 cases (4 sizes × en/ar).
  - Screenshots: `E/screens/{en,ar}/f150-rooted-note-*.png`.
- **Not run:** a before-fix control on the old build.

**F-DG5-145, 146, 151.** "Every spec under `apps/web/e2e/**` and `e2e/**` that runs on the default 30 s budget is measured under load … its loaded worst case is recorded in the handback. A spec whose loaded worst case is above 15 s gets an explicit budget of at least 2x that worst case, or is split (p4-benefits test 8). `session-end.spec.ts` waits until My Work's paging has settled before signing out elsewhere. `p5-launch-health-kpi.spec.ts:159` waits for the saved version to appear on screen, not for any GET. No step or assertion of any spec is removed or weakened."

- **The two waits are delivered** (§2).
- **The measurement is delivered only on my branch tree, not on the merged tree,** with the disclosures in §5.4.
- **The budgets and the split are NOT done** (§7).

## 4. Operations routed (pending-list delta), contracts, schemas, dependencies

- **Operations:** none routed. FE-G has no `p6-pending-*.ts`; the delta is 0, and no pinned count changes.
- **Contract, schema, migration:** none.
- **Dependency:** none.
- **Orchestrator items:**
  1. `apps/web/src/api/queries.ts` is FE-A's file: the `fetchPages` addition needs an orchestrator merge.
  2. The one `HealthCheckPage.tsx` attribute line (FE-F's file).
  3. **Provisional Arabic labelling:** I wrote the new Arabic texts myself; they aren't from an ADR or a language review. Please add them to `apps/web/src/i18n/provisional-ar-p6.ts` (FE-A's file; it has no "fe-g" source, so use "fe-a" or add a source). The texts are `common.table.listIncomplete`, `studio.elements.setInVersion`, `studio.elements.changeUnknown`, `studio.diff.changedLegend`, `studio.diff.level` and `studio.diff.levelAbsent`.
  4. `studio.elements.overridden` is now unused. I left it in place because catalogues are append-only.

## 5. Checks actually run (exit codes are real)

| # | Command (repository root unless noted) | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5`, run 1 | **1** | "the repository is a shallow clone". Immediately afterwards, `git rev-parse --is-shallow-repository` printed `false` here and in `/home/user/My-owns`, and no `.git/shallow` existed. Cause unknown, transient. | `E/validate-historical-DG5-run1.log` (transcribed: the file was overwritten by run 2) |
| 1b | the same, run 2, seconds later | **0** | `PASS gate DG5 (historical)` | `E/validate-historical-DG5.log` |
| 2 | `pnpm -r build` | **0** | | `E/build-1.log` |
| 3 | `pnpm -r typecheck` | **0** | | `E/typecheck.log` |
| 4 | `pnpm lint` | **0** | | `E/lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | (console) |
| 6 | `pnpm openapi:lint` | **0** | "OpenAPI 3.1.1, 932 operations" | `E/openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | **1** | unit-node 1 failed / 2606 passed (2607); unit-web 4 failed / 1783 passed (1787); formula 259 passed + 2 skipped. All 5 failures are load timeouts; see 7b. | `E/unit-locale-unset.log` |
| 7b | the 3 failing files alone (`traceability.test.tsx`, `transformations.test.tsx`, `branding-layout.test.ts`) | **0** | 53/53 and 5/5 | `E/unit-locale-unset-isolated-rerun.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | unit-node 2 failed / 2605 passed (2607) (`architecture.test.ts` 30 s timeout, `server.test.ts` 5 s timeout); unit-web 1787/1787; formula 259 + 2 skipped | `E/unit-c-utf8.log` |
| 8b | the 2 failing files alone, C.UTF-8 | **0** | 147/147 | `E/unit-c-utf8-isolated-rerun.log` |
| 9 | `QA_PG_PORT=24740 MTH_PORT_POOL=24741-24749 tests/qa/support/with-pg.sh pnpm test:integration` (16:39–18:28 UTC, under the load of row 11) | **1** | 4 files failed / 338 passed (342); **5 failed** / 3468 passed / 1 skipped / 1 todo (3475). Failures: `contract.test.ts` "undeclared request media type" (30 s timeout); `response-validation.test.ts`, the same test (timeout), plus "P5 BE-J operations" (`expected [] to have a length of 1`, the case DO-A2 recorded as passing in isolation); `forms/form-records.test.ts` 5000/5001-row export (timeout); `reporting/registers-report.test.ts` 5,001 rows (timeout). All are API tests; this task changed no API file. No pinned count changes. | `E/integration.log` |
| 9b | the 4 files alone (same harness) | **1** | 232 passed, 1 failed: `contract.test.ts` "undeclared request media type", a 30 s timeout. "P5 BE-J operations" passed in both files. | `E/integration-isolated-rerun.log` |
| 9c | `contract.test.ts` alone, at host load ≈ 11 (other agents) | **0** | 101/101. The media-type test took **27.96 s against its 30 s budget**. That is an F-DG5-145-class risk in an API test, for its owner and the orchestrator (not FE-G's file). | `E/integration-isolated-rerun-2.log` |
| 10 | full e2e, locale unset, **pinned browser** (run 1) | **1** | VOID: `chromium_headless_shell-1194` (the ADR-0012 pin for `@playwright/test` 1.56.1) doesn't exist in `/opt/pw-browsers`, which holds only revision 1243. 22 browserless tests passed; every browser test failed at launch. With the pinned browser, the e2e is **BLOCKED** in this sandbox. | `E/e2e-full-unset-run1-VOID-pinned-browser-missing.log` |
| 11 | full e2e, locale unset, `PLAYWRIGHT_BROWSERS_PATH=$TMPDIR/pwb`. That path holds symlinks named `-1194` pointing at the pre-installed `-1243` binaries (Chromium 153.0.8010.12). This is **a deviation from the ADR-0012 pin, disclosed**: nothing was downloaded and `playwright install` was not run. 518 tests. | **none (stopped)** | **INCOMPLETE.** The agent tool's 2 h background limit stopped it at about 18:13 UTC, at test ~420 of 518: 310 passed, 25 failed, 85 skipped (tests after a failure in the same serial file); there was no Playwright summary and no JSON. **Every failure ran 30–37 s**, i.e. hit the default 30 s budget. The one checked with its trace (`p4-dashboards.spec.ts:136` ar, the Executive Overview, a screen this task changed) says "Test timeout of 30000ms exceeded"; its en run passed in 15.9 s. The other 24 failure messages weren't read (the list reporter prints them only at the end, which never came). The 25 are listed in `E/e2e-full-unset.log` (lines with ✘). Not a pass; it's a measurement. `session-end.spec.ts` (5 tests en, 10.1–12.4 s) passed, and `p5-launch-health-kpi.spec.ts`'s health-check test passed in en (31.7 s, explicit 240 s budget). | `E/e2e-full-unset.log` |
| 12 | demo e2e (a02 ×3, a21), same browser path, `e2e/support/with-demo-stack.sh` | **0** | 12 passed (10.0 m) | `E/e2e-demo-unset.log` |
| 13 | the FE-G probe, `apps/web/e2e/support/with-stack.sh npx playwright test -c E/probe/probe.config.ts`, same browser path | **0** | 6 passed (F-DG5-150 0 px overflow in 8/8 cases; F-DG5-120/121 on a real T06 draft; F-DG5-125 en/ar) | `E/probe-run1.log` |
| 14 | `npx vitest run` of the new and changed test files (apps/web) | 0 | studio 36/36; list-incomplete 11/11 (after two fixture corrections in the test itself: an invalid permission name, and the Finance totals panel answered 403); rooted-note 3/3 | (console) |

### 5.4 The loaded e2e measurement (for the sweep)

- **Rows 11–13 ran at the same time** as the unit and integration suites and each other: three stacks plus Vitest. That load is heavier than a normal freeze run.
- **Failures in run 11 are timeouts at the default 30 s.** Every failure so far in run 11 is a test on the default 30 s budget that stopped at about 30 s, so its measured duration is a lower bound. This is the F-DG5-145 class itself, not a product regression. Not one failure is in a spec this task changed.
- **The per-test table** is produced by `node E/e2e-durations.mjs E/e2e-full-unset.log E/e2e-demo-unset.log` and saved as `E/e2e-durations.txt`.
  - **Result:** 221 tests measured; **133 on the default budget above 15 s** (flag "NEEDS BUDGET").
  - **Partial:** chromium-ar is covered only up to `p4-raid-governance`.
  - **Heuristic, verify each before relying on it:** the "default budget" column is detected from the source (no `test.setTimeout(`/`test.slow(` in the body, no file-level timeout).
  - **Lower bounds:** failed tests' durations are lower bounds.
- **The figures are inflated by my own load.** The unit, integration and three stacks ran in parallel with run 11, so these numbers are pessimistic, and the full list can't be used as-is for the sweep. That is the reason the budgets weren't applied (§7).

## 6. User-facing texts made untrue, and open decisions

- **Untrue texts:** I found none. No existing en/ar string described these behaviours as planned.
- **Open decision 1 (F-DG5-125, sentence 1):** should every `fetchAllPages` caller show the notice, or only lists that can exceed 2,000 items? I suggest the orchestrator or FE-A decide whether the other callers move to `fetchPages` with the same notice, or whether the ADR's first sentence is read as "for the named screens".
- **Open decision 2:** the browser revision mismatch (row 10) needs an environment decision. Either provide `chromium*-1194` under `/opt/pw-browsers`, or move the pin under ADR-0012.

## 7. What remains (the separable second half, D-059/D-070)

1. **The F-DG5-145/146/151 budget sweep.** From the full e2e run **on the merged tree** (D-193), set an explicit `test.setTimeout(≥ 2 × loaded worst case)` on every default-budget test above 15 s, or split it (p4-benefits test 8). Then rerun.
   - My interim measurement already flags dozens of tests. Once run 11 completes, the full list is in `E/e2e-durations.txt`.
   - Note that run 11's failures cap at 30 s, so a fresh measurement with a temporarily raised global timeout (for example `--timeout=120000`) is needed to get true worst cases for those tests.
2. **F-DG5-125 on the slice G load dataset**, after DO-E merges.
3. **A before-fix control for F-DG5-150** (optional).
4. **The orchestrator items in §4.**

## 8. Results of the long runs and the end time

- Integration: row 9 (exit 1, 5 load failures) → 9b → 9c (each test passes alone; one sits 2 s under its budget).
- Full e2e (row 11): stopped by the tool's time limit, incomplete; the demo e2e (row 12) and the FE-G probe (row 13) passed.
- Unit tests: rows 7/8 exit 1 from load timeouts only, each failing file passing alone (7b, 8b).
- **Not re-run after the last edit:** `pnpm -r build` (row 2) ran after every source change except the test files. No rebuild was done later because the e2e stacks were serving `apps/web/dist` (the DO-A2 §4.3 lesson). The later edits are test-only.
- **End:** `2026-10-29T18:42Z` (`date -u` after row 9c). That is about 3 h 25 min in total, of which about 1 h 45 min was waiting for the long runs. The implementation and the handback were written by ~17:00Z.
