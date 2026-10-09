# Handback T-DG4-BE-C: T11 decision rights, T12 RACI, governance matrices and Transform readiness (backend-workflow-engineer)

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING). Task `T-DG4-BE-C`, p4-work-split §I+C.3.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-C-backend-workflow-engineer-20261009T054033Z-4b7350dd","session_id":"4b7350dd-92bd-4890-8d81-0ee215c13876"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-C.md` (sha256 `1f7e68ad…242507`, verified at start).
- **Base:** branch `dg4/be-c` at `b48147a` (integrated `HEAD`). The changes are left **uncommitted** for the orchestrator.
- **Time:** `date -u` at start: `Fri Oct  9 05:40:46 UTC 2026`; at the end of the final checks: `Fri Oct  9 06:36:21 UTC 2026`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` exited **0** (`PASS gate DG3 (historical)`), both at the start and at the end (§3).
- **Two gate systems.** The matrix approvals and `decision_request` approvals here are **business** approvals inside the product, decided by the named person mapped to the party. No code, seed, job or test of mine grants a real business, Finance or IT approval. All test data is synthetic. Nothing here reads or writes DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/governance/decision-rights.ts` | The six T11 operations, `routeByDecisionRight(tx, transformationId, keyOrId)`, `computeDecisionRightDue` (the three SLA types of D-089 Q6), the `NextForumDateProvider` interface with the default "none" (`NO_FORUM_DATES`, `setNextForumDateProvider` for BE-F), and the approval service's router (`setDecisionRightRouter(decisionRightRouter)` at registration). |
| `apps/api/src/modules/governance/raci.ts` | The four T12 operations: cells saved as one change under lock 730225, the value and one-accountable checks with the ADR's exact texts, and the pure `accountableCount` and `accountabilitySatisfied`. |
| `apps/api/src/modules/governance/matrices.ts` | `listGovernanceMatrices` and `submitGovernanceMatrix`. Also `reviseMatrix`, which every T11/T12 write calls: it takes lock 730226, refuses with 422 while the matrix is in approval, bumps the header version, and turns approved back into draft. And the `governance_matrix_change` subject provider (`registerApprovalSubject`, `onOutcome`). |
| `apps/api/src/modules/portfolio/readiness.ts` | The PB-008 lines: the pure `transformReadinessChecks`, `loadTransformReadiness` and the new route `GET …/readiness/transform`. The DG3 handler is untouched; its registration function's return line also registers the new route (§4.4). |
| `apps/api/src/modules/transformations/routes.ts` | The one-line switch from `p3_instantiate_transformation` to `p4_instantiate_transformation()` (plus a two-line comment). |
| `packages/shared/src/schemas/governance.ts` (new) | The zod mirrors of the 13 operations' bodies (`DecisionRight*`, `DueDatePreview`, `Raci*`, `GovernanceMatrix*`, `TransformReadiness`). |
| `apps/api/test/support/p4-pending-be-c.ts` | Now empty (13 operations routed). |
| `apps/api/test/integration/contract/p4-exercises-be-c.ts` | Exercises all 13 operations through `ctx.mirrored`, including refusals, and their zod mirrors (`P4_MIRRORS_BE_C`). |
| `apps/api/test/integration/governance/decision-rights.test.ts` (new) | REQ-PB-065 and REQ-PB-066, plus the T11 mutation rules (11 tests). |
| `apps/api/test/integration/governance/raci-matrices.test.ts` (new) | REQ-PB-067, REQ-S10-009, REQ-S10-007, the matrix approval and REQ-PB-008 (12 tests). |
| `apps/api/src/modules/governance/raci.test.ts` (new) | Unit tests of the one-accountable rule. |
| `apps/api/src/modules/portfolio/readiness-transform.test.ts` (new) | Unit tests of the four Transform readiness checks. |
| **Outside the strict ownership list** (each is an append or a pin, following precedents; see §5) | |
| `packages/shared/src/schemas/index.ts` | One `export * from "./governance.ts"` line (BE-B/KBE-B precedent). |
| `apps/api/src/modules/workflows/index.ts` | An appended export block for BE-B's approval service: `registerApprovalSubject`, `requestApprovalInTx`, `setDecisionRightRouter`, `toApprovals` and four types. BE-B's handback names these as BE-C's interfaces, but `workflows/index.ts` did not export them. Module boundaries (ADR-0002) allow imports only through `index.ts`. |
| `apps/api/src/modules/workflows/workflows.test.ts` | The pinned list of `workflows/index.ts` runtime exports: + those four names, with a comment. |
| `apps/api/test/integration/contract/contract.test.ts` | The media-type pin `[184, 183, 1]` → `[189, 188, 1]` (+5 JSON bodies), with a comment (BE-A/BE-B precedent). |
| `apps/api/test/integration/registers.test.ts`, `apps/api/test/integration/transformations.test.ts` | **Pinned-count change** caused by the instantiation switch: the create's audit events go from 29 to 82 (§3.3). |

