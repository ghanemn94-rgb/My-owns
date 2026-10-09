# Handback T-DG4-BE-L: change requests, materiality, impact preview and assessments, the approval subject, the hook lines (backend-workflow-engineer)

- **Stage:** DG4 (P4 "Execution value and sustainment"), task T-DG4-BE-L, p4-work-split §H H.3 (ADR-0036).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-L-backend-workflow-engineer-20261009T160443Z-412d8e8e","session_id":"412d8e8e-e66e-498b-90aa-87703a3769ab"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-L.md` (sha256 `c57ac575…ae58e1`, verified at start).
- **Worktree / branch / base:** `/home/user/wt/dg4-be-l`, `dg4/be-l`, base `HEAD` `89df7f7` ("DG4: W10 assignments ARCH-08, BE-J, BE-K, BE-L"). Changes are **uncommitted** for the orchestrator.
- **Time:** start `2026-10-09T16:04:54Z`; end recorded in §7.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → exit 0, `PASS gate DG3 (historical)` (at start, and again after implementation: `T-DG4-BE-L-evidence/validate-historical-DG3.log`).
- **Two gate systems.** A change request is decided by a **person** through the canonical P4 approval (`POST /approvals/{id}/decisions`, approval type `change_request`, SoD `requester_excluded`). No job, timer or seed decides one; the `0052` trigger refuses an outcome without that person's decision row. Applying an approved change never edits `gate_submission`, `gate_submission_criterion` or `gate_decision`. Nothing here reads or writes the engineering gates DG0–DG7. All test data is synthetic, and every decision in the tests is a demo business decision that approves nothing real.

## 1. Changed files

**New**

| File | Purpose |
|---|---|
| `apps/api/src/modules/workflows/change-requests.ts` (was the BE-A stub) | `getChangeControlPolicy`, `putChangeControlPolicy` (If-Match `"0"` creates), `listChangeRequests`, `createChangeRequest` (subject lock 730246 via `ADVISORY_LOCK_CLASSES.changeRequestSubject`), `getChangeRequest`, `updateChangeRequest`, `submitChangeRequest` (materiality, the frozen impact assessment, `requestApprovalInTx` routed per ADR-0036 §4), `withdrawChangeRequest`. Also: the `change_request` approval subject provider (`applyChangeRequestOutcome`: apply on approve, or rejected / changes_requested / withdrawn); the `MaterialChangePort` implementation (automatic `benefit_logic` request; the two threshold refusals); and the KPI-activation setter `setKpiVersionActivator`. |
| `apps/api/src/modules/workflows/impact.ts` (was the BE-A stub) | `previewChangeImpact`, `getChangeRequestImpactPreview`, `listImpactAssessments`, `getImpactAssessment`; the exported pure `deriveImpactItems(facts)`, `impactContentSha256(items)` and the read-only `loadImpactFacts` (ADR-0036 §5). |
| `apps/api/src/modules/platform/material-change.ts` | The `MaterialChangePort` **type** and its registry (`setMaterialChangePort` / `materialChangePort`). |
| `packages/shared/src/schemas/change-control.ts` | Zod mirrors (`ChangeControlPolicy*`, `ChangeRequest*`, `ImpactItem`, `ImpactPreview`, `ImpactAssessment*`); `proposedChangeSchema(kind, subject)` per ADR-0036 §2; the exact ADR-0036 §10 texts (`CHANGE_CONTROL_REFUSALS`); the pure decimal.js / working-day materiality rules (`dateShiftMateriality`, `budgetChangeMateriality`). |
| `apps/api/test/integration/workflows/change-requests.test.ts` | 10 tests: policy; CRUD and refusals; REQ-PB-065 routing, SoD and the frozen assessment; REQ-S09-010 (×2); REQ-S07-015; REQ-S04-014; S-4 commit-time; S-1 free text. |
| `apps/api/test/integration/workflows/impact.test.ts` | 3 tests: pure derivation and SHA-256; TOM change after G3 with changes-requested → resubmission (one assessment per submitted version); charter scope change after G1 (new charter version) and scoped reads. |
| `apps/api/test/integration/workflows/change-fixtures.ts` | Synthetic fixtures for the two test files, the contract exercises and the entity-group case: approval world + KDS + FIN mapping; `approveGate` writes a real approved `gate_decision`; KPI, benefit and formula helpers. **This is a new support file not named in §H.3** (the `execution-fixtures.ts` precedent). |

