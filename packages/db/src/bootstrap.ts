// Safe production initialization (§19 item 3, data dictionary "organization" invariant): the FIRST organization and
// its first administrator come from this CLI command, never from a migration and never from demo data.
//
// What it creates, in one transaction, all audited (actor_type = system, source = cli):
//  - the organization;
//  - a disabled "System (bootstrap)" user that is recorded as the grantor (scoped_assignment.granted_by is NOT NULL);
//  - the administrator user, bound to the given IdP identity (issuer, subject) - never by e-mail alone;
//  - two organization-scope grants for the administrator: ADM_ACCESS and ADM_TECH.
// The administrator receives NO business role: technical administrators are not business approvers and cannot read
// business records (ADR-0006). Business roles are granted afterwards, explicitly and audited, through the API.
// It refuses to run when any organization already exists.
import { v7 as uuidv7 } from "uuid";
import { insertAuditEvent, type AuditActor } from "./audit.ts";
import type { Db } from "./pool.ts";

export interface BootstrapInput {
  readonly orgCode: string;
  readonly orgNameEn: string;
  readonly orgNameAr: string;
  readonly defaultTimezone: string;
  readonly defaultCurrency: string;
  readonly adminDisplayName: string;
  readonly adminEmail: string | null;
  readonly adminIssuer: string;
  readonly adminSubject: string;
}

export interface BootstrapResult {
  readonly organizationId: string;
  readonly adminUserId: string;
  readonly systemUserId: string;
  readonly assignmentIds: readonly string[];
}

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapError";
  }
}

export const BOOTSTRAP_ADMIN_ROLES = ["ADM_ACCESS", "ADM_TECH"] as const;

const CODE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

export function validateBootstrapInput(input: BootstrapInput): string[] {
  const problems: string[] = [];
  if (!CODE.test(input.orgCode)) problems.push("--org-code must match ^[A-Z0-9][A-Z0-9_-]{0,31}$");
  for (const [flag, v] of [
    ["--org-name-en", input.orgNameEn],
    ["--org-name-ar", input.orgNameAr],
    ["--admin-name", input.adminDisplayName],
  ] as const) {
    if (v.trim().length < 1 || v.length > 200) problems.push(`${flag} must be 1-200 characters`);
  }
  if (input.adminEmail !== null && !/^[^\s@]+@[^\s@]+$/.test(input.adminEmail))
    problems.push("--admin-email is not an e-mail address");
  if (input.adminIssuer.length < 1 || input.adminIssuer.length > 512)
    problems.push("--admin-issuer must be 1-512 characters");
  if (input.adminIssuer === "urn:mth:dev-local")
    problems.push("--admin-issuer may not be the dev-login issuer urn:mth:dev-local");
  if (input.adminSubject.length < 1 || input.adminSubject.length > 255)
    problems.push("--admin-subject must be 1-255 characters");
  return problems;
}

export async function bootstrap(db: Db, input: BootstrapInput): Promise<BootstrapResult> {
  const problems = validateBootstrapInput(input);
  if (problems.length > 0) throw new BootstrapError(problems.join("; "));
  return db.transaction().execute(async (tx) => {
    // Serialize concurrent bootstrap attempts, then refuse if anything exists.
    await tx.selectNoFrom((eb) => eb.fn("pg_advisory_xact_lock", [eb.lit(7_302_190_002)]).as("l")).execute();
    const existing = await tx.selectFrom("organization").select("id").limit(1).executeTakeFirst();
    if (existing) throw new BootstrapError("refusing to bootstrap: an organization already exists");

    const organizationId = uuidv7();
    const systemUserId = uuidv7();
    const adminUserId = uuidv7();
    const actor: AuditActor = { actorType: "system", actorUserId: null, source: "cli" };

    await tx
      .insertInto("organization")
      .values({
        id: organizationId,
        code: input.orgCode,
        name_en: input.orgNameEn.trim(),
        name_ar: input.orgNameAr.trim(),
        default_timezone: input.defaultTimezone,
        default_currency: input.defaultCurrency,
        created_by: null,
        updated_by: null,
      })
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "organization.create",
      recordType: "organization",
      recordId: organizationId,
      organizationId,
      newVersion: 1,
      reason: "mth-db bootstrap: first organization",
    });

    await tx
      .insertInto("app_user")
      .values({
        id: systemUserId,
        organization_id: organizationId,
        display_name: "System (bootstrap)",
        status: "disabled",
        created_by: null,
        updated_by: null,
      })
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "app_user.create",
      recordType: "app_user",
      recordId: systemUserId,
      organizationId,
      newVersion: 1,
      reason: "mth-db bootstrap: disabled system grantor (cannot sign in)",
    });

    await tx
      .insertInto("app_user")
      .values({
        id: adminUserId,
        organization_id: organizationId,
        display_name: input.adminDisplayName.trim(),
        email: input.adminEmail,
        created_by: null,
        updated_by: null,
      })
      .execute();
    await tx
      .insertInto("user_identity")
      .values({
        id: uuidv7(),
        user_id: adminUserId,
        issuer: input.adminIssuer,
        subject: input.adminSubject,
        email_at_binding: input.adminEmail,
      })
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "app_user.create",
      recordType: "app_user",
      recordId: adminUserId,
      organizationId,
      newVersion: 1,
      reason: "mth-db bootstrap: first administrator",
      changes: { identity: { from: null, to: { issuer: input.adminIssuer, subject: input.adminSubject } } },
    });

    const roles = await tx
      .selectFrom("role")
      .select(["id", "code", "kind"])
      .where("code", "in", [...BOOTSTRAP_ADMIN_ROLES])
      .execute();
    if (roles.length !== BOOTSTRAP_ADMIN_ROLES.length)
      throw new BootstrapError("role seed missing: run `mth-db migrate` first");
    const assignmentIds: string[] = [];
    for (const role of roles) {
      const id = uuidv7();
      await tx
        .insertInto("scoped_assignment")
        .values({
          id,
          organization_id: organizationId,
          user_id: adminUserId,
          role_id: role.id,
          scope_type: "organization",
          scope_id: organizationId,
          reason: "mth-db bootstrap: first administrator (technical administration only, no business role)",
          granted_by: systemUserId,
          created_by: null,
          updated_by: null,
        })
        .execute();
      await insertAuditEvent(tx, actor, {
        action: "scoped_assignment.create",
        recordType: "scoped_assignment",
        recordId: id,
        organizationId,
        newVersion: 1,
        reason: "mth-db bootstrap: first administrator",
        changes: {
          roleCode: { from: null, to: role.code },
          scope: { from: null, to: { type: "organization", id: organizationId } },
        },
      });
      assignmentIds.push(id);
    }
    return { organizationId, adminUserId, systemUserId, assignmentIds };
  });
}
