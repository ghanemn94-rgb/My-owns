# Assignment T-DG4-FE-R1: P4 implementation, p4-work-split repair scope (below) (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-R3, T-DG4-KBE-R3, T-DG4-FE-R1 and T-DG4-FE-E run in their own worktrees; none owns your files. Everything through W14 (ARCH-R2, BE-M3, KBE-G2, FE-D) is merged (D-090 to D-111). Stay strictly inside your file ownership.
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

## Repair scope (this assignment replaces a work-split section)

1. **`apps/web/src/auth/session-identity.test.tsx` fails intermittently under load.** It has failed at least three times: in DG3 round 3 (D-084), during T-DG4-BE-D's run and during T-DG4-BE-H2's run. **Find the root cause and fix it.** Do not lengthen timeouts or add retries without explaining the race they cover. Prove the fix by running the file 50 times in a loop under parallel load (for example, alongside `pnpm test`) with zero failures, and keep the loop log.
2. **Plan-value editing** (FE-C decision 1): use `getBenefitPlanValue`. KBE-R3 routes it concurrently, so start from the contract and mock the read in unit tests. Offer the edit with the read's `ETag`/version as `If-Match`. Add an e2e step only if the route is merged into your base; otherwise say so in your handback.
3. **The missing My Work key** `benefits.task.finance_validation_review` (FE-C decision 4), plus every work-item message key in the ARCH-R1/R2 code tables that `myWork.json` lacks.
4. **KPI periods** (KBE-R2): FE-B's KPI update form offers only the current period. Switch it to `listTransformationReportingPeriods` so a Lead or KPI owner can choose the open period.
5. **Translations:** EN/AR `problems.json` keys for the ARCH-R1/R2 table codes of slices H, I, C, A, J and K that no FE task has translated yet, including `approval.resubmit_through_record`, `gate.exception_revoked`, `gate.modular_links_missing` and the new `gate.modular_waiver_*` codes. FE-D and FE-E own slices E, D, F and G. List any code you could not place.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 25400–25449 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R1-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R1-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
