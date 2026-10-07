// Initiatives (T05, REQ-PB-045; REQ-S16-016 "Initiative created and read through the API with authorization";
// ADR-0021 §2-§3; T-DG3-BE-B) against a real PostgreSQL:
//  - create (draft, version 1, INI-nn from record_code_counter, ETag + Location, one audit event) and read back with the
//    14 T05 fields' homes; drafting is allowed before G1;
//  - warnings initiative.deliverable_count (outside 3-7), initiative.no_gap_link, initiative.no_owner: never rejections;
//  - validation (400 schema, 422 planned_end < planned_start, unknown people / wave), If-Match 428/409 on PATCH;
//  - authorization: AUD 403 on create and update (audited denial, nothing written), no read access -> 404, and the write
//    gate re-checked AT COMMIT (BE18A): a grant revoked while the request waits is 403 and nothing is written;
//  - archive, never delete: no DELETE route; a cancelled initiative is read-only.
// All data is SYNTHETIC; nothing here approves anything (product gates G1-G6 are business approvals; never DG0-DG7).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { createInitiative } from "../contract/p3-exercises-be-b.ts";

let api: TestApi;
let w: World;
let p: P2World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
}, 60_000);
afterAll(() => api.close());

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
const I = (id: string) => `/api/v1/initiatives/${id}`;
const warningCodes = (b: { warnings: { code: string }[] }) => b.warnings.map((x) => x.code).sort();

const FULL = () => ({
  transformationId: p.transformationId,
  name: "Synthetic prepaid roaming relaunch",
  executiveOwnerUserId: p.sponsor.id,
  workstreamLeadUserId: p.contributor.id,
  problemStatement: "Synthetic: roaming bundles are priced above competitors.",
  objective: "Synthetic: lift roaming revenue per user by 10%.",
  scopeIn: "Synthetic: prepaid roaming bundles.",
  scopeOut: "Synthetic: enterprise contracts.",
  financialBenefitSummary: "Synthetic: SAR 12m a year (narrative; quantified in the business case).",
  customerBenefitSummary: "Synthetic: fewer bill shocks abroad.",
  risksSummary: "Synthetic: partner tariffs may change.",
  plannedStart: "2027-01-01",
  plannedEnd: "2027-06-30",
});

describe("create and read an Initiative through the API (REQ-S16-016, REQ-PB-045)", () => {
  it("creates a draft with every T05 card field, INI-nn, version 1, ETag/Location and one audit event; reads it back", async () => {
    const res = await send("POST", "/api/v1/initiatives", { session: p.lead.session, body: FULL() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const b = res.body;
    expect([b.status, b.version, b.fundingState, b.displayStatus]).toEqual([
      "draft",
      1,
      "not_applicable",
      "initiative.status.draft",
    ]);
    expect(b.code).toMatch(/^INI-[0-9]{2}$/);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.headers["location"]).toBe(`/api/v1/initiatives/${b.id}`);
    const { transformationId: _t, ...fields } = FULL();
    expect(b).toMatchObject(fields);
    // Owner set -> no initiative.no_owner; no deliverables (0, outside 3-7) and no gap link are warnings, not rejections.
    expect(warningCodes(b)).toEqual(["initiative.deliverable_count", "initiative.no_gap_link"]);
    const audit = await auditOf(api.db, b.id);
    expect(audit.map((a) => [a.action, a.new_version])).toEqual([["initiative.create", 1]]);
    expect((audit[0]!.changes as Record<string, { from: unknown; to: unknown }>)["name"]).toEqual({
      from: null,
      to: FULL().name,
    });
    // Read back by the lead and by the read-only auditor (read is allowed).
    for (const session of [p.lead.session, p.auditor.session]) {
      const got = await send("GET", I(b.id), { session });
      expect([got.status, got.body.id, got.headers["etag"]]).toEqual([200, b.id, '"1"']);
    }
  });

  it("codes are sequential per transformation and a minimal draft carries all three warnings (before G1: drafting is allowed)", async () => {
    const a = await createInitiative(send, p, { name: "Synthetic A" });
    const b = await createInitiative(send, p, { name: "Synthetic B" });
    const n = (c: unknown) => Number.parseInt(String(c).slice(4), 10);
    expect(n(b["code"])).toBe(n(a["code"]) + 1);
    expect(warningCodes(a as never)).toEqual([
      "initiative.deliverable_count",
      "initiative.no_gap_link",
      "initiative.no_owner",
    ]);
  });

  it("a caller without access to the transformation gets 404 (existence never disclosed); no session -> 401", async () => {
    const a = await createInitiative(send, p);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await send("GET", I(a.id), { session: nobody })).status).toBe(404);
    expect(
      (await send("GET", `/api/v1/initiatives?transformationId=${p.transformationId}`, { session: nobody })).status,
    ).toBe(404);
    expect((await send("GET", I(a.id), {})).status).toBe(401);
  });

  it("lists newest change first, filters by status, and pages with a cursor", async () => {
    const a = await createInitiative(send, p, { name: "Synthetic list 1" });
    const b = await createInitiative(send, p, { name: "Synthetic list 2" });
    const L = `/api/v1/initiatives?transformationId=${p.transformationId}`;
    const page1 = await send("GET", `${L}&limit=1`, { session: p.auditor.session });
    expect([page1.status, page1.body.items[0].id]).toEqual([200, b.id]);
    const page2 = await send("GET", `${L}&limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`, {
      session: p.auditor.session,
    });
    expect(page2.body.items[0].id).toBe(a.id);
    const drafts = await send("GET", `${L}&status=draft&limit=100`, { session: p.lead.session });
    expect(drafts.body.items.every((i: { status: string }) => i.status === "draft")).toBe(true);
    expect((await send("GET", `${L}&status=launched`, { session: p.lead.session })).body.items).toEqual([]);
    expect((await send("GET", `${L}&status=bogus`, { session: p.lead.session })).status).toBe(400);
    expect((await send("GET", "/api/v1/initiatives", { session: p.lead.session })).status).toBe(400);
  });
});

