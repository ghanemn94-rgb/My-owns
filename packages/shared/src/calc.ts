// @mth/shared/calc subpath (ADR-0002, ADR-0024 §6): decimal.js-backed calculation code. It is kept off the
// top-level "@mth/shared" entry, which stays dependency-free constants and types.
export * from "./scoring.ts";
export * from "./formula/index.ts";
export * from "./kpi/index.ts";
// P4 slice E scheduling (T-DG4-BE-E; ADR-0031 §7-§8): the working-day slip and the critical path.
export * from "./schedule/index.ts";
// P4 slice D meeting recurrence (T-DG4-BE-F; ADR-0032 §2-§3.1): nominal occurrences, the non-working-day rules and the
// agenda cut-off over an injected working-day predicate.
export * from "./governance/recurrence.ts";
