// Trace links and the traceability view (T-DG4-BE-M; ADR-0038 §1, §2, §4, §10, §12; REQ-S03-006, REQ-PB-044). Proves,
// against the run's disposable PostgreSQL:
//  - "one initiative links to two gaps and two KPIs" (DG3 gap links and contributions, read through the graph);
//  - every node type's `href` returns 200 for a readable record ("every node opens its record");
//  - the exact ADR-0038 §12 refusals: pair_not_allowed, record_not_found, record_inactive, duplicate,
//    share_not_allowed, not_active;
//  - AUD 403 on every write, If-Match 428/409, one audit event per mutation, commit-time re-authorisation, and a
//    removed link is never deleted (it stays, `removed`, and leaves the graph);
//  - 404 outside the caller's scope.
// All data is SYNTHETIC; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser } from "../benefits/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { insertAudited, seedTraceWorld, type TraceWorld } from "../contract/p4-exercises-be-m.ts";

let api: TestApi;
let w: World;
let t: TraceWorld;
let L: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  t = await seedTraceWorld(api, w);
  L = `${t.base}/trace-links`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const post = (url: string, body: unknown, session = t.s.bo, headers?: Record<string, string>) =>
  call(api.app, "POST", url, { session, body, ...(headers ? { headers } : {}) });
const link = (body: Record<string, unknown>, session = t.s.bo) =>
  post(L, { contributionStatement: "Synthetic contribution", ...body }, session);

describe("REQ-S03-006: many-to-many links along the chain", () => {
  it("one initiative links to two gaps and two KPIs, and the graph shows all four edges", async () => {
    const I = `/api/v1/initiatives/${t.initiativeId}`;
    for (const gap of [t.gap1Id, t.gap2Id])
      expect((await post(`${I}/gap-links`, { targetType: "tom_gap", targetId: gap }, t.s.tl)).status).toBe(201);
    for (const kpi of [t.kpi1Id, t.kpi2Id])
      expect(
        (
          await post(
            `${I}/outcome-contributions`,
            { outcomeId: t.outcomeId, outcomeKpiId: kpi, contributionStatement: "Moves the KPI" },
            t.s.tl,
          )
        ).status,
      ).toBe(201);
    const g = await call(
      api.app,
      "GET",
      `${t.base}/traceability?rootType=initiative&rootId=${t.initiativeId}&depth=1`,
      {
        session: t.s.auditor,
      },
    );
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    const edges = g.body.edges as { edgeKind: string; fromId: string; toId: string }[];
    expect(
      edges
        .filter((e) => e.edgeKind === "gap_initiative" && e.toId === t.initiativeId)
        .map((e) => e.fromId)
        .sort(),
    ).toEqual([t.gap1Id, t.gap2Id].sort());
    expect(
      edges
        .filter((e) => e.edgeKind === "initiative_kpi" && e.fromId === t.initiativeId)
        .map((e) => e.toId)
        .sort(),
    ).toEqual([t.kpi1Id, t.kpi2Id].sort());
  });

  it("a capability, KPI or benefit takes any number of trace links", async () => {
    const a = await link({ linkKind: "capability_kpi", fromId: t.capability1Id, toId: t.kpi2Id });
    const b = await link({ linkKind: "capability_kpi", fromId: t.capability2Id, toId: t.kpi2Id });
    const c = await link({ linkKind: "capability_kpi", fromId: t.capability1Id, toId: t.kpi1Id });
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    const list = await call(api.app, "GET", `${L}?recordId=${t.capability1Id}`, { session: t.s.auditor });
    expect(list.body.items.length).toBeGreaterThanOrEqual(2);
  });
});

describe("REQ-PB-044: every node opens its record", () => {
  it("every node type of the whole graph has an href that returns 200", async () => {
    expect((await link({ linkKind: "issue_gap", fromId: t.findingId, toId: t.gap1Id })).status).toBe(201);
    expect(
      (await link({ linkKind: "deliverable_capability", fromId: t.deliverableId, toId: t.capability1Id })).status,
    ).toBe(201);
    expect((await link({ linkKind: "kpi_benefit", fromId: t.kpi1Id, toId: t.benefitId })).status).toBe(201);
    const g = await call(api.app, "GET", `${t.base}/traceability`, { session: t.s.auditor });
    expect(g.status).toBe(200);
    const nodes = g.body.nodes as { recordType: string; recordId: string; href: string }[];
    const types = new Set(nodes.map((n) => n.recordType));
    expect([...types].sort()).toEqual(
      [
        "benefit",
        "capability",
        "deliverable",
        "diagnostic_finding",
        "initiative",
        "outcome",
        "outcome_kpi",
        "tom_gap",
      ].sort(),
    );
    for (const type of types) {
      const node = nodes.find((n) => n.recordType === type)!;
      const r = await call(api.app, "GET", node.href, { session: t.s.auditor });
      expect([type, r.status], `${node.href} ${JSON.stringify(r.body).slice(0, 200)}`).toEqual([type, 200]);
      expect((r.body as { id: string }).id).toBe(node.recordId);
    }
    expect(g.body.truncated).toBe(false);
  });

  it("a root outside the transformation is 422; another organization's caller gets 404", async () => {
    const bad = await call(api.app, "GET", `${t.base}/traceability?rootType=initiative&rootId=${t.capability1Id}`, {
      session: t.s.auditor,
    });
    expect([bad.status, bad.body.code]).toEqual([422, "trace_link.record_not_found"]);
    expect((await call(api.app, "GET", `${t.base}/traceability`, { session: t.s.outsider })).status).toBe(404);
    expect((await call(api.app, "GET", L, { session: t.s.outsider })).status).toBe(404);
    expect(
      (await call(api.app, "GET", `${t.base}/traceability?rootType=initiative`, { session: t.s.auditor })).status,
    ).toBe(400);
  });
});

