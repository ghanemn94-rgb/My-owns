# Assignment T-DG5-BE-C2: P5 implementation, p5-work-split §A (this is a **repair task**, D-155: the Added scope below is binding and takes precedence over §A's original file list) (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-c2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four W11 tasks run at the same time (BE-C2, BE-P, KBE-E, KBE-F), each in its own worktree; no architecture task runs. W1–W10 are merged (D-155). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §A (this is a **repair task**, D-155: the Added scope below is binding and takes precedence over §A's original file list). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Added scope 1 (D-155; FE-B's High defect): the DG2–DG4 catalogue for methodology versions after v1.**
  - **The defect (confirmed by the orchestrator):** `apps/api/src/modules/methodology/repository.ts` `loadMethodologyCatalogue` selects `diagnostic_dimension`, `diagnostic_workstream`, `tom_dimension`, `charter_scope_check_definition` and `good_outcome_criterion` with `methodology_version_id = <pinned version>`, and filters the gate definitions the same way. These rows exist only for v1, the stable-identity registry of ADR-0039 §2. A new transformation is pinned to the newest published methodology version (ADR-0039 §3), so after any version is published (even a help-text-only change), every new transformation gets empty DG2 catalogues.
  - **Required behaviour (ADR-0039 §2 "Resolution", §3):** for a version V, the catalogue identities are the registry's rows (the lineage's v1 rows), and their attributes resolve as V's `methodology_element` row when it exists, else the catalogue's values. Use the `ConfigResolver` port where the reader needs resolved attributes. A transformation pinned to v1 stays byte-identical (the R2 regression rule).
  - **Sweep:** find every reader in `apps/api/src/**` and every SQL function in `packages/db/migrations/**` that reads one of the ten catalogue tables of ADR-0039 Context 2 filtered by a pinned or newest version id: `gate_definition`, `gate_criterion_definition`, `tom_dimension`, `diagnostic_dimension`, `diagnostic_workstream`, `charter_scope_check_definition`, `good_outcome_criterion`, `phase_definition`, `forum_template` and `benefit_formula_example`. Instantiation functions (`0018`, `0051`, `0065` and later) are in scope. Fix each one. List every site you examined in the handback: the file, the line, and whether it was affected.
  - **Migration:** only if an SQL function must change, take **`0094`** (the orchestrator's repair range, p5-plan §5). It must be additive: `CREATE OR REPLACE` of the function, no constraint change, no data rewrite of DG2–DG4 rows.
  - **Tests (literal, integration):**
    1. Publish a methodology version v2 that changes only help text. Create a transformation (pinned to v2). `GET /transformations/{id}/methodology` returns the same diagnostic dimensions and workstreams, TOM dimensions, gate definitions, charter scope checks and good-outcome criteria as v1, by code/key and count.
    2. A v2 label override is returned for its element.
    3. A transformation pinned to v1 is unchanged (the existing v1 regression suites pass).
    4. The DG2 Diagnose region and the gate instances of a v2-pinned transformation are complete (6 workstreams, 6 gates). Exercise the instantiation path, not only the read.
  - **Ownership:** you may edit `methodology/**` and each affected reader's one query site, named line by line in the handback. Make no change to a contract or an ADR. If one is needed, stop and write it in the handback.
- **Added scope 2 (D-155 c):** add three mappings to `apps/api/src/modules/platform/db-errors.ts`, with a unit or integration test each:
  - `agenda_item_cutoff_pack_unreviewed` → 422 `agenda_item.pack_not_reviewed`;
  - `meeting_cutoff_pack_reviewer` → 403 `meeting_cutoff_pack.not_reviewer`;
  - `meeting_cutoff_pack_transition` → 422 `meeting_cutoff_pack.already_reviewed`.
  Use the codes and English texts that BE-L2's API refusals already use.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 24200–24249 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in every Vitest invocation it runs. Report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and any pinned-count change.
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-C2-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-C2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
