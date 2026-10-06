// F-DG2-320 (T-DG2-BE14): request media types are enforced once, centrally, from each route's declared `consumes`.
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerPlatformHooks } from "./hooks.ts";
import {
  assertValidConsumes,
  mediaTypeEssence,
  registerMediaTypeEnforcement,
  restrictParserTo,
  willParseBody,
} from "./media-types.ts";

describe("mediaTypeEssence", () => {
  it("is the lower-cased type/subtype without parameters; '' when absent", () => {
    expect(mediaTypeEssence("Application/JSON; charset=utf-8")).toBe("application/json");
    expect(mediaTypeEssence(" text/plain ")).toBe("text/plain");
    expect(mediaTypeEssence(undefined)).toBe("");
    expect(mediaTypeEssence("")).toBe("");
    expect(mediaTypeEssence(["application/octet-stream", "text/plain"])).toBe("application/octet-stream");
    expect(mediaTypeEssence("application/json foo")).toBe("application/json foo");
  });
});

describe("willParseBody mirrors Fastify's dispatch (lib/handleRequest.js)", () => {
  const req = (method: string, headers: Record<string, string>) => ({ method, headers });
  it("never for GET/HEAD/TRACE, whatever the headers", () => {
    for (const m of ["GET", "HEAD", "TRACE"])
      expect(willParseBody(req(m, { "content-type": "text/plain", "content-length": "3" }))).toBe(false);
  });
  it("for body methods: a Content-Type, or else a Transfer-Encoding or a non-zero Content-Length", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(willParseBody(req(m, {}))).toBe(false);
      expect(willParseBody(req(m, { "content-length": "0" }))).toBe(false);
      expect(willParseBody(req(m, { "content-type": "application/json" }))).toBe(true);
      expect(willParseBody(req(m, { "content-type": "text/plain", "content-length": "0" }))).toBe(true);
      expect(willParseBody(req(m, { "content-length": "3" }))).toBe(true);
      expect(willParseBody(req(m, { "transfer-encoding": "chunked" }))).toBe(true);
    }
  });
});

describe("assertValidConsumes", () => {
  it("accepts undefined and non-empty subsets of the supported media types", () => {
    expect(() => assertValidConsumes("POST", "/x", undefined)).not.toThrow();
    expect(() => assertValidConsumes("POST", "/x", ["application/octet-stream"])).not.toThrow();
  });
  it("refuses to start on an empty set, an unsupported type or a non-array", () => {
    expect(() => assertValidConsumes("POST", "/x", [])).toThrow(/refusing to start/);
    expect(() => assertValidConsumes("POST", "/x", ["text/plain"])).toThrow(/refusing to start/);
    expect(() => assertValidConsumes("POST", "/x", "application/json")).toThrow(/refusing to start/);
  });
});

/** A minimal app wired like server.ts: platform hooks, enforcement, the JSON and octet-stream parsers. */
async function app(): Promise<{ app: FastifyInstance; seen: string[] }> {
  const a = Fastify({ logger: false });
  const seen: string[] = [];
  registerPlatformHooks(a);
  registerMediaTypeEnforcement(a);
  a.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    restrictParserTo<Buffer>("application/json", (_r, body, done) => {
      seen.push("json-parser");
      done(null, JSON.parse(body.toString("utf8")));
    }),
  );
  a.addContentTypeParser(
    "application/octet-stream",
    restrictParserTo("application/octet-stream", (_r, payload, done) => {
      seen.push("octet-parser");
      done(null, payload);
    }),
  );
  const access = { public: true } as const;
  a.post("/api/json", { config: { access } }, async (r) => ({ body: r.body ?? null }));
  a.post("/api/bytes", { config: { access, consumes: ["application/octet-stream"] } }, async (r) => {
    const chunks: Buffer[] = [];
    for await (const c of r.body as AsyncIterable<Buffer>) chunks.push(c);
    return { hex: Buffer.concat(chunks).toString("hex") };
  });
  a.get("/api/read", { config: { access } }, async () => ({ ok: true }));
  await a.ready();
  return { app: a, seen };
}

describe("registerMediaTypeEnforcement", () => {
  it("refuses an undeclared media type with 400 validation.content_type before any parser runs", async () => {
    const { app: a, seen } = await app();
    const cases: Array<[string, string | undefined, string]> = [
      ["/api/json", "text/plain", "Send the request body as application/json."],
      ["/api/json", "application/octet-stream", "Send the request body as application/json."],
      ["/api/json", undefined, "Send the request body as application/json."],
      ["/api/bytes", "application/json", "Send the request body as application/octet-stream."],
      ["/api/bytes", "text/plain", "Send the request body as application/octet-stream."],
    ];
    for (const [url, contentType, detail] of cases) {
      const res = await a.inject({
        method: "POST",
        url,
        headers: contentType ? { "content-type": contentType } : {},
        payload: Buffer.from('{"a":1}'),
      });
      expect([url, contentType, res.statusCode]).toEqual([url, contentType, 400]);
      expect(res.json().errors).toEqual([{ pointer: "", code: "validation.content_type", message: detail }]);
      expect(res.headers["connection"]).toBe("close");
    }
    expect(seen).toEqual([]);
    await a.close();
  });

  it("the declared media types still work; the octet-stream bytes arrive untouched", async () => {
    const { app: a, seen } = await app();
    const json = await a.inject({ method: "POST", url: "/api/json", payload: { a: 1 } });
    expect([json.statusCode, json.json()]).toEqual([200, { body: { a: 1 } }]);
    const bytes = await a.inject({
      method: "POST",
      url: "/api/bytes",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from([0xff, 0xc3, 0xed, 0xa0, 0x80]),
    });
    expect([bytes.statusCode, bytes.json()]).toEqual([200, { hex: "ffc3eda080" }]);
    expect(seen).toEqual(["json-parser", "octet-parser"]);
    await a.close();
  });

  it("bodiless requests are unchanged: GET with a Content-Type, POST with neither Content-Type nor body", async () => {
    const { app: a } = await app();
    const get = await a.inject({ method: "GET", url: "/api/read", headers: { "content-type": "text/plain" } });
    expect(get.statusCode).toBe(200);
    const post = await a.inject({ method: "POST", url: "/api/json" });
    expect([post.statusCode, post.json()]).toEqual([200, { body: null }]);
    await a.close();
  });

  it("removes Fastify's built-in text/plain parser and refuses an invalid consumes at registration", async () => {
    const a = Fastify({ logger: false });
    expect(a.hasContentTypeParser("text/plain")).toBe(true);
    registerMediaTypeEnforcement(a);
    expect(a.hasContentTypeParser("text/plain")).toBe(false);
    expect(() =>
      a.post("/api/bad", { config: { access: { public: true }, consumes: ["text/plain"] } }, async () => ({})),
    ).toThrow(/refusing to start/);
    await a.close();
  });

  it("the parser guard refuses a media type the route does not declare (defence in depth, without the hook)", async () => {
    const a = Fastify({ logger: false });
    registerPlatformHooks(a);
    a.addContentTypeParser(
      "application/octet-stream",
      restrictParserTo("application/octet-stream", (_r, payload, done) => done(null, payload)),
    );
    a.post("/api/json", { config: { access: { public: true } } }, async () => ({ reached: true }));
    await a.ready();
    const res = await a.inject({
      method: "POST",
      url: "/api/json",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("x"),
    });
    expect([res.statusCode, res.json().errors[0].code]).toEqual([400, "validation.content_type"]);
    await a.close();
  });
});
