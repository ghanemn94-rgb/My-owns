# Assignment T-DG5-FE-AB2B (continuation of T-DG5-FE-AB2): DG5 round-5 repair (frontend-ux-engineer)

## Continuation (read first)

T-DG5-FE-AB2 was stopped by a container restart before it finished. Its partial work is committed on this branch as a WIP commit (`git log -1 dg5/fe-ab2`): the shared hook in `queries.ts`, the 12 screens, `apps/web/src/api/all-transformations.test.tsx`, `apps/web/e2e/p5-transformation-picker-complete.spec.ts`, and evidence in `docs/delivery/handbacks/DG5/T-DG5-FE-AB2-evidence/` (before-fix logs). Its run record is `docs/delivery/runs/DG5/DG5-T-DG5-FE-AB2-...-orphaned/`.
- Review that work critically; do not assume it is complete or correct. Finish the scope below, run every acceptance check, and write the handback as `docs/delivery/handbacks/DG5/T-DG5-FE-AB2-frontend-ux-engineer.md` (keep the existing evidence folder; add your logs to it).

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 6 on candidate `sha256:3294f8fc…` (D-181).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-ab2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** This is the only repair task (D-181). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The defect you repair (binding)

- **Transformation pickers silently truncate (D-181).** Read D-181 verbatim in `docs/delivery/decisions.md`. `apps/web/src/pages/procedures/MyProceduresPage.tsx:204` and 12 other screens load one page of `useTransformations` (limit 50 or 100) and offer only those, so a transformation past the cap cannot be chosen and nothing says so. Wave AB's merged-tree e2e showed it: `p5-procedure-outputs.spec.ts:39` and `p5-procedures-automation.spec.ts:256` fail in chromium-ar because the test's new transformation is not an option. The failing logs are in `docs/delivery/test-evidence/DG5/orchestrator-D-181/verify-ab-d3bcb4a/` (`e2e-unset.log`, `e2e-cutf8.log`).

## Binding scope

- Add one shared hook in `apps/web/src/api/queries.ts` (for example `useAllTransformations(params)`) that follows `nextCursor` until it is null, using the API's existing list operation and page limit (no contract change), with a loading state, an error state (en and ar), and the same query-key and cancellation conventions as the existing hooks.
- Use it in every screen where a user **selects** a transformation: `MyProceduresPage.tsx`, `AssignmentsPage.tsx`, `RulesPage.tsx`, `RulePage.tsx`, `DelegationsPage.tsx`, `launch-plan/ui.tsx`, `AreaPages.tsx`, `DashboardsPage.tsx`, `playbook/BlockPage.tsx`, `reports/ui.tsx`, `MigrationsEntryPage.tsx`, `WalkthroughPage.tsx` (check each; list what you changed and why). A list that is deliberately a "recent" shortlist (not a picker) may stay one page, but must say so in en and ar and link to the full transformation list.
- Tests: unit tests for the hook (one page, several pages, an error mid-way); an e2e regression in which more than 100 transformations exist and the launch-procedure picker offers the newest one, in chromium-en and chromium-ar (create the extra transformations through the API in the spec). Record the failure before the fix. The two failing specs must then pass **unchanged**.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-181 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 7.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/web/**`: `apps/web/src/api/queries.ts`, the screens listed above, their tests, and the new e2e spec.
- **Concurrent owners:** None.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23200–23249 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Disk.** The disk allowance is shared. Do not copy the pnpm store or clone the repository; remove your own temporary databases and outputs when a run ends.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.
- **Tests:** deterministic under load (F-DG4-143 to F-DG4-148); never read whole delivery folders (D-138); never stop processes with `pkill -f` or `pgrep -f`.
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
2. The `unit-web` Vitest project passes with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. Your spec, `p5-procedure-outputs.spec.ts`, `p5-procedures-automation.spec.ts` and `p5-record-name-reflow.spec.ts` pass on the real stack, `--workers=1`, in chromium-en and chromium-ar, in both locale settings, run in that order on one database. Report the counts.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-AB2-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-AB2-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R7, if needed);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
