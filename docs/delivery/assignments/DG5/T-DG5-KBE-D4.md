# Assignment T-DG5-KBE-D4: P5 implementation, p5-work-split §F.2 and §F.4 (this is a **repair task**, D-164 and D-165: the Added scope below is binding and replaces the sections' file lists) (kpi-benefits-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/kbe-d4`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four W20 tasks run at the same time (BE-C4, BE-T3, KBE-D4 and FE-D3), each in its own worktree; no architecture task runs. W1–W19 are merged and verified (D-165). The failing QA tests named in your Added scope were written by independent QA authoring tasks: make them pass by fixing the product, never by editing them (you may not edit tests/qa/** or root e2e/**). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §F.2 and §F.4 (this is a **repair task**, D-164 and D-165: the Added scope below is binding and replaces the sections' file lists). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run the Vitest projects and the integration directories your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them, and report them as "not run, D-164", never as passed.
- **Added scope 1 (D-164 c; BE-C3 handback §5.1): the gate pack names the effective approver.**
  - `apps/api/src/modules/reporting/reports/assemblers/gate-pack.ts` (~225) falls back to the stored `instance.approver_role_code` when there is no submission. For a new transformation whose pinned methodology defaults G3 to BO, it therefore prints SP.
  - Reporting may not import workflows (`modules.ts`). So:
    - add `gateApprover(db, transformationId, gateCode): Promise<{ roleCode: string; userId: string | null } | null>` to reporting's `WorkflowsReadPort` (`reporting/ports.ts`; the unwired port answers null);
    - export `effectiveGateApprover` from `workflows/index.ts`, and update the barrel pin in `workflows/workflows.test.ts`;
    - wire it in `apps/api/src/server.ts` beside `setWorkflowsReadPort`;
    - in the assembler, use the submission's approver first, then the port, then the stored value.
  - **Tests:** a G3 pack of a new transformation pinned to that methodology prints BO without a submission; with a submission it prints the submission's approver; a v1-pinned pack is unchanged.
- **Added scope 2 (D-164 g; QA-C O3): the KPI target in the registers output.**
  - `registers.ts:385` emits the target as system text, so `100.000000` is printed raw. ADR-0045 forbids mixing unit kinds in one `decimal` column, and KPIs in one column have different units.
  - Format the text at assembly with the shared display formatter of ADR-0046 §9 (`formatDecimal`: half-up display rounding, trailing zeros dropped, the KPI's own unit kind: money 2, percentage `%`). The stored KPI value is never rounded.
  - **Tests:** the register shows `100` for `100.000000`, and a percentage target shows its `%` form, in en and ar.
- **Added scope 3 (D-164 h; KBE-D3 handback §6): the benefit totals by reference.**
  - Export `totalsOf` (or the pure `computeTotals`) from `apps/api/src/modules/benefits/index.ts`, and use it in the registers assembler instead of the restatement KBE-D3 wrote.
  - The figures stay identical: `registers-report.test.ts` and `table-totals-demo.test.ts` must pass unchanged.
  - Update any barrel pin the architecture tests hold.
- **Added scope 4 (D-165; QA-B P-1, Medium): the executive dashboard snapshot records its KPI versions.**
  - `apps/api/src/modules/reporting/reports/assemblers/executive-dashboard.ts:310` hard-codes `versions: []`. An issued Q1 dashboard therefore has no `kpi_version` entry, although its outcome rows show a KPI's Q1 actual, and its sources omit the KPI definition and actual.
  - After an approved Q1 restatement, `GET …/kpi-restatements/{id}/reissue-offers` offers only the KPI register, not the Q1 dashboard.
  - **Required (REQ-S13-007 "source record revisions … calculation versions"; REQ-S07-016 "offer report reissue"):** record the `kpi_version` (and calculation version) of every KPI value the dashboard shows, and cite the KPI definitions and actuals as sources, as `registers.ts:513` does. The reissue offer then includes the dashboard.
  - **Tests:** the two failing tests in `tests/qa/integration/a07-historical-integrity.test.ts` ("the issued Q1 dashboard retains the calculation version…" and "the Q1 report issued earlier … is offered for reissue") must pass unchanged.
- **Ownership:**
  - `apps/api/src/modules/reporting/**`;
  - `apps/api/src/modules/benefits/index.ts` (the export only);
  - the `effectiveGateApprover` export line in `apps/api/src/modules/workflows/index.ts` and its barrel pin;
  - one wiring line in `apps/api/src/server.ts`.
- **Concurrent owners:** BE-C4 edits the rest of `apps/api/src/modules/workflows/**`, the automation catalogue, migration `0094` and the `AutomationTrigger` component; FE-D3 edits `apps/web/**`.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23900–23949 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG5/T-DG5-KBE-D4-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-KBE-D4-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
