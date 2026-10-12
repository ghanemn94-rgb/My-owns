# Assignment T-DG4-FE-R8: DG4 round-4 finding repairs

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after review round 4).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r8`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** you run alone. Read D-127 first; it decides each finding's repair. Stay strictly inside your file ownership (`apps/web/**`).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It names the findings you close; their records are binding. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 and D-117 to D-127 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope: findings F-DG4-143 (Medium) and F-DG4-144 (Low), per D-127

- **Findings are binding.** Read them in `docs/delivery/reviews/DG4/round-4/qa-verifier.findings.json` (reproduction, expected, actual) and in D-127. The round-5 reviewers re-run each reproduction; qa's probe is `docs/delivery/test-evidence/DG4/qa/tests/round-4/e2e/dg4-qa-r4-bu-limit.spec.ts`. Close each finding against its own **expected** text, and show the reproduction failing before your change (keep the log) and passing after.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **e2e under load:** if a test hits the 30 s timeout, re-run that spec alone and report both runs. Never raise a timeout. **No conditional skips.**
- **Logs:** never write a log under `docs/delivery/` while a test run is in progress (`a08-gate-controls` hashes that tree); write to `$TMPDIR` and copy afterwards. **Never stop processes with `pkill -f` or `pgrep -f`.**
1. **F-DG4-143:** `ValueRagLines` (`apps/web/src/pages/dashboards/ui.tsx`) renders each line by its `status`. A `not_applicable` line shows 'Not applicable' (`data-value-state='not_applicable'`) with its reason, as the gap headline beside it does. 'Unknown' is shown only for a line whose status is `unknown`. Check every other place that builds a value from a nullable ratio the same way, and list what you find. Add unit tests for an `unknown`, a `not_applicable` and a valued line in EN and AR, and an e2e assertion on qa's world (non-cash avoided cost planned only in 2099) on T10 and the Executive Overview.
2. **F-DG4-144:** the remedy the 'too many' note names must work (D-127).
   - First check whether the transformation list read used by `useOrgQuery` accepts phase and status filters (the contract and the API).
   - If it does, apply them to the unit's list before the 50-transformation limit, so narrowing as the note advises lifts the block when fewer than 51 remain. Do this on the Executive Overview, Finance and adoption dashboards, which share the hook.
   - If it does not, change the note's EN and AR texts so that they name only remedies that work, and do not change the API.
   - Either way, qa's probe must pass: no advised remedy may leave the block in place.
3. **The test fragility (D-127):** make `apps/web/e2e/p4-dashboards.spec.ts` test 3 independent of how many transformations earlier specs leave in `SYN_RETAIL`, keeping its assertions. Run the full product suite in both projects on one stack to show it.
4. **e2e:** the full product suite (`apps/web/e2e`, real stack via `apps/web/e2e/support/with-stack.sh`, `--workers=1`) in chromium-en and chromium-ar, with axe.

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

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R8-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R8-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
