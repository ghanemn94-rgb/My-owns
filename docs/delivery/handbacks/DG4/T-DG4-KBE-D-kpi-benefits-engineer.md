# Handback T-DG4-KBE-D (kpi-benefits-engineer): slice B register, lifecycle, enablers, allocations, groups

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING). Task T-DG4-KBE-D, `docs/architecture/p4-work-split.md` §B.1.
- **Invocation:** `DG4-T-DG4-KBE-D-kpi-benefits-engineer-20261009T042823Z-fd982663` (session `fd982663-9f84-4695-a36a-c38e0c40ceec`).
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-D.md`, SHA-256 `535723f4…dd67806` (verified before starting).
- **Base:** worktree `/home/user/wt/dg4-kbe-d`, branch `dg4/kbe-d`, `HEAD` `ab51be8d114861ee0c22e44118a7e384e80eaa18`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** started 2026-10-09 04:28:38 UTC, checks finished 05:12:40 UTC (about 44 minutes). All of §B.1 is done; there is no second half to hand over.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` gave `PASS gate DG3 (historical)`, exit 0. I ran it before implementing and again at the end (`T-DG4-KBE-D-evidence/validate-historical-DG3.log`).
- **Gates:** no G1–G6 business approval and no Finance or IT approval is granted anywhere. The fixtures write synthetic stand-ins for a Finance baseline decision and a deliverable acceptance, directly in test data. Nothing reads or writes DG0–DG7.

## 1. Changed files

### Inside the §B.1 ownership

| File | Purpose |
|---|---|
| `apps/api/src/modules/benefits/register.ts` | **5 operations:** `listBenefits` (the T14 read model, ADR-0029 §4), `createBenefit` (`B`-code from `record_code_counter`), `getBenefit`, `updateBenefit` (including the validated-baseline reset), `archiveBenefit`.<br>**Exports:**<br>- the ADR-0029 §1/§6/§11 rule check `checkBenefitRules`;<br>- the gates helpers: `openBenefitWrite`, `requirePermissionSomewhere`, `lockBenefit`, `checkBenefitVersion`, `readBenefitRow`;<br>- the presenters: `presentBenefits`, `presentRegisterRows`, `valueSarOf`, `realizationFor`, `enablerFacts`;<br>- the hook list **`onBenefitKeysChanged`**, with the types `BenefitKeysChangedHook` and `BenefitKeysChange`, and `overlapKeysChanged`. |
| `apps/api/src/modules/benefits/lifecycle.ts` | 5 operations: `getBenefitLifecycle`, `advanceBenefitLifecycle`, `listBenefitEnablers`, `createBenefitEnabler`, `removeBenefitEnabler`. Also the `delivered` flag and `presentEnablers`. |
| `apps/api/src/modules/benefits/allocations.ts` | 2 operations: `getBenefitAllocations`, and `replaceBenefitAllocations` under lock class `benefitAllocationSet`, with the set-number step. Also exports `allocationsOf`. |
| `apps/api/src/modules/benefits/groups.ts` | 4 operations: `listBenefitGroups`, `createBenefitGroup` (`BG-nn`), `getBenefitGroup`, `updateBenefitGroup`. |
| `apps/api/src/modules/benefits/counting.ts` (new) | The typed reader of the `benefit_counting` view (`countingFor`, `countingOfTransformation`, `NOT_COUNTED`), shared with KBE-E. |
| `apps/api/src/modules/platform/db-errors.ts` | The slice B register block `mapP4BenefitRegisterError` (the ADR-0029 §11 last-line mappings for the register, lifecycle, enablers, allocations and groups), plus one call line in `mapDatabaseGuardError` right after `mapP4GuardError`. |
| `packages/shared/src/schemas/benefits.ts` (new) | **Zod mirrors:** the KBE-D request bodies, including the strict single-owner `benefitCreate`, and the response bodies.<br>**Pure rules:** `typeFitsClass`, `isAllowedLifecycleMove`, `missingFor`, `missingPlanOutputs`, `planOutputsText`, `realizationStateOf`, `allocationTotals` (decimal), `shareInRange`, `percentText`. |
| `packages/shared/src/schemas/index.ts` | One `export * from "./benefits.ts"` line. |
| `apps/api/test/support/p4-pending-kbe-d.ts` | Now empty: all 16 operations are routed (§3). |
| `apps/api/test/integration/contract/p4-exercises-kbe-d.ts` | Exercises all 16 operations through `ctx.mirrored`, with the zod mirror map `P4_MIRRORS_KBE_D`. |
| `apps/api/test/integration/benefits/register.test.ts` (new) | 17 tests. |
| `apps/api/test/integration/benefits/lifecycle.test.ts` (new) | 10 tests. |
| `apps/api/test/integration/benefits/allocations.test.ts` (new) | 6 tests. |
| `apps/api/test/integration/benefits/groups.test.ts` (new) | 4 tests. |

