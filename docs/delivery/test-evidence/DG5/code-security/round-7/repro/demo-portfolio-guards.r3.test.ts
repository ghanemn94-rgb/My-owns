// code-security-reviewer, DG5 round 3 (T-DG5-REV-SEC-R3B). A reviewer probe, NOT product code. It is copied into a
// disposable clone as apps/api/test/integration/environment/zz-sec-r3-demo-portfolio-guards.test.ts, run, and removed.
//
// It probes the repair diff d3528fc..bbd6294 independently of the implementers' own tests:
//  (A) T-DG5-BE-X1 (g4.ts): an adversarial set of fact combinations. An EMPTY approved portfolio with every other fact
//      as complete as it can be must leave all eight G4 criteria incomplete. Not-loaded facts must stay incomplete. A
//      non-empty, complete portfolio must stay complete (no regression), and removing any single per-initiative fact must
//      make its criterion incomplete.
//  (B) T-DG5-BE-X2 (roaming-portfolio.ts, business-cases.ts, roaming-gates.ts) on the REAL demo dataset (seedDemo) in a
//      scratch database: every new row is written by a user who HOLDS the product permission of the API operation it
//      imitates, at the demo transformation (loadGrants + resolveTarget + grantApplies, the product's own policy code);
//      the Finance validations are not by their authors (business case baselines and formula versions); the funding
//      decisions carry the approver role the product's approverRoleOf would record for that user; each new record has
//      exactly one audit event per write (create + one per version step); the demo access administrator holds no
//      approval permission; and seedDemo is refused with MTH_ENV=production and on a production-initialized database.
// All data is SYNTHETIC. A seeded decision approves nothing real, and nothing here touches DG0-DG7.
import { bootstrap, createDb, createPool, migrate, seedDemo } from "@mth/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { DEMO_ACCESS_ADMIN } from "../../../../../packages/db/src/demo/data/roaming.ts";
import {
  DEMO_CAPACITY_MONTHS,
  DEMO_PORTFOLIO,
  DEMO_PORTFOLIO_IDS,
} from "../../../../../packages/db/src/demo/data/roaming-portfolio.ts";
import { DEMO_INITIATIVE_CASES } from "../../../../../packages/db/src/demo/data/business-cases.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { loadGrants, resolveTarget } from "../../../src/modules/access/policy.ts";
import { grantApplies, isApprovalPermission } from "../../../src/modules/access/rules.ts";
import { G4_EVALUATORS, type G4Facts, type G4InitiativeFact } from "../../../src/modules/workflows/g4.ts";
import { startApi, type TestApi } from "../../support/harness.ts";

// ---------------------------------------------------------------------------------------------- (A) BE-X1, pure
const ALL = G4_EVALUATORS.map(([k]) => k);
const evalAll = (f: G4Facts | undefined) =>
  Object.fromEntries(G4_EVALUATORS.map(([k, e]) => [k, e(f).missing.map((m) => m.code)]));

const WS = "00000000-0000-7000-8000-0000000000a1";
const TCASE = {
  id: "00000000-0000-7000-8000-0000000000c1",
  code: "BC-01",
  title: "t",
  level: "transformation" as const,
  initiativeId: null,
  version: 1,
  missingSections: [],
  baselineValidation: "validated",
  pointer: "/business-cases/c1",
};
const ini = (n: number): G4InitiativeFact => ({
  id: `00000000-0000-7000-8000-00000000010${n}`,
  code: `INI-0${n}`,
  name: `I${n}`,
  version: 3,
  status: "funded",
  cardMissing: [],
  activeGapLinks: 1,
  kpiContributions: 1,
  waveId: WS,
  plannedStart: "2026-07-01",
  plannedEnd: "2026-12-31",
  approvedMilestones: 1,
  executiveOwnerUserId: WS,
  workstreamLeadUserId: WS,
  fundingState: "funded",
  fundingDecisionId: WS,
  committedDemandIds: [WS],
});
function facts(initiatives: readonly G4InitiativeFact[] | undefined, withCases = true): G4Facts {
  return {
    portfolio: {
      transformationId: WS,
      initiatives,
      ranking: {
        snapshotId: WS,
        weightSetId: WS,
        entries: (initiatives ?? []).map((i) => ({ initiativeId: i.id, completeness: "complete" })),
      },
      activeWeightSet: { id: WS, versionNo: 1 },
      scheduleConflicts: [],
      scheduleUnknowns: [],
      capacityConflicts: [],
    },
    kpi: {
      transformationId: WS,
      transformationCase: TCASE as never,
      initiativeCases: withCases
        ? (initiatives ?? []).map((i, k) => ({
            ...TCASE,
            id: `00000000-0000-7000-8000-0000000002${k}0`,
            level: "initiative" as const,
            initiativeId: i.id,
          })) as never
        : [],
      benefitLines: [],
    },
  };
}

