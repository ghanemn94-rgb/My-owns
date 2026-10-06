// code-security-reviewer DG2 round-10 adversarial probe (T-DG2-REV-SEC-R10). NOT part of the candidate: copied into a
// disposable clone (68fe3394 = source fe22d759 + delivery metadata) at apps/api/test/integration/ and run on a
// disposable PostgreSQL 16. All data SYNTHETIC. Each assertion states the secure/declared expectation (a failing test
// shows a defect); every observation is also logged as "PROBE <key>: <json>".
// Scope: BE15/BE15B (F-DG2-350, F-DG2-351): any remaining Content-Type spelling or framing where the central decision
// and Fastify's parser lookup disagree, a refusal names the wrong media type, an unmatched route answers anything but
// 404, a body is rewritten, or the answer is undeclared / a 500; plus no regression of CSRF, rate limiting, bodyLimit,
// the evidence streaming limit / raw sha256, and keep-alive framing.
import { createHash } from "node:crypto";
import { connect, type AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertContract } from "../support/contract.ts";
import { call, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";
import { frameworkProblem } from "../../src/modules/platform/framework-errors.ts";
import { decideMediaType, parseContentType } from "../../src/modules/platform/media-types.ts";

const logLines: Array<{ level: number; msg: string }> = [];
const logStream = {
  write(line: string) {
    for (const l of line.split("\n").filter(Boolean)) logLines.push(JSON.parse(l));
  },
};
let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let port: number;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const errorLogs = () => logLines.filter((l) => l.level >= 50 || l.msg === "unhandled error").length;

beforeAll(async () => {
  api = await startApi({ logStream, env: { LOG_LEVEL: "info" } });
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  await api.app.listen({ port: 0, host: "127.0.0.1" });
  port = (api.app.server.address() as AddressInfo).port;
});
afterAll(() => api.close());

const ORIGIN = () => new URL(String(api.config.appBaseUrl)).origin;
const authHeaders = (s = p.lead.session) => ({ cookie: s.cookie, origin: ORIGIN(), "x-csrf-token": s.csrf });
const BYTES = Buffer.from([0x53, 0x79, 0x6e, 0xff, 0xc3, 0x0a, 0xed, 0xa0, 0x80, 0x41]); // not UTF-8
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const OCTET_DETAIL = "Send the request body as application/octet-stream.";
const JSON_DETAIL = "Send the request body as application/json.";

async function send(method: string, url: string, headers: Record<string, string>, body: Buffer | null, framing: "cl" | "chunked") {
  const raw = await api.app.inject({
    method: method as "POST",
    url,
    headers: { ...headers, ...(framing === "chunked" && body !== null ? { "transfer-encoding": "chunked" } : {}) },
    ...(body === null ? {} : { payload: framing === "cl" ? body : Readable.from([body.subarray(0, 3), body.subarray(3)]) }),
  });
  let declared = true;
  let why = "";
  try {
    assertContract(method, url, { statusCode: raw.statusCode, headers: raw.headers, body: raw.body });
  } catch (e) {
    declared = false;
    why = String((e as Error).message).slice(0, 200);
  }
  let json: { code?: string; detail?: string; errors?: Array<{ pointer: string; code: string; message?: string }> } = {};
  try {
    json = raw.json();
  } catch {
    /* not JSON */
  }
  return { status: raw.statusCode, code: json.errors?.[0]?.code ?? json.code, detail: json.errors?.[0]?.message ?? json.detail, declared, why, raw };
}

/**
 * Raw socket: writes `parts` (with optional delays), collects everything until the server closes or `waitMs` elapses.
 * Returns all status lines, whether the server closed the socket, and the time to first byte.
 */
function socketExchange(parts: Array<Buffer | number>, waitMs = 4000): Promise<{ statuses: string[]; closedByServer: boolean; text: string; firstByteMs: number }> {
  return new Promise((resolve) => {
    const s = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const t0 = Date.now();
    let firstByteMs = -1;
    let closedByServer = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString("latin1");
      resolve({ statuses: text.match(/HTTP\/1\.1 \d{3}/g) ?? [], closedByServer, text, firstByteMs });
    };
    s.on("data", (c) => {
      if (firstByteMs < 0) firstByteMs = Date.now() - t0;
      chunks.push(c);
    });
    s.on("end", () => {
      closedByServer = true;
    });
    s.on("error", () => {
      closedByServer = true;
    });
    s.on("close", finish);
    (async () => {
      for (const part of parts) {
        if (typeof part === "number") await new Promise((r) => setTimeout(r, part));
        else if (!s.destroyed) s.write(part);
      }
    })();
    setTimeout(() => {
      s.destroy();
      finish();
    }, waitMs);
  });
}

