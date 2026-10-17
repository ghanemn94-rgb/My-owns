# Assignment T-DG5-QA-E: executable acceptance suites A02, A21 (qa-verifier, authoring)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Kind of task:** **authoring**, not a gate review. You write executable acceptance suites from the acceptance texts and the contract, and run them on the integrated tree before the freeze.
  - Authoring them does not make you the DG5 gate reviewer. The independent DG5 QA review is a separate round, run by a separate session (the T-DG1-QA precedent).
  - p5-plan §5.1 lists this task in slice K.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/qa-e`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Do not run `pnpm install` or `pnpm -r build`; the product tree is read-only to you.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four W19 tasks run at the same time (QA-B, QA-E, QA-F and FE-C3), each in its own worktree; no architecture task runs. W1–W18 are merged and verified (D-164). The QA tasks write only new files under tests/qa/** and root e2e/** (QA-B may also edit e2e/a03-modular-entry.spec.ts and e2e/a06-configuration-change.spec.ts, as its scope says); give your files names that start with your scenario id so they never collide. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current suite, make it pass or mark exactly what fails, and write the handback listing what remains.

## Files you may write

- `tests/qa/**`: the Vitest `integration` project picks up `tests/qa/integration/**`, and `unit-node` picks up `tests/qa/unit/**`. Reuse `tests/qa/support/{api.ts,with-pg.sh}`. Extend them only by adding new files or new exports.
- root `e2e/**`: acceptance-level Playwright specs. The frontend's own journeys live in `apps/web/e2e/` and are not yours. Start the stack with `apps/web/e2e/support/with-stack.sh`, as those journeys do.
- `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-E-authoring/**`: your logs and your handback.

**Never** edit `apps/**` or `packages/**` product source, `tools/**`, `.claude/**`, `docs/source/**`, or any delivery record. If a suite exposes a product defect, keep the failing test, report it in the handback with the exact request and response, and do not work around it.

## Deliver: the acceptance suites

Derive every check from the acceptance texts and `docs/api/openapi.yaml`, not from the implementation.
- The scenario texts are master prompt §20 "Acceptance tests and measurable definition of done".
- The binding row texts are in `docs/delivery/requirements.csv`.

1. **A02, Complete lifecycle.** "Authorized users complete the guided end-to-end scenario using only native application workflows"
   - Rows (every DG5 row whose acceptance, increments or notes cite A02; their `acceptance` texts are binding, test each literally): `REQ-S01-003`, `REQ-S01-004`, `REQ-S06-002`, `REQ-S06-003`, `REQ-S09-011`, `REQ-S18-002`, `REQ-S18-004`, `REQ-S20-002`.
   - API suites through the real server and a real PostgreSQL over synthetic data, plus at least one root `e2e/` spec in chromium-en and chromium-ar for the scenario's user-visible path.
2. **A21, No-AI operation.** "Core lifecycle, approvals, calculations and reports still work with AI and external notification channels disabled"
   - Rows (every DG5 row whose acceptance, increments or notes cite A21; their `acceptance` texts are binding, test each literally): `REQ-S01-004`.
   - API suites through the real server and a real PostgreSQL over synthetic data, plus at least one root `e2e/` spec in chromium-en and chromium-ar for the scenario's user-visible path.

**Also yours: REQ-S01-004 with A21 ("the A02 scenario completes with exports, email and AI channels disabled").**
- Run the A02 path with those channels disabled through their configuration, and show that no workflow step's completion condition references an uploaded spreadsheet, deck or email (read the published procedure definitions).

**The demo database.**
- A02 and REQ-S18-004 are about the guided walkthrough with the demo role users in a demo database (ADR-0050 §5 and §6).
- `apps/web/e2e/support/with-stack.sh` initializes a production database. You may add your own `e2e/support/with-demo-stack.sh` that mirrors it with `mth-db seed-demo` instead of the production path. It must not change `apps/web/e2e/support/**`.
- If the demo database cannot serve sign-in for its demo role users without a product change, keep the failing test, report it as a defect with the exact output, and cover what you can through the API on a demo scratch database (QA-C's `a15-demo-transformation-outputs` precedent).

**Notes:**
- In this sandbox `node_modules` is read-only, so run Vitest with `--configLoader runner`.
- Root e2e specs are run by explicit paths, never the bare `e2e` filter, which also matches archived copies under `docs/`.
- Any global configuration your specs publish must be restored before they end (D-163).

**Load (D-164).** In W18, five concurrent full runs exhausted this 15 GB host: `tsc` and Vitest forks were killed. Run your heavy commands one at a time (never an integration run in parallel with an e2e run of your own), and never start the repository-wide `pnpm test` or `pnpm test:integration`. Those run once on the merged tree in the orchestrator's verification.

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

Write `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-E-authoring/handback.md`, with your logs beside it. Include the files you wrote, the checks with exit codes and counts, the requirement → test table, the mutation checks, every product defect found (exact request and response), and what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