describe("(A) BE-X1: the G4 evaluators fail closed and never with less evidence", () => {
  it("an empty approved portfolio with every other fact complete: all eight criteria incomplete", () => {
    const r = evalAll(facts([]));
    expect(ALL).toHaveLength(8);
    for (const k of ALL) expect(r[k]!.length, `${k}: ${JSON.stringify(r[k])}`).toBeGreaterThan(0);
    for (const k of ALL.filter((x) => x !== "g4.initiative_cards"))
      expect(r[k], k).toContain("g4.no_approved_initiative");
    expect(r["g4.initiative_cards"]).toEqual(["g4.portfolio_empty"]);
  });
  it("facts not loaded (undefined, or the portfolio's initiatives absent): all eight incomplete", () => {
    for (const f of [undefined, facts(undefined)]) {
      const r = evalAll(f);
      for (const k of ALL) expect(r[k]!.length, k).toBeGreaterThan(0);
    }
  });
  it("a complete non-empty portfolio stays complete (no regression)", () => {
    const r = evalAll(facts([ini(1), ini(2)]));
    for (const k of ALL) expect(r[k], k).toEqual([]);
  });
  it("removing any one per-initiative fact makes its criterion incomplete", () => {
    const cases: [string, Partial<G4InitiativeFact>][] = [
      ["g4.initiative_cards", { cardMissing: ["objective"] }],
      ["g4.initiative_cards", { activeGapLinks: 0 }],
      ["g4.roadmap", { approvedMilestones: 0 }],
      ["g4.roadmap", { waveId: null }],
      ["g4.owners", { workstreamLeadUserId: null }],
      ["g4.funding", { fundingState: "selected" }],
      ["g4.capacity", { committedDemandIds: [] }],
    ];
    for (const [key, change] of cases) {
      const r = evalAll(facts([ini(1), { ...ini(2), ...change }]));
      expect(r[key]!.length, `${key} ${JSON.stringify(change)}`).toBeGreaterThan(0);
    }
    expect(evalAll(facts([ini(1)], false))["g4.business_cases"]).toContain("g4.initiative_case_missing");
  });
});

// ---------------------------------------------------------------------------------------------- (B) BE-X2, real DB
const T = DEMO_ANCHORS.transformationId;
let api: TestApi;
let scratch: string | null = null;
const extra: string[] = [];

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_sec_r3_demo_guards");
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
const one = async <R>(q: Promise<{ rows: R[] }>): Promise<R> => {
  const rows = (await q).rows;
  expect(rows).toHaveLength(1);
  return rows[0]!;
};
async function auditCount(recordType: string, id: string): Promise<{ n: number; actions: string[] }> {
  const rows = (
    await sql<{ action: string }>`SELECT action FROM audit_event WHERE record_type = ${recordType} AND record_id = ${id}::uuid
      ORDER BY occurred_at, id`.execute(api.db)
  ).rows;
  return { n: rows.length, actions: rows.map((r) => r.action) };
}
/** One audit event per write: a create plus one per version step (version starts at 1). */
async function expectAuditPerWrite(table: string, id: string) {
  // Append-only tables (portfolio_selection, funding_decision, ...) have no version column: exactly one create event.
  const hasVersion = await sql<{ n: string }>`SELECT count(*)::text AS n FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = 'version'`.execute(api.db);
  const v =
    hasVersion.rows[0]!.n === "1"
      ? await sql<{ version: number }>`SELECT version FROM ${sql.table(table)} WHERE id = ${id}::uuid`.execute(api.db)
      : { rows: [{ version: 1 }] };
  const a = await auditCount(table, id);
  const expected = v.rows[0]?.version ?? 1;
  expect(a.n, `${table} ${id} audit ${JSON.stringify(a.actions)} for version ${expected}`).toBe(expected);
  return a.actions;
}

