// F-DG6-120 (REQ-S16-029 "never expose secrets"; ADR-0052 §5; T-DG6-BE-Y2), against a real API and a disposable
// PostgreSQL (a scratch database: the storage and assistant settings are installation-wide rows):
//  - every SecretRef consumer refuses, at write time, a reference outside its provider's namespace with 400
//    validation.secret_ref_namespace at the field's pointer and writes nothing: connector credentials, webhook signing
//    secrets (create and rotate), the SMTP channel, the S3 storage settings (save and test) and the assistant endpoint;
//    a platform variable (OIDC_CLIENT_SECRET, DATABASE_URL, ...) and a `file` path traversal are both refused;
//  - the refusal is the same whether the named variable exists or not (no existence oracle);
//  - a reference inside the namespace (env MTH_SECRET_<NAME>) is accepted and resolves (positive cases);
//  - at resolve time a reference stored before the fix (written straight into the scratch database) resolves nothing:
//    the connector test makes no outbound request and fails connector.secret_unresolvable, `resolvable` is false.
// The network transport of the http_pull adapter is replaced by a recorder (it stands in for an attacker's host);
// the env provider is the server's own, over process.env. Every value is SYNTHETIC.
import { migrate } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import {
  createConnectorAdapterRegistry,
  setConnectorAdapters,
  type ConnectorAdapterRegistry,
} from "../../../src/modules/integrations/adapters/port.ts";
import { createHttpPullAdapter } from "../../../src/modules/integrations/adapters/http-pull.ts";
import { FakeS3 } from "../../support/fake-s3.ts";
import { seedKpiWorld } from "../kpi/fixtures.ts";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const CONNECTORS = "/api/v1/admin/connectors";
const WEBHOOKS = "/api/v1/admin/webhooks";
const STORAGE = "/api/v1/admin/storage";
const ASSISTANT = "/api/v1/admin/assistant";
const PLATFORM_SECRET = "synthetic-oidc-client-secret-be-y2-41d0";
const FEED_TOKEN = "synthetic-feed-token-be-y2-8a3e";
const FEED_NAME = "MTH_SECRET_BE_Y2_FEED_TOKEN";
const SIGNING_NAME = "MTH_SECRET_BE_Y2_SIGNING";
const SIGNING_NEXT = "MTH_SECRET_BE_Y2_SIGNING_NEXT";
const SMTP_USER = "MTH_SECRET_BE_Y2_SMTP_USER";
const SMTP_PASS = "MTH_SECRET_BE_Y2_SMTP_PASS";
const S3_ACCESS = "MTH_SECRET_BE_Y2_S3_ACCESS";
const S3_SECRET = "MTH_SECRET_BE_Y2_S3_SECRET";
const MODEL_KEY = "MTH_SECRET_BE_Y2_MODEL_KEY";
const BUCKET = "mth-evidence";
/** The names a SecretRef must never reach: platform variables of the process, and a traversal for `file`. */
const REFUSED: readonly { provider: string; name: string }[] = [
  { provider: "env", name: "OIDC_CLIENT_SECRET" },
  { provider: "env", name: "DATABASE_URL" },
  { provider: "env", name: "DATABASE_OWNER_URL" },
  { provider: "env", name: "MTH_DEMO_ADMIN_DATABASE_URL" },
  { provider: "env", name: "OIDC_CLIENT_SECRET_FILE" },
  // Traversals that pass the SecretRef shape (a leading "." is already a shape refusal, 422 or 400 per consumer).
  { provider: "file", name: "x/../database_url" },
  { provider: "file", name: "secrets/../../run/secrets/oidc_client_secret" },
];
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });

let scratchDb: string;
let api: TestApi;
let w: World;
let admin: Session; // ADM_TECH + ADM_ACCESS @ org A
let nobody: Session;
let s3: FakeS3;
let previousAdapters: ConnectorAdapterRegistry;
const captured: { url: string; authorization: string | null }[] = [];
const SET_VARIABLES = [
  "OIDC_CLIENT_SECRET",
  "MTH_DEMO_ADMIN_DATABASE_URL",
  FEED_NAME,
  SIGNING_NAME,
  SIGNING_NEXT,
  SMTP_USER,
  SMTP_PASS,
  S3_ACCESS,
  S3_SECRET,
  MODEL_KEY,
];

