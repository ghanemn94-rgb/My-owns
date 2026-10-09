# Handback T-DG4-BE-K (backend-workflow-engineer): p4-work-split §H H.1

- **Stage:** P4, gate DG4 (BUILDING). **Task:** T-DG4-BE-K. **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-K.md` (sha256 `c5cc5d3d…602dfe`, verified).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-K-backend-workflow-engineer-20261009T160423Z-5530259a","session_id":"5530259a-5c00-432b-8602-9ba0cd5170ef"}`.
- **Base:** branch `dg4/be-k`, `HEAD` `89df7f7004cb51a5265348631f5310e49719d314`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** `date -u` at start `Fri Oct  9 16:04:34 UTC 2026`; at end `Fri Oct  9 17:23:33 UTC 2026` (about 79 minutes, within the 2-hour limit).
- **Two gate systems:** G1–G6 are business approvals inside the product. Nothing here reads or writes DG0–DG7 records. No code, seed, job or test grants a real business, Finance or IT approval. Every decision in the tests is a synthetic demo decision by a test person.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` → **exit 0**, `PASS gate DG3 (historical)`. Log: `T-DG4-BE-K-evidence/validate-dg3-historical.txt`.

## 2. Files changed

**Migration (number 0059, as assigned):**

- `packages/db/migrations/0059_p4_enable_g5_g6.sql` (new):
  - Enables G5 and G6 (`submission_enabled = true`) using the `0026` guard pattern. Guards: both enabled; four mandatory 0051 criteria each; G6 `next_phase` IS NULL.
  - Also `GRANT UPDATE (version) ON risk_disposition TO mth_app` (see §6, item 1).

**API, workflows (owned):**

- `workflows/g5.ts` (new):
  - The four `g5.*` evaluators, pure functions of the facts.
  - `loadG5Facts`: provider members raid, adoption and governance; plus outcome-KPI facts and pilot evidence read in workflows (see §6, item 3).
  - `g5SnapshotOf`.
- `workflows/g6.ts` (new): the four `g6.*` evaluators, `loadG6Facts` (provider members benefits and sustainment) and `g6SnapshotOf`.
- `workflows/scale.ts` (new): the six routes `getScaleScope`, `listScaleTransitions`, `createScaleTransition`, `listRiskDispositions`, `createRiskDisposition` and `getRiskDisposition`; the `risk_disposition` approval subject provider (`registerRiskDispositionSubject`).
  - Exported for BE-K2: `getScaleScope`, `createScaleTransition`, `createRiskDisposition`, `getRiskDisposition`, `scaleRefusals`.
- `workflows/g4.ts`: the five new optional `GateFactsProvider` members (`raid`, `adoption`, `governance`, `sustainment`, `benefits`) and their fact types. Interface only.
- `workflows/criteria.ts`:
  - The `G5_EVALUATORS`/`G6_EVALUATORS` registration lines in `EVALUATORS`.
  - Two `GateFacts` members (`g5`, `g6`) and the two loader lines in `loadGateFacts` (see §6, item 4).
- `workflows/gates.ts`, BE-K lines:
  - The G5/G6 label form of the 422 `gate_criteria_incomplete` detail.
  - The `g5`/`g6` snapshot members.
  - `scaleScopeRule` (422 `gate.scale_scope_required` / `gate.scale_scope_not_applicable`).
  - `assertScaleScopeValid` (422 `gate.scale_scope_invalid` at `/scaleScope/items/{i}`).
  - Scope and condition inserts, each with its audit event.
  - The two outbox events `gate.submitted` / `gate.decided`, written by a module-local writer (see §6, item 2).
- `workflows/index.ts`: one registration line (`registerScaleRoutes`).

**API, fact loaders in the owning modules** (new files; read-only queries; no other file of those modules is edited):

- `raid/gate-facts.ts`
- `adoption/gate-facts.ts`
- `governance/gate-facts.ts`
- `sustainment/gate-facts.ts`
- `benefits/gate-facts.ts`

**API, other:**

- `server.ts`: the wiring lines of the five provider members, plus five imports.
- `platform/db-errors.ts`: the first slice H block, `mapP4GateScaleError`, with one dispatch line. It maps these constraints:
  - `scale_transition_key` → 409 `scale.already_scaled`
  - `scale_transition_g5_approved` → 422 invalid-transition `gate.g5_not_approved`
  - `scale_transition_in_approved_scope` → 422 invalid-transition `scale.outside_approved_scope`
  - `scale_transition_initiative_fkey`
  - `gate_decision_{scale_scope,condition}_g5_approved` → 422 `gate.scale_scope_not_applicable`
  - `gate_decision_scale_scope_{business_unit_org,initiative_fkey,key}` → 422 `gate.scale_scope_invalid`
  - `risk_disposition_{open_risk,raid_fkey}` → 422 `risk_disposition.not_open_risk`

**Shared:**

- `packages/shared/src/schemas/gates-p4.ts` (new): `gateScaleScope` (unique pairs), `scaleScope`, `scaleTransition*` and `riskDisposition*`.
- `packages/shared/src/schemas/index.ts`: one `export *` line.
- `packages/shared/src/schemas/gate.ts`: the `scaleScope` member of `gateDecisionCreate` only.
- `packages/shared/src/schemas/events.ts`: `gateSubmittedV1`, `gateDecidedV1` and their two registry lines. Additions only.

**Worker:**

- `apps/worker/src/handlers/gates.ts`: the consumers `handleGateSubmitted` and `handleGateDecided`, and `approverRoleHolders` (the SQL twin of the API's approver rule).
- `apps/worker/src/queues/gates.ts`: queues `gates.submitted` and `gates.decided`; event map `gate.submitted → gates.submitted` and `gate.decided → gates.decided`. Neither event had a consumer before.

**Tests (owned):**

- `apps/api/test/support/p4-pending-be-k.ts`: now empty.
- `apps/api/test/integration/contract/p4-exercises-be-k.ts`: the six exercises, their zod mirrors and the shared fixtures `seedGateWorld`, `stageGates`, `pendingGate`, `highRisk` and `g5Approval`.
- New integration tests:
  - `apps/api/test/integration/workflows/g5-g6.test.ts` (13)
  - `apps/api/test/integration/workflows/scale.test.ts` (2)
  - `apps/api/test/integration/workflows/risk-dispositions.test.ts` (3)
  - `apps/api/test/integration/workflows/gate-events.test.ts` (2)
  - `apps/worker/test/integration/gates.test.ts` (6)
- `packages/db/test/integration/catalogue.test.ts`: the "0026: … G5 and G6 stay closed" test now expects G5/G6 enabled (0026 + 0059).
- `apps/api/test/integration/contract/contract.test.ts`: media-type pin `[280, 279, 1]` → `[282, 281, 1]`, which is **+2 JSON bodies** (`createScaleTransition`, `createRiskDisposition`).

**Tests outside the listed ownership, changed because enabling G5/G6 makes them false** (please confirm; §6, item 5):

- `apps/api/test/integration/gates.test.ts`: the DG2 starter test asserted G5/G6 `submissionEnabled: false` and 422 `gate_not_enabled`. It now asserts `true` and 422 `gate.out_of_sequence` on a new transformation.
- `apps/api/src/modules/workflows/workflows.test.ts`: the evaluator-registry pin now includes the eight `g5.*`/`g6.*` keys.

## 3. Behaviour delivered, per requirement row (acceptance quoted)

### REQ-PB-015

> "A08: submission with missing mandatory evidence is rejected; approval by a non-approver returns 403; approval of a stale submission version is rejected"

- Missing mandatory evidence is rejected for G5/G6: 422 `gate_criteria_incomplete`, with the label form of the detail, and nothing written (`g5-g6.test.ts`).
- Approval by a non-approver returns 403:
  - SP when G5 is configured to BO: 403 `gate.not_approver`.
  - AUD and ADM-only: 403.
- Approval of a stale submission number returns 409 `gate.submission_superseded`, with nothing written.

### REQ-PB-020

> "G5 submission with an open High-impact risk and no disposition is rejected listing 'Risk closure'; with the G5 approver configured to BO per T11 'Go-live / scale', an SP approval returns 403 and a BO approval succeeds"

- The rejection is 422 with detail `"Mandatory required outputs are incomplete: Performance evidence, Adoption, Risk closure, Decision log."`.
- The error at `/criteria/g5.risk_closure` reads `"Risk closure: R-01 has High impact and is neither closed nor dispositioned."`.
- Disposition states:
  - With a pending disposition the criterion stays incomplete.
  - After the Sponsor approves the disposition through `POST /approvals/{id}/decisions`, the live view shows the criterion complete.
  - A medium-impact risk never counts.
- With G5 configured to BO (`PATCH …/gates/G5` by TO): SP → 403 `gate.not_approver`; BO → 201. The approved G5 moves the phase from transform to realize.

### REQ-PB-021

> "G6 submission without an accepted BAU handover is rejected listing 'Ownership transfer'"

- The rejection is 422; the detail contains "Ownership transfer" and the error reads `"Ownership transfer: the transformation has no performance area."`.
- With an area in BAU, an active control, an improvement item and a Finance-validated measurement, G6 is submitted: 201.
- A value pending Finance is never counted as validated (asserted).

### REQ-S03-004

> "a Design-phase draft can be saved before G2; a scale transition before G5 approval returns 422 invalid-transition naming G5; after approval it succeeds"

- Before G5 (and after a G5 rejection): 422, type `urn:mth:problem:invalid-transition`, code `gate.g5_not_approved`. The detail names G5.
- After the G5 approval and inside the approved scope: 201, with one audit event.
- The first clause (drafts before G2) is the unchanged DG2 behaviour. I did not re-test it.

### REQ-S04-002 (the G5/G6 snapshot half)

> "completing every phase task leaves the gate Draft; editing a record after submission does not change the snapshot content shown to approvers"

- A real G6 submission freezes the `g6` member. After an improvement item is edited, `GET …/submissions/{n}` returns the same snapshot and SHA-256.
- The `g5` member builder is covered by a pure test (`g5SnapshotOf`), not by an end-to-end G5 submission (see §7).
- The first clause belongs to BE-L2.

### REQ-S04-007

> "G5 submission with an open material risk lacking resolution or approved disposition is rejected; an approval records the scale scope and later scaling outside it is blocked"

- An open material risk is rejected as for REQ-PB-020.
- The approval records the scope items and conditions, each with its own audit event. `GET /scale-scope` returns them.
- Scaling outside the scope (another business unit) → 422 invalid-transition `scale.outside_approved_scope`.
- A repeat → 409 `scale.already_scaled`.
- Scope rules:
  - `scaleScope` missing on a G5 approval → 422 `gate.scale_scope_required`.
  - `scaleScope` on G4, or on a G5 rejection → 422 `gate.scale_scope_not_applicable`.
  - A business unit of another organization → 422 `gate.scale_scope_invalid` at `/scaleScope/items/0`.
  - A duplicate pair → 400.

### REQ-S04-008

> "G6 submission without an accepted BAU handover is rejected; product G6 approval changes no engineering DG record"

- The rejection is as for REQ-PB-021.
- The SP's G6 approval → 201, and:
  - The `transformation` row is identical before and after: same phase (`realize`), status and version.
  - No `closure_record` is written.
  - The recursive listing of `docs/delivery/` with SHA-256 per file is byte-identical before and after.
  - The `gate.decided` payload has `nextPhase: null`.

### REQ-S12-009

> "each required approver receives exactly one task referencing the snapshot"

The worker test runs a real G1 submission with two SP holders:

- Each gets exactly one `gate_decision_due` task with `{gateCode, submissionNo, snapshotSha256}`.
- A redelivery creates nothing new: `runOnce` reports `duplicate`.
- A superseding submission cancels both old tasks and creates two new ones that reference the new SHA-256.
- On the decision, the decider's task is `done` and the other approver's is `cancelled`.
- With no approver at all, the submitter gets one `routing.role_unmapped` notice.
- Parity test: the worker's approver set equals the API's `canDecide` for SP (transformation and organization grants), BO, FIN, TL (the submitter) and AUD.

### REQ-S12-010

> "G2 approval enables Design tasks once; a conditional approval enables only its scope"

- A G2 approval creates the four `design.*` `phase_step` rows (`not_started`, `enabled_by_gate_decision_id`) and four `phase_step_enabled` tasks once. A redelivery creates none.
- A G5 approval with one scope item and one condition creates exactly one `scale_scope_enabled` task and one `gate_condition_due` task (owner BO, due 2026-12-31). A second initiative outside the scope gets nothing.

**Other proofs from §H H.1:**

- G1–G4 422 bodies keep the DG2 key form. A G4 test asserts the detail pattern `g4.<key>, …`. Every DG2/DG3 gate suite passes unchanged in the full run.
- AUD gets 403 on every new write: scale transition, disposition, G5 submit and G5 decide.
- An ADM-only caller gets 403 on the G5 decision and on scale transitions (commit-time denial).
- If-Match: the six routed operations have no If-Match in the contract (two creates and four reads). The G5/G6 decision path keeps the DG2 submission-number rule.

## 4. Checks run (real exit codes)

Environment: Node 24.21.0, offline. Harness ports: `QA_PG_PORT=24400`, `MTH_PORT_POOL=24401-24449`. Logs are under `docs/delivery/handbacks/DG4/T-DG4-BE-K-evidence/`.

| Check | Command | Exit | Result | Log |
|---|---|---|---|---|
| Preceding gate | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` | `validate-dg3-historical.txt` |
| Typecheck | `pnpm -r typecheck` | 0 | every package `Done` | `typecheck.log` |
| Build | `pnpm -r build` | 0 | every package `Done` | `build.log` |
| Lint | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | no findings | `lint.log` |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| OpenAPI lint | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 607 operations` | `openapi-lint.log` |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | first Vitest invocation: 120 files, **2290 passed**; second (`unit-formula-nocodegen`): 3 files, **259 passed, 2 skipped** | `unit-locale-unset.log` |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 2290 passed; 259 passed, 2 skipped | `unit-c-utf8.log` |
| Integration | `QA_PG_PORT=24400 MTH_PORT_POOL=24401-24449 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **137 files, 1439 tests passed** | `integration.log` |

