# Assignment T-DG4-FE-R6: DG4 round-3 finding repairs

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after review round 3).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r6`, at the integrated `HEAD`.
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

## Repair scope: finding F-DG4-125 (High, mandatory) and the F-DG4-126 / F-DG4-127 screens

- **Findings are binding.** Read your findings in `docs/delivery/reviews/DG4/round-3/*.findings.json` (reproduction, expected, actual) and in D-122. The round-4 reviewers re-run each reproduction. Close each finding against its own **expected** text, and show the reproduction failing before your change (keep the log) and passing after.
- **The design is ARCH-R6's,** merged before you start: its ADR amendment N4, the contract members, the zod exports, the code-table rows and the 'Implementation notes' section of `docs/delivery/handbacks/DG4/T-DG4-ARCH-R6-solution-architect.md`.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **e2e under load:** if a test hits the 30 s timeout, re-run that spec alone and report both runs. Never raise a timeout. **No conditional skips:** a test that needs KBE-R7's API asserts it; if it cannot pass before the merge, say so in the handback and leave it to the orchestrator's integrated run.
1. **F-DG4-125 (High, mandatory):** a value with unit `percentage` or `%` is a fraction (ADR-0028 §3: 0.12 = 12 %) and renders as 12 %, as `formatKpiValue` does. Check every unit the API sends for a percentage KPI (`kpi/dashboard-facts.ts`: `unit_label ?? unit_kind`) and every surface that renders it: the T10 Outcomes and People & adoption areas, the Executive Overview, the adoption dashboard and every drill-down. The `ratio` rendering of F-DG4-122 stays as it is (1 → 100 %). Add unit tests with the API's own KPI value object (`{value:'0.12', unit:'percentage'}` and `unit:'%'`) in EN and AR, and an e2e assertion on a real percentage KPI (if the dev seed has none, create one through the API in the test).
2. **F-DG4-126 / F-DG4-127 screens:** KBE-R7 implements the API at the same time, so start from ARCH-R6's contract and mock the responses in unit tests.
   - the Value RAG's per-basis gaps and the worst-of status, each gap labelled with its basis, never a single cross-basis gap;
   - the Portfolio initiative value on its basis, labelled; `not_applicable` with its reason, never 0;
   - EN and AR keys from ARCH-R6's code-table rows (Arabic proposals stay marked provisional);
   - the web readers listed in ARCH-R6's handback, each updated and reported.
3. **First, before the screens (ARCH-R6 handback §5 item 1 and §4.2 item 6):**
   - add the problem code `dashboard.currency_not_applicable` to `problems.json` in EN and AR, so `problems-slices-hijk.test.ts` passes again (it fails on the merged tree until then);
   - add `valueBasis` to every fixture `DashboardItem` and `currency` to every fixture drill-down, and move the `ruleParams` fixture to the N4 `lines` shape, so KBE-R7's closing step does not break the web typecheck.

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

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R6-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R6-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
