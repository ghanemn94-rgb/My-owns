// qa-verifier A21 "No-AI operation" on the P6 adapters (DG6, T-DG6-QA-D). Master prompt §20 A21: "Core lifecycle,
// approvals, calculations and reports still work with AI and external notification channels disabled". The assignment's
// reading for P6: an adapter PRESENT but disabled, every notification channel off, outbound writes captured by the local
// test adapter instead of being sent anywhere; every workflow still completes and notifications appear in the inbox.
// The binding row texts (docs/delivery/requirements.csv), each tested literally below:
//   REQ-S17-009  "a fresh install shows AI disabled" (the network-capture half is the e2e connection-log check);
//   REQ-S12-023  "with no email adapter configured all workflows complete and notifications appear in the inbox";
//   REQ-S17-010  core workflows and calculations work with AI disabled and external notification channels off;
//   REQ-S20-021  "Core lifecycle, approvals, calculations and reports still work with AI and external notification
//                channels disabled";
//   REQ-S17-005  (A21 half) with the connector disabled, a KPI actual is still submitted by form.
// Derived from docs/api/openapi.yaml (getAssistantSetting "No saved row means the assistant is OFF ... a fresh install
// has AI disabled"; putAssistantSetting "If-Match 0 creates the row DISABLED"; postAssistantMessage "422
// assistant.disabled"; listNotificationChannels / putNotificationChannel "enterprise_messaging cannot be enabled";
// listNotificationDeliveries; executeOutboundWrite "409 connector.disabled"). The suite has its OWN scratch database
// (the assistant setting is installation-wide, and other files may leave a row in the shared run database), so "fresh
// install" is literally a freshly migrated database. Loopback doubles stand in for the external systems and COUNT
// every contact: an SMTP server (apps/api/test/support/fake-smtp.ts) the disabled email channel points at, and a
// chat-completions server (fake-model.ts) the disabled assistant points at. A contact with either fails the suite.
// The worker's notification fan-out consumer runs in-process on the notification's outbox envelope, exactly as the
// relay delivers it (no product code is changed or bypassed). Every value is SYNTHETIC; every G1 decision below is a
// synthetic in-product approval of test data that approves nothing real. Nothing names the engineering gates.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { configureNotificationChannels, FANOUT_HANDLER } from "../../../apps/worker/src/handlers/notifications.ts";
import { testAdapterEffects } from "../../../apps/api/src/modules/integrations/adapters/test-adapter.ts";
import { FakeSmtp } from "../../../apps/api/test/support/fake-smtp.ts";
import { FakeModel } from "../../../apps/api/test/support/fake-model.ts";
import {
  insertDeliverable,
  insertInitiative,
  type BenefitWorld,
} from "../../../apps/api/test/integration/benefits/fixtures.ts";
import { actualAction } from "../../../apps/api/test/integration/kpi-p4/kbe-c-fixtures.ts";
import {
  call,
  createUser,
  grant,
  signIn,
  startApi,
  uniq,
  type Loose,
  type Session,
  type TestApi,
} from "../support/api.ts";
import {
  canon,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  REVIEW_FLOW,
  seedKpiWorld,
  seedWorld,
  submitActual,
  type KpiWorld,
  type World,
} from "../support/p4.ts";
import { passGatesNatively, seedNativeGateWorld, type NativeGateWorld } from "../support/gates-native.ts";

const ASSISTANT = "/api/v1/admin/assistant";
const CHANNELS = "/api/v1/admin/notification-channels";
const DELIVERIES = "/api/v1/admin/notification-deliveries";
const CONNECTORS = "/api/v1/admin/connectors";
const ifm = (v: number | string) => ({ "if-match": typeof v === "number" ? `"${v}"` : v });

let api: TestApi;
let scratch: string | null = null;
let smtp: FakeSmtp;
let model: FakeModel;
let w: World;
let k: KpiWorld;
let admin: Session;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_qa_a21_p6");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  api = await startApi({ database: scratch });
  smtp = await new FakeSmtp().start();
  model = await new FakeModel().start();
  configureNotificationChannels({ refuseInsecure: false, appBaseUrl: new URL("https://hub.example.invalid") });
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  await mapPartyTo(api, k, "BO", k.users.bo.id);
  admin = await signIn(api.app, w.admin.subject);
}, 240_000);

