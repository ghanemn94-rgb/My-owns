// The transformation workspace header against a real PostgreSQL (T-DG4-KBE-G2; ADR-0037 §1 item 3, §9, §11;
// REQ-S03-011 "the header shows the eight elements with Unknown where data is missing"; p4-work-split §J+K JK.5):
//  - an empty transformation: all eight elements are present; gate readiness is known (through the port), the North
//    Star, owners, outcome health and benefits are Unknown (no North Star, no sponsor, no lead, no outcome KPI, no
//    benefit), and the key decisions and next actions are empty facts with count 0 (never Unknown, never green);
//  - a populated transformation: North Star, sponsor and lead, planned and validated value per currency, an overdue
//    T16 ask, and the caller's own next actions (another user's never);
//  - `gateReadiness` comes through WorkflowsReadPort: it equals the live gate view's missing mandatory count, and a
//    port that answers null makes it Unknown (fails closed, never "ready");
//  - D-107: every request here goes to the REAL server built through the harness (buildServer, the composition root);
//    nothing is wired by hand, so the production wiring line in server.ts is what serves the port;
//  - 404 outside the scope (an outsider, an ADM-only caller); AUD reads; a read stores nothing.
// All data is synthetic; a Finance validation here is a synthetic in-product business approval of test data.
import { insertAuditEvent, type Tx } from "@mth/db";
import { Decimal } from "decimal.js";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setWorkflowsReadPort, workflowsReadPort } from "../../../src/modules/reporting/ports.ts";
import { createWorkItemOnce } from "../../../src/modules/tasks/index.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import type { BenefitWorld } from "../benefits/fixtures.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import {
  askDue,
  benefitWorldIn,
  dashboardWorld,
  riyadhToday,
  validatedBenefit,
  type Body,
} from "../contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
let empty: KpiWorld;
let full: KpiWorld;
let fb: BenefitWorld;
let yesterday: string;

const get = (url: string, session: Session) => call<Body>(api.app, "GET", url, { session });
const WORKER = { actorType: "service", actorUserId: null, requestId: "job:test-header", source: "worker" } as const;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  yesterday = (await riyadhToday(api)).yesterday;
  empty = await dashboardWorld(api, w, w.a1);
  full = await dashboardWorld(api, w, w.a1);
  // A benefit world whose benefit is moved onto `full` would cross transformations; instead the header of the benefit
  // world's own transformation is checked for the benefits element.
  fb = await benefitWorldIn(api, w, w.a1);
  await validatedBenefit(api, fb, [{ amount: "1000", start: "2026-02-01", end: "2026-02-28" }], {
    amount: "400",
    start: "2026-02-01",
    end: "2026-02-28",
  });
  // full: a North Star (through the API), a sponsor and a lead, an overdue T16 ask, a task of TL's.
  const ns = await call(api.app, "PUT", `${full.base}/north-star`, {
    session: full.s.tl,
    body: { statement: "Synthetic: be the region's most trusted digital operator." },
  });
  expect(ns.status, JSON.stringify(ns.body)).toBe(200);
  await api.db.transaction().execute(async (tx) => {
    await tx
      .updateTable("transformation")
      .set({ sponsor_user_id: full.users.sp.id, lead_user_id: full.users.tl.id })
      .where("id", "=", full.transformationId)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: full.users.tl.id, requestId: `fixture-${uuidv7()}`, source: "api" },
      {
        action: "transformation.update",
        recordType: "transformation",
        recordId: full.transformationId,
        organizationId: w.orgA.id,
        transformationId: full.transformationId,
        newVersion: 1,
      },
    );
  });
  await askDue(api, full, yesterday);
  await api.db.transaction().execute((tx: Tx) =>
    createWorkItemOnce(tx, WORKER, {
      organizationId: w.orgA.id,
      transformationId: full.transformationId,
      kind: "gate_condition_due",
      assigneeUserId: full.users.tl.id,
      subjectType: "gate_condition",
      subjectId: uuidv7(),
      linkPath: `/transformations/${full.transformationId}/gates`,
      messageKey: "tasks.synthetic",
      messageParams: {},
      dueDate: "2026-12-01",
      dedupeKey: `test.header:${uuidv7()}`,
    }),
  );
}, 300_000);
afterAll(() => api.close());

const EIGHT = [
  "phase",
  "gateReadiness",
  "northStar",
  "owners",
  "outcomeHealth",
  "benefits",
  "keyDecisions",
  "nextActions",
];