describe("validation (nothing written on a refusal)", () => {
  it("400 for schema errors (missing or blank name, unknown field, status in the body)", async () => {
    for (const body of [
      { transformationId: p.transformationId },
      { transformationId: p.transformationId, name: "   " },
      { transformationId: p.transformationId, name: "x", status: "launched" },
      { transformationId: "not-a-uuid", name: "x" },
    ]) {
      const res = await send("POST", "/api/v1/initiatives", { session: p.lead.session, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action)).toEqual([]);
    }
  });

  it("422 initiative.planned_range when plannedEnd < plannedStart (create and PATCH)", async () => {
    const bad = await send("POST", "/api/v1/initiatives", {
      session: p.lead.session,
      body: { transformationId: p.transformationId, name: "x", plannedStart: "2027-06-01", plannedEnd: "2027-05-31" },
    });
    expect([bad.status, bad.body.code, bad.body.errors[0].pointer]).toEqual([
      422,
      "initiative.planned_range",
      "/plannedEnd",
    ]);
    const ok = await createInitiative(send, p, { plannedStart: "2027-06-01", plannedEnd: "2027-06-01" });
    const patch = await send("PATCH", I(ok.id), {
      session: p.lead.session,
      headers: ifm(1),
      body: { plannedEnd: "2027-05-01" },
    });
    expect([patch.status, patch.body.code]).toEqual([422, "initiative.planned_range"]);
    expect((await send("GET", I(ok.id), { session: p.lead.session })).body.version).toBe(1);
  });

  it("422 for a named person outside the organization and for a wave of another transformation", async () => {
    const other = await setupP2World(api, w);
    const foreignWave = await api.db
      .selectFrom("roadmap_wave")
      .select("id")
      .where("transformation_id", "=", other.transformationId)
      .executeTakeFirstOrThrow();
    const wave = await send("POST", "/api/v1/initiatives", {
      session: p.lead.session,
      body: { transformationId: p.transformationId, name: "x", waveId: foreignWave.id },
    });
    expect([wave.status, wave.body.errors[0].pointer]).toEqual([422, "/waveId"]);
    const person = await send("POST", "/api/v1/initiatives", {
      session: p.lead.session,
      body: { transformationId: p.transformationId, name: "x", executiveOwnerUserId: w.officeB.id },
    });
    expect([person.status, person.body.code, person.body.errors[0].pointer]).toEqual([
      422,
      "validation.user_invalid",
      "/executiveOwnerUserId",
    ]);
    const ownWave = await api.db
      .selectFrom("roadmap_wave")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    const good = await createInitiative(send, p, { waveId: ownWave.id });
    expect(good["waveId"]).toBe(ownWave.id);
  });
});

