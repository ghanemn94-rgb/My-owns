# Assignment T-DG4-BE-I2C: P4 implementation, p4-work-split §F+G FG.5 (backend-workflow-engineer) — salvage and completion

## Salvage of the interrupted runs (D-103, D-104)

- **What happened:**
  - the first T-DG4-BE-I2 run was killed by a container restart at about 13:27Z (D-103);
  - the B run (T-DG4-BE-I2B, 13:30Z–14:21Z) reached its final acceptance checks, then died when the session's disk allowance ran out (ENOSPC; D-104). It wrote no handback and no `meta.json`.
- **What they left:** two unverified WIP commits on branch `dg4/be-i2`: `44fffa1` (first run) and `27c0d2c` (B run, 4 files on top). That is your starting point. Both killed runs are kept under `docs/delivery/test-evidence/DG4/{be-i2,be-i2b}-orphaned/` **for provenance only**. Do not cite them, and treat every existing log under your handback evidence folder as stale: delete them and produce fresh ones.
- **Disk:** the orchestrator has freed 22 GB. Before each full test run, check `df -h .`; if free space is under 3 GB, stop and say so in your handback rather than waiting in a loop.
- **Your job:** the scope is the original assignment `docs/delivery/assignments/DG4/T-DG4-BE-I2.md`, reproduced below unchanged.
  1. Review all the WIP critically against your section, the ADRs and the shared rules, as if someone else wrote it. Fix whatever is wrong or missing.
  2. Complete the remaining items.
  3. Run every acceptance check from scratch on your final tree.
- **Handback:** write it as `docs/delivery/handbacks/DG4/T-DG4-BE-I2-backend-workflow-engineer.md`, with logs under `T-DG4-BE-I2-evidence/`. Add a section "Salvage" that lists what you kept from the WIP, what you changed and why, and what you added.
- **Time:** the 2-hour limit counts from your own start.

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/be-i2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-H2, T-DG4-BE-I2, T-DG4-BE-G and T-DG4-KBE-F run in their own worktrees; none owns your files. Everything through BE-F, BE-H, BE-I and FE-B is merged (D-090 to D-102). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p4-work-split.md` §F+G FG.5. It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

- **Media-type pin:** add your JSON-body count to the pin in `contract.test.ts` at your base commit and report the delta in your handback. The orchestrator reconciles concurrent pins at merge.
- **No migration number is yours.** `0047`–`0054` are full. If you need a schema change, stop, put it in your handback, and do not write a migration (the orchestrator allocates repair numbers, D-094).
- **Worker code cannot import API code (ADR-0002 rule 5).** Where your section says the worker calls an API-module service, implement the worker-side function in `apps/worker/src/**` (or in a `packages/shared` pure helper both sides use) and add a parity test that proves the API and worker paths write the same rows for the same input. This is the `createWorkItemOnce` precedent and is decided in D-102.
- **BE-I is merged.** `scheduleAreaReview` is in the API module (`sustainment/performance-areas.ts`); your `sustainment.review_scan` job needs the worker-side path described above.
- **BE-D2 is merged.** The `control_check.failed` consumer exists (`apps/worker/src/handlers/raid.ts`). Prove the end-to-end chain in a worker test: a failed check emits one event, and the consumer opens one recovery case.
- **Closure fixture:** BE-J's closure service is not merged. Use the direct closure-record fixture BE-I used, and say so in your handback.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 24200–24249 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG4/T-DG4-BE-I2-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-BE-I2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
