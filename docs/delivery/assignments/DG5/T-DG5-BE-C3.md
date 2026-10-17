# Assignment T-DG5-BE-C3: P5 implementation, p5-work-split §A.5 (this is a **repair task**, D-163: the Added scope below is binding and replaces §A.5's file list) (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-c3`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Five W18 tasks run at the same time (BE-N2, KBE-D3, BE-C3, FE-C2, FE-G2), each in its own worktree; no architecture task runs. W1–W17 are merged (D-163). The failing QA tests named in your Added scope were written by the independent QA authoring tasks: make them pass by fixing the product, never by editing them. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §A.5 (this is a **repair task**, D-163: the Added scope below is binding and replaces §A.5's file list). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Added scope 1 (D-163; F-DG5-QA-A-1): a gate reports the approver its submissions are routed to.**
  - **The defect (QA-A, confirmed by the orchestrator):**
    - `apps/api/src/modules/workflows/gates.ts` `toGateInstance` returns the stored `approver_role_code`.
    - A new submission routes through `routedApproverOf` (T-DG5-BE-C, ADR-0039 §3): when the instance was never configured, it follows the default approver of the pinned methodology version.
    - So after a methodology that sets G3's `defaultApproverRoleCode` to BO is published, a new transformation's `GET …/gates/G3` says `approverRoleCode: "SP"`, while its submission says BO and only BO can decide. The Gates screens (`GatesPage.tsx:148`, `GateDetailPage.tsx:174`) show the Sponsor.
  - **Required (REQ-S06-004, REQ-S20-006; ADR-0039 §3; ADR-0015 §2):** every API response and read model that names a gate's approver names the effective one, as `routedApproverOf` resolves it, including:
    - the gate instance (single, list and the gates reader);
    - the approver-configuration check at `gates.ts:621` (`allowedApproverRoleCodes` of the resolved definition);
    - the gate exceptions' approver;
    - My Work and the inbox approval items;
    - the gate-pack and dashboard read models.
  - **Two ways to fix:**
    - **Runtime resolution:** resolve the approver in the views.
    - **Instantiation:** write the resolved default into `gate_instance.approver_role_code` when a transformation is instantiated, and when a methodology migration moves its pin. Migration **`0094`**, additive, only if an SQL function must change.
    - Choose one, explain the choice, and list every site you examined in the handback (file, line, affected or not).
    - Either way, a v1-pinned transformation and a configured approver (named user or configured role) stay byte-identical (the R2 rule).
  - **Tests:** `tests/qa/integration/a06-configuration-change.test.ts` › "REQ-S06-004 (display): the gate of the NEW transformation reports the approver its submissions are routed to" must pass unchanged. You may not edit `tests/qa/**`. Add your own implementer tests:
    - the old transformation keeps SP;
    - a configured approver is kept;
    - the list and the single read agree.
- **Added scope 2 (D-163; QA-A O-1): the automation dry-run sample shape.**
  - `AutomationDryRunRequest` describes "a payload with the trigger's fields". For `gate.submitted`, the server requires the complete internal outbox payload (`gate.submitted` v1, 10 fields), and refuses a sample with only the catalogue's condition fields with 422 `automation.dry_run_sample_invalid`.
  - Make the contract say what the server requires: a description and an example in `docs/api/openapi.yaml`, plus the builder catalogue's sample shape if the catalogue serves one.
  - Alternatively, if ADR-0043 says the sample is the condition fields only, make the server accept that.
  - Pick the reading ADR-0043 states, quote it in the handback, and test it.
- **Ownership:** `apps/api/src/modules/workflows/**` and the read sites your sweep names (one query site each, listed in the handback); the automation dry-run text in `docs/api/openapi.yaml` and `apps/api/src/modules/automation/**` for scope 2; migration `0094` if needed.
- **Concurrent owners, do not edit:**
  - BE-N2 edits `packages/reporting/**`, `apps/worker/src/reports/**`, the snapshot path and the `ReportDocument` OpenAPI component.
  - KBE-D3 edits `apps/api/src/modules/reporting/reports/assemblers/**`. If the gate-pack assembler names the approver, write the needed change in your handback for the orchestrator instead of editing it.
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
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in every Vitest invocation it runs. Report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and any pinned-count change.
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-C3-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-C3-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
