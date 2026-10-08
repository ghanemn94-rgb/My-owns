# Handback T-DG3-BE-E: capacity, resource demand, funding decisions, G4 and the wave-2 wiring (backend-workflow-engineer)

- **Stage:** DG3 (BUILDING). **Worktree:** `/home/user/wt/dg3-be-e`, branch `dg3/be-e`. **Base:** `HEAD` = `e14993e7f682f405dbabca8b21250d5c227a7a20`. I committed nothing.
- **Invocation:** run `DG3-T-DG3-BE-E-backend-workflow-engineer-20261008T010759Z-011d4471`, session `011d4471-2167-4589-abb6-a1e64c4871fa`.
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-BE-E.md`. I verified its sha256 `802bd2fa…9cafcb` at the start.
- **Time:** start `Thu Oct 8 01:08:07 UTC 2026`; end `Thu Oct 8 01:52 UTC 2026`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` printed `PASS gate DG2 (historical)` with exit 0, at the start and again at the end (`T-DG3-BE-E-evidence/validate-historical-DG2.log`).
- **Business records:** G1–G6 are business approvals inside the product. Every selection, funding decision, validation and G4 decision in the tests is a **synthetic demo record that approves nothing real**. Nothing here reads or writes the DG0–DG7 records. Product gate G4 never implies DG7.

Everything in the scope list is done, and the checks below were all run. Three files outside my ownership list had to change; §6 lists them, and the orchestrator should confirm them. §7 lists the design choices that reviewers should check.

## 1. Migration

**`packages/db/migrations/0026_p3_enable_g4.sql`** (the only migration):

- It runs `UPDATE gate_definition SET submission_enabled = true, version = version + 1, updated_at = now() WHERE code = 'G4' AND submission_enabled = false`.
- A `DO` block then checks that G4 is enabled and G5/G6 are still closed. If not, it raises an error and the migration aborts.
- `schema.ts` is unchanged, because 0026 adds no relation or column.
- `catalogue.test.ts` gains the test `0026: product gate G4 is submittable; G5 and G6 stay closed`.
- The integration log shows "applied 26 migrations to a fresh database" on PostgreSQL 16.13.

## 2. API endpoints added (17; `test/support/p3-pending-be-e.ts` is now empty)

| Operation | Route | Access | File |
|---|---|---|---|
| listResourceRoles / createResourceRole / updateResourceRole | `GET/POST /transformations/{id}/resource-roles`, `PATCH …/{resourceRoleId}` (If-Match) | read / `capacity.edit` | `portfolio/capacity.ts` |
| listCapacity / createCapacity / getCapacity / updateCapacity | `GET/POST /capacity`, `GET/PATCH /capacity/{capacityId}` (If-Match) | read / `capacity.edit` | `portfolio/capacity.ts` |
| getCapacityPlan | `GET /transformations/{id}/capacity-plan?from=&to=` | read | `portfolio/capacity.ts` |
| listResourceDemands / createResourceDemand / getResourceDemand / updateResourceDemand | `GET/POST /resource-demands`, `GET/PATCH /resource-demands/{id}` (If-Match) | read / `capacity.edit` | `portfolio/resource-demands.ts` |
| commitResourceDemand / releaseResourceDemand | `POST /resource-demands/{id}/commit` (TransitionNote) and `/release` (ReasonRequest), both If-Match | `capacity.commit` | `portfolio/resource-demands.ts` |
| listFundingDecisions / createFundingDecision / getFundingDecision | `GET/POST /funding-decisions` (optional Idempotency-Key), `GET /funding-decisions/{id}` | read / `funding.approve` | `portfolio/funding.ts` |

G4 runs through the existing gate paths. The `GET /gates` view, submit (422 / snapshot) and decide routes now evaluate the eight `g4.*` criteria.

**Every mutation route has the following:**