**Disclosed non-zero exits during development** (all fixed before the final runs above):

- The first contract run failed. `createRiskDisposition` returned 500 because the grant was missing (§6, item 1). `decideGate` then returned 500 on a G5 approval because the scope rows had no audit events (`gate_decision_scale_scope_audit_required`). Both were fixed.
- The first `pnpm test` (both locales) exited 1 with 1 failure out of 2290: the evaluator-registry pin in `workflows.test.ts` (§2). The pin was updated, and both locales were re-run green; those are the logs above.
- Targeted integration runs failed while I wrote the new tests: a duplicate pending fixture submission, the approval route (`/decisions`), and an ADM-only expectation (403, not 404). They were corrected.

**Count changes:**

- Integration: 1439, against D-105's 1413, so **+26**: g5-g6 13, scale 2, risk-dispositions 3, gate-events 2, worker gates 6.
- Unit: 2290 + 259/2, unchanged against D-105. The pin edit changed a test's expectation, not the number of tests.
- Media-type pin: **+2 JSON bodies**, `[280, 279, 1]` → `[282, 281, 1]`.
- Contract operations: 607, unchanged.

No test was flaky and no run timed out. A `grep -i "retry|flaky"` of the integration log finds only a test title.

## 5. Operations routed (pending-list delta)

