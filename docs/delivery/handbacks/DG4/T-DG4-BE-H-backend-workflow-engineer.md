# Handback T-DG4-BE-H (backend-workflow-engineer): p4-work-split §F+G FG.1

- **Stage:** P4, gate DG4 (BUILDING). **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-H.md` (sha256 `3bb0a5ab…cd85`, verified).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-H-backend-workflow-engineer-20261009T103415Z-b9b3c1d2","session_id":"b9b3c1d2-00c8-491b-838e-3ecd0d50e341"}`.
- **Base:** branch `dg4/be-h` at `b1d3b7fcfa8ce42c94edb68a8d4636fbbbc5c3fc` (`git status` clean of tracked changes at start). The changes are left **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-09T10:34:32Z`; end `2026-10-09T11:39:23Z` (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, exit 0, at the start and again at the end (§3).
- **Two gate systems:** nothing here is a G1–G6 business approval, and nothing reads or writes DG0–DG7. Every test fixture is synthetic. No agent, seed or job here grants a business, Finance or IT approval.

## 1. Changed files

| File | Change | Purpose |
|---|---|---|
| `apps/api/src/modules/adoption/register.ts` | new (owned) | 15 operations: T13 stakeholder groups (`SG-nn`), `getAdoptionPlan` (the seven B0107 columns plus counts), champions, involvement (append-only, withdrawal rows), champion constraints (`?decisionId=` "visible on that decision"). It also holds the shared slice F write gate, the `SG`/`AI` code allocator and the T13 closed-list error texts. |
| `apps/api/src/modules/adoption/interventions.ts` | new (owned) | 4 operations: list, create, get and update interventions, with the `adoption_intervention_due` work item and its move or close. Also the **exported** `createBelowTrajectoryIntervention(tx, input)` for KBE-F (ADR-0033 §4 steps 3–6). |
| `apps/api/src/modules/adoption/routes.ts` | filled stub (owned, **first**) | BE-H's registration lines; BE-H2 appends its own after them. |
| `apps/api/src/modules/platform/db-errors.ts` | appended (owned lines) | New slices F/G block `mapP4AdoptionSustainmentError`, with BE-H's section (every 0047 guard of my five tables, mapped to the ADR-0033 §10 code and text or to 500 for programming errors), plus one dispatch line in `mapDatabaseGuardError` after `mapP4RaidError`. |
| `packages/shared/src/schemas/adoption-register.ts` | new (owned) | zod mirrors of the 19 operations' bodies and responses. The closed T13 enums carry their ADR codes. |
| `packages/shared/src/schemas/index.ts` | +1 export line (owned) | `export * from "./adoption-register.ts"`. |
| `packages/shared/src/schemas/events.ts` | **+1 import, +1 registry line (outside my list, disclosed in §5.2)** | Registers `"adoption.check_failed": { 1: checkFailedPayload }` (ADR-0031 §5.4). Without it the relay throws `no schema for adoption.check_failed v1`. |
| `apps/api/test/support/p4-pending-be-h.ts` | 19 → 0 entries (owned) | S-10. |
| `apps/api/test/integration/contract/p4-exercises-be-h.ts` | filled stub (owned) | All 19 operations through `ctx.mirrored` with the zod mirrors, plus their problem responses (400 stance, 409 name/champion, 428/409, 422 outcome/already-withdrawn/archived, 403 not_champion). |
| `apps/api/test/integration/contract/contract.test.ts` | media-type pin only (as the assignment asks) | `[229, 228, 1]` → `[239, 238, 1]`, with a comment listing the 10 JSON bodies. |
| `apps/api/test/integration/adoption/stakeholder-groups.test.ts` | new (owned) | 11 tests. |
| `apps/api/test/integration/adoption/interventions.test.ts` | new (owned) | 7 tests. |
| `apps/api/test/integration/adoption/champion-constraints.test.ts` | new (owned) | 6 tests. |
| `docs/delivery/handbacks/DG4/T-DG4-BE-H-*` | new | This handback and its evidence logs. |

No migration was written (D-099). Untouched: `adoption/index.ts`, `server.ts`, `adoption/indicators.ts`, the worker, and the shared migration and catalogue pins.

## 2. Behaviour delivered, per requirement row

### REQ-PB-070: acceptance "A01: T13 persists all 7 columns; stance 'Hostile' is rejected; Intervention accepts the four source values"

- **All 7 columns.** `createStakeholderGroup` persists Stakeholder (`name`), Impact (H/M/L), Current stance (support/neutral/resist), Required behavior, Intervention (`interventionTypes` ⊆ comms/training/involvement/incentive, 1–4, distinct), Owner and Adoption KPI (`adoptionKpiDefinitionId`, a KPI of the same transformation, else 422 `stakeholder_group.kpi_invalid`). `getStakeholderGroup` returns all seven, and so does `getAdoptionPlan` with the B0107 names (`stakeholder`, `impact`, `currentStance`, `requiredBehavior`, `intervention`, `ownerUserId`, `adoptionKpiDefinitionId` + `adoptionKpiName`). Test: `stakeholder-groups.test.ts` "persists and returns all seven B0107 columns…", which compares the plan row with `toEqual`.
- **'Hostile' rejected.** 400 with `errors: [{ pointer: "/currentStance", code: "stakeholder_group.stance_invalid", message: "Current stance must be Support, Neutral or Resist." }]`, on both create and update. The group count and audit trail are unchanged. Impact or Influence outside H/M/L gives `stakeholder_group.impact_invalid` with "Impact must be H, M or L." or "Influence must be H, M or L.". An intervention value outside the list gives `stakeholder_group.intervention_invalid` at `/interventionTypes/n`.
- **Four values.** Each of `comms`, `training`, `involvement`, `incentive` is accepted on its own and all four together.
- Also: 409 `stakeholder_group.name_taken` (case-insensitive among active groups; the index `stakeholder_group_name_key` is the backstop); `archiveStakeholderGroup` with a reason is final (422 `stakeholder_group.archived` on update, archive, new champion, intervention, involvement or constraint).

### REQ-S11-001: acceptance "A11: a group records influence and impact separately; an intervention with owner and due date appears in My Work"

- **Influence and impact separately.** These are two columns, set and read independently (e.g. `impact: "H", influence: "L"`, then updated to `L`/`H`).
- **My Work.** `createAdoptionIntervention` (owner and due date are required by the contract) calls `createWorkItemOnce` with kind `adoption_intervention_due`, subject `adoption_intervention`, due date = the intervention's, and dedupe `adoption.intervention:<id>:<owner>`. The test reads the owner's `GET /api/v1/me/work-items` and finds the item. An owner change cancels the previous owner's open item and creates the new owner's. `done`/`cancelled` closes it. Both close only with an `outcomeNote` (422 `adoption_intervention.outcome_required` at `/outcomeNote`), and both are final (422 `adoption_intervention.final`, "This intervention is done and can no longer be changed."). Completing a worker intervention without an owner gives 422 `adoption_intervention.owner_required`.
- Champions (M0215): add, list, remove (final, history kept); 409 `stakeholder_champion.exists`; counts on the group and in the plan.

### REQ-PB-073: acceptance "A01;A11: a champion's constraint links to a T04 decision and is visible on that decision"

- `createChampionConstraint` (`champion_constraint.raise`; BO, WL). The caller must be the **active champion named**, in person; otherwise 403 `champion_constraint.not_champion`, "Only an active champion of this group can raise a constraint.". This was proven for BO and WL holders who are not the champion, an id that names no champion, and a removed champion. The decision must be a T04 design decision (`kind = 'design'`) of the same transformation; otherwise 422 `champion_constraint.decision_invalid` at `/decisionId`.
- **Visible on that decision.** `listChampionConstraints?decisionId=<id>` lists it with the decision's `decisionCode`, and another decision's list is empty. `getAdoptionPlan` counts open constraints per group (`openChampionConstraintCount`).
- `resolveChampionConstraint`: `addressed` with a response needs `decision.edit`; `withdrawn` is only for the raising champion. Anyone else gets 403 `champion_constraint.not_resolvable_by_caller`, proven for TL withdrawing, another WL withdrawing, BO addressing and AUD. The constraint is final afterwards (422 `champion_constraint.final`).
- **Involvement in design** (the "participation is recorded on workshops and decisions" half): `createStakeholderInvolvement` takes exactly one of a TOM workshop or a T04 design decision of the transformation; otherwise 422 `stakeholder_involvement.target_invalid`. `withdrawStakeholderInvolvement` appends a withdrawal row (append-only table) with the reason as its note. A second withdrawal gives 422 `stakeholder_involvement.already_withdrawn`. The list shows the history, with `withdrawn: true` on both rows of a withdrawn pair.

### REQ-S16-020 (StakeholderGroup, AdoptionIntervention): acceptance "…an integration test creates and reads each one through the API with authorization enforced"

- My half: StakeholderGroup and AdoptionIntervention are created and read through the API in `stakeholder-groups.test.ts` and `interventions.test.ts`. Each test proves AUD 403 on every write, ADM-only and outsider 404 on every read and write, and a 404 for another transformation's record. The **entity-group test** (`entity-group.test.ts`, all four M0326 entities) is BE-H2's by p4-work-split §F+G FG.2, after KBE-F, and is not claimed here.

### Producer half of REQ-PB-069: `createBelowTrajectoryIntervention` (FG.1 proof)

- Inside the caller's transaction it does the following:
  - `pg_advisory_xact_lock(adoptionIntervention, hashtext('<link>:<scopeKind>:<scopeId>:<period>'))`;
  - insert-if-absent on `trigger_key`; a second call returns `{ outcome: "existing" }` and writes nothing;
  - owner resolution of ADR-0033 §4 step 4 (first active user: the target's owner, then the KPI owner, then the transformation lead; none gives NULL, shown `ownerStatus: "unassigned"`, with no work item);
  - the due date: `computeWorkingDayDueDate(businessDate, 5)` in the default calendar, where `businessDate = p4_business_date(event created_at, calendar tz or the organization's tz)`. With no calendar it is NULL, shown `dueUnknownReason: "calendar_not_configured"`;
  - an audit event with the caller's actor (`service`/`worker` in the test);
  - the owner's work item;
  - one `adoption.check_failed` outbox row with exactly `{ checkId, checkRecordType: "adoption_intervention", transformationId, ownerUserId, subjectLabel: <KPI name>, failedAt, businessDate }` and key `adoption.check_failed:<interventionId>`.
- **Test** (`interventions.test.ts`): a real accepted actual below an approved trajectory gives a red, adverse `kpi_evaluation`. Calling the function twice gives one intervention, one work item and one outbox event, with the payload compared exactly. With the default calendar ensured, the due date equals the pure `addWorkingDays(businessDate, 5, calendar)`. Whether an evaluation **is** below trajectory (step 2) is KBE-F's test, by FG.3.

### Shared rules S-1…S-14 as applied

- S-1: every free-text input goes through `freeText`.
- S-2: shared parser.
- S-3: the 10 JSON-body routes declare `consumes: ["application/json"]`; the bodiless `removeStakeholderChampion` declares none. Proven by the contract media-type test.
- S-4:
  - the read gate comes first (ADM-only 404);
  - the write permission is re-checked at commit time on reloaded grants (proven with `afterIdentity`/`revokeAll` on update group and update intervention);
  - `If-Match` 428/409 on every update or action of a versioned record (creates are version 1);
  - one audit event per mutation in the same transaction;
  - no remote I/O.
- S-5: no money. S-6: work items store `messageKey` `adoption.task.intervention_due` + `{code}`.
- S-10: the pending list is empty and every operation is exercised.
- S-11: every code and English text is the ADR-0033 §10 one.
- S-13: `createWorkItemOnce` only.

## 3. Checks actually run (environment: Node 24.21.0, offline; PostgreSQL 16.13 disposable cluster via `tests/qa/support/with-pg.sh`; ports `QA_PG_PORT=24050`, `MTH_PORT_POOL=24051-24099`)

All logs are under `docs/delivery/handbacks/DG4/T-DG4-BE-H-evidence/`. `exit-codes.txt` records every run in order, including the failures below.

| Command | Exit | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` |
| `pnpm -r typecheck` | **2, then 0** | First run: TS2379 in my `stakeholder-groups.test.ts` (an `undefined` header under `exactOptionalPropertyTypes`), fixed. Final run: 0 (`typecheck.log`). |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`) |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 607 operations` |
| `pnpm test` with the locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | **1, then 0** | First run: 2 failures caused by my code. (a) `architecture.test.ts`: a computed property key in `register.ts` "bypasses the module-interface check". (b) `advisory-locks.test.ts`: my comments spelled the lock number. Both fixed. Final: `Tests 2208 passed (2208)` and `259 passed \| 2 skipped (261)` (`unit-locale-unset.log`). |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1, then 0** | The same 2 failures, then the same counts: 2208 and 259 + 2 skipped (`unit-c-utf8.log`). |
| `QA_PG_PORT=24050 MTH_PORT_POOL=24051-24099 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | `Test Files 109 passed (109)`, `Tests 1223 passed (1223)` (1199 at D-101 + 24 new: 11 + 7 + 6); duration 715.66 s; first full run, no failure, no retry (`integration.log`) |
| `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical.log`) |