**No migration.** No schema need was found (§4).

## 2. Behaviour delivered, per requirement row

### REQ-PB-065 — "A01: four rows seeded verbatim; a change request of type Business scope change routes approval to the Sponsor"

- `GET /api/v1/decision-right-templates` returns the four B0099 rows. A test compares every source column, the party, the SLA type and the chain with the playbook text.
- `POST /transformations` now runs `p4_instantiate_transformation()`, so every new transformation gets its four T11 rows, copied verbatim. A test shows this for a transformation created through the API, along with the two matrix headers and the 36 T12 cells.
- **Routing.** `routeByDecisionRight(tx, transformationId, 'business_scope_change')` resolves the row's Approve party `SP` through `routeToParty` (BE-B), with no fallback, and returns the escalation chain `["SP"]`.
  - A `decision_request` approval on that row is assigned to `{ partyCode: "SP", userId: <the SP-mapped person> }`.
  - With SP unmapped, both the function and the request give 422 `routing.role_unmapped`, and no approval row is written.
- **Split per the work split.** The literal "change request" part is slice H (BE-L calls `routeByDecisionRight(…, 'business_scope_change')`). BE-C proves the same routing with a `decision_request`, as §I+C.6 item 6 assigns.

### REQ-PB-066 — "A09: a Business scope change raised Thursday gets a due date 5 working days later skipping the configured weekend days and holidays"

- `GET …/decision-rights/{id}/due-date?raisedOn=2026-10-08` returns **2026-10-15** on the Sunday–Thursday default calendar.
- After an administrator adds a holiday on Monday 2026-10-12 through the calendar API, the same request returns **2026-10-18** (Friday and Saturday are weekend days). Target-state design (10 working days) then returns 2026-10-25.
- A `decision_request` approval stores the same working-day due date for its request business date, never elapsed days.
- **Other SLA types:**
  - next SteerCo: Unknown `no_steerco_scheduled` with the default provider, and the meeting date once a provider supplies one;
  - urgent route: 422 `decision_right.urgent_not_configured` until `urgentWorkingDays` is set, then working days; an urgent request without a reason is 422 `decision_right.urgent_reason_required`;
  - release plan: Unknown `no_release_date` without a milestone or before its date is approved, and the milestone's approved date after `approve-date`;
  - no default calendar: Unknown `calendar_not_configured`.

### REQ-PB-067 — "A01: seeded RACI matches B0101 exactly; a cell value 'X' is rejected; 'A/R' is accepted"

- `GET /api/v1/raci-template` and `GET …/raci` both equal the B0101 grid, cell for cell, with columns SP, TL, BO, WL, FIN and TD.
- `X` is refused with 422 `raci.invalid_value` ("A RACI cell accepts A, R, C, I or A/R."). A value longer than 3 characters is a 400, by the contract's `maxLength`.
- `A/R` is accepted.

### REQ-S10-009 — "A01: a RACI row with two A entries is rejected; 'A/R' for BAU Handover counts as one accountable"

- Two A entries give 422 `raci.accountable_count` with the exact ADR text: "… Charter has 2."
- Zero A entries are also refused, and nothing is written on either refusal.
- Moving the A between cells in one save passes.
- BAU Handover's single `A/R` counts as the one accountable, and adding an A there is refused.
- A documented `accountabilityException` (10–2,000 characters) permits two. Removing the exception while two A remain is refused.
- The 0030 deferred trigger stays the database's last line.

### REQ-S10-007 — "A06;A07: changing a transformation's RACI does not change the seeded default or other transformations"

- A cell edit in one transformation leaves `raci_template_cell` and a second transformation's RACI byte-equal.
- **Versioned, approved changes:**
  - every T11/T12 write bumps the matrix header's version;
  - `submit` freezes the version and requests a `governance_matrix_change` approval routed to SP, so rows then give 422 `governance_matrix.in_approval` and a second submit gives 422 `governance_matrix.not_draft`;
  - the SP-mapped person approves through BE-B's `decideApproval`, and the matrix becomes `approved` with `approvedVersion` set to the requested version and `approvedBy` set to the Sponsor; the requester (TL) is refused by BE-B's SoD rule;
  - a later edit returns the matrix to `draft`; a rejection returns it to `draft` and unfreezes the rows;
  - an unmapped SP gives 422 `routing.role_unmapped`, and the header stays unchanged.

