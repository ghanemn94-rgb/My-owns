// The reach of a sensitive record (ADR-0051 §2; REQ-S10-002; T-DG6-BE-Y1: F-DG6-121, F-DG6-122, F-DG6-123).
//
// One rule, applied everywhere: a principal who gets 404 on a sensitive benefit, business case or evidence item must
// not learn its content, or the content of the records that carry its values (its "children"), through any other
// route. This file is the single helper every such route uses:
//
//   - `SENSITIVE_CHILD_SOURCES`: the record types (audit `record_type` = table name) whose rows hold a sensitive
//     record's values, and the column(s) naming their sensitive owner(s). A row may have two owners (a benefit-evidence
//     link, a form attachment, an overlap of two benefits); it is restricted when ANY owner is. A row that names no
//     owner itself but is named BY a child (a `benefit_calculation` lineage row, referenced by
//     `benefit_measurement.benefit_calculation_id`; T-DG6-BE-Z1, F-DG6-180) is a `via` source: its owners are the
//     owners of the referencing rows, and a lineage row no measurement references (a T09 calculation run on the
//     formula alone) has no owner.
//   - `restrictedRecordRefs(db, principal, refs)`: the `<recordType>:<recordId>` keys of the given records whose
//     sensitive owner (the record itself, for the three sensitive types) is marked sensitive and not admitted to the
//     principal by the §2 clause (`sensitivityClauseAdmits`: an active grant, a named party, or `sensitive_record.grant`
//     at the record's transformation). Used by both audit routes (redaction) and by list filters.
//   - `requireRecordReach(db, principal, recordType, recordId)`: the same decision for one record, answering 404
//     `not_found` (existence not disclosed, ADR-0006) when restricted. Used by the form-record sub-resources.
//   - `registerSensitiveReachGuard(app, db)`: the same decision for every route whose path parameters name a sensitive
//     value child (`SENSITIVE_REACH_PARAMS`: benefitMeasurementId, benefitPlanValueId, financeValidationId, lineId of a
//     business case, correctiveCaseId, transitionDecisionId, performanceAreaLinkId, ...), before the handler runs, for
//     reads and writes alike.
//
// Fail-closed: a child row that no longer exists (or a polymorphic reference to an unknown form type) is resolved from
// the audit event's `changes` (`<owner column>.from|to`) when the caller passes them; when no owner can be resolved and
// the child's transformation holds a sensitive record of the owner type that the principal is not admitted to, the
// child is treated as restricted. When nothing is marked sensitive in the principal's organizations the answer is the
// empty set after one query, so every DG1-DG5 response is unchanged until someone marks a record (ADR-0051 §2, G04).
// Read only. Nothing here is a business approval (G1-G6) and nothing touches DG0-DG7.
import { sql, type DbOrTx } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { problems } from "../platform/index.ts";
import { denialOf, resolveTarget, type Principal } from "./policy.ts";
import {
  activeGrantKeys,
  recordKey,
  SENSITIVE_RECORD_TYPE_LIST,
  sensitivityClauseAdmits,
  type SensitiveRecordType,
} from "./read-scope.ts";
import type { ResolvedTarget } from "./rules.ts";
import { loadSensitiveRecords } from "./sensitivity.ts";

/** A child row as read by `sensitiveOwnersOf`: its id, and the pair or owner columns by name (text or null). */
type ChildRow = { readonly id: string } & { readonly [column: string]: string | null };

/** A record a route is about to disclose (an audit event's record, a child row, a form record). */
export interface ReachRef {
  readonly recordType: string;
  readonly recordId: string;
  /** The audit event's `changes`, used to resolve the owner of a child row that no longer exists. */
  readonly changes?: unknown;
}

/** How a child record type names its sensitive owner(s). */
export type ChildSource =
  /** A fixed owner type in a column of the child's table. */
  | { readonly kind: "column"; readonly table: string; readonly owners: readonly ColumnOwner[] }
  /** A polymorphic (`record_type`, `record_id`) pair naming the owner; `form` when record_type is a form code. */
  | {
      readonly kind: "pair";
      readonly table: string;
      readonly codes: "table" | "form";
      readonly extra?: readonly ColumnOwner[];
    }
  /**
   * The row is referenced by rows of `via.table` (`via.column` = the row's id), whose owner columns name its owners.
   * The row carries the referencing record's value (a calculation lineage row holds the measured amount and inputs).
   */
  | {
      readonly kind: "via";
      readonly table: string;
      readonly via: { readonly table: string; readonly column: string; readonly owners: readonly ColumnOwner[] };
    };