async function newFile(title: string) {
  const c = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { ownerUserId: p.lead.id, kind: "file", title } });
  expect(c.status).toBe(201);
  return { id: c.body.id as string, version: c.body.version as number };
}
const storedOf = async (id: string) =>
  (await sql<{ sha256: string }>`select c.sha256 from evidence e join evidence_content c on c.id = e.current_content_id where e.id = ${id}`.execute(api.db)).rows[0]?.sha256 ?? null;
const auditCount = async () => Number((await sql<{ n: string }>`select count(*) n from audit_event`.execute(api.db)).rows[0]!.n);

// ------------------------------------------------------------------- P1 octet op: parameter spellings (inject + llhttp)
describe("P1 uploadEvidenceContent: every accepted spelling reaches the octet parser; every refusal names octet-stream", () => {
  it("accepted -> 200 and stored byte-exact (raw sha256); refused -> 400 validation.content_type naming octet-stream; never 500", async () => {
    const variants: Array<[string, string]> = [
      ["quoted-semicolon", 'application/octet-stream; x="a;b"'],
      ["quoted-escaped-quote", 'application/octet-stream; x="a\\"b"; y=2'],
      ["quoted-space-then-json", 'application/octet-stream; x=" application/json"'],
      ["tab-both-sides", "application/octet-stream\t;\tx=1\t;\ty=2"],
      ["leading-trailing-ows", " \tapplication/octet-stream ; x=1 \t"],
      ["many-empty-params", "application/octet-stream;;; ;\t;"],
      ["upper-name-quoted-empty", 'APPLICATION/OCTET-STREAM; X=""'],
      ["ows-around-equals", "application/octet-stream; x = 1"],
      ["empty-value", "application/octet-stream; x="],
      ["no-equals", "application/octet-stream; x"],
      ["unterminated-quote", 'application/octet-stream; x="a'],
      ["trailing-backslash", 'application/octet-stream; x="a\\'],
      ["space-in-essence", "application/ octet-stream"],
      ["space-in-essence-2", "application /octet-stream"],
      ["json-on-octet-op", "application/json"],
      ["json-param-on-octet-op", "application/json; x=application/octet-stream"],
      ["comma-list-in-param", "application/octet-stream; x=1, text/plain"],
      ["parens-comment", "application/octet-stream (comment)"],
      ["nul-in-param", "application/octet-stream; x=a\u0000b"],
    ];
    const out: Array<Record<string, unknown>> = [];
    const before = errorLogs();
    for (const [name, ct] of variants) {
      for (const framing of ["cl", "chunked"] as const) {
        const f = await newFile(`Synthetic P1 ${name}`);
        let r: Awaited<ReturnType<typeof send>> | { status: number; code?: string; detail?: string; declared: boolean; why?: string; injectError: string };
        try {
          r = await send("POST", `${T}/evidence/${f.id}/content`, { ...authHeaders(), ...ifm(f.version), "content-type": ct, "x-file-name": "p1.bin" }, BYTES, framing);
        } catch (e) {
          r = { status: -1, declared: true, injectError: String(e).slice(0, 120) };
        }
        out.push({ name, ct, framing, status: r.status, code: r.code, detail: r.detail, declared: r.declared, why: r.why || undefined, injectError: "injectError" in r ? r.injectError : undefined, stored: await storedOf(f.id) });
      }
    }
    log("P1", { sentSha: sha(BYTES), out, errorLogsAdded: errorLogs() - before });
    for (const o of out) {
      if (o.status === -1) continue; // light-my-request refused to send the header (not reachable over HTTP)
      expect(o.status as number, o.name as string).toBeLessThan(500);
      expect(o.declared, o.name as string).toBe(true);
      if (o.status === 200) expect([o.name, o.stored]).toEqual([o.name, sha(BYTES)]);
      else expect([o.name, o.status, o.code, o.detail, o.stored]).toEqual([o.name, 400, "validation.content_type", OCTET_DETAIL, null]);
    }
    for (const n of ["quoted-semicolon", "quoted-escaped-quote", "quoted-space-then-json", "tab-both-sides", "leading-trailing-ows", "many-empty-params", "upper-name-quoted-empty"])
      for (const o of out.filter((x) => x.name === n)) expect([n, o.status]).toEqual([n, 200]);
    expect(errorLogs() - before).toBe(0);
  });

  it("over llhttp: obs-text (latin1 0x80-0xFF) inside a quoted parameter, and a bare obs-text token, never 500; accepted => byte-exact", async () => {
    const out: Array<Record<string, unknown>> = [];
    for (const [name, ctBytes] of [
      ["obs-text-quoted", Buffer.concat([Buffer.from('application/octet-stream; x="'), Buffer.from([0xe9, 0xff, 0x80]), Buffer.from('"')])],
      ["obs-text-token", Buffer.concat([Buffer.from("application/octet-stream; x="), Buffer.from([0xe9])])],
      ["obs-text-essence", Buffer.concat([Buffer.from("application/octet-stream"), Buffer.from([0xe9])])],
    ] as Array<[string, Buffer]>) {
      const f = await newFile(`Synthetic P1b ${name}`);
      const head = Buffer.concat([
        Buffer.from(
          `POST ${T}/evidence/${f.id}/content HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nCookie: ${p.lead.session.cookie}\r\n` +
            `Origin: ${ORIGIN()}\r\nX-CSRF-Token: ${p.lead.session.csrf}\r\nIf-Match: "${f.version}"\r\nX-File-Name: p1b.bin\r\nContent-Type: `,
        ),
        ctBytes,
        Buffer.from(`\r\nContent-Length: ${BYTES.length}\r\n\r\n`),
      ]);
      const r = await socketExchange([Buffer.concat([head, BYTES])]);
      out.push({ name, statuses: r.statuses, detail: /"message":"([^"]*)"/.exec(r.text)?.[1], stored: await storedOf(f.id) });
    }
    log("P1b", { sentSha: sha(BYTES), out });
    for (const o of out) {
      const st = Number(String((o.statuses as string[])[0]).slice(9));
      expect(st, o.name as string).toBeLessThan(500);
      if (st === 200) expect(o.stored).toBe(sha(BYTES));
      if (st === 400) expect([o.name, o.detail, o.stored]).toEqual([o.name, OCTET_DETAIL, null]);
    }
    expect(out.find((o) => o.name === "obs-text-quoted")).toMatchObject({ statuses: ["HTTP/1.1 200"], stored: sha(BYTES) });
  });
});

