# Handback T-DG5-QA-F2: executable acceptance suites A13, follow-up (qa-verifier, authoring)

- **Stage:** DG5 (P5). This is an authoring task (p5-plan §5.1, slice K), not the DG5 gate review.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-QA-F2-qa-verifier-20261017T140421Z-ffd9921e","session_id":"ffd9921e-aec3-4c26-921b-2e147ab73326"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-QA-F2.md`, sha256 `3fc05e69…8f38793` (verified).
- **Tree:** worktree `dg5/qa-f2`, HEAD `6f8ce12a34038946d0b01dd5685a4cc2a7fb12d7`, unchanged at the start and at the end.
- **Changes:** all uncommitted, as asked.
  - No file under `apps/**`, `packages/**`, `tools/**`, `.claude/**`, `docs/source/**` or any delivery record was modified.
  - `git status` shows only my files listed in §1, plus an untracked `CLAUDE.local.md` that I did not create or touch.
- **Time:** `date -u` was 14:04:39 at the start and 15:08 at the end of the checks (about 65 minutes).
- **Data:** all synthetic.
  - Every rule review, gate approval and ask in the fixtures is a synthetic in-product action on test data.
  - No agent granted a business, Finance or IT approval, and no DG0–DG7 gate is named in product text.

## 1. Files written

| File | Purpose |
|---|---|
| `tests/qa/support/a13-replay.ts` (new) | F2 helpers:<ul><li>drain waits per event and per queue;</li><li>the relay envelope of an outbox row;</li><li>`replayEvent` (relay re-send plus re-delivery to every consuming queue, ×N);</li><li>outbox lookup by payload member;</li><li>calendar-day arithmetic.</li></ul> |
| `tests/qa/integration/a13-dependency-slip-rule-b.test.ts` (new) | REQ-S12-012 black-box under Rule B (D-166), 8 tests. |
| `tests/qa/integration/a13-jobs-rerun.test.ts` (new) | The remaining A13 jobs, 5 tests:<ul><li>the export job (Idempotency-Key, SIGKILL mid-job plus restart, replay ×3);</li><li>the Day-90 job (run-now, re-delivery ×3, re-run after a worker restart);</li><li>the health check (retried and concurrent submit; no health-check job exists, see §3).</li></ul> |
| `tests/qa/integration/a13-starters-run.test.ts` (new) | REQ-S12-026 "all automatic preparation and reminder rules run", 11 tests. Twelve of the sixteen starters run on their own triggers, asserted on execution and effect rows. |
| `e2e/a13-automation-recovery.spec.ts` (edited, allowed) | Made robust in the shared stack.<ul><li>Every wait that depends on the worker is now on **this spec's own** outbox event, its `automation.evaluate` job and its failure entry, never a drained queue.</li><li>Waits are bounded at 240 s to allow the earlier specs' backlog, and the time each wait took is logged.</li><li>Every assertion and every restore (D-163) is unchanged.</li></ul> |
| `e2e/support/a13-a22-stack.ts` (edited, allowed) | `poll` takes an optional diagnostic. New helpers: `eventJobs` (relay and job state of one event) and `backlog` (diagnostics only). |
| `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-F2-authoring/**` | This handback, the logs, the screenshots of the binding root run, and the mutation scripts and logs. |

`e2e/a22-operations-jobs.spec.ts` was not changed: it passed in both projects of the binding run.

## 2. Checks run (real exit codes)

