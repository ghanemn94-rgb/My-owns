# Handback T-DG6-BE-Z3: sensitive benefit values embedded in the scenario list (backend-workflow-engineer)

- **Stage / gate:** P6, DG6 (FIXING after review round 2). An orchestrator-proposed finding of the F-DG6-180 class (REQ-S10-002, ADR-0051 §2). The round-3 reviewers judge it.
- **Invocation:** `DG6-T-DG6-BE-Z3-backend-workflow-engineer-20261104T025359Z-bbf94197` (session `bbf94197-5fb5-46f3-b66f-fee01f046c15`).
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z3.md`, sha256 `249e69d25d8013bc22c95e12cc179825c8268be83fa375adaec0a208529c2a8b` (verified).
- **Starting revision:** branch `dg6/be-z3` at `d65d9c674` (clean tree).
- **Time:** started `2026-11-04T02:54:10Z`, ended `2026-11-04T03:20:44Z`.
- **Changes:** left **uncommitted**, as instructed.
- **Approvals:** none. No business, Finance or IT approval (G1–G6) was granted or simulated, and nothing touches DG0–DG7. All test data is synthetic.

## Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, exit 0. Run at the start and again at the end.

## Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/benefits/scenarios.ts` | `presentScenarios(db, principal, rows)` omits every embedded `benefit_scenario_value` whose benefit the caller may not read (ADR-0051 §2). All four routes that return a scenario use it: list, item, create and PATCH. `POST …/benefit-scenarios/{id}/values` naming such a benefit answers like a benefit that does not exist. |
| `apps/api/test/integration/access/sensitive-reach-scenarios.test.ts` | **New** product integration test with 7 tests. It covers the negative case (TL and AUD), the positive case (TO, owner, TL after a grant), and the write oracle. It fails before the fix and passes after. |
| `docs/api/openapi.yaml` | Adds a description to `BenefitScenario.values`, stating the omission rule. The schema shape is unchanged. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Z3-backend-workflow-engineer.md`, `…/T-DG6-BE-Z3-evidence/*.log` | This handback and the logs of every check. |

There are no migrations, no new dependencies and no new routes.

## Behaviour delivered

**REQ-S10-002.** Acceptance text: _"A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant"_.

A sensitive benefit is now also hidden when it appears as a scenario value inside a non-sensitive scenario:

1. **Embedded values are omitted.** `presentScenarios` collects the benefit ids of the scenario values. It asks `restrictedRecordRefs` (from `access/sensitive-reach.ts`, the BE-Y1/BE-Z1 helper) about them as `benefit` refs, in one policy decision. It then drops every value whose benefit is restricted.
   - The value is **omitted**: not 403, no placeholder, no count, no flag. The scenario itself stays 200. Values of other benefits are unchanged.
   - When nothing in the caller's organizations is marked sensitive, this costs one query and the response is unchanged (the DG4–DG5 behaviour).
2. **Every presenter is covered.** The list, the item, the create response and TL's own scenario PATCH all use the same presenter. Before the fix the PATCH response also leaked the row. The test proves this.
3. **Totals.** `BenefitScenario` carries **no total** or any other figure derived from its values (`packages/shared/src/schemas/benefit-scenarios.ts`, the zod mirror). So no partial total can be shown as complete, and the Unknown rule was not needed. Scenario values never enter realized, validated or sustained figures (REQ-S08-018: they are not in `benefit_value_line`), so no other total includes them.
4. **Write oracle.** This went beyond the letter of the assignment, but the same response embeds a value row. Before the fix, a TL not admitted to the benefit could `POST …/values` with a sensitive benefit's id. That returned 201 and the row (with the benefit's currency), and it confirmed the benefit existed, while a GET on the benefit returned 404.
   - Now the POST answers exactly what `assertSameTransformation` answers for an unknown benefit: 422 `validation.reference` at `/benefitId`, with the same status, code, detail and errors. It writes nothing.
   - The test compares the response with one for a random uuid and checks that no row was written.
   - `PATCH …/benefit-scenario-values/{benefitScenarioValueId}` was already 404 through the BE-Y1 route guard (`benefitScenarioValueId` is in `SENSITIVE_REACH_PARAMS`).
5. **Admitted readers are unaffected.** The TO (`sensitive_record.grant`), the owner (a named party) and TL after an explicit grant still see both value rows with their amounts. AUD, which has no grant, still does not.

**Sweep of other routes that return `benefit_scenario_value`, `benefit_plan_value`, `benefit_allocation` or `benefit_measurement` rows inside a parent.** I grepped every `selectFrom` and every SQL read of these tables in `apps/api/src`.

- **The only presenter that embeds them in a non-sensitive parent was `presentScenarios`.**
- **Already gated through their own benefit:**
  - Plan values (`benefits/values.ts`): `/benefits/{id}/values` goes through `readBenefitRow`, and `/benefit-plan-values/{benefitPlanValueId}` through the route guard.
  - Allocations (`/benefits/{id}/allocations`): `readBenefitRow`.
  - Measurements (`/benefits/{id}/measurements` through `readBenefitRow`; `/benefit-measurements/{benefitMeasurementId}` through the guard).
- **Return only ids or existence booleans, no values:**
  - `benefits/gate-facts.ts` (internal gate evaluation input), `sustainment/status-model.ts`, `workflows/phase-steps.ts` and `admin/walkthrough.ts` return counts, existence booleans or measurement ids.
  - `corrections.ts` and `transition-decisions.ts` are write-side checks.
  - `reporting/exports/jobs.ts` is the sensitivity check of the export.
- **Reports and dashboards:** I did not re-audit the aggregate views (`benefit_value_line`, `benefit_counting`). Earlier P6 tasks handle them (`dashboards/restricted.ts`, `benefits/totals.ts`). They are aggregates, not embedded rows, so this task does not cover them.

## Checks run (environment: Node 24.21.0, offline, this worktree; ports 29050–29099)

The logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Z3-evidence/`.

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` (start and end) | 0 / 0 | `PASS gate DG5 (historical)` | (stdout) |
| `QA_PG_PORT=29051 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/access/sensitive-reach-scenarios.test.ts`, with **`scenarios.ts` restored to `HEAD`** (before the fix) | **1** | 5 failed, 2 passed (7) | `new-test-before.log` |
| The same, with the fix (`QA_PG_PORT=29050`) | 0 | 7 passed (7) | `new-test-after.log` |
| `pnpm -r typecheck` | 0 | | `typecheck.log` |
| `pnpm -r build` | 0 | | `build.log` |
| `pnpm lint` | 0 | | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All matched files use Prettier code style. Re-run after the handback was written. | `prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `openapi-lint.log` |
| `pnpm test`, with `LANG`/`LC_*` unset | 0 | unit-node 190 files / 2899 tests passed; unit-web 120 / 2020 passed; unit-formula-nocodegen 3 files / 259 passed, 2 skipped (261) | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | The same counts in all three Vitest invocations | `unit-c-utf8.log` |
| `QA_PG_PORT=29060 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/benefits apps/api/test/integration/access apps/api/test/integration/kpi/business-cases.test.ts apps/api/test/integration/contract/contract.test.ts tests/qa/integration/a12-p6-scope-isolation.test.ts tests/qa/integration/a12-cross-scope.test.ts` | 0 | **29 files, 373 tests passed** (the new test included) | `integration.log` |

**The before-fix run.** Its non-zero exit is the intended red. Three tests fail on the leak itself:

- list/item: `expected [ …(2) ] to deeply equal [ Array(1) ]`;
- PATCH: the same assertion;
- POST: `expected [ 201, undefined ] to deeply equal [ 422, 'validation.reference' ]`.

The two positive tests also fail before the fix, but only as a knock-on effect. On the unfixed code, TL's POST really wrote a third value row, so the positives saw 3 rows instead of 2. With the fix they pass.

**Other notes.**

- The two skipped tests are in the pre-existing `packages/shared/src/formula/fuzz.test.ts`. I did not touch it.
- The matches for "FAIL" and "×" in the unit logs are test names (`log-scan … negative fixture FAIL`, `role × month`), not failures.
- Before the tests I removed the empty `.claude/.cc-writes` directories (and their now-empty `.claude` parents) under `apps/api`, `apps/api/src`, `apps/api/src/modules/benefits`, `apps/api/test/integration/access` and `apps/api/test/integration/benefits`, using `rmdir`.
- The full `pnpm test:integration` was not run, as the assignment allows. The orchestrator runs it on the merged tree.
- No e2e spec was added, so no e2e budget applies.

## Operations routed (pending-list delta)

None. No route was added or removed: the six scenario operations already existed and were already exercised. No `p6-pending-*.ts` or `p6-exercises-*.ts` file changed, and `contract/contract.test.ts` passes (it ran in the integration set above).

## Contract, schema and dependency needs (for the orchestrator)

- **OpenAPI:** I added a description of the omission rule to `BenefitScenario.values`. The shape is unchanged. The POST's 422 response (`BusinessRule`) was already declared.
- **Zod mirror:** unchanged.
- **Migrations and dependencies:** none.

## User-facing texts made untrue

None that I found. Omitting a row changes no en or ar string. The scenario UI renders whatever `values` holds.

## What remains

- **Open domain question for the architect (assignment item 3; carried from BE-Y1).** Does ADR-0051 §2 extend to the registers of `corrective_case` (RAID corrective cases), `transition_decision` (sustainment transition decisions) and `performance_area_link`? Today:
  - those routes still list a sensitive benefit's records, with their variance and decision data, to a reader who gets 404 on the benefit;
  - their audit events are already redacted (BE-Y1).
  
  As instructed, I **did not change** them. This needs a decision from the architect or the round-3 reviewers.
- **Ids without values.** The sweep found these routes, which disclose ids or existence but not values. Whether §2 covers them is for the reviewers:
  - `sustainment/status-model.ts` returns `validatedMeasurementIds` and benefit codes for a subject's benefits;
  - `benefits/gate-facts.ts` (gate evaluation input) lists active benefits with their validated measurement ids.
  
  I did not change them: they are outside the four value tables' "embedded values" scope, and they belong to other slices.
- **Not re-tested:** the deep links, search and export reach (unchanged by this task).

## Merge instructions

- No migration and no ordering constraint.
- **Expected conflict:** in `apps/api/src/modules/benefits/scenarios.ts`, the `presentScenarios` signature gained a `principal` argument, and `createValue` gained a `principal` parameter. Any branch that adds a caller of `presentScenarios` must pass `principalOf(request)`.
- **`docs/api/openapi.yaml`:** a local edit to the `BenefitScenario.values` property.

## End

Ended `2026-11-04T03:20:44Z` (about 27 minutes). The closing validator exited 0 (`PASS gate DG5 (historical)`), and the prettier re-check including this handback exited 0.
