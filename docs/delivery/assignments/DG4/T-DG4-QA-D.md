# Assignment T-DG4-QA-D: two acceptance gaps found by the register update (REQ-PB-010, REQ-S03-004) (qa-verifier, authoring)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Kind of task:** **authoring**, not a gate review. You write executable acceptance suites from the acceptance texts and the contract, and run them on the integrated tree before the freeze.
  - Authoring them does not make you the DG4 gate reviewer. The independent DG4 QA review is a separate round, run by a separate session (the T-DG1-QA precedent).
  - It closes two test gaps that T-DG4-AN-P4A found.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/qa-d`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Do not run `pnpm install` or `pnpm -r build`; the product tree is read-only to you.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-FE-R3B runs at the same time in its own worktree and touches no file of yours. Every P4 task and the QA-A, QA-B and QA-C suites are merged (D-090 to D-115). Add your own files beside theirs.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current suite, make it pass or mark exactly what fails, and write the handback listing what remains.

## Files you may write

- `tests/qa/**`: the Vitest `integration` project picks up `tests/qa/integration/**`, and `unit-node` picks up `tests/qa/unit/**`. Reuse `tests/qa/support/{api.ts,with-pg.sh}`. Extend them only by adding new files or new exports.
- root `e2e/**`: acceptance-level Playwright specs. The frontend's own journeys live in `apps/web/e2e/` and are not yours. Start the stack with `apps/web/e2e/support/with-stack.sh`, as those journeys do.
- `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-D-authoring/**`: your logs and your handback.

**Never** edit `apps/**` or `packages/**` product source, `tools/**`, `.claude/**`, `docs/source/**`, or any delivery record. If a suite exposes a product defect, keep the failing test, report it in the handback with the exact request and response, and do not work around it.

## Deliver: two acceptance tests

The register update (`docs/delivery/handbacks/DG4/T-DG4-AN-P4A-transformation-analyst.md`) found that the behaviour holds, but no test asserts these clauses directly:

1. **REQ-PB-010:** read its acceptance text in `docs/delivery/requirements.csv`. Write a test that renames an initiative and then re-reads the T10 Portfolio area (the 'scorecard') and the traceability view through the API. Both must show the new name, from the one initiative row, with no stale copy.
2. **REQ-S03-004:** the clause "a Design-phase draft can be saved before G2". Write a test that asserts G2 is **not** approved, then saves a Design-phase draft through the API and gets success. The same test also covers the clause's other two parts: a scale transition before G5 approval is 422 invalid-transition naming G5, and after approval it succeeds. Reuse QA-B's native world builder where it fits.

## Rules

- **Real behaviour:** assert status codes, problem codes, database state, rendered `dir`/`lang` and values. Never assert implementation details.
- **Determinism:** tests must be deterministic and run offline. Use synthetic data only, with fixed dates and no random collisions. A missing tool or credential makes a check BLOCKED, never a silent pass.
- **Decimal strings:** compare amounts as decimal strings, never floats.
- **Gates:** product gates G1–G6 are business approvals inside the product; a Finance approval in a fixture is a synthetic in-product approval of test data. No agent grants a real business, Finance or IT approval.
- **Ports:** your harness ports are **25650–25699** only. Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline. Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); never run `playwright install`.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **Load:** three other agents run at the same time. If an e2e step hits the 30 s timeout, re-run that spec alone and report both runs.

## Acceptance (real output in the handback)

1. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm vitest run --project integration tests/qa` passes. Your sandbox has a read-only `node_modules`, so add `--configLoader runner` and say so. Report the counts per file.
2. `pnpm lint` and the prettier check exit 0 on your files.
3. **Mutation checks:** for each of the two tests, show that it fails when the asserted behaviour is broken. Use a throwaway copy in `$TMPDIR`, and never edit product source in this tree.
4. `node tools/gates/validate.mjs --historical --stage DG3` exits 0, at the start and at the end.

## Evidence honesty

Report every command with its real exit code. Disclose every non-zero exit, failed or flaky test, or timeout. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-D-authoring/HANDBACK-T-DG4-QA-D-qa-verifier.md`. Your role cannot write `docs/delivery/handbacks/`. Include:
- the suites authored, with what each asserts;
- the requirement → test table;
- the checks run, with exit codes and counts;
- each product defect found, with its reproduction;
- anything BLOCKED.

Leave your test files **uncommitted** in the worktree for the orchestrator to integrate. The runner commits your run evidence.
