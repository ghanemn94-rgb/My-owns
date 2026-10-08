// code-security-reviewer DG3 round-1 probe B (T-DG3-REV-SEC-R1). NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-r1/. All data is synthetic; nothing here approves anything real.
//  B1 database separation of duties, bypassing the API: as the runtime role mth_app, INSERT a copy of an already
//     decided row whose approver column is set to its proposer/author/recorder/submitter -> refused (23514, named CHECK);
//  B2 the runtime role cannot switch the guards off (session_replication_role, DISABLE TRIGGER, SET CONSTRAINTS
//     IMMEDIATE only makes the G1 guard fire earlier);
//  B3 the dependency graph guard ALONE (raw SQL, no API): 25 races of A->B vs B->A on two connections -> exactly one
//     commits each time; a 3-cycle is refused naming the cycle; re-activating an archived edge that closes a cycle and
//     re-pointing an edge into a cycle are refused too;
// Revision 2: copies start at version 1 (the row guard's version step fired first in revision 1); raw edges use a
// DEP-nnnnnn code (dependency_code_check); the FIN/SP caller is granted per transformation (FIN does not inherit).
//  B4 API: 95% / 105% weight totals -> 422 and nothing written; weight-set approve / override revoke / Finance
//     validations carrying onBehalfOfUserId -> 400 (strict) and nothing written; the proposer holding the approver role
//     too cannot approve their own weight set (403) - and the same through the deferred CHECK.
import { sql } from "@mth/db";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { record } from "../../../src/modules/audit/index.ts";
import { auditOfRequest, call, grant, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";
import { exerciseP3BeAOperations } from "../contract/p3-exercises-be-a.ts";
import { exerciseP3BeBOperations } from "../contract/p3-exercises-be-b.ts";
import { exerciseP3BeCOperations, insertInitiatives } from "../contract/p3-exercises-be-c.ts";
import { exerciseP3BeDOperations } from "../contract/p3-exercises-be-d.ts";
import { exerciseP3BeEOperations } from "../contract/p3-exercises-be-e.ts";
import { exerciseP3KbeBOperations } from "../contract/p3-exercises-kbe-b.ts";
import { exerciseP3KbeCOperations } from "../contract/p3-exercises-kbe-c.ts";

let api: TestApi;
let w: World;
let appPool: pg.Pool;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const ctx = { api, world: w, mirrored: (m: string, u: string, o = {}) => call(api.app, m, u, o) };
  for (const ex of [
    exerciseP3BeAOperations,
    exerciseP3BeBOperations,
    exerciseP3BeCOperations,
    exerciseP3BeDOperations,
    exerciseP3BeEOperations,
    exerciseP3KbeBOperations,
    exerciseP3KbeCOperations,
  ])
    await ex(ctx);
  appPool = new pg.Pool({ connectionString: inject("mthDb").appUrl, max: 6 });
  const who = await appPool.query("select current_user, (select rolsuper from pg_roles where rolname = current_user) su");
  console.log(`[probe-B] raw pool role ${who.rows[0].current_user} superuser=${who.rows[0].su}`);
  expect(who.rows[0].current_user).toBe("mth_app");
}, 600_000);
afterAll(async () => {
  await appPool?.end();
  await api.close();
});

type PgErr = { code?: string; constraint?: string; message?: string };
async function tryTx(fn: (c: pg.PoolClient) => Promise<void>): Promise<PgErr | null> {
  const c = await appPool.connect();
  try {
    await c.query("BEGIN");
    await fn(c);
    await c.query("COMMIT");
    return null;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    return e as PgErr;
  } finally {
    c.release();
  }
}

