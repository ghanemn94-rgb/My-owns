# Handback T-DG5-ARCH-R1 (solution-architect): ADR amendments for the DG5 repair waves (D-155 to D-166)

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-R1-solution-architect-20261017T140301Z-9cbd7290","session_id":"9cbd7290-3126-46f6-9cdb-a4090964df99"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-R1.md`. I checked its sha256 before starting: `175670be6ab2485f1cfbb742159dcdc8d80b9b616b1f7c1c2601bbca273765c7`, which matches.
- **Base:** branch `dg5/arch-r1` at `6f8ce12` (D-166, W1–W20 merged). The changes are **uncommitted**, as the assignment asks.
- **Time:** `date -u` at the start was `Sat Oct 17 14:03:23 UTC 2026`, and at the end of the checks `Sat Oct 17 14:17:36 UTC 2026`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start and at the end (§3).

No agent grants a real business, Finance or IT approval. Product gates G1–G6 are business approvals inside the product, and nothing here touches DG0–DG7. The playbook and the product are not called an official PMI standard anywhere.

## 1. Changed files

Every file is under `docs/architecture/**`, plus this handback and its evidence folder.

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0039-…-publish-pipeline.md` | Amendment C1: the routed approver in every read. Amendment C2: `gate_instance.approver_configured`, its backfill and the narrow trigger disable (`0094`). |
| `docs/architecture/adr/ADR-0015-decision-and-product-gate-model.md` | Amendment: corrects §2 Submission step 1 for transformations pinned to a later methodology version, and adds the `approver_configured` flag to the `gate_instance` row. |
| `docs/architecture/adr/ADR-0041-…-form-framework.md` | Amendment: `getFormRecordCustomFields` 200 declares `ETagOrZero` (D-165, the D-153 precedent). |
| `docs/architecture/adr/ADR-0042-…-coverage.md` | Amendment V1: `procedures` v2 (`0095`). V2: Rule A (`0096`, BE-T4) with the narrowed P2 identity guard. V3: "verify and link only". **Body correction:** one §3 sentence, marked "Corrected 2026-10-17". |
| `docs/architecture/adr/ADR-0043-…-failure-queue.md` | Amendment S1: the dry-run sample is the complete schema-v1 payload. S2: `AutomationTrigger.samplePayload` and the placeholder `transformationId`. |
| `docs/architecture/adr/ADR-0044-…-notification-policy.md` | Amendment B0–B2: Rule B (`forwardFinish`), verbatim, plus how it fits with §7 and DG4. **Body correction:** two §7 sentences, each marked "Corrected 2026-10-17". |
| `docs/architecture/adr/ADR-0045-…-presentation-evidence.md` | Amendment O1–O6: `synthetic`, `ReportEnvironmentPort`, the declared totals with the table list, the executive dashboard's KPI versions and sources, `WorkflowsReadPort.gateApprover`, and the benefit totals by reference. |
| `docs/architecture/adr/ADR-0046-…-export-jobs.md` | Amendment E1: B0004 on every XLSX sheet and as a CSV row. E2: the illustrative label in each format. E3: the KPI target as display text. |
| `docs/architecture/adr/ADR-0049-…-branding.md` | Amendment N1: the shell renders only `GET /me/navigation`, and why the two DG1 pins changed. N2: `nav.background` derived from `brand.primary`, and `nav.text-muted` = `nav.text`. |
| `docs/architecture/adr/ADR-0050-…-walkthrough.md` | Amendment D1: `roaming.user.adm_access`. D2: the business-unit grants TL, TO, ADM_ACCESS. D3: the dev-mode binding. D4: §2 (d) as built. **Body correction:** the §2 (d) sentence, marked "Corrected 2026-10-17". |
| `docs/architecture/data-dictionary.md` | `gate_instance`: the column row and the migration line. `procedure_step_instance.transformation_id`: a note. New final section "P5 repair migrations (0094–0096, DG5)". |
| `docs/architecture/erd.md` | `gate_instance` diagram: `bool approver_configured`. New section "1r. P5 repair migrations". |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-R1-evidence/*.log` | Logs of the end-of-run checks. |

