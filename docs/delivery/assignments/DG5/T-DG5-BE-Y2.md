# Assignment T-DG5-BE-Y2: DG5 round-3 repair (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 3 on candidate `sha256:fc93b239…` (D-174).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-y2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Three repair tasks run at the same time (D-174): T-DG5-BE-Y1, T-DG5-BE-Y2 and T-DG5-FE-Y1, each in its own worktree, at the round-3 candidate's tree plus the round-3 records. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-102** (Low; REQ-S16-001; reported by code-security-reviewer in `docs/delivery/reviews/DG5/round-3/code-security-reviewer.json`): Test reliability: the ADR-0002 module-boundary unit test exceeds its fixed 30 s budget in full Node 22 unit runs under review load (2 of 3 runs), so pnpm test exits 1 with no product defect.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/code-security/round-3/04-unit-node22.log`, `docs/delivery/test-evidence/DG5/code-security/round-3/04b-unit-node22-run2.log`, `docs/delivery/test-evidence/DG5/code-security/round-3/04c-unit-node22-run3.log`, `docs/delivery/test-evidence/DG5/code-security/round-3/04a-unit-node22-architecture-rerun.log`, `docs/delivery/test-evidence/DG5/code-security/round-3/03-unit-node24.log`, `docs/delivery/test-evidence/DG5/code-security/round-3/08-scans.log`.
- **F-DG5-145** (Low; REQ-S16-001; reported by qa-verifier in `docs/delivery/reviews/DG5/round-3/qa-verifier.json`): The unit check 'API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages' (apps/api/src/architecture.test.ts) has outgrown its 30 s budget under review load: it timed out in 4 of 6 full Node 22 'pnpm test' runs on this candidate (30.2 s to 67.0 s), so the required unit check fails for load alone.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/qa/round-3/02-unit-node22-unset.log`, `docs/delivery/test-evidence/DG5/qa/round-3/02-unit-node22-cutf8.log`, `docs/delivery/test-evidence/DG5/qa/round-3/02-unit-node22-unset-rerun.log`, `docs/delivery/test-evidence/DG5/qa/round-3/02-unit-node22-cutf8-rerun.log`, `docs/delivery/test-evidence/DG5/qa/round-3/02-unit-node22-unset-architecture-alone.log`, `docs/delivery/test-evidence/DG5/qa/round-3/02-unit-node22-unset-rerun2.log`.

- **The reproduction is a load timeout, not a failing assertion.** You cannot recreate the reviewers' load without breaking the load rule below, so do not try. Your evidence is:
  - the measured durations before and after (alone, on both Node versions);
  - the budget's headroom over the 67 s loaded worst case;
  - the existing negative and positive control tests passing unchanged, which show that no rule is weakened.
- **The repair is decided by D-174** in `docs/delivery/decisions.md`. Read D-174 verbatim (and D-172, D-173 for the wave-X repairs it builds on); the scope below restates it.

## Binding scope

- **Decided (D-174): the ADR-0002 module-boundary unit test is reliable under the load the delivery process creates.** F-DG5-102 and F-DG5-145 are one defect, reported by two reviewers.
  - `apps/api/src/architecture.test.ts:200`, 'every import respects dependsOn, public surfaces and allowed packages', walks and lints every API module file with the AST lint in `apps/api/src/architecture.testkit.ts`. F-DG2-143 gave it `AST_TEST_TIMEOUT_MS = 30_000` when it took about 1.5 s alone.
  - It now takes about 9 s unloaded (D-173), 12.7–17.4 s alone, and 30–67 s under review load. It timed out in 6 of 9 loaded Node 22 runs in round 3. No assertion ever failed.
  - **First, profile the walk** (alone, on Node 22 and Node 24) and make it cheaper where that weakens no rule. For example:
    - each file is read and parsed once and shared across the rules;
    - no file is parsed twice for the module and the cross-module checks;
    - no repeated filesystem walk.
    Every rule in the file header (1 to 5, the evasion checks, the allow-lists, the positive controls) must keep exactly its meaning. The existing negative and positive control tests in the same file must all pass unchanged. They prove a violation is still caught.
  - **Then set the budget.** The full-walk test gets its own explicit budget, at least 150 s: more than 2x the 67 s worst loaded case, whatever the speed-up. Add a comment that cites F-DG2-143, F-DG5-102/145 and D-174 and gives the measurements.
    - Do not change the budget of the module-owned tests that import `AST_TEST_TIMEOUT_MS` (reporting, methodology, workflows, kpi, evidence), unless your measurement shows that one of them also exceeds a third of its budget alone; if so, report it.
  - **Report:**
    - the test's duration alone before and after, on Node 22 and Node 24, three runs each;
    - the whole `unit-node` project's duration before and after.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-174 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 4.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/api/src/architecture.test.ts` and `apps/api/src/architecture.testkit.ts` only.
- **Concurrent owners:** T-DG5-BE-Y1 edits `packages/db/src/demo/**` and the demo tests; T-DG5-FE-Y1 edits `apps/web/**`. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23000–23049 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Disk.** The disk allowance is shared with two other tasks. Do not copy the pnpm store or clone the repository; remove your own temporary databases and outputs when a run ends.
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
2. The `unit-node` Vitest project passes with the locale unset and with `C.UTF-8`, one at a time, on Node 24 (`/opt/nvm/versions/node/v24.21.0/bin`) and on Node 22 (`/opt/node22/bin`). Report the counts and durations.
3. `apps/api/src/architecture.test.ts` alone passes three times on each Node version. Report each duration, before and after your change.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-Y2-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-Y2-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R6);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
