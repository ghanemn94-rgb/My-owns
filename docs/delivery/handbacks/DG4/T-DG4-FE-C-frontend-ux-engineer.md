# Handback T-DG4-FE-C: P4 slice B screens, benefits and Finance validation (frontend-ux-engineer)

- **Stage:** DG4 (P4 "Execution value and sustainment"), BUILDING. This is an engineering delivery gate only. Nothing here grants or implies a business approval (G1–G6) or a real Finance validation, and no product gate implies any DG gate. All test and demo data is SYNTHETIC. The Finance decisions recorded by the e2e journey (baseline validation, approval, amendment, reversal) are synthetic, in-product demo records that approve nothing real.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-C-frontend-ux-engineer-20261009T210802Z-520bc705","session_id":"520bc705-2806-47eb-becb-5d925f25e5b7"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-C.md`, sha256 `0e5297c8…88585`. I checked it with `sha256sum` at the start, and it matches.
- **Worktree / base:** `/home/user/wt/dg4-fe-c`, branch `dg4/fe-c`, base `HEAD` `7aac2ad`. **Nothing is committed.** The changes are left in the working tree for the orchestrator.
- **Time:** `date -u` at the start was `Fri Oct  9 21:09:46 UTC 2026`. The end time is in §7.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and exited 0 before any implementation. It was re-run at the end (§4).
- **Scope read:**
  - `p4-work-split.md` §1 (S-1…S-14) and §B (B.5 is FE-C's paragraph; B.7 rows);
  - ADR-0029 and ADR-0030 (§11 verbatim), and ADR-0038 §8 (`initiatives[]`);
  - `openapi.yaml` (the 45 slice B operations) and the zod mirrors `schemas/{benefits,benefit-scenarios,benefit-values}.ts`;
  - D-088…D-090, D-101 and D-106;
  - the FE-A, FE-B, KBE-D, KBE-D2, KBE-E and BE-M handbacks.

## 1. Changed files

### Owned: `apps/web/src/pages/benefits/**` and `apps/web/src/pages/finance-validation/**` (all new)

| File | Purpose |
|---|---|
| `pages/benefits/api.ts` | `benefitPaths` holds the request paths of all **45** slice B operations, with the operationId in a comment on each. The read hooks use FE-A's `p4Keys.area(<slice B area>, tid, …)`, so `useP4Refresh(tid)` refreshes every benefit view. `BenefitRegisterRow` adds the optional `initiatives[]` member, which BE-M fills but the zod mirror lacks (§5.3). |
| `pages/benefits/ui.tsx` | The shared kit. `Amount` renders a `BenefitAmount`: known in its own currency, never converted; Unknown as a grey labelled chip with its translated reason; n/a with its long explanation for screen readers; never 0 and never green. Also: `Money`, `Measure`, `Period`, `BDate`, `BenefitRagChip` (label + icon; NULL is Unknown), `StepChip`, `RealizationChip`, `MeasurementStatusChip` (a draft is "Draft – not submitted"), `RecordChip`, `FinanceValidationNote` ("Finance validation … not an engineering delivery gate"), `BenefitSubNav`, and exact decimal share helpers. |
| `pages/benefits/Totals.tsx` | Totals in one block per currency. A table of value class × state with counts. Pending-overlap lines are shown apart. Gross, implementation cost (cash and non-cash) and net. The non-financial n/a count. Excluded benefits with their reason. |
| `pages/benefits/form.tsx` | The profile fields of create and update (ADR-0029 §1):<br>- class options follow the type (REQ-S08-009);<br>- the statement line is shown for financial classes, the KPI and valuation method for non-financial ones;<br>- one owner select;<br>- decimals typed as text and sent as decimal strings;<br>- an edit sends only the changed fields. |
| `pages/benefits/dialogs.tsx` | `SendDialog` for the custom forms (allocation rows, the six Finance items, measurements). It follows the same rules as FE-A's dialog: one form-level alert, a session guard, If-Match, and a 409/422 reload. |
| `pages/benefits/BenefitsPage.tsx` | `/transformations/:id/benefits` shows:<br>- the **T14 register**: the ten columns plus Lifecycle, Initiatives (`initiatives[]`) and "Counted in totals";<br>- status and step filters, plus sort, search, columns and pages through `RegisterTable`;<br>- create benefit;<br>- the totals. |
| `pages/benefits/BenefitPage.tsx` | `/transformations/:id/benefits/:benefitId`:<br>- **profile**, with edit, archive, and the Finance baseline decision (not offered to the owner);<br>- **lifecycle**: six steps with question and output (EN, or AR marked provisional), the missing outputs per step, history, and "Move to …" only for the allowed next steps;<br>- **enablers**: delivered is labelled "an enabler, not proof of realized value";<br>- **allocations**: percent, allocated and unallocated, an editor with a live total and an over-100 % warning;<br>- **values**: the seven states, each with a note;<br>- **measurements**: create, save draft or submit, edit draft, submit. A validated row is "never edited". A provisional basis is labelled;<br>- the overlaps of this benefit. |
| `pages/benefits/MeasurementPage.tsx` | `/transformations/:id/benefit-measurements/:measurementId` shows the measurement with its **lineage**: formula version, calculation record, calculation run, the inputs (variable, KPI actual and value version, value used, period), attribution, assumptions, evidence, submitted and decided by, the Finance item, and the corrected original. |
| `pages/benefits/RegisterPages.tsx` | Four screens:<br>- `/benefit-groups`: list, create, edit and name the counted member. "None named: no member is counted";<br>- `/benefit-overlaps` (status filter, raise) and `/benefit-overlaps/:overlapId` (KBE-D2's work-item link): Finance resolve, not offered to an owner of either benefit;<br>- `/benefit-scenarios`: create, edit and archive; add and edit values, each labelled "<kind> value";<br>- `/benefit-valuation-methods`: propose, and the Finance decision (not offered to the proposer; only the moves `valuationDecisionAllowed` permits). |
| `pages/finance-validation/FinanceValidationPages.tsx` | `/finance-validation` (the organization view):<br>- the queue of every readable transformation, oldest first, with a status filter;<br>- the portfolio totals for `organization.read` holders.<br><br>`/transformations/:id/finance-validations` is the transformation queue. `/transformations/:id/finance-validations/:financeValidationId` is **KBE-E's work-item link**:<br>- the six items with the immutable snapshot content;<br>- the decide dialog (each item accepted or rejected with a note, the overall decision, the approved amount, the note);<br>- amendment and reversal;<br>- the submitter is never offered a decision;<br>- a provisional-basis warning. |
| `pages/benefits/benefitsFixtures.ts`, `pages/benefits/benefits.test.tsx` | 29 unit tests: 1 helper test plus 14 per language (§2). Synthetic fixtures. |

### e2e (new)

| File | Purpose |
|---|---|
| `apps/web/e2e/p4-benefits.spec.ts` | The real-stack journey: 8 tests × 2 projects (§2, §4). Synthetic Business Owner, Finance and Auditor users are created through the admin API, as in FE-A's and FE-B's specs. **Step 6 starts the real worker** (`node apps/worker/dist/main.js`) against the e2e database for that step only, then stops it with SIGTERM (§5.4). |

### Translations

| File | Purpose |
|---|---|
| `apps/web/src/i18n/{en,ar}/benefitsP4.json` (new) | The page namespace. EN and AR have identical key sets (checked by the i18n parity test). The glossary follows the existing files: "سجل المنافع (T14)", "التحقق المالي", "تحوّل" with shadda, and "خط الأساس". Short reference codes inside sentences are wrapped in Unicode isolates (FSI/PDI), so they do not reorder in RTL. |
| `apps/web/src/i18n/{en,ar}/problems.json` | **Append-only:** 70 keys per language at the end of the file. These are every ADR-0029 §11 code (44, plus the `validation` 400) and every ADR-0030 §11 code (19). The other 7 are `benefit.cost_amount_missing` (the ADR-0030 §7 reason) and UI and validation pointers: `validation.share`, `validation.decimal_share_scale`, `validation.decimal_non_negative`, `validation.dimensions_required`, `validation.key`, `validation.max_properties`. The codes KBE-D and KBE-D2 reported were already present from FE-A: `benefit_valuation_method.not_approved`, `benefit_value.period_range`, `benefit_value.value_required`, the three Unknown reasons and `validation.constraint`. They are asserted by my unit test, not re-added. The ADR texts with `{placeholders}` are rendered without parameters, because problem keys take none (ADR-0007). |

### Outside my two folders (each is a minimal edit, disclosed)

| File | Edit | Why |
|---|---|---|
| `apps/web/src/app/router.tsx` | The 4 FE-C entries were removed from `P4_PLANNED_ROUTES` and **11** real routes registered: the 4 planned paths (same paths) plus 7 new ones. The new ones are `benefit-measurements/:measurementId`, `benefit-groups`, `benefit-overlaps`, `benefit-scenarios`, `benefit-valuation-methods`, `finance-validations` and `finance-validations/:financeValidationId`. | The assignment says "swap them in". `finance-validations/:id` is the `linkPath` KBE-E's worker writes on the Finance task (`apps/worker/src/handlers/benefits.ts:255`). Without it, that link would land on "page not found". |
| `apps/web/src/i18n/index.ts` | 2 import lines and 2 catalogue entries register `benefitsP4`. | The FE-A and FE-B precedent. |
| `apps/web/src/pages/my-work/my-work.test.tsx` (FE-A's) | 2 lines. The "planned route shows being built" test now opens `/transformations/:id/raid` (FE-D, still planned) and expects `nav.p4.raid.title`, instead of `/benefits`, which is now built. | The FE-B precedent. The assertion is otherwise unchanged. |
| `apps/web/e2e/p4-governance.spec.ts` (FE-A's) | 1 line. The planned-route step opens `/raid` instead of `/benefits`. | Same reason. |

No file in `apps/api`, `apps/worker`, `packages/**`, `docs/api/**`, `tools/**`, `docs/source/**`, `components/**`, `styles/**`, `app/nav.ts`, any `package.json` or the lockfile changed.

## 2. Behaviour delivered, per requirement row (acceptance text quoted)

B.5 gives FE-C the screens of slice B. Every B.7 row has a backend owner (KBE-D, KBE-D2 or KBE-E), who owns the API behaviour. Below is what the screens render for each row, and how I checked it. "e2e" means the real stack (`p4-benefits.spec.ts`, EN and AR). "unit" means `benefits.test.tsx` (EN and AR).

- **REQ-PB-075**, "A10: T14 persists all 10 columns; realized value awaiting Finance validation is labelled pending and excluded from validated totals".
  - **Register:** the ten T14 columns are Benefit (code and title), Type (type and class), Baseline (value, unit, Finance state), Target, Value (SAR), Realized, Owner, Evidence, Status and Lifecycle. Initiatives and Counted follow them.
  - **Realized** shows validated, sustained and pending as three separate labelled amounts, each with its count. Pending carries the label "Pending Finance validation: not counted as validated".
  - **Checks:**
    - unit: column headers; the `data-part` amounts; the pending label;
    - e2e step 5: after submit, validated `0.0000` and pending `250000.0000`, with the label (`p4ben-10-register-pending`);
    - e2e step 6: after the Finance approval, validated is `240000.5000`.
- **REQ-PB-076**, "A10: a CX benefit saved with Value n/a is excluded from SAR totals and not counted as zero".
  - Value (SAR) `not_applicable` renders "n/a", with the screen-reader text "excluded from SAR totals, never counted as zero".
  - The totals show "Non-financial benefits without a valuation method: N — Value n/a: excluded from SAR totals, not counted as zero".
  - A financial benefit without a planned value shows "Unknown (The planned value is Unknown for this financial benefit.)", never 0.
  - Checked by unit (the n/a cell contains no 0; Unknown with its reason) and e2e step 3 (`p4ben-06-register`).
- **REQ-PB-074**, "A04;A10;A11: a benefit cannot enter Measure without the Plan outputs; Sustain requires a BAU owner and control cadence".
  - The six steps each show their question and output from the server: verbatim English, or the provisional Arabic marked "Provisional Arabic translation of the playbook text".
  - Each step lists what it still misses (baseline, formula, target, owner, enabler, recovery plan, BAU owner, control cadence).
  - "Move to …" is offered only for `LIFECYCLE_MOVES[current]`. The server's 422 codes are translated.
  - **Checks:**
    - unit: six steps; Plan's question and output; the AR provisional flag; Measure lists "at least one enabler"; only "measure" is offered from Enable;
    - e2e step 1: the UI creates a benefit with the Plan outputs and moves it Identify → Plan → Enable. Measure shows the missing enabler (`p4ben-02-…`). After an enabler is linked, it moves to Measure (`p4ben-03-…`).
  - Sustain's missing outputs (BAU owner, control cadence) render the same way: the fixture has them, but the unit test asserts only Measure's. The e2e journey does not drive Sustain.
- **REQ-S08-013**, "A10: allocations 60% + 50% are rejected; 60% + 30% saves and shows 10% unallocated".
  - The allocation editor sends exact fractions with If-Match. It shows a live "Allocated … unallocated …" line and warns "Above 100 %: this will be refused".
  - **e2e step 2:**
    - 60 + 50 gives one form alert with `data-problem="benefit_allocation.over_100"` and the translated text, and the API confirms nothing was saved (`p4ben-04-…`);
    - 60 + 30 saves, and "Unallocated 10 %" is shown (`p4ben-05-…`).
  - unit: the PUT body is `[{share:"0.6"},{share:"0.4"}]` with If-Match `"3"`. A 422 gives exactly one alert.
- **REQ-PB-058**, "A10: a benefit with two owners is rejected; a 10 million SAR benefit shared by two initiatives appears once …".
  - The owner is a single select, so the UI cannot send two owners.
  - The register shows the benefit once, with both allocated initiatives named (e2e step 3: `data-initiatives='2'`).
  - The allocations section says totals count the benefit once, never its allocations. The totals are the server's, and their arithmetic is KBE-E's.
- **REQ-PB-013**, "A10;A12: a Business Owner calling the validate endpoint receives 403; a Finance user succeeds and the audit event records validator identity".
  - Decide is offered only to `finance.validate` holders. A 403 is translated.
  - **e2e step 6:** the synthetic Finance user approves in the UI, and the item shows "Decided by" equal to that user (`data-decided-by` = the FIN user's id; `p4ben-14-finance-approved`).
  - The audit event itself is KBE-E's test.
- **REQ-S08-015**, "A10;A12: a validation lacking a measurement period is rejected; a non-Finance user gets 403".
  - The decision dialog lists the six items (baseline, attribution and counterfactual, calculation, evidence, measurement period, assumptions). An undecided item is left out of the body, so the server answers 422 `finance_validation.content_incomplete`, which is translated (unit).
  - The auditor sees no decide or amend (unit; e2e step 8).
  - The submitter sees "You submitted this value, so you cannot validate it" and no decide button (unit).
- **REQ-S08-016**, "A10: submitting a measurement leaves the validated total unchanged; approval increases it by exactly the approved amount".
  - **e2e steps 5 and 6:** the measurement is recorded and submitted with evidence through the UI. The validated series stays `0.0000` and submitted is `250000.0000`.
  - Finance approves `240000.5`, after which the register's validated amount and the totals' revenue uplift validated line both show `240000.5000` (`p4ben-15-register-validated-totals`).
- **REQ-S08-017**, "A07;A10: an in-place edit of a validated value returns 409; a reversal nets the total and both records remain visible".
  - A validated measurement offers no edit ("Validated: never edited"). A 409 `benefit_measurement.validated_immutable` is translated, with `data-state="conflict"` (unit).
  - **e2e step 6:**
    - an amendment to `239500` leaves the original validated and adds a linked row; validated becomes `239500.0000` (`p4ben-16-amendment`);
    - a reversal nets validated to `0.0000` with all three rows still visible (`p4ben-16b-reversal-all-visible`).
- **REQ-S12-014**, "A10;A13: submitting benefit evidence creates exactly one item in the Finance validation queue; replaying the same event creates no second item".
  - **e2e step 6:** with the real worker running, the queue holds **exactly one** item for the benefit. The organization queue `/finance-validation` lists it (`p4ben-11-finance-queue`).
  - The replay half is KBE-E's worker test.
- **REQ-S07-014**, "after an accepted KPI actual, the linked benefit shows a pending amount and the validated total is unchanged". Display side only: a `kpi_recalculation` pending measurement renders like any submitted one ("from a KPI recalculation", pending, labelled). The worker path is KBE-E's. The e2e journey drives a manual measurement, not a KPI-fed one.
- **REQ-S08-001**, "a forecast amount never appears in the validated total; a rejected measurement is retained and shown as rejected". The values table shows the seven states apart, each with a note ("Forecast — an estimate; never validated", "Rejected — kept visible"). Rejected measurements stay in the list with "Rejected by Finance" (code path only; no test drives a rejection).
- **REQ-S08-002**, "completing the enabling deliverable leaves realized value unchanged at zero validated and marks the benefit 'enabled - not yet measured'".
  - The realization chip reads "Enabled, not yet measured (not realized value)". A delivered enabler is labelled "an enabler, not proof of realized value".
  - Before Measure, the measurements section says "Measurements start at Measure: a delivered enabler is not realized value" (unit).
- **REQ-S08-003**, "a financial benefit without a financial-statement mapping, or a non-financial one without an agreed KPI, is rejected". The statement line is required in the form for financial classes. The KPI field is shown for non-financial ones. The server's `benefit.mapping_required` and `benefit.kpi_required` are translated.
- **REQ-S08-006**, "a benefit value drills to the formula version, input actual versions and rates used …". The measurement page shows the formula version, calculation, run, and each input with its KPI actual and **value version** and the value used (unit with a two-input lineage; e2e step 8, `p4ben-24-measurement-lineage`). Drill-down links lead from the values table, the measurement list and the Finance item.
- **REQ-S08-008**, "with an unvalidated comparison basis the result is labelled provisional and excluded from validated totals". `basis: "provisional"` is labelled "Provisional basis" in the list and the values. The measurement page and the Finance item carry the long explanation (unit). In e2e step 4, Finance validates the baseline first in the UI (`p4ben-07-baseline-decision`).
- **REQ-S08-009 / REQ-S08-011 / REQ-S08-014.**
  - The totals show separate lines for revenue uplift, margin, cash saving, avoided cost, working capital and valued non-financial.
  - Gross, implementation cost (cash and non-cash) and net are each Unknown with the reason `benefit.cost_amount_missing` when the server says so, never 0 (unit).
  - Values of benefits with an open overlap are in a separate "Pending overlap" warning, outside validated and sustained. Overlap screens list and resolve warnings, and the register flags "Open overlap warning: excluded …" (unit).
- **REQ-S08-010**, "entering a SAR value on a CX benefit without an approved method is rejected". The valuation-method screen supports propose and the Finance decision (approve, reject, retire). Only approved methods are offered on a benefit. The 422 codes are translated.
- **REQ-S08-018**, "upside scenario values never appear in the realized or validated totals".
  - Every scenario value is labelled "<Upside scenario> value".
  - **e2e step 7:** an upside value of 7 777 777 is added in the UI, labelled with its kind. It appears neither in the register totals nor in `getBenefitTotals` (`p4ben-17-scenario-labelled`).
- **S-7.**
  - One form-level alert per dialog (unit asserts exactly one).
  - Every action runs inside `beginSessionGuard()`. Navigation uses `useSessionNavigate`.
  - Read-only users see the frame's single read-only note and no write control (e2e step 8; unit). The duplicate section notes appear only when the user holds some other benefit write permission.
  - The Finance actions are labelled "Finance validation … not an engineering delivery gate", never DG0–DG7 (unit and e2e assert `/\bDG[0-7]\b/` is absent).
- **S-6 / S-11.** Every ADR-0029 §11 and ADR-0030 §11 code is translated in both languages, and every Arabic text contains Arabic letters (unit).
- **390 px and 200 % text** (e2e step 8):
  - the register and the benefit page at 390 px wide, and at 200 % root font size, have no page-level horizontal scroll (`scrollWidth − innerWidth ≤ 1`). Tables scroll inside their own labelled region;
  - axe reports 0 serious or critical issues at 390 px;
  - screenshots `p4ben-25…28`.

## 3. Operations routed (pending-list delta)

FE-C has **no** `p4-pending-fe-c.ts` or `p4-exercises-fe-c.ts`. All 45 slice B operations were routed by KBE-D, KBE-D2 and KBE-E: `p4-pending-kbe-{d,d2,e}.ts` are empty at base `7aac2ad`. **Delta: none.** `contract.test.ts` is untouched.

The web client now **calls 42 of the 45** (paths in `benefitPaths`). It does not call these three:

- `getBenefitGroup` and `getBenefitScenario`: their lists carry the same records;
- `updateBenefitPlanValue`: see §5.1.

## 4. Checks (real exit codes; logs in `docs/delivery/handbacks/DG4/T-DG4-FE-C-evidence/`)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (no browser installed). Harness ports: e2e PG 24904, API 24905, integration PG 24903, with `MTH_PORT_POOL=24910-24949`. The development e2e run used 24901/24902. Empty `.claude/.cc-writes` and `.claude` directories inside source folders were removed before the test runs. Free disk was 21–22 GB before each full run. Start and end times are in `run-times.txt`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | clean (re-run after the last source edit) | `typecheck.log` |
| 1 | `pnpm -r build` | 0 | all packages | `build.log` |
| 1 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean. The **first** run exited 1, disclosed below. | `lint.log`, `lint-first-run-exit1.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" This was the **last** check, run after this handback was written. | `prettier.log` |
| 1 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 645 operations` (unchanged) | `openapi-lint.log` |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | invocation 1: 122 files, **2342 passed**; invocation 2 (`unit-formula-nocodegen`): 3 files, **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same: **2342**; **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=24903 MTH_PORT_POOL=24910-24949 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 155 files, **1564/1564**, equal to D-108. **No pinned count changed.** | `integration.log` |
| 4 | `E2E_PG_PORT=24904 E2E_API_PORT=24905 MTH_PORT_POOL=24910-24949 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | 0 | **228 passed** (114 chromium-en + 114 chromium-ar; D-108 had 212, plus my 16), 0 failed, 0 flaky, 20.5 min. Axe gave 0 serious or critical issues on every `expectAccessible` page (a violation fails the test). | `e2e-all.log`, `e2e-per-spec-counts.txt` |
| 5 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)`, at the start and at the end | `validate-dg3-historical.log` |

Unit delta: 2313 (D-108) → 2342, i.e. +29, which is exactly `benefits.test.tsx`.

**Per-spec e2e counts (final full run; `e2e-per-spec-counts.txt`):**

| Spec | chromium-en | chromium-ar |
|---|---|---|
| `journeys.spec.ts` | 9 | 9 |
| `p2-blank-text.spec.ts` | 9 | 9 |
| `p2-journeys.spec.ts` | 12 | 12 |
| `p3-business-cases.spec.ts` | 6 | 6 |
| `p3-g4-refusal.spec.ts` | 2 | 2 |
| `p3-inherited-approval.spec.ts` | 5 | 5 |
| `p3-journeys.spec.ts` | 18 | 18 |
| `p3-portfolio.spec.ts` | 6 | 6 |
| `p3-prioritization-roadmap.spec.ts` | 7 | 7 |
| `p3-seams.spec.ts` | 3 | 3 |
| `p3-ui-completion.spec.ts` | 7 | 7 |
| `p4-benefits.spec.ts` | 8 | 8 |
| `p4-governance.spec.ts` | 8 | 8 |
| `p4-kpi.spec.ts` | 9 | 9 |
| `session-end.spec.ts` | 5 | 5 |

**Disclosed non-zero exits and failures (all fixed, none open):**

1. **`pnpm lint`, first full run, exit 1** (`lint-first-run-exit1.log`). An unused `ReadOnlyNote` import was left in `BenefitPage.tsx` after I removed a duplicate read-only note. I removed the import, then re-ran typecheck, build, lint, prettier and openapi lint: all exit 0.
2. **Unit development runs** (in the console; logs not kept):
   - 6 of my new tests failed on their first run, from assertion details: a text matched twice, a leading space before the icon, and a rule text that is in the section intro. I fixed the assertions; the behaviour did not change.
   - FE-A's planned-route test then failed twice (en, ar) because `/benefits` is now built. It was retargeted (§1).
3. **e2e development run** (`p4-benefits.spec.ts` alone, before the final full run; screenshots in `$TMPDIR`, not kept): 16/16 passed. After it I made four changes, all covered by the final full run:
   - the short Unknown chip no longer breaks mid-word;
   - reference codes are wrapped in Unicode isolates for RTL;
   - `dir="auto"` on user free text;
   - the duplicate read-only notes were removed.
   I also added the reversal step to step 6.

**Screenshots** (`T-DG4-FE-C-evidence/screenshots/{en,ar}/p4ben-*.png`, 29 per language, from the final full run):

- 01 create benefit; 02 lifecycle at Enable with the missing enabler; 03 lifecycle at Measure;
- 04 allocations 60 + 50 refused; 05 allocations with 10 % unallocated;
- 06 register (n/a, initiatives); 07 Finance baseline decision;
- 08 measurement form; 09 measurement pending; 10 register pending;
- 11 organization Finance queue; 12 Finance item with the six items; 13 Finance decide; 14 approved;
- 15 register and totals validated; 16 amendment; 16b reversal with all rows visible;
- 17 scenario value labelled; 18 auditor register; 19 auditor Finance item;
- 20 groups; 21 overlaps; 22 valuation methods; 23 transformation queue; 24 measurement lineage;
- 25 and 26 at 390 px; 27 and 28 at 200 % text.

**Interaction checks actually run (e2e, real API):**
- create through a dialog with dependent fields;
- lifecycle moves;
- linking an enabler;
- the allocation editor (refused, then saved);
- the Finance baseline decision;
- a measurement with an evidence checkbox, submitted at once;
- the worker-created queue item;
- the six-item decision;
- an amendment and a reversal;
- a scenario and its value;
- the auditor's read-only views;
- 390 px and 200 % text with no page overflow.

## 5. For the orchestrator (contract, schema and ownership notes)

1. **Contract need: a plan value's version is not readable.**
   - `updateBenefitPlanValue` needs If-Match. The only read of plan values is `getBenefitValues`, whose `BenefitValueLine` has `recordId` but no `version`.
   - The UI therefore offers **add** for planned and forecast values but **not edit**. I did not guess a version.
   - **Request (KBE-E / ARCH-03):** add `version` to `BenefitValueLine` for `benefit_plan_value` rows, or add a `GET …/benefits/{id}/plan-values` list.
2. **No organization-level Finance queue operation.**
   - `listFinanceValidationQueue` is per transformation. `/finance-validation` (FE-A's planned route) therefore lists the caller's readable transformations and fetches each queue (N requests, bounded by `fetchAllPages`). An unreadable queue is reported in a warning, not hidden.
   - Fine for the demo scale. An organization queue operation would be the scalable form, as a later contract decision.
3. **Zod mirror `benefitRegisterRow` lacks `initiatives[]`.** BE-M reported this (its §2.1). The web types it locally (`pages/benefits/api.ts`) and needs no zod change. The one-line mirror fix stays with KBE-D's file owner.
4. **The e2e stack has no worker.**
   - `with-stack.sh` (frozen) starts none, so `p4-benefits.spec.ts` step 6 spawns `node apps/worker/dist/main.js` with the harness's own environment (the same `DATABASE_URL` as the API). It waits up to 90 s for the queue item, then sends SIGTERM and waits for exit.
   - While it runs, the worker also relays any pending outbox events left by earlier specs. That is a few seconds of real background processing, and every later spec creates its own transformation.
   - If the orchestrator prefers the worker in the harness itself, this step can drop its spawn.
5. **Unplaced message key (not my file).** KBE-E's Finance task uses `messageKey` `benefits.task.finance_validation_review` (params `benefitCode`, `periodStart`, `periodEnd`). `myWork.json` (FE-A's) has no `myWork.message.benefits__task__finance_validation_review`, so My Work shows the kind fallback "Finance validation to review". It is not wrong, but it is less specific. Suggested EN: "Validate the benefit value of {{benefitCode}} for {{periodStart}} to {{periodEnd}}". `kpi.downstream.benefit` is already in FE-B's `kpiP4.json`. Codes I could not place: none other.
6. **Discoverability.**
   - The benefit screens use `WorkspaceFrame tab="business-cases"`, because the frame accepts only registered tabs. There is no "Benefits" workspace tab or nav sub-entry, and `components/Workspace.tsx` and `app/nav.ts` are FE-A's.
   - The screens are reached through their own sub-navigation, the work-item links and direct paths.
   - **Suggested one-line merges:** `{ id: "benefits", path: "/benefits", labelKey: "benefitsP4.nav.register" }` in `WORKSPACE_TABS`, `moreWorkspaceTabs: ["benefits"]` on the `benefits` area, and a `NAV_SUBPAGES` entry "Benefits and Finance > Finance validation" → `/finance-validation`.
7. **Semantics I rendered as the server gives them** (for the domain reviewer):
   - an empty state is `{status:"known", amount:"0.0000", count:0}` (ADR-0030 §7), so the totals table shows "SAR 0.00 · Benefits: 0" for a state with no values. Unknown is reserved for missing inputs;
   - the "Planned" totals column reads the plan-value series, not the benefit's `plannedValue` field, so a benefit with a `plannedValue` but no plan-value rows shows Value (SAR) 10 M in the register and Planned 0.00 (count 0) in the totals. That is KBE-E's definition; I did not change it.

## 6. Known gaps / not done

- **Plan value edit** is not offered (§5.1).
- **Not driven in e2e:** the Sustain and Correct moves, an overlap raised by rule and its Finance resolution, the valuation-method decision, a Finance rejection, and a KPI-fed pending value. Their screens are covered by unit tests or shown read-only in e2e (overlaps, methods). The server behaviour belongs to KBE-D, KBE-D2 and KBE-E.
- **Initiative-level totals** (`getBenefitTotals?initiativeId=`) are wired in `useBenefitTotals`, but no screen offers the initiative filter yet.
- **Parent/child benefits** (`parentBenefitId`) are not exposed in the profile form. Groups are.
- **Evidence links** in a measurement show the count and lead to the transformation's evidence register, not to each item.
- **Discoverability** (§5.6).

## 7. Merge instructions

- Apply the working-tree changes of `apps/web/**`, plus this handback and its evidence. There are no migrations, and nothing in `apps/api`, `apps/worker` or `packages/**` changed.
- Expect conflicts only with another FE task that edits `router.tsx` (`P4_PLANNED_ROUTES` and route list), `i18n/index.ts`, or the end of `problems.json`. Resolve by union (append-only).
- The untracked top-level dotfiles and `CLAUDE.local.md` were mounted by the sandbox. They are not mine; do not integrate them.

**End:** `date -u` = `Fri Oct  9 22:40 UTC 2026` (about 1 h 40 min).
