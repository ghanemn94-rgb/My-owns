# Handback T-DG5-BE-J (backend-workflow-engineer): starters as rules, S12-004 instantiation, dependency slips

## Continuation run (T-DG5-BE-JB)

- **This run:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-JB-backend-workflow-engineer-20261014T232512Z-65407cf3","session_id":"65407cf3-e10a-4ec5-b831-88c0a36985d7"}`.
  - Assignment `docs/delivery/assignments/DG5/T-DG5-BE-JB.md`, sha256 `a3c57037…51eea` (verified at start).
  - Start `2026-10-14T23:25:25Z` (`date -u`); end in §9.
- **Interrupted run:** `DG5-T-DG5-BE-J-backend-workflow-engineer-20261014T214648Z-d16a7a73` (D-151, the D-147 procedure).
  - It was stopped by the container restart at `2026-10-14T23:24:19Z`, exit 143 with no result line.
  - Its transcript shows it was waiting on its final full integration run (`Full integration run alone`, killed, exit 137).
  - Its tree is the orchestrator's WIP commit `4eee6f9` on `dg5/be-j`, which this run continued from. This run's own changes are **uncommitted** on top of `4eee6f9`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exits 0, `PASS gate DG4 (historical)` (`validate-dg4-historical-start-B.log`), at the start and again at the end (§9).

### What I found (handback compared with the tree)

1. **Every file in §1 exists and contains what §1 says.**
   - I read the named-line edits in `handlers/index.ts`, `queues/index.ts`, `transformations/routes.ts`, `workflows/gates.ts`, `sustainment/handovers.ts`, `methodology/revision-impact.ts` and `portfolio/milestones.ts`, and the headers of `starters.ts` and `platform/request-executions.ts`. They match §1 and §6.
   - `apps/api/src/modules/automation/request-executions.ts`, which the interrupted run wrote first, does not exist: it was moved to `platform/request-executions.ts` (§6.1).
   - The tree typechecks, so no source file is truncated.
2. **One stale comment.** `apps/worker/src/automation/starters.ts` still named `apps/api automation/request-executions.ts`. Corrected to `platform/request-executions.ts` (a comment only; no other stale reference: `grep -rn "automation/request-executions" apps packages` finds none).
3. **The handback was incomplete.**
   - §9 was the placeholder `FINAL_CHECKS_PLACEHOLDER`. It is now filled from this run.
   - The interrupted run's `integration.log` ends mid-run (it was the run killed by the restart): no summary and no exit line.
4. **The logs of the interrupted run are kept unchanged as provenance, but none of them is acceptance evidence.** This covers every log without the `-B` suffix. Some are partial or show failures that were fixed later:
   - `integration-run1-crashed.log`: exit 1, with 2 failures and an `ERR_IPC_CHANNEL_CLOSED` worker crash;
   - `unit-locale-unset-run1-stale.log` and `unit-locale-unset-run2-under-load.log`: exit 1.
   §3 explains these runs. **Every acceptance check of this assignment was re-run by this run on the final tree, with `-B` logs (§9).**
5. **`launch_procedure`: still not done.** It is the separable second half named in §7.1. This run checked whether it could be finished, and found a **contract blocker** besides the time needed for a full worker twin and its parity test (§5.7):
   - a `service`-identity launch cannot be stored (`procedure_instance.launched_by` is `NOT NULL REFERENCES app_user`);
   - an approval step cannot be requested without a person (`requestApprovalInTx`).
   The architect must decide this before the action is implemented. I did **not** register a descriptor: registering one would make the action `adminSelectable` (ADR-0043 amendment item 4) with no worker executor behind it.

### What I finished and re-ran

- Corrected the comment above (item 2).
- Added §5.7 (the `launch_procedure` contract blocker) and updated §7.1.
- Filled §9 with this run's checks: typecheck, build, lint, prettier, openapi lint, `pnpm test` with the locale unset and with `C.UTF-8`, the integration suite on a disposable PostgreSQL (ports 23800–23849), and the DG4 historical validator at the start and at the end. Every result is from this run's `-B` logs.

---

The sections below are the interrupted run's handback. Where a statement is no longer true, it has been corrected in place.

