// The external-change confirmation of a deliverable against the run's disposable PostgreSQL (ADR-0055 §6, §9, §10;
// REQ-S01-005 "A11;A17: marking the task complete leaves the deliverable Unconfirmed; a filename-only link does not
// confirm it; reviewed evidence or a test-adapter confirmation sets it and records the source"; p6-work-split §B/A.8;
// T-DG6-BE-O). Every request goes through the API except where a test says otherwise:
//  1. the four cases: (a) a completed task on the deliverable and the deliverable's DG3 acceptance leave it
//     Unconfirmed; (b) a filename-only link (file_reference) and an unverified note are refused 422 and leave it
//     Unconfirmed; (c) verified evidence confirms it, with the evidence id and the confirming user; (d) a confirmed
//     test-adapter outbound write confirms it, with the connector, source system id, reference, time and service
//     identity;
//  2. flag, change and withdraw only while unconfirmed; a confirmation never changes;
//  3. authorization: AUD 403 on both mutations (nothing written); TL may flag but not confirm; an outsider 404; the
//     commit-time re-check under the deliverableConfirmation lock (730314); evidence of another transformation 404;
//  4. If-Match: 428 missing, 409 stale, "0" creates the flag (and is stale once it exists); validation 400;
//  5. one audit event per change with prior and new version; the history is append-only and served.
// Every value is SYNTHETIC. The test adapter is the only downstream: nothing is "live" or "connected to Mobily".
// Confirming an external change is not a business approval (G1-G6), and nothing here touches DG0-DG7.
import { sql } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkItemOnce } from "../../../src/modules/tasks/index.ts";
import {
  auditOf,
  call,
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
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { createInitiative } from "../contract/p3-exercises-be-b.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let bo: { id: string; session: Session }; // BO @ the transformation: external_change.flag + external_change.confirm
let td: { id: string; session: Session }; // TD @ the transformation: external_change.confirm, outbound_write.execute
let admin: Session; // ADM_TECH @ A: configures the test connector
let outsider: Session; // TO @ B
let initiativeId: string;

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  const scope = { type: "transformation" as const, id: p.transformationId };
  const boUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, boUser.id, "BO", scope, w.orgA.id);
  const tdUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tdUser.id, "TD", scope, w.orgA.id);
  bo = { id: boUser.id, session: await signIn(api.app, boUser.subject) };
  td = { id: tdUser.id, session: await signIn(api.app, tdUser.subject) };
  admin = await signIn(api.app, w.admin.subject);
  outsider = await signIn(api.app, w.officeB.subject);
  const ini = await createInitiative(send, p, { executiveOwnerUserId: p.sponsor.id });
  initiativeId = ini.id;
}, 120_000);

afterAll(async () => {
  await api?.close();
});

// ------------------------------------------------------------------------------------------------ helpers

const C = (d: string) => `/api/v1/deliverables/${d}/confirmation`;
const X = (d: string) => `/api/v1/deliverables/${d}/external-change`;

