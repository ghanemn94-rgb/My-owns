// Development-only seed of SYNTHETIC sign-in users for AUTH_MODE=dev (ADR-0005 §5, REQ-S18-001).
// Never part of production initialization:
//  - `seedDev` refuses unless NODE_ENV is not "production" AND AUTH_MODE is "dev";
//  - the data file lives in packages/db/seeds/dev/, which package.json "files" does not publish.
// It creates a synthetic organization, business units, users bound to issuer urn:mth:dev-local and their scoped
// grants, each audited (actor_type = system, source = cli). It is idempotent: an existing SYN-DEV organization
// means "already seeded" and nothing is written.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { v7 as uuidv7 } from "uuid";
import { insertAuditEvent, type AuditActor } from "./audit.ts";
import { DEV_ISSUER } from "./constants.ts";
import type { Db } from "./pool.ts";

interface SeedFile {
  organization: { id: string; code: string; nameEn: string; nameAr: string };
  businessUnits: { id: string; code: string; nameEn: string; nameAr: string; parent: string | null }[];
  grantor: { id: string; displayName: string };
  users: {
    id: string;
    subject: string;
    displayName: string;
    email: string;
    preferredLocale: "ar" | "en";
    grants: { role: string; scope: "organization" | "business_unit"; businessUnit?: string }[];
  }[];
}

export class DevSeedRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevSeedRefused";
  }
}

export function devSeedFile(): string {
  return fileURLToPath(new URL("../seeds/dev/synthetic-dev-users.json", import.meta.url));
}

export function assertDevSeedAllowed(env: { NODE_ENV?: string | undefined; AUTH_MODE?: string | undefined }): void {
  if (env.NODE_ENV === "production")
    throw new DevSeedRefused("refusing to seed synthetic dev users with NODE_ENV=production");
  if (env.AUTH_MODE !== "dev") throw new DevSeedRefused("refusing to seed synthetic dev users unless AUTH_MODE=dev");
}

export async function seedDev(
  db: Db,
  env: { NODE_ENV?: string | undefined; AUTH_MODE?: string | undefined },
  file: string = devSeedFile(),
): Promise<{ seeded: boolean; users: string[] }> {
  assertDevSeedAllowed(env);
  const data = JSON.parse(readFileSync(file, "utf8")) as SeedFile;
  return db.transaction().execute(async (tx) => {
    const existing = await tx
      .selectFrom("organization")
      .select("id")
      .where("code", "=", data.organization.code)
      .executeTakeFirst();
    if (existing) return { seeded: false, users: data.users.map((u) => u.subject) };

    const orgId = data.organization.id;
    const actor: AuditActor = { actorType: "system", actorUserId: null, source: "cli" };
    const reason = "mth-db seed-dev: SYNTHETIC development data";
    await tx
      .insertInto("organization")
      .values({
        id: orgId,
        code: data.organization.code,
        name_en: data.organization.nameEn,
        name_ar: data.organization.nameAr,
        created_by: null,
        updated_by: null,
      })
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "organization.create",
      recordType: "organization",
      recordId: orgId,
      organizationId: orgId,
      newVersion: 1,
      reason,
    });

    const buIds = new Map<string, string>();
    for (const bu of data.businessUnits) {
      const parent = bu.parent === null ? null : buIds.get(bu.parent);
      if (parent === undefined) throw new Error(`dev seed: parent ${bu.parent} must be listed before ${bu.code}`);
      await tx
        .insertInto("business_unit")
        .values({
          id: bu.id,
          organization_id: orgId,
          parent_business_unit_id: parent,
          code: bu.code,
          name_en: bu.nameEn,
          name_ar: bu.nameAr,
          created_by: null,
          updated_by: null,
        })
        .execute();
      await insertAuditEvent(tx, actor, {
        action: "business_unit.create",
        recordType: "business_unit",
        recordId: bu.id,
        organizationId: orgId,
        newVersion: 1,
        reason,
      });
      buIds.set(bu.code, bu.id);
    }

    await tx
      .insertInto("app_user")
      .values({
        id: data.grantor.id,
        organization_id: orgId,
        display_name: data.grantor.displayName,
        status: "disabled",
        created_by: null,
        updated_by: null,
      })
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "app_user.create",
      recordType: "app_user",
      recordId: data.grantor.id,
      organizationId: orgId,
      newVersion: 1,
      reason,
    });

    const roles = new Map((await tx.selectFrom("role").select(["id", "code"]).execute()).map((r) => [r.code, r.id]));
    for (const u of data.users) {
      await tx
        .insertInto("app_user")
        .values({
          id: u.id,
          organization_id: orgId,
          display_name: u.displayName,
          email: u.email,
          preferred_locale: u.preferredLocale,
          created_by: null,
          updated_by: null,
        })
        .execute();
      await tx
        .insertInto("user_identity")
        .values({ id: uuidv7(), user_id: u.id, issuer: DEV_ISSUER, subject: u.subject, email_at_binding: u.email })
        .execute();
      await insertAuditEvent(tx, actor, {
        action: "app_user.create",
        recordType: "app_user",
        recordId: u.id,
        organizationId: orgId,
        newVersion: 1,
        reason,
      });
      for (const g of u.grants) {
        const roleId = roles.get(g.role);
        if (!roleId) throw new Error(`dev seed: unknown role ${g.role}`);
        const scopeId = g.scope === "organization" ? orgId : buIds.get(g.businessUnit ?? "");
        if (!scopeId) throw new Error(`dev seed: unknown business unit ${g.businessUnit}`);
        const id = uuidv7();
        await tx
          .insertInto("scoped_assignment")
          .values({
            id,
            organization_id: orgId,
            user_id: u.id,
            role_id: roleId,
            scope_type: g.scope,
            scope_id: scopeId,
            reason,
            granted_by: data.grantor.id,
            created_by: null,
            updated_by: null,
          })
          .execute();
        await insertAuditEvent(tx, actor, {
          action: "scoped_assignment.create",
          recordType: "scoped_assignment",
          recordId: id,
          organizationId: orgId,
          newVersion: 1,
          reason,
        });
      }
    }
    return { seeded: true, users: data.users.map((u) => u.subject) };
  });
}
