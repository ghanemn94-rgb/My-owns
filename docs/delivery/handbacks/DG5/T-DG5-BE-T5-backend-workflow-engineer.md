# Handback T-DG5-BE-T5 (continued as T-DG5-BE-T5B): backend-workflow-engineer

- **Stage:** P5 / DG5 (BUILDING). This is a repair task (D-167): Added scopes 1–5 of the assignment, which replace the file lists of p5-work-split §E.1, §F.5 and §J.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-T5B.md` (sha256 `6d6416db…39b18a`, verified at the start).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-T5B-backend-workflow-engineer-20261017T175255Z-447b1a0c","session_id":"447b1a0c-0e19-46b2-94f4-a5b58ae6d3f3"}`.
- **Worktree:** `/home/user/wt/dg5-be-t5`, branch `dg5/be-t5`.
  - `HEAD` = `1d5845e`, the orchestrator's WIP commit of the interrupted run, on top of `f78afff`.
  - This run added only the `-B` logs and this handback. They are **uncommitted**.
- **Time:** started `2026-10-17T17:53:08Z`. Ended `2026-10-17T18:34:05Z`.
- **Two gate systems:** nothing here grants or implies a business, Finance or IT approval. The seeded approval is a synthetic demo request that nobody has decided. Deciding it approves nothing real (M0412). Product gates G1–G6 and engineering gates DG0–DG7 are untouched.

## 0. Continuation run (T-DG5-BE-T5B)

**The interrupted run.**

- Run: `DG5-T-DG5-BE-T5-backend-workflow-engineer-20261017T165951Z-114d8892`, started 16:59:51Z, ended 17:51:23Z.
- It exited with 143 and wrote no result line. Its material is under `docs/delivery/test-evidence/DG5/BE-T5-orphaned/`.
- Its work is WIP commit `1d5845e`.

**What I found.** I read the WIP diff file by file, and the transcript's narration and its last tool calls.

- All five Added scopes were implemented, with their tests:
  - scope 1: the registry, the sample, the dry-run tests, the registry unit test and the relay integration test, plus a negative control;
  - scope 2: the export runner, with a unit test and an integration test;
  - scope 3: the demo seed and its test;
  - scope 4: `procedures/steps.ts` and `instances.ts`, with their test;
  - scope 5: the pending list emptied, and the presentation test's title made literal.
- Typecheck, build, lint, prettier and OpenAPI lint had exited 0.
- `unit-node` with the locale unset:
  - first run failed: an architecture rule rejected a computed-key assignment in the new `outbox-registry.test.ts`;
  - the run fixed it (a `Map`) and passed on rerun: 144 files, 2335 tests.
- **The run was killed during `unit-node` with `C.UTF-8`.** That tool call returned exit 137. The session restart then stopped the run.
- No handback had been written.

**What I finished.**

- **No code change was needed.** I reviewed every source change against the Added scope and found nothing incomplete. The last-written file was the registry test after its `Map` fix, and it is complete.
- On scope 3, I verified that `RT_BLOCK.approval` (0x053) was reserved but unused before.
  - Before this change, "pending approval" was met only by gate or Finance-validation rows, which no `GET /approvals` inbox shows.
  - So the new approval row is the route the scope needs, not a duplicate.
- I wrote this handback.

**What I re-ran.** Every acceptance check, on the final tree, one at a time (D-164). Each log has a `-B` suffix (see §3).

**Logs from the interrupted run.** These logs in the evidence folder have **no** `-B` suffix:

- `build.log`, `lint.log`, `openapi-lint.log`, `prettier.log`, `typecheck.log`;
- `unit-node-*.log`, including `unit-node-locale-unset-run1-failed-architecture.log`;
- `scratch-*.log`, `negative-control-relay-unregistered.log`, `presentation-be-o-verbose-*.log`.

They are kept for provenance only and are **not** cited as evidence. The one exception is the negative control, which is cited only as the earlier run's observation (§2.1).