async function deliverable(): Promise<string> {
  const res = await send("POST", `/api/v1/initiatives/${initiativeId}/deliverables`, {
    session: p.lead.session,
    body: { title: uniq("Synthetic external deliverable ") },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function flag(d: string, session: Session = p.contributor.session, changeType = "customer_system") {
  const res = await send("PUT", X(d), {
    session,
    headers: ifm(0),
    body: { isExternalChange: true, changeType, description: "Synthetic: the billing platform changes." },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function noteEvidence(verify: boolean): Promise<string> {
  const created = await send("POST", `${T}/evidence`, {
    session: p.lead.session,
    body: {
      kind: "note",
      title: uniq("Synthetic go-live record "),
      noteBody: "Synthetic: the change went live.",
      ownerUserId: p.lead.id,
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  if (verify) {
    const reviewed = await send("POST", `${T}/evidence/${id}/review`, {
      session: p.office.session,
      headers: ifm(1),
      body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: checked" },
    });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
  }
  return id;
}

async function fileReferenceEvidence(): Promise<string> {
  const created = await send("POST", `${T}/evidence`, {
    session: p.lead.session,
    body: {
      kind: "file_reference",
      title: uniq("Synthetic filename link "),
      fileName: "go-live-signoff.pdf",
      ownerUserId: p.lead.id,
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.id as string;
}

async function getState(d: string, session: Session = p.auditor.session) {
  const res = await send("GET", C(d), { session });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

async function flagRow(d: string) {
  return api.db
    .selectFrom("deliverable_external_change")
    .selectAll()
    .where("deliverable_id", "=", d)
    .executeTakeFirst();
}

/** A synthetic, enabled test-adapter connector of org A that may push deliverable statuses. */
async function testConnector(confirm: "immediate" | "never" = "immediate"): Promise<string> {
  const created = await send("POST", "/api/v1/admin/connectors", {
    session: admin,
    body: {
      organizationId: w.orgA.id,
      code: uniq("dx-").toLowerCase(),
      nameEn: "Synthetic customer system",
      nameAr: "نظام عملاء اصطناعي",
      adapterKind: "test_adapter",
      targetKind: "none",
      config: {
        sourceSystemId: "synthetic.customer-system:v1",
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: null,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: ["deliverable_status_push"],
        reconciliationRule: "none",
        adapterSettings: { mode: "healthy", confirm },
        reason: "Synthetic BE-O test connector.",
      },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const enabled = await send("POST", `/api/v1/admin/connectors/${created.body.id}/enable`, {
    session: admin,
    headers: ifm(1),
    body: { reason: null },
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  return created.body.id as string;
}

async function push(connectorId: string, d: string) {
  return send("POST", `${T}/outbound-writes`, {
    session: td.session,
    body: {
      connectorId,
      actionCode: "deliverable_status_push",
      deliverableId: d,
      idempotencyKey: uniq("be-o-key-"),
      payload: { status: "done" },
    },
  });
}

// ------------------------------------------------------------------------------------------------ 1. the four cases

describe("REQ-S01-005: only reviewed evidence or a confirmed connector result confirms an external change", () => {
  it("(a) a completed task on the deliverable and its DG3 acceptance leave it Unconfirmed", async () => {
    const d = await deliverable();
    const flagged = await flag(d);
    expect(flagged.externalChange).toMatchObject({ confirmationStatus: "unconfirmed", version: 1 });

    // A task on the deliverable, completed by its assignee (the tasks module's own service and route).
    const { workItemId } = await api.db.transaction().execute((tx) =>
      createWorkItemOnce(
        tx,
        { actorType: "service", actorUserId: null, requestId: `be-o-${uuidv7()}`, source: "worker" },
        {
          organizationId: w.orgA.id,
          transformationId: p.transformationId,
          kind: "gate_condition_due",
          assigneeUserId: p.lead.id,
          subjectType: "deliverable",
          subjectId: d,
          linkPath: `/deliverables/${d}`,
          messageKey: "tasks.synthetic",
          messageParams: {},
          dueDate: null,
          dedupeKey: `test.be-o:${uuidv7()}`,
        },
      ),
    );
    const done = await send("POST", `/api/v1/work-items/${workItemId}/complete`, {
      session: p.lead.session,
      headers: ifm(1),
      body: {},
    });
    expect([done.status, done.body.status], JSON.stringify(done.body)).toEqual([200, "done"]);

    // The DG3 acceptance: submitted by the lead, accepted by the initiative's executive owner.
    const submitted = await send("POST", `/api/v1/deliverables/${d}/submit`, {
      session: p.lead.session,
      headers: ifm(1),
      body: {},
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const accepted = await send("POST", `/api/v1/deliverables/${d}/acceptance`, {
      session: p.sponsor.session,
      headers: ifm(submitted.body.version),
      body: { result: "accepted" },
    });
    expect([accepted.status, accepted.body.acceptanceStatus], JSON.stringify(accepted.body)).toEqual([200, "accepted"]);

    const state = await getState(d);
    expect(state.headers["etag"]).toBe('"1"');
    expect(state.body.externalChange).toMatchObject({
      confirmationStatus: "unconfirmed",
      confirmationSource: null,
      evidenceId: null,
      outboundWriteId: null,
      confirmedAt: null,
      confirmedBy: null,
      version: 1,
    });
    expect((await flagRow(d))!.version).toBe(1);
  });

  it("(b) a filename-only link and an unverified note are refused 422 and leave it Unconfirmed", async () => {
    const d = await deliverable();
    await flag(d);
    const filename = await fileReferenceEvidence();
    const unverified = await noteEvidence(false);
    for (const evidenceId of [filename, unverified]) {
      const res = await send("POST", C(d), { session: bo.session, headers: ifm(1), body: { evidenceId, note: null } });
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        422,
        "external_change.evidence_not_verified",
        "Only reviewed (verified) evidence confirms an external change. A filename-only link never does.",
      ]);
    }
    const state = await getState(d);
    expect(state.body.externalChange).toMatchObject({ confirmationStatus: "unconfirmed", version: 1 });
    expect((await auditOf(api.db, state.body.externalChange.id)).map((a) => a.action)).toEqual([
      "deliverable_external_change.flagged",
    ]);
  });

  it("(c) reviewed (verified) evidence confirms it with the evidence id and the confirming user", async () => {
    const d = await deliverable();
    await flag(d);
    const evidenceId = await noteEvidence(true);
    const res = await send("POST", C(d), {
      session: bo.session,
      headers: ifm(1),
      body: { evidenceId, note: "Synthetic: go-live record reviewed." },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["etag"]).toBe('"2"');
    expect(res.body.externalChange).toMatchObject({
      confirmationStatus: "confirmed",
      confirmationSource: "reviewed_evidence",
      evidenceId,
      confirmedBy: bo.id,
      confirmationNote: "Synthetic: go-live record reviewed.",
      outboundWriteId: null,
      connectorId: null,
      version: 2,
    });
    expect(typeof res.body.externalChange.confirmedAt).toBe("string");
    expect(
      res.body.externalChange.events.map((e: Body) => [e.recordVersion, e.confirmationStatus, e.actorUserId]),
    ).toEqual([
      [1, "unconfirmed", p.contributor.id],
      [2, "confirmed", bo.id],
    ]);
    const audit = await auditOf(api.db, res.body.externalChange.id);
    expect(audit.map((a) => [a.action, a.prior_version, a.new_version, a.actor_user_id])).toEqual([
      ["deliverable_external_change.flagged", null, 1, p.contributor.id],
      ["deliverable_external_change.confirmed", 1, 2, bo.id],
    ]);
  });

  it("(d) a confirmed test-adapter outbound write confirms it with connector, source system id, reference and time", async () => {
    const d = await deliverable();
    await flag(d, bo.session, "network_upgrade");
    const connectorId = await testConnector();
    const write = await push(connectorId, d);
    expect([write.status, write.body.status], JSON.stringify(write.body)).toEqual([201, "confirmed"]);

    const state = await getState(d);
    expect(state.headers["etag"]).toBe('"2"');
    const x = state.body.externalChange;
    expect(x).toMatchObject({
      confirmationStatus: "confirmed",
      confirmationSource: "connector_result",
      outboundWriteId: write.body.id,
      connectorId,
      sourceSystemId: "synthetic.customer-system:v1",
      sourceReference: write.body.externalReference,
      sourceConfirmedAt: write.body.confirmedAt,
      evidenceId: null,
      confirmedBy: null,
      version: 2,
    });
    const identity = await api.db
      .selectFrom("service_identity")
      .select("id")
      .where("connector_id", "=", connectorId)
      .executeTakeFirstOrThrow();
    expect(x.serviceIdentityId).toBe(identity.id);
    expect(typeof x.confirmedAt).toBe("string");
    const audit = await auditOf(api.db, x.id);
    expect(audit.map((a) => [a.action, a.actor_type, a.actor_user_id, a.on_behalf_of_user_id])).toEqual([
      ["deliverable_external_change.flagged", "user", bo.id, null],
      ["deliverable_external_change.confirmed", "service", null, td.id],
    ]);
    // The confirmation never changes afterwards.
    const again = await send("POST", C(d), {
      session: bo.session,
      headers: ifm(2),
      body: { evidenceId: await noteEvidence(true), note: null },
    });
    expect([again.status, again.body.code]).toEqual([409, "external_change.already_confirmed"]);
  });

  it("a write without confirmation (confirm: never) leaves it Unconfirmed; an unflagged deliverable stays unflagged", async () => {
    const d = await deliverable();
    await flag(d);
    const pending = await push(await testConnector("never"), d);
    expect([pending.status, pending.body.status]).toEqual([201, "pending_confirmation"]);
    expect((await getState(d)).body.externalChange).toMatchObject({ confirmationStatus: "unconfirmed", version: 1 });

    const plain = await deliverable();
    const confirmed = await push(await testConnector(), plain);
    expect(confirmed.body.status).toBe("confirmed");
    const state = await getState(plain);
    expect([state.headers["etag"], state.body.externalChange]).toEqual(['"0"', null]);
    expect(await flagRow(plain)).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------ 2. flag lifecycle

describe("flag, change and withdraw only while unconfirmed", () => {
  it("never flagged: GET 200 with null and ETag 0; flag, change, withdraw, re-flag, each audited once", async () => {
    const d = await deliverable();
    const none = await getState(d);
    expect([none.headers["etag"], none.body]).toEqual([
      '"0"',
      { deliverableId: d, transformationId: p.transformationId, externalChange: null },
    ]);
    // Withdrawing a flag that does not exist is refused.
    const nothing = await send("PUT", X(d), {
      session: p.lead.session,
      headers: ifm(0),
      body: { isExternalChange: false, changeType: "other", description: "Synthetic" },
    });
    expect([nothing.status, nothing.body.code]).toEqual([409, "external_change.not_flagged"]);

    const flagged = await flag(d, p.lead.session);
    const id = flagged.externalChange.id as string;
    const changed = await send("PUT", X(d), {
      session: p.office.session,
      headers: ifm(1),
      body: { isExternalChange: true, changeType: "procurement_transaction", description: null },
    });
    expect([changed.status, changed.headers["etag"], changed.body.externalChange.changeType]).toEqual([
      200,
      '"2"',
      "procurement_transaction",
    ]);
    // The same request again changes nothing and writes nothing.
    const same = await send("PUT", X(d), {
      session: p.office.session,
      headers: ifm(2),
      body: { isExternalChange: true, changeType: "procurement_transaction", description: null },
    });
    expect([same.status, same.headers["etag"]]).toEqual([200, '"2"']);
    const withdrawn = await send("PUT", X(d), {
      session: bo.session,
      headers: ifm(2),
      body: { isExternalChange: false, changeType: "procurement_transaction", description: null },
    });
    expect([withdrawn.status, withdrawn.body.externalChange.isExternalChange]).toEqual([200, false]);
    // A withdrawn flag cannot be confirmed.
    const refused = await send("POST", C(d), {
      session: bo.session,
      headers: ifm(3),
      body: { evidenceId: await noteEvidence(true), note: null },
    });
    expect([refused.status, refused.body.code]).toEqual([409, "external_change.not_flagged"]);
    const reflagged = await send("PUT", X(d), {
      session: bo.session,
      headers: ifm(3),
      body: { isExternalChange: true, changeType: "procurement_transaction", description: null },
    });
    expect([reflagged.status, reflagged.body.externalChange.version]).toEqual([200, 4]);
    expect((await auditOf(api.db, id)).map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["deliverable_external_change.flagged", null, 1],
      ["deliverable_external_change.changed", 1, 2],
      ["deliverable_external_change.withdrawn", 2, 3],
      ["deliverable_external_change.flagged", 3, 4],
    ]);
    expect(reflagged.body.externalChange.events.map((e: Body) => e.recordVersion)).toEqual([1, 2, 3, 4]);
  });

  it("a confirmed change cannot be withdrawn (409 withdraw_confirmed) or changed (409 already_confirmed)", async () => {
    const d = await deliverable();
    await flag(d);
    const ok = await send("POST", C(d), {
      session: td.session,
      headers: ifm(1),
      body: { evidenceId: await noteEvidence(true), note: null },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const withdraw = await send("PUT", X(d), {
      session: bo.session,
      headers: ifm(2),
      body: { isExternalChange: false, changeType: "customer_system", description: null },
    });
    expect([withdraw.status, withdraw.body.code, withdraw.body.detail]).toEqual([
      409,
      "external_change.withdraw_confirmed",
      "A confirmed external change cannot be withdrawn.",
    ]);
    const change = await send("PUT", X(d), {
      session: bo.session,
      headers: ifm(2),
      body: { isExternalChange: true, changeType: "network_upgrade", description: null },
    });
    expect([change.status, change.body.code]).toEqual([409, "external_change.already_confirmed"]);
    expect((await flagRow(d))!.version).toBe(2);
  });

  it("the database refuses a direct change of a confirmed row (0106 guard)", async () => {
    const d = await deliverable();
    await flag(d);
    await send("POST", C(d), {
      session: bo.session,
      headers: ifm(1),
      body: { evidenceId: await noteEvidence(true), note: null },
    });
    await expect(
      api.owner.query(
        `update deliverable_external_change set is_external_change = false, version = version + 1 where deliverable_id = $1`,
        [d],
      ),
    ).rejects.toThrow(/never changes/);
  });
});

// ------------------------------------------------------------------------------------------------ 3. authorization

describe("authorization", () => {
  it("AUD reads but gets 403 on both mutations, and nothing is written", async () => {
    const d = await deliverable();
    const put = await send("PUT", X(d), {
      session: p.auditor.session,
      headers: ifm(0),
      body: { isExternalChange: true, changeType: "customer_system", description: null },
    });
    expect(put.status).toBe(403);
    expect(await flagRow(d)).toBeUndefined();
    await flag(d);
    const confirm = await send("POST", C(d), {
      session: p.auditor.session,
      headers: ifm(1),
      body: { evidenceId: await noteEvidence(true), note: null },
    });
    expect(confirm.status).toBe(403);
    expect((await flagRow(d))!.confirmation_status).toBe("unconfirmed");
    expect((await getState(d, p.auditor.session)).status).toBe(200);
  });

  it("TL, WL and SP may not confirm (403); SP may not flag (403); an outsider gets 404 on every operation", async () => {
    const d = await deliverable();
    const spFlag = await send("PUT", X(d), {
      session: p.sponsor.session,
      headers: ifm(0),
      body: { isExternalChange: true, changeType: "customer_system", description: null },
    });
    expect(spFlag.status).toBe(403);
    await flag(d);
    const evidenceId = await noteEvidence(true);
    for (const s of [p.lead.session, p.contributor.session, p.sponsor.session]) {
      const res = await send("POST", C(d), { session: s, headers: ifm(1), body: { evidenceId, note: null } });
      expect(res.status).toBe(403);
    }
    expect((await send("GET", C(d), { session: outsider })).status).toBe(404);
    expect(
      (
        await send("PUT", X(d), {
          session: outsider,
          headers: ifm(1),
          body: { isExternalChange: false, changeType: "customer_system", description: null },
        })
      ).status,
    ).toBe(404);
    expect(
      (await send("POST", C(d), { session: outsider, headers: ifm(1), body: { evidenceId, note: null } })).status,
    ).toBe(404);
    expect((await send("GET", C(crypto.randomUUID()), { session: bo.session })).status).toBe(404);
    expect((await send("GET", C(d))).status).toBe(401);
    expect((await flagRow(d))!.version).toBe(1);
  });

  it("evidence of another transformation (or unknown) is 404 and confirms nothing", async () => {
    const d = await deliverable();
    await flag(d);
    const other = await setupP2World(api, w);
    const created = await send("POST", `/api/v1/transformations/${other.transformationId}/evidence`, {
      session: other.lead.session,
      body: { kind: "note", title: "Synthetic other evidence", noteBody: "Synthetic", ownerUserId: other.lead.id },
    });
    expect(created.status).toBe(201);
    for (const evidenceId of [created.body.id as string, crypto.randomUUID()]) {
      const res = await send("POST", C(d), { session: bo.session, headers: ifm(1), body: { evidenceId, note: null } });
      expect(res.status).toBe(404);
    }
    expect((await flagRow(d))!.confirmation_status).toBe("unconfirmed");
  });

  it("the commit-time re-check: a right lost while the request waits on the lock is 403 and nothing is written", async () => {
    const d = await deliverable();
    await flag(d);
    const evidenceId = await noteEvidence(true);
    const user = await createUser(api.db, w.orgA.id);
    const assignment = await grant(
      api.db,
      w.grantor.id,
      user.id,
      "BO",
      { type: "transformation", id: p.transformationId },
      w.orgA.id,
    );
    const session = await signIn(api.app, user.subject);
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = api.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(730314, hashtext(${d}::text))`.execute(tx);
      locked();
      await gate;
    });
    await isLocked;
    const pending = send("POST", C(d), { session, headers: ifm(1), body: { evidenceId, note: null } });
    await new Promise((r) => setTimeout(r, 300));
    await api.owner.query(
      `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE-O revoke' where id = $2`,
      [w.grantor.id, assignment],
    );
    release();
    await holder;
    const res = await pending;
    expect(res.status).toBe(403);
    expect((await flagRow(d))!.confirmation_status).toBe("unconfirmed");
  });
});

// ------------------------------------------------------------------------------------------------ 4. If-Match, validation

describe("If-Match and validation", () => {
  it('428 without If-Match; 409 when stale (including "0" once flagged); 400 on invalid bodies', async () => {
    const d = await deliverable();
    const body = { isExternalChange: true, changeType: "customer_system", description: null };
    expect((await send("PUT", X(d), { session: bo.session, body })).status).toBe(428);
    expect((await send("PUT", X(d), { session: bo.session, headers: ifm(1), body })).status).toBe(409);
    await flag(d);
    const zero = await send("PUT", X(d), { session: bo.session, headers: ifm(0), body });
    expect([zero.status, zero.body.currentVersion]).toEqual([409, 1]);
    const stale = await send("PUT", X(d), { session: bo.session, headers: ifm(5), body });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const evidenceId = await noteEvidence(true);
    expect((await send("POST", C(d), { session: bo.session, body: { evidenceId, note: null } })).status).toBe(428);
    expect(
      (await send("POST", C(d), { session: bo.session, headers: ifm(4), body: { evidenceId, note: null } })).status,
    ).toBe(409);
    for (const bad of [
      { ...body, changeType: "other", description: null }, // other needs a description
      { ...body, changeType: "network" },
      { ...body, description: "\u0000" },
      { ...body, extra: 1 },
      { isExternalChange: true, changeType: "customer_system" },
    ])
      expect((await send("PUT", X(d), { session: bo.session, headers: ifm(1), body: bad })).status).toBe(400);
    for (const bad of [{ evidenceId, note: "ab" }, { evidenceId: "nope", note: null }, { evidenceId }])
      expect((await send("POST", C(d), { session: bo.session, headers: ifm(1), body: bad })).status).toBe(400);
    expect((await flagRow(d))!.version).toBe(1);
  });

  it("two concurrent flags of the same deliverable: one creates it, the other is 409, one row", async () => {
    const d = await deliverable();
    const body = { isExternalChange: true, changeType: "customer_system", description: null };
    const results = await Promise.all([
      send("PUT", X(d), { session: bo.session, headers: ifm(0), body }),
      send("PUT", X(d), { session: p.lead.session, headers: ifm(0), body }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await api.db
      .selectFrom("deliverable_external_change")
      .select("id")
      .where("deliverable_id", "=", d)
      .execute();
    expect(rows).toHaveLength(1);
  });
});
