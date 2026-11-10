// The worker twin of the API `ReadScope` for service principals (ADR-0053 §1; ADR-0051 §1; REQ-S16-029; D-195 Q13;
// T-DG6-BE-J). ADR-0002 rule 5: the worker imports no API code, so this file restates, for the one grant shape a
// service principal has, what apps/api/src/modules/access/read-scope.ts decides. The parity test
// (apps/api/test/integration/operations/service-identity-scope.test.ts) runs both on the same fixture and requires the
// same rows and the same in-memory answers.
//
// A service principal is built per run and per organization from its `service_identity` row (kit.ts servicePrincipal):
//   - it holds exactly the GRANTED codes (granted_permission_codes, never more than the declaration), at organization
//     scope, applying downward (the API equivalent: one organization-scope grant whose role inherits downward);
//   - it is never a named party and holds no `sensitive_record_grant`, and it can never hold `sensitive_record.grant`
//     (a configure code; 0101 service_identity_guard), so the ADR-0051 §2 clause excludes every record marked
//     sensitive, exactly as for a reader without a grant;
//   - `sensitive_access = 'aggregate_only'` admits sensitive records ONLY into aggregate computations (use
//     "aggregate"), never into a per-record output (use "record": a notification title, a work item, an export row).
// A read outside the scope throws ServiceScopeViolation (`service_identity.out_of_scope`); a run whose identity row is
// missing throws ServiceIdentityMissing (`service_identity.missing`). Neither is a business decision: a service
// identity never holds a business-approval or Finance-validation right, and nothing here reads or writes DG0-DG7.
import { sql, type DbOrTx, type Expression, type SqlBool } from "@mth/db";

/** The record types that can be marked sensitive (ADR-0051 §2; the closed CHECK set of 0098). */
export type ServiceSensitiveRecordType = "benefit" | "business_case" | "evidence";

/** How a read is used: a per-record output, or an aggregate computation (ADR-0053 §1). */
export type ServiceReadUse = "record" | "aggregate";

export type SensitiveAccess = "none" | "aggregate_only";

/** The exact codes of ADR-0053 §2 (job errors). */
export const SERVICE_IDENTITY_OUT_OF_SCOPE = "service_identity.out_of_scope";
export const SERVICE_IDENTITY_MISSING = "service_identity.missing";

/** A service-identity refusal of a job run (ADR-0053 §1, §2). Its `code` is the failure-queue error code. */
export class ServiceIdentityError extends Error {
  readonly code: typeof SERVICE_IDENTITY_OUT_OF_SCOPE | typeof SERVICE_IDENTITY_MISSING;
  constructor(code: typeof SERVICE_IDENTITY_OUT_OF_SCOPE | typeof SERVICE_IDENTITY_MISSING, message: string) {
    super(message);
    this.code = code;
    this.name = "ServiceIdentityError";
  }
}

/** The job tried to read a record (or use a permission) outside its service identity's scope. */
export class ServiceScopeViolation extends ServiceIdentityError {
  constructor() {
    super(SERVICE_IDENTITY_OUT_OF_SCOPE, "The job tried to read a record outside its service identity's scope.");
    this.name = "ServiceScopeViolation";
  }
}

/** The job has no service identity, so it did not run. */
export class ServiceIdentityMissing extends ServiceIdentityError {
  constructor() {
    super(SERVICE_IDENTITY_MISSING, "The job has no service identity, so it did not run.");
    this.name = "ServiceIdentityMissing";
  }
}

/** True for a service-identity refusal (any realm: matched by name and code, not by class identity). */
export function isServiceIdentityError(err: unknown): err is ServiceIdentityError {
  if (err instanceof ServiceIdentityError) return true;
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === SERVICE_IDENTITY_OUT_OF_SCOPE || code === SERVICE_IDENTITY_MISSING;
}

/** One service identity acting for one organization in one run. */
export interface ServicePrincipal {
  readonly kind: "service";
  readonly identityId: string;
  /** `job:<queue>` or `connector:<connector id>`. */
  readonly code: string;
  /** The organization this principal reads in (a platform job builds one principal per organization). */
  readonly organizationId: string;
  /** The GRANTED codes (a subset of the declaration; 0101 service_identity_grant_within_declaration). */
  readonly permissions: ReadonlySet<string>;
  readonly sensitiveAccess: SensitiveAccess;
}