### REQ-PB-008 — "A01: readiness for Transform shows 'not ready' when T11 or charter decision rights are empty and 'ready' once they are completed"

- `GET …/readiness/transform` returns the four checks of ADR-0026 §9, each with a `missing[]` list.
- **Not ready, then ready:** on a fresh world it is `not_ready` (no charter decision rights; STEERCO unmapped). After TL creates the charter with decision rights and STEERCO is mapped, it is `ready`.
- **T11 emptied:** after the four seeded rows are retired it is `not_ready`, naming the four keys.
- The DG3 `GET …/readiness` keeps its shape. The pure function has unit tests, including a blank text containing U+200F, which the shared `hasText` rule rejects.

### Every mutation (S-4), per operation (createDecisionRight, updateDecisionRight, createRaciDeliverable, updateRaciDeliverable, submitGovernanceMatrix)

- **Authorization:** the read gate gives 404, and the write permission is re-checked on grants reloaded in the transaction. All five mutations go through the same helper, `requireGovernanceWrite`.
  - Negative tests:
    - AUD 403 on all five (the tests and the contract exercises);
    - BO 403 on `createDecisionRight`, `updateRaciDeliverable` and `submitGovernanceMatrix`;
    - outsider 404 on `createDecisionRight` and `updateRaciDeliverable`.
  - Commit-time tests using the `afterIdentity` technique: on `createDecisionRight` and `updateRaciDeliverable`, a grant revoked while the request waits gives 403, and nothing is written. The other three use the same helper but have no dedicated commit-time test.
- **Validation:** 400 for the shape; 422 with the ADR's codes for business rules.
- **If-Match:** 428 when missing, 409 when stale, and creates start at version 1.
- **Audit:** one event per changed row in the same transaction (deliverable, each cell, the header, the decision-right row). The tests assert the actions and the actor.
- **No remote I/O** inside any transaction.

## 3. Checks actually run (final tree)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; disposable PostgreSQL from `tests/qa/support/with-pg.sh` on my ports (23900–23949). Logs are in `docs/delivery/handbacks/DG4/T-DG4-BE-C-evidence/`.

