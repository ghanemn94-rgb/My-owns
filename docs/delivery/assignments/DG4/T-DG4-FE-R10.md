# Assignment T-DG4-FE-R10: DG4 round-6 finding repairs

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after review round 6).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r10`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-R6 (the worker) and T-DG4-FE-R10 (web tests) repair the DG4 round-6 findings in their own worktrees; neither owns the other's files. Read D-131 first; it decides each finding's repair. Your files: `apps/web/**` and the root `package.json` `test` script.
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

## Repair scope: findings F-DG4-146, F-DG4-147 and F-DG4-148 (Low, tests only), per D-131

- **The findings are binding.** Read them in `docs/delivery/reviews/DG4/round-6/qa-verifier.findings.json` (reproduction, expected, actual), and D-131. qa's probes are under `docs/delivery/test-evidence/DG4/qa/tests/round-6/`. Show each reproduction failing before your change (keep the log) and passing after.
- **The product is not changed.** No test is skipped, no assertion is weakened, and no wait is raised only to hide slowness.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **Logs:** never write a log under `docs/delivery/` while a test run is in progress; write to `$TMPDIR` and copy afterwards. **Never stop processes with `pkill -f` or `pgrep -f`.** Any CPU-busy load loop you start must end on its own (for example `timeout 600`) and be stopped by PID before you finish.
1. **F-DG4-146:** add a unit test that holds the `/me` answer and asserts that no page `GET` is sent until it is answered, as F-DG2-570 / D-077 state. Show that it fails on a mutant of `apps/web/src/api/client.ts` that drops the wait (a scratch copy, reverted), and passes on the candidate.
2. **F-DG4-147:** in `apps/web/e2e/session-end.spec.ts` 'a 403 is not a session end', wait for the app's boot `GET /me` response before the re-login, so the test checks D-073 deterministically. Run the spec 10 times under a CPU load of 13–16, in both projects.
3. **F-DG4-148:** make `pnpm test` reproducible at a CPU load of 13–16 without weakening any test.
   - **Find the cause first:** first renders of lazily loaded page modules miss unit-web's 5 s wait, and `architecture.test.ts` misses its 30 s timeout.
   - **Candidate remedies:** warm or prebundle the lazily loaded modules in the unit-web setup; make the root `test` script run every project even if an earlier one fails, while still exiting non-zero on any failure; or a per-file first-render budget that is documented and justified by measurement.
   - **Show it:** run the full `pnpm test` 5 times under that load. Report every run with its load average.
4. **e2e:** after item 2, run the full product suite once at normal load in both projects.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 26200–26249 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
4. The product e2e suite (`apps/web/e2e`, real stack via `apps/web/e2e/support/with-stack.sh`, `--workers=1`) passes in chromium-en and chromium-ar, with axe reporting 0 serious or critical issues. Report the counts per spec.
5. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R10-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R10-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
