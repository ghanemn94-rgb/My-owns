# DG7 round 5: qa-verifier narrative

- **Task:** T-DG7-REV-QA-R5
- **Session:** f4c61bca-0439-49d8-b5b0-06f48cd84441
- **Candidate:** `sha256:07af9fba26f9ae435f6f3de7ca5204ed1e182a125f1fd0f912b70da06035a61d` (source `02aeed6e`, 3155 files)
- **Verdict: FAIL.** One new Medium finding, F-DG7-971 (A18 drill result depends on the wall clock). F-DG7-922, 941 and 970 are verified closed.

## What changed since round 4

The round-4 and round-5 manifests differ in one file, `docs/delivery/decisions.md`, which gained the D-277 row. `candidate.mjs --diff` ignores a path argument and always compares with the current stage manifest, so I compared the two manifests directly. Outside the candidate, only `stages.json`, `findings.json` and `progress.md` changed, plus the round-4 assignments, manifest and records. Product code, tests and handover texts are unchanged (`git diff 471072d6 02aeed6e` over apps, packages, deploy, tools, tests, e2e, licenses, scripts and docs/handover|architecture|api is empty).

## F-DG7-922 / 941 / 970 (stages.json transition): closed

The DG7 history is now legal and its timestamps increase strictly. Each round pairs with a REVIEWING entry, followed by FIXING once the round is finished. A revert-to-fail probe brings back `DG7 illegal transition REVIEWING -> REVIEWING`.

Validator results:

- `--historical` DG6…DG1, `--reconcile`, `--pipeline` and `--register DG7` all pass.
- `--stage DG7` reports only the missing gate record, which is expected before the release audit.

I accept the late-recorded entry:

- it is appended, not a history rewrite;
- its note says it was recorded late and why;
- its time is the real commit time of the round-3 findings import (5458273cd, 01:38:50Z);
- D-277 records the outcome.

## F-DG7-971 (new, Medium): A18 D9 fails on a quarter hour

**What I saw.** In my first A18 run the direct drill passed. The shipped harness on the same archive then failed 4 of 10 tests. Its D9 restart landed just after 07:15Z, and the mode 2 recheck found one unexplained `automation_execution` and its `automation_action_result`. Only that run's worker ran `approval.escalation_scan` after the restart.

**Cause.** That queue is the schedule-triggered starter `starter.decision_sla` (`*/15`, Asia/Riyadh). ADR-0064 A3.9 residual 1 keeps schedule-triggered rows unexplained by design and says "the orchestrator decides". No decision was ever recorded, because DO-D4 never hit the case.

**Reproduction.** I reproduced it on demand on the unmodified candidate by timing `transfer-drill.sh --keep` across 08:00Z. D9 failed. The kept target database holds exactly the one execution, with key `approval.escalation_scan:2026-11-16T08:00`, plus its starter result. The other runs passed: the harness re-run at 07:20, and a reproduction attempt that missed 07:45 by 3 s.

**Effect.**

- The A18 acceptance drill gives FAIL on about 5–7 % of runs, on time of day alone.
- The product's records, jobs and approvals are correct in every run.
- The residual is not disclosed in `known-limitations.md`, the release notes, `deployment.md`, or the A18 register rows.

**Severity.** Medium per D-192: a real, bounded defect in the acceptance drill. It is not mandatory, because no data or access is wrong. The owner is solution-architect, because the decision belongs to A3.9. The ADR forbids pausing or rescheduling the job to dodge it.

## Product checks re-run on this candidate (all in a disposable shared clone at 02aeed6e)

**Static checks.** Build, typecheck, lint, openapi-lint, no-cdn and prettier all exit 0.

**Unit.** The first attempt hit EROFS: Vite writes into `node_modules/.vite-temp`, and I had symlinked a read-only `node_modules`. I fixed this with a writable shim and re-ran. Results:

- unit-node 3036/3036 plus one file re-run 6/6. That file had failed with ENOENT because my sparse clone first omitted `docs/delivery/handbacks`; I restored them.
- unit-web 2199/2199.
- nocodegen 259 passed, 2 skipped by design.

**Other suites:**

| Suite | Result |
|---|---|
| Integration | 475 files; 4696 passed, 8 skipped, 1 todo (same as round 4) |
| Tool suites | 66 / 39 / 29 / 189 / 466 (464 passed + 2 explained skips) |
| Release tools and check-handover | PASS |
| Protocol audit | Same counts as round 4: C2 27, C3 7, C5 1 |
| A19 restore drill | R1–R9 PASS |
| Offline drill | 10/10 specs, 293 connection-log lines, all loopback |
| Root acceptance | 288 passed, 18 designed axe skips; connection log loopback only |
| Product e2e | en 286 passed + 1 skipped; ar and keyboard as recorded in the JSON |
| A27 K11 | Re-drill at 02aeed6e PASS |

I could not reach the Docker daemon (permission denied). The container half is judged on the orchestrator's host-run 3b/3c evidence, whose server surface is unchanged since then; I did not run it myself.

## Assignment note

The assignment asks for `round: 7`. The validator (`rules.mjs` l.682 and l.794) requires the record's `round` to equal the round directory, here 5, so I wrote `round: 5`. I did not raise this as a finding: the assignment is write-once and the validator enforces the right value.
