# Assignment T-DG5-BE-AA1: DG5 round-5 repair (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 5 on candidate `sha256:a18a9f05…` (D-178).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-aa1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Two repair tasks run in parallel (D-178): T-DG5-BE-AA1 and T-DG5-FE-AA1. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-124** (Medium, mandatory violation; REQ-S18-001; reported by domain-reviewer in `docs/delivery/reviews/DG5/round-5/domain-reviewer.json`): on a demo database the form framework's own export (`exportFormRecords`, `apps/api/src/modules/forms/export.ts`; CSV and JSON, en and ar) carries no "Illustrative example — synthetic" label.
  - Read the finding in full in `docs/delivery/findings.json` and its evidence under `docs/delivery/test-evidence/DG5/domain/round-5/` (the probe `probe/dom-r5-forms.spec.ts`, `probe-r5-forms-demo.log` and the files in `demo/api/`).

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-178** in `docs/delivery/decisions.md`. Read D-178 verbatim; the scope below restates it.

## Binding scope

- **Decided (D-178):** in a demo database, determined from the same environment source as `GET /api/v1/environment` and the reporting pipeline (ADR-0050 §2 (d)):
  - the CSV's first row, before the header, is the label in the export language, using the reporting pipeline's exact strings (`packages/reporting/src/labels.ts` `export.illustrative`, en and ar); keep the BOM and CRLF;
  - the JSON body carries a new additive field `illustrativeLabel`: the same string in the export language on a demo database, `null` otherwise. Add it to the zod schema `formRecordExport` (`packages/shared/src/schemas/forms-records.ts`) and to `FormRecordExport` in `docs/api/openapi.yaml`. This additive contract change is decided by D-178; make no other contract change.
  - Non-demo exports are unchanged apart from `illustrativeLabel: null`. The B0004 provenance line is out of scope.
- Regression: an integration test on a demo database asserting the label in all 8 cases (T14/T01 × csv/json × en/ar), and on a non-demo database asserting no label row and `illustrativeLabel: null`. Record it failing before the fix.
- Check the web client: `apps/web/src/components/form-framework/ExportDialog.tsx` and `api.ts` parse this response; if a strict client parse would reject the new field, report it in the handback (the web is frontend-owned), do not edit it.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback. The one exception is the additive `illustrativeLabel` field decided by D-178.
- **Decisions:** D-141 to D-178 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 6.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/api/src/modules/forms/**` and its tests, `packages/shared/src/schemas/forms-records.ts`, `docs/api/openapi.yaml` (the `FormRecordExport` schema only).
- **Concurrent owners:** T-DG5-FE-AA1 owns `apps/web/**`. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23150–23199 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. The forms unit tests and the integration tests your change reaches pass, with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. Re-run the domain probe's 8 export cases on a demo stack (or your integration equivalent) and show the label in each.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-AA1-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-AA1-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R7, if needed);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