## 1. Changed files (all in `1d5845e`; nothing else changed in this run)

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/events.ts` | Registers `dependency.slipped` v1 (`dependencySlippedV1`) in `OUTBOX_EVENT_SCHEMAS`. Doc comment updated. |
| `apps/api/src/modules/automation/samples.ts` | Serves a complete v1 `samplePayload` for the `dependency.slipped` event trigger. |
| `apps/api/src/modules/automation/samples.test.ts` | The sample now exists and is the complete v1 payload (it was `undefined` before). |
| `apps/api/src/modules/automation/outbox-registry.test.ts` (new) | Lists every outbox event-type literal the API and the worker enqueue, and every outbox write site, against the registry. |
| `apps/api/test/integration/automation/automation-lifecycle.test.ts`, `catalogue-sample-payload.test.ts`, `starters-be-j.test.ts` | Dry-run tests that sampled `dependency.slipped` by its condition fields only now send the complete v1 payload (ADR-0043, the BE-C3 reading). |
| `apps/api/test/integration/automation/dependency-slip-relay.test.ts` (new) | The real relay publishes a `dependency.slipped` row on its first attempt, and starter 9's execution succeeds once. |
| `apps/worker/src/reports/export-runner.ts` | `attemptStorageKey` and `discardEarlierAttempts`: removes earlier attempts' files through the store port, when an attempt starts and when it succeeds. |
| `apps/worker/src/reports/export-runner.test.ts` | Unit test of `discardEarlierAttempts`: keys, idempotence, store errors swallowed, current key untouched. |
| `apps/api/test/integration/reporting/exports-orphan.test.ts` (new) | Orphan files after a killed attempt are removed. Other jobs' files are untouched. |
| `packages/db/src/demo/data/roaming-ids.ts` | ID blocks `roleMapping` 0x057, `workItem` 0x058 and `inboxNotification` 0x059. |
| `packages/db/src/demo/data/roaming-states.ts` | Seeds one pending approval routed to `roaming.user.bo`, as described in §2.3. |
| `apps/api/test/integration/environment/demo-pending-approval.test.ts` (new) | The demo BO lists, reads and decides the seeded approval. Other role users do not list it as assignee. |
| `apps/api/src/modules/procedures/steps.ts` | Rule A clarified (D-167): an adopted step is authorized on T with its assignee role. See §2.4 for the functions. |
| `apps/api/src/modules/procedures/instances.ts` | The single-instance read and inputs update accept T of an adopted step. The instance list is unchanged. |
| `apps/api/test/integration/procedures/adopted-step-authorization.test.ts` (new) | T's Lead completes `draft_charter`. Covers the negatives, the organization-scope operations, the list, and the organization Lead's rights. |
| `apps/api/test/support/p5-pending-be-o.ts` | `P5_PENDING_TESTS_BE_O` emptied, type kept (scope 5). |
| `apps/api/test/integration/governance/presentation.test.ts` | Needed by scope 5: the test title was `${P5_PENDING_TESTS_BE_O[0]!.test}`, so it is now the literal string. Body unchanged. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-T5-evidence/*-B.log` (this run) | Check evidence. |

The `steps.ts` change adds these functions: `adoptedTransformationOf`, `stepTargets`, `stepRoleTarget`, `requireReadInAny`, `requireInstanceOrAdoptedRead` and `authorizeStepWrite`. It also updates `openStep`, the `assignStep` role target, and `linkEvidence`, where evidence must belong to T.

There are no migrations, no new API endpoints and no OpenAPI change. There is no new dependency.

## 2. Behaviour delivered, per requirement row

### 2.1 REQ-S12-012: "A13: a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic" (Added scope 1, D-QA-F2-1)

**What changed.**

- `dependency.slipped` v1 is in `OUTBOX_EVENT_SCHEMAS`.
- The relay now publishes the row instead of refusing it with `no schema for dependency.slipped v1` for 10 attempts.
- Starter 9 (`portfolio.dependency_slip`) runs, and later events are no longer held up behind the refused row.
- The builder catalogue serves the complete v1 `samplePayload` (`slipId`, `dependencyId`, `transformationId`, `slipDays`), so "every event trigger with a schema has one" holds.
- The dry run validates `dependency.slipped` samples strictly against the v1 payload.

**Tests.**

