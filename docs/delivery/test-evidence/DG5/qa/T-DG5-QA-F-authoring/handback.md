# Handback T-DG5-QA-F: executable acceptance suites A13 and A22 (qa-verifier, authoring)

- **Stage:** DG5 (P5). This is an authoring task, not the DG5 gate review.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-QA-F-qa-verifier-20261017T060339Z-9b3908c5","session_id":"9b3908c5-548b-499e-a757-c8e6ebf386c8"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-QA-F.md`, sha256 `4c4b65d5…ae268` (verified).
- **Tree:** worktree `dg5/qa-f`, HEAD `bed361972afeebcb91ea8bfd0064e4622c1d2540`. It was unchanged at the start and end.
- **Changes:** all uncommitted, as asked. No file under `apps/**`, `packages/**`, `tools/**`, `.claude/**`, `docs/source/**` or any delivery record was modified (`git status` shows only new files under `tests/qa/**`, `e2e/**` and this evidence directory).
- **Time:** `date -u` was 06:03:56 at the start and 07:18 at the end (about 75 minutes).
- **Data:** all synthetic. Every rule review, ask and approval in the fixtures is a synthetic in-product action on test data. No agent granted a business, Finance or IT approval, and no DG0–DG7 gate is named in product text.

## 1. Files written

| File | Purpose |
|---|---|
| `tests/qa/support/a13-durable.ts` | Support for both suites. It provides:<ul><li>a scratch database per suite (pg-boss policies are per-database global state);</li><li>synthetic org worlds (ADM_METHOD, TO, ADM_TECH, AUD, TL);</li><li>the rule lifecycle through the public API only (create → dry run → submit → TO review → publish → enable);</li><li>row observers;</li><li>the disclosed fault injection (§5);</li><li>in-process and child-process production workers.</li></ul> |
| `tests/qa/support/a13-child-worker.ts` | The production `startWorker` (every registered handler) in its own OS process, so the suite can SIGKILL it. It adds no handler of its own. |
| `tests/qa/integration/a13-durable-automation.test.ts` | A13, 12 tests: REQ-S12-001, -002, -020, -021, -026. |
| `tests/qa/integration/a13-starter-jobs.test.ts` | A13, 4 tests: REQ-S12-004 and REQ-S12-015. |
| `tests/qa/integration/a22-operational-readiness.test.ts` | A22, 8 tests: REQ-S12-022 (API) and REQ-S18-003 / REQ-S18-001. The environment tests drive the built `mth-db` CLI as a separate process. |
| `tests/qa/unit/a22-s21-001-text-scan.test.ts` | A22/A28, 7 tests: REQ-S21-001 text scan and labels. It is an independent scanner and does not reuse `packages/shared/src/text-scan`. |
| `e2e/support/a13-a22-stack.ts` | Shared e2e helpers: dev-login API sessions, `psql` as the stack DB owner (BLOCKED if `psql` is missing), and the built worker `node apps/worker/dist/main.js` as a process. |
| `e2e/a13-automation-recovery.spec.ts` | A13 user-visible path: a failed execution appears in the failure queue; Retry is clicked on screen; the entry resolves; the DB has no duplicates. Runs in en and ar. |
| `e2e/a22-operations-jobs.spec.ts` | A22 user-visible path: the jobs screen shows last success and next run for every scheduled job; run-now is recorded; non-admins get 403; a production database shows no synthetic banner. Runs in en and ar. |
| `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-F-authoring/**` | This handback, the logs, 12 screenshots, and the mutation logs and scripts. |

## 2. Checks run (real exit codes)

All commands ran from the worktree with Node 24.21.0, offline, on harness ports 23700–23749 only. The `.cc-writes` folders were removed before the runs, and `df -h .` showed 7.9 G free on the tree (0–1 % used) before each full run.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | exit 0, `PASS gate DG4 (historical)` | `validate-dg4-historical-start.log` |
| 2a | `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` (run 1, 06:51) | **exit 1**: 24/26 files and 284/287 tests passed; 3 failed (see §2.1) | `full-integration-run1.log` |
| 2b | Same command (run 2, 06:59, after the fixes) | **exit 0**: 26/26 files, 287/287 tests passed, 321.7 s | `full-integration-run2.log` |
| 3 | `npx vitest run --configLoader runner --project unit-node tests/qa/unit` | exit 0: 2 files, 22 tests | `unit-qa-run.log` |
| 4 | `E2E_PG_PORT=23710 E2E_API_PORT=23711 MTH_PORT_POOL=23712-23749 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a13-automation-recovery.spec.ts e2e/a22-operations-jobs.spec.ts --workers=1` | exit 0: 4 passed (2 specs × chromium-en and chromium-ar), 58.6 s; axe found 0 serious or critical issues on every checked screen | `e2e-final.log`, `screenshots/{en,ar}/*.png` |
| 5 | `pnpm lint` | exit 0 | `pnpm-lint.log` |
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `prettier-check-all.log` |
| 7 | Mutation checks M1–M6 (§4) | all 6 killed: each mutant exits 1 on the targeted test | `mutations/m1..m6.log` |
| 8 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | exit 0, `PASS gate DG4 (historical)` | `validate-dg4-historical-end.log` |

