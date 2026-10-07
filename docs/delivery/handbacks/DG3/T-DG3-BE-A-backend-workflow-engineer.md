# Handback T-DG3-BE-A: P3 backend foundation (backend-workflow-engineer)

- **Stage:** DG3 (BUILDING), branch `claude/mobily-transformation-platform-regate`.
- **Base:** `HEAD` = `df13c99c64199d14b3d76699fb0695a89a56f388`, main working tree. I committed nothing.
- **Invocation:** run `DG3-T-DG3-BE-A-backend-workflow-engineer-20261007T220229Z-95af1a77`, session `95af1a77-627d-453b-95e7-8c04768930b7`.
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-BE-A.md`, sha256 `280ed34a…7ba1`, verified at start.
- **Time:** start `Wed Oct 7 22:02:38 UTC 2026`, end `Wed Oct 7 22:37 UTC 2026` (about 35 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` → `PASS gate DG2 (historical)`, exit 0. I ran it at the start and again at the end (`T-DG3-BE-A-evidence/validate-historical-DG2.log`).
- **Scope of the business records:** product gates G1–G6 are business approvals inside the product. Every decision in the tests is a synthetic demo decision that approves nothing real. Nothing here reads or writes the DG0–DG7 records.

Everything in the assignment is done, including the "first change". Five files outside the literal "BE-A Owns" list had to change, and §5 below justifies each one. Two problems in the frozen inputs are reported in §6.

## 1. Migration

**`packages/db/migrations/0025_p3_g1_agreement_guard.sql`** (the only migration) does two things:

1. **Deferred constraint trigger `gate_decision_g1_agreements`.** It runs `AFTER INSERT ON gate_decision DEFERRABLE INITIALLY DEFERRED`. An approved G1 `gate_decision` must have exactly the three `gate_decision_agreement` rows (`problem`, `baseline`, `material_value_pools`) at COMMIT. Otherwise it raises SQLSTATE `23000` with constraint `gate_decision_g1_agreements`. The API maps that constraint to 500, because the API answers 422 before the guard can ever fire.
2. **`CREATE OR REPLACE FUNCTION p3_instantiate_transformation`.** The body is identical to `0024` except for one line: the `scoring_weight_set.create` audit event now writes `changes` as `{"weights": {"from": null, "to": {…}}}`. See finding 6.1. Without this fix, switching `POST /transformations` to the P3 function breaks `GET /transformations/{id}/audit` contract validation.

`schema.ts` gets a comment only, because 0025 adds no relation or column. `catalogue.test.ts` gets one new test asserting that the trigger exists and is deferrable and initially deferred.

**Fresh apply:** the final integration run logs `applied 25 migrations to a fresh database` on PostgreSQL 16.13 (`integration.log`, line 1).

## 2. API endpoints added

All six are portfolio-tag operations from the frozen contract, routed in `apps/api/src/modules/portfolio/`:

| Operation | Route | Access | Statuses exercised |
|---|---|---|---|
| `getTransformationReadiness` | `GET /api/v1/transformations/{id}/readiness` | `transformation.read` | 200, 400, 404 |
| `getOutcomeHierarchy` | `GET /api/v1/transformations/{id}/outcome-hierarchy` | `transformation.read` | 200 |
| `listGateDispensations` | `GET …/gate-dispensations` (cursor, limit; newest first) | `transformation.read` | 200 |
| `createGateDispensation` | `POST …/gate-dispensations` | `gate.submit` | 201, 400, 403, 422 |
| `decideGateDispensation` | `POST …/gate-dispensations/{dispensationId}/decision` (If-Match) | `gate.decide` | 200, 403, 409, 422, 428 |
| `revokeGateDispensation` | `POST …/gate-dispensations/{dispensationId}/revoke` (If-Match) | `gate.decide` | 200, 400, 403, 422, 428 |

**Changed operation:** `decideGate` (`POST …/gates/{gateCode}/decision`) now enforces the G1 `agreements` rule and returns `agreements`. `getGateSubmission` also returns the decision's `agreements`.

Each mutation route declares `config.consumes: ["application/json"]` and re-authorises inside its transaction (`openWrite(…, { atCommit: true })`, the BE18A pattern). Each one validates with the shared zod schemas (free text through `freeText`), checks `If-Match` (428/409; creates are version 1), writes one audit event per changed row, and does no client or remote I/O inside the transaction.

