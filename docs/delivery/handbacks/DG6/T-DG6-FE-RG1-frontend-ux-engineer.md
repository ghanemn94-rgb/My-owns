# Handback: T-DG6-FE-RG1 (frontend-ux-engineer)

- **Stage:** DG6 (P6 "Integration and system hardening"), FIXING after clean re-gate review round 1.
- **Findings:** F-DG6-900 (Low, non-mandatory; REQ-S15-014). Also the assistant withheld notices made untrue by F-DG6-920 (REQ-S17-007; T-DG6-BE-RG1 handback §8).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-FE-RG1-frontend-ux-engineer-20261110T135045Z-52f30bb8","session_id":"52f30bb8-9b59-4776-942e-ef71532693c4"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-RG1.md` (sha256 `6acc7b5e…6e1961b`, verified at start).
- **Base:** branch `dg6/fe-rg1`, HEAD `4769c3902`, clean tree at start.
- **Time:** started 2026-11-10T13:50:57Z, ended 14:22:29Z (about 32 minutes).
- **State:** changes are left **uncommitted**, as instructed.
- **Data:** all of it is synthetic. Nothing here is a business, Finance or IT approval (G1–G6), and nothing relates to any DG0–DG7 decision.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/i18n/en/explanations.json` | E2 column `benefitRealized.basis`: "Basis" → "Comparison basis". Values `basisKind.validated`: "Validated" → "Baseline and formula version validated by Finance"; `basisKind.provisional`: "Provisional" → "Provisional: baseline or formula version not validated by Finance". |
| `apps/web/src/i18n/ar/explanations.json` | The same keys: "الأساس" → "أساس المقارنة"; "معتمد" → "خط الأساس وإصدار المعادلة تحققت منهما المالية"; "مؤقت" → "مؤقت: خط الأساس أو إصدار المعادلة لم تتحقق منه المالية". These reuse the app's existing Finance terms (`benefitsP4.measurements.basisValidated`: "أساس المقارنة تحققت منه المالية"; `provisionalLong`). |
| `apps/web/src/i18n/en/assistant.json` | `reply.withheld` and `suggestion.withheld`: "… cites a record …" → "… was based on a record you can no longer read, so it is hidden." |
| `apps/web/src/i18n/ar/assistant.json` | The same two keys, using the wording proposed in BE-RG1 §8: "استندت هذه الإجابة إلى سجل …" and "استند هذا الاقتراح إلى سجل …". |
| `apps/web/src/components/explanation/explanation.test.tsx` | New unit test, en and ar: "a pending line's comparison basis is named as such, never a bare 'Validated' (F-DG6-900)". |
| `apps/web/e2e/p4-benefits.spec.ts` | Test 5 (pending measurement on the real stack) now opens the E2 panel. It checks the pending table's column header and its row's basis value (catalogue words), and that the pending total is SAR 250,000.00. It adds a full-page and a panel screenshot, plus an axe check. |

No other file in the product changed. `panels.tsx` needed no code change: the column and values come from the catalogue keys above.

## 2. Behaviour delivered

### REQ-S15-014

**Acceptance:** "A05;A20: the weighted score and benefit realized value show plain-language explanations in en and ar; non-admin screens show no stack traces or infrastructure terms".

**F-DG6-900, item 1.** In `BenefitRealizedExplanation`, the third column of every group table now says what it holds:
- the heading is "Comparison basis" / "أساس المقارنة";
- each value names the baseline and formula version and says whether Finance validated them, or that they are provisional;
- a row under "Pending Finance validation (not realized)" no longer carries a bare "Validated" / "معتمد". It reads "Baseline and formula version validated by Finance".

Values, totals and states are unchanged. The pending total is still kept apart from the validated total; both the unit test and the e2e assert it.

**Item 2: other panels.** I checked every panel in `apps/web/src/components/explanation/panels.tsx`:
- E2 is the only one that shows the measurement `basis` field.
- E4 (NPV/ROI/payback) uses `launchHealthP5.finance.basisKind.${periodBasis}`. That is a different field, the period basis (annual/quarterly/monthly), and its words are already true, so it is unchanged.
- E1 and E5 have no basis column.
- Outside the panels, the benefit page and measurement page already say "Comparison basis validated by Finance" / "Provisional basis" (`benefitsP4.measurements.*`), so they are unchanged.

**Screenshots:**

| | en | ar |
|---|---|---|
| Panel only | `docs/delivery/handbacks/DG6/T-DG6-FE-RG1-evidence/screenshots/en/p4ben-09c-explanation-panel.png` | `docs/delivery/handbacks/DG6/T-DG6-FE-RG1-evidence/screenshots/ar/p4ben-09c-explanation-panel.png` |
| Full page | `docs/delivery/handbacks/DG6/T-DG6-FE-RG1-evidence/screenshots/en/p4ben-09b-explanation-pending-basis.png` | `docs/delivery/handbacks/DG6/T-DG6-FE-RG1-evidence/screenshots/ar/p4ben-09b-explanation-pending-basis.png` |

I inspected the panel-only screenshots:
- en is LTR and ar is RTL.
- The pending row shows "SAR 250,000.00 | Baseline and formula version validated by Finance" (ar: "250,000.00 ر.س. | خط الأساس وإصدار المعادلة تحققت منهما المالية").
- The validated and sustained groups show "No value yet" with a "?" badge, never 0.

### REQ-S17-007

**Acceptance:** "A12: with a user scoped to X, an assistant query about Y returns no Y content; every answer lists cited record IDs and versions".

**Item 4.** After F-DG6-920, an answer or suggestion is also withheld when a record that was *given* to the model, but not cited, becomes unreadable. The notices now say "was based on a record you can no longer read" (en and ar), which is true whether the record was cited or only given.

I searched the repository for web tests that assert the old text (`git grep`, excluding delivery records). None assert it literally. `assistant.test.tsx:376` reads the text from the catalogue with `t("assistant.reply.withheld")`, and it passes with the new text. No e2e asserts it.

## 3. Checks actually run

Environment: Node 24.21.0, offline, ports 31450–31499 only, Chromium from `/opt/pw-browsers`. Logs are in `docs/delivery/handbacks/DG6/T-DG6-FE-RG1-evidence/`.

| # | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (at start, before any edit) | 0 | `PASS gate DG5 (historical)` | `00-validate-historical-DG5-start.log` |
| 0b | the same, at the end | 0 | `PASS gate DG5 (historical)` | `00-validate-historical-DG5.log` |
| 1 | **Before the fix:** `npx vitest run src/components/explanation/explanation.test.tsx` (apps/web; new test, old catalogue) | **1, expected** | 2 failed / 18 passed. en: `expected 'Basis' to be 'Comparison basis'`; ar: `expected 'الأساس' to be 'أساس المقارنة'` | `01-unit-before-fix.log` |
| 2 | **After the fix:** `npx vitest run src/components/explanation/explanation.test.tsx src/components/assistant/assistant.test.tsx` | 0 | 2 files, 46/46 passed | `02-unit-after-fix.log` |
| 3 | `pnpm -r build` | 0 | all packages built (the exit line was echoed by the invoking shell and appended to the log) | `10-build.log` |
| 4 | `pnpm -r typecheck` (re-run after the last spec edit) | 0 | | `11-typecheck.log` |
| 5 | `pnpm lint` | 0 | | `12-lint.log` |
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (re-run at the end) | 0 | | `13-prettier.log` |
| 7 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `14-openapi-lint.log` |
| 8 | `pnpm test` with LANG/LC_ALL/LC_CTYPE/LANGUAGE **unset** | 0 | unit-node 191 files / 2904 tests passed; unit-web 125 files / 2113 passed; unit-formula-nocodegen 3 files / 259 passed + 2 skipped | `30-pnpm-test-locale-unset.log` |
| 9 | `pnpm test` with `LANG=LC_ALL=C.UTF-8` | 0 | the same counts: 2904; 2113; 259 + 2 skipped | `31-pnpm-test-c-utf8.log` |
| 10 | `E2E_PG_PORT=31450 E2E_API_PORT=31460 MTH_PORT_POOL=31461-31499 E2E_SCREENSHOT_DIR=… apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p4-benefits.spec.ts --workers=1` (real stack; chromium-en and chromium-ar) | 0 | 18/18 passed (2.7 min) | `20-e2e-p4-benefits.log` |
| 11 | the same, after adding the panel screenshot | 0 | 18/18 passed (2.4 min); test 5: 8.6 s en, 8.6 s ar | `21-e2e-p4-benefits-rerun.log` |

Notes on these checks:
- **Skips (rows 8–9):** the 2 skipped tests are `it.skipIf(NOCODEGEN)` in `packages/shared/src/formula/fuzz.test.ts` (:600, :833). They are skipped by design in the no-codegen project; I didn't cause them.
- **Integration tests:** not run, because there is no API change (as the assignment allows).
- **Interactions in the e2e:** the disclosure button is pressed with Playwright `click`, the pending table is found by its region's accessible name (the caption), and axe reports 0 serious or critical issues on the opened panel in both locales.
- **Budget:** the spec isn't new. Test 5 runs within the file's measured 210 s budget (`test.setTimeout(210_000)`, F-DG6-144 / T-DG6-FE-Z1B). The added steps took the test to 8.4–8.6 s at load about 1.2. I took no new loaded measurement because the budget is already over 20× this.
- **Domain probe not re-run:** `zz-domain-demo-probe.spec.ts` is reviewer evidence, not part of the candidate. `p4-benefits.spec.ts` test 5 covers the same panel on the real stack.
- **Housekeeping:** before the tests I removed two empty `.claude/.cc-writes` directories (`apps/web/.claude/`, and the evidence `screenshots/.claude/`) created by the session tooling. I deleted the screenshots the spec writes for its other steps, keeping only 09b/09c.

## 4. Operations routed

None. The pending-list delta is empty: no API route, schema, migration or contract changed.

## 5. Contract, schema or dependency needs

None.

## 6. User-facing texts made untrue

| Text | Status |
|---|---|
| `explanations.benefitRealized.basis` / `basisKind.*` (en and ar) | This is the finding itself; corrected as in §1. |
| `assistant.reply.withheld`, `assistant.suggestion.withheld` (en and ar) | Made untrue by F-DG6-920 (BE-RG1 §8); corrected as in §1. |

My work made no other text untrue.

## 7. What remains, and known gaps

- **No screenshot of the assistant withheld notice.** No in-repo e2e reaches the withheld state: it needs a grant revoked after an answer exists. The change is verified only by the unit render in `assistant.test.tsx` (the `[data-withheld]` notice reads the catalogue key). So the visual-evidence rule is not met for this string-only change.
- **Arabic wording not reviewed by a native speaker.** The new Arabic strings follow the existing Finance terms and the BE-RG1 proposal, but no native Arabic reviewer has checked them.
- **Merge:** no migration and no ordering constraint. Six files changed; a conflict is possible only if another task edits the same catalogue keys or `p4-benefits.spec.ts` test 5.
- **F-DG6-900 is still OPEN.** It closes only through a reviewer's verification sidecar; I didn't edit `findings.json`.
