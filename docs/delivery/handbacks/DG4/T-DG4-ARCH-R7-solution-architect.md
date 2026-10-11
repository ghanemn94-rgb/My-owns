# Handback T-DG4-ARCH-R7 (solution-architect): the KPI unit kind on dashboard values (D-124 items 2 and 3)

## Run details

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-R7-solution-architect-20261011T174752Z-9c39003e","session_id":"9c39003e-b06a-4529-87c1-2c71e7ab89d7"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-R7.md`. I verified its sha256 `d10972bb…dc6c0e` before reading it.
- **Base:** `HEAD` `8612d7e5b508453fe1492133cdd2559e7f17879f`, branch `dg4/arch-r7`.
- **Timing:** started 2026-10-11T17:48:03Z and ended 2026-10-11T18:03:34Z (`date -u` both times), inside the 45-minute estimate.
- **Changes:** all left **uncommitted**, as the assignment asks.
- **Ports:** only the harness ports 23700–23749 were used (PostgreSQL on 23700, pool 23701–23749).
- **Not an approval.** I am an engineering agent, so nothing here is a business, Finance or IT approval. Product gates G1–G6 are not touched, and DG7 is not implied.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` ran before any write:
```
PASS gate DG3 (historical)
EXIT=0
```
It ran again at the end with the same result (§3, check 6).

## 1. Changed files, with every changed line and its reason

### 1.1 Files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0037-p4-dashboards-t10-my-work-overview-header.md` | Amendment **N5** (dated 2026-10-11): D-124 items 1–4 as decided, the member, the four value kinds, examples, contract, owners, codes, alternatives |
| `docs/api/openapi.yaml` | New schema `DashboardKpiUnit`, new member `DashboardValue.kpiUnit` (not required), and the meaning-change descriptions |
| `packages/shared/src/schemas/dashboards.ts` | zod mirrors: `dashboardKpiUnit`, and `dashboardValue.kpiUnit` (`.nullable().optional()`) |
| `apps/api/test/support/p4-pending-arch-r7.ts` | **new**: the pending member (the ARCH-R5/R6 pattern), with the closing step spelled out |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R7-evidence/codes-table.md` | **new**: the code-table record. There are no new codes. It also proposes the existing EN/AR unit-kind texts for FE |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R7-solution-architect.md` | this handback |

`git diff --stat` against the base: `openapi.yaml` +17/−2 (21 lines touched), ADR-0037 +92, `dashboards.ts` +18/−2 (20 lines touched). The new files are untracked. Nothing else changed (§3, check 7).

### 1.2 `docs/api/openapi.yaml`: every hunk

Line numbers are in the new file. Its sha256 is `6841e260…257519`.

| New lines | What changed | Reason |
|---|---|---|
| 150–157 | `info.description`: a new paragraph, "P4 repairs (T-DG4-ARCH-R7 …)". It names the additive schema and member, says the member is not yet required (pending in `p4-pending-arch-r7.ts`), states the meaning change of `unit`, and says that no operation, status, parameter or refusal changes. | Record of the change (the ARCH-R5/R6 pattern) |
| 28149 | `DashboardValue.description`: adds the four value kinds (KPI-derived, money, computed ratio, count), how to read each from `kpiUnit` and `unit`, and where the API sends KPI-derived values. Also: "formatted from kpiUnit.kind exactly as the KPI pages do, never from unit or the label". | **Meaning change**, N5 items 1–3 and the classification |
| 28155 | `DashboardValue.unit`: gains a description. For a non-KPI value it is the unit (currency, ratio or the count noun). For a KPI-derived value it is display text only (content unchanged), and it never decides the scaling. | **Meaning change**, N5 item 3. The type is unchanged |
| 28158 | **new** `DashboardValue.kpiUnit`: `DashboardKpiUnit` or null. It is **not** in `required`, and its description ends "Not yet required: pending in p4-pending-arch-r7.ts." | N5 item 1 |
| 28159–28166 | **new** schema `DashboardKpiUnit`: `required: [kind, label]`, `additionalProperties: false`. `kind` is the KPI unit-kind enum (the same seven values as `KpiDefinition.unitKind`). `label` is string or null, `minLength: 1`, `maxLength: 50` (as `KpiDefinition.unitLabel`), trimmed, null when blank. | N5 item 1 |