Every test file includes AUD → 403 and ADM-only → 403 cases.

`benefits/routes.ts` and `benefits/index.ts` are **unchanged**: T-DG4-BE-A's stubs already register `register.ts`, `lifecycle.ts`, `allocations.ts` and `groups.ts` first, so no registration line was needed.

### Outside the listed ownership (disclosed, for the orchestrator to accept or move)

| File | Why |
|---|---|
| `apps/api/test/integration/contract/contract.test.ts` | The pinned count of operations that take a request body went from `[155, 154, 1]` to `[164, 163, 1]`, which adds my 9 JSON-body operations. I added a comment line naming them. This follows the T-DG4-BE-A precedent, where each routing task bumps this pin. **Expect a merge conflict on this line with T-DG4-KBE-B**, which also adds JSON-body routes. The reconciled value is 155 + 9 (KBE-D) + KBE-B's count. |
| `apps/api/test/integration/benefits/fixtures.ts` (new) | Shared slice B test fixtures: `seedBenefitWorld`, `insertInitiative`, `insertDeliverable`, `acceptDeliverable`, `insertSubmittedMeasurement`, `markBaselineValidated`, `benefitAt`, `extraUser`, and the bodies. KBE-D2 and KBE-E can reuse it. No other task's list names it. |
| `apps/api/src/modules/benefits/register-rules.test.ts` (new) | 45 unit tests of the pure rules, schemas and DB mappings. It is a separate file, so the shared module suite `benefits.test.ts` stays untouched for KBE-D2 and KBE-E. |

Two untracked files at the repository top level, `CLAUDE.local.md` and `.zshrc`, were not created by me. They appeared in the environment, as the other dotfiles did. I did not touch them, and they are not part of this change.

## 2. Behaviour delivered, per requirement row

The acceptance texts are quoted from `docs/delivery/requirements.csv`. "Test" names the file and test that proves each point.

### REQ-PB-058 (with KBE-E for the total)

> System rejects a benefit without a single owner, baseline, formula and a financial statement line or agreed non-financial KPI; initiatives link to canonical benefits via allocations, parent/child relationships and shared-benefit groups; portfolio totals sum canonical benefits, not links, so a shared benefit rolls up once. A10: a benefit with two owners is rejected; a 10 million SAR benefit shared by two initiatives appears once (10 million SAR) in the portfolio total.

- **Single owner.** `ownerUserId` is one uuid in a strict body. An array, a second owner property, or a missing owner each gives 400 `urn:mth:problem:validation` (register.test "a benefit with two owners is rejected"; unit "one owner").
- **Statement line or KPI.** A missing statement line gives 422 `benefit.mapping_required`, and a missing agreed KPI gives 422 `benefit.kpi_required`, with the exact ADR texts.
- **Baseline, formula and target are enforced at the Plan step,** per ADR-0029 §1 "REQ-PB-058 enforcement points". They are required to enter Enable and Measure (422 `benefit.plan_outputs_missing`, lifecycle.test). They cannot be cleared afterwards (register.test "Plan outputs cannot be cleared after Plan").
- **Links and counting.**
  - Allocations attribute without copying.
  - Parent/child is one level deep. A parent is a roll-up container that is never counted (`parent_rollup`).
  - A group counts no member until one is named, then exactly that member.
  - Tests: register.test "one level deep …", groups.test "no member is counted until one is named …".
- **"Appears once".** A 10 000 000 SAR benefit allocated 50/50 to two initiatives is **one** register row, with `valueSar = 10000000.0000` and `counted = true`, and one row in `benefit_counting` (register.test "a 10 M SAR benefit allocated to two initiatives is ONE register row, counted once").
- **Remaining for KBE-E:** the portfolio total number itself (10000000.0000) comes from KBE-E's `totals.ts`, which reads `benefit_counting` through `counting.ts`.