- `config.consumes: ["application/json"]`.
- Authorization re-checked at commit: `openWrite(…, { atCommit: true })` (BE18A).
- Validation through zod, with free text through `freeText`.
- If-Match: 428 when missing, 409 when stale. Creates are version 1, with ETag `"1"`.
- One audit event per changed row.
- No client or remote I/O inside the transaction.
- FTE and amounts are decimal strings on the wire and `numeric` in SQL. Sums run in SQL and comparisons use `decimal.js`. There is no `Number()` on these values.

## 3. Changed files

**Owned files (assignment):**

| File | Purpose |
|---|---|
| `apps/api/src/modules/portfolio/capacity.ts` | Roles, capacity and plan routes. Contract mirrors (`fte`, `periodMonth`, `resourceRole*`, `capacity*`, `capacityPlan*`). The conflict rule `capacityCell()` and `loadCapacityPlan()`. Flag sources `capacityFlagSource`, `scheduleFlagSource` and `initiativeFlags()`. |
| `apps/api/src/modules/portfolio/capacity.test.ts` (new) | Unit tests of the conflict rule (exact decimal shortfall; Unknown is null, never 0). |
| `apps/api/src/modules/portfolio/resource-demands.ts` | Demand routes, mirrors, the `planned → committed → released` / `archived` transitions, and the read-only guard. |
| `apps/api/src/modules/portfolio/funding.ts` | `POST/GET /funding-decisions`. The header comment is rewritten (it was stale). `latestFundingState()` gains one `WHERE` clause for the deselect rule (§7.1). |
| `apps/api/src/modules/portfolio/gate-facts.ts` | The portfolio half of `GateFactsProvider`: in-scope initiatives, ranking, weight set, schedule conflicts, and committed-capacity conflicts. |
| `apps/api/src/modules/workflows/g4.ts` | The typed `PortfolioGateFacts` / `KpiP3GateFacts`, `loadG4Facts`, the eight evaluators `G4_EVALUATORS`, and `buildG4Snapshot`. |
| `apps/api/src/modules/workflows/g4.test.ts` (new) | Unit tests of the evaluators: fail closed when unwired, the exact labels, Finance validation (stale or unvalidated), empty portfolio, ranking under an old weight set, schedule conflicts, and Unknown capacity. |
| `apps/api/src/modules/workflows/criteria.ts` | `GateFacts.g4?`; `loadGateFacts(db, id, provider?)`; the G4 evaluators registered in `EVALUATORS`. |
| `apps/api/src/server.ts` | `kpi: loadKpiP3GateFacts` (plus its import), and the stale comment updated. |
| `packages/db/migrations/0026_p3_enable_g4.sql`, `packages/db/test/integration/catalogue.test.ts` | §1. |
| `apps/api/test/integration/gates.test.ts` | The DG2 assertion now covers only G5/G6 as not submittable (`gate_not_enabled`); G4 is `submissionEnabled: true`. |
| `apps/api/test/support/p3-pending-be-e.ts` | Now empty. |
| `apps/api/test/integration/contract/p3-exercises-be-e.ts` | All 17 operations through `ctx.mirrored`, plus `P3_MIRRORS_BE_E`, plus the exported fixture `selectedInitiative()`. |
| `apps/api/test/integration/contract/contract.test.ts` | Only the two pinned counts (§5). |
| `apps/api/test/integration/portfolio/capacity.test.ts`, `funding.test.ts`, `closed-initiatives.test.ts`, `be18a.ts`, `test/integration/gates/g4.test.ts` (new) | §4 and §5. |

**Wave-2 follow-ups (work split §9, named in the assignment):**

