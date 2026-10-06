// F-DG2-290 (T-DG2-BE13): the strict application/json parser and the query-string check wired into a bare Fastify
// instance with the platform hooks, and the X-File-Name decoding of the evidence upload. Unit tests (no database). This
// file sits at the composition-root level (like server.test.ts) because it drives Fastify with a node:stream body,
// which module source may not import (ADR-0002 / D-055). The pure functions are tested next to them in the platform
// module.
import { Readable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFileName } from "./modules/evidence/routes.ts";
import {
  createJsonBodyParser,
  INVALID_QUERY_DETAIL,
  INVALID_UTF8_BODY_DETAIL,
  parseQueryString,
  registerPlatformHooks,
} from "./modules/platform/index.ts";

const utf8 = (s: string) => Buffer.from(s, "utf8");
const bytes = (...parts: Array<string | number[]>) =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? utf8(p) : Buffer.from(p))));
const BOM = [0xef, 0xbb, 0xbf];
const ARABIC = "تحول اصطناعي";
const EMOJI = "🚀👩🏽‍💻";

describe("decodeFileName (X-File-Name)", () => {
  it("decodes a percent-encoded UTF-8 name and takes a name without escapes literally", () => {
    expect(decodeFileName(encodeURIComponent("تقرير اصطناعي.csv"))).toBe("تقرير اصطناعي.csv");
    expect(decodeFileName("50%.csv")).toBe("50%.csv");
    expect(decodeFileName(undefined)).toBeUndefined();
  });

  it("refuses an escape that is not UTF-8 with 400 validation.file_name", () => {
    for (const raw of ["report%FF.csv", "r%ED%A0%80.csv", "50% %C3%A9.csv"]) {
      let thrown: unknown;
      try {
        decodeFileName(raw);
      } catch (e) {
        thrown = e;
      }
      expect((thrown as { toBody(id: string): unknown }).toBody("r"), raw).toMatchObject({
        status: 400,
        errors: [{ pointer: "/header/X-File-Name", code: "validation.file_name" }],
      });
    }
  });
});

// ------------------------------------------------------------------------------------------------ wired into Fastify

let app: FastifyInstance;
const seen: unknown[] = [];
beforeAll(async () => {
  app = Fastify({ logger: false, bodyLimit: 1024, routerOptions: { querystringParser: parseQueryString } });
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    createJsonBodyParser(app.getDefaultJsonParser("error", "error")),
  );
  registerPlatformHooks(app);
  app.post("/api/echo", { config: { access: { public: true } } }, async (request) => {
    seen.push(request.body);
    return { body: request.body };
  });
  app.get("/api/q", { config: { access: { public: true } } }, async (request) => ({
    q: { ...(request.query as object) },
  }));
  app.get("/api/exempt", { config: { access: { public: true }, invalidCharacters: "route" } }, async (request) => ({
    q: { ...(request.query as object) },
  }));
  await app.ready();
});
afterAll(() => app.close());

const post = (payload: Buffer | Readable, headers: Record<string, string> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/echo",
    headers: { "content-type": "application/json", ...headers },
    payload,
  });

/** A body without Content-Length (light-my-request streams it, as with Transfer-Encoding: chunked). */
const chunked = (b: Buffer) => Readable.from([b.subarray(0, 3), b.subarray(3)]);

describe("the application/json parser", () => {
  it("answers 400 validation.json for invalid UTF-8, the same with Content-Length and chunked; the handler never runs", async () => {
    seen.length = 0;
    for (const b of [[0xff], [0xc3], [0xed, 0xa0, 0x80]]) {
      const body = bytes('{"text":"Synthetic', b, ' text"}');
      for (const res of [await post(body), await post(chunked(body))]) {
        expect(res.statusCode).toBe(400);
        expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
        expect(res.json()).toMatchObject({
          code: "validation",
          errors: [{ pointer: "", code: "validation.json", message: INVALID_UTF8_BODY_DETAIL }],
        });
      }
    }
    expect(seen).toEqual([]);
  });

  it("round-trips valid UTF-8 (Arabic, emoji) verbatim, with Content-Length and chunked", async () => {
    const value = { text: `${ARABIC} ${EMOJI} �` };
    for (const res of [await post(utf8(JSON.stringify(value))), await post(chunked(utf8(JSON.stringify(value))))]) {
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ body: value });
      expect(res.rawPayload.includes(utf8(ARABIC))).toBe(true);
    }
  });

  it("accepts and strips one BOM; a second one is invalid JSON", async () => {
    expect((await post(bytes(BOM, '{"a":1}'))).json()).toEqual({ body: { a: 1 } });
    expect((await post(chunked(bytes(BOM, '{"a":1}')))).json()).toEqual({ body: { a: 1 } });
    const twice = await post(bytes(BOM, BOM, '{"a":1}'));
    expect(twice.statusCode).toBe(400);
    expect(twice.json().errors[0].code).toBe("validation.json");
    // A BOM alone is an empty body after stripping.
    expect((await post(Buffer.from(BOM))).json().errors[0].code).toBe("validation.json");
  });

  it("keeps the other body behaviour: empty, invalid JSON, prototype poisoning, body limit", async () => {
    for (const payload of [Buffer.alloc(0), utf8("{"), utf8('{"__proto__":{"x":1}}')]) {
      const res = await post(payload);
      expect(res.statusCode, payload.toString()).toBe(400);
      expect(res.json().errors[0].code).toBe("validation.json");
    }
    const big = await post(utf8(JSON.stringify({ t: "x".repeat(2000) })));
    expect([big.statusCode, big.json().errors[0].code]).toEqual([400, "validation.body_too_large"]);
    const bigChunked = await post(chunked(utf8(JSON.stringify({ t: "x".repeat(2000) }))));
    expect([bigChunked.statusCode, bigChunked.json().errors[0].code]).toEqual([400, "validation.body_too_large"]);
  });

  it("maps a Content-Length that does not match the bytes to 400 validation.malformed_request, never 500", async () => {
    const res = await post(utf8('{"a":1}'), { "content-length": "3" });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toMatch(/^validation\./);
  });

  it("still runs the central U+0000 / lone-surrogate check after parsing", async () => {
    const res = await post(utf8('{"a":"x\\ud800y"}'));
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([
      expect.objectContaining({ pointer: "/a", code: "validation.invalid_character" }),
    ]);
  });
});

describe("the query-string check", () => {
  it("answers 400 validation.format at /query/<key> for %FF and CESU-8 %ED%A0%80", async () => {
    for (const raw of ["%FF", "%ED%A0%80", "%C3"]) {
      const res = await app.inject({ method: "GET", url: `/api/q?q=${raw}` });
      expect(res.statusCode, raw).toBe(400);
      expect(res.json()).toMatchObject({
        errors: [{ pointer: "/query/q", code: "validation.format", message: INVALID_QUERY_DETAIL }],
      });
      expect(res.body).not.toContain(raw);
    }
  });

  it("passes well-formed queries through decoded", async () => {
    const res = await app.inject({ method: "GET", url: `/api/q?q=${encodeURIComponent(`${ARABIC} ${EMOJI}`)}` });
    expect(res.json()).toEqual({ q: { q: `${ARABIC} ${EMOJI}` } });
  });

  it("leaves an exempt route (invalidCharacters: route) its raw-text fallback", async () => {
    const res = await app.inject({ method: "GET", url: "/api/exempt?state=%ED%A0%80" });
    expect(res.json()).toEqual({ q: { state: "%ED%A0%80" } });
  });
});
