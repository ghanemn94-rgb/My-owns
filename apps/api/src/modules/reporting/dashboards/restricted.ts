// Sensitive records on the dashboards (slice E; ADR-0051 §2; D-195 Q3; REQ-S10-002; p6-work-split §E/F.3; T-DG6-BE-B2).
//
// Every figure (headline, area status, drill-down value and inputs) is computed from the same facts for every reader,
// exactly as in DG4/DG5: no number changes and Unknown stays Unknown (ADR-0051 §8). What changes per reader:
//  - an item that IS a restricted record, or a part of one (a benefit, its measurement, a business-case investment
//    line), is not listed: the record and its individual value are never shown;
//  - the response carries `includesRestrictedRecords` when a benefit or business case of its facts is sensitive (true
//    when this reader is not admitted to at least one of them, false when it is admitted to all). When nothing is
//    sensitive the response is unchanged byte for byte (no field).
import type { DbOrTx } from "@mth/db";
import type { Principal } from "../../access/index.ts";
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
  const measurementBenefit = new Map(
    facts.lines.filter((l) => l.recordTable === "benefit_measurement").map((l) => [l.recordId, l.benefitId]),
  );
  const lineCase = new Map(facts.investment.map((l) => [l.recordId, l.businessCaseId]));
  const hides = (recordType: string | null, recordId: string | null): boolean => {
    if (recordType === null || recordId === null) return false;
    switch (recordType) {
      case "benefit":
        return benefits.restricted.has(recordId);
      case "benefit_measurement": {
        const b = measurementBenefit.get(recordId);
        return b !== undefined && benefits.restricted.has(b);
      }
      case "business_case":
        return cases.restricted.has(recordId);
      case "business_case_line": {
        const c = lineCase.get(recordId);
        return c !== undefined && cases.restricted.has(c);
      }
      default:
        return false;
    }
  };
  return { field, hides };
}

/** The areas with every item of a restricted record removed (headlines and statuses unchanged). */
export function withoutRestrictedItems<A extends { items: { recordType: string; recordId: string }[] }>(
  areas: A[],
  r: DashboardRestriction,
): A[] {
  if (r.field.includesRestrictedRecords !== true) return areas;
  return areas.map((a) => ({ ...a, items: a.items.filter((i) => !r.hides(i.recordType, i.recordId)) }));
}
