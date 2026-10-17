# Assignment T-DG5-BE-T4: P5 implementation, p5-work-split §C.2 and §E.1 (this is a **repair task**, D-166: the Added scope below is binding and replaces the sections' file lists) (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-t4`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Five W21 tasks run at the same time (T-DG5-ARCH-R1, BE-T4, FE-D4, QA-E2 and QA-F2), each in its own worktree. W1–W20 are merged and verified (D-166). The QA tasks write tests for Rules A and B from D-166 at the same time: make them pass by implementing the rules exactly, never by editing tests/qa/** or root e2e/**. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §C.2 and §E.1 (this is a **repair task**, D-166: the Added scope below is binding and replaces the sections' file lists). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run the Vitest projects and the integration directories your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them, and report them as "not run, D-164", never as passed.
**Rule A, decided by D-166 (the intake adopts the transformation it produced; BE-T3 handback §3.3 option (a)).**
- When the `capture_intake` step of an organization-scope `new_transformation_intake` instance is completed with `outputRecordId` = T (a transformation), every step of the same instance that has not started gets `transformation_id = T` in the same transaction.
- This is the only change of `procedure_step_instance.transformation_id` ever allowed: from NULL to T, once; for a step that has not started; of an instance whose own `transformation_id` is NULL; and only to the transformation named by that instance's `capture_intake` output link. Repair migration `0096` narrows the P2 identity guard of `procedure_step_instance` to exactly this transition. Every other change stays refused.
- Each adopted step takes the P2 version step and one audit event.
- The instance keeps its launch scope (organization).
- Approvals of the adopted steps are requested on T and routed by T's role mappings (DG4 `resolveParty`, never a fallback). Until T has a mapped Sponsor, `confirm_sponsor` keeps today's truthful "awaiting routing" next action.

**Rule B, decided by D-166 (REQ-S12-012 "moves dependent forecasts per the logic"; M0232 "recompute forecast impacts using defined scheduling logic"; ADR-0044 §7).**
- `forwardFinish(S, set)` for an initiative S over a milestone set:
  - `own = predecessorFinish(S, set)` (ADR-0023 §5, unchanged);
  - if S has no scheduled finish-to-start predecessor, it is `own`;
  - otherwise `required` is the latest, over S's scheduled predecessors P, of the first date ADR-0023 §5 allows S to start after `forwardFinish(P, set)`;
  - `shift = max(0, required − S.planned_start)` in calendar days;
  - the result is `own + shift`.
- If S has a scheduled predecessor but no `planned_start`, or any input date is missing, the result is Unknown (`null`), never 0 or the unshifted date.
- Cycles cannot occur, because DG4 refuses dependency cycles.
- A slip's `affected` entries record `forecastFinishBefore = forwardFinish(S, before set)` and `forecastFinishAfter = forwardFinish(S, after set)`, for every initiative reachable from the slipped predecessor. The sets differ only in the slipped predecessor's milestone.
- Nothing is stored or overwritten except the slip's own `affected` evidence (ADR-0044 §7). A dependent with enough slack does not move; one with no slack moves by the slip.

- **Added scope 1 (D-166 Rule A; QA-E D-QA-E-2; REQ-S06-003):** implement Rule A (above) in `apps/api/src/modules/procedures/**` and migration **`0096`** (additive: replace the P2 identity guard on `procedure_step_instance` with one that allows only Rule A's transition).
  - **Tests:**
    - an organization-scope intake instance adopts T when `capture_intake` completes;
    - every other `transformation_id` change is still refused at the database (a direct UPDATE, a second adoption, a started step, a non-intake instance, a different transformation);
    - with a Sponsor assigned and mapped on T, `confirm_sponsor` requests an approval on T, the Sponsor decides it, and the instance completes;
    - without a mapped Sponsor, the step waits truthfully.
- **Added scope 2 (D-166 Rule B; REQ-S12-012):** implement Rule B in `apps/api/src/modules/portfolio/slip-events.ts`, as a pure function in `portfolio/schedule.ts`, beside `predecessorFinish` (unchanged).
  - **Tests:**
    - unit: no slack (moves by 5), enough slack (no move), partial slack, a chain of two, two predecessors, a missing `planned_start` (Unknown);
    - integration: a 5-day slip notifies each affected owner once, and the slip's `affected` forecasts move per Rule B.
  - Update `apps/api/test/integration/automation/starters-be-j.test.ts`'s before = after expectation to Rule B. It is an implementer test, so say so in the handback.
- **Added scope 3 (BE-T3 handback §6.4):** `apps/worker/src/handlers/demo.ts` passes `devIssuerBinding: demoDevIssuerBindingAllowed(process.env)` to `resetDemo`, so an in-app reset of a dev-mode demo database keeps the dev sign-in. Export the guard from `@mth/db` if needed. Test it.
- **Ownership:** `apps/api/src/modules/procedures/**`, `apps/api/src/modules/portfolio/{schedule.ts,slip-events.ts}` and their tests, `starters-be-j.test.ts`, `apps/worker/src/handlers/demo.ts`, the `@mth/db` export of the guard, and migration `0096`.
- **Concurrent owners:**
  - T-DG5-ARCH-R1 writes the ADR amendments for Rules A and B and the data dictionary. Do not edit `docs/architecture/**`.
  - QA-E2 and QA-F2 write `tests/qa/**` and root `e2e/**`.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23700–23749 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. The Vitest projects your change reaches pass with the locale unset and with `C.UTF-8`, run one at a time (D-164 load rule). Report the commands and counts. The repository-wide `pnpm test` is not yours to run; report it as "not run, D-164".
3. The integration directories and files your change reaches pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`, including `procedures`, `automation`, `portfolio`, `contract` and `packages/db/test/integration`. Report the counts and any pinned-count change. `pnpm test:integration` and the full e2e suite are not yours to run (D-164).
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-T4-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-T4-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
