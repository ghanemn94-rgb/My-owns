// Initiative links (ADR-0021 §2; T-DG3-BE-B) against a real PostgreSQL:
//  - REQ-PB-040 / REQ-PB-046: 1..n gap links to `tom_gap` or `diagnostic_finding`; any other TOM record type is 422
//    initiative.not_tom_evidence with the exact ADR text, and nothing is written; G3 completeness is IDENTICAL with and
//    without initiatives and gap links (the TOM/portfolio separation, B0059);
//  - REQ-PB-032: an outcome contribution requires an outcome (400 at /outcomeId); its KPI must belong to that outcome
//    (422; the database trigger initiative_contribution_kpi_matches_outcome backs it and maps to a 422 problem);
//  - decision links point to canonical `decision` rows of the same transformation;
//  - every create/remove: audit event, If-Match 428/409 on remove, duplicates 409, AUD 403 (audited denial).
// All data is SYNTHETIC; nothing here approves anything (never DG0-DG7).
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../../../src/modules/platform/db-errors.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { createInitiative, makeDirection } from "../contract/p3-exercises-be-b.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let gapId: string;
let findingId: string;
let dir: { outcomeId: string; otherOutcomeId: string; outcomeKpiId: string };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
const NOT_TOM =
  "A project portfolio is not a Target Operating Model: an initiative cannot be attached as G3 TOM evidence.";

async function made(url: string, body: unknown, session = p.lead.session) {
  const res = await send("POST", url, { session, body });
  expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body as { id: string; version: number } & Record<string, unknown>;
}
const denied = async (res: { headers: Record<string, unknown> }) =>
  (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  gapId = (await made(`${T}/tom-gaps`, { dimensionCode: "technology" })).id;
  findingId = (
    await made(`${T}/diagnostic-findings`, {
      workstreamCode: "customer",
      kind: "symptom",
      statement: "Synthetic finding",
    })
  ).id;
  dir = await makeDirection(send, p);
}, 60_000);
afterAll(() => api.close());

