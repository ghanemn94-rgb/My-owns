// The status precedence of the T10 areas (ADR-0037 §3; p4-work-split JK.10 item 5; REQ-PB-063; M0159):
//   red > amber > unknown / not_computable > stale > green.
// An outcome is the combination of its KPIs' statuses, an area of its rows'. So a missing (unknown) or stale input never
// yields green, and an empty set is decided per area by the caller (never green unless the area's table says so).
// Pure: no I/O, no clock.
import type { RagStatus } from "@mth/shared/schemas";

/** Every status an input row may carry: the dashboard statuses plus slice A's `not_computable` (shown as unknown). */
export type InputStatus = RagStatus | "not_computable";

// not_applicable rows (rank 0) take no part in a combination (a workstream's transformation-level areas, a planned = 0
// line).
const RANK: ReadonlyMap<InputStatus, number> = new Map<InputStatus, number>([
  ["red", 5],
  ["amber", 4],
  ["unknown", 3],
  ["not_computable", 3],
  ["stale", 2],
  ["green", 1],
  ["not_applicable", 0],
]);
const rankOf = (s: InputStatus): number => RANK.get(s) ?? 0;

/**
 * The combination of `statuses` by the precedence above, or `null` when the set is empty or holds only
 * `not_applicable` rows (the caller applies the area's empty-set rule). `not_computable` combines as `unknown`.
 */
export function combine(statuses: readonly InputStatus[]): RagStatus | null {
  let best: InputStatus | null = null;
  for (const s of statuses) {
    if (rankOf(s) === 0) continue;
    if (best === null || rankOf(s) > rankOf(best)) best = s;
  }
  if (best === null) return null;
  return best === "not_computable" ? "unknown" : best;
}

/** `combine`, with `empty` for an empty (or all not_applicable) set. */
export function combineOr(statuses: readonly InputStatus[], empty: RagStatus): RagStatus {
  return combine(statuses) ?? empty;
}

/** A slice A KPI RAG (green, amber, red, unknown, stale, not_computable) as a dashboard status. */
export function fromKpiRag(rag: string): RagStatus {
  switch (rag) {
    case "green":
    case "amber":
    case "red":
    case "stale":
      return rag;
    default:
      return "unknown";
  }
}
