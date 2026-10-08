// Funding decisions (ADR-0023 §7, ADR-0021 §3 and §6; REQ-S09-003, REQ-S04-006, REQ-S16-016/-018; T-DG3-BE-E) against
// a real PostgreSQL:
//  - one transaction writes the canonical `decision` (kind executive, DEC-nn, decided) and the `funding_decision`, each
//    audited, and mirrors the status: approved selected -> funded; rejected/deferred stay 'Selected - unfunded';
//    revoked funded -> selected; not selected -> 422 funding.not_selected with the exact text; nothing written;
//  - delegation refused: 422 funding.on_behalf_not_supported at /onBehalfOfUserId with the exact ADR text, checked
//    before the business preconditions; nothing written; on_behalf_of_user_id is always NULL;
//  - THE DESELECT RULE (decided by BE-E): deselecting voids funding; re-selection is 'Selected - unfunded' and cannot
//    launch until a person records a NEW approved decision;
//  - authorization (FIN and SP yes; TL, WL, AUD 403; BE18A at commit), validation (400/422), Idempotency-Key replay.
// All data is SYNTHETIC; every funding decision is a demo business record that approves nothing real, and nothing
// touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, auditOfRequest, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { createInitiative } from "../contract/p3-exercises-be-b.ts";
import { financeUser } from "../contract/p3-exercises-kbe-b.ts";
import { selectedInitiative } from "../contract/p3-exercises-be-e.ts";
import { revokedAfterIdentity } from "./be18a.ts";
import { setGateStatus } from "./fixtures.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const F = "/api/v1/funding-decisions";
const RATIONALE = "Synthetic demo funding decision; approves nothing real.";
const TEXT = {
  notSelected: "Funding can only be approved for a selected initiative",
  notRevocable: "Only the funding of a funded initiative that is not launched can be revoked",
  onBehalf: "A funding decision is decided by the approver in person; deciding on someone's behalf is not available.",
};
const actions = async (res: { headers: Record<string, unknown> }) =>
  (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);
const ini = (p: P2World, id: string) => send("GET", `/api/v1/initiatives/${id}`, { session: p.lead.session });
const body = (initiativeId: string, over: Record<string, unknown> = {}) => ({
  initiativeId,
  outcome: "approved",
  amount: "1500000.00",
  currency: "SAR",
  rationale: RATIONALE,
  ...over,
});
const counts = async (p: P2World) => ({
  decisions: (
    await api.db
      .selectFrom("decision")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .where("kind", "=", "executive")
      .execute()
  ).length,
  funding: (
    await api.db
      .selectFrom("funding_decision")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .execute()
  ).length,
});

async function world() {
  const p = await setupP2World(api, w);
  await setGateStatus(api, p, "G1", "approved");
  return { p, fin: await financeUser(api, w, p) };
}