- **Stage / gate:** P5, DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §E.1.
- **Invocation reference (interrupted run):** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-J-backend-workflow-engineer-20261014T214648Z-d16a7a73","session_id":"d16a7a73-8c7d-4c25-af80-07c8ad0a28b3"}`. Continued by T-DG5-BE-JB (above).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-J.md`, sha256 `cbcf295c…aa5a` (verified at start).
- **Base:** branch `dg5/be-j`. The interrupted run started at `HEAD` `b8c9769f50aab36363ba4127fc63de5292240cfc` (the D-150 integrated tree). Its work is the WIP commit `4eee6f9`, made by the orchestrator, and this run's changes are left **uncommitted** on top of it.
- **Time:** the interrupted run started at `2026-10-14T21:47:03Z` and was stopped at `2026-10-14T23:24:19Z`. The continuation run's end time is in §9.
- **Engineering gates vs product gates:** nothing here reads or writes DG0–DG7. No starter, job, seed or test decides a G1–G6 approval. The one gate decision in the tests is a synthetic demo decision by a test person, the DG4 test pattern.
- **Migrations:** none. `0077` is left unused, because no starter needed a seed change.
- **API endpoints added:** `GET /api/v1/transformations/{transformationId}/dependency-slips` (`listDependencySlips`). Extended: `POST /api/v1/transformations` accepts the optional `launchPlan: {startDate}` (`createTransformation`, additive).

## 1. Changed files

### New

| File | Purpose |
|---|---|
| `apps/worker/src/automation/starters.ts` | `withStarterRule(ruleCode, handler)` / `withStarterRules` / `runAsStarter`. Each DG4 handler stays on its own queue, unchanged, and each trigger occurrence is recorded as one `automation_execution` of the rule's effective version under lock 730258, with one `starter_handler` action result. On the last failed attempt the execution becomes `failed` (`automation.retries_exhausted`) and the error is rethrown. A failure-queue retry resumes the same execution (attempt + 1). Also holds the queue → starter map. |
| `apps/worker/src/automation/ports/launch-plan.ts` | Worker-side `LaunchPlanPort`, no-op default (`port_unavailable`), plus `registerLaunchPlanPort` for BE-P. |
| `apps/api/src/modules/automation/ports/launch-plan.ts` | The API-side `LaunchPlanPort` the assignment names: same signature, no-op default, `registerLaunchPlanPort` for BE-P's `server.ts` line. |
| `apps/api/src/modules/platform/request-executions.ts` | `recordRequestExecution(tx, starter, triggerKey, scope)` for request starters 5, 14 and 15, written in the request's own transaction. **Moved here from the assigned path `automation/request-executions.ts`** (§6.1). |
| `apps/api/src/modules/portfolio/slip-events.ts` | `recordDependencySlips(tx, scope, before, after)`. Detects a critical slip with the DG4 `predecessorFinish` and `loadScheduleNetwork`, both unchanged. Writes the `dependency_slip` row, its audit event and the `dependency.slipped` outbox event. |
| `apps/api/src/modules/portfolio/dependency-slips.ts` | `listDependencySlips` route: `transformation.read` in scope; cursor-paginated, newest first. |
| `apps/worker/src/handlers/portfolio.ts` | `portfolio.dependency_slip` consumer (starter 9): one `dependency_slip` work item and notification per distinct affected owner; `runOnce` and dedupe keys. |
| `apps/worker/src/queues/portfolio.ts` | The `portfolio.dependency_slip` queue and the `dependency.slipped` → queue map. |
| `packages/shared/src/schemas/dependency-slips.ts` | Zod mirrors `dependencySlip`, `dependencySlipAffected` and `dependencySlipPage` of the OpenAPI schemas. |
| `apps/worker/test/integration/starters.test.ts` | Worker regression per starter, replay ×3, failure and resume, and S12-004 (24 tests). |
| `apps/api/test/integration/automation/starters-be-j.test.ts` | API: gate starters 5, 6 and 7; launchPlan; slips (critical path, needed-by, non-critical, below a published `minimumSlipDays`); list route; request recorder (9 tests). |

### Modified

Each edit is limited to named lines.

