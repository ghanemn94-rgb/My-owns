# Handback T-DG6-FE-X3: pre-freeze repair of the web e2e regressions (frontend-ux-engineer)

- **Stage:** P6 / DG6 (BUILDING). **Branch:** `dg6/fe-x3`, base `HEAD` `0079c11cc2d59eff46c05f60f4d551277f1a0b1d`. Changes are left **uncommitted**.
- **Invocation:** `DG6-T-DG6-FE-X3-frontend-ux-engineer-20261031T092444Z-c4b1f11f` (session `c4b1f11f-b972-4300-b397-06f60b943074`).
- **Time:** started `Sat Oct 31 09:24:56 UTC 2026`, ended about `11:13 UTC` (about 108 minutes; past the 100-minute mark, so I finished the current item and stopped).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → exit 0, `PASS gate DG5 (historical)` (`T-DG6-FE-X3-evidence/validate-dg5-start.log`, rerun at the end: `validate-dg5-end.log`).
- **Assignment contract issues (said, not guessed):**
  1. The assignment names "`docs/architecture/p6-work-split.md` pre-freeze repair of web e2e regressions" as my section. **No such section exists** in `p6-work-split.md` (headings checked: §1, §2, §E/F, §J/C, §B/A, §H/G, §D, §I/K). I followed the assignment text and the §2 shared rules, and touched only the files each repair needed.
  2. Several of the assignment's one-line failure descriptions don't match the cited log (`docs/delivery/test-evidence/DG6/orchestrator-prefreeze-1726c96/e2e-unset.log`). For example, it says p3-journeys sends 3 requests, but the log shows an enabled `SELECT:Unsaved view`. It says session-end shows 4 requests, but the log shows wordmark content overflowing at 320 px by 14 px (en) and 78 px (ar). It puts the 14 px wordmark overflow under p5-reflow-axe, but the log shows the branding page scrolling 133 px at 390 px. I repaired the failures **as logged**.

## Root causes and repairs (per failure)