## 3. Changed files

**API module and wiring**

| File | Purpose |
|---|---|
| `apps/api/src/modules.ts` | Adds the `portfolio` module with `dependsOn: platform, audit, access, transformations, kpi, evidence, workflows`, and `P3_MODULES`. `workflows` does not depend on `portfolio`. |
| `apps/api/src/server.ts` | Registers `registerPortfolioModule`. Builds the `GateFactsProvider` (`portfolio: loadPortfolioGateFacts`; the `kpi` part yields no facts until KBE-C, see §8) and passes it to `registerWorkflowsModule`. |
| `apps/api/src/architecture.test.ts` | Asserts `P3_MODULES` and portfolio's exact `dependsOn`, that no module depends on `portfolio`, and that portfolio has its own suite. The graph stays acyclic. |
| `apps/api/src/server.test.ts` | Module composition now lists `portfolio` (active, P3). See §5. |

**The portfolio module**

| File | Purpose |
|---|---|
| `portfolio/index.ts` | Registers every portfolio route file and exports the sequencing rules, `loadSequencingFacts`, `latestFundingState` and `loadPortfolioGateFacts`. |
| `portfolio/sequencing.ts` (+ `sequencing.test.ts`) | Pure rules returning `{ ok: true } \| { ok: false, code, reasonEn }`: `checkG1`, `checkSubmit`, `checkDirectionForLaunch` (End-to-End vs Modular), `checkLaunch`, `sequencingState` and `blockersOf`. The ADR-0021 §3 texts are verbatim. |
| `portfolio/dispensations.ts` | Create, decide, revoke and list. Exports `loadDispensations` and `loadSequencingFacts` for BE-B. |
| `portfolio/readiness.ts` | The §9 view, with the B0012→T01 mapping and the pure `diagnosticCoverage`. |
| `portfolio/hierarchy.ts` | The five-level tree, plus `toInitiativeOutcomeContribution` for BE-B to reuse. |
| Stubs: `initiatives.ts`, `links.ts`, `transitions.ts`, `selections.ts` (BE-B); `waves.ts`, `deliverables.ts`, `milestones.ts`, `roadmap.ts` (BE-C); `prioritization.ts`, `scores.ts`, `rankings.ts`, `overrides.ts` (BE-D); `capacity.ts`, `resource-demands.ts`, `funding.ts`, `gate-facts.ts` (BE-E) | Typed `register…Routes(app, deps): readonly string[]` that register nothing yet. `funding.ts`'s `latestFundingState()` returns `"unfunded"` (fail closed). `gate-facts.ts` has `loadPortfolioGateFacts()`. |

**Workflows**

| File | Purpose |
|---|---|
| `apps/api/src/modules/workflows/g4.ts` | Stub for BE-E: `GateFactsProvider`, `PortfolioGateFacts`, `KpiP3GateFacts`, `UNWIRED_GATE_FACTS`, and `buildG4Snapshot()`, which returns null. |
| `apps/api/src/modules/workflows/gates.ts` | The G1 `agreements` rule (`agreementRule`, after checks 1–4), the three agreement rows, `agreements` in the audit diff and in the responses, the G4 snapshot hook (only for G4, so G1–G3 snapshots stay byte-stable), the provider parameter, and the exported `isGateApprover`. |
| `apps/api/src/modules/workflows/index.ts` | Exports `isGateApprover` and the provider types; `registerWorkflowsModule` accepts `{ gateFacts }`. See §5. |
| `apps/api/src/modules/workflows/workflows.test.ts` | The public-surface key list gains `isGateApprover`. See §5. |

**Other API source**

| File | Purpose |
|---|---|
| `apps/api/src/modules/platform/db-errors.ts` | The P3 problem mapping (§4 below). `PgErrorLike` gains `message` and `detail`. Exports `DependencyCycleProblem` (the `cycle` extension member) for BE-C's API-side check. |
| `apps/api/src/modules/platform/db-errors.test.ts` | New unit tests for every P3 mapping. |
| `apps/api/src/modules/transformations/routes.ts` | The one-line switch to `p3_instantiate_transformation()`. |

**Database**