`p4-pending-be-k.ts` went from 6 entries to 0. Removed: `getScaleScope`, `listScaleTransitions`, `createScaleTransition`, `listRiskDispositions`, `createRiskDisposition` and `getRiskDisposition`. Each is exercised through `ctx.mirrored` in `p4-exercises-be-k.ts`, and each success body is parsed by its zod mirror. The contract test passes.

## 6. Contract or schema needs, and deviations for the orchestrator

1. **Schema need, inside 0059:** `GRANT UPDATE (version) ON risk_disposition TO mth_app`.
   - Without it, `createRiskDisposition` returned 500, observed in the contract exercise. The approval guard (0031 `approval_guard` → `p4_approval_subject_version`) reads the subject with `SELECT … FOR SHARE`, and PostgreSQL requires UPDATE privilege for that. 0051 granted only SELECT and INSERT.
   - The grant is column-level. Table-level privileges stay `INSERT,SELECT`, so the catalogue privilege pin is unchanged. The row stays immutable: the append-only trigger refuses any UPDATE, and `version` is CHECKed to equal 1.
   - Please confirm, or move the grant to another repair number.
2. **Outbox writer:** `gates.ts` writes the events with a module-local `enqueueGateEvent`, not `jobs/outbox.ts`'s `enqueueOutboxEvent`.
   - Reason: `workflows`' declared dependencies (`modules.ts`) exclude `jobs`.
   - It follows the `kpi/kpi-outbox.ts` precedent: payload validated against the registered schema, one `outbox_event` row in the caller's transaction.
