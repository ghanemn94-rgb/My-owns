# Handback T-DG4-FE-R3 (frontend-ux-engineer): ARCH-R3 adopted in the web app, the G3 submit warning (QA-C O-1), and the ADR-table translation guard (completed by the salvage run T-DG4-FE-R3B)

- **Stage:** DG4 (BUILDING). **Branch / worktree:** `dg4/fe-r3`, `/home/user/wt/dg4-fe-r3`. **Base:** WIP `7a4e4f0` on top of `e3acab1` (D-115).
- **Run:** `DG4-T-DG4-FE-R3B-frontend-ux-engineer-20261010T180842Z-bc69481b` (session `bc69481b-fbf6-4ab8-adf4-f1921d7bfb0a`). **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-R3B.md` (sha256 `0137a9d6…8ed1138f`, verified).
- **Start** `date -u`: Sat Oct 10 18:11:30 UTC 2026. **End:** see §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → exit **0** (`PASS gate DG3 (historical)`), at the start (`evidence/validate-dg3-historical-start.log`) and at the end (`evidence/validate-dg3-historical-end.log`).
- Changes are **uncommitted**, for the orchestrator to integrate. Every demo record in tests and e2e is SYNTHETIC. No product gate (G1–G6) approval was granted; the e2e business approvals are synthetic demo decisions that approve nothing real.

`evidence/` below means `docs/delivery/handbacks/DG4/T-DG4-FE-R3-evidence/`.

## Salvage (D-103; the D-059/D-070 precedent)

I reviewed every file of WIP `7a4e4f0` (32 files) against ARCH-R3 §6 and the contract, ran typecheck, lint and the touched tests on it, and then completed the work. The orphaned transcript was not read or cited.

**Kept as is (reviewed, correct):**
- `lib/problem.ts` `problemText`/`apiProblemText` (params filled into `problems.<code>`; `_noParams` fallback; never a raw brace), and the `businessDate` i18next formatter in `i18n/index.ts`;
- the schedule dialog's read of `getInitiativeSchedule` (`executionApi.ts` `readInitiativeSchedule`; 200 → PATCH with the ETag version, 404 → POST, 409 → re-read, never overwrite) and its 5 unit tests per language;
- `getAssessmentFormVersion` on the record page (`useAssessmentFormVersion`) with "Unknown question", and its 2 tests per language;
- the Finance class-line drill and the net-line inputs (`DashboardsPage.tsx`), the fixtures updated to KBE-R4's `drilldownHref`, the rule and reason keys of rows 187–206 and the `dashboard.value_class_not_applicable` text (row 186);
- `listScaleScopeBusinessUnits` in `GateP4.tsx`, `ScaleRisk.tsx` and `p4api.ts`, and its tests;
- `forumAr` in `MyWorkPage.tsx` `renderMessage`, and its `message-keys.test.ts` cases;
- the extended guard in `problems-slices-hijk.test.ts`, and the `change_request.withdraw_via_approval` EN/AR text it now requires (see item 5).

**Changed (defects found in the WIP):**
- `pnpm lint` failed with 7 errors: an unused `NETWORK` constant and unused `TRP`/`esc` imports in `ScheduleNetworkPanel.test.tsx`; three unused `problemKey` imports (`p4ui.tsx`, `portfolio/common.tsx`, `p3ui.tsx`); and `!=` in `lib/problem.ts` (eqeqeq). All fixed.
- `tsc` failed in `problems-slices-hijk.test.ts:124` (a mistyped `TFunction` wrapper). Fixed.
- `MyWorkPage.tsx`: the `renderMessage` JSDoc had been pushed above the new `isArabicNameOf` helper. I moved it back.
- `ScaleUnitName` said "Business unit not visible" while the units were still loading, and after a failed read. That claims something that is not known. It now shows "Loading…" while pending and "Unknown" on a failed read. "Not visible" is shown only when a successful read lacks the unit. The scope editor also shows a translated note when the unit list cannot be read, so the list is never silently empty.

**Added (missing from the WIP):**
- item 3 (QA-C O-1), with tests in both languages;
- the e2e steps on the real stack;
- the item 7 scan (no screen lists lineage `sources`);
- every acceptance check, run from scratch;
- this handback.

## 1. Changed files (against `e3acab1`)

| File | Purpose |
|---|---|
| `apps/web/src/lib/problem.ts` | `problemText`/`apiProblemText`: `problems.<code>` filled from `problem.params` (ADR-0038 Q1); without params, the `_noParams` text shown before; never a raw placeholder |
| `apps/web/src/i18n/index.ts` | i18next formatter `businessDate` (`{{date, businessDate}}` → `formatBusinessDate` in the text's language) |
| `apps/web/src/i18n/{en,ar}/problems.json` | `gate__modular_waiver_{revoked,expired}` with `{{date, businessDate}}` plus `_noParams` variants (the old texts); `dashboard__value_class_not_applicable` (row 186); `change_request__withdraw_via_approval` (ADR-0036 amendment row, found by the extended guard) |
| `apps/web/src/i18n/{en,ar}/dashboards.json` | rule keys `dashboard.value.sum_{planned,forecast,submitted,validated,measured,rejected,sustained}` (rows 187–193), `dashboard.kpi.*` (201–206), reason keys `dashboard.portfolio.slip_*` (197–200); net-line texts |
| `apps/web/src/i18n/{en,ar}/gates.json` | `submit.coveredNote` (item 3); `scale.unitInactive`, `scale.unitsUnreadable`; `scale.ownUnit` removed (no longer used) |
| `apps/web/src/i18n/{en,ar}/executionP4.json` | `network.duration.versionUnknown` removed (the "learned version" fallback is gone) |
| `apps/web/src/i18n/{en,ar}/adoptionP4.json` | `records.unknownQuestion`, `records.versionUnreadable` |
| `apps/web/src/i18n/i18n.test.ts` | the EN/AR placeholder-parity check also reads the formatted form `{{name, format}}` |
| `apps/web/src/i18n/problems-slices-hijk.test.ts` | the ADR-table guard reads the amendment format too; proves row 186 is caught and the old scan missed it; `params` codes rendered with and without `params` |
| `apps/web/src/pages/actions/ScheduleNetworkPanel.tsx`, `executionApi.ts` (+ test) | item 1: `getInitiativeSchedule` on open; If-Match = its ETag; 404 → create; 409 re-reads; loading/error/retry states |
| `apps/web/src/pages/gates/GateP4.tsx`, `ScaleRisk.tsx`, `p4api.ts` (+ `g5-g6.test.tsx`) | item 3 (ARCH §6 FE-R3 item 3): `listScaleScopeBusinessUnits`; only `selectable` units offered; items and transitions labelled "code + name by locale", inactive labelled; `listBusinessUnits` no longer read there |
| `apps/web/src/pages/gates/GateDetailPage.tsx` (+ `g5-g6.test.tsx`) | QA-C O-1: the submit dialog's warning follows the gate view (`criteria` + `canSubmit`) |
| `apps/web/src/pages/dashboards/DashboardsPage.tsx`, `dashboardFixtures.ts` (+ test) | Finance class lines drill (`valueClass`), net line = "gross − implementation cost" with its two input drills; fixtures follow KBE-R4 |
| `apps/web/src/pages/adoption/RecordPage.tsx`, `api.ts` (+ test) | `getAssessmentFormVersion` labels the answers; "Unknown question" for a key the version lacks or when the version cannot be read |
| `apps/web/src/pages/my-work/MyWorkPage.tsx` (+ `message-keys.test.ts`) | Arabic `{{p}}` takes `params[p+"Ar"]` when non-empty; `…Ar` is never its own placeholder |
| `apps/web/src/pages/my-work/p4ui.tsx`, `portfolio/common.tsx`, `prioritization/p3ui.tsx` | shared problem text through `problemText` (so the waiver date shows on every screen that uses these helpers) |
| `apps/web/e2e/p4-execution.spec.ts` | new step 2b: schedule change with the real ETag; a concurrent change → 409, re-read, no overwrite; next save sends the re-read ETag |
| `apps/web/e2e/p4-gates-closure.spec.ts` | step 2: the G5 submit dialog shows the coverage note, not the refusal (O-1, real stack); step 4: scope units from `listScaleScopeBusinessUnits`, labels "code name"; step 6: the waiver refusal carries `params.date` and the alert shows it localized, not raw |
| `apps/web/e2e/p4-dashboards.spec.ts` | new step 4b: every Finance class line of the real response has a `valueClass` drill; one is opened and its rule is translated; net lines show their inputs |

No route was added, so `router.tsx` is unchanged (FE-R2's `lazyPage` rule is not triggered). I changed no API, shared, contract or migration file (`git diff --stat e3acab1 -- docs/api packages apps/api` is empty).

## 2. Behaviour delivered, per scope item

**No requirement ID is named.** Neither the assignment's repair scope nor `requirements.csv` names a requirement row for FE-R3 (`grep FE-R3 requirements.csv`: no hit). So I report per scope item and quote the binding text of ARCH-R3 §6 instead. The orchestrator may want to map these to register rows.

### 1. ARCH-R3 §6 FE-R3 items 1–7 (each response shape checked against `openapi.yaml`)

The `InitiativeSchedule` (+ ETag), `ScaleScopeBusinessUnitPage {items, nextCursor}`, `AssessmentFormVersion {versionNo, schema, createdAt, createdBy}`, `FinanceValueLine.drilldownHref` and `Problem.params` shapes were read from the contract and match what the screens parse. The server's ETag is `"<version>"` (`platform/http.ts` `etag`), and that is the format the client parses.

1. **Schedule panel:** "read `getInitiativeSchedule` when the dialog opens: 200 → edit with `If-Match` = its `ETag`; 404 → create; remove the 'sends version 1 / learned version' fallback; a 409 still re-reads and never overwrites."
   - Done. The `versionUnknown` text and the learned-version state are removed.
   - The dialog shows a loading state, and a read error with a retry. Save is disabled until the row is read.
   - **Unit tests (en, ar):** 404 → POST with no If-Match; a 409 `initiative_schedule.exists` re-reads, and the next save is a PATCH with the ETag. PATCH If-Match = ETag; a stale 409 re-reads and shows the current value; the next save sends the new ETag. A null-duration row is a change. Plus the read-error/retry case.
   - **e2e (real stack):** `p4-execution` step 2b.
2. **Modular waiver dates:** "pass `problem.params` to the translation of `problems.<code>`; … gain `{{date}}` in EN and AR, rendered as a localized business date; with no `params`, the text is the one shown today."
   - Done, with `{{date, businessDate}}` (the same `formatBusinessDate` as every business date).
   - The guard test allows the placeholder for exactly these two codes and renders them with `params`.
   - **Unit tests (en, ar):** the refusal on the G3 decision dialog with and without `params`.
   - **e2e:** `p4-gates-closure` step 6 asserts `params.date` is in the 422, appears in `detail`, and is shown localized (not as raw `YYYY-MM-DD`).
3. **Scale-scope editor and view:** "read `listScaleScopeBusinessUnits`; offer the units with `selectable: true`; label scope items and transitions by `code`, with `nameEn` or `nameAr` by locale; stop reading `listBusinessUnits` there."
   - Done. An inactive unit is labelled "(inactive)", by text and not by colour.
   - **Unit tests (en, ar):** the organization's `listBusinessUnits` answers 403 in the fixture, so the labels and options can only come from the new read.
   - **e2e:** step 4 checks the offered set equals the `selectable` items, and the label is "code name".
4. **Finance dashboard:** "every class line links its `drilldownHref`; a `net` line shows 'gross − implementation cost' with links to the gross line's drill-down and to `value.investment`, never as a drillable total; EN/AR text for row 186, rows 187–193, rows 197–206."
   - Done. A missing input says "No drill-down for this line" rather than a dead link.
   - **Unit tests (en, ar):** the `valueClass` query of a class drill, the net-line inputs, and all keys of rows 187–206 translated.
   - **e2e:** step 4b on the real response (see §3 for whether class lines existed in the run).
5. **Assessment record page:** "read `getAssessmentFormVersion` for the record's `formVersionNo`, and label answers from it. A key that the version lacks shows the key with 'Unknown question' (never blank)."
   - Done. A failed version read shows a warning, and each key with "Unknown question".
   - **Unit tests (en, ar).**
   - **e2e:** none added. The existing `p4-adoption-bau` spec covers the record page, and it passed in the full run (§3).
6. **My Work:** "in Arabic, a placeholder `{{p}}` takes `params[p + "Ar"]` when it is a non-empty string; a `…Ar` member is never a placeholder of its own; add a `message-keys.test.ts` case for `governance.task.minutes_to_approve`, with and without `forumAr`."
   - Done. The test covers with `forumAr`, without it, with `""` and with `null`, and checks that a blank `…Ar` falls back.
7. **KPI lineage display (if any screen lists `sources`):** **not applicable.**
   - No web screen reads `KpiEvaluation.inputs`. The scan in `evidence/item7-lineage-scan.txt` finds only a fixture file, and no `windowValues` or `.sources` use.
   - The dashboard drill's `calculation.inputs` is a different, ordered array.
   - So there is nothing to sort, and no "not recorded" to show.

### 2. Finance links fixtures (KBE-R4)

`dashboardFixtures.ts`:
- every class line now carries `drilldownHref` with `valueClass`;
- the rejected class line, which assumed `null`, is corrected;
- the gross lines are as before;
- the net line keeps `null`, as the contract says.

No other web fixture or test assumed a `null` class-line href (grep `drilldownHref: null` in web tests: only net lines).

### 3. G3 submit dialog (QA-C O-1)

- **The cause.** The dialog showed "Only N of M mandatory outputs are complete. The submission will be refused…" whenever a mandatory criterion was incomplete. But the dialog opens only when the server's `canSubmit` is true, and the server counts an incomplete mandatory criterion covered today by an accepted exception as not blocking (`gates.ts` `gateView`: `allComplete = missing.every(covered)`).
- **The fix.** It follows the gate view itself, not a client computation:
  - `criteria` gives the incomplete count;
  - `canSubmit` is the server's own answer.
- **What the dialog now shows:**
  - incomplete outputs with `canSubmit: true`: an info note, "1 of 5 mandatory outputs are complete. The other 4 are covered by accepted exceptions, so they do not block this submission; each exception is recorded in the submission." No refusal is predicted.
  - incomplete outputs with `canSubmit: false` (a live view re-read while the dialog is open): the refusal warning, as before.
  - all outputs complete: neither note.
- **The client decides nothing.** The note does not claim the submission will be accepted, because other server checks still apply. For example, A03's `gate.modular_links_missing` refusal is still sent and shown.
- **The Modular waiver** covers the Modular-entry links, which are not criteria and never entered the "N of M" count. So in A03 the misleading text came from the exception-covered criteria, and that is what is fixed.
- **Unit tests (en, ar; End-to-End and Modular):**
  - the covered case shows the note and no refusal;
  - the submission is still sent, and the server's 422 is shown;
  - after the re-read (`canSubmit: false`) the refusal warning appears;
  - when everything is complete, no note is shown.
- **e2e:** `p4-gates-closure` step 2 checks the covered note on the real stack, before the server accepts the G5 submission. Screenshots: `p4-gates-03b-submit-dialog-covered`.

### 4. Routes

No route was added.

### 5. ADR-table guard (ARCH-R3 §7)

- **The change.** `problems-slices-hijk.test.ts` now reads two row formats:
  - the original `| 4xx | \`code\` |`;
  - the amendment format `| \`code\` (at …) | 4xx |`. The second column must be a 4xx status (also `400 field`), so other code-first tables (entities, audit actions, message keys) are not read as refusals. A test pins that matcher on sample rows.