Each amendment follows the T-DG4-ARCH-R1 precedent: `## Amendment (2026-10-17, T-DG5-ARCH-R1; <decisions>): …` at the end of the ADR. Each one names its sources, says "nothing above is removed", and says which text wins.

## 2. Amendment → decision → evidence (acceptance 3)

| # | Amendment | Decision(s) | Evidence (file:line, migration, operation) | Requirement rows |
|---|---|---|---|---|
| 1 | ADR-0039 C1–C2; ADR-0015 §2 | D-163 (F-DG5-QA-A-1); D-164 (a), (b); D-166 (accepted `schema.ts` and worker edits, and the backfill with the trigger disable) | `apps/api/src/modules/workflows/gates.ts:276` `routedApproverOf`, `:159` `toGateInstance`, `:461` `gateView`, `:398` `isGateApprover`, `:952` `submitGate`, `:307` `effectiveGateApprovers`, `:452–455` `canDecide` (unchanged), `:714` and `:732` (flag and audit change); `gate-exceptions.ts` `gateApproverConfig`; `scale.ts` `dispositionParty`; `apps/worker/src/handlers/gates.ts:519`; migration `packages/db/migrations/0094_p5_gate_approver_configured.sql`; operation `PATCH /api/v1/transformations/{transformationId}/gates/{gateCode}` (audit action `gate_instance.configure`); tests `effective-approver.test.ts`, `approver-configured.test.ts` | REQ-S06-004, REQ-S20-006 |
| 2 | ADR-0041 (ETagOrZero) | D-165 (QA-B P-3), D-166; D-153 precedent | `docs/api/openapi.yaml` operation `getFormRecordCustomFields` 200 `ETag: $ref ETagOrZero`; `apps/api/src/modules/forms/custom-values.ts:80–82` (PUT `IfMatchOrZero`, unchanged); test `tests/qa/integration/a07-historical-integrity.test.ts` | REQ-S16-010 |
| 3 | ADR-0042 V1–V3 (+ §3 body correction) | D-165 (QA-E O-1, O-2, D-QA-E-2); D-166 (Rule A, W21 BE-T4) | migration `0095_p5_procedures_v2_baseline_assignee.sql` (v2 `01920005-0300-7000-8000-000000000002`); `procedures/instances.ts:233` `launchDefinition`; Rule A → `0096` (**implemented by T-DG5-BE-T4 (W21)**, not merged); the current block: `procedures/steps.ts:653` and next action `:911`; P2 guard `0010` `p2_row_guard` (`procedure_step_instance_identity_immutable`); DG4 guard `0031` `p4_approval_subject_version`; `procedures/outputs/kit.ts` (header); contract `ProcedureStepComplete.description`; operation `completeProcedureStep` body `outputRecordId` | REQ-S06-002, REQ-S06-003, REQ-PB-027 |
| 4 | ADR-0043 S1–S2 | D-163 (QA-A O-1); D-164 (d); D-166 | `apps/api/src/modules/automation/dry-run.ts:106` `validateSample`; contract `AutomationDryRunRequest` (description and `examples`); `automation/samples.ts:12` `SAMPLE_TRANSFORMATION_ID`, `:170` `samplePayloadOf`; `automation/catalogue.ts:75` `samplePayloadField`; operation `GET /api/v1/admin/automation-catalogue`; `packages/shared/src/schemas/automation.ts` (zod mirror); `apps/web/src/pages/automation/RulePage.tsx:456` `dryRunTemplate`; tests `dry-run-sample-shape.test.ts`, `catalogue-sample-payload.test.ts`, `samples.test.ts`, `fed.test.tsx` | REQ-S12-002 |
| 5 | ADR-0044 B0–B2 (+ two §7 body corrections) | D-165 (QA-F REQ-S12-012 observation); D-166 (Rule B, W21 BE-T4) | the current computation: `apps/api/src/modules/portfolio/slip-events.ts:183–184` (`predecessorFinish` per dependent); ADR-0023 §5 (`schedule.before_predecessor`); Rule B → **implemented by T-DG5-BE-T4 (W21)**, not merged | REQ-S12-012 |
| 6 | ADR-0045 O1–O6 | D-163 (F-DG5-qa-c-2, qa-c-3); D-164 (c), (e), (h); D-165 (QA-B P-1); D-166 | `packages/shared/src/schemas/report.ts:308`; `reporting/reports/snapshots.ts:70`, `:74`, `:298`, `:326`; `assemblers/table-totals.ts` `columnTotal`/`columnTotals`; `assemblers/diagnostic.ts:311`, `business-cases.ts:541`, `registers.ts:452`; `packages/reporting/src/model.ts:264` `totalRowCells`; `assemblers/executive-dashboard.ts:229` `kpiLineage`, `:207` `uniqueVersions`; `reporting/ports.ts:17`; `apps/api/src/server.ts:386`; `assemblers/gate-pack.ts:182–185`; `benefits/index.ts:31`; `registers.ts:368`, `:374`; tests `report-synthetic.test.ts`, `gate-pack-approver.test.ts`, `registers-report.test.ts`, `table-totals-demo.test.ts`, A07 | REQ-PB-089, REQ-S18-001, REQ-S13-004, REQ-S13-006, REQ-S13-007, REQ-S13-008, REQ-S07-016 |
| 7 | ADR-0046 E1–E3 | D-163 (F-DG5-qa-c-1, qa-c-2, QA-C O3); D-164 (g); D-166 ("the KPI target as display text") | `packages/reporting/src/model.ts:140` `provenanceText`, `:132` `illustrativeLabel`; `csv.ts:62–68`; `xlsx/index.ts` (header comment: label first row, B0004 last row of every sheet); `labels.ts` `export.illustrative`; `assemblers/registers.ts:519` `kpiTargetText`; tests `provenance-illustrative.test.ts`, `kbe-d4.test.ts`, `kpi-target-text.test.ts`, `a15-outputs-every-definition.test.ts` | REQ-PB-001, REQ-S20-015, REQ-PB-089, REQ-S18-001, REQ-S13-004, REQ-S13-005 |
| 8 | ADR-0049 N1–N2 | D-163 (FE-G §6.1 option (a); REQ-S15-004 text); D-164 (i) | `apps/web/src/app/Shell.tsx:42`; `apps/web/src/app/me-navigation.ts:48`; operation `getMyNavigation` (`GET /me/navigation`); `apps/web/e2e/journeys.spec.ts:207–210`, `:416–420`; `packages/design-tokens/src/contrast.ts:84` `deriveNavigationBackground`; `tokens.json` `nav.background` (derived, `#0071F1`) and `nav.text-muted` (ref `nav.text`); `apps/web/src/pages/branding/api.ts:88`; test `apps/web/e2e/p5-navigation.spec.ts` | REQ-S03-007, REQ-S15-004 |
| 9 | ADR-0050 D1–D4 (+ §2 (d) body correction) | D-163; D-165 (D-QA-E-1, dev-mode sign-in); D-166 (accepted ADM_ACCESS user) | `packages/db/src/demo/data/roaming.ts:110` `DEMO_ACCESS_ADMIN`, `:118` `DEMO_SIGN_IN_USERS`, `:132` `DEMO_BUSINESS_UNIT_GRANTS`; `packages/db/src/demo/guard.ts:125` `demoDevIssuerBindingAllowed`; `packages/db/src/cli.ts:53`; `apps/worker/src/handlers/demo.ts:86` (does **not** pass the binding yet; W21 BE-T4); `reporting/reports/snapshots.ts:70`; tests `demo-users-new-transformation.test.ts`, `demo-roaming.test.ts`, `demo-dev-binding.test.ts` | REQ-S18-004, REQ-S18-003, REQ-PB-089, REQ-S18-001 |
| 10 | data dictionary and ERD | D-164 (b), D-165, D-166 | `gate_instance` column row (`0094`); "P5 repair migrations (0094–0096, DG5)" (`0094` column and backfill, `0095` seed rows and the v1/v2 table, the `0096` transition table); ERD `gate_instance` block and §1r | REQ-S06-004, REQ-S06-002, REQ-S06-003, REQ-S16-010 |

