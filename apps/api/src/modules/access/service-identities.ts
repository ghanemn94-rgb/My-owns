// Service identities of jobs and connectors: load, read authorization and the grant change (ADR-0053 §1, §9;
// REQ-S16-029; T-DG6-BE-J). The routes are in admin/service-identities.ts.
//
// What the application may change (0101 column privileges and service_identity_declaration_fixed): the GRANT
// (granted_permission_codes) and its reason, nothing else. The declaration (declared_permission_codes, scope,
// subject, sensitive access, labels) is written by migrations (jobs, 0114) or by a connector's creation (ADR-0055),
// and the grant can only be narrowed or restored within it (422 `service_identity.grant_exceeds_declaration`).
//
// Authorization (0103; permissions matrix §25):
//   - read: `operations.read` at ORGANIZATION level (ADM_TECH, TO, KDS, TD, AUD where the seeded role holds it at the
//     organization). A platform identity (every job) is visible to a holder at organization level in any
//     organization; a connector identity only to a holder in its organization. An unreadable identity answers 404.
//   - change: `service_identity.configure` at the same level (ADM_TECH). A configure code, never a business-approval
//     or Finance-validation one: narrowing a job's grant approves nothing (G1-G6) and never touches DG0-DG7.
// Every change: validation, If-Match (428/409), the row lock, authorization re-checked at commit on the reloaded
// grants, one audit event `service_identity.grant_changed` with prior and new version, no remote I/O.
import { sql, type DbOrTx, type ServiceIdentityTable, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import { reason as reasonRule } from "@mth/shared/schemas";
import type { Selectable } from "kysely";
import type { FastifyRequest } from "fastify";
import { record as audit } from "../audit/index.ts";
import { HttpProblem, iso, problems } from "../platform/index.ts";
import { authorize, organizationsWith, type Principal } from "./policy.ts";
import { auditContextOf, commitTimeDenial, refreshPrincipal } from "./request.ts";

export const SERVICE_IDENTITY_READ: Permission = "operations.read";
export const SERVICE_IDENTITY_CONFIGURE: Permission = "service_identity.configure";

export type ServiceIdentityRow = Selectable<ServiceIdentityTable>;

/** The contract's ServiceIdentity body. */
export interface ServiceIdentityBody {
  readonly id: string;
  readonly code: string;
  readonly subjectKind: "job" | "connector";
  readonly queueName: string | null;
  readonly connectorId: string | null;
  readonly scopeLevel: "platform" | "organization";
  readonly organizationId: string | null;
  readonly declaredPermissionCodes: string[];
  readonly grantedPermissionCodes: string[];
  readonly sensitiveAccess: "none" | "aggregate_only";
  readonly labelEn: string;
  readonly labelAr: string;
  readonly reason: string;
  readonly version: number;
  readonly updatedAt: string;
}

const reasonText = "Enter a reason of 3 to 1,000 characters.";

/** The exact refusals of ADR-0053 §2 (codes are i18n keys under `problems.`). */
export const serviceIdentityRefusals = {
  grantExceedsDeclaration: () =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "service_identity.grant_exceeds_declaration",
      title: "Business rule violated",
      detail: "A service identity can be granted only permissions that its job or connector declares.",
      errors: [
        {
          pointer: "/grantedPermissionCodes",
          code: "service_identity.grant_exceeds_declaration",
          message: "A service identity can be granted only permissions that its job or connector declares.",
        },
      ],
    }),
  reasonRequired: () =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "service_identity.reason_required",
      title: "Business rule violated",
      detail: reasonText,
      errors: [{ pointer: "/reason", code: "service_identity.reason_required", message: reasonText }],
    }),
} as const;

export function toServiceIdentity(r: ServiceIdentityRow): ServiceIdentityBody {
  return {
    id: r.id,
    code: r.code,
    subjectKind: r.subject_kind as ServiceIdentityBody["subjectKind"],
    queueName: r.queue_name,
    connectorId: r.connector_id,
    scopeLevel: r.scope_level as ServiceIdentityBody["scopeLevel"],
    organizationId: r.organization_id,
    declaredPermissionCodes: [...r.declared_permission_codes],
    grantedPermissionCodes: [...r.granted_permission_codes],
    sensitiveAccess: r.sensitive_access as ServiceIdentityBody["sensitiveAccess"],
    labelEn: r.label_en,
    labelAr: r.label_ar,
    reason: r.reason,
    version: r.version,
    updatedAt: iso(r.updated_at),
  };
}

