// Guarded outbound writes against the run's disposable PostgreSQL (ADR-0055 §5, §9, §10; REQ-S17-006 "A13;A12:
// replaying an outbound write with the same key produces one downstream effect; a write without confirmation stays
// 'pending confirmation'"; p6-work-split §B/A.7; T-DG6-BE-N2). Every request goes through the API except where a test
// says otherwise:
//  1. a healthy test-adapter connector: 201 `confirmed` with the adapter's reference, ONE downstream effect, the audit
//     events requested + confirmed and the status history; the same key and payload (keys in another order) -> 200, the
//     same write, no new row, no new effect, no new audit event; another payload under the key -> 409;
//  2. A13 crash between the steps (the dispatch happened, transaction 2 did not): the write stays `requested`; a replay
//     returns it without dispatching; confirmOutboundWrite re-dispatches with the same key -> `confirmed`, and the test
//     adapter still counts ONE effect; a crash during a confirm leaves it as it was and the next confirm finishes it;
//  3. `confirm: never` -> `pending_confirmation` (confirmedAt and reference null), and a confirm keeps it pending (no
//     change, no audit); `stopped` -> pending; `failing` (the adapter throws) -> pending; never `confirmed`;
//  4. confirmed and failed writes never change (409 outbound_write.final; the database guard too);
//  5. authorization: without outbound_write.execute -> 403 (KDS, ADM_TECH, AUD) on execute and confirm, and nothing is
//     written; an outsider 404; reading needs outbound_write.read (TL 403; AUD and TO read); the commit-time re-check;
//  6. refusals: an action the current configuration does not list -> 422; a disabled connector -> 409; unknown
//     deliverable or connector -> 404; If-Match 428/409 on confirm; the payload rules (16 KiB 400, a secret-like key 422,
//     an invalid character 400);
//  7. no remote I/O inside a transaction: during the dispatch the write is committed and the outboundWrite lock is free;
//  8. the connector-confirmation port (BE-O, REQ-S01-005) is called once, inside transaction 2, on `confirmed`.
// Every value is SYNTHETIC. The test adapter is the only downstream: nothing is "live" or "connected to Mobily". A
// write approves nothing (G1-G6) and nothing here touches DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createConnectorAdapterRegistry,
  setConnectorAdapters,
  type ConnectorAdapter,
} from "../../../src/modules/integrations/adapters/port.ts";
import { testAdapterEffects, testExternalReference } from "../../../src/modules/integrations/adapters/test-adapter.ts";
import {
  canonicalJson,
  payloadSha256,
  setOutboundConfirmationPort,
  setOutboundCrashHook,
  type OutboundConfirmedWrite,
} from "../../../src/modules/integrations/outbound.ts";
import { testAdapter } from "../../../src/modules/integrations/adapters/test-adapter.ts";
import {
  auditOf,
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
import { insertDeliverable, insertInitiative, type BenefitWorld } from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let transformationId: string;
let deliverableId: string;
let base: string;
let td: Session; // TD @ the transformation: outbound_write.read + outbound_write.execute
let tdUserId: string;
let admin: Session; // ADM_TECH (+ ADM_ACCESS) @ A: configures connectors; cannot read the transformation (no inheritance)
let tech: Session; // ADM_TECH @ the transformation: reads it, holds no outbound_write code
let kds: Session; // KDS @ the transformation: outbound_write.read only
let auditor: Session; // AUD @ A: outbound_write.read only
let office: Session; // TO @ A: outbound_write.read only
let lead: Session; // TL @ the transformation: reads it, holds no outbound_write code
let outsider: Session; // TO @ B

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  base = `/api/v1/transformations/${transformationId}/outbound-writes`;
  const tl = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tl.id, "TL", { type: "transformation", id: transformationId }, w.orgA.id);
  // The P3 fixtures write the initiative and the deliverable directly, with their audit events (synthetic).
  const fixture = { organizationId: w.orgA.id, transformationId, users: { tl } } as unknown as BenefitWorld;
  deliverableId = await insertDeliverable(api.db, fixture, await insertInitiative(api.db, fixture));
  const tdUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tdUser.id, "TD", { type: "transformation", id: transformationId }, w.orgA.id);
  tdUserId = tdUser.id;
  const kdsUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, kdsUser.id, "KDS", { type: "transformation", id: transformationId }, w.orgA.id);
  const techUser = await createUser(api.db, w.orgA.id);
  await grant(
    api.db,
    w.grantor.id,
    techUser.id,
    "ADM_TECH",
    { type: "transformation", id: transformationId },
    w.orgA.id,
  );
  [td, admin, tech, kds, auditor, office, lead, outsider] = await Promise.all([
    signIn(api.app, tdUser.subject),
    signIn(api.app, w.admin.subject),
    signIn(api.app, techUser.subject),
    signIn(api.app, kdsUser.subject),
    signIn(api.app, w.auditor.subject),
    signIn(api.app, w.office.subject),
    signIn(api.app, tl.subject),
    signIn(api.app, w.officeB.subject),
  ]);
}, 120_000);