describe("gap links (REQ-PB-040, REQ-PB-046)", () => {
  it("accepts 1..n links to a TOM gap and a diagnosed finding, each audited; no_gap_link clears and returns", async () => {
    const ini = await createInitiative(send, p);
    const G = `/api/v1/initiatives/${ini.id}/gap-links`;
    const a = await made(G, { targetType: "tom_gap", targetId: gapId, note: "Synthetic: closes the API gap." });
    const b = await made(G, { targetType: "diagnostic_finding", targetId: findingId });
    expect([a["tomGapId"], a["diagnosticFindingId"], b["diagnosticFindingId"], a.version]).toEqual([
      gapId,
      null,
      findingId,
      1,
    ]);
    expect((await auditOf(api.db, a.id)).map((e) => [e.action, e.new_version])).toEqual([
      ["initiative_gap_link.create", 1],
    ]);
    const list = await send("GET", G, { session: p.auditor.session });
    expect(list.body.items.map((l: { id: string }) => l.id)).toEqual([a.id, b.id]);
    const card = async () =>
      (await send("GET", `/api/v1/initiatives/${ini.id}`, { session: p.lead.session })).body.warnings.map(
        (x: { code: string }) => x.code,
      );
    expect(await card()).not.toContain("initiative.no_gap_link");
    // Remove: 428 without If-Match, 409 stale, 200 removed (never deleted), then a second remove is 422.
    const R = (id: string) => `${G}/${id}/remove`;
    const reason = { reason: "Synthetic: re-scoped." };
    expect((await send("POST", R(a.id), { session: p.lead.session, body: reason })).status).toBe(428);
    expect((await send("POST", R(a.id), { session: p.lead.session, headers: ifm(5), body: reason })).status).toBe(409);
    const removed = await send("POST", R(a.id), { session: p.lead.session, headers: ifm(1), body: reason });
    expect([removed.status, removed.body.status, removed.body.removeReason, removed.body.version]).toEqual([
      200,
      "removed",
      reason.reason,
      2,
    ]);
    const again = await send("POST", R(a.id), { session: p.lead.session, headers: ifm(2), body: reason });
    expect([again.status, again.body.type]).toEqual([422, "urn:mth:problem:invalid-transition"]);
    await send("POST", R(b.id), { session: p.lead.session, headers: ifm(1), body: reason });
    expect(await card()).toContain("initiative.no_gap_link");
    expect((await send("GET", G, { session: p.lead.session })).body.items).toEqual([]);
    expect((await send("GET", `${G}?includeArchived=true`, { session: p.lead.session })).body.items).toHaveLength(2);
    expect((await auditOf(api.db, a.id)).map((e) => e.action)).toEqual([
      "initiative_gap_link.create",
      "initiative_gap_link.remove",
    ]);
  });

  it.each(["tom_canvas_cell", "capability", "journey", "tom_dimension"])(
    "targetType %s (TOM record) -> 422 initiative.not_tom_evidence with the exact text; nothing written",
    async (targetType) => {
      const ini = await createInitiative(send, p);
      const res = await send("POST", `/api/v1/initiatives/${ini.id}/gap-links`, {
        session: p.lead.session,
        body: { targetType, targetId: gapId },
      });
      expect([res.status, res.body.type, res.body.code, res.body.detail, res.body.errors[0].pointer]).toEqual([
        422,
        "urn:mth:problem:validation",
        "initiative.not_tom_evidence",
        NOT_TOM,
        "/targetType",
      ]);
      expect(await denied(res)).toEqual([]);
      const rows = await api.db
        .selectFrom("initiative_gap_link")
        .select("id")
        .where("initiative_id", "=", ini.id)
        .execute();
      expect(rows).toEqual([]);
    },
  );

  it("other target types are 422, a malformed one 400; a foreign or archived target 422; a duplicate active link 409", async () => {
    const ini = await createInitiative(send, p);
    const G = `/api/v1/initiatives/${ini.id}/gap-links`;
    const post = (body: unknown) => send("POST", G, { session: p.lead.session, body });
    expect((await post({ targetType: "initiative", targetId: gapId })).body.code).toBe("initiative.gap_target_type");
    expect((await post({ targetType: "Bad-Type", targetId: gapId })).status).toBe(400);
    expect((await post({ targetType: "tom_gap" })).status).toBe(400);
    const foreign = await post({ targetType: "tom_gap", targetId: uuidv7() });
    expect([foreign.status, foreign.body.errors[0].pointer]).toEqual([422, "/targetId"]);
    // A finding id offered as a gap: not a tom_gap of this transformation.
    expect((await post({ targetType: "tom_gap", targetId: findingId })).status).toBe(422);
    const archivedGap = await made(`${T}/tom-gaps`, { dimensionCode: "data_analytics" });
    expect(
      (
        await send("POST", `${T}/tom-gaps/${archivedGap.id}/archive`, {
          session: p.lead.session,
          headers: ifm(archivedGap.version),
          body: { reason: "Synthetic archive" },
        })
      ).status,
    ).toBe(200);
    const archived = await post({ targetType: "tom_gap", targetId: archivedGap.id });
    expect([archived.status, archived.body.code]).toEqual([422, "initiative.link_target_archived"]);
    await made(G, { targetType: "tom_gap", targetId: gapId });
    const dup = await post({ targetType: "tom_gap", targetId: gapId });
    expect([dup.status, dup.body.code]).toEqual([409, "initiative.gap_link_duplicate"]);
  });

  it("G3 completeness is identical with and without initiatives and gap links (TOM is not the portfolio)", async () => {
    const q = await setupP2World(api, w);
    const QT = `/api/v1/transformations/${q.transformationId}`;
    const gap = (
      await send("POST", `${QT}/tom-gaps`, { session: q.lead.session, body: { dimensionCode: "journeys_processes" } })
    ).body.id as string;
    const g3 = async () => {
      const res = await send("GET", `${QT}/gates/G3`, { session: q.lead.session });
      expect(res.status).toBe(200);
      return { criteria: res.body.criteria, canSubmit: res.body.canSubmit };
    };
    const before = await g3();
    for (const name of ["Synthetic one", "Synthetic two"]) {
      const ini = await createInitiative(send, q, { name });
      const link = await send("POST", `/api/v1/initiatives/${ini.id}/gap-links`, {
        session: q.lead.session,
        body: { targetType: "tom_gap", targetId: gap },
      });
      expect(link.status).toBe(201);
    }
    expect(await g3()).toEqual(before);
  });
});

