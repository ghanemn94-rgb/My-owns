# Assignment T-DG4-KBE-R8: DG4 dashboard units and outcomes (D-124)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after review round 3).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/kbe-r8`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-KBE-R8 (API) and T-DG4-FE-R7 (web) repair the D-124 defects in their own worktrees, after T-DG4-ARCH-R7's design was merged; neither owns the other's files. Read D-124 and D-125 first. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It names the findings you close; their records are binding. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 and D-117 to D-125 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope: D-124 items 1–3 in the API, per ARCH-R7

- **The defects are binding as D-124 states them** (confirmed by the orchestrator in the merged tree; no reviewer finding id). The round-4 reviewers will test them. Show each failing before your change (keep the log) and passing after.
- **The design is ARCH-R7's,** merged before you start: ADR-0037 amendment N5, `DashboardValue.kpiUnit`, `p4-pending-arch-r7.ts` and §4.1 / §4.3 of `docs/delivery/handbacks/DG4/T-DG4-ARCH-R7-solution-architect.md`. Implement it as written; raise any gap in your handback rather than redesigning.
- **Byte stability:** every response other than the ones these changes affect stays byte-identical. Prove it with the response-transcript method (`apps/api/test/support/response-transcript.ts`), and list each changed member.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **Logs:** never write a log under `docs/delivery/` while a test run is in progress (`a08-gate-controls` hashes that tree); write to `$TMPDIR` and copy afterwards.
- **Never stop processes with `pkill -f` or `pgrep -f`** (they match your own shell).
1. **D-124 item 1, outcomes on the dashboards:** `kpi/dashboard-facts.ts` `loadOutcomeRows` reads non-archived outcomes (`status <> 'archived'`), as `charter.ts`, `criteria.ts`, `portfolio/hierarchy.ts` and the G2 good-outcome test already do. The test creates the outcome, its KPI link and an accepted actual **through the API only** (no direct database insert of an outcome status), and asserts the T10 Outcomes area, the Executive Overview and the outcomes drill-down show it; an archived outcome is not shown. Check every other P4 reader of `outcome.status = 'active'` (search the API) and report each one, changing only those that have the same defect.
2. **D-124 items 2–3, the unit kind:** emit `DashboardValue.kpiUnit` exactly as ARCH-R7 N5 defines, on every emitter its handback lists. Tests with ARCH-R7's fixtures: a `percentage` KPI with no label, with the label '% of users', a `ratio` KPI 1.5, and the value gap (`kpiUnit` null).
3. **The contract closing step (D-124, D-125):** when `p4-pending-arch-r7.ts` is empty, apply ARCH-R7 handback §4.1 item 5 exactly, wording included. Change nothing else in `openapi.yaml` or the mirrors. Show the contract test failing without the member (a temporary local mutation, reverted).
4. **The web fixtures:** FE-R7 runs at the same time and owns `apps/web/**`. If the closing step breaks the web typecheck in your tree, supply a verified patch in your evidence, as KBE-R6 did.
5. Update every test that pinned the changed behaviour, each listed with its old and new value.

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

Write `docs/delivery/handbacks/DG4/T-DG4-KBE-R8-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-KBE-R8-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