describe("ADR-0038 §12: exact refusals", () => {
  it("pair_not_allowed, record_not_found, record_inactive, duplicate, share_not_allowed", async () => {
    const pair = await link({ linkKind: "issue_gap", fromId: t.capability1Id, toId: t.gap2Id });
    expect([pair.status, pair.body.code, pair.body.detail, pair.body.errors[0].pointer]).toEqual([
      422,
      "trace_link.pair_not_allowed",
      "This kind of link cannot connect these two records.",
      "/linkKind",
    ]);
    const missing = await link({
      linkKind: "issue_gap",
      fromId: t.findingId,
      toId: "01900000-0000-7000-8000-000000000000",
    });
    expect([missing.status, missing.body.code, missing.body.detail, missing.body.errors[0].pointer]).toEqual([
      422,
      "trace_link.record_not_found",
      "The linked record does not exist in this transformation.",
      "/toId",
    ]);
    const archivedCap = await insertAudited(api.db, t, "capability", {
      name: "Synthetic archived capability",
      status: "archived",
      archived_at: new Date(),
      archived_by: t.users.tl.id,
      archive_reason: "fixture",
    });
    const inactive = await link({ linkKind: "deliverable_capability", fromId: t.deliverableId, toId: archivedCap });
    expect([inactive.status, inactive.body.code, inactive.body.detail]).toEqual([
      422,
      "trace_link.record_inactive",
      "The linked record is archived or removed.",
    ]);
    const first = await link({ linkKind: "issue_gap", fromId: t.findingId, toId: t.gap2Id });
    expect(first.status).toBe(201);
    const dup = await link({ linkKind: "issue_gap", fromId: t.findingId, toId: t.gap2Id });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "trace_link.duplicate",
      "These two records are already linked.",
    ]);
    const share = await link({
      linkKind: "deliverable_capability",
      fromId: t.deliverableId,
      toId: t.capability2Id,
      allocationShare: "0.1",
    });
    expect([share.status, share.body.code, share.body.detail, share.body.errors[0].pointer]).toEqual([
      422,
      "trace_link.share_not_allowed",
      "A share can be set only on a link into a KPI or a benefit.",
      "/allocationShare",
    ]);
    // A basis without a share, and a share outside (0, 1], are validation errors.
    expect(
      (await link({ linkKind: "capability_kpi", fromId: t.capability2Id, toId: t.kpi1Id, allocationBasis: "x" }))
        .status,
    ).toBe(400);
    expect(
      (await link({ linkKind: "capability_kpi", fromId: t.capability2Id, toId: t.kpi1Id, allocationShare: "1.5" }))
        .status,
    ).toBe(400);
    expect(
      (await link({ linkKind: "capability_kpi", fromId: t.capability2Id, toId: t.kpi1Id, allocationShare: "0" }))
        .status,
    ).toBe(400);
    // Blank free text is refused (shared freeText rule).
    expect(
      (await link({ linkKind: "issue_gap", fromId: t.findingId, toId: t.gap1Id, contributionStatement: "   " })).status,
    ).toBe(400);
  });
});