// ------------------------------------------------------------------- P2 JSON op: charset and parameter spellings
describe("P2 createEvidence: charset rule (D-070 tightening) and lookup agreement", () => {
  it("UTF-8 in any legitimate spelling is accepted; other charsets / malformed are a 400 naming application/json", async () => {
    const variants: Array<[string, string]> = [
      ["plain", "application/json"],
      ["utf8-upper-nospace", "application/json;charset=UTF-8"], // Spring / Java clients
      ["utf8-quoted-escaped", 'application/json; charset="utf\\-8"'],
      ["utf8-twice", "application/json; charset=utf-8; charset=UTF-8"],
      ["other-param", "application/json; profile=x; charset=utf-8"],
      ["tab-ows", "application/json\t;\tcharset=utf-8"],
      ["utf8-alias", "application/json; charset=utf8"],
      ["latin1", "application/json; charset=iso-8859-1"],
      ["utf16", "application/json; charset=utf-16"],
      ["utf8-then-latin1", "application/json; charset=utf-8; charset=latin1"],
      ["charset-empty-quoted", 'application/json; charset=""'],
      ["ows-around-equals", "application/json; charset = utf-8"],
    ];
    const out: Array<Record<string, unknown>> = [];
    const before = errorLogs();
    for (const [name, ct] of variants) {
      const title = `Synthetic P2 ${name}`;
      const body = Buffer.from(JSON.stringify({ ownerUserId: p.lead.id, kind: "note", title, noteBody: "Synthetic é" }));
      const r = await send("POST", `${T}/evidence`, { ...authHeaders(), "content-type": ct }, body, "cl");
      const rows = (await sql<{ note_body: string | null }>`select note_body from evidence where title = ${title}`.execute(api.db)).rows;
      out.push({ name, ct, status: r.status, code: r.code, detail: r.detail, declared: r.declared, created: rows.length, verbatim: rows[0]?.note_body === "Synthetic é" });
    }
    log("P2", { out, errorLogsAdded: errorLogs() - before });
    for (const o of out) {
      expect(o.status as number, o.name as string).toBeLessThan(500);
      expect(o.declared, o.name as string).toBe(true);
      if (o.status === 201) expect([o.name, o.created, o.verbatim]).toEqual([o.name, 1, true]);
      else expect([o.name, o.status, o.code, o.detail, o.created]).toEqual([o.name, 400, "validation.content_type", JSON_DETAIL, 0]);
    }
    for (const n of ["plain", "utf8-upper-nospace", "utf8-quoted-escaped", "utf8-twice", "other-param", "tab-ows"])
      expect([n, out.find((o) => o.name === n)?.status]).toEqual([n, 201]);
    expect(errorLogs() - before).toBe(0);
  });

  it("the strict UTF-8 decoder and prototype-poisoning protection still apply behind an accepted parameterised header", async () => {
    const title = "Synthetic P2b";
    const bad = Buffer.concat([Buffer.from(`{"ownerUserId":"${p.lead.id}","kind":"note","title":"${title}","noteBody":"x`), Buffer.from([0xff]), Buffer.from('"}')]);
    const r1 = await send("POST", `${T}/evidence`, { ...authHeaders(), "content-type": "application/json\t; charset=UTF-8" }, bad, "chunked");
    const proto = Buffer.from(`{"ownerUserId":"${p.lead.id}","kind":"note","title":"${title}","__proto__":{"x":1}}`);
    const r2 = await send("POST", `${T}/evidence`, { ...authHeaders(), "content-type": 'application/json; charset="utf-8"' }, proto, "cl");
    const ctor = Buffer.from(`{"ownerUserId":"${p.lead.id}","kind":"note","title":"${title}","constructor":{"prototype":{"x":1}}}`);
    const r3 = await send("POST", `${T}/evidence`, { ...authHeaders(), "content-type": "APPLICATION/JSON ; x=1" }, ctor, "cl");
    const n = Number((await sql<{ n: string }>`select count(*) n from evidence where title = ${title}`.execute(api.db)).rows[0]!.n);
    log("P2b", { invalidUtf8: [r1.status, r1.code], proto: [r2.status, r2.code], ctor: [r3.status, r3.code], created: n });
    expect([r1.status, r1.code]).toEqual([400, "validation.json"]);
    expect(r2.status).toBe(400);
    expect(r3.status).toBe(400);
    expect(n).toBe(0);
  });

  it("over-size JSON behind a parameterised header still hits bodyLimit (declared 400 validation.body_too_large), never parsed", async () => {
    const big = Buffer.from(JSON.stringify({ ownerUserId: p.lead.id, kind: "note", title: "Synthetic P2c", noteBody: "x".repeat(3 * 1024 * 1024) }));
    const r = await send("POST", `${T}/evidence`, { ...authHeaders(), "content-type": "application/json\t;charset=utf-8" }, big, "chunked");
    log("P2c", { status: r.status, code: r.code, declared: r.declared, bytes: big.length });
    expect([r.status, r.declared]).toEqual([400, true]);
    expect(["validation.body_too_large", "validation.json"]).toContain(r.code);
  });
});

