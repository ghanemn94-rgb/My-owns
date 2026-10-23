// code-security-reviewer, DG5 round 4 (T-DG5-REV-SEC-R4C). A reviewer probe, NOT product code. It is copied into a
// disposable clone as apps/api/test/integration/environment/zz-sec-r4-demo-key-deliverables.test.ts, run, and removed.
//
// It probes T-DG5-BE-Y1 (roaming-portfolio.ts seedKeyDeliverables; bbd6294..fb9c221) on the REAL demo dataset (seedDemo)
// in a scratch database, independently of the implementer's demo-gate-history.test.ts:
//  - every new capability is created by a holder of tom.edit, every deliverable by a holder of initiative.edit (the
//    product routes' permissions: registers.ts writeRules, deliverables.ts EDIT_RULES), every new trace link by a holder
//    of traceability.link (traceability.ts TRACE_LINK_PERMISSION), at the demo transformation, through the product's
//    own policy code (loadGrants + resolveTarget + grantApplies), and the creator is the demo TL;
//  - exactly one audit event per write (the row's version is 1, one `<table>.create`), and one demo_seed_record each;
//  - no allocation share on any new link (no value attributed); every link's endpoints are in the demo transformation;
//  - every deliverable is still `pending` acceptance (nothing accepted on anyone's behalf), and its owner holds a role
//    in the transformation;
//  - the demo access administrator still holds no approval permission and none of the three write permissions;
//  - seedDemo stays refused with MTH_ENV=production and on a production-initialized database.
// All data is SYNTHETIC. A seeded record approves nothing real, and nothing here touches DG0-DG7.
import { bootstrap, createDb, createPool, migrate, seedDemo } from "@mth/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { DEMO_ACCESS_ADMIN } from "../../../../../packages/db/src/demo/data/roaming.ts";
import { DEMO_PORTFOLIO, DEMO_PORTFOLIO_IDS } from "../../../../../packages/db/src/demo/data/roaming-portfolio.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { loadGrants, resolveTarget } from "../../../src/modules/access/policy.ts";
import { grantApplies, isApprovalPermission } from "../../../src/modules/access/rules.ts";
import { startApi, type TestApi } from "../../support/harness.ts";

const T = DEMO_ANCHORS.transformationId;
let api: TestApi;
let scratch: string | null = null;
const extra: string[] = [];

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_sec_r4_demo_kd");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: true,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
}, 240_000);

afterAll(async () => {
  await api?.close();
  const { adminUrl } = inject("mthDb");
  if (scratch) await dropScratchDatabase(adminUrl, scratch);
  for (const d of extra) await dropScratchDatabase(adminUrl, d);
}, 120_000);

async function holds(userId: string, permission: string): Promise<string[]> {
  const target = await resolveTarget(api.db, { type: "transformation", id: T });
  expect(target).not.toBeNull();
  return (await loadGrants(api.db, userId))
    .filter((g) => grantApplies(g, permission as never, target!))
    .map((g) => g.roleCode)
    .sort();
}
async function oneCreate(table: string, id: string, fixture: string) {
  const row = (
    await sql<{ version: number; created_by: string; updated_by: string; transformation_id: string }>`
      SELECT version, created_by::text, updated_by::text, transformation_id::text FROM ${sql.table(table)}
       WHERE id = ${id}::uuid`.execute(api.db)
  ).rows;
  expect(row, `${table} ${id}`).toHaveLength(1);
  expect(row[0]!.version, `${table} ${id} version`).toBe(1);
  expect(row[0]!.transformation_id).toBe(T);
  const a = (
    await sql<{ action: string; transformation_id: string | null }>`SELECT action, transformation_id::text FROM audit_event
      WHERE record_type = ${table} AND record_id = ${id}::uuid`.execute(api.db)
  ).rows;
  expect(a.map((x) => x.action), `${table} ${id} audit`).toEqual([`${table}.create`]);
  expect(a[0]!.transformation_id).toBe(T);
  const s = (
    await sql<{ fixture_key: string }>`SELECT fixture_key FROM demo_seed_record WHERE record_type = ${table}
      AND record_id = ${id}::uuid`.execute(api.db)
  ).rows;
  expect(s.map((x) => x.fixture_key)).toEqual([fixture]);
  return row[0]!;
}

