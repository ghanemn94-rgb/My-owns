// Sensitive records on the dashboards (slice E; ADR-0051 §2; D-195 Q3; REQ-S10-002; p6-work-split §E/F.3; T-DG6-BE-B2).
//
// Every figure (headline, area status, drill-down value and inputs) is computed from the same facts for every reader,
// exactly as in DG4/DG5: no number changes and Unknown stays Unknown (ADR-0051 §8). What changes per reader:
//  - an item that IS a restricted record, or a part of one (a benefit, its measurement, a business-case investment
//    line), is not listed: the record and its individual value are never shown;
//  - T-DG6-BE-Z7 (F-DG6-361): `hides` knows every value line of the facts (a planned line, `benefit_plan_value`, as
//    well as a measurement) and every investment line; `withoutRestrictedRefs` then applies the shared
//    SENSITIVE_CHILD_SOURCES rule (access/sensitive-reach.ts) to whatever is left, so an item type this file does not
//    name (a new child table, an evidence item) is decided by the one rule every other route uses, never passed by a
//    `default: false`;
//  - the response carries `includesRestrictedRecords` when a benefit or business case of its facts is sensitive (true
//    when this reader is not admitted to at least one of them, false when it is admitted to all). When nothing is
//    sensitive the response is unchanged byte for byte (no field).
import type { DbOrTx } from "@mth/db";
import { reachKey, restrictedRecordRefs, type Principal, type ReachRef } from "../../access/index.ts";
import { restrictedField, restrictionOf } from "../../benefits/index.ts";
import type { DashboardFacts } from "./engine.ts";

export interface DashboardRestriction {
  /** `{}` when nothing is sensitive, otherwise `{ includesRestrictedRecords }`. */
  readonly field: { includesRestrictedRecords?: boolean };
  /** True when an item of this record type and id shows a restricted record (or a part of one). */
  readonly hides: (recordType: string | null, recordId: string | null) => boolean;
}

/** The restricted-records outcome of one dashboard read (two queries when nothing is sensitive). */
export async function dashboardRestriction(
  db: DbOrTx,
  principal: Principal,
  facts: DashboardFacts,
): Promise<DashboardRestriction> {
  const benefits = await restrictionOf(
    db,
    principal,
    "benefit",
    facts.benefits.map((b) => b.benefitId),
  );
  const cases = await restrictionOf(db, principal, "business_case", [
    ...new Set(facts.investment.map((l) => l.businessCaseId)),
  ]);
  const field = restrictedField({
    anySensitive: benefits.anySensitive || cases.anySensitive,
    restricted: new Set([...benefits.restricted, ...cases.restricted]),
  });
  if (benefits.restricted.size === 0 && cases.restricted.size === 0) return { field, hides: () => false };
  // Every value line (benefit_measurement, benefit_plan_value, ...) keyed by its table and id (F-DG6-361).
  const lineBenefit = new Map(facts.lines.map((l) => [`${l.recordTable}:${l.recordId}`, l.benefitId]));
  const lineCase = new Map(facts.investment.map((l) => [l.recordId, l.businessCaseId]));
  const hides = (recordType: string | null, recordId: string | null): boolean => {
    if (recordType === null || recordId === null) return false;
    switch (recordType) {
      case "benefit":
        return benefits.restricted.has(recordId);
      case "business_case":
        return cases.restricted.has(recordId);
      case "business_case_line": {
        const c = lineCase.get(recordId);
        return c !== undefined && cases.restricted.has(c);
      }
      default: {
        const b = lineBenefit.get(`${recordType}:${recordId}`);
        // Not a line of these facts: decided by withoutRestrictedRefs (the shared rule), not here.
        return b !== undefined && benefits.restricted.has(b);
      }
    }
  };
  return { field, hides };
}

/**
 * The entries of `rows` that disclose no restricted record for this reader: first `hides` (the facts' own records),
 * then the shared rule over every remaining reference (`restrictedRecordRefs`: a sensitive benefit, business case or
 * evidence item, or any SENSITIVE_CHILD_SOURCES child of one). An entry with several references (a drill-down
 * evidence entry names its line and its evidence item) is removed when ANY of them is restricted. The order is kept.
 * One query when nothing is marked sensitive in the reader's organizations.
 */
export async function withoutRestrictedRefs<T>(
  db: DbOrTx,
  principal: Principal,
  r: DashboardRestriction,
  rows: readonly T[],
  refsOf: (row: T) => readonly { recordType: string | null; recordId: string | null }[],
): Promise<T[]> {
  const known = (x: { recordType: string | null; recordId: string | null }): x is ReachRef =>
    x.recordType !== null && x.recordId !== null;
  const kept = rows.filter((row) => !refsOf(row).some((x) => r.hides(x.recordType, x.recordId)));
  const refs = kept.flatMap((row) => refsOf(row).filter(known));
  const restricted = await restrictedRecordRefs(db, principal, refs);
  const out =
    restricted.size === 0
      ? kept
      : kept.filter((row) => !refsOf(row).some((x) => known(x) && restricted.has(reachKey(x))));
  return out.length === rows.length ? [...rows] : out;
}

/**
 * The response field after the lists were filtered: `restriction.field`, or `{ includesRestrictedRecords: true }` when
 * the shared rule removed an entry the facts' own benefits and cases did not account for (a sensitive evidence item of
 * an otherwise open benefit, T-DG6-BE-Z7B): a reader who lost an entry is never told that nothing was restricted.
 */
export function restrictedFieldAfter(
  r: DashboardRestriction,
  removed: boolean,
): { includesRestrictedRecords?: boolean } {
  return removed ? { includesRestrictedRecords: true } : r.field;
}

/** The areas with every item of a restricted record removed (headlines and statuses unchanged; one decision). */
export async function withoutRestrictedItems<A extends { items: { recordType: string; recordId: string }[] }>(
  db: DbOrTx,
  principal: Principal,
  areas: A[],
  r: DashboardRestriction,
): Promise<A[]> {
  const all = areas.flatMap((a) => a.items);
  const kept = new Set(await withoutRestrictedRefs(db, principal, r, all, (i) => [i]));
  if (kept.size === all.length) return areas;
  return areas.map((a) => ({ ...a, items: a.items.filter((i) => kept.has(i)) }));
}