| File | Change |
|---|---|
| `portfolio/prioritization.ts` (BE-D) | (a) `DEFAULT_FLAG_SOURCES` now uses `scheduleFlagSource` and `capacityFlagSource`. The `noFlags` constant is removed because it became unused and failed lint. (d) The local `presentInitiative` is deleted; the view calls `presentInitiatives(db, rows, flagsById)`, so `item.flags` and `item.initiative.flags` are the same list and `displayStatus` is the i18n key. |
| `portfolio/repository.ts` (BE-B) | (b) `presentInitiatives` fills `flags[]` through `initiativeFlags()`. (d) It gains an optional `precomputedFlags` parameter. (e) It gains the helper `assertInitiativeEditable(db, initiativeId)` next to `assertEditable`. |
| `portfolio/roadmap.ts` (BE-C) | (d) The local presenter is deleted; the roadmap calls `presentInitiatives(db, initiatives)`. Its response key order is unchanged. Unused imports are removed. |
| `portfolio/scores.ts` (BE-D) | (e) +1 import and 2 guard lines: score create, after validation; score update, after If-Match. |
| `portfolio/deliverables.ts` (BE-C) | (e) +1 import and 4 guard lines: create, update, submit and acceptance. |
| `portfolio/milestones.ts` (BE-C) | (e) +1 import and 3 guard lines: create, update and approve-date. |
| `platform/db-errors.ts` and `.test.ts` | (c) `["initiative_contribution_kpi_matches_outcome", "/outcomeKpiId"]` added, with its case in the unit test. |
| (f) Advisory locks | None was needed. Funding serializes on the initiative row lock (`FOR UPDATE`). Duplicate capacity rows are refused by the API check, backed by the partial unique index. I added no class and did not touch `advisory-locks.ts`. |

## 4. Behaviour per requirement (acceptance quoted)

**REQ-PB-059.** Acceptance: *"A01: a capacity demand exceeding availability shows a conflict indicator; G4 lists initiatives without owners."*

- The conflict rule follows ADR-0023 §6 exactly:
  - demand is planned + committed demand of initiatives that are not cancelled or completed;
  - `demand > available` gives `capacity.over_allocated` with the shortfall as a decimal (`"0.50"`);
  - no active capacity row gives `capacity.unknown`, with `availableFte` and `shortfallFte` both `null`. Unknown is never 0 and never reads as "no conflict".
- Tested in `capacity.test.ts` "the conflict rule", including:
  - a cancelled initiative's demand being excluded;
  - the `from`/`to` bounds;
  - raising capacity clearing the over-allocation while Unknown stays Unknown.
- G4 `g4.owners` returns 'Owners: {code} {name}' (`g4.test.ts`).
- Committing demand is a resourcing commitment and approves nothing.

**REQ-S09-004.** Acceptance: *"…overlapping demand above capacity shows a conflict indicator."*

- The capacity flags appear on the initiative representation (the one presenter) and in the prioritization view, on the item and on its initiative. `?flag=capacity.unknown` filters by them.
- The schedule flags (BE-C) are now wired into the same view.
- Tested in `capacity.test.ts` "the prioritization view carries the capacity flags".

**REQ-S09-003.** Acceptance: *"A08: a selected initiative without a funding approval shows 'Selected - unfunded' and cannot be launched."*

- One transaction writes three things, each with its audit event: the canonical `decision` (kind `executive`, `DEC-nn`, status `decided`), the `funding_decision`, and the status mirror.
- `approved` moves `selected → funded`. `rejected` and `deferred` leave it 'Selected - unfunded'. `revoked` moves `funded → selected`.
- An initiative that is not selected gives 422 `funding.not_selected`, 'Funding can only be approved for a selected initiative', and nothing is written.
- The deselect rule is in §7.1. A re-selected initiative cannot launch: it gets 422 `initiative.selected_unfunded`.
- Tested in `funding.test.ts`.

**REQ-S04-006.** Acceptance: *"G4 submission with an initiative lacking a funding decision or capacity commitment is rejected naming it; a G4 decision by a user who is not the configured approver, or by the submitter, returns 403, and a decision on a superseded submission version returns 409."*

- `g4.test.ts` asserts:
  - 'Funding decision missing: INI-01 Synthetic roaming relaunch';
  - 'Capacity commitment missing: …';
  - 403 `gate.not_approver` for FIN, the capacity owner and AUD;
  - 403 `gate.submitter_cannot_decide` (SP also holding TL, as in DG2);
  - 409 `gate.submission_superseded`.