afterAll(async () => {
  configureNotificationChannels({});
  await smtp?.stop();
  await model?.stop();
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

/** Nothing reached the external doubles: no e-mail was sent and no model was called. */
function expectNothingSent(what: string): void {
  expect(smtp.messages, `${what}: messages accepted by the SMTP double`).toHaveLength(0);
  expect(model.requestCount, `${what}: requests that reached the model double`).toBe(0);
}

/** The decimal string of an actual's current value version (KpiActual.values[valueNo = currentValueNo].value). */
function currentValue(actual: Loose): string | null {
  const v = (actual.values as Loose[]).find((x) => x.valueNo === actual.currentValueNo);
  return v ? (v.value as string | null) : null;
}

/** The relay's envelope of a notification's single outbox row. */
async function envelopeOf(notificationId: string) {
  const rows = await api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("aggregate_type", "=", "inbox_notification")
    .where("aggregate_id", "=", notificationId)
    .execute();
  expect(rows, "one outbox row per inbox notification").toHaveLength(1);
  const e = rows[0]!;
  return {
    outboxEventId: e.id,
    eventType: e.event_type,
    schemaVersion: e.schema_version,
    idempotencyKey: e.idempotency_key,
    organizationId: e.organization_id,
    payload: e.payload as Record<string, unknown>,
  };
}

// ------------------------------------------------------------------------------------------ 1. fresh install
describe("REQ-S17-009 (A21): a fresh install shows AI disabled; no notification channel is configured", () => {
  it("GET /admin/assistant on a freshly migrated database: configured false, enabled false, telemetry false, ETag 0", async () => {
    expect(await api.db.selectFrom("assistant_setting").select("id").execute(), "no setting row").toEqual([]);
    const res = await call<Loose>(api.app, "GET", ASSISTANT, { session: admin });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ configured: false, enabled: false, telemetryEnabled: false, version: 0 });
    expect(res.body.providerKind).toBeNull();
    expect(res.body.endpointUrl).toBeNull();
    expect(String(res.headers["etag"])).toBe('"0"');
  });

  it("both external channels are listed as not configured and disabled; enterprise messaging has no adapter", async () => {
    const res = await call<Loose>(api.app, "GET", `${CHANNELS}?organizationId=${w.orgA.id}`, { session: admin });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byKind = Object.fromEntries((res.body.items as Loose[]).map((c) => [c.channelKind, c]));
    expect(Object.keys(byKind).sort()).toEqual(["email", "enterprise_messaging"]);
    for (const c of Object.values(byKind) as Loose[])
      expect([c.channelKind, c.configured, c.enabled]).toEqual([c.channelKind, false, false]);
    expect(byKind["enterprise_messaging"].adapterAvailable).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------ 2. present but disabled
describe("A21: the adapters are present but disabled", () => {
  it("email is configured (pointing at the SMTP double) and saved DISABLED; enterprise messaging cannot be enabled", async () => {
    const put = await call<Loose>(api.app, "PUT", `${CHANNELS}/email?organizationId=${w.orgA.id}`, {
      session: admin,
      headers: ifm(0),
      body: {
        enabled: false,
        smtp: {
          host: "127.0.0.1",
          port: smtp.port,
          security: "none",
          usernameRef: null,
          passwordRef: null,
          fromAddress: "hub-noreply@example.invalid",
        },
        reason: "Synthetic QA A21: the email adapter is present but disabled",
      },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({ channelKind: "email", configured: true, enabled: false, adapterAvailable: true });

    const em = await call<Loose>(api.app, "PUT", `${CHANNELS}/enterprise_messaging?organizationId=${w.orgA.id}`, {
      session: admin,
      headers: ifm(0),
      body: { enabled: true, smtp: null, reason: "Synthetic QA A21: try to enable the port-only channel" },
    });
    expect([em.status, em.body.code], JSON.stringify(em.body)).toEqual([
      422,
      "notification_channel.adapter_unavailable",
    ]);
  });

  it("the assistant is configured with an HTTP endpoint (the model double) and saved DISABLED; it never enables itself", async () => {
    const put = await call<Loose>(api.app, "PUT", ASSISTANT, {
      session: admin,
      headers: ifm(0),
      body: {
        providerKind: "http_endpoint",
        endpointUrl: model.url,
        apiStyle: "openai_chat_completions",
        modelName: "synthetic-qa-model",
        credentialRef: null,
        authorizationReference: "SYNTHETIC-QA-A21-0001",
        requestTimeoutMs: 5000,
        maxOutputTokens: 256,
        maxContextRecords: 5,
        reason: "Synthetic QA A21: the assistant adapter is present but disabled",
      },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({ configured: true, enabled: false, providerKind: "http_endpoint" });
    const get = await call<Loose>(api.app, "GET", ASSISTANT, { session: admin });
    expect([get.status, get.body.configured, get.body.enabled, get.body.telemetryEnabled]).toEqual([
      200,
      true,
      false,
      false,
    ]);
    expectNothingSent("after saving the disabled adapters");
  });
});

// ------------------------------------------------------------------------------------------ 3. workflows complete
describe("REQ-S12-023 / REQ-S17-010 / REQ-S20-021: with the adapters disabled, workflows complete and notify in the inbox", () => {
  it("a KPI actual on a review route: submitted by form, its reviewer is notified in the inbox only, accepted; value kept exactly", async () => {
    const kpi = await ownedKpi(api, k, REVIEW_FLOW);
    const period = await monthlyPeriod(api, w);
    const submitted = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "12.5" });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const actual = submitted.body.actual as Loose;
    expect(actual.status).toBe("submitted");

    // The reviewer (the mapped Business Owner) finds the notification in the in-app inbox.
    const inbox = await call<Loose>(api.app, "GET", "/api/v1/me/inbox", { session: k.s.bo });
    expect(inbox.status, JSON.stringify(inbox.body)).toBe(200);
    const note = (inbox.body.items as Loose[]).find((n) => String(n.linkPath).includes(actual.id));
    expect(note, `an inbox notification linking the actual: ${JSON.stringify(inbox.body.items)}`).toBeTruthy();
    expect(note.readAt).toBeNull();
    expect(inbox.body.unreadCount).toBeGreaterThanOrEqual(1);

    // The worker's fan-out consumer, run on the notification's envelope as the relay would: in-app only.
    const result = await FANOUT_HANDLER.handle(api.db, await envelopeOf(note.id), `qa-a21-${randomUUID()}`);
    expect(result).toMatchObject({ outcome: "no_channel", created: [], sends: [] });
    expect(
      await api.db
        .selectFrom("notification_delivery")
        .select("id")
        .where("inbox_notification_id", "=", note.id)
        .execute(),
      "no external delivery row",
    ).toEqual([]);
    const deliveries = await call<Loose>(api.app, "GET", `${DELIVERIES}?organizationId=${w.orgA.id}`, {
      session: admin,
    });
    expect([deliveries.status, deliveries.body.items]).toEqual([200, []]);

    // The workflow completes: the reviewer accepts, the value is the submitted decimal exactly.
    const current = await call<Loose>(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/actuals`, {
      session: k.s.bo,
    });
    const row = (current.body.items as Loose[]).find((a) => a.id === actual.id);
    const accepted = await actualAction(api, k, actual.id, "accept", row.version, {});
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const after = await call<Loose>(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/actuals`, { session: k.s.bo });
    const final = (after.body.items as Loose[]).find((a) => a.id === actual.id);
    expect(final.status).toBe("accepted");
    expect(final.acceptedValueNo).toBe(final.currentValueNo);
    expect(canon(currentValue(final))).toBe("12.5");
    // Marking the notification read works without any channel.
    const read = await call<Loose>(api.app, "POST", `/api/v1/me/inbox/${note.id}/read`, {
      session: k.s.bo,
      headers: ifm(note.version),
    });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expectNothingSent("after the KPI review workflow");
  });

  it("a product gate G1 is submitted and approved by the Sponsor; a charter report is generated from the records", async () => {
    const g: NativeGateWorld = await seedNativeGateWorld(api, w, "A21");
    await passGatesNatively(api, g, ["G1"], "2041-12-31");
    const view = await call<Loose>(api.app, "GET", `${g.gates}/G1`, { session: g.tl.session });
    expect([view.status, view.body.gate.status]).toEqual([200, "approved"]);
    const snap = await call<Loose>(api.app, "POST", `${g.base}/reports/charter/generate`, {
      session: g.tl.session,
      body: {},
    });
    expect(snap.status, JSON.stringify(snap.body)).toBe(201);
    expect(snap.body.status).toBe("generated");
    // Every notification this organization produced stayed in-app: no delivery row exists.
    const rows = await api.db
      .selectFrom("notification_delivery")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .execute();
    expect(rows).toEqual([]);
    expectNothingSent("after the gate approval and the report");
  });
});

// ------------------------------------------------------------------------------------------ 4. assistant disabled
describe("REQ-S17-009 / REQ-S17-010: the disabled assistant refuses to answer and makes no outbound call", () => {
  it("starting a conversation is refused with 422 assistant.disabled (contract), nothing is stored, and the model double sees nothing", async () => {
    const conv = await call<Loose>(api.app, "POST", "/api/v1/assistant/conversations", {
      session: k.s.tl,
      body: { title: "Synthetic QA A21 question", transformationId: k.transformationId },
    });
    expect([conv.status, conv.body.code], JSON.stringify(conv.body)).toEqual([422, "assistant.disabled"]);
    expect(await api.db.selectFrom("assistant_conversation").select("id").execute()).toEqual([]);
    expect(await api.db.selectFrom("assistant_message").select("id").execute()).toEqual([]);
    // Listing one's conversations "works whether the assistant is on or off".
    const list = await call<Loose>(api.app, "GET", "/api/v1/assistant/conversations", { session: k.s.tl });
    expect([list.status, list.body.items]).toEqual([200, []]);
    expectNothingSent("after the refused assistant request");
  });
});

// ------------------------------------------------------------------------------------------ 5. connectors
describe("REQ-S17-005 (A21) / outbound writes: a disabled connector sends nothing; the native form keeps working", () => {
  let connectorId = "";
  let deliverableId = "";
  let td: Session;

  beforeAll(async () => {
    const created = await call<Loose>(api.app, "POST", CONNECTORS, {
      session: admin,
      body: {
        organizationId: w.orgA.id,
        code: uniq("qa-a21-").toLowerCase(),
        nameEn: "Synthetic QA A21 downstream",
        nameAr: "نظام لاحق اصطناعي للاختبار",
        adapterKind: "test_adapter",
        targetKind: "none",
        config: {
          sourceSystemId: "synthetic.downstream:qa-a21",
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
          adapterSettings: { mode: "healthy", confirm: "never" },
          reason: "Synthetic downstream for the QA A21 suite.",
        },
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status, "a connector is created disabled").toBe("disabled");
    connectorId = created.body.id;
    const fixture = { organizationId: w.orgA.id, transformationId: k.transformationId, users: { tl: k.users.tl } };
    deliverableId = await insertDeliverable(
      api.db,
      fixture as unknown as BenefitWorld,
      await insertInitiative(api.db, fixture as unknown as BenefitWorld),
    );
    const tdUser = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, tdUser.id, "TD", { type: "transformation", id: k.transformationId }, w.orgA.id);
    td = await signIn(api.app, tdUser.subject);
  });

  const execute = (key: string) =>
    call<Loose>(api.app, "POST", `${k.base}/outbound-writes`, {
      session: td,
      body: {
        connectorId,
        actionCode: "deliverable_status_push",
        deliverableId,
        idempotencyKey: key,
        payload: { status: "accepted" },
      },
    });

  it("an outbound write through the disabled connector is refused (409 connector.disabled): no row, no downstream effect", async () => {
    const key = "qa-a21-ow-disabled-0001";
    const r = await execute(key);
    expect([r.status, r.body.code], JSON.stringify(r.body)).toEqual([409, "connector.disabled"]);
    const rows = await api.db
      .selectFrom("outbound_write")
      .select("id")
      .where("connector_id", "=", connectorId)
      .execute();
    expect(rows).toEqual([]);
    expect(testAdapterEffects(connectorId, key)).toBe(0);
  });

  it("with the connector disabled, a KPI actual is still submitted by form (201) and reads back exactly", async () => {
    const kpi = await ownedKpi(api, k, REVIEW_FLOW);
    const period = await monthlyPeriod(api, w);
    const r = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "0.125" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(canon(currentValue(r.body.actual))).toBe("0.125");
  });

  it("enabled on the local test adapter, the write is CAPTURED there (one effect) and stays pending confirmation, never done", async () => {
    const c = await call<Loose>(api.app, "GET", `${CONNECTORS}/${connectorId}`, { session: admin });
    const en = await call<Loose>(api.app, "POST", `${CONNECTORS}/${connectorId}/enable`, {
      session: admin,
      headers: { "if-match": String(c.headers["etag"]) },
      body: { reason: null },
    });
    expect(en.status, JSON.stringify(en.body)).toBe(200);
    const key = "qa-a21-ow-captured-0001";
    const r = await execute(key);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.body.status, r.body.confirmedAt]).toEqual(["pending_confirmation", null]);
    expect(testAdapterEffects(connectorId, key), "captured once by the local test adapter").toBe(1);
    expectNothingSent("after the captured outbound write");
  });
});
