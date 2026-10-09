# Assignment T-DG4-BE-R2: P4 implementation, p4-work-split repair scope (below) (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/be-r2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-R2, T-DG4-BE-F2, T-DG4-BE-M2 and T-DG4-KBE-R2 run in their own worktrees; none owns your files. Everything through W12 (ARCH-R1, BE-R1, KBE-R1, FE-C) is merged (D-090 to D-109). Stay strictly inside your file ownership.
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

## Repair scope (this assignment replaces a work-split section; each item cites its source)

1. **Approval resubmit and withdraw inside the caller's transaction** (ADR-0026 amendment of 2026-10-09, T-DG4-ARCH-R1 item 6): implement `resubmitApprovalInTx` and `withdrawApprovalInTx` in `workflows/approvals.ts` exactly as specified (inputs, effects, refusals including `approval.resubmit_through_record`, audit), export them from `workflows/index.ts` (update the pinned export list), and adopt them in the three subjects' corrected flows: governance matrices (`governance/matrices.ts`, BE-C §4.1: a resubmitted matrix freezes its rows again), transition decisions (`sustainment/transition-decisions.ts`, BE-J: no undecidable approval after a withdrawal), change requests (`workflows/change-requests.ts`, BE-L: retire `change_request.withdraw_via_approval` in favour of the specified flow). Prove each corrected flow end to end, and that a stale approval still answers 409.
2. **Revoked gate exception** (ADR-0035 amendment): approving a submission frozen with an exception that has since been revoked is refused with `gate.exception_revoked` and its exact text; prove it beside BE-K2's expired-exception test.
3. **Weekly cadence** (0060; ADR-0034 amendment): `sustainment/handovers.ts` maps a weekly handover cadence to the benefit's `weekly` control cadence; prove it.
4. **Attempt count for worker handlers** (KBE-R1 handback): `apps/worker/src/worker.ts` passes the job's attempt count to handlers; switch the kpi handler from reading pg-boss's job table to the passed count, and keep KBE-R1's final-retry tests green.
5. **ADR-0025 and ADR-0031 wording** belongs to the architect; list in your handback any text that no longer matches what you built.
- **Media-type pin:** if you add a JSON request body, add it to the pin in `contract.test.ts` at your base commit and report the delta; the orchestrator reconciles concurrent pins.
- **Disk:** check `df -h .` before each full test run; under 3 GB free, stop and report it (D-104).
- **No migration number is yours** (`0001`–`0060` are taken; `0061`–`0069` stay for the orchestrator). If you need a schema change, stop and put it in your handback.
- **Production wiring (D-107):** if a route depends on wiring in `server.ts` that you may not edit, say so first in your handback and add a test that builds the real server through the harness without wiring anything by hand.
- **Worker code cannot import API code (ADR-0002 rule 5);** use a worker-side function with a parity test (D-102).
- **Codes:** use the codes and English texts of the ARCH-R1 consolidated table (`docs/delivery/handbacks/DG4/T-DG4-ARCH-R1-solution-architect.md`) and the ADR amendments of 2026-10-09; a new code needs your handback to say so.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 24950–24999 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG4/T-DG4-BE-R2-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-BE-R2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
