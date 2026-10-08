# Handback T-DG3-FE-C: business cases and the T09 benefit-formula builder (frontend-ux-engineer)

- **Stage:** DG3 (P3 "Mobilization and portfolio"), BUILDING. Engineering delivery gate only. Nothing here grants or implies a business approval (G1–G6). The Finance validations in the screens and in the e2e are product features exercised with SYNTHETIC users and grants. No real Finance approval was given.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-FE-C-frontend-ux-engineer-20261008T010900Z-c348f17d","session_id":"c348f17d-dde9-49be-bb43-4d113364298d"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-FE-C.md`, sha256 `9f289c22…06fdef7e` (verified with `sha256sum` before starting).
- **Worktree / base:** `/home/user/wt/dg3-fe-c`, branch `dg3/fe-c`, base `HEAD` `e14993e7f682f405dbabca8b21250d5c227a7a20`. Nothing is committed: the changes are in the working tree for the orchestrator to integrate.
- **Time:** `date -u` gave 2026-10-08 01:09:09 UTC at the start and 02:07:01 UTC after the last check, about 58 minutes. The run ended inside the 100-minute budget, and all three scope items are delivered.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` gave `PASS gate DG2 (historical)`, exit 0, before implementation and again at the end (`T-DG3-FE-C-evidence/validate-dg2-historical.log`).
- **Write scope:** I wrote only:
  - `apps/web/src/pages/business-cases/**` and `apps/web/src/pages/benefit-formulas/**`;
  - `apps/web/src/i18n/{en,ar}/{businessCases,benefitFormulas}.json`;
  - `apps/web/e2e/p3-business-cases.spec.ts`;
  - this handback and its evidence.

  I changed nothing in `apps/api`, `apps/worker`, `packages`, `apps/web/src/{app,api}/**`, `i18n/index.ts`, other tasks' folders, any `package.json` or the lockfile.
- **Housekeeping:** empty `.claude/.cc-writes` harness directories appeared in source folders. I removed only the empty ones before the final tests.
  - The untracked top-level dotfiles (`.bashrc`, `.idea`, `CLAUDE.local.md` and others) were already present at the start and are not mine. I left them alone.

## 1. Changed files

| File | Purpose |
|---|---|
| `pages/business-cases/BusinessCasesPage.tsx` | **Replaces the stub; export unchanged.** It shows the business-case register (sort, filter, pagination, column choice, "show archived"), with level, initiative, transformation case, Finance baseline state, section completeness, Draft status and last update. Its create dialog handles the transformation case first and then initiative cases, which link to it. It also exports `CASE_WRITE_PERMISSIONS` and `CompletenessChip`. |
| `pages/business-cases/BusinessCasePage.tsx` | **Replaces the stub; export unchanged.** The page has a summary, the Finance baseline validation, the ten-section form, totals and lines. The section form uses `useVersionedSave` (If-Match, only changed fields, blank-text rule, 409 `ConflictPanel`), with a read-only view for those who can't edit. |
| `pages/business-cases/CaseLines.tsx` | Investment and benefit line tables, plus the add/edit dialog. The dialog picks **one** class from **one** select, offers only the value bases allowed for that class and handles the amount, FTE, period, recurrence, formula link and owner. Archiving uses the shared `ArchiveAction`. A 409 opens a conflict panel with re-apply or discard. |
| `pages/business-cases/CaseTotals.tsx` | Shows gross benefits, implementation cost (cash and non-cash) and net value **separately**, per currency, with breakdowns by class and by value basis. A missing total shows Unknown and a partial total says how many lines it leaves out. It also shows the roll-up note with links to the included cases, the non-financial count and translated warnings. |
| `pages/business-cases/finance.tsx` | `FinanceStateChip` shows Validated, Rejected, **Stale** or Not validated, each with an icon and text. `FinanceValidationDialog` records the "business approval" with a required decision and note and sends If-Match. |
| `pages/business-cases/formKit.tsx` | Translates problem codes from my namespaces, then falls back to `lib/problem.ts`. Also holds `FormAlert` (the single live region), `splitProblem` (maps pointers to fields), `isDecimalText` and `Money` (exact decimal, 2 fraction digits, Unknown for null). |
| `pages/business-cases/api.ts` | Query hooks on `p3Keys` (`businessCases`, `businessCase`, `businessCasePart`), plus initiative options under this feature's own key. |
| `pages/benefit-formulas/BenefitFormulasPage.tsx` | **Replaces the stub; export unchanged.** Shows the T09 register with the six columns, version, preview, Finance validation and status, and the create dialog. Also shows the two B0087 example cards, marked illustrative, with engine previews and an "use this example" action. Exports `ConfidenceChip`, `IllustrativeMarker` and `FORMULA_WRITE_PERMISSIONS`. |
| `pages/benefit-formulas/BenefitFormulaPage.tsx` | **Replaces the stub; export unchanged.** Has the T09 row edit (`useVersionedSave`, 409 panel) and archive, the builder and the versions table with Finance validation per version. Also lets you record a preview calculation and shows its lineage table. |
| `pages/benefit-formulas/FormulaBuilder.tsx` | The live builder: `evaluateFormula` from `@mth/shared/calc` runs on every keystroke. It shows the translated error with its **position** (`<mark>` at the engine's code-point offset), a "declare variable" shortcut, the result type and the preview. It has a typed variable editor and saves a new version with If-Match. A 409 opens the conflict panel. |
| `pages/benefit-formulas/values.tsx` | Converts percent and percentage-point entries to fractions with decimal.js (`toStored`, `toEntry`). Display uses `displayNumber` with the **suffix translated by i18next**, plus the "per {{period}}" text. `engineProblemText` renders the engine's code and params in the UI language. |
| `pages/benefit-formulas/api.ts` | Query hooks on `p3Keys` (`benefitFormulas`, `benefitFormula`, `benefitFormulaPart`, `benefitFormulaExamples`). |
| `i18n/{en,ar}/businessCases.json`, `i18n/{en,ar}/benefitFormulas.json` | All strings, including the problem texts in `<ns>.problems.*` and the engine messages. EN and AR have identical key sets. `stub.*` is removed. |
| `pages/business-cases/business-cases.test.tsx` (new) | 18 unit tests (9 EN, 9 AR), stubbed API. |
| `pages/benefit-formulas/benefit-formulas.test.tsx` (new) | 18 unit tests (9 EN, 9 AR), stubbed API. |
| `pages/business-cases/problem-codes.test.ts` (new) | 4 tests: every kpi, T09 and engine code plus every formula kind is translated in EN and AR. |
| `apps/web/e2e/p3-business-cases.spec.ts` (new) | Real-stack e2e: 6 tests per project, including AUD and axe. |

## 2. Screens and requirements

**Business cases**, `BusinessCasesPage` and `BusinessCasePage`. These cover REQ-PB-053 (ten sections, one class per line), REQ-PB-054 (transformation case, lighter initiative cases, roll-up) and REQ-S05-005 (totals, each distinct line once).

- **"The transformation case with all ten source sections. Initiative cases are lighter and link to it."**
  - The form has ten numbered fieldsets in B0085 order (`data-section`).
  - Each section is marked required or "optional for this case": all ten for a transformation case, and sections 1, 4, 5, 6, 7 and 9 for an initiative case (`INITIATIVE_CASE_SECTION_CODES`). Sections in `missingSections` carry a "Missing" chip.
  - The create dialog disables "Transformation case" once one exists. An initiative case needs an initiative without an active case.
  - The detail page links the initiative case to its transformation case and its initiative.
- **"Lines with exactly one class."**
  - One `<select>` lists only the classes of the chosen kind (5 investment or 5 benefit classes). The body carries a single string `class` (unit test asserts this). The class can't change after creation.
  - The value-basis select is limited to `VALUE_BASIS_BY_CLASS`, so revenue uplift stays apart from margin and avoided cost apart from cash savings. `lineClassProblem` mirrors the server check before sending.
  - Strategic or non-financial lines have their amount disabled and show "Not monetised".
- **"Amounts are SAR decimals, and the currency is configurable."**
  - The case currency defaults to the transformation's currency, which is SAR in the seed. Lines take a currency, and totals are per currency.
  - Amounts are typed as decimal strings, checked by `moneyDecimal` and shown through `formatDecimal` with 2 fraction digits. No `Number()` or `parseFloat` touches an amount.
- **"Gross benefits, implementation cost and net value are shown separately; net is Unknown without both sides. The roll-up counts each distinct line once."**
  - The three totals are shown side by side. Net carries the note "shown next to both, never instead of them" and is Unknown when null (unit test).
  - The transformation case shows "Roll-up of this case and N initiative case(s), by reference" with links.
  - e2e: capex 1,250,000.50 plus the initiative case's internal FTE line of 400,000 gives a cost of SAR 1,650,000.50. Net is SAR 1,349,999.50 against a gross of 3,000,000.00, in EN and AR.

**Finance validation of the baseline** (REQ-PB-055).

- **"It is a business approval held by FIN; the author can't validate."**
  - The action is labelled "Record Finance validation (business approval)" / "تسجيل التحقق المالي (موافقة عمل)", and the dialog says it is a business approval and not a delivery approval.
  - The action is offered only with `finance.validate`, to someone who is not the case's `created_by`. The author sees the separation-of-duties note instead.
  - A server 403 `finance.validator_is_author` is translated, and the English detail isn't shown (unit test).
  - There is no "on behalf of" control.
- **"The state shows Validated, Rejected or Stale after a baseline edit, never green when stale."**
  - Stale is a `status-chip--stale` with a clock icon and the text "Stale: changed after Finance validation", plus an explanatory note. Validated is the only "on-track" state.
  - e2e: FIN (a synthetic grant) validates, the lead then edits the baseline, and the chip reads Stale and is asserted not to be on-track. In edit mode a warning before saving says the edit will make the validation Stale.

**Benefit formulas**, `BenefitFormulasPage` and `BenefitFormulaPage`. These cover REQ-PB-056, REQ-PB-057 and REQ-S08-007.

- **"The T09 register's six columns, with Confidence H/M/L."**
  - The six columns are Benefit, Baseline driver, Change assumption, Formula (the current version's expression), Ramp and Confidence. Confidence shows High (H), Medium (M) or Low (L) with an icon; missing is Unknown.
  - The register adds version, preview, Finance validation and status columns.
- **"The formula builder."**
  - It runs `evaluateFormula` (which calls `validateFormula`) from `@mth/shared/calc` on every change, inside a polite `role="status"` region.
  - Invalid input shows the translated engine message (code plus params, in AR as well) and marks the position with `<mark>` at the engine offset.
  - Valid input shows the result type and the preview, and Unknown with its reason for missing input or division by zero.
  - Saving is blocked client-side while the check fails: `aria-invalid`, focus moves, nothing is sent.
  - Undefined variable and period mismatch are covered in the unit tests (EN and AR). The period mismatch is also covered in e2e.
- **"Typed variables have a kind, a unit, a currency and a period."**
  - Each variable has kind, period, value, unit (or currency for the currency kind) and source.
  - A fraction or percent change is entered as "Value (%)" and a fraction difference as "Value (percentage points)". `toStored` divides by 100 with decimal.js, so 13 is sent as `"0.13"` (asserted in a unit test). `toEntry` reverses it.
  - A fraction difference displays as "2 percentage points" / "2 نقطة مئوية", using `displayNumber`'s suffix code translated by i18next (`benefitFormulas.suffix.*`).
- **"The two B0087 examples, marked 'Illustrative calculation, synthetic values'. Instantiate them, and show their previews: 100000 SAR and 500000 SAR per year."**
  - Both cards carry the marker. Their previews come from the engine run on the examples' own values: `data-example-preview="100000"` / `"500000"`, shown as "SAR 100,000.00 per year" and "SAR 500,000.00 per year". In AR they read "100,000.00 SAR لكل سنة" and the 500,000 equivalent. This is asserted in the unit tests and in e2e.
  - "Use this example in the register" posts `fromExample` and opens the new row. The row stays marked illustrative.
- **"Versions, preview calculations with their lineage, and Finance validation of each version (business approval, never the author)."**
  - The versions table shows Current, expression, result type, preview, author and the Finance state.
  - Validation is "Record Finance validation (business approval)" with If-Match set to the version's own `version`. The author sees a note instead, and the 422 `validation_final` is translated.
  - "Record calculation" uses the version's values as inputs (fractions as percent) together with assumptions and a period. Its lineage table shows inputs with their source, period, assumptions, engine version, rounding and Unknown with a translated error code.
  - e2e: version 2 is saved by the lead, previewed at SAR 150,000.00 per year, and validated by FIN.

**Shared rules applied.**

- **Mutations:** every mutation calls `useP3Refresh(tid)` with `if (!(await refresh())) return;` and takes its session-bound guard from `auth/sessionBound.ts` directly. There is no raw `navigate` or `setQueryData`.
- **Forms:** each has one `role="alert"` region (`FormAlert`) and inline field errors linked through `aria-describedby`. Blank-text input is refused as `validation.blank` and nothing is sent. Creates send a stable `Idempotency-Key` per dialog, and edits send If-Match.
- **Auditor:** AUD sees read-only views. e2e checks the four screens: no enabled form control outside table sorting, filters, pagination and the version picker.
- **Branding:** no DG0–DG7 text appears (asserted in e2e), and `#0078FF` is untouched.

## 3. Checks actually run (Node 24.21.0, offline, worktree `dg3/fe-c`)

Logs are in `docs/delivery/handbacks/DG3/T-DG3-FE-C-evidence/`.

| Check | Command | Exit | Result |
|---|---|---|---|
| Historical DG2 | `node tools/gates/validate.mjs --historical --stage DG2` | 0 | `PASS gate DG2 (historical)`, at the start and the end |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log` |
| Build | `pnpm -r build` | 0 | `build.log` |
| Lint | `pnpm lint` | 0 | `lint.log` |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log`. I ran it again after writing this handback; see the note below the table. |
| Contrast | `pnpm --filter @mth/design-tokens run check:contrast` | 0 | `contrast.log` |
| Unit tests, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | **1** | 66 files, **1267 passed, 8 failed**. All 8 failures are FE-A0's stub assertions on my four routes; see §4.1 (`test-locale-unset.log`). |
| Unit tests, C.UTF-8 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | Same: 1267 passed, the same 8 failed (`test-c-utf8.log`) |
| e2e, locale unset | `env -u LANG … QA_PG_PORT=23600 E2E_API_PORT=23601 MTH_PORT_POOL=23610-23649 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | **84 passed, 2 failed, 2 did not run** (7.9 min). The failures and skips are all in `p3-seams.spec.ts`; see §4.1 (`e2e-locale-unset.log`). |
| e2e, C.UTF-8 | the same command with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **1** | **84 passed, 2 failed, 2 did not run** (6.9 min), the same `p3-seams.spec.ts` items (`e2e-c-utf8.log`) |

The prettier check was run again after the handback and its evidence were written. Its result is appended to `prettier.log` and stated in §6.

**My new tests:**

- `business-cases.test.tsx`: 18
- `benefit-formulas.test.tsx`: 18
- `problem-codes.test.ts`: 4

That is 40 tests, all passing in both locale settings, with half of each suite in EN and half in AR.

**e2e counts per spec and project.** These are identical in both settings:

| Spec | chromium-en | chromium-ar |
|---|---|---|
| `p3-business-cases.spec.ts` (new) | 6 passed | 6 passed |
| `journeys.spec.ts` | 9 passed | 9 passed |
| `p2-journeys.spec.ts` | 12 passed | 12 passed |
| `session-end.spec.ts` | 5 passed | 5 passed |
| `p2-blank-text.spec.ts` | 9 passed | 9 passed |
| `p3-seams.spec.ts` (FE-A0, not mine) | 1 passed, 1 failed, 1 did not run | 1 passed, 1 failed, 1 did not run |

**axe:** 17 screens per language were checked: lists, details, dialogs, stale, conflict, builder, validated and the four AUD views. There were 0 serious or critical issues (`screenshots/{en,ar}/axe-summary-p3-business.json`).

**Earlier dry runs of my spec, disclosed.** The logs are `e2e-p3-business-dryrun-{1..5}.log`, all run with the locale unset.

1. **Dry run 1:** axe `color-contrast` failed on the links inside the blue info banner of the roll-up note. Fix: the note became plain text.
2. **Dry run 2:** axe `scrollable-region-focusable` failed on the example cards' variable tables. Fix: the tables became a list.
3. **Dry run 3:** the builder was keyed by the current version number, so the refresh after a save remounted it and dropped the "saved" confirmation. Fix: key it by id, and take If-Match from the live row prop. The T09 row editor is now keyed by id and version, which avoids a self-inflicted 409 after a new version.
4. **Dry run 4:** the calculation section stayed pinned to version 1 after version 2 became current. Fix: it follows the current version unless the reader picks another. The API's fixed English lineage source label is now translated.
5. **Dry run 5:** 12 of 12 passed.

**Interaction checks actually run in e2e, real stack, EN and AR:**

- creating the transformation case;
- filling and saving sections;
- adding a capex line and a revenue line through the dialog, with the value basis limited to 2 options;
- reading the totals before and after an initiative case is added by API;
- FIN validating the baseline through the dialog;
- the lead's baseline edit, after which the state is Stale;
- a concurrent API edit, giving the 409 conflict panel, then Discard;
- checking both example previews;
- instantiating the revenue example;
- switching `arpu` to monthly, which shows the period-mismatch message with `<mark>`, then back to yearly;
- entering 13% to get a live preview of 150000, then saving version 2;
- recording a calculation (SAR 150,000.00 per year in its lineage);
- FIN validating version 2;
- AUD visiting the four screens with no write requests sent.

**Screenshots:** `apps/web/e2e/screenshots/{en,ar}/p3-business-*.png`, 17 per language. That directory is git-ignored, so copies from the final C.UTF-8 run are in `T-DG3-FE-C-evidence/screenshots/{en,ar}/`. The files are:

- `p3-business-cases`
- `p3-business-case-detail`
- `p3-business-case-line-dialog`
- `p3-business-case-finance-dialog`
- `p3-business-case-validated`
- `p3-business-case-stale`
- `p3-business-case-conflict`
- `p3-business-formulas`
- `p3-business-formulas-examples`
- `p3-business-formula-builder-mismatch`
- `p3-business-formula-detail`
- `p3-business-formula-validated`
- `p3-business-aud-cases`, `p3-business-aud-case`, `p3-business-aud-formulas`, `p3-business-aud-formula`

## 4. Seam and contract mismatches

1. **FE-A0's seam tests assert the stub on my routes, but I am not allowed to edit them.** This is the cause of every failure in §3.
   - `apps/web/src/app/p3-seams.test.tsx` is in the forbidden `apps/web/src/app/**`. Its "stubs (en/ar)" cases expect `data-state='being-built'` on all twelve P3 routes. Replacing my four stubs, as the assignment requires, necessarily fails 4 × 2 = 8 of them.
   - `apps/web/e2e/p3-seams.spec.ts` (not in my Own list) does the same for its page loop and its area-entry test. The first fails at `business-cases`, so the serial follow-up test doesn't run.
   - FE-A and FE-B will hit the same problem for their own rows.
   - **Proposed fix (not applied):** `T-DG3-FE-C-evidence/proposed-p3-seams-fe-c.patch`. It drops my four rows from the stub checks, keeps the route-wiring checks for all twelve routes, and skips the being-built check after the "Benefits and Finance" entry link.
   - `git apply --check` passes on this base. I ran a temporary copy of the patched unit test from my own folder (imports adjusted, then deleted): **26 of 26 passed**.
   - I did **not** run the patched e2e spec. That check is not done.
2. **No `problems.*` texts exist for the P3 kpi codes,** and `problems.json` is not mine. I translate them from `businessCases.problems.*` and `benefitFormulas.problems.*`, with a fallback to the shared catalogue (`formKit.tsx`).
   - Exception: the shared `ArchiveAction` / `ReasonDialog` use `errorMessage` only. For `business_case_line.already_archived` and `benefit_formula.in_use` on archive they show the translated generic 422 text instead of the specific one. Moving these codes into `problems.json`, or giving `ReasonDialog` a message hook, would fix it. Both files are outside my scope.
3. **Untranslated server data:** the API writes the fixed English lineage `source` "Calculation input (overrides the version value)" (`kpi/calculations.ts` `OVERRIDE_SOURCE`). The web recognises that exact string and translates it. A code would be more robust and is a backend follow-up.
4. **There is no `GET` for one line** (`/business-cases/{id}/lines/{lineId}`). To show the "current values" after a 409 on a line, the dialog reloads the case's line list.
5. **No dev Finance user is seeded.** The e2e grants a synthetic `FIN` role to `dev.office` on its own transformation through `POST /role-assignments` (the same pattern P2 uses for SP). `dev.office` also holds TO, which includes `business_case.edit`.

## 5. Not done and known gaps

- `pnpm test` and the full `apps/web/e2e` run do not exit 0, only because of the FE-A0 seam assertions in §4.1. The orchestrator or FE-A0 must apply the proposed patch, or an equivalent, when integrating.
- **Not done in this task:** BE-E flows (capacity, funding, G4). This task does not exercise any of them in unit tests either. The business-case screens show no funding or G4 controls, and none was required here.
- A funding decision on a case is not offered. "Decision ask" is captured as section 10 text and types only.
- The audit-trail translations for the P3 business-case and formula events on the transformation overview were not added. That file is `transformations.json`, which is not mine.
- **Layout polish:** the line tables in the detail page are dense at 1280 px (the title column wraps), although they are usable and axe-clean.

## 6. Merge instructions

- No migrations, no dependency, API or contract changes.
- Merge `apps/web/src/pages/{business-cases,benefit-formulas}/**`, `apps/web/src/i18n/{en,ar}/{businessCases,benefitFormulas}.json` and `apps/web/e2e/p3-business-cases.spec.ts`.
- **Apply `proposed-p3-seams-fe-c.patch`, or the equivalent, in the same integration,** together with FE-A and FE-B's equivalents for their rows. Without it, the two seam suites fail as described.
- **Expected conflicts:** none. The files are disjoint from FE-A and FE-B. `BenefitFormulasPage.tsx` imports `../business-cases/finance.tsx` and `formKit.tsx`, both FE-C files.
- **Order:** rebuild (`pnpm -r build`) before the e2e, because `with-stack.sh` serves `apps/web/dist`.
- **Final prettier:** after this handback was written, `prettier --check` over the whole tree was run again. Its result is appended to `T-DG3-FE-C-evidence/prettier.log`.