All runs used Node 24.21.0, offline, on harness ports 23650–23699 only.
- Empty `.cc-writes` folders were removed before each run (none were found).
- Before each full run, `df -h .` showed 7.9 G free on the tree (tmpfs) and `$TMPDIR` had 4.9 G free.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | exit 0, `PASS gate DG4 (historical)` | `validate-dg4-start.log` |
| 2a | Ten root specs, one stack, in file order, en then ar, `--workers=1`: `E2E_PG_PORT=23660 E2E_API_PORT=23661 MTH_PORT_POOL=23662-23699 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a03… e2e/a04… e2e/a06… e2e/a07… e2e/a08-a09… e2e/a13… e2e/a15… e2e/a16… e2e/a20… e2e/a22… --workers=1` (run 1) | **exit 1**: 24 passed, 4 failed, 2 did not run. **A13 passed in both projects.** The failures are environmental (§2.1). | `e2e-root-ten-run1.log` |
| 2b | **Binding run.** Same command with `E2E_SCREENSHOT_DIR=$TMPDIR/web-shots` | **exit 0: 30 passed (7.9 min)**, all ten specs in en and ar. A13 axe: 0 serious or critical issues on both of its screens, in both languages. | `e2e-root-ten-run2.log`, `screenshots/{en,ar}/a13-*.png` |
| 3 | `QA_PG_PORT=23650 MTH_PORT_POOL=23651-23699 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | **exit 1**: 28/31 files and 330/336 tests passed, 497.6 s. All 6 failures are intended (§2.1). | `full-integration-run1.log` |
| 4 | `pnpm lint` | exit 0 | `pnpm-lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `prettier-check-all.log` |
| 6 | `pnpm typecheck` | exit 0. It covers only the packages' tsconfigs; the root `tests/qa` and `e2e` files belong to no tsconfig, and Vitest/Playwright transpile them. | `pnpm-typecheck.log` |
| 7 | Mutation checks M1–M5 and fix probe P1 (§5) | All 5 mutants killed (exit 1 on the targeted test). P1 makes the notification test pass. | `mutations/*.log` |
| 8 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | exit 0, `PASS gate DG4 (historical)` | `validate-dg4-end.log` |

**Per-file counts in run 3.**
- Mine:
  - `a13-dependency-slip-rule-b` 5/8 (3 intended failures)
  - `a13-jobs-rerun` 4/5 (1 intended failure)
  - `a13-starters-run` 11/11
- Existing files:
  - a02-a21 11/13 (2 known failures, D-166), a03 12, a04-kpi 8, a04-a05-a10 4, a05 17, a06 27, a07 12, a08 31, a09 17, a10 16
  - a11-bau 17, a11-adoption 12, a11-value-closure 11, a12 14, a13-durable 12, a13-starter-jobs 4, a13-job-idempotency 5, a14 5
  - a15-snapshots 15, a15-outputs-every-definition 5, a15-demo 7, a15-selected 7, a16-health-check 13, a16-launch-plan 11, a16-s16-021 6
  - a22 8, a01 2, a02-a08 1

### 2.1 Every non-zero exit and failure, explained

- **Root run 1 (exit 1): A06 ×2 and A07 ×2 failed for an environmental reason, not the product.**
  - Their shared helper `apps/web/e2e/support/ui.ts:89` writes screenshots to `apps/web/e2e/screenshots/`, which is read-only in my sandbox: `ENOENT: no such file or directory, mkdir '…/apps/web/e2e/screenshots/en'`.
  - A06-ar then failed with `toHaveURL` because A06-en had stopped half-way, and A06's second test did not run in either project.
  - The helper honours `E2E_SCREENSHOT_DIR`, so run 2 set it to `$TMPDIR/web-shots`, and all 30 tests passed. The orchestrator's stack has a writable `apps/`, so it does not need this variable.
- **Integration run 3 (exit 1): 6 intended failures.**
  - **2 × a02-a21** (`:867` pins BO, which `0095` changes to TL; and the organization-scope intake has no Sponsor approval until Rule A). Both are already known in D-166, they are QA-E's tests, and QA-E2 and BE-T4 own them in this wave.
  - **2 × my Rule B tests** (no-slack dependents and the Unknown dependent): Rule B is not on this HEAD. BE-T4 implements it in this wave (§4, D-QA-F2-2).
  - **1 × my REQ-S12-012 notification test:** a product defect (§4, D-QA-F2-1, proposed High).
  - **1 × my export kill/restart test:** the orphan file (§4, D-QA-F2-3, proposed Low).
- **Development iterations** (`dev-*.log`): each failure there was fixed in the test or diagnosed as a defect.
  - `dev-b-1..4`: the slip notification timed out. I added diagnostics, which showed the relay refusing `dependency.slipped`: the defect, not a test bug.
  - `dev-j-1`: my expiry setting was on the queue, and the worker re-applies its queue policy when it starts. It is now set on the killed job's row.
  - `dev-r-1`: my `since` window caught a starter's first scheduled trigger when its second one ran. Executions are now filtered by trigger code.
  - `dev-r-3`: my bookkeeping list was stale after adding the gate starters.
