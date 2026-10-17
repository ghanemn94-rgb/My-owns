# Assignment T-DG5-QA-F2: executable acceptance suites A13 (qa-verifier, authoring)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Kind of task:** **authoring**, not a gate review. You write executable acceptance suites from the acceptance texts and the contract, and run them on the integrated tree before the freeze.
  - Authoring them does not make you the DG5 gate reviewer. The independent DG5 QA review is a separate round, run by a separate session (the T-DG1-QA precedent).
  - p5-plan §5.1 lists this task in slice K.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/qa-f2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Do not run `pnpm install` or `pnpm -r build`; the product tree is read-only to you.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Five W21 tasks run at the same time (T-DG5-ARCH-R1, BE-T4, FE-D4, QA-E2 and QA-F2), each in its own worktree. W1–W20 are merged and verified (D-166). The QA tasks write only tests/qa/** and root e2e/** (each may edit only the existing files its scope names); give new files names that start with your scenario id. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current suite, make it pass or mark exactly what fails, and write the handback listing what remains.

## Files you may write

- `tests/qa/**`: the Vitest `integration` project picks up `tests/qa/integration/**`, and `unit-node` picks up `tests/qa/unit/**`. Reuse `tests/qa/support/{api.ts,with-pg.sh}`. Extend them only by adding new files or new exports.
- root `e2e/**`: acceptance-level Playwright specs. The frontend's own journeys live in `apps/web/e2e/` and are not yours. Start the stack with `apps/web/e2e/support/with-stack.sh`, as those journeys do.
- `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-F2-authoring/**`: your logs and your handback.

**Never** edit `apps/**` or `packages/**` product source, `tools/**`, `.claude/**`, `docs/source/**`, or any delivery record. If a suite exposes a product defect, keep the failing test, report it in the handback with the exact request and response, and do not work around it.

## Deliver: the acceptance suites

Derive every check from the acceptance texts and `docs/api/openapi.yaml`, not from the implementation.
- The scenario texts are master prompt §20 "Acceptance tests and measurable definition of done".
- The binding row texts are in `docs/delivery/requirements.csv`.

1. **A13, Durable automation.** "Retried events, worker restarts and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable"
   - Rows (every DG5 row whose acceptance, increments or notes cite A13; their `acceptance` texts are binding, test each literally): `REQ-S12-001`, `REQ-S12-002`, `REQ-S12-004`, `REQ-S12-012`, `REQ-S12-015`, `REQ-S12-020`, `REQ-S12-021`, `REQ-S12-026`.
   - API suites through the real server and a real PostgreSQL over synthetic data, plus at least one root `e2e/` spec in chromium-en and chromium-ar for the scenario's user-visible path.

**This is a follow-up authoring task (D-165, D-166).** QA-F's handback (`docs/delivery/test-evidence/DG5/qa/T-DG5-QA-F-authoring/handback.md` §7) left these open. Read D-165 and D-166 first.

1. **REQ-S12-012, black-box:** "a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic".
   - Through the public API, build initiatives with dated milestones and a dependency on the critical path (or one whose `needed_by` is breached).
   - Slip the predecessor by 5 days.
   - Assert one `dependency_slip` work item and notification per distinct affected owner, and that the slip's `affected` forecasts follow **Rule B** (D-166, below): a dependent with no slack moves by 5 days, one with enough slack does not move, and one without `planned_start` is Unknown. T-DG5-BE-T4 implements Rule B in this wave, so the test may fail until it merges; report it as such.
2. **The remaining P5 jobs under A13** ("retried events, worker restarts and partial failures do not duplicate approvals, measurements or notifications"):
   - the export job retried and restarted without a duplicate file or job;
   - the Day-90 job and the health-check job re-run without duplicates;
   - REQ-S12-026's "all automatic preparation and reminder rules run": each of the 16 starters runs on its trigger, asserted on its effect rows.
3. **A13's e2e in the shared stack.** In the W19 verification, `e2e/a13-automation-recovery.spec.ts` timed out in both projects, after the earlier root specs' backlog, waiting for its failed execution. It passes alone (`docs/delivery/test-evidence/DG5/orchestrator-D-165/verify-w19-14638e7/e2e-root-a13-alone.log`).
   - Make it robust in the shared stack, for example by waiting on its own rule's execution, not a drained queue, and with bounds that allow the backlog. Keep every assertion and every restore.
   - Binding result: the ten root specs pass in one `with-stack.sh` stack, in file order, en then ar, `--workers=1`. Report that run.
   - You may edit `e2e/a13-automation-recovery.spec.ts`, `e2e/a22-operations-jobs.spec.ts` and `e2e/support/a13-a22-stack.ts`.

**Notes:**
- In this sandbox `node_modules` is read-only, so run Vitest with `--configLoader runner`.
- Run root e2e specs by explicit paths, never with the bare `e2e` filter.
- Restore any global configuration your specs publish (D-163).
- Extend existing suites only by adding new files, apart from the three named above.

**Rule A, decided by D-166 (the intake adopts the transformation it produced; BE-T3 handback §3.3 option (a)).**
- When the `capture_intake` step of an organization-scope `new_transformation_intake` instance is completed with `outputRecordId` = T (a transformation), every step of the same instance that has not started gets `transformation_id = T` in the same transaction.
- This is the only change of `procedure_step_instance.transformation_id` ever allowed: from NULL to T, once; for a step that has not started; of an instance whose own `transformation_id` is NULL; and only to the transformation named by that instance's `capture_intake` output link. Repair migration `0096` narrows the P2 identity guard of `procedure_step_instance` to exactly this transition. Every other change stays refused.
- Each adopted step takes the P2 version step and one audit event.
- The instance keeps its launch scope (organization).
- Approvals of the adopted steps are requested on T and routed by T's role mappings (DG4 `resolveParty`, never a fallback). Until T has a mapped Sponsor, `confirm_sponsor` keeps today's truthful "awaiting routing" next action.

**Rule B, decided by D-166 (REQ-S12-012 "moves dependent forecasts per the logic"; M0232 "recompute forecast impacts using defined scheduling logic"; ADR-0044 §7).**
- `forwardFinish(S, set)` for an initiative S over a milestone set:
  - `own = predecessorFinish(S, set)` (ADR-0023 §5, unchanged);
  - if S has no scheduled finish-to-start predecessor, it is `own`;
  - otherwise `required` is the latest, over S's scheduled predecessors P, of the first date ADR-0023 §5 allows S to start after `forwardFinish(P, set)`;
  - `shift = max(0, required − S.planned_start)` in calendar days;
  - the result is `own + shift`.
- If S has a scheduled predecessor but no `planned_start`, or any input date is missing, the result is Unknown (`null`), never 0 or the unshifted date.
- Cycles cannot occur, because DG4 refuses dependency cycles.
- A slip's `affected` entries record `forecastFinishBefore = forwardFinish(S, before set)` and `forecastFinishAfter = forwardFinish(S, after set)`, for every initiative reachable from the slipped predecessor. The sets differ only in the slipped predecessor's milestone.
- Nothing is stored or overwritten except the slip's own `affected` evidence (ADR-0044 §7). A dependent with enough slack does not move; one with no slack moves by the slip.

**Load (D-164).** Run heavy commands one at a time, and never the repository-wide `pnpm test` or `pnpm test:integration`. Those run once on the merged tree in the orchestrator's verification.
## Rules

- **Real behaviour:** assert status codes, problem codes, database state, rendered `dir`/`lang` and values. Never assert implementation details.
- **Determinism:** tests must be deterministic and run offline. Use synthetic data only, with fixed dates and no random collisions. A missing tool or credential makes a check BLOCKED, never a silent pass.
- **Decimal strings:** compare amounts as decimal strings, never floats.
- **Gates:** product gates G1–G6 are business approvals inside the product; an approval in a fixture is a synthetic in-product approval of test data. No agent grants a real business, Finance or IT approval. Never name a DG0–DG7 engineering gate in product text.
- **Ports:** your harness ports are **23650–23699** only. Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline. Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); never run `playwright install`.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **Load:** other agents run at the same time. If an e2e step hits the 30 s timeout, re-run that spec alone and report both runs. Never raise a timeout to hide a failure.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.

## Acceptance (real output in the handback)

1. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm vitest run --project integration tests/qa` passes. Report the counts per file.
2. Your root `e2e/` specs pass in chromium-en and chromium-ar on the real stack (`--workers=1`), with axe reporting 0 serious or critical issues.
3. `pnpm lint` and `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exit 0 on your files.
4. **A requirement → test table.** For each row named above, give the test that proves it, or `NOT COVERED` with the reason.
5. **Mutation checks:** for at least five central assertions (one per scenario at minimum), show that the test fails when the asserted behaviour is broken. Use a temporary copy in `$TMPDIR` or an environment switch, and never edit product source in this tree. Keep the logs.
6. `node tools/gates/validate.mjs --historical --stage DG4` exits 0, at the start and at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-F2-authoring/handback.md`, with your logs beside it. Include the files you wrote, the checks with exit codes and counts, the requirement → test table, the mutation checks, every product defect found (exact request and response), and what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
