# Handback T-DG5-BE-C3 (backend-workflow-engineer): F-DG5-QA-A-1 and QA-A O-1 (D-163 repair)

- **Stage / gate:** P5, DG5 (BUILDING). Repair task under D-163. The Added scope replaces §A.5's file list.
- **Invocation:** `DG5-T-DG5-BE-C3-backend-workflow-engineer-20261017T013252Z-15ae25f2`, session `15ae25f2-3f79-49e5-a59e-b4210c89ad63`.
- **Base:** branch `dg5/be-c3` at `f21a536` (integrated `HEAD`). The changes are **uncommitted**, as the assignment asks.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-C3.md`, sha256 `d4351f63…e8f80`. I verified the hash before starting.
- **Time:** started `2026-10-17T01:33:04Z`. The end time is in §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0. I ran it at the start and again for the evidence (`T-DG5-BE-C3-evidence/validate-dg4-historical.log`).
- **Approvals:** no business, Finance or IT approval was granted. Every decision in the tests is a synthetic demo decision in a disposable database. Product gates G1–G6 are unrelated to DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/workflows/gates.ts` | Adds `effectiveGateApprovers` / `effectiveGateApprover`, which give the per-gate approver through `routedApproverOf`. `toGateInstance` takes the effective approver. `gateView` (list, single, PATCH response) passes it. The PATCH approver check (formerly `:621`, now `:669`) reads the **resolved** definition's `allowedApproverRoleCodes`. |
| `apps/api/src/modules/workflows/gate-exceptions.ts` | `gateApproverConfig` returns the effective approver. It feeds the `gate_exception_to_decide` work-item routing (`exceptionApprovers`) and the on-behalf-of decide check (`decidesAsApprover`). |
| `apps/api/src/modules/workflows/scale.ts` | `dispositionParty` reads G5's effective approver role, not the stored one. |
| `apps/worker/src/handlers/gates.ts` | `effectiveGateApproverOf` is the SQL twin of `routedApproverOf`, because the worker imports no API code (ADR-0002 rule 5). `gateApprovers` (the recipients of the exception-expiry notices) uses it. |
| `docs/api/openapi.yaml` | `AutomationDryRunRequest`: the description now states the complete outbox payload, and a `gate.submitted` v1 example is added. This is description and example text only; the schema is unchanged. |
| `apps/api/test/integration/methodology/effective-approver.test.ts` | New. 8 implementer tests for scope 1. |
| `apps/api/test/integration/automation/dry-run-sample-shape.test.ts` | New. 2 implementer tests for scope 2. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-C3-*` | This handback and its logs. |

- No migration. `0094` was not needed (§2.1).
- No new dependency.
- No new route or operation.
- I did not edit `tests/qa/**`, `packages/reporting/**`, `apps/worker/src/reports/**` or `reporting/reports/assemblers/**`.

## 2. Scope 1: F-DG5-QA-A-1 (REQ-S06-004, REQ-S20-006; ADR-0039 §3; ADR-0015 §2)

### 2.1 Choice: runtime resolution, not instantiation

Every read that names a gate's approver now resolves it through `routedApproverOf`, the rule `submitGate` already routes by. I chose this over instantiation for four reasons:

1. **The stored row stays byte-identical.** Instantiation would have to rewrite `gate_instance.approver_role_code` at instantiation and again when a methodology migration moves a pin. ADR-0040 and the BE-C migration test (`historySnapshot` includes `gate_instance`) require a pin move to leave `gate_instance` byte-identical. A trigger-side rewrite would also bump the version, or skip it, with no audit event. That breaks clients' `If-Match` and rule 4 (every mutation audited).
2. **There is one rule.** Display, routing and authorization all go through the same function (`routedApproverOf`). Instantiation would still need `routedApproverOf` for already-existing rows, so the two could diverge.
3. **R2 holds by construction.** For a v1-pinned transformation the resolved definition is the catalogue, so `routedApproverOf` returns exactly the stored row. A configured approver (named user, or a role that is not the catalogue default) is also returned as stored.
4. **No SQL function change.** So no `0094`.

### 2.2 Sites examined (file:line in the changed tree; "affected" means it names a gate's approver from the stored row)

| # | Site | Affected? | Action |
|---|---|---|---|
| 1 | `workflows/gates.ts:159` `toGateInstance` (used only by `gateView`) | yes | Takes the effective approver (`:451–455`). |
| 2 | `workflows/gates.ts:620` `GET …/gates` (list) | yes | Through `gateView` with the catalogue (`:634`). |
| 3 | `workflows/gates.ts:640` `GET …/gates/:gateCode` (single) | yes | Through `gateView`. |
| 4 | `workflows/gates.ts:662` `PATCH …/gates/:gateCode` response | yes | Through `gateView`. The audit `changes` still record the stored from/to values: that is the record of the configuration write, unchanged. |
| 5 | `workflows/gates.ts:669` approver check (formerly `:621`) | yes, by text | Now reads `resolveGateDefinitions(tx, …)`. `allowedApproverRoleCodes` is never overridden by a version (`criteria.ts:584–620`), so the result is unchanged; tested with 422 `gate.approver_role_not_allowed`. |
| 6 | `workflows/gates.ts:938` `submitGate` approver | no | Already `routedApproverOf` (T-DG5-BE-C). |
| 7 | `workflows/gates.ts:391` `isGateApprover` | no | Already `routedApproverOf`. Used by exceptions in person and by `portfolio/dispensations.ts:404,464`. |
| 8 | `workflows/gates.ts:441–444` `canDecide` | no | Uses the pending **submission's** recorded approver. Correct: a submission keeps the approver it was routed to. |
| 9 | `workflows/gate-exceptions.ts:256` `gateApproverConfig` → `exceptionApprovers` (work items) and `decidesAsApprover` (on behalf of) | yes | Effective approver. |
| 10 | `workflows/scale.ts:369` `dispositionParty` (G5 approver BO → T11 party) | yes | Effective approver. |
| 11 | `apps/worker/src/handlers/gates.ts:525` `gateApprovers` (exception-expiry notices; inbox) | yes | SQL twin `effectiveGateApproverOf` (`:486`). A parity test compares it with the API for every gate. |
| 12 | `apps/worker/src/handlers/gates.ts:~210` `gate.submitted` → `gate_decision_due` tasks (My Work and inbox approval items) | no | Uses the event payload, i.e. the submission's routed approver. |
| 13 | `reporting/reports/assemblers/gate-pack.ts:225` `submission?.approver_role_code ?? instance.approver_role_code` | **yes** (when no submission) | **Not edited: KBE-D3 owns it.** See §5. |
| 14 | `reporting/my-work.ts` | no | Reads work items (rows 9, 11, 12). It never reads `gate_instance` approver columns. |
| 15 | Dashboards and other read models: `workflows/gate-readiness-read.ts:37`, `gate-reviews.ts:109,249`, `change-requests.ts:341`, `impact.ts:230`, `phase-steps.ts:313`, `portfolio/readiness.ts:68`, `portfolio/dispensations.ts:178,326`, `sustainment/closure.ts:259`, `reporting/modular.ts:209`, `reporting/reports/assemblers/charter.ts:33`, `methodology/migration-plan.ts:133`, `methodology/reapproval.ts:137` | no | They read `status`, ids or codes only. None names the approver. `gate-reviews.ts` selects all columns but uses no approver column. |
| 16 | `workflows/approval-routes.ts` (`approval_route_step.approver_role_code`) | no | Approval-route steps, not gate instances. |
| 17 | `portfolio/funding.ts:115` | no | Funding approval's own column. |
| 18 | Web `GatesPage.tsx:153`, `GateDetailPage.tsx:174` | fixed through the API | No web edit: they render `gate.approverRoleCode`, which is now the effective approver. |

### 2.3 Behaviour against the acceptance texts

**REQ-S06-004.** Acceptance (A06): "… changes an approver route in the UI; after publish, with no deployment or application-code change, … a submission is routed to the new approver".

- Routing was already delivered (BE-C).
- Every gate read now names that same approver: `GET …/gates/G3` of a new transformation reports `BO`.
- `tests/qa/integration/a06-configuration-change.test.ts` › "REQ-S06-004 (display): the gate of the NEW transformation reports the approver its submissions are routed to" **passes unchanged** (`focused-effective-approver-and-a06.log`: a06 27/27).

**REQ-S20-006.** Acceptance: "… the updated workflow routes to the new step/approver; records pinned to the old version are unchanged."

- The old (v1-pinned) transformation's whole gate list is byte-identical before and after the newer version is published (implementer test).
- The QA test "the existing one keeps SP" passes.

Implementer tests (`effective-approver.test.ts`, 8/8):

- **New transformation:** G3 and G5 report `BO` and G1 reports `SP`. `gate_instance` still stores `SP` with the same `version`, so nothing was rewritten.
- **List and single agree:** for all six gates the `gate` objects are deep-equal.
- **Old transformation keeps SP:** its list response is JSON byte-identical before and after v2 is published, and equals the stored row.
- **A configured approver is kept:**
  - a named user (SP + the Sponsor) on the v2-pinned transformation is reported as SP + that user by the single read, the list and the worker twin;
  - a configured role (G5 → BO) on the v1-pinned transformation is reported exactly as stored, and so is the change back to SP.
- **Approver check:** a PATCH of G1 with BO returns 422 `gate.approver_role_not_allowed`. The check reads the resolved definition.
- **Worker parity:** `effectiveGateApproverOf` equals the API's list for every gate, on both transformations.
- **Gate exception on the new transformation's G3:**
  - its `gate_exception_to_decide` items go to the BO, never the Sponsor;
  - the Sponsor deciding gets 403 `gate_exception.not_approver`, and the BO's decision gives 200 `accepted`;
  - on a v1-pinned transformation the items still go to the Sponsor.

### 2.4 Residual limitation (pre-existing in the ADR-0039 §3 rule; disclosed, not changed)

`routedApproverOf` treats "no named user and the catalogue default role" as *never configured*. So if someone explicitly configures SP as a role only (no user) on a transformation whose pinned version defaults G3 to BO, the gate still routes to BO, and now also displays BO.

- Display and routing agree, so the screen no longer shows an approver who cannot decide.
- An explicit role-only SP choice is still indistinguishable from the default, because nothing stored records "configured".
- A named-user configuration works and is tested.
- Closing this needs a schema or ADR decision, for example a stored `approver_configured` flag or an ADR-0039 §3 amendment. I did not invent one. Orchestrator decision.

## 3. Scope 2: QA-A O-1, the automation dry-run sample shape (REQ-S12-002; ADR-0043)

**Reading chosen.** ADR-0043 §4 says: "**Dry run (preview/test).** `POST …/dry-runs` evaluates the draft against a sample event (validated against the trigger's payload schema) inside a read-only transaction that is rolled back". §9 gives the refusal "422 `automation.dry_run_sample_invalid` | The sample event does not match the trigger's event fields."

So the sample is the **trigger's payload schema**, which for `gate.submitted` is the complete `gate.submitted` v1 outbox payload. It is not the condition fields only. The server (`automation/dry-run.ts` `validateSample`) already implements that reading. I fixed the contract, not the server:

- `AutomationDryRunRequest.description` now says:
  - the payload is the COMPLETE event payload of schema version 1 when the event has an outbox payload schema, "not only the trigger's conditionFields";
  - it lists the 10 `gate.submitted` v1 members;
  - for schedule triggers and events without a schema, only the condition fields, the initiating-user field and `transformationId`, as scalars;
  - the 16384-byte limit and the 422 code.
- Added `examples:` with a full `gate.submitted` v1 payload (synthetic ids).
- **The builder catalogue serves no sample shape.** `AutomationTrigger` has only `conditionFields`, so there was nothing to align there. See §5 for a proposal.

Tests (`dry-run-sample-shape.test.ts`, 2/2):

- The OpenAPI description names the complete payload, and its example parses with `outboxPayloadSchema("gate.submitted", 1)` (10 members).
- On the server:
  - a sample with only the catalogue's condition fields (plus `transformationId`) gives 422 `automation.dry_run_sample_invalid` with the exact §9 text, and no `automation_dry_run` row is written;
  - the documented example (with `transformationId` pointed at a transformation of the rule's organization) gives 201 with `conditionsMet: true`, and exactly one row is written.

## 4. Checks actually run (exit codes; logs in `docs/delivery/handbacks/DG5/T-DG5-BE-C3-evidence/`)

| Command | Environment | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` | worktree | exit 0, `PASS gate DG4 (historical)` (`validate-dg4-historical.log`) |
| `pnpm -r typecheck` | Node 24.21.0 | exit 0 (`typecheck.log`) |
| `pnpm -r build` | | exit 0 (`build.log`) |
| `pnpm lint` | | exit 0 (`lint.log`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | | exit 0 (`prettier.log`) |
| `pnpm openapi:lint` | | exit 0, `PASS … OpenAPI 3.1.1, 846 operations` (`openapi-lint.log`) |
| `pnpm test` (locale unset: `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | load average ≈18 | **exit 1.** unit-node 2251 passed, 1 failed (2252); unit-web 1534/1534; unit-formula-nocodegen 259 passed + 2 skipped (`unit-locale-unset.log`). See the note below. |
| the failed file alone, locale unset: `npx vitest run --project unit-node packages/reporting/src/pdf/pdf.test.ts` | | exit 0, 13/13 (`unit-locale-unset-pdf-rerun.log`) |
| `pnpm test` with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | load average ≈22 | **exit 1.** The same single failure; otherwise the same counts (`unit-c-utf8.log`) |
| the failed file alone, `C.UTF-8` | | exit 0, 13/13 (`unit-c-utf8-pdf-rerun.log`) |
| focused: `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23949 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/methodology/effective-approver.test.ts tests/qa/integration/a06-configuration-change.test.ts` | PostgreSQL 16.13, disposable | exit 0, 35/35 (a06 27, effective-approver 8) (`focused-effective-approver-and-a06.log`) |
| focused: the same harness with `apps/api/test/integration/automation/dry-run-sample-shape.test.ts` | | exit 0, 2/2 (`focused-dry-run-sample.log`). The first run exited 1: my unquoted YAML example made `snapshotSha256` a number, and the new test caught it. Fixed by quoting. |
| `QA_PG_PORT=… tests/qa/support/with-pg.sh pnpm test:integration` (twice) | PostgreSQL 16.13, disposable | **exit 1 both times: the fork aborted (`ERR_IPC_CHANNEL_CLOSED`) with no test failure before it.** The chunked runs are in §8. |

**The unit failure, disclosed.** In both locales the one failure is `packages/reporting/src/pdf/pdf.test.ts` › "renderPdf: Arabic (REQ-S13-009) › has a right-to-left base direction …", which hit `Error: Test timed out in 5000ms`.

- It is the first test of that file (font loading and layout warm-up). It ran while five W18 tasks shared the machine (load average 18–22).
- The file passes alone in both locales (13/13).
- My change touches no file in `packages/reporting/**`, and that test imports nothing I changed.
- It is a determinism-under-load issue (F-DG4-143…148 class) in a file BE-N2 owns this wave. I report it rather than edit it.

## 5. For the orchestrator: contract, schema and other owners' changes

1. **Gate-pack assembler (KBE-D3 owns it; not edited).** `apps/api/src/modules/reporting/reports/assemblers/gate-pack.ts:225` reads `submission?.approver_role_code ?? instance.approver_role_code`.
   - With no submission, a pack for a new transformation's G3 would print SP.
   - Needed change: replace the fallback `instance.approver_role_code` with the effective approver:
     ```ts
     import { effectiveGateApprover } from "../../../workflows/gates.ts"; // or export it from workflows/index.ts
     const effective = await effectiveGateApprover(db, tId, instance.gate_code);
     value: codeValue(submission?.approver_role_code ?? effective?.roleCode ?? instance.approver_role_code, "report.role"),
     ```
   - If the reporting module must not import workflows, the orchestrator can add `effectiveGateApprover` to the workflows barrel `index.ts`, or pass it through the assembler's ports. (`workflows/workflows.test.ts:45` pins that barrel's exports, so a barrel export needs that pin updated in the same change.)
2. **Web dry-run builder (FE owner; not mine).** `apps/web/src/pages/automation/RulePage.tsx:460–465` pre-fills the sample from `conditionFields` only, which the server refuses for `gate.submitted`/`gate.decided`.
   - The hint `workflowsP5.dryRun.payloadHint` ("The event's fields, as the trigger sends them") is true. The template is not.
   - Proposal, a contract addition for the orchestrator to decide: add `AutomationTrigger.samplePayload` (the example payload of the trigger's schema) to the catalogue, so the builder can pre-fill a valid sample. I did not add it, because the assignment limits me to the dry-run text.
3. **§2.4.** Explicit role-only configuration of the catalogue default cannot be told apart from "never configured". Needs an ADR-0039 §3 decision, or a stored flag (a migration).
4. **No new problem code, no migration, no dependency.**

## 6. Operations routed (delta to the pending list)

None. This repair adds no route and no operation. `p5-pending-*.ts` and `p5-exercises-*.ts` are unchanged, and the pinned counts in `contract.test.ts` are unchanged.

## 7. User-facing texts made untrue

None found.

- The Gates screens' "Approver" label is now true: it shows the approver who can decide.
- The dry-run hint stays true. The pre-filled template is a UI behaviour; see §5.2.
- No en/ar string calls this feature planned.

## 8. Integration run and what remains

**Acceptance item 3 is not met as a single command. Reported as BLOCKED by resources, not as passed.** I ran `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` twice:

| Run | Command | Result |
|---|---|---|
| 1 | ports 23910/23911-23949 | **exit 1, aborted.** After 39 files, all passing, the Vitest fork died with `Error: Channel closed` / `ERR_IPC_CHANNEL_CLOSED` (tinypool). No summary was printed (`integration-run1-aborted.log`). |
| 2 | ports 23920/23921-23949 | **exit 1, aborted the same way** after 49 files, all passing (`integration-run2-aborted.log`). |

- No test failed before either abort.
- The machine had 15 GB of memory with about 3 GB available, 4 CPUs and five concurrent W18 tasks.
- The single integration fork (vitest.config.ts runs every integration file in one fork) is consistent with being killed under memory pressure. I could not confirm that: there is no `dmesg` access in the sandbox.

Instead I ran the integration suites my change can reach, in fresh processes:

| Chunk | Command | Result |
|---|---|---|
| A | `QA_PG_PORT=23930 MTH_PORT_POOL=23931-23949 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/{workflows,gates,methodology,automation,portfolio,contract} apps/api/test/integration/gates.test.ts apps/api/test/integration/dg2-repairs.test.ts apps/worker/test/integration/gates.test.ts` | **exit 0. 62 files, 607 tests passed** (`integration-chunk-a.log`). It includes `contract.test.ts`, the DG2–DG4 gate and exception suites, the BE-C migration suite (`historySnapshot` byte-identical), the v1-readers R2 suite, the worker gates suite (expiry scan), and both new test files. |
| QA | `QA_PG_PORT=23940 MTH_PORT_POOL=23941-23949 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration` | **exit 1. 23 files: 21 passed, 2 failed. 263 tests: 259 passed, 4 failed** (`integration-chunk-qa.log`). |

The 4 QA failures are exactly the QA-C defects D-163 allocated to other W18 tasks, kept failing on purpose. They are outside my scope:

- `a15-demo-transformation-outputs` × 3:
  - "every generated demo snapshot records that it is synthetic" and "every format of every demo output … prints the illustrative label" (F-DG5-qa-c-2, BE-N2);
  - "a system SUM total remains a formula in the XLSX …" (F-DG5-qa-c-3, KBE-D3).
- `a15-outputs-every-definition` × 1: "every file … prints the B0004 provenance statement" (F-DG5-qa-c-1, BE-N2).

D-163 records 5 deliberate integration failures at `32284fd`. The fifth, A06 "REQ-S06-004 (display)", **now passes** (a06 27/27).

**Pinned counts:** no change. There is no new operation, `contract.test.ts` passed, and `openapi:lint` still reports 846 operations.

**Not run in this task:** the remaining integration directories (access, adoption, approvals, benefits, branding, calendar, delegations, dependencies, environment, evidence, forms, governance, groups, health, jobs, kpi, kpi-p4, kpi-restatements, launch, navigation, procedures, raid, reporting, sustainment, tasks, text-scan, the top-level files not listed above, `packages/*/test/integration`, and the other worker integration files). They are NOT reported as passed. The orchestrator's merged-tree verification should run the full `pnpm test:integration` on a less loaded machine.

**End time:** `2026-10-17T03:30Z` (about 117 minutes).

**What remains:**

- The full single-command `pnpm test:integration` run (BLOCKED above by resources).
- The `pnpm test` load timeout in BE-N2's `pdf.test.ts` (§4).
- §5.1, the gate-pack fallback (KBE-D3's file).
- §5.2, the web dry-run template (FE).
- §2.4, the explicit role-only default configuration (an orchestrator or ADR decision).

Merge notes: no migrations, no ordering constraints. `docs/api/openapi.yaml` is also edited by BE-N2 (the `ReportDocument` component). My hunk touches only `AutomationDryRunRequest`, so a text merge should apply cleanly.
