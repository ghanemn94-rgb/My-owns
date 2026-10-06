// F-DG2-320 (T-DG2-BE14): every operation accepts only the request media types its contract declares, on a real
// PostgreSQL. Before: `uploadEvidenceContent` (declared: application/octet-stream only) stored a chunked text/plain upload
// with its invalid UTF-8 bytes rewritten to U+FFFD (200, sha256 of the rewritten bytes), answered an application/json
// object or array with an undeclared 500 and stored a JSON string's decoded text; JSON operations accepted text/plain
// and application/octet-stream bodies. Now any undeclared media type is the declared 400 `validation.content_type`,
// refused before a body byte is read: nothing is stored, no audit row, no error-level log line.
// Every response is asserted against the OpenAPI contract. All data is SYNTHETIC. G1-G6 are PRODUCT gates (business
// approvals), unrelated to the engineering gates DG0-DG7.
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_ORIGIN,
  auditOf,
  auditOfRequest,
  call,
  seedWorld,
  signIn,
  startApi,
  testEvidenceDir,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { assertContract } from "../support/contract.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

/** Log lines written by the server under test (pino JSON, level 50 = error). */
const logLines: Array<{ level: number; msg: string; requestId?: string }> = [];
const logStream = {
  write(line: string) {
    for (const l of line.split("\n").filter(Boolean)) logLines.push(JSON.parse(l) as (typeof logLines)[number]);
  },
};

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
beforeAll(async () => {
  api = await startApi({ logStream, env: { LOG_LEVEL: "info" } });
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

/** The round-8 repro bytes: "Syn", FF, C3, LF, a CESU-8 lone surrogate (ED A0 80), "A" - not UTF-8. */
const ILL_FORMED = Buffer.from([0x53, 0x79, 0x6e, 0xff, 0xc3, 0x0a, 0xed, 0xa0, 0x80, 0x41]);

type Framing = "content-length" | "chunked";
const FRAMINGS: readonly Framing[] = ["content-length", "chunked"];

/** light-my-request sets Content-Length for a Buffer and none for a stream (the body then arrives like chunked). */
const payloadFor = (body: Buffer, framing: Framing) =>
  framing === "content-length" ? body : Readable.from([body.subarray(0, 3), body.subarray(3)]);

interface RawRes {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: LightMyRequestResponse["headers"];
  raw: LightMyRequestResponse;
}

/** A request with a raw byte body and an explicit media type, authenticated as the lead, asserted against the contract. */
async function rawCall(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  contentType: string | null,
  body: Buffer,
  framing: Framing,
  headers: Record<string, string> = {},
): Promise<RawRes> {
  const raw = await api.app.inject({
    method,
    url,
    headers: {
      ...(contentType === null ? {} : { "content-type": contentType }),
      // A stream payload gets no framing header from light-my-request; declare the chunked framing a socket would have.
      ...(framing === "chunked" ? { "transfer-encoding": "chunked" } : {}),
      origin: APP_ORIGIN,
      cookie: p.lead.session.cookie,
      "x-csrf-token": p.lead.session.csrf,
      ...headers,
    },
    payload: payloadFor(body, framing),
  });
  assertContract(method, url, { statusCode: raw.statusCode, headers: raw.headers, body: raw.body });
  const isJson = String(raw.headers["content-type"] ?? "").includes("json");
  return {
    status: raw.statusCode,
    body: isJson && raw.body !== "" ? raw.json() : raw.body,
    headers: raw.headers,
    raw,
  };
}

/** 400 problem+json validation.content_type; no audit row and no error-level log line for the request. */
async function expectUndeclaredMediaType(res: RawRes, detail: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(String(res.headers["content-type"])).toMatch(/^application\/problem\+json/);
  const requestId = String(res.headers["x-request-id"]);
  expect(res.body).toEqual({
    type: "urn:mth:problem:validation",
    title: "Validation failed",
    status: 400,
    detail,
    code: "validation",
    requestId,
    errors: [{ pointer: "", code: "validation.content_type", message: detail }],
  });
  expect(await auditOfRequest(api.db, requestId)).toEqual([]);
  const forRequest = logLines.filter((l) => l.requestId === requestId);
  expect(forRequest.length).toBeGreaterThan(0); // the logger is live for this request
  expect(forRequest.filter((l) => l.level >= 50 || l.msg === "unhandled error")).toEqual([]);
}

const OCTET_ONLY = "Send the request body as application/octet-stream.";
const JSON_ONLY = "Send the request body as application/json.";

/** Files the evidence store holds for one evidence item (final objects and `.part` temp files). */
function storedFilesOf(evidenceId: string): string[] {
  return readdirSync(testEvidenceDir(), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.parentPath.includes(evidenceId))
    .map((d) => join(d.parentPath, d.name));
}

async function newFileEvidence(title: string): Promise<{ id: string; version: number }> {
  const created = await call(api.app, "POST", `${T}/evidence`, {
    session: p.lead.session,
    body: { ownerUserId: p.lead.id, kind: "file", title },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return { id: created.body.id, version: created.body.version };
}

async function contentRows(evidenceId: string) {
  return api.db.selectFrom("evidence_content").selectAll().where("evidence_id", "=", evidenceId).execute();
}

describe("uploadEvidenceContent accepts only application/octet-stream (F-DG2-320)", () => {
  const cases: Array<{ name: string; contentType: string; body: Buffer; framings: readonly Framing[] }> = [
    { name: "text/plain with ill-formed UTF-8", contentType: "text/plain", body: ILL_FORMED, framings: FRAMINGS },
    {
      name: "text/plain; charset=utf-8",
      contentType: "text/plain; charset=utf-8",
      body: Buffer.from("a,b\n"),
      framings: FRAMINGS,
    },
    {
      name: "application/json object",
      contentType: "application/json",
      body: Buffer.from('{"a":1}'),
      framings: FRAMINGS,
    },
    {
      name: "application/json array",
      contentType: "application/json",
      body: Buffer.from("[1,2,3]"),
      framings: FRAMINGS,
    },
    {
      name: "application/json string",
      contentType: "application/json",
      body: Buffer.from('"Synthetic"'),
      framings: FRAMINGS,
    },
    {
      name: "application/x-www-form-urlencoded",
      contentType: "application/x-www-form-urlencoded",
      body: Buffer.from("a=1"),
      framings: ["content-length"],
    },
    {
      name: "multipart/form-data",
      contentType: "multipart/form-data; boundary=x",
      body: Buffer.from("--x--"),
      framings: ["content-length"],
    },
  ];

  it("every undeclared media type, in each framing: 400 validation.content_type; nothing stored, no audit row", async () => {
    const item = await newFileEvidence("Synthetic media-type probe");
    const auditBefore = await auditOf(api.db, item.id);
    for (const c of cases) {
      for (const framing of c.framings) {
        const res = await rawCall("POST", `${T}/evidence/${item.id}/content`, c.contentType, c.body, framing, {
          ...ifm(item.version),
          "x-file-name": "probe.csv",
        });
        await expectUndeclaredMediaType(res, OCTET_ONLY);
      }
    }
    // A body with no Content-Type at all is not octet-stream either.
    for (const framing of FRAMINGS) {
      const res = await rawCall("POST", `${T}/evidence/${item.id}/content`, null, ILL_FORMED, framing, {
        ...ifm(item.version),
        "x-file-name": "probe.csv",
      });
      await expectUndeclaredMediaType(res, OCTET_ONLY);
    }
    expect(await contentRows(item.id)).toEqual([]);
    expect(storedFilesOf(item.id)).toEqual([]);
    expect(await auditOf(api.db, item.id)).toEqual(auditBefore);
    const after = await call(api.app, "GET", `${T}/evidence/${item.id}`, { session: p.lead.session });
    expect([after.body.version, after.body.currentContentId]).toEqual([item.version, null]);
  });

  it("the refusal precedes authentication, like any body the framework cannot parse (no session: 400, not 401)", async () => {
    const item = await newFileEvidence("Synthetic precedence probe");
    const raw = await api.app.inject({
      method: "POST",
      url: `${T}/evidence/${item.id}/content`,
      headers: { "content-type": "text/plain", origin: APP_ORIGIN, "x-file-name": "probe.csv", ...ifm(item.version) },
      payload: ILL_FORMED,
    });
    const url = `${T}/evidence/${item.id}/content`;
    assertContract("POST", url, { statusCode: raw.statusCode, headers: raw.headers, body: raw.body });
    expect([raw.statusCode, raw.json().errors[0].code]).toEqual([400, "validation.content_type"]);
    // Control: the declared media type without a session is the declared 401.
    const control = await call(api.app, "POST", url, {
      headers: { "content-type": "application/octet-stream", "x-file-name": "probe.csv", ...ifm(item.version) },
      body: ILL_FORMED,
    });
    expect(control.status).toBe(401);
    expect(await contentRows(item.id)).toEqual([]);
  });

  it("a valid application/octet-stream upload stores exactly the bytes sent, in both framings (sha256 of the raw input)", async () => {
    for (const framing of FRAMINGS) {
      const item = await newFileEvidence(`Synthetic exact bytes ${framing}`);
      const res = await rawCall(
        "POST",
        `${T}/evidence/${item.id}/content`,
        "application/octet-stream",
        ILL_FORMED,
        framing,
        {
          ...ifm(item.version),
          "x-file-name": "synthetic.bin",
        },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = await contentRows(item.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sha256).toBe(createHash("sha256").update(ILL_FORMED).digest("hex"));
      expect(Number(rows[0]!.size_bytes)).toBe(ILL_FORMED.length);
      const download = await api.app.inject({
        method: "GET",
        url: `${T}/evidence/${item.id}/content`,
        headers: { cookie: p.lead.session.cookie },
      });
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload.equals(ILL_FORMED)).toBe(true);
      // Positive control for the "nothing stored" helper used above: the stored object is visible to it.
      expect(storedFilesOf(item.id)).toHaveLength(1);
      // A charset parameter does not change the media type: still stored byte for byte.
      const again = await rawCall(
        "POST",
        `${T}/evidence/${item.id}/content`,
        "Application/Octet-Stream; charset=utf-8",
        ILL_FORMED,
        framing,
        { ...ifm(res.body.version), "x-file-name": "synthetic.bin" },
      );
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      const latest = (await contentRows(item.id)).sort((a, b) => b.revision - a.revision)[0]!;
      expect(latest.sha256).toBe(createHash("sha256").update(ILL_FORMED).digest("hex"));
    }
  });

  it("the size limit still applies to octet-stream uploads (unchanged): the declared 413 evidence.too_large", async () => {
    const item = await newFileEvidence("Synthetic size probe");
    const res = await rawCall(
      "POST",
      `${T}/evidence/${item.id}/content`,
      "application/octet-stream",
      Buffer.alloc(25 * 1024 * 1024 + 1, 0x41),
      "content-length",
      { ...ifm(item.version), "x-file-name": "big.bin" },
    );
    expect([res.status, res.body.code]).toEqual([413, "evidence.too_large"]);
    expect(await contentRows(item.id)).toEqual([]);
    expect(storedFilesOf(item.id)).toEqual([]);
  });
});

describe("JSON operations accept only application/json (F-DG2-320)", () => {
  it("createEvidence sent text/plain or application/octet-stream, in each framing: 400; nothing created", async () => {
    const before = await api.db
      .selectFrom("evidence")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("transformation_id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    const valid = Buffer.from(
      JSON.stringify({ ownerUserId: p.lead.id, kind: "note", title: "Synthetic note", noteBody: "Synthetic" }),
    );
    for (const contentType of ["text/plain", "application/octet-stream", "text/plain; charset=utf-8"]) {
      for (const framing of FRAMINGS) {
        const res = await rawCall("POST", `${T}/evidence`, contentType, valid, framing);
        await expectUndeclaredMediaType(res, JSON_ONLY);
      }
    }
    const after = await api.db
      .selectFrom("evidence")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("transformation_id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });

  it("an If-Match update (PATCH) sent application/octet-stream: 400; the record is unchanged", async () => {
    const item = await newFileEvidence("Synthetic patch probe");
    const res = await rawCall(
      "PATCH",
      `${T}/evidence/${item.id}`,
      "application/octet-stream",
      Buffer.from('{"title":"Renamed"}'),
      "content-length",
      ifm(item.version),
    );
    await expectUndeclaredMediaType(res, JSON_ONLY);
    const after = await call(api.app, "GET", `${T}/evidence/${item.id}`, { session: p.lead.session });
    expect([after.body.version, after.body.title]).toEqual([item.version, "Synthetic patch probe"]);
  });

  it("a valid JSON request still works (application/json, with and without a charset)", async () => {
    for (const contentType of ["application/json", "application/json; charset=utf-8"]) {
      const res = await rawCall(
        "POST",
        `${T}/evidence`,
        contentType,
        Buffer.from(
          JSON.stringify({
            ownerUserId: p.lead.id,
            kind: "note",
            title: "Synthetic valid note",
            noteBody: "Synthetic",
          }),
        ),
        "chunked",
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  });
});

describe("bodiless requests behave as before (F-DG2-320 sweep)", () => {
  it("GET with a Content-Type (and even a body) is never refused: the body is not read", async () => {
    const res = await api.app.inject({
      method: "GET",
      url: `${T}/evidence`,
      headers: { cookie: p.lead.session.cookie, "content-type": "text/plain" },
      payload: "ignored",
    });
    assertContract("GET", `${T}/evidence`, { statusCode: res.statusCode, headers: res.headers, body: res.body });
    expect(res.statusCode).toBe(200);
  });

  it("a bodiless POST with no Content-Type and no body reaches its handler; an empty JSON body keeps its 400", async () => {
    const item = await newFileEvidence("Synthetic empty-body probe");
    // uploadEvidenceContent with no body at all: the handler's own declared 400 body_required (unchanged).
    const none = await api.app.inject({
      method: "POST",
      url: `${T}/evidence/${item.id}/content`,
      headers: {
        origin: APP_ORIGIN,
        cookie: p.lead.session.cookie,
        "x-csrf-token": p.lead.session.csrf,
        "x-file-name": "x.csv",
        ...ifm(item.version),
      },
    });
    expect([none.statusCode, none.json().errors[0].code]).toEqual([400, "validation.body_required"]);
    // createEvidence with Content-Type application/json and an empty body: validation.json, as before.
    const empty = await rawCall("POST", `${T}/evidence`, "application/json", Buffer.alloc(0), "content-length");
    expect([empty.status, empty.body.errors[0].code]).toEqual([400, "validation.json"]);
    // logout (no request body declared) with no body and no Content-Type: still reaches its handler.
    const session = await signIn(api.app, w.office.subject);
    const logout = await call(api.app, "POST", "/api/v1/auth/logout", { session });
    expect(logout.status).toBeLessThan(400);
    // ... and with an empty JSON object, as the web client may send: unchanged (application/json is accepted).
    const again = await signIn(api.app, w.office.subject);
    const logoutJson = await call(api.app, "POST", "/api/v1/auth/logout", { session: again, body: {} });
    expect(logoutJson.status).toBeLessThan(400);
  });

  it("an unknown route keeps its 404, whatever the media type", async () => {
    const res = await api.app.inject({
      method: "POST",
      url: "/api/v1/does-not-exist",
      headers: { "content-type": "text/plain" },
      payload: "x",
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// T-DG2-BE15 (F-DG2-350, F-DG2-351): one media-type decision for every request, matched or not.
// ---------------------------------------------------------------------------------------------------------------------

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Every body class an unmatched route can receive (F-DG2-350). */
const UNMATCHED_BODIES: ReadonlyArray<{ name: string; contentType: string | null; body: Buffer; framing: Framing }> = [
  { name: "octet-stream", contentType: "application/octet-stream", body: ILL_FORMED, framing: "content-length" },
  { name: "octet-stream chunked", contentType: "application/octet-stream", body: ILL_FORMED, framing: "chunked" },
  { name: "json", contentType: "application/json", body: Buffer.from('{"a":1}'), framing: "content-length" },
  { name: "invalid json", contentType: "application/json", body: Buffer.from('{"a":'), framing: "content-length" },
  { name: "json chunked", contentType: "application/json", body: Buffer.from("[1]"), framing: "chunked" },
  { name: "text/plain", contentType: "text/plain", body: Buffer.from("x"), framing: "content-length" },
  { name: "no content-type, with a body", contentType: null, body: ILL_FORMED, framing: "content-length" },
  { name: "no content-type, chunked", contentType: null, body: ILL_FORMED, framing: "chunked" },
  { name: "malformed content-type", contentType: "application/octet-stream;;;=", body: ILL_FORMED, framing: "chunked" },
  {
    name: "json over bodyLimit",
    contentType: "application/json",
    body: Buffer.alloc(2 * 1024 * 1024, 0x20),
    framing: "content-length",
  },
];

describe("an unmatched route is 404 not_found whatever its body (F-DG2-350)", () => {
  it("S10 (code-security round 9) regression: POST/PUT/DELETE x text/plain, JSON, octet-stream x with/without a session", async () => {
    const BYTES = ILL_FORMED;
    for (const [method, url] of [
      ["POST", "/api/v1/does-not-exist"],
      ["POST", "/does-not-exist"],
      ["PUT", `${T}/evidence`],
      ["DELETE", `${T}/evidence`],
    ] as Array<["POST" | "PUT" | "DELETE", string]>) {
      for (const ct of ["text/plain", "application/json", "application/octet-stream"]) {
        for (const auth of [false, true]) {
          const res = await api.app.inject({
            method,
            url,
            headers: {
              "content-type": ct,
              ...(auth
                ? { cookie: p.lead.session.cookie, origin: APP_ORIGIN, "x-csrf-token": p.lead.session.csrf }
                : { origin: APP_ORIGIN }),
            },
            payload: ct === "application/json" ? Buffer.from("{}") : BYTES,
          });
          expect([method, url, ct, auth, res.statusCode, res.json().code]).toEqual([
            method,
            url,
            ct,
            auth,
            404,
            "not_found",
          ]);
        }
      }
    }
  });

  it("every method x body class x session: 404 not_found (problem+json), the connection closes, nothing parsed or logged as an error", async () => {
    const before = logLines.filter((l) => l.level >= 50 || l.msg === "unhandled error").length;
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const)
      for (const url of ["/api/v1/does-not-exist", "/does-not-exist", `${T}/evidence/not-a-route/x`])
        for (const b of UNMATCHED_BODIES)
          for (const auth of [false, true]) {
            const raw = await api.app.inject({
              method,
              url,
              headers: {
                ...(b.contentType === null ? {} : { "content-type": b.contentType }),
                ...(b.framing === "chunked" ? { "transfer-encoding": "chunked" } : {}),
                origin: APP_ORIGIN,
                ...(auth ? { cookie: p.lead.session.cookie, "x-csrf-token": p.lead.session.csrf } : {}),
              },
              payload: payloadFor(b.body, b.framing),
            });
            const key = [method, url, b.name, auth];
            expect([...key, raw.statusCode, raw.json().code]).toEqual([...key, 404, "not_found"]);
            expect(String(raw.headers["content-type"])).toMatch(/^application\/problem\+json/);
            expect(raw.headers["connection"]).toBe("close");
          }
    expect(logLines.filter((l) => l.level >= 50 || l.msg === "unhandled error").length).toBe(before);
  });

  it("on a real keep-alive socket the unread body never becomes the next request: the server closes after the 404", async () => {
    const port = await listenBelowEphemeral();
    // The body is a complete HTTP request: if it leaked into the connection it would be answered as a second request.
    const smuggled = Buffer.from(`GET /api/v1/me HTTP/1.1\r\nHost: x\r\n\r\n`);
    for (const [ct, framing] of [
      ["application/octet-stream", "content-length"],
      ["application/json", "content-length"],
      ["text/plain", "chunked"],
      [null, "content-length"],
    ] as Array<[string | null, Framing]>) {
      const head =
        `POST /api/v1/does-not-exist HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n` +
        (ct === null ? "" : `Content-Type: ${ct}\r\n`) +
        (framing === "chunked"
          ? `Transfer-Encoding: chunked\r\n\r\n${smuggled.length.toString(16)}\r\n`
          : `Content-Length: ${smuggled.length}\r\n\r\n`);
      const tail = framing === "chunked" ? "\r\n0\r\n\r\n" : "";
      const text = await rawSocket(port, Buffer.concat([Buffer.from(head), smuggled, Buffer.from(tail)]));
      const statuses = [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => m[1]);
      expect([ct, framing, statuses]).toEqual([ct, framing, ["404"]]);
      expect(text.toLowerCase()).toContain("connection: close");
    }
    // Positive control: the same raw-socket helper sees a matched response normally.
    const control = await rawSocket(port, Buffer.from("GET /healthz HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
    expect(control).toMatch(/^HTTP\/1\.1 200/);
  });
});

/** Listens on a free port in 26000-31999 (below the Linux ephemeral range); retries on a collision. */
async function listenBelowEphemeral(): Promise<number> {
  const address = api.app.server.address();
  if (address !== null && typeof address === "object") return address.port;
  for (let attempt = 0; ; attempt++) {
    const port = 26000 + Math.floor(Math.random() * 6000);
    try {
      await api.app.listen({ port, host: "127.0.0.1" });
      return port;
    } catch (err) {
      if ((err as { code?: string }).code !== "EADDRINUSE" || attempt >= 20) throw err;
    }
  }
}

/** Writes raw bytes to a new socket and resolves with everything the server sent until it closed (5 s cap). */
function rawSocket(port: number, request: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => s.destroy(), 5000);
    s.on("data", (c: Buffer) => chunks.push(c));
    s.on("error", reject);
    s.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("latin1"));
    });
    s.write(request);
  });
}

describe("the media-type check and the parser lookup agree for every spelling (F-DG2-351)", () => {
  /** Accepted spellings of application/octet-stream: RFC 9110 OWS (SP/HTAB) around ";", case, parameters. */
  const OCTET_SPELLINGS = [
    "application/octet-stream\t; x=1", // S11 (code-security round 9): refused before with a JSON detail
    "application/octet-stream ; x=1",
    "application/octet-stream;\tx=1",
    "application/octet-stream \t;\t x=1",
    "APPLICATION/OCTET-STREAM\t;\tCharset=UTF-8",
    "\tapplication/octet-stream ",
    "application/octet-stream;",
  ];

  it("S11 (code-security round 9) regression: the tab-before-';' upload is accepted and stored byte-exact", async () => {
    for (const framing of FRAMINGS) {
      const item = await newFileEvidence(`Synthetic S11 ${framing}`);
      const res = await rawCall(
        "POST",
        `${T}/evidence/${item.id}/content`,
        "application/octet-stream\t; x=1",
        ILL_FORMED,
        framing,
        {
          ...ifm(item.version),
          "x-file-name": "s11.bin",
        },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = await contentRows(item.id);
      expect(rows.map((r) => r.sha256)).toEqual([sha256(ILL_FORMED)]);
    }
  });

  it("S11: every refusal on uploadEvidenceContent names application/octet-stream (never a hard-coded JSON text)", async () => {
    const item = await newFileEvidence("Synthetic S11 refusals");
    for (const ct of [
      "application/octet-stream\t;;;=",
      "application/octet-stream foo",
      "application/octet-stream, application/json",
      "application/json\t; charset=utf-8",
      "",
      "*/*",
    ])
      for (const framing of FRAMINGS) {
        const res = await rawCall("POST", `${T}/evidence/${item.id}/content`, ct, ILL_FORMED, framing, {
          ...ifm(item.version),
          "x-file-name": "s11.bin",
        });
        await expectUndeclaredMediaType(res, OCTET_ONLY);
      }
    expect(await contentRows(item.id)).toEqual([]);
    expect(storedFilesOf(item.id)).toEqual([]);
  });

  it("every OWS/whitespace spelling of octet-stream reaches the octet parser: stored byte-exact (sha256), downloadable", async () => {
    for (const ct of OCTET_SPELLINGS)
      for (const framing of FRAMINGS) {
        const item = await newFileEvidence(`Synthetic OWS upload ${framing}`);
        const res = await rawCall("POST", `${T}/evidence/${item.id}/content`, ct, ILL_FORMED, framing, {
          ...ifm(item.version),
          "x-file-name": "ows.bin",
        });
        expect([ct, framing, res.status], JSON.stringify(res.body)).toEqual([ct, framing, 200]);
        const rows = await contentRows(item.id);
        expect([ct, rows.map((r) => [r.sha256, Number(r.size_bytes)])]).toEqual([
          ct,
          [[sha256(ILL_FORMED), ILL_FORMED.length]],
        ]);
        const download = await api.app.inject({
          method: "GET",
          url: `${T}/evidence/${item.id}/content`,
          headers: { cookie: p.lead.session.cookie },
        });
        expect(download.rawPayload.equals(ILL_FORMED)).toBe(true);
      }
  });

  it("every OWS/whitespace spelling of application/json reaches the JSON parser: accepted and stored verbatim", async () => {
    const spellings = [
      "application/json\t; charset=utf-8",
      "application/json ; charset=UTF-8",
      'application/json;\tcharset="utf-8"',
      "Application/JSON \t",
      "\tapplication/json",
    ];
    for (const ct of spellings)
      for (const framing of FRAMINGS) {
        const title = `Synthetic OWS note ${spellings.indexOf(ct)} ${framing} \u0645\u0644\u0627\u062d\u0638\u0629`;
        const body = Buffer.from(
          JSON.stringify({ ownerUserId: p.lead.id, kind: "note", title, noteBody: "Synthetic \u00e9" }),
        );
        const res = await rawCall("POST", `${T}/evidence`, ct, body, framing);
        expect([ct, framing, res.status], JSON.stringify(res.body)).toEqual([ct, framing, 201]);
        const row = await api.db
          .selectFrom("evidence")
          .select(["title"])
          .where("id", "=", res.body.id as string)
          .executeTakeFirstOrThrow();
        expect(row.title).toBe(title);
      }
  });

  it("every refusal on a JSON operation names application/json: malformed, other charsets, octet-stream spellings", async () => {
    const valid = Buffer.from(
      JSON.stringify({ ownerUserId: p.lead.id, kind: "note", title: "Synthetic refused", noteBody: "x" }),
    );
    for (const ct of [
      "application/json; charset=iso-8859-1",
      "application/json; charset=utf-16",
      "application/json\t; charset",
      "application/json foo",
      "application/json, text/plain",
      "application/octet-stream\t; x=1",
      " ",
    ])
      for (const framing of FRAMINGS)
        await expectUndeclaredMediaType(await rawCall("POST", `${T}/evidence`, ct, valid, framing), JSON_ONLY);
  });
});
