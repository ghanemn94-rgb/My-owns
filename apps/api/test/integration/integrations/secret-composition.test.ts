// The SecretProvider registry reaches the integrations module through the REAL composition root (T-DG6-BE-X2;
// F-DG6-QA-A-1; ADR-0052 §5, ADR-0055 §1, ADR-0056 §7; REQ-S17-003, REQ-S17-001).
//
// Every other integrations suite injects its own registry with `setConnectorSecretProviders`, which hid that
// `buildServer` never handed its registry over: in the running product every webhook signing secret and every
// connector credential reference was unresolvable. This file never calls `setConnectorSecretProviders`: the registry
// is the one `buildServer` (server.ts) creates with the built-in `env` provider, which reads this process's variables.
//  1. a correctly signed webhook delivery -> 202 and a staged batch; a delivery signed with another secret -> 401;
//  2. a connector's credential view: a set variable is `resolvable: true`, an unset one `false` (never null, which
//     means "no registry", and never a value);
//  3. a run of a test connector with a credential reference: resolved -> `succeeded`; unset -> `failed` with
//     connector.secret_unresolvable.
// Every value and secret is SYNTHETIC; nothing here approves anything (G1-G6) or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeIntegrationRun } from "../../../src/modules/integrations/runs.ts";
import { webhookSignature } from "../../../src/modules/integrations/webhooks.ts";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { assertContract } from "../../support/contract.ts";
import { DIRECT_FLOW, monthlyPeriod, ownedKpi } from "../kpi-p4/kbe-c-fixtures.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const CONNECTORS = "/api/v1/admin/connectors";
// Variable names unique to this file (the integration files of one run share the process environment of their
// worker only; the names keep them apart from every other suite anyway).
const SIGNING_NAME = "MTH_BE_X2_COMPOSITION_SIGNING_SECRET";
const SIGNING_VALUE = "whsec-SYNTHETIC-be-x2-composition-5c2a";
const CREDENTIAL_NAME = "MTH_BE_X2_COMPOSITION_API_TOKEN";
const CREDENTIAL_VALUE = "tok-SYNTHETIC-be-x2-composition-91d0";
const UNSET_NAME = "MTH_BE_X2_COMPOSITION_NEVER_SET";

let api: TestApi;
let w: World;
let k: KpiWorld;
let admin: Session; // ADM_TECH @ A
let kpiId: string;

beforeAll(async () => {
  process.env[SIGNING_NAME] = SIGNING_VALUE;
  process.env[CREDENTIAL_NAME] = CREDENTIAL_VALUE;
  delete process.env[UNSET_NAME];
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  admin = await signIn(api.app, w.admin.subject);
  kpiId = (await ownedKpi(api, k, DIRECT_FLOW)).id;
}, 120_000);

afterAll(async () => {
  delete process.env[SIGNING_NAME];
  delete process.env[CREDENTIAL_NAME];
  await api?.close();
});

const ifm = (v: number) => ({ "if-match": `"${v}"` });

