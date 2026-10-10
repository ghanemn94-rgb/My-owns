# Handback T-DG4-FE-F2 (frontend-ux-engineer): change requests, the phase workspace, scale transitions and risk dispositions

- **Stage:** DG4 (P4). **Task:** T-DG4-FE-F2, the second half of FE-F (p4-work-split §H H.6), completed as the salvage run **T-DG4-FE-F2B** (D-103).
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-F2B.md` (sha256 `40dd4d22b8056f03645c83150bd077dca75cab145565fd58b6cd63b7ebdb3342`, verified at start). It reproduces the original `T-DG4-FE-F2.md` unchanged.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-F2B-frontend-ux-engineer-20261010T093957Z-c7256c4a","session_id":"c7256c4a-b97a-438f-b4a2-ffb9d27e903f"}`.
- **Base:** branch `dg4/fe-f2`, `HEAD` `14a8476` (the orchestrator's unverified WIP commit of the killed run, on top of `983fdfa`). The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** `date -u` at start `Sat Oct 10 09:40:09 UTC 2026`; at the end see §9.
- **Two gate systems:** G1–G6 are business approvals inside the product. Nothing here reads or writes DG0–DG7 records. Every approval decision in the tests and e2e journeys (gate decisions, the change request's approval, the risk disposition's approval) is a synthetic demo decision by a synthetic person and approves nothing real. G6 never implies DG7, and the screens never show "DG0–DG7" (asserted in the unit tests).

## 0. Salvage (D-103)

I reviewed WIP commit `14a8476` as if someone else had written it, against §H H.6, the shared rules S-1…S-14, ADR-0035/0036 (with the ARCH-R1 amendments), the contract and the zod mirrors. I re-ran every check from scratch on the final tree. The killed run's transcript (`docs/delivery/test-evidence/DG4/fe-f2-orphaned/`) was not read or cited.

### Kept from the WIP (reviewed, found correct)

- **Change requests** (`pages/change-requests/**`):
  - list with status and kind filters, sort, filter, pagination and column choice (the shared `RegisterTable`);
  - the materiality policy, read at version 0 (`ETag: "0"`), with the first save sending `If-Match: "0"`;
  - the create form over all 8 subject types and 9 kinds. It checked out against BE-L's `loadSubject`/`validateChange`: `from` values come under the server's field names, and the subject version is sent. A KPI request proposes the KPI's draft version, with the changed fields diffed as decimals. A benefit-logic request names the formula's current version;
  - the draft impact preview (`previewChangeImpact`);
  - the detail page: the proposed change field by field (Unknown, never 0), materiality and its basis, the T11 route and assignee, saved draft vs returned vs submitted banners, edit, submit / resubmit round 2, withdraw, requester-only messaging (ADR-0026 E3), the live preview, and the frozen assessments with their SHA-256;
  - the gate items marked "preserved" with a link to the unchanged gate.
- **Phase workspace** (`pages/phases/**`): the catalogue, the per-phase panel (objective, gate status, steps with procedure, required evidence, owner (Unknown when unassigned), reviewer role, completion rule and status), step evidence (link and remove), the review queue, and owner/requester-not-reviewer.
- **Scale transitions and risk dispositions** (`pages/gates/ScaleRisk.tsx`, one wiring line in `GateDetailPage.tsx`).
- **Shared files:** append-only edits in `router.tsx`, `nav.ts`, `Workspace.tsx`, `i18n/index.ts`, `en|ar/nav.json` and `en|ar/gates.json`, checked line by line. The only removed lines are trailing-comma changes, plus the two `change-requests` entries of `P4_PLANNED_ROUTES`, which this task now builds.
- **i18n:** the `changeRequestsP4` and `phasesP4` namespaces (EN/AR key sets identical: 210 and 90 leaves).
- **Tests:** the unit tests, the `my-work.test.tsx` retarget, and the e2e spec `p4-change-phases.spec.ts` (steps 1–6).

### Changed, and why

1. **The phase step's first save did not do the version-0 read** (D-109; scope item 2 says "the version-0 `ETag: "0"` read and the `If-Match: "0"` first save"). The WIP took the version from the workspace list and never called `getPhaseStep`. The owner and start dialogs now read the step through `getPhaseStep` (new `usePhaseStep`, `staleTime: 0`) and send the version of its `ETag` as `If-Match`. The dialog shows "Record version 0 (0 = not saved yet; the first save creates it)". Unit test and e2e step 1 assert the GET's `etag: "0"` and the PATCH's `if-match: "0"`.
2. **Two form-level alerts in one form (S-7).** The create dialog's impact-preview panel used a second `FormAlert` (`role="alert"`) beside the form's own. A preview refusal is now a `role="status"` warning, so the form keeps one form-level alert.
3. **Hard-coded currency.** A cost change on an initiative (whose row stores no currency) sent `currency: "SAR"`. It now sends the transformation's currency (`ws.tr.currency`), which the organization default sets (S-5: per-row currency, SAR only as a configurable default).
4. **A unit test claimed more than it checked.** "A pending disposition is shown as pending, not as closed; an approved one completes the row" only checked the pending case. It now also renders an approved disposition and asserts that the row reads dispositioned and that nothing more is offered.
5. **Stale evidence.** The WIP's five logs under `T-DG4-FE-F2-evidence/` (build, lint, openapi-lint, prettier, typecheck) are overwritten with this run's output. Nothing from before this run is cited.

### Added

- **Unit tests** (4 new tests: 2 cases × 2 languages; 3 more strengthened):
  - phases: "a step with no record is read with ETag "0" and its first save sends If-Match "0"" (replaces the WIP's start test);
  - change requests: "a KPI target change (REQ-S07-015): the draft version's diff is the change; the preview lists the benefit and the G2 approval";
  - G5: "scaling outside the approved G5 scope shows the translated `scale.outside_approved_scope` refusal", and the approved-disposition half above.
- **e2e:**
  - step 1 asserts the `getPhaseStep` read (`etag: "0"`) before the `If-Match: "0"` PATCH;
  - **new step 5b**, on the real stack: the Sponsor approves the disposition (synthetic), and the risk row reads dispositioned while G5's live "Risk closure" criterion reads Complete (screenshot `p4-scale-02`). G5 is then approved with the scale scope (initiative, Retail) through the API. In the UI, scaling an initiative the scope does not name is refused with `scale.outside_approved_scope`, translated, and scaling inside the scope is recorded and listed.

## 1. Changed files (against `983fdfa`)

| File | Purpose |
|---|---|
| `apps/web/src/pages/change-requests/api.ts` (new) | Paths and read hooks: policy (with ETag version), list, one, live preview, assessments; materiality-basis and proposed-change readers; the T11 row of each kind |
| `apps/web/src/pages/change-requests/subjects.ts` (new) | The records of each subject type with the server's `from` field names and versions; kinds per subject (`KIND_SUBJECTS`); the KPI version diff (decimal-normalised) |
| `apps/web/src/pages/change-requests/CreateChangeRequest.tsx` (new) | The raise form, `buildChangeRequestBody`, the KPI diff note, the forecast shown separately, the draft impact preview |
| `apps/web/src/pages/change-requests/ChangeRequestsPage.tsx` (new) | The list and the materiality policy (version 0, `If-Match: "0"`) |
| `apps/web/src/pages/change-requests/ChangeRequestPage.tsx` (new) | One request: facts, route, edit, submit / round 2, withdraw, live preview, frozen assessments |
| `apps/web/src/pages/change-requests/Impact.tsx` (new) | Materiality text and the impact-items table (translated, preserved gate approvals, hidden-item count) |
| `apps/web/src/pages/change-requests/ChangeStatus.tsx` (new) | Status text with icon (never colour alone) |
| `apps/web/src/pages/phases/api.ts` (new) | Catalogue, workspace, review queue, evidence and `usePhaseStep` (ETag version) |
| `apps/web/src/pages/phases/PhasesPage.tsx` (new) | Catalogue, phase workspace, step actions and dialogs, evidence, review queue |
| `apps/web/src/pages/gates/ScaleRisk.tsx` (new) | G5 risk dispositions and scale transitions |
| `apps/web/src/pages/gates/GateDetailPage.tsx` | +3 lines: import and render `G5ScaleAndRisk` on G5 |
| `apps/web/src/app/router.tsx`, `app/nav.ts`, `components/Workspace.tsx`, `i18n/index.ts` | Append-only: 3 routes (the 2 planned `change-requests` entries replaced by a comment), 2 nav sub-pages, 2 workspace tabs, 2 namespaces |
| `apps/web/src/i18n/{en,ar}/changeRequestsP4.json`, `phasesP4.json` (new) | Namespaces |
| `apps/web/src/i18n/{en,ar}/gates.json`, `nav.json` | Appended keys (§6) |
| `apps/web/src/pages/change-requests/change-requests.test.tsx`, `phases/phases.test.tsx` (new), `gates/g5-g6.test.tsx` | Unit tests |
| `apps/web/src/pages/my-work/my-work.test.tsx` (FE-A's test, 8 lines) | Its "planned P4 route" example was `/change-requests`, now built; it takes the first remaining `P4_PLANNED_ROUTES` entry (today `traceability`, FE-G2's). If FE-G2 builds that route in this wave, the list is empty and the test returns early: the orchestrator may want to retire it at merge. |
| `apps/web/e2e/p4-change-phases.spec.ts` (new) | 7 real-stack journeys per language |
| `apps/web/e2e/p4-governance.spec.ts` (FE-A's spec, 6 lines) | Its last step asserted that `/change-requests` is still a planned route (FE-F's edit). It now asserts the built screen and no "being built" placeholder (§3 item 4). Nothing else changed. |
| `docs/delivery/handbacks/DG4/T-DG4-FE-F2-*` | This handback and its evidence |

## 2. Behaviour delivered, per requirement row (acceptance quoted)

These are the screen halves; the backend halves are BE-K, BE-L, BE-L2 and BE-R2 (merged).

### REQ-PB-014: "A01;A02: API returns exactly six phases in order with names and purposes matching B0021; each phase page shows its objective text"
- The catalogue table lists `GET /phases` sorted by ordinal: name, gate, purpose and key outputs, verbatim in English, with the provisional Arabic labelled as such (`phasesP4.arProvisional`). e2e step 1 asserts exactly six rows in the order diagnose → realize.
- Each phase panel shows its objective (`data-phase-objective`, non-empty in e2e).

### REQ-S04-001: "A02: each of the six phases shows steps, required evidence, owners and a review queue; a step with an unmet completion rule cannot be marked complete via the API"
- Each phase panel lists its steps with procedure, required evidence, owner ("Unknown" chip when unassigned, plus the default role), reviewer role, completion rule and status. The review-queue section lists every step `in_review`, and each phase button counts its queue.
- e2e step 1: the Lead assigns the owner of a version-0 step (`getPhaseStep` `ETag: "0"`, then `If-Match: "0"`) and starts it. Requesting review with no verified evidence shows the translated `phase_step.completion_rule_unmet` (in Arabic, never the English detail).
- The owner is told they cannot review their own step, and Review is offered to neither the owner nor the requester (unit test).

### REQ-S04-002 (first clause, phase side): "completing every phase task leaves the gate Draft …"
- The page states that completing steps never submits or approves a gate. Steps change no gate status: e2e step 1 shows G1 still at its setup decision after the step changes. The unit test asserts only that the note is shown. The full "every step complete → gate Draft" proof is BE-L2's integration test.

### REQ-S04-014: "A07: changing an approved G4 benefit formula creates a change request; the prior G4 approval and snapshot are still retrievable unchanged"
- Requests raised automatically (a new version of a G4-pinned formula, BE-L's hook) are listed with origin "Automatic" (unit test). Every impact item of type gate reads "G4 approval (submission n) is preserved; this change needs reapproval", with a link to the gate page, where the DG2 snapshot is unchanged. This is shown in the preview, the live preview and each frozen assessment (e2e steps 3–4; after approval, e2e asserts that G4 still reads approved).
- **Not proven on the real stack:** the automatic creation itself (it needs a Finance-validated, G4-pinned formula and a new version through the DG3 route). It is BE-L's integration proof; here it is the stubbed list (§8 item 1).

### REQ-S07-015: "A07: changing a target shows the affected benefit and G2 approval in the preview; the old version remains retrievable"
- A KPI request diffs the KPI's draft version against its active version (decimals compared as decimals, "55.0" = "55") and sends exactly that with `proposedRecordType: kpi_version`. The preview lists the bound benefit and "G2 approval … is preserved" (new unit test, both languages). The old version stays on the KPI screen (FE-B), linked from the request ("Open the record").
- **Stubbed, not e2e** (§8 item 1).

### REQ-S09-010: "A07: a material date change without approval leaves the approved date unchanged and shows the forecast separately"
- The form shows "Approved date … · Forecast …" separately for a milestone (e2e step 3).
- After submit, e2e reads the milestone through the API: `approvedDate` unchanged and `forecastDate` unchanged. Only after the Sponsor's approval (round 2) does `approvedDate` become the requested date (e2e step 4).
- Materiality is shown with its basis. With no calendar configured, the shift reads "Unknown working days" and the request is material, never "0 days" (Arabic screenshot `p4-change-04`).

### REQ-PB-065 (change-request half): "… a change request of type Business scope change routes approval to the Sponsor"
- The detail shows the route party, the T11 row (`business_scope_change` for Business scope) and the approval's assignee.
- e2e step 3 shows a schedule rebaseline routed to the Sponsor (`data-route-party='SP'`). A Business-scope request on the real stack was not exercised. The routing itself is BE-L's proof, and the screen shows whatever party the server returns.

### REQ-S03-004: "A02;A08: a Design-phase draft can be saved before G2; a scale transition before G5 approval returns 422 invalid-transition naming G5; after approval it succeeds"
- e2e step 5: "Scale an initiative" before G5 shows the translated `gate.g5_not_approved` (`data-problem`), containing "G5".
- e2e step 5b: after the G5 approval, scaling inside the scope is recorded and listed.

### REQ-S04-007: "A02;A08: G5 submission with an open material risk lacking resolution or approved disposition is rejected; an approval records the scale scope and later scaling outside it is blocked"
- e2e step 5b: scaling an initiative that the approved scope does not name is refused with the translated `scale.outside_approved_scope`. The choices are not filtered to the scope, so the server's rule is what the user meets. The unit test covers the same refusal in both languages.
- The approved scope is shown (FE-F's section), and the scope editor is FE-F's.

### REQ-PB-020 (native-screen path): "G5 submission with an open High-impact risk and no disposition is rejected listing 'Risk closure' …"
- The G5 page lists the open risks, High impact first and flagged "Material for G5", each with its dispositions and their approval status. A TL, BO or WL proposes accept, transfer or carry into BAU with a residual owner and a rationale, which goes to a business approval.
- A pending disposition reads pending, never closed (e2e step 5). Once approved, the row reads dispositioned and the live "Risk closure" criterion reads Complete (e2e step 5b, screenshot `p4-scale-02`). So the gap can be closed with native screens: the approval itself is decided on the existing approval screen.

## 3. Checks actually run (worktree `/home/user/wt/dg4-fe-f2`, Node 24.21.0, offline; ports 25700–25749)

Logs are in `docs/delivery/handbacks/DG4/T-DG4-FE-F2-evidence/`.

| Command | Exit | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical-start.log`) |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`) |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 649 operations` |
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | 142 files, **2688 passed**; then 3 files, **259 passed / 2 skipped** (`unit-locale-unset.log`) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts (`unit-c-utf8.log`) |
| `QA_PG_PORT=25720 MTH_PORT_POOL=25721-25735 tests/qa/support/with-pg.sh pnpm test:integration` (run 1) | **1** | 187 files, **1779 passed, 1 failed**: `apps/worker/test/integration/benefits-queue.test.ts` "one queue item; a redelivery and a restarted worker write no second item", `waitFor: timed out` (`integration.log`) |
| the same file alone, `with-pg.sh npx vitest run --project integration apps/worker/test/integration/benefits-queue.test.ts` | 0 | 2/2 (`integration-rerun-benefits-queue.log`) |
| full integration, run 2 (ports 25722–25735, while the full e2e ran) | **1** | the same single test, same timeout; 1779/1780 (`integration-run2.log`) |
| full integration, run 3 (after the e2e run) | 0 | 187 files, **1780/1780** (`integration-run3.log`). No pinned count changed. |
| e2e, new spec alone, development runs (`E2E_PG_PORT=25701 E2E_API_PORT=25702 MTH_PORT_POOL=25703-25719 with-stack.sh npx playwright test apps/web/e2e/p4-change-phases.spec.ts --workers=1`) | 1, then 0 | run 1: 12 passed, 2 failed (§3 item 2); run 2: **14 passed** (`e2e-new-spec-dev{1,2}.log`) |
| e2e, full product suite `E2E_PG_PORT=25736 E2E_API_PORT=25737 MTH_PORT_POOL=25738-25749 with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | **306 passed, 3 failed, 3 did not run** (312; 39.9 min under load). Per spec and project: `e2e-full-per-spec.txt`; log `e2e-full.log`. Failures analysed in §3 item 4. |
| e2e re-run of the affected specs `… playwright test apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p4-governance.spec.ts apps/web/e2e/p4-change-phases.spec.ts --workers=1` | 0 | **54 passed**: p2-journeys 12 + 12, p4-governance 8 + 8, p4-change-phases 7 + 7 (en + ar) (`e2e-rerun-3-specs.log`, `e2e-rerun-per-spec.txt`); axe 0 serious or critical issues at every `expectAccessible` step (a serious or critical issue fails the step) |
| `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical-end.log`) |

The 2688 unit tests include this task's 29 tests: `change-requests.test.tsx` 15, `phases.test.tsx` 6 and the FE-F2 block of `g5-g6.test.tsx` 8 (both languages counted). I did not run the suite at the base commit, so I state no delta. No pinned count changed: this task touches no API, schema, migration or contract file.

**Non-zero exits along the way, all disclosed:**

1. **Targeted unit run (exit 1):** my new phases test kept a reference to the loading dialog, which is replaced by the form dialog once `getPhaseStep` answers. The test now looks the dialog up again. Fixed before the final runs.
2. **e2e development run 1 of the new spec (exit 1, `e2e-new-spec-dev1.log`):** 12 passed; step 5b failed in both languages. The outside-scope case chose a second business unit, but the Lead can read only the transformation's own unit (FE-F handback §5 item 1). This is a test-design error, not a product defect: the step now uses a second initiative in Retail, which is also outside the approved (initiative, unit) pair. Run 2 (`e2e-new-spec-dev2.log`): exit 0, 14 passed.
3. **Integration: one worker timing test, not caused by this task.** `benefits-queue.test.ts` timed out waiting 15 s for the production worker's queue item in full runs 1 and 2. Both ran while three other agents and (run 2) my full e2e suite were loading the machine. It passed alone, and full run 3 passed 1780/1780. The integration project includes only `apps/*/test/integration`, `packages/*/test/integration` and `tests/qa/integration`, none of which imports `apps/web`, and this task changes no file outside `apps/web/**` and `docs/**`. So the integration result does not depend on this change. The file that ran before it differed between the two failures (`bu-hierarchy-guard`, `a12-cross-scope`), which points to timing rather than order. I did not raise the timeout. The orchestrator may want KBE-E's owner to look at the 15 s `waitFor` under load.
4. **The full e2e run** (exit 1):
   - **`p4-governance.spec.ts` "administration … Transform readiness", en and ar: caused by this task.** FE-F had changed its last step to assert that `/change-requests` still shows the "being built" placeholder, and this task builds that route. Fixed in that spec (FE-A's file, 6 lines, §1): it now asserts the built Change requests section and no placeholder. It passes in the re-run, 8 + 8.
   - **`p2-journeys.spec.ts` "Define → G2 … G2 is decided", en: a 30 s timeout under load** (32.1 s; then `page.reload: Target page … has been closed`). It is the same step and the same symptom FE-F reported (FE-F handback §3 item 3). This task does not touch the G2 path. The 3 tests after it in that serial spec did not run. The ar project passed it. Re-run alone with the other two specs: 12 + 12 passed, no timeout. No timeout was raised.

## 4. Screenshots and interaction checks (both languages)

Screenshots are in `T-DG4-FE-F2-evidence/screenshots/{en,ar}/` (15 per language from the final run of the spec, plus `p4-22-change-requests-built` from `p4-governance.spec.ts`). Each step below also ran axe (`wcag2a/aa`, `wcag21a/aa`) with 0 serious or critical issues.

- `p4-phases-01-catalogue-workspace`: catalogue, Diagnose panel, Unknown owners, empty queue.
- `p4-phases-02-completion-rule-unmet`: the translated 422.
- `p4-change-01-policy`: policy after the first save (version 1, 5 working days).
- `p4-change-02-raise-preview`: raise form, forecast shown separately, draft preview with the preserved G4 approval.
- `p4-change-03-saved-draft`: the saved-draft banner.
- `p4-change-04-submitted-assessment`: routed to the Sponsor, the frozen assessment with SHA-256.
- `p4-change-05-round-2`: round 2 with two frozen assessments.
- `p4-change-06-approved-applied`: approved and applied.
- `p4-scale-01-refused-before-g5`: `gate.g5_not_approved`, naming G5.
- `p4-risk-01-disposition-pending`: a pending disposition, not closed.
- `p4-scale-02-outside-scope-refused`: Risk closure complete after the approved disposition; the outside-scope refusal.
- `p4-scale-03-inside-scope-recorded`: the recorded transition.
- `p4-change-07-auditor-read-only`: no write action for AUD.
- `p4-change-08-390px` and `p4-change-09-200pct-text`: phases, change requests, one request and G5 at 390 px, and phases and one request at 200 % text, with no page-level horizontal scroll (asserted, ≤ 1 px).

Interaction checks run on the real stack:

- keyboard-operable dialogs with one form-level alert each;
- required fields refused before sending;
- the `If-Match: "0"` headers inspected on the wire (phase step PATCH, policy PUT);
- the AUD user offered no write action;
- every request on the application origin (`trackRequests`, steps 1, 3 and 5b).

## 5. Operations routed (delta to the pending list)

Frontend tasks have no `p4-pending-*` list, so the delta is **0** and no API file is touched. The screens call these existing, routed operations:

- `getChangeControlPolicy`, `putChangeControlPolicy`, `listChangeRequests`, `createChangeRequest`, `previewChangeImpact`, `getChangeRequest`, `updateChangeRequest`, `submitChangeRequest`, `withdrawChangeRequest`, `getChangeRequestImpactPreview`, `listImpactAssessments`;
- `listPhases`, `getPhaseWorkspace`, `listPhaseSteps`, `getPhaseStep`, `updatePhaseStep`, `requestPhaseStepReview`, `reviewPhaseStep`, `listPhaseStepEvidence`, `linkPhaseStepEvidence`, `removePhaseStepEvidence`;
- `listScaleTransitions`, `createScaleTransition`, `listRiskDispositions`, `createRiskDisposition`;
- reads: `getApproval`, `listRaidEntries`, the KPI dictionary and versions, outcome KPIs, the TOM canvas, initiatives, benefit formulas, milestones, budget lines, the charter, the evidence register, business units.

`getImpactAssessment` and `getRiskDisposition` are not called: the list operations return the same bodies.

## 6. i18n keys added (EN and AR, identical key sets)

- **`changeRequestsP4.json`** (new, 210 leaves) and **`phasesP4.json`** (new, 90 leaves).
- **`gates.json`** (appended): `tableRegion.dispositions`, `scaleTransition.*` (9), `riskDisposition.*` (34, including `kind.*`, `level.*`, `approval.*`), plus `scale.unitNotVisible` and `scale.initiativeNotVisible`.
- **`nav.json`:** `subpages.phaseWorkspace`, `subpages.changeRequests`.
- **`problems.json`: nothing added.** Every ADR-0036 §10 code, the A3 codes (`validation.proposed_change`, `_size`) and every phase-step, scale and disposition code shown here was already placed by FE-R1. I checked each one in both locales, and a unit test asserts an Arabic text for every `CHANGE_CONTROL_REFUSALS` code.
- **Provisional Arabic:** the phase and step texts carry the server's `arProvisional` note. The other Arabic UI texts await the usual language review.

## 7. Contract or schema needs (for the orchestrator)

1. **Business units for scaling** (as FE-F §5 item 1): the Lead (and the Sponsor) cannot read the organization's units, so the scale-transition and scope forms offer only the transformation's own unit (plus any the caller may read). Scaling into another unit therefore needs `business_unit.read`, or a read of the units a transformation may scale into. This is a design point for ARCH.
2. **A request's subject values on edit.** The edit dialog of a saved request sends `from` for a newly added field as null, because no operation returns the subject's current values with the request. The server refuses a wrong `from` (422 `proposed_change_invalid`, translated). A `subjectValues` member on `ChangeRequest` would let the edit offer every field safely.

## 8. What remains

1. **Real-stack proofs left to the backend tests:** the automatic change request from a G4-pinned formula version (REQ-S04-014) and the KPI-target preview naming the benefit and G2 (REQ-S07-015). Each needs a long KPI, benefit and Finance setup that this spec does not rebuild. Both screens are proven with stubbed responses in both languages and by BE-L's integration tests. QA-B may want a seeded fixture for an A07 e2e.
2. **A Business-scope request routed to the Sponsor** was not exercised on the real stack (REQ-PB-065). The route display is generic, and BE-L proves the routing.
3. **Design-phase draft before G2** (REQ-S03-004 first clause) is a DG2 behaviour and was not re-proven here.

## 9. Final runs and time

- The final `pnpm lint` (`lint-final.log`, exit 0) and the prettier check of the two edited specs ran after the last edit. The repository-wide prettier check (`prettier.log`) ran before the `p4-governance.spec.ts` edit; that file was checked on its own afterwards ("All matched files use Prettier code style!").
- `date -u` at the end: `Sat Oct 10 11:28:46 UTC 2026` (`time-end.txt`). About 1 h 49 min, within the 2-hour limit.
- Disk was checked before each full run (`disk-before-unit.txt`, `disk-before-e2e.txt`: 18 GB free).

## 10. Merge instructions

- No migration, API, schema or contract change.
- Union merges are expected in:
  - `router.tsx`: 3 routes and 3 imports; the 2 `change-requests` planned entries replaced by a comment;
  - `nav.ts`: 2 tab ids, 2 sub-page ids, 2 `NAV_SUBPAGES` lines;
  - `Workspace.tsx`: 2 tabs at the end;
  - `i18n/index.ts`: 4 imports, 2 lines per locale;
  - `en|ar/nav.json` and `en|ar/gates.json`: keys appended.
- `p4-governance.spec.ts` (FE-A's): 6 lines in the last step (§1).
- `my-work.test.tsx`: see §1. If FE-G2 removes `traceability` from `P4_PLANNED_ROUTES`, the test becomes a no-op.
