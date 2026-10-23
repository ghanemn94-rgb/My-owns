# Assignment T-DG5-BE-RG1: DG5 round-5 repair (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after clean re-gate review round 1 on candidate `sha256:8df7f922…` (D-184, D-185).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-rg1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Two repair tasks run in parallel (D-185): T-DG5-FE-RG1 and T-DG5-BE-RG1. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-121 (Low)** — read it in full in `docs/delivery/findings.json` (reproduction, expected, actual, evidence) and the reporting reviewer's record in `docs/delivery/reviews/DG5/round-1/`.
- **F-DG5-101 (Low)** — read it in full in `docs/delivery/findings.json` (reproduction, expected, actual, evidence) and the reporting reviewer's record in `docs/delivery/reviews/DG5/round-1/`.
- **F-DG5-142 (Low)** — read it in full in `docs/delivery/findings.json` (reproduction, expected, actual, evidence) and the reporting reviewer's record in `docs/delivery/reviews/DG5/round-1/`.
- **F-DG5-100 (Low)** — read it in full in `docs/delivery/findings.json` (reproduction, expected, actual, evidence) and the reporting reviewer's record in `docs/delivery/reviews/DG5/round-1/`.

- **Each reviewer's reproduction is your regression test.** Turn it into a product test, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repairs are decided by D-185** in `docs/delivery/decisions.md`. Read D-185 verbatim.

## Binding scope

- **F-DG5-121:** the demo dataset's launch plan carries its Day-90 leadership test, created through the same invariant as `apps/api/src/modules/launch/plan.ts` (or the same row shape and scheduling), so the roaming Day-90 page is truthful in en and ar. Seed test plus a demo-stack check.
- **F-DG5-101:** a negative decimal of more than 15 significant digits is written in CSV (and every export path sharing `valueCell`) without the formula-injection apostrophe, per ADR-0046 §4; injection-looking text keeps its protection. Unit tests for positive/negative/long/short and a real injection string.
- **F-DG5-142:** make `e2e/a22-operations-jobs.spec.ts` immune to a schedule boundary between its API read and its screen read (e.g. read both in one consistent snapshot or assert on a stable value), without weakening what it proves. Run it across a */15 boundary to show it.
- **F-DG5-100:** the migration runner (`packages/db/src/migrate.ts`) refuses to apply a pending migration whose id is lower than the highest applied id (clear error, en log text), and the numbering test pins the eight P5 gaps (0066, 0067, 0073, 0077, 0078, 0079, 0083, 0084) as permanently unused. Tests for both. No existing migration changes.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-185 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 2.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/api/**`, `packages/db/**`, `packages/reporting/**`, the root `e2e/a22-operations-jobs.spec.ts`, and their tests.
- **Concurrent owners:** T-DG5-FE-RG1 owns `apps/web/**`. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23150–23199 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Disk.** The disk allowance is shared. Do not copy the pnpm store or clone the repository; remove your own temporary databases and outputs when a run ends.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.
- **Tests:** deterministic under load (F-DG4-143 to F-DG4-148); never read whole delivery folders (D-138); never stop processes with `pkill -f` or `pgrep -f`.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Acceptance (real output in the handback)

1. These all exit 0: `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`, `pnpm openapi:lint`.
2. The unit and integration tests your change reaches pass with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. `e2e/a22-operations-jobs.spec.ts` passes on the real stack in chromium-en and chromium-ar in both locale settings, including one run across a schedule boundary; the demo seed test passes.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-RG1-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-RG1-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R7, if needed);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
