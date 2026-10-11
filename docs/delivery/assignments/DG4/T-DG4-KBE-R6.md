# Assignment T-DG4-KBE-R6: DG4 round-2 finding repairs

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after review round 2).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/kbe-r6`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-KBE-R6 (engine and API) and T-DG4-FE-R5 (web) repair the DG4 round-2 findings in their own worktrees, after T-DG4-ARCH-R5's design was merged; neither owns the other's files. Read D-119 first; it decides each finding's repair. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It names the findings you close; their records are binding. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090, D-117 and D-119 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope: finding F-DG4-123 (engine and API), per D-119 and ARCH-R5

- **Findings are binding.** Read your findings in `docs/delivery/reviews/DG4/round-2/*.findings.json` (reproduction, expected, actual) and in D-119. The round-3 reviewers re-run each reproduction. Close each finding against its own **expected** text, and show the reproduction failing before your change (keep the log) and passing after.
- **The design is ARCH-R5's,** merged before you start: its ADR amendment, the contract members, the zod exports, `p4-pending-arch-r5.ts` and the 'Implementation notes' section of `docs/delivery/handbacks/DG4/T-DG4-ARCH-R5-solution-architect.md`. Implement it as written; raise any gap in your handback rather than redesigning.
- **Byte stability:** every response other than the ones the finding changes stays byte-identical. Prove it with the response-transcript method (`apps/api/test/support/response-transcript.ts`), and list each changed member.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **e2e under load:** if a test hits the 30 s timeout, re-run that spec alone and report both runs. Never raise a timeout.
1. **F-DG4-123:** the value headlines ('Planned value', forecast, submitted, 'Validated value', the value-gap ratio and the Value RAG) on T10, the Executive Overview (`/api/v1/overview`), the workspace summary and the Finance dashboard sum only `margin_uplift`, `cash_saving` and `working_capital_release`, per currency. `revenue_uplift` and `avoided_cost` are returned in the members ARCH-R5 defined, never added into a profit-and-cash figure.
   - With the domain reviewer's fixture (revenue uplift 300, margin uplift 70, cash saving 20, avoided cost 45 SAR planned; nothing validated), the profit-and-cash planned headline is 90, the revenue-uplift headline 300 and the avoided-cost headline 45, on all four surfaces.
   - A transformation whose only financial benefits are revenue uplift or avoided cost gets `not_applicable` on the profit-and-cash headline, never 0 or green.
   - Each headline's drill-down follows ARCH-R5's rule; extend the drill-down invariant tests to every new headline.
   - Move every member you implement out of `p4-pending-arch-r5.ts`, so the list is empty.
   - Update every test that pinned the old five-class headline, and list each one with its old and new value.
2. **The contract closing step (ARCH-R5 handback §5; the orchestrator allows you this one contract edit, recorded in D-120):** when `P4_PENDING_ARCH_R5_MEMBERS` is empty, add `headlineBasis` to the `required` lists of `DashboardHeadline` and `DashboardDrilldown`, and `headlines` to `WorkspaceHeader.benefits`'s, in `docs/api/openapi.yaml`, and drop the matching three `.optional()` calls in `packages/shared/src/schemas/dashboards.ts`. Change nothing else in either file. Show the contract test failing on a response without the member (a temporary local mutation, reverted) and passing on the real responses.
3. **Readers:** ARCH-R5 handback §6 lists every API and test reader of a member whose meaning changes; work through it and report each one. Its §7 'Implementation notes' gives the fixture, its variants A–C and the drill invariant (per currency, with a second currency); each becomes a test.

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

Write `docs/delivery/handbacks/DG4/T-DG4-KBE-R6-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-KBE-R6-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
