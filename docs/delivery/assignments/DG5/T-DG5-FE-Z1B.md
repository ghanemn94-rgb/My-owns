# Assignment T-DG5-FE-Z1B: DG5 round-4 repair (frontend-ux-engineer)

> **Continuation.** T-DG5-FE-Z1 was stopped (run `DG5-T-DG5-FE-Z1-frontend-ux-engineer-20261020T183201Z-774e619f`, kept in `docs/delivery/test-evidence/DG5/FE-Z1-orphaned/`) after writing only `apps/web/e2e/p5-form-tables-reflow.spec.ts`, committed unverified on the branch as WIP. Review it, keep or rewrite it, and complete the whole task below.

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 4 on candidate `sha256:26d4ad92…` (D-176).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-z1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** This is the only repair task (D-176). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-146** (Medium; REQ-S15-009; reported by qa-verifier in `docs/delivery/reviews/DG5/round-4/qa-verifier.json`): Two P5 tables sit in no scroll container, so the page scrolls sideways at 390 px and with 200 % text, in en and ar (the F-DG5-144 defect class): the Form builder's field table (FormSchemaPage.tsx:234, wrapper div.table-scroll, a class with no CSS rule anywhere) and the form framework's Attachments table (FormFramework.tsx:1001, no wrapper; T01/T14 forms).
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/qa/round-4/05-p5-layout-axe-summary.txt`, `docs/delivery/test-evidence/DG5/qa/round-4/05-p5-layout-axe.log`, `docs/delivery/test-evidence/DG5/qa/round-4/layout-p5/p5-layout-results.json`, `docs/delivery/test-evidence/DG5/qa/round-4/layout-p5/shots/form-builder-en-390-viewport.png`, `docs/delivery/test-evidence/DG5/qa/round-4/layout-p5/shots/form-builder-ar-390-viewport.png`, `docs/delivery/test-evidence/DG5/qa/round-4/layout-p5/shots/t14-attachments-en-390-viewport.png`.

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-176** in `docs/delivery/decisions.md`. Read D-176 verbatim; the scope below restates it.

## Binding scope

- **Decided (D-176): every wide P5 table scrolls inside its own region.**
  - The Form builder's field table (`apps/web/src/pages/form-builder/FormSchemaPage.tsx:234`; its wrapper `div.table-scroll` has no CSS rule) and the form framework's Attachments table (`apps/web/src/components/form-framework/FormFramework.tsx:1001`, no wrapper) widen the page at 390 px and with 200 % text, in en and ar.
  - Wrap both in FE-X1's `TableScrollRegion` (focusable, named in en and ar). Remove `table-scroll`.
  - Extend the unit guard (`table-regions.test.tsx`) so it also refuses the class `table-scroll` and any `table.table` / `table--compact` rendered outside a region, and check that no other P5 table is affected (list what you checked).
  - Regression: extend `apps/web/e2e/p5-diagnose-reflow.spec.ts` (or add a spec) to open the Form builder (a draft with an extension field, and the auditor's read-only view) and a T14 form's Attachments tab at 390 px and at 1280 px with 200 % text, in chromium-en and chromium-ar, asserting `scrollWidth - innerWidth <= 1`. Record the failing output before the fix. Read qa's DB-free reproduction in `docs/delivery/test-evidence/DG5/qa/round-4/` (read it, do not import it).

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-176 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 5.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/web/**`: the two components, the shared table region if needed, `table-regions.test.tsx`, and the e2e spec.
- **Concurrent owners:** None. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23100–23149 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Disk.** The disk allowance is shared. Do not copy the pnpm store or clone the repository; remove your own temporary databases and outputs when a run ends.
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
2. The `unit-web` Vitest project passes with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. Your spec, `p5-table-regions-axe.spec.ts`, `p5-reflow-axe.spec.ts` and `p5-forms.spec.ts` pass on the real stack, `--workers=1`, in chromium-en and chromium-ar, in both locale settings. Report the counts. Keep only your own specs' screenshots (D-162).
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-Z1B-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-Z1B-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R7);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
