# Assignment T-DG5-FE-D4: P5 implementation, p5-work-split §C.2 (this is a **repair task**, D-166: your screens are the procedure instance page and its spec; the Added scope below is binding) (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-d4`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Five W21 tasks run at the same time (T-DG5-ARCH-R1, BE-T4, FE-D4, QA-E2 and QA-F2), each in its own worktree. W1–W20 are merged and verified (D-166). Stay strictly inside your file ownership; you may not edit tests/qa/** or root e2e/**. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §C.2 (this is a **repair task**, D-166: your screens are the procedure instance page and its spec; the Added scope below is binding). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Frontend rules:** every string in en and ar (RTL); accessible labels and keyboard use (axe clean, scroll regions focusable); Unknown/Stale never shown as zero or green; server errors shown by their code, with the en/ar text of every problem code your screens can receive (add missing keys to `problems.json` and check for duplicates). Register routes and navigation entries with appended lines only. When your screens ship a feature that a nav, landing or admin string calls "Planned" or "not available yet", correct that string and its chip in both languages (F-DG4-160).
- **e2e:** add Playwright coverage of each screen's main path and its main refusal; run your own specs and those of the pages you touch.
- **Evidence size (D-162):** commit the screenshots of your own specs and of any failure you cite only. Never commit a full-suite screenshot or trace folder.
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run the Vitest projects and the integration directories your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them, and report them as "not run, D-164", never as passed.
- **Added scope 1 (D-166; REQ-S06-002, REQ-S06-003, REQ-S18-004): a procedure step's output record can be chosen in the UI.**
  - `apps/web/src/pages/procedures/InstancePage.tsx` (`StepActions`, ~line 355) completes a step with a note only. It never sends `outputRecordId`.
  - `ProcedureStepComplete` (`docs/api/openapi.yaml`) requires it for a `create` output, where the record was produced natively first, and for a `link` output. Otherwise the server answers 422 `procedure_step.output_required`.
  - So no `create` or `link` step (for example `baseline_validation.record_baseline`) can be completed from the screen.
  - **Required:** for an active step whose output kind is `create` or `link`:
    - offer a selector of the eligible records of the step's record type in the instance's transformation, read through that record type's own list operation;
    - link to the screen where the record is produced natively, when none exists yet;
    - send `outputRecordId`.
  - An `advance` step keeps today's form. Server refusals show by their code in en and ar.
  - **Tests:** unit tests per output kind, and an e2e in en and ar:
    - the TL launches `baseline_validation` on a new transformation;
    - records a baseline natively;
    - completes `record_baseline` choosing it;
    - the step moves to FIN.
- **Added scope 2 (D-165 `0095`; D-166): `apps/web/e2e/p5-procedures-automation.spec.ts` "My procedures: launch baseline validation…".**
  - It pins BO as `record_baseline`'s assignee and uses the TL as the refused non-assignee. `procedures` v2 (`0095`, REQ-PB-027) assigns TL.
  - Update it: the step shows TL. The main refusal becomes either:
    - completing without an output → `procedure_step.output_required`; or
    - a non-assignee (for example `dev.office`) → `procedure_step.not_assignee`.
  - Keep every other assertion. Say which refusal you chose and why.
- **Ownership:** `apps/web/src/pages/procedures/**`, `apps/web/e2e/p5-procedures-automation.spec.ts`, your own e2e specs, and i18n keys as appended lines.
- **Concurrent owners:**
  - BE-T4 edits `apps/api/src/modules/procedures/**`, Rules A and B, `0096`;
  - ARCH-R1 edits `docs/architecture/**`;
  - QA-E2 and QA-F2 edit `tests/qa/**` and root `e2e/**`.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23750–23799 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. `npx vitest run --project unit-web` passes with the locale unset and with `C.UTF-8` (D-164 load rule). Report the counts. The repository-wide `pnpm test` is not yours to run; report it as "not run, D-164".
3. Your own e2e specs and `apps/web/e2e/p5-procedures-automation.spec.ts` pass in chromium-en and chromium-ar. `pnpm test:integration` and the full e2e suite are not yours to run (D-164).
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-D4-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-D4-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
