# Handback T-DG4-KBE-R2 (kpi-benefits-engineer)

- **Stage:** DG4 (P4 "Execution value and sustainment"), task T-DG4-KBE-R2, the repair scope of the assignment `docs/delivery/assignments/DG4/T-DG4-KBE-R2.md` (sha256 `5d2c9394…052efe`).
- **Invocation:** `DG4-T-DG4-KBE-R2-kpi-benefits-engineer-20261009T232646Z-899dca0f`, session `899dca0f-44fb-4c25-8835-7c3bfd435e1c`.
- **Base:** branch `dg4/kbe-r2` at `8a641e1152cba35234cacd3a8852fd968cfb5d39` (`git status` clean apart from untracked editor and shell dotfiles in the worktree root, which are not mine and which I did not touch).
- **Time:** started `Fri Oct 9 23:26:58 UTC 2026`; the end time is in the last section.
- **State:** the changes are **uncommitted**, as the assignment asks.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, exit 0, at the start (`start-and-validate.log`) and again at the end (`end-validate.log`).
- **Approvals:** nothing here grants or touches a business, Finance or IT approval. Nothing touches the product gates G1–G6 or the engineering gates DG0–DG7. All test data is synthetic.

## 1. Summary per repair item

| # | Item | Result |
|---|---|---|
| 1 | `listTransformationReportingPeriods` (ADR-0027 amendment A1; REQ-S07-017; ARCH-R1 item 9) | **Routed and proven.** Removed from `p4-pending-arch-r1.ts`. Exercised in `p4-exercises-kbe-c.ts` |
| 2 | `getAdoptionMetricLink` (ADR-0033 amendment A2; ARCH-R1 item 2) | **Routed and proven.** The `Location` header of `createAdoptionMetricLink` now resolves to 200. Removed from `p4-pending-arch-r1.ts`. Exercised in `p4-exercises-kbe-f.ts` |
| 3 | Plan value `version` (FE-C handback, decision 1) | **Stopped: contract gap.** `BenefitValueLine` declares no `version` and sets `additionalProperties: false` (§5.1). Nothing changed |
| 4 | Formula lineage of source actuals (KBE-R1 handback §5.3) | **Stopped: design gap.** ADR-0027 and ADR-0028 define no field for it (§5.2). No stored shape invented, nothing changed |

`P4_PENDING_ARCH_R1` is now **empty** (2 → 0).