### REQ-PB-074

> Each benefit progresses through the steps with the source output required per step. A04;A10;A11: a benefit cannot enter Measure without the Plan outputs; Sustain requires a BAU owner and control cadence.

- **Moves.** identify → plan → enable → measure, measure ↔ correct, measure → sustain, one step at a time. Any other move is 422 `benefit.lifecycle_step` (unit: all 36 pairs; lifecycle.test).
- **Preconditions per step:**
  - Enable and every later step need the Plan outputs (baseline, formula (not for `non_financial`), target, owner). Otherwise 422 `benefit.plan_outputs_missing`, and `{missing}` is listed.
  - Measure needs at least one active enabler. Otherwise 422 `benefit.enablers_missing`.
  - Correct needs a recovery plan. Otherwise 422 `benefit.recovery_plan_required`.
  - **Sustain needs a BAU owner and a control cadence.** Otherwise 422 `benefit.sustain_outputs_missing`; the test also covers the case with only one of the two set.
  - Clearing a Sustain output while at Sustain is refused.
- **`getBenefitLifecycle`** returns:
  - the six B0121 steps verbatim in English (the test checks the Plan row: "How will it be measured, when, and by whom?" / "Baseline, formula, target, owner"), and the provisional Arabic with `arIsProvisional = true`;
  - `preconditionsMet` and `missing` for each step;
  - the history. For identify → plan → enable → measure there are four rows, written by the database trigger, plus one `benefit.lifecycle_advanced` audit event per move.
- **Permissions.** Only `benefit.advance` (BO) can advance. TL, AUD and ADM-only get 403.

### REQ-PB-075 (with KBE-E for Realized)

> Users record benefits with Type (Revenue | Cost | CX | ...), Value (SAR) and Realized amounts, evidence source and Status R/A/G; IDs B01, B02... A10: T14 persists all 10 columns; realized value awaiting Finance validation is labelled pending and excluded from validated totals.

- **The ten columns.** Every `listBenefits` row carries all ten T14 columns: `code` (B01, B02…), `title`, `benefitType`, `baseline`, `target`, `valueSar`, `realized`, `ownerUserId`, `evidenceCount` + `latestEvidenceIds`, and `status`. A null R/A/G is shown as `unknown`, never green.
- **Pending stays out of validated.** With a submitted (pending) measurement of 250000:
  - `realized.pending = known 250000.0000`, with `pendingCount = 1`;
  - `realized.validated = known 0.0000`, with `validatedCount = 0`;
  - `realizationState = measured_pending_validation`.
  - Test: register.test "a pending (submitted) value is labelled pending and is never part of the validated amount".
- **How Realized is computed.** It is the sum of `benefit_value_line`, one state at a time, with decimal arithmetic. States are never added together, and forecasts and scenarios are never read.
- **Limitation of the test.** Measurements cannot yet be created through the API (that is KBE-E), so the test writes the submitted measurement directly, with its audit event.

### REQ-PB-076 (register half)

> For non-financial types (e.g. CX) Value (SAR) is n/a and Realized holds the KPI actual; no automatic monetization. A10: a CX benefit saved with Value n/a is excluded from SAR totals and not counted as zero.

- **Value n/a, never 0.** A CX benefit without a valuation method has `valueSar = {status: "not_applicable", amount: null}` and `realized.validated` not applicable, never `"0"`.
- **No automatic monetization.** A SAR `plannedValue` on a CX benefit without an approved method is 422 `benefit.valuation_method_required`.
- **`realized.kpiActual`** is the latest accepted value of the agreed KPI at transformation scope. With no such value it is `unknown` (`benefit.kpi_actual_missing`), never 0.
- Tests: register.test "every row carries the ten T14 columns; Value n/a and Unknown are never 0 …" and "the other §11 create refusals …"; unit "Value (SAR) of T14".
- **Remaining for KBE-E:** "excluded from SAR totals" is the totals half; `nonFinancialCount` is in `totals.ts`.

### REQ-S08-002

> Completing a capability or deliverable updates the Enable step only; realized value requires measurement and validation. A11: completing the enabling deliverable leaves realized value unchanged at zero validated and marks the benefit 'enabled - not yet measured'.