**What did not change:**
- No `required` list changed.
- No operation was added: still **652**.
- No status, enum value, parameter or refusal changed.
- `info.version` stays `1.3.0-p4`.

### 1.3 `packages/shared/src/schemas/dashboards.ts`

The new file's sha256 is `49dc63d8…952b0`.

| New lines | What changed | Reason |
|---|---|---|
| 17 | The import from `./kpi.ts` adds `kpiUnitKind` | Reuses the one KPI unit-kind enum (`KPI_UNIT_KINDS`), so the two can't drift apart |
| 99–108 | **new** `dashboardKpiUnit = z.strictObject({kind: kpiUnitKind, label: z.string().min(1).max(50).nullable()})` and `type DashboardKpiUnit`, with a doc comment | Mirror of `DashboardKpiUnit` |
| 110–114 | The `dashboardValue` doc comment: the classification, and "`kpiUnit` is `.optional()` until T-DG4-KBE-R8 emits it (pending in apps/api/test/support/p4-pending-arch-r7.ts)." | Pending-member record. The closing step edits this sentence |
| 124 | `kpiUnit: dashboardKpiUnit.nullable().optional()` | Mirror of `DashboardValue.kpiUnit` |

### 1.4 `apps/api/test/support/p4-pending-arch-r7.ts` (new; sha256 `47a488c3…34b50ba1`)

- `P4_PENDING_ARCH_R7` is `[]`: no operation was added, and like ARCH-R5's and ARCH-R6's file it is not imported by `p4-pending.ts`.
- `P4_PENDING_ARCH_R7_MEMBERS` holds one entry:
  - `DashboardValue.kpiUnit`, on `getTransformationDashboard`, `getWorkstreamDashboard`, `getExecutiveOverview`, `getAdoptionDashboard`, `getFinanceDashboard`, `getDashboardDrilldown` and `getWorkspaceHeader`;
  - zod `dashboardValue`.

  These are the seven operations whose responses embed a `DashboardValue`. I traced them through `DashboardHeadline`, `DashboardItem`, `FinanceValueLine`, `AdoptionIndicatorRow`, `DrilldownItem`, `DrilldownInput`, `DashboardDrilldown` and `CurrencyValue`. `getMyWork` embeds none.
- **The closing step** is written out in the file's header (also in §4.1 item 5).

### 1.5 The ADR

ADR-0037 is changed by appending only: 92 lines after the old line 621 (the amendment starts at line 623). Nothing earlier is edited. The amendment:
- states D-124 items 1–4;
- names what it supersedes: only §5's `unit`, and only for a KPI-derived value. N4 item 1's gap value is explicitly unchanged.

ADR-0028 is not amended: its §3 fraction rule is cited and unchanged.

## 2. Behaviour delivered (design; the code is KBE-R8's and FE-R7's)

- **D-124 item 1 (a KPI-derived value says its unit kind):**
  - `DashboardValue.kpiUnit = {kind, label}`. `kind` is the KPI definition's `unit_kind`, the same source as `KpiStatus.unitKind`, which the KPI pages format from. `label` is the trimmed `unit_label`, or null.
  - It is non-null on every KPI actual, in every state. The one exception is an unreadable KPI (`kpi.no_active_version`, no number).
  - The web formats from `kind` as `formatKpiValue` does (the table in ADR-0037 N5 item 1).
- **Item 2 (the computed ratio):** the value gap keeps unit `ratio` with `kpiUnit` null, and is shown × 100 with '%'. A `ratio`-kind KPI carries `kpiUnit.kind = ratio`, so the two are told apart.
- **Item 3 (the label):** it is kept in `kpiUnit.label`, and `unit` keeps its content. Neither decides × 100. For a percentage the '%' is always shown, and a label starting with '%' replaces the bare sign ('12 % of users').
- **Item 4:** `state`, `value`, `reasonKey` and `currency` are unchanged. So are the Unknown, Stale, n/a and zero renderings, and the same number format applies to stale and zero.
- **The classification** (KPI-derived, money, computed ratio, count) is a table in N5. It lists each kind's `kpiUnit`, `unit`, `currency`, format and API emitters.