- Delegation for funding: `onBehalfOfUserId` gets 422 `urn:mth:problem:validation`, code `funding.on_behalf_not_supported`, pointer `/onBehalfOfUserId`, with the exact ADR-0021 §6 detail ("A funding decision is decided by the approver in person; deciding on someone's behalf is not available.").
  - The check runs after the 403 gate and validation, and before the business preconditions: for a draft initiative, the delegation 422 is returned rather than `not_selected`. A create has no If-Match.
  - Nothing is written, and `on_behalf_of_user_id` is always NULL. Both are tested.

**REQ-PB-019.** Acceptance: *"A08: G4 submission where an initiative has no owner is rejected listing 'Owners'."* The 422 `gate_criteria_incomplete` entry `/criteria/g4.owners` has the message `Owners: INI-01 Synthetic roaming relaunch`.

**REQ-PB-046.** Acceptance: *"G4 submission containing an initiative with no gap link is rejected naming that initiative."* The message is `Gap link missing: INI-01 Synthetic roaming relaunch`.

**REQ-PB-055.** Acceptance: *"G4 submission with a business case whose benefit formula is unvalidated is rejected listing 'Finance validation'."* The end-to-end test submits before FIN validates the formula version. The answer is 422, with exactly one error, `{pointer: "/criteria/g4.finance_validation", code: "g4.finance_validation_missing", message: "Finance validation"}`. The gate view's missing item points at `/benefit-formulas/{id}/versions/1`. A stale baseline never counts (unit test).

**REQ-DLV-035.** Acceptance: *"G4 approval flow runs end to end."* The test "G4 end to end with distinct synthetic TL, FIN, SP and capacity-owner users":

1. TL builds the portfolio and the cases.
2. FIN validates both case baselines and the formula version, and records the approved funding (`approverRoleCode: "FIN"`).
3. The BO capacity owner commits the demand.
4. TL submits.
5. The 409, 403 and 403 cases are checked.
6. The snapshot is checked.
7. SP approves, and `currentPhase` goes from `mobilize` to `transform`.

The `mobilize` phase and G1–G3 are staged with audited fixtures.

**REQ-S16-016.** Acceptance: *"…an integration test creates and reads each one through the API with authorization enforced."*

- ResourceDemand, Capacity and FundingDecision are each created and read through the API in `capacity.test.ts`, `funding.test.ts` and the contract exercises.
- Reads by another transformation's user return 404. AUD gets 403 on every mutation (17 routes).

**G4 snapshot (ADR-0021 §7).** `snapshot.g4` holds:

- `initiatives[{id, code, version, status, waveId}]`;
- `rankingSnapshotId`;
- `weightSet{id, versionNo}`;
- `businessCases[{id, code, version, baselineValidation}]`;
- `formulaVersions[{lineId, formulaId, versionId, versionNo, validation}]`;
- `fundingDecisionIds`;
- `committedDemandIds`.

G1–G3 snapshots are unchanged.

**Closed initiatives (work split §9 item 14).** Writes to a cancelled initiative's demands, scores, deliverables and milestones all get 422 `initiative.read_only` after validation and If-Match. Nothing is written. Tested in `closed-initiatives.test.ts` and `capacity.test.ts`.

## 5. Checks run (Node 24.21.0, pnpm 10.33.0, offline; PostgreSQL 16.13; harness ports 23450–23467)

Logs are in `docs/delivery/handbacks/DG3/T-DG3-BE-E-evidence/`. The final static checks and the final integration run were on the final tree.

| Command | Result | Log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` | exit 0, `PASS gate DG2 (historical)` | `validate-historical-DG2.log` |
| `pnpm -r typecheck` | exit 0 | `pnpm_-r_typecheck.log` |
| `pnpm -r build` | exit 0 | `pnpm_-r_build.log` |
| `pnpm lint` | exit 0 | `pnpm_lint.log` |
| `pnpm openapi:lint` | exit 0; `PASS … OpenAPI 3.1.1, 270 operations` | `pnpm_openapi_lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0; "All matched files use Prettier code style!" | `prettier-ls-files.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | exit 0; 65 files, **1244/1244** | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0; 65 files, **1244/1244** | `unit-c-utf8.log` |
| `QA_PG_PORT=23466 MTH_PORT_POOL=23467-23499 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0; 54 files, **785/785**; "applied 26 migrations to a fresh database" | `integration.log`, `integration-exit.txt` |

