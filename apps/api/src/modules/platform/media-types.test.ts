// F-DG2-320 (T-DG2-BE14): request media types are enforced once, centrally, from each route's declared `consumes`.
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerPlatformHooks } from "./hooks.ts";
import {
  assertValidConsumes,
  canonicalContentType,
  contentTypeFieldLines,
  decideMediaType,
  mediaTypeEssence,
  parametersAcceptable,
  parseContentType,
  registerMediaTypeEnforcement,
  restrictParserTo,
  willParseBody,
} from "./media-types.ts";

describe("mediaTypeEssence", () => {
  it("is the lower-cased type/subtype without parameters; '' when absent, multi-valued or malformed", () => {
    expect(mediaTypeEssence("Application/JSON; charset=utf-8")).toBe("application/json");
    expect(mediaTypeEssence(" text/plain ")).toBe("text/plain");
    expect(mediaTypeEssence("application/octet-stream\t; x=1")).toBe("application/octet-stream");
    expect(mediaTypeEssence(undefined)).toBe("");
    expect(mediaTypeEssence("")).toBe("");
    // T-DG2-BE15: a header array (two Content-Type values) is ambiguous; text after the subtype is malformed.
    expect(mediaTypeEssence(["application/octet-stream", "text/plain"])).toBe("");
    expect(mediaTypeEssence("application/json foo")).toBe("");
  });
});

// T-DG2-BE15 (F-DG2-351): RFC 9110 §8.3.1 media-type = type "/" subtype parameters;
// parameters = *( OWS ";" OWS [ parameter ] ); parameter-value = token / quoted-string; OWS = *( SP / HTAB ).
describe("parseContentType (RFC 9110 §8.3.1)", () => {
  const ok: Array<[string, string, Array<[string, string]>, string]> = [
    // [header, essence, parameters, canonical form]
    ["application/json", "application/json", [], "application/json"],
    ["APPLICATION/JSON", "application/json", [], "application/json"],
    ["Application/Json; Charset=UTF-8", "application/json", [["charset", "UTF-8"]], "application/json; charset=UTF-8"],
    ["application/json;charset=utf-8", "application/json", [["charset", "utf-8"]], "application/json; charset=utf-8"],
    ["application/json ; charset=utf-8", "application/json", [["charset", "utf-8"]], "application/json; charset=utf-8"],
    [
      "application/json\t; charset=utf-8",
      "application/json",
      [["charset", "utf-8"]],
      "application/json; charset=utf-8",
    ],
    ["application/json;\tcharset=utf-8", "application/json", [["charset", "utf-8"]], "application/json; charset=utf-8"],
    [" \tapplication/json\t ", "application/json", [], "application/json"],
    [
      'application/json; charset="utf-8"',
      "application/json",
      [["charset", '"utf-8"']],
      'application/json; charset="utf-8"',
    ],
    ["application/octet-stream\t; x=1", "application/octet-stream", [["x", "1"]], "application/octet-stream; x=1"],
    ["application/octet-stream;", "application/octet-stream", [], "application/octet-stream"],
    ["application/octet-stream ;; x=1 ;", "application/octet-stream", [["x", "1"]], "application/octet-stream; x=1"],
    ['a/b; q="x\\"y; z"', "a/b", [["q", '"x\\"y; z"']], 'a/b; q="x\\"y; z"'],
    ["*/*", "*/*", [], "*/*"],
  ];
  it.each(ok)("parses %j", (header, essence, parameters, canonical) => {
    const parsed = parseContentType(header);
    expect(parsed).toEqual({ essence, parameters });
    expect(canonicalContentType(parsed!)).toBe(canonical);
    // The canonical form is a fixed point.
    expect(parseContentType(canonical)).toEqual({ essence, parameters });
  });

  const malformed: Array<[string, string | string[] | undefined]> = [
    ["absent", undefined],
    ["empty", ""],
    ["only whitespace", " \t "],
    ["header array (duplicate Content-Type)", ["application/json", "application/json"]],
    ["no subtype", "application"],
    ["empty subtype", "application/"],
    ["empty type", "/json"],
    ["space inside type/subtype", "application/ json"],
    ["space before slash", "application /json"],
    ["text after subtype", "application/json foo"],
    ["list", "application/octet-stream, application/json"],
    ["parameter without =", "application/json; charset"],
    ["empty parameter name", "application/json; =utf-8"],
    ["empty parameter value", "application/json; charset="],
    ["garbage parameters", "application/octet-stream;;;="],
    ["space around =", "application/json; charset = utf-8"],
    ["unterminated quoted-string", 'application/json; charset="utf-8'],
    ["text after quoted-string", 'application/json; charset="utf-8"x'],
    ["control character", "application/json\u0000"],
    ["CR LF", "application/json\r\n"],
    ["non-tchar in subtype", "application/js(on)"],
  ];
  it.each(malformed)("refuses %s", (_name, header) => {
    expect(parseContentType(header)).toBeNull();
  });
});