- **Proof for row 186:**
  - the classic scan of ADR-0037 does **not** contain `dashboard.value_class_not_applicable`, and the amendment scan does;
  - with that one key removed from the catalogue, the guard reports exactly `["dashboard.value_class_not_applicable"]`, and the old classic-only scan reports `[]`.
- **A second catch.** The extended scan also found `change_request.withdraw_via_approval`, listed in ADR-0036's amendment table (line 188) and untranslated. It is "accepted until BE-R2, then retired", and the API no longer produces it. I added its EN text (the ADR text) and an AR text, so the guard holds.

## 3. Checks actually run (final tree; logs in `evidence/`)

Environment:
- Node 24.21.0, offline;
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`;
- harness ports 26050–26089 (inside 26050–26099);
- disk checked before each full run: 20–21 GB free.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | PASS gate DG3 (historical) | `validate-dg3-historical-start.log` |
| 1 | `pnpm -r typecheck` | 0 | | `typecheck.log` |
| 1 | `pnpm -r build` | 0 | | `build.log` |
| 1 | `pnpm lint` (re-run on the final tree) | 0 | | `lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All matched files use Prettier code style | `prettier.log` |
| 1 | `pnpm openapi:lint` | 0 | PASS, OpenAPI 3.1.1, 652 operations | `openapi-lint.log` |
| 2 | `pnpm test` (LANG/LC_* unset) | 0 | 145 files / **2771** passed; 3 files / **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 145 files / **2771** passed; 3 files / **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=26070 MTH_PORT_POOL=26071-26089 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 200 files / **1919 passed** (same as D-115; no pinned count changed) | `integration.log` |
| 4 | `E2E_PG_PORT=26050 E2E_API_PORT=26051 MTH_PORT_POOL=26052-26069 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | 0 | **332 passed** (chromium-en 166, chromium-ar 166), 0 failed, 0 flaky, 0 skipped, 37.4 min (load avg 1.87 → 1.98). Was 328 at D-115; +4 = new steps 2b and 4b × 2 languages. No test hit the 30 s timeout | `e2e-full.log`, `e2e-full.json` |
| 5 | `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | PASS gate DG3 (historical) | `validate-dg3-historical-end.log` |