describe("BE-Y1: the demo's key deliverables, capability changes and trace links respect the guards and audit", () => {
  it("capabilities by a tom.edit holder, deliverables by an initiative.edit holder, links by a traceability.link holder", async () => {
    let caps = 0;
    let dels = 0;
    let links = 0;
    for (const p of DEMO_PORTFOLIO) {
      if (!p.capability.existing) {
        const c = await oneCreate(
          "capability",
          DEMO_PORTFOLIO_IDS.capability(p.no),
          `roaming.portfolio.capability.${p.code.toLowerCase()}`,
        );
        expect((await holds(c.created_by, "tom.edit")).length, `${p.code} capability creator`).toBeGreaterThan(0);
        caps++;
      }
      for (let k = 1; k <= p.deliverables.length; k++) {
        const id = DEMO_PORTFOLIO_IDS.deliverable(p.no, k);
        const d = await oneCreate("deliverable", id, `roaming.portfolio.deliverable.${p.code.toLowerCase()}.${k}`);
        expect((await holds(d.created_by, "initiative.edit")).length, `${p.code} deliverable ${k}`).toBeGreaterThan(0);
        const x = (
          await sql<{ acceptance_status: string; owner_user_id: string; initiative_id: string }>`
            SELECT acceptance_status, owner_user_id::text, initiative_id::text FROM deliverable WHERE id = ${id}::uuid`.execute(
            api.db,
          )
        ).rows[0]!;
        expect([x.acceptance_status, x.initiative_id]).toEqual(["pending", p.id]);
        expect((await loadGrants(api.db, x.owner_user_id)).length, `${p.code} deliverable ${k} owner`).toBeGreaterThan(0);
        dels++;
        const lid = DEMO_PORTFOLIO_IDS.deliverableCapabilityLink(p.no, k);
        const l = await oneCreate(
          "trace_link",
          lid,
          `roaming.portfolio.trace.deliverable_capability.${p.code.toLowerCase()}.${k}`,
        );
        expect((await holds(l.created_by, "traceability.link")).length, `${p.code} link ${k}`).toBeGreaterThan(0);
        links++;
      }
      const kl = DEMO_PORTFOLIO_IDS.capabilityKpiLink(p.no);
      const l = await oneCreate("trace_link", kl, `roaming.portfolio.trace.capability_kpi.${p.code.toLowerCase()}`);
      expect((await holds(l.created_by, "traceability.link")).length, `${p.code} capability->KPI link`).toBeGreaterThan(0);
      links++;
    }
    expect([caps, dels, links]).toEqual([2, 9, 12]);
  });

  it("the creators are the demo TL; no allocation share on the new links; nothing accepted", async () => {
    const rows = (
      await sql<{ created_by: string; allocation_share: string | null; link_kind: string }>`
        SELECT created_by::text, allocation_share::text, link_kind FROM trace_link
         WHERE id IN (SELECT record_id FROM demo_seed_record WHERE fixture_key LIKE 'roaming.portfolio.trace.%')`.execute(
        api.db,
      )
    ).rows;
    expect(rows).toHaveLength(12);
    for (const r of rows) expect(r.allocation_share, r.link_kind).toBeNull();
    const creators = new Set(rows.map((r) => r.created_by));
    expect(creators.size).toBe(1);
    const [creator] = [...creators];
    expect(await holds(creator!, "traceability.link")).toContain("TL");
    expect(await holds(creator!, "tom.edit")).toContain("TL");
    expect(await holds(creator!, "initiative.edit")).toContain("TL");
    const accepted = await sql<{ n: string }>`SELECT count(*)::text AS n FROM deliverable
      WHERE transformation_id = ${T}::uuid AND acceptance_status <> 'pending'`.execute(api.db);
    expect(accepted.rows[0]!.n).toBe("0");
  });

  it("the demo access administrator holds no approval permission and none of the three write permissions", async () => {
    const grants = await loadGrants(api.db, DEMO_ACCESS_ADMIN.id);
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants)
      for (const perm of g.permissions) expect(isApprovalPermission(perm), `${g.roleCode} ${perm}`).toBe(false);
    for (const perm of ["tom.edit", "initiative.edit", "traceability.link"])
      expect(await holds(DEMO_ACCESS_ADMIN.id, perm), perm).toEqual([]);
  });

  it("seedDemo stays refused in production: MTH_ENV=production, and a production-initialized database", async () => {
    const { adminUrl } = inject("mthDb");
    const a = await createScratchDatabase(adminUrl, "mth_sec_r4_prod_env");
    extra.push(a);
    await migrate(roleUrl(adminUrl, a, "mth_owner"));
    const opts = { runKind: "seed", requestedVia: "cli", requestedBy: null, devIssuerBinding: true } as const;
    await expect(seedDemo(roleUrl(adminUrl, a, "mth_owner"), { ...opts, mthEnv: "production" } as never)).rejects.toThrow(
      /refused: MTH_ENV is production/,
    );
    const adb = createDb(createPool(roleUrl(adminUrl, a, "mth_owner"), { max: 1 }));
    try {
      const left = await sql<{ n: string }>`SELECT count(*)::text AS n FROM deliverable`.execute(adb);
      expect(left.rows[0]!.n).toBe("0");
    } finally {
      await adb.destroy();
    }
    const b = await createScratchDatabase(adminUrl, "mth_sec_r4_prod_marker");
    extra.push(b);
    await migrate(roleUrl(adminUrl, b, "mth_owner"));
    const pool = createPool(roleUrl(adminUrl, b, "mth_owner"), { max: 1 });
    const db = createDb(pool);
    try {
      await bootstrap(db, {
        orgCode: "SECR4",
        orgNameEn: "Probe organization (synthetic)",
        orgNameAr: "منظمة اختبار (اصطناعية)",
        defaultTimezone: "Asia/Riyadh",
        defaultCurrency: "SAR",
        adminDisplayName: "Probe admin",
        adminEmail: null,
        adminIssuer: "https://probe.invalid/issuer",
        adminSubject: "probe-admin",
      });
    } finally {
      await db.destroy();
    }
    await expect(seedDemo(roleUrl(adminUrl, b, "mth_owner"), { ...opts, mthEnv: "demo" } as never)).rejects.toThrow(
      /refused: this database was initialized for production/,
    );
  }, 120_000);
});