**Per-file counts in run 2:**

- Mine:
  - `a13-durable-automation` 12/12
  - `a13-starter-jobs` 4/4
  - `a22-operational-readiness` 8/8
- Existing suites, all passing:
  - a06 27, a08 31, a09 17, a10 16, a05 17
  - a11-bau 17, a11-adoption 12, a11-value-closure 11
  - a16-health-check 13, a04-kpi 8, a16-launch-plan 11
  - a15-snapshots 15, a03 12, a04-a05-a10 4
  - a15-outputs-every-definition 5, a15-demo 7, a15-selected 7
  - a12 14, a13-job-idempotency 5, a02-a08 1
  - a14 5, a16-s16-021 6, a01 2

### 2.1 Every non-zero exit and failure, explained

- **Full run 1, `a13-durable-automation`, 2 failures (my harness, not the product).**
  - Under the load of the full run, the SIGKILLed child worker had also picked up a `transformation.created` job. pg-boss re-delivers such a job only after its expiry (15 min by default).
  - My "queues drained" wait therefore timed out in two later tests: the dry-run test and the "both entries" test (`[{"name":"transformation.created","state":"active","n":1}]`).
  - **Fix (test-side):** before any event exists, the suite sets `expire_seconds = 20` on every queue of its own scratch database (3 s for `automation.evaluate`). The dry-run test timeout is now 90 s.
  - Isolated runs had passed before (`dev-a13-9.log`); run 2 passes.
- **Full run 1, `a13-starter-jobs`, 1 failure (fixture).**
  - I edited this file while run 1 was in progress, and the run picked up the edit. The new open-ask fixture used the TL as the ask owner, and the API answered 422 `executive_decision.owner_not_executive`. That answer is correct product behaviour.
  - **Fix:** a BO of the transformation owns the asks. Rerun alone: `dev-a13s-5.log` (4/4); run 2: 4/4.
- **Development iterations** (the `dev-*.log` files) failed on test-side mistakes, each fixed:
  - dry-run samples must carry the **v1** event members (the contract says so);
  - the gate approval task kind is `gate_decision_due`;
  - the job-schedule `GET` route does not exist (I used the list);
  - the CLI needs `NODE_ENV`;
  - the jobs table pages by 10;
  - `psql` does not decode `+` in URI options;
  - the failure queue filters to Open by default.
- **First mutation pass:** `$TMPDIR` ran out of space after full clones of the repository, which include `docs/` at 1.8 G. M1 had already completed (log kept). M2–M5 were then rerun one at a time in sparse clones (`make-clone.sh`, `run-one.sh`).
  - The tree disk was not affected: `/dev/vda` had 7.0 G free during the reruns, above the 3 G limit of D-104.
  - The first-pass M2–M5 results (exit 125/1 from missing clones) are void and not reported as kills.

## 3. Requirement → test

The file abbreviations are:

- `A13D` = `tests/qa/integration/a13-durable-automation.test.ts`
- `A13S` = `tests/qa/integration/a13-starter-jobs.test.ts`
- `A22I` = `tests/qa/integration/a22-operational-readiness.test.ts`
- `A22U` = `tests/qa/unit/a22-s21-001-text-scan.test.ts`

