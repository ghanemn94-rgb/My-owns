// code-security-reviewer DG2 round-4 OIDC probe (T-DG2-REV-SEC-R4). NOT part of the candidate: copied into a disposable
// clone at apps/api/test/integration/ and run on its own scratch database of a disposable PostgreSQL 16, with the
// candidate's local fake OpenID Provider. All data SYNTHETIC.
// Checks that the F-DG2-160 change in displayNameOf() (oidc.ts) affects only the display-name choice:
//  1. invisible-only name -> falls back to preferred_username; identity is (iss, sub) and a second login with a
//     different invisible-only name signs the SAME user in, with no role assignments created.
//  2. a name whose first 200 code units are invisible but which has visible content later passes hasText() and is then
//     cut to 200 by slice(): the stored display name has no visible content (observation, logged; secure expectation
//     asserted last so the first two assertions report independently).
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
  dbName = await createScratchDatabase(adminUrl, "mth_oidc_r4");
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
  await createOrg(api.db, "OIDCR4");
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
  return call(api.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`, { headers: { cookie: loginCookie } });
}
const userOf = async (sub: string) =>
  api.db
    .selectFrom("user_identity as i")
    .innerJoin("app_user as u", "u.id", "i.user_id")
    .select(["u.id", "u.display_name"])
    .where("i.issuer", "=", idp.issuer)
    .where("i.subject", "=", sub)
    .executeTakeFirstOrThrow();

describe("OIDC displayNameOf after F-DG2-160", () => {
  it("invisible-only name falls back; identity stays (iss, sub); no roles granted", async () => {
    const cb1 = await login({ sub: "r4-sub-1", preferred_username: "r4.user", name: "‏⁠\u0085" });
    const u1 = await userOf("r4-sub-1");
    const cb2 = await login({ sub: "r4-sub-1", preferred_username: "other", name: "​" });
    const u2 = await userOf("r4-sub-1");
    const roles = await api.db.selectFrom("scoped_assignment").select("id").where("user_id", "=", u1.id).execute();
    log("oidc.fallback", { cb1: cb1.status, cb2: cb2.status, display: u1.display_name, sameUser: u1.id === u2.id, roles: roles.length });
    expect([cb1.status, cb2.status]).toEqual([302, 302]);
    expect(u1.display_name).toBe("r4.user");
    expect(u2.id).toBe(u1.id);
    expect(roles.length).toBe(0);
  });

  it("200 invisible code units followed by a visible name: stored display name must still have visible content", async () => {
    const name = "​".repeat(200) + "Visible Synthetic";
    const cb = await login({ sub: "r4-sub-2", preferred_username: "r4.second", name });
    const u = await userOf("r4-sub-2");
    log("oidc.truncation", { cb: cb.status, length: u.display_name.length, hasText: hasText(u.display_name) });
    expect(cb.status).toBe(302);
    expect(hasText(u.display_name)).toBe(true);
  });
});
