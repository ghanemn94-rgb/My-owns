// P6 contract exercises of BE-N (p6-plan §5.1, p6-work-split §2 rule 16, §B/A.6). T-DG6-BE-N routes the six webhook
// operations (ADR-0056 §7-§9) and exercises each here through `ctx.mirrored` (success and every declared refusal it can
// reach); its split task T-DG6-BE-N2 appends the outbound-write operations after this block (ADR-0055 §5, §9). The mirrors restate the
// contract schemas of the JSON success bodies (no shared zod mirror exists for webhooks in packages/shared).
//
// receiveWebhook is signed over its exact bytes, so its body is sent raw with the client's request-body check off
// (`contract: false`) and the response checked here with `assertContract` (which records the coverage), plus the parsed
// body with `assertAcceptedRequest` for an accepted delivery. The signing secret is a SYNTHETIC test value served by a
// test SecretProvider installed for this block only (the process registry is restored after it). Every value is
// SYNTHETIC; a delivery stages rows, approves nothing and never touches DG0-DG7.
import { expect } from "vitest";
import { z } from "zod";
import { setConnectorSecretProviders } from "../../../src/modules/integrations/secret-refs.ts";
import { webhookSignature } from "../../../src/modules/integrations/webhooks.ts";
import { createSecretProviderRegistry, secretValue } from "../../../src/modules/platform/index.ts";
import { assertAcceptedRequest, assertContract } from "../../support/contract.ts";
import {
  createTransformationRow,
  createUser,
  grant,
  signIn,
  uniq,
  type P6ExerciseContext,
} from "../../support/harness.ts";
import { insertDeliverable, insertInitiative, type BenefitWorld } from "../benefits/fixtures.ts";
import { seedKpiWorld } from "../kpi/fixtures.ts";

// ------------------------------------------------------------------------------------------------ T-DG6-BE-N mirrors

const secretRef = z.strictObject({ provider: z.string(), name: z.string() });
const webhookEndpoint = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  connectorId: z.uuid(),
  endpointKey: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
  receivePath: z.string().startsWith("/api/v1/webhooks/"),
  label: z.string().max(200),
  signingSecretRef: secretRef,
  previousSecretRef: secretRef.nullable(),
  previousValidUntil: z.string().nullable(),
  secretRotatedAt: z.string().nullable(),
  toleranceSeconds: z.number().int().min(30).max(900),
  status: z.enum(["active", "disabled"]),
  disabledAt: z.string().nullable(),
  disabledBy: z.uuid().nullable(),
  disableReason: z.string().nullable(),
  lastReceiptAt: z.string().nullable(),
  version: z.number().int().min(1),
  updatedAt: z.string(),
});
const receiptResult = z.strictObject({
  receiptId: z.uuid(),
  importBatchId: z.uuid(),
  replay: z.boolean(),
  rowsTotal: z.number().int().min(0),
  rowsValid: z.number().int().min(0),
  rowsInvalid: z.number().int().min(0),
  rowsDuplicate: z.number().int().min(0),
});

export const P6_MIRRORS_BE_N: Readonly<Record<string, z.ZodType>> = {
  // T-DG6-BE-N
  listWebhookEndpoints: z.strictObject({ items: z.array(webhookEndpoint), nextCursor: z.string().nullable() }),
  createWebhookEndpoint: webhookEndpoint,
  getWebhookEndpoint: webhookEndpoint,
  rotateWebhookSecret: webhookEndpoint,
  disableWebhookEndpoint: webhookEndpoint,
  receiveWebhook: receiptResult,
  // T-DG6-BE-N2
  listOutboundWrites: z.lazy(() => outboundWritePage),
  executeOutboundWrite: z.lazy(() => outboundWrite),
  getOutboundWrite: z.lazy(() => outboundWriteDetail),
  confirmOutboundWrite: z.lazy(() => outboundWriteDetail),
};