| Requirement (binding acceptance) | Proved by | Status / what is left |
|---|---|---|
| **REQ-S12-001** "each execution is recorded with rule version, trigger event and outcome" | `A13D` "the execution history names the rule, its version, the trigger event and the outcome, per action". The list and one-execution reads as AUD return `ruleId`, `versionId`, `versionNo`, `triggerCode`, `triggerKey` (= the outbox key), `status` and the per-action results; a TL gets 403. | Covered for admin rules and starter 1 (the sixteen-starters test). It is not run for each of the 16 starters (AN-04); that is left to the DG5 review / DG6. |
| **REQ-S12-002** "a dry-run creates no tasks; a failed execution appears in the queue and succeeds on retry without duplicating actions" | <ul><li>`A13D` dry-run test: the global counts of `work_item`, `inbox_notification`, `automation_execution` and `outbox_event` do not change.</li><li>`A13D` "an admin retries it from the queue": a partial failure (task written, reminder failing) appears in the queue; 428, 403 (AUD) and 409 (stale) are refused; the retry is 200; the entry resolves; there is 1 task, 1 reminder, 1 `done` result per action and 1 execution; a second retry gives 422 `automation_failure.not_open`.</li><li>`A13D` "both queue entries … are retried".</li><li>`A13D` dismiss test.</li><li>`e2e/a13-automation-recovery.spec.ts`: the same flow on screen in en and ar.</li></ul> | Covered. This is the clause that QA-A left NOT COVERED. |
| **REQ-S12-004** "one transformation → one set of phase checklists and role tasks; a retry creates no duplicates; with the plan flag the 90-day tasks are dated from the start date" | `A13S`:<ul><li>create with `launchPlan.startDate=2026-11-01`; the real worker runs; the event is replayed 3× (re-relay plus re-delivery to every consuming queue); the snapshot of `phase_step`, `role_assignment` items, all work items, `launch_plan` and `launch_task` is identical;</li><li>every task's `dueDate` lies in its window (Day n = start + n: 0–30, 31–60, 61–90), and all three windows are present;</li><li>without the flag, there is no plan.</li></ul> | Covered. |
| **REQ-S12-012** "a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic" | — | **NOT COVERED.** The fixture needs initiatives with dated milestones, dependencies and durations. The only existing setup path is the implementer's DB fixtures (`seedExecutionWorld`, `insertMilestone`); a public-API fixture did not fit the time box. **Observation for the DG5 review:** the implementer's own test (`apps/api/test/integration/automation/starters-be-j.test.ts`, the 5-day slip case) asserts `forecastFinishBefore` = `forecastFinishAfter` for every affected dependent. So the stored slip evidence shows **no** dependent forecast movement. ADR-0044 §7 says the moved forecasts "are what the DG4 schedule read returns after the change". Whether the dependent forecasts move by 5 days, as the row literally requires, needs an independent black-box check. |
| **REQ-S12-015** "cut-off creates one draft agenda containing current open asks; it is not published without review" | `A13S`:<ul><li>a meeting with its cut-off reached (default calendar configured through the API), and two open T16 asks raised through the API;</li><li>run-now of `governance.meeting_cutoff_scan` (real worker) gives one `draft` pack whose `openAsks` contain both ask ids, with 2 `draft` agenda items linked to them;</li><li>the scan job re-delivered 3× still gives 1 pack and 2 items;</li><li>publishing a pack item before review gives 422 `agenda_item.pack_not_reviewed`, and the item stays `draft`;</li><li>AUD review gives 403; the chair's review gives `reviewed`; after it, the publish is 200.</li></ul> | Covered. |
| **REQ-S12-020** "killing the worker mid-job and restarting completes the job once; after the retry limit it lands in the failure queue" | <ul><li>`A13D` kill test: a real worker **process** blocks inside the rule's task insert, i.e. inside its transaction (disclosed fault, §5). It is SIGKILLed, and the server ends its sessions (`pg_terminate_backend`, standing in for keepalive / idle-in-transaction timeout). Nothing is committed. The production worker then restarts; there is 1 execution `succeeded`, 1 task, 1 reminder, one `done` per action, and no failure-queue entry.</li><li>`A13D` "bounded retries": the job runs 1 + retryLimit attempts and is dead-lettered (`failed`, `retry_count` = limit); the queue entry appears only during the **last** attempt; code `automation.retries_exhausted`; one rule-execution entry; the completed task is not doubled.</li></ul> | Covered. The QA policy is retryLimit 2 with no delay; the production policy (5 retries, 10 s exponential) is not exercised for time reasons. Findings P-1 and P-2 below. |
| **REQ-S12-021** "replaying the same event three times yields one reminder, one action and one approval task" | `A13D`:<ul><li>the admin rule's event is re-relayed 3× and re-delivered 3× to `automation.evaluate`: 1 execution, 1 task (action), 1 reminder;</li><li>a G1 submission made natively (exceptions accepted, then submitted) yields the Sponsor's approval task (`gate_decision_due`, shown under My Work "approvals"); its `gate.submitted` event is re-relayed 3× and re-delivered 3× to every consumer; the approval tasks, all work items of the transformation and the organization's notifications are unchanged.</li></ul> | Covered. |
| **REQ-S12-022** "the jobs screen shows last success and next run for each scheduled job; a non-admin gets 403" | <ul><li>`A22I` (4 tests):<ul><li>one row per `job_schedule` row; never-run rows show `lastSuccessAt` and `lastOutcome` as null; `nextRunAt` equals an independent computation of the next daily cron instant in Asia/Riyadh;</li><li>after run-now and the worker's run: `lastSuccessAt`, `succeeded`, and the run listed in the job detail;</li><li>disabled: `nextRunAt` null with reason `disabled`, and run-now gives 422 `job.schedule_disabled` (the setting is restored);</li><li>TL, TO, AUD and ADM_METHOD get 403 on the view, the detail and run-now; anonymous gets 401.</li></ul></li><li>`e2e/a22-operations-jobs.spec.ts`: every job row on screen matches the API (Never run / time, next-run instant); run-now shows a recorded last success and "Succeeded"; auditor and lead see the no-permission state; en and ar.</li></ul> | Covered. |
| **REQ-S12-026** "saving a rule with action 'approve gate' is rejected; all automatic preparation and reminder rules run" | `A13D`:<ul><li>every `human_only` type in the catalogue (including `approve_gate`) gives 422 `automation_rule.human_only_action` on create and saves no rule; PATCH of a draft to add `approve_gate` gives 422 and the content is unchanged;</li><li>the 16 starters are all enabled with an effective version; disabling starter 1 gives 422 `automation_rule.guarantee_protected`; starter 1's execution for a new transformation is `succeeded`.</li></ul> | Covered for the rule boundary. "All … run" is evidenced for starter 1 only; the other starters' runs are left to the DG5 review / DG6. |
| **REQ-S18-001** "running the reset twice yields identical record counts and checksums; every demo screen, record and export shows the synthetic label in en and ar" | <ul><li>`A22I`, separately initialized demo database through the **built CLI**:<ul><li>`seed-demo` (MTH_ENV=demo) exits 0, and `GET /environment` returns `{kind: demo, synthetic: true, datasetCode: international_roaming}`;</li><li>`reset-demo` twice: identical `count` lines and checksum in the CLI report, identical `count(*)` of every public table read independently, and checksum = the seed's checksum;</li><li>refusals: seed-demo again exits 3 with "already a demo database; use reset-demo"; bootstrap on demo exits 3; reset-demo with MTH_ENV=production exits 3; reset-demo aimed at the production DB exits 3;</li><li>"discards only demo data": the production database's table counts and max audit id are unchanged.</li></ul></li><li>`A22U`: the en/ar label strings ship (catalogue and report labels).</li></ul> | Counts/checksum clause **covered**. Synthetic label rendered on every demo screen and export, in en and ar: **NOT COVERED** by my e2e, because `with-stack.sh` initializes a dev (non-demo) database. Only the catalogue presence is checked. Left to the DG5 QA review / DG6 (a demo-profile stack). |
| **REQ-S18-003** "after production initialization, a query finds zero demo records and zero demo users; the demo seed command exits with an error in production mode" | `A22I`:<ul><li>`mth-db bootstrap` (built CLI, NODE_ENV/MTH_ENV=production) exits 0;</li><li>`demo_seed_record` = 0, `demo_dataset_run` = 0, no `app_user` in the demo id namespace, exactly 1 user who can sign in (the bootstrap admin), no identity of another issuer, 0 transformations; the marker is `production`; `GET /environment` returns `{kind: production, synthetic: false, …}`;</li><li>`seed-demo` in production mode exits 3 with `mth-db seed-demo: refused: MTH_ENV is production`; on the production-marked DB, exit 3 "initialized for production"; on an unmarked non-empty DB, exit 3 "not empty"; table counts unchanged after each refusal;</li><li>in-app reset on production gives 409 `environment.not_demo`.</li></ul> | Covered. |
| **REQ-S21-001** "a text scan of UI strings and export templates finds no DG0-DG7 references; demo G-approvals display 'Synthetic demonstration - approves nothing real'" | `A22U`:<ul><li>scanner self-test;</li><li>0 hits in every string of the en/ar web catalogues (> 1000 strings), in the string/JSX text of `apps/web/src` (comments excluded), and in `packages/reporting/src` + `apps/worker/src/reports` (export templates);</li><li>the en label ships verbatim and the ar label as in ADR-0050 §2(c).</li></ul> | Literal scan **covered**. The label **rendered** on a demo G-approval is NOT COVERED (it needs a demo stack; DG6). The API-text scan, beyond the row's scope, pins one disclosed hit (P-3). |

