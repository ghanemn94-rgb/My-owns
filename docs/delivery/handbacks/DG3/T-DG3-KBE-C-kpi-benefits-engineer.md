# Handback T-DG3-KBE-C: T09 benefit formulas, versions, calculations, the seeded examples, Finance validation of benefit logic and the kpi G4 facts (kpi-benefits-engineer)

- **Stage:** P3 / DG3 (BUILDING). **Task:** T-DG3-KBE-C.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-KBE-C-kpi-benefits-engineer-20261008T000340Z-1c5d6e88","session_id":"1c5d6e88-65cb-427a-8684-fe0768768d86"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG3/T-DG3-KBE-C.md`. At the start I checked its sha256: `1a805a8b…7e3b831a`, as given.
- **Worktree:** `/home/user/wt/dg3-kbe-c`, branch `dg3/kbe-c`, `HEAD` = `6e5a0fb0dccf42851a1f82a5e7aa8624406cd7fc`. I committed nothing.
- **Time:** started `Thu Oct  8 00:03:51 UTC 2026`, ended `Thu Oct  8 00:31:11 UTC 2026` (`T-DG3-KBE-C-evidence/final.log`), about 27 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` gave `PASS gate DG2 (historical)` with exit 0, both at the start and at the end (`validate-historical-DG2.log`, `final.log`).
- **Business approvals:** this is engineering work only. Product gates G1–G6 are business approvals inside the product.
  - Every Finance validation in the tests is a demo decision by a synthetic FIN user. It approves nothing real.
  - The B0087 examples are illustrative calculations with synthetic values.
  - Nothing here reads or writes the DG0–DG7 records.

**Summary.** All eight scope items are done, and every check passes except one. `pnpm test` exits 1, with 1 failure out of 1183, both with the locale unset and with `C.UTF-8`.

- **Cause:** a P2-era assertion in `apps/api/src/server.test.ts`, which is BE-A's file, not mine. The assertion says no route URL may match `/formula/i`. Routing the T09 operations breaks it by construction.
- **What I did:** I did not edit that file. §6.1 gives the one-line change, and `server-test-requested-change.patch` holds it. Every other check exits 0.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/benefit-formula.ts` (new) | Zod mirrors of the `benefit-formulas` components. Requests: `formulaVariableInput`, `formulaCheckRequest`, `benefitFormulaCreate`/`Update`, `benefitFormulaVersionCreate`, `benefitCalculationCreate` and the list query. Responses: `formulaVariable`, `formulaCheckResult`, `benefitFormula`, `benefitFormulaPage`, `benefitFormulaVersion`, `benefitFormulaVersionList`, `benefitCalculation`, `benefitCalculationPage`, `benefitFormulaExample`, `benefitFormulaExampleList`. Also the vocabularies. The expression length is counted in code points (ADR-0024 §6 item 7). |
| `packages/shared/src/schemas/index.ts` | One export line plus a comment, as KBE-B's handback §6.1 asks. ARCH-03 adds a different line in parallel. |
| `apps/api/src/modules/kpi/benefit-formulas.ts` (new) | The examples list, and list, create (including `fromExample` and `initialVersion`), get, PATCH and archive of T09 rows. Also the shared helpers: the engine boundary `checkWithEngine` (400/422), the presenters, `lockFormula`, `insertFormulaVersion`, `setCurrentVersion`, `loadExamples` and the `BF-nn` code generator. |
| `apps/api/src/modules/kpi/formula-versions.ts` (new) | List, create and get versions, and Finance validation (`POST …/versions/{versionNo}/validation`). |
| `apps/api/src/modules/kpi/calculations.ts` (new) | `POST /benefit-formulas/validate`, which writes nothing, plus list and create of the calculation lineage. |
| `apps/api/src/modules/kpi/p3-gate-facts.ts` (new) | `loadKpiP3GateFacts`, the kpi half of `GateFactsProvider`, and the pure `buildKpiP3GateFacts` / `formulaValidationOf`. |
| `apps/api/src/modules/kpi/formulas.test.ts` (new) | 10 unit tests (§4) |
| `apps/api/src/modules/kpi/p3-gate-facts.test.ts` (new) | 9 unit tests (§4) |
| `apps/api/src/modules/kpi/routes.ts` | Registration lines only: three imports and one `routes.push(...)` |
| `apps/api/src/modules/kpi/index.ts` | Export lines only, for `p3-gate-facts.ts` |
| `apps/api/src/modules/kpi/kpi.test.ts` | The three pins, as the assignment allows: operations (35 → 48), exports and write permissions. Two routes do not name their permission in the contract summary, so I listed them as explicit exceptions (§3). |
| `apps/api/test/integration/kpi/benefit-formulas.test.ts` (new) | 16 integration tests (§4) |
| `apps/api/test/support/p3-pending-kbe-c.ts` | Now empty: all 13 operations are routed and exercised |
| `apps/api/test/integration/contract/p3-exercises-kbe-c.ts` | Exercises all 13 operations through `ctx.mirrored`, fills `P3_MIRRORS_KBE_C`, and exports the `COST_VERSION` fixture |
| `apps/api/test/integration/contract/contract.test.ts` | Only the two pinned counts, plus the comment next to the floor (§5) |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-C-*` | This handback and its evidence |

I added no migration and no dependency. I did not change `openapi.yaml`, `schema.ts`, `server.ts`, `g4.ts` or the engine under `packages/shared/src/formula/**`. The API imports the engine from `@mth/shared/calc` and never re-implements the arithmetic.

## 2. Behaviour per requirement

### REQ-PB-056 ("T09 6 columns; H/M/L; undefined variable rejected")

**The six T09 columns persist.**

- Benefit is stored in `benefit_name`.
- Baseline driver, Change assumption and Ramp each have their own column.
- Formula is the current version's `expression`.
- Confidence is `char(1)` H/M/L.
- The test creates a row and reads it back twice, through the API and directly from the tables. All six values match.

**Confidence.** Confidence outside H/M/L gives 400 at `/confidence`. The test sends `X`, `h`, `High` and an empty string, on both create and PATCH, and checks that nothing was written. A direct SQL update to `X` is refused by the DB CHECK, which the test also shows. `null` clears the value.

**`BF-nn` codes** come from `record_code_counter` with prefix `BF` (BF-01, BF-02, …). The test checks that a refused create does not consume a code.

**Undefined variable.** It gives 422 `formula.undefined_variable` with detail 'Undefined variable: {name}' and type `urn:mth:problem:validation`.

- **Where:** on create (`initialVersion`), on a new version, on `/validate`, and for an unknown key in a calculation's `inputs`.
- **Order:** the engine parses and type-checks *before* any write, so an invalid expression writes nothing.
- **Test:** the formula, version, variable and calculation row counts, and the code counter, are unchanged after each refusal.

**The 400/422 boundary** (ADR-0024 §6, "Status boundary for KBE-C").

- **400:** anything the contract schema refuses. Examples: a variable name `A`, an unknown kind, a JSON-number value, 31 variables, more than 2000 code points, extra properties.
- **422:** anything the schema admits but the engine refuses. The problem carries the engine's first error, with its `code` as `code` and its `message` as `detail`. Examples: `formula.syntax` for `a ** 2`, `formula.invalid_variable` for a reserved name, a duplicate name or a currency on a count, `formula.period_mismatch` and `formula.kind_mismatch`.
- **Pointers:** `/expression` for all of these except `formula.invalid_variable`, which points at `/variables`. On create, both are prefixed `/initialVersion`.
- **Edge case:** 2000 astral code points pass the schema, which counts code points, and are refused by the engine with 422.

**`is_illustrative`** is true only for a row instantiated from an example. It becomes false on the first PATCH or the first new version. `example_code` keeps the provenance.

### REQ-PB-057 ("two examples seeded; 100000 SAR exact; cost exact") and REQ-S08-007 ("fraction; monthly × annual rejected; 0.02 × 100000 × 50 = 100000")

**Reading the examples.** `GET /benefit-formula-examples` returns both B0087 rows. The test asserts every `source*En` field verbatim, for example 'Δ attach × customers × ARPU', 'Unit cost -X%' and 'Q2-Q3'.

- `isIllustrative` is `true` (contract `const: true`).
- Every example variable's `source` reads "B0087 example (illustrative calculation, synthetic values)". The contract has no separate marker field, so the web renders the label *Illustrative calculation, synthetic values* from `isIllustrative`. `ILLUSTRATIVE_MARKER_EN` exports the English text.
- Fractions come back as fractions: `0.1` and `0.12`.

**Instantiating `revenue_uplift`.**

- The row gets the example's T09 text unless the request overrides it, and version 1 holds the example expression and variables.
- `previewResult` is `"100000"`.
- A calculation gives `result` **`"100000"`**, SAR, per year. The stored column value is `100000.000000`, and `rounded` is false.

**Instantiating `cost_reduction`** gives **`"500000"`** both as the preview and in the calculation.

**Period mismatch.** Changing `arpu` to `period = month` while `eligible_customers` stays `year` gives **422 `formula.period_mismatch`**. The detail is the ADR text exactly: 'Period mismatch: arpu is per month but eligible_customers is per year; convert with to_period(arpu, year)'.

- The test sends it both as a new version and through `/validate`.
- With `to_period(arpu, year)` the version is accepted, with preview `"1200000"` (0.02 × 100000 × 600).

### REQ-PB-055 ("Finance validation before G4; 'Finance validation'"): the benefit-logic part

**The route.** `POST …/versions/{versionNo}/validation` takes `{result: validated|rejected, note}`. It needs `finance.validate` and `If-Match` (the version row's `version`).

- On success it sets `validation_status`, `validated_by`, `validated_at` and `validation_note`.
- It writes the audit event `benefit_formula_version.validate` or `benefit_formula_version.reject`.

**The author gets 403 `finance.validator_is_author`,** audited as `authorization.denied`. The test's author is a FIN+TL user who created the version. The DB CHECK `benefit_formula_version_validator_not_author` refuses the same thing, which the test shows with a direct SQL update.

**Other refusals.**

- A TL without `finance.validate` gets 403.
- Missing `If-Match` gives 428; a stale one gives 409.
- A bad `result` gives 400.

**A validation is final.** A second decision gives 422 `benefit_formula_version.validation_final`. The DB trigger also says so.

**New versions.** A new version starts `unvalidated` and becomes current. The version list then shows `[2 rejected, 1 validated]`.

### The kpi G4 facts (ADR-0021 §7 `g4.business_cases`, `g4.finance_validation`)

`loadKpiP3GateFacts(db, transformationId)` is exported from `kpi/index.ts` with the signature `GateFactsProvider.kpi` expects. It returns:

- **`transformationCase`:** the active transformation-level case, or `null`.
- **`initiativeCases`:** every active initiative case, with `initiativeId`. Each case carries `missingSections` (the ten sections, or the lighter set, using KBE-B's `missingSections`), `baselineValidation` (`validated` | `unvalidated` | `rejected` | **`stale`**, using KBE-B's `baselineValidationState`) and a `pointer`.
- **`benefitLines`:** every active financial benefit line of those cases, meaning kind `benefit` with a class other than `strategic_non_financial`. Each carries:
  - its formula id and code;
  - its current version number and id;
  - `formulaValidation` ∈ `validated` | `unvalidated` | `rejected` | `no_formula` | `no_current_version` | `formula_archived`;
  - a `pointer` to the current version, the formula, or the line.

**Only a validated current version reads `validated`.** An older validated version replaced by a new one reads `unvalidated`.

The loader reports facts only. BE-E's evaluators filter to the in-scope initiatives and decide completeness. The integration test drives a real transformation through these states:

1. Empty: no cases, `null`.
2. Unvalidated, with `no_formula` lines.
3. FIN validates the baseline and the version, and both read validated.
4. A baseline edit makes it **stale**, and a new version makes the line **unvalidated** with `currentVersionNo` 2.

### Lineage (REQ-S08-004/006/008 increments)

`POST …/versions/{versionNo}/calculations` appends one `benefit_calculation` row. The row holds:

- **`inputs`:** `{name: {name, kind, unit, currency, period, value, description, source}}`, one entry for every variable, with the value actually used. An overridden value gets the source "Calculation input (overrides the version value)".
- **`assumptions` and the period.** A period that ends before it starts gives 422 `benefit_calculation.period_range`.
- **The result:** null when Unknown.
- **The result type**, `outcome` (`ok`/`error`), `error_code`, `rounded` and `engine_version`.

**Unknown is never 0.**

- Division by zero gives `outcome: error`, `result: null`, `errorCode: formula.division_by_zero`.
- A missing value gives `formula.missing_input`. The test checks the column is SQL `NULL`.
- A version whose preview is Unknown has `previewResult: null`.

**The full rounding record.** ADR-0024 §6 item 11 says to keep `{column, scale, mode, precision, exact, stored, rounded, inexactIntermediate}` as is, but `benefit_calculation` only has a `rounded` boolean column, and the contract only returns `rounded`. I therefore keep the full engine object in that row's audit event (`changes.rounding.to`), which the test asserts. §6.2 raises this.

**Immutability.** Lineage rows, variables and versions are append-only or immutable. The test shows that a direct `UPDATE`/`DELETE` on `benefit_calculation`, an `UPDATE` on `benefit_formula_variable`, and an expression `UPDATE` on `benefit_formula_version` are each refused by the database.

**Archiving.** A formula that backs an active business-case line cannot be archived: 422 `benefit_formula.in_use`. An archived formula is read-only (422 `benefit_formula.archived` on PATCH, a new version, a calculation or a validation), and it is listed only with `includeArchived=true`.

### Mutation rules (ADR-0021 §10)

- **Commit-time authorization (BE18A).** Every mutation runs `openWrite(…, { atCommit: true })` inside its transaction.
  - The five lock-based race tests cover update, archive, new version, calculation and validation. Each gets 403, audited, with nothing written.
  - **Control run:** I removed `atCommit` from the calculation create, and its race test **failed with 201** (`control-commit-time-without-atCommit.log`). I then restored the source; `cmp` against the backup is identical.
  - Create, as with KBE-B, authorizes before reading any formula row, so the lock technique can't race it. It uses the same `openWrite(…, { atCommit: true })`.
- **AUD gets 403 on every mutation.** The test covers 10 attempts: three creates (including a nonsense body), PATCH, archive, a new version, a calculation, a validation, and `/validate` twice.
  - The mutations on stored records are audited as `authorization.denied`.
  - `/validate` has no transformation and writes nothing, so its 403 is not audited. This is the same as a create without a usable `transformationId`.
  - Nothing changes in any of the 10 attempts.
- **`If-Match`.** It gives 428 or 409 on PATCH, archive, a new version and a validation. Creates start at version 1. The append-only calculation has no `If-Match`, because the contract declares none.
- **Audit events.** Every change writes one: `benefit_formula.create|update|archive|version_set`, `benefit_formula_version.create|validate|reject` and `benefit_calculation.create`, each with its `{field: {from, to}}` diff. A version's variables are in its create event.
- **Validation.** Zod runs first (400), then the engine and the business rules (422). Free text goes through `freeText`. There is no route-local parser.
- **Media type.** `config.consumes` is `["application/json"]` on all seven body routes.
- **Transactions.** No client or remote I/O happens inside a transaction.
- **Idempotency.** `createBenefitFormula` honours `Idempotency-Key` through `maybeIdempotent`, after authorization.

## 3. Problem codes, English texts, and interpretations to confirm

The engine codes use the engine's `message`, which is the ADR-0024 §6 text. `finance.validator_is_author` reuses the `db-errors.ts` text. I wrote the texts below; the architect may want to add them to ADR-0024.

| Code | Status | English detail |
|---|---|---|
| `benefit_formula.example_and_version` | 422 | `Give either fromExample or initialVersion, not both.` |
| `benefit_formula.archived` | 422 | `Archived benefit formulas, their versions and their calculations are read-only.` |
| `benefit_formula.already_archived` | 422 | `The benefit formula is already archived.` |
| `benefit_formula.in_use` | 422 | `This benefit formula backs an active business case line; archive the line or unlink the formula first.` |
| `benefit_formula_version.validation_final` | 422 | `The Finance validation of this formula version is final; create a new version to change the benefit logic.` |
| `benefit_calculation.period_range` | 422 | `The period ends before it starts.` |
| `formula.undefined_variable` (unknown calculation input) | 422 | `Undefined variable: {name}` (ADR text) |

**Interpretations (please confirm):**

1. **Create with a version gives `version` 2.** `benefit_formula.current_version_no` → `benefit_formula_version` and `benefit_formula_version.formula_id` → `benefit_formula` are both non-deferrable foreign keys. A row can therefore only get its version 1 by being inserted (row version 1) and then updated (row version 2). That happens in the same transaction, with both steps audited (`benefit_formula.create`, then `benefit_formula.version_set`).
   - The 201 carries `ETag "2"`. A create without a version stays at 1.
   - If the architect wants version 1 there, `0027+` would need `benefit_formula_current_version_fkey DEFERRABLE INITIALLY DEFERRED`.
2. **Routes whose permission the contract summary doesn't name.**
   - `GET /benefit-formula-examples` is a global catalogue with no 403 in the contract, so it is `"authenticated"`, like `GET /dependency-types`.
   - `POST /benefit-formulas/validate` declares 403 but names no right. It needs `benefit_formula.edit` held anywhere (TL, BO, KDS), so AUD gets 403.
   - `kpi.test.ts` pins both as explicit exceptions.
3. **Calculation URL.** The assignment's "`…/versions/{versionNo}/preview`" is the contract's `…/versions/{versionNo}/calculations` (`createBenefitCalculation`). I followed the frozen contract.
4. **Calculation `ETag` and `Location`.** The calculation 201 sends `ETag "1"`, because an append-only row has no version column. `Location` points to `…/calculations/{id}`. The contract defines no GET for one calculation.
5. **Variable values** are returned in canonical form, for example `"0.1"` for the stored `0.100000`. Results are canonical (`"100000"`), and stored columns keep `numeric(24,6)` (ADR-0024 §6 item 12).
6. **`resultUnit`** is whatever the engine gives. For the revenue example that is `"per customer"`, the currency operand's unit label. That is KBE-A's rule and I did not change it.
7. **Validating a non-current version** is allowed (a version is immutable). G4 reads only the current version's state.
8. **The validator-is-author check** compares against the version's `created_by`, matching the DB CHECK.

## 4. Tests

**Unit, `formulas.test.ts` (10 tests):**

- **ADR-0002 guard:** `"validateFormula" in await import("@mth/shared")` is **false**, and the same holds for `evaluateFormula`. `@mth/shared/calc` exports both.
- **Examples:** revenue `"100000"` exact and cost `"500000"` exact.
- **Period mismatch:** monthly × annual gives 422 with the exact ADR text, and `to_period` converts.
- **Undefined variable:** 422.
- **Boundaries:** seven schema refusals give 400; astral input gives 422; reserved names, duplicate names and currency-on-count give 422 at `/variables`.
- **Unknown:** division by zero and a missing value give Unknown (`null`, never `"0"`).
- **Lineage helpers:** `engineVariables` mapping; `expressionSha256`.

**Unit, `p3-gate-facts.test.ts` (9 tests):**

- `formulaValidationOf` for all six states, including "older version validated, current not" → `unvalidated`.
- `buildKpiP3GateFacts` worked fixture:
  - a stale baseline;
  - archived cases excluded;
  - non-financial and investment lines excluded;
  - the empty case gives `null` and `[]`, never a default "validated".

**Integration, `benefit-formulas.test.ts` (16 tests):**

1. The six T09 columns persist, read from both the API and the database; BF-nn codes; audit events.
2. Confidence X → 400 (create and PATCH), nothing written; the DB CHECK.
3. Undefined variable → 422, with nothing written (create and new version); syntax → 422; schema → 400.
4. The examples verbatim and marked illustrative; 401 without a session.
5. Instantiate revenue → **100000**; cost → **500000**; both-at-once → 422; an edit ends the illustrative mark.
6. Monthly ARPU × annual → **422 `formula.period_mismatch`** (new version and `/validate`); `to_period` accepted.
7. Lineage: inputs, sources, assumptions and period; the rounding record in the audit event; Unknown for division by zero and a missing value; 422 for an unknown input and a reversed period; pagination; **append-only and immutable** at the database.
8. **FIN validation; the author gets 403** (API and DB CHECK); TL 403; 428/409/400; final once recorded; reject on v2.
9. **AUD 403 on every mutation**, audited, nothing changed.
10. `If-Match` 428/409; the in-use and archived guards; `includeArchived`; the audit diff; 404 for a non-reader.
11–15. Commit-time re-authorization: update, archive, new version, calculation, validation.
16. `loadKpiP3GateFacts` against PostgreSQL, through the states listed in §2.

**Contract:** all 13 operations go through `ctx.mirrored`, and each success body is parsed with its zod mirror (`P3_MIRRORS_KBE_C`).

## 5. Pinned contract counts (`contract.test.ts`)

These are the only assertions I changed in that file.

| Assertion | Old | New | Why |
|---|---|---|---|
| Media-type triple | `[134, 133, 1]` (the value at this `HEAD`, already reconciled; the assignment text said `[90, 89, 1]`) | **`[141, 140, 1]`** | Seven new JSON bodies: `checkBenefitFormula`, `createBenefitFormula`, `updateBenefitFormula`, `archiveBenefitFormula`, `createBenefitFormulaVersion`, `createBenefitCalculation`, `validateBenefitFormulaVersion` |
| Rate-limit floor | `>= 240` (at this `HEAD`; the assignment text said `>= 167`) | **`>= 253`** | 240 plus the 13 KBE-C operations. I also extended the comment above it. The live sweep checked all of them. |

P3 pending for KBE-C went from 13 to **0**.

## 6. Changes needed in files I do not own

1. **`apps/api/src/server.test.ts` (BE-A).** The test "module composition (D-048, P2)" ends with `expect(routes.filter((r) => /report|formula/i.test(r.url))).toEqual([])`. That guard dates from P2, before the T09 routes existed, and it now fails with the 13 `/benefit-formula…` routes. That is the only `pnpm test` failure.
   - **Proposed change** (`T-DG3-KBE-C-evidence/server-test-requested-change.patch`): change the regex to `/report/i`, with a comment. No routed URL contains "report"; I checked both `openapi.yaml` paths and the module sources.
   - **Not verified:** I did not apply the patch or run it.
2. **ADR-0024 / migration (architect).** Two schema questions, neither blocking:
   - **The rounding record has no column.** ADR §6 item 11 asks to store the engine's full rounding record in the lineage, but `benefit_calculation` has only `rounded boolean`. I keep the full object in the row's audit event for now. A `rounding jsonb` column in `0027+`, plus the contract, would put it on the row itself.
   - **The current-version foreign key.** Consider making it `DEFERRABLE INITIALLY DEFERRED` if a create with a version must end at row version 1 (§3, item 1).
3. **BE-E:** wire `kpi: loadKpiP3GateFacts` (from `kpi/index.ts`) in `server.ts`.
   - The facts type is `KpiP3GateFactsData`, which satisfies `KpiP3GateFacts` (it has an index signature).
   - The pointers are API paths without `/api/v1`, following ADR-0021 §7's examples (`/business-cases/{id}`, `/benefit-formulas/{id}`).
4. **`packages/shared/src/schemas/index.ts`:** one export line for `benefit-formula.ts`. ARCH-03's parallel line must be merged with it. I checked that no export name collides with the existing schemas.

## 7. Checks run

**Environment:** Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) and pnpm, offline. PostgreSQL 16.13 through `tests/qa/support/with-pg.sh`, on ports 23400–23449. Logs are in `docs/delivery/handbacks/DG3/T-DG3-KBE-C-evidence/`.

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` (start and end) | 0 | `PASS gate DG2 (historical)` | `validate-historical-DG2.log`, `final.log` |
| `pnpm -r typecheck` | 0 | All 7 projects done | `typecheck.log` |
| `pnpm -r build` | 0 | — | `build.log` |
| `pnpm lint` | 0 | — | `lint.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 270 operations` | `openapi-lint.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | **1** | 59 files, **1182/1183**. The 1 failure is `server.test.ts` (§6.1). | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | 59 files, **1182/1183**, the same single failure | `unit-c-utf8.log` |
| `QA_PG_PORT=23410 MTH_PORT_POOL=23411-23449 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 50 files, **763/763**; "applied 25 migrations to a fresh database"; `benefit-formulas.test.ts` 16 tests; `contract.test.ts` 25 tests | `integration.log` |
| Control: the calculation commit-time race without `atCommit` (deliberate) | 1 | 201 instead of 403, so the test measures the re-check. Source restored, and `cmp` confirms it is identical. | `control-commit-time-without-atCommit.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (run last, after this handback was written) | 0 | "All matched files use Prettier code style!" | `prettier-ls-files.log`, `final.log` |

**My test additions:**

- **Unit:** +23, made of `formulas.test.ts` 10, `p3-gate-facts.test.ts` 9, and 4 more cases of the existing "never a float" source scan in `kpi.test.ts`, which now also covers my four non-test sources.
- **Integration:** +16 (`benefit-formulas.test.ts`). The contract test's case count is unchanged; its exercise of my operations runs inside existing cases.

**Earlier non-zero exits, all fixed before the final runs:**

1. **First kpi unit run:** exit 1, 2 failures.
   - The module-interface checker flagged computed member keys (`lineage[v.name]` in `calculations.ts` and `PERMISSION_EXCEPTIONS[...]` in `kpi.test.ts`). I replaced them with `Map` and `Object.fromEntries`.
   - My expectation of `resultUnit: null` was wrong: the engine returns `"per customer"`.
2. **First run of the new integration suite:** 1 failure out of 16. My "404 for a non-reader" fixture used a second world's auditor, who can read the same business unit. I replaced it with a signed-in user with no grants.
3. **First contract run:** 1 failure, the media-type triple, which §5 then updated.
4. **Empty `apps/api/.claude/.cc-writes`** harness directory: removed before the unit suites, as the assignment says.

**Log scan of `integration.log`** for "unhandled", "timeout" and "hook timed out": the only matches come from passing DG2 tests that print expected output (the BE17 ECONNRESET probe, the `requestTimeout` 408 probes, bounded checkout and idle-in-transaction). No suite failed and no hook timed out.

**Untracked files I did not create.** The worktree had them before I started: `.bashrc`, `.bash_profile`, `.profile`, `.zshrc`, `.zprofile`, `.gitconfig`, `.gitmodules`, `.idea/`, `.vscode/`, `.mcp.json`, `.ripgreprc` and `CLAUDE.local.md`, which appear to be harness or home artifacts. I did not touch them, and they must not be committed. The Prettier sweep lists all untracked files, so its result covers them too (see `prettier-ls-files.log`).

## 8. Not done / merge notes

- **Not done:** the `server.test.ts` assertion (§6.1), which the orchestrator or BE-A must apply. Until it is applied, `pnpm test` fails with exactly that one test. Everything in scope is implemented and tested.
- **Merge:**
  - No migration and no dependency.
  - `kpi/routes.ts` and `kpi/index.ts` gained lines after KBE-B's, as sequenced.
  - `schemas/index.ts` will conflict with ARCH-03's line in the same spot; keep both lines.
  - BE-E wires `loadKpiP3GateFacts` after this merge.
- **Arabic texts** for the new codes are the web's (FE-C) to provide, translated from `code`.
