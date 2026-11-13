// Date-relative demo reporting periods and the organization-wide demo access administrator (ADR-0064 Amendment 4
// §A4.6, §A4.7; D-263; p7-work-split §C.15; REQ-S18-001, REQ-S18-002; T-DG7-BE-R4): T-R28 (the generated periods, the
// CLI line, determinism for one anchor, the refusals), T-R29 (the organization-scope ADM_ACCESS grant, with the access
// rules unchanged) and T-R30 (a measurement past the demo trajectories' end, A4.9 residual 4; not a gate).
//
// Every row is SYNTHETIC (an illustrative example, not Mobily actual performance). A demo approval in these fixtures
// (the demo SP accepting a KPI actual) approves nothing real. Nothing here grants a G1-G6, Finance or IT approval, and
// nothing reads or writes DG0-DG7. Every database is a scratch database of this run's disposable cluster.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { call, signIn, startApi, type Session, type TestApi } from "../../../../apps/api/test/support/harness.ts";
import { recalculate } from "../../../../apps/worker/src/handlers/kpi.ts";
import { runDemoCommand } from "../../src/demo/cli.ts";
import {
  DEMO_PERIODS,
  DEMO_ANCHORS,
  DEMO_KPIS,
  DemoPeriodAnchorRefused,
  demoPeriodsFor,
  ID_BLOCK,
  kbeId,
} from "../../src/demo/data/kpis.ts";
import { DEMO_ACCESS_ADMIN, DEMO_ORG_ACCESS_GRANT, DEMO_USERS } from "../../src/demo/data/roaming.ts";
import { DEMO_ACTUALS } from "../../src/demo/data/actuals.ts";
import { DEMO_ORGANIZATION_TIMEZONE } from "../../src/demo/guard.ts";
import { resetDemo } from "../../src/demo/reset.ts";
import { seedDemo, type DemoRunSummary } from "../../src/demo/seed.ts";
import { migrate } from "../../src/migrate.ts";
import { createDb, createPool, type Db } from "../../src/pool.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

/** The KPIs are ratios: the latest synthetic demo actual's numerator and denominator, re-entered. */
const ratioOf = (kpi: string) => {
  const a = [...DEMO_ACTUALS].reverse().find((x) => x.kpi === kpi)!;
  return { numerator: a.numerator, denominator: a.denominator };
};

const { adminUrl } = testDatabase();
const dropAtEnd: string[] = [];
const handles: Db[] = [];
const TZ = DEMO_ORGANIZATION_TIMEZONE;
const ORG = DEMO_ANCHORS.organizationId;
const BU = DEMO_ANCHORS.businessUnitId;
const T = DEMO_ANCHORS.transformationId;
const NOW = new Date("2026-11-13T12:00:00Z");
const REASON = "Synthetic demonstration role for the period test (approves nothing real)";
const user = (role: string) => DEMO_USERS.find((u) => u.role === role)!;

async function scratch(prefix: string): Promise<{ name: string; ownerUrl: string; db: Db }> {
  const name = await createScratchDatabase(adminUrl, prefix);
  dropAtEnd.push(name);
  const ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  await migrate(ownerUrl);
  const db = createDb(createPool(ownerUrl, { max: 2 }));
  handles.push(db);
  return { name, ownerUrl, db };
}

const periods = async (db: Db) =>
  (
    await sql<Record<string, unknown>>`SELECT to_jsonb(p) - 'seq' AS row FROM reporting_period p
      WHERE organization_id = ${ORG}::uuid ORDER BY period_start`.execute(db)
  ).rows.map((r) => r["row"] as Record<string, unknown>);

let current: { name: string; ownerUrl: string; db: Db };
let legacy: { name: string; ownerUrl: string; db: Db };
let legacySummary: DemoRunSummary;
const cliOut: string[] = [];

beforeAll(async () => {
  current = await scratch("mth_demo_periods_cur");
  const code = await runDemoCommand(
    "seed-demo",
    {
      mthEnv: "demo",
      ownerUrl: current.ownerUrl,
      demoAdminUrl: null,
      devIssuerBinding: true,
      asOf: "2026-11-13",
      now: NOW,
    },
    { out: (l) => cliOut.push(l), err: (l) => cliOut.push(`ERR ${l}`) },
  );
  if (code !== 0) throw new Error(`seed-demo --as-of 2026-11-13 exited ${code}: ${cliOut.join("\n")}`);
  legacy = await scratch("mth_demo_periods_leg");
  legacySummary = await seedDemo(legacy.ownerUrl, {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    asOf: "2026-09-01",
  });
}, 600_000);