describe("outcome contributions (REQ-PB-032)", () => {
  it("needs an outcome (400 at /outcomeId) and a statement; the KPI must belong to the outcome (422)", async () => {
    const ini = await createInitiative(send, p);
    const C = `/api/v1/initiatives/${ini.id}/outcome-contributions`;
    const post = (body: unknown) => send("POST", C, { session: p.lead.session, body });
    const missing = await post({ outcomeKpiId: dir.outcomeKpiId, contributionStatement: "Synthetic" });
    expect([missing.status, missing.body.errors.map((e: { pointer: string }) => e.pointer)]).toEqual([
      400,
      ["/outcomeId"],
    ]);
    expect((await post({ outcomeId: dir.outcomeId })).status).toBe(400);
    const mismatch = await post({
      outcomeId: dir.otherOutcomeId,
      outcomeKpiId: dir.outcomeKpiId,
      contributionStatement: "Synthetic",
    });
    expect([mismatch.status, mismatch.body.code, mismatch.body.errors[0].pointer]).toEqual([
      422,
      "initiative.kpi_not_in_outcome",
      "/outcomeKpiId",
    ]);
    const foreign = await post({ outcomeId: uuidv7(), contributionStatement: "Synthetic" });
    expect([foreign.status, foreign.body.errors[0].pointer]).toEqual([422, "/outcomeId"]);
    const ok = await made(C, {
      outcomeId: dir.outcomeId,
      outcomeKpiId: dir.outcomeKpiId,
      contributionStatement: "Synthetic: lifts ARPU.",
      expectedKpiMovement: "+5% (synthetic)",
    });
    const noKpi = await made(C, { outcomeId: dir.otherOutcomeId, contributionStatement: "Synthetic: no KPI yet." });
    expect([ok["outcomeKpiId"], noKpi["outcomeKpiId"]]).toEqual([dir.outcomeKpiId, null]);
    expect((await auditOf(api.db, ok.id)).map((e) => e.action)).toEqual(["initiative_outcome_contribution.create"]);
    const removed = await send("POST", `${C}/${noKpi.id}/remove`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic: duplicate." },
    });
    expect([removed.status, removed.body.status]).toEqual([200, "removed"]);
    expect((await send("GET", C, { session: p.auditor.session })).body.items.map((c: { id: string }) => c.id)).toEqual([
      ok.id,
    ]);
    // The outcome hierarchy (BE-A view) shows the contribution as level 5 under its outcome.
    const tree = JSON.stringify((await send("GET", `${T}/outcome-hierarchy`, { session: p.lead.session })).body);
    expect(tree).toContain(ok.id);
  });

  it("the database trigger refuses a KPI of another outcome (defence in depth) and maps to a 422 problem", async () => {
    const ini = await createInitiative(send, p);
    const row = await api.db.selectFrom("initiative").selectAll().where("id", "=", ini.id).executeTakeFirstOrThrow();
    let caught: unknown;
    try {
      await api.db.transaction().execute(async (tx) => {
        await tx
          .insertInto("initiative_outcome_contribution")
          .values({
            id: uuidv7(),
            organization_id: row.organization_id,
            transformation_id: row.transformation_id,
            initiative_id: ini.id,
            outcome_id: dir.otherOutcomeId,
            outcome_kpi_id: dir.outcomeKpiId,
            contribution_statement: "Synthetic mismatch",
            created_by: p.lead.id,
            updated_by: p.lead.id,
          })
          .execute();
      });
    } catch (err) {
      caught = err;
    }
    const e = caught as { code?: string; constraint?: string };
    expect([e.code, e.constraint]).toEqual(["23514", "initiative_contribution_kpi_matches_outcome"]);
    const problem = mapDatabaseGuardError(e);
    expect([problem?.status, problem?.type]).toEqual([422, "urn:mth:problem:validation"]);
  });
});