| # | Failing test (en + ar) | Root cause | Repair | Product or test |
|---|---|---|---|---|
| 1 | `p3-journeys.spec.ts:1399` auditor: no enabled write control | The P6 saved-view bar (T-DG6-FE-D) adds an enabled `<select>` ("Unsaved view") to the P3 lists. Picking a view only sets the list's own query parameters and grants or writes nothing (ADR-0057 §4; `saved-views/api.ts`). That makes it a reading aid, but it wasn't marked as one. | `SavedViewBar.tsx`: the select carries `data-view-control`, the product's existing marker for view-only controls (already used by `BenefitFormulaPage.tsx`, and honoured by `p3-journeys` and `p3-business-cases`). The save/rename/share/delete buttons stay unmarked and are hidden for AUD (`canManage`), so a write control would still fail the test. | Product (marker). **Test assertion unchanged.** |
| 2 | `p5-navigation.spec.ts:142` navigation colour follows `brand.primary` | **The approved design changed it.** ADR-0061 §1.2 (REQ-S15-003; D-195 row 18; BE-W) refuses a publish when any declared pair fails. #FFD700 fails `brand.primary / surface.card` (ui, 1.40:1 < 3:1) and `brand.primary / surface.page` (large-text, 1.31:1 < 3:1), so the API answers 422 `branding.contrast_insufficient` and nothing is published. This was confirmed in the repro's page snapshot. | The test still proves both REQ-S15-004 behaviours: (a) #C8102E is used as it is; (b) a light colour is darkened. For (b) it now uses **#E4572E**, which is 3.68:1 with white, passes every declared pair (checked with `checkBrandingContrast`), and has navigation shade **#CB4E29** (`rgb(203, 78, 41)`). It also **adds** the ADR-0061 refusal: #FFD700 shows the form's one alert with the translated `branding.contrast_insufficient` text and a `/primaryColour` failing pair, and the navigation stays #C8102E. | Test (ADR-0061 §1.2 / D-195 row 18). Strengthened, not weakened. |
| 3 | `p5-reflow-axe.spec.ts:81` 390 px / 200 % text horizontal scroll on `/admin/branding` | The contrast report added by T-DG6-FE-F shows the 64-character token-source SHA-256 in a `workspace-header__grid` cell. The string has no break opportunity: the `<bdi>` measured 494 px at 390 px, widening the page by 133 px (measured live with a throwaway spec, since deleted). The `th` offenders in the log are the table's cells, which `getBoundingClientRect` reports even though `.table-wrap` clips them. | `BrandingPage.tsx`: the SHA `<dd>` gets the class `code--wrap`. `app.css`: new utility `.code--wrap { overflow-wrap: anywhere; }`. | Product. |
| 4 | `p6-admin-screens.spec.ts:166` heartbeat: `[data-heartbeat] .status-chip` resolves to 4–7 elements | `OperationsPages.tsx` put the per-instance table (one chip per worker instance) **inside** the `[data-heartbeat]` element. Once the A22 spec (`e2e/a22-p6-operability`) has run a worker, its stale instances add chips. The overall status then had several "Stale" chips, not one labelled chip. | The `[data-heartbeat]` element now holds only the overall chip and its facts. The instance table follows as a sibling outside it. Everything else is unchanged: the A22 spec's `card.locator("p").first()` and its page-level `table[data-table='worker-instances']` locator, the attribute values, the tones and the labels. | Product. |
| 5 | `session-end.spec.ts:335` (T-DG2-FE12 layout) wordmark content overflows at 320 px | P6 added the global search box (FE-D) and the assistant launcher slot (FE-E) to the header row. At 320 px there was no room left, so the wordmark (`min-inline-size: 0`) was squeezed: content overflow of 14 px (en) and 78 px (ar). | `app.css` `@media (max-width: 30rem)`: the header wraps; `.app-header__spacer` becomes a full-width line break (`flex-basis: 100%`); the wordmark takes the rest of row 1 next to the menu button (`flex: 1 1 0`, still wrapping its name and badge inside its own box); search, assistant, language and sign-out continue on row 2 **in the same DOM, focus and visual order**; the search field shrinks to fit (`flex: 1 1 8rem`, input `min-inline-size: 0`). Measured at 320/360/390 px, en and ar: wordmark overflow 0, page overflow 0, header 106 px, nothing outside the viewport. | Product. |
| 6a | `p6-layout-1440.spec.ts:180` executive next actions (ar only) | Test data isolation (the F-DG4-143 to F-DG4-148 class). "Next actions" is designed as the first three dated decisions and blockers of what the page shows, earliest first (ADR-0061 §4.1; `ExecutiveRegions.tsx`). Unfiltered, the dev.lead's whole Synthetic Retail portfolio competes. By the time chromium-ar runs, overdue synthetic dependencies left by earlier specs (one per language from `p5-dependency-slip-impact`, plus "billing data feed") fill all three slots, so the spec's own decision, due in 4 days, is fourth. That is why it passed in en and failed in ar. | The spec opens `/executive-overview?tr=<its transformation>`, the page's own FilterBar URL filter. The regions, their place above the fold, the tokens, axe and every assertion are unchanged. The product behaviour is as designed and was not changed. | Test (determinism; no requirement assertion weakened). |
| 6b | `p6-register-1000.spec.ts:198` axe `color-contrast` on search-hit `<mark>` (ar only) | Real product defect. `.search-hit mark` inherited the link colour (`action.primary` #006DE9) on `surface.selected` (#E8F1FC): **4.22:1, below 4.5:1**. That pair isn't declared, so neither the build nor the publish check covers it. It failed only in ar because only that run had index hits in the title links. | `productivity.css`: `.search-hit mark { color: var(--mth-brand-deep) }`. That is the declared, build- and publish-checked pair `brand.deep / surface.selected` ("selected chip"), 9.83:1 with the seeds. The underline and the 600 weight remain the non-colour cue. | Product. |
| 8 | Found by my full run, not in the orchestrator's log: `p3-business-cases.spec.ts` (log line `:397`) read-only auditor: `[data-state='read-only']` strict-mode violation, 2 elements | P6 regression (T-DG6-FE-B). `SensitivityPanel.tsx` marks its "Only the Transformation Office or an access administrator can change the restriction…" note `data-state="read-only"`. That marker is the record page's **one** read-only banner (`Workspace.tsx`), and `benefits.test.tsx` asserts exactly one. Whether the page-level locator sees one or two depends on whether the sensitivity query has loaded when it resolves: a race. It passed in the orchestrator's run and failed in my loaded run. | `SensitivityPanel.tsx`: the note gets its own marker, `data-state="sensitivity-read-only"`. No test or unit test referenced the old marker on that element. | Product. |
| (7) | Seen only in my partial repro, not in the orchestrator run: `p6-admin-screens.spec.ts:65` audit screen `not.toContainText(/\bDG[0-7]\b/)` | The `p5-navigation` and `p5-reflow` restore steps write the change note "…before **T-DG5-FE-G2**'s navigation-colour test" as product data. On a stack with few audit events that row is on page 1 of Administration > Audit, and the "no DG0–DG7 in product text" assertion fails. In the full run, newer events had pushed it off page 1. `p5-reader-branding-demo.spec.ts` had the same latent note ("T-DG5-FE-G's test"). | Both change notes no longer name an engineering task or gate ("…restore the settings that were current before the navigation-colour test" / "…the branding test"). | Test data. |

## Files changed

| File | Purpose |
|---|---|
| `apps/web/src/components/saved-views/SavedViewBar.tsx` | The view picker is marked `data-view-control`, a reading aid (ADR-0057 §4). |
| `apps/web/src/components/saved-views/productivity.css` | Search-hit `<mark>` text uses the declared `brand.deep / surface.selected` pair (was 4.22:1). |
| `apps/web/src/pages/admin/operations/OperationsPages.tsx` | `[data-heartbeat]` holds only the overall status chip and facts; the instance table is outside it. |
| `apps/web/src/pages/branding/BrandingPage.tsx` | The contrast report's SHA-256 cell wraps (`code--wrap`). |
| `apps/web/src/components/sensitivity/SensitivityPanel.tsx` | The "cannot manage" note gets its own marker (`sensitivity-read-only`), so the page keeps one `[data-state='read-only']` banner. |
| `apps/web/src/styles/app.css` | `.code--wrap` utility; 320 px header (≤30rem) wraps onto two rows with the wordmark unsqueezed. |
| `apps/web/e2e/p5-navigation.spec.ts` | Darkening shown with #E4572E → #CB4E29; #FFD700 now asserted as refused (ADR-0061 §1.2); change note without "DG5". |
| `apps/web/e2e/p5-reader-branding-demo.spec.ts` | Change note without "DG5" (product data must not name an engineering gate). |
| `apps/web/e2e/p6-layout-1440.spec.ts` | Executive page scoped to the spec's own transformation with the page's `tr` filter (test isolation). |
| `docs/delivery/handbacks/DG6/T-DG6-FE-X3-*` | This handback and its evidence (logs, `changes.diff`, screenshots). |

No API, schema, OpenAPI, zod, migration, i18n key or dependency change.

## Behaviour delivered per requirement row (acceptance quoted)

- **REQ-S15-001**: "A20: visual review of the Arabic and English executive and home pages at 1440 px shows decisions, outcomes and next actions without scrolling, with light surfaces and blue navigation". `p6-layout-1440` passes in en and ar; the next-action list contains the spec's own executive decision. Screenshots: `screenshots/{en,ar}/p6-1440-executive.png`.
- **REQ-S15-003**: "A20: the contrast test lists every pair and passes; white small text on #0078FF is not used for action buttons; status chips are distinguishable in greyscale". The search highlight no longer uses an undeclared pair below 4.5:1; it now uses a declared, checked pair. The refused-publish path of ADR-0061 §1.2 is exercised in the browser (`p5-nav-colour-ffd700-refused.png`). The branding contrast report reflows at 390 px and 200 % text (`p5-reflow-axe` passes). The heartbeat shows one chip with icon and label.
- **REQ-S15-004**: "A20: changing brand.primary in Branding Settings changes the navigation colour and the header colour of a newly generated PDF report without a code change or redeploy". The navigation-colour half is re-proven: #C8102E is used as it is, and #E4572E is darkened to #CB4E29 (`p5-nav-colour-c8102e.png`, `p5-nav-colour-e4572e.png`). The PDF half isn't touched by this task.
- **REQ-S15-009**: "A20: e2e tests at 360 px approve a gate item and submit a KPI actual in Arabic and English". The header change keeps 320/360/390 px free of horizontal scroll (measured), so the 360 px flows keep their header. `p6-flows-360` is part of the full `apps/web/e2e` run below.
- **REQ-S15-010**: "A12;A14: search as a user scoped to transformation X returns no Y records; a bulk update touching a stale record reports a conflict for that record only; a draft survives a browser reload". Not changed functionally. The auditor can still apply a shared view with no write offered (`p6-register-1000` passes in en and ar).
- **REQ-S20-022**: "A22: Health checks, logs, error alerts, admin job visibility and production/demo separation are demonstrated". After A22's worker has written instances, the heartbeat card has exactly one labelled overall chip, never Alive without a worker (`e2e-heartbeat-with-worker.log`: `e2e/a22-p6-operability.spec.ts` + `apps/web/e2e/p6-admin-screens.spec.ts`, 28 passed). Screenshots: `screenshots/{en,ar}/p6-operations.png`.

## Checks (real commands, real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; harness ports 27350–27399 only.

| Check | Command | Exit | Result | Log |
|---|---|---|---|---|
| DG5 historical (start) | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` | `validate-dg5-start.log` |
| Repro before the fix | `apps/web/e2e/support/with-stack.sh npx playwright test <7 listed specs> --workers=1` (ports 27350/27351) | 1 | 10 failed, 76 passed: the logged failures 1–5 in en and ar, plus (7) audit "DG5" in both. 6a and 6b didn't reproduce in that subset (they depend on data from other specs). Not committed as evidence: it ran before the fixes, and its output is in my run's scratch only. | (scratch) |
| Listed specs after the fix (+ `p5-reader-branding-demo`) | `E2E_PG_PORT=27350 E2E_API_PORT=27351 MTH_PORT_POOL=27352-27399 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/{p3-journeys,p5-navigation,p5-reflow-axe,p6-admin-screens,session-end,p6-layout-1440,p6-register-1000,p5-reader-branding-demo}.spec.ts --workers=1` | 0 | **96 passed** (chromium-en + chromium-ar), 0 failed, 0 flaky, 26.5 min. This ran in parallel with the full e2e run and unit tests on the same machine (loaded). | `e2e-listed-specs.log` |
| Heartbeat with worker instances present | `with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts apps/web/e2e/p6-admin-screens.spec.ts --workers=1` | 0 | **28 passed**; the ar heartbeat test ran after en's A22 worker had beaten (the orchestrator's failure condition) | `e2e-heartbeat-with-worker.log` |
| Whole `apps/web/e2e` | see "Full e2e run" below | see below | see below | `e2e-apps-web-full.log` |
| typecheck | `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| lint | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| openapi | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `openapi-lint.log` |
| unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | unit-node 186 files / **2801** tests; unit-web 120 / **2015**; unit-formula-nocodegen 3 / **259 passed, 2 skipped** (261) | `pnpm-test-unset.log` |
| unit, C.UTF-8 | `env -u LANG -u LC_CTYPE LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 2801; 2015; 259 + 2 skipped | `pnpm-test-c-utf8.log` |
| integration | `QA_PG_PORT=27385 MTH_PORT_POOL=27386-27399 tests/qa/support/with-pg.sh pnpm test:integration` | **not finished at handback** | Still running at 11:12 UTC, loaded by the e2e runs on the same machine. So far: **982 passed, 1 failed**. The failure is `contract.test.ts` › "P5 BE-J operations (p5-exercises-be-j.ts)": `expected [] to have a length of 1 but got +0` at `p5-exercises-be-j.ts:61` (`listDependencySlips` returns no slip). **This task changed no API, worker, db or test-support file.** The exercise hard-codes milestone dates `2026-11-01` / `2026-12-01` and launch date `2026-10-01`, and today is 2026-10-31. A date-relative cause (a calendar date bomb) is likely, but **unverified**. It is for the backend owner of BE-J / the orchestrator. Final counts and pinned-count changes: none reported, because the run didn't finish. | `integration.log` (partial) |
| build | `pnpm -r build` | 0 | all packages built (10:53 UTC) | `build.log` |
| sensitivity marker (after build) | `with-stack.sh npx playwright test apps/web/e2e/p3-business-cases.spec.ts apps/web/e2e/p4-benefits.spec.ts --workers=1` | 0 | **30 passed** (en + ar) | `e2e-sensitivity-readonly.log` |
| unit-web, touched areas (after the last fix) | `npx vitest run --project unit-web apps/web/src/pages/benefits apps/web/src/pages/business-cases apps/web/src/pages/admin/security apps/web/src/components` | 0 | 28 files / **429** tests | `unit-web-sensitivity.log` |
| typecheck + lint (after the last fix) | `pnpm -r typecheck`; `pnpm lint` | 0; 0 | clean | `typecheck.log`, `lint.log` |
| DG5 historical (end) | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` | `validate-dg5-end.log` |

**Full e2e run: NOT completed; only partly valid.** Command: `E2E_PG_PORT=27360 E2E_API_PORT=27361 MTH_PORT_POOL=27362-27379 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` (`e2e-apps-web-full.log`, restarted at about 10:25 UTC).

- **Valid part, tests #1–#95** (chromium-en, up to `p4-adoption-bau` 7; before 10:53 UTC): **94 passed, 1 failed**. The failure is #40 `p3-business-cases` read-only auditor, root cause 8 above. It was repaired after the run and verified (`e2e-sensitivity-readonly.log`, 30 passed).
- **Invalid part, from #96 on:** at 10:53 UTC I ran `pnpm -r build`, required for acceptance, while this stack was still serving `apps/web/dist`. The background run couldn't be stopped from my shell (separate PID namespace). The rebuild replaced the hashed assets that the running API's `index.html` references, so from #96 every test fails in about 5.5 s with the sign-in form never rendering. The trace shows `waiting for getByLabel(/^(?:اسم المستخدم الاصطناعي|Synthetic user name)…/)` after navigation. These failures (136 ✘ at 11:12 UTC) are a **harness artefact of my rebuild, not product results**. They prove nothing either way.
- **So the whole-set `apps/web/e2e` run that the assignment requires is NOT done** on the final tree. It is listed under "What remains". The first attempt (`e2e-apps-web-full-attempt1-stopped.log`, 140 passed, 0 failed, chromium-en up to `p4-governance`) ran on the tree *without* the sensitivity fix.

**Disclosed non-zero exits and interruptions**

- The pre-fix repro exited 1 (expected; failures listed above).
- The full-run failures from #96 on are caused by my mid-run `pnpm -r build` (see "Full e2e run"), not by the product.
- Integration: 1 failure so far (`p5-exercises-be-j.ts:61`), and the run hadn't finished at handback.
- The first full `apps/web/e2e` attempt was **stopped by the tool's 30-minute background limit**, not by a failure. It had reached 140 passed, 0 failed (chromium-en up to `p4-governance`). Log kept as `e2e-apps-web-full-attempt1-stopped.log`. It was restarted with a 2-hour limit (`e2e-apps-web-full.log`).

**Visual evidence** (`T-DG6-FE-X3-evidence/screenshots/{en,ar}/`, written by the specs above):

- `language-not-saved-320.png`, `language-not-saved-768.png`: the 320 px two-row header with the wordmark unsqueezed. The spec switches language mid-test, so the ar project's shots show the English UI and vice versa.
- `p5-nav-colour-c8102e.png`, `p5-nav-colour-ffd700-refused.png`, `p5-nav-colour-e4572e.png`
- `p6-operations.png`, `p6-1440-executive.png`, `p6-register-1000-auditor.png`, `p3-journey-45-aud-business-cases.png`, `p6-audit.png`
- `p6-search.png`: in my stacks the index had no hits (no worker fed it), so the page shows its designed stale/empty state, and the `<mark>` colour change is **not** visible in a screenshot. The fix is proven by the ratio computation (4.22:1 → 9.83:1, a declared pair) and by the CSS diff, and will be exercised wherever the index has hits (as in the orchestrator's run).
- No 390 px branding screenshot exists: `p5-reflow-axe` captures that screen only on failure. The passing assertion (`page scrolls 0 px`) is the evidence.

## Operations routed / pending list delta

None. This task routes no operation, and no `p6-pending-*.ts` or `p6-exercises-*.ts` changed. Pinned counts in `contract.test.ts`: no delta.

## Contract, schema, migration or dependency needs

None. No migration, no new dependency, no new problem code.

## User-facing texts made untrue

None. No string changed, and no feature that a text calls planned was shipped.

## Notes for reviewers and the orchestrator

- **Focus order at 320 px.** The header's DOM order is unchanged (menu, wordmark, search, [assistant], language, sign-out), and the visual order matches it row by row. No CSS `order` is used.
- **The test changes rest on design decisions:**
  - #2 follows ADR-0061 §1.2 / D-195 row 18 (refusal at publish).
  - #6a and (7) are isolation and test-data fixes. Every requirement assertion is kept, and #2 gains the refusal assertion.
- **Merge:** these files are owned by FE-D (`SavedViewBar.tsx`, `productivity.css`), FE-B (`OperationsPages.tsx`), FE-F (`BrandingPage.tsx`), the shell (`app.css`), and the specs' authors. Expect conflicts only if those tasks changed the same lines after `0079c11`.

## What remains

1. **The whole `apps/web/e2e` set, once, on the final tree, in chromium-en and chromium-ar.** Not done; see "Full e2e run". The orchestrator should run it on an idle host after integrating: `pnpm -r build`, then `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1`, with no rebuild during the run. Each failure the orchestrator logged has been re-run on the final build in both languages: the listed specs (96 passed); the heartbeat with worker instances (28 passed); business cases and benefits (30 passed). That covers the orchestrator's 12 failures and the two new ones found here (7, 8). It is not the full set.
2. **Integration**: the run didn't finish within the time limit. One failure was seen in a backend contract exercise (`p5-exercises-be-j.ts:61`), likely date-relative and unrelated to this web-only diff, but unverified. Owner: backend-workflow-engineer / orchestrator. Final integration counts are not reported.
3. **`<mark>` screenshot**: not captured (no index hits in my stacks); see "Visual evidence".
4. Nothing else. No migration, dependency, contract or string change is pending from this task.

**Time:** start `09:24:56 UTC`, end `11:13 UTC` (2026-10-31), about 108 minutes.

## Addendum (11:23 UTC): the second full run ended

The background run in `e2e-apps-web-full.log` ended with exit 1: **109 passed, 218 failed, 219 did not run** (49.5 min). The failures from #96 on are the harness artefact of the 10:53 rebuild described above, so this run is **not** a valid whole-set result. "What remains" item 1 stands. At 11:23 UTC the integration run still had no final summary (`integration.log`), and item 2 stands.

## Addendum 2: the integration run ended

`QA_PG_PORT=27385 MTH_PORT_POOL=27386-27399 tests/qa/support/with-pg.sh pnpm test:integration` exited **1** after 3971 s (on a loaded host).

- Test files: 1 failed, 405 passed (406).
- Tests: **1 failed, 4118 passed**, 1 skipped, 2 todo (4122).

The only failure is `apps/api/test/integration/contract/response-validation.test.ts` › "P5 BE-J operations (p5-exercises-be-j.ts)": `expected [] to have a length of 1 but got +0` at `p5-exercises-be-j.ts:61`. This task's diff touches only `apps/web/**`, so the failure can't come from it. It also matches the hard-coded `2026-11-01` / `2026-12-01` milestone dates, with today being 2026-10-31, which suggests a date-relative cause (unverified). Owner: backend-workflow-engineer (BE-J) / orchestrator. **Acceptance item 3 is therefore not met** on this tree. No pinned-count change comes from this task.