describe("parametersAcceptable", () => {
  const p = (h: string) => parametersAcceptable(parseContentType(h)!);
  it("application/json: any charset must be UTF-8 (RFC 8259 §8.1); other parameters are ignored", () => {
    expect(p("application/json")).toBe(true);
    expect(p("application/json; charset=UTF-8")).toBe(true);
    expect(p('application/json; charset="utf-8"')).toBe(true);
    expect(p("application/json; x=1")).toBe(true);
    expect(p("application/json; charset=iso-8859-1")).toBe(false);
    expect(p("application/json; charset=utf-16")).toBe(false);
    expect(p("application/json; charset=utf8")).toBe(false);
    expect(p("application/json; charset=utf-8; charset=latin1")).toBe(false);
  });
  it("application/octet-stream: parameters never change the stored bytes, so any well-formed one is accepted", () => {
    expect(p("application/octet-stream; charset=latin1; x=1")).toBe(true);
  });
});

describe("decideMediaType: one decision for every request", () => {
  const r = (method: string, headers: Record<string, string | string[]>, is404 = false, consumes?: string[]) => ({
    method,
    headers,
    is404,
    routeOptions: { config: consumes ? { consumes } : {} },
  });
  it("an unmatched route with a body is never refused, whatever its media type (F-DG2-350)", () => {
    for (const ct of ["application/octet-stream", "application/json", "text/plain", "", "x", "a/b;;;="])
      expect(decideMediaType(r("POST", { "content-type": ct, "content-length": "3" }, true))).toEqual({
        kind: "unmatched-route",
      });
    expect(decideMediaType(r("PUT", { "transfer-encoding": "chunked" }, true))).toEqual({ kind: "unmatched-route" });
    expect(decideMediaType(r("POST", {}, true))).toEqual({ kind: "no-body" });
  });
  it("accepts iff the essence is declared, and returns the canonical header", () => {
    expect(decideMediaType(r("POST", { "content-type": "Application/JSON\t; Charset=utf-8" }))).toEqual({
      kind: "accept",
      contentType: "application/json; charset=utf-8",
    });
    const octet = ["application/octet-stream"];
    expect(decideMediaType(r("POST", { "content-type": "application/octet-stream\t; x=1" }, false, octet))).toEqual({
      kind: "accept",
      contentType: "application/octet-stream; x=1",
    });
    const refused = decideMediaType(r("POST", { "content-type": "application/json" }, false, octet));
    expect(refused.kind).toBe("refuse");
    expect(refused.kind === "refuse" && refused.problem.toBody("r").detail).toBe(
      "Send the request body as application/octet-stream.",
    );
    expect(decideMediaType(r("POST", { "content-type": "application/json; charset=latin1" })).kind).toBe("refuse");
  });
  it("T-DG2-BE15B: two Content-Type field lines are refused on a matched route (Node keeps only the first)", () => {
    const withRaw = (rawHeaders: string[], is404 = false) => ({
      ...r("POST", { "content-type": "application/json", "content-length": "2" }, is404),
      raw: { rawHeaders },
    });
    const one = ["Host", "x", "Content-Type", "application/json", "Content-Length", "2"];
    const two = ["Host", "x", "Content-Type", "application/json", "content-type", "application/octet-stream"];
    expect(decideMediaType(withRaw(one)).kind).toBe("accept");
    const refused = decideMediaType(withRaw(two));
    expect(refused.kind === "refuse" && refused.problem.toBody("r").detail).toBe(
      "Send the request body as application/json.",
    );
    // An unmatched route is never refused, duplicates or not.
    expect(decideMediaType(withRaw(two, true))).toEqual({ kind: "unmatched-route" });
  });
});

