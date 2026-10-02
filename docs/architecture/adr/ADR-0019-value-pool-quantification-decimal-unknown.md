# ADR-0019: Value-pool quantification, decimal amounts and the explicit Unknown / unquantified states

- **Status:** Accepted for P2 (DG2). Author: solution-architect (T-DG2-ARCH-01 / 01B), 2026-10-02.
- **Requirements:** REQ-PB-028 (value pools quantified by driver with upside/downside; unquantified shown as "unquantified", never zero), REQ-PB-027 (baselines), REQ-PB-026 (T01 impact SAR or KPI), REQ-PB-034 (T02 targets), the global rule "missing or stale data shows Unknown/Stale, never zero or green".
- **Builds on:** ADR-0003 (numeric + decimal.js 10.6.0, money as decimal strings). Physical model: migration `0014` (`value_pool`, `baseline`, `outcome_kpi`, `kpi_definition`) and `0015` (`diagnostic_item.impact_*`). **No new dependency:** decimal.js 10.6.0 is already pinned (ADR-0003 records its MIT licence; its [UNVERIFIED] support-window flag is unchanged, and this ADR adds no version).

## Context

A value pool is a diagnosed opportunity, quantified by its driver as a range from downside to upside. During Diagnose many pools cannot be quantified yet. If they showed as `0 SAR`, totals and G1 would look complete while hiding the gap. Floating point is never acceptable for money.

## Decision

1. **Two explicit states, enforced by CHECK `value_pool_quantification`:**

| `quantification_status` | `upside_amount` / `downside_amount` | Other rules |
|---|---|---|
| `quantified` | both `numeric(20,4)` NOT NULL | `downside_amount ≤ upside_amount`; no `unquantified_reason` |
| `unquantified` (the default) | both NULL | `unquantified_reason` is optional, but the UI asks for it |

   Zero is a legal *quantified* value (a real assessment of zero). It is never what "unknown" looks like.
2. **Driver and context:**
   - `driver` (text): what moves the value;
   - `workstream_code`: one of the six Diagnose workstreams;
   - `materiality`: `material` / `not_material` / `not_assessed`. G1 requires it assessed;
   - `confidence`: H/M/L;
   - `owner_user_id`;
   - `currency`: char(3), defaulting to the transformation currency (SAR).
3. **Finance validation:**
   - `validation_status` (unvalidated/validated/rejected) is set by FIN (`finance.validate`), never by the record's creator.
   - `validated_record_version` stores the version that was validated. When `version > validated_record_version`, the UI shows **Stale validation**, never "validated".
   - Only `quantified` pools can be validated (CHECK `value_pool_validated_quantified`).
4. **Arithmetic and transport:**
   - **API:** amounts travel as `Decimal` strings (`^-?[0-9]{1,18}(\.[0-9]{1,6})?$`). The API additionally rejects values that do not fit the target column, with no silent rounding:
     - `numeric(20,4)` (money): ≤ 16 integer digits and ≤ 4 fraction digits;
     - `numeric(24,6)` (KPI values and baselines): ≤ 18 integer digits and ≤ 6 fraction digits.
   - **Code:** in TypeScript, values are `Decimal` (decimal.js) from the `@mth/shared` helpers.
   - **Display:** formatting goes through the locale formatter (Arabic or English digits per locale; currency code shown).
   - **Never a float:** no JSON numbers for amounts. No `parseFloat`, `Number()` or `+x` on amounts; a lint/test check is owned by kpi-benefits-engineer.
5. **Totals:**
   - A total of value pools sums only `quantified` pools of the same currency.
   - It always returns `{ quantifiedTotal: {downside, upside}, unquantifiedCount, currency }`.
   - If `unquantifiedCount > 0`, the UI labels the total **"partial: N unquantified"**.
   - A total with zero quantified pools is `null` (Unknown), not `0`.
   - Mixed currencies are never summed. The total is split per currency, with no FX conversion in P2.
6. **The same Unknown rule elsewhere:**
   - `baseline.value`, `outcome_kpi.baseline_value`/`target_value` and `diagnostic_item.impact_amount` are nullable and mean Unknown when NULL.
   - A baseline can only be `validated` when value, source and date are present (CHECK `baseline_validated_measurable`).
   - `outcome_kpi.target_date` is NOT NULL: targets are time-bound (REQ-PB-034).

## Alternatives considered

- **`0` plus a boolean "estimated" flag:** rejected. Any consumer that ignores the flag reads zero.
- **A single amount plus a ± range percentage:** rejected. The source asks for upside and downside by driver, and asymmetric ranges are normal.
- **Integer minor units (halalas):** rejected for consistency with ADR-0003 (numeric + decimal.js everywhere, including rates and KPI values that are not money).

## Consequences

- kpi-benefits-engineer owns the decimal helpers' use, the total/aggregation function and its tests:
  - property tests for sums;
  - "unquantified never becomes 0";
  - currency split.
- The P4 benefit register (`benefit`, `benefit_allocation`) will reuse the same transport and Unknown rules. Value pools are *diagnostic*, and P4 benefits reference them; they are not the benefit register.

## Verification

- **Migration probe P1:** a new pool is `unquantified` with NULL amounts (output: "upside NULL (unquantified, not zero)").
- **Migration probe P5:** `quantified` without a downside is refused by `value_pool_quantification`.
- **Required unit tests:**
  - decimal round-trip of `"12345678901234.5678"` without loss;
  - the total over {quantified 100–200, unquantified} is `{100, 200}` with `unquantifiedCount = 1` and the "partial" label;
  - an empty set gives `null`;
  - FIN cannot validate an unquantified pool (422);
  - a stale validation shows as stale.
