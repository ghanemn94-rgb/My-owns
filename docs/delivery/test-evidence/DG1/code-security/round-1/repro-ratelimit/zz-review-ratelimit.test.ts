// REPRODUCTION ONLY (code-security-reviewer, DG1 round 1). Copied into a DISPOSABLE copy of candidate 2c22c27 at
// apps/api/test/integration/zz-review-ratelimit.test.ts; never part of the candidate tree.
// SEC-3: the global rate limiter (server.ts keyGenerator) keys on ANY presented session-cookie value, valid or not, so an
// unauthenticated client that sends a fresh random cookie per request gets a fresh bucket per request and is never
// limited; each such request still reaches the session lookup in PostgreSQL (identity preValidation).
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApi, type TestApi } from "../support/harness.ts";

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ env: { RATE_LIMIT_PER_MINUTE: "3" } });
});
afterAll(async () => {
  await api.close();
});

const me = (headers: Record<string, string>) =>
  api.app.inject({ method: "GET", url: "/api/v1/me", headers, remoteAddress: "203.0.113.7" });

describe("SEC-3 global rate limit is bypassed by rotating an invalid session cookie", () => {
  it("control: without a cookie the 4th request from one IP is 429", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await me({})).statusCode);
    console.log("SEC-3 control (no cookie, same IP):", codes.join(","));
    expect(codes.slice(3)).toEqual([429, 429, 429]);
  });
  it("bypass: 50 requests from the SAME IP with a fresh random 43-char cookie each are never 429", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 50; i++) codes.push((await me({ cookie: `mth_session=${randomBytes(32).toString("base64url")}` })).statusCode);
    const counts = codes.reduce<Record<number, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});
    console.log("SEC-3 bypass (random cookie per request, same IP) status counts:", JSON.stringify(counts));
    expect(codes.includes(429)).toBe(false);
  });
});
