// @mth/shared/calc subpath (ADR-0002, ADR-0024 §6): decimal.js-backed calculation code. It is kept off the
// top-level "@mth/shared" entry, which stays dependency-free constants and types.
export * from "./scoring.ts";
export * from "./formula/index.ts";
export * from "./kpi/index.ts";
