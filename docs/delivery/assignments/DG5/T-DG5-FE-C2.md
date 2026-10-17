# Assignment T-DG5-FE-C2: P5 implementation, p5-work-split §B (this is a **repair task**, D-163: your screens are the FE-C row of `p5-plan.md` §5.1, `components/form-framework/**`, now adopted on every native form; the Added scope below is binding) (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-c2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Five W18 tasks run at the same time (BE-N2, KBE-D3, BE-C3, FE-C2, FE-G2), each in its own worktree; no architecture task runs. W1–W17 are merged (D-163). The failing QA tests named in your Added scope were written by the independent QA authoring tasks: make them pass by fixing the product, never by editing them. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §B (this is a **repair task**, D-163: your screens are the FE-C row of `p5-plan.md` §5.1, `components/form-framework/**`, now adopted on every native form; the Added scope below is binding). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Frontend rules:** every string in en and ar (RTL); accessible labels and keyboard use (axe clean, scroll regions focusable); Unknown/Stale never shown as zero or green; server errors shown by their code, with the en/ar text of every problem code your screens can receive (add missing keys to `problems.json` and check for duplicates). Register routes and navigation entries with appended lines only. When your screens ship a feature that a nav, landing or admin string calls "Planned" or "not available yet", correct that string and its chip in both languages (F-DG4-160).
- **e2e:** add Playwright coverage of each screen's main path and its main refusal. Run the full web e2e suite (`apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1`) with your ports, and report its counts.
- **Evidence size (D-162):** commit the screenshots of your own specs and of any failure you cite only. Never commit a full-suite screenshot or trace folder.
- **Added scope 1 (D-163; F-DG5-QA-A-2): extension fields can be entered and seen on every native form.**
  - **The defect (QA-A, confirmed by the orchestrator):** only T01 (`DiagnosePage`) and T14 (`BenefitPage`) host the form framework (`FormFramework` / `FormToolsButton`). An extension field added to T13 in the form builder is published and stored through the API, but the stakeholder-group screen (`/transformations/{id}/adoption`) offers no input for it and does not show it. The same holds for T02–T13, T15 and T16.
  - **Required (REQ-S06-004 "a new T13 record stores the new field"; A06 "works without code changes"; ADR-0041 §1 and §5):** for every record type that `listFormRecordTypes` marks as accepting extension fields and that has a native form or record view in the web:
    - the pinned version's extension fields render through the framework's field components, in the record form (create and edit) and on the record view, in en and ar;
    - values are saved through the form-records custom-values operation with `If-Match`;
    - server refusals are shown by their problem code.
  - **Order (the separable second half, D-059/D-070):** T13 first (A06's acceptance case), then T02–T12, T15, T16, then the twelve extension record types of ADR-0041 §1. Report a table: record type → screen → done or not.
  - **Tests:**
    - unit tests per adopted screen;
    - e2e of T13 in en and ar: publish a field in the form builder, enter it on a new transformation's stakeholder group, read it back;
    - `e2e/a06-configuration-change.spec.ts` › "a field added to T13 in Studio can be entered on a stakeholder record of a new transformation" must pass unchanged. You may not edit root `e2e/**` or `tests/qa/**`. If that spec relies on a locator your screen cannot honour, write it in the handback instead.
- **Added scope 2 (D-163; REQ-PB-011): the question tag in every form header.** "Each methodology template/deliverable carries one of the four questions, shown in form headers and the Playbook reader." Add FE-G's `TemplateProvenance` (`components/provenance-badge/ProvenanceBadge.tsx`) to the form header of T02–T16, as `DiagnosePage` does for T01, with a unit test per page.
- **Added scope 3 (D-163; F-DG5-QA-A-4, Low):** a well-formed number outside the field's `min`/`max` shows an out-of-range message naming the limit (en and ar), not the decimal-format hint. Do the same for the server's out-of-range problem code. Test both.
- **Ownership:** `components/form-framework/**` and its adoption in the T02–T16 pages and the extension record type pages: the framework hosting lines and the header line only, named per file in the handback. Use `i18n` keys you add, with appended lines.
- **Concurrent owners, do not edit:**
  - FE-G2 edits `app/Shell.tsx`, `app/nav.ts`, `pages/studio/**`, `pages/reports/**` (snapshot page), `packages/design-tokens/**` and `apps/web/e2e/journeys.spec.ts`.
  - Expect a merge of appended i18n lines; avoid reordering.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23950–23999 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG5/T-DG5-FE-C2-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-C2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