Targeted development runs (same harness, not the evidence of record):
- `contract.test.ts`: 45/45, exit 0.
- `stakeholder-groups.test.ts`: 11/11, exit 0.
- `champion-constraints.test.ts`: first run exit 1 because my fixture used the TOM dimension `"process"`, which is not a valid code; after the fix, 6/6, exit 0.
- `interventions.test.ts`: 7/7, exit 0.

**Pinned counts:**
- Media-type pin: `[229, 228, 1]` → `[239, 238, 1]`, a delta of **+10 JSON bodies**: `createStakeholderGroup`, `updateStakeholderGroup`, `archiveStakeholderGroup`, `addStakeholderChampion`, `createAdoptionIntervention`, `updateAdoptionIntervention`, `createStakeholderInvolvement`, `withdrawStakeholderInvolvement`, `createChampionConstraint`, `resolveChampionConstraint`.
- The contract operation count (607) is unchanged. The unit count is unchanged (2208). Integration grows by 24 tests (11 + 7 + 6) in 3 new files.

## 4. Operations routed (delta to `p4-pending-be-h.ts`)

All 19 were removed, from 19 to 0:
- `listStakeholderGroups`, `createStakeholderGroup`, `getStakeholderGroup`, `updateStakeholderGroup`, `archiveStakeholderGroup`, `getAdoptionPlan`;
- `listStakeholderChampions`, `addStakeholderChampion`, `removeStakeholderChampion`;
- `listAdoptionInterventions`, `createAdoptionIntervention`, `getAdoptionIntervention`, `updateAdoptionIntervention`;
- `listStakeholderInvolvements`, `createStakeholderInvolvement`, `withdrawStakeholderInvolvement`;
- `listChampionConstraints`, `createChampionConstraint`, `resolveChampionConstraint`.

