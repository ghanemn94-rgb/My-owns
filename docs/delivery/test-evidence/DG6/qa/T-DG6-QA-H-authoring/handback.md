# T-DG6-QA-H handback: root e2e order independence, A13 recovery (qa-verifier, authoring)

- **Stage:** DG6 (BUILDING), slice L (QA-H). This is an authoring task, not a gate review.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-QA-H.md`, sha256 `067299aa…5c02c42` (checked).
- **Working tree:** `/home/user/wt/dg6-qa-h`, branch `dg6/qa-h`, `HEAD` `0d6ef5ad173ff627914f52ba7f1b7e7d260416c5`. The changes are left **uncommitted**.
- **Invocation:** `DG6-T-DG6-QA-H-qa-verifier-20261101T002414Z-950efbcb`, session `950efbcb-4088-4428-b3ca-446890aa77a3`.
- **Time:** start `2026-11-01T00:24:30Z`; end: see §9.
- **Data:** synthetic only. A rule review in a fixture is a synthetic configuration review that approves nothing real. No engineering gate DG0–DG7 is named in product text, and no business, Finance or IT approval is granted.

## 1. Result in one paragraph

The A13 spec (`e2e/a13-automation-recovery.spec.ts`) was **not** left without a working evaluator by one earlier spec's state. Its own `automation.evaluate` job waited behind an inherited backlog that the earlier root specs build up while no worker runs. Two product behaviours made that backlog fatal in the chromium-ar pass:

- **(a) Throughput.** The worker takes at most one job per queue per polling interval: batchSize 1, 2 s. pg-boss 11 waits out the interval after every fetch, including a non-empty one.
- **(b) Evaluation-time rule selection.** The engine selects candidate rules when it *evaluates* an event, not when the event occurred. Every inherited `transformation.created` evaluated after A13's own synthetic rule went live therefore ran that rule and met A13's disclosed fault. It then failed and was retried under the production policy (5 retries, backoff), and each retry that fell due went ahead of A13's own job again (FIFO by `created_on`).

The queue was being processed the whole time, so it was not left unprocessed. Under the assignment's definition this is therefore not a product defect. Both behaviours are reported as observations (§6). The spec now establishes its own precondition before its rule or events exist: every inherited `transformation.created` event has been relayed and every inherited `automation.evaluate` job has finished. This wait is bounded (900 s) and logged. The 240 s budgets and every assertion are unchanged. The spec's restore of the queue policy also had a bug, now fixed: it restored `retry_backoff` as `false`.

## 2. Files written

| File | Purpose |
|---|---|
| `e2e/a13-automation-recovery.spec.ts` (modified) | The precondition in `beforeAll`: wait (bound `INHERITED_MS` 900 s, logged) until no inherited `transformation.created` event is unrelayed and no inherited `automation.evaluate` job is `created`/`retry`, or `active` within the last 5 min. A job orphaned by a killed earlier worker waits for pg-boss's expiry and cannot block this wait. Also fixes the `retry_backoff` restore: `boolean \|\| text` is `'true'`, which was compared with `"t"`. |
| `e2e/support/a13-a22-stack.ts` (modified) | `QA_WORKER_ENTRY`, an environment switch used only by the mutation checks, points `startProductionWorker` at a mutated copy of the built worker under `$TMPDIR`. When unset, the default is the built production entry, unchanged. |
| `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-H-authoring/*` | Logs, the run scripts (`run-full-monitored.sh`, `run-a13-last.sh`, `mutations.sh`, `mutation-m1b.sh`, `mutation-m3b.sh`, `experiment-evaluation-time-rules.sh`), the A13 screenshots and this handback. |

No file under `apps/**`, `packages/**`, `tools/**`, `.claude/**`, `docs/source/**` or any delivery record was edited. `node_modules` and `apps/**` are read-only in this sandbox.

## 3. Diagnosis (evidence)

1. **Reproduction on the integrated HEAD.** `repro-full-default.log` and `repro-full-default-monitor.log` (a queue monitor every 20 s) record one Playwright invocation of `$(ls e2e/*.spec.ts | grep -v /a02-)` on one stack (ports 27600/27601), exit 1:
   - Result: 285 passed, 3 failed, 18 skipped (36.7 min).
   - A13 chromium-en passed. Its own event took 33.2 s.
   - A13 chromium-ar failed exactly as at 70957f5: `timed out after 240000 ms waiting for this spec's transformation.created event to be relayed and evaluated; state: {"published":true,"jobs":[{"name":"automation.evaluate","state":"created"},…]}; … automation.evaluate=44`.
   - The other two failures are `a17-import-and-integration.spec.ts:296` (en and ar): `QA_A17_WEBHOOK_SIGNING_SECRET must be exported before the stack starts (BLOCKED otherwise)`. That is my harness: I had not exported the synthetic secret. With the secret exported the whole spec passes 10/10 (`a17-webhook-with-secret.log`, exit 0; the value is not logged).
2. **Monitor around A13-ar.**
   - At 00:46:34, when A13-ar's worker started, 87 `automation.evaluate` jobs were `created`.
   - Over the next 4 min the worker completed 0–10 per 20 s: about 0.05–0.5 jobs/s.
   - Up to 10 inherited jobs sat in `retry` (00:49:55: `created 36`, `retry 10`).
   - A worker that has nothing to fail behaves very differently. In the fixed run, A13-en worked off 4 inherited jobs in 7.8 s.
3. **Mechanism (a), from the source.**
   - `apps/worker/src/worker.ts` registers every domain queue with `{ batchSize: 1, pollingIntervalSeconds: 2 }`.
   - pg-boss 11.0.0 `src/worker.js:77`: `if (!this.stopping && !this.beenNotified && (this.interval - duration) > 100) await delay(this.interval - duration)`. This runs after every fetch, including a fetch that returned a job.
   - Fetch order: `src/plans.js:610` `ORDER BY priority desc, created_on, id`.
4. **Mechanism (b), isolated** (`experiment-evaluation-time-rules.sh` and `.log`, exit 0). Setup: a fresh stack, 12 synthetic transformations created with no worker running, then the A13 spec **as at HEAD** (a temporary copy, removed afterwards). Results:
   - The spec's own event took 96.4 s with only 12 older events ahead.
   - `rule tasks by trigger | OLDER event (created before the rule) | 12`: the synthetic rule acted on every one of the 12 events that were created before it existed.
   - `evaluate jobs that met the synthetic fault | retry | 7` and `| failed | 4`.
   - Engine source (`apps/worker/src/automation/engine.ts` `candidates`): `enabled = true AND v.status = 'published'` at evaluation time; nothing compares rule and event times. ADR-0043 l.97 says "for each enabled rule whose effective version names the event's trigger", so the behaviour matches the ADR's text, and the ADR does not address late events.
5. **Not the cause** (`diag-1-workers.log`): A13-en, then the three specs that start and stop workers (a17-failing-connector, a22-operations-jobs, a22-p6-operability), then A13-ar on a fresh stack. A13-ar passed (9.3 s). No queue was paused and no rule or schedule was left changed. In that run a17-failing-connector and a22-p6-operability failed, before the fix, with `ENOENT … mkdir apps/web/e2e/screenshots/en`, because `apps/**` is read-only here. Every later run sets `E2E_SCREENSHOT_DIR` under `$TMPDIR`.

## 4. Checks run (real exit codes)

| # | Command (environment) | Result |
|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start, 00:24) | exit 0, `PASS gate DG5 (historical)` |
| 2 | `QA_PG_PORT=27630 MTH_PORT_POOL=27631-27649 tests/qa/support/with-pg.sh pnpm vitest run --project integration tests/qa` | **attempt 1: exit 1, did not start.** Vite could not `mkdir node_modules/.vite-temp` (read-only `node_modules` in this sandbox; `integration-tests-qa-attempt1-vite-temp-readonly.log`). |
| 2b | the same with `--configLoader runner` (Vitest's in-memory config loader; nothing else changed) | **exit 0: 45 files, 437 tests passed** (930 s; `integration-tests-qa.log`; per-file counts in `integration-per-file.txt`, §4.1) |
| 3 | `pnpm lint` (whole repository, after the fix) | exit 0 (`lint.log`) |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §9 |
| 5 | Repro: the root set in default order at HEAD (§3.1) | exit 1: A13-ar timeout reproduced; 2 webhook tests BLOCKED by my harness |
| 6 | **Proof 1: the root set in default order, with the fix** (`proof-default.log`, monitor `proof-default-monitor.log`; ports 27610/27611) | see §5 |
| 7 | **Proof 2: A13 moved last** (`run-a13-last.sh`: every other root file en+ar, then A13 en+ar on the same stack; `proof-a13-last.log`; ports 27620/27621) | see §5 |
| 8 | Mutation checks (§7) | M1, M1b, M2, M3b, M4, M5 killed; M3 survived (an equivalent mutant, explained); control passed |
| 9 | `a17-import-and-integration.spec.ts` alone with a synthetic `QA_A17_WEBHOOK_SIGNING_SECRET` | exit 0, 10/10 |
| 10 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | see §9 |

Proofs 1 and 2, the mutation stacks and the integration run partly overlapped (at most four stacks at once, all on ports 27600–27649). Proofs 1 and 2 were started **without** the synthetic webhook secret. Their only failures, `a17-import-and-integration.spec.ts:296` en and ar, are that harness precondition (row 9 shows the spec passing with it).

### 4.1 Integration counts per file (`tests/qa`, project `integration`)

All 45 passed: a01-one-source-of-truth-scorecard 2, a01-p6-source-coverage 11, a02-a08-drafts-before-g2-scale-after-g5 1, a02-a21-complete-lifecycle 13, a03-modular-entry 12, a04-a05-a10-partials 4, a04-kpi-propagation 8, a05-calculation-correctness 17, a06-configuration-change 27, a07-historical-integrity 12, a08-gate-controls 31, a09-decision-escalation 17, a10-benefit-integrity 16, a11-adoption 12, a11-bau-sustain 17, a11-value-closure 11, a12-cross-scope 14, a12-p6-scope-isolation 26, a13-dependency-slip-rule-b 8, a13-durable-automation 12, a13-job-idempotency 5, a13-jobs-rerun 5, a13-p6-channel-send-kill-restart 1, a13-p6-connector-run-kill-restart 1, a13-p6-import-commit-kill-restart 1, a13-p6-outbound-write-once 3, a13-p6-reindex-kill-restart 1, a13-starter-jobs 4, a13-starters-run 11, a14-concurrency 5, a14-p6-bulk-compare-reapply 6, a15-demo-transformation-outputs 7, a15-outputs-every-definition 5, a15-selected-records-and-injection 7, a15-snapshots-and-packs 15, a16-health-check 13, a16-launch-plan 11, a16-s16-021-entities 6, a17-import-and-integration 10, a17-s01-005-external-change 4, a20-p6-register-1000 4, a20-s15-014-no-infra-terms 6, a21-p6-adapters-disabled 10, a22-operational-readiness 8, a22-p6-operability 17. Total 437.

## 5. Proofs of the fix

Both runs use the fixed spec on one shared stack each, `--workers=1`. Each A13 run asserts `<html lang/dir>` (en LTR / ar RTL) and axe 0 serious/critical on the failure-queue screen, open and resolved. Screenshots: `screens-default/{en,ar}/`, `screens-a13-last/{en,ar}/`.

| Run | Overall | A13 chromium-en | A13 chromium-ar |
|---|---|---|---|
| Repro at HEAD, default order (§3.1) | exit 1: 285 passed, 3 failed, 18 skipped | ✓ own event 33.2 s | **✘ 240 s timeout** (own job `created`) |
| **Proof 1, default order** (`proof-default.log`) | exit 1: **286 passed**, 2 failed, 18 skipped (38.1 min) | ✓ precondition: 4 inherited jobs worked off in 7.8 s; own event 2.9 s; retried entry resolved 1.6 s | ✓ precondition: **81** inherited jobs worked off in 161.8 s; own event **4.7 s**; resolved 2.2 s |
| **Proof 2, A13 last** (`proof-a13-last.log`) | part 1 (21 files without A13, en+ar): exit 1, 284 passed, 2 failed, 18 skipped (35.1 min). **Part 2 (A13 last): exit 0, 2 passed** (6.1 min) | ✓ precondition: **131** inherited jobs worked off in 261.9 s; own event **75.0 s** | ✓ precondition: 0 inherited; own event 2.6 s; resolved 2.5 s |

- **The only failures** in proofs 1 and 2 are `e2e/a17-import-and-integration.spec.ts:296` en and ar: `QA_A17_WEBHOOK_SIGNING_SECRET must be exported before the stack starts (BLOCKED otherwise)`. This is my harness omission, not a product failure: the spec passes 10/10 with the synthetic secret (`a17-webhook-with-secret.log`). Each proof run therefore exits 1 for that reason alone. I did not repeat the 38-minute runs with the secret within the time limit. That full green run remains (§9).
- **Disclosed margin.** In proof 2, A13-en's own event still took 75.0 s after the precondition. The jobs created *during* the 262 s drain (other events from the stack: connector schedules and the like) also sort ahead of its own job. That is within the unchanged 240 s budget, but the margin is smaller than in proof 1.
- In proof 1, the jobs that met the synthetic fault (`evalerr` in `proof-default-monitor.log`) are only A13's own two per pass: its sample and its failing transformation, with retry limit 0. No inherited job met the fault, unlike the repro.
- **Pre-existing, not changed:** each A13 pass leaves open failure-queue entries for its own sample transformation `t0`, which its rule also evaluates. They are visible in the screenshots and do not affect any assertion.
- No step hit a 30 s timeout in these runs.

## 6. Product observations (no product defect under the assignment's definition; proposed for classification)

Neither leaves a queue unprocessed: the jobs complete, slowly. Both are proposed for the orchestrator or domain reviewer to classify. Neither is hidden by the spec change. The spec only makes sure that it does not inherit them.

- **O-1 (proposed Medium, operability/performance; relates to REQ-S20-029, REQ-S12-020):** per-queue throughput of one job per polling interval per worker process.
  - Cause: `apps/worker/src/worker.ts` `batchSize: 1, pollingIntervalSeconds: 2`, together with pg-boss 11's loop delay after every fetch (`node_modules/.pnpm/pg-boss@11.0.0/node_modules/pg-boss/src/worker.js:77`).
  - Measured: 0.05–0.5 `automation.evaluate` jobs/s on a loaded host (`repro-full-default-monitor.log`, field `eval-done-last-min`, which actually counts the last 20 s).
  - Effect: a burst of N events on one queue needs at least 2·N s per worker process. For example, 1,000 KPI actuals accepted in an import means at least 33 min before the automation reacts to the last one.
  - Reproduction: `repro-full-default.log`, or any stack with a backlog. The relay and the other queues are unaffected.
- **O-2 (proposed Medium or Low, behaviour to confirm; REQ-S12-001/REQ-S12-002, ADR-0043 l.97):** a rule acts on events that occurred **before** it was enabled, whenever their evaluation is late. Late evaluation happens with a backlog, after a worker outage, or on a retry.
  - Reproduction: `experiment-evaluation-time-rules.sh` on a fresh stack. Create 12 transformations with no worker, then enable an organization-scoped `transformation.created` rule. Result: 12 tasks for the 12 older transformations.
  - Whether a newly enabled rule should apply to events that are already queued is a product decision. ADR-0043 does not state it.

## 7. Mutation checks (product never edited; mutants are copies of `apps/worker/dist` under `$TMPDIR`)

Each mutant runs the A13 spec in chromium-en on a fresh stack through `QA_WORKER_ENTRY` (logs: `mutations.log`, `mutation-m1b.log`, `mutation-m3b.log`; the exact diff of each mutant is printed in its log).

| Mutant | Broken behaviour | Spec result (exit) | Failing assertion |
|---|---|---|---|
| M1 | Resumed execution ignores the `done` result **and** the work item's dedupe key is unstable (`engine.js:288`, `items.js:43`) | FAIL (1) | `timed out after 240000 ms waiting for the retried entry resolved`. The database's third layer (partial UNIQUE `automation_action_result_effect_once_key`) refuses the second `done`, so the retry never resolves. |
| M1b | M1 plus `DROP INDEX automation_action_result_effect_once_key` in the disposable database | FAIL (1) | `after the retry: one task and one reminder`: expected `tasks: 1`, received `tasks: 2` |
| M2 | No `automation.evaluate` consumer (`worker.js:64`), the reported symptom | FAIL (1) | `timed out after 240000 ms waiting for this spec's transformation.created event to be relayed and evaluated; … "automation.evaluate","state":"created"` |
| M3 | An execution whose action **returned** an error finishes `succeeded` (`engine.js:405`) | **PASS (0): survived.** Equivalent for this scenario: the disclosed fault makes the action **throw**, so the execution ends in the catch path, which M3 does not touch. |  |
| M3b | On the last attempt a **thrown** action no longer finishes the execution `failed` (`engine.js:413`) | FAIL (1) | `timed out after 60000 ms waiting for the failed execution` |
| M4 | The retry dispatcher treats every request as stale (`worker.js:84`) | FAIL (1) | `timed out after 240000 ms waiting for the retried entry resolved` |
| M5 | `create_task` writes no task (`items.js:31`) | FAIL (1) | `partial failure: the task is written, the reminder is not`: received `tasks: 0` |
| control | The built production worker | PASS (0) | none |

## 8. Requirement → test

The rows are those of `requirements.csv` with `final_gate` DG6 whose `acceptance`, `increments` or `notes` cite A13. The binding acceptance text is quoted for each.

| Row | Acceptance (binding) | Test that proves it |
|---|---|---|
| REQ-S20-013 | "A13: Retried events, worker restarts and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable" | **Partial failure → failure queue → retry from the screen, no duplicate task or notification, one execution `succeeded`, en LTR / ar RTL, axe 0 serious/critical:** `e2e/a13-automation-recovery.spec.ts` (this task; proofs §5, mutations §7). Retried events: `tests/qa/integration/a13-durable-automation.test.ts` ("replaying the same event three times yields one reminder, one action and one approval task"; "after the retry limit … succeeds on retry without duplicating actions") and `a13-job-idempotency.test.ts`. Worker restarts: `a13-durable-automation.test.ts` (REQ-S12-020 kill and restart), `a13-p6-reindex-kill-restart`, `a13-p6-connector-run-kill-restart`, `a13-p6-import-commit-kill-restart`, `a13-p6-channel-send-kill-restart`, `a13-jobs-rerun.test.ts`. All passed in §4 row 2b. |
| REQ-S17-006 | "A13;A12: replaying an outbound write with the same key produces one downstream effect; a write without confirmation stays 'pending confirmation'" | `tests/qa/integration/a13-p6-outbound-write-once.test.ts` (3 tests, passed). Not re-authored here. |
| REQ-S16-022 | "A06;A13: the ERD and migrations contain every entity listed … and an integration test creates and reads each one through the API with authorization enforced" | **NOT COVERED by a QA test.** The register notes say so ("QA-C lists the 7-entity matrix as not covered by QA"; the implementer's `s16-022-entity-group.test.ts` is the only evidence). Out of this task's time budget; IntegrationRun alone is covered by `e2e/a13-connector-run-once.spec.ts` and `a13-p6-connector-run-kill-restart`. |
| REQ-S20-029 | "A22;A13: the load report states the dataset, infrastructure and workload, and gives actual p95 figures …, with any miss against 2 s/4 s listed as a finding" | `tests/qa/unit/dlv038-s20-029-load-report.test.ts` (unit-node project; not re-run by this task). O-1 (§6) is relevant to its "realistic load" reading. |
| REQ-S20-030 | "A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%, and the file downloads only for the requester" | **NOT COVERED by a QA test in `tests/qa`/`e2e`.** The register notes cite DO-G/DO-H export proofs, which are not QA tests. Out of this task's time budget. |
| REQ-DLV-038 | "…: the applicable A01-A22 executable tests pass on the DG6 candidate and the load report states the actual results against REQ-S20-029" | Contributes: this task removes the root-set order dependence of A13 (§5) and reports the `tests/qa` integration run (437/437). The DG6 candidate run itself is not part of this task. |

## 9. Remaining, and end checks

End checks, run after every change in this task (end time `2026-11-01T01:39:21Z`, about 75 min):

- `node tools/gates/validate.mjs --historical --stage DG5`: start **exit 0**, end **exit 0**, `PASS gate DG5 (historical)` (`validate-dg5-start.log`, `validate-dg5-end.log`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`: **exit 0** (`prettier.log`).
- `pnpm lint`: **exit 0** (`lint.log` after the spec fix, `lint-final.log` at the end).
- Disk: 7.9 GB free on the worktree's tmpfs before each full run (`df -h .` in the run logs).
- No empty `.cc-writes` directory remains in a source folder. One that appeared in this evidence folder was removed.
- The disposable stacks were torn down by `with-stack.sh`. The mutant copies under the run's private `$TMPDIR` are removed with it when the run ends.

**Remaining (not done):**

1. A fully green root run (default order and A13-last) **with** the synthetic `QA_A17_WEBHOOK_SIGNING_SECRET` exported. The two failures per proof run are that harness precondition only. The spec itself passes with the secret, but the 38-minute runs were not repeated within the time limit.
2. REQ-S16-022 (the 7-entity create/read matrix through the API) and REQ-S20-030 (async export of the full load dataset) have no QA test. §8 explains why; this task did not author them.
3. O-1 and O-2 (§6) need classification by the orchestrator or domain reviewer. If O-2 is judged a defect (a rule must not act on events that occurred before it was enabled), the precondition in the A13 spec would still be correct, but a product test for it would need to be added.
4. The precondition's 900 s bound is a new, logged wait **before** the scenario starts. The 240 s budgets of the scenario's own waits are unchanged. If the root set grows, the backlog that A13 inherits grows with it: 131 jobs (262 s) when it runs last today.

**Merge instructions:** two modified spec/support files under `e2e/` and this evidence folder. No migrations and no product changes. The only interaction is the new optional `QA_WORKER_ENTRY` in `e2e/support/a13-a22-stack.ts`, which other root specs that call `startProductionWorker` ignore unless it is set.
