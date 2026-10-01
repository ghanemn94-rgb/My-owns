// REPRODUCTION ONLY (code-security-reviewer, DG1 round 2). Copied into a DISPOSABLE clone of candidate 485e91f at
// apps/api/test/integration/zz-review-r2-ratelimit.test.ts; never part of the candidate tree.
// Re-verification of F-DG1-142 (global limiter keyed on any presented cookie). Every request sets its own
// remoteAddress, so each case uses its own IP bucket. RATE_LIMIT_PER_MINUTE=3, auth limiter left high.
//  RL-1 rotating a fresh random cookie per request from ONE IP is limited after 3 (ip bucket).
//  RL-2 rotating X-Forwarded-For (TRUST_PROXY unset) does not open new buckets.
//  RL-3 a live session is keyed by its user: two sessions of one user from two IPs share ONE bucket.
//  RL-4 an attacker exhausting an IP's bucket with fake cookies does not starve a valid session from that same IP.
//  RL-5 after logout the (revoked) cookie no longer maps to the user: it falls back to the IP bucket.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrg, createUser, startApi, type TestApi } from "../support/harness.ts";

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ env: { RATE_LIMIT_PER_MINUTE: "3" } });
});
afterAll(async () => {
  await api.close();
});

const ORIGIN = "http://localhost:3000";
const inj = (method: string, url: string, ip: string, headers: Record<string, string> = {}, payload?: object) =>
  api.app.inject({ method: method as "GET", url, headers, remoteAddress: ip, ...(payload ? { payload } : {}) });
const fake = () => `mth_session=${randomBytes(32).toString("base64url")}`;

async function login(subject: string, ip: string): Promise<{ cookie: string; csrf: string }> {
  const r = await inj("POST", "/api/v1/auth/dev-login", ip, { origin: ORIGIN }, { username: subject });
  if (r.statusCode !== 204) throw new Error(`login ${r.statusCode} ${r.body}`);
  const sc = r.headers["set-cookie"];
  const cookie = (Array.isArray(sc) ? sc[0]! : String(sc)).split(";")[0]!;
  const me = await inj("GET", "/api/v1/me", ip, { cookie });
  return { cookie, csrf: (me.json() as { csrfToken: string }).csrfToken };
}

describe("F-DG1-142 re-verification", () => {
  it("RL-1 random cookie per request from one IP: 429 from the 4th request", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 20; i++) codes.push((await inj("GET", "/api/v1/me", "203.0.113.21", { cookie: fake() })).statusCode);
    console.log("RL-1 rotating fake cookies, one IP:", codes.join(","));
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3).every((c) => c === 429)).toBe(true);
  });

  it("RL-2 rotating X-Forwarded-For without TRUST_PROXY does not open fresh buckets", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++)
      codes.push(
        (await inj("GET", "/api/v1/me", "203.0.113.22", { cookie: fake(), "x-forwarded-for": `198.51.100.${i + 1}` }))
          .statusCode,
      );
    console.log("RL-2 rotating XFF + fake cookie, one socket IP:", codes.join(","));
    expect(codes.slice(3).every((c) => c === 429)).toBe(true);
  });

  it("RL-3/4/5 valid sessions share a per-user bucket; fake-cookie flood does not starve it; logout falls back to IP", async () => {
    const org = await createOrg(api.db);
    const user = await createUser(api.db, org.id);
    // logins happen from distinct IPs so they do not consume the buckets under test
    const s1 = await login(user.subject, "192.0.2.101"); // u: bucket now has 1 (the /me)
    const s2 = await login(user.subject, "192.0.2.102"); // u: bucket now has 2
    // RL-4: flood the ip bucket of 203.0.113.30 with fake cookies
    for (let i = 0; i < 5; i++) await inj("GET", "/api/v1/me", "203.0.113.30", { cookie: fake() });
    const flooded = (await inj("GET", "/api/v1/me", "203.0.113.30", { cookie: fake() })).statusCode;
    const validFromFloodedIp = (await inj("GET", "/api/v1/me", "203.0.113.30", { cookie: s1.cookie })).statusCode; // u: 3
    // RL-3: the user's 4th request, from yet another IP and the OTHER session, is limited (shared u: bucket)
    const fourth = (await inj("GET", "/api/v1/me", "203.0.113.31", { cookie: s2.cookie })).statusCode;
    console.log("RL-4 flooded IP fake:", flooded, "| valid session from flooded IP:", validFromFloodedIp, "| RL-3 user 4th req (other session, other IP):", fourth);
    expect(flooded).toBe(429);
    expect(validFromFloodedIp).toBe(200);
    expect(fourth).toBe(429);
  });

  it("RL-5 a logged-out cookie maps back to the IP bucket", async () => {
    const org = await createOrg(api.db);
    const user = await createUser(api.db, org.id);
    const s = await login(user.subject, "192.0.2.111"); // ip(192.0.2.111): 1 (login) ; u: 1
    const out = await inj("POST", "/api/v1/auth/logout", "192.0.2.112", {
      cookie: s.cookie,
      origin: ORIGIN,
      "x-csrf-token": s.csrf,
    }); // u: 2
    // From a fresh IP, the revoked cookie: if it still mapped to u:, the bucket would have 1 left; on ip it has 3.
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await inj("GET", "/api/v1/me", "203.0.113.40", { cookie: s.cookie })).statusCode);
    console.log("RL-5 logout:", out.statusCode, "| revoked cookie from fresh IP:", codes.join(","));
    expect([200, 204]).toContain(out.statusCode);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });
});
