// T-DG2-BE12: router-level (`frameworkErrors`) and connection-level (`clientErrorHandler`) errors are problems.
import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import { describe, expect, it } from "vitest";
import { clientErrorProblem, createFrameworkErrorHandler, frameworkProblem } from "./framework-errors.ts";

/** A request stand-in: the route's declared media types (the default JSON route). */
const req = { routeOptions: { config: {} } };
const err = (code: string, statusCode?: number) =>
  Object.assign(new Error(`synthetic ${code}`), { code, ...(statusCode ? { statusCode } : {}) }) as FastifyError;

describe("frameworkProblem", () => {
  it("maps FST_ERR_BAD_URL to 400 validation.format with a clear detail", () => {
    const p = frameworkProblem(err("FST_ERR_BAD_URL", 400), req).toBody("r1");
    expect(p).toEqual({
      type: "urn:mth:problem:validation",
      title: "Validation failed",
      status: 400,
      detail: "The request URL contains an invalid percent-encoding.",
      code: "validation",
      requestId: "r1",
      errors: [
        { pointer: "", code: "validation.format", message: "The request URL contains an invalid percent-encoding." },
      ],
    });
  });

  it("maps FST_ERR_ASYNC_CONSTRAINT to 500 internal without internals", () => {
    const p = frameworkProblem(err("FST_ERR_ASYNC_CONSTRAINT", 500), req).toBody("r2");
    expect(p).toEqual({
      type: "urn:mth:problem:internal",
      title: "Internal error",
      status: 500,
      code: "internal",
      requestId: "r2",
    });
  });

  it("falls back to the generic error mapping for any other code, never a plain body", () => {
    expect(frameworkProblem(err("FST_ERR_CTP_INVALID_MEDIA_TYPE", 415), req).toBody("r").errors).toEqual([
      { pointer: "", code: "validation.content_type", message: "Send the request body as application/json." },
    ]);
    // F-DG2-351: the detail names the route's declared set, never a hard-coded application/json.
    const octetRoute = { routeOptions: { config: { consumes: ["application/octet-stream"] } } };
    expect(frameworkProblem(err("FST_ERR_CTP_INVALID_MEDIA_TYPE", 415), octetRoute).toBody("r").errors).toEqual([
      { pointer: "", code: "validation.content_type", message: "Send the request body as application/octet-stream." },
    ]);
    expect(frameworkProblem(err("FST_ERR_SOMETHING_NEW", 400), req).toBody("r")).toMatchObject({
      status: 500,
      code: "internal",
    });
    expect(frameworkProblem(err("FST_ERR_RATE", 429), req).status).toBe(429);
  });
});

describe("clientErrorProblem", () => {
  it("maps parser errors to problems", () => {
    expect(clientErrorProblem("HPE_HEADER_OVERFLOW").toBody("r")).toMatchObject({
      status: 400,
      errors: [{ code: "validation.headers_too_large" }],
    });
    expect(clientErrorProblem("ERR_HTTP_REQUEST_TIMEOUT").toBody("r")).toMatchObject({
      status: 408,
      code: "request_timeout",
    });
    expect(clientErrorProblem("HPE_INVALID_METHOD").toBody("r")).toMatchObject({
      status: 400,
      errors: [{ code: "validation.malformed_request" }],
    });
    expect(clientErrorProblem(undefined).status).toBe(400);
  });
});

/** An ASYNC constraint strategy (deriveConstraint takes a callback) whose derivation always fails. */
const failingAsyncConstraint = {
  name: "tenant",
  storage: () => {
    const map = new Map<unknown, unknown>();
    return { get: (k: unknown) => map.get(k) ?? null, set: (k: unknown, v: unknown) => void map.set(k, v) };
  },
  deriveConstraint: (_req: unknown, _ctx: unknown, done: (e: Error | null, v?: string) => void) =>
    done(new Error("synthetic constraint failure")),
  validate: () => true,
  mustMatchWhenDerived: true,
} as unknown as NonNullable<FastifyServerOptions["constraints"]>[string];

describe("createFrameworkErrorHandler on a real Fastify router", () => {
  it("answers an async route-constraint failure (FST_ERR_ASYNC_CONSTRAINT) as a 500 problem with the headers", async () => {
    const app = Fastify({
      logger: false,
      frameworkErrors: createFrameworkErrorHandler({ "x-synthetic-security": "on" }),
      constraints: { tenant: failingAsyncConstraint },
    });
    app.get("/x", { constraints: { tenant: "a" } }, async () => "ok");
    const res = await app.inject({ method: "GET", url: "/x" });
    await app.close();
    expect(res.statusCode).toBe(500);
    expect(String(res.headers["content-type"])).toMatch(/^application\/problem\+json/);
    expect(res.headers["x-synthetic-security"]).toBe("on");
    expect(res.json()).toEqual({
      type: "urn:mth:problem:internal",
      title: "Internal error",
      status: 500,
      code: "internal",
      requestId: res.headers["x-request-id"],
    });
    expect(res.body).not.toContain("synthetic constraint failure");
  });

  it("answers a bad URL as a 400 problem with the given security headers and X-Request-Id", async () => {
    const app = Fastify({
      logger: false,
      frameworkErrors: createFrameworkErrorHandler({ "x-synthetic-security": "on" }),
    });
    app.get("/items/:id", async () => "ok");
    const res = await app.inject({ method: "GET", url: "/items/%ZZ" });
    await app.close();
    expect([res.statusCode, res.headers["x-synthetic-security"]]).toEqual([400, "on"]);
    expect(res.json()).toMatchObject({
      requestId: res.headers["x-request-id"],
      errors: [{ code: "validation.format" }],
    });
  });
});
