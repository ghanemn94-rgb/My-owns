// `mth-db bootstrap` (safe production initialization) and `mth-db seed-dev` (synthetic, dev only) against real
// PostgreSQL. Each test uses its own scratch database so "no organization exists yet" holds.
import { afterAll, describe, expect, it } from "vitest";
import { bootstrap, BootstrapError } from "../../src/bootstrap.ts";
import { assertDevSeedAllowed, DevSeedRefused, seedDev } from "../../src/dev-seed.ts";
import { migrate } from "../../src/migrate.ts";
import { createDb, createPool, type Db } from "../../src/pool.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const cleanup: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of cleanup.reverse()) await c();
});

async function migratedDb(): Promise<Db> {
  const name = await createScratchDatabase(adminUrl, "mth_boot");
  const ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  await migrate(ownerUrl);
  const db = createDb(createPool(ownerUrl, { max: 2 }));
  cleanup.push(
    () => dropScratchDatabase(adminUrl, name),
    () => db.destroy(),
  );
  return db;
}

const input = {
  orgCode: "MOBILY",
  orgNameEn: "Example Organization",
  orgNameAr: "مؤسسة مثال",
  defaultTimezone: "Asia/Riyadh",
  defaultCurrency: "SAR",
  adminDisplayName: "First Admin",
  adminEmail: "admin@example.invalid",
  adminIssuer: "https://idp.example.invalid/realms/mth",
  adminSubject: "0f7c9a1e-admin",
};

describe("mth-db bootstrap", () => {
  it("creates the first organization and a technical/access admin with no business permission, fully audited", async () => {
    const db = await migratedDb();
    const r = await bootstrap(db, input);

    const org = await db
      .selectFrom("organization")
      .selectAll()
      .where("id", "=", r.organizationId)
      .executeTakeFirstOrThrow();
    expect([org.code, org.default_timezone, org.default_currency, org.version]).toEqual([
      "MOBILY",
      "Asia/Riyadh",
      "SAR",
      1,
    ]);

    const identity = await db
      .selectFrom("user_identity")
      .selectAll()
      .where("user_id", "=", r.adminUserId)
      .executeTakeFirstOrThrow();
    expect([identity.issuer, identity.subject]).toEqual([input.adminIssuer, input.adminSubject]);

    const system = await db
      .selectFrom("app_user")
      .select(["status"])
      .where("id", "=", r.systemUserId)
      .executeTakeFirstOrThrow();
    expect(system.status).toBe("disabled");

    const perms = await db
      .selectFrom("scoped_assignment as a")
      .innerJoin("role as r", "r.id", "a.role_id")
      .innerJoin("role_permission as rp", "rp.role_id", "r.id")
      .innerJoin("permission as p", "p.code", "rp.permission_code")
      .select(["r.code as role", "r.kind", "p.code", "p.category"])
      .where("a.user_id", "=", r.adminUserId)
      .execute();
    expect(new Set(perms.map((p) => p.role))).toEqual(new Set(["ADM_ACCESS", "ADM_TECH"]));
    expect(perms.every((p) => p.kind === "technical_admin")).toBe(true);
    expect(perms.map((p) => p.code)).not.toContain("transformation.read");
    expect(perms.filter((p) => p.category === "business_approval" || p.category === "finance_validation")).toEqual([]);

    const audit = await db
      .selectFrom("audit_event")
      .select(["action", "actor_type", "source"])
      .where("organization_id", "=", r.organizationId)
      .orderBy("seq")
      .execute();
    expect(audit.map((a) => a.action)).toEqual([
      "organization.create",
      "app_user.create",
      "app_user.create",
      "scoped_assignment.create",
      "scoped_assignment.create",
    ]);
    expect(audit.every((a) => a.actor_type === "system" && a.source === "cli")).toBe(true);
  });

  it("refuses to run twice", async () => {
    const db = await migratedDb();
    await bootstrap(db, input);
    await expect(bootstrap(db, { ...input, orgCode: "OTHER" })).rejects.toThrow(/an organization already exists/);
  });

  it("validates its input and refuses the dev-login issuer", async () => {
    const db = await migratedDb();
    await expect(
      bootstrap(db, { ...input, orgCode: "bad code", adminIssuer: "urn:mth:dev-local" }),
    ).rejects.toBeInstanceOf(BootstrapError);
    expect(await db.selectFrom("organization").select("id").execute()).toEqual([]);
  });
});

describe("mth-db seed-dev (synthetic, development only)", () => {
  it("refuses in production and outside AUTH_MODE=dev", () => {
    expect(() => assertDevSeedAllowed({ NODE_ENV: "production", AUTH_MODE: "dev" })).toThrow(DevSeedRefused);
    expect(() => assertDevSeedAllowed({ NODE_ENV: "development", AUTH_MODE: "oidc" })).toThrow(DevSeedRefused);
  });

  it("seeds synthetic users bound to urn:mth:dev-local once, idempotently", async () => {
    const db = await migratedDb();
    await expect(seedDev(db, { NODE_ENV: "production", AUTH_MODE: "dev" })).rejects.toBeInstanceOf(DevSeedRefused);
    expect(await db.selectFrom("app_user").select("id").execute()).toEqual([]);

    const first = await seedDev(db, { NODE_ENV: "development", AUTH_MODE: "dev" });
    expect(first.seeded).toBe(true);
    const second = await seedDev(db, { NODE_ENV: "development", AUTH_MODE: "dev" });
    expect(second.seeded).toBe(false);
    const identities = await db.selectFrom("user_identity").select(["issuer"]).execute();
    expect(identities.length).toBe(first.users.length);
    expect(new Set(identities.map((i) => i.issuer))).toEqual(new Set(["urn:mth:dev-local"]));
    const org = await db.selectFrom("organization").select(["code", "name_ar"]).executeTakeFirstOrThrow();
    expect(org.code).toBe("SYN-DEV");
    expect(org.name_ar).toMatch(/اصطناعية/);
  });
});