- **Mutation P1, first attempt** (`mutations/p1-void-packages-not-loaded.log`): void.
  - The probe edited `packages/shared` in the disposable clone, but pnpm's `node_modules` links resolve `@mth/shared` to the source tree's package, so the edit was never loaded.
  - The probe was moved to the relay's own lookup in `apps/worker/src/relay.ts` (in the clone) and re-run (`p1.log`).

### 2.2 A13 e2e in the shared stack (D-165 item 3)

- **Cause of the W19/W20 timeout.** The spec's own production worker starts after the eight earlier specs and must first relay and work off their backlog. This spec's own event then took **63.6 s (en) and 98.9 s (ar)** to be relayed and evaluated (the `[a13]` lines in `e2e-root-ten-run2.log`; 33.2 s and 27.1 s in run 1). The old single 60 s poll for the failed execution could not cover that.
- **Changes.**
  - The spec now waits on its own outbox row being published and on its own `automation.evaluate` job reaching `completed`/`failed`, bounded at 240 s and with diagnostics.
  - The execution and failure-entry polls keep 60 s, and each took 0.0 s once the event had been evaluated.
  - The retry-resolution wait is bounded at 240 s and took 1.0–2.2 s.
  - The test timeout is 3 × 240 s + 120 s. No assertion was removed or weakened, and every D-163 restore is unchanged.
- **Observation for the review (not a defect).** About 100 s for a freshly started worker to drain the backlog of a 10-spec stack is the order of magnitude to expect on recovery after a worker outage.

## 3. Requirement → test

Abbreviations:
- `RB` = `tests/qa/integration/a13-dependency-slip-rule-b.test.ts`
- `JR` = `tests/qa/integration/a13-jobs-rerun.test.ts`
- `SR` = `tests/qa/integration/a13-starters-run.test.ts`
- QA-F's existing files: `A13D` = `a13-durable-automation.test.ts`, `A13S` = `a13-starter-jobs.test.ts`
- `E2E` = `e2e/a13-automation-recovery.spec.ts`

