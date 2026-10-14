# Handback T-DG5-BE-F2 (backend-workflow-engineer): procedure instances, steps and my procedures (p5-work-split §C.2)

- **Stage:** P5 / DG5 (BUILDING). Branch `dg5/be-f2`, worktree `/home/user/wt/dg5-be-f2`, base `HEAD` `09b7428fd6168963452ee6cd2a5702b156ae05fa` (clean tracked tree at start).
- **Invocation:** `DG5-T-DG5-BE-F2-backend-workflow-engineer-20261014T174710Z-ad8d7689`, session `ad8d7689-7b80-41a6-8faf-096f68dcabb8`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-F2.md` (sha256 `aaf11f16…5684e2`, verified).
- **Time:** start `2026-10-14T17:47:22Z`; end `2026-10-14T19:28Z` (`date -u`).
- **Changes are uncommitted** for the orchestrator to integrate.
- **Gates:** product gates G1–G6 are business approvals inside the product. Nothing here grants, records or simulates a real business, Finance or IT approval, and nothing reads or writes DG0–DG7. The approvals decided in the tests are synthetic demo decisions by a synthetic business approver (SP) through the canonical approval.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG4` → **exit 0**, `PASS gate DG4 (historical)` (at start; `T-DG5-BE-F2-evidence/validate-historical-DG4-start.log`). Re-run at the end: §6.