- **Delivered** means the deliverable is accepted, or, for an enabler without a deliverable, the initiative is completed.
- After the enabling deliverable is accepted:
  - the enabler shows `delivered = true`;
  - the benefit shows `realizationState = enabled_not_yet_measured`;
  - `realized.validated` is `known 0.0000` with `validatedCount = 0`;
  - the benefit's own version is unchanged at 1. A delivered enabler changes no value and no benefit field.
- Tests: lifecycle.test "completing the enabling deliverable leaves validated value at zero and marks 'enabled - not yet measured'"; unit "realization state".
- **Database rule:** measurements are refused before Measure, by trigger `benefit_measurement_step` (probe M01, not re-tested here).

### REQ-S08-003

> Benefit profile form with server-side validation of required fields. A10: a financial benefit without a financial-statement mapping, or a non-financial one without an agreed KPI, is rejected.

- **Both refusals are 422 with the exact ADR texts.** A financial benefit without a mapping gives `benefit.mapping_required`. A non-financial benefit without an agreed KPI gives `benefit.kpi_required`.
- **Every M0167 profile field persists and is returned by `getBenefit`:** the finance validator, counterfactual, driver key/units, population key, timing, one-off/recurring, currency, measurement source, confidence, assumptions, the statement line or KPI, and the contribution links (allocations, parent, group, enablers, business-case line). Test: register.test "creates at Identify …".
- **Other server-side rules:**
  - validator = owner gives 422 `benefit.validator_is_owner`;
  - a KPI variable without a KPI or formula gives 422 `benefit.kpi_variable_unbound`;
  - a business-case line that is not a benefit line of the transformation gives 422 `benefit.case_line_invalid`; a line already in use gives 409 `benefit.case_line_taken`;
  - a named person must be an active user of the organization (422 `validation.user_invalid`);
  - references must be in the same transformation (422 `validation.reference`).

### REQ-S08-009 (classes; KBE-E owns the separate total lines)

> Separate classes with separate totals; no automatic conversion between them. A10: the Finance dashboard shows revenue uplift and margin benefit on separate lines; cost avoidance is not counted in cash savings.

- **Type ↔ class follows the ADR-0029 §1 table.** The unit test covers all 42 type × class combinations. revenue → `revenue_uplift` or `margin_uplift`; cost → `cash_saving` or `avoided_cost`.
- **Mismatches are refused** with 422 `benefit.type_class_mismatch` and the exact text. For example, cost + revenue_uplift reads: "The value class revenue_uplift does not fit the benefit type cost. …".
- **The class is fixed once the benefit has values** (422 `benefit.measure_locked`), so nothing converts one class into another.
- **Remaining for KBE-E:** the separate total lines are in `totals.ts`.

### REQ-S08-013

> The server sums allocations per benefit; above 100% is rejected; below 100% shows the remaining share as unallocated. A10: allocations 60% + 50% are rejected; 60% + 30% saves and shows 10% unallocated.

- **60 % + 50 %** gives 422 `benefit_allocation.over_100`: "The allocations total 110 %, above 100 %. Reduce them so they total 100 % or less."
- **60 % + 30 %** saves: `allocatedShare "0.900000"`, `unallocatedShare "0.100000"`. The ETag is the benefit's new version, and the GET returns the same values.
- **Decimal only.**
  - 0.1 + 0.2 = `0.300000`.
  - Three thirds (0.333333 + 0.333333 + 0.333334) = `1.000000`, with `0.000000` unallocated.
  - 0.5 + 0.500001 is refused as "100.0001 %".
  - An empty set clears the allocations.
- **Other refusals:**
  - a share ≤ 0 or > 1 gives 422 `benefit_allocation.share_invalid`, with the pointer `/allocations/i/share`;
  - a duplicate initiative gives 422 `benefit_allocation.duplicate_initiative`;
  - more than 6 fraction digits, or a JSON number, gives 400.
- **Replace.** Each replace steps `allocation_set_no` and the benefit version, and writes one audit event `benefit.allocations_replaced` with the old and the new set.
- **Concurrency.** Two concurrent replaces serialize under lock class `benefitAllocationSet` (730232). One returns 200 and the other 409, and only one set is stored.
- Tests: allocations.test; unit "allocations".

### S-4 on every mutation

All 9 mutations (create, update, archive, advance, create and remove enabler, replace allocations, create and update group) have these properties:

- **AUD and ADM-only → 403 whatever the body.** If the write permission is held nowhere, the answer is 403 before the read gate. The answer does not depend on the record, so it discloses nothing.
- **Authorization re-checked at commit time** (`openWrite` with `atCommit`). A grant revoked while the request waits gives 403 and nothing is written. Tested for create, advance, replace allocations and update group, using `session-lock.ts` `afterIdentity` + `revokeAll`.
- **Validation:** zod (400), then the §11 rules (422/409).
- **If-Match:** 428 when missing, 409 when stale (with `currentVersion`). Creates are version 1.
- **One audit event in the same transaction**, with the field diff.
- **No remote or client I/O inside the transaction.**

## 3. Operations routed: delta to `p4-pending-kbe-d.ts`

All 16 operations were removed from `P4_PENDING_KBE_D`, which is now `[]`. Each is exercised in `p4-exercises-kbe-d.ts` with a zod mirror:

`listBenefits`, `createBenefit`, `getBenefit`, `updateBenefit`, `archiveBenefit`, `getBenefitLifecycle`, `advanceBenefitLifecycle`, `listBenefitEnablers`, `createBenefitEnabler`, `removeBenefitEnabler`, `getBenefitAllocations`, `replaceBenefitAllocations`, `listBenefitGroups`, `createBenefitGroup`, `getBenefitGroup`, `updateBenefitGroup`.

`contract.test.ts` passes 44/44, with "covers every operation with at least one success" green. The contract is unchanged: `docs/api/openapi.yaml` was not edited.

## 4. Checks actually run (exit codes and counts)

**Environment:** Node v24.21.0, offline, in worktree `/home/user/wt/dg4-kbe-d`. Before every test run I removed the empty `.claude/.cc-writes` directories (and their then-empty `.claude` parents) inside the source folders.

**Harness ports:**
- `QA_PG_PORT=23250`, `MTH_PORT_POOL=23251-23299`;
- PostgreSQL comes from `tests/qa/support/with-pg.sh` (a disposable cluster);
- no port retry occurred. The only "timeout" lines in the integration log are the existing intentional `requestTimeout` 408 tests.

| # | Command | Exit | Result | Log (`docs/delivery/handbacks/DG4/T-DG4-KBE-D-evidence/`) |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | all packages | `build.log` |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0` | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` (re-run after this handback was written; see below) |
| 5 | `pnpm openapi:lint` | 0 | "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 436 operations" | `openapi-lint.log` |
| 6a | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | 0 | run 1 (unit-node + unit-web): **102 files, 2044 passed**; run 2 (unit-formula-nocodegen): **3 files, 259 passed, 2 skipped** | `unit-locale-unset.log` |
| 6b | `LC_ALL=C.UTF-8 pnpm test` | 0 | run 1: **102 files, 2044 passed**; run 2: **3 files, 259 passed, 2 skipped** | `unit-c-utf8.log` |
| 7 | `QA_PG_PORT=23250 MTH_PORT_POOL=23251-23299 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **65 files, 884 passed** | `integration.log` |
| 8 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` | `validate-historical-DG3.log` |

**Count deltas** against the W4 base (unit 1999 + 259/2, integration 847):
- unit +45: `register-rules.test.ts`;
- integration +37: register 17, lifecycle 10, allocations 6, groups 4;
- the contract test count is unchanged at 44; my exercises run inside the existing seam test;
- the only **pinned-count change** is the media-type pin `[155, 154, 1]` → `[164, 163, 1]` (§1).

**Non-zero exits during development, all fixed before the final runs above:**

- **First contract-test run: exit 1, 3 failures.**
  - My create defaults overwrote `finance_validation_required` with null, so every financial create was refused (422).
  - The media-type pin was still 155.
  - As a result, 15 of my operations had no success.
  - I fixed the defaults and bumped the pin. The re-run gave 44/44.
- **First `register.test.ts` run: exit 1, 4 failures.** The test used `limit=200`, but the contract maximum is 100. The tests now follow `nextCursor`; the re-run gave 17/17.
- **First full `pnpm test`: exit 1, 2 failures in both locale settings.**
  - `architecture.test.ts` flagged my imports of the private `platform/advisory-locks.ts` and `platform/db-errors.ts`, and two computed member keys in `register.ts`.
  - `advisory-locks.test.ts` flagged the lock number spelled out in an `allocations.ts` comment.
  - I fixed all of them: imports through `platform/index.ts`, `Map`-based lookups, no lock number in the source.
  - A later targeted run failed once on a re-created empty `apps/api/src/modules/.claude/.cc-writes` directory (the harness artifact named in the assignment). I removed it, and the final runs 6a and 6b are green.