afterAll(async () => {
  setOutboundCrashHook(null);
  await api?.close();
});

// ------------------------------------------------------------------------------------------------ helpers

const ifm = (v: number) => ({ "if-match": `"${v}"` });

interface ConnectorOptions {
  mode?: "healthy" | "failing" | "stopped";
  confirm?: "immediate" | "never";
  outboundActions?: string[];
  enabled?: boolean;
}

/** A synthetic test-adapter connector of org A (target none), created and enabled by the ADM_TECH administrator. */
async function connector(o: ConnectorOptions = {}): Promise<string> {
  const created = await call<Body>(api.app, "POST", "/api/v1/admin/connectors", {
    session: admin,
    body: {
      organizationId: w.orgA.id,
      code: uniq("ow-").toLowerCase(),
      nameEn: "Synthetic downstream",
      nameAr: "نظام لاحق اصطناعي",
      adapterKind: "test_adapter",
      targetKind: "none",
      config: {
        sourceSystemId: "synthetic.downstream:v1",
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: null,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: o.outboundActions ?? ["deliverable_status_push"],
        reconciliationRule: "none",
        adapterSettings: { mode: o.mode ?? "healthy", ...(o.confirm ? { confirm: o.confirm } : {}) },
        reason: "Synthetic downstream for the BE-N2 suite.",
      },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  if (o.enabled !== false) {
    const enabled = await call<Body>(api.app, "POST", `/api/v1/admin/connectors/${created.body.id}/enable`, {
      session: admin,
      headers: ifm(1),
      body: { reason: null },
    });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  }
  return created.body.id as string;
}

const payload = { status: "accepted", note: "Synthetic status push", detail: { step: 1, flags: ["a", "b"] } };

function execute(
  session: Session | null,
  connectorId: string,
  idempotencyKey: string,
  over: Record<string, unknown> = {},
  opts: { contract?: boolean } = {},
) {
  return call<Body>(api.app, "POST", base, {
    session,
    body: { connectorId, actionCode: "deliverable_status_push", deliverableId, idempotencyKey, payload, ...over },
    ...opts,
  });
}

function confirm(session: Session | null, writeId: string, headers: Record<string, string> = {}, body: unknown = {}) {
  return call<Body>(api.app, "POST", `${base}/${writeId}/confirm`, { session, headers, body });
}

const key = () => uniq("ow-key-");

async function writesOf(connectorId: string) {
  return api.db.selectFrom("outbound_write").selectAll().where("connector_id", "=", connectorId).execute();
}

// ------------------------------------------------------------------------------------------------ 1. one effect per key

describe("executeOutboundWrite: a confirmed write and its replay (A13)", () => {
  it("confirms on the adapter's confirmed response with its reference: one effect, audited, with its history", async () => {
    const id = await connector();
    const k = key();
    const res = await execute(td, id, k);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const write = res.body;
    expect(res.headers["location"]).toBe(`${base}/${write.id}`);
    expect(res.headers["etag"]).toBe(`"${write.version}"`);
    expect(write).toMatchObject({
      transformationId,
      connectorId: id,
      configVersionNo: 1,
      actionCode: "deliverable_status_push",
      deliverableId,
      idempotencyKey: k,
      payloadSha256: payloadSha256(payload),
      status: "confirmed",
      attemptCount: 1,
      externalReference: testExternalReference(k),
      failureCode: null,
      failureMessage: null,
      requestedBy: tdUserId,
      version: 2,
    });
    expect(write.confirmedAt).not.toBeNull();
    expect(write.lastAttemptAt).not.toBeNull();
    expect(write.payload).toEqual(payload);
    expect(testAdapterEffects(id, k)).toBe(1);

    const events = await auditOf(api.db, write.id);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version, e.actor_user_id])).toEqual([
      ["outbound_write.requested", null, 1, tdUserId],
      ["outbound_write.confirmed", 1, 2, tdUserId],
    ]);
    expect(events.every((e) => e.transformation_id === transformationId)).toBe(true);

    // The write acts as its connector's own service identity.
    const row = (await writesOf(id))[0]!;
    const identity = await api.db
      .selectFrom("service_identity")
      .select("id")
      .where("connector_id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.service_identity_id).toBe(identity.id);

    const detail = await call<Body>(api.app, "GET", `${base}/${write.id}`, { session: td });
    expect(detail.status).toBe(200);
    expect(detail.headers["etag"]).toBe('"2"');
    expect(detail.body.write).toEqual(write);
    expect(detail.body.events.map((e: Body) => [e.recordVersion, e.status, e.attemptCount])).toEqual([
      [1, "requested", 0],
      [2, "confirmed", 1],
    ]);
    expect(detail.body.events[1].externalReference).toBe(testExternalReference(k));
  });

  it("replays the same key and payload (keys in another order) with 200: the same write, no new row, effect or audit", async () => {
    const id = await connector();
    const k = key();
    const first = await execute(td, id, k);
    expect(first.status).toBe(201);
    const auditBefore = (await auditOf(api.db, first.body.id)).length;
    const reordered = { detail: { flags: ["a", "b"], step: 1 }, note: payload.note, status: payload.status };
    expect(canonicalJson(reordered)).toBe(canonicalJson(payload));
    for (const p of [payload, reordered]) {
      const again = await execute(td, id, k, { payload: p });
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.headers["location"]).toBeUndefined();
      expect(again.body).toEqual(first.body);
    }
    expect(await writesOf(id)).toHaveLength(1);
    expect(testAdapterEffects(id, k)).toBe(1);
    expect(await auditOf(api.db, first.body.id)).toHaveLength(auditBefore);
  });

  it("refuses another request under a used key with 409 outbound_write.idempotency_key_reused", async () => {
    const id = await connector();
    const k = key();
    expect((await execute(td, id, k)).status).toBe(201);
    const other = await execute(td, id, k, { payload: { ...payload, status: "rejected" } });
    expect([other.status, other.body.code, other.body.detail]).toEqual([
      409,
      "outbound_write.idempotency_key_reused",
      "This idempotency key was already used for a different request.",
    ]);
    expect(await writesOf(id)).toHaveLength(1);
    expect(testAdapterEffects(id, k)).toBe(1);
    // The same key on another connector is another write.
    const id2 = await connector();
    expect((await execute(td, id2, k)).status).toBe(201);
  });
});

