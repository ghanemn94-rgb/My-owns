# Assignment T-DG4-BE-B: P4 implementation, p4-work-split §I+C.2 (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/be-b`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-KBE-A (slice A pure KPI library) runs in its own worktree, and T-DG4-ARCH-04 (slice E) runs in the main checkout; neither owns your files. BE-A's foundation is merged (registry, stubs, kit, `createWorkItemOnce`, `@mth/shared/time`). BE-C starts after your approval service merges, so make that service's interface final. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p4-work-split.md` §I+C.2. It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **Schema needs** take a repair-range migration number assigned by the orchestrator (`0058`–`0069`). Write none yourself; describe the need in your handback.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23850–23899 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
4. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-BE-B-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-BE-B-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
