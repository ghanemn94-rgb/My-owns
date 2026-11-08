// The worker's twin of the API's sensitive-reach child sources (apps/api access/sensitive-reach.ts
// SENSITIVE_CHILD_SOURCES; ADR-0051 §2; D-218, D-226, D-227 (2), (3); T-DG6-BE-Z13B). The worker imports no API code,
// so the map is restated here as data; `channel-fanout-restricted-z13b.test.ts` pins it deep-equal to the API's map, so
// a child source added on one side and not the other fails the test.
//
// `restrictedForRecipient(db, userId, ids)`: whether any id among `ids` (the uuids of a notification's link, message
// parameters, stored target and announced work item) names a sensitive record (benefit, business case, evidence), or a
// child that carries one's values (every child source: a Finance validation, a benefit overlap, a measurement, a
// corrective case, ...), or an action on such a corrective case, that is marked sensitive and for which the user holds
// no ACTIVE explicit sensitive-record grant. An evidence item also counts through every benefit or business case it is
// linked to. FAIL-CLOSED restatement: the ADR-0051 §2 party clause and `sensitive_record.grant` holders are not restated,
// so they get the restricted text here (it can only hide, never reveal). Read only; nothing here is a business approval
// (G1-G6) and nothing touches DG0-DG7.
import { sql, type DbOrTx } from "@mth/db";

export type SensitiveType = "benefit" | "business_case" | "evidence";
export const SENSITIVE_TYPE_LIST: readonly SensitiveType[] = ["benefit", "business_case", "evidence"];

export interface ColumnOwnerTwin {
  readonly type: SensitiveType;
  readonly column: string;
}

/** The same union as the API's `ChildSource`. */
export type ChildSourceTwin =
  | { readonly kind: "column"; readonly table: string; readonly owners: readonly ColumnOwnerTwin[] }
  | {
      readonly kind: "pair";
      readonly table: string;
      readonly codes: "table" | "form";
      readonly extra?: readonly ColumnOwnerTwin[];
    }
  | {
      readonly kind: "via";
      readonly table: string;
      readonly via: { readonly table: string; readonly column: string; readonly owners: readonly ColumnOwnerTwin[] };
    };

const benefitChild = (table: string, column = "benefit_id"): ChildSourceTwin => ({
  kind: "column",
  table,
  owners: [{ type: "benefit", column }],
});
const caseChild = (table: string): ChildSourceTwin => ({
  kind: "column",
  table,
  owners: [{ type: "business_case", column: "business_case_id" }],
});
const evidenceChild = (table: string): ChildSourceTwin => ({
  kind: "column",
  table,
  owners: [{ type: "evidence", column: "evidence_id" }],
});

