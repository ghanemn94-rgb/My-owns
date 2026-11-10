// F-DG6-181 (High, mandatory; REQ-S16-029, REQ-S10-004; ADR-0052 §5 and its amendment of 2026-11-04; D-209;
// T-DG6-BE-Z2): a SecretRef resolves only for the setting IT bound it to. SB-1 is the port of the code-security
// reviewer's reproduction (docs/delivery/test-evidence/DG6/code-security/round-2/repro/zz-cs-r2-secret-cross-org.test.ts)
// with the one binding line IT would add for organization B; before the fix it failed (201 and B's bearer captured at
// the attacker host, log 42). Real API, real env provider, disposable PostgreSQL; only the http_pull transport is a
// recorder. Every value, name, code and host is SYNTHETIC; the manifest holds names, scopes and hosts only.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpPullAdapter } from "../../../src/modules/integrations/adapters/http-pull.ts";
import {
  createConnectorAdapterRegistry,
  setConnectorAdapters,
  type ConnectorAdapterRegistry,
} from "../../../src/modules/integrations/adapters/port.ts";
import { connectorSecretUse } from "../../../src/modules/integrations/connectors.ts";
import { executeIntegrationRun } from "../../../src/modules/integrations/runs.ts";
import { resolveCredentials } from "../../../src/modules/integrations/secret-refs.ts";
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
} from "../../support/harness.ts";
import { bindSecrets } from "../../support/secret-bindings.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/connectors";
const ORGB_NAME = "MTH_SECRET_CS_R2_ORGB_ERP_TOKEN";
const ORGB_TOKEN = "synthetic-orgb-erp-token-cs-r2-e3f1";
const ORGA_NAME = "MTH_SECRET_Z2_ORGA_ERP_TOKEN";
const ORGA_TOKEN = "synthetic-orga-erp-token-z2-77c4";
const NOBODY = "MTH_SECRET_CS_R2_NOBODY_SET";
const S3_KEY = "MTH_SECRET_CS_S3_KEY";
const ORGB_SIGNING = "MTH_SECRET_CS_ORGB_SIGNING";
const ORGA_SMTP = "MTH_SECRET_Z2_ORGA_SMTP_PASSWORD";
const ORGB_HOST = "erp.orgb.example.invalid";
const ORGA_HOST = "erp.orga.example.invalid";
const ATTACKER = "https://collector.attacker.example.invalid/x";

const captured: { url: string; authorization: string | null }[] = [];
const logLines: string[] = [];
let api: TestApi;
let w: World;
let adminA: Session; // ADM_TECH + ADM_ACCESS @ orgA only
let adminB: Session; // ADM_TECH @ orgB only
let previousAdapters: ConnectorAdapterRegistry;
let unbind: () => void = () => undefined;

/** The manifest of this file (what IT would declare for the two organizations and the installation). */
function bindAll(over: { dropOrgB?: boolean } = {}) {
  unbind();
  unbind = bindSecrets([
    ...(over.dropOrgB
      ? []
      : [{ name: ORGB_NAME, consumer: "connector" as const, organization: w.orgB.code, hosts: [ORGB_HOST] }]),
    { name: ORGA_NAME, consumer: "connector", organization: w.orgA.code, hosts: [ORGA_HOST] },
    { name: S3_KEY, consumer: "storage", organization: null, hosts: ["objects.it.example.invalid"] },
    { name: ORGB_SIGNING, consumer: "webhook_signing", organization: w.orgB.code },
    { name: ORGA_SMTP, consumer: "smtp", organization: w.orgA.code, hosts: ["smtp.orga.example.invalid:587"] },
  ]);
}

