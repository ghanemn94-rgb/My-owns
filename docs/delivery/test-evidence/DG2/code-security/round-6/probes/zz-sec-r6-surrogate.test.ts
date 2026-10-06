// code-security-reviewer DG2 round-6 probe (T-DG2-REV-SEC-R6), supports F-DG2-260. NOT part of the candidate: copied into
// a disposable clone (51a692b1) at apps/api/test/integration/ and run on a scratch database of a disposable PostgreSQL 16
// with the candidate's local fake OpenID Provider. All data SYNTHETIC.
// A lone UTF-16 surrogate is valid in a JSON string escape ("\ud800") and survives JSON.parse. node-postgres sends a JS
// string parameter as UTF-8, so a text column receives U+FFFD. JSON.stringify keeps it as the escape "\ud800", and
// PostgreSQL's json/jsonb input refuses a lone surrogate escape with SQLSTATE 22P02, which the API maps to
// 400 validation.format (pointer ""). The OIDC callback's contract declares only 302 and 429.
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../../packages/db/src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../../../../packages/db/test/helpers.ts";
import { FakeIdp } from "../support/fake-idp.ts";
import { call, createOrg, createUser, seedWorld, startApi, type TestApi } from "../support/harness.ts";
import { setupP2World } from "../support/p2-fixtures.ts";

const { adminUrl } = testDatabase();
let dbName: string;
let idp: FakeIdp;
let api: TestApi;
let mainApi: TestApi;
let orgId: string;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);

beforeAll(async () => {
  dbName = await createScratchDatabase(adminUrl, "mth_oidc_r6s");
  await migrate(roleUrl(adminUrl, dbName, "mth_owner"));
  idp = await new FakeIdp().start();
  api = await startApi({
    env: {
      AUTH_MODE: "oidc",
      OIDC_ISSUER_URL: idp.issuer,
      OIDC_CLIENT_ID: idp.clientId,
      OIDC_CLIENT_SECRET: idp.clientSecret,
      DATABASE_URL: roleUrl(adminUrl, dbName, "mth_app"),
    },
  });
  orgId = (await createOrg(api.db, "OIDCR6S")).id;
  mainApi = await startApi();
});
afterAll(async () => {
  await api.close();
  await mainApi.close();
  await idp.stop();
  await dropScratchDatabase(adminUrl, dbName);
});

const cookies = (res: { headers: Record<string, unknown> }) => {
  const h = res.headers["set-cookie"];
  return h === undefined ? [] : Array.isArray(h) ? h.map(String) : [String(h)];
};
async function login(claims: Parameters<FakeIdp["issueCode"]>[1]) {
  const start = await call(api.app, "GET", "/api/v1/auth/login");
  const loginCookie = cookies(start).find((c) => c.startsWith("mth_login="))!.split(";")[0]!;
  const { code, state } = idp.issueCode(String(start.headers["location"]), claims, {});
  const cb = await call(api.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`, { headers: { cookie: loginCookie }, contract: false });
  return cb;
}
async function contractVerdict(res: { status: number; headers: Record<string, unknown>; body: unknown; raw: { body: string } }) {
  try {
    const { assertContract } = await import("../support/contract.ts");
    assertContract("GET", "/api/v1/auth/callback", { statusCode: res.status, headers: res.headers, body: res.raw.body });
    return "declared";
  } catch (e) {
    return `contract check: ${(e as Error).message.split("\n")[0]}`;
  }
}
const auditFor = async (rid: string) =>
  (await sql<{ action: string; reason: string | null }>`select action, reason from audit_event where request_id = ${rid}`.execute(api.db)).rows;

describe("OIDC callback: lone surrogate in sub (F-DG2-260)", () => {
  it("JIT path: new subject 'r6s-jit-\\ud800' -> must be the declared 302 (token_invalid), audited", async () => {
    const cb = await login({ sub: "r6s-jit-\ud800", name: "Synthetic JIT" });
    const rid = String(cb.headers["x-request-id"]);
    const users = await sql<{ n: string }>`select count(*) n from user_identity where subject like 'r6s-jit-%'`.execute(api.db);
    log("260.jit", { status: cb.status, contentType: cb.headers["content-type"], location: cb.headers["location"] ?? null, body: cb.body, setCookie: cookies(cb), audit: await auditFor(rid), identities: users.rows[0]!.n, contract: await contractVerdict(cb as never) });
    expect(Number(users.rows[0]!.n)).toBe(0);
    expect(cb.status).toBe(302);
  });
  it("bind path: pre-provisioned user with a verified e-mail, subject with a lone surrogate -> must be 302", async () => {
    await createUser(api.db, orgId, { email: "r6s-bind@example.invalid" });
    const cb = await login({ sub: "r6s-bind-\udfff", email: "r6s-bind@example.invalid", email_verified: true, name: "Synthetic Bind" });
    const rid = String(cb.headers["x-request-id"]);
    log("260.bind", { status: cb.status, location: cb.headers["location"] ?? null, body: cb.body, audit: await auditFor(rid), contract: await contractVerdict(cb as never) });
    expect(cb.status).toBe(302);
  });
});

describe("main API: lone surrogate in a value that reaches jsonb directly (journey steps)", () => {
  it("journey step name 'Synthetic\\ud800step' -> declared status, never 500 (observed status logged)", async () => {
    const w = await seedWorld(mainApi.db);
    const p = await setupP2World(mainApi, w);
    const T = `/api/v1/transformations/${p.transformationId}`;
    const res = await call(mainApi.app, "POST", `${T}/journeys`, {
      session: p.lead.session,
      body: { name: "Synthetic journey", kind: "journey", state: "current", steps: [{ key: "01920099-0000-7000-8000-0000000000ab", ordinal: 1, name: "Synthetic\ud800step" }] },
    });
    log("journey.steps", { status: res.status, body: res.body?.errors ?? res.body?.steps ?? res.body });
    expect(res.status).toBeLessThan(500);
  });
});