afterAll(async () => {
  for (const h of handles) await h.destroy();
  for (const name of dropAtEnd.reverse()) await dropScratchDatabase(adminUrl, name);
}, 180_000);

describe("T-R28: seed-demo --as-of 2026-11-13 (ADR-0064 A4.6)", () => {
  it("2026-06 to 2026-09 are exactly as with --as-of 2026-09-01; 2026-10 and 2026-11 are generated, open", async () => {
    const cur = await periods(current.db);
    const leg = await periods(legacy.db);
    expect(leg.map((p) => p["period_label"])).toEqual(DEMO_PERIODS.map((p) => p.label));
    expect(cur.slice(0, 4)).toEqual(leg);
    const generated = cur.slice(4);
    expect(generated).toHaveLength(2);
    const startOfNovemberRiyadh = "2026-10-31T21:00:00+00:00";
    expect(
      generated.map((p) => [
        p["id"],
        p["period_label"],
        p["frequency"],
        p["basis"],
        p["period_start"],
        p["period_end"],
        p["update_due_date"],
        p["status"],
        new Date(p["opened_at"] as string).toISOString(),
        new Date(p["created_at"] as string).toISOString(),
        p["closed_at"],
      ]),
    ).toEqual([
      [
        kbeId(ID_BLOCK.reportingPeriod, 5),
        "2026-10",
        "monthly",
        "calendar",
        "2026-10-01",
        "2026-10-31",
        "2026-11-05",
        "open",
        new Date(startOfNovemberRiyadh).toISOString(),
        new Date(startOfNovemberRiyadh).toISOString(),
        null,
      ],
      [
        kbeId(ID_BLOCK.reportingPeriod, 6),
        "2026-11",
        "monthly",
        "calendar",
        "2026-11-01",
        "2026-11-30",
        "2026-12-05",
        "open",
        new Date(startOfNovemberRiyadh).toISOString(),
        new Date(startOfNovemberRiyadh).toISOString(),
        null,
      ],
    ]);
    // Each generated row was written through the single insert path: its registry row and its create audit event.
    const reg = await sql<{ fixture_key: string }>`SELECT fixture_key FROM demo_seed_record
      WHERE record_type = 'reporting_period' ORDER BY fixture_key`.execute(current.db);
    expect(reg.rows.map((r) => r.fixture_key)).toEqual([
      ...DEMO_PERIODS.map((p) => `kbe.period.${p.key}`),
      "kbe.period.2026-10",
      "kbe.period.2026-11",
    ]);
  });

  it("the CLI prints the A4.6 line; the legacy anchor generates none; coverage holds for both anchors", async () => {
    expect(cliOut).toContain(
      "mth-db seed-demo: reporting periods relative to 2026-11-13 (Asia/Riyadh): 2 generated, current period 2026-11 open",
    );
    expect(cliOut).toContain("coverage  complete");
    expect([legacySummary.periodAnchor, legacySummary.periodsGenerated, legacySummary.coverageComplete]).toEqual([
      "2026-09",
      0,
      true,
    ]);
  });

  it("seed, then reset twice with the same --as-of: identical counts and checksum", async () => {
    const run = (
      await sql<{ checksum_sha256: string; record_counts: Record<string, number> }>`
        SELECT checksum_sha256, record_counts FROM demo_dataset_run ORDER BY run_no LIMIT 1`.execute(current.db)
    ).rows[0]!;
    for (let i = 0; i < 2; i += 1) {
      const r = await resetDemo({
        mthEnv: "demo",
        adminUrl,
        ownerUrl: current.ownerUrl,
        requestedVia: "cli",
        requestedBy: null,
        devIssuerBinding: true,
        asOf: "2026-11-13",
      });
      expect([r.periodAnchor, r.periodsGenerated, r.coverageComplete]).toEqual(["2026-11", 2, true]);
      expect(r.recordCounts).toEqual(run.record_counts);
      expect(r.checksumSha256).toBe(run.checksum_sha256);
    }
    // A different anchor gives a different dataset (by design, A4.9 residual 5).
    expect(legacySummary.checksumSha256).not.toBe(run.checksum_sha256);
  }, 600_000);

  it("--as-of after today, or not a date, gives exit 2 with the line; nothing is touched", async () => {
    for (const [command, asOf] of [
      ["seed-demo", "2026-11-14"],
      ["seed-demo", "2026-02-30"],
      ["reset-demo", "2026-11-14"],
      ["reset-demo", "13-11-2026"],
    ] as const) {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runDemoCommand(
        command,
        { mthEnv: "demo", ownerUrl: "postgres://unused.invalid/none", demoAdminUrl: null, asOf, now: NOW },
        { out: (l) => out.push(l), err: (l) => err.push(l) },
      );
      expect([code, err, out], `${command} ${asOf}`).toEqual([
        2,
        [`mth-db ${command}: refused: --as-of must be a valid date not after today`],
        [],
      ]);
    }
  });

  it("an anchor beyond 2099-12 is refused (unit, through demoPeriodsFor; the CLI exits 1 before any write)", async () => {
    expect(() => demoPeriodsFor("2100-01", TZ)).toThrow(DemoPeriodAnchorRefused);
    expect(() => demoPeriodsFor("2100-01", TZ)).toThrow(
      "period anchor 2100-01 is outside the supported range 2026-09..2099-12",
    );
    expect(demoPeriodsFor("2099-12", TZ)).toHaveLength(4 + (2099 - 2026) * 12 + 3);
    expect(demoPeriodsFor("2026-07", TZ)).toEqual([...DEMO_PERIODS]);
    const err: string[] = [];
    const code = await runDemoCommand(
      "seed-demo",
      {
        mthEnv: "demo",
        ownerUrl: "postgres://unused.invalid/none",
        demoAdminUrl: null,
        asOf: "2100-01-01",
        now: new Date("2100-01-02T12:00:00Z"),
      },
      { out: () => undefined, err: (l) => err.push(l) },
    );
    expect([code, err]).toEqual([
      1,
      ["mth-db seed-demo: refused: period anchor 2100-01 is outside the supported range 2026-09..2099-12"],
    ]);
  });
});