beforeAll(async () => {
  process.env[ORGB_NAME] = ORGB_TOKEN;
  process.env[ORGA_NAME] = ORGA_TOKEN;
  process.env[S3_KEY] = "synthetic-s3-key-z2";
  process.env[ORGB_SIGNING] = "whsec-synthetic-orgb-z2";
  process.env[ORGA_SMTP] = "synthetic-smtp-password-z2";
  delete process.env[NOBODY];
  api = await startApi({ logStream: { write: (line: string) => void logLines.push(line) } });
  previousAdapters = setConnectorAdapters(
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
  adminA = await signIn(api.app, w.admin.subject);
  const b = await createUser(api.db, w.orgB.id);
  await grant(api.db, w.grantor.id, b.id, "ADM_TECH", { type: "organization", id: w.orgB.id }, w.orgB.id);
  adminB = await signIn(api.app, b.subject);
  adminBId = b.id;
  bindAll();
}, 240_000);

afterAll(async () => {
  unbind();
  setConnectorAdapters(previousAdapters);
  for (const n of [ORGB_NAME, ORGA_NAME, S3_KEY, ORGB_SIGNING, ORGA_SMTP]) delete process.env[n];
  await api?.close();
});

beforeEach(() => bindAll());

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
      reason: "Synthetic cross-organization SecretRef probe.",
    },
  };
}

const attackerCalls = () => captured.filter((c) => c.url.includes("attacker"));
const connectorCount = async (orgId: string) =>
  Number(
    (
      await api.db
        .selectFrom("connector")
        .select((e) => e.fn.countAll().as("n"))
        .where("organization_id", "=", orgId)
        .executeTakeFirstOrThrow()
    ).n,
  );
const refusals = (actor: string) =>
  api.db
    .selectFrom("audit_event")
    .select(["action", "actor_user_id", "organization_id", "record_type", "record_id", "reason", "changes"])
    .where("action", "=", "secret_ref.refused")
    .where("actor_user_id", "=", actor)
    .orderBy("occurred_at")
    .execute();
const comparable = (r: { status: number; body: Body }) => ({
  status: r.status,
  type: r.body.type,
  code: r.body.code,
  errors: r.body.errors,
});
const fieldError = (pointer: string, code: string) =>
  expect.arrayContaining([expect.objectContaining({ pointer, code })]);

let adminBId: string;

