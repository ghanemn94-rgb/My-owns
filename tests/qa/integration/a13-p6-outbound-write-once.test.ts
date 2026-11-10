// A13 on guarded outbound writes (T-DG6-QA-C; REQ-S17-006, REQ-S20-013). Acceptance (binding, requirements.csv
// REQ-S17-006): "A13;A12: replaying an outbound write with the same key produces one downstream effect; a write without
// confirmation stays 'pending confirmation'".
// Derived from docs/api/openapi.yaml executeOutboundWrite ("The same key and payload returns the existing write with
// 200 and no second effect"; "marked confirmed only on a confirmed response; otherwise it stays pending_confirmation")
// and confirmOutboundWrite; ADR-0055 §3 (the local test adapter is the downstream: its per-key effect counter is the
// observation of "one downstream effect"; it is the downstream double, not the product's own state) and §5.
// Real API (inject, contract-validated responses) on the run's PostgreSQL. The initiative and the deliverable are
// written by the backend's P3 fixtures with their audit events (setup only). All data is SYNTHETIC; nothing is "live"
// or "connected to Mobily", and a write approves nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testAdapterEffects } from "../../../apps/api/src/modules/integrations/adapters/test-adapter.ts";
import {
  insertDeliverable,
  insertInitiative,
  type BenefitWorld,
} from "../../../apps/api/test/integration/benefits/fixtures.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  signIn,
  startApi,
  uniq,
  type Loose,
  type Session,
  type TestApi,
} from "../support/api.ts";
import { seedWorld, type World } from "../support/p4.ts";

let api: TestApi;
let w: World;
let tid: string;
let deliverableId: string;
let td: Session;
let admin: Session;
const base = () => `/api/v1/transformations/${tid}/outbound-writes`;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  tid = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const tl = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tl.id, "TL", { type: "transformation", id: tid }, w.orgA.id);
  const fixture = { organizationId: w.orgA.id, transformationId: tid, users: { tl } } as unknown as BenefitWorld;
  deliverableId = await insertDeliverable(api.db, fixture, await insertInitiative(api.db, fixture));
  const tdUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tdUser.id, "TD", { type: "transformation", id: tid }, w.orgA.id);
  td = await signIn(api.app, tdUser.subject);
  admin = await signIn(api.app, w.admin.subject);
}, 120_000);
afterAll(() => api?.close());

async function connector(confirm: "immediate" | "never"): Promise<string> {
  const created = await call<Loose>(api.app, "POST", "/api/v1/admin/connectors", {
    session: admin,
    body: {
      organizationId: w.orgA.id,
      code: uniq("qa-ow-").toLowerCase(),
      nameEn: "Synthetic QA downstream",
      nameAr: "نظام لاحق اصطناعي",
      adapterKind: "test_adapter",
      targetKind: "none",
      config: {
        sourceSystemId: "synthetic.downstream:qa-a13c",
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
        reason: "Synthetic downstream for the QA A13 outbound-write test.",
      },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const enabled = await call<Loose>(api.app, "POST", `/api/v1/admin/connectors/${created.body.id}/enable`, {
    session: admin,
    headers: { "if-match": String(created.headers["etag"]) },
    body: { reason: null },
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  return created.body.id as string;
}

const execute = (connectorId: string, idempotencyKey: string, payload: Record<string, unknown>) =>
  call<Loose>(api.app, "POST", base(), {
    session: td,
    body: { connectorId, actionCode: "deliverable_status_push", deliverableId, idempotencyKey, payload },
  });
const rowsOfKey = (connectorId: string, key: string) =>
  api.db
    .selectFrom("outbound_write")
    .selectAll()
    .where("connector_id", "=", connectorId)
    .where("idempotency_key", "=", key)
    .execute();

describe("REQ-S17-006 (A13): replaying an outbound write with the same key produces one downstream effect", () => {
  it("first 201 confirmed; three replays 200 with the same write; one row and ONE downstream effect", async () => {
    const c = await connector("immediate");
    const key = "qa-a13c-ow-key-0001";
    const payload = { status: "accepted", note: "Synthetic status push" };
    const first = await execute(c, key, payload);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.status).toBe("confirmed");
    expect(typeof first.body.externalReference).toBe("string");
    for (let i = 0; i < 3; i++) {
      const replay = await execute(c, key, { note: "Synthetic status push", status: "accepted" }); // keys reordered
      expect(replay.status, JSON.stringify(replay.body)).toBe(200);
      expect([replay.body.id, replay.body.externalReference]).toEqual([first.body.id, first.body.externalReference]);
    }
    expect(await rowsOfKey(c, key), "one write row for the key").toHaveLength(1);
    expect(testAdapterEffects(c, key), "one downstream effect").toBe(1);

    const reused = await execute(c, key, { status: "rejected" });
    expect([reused.status, reused.body.code]).toEqual([409, "outbound_write.idempotency_key_reused"]);
    expect(testAdapterEffects(c, key), "a refused reuse adds no effect").toBe(1);
  });

  it("two concurrent requests with the same key: one write, one downstream effect", async () => {
    const c = await connector("immediate");
    const key = "qa-a13c-ow-key-race";
    const payload = { status: "accepted" };
    const [a, b] = await Promise.all([execute(c, key, payload), execute(c, key, payload)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await rowsOfKey(c, key)).toHaveLength(1);
    expect(testAdapterEffects(c, key)).toBe(1);
  });

  it("a write without confirmation stays pending_confirmation; a confirm does not mark it done by itself", async () => {
    const c = await connector("never");
    const key = "qa-a13c-ow-key-pend";
    const r = await execute(c, key, { status: "accepted" });
    expect([201, 200]).toContain(r.status);
    expect([r.body.status, r.body.confirmedAt, r.body.externalReference]).toEqual(["pending_confirmation", null, null]);
    const confirm = await call<Loose>(api.app, "POST", `${base()}/${r.body.id}/confirm`, {
      session: td,
      headers: { "if-match": String(r.headers["etag"]) },
      body: {},
    });
    expect([200, 409]).toContain(confirm.status);
    const row = (await rowsOfKey(c, key))[0]!;
    expect([row.status, row.confirmed_at], "still pending confirmation").toEqual(["pending_confirmation", null]);
    const replay = await execute(c, key, { status: "accepted" });
    expect([replay.status, replay.body.id, replay.body.status]).toEqual([200, r.body.id, "pending_confirmation"]);
    expect(await rowsOfKey(c, key)).toHaveLength(1);
  });
});