// ------------------------------------------------------------------- P3 CSRF / authz / rate limit unchanged behind accepted spellings
describe("P3 CSRF, authorization and rate limiting are not bypassed by an accepted non-canonical spelling", () => {
  it("no CSRF token -> 403; foreign Origin -> 403; no session -> 401; AUD -> 403; nothing created or stored", async () => {
    const f = await newFile("Synthetic P3 file");
    const title = "Synthetic P3";
    const body = Buffer.from(JSON.stringify({ ownerUserId: p.lead.id, kind: "note", title, noteBody: "Synthetic" }));
    const ct = "application/json\t;\tcharset=utf-8";
    const noCsrf = await send("POST", `${T}/evidence`, { cookie: p.lead.session.cookie, origin: ORIGIN(), "content-type": ct }, body, "cl");
    const badOrigin = await send("POST", `${T}/evidence`, { ...authHeaders(), origin: "https://evil.example", "content-type": ct }, body, "cl");
    const noSession = await send("POST", `${T}/evidence`, { origin: ORIGIN(), "content-type": ct }, body, "cl");
    const octNoCsrf = await send("POST", `${T}/evidence/${f.id}/content`, { cookie: p.lead.session.cookie, origin: ORIGIN(), ...ifm(f.version), "content-type": "application/octet-stream\t; x=1", "x-file-name": "p3.bin" }, BYTES, "chunked");
    const created = Number((await sql<{ n: string }>`select count(*) n from evidence where title = ${title}`.execute(api.db)).rows[0]!.n);
    const out = {
      noCsrf: [noCsrf.status, noCsrf.code, noCsrf.declared],
      badOrigin: [badOrigin.status, badOrigin.code, badOrigin.declared],
      noSession: [noSession.status, noSession.code, noSession.declared],
      octNoCsrf: [octNoCsrf.status, octNoCsrf.code, octNoCsrf.declared],
      created,
      stored: await storedOf(f.id),
    };
    log("P3", out);
    expect(noCsrf.status).toBe(403);
    expect(badOrigin.status).toBe(403);
    expect(noSession.status).toBe(401);
    expect(octNoCsrf.status).toBe(403);
    expect(created).toBe(0);
    expect(out.stored).toBeNull();
  });

  it("rate limiting (onRequest) still precedes the media-type refusal (charset tightening included)", async () => {
    const small = await startApi({ env: { RATE_LIMIT_PER_MINUTE: "3" } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const raw = await small.app.inject({ method: "POST", url: `/api/v1/transformations/${crypto.randomUUID()}/evidence`, headers: { "content-type": "application/json; charset=latin1", origin: ORIGIN() }, payload: "{}" });
        statuses.push(raw.statusCode);
      }
      log("P3b", { statuses });
      expect(statuses).toEqual([400, 400, 400, 429, 429]);
    } finally {
      await small.close();
    }
  });

  it("OBSERVATION (pre-existing, not BE15): unmatched-route 404s are not metered by @fastify/rate-limit (no route -> no onRoute hook)", async () => {
    const small = await startApi({ env: { RATE_LIMIT_PER_MINUTE: "3" } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const raw = await small.app.inject({ method: "POST", url: "/api/v1/nope", headers: { "content-type": "application/octet-stream", origin: ORIGIN() }, payload: "x" });
        statuses.push(raw.statusCode);
      }
      const after = await small.app.inject({ method: "POST", url: `/api/v1/transformations/${crypto.randomUUID()}/evidence`, headers: { "content-type": "text/plain", origin: ORIGIN() }, payload: "x" });
      log("P3c", { unmatched: statuses, firstMeteredAfter: after.statusCode });
      expect(statuses).toEqual([404, 404, 404, 404, 404, 404]);
    } finally {
      await small.close();
    }
  });
});