### 3.1 Final runs (after the last code change)

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `pnpm -r typecheck` | exit **0** | `typecheck.log` |
| 2 | `pnpm -r build` | exit **0** | `build.log` |
| 3 | `pnpm lint` | exit **0** (`--max-warnings=0`) | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit **0**, "All matched files use Prettier code style!" (run after this handback was written) | `prettier-check.log` |
| 5 | `pnpm openapi:lint` | exit **0**, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 485 operations` (the contract is unchanged) | `openapi-lint.log` |
| 6 | `pnpm test`, locale unset (`env` shows no `LANG`/`LC_*`) | exit **0**. First Vitest invocation: 104 files, **2055 passed**. Second (`unit-formula-nocodegen`): 3 files, **259 passed, 2 skipped**. | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit **0**, the same counts: 2055 passed; 259 passed, 2 skipped | `unit-c-utf8.log` |
| 8 | `QA_PG_PORT=23930 MTH_PORT_POOL=23931-23949 tests/qa/support/with-pg.sh pnpm test:integration` | exit **0**, 77 files, **990 passed** (the D-097 baseline of 967, plus my 23) | `integration-full-final.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG3` | exit **0**, `PASS gate DG3 (historical)` | `validate-dg3-historical.log` |

- Unit tests went from 2049 (D-097) to 2055: my 6 new tests.
- The flaky KBE-B test of §4.5 passed in this run (`kpi-p4/data-quality.test.ts (5 tests)`).

### 3.2 Earlier runs, disclosed (non-zero exits and their causes)

| Run | Exit | Cause | Fix |
|---|---|---|---|
| Governance tests, run 1 (`integration-governance-run1.log`) | 1: 3 failed, 20 passed | **(a)** My test created a `modular` transformation without `entryPhase` (400). **(b)** A real bug: a RACI PATCH without `cells` queried `IN ()` and gave **500**. | **(a)** The test uses `end_to_end`. **(b)** `validateCells` returns early on an empty list. Run 2: 23/23 (`integration-governance-run2.log`). |
| Contract test (`integration-contract-run1.log`) | 0 | 44/44 passed. | — |
| Architecture unit test, during development (not logged) | 1 | Six "computed member with a non-literal key" violations (F-DG1-124) in my files. | Rewritten with `Map`s and literal accesses. |
| Full integration, run 1 (`integration-full-run1.log`) | 1: 3 failed, 987 passed | **(1)** `registers.test.ts` (29 → 82 audit events) and **(2)** `transformations.test.ts` (action list): both caused by the instantiation switch, by design (§4.3). **(3)** KBE-B's flaky random-date fixture (§4.5). | Pins (1) and (2) updated. (3) is not mine and was not changed. |
| Full integration, run 2 (`superseded/integration-full-run2.log`) | 0 | 990/990, but on a tree before the last two fixes below. | Superseded by §3.1 row 8. |
| Unit tests, run 1, both locale settings (`superseded/unit-*-run1.log`) | 1: 2 failed, 2053 passed | **(1)** `advisory-locks.test.ts`: my comments spelled lock-class numbers. **(2)** `workflows.test.ts`: it pins `workflows/index.ts`'s exports. | **(1)** The comments name the registry keys instead. **(2)** I dropped the unused `defaultDecisionRightRouter` export and added the four needed names to the pin. |

### 3.3 Pinned-count changes

- **`contract.test.ts` media types:** `[184, 183, 1]` → `[189, 188, 1]` (+5 JSON bodies: createDecisionRight, updateDecisionRight, createRaciDeliverable, updateRaciDeliverable, submitGovernanceMatrix).
- **`registers.test.ts`:** audit events of `POST /transformations` go from 29 to **82** (+2 governance_matrix, +4 transformation_decision_right, +6 transformation_raci_deliverable, +36 transformation_raci_assignment, +5 forum).
- **`transformations.test.ts`:** the same 53 actions are added to the audit-trail list.
- **`workflows.test.ts`:** the export list gains `registerApprovalSubject`, `requestApprovalInTx`, `setDecisionRightRouter` and `toApprovals`.

### 3.4 Operations routed: delta to `p4-pending-be-c.ts`

Before, 13 operations were pending. After, the list is **empty**. Each operation below is exercised in `p4-exercises-be-c.ts` through `ctx.mirrored`, with its zod mirror.

| Operation | Method and path |
|---|---|
| `listDecisionRightTemplates` | GET `/api/v1/decision-right-templates` |
| `listDecisionRights` | GET `/api/v1/transformations/{transformationId}/decision-rights` |
| `createDecisionRight` | POST `/api/v1/transformations/{transformationId}/decision-rights` |
| `getDecisionRight` | GET `…/decision-rights/{decisionRightId}` |
| `updateDecisionRight` | PATCH `…/decision-rights/{decisionRightId}` |
| `previewDecisionRightDueDate` | GET `…/decision-rights/{decisionRightId}/due-date` |
| `getRaciTemplate` | GET `/api/v1/raci-template` |
| `getTransformationRaci` | GET `/api/v1/transformations/{transformationId}/raci` |
| `createRaciDeliverable` | POST `…/raci/deliverables` |
| `updateRaciDeliverable` | PATCH `…/raci/deliverables/{deliverableId}` |
| `listGovernanceMatrices` | GET `…/governance-matrices` |
| `submitGovernanceMatrix` | POST `…/governance-matrices/{matrixKind}/submit` |
| `getTransformReadiness` | GET `…/readiness/transform` |

## 4. Known gaps, divergences and needs for the orchestrator

### 4.1 Resubmission of a matrix approval (round 2+) is not frozen (a seam in BE-B's service; contract need)

- **The intended cycle.** After **request changes**, the matrix returns to `draft` so the requester can edit it. The approval stays open (`changes_requested`).
- **What goes wrong.** BE-B's `POST /approvals/{id}/resubmit` sets the approval's `subject_version` to the header's current version **before** it calls `onOutcome('resubmitted')`. If `onOutcome` then set the header to `in_approval`, the header's version would step again (the `p2_row_guard` steps the version on every update). The approval would then be stale at once, and every decision would be 409.
- **What I did.** For `resubmitted`, `applyMatrixOutcome` leaves the header unchanged, so it stays `draft`.
- **Integrity holds.** Any later row edit bumps the header's version, so a decision on the resubmitted version is refused 409 `approval.stale_version` (the 0031 trigger). The approver can only approve exactly the version that was resubmitted, and `approved_version` records it.
- **What is not met.** The ADR §7 "rows frozen while `in_approval`" is not enforced for rounds ≥ 2.
- **Proposed fix (not my file).** BE-B or BE-B2 exports a `resubmitApprovalInTx(tx, audit, approvalId, subjectVersion, note)`. `submitGovernanceMatrix` then accepts a draft matrix with a `changes_requested` approval: it sets `in_approval`, then resubmits on the new version in one transaction. That is about 20 lines in `matrices.ts`.
- Alternatively, the orchestrator may accept the current behaviour, since staleness is protected.

### 4.2 Extra refusal code (FE-A needs an i18n key)

- `raci.party_unknown`, 422, "{party} is not a known governance role.": a cell whose party is not in `governance_party`. ADR-0026 names no code for it. The text is the ADR's `decision_right.party_unknown` text, following BE-B's `role_mapping.party_unknown` precedent.
- `routeByDecisionRight` reuses BE-B's `approval.decision_right_unknown` for an unknown or retired row.

### 4.3 The `p4_instantiate_transformation` switch also seeds slice D's five forums

`0044` redefines `p4_instantiate_transformation` to call `p4_instantiate_forums`. So the switch makes `POST /transformations` write 53 more audited rows:

- 2 headers;
- 4 T11 rows;
- 6 T12 deliverables;
- 36 cells;
- 5 forums.

The DG2 pins in `registers.test.ts` (29 → 82) and `transformations.test.ts` (the action list) were updated with comments, following the T-DG3-BE-A precedent for the P3 switch. Existing DG1–DG3 assertions are otherwise unchanged.

### 4.4 Interpretations (no ADR text)

- **The DG3 readiness operation is byte-stable**, both its contract and its handler. To stay inside my file, `registerReadinessRoutes`' return line also registers the Transform route, instead of a new line in `portfolio/index.ts`.
- **Readiness `missing[]` values:** `charter.decision_rights`, the seeded T11 keys, the Approve party codes, and T12 deliverable template keys (the deliverable id for a non-seeded one).
- **`t11_approvers_mapped`** considers the active seeded rows. A missing or retired row already fails `t11_seeded_decisions`.
- **The matrix approval has no SLA:** `due_date` is NULL with `due_unknown_reason = 'no_sla'`, shown as Unknown. The ADR gives the matrix approval no SLA, and BE-B's escalation job never selects an Unknown due date.
- **A PATCH that changes `slaType`** without naming the working-day fields clears the field the new type no longer takes. Naming such a field explicitly with a value is 422 `decision_right.sla_invalid`.
- **RACI PATCH `cells[]`** upserts the named party cells. Cells not named are unchanged, and `null` clears one. The deliverable's version steps once per save, which is the If-Match the screen holds.
- **`submitGovernanceMatrix`** declares `raci.edit` on the route, for the fail-closed hook. The handler checks the exact permission for the kind (`decision_right.configure` for T11, `raci.edit` for T12); both are held by TL and TO.

### 4.5 A flaky test outside my scope (disclosed)

- **What failed.** In my first full integration run, `kpi-p4/data-quality.test.ts > dismiss is the other final outcome…` failed with `reporting_period: ad_hoc … overlaps another ad_hoc period`.
- **Cause.** KBE-B's fixture `kbe-b-fixtures.ts:86` picks a day with `Math.random() * 3000`, so two calls can collide.
- **Not caused by this change.** The failure is unrelated to my change (no shared table or code path). It did not recur in the final run (§3.1).

### 4.6 What remains

- All 13 operations are routed and exercised, and `p4-pending-be-c.ts` is empty.
- Every requirement row of §I+C.3 is delivered, with the §4.1 limitation.
- Open items for the orchestrator: §4.1 (contract need, or acceptance) and §4.2 (FE-A i18n key).

## 5. Merge instructions

1. **No migration.**
2. **Expected conflicts** (all appends or pins; take the union):
   - `packages/shared/src/schemas/index.ts`: export lines.
   - `apps/api/src/modules/workflows/index.ts`: KBE-C also needs `registerApprovalSubject` for `kpi_version_activation` and may append the same exports; keep one block.
   - `contract.test.ts` media-type pin: add the other W5 tasks' JSON bodies to `[189, 188, 1]`.
   - `registers.test.ts` / `transformations.test.ts`: the 82 count changes only if another task changes `POST /transformations` again.
3. **`transformations/routes.ts`** must merge before BE-J edits that file (p4-plan §5.1).
4. **BE-F** wires its meeting-backed provider with `setNextForumDateProvider(...)` (`governance/decision-rights.ts`). **BE-L** calls `routeByDecisionRight(tx, transformationId, 'business_scope_change')`.