describe("T-R29: the demo access administrator holds ADM_ACCESS at organization scope (A4.6)", () => {
  let api: TestApi;
  const s: Record<string, Session> = {};

  beforeAll(async () => {
    api = await startApi({ database: current.name, env: { MTH_ENV: "demo" } });
    s["ADM"] = await signIn(api.app, DEMO_ACCESS_ADMIN.name);
    s["WL"] = await signIn(api.app, user("WL").name);
  }, 120_000);

  afterAll(async () => {
    await api?.close();
  }, 60_000);

  it("the grant is at organization scope SYN-ROAMING, and the business-unit grant stays", async () => {
    const g = await sql<{ scope_type: string; scope_id: string; code: string }>`
      SELECT a.scope_type, a.scope_id::text AS scope_id, o.code FROM scoped_assignment a
        JOIN role r ON r.id = a.role_id AND r.code = 'ADM_ACCESS'
        LEFT JOIN organization o ON o.id = a.scope_id
       WHERE a.user_id = ${DEMO_ACCESS_ADMIN.id}::uuid AND a.revoked_at IS NULL
       ORDER BY a.scope_type`.execute(current.db);
    expect(g.rows).toEqual([
      { scope_type: "business_unit", scope_id: BU, code: null },
      { scope_type: "organization", scope_id: ORG, code: "SYN-ROAMING" },
    ]);
    const reg = await sql<{ n: string }>`SELECT count(*)::text AS n FROM demo_seed_record
      WHERE fixture_key = ${DEMO_ORG_ACCESS_GRANT.fixtureKey}`.execute(current.db);
    expect(reg.rows[0]!.n).toBe("1");
  });

  it("as that user, createRoleAssignment of TO at organization scope returns 201 with its audit event", async () => {
    const res = await call<Body>(api.app, "POST", "/api/v1/role-assignments", {
      session: s["ADM"]!,
      body: { userId: user("CM").id, roleCode: "TO", scope: { type: "organization", id: ORG }, reason: REASON },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const ev = await sql<{ action: string; actor_user_id: string }>`
      SELECT action, actor_user_id::text AS actor_user_id FROM audit_event
       WHERE record_type = 'scoped_assignment' AND record_id = ${res.body.id}::uuid`.execute(current.db);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0]!.actor_user_id).toBe(DEMO_ACCESS_ADMIN.id);
  });

  it("a business-unit-only ADM_ACCESS holder is refused the same call (the rules are unchanged)", async () => {
    // The organization-scope administrator grants ADM_ACCESS at the business unit only to the demo WL (an ordinary,
    // audited product workflow), who then tries the organization-scope assignment.
    const bu = await call<Body>(api.app, "POST", "/api/v1/role-assignments", {
      session: s["ADM"]!,
      body: { userId: user("WL").id, roleCode: "ADM_ACCESS", scope: { type: "business_unit", id: BU }, reason: REASON },
    });
    expect(bu.status, JSON.stringify(bu.body)).toBe(201);
    s["WL"] = await signIn(api.app, user("WL").name);
    const refused = await call<Body>(api.app, "POST", "/api/v1/role-assignments", {
      session: s["WL"]!,
      body: { userId: user("BO").id, roleCode: "TO", scope: { type: "organization", id: ORG }, reason: REASON },
    });
    expect([403, 404], JSON.stringify(refused.body)).toContain(refused.status);
    const none = await sql<{ n: string }>`SELECT count(*)::text AS n FROM scoped_assignment a
      JOIN role r ON r.id = a.role_id AND r.code = 'TO'
      WHERE a.user_id = ${user("BO").id}::uuid AND a.scope_type = 'organization'`.execute(current.db);
    expect(none.rows[0]!.n).toBe("0");
  });
});

