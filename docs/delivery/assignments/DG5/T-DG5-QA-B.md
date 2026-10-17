# Assignment T-DG5-QA-B: executable acceptance suites A07 (qa-verifier, authoring)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Kind of task:** **authoring**, not a gate review. You write executable acceptance suites from the acceptance texts and the contract, and run them on the integrated tree before the freeze.
  - Authoring them does not make you the DG5 gate reviewer. The independent DG5 QA review is a separate round, run by a separate session (the T-DG1-QA precedent).
  - p5-plan §5.1 lists this task in slice K.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/qa-b`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Do not run `pnpm install` or `pnpm -r build`; the product tree is read-only to you.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four W19 tasks run at the same time (QA-B, QA-E, QA-F and FE-C3), each in its own worktree; no architecture task runs. W1–W18 are merged and verified (D-164). The QA tasks write only new files under tests/qa/** and root e2e/** (QA-B may also edit e2e/a03-modular-entry.spec.ts and e2e/a06-configuration-change.spec.ts, as its scope says); give your files names that start with your scenario id so they never collide. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current suite, make it pass or mark exactly what fails, and write the handback listing what remains.

## Files you may write

- `tests/qa/**`: the Vitest `integration` project picks up `tests/qa/integration/**`, and `unit-node` picks up `tests/qa/unit/**`. Reuse `tests/qa/support/{api.ts,with-pg.sh}`. Extend them only by adding new files or new exports.
- root `e2e/**`: acceptance-level Playwright specs. The frontend's own journeys live in `apps/web/e2e/` and are not yours. Start the stack with `apps/web/e2e/support/with-stack.sh`, as those journeys do.
- `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-B-authoring/**`: your logs and your handback.

**Never** edit `apps/**` or `packages/**` product source, `tools/**`, `.claude/**`, `docs/source/**`, or any delivery record. If a suite exposes a product defect, keep the failing test, report it in the handback with the exact request and response, and do not work around it.

## Deliver: the acceptance suites

Derive every check from the acceptance texts and `docs/api/openapi.yaml`, not from the implementation.
- The scenario texts are master prompt §20 "Acceptance tests and measurable definition of done".
- The binding row texts are in `docs/delivery/requirements.csv`.

1. **A07, Historical integrity.** "Target/formula changes show impact and reapproval; previous period reports and approved snapshots remain intact"
   - Rows (every DG5 row whose acceptance, increments or notes cite A07; their `acceptance` texts are binding, test each literally): `REQ-PB-093`, `REQ-DLV-037`, `REQ-S06-008`, `REQ-S06-009`, `REQ-S07-016`, `REQ-S12-018`, `REQ-S13-007`, `REQ-S14-003`, `REQ-S20-007`.
   - API suites through the real server and a real PostgreSQL over synthetic data, plus at least one root `e2e/` spec in chromium-en and chromium-ar for the scenario's user-visible path.

**Also yours (D-163): the A06 spec's shared-state pollution.**
- In the W17 merged-tree run of the root specs in one stack (`test-evidence/DG5/orchestrator-D-163/verify-w17-32284fd/e2e-root.log`), `e2e/a03-modular-entry.spec.ts` fails in chromium-ar in its setup with 403 `gate_exception.not_approver`. The reason: `e2e/a06-configuration-change.spec.ts`, run earlier, published a methodology that makes BO the G3 approver, and A03's synthetic Sponsor decides the G3 exceptions.
- Fix it in the QA-owned specs. Either the A06 spec (and your own A07 spec) restores every global configuration it publishes before it ends, by publishing a further version, or A03 decides with the approver the gate reports (BE-C3 makes that the routed approver, D-163). Explain the choice in the handback.
- **Binding result:** every root spec (`e2e/*.spec.ts`, by explicit paths, never the bare `e2e` filter, which also matches archived copies under `docs/`) passes in one stack, in file order, in chromium-en then chromium-ar, with `--workers=1`. Report that run.
- You may edit `e2e/a03-modular-entry.spec.ts` and `e2e/a06-configuration-change.spec.ts` for this purpose only, and you must keep every assertion they make.
- **Also yours (D-164): the A06 spec's record-selection race.**
  - In the W18 verification (`test-evidence/DG5/orchestrator-D-164/verify-w18-fb04735/e2e-root.log`), A06's main test failed in chromium-en at step 3 (`expected ["40", <draft>]`, received `[null, <draft>]`).
  - The cause is in the spec, not the product:
    - `t01Record` patches `items[0]` of `GET …/diagnostic-items`, which is ordered by UUIDv7 `id`. The six seeded T01 items are created in the same millisecond, so their order across dimensions is random.
    - `openT01Form` opens the first row of the page, which is ordered by dimension ordinal.
    - The UI saved 40 to the row it opened (trace: `PUT …/form-records/T01/<other id>/custom-fields` 200), and the test read a different record.
  - Make both helpers address the same record deterministically, for example the item of the lowest-ordinal dimension, or the row of the returned record id. Keep every assertion.

**Notes:**
- In this sandbox `node_modules` is read-only, so run Vitest with `--configLoader runner` (QA-A and QA-C did the same). Nothing else changes.
- A07's "previous period reports and approved snapshots remain intact" means issued snapshots and their exported files (byte or sha comparison) are unchanged after a target change, a formula change, a methodology migration and a KPI restatement.

**Load (D-164).** In W18, five concurrent full runs exhausted this 15 GB host: `tsc` and Vitest forks were killed. Run your heavy commands one at a time (never an integration run in parallel with an e2e run of your own), and never start the repository-wide `pnpm test` or `pnpm test:integration`. Those run once on the merged tree in the orchestrator's verification.

## Rules

- **Real behaviour:** assert status codes, problem codes, database state, rendered `dir`/`lang` and values. Never assert implementation details.
- **Determinism:** tests must be deterministic and run offline. Use synthetic data only, with fixed dates and no random collisions. A missing tool or credential makes a check BLOCKED, never a silent pass.
- **Decimal strings:** compare amounts as decimal strings, never floats.
- **Gates:** product gates G1–G6 are business approvals inside the product; an approval in a fixture is a synthetic in-product approval of test data. No agent grants a real business, Finance or IT approval. Never name a DG0–DG7 engineering gate in product text.
- **Ports:** your harness ports are **23600–23649** only. Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-B-authoring/handback.md`, with your logs beside it. Include the files you wrote, the checks with exit codes and counts, the requirement → test table, the mutation checks, every product defect found (exact request and response), and what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