- `tests/qa/integration/a13-dependency-slip-rule-b.test.ts` passed **unchanged**: 8/8, including "each distinct affected owner is notified ONCE…" (batch 1).
- My relay test (`dependency-slip-relay.test.ts`):
  - the API records a real 5-day critical slip and the **real** `relayOnce` runs: the row is published with `publish_attempts = 1` and `last_error = null`, and no relay failure occurs;
  - the real worker then records exactly one `dependency.slipped` execution with status `succeeded`, and one `dependency_slip` work item for the affected owner (BO);
  - a further relay round publishes nothing, and the execution stays the only one.
- **Negative control:** the interrupted run observed this test failing with the registration removed (`negative-control-relay-unregistered.log`). I did **not** re-run that control in this run, so it is not fresh evidence.

**Registry audit.** `outbox-registry.test.ts` covers the event types the API and the worker enqueue.

- There are 16 outbox write sites. Their file list is pinned, so a new site must be added there.
- The event-type literals and constants at those sites are:
  - `transformation.created` (v1 and v2), `job_schedule.updated`;
  - `kpi.threshold_changed`, `kpi.trajectory_approved`, `kpi.version_activated`, `kpi.actual_accepted`, `kpi.values_recalculated`, `kpi.deviation_evaluated`;
  - `benefit.evidence_submitted`, `benefit.value_validated`, `benefit.value_rejected`, `benefit.variance_evaluated`;
  - `adoption.check_failed`, `blocker_status.recorded`, `control_check.failed`;
  - `gate.submitted`, `gate.decided`, `procedure_step.activated`;
  - `job.failed`, `automation_failure.retry_requested`, `job.run_requested`, `export_job.requested`, `demo.reset_requested`;
  - `kpi_restatement.approved`, `branding.published`, `dependency.slipped`, `report_snapshot.issued`.
- **Result:** every type has a v1 schema, except `report_snapshot.issued`.
  - Its write site returns early while `outboxPayloadSchema(..., 1) === null`, so it never writes an unregistered row. ADR-0045 §10 / ADR-0047: its consumer is still to come.
  - The test pins that guard, and fails if the type becomes registered without being moved out of the guarded list.
  - **No other type is missing.**

### 2.2 Added scope 2 (D-QA-F2-3, Low): no orphan export file after a killed attempt

**Behaviour.**

- `runExport` calls `discardEarlierAttempts(store, job)`, which removes `exports/<org>/<job>-a1 .. a(n-1).<ext>`:
  - right after the attempt starts;
  - again after a successful commit.
- It goes through the store port's existing `discard`, which is idempotent: a missing object is a no-op. So `packages/reporting/src/store*` did not change.
- Every key is built from this job's ID, so no other job's file is touched. The current attempt's key is never in the range.
- A store error is swallowed: the file stays for the next attempt and the export does not fail.

**Tests.**

- `tests/qa/integration/a13-jobs-rerun.test.ts`, including its orphan assertion, passed **unchanged**: 5/5 (batch 1).
- My `exports-orphan.test.ts` passed 2/2:
  - an attempt killed after `put` leaves a1, and a2 removes it at start, so only a2 remains and another job's files are untouched;
  - an earlier file written while the succeeding attempt renders is removed at success.
- The unit test in `export-runner.test.ts` is part of `unit-node`.

### 2.3 REQ-S18-002: "…plus one each of: … pending approval" (Added scope 3, QA-E2 O-1)

**What is seeded.** Module `roaming.states`, order 600, function `seedPendingApproval`, all rows written through `ctx.insert`:

- a role mapping: party `BO` mapped to `roaming.user.bo` on the roaming transformation;
- an `approval` row:
  - `decision_request` for the T04 design decision D-01;
  - `decision_right_id` = the T11 row "Target-state design", whose Approve party is BO;
  - requested by `roaming.user.tl`, status pending, round 1, assignee `roaming.user.bo`, SoD `requester_excluded`;
  - SLA `working_days` with `due_date = null` and `due_unknown_reason = calendar_not_configured`. The demo organization has no business calendar, so the due date is shown as Unknown, never a guessed date.
- the `approval_decision` work item and its inbox notification.

All of it is synthetic.

**Tests.**

- `demo-pending-approval.test.ts` passed 4/4:
  - the rules name BO;
  - `roaming.user.bo` lists it in `GET /approvals?role=assignee&status=pending`, reads it, and has its task and notification;
  - no other demo role user lists it as assignee, and the TL lists it as requester;
  - the product acts on it: the TL as requester gets 403 (SoD), a stale version is refused, and the BO decides it in a scratch copy.