export interface ColumnOwner {
  readonly type: SensitiveRecordType;
  readonly column: string;
}

const benefitChild = (table: string, column = "benefit_id"): ChildSource => ({
  kind: "column",
  table,
  owners: [{ type: "benefit", column }],
});
const caseChild = (table: string): ChildSource => ({
  kind: "column",
  table,
  owners: [{ type: "business_case", column: "business_case_id" }],
});
const evidenceChild = (table: string): ChildSource => ({
  kind: "column",
  table,
  owners: [{ type: "evidence", column: "evidence_id" }],
});

/**
 * The records that carry a sensitive record's values (the FK sweep of 0012, 0023, 0037, 0038, 0041, 0048, 0068, 0085,
 * 0098). The key is the audit `record_type`, which is the table name.
 */
export const SENSITIVE_CHILD_SOURCES: Readonly<Record<string, ChildSource>> = {
  // benefit (0037, 0038, 0041, 0048)
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
  // T-DG6-BE-Z5 (F-DG6-300): a traceability link into a benefit (0041 kpi_benefit) carries its contribution statement
  // and allocation share; benefit_id is NULL on the other link kinds (no owner).
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
  // the calculation lineage of a formula-computed measurement (0023, 0038; F-DG6-180): its inputs and result are the
  // measured value. Read through benefit_measurement.benefit_calculation_id.
  benefit_calculation: {
    kind: "via",
    table: "benefit_calculation",
    via: {
      table: "benefit_measurement",
      column: "benefit_calculation_id",
      owners: [{ type: "benefit", column: "benefit_id" }],
    },
  },
  // business case (0023, 0037, 0085)
  business_case_line: caseChild("business_case_line"),
  benefit_scenario: caseChild("benefit_scenario"),
  financial_cash_flow_set: caseChild("financial_cash_flow_set"),
  // evidence (0012)
  evidence_link: evidenceChild("evidence_link"),
  evidence_content: evidenceChild("evidence_content"),
  // the sensitivity records themselves (0098): their reasons describe the record
  record_sensitivity: { kind: "pair", table: "record_sensitivity", codes: "table" },
  sensitive_record_grant: { kind: "pair", table: "sensitive_record_grant", codes: "table" },
  // the P5 form-record sub-resources (0068): record_type is a form code (T14 -> benefit)
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

const SENSITIVE_TYPES: ReadonlySet<string> = new Set(SENSITIVE_RECORD_TYPE_LIST);
const CHILD_SOURCES: ReadonlyMap<string, ChildSource> = new Map(Object.entries(SENSITIVE_CHILD_SOURCES));

export function isSensitiveRecordType(recordType: string): recordType is SensitiveRecordType {
  return SENSITIVE_TYPES.has(recordType);
}

/** The key of a reference in the answer of `restrictedRecordRefs`. */
export const reachKey = (ref: { readonly recordType: string; readonly recordId: string }): string =>
  `${ref.recordType}:${ref.recordId}`;

/** An owner key, `<sensitiveType>:<id>`, or UNRESOLVED_OWNER(type) when the child's owner cannot be found. */
const unresolved = (type: SensitiveRecordType) => `?${type}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<column>.from` / `<column>.to` of an audit `changes` object (the owner of a deleted child row). */
function ownersFromChanges(changes: unknown, column: string): string[] {
  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) return [];
  const entry = new Map(Object.entries(changes)).get(column);
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
  const m = new Map(Object.entries(entry as object));
  return [m.get("from"), m.get("to")].filter((v): v is string => typeof v === "string" && UUID.test(v));
}