/** Twin of SENSITIVE_CHILD_SOURCES (key = the audit record_type = the table name). */
export const SENSITIVE_CHILD_SOURCES_TWIN: Readonly<Record<string, ChildSourceTwin>> = {
  benefit_measurement: benefitChild("benefit_measurement"),
  benefit_plan_value: benefitChild("benefit_plan_value"),
  benefit_scenario_value: benefitChild("benefit_scenario_value"),
  benefit_allocation: benefitChild("benefit_allocation"),
  benefit_lifecycle_event: benefitChild("benefit_lifecycle_event"),
  benefit_enabler: benefitChild("benefit_enabler"),
  finance_validation: benefitChild("finance_validation"),
  corrective_case: benefitChild("corrective_case"),
  transition_decision: benefitChild("transition_decision"),
  performance_area_link: benefitChild("performance_area_link"),
  trace_link: benefitChild("trace_link"),
  benefit_overlap: {
    kind: "column",
    table: "benefit_overlap",
    owners: [
      { type: "benefit", column: "benefit_a_id" },
      { type: "benefit", column: "benefit_b_id" },
    ],
  },
  benefit_evidence: {
    kind: "column",
    table: "benefit_evidence",
    owners: [
      { type: "benefit", column: "benefit_id" },
      { type: "evidence", column: "evidence_id" },
    ],
  },
  benefit_calculation: {
    kind: "via",
    table: "benefit_calculation",
    via: {
      table: "benefit_measurement",
      column: "benefit_calculation_id",
      owners: [{ type: "benefit", column: "benefit_id" }],
    },
  },
  business_case_line: caseChild("business_case_line"),
  benefit_scenario: caseChild("benefit_scenario"),
  financial_cash_flow_set: caseChild("financial_cash_flow_set"),
  evidence_link: evidenceChild("evidence_link"),
  evidence_content: evidenceChild("evidence_content"),
  record_sensitivity: { kind: "pair", table: "record_sensitivity", codes: "table" },
  sensitive_record_grant: { kind: "pair", table: "sensitive_record_grant", codes: "table" },
  form_record_comment: { kind: "pair", table: "form_record_comment", codes: "form" },
  form_custom_value: { kind: "pair", table: "form_custom_value", codes: "form" },
  form_draft: { kind: "pair", table: "form_draft", codes: "form" },
  form_record_attachment: {
    kind: "pair",
    table: "form_record_attachment",
    codes: "form",
    extra: [{ type: "evidence", column: "evidence_id" }],
  },
};

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every uuid in a JSON value (a bare uuid, `<type>:<uuid>`, or inside a link or compound text), lower-cased. */
export function uuidsInValue(value: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") for (const m of v.matchAll(UUID_ANYWHERE)) out.add(m[0].toLowerCase());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

type Ref = { readonly recordType: SensitiveType; readonly recordId: string };
const keyOf = (r: Ref) => `${r.recordType}:${r.recordId}`;
const isSensitiveType = (t: string): t is SensitiveType => (SENSITIVE_TYPE_LIST as readonly string[]).includes(t);

/**
 * The sensitive owners named by `ids`: each id as itself (any of the three types), as a child row of any child source
 * (its owner columns), and as an action on a corrective case (D-227 (3): the action register keeps the action, but a
 * notification or task about it is about the case). Evidence owners add their linked benefits and business cases.
 */
export async function sensitiveOwnersOfIds(db: DbOrTx, ids: Iterable<string>): Promise<Ref[]> {
  const unique = [...new Set([...ids].map((x) => x.toLowerCase()))];
  if (unique.length === 0) return [];
  const owners = new Map<string, Ref>();
  const add = (recordType: SensitiveType, recordId: string | null | undefined) => {
    if (typeof recordId !== "string") return;
    const r = { recordType, recordId: recordId.toLowerCase() };
    owners.set(keyOf(r), r);
  };
  for (const id of unique) for (const t of SENSITIVE_TYPE_LIST) add(t, id);
  // D-227 (3): an action on a corrective case names the case (a benefit child) for this check.
  const actions = await sql<{ corrective_case_id: string }>`
    SELECT corrective_case_id::text AS corrective_case_id FROM action_item
     WHERE id = ANY(${unique}::uuid[]) AND corrective_case_id IS NOT NULL`.execute(db);
  const childIds = [...new Set([...unique, ...actions.rows.map((r) => r.corrective_case_id.toLowerCase())])];
  let formCodes: Map<string, SensitiveType> | null = null;
  for (const source of Object.values(SENSITIVE_CHILD_SOURCES_TWIN)) {
    // Table and column names come from the constant map above, never from input.
    if (source.kind === "via") {
      const rows = await sql<Record<string, string | null>>`
        SELECT ${sql.join(source.via.owners.map((o) => sql`${sql.ref(o.column)}::text AS ${sql.ref(o.column)}`))}
          FROM ${sql.table(source.via.table)} WHERE ${sql.ref(source.via.column)} = ANY(${childIds}::uuid[])`.execute(
        db,
      );
      for (const r of rows.rows) for (const o of source.via.owners) add(o.type, r[o.column]);
      continue;
    }
    const columns =
      source.kind === "column"
        ? source.owners.map((o) => o.column)
        : ["record_type", "record_id", ...(source.extra ?? []).map((o) => o.column)];
    const rows = await sql<Record<string, string | null>>`
      SELECT ${sql.join(columns.map((c) => sql`${sql.ref(c)}::text AS ${sql.ref(c)}`))}
        FROM ${sql.table(source.table)} WHERE id = ANY(${childIds}::uuid[])`.execute(db);
    if (rows.rows.length === 0) continue;
    if (source.kind === "column") {
      for (const r of rows.rows) for (const o of source.owners) add(o.type, r[o.column]);
      continue;
    }
    if (source.codes === "form" && formCodes === null) {
      const codes = await db
        .selectFrom("form_record_type")
        .select(["code", "table_name"])
        .where("table_name", "in", [...SENSITIVE_TYPE_LIST])
        .execute();
      formCodes = new Map(codes.map((c) => [c.code, c.table_name as SensitiveType]));
    }
    for (const r of rows.rows) {
      const t = r["record_type"] ?? "";
      const ownerType = source.codes === "table" ? (isSensitiveType(t) ? t : null) : (formCodes?.get(t) ?? null);
      if (ownerType !== null) add(ownerType, r["record_id"]);
      for (const o of source.extra ?? []) add(o.type, r[o.column]);
    }
  }
  const evidenceIds = [...owners.values()].filter((r) => r.recordType === "evidence").map((r) => r.recordId);
  if (evidenceIds.length > 0) {
    const parents = await sql<{ record_type: SensitiveType; record_id: string }>`
      SELECT 'benefit' AS record_type, be.benefit_id::text AS record_id
        FROM benefit_evidence be WHERE be.evidence_id = ANY(${evidenceIds}::uuid[])
      UNION
      SELECT frt.table_name AS record_type, fa.record_id::text AS record_id FROM form_record_attachment fa
        JOIN form_record_type frt ON frt.code = fa.record_type
       WHERE fa.evidence_id = ANY(${evidenceIds}::uuid[]) AND frt.table_name IN ('benefit', 'business_case')`.execute(
      db,
    );
    for (const p of parents.rows) add(p.record_type, p.record_id);
  }
  return [...owners.values()];
}

/**
 * True when any of `ids` names (itself, as a child, or through an action on a corrective case) a record marked
 * sensitive for which `userId` holds no active explicit sensitive-record grant. Two queries when nothing is marked.
 */
export async function restrictedForRecipient(db: DbOrTx, userId: string, ids: Iterable<string>): Promise<boolean> {
  const owners = await sensitiveOwnersOfIds(db, ids);
  if (owners.length === 0) return false;
  for (const type of SENSITIVE_TYPE_LIST) {
    const of = [...new Set(owners.filter((o) => o.recordType === type).map((o) => o.recordId))];
    if (of.length === 0) continue;
    const marked = await db
      .selectFrom("record_sensitivity")
      .select("record_id")
      .where("record_type", "=", type)
      .where("record_id", "in", of)
      .where("is_sensitive", "=", true)
      .execute();
    if (marked.length === 0) continue;
    const granted = new Set(
      (
        await db
          .selectFrom("sensitive_record_grant")
          .select("record_id")
          .where("record_type", "=", type)
          .where(
            "record_id",
            "in",
            marked.map((m) => m.record_id),
          )
          .where("grantee_user_id", "=", userId)
          .where("status", "=", "active")
          .execute()
      ).map((g) => g.record_id),
    );
    if (marked.some((m) => !granted.has(m.record_id))) return true;
  }
  return false;
}