describe("B1 database separation of duties (raw SQL as mth_app)", () => {
  const cases: [string, string, string, string][] = [
    // table, approver column, proposer column, expected CHECK
    ["scoring_weight_set", "approved_by", "created_by", "scoring_weight_set_approver_not_proposer"],
    ["ranking_override", "decided_by", "proposed_by", "ranking_override_approver_not_proposer"],
    ["business_case", "baseline_validated_by", "created_by", "business_case_validator_not_author"],
    ["benefit_formula_version", "validated_by", "created_by", "benefit_formula_version_validator_not_author"],
    ["gate_dispensation", "decided_by", "recorded_by", "gate_dispensation_decider_not_recorder"],
    ["deliverable", "decided_by", "submitted_by", "deliverable_acceptor_not_submitter"],
  ];
  it.each(cases)("%s: a copy with %s = %s is refused by %s", async (table, approver, proposer, check) => {
    const src = await appPool.query(
      `SELECT id FROM ${table} WHERE ${approver} IS NOT NULL AND ${proposer} IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    );
    console.log(`[probe-B1] ${table}: decided source rows available=${src.rowCount}`);
    expect(src.rowCount, `${table} has no decided row to copy`).toBe(1);
    const err = await tryTx(async (c) => {
      await c.query(
        `INSERT INTO ${table} SELECT (jsonb_populate_record(NULL::${table}, to_jsonb(x) || jsonb_build_object('id', $2::uuid, 'version', 1, '${approver}', x.${proposer}))).* FROM ${table} x WHERE x.id = $1`,
        [src.rows[0].id, uuidv7()],
      );
    });
    console.log(`[probe-B1] ${table}: ${err?.code} ${err?.constraint} ${err?.message?.slice(0, 160)}`);
    expect([err?.code, err?.constraint]).toEqual(["23514", check]);
  });
  it("the same UPDATE route: setting an existing decided row's approver to its proposer is refused", async () => {
    for (const [table, approver, proposer] of cases) {
      const src = await appPool.query(`SELECT id FROM ${table} WHERE ${approver} IS NOT NULL ORDER BY created_at DESC LIMIT 1`);
      const err = await tryTx(async (c) => {
        await c.query(`UPDATE ${table} SET ${approver} = ${proposer}, version = version + 1 WHERE id = $1`, [src.rows[0].id]);
      });
      console.log(`[probe-B1u] ${table}: ${err?.code} ${err?.constraint} ${err?.message?.slice(0, 160)}`);
      expect(err, table).not.toBeNull();
      expect(err!.code, table).toMatch(/^(23514|23000|55000|P0001|42501)$/);
    }
  });
});

describe("B2 the runtime role cannot switch the guards off", () => {
  it("session_replication_role, DISABLE TRIGGER and ALTER on guarded tables are denied to mth_app", async () => {
    for (const stmt of [
      "SET session_replication_role = replica",
      "ALTER TABLE gate_decision DISABLE TRIGGER gate_decision_g1_agreements",
      "ALTER TABLE dependency DISABLE TRIGGER dependency_cycle_guard",
      "ALTER TABLE scoring_weight_set DROP CONSTRAINT scoring_weight_set_approver_not_proposer",
      "DROP TRIGGER dependency_cycle_guard ON dependency",
      "CREATE OR REPLACE FUNCTION dependency_cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$",
    ]) {
      const err = await tryTx(async (c) => {
        await c.query(stmt);
      });
      console.log(`[probe-B2] ${stmt.slice(0, 70)} -> ${err?.code} ${err?.message?.slice(0, 100)}`);
      expect(err?.code, stmt).toBe("42501");
    }
  });
});

describe("B3 the dependency-graph guard alone (raw SQL, no API)", () => {
  async function graphWorld(n: number) {
    const p = await setupP2World(api, w);
    const ini = await insertInitiatives(api, p, Array.from({ length: n }, () => ({})));
    const t = await api.db.selectFrom("transformation").select("organization_id").where("id", "=", p.transformationId).executeTakeFirstOrThrow();
    return { p, ini, org: t.organization_id };
  }
  /** Inserts an initiative edge with its audit event inside an open transaction (raw SQL). */
  async function edge(c: pg.PoolClient, org: string, tid: string, actor: string, from: string, to: string): Promise<string> {
    const id = uuidv7();
    const code = `DEP-${100000 + Math.floor(Math.random() * 899999)}`;
    await c.query(
      `INSERT INTO dependency (id, organization_id, transformation_id, code, description, from_kind, from_initiative_id, to_kind, to_initiative_id, dependency_type, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'Synthetic probe edge','initiative',$5,'initiative',$6,'tech','open',$7,$7)`,
      [id, org, tid, code, from, to, actor],
    );
    await c.query(
      `INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, request_id, source)
       VALUES ($1,$2,$3,'user',$4,'dependency.create','dependency',$5,1,$6,'api')`,
      [uuidv7(), org, tid, actor, id, `probe-${uuidv7()}`],
    );
    return id;
  }

  it("25 races A->B vs B->A on two connections: exactly one commits each time; the loser names the cycle", async () => {
    let oneEach = 0;
    for (let i = 0; i < 25; i++) {
      const { p, ini, org } = await graphWorld(2);
      const [a, b] = ini;
      const c1 = await appPool.connect();
      const c2 = await appPool.connect();
      try {
        await c1.query("BEGIN");
        await c2.query("BEGIN");
        await edge(c1, org, p.transformationId, p.lead.id, a!.id, b!.id); // takes the graph lock in the trigger
        const second = edge(c2, org, p.transformationId, p.lead.id, b!.id, a!.id).then(
          () => null,
          (e: PgErr) => e,
        ); // blocks on the lock
        await new Promise((r) => setTimeout(r, 30));
        const first = await c1.query("COMMIT").then(
          () => null,
          (e: PgErr) => e,
        );
        const err2 = await second;
        const commit2 = err2 === null ? await c2.query("COMMIT").then(() => null, (e: PgErr) => e) : null;
        if (err2 !== null) await c2.query("ROLLBACK");
        const committed = [first === null, err2 === null && commit2 === null].filter(Boolean).length;
        if (i < 3) console.log(`[probe-B3] race ${i}: first=${first?.code ?? "commit"} second=${err2?.code ?? commit2?.code ?? "commit"} ${err2?.constraint ?? ""} ${err2?.message ?? ""}`);
        expect(committed).toBe(1);
        expect(err2?.constraint).toBe("dependency_acyclic");
        expect(err2?.message).toMatch(new RegExp(`dependency cycle: ${b!.code} -> ${a!.code} -> ${b!.code}`));
        oneEach++;
      } finally {
        c1.release();
        c2.release();
      }
    }
    console.log(`[probe-B3] races with exactly one commit: ${oneEach}/25`);
  }, 120_000);

  it("A->B->C->A by raw SQL is refused naming the cycle; nothing persists", async () => {
    const { p, ini, org } = await graphWorld(3);
    const [a, b, c] = ini;
    expect(await tryTx(async (x) => void (await edge(x, org, p.transformationId, p.lead.id, a!.id, b!.id)))).toBeNull();
    expect(await tryTx(async (x) => void (await edge(x, org, p.transformationId, p.lead.id, b!.id, c!.id)))).toBeNull();
    const err = await tryTx(async (x) => void (await edge(x, org, p.transformationId, p.lead.id, c!.id, a!.id)));
    console.log(`[probe-B3] 3-cycle: ${err?.code} ${err?.constraint} ${err?.message}`);
    expect([err?.code, err?.constraint]).toEqual(["23514", "dependency_acyclic"]);
    expect(err?.message).toBe(`dependency cycle: ${c!.code} -> ${a!.code} -> ${b!.code} -> ${c!.code}`);
    const n = await appPool.query("SELECT count(*)::int n FROM dependency WHERE transformation_id = $1", [p.transformationId]);
    expect(n.rows[0].n).toBe(2);
  });

  it("API: A->B->C->A is 422 dependency.cycle naming the cycle; nothing written", async () => {
    const { p, ini } = await graphWorld(3);
    const [a, b, c] = ini;
    const mk = (f: { id: string }, t: { id: string }) =>
      call(api.app, "POST", "/api/v1/dependencies", {
        session: p.lead.session,
        body: { transformationId: p.transformationId, description: "Synthetic", from: { kind: "initiative", initiativeId: f.id }, toInitiativeId: t.id, dependencyType: "tech" },
      });
    expect((await mk(a!, b!)).status).toBe(201);
    expect((await mk(b!, c!)).status).toBe(201);
    const res = await mk(c!, a!);
    console.log(`[probe-B3] API 3-cycle: ${res.status} ${res.body.code} ${res.body.detail} pointer=${res.body.errors?.[0]?.pointer}`);
    expect([res.status, res.body.code]).toEqual([422, "dependency.cycle"]);
    expect(res.body.detail).toContain(`${c!.code} → ${a!.code} → ${b!.code} → ${c!.code}`);
    expect((await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action)).toEqual([]);
  });

  it("re-activating an archived edge, or re-pointing an edge, that closes a cycle is refused by the guard", async () => {
    const { p, ini, org } = await graphWorld(3);
    const [a, b, c] = ini;
    let ab = "";
    expect(await tryTx(async (x) => void (ab = await edge(x, org, p.transformationId, p.lead.id, a!.id, b!.id)))).toBeNull();
    // archive A->B, then add B->A (fine), then un-archive A->B (closes the cycle)
    expect(
      await tryTx(async (x) => {
        await x.query("UPDATE dependency SET status='archived', archived_at=now(), archived_by=$2, archive_reason='probe', version=version+1 WHERE id=$1", [ab, p.lead.id]);
        await x.query(`INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, prior_version, new_version, request_id, source) VALUES ($1,$2,$3,'user',$4,'dependency.archive','dependency',$5,1,2,$6,'api')`, [uuidv7(), org, p.transformationId, p.lead.id, ab, `probe-${uuidv7()}`]);
      }),
    ).toBeNull();
    let bc = "";
    expect(await tryTx(async (x) => void (await edge(x, org, p.transformationId, p.lead.id, b!.id, a!.id)))).toBeNull();
    const unarchive = await tryTx(async (x) => {
      await x.query("UPDATE dependency SET status='open', archived_at=NULL, archived_by=NULL, archive_reason=NULL, version=version+1 WHERE id=$1", [ab]);
    });
    console.log(`[probe-B3] un-archive closing a cycle: ${unarchive?.code} ${unarchive?.constraint} ${unarchive?.message}`);
    expect(unarchive?.constraint).toBe("dependency_acyclic");
    expect(await tryTx(async (x) => void (bc = await edge(x, org, p.transformationId, p.lead.id, b!.id, c!.id)))).toBeNull();
    // re-point B->C to C->B? use: C->? none. Re-point B->C's target to... create C->A? Instead re-point B->C into C... :
    // existing open edges: B->A, B->C. Add A->C (fine). Re-point B->C to become C->B: closes nothing. Re-point A->C to
    // C->B: C->B->A ... no. Make a cycle: re-point B->C so that it reads A->B (with B->A existing) -> cycle.
    const repoint = await tryTx(async (x) => {
      await x.query("UPDATE dependency SET from_initiative_id=$2, to_initiative_id=$3, version=version+1 WHERE id=$1", [bc, a!.id, b!.id]);
    });
    console.log(`[probe-B3] re-point into a cycle: ${repoint?.code} ${repoint?.constraint} ${repoint?.message}`);
    expect(repoint?.constraint).toBe("dependency_acyclic");
  });
});

describe("B4 API: weights, on-behalf on the strict approvals, self-approval by a dual-role proposer", () => {
  it("95% and 105% -> 422 prioritization.weights_total with the exact text; nothing written", async () => {
    const p = await setupP2World(api, w);
    const T = `/api/v1/transformations/${p.transformationId}/prioritization/weight-sets`;
    const sets = async () => (await api.db.selectFrom("scoring_weight_set").select("id").where("transformation_id", "=", p.transformationId).execute()).length;
    const before = await sets();
    for (const [total, weights] of [
      ["95.00", [["strategic_fit", "25"], ["financial_value", "25"], ["customer_impact", "20"], ["feasibility", "15"], ["time_to_value", "10"]]],
      ["105.00", [["strategic_fit", "25"], ["financial_value", "25"], ["customer_impact", "20"], ["feasibility", "15"], ["time_to_value", "20"]]],
      ["99.99", [["strategic_fit", "33.33"], ["financial_value", "33.33"], ["customer_impact", "33.33"]]],
    ] as const) {
      const res = await call(api.app, "POST", T, {
        session: p.lead.session,
        body: { rationale: "Synthetic probe", weights: weights.map(([c, v]) => ({ criterionCode: c, weightPercent: v })) },
      });
      console.log(`[probe-B4] weights total ${total}: ${res.status} ${res.body.code} "${res.body.detail}"`);
      expect([res.status, res.body.code, res.body.detail]).toEqual([422, "prioritization.weights_total", `Weights must total 100% (got ${total}%)`]);
      expect((await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action)).toEqual([]);
    }
    expect(await sets()).toBe(before);
    // 3 decimals is a format error, never silently rounded to 100.
    const r3 = await call(api.app, "POST", T, {
      session: p.lead.session,
      body: { rationale: "Synthetic probe", weights: [{ criterionCode: "strategic_fit", weightPercent: "50.005" }, { criterionCode: "feasibility", weightPercent: "49.995" }] },
    });
    console.log(`[probe-B4] 50.005 + 49.995: ${r3.status} ${r3.body.code}`);
    expect(r3.status).toBeGreaterThanOrEqual(400);
    expect(r3.status).toBeLessThan(500);
    expect(await sets()).toBe(before);
  });

  it("a proposer who ALSO holds SP cannot approve their own weight set (403); onBehalfOfUserId on approve is 400", async () => {
    const p = await setupP2World(api, w);
    await grant(api.db, w.grantor.id, p.lead.id, "SP", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const T = `/api/v1/transformations/${p.transformationId}/prioritization/weight-sets`;
    const weights = [
      { criterionCode: "strategic_fit", weightPercent: "40" },
      { criterionCode: "financial_value", weightPercent: "60" },
    ];
    const v2 = await call(api.app, "POST", T, { session: p.lead.session, body: { rationale: "Synthetic probe", weights } });
    expect(v2.status).toBe(201);
    const self = await call(api.app, "POST", `${T}/2/approve`, { session: p.lead.session, headers: ifm(v2.body.version), body: {} });
    console.log(`[probe-B4] dual-role self-approve: ${self.status} ${self.body.code}`);
    expect([self.status, self.body.code]).toEqual([403, "approval.approver_is_proposer"]);
    const ob = await call(api.app, "POST", `${T}/2/approve`, {
      session: p.sponsor.session,
      headers: ifm(v2.body.version),
      body: { onBehalfOfUserId: p.lead.id },
    });
    console.log(`[probe-B4] weight-set approve onBehalfOf: ${ob.status} ${ob.body.code}`);
    expect(ob.status).toBe(400);
    const row = await api.db.selectFrom("scoring_weight_set").selectAll().where("transformation_id", "=", p.transformationId).where("version_no", "=", 2).executeTakeFirstOrThrow();
    expect([row.status, row.approved_by, row.version]).toEqual(["proposed", null, v2.body.version]);
  });

  it("Finance validations and override revoke refuse onBehalfOfUserId (strict 400); nothing written", async () => {
    // Uses rows the KBE/BE-D exercises created; the AUD-independent check is the schema, so any caller gets 400.
    const fin = await api.db.selectFrom("business_case").selectAll().orderBy("created_at", "desc").executeTakeFirstOrThrow();
    const fv = await api.db.selectFrom("benefit_formula_version").selectAll().orderBy("created_at", "desc").executeTakeFirstOrThrow();
    const ov = await api.db.selectFrom("ranking_override").selectAll().orderBy("created_at", "desc").executeTakeFirstOrThrow();
    // A FIN holder in org A who is not the author.
    const { createUser, signIn } = await import("../../support/harness.ts");
    const u = await createUser(api.db, w.orgA.id);
    // FIN does not inherit downward: grant FIN and SP on each target row's transformation.
    for (const tid of new Set([fin.transformation_id, fv.transformation_id, ov.transformation_id]))
      for (const role of ["FIN", "SP"]) await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: tid }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const someone = w.office.id;
    const calls: [string, string, number, Record<string, unknown>][] = [
      ["baseline-validation", `/api/v1/business-cases/${fin.id}/baseline-validation`, fin.version, { result: "validated", note: "probe", onBehalfOfUserId: someone }],
      ["formula-version-validation", `/api/v1/benefit-formulas/${fv.formula_id}/versions/${fv.version_no}/validation`, fv.version, { result: "validated", note: "probe", onBehalfOfUserId: someone }],
      ["override-revoke", `/api/v1/transformations/${ov.transformation_id}/prioritization/overrides/${ov.id}/revoke`, ov.version, { reason: "probe", onBehalfOfUserId: someone }],
    ];
    for (const [name, url, version, body] of calls) {
      const res = await call(api.app, "POST", url, { session: s, headers: ifm(version), body });
      const written = (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);
      console.log(`[probe-B4] ${name} onBehalfOf: ${res.status} ${res.body.code} pointer=${res.body.errors?.[0]?.pointer} audit=${JSON.stringify(written)}`);
      expect(res.status, name).toBe(400);
      expect(written.filter((a) => a !== "authorization.denied")).toEqual([]);
    }
  });
});

describe("B5 audit `changes` shape on every P3 audit event written by the exercises", () => {
  it("every top-level member of `changes` is exactly {from, to} (ADR-0004 diff shape)", async () => {
    const r = await appPool.query(`
      SELECT e.record_type, e.action, k.key, k.value
      FROM audit_event e, jsonb_each(e.changes) k
      WHERE e.changes IS NOT NULL
        AND e.record_type = ANY($1)
        AND NOT (jsonb_typeof(k.value) = 'object' AND k.value ?& ARRAY['from','to']
                 AND (SELECT count(*) FROM jsonb_object_keys(k.value)) = 2)`,
      [["roadmap_wave", "initiative", "initiative_gap_link", "initiative_outcome_contribution", "initiative_decision_link", "deliverable", "milestone", "gate_dispensation", "scoring_weight_set", "initiative_score", "ranking_snapshot", "ranking_override", "dependency_type", "resource_role", "capacity", "resource_demand", "portfolio_selection", "funding_decision", "benefit_formula", "benefit_formula_version", "benefit_calculation", "business_case", "business_case_line", "dependency", "gate_decision", "decision"]],
    );
    const total = await appPool.query(`SELECT count(*)::int n, count(DISTINCT action)::int a FROM audit_event WHERE changes IS NOT NULL`);
    console.log(`[probe-B5] audit events with changes: ${total.rows[0].n} (${total.rows[0].a} actions); malformed members: ${r.rowCount}`);
    for (const row of r.rows.slice(0, 20)) console.log(`[probe-B5] malformed ${row.record_type} ${row.action} ${row.key} ${JSON.stringify(row.value).slice(0, 120)}`);
    expect(r.rowCount).toBe(0);
  });
});

void record;
void sql;
