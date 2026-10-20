// code-security-reviewer, DG5 round 4 (T-DG5-REV-SEC-R4B). A reviewer probe, NOT product code. It is copied into a
// disposable clone as apps/api/test/integration/environment/zz-sec-r4-demo-key-deliverables.test.ts, run, and removed.
//
// It probes T-DG5-BE-Y1 (roaming-portfolio.ts seedKeyDeliverables, repair diff bbd6294..fb9c221) on the REAL demo
// dataset (seedDemo) in a scratch database, independently of the implementer's own test:
//  - every new row (2 capabilities, 9 deliverables, 12 trace links) is written by a user who HOLDS the product permission
//    of the API operation it imitates, at the demo transformation, using the product's own policy code (loadGrants +
//    resolveTarget + grantApplies): capability -> tom.edit (registers.ts writeRules), deliverable -> initiative.edit
//    (deliverables.ts EDIT_RULES), trace_link -> traceability.link (traceability.ts TRACE_LINK_PERMISSION);
//  - each such row has EXACTLY one audit event, with the API's own action name (<table>.create), version 1, the demo
//    transformation, and one demo_seed_record entry;
//  - every endpoint of every trace link lies in the demo transformation, no allocation share is attributed, and every
//    deliverable's initiative is in the demo transformation;
//  - no deliverable is accepted (acceptance is a later business decision, deliverable.accept) and none is submitted;
//  - the demo access administrator still holds no approval and no business-write permission on these tables;
//  - seedDemo stays refused with MTH_ENV=production and on a production-initialized database.
// All data is SYNTHETIC. A seeded decision approves nothing real, and nothing here touches DG0-DG7.
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
async function expectHolds(userId: string | null, permission: string, what: string) {
  expect(userId, `${what}: actor`).not.toBeNull();
  const roles = await holds(userId!, permission);
  expect(roles.length, `${what}: ${userId} holds ${permission} at the demo transformation`).toBeGreaterThan(0);
  return roles;
}
type Row = {
  created_by: string;
  updated_by: string;
  version: number;
  transformation_id: string;
  status: string;
};
async function row<R = Row>(table: string, id: string): Promise<R & Row> {
  const rows = (
    await sql<R & Row>`SELECT *, created_by::text AS created_by, updated_by::text AS updated_by,
      transformation_id::text AS transformation_id FROM ${sql.table(table)} WHERE id = ${id}::uuid`.execute(api.db)
  ).rows;
  expect(rows, `${table} ${id}`).toHaveLength(1);
  return rows[0]!;
}
/** Exactly one audit event (the API's own `<table>.create`, version 1, in T) and one seed record per row. */
async function expectOneAuditAndSeedRecord(table: string, id: string) {
  const a = (
    await sql<{ action: string; transformation_id: string | null; new_version: number | null }>`
      SELECT action, transformation_id::text, new_version FROM audit_event
       WHERE record_type = ${table} AND record_id = ${id}::uuid`.execute(api.db)
  ).rows;
  expect(
    a.map((e) => [e.action, e.transformation_id, e.new_version]),
    `${table} ${id} audit`,
  ).toEqual([[`${table}.create`, T, 1]]);
  const s = (
    await sql<{ n: string }>`SELECT count(*)::text AS n FROM demo_seed_record
      WHERE record_type = ${table} AND record_id = ${id}::uuid`.execute(api.db)
  ).rows;
  expect(s[0]!.n, `${table} ${id} seed record`).toBe("1");
}

