# Handback T-DG5-FE-RG1 (frontend-ux-engineer): DG5 round-5 repair wave RG1, F-DG5-120 / 122 / 140 / 141

- **Stage:** DG5 (P5), FIXING after clean re-gate round 1 on candidate `sha256:8df7f922…` (D-184, D-185).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-RG1-frontend-ux-engineer-20261023T101239Z-fd12edfc","session_id":"fd12edfc-4fce-49e8-83dc-dd5cf39508cf"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-RG1.md`, sha256 `eb63ae10…34adb1` (verified at start).
- **Working tree:** `/home/user/wt/dg5-fe-rg1`, branch `dg5/fe-rg1`, HEAD `1190cb6` (started clean apart from untracked harness dotfiles, which were already present and were not touched: `.bashrc`, `.mcp.json`, `.zshrc`, `CLAUDE.local.md`, …). **Changes are uncommitted** for the orchestrator.
- **Time:** start `2026-10-23T10:12:53Z`; end `2026-10-23T11:35:25Z` (about 83 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0 at the start (and at the end, §7).
- Ownership respected: only `apps/web/**` and this handback/evidence were written. Root `e2e/**`, `apps/api/**` and `packages/**` were read only, and no file from them is imported by my specs. No new dependency. No contract change (no new operation, no new response shape).
- Engineering agent: nothing here grants or implies a business, Finance or IT approval. Product gates G1–G6 are untouched, and product gate G6 never implies DG7. All data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/dependencies/slips.tsx` (new) | F-DG5-120: `useDependencySlips` (existing `listDependencySlips`, all pages), `slipRows`, `forecastChangeDays`, `BeforeAfter`, and the read-only `DependencySlipsSection` (client-side sort, filter, pagination and persisted column selection through `RegisterTable`; loading, error, no-permission, stale and empty states through `QueryState`) |
| `apps/web/src/pages/dependencies/DependenciesPage.tsx` | F-DG5-120: the slips section first on the Dependencies page (the slip work item's link) |
| `apps/web/src/pages/portfolio/InitiativePage.tsx` | F-DG5-120: the slips affecting this initiative, first on the initiative page and in its "on this page" nav |
| `apps/web/src/i18n/{en,ar}/dependencies.json` | F-DG5-120: `dependencies.slips.*` (title, intro, columns, reasons, empty states, "changed to") |
| `apps/web/src/i18n/{en,ar}/myWork.json` | F-DG5-120: `myWork.message.portfolio__task__dependency_slip`, the work item's and its inbox reminder's text from `messageParams` |
| `apps/web/src/pages/playbook/ui.tsx` | F-DG5-122: `cellContent` (`<br>` as an element), `isCalloutTable`, `plainBlockText`, `plainSnippetPiece`; `BlockText` callout class; `SourceText` renders table blocks with `BlockText`; `Snippet` and `excerpt` show no Markdown |
| `apps/web/src/styles/app.css` | F-DG5-122: block-table header cells wrap; the one-cell callout wraps (`overflow-wrap: anywhere`) |
| `apps/web/src/pages/procedures/MyProceduresPage.tsx` | F-DG5-140: `LaunchSection` offers the form only with `procedure.launch` somewhere; otherwise a read-only note (`LaunchForm` is the unchanged form) |
| `apps/web/src/i18n/{en,ar}/workflowsP5.json` | F-DG5-140: `workflowsP5.procedures.launchReadOnly` |
| `apps/web/e2e/p4-dashboards.spec.ts` | F-DG5-141: test 6 split into 6a (390 px) and 6b (200 % text): same five screens, same assertions, same ten screenshots; per-screen timing annotations; 60 s per half with the measured reason in the comment |
| `apps/web/e2e/p5-dependency-slip-impact.spec.ts` (new) | F-DG5-120 regression (the domain reproduction), on the demo and the plain stack |
| `apps/web/e2e/p5-reader-tables.spec.ts` (new) | F-DG5-122 regression (1280 px, 390 px, 200 % text) |
| `apps/web/e2e/p5-launch-permission.spec.ts` (new) | F-DG5-140 regression (dev.auditor and dev.lead) |
| `apps/web/src/pages/dependencies/slips.test.tsx` (new) | F-DG5-120 unit tests |
| `apps/web/src/pages/playbook/reader-tables.test.tsx` (new) | F-DG5-122 unit tests (real source texts B0003, B0009, B0016, B0024) |
| `apps/web/src/pages/procedures/launch-permission.test.tsx` (new) | F-DG5-140 unit tests |
| `apps/web/src/pages/my-work/message-keys.test.ts` | F-DG5-120: the producer's real params for `portfolio.task.dependency_slip` in the coverage table, and a named test |
| `apps/web/src/api/all-transformations.test.tsx` | The P1/P2 picker test's user now holds `procedure.launch` (it drives the launch form, which is now offered only to launchers); its assertions are unchanged |

## 2. Findings

### F-DG5-120 (Medium, REQ-S12-012): a slip's forecast impact reached no screen

- **Cause.** No web module called `GET /transformations/{id}/dependency-slips`, and `myWork.message.portfolio__task__dependency_slip` did not exist. So `renderMessage` fell back to the generic kind label ("A critical dependency slipped: open the record for details"), and the inbox reminder, which uses the same `messageKey`, fell back to "Task: open the record for details".
- **Fix.**
  - `apps/web/src/pages/dependencies/slips.tsx:28` adds `useDependencySlips`, and `slips.tsx:106` adds `DependencySlipsSection`.
    - There is one row per (slip × affected initiative), with the impact columns first (`slips.tsx:114`): dependency, affected initiative (a link to its page), forecast finish **before → after** (`BeforeAfter`, `slips.tsx:73`; ← in Arabic; the arrow is announced as "changed to"), and forecast change in calendar days (`forecastChangeDays`, `slips.tsx:46`). The remaining columns are slip (calendar days), why critical (icon plus text), needed by, predecessor finish before → after, owner notified, and recorded.
    - A `null` forecast side is the `Unknown` chip, and the change is Unknown unless both dates are known. Nothing is ever shown blank or as 0.
  - Wired in at `DependenciesPage.tsx:119` (first section) and `InitiativePage.tsx:172` (filtered to the initiative, listed in the section nav).
  - The work item text comes from `messageParams` (`en/myWork.json:127`, `ar/myWork.json:127`): it names the dependency, the calendar days late and the affected initiative codes. The day count is written as "calendar days late: N" in both languages because the catalogues have no plural forms, so the text stays correct for N = 1.
  - Contract unchanged; read-only (no mutation, so no audit or concurrency surface).
- **Regression test** (the domain reproduction, `docs/delivery/test-evidence/DG5/domain/round-1/probe/zz-dom-r1-slip.spec.ts`): `apps/web/e2e/p5-dependency-slip-impact.spec.ts`.
  - **Demo stack:** roaming.user.tl moves INI-03's "Partner usage feed…" forecast +5 days through the real API, with the production worker running. The affected owner (roaming.user.sp, found from the slip) then sees, in en and ar:
    - on My Work, the message with DEP-01, 5 and INI-01, and neither the "…open the record for details" fallback nor the inbox "Task: open the record for details";
    - via the work item's `linkPath`, the Dependencies page, with INI-01's forecast before → after exactly as the API recorded it, plus slip days and reason;
    - on INI-01's page, the same.
  - **Plain stack:** a synthetic A → B → C slip, recorded by the API in the PATCH transaction (no worker started, so no other spec's outbox events are consumed); the Dependencies page and B's page are checked.
  - Every null side is checked as Unknown and every known side as the date in the product's own `Intl` format. axe shows no serious or critical issue.
  - Unit: `slips.test.tsx` (8 tests) and `message-keys.test.ts` (+5 tests).
- **Failing before** (fix code reverted to HEAD, tests in place):
  - `03-e2e-demo-before.log`: 2 failed, en and ar, at `expect(main#main).not.toContainText("A critical dependency slipped: open the record for details")` (ar: "تأخرت اعتمادية حرجة: افتح السجل لمعرفة التفاصيل"). The received page text shows the reviewer's observed state, including the inbox's "Task: open the record for details".
  - `02-e2e-plain-before.log`: the plain branch fails, en and ar, with the slips section not found.
  - `01-unit-regression-before.log`: the slip and message-key tests fail.
- **Passing after:** `34-e2e-demo-unset.log` 2/2, `35-e2e-demo-cutf8.log` 2/2, plain stack in §3.
- **Screenshots:**
  - `shots-demo/{en,ar}/p5-rg1-slip-owner-{my-work,dependencies,initiative-INI-01}.png` (full page);
  - `…-{dependencies,initiative-INI-01}-section.png` (the section at full size);
  - `shots/{en,ar}/p5-rg1-slip-{dependencies,initiative}{,-section}.png` (plain stack).
- **Interaction checks run:** the sign-in form, opening the work item's link, the initiative link, a section-scoped axe run per page, and an RTL layout check of the arrow direction (`shots-demo/ar/p5-rg1-slip-owner-initiative-INI-01-section.png`).
- **UX note (fixed in this task):** the first after-fix screenshot showed the impact columns scrolled out of view at 1280 px. I reordered the columns so that dependency → initiative → forecast before → after → change come first, then rebuilt and reran all final checks.

### F-DG5-122 (Low, REQ-S03-010): the reader showed tables as raw Markdown

- **Cause.**
  - `SourceText` (the About panel's B0024 and the Realize note's B0124) printed `textEn` as a paragraph.
  - `excerpt` (block list) and `Snippet` (search results) printed the Markdown as is.
  - `.table thead th { white-space: nowrap }` applied to a one-cell callout table's only cell, so B0016 and B0124 were one unwrapped line clipped at the edge.
  - `<br>` in a cell (B0003) was printed as text.
- **Fix** (`apps/web/src/pages/playbook/ui.tsx`, all React text nodes, no HTML injection):
  - `cellContent` (`:36`): `<br>` becomes an element.
  - `isCalloutTable` (`:48`) and `BlockText` (`:87`): `table--callout` / `data-block-table="callout"`.
  - `plainBlockText` (`:55`): cells joined by "·", rows by ";".
  - `plainSnippetPiece` (`:66`): applied per highlighted piece (`:205`) so the marks stay on the matched words.
  - `SourceText` renders table blocks with `BlockText` (`:136`), in Arabic both the provisional text and the English verbatim.
  - `excerpt` uses `plainBlockText` (`:214`).
  - CSS `app.css:782-789`: block-table headers wrap; the callout cell has `overflow-wrap: anywhere`.
  - The stored verbatim text is unchanged (ADR-0049 §1).
- **Regression test** (the domain reproduction: the reader's B0024 panel and list, `/playbook/reader/B0016` and `/B0124`): `apps/web/e2e/p5-reader-tables.spec.ts`, en and ar, at 1280 px, 390 px and 200 % text.
  - Neither the B0024 panel nor the previews of the source's table blocks (the 49 `<!-- Bnnnn table -->` refs read from `docs/source/playbook.md`) show `|---|`, a cell pipe or `<br>`.
  - Every callout holds the verbatim sentence in one cell that ends inside the viewport; its region does not scroll sideways; the page has no horizontal scroll; axe passes.
  - Unit: `reader-tables.test.tsx` (8 tests, real source texts).
- **Failing before:**
  - `02-e2e-plain-before.log`: failed en and ar (the B0024 panel has no table: `toBeVisible` on the callout).
  - `01-unit-regression-before.log`: all 8 reader-tables tests fail (helpers missing; the panel still had "|"; B0016 not a callout; `<br>` not an element; snippet showed pipes).
- **Passing after:** §3.
- **Disclosed spec defect, fixed before the final runs:** the first after-fix run (`30-e2e-plain-unset-run1-FAILED-spec-defects.log`) failed with "a preview still shows a cell pipe". The cause was B0005's verbatim *prose* "Version 1.0  |  September 2026", which legitimately contains a pipe. I narrowed the check to the source's table blocks; the product was right.
- **Screenshots:** `shots/{en,ar}/p5-rg1-reader-{about,B0016,B0124}-{1280px,390px,200text}.png`.

### F-DG5-140 (Low, REQ-S06-002): the auditor was offered an enabled launch form

- **Cause.** `LaunchSection` rendered the form for every signed-in user.
- **Fix.** `MyProceduresPage.tsx:211`: without `procedure.launch` at any scope (`canAnywhere`, the UI-hint convention of `auth/permissions.ts`), the section shows a `role="note"` read-only banner with a lock icon (`workflowsP5.procedures.launchReadOnly`, en and ar) and no form, combobox or button. Otherwise `LaunchForm` (`:226`, unchanged) is shown.
  - The server stays the backstop: `instances.ts` checks `procedure.launch` and the procedure's launch roles.
  - A user who holds `procedure.launch` but none of a given procedure's launch roles still sees that procedure and gets the server's translated `procedure.launch_role` refusal. The client cannot see role codes (Me has permissions per scope, not roles), so filtering per procedure would need a contract change. That is not done (§4).
- **Regression test** (the QA reproduction `zz-qa-dg5rg1-aud-launch.spec.ts`): `apps/web/e2e/p5-launch-permission.spec.ts`.
  - Test 1, dev.auditor: the note; no form, combobox or Launch button; my steps and instances still render; axe passes. The final assertions are kept: the same launch through the API as the auditor (with CSRF and an Idempotency-Key) is **403**, and **0** instances exist for the transformation.
  - Test 2, dev.lead: the form, an enabled Launch, 201, the instance page opens, 1 instance.
  - Unit: `launch-permission.test.tsx` (L1/L2, en and ar).
- **Failing before:** `02-e2e-plain-before.log`: test 1 failed, en and ar (`toHaveText` on the read-only note: not found, because the form was offered); test 2 passed. `01-unit-regression-before.log`: L1 failed, en and ar.
- **Passing after:** §3.
- **Screenshots:** `shots/{en,ar}/p5-rg1-launch-aud-read-only.png`, `p5-rg1-launch-tl-form.png`.

### F-DG5-141 (Low, REQ-S15-009): p4-dashboards test 6 under full-suite load

- **What is slow (measured).**
  - The QA C.UTF-8 trace (`docs/delivery/test-evidence/DG5/qa/round-1/05-e2e-product-cutf8-p4dash-trace-timing.txt`): 18.1 s of the 30 s in the test's own full-page screenshots, one of them 9.8 s, and no request above 800 ms. It is the test's work, not a slow product response.
  - My runs, alone on a small database: undivided test 6 took 13.9 s (en) and 14.8 s (ar) (`02-e2e-plain-before.log`).
  - After the split, per half (`31-…-timings-unset.txt`, `33-…-timings-cutf8.txt`, per screen: open plus networkidle about 1 s, screenshot 0.1–0.6 s): 6a takes 6.8–7.9 s and 6b 8.9–10.2 s.
  - The full-suite growth (a long finance and My Work page at 390 px and at 200 %) is what turns the screenshots into multi-second steps. **I could not reproduce that load here**: the full suite is not mine to run (D-164).
- **Fix.** Test 6 is split into **6a (390 px)** and **6b (200 % text)**, each with its own budget (`p4-dashboards.spec.ts:353`, `:371`). The screens, assertions (`expectNoPageOverflow`, h1 visible, networkidle) and ten screenshots are identical; nothing is weakened.
  - Each half records the duration of every screen's open and screenshot as a `timing` annotation, so a future slow run names the slow step.
  - Budget: `test.setTimeout(60_000)` per half. Justification, as stated in the spec: the loaded undivided figure is at least 30.1–30.5 s (it was cut at the timeout), so 60 s per half is at least 2× the whole undivided loaded figure and about 4× its half-share.
- **Failing before.** Not reproducible without the full suite (the timeout appears only under full-suite load). The reproduction's evidence is the QA logs cited above. Before the fix, test 6 passed alone at 13.9 / 14.8 s. Its assertions are unchanged after the split.
- **Passing after:** §3 (the whole p4-dashboards spec, 16 tests per run in both projects).

## 3. Checks (real commands, exit codes, counts; logs under `docs/delivery/handbacks/DG5/T-DG5-FE-RG1-evidence/`)

| # | Command / environment | Result | Log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | exit 0, `PASS gate DG4 (historical)` | (console; see §7 for the end run) |
| 1 | `pnpm -r typecheck` | exit 0 | `10-typecheck.log` (final tree; first run `10-typecheck-run1.log`, also 0) |
| 2 | `pnpm -r build` | exit 0 | `11-build.log`. The web package was rebuilt twice afterwards for the e2e runs (ar shadda fix, column reorder): `15-web-rebuild.log`, `16-web-rebuild-2.log`, both exit 0 |
| 3 | `pnpm lint` | exit 0 | `12-lint.log` (final; `12-lint-run1.log` also 0) |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `13-prettier.log` (final; `13-prettier-run1.log` also 0) |
| 5 | `pnpm openapi:lint` | exit 0, `PASS … 846 operations` | `14-openapi-lint.log` |
| 6 | `npx vitest run --project unit-web`, locale unset | **94 files, 1746/1746 passed**, exit 0 | `20-unit-web-unset.log` (final tree) |
| 7 | the same, `LANG=LC_ALL=C.UTF-8` | **94 files, 1746/1746 passed**, exit 0 | `21-unit-web-cutf8.log` (final tree) |
| 8 | plain stack `apps/web/e2e/support/with-stack.sh npx playwright test p5-dependency-slip-impact p5-reader-tables p5-launch-permission p4-dashboards --workers=1`, chromium-en + chromium-ar, locale unset | **24/24 passed**, exit 0 | `30-e2e-plain-unset.log` |
| 9 | the same, C.UTF-8 | **24/24 passed**, exit 0 (attempt 2; attempt 1 hit ENOSPC, below) | `32-e2e-plain-cutf8.log` |
| 10 | demo stack `e2e/support/with-demo-stack.sh npx playwright test apps/web/e2e/p5-dependency-slip-impact.spec.ts --workers=1`, both projects, locale unset | **2/2 passed**, exit 0 | `34-e2e-demo-unset.log` |
| 11 | the same, C.UTF-8 | **2/2 passed**, exit 0 | `35-e2e-demo-cutf8.log` |

Ports used: 23201–23249 only. **Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite are left to the orchestrator's verification on the merged tree. They are not reported as passed.

**Non-zero exits and failures, all disclosed:**

- `01-unit-regression-before.log`, `02-e2e-plain-before.log`, `03-e2e-demo-before.log` are the intended failing-before runs.
- `20-unit-web-unset-run1-FAILED-glossary.log`: 1 failed, a real defect of mine. The new Arabic empty text wrote "التحول" without the glossary's shadda (`glossary.test.ts`). I fixed it ("التحوّل") and the rerun passed.
- `30-e2e-plain-unset-run1-FAILED-spec-defects.log`: 4 failed, both spec defects. The row locator used `has:` with a page-rooted locator, and the reader pipe check was too broad (B0005 prose). I fixed both; the product was unchanged.
- The `*-before-column-reorder` / `run1` / `run2` logs are earlier passing runs on the build before the slip column reorder. They are kept and superseded by the final logs.
- `32-e2e-plain-cutf8.log` (final build, first attempt): 23 passed, **1 failed**: chromium-ar `p5-reader-tables`, at `page.goto('/playbook/reader/B0016')` then `h1` not found, with **`ENOSPC: no space left on device`** in the same error. The shared disk was full (df: 99%, 388 MB free; my temporary outputs were about 80 MB and were deleted). This is an environment failure, not a product or test result. After the cleanup (688 MB free) attempt 2 passed 24/24 (`32-e2e-plain-cutf8.log`); the failed attempt is kept as `32-e2e-plain-cutf8-final-attempt1-FAILED-ENOSPC.log`. The shared disk was still at 99 % when I finished: the orchestrator's merged-tree runs may hit the same limit.

## 4. Contract, schema or dependency needs (for the orchestrator)

- None required for the four fixes.
- Optional, not done: hiding, per procedure, the procedures whose launch roles the user does not hold would need the user's role codes per scope in `GET /me` (or a `launchable` flag on the procedure definitions list, as the methodology links already have). That is a contract change, so it is not made. The server's `procedure.launch_role` refusal remains, translated.

## 5. ADR and data-dictionary statements

- Nothing my fix touches becomes untrue.
  - ADR-0044 §7 amendment ("a dependent whose forward finish cannot be computed is null … and is shown Unknown") is now actually true on a screen. The architect may want to name the screens: the Dependencies page section "Critical dependency slips" and the initiative page section, both over `listDependencySlips`, plus the work item and inbox text from `messageParams`.
  - ADR-0049 §1 (`text_en` verbatim; "a table block keeps the source's Markdown rows") is unchanged: storage is verbatim, and only rendering changed. A sentence could be added: previews and snippets show table cells as text, a one-cell table is rendered as a wrapping callout, and `<br>` is a line-break element.
  - ADR-0042 §4: My procedures offers launch only with `procedure.launch`. This is a UI hint; the server check is unchanged.
- No data-dictionary change (no schema).

## 6. User-facing texts

- No existing text became untrue.
- New en and ar texts (each true for this release):
  - `dependencies.slips.*`: the intro describes exactly the recording rule of `slip-events.ts`: critical path or needed-by missed, owners notified once, Unknown never 0;
  - `myWork.message.portfolio__task__dependency_slip`;
  - `workflowsP5.procedures.launchReadOnly`. The first draft named "a Transformation Lead" as a launcher; I removed that because a procedure's launch roles are configurable, so the text names no role.
- Arabic uses the glossary's "تحوّل" and the existing Dependencies term "مطلوبة بحلول".
- `workflowsP5.procedures.mySummary` ("… and the launch of a published procedure") still describes the page in general; the read-only note says what applies to the reader.

## 7. End of run and what remains

- `node tools/gates/validate.mjs --historical --stage DG4` at the end: `PASS gate DG4 (historical)`, exit 0 (`40-validate-dg4-end.log`).
- `date -u` at the end: `Fri Oct 23 11:35:25 UTC 2026`.
- Temporary outputs were removed: the scratch screenshots, traces and stacks (the harness deletes its databases at teardown). No `test-results/` or `playwright-report/` is left in the tree. The evidence directory is 28 MB, mostly full-page screenshots.
- **Remains:**
  1. The repository-wide `pnpm test`, `pnpm test:integration` and the full product e2e (D-164) are for the orchestrator's merged-tree verification. **Not run here.** In particular, F-DG5-141's fix is proven against the full-suite load only by that run (I measured the halves alone: 6.8–10.2 s each against a 60 s budget).
  2. Each fix is to be recorded with `import-findings --fix` and its merge commit by the orchestrator (D-184/D-185). The findings stay OPEN until round 2 verifies them; an author never closes their own finding.
  3. Optional, not done, needs a contract change (§4): per-procedure launch filtering for users who hold `procedure.launch` but not a given procedure's launch role.
- **Merge notes:** web-only. No migration, no contract, no new dependency. The concurrent T-DG5-BE-RG1 owns `apps/api/**`, `packages/**` and the root `e2e/**`, none of which I edited, so no file conflict is expected. If BE-RG1 changes `worker/handlers/portfolio.ts`'s `messageParams` for `portfolio.task.dependency_slip`, the `{{dependencyCode}}`, `{{slipDays}}` and `{{initiativeCodes}}` placeholders and `message-keys.test.ts`' producer table must follow.
