# Handback T-DG5-FE-F (frontend-ux-engineer): the slice G and H screens

- **Stage:** DG5 (P5, BUILDING). **Task:** T-DG5-FE-F, p5-work-split §G and §H, the FE-F row of p5-plan §5.1.
- **Invocation:** `DG5-T-DG5-FE-F-frontend-ux-engineer-20261016T162535Z-7b388879`, session `7b388879-bf03-4b54-b240-c2bfcebdd35f`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-F.md`; its sha256 `6855577f…c238` was verified at the start.
- **Base:** branch `dg5/fe-f` at `f534d20`. The changes are **uncommitted**, as asked.
- **Time:** started 16:25:52Z (`date -u`); the handback was written at 18:09Z (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` at the start: **exit 0**, `PASS gate DG4 (historical)`.

Product gates G1–G6 are business approvals inside the product. Nothing here grants one, and nothing reads or writes DG0–DG7. All test and screenshot data is SYNTHETIC.

## 1. Changed files

### New: the seven screens and their clients (FE-F ownership)

| File | Purpose |
|---|---|
| `apps/web/src/pages/launch-plan/LaunchPlanPage.tsx` | The 90-day launch plan (REQ-PB-086, REQ-S14-004). It has a nav entry with a transformation picker. With no plan, it shows the B0133/B0134 template and a generate form (start date; calendar days; non-working days flagged, never shifted). With a plan, it shows the facts, the start-date change (If-Match; "last shift" shown) and the tasks by window. Each task has dates, a non-working-day warning chip, owner, status chip, **"Blocked by #n …"** or "After …", and its required output. A status filter, the task editor (status, owner, dates; If-Match), the predecessor set (PUT, If-Match) and "add a custom task" complete the screen. |
| `apps/web/src/pages/launch-plan/api.ts` | Paths, query keys and read hooks of the 12 `launch-plans`/`day-90-tests` operations. |
| `apps/web/src/pages/launch-plan/ui.tsx` | Shared FE-F UI. It includes the `launchHealthP5` runner (FE-D's guarded runner with this namespace's alert) and the **"Complete (n/total)" / "Incomplete (n/total)"** chip. It also has the **"Not computable"** chip, the provisional-translation note, notices, the transformation picker and today in Asia/Riyadh. |
| `apps/web/src/pages/day-90-test/DayNinetyTestPage.tsx` | The Day-90 leadership test (REQ-PB-087). The six questions are verbatim from the API rows (B0136–B0141). Yes/No, a comment and suggested evidence (links, never answers) are saved per question with If-Match of the test. Completion shows "Incomplete (n/6)". Complete sends If-Match. A completed test is read-only. With no test (404), the screen says "No Day-90 test yet". |
| `apps/web/src/pages/health-check/HealthCheckPage.tsx` | The health check (REQ-PB-091, PB-092, S14-001, S14-002). The nav entry has a picker. Assessments are tracked over time (number, date, status, completion, score, band, scheme version). "Start a health check" is offered when no draft exists. One assessment shows the 25 verbatim questions, answered with the responses its scheme allows plus an evidence note (If-Match). **"Incomplete (24/25)"** shows no score and no band (never 0). Score "17 / 25" and the band range with its verbatim text follow. The **scoring-assumption notice** is shown when `scoringAssumption`. The top 3 actions are rank, text, owner and due date. Submit sends If-Match. A submitted assessment is read-only. |
| `apps/web/src/pages/health-check/api.ts` | Paths, keys and hooks of the 10 `health-checks` operations. |
| `apps/web/src/pages/health-check/fef.test.tsx` | 23 unit tests in en and ar (§3). |
| `apps/web/src/pages/health-schemes/HealthSchemesPage.tsx` | The health-check scoring schemes (REQ-S14-003). It lists the published versions, their responses and credit, score basis, bands (source or admin origin) and the assumption notice. The rule note says partial credit or N/A needs its own bands and that existing assessments keep their version. A link leads to the Playbook Studio, where new versions are drafted and published (FE-B's screens). |
| `apps/web/src/pages/kpi-restatement/KpiRestatementPages.tsx` | KPI restatement (REQ-S07-016). The **prospective-by-default notice** comes first. The list per KPI and the create form follow: approved version (active/superseded), closed periods of the KPI's frequency, and reason. The detail screen is also the `kpi_restatement_to_decide` work-item link `/transformations/:id/kpi-restatements/:restatementId`. It shows the reconciliation, labelled "preview" for a draft and "retained" once submitted. A side that is not `ok` shows Unknown/Stale/Not computable/No value with no number, and the difference only appears when both sides are ok. The requester can submit or withdraw (If-Match). The **decision** (approve/reject + note; a business-approval note; If-Match) is only for a holder of `kpi_restatement.approve` who is not the requester. Others see "awaiting decision". After approval, the reissue offers link to the report snapshots. |
| `apps/web/src/pages/kpi-restatement/api.ts` | Paths, keys and hooks of the 8 `kpi-restatements` operations. |
| `apps/web/src/pages/formula-preview/FormulaPreviewPage.tsx` | The formula preview (REQ-S08-005). It previews the formula's current version, or its seeded B0087 example when the formula comes from one, with both offered when both exist. The unit is kind/currency/period: the revenue-uplift total is **"SAR · per year"**, and `unitLabel` ("per customer") is never shown (D-156 i). Examples and edge cases (zero/missing/negative) appear, and non-computable outcomes show **"Not computable"** with the translated reason (e.g. `formula.missing_input`), never 0. A note says nothing is stored. |
| `apps/web/src/pages/financial-metrics/FinancialMetricsPage.tsx` | Optional NPV/ROI/payback (REQ-S08-019). The page carries the **"Extension, not a playbook requirement"** label. The organization settings show on/off, methodology, timing, period basis and discount rate. The switch is shown with `financial_metrics.enable` and the assumptions form with `financial_metrics.define`, both sent with If-Match (version 0 creates). Metrics per business case show a status chip. NPV/ROI/payback are shown, or their reason ("Not shown: no discount rate", "Not computable", "Not reached"), never 0, and each row names its assumptions. A cash-flow editor per case works in the case currency, one row per period index from 0, with If-Match/"0". |
| `apps/web/src/pages/financial-metrics/api.ts` | Paths, keys and hooks of the 8 `formula-previews`/`financial-metrics` operations. The preview is a side-effect-free POST read through `useQuery`. |
| `apps/web/src/i18n/{en,ar}/launchHealthP5.json` | The new namespace: every FE-F text in en and ar (same key set; Arabic uses the glossary spelling التحوّل). |
| `apps/web/e2e/p5-launch-health-kpi.spec.ts` | Playwright against the real API: 3 tests × en/ar (§3). |
| `packages/shared/src/schemas/day-ninety.ts` | BE-P2's Day-90 zod mirrors, **promoted unchanged** (D-159 d). `completion` is exported as `dayNinetyCompletion` to avoid a generic name in the barrel. |

### Modified (shared files; append-only where the rule says so)

| File | Change |
|---|---|
| `apps/web/src/app/router.tsx` | 10 lazy pages and 10 routes appended in an FE-F block. Two of them are nav entries (`playbook/launch-plan`, `playbook/health-check`). The **new** route `transformations/:id/kpi-restatements/:restatementId` is the backend's work-item link, which had no route before. The 7 FE-F rows were removed from `P5_PLANNED_ROUTES`, and FE-F is filtered out of the P5_SUBPAGES placeholder mapping (the FE-B/C/D precedent). |
| `apps/web/src/app/nav.ts` | AREA_CONTENTS playbook "guidance": `p5: ["launchPlan","healthCheck"]` ("not available yet") became delivered links (F-DG4-160). The `healthSchemes` sub-entry was appended under Administration (hint `methodology.read`). |
| `apps/web/src/i18n/{en,ar}/nav.json` | `nav.sub.healthSchemes` appended. |
| `apps/web/src/i18n/index.ts` | The `launchHealthP5` namespace registered (3 appended lines per block). |
| `apps/web/src/i18n/{en,ar}/problems.json` | +37 keys appended. They cover all of ADR-0047 §8 (12 `kpi_restatement.*`, 2 `financial_metrics.*`, 2 `financial_cash_flows.*`) and ADR-0048 §9 (`launch_plan.exists`, 6 `launch_task.*`, 2 `day_ninety_test.*`, 6 `health_check.*`, 5 `health_scheme.*`), each with the ADR's exact English detail. `validation.formula_preview_source` was added (KBE-F §5.5). `change_request.retrospective_not_supported` was **changed** to ADR-0047 §3's new text (en/ar; see §5). No duplicate key exists (tested). |
| `apps/web/src/i18n/{en,ar}/myWork.json` | Message texts `launch.task.day_ninety_test_due`, `kpi_restatement.to_decide` and `kpi_restatement.reissue_offer`. The last is not named in the assignment, but it was also untranslated and belongs to the same REQ-S07-016 flow. The Day-90 text omits `scheduledDate`, which `messages.ts` does not format as a date; the work item's due date shows it. |
| `apps/web/src/pages/my-work/message-keys.test.ts` | Their three `PRODUCED` entries, with the params their producers send. |
| `apps/web/src/app/p5-shell.test.tsx` | `launchPlan`/`healthCheck` were removed from the "placeholder" list. A built-check was added: no FE-F placeholder, and the 10 FE-F paths are registered. |
| `apps/web/src/i18n/{en,ar}/changeRequestsP4.json` | `effectiveFromHint` no longer says restatement "is not supported" (F-DG4-160; §5). |
| `apps/web/src/pages/kpi/ui.tsx` | One link in the KPI sub-nav: "KPI restatement" (`/kpis/:kpiId/restatements`). |
| `apps/web/src/pages/benefit-formulas/BenefitFormulaPage.tsx` | One link paragraph: "Formula preview". This follows FE-D's MeetingPage precedent. |
| `apps/web/src/pages/business-cases/BusinessCasesPage.tsx` | One link paragraph: "Financial metrics". |
| `apps/api/src/modules/launch/day-ninety.ts` | Its local zod block was replaced by imports from `@mth/shared/schemas`, re-exported under the **same names** (`completion` included). Its test and `p5-exercises-be-p2.ts` are unchanged. Behaviour is unchanged. The unused `freeText`/`timestamp`/`uuid`/`version` imports were dropped. |
| `packages/shared/src/schemas/index.ts` | Barrel line `export * from "./day-ninety.ts";` after `launch.ts`. |

## 2. Behaviour per requirement row (acceptance text quoted)

| Row | Acceptance (quoted) | Delivered and where it is shown |
|---|---|---|
| REQ-PB-086 | "A16: with start date 2026-10-01 the Days 31-60 tasks fall between 2026-11-01 and 2026-11-30; all actions of B0134 appear" | The plan is generated from the screen. The e2e asserts every Days 31-60 due date is in November 2026. The template card and the task list show every B0134 action and output from the seeded rows (en verbatim; ar provisional, with the note). Owners and output links are edited per task. "Transformations > Launch plan" is the route, and the Playbook nav entry has a picker. |
| REQ-S14-004 | "A16: moving the start date by +7 days moves every unstarted task by 7 days and leaves completed tasks unchanged; a task whose predecessor is incomplete shows 'blocked by' the predecessor" | The start-date change shows "Unstarted tasks moved by 7 days" (e2e: the first task's due date is +7). "Blocked by #1 …" appears while #1 is incomplete (e2e and unit). Predecessor edit runs the cycle refusal (e2e: 422 `launch_task.predecessor_cycle`, translated). |
| REQ-PB-087 | "A16: all six questions render verbatim; unanswered questions mark the test incomplete" | Six questions from the rows (e2e checks q1's en and ar text). "Incomplete (1/6)" after one answer. Completing gives the translated 422 `day_ninety_test.incomplete` (e2e and unit). Suggestions are links, never answers. |
| REQ-PB-091 | "A16: all 25 questions render verbatim; an assessment with an unanswered question is labelled incomplete and shows no band; submission without three actions is rejected" | 25 question rows. "Incomplete (24/25)" with "No band until every question is answered". Submit without actions shows the translated 422 `health_check.actions_required`. With three actions it is submitted (e2e). Reassessments are listed over time. |
| REQ-PB-092 | "A16: scores 21, 16, 10 and 9 map to the four band texts verbatim" | The band text is rendered verbatim from the API's band (`textEn`/`textAr`). The e2e shows 17 → "16-20". The scheme screen lists the four source bands. The mapping itself is KBE-G's and is tested there. The UI adds no mapping of its own. |
| REQ-S14-001 | "A16: 25 answers with 17 Yes give a score of 17 and the band '16-20'; the scoring method is shown as an implementation assumption in the UI" | "17 / 25", band 16-20 (e2e and unit), and the scoring-assumption notice on the assessment and on scheme v1. |
| REQ-S14-002 | "A16: an assessment with 24 answers shows 'Incomplete (24/25)' and no band; the API returns band=null" | Exactly "Incomplete (24/25)" (en; ar "غير مكتمل (24/25)"). There is no band and no score, never 0. |
| REQ-S14-003 | "A16;A07: publishing a scheme that adds N/A without new bands is rejected; existing assessments keep their original scheme version and band" | Each assessment shows its scheme version. The schemes screen states the rule and links to the Studio. The publish refusal is the Studio pipeline's (KBE-G provider), and the `health_scheme.own_bands_required` text is translated. I did **not** drive a Studio publish of a v2 scheme in e2e (§6). |
| REQ-S07-016 | "A07: a prospective target change leaves last quarter's RAG unchanged; a restatement of Q1 without authority is rejected; the Q1 report issued earlier is unchanged and a reissue creates version 2" | The prospective notice is shown. Create, submit, withdraw and decide are all wired with If-Match. The decision form is hidden from the requester, and a 403 `kpi_restatement.no_authority` is translated (unit). The reconciliation is retained or preview, and Stale has no number (unit). Reissue offers link to the snapshot screen (FE-E's). The e2e covers the empty state and the 422 `version_not_approved` of a new KPI. A full Q1 approve-and-reissue journey was **not** run in e2e (§6). |
| REQ-S08-005 | "A05: preview of the revenue uplift example shows SAR as the unit and 'Not computable' for a missing ARPU" | e2e (en and ar): unit "SAR", no "per customer" anywhere, and `arpu` missing → "Not computable" with "An input is missing: the result is Unknown." |
| REQ-S08-019 | "A05: with no discount rate configured NPV is not shown; with 10% configured, a fixture cash-flow set gives the expected NPV to 2 decimals" | Without a discount rate, NPV reads "Not shown: no discount rate" (unit). With a rate, NPV is `formatMoney(npv, currency)`, to 2 decimals in SAR, as the API computes it. The extension label and off-by-default are checked in e2e, and the lead's switch is refused with 403. The 10 % fixture value itself was not driven in e2e, because no ADM_METHOD/FIN grant journey was built (§6). |

The other rules: every string is in en and ar; the Arabic is RTL (e2e runs both projects). axe found no serious or critical violation on 9 screens × 2 languages. Every scroll region (`table-wrap`, checkbox lists) is focusable and labelled. Every status chip has an icon and a text label. Blue never marks a favourable state. Unknown/Stale/Not computable/Incomplete are neutral and never 0 or green. Server errors are shown by their code through one form-level alert per form. AUD sees read-only notes (e2e: no write forms; PATCH gives 403).

## 3. Checks (real exit codes)

Evidence directory: `docs/delivery/handbacks/DG5/T-DG5-FE-F-evidence/`. `summary.txt` holds every final run's exit and times.

`summary-at-handback.txt` is a copy of `summary.txt` taken at 18:09Z. Host load was 6–19 throughout, because four W16 runs were in parallel. Every command ran in `/home/user/wt/dg5-fe-f`.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 16:25Z) | **exit 0**, `PASS gate DG4 (historical)` | `validate-historical-DG4-start.log` |
| 2 | `pnpm -r typecheck` | **exit 0** | `typecheck.log` |
| 3 | `pnpm -r build` | **exit 0** (also run once before the e2e spec runs: `build.log` was overwritten by the final run) | `build.log` |
| 4 | `pnpm lint` | **exit 0** | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0**, "All matched files use Prettier code style!". The untracked top-level `.bashrc`, `.gitmodules`, `.mcp.json` etc. are sandbox character devices, not files of mine. | `prettier.log` |
| 6 | `pnpm openapi:lint` | **exit 0** | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE`), 17:32–17:54Z | **exit 1**. unit-node **2245/2252**: 7 failed, all **timeouts** in files I did not touch (`apps/api/src/architecture.test.ts` 30 s timeout at 50 s; `packages/reporting/src/pdf/pdf.test.ts` six Arabic renderPdf tests at 5 s). unit-web **1499/1499** (baseline 1470, +23 `fef.test.tsx`, +6 `message-keys.test.ts`). unit-formula-nocodegen **259 passed + 2 skipped**. | `unit-nolocale.log` |
| 8 | `pnpm test`, `LANG=LC_ALL=C.UTF-8`, 17:54–18:07Z | **exit 1**. unit-node **2246/2252**: 6 failed, the same two files, all `Test timed out`. unit-web **1499/1499**. nocodegen **259 + 2 skipped**. | `unit-cutf8.log` |
| 9 | The two timing-out files rerun in isolation at load 6 (`env -u LANG -u LC_ALL npx vitest run --project unit-node apps/api/src/architecture.test.ts packages/reporting/src/pdf/pdf.test.ts`) | **exit 0**, **152/152** | `rerun-unit-node-timeouts.log` |
| 10 | `QA_PG_PORT=23553 MTH_PORT_POOL=23560-23599 tests/qa/support/with-pg.sh pnpm test:integration`, 18:07–18:41Z | **exit 0**, **278 files, 2775 passed + 1 skipped** (equal to the D-161 baseline 2775 + 1). **Pinned counts: unchanged.** It finished after I wrote the first version of this handback; I reviewed its log afterwards. | `integration.log` |
| 11 | Full web e2e: `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` (`E2E_PG_PORT=23551`, `E2E_API_PORT=23552`, `MTH_PORT_POOL=23560-23599`), from 18:41Z | **INCOMPLETE: no exit status.** The background task hit its time limit and was killed after **234 of 402** tests, all passed (**0 failed**). Those 234 include my spec's 3 chromium-en tests (174–176). The remaining 168, including my chromium-ar tests in this run, did not run. | `e2e-full.log` (partial) |
| 12 | My spec alone, same stack and ports. Run 1 (17:07Z) | **exit 1**, 4/6. The health-check test failed in en and ar: the test clicked Submit before the saved actions' new version had reloaded, and the screen correctly showed the 409 conflict (`e2e-fef-spec-run1.log`). This was a test defect; the test now waits for the PUT and the reload. | `e2e-fef-spec-run1.log` |
| 13 | My spec alone. Run 2 (17:10Z) | **exit 0**, **6/6** (3 tests × chromium-en/ar), axe clean on 9 screens per language | `e2e-fef-spec-run2.log` |
| 14 | `npx vitest run src/pages/health-check/fef.test.tsx` (during the work) | **23/23** | (in unit-web above) |
| 15 | `node tools/gates/validate.mjs --historical --stage DG4` (end, 18:09Z) | **exit 0**, `PASS gate DG4 (historical)` | `validate-historical-DG4-end.log` |

Note: the background check script was stopped by its time limit during the full e2e run (#11). `summary.txt` therefore has an `integration exit=0` line, but no e2e or end-validate line. The end validation (#15) was run separately. After run 2, I changed the "Blocked by" chip to show the predecessor's title in the reader's language (it had shown the stored English title in Arabic). That change is covered by typecheck, lint, the unit-web runs 7 and 8 (which ran after it) and build 3. Spec run 2 ran before it.

**Interaction checks actually run (e2e, real API, en and ar):**
- nav picker → launch plan;
- generate from 2026-10-01;
- November due dates of Days 31-60;
- start date +7 → shift 7 and first due +7;
- predecessor #2 ← #1 → "Blocked by";
- #1 ← #2 → 422 cycle alert;
- AUD read-only and PATCH 403;
- Day-90: six verbatim questions, answer q1, "Incomplete (1/6)", complete → 422 alert;
- health check: start, 24 API answers, reload, "Incomplete (24/25)", no band, assumption notice, 25th answer in the UI, 17 / 25, band 16-20, submit → 422 actions alert, three actions saved, submitted;
- schemes v1 with four bands;
- formula link → preview SAR, no "per customer", `arpu` missing "Not computable";
- financial metrics extension label, off, lead switch 403;
- KPI restatements: prospective notice, empty, no closed periods, 422 `version_not_approved` (API).

**Screenshots** (`T-DG5-FE-F-evidence/screenshots/{en,ar}/`): `p5-launch-plan.png`, `p5-launch-plan-cycle.png`, `p5-day-90-test.png`, `p5-health-check-incomplete.png`, `p5-health-check-submitted.png`, `p5-health-schemes.png`, `p5-formula-preview.png`, `p5-financial-metrics.png`, `p5-kpi-restatements.png`. These come from spec run 2.

## 4. Operations routed

**None.** FE-F routes no API operation. All 38 slice G/H operations were already routed by BE-P, BE-P2, KBE-G, KBE-G2, KBE-E, KBE-E2 and KBE-F, and there is no `p5-pending-fe-f.ts`. Pending delta: **0**. Pinned counts (media-type triple, rate-limit floor, operation count): **unchanged**. No body or contract was changed.

## 5. User-facing texts my work made untrue, and what I did

1. **Playbook landing "guidance":** the launch plan and the health check were listed as "not available yet" P5 screens. They are now delivered links (nav.ts AREA_CONTENTS), and the chip reads "Available".
2. **The 7 FE-F placeholder routes** ("not available yet") were replaced by the screens.
3. **`problems.change_request__retrospective_not_supported`** (en/ar) said "A retrospective restatement is not supported". It now has ADR-0047 §3's text: "A change request takes effect from now on; restate closed periods through a KPI restatement."
4. **`changeRequestsP4.effectiveFromHint`** (en/ar) said a past date "is a retrospective restatement, which is not supported". It now says a change request cannot take effect in the past, and to restate closed periods through a KPI restatement.
5. **Left for their owners:**
   - `nav.p5.{launchPlan,day90Test,healthCheck,healthSchemes,kpiRestatement,formulaPreview,financialMetrics}` are no longer rendered. They describe the screens truthfully and are kept so `nav.json` stays FE-A's.
   - The procedures coverage view's "Planned" state of the launch-window and health-question elements is BE-G2's (D-160 c), and was not touched.

## 6. What remains (stated plainly)

0. **Checks not completed:**
   - the full web e2e (§3 #11) was stopped by the time limit after 234/402 tests, all passed; the merged-tree verification must run all 402. Integration completed green (#10);
   - unit-node had load timeouts in two untouched files, which pass in isolation (§3 #7–#9).

1. **e2e depth:**
   - REQ-S07-016's full A07 journey (approved version, closed Q1 with values, an issued report, approve as a non-requester, then reissue) is not driven in my spec.
   - REQ-S08-019's 10 % fixture NPV is not driven through the UI, because it needs an ADM_METHOD switch and a FIN assumptions grant.
   - REQ-S14-003's v2 Studio publish refusal is not driven.

   These are QA-B (A07) and QA-D (A16) scope. The screens and their unit tests cover the UI side.
2. **Audit labels (REQ-S15-007):** the audit actions and fields of slices G/H that land on a transformation's trail have no labels in `lib/auditChanges.ts` / `transformations.json`. These are `launch_plan.*`, `launch_task.*`, `day_ninety_*`, `health_check.*`, `kpi_restatement.*` and `financial_cash_flow_set.*`. KBE-F §6 named the last one. They would show as "without a translation". These files are outside FE-F's ownership, and `auditChanges.p5.test.ts` does not scan these API files yet. **For the orchestrator:** route them to the owner of `lib/auditChanges.ts` (FE-A2 precedent).
3. **The tables** sort by their natural key (ordinal, sequence, version, date). Only the launch tasks have a filter (status). Column selection and pagination (DataTable) were not adopted on these small, bounded lists (≤ 34 tasks, 25 questions, ≤ 24 periods).
4. The health-check answer rows remount after each save (keyed by the assessment version), so an unsaved note typed in another row is lost on the next save. Each row saves on its own.

## 7. Contract, schema or dependency needs

- **No new dependency.** `decimal.js` is already a web dependency (`lib/format.ts`).
- **No contract change.**
- **Schema:** the Day-90 mirrors were promoted (D-159 d), and the API now imports them from shared.
- **Type exports:** `HealthCheckQuestion`/`HealthCheckScheme` types are only exported from `@mth/shared/calc`, not `@mth/shared/schemas`; `health.ts` re-exports the zod values but not the types. I import them type-only from `calc`. A one-line type re-export in `schemas/health.ts` (KBE-G2's file) would be cleaner.

## 8. Merge notes

Expect conflicts with FE-E (same wave) in these shared files:
- `router.tsx`: the `P5_PLANNED_ROUTES` rows and the lazy-page and route blocks;
- `p5-shell.test.tsx`: the planned list and built checks;
- `i18n/index.ts`: the namespaces;
- `problems.json` en/ar: appended keys;
- `myWork.json` and `message-keys.test.ts`.

In each, keep both sides (union) and check for no duplicate problem key. My test `fef.test.tsx` checks for duplicates in `problems.json`. No migration.
