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
// P4 slice F forms (backend-workflow-engineer, T-DG4-BE-H2; p4-work-split §F+G FG.2; ADR-0033 §5): the validated form
// JSON of feedback and assessment forms, answer validation and the derived proficiency result.
export * from "./adoption/form-schema.ts";
// P4 slice F adoption measures (T-DG4-KBE-F; ADR-0033 §6): training completion and observed proficiency over injected
// records, the latest observation per subject, the weighted-ratio aggregation and the below-trajectory test (§4 step 2).
export * from "./adoption/measures.ts";
