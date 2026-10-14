// The `registers` output (T-DG5-KBE-C; ADR-0045 §1, §5, §12; p5-work-split §F.1). Proves, against the run's disposable
// PostgreSQL:
//  - REQ-S13-004 / ADR-0045 §1: each of the six registers returns exactly the rows its DG2-DG4 list route returns for the
//    same filters (all pages), in the same order; a register filtered to RAID rows equals the DG4 list route's rows;
//  - REQ-S13-008: a pending benefit value in the benefits register has `validation: provisional` and is counted in the
//    snapshot's provisionalValueCount; the source row is provisional; an unmonetised CX benefit's money value is n/a,
//    a missing planned value is Unknown, never 0; value bases are separate columns, never summed;
//  - 5,001 rows -> 422 report.too_large, nothing written.
// All data is SYNTHETIC; nothing here grants a business or Finance approval or touches the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import {
  benefitAt,
  cxBody,
  insertInitiative,
  insertSubmittedMeasurement,
  seedBenefitWorld,
  type BenefitWorld,
} from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let b: BenefitWorld;

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

/** Every page of a list route (limit 100), in the route's order. */
async function listAll(url: string, session: Session): Promise<Body[]> {
  const out: Body[] = [];
  let cursor: string | null = null;
  do {
    const sep = url.includes("?") ? "&" : "?";
    const res: { status: number; body: Body } = await call<Body>(
      api.app,
      "GET",
      `${url}${sep}limit=100${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
      { session },
    );
    ok(res, 200, url);
    out.push(...res.body.items);
    cursor = res.body.nextCursor;
  } while (cursor !== null);
  return out;
}

async function registerOf(parameters: Record<string, unknown>, session: Session = b.s.tl): Promise<Body> {
  const s = ok(
    await call<Body>(api.app, "POST", `${b.base}/reports/registers/generate`, { session, body: { parameters } }),
    201,
    `generate ${JSON.stringify(parameters)}`,
  );
  return s;
}
const tableOf = (s: Body) => s.content.sections.find((x: Body) => x.key === "register");
const idsOf = (s: Body) => tableOf(s).rows.map((r: Body) => r.recordId);
const cell = (s: Body, recordId: string, column: string) => {
  const t = tableOf(s);
  const j = t.columns.findIndex((c: Body) => c.key === column);
  return t.rows.find((r: Body) => r.recordId === recordId).cells[j];
};

let riskIds: string[] = [];
let issueId: string;
let cxId: string;
let pendingId: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  const raid = async (type: string, description: string, probability: string | null) =>
    ok(
      await call<Body>(api.app, "POST", `${b.base}/raid`, {
        session: b.s.tl,
        body: {
          type,
          description,
          impact: "medium",
          ...(probability === null ? {} : { probability }),
          ownerUserId: b.users.bo.id,
        },
      }),
      201,
      "createRaidEntry",
    );
  const r1 = await raid("risk", "Synthetic risk one", "high");
  const r2 = await raid("risk", "Synthetic risk two", "low");
  const i1 = await raid("issue", "Synthetic issue one", null);
  riskIds = [r1.id, r2.id];
  issueId = i1.id;
  // Actions: one overdue (due in the past, open), one not.
  for (const [title, dueDate] of [
    ["Synthetic overdue action", "2026-01-05"],
    ["Synthetic future action", "2099-01-05"],
  ] as const)
    ok(
      await call<Body>(api.app, "POST", `${b.base}/raid/${r1.id}/actions`, {
        session: b.s.tl,
        body: { title, ownerUserId: b.users.bo.id, dueDate },
      }),
      201,
      "createAction",
    );
  for (const title of ["Synthetic decision A", "Synthetic decision B"])
    ok(
      await call<Body>(api.app, "POST", "/api/v1/decisions", {
        session: b.s.tl,
        body: { transformationId: b.transformationId, title },
      }),
      201,
      "createDecision",
    );
  const ini = await insertInitiative(api.db, b);
  ok(
    await call<Body>(api.app, "POST", "/api/v1/dependencies", {
      session: b.s.tl,
      body: {
        transformationId: b.transformationId,
        description: "Synthetic vendor delivery",
        from: { kind: "external", label: "Synthetic vendor" },
        toInitiativeId: ini,
        dependencyType: "vendor",
      },
    }),
    201,
    "createDependency",
  );
  const m = await benefitAt(api, b, "measure");
  pendingId = m.id;
  await insertSubmittedMeasurement(api.db, b, m.id, "1000");
  cxId = (await benefitAt(api, b, "identify", cxBody(b))).id;
}, 120_000);
afterAll(() => api.close());

describe("ADR-0045 §1: each register returns exactly its list route's rows for the same filters", () => {
  it("RAID filtered to risks equals GET /raid?type=risk, row by row; unfiltered equals GET /raid", async () => {
    const s = await registerOf({ register: "raid", filters: { type: "risk" } });
    const listed = await listAll(`${b.base}/raid?type=risk`, b.s.tl);
    expect(idsOf(s)).toEqual(listed.map((r) => r.id));
    expect(idsOf(s).sort()).toEqual([...riskIds].sort());
    for (const r of listed) {
      expect(cell(s, r.id, "code").value).toBe(r.code);
      expect(cell(s, r.id, "description").value).toBe(r.description);
      expect(cell(s, r.id, "status").value).toBe(r.status);
      expect(cell(s, r.id, "probability").value).toBe(r.probability);
    }
    const all = await registerOf({ register: "raid" });
    expect(idsOf(all)).toEqual((await listAll(`${b.base}/raid`, b.s.tl)).map((r) => r.id));
    // An Issue has no probability: n/a, not Unknown.
    expect(cell(all, issueId, "probability")).toMatchObject({
      value: null,
      validation: "not_applicable",
      reason: null,
    });
    // The filters are part of the stored parameters and of the content.
    expect(s.parameters).toEqual({ register: "raid", filters: { type: "risk" } });
  });

  it("actions (overdue filter), decisions, dependencies, KPIs and benefits equal their list routes", async () => {
    const overdue = await registerOf({ register: "actions", filters: { overdue: true } });
    const overdueListed = await listAll(`${b.base}/action-register?overdue=true`, b.s.tl);
    expect(overdueListed.length).toBe(1);
    expect(idsOf(overdue)).toEqual(overdueListed.map((r) => r.id));
    expect(cell(overdue, overdueListed[0].id, "overdue").value).toBe("yes");
    const actions = await registerOf({ register: "actions" });
    expect(idsOf(actions)).toEqual((await listAll(`${b.base}/action-register`, b.s.tl)).map((r) => r.id));

    const decisions = await registerOf({ register: "decisions", filters: { status: "open" } });
    const dl = await listAll(`/api/v1/decisions?transformationId=${b.transformationId}&status=open`, b.s.tl);
    expect(dl.length).toBeGreaterThanOrEqual(2);
    expect(idsOf(decisions)).toEqual(dl.map((r) => r.id));

    const deps = await registerOf({ register: "dependencies" });
    const depl = await listAll(`/api/v1/dependencies?transformationId=${b.transformationId}`, b.s.tl);
    expect(depl.length).toBe(1);
    expect(idsOf(deps)).toEqual(depl.map((r) => r.id));

    const kpis = await registerOf({ register: "kpis" });
    expect(idsOf(kpis)).toEqual((await listAll(`${b.base}/kpi-definitions`, b.s.tl)).map((r) => r.id));

    const benefits = await registerOf({ register: "benefits" });
    const bl = await listAll(`${b.base}/benefits`, b.s.tl);
    expect(idsOf(benefits)).toEqual(bl.map((r) => r.id));
    for (const r of bl) expect(cell(benefits, r.id, "code").value).toBe(r.code);
  });
});

describe("REQ-S13-008: provisional and unknown values in the benefits register", () => {
  it("a pending benefit value is provisional and counted; n/a and Unknown are never 0", async () => {
    const s = await registerOf({ register: "benefits" });
    const listed = (await listAll(`${b.base}/benefits`, b.s.tl)).find((r) => r.id === pendingId);
    expect(listed.realized.pending).toMatchObject({ status: "known", amount: "1000.0000" });
    expect(cell(s, pendingId, "pending")).toEqual({
      type: "decimal",
      value: "1000.0000",
      unitKind: "currency",
      currency: "SAR",
      valueBasis: "submitted",
      validation: "provisional",
      reason: null,
    });
    expect(cell(s, pendingId, "pending_count")).toMatchObject({ value: 1, validation: "provisional" });
    // The validated realized value of the same benefit is a separate column and basis (nothing validated: 0, n/a).
    expect(cell(s, pendingId, "realized_validated")).toMatchObject({
      value: "0.0000",
      valueBasis: "validated",
      validation: "not_applicable",
    });
    expect(s.provisionalValueCount).toBeGreaterThanOrEqual(2);
    // An unmonetised CX benefit: Value (SAR) n/a with no number; never 0.
    expect(cell(s, cxId, "planned_value")).toMatchObject({ value: null, validation: "not_applicable", reason: null });
    // A planned value not entered yet is Unknown with no number.
    expect(cell(s, pendingId, "planned_value")).toMatchObject({
      value: null,
      validation: "unknown",
      reason: "missing",
    });
    expect(s.unknownValueCount).toBeGreaterThanOrEqual(1);
    const sources = ok(
      await call<Body>(api.app, "GET", `${b.base}/report-snapshots/${s.id}/sources`, { session: b.s.auditor }),
      200,
      "sources",
    ).items;
    expect(sources.find((x: Body) => x.recordId === pendingId)).toMatchObject({
      recordType: "benefit",
      validationState: "provisional",
    });
    // A column never mixes value bases: every planned cell is `planned`, every pending cell `submitted`.
    const t = tableOf(s);
    for (const key of ["planned_value", "realized_validated", "realized_sustained", "pending"]) {
      const j = t.columns.findIndex((c: Body) => c.key === key);
      expect(new Set(t.rows.map((r: Body) => r.cells[j].valueBasis)).size).toBe(1);
    }
    expect(t.totals).toEqual([]);
  });
});

describe("size limit (ADR-0045 §1)", () => {
  it("5,001 rows -> 422 report.too_large and nothing written; the live report is refused the same way", async () => {
    const big = await seedBenefitWorld(api, w);
    const owner = big.users.bo.id;
    await api.db.transaction().execute(async (tx) => {
      await sql`
        WITH g AS (SELECT mth_uuid_v7() AS id, n FROM generate_series(1, 5001) AS n),
        ins AS (
          INSERT INTO action_item (id, organization_id, transformation_id, title, owner_user_id, created_by, updated_by)
          SELECT g.id, ${big.organizationId}::uuid, ${big.transformationId}::uuid, 'Synthetic bulk action ' || g.n,
                 ${owner}::uuid, ${owner}::uuid, ${owner}::uuid
            FROM g
          RETURNING id)
        INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type,
                                 record_id, new_version, request_id, source)
        SELECT mth_uuid_v7(), ${big.organizationId}::uuid, ${big.transformationId}::uuid, 'user', ${owner}::uuid,
               'action_item.create', 'action_item', ins.id, 1, 'fixture-bulk', 'api'
          FROM ins`.execute(tx);
    });
    const before = await api.db
      .selectFrom("report_snapshot")
      .select("id")
      .where("transformation_id", "=", big.transformationId)
      .execute();
    const res = await call<Body>(api.app, "POST", `${big.base}/reports/registers/generate`, {
      session: big.s.tl,
      body: { parameters: { register: "actions" } },
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "report.too_large",
      "The selection is too large for one report (more than 5,000 rows in a table); narrow the filters.",
    ]);
    const after = await api.db
      .selectFrom("report_snapshot")
      .select("id")
      .where("transformation_id", "=", big.transformationId)
      .execute();
    expect(after).toEqual(before);
    expect(
      await api.db
        .selectFrom("audit_event")
        .select("id")
        .where("transformation_id", "=", big.transformationId)
        .where("record_type", "=", "report_snapshot")
        .execute(),
    ).toEqual([]);
    const live = await call<Body>(
      api.app,
      "GET",
      `${big.base}/reports/registers/live?parameters=${encodeURIComponent('{"register":"actions"}')}`,
      { session: big.s.tl },
    );
    expect([live.status, live.body.code]).toEqual([422, "report.too_large"]);
    // A narrower filter fits: none of the bulk rows is done.
    const narrow = await call<Body>(api.app, "POST", `${big.base}/reports/registers/generate`, {
      session: big.s.tl,
      body: { parameters: { register: "actions", filters: { status: "done" } } },
    });
    expect(narrow.status).toBe(201);
  }, 120_000);
});
