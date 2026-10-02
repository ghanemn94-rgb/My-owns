# Handback T-DG2-KBE: kpi-benefits-engineer (P2 KPI/benefits slice)

- **Stage / gate:** P2 "Diagnose, define and design" / DG2 (BUILDING). Branch `claude/mobily-transformation-platform-regate`.
- **Assignment:** `docs/delivery/assignments/DG2/T-DG2-KBE.md` (sha256 `686c62df…0c60ee8c13`, verified before starting).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-KBE-kpi-benefits-engineer-20261002T011050Z-204452f7","session_id":"204452f7-59ed-445e-97d7-bc8510c6c472"}`.
- **Base revision:** `HEAD = 23933b5` ("DG2: P2 implementation assignments T-DG2-BE and T-DG2-KBE"), on top of `ef99eb0`. Before implementation, `node tools/gates/validate.mjs --historical --stage DG1` returned `PASS gate DG1 (historical)`, exit 0.
- **Scope kept:** I wrote only files in the KBE column of `docs/architecture/p2-work-split.md` §3 and this handback. I did not edit `modules.ts`, `server.ts`, `server.test.ts`, `contract.test.ts`, `p2-pending.ts`, migrations, `schema.ts`, `schemas/index.ts`, `permissions.ts`, BE's modules, `apps/web/**` or `docs/**` (except this file).
- **No business approval was granted.** Finance validation (FIN) and trajectory approval (SP/BO) are human actions inside the product. This slice records them; it approves nothing. Product gates G1–G6 are unrelated to the DG0–DG7 delivery gates.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/value.ts` (new) | Decimal helpers, with no float anywhere: `checkDecimal`/`parseDecimal`/`fitsColumn`/`toColumnString` (money `numeric(20,4)`, measure `numeric(24,6)`, never rounding silently), `canonicalDecimal`, `compareDecimal`, `sumDecimals`, `formatDecimal` (locale display; returns null for Unknown, never 0), `validationState` (unvalidated/validated/rejected/**stale**), and the value-pool total `totalValuePools` / `totalValuePoolsIn` / `isPartialTotal` (ADR-0019 §5). |
| `packages/shared/src/value.test.ts` (new) | 29 unit tests: ADR-0019 required fixtures, property tests with an exact BigInt oracle, and a no-float source check. |
| `packages/shared/src/schemas/kpi.ts` (filled stub) | zod mirrors: `decimal`, `moneyDecimal`, `measureDecimal`, `businessDate` (real calendar date), `trajectoryPoint`, `kpiDefinition*`, `baseline*`, `outcomeKpi*`, `valuePool*` (entity, Create, Update, Page), `validationDecision`, `trajectoryApproval`, `kpiListQuery`. It re-exports `../value.ts` (see gap G6). |
| `apps/api/src/modules/kpi/index.ts` | Public interface: `registerKpiModule` (now `status: "active"`, `deliversIn: "P2"`, 23 routes), `loadKpiGateFacts`, `KpiGateFacts`, `VALUE_FRESHNESS`. |
| `apps/api/src/modules/kpi/gate-facts.ts` (new) | `KpiGateFacts` (the exact shape from work split §3) and `loadKpiGateFacts(db, transformationId)`. |
| `apps/api/src/modules/kpi/routes.ts` (new) | Registers the four resources; each route declares `config.access`. |
| `apps/api/src/modules/kpi/support.ts` (new) | Shared prologue: read gate (404) → action gate (403, audited) → transformation not archived (422). Also list paging, idempotent create, 422/403 problem builders and the active-user check. |
| `apps/api/src/modules/kpi/kpi-definitions.ts` (new) | `kpi-definitions` list/create/get/update/archive. |
| `apps/api/src/modules/kpi/baselines.ts` (new) | `baselines` CRUD and `validation` (FIN). |
| `apps/api/src/modules/kpi/outcome-kpis.ts` (new) | `outcome-kpis` (T02) CRUD and `trajectory-approval` (SP/BO). |
| `apps/api/src/modules/kpi/value-pools.ts` (new) | `value-pools` CRUD and `validation` (FIN). |
| `apps/api/src/modules/kpi/repository.ts` (new) | Row→DTO mappers (numeric is passed through as a string), finders, reference/user/workstream checks, audit field lists. |
| `apps/api/src/modules/kpi/rules.ts` (new) | Pure domain rules (no I/O), each returning a code and a JSON pointer. |
| `apps/api/src/modules/kpi/kpi.test.ts` (rewritten) | Module suite: mapping/boundary, public interface, the 23 routes matched against `openapi.yaml`, the contract's permission per route, and the ADR-0019 §4 "never a float" source scan of the module plus `value.ts` and `schemas/kpi.ts`. |
| `apps/api/src/modules/kpi/rules.test.ts` (new) | 17 unit tests of the rules and the zod mirrors. |
| `apps/api/test/integration/kpi/fixtures.ts` (new) | Synthetic kpi world: a transformation, one user per P2 role at transformation scope, SoD probes (FIN+KDS, FIN+TL), and outcome rows written with their audit event. |
| `apps/api/test/integration/kpi/kpi-resources.test.ts` (new) | 23 integration tests: authorization (positive and negative), validation, If-Match/428/409, version +1, audit events, Unknown≠0, stale validation, SoD, T02 rules, totals and gate facts. |
| `apps/api/test/integration/kpi/kpi-aud-write-deny.test.ts` (new) | **AUD → 403 on every kpi mutation.** The 15 mutations are generated from `openapi.yaml`, each sent with a valid body and If-Match. Each must return 403 `forbidden`, leave the record version unchanged and write exactly one `authorization.denied` audit row. The suite also asserts the auditor can read every kpi resource (so the answer is 403, not 404). |
| `apps/api/test/integration/contract/kpi-exercises.ts` | Exercises all 23 kpi operations through `ctx.mirrored`, each with at least one success whose body parses with its kpi zod mirror. Also exercises declared 403/409/422/428 problems. |
| `apps/api/test/support/p2-pending-kpi.ts` | **Now empty** (all 23 operations are routed and exercised). |

## 2. Behaviour delivered, per requirement

- **REQ-PB-027 (baselines):**
  - A measurable baseline has metric, value, unit, source, baseline date and scope.
  - A missing value, source or date is `null` (Unknown), never `0`.
  - Values are exact decimal strings at `numeric(24,6)`. `"123456789012345678.123456"` round-trips unchanged (integration test).
  - A future baseline date is 422 `baseline.date_in_future`; "today" is computed in the transformation's zone (Asia/Riyadh).
  - Finance validation is `finance.validate` (FIN only). The creator gets 403 `kpi.creator_cannot_validate`, audited as `authorization.denied`.
  - `validated` requires value, source and date: 422 `baseline.not_measurable`. A rejection does not.
  - The decision is stored with `validatedRecordVersion` = the version it creates. Any later edit makes it **stale** (`validationState` → `"stale"`; gate facts report `"stale"`), so an edited figure never reads as validated.
  - Clearing value, source or date on a validated baseline withdraws the validation (unvalidated). The prior decision remains in the audit diff.
  - Corrections: the audit event records the prior and new value of every changed field, e.g. `value: {from: "2.100000", to: "2.300000"}`. A separate amendment/reversal record does not exist (gap G2).
- **REQ-PB-028 (value pools), ADR-0019:**
  - A pool defaults to `unquantified` with NULL amounts, which never read as 0. A real `0` is a legal quantified value.
  - Quantified pools need both amounts with downside ≤ upside, compared exactly: 422 `value_pool.amounts_required` / `value_pool.downside_above_upside`.
  - Amounts on an unquantified pool are 422 `value_pool.unquantified_has_amount`. They are never dropped silently.
  - Amounts must fit `numeric(20,4)`, otherwise 400 (no rounding). Currency defaults to the transformation's (SAR).
  - The `workstreamCode` must exist (422 with pointer).
  - FIN validates only quantified pools (unquantified → 422 `value_pool.unquantified`, the ADR-required test). The creator gets 403.
  - Edits make a validation stale. Switching a validated pool to unquantified withdraws the validation (required by the CHECK; kept in the audit diff).
  - Totals are computed by `value.ts` `totalValuePools`:
    - per currency, with no FX;
    - `null` when no pool is quantified;
    - `unquantifiedCount` gives the "partial: N unquantified" label;
    - `basis: "validated"` sums only pools whose **current** version Finance validated, so a submission or edit never raises a validated total before approval (`notValidatedCount` reports the excluded ones).
- **REQ-PB-034 (T02 Outcome & KPI Tree):**
  - All seven source columns persist and read back: outcome, KPI, baseline (record or value), target, target date, owner, leading indicator (text and/or KPI).
  - **A row without a target date, or with `targetDate: null` on create or update, is 422 `outcome_kpi.target_date_required`** with pointer `/targetDate`.
  - Other 422 rules:
    - references must exist in the transformation and not be archived (`validation.reference`);
    - only one baseline source;
    - the target date must be after the linked baseline's date;
    - a KPI cannot be its own leading indicator;
    - trajectory points must have strictly increasing dates and none after the target date.
  - Trajectory approval is `kpi_target.approve` (SP/BO). The creator gets 403 `kpi.creator_cannot_approve`; TL/KDS get 403.
  - Approval needs a target value (422 `outcome_kpi.target_value_required`); approving twice is 422.
  - **Any later edit of an approved row returns it to `draft`.** The approval fields are cleared and the audit diff keeps them.
- **REQ-S16-013 (Baseline and ValuePool create+read with authorization):**
  - Reads need `transformation.read`. A user without it, or a user from another organization, gets 404 on reads and writes (tested).
  - Writes use the contract's permission per route, asserted against the OpenAPI summaries in `kpi.test.ts`: `kpi_definition.edit`, `baseline.edit`, `outcome.edit`, `diagnostic.edit`, `finance.validate`, `kpi_target.approve`.
- **REQ-S10-001 (kpi part of the AUD write-deny):** every one of the 15 kpi mutations returns 403 for AUD, writes nothing, and audits the denial (generated sweep).
- **KPI dictionary, P2 subset (REQ-S07-001 / REQ-S16-014 / REQ-PB-032 increment):**
  - CRUD with the currency⇔unit rule (422); unique name per transformation, case-insensitive (409 `duplicate.name`); active owner/steward from the same organization (422 per field).
  - Archiving a KPI still used by an active T02 row or baseline is 422 `kpi_definition.in_use`.
- **Every mutation:**
  - authorization → If-Match (428 if missing, 400 if malformed) → zod validation (400) → row lock → version check (409 with `currentVersion`) → archived record or transformation (422) → business rules (422);
  - the write with `version + 1`, and **exactly one audit event** in the same transaction.
  - Creates take an optional `Idempotency-Key`. A replay is authorized again before the replay lookup.
- **Gate facts:** `loadKpiGateFacts` returns exactly the `KpiGateFacts` shape from work split §3. Semantics, also stated in `gate-facts.ts`:
  - archived rows are excluded;
  - `validationStatus` is the derived state (`stale` when edited after validation);
  - `trajectoryStatus` is `approved` only when the approval covers the current version;
  - `hasValue`/`hasTarget` are false only for NULL, never for a real zero;
  - `hasUnit` is false only for unit kind `other` without a label.

### Calculation specification (P2 subset) and worked fixtures

Specification: the header and doc comments of `packages/shared/src/value.ts`, plus ADR-0019 §4–§5. There is no separate `docs/` file because `docs/**` is outside my write scope.

- Arithmetic uses decimal.js (precision 80, half-up for display only). Stored values are never rounded: a value that does not fit is refused.
- The transport pattern is `^-?[0-9]{1,18}(\.[0-9]{1,6})?$`. Column fit: money ≤ 16 integer and ≤ 4 fraction digits; measure ≤ 18 and ≤ 6. Insignificant leading and trailing zeros are ignored.
- Total per currency = Σ downside and Σ upside over non-archived quantified pools, printed at 4 decimal places. It is `null` when there are none.

Worked fixtures in tests:
- `12345678901234.5678` round-trip;
- `0.1 + 0.2 = 0.3` exactly;
- {quantified 100–200, unquantified} → `{100.0000, 200.0000}`, `unquantifiedCount 1`, partial;
- empty set → null;
- only unquantified → null with a count;
- quantified 0–0 → `0.0000`, not Unknown;
- a SAR/USD mix is split;
- the validated basis excludes stale, rejected and unvalidated pools;
- 500 random money sums and 200 random pool sets checked against an exact BigInt oracle, including order independence.

The playbook formula examples (Δ attach × customers × ARPU; volume × Δ unit cost) belong to the P4 formula engine and are **not** part of this P2 assignment.

## 3. Checks actually run

**Environment.** The shared working tree holds backend-workflow-engineer's concurrent, uncommitted edits. At the time of my contract run, its `server.ts` failed with `TypeError: registerAccessP2Routes is not a function`. To get a reproducible result I ran every check in a **disposable clone**:
- `git clone` of the repo at `23933b5` into `$TMPDIR/kbe-clone`, with exactly my files copied in;
- `node_modules` copied from the workspace, because `pnpm install --offline` could not link into the read-only pnpm store: `EROFS … /root/.local/share/pnpm/store/v10/projects/…`.

The clone's copies are byte-identical to the files in the working tree (`diff -r`: "same" for all 7 paths). Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) and Node 22.22.2 (`/opt/node22/bin`), pnpm 10.33.0, PostgreSQL 16.13 disposable cluster via `tests/qa/support/with-pg.sh`, offline.

| # | Command (in the clone unless noted) | Result |
|---|---|---|
| 1 | `pnpm -r typecheck` (Node 24) | **exit 0**, 7/8 projects `Done` |
| 2 | `pnpm -r build` (Node 24) | **exit 0** (`apps/api build: Done`, `apps/worker build: Done`, `apps/web ✓ built`) |
| 3 | `pnpm lint` (`eslint . --max-warnings=0`) | **exit 0** |
| 4 | `npx prettier --check <my 7 paths>` and `pnpm format:check` (whole repo) | **exit 0** / **exit 0**: "All matched files use Prettier code style!" |
| 5 | `pnpm test` (unit-node + unit-web), Node 24.21.0 | **exit 1: 387 passed, 1 failed.** The failure is in BE-owned `apps/api/src/server.test.ts` "wires the workflows, kpi and reporting scaffolds, which register no routes in P1". It expects kpi `["scaffold","P4",0]` and now receives `["active","P2",23]`, as this assignment requires. All my suites pass: `value.test.ts (29)`, `kpi/kpi.test.ts (18)`, `kpi/rules.test.ts (17)`. See merge note M1. |
| 6 | `npx vitest run --project unit-node --project unit-web`, Node 22.22.2 | **exit 1**: the same single BE-owned failure (387 passed, 1 failed); `value.test.ts (29)`, `kpi.test.ts (18)`, `rules.test.ts (17)` pass |
| 7 | `QA_PG_PORT=55741 tests/qa/support/with-pg.sh pnpm test:integration`, Node 24 | **exit 0: Test Files 22 passed (22), Tests 250 passed (250)**. Includes `contract/contract.test.ts (10)`, `kpi/kpi-resources.test.ts (23)`, `kpi/kpi-aud-write-deny.test.ts (17)`. "applied 18 migrations to a fresh database" |
| 8 | `QA_PG_PORT=55742 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/kpi apps/api/test/integration/contract`, Node 22 | **exit 0: 3 files, 50 tests passed** |
| 9 | `node tools/gates/validate.mjs --historical --stage DG1` (working tree) | **exit 0**: `PASS gate DG1 (historical)` |

Output tail of run 7:
```
 ✓ |integration| apps/api/test/integration/contract/contract.test.ts (10 tests) 1174ms
 ✓ |integration| apps/api/test/integration/kpi/kpi-resources.test.ts (23 tests) 946ms
 ✓ |integration| apps/api/test/integration/kpi/kpi-aud-write-deny.test.ts (17 tests) 426ms
 ...
 Test Files  22 passed (22)
      Tests  250 passed (250)
```
The full integration suite was **not** run in the shared working tree, because BE's half-applied edits there do not start the server. An earlier run of only my kpi integration tests in the working tree (01:28, before that BE edit) passed 40/40.

File SHA-256 at handback:

| File | SHA-256 |
|---|---|
| `kpi/baselines.ts` | `924a9512…` |
| `kpi/gate-facts.ts` | `dd7206ff…` |
| `kpi/index.ts` | `0cd84894…` |
| `kpi/kpi-definitions.ts` | `da3df84e…` |
| `kpi/kpi.test.ts` | `71df7f29…` |
| `kpi/outcome-kpis.ts` | `ff0c1120…` |
| `kpi/repository.ts` | `c89bc5c0…` |
| `kpi/routes.ts` | `79746e49…` |
| `kpi/rules.test.ts` | `a09784e8…` |
| `kpi/rules.ts` | `46cb73c5…` |
| `kpi/support.ts` | `0450e9f5…` |
| `kpi/value-pools.ts` | `5b2fb17a…` |
| `integration/kpi/fixtures.ts` | `57f87978…` |
| `kpi-aud-write-deny.test.ts` | `8d75810b…` |
| `kpi-resources.test.ts` | `36f76d17…` |
| `kpi-exercises.ts` | `6e27fb08…` |
| `p2-pending-kpi.ts` | `6c30034b…` |
| `schemas/kpi.ts` | `6f08e43c…` |
| `value.ts` | `7d9b0db2…` |
| `value.test.ts` | `52bac1f8…` |

## 4. Remaining `p2-pending-kpi.ts`

```ts
export const P2_PENDING_KPI_OPERATIONS: readonly string[] = [];
```
All 23 kpi operations are routed and exercised with at least one success and their zod mirror.

## 5. Known gaps and requests to BE / the architect (stated plainly)

- **G1: Finance validation evidence fields (contract and schema change needed; NOT delivered).**
  - The assignment says the Finance validation must include baseline, attribution/counterfactual, calculation, evidence, measurement period and assumptions.
  - `ValidationDecision` in `openapi.yaml` has only `result` and `note`, and migration 0014 has no columns for the rest.
  - Today the validation records the result, the note, the validator, the time and the validated version, and it requires value, source and date for `validated`.
  - **Request:**
    - the architect extends `ValidationDecision` (or adds a validation-record resource);
    - BE adds a `0019+` migration (e.g. `baseline_validation` / `value_pool_validation` rows with attribution method, counterfactual, calculation reference, evidence links, measurement period, assumptions);
    - I then wire it.
- **G2: Amendments/reversals linked to the original (schema needed; NOT delivered as records).** Corrections are in-place versioned edits. The audit event keeps every prior and new value, and a validation becomes stale or is withdrawn. A first-class amendment/reversal record with a link to the original needs a table (BE migration) and a contract change.
- **G3: `KpiDefinition.status` cannot become `active`.** `KpiDefinitionUpdate` has no `status`, and there is no activation operation, so every definition stays `draft` until archived. If BE's G2 evaluator requires active KPIs, the architect must add `status` (draft→active) to the contract; the route change on my side is small.
- **G4: No server-side value-pool total endpoint in the contract.** FE (and BE, if needed) computes totals from the list with `value.ts` `totalValuePools`. A dedicated operation needs a contract change.
- **G5: Trajectory-approval note.** There is no column for it, so the note is stored as the approval audit event's `reason`.
- **G6: How `value.ts` is exported.**
  - `packages/shared/src/index.ts` and the `exports` map of `packages/shared/package.json` are frozen for me.
  - So `value.ts` is re-exported from `schemas/kpi.ts`, and consumers import it from `@mth/shared/schemas`.
  - The architect may add a `./value` subpath or a root re-export later.
  - BE's new schemas already import `businessDate`, `decimal` and `moneyDecimal` from `./kpi.ts`; I will keep those names stable.
- **G7: Problem mapping (for BE's `platform`).**
  - The kpi module checks every invariant before the database does, so the guards are a last line of defence only:
    - versions are compared under a row lock, and every write sets `version + 1`;
    - each mutation writes its audit event in the same transaction;
    - SoD and CHECK rules are pre-checked.
  - For defence in depth, please map CHECK `outcome_kpi_approver_not_creator` → 403 `kpi.creator_cannot_approve`. If it ever fires today it falls through to the generic 23514 → 422.
- **G8: Domain rules I added beyond the contract text** (all 422 with pointers; flag them if unwanted): baseline date not in the future; target date after the linked baseline's date; no self-leading KPI; trajectory dates strictly increasing and not after the target date; KPI archive blocked while in use. Not enforced: the target direction against KPI polarity (a "maintain" target is legitimate).
- **G9: Out of scope for P2.** None of the P4 engine is delivered: the formula language, benefit value states, allocations, prioritization scoring and calculation lineage.

## 6. Merge instructions

- **No migrations.** Uses 0010–0018 as they are. No new dependency (decimal.js 10.6.0 and zod were already pinned).
- **M1 (BE, required):**
  - Update BE-owned `apps/api/src/server.test.ts` "module composition (D-048)": kpi is now `["kpi","active","P2",23]`, and the `/kpi/` route filter must no longer expect `[]`.
  - Remove `"kpi"` from `P1_SCAFFOLD_MODULES` in `modules.ts`, and optionally reword `API_MODULES.kpi.responsibility` (it says P4).
  - My `kpi.test.ts` no longer asserts scaffold status. This is the only expected conflict.
- **M2:** BE's `workflows` evaluators import `loadKpiGateFacts` / `KpiGateFacts` from `../kpi/index.ts`. The shape is exactly work split §3.
- **M3:** `contract.test.ts` needs no change. `exerciseKpiOperations` now exercises 23 operations, using fresh sessions from `seedKpiWorld`, because `ctx.sessions.office` is logged out earlier in the file.