Each is exercised in `p4-exercises-be-h.ts`, and its mirror is listed in `P4_MIRRORS_BE_H`.

## 5. Contract and schema needs, for the orchestrator

1. **The worker cannot call `createBelowTrajectoryIntervention` as placed (a design seam, needs a decision before KBE-F).**
   - p4-work-split FG.1 puts the function in `apps/api/src/modules/adoption/interventions.ts` and says KBE-F's `apps/worker/src/handlers/adoption.ts` calls it.
   - ADR-0002 rule 5 forbids the worker from importing API code. `@mth/worker` depends only on `@mth/config`, `@mth/db` and `@mth/shared`. This is the BE-D2 precedent in D-101.
   - I implemented the function where the work split says, with the exact behaviour, and proved it from the API process.
   - Its dependencies outside `@mth/db`/`@mth/shared` are three: `createWorkItemOnce` (the worker kit has a byte-equivalent twin), `computeWorkingDayDueDate`/`defaultCalendarTimezone` (organization module; small SQL plus the pure `addWorkingDays`), and the local `nextAdoptionCode` SQL.
   - **Options:** (a) KBE-F carries a worker twin, checked against this one by a shared integration test (the `createWorkItemOnce` twin precedent); or (b) the orchestrator moves the function to a package both can import.
   - In both cases the function is **not exported from `adoption/index.ts`**: I may not edit that file (FG.0). An API-side caller would need one export line there.
