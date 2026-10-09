# Assignment T-DG4-KBE-FB: P4 implementation, p4-work-split §F+G FG.3 (kpi-benefits-engineer) — salvage and completion

## Salvage of the interrupted run (D-103; the D-059/D-070 precedent)

- **What happened:** the first T-DG4-KBE-F run started at about 12:55Z and was killed by a container restart at about 13:27Z, after roughly 32 minutes. It wrote no handback and finished no verification.
- **What it left:** the orchestrator committed its working tree, unverified, as WIP commit `6a07de4` on branch `dg4/kbe-f`, which is your starting point. The killed run's transcript is kept at `docs/delivery/test-evidence/DG4/kbe-f-orphaned/` **for provenance only**. Do not cite it, and do not trust its partial logs: any log under your handback evidence folder from before this run is stale, so delete it and produce fresh ones.
- **Your job:** this assignment is the complete scope (the original assignment `docs/delivery/assignments/DG4/T-DG4-KBE-F.md` is reproduced below unchanged).
  1. Review the WIP critically against your section, the ADRs and the shared rules, as if someone else wrote it. Fix whatever is wrong or missing.
  2. Complete the remaining items.
  3. Run every acceptance check from scratch on your final tree.
- **Handback:** write it as `docs/delivery/handbacks/DG4/T-DG4-KBE-F-<role>.md` (the original task's name), with logs under `T-DG4-KBE-F-evidence/`. Add a section "Salvage" that lists what you kept from the WIP, what you changed and why, and what you added.
- **Time:** the 2-hour limit counts from your own start.


## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/kbe-f`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-H2, T-DG4-BE-I2, T-DG4-BE-G and T-DG4-KBE-F run in their own worktrees; none owns your files. Everything through BE-F, BE-H, BE-I and FE-B is merged (D-090 to D-102). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p4-work-split.md` §F+G FG.3. It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

- **Media-type pin:** add your JSON-body count to the pin in `contract.test.ts` at your base commit and report the delta in your handback. The orchestrator reconciles concurrent pins at merge.
- **No migration number is yours.** `0047`–`0054` are full. If you need a schema change, stop, put it in your handback, and do not write a migration (the orchestrator allocates repair numbers, D-094).
- **Worker code cannot import API code (ADR-0002 rule 5).** Where your section says the worker calls an API-module service, implement the worker-side function in `apps/worker/src/**` (or in a `packages/shared` pure helper both sides use) and add a parity test that proves the API and worker paths write the same rows for the same input. This is the `createWorkItemOnce` precedent and is decided in D-102.
- **`createBelowTrajectoryIntervention`** is in BE-H's `adoption/interventions.ts` (API). Your consumer needs the worker-side path above, with one intervention, one work item and one `adoption.check_failed` per trigger, exactly as BE-H's tests prove for the API path.
- **Event fan-out (D-102): you are authorized to edit `apps/worker/src/relay.ts`, `apps/worker/src/queues/index.ts` and `apps/worker/src/queues/raid.ts`.** `kpi.deviation_evaluated` already goes to `raid.corrective_kpi`, and an event type maps to exactly one queue today. Change the mapping so an event type maps to a list of queues, and make the relay send to every queue in the same transaction (all or none). Each job needs a distinct, deterministic job id per (event, queue). Keep the existing single-queue behaviour byte-stable for every other event. Add your `adoption.indicator_evaluated` queue for `kpi.deviation_evaluated` alongside RAID's. Prove with worker tests: one event reaches both consumers exactly once; a relay retry duplicates nothing; an event type with no queue is still a recorded relay failure.
- **Entity-group test split (D-102):** add the AdoptionMetricLink case (create and read through the API, AUD-403 on the write, 404 outside scope) in `test/integration/adoption/entity-group-metric-link.test.ts`. BE-H2 owns `entity-group.test.ts`.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 24300–24349 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG4/T-DG4-KBE-F-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-KBE-F-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