describe("contentTypeFieldLines", () => {
  it("counts Content-Type lines case-insensitively in rawHeaders (names at even indexes only)", () => {
    expect(contentTypeFieldLines(undefined)).toBe(0);
    expect(contentTypeFieldLines([])).toBe(0);
    expect(contentTypeFieldLines(["X-Note", "content-type", "Content-Type", "a/b"])).toBe(1);
    expect(contentTypeFieldLines(["CONTENT-TYPE", "a/b", "Content-type", "a/b", "content-type", ""])).toBe(3);
  });
});

describe("restrictParserTo (defence in depth)", () => {
  it("refuses with the route's declared set (never a hard-coded JSON text) and does not call the parser", () => {
    let called = 0;
    const parse = restrictParserTo<Buffer>("application/json", (_r, _b, done) => {
      called++;
      done(null, {});
    });
    const results: unknown[] = [];
    const octetRoute = { routeOptions: { config: { consumes: ["application/octet-stream"] } } };
    parse(octetRoute as never, Buffer.from("{}"), (err) => results.push(err));
    expect(called).toBe(0);
    expect((results[0] as { toBody: (id: string) => { detail: string } }).toBody("r").detail).toBe(
      "Send the request body as application/octet-stream.",
    );
    parse({ routeOptions: { config: {} } } as never, Buffer.from("{}"), (err) => results.push(err));
    expect([called, results[1]]).toEqual([1, null]);
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

// T-DG2-BE15: the check and Fastify's parser lookup agree for every spelling (F-DG2-351), and an unmatched route is a
// 404 whatever its body (F-DG2-350).
describe("one decision: every accepted spelling reaches the declared parser; every refused one is the 400", () => {
  const BYTES = Buffer.from([0xff, 0xc3, 0x0a]);
  const octetAccepted = [
    "application/octet-stream",
    "APPLICATION/OCTET-STREAM",
    "Application/Octet-Stream; Charset=UTF-8",
    "application/octet-stream ; x=1",
    "application/octet-stream\t; x=1",
    "application/octet-stream;\tx=1",
    "application/octet-stream \t;\t x=1 \t",
    " \tapplication/octet-stream",
    "application/octet-stream;",
    'application/octet-stream; name="a b; c"',
  ];
  const jsonAccepted = [
    "application/json",
    "Application/JSON",
    "application/json; charset=utf-8",
    "application/json\t; charset=utf-8",
    "application/json ;\tcharset=UTF-8",
    'application/json; charset="utf-8"',
    "\tapplication/json ",
  ];
  const refusedEverywhere = [
    "",
    " ",
    "text/plain",
    "application/octet-streamx",
    "application/octet-stream, application/json",
    "application/json, application/octet-stream",
    "*/*",
    "application/*",
    "application/octet-stream;;;=",
    "application/json; charset",
    "application/json foo",
    "application/octet-stream foo",
    "text/plain; x=application/json",
  ];

  // Chunked framing for every spelling is covered by the integration suite (test/integration/media-types.test.ts):
  // this module may not import node:stream (ADR-0002 built-in allow-list).
  it("application/octet-stream spellings: accepted, the octet parser runs, the bytes arrive untouched", async () => {
    const { app: a, seen } = await app();
    for (const ct of octetAccepted) {
      seen.length = 0;
      const res = await a.inject({
        method: "POST",
        url: "/api/bytes",
        headers: { "content-type": ct },
        payload: BYTES,
      });
      expect([ct, res.statusCode, res.body]).toEqual([ct, 200, '{"hex":"ffc30a"}']);
      expect(seen).toEqual(["octet-parser"]);
    }
    await a.close();
  });

  it("application/json spellings: accepted, the JSON parser runs, the body is parsed", async () => {
    const { app: a, seen } = await app();
    for (const ct of jsonAccepted) {
      seen.length = 0;
      const res = await a.inject({
        method: "POST",
        url: "/api/json",
        headers: { "content-type": ct },
        payload: '{"a":1}',
      });
      expect([ct, res.statusCode, res.body]).toEqual([ct, 200, '{"body":{"a":1}}']);
      expect(seen).toEqual(["json-parser"]);
    }
    await a.close();
  });

  it("every refused spelling is the 400 naming the route's declared set; no parser runs", async () => {
    const { app: a, seen } = await app();
    const cases: Array<[string, string, string]> = [
      ...refusedEverywhere.map((ct): [string, string, string] => ["/api/bytes", ct, "application/octet-stream"]),
      ...refusedEverywhere.map((ct): [string, string, string] => ["/api/json", ct, "application/json"]),
      ...jsonAccepted.map((ct): [string, string, string] => ["/api/bytes", ct, "application/octet-stream"]),
      ...octetAccepted.map((ct): [string, string, string] => ["/api/json", ct, "application/json"]),
      ["/api/json", "application/json; charset=iso-8859-1", "application/json"],
      ["/api/json", "application/json; charset=utf-16", "application/json"],
    ];
    for (const [url, ct, declared] of cases) {
      const res = await a.inject({ method: "POST", url, headers: { "content-type": ct }, payload: '{"a":1}' });
      expect([url, ct, res.statusCode]).toEqual([url, ct, 400]);
      expect(res.json().errors).toEqual([
        { pointer: "", code: "validation.content_type", message: `Send the request body as ${declared}.` },
      ]);
      expect(res.headers["connection"]).toBe("close");
    }
    expect(seen).toEqual([]);
    await a.close();
  });

  it("an unmatched route answers 404 not_found for every body; no parser runs; the connection closes", async () => {
    const { app: a, seen } = await app();
    const bodies: Array<[string, Record<string, string>, Buffer]> = [
      ["octet-stream", { "content-type": "application/octet-stream" }, BYTES],
      ["json", { "content-type": "application/json" }, Buffer.from('{"a":1}')],
      ["invalid json", { "content-type": "application/json" }, Buffer.from("{")],
      ["text/plain", { "content-type": "text/plain" }, Buffer.from("x")],
      ["malformed", { "content-type": "a/b;;;=" }, Buffer.from("x")],
      ["no content-type", {}, Buffer.from("x")],
      ["over bodyLimit", { "content-type": "application/json" }, Buffer.alloc(2 * 1024 * 1024, 0x20)],
    ];
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const)
      for (const [name, headers, payload] of bodies) {
        const res = await a.inject({ method, url: "/api/nope", headers, payload });
        expect([method, name, res.statusCode, res.json().code]).toEqual([method, name, 404, "not_found"]);
        expect(res.headers["connection"]).toBe("close");
      }
    expect(seen).toEqual([]);
    await a.close();
  });

  it("FST_ERR_CTP_INVALID_MEDIA_TYPE (no parser for the route) names the declared set, not a hard-coded JSON text", async () => {
    // A route that declares octet-stream in an instance with no octet-stream parser: the backstop mapping (hooks.ts).
    const a = Fastify({ logger: false });
    registerPlatformHooks(a);
    registerMediaTypeEnforcement(a);
    a.post(
      "/api/bytes",
      { config: { access: { public: true }, consumes: ["application/octet-stream"] } },
      async () => ({}),
    );
    await a.ready();
    const res = await a.inject({
      method: "POST",
      url: "/api/bytes",
      headers: { "content-type": "application/octet-stream" },
      payload: BYTES,
    });
    expect([res.statusCode, res.json().errors]).toEqual([
      400,
      [{ pointer: "", code: "validation.content_type", message: "Send the request body as application/octet-stream." }],
    ]);
    await a.close();
  });
});