describe("REQ-S03-011: the workspace header's eight elements", () => {
  it("an empty transformation: every element present, Unknown where the data is missing", async () => {
    const r = await get(`${empty.base}/summary`, empty.s.auditor);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    for (const e of EIGHT) expect(r.body, e).toHaveProperty(e);
    expect(r.body.phase).toEqual({ currentPhase: "diagnose", mode: "end_to_end", entryPhase: null });
    expect(r.body.gateReadiness.state).toBe("known");
    expect(r.body.gateReadiness.gateCode).toBe("G1");
    expect(r.body.northStar).toEqual({ state: "unknown", statement: null, status: null });
    expect(r.body.owners).toEqual({ sponsor: null, lead: null });
    // One active outcome without a KPI: Outcomes is unknown (never green).
    expect(r.body.outcomeHealth.rag.status).toBe("unknown");
    expect(r.body.outcomeHealth.counts).toEqual([{ status: "unknown", count: 1 }]);
    expect(r.body.benefits).toEqual({
      state: "unknown",
      planned: [],
      validated: [],
      benefitCount: 0,
      nonFinancialCount: 0,
    });
    expect(r.body.keyDecisions).toEqual({ items: [], overdueCount: 0 });
    expect(r.body.nextActions.items).toEqual([]);
  });

  it("a populated transformation: North Star, owners, the overdue ask and the caller's own next actions", async () => {
    const r = await get(`${full.base}/summary`, full.s.tl);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.northStar).toEqual({
      state: "known",
      statement: "Synthetic: be the region's most trusted digital operator.",
      status: "current",
    });
    expect(r.body.owners.sponsor.userId).toBe(full.users.sp.id);
    expect(r.body.owners.lead.userId).toBe(full.users.tl.id);
    expect(typeof r.body.owners.sponsor.displayName).toBe("string");
    expect(r.body.keyDecisions.overdueCount).toBe(1);
    expect(r.body.keyDecisions.items).toHaveLength(1);
    expect(r.body.keyDecisions.items[0]).toMatchObject({ recordType: "executive_decision", dueDate: yesterday });
    expect(r.body.nextActions.items).toMatchObject([
      { source: "work_item", kind: "gate_condition_due", section: "assigned_actions", dueDate: "2026-12-01" },
    ]);
    // Another user's next actions never appear: BO sees its own (the ask it owns), never TL's task.
    const other = await get(`${full.base}/summary`, full.s.bo);
    expect(other.body.nextActions.items.some((x: Body) => x.kind === "gate_condition_due")).toBe(false);
    expect(other.body.nextActions.items.every((x: Body) => x.kind === "executive_decision_due")).toBe(true);
  });

  it("benefits: planned and validated per currency to the business date, the benefit count", async () => {
    const r = await get(`${fb.base}/summary`, fb.s.fin);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.benefits.state).toBe("known");
    expect(r.body.benefits.benefitCount).toBe(1);
    expect(r.body.benefits.planned.map((p: Body) => [p.currency, new Decimal(p.value.value).toFixed()])).toEqual([
      ["SAR", "1000"],
    ]);
    expect(r.body.benefits.validated.map((p: Body) => [p.currency, new Decimal(p.value.value).toFixed()])).toEqual([
      ["SAR", "400"],
    ]);
  });
});

describe("gateReadiness comes through WorkflowsReadPort (production wiring, D-107)", () => {
  it("equals the live gate view's missing mandatory criteria", async () => {
    const h = await get(`${empty.base}/summary`, empty.s.tl);
    const g = await get(`${empty.base}/gates/G1`, empty.s.tl);
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    const missing = (g.body.criteria as Body[]).filter((c) => c.mandatory && c.completeness !== "complete").length;
    expect(h.body.gateReadiness).toMatchObject({
      state: "known",
      gateCode: "G1",
      status: g.body.gate.status,
      inheritedApproval: null,
      missingMandatoryCount: missing,
      ready: missing === 0,
    });
    expect(h.body.nextActions.missingMandatoryCount).toBe(missing);
  });

  it("a port that answers null makes it Unknown (never ready)", async () => {
    const wired = workflowsReadPort();
    try {
      setWorkflowsReadPort({ gateReadiness: async () => null });
      const h = await get(`${empty.base}/summary`, empty.s.tl);
      expect(h.body.gateReadiness).toEqual({
        state: "unknown",
        gateCode: null,
        status: null,
        inheritedApproval: null,
        missingMandatoryCount: null,
        ready: null,
      });
      expect(h.body.nextActions.missingMandatoryCount).toBeNull();
    } finally {
      setWorkflowsReadPort(wired);
    }
    expect((await get(`${empty.base}/summary`, empty.s.tl)).body.gateReadiness.state).toBe("known");
  });
});

describe("scope and storage", () => {
  it("404 outside the scope; AUD reads; ADM-only is 404; an unknown query parameter is 400", async () => {
    expect((await get(`${full.base}/summary`, full.s.outsider)).status).toBe(404);
    expect((await get(`${full.base}/summary`, empty.s.auditor)).status).toBe(200);
    const admin = await signIn(api.app, w.admin.subject);
    expect((await get(`${full.base}/summary`, admin)).status).toBe(404);
    expect((await get(`/api/v1/transformations/${uuidv7()}/summary`, full.s.tl)).status).toBe(404);
    expect((await get(`${full.base}/summary?x=1`, full.s.tl)).status).toBe(400);
  });

  it("a read stores nothing", async () => {
    const n = async () =>
      Number(
        (
          await api.db
            .selectFrom("audit_event")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .executeTakeFirstOrThrow()
        ).n,
      );
    const before = await n();
    await get(`${full.base}/summary`, full.s.tl);
    expect(await n()).toBe(before);
  });
});