| Requirement (binding acceptance) | Proved by | Status |
|---|---|---|
| **REQ-S12-001** "each execution is recorded with rule version, trigger event and outcome" | <ul><li>`A13D` (admin rules).</li><li>`SR`: for 12 starters, one `automation_execution` of the starter's **effective** version per trigger, with its `trigger_code`, status `succeeded`, and one action result whose outcome is `done`/`existing`/`skipped`.</li><li>`RB`: starter 9's execution for the slip's trigger key (it cannot run until D-QA-F2-1 is fixed; proven with P1).</li></ul> | Covered for 12 of 16 starters plus admin rules. |
| **REQ-S12-002** "a dry-run creates no tasks; a failed execution appears in the queue and succeeds on retry without duplicating actions" | <ul><li>`A13D` (QA-F).</li><li>`E2E`, now passing in the shared root stack: en and ar, `lang`/`dir`, axe 0 serious or critical; after the on-screen retry, 1 task, 1 reminder and 1 succeeded execution.</li></ul> | Covered. |
| **REQ-S12-004** "one transformation → one set of phase checklists and role tasks; a retry creates no duplicates; with the plan flag the 90-day tasks are dated from the start date" | <ul><li>`A13S` (QA-F).</li><li>`SR` starter 1: one execution, phase steps and role tasks exist.</li><li>`JR` Day-90 job: a plan from 2026-01-01; one `day_ninety_test_due` item per holder, unchanged by 3 re-deliveries and by a re-run after a worker restart; the Lead sees exactly one in `GET /me/work-items`.</li></ul> | Covered. |
| **REQ-S12-012** "a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic" | `RB`, fully through the public API:<ul><li>5 initiatives with owners, planned dates and dated milestones; T08 dependencies P→S1 (needed by 2041-04-03), S1→S2, S1→S3, S1→S4. `PATCH /milestones/{id}` moves P from 2041-04-01 to 2041-04-06.</li><li>Asserted:<ul><li>one slip, 5 days, `needed_by_breached`;</li><li>`affected` = S1..S4 with owners O2, O2, O3, O3, and P itself is not listed;</li><li>**Rule B**: S1 05-01→05-06 and S2 06-01→06-06 (no slack, moved by 5, directly and transitively); S3 06-10→06-10 (slack); S4 null→null (no `planned_start`);</li><li>O2 and O3 each get **one** `dependency_slip` item in My Work plus **one** inbox reminder, also after 3 replays, and the predecessor's owner gets none;</li><li>starter 9 records one succeeded execution;</li><li>stored milestones are not overwritten;</li><li>AUD can read the slips, and another organization's TL is refused.</li></ul></li></ul> | **Written, and failing on this HEAD for two reasons:**<ol><li>The notification never happens: **D-QA-F2-1** (High). P1 proves the test passes once that is fixed, and M1 proves it detects a per-initiative duplicate.</li><li>Rule B (S1, S2 and S4) awaits **BE-T4**. The slack case passes, and M2 proves the test detects "every dependent moves".</li></ol> |
| **REQ-S12-015** "cut-off creates one draft agenda containing current open asks; it is not published without review" | <ul><li>`A13S` (QA-F).</li><li>`SR`: starter 12 runs once on run-now of `governance.meeting_cutoff_scan`.</li></ul> | Covered. |
| **REQ-S12-020** "killing the worker mid-job and restarting completes the job once; after the retry limit it lands in the failure queue" | <ul><li>`A13D` (rule jobs).</li><li>`JR` export job: a real worker **process** blocked inside the success transaction (file stored, success not committed) is SIGKILLed and its sessions are ended. After restart there is 1 `export_job`, `succeeded`, and the download's SHA-256 equals `fileSha256`.</li><li>`SR` starter 16: a job that exhausts its retries gives **one** visible `job` entry in the failure queue, and `starter.job_failed` runs once.</li></ul> | The job-once clause is covered. **"Without a duplicate file" fails:** the killed attempt's file is left in the store (D-QA-F2-3, Low). |
| **REQ-S12-021** "replaying the same event three times yields one reminder, one action and one approval task" | <ul><li>`A13D` (QA-F).</li><li>`RB`: `dependency.slipped` replayed 3× (passes under P1).</li><li>`JR`: `export_job.requested` replayed 3× leaves the job body unchanged, adds no file, and keeps 1 job.</li><li>`JR`: the Day-90 job re-delivered 3×.</li><li>`SR`: starters 5–7 give one approval task for the Sponsor (`gate_decision_due`).</li></ul> | Covered (the slip replay depends on D-QA-F2-1). |
| **REQ-S12-026** "saving a rule with action 'approve gate' is rejected; all automatic preparation and reminder rules run" | <ul><li>`A13D` (the rejection).</li><li>`SR`: the catalogue has exactly 16 starters, all enabled and published. Each starter below runs once on its own trigger, as a succeeded execution of its effective version, with effect rows where its trigger has effects:<ul><li>**1** transformation created: phase steps and role tasks;</li><li>**2** reporting period;</li><li>**3** KPI actual accepted through the API: the worker's one recalculation run;</li><li>**5, 6, 7** native G1 submission and Sponsor approval: one Sponsor approval task;</li><li>**8** both SLA scans;</li><li>**10** blocker scan;</li><li>**11** benefit evidence submitted through the API: one Finance validation item;</li><li>**12** cut-off scan;</li><li>**14** both sustainment scans;</li><li>**16** job failed: one visible failure entry.</li></ul></li></ul> | **12 of 16 covered.** **NOT COVERED:**<ul><li>starter **4** (KPI deviation flow);</li><li>starter **13** (adoption/control check failed);</li><li>starter **15** (methodology revision proposed);</li><li>starter **14**'s request trigger `bau_handover.accept_requested` (only its scheduled triggers ran).</li></ul>Starter **9** is written in `RB` and blocked by D-QA-F2-1. The scans ran on a world without due records, so they assert the execution and outcome, not domain rows. |