**Edited (named hook and wiring lines)**

| File | Lines |
|---|---|
| `apps/api/src/modules/kpi/kpi-versions.ts` | The ADR-0036 §6 item 2 check in activation (422 `kpi_version.change_request_required` when an active version exists and the call is not the change-request path), and the exported CR-apply entry point `activateKpiVersionByChangeRequest` (same activation rules; supersedes the old version, which stays readable). |
| `apps/api/src/modules/kpi/benefit-formulas.ts` | The hook call after a new formula version (`versionNo > 1`) is inserted (`insertFormulaVersion`), through `materialChangePort()`; fails closed (500) if unwired; plus one import name. |
| `apps/api/src/modules/portfolio/milestones.ts` | The 422 `milestone.rebaseline_requires_change_request` check in `approveMilestoneDate`, through the port; plus one import name. |
| `apps/api/src/modules/portfolio/budget.ts` | The 422 `budget_line.rebaseline_requires_change_request` check in BE-E's `updateLine`, through the port; plus one import name. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP4ChangeControlError` (the `0052` constraints) and its one dispatch line. |
| `apps/api/src/modules/platform/index.ts` | Export line of `material-change.ts` (see §5, item 4). |
| `apps/api/src/server.ts` | Wiring: `setMaterialChangePort(materialChangePortImpl)` and `setKpiVersionActivator(activateKpiVersionByChangeRequest)`, with their imports (the KBE-C/BE-D composition-root import precedent). |
| `packages/shared/src/schemas/index.ts` | One export line. |
| `apps/api/test/support/p4-pending-be-l.ts` | The list is now empty (12 operations routed). |
| `apps/api/test/integration/contract/p4-exercises-be-l.ts` | The 12 mirrors and exercises. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[280, 279, 1]` → `[284, 283, 1]`, with its comment. |
| `apps/api/test/integration/raid/entity-group.test.ts` | The ChangeRequest case, **append-only** (one import line and one `describe` at the end; `git diff` shows 29 insertions, 0 deletions). |

`workflows/index.ts` and `kpi/index.ts` are **not** changed. Both modules pin their exact public exports (`workflows.test.ts`, `kpi.test.ts`), so cross-module wiring goes through the platform port and `server.ts` instead.

## 2. Behaviour delivered, per requirement row

### REQ-S04-014: "A07: changing an approved G4 benefit formula creates a change request; the prior G4 approval and snapshot are still retrievable unchanged" (automation: "Material change → create change request and route")

- **Automatic request.** `POST /benefit-formulas/{id}/versions` (DG3) on a formula pinned by an **approved** G4 snapshot (`snapshot->'g4'->'formulaVersions'` contains the formula, with an approved `gate_decision`) creates **one** change request in the same transaction. It has `origin = 'automatic'` and `benefit_logic`, is raised by the editor and names the new version, and is submitted and routed to **FIN** with a frozen impact assessment whose G4 gate item names the preserved submission and decision. If FIN is unmapped, the request stays a visible draft, so the DG3 call never fails.
- **DG3 response unchanged.** Same members and headers as an unpinned formula's new version (asserted).
- **G4 approval preserved.** The G4 `gate_submission` row, the `gate_decision` row and `GET …/gates/G4/submissions/1` read back **byte-identical** before the change, after it, after Finance approves it, and after a later refused decision (`change-requests.test.ts`, the REQ-S04-014 test).
- **One open request per subject.** While the request is open, a further version raises nothing more; after the approval, the next version raises a new one.
- **Stale subject.** Deciding a request after a newer version exists is 409 `change_request.subject_moved`, and nothing is applied.
- **Other proofs.** The requester cannot decide (403). The impact assessment is append-only (an UPDATE is refused; the `mth_app` role has no UPDATE grant), and its `contentSha256` equals the SHA-256 of the canonical JSON of its items. Each submitted version gets its own frozen assessment, and the first is unchanged after a resubmission (`impact.test.ts`).

### REQ-S07-015: "A07: changing a target shows the affected benefit and G2 approval in the preview; the old version remains retrievable" (automation: "Change request → impact preview")

- **Preview.** `POST …/change-requests/impact-preview` of a `target` change on a KPI lists:
  - the linked outcome;
  - the benefit measured by the KPI (`value_changes`);
  - the **G2** gate item naming the approved G2 submission and its `gate_decision` (`reapproval_required`);
  - the T10 Outcomes report area.
- **Old version retrievable.** After BO approves the request, version 2 is active, and version 1 is `superseded` and readable through `GET …/kpi-versions/{v1}`. The test also checks one audit event each (create, activate / supersede), one `kpi.version_activated` outbox event, and the request's own audit trail (create, submit, approve).
- **Direct second activation refused.** It is 422 `kpi_version.change_request_required`, with the exact ADR text.
- **SoD.** A BO who raises the request and is also the routed assignee gets 403 `approval.sod_requester`.
- **Withdrawal.** A request in approval is withdrawn through its approval, and the request follows in the same transaction (see §5).

### REQ-S09-010: "A07: a material date change without approval leaves the approved date unchanged and shows the forecast separately"

- **Change-request path.** While a `schedule_rebaseline` request is submitted, `GET /milestones/{id}` shows `approvedDate` unchanged and `forecastDate` separately. After SP's approval, `approved_date` becomes the requested date, with `approved_by` = the approver and `approval_reason` = "Change request CR-nn: reason".
- **Moved subject.** If the milestone moved after submission, the decision is 409 `change_request.subject_moved`, and `approved_date` and the request are unchanged.
- **Thresholds.** `PUT …/change-control-policy` (If-Match `"0"` creates; 428/409; 422 `change_control.threshold_invalid`; AUD/WL 403; outside and ADM 404).
  - With **no** policy, the DG3 re-approval is unchanged (200).
  - With 5 working days configured, a re-approval beyond it is 422 `milestone.rebaseline_requires_change_request`, and one within it is 200.
  - Budget likewise: 422 `budget_line.rebaseline_requires_change_request` beyond a 0.1 ratio, 200 within it.
  - The preview's ratio is a decimal string (`"0.100000"`); there is no float.
- **Calendar.** Working days use the organization's default calendar (`computeWorkingDaySlip`). With no calendar, the shift is Unknown and counts as material, never "not material".

### REQ-PB-065 (the change-request half): "a change request of type Business scope change routes approval to the Sponsor"

- A `business_scope` request is routed through the T11 row `business_scope_change`. The approval's assignee is the person mapped to **SP** (`assignee.userId = sponsor`), and `decisionRightId` is that T11 row.
- The requester (TL), a non-assignee (BO) and an ADM-only user cannot decide (403). SP approves and the initiative change is applied (version + 1, audit `initiative.change_request_applied`).

### REQ-S16-018 (ChangeRequest case): "… an integration test creates and reads each one through the API with authorization enforced"

- `raid/entity-group.test.ts` now covers ChangeRequest. It creates one through the API and reads it back (owner `raisedBy`, status `draft`, code `CR-nn`). An AUD caller gets 403 on the write; the other-organization office and the ADM-only technical admin get 404 on the write and the read (7/7 pass, `entity-group-test.log`).

### Shared rules (S-1 to S-14) as applied

- **S-1 free text.** Text fields use `freeText`; the reason is 3–4000 characters. Blank → 400 `change_request.reason_required` at `/reason`. U+0000 → 400 `validation.invalid_character`. Stored labels are cut with `truncateText`.
- **S-2 strict UTF-8.** Only the platform parser is used.
- **S-3 `config.consumes`.** `application/json` on the four body operations; the bodiless submit and withdraw declare none.
- **S-4 every mutation.** Each mutation has:
  - commit-time re-authorisation (`openWrite … atCommit`), proven by a TL revoked mid-request on raise, edit, submit, withdraw and the policy PUT: 403, nothing written;
  - validation;
  - If-Match 428/409, and creates at version 1;
  - one audit event in the same transaction (counted in the tests);
  - no remote I/O inside the transaction.
- **S-5.** Decimal strings and decimal.js only.
- **S-6.** Problem codes are i18n keys.
- **S-11.** The exact ADR-0036 §10 texts, asserted literally.
- **S-13/S-14.** The approval is requested only through `requestApprovalInTx`. No approval, decision or escalation row is written by this module.

## 3. Checks actually run (real exit codes; logs under `docs/delivery/handbacks/DG4/T-DG4-BE-L-evidence/`)

Environment: Node 24.21.0, offline; PostgreSQL from `tests/qa/support/with-pg.sh` on harness ports 24450–24499 (`QA_PG_PORT=24452 MTH_PORT_POOL=24453-24499` for the full run; `24495` strict for the targeted runs). Free disk before each full run was 22–23 GB (`df -h .`).

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 1 | `pnpm -r build` | 0 | `build.log` |
| 1 | `pnpm lint` | 0 | `eslint . --max-warnings=0`, `lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!", `prettier.log` |
| 1 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 607 operations`, `openapi-lint.log` |
| 2 | `pnpm test`, locale unset (`LANG`, `LC_ALL`, `LC_CTYPE` unset) | 0 | First invocation 120 files, **2290 passed**; second (`unit-formula-nocodegen`) 3 files, **259 passed, 2 skipped**. `unit-locale-unset.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | Same counts: 2290 passed; 259 passed, 2 skipped. `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=24452 MTH_PORT_POOL=24453-24499 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | 134 files (133 passed, 1 failed); **1426 passed, 1 failed of 1427**. The one failure is the KBE-B test explained below. `integration.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)`, `validate-historical-DG3.log` |
| – | Targeted: `change-requests.test.ts` 10/10, `impact.test.ts` 3/3, `raid/entity-group.test.ts` 7/7, `contract.test.ts` 45/45 | 0 | `change-requests-test.log`, `impact-test.log`, `entity-group-test.log`; the contract run is in the full integration log |

**Non-zero exits and failures, disclosed.**

1. **The integration suite exits 1 on exactly one test, owned by KBE-B:** `kpi-p4/versions.test.ts › version lifecycle › … activation supersedes the previous version`. That test activates version 2 of a KPI directly. ADR-0036 §6 item 2, adopted by D-101 ("a second P4 KPI version needs an approved change request"), now refuses that with 422 `kpi_version.change_request_required`, so the failure is the intended behaviour change, not a regression. I may not edit that file.
   - **Proposed patch:** `T-DG4-BE-L-evidence/proposed-kbe-b-versions-test.patch`. It asserts the 422 and that nothing was activated (v1 still active, no audit or outbox event for v3), and keeps the rest of the test.
   - **Patch verified:** I applied it temporarily, ran that file (10/10 pass, `proposed-kbe-b-patch-verification.log`) and restored the original (`git diff` empty).
   - **Coverage kept:** the activation, supersede and outbox assertions the patch removes are asserted on the change-request path in my REQ-S07-015 test.
2. **Earlier runs during development** were not acceptance runs:
   - A first full integration run (16:32Z) was 1420/1421, with the same single KBE-B failure.
   - A first unit run (16:58Z) had 4 failures caused by my own first wiring: new exports in the `kpi` and `workflows` index files, which break their export pins; lock-class numbers in comments; and a POST declared `transformation.read`. I fixed all four before the final runs.
   - One background launch was killed when its wrapper shell exited (no results). It was relaunched, and its log files were overwritten by the real runs.

**Media-type pin delta (for the orchestrator's reconciliation):** +4 JSON bodies, from base `[280, 279, 1]` to `[284, 283, 1]` (`putChangeControlPolicy`, `createChangeRequest`, `previewChangeImpact`, `updateChangeRequest`).

**Integration count delta:** +14 tests (`change-requests.test.ts` 10, `impact.test.ts` 3, `entity-group.test.ts` +1). The base is 1413 (D-105), so the expected total is 1427.

**Not run:** the e2e suite (not in this assignment's acceptance list). `apps/web/e2e/p4-kpi.spec.ts` activates a KPI's first version only, so I expect it to be unaffected, but this was **not verified**.

## 4. Operations routed (delta to `p4-pending-be-l.ts`)

`P4_PENDING_BE_L` went from 12 to **0**. All 12 are routed and exercised through `ctx.mirrored` with zod mirrors in `p4-exercises-be-l.ts`:

- `getChangeControlPolicy`, `putChangeControlPolicy`
- `listChangeRequests`, `createChangeRequest`, `getChangeRequest`, `updateChangeRequest`
- `submitChangeRequest`, `withdrawChangeRequest`
- `previewChangeImpact`, `getChangeRequestImpactPreview`
- `listImpactAssessments`, `getImpactAssessment`

## 5. Contract, schema and decision needs for the orchestrator

1. **Contract defect: version 0 vs the ETag pattern.** `getChangeControlPolicy` documents "version 0 when none is configured", but the shared `ETag` header pattern is `^"[1-9]…"$` and `Problem.currentVersion` has `minimum: 1`. As built:
   - the GET at version 0 answers `ETag: "0"`, the value the PUT's `If-Match "0"` takes;
   - the 409 for a stale `If-Match` while no row exists omits `currentVersion`;
   - my test calls that one GET with `contract: false`, and every other call is contract-checked.

   Architect fix: allow `"0"` for this operation's ETag (or drop the header at version 0).
2. **One in-transaction export is missing from `workflows/approvals.ts`** (BE-B's file, frozen to me). Without it, two flows are two-step:
   - **Resubmission after "changes requested":** `submitChangeRequest` freezes the new assessment and returns the request to `submitted`; the requester then calls `POST /approvals/{id}/resubmit` with the request's new version (tested in `impact.test.ts`).
   - **Withdrawing a request in approval** is done through `POST /approvals/{id}/withdraw`, whose outcome withdraws the request in the same transaction. `withdrawChangeRequest` on such a request returns 422 **`change_request.withdraw_via_approval`** ("This change request is in approval; withdraw its approval instead."). **This code is not in ADR-0036 §10**; it needs architect acceptance and EN/AR text.

   Exporting `resubmitApprovalInTx` and `withdrawApprovalInTx` (the route bodies with an audit context) would make both one call.
3. **T11 routing uses `defaultDecisionRightRouter`.** BE-C's `routeByDecisionRight` is registered privately with `setDecisionRightRouter` and has no getter. For `business_scope_change`, `funding_reallocation` and `target_state_design` the default router gives the same party and SLA type. Any BE-C-specific SLA refinement is not applied to change requests.
4. **Edits outside the literal §H.3 list (one line each):**
   - an export line in `platform/index.ts` (needed for kpi and portfolio to import the port type and getter; modules may only import `index.ts`);
   - `material-change.ts` also carries the two threshold checks, so portfolio does not import workflows' index, which is export-pinned;
   - the new support file `change-fixtures.ts`.
5. **Interpretations to confirm** (ADR text; listed for the reviewers):
   - **"Approved record" per subject:**
     - charter: G1 approved;
     - KPI: has an active version;
     - outcome KPI: G2 approved;
     - TOM cell: G3 approved;
     - initiative: `selected` or later;
     - benefit formula: a Finance-validated version, or pinned by an approved G4;
     - milestone: has an approved date;
     - budget line: active, with an amount.
   - **`from` values must equal the subject's current values**, or the change is 422 `proposed_change_invalid` at `/proposedChange/<field>/from`.
   - **Retrospective restatement** is detected only through an optional `proposedChange.effectiveFrom` earlier than today's business date.
   - **`cost` on an initiative** records the approved basis and changes no initiative field, because amounts live on budget lines.
   - **`hiddenItemCount` is always 0.** Every derived record lies inside the transformation the caller already reads.
   - **The "Unknown" display of a NULL `from`** in the preview exists only through `materialityBasis.reason = "unknown_value"`; the items carry no values.
6. **No migration or schema change was needed.**

## 6. What remains

- **The KBE-B test conflict.** Apply the proposed patch, or ask KBE-B to adjust `kpi-p4/versions.test.ts`. Until then, `pnpm test:integration` exits 1 on that one test.
- **The contract and decision items in §5:** the ETag at version 0; the approval in-transaction exports; the `withdraw_via_approval` code; EN/AR texts for the ADR-0036 §10 codes, which FE-A must request.
- **BE-L2 (§H.4)** follows: it appends its exercises to `p4-exercises-be-l.ts` and its block after mine in `db-errors.ts`.
- **Merge notes.**
  - `db-errors.ts`: my mapper is a separate function with one dispatch line placed after BE-I2's. BE-K/BE-K2 blocks merging concurrently need the usual "no dangling case" check.
  - `contract.test.ts`: pin +4.
  - `server.ts`: two wiring lines and three imports.

## 7. End

- End time: 2026-10-09T17:52:21Z (about 1 h 50 min after the start).
- The final unit and integration runs ran on the final tree (after the last source change at about 17:35Z). The static checks were re-run on the same tree before them.
