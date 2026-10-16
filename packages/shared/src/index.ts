// @mth/shared public surface (ADR-0002). Dependency-free constants and types.
// Runtime validation schemas (zod) are exported from the "@mth/shared/schemas" subpath, and the decimal.js-backed
// calculation code (T06 scoring, T09 restricted formula engine) from the "@mth/shared/calc" subpath (ADR-0024 §6).
export * from "./constants.ts";
export * from "./permissions.ts";
export * from "./problem.ts";
export * from "./reports/content-labels.ts";
// T-DG5-BE-R2 (ADR-0049 §7): the two text rules, mirrors of the SQL functions of 0089.
export * from "./text-scan/claims.ts";
export * from "./text-scan/engineering-gates.ts";