**The remaining A13 jobs (assignment item 2).**
- **Export job:** retried and restarted with no duplicate job, but with an **orphan file** (D-QA-F2-3).
- **Day-90 job:** re-runs create no duplicates.
- **Health-check job:** ADR-0048 §8 defines **no** health-check job; `launch.day_ninety_tests` is the only job of that ADR, and the worker has no health queue.
  - Its A13 analogue is tested instead, in `JR`: two concurrent submits give one 200 and one 409/422; a replayed submit is refused; there is one assessment with score 17 and band 16-20; there are 3 action rows.
  - If the assignment means a different job, that job does not exist on this HEAD.

## 4. Product defects found (exact request and response)

**D-QA-F2-1 (proposed High, mandatory violation proposed: REQ-S12-012 broken end to end).** The outbox relay never publishes `dependency.slipped`, so starter 9 never runs and no affected owner is ever notified.

- **Repro** (`RB`, 2041 synthetic dates):
  1. `PATCH /api/v1/milestones/{P's milestone}`, `If-Match: "<version>"`, body `{"forecastDate":"2041-04-06"}` → **200**, `forecastDate: "2041-04-06"`.
  2. `GET /api/v1/transformations/{t}/dependency-slips` → **200**, one item: `slipDays 5`, `criticalReason "needed_by_breached"`, `predecessorFinishBefore "2041-04-01"`, `predecessorFinishAfter "2041-04-06"`.
  3. The `outbox_event` row `dependency.slipped` has `published_at NULL`, `publish_attempts 10` and `last_error "no schema for dependency.slipped v1"`.
  4. No pgboss job exists, and after 60 s neither O2 nor O3 has a `dependency_slip` work item. Evidence: `dev-b-4.log` and `full-integration-run1.log`, test "each distinct affected owner is notified ONCE".
- **Cause:**
  - `apps/worker/src/relay.ts` calls `outboxPayloadSchema(event_type, version)` and refuses a type that is not registered.
  - `packages/shared/src/schemas/events.ts:45–49` defines `dependencySlippedV1` but leaves it out of `OUTBOX_EVENT_SCHEMAS` on purpose ("deliberately NOT in OUTBOX_EVENT_SCHEMAS yet … dry run", BE-J handback §5).
  - BE-J's own test calls the handler directly, which bypasses the relay.
  - Side effect: until its 10 attempts are spent, each relay round ends at this row (`relayOnce`), so it also delays every later event.
- **Proof that this is the only cause:** fix probe **P1** registers the schema at the relay's lookup (disposable clone only). The notification test then **passes**: one task and one reminder for O2 and for O3, unchanged after 3 replays, and one succeeded execution of starter 9 (`mutations/p1.log`).

**D-QA-F2-2 (pending BE-T4; not a new finding).** Rule B is not on this HEAD: `affected` uses `predecessorFinish` only.
- S1 is `["2041-05-01","2041-05-01"]` where `["2041-05-01","2041-05-06"]` is expected.
- S4 (no `planned_start`) is `["2041-06-15","2041-06-15"]` where `[null,null]` is expected.
- The slack case already passes.
- Reading used: "the first date ADR-0023 §5 allows S to start after forwardFinish(P)". §5 flags only `planned_start < predecessor finish`, so S may start **on** that date, and the expected values above follow from that. If BE-T4 reads it as "the next day", both values shift by 1 day; the test also asserts a 5-day movement independently (`daysBetween`). The architect should settle this reading.

**D-QA-F2-3 (proposed Low, no mandatory violation): an export attempt killed after storing its file leaves an orphan file in the store.**
- The storage key is per attempt (`export-runner.ts`: `exportStorageKey(org, \`${job.id}-a${attempt_count}\`)`). The killed attempt's `…-a1.pdf` stays, and the retry writes `…-a2.pdf`.
- The job references only `-a2`, the download is correct, and there is no duplicate job. The store holds 2 files for 1 job, and nothing removes the orphan.
- Evidence: `dev-j-2.log` and `full-integration-run1.log`, the "files the job left in the store" assertion.
- Repro: `POST /api/v1/exports` with `Idempotency-Key`, body `{"report":{"definitionCode":"charter","subjectId":"<t>"},"format":"pdf","language":"en"}` → 202. Kill the worker after `store.put` and before the success commit, then restart it → 2 files under `exports/<org>/`.
- Impact: storage growth on every crash, plus an unreferenced copy of report content. Users see no duplicate.

