# Assignment T-DG4-FE-R4: DG4 round-1 finding repairs

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r4`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-ARCH-R4, T-DG4-KBE-R5, T-DG4-BE-R5, T-DG4-FE-R4 and T-DG4-AN-R1 repair the DG4 round-1 findings in their own worktrees; none owns your files. Read D-117 first; it decides each finding's repair. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It names the findings you close; their records are binding. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope: findings F-DG4-120, F-DG4-102, F-DG4-141 and the F-DG4-121 labels

- **Findings are binding.** Read your findings in `docs/delivery/reviews/DG4/round-1/*.findings.json` (reproduction, expected, actual) and in D-117. The round-2 reviewers re-run each reproduction. Close each finding against its own **expected** text, and show the reproduction failing before your change (keep the log) and passing after.
- **Byte stability:** every response other than the ones the finding changes stays byte-identical. Prove it with the response-transcript method (`apps/api/test/support/response-transcript.ts`), and list each changed member.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **e2e under load:** if a test hits the 30 s timeout, re-run that spec alone and report both runs. Never raise a timeout.
1. **F-DG4-120:** in Arabic, the T11 page shows the Recommend, Approve, Consult, Inform and SLA source labels under a provisional-Arabic notice, as the forums page does (`governanceP4.arProvisional`). Add EN/AR unit tests and an e2e assertion. There is no contract change.
2. **F-DG4-102:** move `renderMessage` and `useTraceSelection` (and anything else the cycles share) into shared modules, so neither cycle remains. Prove it with a module-graph check, for example `madge --circular` if it is installed offline, or a small script. Behaviour is unchanged.
3. **F-DG4-141:** make the "administration screens" test in `apps/web/e2e/journeys.spec.ts` independent of which users exist. Search or filter for the user instead of relying on page 1, and keep its assertions. Run the product journeys and the root `e2e/` specs on one stack, in both projects.
4. **F-DG4-121 labels:**
   - the Finance dashboard and the benefits totals label the gross as profit and cash classes;
   - they show the revenue uplift (top line) and the avoided cost (non-cash) beside it, never summed, as KBE-R5's response returns them;
   - add EN/AR keys.
   KBE-R5 runs at the same time, so start from the D-117 rule, mock the response in unit tests, and say what remains for after the merge.
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

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R4-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R4-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
