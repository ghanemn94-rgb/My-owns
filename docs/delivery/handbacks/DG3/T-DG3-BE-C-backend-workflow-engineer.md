# Handback T-DG3-BE-C: roadmap waves, deliverables, milestones, the roadmap read model and T08 dependencies (backend-workflow-engineer)

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING). **Task:** T-DG3-BE-C.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-BE-C-backend-workflow-engineer-20261007T231224Z-43a43275","session_id":"43a43275-510d-46a8-bf47-ce67ad384054"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-BE-C.md`, sha256 `7dc8a36e…c48ef`, verified at start (`sha256sum` matched).
- **Working tree:** worktree `/home/user/wt/dg3-be-c`, branch `dg3/be-c`, base `HEAD` = `8236d61` ("DG3: wave-2 assignments"). I committed nothing.
- **Time:** start `Wed Oct  7 23:13:05 UTC 2026`; end `Wed Oct  7 23:53:01 UTC 2026` (`final.log`), about 40 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` → `PASS gate DG2 (historical)`, exit 0, at the start (before any edit), after the implementation and at the end (`validate-historical-DG2.log`, `final.log`).
- **Business records:** product gates G1–G6 are business approvals inside the product. Every acceptance and approved milestone date in the tests is a synthetic demo decision that approves nothing real. Nothing here reads or writes the DG0–DG7 records.

All six scope items are done. **No migration** was added (0020–0025 already hold every table, trigger and guard BE-C needs). Two checks are red **only** in this worktree, for reasons outside my files; §6 shows each one and the clean-copy runs that pass. One change is needed in a file I do not own (§7.1).

## 1. API endpoints routed (25 operations, frozen contract)

| Operation | Route | Access (and record-level rule) |
|---|---|---|
| `listRoadmapWaves` | `GET /api/v1/transformations/{id}/waves` | `transformation.read` |
| `createRoadmapWave` | `POST …/waves` | `roadmap.edit`; non-source wave only |
| `getRoadmapWave` | `GET …/waves/{waveId}` | `transformation.read` |
| `updateRoadmapWave` | `PATCH …/waves/{waveId}` (If-Match) | `roadmap.edit`; editable columns only |
| `getRoadmap` | `GET /api/v1/transformations/{id}/roadmap` | `transformation.read` |
| `listDeliverables` | `GET /api/v1/initiatives/{initiativeId}/deliverables` | `transformation.read` |
| `createDeliverable` | `POST …/deliverables` | `initiative.edit` |
| `getDeliverable` | `GET /api/v1/deliverables/{id}` | `transformation.read` |
| `updateDeliverable` | `PATCH /api/v1/deliverables/{id}` (If-Match; `archiveReason` archives) | `initiative.edit` |
| `submitDeliverable` | `POST …/{id}/submit` (If-Match) | `initiative.edit` |
| `decideDeliverable` | `POST …/{id}/acceptance` (If-Match) | `deliverable.accept` **and** the initiative's executive owner or their delegate; never the submitter |
| `listMilestones` | `GET /api/v1/initiatives/{initiativeId}/milestones` | `transformation.read` |
| `createMilestone` | `POST …/milestones` | `initiative.edit` or `roadmap.edit` |
| `getMilestone` | `GET /api/v1/milestones/{id}` | `transformation.read` |
| `updateMilestone` | `PATCH /api/v1/milestones/{id}` (If-Match) | `roadmap.edit` |
| `approveMilestoneDate` | `POST …/{id}/approve-date` (If-Match) | `roadmap.approve` |
| `listT08Dependencies` | `GET /api/v1/dependencies?transformationId=…` (cursor, limit, `initiativeId`, `includeArchived`) | `transformation.read` |
| `createT08Dependency` | `POST /api/v1/dependencies` | `dependency.edit` |
| `getT08Dependency` | `GET /api/v1/dependencies/{id}` | `transformation.read` |
| `updateT08Dependency` | `PATCH /api/v1/dependencies/{id}` (If-Match) | `dependency.edit` |
| `archiveT08Dependency` | `POST …/{id}/archive` (If-Match, reason) | `dependency.edit` |
| `listDependencyTypes` | `GET /api/v1/dependency-types` | `authenticated` (see §7.1) |
| `createDependencyType` | `POST /api/v1/dependency-types` | `dependency_type.configure` in the caller's organization |
| `updateDependencyType` | `PATCH …/{dependencyTypeCode}` (If-Match) | `dependency_type.configure` |
| `retireDependencyType` | `DELETE …/{dependencyTypeCode}` (If-Match; soft retire) | `dependency_type.configure` |

**The mutation pattern.** Every mutation route declares `config.consumes: ["application/json"]` (the contract's media type; the DELETE has no body). Each one does the following in one transaction, in this order:

1. The read gate (404, existence never disclosed).
2. A lock: the row `FOR UPDATE`; for creates, the parent initiative or transformation row; for T08, the graph advisory lock; for a new type code, `pg_advisory_xact_lock(730222, hashtext(code))`.
3. The write gate, re-authorised on grants reloaded **inside** the transaction after any lock wait (`openWrite(…, { atCommit: true })` / `refreshPrincipal`, the BE18A pattern). This happens before the body is parsed, so a read-only auditor gets 403 for any body.
4. Validation with zod mirrors (free text through `freeText`), then the 422 business rules.
5. `If-Match` (428/409 with `currentVersion`). Creates are version 1.
6. The write, then one audit event with the field diff.

No client or remote I/O happens inside a transaction: Fastify parses the body before the handler runs, and the schedule flags are computed after commit.

## 2. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/portfolio/waves.ts` | Wave routes, the `RoadmapWave*` zod mirrors, `toRoadmapWave` and `loadWaves`. Also the BE-C write prologue the other portfolio files share: `lockForWrite`, `checkVersion`, `rule`, `transitionProblem`, `forbiddenProblem`, `dateText`, `JSON_BODY`. It sits first in the import order, so there is no import cycle. |
| `apps/api/src/modules/portfolio/deliverables.ts` | Deliverable routes, `toDeliverable`, `loadDeliverables`, `deliverableCountWarning` (3–7) and `readableInitiative`. |
| `apps/api/src/modules/portfolio/milestones.ts` | Milestone routes, the `MilestoneUpdate`/`MilestoneDateApproval` zod mirrors, `toMilestone`, `varianceDays` (computed) and `loadMilestones`. |
| `apps/api/src/modules/portfolio/roadmap.ts` | `GET …/roadmap` (one read-only REPEATABLE READ snapshot), `loadScheduleFacts`, the Initiative presenter for the read model, `toRoadmapDependency`, and the `t08ScheduleFlags` provider it decorates onto the Fastify instance for the T08 routes. |
| `apps/api/src/modules/portfolio/schedule.ts` (new) | Pure ADR-0023 §5 functions: `predecessorFinish`, `dependencyFlags`, `computeScheduleFlags` and `SCHEDULE_FLAG_CODES`. |
| `apps/api/src/modules/portfolio/schedule.test.ts` (new) | 14 unit tests: needed-by conflict, before-predecessor by date and by wave, Unknown in 5 forms, and indexing. |
| `apps/api/src/modules/workflows/t08-dependencies.ts` (new) | T08 routes. Exports `DEPENDENCY_GRAPH_LOCK_CLASS = 730221`, the T08 zod mirrors, `toT08Dependency`, `findCycle` (BFS), `T08CycleProblem` (the exact 422 body) and the `T08ScheduleFlagsProvider` seam (Fastify decorator `t08ScheduleFlags`, declared here). |
| `apps/api/src/modules/workflows/dependency-types.ts` (new) | Dependency-type routes, the zod mirrors and `DEPENDENCY_TYPE_LOCK_CLASS = 730222`. |
| `apps/api/src/modules/workflows/design-registers.ts` | **Only the DG2 projection rule**: `dg2DependencyType()` shows non-DG2 codes as `other`, and the `check` refuses a DG2 PATCH that changes `fromKind`/`toKind` of a row with initiative endpoints (422 `dependency.managed_by_t08`). The label rule skips sides that carry an initiative id, so other DG2 edits of a T08 row still work. |
| `apps/api/src/modules/workflows/index.ts` | Registration lines for `registerT08DependencyRoutes` and `registerDependencyTypeRoutes`, plus **type-only** exports `T08Dependency` and `T08ScheduleFlagsProvider`. There are no new runtime exports, so the pinned public-surface test stays green. |
| `apps/api/test/support/p3-pending-be-c.ts` | Now empty (all 25 routed and exercised). |
| `apps/api/test/integration/contract/p3-exercises-be-c.ts` | Exercises all 25 operations through `ctx.mirrored`, with `P3_MIRRORS_BE_C` (25 entries plus `roadmapView`). Also holds the shared fixtures `insertInitiatives` (synthetic initiatives with their audit event; the initiative create route is BE-B's), `WAVE_BODY` and `whileBlocked` (the commit-time authorisation probe). |
| `apps/api/test/integration/contract/contract.test.ts` | **Only the two pinned counts** (§5). |
| `apps/api/test/integration/dependencies/t08.test.ts` (new) | 19 integration tests (§4). |
| `apps/api/test/integration/portfolio/roadmap.test.ts` (new) | 12 integration tests (§4). |
| `docs/delivery/handbacks/DG3/T-DG3-BE-C-*` | This handback and its evidence logs. |

## 3. Behaviour per requirement

**REQ-PB-050**. Acceptance: *"A01: four waves seeded with values verbatim (e.g. '0-6 weeks', 'Sponsor + charter'); overlapping horizons are accepted"*.

- A new transformation lists the four B0079 waves with every source column verbatim. The test asserts all 4 × (code, ordinal, name, purpose, horizon, entry criteria, exit evidence, horizon weeks, seeded flag), for example `"Wave 0 — Mobilize"`, `"0-6 weeks"`, `"Sponsor + charter"`, `"Approved case, owners, stage gates"`, 0–6. Arabic text is present (provisional translation).
- Only the editable columns can change: `plannedStart`, `plannedEnd`, `ownerUserId`, `notes` and `status`. A source field in the PATCH body is 400 (strict schema). The test also shows the DB trigger refusing a direct source change (`23514 roadmap_wave_source_immutable`).
- A seeded wave cannot be archived: 422 `roadmap_wave.seeded_not_archivable`.
- Teams add non-source waves (`isSourceSeeded: false`, ordinal max+1). A duplicate code is 409 `roadmap_wave.duplicate_code`, and horizon end < start is 422.
- **Overlap is accepted:** the test adds an 8–17-week wave that overlaps Wave 1 (4–13) and Wave 2 (13–39), with overlapping planned dates.

**REQ-PB-045 (deliverables, milestones) and REQ-S09-007 (P3 increment)**. Acceptance: *"Key deliverables outside 3-7 shows a warning"*.

- `listDeliverables.countWarning` is `initiative.deliverable_count` when the number of active deliverables is outside 3–7. It is null at 3. It is a warning, never a rejection.
- Submit: `pending|rejected → submitted`.
- Acceptance: `submitted → accepted|rejected`. It needs `deliverable.accept` and the initiative's executive owner, or a delegate who names the owner in `onBehalfOfUserId` and holds an active one-hop delegation (`actsOnBehalfOf`). The event is audited with `on_behalf_of_user_id`.
  - The submitter can never decide, in person or through a delegate acting for them: 403 `deliverable.acceptor_is_submitter`. The DB CHECK is the backstop.
  - A `deliverable.accept` holder who is not the owner gets 403 `deliverable.not_owner`.
- A resubmission clears the earlier decision fields.
- Milestones:
  - `approved_date` is written only by `approve-date` (`roadmap.approve`), with the approver, timestamp and reason. The audit event is `milestone.approve_date`; a re-approval is `milestone.reapprove_date` with its own reason.
  - Neither the create nor the PATCH schema accepts `approvedDate` (400).
  - `forecast_date` is editable.
  - `varianceDays` = forecast − approved, computed on read and null (Unknown) when either is missing. The test checks that there is no `variance_days` column. See §7.2 for working days.
  - `achieved` exactly when there is an actual date (422 `milestone.actual_date_status`, mirroring the DB CHECK).

**REQ-S09-006**. Acceptance: *"A14: moving a milestone on the timeline updates the table and board; conflicting concurrent edits show a conflict"*.

- `GET …/roadmap` returns `{transformationId, waves, initiatives, milestones, deliverables, dependencies}`, each element with its `version`, and `flags[]` on initiatives and dependencies. Everything is read in one read-only REPEATABLE READ transaction (one snapshot).
- The test moves a milestone with `PATCH /milestones/{id}`. The same read model then shows the new forecast (version 2) and the resulting `schedule.needed_by_conflict` on both the dependency and the successor initiative.
- A second editor holding the stale version gets **409** `urn:mth:problem:version-conflict` with `currentVersion: 2`.
- The roadmap's `initiatives` use a presenter in `roadmap.ts`:
  - T05 fields;
  - `fundingState` via `latestFundingState()`, or `not_applicable` before selection;
  - `displayStatus`, with `initiative.status.selected_unfunded`;
  - the warnings `initiative.deliverable_count`, `initiative.no_gap_link` and `initiative.no_owner`;
  - the schedule flags.

  See §7.3.

**REQ-S09-008, REQ-PB-051 and REQ-DLV-035 (cycles)**. Acceptance: *"A->B->C->A is rejected naming the cycle; a predecessor finishing after the successor's needed-by date is flagged"* and *"T08 persists all 7 columns; From accepts an initiative or 'External'; a cycle A->B->A is reported"*.

- The seven columns round-trip: code + description, From (initiative id, or `external` + label), To (initiative), type, needed by, owner, and status + mitigation.
- External From is accepted (no edge). Its schedule is `schedule.unknown`.
- **Cycle check:**
  1. `pg_advisory_xact_lock(730221, hashtext(transformation_id))`.
  2. Then the friendly BFS (`findCycle`, bounded to 10 000 edges; past that the database guard decides).
  3. Then the write. The DB guard re-checks under the same lock.
- The 422 body is exactly ADR-0023 §5. The test asserts it field by field:
  - `type: urn:mth:problem:validation`
  - `code: dependency.cycle`
  - `detail: "Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01"`
  - `errors: [{pointer: "/toInitiativeId", code: "dependency.cycle", message: <same>}]`
  - `cycle: [{initiativeId, code, name} × 4]`, first node repeated at the end.
- A→B→A is reported as `INI-01 → INI-02 → INI-01`.
- The PATCH re-runs the check when an endpoint changes. An archived edge no longer counts.
- Nothing is written when a cycle is refused (row counts and versions are checked).
- **Race:** see §4. The API race and the database-guard race each end with exactly one commit.

**REQ-PB-052**. Acceptance: *"the four source types are present and cannot be deleted; an unknown type value is rejected by the API"*.

- The five system rows are listed: decision, tech, data, vendor (`B0081`) and other (`M0136`).
- `DELETE` on each of them is 422 `dependency_type.system_undeletable`, and the rows stay `active`, version 1.
- An unknown type, or a retired one, is 422 `dependency.unknown_type` with detail `Unknown dependency type: <value>` and pointer `/dependencyType`.
- Custom types can be added (409 on a duplicate, including a retired code), relabelled or reordered, and retired. Retirement is soft: the type stays on existing rows and the row is never deleted.

**REQ-S09-004 (BE-C's part, `schedule.ts`)**. Acceptance: *"an initiative sequenced before its predecessor is flagged"*.

- `schedule.before_predecessor` fires when the successor's planned start is before the predecessor's finish, or when the successor's wave ordinal is lower than the predecessor's. The roadmap test moves INI-02 into Wave 0 ahead of INI-01 (Wave 1) and sees the flag.
- `schedule.unknown` is emitted whenever a needed date is missing. It is never an empty "no conflict" list.

**REQ-S16-016 (Deliverable, Milestone, RoadmapWave, Dependency)**. Create and read of each go through the API with authorisation:

- The positive tests: 201 with version 1, ETag and Location, then GET 200.
- The negative tests: AUD 403 on every create, and 404 for a user without access.
- The contract exercise validates every success body against the contract and the zod mirror.

**DG2 projection (ADR-0023 §4)**:

- On `/transformations/{id}/dependencies`, a custom type code is shown as `"other"`, and the DG2 body has no T08 fields.
- A DG2 PATCH that changes `toKind` on a row with initiative endpoints is 422 `dependency.managed_by_t08` (pointer `/toKind`).
- A DG2 PATCH of the description still works and keeps the T08 endpoints.
- Every existing DG2 test passes unchanged in the clean-copy integration run.

## 4. New tests

- **`schedule.test.ts`**: 14 unit tests.
- **`t08.test.ts`**: 19 tests.
  - Seven columns and audit; external From; unknown and retired type 422; self and foreign initiative 422; system type DELETE 422 (all five); custom type lifecycle with AUD/TL 403, 428/409, audit and duplicate 409.
  - Commit-time 403 on type create.
  - A→B→C→A named exactly; A→B→A named, and an archived edge freed; PATCH re-check.
  - **Two API requests A→B and B→A queued on the held graph lock, then released: exactly one 201, one 422, and 1 row.** **Two raw database connections inserting A→B and B→A: the second fails with `23514 dependency_acyclic`, message `dependency cycle: INI-02 -> INI-01 -> INI-02`, and 1 row.**
  - `findCycle` unit.
  - AUD 403 (audited `authorization.denied`), 428/409 and archive audit.
  - Commit-time 403 on create (graph-lock wait), update and archive (row-lock wait).
  - Needed-by conflict flagged, then cleared by moving the milestone.
  - Unknown flags.
  - DG2 projection.
- **`roadmap.test.ts`**: 12 tests.
  - Four waves verbatim; editable-only edits (403/428/409/400/422, audit diff, DB trigger); non-source waves with overlap and 409/422; commit-time 403 on wave create and update.
  - Deliverable CRUD, count warning, archive; submit, owner-only acceptance, SoD, reject/resubmit/accept, audit trail; delegate acceptance; commit-time 403 on create, update, submit and acceptance.
  - Milestone approve-date and re-approval; variance; forecast move with 428/409 and achieved rule; commit-time 403 on create, update and approve-date.
  - The roadmap read model end to end.

**How commit-time authorisation is proven.** `whileBlocked` holds the relevant lock in a separate owner-role transaction and starts the request. It waits until `pg_blocking_pids` shows the request blocked on that lock, then revokes the caller's grant, then releases. The result is 403, audited as `authorization.denied`, with nothing written. That shows the write decided on grants reloaded *after* the wait.

## 5. Pinned contract counts (`contract.test.ts`; only these two lines changed)

- **Media-type triple:** `[90, 89, 1]` → **`[104, 103, 1]`**. The 14 new JSON bodies are: waves create and update; deliverables create, update, submit and acceptance; milestones create, update and approve-date; T08 create, update and archive; types create and update. `retireDependencyType` is a DELETE with no body.
- **Rate-limit floor:** `>= 167` → **`>= 192`** (167 + 25 BE-C operations). The live sweep checked every live operation.
- `toHaveLength(270)` is unchanged. P3 pending is now: BE-A 0, **BE-C 0**, BE-B 20, BE-D 17, BE-E 17, KBE-B 11, KBE-C 13.

## 6. Checks run (Node 24.21.0, pnpm 10.33.0, offline, PostgreSQL 16.13; ports 23250–23299 only)

Logs are in `docs/delivery/handbacks/DG3/T-DG3-BE-C-evidence/`.

| Command | Result | Log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` | `PASS gate DG2 (historical)`, exit 0 (start, after the implementation, end) | `validate-historical-DG2.log`, `final.log` |
| `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| `pnpm -r build` | exit 0 | `build.log` |
| `pnpm lint` | exit 0 | `lint.log` |
| `pnpm openapi:lint` | exit 0, "OpenAPI 3.1.1, 270 operations" | `openapi-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" | `prettier-ls-files.log`, `final.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` (worktree) | **exit 1**: 56 files, **1135/1137**; 2 failures explained below | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (worktree) | **exit 1**: 56 files, **1135/1137**; the same 2 failures | `unit-c-utf8.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` (clean copy, see below) | **exit 1**: **1136/1137**; only failure (a) | `unit-clean-copy-without-harness-artifact.log` |
| `QA_PG_PORT=23260 MTH_PORT_POOL=23261-23299 tests/qa/support/with-pg.sh pnpm test:integration` (worktree) | **exit 1**: 44 files, **666/669**; 3 failures, all failure (b) | `integration.log` |
| `QA_PG_PORT=23270 MTH_PORT_POOL=23271-23299 tests/qa/support/with-pg.sh pnpm test:integration` (clean copy) | **exit 0**: 44 files, **669/669**; "applied 25 migrations to a fresh database" | `integration-clean-copy-without-harness-artifact.log` |

**The two failure causes, both disclosed:**

**(a) My decision; it needs a one-line change in BE-A's file (§7.1).** `workflows.test.ts` › "registers its routes, each declaring access": the test pins every workflows `GET` to `transformation.read`. `GET /api/v1/dependency-types` is the first *global* read in workflows. The frozen contract gives it 200/400/401/429 and no 403, so any signed-in user may read it. The ADM_METHOD who configures types doesn't even hold `transformation.read`. I declared it honestly as `authenticated`, rather than claiming a permission the route doesn't enforce.

**(b) A harness artifact, not in the tree.** The Claude Code write tracker created empty `.claude/.cc-writes/` directories inside the worktree. They're untracked, so git doesn't show them, and they appeared even in directories I never wrote, such as `packages/db/migrations/.claude/`. They make:

- `architecture.test.ts` › "has only mapped module directories" report `['.claude']`;
- `packages/db/.../migrate.test.ts` fail three times copying `migrations/.claude/`.

I did not delete them, because they belong to the run's write tracking.

**Clean copy.** To show the tree itself is sound, I copied the worktree to `$TMPDIR/clean-copy` without any `.claude` directory and ran the full suites there. A `diff -rq` of `apps/api` against the worktree, excluding `node_modules`, `.claude` and `dist`, was empty. The integration suite passes 669/669 with exit 0, and `architecture.test.ts` passes 136/136. The orchestrator's integration tree won't contain these directories.

**Log scan.** `integration-clean-copy-…log` matches "unhandled/timed out/failed to/Error:" only on the DG2 BE17 ECONNRESET probe output, which comes from a passing test. In the worktree `integration.log` the only other matches are the three artifact errors. No hook timed out.

**Count arithmetic:** integration 638 (BE-A/ARCH-02) → 669 (+19 T08, +12 roadmap). Unit tests: +14 (`schedule.test.ts`).

## 7. Changes needed in files I do not own, and open points

**7.1 (needed; BE-A's `apps/api/src/modules/workflows/workflows.test.ts`).** Line ~66 reads:

```ts
if (r.key.startsWith("GET")) expect(permission, r.key).toBe("transformation.read");
```

Allow the one global catalogue read:

```ts
if (r.key.startsWith("GET"))
  expect(permission, r.key).toBe(r.key === "GET /api/v1/dependency-types" ? "authenticated" : "transformation.read");
```

The alternative is for the architect to add a 403 to `listDependencyTypes` and define who may read the catalogue. Then I would switch to `transformation.read` (or `dependency_type.configure`) with a real check.

**7.2 (open point for the architect; REQ-S09-007, final gate later).** REQ-S09-007 says *"forecast slip vs approved date is shown in working days"*. The frozen contract (`Milestone.varianceDays`: "forecastDate - approvedDate in days") and ADR-0023 §2 ("in days") define calendar days, and P3 has no business-calendar model. I implemented the contract. I recommend adding a working-day slip (on the configurable calendar, default Asia/Riyadh, with no hardcoded holidays) when the business calendar lands, rather than relabelling calendar days.

**7.3 (integration note for BE-B).** The roadmap's `initiatives[]` need the `Initiative` representation, and BE-B's presenter isn't in this tree. So `roadmap.ts` has `presentInitiatives()`, which follows the contract and ADR-0021 §2, and the contract test validates it with the shared `initiative` zod mirror. The warning **messages** are my wording; the ADR fixes only the codes. At integration, the orchestrator may replace it with BE-B's presenter if BE-B exports one, so the two can't drift. The BE-B and BE-E schedule and flag consumers can import `computeScheduleFlags` and `loadScheduleFacts` from inside the portfolio module.

**7.4 (optional, BE-A's `platform/index.ts`).** `DependencyCycleProblem` in `db-errors.ts` is not on platform's public interface, and deep imports are forbidden. `t08-dependencies.ts` therefore has `T08CycleProblem`, with an identical body that also includes the `name`s. Exporting `DependencyCycleProblem` would let both share one class.

**7.5 (seam design, for reviewers).** `workflows` may not import `portfolio`. The T08 routes therefore read the flags through `T08ScheduleFlagsProvider`, which `portfolio/roadmap.ts` decorates onto the Fastify instance (`t08ScheduleFlags`) at registration. If it is unwired, every scheduled dependency gets `schedule.unknown` (fail closed, never "no conflict"). `server.ts` was not touched. If the orchestrator prefers explicit injection like `gateFacts`, the alternative is a one-line option in `server.ts` plus `registerWorkflowsModule`.

**7.6 (advisory lock registry).** In use: 730219 (BU hierarchy), 730220 (outcome), 730221 (dependency graph), and the new **730222** (one type code's creation, API only).

**Not in scope / not done:**

- REQ-PB-051's automation "critical dependency slips → notify owners" (later stage).
- Critical-path analysis: explicitly out of P3 (ADR-0023 §5). No such claim is made.
- No frontend work.

## 8. Merge instructions

- No migration and no dependency or lockfile change.
- Files are disjoint from BE-B, BE-D and KBE-B by construction. The shared touch points are:
  - `workflows/index.ts`: my registration and type-export lines only;
  - `contract.test.ts`: the two pinned counts. The orchestrator reconciles them across tasks: each task adds its own JSON-body count and operation count.
- Apply §7.1 when integrating, or `pnpm test` keeps one failing assertion.
- Don't commit the empty `.claude/.cc-writes/` directories, or the sandbox-masked root dotfiles (`.bashrc`, `.gitmodules`, `CLAUDE.local.md`, …).

## 9. End of run

`final.log` holds the end `date -u`, the final `validate.mjs --historical --stage DG2` and the final prettier check over all files (including this handback).