// ------------------------------------------------------------------- P4 unmatched routes: framing / size / smuggling
describe("P4 an unmatched route answers 404 for every Content-Type spelling and framing, and never reads the body", () => {
  it("inject: malformed / duplicate-like / undeclared / no-CT bodies on unmatched URLs and methods -> 404 not_found + Connection: close", async () => {
    const out: Array<Record<string, unknown>> = [];
    const before = errorLogs();
    for (const [method, url] of [
      ["POST", "/api/v1/nope"],
      ["PATCH", `${T}/evidence`],
      ["POST", "/api/v1/auth/logout/extra"],
      ["PUT", "/"],
    ] as Array<[string, string]>) {
      for (const ct of ["application/octet-stream\t; x=1", 'application/json; x="', "*/*", "application/json; charset=latin1", "multipart/form-data; boundary=x", "application/x-www-form-urlencoded", null]) {
        const h: Record<string, string> = { ...authHeaders() };
        if (ct !== null) h["content-type"] = ct;
        const raw = await api.app.inject({ method: method as "POST", url, headers: h, payload: Buffer.from('{"a":1}') });
        let code: string | undefined;
        try { code = (raw.json() as { code?: string }).code; } catch { /* */ }
        out.push({ method, url: url.replace(p.transformationId, "{tid}"), ct, status: raw.statusCode, code, connection: raw.headers.connection });
      }
    }
    log("P4a", { out, errorLogsAdded: errorLogs() - before });
    for (const o of out) expect([o.method, o.url, o.ct, o.status, o.code, o.connection]).toEqual([o.method, o.url, o.ct, 404, "not_found", "close"]);
    expect(errorLogs() - before).toBe(0);
  });

  it("llhttp: a Content-Length far above bodyLimit and the evidence limit on an unmatched route -> prompt 404, never 413/400, socket closed", async () => {
    const out: Array<Record<string, unknown>> = [];
    for (const [name, head] of [
      ["huge-cl-octet", `POST /api/v1/nope HTTP/1.1\r\nHost: x\r\nContent-Type: application/octet-stream\r\nContent-Length: 10000000000\r\n\r\n`],
      ["huge-cl-json", `POST ${T}/evidence/${crypto.randomUUID()}/nope HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 900000000\r\n\r\n`],
      ["expect-100", `POST /api/v1/nope HTTP/1.1\r\nHost: x\r\nContent-Type: application/octet-stream\r\nContent-Length: 900000000\r\nExpect: 100-continue\r\n\r\n`],
      ["chunked-never-ends", `PUT /api/v1/nope HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n`],
    ] as Array<[string, string]>) {
      const r = await socketExchange([Buffer.from(head), Buffer.alloc(64 * 1024, 0x41)], 4000);
      out.push({ name, statuses: r.statuses, closedByServer: r.closedByServer, firstByteMs: r.firstByteMs, conn: /\r\nconnection: ([^\r]*)/i.exec(r.text)?.[1] });
    }
    log("P4b", { out });
    for (const o of out) {
      expect([o.name, (o.statuses as string[]).filter((s) => s !== "HTTP/1.1 100")]).toEqual([o.name, ["HTTP/1.1 404"]]);
      expect([o.name, o.closedByServer]).toEqual([o.name, true]);
      expect(o.firstByteMs as number).toBeLessThan(2000);
    }
  });

  it("llhttp keep-alive smuggling: a request hidden in an unmatched route's body (CL and chunked) is never served", async () => {
    const inner = `POST /api/v1/auth/logout HTTP/1.1\r\nHost: x\r\nCookie: ${p.lead.session.cookie}\r\nOrigin: ${ORIGIN()}\r\nX-CSRF-Token: ${p.lead.session.csrf}\r\nContent-Length: 0\r\n\r\n`;
    const next = `GET /healthz HTTP/1.1\r\nHost: x\r\n\r\n`;
    const out: Array<Record<string, unknown>> = [];
    for (const [name, req] of [
      ["cl-octet", `POST /api/v1/nope HTTP/1.1\r\nHost: x\r\nContent-Type: application/octet-stream\r\nContent-Length: ${Buffer.byteLength(inner)}\r\n\r\n${inner}${next}`],
      ["cl-no-ct", `DELETE /api/v1/nope HTTP/1.1\r\nHost: x\r\nContent-Length: ${Buffer.byteLength(inner)}\r\n\r\n${inner}${next}`],
      ["chunked-json", `PATCH /api/v1/nope HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n${Buffer.byteLength(inner).toString(16)}\r\n${inner}\r\n0\r\n\r\n${next}`],
      ["dup-ct", `POST /api/v1/nope HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Type: application/octet-stream\r\nContent-Length: ${Buffer.byteLength(inner)}\r\n\r\n${inner}${next}`],
    ] as Array<[string, string]>) {
      const r = await socketExchange([Buffer.from(req)], 3000);
      out.push({ name, statuses: r.statuses, closedByServer: r.closedByServer });
    }
    // Still signed in? (the hidden logout must never have run)
    const me = await call(api.app, "GET", "/api/v1/me", { session: p.lead.session });
    log("P4c", { out, meStatusAfter: me.status });
    for (const o of out) expect([o.name, o.statuses, o.closedByServer]).toEqual([o.name, ["HTTP/1.1 404"], true]);
    expect(me.status).toBe(200);
  });

  it("llhttp: a matched route refusal (two Content-Type lines; malformed) closes the connection; the pipelined next request is not served from the body", async () => {
    const f = await newFile("Synthetic P4d");
    const inner = `GET /healthz HTTP/1.1\r\nHost: x\r\n\r\n`;
    const base = `POST ${T}/evidence/${f.id}/content HTTP/1.1\r\nHost: x\r\nCookie: ${p.lead.session.cookie}\r\nOrigin: ${ORIGIN()}\r\nX-CSRF-Token: ${p.lead.session.csrf}\r\nIf-Match: "${f.version}"\r\nX-File-Name: p4d.bin\r\n`;
    const out: Array<Record<string, unknown>> = [];
    for (const [name, cts] of [
      ["dup-same", ["application/octet-stream", "application/octet-stream"]],
      ["malformed", ['application/octet-stream; x="']],
    ] as Array<[string, string[]]>) {
      const req = base + cts.map((c) => `Content-Type: ${c}\r\n`).join("") + `Content-Length: ${Buffer.byteLength(inner)}\r\n\r\n${inner}`;
      const r = await socketExchange([Buffer.from(req)], 3000);
      out.push({ name, statuses: r.statuses, closedByServer: r.closedByServer, detail: /"message":"([^"]*)"/.exec(r.text)?.[1] });
    }
    log("P4d", { out, stored: await storedOf(f.id) });
    for (const o of out) expect([o.name, o.statuses, o.closedByServer, o.detail]).toEqual([o.name, ["HTTP/1.1 400"], true, OCTET_DETAIL]);
    expect(await storedOf(f.id)).toBeNull();
  });
});