describe("decision links (T05 'Required decisions', one decision model)", () => {
  it("links a canonical decision of the transformation; foreign 422, duplicate 409; removable", async () => {
    const ini = await createInitiative(send, p);
    const D = `/api/v1/initiatives/${ini.id}/decision-links`;
    const decision = await made("/api/v1/decisions", {
      transformationId: p.transformationId,
      title: "Synthetic: which partner network?",
      options: [{ title: "A" }],
    });
    const other = await setupP2World(api, w);
    const foreignDecision = await made(
      "/api/v1/decisions",
      { transformationId: other.transformationId, title: "Synthetic foreign", options: [{ title: "A" }] },
      other.lead.session,
    );
    const foreign = await send("POST", D, { session: p.lead.session, body: { decisionId: foreignDecision.id } });
    expect([foreign.status, foreign.body.errors[0].pointer]).toEqual([422, "/decisionId"]);
    const link = await made(D, { decisionId: decision.id });
    expect(link["decisionId"]).toBe(decision.id);
    const dup = await send("POST", D, { session: p.lead.session, body: { decisionId: decision.id } });
    expect([dup.status, dup.body.code]).toEqual([409, "initiative.decision_link_duplicate"]);
    const removed = await send("POST", `${D}/${link.id}/remove`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic: no longer required." },
    });
    expect([removed.status, removed.body.status]).toEqual([200, "removed"]);
    expect((await auditOf(api.db, link.id)).map((e) => e.action)).toEqual([
      "initiative_decision_link.create",
      "initiative_decision_link.remove",
    ]);
  });
});

describe("authorization on every link mutation", () => {
  it("AUD gets 403 on the three creates and the three removes (audited denial, nothing written); a 404 for no access", async () => {
    const ini = await createInitiative(send, p);
    const B = `/api/v1/initiatives/${ini.id}`;
    const gap = await made(`${B}/gap-links`, { targetType: "tom_gap", targetId: gapId });
    const con = await made(`${B}/outcome-contributions`, {
      outcomeId: dir.outcomeId,
      contributionStatement: "Synthetic",
    });
    const decision = await made("/api/v1/decisions", {
      transformationId: p.transformationId,
      title: "Synthetic AUD decision",
      options: [{ title: "A" }],
    });
    const dl = await made(`${B}/decision-links`, { decisionId: decision.id });
    const cases: [string, unknown][] = [
      [`${B}/gap-links`, { targetType: "tom_gap", targetId: gapId }],
      [`${B}/outcome-contributions`, { outcomeId: dir.outcomeId, contributionStatement: "x" }],
      [`${B}/decision-links`, { decisionId: decision.id }],
      [`${B}/gap-links/${gap.id}/remove`, { reason: "Synthetic" }],
      [`${B}/outcome-contributions/${con.id}/remove`, { reason: "Synthetic" }],
      [`${B}/decision-links/${dl.id}/remove`, { reason: "Synthetic" }],
      [`${B}/gap-links`, {}],
    ];
    for (const [url, body] of cases) {
      const res = await send("POST", url, { session: p.auditor.session, headers: ifm(1), body });
      expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(await denied(res)).toEqual(["authorization.denied"]);
    }
    for (const id of [gap.id, con.id, dl.id])
      expect((await auditOf(api.db, id)).map((e) => e.new_version)).toEqual([1]);
    // The Sponsor holds no initiative.edit: 403 too.
    expect(
      (
        await send("POST", `${B}/gap-links`, {
          session: p.sponsor.session,
          body: { targetType: "tom_gap", targetId: gapId },
        })
      ).status,
    ).toBe(403);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await send("GET", `${B}/gap-links`, { session: nobody })).status).toBe(404);
  });

  it("links of a cancelled initiative are read-only (422 initiative.read_only)", async () => {
    const ini = await createInitiative(send, p);
    await send("POST", `/api/v1/initiatives/${ini.id}/cancel`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic cancel" },
    });
    const res = await send("POST", `/api/v1/initiatives/${ini.id}/gap-links`, {
      session: p.lead.session,
      body: { targetType: "tom_gap", targetId: gapId },
    });
    expect([res.status, res.body.code]).toEqual([422, "initiative.read_only"]);
  });
});
