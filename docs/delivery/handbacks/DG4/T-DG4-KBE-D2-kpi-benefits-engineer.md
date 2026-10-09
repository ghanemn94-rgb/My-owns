# Handback T-DG4-KBE-D2: overlaps, scenarios, valuation methods (kpi-benefits-engineer)

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING). Scope: `docs/architecture/p4-work-split.md` §B.2.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-KBE-D2-kpi-benefits-engineer-20261009T054113Z-e85548c8","session_id":"e85548c8-c540-4b3e-9c19-ccc3b6533c12"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-D2.md`, sha256 `d23e2a58bf2fdf290676e6c52386559109eaa5a49d5bba930724c0a5b5c89318` (checked).
- **Base:** branch `dg4/kbe-d2`, `HEAD` `b48147a8f2a89b7002cc1591b3052fe67de7664f`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** started `2026-10-09T05:41:28Z`, finished about `06:30Z`, so about 50 minutes, inside the 2-hour bound.
- **Two gate systems.** Finance resolution of overlaps and valuation-method decisions are human business decisions inside the product (`finance.validate`). Nothing here decides anything by itself, grants a real business, Finance or IT approval, or reads or writes DG0–DG7. All test and seed data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/benefits/overlaps.ts` (stub filled) | `listBenefitOverlaps`, `createBenefitOverlap`, `getBenefitOverlap` and `resolveBenefitOverlap`. Also holds the overlap rule `detectBenefitOverlaps` (lock class `benefitOverlap`, key `<transformationId>:<driverKey>`), which is registered into KBE-D's `onBenefitKeysChanged` at module load. It also creates and closes the `benefit_overlap_review` Finance task through `createWorkItemOnce` and `closeWorkItemsOfSubject`. |
| `apps/api/src/modules/benefits/scenarios.ts` (stub filled) | The 6 scenario operations. Every value returned is labelled with its `scenarioKind`. |
| `apps/api/src/modules/benefits/valuation-methods.ts` (new) | The 3 valuation-method operations: propose (`VM-nn` code), and the Finance decision (approve, reject or retire). |
| `apps/api/src/modules/benefits/routes.ts` | One registration line for the valuation methods, after KBE-D's lines. The overlap and scenario stubs were already registered. |
| `apps/api/src/modules/platform/db-errors.ts` | Adds the KBE-D2 block `mapP4BenefitD2Error` (ADR-0029 §11 last-line mappings for overlaps, scenarios and valuation methods), chained right after KBE-D's `mapP4BenefitRegisterError`. |
| `packages/shared/src/schemas/benefit-scenarios.ts` (new) | The zod mirrors of the 13 operations' bodies and responses. Also the pure rules: `overlapOf`, `windowIntersection`, `orderedPair`, `canonicalDimensions`, `valuationDecisionAllowed` and `periodInOrder`. |
| `packages/shared/src/schemas/index.ts` | Its export line. |
| `apps/api/src/modules/benefits/d2-rules.test.ts` (new) | 15 unit tests with worked fixtures: the overlap rule, windows, pair order, method transitions (all 12 combinations), schemas, and every last-line mapping with its exact code and text. |
| `apps/api/test/integration/benefits/overlaps.test.ts` (new) | 11 integration tests (REQ-S08-014). |
| `apps/api/test/integration/benefits/scenarios.test.ts` (new) | 7 integration tests (REQ-S08-018). |
| `apps/api/test/integration/benefits/valuation-methods.test.ts` (new) | 6 integration tests (REQ-S08-010). |
| `apps/api/test/support/p4-pending-kbe-d2.ts` | Emptied: all 13 operations are routed. |
| `apps/api/test/integration/contract/p4-exercises-kbe-d2.ts` (new) | Contract exercises of the 13 operations through `ctx.mirrored`, with `P4_MIRRORS_KBE_D2`. |
| `apps/api/test/integration/contract/contract.test.ts` | Outside my listed ownership, but needed (see §5): the import, the mirror spread, one `it(...)` call, and the media-type pin `[184, 183, 1]` → `[192, 191, 1]` (+8 JSON bodies). |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-D2-*` | This handback and its logs. |

## 2. Behaviour delivered, per requirement row

### REQ-S08-010: acceptance "A10: entering a SAR value on a CX benefit without an approved method is rejected"