3. **G5 performance facts:** the outcome-KPI facts (accepted actual and latest evaluation, with the read-time staleness rule) and the pilot evidence (`phase_step_evidence` of `transform.deliver_pilots`, verified) are read in `workflows/g5.ts`, not through a provider member.
   - ADR-0035 names five provider members, and KPI is not among them.
   - `kpi/p3-gate-facts.ts` is not mine to change.
   - `criteria.ts` already reads kpi-module tables for G1–G3 the same way.
4. **`criteria.ts`:** besides the `EVALUATORS` registration lines, I added the `g5`/`g6` members to `GateFacts` and two loader lines in `loadGateFacts`. These are needed to pass the facts to the evaluators.
5. **Edits outside the listed ownership:**
   - `apps/api/test/integration/gates.test.ts` and `apps/api/src/modules/workflows/workflows.test.ts` asserted the pre-0059 state. The changes are listed in §2.
6. **Interpretations:**
   - (a) "High-impact" means `raid_entry.impact = 'high'` (§H.9 8a).
   - (b) Required approvers are the configured user, or else every active SP/BO holder with `gate.decide` in scope. The submitter is excluded, including when the submitter is the named approver (§H.9 8b).
   - (c) The G5 adoption indicator's "current value" is computed for the organization's latest started open or closed reporting period, which is the indicator report's default.
   - (d) An open T16 row without a decision date is listed as "date missing" and makes the criterion incomplete. It is never on time.
   - (e) A disposition is routed to `SP`, or to the approve party of the transformation's T11 row `go_live_scale` when G5's approver role is BO (fallback `BO`).