async function enabledConnector(o: {
  adapterKind: "webhook" | "test_adapter";
  targetKind: "kpi_actual" | "none";
  credentialRefs?: Record<string, { provider: string; name: string }>;
  adapterSettings?: Record<string, unknown>;
}): Promise<string> {
  const created = await call<Body>(api.app, "POST", CONNECTORS, {
    session: admin,
    body: {
      organizationId: w.orgA.id,
      code: uniq("x2-").toLowerCase(),
      nameEn: "Synthetic composition source",
      nameAr: "مصدر اصطناعي للتركيب",
      adapterKind: o.adapterKind,
      targetKind: o.targetKind,
      config: {
        sourceSystemId: "synthetic.be-x2:composition",
        endpointUrl: null,
        credentialRefs: o.credentialRefs ?? {},
        fieldMappings: [],
        targetTransformationId: o.targetKind === "kpi_actual" ? k.transformationId : null,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: [],
        reconciliationRule: "none",
        adapterSettings: o.adapterSettings ?? {},
        reason: "Synthetic connector for the BE-X2 composition suite.",
      },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const enabled = await call<Body>(api.app, "POST", `${CONNECTORS}/${created.body.id}/enable`, {
    session: admin,
    headers: ifm(1),
    body: { reason: null },
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  return created.body.id as string;
}

async function deliver(key: string, body: unknown, secret: string, deliveryId: string) {
  const raw = Buffer.from(JSON.stringify(body));
  const ts = String(Math.floor(Date.now() / 1000));
  const url = `/api/v1/webhooks/${key}`;
  const res = await call<Body>(api.app, "POST", url, {
    headers: {
      "content-type": "application/json",
      "x-mth-webhook-timestamp": ts,
      "x-mth-webhook-delivery": deliveryId,
      "x-mth-webhook-signature": `v1=${webhookSignature(secret, ts, deliveryId, raw)}`,
    },
    body: raw,
    contract: false,
  });
  assertContract("POST", url, { statusCode: res.raw.statusCode, headers: res.raw.headers, body: res.raw.body });
  return res;
}

describe("the composition root hands its SecretProvider registry to integrations (F-DG6-QA-A-1)", () => {
  it("a correctly signed webhook is accepted through buildServer's own registry; another secret is refused 401", async () => {
    const connectorId = await enabledConnector({ adapterKind: "webhook", targetKind: "kpi_actual" });
    const e = await call<Body>(api.app, "POST", "/api/v1/admin/webhooks", {
      session: admin,
      body: {
        connectorId,
        label: "Synthetic composition sender",
        signingSecretRef: { provider: "env", name: SIGNING_NAME },
        toleranceSeconds: 300,
      },
    });
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    const period = (await monthlyPeriod(api, w)).label;
    const body = {
      templateVersion: "kpi_actual.v1",
      items: [
        {
          source_record_id: "X2-01",
          kpi_id: kpiId,
          scope_kind: "transformation",
          scope_id: k.transformationId,
          period_label: period,
          value: "42.5",
          data_as_of: "2041-01-31",
        },
      ],
    };
    // Negative first: a delivery signed with any other secret stays 401 and stores nothing.
    const wrong = await deliver(e.body.endpointKey, body, "whsec-SYNTHETIC-not-the-secret", "x2-dlv-wrong");
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(401);
    expect(wrong.body.code).toBe("webhook.unauthenticated");
    const ok = await deliver(e.body.endpointKey, body, SIGNING_VALUE, "x2-dlv-signed");
    expect(ok.status, JSON.stringify(ok.body)).toBe(202);
    expect(ok.body).toMatchObject({ replay: false, rowsTotal: 1, rowsValid: 1, rowsInvalid: 0, rowsDuplicate: 0 });
    const receipts = await api.db
      .selectFrom("webhook_receipt")
      .select(["delivery_id", "secret_slot"])
      .where("webhook_endpoint_id", "=", e.body.id)
      .execute();
    expect(receipts).toEqual([{ delivery_id: "x2-dlv-signed", secret_slot: "current" }]);
    expect(JSON.stringify(ok.body)).not.toContain(SIGNING_VALUE);
  });

  it("a connector's credential view says whether each reference resolves (true / false, never null or a value)", async () => {
    const id = await enabledConnector({
      adapterKind: "test_adapter",
      targetKind: "none",
      credentialRefs: {
        api: { provider: "env", name: CREDENTIAL_NAME },
        missing: { provider: "env", name: UNSET_NAME },
      },
      adapterSettings: { mode: "healthy" },
    });
    const res = await call<Body>(api.app, "GET", `${CONNECTORS}/${id}`, { session: admin });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.config.credentialRefs).toEqual({
      api: { provider: "env", name: CREDENTIAL_NAME, resolvable: true },
      missing: { provider: "env", name: UNSET_NAME, resolvable: false },
    });
    expect(JSON.stringify(res.body)).not.toContain(CREDENTIAL_VALUE);
  });

  it("a connector run resolves its credential through the composed registry; an unset reference fails the run", async () => {
    const runOf = async (connectorId: string) => {
      const queued = await call<Body>(api.app, "POST", `${CONNECTORS}/${connectorId}/runs`, {
        session: admin,
        body: {},
      });
      expect(queued.status, JSON.stringify(queued.body)).toBe(202);
      const done = await executeIntegrationRun(api.db, queued.body.id as string);
      expect(done.outcome).not.toBe("skipped");
      return api.db
        .selectFrom("integration_run")
        .select(["status", "error_code", "error_message"])
        .where("id", "=", queued.body.id as string)
        .executeTakeFirstOrThrow();
    };
    const resolved = await enabledConnector({
      adapterKind: "test_adapter",
      targetKind: "none",
      credentialRefs: { api: { provider: "env", name: CREDENTIAL_NAME } },
      adapterSettings: { mode: "healthy" },
    });
    expect(await runOf(resolved)).toMatchObject({ status: "succeeded", error_code: null });
    const unresolved = await enabledConnector({
      adapterKind: "test_adapter",
      targetKind: "none",
      credentialRefs: { api: { provider: "env", name: UNSET_NAME } },
      adapterSettings: { mode: "healthy" },
    });
    const failed = await runOf(unresolved);
    expect(failed).toMatchObject({ status: "failed", error_code: "connector.secret_unresolvable" });
    expect(failed.error_message).toContain(UNSET_NAME);
    expect(failed.error_message).not.toContain(CREDENTIAL_VALUE);
  });
});