No test was flaky, and no run timed out.

## 5. Contract and schema needs (for the orchestrator)

- **No migration and no schema change** was needed. `0037`–`0040` are used as they are.
- **No OpenAPI change.**
- **i18n keys for FE-A / FE-C.** These are new problem and `reason` keys, beyond the ADR-0029 §11 codes, which FE-A already plans to add:
  - `benefit.planned_value_missing`: Value (SAR) Unknown on a financial benefit;
  - `benefit.value_amount_missing`: a value line without an amount, so the state's sum is Unknown;
  - `benefit.kpi_actual_missing`: a non-financial benefit with no accepted KPI actual;
  - `validation.constraint`: an existing key, used for a financial benefit sent with `financeValidationRequired: false` (see §6).

## 6. Interpretations to confirm, and what remains

1. **AUD and ADM-only get 403 even on a transformation they cannot read.** If the write permission is held nowhere, the API answers 403 before the 404 read gate, following the DG3 `benefit-formulas` precedent (`holdsAnywhere`). This gives the 403 that ADR-0029 §9 asks for. It discloses nothing, because the answer does not depend on the record.
2. **`financeValidationRequired: false` on a financial class** is refused with 422 `validation.constraint`. ADR-0029 §11 has no code for the DB CHECK `benefit_financial_needs_validation`; the English text I used is "Finance validation is always required for a financial benefit." I invented this text, so it should be confirmed or given an ADR code.
3. **Realized is computed in `register.ts`, not in KBE-E's file.** The work split says KBE-E's `values.ts` exports `realizedFor(tx, benefitIds)` for this read model. Because values.ts does not exist yet, `register.ts` implements it now as `realizationFor`, exactly per ADR-0030 §6. KBE-E can reuse it, or move it to `values.ts` and change one import. **The interface is final**, as the assignment asks.
4. **The overlap seam for KBE-D2 is final.**
   - KBE-D2 adds `onBenefitKeysChanged.push(hook)` in `overlaps.ts`, with the signature `(tx, ctx: WriteContext, { before: BenefitRow | null, after: BenefitRow }) => Promise<void>`.
   - It runs on every create, and on an update that changes `driver_key`, `population_key`, `realization_start` or `realization_end`, after the row and its audit event are written, in the same transaction.
5. **`listBenefits` without `status` lists active benefits only.** `status=archived` lists the archived ones.
6. **`kpiActual` never reports `stale`.** It reports `known` (the latest accepted value at transformation scope) or `unknown`. A stale state needs slice A's freshness rule (KBE-C), which is not merged. This is a known gap and can be added when KBE-C lands.
7. **One valuation-method branch is untested at integration level.** "An approved valuation method lets a CX benefit carry a SAR value" is enforced by the API rule and the DB trigger. However, there is no API to approve a method until KBE-D2, so the integration tests only cover the refusals. KBE-D2's `valuation-methods.test.ts` should add the positive case.
8. **The DB last-line texts use generic fills** where the database cannot know the placeholder (`{valueClass}`, `{benefitCode}`, `{currency}`, `{missing}`), following the I+C precedent. The API pre-checks give the exact texts with the placeholders filled. `{totalPercent}` is read from the trigger message.
9. **Nothing in §B.1 remains.** KBE-D2 (§B.2) and KBE-E (§B.3) build on this.

## 7. Merge instructions

- Integrate after T-DG4-KBE-A and T-DG4-BE-A, which are already in `HEAD`. No migration to run.
- **Expected conflicts:**
  - `apps/api/test/integration/contract/contract.test.ts`, the media-type pin line, with KBE-B and any other task that routes JSON-body operations. Sum the deltas.
  - `apps/api/src/modules/platform/db-errors.ts`, if slice A's blocks (KBE-B/KBE-C) also add a call line after `mapP4GuardError`. Keep both blocks and both call lines; they map disjoint constraint names.
  - `packages/shared/src/schemas/index.ts`: append-only export lines.
- KBE-D2 and KBE-E should import the fixtures from `apps/api/test/integration/benefits/fixtures.ts`, and the gates helpers from `benefits/register.ts`.
