// Administration > Security, the rate-limit matrix (T-DG6-BE-E; ADR-0052 §4; REQ-S16-030 "rate limiting"), against a
// real PostgreSQL:
//  - getSecurityRateLimits: security.read on the organization (ADM_TECH, AUD) reads the configured budget, key and
//    operations of each class; every other caller is 403; it reports no counters, IPs or user ids; no write exists;
//  - the class budgets are configuration (defaults of ADR-0052 §4; each a positive integer, named on error);
//  - the routes that declare a class are exactly the operations the matrix lists;
//  - the upload class applies in addition to the global limit, keyed per user: over the class budget the next upload
//    is 429 rate_limited with Retry-After while other operations still answer, and over the global budget an upload is
//    429 although its class budget is not reached.
// Every value is synthetic.
import { loadConfig, type ConfigError } from "@mth/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RATE_LIMIT_CLASSES } from "../../../src/modules/platform/index.ts";
import { findOperation, openapi } from "../../support/contract.ts";
import {
  APP_ORIGIN,
  call,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";

const URL_ = "/api/v1/admin/security/rate-limits";
/** One distinct budget per class (high enough never to throttle this file's own requests). */
const CLASS_BUDGETS = {
  UPLOAD_RATE_LIMIT_PER_MINUTE: "301",
  SEARCH_RATE_LIMIT_PER_MINUTE: "1201",
  ASSISTANT_RATE_LIMIT_PER_MINUTE: "201",
  WEBHOOK_RATE_LIMIT_PER_MINUTE: "6001",
  EXPORT_RATE_LIMIT_PER_MINUTE: "101",
};
let api: TestApi;
let w: World;
let admin: Session;
let auditor: Session;
let office: Session;
let nobody: Session;
let officeB: Session;

beforeAll(async () => {
  // Distinct class budgets, so the matrix test proves each class reports its own configured value.
  api = await startApi({ env: CLASS_BUDGETS });
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  office = await signIn(api.app, w.office.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  officeB = await signIn(api.app, w.officeB.subject);
});
afterAll(() => api.close());

describe("getSecurityRateLimits", () => {
  it("ADM_TECH and AUD read every class with its configured budget, key and operations (ADR-0052 §4)", async () => {
    const res = await call(api.app, "GET", `${URL_}?organizationId=${w.orgA.id}`, { session: admin });
    expect(res.status).toBe(200);
    // Global and auth are the harness's 100000; the class budgets are this file's CLASS_BUDGETS. The ADR-0052 §4 defaults
    // are pinned in "class budgets are configuration" below, and the 429s with budgets of 1 and 2 in the last describe.
    expect(res.body).toEqual({
      classes: [
        {
          name: "global",
          variable: "RATE_LIMIT_PER_MINUTE",
          perMinute: 100000,
          keyedBy: "user_or_ip",
          operationIds: [],
        },
        {
          name: "auth",
          variable: "AUTH_RATE_LIMIT_PER_MINUTE",
          perMinute: 100000,
          keyedBy: "ip",
          operationIds: ["startOidcLogin", "completeOidcLogin", "devLogin"],
        },
        {
          name: "upload",
          variable: "UPLOAD_RATE_LIMIT_PER_MINUTE",
          perMinute: 301,
          keyedBy: "user_or_ip",
          operationIds: ["uploadEvidenceContent"],
        },
        {
          name: "search",
          variable: "SEARCH_RATE_LIMIT_PER_MINUTE",
          perMinute: 1201,
          keyedBy: "user_or_ip",
          operationIds: [],
        },
        {
          name: "assistant",
          variable: "ASSISTANT_RATE_LIMIT_PER_MINUTE",
          perMinute: 201,
          keyedBy: "user_or_ip",
          operationIds: [],
        },
        {
          name: "webhook",
          variable: "WEBHOOK_RATE_LIMIT_PER_MINUTE",
          perMinute: 6001,
          keyedBy: "endpoint_key",
          operationIds: [],
        },
        {
          name: "export",
          variable: "EXPORT_RATE_LIMIT_PER_MINUTE",
          perMinute: 101,
          keyedBy: "user_or_ip",
          operationIds: [],
        },
      ],
    });
    // No counters, no client IPs, no user ids.
    const text = JSON.stringify(res.body);
    for (const leak of ["127.0.0.1", w.admin.id, w.auditor.id, "remaining", "current"])
      expect(text).not.toContain(leak);
    const aud = await call(api.app, "GET", `${URL_}?organizationId=${w.orgA.id}`, { session: auditor });
    expect([aud.status, aud.body]).toEqual([200, res.body]);
  });

  it("refuses everyone else with 403 (TO, no role, another organization, an unknown organization) and bad input with 400", async () => {
    const get = (session: Session, org: string) => call(api.app, "GET", `${URL_}?organizationId=${org}`, { session });
    expect((await get(office, w.orgA.id)).status).toBe(403);
    expect((await get(nobody, w.orgA.id)).status).toBe(403);
    expect((await get(officeB, w.orgA.id)).status).toBe(403);
    expect((await get(admin, w.orgB.id)).status).toBe(403);
    expect((await get(admin, crypto.randomUUID())).status).toBe(403);
    expect((await call(api.app, "GET", URL_, { session: admin })).status).toBe(400);
    expect((await get(admin, "not-a-uuid")).status).toBe(400);
    expect((await call(api.app, "GET", `${URL_}?organizationId=${w.orgA.id}&x=1`, { session: admin })).status).toBe(
      400,
    );
    expect((await call(api.app, "GET", `${URL_}?organizationId=${w.orgA.id}`)).status).toBe(401);
  });

  it("is read-only: neither the contract nor the server has a write on the matrix", () => {
    const item = (openapi["paths"] as Record<string, Record<string, unknown>>)[URL_]!;
    expect(Object.keys(item).filter((k) => ["post", "put", "patch", "delete"].includes(k))).toEqual([]);
    const methods = api.routes.filter((r) => r.url === URL_).map((r) => r.method);
    expect(methods).toContain("GET");
    expect(methods.filter((m) => !["GET", "HEAD"].includes(m))).toEqual([]);
  });
});

describe("class budgets are configuration", () => {
  const base = {
    NODE_ENV: "test",
    APP_BASE_URL: APP_ORIGIN,
    DATABASE_URL: "postgres://x@localhost/db",
    AUTH_MODE: "dev",
  };

  it("defaults to ADR-0052 §4 and reads each variable", () => {
    expect(loadConfig("api", base).rateLimitClasses).toEqual({
      upload: 30,
      search: 120,
      assistant: 20,
      webhook: 600,
      export: 10,
    });
    expect(
      loadConfig("api", {
        ...base,
        UPLOAD_RATE_LIMIT_PER_MINUTE: "5",
        SEARCH_RATE_LIMIT_PER_MINUTE: "6",
        ASSISTANT_RATE_LIMIT_PER_MINUTE: "7",
        WEBHOOK_RATE_LIMIT_PER_MINUTE: "8",
        EXPORT_RATE_LIMIT_PER_MINUTE: "9",
      }).rateLimitClasses,
    ).toEqual({ upload: 5, search: 6, assistant: 7, webhook: 8, export: 9 });
  });

  it("refuses a budget that is not a positive integer, naming the variable", () => {
    for (const bad of ["0", "-1", "1.5", "lots"]) {
      let problems: readonly string[] = [];
      try {
        loadConfig("api", { ...base, EXPORT_RATE_LIMIT_PER_MINUTE: bad });
      } catch (error) {
        problems = (error as ConfigError).problems;
      }
      expect(problems).toEqual([expect.stringMatching(/^EXPORT_RATE_LIMIT_PER_MINUTE is invalid/)]);
    }
  });
});

describe("the routes in each class are the operations the matrix lists", () => {
  it("every route that declares a class maps to an operation id of that class, and back", () => {
    const declared = new Map<string, string[]>();
    for (const r of api.routes) {
      if (r.rateLimitClass === null) continue;
      const op = findOperation(r.method, r.url);
      expect(op, `${r.method} ${r.url}`).toBeDefined();
      declared.set(r.rateLimitClass, [...(declared.get(r.rateLimitClass) ?? []), op!.operationId]);
    }
    for (const spec of RATE_LIMIT_CLASSES) {
      if (spec.name === "global" || spec.name === "auth") continue;
      expect([...(declared.get(spec.name) ?? [])].sort(), spec.name).toEqual([...spec.operationIds].sort());
    }
    // The auth class is identity's own per-route limit (ADR-0007 §5b); its three operations exist in the contract.
    const ids = new Set(
      Object.values(openapi["paths"] as Record<string, Record<string, { operationId?: string }>>).flatMap((item) =>
        Object.values(item).map((op) => op?.operationId),
      ),
    );
    for (const id of RATE_LIMIT_CLASSES.find((c) => c.name === "auth")!.operationIds) expect(ids.has(id)).toBe(true);
  });
});

describe("the upload class, in addition to the global limit (REQ-S16-030 rate limiting)", () => {
  it("over the class budget the next upload is 429 rate_limited with Retry-After; other operations and users still pass", async () => {
    const limited = await startApi({ env: { UPLOAD_RATE_LIMIT_PER_MINUTE: "1" } });
    try {
      const lw = await seedWorld(limited.db);
      const p = await setupP2World(limited, lw);
      const T = `/api/v1/transformations/${p.transformationId}`;
      const created = await call(limited.app, "POST", `${T}/evidence`, {
        session: p.lead.session,
        body: { ownerUserId: p.lead.id, kind: "file", title: "Synthetic extract" },
      });
      expect(created.status).toBe(201);
      const upload = (version: number, session = p.lead.session) =>
        call(limited.app, "POST", `${T}/evidence/${created.body.id}/content`, {
          session,
          headers: { ...ifm(version), "content-type": "application/octet-stream", "x-file-name": "extract.csv" },
          body: Buffer.from("a,b\n1,2\n"),
        });
      expect((await upload(1)).status).toBe(200);
      const second = await upload(2);
      expect([second.status, second.body.code]).toEqual([429, "rate_limited"]);
      expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
      expect(second.headers["content-type"]).toContain("application/problem+json");
      // Nothing was stored by the refused upload.
      const after = await call(limited.app, "GET", `${T}/evidence/${created.body.id}`, { session: p.lead.session });
      expect(after.body.version).toBe(2);
      // The global limit is untouched for the same user's other operations.
      expect((await call(limited.app, "GET", "/api/v1/me", { session: p.lead.session })).status).toBe(200);
      // Keyed per user: another user's upload is not counted against the first (403 here: not the item's owner).
      expect((await upload(2, p.office.session)).status).not.toBe(429);
      // The matrix shows the effective budget.
      const leadAdmin = await signIn(limited.app, lw.admin.subject);
      const matrix = await call(limited.app, "GET", `${URL_}?organizationId=${lw.orgA.id}`, { session: leadAdmin });
      expect(matrix.body.classes.find((c: { name: string }) => c.name === "upload").perMinute).toBe(1);
    } finally {
      await limited.close();
    }
  });

  it("the global limit still applies to a class route: over the global budget an upload is 429 before its class budget", async () => {
    // Global 2 per minute: the sign-in's GET /me is the first request, one upload attempt the second, the next is 429.
    const limited = await startApi({ env: { RATE_LIMIT_PER_MINUTE: "2" } });
    try {
      const lw = await seedWorld(limited.db);
      const someone = await signIn(limited.app, lw.nobody.subject);
      const url = `/api/v1/transformations/${crypto.randomUUID()}/evidence/${crypto.randomUUID()}/content`;
      const attempt = () =>
        call(limited.app, "POST", url, {
          session: someone,
          headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "x.csv" },
          body: Buffer.from("x"),
        });
      expect((await attempt()).status).not.toBe(429);
      const refused = await attempt();
      expect([refused.status, refused.body.code]).toEqual([429, "rate_limited"]);
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });
});
