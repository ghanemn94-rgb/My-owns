// Explanation-panel view models (ADR-0061 §8 rows E1, E2, E4, E5; REQ-S15-014). Owner: kpi-benefits-engineer
// (T-DG6-KBE-B; p6-work-split §I/K.2). Pure, decimal.js only: each takes the operation responses the panel already
// loads and returns its rows and message parameters, so the web displays the server's decimals and never computes a
// business number. Unknown, incomplete and n/a are explicit states, never 0 or green. Exported through
// `@mth/shared/calc`.
export * from "./weighted-score.ts";
export * from "./benefit-realized.ts";
export * from "./financial-metrics.ts";
export * from "./health-score.ts";
