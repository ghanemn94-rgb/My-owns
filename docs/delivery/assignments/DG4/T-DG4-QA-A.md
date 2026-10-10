# Assignment T-DG4-QA-A: executable acceptance suites A04, A05 and A10 (qa-verifier, authoring)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Kind of task:** **authoring**, not a gate review. You write executable acceptance suites from the acceptance texts and the contract, and run them on the integrated tree before the freeze.
  - Authoring them does not make you the DG4 gate reviewer. The independent DG4 QA review is a separate round, run by a separate session (the T-DG1-QA precedent).
  - p4-plan §5.1 lists this task as QA-A, slice L.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/qa-a`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Do not run `pnpm install` or `pnpm -r build`; the product tree is read-only to you.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-FE-D2, T-DG4-FE-F and T-DG4-FE-G run in their own worktrees and touch no file of yours. Everything through W15 is merged (D-090 to D-112).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current suite, make it pass or mark exactly what fails, and write the handback listing what remains.

## Files you may write

- `tests/qa/**`: the Vitest `integration` project picks up `tests/qa/integration/**`, and `unit-node` picks up `tests/qa/unit/**`. Reuse `tests/qa/support/{api.ts,with-pg.sh}`. Extend them only by adding new files or new exports.
- root `e2e/**`: acceptance-level Playwright specs. The frontend's own journeys live in `apps/web/e2e/` and are not yours. Start the stack with `apps/web/e2e/support/with-stack.sh`, as those journeys do.
- `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-A-authoring/**`: your logs and your handback.

**Never** edit `apps/**` or `packages/**` product source, `tools/**`, `.claude/**`, `docs/source/**`, or any delivery record. If a suite exposes a product defect, keep the failing test, report it in the handback with the exact request and response, and do not work around it.

## Deliver: the acceptance suites

Derive every check from the acceptance texts and `docs/api/openapi.yaml`, not from the implementation.
- The scenario texts are master prompt §20 "Acceptance tests and measurable definition of done", rows `A04`, `A05` and `A10`.
- The binding row texts are in `docs/delivery/requirements.csv`: every DG4 row whose `acceptance` cites the scenario.

1. **A04, KPI propagation.** "Submit a period actual; validate and accept it; linked dashboards/RAG/calculations update once; benefit needing Finance review remains pending."
   - One end-to-end API suite through the real server and a real PostgreSQL, over a synthetic transformation with a KPI linked to an outcome and a benefit.
   - Assert, each against its row text:
     - submit, then accept: exactly one calculation run and one audit event (REQ-S07-013, REQ-S12-006);
     - the RAG and the dashboards show the new value once (REQ-S03-009, REQ-S13-003);
     - the linked benefit shows a pending amount and the validated total is unchanged (REQ-S07-014);
     - with review configured, a submitted actual is not used until accepted (REQ-S07-012);
     - a KPI with no actual shows Unknown, not 0 (REQ-S13-003, REQ-S07-006);
     - a user scoped to transformation X sees nothing of Y on any of the six dashboards (REQ-S13-001);
     - a Q1 filter changes every tile to Q1 values (REQ-S13-002).
   - Plus one root `e2e/` spec in chromium-en and chromium-ar: a KPI owner submits an actual in four steps by keyboard, and the confirmation lists the affected dashboards and 'Finance review pending' (REQ-S07-017).
2. **A05, calculation correctness.** "Automated tests cover higher/lower/band measures, stale/missing values, zero denominator, percentage points, periods and currency/decimal precision."
   - Black-box cases through the API (and `@mth/shared/calc` only where the row text says "unit tests"). Cover:
     - REQ-S07-002 (polarity and band);
     - REQ-S07-004 (pp vs %; YTD flow);
     - REQ-S07-005 (zero denominator 'Not computable'; negative baseline flagged);
     - REQ-S07-006 (Unknown);
     - REQ-S07-007 (threshold version recomputes);
     - REQ-S07-010 (weighted ratio roll-up; SAR + USD refused);
     - REQ-S07-011 (circular formula; SAR + count refused);
     - REQ-S08-004 (formula whitelist; JavaScript payload rejected at parse);
     - REQ-S08-006 (benefit value lineage to the formula version and input actual versions);
     - REQ-S16-025 (0.1 + 0.2 = 0.30; 100000 × 0.02 × 50 = 100000.00);
     - REQ-S09-007 (decimal SAR budget; slip in working days);
     - REQ-S09-009 (critical path of a fixture network; none claimed with a missing duration);
     - REQ-S15-008 (observation period and business date in Asia/Riyadh).
3. **A10, benefit integrity.** "A shared benefit rolls up once; 110% allocation is rejected; unvalidated or forecast value cannot appear as validated actual."
   - Cover:
     - REQ-PB-058 (two owners rejected; 10 million SAR shared by two initiatives counted once);
     - REQ-S08-013 (60 + 50 rejected; 60 + 30 shows 10 % unallocated);
     - REQ-S03-006 (an allocation link set of 110 % rejected);
     - REQ-PB-075 and REQ-S08-016 (pending excluded until Finance approves, then the total rises by exactly the approved amount);
     - REQ-S08-001 and REQ-S08-018 (forecast and upside never validated);
     - REQ-PB-076 and REQ-S08-010 (CX benefit n/a, not 0; SAR on a CX benefit without an approved method rejected);
     - REQ-S08-009 (revenue and margin on separate lines; cost avoidance not cash);
     - REQ-S08-011 (a 1 million SAR cost reduces net by exactly 1 million);
     - REQ-S08-014 (overlap warning, excluded until resolved);
     - REQ-S08-015 and REQ-PB-013 (validation without a period rejected; non-Finance 403; the audit event records the validator);
     - REQ-S08-017 (in-place edit of a validated value 409; a reversal nets the total and both records stay visible);
     - REQ-S12-014 (one queue item; a replay creates none).

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

1. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm vitest run --project integration tests/qa` passes. Report the counts per file.
2. Your root `e2e/` spec passes in chromium-en and chromium-ar on the real stack (`--workers=1`), with axe reporting 0 serious or critical issues.
3. `pnpm lint` and `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exit 0 on your files.
4. **A requirement → test table.** For each row named above, give the test that proves it, or `NOT COVERED` with the reason.
5. **Mutation checks:** for at least five central assertions (one per scenario at minimum), show that the test fails when the asserted behaviour is broken. Use a temporary copy in `$TMPDIR` or an environment switch, and never edit product source in this tree. Keep the logs.
6. `node tools/gates/validate.mjs --historical --stage DG3` exits 0, at the start and at the end.

## Evidence honesty

Report every command with its real exit code. Disclose every non-zero exit, failed or flaky test, or timeout. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-A-authoring/HANDBACK-T-DG4-QA-A-qa-verifier.md`. Your role cannot write `docs/delivery/handbacks/`. Include:
- the suites authored, with what each asserts;
- the requirement → test table;
- the checks run, with exit codes and counts;
- each product defect found, with its reproduction;
- anything BLOCKED.

Leave your test files **uncommitted** in the worktree for the orchestrator to integrate. The runner commits your run evidence.