describe("T-DG5-BE-Y1: the demo's key deliverables, capabilities and trace links respect guards and audit", () => {
  const newCaps = DEMO_PORTFOLIO.filter((p) => !p.capability.existing);

  it("capabilities: by a holder of tom.edit, one audit event, scoped to T, on the initiative's TOM gap", async () => {
    expect(newCaps.map((p) => p.code)).toEqual(["INI-02", "INI-03"]);
    for (const p of newCaps) {
      const id = DEMO_PORTFOLIO_IDS.capability(p.no);
      const c = await row<{ tom_gap_id: string }>("capability", id);
      expect([c.transformation_id, c.version, c.status, c.updated_by]).toEqual([T, 1, "active", c.created_by]);
      await expectHolds(c.created_by, "tom.edit", `${p.code} capability`);
      const gap = (
        await sql<{ t: string }>`SELECT transformation_id::text AS t FROM tom_gap WHERE id = ${c.tom_gap_id}::uuid`.execute(
          api.db,
        )
      ).rows;
      expect(gap.map((g) => g.t)).toEqual([T]);
      await expectOneAuditAndSeedRecord("capability", id);
    }
  });

  it("deliverables: by a holder of initiative.edit, one audit event each, pending, not submitted, in T", async () => {
    let n = 0;
    for (const p of DEMO_PORTFOLIO)
      for (let k = 1; k <= p.deliverables.length; k += 1) {
        n += 1;
        const id = DEMO_PORTFOLIO_IDS.deliverable(p.no, k);
        const d = await row<{
          initiative_id: string;
          ordinal: number;
          acceptance_status: string;
          submitted_by: string | null;
          accepted_by?: string | null;
        }>("deliverable", id);
        expect([d.transformation_id, d.initiative_id, d.ordinal, d.version, d.status]).toEqual([T, p.id, k, 1, "active"]);
        expect([d.acceptance_status, d.submitted_by ?? null]).toEqual(["pending", null]);
        await expectHolds(d.created_by, "initiative.edit", `${p.code} deliverable ${k}`);
        await expectOneAuditAndSeedRecord("deliverable", id);
      }
    expect(n).toBe(9);
  });

  it("trace links: by a holder of traceability.link, one audit event each, endpoints in T, no allocation", async () => {
    const ids: string[] = [];
    for (const p of DEMO_PORTFOLIO) {
      for (let k = 1; k <= p.deliverables.length; k += 1) ids.push(DEMO_PORTFOLIO_IDS.deliverableCapabilityLink(p.no, k));
      ids.push(DEMO_PORTFOLIO_IDS.capabilityKpiLink(p.no));
    }
    expect(new Set(ids).size).toBe(12);
    for (const id of ids) {
      const l = await row<{
        link_kind: string;
        allocation_share: string | null;
        deliverable_id: string | null;
        capability_id: string | null;
        outcome_kpi_id: string | null;
      }>("trace_link", id);
      expect([l.transformation_id, l.version, l.status, l.allocation_share]).toEqual([T, 1, "active", null]);
      expect(["deliverable_capability", "capability_kpi"]).toContain(l.link_kind);
      await expectHolds(l.created_by, "traceability.link", `trace link ${id}`);
      for (const [table, ref] of [
        ["deliverable", l.deliverable_id],
        ["capability", l.capability_id],
        ["outcome_kpi", l.outcome_kpi_id],
      ] as const)
        if (ref !== null) {
          const t = (
            await sql<{ t: string }>`SELECT transformation_id::text AS t FROM ${sql.table(table)} WHERE id = ${ref}::uuid`.execute(
              api.db,
            )
          ).rows;
          expect(t.map((x) => x.t), `${id} -> ${table}`).toEqual([T]);
        }
      await expectOneAuditAndSeedRecord("trace_link", id);
    }
  });

  it("the demo access administrator holds no approval permission and none of tom.edit, initiative.edit, traceability.link", async () => {
    const grants = await loadGrants(api.db, DEMO_ACCESS_ADMIN.id);
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants)
      for (const perm of g.permissions) {
        expect(isApprovalPermission(perm), `${g.roleCode} ${perm}`).toBe(false);
        expect(["tom.edit", "initiative.edit", "traceability.link"], `${g.roleCode}`).not.toContain(perm);
      }
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
    const dbA = createDb(createPool(roleUrl(adminUrl, a, "mth_owner"), { max: 1 }));
    try {
      const nA = await sql<{ n: string }>`SELECT (SELECT count(*) FROM deliverable) + (SELECT count(*) FROM trace_link)
        + (SELECT count(*) FROM capability) AS n`.execute(dbA);
      expect(String(nA.rows[0]!.n), "nothing seeded after the refusal").toBe("0");
    } finally {
      await dbA.destroy();
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
      const marker = await sql<{ k: string }>`SELECT environment_kind AS k FROM deployment_environment`.execute(db);
      expect(marker.rows.map((r) => r.k)).toEqual(["production"]);
    } finally {
      await db.destroy();
    }
    await expect(seedDemo(roleUrl(adminUrl, b, "mth_owner"), { ...opts, mthEnv: "demo" } as never)).rejects.toThrow(
      /refused: this database was initialized for production/,
    );
  }, 180_000);
});