- `a15-demo-transformation-outputs` passed 7/7, including the coverage check.

**Reset determinism.**

- `packages/db/test/integration/demo.test.ts` › "through the CLI (the shipped dataset): seed-demo, then reset-demo twice gives identical counts and checksums" passed (batch 4).
- `demo-roaming.test.ts` › "a second seed into a fresh database gives identical record counts and checksum" passed (batch 4).
- `tests/qa/integration/a22-operational-readiness.test.ts` (two resets, identical counts and checksum) passed 8/8 (batch 5).
- The checksum covers every public base table, so it includes `approval`, `role_mapping`, `work_item` and `inbox_notification`.

### 2.4 REQ-S06-003: "A01;A06: the ten procedures exist after initialization and each can be launched and completed in the A02 scenario" (Added scope 4, Rule A clarified by D-167)

**Rule.** A step whose `transformation_id` was adopted is a step of an organization-scope instance that took T. For that step:

- reading the instance for that step, and acting on it, are authorized on T with the step's assignee role. "Acting" means complete, skip, assign (the assignee must hold the role **on T**), link evidence (the evidence must belong to T), and the inputs that step requires;
- the organization scope is tried first, so every organization-scope actor keeps its rights;
- when no scope allows the write, the refusal of a scope the caller can read (403) wins over a 404, as for any other step;
- the instance list, cancel, the other steps and the organization-level reads keep organization scope.

**Tests.**

- `tests/qa/integration/a02-a21-complete-lifecycle.test.ts` passed **unchanged**: 13/13, including "drives every instance through its steps with the native workflows; every one ends completed" (batch 1). The W21 failure `"new_transformation_intake": "draft_charter (TL): 404 not_found"` is gone.
- My `adopted-step-authorization.test.ts` passed 2/2:
  - before adoption, T's Lead gets 404;
  - after adoption, T's Lead reads the instance and completes `draft_charter`;
  - the Workstream Lead on T gets 403, and a TL of another transformation gets 404 on read and act, with nothing written;
  - T's Lead cannot cancel (404), cannot change an input its step does not require (403 `procedure_step.not_assignee`), and does not see the instance in the list;
  - the organization-scope Lead still lists and reads the instance and completes an adopted step.
- The whole `apps/api/test/integration/procedures` directory passed (batch 2).

### 2.5 REQ-S10-013: "A15: changing a linked decision before cut-off changes the presentation; the issued pack remains the snapshot" (Added scope 5, D-162 e)

**It runs and passes.** In `presentation-verbose-B.log`:

- `✓ … changing a linked decision before cut-off changes the live presentation; the issued meeting-pack snapshot still returns the old decision (real meeting_pack assembler) 209ms`.
- The one skipped test is the opposite branch: `it.runIf(!hasMeetingPackAssembler)` "the live mode answers 404 while no meeting_pack assembler is wired". It is skipped by design because the assembler is wired.

**The list.** `P5_PENDING_TESTS_BE_O` is now `[]` with its type kept, and `P5_PENDING_BE_O` was already `[]`.