## 3. Checks actually run

Environment: worktree `/home/user/wt/dg5-arch-r1`, Node from the sandbox PATH, offline.

| # | Command | Result |
|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 14:03Z) | exit 0: `PASS gate DG4 (historical)`. This run's output is in my session transcript only, because the evidence folder did not exist yet. |
| 2 | `git ls-files -co --exclude-standard -z -- docs/architecture \| xargs -0 npx prettier --check --ignore-unknown` (end) | exit 0: "All matched files use Prettier code style!" (`T-DG5-ARCH-R1-evidence/prettier-docs-architecture.log`) |
| 3 | `node tools/gates/validate.mjs --historical --stage DG4` (end, about 14:17Z) | exit 0: `PASS gate DG4 (historical)` (`T-DG5-ARCH-R1-evidence/validate-dg4-historical-end.log`) |
| 4 | Every cited `file:line` printed with `sed -n` against this tree | All matched, after I fixed two ADR-0039 references (`gates.ts:306` → `:307`, `441–444` → `452–455`). I checked that every cited test and source file exists. |

Not run, because they are not applicable to a docs-only change: typecheck, build, lint, unit, integration and e2e. No code changed.

## 4. Known gaps and points for the orchestrator

1. **Rules A and B are described as decided, not as built.**
   - When I finished, T-DG5-BE-T4's `0096` and its `slip-events.ts` change were not in this tree. ADR-0042 V2, ADR-0044 B1–B2 and the dictionary's `0096` rows say "implemented by T-DG5-BE-T4 (W21)" and "not merged when this amendment was written".
   - If BE-T4 lands differently, for example in the exact guard text or the Unknown cases, these sections need a follow-up.