## 2. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/procedures/steps.ts` (new) | The instance engine (`advance`: activation by ordinal, parallel groups, conditions with decimal.js via `evaluateStepCondition`, `not_applicable`, completion rule), the four step actions (complete/skip/assign/evidence) and their routes, the read model (`presentInstance`, `presentStep`: M0153's six items), input validation with the ADR-0041 §3 validators, the §10 refusals with exact texts, `MissingInputsProblem` (`missingInputs[]` extension), the output-adapter port and registry (`ProcedureOutputAdapter`, `registerProcedureOutputAdapter`) for BE-G, the approval ports (`wireProcedureApprovals`) and the approval outcome hook, the `procedure_step.activated` outbox write, lock class `procedureInstanceStep` |
| `apps/api/src/modules/procedures/instances.ts` (new) | The zod mirrors of the ten operations' bodies; `launchProcedureInTx` (the launch service, with `launchKey` for slice E) and the launch route (Idempotency-Key); list (scope-filtered in SQL, cursor), get, inputs (PATCH), cancel |
| `apps/api/src/modules/procedures/my-steps.ts` (new) | `GET /me/procedure-steps` (active steps assigned to me, or unassigned of a role I hold **in the instance's scope**; due date order, Unknown last) |
| `apps/api/src/modules/procedures/routes.ts` | The three BE-F2 registration lines (in the slot BE-F left) |
| `apps/api/src/modules/procedures/index.ts` | Public exports: `wireProcedureApprovals`, `registerProcedureOutputAdapter` and the adapter types (for BE-G), `launchProcedureInTx` + `LaunchInput` (for BE-J's `launch_procedure` action) |
| `packages/db/migrations/0072_p5_procedure_step_approval_type.sql` (new) | (1) `approval_type` row `procedure_step` (subject `procedure_step_instance`, `requester_excluded`, owner `procedures`); (2) `CREATE OR REPLACE FUNCTION procedure_instance_guard()` with one clause changed (the `advance` output rule, §5.1). Number per D-145 (BE-F2 → `0072`) |
| `packages/shared/src/schemas/events.ts` | **Outside my listed files** (needed; §5.3): `procedureStepActivatedV1` and its `OUTBOX_EVENT_SCHEMAS` line |
| `apps/api/src/server.ts` | **Outside my listed files**, one wiring line (§5.2): `wireProcedureApprovals({ requestApproval: requestApprovalInTx, registerSubject: registerApprovalSubject })`, and the import |
| `apps/api/test/integration/contract/contract.test.ts` | **Outside my listed files**, three additive lines (§5.4): import, `...P5_MIRRORS_BE_F2`, the `it("P5 BE-F2 operations …")` block. No pin edited |
| `apps/api/test/support/p5-pending-be-f2.ts` | Emptied (all ten routed) |
| `apps/api/test/integration/contract/p5-exercises-be-f2.ts` (new) | The ten operations through the validating client: success and the reachable declared refusals |
| `apps/api/test/integration/procedures/procedure-instances.test.ts` (new) | 10 integration tests on a real PostgreSQL (§3) |
| `apps/api/test/support/procedure-instance-fixtures.ts` (new) | `pinProcedures` (owner-written, audited synthetic pin), `publishProcedures` (the Studio pipeline: draft, put, preview, compatibility, TO review, publish), `skippableCollectBody` |
| `docs/delivery/handbacks/DG5/T-DG5-BE-F2-*` | This handback and its evidence |

Not mine (present untracked at the worktree root before/while I worked; not touched, not to be committed): `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`. I removed one empty `apps/api/.claude/.cc-writes` directory before the tests, as the assignment requires.

`apps/worker/src/handlers/procedures.ts` is **unchanged** (an empty handler list): the one event this task emits, `procedure_step.activated`, is already routed by `apps/worker/src/queues/automation.ts` to `automation.evaluate` (BE-H2's handler), which is where the slice E rule actions run. A second consumer here would have nothing to do ("no reminder logic here"). See §7.

## 3. Behaviour delivered, per requirement

### REQ-S06-002 (my row; BE-G completes the outputs)

Acceptance (verbatim): *"Launching a procedure creates an instance pinned to the definition version; each step completion is validated server-side and outputs are created as linked records or generated deliverables"*; A-test: *"A02: a baseline-validation instance shows its current step and assignee; completing it creates a validated baseline record linked to the instance"*.

- **Pinned to the definition version.** The launch inserts the instance with the exact published definition row (`procedure_definition_id` + `methodology_version_id`, frozen by 0069 PI06). The version is the transformation's `procedure` pin, else the newest published `procedures` version; an organization-scope procedure reads the newest published version. Test *"a running instance stays on its definition version when a newer version is published"*: a v2 published through the Studio pipeline leaves the running v1 instance's definition id, version id and name unchanged; a transformation pinned to v2 launches v2.
- **The six M0153 items** (`getProcedureInstance`): `currentStepKeys` (several for a parallel group); each step's `assigneeUserId`, else `assigneeRoleCode`; `dueDate` = activation business date + `sla_working_days` **working days** on the organization's business calendar (`computeWorkingDayDueDate`, ADR-0028), `null` with `dueDateUnknownReason` when there is no calendar (`calendar_not_configured`) or the step is not active yet (`not_active`), and `overdue: null` whenever the date is Unknown; `missingInputs` (keys + en/ar labels: the definition's required inputs and the required inputs of every open step, absent or null, never defaulted); `links` of kind `evidence` (completed evidence) and `output`; `nextAction` as `messageKey` + `messageParams` (rule 6). Test *"a baseline_validation instance shows record_baseline as its current step with assignee, due date and missing inputs"*.
- **Server-side validation of every completion.** In order: lock + `FOR UPDATE`; commit-time authorization; `If-Match`; instance active (`procedure.not_active`); step active (`procedure_step.not_active`); approval step → `procedure_step.decided_through_approval`; missing required inputs → 422 `procedure_step.inputs_missing` with `missingInputs[]`; evidence required and none linked → `procedure_step.evidence_required`; the output (below). The 0069 guards repeat each rule.
- **Outputs as linked records.** The output-adapter registry (`registerProcedureOutputAdapter`) is the BE-G seam. Without an adapter: a `link` output links `outputRecordId` (the 0069 `procedure_instance_link_record_ref` guard checks the record exists in scope, else 422 `procedure_step.output_record_invalid`); an approval step whose output is `approval` links its own approval; anything else → 422 `procedure_step.output_required`, nothing written. Test *"with a baseline adapter both steps complete, the validated baseline is linked and the instance completes"*: with a **synthetic stand-in adapter** (it names a baseline created through the DG3 `POST …/baselines` API), `record_baseline` (BO) and `validate_baseline` (FIN) complete, the baseline is the instance's output link, and the instance completes. **The real baseline create/validate adapters are BE-G's**; until BE-G, A02's "creates a validated baseline record" is not met end to end (§8).
- **Approval steps** complete only through an **approved** canonical approval. When an approval step activates, the engine requests a `procedure_step` approval on the step instance (`requestApprovalInTx` through the port), routed to the step's approver party via the transformation's party mapping; the requester is the person whose action activated the step, so separation of duties keeps them from deciding it. The business approver decides through the generic `POST /approvals/{id}/decisions`; workflows calls `onOutcome`, and on `approved` the step completes (`approval_id` set, 0069 PI21 re-checks the status) and the instance advances in the deciding transaction. Test *"both parallel steps are active, a false condition is not applicable, the approval step completes only through the canonical approval"*: the requester (FIN) gets 403 deciding; completing or skipping the step directly gives 422 `decided_through_approval` / `not_skippable`; the SP's approval completes the step and the instance.
- **Parallel and conditional.** Steps sharing an ordinal activate together; a step with a false condition becomes `not_applicable` (never "completed"); decimal comparison (`contractValue` `1000000.00` ≥ `1000000.00` runs the finance check). Same test.
- **Exactly once.** `launchProcedureInTx` with a `launchKey` twice: one instance, the replay → 409 `procedure.launch_replayed`; a user launch with `Idempotency-Key` twice returns the same instance. Test *"a launch key twice creates one instance …"*.
- **Authorization** (ADR-0042 §9): launch needs `procedure.launch` **and** one of the definition's launch roles held in scope (WL → 403 `procedure.launch_role`; AUD → 403); acting on a step needs `procedure.act` and being its assignee or (unassigned) a holder of its role **in scope** (403 `procedure_step.not_assignee`); assign and cancel need `procedure.manage`; reads need `procedure.read` in scope (404 otherwise). Every mutation: `If-Match` (428/409), AUD 403, one audit event per row written (asserted per request with `auditOfRequest`), commit-time re-authorization (a revoked grant → refused, nothing written). Tests *"launch: AUD 403 …"*, *"step writes: 428 …"*, *"commit-time authorization …"*.
- **My procedures.** Test *"lists instances in scope (filters, cursor) and my procedures …"*.

### Rows I touch but do not own

- **REQ-S06-001** (BE-F's row): its "then launches (with BE-F2)" half is covered: a definition published through the Studio pipeline (draft, put, preview, compatibility, TO review, publish) launches and runs.
- **REQ-S16-015** (BE-G's entity-group test): `launchProcedureInstance` / `getProcedureInstance` are the ProcedureInstance create/read it uses.

## 4. Checks

The real exit codes are in §6; the logs are in `T-DG5-BE-F2-evidence/`.

## 5. Contract, schema, migration and wiring notes for the orchestrator

### 5.1 Migration `0072` (two parts)

1. `approval_type` row `procedure_step`. No migration declared an approval type for procedure steps, but ADR-0042 §2 and the 0069 guard `procedure_step_instance_approval` need one.
2. **A 0069 defect, repaired forward-only.** `procedure_instance_link` is UNIQUE on `(procedure_instance_id, link_kind, record_type, record_id)`, but the 0069 completion clause demands that every completed output step have **its own** link. An `advance` step (e.g. `validate_baseline`, which acts on the baseline `record_baseline` created) can therefore never get its link, and `baseline_validation` (also `gate_review`, `kpi_submission`, `scope_target_change`, `executive_escalation`, `bau_handover`) could never complete. `0072` redefines `procedure_instance_guard()`, verbatim except that clause: a completed `advance` step is satisfied by the instance's output link of its record type. The engine mirrors the rule (`completionHolds`). **The architect may prefer another fix; please confirm.** If a catalogue or probe test pins the function body, it will show in the integration run (§6).

### 5.2 `server.ts` wiring line (outside my files)

`wireProcedureApprovals({ requestApproval: requestApprovalInTx, registerSubject: registerApprovalSubject })`, placed just before the P5 wiring block. procedures imports no workflows code (the BE-C `wireMethodologyMigrations` pattern). This is the **"workflows/approvals.ts provider line"** the section asks me to name: no edit to `workflows/approvals.ts` is needed, because the registration goes through `registerApprovalSubject` in server.ts.

### 5.3 `packages/shared/src/schemas/events.ts` (outside my files)

`procedure_step.activated` v1 had no payload schema in `OUTBOX_EVENT_SCHEMAS`, although it is in BE-H's trigger list (`queues/automation.ts`) and the 0074 trigger catalogue. Payload: `{instanceId, stepInstanceId, procedureCode, transformationId, stepKey, stepKind, dueDate, assigneeUserId, assigneeRoleCode}` (ADR-0042 §7's five fields, plus the ids and the transformation the rule engine scopes by). Key: `procedure_step.activated:<stepInstanceId>`.

**Not emitted:** `procedure_instance.launched`, `procedure_step.completed`, `procedure_instance.completed`, `procedure_instance.cancelled` (ADR-0042 §7). No queue consumes them, and the relay records an event type without a queue as a failure (`queues/index.ts`). Each becomes one schema line plus one `enqueue` call when slice E or BE-G registers a consumer.

### 5.4 Contract test

- Three additive lines in `contract.test.ts`: no `p5-exercises-be-f2.ts` stub existed, because BE-F2 is ARCH-02's split.
- **Pinned-count delta (rule 14):** media-type triple `[349, 348, 1]` → **`[356, 355, 1]`**. That is +7 JSON bodies: `launchProcedureInstance`, `updateProcedureInstanceInputs`, `completeProcedureStep`, `skipProcedureStep`, `assignProcedureStep`, `linkProcedureStepEvidence`, `cancelProcedureInstance`. This pin is the one expected failure of the contract file.
- No rate-limit floor change was observed.

### 5.5 Codes and texts (rule 15)

- Every ADR-0042 §10 instance/step code is used with its exact English text. The en/ar entries already exist in `apps/web/src/i18n/{en,ar}/problems.json`.
- **One code outside the table:** `assignProcedureStep` with a person who does not hold the step's role in scope → 422 `validation.user_invalid` (an existing code, already in the locale files), detail *"The assignee must be an active user who holds the step's role in this scope."* Please confirm or name another code.
- **Interpretation:** assigning an **active approval** step → 422 `procedure_step.decided_through_approval`. The step row must not change while its approval is open, because the 0031 subject version would make the approval stale.

### 5.6 New message keys (rule 6; for FE-D, who owns the screens and the locale files)

`procedures.next_action.{provide_input, link_evidence, complete_step, await_approval, await_approval_unrouted, outputs_pending, none_active, none_completed, none_cancelled}`.

Params:
- `stepKey`, `stepNameEn`, `stepNameAr`;
- `inputKey`, `inputLabelEn`, `inputLabelAr` (provide_input);
- `roleCode`, `approvalStatus` (await_approval).

Step `dueDateUnknownReason` values: `calendar_not_configured`, `not_active`.

### 5.7 Pending-list delta

`p5-pending-be-f2.ts`: −10 (`listProcedureInstances`, `launchProcedureInstance`, `getProcedureInstance`, `updateProcedureInstanceInputs`, `completeProcedureStep`, `skipProcedureStep`, `assignProcedureStep`, `linkProcedureStepEvidence`, `cancelProcedureInstance`, `listMyProcedureSteps`) → empty. All ten are exercised in `p5-exercises-be-f2.ts`.

### 5.8 Dependencies

No new dependency.

## 7. Known gaps, interpretations and limits (stated plainly)

1. **Outputs other than `link` and `approval` need BE-G's adapters.** Until then, completing a `create`/`advance` output step answers 422 `procedure_step.output_required`. A02's "completing it creates a validated baseline record" is proven only with a synthetic stand-in adapter.
2. **Organization-scope approval steps** (`new_transformation_intake` → `confirm_sponsor`): an approval needs a transformation (0031). The engine routes it in the transformation the instance created (its `transformation` output link). Without one, the step stays active with `await_approval_unrouted`. This depends on BE-G's intake create adapter.
3. **A cancelled instance's open step approval is not withdrawn.** `withdrawApprovalInTx` is requester-only. The step's cancellation bumps its version, so the 0031 stale rule refuses any later decision, but the approval stays open in the approver's queue. A workflows-side "withdraw on behalf of the subject module" service would close this; I did not edit workflows.
4. **Approval outcomes other than `approved`** (rejected, changes requested, deferred) leave the step active and waiting; the instance can be cancelled. ADR-0042 does not define a re-request path.
5. **`slaType`/due date of the step approval** is `null` (Unknown `no_sla`) in the approval record. The step itself carries the working-day due date. Slice E routes and SLAs (ADR-0044) are not wired here.
6. **Deferred field checks** (`reference`, `attachment`, `lookup` input types, ADR-0041 §3) are accepted as validated values without the in-transaction existence check. None of the ten seeded procedures uses those types.
7. **My procedures** lists steps, not "the procedures you launched" (the nav summary text). `listProcedureInstances` has no `launchedBy` filter. That is for FE-D: a client-side filter, or a contract request.
8. **Organization-scope launches** need an organization-level grant of a launch role (a BU-level TL cannot launch `new_transformation_intake`). That is the policy function's rule as it stands.
9. **ADR §7 events** other than `procedure_step.activated` are not emitted (§5.3).

## 8. What remains

- **BE-G:** the output adapters (`procedures/outputs/**`, through `registerProcedureOutputAdapter`), which make REQ-S06-002's A02 clause hold end to end.
- **BE-J / slice E:**
  - `launch_procedure` calls `launchProcedureInTx` with a `launchKey`;
  - step reminders and escalations consume `procedure_step.activated`.
- **FE-D:** the instance view and the my-procedures screens, plus the §5.6 message keys in en/ar.
- **Orchestrator:**
  - reconcile the media-type pin;
  - confirm §5.1(2) and the §5.5 code.

## 6. Checks run (final; Node 24.21.0, offline, ports 23800–23849, worktree `/home/user/wt/dg5-be-f2`)

| Check | Command | Exit | Result | Log |
|---|---|---|---|---|
| Preceding gate (start) | `node tools/gates/validate.mjs --historical --stage DG4` | **0** | `PASS gate DG4 (historical)` | `validate-historical-DG4-start.log` |
| Preceding gate (end) | same | **0** | `PASS gate DG4 (historical)` | `validate-historical-DG4-end.log` |
| Typecheck | `pnpm -r typecheck` | **0** | | `typecheck.log` |
| Build | `pnpm -r build` | **0** | | `build.log` |
| Lint | `pnpm lint` | **0** | | `lint.log` |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | `prettier.log` |
| OpenAPI | `pnpm openapi:lint` | **0** | `PASS … OpenAPI 3.1.1, 846 operations` (unchanged) | `openapi-lint.log` |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | unit-node **1854/1854**; unit-web **1384/1385**; formula **259 + 2 skipped by design** | `test-unit-c-utf8.log` |
| Unit, locale unset (run 1, superseded) | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | **1** | unit-node 1852/1854; unit-web 1384/1385; formula 259 + 2 skipped | `test-unit-locale-unset-run1.log` |
| Unit, locale unset (run 2, final code) | same | **1** | unit-node **1854/1854**; unit-web **1384/1385**; formula **259 + 2 skipped by design** | `test-unit-locale-unset-run2.log` |
| My suite, targeted | `QA_PG_PORT=23802 MTH_PORT_POOL=23803-23849 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/procedures/procedure-instances.test.ts` | **0** | **10/10** | `procedure-instances-targeted.log` |
| Contract, targeted | `QA_PG_PORT=23806 MTH_PORT_POOL=23807-23849 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | **1** | 73/74; the one failure is the expected pin (§5.4) | `contract-targeted.log` |
| Integration, full | `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | 225 files, **2197/2198 passed**, 2059.6 s. The one failure is the expected pin, `expected [ 356, 355, 1 ] to deeply equal [ 349, 348, 1 ]` (§5.4) | `test-integration.log` |

Every non-zero exit, explained:

1. **unit-web 1384/1385, both locales (all three runs):** `apps/web/src/i18n/glossary.test.ts` › "spells the Transformation term consistently (with shadda …)".
   - The offending entry is the Arabic `prioritization.weights.intro` (it contains «التحول» without the shadda).
   - That text came in at HEAD with D-149's orchestrator patch (`b619b1e`, KBE-A's P4 true texts), and my tree leaves `apps/web` byte-identical to HEAD (`git diff --quiet HEAD -- apps/web`).
   - So this is a **pre-existing failure at the base revision, not caused by this task**. It is for the owner of that file.
   - Fix: write the word with the shadda (التحوّل).
2. **Locale-unset run 1, unit-node 1852/1854**, two failures:
   - **(a) A real defect of mine, fixed:** `advisory-locks.test.ts` "no module source … spells a class number". Comments in `steps.ts`/`instances.ts` named the lock number. The comments now name the class `procedureInstanceStep`. The test passes (3/3), and unit-node passes 1854/1854 in the `C.UTF-8` run on the fixed code.
   - **(b) A timeout under load:** `architecture.test.ts` › "every import respects dependsOn …" timed out at 30 s while the full integration suite ran concurrently. Re-run alone it passed, 139/139 (`architecture-rerun.log`), and it passed in the `C.UTF-8` run. This is the F-DG4-148 load class.
3. **Contract / integration pin:** the media-type triple. The orchestrator reconciles it (rule 14).
4. **Timing of the full integration run:** it started at 18:34Z, **before** the comment-only fix of item 2(a). No executable line changed after it started.
5. **A background helper loop was stopped:** a `until …; sleep` wait loop (not a test) hit its tool time limit and was killed. Its target run had already been lost when an `&` subshell ended with its shell, so I re-ran that run in the foreground (`procedure-instances-targeted.log`). No test result depends on the killed loop.