- **Proposing.** `createBenefitValuationMethod` (`benefit.edit`: TL, BO) proposes a method `VM-nn`. Its content is fixed once proposed (the DB trigger).
- **Deciding.** `decideBenefitValuationMethod` (`finance.validate`: FIN only):
  - `proposed → approved | rejected`; a rejection needs a note (422 `benefit_valuation_method.note_required`);
  - `approved → retired`;
  - the proposer can never approve or reject (403 `benefit_valuation_method.decider_is_proposer`), proven with a user who holds both BO and FIN;
  - any other move gives 422 `benefit_valuation_method.not_proposed`, or `…not_approved` for retiring a method that is not approved.
- **The SAR value is rejected** on a CX benefit in each of these cases, and is accepted once Finance approves:
  - with no method (`benefit.valuation_method_required`; KBE-D's check, exercised here);
  - with a proposed, rejected or retired method, or one in another currency (`benefit.valuation_method_not_approved`);
  - on a scenario value (`benefit_value.unmonetised`).
- **Retired methods.** A retired method stays valid for a benefit that already references it. New references are refused.
- Proven in `valuation-methods.test.ts` (3 + 3 tests) and in `scenarios.test.ts` ("CX without an approved method").

### REQ-S08-014: acceptance "A10: two benefits using the same driver and period raise a warning and remain excluded from validated totals until Finance resolves"

- **When the rule runs.** It runs inside the `createBenefit` and `updateBenefit` transaction, through KBE-D's hook, whenever the driver key, population key or realization window changes.
- **What it matches.**
  - Another active benefit with the same `driver_key` and an intersecting window raises one open warning, with dimensions `{driver, period}`.
  - `population` is added when both benefits have the same population key.
  - A missing window bound is open-ended.
  - At most one open warning exists per pair. After a resolution, a later key change raises a new one.
- **What a warning writes.** One audit event (`benefit_overlap.detect`) and one `benefit_overlap_review` task per Finance recipient. This is "Overlap detected → Finance task".
- **While open.** Both benefits are `overlapOpen` in `benefit_counting`, which is the view KBE-E's totals use to exclude them from validated and sustained totals. The test shows `overlapOpen` on both in the API and in the view.
- **Resolving.**
  - `no_economic_overlap`: both count again, and the task is done.
  - `duplicate`: the named benefit gets `counted=false` and `exclusionReason="overlap_duplicate"` for good.
  - Only FIN can resolve. BO, TL, AUD and ADM-only callers get 403.
  - A Finance user who owns either benefit gets 403 `benefit_overlap.resolver_is_owner`, and gets no task.
  - Exact 422s: `excluded_required`, `note_required`, `not_open`.
- **User-raised warnings.** `createBenefitOverlap` (`benefit.edit`) gives 409 `already_open` and 422 `same_benefit`.
- **The validated-total figure itself is KBE-E's.** Its `pendingOverlap` line is the KBE-E half of this row (p4-work-split B.7). What I prove is the exclusion input (`overlap_open`) and the Finance resolution.

### REQ-S08-018: acceptance "A10: upside scenario values never appear in the realized or validated totals"

- **Scenarios.** At most one active scenario per kind (409 `benefit_scenario.kind_exists`). Archiving frees the kind, and an archived scenario is read-only.
- **The test.**
  - An upside value of 7 777 777 SAR is stored only in `benefit_scenario_value`.
  - No row of `benefit_value_line` carries it: the benefit has no validated, sustained, submitted or measured line.
  - T14 Realized stays `validated 0.0000 / sustained 0.0000 / pending 0.0000`, with counts of 0.
  - Value (SAR) stays the planned value.
- **Labels.** Every scenario value returned (create, update, get, list) carries `scenarioKind`.
- **Value rules.**
  - The currency is copied from the benefit, never converted.
  - A parent benefit gives 422 `benefit_value.parent_rollup`; an archived benefit gives 422 `benefit.archived`.
  - A taken period gives 409 `benefit_value.period_taken`.
  - A scenario value fixes the benefit's type, class and currency (proven: 422 `benefit.measure_locked`).

### Shared rules (S-1…S-14) as applied

- **S-1:** every free text goes through `freeText`.
- **S-3:** each route's `consumes` is `application/json`; the contract drift check passes.
- **S-4:** every mutation re-checks authorization at commit time (`openBenefitWrite` atCommit), and there are tests for the overlap resolution, the method decision and the scenario value create. Every mutation also has zod validation, `If-Match` (428/409) on every update or decision, creates at version 1, and one audit event in the same transaction.
- **S-5:** amounts are decimal strings; a JSON number gives 400.
- **S-9:** the formula engine is untouched.
- **S-10:** the pending list is empty and all 13 operations are exercised.
- **S-11:** the exact ADR-0029 §11 codes and texts, plus the additions listed in §5.
- **S-13:** tasks are created only through `createWorkItemOnce`.

## 3. Checks actually run (logs in `docs/delivery/handbacks/DG4/T-DG4-KBE-D2-evidence/`)

Environment: Node 24.21.0, offline. Harness ports 23350–23399. Disposable PostgreSQL 16.13 (UTF8, C locale) from `tests/qa/support/with-pg.sh`. Empty `.claude/.cc-writes` directories in source folders were removed before each test run.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (at start, and again at end) | 0 / 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical.log`) |
| 2 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | `build.log` |
| 4 | `pnpm lint` | 0 | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`) |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 485 operations` (contract unchanged) |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | unit-node/web 103 files, **2064 passed**; nocodegen **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: **2064**; **259 + 2 skipped** (`unit-c-utf8.log`) |
| 9 | `QA_PG_PORT=23350 MTH_PORT_POOL=23351-23399 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **78 files, 992/992** (`integration.log`) |