// ------------------------------------------------------------------------------------------------ 2. crash between steps

describe("a crash between the steps (A13)", () => {
  it("leaves the write requested; a replay does not dispatch; confirm re-dispatches with the same key: one effect", async () => {
    const id = await connector();
    const k = key();
    let hits = 0;
    const previous = setOutboundCrashHook(() => {
      hits += 1;
      throw new Error("synthetic crash between the dispatch and transaction 2");
    });
    let crashed;
    try {
      crashed = await execute(td, id, k, {}, { contract: false });
    } finally {
      setOutboundCrashHook(previous);
    }
    expect(crashed.status).toBe(500);
    expect(hits).toBe(1);
    // The dispatch happened (the downstream has its one effect); the write is still requested, never done.
    expect(testAdapterEffects(id, k)).toBe(1);
    const [row] = await writesOf(id);
    expect([row!.status, row!.attempt_count, row!.version, row!.confirmed_at]).toEqual(["requested", 0, 1, null]);

    // The same request again: the existing write, as it is; no dispatch.
    const replay = await execute(td, id, k);
    expect([replay.status, replay.body.id, replay.body.status]).toEqual([200, row!.id, "requested"]);
    expect(testAdapterEffects(id, k)).toBe(1);

    // confirm re-dispatches with the same key: the downstream deduplicates, the write is confirmed.
    const confirmed = await confirm(td, row!.id, ifm(1));
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.headers["etag"]).toBe('"2"');
    expect(confirmed.body.write).toMatchObject({
      status: "confirmed",
      attemptCount: 1,
      externalReference: testExternalReference(k),
      version: 2,
    });
    expect(testAdapterEffects(id, k)).toBe(1);
    expect((await auditOf(api.db, row!.id)).map((e) => e.action)).toEqual([
      "outbound_write.requested",
      "outbound_write.confirmed",
    ]);
  });

  it("a crash during a confirm leaves the write as it was, and the next confirm finishes it (still one effect)", async () => {
    const id = await connector();
    const k = key();
    const previous = setOutboundCrashHook(() => {
      throw new Error("synthetic crash");
    });
    try {
      expect((await execute(td, id, k, {}, { contract: false })).status).toBe(500);
      const [row] = await writesOf(id);
      const res = await call<Body>(api.app, "POST", `${base}/${row!.id}/confirm`, {
        session: td,
        headers: ifm(1),
        body: {},
        contract: false,
      });
      expect(res.status).toBe(500);
    } finally {
      setOutboundCrashHook(previous);
    }
    const [row] = await writesOf(id);
    expect([row!.status, row!.version]).toEqual(["requested", 1]);
    const done = await confirm(td, row!.id, ifm(1));
    expect([done.status, done.body.write.status]).toEqual([200, "confirmed"]);
    expect(testAdapterEffects(id, k)).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------ 3. pending confirmation

describe("a write without confirmation stays pending confirmation (A12)", () => {
  it("confirm: never -> pending_confirmation; a confirm keeps it pending without a change or an audit event", async () => {
    const id = await connector({ confirm: "never" });
    const k = key();
    const res = await execute(td, id, k);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "pending_confirmation",
      attemptCount: 1,
      externalReference: null,
      confirmedAt: null,
      failureCode: null,
      version: 2,
    });
    expect(testAdapterEffects(id, k)).toBe(1);
    const audits = (await auditOf(api.db, res.body.id)).map((e) => e.action);
    expect(audits).toEqual(["outbound_write.requested", "outbound_write.pending_confirmation"]);

    for (let i = 0; i < 2; i += 1) {
      const again = await confirm(td, res.body.id, ifm(2));
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body.write).toMatchObject({ status: "pending_confirmation", version: 2, attemptCount: 1 });
    }
    expect(await auditOf(api.db, res.body.id)).toHaveLength(2);
    expect(testAdapterEffects(id, k)).toBe(1);

    const list = await call<Body>(api.app, "GET", `${base}?status=pending_confirmation&limit=50`, { session: td });
    expect(list.status).toBe(200);
    expect(list.body.items.map((x: Body) => x.id)).toContain(res.body.id);
    const done = await call<Body>(api.app, "GET", `${base}?status=confirmed&limit=50`, { session: td });
    expect(done.body.items.map((x: Body) => x.id)).not.toContain(res.body.id);
  });

  it("a stopped adapter (no response) and a failing adapter (it throws) leave the write pending, never confirmed", async () => {
    for (const mode of ["stopped", "failing"] as const) {
      const id = await connector({ mode });
      const res = await execute(td, id, key());
      expect(res.status, mode).toBe(201);
      expect([res.body.status, res.body.attemptCount, res.body.confirmedAt], mode).toEqual([
        "pending_confirmation",
        1,
        null,
      ]);
      const again = await confirm(td, res.body.id, ifm(2));
      expect([again.status, again.body.write.status], mode).toEqual([200, "pending_confirmation"]);
    }
  });
});