// ------------------------------------------------------------------- P5 evidence streaming limit / raw sha256 unchanged
let injectArtifactErrors = 0;
describe("P5 the evidence upload's streaming size limit and raw-byte sha256 are unchanged behind a non-canonical spelling", () => {
  it("over-limit upload with 'application/octet-stream\\t; x=1' (Content-Length, inject) -> 413 evidence.too_large, nothing stored; a 1 MiB binary stored with its raw sha256", async () => {
    const f = await newFile("Synthetic P5 big");
    const huge = Buffer.alloc(25 * 1024 * 1024 + 1, 0xfe);
    const r = await send("POST", `${T}/evidence/${f.id}/content`, { ...authHeaders(), ...ifm(f.version), "content-type": "application/octet-stream\t; x=1", "x-file-name": "p5.bin" }, huge, "cl");
    const g = await newFile("Synthetic P5 ok");
    const mib = Buffer.from(Array.from({ length: 1024 * 1024 }, (_, i) => (i * 131 + 7) & 0xff));
    const ok = await send("POST", `${T}/evidence/${g.id}/content`, { ...authHeaders(), ...ifm(g.version), "content-type": ' application/octet-stream ; name="p5 ok"', "x-file-name": "p5ok.bin" }, mib, "cl");
    const dl = await api.app.inject({ method: "GET", url: `${T}/evidence/${g.id}/content`, headers: { cookie: p.lead.session.cookie } });
    log("P5", { big: [r.status, r.code, r.declared], bigStored: await storedOf(f.id), ok: [ok.status, ok.declared], okStored: await storedOf(g.id), sent: sha(mib), dlSha: sha(dl.rawPayload) });
    expect([r.status, r.code]).toEqual([413, "evidence.too_large"]);
    expect(await storedOf(f.id)).toBeNull();
    expect(ok.status).toBe(200);
    expect(await storedOf(g.id)).toBe(sha(mib));
    expect(sha(dl.rawPayload)).toBe(sha(mib));
  });

  it("over llhttp: a 30 MiB CHUNKED upload with an HTAB spelling -> 413 evidence.too_large, nothing stored, no error-level log", async () => {
    const f = await newFile("Synthetic P5 socket");
    const before = errorLogs();
    const head = Buffer.from(
      `POST ${T}/evidence/${f.id}/content HTTP/1.1\r\nHost: x\r\nCookie: ${p.lead.session.cookie}\r\nOrigin: ${ORIGIN()}\r\n` +
        `X-CSRF-Token: ${p.lead.session.csrf}\r\nIf-Match: "${f.version}"\r\nX-File-Name: p5s.bin\r\nContent-Type: application/octet-stream\t; x=1\r\nTransfer-Encoding: chunked\r\n\r\n`,
    );
    const mb = Buffer.alloc(1024 * 1024, 0xfe);
    const chunk = Buffer.concat([Buffer.from("100000\r\n"), mb, Buffer.from("\r\n")]);
    const parts: Array<Buffer | number> = [head];
    for (let i = 0; i < 30; i += 1) parts.push(chunk);
    parts.push(Buffer.from("0\r\n\r\n"));
    const r = await socketExchange(parts, 8000);
    await new Promise((res) => setTimeout(res, 200));
    log("P5s", { statuses: r.statuses, code: /"code":"([a-z_.]+)"/.exec(r.text)?.[1], closedByServer: r.closedByServer, stored: await storedOf(f.id), errorLogsAdded: errorLogs() - before });
    expect(r.statuses).toEqual(["HTTP/1.1 413"]);
    expect(/"code":"([a-z_.]+)"/.exec(r.text)?.[1]).toBe("evidence.too_large");
    expect(await storedOf(f.id)).toBeNull();
    expect(errorLogs() - before).toBe(0);
  });

  it("OBSERVATION (test-transport artifact, compare the r9 baseline): inject + a CHUNKED over-limit stream rejects the inject promise with AbortError", async () => {
    const f = await newFile("Synthetic P5 inject chunked");
    const before = errorLogs();
    let outcome: unknown;
    try {
      const r = await send("POST", `${T}/evidence/${f.id}/content`, { ...authHeaders(), ...ifm(f.version), "content-type": "application/octet-stream", "x-file-name": "p5c.bin" }, Buffer.alloc(30 * 1024 * 1024, 0xfe), "chunked");
      outcome = [r.status, r.code];
    } catch (e) {
      outcome = String((e as Error).name);
    }
    await new Promise((res) => setTimeout(res, 200));
    injectArtifactErrors = errorLogs() - before;
    log("P5c", { outcome, stored: await storedOf(f.id), errorLogsAdded: injectArtifactErrors });
    expect(await storedOf(f.id)).toBeNull();
  });
});