describe("PATCH: If-Match, audit diff, warnings move, read-only once cancelled", () => {
  it("428 without If-Match, 409 stale, 200 with version + 1 and the field diff; setting the owner clears no_owner", async () => {
    const a = await createInitiative(send, p);
    expect((await send("PATCH", I(a.id), { session: p.lead.session, body: { name: "y" } })).status).toBe(428);
    const stale = await send("PATCH", I(a.id), { session: p.lead.session, headers: ifm(7), body: { name: "y" } });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const res = await send("PATCH", I(a.id), {
      session: p.lead.session,
      headers: ifm(1),
      body: { name: "Synthetic renamed", executiveOwnerUserId: p.sponsor.id },
    });
    expect([res.status, res.body.version, res.headers["etag"]]).toEqual([200, 2, '"2"']);
    expect(warningCodes(res.body)).not.toContain("initiative.no_owner");
    const audit = await auditOf(api.db, a.id);
    expect(audit.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["initiative.create", null, 1],
      ["initiative.update", 1, 2],
    ]);
    expect(audit[1]!.changes).toEqual({
      name: { from: a["name"], to: "Synthetic renamed" },
      executive_owner_user_id: { from: null, to: p.sponsor.id },
    });
    expect((await send("PATCH", I(a.id), { session: p.lead.session, headers: ifm(2), body: {} })).status).toBe(400);
  });

  it("a cancelled initiative is read-only (archive, never delete; no DELETE route)", async () => {
    const a = await createInitiative(send, p);
    const cancelled = await send("POST", `${I(a.id)}/cancel`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic: superseded." },
    });
    expect(cancelled.status).toBe(200);
    const res = await send("PATCH", I(a.id), { session: p.lead.session, headers: ifm(2), body: { name: "z" } });
    expect([res.status, res.body.code]).toEqual([422, "initiative.read_only"]);
    const del = await call(api.app, "DELETE", I(a.id), { session: p.lead.session, contract: false });
    expect([404, 405]).toContain(del.status);
    expect((await send("GET", I(a.id), { session: p.lead.session })).body.status).toBe("cancelled");
  });
});

describe("authorization on every initiative mutation", () => {
  it("AUD gets 403 on create and PATCH, the denial is audited and nothing is written", async () => {
    const a = await createInitiative(send, p);
    const cases = [
      ["POST", "/api/v1/initiatives", { transformationId: p.transformationId, name: "x" }],
      ["POST", "/api/v1/initiatives", { transformationId: p.transformationId }],
      ["PATCH", I(a.id), { name: "x" }],
      ["PATCH", I(a.id), {}],
    ] as const;
    for (const [method, url, body] of cases) {
      const res = await send(method, url, { session: p.auditor.session, headers: ifm(1), body });
      expect(res.status, `${method} ${url} ${JSON.stringify(res.body)}`).toBe(403);
      expect((await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action)).toEqual([
        "authorization.denied",
      ]);
    }
    expect((await send("GET", I(a.id), { session: p.lead.session })).body.version).toBe(1);
  });

  it("the Sponsor (no initiative.edit) gets 403; the workstream lead (WL, initiative.edit) may edit", async () => {
    const a = await createInitiative(send, p);
    expect(
      (await send("PATCH", I(a.id), { session: p.sponsor.session, headers: ifm(1), body: { name: "x" } })).status,
    ).toBe(403);
    expect(
      (await send("PATCH", I(a.id), { session: p.contributor.session, headers: ifm(1), body: { name: "x" } })).status,
    ).toBe(200);
  });

  it("BE18A: the write gate is re-checked at commit - a grant revoked while the request waits is 403, nothing written", async () => {
    const tmp = await setupP2World(api, w); // a fresh WL contributor whose grant we can revoke
    const a = await createInitiative(send, tmp);
    // Hold the initiative table so the PATCH handler blocks AFTER the request's principal was loaded (preValidation):
    // a request-start snapshot of the grants would still allow it; the commit-time re-check must not.
    const lockConn = await api.owner.connect();
    try {
      await lockConn.query("BEGIN");
      await lockConn.query("LOCK TABLE initiative IN ACCESS EXCLUSIVE MODE");
      const pending = send("PATCH", I(a.id), {
        session: tmp.contributor.session,
        headers: ifm(1),
        body: { name: "Synthetic: should not commit" },
      });
      await new Promise((r) => setTimeout(r, 300));
      await api.db
        .updateTable("scoped_assignment")
        .set({ revoked_at: new Date(), revoked_by: w.grantor.id, revoke_reason: "Synthetic revoke mid-request" })
        .where("user_id", "=", tmp.contributor.id)
        .execute();
      await lockConn.query("COMMIT");
      const res = await pending;
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action)).toEqual([
        "authorization.denied",
      ]);
    } finally {
      lockConn.release();
    }
    const after = await send("GET", I(a.id), { session: tmp.lead.session });
    expect([after.body.version, after.body.name]).toEqual([1, a["name"]]);
    // Control: the same PATCH by a holder of initiative.edit commits.
    expect(
      (await send("PATCH", I(a.id), { session: tmp.lead.session, headers: ifm(1), body: { name: "ok" } })).status,
    ).toBe(200);
  }, 30_000);
});
