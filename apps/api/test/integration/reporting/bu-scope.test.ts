// The business-unit scope sweep of REQ-S03-001 against the run's disposable PostgreSQL (T-DG4-BE-M3; ADR-0038 §9
// "Scope"; A02/A12 "two transformations in different business units are listed separately; a user scoped to one
// business unit cannot list the other's transformations"). Two SYNTHETIC transformations, X in business unit a1 and Y
// in a2, sit in one portfolio, each with a workstream and an initiative. A Transformation Office user scoped to a1 and
// an auditor scoped to a2 each see only their own business unit's transformation in:
//  - listTransformations (the DG1 behaviour, re-run), listPortfolioTransformations, listWorkstreams, getWorkstream and
//    listWorkstreamInitiatives;
//  - the slice J/K reads merged at this task: the traceability view, trace links, the orphan report, the missing links,
//    the inherited records, downstream impact, the transformation and workstream dashboards, the Executive Overview and
//    every dashboard drill-down metric.
// The other business unit's transformation is 404 on every explicit read (never 403, never an empty 200 that discloses
// it) and none of its ids or codes appears in a response. A portfolio or workstream grants no access.
import { insertAuditEvent } from "@mth/db";
import { DASHBOARD_METRICS } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

interface Side {
  readonly transformationId: string;
  readonly code: string;
  readonly base: string;
  readonly workstreamId: string;
  readonly initiativeId: string;
  readonly membershipId: string;
}

let api: TestApi;
let w: World;
let office: Session;
let toA1: Session;
let audA2: Session;
let portfolioUrl: string;
let x: Side;
let y: Side;

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
// Test responses are asserted structurally; the body type is deliberately loose (as in `call`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (url: string, session: Session) => call<any>(api.app, "GET", url, { session });

/** One initiative written directly with its audit event (the P2 audit guard demands one). */
async function insertInitiativeRow(transformationId: string, code: string): Promise<string> {
  const id = uuidv7();
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("initiative")
      .values({
        id,
        organization_id: w.orgA.id,
        transformation_id: transformationId,
        code,
        name: `Synthetic scope initiative ${code}`,
        created_by: w.office.id,
        updated_by: w.office.id,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: w.office.id, requestId: `fixture-${id}`, source: "api" },
      {
        action: "initiative.create",
        recordType: "initiative",
        recordId: id,
        organizationId: w.orgA.id,
        transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

async function side(businessUnitId: string, initiativeCode: string): Promise<Side> {
  const transformationId = await createTransformationRow(api.db, w.orgA.id, businessUnitId, w.office.id);
  const t = await api.db
    .selectFrom("transformation")
    .select("code")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const base = `/api/v1/transformations/${transformationId}`;
  const ws = await send("POST", `${base}/workstreams`, { session: office, body: { name: "Synthetic scope stream" } });
  expect(ws.status, JSON.stringify(ws.body)).toBe(201);
  const initiativeId = await insertInitiativeRow(transformationId, initiativeCode);
  const assigned = await send("POST", `${base}/workstreams/${ws.body.id}/initiatives`, {
    session: office,
    body: { initiativeId },
  });
  expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
  const placed = await send("POST", `${portfolioUrl}/transformations`, { session: office, body: { transformationId } });
  expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  return {
    transformationId,
    code: t.code,
    base,
    workstreamId: ws.body.id,
    initiativeId,
    membershipId: placed.body.id,
  };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  const p = await send("POST", `/api/v1/organizations/${w.orgA.id}/portfolios`, {
    session: office,
    body: { code: uniq("PF"), name: "Synthetic cross-unit portfolio" },
  });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  portfolioUrl = `/api/v1/portfolios/${p.body.id}`;
  x = await side(w.a1, "INI-41");
  y = await side(w.a2, "INI-42");
  // TO inherits downward at its business unit; AUD too (0005 role seed). Neither holds an organization-level grant.
  const to = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, to.id, "TO", { type: "business_unit", id: w.a1 }, w.orgA.id);
  toA1 = await signIn(api.app, to.subject);
  const aud = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, aud.id, "AUD", { type: "business_unit", id: w.a2 }, w.orgA.id);
  audA2 = await signIn(api.app, aud.subject);
}, 120_000);
afterAll(async () => {
  await api.close();
}, 60_000);

/** Ids and codes of `other` that must never appear in a response scoped to the other business unit. */
const marks = (s: Side) => [s.transformationId, s.code, s.workstreamId, s.initiativeId, s.membershipId];
const leaks = (body: unknown, s: Side) => marks(s).filter((m) => JSON.stringify(body).includes(m));

