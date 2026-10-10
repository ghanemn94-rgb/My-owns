# Handback T-DG4-FE-R1 (frontend-ux-engineer): P4 repair scope

- **Invocation:** `DG4-T-DG4-FE-R1-frontend-ux-engineer-20261010T031022Z-580ac005` (session `580ac005-e4f1-4cd1-abd7-793455179848`). Assignment sha256 `9752a37929758c125806f4f441e3cbed64b5642888d8c4075121195489543271` (verified with `sha256sum`).
- **Base:** branch `dg4/fe-r1` at `7dd77b5650a7fd15c0e15483f72ec6c8e6f36df8`; changes left **uncommitted**.
- **Time:** started `2026-10-10T03:10:37Z`; checks finished at `05:02:05Z`; handback written at about `05:05Z` (about 115 min).
- **Preceding gate at start:** `node tools/gates/validate.mjs --historical --stage DG3` → exit 0 (`PASS gate DG3 (historical)`). At the end it exited 0 again (`evidence/validate-dg3-historical.log`).
- Evidence directory: `docs/delivery/handbacks/DG4/T-DG4-FE-R1-evidence/` (written `evidence/` below).
- All data is synthetic. No business, Finance or IT approval was granted. Product gates G1–G6 are not engineering gates.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/auth/session-identity.test.tsx` | Item 1: root-cause fix. The test waits until the sign-in landing redirect has settled (`/my-work`) before it navigates. |
| `apps/web/src/pages/benefits/api.ts` | Item 2: new `useBenefitPlanValue` read hook (getBenefitPlanValue); the path comment now names both operations. |
| `apps/web/src/pages/benefits/BenefitPage.tsx` | Item 2: per-line **Edit** on planned and forecast lines. It reads the record first, opens a pre-filled form, and sends a PATCH of the changed members with the read's version as `If-Match` (`planPatch`). Loading and error states are shown inline. |
| `apps/web/src/pages/benefits/plan-values.test.tsx` (new) | Item 2 unit tests, with the read mocked from the contract (15 tests). |
| `apps/web/src/i18n/{en,ar}/benefitsP4.json` | Item 2: `values.editPlan`, `editPlanTitle`, `editPlanPeriod`, `editVersion`. |
| `apps/web/src/i18n/{en,ar}/myWork.json` | Item 3: 27 message keys and 1 bare variant (§2.3), plus 14 work-item kind labels. |
| `apps/web/src/pages/my-work/MyWorkPage.tsx` | Item 3: more business-date params (`periodStart`, `periodEnd`, `slaDueDate`, `expiresOn`, `meetingDate`), and a `_bare` text for a key sent with no params (`raid.task.action_due` without a source). |
| `apps/web/src/pages/my-work/message-keys.test.ts` (new) | Item 3 unit tests (83 tests). |
| `apps/web/src/pages/kpi/api.ts` | Item 4: `useTransformationReportingPeriods` (listTransformationReportingPeriods). `usePeriodChoices(tid, frequency, openOnly)` now uses it; FE-B's 404 fallback to the current period is removed. |
| `apps/web/src/pages/kpi/KpiUpdatePage.tsx`, `KpiPage.tsx` | Item 4: call the new `usePeriodChoices`; the "current period only" note is removed. |
| `apps/web/src/i18n/{en,ar}/kpiP4.json` | Item 4: the now-unused `update.currentPeriodOnly` removed from both languages. |
| `apps/web/src/pages/kpi/kpi-periods.test.tsx` (new) | Item 4 unit tests (6 tests). |
| `apps/web/src/i18n/{en,ar}/problems.json` | Item 5: 81 problem keys (§2.5). |
| `apps/web/src/i18n/problems-slices-hijk.test.ts` (new) | Item 5 unit tests (8 tests). They read the slice ADR refusal tables at test time. |
| `apps/web/e2e/p4-kpi.spec.ts` | Item 4 e2e. A second, earlier open monthly period is created. Step 4 (keyboard only) now presses ArrowDown until this KPI's period is chosen, because the list holds every open period. New step **4b**. |
| `apps/web/e2e/p4-benefits.spec.ts` | Item 3 e2e. Step 6 maps `FIN` to the synthetic Finance user, then checks that the worker's Finance task renders its own text in My Work. |
| `docs/delivery/handbacks/DG4/T-DG4-FE-R1-*` | This handback and its evidence. |

No API, schema, migration, contract or `p4-pending-*`/`p4-exercises-*` file was changed.

## 2. Behaviour delivered

### 2.1 Item 1: `session-identity.test.tsx` fails intermittently under load (REQ-S16-030 test file, F-DG2-500)

**Root cause (reproduced, not assumed).** Every recorded failure is the same test: "signing out here clears everything; B signing in afterwards never sees A's records" (DG3 round 3 in AR, BE-D and BE-H2 in EN), at line 295, `findByText("No transformations yet.")`. In each failure the DOM shows user B on **/my-work** (the My Work nav link has `aria-current="page"`).

The sequence:
1. After sign-out the URL is `/login?signedOut=1`, with no `returnTo`.
2. B's sign-in navigates to `/`.
3. The index route redirects to `/my-work` from an effect: `<Navigate to="/my-work" replace />` in `router.tsx`.
4. B's header ("Synthetic User B") renders at `/` **before** that effect commits.
5. The test waited for B's name and then called `router.navigate("/transformations")`.
6. Under load, the pending index redirect committed **after** the test's navigation, so the page ended on `/my-work` and the empty state never rendered.

**Proof.** An instrumented probe (`evidence/session-identity-race-probe.test.tsx.txt`, result `evidence/session-identity-race-probe-result.txt`) repeats the steps 40 times and records the router history:
- **No load:** 40/40 cases show `at-B=/my-work … final=/transformations`.
- **8 CPU burners on 4 CPUs:** **2/40** show `at-B=/ history=/>/>|test navigates|>/transformations>/my-work final=/my-work`. That is exactly the failure.

**Fix.** The test now waits for a state, not a longer timeout:
- `await waitFor(() => expect(router.state.location.pathname).toBe("/my-work"))` before it navigates;
- then it asserts the pathname is `/transformations` after navigating.

No timeout was lengthened and no retry was added. The product redirect is unchanged: it is DG1 behaviour, and a user cannot act inside the gap of one scheduler task.

**50× under load:** `evidence/session-identity-50x-under-load.log`:
- `end … pass=50 fail=0`, with 18/18 tests in every run;
- load average 10–23 on 4 CPUs, while `pnpm test` (the full unit suite) ran repeatedly in parallel (`evidence/session-identity-50x-load-pnpm-test.log`).

**Disclosure on the load runs.** Load runs #1–#4 exited 1 (4, 10, 1 and 1 failed tests); load run #5 exited 0.
- They ran from 03:19 to 03:45Z, while I was writing and fixing my new test files, which were red at times (for example, plan-values 6 failed and message-keys 2 failed during development).
- The load log kept only the counts, not the names of the failing tests, which is a flaw in my loop script. So I **cannot attribute those failures** and do not claim they were only my in-progress files.
- The two clean full `pnpm test` runs that followed (§3) passed 2514/2514 and 259 + 2 skipped, with the locale unset and with C.UTF-8.

### 2.2 Item 2: plan-value editing (FE-C decision 1; REQ-S08-001)

Acceptance (REQ-S08-001): *"A10: a forecast amount never appears in the validated total; a rejected measurement is retained and shown as rejected"*. The series stay apart as before; this item adds the "enter-plan/forecast: BO" edit.

What the user gets:
- **Edit** appears on each planned or forecast line (a `benefit_plan_value` record), only for `benefit.edit` on an active benefit. Measurement lines and readers get no Edit.
- The button's accessible name includes the state and the period.
- Clicking it reads `GET …/benefit-plan-values/{id}` (`getBenefitPlanValue`) and opens one dialog, pre-filled from that read. The kind is fixed after create, and the record version is shown.
- The PATCH sends `If-Match` with **that read's** version and only the changed members. An unchanged form is refused before any request (`validation.empty_patch`). Clearing both values gives `benefit_value.value_required`; clearing a date gives `validation.required`.
- A 409 shows the one form alert (`data-state="conflict"`, "nothing was saved; the latest data has been loaded") and re-reads the record. `If-Match` stays pinned to the version the user saw, so there is never a silent overwrite. Reopening shows the new values and version.
- A failed read shows its state inline: error, or the no-permission state for a 404. No form is shown with guessed values or without a version. Focus returns to the Edit button.

**Route status.** `getBenefitPlanValue` is **not merged in my base**: it is still in `apps/api/test/support/p4-pending-arch-r2.ts`, and KBE-R3 routes it. So, as the assignment says, **no e2e step was added to the product suite.**
- **Unit tests:** `plan-values.test.tsx`, 15/15, with the read mocked from the contract. The mock is checked against the zod mirror `benefitPlanValue`.
- **Visual evidence:** an evidence-only spec ran on the **real stack**, except for that one read. The GET is answered with the record the real API returned. The create, the PATCH with `If-Match` and the 409 are the real API's. Second run: 2/2 passed (EN and AR), `evidence/plan-value-evidence-run.log`. Spec kept as `evidence/plan-value-evidence.spec.ts.txt`; it was removed from the tree.
  - It proved `If-Match` `"1"` then `"2"`, the saved value shown, focus back on Edit, and a real 409 after another session saved.
  - Its **first run failed** because of a flaw in the evidence spec itself, not the product. See `evidence/plan-value-evidence-run1-failed-note.txt`.
  - Screenshots: `evidence/screenshots/{en,ar}/fer1-plan-0{1..4}-*.png`.
- **Merge note.** Once KBE-R3 is merged, an e2e step can drop the interception. Nothing in the web code changes.

### 2.3 Item 3: My Work message keys (FE-C decision 4; S-6)

`benefits.task.finance_validation_review` is added: "Validate the value of benefit {{benefitCode}} for {{periodStart}} to {{periodEnd}}" / Arabic, with both dates in the reader's locale.

Every work-item message key in the ARCH-R1 table (§E item 11) and ARCH-R2 (rows 182–183) that `myWork.json` lacked is now translated. The texts use the parameter names the producers actually send (checked in `apps/api`/`apps/worker`):
- `raid.task.action_due`, plus a `_bare` text for no source code;
- `raid.task.corrective_follow_up`;
- `governance.task.executive_decision_due`, `governance.task.executive_decision_escalated`;
- `adoption.task.intervention_due`, `adoption.task.assessment_invitation`, `adoption.task.assessment_to_review`;
- `sustainment.task.bau_handover_to_accept`, `sustainment.task.performance_review_due`, `sustainment.task.control_check_due`, `sustainment.task.benefit_monitoring_due`;
- `gates.task.gate_decision_due`, `gates.task.gate_condition_due`, `gates.task.gate_exception_to_decide`, `gates.task.gate_exception_expired`, `gates.task.phase_step_enabled`, `gates.task.phase_step_review`, `gates.task.scale_scope_enabled`;
- `governance.task.meeting_action_due`, `governance.task.minutes_to_approve`.

Also added, because the same `renderMessage` shows them in the inbox:
- the five **notice keys** (`governance.notice.executive_decision_escalated`, `…blocker_ask_calendar_not_configured`, `…blocker_ask_owner_unassigned`, `…series_calendar_not_configured`, `gates.notice.gate_exception_expired`);
- `routing.role_unmapped`, which the gates worker uses as a work-item message key.

**Kind labels.** 14 work-item kind labels that the migrations insert but `myWork.kind` lacked were added. A test now reads every `work_item_kind` from the migrations.

**Tests:**
- `message-keys.test.ts`, 83/83. Every key renders from its producer's params in EN and AR; no placeholder is left unfilled; no fallback text appears; Arabic script is used in AR; dates are localized; a null date is Unknown; every placeholder is one the producer sends; the EN and AR placeholder sets match.
- **Real stack:** `p4-benefits.spec.ts` step 6. The worker's task shows its own text with the benefit code, never the fallback, in EN and AR. Screenshots: `evidence/e2e-rerun-screenshots/{en,ar}/p4ben-10b-finance-my-work-task.png`.

### 2.4 Item 4: KPI periods (KBE-R2; REQ-S07-017, REQ-S07-003)

Acceptance (REQ-S07-017): *"A04;A20: a keyboard-only user completes an update in four steps; the confirmation lists affected dashboards and 'Finance review pending' where applicable"*. The procedure says "open KPI, select period". Permission: "submit: assigned KPI owner/steward".

What changed:
- The update form, and the override form on the KPI page, list periods through `GET /api/v1/transformations/{tid}/reporting-periods` (`listTransformationReportingPeriods`). The query is `status=open&frequency=<KPI frequency>`, and the client filters the same way.
- A Lead or KPI owner (transformation-scoped, no `organization.read`) can now choose **any open period of the KPI's frequency**, not only the current one.
- The organization list is never requested from these forms.
- No open period shows the existing "no open period" note. A failed list is an error state, never an empty choice.

**Unit tests:** `kpi-periods.test.tsx`, 6/6, including a transformation-scoped KPI owner and the chosen earlier period carried in the POST body.

**e2e (real stack):**
- Step 4 (keyboard only) still passes; it now presses ArrowDown until this KPI's period is chosen.
- New step 4b: the KPI owner's select offers the KPI's current period **and** an earlier open period, the earlier one can be chosen, and every period request goes to the transformation path. Screenshots: `p4kpi-06b-update-earlier-period.png` (EN/AR), plus axe.

### 2.5 Item 5: problem translations, slices H, I, C, A, J and K (S-6, S-11)

**Code-table codes** (ARCH-R1/R2) of these slices:
- `approval.resubmit_through_record`, `gate.exception_revoked`, `gate.modular_links_missing`;
- `gate.modular_waiver_revoked`, `gate.modular_waiver_expired` (not yet built: BE-R3);
- `inherited_record.record_not_found`, `trace_link.record_not_found`;
- the 422 error items `baseline_missing` and `outcome_link_missing`;
- `validation.duplicate_scope_item`, `validation.proposed_change`, `validation.proposed_change_size`, `validation.ratio_range`, `validation.basis_needs_share`, `validation.root_pair`, `validation.share_range`.

**Scope reading (please confirm).** The slice H, J and K ADR refusal tables had **no FE translation at all**, because no FE task owns those slices. I therefore also translated all of their remaining codes:
- ADR-0035: gate reviews, exceptions, scale scope, phase steps, risk disposition;
- ADR-0036: change control;
- ADR-0037: dashboards;
- ADR-0038: traceability, Modular entry, portfolios, workstreams.

That makes **81 codes in total**. A scan of all eight slice ADRs (0025–0028, 0035–0038) now finds no untranslated code. Slices I, C and A had no missing ADR code except `approval.resubmit_through_record`.

**Placeholders.** Problem messages render with **no parameters** (`lib/problem.ts`). So texts that carry server placeholders (`{date}`, `{label}`, `{rule message}`, `{from}`/`{to}`, `{code}`, `{total}`) are worded without them; a test enforces that no `{` or `}` remains.

**Tests:** `problems-slices-hijk.test.ts`, 8/8. It reads the ADR tables at test time, so a new ADR row cannot go untranslated. The glossary test caught one Arabic spelling (التحوّل with shadda), which was fixed.

**Codes I did not place in `problems.json`, with the reason:**
- `change_request.withdraw_via_approval`: retired by BE-R2 and no longer produced (`workflows/change-requests.ts:27`).
- `dispensation.waiver_requires_end_to_end`: already translated in `dispensations.json` (`problem` namespace), where its only route renders it.
- `kpi.aggregation_period_mismatch`: a roll-up reason, already rendered through `kpiP4.reason.aggregation_period_mismatch`.
- `kpi.recalculate_failed`: a stored `calculation_run.error_code`; no web screen shows run error codes today.
- `forbidden` (the ADR-0035 403 detail): the generic code is already translated.
- **Not problem codes, so outside `problems.json`, and not translated by this task:**
  - label keys: `kpi.downstream.*` (already shown via `kpiP4.downstream.*`) and `dashboard.headline.*`;
  - reason keys: `kpi.before_trajectory` etc. and `dashboard.*`;
  - rule keys: `dashboard.rag.*`, `dashboard.value.*`, `dashboard.finance.*`;
  - missing-item keys: `charter.decision_rights`, `g5.*`, `g6.*`;
  - the audit action `work_item.reschedule`.

  They belong to the screens that render them: slice J dashboards, the slice H gate screens and the audit trail.

## 3. Checks actually run

Node 24.21.0, offline. Disk was checked before each full run (19–20 GB free). Harness ports were in 25410–25449.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | (console) |
| 2 | `pnpm -r typecheck` | 0 | — | `evidence/typecheck.log` |
| 3 | `pnpm -r build` | 0 | — | `evidence/build.log` |
| 4 | `pnpm lint` | 0 | eslint `--max-warnings=0` | `evidence/lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | — | `evidence/prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS … OpenAPI 3.1.1, 649 operations` | `evidence/openapi-lint.log` |
| 7 | `pnpm test` (LANG/LC_* unset) | 0 | **2514/2514** (130 files) + **259 passed, 2 skipped** (3 files) | `evidence/unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | **2514/2514** + **259 passed, 2 skipped** | `evidence/unit-c-utf8.log` |
| 9 | `QA_PG_PORT=25410 MTH_PORT_POOL=25411-25439 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **1708/1708** (180 files). This task changed no API code and no pinned count. | `evidence/integration.log` |
| 10 | Full e2e: `E2E_PG_PORT=25440 E2E_API_PORT=25441 MTH_PORT_POOL=25442-25449 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | **238 passed, 2 failed, 4 did not run** (see below) | `evidence/e2e.log` |
| 11 | Rerun of the two specs this task changed, same harness (`p4-benefits.spec.ts p4-kpi.spec.ts`, chromium-en and chromium-ar) | 0 | **36 passed**: p4-benefits 8/8 and p4-kpi 10/10 per language, including the new 4b. axe 0 serious or critical. | `evidence/e2e-rerun-benefits-kpi.log` |
| 12 | 50× `session-identity.test.tsx` under parallel `pnpm test` load | 0 | **pass=50 fail=0** | `evidence/session-identity-50x-under-load.log` |
| 13 | Evidence-only plan-value spec, real stack except getBenefitPlanValue | 0 (2nd run) | 2/2 (EN, AR). The 1st run exit 1 is disclosed in §2.2. | `evidence/plan-value-evidence-run.log` |
| 14 | `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | PASS | `evidence/validate-dg3-historical.log` |