/** form code -> sensitive table (only T14 -> benefit at HEAD; read from the registry, never hard-coded). */
async function sensitiveFormCodes(db: DbOrTx): Promise<Map<string, SensitiveRecordType>> {
  const rows = await db
    .selectFrom("form_record_type")
    .select(["code", "table_name"])
    .where("table_name", "in", [...SENSITIVE_RECORD_TYPE_LIST])
    .execute();
  return new Map(rows.map((r) => [r.code, r.table_name as SensitiveRecordType]));
}

/**
 * The sensitive owners of each reference: `ref -> owner keys`. A sensitive-type reference owns itself; a child
 * reference maps through SENSITIVE_CHILD_SOURCES; any other reference has no owner (absent from the map).
 */
export async function sensitiveOwnersOf(db: DbOrTx, refs: readonly ReachRef[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const add = (ref: ReachRef, owner: string) => {
    const k = reachKey(ref);
    const s = out.get(k) ?? new Set<string>();
    s.add(owner);
    out.set(k, s);
  };
  const byType = new Map<string, ReachRef[]>();
  for (const ref of refs) {
    if (isSensitiveRecordType(ref.recordType)) {
      add(ref, recordKey(ref.recordType, ref.recordId));
      continue;
    }
    if (!CHILD_SOURCES.has(ref.recordType)) continue;
    const list = byType.get(ref.recordType) ?? [];
    list.push(ref);
    byType.set(ref.recordType, list);
  }
  let formCodes: Map<string, SensitiveRecordType> | null = null;
  for (const [type, list] of byType) {
    const source = CHILD_SOURCES.get(type)!;
    const ids = [...new Set(list.map((r) => r.recordId))];
    if (source.kind === "via") {
      await viaOwners(db, source, list, ids, add);
      continue;
    }
    // Table and column names come from the constant map above, never from input.
    const columns =
      source.kind === "column"
        ? source.owners.map((o) => o.column)
        : ["record_type", "record_id", ...(source.extra ?? []).map((o) => o.column)];
    const rows = await sql<ChildRow>`
      SELECT id::text AS id, ${sql.join(columns.map((c) => sql`${sql.ref(c)}::text AS ${sql.ref(c)}`))}
        FROM ${sql.table(source.table)} WHERE id = ANY(${ids}::uuid[])`.execute(db);
    const found = new Map(rows.rows.map((r) => [r.id!, r]));
    if (source.kind === "pair" && source.codes === "form" && formCodes === null)
      formCodes = await sensitiveFormCodes(db);
    for (const ref of list) {
      const found1 = found.get(ref.recordId);
      const row = found1 === undefined ? undefined : new Map(Object.entries(found1));
      if (source.kind === "column") {
        for (const o of source.owners) {
          const ids = row ? [row.get(o.column)].filter((v): v is string => typeof v === "string") : [];
          const fromChanges = row ? [] : ownersFromChanges(ref.changes, o.column);
          for (const id of [...ids, ...fromChanges]) add(ref, recordKey(o.type, id));
          // A nullable owner column (a corrective case without a benefit) has no owner; a vanished row is unresolved.
          if (!row && fromChanges.length === 0) add(ref, unresolved(o.type));
        }
        continue;
      }
      if (!row) {
        // A vanished polymorphic row: fail closed on every sensitive type it could name.
        for (const t of SENSITIVE_RECORD_TYPE_LIST) add(ref, unresolved(t));
        continue;
      }
      const pairType = row.get("record_type") ?? "";
      const pairId = row.get("record_id") ?? null;
      const ownerType =
        source.codes === "table"
          ? isSensitiveRecordType(pairType)
            ? pairType
            : null
          : (formCodes?.get(pairType) ?? null);
      if (ownerType !== null && pairId !== null) add(ref, recordKey(ownerType, pairId));
      for (const o of source.extra ?? []) {
        const v = row.get(o.column);
        if (typeof v === "string") add(ref, recordKey(o.type, v));
      }
    }
  }
  return out;
}

/**
 * The owners of `via` child rows: the owners of every row of `via.table` that references them. A row that does not
 * exist (never expected: the lineage is append-only) is unresolved (fail closed); an existing row nothing references
 * has no owner.
 */
async function viaOwners(
  db: DbOrTx,
  source: Extract<ChildSource, { kind: "via" }>,
  list: readonly ReachRef[],
  ids: readonly string[],
  add: (ref: ReachRef, owner: string) => void,
): Promise<void> {
  // Table and column names come from the constant map above, never from input.
  const existing = await sql<{ id: string }>`
    SELECT id::text AS id FROM ${sql.table(source.table)} WHERE id = ANY(${ids}::uuid[])`.execute(db);
  const present = new Set(existing.rows.map((r) => r.id));
  const { table, column, owners } = source.via;
  const rows = await sql<ChildRow & { readonly ref_id: string }>`
    SELECT ${sql.ref(column)}::text AS ref_id, id::text AS id,
           ${sql.join(owners.map((o) => sql`${sql.ref(o.column)}::text AS ${sql.ref(o.column)}`))}
      FROM ${sql.table(table)} WHERE ${sql.ref(column)} = ANY(${ids}::uuid[])`.execute(db);
  const byRef = new Map<string, Map<string, string | null>[]>();
  for (const r of rows.rows) {
    const m = new Map(Object.entries(r));
    byRef.set(r.ref_id, [...(byRef.get(r.ref_id) ?? []), m]);
  }
  for (const ref of list) {
    if (!present.has(ref.recordId)) {
      for (const o of owners) add(ref, unresolved(o.type));
      continue;
    }
    for (const m of byRef.get(ref.recordId) ?? [])
      for (const o of owners) {
        const v = m.get(o.column);
        if (typeof v === "string") add(ref, recordKey(o.type, v));
      }
  }
}

/** The organizations a principal can read anything in (its assignments' organizations). */
function organizationsOf(principal: Principal): string[] {
  return [...new Set(principal.grants.map((g) => g.organizationId))];
}

/**
 * The owner keys (`<type>:<id>`, and `?<type>` for an unresolved owner) among `owners` that the principal is not
 * admitted to. `sensitive` is the set of marked records (keys) of the principal's organizations.
 */
async function notAdmitted(
  db: DbOrTx,
  principal: Principal,
  owners: ReadonlySet<string>,
  sensitive: ReadonlyMap<string, string>,
): Promise<Set<string>> {
  const restricted = new Set<string>();
  const marked = new Map<SensitiveRecordType, string[]>();
  const wantUnresolved = new Set<SensitiveRecordType>();
  for (const o of owners) {
    if (o.startsWith("?")) {
      wantUnresolved.add(o.slice(1) as SensitiveRecordType);
      continue;
    }
    if (!sensitive.has(o)) continue;
    const [type, id] = o.split(":") as [SensitiveRecordType, string];
    marked.set(type, [...(marked.get(type) ?? []), id]);
  }
  // An unresolved owner of type X: decide over every marked record of type X (restricted if any is not admitted).
  for (const t of wantUnresolved)
    for (const k of sensitive.keys())
      if (k.startsWith(`${t}:`)) marked.set(t, [...(marked.get(t) ?? []), k.slice(t.length + 1)]);
  if (marked.size === 0) return restricted;
  const granted = await activeGrantKeys(db, principal);
  const targets = new Map<string, ResolvedTarget | null>();
  const notAdmittedTypes = new Set<SensitiveRecordType>();
  for (const [type, ids] of marked) {
    const records = await loadSensitiveRecords(db, type, ids);
    for (const id of new Set(ids)) {
      const rec = records.get(id);
      let admitted = false;
      if (rec !== undefined) {
        if (!targets.has(rec.transformationId))
          targets.set(
            rec.transformationId,
            await resolveTarget(db, { type: "transformation", id: rec.transformationId }),
          );
        const target = targets.get(rec.transformationId) ?? null;
        admitted =
          target !== null &&
          sensitivityClauseAdmits(
            principal,
            { granted },
            { recordType: type, recordId: id, isSensitive: true, target, partyUserIds: rec.partyUserIds },
          );
      }
      if (!admitted) {
        restricted.add(recordKey(type, id));
        notAdmittedTypes.add(type);
      }
    }
  }
  for (const t of wantUnresolved) if (notAdmittedTypes.has(t)) restricted.add(unresolved(t));
  return restricted;
}

/** The marked-sensitive records of the principal's organizations: key -> transformation id. */
async function markedInOrganizations(db: DbOrTx, principal: Principal): Promise<Map<string, string>> {
  const organizations = organizationsOf(principal);
  if (organizations.length === 0) return new Map();
  const rows = await db
    .selectFrom("record_sensitivity")
    .select(["record_type", "record_id", "transformation_id"])
    .where("is_sensitive", "=", true)
    .where("organization_id", "in", organizations)
    .execute();
  return new Map(rows.map((r) => [recordKey(r.record_type as SensitiveRecordType, r.record_id), r.transformation_id]));
}

/**
 * The `reachKey`s of `refs` that disclose a sensitive record the principal is not admitted to (the record itself or
 * one of its children). Counted as one policy decision per call.
 */
export async function restrictedRecordRefs(
  db: DbOrTx,
  principal: Principal,
  refs: readonly ReachRef[],
): Promise<Set<string>> {
  principal.tracker.decisions += 1;
  const out = new Set<string>();
  if (refs.length === 0) return out;
  const sensitive = await markedInOrganizations(db, principal);
  if (sensitive.size === 0) return out;
  const owners = await sensitiveOwnersOf(db, refs);
  if (owners.size === 0) return out;
  const all = new Set<string>();
  for (const s of owners.values()) for (const o of s) all.add(o);
  const restricted = await notAdmitted(db, principal, all, sensitive);
  if (restricted.size === 0) return out;
  for (const [key, s] of owners) if ([...s].some((o) => restricted.has(o))) out.add(key);
  return out;
}

/**
 * T-DG6-BE-Z7B (F-DG6-340; ADR-0051 §2 "Totals and rollups"; D-195 Q3): for each of `refs`, whether it discloses a
 * marked-sensitive record at all (`sensitive`) and whether the principal is not admitted to one (`restricted`, the
 * same set as `restrictedRecordRefs`). A response that aggregates these records carries `includesRestrictedRecords`
 * only when `sensitive` is not empty: `true` when `restricted` is not empty, `false` otherwise. One policy decision.
 */
export async function recordRefSensitivity(
  db: DbOrTx,
  principal: Principal,
  refs: readonly ReachRef[],
): Promise<{ sensitive: Set<string>; restricted: Set<string> }> {
  principal.tracker.decisions += 1;
  const out = { sensitive: new Set<string>(), restricted: new Set<string>() };
  if (refs.length === 0) return out;
  const marked = await markedInOrganizations(db, principal);
  if (marked.size === 0) return out;
  const owners = await sensitiveOwnersOf(db, refs);
  if (owners.size === 0) return out;
  const all = new Set<string>();
  for (const s of owners.values()) for (const o of s) all.add(o);
  const restricted = await notAdmitted(db, principal, all, marked);
  for (const [key, s] of owners) {
    const list = [...s];
    if (list.some((o) => restricted.has(o))) out.restricted.add(key);
    if (list.some((o) => marked.has(o) || restricted.has(o))) out.sensitive.add(key);
  }
  return out;
}

/**
 * 404 `not_found` when the record (a sensitive record or a child of one) discloses a sensitive record the principal
 * is not admitted to (ADR-0051 §2: existence not disclosed). Callers run the ADR-0006 read check first.
 */
export async function requireRecordReach(
  db: DbOrTx,
  principal: Principal,
  recordType: string,
  recordId: string,
  target: ResolvedTarget,
): Promise<void> {
  const restricted = await restrictedRecordRefs(db, principal, [{ recordType, recordId }]);
  if (restricted.size === 0) return;
  throw problems.notFound().withDenial({ ...denialOf("transformation.read", target), recordType, recordId });
}

/** The rows of `rows` whose record is not restricted for the principal (lists: the row is absent, ADR-0051 §2). */
export async function withoutRestricted<T>(
  db: DbOrTx,
  principal: Principal,
  rows: readonly T[],
  refOf: (row: T) => ReachRef,
): Promise<T[]> {
  const restricted = await restrictedRecordRefs(db, principal, rows.map(refOf));
  if (restricted.size === 0) return [...rows];
  return rows.filter((r) => !restricted.has(reachKey(refOf(r))));
}

// ------------------------------------------------------------------------------------------------ the route guard

/**
 * The route parameters that name a child that carries a sensitive record's values, and the record type each names (a
 * closed map; `urlIncludes` disambiguates a generic parameter name). Any route that has one of these parameters answers
 * 404 before its handler runs when the named child discloses a sensitive record the caller is not admitted to (reads
 * and writes alike), so a new child item route is covered by naming its parameter here.
 * The parents' own parameters (benefitId, businessCaseId, evidenceId) and the evidence links are deliberately NOT here:
 * their routes already apply ADR-0051 §2 (404, BE-B2's `readBenefitRow` / business-case reads) and §4 (the declared
 * 403 `evidence.parent_forbidden` of the evidence download, preview and links), which a blanket 404 would override.
 */
export const SENSITIVE_REACH_PARAMS: Readonly<
  Record<string, { readonly recordType: string; readonly urlIncludes?: string }>
> = {
  benefitMeasurementId: { recordType: "benefit_measurement" },
  benefitPlanValueId: { recordType: "benefit_plan_value" },
  benefitScenarioId: { recordType: "benefit_scenario" },
  benefitScenarioValueId: { recordType: "benefit_scenario_value" },
  benefitOverlapId: { recordType: "benefit_overlap" },
  financeValidationId: { recordType: "finance_validation" },
  lineId: { recordType: "business_case_line", urlIncludes: "/business-cases/" },
  // T-DG6-BE-Z4 (F-DG6-220): the benefit children of the sustainment and corrective registers (item, close, signals,
  // actions, submit, link remove), and the enabler link's remove route.
  correctiveCaseId: { recordType: "corrective_case" },
  transitionDecisionId: { recordType: "transition_decision" },
  performanceAreaLinkId: { recordType: "performance_area_link" },
  benefitEnablerId: { recordType: "benefit_enabler" },
  // T-DG6-BE-Z5 (F-DG6-300): a traceability link into a benefit (item, update, remove).
  traceLinkId: { recordType: "trace_link" },
};

const REACH_PARAMS: ReadonlyMap<string, { readonly recordType: string; readonly urlIncludes?: string }> = new Map(
  Object.entries(SENSITIVE_REACH_PARAMS),
);

/** The records a request's path parameters name (only well-formed uuids; anything else is the handler's 400). */
export function reachRefsOfParams(url: string, params: unknown): ReachRef[] {
  if (params === null || typeof params !== "object") return [];
  const refs: ReachRef[] = [];
  for (const [name, value] of Object.entries(params as Record<string, unknown>)) {
    const spec = REACH_PARAMS.get(name);
    if (spec === undefined || typeof value !== "string" || !UUID.test(value)) continue;
    if (spec.urlIncludes !== undefined && !url.includes(spec.urlIncludes)) continue;
    refs.push({ recordType: spec.recordType, recordId: value });
  }
  return refs;
}

/**
 * Registers the guard (server.ts, before the routes): a preHandler, so it runs after authentication, CSRF and the
 * central request check, and before every handler. A request without a principal (public routes, or the 401 the
 * identity hook already answered) is not touched; a request naming no SENSITIVE_REACH_PARAMS costs nothing; otherwise
 * one query when nothing in the caller's organizations is marked sensitive.
 */
export function registerSensitiveReachGuard(app: FastifyInstance, db: DbOrTx): void {
  app.addHook("preHandler", async (request) => {
    const principal = request.principal;
    if (!principal) return;
    const refs = reachRefsOfParams(request.routeOptions.url ?? "", request.params);
    if (refs.length === 0) return;
    const restricted = await restrictedRecordRefs(db, principal, refs);
    if (restricted.size === 0) return;
    const ref = refs.find((r) => restricted.has(reachKey(r)))!;
    const { transformationId: tid } = request.params as { transformationId?: unknown };
    const transformationId = typeof tid === "string" ? tid : null;
    const target =
      transformationId !== null && UUID.test(transformationId)
        ? await resolveTarget(db, { type: "transformation", id: transformationId })
        : null;
    const problem = problems.notFound();
    throw target === null
      ? problem
      : problem.withDenial({
          ...denialOf("transformation.read", target),
          recordType: ref.recordType,
          recordId: ref.recordId,
        });
  });
}
