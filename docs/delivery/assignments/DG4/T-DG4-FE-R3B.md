# Assignment T-DG4-FE-R3B: salvage and completion of T-DG4-FE-R3 (frontend-ux-engineer)

## Salvage of the interrupted run (D-103; the D-059/D-070 precedent)

- **What happened:** the first T-DG4-FE-R3 run started at 15:41Z. A container restart killed it at about 15:59Z, after about 17 minutes, before it finished anything. It left no `meta.json` and no result.
- **What it left:**
  - The orchestrator committed its working tree, unverified, as WIP commit `7a4e4f0` on branch `dg4/fe-r3`. That commit is your starting point.
  - The killed run's transcript is kept at `docs/delivery/test-evidence/DG4/fe-r3-orphaned/` **for provenance only**. Do not cite it.
  - Do not trust any partial work in the WIP: review all of it.
- **Your job:** this assignment is the complete scope. The original assignment, `docs/delivery/assignments/DG4/T-DG4-FE-R3.md`, is reproduced below unchanged.
  1. Review the WIP critically.
  2. Complete every item.
  3. Run every acceptance check from scratch on your final tree.
- **Handback:** write it as `docs/delivery/handbacks/DG4/T-DG4-FE-R3-frontend-ux-engineer.md`, with logs under `T-DG4-FE-R3-evidence/`. Add a section "Salvage" that lists what you kept, changed and added.
- **Time:** the 2-hour limit counts from your own start.
- **Concurrency:** T-DG4-QA-D runs at the same time in its own worktree. The two register halves (AN-P4A, AN-P4B) are merged; you do not touch `requirements.csv`.

---

## Original assignment: T-DG4-FE-R3: adopt ARCH-R3 in the web app, the G3 submit warning, and the ADR-table translation guard (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-r3`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-FE-R3, T-DG4-AN-P4A and T-DG4-AN-P4B run in their own worktrees; none owns your files. Everything through W18 (BE-R4, KBE-R4, QA-C, FE-R2) is merged (D-090 to D-115). Stay strictly inside your file ownership.
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

1. **Adopt ARCH-R3.** Implement **exactly** the "FE-R3 (frontend-ux-engineer)" list in `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-solution-architect.md` §6, items 1–7:
   - the schedule panel reads `getInitiativeSchedule`;
   - the Modular waiver refusals show `params.date`, localized;
   - the scale-scope editor uses `listScaleScopeBusinessUnits`;
   - every Finance class line drills down, and the new rule and refusal keys are added;
   - the assessment record page reads `getAssessmentFormVersion`;
   - Arabic My Work messages use `forumAr`;
   - any lineage display finds `sources` by name.

   Each read is routed and merged now: BE-R4 routed the first three and KBE-R4 the drill-down (D-115).
   - **Before you rely on it:** check every response shape against `openapi.yaml`.
   - **Tests:** cover each item in both languages.
   - **e2e:** add e2e steps where a real-stack path exists. For example, the schedule edit with its real `ETag`, and a waiver refusal with its date.
2. **Finance links fixtures (KBE-R4).** Every Finance class line now has a `drilldownHref`. Update any web fixture or test that assumed `null`, but only where the contract now says otherwise.
3. **G3 submit dialog (QA-C O-1, Low).** The dialog warns "Only 1 of 5 mandatory outputs are complete. The submission will be refused…" even when accepted exceptions, or a Modular waiver, cover the gaps and the server accepts the submission. Make the warning reflect the same coverage the server applies. Do not compute the server's decision on the client; follow the gate view's own missing-items data. Test both cases.
4. **Routes (FE-R2).** Any route you add must be declared with `lazyPage(...)` in `router.tsx`.
5. **ADR-table guard test (ARCH-R3 §7).**
   - **The gap:** `apps/web/src/i18n/problems-slices-hijk.test.ts` reads only ADR rows that begin `| 4xx |`, so it misses the amendment tables, which begin with the code. Row 186 (`dashboard.value_class_not_applicable`) is an example.
   - **Do:** extend the test to read the amendment table format too, so a later code cannot go untranslated, and prove it would have caught row 186.

- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **e2e under load:** if a test hits the 30 s timeout, re-run that spec alone and report both runs. Never raise a timeout.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 26050–26099 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
4. The product e2e suite (`apps/web/e2e`, real stack via `apps/web/e2e/support/with-stack.sh`, `--workers=1`) passes in chromium-en and chromium-ar, including your new specs, with axe reporting 0 serious or critical issues. Report the counts per spec.
5. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-FE-R3-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-R3-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