**The full e2e failure (check 10), disclosed.** `p4-benefits.spec.ts` step 6 failed in both EN and AR. The failure was in the My Work assertion **I had added**: `locator('tr').filter(Finance validation to review).filter('B02')` expected 1 row, got 0.

- **Cause:** the worker gives the Finance task to the benefit's validator, or else to the person mapped to the `FIN` party. The spec's setup has neither, so no task existed. This was a test setup gap, not a product defect.
- **Effect:** steps 7–8 of that spec did not run in either language (4 tests).
- **Fix:** step 6 now maps `FIN` to the synthetic Finance user before the worker starts.
- **Rerun:** both changed specs pass (check 11).
- **Not rerun:** the **full** e2e suite after this fix was not rerun within my time limit (§5).

In check 10 every other spec passed, including `p4-kpi` steps 4 and 4b in both languages. No other test failed or was flaky.

**Per-spec e2e counts (check 10), counted from `evidence/e2e.log`.** Each number is per language: chromium-en = chromium-ar.

| Spec | Passed | Failed | Did not run |
|---|---|---|---|
| `journeys` | 9 | 0 | 0 |
| `session-end` | 5 | 0 | 0 |
| `p2-blank-text` | 9 | 0 | 0 |
| `p2-journeys` | 12 | 0 | 0 |
| `p3-business-cases` | 6 | 0 | 0 |
| `p3-g4-refusal` | 2 | 0 | 0 |
| `p3-inherited-approval` | 5 | 0 | 0 |
| `p3-journeys` | 18 | 0 | 0 |
| `p3-portfolio` | 6 | 0 | 0 |
| `p3-prioritization-roadmap` | 7 | 0 | 0 |
| `p3-seams` | 3 | 0 | 0 |
| `p3-ui-completion` | 7 | 0 | 0 |
| `p4-governance` | 8 | 0 | 0 |
| `p4-raid-governance` | 7 | 0 | 0 |
| `p4-kpi` (incl. new 4b) | 10 | 0 | 0 |
| `p4-benefits` | 5 | 1 (step 6) | 2 (steps 7–8) |
| **Per language** | **119** | **1** | **2** |

