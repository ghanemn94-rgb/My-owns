# Assignment T-DG5-BE-C4: P5 implementation, p5-work-split §A.5 and §D.2 (this is a **repair task**, D-164 and D-165: the Added scope below is binding and replaces the sections' file lists) (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/be-c4`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Four W20 tasks run at the same time (BE-C4, BE-T3, KBE-D4 and FE-D3), each in its own worktree; no architecture task runs. W1–W19 are merged and verified (D-165). The failing QA tests named in your Added scope were written by independent QA authoring tasks: make them pass by fixing the product, never by editing them (you may not edit tests/qa/** or root e2e/**). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p5-work-split.md` §A.5 and §D.2 (this is a **repair task**, D-164 and D-165: the Added scope below is binding and replaces the sections' file lists). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p5-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0039 onward, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-141 to D-143 in `docs/delivery/decisions.md` (D-142 decides p5-plan Q1–Q12). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p5-pending-*.ts` list. Exercise it in your `p5-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-142 Q8).
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run the Vitest projects and the integration directories your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them, and report them as "not run, D-164", never as passed.
- **Added scope 1 (D-164 b; BE-C3 handback §2.4): an explicit approver configuration is remembered.**
  - **Today:** `routedApproverOf` (`apps/api/src/modules/workflows/gates.ts`) treats "no named user and the catalogue default role" as never configured. So when someone explicitly configures the catalogue default (for example SP, as a role only) on a transformation whose pinned methodology defaults G3 to BO, the gate still routes to BO and shows BO.
  - **Required:**
    - Migration **`0094`** (additive): `gate_instance.approver_configured boolean NOT NULL DEFAULT false`.
    - Backfill it to true for every instance that has an audit event of the approver configuration operation (the `PUT` at `gates.ts` ~620–660; name the audit action in the handback).
    - Set it to true in that operation, in the same update and audit event (version step, `If-Match`, commit-time re-authorization unchanged).
    - `routedApproverOf` returns the stored approver when `approver_configured` is true, and otherwise keeps today's rule.
    - Stored rows of v1-pinned transformations keep their values (R2). The new column is the only change.
  - **Tests (integration):**
    - a role-only explicit SP configuration on a transformation pinned to a methodology whose G3 default is BO routes the next submission to SP and reports SP;
    - a never-configured instance follows BO;
    - the backfill marks a previously configured instance;
    - the existing A06, effective-approver and gates suites pass unchanged.
- **Added scope 2 (D-164 d; BE-C3 handback §5.2): `AutomationTrigger.samplePayload`.**
  - **Contract addition, approved by D-164:** an optional `samplePayload` object on `AutomationTrigger` in `docs/api/openapi.yaml`, plus its zod mirror if one exists. It is an example payload valid against the trigger's payload schema (for outbox events, `outboxPayloadSchema(event, 1)`), with synthetic ids.
  - Its `transformationId` is a fixed placeholder (`00000000-0000-7000-8000-000000000000`), documented as "replaced by the builder with the selected transformation".
  - Serve it in the builder catalogue for every trigger that has a payload schema.
  - **Tests:**
    - every served `samplePayload` parses with its trigger's schema;
    - the `gate.submitted` sample, with `transformationId` replaced by a transformation of the rule's organization, gives a 201 dry run;
    - `contract.test.ts` and `openapi:lint` stay green, with no new operation and no pinned-count change.
- **Added scope 3 (D-165; QA-B P-3, Low): the ETag of an empty custom-field set.**
  - `GET /api/v1/transformations/{t}/form-records/{type}/{id}/custom-fields` on a record with no stored values returns 200 `version: 0` with `ETag: "0"`. The contract's `ETag` header requires `^"[1-9][0-9]{0,9}"$`.
  - Follow the D-153 precedent: give that 200 response the `ETagOrZero` header in `docs/api/openapi.yaml`.
  - `tests/qa/integration/a07-historical-integrity.test.ts` › "contract (found while authoring A07): … returns version 0 with an ETag the contract allows" must pass unchanged.
- **Added scope 4 (D-165; QA-E O-1, contract wording):** `ProcedureStepComplete`'s description says "create and advance outputs are produced by the adapter". In fact a `create` step needs `outputRecordId` naming a record produced natively first (`outputs/kit.ts`, "verify-and-link only"). Make the description say so.
- **Ownership:** `apps/api/src/modules/workflows/**`, `apps/api/src/modules/automation/**` (the catalogue), `packages/db/migrations/0094_*.sql`, `docs/api/openapi.yaml` (`AutomationTrigger`, the custom-fields 200 header, `ProcedureStepComplete`'s description), and the zod mirror of `AutomationTrigger`.
- **Concurrent owners:** KBE-D4 edits `apps/api/src/modules/reporting/**`, `apps/api/src/modules/benefits/index.ts`, one export line in `apps/api/src/modules/workflows/index.ts` (with `workflows.test.ts`'s barrel pin) and one wiring line in `apps/api/src/server.ts`. Do not edit those lines. FE-D3 edits `apps/web/**`.
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
2. The Vitest projects your change reaches pass with the locale unset and with `C.UTF-8`, run one at a time (D-164 load rule). Report the commands and counts. The repository-wide `pnpm test` is not yours to run; report it as "not run, D-164".
3. The integration directories and files your change reaches, including the QA files named in your Added scope, pass with `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`. Report the counts and any pinned-count change. `pnpm test:integration` and the full e2e suite are not yours to run (D-164).
4. `node tools/gates/validate.mjs --historical --stage DG4` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-BE-C4-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-C4-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
