// Initiative lifecycle and portfolio selection (ADR-0021 §3-§5; T-DG3-BE-B) against a real PostgreSQL:
//  - every transition (submit, withdraw, select, deselect, launch, cancel): success, every 422 with its EXACT text, the
//    precondition ORDER (launch checks direction before funding), If-Match 428/409, one audit event, AUD 403;
//  - REQ-PB-007 / REQ-PB-022: submit before G1 -> 422 'Case for change not yet approved (G1)…';
//  - REQ-PB-006: submit without an outcome/KPI link -> the 'Outcome before activity' VALIDATION error, accepted once one
//    exists;
//  - REQ-PB-004 (acceptance, literally): End-to-End launch -> 422 'North Star, outcomes and target state not yet
//    approved'; after G2 and G3 approval the same call succeeds; a waiver of G3 or (Modular) entry satisfies it;
//  - REQ-S09-003: ranking never selects; selection is a recorded business approval (portfolio_selection row); a selected
//    initiative without a current approved funding decision is 'Selected - unfunded' and cannot launch;
//  - latestFundingState(): the latest funding_decision decides (none -> unfunded, approved -> funded, deferred/rejected
//    -> unfunded, revoked -> revoked).
// Gate statuses are staged with BE-A's fixture (with audit events); ranking and funding with BE-B's test-only fixtures
// (p3-exercises-be-b.ts: stageRanked, stageFunding - a canonical executive `decision` + `funding_decision` with their
// audit events in one transaction). All data is SYNTHETIC; every selection, funding or gate status here is a demo
// business record that approves nothing real, and nothing touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { latestFundingState } from "../../../src/modules/portfolio/funding.ts";
import { v7 as uuidv7 } from "uuid";
import {
  auditOf,
  auditOfRequest,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import {
  addMeasurableContribution,
  createInitiative,
  makeDirection,
  stageFunding,
  stageRanked,
} from "../contract/p3-exercises-be-b.ts";
import { setGateStatus, setupModularWorld } from "./fixtures.ts";

const TEXT = {
  g1: "Case for change not yet approved (G1): leadership agreement on problem, baseline and material value pools is required before an initiative enters the portfolio",
  outcome:
    "Outcome before activity: link at least one measurable outcome with a KPI before submitting for prioritization",
  direction: "North Star, outcomes and target state not yet approved",
  unfunded: "Selected - unfunded: a funding approval is required before launch",
  notLaunchable: "Only a funded initiative can be launched",
  notRanked: "The initiative is not in the current proposed ranking",
};

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
const I = (id: string) => `/api/v1/initiatives/${id}`;
const RATIONALE = { rationale: "Synthetic demo selection; approves nothing real." };

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

/** A world (End-to-End unless given) with its direction (outcomes + KPI); optionally G1 approved. */
async function world(opts: { g1?: boolean; modular?: boolean } = {}) {
  const p = opts.modular ? await setupModularWorld(api, w) : await setupP2World(api, w);
  const d = await makeDirection(send, p);
  if (opts.g1) await setGateStatus(api, p, "G1", "approved");
  return { p, d };
}
type Wd = Awaited<ReturnType<typeof world>>;

async function version(id: string): Promise<number> {
  return (await api.db.selectFrom("initiative").select("version").where("id", "=", id).executeTakeFirstOrThrow())
    .version;
}
async function status(id: string): Promise<string> {
  return (await api.db.selectFrom("initiative").select("status").where("id", "=", id).executeTakeFirstOrThrow()).status;
}
/** POST an action with the current If-Match. */
async function act(id: string, action: string, session: P2World["lead"]["session"], body: unknown = {}) {
  return send("POST", `${I(id)}/${action}`, { session, headers: ifm(await version(id)), body });
}
/** draft with a measurable contribution. */
async function draft({ p, d }: Wd, over: Record<string, unknown> = {}) {
  const ini = await createInitiative(send, p, over);
  await addMeasurableContribution(send, p, ini.id, d);
  return ini.id;
}
async function submitted(x: Wd) {
  const id = await draft(x);
  expect((await act(id, "submit", x.p.lead.session)).status).toBe(200);
  return id;
}
async function ranked(x: Wd) {
  const id = await submitted(x);
  await stageRanked(api, id, x.p.lead.id);
  return id;
}
async function selected(x: Wd) {
  const id = await ranked(x);
  const res = await act(id, "select", x.p.sponsor.session, RATIONALE);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return id;
}
async function funded(x: Wd) {
  const id = await selected(x);
  await stageFunding(api, id, x.p.sponsor.id, "approved");
  expect(await status(id)).toBe("funded");
  return id;
}
const codes = (b: { errors?: { code: string }[] }) => (b.errors ?? []).map((e) => e.code);
const newAudit = async (res: { headers: Record<string, unknown> }) =>
  (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);

// ------------------------------------------------------------------------------------------------ submit

describe("submit (draft -> submitted)", () => {
  it("REQ-PB-007/REQ-PB-022: before G1 -> 422 invalid-transition with the exact G1 text; errors[] lists every failing precondition; nothing written", async () => {
    const x = await world();
    const bare = await createInitiative(send, x.p); // no outcome/KPI link either
    const res = await act(bare.id, "submit", x.p.lead.session);
    expect([res.status, res.body.type, res.body.code, res.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "initiative.g1_not_approved",
      TEXT.g1,
    ]);
    expect(codes(res.body)).toEqual(["initiative.g1_not_approved", "initiative.outcome_before_activity"]);
    expect(await newAudit(res)).toEqual([]);
    const withKpi = await draft(x);
    const res2 = await act(withKpi, "submit", x.p.lead.session);
    expect([res2.status, res2.body.code, codes(res2.body)]).toEqual([
      422,
      "initiative.g1_not_approved",
      ["initiative.g1_not_approved"],
    ]);
    expect([await status(withKpi), await version(withKpi)]).toEqual(["draft", 1]);
  });

  it("REQ-PB-006: without an outcome/KPI link -> 'Outcome before activity' validation error at /outcomeContributions; accepted once a link exists", async () => {
    const x = await world({ g1: true });
    const ini = await createInitiative(send, x.p);
    const none = await act(ini.id, "submit", x.p.lead.session);
    expect([none.status, none.body.type, none.body.code, none.body.detail, none.body.errors[0].pointer]).toEqual([
      422,
      "urn:mth:problem:validation",
      "initiative.outcome_before_activity",
      TEXT.outcome,
      "/outcomeContributions",
    ]);
    // A contribution WITHOUT a KPI is not measurable: still refused.
    const C = `${I(ini.id)}/outcome-contributions`;
    expect(
      (
        await send("POST", C, {
          session: x.p.lead.session,
          body: { outcomeId: x.d.outcomeId, contributionStatement: "s" },
        })
      ).status,
    ).toBe(201);
    expect((await act(ini.id, "submit", x.p.lead.session)).body.code).toBe("initiative.outcome_before_activity");
    await addMeasurableContribution(send, x.p, ini.id, x.d);
    const ok = await act(ini.id, "submit", x.p.lead.session, { note: "Synthetic: ready for prioritization." });
    expect([ok.status, ok.body.status, ok.body.version]).toEqual([200, "submitted", 2]);
    const audit = await auditOf(api.db, ini.id);
    expect(audit.at(-1)).toMatchObject({
      action: "initiative.submit",
      prior_version: 1,
      new_version: 2,
      reason: "Synthetic: ready for prioritization.",
      changes: { status: { from: "draft", to: "submitted" } },
    });
    const again = await act(ini.id, "submit", x.p.lead.session);
    expect([again.status, again.body.code]).toEqual([422, "initiative.not_submittable"]);
  });

  it("Modular: an accepted inherited approval of G1 with verified evidence satisfies submit (never a gate decision)", async () => {
    const x = await world({ modular: true });
    const id = await draft(x);
    expect((await act(id, "submit", x.p.lead.session)).body.code).toBe("initiative.g1_not_approved");
    const T = `/api/v1/transformations/${x.p.transformationId}`;
    const ev = await send("POST", `${T}/evidence`, {
      session: x.p.lead.session,
      body: {
        kind: "note",
        title: "Synthetic prior G1 minutes",
        noteBody: "Synthetic minutes.",
        ownerUserId: x.p.lead.id,
      },
    });
    expect(
      (
        await send("POST", `${T}/evidence/${ev.body.id}/review`, {
          session: x.p.office.session,
          headers: ifm(ev.body.version),
          body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic review." },
        })
      ).status,
    ).toBe(200);
    const disp = await send("POST", `${T}/gate-dispensations`, {
      session: x.p.lead.session,
      body: {
        kind: "inherited_approval",
        gateCode: "G1",
        approvingBody: "Synthetic executive committee",
        approvedOn: "2026-01-15",
        evidenceId: ev.body.id,
      },
    });
    expect(disp.status, JSON.stringify(disp.body)).toBe(201);
    const accepted = await send("POST", `${T}/gate-dispensations/${disp.body.id}/decision`, {
      session: x.p.sponsor.session,
      headers: ifm(disp.body.version),
      body: { result: "accepted", note: "Synthetic acceptance." },
    });
    expect([accepted.status, accepted.body.counts]).toEqual([200, true]);
    const ok = await act(id, "submit", x.p.lead.session);
    expect([ok.status, ok.body.status]).toEqual([200, "submitted"]);
    const gates = await api.db
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", x.p.transformationId)
      .execute();
    expect(gates).toEqual([]);
    // Revoking the inherited approval re-blocks the portfolio entry: a ranked initiative can no longer be selected.
    await stageRanked(api, id, x.p.lead.id);
    const revoked = await send("POST", `${T}/gate-dispensations/${disp.body.id}/revoke`, {
      session: x.p.sponsor.session,
      headers: ifm(accepted.body.version),
      body: { reason: "Synthetic: minutes withdrawn." },
    });
    expect(revoked.status).toBe(200);
    const sel = await act(id, "select", x.p.sponsor.session, RATIONALE);
    expect([sel.status, sel.body.code, sel.body.detail]).toEqual([422, "initiative.g1_not_approved", TEXT.g1]);
  });
});

// ------------------------------------------------------------------------------------------------ withdraw, cancel

describe("withdraw and cancel", () => {
  it("withdraw: submitted or ranked -> draft with a reason; draft -> 422 not_withdrawable; no reason -> 400", async () => {
    const x = await world({ g1: true });
    const s = await submitted(x);
    expect((await act(s, "withdraw", x.p.lead.session, {})).status).toBe(400);
    const ok = await act(s, "withdraw", x.p.lead.session, { reason: "Synthetic: rework." });
    expect([ok.status, ok.body.status]).toEqual([200, "draft"]);
    expect((await auditOf(api.db, s)).at(-1)).toMatchObject({
      action: "initiative.withdraw",
      reason: "Synthetic: rework.",
    });
    const bad = await act(s, "withdraw", x.p.lead.session, { reason: "Synthetic" });
    expect([bad.status, bad.body.type, bad.body.code]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "initiative.not_withdrawable",
    ]);
    const r = await ranked(x);
    expect((await act(r, "withdraw", x.p.lead.session, { reason: "Synthetic: rework." })).body.status).toBe("draft");
  });

  it("cancel: any non-terminal status -> cancelled with reason and stamps; launched or cancelled -> 422 not_cancellable", async () => {
    const x = await world({ g1: true });
    await setGateStatus(api, x.p, "G2", "approved");
    await setGateStatus(api, x.p, "G3", "approved");
    for (const make of [draft, submitted, ranked, selected, funded]) {
      const id = await make(x);
      const res = await act(id, "cancel", x.p.lead.session, { reason: "Synthetic: dropped." });
      expect([res.status, res.body.status, res.body.cancelReason, res.body.cancelledBy]).toEqual([
        200,
        "cancelled",
        "Synthetic: dropped.",
        x.p.lead.id,
      ]);
    }
    const c = await draft(x);
    await act(c, "cancel", x.p.lead.session, { reason: "Synthetic: dropped." });
    expect((await act(c, "cancel", x.p.lead.session, { reason: "Synthetic again" })).body.code).toBe(
      "initiative.not_cancellable",
    );
    const l = await funded(x);
    expect((await act(l, "launch", x.p.lead.session)).status).toBe(200);
    const res = await act(l, "cancel", x.p.lead.session, { reason: "Synthetic" });
    expect([res.status, res.body.code]).toEqual([422, "initiative.not_cancellable"]);
    expect((await act(l, "cancel", x.p.lead.session, {})).status).toBe(400);
  });
});