## 2. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/kpi/reporting-periods.ts` | New route `GET /api/v1/transformations/:transformationId/reporting-periods` (`transformation.read`). The organization list's query moved unchanged into `listPeriods(db, organizationId, query)`, which both routes call, so the page, filters, order and cursor are identical by construction |
| `apps/api/src/modules/adoption/indicators.ts` | New route `GET …/adoption-metric-links/:adoptionMetricLinkId` (`transformation.read`, `ETag`), plus the constant `ADOPTION_METRIC_LINK`. `ADOPTION_METRIC_LINK_REMOVE` is now derived from it, with the same path string as before |
| `apps/api/test/support/p4-pending-arch-r1.ts` | Both entries removed; the list is empty |
| `apps/api/test/integration/contract/p4-exercises-kbe-c.ts` | Mirror `listTransformationReportingPeriods: reportingPeriodPage`. Exercise: TL gets 404 on the organization list; TL, KDS (KPI owner) and AUD get 200 with a body equal to the organization page for the same filter; outsider 404; bad filter 400 |
| `apps/api/test/integration/contract/p4-exercises-kbe-f.ts` | Mirror `getAdoptionMetricLink: adoptionMetricLink`. Exercise: the create's `Location` returns 200 with `ETag "1"`; a removed link returns 200 with `status` "removed" and `ETag "2"`; ADM-only and outsider 404; malformed id 400 |
| `apps/api/test/integration/kpi-p4/transformation-periods.test.ts` (new) | 5 integration tests for item 1 (§3.1) |
| `apps/api/test/integration/adoption/metric-link-read.test.ts` (new) | 2 integration tests for item 2 (§3.2) |
| `apps/api/src/modules/kpi/kpi.test.ts` | Pin update: the kpi module now registers one more operation (`KPI_P4_ARCH_R1_OPERATIONS = ["listTransformationReportingPeriods"]`), added to the expected id set and the route count |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-R2-kpi-benefits-engineer.md`, `…/T-DG4-KBE-R2-evidence/*.log` | This handback and its logs |

**Unchanged:**

- `contract.test.ts`, `server.ts`, `kpi/routes.ts` and `adoption/routes.ts`: both new routes live in files that are already registered.
- No migration, no zod schema change (the existing mirrors `reportingPeriodPage` and `adoptionMetricLink` fit), no OpenAPI change, no new problem code.
- The formula engine (S-9).

## 3. Behaviour delivered, per requirement row

### 3.1 REQ-S07-017: item 1, `listTransformationReportingPeriods`

**Acceptance (verbatim):** "A04;A20: a keyboard-only user completes an update in four steps; the confirmation lists affected dashboards and 'Finance review pending' where applicable".

**What this task delivers toward it:** the "select period" step for the people who submit actuals. The route implements the ADR-0027 amendment A1 behaviour. The four-step keyboard flow itself is FE-B's screen; switching its current-period fallback to this list is the FE-B follow-up named in the ARCH-R1 handback §6 item 3. **I do not claim the UI half.**

The ADR's test list, proven in `transformation-periods.test.ts`:

1. **"A TL or KDS granted only on the transformation gets 200 with the same items as an organization reader."** In `seedKpiWorld`, TL and KDS are granted only on the transformation, and the KDS user is the owner of a KPI created by `ownedKpi` (asserted from `kpi_definition.owner_user_id`). Both get **404** on `listReportingPeriods` and **200** on the new list, with every period this file created and only `organizationId` = org A.
2. **Same page, order, filters and cursor.** For four filters (none; `frequency=quarterly`; `frequency=monthly&status=scheduled`; `status=open`), the full list followed through `nextCursor` equals the organization reader's list. It is compared once at `limit=100` and once page by page at `limit=1`. The first page at `limit=1` is byte-equal, including `nextCursor`. The order is latest `periodStart` first. A cursor used with a different filter → 400, as on the organization list.
3. **"An outsider gets 404; AUD gets 200 (read)."** AUD 200. A TO of org B, a user without a grant, and an ADM-only user each get `404 not_found`; an unknown transformation id gets 404 too. The read writes nothing: the audit trail and version of each period this file created are unchanged (scope-local check, F-DG1-110).
4. **"Nothing of another organization is ever returned."** A period of org B is created and never appears.
5. **Validation.** `frequency=hourly`, `status=done`, `limit=0`, unknown parameter `other=1` and a malformed transformation id each → 400.

**"The contract check passes":** `contract.test.ts` is green with the exercise in `p4-exercises-kbe-c.ts` and the operation no longer pending.

**Assignment wording:** the assignment says "a Lead or KPI owner of a transformation lists its reporting periods; AUD read-only; outsiders 404". The Lead is TL and the KPI owner is the KDS owner. "AUD read-only" holds because the operation is a GET with no mutation.

### 3.2 REQ-S16-020 (AdoptionMetricLink): item 2, `getAdoptionMetricLink`

**Acceptance (verbatim):** "A11: the ERD and migrations contain every entity listed (StakeholderGroup, AdoptionIntervention, Training/AssessmentRecord, AdoptionMetricLink) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced".

**What this task adds:** the single-record read of AdoptionMetricLink. The ERD, migrations and the other entities are KBE-F's and BE-H's and are unchanged. `metric-link-read.test.ts` creates a link through the API and reads it through the API, with authorization enforced:

- **Location resolves:** `GET` on the `Location` of `createAdoptionMetricLink` (exactly `${base}/adoption-metric-links/${id}`) → **200**, `ETag "1"`, body equal to the create's body. BO and AUD also get 200.
- **Removed links stay readable:** after `removeAdoptionMetricLink`, the read → 200, `ETag "2"`, body equal to the removal's body, `status` "removed" with `removedBy` and `removedAt` set.
- **Authorization and validation:**
  - ADM-only and outsiders → `404 not_found`.
  - The link's id under another transformation that its TL can read → 404.
  - Unknown id → 404.
  - Malformed id or unknown query parameter → 400.
  - No session → 401.
- **No write:** the read leaves the link's audit trail unchanged.

### 3.3 Shared rules

- **S-2:** the shared `parse` and `parseQuery` parsers; strict query objects.
- **S-3:** both routes are GETs with no request body, so `config.consumes` is not set.
- **S-10:** routed, removed from the pending list and exercised in the same change.
- **S-11:** only `not_found` and the existing validation problems; **no new code**.
- **S-4, S-5, S-13, S-14:** not applicable; both operations are reads.
- **D-107:** no wiring in `server.ts` is needed. Both route files were already registered through `kpi/routes.ts` and `adoption/routes.ts`. Every test above builds the real server through the harness (`startApi()`), with nothing wired by hand.

## 4. Checks run (real exit codes)

The environment is in `docs/delivery/handbacks/DG4/T-DG4-KBE-R2-evidence/`:

- Node 24.21.0, offline.
- Harness port 25000, pool 25001–25049.
- Disposable PostgreSQL 16.13; 60 migrations applied to a fresh database.
- `df -h .` reported 21 GB free before each full run (≥ 3 GB, D-104).
- Empty `.claude/.cc-writes` directories: none found.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | `start-and-validate.log` |
| 2 | `pnpm -r typecheck` | 0 | 7 projects done | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | done | `build.log` |
| 4 | `pnpm lint` | 0 | eslint `--max-warnings=0` clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (first run) | **123** | 3 of my new or edited files were not formatted (`metric-link-read.test.ts`, `transformation-periods.test.ts`, `reporting-periods.ts`). Fixed with `prettier --write` on those 3 files | `prettier-first-run-exit123.log` |
| 5b | same command, re-run after this handback was written | 0 | all files formatted | `prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 647 operations` | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`), first run | **1** | 1 failed of 2342. The pin in `kpi.test.ts` expected the old operation set; received the extra `listTransformationReportingPeriods`. This is an expected pin change, and I updated the pin | `unit-locale-unset-first-run-exit1.log` |
| 7b | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8`, first run | **1** | the same single failure | `unit-c-utf8-first-run-exit1.log` |
| 8 | `pnpm test`, locale unset (after the pin update) | 0 | invocation 1: 122 files, **2342 passed**; invocation 2: 3 files, **259 passed, 2 skipped** (261) | `unit-locale-unset.log` |
| 9 | `pnpm test`, `C.UTF-8` (after the pin update) | 0 | invocation 1: 122 files, **2342 passed**; invocation 2: **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 10 | `QA_PG_PORT=25000 MTH_PORT_POOL=25001-25049 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **163 files, 1594 passed**, 935 s | `integration.log` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` | `end-validate.log` |

**Notes on the checks:**

- **Development run:** before the full runs, a targeted integration run of `transformation-periods.test.ts`, `metric-link-read.test.ts` and `contract.test.ts` passed: 3 files, 52 tests. That output is not kept as a log file.
- **Exit 123 (row 5):** this is `xargs`'s code when one batch fails. The cause is the 3 unformatted files listed in that row, all fixed.
- **No flaky tests or timeouts:** none were seen in the logged runs.

**Count deltas against D-109 (unit 2342 + 259/2, integration 1587):**

- Unit: **unchanged at 2342 + 259/2**. The pin change in `kpi.test.ts` edits an existing test; it adds none.
- Integration: **1587 → 1594 (+7)**: 5 in `transformation-periods.test.ts` and 2 in `metric-link-read.test.ts`. The contract test is still 45 tests; its two P4 KBE exercises now cover the two operations.
- Pinned counts changed: only the kpi module's registered-operation pin (`kpi.test.ts`, +1 operation).

**Media-type pin:** no JSON request body added, so the pin in `contract.test.ts` is unchanged (**delta 0**).

## 5. Contract and design needs for the orchestrator or the architect

### 5.1 Item 3: plan value `version` (contract gap; I stopped as instructed)

`docs/api/openapi.yaml` `components.schemas.BenefitValueLine` has these fields, and only these:

- `required: [periodStart, periodEnd, amount, kpiValue, recordType, recordId, basis]`
- `additionalProperties: false`
- **No `version` property.**

There is also no read operation for a single plan value or a list of them. The only plan-value operations are `createBenefitPlanValue` (POST) and `updateBenefitPlanValue` (PATCH with `If-Match`). `BenefitPlanValue` carries `version`, but only in their responses. A client therefore cannot obtain the current version of an existing plan value. Returning `version` from `getBenefitValues` would break the declared contract (`additionalProperties: false`), so I changed nothing.

**For the architect, one of these options:**

- **(a)** Add an optional or nullable `version` (`Version`) to `BenefitValueLine`: set for `recordType = benefit_plan_value`, and for `benefit_measurement` either set or null, as decided.
- **(b)** Add `GET …/benefit-plan-values/{benefitPlanValueId}` (and/or a list under the benefit) returning `BenefitPlanValue` with its `ETag`.

Either one is a small follow-up in KBE-E's `benefits` files once the contract lands.

### 5.2 Item 4: formula lineage of source actuals (design gap; no shape invented)

- **What ADR-0027 and ADR-0028 define:**
  - the formula inputs as `kpi_formula_input` (`variable_name` → `source_kpi_definition_id`, `input_basis`) (ADR-0027 §2);
  - `kpi_evaluation.inputs` only as a jsonb object (migration `0035`, `CHECK (jsonb_typeof(inputs) = 'object')`);
  - the contract's `KpiEvaluation.inputs` as `{ type: object }` with no properties.
- **What they do not define:** no field names the accepted `kpi_actual` id, value number or source evaluation that fed each variable.
- **The only typed lineage-input shape:** ADR-0024 §6's `{name: {value, kind, unit, currency, period, source}}`. It belongs to `benefit_calculation`, not to `kpi_evaluation`.
- **What the worker stores today:** for a formula KPI, `{formula, values: {var: value}}` (`apps/worker/src/handlers/kpi.ts`).

**Requested from the architect:** an ADR-0027/0028 amendment fixing the shape. For example: per variable, `sourceKpiDefinitionId`, `sourceEvaluationId` and/or `kpiActualId` + `valueNo` + `kpiVersionId`, and the contract property for it on `KpiEvaluation.inputs`. Then a kpi-benefits-engineer task can write it in the run, and `loadKpiStatusLineage` can expose it. REQ-S08-006's "drills to … input actual versions" depends on this for formula KPIs.

### 5.3 Other needs

- **Migrations:** none (no schema change).
- **New problem codes:** none.
- **`server.ts`:** no wiring needed.

## 6. Merge instructions

- **Conflicts to expect:**
  - `kpi.test.ts`: the pin block only.
  - `p4-exercises-kbe-c.ts` and `p4-exercises-kbe-f.ts`: an appended section and one mirror line each.
  - Concurrent W13 tasks (BE-R2, BE-F2, BE-M2) do not own these files.
  - `contract.test.ts` is untouched.
- **After the merge:** `P4_PENDING_ARCH_R1` is empty, so the P4 aggregate pending list loses 2 operations.
- **FE-B follow-up:** replace the current-period fallback with `listTransformationReportingPeriods` (ARCH-R1 handback §6 item 3).

## 7. What remains

- **Item 3:** blocked on the contract decision in §5.1 (architect).
- **Item 4:** blocked on the ADR-0027/0028 lineage-shape decision in §5.2 (architect).
- **Items 1 and 2:** complete. No separable second half is pending.
- **End time:** `Sat Oct 10 00:09:54 UTC 2026` (`date -u`, first line of `end-validate.log`), about 43 minutes after the start.
