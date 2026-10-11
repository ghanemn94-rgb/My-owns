# Assignment T-DG4-FE-R7: DG4 dashboard units and outcomes (D-124)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after review round 3).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r7`, at the integrated `HEAD`.
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

## Repair scope: D-124 items 2–3 in the web, per ARCH-R7

- **The defects are binding as D-124 states them** (confirmed by the orchestrator in the merged tree; no reviewer finding id). The round-4 reviewers will test them. Show each failing before your change (keep the log) and passing after.
- **The design is ARCH-R7's,** merged before you start: ADR-0037 amendment N5, `DashboardValue.kpiUnit` and §4.2 / §4.3 of `docs/delivery/handbacks/DG4/T-DG4-ARCH-R7-solution-architect.md`.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **e2e under load:** if a test hits the 30 s timeout, re-run that spec alone and report both runs. Never raise a timeout. **No conditional skips:** a test that needs KBE-R8's API asserts it; if it cannot pass before the merge, say so in the handback and leave it to the orchestrator's integrated run.
1. **First (ARCH-R7 §4.2 item 4):** add `kpiUnit` to every web `DashboardValue` literal (fixtures and tests), so KBE-R8's closing step does not break the web typecheck.
2. **Format by `kpiUnit.kind`** exactly as `formatKpiValue` does on the KPI pages: a `percentage` is a fraction × 100 with '%' and its label as N5 defines ('12 %', '12 % of users'); a `ratio` KPI is a plain decimal ('1.5'); `currency` is money; the others are decimals with their label. A value with `kpiUnit` null keeps today's rules, so the value gap stays '100 %' (F-DG4-122) and a percentage value without `kpiUnit` stays × 100 (F-DG4-125). Unit tests with ARCH-R7's four fixtures in EN and AR, on every surface that renders KPI values: the T10 Outcomes and People & adoption areas, the Executive Overview, the adoption dashboard, the workspace header if it shows KPIs, and every drill-down.
3. **e2e:** extend `apps/web/e2e/p4-percentage-kpi.spec.ts` (or a sibling spec) with a `ratio` KPI and a labelled percentage KPI, created through the API, asserting the rendered text in both projects. **Also assert the T10 Outcomes area** for an outcome created through the API (D-124 item 1, KBE-R8's): it needs KBE-R8's API, so it may fail on your branch alone; say so, and do not skip it.

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
4. The product e2e suite (`apps/web/e2e`, real stack via `apps/web/e2e/support/with-stack.sh`, `--workers=1`) passes in chromium-en and chromium-ar, including your new specs, with axe reporting 0 serious or critical issues. Report the counts per spec.
5. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R7-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R7-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