describe("(B) BE-X2: the demo's approved-portfolio rows respect the guards, SoD and audit rules", () => {
  it("ranking: the score results and the snapshot are by a holder of prioritization.edit", async () => {
    const snap = await one(
      sql<{ proposed_by: string; created_by: string }>`SELECT proposed_by::text, created_by::text FROM ranking_snapshot
        WHERE id = ${DEMO_PORTFOLIO_IDS.rankingSnapshot}::uuid`.execute(api.db),
    );
    await expectHolds(snap.proposed_by, "prioritization.edit", "ranking snapshot");
    expect(await expectAuditPerWrite("ranking_snapshot", DEMO_PORTFOLIO_IDS.rankingSnapshot)).toEqual([
      "ranking_snapshot.create",
    ]);
    for (const p of DEMO_PORTFOLIO) {
      const r = await one(
        sql<{ computed_by: string }>`SELECT computed_by::text FROM initiative_score_result
          WHERE id = ${DEMO_PORTFOLIO_IDS.scoreResult(p.no)}::uuid`.execute(api.db),
      );
      await expectHolds(r.computed_by, "prioritization.edit", `${p.code} score result`);
    }
  });

  it("selection: by a holder of portfolio.select, from the current ranking, not by the ranking's proposer", async () => {
    const snap = await one(
      sql<{ proposed_by: string }>`SELECT proposed_by::text FROM ranking_snapshot
        WHERE id = ${DEMO_PORTFOLIO_IDS.rankingSnapshot}::uuid`.execute(api.db),
    );
    for (const p of DEMO_PORTFOLIO) {
      const s = await one(
        sql<{ decided_by: string; ranking_snapshot_id: string; on_behalf_of_user_id: string | null }>`
          SELECT decided_by::text, ranking_snapshot_id::text, on_behalf_of_user_id::text FROM portfolio_selection
           WHERE id = ${DEMO_PORTFOLIO_IDS.selection(p.no)}::uuid`.execute(api.db),
      );
      await expectHolds(s.decided_by, "portfolio.select", `${p.code} selection`);
      expect(s.ranking_snapshot_id).toBe(DEMO_PORTFOLIO_IDS.rankingSnapshot);
      expect(s.on_behalf_of_user_id).toBeNull();
      expect(s.decided_by, `${p.code}: selector is not the proposer`).not.toBe(snap.proposed_by);
      await expectAuditPerWrite("portfolio_selection", DEMO_PORTFOLIO_IDS.selection(p.no));
    }
  });

  it("Finance validation: by a holder of finance.validate who is never the author (cases and formula versions)", async () => {
    for (const c of DEMO_INITIATIVE_CASES) {
      const r = await one(
        sql<{ created_by: string; baseline_validated_by: string; finance_validator_user_id: string }>`
          SELECT created_by::text, baseline_validated_by::text, finance_validator_user_id::text FROM business_case
           WHERE id = ${c.id}::uuid`.execute(api.db),
      );
      await expectHolds(r.baseline_validated_by, "finance.validate", `${c.code} baseline`);
      expect(r.baseline_validated_by, `${c.code}: validator is not the author`).not.toBe(r.created_by);
      expect(r.baseline_validated_by, `${c.code}: validator is the named Finance validator`).toBe(
        r.finance_validator_user_id,
      );
      expect(await expectAuditPerWrite("business_case", c.id)).toHaveLength(2);
    }
    // Every validated formula version behind a benefit line of any case: validator never its author.
    const fv = (
      await sql<{ id: string; created_by: string; validated_by: string | null }>`
        SELECT v.id::text, v.created_by::text, v.validated_by::text FROM benefit_formula_version v
          JOIN benefit_formula f ON f.id = v.formula_id WHERE f.transformation_id = ${T}::uuid`.execute(api.db)
    ).rows;
    expect(fv.length).toBeGreaterThan(0);
    for (const v of fv) if (v.validated_by !== null) expect(v.validated_by, v.id).not.toBe(v.created_by);
  });

  it("funding: by a holder of funding.approve, recorded with the role approverRoleOf gives that user", async () => {
    for (const p of DEMO_PORTFOLIO) {
      const f = await one(
        sql<{ decided_by: string; approver_role_code: string; decision_id: string; business_case_id: string;
          amount: string; on_behalf_of_user_id: string | null }>`
          SELECT decided_by::text, approver_role_code, decision_id::text, business_case_id::text, amount::text,
                 on_behalf_of_user_id::text FROM funding_decision WHERE id = ${DEMO_PORTFOLIO_IDS.fundingDecision(p.no)}::uuid`.execute(
          api.db,
        ),
      );
      const roles = await expectHolds(f.decided_by, "funding.approve", `${p.code} funding`);
      // funding.ts approverRoleOf: FIN preferred, then SP, then the first.
      const configured = roles.find((r) => r === "FIN") ?? roles.find((r) => r === "SP") ?? roles[0];
      expect(f.approver_role_code, `${p.code} approver role`).toBe(configured);
      expect(f.on_behalf_of_user_id).toBeNull();
      const d = await one(
        sql<{ decided_by: string; kind: string; status: string }>`SELECT decided_by::text, kind, status FROM decision
          WHERE id = ${f.decision_id}::uuid`.execute(api.db),
      );
      expect([d.decided_by, d.kind, d.status]).toEqual([f.decided_by, "executive", "decided"]);
      // The funded case is the initiative's own, and the amount is its cash investment (no new figure).
      const c = DEMO_INITIATIVE_CASES.find((x) => x.initiativeId === p.id)!;
      expect([f.business_case_id, Number(f.amount)]).toEqual([c.id, Number(c.fundingAmount)]);
      await expectAuditPerWrite("funding_decision", DEMO_PORTFOLIO_IDS.fundingDecision(p.no));
      await expectAuditPerWrite("decision", f.decision_id);
    }
  });

  it("capacity, demand and milestones: each write by a holder of its permission; one audit event per write", async () => {
    for (const p of DEMO_PORTFOLIO) {
      const role = await one(
        sql<{ created_by: string }>`SELECT created_by::text FROM resource_role
          WHERE id = ${DEMO_PORTFOLIO_IDS.resourceRole(p.no)}::uuid`.execute(api.db),
      );
      await expectHolds(role.created_by, "capacity.edit", `${p.code} resource role`);
      await expectAuditPerWrite("resource_role", DEMO_PORTFOLIO_IDS.resourceRole(p.no));
      for (let m = 1; m <= DEMO_CAPACITY_MONTHS.length; m += 1) {
        const cap = await one(
          sql<{ created_by: string; available_fte: string }>`SELECT created_by::text, available_fte::text FROM capacity
            WHERE id = ${DEMO_PORTFOLIO_IDS.capacity(p.no, m)}::uuid`.execute(api.db),
        );
        await expectHolds(cap.created_by, "capacity.edit", `${p.code} capacity ${m}`);
        await expectAuditPerWrite("capacity", DEMO_PORTFOLIO_IDS.capacity(p.no, m));
        const dem = await one(
          sql<{ created_by: string; committed_by: string; status: string; demand_fte: string }>`
            SELECT created_by::text, committed_by::text, status, demand_fte::text FROM resource_demand
             WHERE id = ${DEMO_PORTFOLIO_IDS.resourceDemand(p.no, m)}::uuid`.execute(api.db),
        );
        await expectHolds(dem.created_by, "capacity.edit", `${p.code} demand ${m}`);
        await expectHolds(dem.committed_by, "capacity.commit", `${p.code} demand commit ${m}`);
        expect(dem.status).toBe("committed");
        // Within capacity, compared as decimals in SQL (no float).
        const within = await one(
          sql<{ ok: boolean }>`SELECT (${dem.demand_fte}::numeric <= ${cap.available_fte}::numeric) AS ok`.execute(api.db),
        );
        expect(within.ok, `${p.code} month ${m}`).toBe(true);
        expect(await expectAuditPerWrite("resource_demand", DEMO_PORTFOLIO_IDS.resourceDemand(p.no, m))).toEqual([
          "resource_demand.create",
          "resource_demand.commit",
        ]);
      }
      for (let k = 1; k <= p.milestones.length; k += 1) {
        const ms = await one(
          sql<{ created_by: string; approved_by: string }>`SELECT created_by::text, approved_by::text FROM milestone
            WHERE id = ${DEMO_PORTFOLIO_IDS.milestone(p.no, k)}::uuid`.execute(api.db),
        );
        const c1 = await holds(ms.created_by, "initiative.edit");
        const c2 = await holds(ms.created_by, "roadmap.edit");
        expect(c1.length + c2.length, `${p.code} milestone ${k} creator`).toBeGreaterThan(0);
        await expectHolds(ms.approved_by, "roadmap.approve", `${p.code} milestone ${k} approval`);
        await expectAuditPerWrite("milestone", DEMO_PORTFOLIO_IDS.milestone(p.no, k));
      }
    }
  });

  it("initiative steps: one audit event per version step, by holders of the step's permission", async () => {
    for (const p of DEMO_PORTFOLIO) {
      const i = await one(
        sql<{ launched_by: string; status: string }>`SELECT launched_by::text, status FROM initiative
          WHERE id = ${p.id}::uuid`.execute(api.db),
      );
      expect(i.status).toBe("launched");
      await expectHolds(i.launched_by, "initiative.launch", `${p.code} launch`);
      const actions = await expectAuditPerWrite("initiative", p.id);
      for (const a of ["initiative.submit", "initiative.rank", "initiative.select", "initiative.fund", "initiative.launch"])
        expect(actions, p.code).toContain(a);
    }
  });

  it("no gate exception is seeded, and the demo access administrator holds no approval permission", async () => {
    const ex = await sql<{ n: string }>`SELECT count(*)::text AS n FROM gate_exception`.execute(api.db);
    expect(ex.rows[0]!.n).toBe("0");
    const grants = await loadGrants(api.db, DEMO_ACCESS_ADMIN.id);
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants)
      for (const perm of g.permissions) expect(isApprovalPermission(perm), `${g.roleCode} ${perm}`).toBe(false);
  });

  it("seedDemo stays refused in production: MTH_ENV=production, and a production-initialized database", async () => {
    const { adminUrl } = inject("mthDb");
    const a = await createScratchDatabase(adminUrl, "mth_sec_r3_prod_env");
    extra.push(a);
    await migrate(roleUrl(adminUrl, a, "mth_owner"));
    const opts = { runKind: "seed", requestedVia: "cli", requestedBy: null, devIssuerBinding: true } as const;
    await expect(seedDemo(roleUrl(adminUrl, a, "mth_owner"), { ...opts, mthEnv: "production" } as never)).rejects.toThrow(
      /refused: MTH_ENV is production/,
    );
    const b = await createScratchDatabase(adminUrl, "mth_sec_r3_prod_marker");
    extra.push(b);
    await migrate(roleUrl(adminUrl, b, "mth_owner"));
    const pool = createPool(roleUrl(adminUrl, b, "mth_owner"), { max: 1 });
    const db = createDb(pool);
    try {
      await bootstrap(db, {
        orgCode: "SECR3",
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
  }, 120_000);
});