describe("recording a funding decision (business approval)", () => {
  it("approved: decision (executive, DEC-nn) + funding_decision + selected -> funded in one transaction, each audited", async () => {
    const { p, fin } = await world();
    const id = await selectedInitiative(api, send, p);
    const before = (await ini(p, id)).body;
    expect([before.status, before.fundingState, before.displayStatus]).toEqual([
      "selected",
      "unfunded",
      "initiative.status.selected_unfunded",
    ]);
    const res = await send("POST", F, { session: fin.session, body: body(id, { fundingSource: "Synthetic opex" }) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.headers["location"]).toBe(`${F}/${res.body.id}`);
    expect(res.body).toMatchObject({
      initiativeId: id,
      outcome: "approved",
      amount: "1500000.0000",
      currency: "SAR",
      fundingSource: "Synthetic opex",
      approverRoleCode: "FIN",
      decidedBy: fin.id,
      onBehalfOfUserId: null,
      decisionCode: "DEC-01",
    });
    const decision = await api.db
      .selectFrom("decision")
      .selectAll()
      .where("id", "=", res.body.decisionId)
      .executeTakeFirstOrThrow();
    expect([decision.kind, decision.code, decision.status, decision.decided_by]).toEqual([
      "executive",
      "DEC-01",
      "decided",
      fin.id,
    ]);
    expect(await actions(res)).toEqual(["decision.create", "funding_decision.create", "initiative.fund"]);
    const after = (await ini(p, id)).body;
    expect([after.status, after.fundingState, after.displayStatus, after.version]).toEqual([
      "funded",
      "funded",
      "initiative.status.funded",
      before.version + 1,
    ]);
    // Read back through the API (REQ-S16-016): get and list, newest first; AUD can read.
    expect((await send("GET", `${F}/${res.body.id}`, { session: p.auditor.session })).body).toEqual(res.body);
    const list = await send("GET", `${F}?transformationId=${p.transformationId}`, { session: p.auditor.session });
    expect(list.body.items.map((x: Body) => x.id)).toEqual([res.body.id]);
    const stranger = await setupP2World(api, w);
    expect((await send("GET", `${F}/${res.body.id}`, { session: stranger.lead.session })).status).toBe(404);
    expect(
      (await send("GET", `${F}?transformationId=${p.transformationId}`, { session: stranger.lead.session })).status,
    ).toBe(404);
  });

  it("rejected / deferred leave 'Selected - unfunded'; revoked returns funded -> selected; revoking unfunded or launched -> 422", async () => {
    const { p, fin } = await world();
    const id = await selectedInitiative(api, send, p);
    for (const outcome of ["deferred", "rejected"]) {
      const res = await send("POST", F, { session: p.sponsor.session, body: body(id, { outcome, amount: null }) });
      expect([res.status, res.body.approverRoleCode, res.body.amount]).toEqual([201, "SP", null]);
      expect(await actions(res)).toEqual(["decision.create", "funding_decision.create"]);
      expect([(await ini(p, id)).body.status, (await ini(p, id)).body.displayStatus]).toEqual([
        "selected",
        "initiative.status.selected_unfunded",
      ]);
    }
    const notFunded = await send("POST", F, { session: fin.session, body: body(id, { outcome: "revoked" }) });
    expect([notFunded.status, notFunded.body.type, notFunded.body.code, notFunded.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "funding.not_revocable",
      TEXT.notRevocable,
    ]);
    expect((await send("POST", F, { session: fin.session, body: body(id) })).status).toBe(201);
    // Approving again a funded initiative: not selected any more.
    const twice = await send("POST", F, { session: fin.session, body: body(id) });
    expect([twice.status, twice.body.code, twice.body.detail]).toEqual([422, "funding.not_selected", TEXT.notSelected]);
    const revoked = await send("POST", F, {
      session: fin.session,
      body: body(id, { outcome: "revoked", rationale: "Synthetic: budget withdrawn." }),
    });
    expect(revoked.status).toBe(201);
    expect(await actions(revoked)).toEqual(["decision.create", "funding_decision.create", "initiative.unfund"]);
    const now = (await ini(p, id)).body;
    expect([now.status, now.fundingState, now.displayStatus]).toEqual([
      "selected",
      "revoked",
      "initiative.status.selected_unfunded",
    ]);
    // A launched initiative's funding cannot be revoked.
    await setGateStatus(api, p, "G2", "approved");
    await setGateStatus(api, p, "G3", "approved");
    expect((await send("POST", F, { session: fin.session, body: body(id) })).status).toBe(201);
    const launched = await send("POST", `/api/v1/initiatives/${id}/launch`, {
      session: p.lead.session,
      headers: ifm((await ini(p, id)).body.version),
      body: {},
    });
    expect(launched.status, JSON.stringify(launched.body)).toBe(200);
    const late = await send("POST", F, { session: fin.session, body: body(id, { outcome: "revoked" }) });
    expect([late.status, late.body.code]).toEqual([422, "funding.not_revocable"]);
  });

  it("an initiative that is not selected -> 422 funding.not_selected with the exact text; nothing written", async () => {
    const { p, fin } = await world();
    const draft = await createInitiative(send, p);
    const before = await counts(p);
    for (const outcome of ["approved", "rejected", "deferred"]) {
      const res = await send("POST", F, { session: fin.session, body: body(draft.id, { outcome }) });
      expect([res.status, res.body.type, res.body.code, res.body.detail]).toEqual([
        422,
        "urn:mth:problem:invalid-transition",
        "funding.not_selected",
        TEXT.notSelected,
      ]);
      expect(await actions(res)).toEqual([]);
    }
    expect(await counts(p)).toEqual(before);
    expect((await ini(p, draft.id)).body.version).toBe(1);
  });
});

describe("delegation is refused (ADR-0021 §6)", () => {
  it("onBehalfOfUserId -> 422 funding.on_behalf_not_supported at /onBehalfOfUserId, before the business preconditions; nothing written", async () => {
    const { p, fin } = await world();
    const id = await selectedInitiative(api, send, p);
    const draft = await createInitiative(send, p);
    const before = await counts(p);
    // A selected initiative (preconditions met) and a draft (preconditions failing): the delegation 422 wins both.
    for (const target of [id, draft.id]) {
      const res = await send("POST", F, {
        session: fin.session,
        body: body(target, { onBehalfOfUserId: p.sponsor.id }),
      });
      expect([res.status, res.body.type, res.body.code, res.body.detail]).toEqual([
        422,
        "urn:mth:problem:validation",
        "funding.on_behalf_not_supported",
        TEXT.onBehalf,
      ]);
      expect(res.body.errors).toEqual([
        { pointer: "/onBehalfOfUserId", code: "funding.on_behalf_not_supported", message: TEXT.onBehalf },
      ]);
      expect(await actions(res)).toEqual([]);
    }
    expect(await counts(p)).toEqual(before);
    expect((await ini(p, id)).body.status).toBe("selected");
    // Authorization precedes it: AUD with a delegated body is 403.
    expect(
      (await send("POST", F, { session: p.auditor.session, body: body(id, { onBehalfOfUserId: p.sponsor.id }) }))
        .status,
    ).toBe(403);
    const ok = await send("POST", F, { session: fin.session, body: body(id) });
    expect(ok.body.onBehalfOfUserId).toBeNull();
    const rows = await api.db
      .selectFrom("funding_decision")
      .select("on_behalf_of_user_id")
      .where("transformation_id", "=", p.transformationId)
      .execute();
    expect(rows.every((r) => r.on_behalf_of_user_id === null)).toBe(true);
  });
});

describe("the deselect rule: deselecting voids funding", () => {
  it("funded -> deselected -> re-selected is 'Selected - unfunded' and cannot launch; a new approved decision funds it", async () => {
    const { p, fin } = await world();
    await setGateStatus(api, p, "G2", "approved");
    await setGateStatus(api, p, "G3", "approved");
    const id = await selectedInitiative(api, send, p);
    expect((await send("POST", F, { session: fin.session, body: body(id) })).status).toBe(201);
    const act = async (action: string) =>
      send("POST", `/api/v1/initiatives/${id}/${action}`, {
        session: action === "launch" ? p.lead.session : p.sponsor.session,
        headers: ifm((await ini(p, id)).body.version),
        body: action === "launch" ? {} : { rationale: "Synthetic portfolio change." },
      });
    expect((await act("deselect")).status).toBe(200);
    expect([(await ini(p, id)).body.status, (await ini(p, id)).body.fundingState]).toEqual([
      "ranked",
      "not_applicable",
    ]);
    expect((await act("select")).status).toBe(200);
    const reselected = (await ini(p, id)).body;
    expect([reselected.status, reselected.fundingState, reselected.displayStatus]).toEqual([
      "selected",
      "unfunded",
      "initiative.status.selected_unfunded",
    ]);
    const launch = await act("launch");
    expect([launch.status, launch.body.code]).toEqual([422, "initiative.selected_unfunded"]);
    // The earlier decision is history, not current: a NEW approved decision is needed.
    expect(
      (await send("POST", F, { session: fin.session, body: body(id, { rationale: "Synthetic re-approval." }) })).status,
    ).toBe(201);
    expect([(await ini(p, id)).body.status, (await ini(p, id)).body.fundingState]).toEqual(["funded", "funded"]);
    expect((await act("launch")).status).toBe(200);
  });
});

describe("validation, authorization and idempotency", () => {
  it("400 for malformed bodies; 422 for amounts numeric(20,4) cannot hold; unknown business case 422", async () => {
    const { p, fin } = await world();
    const id = await selectedInitiative(api, send, p);
    for (const bad of [
      { amount: 1500000 },
      { currency: "sar" },
      { rationale: "  " },
      { outcome: "maybe" },
      { extra: true },
      { rationale: "ab" },
    ])
      expect((await send("POST", F, { session: fin.session, body: body(id, bad) })).status, JSON.stringify(bad)).toBe(
        400,
      );
    for (const amount of ["-1", "1.12345", "12345678901234567"]) {
      const res = await send("POST", F, { session: fin.session, body: body(id, { amount }) });
      expect([res.status, res.body.code, res.body.errors?.[0]?.pointer]).toEqual([
        422,
        "funding.amount_invalid",
        "/amount",
      ]);
    }
    const res = await send("POST", F, { session: fin.session, body: body(id, { businessCaseId: id }) });
    expect([res.status, res.body.code]).toEqual([422, "validation.reference"]);
    expect((await ini(p, id)).body.status).toBe("selected");
  });

  it("FIN and SP may record; TL, WL, TO and AUD get 403 (audited as authorization.denied); BE18A at commit", async () => {
    const { p } = await world();
    const id = await selectedInitiative(api, send, p);
    for (const s of [p.lead.session, p.contributor.session, p.office.session, p.auditor.session]) {
      const res = await send("POST", F, { session: s, body: body(id) });
      expect(res.status).toBe(403);
      expect(await actions(res)).toEqual(["authorization.denied"]);
    }
    const revoked = await revokedAfterIdentity(api, w, p.transformationId, "FIN", "POST", F, body(id));
    expect(revoked.status).toBe(403);
    expect((await ini(p, id)).body.status).toBe("selected");
    expect((await auditOf(api.db, id)).map((e) => e.action)).not.toContain("initiative.fund");
  }, 30_000);

  it("Idempotency-Key: the same key and body replays the first response and writes once", async () => {
    const { p, fin } = await world();
    const id = await selectedInitiative(api, send, p);
    const headers = { "idempotency-key": "synthetic-funding-key-0001" };
    const first = await send("POST", F, { session: fin.session, headers, body: body(id) });
    const second = await send("POST", F, { session: fin.session, headers, body: body(id) });
    expect([first.status, second.status, second.headers["idempotent-replayed"]]).toEqual([201, 201, "true"]);
    expect(second.body).toEqual(first.body);
    expect((await counts(p)).funding).toBe(1);
  });
});