**Earlier non-zero runs (disclosed):**

1. **Contract suite, first run** (scratch log): exit 1, with 1 of 25 failing. This was the expected pinned media-type triple: `[150, 149, 1]` against `[141, 140, 1]`. I then updated the pin.
2. **API unit suites, first run:** exit 1, with 3 failing:
   - `architecture.test.ts` found the harness `.claude/.cc-writes` directories inside `src/modules`. I deleted the empty directories, as the assignment allows.
   - `architecture.test.ts` flagged 4 "computed member with a non-literal key" uses in my audit-diff helpers. I rewrote them as `Object.fromEntries` over tuples.
   - `workflows.test.ts` pins the `EVALUATORS` key set to G1–G3. §6 covers this.

   All three passed on the reruns.
3. Before the final integration run there was one earlier full run, also exit 0 with 785/785. After it I added the REQ-PB-055 step to an existing G4 test, then reran every check above.

**Log scan.** The only match in `integration.log` for "unhandled", "timed out" or "failed to" is the DG2 BE17 probe's expected output (`BE17 db-econnreset … "unhandled error"`) from a passing test. There are no hook timeouts and no failed suites.

**New tests:**

- Integration:
  - `gates/g4.test.ts`: 4 tests;
  - `portfolio/capacity.test.ts`: 7;
  - `portfolio/funding.test.ts`: 8;
  - `portfolio/closed-initiatives.test.ts`: 1;
  - `catalogue.test.ts`: +1;
  - the `exerciseP3BeEOperations` contract exercise.
- Unit:
  - `portfolio/capacity.test.ts`: 4;
  - `workflows/g4.test.ts`: 5;
  - `db-errors.test.ts`: +1 case.

**Pinned counts in `contract.test.ts` (old → new), for the orchestrator to reconcile:**

- Media-type triple `[141, 140, 1]` → **`[150, 149, 1]`**. The 9 new JSON bodies are: create/update resource role, create/update capacity, create/update demand, commit, release, and create funding decision.
- Rate-limit floor `>= 253` → **`>= 270`**: 253 + 17 BE-E operations, which is every operation in the contract. The comment above that line still lists the tasks without "17 T-DG3-BE-E". I left it alone, because only the two assertions are mine to change.

## 6. Changes in files I do not own (please confirm or re-apply at integration)

1. **`apps/api/src/modules/workflows/gates.ts` (BE-A).** I pass the already-injected `gateFacts` provider into `loadGateFacts(…, gateFacts)` at its four call sites: the gates list, gate GET, gate PATCH view, and submit.
   - Without this, the G4 evaluators can never see the portfolio or kpi facts. `gates.ts` gave the provider only to `buildG4Snapshot`, which runs after the 422 check, and `workflows` must not import `portfolio`.
   - No other line changed. Prettier wrapped one long line.
   - G1–G3 behaviour is unchanged: their evaluators ignore `g4`, and their snapshots don't include it.
2. **`apps/api/src/modules/workflows/workflows.test.ts` (BE-A).** The test "exactly one evaluator per seeded G1-G3 criterion (16)" now expects the 16 keys plus the eight `g4.*` keys. This is a direct consequence of registering the G4 evaluators, as assigned.
3. **`portfolio/repository.ts` (BE-B), beyond the single call named in (b):**
   - the optional `precomputedFlags` parameter, needed for (d) so the prioritization view keeps its injected flag sources;
   - the helper `assertInitiativeEditable()`, used by (e) so each guard is a single line in BE-C's and BE-D's files.

## 7. Decisions and interpretations (please review)

