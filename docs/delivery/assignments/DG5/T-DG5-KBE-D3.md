# Assignment T-DG5-KBE-D3: P5 implementation, p5-work-split §F.2 and §F.4 (this is a **repair task**, D-163: the Added scope below is binding and replaces §F.2/§F.4's file lists) (kpi-benefits-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/kbe-d3`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Five W18 tasks run at the same time (BE-N2, KBE-D3, BE-C3, FE-C2, FE-G2), each in its own worktree; no architecture task runs. W1–W17 are merged (D-163). The failing QA tests named in your Added scope were written by the independent QA authoring tasks: make them pass by fixing the product, never by editing them. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §F.2 and §F.4 (this is a **repair task**, D-163: the Added scope below is binding and replaces §F.2/§F.4's file lists). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Added scope (D-163; F-DG5-qa-c-3, QA-C's D3): system SUM totals in the assembled tables.**
  - **The defect (QA-C, confirmed by the orchestrator):** the XLSX writer supports `totals` (`packages/reporting/src/xlsx/sheet.ts`, ADR-0046 §4: `<f>SUM(<col>first:<col>last)</f>` with the decimal.js total as its cached value), but every `totals:` in `apps/api/src/modules/reporting/reports/assemblers/**` is `[]`. As a result, REQ-S13-006's "a system SUM total remains a formula" cannot occur in any product export.
  - **Required (ADR-0045 §"Every number…": "a total is shown only where the source screen shows one. Totals in tables are computed with decimal.js"; assemblers "never sum across value bases or currencies"; p5-work-split §F rule 3):**
    - For each assembled table, check whether its source screen shows a total for that column. Examples: the DG3 business-case totals (`CaseTotals.tsx`, `GET /business-cases/{id}/totals`), and the benefit register's totals per value basis.
    - Where it does, declare `totals[]` (`columnKey`, `formula: 'sum'`, `value`) with the same decimal.js value the screen shows.
    - A column whose rows mix currencies, value bases or unit kinds gets no total.
    - An `unknown` or `stale` cell makes the total `unknown` (no number, never a partial sum shown as complete).
    - List every table you examined in the handback (assembler, section, column, total or not, and why).
  - **Tests (literal):**
    - On the demo dataset, the XLSX of `business_cases` and of `registers` with `{register: "benefits"}` contains a `SUM(…)` formula whose cached value equals the screen's total.
    - A mixed-basis or mixed-currency column has no total.
    - An unknown cell gives an unknown total.
    - `tests/qa/integration/a15-demo-transformation-outputs.test.ts` › "a system SUM total remains a formula…" must pass unchanged. You may not edit `tests/qa/**`.
  - **Regression:** a snapshot generated before your change keeps its stored content. A table that newly gets a total changes the content of newly generated snapshots only, which is expected.
- **Ownership:** `apps/api/src/modules/reporting/reports/assemblers/**` and their tests. Read the owning module's services; compute no new business number.
- **Concurrent owners, do not edit:**
  - BE-N2 edits `packages/reporting/**`, `apps/worker/src/reports/**`, the snapshot-generation path and `packages/shared/src/schemas/report.ts` (it adds an optional `synthetic` member).
  - If you need a writer change, write it in the handback.
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
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in every Vitest invocation it runs. Report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and any pinned-count change.
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-KBE-D3-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-KBE-D3-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
