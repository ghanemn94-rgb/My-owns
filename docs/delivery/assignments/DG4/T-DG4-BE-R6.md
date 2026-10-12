# Assignment T-DG4-BE-R6: DG4 round-6 finding repairs

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after review round 6).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/be-r6`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-R6 (the worker) and T-DG4-FE-R10 (web tests) repair the DG4 round-6 findings in their own worktrees; neither owns the other's files. Read D-131 first; it decides each finding's repair. Your files: `apps/worker/**`, `apps/api/**` as needed.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It names the findings you close; their records are binding. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 and D-117 to D-131 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope: finding F-DG4-128 (Medium), per D-131

- **The finding is binding.** Read it in `docs/delivery/reviews/DG4/round-6/domain-reviewer.findings.json` (reproduction, expected, actual), and D-131. The reviewer's measurement scripts are `docs/delivery/test-evidence/DG4/domain/round-6/with-stack-trace.sh` and `measure-supervise.sh`. Show the reproduction (the `TimeoutNaNWarning` at start-up and the idle transaction rate) before your change, and after it. Keep both logs.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **Logs:** never write a log under `docs/delivery/` while a test run is in progress; write to `$TMPDIR` and copy afterwards. **Never stop processes with `pkill -f` or `pgrep -f`.** Any CPU-busy load loop you start must end on its own (for example `timeout 600`) and be stopped by PID before you finish.
1. **The fix:** the shipped worker (`apps/worker/src/main.ts`, `apps/worker/src/queues/platform.ts` `createBoss`) passes a bounded `superviseIntervalSeconds` of 60 s, the cadence pg-boss documents, configurable through the worker's configuration (env or config module, following the existing pattern), with a validated range. Check every other pg-boss option the shipped path leaves to a default that pg-boss does not give, and report each one.
2. **The test:** start the worker's own `createBoss` path with the shipped defaults, and assert that the supervision cadence is the configured value and never NaN. Add a check that no `TimeoutNaNWarning` is emitted. The tests that pass 1 s explicitly stay as they are. The test must fail on the original code (keep that log).
3. **Behaviour:** A13 (REQ-S16-005: exactly once after a mid-job kill) and the restart tests still pass. Run the full integration suite.
4. **Measure:** re-run the reviewer's `measure-supervise.sh` on the fixed worker and report the idle transaction rate and the CPU ticks.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 26150–26199 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm openapi:lint`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in both Vitest invocations. Report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and any pinned-count change.
4. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-BE-R6-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-BE-R6-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