// ------------------------------------------------------------------------------------------------ selection

describe("selection (REQ-S09-003): a recorded business approval; ranking never selects; selection never funds", () => {
  it("ranking never selects; select writes a portfolio_selection row and shows 'Selected - unfunded'", async () => {
    const x = await world({ g1: true });
    const notRanked = await submitted(x);
    const nr = await act(notRanked, "select", x.p.sponsor.session, RATIONALE);
    expect([nr.status, nr.body.type, nr.body.code, nr.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "initiative.not_ranked",
      TEXT.notRanked,
    ]);
    const id = await ranked(x);
    const before = await api.db
      .selectFrom("portfolio_selection")
      .select("id")
      .where("initiative_id", "=", id)
      .execute();
    expect([await status(id), before]).toEqual(["ranked", []]);
    expect((await act(id, "select", x.p.sponsor.session, {})).status).toBe(400);
    expect((await act(id, "select", x.p.lead.session, RATIONALE)).status).toBe(403); // TL holds no portfolio.select
    const res = await act(id, "select", x.p.sponsor.session, RATIONALE);
    expect([res.status, res.body.status, res.body.fundingState, res.body.displayStatus]).toEqual([
      200,
      "selected",
      "unfunded",
      "initiative.status.selected_unfunded",
    ]);
    const rows = await api.db.selectFrom("portfolio_selection").selectAll().where("initiative_id", "=", id).execute();
    expect(rows.map((r) => [r.action, r.decided_by, r.rationale, r.ranking_snapshot_id !== null])).toEqual([
      ["selected", x.p.sponsor.id, RATIONALE.rationale, true],
    ]);
    expect((await auditOf(api.db, rows[0]!.id)).map((e) => e.action)).toEqual(["portfolio_selection.select"]);
    expect((await auditOf(api.db, id)).at(-1)).toMatchObject({
      action: "initiative.select",
      changes: { status: { from: "ranked", to: "selected" } },
    });
    const history = await send("GET", `${I(id)}/selections`, { session: x.p.auditor.session });
    expect(history.body.items.map((s: { action: string }) => s.action)).toEqual(["selected"]);
  });

  it("deselect: selected or funded -> ranked with a rationale; ranked or launched -> 422 not_deselectable", async () => {
    const x = await world({ g1: true });
    const s = await selected(x);
    const res = await act(s, "deselect", x.p.sponsor.session, { rationale: "Synthetic: capacity." });
    expect([res.status, res.body.status, res.body.fundingState]).toEqual([200, "ranked", "not_applicable"]);
    const bad = await act(s, "deselect", x.p.sponsor.session, { rationale: "Synthetic: again." });
    expect([bad.status, bad.body.code]).toEqual([422, "initiative.not_deselectable"]);
    const f = await funded(x);
    expect((await act(f, "deselect", x.p.sponsor.session, { rationale: "Synthetic: budget cut." })).body.status).toBe(
      "ranked",
    );
    const history = await send("GET", `${I(s)}/selections?limit=1`, { session: x.p.lead.session });
    expect([history.body.items[0].action, typeof history.body.nextCursor]).toEqual(["deselected", "string"]);
    const page2 = await send(
      "GET",
      `${I(s)}/selections?limit=1&cursor=${encodeURIComponent(history.body.nextCursor)}`,
      {
        session: x.p.lead.session,
      },
    );
    expect(page2.body.items.map((i: { action: string }) => i.action)).toEqual(["selected"]);
    await setGateStatus(api, x.p, "G2", "approved");
    await setGateStatus(api, x.p, "G3", "approved");
    const l = await funded(x);
    await act(l, "launch", x.p.lead.session);
    const launched = await act(l, "deselect", x.p.sponsor.session, { rationale: "Synthetic: too late." });
    expect([launched.status, launched.body.code]).toEqual([422, "initiative.not_deselectable"]);
  });

  it("ADR-0021 §6 (T-DG3-ARCH-03): select/deselect on someone's behalf -> 422 selection.on_behalf_not_supported, even under an active delegation; nothing written", async () => {
    const x = await world({ g1: true });
    // A second Sponsor-role holder (holds portfolio.select) with an active delegation from the Sponsor.
    const delegate = await createUser(api.db, w.orgA.id);
    await grant(
      api.db,
      w.grantor.id,
      delegate.id,
      "SP",
      { type: "transformation", id: x.p.transformationId },
      w.orgA.id,
    );
    const dSession = await signIn(api.app, delegate.subject);
    await api.owner.query(
      `insert into delegation (id, organization_id, delegator_user_id, delegate_user_id, scope_type, scope_id, record_types,
         reason_code, effective_from, effective_to)
       values ($1, $2, $3, $4, 'transformation', $5, null, 'absence', now() - interval '1 day', now() + interval '7 days')`,
      [uuidv7(), w.orgA.id, x.p.sponsor.id, delegate.id, x.p.transformationId],
    );
    const detail =
      "A portfolio selection is decided by the approver in person; deciding on someone's behalf is not available.";
    const refused = {
      status: 422,
      type: "urn:mth:problem:validation",
      code: "selection.on_behalf_not_supported",
      detail,
      errors: [{ pointer: "/onBehalfOfUserId", code: "selection.on_behalf_not_supported", message: detail }],
    };
    const shape = (r: { status: number; body: Record<string, unknown> }) => ({
      status: r.status,
      type: r.body["type"],
      code: r.body["code"],
      detail: r.body["detail"],
      errors: r.body["errors"],
    });
    const rows = async (id: string) =>
      (await api.db.selectFrom("portfolio_selection").select("id").where("initiative_id", "=", id).execute()).length;

    const r = await ranked(x);
    const v = await version(r);
    const sel = await act(r, "select", dSession, { ...RATIONALE, onBehalfOfUserId: x.p.sponsor.id });
    expect(shape(sel)).toEqual(refused);
    expect([await status(r), await version(r), await rows(r), await newAudit(sel)]).toEqual(["ranked", v, 0, []]);
    // The same delegate selecting in their own name (they hold portfolio.select) succeeds: only the on-behalf form is refused.
    expect((await act(r, "select", dSession, RATIONALE)).status).toBe(200);

    const s = await selected(x);
    const before = await rows(s);
    const des = await act(s, "deselect", x.p.sponsor.session, {
      rationale: "Synthetic: on behalf.",
      onBehalfOfUserId: delegate.id,
    });
    expect(shape(des)).toEqual(refused);
    expect([await status(s), await rows(s), await newAudit(des)]).toEqual(["selected", before, []]);
  });
});