Total over both languages: 238 passed, 2 failed, 4 did not run.

The list reporter in `evidence/e2e.log` has the per-test lines.

## 4. Operations routed (delta to the pending lists)

None. This is a frontend task: no route was added and no `p4-pending-*` or `p4-exercises-*` file changed. Consumed operations:
- `getBenefitPlanValue` (still pending in `p4-pending-arch-r2.ts`; KBE-R3);
- `updateBenefitPlanValue` (routed);
- `listTransformationReportingPeriods` (routed, KBE-R2).

## 5. Known gaps and what remains

1. **The full e2e suite has not been rerun after the step-6 fix.** The two changed specs pass in full in both languages (check 11), and the first full run (check 10) passed every other spec. The orchestrator's merged-tree e2e run will cover it.
2. **Plan-value e2e in the product suite** waits until KBE-R3 merges `getBenefitPlanValue`. After that merge, a step like `evidence/plan-value-evidence.spec.ts.txt`, without the interception, can be added to `p4-benefits.spec.ts`.
3. **Arabic texts** written by this task (My Work messages, problem keys, plan-value labels) are provisional and not linguistically reviewed. They pass the glossary test.
4. **Non-problem keys** of slices H and J (dashboard labels, reasons and rules, the G5/G6 missing-item keys, and `charter.decision_rights`) are not translated here, because they are not `problems.json` keys (§2.5). They need an owner: the FE task for the slice J dashboards and slice H gate screens.
5. `governance.task.minutes_to_approve` receives `forum` as the forum's **English** name (`name_en`, `apps/api/src/modules/governance/minutes.ts:136`), so Arabic readers see an English forum name inside the Arabic sentence. That is a backend parameter choice (for BE).

## 6. Contract or schema needs (for the orchestrator)

None for this task. Item 2 relies only on the contract's `getBenefitPlanValue` (`BenefitPlanValue` with `version` and `ETag`).

## 7. Merge instructions

- Web and i18n changes only; no migration.
- Expected conflicts:
  - `apps/web/src/i18n/{en,ar}/problems.json` and `myWork.json`, if FE-E adds keys at the end (resolve by union);
  - `apps/web/e2e/p4-benefits.spec.ts`, if another task edits step 6.
- `usePeriodChoices` has a new signature, `(tid, frequency, openOnly)`. Its only callers are `KpiUpdatePage.tsx` and `KpiPage.tsx`, both updated here.
- Untracked sandbox stub files at the tree root (`.bashrc`, `.profile`, `.vscode`, `CLAUDE.local.md`, …) are not mine.
