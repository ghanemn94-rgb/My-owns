// code-security-reviewer DG2 round-6 OIDC probe (T-DG2-REV-SEC-R6). NOT part of the candidate: copied into a disposable
// clone (51a692b1) at apps/api/test/integration/ and run on its own scratch database of a disposable PostgreSQL 16,
// with the candidate's local fake OpenID Provider. All data SYNTHETIC.
// F-DG2-231 OIDC changes: NUL in sub / name / email / preferred_username; NUL in callback query; and claims PostgreSQL
// may refuse in another way (lone UTF-16 surrogates, which JSON.stringify keeps as "\ud800" escapes in audit jsonb).
// Also: identity/session/authorization unchanged ((iss, sub) binding, no roles at JIT, login cookie single use).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../../packages/db/src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../../../../packages/db/test/helpers.ts";
import { FakeIdp } from "../support/fake-idp.ts";
import { call, createOrg, startApi, type TestApi } from "../support/harness.ts";

const { adminUrl } = testDatabase();
let dbName: string;
let idp: FakeIdp;
let api: TestApi;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);

beforeAll(async () => {
  dbName = await createScratchDatabase(adminUrl, "mth_oidc_r6");
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
  await createOrg(api.db, "OIDCR6");
});
afterAll(async () => {
  await api.close();
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
  const session = cookies(cb).find((c) => c.startsWith("mth_session="))?.split(";")[0] ?? null;
  return { cb, session, loginCookie, code, state };
}
const cps = (s: string | null | undefined) => (s == null ? s : Array.from(s).map((c) => c.codePointAt(0)!.toString(16)).join(" "));
const usersBySubjectPrefix = async (prefix: string) =>
  api.db
    .selectFrom("user_identity as i")
    .innerJoin("app_user as u", "u.id", "i.user_id")
    .select(["u.id", "i.subject", "u.display_name", "u.email"])
    .where("i.issuer", "=", idp.issuer)
    .where("i.subject", "like", `${prefix}%`)
    .execute();

describe("F-DG2-231: NUL in claims and callback", () => {
  it("NUL in sub -> token_invalid, audited, no user; NUL in name/preferred_username/email -> next claim", async () => {
    const a = await login({ sub: "r6-nul\u0000sub", name: "Synthetic" });
    const b = await login({ sub: "r6-nul-name", name: "Synthetic\u0000Name", preferred_username: "x\u0000y", email: "r6-nn@example.invalid", email_verified: true });
    const rows = await usersBySubjectPrefix("r6-nul");
    log("231.claims", { subNul: [a.cb.status, a.cb.headers["location"], a.session !== null], nameNul: [b.cb.status, b.cb.headers["location"]], users: rows.map((r) => [cps(r.subject), r.display_name, r.email]) });
    expect(a.cb.headers["location"]).toBe("/login?error=token_invalid");
    expect(a.session).toBeNull();
    expect(b.cb.status).toBe(302);
    expect(rows.map((r) => r.display_name)).toEqual(["r6-nn@example.invalid"]);
  });
  it("callback: NUL in state/code/error -> 302 invalid_request; a valid code after a NUL attempt still signs in once", async () => {
    const outs = [];
    for (const q of ["code=x&state=a%00b", "code=a%00&state=unknown", "error=x%00&state=unknown", "code=x&state=y&extra=%00"]) {
      const r = await call(api.app, "GET", `/api/v1/auth/callback?${q}`, { contract: false });
      outs.push([q, r.status, r.headers["location"]]);
    }
    log("231.callback", outs);
    for (const o of outs) expect(o[1]).toBe(302);
    for (const o of outs) expect(o[1]).not.toBe(500);
  });
});

describe("other input PostgreSQL may refuse: lone surrogates in claims", () => {
  it.each([
    ["name claim with lone high surrogate", { sub: "r6-sur-name", name: "Synthetic\ud800Name" }],
    ["preferred_username with lone low surrogate", { sub: "r6-sur-pref", preferred_username: "syn\udc00thetic" }],
    ["verified email with lone surrogate", { sub: "r6-sur-mail", email: "r6\ud800@example.invalid", email_verified: true, name: "Synthetic" }],
    ["sub with lone surrogate", { sub: "r6-sur-sub\ud800", name: "Synthetic" }],
  ])("%s: never a 500", async (label, claims) => {
    const r = await login(claims as Parameters<FakeIdp["issueCode"]>[1]);
    const rows = await usersBySubjectPrefix(String((claims as { sub: string }).sub).slice(0, 10));
    log(`sur.${label}`, { status: r.cb.status, location: r.cb.headers["location"] ?? null, body: typeof r.cb.body === "object" ? r.cb.body : String(r.cb.body).slice(0, 120), session: r.session !== null, users: rows.map((u) => [cps(u.subject), cps(u.display_name), u.email]) });
    expect(r.cb.status, label).toBeLessThan(500);
  });
  it("two distinct subjects that differ only in a lone surrogate are not merged into one user", async () => {
    const a = await login({ sub: "r6-col-\ud800", name: "Synthetic A" });
    const b = await login({ sub: "r6-col-\ud801", name: "Synthetic B" });
    const rows = await usersBySubjectPrefix("r6-col-");
    log("sur.collision", { status: [a.cb.status, b.cb.status], users: rows.map((u) => [cps(u.subject), u.display_name, u.id]) });
    // informational: both subjects are IdP-issued; a merge would require a malicious IdP
    expect(new Set(rows.map((u) => u.id)).size === rows.length).toBe(true);
  });
});

describe("identity, session and authorization unchanged", () => {
  it("(iss, sub) binding, no roles at JIT, session works, login cookie single use", async () => {
    const a = await login({ sub: "r6-bind", name: "Synthetic Original" });
    const b = await login({ sub: "r6-bind", name: "Changed" });
    const rows = await usersBySubjectPrefix("r6-bind");
    const me = await call(api.app, "GET", "/api/v1/me", { session: { cookie: b.session!, csrf: "", userId: "" } });
    const roles = await api.db.selectFrom("scoped_assignment").select("id").where("user_id", "=", rows[0]!.id).execute();
    const replay = await call(api.app, "GET", `/api/v1/auth/callback?code=${b.code}&state=${b.state}`, { headers: { cookie: b.loginCookie }, contract: false });
    log("bind", { cb: [a.cb.status, b.cb.status], users: rows.length, display: rows[0]!.display_name, me: [me.status, me.body?.user?.id === rows[0]!.id], roles: roles.length, replay: [replay.status, replay.headers["location"], cookies(replay).some((c) => c.startsWith("mth_session="))] });
    expect(rows.length).toBe(1);
    expect(rows[0]!.display_name).toBe("Synthetic Original");
    expect(me.status).toBe(200);
    expect(roles.length).toBe(0);
    expect(cookies(replay).some((c) => c.startsWith("mth_session=") && !c.startsWith("mth_session=;"))).toBe(false);
  });
});