// ------------------------------------------------------------------------------------------------ launch

describe("launch (funded -> launched)", () => {
  it("REQ-PB-004 (acceptance): End-to-End launch -> 422 'North Star, outcomes and target state not yet approved'; after G2 and G3 approval the same call succeeds", async () => {
    const x = await world({ g1: true });
    const id = await funded(x);
    const v = await version(id);
    const call1 = () => send("POST", `${I(id)}/launch`, { session: x.p.lead.session, headers: ifm(v), body: {} });
    const refused = await call1();
    expect([refused.status, refused.body.type, refused.body.code, refused.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "initiative.direction_not_approved",
      TEXT.direction,
    ]);
    expect(await newAudit(refused)).toEqual([]);
    await setGateStatus(api, x.p, "G2", "approved");
    expect((await call1()).body.code).toBe("initiative.direction_not_approved"); // G3 still missing
    await setGateStatus(api, x.p, "G3", "approved");
    const ok = await call1();
    expect([ok.status, ok.body.status, ok.body.launchedBy, ok.body.version]).toEqual([
      200,
      "launched",
      x.p.lead.id,
      v + 1,
    ]);
    expect(ok.body.launchedAt).not.toBeNull();
    expect((await auditOf(api.db, id)).at(-1)).toMatchObject({
      action: "initiative.launch",
      prior_version: v,
      new_version: v + 1,
    });
  });

  it("direction is checked BEFORE funding: a selected-unfunded End-to-End initiative gets the sequencing reason, errors[] lists both", async () => {
    const x = await world({ g1: true });
    const id = await selected(x);
    const res = await act(id, "launch", x.p.lead.session);
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "initiative.direction_not_approved",
      TEXT.direction,
    ]);
    expect(codes(res.body)).toEqual(["initiative.direction_not_approved", "initiative.selected_unfunded"]);
  });

  it("'Selected - unfunded' cannot launch (also after a rejected/deferred or revoked funding decision); other statuses are not launchable", async () => {
    const x = await world({ g1: true });
    await setGateStatus(api, x.p, "G2", "approved");
    await setGateStatus(api, x.p, "G3", "approved");
    const s = await selected(x);
    const r1 = await act(s, "launch", x.p.lead.session);
    expect([r1.status, r1.body.type, r1.body.code, r1.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "initiative.selected_unfunded",
      TEXT.unfunded,
    ]);
    for (const outcome of ["rejected", "deferred"] as const) {
      await stageFunding(api, s, x.p.sponsor.id, outcome);
      expect([await status(s), (await act(s, "launch", x.p.lead.session)).body.code]).toEqual([
        "selected",
        "initiative.selected_unfunded",
      ]);
    }
    const f = await funded(x);
    await stageFunding(api, f, x.p.sponsor.id, "revoked");
    const rev = await send("GET", I(f), { session: x.p.lead.session });
    expect([rev.body.status, rev.body.fundingState, rev.body.displayStatus]).toEqual([
      "selected",
      "revoked",
      "initiative.status.selected_unfunded",
    ]);
    expect((await act(f, "launch", x.p.lead.session)).body.detail).toBe(TEXT.unfunded);
    for (const make of [submitted, ranked]) {
      const id = await make(x);
      const res = await act(id, "launch", x.p.lead.session);
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        422,
        "initiative.not_launchable",
        TEXT.notLaunchable,
      ]);
    }
    const d = await draft(x);
    expect((await act(d, "launch", x.p.lead.session)).body.detail).toBe(TEXT.notLaunchable);
    const c = await draft(x);
    await act(c, "cancel", x.p.lead.session, { reason: "Synthetic: dropped." });
    expect((await act(c, "launch", x.p.lead.session)).body.code).toBe("initiative.not_launchable");
  });

  it("a draft launched before G1 reports G1 first (precondition 1)", async () => {
    const x = await world();
    const d = await draft(x);
    const res = await act(d, "launch", x.p.lead.session);
    expect([res.body.code, res.body.detail]).toEqual(["initiative.g1_not_approved", TEXT.g1]);
    expect(codes(res.body)).toEqual([
      "initiative.g1_not_approved",
      "initiative.direction_not_approved",
      "initiative.not_launchable",
    ]);
  });

  it("End-to-End: an accepted waiver of G3 (G2 approved) satisfies the direction rule for launch; the gate stays unapproved", async () => {
    const x = await world({ g1: true });
    await setGateStatus(api, x.p, "G2", "approved");
    const id = await funded(x);
    expect((await act(id, "launch", x.p.lead.session)).body.code).toBe("initiative.direction_not_approved");
    const T = `/api/v1/transformations/${x.p.transformationId}`;
    const wv = await send("POST", `${T}/gate-dispensations`, {
      session: x.p.lead.session,
      body: {
        kind: "waiver",
        gateCode: "G3",
        initiativeId: id,
        reason: "Synthetic: the Wave 1 pilot may launch before G3.",
        expiresOn: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      },
    });
    expect(wv.status, JSON.stringify(wv.body)).toBe(201);
    expect(
      (
        await send("POST", `${T}/gate-dispensations/${wv.body.id}/decision`, {
          session: x.p.sponsor.session,
          headers: ifm(wv.body.version),
          body: { result: "accepted" },
        })
      ).status,
    ).toBe(200);
    const ok = await act(id, "launch", x.p.lead.session);
    expect([ok.status, ok.body.status]).toEqual([200, "launched"]);
    const g3 = await api.db
      .selectFrom("gate_instance")
      .select("status")
      .where("transformation_id", "=", x.p.transformationId)
      .where("gate_code", "=", "G3")
      .executeTakeFirstOrThrow();
    expect(g3.status).not.toBe("approved");
  });

  it("Modular: a funded initiative launches without G2/G3 (not held to the End-to-End rule); WL (no initiative.launch) gets 403", async () => {
    const x = await world({ modular: true, g1: true });
    const id = await funded(x);
    expect((await act(id, "launch", x.p.contributor.session)).status).toBe(403);
    const ok = await act(id, "launch", x.p.lead.session);
    expect([ok.status, ok.body.status, ok.body.fundingState, ok.body.displayStatus]).toEqual([
      200,
      "launched",
      "funded",
      "initiative.status.launched",
    ]);
  });
});

