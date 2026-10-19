// code-security-reviewer, DG5 round 4 (T-DG5-REV-SEC-R4). A reviewer probe, NOT product code. It is copied into a
// disposable clone as apps/api/test/integration/environment/zz-sec-r4-demo-key-deliverables.test.ts, run, and removed.
//
// It probes T-DG5-BE-Y1 (roaming-portfolio.ts seedKeyDeliverables; F-DG5-123) on the REAL demo dataset (seedDemo) in a
// scratch database, independently of the implementer's own test:
//  - every new capability, deliverable and trace link is written (created_by / updated_by) by the demo Transformation
//    Lead, who HOLDS at the demo transformation the permission of the API operation it imitates (tom.edit for the
//    capability register, initiative.edit for createDeliverable, traceability.link for createTraceLink), resolved
//    through the product's own policy code (loadGrants + resolveTarget + grantApplies);
//  - exactly one audit event per write, with the product's own action name (capability.create, deliverable.create,
//    trace_link.create) and the demo transformation as its scope; one demo_seed_record per row;
//  - every endpoint (initiative, TOM gap, capability, deliverable, outcome KPI) is in the same organization and the
//    same demo transformation; the deliverable owner is an active user of the organization (assertActiveUsers);
//    no allocation share; the initiative was still a draft when the deliverables were recorded (createdAt before the
//    synthetic 07:00 submission);
//  - the demo access administrator holds none of the three write permissions and no approval permission;
//  - seedDemo is refused with MTH_ENV=production (and on a production-initialized database), changing nothing.
// All data is SYNTHETIC. A seeded record approves nothing real, and nothing here touches DG0-DG7.
import { bootstrap, createDb, createPool, migrate, seedDemo } from "@mth/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { DEMO_ACCESS_ADMIN } from "../../../../../packages/db/src/demo/data/roaming.ts";
import {
  DEMO_PORTFOLIO,
  DEMO_PORTFOLIO_IDS,
  DEMO_PORTFOLIO_TIMES,
} from "../../../../../packages/db/src/demo/data/roaming-portfolio.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { loadGrants, resolveTarget } from "../../../src/modules/access/policy.ts";
import { grantApplies, isApprovalPermission } from "../../../src/modules/access/rules.ts";
import { startApi, type TestApi } from "../../support/harness.ts";

const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const TL = DEMO_ANCHORS.users.tl;
const WL = DEMO_ANCHORS.users.wl;
let api: TestApi;
let scratch: string | null = null;
const extra: string[] = [];

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_sec_r4_demo_deliv");
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
}, 60_000);

async function rolesHolding(userId: string, permission: string): Promise<string[]> {
  const target = await resolveTarget(api.db, { type: "transformation", id: T });
  expect(target).not.toBeNull();
  return (await loadGrants(api.db, userId))
    .filter((g) => grantApplies(g, permission as never, target!))
    .map((g) => g.roleCode)
    .sort();
}
async function audits(recordType: string, id: string) {
  return (
    await sql<{ action: string; transformation_id: string | null; organization_id: string | null }>`
      SELECT action, transformation_id::text, organization_id::text FROM audit_event
      WHERE record_type = ${recordType} AND record_id = ${id}::uuid ORDER BY occurred_at, id`.execute(api.db)
  ).rows;
}
async function seedRecords(recordType: string, id: string): Promise<number> {
  const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM demo_seed_record
    WHERE record_type = ${recordType} AND record_id = ${id}::uuid`.execute(api.db);
  return Number(r.rows[0]!.n);
}
async function row(table: string, id: string): Promise<Record<string, unknown>> {
  const r = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(table)} WHERE id = ${id}::uuid`.execute(api.db);
  expect(r.rows, `${table} ${id}`).toHaveLength(1);
  return r.rows[0]!;
}