No other defect was found in the scope tested.

## 5. Mutation checks (disposable clones under `$TMPDIR`, deleted after each run; this tree untouched)

Scripts: `mutations/make-clone.sh` and `mutations/run-one.sh`. Each log starts with the clone's diff.

| ID | Mutation (behaviour broken) | Target | Result |
|---|---|---|---|
| P1 (probe, not a mutant) | Register `dependency.slipped` at the relay's lookup | `RB` notification | The notification test **passes**: D-QA-F2-1 is the only cause (`p1.log`) |
| M1 | P1 plus `portfolio.ts` notifying once per **affected initiative**, with a fresh dedupe key each time | `RB` "each distinct affected owner is notified ONCE" | **Killed**: `O2 (S1, S2) has one dependency_slip task: expected 2 to be 1` (`m1.log`) |
| M2 | `slip-events.ts`: every dependent's `forecastFinishAfter` = before + 5 | `RB` "a dependent with enough slack does not move" (passes on HEAD) | **Killed**: `expected ['2041-06-10','2041-06-15'] to deeply equal ['2041-06-10','2041-06-10']` (`m2.log`) |
| M3 | `exports/jobs.ts`: the request's Idempotency-Key is not remembered | `JR` "the same Idempotency-Key returns the existing job (200)" | **Killed**: the second POST answered 202 with a new job (`m3.log`) |
| M4 | `handlers/launch.ts`: the Day-90 dedupe key gets a timestamp | `JR` Day-90 | **Killed**: `three re-deliveries add nothing: expected [ …(4) ] to deeply equal [ Array(1) ]` (`m4.log`) |
| M5 | `starters.ts`: `governance.blocker_escalation_scan` is mapped to the wrong starter | `SR` starter.blocker_red | **Killed**: `timed out … waiting for an execution of starter.blocker_red; executions []` (`m5.log`) |

The e2e spec's assertions are QA-F's and unchanged (its own mutation evidence is QA-F's); I did not mutate it.

## 6. Disclosed test-environment interventions (never product source)

All in the scratch databases of the run's disposable cluster:
- **`JR` export trigger:** a `BEFORE UPDATE` trigger on `export_job` makes the `running`→`succeeded` update wait on an advisory lock the test holds. It is dropped in `finally`.
- **`JR` killed job's expiry:** `expire_seconds = 20` on the killed job's pgboss row, instead of the queue's 900 s.
- **`JR` session cleanup:** `pg_terminate_backend` on the killed worker's sessions.
- **`SR` fault:** QA-F's `raise` fault on `role_assignment:%` work items for starter 16's failing job, cleared in `finally`.
- **Replays:** `published_at = NULL` resets, the relay crash window, as in QA-F and DG4 A13.
- **E2E:** QA-F's interventions, unchanged and restored.

## 7. What remains

1. **D-QA-F2-1** (relay schema for `dependency.slipped`) must be fixed before REQ-S12-012 can pass. The test is ready, and P1 shows it passes once the schema is registered.
2. **Rule B** (BE-T4): after it merges, re-run `RB`. If BE-T4 reads ADR-0023 §5's start rule as "the day after", the architect settles the reading (§4 D-QA-F2-2).
3. **D-QA-F2-3** (orphan export file): the DG5 review classifies it.
4. Starters **4, 13, 15**, and starter **14**'s accept-request trigger, are NOT COVERED by an on-trigger run. The scheduled starters' runs were asserted on a world without due records (execution and outcome only).
5. **Merge notes:**
   - The only shared-file edits are in `e2e/a13-automation-recovery.spec.ts` and `e2e/support/a13-a22-stack.ts`, both additive.
   - The new integration files use their own scratch databases (`mth_qa_a13b*`, `mth_qa_a13j*`, `mth_qa_a13r*`).
   - Run the root e2e by explicit paths. In a sandbox whose `apps/` is read-only, set `E2E_SCREENSHOT_DIR` for A06 and A07.
