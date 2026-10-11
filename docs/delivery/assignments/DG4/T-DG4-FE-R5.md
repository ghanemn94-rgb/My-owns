# Assignment T-DG4-FE-R5: DG4 round-2 finding repairs

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after review round 2).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r5`, at the integrated `HEAD`.
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

## Repair scope: findings F-DG4-122 (mandatory) and the F-DG4-123 screens

- **Findings are binding.** Read your findings in `docs/delivery/reviews/DG4/round-2/*.findings.json` (reproduction, expected, actual) and in D-119. The round-3 reviewers re-run each reproduction. Close each finding against its own **expected** text, and show the reproduction failing before your change (keep the log) and passing after.
- **The design is ARCH-R5's,** merged before you start: its ADR amendment, the contract members, the zod exports, the code-table rows and the 'Implementation notes' section of `docs/delivery/handbacks/DG4/T-DG4-ARCH-R5-solution-architect.md`.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **e2e under load:** if a test hits the 30 s timeout, re-run that spec alone and report both runs. Never raise a timeout.
1. **F-DG4-122 (High, mandatory):** a value whose `unit` is `ratio` (or a percentage unit) renders as a percentage, never as money, even when it carries a `currency`. Fix `formatValue` in `apps/web/src/pages/dashboards/ui.tsx` and every other formatter that tests currency before unit (search the web app for that pattern and list what you found). A 100 % gap reads '100 %' and a 25 % gap '25 %', in EN and AR with the locale's digits and sign placement. Add unit tests for a ratio that carries a currency, in both locales, and an e2e assertion on the T10 Value area, the Executive Overview and the Finance dashboard.
2. **F-DG4-123 screens:** KBE-R6 implements the API at the same time, so start from ARCH-R5's contract, mock the responses in unit tests, and say what remains for after the merge.
   - T10 Value area, the Executive Overview, the workspace header and the Finance dashboard label the value headlines with their basis (profit and cash);
   - they show the revenue-uplift (top line) and avoided-cost (non-cash) headlines beside them, each labelled, never summed;
   - a `not_applicable` profit-and-cash headline shows its reason, never 0 or green;
   - every new headline drills as the contract says;
   - EN and AR keys, from ARCH-R5's code-table rows 207–235 (`docs/delivery/handbacks/DG4/T-DG4-ARCH-R5-evidence/codes-table.md`); the Arabic texts there are proposals and stay marked provisional; rows 231–235 retire the five A2 value label keys;
   - the web readers listed in ARCH-R5 handback §6, each updated and reported.

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

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R5-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R5-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