**Unit delta.** Against D-115's 2734, the unit total is +37. The other invocation is unchanged (259 + 2 skipped).

**Intermediate runs, all disclosed:**
- **The WIP as received** failed `pnpm lint` (7 errors) and `tsc` (1 error), as listed under Salvage. Those were not acceptance runs.
- **Targeted e2e** (`evidence/e2e-targeted.log`; `p4-execution`, `p4-gates-closure`, `p4-dashboards`): exit 1, with 34 passed, 2 failed and 4 did not run.
  - The 2 failures were my new step 4b in both languages. It called `GET /api/v1/dashboards/finance` without the required `organizationId` and got a 400. That was a test bug, not a product defect.
  - The 4 that did not run were serial-mode followers of 4b.
  - I changed 4b to read the page's own `getFinanceDashboard` response. The re-run of `p4-dashboards` alone passed 14/14, exit 0 (`evidence/e2e-targeted-dashboards-rerun.log`).
  - In that run, steps 2b, 2, 4 and 6 (the new and changed steps of the other two specs) passed in both languages.
- **The first background typecheck/build wrapper** reported exit 1. Both `pnpm -r typecheck` and `pnpm -r build` printed exit 0; the 1 came from my trailing `tail -3 a b` (invalid tail usage), not from either command.

**Per-spec e2e counts (full run):** per spec, each chromium-en / chromium-ar, all passed:
- journeys 9/9;
- p2-blank-text 9/9;
- p2-journeys 12/12;
- p3-business-cases 6/6;
- p3-g4-refusal 2/2;
- p3-inherited-approval 5/5;
- p3-journeys 18/18;
- p3-portfolio 6/6;
- p3-prioritization-roadmap 7/7;
- p3-seams 3/3;
- p3-ui-completion 7/7;
- p4-adoption-bau 8/8;
- p4-benefits 9/9;
- p4-change-phases 7/7;
- **p4-dashboards 7/7** (incl. new 4b);
- **p4-execution 4/4** (incl. new 2b);
- **p4-gates-closure 9/9** (steps 2, 4, 6 changed);
- p4-governance 8/8;
- p4-kpi 10/10;
- p4-raid-governance 7/7;
- p4-route-splitting 2/2;
- p4-traceability 6/6;
- session-end 5/5.