7. **i18n keys for FE-A/FE-F:**
   - Work items use the message keys `gates.task.gate_decision_due`, `gates.task.phase_step_enabled`, `gates.task.scale_scope_enabled` and `gates.task.gate_condition_due`.
   - The no-approver notice uses `routing.role_unmapped`.
   - Problem codes: the ADR-0035 §11 codes this task emits.
8. **The `gate.exception_expiry_scan` handler** is not built here. ADR-0035 §4 says "BE-K handler", but p4-work-split §H.2 assigns it to BE-K2, and I followed the split. `schedules.test.ts` still lists `0054` as unhandled.

## 7. What remains (stated plainly)

- **No end-to-end G5 submission returning 201 with a real `g5` snapshot.** Staging every G5 fact through the API (an accepted KPI actual with an OK evaluation, verified pilot evidence on a phase step, adoption values, T16 rows) was not done. The G5 path is covered by:
  - the 422 path end to end;
  - the decision path with a fixture submission;
  - pure tests of the four evaluators (Unknown, Stale and Not computable never count) and of `g5SnapshotOf`.
  The G6 snapshot is proved end to end.
- REQ-S04-002 first clause (phase steps never move a gate) belongs to BE-L2. REQ-S03-004 first clause is the unchanged DG2 behaviour and was not re-tested here.
- BE-K2 (§H.2) follows: per-criterion reviews, gate exceptions, the submission exception lines and the expiry scan.
- None of the nine rows is fully complete until the orchestrator integrates this change and the reviewers verify it. REQ-PB-015 also needs BE-K2's review table, and REQ-S04-002 needs BE-L2's half.

## 8. Merge instructions

- Apply migration `0059_p4_enable_g5_g6.sql`, the repair range assigned to BE-K. It only flips the two gate flags and adds one column grant; there is no data backfill.
- Expected conflicts:
  - `contract.test.ts`, the media-type pin (+2) and its comment line, if other W10 tasks also moved it.
  - `platform/db-errors.ts`, the dispatch lines in `mapDatabaseGuardError`.
  - `workflows/index.ts`, the registration lines.
- `apps/worker/src/handlers/gates.ts`, `queues/gates.ts`, `schemas/gates-p4.ts`, the slice H db-errors block and `p4-exercises-be-k.ts` are BE-K2's sequential base.
