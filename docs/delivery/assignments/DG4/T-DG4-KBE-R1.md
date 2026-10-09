# Assignment T-DG4-KBE-R1: P4 implementation, p4-work-split repair scope (below) (kpi-benefits-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/kbe-r1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-ARCH-R1 runs in the main tree; T-DG4-BE-R1, T-DG4-KBE-R1 and T-DG4-FE-C run in their own worktrees; none owns your files. Everything through W11 is merged (D-090 to D-108). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" list below replaces a work-split section. It gives your file ownership and what to prove. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope (this assignment replaces a work-split section; each item cites the handback that reported it, under `docs/delivery/handbacks/DG4/`)

You may edit the files each item names, and their tests. Keep every other response byte-stable and prove it with the existing suites.

1. **KPI create service** (KBE-F handback): slice A exports no KPI create service, so `adoption/indicators.ts` copies slice A's insert and audit event. Export one from the kpi module (`kpi/index.ts`; adjust the `kpi.test.ts` export pin) and make `createAdoptionMetricLink` use it. Prove the rows and audit events are byte-identical to before (an existing indicators test plus a direct comparison).
2. **Deterministic fixture** (BE-C §4.5 and BE-M handbacks; D-098, D-105): `apps/api/test/integration/kpi-p4/kbe-b-fixtures.ts` draws dates with `Math.random()`, so `data-quality.test.ts` and others can collide. Make every fixture date deterministic and unique per call; prove it by running the affected files 20 times in a loop with zero failures (log the loop).
3. **Final-retry failure** (KBE-C handback): a `kpi.recalculate` run that fails on its last retry is not recorded as `failed`, because the handler is not told the attempt count. Record it; prove it with a worker test that forces the final attempt to fail.
4. **Missing tests** (KBE-C handback): an integration test where a formula KPI is recalculated from accepted input actuals, and a worker test that kills the worker partway through `kpi.reporting_period_open` and proves the restart creates no duplicate period or task.
- **Media-type pin:** if you add a JSON request body, add it to the pin in `contract.test.ts` and report the delta.
- **Disk:** check `df -h .` before each full test run; under 3 GB free, stop and report it (D-104).
- **No migration number is yours** (`0060` and `0061` are ARCH-R1's). If you need a schema change, stop and put it in your handback.
- **Not yours:** a transformation-scoped reporting-period read (ARCH-R1 decides it; it may follow in a later task) and every contract or ADR change (ARCH-R1).

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 24850–24899 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG4/T-DG4-KBE-R1-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-KBE-R1-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