export async function findServiceIdentity(
  db: DbOrTx,
  id: string,
  lock = false,
): Promise<ServiceIdentityRow | undefined> {
  let q = db.selectFrom("service_identity").selectAll().where("id", "=", id);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** Does the principal hold `permission` at the level of an organization (the organization exists)? */
async function holdsAtOrganization(
  db: DbOrTx,
  principal: Principal,
  permission: Permission,
  organizationId: string,
): Promise<boolean> {
  return (await authorize(db, principal, permission, { type: "organization", id: organizationId })).allowed;
}

/**
 * Whether the principal holds `permission` for the identity: at its organization (a connector identity), or at
 * organization level in any organization (a platform identity). Always consults the policy at least once.
 */
export async function holdsForIdentity(
  db: DbOrTx,
  principal: Principal,
  permission: Permission,
  row: Pick<ServiceIdentityRow, "organization_id">,
): Promise<boolean> {
  if (row.organization_id !== null) return holdsAtOrganization(db, principal, permission, row.organization_id);
  for (const organizationId of organizationsWith(principal, permission))
    if (await holdsAtOrganization(db, principal, permission, organizationId)) return true;
  return false;
}

/** The identity if the principal may read it; 404 otherwise (missing and unreadable are indistinguishable). */
export async function visibleServiceIdentity(
  db: DbOrTx,
  principal: Principal,
  id: string,
): Promise<ServiceIdentityRow> {
  const row = await findServiceIdentity(db, id);
  if (!row) {
    principal.tracker.decisions += 1;
    throw problems.notFound();
  }
  if (!(await holdsForIdentity(db, principal, SERVICE_IDENTITY_READ, row))) throw problems.notFound();
  return row;
}

export interface ServiceIdentityListQuery {
  readonly organizationId: string;
  readonly subjectKind?: "job" | "connector";
  /** Exclusive lower bound (code, id) of the page (decoded cursor). */
  readonly after?: readonly [string, string] | null;
  readonly limit: number;
}

/**
 * The identities an organization-level `operations.read` holder of `organizationId` sees: the platform identities
 * (every job) and the organization's own (its connectors), by code. 404 for an unknown organization, 403 when the
 * caller does not hold the read at the organization.
 */
export async function listServiceIdentities(
  db: DbOrTx,
  principal: Principal,
  query: ServiceIdentityListQuery,
): Promise<ServiceIdentityRow[]> {
  const decision = await authorize(db, principal, SERVICE_IDENTITY_READ, {
    type: "organization",
    id: query.organizationId,
  });
  if (!decision.target) throw problems.notFound();
  if (!decision.allowed) throw problems.forbidden();
  let q = db
    .selectFrom("service_identity")
    .selectAll()
    .where((eb) => eb.or([eb("organization_id", "is", null), eb("organization_id", "=", query.organizationId)]));
  if (query.subjectKind) q = q.where("subject_kind", "=", query.subjectKind);
  if (query.after) q = q.where(sql<boolean>`(code, id) > (${query.after[0]}, ${query.after[1]}::uuid)`);
  return q
    .orderBy("code")
    .orderBy("id")
    .limit(query.limit + 1)
    .execute();
}

/** The reason of a change: the shared rule (trimmed 3-1000 characters, not blank, no invalid character), else 422. */
export function checkedServiceIdentityReason(value: string): string {
  const r = reasonRule.safeParse(value);
  if (!r.success) throw serviceIdentityRefusals.reasonRequired();
  return r.data;
}

/** The requested grant within the declaration (order of the declaration), else 422. */
export function grantWithinDeclaration(declared: readonly string[], requested: readonly string[]): string[] {
  const allowed = new Set(declared);
  if (requested.some((c) => !allowed.has(c))) throw serviceIdentityRefusals.grantExceedsDeclaration();
  const wanted = new Set(requested);
  return declared.filter((c) => wanted.has(c));
}

async function requireConfigure(db: DbOrTx, principal: Principal, row: ServiceIdentityRow): Promise<void> {
  if (!(await holdsForIdentity(db, principal, SERVICE_IDENTITY_CONFIGURE, row))) throw problems.forbidden();
}

export interface PutServiceIdentityInput {
  readonly grantedPermissionCodes: readonly string[];
  readonly reason: string;
}

/**
 * putServiceIdentity (ADR-0053 §1): narrow or restore the grant within the declaration, with a reason. The caller
 * passed the read gate (404) and the configure gate (403) before; this re-checks both at commit on the reloaded grants
 * (a right lost meanwhile is 403, F-DG2-440), then the version (409) and the declaration (422).
 */
export async function putServiceIdentity(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
  input: PutServiceIdentityInput,
): Promise<ServiceIdentityRow> {
  const locked = await findServiceIdentity(tx, id, true);
  if (!locked) throw problems.notFound();
  const fresh = await refreshPrincipal(tx, request);
  try {
    if (!(await holdsForIdentity(tx, fresh, SERVICE_IDENTITY_READ, locked))) throw problems.notFound();
    await requireConfigure(tx, fresh, locked);
  } catch (err) {
    if (err instanceof HttpProblem && err.status === 404)
      throw problems.forbidden("Your access to this record changed while the request was in progress.");
    throw commitTimeDenial(err);
  }
  if (locked.version !== expectedVersion) throw problems.versionConflict(locked.version);
  const granted = grantWithinDeclaration(locked.declared_permission_codes, input.grantedPermissionCodes);
  const me = fresh.userId;
  const updated = await tx
    .updateTable("service_identity")
    .set({
      granted_permission_codes: granted,
      reason: input.reason,
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditContextOf(request), {
    action: "service_identity.grant_changed",
    recordType: "service_identity",
    recordId: id,
    organizationId: locked.organization_id,
    priorVersion: locked.version,
    newVersion: updated.version,
    reason: input.reason,
    changes: {
      granted_permission_codes: { from: [...locked.granted_permission_codes], to: granted },
      reason: { from: locked.reason, to: input.reason },
    },
  });
  return updated;
}

/** The read and configure gates of a change, before the transaction (404, then 403). */
export async function requireServiceIdentityChange(
  db: DbOrTx,
  principal: Principal,
  id: string,
): Promise<ServiceIdentityRow> {
  const row = await visibleServiceIdentity(db, principal, id);
  await requireConfigure(db, principal, row);
  return row;
}