## 3. Checks actually run

Environment: this worktree, Linux sandbox, Node v24.21.0, pnpm from the repository toolchain, no network. The disposable PostgreSQL ran on harness port 23700.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm openapi:lint` | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations` |
| 2 | `pnpm --filter @mth/shared build`, then `pnpm -r typecheck` | build **exit 0**. typecheck **exit 0**: 7 packages "typecheck: Done" (design-tokens, shared, config, web, db, worker, api) |
| 3 | `pnpm lint` | **exit 0** (`eslint . --max-warnings=0`) |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0**: "All matched files use Prettier code style!" in all 11 batches. The only other output is npm's "Unknown project config" warnings |
| 5 | `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh pnpm exec vitest run --project integration apps/api/test/integration/contract/` | **exit 0**: `Test Files 2 passed (2)`, `Tests 46 passed (46)`, 56.2 s |
| 6 | `node tools/gates/validate.mjs --historical --stage DG3` | **exit 0**: `PASS gate DG3 (historical)`, at the start and again at the end |
| 7 | `git status --short`, `git diff --stat` | Modified: `openapi.yaml`, ADR-0037, `dashboards.ts`. Untracked: `p4-pending-arch-r7.ts`, `T-DG4-ARCH-R7-evidence/`, this handback. Other untracked files (`.bashrc`, `.zshrc`, `CLAUDE.local.md`, `.mcp.json`, …) are dated 2026-10-09, before this run, so they are not mine and are untouched |
| 8 | (not an acceptance check) `pnpm exec vitest run --project unit-web apps/web/src/pages/dashboards` | **exit 0**: `Test Files 4 passed (4)`, `Tests 76 passed (76)`. The web is unaffected while the member is optional |
| 9 | (fixture measurement) A temporary probe `apps/web/zz-arch-r7-probe.mts` run with `node` (native type stripping). It imported `src/lib/format.ts` and printed the fixture outputs in both locales, and was **deleted** right after. | EN `{"pct":"12 %","ratio":"1.5","gap":"100 %","money":"SAR 90.00"}`; AR `{"pct":"12 %","ratio":"1.5","gap":"100 %","money":"‏90.00 ر.س.‏"}`. A first attempt via `npx tsx` failed: no network, and tsx is not installed |

**Not run:** integration beyond the contract project, e2e, and the API unit suites. No product behaviour changed: the API and the web are untouched, and the new zod member is optional.

## 4. Implementation notes for KBE-R8 and FE-R7

### 4.1 KBE-R8 (API)

1. **`kpi/dashboard-facts.ts`.** `KpiDashboardStatus` gains `unitKind: string` and `unitLabel: string | null`. Both `fromPanel` and `noPeriod` set:
   - `unitKind: def.unit_kind`;
   - `unitLabel: def.unit_label?.trim() || null`.

   **Keep `unit: def.unit_label ?? def.unit_kind` unchanged** (N5 item 3). Changing it is not needed, and it would break the web in the window before FE-R7 merges.
2. **`reporting/dashboards/areas.ts`.**
   - **`KpiStatusFact`** gains `unitKind: string | null` and `unitLabel: string | null`. It is structurally the type above.
   - **`kpiActualValue(s)`** sets `kpiUnit: s.unitKind === null ? null : {kind: s.unitKind, label: s.unitLabel}` in all three branches (known, stale, unknown).
   - **The other builders** (`knownValue`, `unknownValue`, `notApplicableValue` and, through them, `countValue`, `sumValue` and `gapValue`) set `kpiUnit: null`. The simplest route: build the KPI value with `knownValue(...)` / `unknownValue(...)`, then spread `{...v, kpiUnit}`.
   - **Spreads** like `{...notApplicableValue(...), currency}` keep `kpiUnit: null`.
