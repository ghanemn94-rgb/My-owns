# Assignment T-DG4-QA-C: executable acceptance suites A11 and A03, and the REQ-DLV-036 evidence run (qa-verifier, authoring)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Kind of task:** **authoring**, not a gate review. You write executable acceptance suites from the acceptance texts and the contract, and run them on the integrated tree before the freeze.
  - Authoring them does not make you the DG4 gate reviewer. The independent DG4 QA review is a separate round, run by a separate session (the T-DG1-QA precedent).
  - p4-plan §5.1 lists this task as QA-C, slice L.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/qa-c`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Do not run `pnpm install` or `pnpm -r build`; the product tree is read-only to you.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-R4, T-DG4-KBE-R4, T-DG4-QA-C and T-DG4-FE-R2 run in their own worktrees; none owns your files. Everything through W17 (ARCH-R3, FE-F2, FE-G2, QA-B) is merged (D-090 to D-114). QA-A's suites (A04, A05, A10) and QA-B's (A08, A09) are in `tests/qa/**` and `e2e/**`; reuse their support files, and add your own files beside them.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current suite, make it pass or mark exactly what fails, and write the handback listing what remains.

## Files you may write

- `tests/qa/**`: the Vitest `integration` project picks up `tests/qa/integration/**`, and `unit-node` picks up `tests/qa/unit/**`. Reuse `tests/qa/support/{api.ts,with-pg.sh}`. Extend them only by adding new files or new exports.
- root `e2e/**`: acceptance-level Playwright specs. The frontend's own journeys live in `apps/web/e2e/` and are not yours. Start the stack with `apps/web/e2e/support/with-stack.sh`, as those journeys do.
- `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-C-authoring/**`: your logs and your handback.

**Never** edit `apps/**` or `packages/**` product source, `tools/**`, `.claude/**`, `docs/source/**`, or any delivery record. If a suite exposes a product defect, keep the failing test, report it in the handback with the exact request and response, and do not work around it.

## Deliver: the acceptance suites

Derive every check from the acceptance texts and `docs/api/openapi.yaml`, not from the implementation.
- The scenario texts are master prompt §20 "Acceptance tests and measurable definition of done", rows `A11` and `A03`.
- The binding row texts are in `docs/delivery/requirements.csv`: every DG4 row whose `acceptance` cites the scenario.

1. **A11, adoption and sustainment.** "Poor adoption triggers intervention; delivery completion alone does not close value realization; accepted handover creates recurring BAU tasks."
   - API suites through the real server, a real PostgreSQL and the worker's exported job functions. Cover, each against its row text:
     - REQ-PB-069, REQ-PB-071 and REQ-S20-011 (an adoption actual below trajectory creates exactly one intervention; the seven indicators by name; adoption at risk on a delivered initiative);
     - REQ-PB-072 (100 % training and no proficiency observation: proficiency Unknown, not adopted);
     - REQ-S11-002 (a proficiency observation through the form links to the group and counts);
     - REQ-PB-073 (a champion's constraint is linked to and visible on a T04 decision);
     - REQ-S11-001 (influence and impact separate; an intervention with owner and due date in My Work);
     - REQ-PB-009, REQ-S03-003 and REQ-S11-006:
       - delivery Complete changes neither adoption, validated value nor closure;
       - closure while value is pending is 422 unless a transition decision exists;
       - the labels are exactly as the row texts quote them, never 'successful';
     - REQ-S08-002 (completing the enabling deliverable leaves validated value at zero and marks the benefit 'enabled - not yet measured');
     - REQ-PB-074 (Measure needs the Plan outputs; Sustain needs a BAU owner and a control cadence);
     - REQ-PB-083 (accepting a handover creates the recurring BAU reviews exactly once);
     - REQ-S11-005 (a handover missing data access is refused; anyone but the receiving owner gets 403);
     - REQ-S03-002 and REQ-S11-004 (after closure the area still gets its next review on time and accepts KPI actuals);
     - REQ-PB-084 (CI items visible after closure; G6 lists the backlog);
     - REQ-S11-007 (after the transition decision the forecast stays forecast and monitoring tasks go to the residual owner);
     - REQ-S11-008 and REQ-S12-016 (a failed control check creates one owned recovery action with a follow-up date; a lesson is searchable from another transformation);
     - REQ-S11-009 (after reopening, the original acceptance and closure date are unchanged);
     - REQ-PB-085 (benefit below plan: one corrective action, no duplicate on repeated evaluation; the two-cycle KPI rule);
     - REQ-PB-020, REQ-PB-021 and REQ-S04-008 (the G5 and G6 refusals named in their texts);
     - REQ-S16-020 (check that the entity-group test exists and passes).
2. **A03, Modular entry.** "Existing transformation enters at Design with inherited evidence; missing baseline/outcome links are flagged and cannot silently pass gates."
   - Cover REQ-PB-005, REQ-S03-005 and REQ-S20-003:
     - the inherited G2 shows as 'inherited', not Approved;
     - both missing links are flagged;
     - G3 submission is refused with `gate.modular_links_missing` until the links are supplied, or until an authorized waiver exists (D-110; ADR-0021 amendment W1–W7);
     - a revoked or expired waiver refuses approval;
     - an End-to-End G3 is unaffected.
   - Add one root `e2e/` spec in chromium-en and chromium-ar that shows the missing links and the refusal on screen.
3. **REQ-DLV-036, the evidence run.** Run QA-A's A04 and A10 suites, QA-B's A09 suites and your A11 suites together on your tree, and report the counts per suite and any failure with its output. QA-B's A09 suites are merged; run them too, so the four suites run together.

- **Sandbox note (QA-A):** in your confined sandbox, `node_modules` is read-only, and Vitest's config loader fails before any test runs. Add `--configLoader runner` and say so. The orchestrator re-runs the exact command where `node_modules` is writable.

## Rules

- **Real behaviour:** assert status codes, problem codes, database state, rendered `dir`/`lang` and values. Never assert implementation details.
- **Determinism:** tests must be deterministic and run offline. Use synthetic data only, with fixed dates and no random collisions. A missing tool or credential makes a check BLOCKED, never a silent pass.
- **Decimal strings:** compare amounts as decimal strings, never floats.
- **Gates:** product gates G1–G6 are business approvals inside the product; a Finance approval in a fixture is a synthetic in-product approval of test data. No agent grants a real business, Finance or IT approval.
- **Ports:** your harness ports are **25800–25849** only. Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline. Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); never run `playwright install`.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **Load:** three other agents run at the same time. If an e2e step hits the 30 s timeout, re-run that spec alone and report both runs.

## Acceptance (real output in the handback)

1. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm vitest run --project integration tests/qa` passes. Report the counts per file.
2. Your root `e2e/` spec passes in chromium-en and chromium-ar on the real stack (`--workers=1`), with axe reporting 0 serious or critical issues.
3. `pnpm lint` and `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exit 0 on your files.
4. **A requirement → test table.** For each row named above, give the test that proves it, or `NOT COVERED` with the reason.
5. **Mutation checks:** for at least five central assertions (at least one per scenario), show that the test fails when the asserted behaviour is broken. Use a temporary copy in `$TMPDIR` or an environment switch, and never edit product source in this tree. Keep the logs.
6. `node tools/gates/validate.mjs --historical --stage DG3` exits 0, at the start and at the end.

## Evidence honesty

Report every command with its real exit code. Disclose every non-zero exit, failed or flaky test, or timeout. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-C-authoring/HANDBACK-T-DG4-QA-C-qa-verifier.md`. Your role cannot write `docs/delivery/handbacks/`. Include:
- the suites authored, with what each asserts;
- the requirement → test table;
- the checks run, with exit codes and counts;
- each product defect found, with its reproduction;
- anything BLOCKED.

Leave your test files **uncommitted** in the worktree for the orchestrator to integrate. The runner commits your run evidence.