describe("REQ-S03-001: two transformations in different business units are listed separately", () => {
  it("listTransformations: the organization TO sees both, each in its own business unit; each scoped user its own", async () => {
    const all = await get(`/api/v1/transformations?organizationId=${w.orgA.id}`, office);
    expect(all.status).toBe(200);
    const byId = new Map(all.body.items.map((t: { id: string; businessUnitId: string }) => [t.id, t.businessUnitId]));
    expect([byId.get(x.transformationId), byId.get(y.transformationId)]).toEqual([w.a1, w.a2]);
    for (const [session, own, other] of [
      [toA1, x, y],
      [audA2, y, x],
    ] as const) {
      const mine = await get(`/api/v1/transformations?organizationId=${w.orgA.id}`, session);
      expect(mine.status).toBe(200);
      const ids = mine.body.items.map((t: { id: string }) => t.id);
      expect(ids).toContain(own.transformationId);
      expect(ids).not.toContain(other.transformationId);
      expect(leaks(mine.body, other)).toEqual([]);
      const filtered = await get(
        `/api/v1/transformations?organizationId=${w.orgA.id}&businessUnitId=${other === y ? w.a2 : w.a1}`,
        session,
      );
      expect(JSON.stringify(filtered.body)).not.toContain(other.transformationId);
      expect((await get(other.base, session)).status).toBe(404);
    }
  });

  it("listPortfolioTransformations shows each scoped user only its own business unit's transformation", async () => {
    const all = await get(`${portfolioUrl}/transformations`, office);
    expect(all.body.items.map((i: { transformationId: string }) => i.transformationId).sort()).toEqual(
      [x.transformationId, y.transformationId].sort(),
    );
    for (const [session, own, other] of [
      [toA1, x, y],
      [audA2, y, x],
    ] as const) {
      for (const q of ["", "?includeRemoved=true"]) {
        const r = await get(`${portfolioUrl}/transformations${q}`, session);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(r.body.items.map((i: { transformationId: string }) => i.transformationId)).toEqual([
          own.transformationId,
        ]);
        expect(leaks(r.body, other)).toEqual([]);
      }
      // The portfolio itself is an organization-level record every role reads (ADR-0038 §10).
      expect((await get(portfolioUrl, session)).status).toBe(200);
    }
  });

  it("workstreams: the other business unit's list, record and initiatives are 404; the own ones 200", async () => {
    for (const [session, own, other] of [
      [toA1, x, y],
      [audA2, y, x],
    ] as const) {
      const W = (s: Side) => `${s.base}/workstreams`;
      const mine = await get(W(own), session);
      expect([mine.status, mine.body.items.map((i: { id: string }) => i.id)]).toEqual([200, [own.workstreamId]]);
      expect((await get(`${W(own)}/${own.workstreamId}`, session)).status).toBe(200);
      expect((await get(`${W(own)}/${own.workstreamId}/initiatives`, session)).body.items.length).toBe(1);
      expect((await get(W(other), session)).status).toBe(404);
      expect((await get(`${W(other)}/${other.workstreamId}`, session)).status).toBe(404);
      expect((await get(`${W(other)}/${other.workstreamId}/initiatives`, session)).status).toBe(404);
      // The other unit's workstream addressed under the own transformation: 404 as well.
      expect((await get(`${W(own)}/${other.workstreamId}`, session)).status).toBe(404);
    }
  });

  it("the slice J/K reads: the other business unit's transformation is 404 everywhere and never appears", async () => {
    const reads = (s: Side) => [
      `${s.base}/traceability`,
      `${s.base}/trace-links`,
      `${s.base}/orphans`,
      `${s.base}/missing-links`,
      `${s.base}/inherited-records`,
      `${s.base}/dashboard`,
      `${s.base}/workstreams/${s.workstreamId}/dashboard`,
      `/api/v1/records/initiative/${s.initiativeId}/impact`,
    ];
    for (const [session, own, other] of [
      [toA1, x, y],
      [audA2, y, x],
    ] as const) {
      for (const url of reads(own)) {
        const r = await get(url, session);
        expect(r.status, `${url}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
        expect(leaks(r.body, other), url).toEqual([]);
      }
      for (const url of reads(other)) expect((await get(url, session)).status, url).toBe(404);
      const ov = await get(`/api/v1/overview?organizationId=${w.orgA.id}`, session);
      expect(ov.status, JSON.stringify(ov.body).slice(0, 300)).toBe(200);
      expect(ov.body.transformations.map((t: { transformationId: string }) => t.transformationId)).toEqual([
        own.transformationId,
      ]);
      expect(leaks(ov.body, other)).toEqual([]);
      expect(
        (await get(`/api/v1/overview?organizationId=${w.orgA.id}&transformationId=${other.transformationId}`, session))
          .status,
      ).toBe(404);
      for (const metric of DASHBOARD_METRICS) {
        if (metric === "outcomes.kpi_status") continue; // per record (subjectId); KBE-G's scope test covers it
        const d = await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${w.orgA.id}`, session);
        expect(d.status, `${metric}: ${JSON.stringify(d.body).slice(0, 300)}`).toBe(200);
        expect(leaks(d.body, other), metric).toEqual([]);
      }
    }
  });
});