/** 400 validation with exactly one field error validation.secret_ref_namespace at `pointer`; no value echoed. */
function expectNamespaceRefusal(res: { status: number; body: Body }, pointer: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(res.body.code).toBe("validation");
  expect(res.body.errors).toEqual([
    {
      pointer,
      code: "validation.secret_ref_namespace",
      message:
        "Name a secret IT provisioned for this setting: for the env provider a variable MTH_SECRET_<NAME>, for the " +
        "file provider a plain file name in the secrets directory.",
    },
  ]);
  expect(JSON.stringify(res.body)).not.toContain(PLATFORM_SECRET);
}

function connectorBody(refs: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    organizationId: w.orgA.id,
    code: uniq("y2-").toLowerCase(),
    nameEn: "Synthetic source",
    nameAr: "مصدر اصطناعي",
    adapterKind: "http_pull",
    targetKind: "none",
    ...over,
    config: {
      sourceSystemId: "synthetic.source:v1",
      endpointUrl: "https://collector.example.invalid/collect",
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
      reason: "Synthetic F-DG6-120 repair test.",
      ...((over["config"] as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

async function connectorCount(): Promise<number> {
  const r = await api.db
    .selectFrom("connector")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_secret_ns");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  s3 = new FakeS3({ buckets: [BUCKET] });
  await s3.start();
  // The platform secrets as a deployment sets them; the settings secrets IT provisions under MTH_SECRET_*.
  process.env["OIDC_CLIENT_SECRET"] = PLATFORM_SECRET;
  process.env["MTH_DEMO_ADMIN_DATABASE_URL"] = PLATFORM_SECRET;
  process.env[FEED_NAME] = FEED_TOKEN;
  process.env[SIGNING_NAME] = "synthetic-signing-secret-be-y2-a";
  process.env[SIGNING_NEXT] = "synthetic-signing-secret-be-y2-b";
  process.env[SMTP_USER] = "synthetic-smtp-user";
  process.env[SMTP_PASS] = "synthetic-smtp-pass";
  process.env[S3_ACCESS] = s3.credentials[0]!.accessKeyId;
  process.env[S3_SECRET] = s3.credentials[0]!.secretAccessKey;
  process.env[MODEL_KEY] = "synthetic-model-key-be-y2";
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
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  nobody = await signIn(api.app, w.nobody.subject);
}, 180_000);

afterAll(async () => {
  setConnectorAdapters(previousAdapters);
  for (const name of SET_VARIABLES) delete process.env[name];
  await api?.close();
  await s3?.stop();
  if (scratchDb) await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

describe("F-DG6-120: connector credentials", () => {
  it("refuses a platform variable or a file traversal at write time (400), writing nothing", async () => {
    const shape = await call<Body>(api.app, "POST", CONNECTORS, {
      session: admin,
      body: connectorBody({ bearer: { provider: "file", name: "../database_url" } }),
    });
    expect([shape.status, shape.body.errors?.[0]?.code]).toEqual([400, "validation.credential_refs"]);
    const before = await connectorCount();
    for (const ref of REFUSED) {
      const res = await call<Body>(api.app, "POST", CONNECTORS, {
        session: admin,
        body: connectorBody({ bearer: ref }),
      });
      expectNamespaceRefusal(res, "/config/credentialRefs/bearer");
    }
    expect(await connectorCount()).toBe(before);
    expect(captured).toEqual([]);
  });

  it("answers the same for a set and an unset platform variable (no existence oracle)", async () => {
    expect(process.env["OIDC_CLIENT_SECRET"]).toBe(PLATFORM_SECRET);
    expect(process.env["DATABASE_OWNER_URL"]).toBeUndefined();
    const strip = (b: Body) => ({ ...b, requestId: null });
    const set = await call<Body>(api.app, "POST", CONNECTORS, {
      session: admin,
      body: connectorBody({ k: { provider: "env", name: "OIDC_CLIENT_SECRET" } }),
    });
    const unset = await call<Body>(api.app, "POST", CONNECTORS, {
      session: admin,
      body: connectorBody({ k: { provider: "env", name: "DATABASE_OWNER_URL" } }),
    });
    expect([set.status, strip(set.body)]).toEqual([unset.status, strip(unset.body)]);
  });

  it("accepts an MTH_SECRET_* reference, which resolves and is sent (positive)", async () => {
    const created = await call<Body>(api.app, "POST", CONNECTORS, {
      session: admin,
      body: connectorBody({ bearer: { provider: "env", name: FEED_NAME } }),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.config.credentialRefs).toEqual({
      bearer: { provider: "env", name: FEED_NAME, resolvable: true },
    });
    captured.length = 0;
    const tested = await call<Body>(api.app, "POST", `${CONNECTORS}/${created.body.id}/test`, {
      session: admin,
      body: {},
    });
    expect(tested.status, JSON.stringify(tested.body)).toBe(200);
    expect(captured).toEqual([
      { url: "https://collector.example.invalid/collect", authorization: `Bearer ${FEED_TOKEN}` },
    ]);
  });

  it("a caller without connector.configure is still 403 (the authorization check runs as before)", async () => {
    const res = await call<Body>(api.app, "POST", CONNECTORS, {
      session: nobody,
      body: connectorBody({ bearer: { provider: "env", name: FEED_NAME } }),
    });
    expect(res.status).toBe(403);
  });

  it("a platform reference stored before the fix resolves nothing: no outbound request, resolvable false", async () => {
    const created = await call<Body>(api.app, "POST", CONNECTORS, {
      session: admin,
      body: connectorBody({ bearer: { provider: "env", name: FEED_NAME } }),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // The row as the round-1 candidate could write it (the scratch database only; the append-only guard is lifted for
    // this one statement by the table owner).
    const client = await api.owner.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE connector_config_version DISABLE TRIGGER USER");
      await client.query("UPDATE connector_config_version SET credential_refs = $1::jsonb WHERE connector_id = $2", [
        JSON.stringify({ bearer: { provider: "env", name: "OIDC_CLIENT_SECRET" } }),
        created.body.id,
      ]);
      await client.query("ALTER TABLE connector_config_version ENABLE TRIGGER USER");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const view = await call<Body>(api.app, "GET", `${CONNECTORS}/${created.body.id}`, { session: admin });
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.config.credentialRefs).toEqual({
      bearer: { provider: "env", name: "OIDC_CLIENT_SECRET", resolvable: false },
    });
    captured.length = 0;
    const tested = await call<Body>(api.app, "POST", `${CONNECTORS}/${created.body.id}/test`, {
      session: admin,
      body: {},
    });
    expect(JSON.stringify(tested.body)).not.toContain(PLATFORM_SECRET);
    expect(tested.body.errorCode, JSON.stringify(tested.body)).toBe("connector.secret_unresolvable");
    expect(captured).toEqual([]);
  });
});

describe("F-DG6-120: webhook signing secrets", () => {
  let connectorId: string;
  beforeAll(async () => {
    const k = await seedKpiWorld(api, w);
    const created = await call<Body>(api.app, "POST", CONNECTORS, {
      session: admin,
      body: connectorBody(
        {},
        {
          adapterKind: "webhook",
          targetKind: "kpi_actual",
          config: { endpointUrl: null, targetTransformationId: k.transformationId },
        },
      ),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const enabled = await call<Body>(api.app, "POST", `${CONNECTORS}/${created.body.id}/enable`, {
      session: admin,
      headers: ifm(1),
      body: { reason: null },
    });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
    connectorId = created.body.id;
  });

  it("refuses a platform variable or a traversal on create and on rotate (400); accepts MTH_SECRET_*", async () => {
    for (const ref of REFUSED) {
      const res = await call<Body>(api.app, "POST", WEBHOOKS, {
        session: admin,
        body: { connectorId, label: "Synthetic sender", signingSecretRef: ref, toleranceSeconds: 300 },
      });
      expectNamespaceRefusal(res, "/signingSecretRef");
    }
    const none = await api.db
      .selectFrom("webhook_endpoint")
      .selectAll()
      .where("connector_id", "=", connectorId)
      .execute();
    expect(none).toEqual([]);
    const created = await call<Body>(api.app, "POST", WEBHOOKS, {
      session: admin,
      body: {
        connectorId,
        label: "Synthetic sender",
        signingSecretRef: { provider: "env", name: SIGNING_NAME },
        toleranceSeconds: 300,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    for (const ref of REFUSED) {
      const res = await call<Body>(api.app, "POST", `${WEBHOOKS}/${created.body.id}/rotate-secret`, {
        session: admin,
        headers: ifm(created.body.version),
        body: { signingSecretRef: ref, graceHours: 24, reason: "Synthetic rotation" },
      });
      expectNamespaceRefusal(res, "/signingSecretRef");
    }
    const rotated = await call<Body>(api.app, "POST", `${WEBHOOKS}/${created.body.id}/rotate-secret`, {
      session: admin,
      headers: ifm(created.body.version),
      body: { signingSecretRef: { provider: "env", name: SIGNING_NEXT }, graceHours: 24, reason: "Synthetic rotation" },
    });
    expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);
    expect(rotated.body.signingSecretRef).toEqual({ provider: "env", name: SIGNING_NEXT });
  });
});

describe("F-DG6-120: the SMTP notification channel", () => {
  const url = () => `/api/v1/admin/notification-channels/email?organizationId=${w.orgA.id}`;
  const smtp = (over: Record<string, unknown>) => ({
    host: "127.0.0.1",
    port: 2525,
    security: "none",
    usernameRef: { provider: "env", name: SMTP_USER },
    passwordRef: { provider: "env", name: SMTP_PASS },
    fromAddress: "hub-noreply@example.invalid",
    ...over,
  });

  it("refuses a platform variable or a traversal as username or password (400); accepts MTH_SECRET_*", async () => {
    for (const field of ["usernameRef", "passwordRef"] as const) {
      for (const ref of REFUSED) {
        const res = await call<Body>(api.app, "PUT", url(), {
          session: admin,
          headers: ifm(0),
          body: { enabled: true, smtp: smtp({ [field]: ref }), reason: "Synthetic channel" },
        });
        expectNamespaceRefusal(res, `/smtp/${field}`);
      }
    }
    const row = await api.db
      .selectFrom("notification_channel")
      .selectAll()
      .where("organization_id", "=", w.orgA.id)
      .executeTakeFirst();
    expect(row).toBeUndefined();
    const saved = await call<Body>(api.app, "PUT", url(), {
      session: admin,
      headers: ifm(0),
      body: { enabled: true, smtp: smtp({}), reason: "Synthetic channel" },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.smtp.passwordRef).toEqual({ provider: "env", name: SMTP_PASS });
  });
});

describe("F-DG6-120: the S3 storage settings", () => {
  const s3Of = (over: Record<string, unknown>) => ({
    endpoint: s3.endpoint,
    region: s3.region,
    bucket: BUCKET,
    keyPrefix: "hub",
    forcePathStyle: true,
    accessKeyRef: { provider: "env", name: S3_ACCESS },
    secretKeyRef: { provider: "env", name: S3_SECRET },
    ...over,
  });

  it("refuses a platform variable or a traversal in the test and the save (400); MTH_SECRET_* tests passed", async () => {
    for (const field of ["accessKeyRef", "secretKeyRef"] as const) {
      for (const ref of REFUSED) {
        const tested = await call<Body>(api.app, "POST", `${STORAGE}/test`, {
          session: admin,
          body: { candidate: s3Of({ [field]: ref }) },
        });
        expectNamespaceRefusal(tested, `/candidate/${field}`);
        const saved = await call<Body>(api.app, "PUT", STORAGE, {
          session: admin,
          headers: { "if-match": '"0"' },
          body: { driver: "s3", s3: s3Of({ [field]: ref }), reason: "Synthetic storage" },
        });
        expectNamespaceRefusal(saved, `/s3/${field}`);
      }
    }
    expect(await api.db.selectFrom("storage_setting").selectAll().executeTakeFirst()).toBeUndefined();
    expect(s3.keys(BUCKET)).toEqual([]);
    const tested = await call<Body>(api.app, "POST", `${STORAGE}/test`, {
      session: admin,
      body: { candidate: s3Of({}) },
    });
    expect(tested.status, JSON.stringify(tested.body)).toBe(200);
    expect(tested.body.outcome, JSON.stringify(tested.body)).toBe("passed");
  });
});

describe("F-DG6-120: the assistant endpoint", () => {
  const setting = (credentialRef: unknown) => ({
    providerKind: "http_endpoint",
    endpointUrl: "https://model.example.invalid/v1/chat/completions",
    apiStyle: "openai_chat_completions",
    modelName: "synthetic-model-1",
    credentialRef,
    authorizationReference: "IT-APPROVAL-SYNTHETIC-0001",
    requestTimeoutMs: 30000,
    maxOutputTokens: 1024,
    maxContextRecords: 8,
    reason: "Synthetic test: configure the assistant",
  });

  it("refuses a platform variable or a traversal as the credential (400); accepts MTH_SECRET_*", async () => {
    for (const ref of REFUSED) {
      const res = await call<Body>(api.app, "PUT", ASSISTANT, { session: admin, headers: ifm(0), body: setting(ref) });
      expectNamespaceRefusal(res, "/credentialRef");
    }
    expect(await api.db.selectFrom("assistant_setting").selectAll().executeTakeFirst()).toBeUndefined();
    const saved = await call<Body>(api.app, "PUT", ASSISTANT, {
      session: admin,
      headers: ifm(0),
      body: setting({ provider: "env", name: MODEL_KEY }),
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.credentialRef).toEqual({ provider: "env", name: MODEL_KEY });
  });
});