describe("S-4: every mutation", () => {
  it("AUD gets 403 on every write; nothing is written", async () => {
    const created = await link({ linkKind: "capability_kpi", fromId: t.capability2Id, toId: t.kpi1Id });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const aud = t.s.auditor;
    expect((await link({ linkKind: "issue_gap", fromId: t.findingId, toId: t.gap1Id }, aud)).status).toBe(403);
    expect(
      (
        await call(api.app, "PATCH", `${L}/${id}`, {
          session: aud,
          headers: ifm(1),
          body: { contributionStatement: "x" },
        })
      ).status,
    ).toBe(403);
    expect((await post(`${L}/${id}/remove`, { reason: "AUD try" }, aud, ifm(1))).status).toBe(403);
    // The technical administrator holds no business permission either (refused at the route's permission gate).
    expect((await link({ linkKind: "issue_gap", fromId: t.findingId, toId: t.gap1Id }, t.s.admin)).status).toBe(403);
    expect((await auditOf(api.db, id)).length).toBe(1);
  });

  it("If-Match: 428 when missing, 409 when stale; one audit event per mutation; a removed link is never deleted", async () => {
    const created = await link({
      linkKind: "kpi_benefit",
      fromId: t.kpi2Id,
      toId: t.benefitId,
      allocationShare: "0.2",
    });
    expect([created.status, created.headers["etag"]]).toEqual([201, '"1"']);
    const id = created.body.id as string;
    expect(
      (await call(api.app, "PATCH", `${L}/${id}`, { session: t.s.bo, body: { allocationShare: "0.3" } })).status,
    ).toBe(428);
    expect((await post(`${L}/${id}/remove`, { reason: "No If-Match" })).status).toBe(428);
    const upd = await call(api.app, "PATCH", `${L}/${id}`, {
      session: t.s.bo,
      headers: ifm(1),
      body: { contributionStatement: "Edited statement", allocationShare: "0.3" },
    });
    expect([upd.status, upd.body.version, upd.body.allocationShare, upd.headers["etag"]]).toEqual([
      200,
      2,
      "0.300000",
      '"2"',
    ]);
    expect(
      (
        await call(api.app, "PATCH", `${L}/${id}`, {
          session: t.s.bo,
          headers: ifm(1),
          body: { allocationShare: "0.1" },
        })
      ).status,
    ).toBe(409);
    // Clearing the share clears its basis.
    const cleared = await call(api.app, "PATCH", `${L}/${id}`, {
      session: t.s.bo,
      headers: ifm(2),
      body: { allocationShare: null },
    });
    expect([cleared.status, cleared.body.allocationShare, cleared.body.allocationBasis]).toEqual([200, null, null]);
    const rm = await post(`${L}/${id}/remove`, { reason: "Synthetic: replaced" }, t.s.bo, ifm(3));
    expect([rm.status, rm.body.status, rm.body.removeReason, rm.body.removedBy]).toEqual([
      200,
      "removed",
      "Synthetic: replaced",
      t.users.bo.id,
    ]);
    const again = await post(`${L}/${id}/remove`, { reason: "Twice" }, t.s.bo, ifm(4));
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "trace_link.not_active",
      "This link has been removed.",
    ]);
    const edit = await call(api.app, "PATCH", `${L}/${id}`, {
      session: t.s.bo,
      headers: ifm(4),
      body: { contributionStatement: "x" },
    });
    expect([edit.status, edit.body.code]).toEqual([422, "trace_link.not_active"]);
    const events = await auditOf(api.db, id);
    expect(events.map((e) => e.action)).toEqual([
      "trace_link.create",
      "trace_link.update",
      "trace_link.update",
      "trace_link.remove",
    ]);
    // Never deleted: the row stays, removed; it is listed only with includeRemoved and is no edge of the graph.
    const row = await api.db.selectFrom("trace_link").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    expect(row.status).toBe("removed");
    const plain = await call(api.app, "GET", `${L}?kind=kpi_benefit`, { session: t.s.auditor });
    expect((plain.body.items as { id: string }[]).some((i) => i.id === id)).toBe(false);
    const all = await call(api.app, "GET", `${L}?kind=kpi_benefit&includeRemoved=true`, { session: t.s.auditor });
    expect((all.body.items as { id: string }[]).some((i) => i.id === id)).toBe(true);
    const g = await call(api.app, "GET", `${t.base}/traceability`, { session: t.s.auditor });
    expect((g.body.edges as { linkId: string }[]).some((e) => e.linkId === id)).toBe(false);
    const get = await call(api.app, "GET", `${L}/${id}`, { session: t.s.auditor });
    expect([get.status, get.body.status, get.headers["etag"]]).toEqual([200, "removed", '"4"']);
  });

  it("commit-time: a grant revoked while the create waited is 403; nothing written", async () => {
    const u = await extraUser(api, w, t, "TL");
    const before = await api.db
      .selectFrom("trace_link")
      .select("id")
      .where("transformation_id", "=", t.transformationId)
      .execute();
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", L, {
          session: u.session,
          body: { linkKind: "issue_gap", fromId: t.findingId, toId: t.gap1Id, contributionStatement: "Late" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const after = await api.db
      .selectFrom("trace_link")
      .select("id")
      .where("transformation_id", "=", t.transformationId)
      .execute();
    expect(after.length).toBe(before.length);
  });

  it("a link of another transformation is 404 by id", async () => {
    const other = await seedTraceWorld(api, w);
    const l = await call(api.app, "POST", `${other.base}/trace-links`, {
      session: other.s.bo,
      body: { linkKind: "issue_gap", fromId: other.findingId, toId: other.gap1Id, contributionStatement: "Other" },
    });
    expect(l.status).toBe(201);
    expect((await call(api.app, "GET", `${L}/${l.body.id}`, { session: t.s.auditor })).status).toBe(404);
    // A record of another transformation cannot be linked.
    const cross = await link({ linkKind: "issue_gap", fromId: t.findingId, toId: other.gap1Id });
    expect([cross.status, cross.body.code]).toEqual([422, "trace_link.record_not_found"]);
  });
});
