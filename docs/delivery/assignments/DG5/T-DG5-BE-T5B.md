# Assignment T-DG5-BE-T5B: P5 implementation, p5-work-split §E.1, §F.5 and §J (this is a **repair task**, D-167: the Added scope below is binding and replaces the sections' file lists) (backend-workflow-engineer)

## Continuation of an interrupted run (read first; D-168, the D-147/D-151/D-158 procedure)

- **What happened.** The first run of T-DG5-BE-T5 (`DG5-T-DG5-BE-T5-backend-workflow-engineer-20261017T165951Z-114d8892`, started about 16:59Z) was stopped by a session restart at about 17:50Z on 2026-10-17 (exit 143, no result line). Its material is kept for provenance only, under `docs/delivery/test-evidence/DG5/BE-T5-orphaned/`.
- Its work is in your worktree `/home/user/wt/dg5-be-t5`, committed as WIP `1d5845e` on branch `dg5/be-t5`. It had **not** written its handback; only its evidence folder exists.
- **Your task is to finish and confirm that work, not to redo it:**
  1. Read the WIP diff (`git show 1d5845e --stat`, then the files) against this assignment's Added scope. Finish anything incomplete: look at the last files written and the end of every log in the evidence folder.
  2. Re-run **every** acceptance check of this assignment on the final tree, with real output. A check reported only by the interrupted run is not evidence; logs it kept in a private temporary folder are lost.
  3. Write the handback, with a first section "Continuation run (T-DG5-BE-T5B)" that names the interrupted run and lists what you found, finished and re-ran. Give every log you produce a `-B` suffix.
- **Concurrency now:** only T-DG5-BE-T5B and T-DG5-FE-D5B run (W22 continuation). ARCH-R2, AN-P5A and AN-P5B are finished.
- Everything else in this assignment applies unchanged.


## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-t5`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Five W22 tasks run at the same time (BE-T5, FE-D5, ARCH-R2, AN-P5A and AN-P5B), each in its own worktree. W1–W21 are merged (D-167). The failing QA tests named in your Added scope were written by independent QA tasks: make them pass by fixing the product, never by editing tests/qa/** or root e2e/**. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §E.1, §F.5 and §J (this is a **repair task**, D-167: the Added scope below is binding and replaces the sections' file lists). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run the Vitest projects and the integration directories your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them, and report them as "not run, D-164", never as passed.
- **Added scope 1 (D-167; QA-F2 D-QA-F2-1, High, mandatory violation proposed: REQ-S12-012): `dependency.slipped` is published.**
  - `packages/shared/src/schemas/events.ts` defines `dependencySlippedV1` but leaves it out of `OUTBOX_EVENT_SCHEMAS` on purpose (BE-J's dry-run concern). So `apps/worker/src/relay.ts` refuses every `dependency.slipped` outbox row:
    - `last_error "no schema for dependency.slipped v1"`;
    - 10 attempts, never published;
    - starter 9 never runs, and no affected owner is notified.
  - While its attempts last, each relay round also stops at that row and delays later events.
  - **Required:**
    - register `dependency.slipped` v1 in `OUTBOX_EVENT_SCHEMAS`;
    - serve its `samplePayload` in the automation builder catalogue (BE-C4's `automation/samples.ts`), so that "every event trigger with a schema has one" stays true;
    - update the dry-run tests that sampled `dependency.slipped` by its condition fields only to the complete v1 payload (ADR-0043, the BE-C3 reading).
  - **Tests:**
    - `tests/qa/integration/a13-dependency-slip-rule-b.test.ts` › "each distinct affected owner is notified ONCE" must pass unchanged. You may not edit `tests/qa/**`.
    - Add your own relay test: a `dependency.slipped` row is published and starter 9's execution succeeds once.
    - Check that no other event type the API enqueues is missing from `OUTBOX_EVENT_SCHEMAS`: list every `eventType` literal the API and worker enqueue against the registry, in the handback and as a unit test.
- **Added scope 2 (D-167; QA-F2 D-QA-F2-3, Low): no orphan export file after a killed attempt.**
  - The storage key is per attempt (`export-runner.ts` `exportStorageKey(org, \`${job.id}-a${attempt_count}\`)`). An attempt killed after `store.put` and before the success commit leaves its file, and nothing removes it.
  - Remove the earlier attempts' files of the same job when an attempt succeeds, or when a new attempt starts. Do it through the store port, idempotently, never touching another job's files.
  - `tests/qa/integration/a13-jobs-rerun.test.ts`'s orphan assertion must pass unchanged. Add your own test.
- **Added scope 3 (D-167; QA-E2 O-1, Low): the seeded pending approval reaches a demo role user.**
  - REQ-S18-002 seeds "pending approval", but no `roaming.user.*` sees a pending approval in `GET /approvals?role=assignee&status=pending`.
  - Route the seeded pending approval to the demo role user its subject's rules name (for example the demo Sponsor or Finance user), so it can be opened from that user's inbox. Keep reset determinism: two resets give identical counts and checksums.
  - **Test:** a demo role user lists the seeded pending approval as assignee.
- **Added scope 4 (D-167, Rule A clarified; REQ-S06-003): an adopted step is acted on in its transformation.**
  - In the W21 verification, `tests/qa/integration/a02-a21-complete-lifecycle.test.ts` › "drives every instance…" fails at `"new_transformation_intake": "draft_charter (TL): 404 not_found"`.
  - After `capture_intake` produced T and the later steps adopted T (`0096`), the produced transformation's Lead (TL on T) cannot read or act on the organization-scope instance, because its read gate and step actors keep organization scope (T-DG5-BE-T4 handback §3.1).
  - In that world nobody holds TL at organization scope, so the intake still cannot be completed by native users.
  - **Decided by D-167:**
    - for a step whose `transformation_id` was adopted (Rule A), the authorization to read the instance for that step and to act on that step (complete, skip, assign, link evidence, inputs where they apply to it) is evaluated on T, the step's transformation, with the step's assignee role;
    - the instance's other steps and its organization-level reads keep organization scope;
    - organization-scope actors who could act before keep their rights.
  - **Tests:**
    - `a02-a21-complete-lifecycle.test.ts` › "drives every instance…" must pass unchanged (all ten completed);
    - your own: T's Lead completes `draft_charter`; a user without TL on T gets 403 or 404 as for any other step;
    - the instance list and read for an organization-scope user are unchanged.
- **Added scope 5 (D-162 e; the freeze rule "every `p5-pending` list empty"):** `apps/api/test/support/p5-pending-be-o.ts` `P5_PENDING_TESTS_BE_O` still lists the REQ-S10-013 presentation test as pending on the `meeting_pack` assembler. That assembler and the composition-root line have been in place since D-159, and the test runs (`it.runIf`). Confirm it runs and passes in `apps/api/test/integration/governance/presentation.test.ts`, then empty the list and keep its type. If the test does not run, say why and leave the entry.
- **Ownership:**
  - `packages/shared/src/schemas/events.ts` (the registry);
  - `apps/api/src/modules/automation/**` (the samples and the dry-run tests);
  - `apps/worker/src/relay.ts` (only if needed);
  - `apps/worker/src/reports/**` (the export runner);
  - `packages/reporting/src/store*` (only if the port needs a delete);
  - `packages/db/src/demo/**`;
  - `apps/api/src/modules/procedures/**` (scope 4);
  - `apps/api/test/support/p5-pending-be-o.ts` (scope 5);
  - your tests.
- **Concurrent owners:** FE-D5 edits `apps/web/**`; ARCH-R2 edits `docs/architecture/**`; the two analysts edit `docs/delivery/requirements.csv`.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23800–23849 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG5/T-DG5-BE-T5-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-T5-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
