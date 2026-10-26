// The ReadScope port: one read boundary derived from the ADR-0006 policy (slice E; ADR-0051 §1; REQ-S10-004).
// T-DG6-BE-A created the wiring point; T-DG6-BE-B fills it (p6-work-split §E/F.2).
//
//   predicate(cols)  = scopeFilter(principal, permission, cols)  AND  the sensitivity clause of ADR-0051 §2, in SQL;
//   admits(row)      = decide(principal, permission, target)     AND  the same sensitivity clause, in memory.
//
// The sensitivity clause: a record of a sensitive type whose `record_sensitivity.is_sensitive` is true is admitted iff
//   1. the principal holds an ACTIVE `sensitive_record_grant` for it, or
//   2. the principal is a named party of the record (the caller passes the party columns / values), or
//   3. the principal holds `sensitive_record.grant` at the record's scope (the people who decide grants can see them).
// No row (or is_sensitive = false) means "not sensitive", so every DG1-DG5 read is unchanged until a record is marked.
// Holding AUD admits nothing by itself; a service principal holds no grant and is no named party (ADR-0053).
//
// `readScopeFor` loads, once per request and never cached across requests (ADR-0006), the principal's active grants
// and the sensitive records of the organizations its assignments name (the in-memory `admits` needs the flag; the SQL
// `predicate` reads `record_sensitivity` itself). A revocation or an unmark applies to the next request.
//
// The consumers - search (ADR-0057), assistant retrieval (ADR-0059), report and export selection
// (reporting/exports/jobs.ts), job and connector reads under a service identity (ADR-0053) - import it from access;
// access imports none of them. The parity test (read-scope.test.ts, test/integration/access/read-scope-parity.test.ts)
// proves predicate <=> admits <=> the record view.
import { sql, type DbOrTx, type Expression, type SqlBool } from "@mth/db";
import type { Permission } from "@mth/shared";
import { scopeFilter, type Principal } from "./policy.ts";
import { decide, type ResolvedTarget } from "./rules.ts";

/** The record types that can be marked sensitive (D-195 Q3; the closed CHECK set of 0098, ADR-0051 §2). */
export type SensitiveRecordType = "benefit" | "business_case" | "evidence";

/** The closed set, in a fixed order (ADR-0051 §2). */
export const SENSITIVE_RECORD_TYPE_LIST: readonly SensitiveRecordType[] = ["benefit", "business_case", "evidence"];

/** The permission that lets a principal mark records and grant access (and admits it to sensitive records, §2 rule 3). */
export const SENSITIVE_GRANT_PERMISSION = "sensitive_record.grant" as const satisfies Permission;
/** The permission that reads grants and flags (metadata only; ADR-0051 §7). */
export const SENSITIVE_READ_PERMISSION = "sensitive_record.read" as const satisfies Permission;

/** The columns of a queried row that the read decision needs (ADR-0051 §1). */
export interface ReadScopeColumns {
  /** null: a record type that cannot be sensitive. */
  readonly recordType: SensitiveRecordType | null;
  readonly recordId: Expression<string>;
  readonly organizationId: Expression<string>;
  /**
   * The business unit of the row's scope. For a transformation-level row (transformationId not null) that omits it,
   * the predicate reads the transformation's own business unit, so business-unit grants apply exactly as in `decide`.
   */
  readonly businessUnitId?: Expression<string | null>;
  readonly transformationId: Expression<string | null>;
  /** The row's named parties (ADR-0051 §2). */
  readonly partyUserIds?: readonly Expression<string | null>[];
}

/** One principal's read boundary for one permission, loaded once per request (ADR-0051 §1). */
export interface ReadScope {
  /** SQL predicate for list, search, export and retrieval queries. */
  predicate(cols: ReadScopeColumns): Expression<SqlBool>;
  /** The same decision for a row already in memory (search hits, retrieval chunks, job outputs). */
  admits(row: {
    recordType: SensitiveRecordType | null;
    recordId: string;
    target: ResolvedTarget;
    partyUserIds: readonly (string | null)[];
  }): boolean;
}

/** The signature of `readScopeFor` (ADR-0051 §1). */
export type ReadScopeFactory = (db: DbOrTx, principal: Principal, permission: Permission) => Promise<ReadScope>;

/** What the in-memory sensitivity clause needs about the principal (loaded once per request). */
export interface SensitivityFacts {
  /** "<recordType>:<recordId>" of every record currently marked sensitive that the principal could meet. */
  readonly sensitive: ReadonlySet<string>;
  /** "<recordType>:<recordId>" of every ACTIVE grant held by the principal. */
  readonly granted: ReadonlySet<string>;
}

export const recordKey = (recordType: SensitiveRecordType, recordId: string): string => `${recordType}:${recordId}`;

/**
 * The §2 sensitivity clause in memory, for a record whose sensitivity state is known (`isSensitive`). Counted as a
 * policy decision when it consults the policy (rule 3).
 */