**Scope-note jobs not covered by these suites (remaining work):**

- **Export job** retry/restart idempotency: not covered.
- **Day-90 job:** used here only for the disabled-schedule check; duplicate-free re-runs are not covered.
- **Health-check job:** not covered.
- **Cut-off pack scan:** covered (REQ-S12-015).
- **Owner-update tasks job:** run once, through run-now in the e2e.

## 4. Mutation checks

Each mutation was applied in a disposable sparse clone of HEAD under `$TMPDIR` (`mutations/make-clone.sh`, `mutations/run-one.sh`; M1 used `run-mutations.sh`) and then deleted. M6 uses an environment switch. Nothing was changed in this tree.

| ID | Mutation (behaviour broken) | Target test | Result |
|---|---|---|---|
| M1 | `engine.ts` `isLastAttempt`: `retryCount >= retryLimit` changed to `>= 0`. A rule-execution failure is then recorded on the first attempt (no bounded retry). | A13D "bounded retries" (REQ-S12-020) | **Killed**, exit 1: `expected [['completed',1]] to deeply equal [['failed',2]]` (`mutations/m1.log`) |
| M2 | `engine.ts`: the "already done" skip is removed, and `actions/items.ts` gives the work-item dedupe key a timestamp suffix. Completed actions are repeated on retry with fresh effect keys. | A13D "an admin retries it" (REQ-S12-002/021) | **Killed**, exit 1. The symptom is that the retry never resolves (`timed out … the retried failure is resolved`), not a counted duplicate: the mutant breaks the retry path before a second task is visible (`mutations/m2.log`). |
| M3 | `human-only.ts`: `refuseHumanOnlyActions` becomes a no-op. | A13D human-only test (REQ-S12-026) | **Killed**, exit 1: the code became `automation_rule.action_unknown` instead of `automation_rule.human_only_action`. The catalogue layer still refuses the action, so the test pins the specific contract code (`mutations/m3.log`). |
| M4 | `jobs/operations.ts`: `lastSuccessAt` is always `null`. | A22I "after a run" (REQ-S12-022) | **Killed**, exit 1: `timed out … the run is recorded` (`mutations/m4.log`) |
| M5 | Built CLI `packages/db/dist/demo/guard.js`: the `MTH_ENV is production` refusal is removed. | A22I "demo seed command exits with an error in production mode" (REQ-S18-003) | **Killed**, exit 1: `expected [0, ''] to deeply equal [3, …]`. The mutant actually seeded (`mutations/m5.log`). |
| M6 | `QA_TEXT_SCAN_EXTRA_ROOT` adds a catalogue holding `"Release DG7 passed"`. | A22U UI catalogue scan (REQ-S21-001) | **Killed**, exit 1 (`mutations/m6.log`) |