// ------------------------------------------------------------------------------------------------ cross-cutting

describe("every transition: If-Match 428/409 and AUD 403 (audited denial, nothing written)", () => {
  const ACTIONS = [
    ["submit", {}],
    ["withdraw", { reason: "Synthetic" }],
    ["select", RATIONALE],
    ["deselect", RATIONALE],
    ["launch", {}],
    ["cancel", { reason: "Synthetic" }],
  ] as const;

  it.each(ACTIONS)("%s: 428 without If-Match, 409 stale, 403 for AUD, 404 for an unknown id", async (action, body) => {
    const x = await world({ g1: true });
    const id = await draft(x);
    const who = action === "select" || action === "deselect" ? x.p.sponsor.session : x.p.lead.session;
    const url = `${I(id)}/${action}`;
    const none = await send("POST", url, { session: who, body });
    expect([none.status, none.body.type]).toEqual([428, "urn:mth:problem:precondition-required"]);
    const stale = await send("POST", url, { session: who, headers: ifm(42), body });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    for (const b of [body, {}]) {
      const aud = await send("POST", url, { session: x.p.auditor.session, headers: ifm(1), body: b });
      expect(aud.status, JSON.stringify(aud.body)).toBe(403);
      expect(await newAudit(aud)).toEqual(["authorization.denied"]);
    }
    expect([await status(id), await version(id)]).toEqual(["draft", 1]);
    const unknown = await send("POST", `${I("01920000-0000-7000-8000-00000000dead")}/${action}`, {
      session: who,
      headers: ifm(1),
      body,
    });
    expect(unknown.status).toBe(404);
  });
});

describe("latestFundingState() (ADR-0023 §7): the latest funding decision decides, fail closed", () => {
  it("none -> unfunded; approved -> funded; deferred after approved -> unfunded; revoked -> revoked", async () => {
    const x = await world({ g1: true });
    const id = await selected(x);
    expect(await latestFundingState(api.db, id)).toBe("unfunded");
    await stageFunding(api, id, x.p.sponsor.id, "approved");
    expect(await latestFundingState(api.db, id)).toBe("funded");
    const card = await send("GET", I(id), { session: x.p.lead.session });
    expect([card.body.status, card.body.fundingState, card.body.displayStatus]).toEqual([
      "funded",
      "funded",
      "initiative.status.funded",
    ]);
    await stageFunding(api, id, x.p.sponsor.id, "deferred");
    expect(await latestFundingState(api.db, id)).toBe("unfunded");
    await stageFunding(api, id, x.p.sponsor.id, "revoked");
    expect(await latestFundingState(api.db, id)).toBe("revoked");
  });
});
