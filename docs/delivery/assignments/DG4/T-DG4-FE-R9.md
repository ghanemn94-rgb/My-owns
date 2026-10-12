# Assignment T-DG4-FE-R9: DG4 round-5 finding repair (test determinism)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after review round 5).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r9`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** you run alone. Read D-129 first; it decides the repair. Stay strictly inside your file ownership (`apps/web/**`).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It names the findings you close; their records are binding. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 and D-117 to D-129 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope: findings F-DG4-106 and F-DG4-145 (one defect, Low, test-only), per D-129

- **Findings are binding.** Read both in `docs/delivery/reviews/DG4/round-5/code-security-reviewer.findings.json` and `qa-verifier.findings.json` (reproduction, expected, actual), and D-129. The round-6 reviewers re-run each reproduction, including code-security's deterministic probe `docs/delivery/test-evidence/DG4/code-security/round-5/probes/sec-dg4-r5-y1c-timing.append.tsx` (it holds one answer for 2.2 s). Show the reproduction failing before your change (keep the log) and passing after.
- **The product is not changed** (`apps/web/src/api/client.ts`, `SESSION_RECHECK_MS` and the D-077 behaviour stay exactly as they are). No test is skipped, no assertion is weakened beyond what D-129 states, and no timeout is raised.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **Logs:** never write a log under `docs/delivery/` while a test run is in progress; write to `$TMPDIR` and copy afterwards. **Never stop processes with `pkill -f` or `pgrep -f`.**
1. **Y1c** (`apps/web/src/auth/session-bound.test.tsx`, both locales): make it deterministic, independent of wall-clock speed. Use controlled time around `SESSION_RECHECK_MS`, or assert the requests that must and must not happen. Keep what F-DG2-530/570/580 and D-077 require: nothing from user A's action lands under user B; at most one identity confirmation per navigation, plus the create's own permission refresh; and at most one revalidation per page `GET` sent after the 2 s window. Quote the assertions before and after.
2. **The same pattern elsewhere:** search `apps/web/src/**/*.test.ts*` for request counts that depend on `SESSION_RECHECK_MS` or other wall-clock windows with real timers. Fix each one that has the same defect, and list every one you checked.
3. **Prove determinism under load:**
   - run the changed tests 20 times while the machine is loaded, for example with parallel busy loops pinned to every core, and record the load average;
   - run code-security's probe appended to the changed spec in a scratch copy: it must pass;
   - then run the full `pnpm test` 3 times under that load.
   Report every run.
4. **e2e:** not needed for a unit-test-only change. Say so in the handback.

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
4. The product e2e suite is **not** required for this unit-test-only change (scope item 4); the orchestrator's integrated pre-freeze run covers it. If you change anything outside `*.test.ts*`, stop and report it instead.
5. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R9-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R9-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