Computed from `e2e-full.json`.

**Axe:** every `expectAccessible` call in the specs fails a test on any serious or critical issue. The new steps call it on:
- the duration conflict;
- the covered submit dialog;
- the class drill-down, when class lines exist.

So a passing run means 0 serious or critical issues on those screens.

**Finance class lines in the full run:** the 4b annotation (`e2e-full.json`) reads **"7 class, 2 gross, 2 net"** in both languages. So the real-stack class drill-down was exercised: every class line carried `valueClass`, the first was opened (200, `valueClass` in the URL), its rule was translated, and both net lines showed their inputs. In the targeted re-run of `p4-dashboards` alone the database had no class lines, so 4b took its documented empty branch there.

## 4. Operations routed (delta to the pending list)

**None.** FE-R3 is a web task: it routes no API operation and owns no `p4-pending-*.ts` list. Every list is already empty (D-115). The three reads it adopts were routed by BE-R4, and the drill-down by KBE-R4. `contract.test.ts` is unaffected (no API file changed).

## 5. Contract or schema needs (for the orchestrator)

None blocking.

- **Wording note.** `openapi.yaml` `GateView.canSubmit` says "every mandatory criterion is complete". The server, since BE-K2, also counts one covered by an accepted exception (`gates.ts` `gateView`). The O-1 fix relies on the as-built meaning. The description could say "complete or covered by an accepted exception today (ADR-0035 §4)". That is the architect's call; I did not edit the contract.

