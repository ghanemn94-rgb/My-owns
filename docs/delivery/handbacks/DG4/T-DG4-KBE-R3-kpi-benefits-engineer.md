# Handback T-DG4-KBE-R3 (kpi-benefits-engineer): `getBenefitPlanValue` and formula lineage

- **Stage:** P4, gate DG4 (BUILDING). Engineering work only. No business, Finance or IT approval was granted. All test data is synthetic. Nothing here touches DG0–DG7 records. Product gate G6 does not imply DG7.
- **Invocation:** `DG4-T-DG4-KBE-R3-kpi-benefits-engineer-20261010T031002Z-0a682f82`, session `0a682f82-96d8-4d07-a050-cbad398d4133`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-R3.md`, sha256 `f2f6a30c…9d9a09a`, verified.
- **Base:** branch `dg4/kbe-r3` at `7dd77b5650a7fd15c0e15483f72ec6c8e6f36df8`. `git status` was clean except for untracked home dotfiles at the worktree root (`.bashrc`, `.gitconfig`, `.idea`, …). They are not mine and I left them alone.
- **Time:** started `2026-10-10T03:10:18Z`, ended `2026-10-10T04:23:15Z` (about 73 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and exited 0, at the start and again at the end.
- **Changes:** uncommitted, left for the orchestrator to integrate.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/benefits/values.ts` | Adds the `GET /transformations/{t}/benefit-plan-values/{id}` route (`getBenefitPlanValue`) and the exported `readPlanValue`. It checks the read gate (`requireTransformationRead`, 404 outside scope), returns 404 when the id is not a `benefit_plan_value` row of that transformation, and replies 200 `BenefitPlanValue` with `ETag` = the version through `sendVersioned`. It writes nothing and records no audit event. The route is added to the module's route list. |
| `apps/worker/src/handlers/kpi.ts` | Formula lineage (ADR-0027 amendment C1): `Context.lineage`, `bindSlot` (records result and lineage under the same key in both the run path and `ensureInput`), `sourceEntry`, `sources` on formula evaluations, `values` only when every input is known, `entries` on roll-ups, and `kpi_formula_input` read `ORDER BY id`. |
| `apps/api/test/support/p4-pending-arch-r2.ts` | `getBenefitPlanValue` removed. `getInheritedRecord` stays (BE-R3). |
| `apps/api/test/integration/contract/p4-exercises-kbe-e.ts` | Exercises `getBenefitPlanValue` through the validating client and adds it to `P4_MIRRORS_KBE_E` (zod `benefitPlanValue`). The checks: the create's `Location` resolves (200, ETag `"1"`); the read's ETag is the `If-Match` of the update; after the update the re-read gives ETag `"2"`; outsider 404; unknown id 404; a benefit id 404; malformed id 400. |
| `apps/api/test/integration/kpi-p4/formula-recalc.test.ts` | KBE-R1's fixture (T = a + b) now asserts the full lineage at the three steps (Unknown b; both separately accepted actuals; A's correction to value 2). It also asserts exactly B's own rows, the run's counts and its events. |
| `apps/api/test/integration/kpi-p4/formula-lineage.test.ts` (new) | Nested formula lineage (N = s * 2 over S = a + b) down to accepted `kpi_actual_value` versions, and roll-up `entries`. |
| `apps/api/test/integration/benefits/plan-value-read.test.ts` (new) | `getBenefitPlanValue` on the real server built by `startApi()`, with no hand wiring (D-107): the route is registered; Location → GET → If-Match round trip; stale ETag 409, then a re-read shows the current version; AUD/FIN read; outsider, another transformation, a benefit id and a random id give 404; malformed 400; unauthenticated 401; no audit event from reads. |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-R3-kpi-benefits-engineer.md`, `…/T-DG4-KBE-R3-evidence/*.log` | This handback and the logs, copied from `$TMPDIR` after the suites finished (G6 test rule). |

There are no migrations, no `server.ts` changes, no contract (`openapi.yaml`) changes and no zod changes. The formula engine (`packages/shared/src/formula/**`, S-9) is unchanged.

## 2. Behaviour delivered

### 2.1 ARCH-R2 item 4: `getBenefitPlanValue` (ADR-0030 amendment P1)

The amendment specifies `GET /api/v1/transformations/{transformationId}/benefit-plan-values/{benefitPlanValueId}`, permission `transformation.read`. It returns 200 `BenefitPlanValue` with `ETag` = version; 404 when the id is not a `benefit_plan_value` row of that transformation or is outside scope; 400 for a malformed id; 401. A read writes nothing and records no audit event. All of these are delivered, and each is tested in `plan-value-read.test.ts` and in the contract exercise:

- **`Location` resolves.** `createBenefitPlanValue`'s `Location` (`…/benefit-plan-values/{id}`) answers 200 with a body identical to the create's body.
- **Edit flow.** GET's ETag is sent as `If-Match` to `updateBenefitPlanValue` and gives 200 version 2. A re-GET returns ETag `"2"` and a body identical to the update's. The stale ETag gives 409 `version_conflict` with `currentVersion: 2`. A re-read shows version 2.
- **Scope.** AUD and FIN read (200). The outsider gets 404 `not_found`. The id under another transformation the caller can read gives 404. Another transformation's plan value read under this transformation gives 404. A benefit id gives 404, and a random UUID gives 404. `not-a-uuid` gives 400 `validation`. With no session the read gives 401.
- **No write.** The audit trail of the record is exactly its create (plus its one update in the edit test).
- **Production wiring (D-107).** None is needed: the route is registered by the benefits module's `registerBenefitValueRoutes`, which `routes.ts` already includes. `plan-value-read.test.ts` builds the real server through `startApi()` (`buildServer`), registers or wires nothing by hand, and asserts the route record `GET …/benefit-plan-values/:benefitPlanValueId` is present.
- **Codes.** No new problem code. It uses `not_found`, `validation`, `version_conflict` and the 401 as built.
- **Unchanged:** `getBenefitValues` and `BenefitValueLine`, as the amendment requires.

### 2.2 ARCH-R2 item 5: formula lineage (ADR-0027 amendment C1; ADR-0028 amendment of 2026-10-10)

The amendment's "Implementer" steps, as built:

1. **Step 1.** `evaluateSlot`'s results are recorded through `bindSlot(ctx, key, e)` in both the run path and `ensureInput` (binding only). `ctx.lineage` holds `{kpiVersionId, valueSource, valueStatus, value, inputs}` under the same key as `ctx.computed`.
2. **Step 2: `sources`.** A formula evaluation stores `inputs = { formula, values?, sources }`.
   - `sources[var]` is `{ kpiDefinitionId, kpiVersionId, inputBasis, scopeKind, scopeId, reportingPeriodId, valueSource, valueStatus, value, inputs }`. Its `inputs` is the source slot's own `inputs`:
     - for an entered source, `{ kpiActualId, valueNo, window? }`, the accepted actual version;
     - for a formula source, its own `{ formula, values?, sources }`, so lineage reaches the actuals at every level (bounded by `kpi_formula_no_cycle` and the existing depth limit of 32).
   - A source that is not computable here gets `valueSource "none"`, `valueStatus "unknown"`, `value null`, `inputs {}`, and `kpiVersionId` = the source's active version or null. This covers a source with no active version and one beyond depth 32.
   - The shape is the same whether the source was evaluated in this run or bound only. A binding-only source is still not stored as an evaluation and still records no finding.
3. **Step 3: `entries`.** A roll-up stores `inputs = { expectedScopes, missingScopes, entries }`, with `entries: [{ scopeId, kpiActualId, valueNo }]`, one per scope whose accepted value of the slot entered the roll-up, ordered by `scopeId` (code-point order, locale-independent). A scope in `missingScopes` is not listed. The `{}` shapes (no roll-up, or roll-up Unknown) are unchanged.

**Change to match the amendment ("`values` only when every input is known").** As built, an evaluation with an Unknown input stored `values: { a: "120", b: null }`, because the engine returns `ok` and propagates the Unknown. The amendment's C1 test says "An Unknown input appears in `sources` with `valueStatus` unknown and `inputs: {}`, and `values` is absent". `values` is now written only when every bound input has a value. No code reads `inputs.values` (searched `apps/api/src`, `apps/web/src`, `packages/shared/src`).

The amendment's tests, and where each one is:

| Amendment C1 test | Where | Result |
|---|---|---|
| T = a + b with a and b accepted in separate runs: `sources.a.inputs` and `sources.b.inputs` name each accepted `kpiActualId` and `valueNo` | `formula-recalc.test.ts` (KBE-R1's fixture), step 3: `a → {kpiActualId: A, valueNo: 1}` (bound only, from A's earlier run), `b → {kpiActualId: B, valueNo: 1}`; step 4 (A's correction): `a → valueNo 2` | pass |
| A formula over a formula source nests one level | `formula-lineage.test.ts`: N = s * 2 over S = a + b; `sources.s.inputs` equals S's own stored inputs, and every leaf is an `accepted` `kpi_actual` whose `accepted_value_no` equals the leaf's `valueNo` | pass |
| An Unknown input appears in `sources` with `valueStatus` unknown and `inputs: {}`; `values` absent | `formula-recalc.test.ts` step 1: `{ formula, sources: { a: …accepted…, b: { valueSource: "none", valueStatus: "unknown", value: null, inputs: {} } } }` | pass |
| A roll-up lists its `entries` | `formula-lineage.test.ts`: two business units 4 + 6 = 10; `entries` sorted by `scopeId`; the earlier run lists the one entry | pass |
| The run's other rows, findings and events are unchanged (the KBE-R1 byte comparison) | `formula-recalc.test.ts` step 3 asserts exactly: B's own rows (`period` `{kpiActualId, valueNo}`, `cumulative` `{…, window: [period]}`), `evaluation_count 4`, `finding_count 0`, events = 2 × `kpi.deviation_evaluated` + 1 × `kpi.values_recalculated`. **Baseline proof:** the same test was run against HEAD's `kpi.ts` (at `7dd77b5`) with only the three lineage `toEqual`s softened (`expect.soft`). Exactly those three failed (on lineage only); every rows/counts/events assertion passed. Evidence: `baseline-compare.log`. Both files were then restored, and the worker rebuilt. | pass |

### 2.3 Requirement row

My section assigns no requirement row by ID. Item 5 serves **REQ-S08-006**, whose acceptance text is: _"A05;A07: a benefit value drills to the formula version, input actual versions and rates used; after a formula change old results keep the old version reference"_.

- **Delivered (KPI side only):** a formula KPI evaluation now stores the input actual versions (`kpiActualId`, `valueNo`) and the source KPI versions, through every formula level and roll-up. This is readable through `getCalculationRun` (evaluations with `inputs`). Old evaluations are append-only and keep their `kpi_version_id`.
- **Not claimed:** the benefit-value drill-down ("a benefit value drills to …") and exposure in `loadKpiStatusLineage`. The amendment explicitly says no exposure is claimed. The row is not complete by this task alone.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. Harness ports `QA_PG_PORT=25350` and `MTH_PORT_POOL=25351-25399` (my range). Disk was checked before each full run (19–20 GB free). I checked for empty `.claude/.cc-writes` directories in source folders before the tests and found none.

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` (start and end) | `validate-dg3-historical.log` |
| `pnpm -r typecheck` | 0 | clean | `typecheck.log` |
| `pnpm -r build` | 0 | clean | `build.log` |
| `pnpm lint` | 0 | clean (see the first-attempt note) | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (see the first-attempt note) | `prettier.log` |
| `pnpm openapi:lint` | 0 | clean | `openapi-lint.log` |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | 1st invocation 126 files / 2402 tests passed; 2nd invocation 3 files, 259 passed, 2 skipped (261) | `unit-locale-unset.log` |
| `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8`, **first attempt** | 1 | 1 failure: `apps/api/src/architecture.test.ts` "every import respects dependsOn…" **timed out at its 30 s limit** (run took 479 s at load average about 24, with other worktrees running). 2401 others passed; the 2nd invocation did not run (`&&`). | `unit-c-utf8-attempt1.log` |
| `pnpm test`, `C.UTF-8`, **rerun** | 0 | 1st invocation 126 / 2402 passed (architecture test included); 2nd invocation 259 passed, 2 skipped (261) | `unit-c-utf8.log` |
| `QA_PG_PORT=25350 MTH_PORT_POOL=25351-25399 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **182 files / 1713 tests passed** (03:59:55–04:22:15 UTC) | `integration.log` |
| Targeted: plan-value-read, values, all of `kpi-p4/`, worker `kpi-recalculate` | 0 | 20 files / 100 tests passed | `targeted3.log` |
| Baseline comparison (HEAD `kpi.ts`, lineage assertions soft) | 1 (expected) | only the 3 lineage assertions failed; the rows/counts/events assertions passed | `baseline-compare.log` |

**Disclosures:**

- **First attempts:**
  - `pnpm lint` exited 1 on an unused `ifm` import in my new `plan-value-read.test.ts`.
  - `prettier --check` exited 123 on the same file's formatting.
  - Both were fixed and re-run (exit 0). The first-attempt logs were overwritten by the re-runs, so they are not in the evidence folder.
- **The C.UTF-8 timeout:** a load-related timeout of an unchanged test. It passed in the locale-unset run and in the C.UTF-8 rerun. My only change near it is a new import of `../access/index.ts` (the `access` public surface, which `register.ts` already imports) in `benefits/values.ts`, and the boundary test passed with it.
- **Earlier targeted runs:** during development, two targeted runs failed on my own test expectations (`note: null` is not accepted by the create; the as-built `values`-with-null shape). Both were fixed as described in §2.

**Pinned counts:**

- `contract.test.ts`'s `operations` stays **649**. `getBenefitPlanValue` was already in the contract.
- Request bodies with JSON stay **323 / 322 / 1**: I added no request body, so there is **no media-type pin delta**.
- Integration grows by **+2 files and +5 tests** (`plan-value-read` with 3 tests, `formula-lineage` with 2). `formula-recalc` is still 1 test. I did not run a base-commit integration count.

## 4. Operations routed (delta to the pending list)

- `apps/api/test/support/p4-pending-arch-r2.ts`: `["getInheritedRecord", "getBenefitPlanValue"]` becomes `["getInheritedRecord"]`. **−1: `getBenefitPlanValue`** is routed (`benefits/values.ts`) and exercised (`p4-exercises-kbe-e.ts`, mirror `benefitPlanValue`).
- **Merge note:** BE-R3 is expected to remove `getInheritedRecord` from the same file at the same time, so expect a trivial conflict on that one line. The resolved list should be empty if BE-R3 routes it.

## 5. Contract, schema and wiring needs (for the orchestrator)

- **None blocking.** There is no migration (the `kpi_evaluation.inputs` column is already `jsonb`, as C1 says), no `server.ts` dependency and no new problem code.
- **Contract description (optional, ARCH):** C1 says `KpiEvaluation.inputs` keeps `{type: object}` and "only its description changes". I did not edit `docs/api/openapi.yaml` (not in my ownership). If ARCH-R2 has not updated that description yet, it is still owed.
- **Ordering of `sources`:** C1 says "keyed by variable name, in `kpi_formula_input` order". The table has no ordinal column, so the worker reads inputs `ORDER BY id` (UUIDv7, creation order). PostgreSQL `jsonb` stores object keys in its own canonical order, so a stored and reread `sources` object does not keep insertion order whatever the writer does. Consumers must key by variable name. A future ARCH note could say so.
- **Cumulative roll-up `entries` (spec question):** C1 defines `entries` as `{scopeId, kpiActualId, valueNo}`, one per scope "whose accepted value entered the roll-up". On the `cumulative` basis, a scope can contribute through its window without an accepted value in the current period. Such a scope is not missing, but has no current-period actual to name, so it is not listed. Its window actuals are not named either. If ARCH wants window lineage for cumulative roll-ups (for example `window` per entry, like the entered shape), that is a small, separable follow-up. I did not add members beyond the spec.

## 6. What remains

- **REQ-S08-006 as a whole:** the benefit-value drill-down to formula version, input actual versions and rates, and any UI or `loadKpiStatusLineage` exposure of `sources`, are outside this repair scope and not delivered here.
- **The two spec notes in §5** (`jsonb` key order; cumulative roll-up window lineage) are for ARCH to decide.
- Nothing else in my section remains.
