# Assignment T-DG5-QA-F: executable acceptance suites A13, A22 (qa-verifier, authoring)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Kind of task:** **authoring**, not a gate review. You write executable acceptance suites from the acceptance texts and the contract, and run them on the integrated tree before the freeze.
  - Authoring them does not make you the DG5 gate reviewer. The independent DG5 QA review is a separate round, run by a separate session (the T-DG1-QA precedent).
  - p5-plan §5.1 lists this task in slice K.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/qa-f`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Do not run `pnpm install` or `pnpm -r build`; the product tree is read-only to you.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four W19 tasks run at the same time (QA-B, QA-E, QA-F and FE-C3), each in its own worktree; no architecture task runs. W1–W18 are merged and verified (D-164). The QA tasks write only new files under tests/qa/** and root e2e/** (QA-B may also edit e2e/a03-modular-entry.spec.ts and e2e/a06-configuration-change.spec.ts, as its scope says); give your files names that start with your scenario id so they never collide. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current suite, make it pass or mark exactly what fails, and write the handback listing what remains.

## Files you may write

- `tests/qa/**`: the Vitest `integration` project picks up `tests/qa/integration/**`, and `unit-node` picks up `tests/qa/unit/**`. Reuse `tests/qa/support/{api.ts,with-pg.sh}`. Extend them only by adding new files or new exports.
- root `e2e/**`: acceptance-level Playwright specs. The frontend's own journeys live in `apps/web/e2e/` and are not yours. Start the stack with `apps/web/e2e/support/with-stack.sh`, as those journeys do.
- `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-F-authoring/**`: your logs and your handback.

**Never** edit `apps/**` or `packages/**` product source, `tools/**`, `.claude/**`, `docs/source/**`, or any delivery record. If a suite exposes a product defect, keep the failing test, report it in the handback with the exact request and response, and do not work around it.

## Deliver: the acceptance suites

Derive every check from the acceptance texts and `docs/api/openapi.yaml`, not from the implementation.
- The scenario texts are master prompt §20 "Acceptance tests and measurable definition of done".
- The binding row texts are in `docs/delivery/requirements.csv`.

1. **A13, Durable automation.** "Retried events, worker restarts and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable"
   - Rows (every DG5 row whose acceptance, increments or notes cite A13; their `acceptance` texts are binding, test each literally): `REQ-S12-001`, `REQ-S12-002`, `REQ-S12-004`, `REQ-S12-012`, `REQ-S12-015`, `REQ-S12-020`, `REQ-S12-021`, `REQ-S12-026`.
   - API suites through the real server and a real PostgreSQL over synthetic data, plus at least one root `e2e/` spec in chromium-en and chromium-ar for the scenario's user-visible path.
2. **A22, Operational readiness.** "Health checks, logs, error alerts, admin job visibility and production/demo separation are demonstrated"
   - Rows (every DG5 row whose acceptance, increments or notes cite A22; their `acceptance` texts are binding, test each literally): `REQ-S12-022`, `REQ-S18-001`, `REQ-S18-003`, `REQ-S21-001`.
   - API suites through the real server and a real PostgreSQL over synthetic data, plus at least one root `e2e/` spec in chromium-en and chromium-ar for the scenario's user-visible path.

**Scope notes.**
- A13 for P5 is the automation engine and the P5 jobs: rule executions, the failure queue with retry and dismiss, a worker restart mid-run, retried outbox events, the export job, the cut-off pack scan, the Day-90 job and the health-check job.
  - "do not duplicate approvals, measurements or notifications" is asserted on database rows.
  - REQ-S12-002's "a failed execution appears in the queue and succeeds on retry without duplicating actions" was left NOT COVERED by QA-A; it is yours.
  - The DG4 `tests/qa/integration/a13-job-idempotency.test.ts` exists; extend the scenario with new files, never by editing it.
- A22 for P5 is the production/demo separation (ADR-0050 §1 and §3: a production database reports `production`, demo seeding into a non-empty database is refused, and the demo reset discards only demo data), the jobs operations view, and REQ-S21-001's text scan.
- These rows' final gates may be DG6. Test their DG5 acceptance clauses literally and list what is left to DG6.

**Notes:**
- In this sandbox `node_modules` is read-only, so run Vitest with `--configLoader runner`.
- Root e2e specs are run by explicit paths, never the bare `e2e` filter.
- Any global configuration your specs publish must be restored before they end (D-163).

**Load (D-164).** In W18, five concurrent full runs exhausted this 15 GB host: `tsc` and Vitest forks were killed. Run your heavy commands one at a time (never an integration run in parallel with an e2e run of your own), and never start the repository-wide `pnpm test` or `pnpm test:integration`. Those run once on the merged tree in the orchestrator's verification.

## Rules

- **Real behaviour:** assert status codes, problem codes, database state, rendered `dir`/`lang` and values. Never assert implementation details.
- **Determinism:** tests must be deterministic and run offline. Use synthetic data only, with fixed dates and no random collisions. A missing tool or credential makes a check BLOCKED, never a silent pass.
- **Decimal strings:** compare amounts as decimal strings, never floats.
- **Gates:** product gates G1–G6 are business approvals inside the product; an approval in a fixture is a synthetic in-product approval of test data. No agent grants a real business, Finance or IT approval. Never name a DG0–DG7 engineering gate in product text.
- **Ports:** your harness ports are **23700–23749** only. Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-F-authoring/handback.md`, with your logs beside it. Include the files you wrote, the checks with exit codes and counts, the requirement → test table, the mutation checks, every product defect found (exact request and response), and what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