2. **`packages/shared/src/schemas/events.ts`** (outside my list): I added one import and the registry line `"adoption.check_failed": { 1: checkFailedPayload }`. The producer writes this event, and the relay refuses an unregistered type. The queue mapping already exists on BE-D2's side (`apps/worker/src/queues/raid.ts`). This is a purely additive line, following the KBE-E precedent (D-100).
3. **No migration need.** `0047`/`0049` hold everything FG.1 needs.

## 6. Interpretations to review (not decided by ADR-0033; reviewers please judge)

1. **Removing an already-removed champion**, and **withdrawing a withdrawal row**: ADR-0033 §10 has no slice code for these, so they return the shared 422 `invalid_transition` ("This champion is already removed." / "A withdrawal record cannot itself be withdrawn.").
2. **Involvement with neither or both targets** returns 422 `stakeholder_involvement.target_invalid` (pointer `""` for neither, `/decisionId` for both), the ADR's code for a bad target.
3. **A group named in a body** (intervention, involvement) that is not a group of the transformation returns the shared 422 `validation.reference` at its pointer. An archived group returns 422 `stakeholder_group.archived`. A constraint whose champion's group is archived also returns `stakeholder_group.archived`.
4. **Withdrawing a constraint** needs the raising champion to still hold `champion_constraint.raise` (the commit-time rule). A champion who has since lost BO/WL gets 403 `not_resolvable_by_caller`.
5. **`withdrawn` in `StakeholderInvolvement`** is true for an original that a withdrawal names and for the withdrawal row itself. The list shows all rows (history). ADR §7 says "hides withdrawn pairs and shows the history", and the contract has no filter, so the flag is how a client hides them.
6. **ADR-0033 §7 mentions `championConstraintCount`** on "the P4 decision read models it serves". The 1.3.0-p4 contract has only `openChampionConstraintCount` (on `AdoptionPlanRow`). I followed the contract and added no field.
7. **`outcomeNote` sent without a closing status** is stored, not refused.
8. **The work-item due date is not changed** when the intervention's due date changes. **Reassigning back to a previous owner** creates no new item, because the per-owner dedupe key already exists (cancelled). BE-D's RAID actions share this limitation (`raid.action:<id>:<owner>`). A fix would need a reopen or a due-date update service in `tasks`, outside FG.1.
9. **`createBelowTrajectoryIntervention` returns `skipped`** (writes nothing) when the link is no longer active or has no KPI. The `adoption.check_failed` `businessDate` uses the organization's default timezone when no calendar exists, because the payload requires a date and a business date is still defined.

## 7. What remains

- FG.1: nothing is open. All 19 operations are routed and exercised, and every listed proof has a passing test.
- Not mine, by the work split:
  - BE-H2 (FG.2): forms, invitations, assessment and training records, the REQ-S16-020 entity-group test;
  - KBE-F (FG.3): metric links, indicators, the below-trajectory consumer; it needs the §5.1 decision first;
  - FE-E: the translations of the ADR-0033 §10 codes and of `adoption.task.intervention_due`.

## 8. Merge instructions

- No migrations. This merges cleanly on `b1d3b7f`.
- Expected union conflicts:
  - `packages/shared/src/schemas/index.ts` (export lines);
  - `contract.test.ts` media-type pin (+10 on top of the concurrent tasks' deltas);
  - `platform/db-errors.ts`: BE-I also appends to the slices F/G block. Keep a single `mapP4AdoptionSustainmentError` function with both sections. My section ends with an explicit `return problems.internal();` before `default:`, so no case label falls through into another task's lines (the D-101 lesson);
  - `events.ts`, if another task registers events at the same place.