2. **A reading in ADR-0044 B2 that BE-T4 must match.** I wrote down that "the first date ADR-0023 §5 allows S to start after P" is **P's finish date itself**. ADR-0023 §5 flags `planned_start < predecessor finish`, so a start on the finish date is not flagged, and no lag is added. If BE-T4 uses "the day after", either the code or B2 must change before the freeze. Please check this when you integrate W21.
3. **The worker's in-app demo reset does not keep the dev binding yet.** `apps/worker/src/handlers/demo.ts:86` does not pass `devIssuerBinding`. ADR-0050 D3 says so and points to W21 BE-T4. It is not described as built.
4. **The UI output-record gap (D-166, FE-D4).** ADR-0042 V3 records that choosing a step's output record in the UI is FE-D4's W21 work, not built yet.
5. **Body corrections (four sentences in three ADRs).**
   - ADR-0042 §3: the `create` adapter.
   - ADR-0044 §7: two sentences, the dependents' computation and "Forecasts".
   - ADR-0050 §2 (d): the reader and the placement.

   Each is marked "Corrected 2026-10-17 (T-DG5-ARCH-R1 …)" in place and named in its amendment. No other body text was edited.
6. **ADR-0046 E3 records a variance from D-164 (g).** D-164 (g) said "a `decimal` with each KPI's own unit kind". As built, and as D-166 summarises it, the KPI target is display text. The amendment states both, and why the column stays text.
7. **The trigger disable in `0094`.** ADR-0039 C2 records it as a one-off exception that D-166 accepted, not a pattern: any further use needs its own decision. That framing is an architecture position I added. Please confirm it, or tell me to soften it.
8. **The data dictionary's new section is edited by hand.** It says so. The slice sections above it were generated from the catalogue, but the `gate_instance` entry was not regenerated (no disposable database was used in this task).
9. **No contract changes.** No OpenAPI, schema or code file was touched. No reopen of a DG2–DG4 gate is needed for these documentation changes. Rule A narrows a P2 guard on a P5 table only (`procedure_step_instance`, `0069`), as D-166 decided.

## 5. Merge instructions

- Docs only: no migration, dependency or ordering constraint.
- Conflicts are possible only if another W21 task edits `docs/architecture/**`. BE-T4, FE-D4, QA-E2 and QA-F2 are assigned other paths.
- Integrate after (or with) BE-T4, and then re-read ADR-0042 V2 and ADR-0044 B1–B2 against the merged `0096` and `slip-events.ts` (§4 items 1–2).
- Do not integrate the untracked dotfiles at the worktree root (`.bashrc`, `.gitconfig`, `.idea`, `.mcp.json` and others). They were there at the start and are not part of this change.