export function sensitivityClauseAdmits(
  principal: Principal,
  facts: Pick<SensitivityFacts, "granted">,
  row: {
    recordType: SensitiveRecordType;
    recordId: string;
    isSensitive: boolean;
    target: ResolvedTarget;
    partyUserIds: readonly (string | null)[];
  },
): boolean {
  if (!row.isSensitive) return true;
  if (facts.granted.has(recordKey(row.recordType, row.recordId))) return true;
  const me = principal.userId;
  if (principal.kind === "user" && me !== null && row.partyUserIds.some((p) => p !== null && p === me)) return true;
  principal.tracker.decisions += 1;
  return decide(principal, SENSITIVE_GRANT_PERMISSION, row.target).allowed;
}

/** The principal's ACTIVE grants as "<recordType>:<recordId>" keys (a service principal holds none). */
export async function activeGrantKeys(db: DbOrTx, principal: Principal): Promise<Set<string>> {
  if (principal.kind !== "user" || principal.userId === null) return new Set();
  const rows = await db
    .selectFrom("sensitive_record_grant")
    .select(["record_type", "record_id"])
    .where("grantee_user_id", "=", principal.userId)
    .where("status", "=", "active")
    .execute();
  return new Set(rows.map((r) => recordKey(r.record_type as SensitiveRecordType, r.record_id)));
}

/** Loads the facts `admits` needs: the active grants and the sensitive records of the principal's organizations. */
export async function loadSensitivityFacts(db: DbOrTx, principal: Principal): Promise<SensitivityFacts> {
  const organizations = [...new Set(principal.grants.map((g) => g.organizationId))];
  const granted = await activeGrantKeys(db, principal);
  if (organizations.length === 0) return { sensitive: new Set(), granted };
  const rows = await db
    .selectFrom("record_sensitivity")
    .select(["record_type", "record_id"])
    .where("is_sensitive", "=", true)
    .where("organization_id", "in", organizations)
    .execute();
  return { sensitive: new Set(rows.map((r) => recordKey(r.record_type as SensitiveRecordType, r.record_id))), granted };
}

/** The scope level of a row from its hierarchy columns (the three sensitive types are transformation-level). */
function levelOf(cols: ReadScopeColumns): Expression<string> {
  const bu = cols.businessUnitId ?? sql<string | null>`NULL::uuid`;
  return sql<string>`(CASE WHEN ${cols.transformationId} IS NOT NULL THEN 'transformation' WHEN ${bu} IS NOT NULL THEN 'business_unit' ELSE 'organization' END)`;
}

/** The business-unit column: the caller's, or the transformation's own business unit (see ReadScopeColumns). */
function businessUnitOf(cols: ReadScopeColumns): Expression<string | null> {
  if (cols.businessUnitId) return cols.businessUnitId;
  return sql<
    string | null
  >`(SELECT rs_t.business_unit_id FROM transformation rs_t WHERE rs_t.id = ${cols.transformationId})`;
}

/** The §2 sensitivity clause as SQL over a row (rules 1-3), given the principal's active grant keys. */
export function sensitivityClauseSql(
  principal: Principal,
  granted: ReadonlySet<string>,
  cols: ReadScopeColumns,
): Expression<SqlBool> {
  const type = cols.recordType;
  if (type === null) return sql<SqlBool>`TRUE`;
  const grantedIds = [...granted].filter((k) => k.startsWith(`${type}:`)).map((k) => k.slice(type.length + 1));
  const parts: Expression<SqlBool>[] = [
    sql<SqlBool>`NOT EXISTS (SELECT 1 FROM record_sensitivity rs_s WHERE rs_s.record_type = ${type} AND rs_s.record_id = ${cols.recordId} AND rs_s.is_sensitive)`,
  ];
  if (grantedIds.length > 0) parts.push(sql<SqlBool>`${cols.recordId} = ANY(${grantedIds}::uuid[])`);
  const me = principal.kind === "user" ? principal.userId : null;
  if (me !== null)
    for (const party of cols.partyUserIds ?? []) parts.push(sql<SqlBool>`${party} IS NOT DISTINCT FROM ${me}::uuid`);
  parts.push(
    scopeFilter(principal, SENSITIVE_GRANT_PERMISSION, {
      level: levelOf(cols),
      organizationId: cols.organizationId,
      businessUnitId: businessUnitOf(cols),
      transformationId: cols.transformationId,
    }),
  );
  return sql<SqlBool>`(${sql.join(parts, sql` OR `)})`;
}

/**
 * The factory (ADR-0051 §1): the principal's read boundary for `permission`, for this request only. Loads the active
 * grants and the sensitive-record set once; both forms then decide without further I/O.
 */
export const readScopeFor: ReadScopeFactory = async (db, principal, permission) => {
  const facts = await loadSensitivityFacts(db, principal);
  return {
    predicate(cols) {
      const base = scopeFilter(principal, permission, {
        level: levelOf(cols),
        organizationId: cols.organizationId,
        businessUnitId: businessUnitOf(cols),
        transformationId: cols.transformationId,
      });
      return sql<SqlBool>`(${base} AND ${sensitivityClauseSql(principal, facts.granted, cols)})`;
    },
    admits(row) {
      principal.tracker.decisions += 1;
      if (!decide(principal, permission, row.target).allowed) return false;
      if (row.recordType === null) return true;
      return sensitivityClauseAdmits(principal, facts, {
        recordType: row.recordType,
        recordId: row.recordId,
        isSensitive: facts.sensitive.has(recordKey(row.recordType, row.recordId)),
        target: row.target,
        partyUserIds: row.partyUserIds,
      });
    },
  };
};