**Counts against D-097** (unit 2049 + 259/2, integration 967):

- **Unit:** +15 (`d2-rules.test.ts`).
- **Integration:** +25: overlaps 11, scenarios 7, valuation methods 6, and 1 contract `it` for KBE-D2.
- **Pinned-count change:** the `contract.test.ts` media-type pin moves from `[184, 183, 1]` to `[192, 191, 1]`. The +8 JSON bodies are `createBenefitOverlap`, `resolveBenefitOverlap`, `createBenefitScenario`, `updateBenefitScenario`, `createBenefitScenarioValue`, `updateBenefitScenarioValue`, `createBenefitValuationMethod` and `decideBenefitValuationMethod`. The operation count stays at 485.

**Non-zero exits during development, all fixed before the final runs above:**

- **First single-file run of `overlaps.test.ts`:** 1 failure, because my test used `limit=200`, above the API maximum. Changed to 100.
- **First `pnpm -r typecheck`:** exit 2, from test typing errors. Fixed.
- **First full `pnpm test`:** exit 1, 1 failure in `advisory-locks.test.ts` ("no module source outside the registry spells a class number"). My comment in `overlaps.ts` quoted the lock-class number. The number was removed from the comment.

**Re-runs on the final tree.**

- One comment-only edit to `overlaps.ts` came after the first static runs. Typecheck, lint and prettier were re-run after it and after writing this handback; see §6.
- No flaky test was observed.

## 4. Operations routed (delta to `p4-pending-kbe-d2.ts`)

All 13 were removed: `listBenefitOverlaps`, `createBenefitOverlap`, `getBenefitOverlap`, `resolveBenefitOverlap`, `listBenefitScenarios`, `createBenefitScenario`, `getBenefitScenario`, `updateBenefitScenario`, `createBenefitScenarioValue`, `updateBenefitScenarioValue`, `listBenefitValuationMethods`, `createBenefitValuationMethod` and `decideBenefitValuationMethod`. The list is now `[]`. Each operation is exercised with a success status and its zod mirror in `p4-exercises-kbe-d2.ts`.

## 5. Contract and schema needs, interpretations and notes for the orchestrator

1. **`contract.test.ts` edit (outside my listed ownership).**
   - **Why.** No `p4-exercises-kbe-d2.ts` stub or call existed, because KBE-D2 was scheduled after BE-A created the seams. The contract test fails for any routed operation that is not exercised.
   - **What I added.** The import, the `...P4_MIRRORS_KBE_D2` spread, one `it("P4 KBE-D2 operations …")`, and the media-type pin (+8, with a comment). This follows the KBE-D/KBE-B precedent (D-097).
   - **Merge.** It is a small union-type conflict if another task also edits the pin. Reconcile the pin by adding the counts.
