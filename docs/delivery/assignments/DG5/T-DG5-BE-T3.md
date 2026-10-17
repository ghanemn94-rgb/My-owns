# Assignment T-DG5-BE-T3: P5 implementation, p5-work-split §J and §C.2 (this is a **repair task**, D-165: the Added scope below is binding and replaces the sections' file lists) (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-t3`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four W20 tasks run at the same time (BE-C4, BE-T3, KBE-D4 and FE-D3), each in its own worktree; no architecture task runs. W1–W19 are merged and verified (D-165). The failing QA tests named in your Added scope were written by independent QA authoring tasks: make them pass by fixing the product, never by editing them (you may not edit tests/qa/** or root e2e/**). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §J and §C.2 (this is a **repair task**, D-165: the Added scope below is binding and replaces the sections' file lists). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run the Vitest projects and the integration directories your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them, and report them as "not run, D-164", never as passed.
- **Added scope 1 (D-165; QA-E D-QA-E-1, High): the demo role users can do the walkthrough on a new transformation.**
  - `packages/db/src/demo/data/roaming.ts` `seedFoundation` gives every demo user only a `transformation`-scope grant on the seeded roaming transformation. So `roaming.user.tl` gets 404 on `POST /api/v1/transformations` in the demo business unit, and no demo user can reach a new transformation.
  - ADR-0050 §7 step 1 must be a new transformation, performed by the demo role users.
  - **Required:** grant the demo role users their roles at the demo business-unit scope (least privilege: the roles the walkthrough's steps need; no ADM role beyond what a demo access administrator needs, if one is needed at all). They then hold `transformation.create` there and their roles on new transformations of that unit.
  - Keep the reset deterministic: two resets give identical counts and checksums. Update the dataset's pinned counts and checksums with the reason.
  - **Tests:** `tests/qa/integration/a02-a21-complete-lifecycle.test.ts` › "step 1 'create transformation' is performed by the demo Transformation Lead in the demo business unit" must pass unchanged, and the reset-twice suites stay green.
- **Added scope 2 (D-165): demo users can sign in on a dev-mode demo database.**
  - Today the demo users' identities name only the demo IdP issuer (ADR-0050 §"Demo users"), which exists only in a demo deployment. The e2e stack runs `AUTH_MODE=dev`, so no browser can sign them in, and REQ-S18-004's e2e "with the demo role users" cannot run.
  - **Decided by D-165:** when `seed-demo` runs with `AUTH_MODE=dev` (and never with `NODE_ENV=production` or any other auth mode), it also binds each demo user to the dev issuer (`DEV_ISSUER`), so the dev sign-in can choose them. In every other mode nothing changes.
  - No secret and no password. The demo IdP identities stay as they are.
  - **Tests:** dev mode creates the dev identities; production mode and a non-dev auth mode create none; the demo IdP identities are unchanged.
- **Added scope 3 (D-165; QA-E D-QA-E-2, Medium): the intake procedure completes.**
  - `apps/api/src/modules/procedures/steps.ts:651` (`requestStepApproval`) returns without requesting an approval when `step.transformation_id` is null. An organization-scope `new_transformation_intake` instance keeps null step transformations even after `capture_intake` produced the transformation, so `confirm_sponsor` (SP) never gets an approval.
  - Route the approval to the transformation the instance produced, for example by carrying it to the later steps when `capture_intake` completes.
  - **Tests:** `a02-a21-complete-lifecycle.test.ts` › "drives every instance through its steps …" must pass unchanged (all ten complete), plus your own test of the intake path.
- **Added scope 4 (D-165; QA-F's REQ-S12-012 observation): a slip moves the dependent forecasts.**
  - `apps/api/src/modules/portfolio/slip-events.ts` computes each affected dependent's `forecastFinishBefore` and `forecastFinishAfter` with `predecessorFinish` over the dependent's own milestones, so they never differ. `starters-be-j.test.ts` even asserts before = after.
  - ADR-0044 §7 says "the moved dependent forecasts are what the DG4 schedule read returns after the change", and REQ-S12-012 reads "a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic".
  - Compute before and after with the DG4 scheduling functions that propagate through dependencies (ADR-0023 §5, ADR-0031 `schedule-network.ts`), on the before and after milestone sets.
  - **Tests:** a predecessor slip of 5 days on a driving dependency moves the dependent's forecast finish by 5 days in the slip's `affected`, and the schedule read agrees. A dependent that is not driven by the slipped predecessor does not move.
  - If the DG4 functions do not propagate forecasts through dependencies at all, stop: change nothing in DG4, and write the gap in the handback for the orchestrator.
- **Added scope 5 (D-165; QA-E O-2, Medium): the baseline step's assignee.**
  - The seeded `baseline_validation.record_baseline` step (`0069`) is assigned to BO. REQ-PB-027 gives baseline create and edit to TL and KDS (`0018`), so the assignee cannot produce the step's output.
  - Correct the assignee to TL through the procedures configuration's own versioning (ADR-0042; ADR-0039 publish rules), never by editing a published version or an applied migration. Use repair migration **`0095`** (additive), if a seed is needed.
  - Say which transformations get the corrected definition (new ones) and why existing pins are not moved.
  - **Tests:** a new transformation's `baseline_validation` instance assigns `record_baseline` to TL, and TL can complete it end to end.
- **Ownership:**
  - `packages/db/src/demo/**`, `packages/db/src/cli.ts` (the dev binding only), the demo dataset tests;
  - `apps/api/src/modules/procedures/**`;
  - `apps/api/src/modules/portfolio/slip-events.ts` and its tests;
  - migration `0095` (and `0096` if a second is needed).
- **Concurrent owners:** BE-C4 edits `apps/api/src/modules/workflows/**`, the automation catalogue, migration `0094` and three OpenAPI spots; KBE-D4 edits `reporting/**` and one line each in `benefits/index.ts`, `workflows/index.ts` and `server.ts`; FE-D3 edits `apps/web/**` and possibly `packages/design-tokens/**`.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23850–23899 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. The integration directories and files your change reaches, including the QA files named in your Added scope, pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`. Report the counts and any pinned-count change. `pnpm test:integration` and the full e2e suite are not yours to run (D-164).
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-T3-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-T3-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
