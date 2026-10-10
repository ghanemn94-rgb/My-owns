# Assignment T-DG4-KBE-R4: implement ARCH-R3 (drill-down valueClass and metrics, cumulative lineage) (kpi-benefits-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/kbe-r4`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-R4, T-DG4-KBE-R4, T-DG4-QA-C and T-DG4-FE-R2 run in their own worktrees; none owns your files. Everything through W17 (ARCH-R3, FE-F2, FE-G2, QA-B) is merged (D-090 to D-114). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It gives your file ownership and what to prove. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope (this assignment replaces a work-split section)

Implement **exactly** the "kpi-benefits-engineer task" list in `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-solution-architect.md` §6, items 1–2:
1. the drill-down `valueClass` parameter and the `value.measured`, `value.rejected` and `value.sustained` metrics. This includes the K1 item 4 invariant test over every class line, and the scope sweep;
2. `windowValues` lineage on cumulative entries, with the C5 tests.
3. **Root-cause the `benefits-queue.test.ts` failure (D-114):**
   - **What fails:** `apps/worker/test/integration/benefits-queue.test.ts` › "one queue item; a redelivery and a restarted worker write no second item" times out at line 109, in `waitFor(queueItemOf…)` with its 15 s default.
   - **When:** it fails in the full integration suite at `0a3da46`, with no agent running and low load. It passes alone, and it passed in the full suite at `c441586`. Between those two commits, W17 added 51 `tests/qa` integration tests that write many outbox events into the shared database.
   - **Orchestrator's hypothesis:** the production worker started by the test drains a larger backlog of other queues' jobs before it reaches this test's job.
   - **Do:** prove or disprove the hypothesis with evidence, such as job counts and timings from a full-suite run. Then fix the cause, for example by scoping the test's worker or isolating its database state, so the test does not depend on what other files left behind.
   - **Never** only raise a timeout, and never skip the test. Show the full integration suite passing with the fix, and the failure reproduced before it.

Read ADR-0037 amendment K1–K2 and ADR-0027 amendments C4–C5 (2026-10-10) first.

- **Byte stability:** every existing dashboard and KPI response stays byte-identical, except:
  - the `drilldownHref` of the Finance class lines (K1);
  - the added `windowValues` (C5).
  Prove it with the response-transcript method of BE-M2/BE-R3, and list each changed member.
- **Unknown, never 0:** a value class or state without lines drills to an empty, labelled result, never a fabricated 0 (ADR-0037 §5).
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 26000–26049 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG4/T-DG4-KBE-R4-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-KBE-R4-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