const SECRET = "whsec-SYNTHETIC-contract-3b9e";
const SECRET_NAME = "MTH_CONTRACT_WEBHOOK_SECRET";
const NEXT_NAME = "MTH_CONTRACT_WEBHOOK_SECRET_NEXT";

export async function exerciseP6BeNOperations(ctx: P6ExerciseContext): Promise<void> {
  const secrets = createSecretProviderRegistry();
  secrets.register({ id: "env", get: async (name) => (name === SECRET_NAME ? secretValue(SECRET) : undefined) });
  const previous = setConnectorSecretProviders(secrets);
  try {
    await exerciseWebhooks(ctx);
  } finally {
    setConnectorSecretProviders(previous);
  }
  await exerciseOutboundWrites(ctx); // T-DG6-BE-N2
}

async function exerciseWebhooks(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject); // ADM_TECH @ A: connector.read + webhook.configure
  const auditor = await signIn(api.app, w.auditor.subject); // AUD @ A: connector.read only
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  // The KPI world's transformation (pinned form schema, KPIs), as BE-M2's import exercises use.
  const { transformationId } = await seedKpiWorld(api, w);

  // A synthetic, enabled webhook connector targeting that transformation.
  const connector = await mirrored("POST", "/api/v1/admin/connectors", {
    session: admin,
    body: {
      organizationId: w.orgA.id,
      code: uniq("cw-").toLowerCase(),
      nameEn: "Synthetic contract webhook",
      nameAr: "ويب هوك اصطناعي",
      adapterKind: "webhook",
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: "synthetic.contract-webhook",
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: transformationId,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: [],
        reconciliationRule: "none",
        adapterSettings: {},
        reason: "Synthetic contract exercise.",
      },
    },
  });
  expect(connector.status).toBe(201);
  const connectorId = connector.body.id as string;
  const enabled = await mirrored("POST", `/api/v1/admin/connectors/${connectorId}/enable`, {
    session: admin,
    headers: { "if-match": '"1"' },
    body: { reason: null },
  });
  expect(enabled.status).toBe(200);

  const L = "/api/v1/admin/webhooks";
  const ref = { provider: "env", name: SECRET_NAME };
  const createBody = { connectorId, label: "Synthetic contract sender", signingSecretRef: ref, toleranceSeconds: 300 };

  // createWebhookEndpoint: 201; 400; 401; 403 (AUD); 404 (unknown connector); 422 (secret value).
  const created = await mirrored("POST", L, { session: admin, body: createBody });
  expect(created.status).toBe(201);
  expect(created.headers["etag"]).toBe('"1"');
  const id = created.body.id as string;
  const key = created.body.endpointKey as string;
  const one = `${L}/${id}`;
  expect((await mirrored("POST", L, { session: admin, body: { ...createBody, toleranceSeconds: 1 } })).status).toBe(
    400,
  );
  expect((await mirrored("POST", L, { body: createBody })).status).toBe(401);
  expect((await mirrored("POST", L, { session: auditor, body: createBody })).status).toBe(403);
  expect((await mirrored("POST", L, { session: admin, body: { ...createBody, connectorId: missing } })).status).toBe(
    404,
  );
  const value = await mirrored("POST", L, {
    session: admin,
    body: { ...createBody, signingSecretRef: { ...ref, value: "not-a-reference" } },
  });
  expect([value.status, value.body.code]).toEqual([422, "connector.secret_value_refused"]);

  // receiveWebhook: 202; 200 (replay); 400; 401; 409; 413.
  const R = `/api/v1/webhooks/${key}`;
  const receive = async (raw: Buffer, deliveryId: string, sign = true) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-mth-webhook-timestamp": ts,
      "x-mth-webhook-delivery": deliveryId,
    };
    if (sign) headers["x-mth-webhook-signature"] = `v1=${webhookSignature(SECRET, ts, deliveryId, raw)}`;
    const res = await mirrored("POST", R, { headers, body: raw, contract: false });
    assertContract("POST", R, { statusCode: res.raw.statusCode, headers: res.raw.headers, body: res.raw.body });
    if (res.status >= 200 && res.status < 300)
      assertAcceptedRequest("POST", R, res.status, JSON.parse(raw.toString("utf8")) as unknown);
    return res;
  };
  const delivery = Buffer.from(
    JSON.stringify({
      templateVersion: "kpi_actual.v1",
      items: [
        {
          source_record_id: "CW-1",
          kpi_id: missing,
          scope_kind: "transformation",
          scope_id: transformationId,
          period_label: "2041-01",
          value: "1",
          data_as_of: "2041-01-31",
        },
      ],
    }),
  );
  const accepted = await receive(delivery, "dlv-contract-0001");
  expect([accepted.status, accepted.body.replay, accepted.body.rowsTotal], JSON.stringify(accepted.body)).toEqual([
    202,
    false,
    1,
  ]);
  const replay = await receive(delivery, "dlv-contract-0001");
  expect([replay.status, replay.body.replay, replay.body.receiptId]).toEqual([200, true, accepted.body.receiptId]);
  const reused = await receive(Buffer.from('{"templateVersion":"kpi_actual.v1","items":[]}'), "dlv-contract-0001");
  expect([reused.status, reused.body.code]).toEqual([409, "webhook.delivery_id_reused"]);
  const invalid = await receive(Buffer.from("{nope"), "dlv-contract-0002");
  expect([invalid.status, invalid.body.code]).toEqual([400, "webhook.payload_invalid"]);
  const unsigned = await receive(delivery, "dlv-contract-0003", false);
  expect([unsigned.status, unsigned.body.code]).toEqual([401, "webhook.unauthenticated"]);
  const big = await receive(Buffer.alloc(1_048_577, 0x20), "dlv-contract-0004");
  expect([big.status, big.body.code]).toEqual([413, "webhook.payload_too_large"]);

  // listWebhookEndpoints: 200; 400; 401; 403 (no connector.read); 404 (unknown organization).
  const list = await mirrored("GET", `${L}?organizationId=${w.orgA.id}&limit=10`, { session: auditor });
  expect(list.status).toBe(200);
  expect(list.body.items.some((e: { id: string }) => e.id === id)).toBe(true);
  expect((await mirrored("GET", `${L}?organizationId=nope`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}`)).status).toBe(401);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${L}?organizationId=${missing}`, { session: admin })).status).toBe(404);

  // getWebhookEndpoint: 200; 400; 401; 404 (unknown, or a caller who cannot read its connector: ADR-0006, existence not
  // disclosed, as getConnector).
  const got = await mirrored("GET", one, { session: auditor });
  expect([got.status, got.body.lastReceiptAt === null]).toEqual([200, false]);
  expect((await mirrored("GET", `${L}/not-a-uuid`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", one)).status).toBe(401);
  expect((await mirrored("GET", one, { session: nobody })).status).toBe(404);
  expect((await mirrored("GET", `${L}/${missing}`, { session: admin })).status).toBe(404);

  // rotateWebhookSecret: 200; 400; 401; 403 (AUD); 404; 409 (stale); 422 (grace); 428.
  const RS = `${one}/rotate-secret`;
  const rotate = {
    signingSecretRef: { provider: "env", name: NEXT_NAME },
    graceHours: 24,
    reason: "Synthetic rotation",
  };
  expect((await mirrored("POST", RS, { session: admin, headers: { "if-match": '"1"' }, body: {} })).status).toBe(400);
  expect((await mirrored("POST", RS, { headers: { "if-match": '"1"' }, body: rotate })).status).toBe(401);
  expect((await mirrored("POST", RS, { session: auditor, headers: { "if-match": '"1"' }, body: rotate })).status).toBe(
    403,
  );
  expect(
    (
      await mirrored("POST", `${L}/${missing}/rotate-secret`, {
        session: admin,
        headers: { "if-match": '"1"' },
        body: rotate,
      })
    ).status,
  ).toBe(404);
  const grace = await mirrored("POST", RS, {
    session: admin,
    headers: { "if-match": '"1"' },
    body: { ...rotate, graceHours: 200 },
  });
  expect([grace.status, grace.body.code]).toEqual([422, "webhook.grace_invalid"]);
  expect((await mirrored("POST", RS, { session: admin, body: rotate })).status).toBe(428);
  expect((await mirrored("POST", RS, { session: admin, headers: { "if-match": '"5"' }, body: rotate })).status).toBe(
    409,
  );
  const rotated = await mirrored("POST", RS, { session: admin, headers: { "if-match": '"1"' }, body: rotate });
  expect([rotated.status, rotated.body.version]).toEqual([200, 2]);

  // disableWebhookEndpoint: 200; 400; 401; 403 (AUD); 404; 409 (disabled); 428. (422: none reachable after a valid body.)
  const D = `${one}/disable`;
  const reason = { reason: "Synthetic: sender retired" };
  expect((await mirrored("POST", D, { session: admin, headers: { "if-match": '"2"' }, body: {} })).status).toBe(400);
  expect((await mirrored("POST", D, { headers: { "if-match": '"2"' }, body: reason })).status).toBe(401);
  expect((await mirrored("POST", D, { session: auditor, headers: { "if-match": '"2"' }, body: reason })).status).toBe(
    403,
  );
  expect(
    (
      await mirrored("POST", `${L}/${missing}/disable`, {
        session: admin,
        headers: { "if-match": '"2"' },
        body: reason,
      })
    ).status,
  ).toBe(404);
  expect((await mirrored("POST", D, { session: admin, body: reason })).status).toBe(428);
  const disabled = await mirrored("POST", D, { session: admin, headers: { "if-match": '"2"' }, body: reason });
  expect([disabled.status, disabled.body.status]).toEqual([200, "disabled"]);
  const again = await mirrored("POST", D, { session: admin, headers: { "if-match": '"3"' }, body: reason });
  expect([again.status, again.body.code]).toEqual([409, "webhook.endpoint_disabled"]);
}

// ------------------------------------------------------------------------------------------------ T-DG6-BE-N2
// The four outbound-write operations (ADR-0055 §5, §9; REQ-S17-006) against a synthetic test-adapter connector, the
// only downstream in this release (nothing is "live"). The mirrors restate the contract schemas OutboundWrite,
// OutboundWriteDetail and OutboundWritePage (no shared zod mirror exists for them in packages/shared).

const outboundStatus = z.enum(["requested", "pending_confirmation", "confirmed", "failed"]);
const outboundWrite = z.strictObject({
  id: z.uuid(),
  transformationId: z.uuid(),
  connectorId: z.uuid(),
  configVersionNo: z.number().int().min(1),
  actionCode: z.enum(["deliverable_status_push"]),
  deliverableId: z.uuid(),
  idempotencyKey: z.string(),
  payload: z.record(z.string(), z.unknown()),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: outboundStatus,
  attemptCount: z.number().int().min(0).max(10),
  lastAttemptAt: z.string().nullable(),
  externalReference: z.string().max(200).nullable(),
  confirmedAt: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  requestedBy: z.uuid(),
  createdAt: z.string(),
  version: z.number().int().min(1),
});
const outboundWriteDetail = z.strictObject({
  write: outboundWrite,
  events: z.array(
    z.strictObject({
      recordVersion: z.number().int().min(1),
      status: outboundStatus,
      attemptCount: z.number().int().min(0),
      externalReference: z.string().nullable(),
      failureCode: z.string().nullable(),
      actorUserId: z.uuid().nullable(),
      occurredAt: z.string(),
    }),
  ),
});
const outboundWritePage = z.strictObject({ items: z.array(outboundWrite), nextCursor: z.string().nullable() });

async function exerciseOutboundWrites(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject); // ADM_TECH @ A: configures the connector; no outbound code
  const auditor = await signIn(api.app, w.auditor.subject); // AUD @ A: outbound_write.read only
  const outsider = await signIn(api.app, w.officeB.subject); // TO @ B
  const missing = crypto.randomUUID();
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const tl = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tl.id, "TL", scope, w.orgA.id);
  const lead = await signIn(api.app, tl.subject); // TL @ the transformation: no outbound_write code
  const tdUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tdUser.id, "TD", scope, w.orgA.id);
  const td = await signIn(api.app, tdUser.subject); // TD: outbound_write.read + outbound_write.execute
  const fixture = { organizationId: w.orgA.id, transformationId, users: { tl } } as unknown as BenefitWorld;
  const deliverableId = await insertDeliverable(api.db, fixture, await insertInitiative(api.db, fixture));

  const testConnector = async (adapterSettings: Record<string, string>, outboundActions: string[], enable = true) => {
    const created = await mirrored("POST", "/api/v1/admin/connectors", {
      session: admin,
      body: {
        organizationId: w.orgA.id,
        code: uniq("co-").toLowerCase(),
        nameEn: "Synthetic contract downstream",
        nameAr: "نظام لاحق اصطناعي",
        adapterKind: "test_adapter",
        targetKind: "none",
        config: {
          sourceSystemId: "synthetic.contract-downstream",
          endpointUrl: null,
          credentialRefs: {},
          fieldMappings: [],
          targetTransformationId: null,
          cadence: "manual",
          retryMaxAttempts: 0,
          retryBackoffSeconds: 60,
          commitMode: "manual",
          commitOnBehalfOf: null,
          outboundActions,
          reconciliationRule: "none",
          adapterSettings,
          reason: "Synthetic contract exercise.",
        },
      },
    });
    expect(created.status).toBe(201);
    if (enable) {
      const enabled = await mirrored("POST", `/api/v1/admin/connectors/${created.body.id}/enable`, {
        session: admin,
        headers: { "if-match": '"1"' },
        body: { reason: null },
      });
      expect(enabled.status).toBe(200);
    }
    return created.body.id as string;
  };
  const healthy = await testConnector({ mode: "healthy" }, ["deliverable_status_push"]);
  const never = await testConnector({ mode: "healthy", confirm: "never" }, ["deliverable_status_push"]);
  const noAction = await testConnector({ mode: "healthy" }, []);
  const disabled = await testConnector({ mode: "healthy" }, ["deliverable_status_push"], false);

  const L = `/api/v1/transformations/${transformationId}/outbound-writes`;
  const body = (
    connectorId: string,
    idempotencyKey: string,
    payload: Record<string, unknown> = { status: "done" },
  ) => ({
    connectorId,
    actionCode: "deliverable_status_push",
    deliverableId,
    idempotencyKey,
    payload,
  });

  // executeOutboundWrite: 201; 200 (replay); 400; 401; 403 (AUD); 404 (unknown deliverable); 409 (key reused;
  // connector disabled); 422 (action not allowed).
  const created = await mirrored("POST", L, { session: td, body: body(healthy, "contract-key-0001") });
  expect([created.status, created.body.status]).toEqual([201, "confirmed"]);
  expect(created.headers["location"]).toBe(`${L}/${created.body.id}`);
  const replay = await mirrored("POST", L, { session: td, body: body(healthy, "contract-key-0001") });
  expect([replay.status, replay.body.id]).toEqual([200, created.body.id]);
  expect((await mirrored("POST", L, { session: td, body: body(healthy, "short") })).status).toBe(400);
  expect((await mirrored("POST", L, { body: body(healthy, "contract-key-0002") })).status).toBe(401);
  expect((await mirrored("POST", L, { session: auditor, body: body(healthy, "contract-key-0002") })).status).toBe(403);
  expect(
    (
      await mirrored("POST", L, {
        session: td,
        body: { ...body(healthy, "contract-key-0002"), deliverableId: missing },
      })
    ).status,
  ).toBe(404);
  const reused = await mirrored("POST", L, { session: td, body: body(healthy, "contract-key-0001", { status: "x" }) });
  expect([reused.status, reused.body.code]).toEqual([409, "outbound_write.idempotency_key_reused"]);
  const off = await mirrored("POST", L, { session: td, body: body(disabled, "contract-key-0003") });
  expect([off.status, off.body.code]).toEqual([409, "connector.disabled"]);
  const refused = await mirrored("POST", L, { session: td, body: body(noAction, "contract-key-0004") });
  expect([refused.status, refused.body.code]).toEqual([422, "outbound_write.action_not_allowed"]);
  const pending = await mirrored("POST", L, { session: td, body: body(never, "contract-key-0005") });
  expect([pending.status, pending.body.status]).toEqual([201, "pending_confirmation"]);

  // listOutboundWrites: 200; 400; 401; 403 (TL: no outbound_write.read); 404 (outsider; unknown transformation).
  const list = await mirrored("GET", `${L}?limit=10&deliverableId=${deliverableId}`, { session: auditor });
  expect(list.status).toBe(200);
  expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([pending.body.id, created.body.id]);
  expect((await mirrored("GET", `${L}?status=done`, { session: td })).status).toBe(400);
  expect((await mirrored("GET", L)).status).toBe(401);
  expect((await mirrored("GET", L, { session: lead })).status).toBe(403);
  expect((await mirrored("GET", L, { session: outsider })).status).toBe(404);
  expect((await mirrored("GET", `/api/v1/transformations/${missing}/outbound-writes`, { session: td })).status).toBe(
    404,
  );

  // getOutboundWrite: 200; 400; 401; 403 (TL); 404.
  const one = `${L}/${created.body.id}`;
  const got = await mirrored("GET", one, { session: auditor });
  expect([got.status, got.body.write.status, got.body.events.length]).toEqual([200, "confirmed", 2]);
  expect((await mirrored("GET", `${L}/not-a-uuid`, { session: td })).status).toBe(400);
  expect((await mirrored("GET", one)).status).toBe(401);
  expect((await mirrored("GET", one, { session: lead })).status).toBe(403);
  expect((await mirrored("GET", `${L}/${missing}`, { session: td })).status).toBe(404);

  // confirmOutboundWrite: 200; 400; 401; 403 (AUD); 404; 409 (final; stale); 428. (422: none reachable: the body is
  // empty and the outcome is the adapter's.)
  const C = `${L}/${pending.body.id}/confirm`;
  const ifm2 = { "if-match": '"2"' };
  const confirmed = await mirrored("POST", C, { session: td, headers: ifm2, body: {} });
  expect([confirmed.status, confirmed.body.write.status]).toEqual([200, "pending_confirmation"]);
  expect((await mirrored("POST", C, { session: td, headers: ifm2, body: [] })).status).toBe(400);
  expect((await mirrored("POST", C, { headers: ifm2, body: {} })).status).toBe(401);
  expect((await mirrored("POST", C, { session: auditor, headers: ifm2, body: {} })).status).toBe(403);
  expect((await mirrored("POST", `${L}/${missing}/confirm`, { session: td, headers: ifm2, body: {} })).status).toBe(
    404,
  );
  const final = await mirrored("POST", `${one}/confirm`, { session: td, headers: ifm2, body: {} });
  expect([final.status, final.body.code]).toEqual([409, "outbound_write.final"]);
  expect((await mirrored("POST", C, { session: td, headers: { "if-match": '"7"' }, body: {} })).status).toBe(409);
  expect((await mirrored("POST", C, { session: td, body: {} })).status).toBe(428);
}