## 3. Checks (this run, final tree, sequential; logs in `docs/delivery/handbacks/DG5/T-DG5-BE-T5-evidence/`)

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | `PASS gate DG4 (historical)` | `validate-dg4-historical-B.log` (rerun at the end, §8) |
| 1 | `pnpm -r typecheck` | 0 | all packages Done | `typecheck-B.log` |
| 2 | `pnpm -r build` | 0 | all packages Done | `build-B.log` |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint-B.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All matched files use Prettier code style (run after this handback was written, §8) | `prettier-B.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint-B.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE npx vitest run --project unit-node` | 0 | 144 files, **2335 passed** | `unit-node-locale-unset-B.log` |
| 7 | `env -u LANGUAGE LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-node` | 0 | 144 files, **2335 passed** | `unit-node-c-utf8-B.log` |
| 8 | integration batch 1: the QA files `a13-dependency-slip-rule-b`, `a13-jobs-rerun`, `a02-a21-complete-lifecycle` and `a15-demo-transformation-outputs`, my five new or affected test files, and `governance/presentation` | 0 | 9 files, **50 passed, 1 skipped** (the by-design `!hasMeetingPackAssembler` branch) | `integration-batch1-scope-B.log` |
| 9 | the same, `--reporter verbose`, `governance/presentation.test.ts` only | 0 | 8 passed, 1 skipped; the REQ-S10-013 test ✓ | `presentation-verbose-B.log` |
| 10 | integration batch 2: the `automation`, `procedures`, `environment`, `contract`, `approvals` and `tasks` directories of `apps/api/test/integration` | 0 | 28 files, **300 passed** | `integration-batch2-api-dirs-B.log` |
| 11 | integration batch 3: the `governance`, `reporting` and `portfolio` directories of `apps/api/test/integration` | 0 | 68 files, **521 passed, 1 skipped** (the same by-design skip) | `integration-batch3-gov-rep-port-B.log` |
| 12 | integration batch 4: `apps/worker/test/integration` and `packages/db/test/integration` | 0 | 34 files, **339 passed** | `integration-batch4-worker-db-B.log` |
| 13 | integration batch 5: `tests/qa/integration/a22-operational-readiness.test.ts` | 0 | 1 file, **8 passed** | `integration-batch5-a22-B.log` |

**How the integration batches ran.** Every batch used:

```
QA_PG_PORT=23800 MTH_PORT_POOL=23801-23849 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>
```

Each batch ran on its own disposable PostgreSQL cluster, one batch at a time.

**Integration totals.** Batches 1–5 together ran 140 file runs: 1218 passed and 2 skipped. Presentation ran in both batch 1 and batch 3, so it is counted twice.

**Other notes.**

- No pinned-count change.
- No failed, flaky or timed-out test occurred in this run.
- Empty `.claude/.cc-writes` directories in the source folders were removed before testing. None were found.

**Not run (D-164):** `pnpm test`, `pnpm test:integration` and the full e2e suite. They are for the orchestrator's merged-tree verification.

## 4. Operations routed (pending-list delta)

- No API operation was added or routed, and `contract.test.ts` is unaffected. It passed in batch 2 (`contract` directory).
- `P5_PENDING_BE_O`: `[]` before and after.
- `P5_PENDING_TESTS_BE_O`: 1 entry (REQ-S10-013) before, `[]` after (scope 5).

## 5. Contract, schema and dependency needs (for the orchestrator)

- **Contract:** `OUTBOX_EVENT_SCHEMAS` gains `dependency.slipped` v1. The payload schema itself (`dependencySlippedV1`) is unchanged from BE-J.
  - **Consequence:** dry runs and samples of `dependency.slipped` must now carry the complete strict v1 payload.
  - **ARCH-R2:** the BE-J handback §5 note "deliberately not registered" is now historical. The architect may want to reflect this in ADR-0044 §7 / ADR-0043.
- **Demo seed:** it gains four rows (role mapping, approval, work item and inbox notification). The demo dataset checksum therefore changes. Any externally pinned demo checksum would need updating. None was found in the tests run.
- **No new dependency, no migration, no OpenAPI change.**

## 6. User-facing texts

- I searched the en/ar i18n and the shared sources for strings that call slip notifications or the seeded approval "planned", "later" or "not yet". None was found.
- `myWork.json`'s `dependency_slip` label ("A critical dependency slipped") is now accurate.
- No string was made untrue.

## 7. What remains

- Nothing in the Added scope.
- **For AN-P5C (D-167):** the held rows REQ-S06-003, REQ-S12-012 and REQ-S18-002 are now backed by the tests above.
- **For the orchestrator:**
  - the D-164 full runs;
  - optionally, a fresh negative control of the relay test, which only the interrupted run executed.
- **Merge note:** `procedures/steps.ts` and `instances.ts` are shared with no other W22 task. No conflicts are expected with FE-D5B (`apps/web/**`).

## 8. Final checks (after this handback was written)

- The prettier check (`git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`) exited **0**: "All matched files use Prettier code style!". The run included this handback. Log: `prettier-B.log`.
- `node tools/gates/validate.mjs --historical --stage DG4` exited **0**: `PASS gate DG4 (historical)`. Log: `validate-dg4-historical-B.log`.
- End time: `2026-10-17T18:34:05Z`, about 41 minutes after the start.
