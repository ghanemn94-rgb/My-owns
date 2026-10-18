# Handback T-DG5-BE-V2 (backend-workflow-engineer): DG5 round-1 repair of F-DG5-101

- **Stage:** P5, gate DG5, FIXING after round 1 on candidate `sha256:8e7d23a3…` (D-170).
- **Invocation:** `DG5-T-DG5-BE-V2-backend-workflow-engineer-20261018T051543Z-a1ea4154` (session `a1ea4154-578c-40d0-961c-01bb1879de75`).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-V2.md`, sha256 `a99331e5…2be0` (verified).
- **Worktree:** `/home/user/wt/dg5-be-v2`, branch `dg5/be-v2`, at `e0cfdaf`. The changes are left **uncommitted**, as the assignment requires.
- **Time:** start `05:16:00Z`, end `05:57:32Z` (`date -u`), about 42 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0, at the start and again at the end.

## Summary: one acceptance check fails, and the fix is outside my ownership

The product fix is done, and its regression test fails before and passes after.

**`tests/qa/integration/a02-a21-complete-lifecycle.test.ts` now fails one test (exit 1).**
- **The cause:** the QA fixture relies on the defect F-DG5-101 describes. Its organization-scope Lead `tlOrg` holds TL at organization scope only, and TL does not inherit downward. `tlOrg` completes `capture_intake` naming T, which `l.tl` created in BU a1. `tlOrg` cannot read T.
- **D-170 requires this refusal.**
- **The file is QA-owned** (`tests/qa/**`), so I did not edit it.
- **A one-hunk fixture change** (the intake's Lead is given TL on T, so it can read the transformation it names) makes all 13 tests pass. I proved it on a temporary copy, which I deleted.
- **The orchestrator must have the owner apply it before the merged-tree verification.** Details are under "Checks" and "Contract, schema and dependency needs".

## Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/procedures/outputs/kit.ts` | The read rule for every output adapter. It adds `OUTPUT_READ_PERMISSION`, `requireOutputRead` and `requireNamedRecordRead`, the call in `outputAdapter.produce`, and the header text. |
| `apps/api/src/modules/procedures/steps.ts` | The engine's generic `link` fallback (no adapter registered) applies the same rule, plus one import. |
| `apps/api/test/integration/procedures/output-read-authorization.test.ts` (new) | The reviewer's reproduction as a product test, with its final assertion kept. Also the positive path, the charter adapter refusal, the generic-link refusal and the audit assertions. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-V2-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-V2-evidence/*` | The logs, the product diff (`product-change.diff`), and the proposed QA fixture diff (`proposed-qa-a02-fixture.diff`, not applied). |

- **No migration.** No migration is added or edited.
- **No API endpoint is added.** No response shape changes and no dependency is added.

## F-DG5-101 (Medium, mandatory; REQ-S06-002)

### Cause

- **`kit.ts` `inScope` (round-1 lines 87-99)** checked only the organization for an organization-scope instance with no earlier output.
- **`producedHere` (round-1 lines 104-118)** checked only the creation time, and that no other instance had taken the record.
- **`steps.ts` `completeStep`** called the adapter after authorizing the actor on the instance's scope only.
- **The result:** nothing checked that the acting person can read the named record. So an organization-scope TL could claim another business unit's transformation, and D-166 Rule A (0096) then moved the intake's steps into it.

### Fix (D-170)

- **`kit.ts:115`, `OUTPUT_READ_PERMISSION = "transformation.read"`.** This is the read permission that every output record type's own GET checks, in the record's own transformation.
  - transformation: `GET /transformations/{id}` (`transformations/routes.ts:440`).
  - charter, baseline, kpi_actual, tom_canvas_cell, ranking_snapshot, gate_submission, change_request, finance_validation, decision, bau_handover, evidence and approval: each module's read gate is `requireTransformationRead` on the record's transformation. For example: `benefits/finance-validation.ts:438`, `portfolio/rankings.ts:551`, `evidence/routes.ts:432`, `workflows/approvals.ts:1299`.
- **`kit.ts:124-138`, `requireOutputRead`.** It calls the same policy resolver the GETs use (`access.requireRead`) with the engine's principal. That principal's grants are reloaded inside the completing transaction (`authorizeStepWrite` → `refreshPrincipal`).
  - **Commit time:** the check runs after the advisory lock and the `FOR UPDATE` the step already takes (`openStep` → `lockAndLoad`), so it is re-checked at commit time (shared rule §2.4).
  - **The refusal:** a 404 from the read gate becomes `422 procedure_step.output_record_invalid`, the same code and detail an unknown record gets, with no record id.
- **`kit.ts:249-250`.** `outputAdapter.produce` calls it for **every adapter and every mode** (create, advance, link), right after `inScope` and before any other check returns.
  - All 12 registered adapters are built by `outputAdapter`.
  - Because the call comes after `inScope`, the existing refusals of out-of-organization or out-of-transformation records are unchanged.
- **`kit.ts:144-157` and `steps.ts:1343-1344`.** The engine's generic `link` fallback links a record when no adapter is registered (today reachable only for an `approval` output on a task step). It now applies the same rule.
  - A record that does not exist is left to the 0069 link guard, as before.
- **Nothing is linked and nothing is adopted.** The refusal is thrown before `insertLink` and before `adoptIntakeTransformation` (`steps.ts:1348`, `:1364`), and the whole transaction rolls back. So D-166 Rule A never follows a refused link.
- **Audit (judgement call, flagged for review).**
  - The refusal carries the read gate's denial. The existing failed-mutation hook (`access/denials.ts`) therefore writes the **existing** `authorization.denied` event, naming the record's transformation and `requires transformation.read`. No new event type is added.
  - An unknown record still writes nothing, as before. A missing record is not an authorization event, per that file's header.
  - The denial is never in the response body (`HttpProblem.toBody`). The client sees a byte-identical problem shape: the test compares its keys, code and detail with the unknown-record refusal.
  - **Why I chose this:** ADR-0004 audits every failed authorization of a mutation on an existing target. If round 2 reads D-170's "the same … as for an unknown record" as "no audit at all", deleting the `withDenial` at `kit.ts:135` restores that.
- **`principal === null`.** This is an approval step completing through its business approver's decision (`onApprovalOutcome`, `steps.ts:1469`). It names no record, and its `advance` acts on the record an earlier step linked, which passed this same check when it was linked.
  - The approver acts in workflows. Nothing here decides or grants a business approval.

### Regression test

`apps/api/test/integration/procedures/output-read-authorization.test.ts`, all values synthetic:

1. **`:107`, the reviewer's reproduction.** The setup and steps are those of `docs/delivery/test-evidence/DG5/code-security/round-1/repro/intake-foreign-transformation.test.ts`.
   - **Its final assertion is kept:** `expect([c1.status, c1.body?.code]).toEqual([422, "procedure_step.output_record_invalid"])`.
   - **Added:**
     - the same detail and the same problem keys as an unknown-record refusal, and the body does not contain X;
     - no output link;
     - no adopted step (`capture_intake` active, the other steps pending, all with `transformation_id` null);
     - instance version 1, unchanged;
     - TL2 still gets 404 on TL1's intake;
     - exactly one audit row for the request (`authorization.denied` on transformation X), and none for the unknown-record request.
2. **`:151`, positive.** TL1 names a transformation it can read (it is that transformation's creator): 200, the transformation is linked, and `draft_charter` and `confirm_sponsor` adopt it. This is the same behaviour as `intake-adoption.test.ts`.
3. **`:170`, another adapter (`charter`).**
   - TL1 captures T and drafts its charter. TL1's transformation-scope and BU grants are then revoked. TL1 still acts at organization scope and can no longer read T.
   - `draft_charter` naming T's charter → 422 `output_record_invalid`, nothing linked, step still active, `authorization.denied` audited.
   - With the charter adapter unregistered, the engine's generic link gives the same 422 and audit. The adapter is restored in `finally`.
   - With the read restored, the same completion links the charter (200).

### Failing before, passing after

- **Before the fix** (`T-DG5-BE-V2-evidence/failing-before.log`, exit 1): 2 failed, 1 passed.
  - `:107` gave `expected [ 200, undefined ] to deeply equal [ 422, …(1) ]`, the reviewer's exact failure.
  - `:170` gave `expected [ 200, undefined, undefined ] to deeply equal [ 422, …(2) ]`.
  - The positive test passed.
  - **Disclosure:** this run predates the generic-link block I added to `:170` afterwards. The failure is at the first refusal, which precedes that block.
- **After the fix:**
  - `T-DG5-BE-V2-evidence/passing-after.log`: exit 0, 3/3.
  - `T-DG5-BE-V2-evidence/repro-verbatim-and-regression-after.log`: the final version of the test plus the reviewer's file run **unchanged** (temporary copy, deleted afterwards). Exit 0, 4/4.
  - The reviewer's console lines now read `TL1 capture_intake with X -> 422 procedure_step.output_record_invalid` and `TL2 GET TL1's intake -> 404`.

## Checks

Each check ran once, one at a time (D-164), on Node 24.21.0, offline, on PostgreSQL through `with-pg.sh`, with ports 23050–23099.

| Command | Exit | Result | Log |
|---|---|---|---|
| `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| `pnpm -r build` | 0 | all packages Done | `build.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint.log` |
| `npx vitest run --configLoader runner --project unit-node`, locale unset (`env -u LANG -u LC_* …`) | 0 | 144 files, 2335 tests passed | `unit-node-locale-unset.log` |
| the same with `LANG=LC_ALL=C.UTF-8` | 0 | 144 files, 2335 tests passed | `unit-node-c-utf8.log` |
| `QA_PG_PORT=23050 MTH_PORT_POOL=23051-23099 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/procedures apps/api/test/integration/contract.test.ts tests/qa/integration/a02-a21-complete-lifecycle.test.ts` | **1** | 8 files passed; `a02-a21` 1 failed / 12 passed; 69/70 tests in total (see below) | `integration-assigned.log` |
| the same harness, `apps/api/test/integration/contract/contract.test.ts` | 0 | 83/83 | `integration-contract.log` |
| the same harness, `a02-a21` with the proposed QA fixture hunk (temporary copy `tests/qa/integration/zz-be-v2-tmp-a02-proposed.test.ts`, deleted) | 0 | 13/13 | `qa-a02-with-proposed-fixture.log` |
| the same harness, other reached suites: `apps/api/test/integration/environment/demo-users-new-transformation.test.ts`, `tests/qa/integration/a06-configuration-change.test.ts` | 0 | 34/34 (7 + 27) | `integration-reached-other.log` |
| `E2E_PG_PORT=23060 E2E_API_PORT=23061 MTH_PORT_POOL=23062-23099 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p5-procedure-outputs.spec.ts --workers=1` | 0 | 2/2 (chromium-en, chromium-ar) | `e2e-p5-procedure-outputs.log` |
| `node tools/gates/validate.mjs --historical --stage DG4` (start and end) | 0 | `PASS gate DG4 (historical)` | (console) |

The assigned procedures directory, per file:

| File | Tests |
|---|---|
| `seeded-procedures` | 13 |
| `procedure-instances` | 10 |
| `intake-adoption` | 12 |
| `procedure-definitions` | 8 |
| `output-read-authorization` | 3 |
| `adopted-step-authorization` | 2 |
| `entity-group` | 5 |
| `coverage` | 4 |
| **Total** | **57**, all passed |

**Not run (D-164):** `pnpm test`, `pnpm test:integration` and the full e2e suite. They were not run and are not claimed as passed.

**Disclosures:**

- **The a02-a21 failure (exit 1).**
  - The test is `REQ-S06-003 … drives every instance through its steps …`, at `a02-a21-complete-lifecycle.test.ts:1495`.
  - It now reports `capture_intake (TL): 422 procedure_step.output_record_invalid`.
  - This is the fix working: the fixture's `tlOrg` (TL at organization scope only, `:1087-1105`) names T created by `l.tl` in BU a1 (`:1167-1176`), and `tlOrg` cannot read T.
  - The proposed hunk (`proposed-qa-a02-fixture.diff`) assigns `tlOrg` TL on T through the native `POST /api/v1/role-assignments`, before the Sponsor is staffed. With it, 13/13 pass.
- **The contract test path.** The assignment names `apps/api/test/integration/contract.test.ts`, which does not exist, so Vitest silently matched nothing for it in the assigned run. The file is `apps/api/test/integration/contract/contract.test.ts`. I ran it separately: 83/83.
- **First `unit-node` run (exit 1).** The log is kept as `unit-node-locale-unset-run1-cc-writes-artifact.log`.
  - It failed 1/2335: `architecture.test.ts:68` saw `.claude` as an unmapped module directory.
  - **The cause:** empty `.claude/` parent directories left by the session's write tracking in the folders I touched (I had removed only the inner `.cc-writes`).
  - I removed the empty `.claude` and `.cc-writes` directories (none is tracked) and re-ran: 2335/2335 in both locales. No product cause.

## Contract, schema and dependency needs (for the orchestrator)

- **Contract:** none. The code and detail are the existing ADR-0042 §10 `procedure_step.output_record_invalid`. No new operation and no new response shape.
- **Schema or migration:** none.
- **Dependency:** none.
- **Test fixture outside my ownership (needed for acceptance 3):** apply `T-DG5-BE-V2-evidence/proposed-qa-a02-fixture.diff` to `tests/qa/integration/a02-a21-complete-lifecycle.test.ts`, by its owner (qa-verifier) or as the orchestrator decides.
- **Assignment path correction:** `apps/api/test/integration/contract.test.ts` should read `apps/api/test/integration/contract/contract.test.ts`.
- **Observation, not changed (outside D-170's decided scope):** `POST …/steps/{key}/evidence` (`linkEvidence`, `steps.ts:1420-1438`) is an *evidence* link, not an output. On an adopted step it requires the evidence to belong to T, but not that the actor can read T.
  - The case: an organization-scope actor who lost read on T and still knows an evidence id could link it.
  - The same `requireOutputRead(tx, acting.principal, t)` call would close it. I did not widen the decided scope; please decide.

## ADR and data-dictionary statements this fix makes untrue or incomplete (for T-DG5-ARCH-R4)

- **ADR-0042 §3 (`:75`), "Outputs are real linked records".** It lists the `create` check as "of the step's type, in the instance's scope, produced since the launch and not another instance's output". It should add, for every mode, that the acting person holds `transformation.read` on the record's transformation, on grants reloaded in the completing transaction. Otherwise the refusal is 422 `output_record_invalid`, audited as `authorization.denied`.
- **ADR-0042 amendment V3 (`:292-298`).**
  - The per-mode bullets ("link: names an existing record of the step's type, in scope") and the refusal list ("A record of the wrong type, out of scope, or not produced for this step → 422 `procedure_step.output_record_invalid`") should add "or one the acting person cannot read". The same applies to the engine's generic `link`.
- **ADR-0042 §9 (`:149-151`), authorization table.** "complete … a step" lists only `procedure.act` and the step actor. It is now incomplete: completing with an output also needs read on the output record.
- **`docs/api/openapi.yaml` `ProcedureStepComplete` description (`:26231-26234`)** says the adapter checks "that it is of the step's type, in the instance's scope …". This is description text only. The shape and codes are unchanged; the architect may add the read rule.
- **Data dictionary `procedure_instance_link` (`:9896`).** It is not untrue: the database guard is unchanged. It could note that the API also requires the actor's read on the linked record, which the guard does not check.

## User-facing texts

- **No user-facing text becomes untrue.** The refusal reuses `procedure_step__output_record_invalid`. Its en text ("The linked record is not of the expected type or not in this scope.") and its ar text (`apps/web/src/i18n/{en,ar}/problems.json:688`) stay true, because a record the person cannot read is "not in this scope" for them, and the text deliberately discloses nothing more.
- **No text was changed.**

## Merge instructions

- There is no migration and no ordering constraint.
- The change touches only `procedures/outputs/kit.ts`, `procedures/steps.ts` (around line 92 and lines 1342-1344) and one new test file. No overlap with T-DG5-BE-V1, V3 or FE-V1 ownership is expected.
- Apply the QA fixture hunk (above) before the merged-tree `a02-a21` run.

## What remains

1. **The QA fixture hunk** for `a02-a21-complete-lifecycle.test.ts`. It needs its owner. Until it is applied, that test is expected to fail one test, as a direct consequence of D-170.
2. **The orchestrator's decision** on the `linkEvidence` observation.
3. **The ADR-0042 and OpenAPI description amendments** (T-DG5-ARCH-R4).
4. **The repository-wide suites** (`pnpm test`, `pnpm test:integration`, the full e2e). Not run, D-164; they belong to the orchestrator's merged-tree verification.
5. **F-DG5-101 closes only** through the code-security reviewer's round-2 verification. I do not close it.