| File | Purpose |
|---|---|
| `apps/worker/src/handlers/platform.ts` | P5 lines of `handleTransformationCreated`: v1 and v2 consumer, phase checklist, role-assignment tasks and the launch-plan port call, all in the existing `runOnce` transaction. The audit reason no longer says "methodology content arrives in P2/P5", because that is now untrue. |
| `apps/worker/src/handlers/index.ts` | `DOMAIN_HANDLERS = withStarterRules([...])`; `handleTransformationCreated` exported through the wrapper (`worker.ts` imports it from here, so `worker.ts` is untouched); `PORTFOLIO_HANDLERS` import. |
| `apps/worker/src/queues/index.ts` | `PORTFOLIO_QUEUES` and `PORTFOLIO_EVENT_QUEUES`, with the event map placed before the engine's (D-102 order: domain, then engine). |
| `apps/api/src/modules/transformations/routes.ts` | The create route emits `transformation.created` **v2** with `launchPlan`. Two lines. |
| `apps/api/src/modules/portfolio/milestones.ts` | One `recordDependencySlips` call in `updateMilestone` and one in `approveMilestoneDate`, plus the import. |
| `apps/api/src/modules/portfolio/index.ts` | Registration line for `registerDependencySlipRoutes`. There is no `portfolio/routes.ts`; registration lives in `index.ts`. |
| `apps/api/src/modules/workflows/gates.ts` | Starter 5 call line after `gate_submission.create`, plus the import. |
| `apps/api/src/modules/sustainment/handovers.ts` | Starter 14 call line at the end of `acceptHandover`, plus the import. |
| `apps/api/src/modules/methodology/revision-impact.ts` | Starter 15 call line when a proposal is created, not on a replay, plus the import. |
| `apps/api/src/modules/platform/index.ts` | One export block for the request recorder (§6.1). |
| `packages/shared/src/schemas/events.ts` | `transformationCreatedV2` (registered as `transformation.created` v2; v1 kept) and `dependencySlippedV1` (exported, parsed by producer and consumer; deliberately **not** registered in `OUTBOX_EVENT_SCHEMAS`, see §5.6). |
| `packages/shared/src/schemas/transformation.ts` | `launchPlan` member of `transformationCreate` (optional, strict, ISO date). |
| `packages/shared/src/schemas/index.ts` | Barrel line for `dependency-slips.ts`. |
| `apps/api/test/support/p5-pending-be-j.ts` | `listDependencySlips` removed (list now empty). Adds `P5_PENDING_TESTS_BE_J`, which records the one pending acceptance test (§7). |
| `apps/api/test/integration/contract/p5-exercises-be-j.ts` | Exercises `listDependencySlips` (200, AUD 200, 400, 401, 404) and `createTransformation` with `launchPlan` (201), through the validating client. Mirror: `dependencySlipPage`. |
| `apps/api/test/integration/transformations.test.ts` (DG1) | The outbox assertion now expects `schema_version: 2` and `launchPlan: null`. The additive v2 event requires this. |
| `apps/worker/src/automation/starters.ts` (continuation run) | Header comment corrected: the request recorder lives in `platform/request-executions.ts`, not `automation/request-executions.ts`. Comment only. |
| `apps/worker/test/integration/outbox.test.ts` (DG1) | The "one audit event" assertion is narrowed to the starter's own `transformation.starter_automation_*` action. Starter 1 now also writes checklist rows, role tasks and its execution, each with its own audit event. The request event is still written exactly once. |

## 2. Behaviour delivered, per requirement row

### REQ-S12-001

> "A13: each execution is recorded with rule version, trigger event and outcome" (AN-04: "the engine must run all sixteen starter automations … as versioned, configurable rules")

Work-split literal: "each of the sixteen starters records one execution per trigger occurrence with its rule version, trigger event and outcome, and its DG4 output is byte-identical to the DG4 test fixtures … replay ×3 per starter creates nothing more."

**Event and schedule starters** (2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14 (scans), 16, and 1 through `handleTransformationCreated`) are wrapped on their DG4 queues. Each records exactly one execution per (effective version, trigger key), with `trigger_code` = the event type or schedule code, `trigger_key` = the envelope key or `<schedule code>:<ISO minute of the pg-boss createdOn>`, and the status. Each also records one `starter_handler` result whose `outcome` maps the handler's own: `done` → done, `duplicate` → existing, `skipped` → skipped.

