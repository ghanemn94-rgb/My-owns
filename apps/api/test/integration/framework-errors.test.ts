// T-DG2-BE12: errors raised BEFORE routing answer the declared problem+json, on a real PostgreSQL.
// Fastify's router refuses a path with an undecodable percent escape (FST_ERR_BAD_URL) before any hook runs, and Node's
// HTTP parser refuses an oversized header block / request line or a malformed request before a request exists. Both
// used to answer a plain `application/json` body without security headers or X-Request-Id. Every API operation
// declares 400 as the shared ValidationError (application/problem+json), so they are now 400 problems
// (`errors[0].code` = validation.format / validation.headers_too_large / validation.malformed_request) with a
// requestId, the same security headers as every routed response, and nothing written or audited.
// Requests through `call` are asserted against the OpenAPI contract. All data is SYNTHETIC.
import { mkdtempSync, writeFileSync } from "node:fs";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.ts";
import {
  auditOfRequest,
  call,
  createPool,
  seedWorld,
  startApi,
  testConfig,
  type Res,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { assertContract } from "../support/contract.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

const TRANSPORT = new Set(["x-request-id", "content-type", "content-length", "date", "connection", "keep-alive"]);
/** The security headers of a response: everything except transport headers and the per-request id. */
function securityHeadersOf(headers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !TRANSPORT.has(k.toLowerCase())));
}

/** The reference: security headers on an ordinary routed problem (an unknown API path, 404). */
async function routedSecurityHeaders(app: FastifyInstance): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: "GET", url: "/api/v1/no-such-path" });
  expect(res.statusCode).toBe(404);
  const headers = securityHeadersOf(res.headers);
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  return headers;
}

/** 400 problem+json, errors[0].code = `fieldCode`, requestId = X-Request-Id, routed security headers, no audit row. */
async function expectFrameworkProblem(res: Res, fieldCode: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(String(res.headers["content-type"])).toMatch(/^application\/problem\+json/);
  const requestId = String(res.headers["x-request-id"]);
  expect(requestId).not.toBe("undefined");
  expect(res.body).toEqual({
    type: "urn:mth:problem:validation",
    title: "Validation failed",
    status: 400,
    detail: expect.any(String),
    code: "validation",
    requestId,
    errors: [{ pointer: "", code: fieldCode, message: expect.any(String) }],
  });
  // No internals: neither Fastify's error code nor the raw path is echoed.
  expect(JSON.stringify(res.body)).not.toMatch(/FST_ERR|%ZZ|%ED|statusCode/);
  expect(securityHeadersOf(res.headers)).toEqual(await routedSecurityHeaders(api.app));
  expect(await auditOfRequest(api.db, requestId)).toEqual([]);
}

describe("FST_ERR_BAD_URL (undecodable percent escape in the path) is the declared 400 ValidationError", () => {
  it("GET /api/v1/transformations/%ZZ: 400 problem+json validation.format with requestId; nothing written", async () => {
    const before = await call(api.app, "GET", T, { session: p.lead.session });
    expect(before.status).toBe(200);
    const res = await call(api.app, "GET", "/api/v1/transformations/%ZZ", { session: p.lead.session });
    await expectFrameworkProblem(res, "validation.format");
    expect((res.body as { detail: string }).detail).toBe("The request URL contains an invalid percent-encoding.");
    const after = await call(api.app, "GET", T, { session: p.lead.session });
    expect(after.body).toEqual(before.body);
  });

  it("GET-by-id paths with %ED%A0%80 (CESU-8 lone surrogate bytes) answer the same; nothing written", async () => {
    const gaps = await call(api.app, "GET", `${T}/tom-gaps`, { session: p.lead.session });
    for (const url of [
      "/api/v1/transformations/%ED%A0%80",
      `/api/v1/transformations/abc%ED%A0%80`,
      `${T}/tom-gaps/%ED%A0%80`,
    ]) {
      const res = await call(api.app, "GET", url, { session: p.lead.session });
      await expectFrameworkProblem(res, "validation.format");
    }
    expect((await call(api.app, "GET", `${T}/tom-gaps`, { session: p.lead.session })).body).toEqual(gaps.body);
  });

  it("an unsafe method with a bad path (POST tom-gap archive) writes nothing and is not audited", async () => {
    const res = await call(api.app, "POST", `${T}/tom-gaps/%ZZ/archive`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic reason" },
    });
    await expectFrameworkProblem(res, "validation.format");
  });

  it("keeps a well-formed inbound X-Request-Id, and answers without a session too (the router runs before auth)", async () => {
    const res = await call(api.app, "GET", "/api/v1/transformations/%ZZ", {
      headers: { "x-request-id": "synthetic-req-be12" },
    });
    await expectFrameworkProblem(res, "validation.format");
    expect(res.headers["x-request-id"]).toBe("synthetic-req-be12");
    expect((res.body as { requestId: string }).requestId).toBe("synthetic-req-be12");
  });
});

