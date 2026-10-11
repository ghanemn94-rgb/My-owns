# Handback T-DG4-KBE-R8 (kpi-benefits-engineer): DG4 dashboard units and outcomes (D-124 items 1–3, D-125)

## Run details

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-KBE-R8-kpi-benefits-engineer-20261011T181043Z-0a718cd5","session_id":"0a718cd5-2341-40b4-9748-de6abba45b1b"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-R8.md`. I verified its sha256 (`83a64a31…8171f6`) before reading it.
- **Base:** `HEAD` `fba6e02c047e2e294d710d69093ff16635097fc9`, branch `dg4/kbe-r8`. ARCH-R7 is merged in this base (`65f1d09`).
- **Timing:** started `Sun Oct 11 18:10:56 UTC 2026` and ended `Sun Oct 11 19:50:55 UTC 2026` (`date -u` both times).
- **Changes:** all left **uncommitted**, as the assignment asks.
- **Ports:** only 26100–26149 were used:
  - 26100–26109: the new test before and after, the contract project and its mutation, and the affected files;
  - 26110–26119: the A/B transcripts;
  - 26120–26149: the full integration runs.
- **Disk:** `df -h .` before every full run showed 20 GB free (well above the 3 GB stop line, D-104).
- **Logs:** every log was written to `$TMPDIR` during the runs, and copied to `T-DG4-KBE-R8-evidence/` only after the last test run.
- **Not an approval.** I am an engineering agent, so nothing here is a business, Finance or IT approval. A trajectory or Finance approval in a test is a synthetic in-product approval of synthetic data. Product gates G1–G6 are not touched, and DG7 is not implied.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` ran before any write: `PASS gate DG3 (historical)`, **exit 0** (`evidence/00-validate-dg3-start.log`). It ran again at the end with the same result (§3, check 9).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/kpi/dashboard-facts.ts` | **D-124 item 1:** `loadOutcomeRows` reads non-archived outcomes (`status <> 'archived'`). **N5:** `KpiDashboardStatus` gains `unitKind` (`def.unit_kind`) and `unitLabel` (`def.unit_label?.trim() \|\| null`) in `fromPanel` and `noPeriod`. `unit` is unchanged |
| `apps/api/src/modules/reporting/dashboards/areas.ts` | **N5:** `KpiStatusFact` gains `unitKind` / `unitLabel`. `kpiActualValue` sets `kpiUnit = unitKind === null ? null : {kind, label}` in all three branches (known/zero, stale, unknown). `knownValue`, `unknownValue` and `notApplicableValue` set `kpiUnit: null`, and so do `countValue`, `sumValue`, `gapValue` and every spread through them |
| `apps/api/src/modules/reporting/dashboards/engine.ts` | **N5 item 1:** `missingStatus` sets `unitKind: null` and `unitLabel: null`. The unreadable KPI's value has `kpiUnit` null |
| `docs/api/openapi.yaml` | **Closing step**, ARCH-R7 §4.1 item 5 (1)–(3), wording exactly as given. Nothing else changed |
| `packages/shared/src/schemas/dashboards.ts` | **Closing step** (4): `kpiUnit: dashboardKpiUnit.nullable()` and the doc sentence. Nothing else changed |
| `apps/api/test/support/p4-pending-arch-r7.ts` | **Closing step** (5): `P4_PENDING_ARCH_R7_MEMBERS` emptied, with a removal note |
| `apps/api/test/integration/reporting/kpi-unit-outcomes.test.ts` | **new**: D-124 items 1–3 on the real API (9 tests; §2) |
| `apps/api/src/modules/reporting/dashboards/areas.test.ts` | The new N5 unit tests (7: F1–F4, Stale/Unknown/zero, currency KPI and unreadable KPI, non-KPI builders), the fixture's `unitKind`/`unitLabel`, and 4 pinned values (§4) |
| `apps/api/src/modules/reporting/dashboards/finance.test.ts`, `n4-value-basis.test.ts` | Pinned values gain `kpiUnit: null` (§4) |
| `apps/api/test/integration/reporting/{drilldown,finance-adoption,finance-drilldown-k1,headline-basis,value-basis-n4}.test.ts` | Pinned values gain `kpiUnit: null` (§4) |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-R8-kpi-benefits-engineer.md`, `…-evidence/**` | This handback, the logs, the A/B transcripts and the web fixture patch for FE-R7 |

Not touched: `apps/web/**` (FE-R7's), `tools/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`. No operation, migration or code-table row was added.

## 2. Behaviour delivered

### 2.1 D-124 item 1: outcomes on the dashboards

- **The change:** `loadOutcomeRows` now filters `status <> 'archived'`, as `charter.ts`, `criteria.ts`, `portfolio/hierarchy.ts`, `change-requests.ts`, `workflows/impact.ts`, `missing-links-facts.ts` and the G2 good-outcome test already do. The outcome KPI rows keep `status = 'active'`: an `outcome_kpi` row is created `active` (default) and archived through its own route, so that filter is right.
- **The test is API-only** (`kpi-unit-outcomes.test.ts`):
  - Its world (`apiOnlyWorld`) is `dashboardWorld` **without** its directly inserted active outcome.
  - The outcome is created through `POST /outcomes` (TL). The test asserts that it comes back `draft`.
  - Its five KPI links go through `POST /outcome-kpis`, and the actuals through the direct-accept submit route plus the worker's recalculation consumer.
  - The second outcome is created, linked and archived through `POST /outcomes/{id}/archive`.
  - The test asserts that the audit trail's `outcome.create` events are exactly these two ids.
  - Not created through the API: the initiative of the Portfolio check and the adoption metric link (both are existing direct-write fixtures, and neither is an outcome or its status).
- **What it asserts:**
  - The T10 Outcomes area lists the outcome and its five KPI rows with their actuals, and the count headline is 5.
  - The Executive Overview shows them.
  - The `outcomes.area` drill-down lists the KPI rows, and `outcomes.kpi_status` answers 200 with the actual.
  - The archived outcome and its KPI row are **absent** from all of them.
- **Before / after:**
  - Before (the original source, restored by copying the HEAD files over the changed ones and then back; `evidence/01-new-test-before.log`): **9 failed (9)**. The item 1 tests fail with `expected [] to include '<outcome id>'`, and the `outcomes.kpi_status` drill-down answers **404**.
  - After (`evidence/02-new-test-after.log`): **9 passed (9)**.
- **Every other P4 reader of `outcome.status = 'active'`** (search: `grep` for `"active"` / `'active'` / `o.status` over `apps/api/src`, then each query on table `outcome` read):

  | Reader | Filter on `outcome` | Verdict |
  |---|---|---|
  | `kpi/dashboard-facts.ts` `loadOutcomeRows` (T10, workstream, Overview, the adoption dashboard's area, the drill-downs, the header's `outcomeHealth`) | `= 'active'` | **Same defect: changed** |
  | `transformations/charter.ts`, `workflows/criteria.ts`, `workflows/change-requests.ts`, `workflows/impact.ts` (×2), `transformations/good-outcome.ts`, `transformations/missing-links-facts.ts`, `portfolio/hierarchy.ts` | `<> 'archived'` | Already correct |
  | `reporting/traceability.ts` (chain records) | `shown/linkable = status !== 'archived'` | Already correct |
  | `kpi/repository.ts` `referenceStatus` | none; returns the status; callers refuse `archived` | Already correct |
  | `reporting/impact.ts:213`, `good-outcome.ts:178`, `kpi/gate-facts.ts`, `adoption/dashboard-facts.ts:38` | `= 'active'` on `outcome_kpi` or `adoption_metric_link`, not on `outcome` | Not the defect |
  | `reporting/workspace-header.ts:107` | counts the dashboard's outcome rows by RAG status | Uses `loadOutcomeRows`; fixed through it |

### 2.2 D-124 items 2–3: `DashboardValue.kpiUnit` (ADR-0037 N5)

- **Emitters** (the ARCH-R7 handback §4.1 items 1–4, the ADR-0037 N5 classification table):
  - `kpiActualValue` gives `{kind, label}` in every state. It reaches the T10 / workstream / Overview / adoption `outcome_kpi` and `adoption_metric_link` items, `AdoptionIndicatorRow.value`, and the drill-downs `outcomes.area` (items), `outcomes.kpi_status` (value, the `kpi_actual` and `kpi_evaluation` items, the `actual` input) and `adoption.indicators` (items).
  - Every other value, built through `knownValue` / `unknownValue` / `notApplicableValue` (money, counts, the value gap), has `kpiUnit: null`. So do `drilldown.ts` `oneCurrency` / `noRecord`, `finance.ts`, and the header's `CurrencyValue.value`.
  - With `kpiUnit` required in the zod type, `tsc` confirms that no API `DashboardValue` misses the key (`apps/api typecheck: Done`).
- **`unit` is unchanged** (`label ?? kind`), as N5 item 3 asks.
- **The ARCH-R7 §4.3 fixtures on the real API** (`kpi-unit-outcomes.test.ts`, `toStrictEqual` on the exact objects):
  - **F1** (`percentage`, no label, 0.12) `{state: "value", value: "0.12", unit: "percentage", currency: null, reasonKey: null, kpiUnit: {kind: "percentage", label: null}}`;
  - **F2** (label '% of users') `{…, unit: "% of users", kpiUnit: {kind: "percentage", label: "% of users"}}`;
  - **F3** (`ratio` 1.5) `{…, value: "1.5", unit: "ratio", kpiUnit: {kind: "ratio", label: null}}`.
  - F1–F3 are checked on the T10 Outcomes items, the Executive Overview and the `outcomes.area` drill-down, and on `outcomes.kpi_status`'s value, its `kpi_actual` item and its `actual` input.
  - **F2** is also the adoption dashboard's `AdoptionIndicatorRow.value` and the T10 People & adoption `adoption_metric_link` item.
  - **Stale:** F2 with `state: "stale"`, `reasonKey: "kpi.stale"`, the same `kpiUnit`. **Unknown:** a `ratio` KPI with no actual, `value: null`, `kpi.no_accepted_actual`, `kpiUnit: {kind: "ratio", label: null}`.
  - **F4**, the value gap (planned 70 margin, nothing validated), is `{state: "value", value: "1", unit: "ratio", currency: "SAR", reasonKey: null, kpiUnit: null}`. Its drill-down value has `kpiUnit: null`. The money headlines are `unit: "currency"` with `kpiUnit: null`. Every Finance-dashboard and workspace-header value has `kpiUnit: null`.
  - A Portfolio item and the Dependencies / Decisions count headlines have `kpiUnit: null`.
  - A walker over every `DashboardValue` of T10, the Overview, `outcomes.kpi_status`, Finance, adoption and the header asserts that each has the key, and that each `kpiUnit: null` value carries a non-KPI unit (`currency`, `ratio`, a count noun) or none.
- **Unit tests** (`areas.test.ts`, 7 new): the same F1–F4, Stale / Unknown / zero, a `currency` KPI (keeps `currency: "SAR"` and kind `currency`), the unreadable KPI (`kpiUnit` null, `kpi.no_active_version`), and `kpiUnit: null` from `knownValue`, `unknownValue`, `notApplicableValue`, `countValue` and `sumValue`.

### 2.3 The closing step (D-124, D-125; ARCH-R7 handback §4.1 item 5)

The pending list is empty, and the step is applied exactly. `git diff` of the two contract files (every changed line):
```
openapi.yaml
-    N5). The member is declared but not yet required: pending in `p4-pending-arch-r7.ts` until the API emits it.
+    N5). The member is required since the API emits it (T-DG4-KBE-R8).
-      required: [state, value, unit, currency, reasonKey]
+      required: [state, value, unit, currency, reasonKey, kpiUnit]
-        kpiUnit: { …, description: "… Not yet required: pending in p4-pending-arch-r7.ts." }
+        kpiUnit: { …, description: "… Required since the API emits it (T-DG4-KBE-R8)." }
dashboards.ts
- * `.optional()` until T-DG4-KBE-R8 emits it (pending in apps/api/test/support/p4-pending-arch-r7.ts).
+ * required: the API emits it (T-DG4-KBE-R8).          (the sentence reads "`kpiUnit` is required: the API emits it (T-DG4-KBE-R8).")
-  kpiUnit: dashboardKpiUnit.nullable().optional(),
+  kpiUnit: dashboardKpiUnit.nullable(),
```
- `DashboardKpiUnit.required` stays `[kind, label]`.
- `p4-pending-arch-r7.ts`: `P4_PENDING_ARCH_R7_MEMBERS` is `[]`, with a removal note in KBE-R7's form. `P4_PENDING_ARCH_R7` was already `[]`.
- **The contract test fails without the member.** I made a temporary local mutation: `knownValue` no longer emits `kpiUnit`. It was reverted, and `cmp` confirmed the file matched again.
  - With the mutation (`evidence/04-contract-mutation.log`): **exit 1**, `Tests 2 failed | 44 passed (46)`, "contract: getTransformationDashboard 200 body violates the schema: data/areas/0/headlines/0/value must have required property 'kpiUnit', …".
  - With the member (`evidence/03-contract-after.log`): **exit 0**, `46 passed (46)`.

### 2.4 Byte stability (response-transcript method; `evidence/ab/`)

**Method:**
- **A** is this worktree at `fba6e02` with **no source change**. It holds only the new test file, which the transcript run does not execute. **B** is the final source tree.
- `ab/kbe-r8-transcript.test.ts` is KBE-R7's transcript test unchanged (533 requests), plus one appended world **K8**:
  - `dashboardWorld`'s active outcome, an API draft outcome, and an API-archived outcome;
  - `percentage` (no label, '% of users'), `ratio`, Stale and Unknown KPIs linked through the API, and an adoption link.
- K8's requests: T10, summary, the Overview and adoption narrowed to K8, `outcomes.area`, `adoption.indicators`, `outcomes.kpi_status` per outcome KPI, and the org Overview again. That makes **546 requests** in both A and B. A exits 0; B exits 0.
- **Comparison:** `summary-r8.py`.
  - The id placeholders are numbered over the whole transcript. B lists the draft outcome's ids, which A does not, so the numbers drift. Each response is therefore compared with its ids renumbered per response.
  - KBE-R7's `compare.py` (copied unchanged) stops at response 35 on that drift.

**Result (`ab/summary.txt` line 1):** 546 responses.
- **30 byte-identical**, 29 even without the renumbering.
- **501 differ ONLY by `kpiUnit: null`** on their DashboardValues.
- **6 differ only by `kpiUnit`**, at least one non-null.
- **9 carry other changes**, all D-124 item 1. In each, the only addition is the API draft outcome and its two KPI rows. **No item is removed** anywhere (`items[-]` count 0):
  - the org Overview (#32, #545), T10 K8 (#533) and the Overview narrowed to K8 (#535): `outcomeCount` +1, `kpiCount` +2, the `outcomes.area` headline 3 → 5, +3 items;
  - the `outcomes.area` drill-downs (#246, #537): +2 items;
  - the header (#534): `outcomeHealth.rag.ruleParams.outcomeCount` / `kpiCount` and `counts[unknown].count` 1 → 2;
  - `outcomes.kpi_status` for the draft outcome's two KPI rows (#539, #540): 404 → 200.
- **Also in line 2:** the A transcript never mentions `kpiUnit`, and B has 0 DashboardValues without the key.
- **Every non-null `kpiUnit` in B** is listed with its path. All of them are KPI-actual values (`outcome_kpi` / `adoption_metric_link` items, `AdoptionIndicatorRow`, and the KPI drill-downs' values, items and inputs), with `unit` unchanged.

**Changed members, listed:**
- `DashboardValue.kpiUnit` (added) everywhere a `DashboardValue` is sent: `T10Area.headlines[].value`, `DashboardItem.value`, `DrilldownItem.value`, `DrilldownInput.value`, `DashboardDrilldown.value`, `FinanceValueLine` totals, `AdoptionIndicatorRow.value` and `CurrencyValue.value`;
- **D-124 item 1** (only where a non-archived, non-active outcome exists):
  - `T10Area.items` (Outcomes);
  - `T10Area.headlines[outcomes.area].value.value`;
  - `DashboardRag.ruleParams.outcomeCount` / `kpiCount` (Outcomes, and the header's `outcomeHealth.rag`);
  - `WorkspaceHeader.outcomeHealth.counts`;
  - `DashboardDrilldown.items` / `.value` of `outcomes.area`;
  - the `outcomes.kpi_status` status 404 → 200 for such an outcome's KPI rows.
- **Not seen in this transcript:** a draft outcome can also change the Outcomes area's `rag` and the Overview's `areaStatuses[outcomes]` (in K8 the outcome is `unknown` either way).

## 3. Checks actually run

**Environment:** this worktree, Linux sandbox, Node 24.21.0, offline, and PostgreSQL through `tests/qa/support/with-pg.sh` on ports 26100–26149. Empty `.claude/.cc-writes` directories under `apps/web/src/pages/dashboards/` and `apps/api/src/modules/reporting/dashboards/` were removed before the full runs.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `pnpm -r typecheck` | **exit 2: fails in `apps/web` only.** There are 10 errors in FE-owned files (§5), the consequence ARCH-R7 §4.1 item 5 warned of. With `--no-bail`: design-tokens, shared, config, db, worker and api are `Done`; web is `Failed`. **With the verified web patch applied temporarily: exit 0** | `10-typecheck.log`, `10b-typecheck-no-bail.log`, `15-typecheck-with-web-patch.log` |
| 2 | `pnpm -r build` | **exit 2: fails in `apps/web` only** (the same tsc errors). With `--no-bail`, every other package is `Done`. **With the web patch: exit 0** | `11-build.log`, `11b-build-no-bail.log`, `16-build-with-web-patch.log` |
| 3 | `pnpm lint` | **exit 0** | `12-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0**: "All matched files use Prettier code style!" in all 11 batches. The only other lines are npm's config warnings | `13-prettier.log` |
| 5 | `pnpm openapi:lint` | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations` | `14-openapi-lint.log` |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LANGUAGE`) | **exit 0**: unit-node + unit-web `149 files, 2859 passed (2859)`; unit-formula-nocodegen `3 files, 259 passed \| 2 skipped (261)` | `20-test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0**: the same counts, 2859 and 259 + 2 skipped | `21-test-c-utf8.log` |
| 8 | `QA_PG_PORT=26120 MTH_PORT_POOL=26121-26149 tests/qa/support/with-pg.sh pnpm test:integration` | **Final run: exit 0**, `Test Files 208 passed (208)`, `Tests 1975 passed (1975)` (19:11–19:31Z). The first run was **exit 1**, 6 failed / 1969 passed, all of them pinned literals (§4). They were fixed before the final run | `32-integration-final.log`, `30a-integration-run1-6-failed.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG3` | **exit 0**, `PASS gate DG3 (historical)`, at the start and at the end | `00-validate-dg3-start.log`, `40-validate-dg3-end.log` |
| 10 | The new test before / after (`--project integration …/kpi-unit-outcomes.test.ts`) | before **exit 1**, 9 failed (9); after **exit 0**, 9 passed (9) | `01-new-test-before.log`, `02-new-test-after.log` |
| 11 | The contract project (`…/contract/`) with the member / with the temporary mutation | **exit 0**, 46/46 / **exit 1**, 2 failed \| 44 passed | `03-contract-after.log`, `04-contract-mutation.log` |
| 12 | The API unit tests (`--project unit-node apps/api/src/modules/reporting apps/api/src/modules/kpi`) after the source change, before / after updating the pins | **exit 1**, 10 failed \| 170 passed / **exit 0**, 180 passed | `05a-…`, `05b-…` |
| 13 | The 6 affected integration files after the pin update | **exit 0**, 6 files / 48 tests | `31-affected-after.log` |
| 14 | The web dashboards tests with the web patch applied temporarily (`--project unit-web apps/web/src/pages/dashboards`) | **exit 0**, 4 files / 76 tests | `17-web-dashboards-with-patch.log` |
| 15 | The A/B transcripts (§2.4) | A **exit 0** (1 passed), B **exit 0** (1 passed), 546 requests each | `ab/ab-run-A.log`, `ab/ab-run-B.log`, `ab/summary.txt` |

**Disclosed non-zero exits and retries (none hidden):**
- **`01a-new-test-before-first-draft.log`** is the first draft of the new test, run on the unchanged source: exit 1, 9 failed.
  - One of its failures was a fixture error, not the defect: the initiative code `INI-R8` violates `initiative_code_check`. The code became `INI-88`.
  - The workspace-header URL was also corrected (`/summary`).
  - The authoritative "before" run is `01-…`: the final test file, with the three source files temporarily replaced by their HEAD content and then restored.
- **A first attempt to revert with `git checkout`** failed with "Read-only file system" on the worktree's `.git` index lock, so nothing was reverted. That run (9 passed, on the changed source) is **not** used as a "before" result, and its log was overwritten by the real "before" run. The same goes for `git apply` of the source patch, which reported "patch does not apply" because the changes were still in place.
- **The A transcript's first attempt** failed in its own fixture (409 duplicate KPI name) before recording anything. It was fixed and re-run from scratch (`ab/ab-commands.txt`).
- **The new test's first post-change run:** exit 1, 1 failed (the header has no value in a world without benefits). The header assertion was moved to the benefit world, then the run was 9/9.
- **The typecheck and build exits of 2** are the web fixtures (§5). They are not flaky, and they are expected until FE-R7's fixtures are merged.
- **No flaky test was observed.**

## 4. Tests that pinned the changed behaviour (old → new)

Every one adds the member, and nothing else changes. "Input" marks a literal passed into a builder, which the required type now demands.

| File:test | Old | New |
|---|---|---|
| `areas.test.ts` fixture `kpi()` (input) | no unit kind | `unitKind: "count", unitLabel: null` |
| `areas.test.ts` "a KPI below trajectory … no actual is unknown" `kpiActualValue(none)` | `{unknown, null, "count", null, "kpi.no_accepted_actual"}` | `+ kpiUnit: {kind: "count", label: null}` |
| `areas.test.ts` "a validated total of nothing is a known zero" | `{zero, "0", currency, SAR, null}` | `+ kpiUnit: null` |
| `areas.test.ts` "DOM-GROSS …" `c.planned` | `{value, "90", currency, SAR, null}` | `+ kpiUnit: null` |
| `areas.test.ts` "variant A …" `na` | `{not_applicable, null, currency, SAR, no_profit_and_cash_benefit}` | `+ kpiUnit: null` |
| `finance.test.ts` "a missing amount makes the total Unknown" | `{unknown, null, currency, SAR, benefit.value_amount_missing}` | `+ kpiUnit: null` |
| `finance.test.ts` "an Unknown cost makes net Unknown" (result; and inputs `known()`, `unknownCost`) | `{unknown, null, currency, SAR, benefit.cost_amount_missing}` | `+ kpiUnit: null` |
| `n4-value-basis.test.ts` "probe GC" `usd.planned` | `{not_applicable, null, currency, USD, no_profit_and_cash_benefit}` | `+ kpiUnit: null` |
| `n4-value-basis.test.ts` "gapValue: …" (3 objects) | `{value, "0.25", ratio, SAR, null}`, `{unknown, …, benefit.value_amount_missing}`, `{not_applicable, …, nothing_planned}` | each `+ kpiUnit: null` |
| `n4-value-basis.test.ts` property test `sum()` (input, 2 objects) | no member | `+ kpiUnit: null` |
| `n4-value-basis.test.ts` "the ranking world" (3 objects) | `{not_applicable …}`, `{value, "70" …}`, `{unknown …}` | each `+ kpiUnit: null` |
| `n4-value-basis.test.ts` "D-123 item 3" `x` | `{unknown, null, currency, SAR, benefit.value_amount_missing}` | `+ kpiUnit: null` |
| `drilldown.test.ts` "REQ-S13-003 …" (2 objects) | `{zero, "0", currency, SAR, null}`, `{not_applicable, …, no_financial_benefit}` | each `+ kpiUnit: null` |
| `finance-adoption.test.ts` "only a non-financial benefit" | `{not_applicable, null, currency, null, no_financial_benefit}` | `+ kpiUnit: null` |
| `finance-drilldown-k1.test.ts` "Unknown, never 0 …" | `{not_applicable, null, currency, null, no_financial_benefit}` | `+ kpiUnit: null` |
| `headline-basis.test.ts` "F-DG4-105 (probe GC)" `usdNa`; the `no_benefit_in_class` object | `{not_applicable, null, currency, USD, …}` ×2 | each `+ kpiUnit: null` |
| `value-basis-n4.test.ts` "DOM-GROSS allocated 100 %" | `{value, "90", currency, SAR, null}` | `+ kpiUnit: null` |
| `value-basis-n4.test.ts` "D-123 item 3 …" | `{unknown, null, currency, SAR, benefit.value_amount_missing}` | `+ kpiUnit: null` |

**Integration count:**
- The first full run (`evidence/30a-integration-run1-6-failed.log`) was **exit 1**, `Tests 6 failed | 1969 passed (1975)`. The 6 failures were exactly these pinned literals (one per test: `drilldown`, `finance-adoption`, `finance-drilldown-k1`, `headline-basis`, and `value-basis-n4` ×2).
- I then scanned every test file for value literals without `kpiUnit`. That found 8 literals, including 2 behind the first failing assertion. All 8 were updated, and the affected files pass (`evidence/31-affected-after.log`, 6 files / 48 tests).
- **Pinned count:** 1975, against KBE-R7's reported 1966. The +9 are the new `kpi-unit-outcomes.test.ts`'s 9 tests.
- No test relied on draft outcomes being hidden. No item 1 change broke an existing test.

## 5. The web fixtures (assignment item 4)

- **The closing step breaks the web typecheck and build in this tree.** As ARCH-R7 §4.1 item 5 warned (D-121), there are 10 TS2741 / TS2345 / TS2322 errors in FE-owned files:
  - `dashboardFixtures.ts` ×7;
  - `DashboardsPage.tsx:372` (the Finance non-financial n/a);
  - `ui.tsx:555` (`ValueRagLines`);
  - `percentKpi.test.tsx:22`.
- `apps/web/**` is FE-R7's, so I did not change it.
- **The verified patch:** `evidence/web-fixture-patch.diff` (sha256 `4b9beb28…8f68`, 117 lines).
  - It adds `kpiUnit` to each literal: null on money, counts, gaps and n/a. On the KPI fixtures it adds `{kind: "percentage", label: "%"}` (`staleV`, `API_PERCENT_SIGN`) and `{kind: "percentage", label: null}` (`API_PERCENTAGE`).
  - **Applied temporarily:** `pnpm -r typecheck` and `pnpm -r build` exit 0 (`evidence/15-typecheck-with-web-patch.log`, `16-build-with-web-patch.log`), and the web dashboards tests pass 76/76 (`evidence/17-web-dashboards-with-patch.log`).
  - The FE files were then restored byte for byte. `git apply --check` passes on the restored tree.
- **For the orchestrator:** merge FE-R7 first, or apply the patch if FE-R7's fixtures don't already cover these literals. Then check `pnpm -r typecheck` on the merged tree.

## 6. Operations routed (delta to my pending list)

- **No operation added or moved:** still 652. `P4_PENDING_ARCH_R7` was `[]` and stays `[]`.
- **Member delta:** `P4_PENDING_ARCH_R7_MEMBERS` loses `DashboardValue.kpiUnit` (7 operations, zod `dashboardValue`). It is now `[]`.
- **The exercises:** the existing `p4-exercises-kbe-g.ts` already covers all seven operations through `ctx.mirrored` with the zod mirrors. They now validate the required member, and the contract project passes 46/46. No exercise file needed a change.

## 7. Contract or schema needs, for the orchestrator

- None beyond the closing step.
- **Observations for the round-4 reviewers, not changed by me:**
  1. `kpi_evaluation` drill-down items carry the KPI's `kpiUnit`, as N5's table lists ("the `kpi_actual` and `kpi_evaluation` items").
  2. With item 1, the header's `outcomeHealth` and the Outcomes RAG now include draft outcomes. That is consistent with D-124's "every other reader treats a non-archived outcome as live".

## 8. What remains

- **The web typecheck and build are red in this tree** until FE-R7's fixtures (or `evidence/web-fixture-patch.diff`) are merged. That is FE-R7's scope (§5). After the merge, the orchestrator should run `pnpm -r typecheck` and `pnpm -r build` on the merged tree.
- **The web formatting by `kpiUnit.kind`** (D-124 items 2–3 on screen) is FE-R7's. Until it lands, the dashboards still show the defects visually ('150 %', '0.12 % of users'), although the API now sends what is needed.
- **Not run:** e2e (not in this assignment's acceptance list, and FE-R7 owns it).
- Nothing else in my scope remains.

## 9. Merge instructions

- **No migration.** After merging, rebuild `@mth/shared` (`pnpm --filter @mth/shared build`).
- **Order:** merge FE-R7 (its fixtures) before or together with this change, or apply `evidence/web-fixture-patch.diff`. Then check `pnpm -r typecheck` and `pnpm -r build`.
- **Conflicts:**
  - none expected in `apps/api` or `packages/shared`;
  - `openapi.yaml`: three single-line edits;
  - the five integration tests: single-line additions.
