# Assignment T-DG5-FE-RG1: DG5 round-5 repair (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after clean re-gate review round 1 on candidate `sha256:8df7f922…` (D-184, D-185).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-rg1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Two repair tasks run in parallel (D-185): T-DG5-FE-RG1 and T-DG5-BE-RG1. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-120 (Medium)** — read it in full in `docs/delivery/findings.json` (reproduction, expected, actual, evidence) and the reporting reviewer's record in `docs/delivery/reviews/DG5/round-1/`.
- **F-DG5-122 (Low)** — read it in full in `docs/delivery/findings.json` (reproduction, expected, actual, evidence) and the reporting reviewer's record in `docs/delivery/reviews/DG5/round-1/`.
- **F-DG5-140 (Low)** — read it in full in `docs/delivery/findings.json` (reproduction, expected, actual, evidence) and the reporting reviewer's record in `docs/delivery/reviews/DG5/round-1/`.
- **F-DG5-141 (Low)** — read it in full in `docs/delivery/findings.json` (reproduction, expected, actual, evidence) and the reporting reviewer's record in `docs/delivery/reviews/DG5/round-1/`.

- **Each reviewer's reproduction is your regression test.** Turn it into a product test, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repairs are decided by D-185** in `docs/delivery/decisions.md`. Read D-185 verbatim.

## Binding scope

- **F-DG5-120:** the notified owner sees, in en and ar, which dependency slipped, by how many days, and how each dependent initiative's forecast finish moved (before → after, or Unknown when not computable, never a blank or zero). Use the existing API `GET /transformations/{id}/dependency-slips` (no contract change); show it on the Dependencies page and on the affected initiative's page, and render the work item's `messageParams` (dependency code, slip days, initiative codes) instead of the generic label. Real-stack e2e from domain's reproduction (demo stack), en and ar.
- **F-DG5-122:** the playbook reader renders table blocks as tables (not raw Markdown) in its lists and the B0024 panel, and one-cell callout tables (B0016, B0124) wrap inside the page at 1280 px, 390 px and 200 % text, en and ar. Use the reader's existing safe rendering (no raw HTML injection).
- **F-DG5-140:** a user who cannot launch any procedure (e.g. AUD) is not offered an enabled launch form on My procedures (read-only note instead, en and ar); the server's 403 stays. e2e as dev.auditor and as a launching role.
- **F-DG5-141:** make `apps/web/e2e/p4-dashboards.spec.ts` test 6 robust under full-suite load without weakening any assertion (find what is slow; a justified per-test budget is acceptable only with the measured reason in the handback).

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-185 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 2.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/web/**` (screens, components, i18n, their tests, `apps/web/e2e/**`).
- **Concurrent owners:** T-DG5-BE-RG1 owns `apps/api/**`, `packages/**` and the root `e2e/**`. Do not edit their files.

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

1. These all exit 0: `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`, `pnpm openapi:lint`.
2. The `unit-web` Vitest project passes with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. Your new specs and `p4-dashboards.spec.ts` pass on the real stack (demo stack where needed), `--workers=1`, chromium-en and chromium-ar, in both locale settings. Report the counts.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-RG1-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-RG1-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R7, if needed);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