// ------------------------------------------------------------------- P6 pure decision vs Fastify lookup, exhaustively
describe("P6 the pure decision and Fastify's getParser agree on every accepted spelling (fuzz)", () => {
  it("for 20k random Content-Type strings over a hostile alphabet: accept => the canonical form maps to the declared parser; never throws", () => {
    const alphabet = ["application/octet-stream", "application/json", ";", " ", "\t", "=", '"', "\\", "x", "charset", "utf-8", "UTF-8", ",", "/", "*", "é", "a", "1", "(", ")", ""];
    let seed = 12345;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    // getParser of the live app context: the parser list Fastify uses for these routes.
    const counts = { accepted: 0, refused: 0, mismatches: [] as string[] };
    const known = new Map<string, string>([["application/json", "json"], ["application/octet-stream", "octet"]]);
    const lookup = (ct: string): string | null => {
      const lc = ct.toLowerCase();
      for (const k of known.keys()) if (lc.slice(0, k.length) === k && (lc.length === k.length || lc.charCodeAt(k.length) === 59 || lc.charCodeAt(k.length) === 32)) return k;
      return null;
    };
    for (let i = 0; i < 20000; i += 1) {
      const parts = Array.from({ length: 1 + rnd(8) }, () => alphabet[rnd(alphabet.length)]!);
      const ct = parts.join("");
      for (const consumes of [["application/json"], ["application/octet-stream"]]) {
        const req = { method: "POST", headers: { "content-type": ct }, is404: false, routeOptions: { config: { consumes } }, raw: { rawHeaders: ["Content-Type", ct] } };
        const d = decideMediaType(req as never);
        if (d.kind === "accept") {
          counts.accepted += 1;
          const parsed = parseContentType(ct)!;
          if (lookup(d.contentType) !== parsed.essence || !consumes.includes(parsed.essence)) counts.mismatches.push(JSON.stringify([ct, d.contentType]));
        } else if (d.kind === "refuse") {
          counts.refused += 1;
          const msg = d.problem.toBody("x").errors?.[0]?.message;
          if (msg !== `Send the request body as ${consumes[0]}.`) counts.mismatches.push(JSON.stringify(["msg", ct, msg]));
        }
      }
    }
    log("P6", { accepted: counts.accepted, refused: counts.refused, mismatches: counts.mismatches.slice(0, 20), mismatchCount: counts.mismatches.length });
    expect(counts.mismatches).toEqual([]);
    expect(counts.accepted).toBeGreaterThan(0);
  });

  it("the FST_ERR_CTP_INVALID_MEDIA_TYPE backstop names the route's set; a request with no route config falls back to JSON without throwing", () => {
    const e = Object.assign(new Error("x"), { code: "FST_ERR_CTP_INVALID_MEDIA_TYPE", statusCode: 415 }) as never;
    const octet = frameworkProblem(e, { routeOptions: { config: { consumes: ["application/octet-stream"] } } }).toBody("r");
    const none = frameworkProblem(e, { routeOptions: { config: undefined } }).toBody("r");
    log("P6b", { octet: octet.errors, none: none.errors });
    expect(octet.errors?.[0]?.message).toBe(OCTET_DETAIL);
    expect(none.errors?.[0]?.message).toBe(JSON_DETAIL);
  });
});

// ------------------------------------------------------------------- P7 sweep
describe("P7 no U+FFFD in stored evidence names / audit changes; no error-level log over the whole file (except the P5c transport artifact)", () => {
  it("0 / 0 / 0", async () => {
    const a = (await sql<{ n: string }>`select count(*) n from audit_event where changes::text like ${"%�%"}`.execute(api.db)).rows[0]!.n;
    const e = (await sql<{ n: string }>`select count(*) n from evidence_content where file_name like ${"%�%"}`.execute(api.db)).rows[0]!.n;
    log("P7", { audit: a, evidenceContent: e, auditTotal: await auditCount(), errorLogsTotal: errorLogs(), errorLines: logLines.filter((l) => l.level >= 50 || l.msg === "unhandled error") });
    // The P5c inject-transport artifact (if any) is excluded and reported separately.
    expect([Number(a), Number(e), errorLogs() - injectArtifactErrors]).toEqual([0, 0, 0]);
  });
});