| File | Purpose |
|---|---|
| `packages/db/migrations/0025_p3_g1_agreement_guard.sql` | See §1. |
| `packages/db/src/schema.ts` | Comment line for 0025. |
| `packages/db/test/integration/catalogue.test.ts` | The 0025 trigger test. |

**Shared schemas**

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/portfolio.ts` | Zod mirrors of every portfolio-tag schema: Initiative*, the gap/contribution/decision links, Deliverable*, Milestone*, PortfolioSelection*, FundingDecision*, GateDispensation*, TransformationReadiness, GateReadiness, DiagnosticAreaCoverage, OutcomeHierarchy, ScheduleFlag, SelectionRequest, TransitionNote and AcceptanceDecision. Amounts are `decimal` strings and never `number`. |
| `packages/shared/src/schemas/index.ts` | Exports `portfolio.ts`. |
| `packages/shared/src/schemas/gate.ts` | Adds `gateAgreements`, `gateAgreementRecord` and `GATE_AGREEMENT_CODES`; `agreements` on `gateDecisionCreate` and `gateDecision`. See §5. |

**Contract-test seams**

| File | Purpose |
|---|---|
| `contract/contract.test.ts` | Imports all seven `p3-exercises-<task>.ts`, calls each in its own `it`, and merges each `P3_MIRRORS_<TASK>` into `ZOD_MIRRORS`. Updates the pinned counts (§7). |
| `contract/p3-exercises-be-a.ts` | Real exercises of the six BE-A operations, with zod mirrors. |
| `contract/p3-exercises-{be-b,be-c,be-d,be-e,kbe-b,kbe-c}.ts` | Stubs: `exerciseP3<Task>Operations(ctx)` and an empty `P3_MIRRORS_<TASK>`. The owning task fills only its own file. |
| `contract/malformed-input.ts` | `wellFormed` handles `criterionCode` → `feasibility`, `snapshotNo` → `1` and `dependencyTypeCode` → `tech`. `media-types.ts` and `platform-statuses.ts` derive generically and needed no change. |
| `test/support/p3-pending-be-a.ts` | Now empty; all six operations are routed and exercised. |
| `test/support/harness.ts` | Adds `P3ExerciseContext`, the type every seam receives. |

**Integration tests and helpers**

| File | Purpose |
|---|---|
| `test/support/p2-fixtures.ts` | `G1_AGREEMENTS` constant. |
| `test/integration/gates.test.ts`, `contract/p2-exercises.ts` | Every G1 approval sends `agreements`. |
| `test/integration/registers.test.ts`, `test/integration/transformations.test.ts` | The audited starter rows of a create include the 5 P3 rows (4 waves and weight set v1). See §5. |
| `test/integration/portfolio/fixtures.ts` | A pending submission with its audit events, gate-status staging and a Modular world. All synthetic. |
| `test/integration/portfolio/g1-agreements.test.ts`, `readiness.test.ts`, `dispensations.test.ts` | The required new suites. |

## 4. Behaviour delivered, per requirement

**REQ-PB-022: G1 agreements (ADR-0021 §8)**

- For `G1` with outcome `approved`, the decision needs `agreements` with all three confirmations `true`.
- If any are missing or `false`, the answer is 422 `urn:mth:problem:validation`, code `gate.g1_agreements_required`, with the exact ADR detail. `errors[]` holds one pointer per missing confirmation, drawn from `/agreements/problem`, `/agreements/baseline` and `/agreements/materialValuePools`. Nothing is written.
- `agreements` on any other gate or any other outcome → 422 `gate.agreements_not_applicable`, pointer `/agreements`.
- An unknown key or a non-boolean inside `agreements` is 400: it's a malformed request, not the rule.
- The rule runs after ADR-0015 checks 1–4: 404, 403 `gate.not_approver`, 403 `gate.submitter_cannot_decide`, 409 `gate.submission_superseded`. Integration tests confirm all of these keep their precedence.
- On approval, the three `gate_decision_agreement` rows are inserted, with `confirmed_by` set to the decider. The `gate_decision.create` audit diff carries `agreements: {from: null, to: ["problem","baseline","material_value_pools"]}`.
- The 0025 guard fires at COMMIT, proven against the real database: no rows → `23000` / `gate_decision_g1_agreements` and nothing persists; two of three → refused; all three → commits.

**REQ-PB-007: readiness (ADR-0021 §9)**

- A fresh transformation gives `missingDiagnosticAreas = [economics, customer, operations, capability, technology]`.
- The mapping is: economics = financial, customer = customer, operations = process, capability = people_org, technology = technology + data. Technology is covered only when both of its dimensions are.
- Coverage uses the content half of `g1.diagnostic`: the seeded T01 row states current state, root cause, impact and confidence. It reads the facts through `workflows.loadGateFacts`, so it uses exactly the facts G1 evaluates.
- `gates` lists G1–G4 with their dispensations.
- `sequencing.blockers` uses the §3 codes and verbatim texts. A test approves G1, then G2 and G3, and checks how the blockers clear.

**REQ-PB-032: outcome hierarchy**

- The tree is the current North Star → non-archived outcomes (through the transformations presenter) → non-archived T02 rows → `targetValue` (null means Unknown, never 0) and `targetDate` → active contributions.
- Contributions without a KPI sit under their outcome. The view is read-only.

**Dispensations (ADR-0021 §4–§6; increments of REQ-PB-004, REQ-PB-005, REQ-S03-004 and REQ-S03-005)**

- **Waiver:** needs a reason, an expiry (not in the past) and a scope (the whole transformation or one `initiativeId` in the transformation). It is End-to-End only and covers G2 or G3 only; G1 is never waived. It is accepted or revoked only by the waived gate's configured approver (`isGateApprover`; another `gate.decide` holder gets 403 `gate.not_approver`). The recorder can never decide it: 403 `dispensation.decider_is_recorder`, also enforced by the DB CHECK.
- **Inherited approval:** Modular only. It needs an approving body, an approval date (not in the future) and an evidence item in the transformation. Acceptance is refused with 422 `dispensation.evidence_not_verified` until the evidence is verified under the ADR-0018 rule. `counts` is re-evaluated on every read: accepted, not expired in the transformation's time zone (Asia/Riyadh by default) and, for inherited approvals, evidence verified now.
- No `gate_decision` row is ever created and `gate_instance.status` never changes. The tests assert both.
- Decide and revoke check `If-Match` (428/409). Decide works only on `pending` and revoke only on `accepted`; anything else is 422 `urn:mth:problem:invalid-transition`.
- AUD gets 403 on create, decide and revoke, and the denied attempt is audited as `authorization.denied`.
- Delegated decisions (`onBehalfOfUserId`) are refused with 422 `dispensation.on_behalf_not_supported`. This is a design choice; see §8.

**`sequencing.ts`** contains the pure functions BE-B calls. `checkLaunch` checks G1 only while the initiative is still `draft`, then the End-to-End direction rule with the exact reason 'North Star, outcomes and target state not yet approved'. A counting waiver satisfies it per missing gate, either for the whole transformation or for that initiative. Modular transformations aren't held to it. G1 is satisfied by approval, or (Modular only) by a counting inherited approval.

**Problem mapping (`db-errors.ts`), each case unit-tested**

| Constraint | Answer |
|---|---|
| `*_version_step` | 409 |
| `initiative_status_transition` | 422 `invalid-transition`; the database message is not echoed |
| `dependency_acyclic` | 422 `dependency.cycle`, detail `Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01` parsed from the DB message. The `cycle: [{initiativeId, code}]` member is built from the DB message and DETAIL; `name` is omitted because the mapping is pure. |
| `scoring_weight_set_total` | 422 `prioritization.weights_total`, `Weights must total 100% (got 95.00%)`, pointer `/weights` |
| `*_validator_not_author` | 403 `finance.validator_is_author` |
| `*_approver_not_proposer` | 403 `approval.approver_is_proposer` |
| `*_decider_not_recorder` | 403 `dispensation.decider_is_recorder` |
| `*_acceptor_not_submitter` | 403 `deliverable.acceptor_is_submitter` |
| Named P3 CHECKs | 422 `validation.constraint` with the field pointer |
| NOT NULL | 422 with the column pointer |
| `*_audit_required`, `gate_decision_g1_agreements` | 500 |

**Instantiation:** `POST /transformations` now calls `p3_instantiate_transformation()`. A test proves a new transformation has the four B0079 waves verbatim, the active weight set v1 at 25/25/20/15/15 (decimal strings) and their 5 audit events.

## 5. Files touched outside the literal "BE-A Owns" paragraph

Each one is a direct consequence of an assigned change. Please confirm or reassign.

| File | Why |
|---|---|
| `packages/shared/src/schemas/gate.ts` | `gateDecisionCreate` and `gateDecision` are strict objects. Without `agreements`, the G1 request would be 400 and the `decideGate` zod mirror check would fail. The change is additive. |
| `apps/api/src/modules/workflows/index.ts` | The only way to pass the `GateFactsProvider` into `registerGateRoutes`, and to export `isGateApprover` to portfolio. No task owns this file; BE-C will also need to add registrations here. |
| `apps/api/src/modules/workflows/workflows.test.ts` | Its pinned public-surface list gains `isGateApprover`. |
| `apps/api/src/server.test.ts` | Its pinned module list gains `portfolio`. It's the test of `server.ts`, which I own. |
| `apps/api/test/integration/registers.test.ts` and `transformations.test.ts` | They pinned the audit rows of a create at the P2 count, and the instantiation switch adds 5 rows. |

## 6. Problems found in the frozen inputs

**6.1 (Medium, data integrity / contract; proposed `F-DG3-BE-A-1`).** The `0024` `p3_instantiate_transformation()` writes `audit_event.changes = {"weights": {…}}`, which is not the `{field: {from, to}}` AuditEvent shape. After the switch, `GET /transformations/{id}/audit` failed contract validation in `transformations.test.ts` and `access-scope.test.ts` (`integration-run1-failed.log`). I fixed the function in `0025`.

Residual risk: the `0024` backfill already ran on upgraded, populated databases, and the rows it wrote keep the old shape, because `audit_event` is append-only. A fresh database has none. The architect or orchestrator should decide whether the audit read path needs a tolerance for those legacy rows, or whether a note is enough.

**6.2 (contract observation; no change made).** ADR-0021 §5 names the route `…/{dispensationId}/accept`. The frozen contract has `…/decision`, with `AcceptanceDecision {result: accepted|rejected}`. I implemented the contract. The ADR wording may need aligning.

**Contract change requests:** none are required. The frozen `openapi.yaml` was implemented as is.

## 7. Checks run and pinned counts

**Environment:** Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm 10.33.0, offline, PostgreSQL 16.13. Harness ports were 23110–23149: `QA_PG_PORT` 23110/23112/23114/23116 and `MTH_PORT_POOL=231xx-23149`. Logs are in `docs/delivery/handbacks/DG3/T-DG3-BE-A-evidence/`.

| Command | Result | Log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` | `PASS gate DG2 (historical)`, exit 0 (start and end) | `validate-historical-DG2.log` |
| `pnpm -r typecheck` | exit 0 | `pnpm_-r_typecheck.log` |
| `pnpm -r build` | exit 0 | `pnpm_-r_build.log` |
| `pnpm lint` | exit 0 | `pnpm_lint.log` |
| `pnpm openapi:lint` | exit 0, "OpenAPI 3.1.1, 270 operations" | `pnpm_openapi_lint.log` |
| `pnpm format:check` | **exit 2**: EACCES on the sandbox-unreadable untracked root stubs (`.bashrc`, `.vscode`, `CLAUDE.local.md`, …); every readable file passed | `pnpm_format_check.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (the assignment's fallback) | exit 0, 0 errors | `prettier-ls-files.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | exit 0; 52 files, **946/946** tests | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0; 52 files, **946/946** tests | `unit-c-utf8.log` |
| `QA_PG_PORT=23116 MTH_PORT_POOL=23117-23149 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0; 42 files, **638/638** tests; "applied 25 migrations to a fresh database" | `integration.log` |

**Earlier failing runs** (all disclosed; each was fixed before the final runs above):

1. **First full integration run:** exit 1, 3 failed out of 638 (`integration-run1-failed.log`). These were the audit-shape defect 6.1 and the P2-only audit count in `registers.test.ts`.
2. **Second run:** exit 1, 1 failed (`integration-run2-failed.log`). This was the P2-only audit list in `transformations.test.ts`.
3. **First unit run:** exit 1, 4 failed out of 946. Its log was overwritten by the passing rerun, so the failures are quoted here:
   - three `apps/api` boundary checks (`architecture.test.ts`, `workflows.test.ts` ×2). The checker forbids variable-key member access (`obj[k]`) and pins the workflows public surface. I fixed both.
   - `apps/web/src/auth/session-identity.test.tsx` "F-DG2-500 sign-out here and 403 (ar)" timed out on `findByText` at 5.6 s under full parallel load. I didn't change `apps/web`. The file passed 18/18 alone, and both full reruns passed 946/946. I treat it as a pre-existing load-sensitive test; qa-verifier may want to watch it.

**Log scan:** in `integration.log` the only match for "unhandled/timeout/failed to" is the DG2 BE17 probe's expected output (`BE17 db-econnreset: …"unhandled error"…`) from a passing test. There are no hook timeouts and no failed suites.

**New pinned counts** (in `contract.test.ts`):

- **Media-type triple:** `[87, 86, 1]` → **`[90, 89, 1]`**. The three new JSON bodies are create, decide and revoke dispensation.
- **Rate-limit floor:** `>= 161` → **`>= 167`**: 161 P1/P2 operations plus 6 BE-A operations, and the live sweep checked all 167.
- The total stays `toHaveLength(270)`. P3 pending: BE-A has 0; the others are unchanged (BE-B 20, BE-C 25, BE-D 17, BE-E 17, KBE-B 11, KBE-C 13).

**New tests:**

- `g1-agreements.test.ts`: 7 tests. Covers no agreements → 422 with the three pointers; partial or false → 422; unknown key → 400; all three → 201 with three rows and the audit diff; G2 and G1-rejected with agreements → 422 not-applicable; the 403/403/409 precedence; and the 0025 guard at COMMIT (none or two refused, three commit).
- `readiness.test.ts`: 6 tests, including the instantiation proof.
- `dispensations.test.ts`: 5 tests.
- `sequencing.test.ts`: 9 unit tests.
- `db-errors.test.ts`: 7 unit tests.
- `catalogue.test.ts`: +1.

## 8. Not done, open points and merge notes

- **The `kpi` half of `GateFactsProvider` isn't wired.** `server.ts` passes a loader that returns only `{ transformationId }`, because `kpi/p3-gate-facts.ts` (KBE-C) doesn't exist yet and KBE-C mustn't touch `server.ts`. When KBE-C lands, the integrator or BE-A needs to change one line in `server.ts` to `kpi: loadKpiP3GateFacts`, exported from `kpi/index.ts`.
- **Delegated dispensation decisions** (`onBehalfOfUserId`) are refused with a declared 422. The design keeps the waived gate's approver deciding in person, so no delegation path or approval loop exists. If delegation is wanted, it can reuse the `actsOnBehalfOf` and `isApprover` logic in `gates.ts`.
- **BE-E** must also implement G4 in `buildG4Snapshot` and `loadPortfolioGateFacts`. The DG2 assertion "G4 not submittable" in `gates.test.ts` is unchanged; BE-E edits it after this merge, as the work split says.
- **Merge:** no conflicts are expected with KBE-A. I didn't touch `packages/shared/src/index.ts`, `scoring.ts`, `formula/**` or `eslint.config.js`. Migrations run in order through 0025; BE-E's next migration is `0026`.
- **Seam convention for the other tasks:** remove the operation from your `p3-pending-<task>.ts`, exercise it in your `p3-exercises-<task>.ts` through `ctx.mirrored`, and add `operationId → mirror` to your `P3_MIRRORS_<TASK>`. Then report the new media-type triple and rate-limit floor.

## 9. e2e tests FE-A must update for G1 agreements

I didn't edit anything under `apps/web/**`.

- `apps/web/e2e/p2-journeys.spec.ts`, test **"Gates: the approver's decision — 409 when the submission was superseded, then approval with a rationale"** (line ~578). It approves G1 through the gate decision dialog (`apps/web/src/pages/gates/GateDetailPage.tsx`, the POST at line ~558). In P3 that call returns 422 `gate.g1_agreements_required` until the dialog sends `agreements: {problem: true, baseline: true, materialValuePools: true}` from three confirmation controls.
- Any other UI path that approves G1 needs the same change. The same file's `completeG1` helper only submits; it never approves.
- No `tests/qa/**` suite approves G1 (I checked with grep). All qa integration suites passed in the final run.