**Request starters** (5, 14's accept path, 15) record inside the request transaction. A refused request records none: tested on a 422 G1 submission with missing mandatory evidence.

**Output unchanged.** Every event and schedule starter queue with a handler has a regression test (`starters.test.ts`, 14 cases):

- The wrapped registration returns what the unwrapped DG4 handler returns for an equivalent occurrence. Generated UUIDs are masked, because a run id differs between two runs by construction. Everything else is compared exactly.
- Scans are compared with a DG4 run in the same state.
- Gate starters 6 and 7 run on real G1 submission and decision events: one approver task, 3 Define steps.
- The wrapper returns the handler's result object by identity and rethrows its error by identity (unit-style test).

**Replay ×3.** Each case is replayed three times. There is still one execution and one result, and each replay output equals the DG4 handler's own replay output.

**Starter 12** (`governance.meeting_cutoff_scan`) has no handler on this tree: it is BE-L2's. The map already names its queue, so it is wrapped as soon as BE-L2 registers it. The registration test allows exactly this one unregistered starter queue.

### REQ-S12-004

> "A13;A16: creating one transformation produces one set of phase checklists and role tasks; a retry creates no duplicates; with the plan flag the 90-day tasks are dated from the start date"

**Delivered.** One transformation produces:

- exactly the entry phase's `phase_step` rows (`not_started`), equal to the phase's `phase_step_definition` keys;
- one `role_assignment` task per source role (SP, BO, WL, FIN, TO) not held in the transformation, assigned to the creator. A held role (SP) gets none.

Due date: `roleTaskDueWorkingDays` (starter 1's effective version, default 5) working days after the creation business date, on the organization's default calendar. It is `null` (Unknown) when no calendar exists. The test proves `null`.

Replay ×3, plus a direct DG4-path retry, creates nothing more. The v1 event is still consumed. `launchPlan` is accepted on create and carried in v2 (`null` without it). An impossible date (`2026-02-30`) is 400, and an extra member is 400. The port receives `{transformationId, startDate, idempotencyKey: "launch_plan:<id>"}` exactly once over four deliveries.

**Pending:** "with the plan flag the 90-day tasks are dated from the start date" stays pending until BE-P merges (p5-plan §5.2), as the assignment says. It is recorded in `P5_PENDING_TESTS_BE_J`. Until then the no-op port generates nothing, and the starter's audit reason names `automation.port_unavailable`.

### REQ-S12-012

> "A13: a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic"

Work-split literal: "a 5-day slip of a critical dependency notifies each affected owner once and the dependent forecasts read after the change are those of the DG4 logic; a slip below `minimumSlipDays` raises nothing; a non-critical dependency raises nothing."

**Critical slip.** A 5-day move of predecessor A's milestone, where A → B is on the computed critical path, produces:

- one `dependency_slip` (`slip_days` 5, `critical_path`);
- `affected` = B and C, reachable through B → C, with owners. Forecasts before and after equal the DG4 `predecessorFinish` over the milestones read after the change.

**Notification.** The worker consumer, run ×3, gives BO (owner of both B and C) exactly one work item and one notification. Replays are `duplicate`.

**Non-critical cases.**

- The other edge (A → D: not critical, no needed-by) raises nothing.
- With the critical path not computable (a missing duration) and no needed-by, a slip raises nothing.
- With a needed-by date breached it raises one (`needed_by_breached`).
- A move earlier, or an unchanged finish, raises nothing.

**Below `minimumSlipDays`.** A starter 9 version 2 with `minimumSlipDays: 7` goes through the real lifecycle: draft, settings, dry run (pass), submit, configuration review by another person, publish. After it, a 5-day slip raises nothing and a further 8-day slip raises one.

Forecasts are never stored: they stay computed on read (DG4).

### REQ-S12-021

> "A13: replaying the same event three times yields one reminder, one action and one approval task"

BE-J's share is replay ×3 per starter, which creates nothing new: covered for every wrapped starter queue above, for starter 1, for starter 9's notifications, and for the gate approver task (starter 6: one task, replays `duplicate`).

### Shared rules (§2)

| Rule | How it is met |
|---|---|
| 4 (mutations) | The only new route is a read. The `createTransformation` extension keeps DG1's checks: authorization, validation, idempotency, audit. The milestone writes keep their DG4 checks. The slip row, the outbox row and every execution and result row has its audit event in the same transaction. No remote I/O in a transaction. |
| 5 (Unknown never 0) | Unknown is `null`, never 0: `slip_days` is an integer day count, and Unknown finishes and due dates are `null`. |
| 10 (exactly once) | Lock 730258, `automation_execution_once_key`, one `done` per key, `dependency_slip_once_key`, dedupe keys, `runOnce`. |
| 14 (contract seams) | Pending list emptied, operation exercised. |
| 16 (migrations) | No migration. |
| 17 (dependencies) | No new dependency. |

## 3. Checks actually run

Environment: Node 24.21.0, offline. PostgreSQL via `tests/qa/support/with-pg.sh` on ports 23800–23849 only. Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-J-evidence/`. **The final results are in §9;** this section lists the interrupted run's targeted runs during the work. They are provenance only: their logs have no `-B` suffix, and none of them is acceptance evidence. The continuation run re-ran every acceptance check (§9).

| Command | Result |
|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start) | exit 0, `PASS gate DG4 (historical)` (`validate-dg4-historical-start.log`) |
| `vitest --project integration apps/worker/test/integration/starters.test.ts` (run 1) | exit 1, 4 failed / 18 passed: synthetic payloads naming no KPI or benefit row, and a baseline consumed by the same payload. Fixed with real fixture rows and a separate baseline occurrence. One further run (exit 1, 1 failed: a scan baseline consumed its own work) was fixed by comparing against a DG4 run in the same state. Then exit 0, 24/24. Log `starters-worker-run1-fixture-failures.log`. |
| `vitest --project integration apps/worker/test/integration` (before fixes) | exit 1, 2 failed / 108 passed: (a) the D-102 registry test requires the domain consumer before the engine, so the portfolio map moved ahead of the automation map; (b) the DG1 audit-count assertion, narrowed as listed in §1. After the fixes, both files: exit 0, 24/24 (`worker-integration-run1-before-fixes.log`, `worker-outbox-adoption-after-fix.log`). |
| `vitest --project integration apps/api/test/integration/contract/contract.test.ts` | exit 0, 74/74 (`contract-test.log`) |
| BE-J's two test files, final | exit 0, 33/33 (`be-j-tests-final.log`) |
| `pnpm test` with the locale unset, run 1 | exit 1. unit-node 4 failed / 1881 passed; unit-web 1400/1400; formula 259 + 2 skipped by design. The 4 failures were ADR-0002 module-boundary tests on my first placement (§6.1), and were fixed. The run is kept as `unit-locale-unset-run1-stale.log`. Final runs are in §9. |

## 4. Operations routed (delta to `p5-pending-be-j.ts`)

- **Removed:** `listDependencySlips`. The list was 1 operation and is now 0. It is exercised in `p5-exercises-be-j.ts`.
- **Extension exercised:** `createTransformation` with `launchPlan` (201).
- **Pinned counts:** no change. The media-type triple and the rate-limit floor are unchanged, because the new operation is a bodiless GET. The contract test passes on the existing pins (74/74).

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **Launch-plan port location (contract contradiction).** ADR-0044 §2 has starter 1's *worker* handler call `LaunchPlanPort.generate(tx, …)`. p5-work-split §H.1 has BE-P register the implementation with one line in the *API's* `server.ts`. The worker imports no API code (ADR-0002 rule 5), so an API registration cannot reach the starter.
   - I delivered both: the API port the assignment names, and a worker twin with the same signature (`apps/worker/src/automation/ports/launch-plan.ts`).
   - **Decision needed:** BE-P registers its generator in the worker (at worker composition, e.g. `main.ts`; a worker file BE-P would need to own) and, if the API needs it, in `server.ts`.
2. **`automation.port_unavailable` cannot be stored as ADR-0044 §2 words it** ("records the action result `skipped` with `automation.port_unavailable`"). The 0074 CHECK `automation_action_result_error_complete` allows an `error_code` only on `failed`/`forbidden`. Starter 1 also has a single `starter_handler` result per execution. The skip is therefore recorded in the starter's audit reason. The ADR text needs an amendment, or an extra column if the architect wants it on the result.
3. **`transformation.launch_start_invalid` (422, ADR-0044 §10) is unused.** The OpenAPI `BusinessDate` says "An impossible date (2026-02-30) is 400", so an invalid start date is a 400 validation error. No case reaches a 422. The architect should either drop the code or name the business rule it guards.
4. **Phase-step function export.** §E.1 asks me to export "the phase-step instantiation function in `apps/worker/src/handlers/gates.ts` (one line, behaviour unchanged)". No such function exists: the DG4 insert is inline in `handleGateDecided`. Extracting it would change more than one line of an approved handler. Instead, starter 1 performs the same insert (`not_started`, ON CONFLICT on `phase_step_key`, the `phase_step.enable` audit event) with `enabled_by_gate_decision_id = null`, and `handlers/gates.ts` is **untouched**.
5. **Zod mirror.** The `dependencySlipPage` mirror is a new shared file plus one barrel line. These are not in the §E.1 file list, but rule 14 needs a mirror. No OpenAPI change.
6. **`dependency.slipped` is not in `OUTBOX_EVENT_SCHEMAS`.** Once it was registered, BE-H2's dry run validated samples strictly against it (`dry-run.ts`: a registered event schema is parsed with `safeParse`). That broke `automation-lifecycle.test.ts` "a numeric condition with no usable value …", whose `dependency.slipped` samples carry only condition fields (missing `slipDays`; `5.5`; decimal strings). The full run showed the failure. With the strict event shape, that test's premise (a sample with the value missing) is impossible for this trigger. I therefore kept the schema out of the registry: the producer and consumer parse `dependencySlippedV1` directly, and the dry run keeps its condition-field validation for this trigger. **For the architect:** register it, and move BE-H2's test to a trigger without a registered schema or a full-shape sample.

7. **`launch_procedure` with a `service` identity cannot be stored (found by the continuation run; blocks §7.1).** ADR-0043 §2 and §3 allow `launch_procedure` under either identity. Two parts of the design rule a service launch out:
   - **The table.** `0069` declares `procedure_instance.launched_by uuid NOT NULL REFERENCES app_user (id)`, with CHECK `procedure_instance_launcher (launched_by = created_by)`. The service identity is not an `app_user` (ADR-0043 §3: actor `service`, `onBehalfOfUserId` null), so it has no launcher to record.
   - **Approval steps.** `procedures/steps.ts` `requestStepApproval` throws "a person's action requests a business approval" when the audit context has no user. `workflows/approvals.ts` `requestApprovalInTx` throws "a person requests an approval". A procedure whose first position is an approval step cannot be launched by the service.
   - The worker also cannot call `requestApprovalInTx` (ADR-0002 rule 5). Its twin of the launch would therefore need a twin of the workflows approval request too, or a port the ADR does not define.
   - **Decision needed (architect), one of:**
     - (a) `launch_procedure` only with `runAs: initiating_user`: launcher = the initiating user, with the API refusing a service version that names it, under a new §9 code;
     - (b) launcher = the rule's owner (`ownerUserId`) for service rules;
     - (c) a nullable launcher for automation launches: a migration in BE-J's free number `0077`, which needs its own guard and an approval-request path without a person.
   - Until then `launch_procedure` keeps `adminSelectable: false` (ADR-0043 amendment item 4). No descriptor is registered.

No new dependency, and no migration.

## 6. Deviations from the §E.1 file list (each needed; listed for the integrator)

1. **`automation/request-executions.ts` → `platform/request-executions.ts`**, plus an export block in `platform/index.ts`. The three call sites (workflows, sustainment, methodology) are DG2–DG4 modules. `apps/api/src/architecture.test.ts` forbids any P1–P4 module importing a P5 module ("No P1-P4 module imports a P5 module"; methodology "imports none of them"). It also forbids importing `platform/advisory-locks.ts` directly. The recorder therefore lives in the leaf `platform` and uses `@mth/db` only.
2. **`portfolio/slip-events.ts` writes its outbox row itself**, with the same schema-checked insert as `jobs/outbox.ts`. `portfolio`'s dependencies are pinned exactly by ADR-0021 §1 in `architecture.test.ts`, and `jobs` is not among them. *Suggestion:* move `enqueueOutboxEvent` into `platform` so every module can use it; then slip-events can call it.
3. **Files outside §E.1, each a named line or block, listed in §1:**
   - `transformations/routes.ts`: emitting v2 is required by the v2 payload;
   - `portfolio/index.ts`: there is no `portfolio/routes.ts`;
   - `queues/index.ts` and `queues/portfolio.ts`: the new consumer needs a queue;
   - the second call line in `approveMilestoneDate`: ADR-0044 §7 says "forecast **or approved date**";
   - the two DG1 test assertions.
4. **`worker.ts` is not edited** (BE-I2 owns its lines this wave). Starter 1 is wrapped through the `handleTransformationCreated` export that `worker.ts` already imports from `handlers/index.ts`.
   - Limitation: `worker.ts` passes no `JobAttempt` to the `transformation.created` handler, so its execution is not marked `failed` on the last attempt. Its pg-boss retries and BE-I's failure capture of the job are unchanged.
   - A one-line change in `worker.ts` (pass `attempt`) would close this. That is for BE-I2 or the orchestrator.

## 7. What remains

1. **The `launch_procedure` automation action** (§E.1 "the `launch_procedure` action (`procedures/automation-actions.ts` (new) + `apps/worker/src/automation/actions/launch-procedure.ts` with its parity test against BE-F2's launch)"). **Not done.** This is the separable second half of this task.
   - Why: the worker executor must twin BE-F2's whole `launchProcedureInTx` without importing API code: pin resolution, input validation, step instances, `advance` with step conditions, `procedure_step.activated` events and approval-step requests. A correct parity test for that did not fit with the full verification runs.
   - What remains: the `launchProcedureActionParameters` schema (`{procedureCode, targetTransformationId?, inputValues?}`, launch key = the action key, ADR-0043 §2), the API descriptor and its `server.ts` registration line, the worker executor and its `AUTOMATION_EXECUTORS` line in `engine.ts` (BE-H2's file), and the parity test.
   - Until then `launch_procedure` stays `adminSelectable: false` (ADR-0043 amendment item 4).
   - **Blocked by a contract decision** (continuation run, §5.7): a `service` identity cannot be the launcher (`launched_by NOT NULL REFERENCES app_user`), and an approval step needs a person to request it. The architect must decide (a), (b) or (c) of §5.7 before the executor and its parity test are written.
2. **REQ-S12-004, "with the plan flag the 90-day tasks are dated from the start date":** pending until BE-P (§2, §5.1).
3. **Starter 12:** wrapped automatically once BE-L2 registers `governance.meeting_cutoff_scan`. Its regression test belongs with BE-L2's handler.
4. **Not covered by a per-starter regression case:** the *event* path of starter 10 (`governance.blocker_escalation` on `blocker_status.recorded`), which needs a meeting and blocker fixture. It is wrapped like the others, and its scan path is covered.

## 8. User-facing texts

**Made true by this work:**
- The starter-1 audit reason in `handlers/platform.ts` said "methodology content arrives in P2/P5", which was untrue at P5. It now states what ran. It is an audit text, not an en/ar UI string.

**For the owner of `apps/web/src/i18n/{en,ar}/myWork.json` (FE), and the `PRODUCED` table in `apps/web/src/pages/my-work/message-keys.test.ts`.** Two new work-item message keys need en/ar texts. Until they exist, My Work renders the neutral fallback; the kind labels already exist.
- `transformations.task.role_assignment`, params `{roleCode, transformationCode}`. Suggested en: "Assign the {{roleCode}} role in {{transformationCode}}".
- `portfolio.task.dependency_slip`, params `{dependencyCode, slipDays, initiativeCodes}`. Suggested en: "Dependency {{dependencyCode}} slipped {{slipDays}} days; affected: {{initiativeCodes}}".

**Checked and left alone:**
- `apps/web/src/i18n/en/admin.json` `plannedSections` ("… workflows, automation and branding settings are planned for later releases.") concerns the admin UI sections, which are FE-D's rule-builder screens. BE-J ships no UI, so I left it for FE-D. The texts become untrue when FE-D ships the automation screens.

## 9. Final checks (on the final tree)

All rows below were run by the **continuation run (T-DG5-BE-JB)** on the final tree (`4eee6f9` plus this run's uncommitted changes).

- Environment: Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`, offline. 4 CPUs, shared with three other W8 tasks.
- Logs: `docs/delivery/handbacks/DG5/T-DG5-BE-J-evidence/*-B.log`. Each log starts with its command and the start time, and ends with the end time and `exit=<code>`.
- Before the tests, empty `.claude/.cc-writes` folders under `apps`, `packages` and `tests` were removed (none was found).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 23:25Z) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-historical-start-B.log` |
| 1 | `pnpm -r typecheck` | 0 | all 6 packages `Done` | `typecheck-B.log` |
| 1 | `pnpm -r build` | 0 | all packages built | `build-B.log` |
| 1 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | no warning | `lint-B.log` |
| 1 | `pnpm openapi:lint` | 0 | passes | `openapi-lint-B.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (after the handback's last edit) | 0 | `All matched files use Prettier code style!` | `prettier-B.log` |
| 2 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | unit-node 105 files / **1885 passed**; unit-web 72 / **1400 passed**; unit-formula-nocodegen 3 / **259 passed, 2 skipped** (the existing by-design skips); 0 failed | `unit-locale-unset-B.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 1885; 1400; 259 + 2 skipped; 0 failed | `unit-c-utf8-B.log` |
| 3 | `QA_PG_PORT=23800 MTH_PORT_POOL=23801-23849 tests/qa/support/with-pg.sh pnpm test:integration` (locale unset) | 0 | PostgreSQL 16.13 on port 23800 (attempt 1). **231 files, 2257 tests passed, 0 failed**, in 1653.8 s. BE-J's own files: `starters.test.ts` 24, `starters-be-j.test.ts` 9, `contract.test.ts` 74, and the two adjusted DG1 files `transformations.test.ts` 30 and `outbox.test.ts` 10. `automation-lifecycle.test.ts` 12 (§5.6) | `integration-B.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` (00:29Z) | `validate-dg4-historical-end-B.log` |

- **Failed, flaky or timed-out tests in the `-B` logs: none.** No test was retried, and no run was repeated.
- **Pinned counts:** no change. `contract.test.ts` passes on the existing media-type triple and rate-limit floor (74/74); the one new operation is a bodiless GET.
- **Earlier failures (interrupted run only).** The failures in that run's logs, listed in §3, are not part of this run. They were:
  - `integration-run1-crashed.log`: the BE-H2 lifecycle test, fixed by §5.6. Also the F-DG2-411 pool-exhaustion case and an `ERR_IPC_CHANNEL_CLOSED` crash of a Vitest worker, under the load of that time.
  - The unit runs: the ADR-0002 boundary tests, fixed by §6.1.

  On this run's final tree the same suites pass: `automation-lifecycle.test.ts` 12/12; `request-io.test.ts` 10/10, including the F-DG2-411 case "an exhausted pool answers 503 …"; `architecture.test.ts` 139/139 in both locales.
- **End time:** `2026-10-15T00:30:24Z` (`date -u`).

## 10. Merge instructions

- No migration. Merge after BE-I (base). There is no shared file with BE-I2 (`worker.ts` is untouched).
- **Expected overlaps** (named lines, additive):
  - BE-K: `workflows/gates.ts` (my starter-5 line comes before theirs).
  - BE-L2: `handlers/index.ts` / `queues/index.ts` if it adds imports.
  - BE-P: `server.ts` (its port line).
  - Any task touching `platform/index.ts` or `packages/shared/src/schemas/index.ts` (barrel lines).
- When BE-L2 merges `governance.meeting_cutoff_scan`, the wrapper applies automatically, and `starters.test.ts` still passes because it allows that queue to be unregistered.
- When BE-P merges: register the generator with the worker's `registerLaunchPlanPort` (§5.1), then turn the pending test in `P5_PENDING_TESTS_BE_J` into a test.