3. **`engine.ts` `missingStatus`:** `unitKind: null` and `unitLabel: null`. The value is then Unknown `kpi.no_active_version`, with `kpiUnit` null and `unit` null.
4. **Check that every `DashboardValue` carries the key.** Values are also built through `drilldown.ts` `oneCurrency` / `noRecord`, `finance.ts` and `engine.ts`. These all go through the builders, and a grep at this base shows no other literal value object: the only `state: "unknown"` literals outside the builders are `workspace-header.ts`'s gate and North Star objects, which are not `DashboardValue`s. Once step 5 makes `kpiUnit` required in the zod type, `tsc` reports any value that was missed.
5. **The closing step, in the same change:**
   1. In `openapi.yaml`, `DashboardValue.required` becomes `[state, value, unit, currency, reasonKey, kpiUnit]`. `DashboardKpiUnit.required` stays `[kind, label]`.
   2. In `openapi.yaml`, in the `DashboardValue.kpiUnit` description, "Not yet required: pending in p4-pending-arch-r7.ts." becomes "Required since the API emits it (T-DG4-KBE-R8).".
   3. In `openapi.yaml`, in the info paragraph "P4 repairs (T-DG4-ARCH-R7 …)", "The member is declared but not yet required: pending in `p4-pending-arch-r7.ts` until the API emits it." (line 155, in the middle of the line) becomes "The member is required since the API emits it (T-DG4-KBE-R8).".
   4. In `dashboards.ts`, `kpiUnit: dashboardKpiUnit.nullable().optional()` becomes `kpiUnit: dashboardKpiUnit.nullable()`. In the `dashboardValue` doc comment, "`kpiUnit` is `.optional()` until T-DG4-KBE-R8 emits it (pending in apps/api/test/support/p4-pending-arch-r7.ts)." becomes "`kpiUnit` is required: the API emits it (T-DG4-KBE-R8).".
   5. In `p4-pending-arch-r7.ts`, empty `P4_PENDING_ARCH_R7_MEMBERS` and add a removal note.

   Nothing else in these files changes.
   - **Warning (D-121):** step 4 breaks the web typecheck unless FE-R7 has already added `kpiUnit` to every web `DashboardValue` literal (§4.2 item 4). Merge FE-R7 first, or check the merged tree's `pnpm -r typecheck` before closing.
6. **Tests, through the API only.** D-124 item 1 makes a non-archived outcome visible, so no direct database insert is needed. Using the §4.3 fixtures:
   - the T10 Outcomes area `outcome_kpi` item, the `outcomes.kpi_status` drill-down (value, items, the `actual` input) and the adoption `AdoptionIndicatorRow.value` carry the `kpiUnit` given there, with `value` unchanged ("0.12", "1.5");
   - the value gap headline and drill-down carry `kpiUnit: null` and `unit: "ratio"`;
   - a Finance line total, a Portfolio item and a count headline carry `kpiUnit: null`;
   - a Stale and an Unknown KPI value keep their `kpiUnit`.

   The contract test's validating client checks the shape once the member is required.

### 4.2 FE-R7 (web)

1. **`pages/dashboards/ui.tsx` `formatValue`:**
   - **When `v.kpiUnit` is non-null,** format by `kpiUnit.kind` exactly as `formatKpiValue` does (reuse it from `pages/kpi/ui.tsx`), then apply the label rule of ADR-0037 N5 item 1:
     - **percentage:** label null, or `%` / `percent` / `percentage` (trimmed, any case) gives '12 %'. A label starting with '%' gives `${n} ${label}`. Any other label gives `12 % ${label}`.
     - **ratio, count, duration, score and other:** the number, plus ` ${label}` when the label is set.
     - **currency with a currency:** money, with no label.
   - **When `kpiUnit` is null,** keep today's rules: `ratio` × 100 with '%', `currency` as money, count nouns as integers.
   - `PERCENT_UNITS` can stay as a fallback for a value with no `kpiUnit` member while the member is optional. It must never apply when `kpiUnit` is present.