describe("SEC-R4 probe: BE-Y1 key deliverables, capability changes and trace links respect every guard", () => {
  it("the demo TL holds tom.edit, initiative.edit and traceability.link at the demo transformation", async () => {
    for (const p of ["tom.edit", "initiative.edit", "traceability.link"]) {
      const roles = await rolesHolding(TL, p);
      console.log(`TL holds ${p} via`, roles);
      expect(roles.length, p).toBeGreaterThan(0);
    }
  });

  it("the two new capabilities: by TL (tom.edit), on the initiative's own TOM gap, one audit event, one seed record", async () => {
    let n = 0;
    for (const p of DEMO_PORTFOLIO) {
      if (p.capability.existing) continue;
      const id = DEMO_PORTFOLIO_IDS.capability(p.no);
      const c = await row("capability", id);
      expect([c.created_by, c.updated_by, c.organization_id, c.transformation_id, c.version]).toEqual([TL, TL, ORG, T, 1]);
      const gap = await row("tom_gap", c.tom_gap_id as string);
      expect([gap.organization_id, gap.transformation_id]).toEqual([ORG, T]);
      const a = await audits("capability", id);
      expect(a.map((x) => x.action)).toEqual(["capability.create"]);
      expect([a[0]!.transformation_id, a[0]!.organization_id]).toEqual([T, ORG]);
      expect(await seedRecords("capability", id)).toBe(1);
      n++;
    }
    expect(n).toBe(2);
  });

  it("the nine deliverables: by TL (initiative.edit) on a draft card, owner WL active, one audit event each", async () => {
    const submitted = new Date(DEMO_PORTFOLIO_TIMES.submitted).getTime();
    const owner = await row("app_user", WL);
    expect([owner.organization_id, owner.status]).toEqual([ORG, "active"]);
    let n = 0;
    for (const p of DEMO_PORTFOLIO)
      for (let k = 1; k <= p.deliverables.length; k++) {
        const id = DEMO_PORTFOLIO_IDS.deliverable(p.no, k);
        const d = await row("deliverable", id);
        expect([d.created_by, d.updated_by, d.organization_id, d.transformation_id, d.initiative_id, d.owner_user_id]).toEqual(
          [TL, TL, ORG, T, p.id, WL],
        );
        expect([d.acceptance_status, d.status, d.ordinal, d.version]).toEqual(["pending", "active", k, 1]);
        expect(new Date(d.created_at as string).getTime()).toBeLessThan(submitted);
        const ini = await row("initiative", p.id);
        expect([ini.organization_id, ini.transformation_id]).toEqual([ORG, T]);
        const a = await audits("deliverable", id);
        expect(a.map((x) => x.action)).toEqual(["deliverable.create"]);
        expect([a[0]!.transformation_id, a[0]!.organization_id]).toEqual([T, ORG]);
        expect(await seedRecords("deliverable", id)).toBe(1);
        n++;
      }
    expect(n).toBe(9);
  });

  it("the twelve trace links: by TL (traceability.link), same transformation, no share, one audit event each", async () => {
    const ids: string[] = [];
    for (const p of DEMO_PORTFOLIO) {
      for (let k = 1; k <= p.deliverables.length; k++) ids.push(DEMO_PORTFOLIO_IDS.deliverableCapabilityLink(p.no, k));
      ids.push(DEMO_PORTFOLIO_IDS.capabilityKpiLink(p.no));
    }
    expect(new Set(ids).size).toBe(12);
    for (const id of ids) {
      const l = await row("trace_link", id);
      expect([l.created_by, l.updated_by, l.organization_id, l.transformation_id, l.allocation_share, l.status]).toEqual([
        TL,
        TL,
        ORG,
        T,
        null,
        "active",
      ]);
      for (const [col, table] of [
        ["deliverable_id", "deliverable"],
        ["capability_id", "capability"],
        ["outcome_kpi_id", "outcome_kpi"],
      ] as const)
        if (l[col] !== null) expect((await row(table, l[col] as string)).transformation_id, `${id} ${col}`).toBe(T);
      const a = await audits("trace_link", id);
      expect(a.map((x) => x.action)).toEqual(["trace_link.create"]);
      expect(a[0]!.transformation_id).toBe(T);
      expect(await seedRecords("trace_link", id)).toBe(1);
    }
  });

  it("the demo access administrator holds none of the three writes and no approval permission", async () => {
    for (const p of ["tom.edit", "initiative.edit", "traceability.link"])
      expect(await rolesHolding(DEMO_ACCESS_ADMIN.id, p), p).toEqual([]);
    const grants = await loadGrants(api.db, DEMO_ACCESS_ADMIN.id);
    expect(grants.length).toBeGreaterThan(0);
    console.log("access admin roles", [...new Set(grants.map((g) => g.roleCode))]);
    for (const g of grants)
      for (const perm of g.permissions) expect(isApprovalPermission(perm), `${g.roleCode} ${perm}`).toBe(false);
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
    const b = await createScratchDatabase(adminUrl, "mth_sec_r4_prod_marker");
    extra.push(b);
    await migrate(roleUrl(adminUrl, b, "mth_owner"));
    const pool = createPool(roleUrl(adminUrl, b, "mth_owner"), { max: 1 });
    const db = createDb(pool);
    const count = async () =>
      Number(
        (
          await sql<{ n: string }>`SELECT (SELECT count(*) FROM deliverable) + (SELECT count(*) FROM trace_link)
          + (SELECT count(*) FROM capability) + (SELECT count(*) FROM demo_seed_record) AS n`.execute(db)
        ).rows[0]!.n,
      );
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
      const marker = await sql<{ k: string }>`SELECT environment_kind AS k FROM deployment_environment`.execute(db);
      expect(marker.rows.map((r) => r.k)).toEqual(["production"]);
      const before = await count();
      await expect(seedDemo(roleUrl(adminUrl, b, "mth_owner"), { ...opts, mthEnv: "demo" } as never)).rejects.toThrow(
        /refused: this database was initialized for production/,
      );
      expect(await count()).toBe(before);
      expect(before).toBe(0);
    } finally {
      await db.destroy();
    }
  }, 120_000);
});