## 5. Disclosed test-environment interventions (never product source)

- **Integration (scratch databases of the run's disposable cluster):**
  - A trigger on `work_item` and `inbox_notification`, installed as the cluster superuser, either raises (`raise`) or waits on an advisory lock the test holds (`block`). It acts only for dedupe keys that match a pattern the test sets (`automation:<rule code>:…`). Removing the pattern "fixes the cause".
  - The queue policy is retryLimit 2 with no delay.
  - Queue expiry is 3 s for `automation.evaluate` and 20 s for the other queues.
  - `pg_terminate_backend` is called on the killed worker's sessions.
  - One direct reset of `outbox_event.published_at = NULL` simulates the relay crash window, as in the DG4 A13 suite.
- **e2e (with-stack.sh disposable database, as its owner through `psql`):**
  - the same `raise` trigger;
  - `automation.evaluate` `retry_limit = 0`, so the failure lands at once instead of after the production backoff (about 5 min);
  - an ADM_METHOD grant for `dev.nobody` made through the API by `dev.admin`.
- **Restored at the end (D-163):** the queue policy (the values read before the change), the trigger, function and table (dropped), the ADM_METHOD grant (revoked through the API), and the synthetic rule (disabled through the API).
- **Not restored:** the failure-queue rows created by the spec, and the demo/run history. These are operational data, not configuration.
  - Seen in the screenshot: the sample transformation's own event reached the live rule too, so each language leaves extra entries (rule-execution and job, from the sample and the failing transformation) in the disposable stack's queue, plus a run of `reports.owner_update_tasks`.

## 6. Product observations and proposed findings

None of these breaks a binding acceptance text as tested. They are proposed for the DG5 reviewers to classify; the orchestrator allocates IDs.

- **P-1 (proposed Low): one failed rule execution creates two open failure-queue entries.**
  - On the last attempt the engine files a `rule_execution` entry (`idempotency_key = execution:<id>`), and the worker's generic job capture files a `job` entry (`queue automation.evaluate`, key = the event key).
  - Evidence: `dev-a13-7-two-entries-diagnostic.log`; on screen in `screenshots/*/a13-failure-queue-*.png`.
  - Repro: an admin rule whose action throws on every attempt, then `GET /api/v1/admin/automation-failures`.
  - Expected: one entry per failed unit of work, or an explicit link between the two. Actual: two independent entries with separate Retry/Dismiss.
  - Mitigation verified: retrying both does **not** duplicate effects, and neither stays open (`A13D` "both queue entries…").
  - Impact: duplicate error alerts and operator confusion (A22 "error alerts").
- **P-2 (proposed Low): the rule-execution entry's `attempts` does not show the bounded retries.**
  - After 3 pg-boss attempts (retryLimit 2, job `failed` with `retry_count` 2), the entry reports `attempts: 1`, and the execution reports `attempt_no: 1`.
  - Evidence: `dev-a13-6-attempts-diagnostic.log`: `{"jobs":[{"state":"failed","retry_count":2,"retry_limit":2}],"failure":{"attempts":1,"errorCode":"automation.retries_exhausted"}}`.
  - Impact: the administrator cannot see from the entry that the retries happened. It is consistent with ADR-0043's execution-attempt model, so this may be by design.
- **P-3 (proposed Low / observation, REQ-S21-001 spirit): the gate-submission snapshot carries a DG0-DG7 text.**
  - `apps/api/src/modules/workflows/gates.ts:981` puts into every gate submission snapshot (`snapshot.note`, returned by the submission reads): "Product gate (business approval inside the product); unrelated to the engineering delivery gates DG0-DG7."
  - It is a disclaimer, not a DG status, and it is not in a UI catalogue or an export template. I did not verify whether any screen or export renders `snapshot.note`.
  - Pinned by `A22U`, so that any new hit fails (`dev-unit-1-api-hit.log`).
- **P-4 (UX observation): failure-queue columns off-screen.** In the failure queue at 1280 px, the Status and Actions columns are only reachable by horizontal scrolling of the table region (`screenshots/ar/a13-failure-queue-resolved.png`).
- **Note (no defect): dry-run samples are schema v1.** A dry run of a `transformation.created` rule refuses the **v2** payload the outbox actually carries (with `launchPlan`): 422 `automation.dry_run_sample_invalid`. The contract (`AutomationDryRunRequest`) requires the schema-version-1 payload, so the product is consistent with it; the builder cannot sample `launchPlan`.

No Critical, High or mandatory-violation defect was found in the scope tested.

## 7. What remains

1. **REQ-S12-012** is NOT COVERED. In particular, check independently that dependent forecasts move after a 5-day slip (see the observation in §3).
2. **REQ-S18-001 / REQ-S21-001 rendered labels** are NOT COVERED: the synthetic banner, badges, demo G-approval label and export label in en and ar, on a demo-initialized stack. `with-stack.sh` only initializes a dev database; a demo-profile e2e harness is a devops/DG6 item.
3. Remaining P5 jobs under A13:
   - export job retry/restart without duplicates;
   - Day-90 job and health-check job re-runs without duplicates;
   - REQ-S12-026's "all … rules run" for the 15 other starters.
4. Production retry policy (5 retries, 10 s exponential) end to end: not exercised, for time reasons.
5. **Merge notes:** only new files, none edited. They depend on `tests/qa/support/{api.ts,with-pg.sh,gates-native.ts,p4.ts}` unchanged. The e2e specs must be run by explicit paths through `apps/web/e2e/support/with-stack.sh`, with `psql` on the PATH. Integration suites use their own scratch databases (`mth_qa_a13f*`, `mth_qa_a13s*`, `mth_qa_a22_*`).