## 6. Screenshots (visual evidence, both languages)

Under `evidence/screenshots/{en,ar}/`, all from the full run. To keep the repository small, only this task's 10 screenshots are kept; the other full-run screenshots were deleted after their names and SHA-256 were recorded in `evidence/screenshots-full-run-manifest.sha256` (856 files). The targeted run's screenshots were deleted too. The kept ones:
- `p4exec-07b-duration-conflict.png`: the 409 re-read; current value and version shown; the typed value kept;
- `p4-gates-03b-submit-dialog-covered.png`: the O-1 coverage note;
- `p4-gates-06-g5-decision-scope.png`: units from `listScaleScopeBusinessUnits`, "code name";
- `p4-gates-12-g3-approval-refused-waiver-revoked.png`: the refusal with the localized revoke date. I inspected both languages: EN "revoked on 10 Oct 2026"; AR "2026/10/10" in Latin digits, as every other date on the page;
- `p4dash-07b-finance-class-drilldown.png`: a revenue-uplift class line's drill-down, with the translated rule; net lines show their two input links. I inspected the AR one.

## 7. Known gaps / not done

- **Item 7 is not applicable.** No screen lists KPI lineage `sources` (scan in evidence).
- **The "Unknown question" path** of the assessment record page has unit tests only. The real stack never produces a key that is missing from its own version, so no e2e step exercises it.
- **The class-line drill e2e (4b) depends on data.** It opens a drill only if the organization has Finance class lines when it runs. In the full suite it did: 7 class lines, because `p4-benefits` runs first. Run alone, it takes the empty branch.
- **Arabic texts** I wrote (coveredNote, unitsUnreadable, unitInactive, the waiver texts, rows 186–206, `withdraw_via_approval`) are provisional until linguistically reviewed.

## 8. Merge instructions

- **No migration.** Apply nothing.
- **Integrate** the uncommitted tree of `dg4/fe-r3` (on WIP `7a4e4f0`), including this handback and `T-DG4-FE-R3-evidence/`.
- **Conflicts:** none expected with AN-P4A, AN-P4B or QA-D, which do not own `apps/web/**`.
- **Untracked files.** The worktree shows untracked dotfiles at its top level (`.bashrc`, `.gitconfig`, `.idea`, `.mcp.json`, …). They are sandbox artifacts, not mine; do not commit them.
- End `date -u`: Sat Oct 10 19:34:55 UTC 2026 (about 1 h 24 min after the start).
