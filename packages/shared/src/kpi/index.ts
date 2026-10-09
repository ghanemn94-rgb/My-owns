// Public API of the pure KPI library (ADR-0028; p4-work-split §A.1). Owner: kpi-benefits-engineer (T-DG4-KBE-A).
// Exposed through the `@mth/shared/calc` subpath (calc.ts), next to the formula engine it builds on.
//
//   measures.ts         shortfall and deviation per measure type (§1)
//   periods.ts          comparability, YTD windows, period and cumulative values (§2, §6)
//   change.ts           pp vs %, zero base, negative baseline, variance (§3)
//   trajectory.ts       expected-to-date: linear, step, baseline point, Unknown before the first point (§4)
//   rag.ts              thresholds (defaults 0.05 / 0.10) and the explanation naming the threshold (§5)
//   status.ts           value statuses, staleness, override in force, displayed vs calculated RAG, trend (§6)
//   aggregate.ts        roll-up rules, expected scopes, unit/currency refusal (§7)
//   formula-binding.ts  KPI unit → engine type, result-type match, evaluation (§8)

/** Version of the KPI calculation rules, recorded on every calculation_run (kpi_rules_version; ADR-0028). */
export const KPI_RULES_VERSION = "mth-kpi/1.0.0";

export * from "./types.ts";
export * from "./measures.ts";
export * from "./periods.ts";
export * from "./change.ts";
export * from "./trajectory.ts";
export * from "./rag.ts";
export * from "./status.ts";
export * from "./aggregate.ts";
export * from "./formula-binding.ts";