/** The columns of a queried row that the decision needs (the API ReadScopeColumns, minus what a service ignores). */
export interface ServiceReadScopeColumns {
  /** null: a record type that cannot be sensitive. */
  readonly recordType: ServiceSensitiveRecordType | null;
  readonly recordId: Expression<string>;
  readonly organizationId: Expression<string>;
}

/** A record already in memory. */
export interface ServiceReadRow {
  readonly recordType: ServiceSensitiveRecordType | null;
  readonly recordId: string;
  readonly organizationId: string;
}

/** A service principal's read boundary for one permission, loaded once per run (the twin of the API ReadScope). */
export interface ServiceReadScope {
  readonly principal: ServicePrincipal;
  readonly permission: string;
  /** SQL predicate for list and aggregate reads. */
  predicate(cols: ServiceReadScopeColumns, use?: ServiceReadUse): Expression<SqlBool>;
  /** The same decision for a row already in memory. */
  admits(row: ServiceReadRow, use?: ServiceReadUse): boolean;
}

const sensitiveKey = (recordType: ServiceSensitiveRecordType, recordId: string) => `${recordType}:${recordId}`;

/** Whether the use bypasses the sensitivity clause: aggregates of an `aggregate_only` identity. */
function sensitiveAdmitted(principal: ServicePrincipal, use: ServiceReadUse): boolean {
  return use === "aggregate" && principal.sensitiveAccess === "aggregate_only";
}

/**
 * The factory: the principal's read boundary for `permission` in this run. Loads the records of the principal's
 * organization that are marked sensitive once (the in-memory `admits` needs the flag; the SQL predicate reads
 * `record_sensitivity` itself). Never cached across runs, so an unmark applies to the next run.
 */
export async function serviceReadScopeFor(
  db: DbOrTx,
  principal: ServicePrincipal,
  permission: string,
): Promise<ServiceReadScope> {
  const rows = await db
    .selectFrom("record_sensitivity")
    .select(["record_type", "record_id"])
    .where("is_sensitive", "=", true)
    .where("organization_id", "=", principal.organizationId)
    .execute();
  const sensitive = new Set(rows.map((r) => sensitiveKey(r.record_type as ServiceSensitiveRecordType, r.record_id)));
  const held = principal.permissions.has(permission);
  return {
    principal,
    permission,
    predicate(cols, use = "record") {
      if (!held) return sql<SqlBool>`FALSE`;
      const base = sql<SqlBool>`${cols.organizationId} = ${principal.organizationId}::uuid`;
      if (cols.recordType === null || sensitiveAdmitted(principal, use)) return sql<SqlBool>`(${base})`;
      return sql<SqlBool>`(${base} AND NOT EXISTS (SELECT 1 FROM record_sensitivity ss_s WHERE ss_s.record_type = ${cols.recordType} AND ss_s.record_id = ${cols.recordId} AND ss_s.is_sensitive))`;
    },
    admits(row, use = "record") {
      if (!held || row.organizationId !== principal.organizationId) return false;
      if (row.recordType === null || sensitiveAdmitted(principal, use)) return true;
      return !sensitive.has(sensitiveKey(row.recordType, row.recordId));
    },
  };
}

/**
 * A single-record read under a service identity: returns when the scope admits the record, otherwise throws
 * ServiceScopeViolation (`service_identity.out_of_scope`). The ADR-0053 §1 `requireServiceRead`.
 */
export function requireServiceRead(
  scope: ServiceReadScope,
  record: ServiceReadRow,
  use: ServiceReadUse = "record",
): void {
  if (!scope.admits(record, use)) throw new ServiceScopeViolation();
}

/**
 * The API grant equivalent of a service principal (for the parity test): one organization-scope grant whose role
 * inherits downward, holding exactly the granted codes.
 */
export function apiGrantEquivalent(principal: ServicePrincipal) {
  return {
    assignmentId: principal.identityId,
    roleCode: principal.code,
    inheritsDownward: true,
    scopeType: "organization" as const,
    scopeId: principal.organizationId,
    organizationId: principal.organizationId,
    permissions: principal.permissions,
  };
}
