# Assignment T-DG5-BE-N2: P5 implementation, p5-work-split §F.5 and §F.6 (this is a **repair task**, D-163: the Added scope below is binding and replaces §F.5/§F.6's file lists) (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-n2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Five W18 tasks run at the same time (BE-N2, KBE-D3, BE-C3, FE-C2, FE-G2), each in its own worktree; no architecture task runs. W1–W17 are merged (D-163). The failing QA tests named in your Added scope were written by the independent QA authoring tasks: make them pass by fixing the product, never by editing them. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §F.5 and §F.6 (this is a **repair task**, D-163: the Added scope below is binding and replaces §F.5/§F.6's file lists). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Added scope 1 (D-163; F-DG5-qa-c-1, QA-C's D1): the B0004 provenance statement in XLSX and CSV.**
  - **The defect (QA-C, confirmed by the orchestrator):** `apps/worker/src/reports/export-runner.ts` passes `branding.provenance` (from `provenanceFooter`, B0004, en/ar) to `render`. PDF, DOCX and PPTX print it, but the XLSX and CSV writers of `@mth/reporting` do not. The same holds for every XLSX (diagnostic, tom, business_cases, roadmap, registers, executive_dashboard) and every CSV, in en and ar.
  - **Required (ADR-0046 §2 "Every file carries … slice I's provenance footer (B0004)"; REQ-PB-001, REQ-S20-015):**
    - XLSX: the statement on every sheet, as a plain inline string (never a formula), in the file's language and direction.
    - CSV: one row with the statement, after the existing header rows. It is text, so the formula-injection rule (`neutralizeSpreadsheetText`) still applies.
    - When `provenance` is null, the file prints nothing in its place (it never invents the text).
  - **Tests:** every XLSX sheet and every CSV carry the en or ar statement exactly as `GET /methodology/provenance` returns it. `tests/qa/integration/a15-outputs-every-definition.test.ts` › "every file, in every format, prints the B0004 provenance statement…" must pass unchanged. You may not edit `tests/qa/**`.
- **Added scope 2 (D-163; F-DG5-qa-c-2, QA-C's D2, High): the illustrative label in demo reports and exports, and `synthetic` in demo snapshots.**
  - **The defect:** in a demo database (`GET /environment` → `{kind:"demo", synthetic:true}`), generated snapshots have no `synthetic` member, and none of the 54 demo exports carries "Illustrative example — synthetic" / "مثال توضيحي — اصطناعي". `EnvironmentReadPort` (`apps/api/src/modules/admin/environment.ts`) is not read by `modules/reporting`, `apps/worker/src/reports` or `packages/reporting`.
  - **Required (ADR-0050 §2 (d), REQ-PB-089, REQ-S18-001, M0090, M0339):**
    - Snapshot generation reads the environment through `EnvironmentReadPort` in its transaction. In a demo database, the content records `synthetic: true`.
    - Add `synthetic` to the `ReportDocument` zod schema (`packages/shared/src/schemas/report.ts`) and to its OpenAPI component as an **optional** boolean, present (`true`) exactly in a demo database. Production content, its `content_sha256` and `content_schema_version` stay byte-identical (the R2 regression rule). This contract change is approved by D-163. Make no other contract change.
    - Every export of a snapshot generated in a demo database prints the label in its header and on every page (PDF, DOCX), slide (PPTX) or sheet (XLSX), and as a row in CSV, in the file's language. The worker decides from the snapshot's recorded `synthetic` member, not from its own environment, so a file always matches its snapshot.
    - The en/ar texts are ADR-0050 §2's verbatim: "Illustrative example — synthetic" / "مثال توضيحي — اصطناعي".
  - **Tests:** the two `tests/qa/integration/a15-demo-transformation-outputs.test.ts` › REQ-PB-089 tests must pass unchanged. Add your own implementer tests, including the production case (no label, no `synthetic` member, the same sha as before).
- **Added scope 3 (D-163; QA-C's O3, Low):** a KPI target printed as `100.000000` in the PDF register.
  - If ADR-0045 or ADR-0046 sets a display rule for decimals by unit kind, apply it in the renderers, with a test.
  - If they set none, change nothing and say so in the handback. Never round a stored value or a snapshot's content: display only.
- **Ownership:** `packages/reporting/**` (the writers and layout), `apps/worker/src/reports/**`, the snapshot-generation path in `apps/api/src/modules/reporting/reports/**` (only the environment read and the `synthetic` member), `packages/shared/src/schemas/report.ts`, and the `ReportDocument` component in `docs/api/openapi.yaml`. A migration only if one is needed: **`0095`**, additive.
- **Concurrent owners, do not edit:**
  - KBE-D3 edits the report assemblers (`apps/api/src/modules/reporting/reports/assemblers/**`).
  - BE-C3 edits `apps/api/src/modules/workflows/**` and the automation dry-run text in `docs/api/openapi.yaml`.
  - Keep your OpenAPI edit to the `ReportDocument` component.
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
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in every Vitest invocation it runs. Report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and any pinned-count change.
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-N2-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-N2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