2. **Schema typing defect (no migration needed).** `packages/db/src/schema.ts` types `benefit_overlap.dimensions` as `string`, but the column is `text[]`, and node-postgres returns `string[]`.
   - **Workaround.** `overlaps.ts` inserts with `sql\`${dims}::text[]\`` and reads through `dimensionsOf`, which accepts both shapes.
   - **Proposed fix.** The architect or orchestrator types the column `string[]` in the frozen `schema.ts`.
3. **Additional refusal codes** (not in ADR-0029 §11). FE-A/FE-C need i18n keys for them:
   - `benefit_valuation_method.not_approved`: "Only an approved valuation method can be retired." The ADR's `not_proposed` text names only approve and reject.
   - `benefit_value.period_range`: "The period end cannot be before the period start."
   - `benefit_value.value_required`: "A scenario value needs an amount or a KPI value."

   Without them, the `0037` CHECKs would answer with the generic `validation.constraint`. This is the D-094 (4) precedent.
4. **`{valueKind}` in `benefit_value.period_taken`.** For scenario values I fill it with `scenario`, which gives "This benefit already has a scenario value for the period starting 2026-01-01." Filling it with the kind would give "a upside scenario value", which does not read correctly.
5. **Finance-task recipients (interpretation of "one `benefit_overlap_review` work item for the transformation's FIN party").**
   - The task goes to the mapped `FIN` governance party when it is mapped: the person, or the mapped group's members.
   - When the party is not mapped, it goes to the active users holding `finance.validate` in the transformation's scope.
   - In both cases it skips users who own either benefit, because they could not resolve it.
   - There is one item per recipient, with dedupe key `benefit.overlap:<overlapId>:<recipientId>`. That is the ADR's key plus the ADR-0025 §3 `[:<recipient>]` suffix, because `work_item` has a single assignee and the dedupe key is unique per organization.
   - If there is no recipient, the warning is still listed and still excludes both benefits.
   - Approval routing (ADR-0026) has no fallback; this is a task notification, not an approval.
   - Both paths are tested.
6. **`resolveBenefitOverlap` with a missing `note`** gives 422 `benefit_overlap.note_required`, not 400.
   - The OpenAPI body lists `note` as required. The zod mirror accepts its absence, so the ADR's exact 422 can be reached.
   - A present note still needs 3–4000 visible characters (400 otherwise).
   - `no_economic_overlap` together with an `excludedBenefitId` is refused with 422 `benefit_overlap.excluded_required`.
7. **Retire.** It keeps the approval stamps (the trigger requires that). A retire note is recorded as the audit `reason`, not as `decision_note`, so the approval note is not overwritten. The proposer rule applies only to approve and reject.
8. **Overlap rule scope.** The rule is literal to ADR-0029 §7. It does not skip parent/child pairs or members of the same shared-benefit group: a pair with the same driver and window raises a warning in every case. If the orchestrator wants such pairs exempted, that is a design change.
9. **Lock.** The rule takes the transaction-scoped advisory lock `ADVISORY_LOCK_CLASSES.benefitOverlap` with `hashtext('<t>:<driverKey>')`, the same pattern as KBE-D's `benefitAllocationSet`. A user-raised warning takes it only when both benefits share a driver key. One open warning per pair is also guaranteed by `benefit_overlap_one_open_key`.

## 6. Final re-run of static checks

After the last source edit, and after writing this file, I re-ran typecheck, lint and prettier. Their exits are appended in `evidence/final-static.log`.

## 7. What remains

- Nothing in §B.2 is left open.
- REQ-S08-014's validated-total line (`pendingOverlap`) and REQ-S08-018's totals-service test belong to KBE-E (p4-work-split B.7), as do the measurement-side `benefit_measurement_*` last-line mappings.
- The FE-C screens and the i18n keys for the codes in §5.3 belong to FE-A and FE-C.

## 8. Merge instructions

- There are no migrations. Merge after KBE-D (already merged) and before KBE-E.
- Expected conflicts:
  - `contract.test.ts`: the pin and the call lines (union them);
  - `platform/db-errors.ts`: KBE-E appends its block after mine;
  - `benefits/routes.ts`: KBE-E's lines go after the KBE-D2 line.
- `overlaps.ts` registers its hook at module load. `routes.ts` imports it, so no other wiring is needed.
