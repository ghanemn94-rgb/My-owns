# Assignment T-DG4-KBE-R7: DG4 round-3 finding repairs

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after review round 3).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/kbe-r7`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-KBE-R7 (engine and API) and T-DG4-FE-R6 (web) repair the DG4 round-3 findings in their own worktrees, after T-DG4-ARCH-R6's design was merged; neither owns the other's files. Read D-122 first; it decides each finding's repair. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It names the findings you close; their records are binding. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 and D-117 to D-122 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope: findings F-DG4-126, F-DG4-127 and F-DG4-105 (engine and API), per D-122 and ARCH-R6

- **Findings are binding.** Read your findings in `docs/delivery/reviews/DG4/round-3/*.findings.json` (reproduction, expected, actual) and in D-122. The round-4 reviewers re-run each reproduction. Close each finding against its own **expected** text, and show the reproduction failing before your change (keep the log) and passing after. The reviewers' probes are under `docs/delivery/test-evidence/DG4/{domain,code-security}/round-3/` (`zz-domain-r3.test.ts` R3-6 and R3-8, `probes/sec-dg4-r3-gross-currency.test.ts`); run them, copied in for one run and removed, before and after.
- **The design is ARCH-R6's,** merged before you start: its ADR amendment N4, the contract members and parameters, the zod exports, `p4-pending-arch-r6.ts` and the 'Implementation notes' section of `docs/delivery/handbacks/DG4/T-DG4-ARCH-R6-solution-architect.md`. Implement it as written; raise any gap in your handback rather than redesigning.
- **Byte stability:** every response other than the ones the findings change stays byte-identical. Prove it with the response-transcript method (`apps/api/test/support/response-transcript.ts`), and list each changed member.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **Logs:** never write a log under `docs/delivery/` while a test run is in progress (`a08-gate-controls` hashes that tree); write to `$TMPDIR` and copy afterwards.
- **Never stop processes with `pkill -f` or `pgrep -f`** (they match your own shell).
1. **F-DG4-126:** a validated-gap ratio per basis and currency (profit and cash, top line, non-cash), never summed across bases; the Value RAG is the worst of them, on T10, the workstream dashboard, the Executive Overview (including each row's Value status) and the Finance rows. The R3-6 worlds (margin 70 validated beside 300 revenue uplift, or 300 avoided cost, unvalidated) must be Red, not Green.
2. **F-DG4-127:** the Portfolio area's initiative value and its ranking use the profit-and-cash basis, as ARCH-R6 defines (R3-8: 90, never 435).
3. **F-DG4-105:** value drill-downs answering a figure of one currency return only that currency, as ARCH-R6 defines; probe GC's USD headline and USD gross line drill to `not_applicable` with no item, never to SAR 70. Extend the drill invariant test to a currency with no profit-and-cash benefit beside one with it.
4. **The contract closing step (D-122, D-123):** when `p4-pending-arch-r6.ts` is empty, apply ARCH-R6 handback §4.1 item 6 exactly: the two `required` additions, the two `.optional()` removals, and the description, comment and info-paragraph wording it names. Change nothing else in `openapi.yaml` or the mirrors. Show the contract test failing without each member (a temporary local mutation, reverted).
5. **The web fixtures:** FE-R6 runs at the same time and owns `apps/web/**`. If the closing step breaks the web typecheck, supply a verified patch in your evidence, as KBE-R6 did, and say so.
6. **Missing planned amounts (D-123; ARCH-R6 handback §5 item 5):** the Portfolio initiative sum (`plannedOf`, `engine.ts`) skips a planned line whose amount is null. Under the project rule, missing data is Unknown, never zero or omitted: a profit-and-cash allocation with a missing planned amount makes that initiative's value `unknown` with `benefit.value_amount_missing`, as the Value headlines already do. Add a test.
7. Update every test that pinned the changed behaviour, each listed with its old and new value.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 26100–26149 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG4/T-DG4-KBE-R7-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-KBE-R7-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
