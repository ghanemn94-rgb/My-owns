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

/**
 * T-DG6-BE-Z9 (F-DG6-400; ADR-0051 §2 "Totals and rollups"): the records whose values the facts' aggregate figures
 * include: every benefit (its own row and its value lines) and every business case (its investment lines). They are
 * exactly the records `dashboardRestriction` decides the dashboards' flag from, so a report section built from the same
 * facts (the executive pack's `metrics_<subject>`, the executive dashboard's `area_value`) is labelled for the same
 * reader as the dashboard. Of the six Template 10 areas only `value` reads them (engine.ts `computeAreas` and
 * `presentAreas`: benefits, lines and investment); the others read outcomes, initiatives, dependencies, decisions and
 * adoption indicators, none of which is a sensitive record type or a child of one (access/sensitive-reach.ts).
 * Deduplicated, in first-seen order.
 */
export function factsValueRecords(facts: DashboardFacts): ReachRef[] {
  const out: ReachRef[] = [];
  const seen = new Set<string>();
  const add = (recordType: "benefit" | "business_case", recordId: string) => {
    const k = `${recordType}:${recordId}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ recordType, recordId });
  };
  for (const b of facts.benefits) add("benefit", b.benefitId);
  for (const l of facts.lines) add("benefit", l.benefitId);
  for (const l of facts.investment) add("business_case", l.businessCaseId);
  return out;
}

/** The T10 area whose figures include `factsValueRecords` (see there). */
export const VALUE_AREA = "value";

/**
 * T-DG6-BE-Z9 (F-DG6-400): the benefits whose planned values an initiative item's value includes. A Portfolio item
 * shows the initiative's planned value allocated on the profit-and-cash basis (engine.ts `initiativePlannedValues`:
 * Σ allocated benefits' planned amounts × share; with a share of 1 it IS the benefit's amount), and whether it is
 * known, not_applicable or unknown is decided by every benefit allocated to it, so every allocated benefit is
 * included. The item names only the initiative, so a report table of these items is labelled from these records.
 */
export function allocatedBenefitRecords(facts: DashboardFacts, initiativeIds: readonly string[]): ReachRef[] {
  const wanted = new Set(initiativeIds);
  const ids = new Set<string>();
  for (const a of facts.allocations) if (wanted.has(a.initiativeId)) ids.add(a.benefitId);
  return [...ids].map((recordId) => ({ recordType: "benefit", recordId }));
}