1. **Deselect rule (BE-B §7 item 4): deselecting voids funding.**
   - A funding decision counts only for the selection it was recorded under. `latestFundingState()` reads the latest decision recorded *after* the initiative's latest `selected` portfolio-selection row. When there is no selection row, all decisions count, so existing behaviour and fixtures are unchanged.
   - Re-selection never re-mirrors to `funded`. The initiative is 'Selected - unfunded', and launch is refused, until a person records a **new** approved decision.
   - Deselecting writes no funding record, so selection and funding stay separate records.
   - Implementation: one `WHERE` clause added to BE-B's function. The rest of the function is unchanged and the comment says so. Tested in `funding.test.ts` "the deselect rule".
2. **Codes and texts the ADRs don't spell out:**

   | Code | Status | Text |
   |---|---|---|
   | `funding.not_revocable` | 422 invalid-transition | 'Only the funding of a funded initiative that is not launched can be revoked' (revoking needs status `funded`; launched or unfunded is refused) |
   | `funding.amount_invalid` | 422 | at `/amount`: negative, more than 4 decimals, or more than 16 integer digits, so `numeric(20,4)` never rounds silently |
   | `resource_demand.not_planned` | 422 invalid-transition | 'Only a planned resource demand can be changed or committed' |
   | `resource_demand.not_committed` | 422 invalid-transition | 'Only a committed resource demand can be released' |
   | `resource_demand.release_first` | 422 invalid-transition | 'A committed resource demand must be released before it is archived' |
   | `resource_role.code_taken` | 409 | |
   | `capacity.duplicate` | 409 | |
   | `resource_role.archived` | 422 | |
   | `g4.initiative_card_incomplete` | G4 missing item | 'Initiative card incomplete: {code} {name} (objective, scopeIn)'; covers the "name, objective, scope in" part of `g4.initiative_cards`, which has no listed missing code |

3. **Commit authority.** Commit and release need `capacity.commit` (BO and TO by default) through the policy function. A capacity row's `ownerUserId` without that permission cannot commit. That reads ADR-0023 §6's "capacity owner (record-level: the capacity row's owner, or a holder of capacity.commit at transformation scope)" conservatively. Committing over capacity is allowed: G4 then reports `g4.capacity_conflict`.
4. **G4 capacity conflicts** use committed demand only, per ADR-0023 §6. Committed demand on a role and month with no capacity row is Unknown, which counts as a conflict ('Capacity conflict: {role} {YYYY-MM}').
5. **G4 roadmap.** A dependency cycle can't exist because the `dependency_acyclic` guard refuses it at write time, so no cycle check is repeated. `g4.schedule_conflict` lists unresolved dependencies into in-scope initiatives that have BE-C's `schedule.needed_by_conflict` flag and a blank `mitigation`.
6. **422 body shape (observation, not changed).** ADR-0021 §7 says `errors[]` has "one entry per missing item". BE-A's `submitGate` (DG2-approved) emits one entry per incomplete criterion, joining that criterion's messages with spaces. I kept it so G1–G3 stay byte-stable. All labels still appear literally, and the per-item list with pointers is in the gate view's `criteria[].missing`. The architect may want to align the ADR text or the shape.
7. **Prettier** reformatted only the files I touched.

## 8. Not done / follow-ups

- Nothing in the assignment scope is left undone.
- For the orchestrator:
  - reconcile the pinned counts and the stale count comment (§5);
  - confirm the out-of-ownership edits (§6).
- **FE note:** the `Initiative.displayStatus` from the prioritization view is now the i18n key `initiative.status.selected_unfunded`, not the English 'Selected - unfunded'. FE-B should translate the key.

## 9. Merge instructions

- Apply migrations in order through `0026_p3_enable_g4.sql`. It is forward-only, and nothing depends on it except G4 submission.
- No dependency or lockfile change.
- No file under `apps/web/**`, `tools/**`, `.claude/**`, `docs/source/**`, `trading_agent/` or any delivery record was touched.
- Expected conflicts: none with FE-A/B/C, which own only `apps/web/**`. If another task changed `gates.ts`, `workflows.test.ts`, `repository.ts`, `roadmap.ts` or `prioritization.ts` since `e14993e`, re-apply §6 and §3 by hand. The changes are small and listed line by line above.
