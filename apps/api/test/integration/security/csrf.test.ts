// The security suite, clause "CSRF" (T-DG6-BE-E2; ADR-0052 §4, §11; REQ-S16-030; p6-work-split §E/F.8) against a
// real PostgreSQL. The rule (identity/routes.ts, unchanged since DG1): every POST, PUT, PATCH and DELETE of a
// non-public route needs `Origin` equal to APP_BASE_URL's origin and `X-CSRF-Token` equal to the session's token.
// For a sample of one mutation per module (one per OpenAPI tag, the contract's module grouping; the route-inventory
// sweep of ADR-0051 §5 covers every operation), with a valid session:
//   no Origin -> 403 csrf; a foreign Origin -> 403 csrf; no X-CSRF-Token -> 403 csrf; a wrong X-CSRF-Token -> 403 csrf;
//   Origin and token correct -> not 403 csrf (whatever the operation then answers for the synthetic request).
// The refusals write nothing (no audit event for the request). The exemptions are pinned: the only public unsafe
// operations are devLogin (which checks Origin itself, tested here) and ADR-0056's webhook receiver
// (HMAC-authenticated); no other P6 route is public.
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOperation, openapi } from "../../support/contract.ts";
import { auditOfRequest, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import type { RouteRecord } from "../../../src/server.ts";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const FOREIGN_ORIGIN = "https://attacker.example";
let api: TestApi;
let w: World;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 120_000);
afterAll(() => api?.close());

type Op = { operationId: string; tags?: string[] };
function opOf(route: RouteRecord): Op | undefined {
  const found = findOperation(route.method, route.url.replace(/:([A-Za-z]+)/g, "{$1}"));
  if (!found) return undefined;
  const item = (openapi["paths"] as Record<string, Record<string, Op>>)[found.path]!;
  return item[route.method.toLowerCase()];
}
const isPublic = (r: RouteRecord) =>
  typeof r.access === "object" && r.access !== null && "public" in (r.access as Record<string, unknown>);

/** A concrete URL for a route: every path parameter a fresh random UUID (the case only needs the hook to run). */
const concrete = (url: string) => url.replace(/:[A-Za-z]+/g, () => crypto.randomUUID());

/** A body of the route's own first media type, so content-type parsing passes and the CSRF hook decides. */
function payloadFor(route: RouteRecord): { headers: Record<string, string>; body?: unknown } {
  const media = route.consumes[0];
  if (media === undefined) return { headers: {} };
  if (media === "application/json") return { headers: { "content-type": media }, body: {} };
  return { headers: { "content-type": media }, body: Buffer.from("synthetic") };
}

/** One non-public mutation per tag, the first by path within the tag (deterministic). */
function sample(): { tag: string; operationId: string; route: RouteRecord }[] {
  const byTag = new Map<string, { operationId: string; route: RouteRecord }>();
  const routes = [...api.routes]
    .filter((r) => UNSAFE.has(r.method) && !isPublic(r) && r.url.startsWith("/api/v1/"))
    .sort((a, b) => (a.url === b.url ? a.method.localeCompare(b.method) : a.url.localeCompare(b.url)));
  for (const route of routes) {
    const op = opOf(route);
    if (!op) continue;
    const tag = op.tags?.[0] ?? "(untagged)";
    if (!byTag.has(tag)) byTag.set(tag, { operationId: op.operationId, route });
  }
  return [...byTag.entries()].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => a.tag.localeCompare(b.tag));
}

describe("CSRF (REQ-S16-030; ADR-0052 §4)", () => {
  it("one mutation per module: no Origin, a foreign Origin, no token or a wrong token -> 403 csrf; correct -> not csrf", async () => {
    const picked = sample();
    // Every module of the API that has a mutation is in the sample (the contract has well over 20 tags with writes).
    expect(picked.length).toBeGreaterThan(20);
    const failures: string[] = [];
    for (const { tag, operationId, route } of picked) {
      const url = concrete(route.url);
      const { headers, body } = payloadFor(route);
      // A fresh session per operation: a sampled mutation may end its own session (logout) when it succeeds.
      const session = await signIn(api.app, w.office.subject);
      const base = { session, headers, ...(body !== undefined ? { body } : {}) };
      const cases: [string, Parameters<typeof call>[3], boolean][] = [
        ["no Origin", { ...base, origin: null }, true],
        ["foreign Origin", { ...base, origin: FOREIGN_ORIGIN }, true],
        ["no X-CSRF-Token", { ...base, csrf: false }, true],
        ["wrong X-CSRF-Token", { ...base, csrf: false, headers: { ...headers, "x-csrf-token": "x".repeat(43) } }, true],
        ["correct", base, false],
      ];
      for (const [label, opts, refused] of cases) {
        const res = await call<Body>(api.app, route.method, url, opts);
        const isCsrf = res.status === 403 && res.body?.code === "csrf";
        if (isCsrf !== refused) failures.push(`${tag} ${operationId} (${label}): ${res.status} ${res.body?.code}`);
        if (refused && (await auditOfRequest(api.db, res.headers["x-request-id"] as string)).length > 0)
          failures.push(`${tag} ${operationId} (${label}): an audit event was written`);
      }
    }
    expect(failures).toEqual([]);
    console.log(
      `PASS REQ-S16-030 CSRF: ${picked.length} modules (contract tags), one mutation each, x 4 refusals -> 403 csrf; correct Origin and token -> not csrf`,
    );
    console.log(`  sample: ${picked.map((p) => `${p.tag}:${p.operationId}`).join(", ")}`);
  });

  it("the public unsafe operations are exactly devLogin and the webhook receiver; devLogin checks Origin itself", async () => {
    const publicUnsafe = api.routes
      .filter((r) => UNSAFE.has(r.method) && isPublic(r))
      .map((r) => opOf(r)?.operationId ?? `${r.method} ${r.url}`)
      .sort();
    expect(publicUnsafe).toEqual(["devLogin", "receiveWebhook"]);
    for (const origin of [null, FOREIGN_ORIGIN]) {
      const res = await call<Body>(api.app, "POST", "/api/v1/auth/dev-login", {
        origin,
        body: { username: w.nobody.subject },
      });
      expect([res.status, res.body.code]).toEqual([403, "csrf"]);
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("a request without a session is 401 before any CSRF decision (no session to bind a token to)", async () => {
    const route = sample()[0]!.route;
    const { headers, body } = payloadFor(route);
    const res = await call<Body>(api.app, route.method, concrete(route.url), {
      headers,
      ...(body !== undefined ? { body } : {}),
      origin: FOREIGN_ORIGIN,
    });
    expect([res.status, res.body.code]).toEqual([401, "unauthenticated"]);
  });
});