describe("T-R30 (measurement, not a gate; A4.9 residual 4): --as-of 2027-03-15, one accepted actual per demo KPI", () => {
  it("records each KPI's status in 2027-03 after the worker's recalculation", async () => {
    const m = await scratch("mth_demo_periods_2027");
    const measured: Record<string, unknown>[] = [];
    let api: TestApi | null = null;
    try {
      const summary = await seedDemo(m.ownerUrl, {
        mthEnv: "demo",
        runKind: "seed",
        requestedVia: "cli",
        requestedBy: null,
        devIssuerBinding: true,
        asOf: "2027-03-15",
      });
      measured.push({ step: "seed", periodAnchor: summary.periodAnchor, generated: summary.periodsGenerated });
      const period = demoPeriodsFor("2027-03", TZ).find((p) => p.key === "2027-03")!;
      api = await startApi({ database: m.name, env: { MTH_ENV: "demo" } });
      const kds = await signIn(api.app, user("KDS").name);
      const sp = await signIn(api.app, user("SP").name);
      const base = `/api/v1/transformations/${T}`;
      for (const k of DEMO_KPIS) {
        const sub = await call<Body>(api.app, "POST", `${base}/kpi-definitions/${k.definitionId}/actuals`, {
          session: kds,
          body: {
            scopeKind: "transformation",
            scopeId: T,
            reportingPeriodId: period.id,
            ...ratioOf(k.key),
            dataAsOf: "2027-03-10",
            action: "submit",
          },
        });
        if (sub.status !== 201) {
          measured.push({ kpi: k.key, submit: sub.status, code: sub.body?.code ?? null });
          continue;
        }
        const direct = sub.body.actual.status === "accepted";
        const acc = direct
          ? { status: 0 }
          : await call<Body>(api.app, "POST", `${base}/kpi-actuals/${sub.body.actual.id}/accept`, {
              session: sp,
              headers: { "if-match": `"${sub.body.actual.version}"` },
              body: {},
            });
        if (direct || acc.status === 200) {
          const rows = await m.db
            .selectFrom("outbox_event")
            .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
            .where("aggregate_id", "=", sub.body.actual.id)
            .where("event_type", "=", "kpi.actual_accepted")
            .execute();
          for (const r of rows)
            await recalculate(
              m.db,
              {
                outboxEventId: r.id,
                eventType: r.event_type,
                schemaVersion: r.schema_version,
                idempotencyKey: r.idempotency_key,
                organizationId: r.organization_id,
                payload: r.payload,
              },
              `t-r30-${r.id}`,
            );
        }
        const st = await call<Body>(
          api.app,
          "GET",
          `${base}/kpi-definitions/${k.definitionId}/status?reportingPeriodId=${period.id}`,
          { session: sp },
        );
        measured.push({
          kpi: k.key,
          submit: sub.status,
          submittedStatus: sub.body.actual.status,
          accept: direct ? "accepted on submit" : acc.status,
          status: st.status,
          valueStatus: st.body?.actualStatus ?? null,
          calculatedRag: st.body?.calculatedRag ?? null,
          explanation: st.body?.explanation?.key ?? null,
        });
      }
    } catch (err) {
      measured.push({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      await api?.close();
    }
    // The measurement is recorded in the run's log for the handback (A4.9 residual 4); it never fails the test.
    console.log(`T-R30 measurement: ${JSON.stringify(measured)}`);
    expect(measured.length).toBeGreaterThan(0);
  }, 600_000);
});