2. **Bidi.** The number stays in `<bdi dir="ltr">`. Put the label in its own `<bdi>` (auto direction), so an Arabic label is not forced left-to-right. This needs `ValueView` to receive the number and the label separately, or a `formatValueParts`.
3. **Stale, zero, Unknown and n/a** are unchanged. Stale and zero use the same formatted text.
4. **Fixtures and literals (do this first; it keeps the KBE-R8 closing step from breaking the typecheck):**
   - add `kpiUnit` to every `DashboardValue` literal in `dashboardFixtures.ts` and the dashboards tests: the KPI's unit on KPI items, null elsewhere;
   - add `kpiUnit: null` to the two values the web builds itself, `DashboardsPage.tsx` (the Finance non-financial n/a) and `ui.tsx` `ValueRagLines` (both gap objects).
5. **Tests:** the §4.3 fixtures in EN and AR, on a T10 item, an adoption row and the `outcomes.kpi_status` drill-down. Update `percentKpi.test.tsx` to the API's new value objects. Its existing expectations ('12 %', '100 %') stay true.
6. **Texts:** none new (see the code table). If the unit kind needs naming, use `kpi.definition.unitKinds.<kind>`.

### 4.3 Fixtures (synthetic data; expected text measured with the web's formatters, §3 check 9)

| # | KPI / value | API value object after KBE-R8 | EN | AR |
|---|---|---|---|---|
| F1 | `percentage` KPI, no label, actual 0.12 | `{state: "value", value: "0.12", unit: "percentage", currency: null, reasonKey: null, kpiUnit: {kind: "percentage", label: null}}` | `12 %` | `12 %` |
| F2 | `percentage` KPI, label '% of users', actual 0.12 | `{state: "value", value: "0.12", unit: "% of users", currency: null, reasonKey: null, kpiUnit: {kind: "percentage", label: "% of users"}}` | `12 % of users` | `12 % of users` |
| F3 | `ratio` KPI, no label, actual 1.5 | `{state: "value", value: "1.5", unit: "ratio", currency: null, reasonKey: null, kpiUnit: {kind: "ratio", label: null}}` | `1.5` (never `150 %`) | `1.5` |
| F4 | the value gap 1 (planned 70, nothing validated) | `{state: "value", value: "1", unit: "ratio", currency: "SAR", reasonKey: null, kpiUnit: null}` | `100 %` | `100 %` |

**Negative assertions:**
- F2 never shows `0.12`;
- F3 never shows `%`;
- F4 never shows `SAR` or `ر.س`.

**Also:**
- F2 as Stale (`state: "stale"`, `reasonKey: "kpi.stale"`) shows the Stale chip and `12 % of users` as the last known value.
- F3 as Unknown (`value: null`, `kpi.no_accepted_actual`) shows no number.
- A zero F1 (`state: "zero"`, `value: "0"`) shows `0 %` with the Zero label.

In AR the digits are Latin, and the '%' is placed as in EN (`intlLocale` `ar-u-ca-gregory-nu-latn`; `formatKpiValue` writes `${n} %`). The label is the organization's own text, shown as entered.

## 5. Known gaps and disclosures

1. **The API and web changes are not made here**, by design: they are KBE-R8's and FE-R7's. Until KBE-R8 lands, the API sends no `kpiUnit`, and the defect stays in the product.
2. **The merge order matters for the closing step only** (§4.1 item 5, warning). Both members of wave C can merge in either order before the closing step, because the member is optional.
3. **The percentage label rule is my design choice** inside D-124 item 3 (the '%' is always shown; a label starting with '%' replaces the bare sign). D-124 fixes the '% of users' example, not every label. A label such as 'of users' renders '12 % of users'.
4. **The `unit` content for KPI values is kept as is** (`label ?? kind`), so the change stays additive. That leaves `unit` redundant for KPI values. Removing or narrowing it would be a breaking change, so it is not proposed.
5. **No new code or key.** The code table records that and allocates no row.

## 6. Merge instructions

- **No migration.** Rebuild `@mth/shared` after merging (`pnpm --filter @mth/shared build`).
- **Conflicts:** none expected. The `openapi.yaml` hunks are the info paragraph and the `DashboardValue` block only. In `dashboards.ts` they are the import line and the `dashboardValue` block.
- **After the merge:** `pnpm openapi:lint` (652) and `pnpm -r typecheck`.
- **Then wave C:** FE-R7's fixtures first, then KBE-R8 with the closing step. Or merge both, then check the merged tree's typecheck.
