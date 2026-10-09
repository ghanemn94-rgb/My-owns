# Assignment T-DG4-BE-R1: P4 implementation, p4-work-split repair scope (below) (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/be-r1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-ARCH-R1 runs in the main tree; T-DG4-BE-R1, T-DG4-KBE-R1 and T-DG4-FE-C run in their own worktrees; none owns your files. Everything through W11 is merged (D-090 to D-108). Stay strictly inside your file ownership.
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

## Repair scope (this assignment replaces a work-split section; each item cites the handback that reported it, under `docs/delivery/handbacks/DG4/`)

You may edit the files each item names, and their tests. Keep every other response byte-stable and prove it with the existing suites.

1. **Work items follow their source** (BE-D, BE-D2, BE-H and BE-G handbacks; D-102, D-105). In the tasks module (BE-A's `apps/api/src/modules/tasks/**` and its worker-side counterpart), add a reschedule service (a source's due date changes → its open work item's due date follows) and a reassign service (owner A → B closes A's open item and opens one for B; A → B → A leaves exactly one open item, for A). Both idempotent, audited, and with a parity test for the worker path (D-102). Adopt them in: RAID actions (`raid/actions.ts`), corrective cases (`raid/corrective-cases.ts`), adoption interventions (`adoption/interventions.ts`), executive-decision asks (`governance/executive-decisions.ts`). Prove each consumer: change the date → the open item's due date changes; A → B → A → one open item for A.
2. **`corrective_case_follow_up` is system-managed** (BE-D2 handback): add it to the tasks module's system-managed kinds so an owner cannot complete it by hand; prove the refusal.
3. **BE-J server path** (D-107): a test that builds the real server through the harness WITHOUT calling `wireTransitionDecisionApprovals` by hand, submits a transition decision and gets 2xx. Put it in a new file so no other test's wiring can leak into it.
4. **KBE-C import** (KBE-C handback): `server.ts` imports the approval service from `workflows/approvals.ts` directly; switch every such import to `workflows/index.ts`, which now exports them (BE-C). `server.ts` edits are allowed for this item only.
5. **Benefit register mirror** (BE-M handback §2.1): add `initiatives: z.array(z.strictObject({ id: uuid, code: z.string(), name: z.string() })).optional()` inline to `benefitRegisterRow` in `packages/shared/src/schemas/benefits.ts`, and a contract test that parses a NON-empty register page with it.
6. **Duplicate corrective case message** (BE-D2 handback): the database backstop says `(unknown)` where the case code belongs. Make the service path the only path that can produce this refusal, or read the code in the mapper; prove the text.
- **Media-type pin:** if you add a JSON request body, add it to the pin in `contract.test.ts` and report the delta.
- **Disk:** check `df -h .` before each full test run; under 3 GB free, stop and report it (D-104).
- **No migration number is yours** (`0060` and `0061` are ARCH-R1's). If you need a schema change, stop and put it in your handback.
- **Not yours:** the approval service's in-transaction resubmit and withdraw (ARCH-R1 specifies them; a later BE-R2 implements them), and every contract or ADR change (ARCH-R1).

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 24800–24849 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG4/T-DG4-BE-R1-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-BE-R1-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