// ------------------------------------------------------------------------------------------------ 4. final rows

describe("confirmed and failed writes never change", () => {
  it("a confirmed write: 409 outbound_write.final, and the database guard refuses a direct change", async () => {
    const id = await connector();
    const res = await execute(td, id, key());
    const final = await confirm(td, res.body.id, ifm(2));
    expect([final.status, final.body.code, final.body.detail]).toEqual([
      409,
      "outbound_write.final",
      "This write is already confirmed or failed and cannot change.",
    ]);
    await expect(
      sql`UPDATE outbound_write SET status = 'failed', failure_code = 'synthetic', version = version + 1 WHERE id = ${res.body.id}`.execute(
        api.db,
      ),
    ).rejects.toThrow(/never changes/);
  });

  it("a definitive rejection -> failed with its code; then 409 outbound_write.final", async () => {
    const id = await connector();
    const rejecting: ConnectorAdapter = {
      ...testAdapter,
      dispatch: async () => ({ outcome: "rejected", failureCode: "downstream.status_refused" }),
    };
    const previous = setConnectorAdapters(createConnectorAdapterRegistry([rejecting]));
    let res;
    try {
      res = await execute(td, id, key());
    } finally {
      setConnectorAdapters(previous);
    }
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "failed",
      failureCode: "downstream.status_refused",
      confirmedAt: null,
      externalReference: null,
    });
    expect((await auditOf(api.db, res.body.id)).map((e) => e.action)).toEqual([
      "outbound_write.requested",
      "outbound_write.failed",
    ]);
    const final = await confirm(td, res.body.id, ifm(2));
    expect([final.status, final.body.code]).toEqual([409, "outbound_write.final"]);
  });

  it("a confirmed answer without a usable reference is no confirmation (pending)", async () => {
    const id = await connector();
    const blank: ConnectorAdapter = {
      ...testAdapter,
      dispatch: async () => ({ outcome: "confirmed", externalReference: "" }),
    };
    const previous = setConnectorAdapters(createConnectorAdapterRegistry([blank]));
    try {
      const res = await execute(td, id, key());
      expect([res.status, res.body.status, res.body.externalReference]).toEqual([201, "pending_confirmation", null]);
    } finally {
      setConnectorAdapters(previous);
    }
  });
});