describe("F-DG6-181: a SecretRef is bound to its setting, its organization and its hosts", () => {
  let ownId: string;
  let sb1Refusal: { status: number; body: Body };

  it("SB-1 (the reviewer's reproduction): A cannot name B's connector secret; nothing is sent; one refusal is audited", async () => {
    const own = await call<Body>(api.app, "POST", L, {
      session: adminB,
      body: body(w.orgB.id, `https://${ORGB_HOST}/api`, ORGB_NAME),
    });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body.config.credentialRefs.bearer).toEqual({ provider: "env", name: ORGB_NAME, resolvable: true });
    ownId = own.body.id;
    const peek = await call<Body>(api.app, "GET", `${L}/${ownId}`, { session: adminA, contract: false });
    expect(peek.status).toBe(404);

    const before = await connectorCount(w.orgA.id);
    const a = await call<Body>(api.app, "POST", L, { session: adminA, body: body(w.orgA.id, ATTACKER, ORGB_NAME) });
    expect(a.status, JSON.stringify(a.body)).toBe(400);
    expect(a.body.code).toBe("validation");
    expect(a.body.errors).toEqual([
      {
        pointer: "/config/credentialRefs/bearer",
        code: "validation.secret_ref_not_bound",
        message:
          "Name a secret IT bound to this setting. IT binds each secret to one kind of setting and one organization.",
      },
    ]);
    expect(await connectorCount(w.orgA.id)).toBe(before);
    sb1Refusal = a;

    const actor = w.admin.id;
    const audited = await refusals(actor);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      action: "secret_ref.refused",
      organization_id: w.orgA.id,
      record_type: "user",
      record_id: actor,
      changes: null,
    });
    expect(audited[0]!.reason).toContain(`connector reference env:${ORGB_NAME} not bound`);
    expect(audited[0]!.reason).toMatch(/^POST \/api\/v1\/admin\/connectors: /);
    expect(attackerCalls()).toEqual([]);
    expect(JSON.stringify(audited)).not.toContain(ORGB_TOKEN);
  }, 180_000);

  it("SB-2 (no oracle): an unset unbound name and B's name with B's variable unset give SB-1's exact answer", async () => {
    const nobody = await call<Body>(api.app, "POST", L, { session: adminA, body: body(w.orgA.id, ATTACKER, NOBODY) });
    delete process.env[ORGB_NAME];
    try {
      const unset = await call<Body>(api.app, "POST", L, {
        session: adminA,
        body: body(w.orgA.id, ATTACKER, ORGB_NAME),
      });
      expect(comparable(nobody)).toEqual(comparable(sb1Refusal));
      expect(comparable(unset)).toEqual(comparable(sb1Refusal));
    } finally {
      process.env[ORGB_NAME] = ORGB_TOKEN;
    }
    expect(attackerCalls()).toEqual([]);
  });

  it("SB-3 (host rule, own organization): B cannot point its own bound secret at another host", async () => {
    const current = await call<Body>(api.app, "GET", `${L}/${ownId}`, { session: adminB });
    const next = { ...body(w.orgB.id, ATTACKER, ORGB_NAME).config, reason: "Synthetic endpoint change." };
    const res = await call<Body>(api.app, "PUT", `${L}/${ownId}`, {
      session: adminB,
      body: { nameEn: "Synthetic source", nameAr: "مصدر اصطناعي", config: next },
      headers: { "if-match": `"${current.body.version}"` },
      contract: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ pointer: "/config/endpointUrl", code: "validation.secret_ref_host_not_bound" }),
    ]);
    const audited = await refusals(adminBId);
    expect(audited.at(-1)!.reason).toContain(`not bound to host collector.attacker.example.invalid:443`);
    const t = await call<Body>(api.app, "POST", `${L}/${ownId}/test`, { session: adminB, body: {} });
    expect(t.status).toBe(200);
    expect(attackerCalls()).toEqual([]);
    expect(
      captured.filter((c) => c.url.includes(ORGB_HOST)).every((c) => c.authorization === `Bearer ${ORGB_TOKEN}`),
    ).toBe(true);
  });

  it("SB-4 (resolve time, fail closed): a reference written past the API resolves as unset; nothing is sent", async () => {
    // A stored reference that is not bound to its setting (configuration versions are append-only, so it is stored
    // the way it arises in production: IT had bound B's secret to organization A at B's host by mistake and then
    // corrected the manifest). Stored on A's connector, pointed at B's host, so only the binding stands in the way.
    unbind();
    unbind = bindSecrets([{ name: ORGB_NAME, consumer: "connector", organization: w.orgA.code, hosts: [ORGB_HOST] }]);
    const created = await call<Body>(api.app, "POST", L, {
      session: adminA,
      body: body(w.orgA.id, `https://${ORGB_HOST}/a-side`, ORGB_NAME),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    bindAll();
    const enabled = await call<Body>(api.app, "POST", `${L}/${id}/enable`, {
      session: adminA,
      body: { reason: "Synthetic enable." },
      headers: { "if-match": `"${created.body.version}"` },
    });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
    logLines.length = 0;
    const view = await call<Body>(api.app, "GET", `${L}/${id}`, { session: adminA });
    expect(view.body.config.credentialRefs.bearer.resolvable).toBe(false);
    const t = await call<Body>(api.app, "POST", `${L}/${id}/test`, { session: adminA, body: {} });
    expect(t.body.errorCode).toBe("connector.secret_unresolvable");
    const queued = await call<Body>(api.app, "POST", `${L}/${id}/runs`, { session: adminA, body: {} });
    expect(queued.status, JSON.stringify(queued.body)).toBe(202);
    await executeIntegrationRun(api.db, queued.body.id);
    const run = await api.db
      .selectFrom("integration_run")
      .select(["status", "error_code"])
      .where("id", "=", queued.body.id)
      .executeTakeFirstOrThrow();
    expect(run).toEqual({ status: "failed", error_code: "connector.secret_unresolvable" });
    // The outbound dispatch resolves through the same function with the connector's use (outbound.ts callAdapter):
    // it refuses, so callAdapter answers no_response with nothing dispatched.
    const row = await api.db.selectFrom("connector").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    const config = await api.db
      .selectFrom("connector_config_version")
      .selectAll()
      .where("connector_id", "=", id)
      .orderBy("version_no", "desc")
      .executeTakeFirstOrThrow();
    await expect(resolveCredentials(config.credential_refs, connectorSecretUse(row, config))).rejects.toMatchObject({
      code: "connector.secret_unresolvable",
    });
    expect(captured.filter((c) => c.url.includes("/a-side"))).toEqual([]);
    const warned = logLines.filter((l) => l.includes('"event":"secret_ref.refused"'));
    expect(warned.length).toBeGreaterThan(0);
    expect(warned.some((l) => l.includes(ORGB_NAME) && l.includes('"reason":"not_bound"'))).toBe(true);
    expect(logLines.join("\n")).not.toContain(ORGB_TOKEN);

    // IT removes B's binding: B's own connector is no longer resolvable and its test fails closed.
    bindAll({ dropOrgB: true });
    const own = await call<Body>(api.app, "GET", `${L}/${ownId}`, { session: adminB });
    expect(own.body.config.credentialRefs.bearer.resolvable).toBe(false);
    const ownTest = await call<Body>(api.app, "POST", `${L}/${ownId}/test`, { session: adminB, body: {} });
    expect(ownTest.body.errorCode).toBe("connector.secret_unresolvable");
  }, 180_000);

  it("SB-5 (installation and cross-kind): every consumer refuses a secret bound to another kind or scope", async () => {
    const ref = (name: string) => ({ provider: "env", name });
    const notBound = "validation.secret_ref_not_bound";
    // An org-A connector naming the installation's S3 key, and B's webhook signing secret.
    for (const name of [S3_KEY, ORGB_SIGNING]) {
      const r = await call<Body>(api.app, "POST", L, {
        session: adminA,
        body: body(w.orgA.id, `https://${ORGA_HOST}/x`, name),
      });
      expect(r.status).toBe(400);
      expect(r.body.errors).toEqual(fieldError("/config/credentialRefs/bearer", notBound));
    }
    // Org A's SMTP channel naming the S3 key.
    const smtp = await call<Body>(
      api.app,
      "PUT",
      `/api/v1/admin/notification-channels/email?organizationId=${w.orgA.id}`,
      {
        session: adminA,
        headers: { "if-match": '"0"' },
        body: {
          enabled: true,
          smtp: {
            host: "smtp.orga.example.invalid",
            port: 587,
            security: "starttls",
            usernameRef: ref(ORGA_SMTP),
            passwordRef: ref(S3_KEY),
            fromAddress: "hub-noreply@example.invalid",
          },
          reason: "Synthetic SMTP binding check.",
        },
        contract: false,
      },
    );
    expect(smtp.status, JSON.stringify(smtp.body)).toBe(400);
    expect(smtp.body.errors).toEqual([expect.objectContaining({ pointer: "/smtp/passwordRef", code: notBound })]);
    // An org-A webhook endpoint naming B's signing secret.
    const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.admin.id);
    const hookBody = body(w.orgA.id, null, null, "webhook");
    const hook = await call<Body>(api.app, "POST", L, {
      session: adminA,
      body: { ...hookBody, targetKind: "kpi_actual", config: { ...hookBody.config, targetTransformationId: tx } },
    });
    expect(hook.status, JSON.stringify(hook.body)).toBe(201);
    const endpoint = await call<Body>(api.app, "POST", "/api/v1/admin/webhooks", {
      session: adminA,
      body: {
        connectorId: hook.body.id,
        label: "Synthetic sender",
        signingSecretRef: ref(ORGB_SIGNING),
        toleranceSeconds: 300,
      },
    });
    expect(endpoint.status, JSON.stringify(endpoint.body)).toBe(400);
    expect(endpoint.body.errors).toEqual(fieldError("/signingSecretRef", notBound));
    // The installation settings naming B's connector secret.
    const storage = await call<Body>(api.app, "PUT", "/api/v1/admin/storage", {
      session: adminA,
      headers: { "if-match": '"0"' },
      body: {
        driver: "s3",
        s3: {
          endpoint: "https://objects.it.example.invalid",
          region: "synthetic-1",
          bucket: "synthetic-bucket",
          keyPrefix: null,
          forcePathStyle: true,
          accessKeyRef: ref(S3_KEY),
          secretKeyRef: ref(ORGB_NAME),
        },
        reason: "Synthetic storage binding check.",
      },
      contract: false,
    });
    expect(storage.status, JSON.stringify(storage.body)).toBe(400);
    expect(storage.body.errors).toEqual([expect.objectContaining({ pointer: "/s3/secretKeyRef", code: notBound })]);
    const assistant = await call<Body>(api.app, "PUT", "/api/v1/admin/assistant", {
      session: adminA,
      headers: { "if-match": '"0"' },
      body: {
        providerKind: "http_endpoint",
        endpointUrl: "https://llm.it.example.invalid/v1",
        apiStyle: "openai_chat_completions",
        modelName: "synthetic-model",
        credentialRef: ref(ORGB_NAME),
        authorizationReference: "IT-APPROVAL-SYNTHETIC-Z2",
        requestTimeoutMs: 5000,
        maxOutputTokens: 512,
        maxContextRecords: 4,
        reason: "Synthetic assistant binding check.",
      },
      contract: false,
    });
    expect(assistant.status, JSON.stringify(assistant.body)).toBe(400);
    expect(assistant.body.errors).toEqual(fieldError("/credentialRef", notBound));
    // Each refused request was audited once; the installation settings with no organization.
    const audited = await refusals(w.admin.id);
    const installation = audited.filter((a) => /storage|assistant reference/.test(a.reason ?? ""));
    expect(installation.length).toBe(2);
    expect(installation.every((a) => a.organization_id === null)).toBe(true);
  }, 180_000);

  it("SB-6 (SMTP host): a bound SMTP secret sent to another host is refused at /smtp/host", async () => {
    const res = await call<Body>(
      api.app,
      "PUT",
      `/api/v1/admin/notification-channels/email?organizationId=${w.orgA.id}`,
      {
        session: adminA,
        headers: { "if-match": '"0"' },
        body: {
          enabled: true,
          smtp: {
            host: "attacker.example.invalid",
            port: 587,
            security: "starttls",
            usernameRef: { provider: "env", name: ORGA_SMTP },
            passwordRef: { provider: "env", name: ORGA_SMTP },
            fromAddress: "hub-noreply@example.invalid",
          },
          reason: "Synthetic SMTP host check.",
        },
        contract: false,
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ pointer: "/smtp/host", code: "validation.secret_ref_host_not_bound" }),
    ]);
  });

  it("SB-7 (manifest unset): with an empty manifest even B's own create is refused (fail closed)", async () => {
    unbind();
    unbind = bindSecrets([]);
    const res = await call<Body>(api.app, "POST", L, {
      session: adminB,
      body: body(w.orgB.id, `https://${ORGB_HOST}/api`, ORGB_NAME),
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(fieldError("/config/credentialRefs/bearer", "validation.secret_ref_not_bound"));
  });

  it("SB-8 (the organization code the binding relies on is immutable in the product)", async () => {
    const org = await call<Body>(api.app, "GET", `/api/v1/organizations/${w.orgA.id}`, {
      session: adminA,
      contract: false,
    });
    const res = await call<Body>(api.app, "PATCH", `/api/v1/organizations/${w.orgA.id}`, {
      session: adminA,
      body: { code: "X" },
      headers: { "if-match": `"${org.body.version ?? 1}"` },
      contract: false,
    });
    expect(res.status).toBe(400);
    const after = await api.db
      .selectFrom("organization")
      .select("code")
      .where("id", "=", w.orgA.id)
      .executeTakeFirstOrThrow();
    expect(after.code).toBe(w.orgA.code);
    const openapi = readFileSync(new URL("../../../../../docs/api/openapi.yaml", import.meta.url), "utf8");
    const update = openapi.slice(openapi.indexOf("    OrganizationUpdate:"));
    const block = update.slice(
      0,
      update.indexOf("\n    ", update.indexOf("\n") + 1) === -1 ? undefined : update.search(/\n    [A-Za-z]/),
    );
    expect(block).toContain("OrganizationUpdate:");
    expect(block).not.toMatch(/\n\s+code:/);
  });
});