describe("the non-API SPA fallback with a bad URL", () => {
  it("answers a problem+json 400 with the security headers (not a plain JSON body), and still serves good paths", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "mth-spa-be12-"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>synthetic</title>");
    const pool = createPool(testConfig().databaseUrl!, { max: 1, applicationName: "api-test-spa" });
    const { app, db } = await buildServer({ config: testConfig(), pool, logger: false, webRoot: `${webRoot}/` });
    try {
      const ok = await app.inject({ method: "GET", url: "/transformations/x" });
      expect([ok.statusCode, String(ok.headers["content-type"])]).toEqual([200, expect.stringMatching(/^text\/html/)]);
      const res = await app.inject({ method: "GET", url: "/transformations/%ZZ" });
      expect(res.statusCode).toBe(400);
      expect(String(res.headers["content-type"])).toMatch(/^application\/problem\+json/);
      expect(res.json()).toMatchObject({
        status: 400,
        code: "validation",
        requestId: res.headers["x-request-id"],
        errors: [{ code: "validation.format" }],
      });
      expect(securityHeadersOf(res.headers)).toEqual(await routedSecurityHeaders(app));
      // The served page carries the same security headers (plus static-file caching headers).
      expect(securityHeadersOf(ok.headers)).toMatchObject(await routedSecurityHeaders(app));
    } finally {
      await app.close();
      await db.destroy();
      if (!(pool as { ending?: boolean }).ending) await pool.end();
    }
  });
});

describe("other framework-level answers on /api/** are already problems", () => {
  it("an unsupported method on a known path is a 404 problem (Fastify does not answer 405)", async () => {
    for (const [method, url] of [
      ["DELETE", "/api/v1/transformations"],
      ["PATCH", "/api/v1/me"],
    ] as const) {
      const res = await api.app.inject({ method, url, headers: { origin: "http://localhost:3000" } });
      expect([res.statusCode, String(res.headers["content-type"])], `${method} ${url}`).toEqual([
        404,
        expect.stringMatching(/^application\/problem\+json/),
      ]);
      expect(res.json()).toMatchObject({ code: "not_found", requestId: res.headers["x-request-id"] });
    }
  });

  it("OPTIONS (CORS preflight) is a 404 problem: same-origin only, no CORS headers are granted", async () => {
    const res = await api.app.inject({
      method: "OPTIONS",
      url: "/api/v1/transformations",
      headers: { origin: "http://synthetic.invalid", "access-control-request-method": "POST" },
    });
    expect([res.statusCode, String(res.headers["content-type"])]).toEqual([
      404,
      expect.stringMatching(/^application\/problem\+json/),
    ]);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.json()).toMatchObject({ code: "not_found", requestId: res.headers["x-request-id"] });
  });
});

describe("connection-level parser errors (Node clientError) are 400 problems with the security headers", () => {
  let server: TestApi;
  let port: number;
  beforeAll(async () => {
    server = await startApi();
    await server.app.listen({ host: "127.0.0.1", port: 0 });
    port = (server.app.server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  /** Sends raw bytes and returns the parsed response (status line, lower-cased headers, body). */
  function raw(request: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let out = "";
      socket.setEncoding("utf8");
      socket.on("data", (d: string) => (out += d));
      // The server may reset the connection while the oversized request is still being written: keep what arrived.
      socket.on("error", (e) => (out === "" ? reject(e) : undefined));
      socket.on("close", () => {
        const [head = "", body = ""] = out.split("\r\n\r\n");
        const [statusLine = "", ...lines] = head.split("\r\n");
        const headers: Record<string, string> = {};
        for (const line of lines) {
          const i = line.indexOf(":");
          headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
        }
        resolve({ status: Number(statusLine.split(" ")[1]), headers, body });
      });
      socket.write(request);
    });
  }

  async function expectClientProblem(request: string, fieldCode: string, method: string, url: string) {
    const res = await raw(request);
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    const body = JSON.parse(res.body) as { requestId: string; errors: { code: string }[] };
    expect(body).toMatchObject({ type: "urn:mth:problem:validation", status: 400, code: "validation" });
    expect(body.errors[0]!.code).toBe(fieldCode);
    expect(body.requestId).toBe(res.headers["x-request-id"]);
    expect(securityHeadersOf(res.headers)).toEqual(await routedSecurityHeaders(server.app));
    // Declared by the operation the request was aimed at (contract check on the raw response).
    assertContract(method, url, { statusCode: res.status, headers: res.headers, body: res.body });
    expect(await auditOfRequest(server.db, body.requestId)).toEqual([]);
  }

  it("a request header that is too large: 400 validation.headers_too_large (was a plain-JSON 431)", async () => {
    await expectClientProblem(
      `GET /api/v1/me HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Synthetic: ${"a".repeat(20_000)}\r\n\r\n`,
      "validation.headers_too_large",
      "GET",
      "/api/v1/me",
    );
  });

  it("a URL that is too long: 400 validation.headers_too_large (was a plain-JSON 431)", async () => {
    const url = `/api/v1/transformations?q=${"a".repeat(20_000)}`;
    await expectClientProblem(
      `GET ${url} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`,
      "validation.headers_too_large",
      "GET",
      "/api/v1/transformations",
    );
  });

  it("a malformed request line: 400 validation.malformed_request (was a plain-JSON 400)", async () => {
    const res = await raw("NOT A REQUEST\r\n\r\n");
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(res.body)).toMatchObject({
      status: 400,
      requestId: res.headers["x-request-id"],
      errors: [{ code: "validation.malformed_request" }],
    });
  });

  it("over the real socket, a bad path is the same problem as through inject", async () => {
    const res = await raw("GET /api/v1/transformations/%ZZ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(res.body)).toMatchObject({ errors: [{ code: "validation.format" }] });
    assertContract("GET", "/api/v1/transformations/%ZZ", {
      statusCode: res.status,
      headers: res.headers,
      body: res.body,
    });
  });
});