// ------------------------------------------------------------------------------------------------ 5. authorization

describe("authorization (outbound_write.execute: TD only; outbound_write.read)", () => {
  it("KDS, ADM_TECH and AUD get 403 on execute and confirm; nothing is written or dispatched", async () => {
    const id = await connector();
    for (const session of [kds, tech, auditor]) {
      const k = key();
      const res = await execute(session, id, k);
      expect([res.status, res.body.code]).toEqual([403, "forbidden"]);
      expect(testAdapterEffects(id, k)).toBe(0);
    }
    expect(await writesOf(id)).toHaveLength(0);
    const pending = await connector({ confirm: "never" });
    const write = (await execute(td, pending, key())).body;
    for (const session of [kds, tech, auditor]) {
      const res = await confirm(session, write.id, ifm(2));
      expect(res.status).toBe(403);
    }
    expect(await auditOf(api.db, write.id)).toHaveLength(2);
    // The organization-level administrator who configured the connector (SoD: it never executes by default) and an
    // outsider hold the code nowhere: 403 as well, whatever the transformation, and still nothing written.
    for (const session of [admin, outsider]) {
      expect((await execute(session, id, key())).status).toBe(403);
      expect((await confirm(session, write.id, ifm(2))).status).toBe(403);
    }
    expect(await writesOf(id)).toHaveLength(0);
  });

  it("outsiders get 404 on reads, a TD elsewhere 404 on writes; a reader without outbound_write.read 403; AUD, TO, KDS read", async () => {
    const id = await connector({ confirm: "never" });
    const write = (await execute(td, id, key())).body;
    // A TD of another transformation holds the code, but not here: 404 (existence not disclosed, DG2).
    const elsewhere = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const otherTd = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, otherTd.id, "TD", { type: "transformation", id: elsewhere }, w.orgA.id);
    const otherTdSession = await signIn(api.app, otherTd.subject);
    expect((await execute(otherTdSession, id, key())).status).toBe(404);
    expect((await confirm(otherTdSession, write.id, ifm(2))).status).toBe(404);
    expect((await call(api.app, "GET", `${base}/${write.id}`, { session: otherTdSession })).status).toBe(404);
    expect((await call(api.app, "GET", base, { session: outsider })).status).toBe(404);
    expect((await call(api.app, "GET", `${base}/${write.id}`, { session: outsider })).status).toBe(404);
    expect((await call(api.app, "GET", base, { session: lead })).status).toBe(403);
    expect((await call(api.app, "GET", `${base}/${write.id}`, { session: lead })).status).toBe(403);
    expect((await execute(lead, id, key())).status).toBe(403);
    for (const session of [auditor, office, kds]) {
      const one = await call<Body>(api.app, "GET", `${base}/${write.id}`, { session });
      expect([one.status, one.body.write.status]).toEqual([200, "pending_confirmation"]);
      const list = await call<Body>(api.app, "GET", `${base}?deliverableId=${deliverableId}&limit=100`, { session });
      expect(list.status).toBe(200);
    }
  });

  it("the commit-time re-check: a right lost while the request waits is 403 and nothing is written", async () => {
    const id = await connector();
    const k = key();
    const user = await createUser(api.db, w.orgA.id);
    const assignment = await grant(
      api.db,
      w.grantor.id,
      user.id,
      "TD",
      { type: "transformation", id: transformationId },
      w.orgA.id,
    );
    const session = await signIn(api.app, user.subject);
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = api.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(730313, hashtext(${`${id}:${k}`}::text))`.execute(tx);
      locked();
      await gate;
    });
    await isLocked;
    const pending = execute(session, id, k);
    await new Promise((r) => setTimeout(r, 300));
    await api.owner.query(
      `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE-N2 revoke' where id = $2`,
      [w.grantor.id, assignment],
    );
    release();
    await holder;
    const res = await pending;
    expect(res.status).toBe(403);
    expect(await writesOf(id)).toHaveLength(0);
    expect(testAdapterEffects(id, k)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ 6. refusals

describe("refusals", () => {
  it("an action the current configuration does not list -> 422; a disabled connector -> 409 connector.disabled", async () => {
    const none = await connector({ outboundActions: [] });
    const refused = await execute(td, none, key());
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([
      422,
      "outbound_write.action_not_allowed",
      "The connector's current configuration does not allow this action.",
    ]);
    const disabled = await connector({ enabled: false });
    const res = await execute(td, disabled, key());
    expect([res.status, res.body.code]).toEqual([409, "connector.disabled"]);
    expect([...(await writesOf(none)), ...(await writesOf(disabled))]).toHaveLength(0);
  });

  it("a replay still answers after the connector is disabled (no dispatch); a new key is refused", async () => {
    const id = await connector();
    const k = key();
    const first = await execute(td, id, k);
    const off = await call<Body>(api.app, "POST", `/api/v1/admin/connectors/${id}/disable`, {
      session: admin,
      headers: ifm(2),
      body: { reason: "Synthetic: downstream retired" },
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const replay = await execute(td, id, k);
    expect([replay.status, replay.body.id]).toEqual([200, first.body.id]);
    expect((await execute(td, id, key())).status).toBe(409);
  });

  it("unknown deliverable, connector or write -> 404; a connector of another organization -> 404", async () => {
    const id = await connector();
    expect((await execute(td, id, key(), { deliverableId: crypto.randomUUID() })).status).toBe(404);
    expect((await execute(td, crypto.randomUUID(), key())).status).toBe(404);
    expect((await confirm(td, crypto.randomUUID(), ifm(1))).status).toBe(404);
    expect((await call(api.app, "GET", `${base}/${crypto.randomUUID()}`, { session: td })).status).toBe(404);
    const otherOrgConnector = await api.db
      .selectFrom("connector")
      .select("id")
      .where("organization_id", "!=", w.orgA.id)
      .executeTakeFirst();
    if (otherOrgConnector) expect((await execute(td, otherOrgConnector.id, key())).status).toBe(404);
  });

  it("confirm needs If-Match (428) and the current version (409); its body is an empty object (400)", async () => {
    const id = await connector({ confirm: "never" });
    const write = (await execute(td, id, key())).body;
    expect((await confirm(td, write.id)).status).toBe(428);
    const stale = await confirm(td, write.id, ifm(1));
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    const bad = await call(api.app, "POST", `${base}/${write.id}/confirm`, {
      session: td,
      headers: ifm(2),
      body: { confirmed: true },
      contract: false,
    });
    expect(bad.status).toBe(400);
  });

  it("the payload rules: larger than 16 KiB 400; a secret-like key 422; an invalid character 400; a bad key 400", async () => {
    const id = await connector();
    const big = await execute(td, id, key(), { payload: { blob: "x".repeat(16_400) } });
    expect([big.status, big.body.errors[0].code]).toEqual([400, "validation.too_big"]);
    const secret = await execute(td, id, key(), { payload: { nested: { apiToken: "SYNTHETIC" } } });
    expect([secret.status, secret.body.code]).toEqual([422, "connector.secret_value_refused"]);
    const char = await execute(td, id, key(), { payload: { note: "bad\u0000text" } });
    expect([char.status, char.body.errors[0].code]).toEqual([400, "validation.invalid_character"]);
    const badKey = await execute(td, id, "short");
    expect(badKey.status).toBe(400);
    expect(await writesOf(id)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------ 7, 8. outside a transaction; the port

describe("the dispatch happens outside any transaction, and the confirmation port", () => {
  it("during the dispatch the write is already committed and the outboundWrite lock is free", async () => {
    const id = await connector();
    const k = key();
    const seen: { status: string | null; lockFree: boolean }[] = [];
    const probing: ConnectorAdapter = {
      ...testAdapter,
      dispatch: async (config, request, ctx) => {
        const row = await api.db
          .selectFrom("outbound_write")
          .select("status")
          .where("connector_id", "=", id)
          .where("idempotency_key", "=", request.idempotencyKey)
          .executeTakeFirst();
        const lockFree = await api.db.transaction().execute(async (tx) => {
          const r = await sql<{
            ok: boolean;
          }>`SELECT pg_try_advisory_xact_lock(730313, hashtext(${`${id}:${request.idempotencyKey}`}::text)) AS ok`.execute(
            tx,
          );
          return r.rows[0]!.ok;
        });
        seen.push({ status: row?.status ?? null, lockFree });
        return testAdapter.dispatch(config, request, ctx);
      },
    };
    const previous = setConnectorAdapters(createConnectorAdapterRegistry([probing]));
    try {
      expect((await execute(td, id, k)).status).toBe(201);
    } finally {
      setConnectorAdapters(previous);
    }
    expect(seen).toEqual([{ status: "requested", lockFree: true }]);
  });

  it("calls the connector-confirmation port once, inside transaction 2, when a write becomes confirmed", async () => {
    const id = await connector();
    const calls: OutboundConfirmedWrite[] = [];
    const previous = setOutboundConfirmationPort({
      onConfirmed: async (tx, ctx, confirmed) => {
        // Inside the same transaction: the confirmed row is visible here, before the commit.
        const row = await tx
          .selectFrom("outbound_write")
          .select("status")
          .where("id", "=", confirmed.write.id)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("confirmed");
        expect(ctx.actorUserId).toBe(tdUserId);
        calls.push(confirmed);
      },
    });
    try {
      const k = key();
      const res = await execute(td, id, k);
      expect(res.status).toBe(201);
      expect(await execute(td, id, k)).toMatchObject({ status: 200 });
      const pendingConnector = await connector({ confirm: "never" });
      await execute(td, pendingConnector, key());
    } finally {
      setOutboundConfirmationPort(previous);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.write).toMatchObject({ connector_id: id, deliverable_id: deliverableId, status: "confirmed" });
    expect(calls[0]!.sourceSystemId).toBe("synthetic.downstream:v1");
  });

  it("a port that throws rolls the confirmation back: the write stays pending and the next confirm asks again", async () => {
    const id = await connector();
    const previous = setOutboundConfirmationPort({
      onConfirmed: async () => {
        throw new Error("synthetic port failure");
      },
    });
    let res;
    try {
      res = await execute(td, id, key(), {}, { contract: false });
    } finally {
      setOutboundConfirmationPort(previous);
    }
    expect(res.status).toBe(500);
    const [row] = await writesOf(id);
    expect([row!.status, row!.version]).toEqual(["requested", 1]);
    const done = await confirm(td, row!.id, ifm(1));
    expect([done.status, done.body.write.status]).toEqual([200, "confirmed"]);
  });
});

// ------------------------------------------------------------------------------------------------ list

describe("listOutboundWrites", () => {
  it("lists newest first with filters and a cursor", async () => {
    const id = await connector();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await execute(td, id, key())).body.id);
    const page1 = await call<Body>(api.app, "GET", `${base}?limit=2&status=confirmed`, { session: td });
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await call<Body>(
      api.app,
      "GET",
      `${base}?limit=2&status=confirmed&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
      { session: td },
    );
    expect(page2.status).toBe(200);
    const seen = [...page1.body.items, ...page2.body.items].map((x: Body) => x.id);
    expect(seen.slice(0, 2)).toEqual([ids[2], ids[1]]);
    expect((await call(api.app, "GET", `${base}?status=done`, { session: td })).status).toBe(400);
    const wrongCursor = await call(
      api.app,
      "GET",
      `${base}?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
      { session: td },
    );
    expect(wrongCursor.status).toBe(400);
  });
});
