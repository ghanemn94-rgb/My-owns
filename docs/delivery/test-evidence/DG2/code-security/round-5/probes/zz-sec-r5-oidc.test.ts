// code-security-reviewer DG2 round-5 OIDC probe (T-DG2-REV-SEC-R5). NOT part of the candidate: copied into a disposable
// clone (96a3c293) at apps/api/test/integration/ and run on its own scratch database of a disposable PostgreSQL 16,
// with the candidate's local fake OpenID Provider. All data SYNTHETIC.
// F-DG2-181 re-verification (displayNameCandidate: trim, truncate to 200 code points, THEN hasText) and a check that
// identity, session and authorization are unchanged (binding on (iss, sub); no roles at JIT; display name not
// re-derived on later logins).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasText } from "@mth/shared/schemas";
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
  dbName = await createScratchDatabase(adminUrl, "mth_oidc_r5");
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
  await createOrg(api.db, "OIDCR5");
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
  const cb = await call(api.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`, { headers: { cookie: loginCookie } });
  const session = cookies(cb).find((c) => c.startsWith("mth_session="))?.split(";")[0] ?? null;
  return { cb, session };
}
const userOf = async (sub: string) =>
  api.db
    .selectFrom("user_identity as i")
    .innerJoin("app_user as u", "u.id", "i.user_id")
    .select(["u.id", "u.display_name", "u.email"])
    .where("i.issuer", "=", idp.issuer)
    .where("i.subject", "=", sub)
    .executeTakeFirstOrThrow();
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("F-DG2-181 re-verification", () => {
  it("round-4 repro: 200 x U+200B + visible -> name claim absent, falls back to preferred_username", async () => {
    const { cb } = await login({ sub: "r5-sub-1", preferred_username: "r5.first", name: "​".repeat(200) + "Visible Synthetic" });
    const u = await userOf("r5-sub-1");
    log("181.repro", { cb: cb.status, display: u.display_name, hasText: hasText(u.display_name) });
    expect(cb.status).toBe(302);
    expect(u.display_name).toBe("r5.first");
  });

  it("other untrimmed invisible prefixes (U+200F, U+2060, U+0085, VS16, CGJ, U+E0100) x 200 + visible -> fallback", async () => {
    let i = 0;
    for (const unit of ["‏", "⁠", "\u0085", "️", "͏", "\u{e0100}"]) {
      i++;
      const { cb } = await login({ sub: `r5-sub-p${i}`, preferred_username: `r5.p${i}`, name: unit.repeat(200) + "Visible" });
      const u = await userOf(`r5-sub-p${i}`);
      log(`181.prefix.U+${unit.codePointAt(0)!.toString(16)}`, { cb: cb.status, display: u.display_name });
      expect(cb.status).toBe(302);
      expect(u.display_name).toBe(`r5.p${i}`);
    }
  });

  it("199 invisible + visible: kept (200 code points, has visible content)", async () => {
    await login({ sub: "r5-sub-2", name: "​".repeat(199) + "VX" });
    const u = await userOf("r5-sub-2");
    log("181.199", { len: Array.from(u.display_name).length, last: u.display_name.slice(-1), hasText: hasText(u.display_name) });
    expect(u.display_name).toBe("​".repeat(199) + "V");
    expect(hasText(u.display_name)).toBe(true);
  });

  it("astral: 250 x U+1F600 -> 200 code points, no lone surrogate, DB char_length 200", async () => {
    await login({ sub: "r5-sub-3", name: "\u{1f600}".repeat(250) });
    const u = await userOf("r5-sub-3");
    const len = await api.db.selectFrom("app_user").select((eb) => eb.fn<number>("char_length", ["display_name"]).as("n")).where("id", "=", u.id).executeTakeFirstOrThrow();
    log("181.astral", { cps: Array.from(u.display_name).length, units: u.display_name.length, dbCharLength: len.n, lone: lone.test(u.display_name) });
    expect(Array.from(u.display_name).length).toBe(200);
    expect(Number(len.n)).toBe(200);
    expect(lone.test(u.display_name)).toBe(false);
  });

  it("name and preferred_username invisible after truncation -> email (unverified e-mail is still only a display fallback)", async () => {
    await login({ sub: "r5-sub-4", name: "️".repeat(200) + "x", preferred_username: "⠀ㅤ", email: "r5-4@example.invalid", email_verified: false });
    const u = await userOf("r5-sub-4");
    log("181.email", { display: u.display_name, storedEmail: u.email });
    expect(u.display_name).toBe("r5-4@example.invalid");
    expect(u.email).toBeNull(); // unverified e-mail is not stored as the user's e-mail
  });

  it("all claims invisible -> generated name", async () => {
    await login({ sub: "r5-sub-5", name: "͏", preferred_username: "᠋឴" });
    const u = await userOf("r5-sub-5");
    log("181.generated", { display: u.display_name });
    expect(u.display_name).toMatch(/^User [0-9a-f]{6}$/);
  });
});

describe("identity, session and authorization unchanged", () => {
  it("(iss, sub) binding: same sub with another name signs in the SAME user, name not re-derived; session works; no roles", async () => {
    const a = await login({ sub: "r5-bind", name: "Synthetic Original" });
    const ua = await userOf("r5-bind");
    const b = await login({ sub: "r5-bind", name: "​".repeat(200) + "Changed", preferred_username: "changed" });
    const ub = await userOf("r5-bind");
    const me = await call(api.app, "GET", "/api/v1/me", { session: { cookie: b.session!, csrf: "", userId: "" } });
    const roles = await api.db.selectFrom("scoped_assignment").select("id").where("user_id", "=", ua.id).execute();
    const list = await call(api.app, "GET", "/api/v1/transformations", { session: { cookie: b.session!, csrf: "", userId: "" } });
    const users = await api.db.selectFrom("user_identity").select("id").where("subject", "=", "r5-bind").execute();
    log("bind", { cb: [a.cb.status, b.cb.status], same: ua.id === ub.id, display: ub.display_name, me: me.status, meUser: me.body?.user?.id === ua.id, roles: roles.length, list: [list.status, list.body?.items?.length], identities: users.length });
    expect([a.cb.status, b.cb.status]).toEqual([302, 302]);
    expect(ub.id).toBe(ua.id);
    expect(ub.display_name).toBe("Synthetic Original");
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(ua.id);
    expect(roles.length).toBe(0);
    expect(users.length).toBe(1);
    expect(list.status === 403 || (list.status === 200 && list.body.items.length === 0)).toBe(true);
  });

  it("another sub with the same name and the same unverified e-mail is a DIFFERENT user (no binding by name/e-mail)", async () => {
    await login({ sub: "r5-other-1", name: "Same Synthetic", email: "same@example.invalid", email_verified: false });
    await login({ sub: "r5-other-2", name: "Same Synthetic", email: "same@example.invalid", email_verified: false });
    const u1 = await userOf("r5-other-1");
    const u2 = await userOf("r5-other-2");
    log("distinct", { distinct: u1.id !== u2.id });
    expect(u1.id).not.toBe(u2.id);
  });
});
