// code-security-reviewer DG2 round-9 adversarial probe (T-DG2-REV-SEC-R9). NOT part of the candidate: copied into a
// disposable clone (041478cb = source 7854770e + delivery metadata) at apps/api/test/integration/ and run on a
// disposable PostgreSQL 16. All data SYNTHETIC. Each assertion states the secure/declared expectation (a failing test
// shows a defect); every observation is also logged as "PROBE <key>: <json>".
// Scope: F-DG2-320 (BE14) - any remaining path where a request body is accepted in an undeclared media type, silently
// rewritten, or answered with an undeclared status or a 500.
import { createHash } from "node:crypto";
import { connect, type AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertContract } from "../support/contract.ts";
import { call, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

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

/** Raw socket request; returns the status and the response text (the server may close the connection). */
function rawSocket(request: Buffer): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const s = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    s.on("data", (c) => chunks.push(c));
    s.on("error", reject);
    s.on("close", () => {
      const text = Buffer.concat(chunks).toString("latin1");
      resolve({ status: Number(/^HTTP\/1\.1 (\d{3})/.exec(text)?.[1] ?? 0), text });
    });
    s.write(request);
    setTimeout(() => s.destroy(), 5000);
  });
}

async function newFile(title: string) {
  const c = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { ownerUserId: p.lead.id, kind: "file", title } });
  expect(c.status).toBe(201);
  return { id: c.body.id as string, version: c.body.version as number };
}
const storedOf = async (id: string) =>
  (await sql<{ sha256: string }>`select c.sha256 from evidence e join evidence_content c on c.id = e.current_content_id where e.id = ${id}`.execute(api.db)).rows[0]?.sha256 ?? null;

// ---------------------------------------------------------------------------------- S1 upload: Content-Type variants
describe("S1 uploadEvidenceContent: Content-Type case / parameter / whitespace / list variants", () => {
  it("accepted only as octet-stream and stored byte-exact; everything else a declared 400; never 500", async () => {
    const variants: Array<[string, string]> = [
      ["upper", "APPLICATION/OCTET-STREAM"],
      ["mixed-param", "Application/Octet-Stream; Charset=UTF-8"],
      ["space-before-semicolon", "application/octet-stream ; x=1"],
      ["tab-before-semicolon", "application/octet-stream\t; x=1"],
      ["trailing-semicolon", "application/octet-stream;"],
      ["garbage-params", "application/octet-stream;;;="],
      ["suffix", "application/octet-streamx"],
      ["list", "application/octet-stream, application/json"],
      ["list-rev", "text/plain, application/octet-stream"],
      ["wild", "*/*"],
      ["app-wild", "application/*"],
      ["empty", ""],
      ["param-smuggle", "text/plain; x=application/octet-stream"],
      ["json-suffix", "application/octet-stream+json"],
      ["problem-json", "application/problem+json"],
    ];
    const out: Array<Record<string, unknown>> = [];
    const before = errorLogs();
    for (const [name, ct] of variants) {
      for (const framing of ["cl", "chunked"] as const) {
        const f = await newFile(`Synthetic S1 ${name}`);
        const r = await send("POST", `${T}/evidence/${f.id}/content`, { ...authHeaders(), ...ifm(f.version), "content-type": ct, "x-file-name": "s1.bin" }, BYTES, framing);
        out.push({ name, ct, framing, status: r.status, code: r.code, detail: r.detail, declared: r.declared, why: r.why || undefined, stored: await storedOf(f.id) });
      }
    }
    log("S1", { sentSha: sha(BYTES), out, errorLogsAdded: errorLogs() - before });
    for (const o of out) {
      expect(o.status as number, o.name as string).toBeLessThan(500);
      expect(o.declared, o.name as string).toBe(true);
      if (o.stored !== null) expect([o.name, o.stored]).toEqual([o.name, sha(BYTES)]);
      if (o.status === 200) expect(o.stored, o.name as string).toBe(sha(BYTES));
    }
    expect(errorLogs() - before).toBe(0);
  });
});

// ---------------------------------------------------------------------------------- S2 JSON op: Content-Type variants
describe("S2 createEvidence (JSON only): Content-Type variants", () => {
  it("only application/json (any case/params) is parsed; +json / text/json / lists are a declared 400", async () => {
    const variants: Array<[string, string]> = [
      ["upper-params", "APPLICATION/JSON; CHARSET=UTF-8"],
      ["quoted-charset", 'application/json; charset="utf-8"'],
      ["tab-before-semicolon", "application/json\t; charset=utf-8"],
      ["space-before-semicolon", "application/json ; charset=utf-8"],
      ["trailing-space-garbage", "application/json x"],
      ["problem-json", "application/problem+json"],
      ["json-seq", "application/json-seq"],
      ["jsonp", "application/jsonp"],
      ["text-json", "text/json"],
      ["x-json", "application/x-json"],
      ["list", "application/json, text/plain"],
      ["empty", ""],
      ["octet-param-smuggle", "application/octet-stream; x=application/json"],
    ];
    const out: Array<Record<string, unknown>> = [];
    const before = errorLogs();
    for (const [name, ct] of variants) {
      const title = `Synthetic S2 ${name}`;
      const body = Buffer.from(JSON.stringify({ ownerUserId: p.lead.id, kind: "note", title, noteBody: "Synthetic" }));
      const r = await send("POST", `${T}/evidence`, { ...authHeaders(), "content-type": ct }, body, "cl");
      const n = Number((await sql<{ n: string }>`select count(*) n from evidence where title = ${title}`.execute(api.db)).rows[0]!.n);
      out.push({ name, ct, status: r.status, code: r.code, detail: r.detail, declared: r.declared, created: n });
    }
    log("S2", { out, errorLogsAdded: errorLogs() - before });
    for (const o of out) {
      expect(o.status as number, o.name as string).toBeLessThan(500);
      expect(o.declared, o.name as string).toBe(true);
      expect([o.name, o.status === 201 ? 1 : 0]).toEqual([o.name, o.created]);
    }
    for (const n of ["problem-json", "json-seq", "jsonp", "text-json", "x-json", "list", "empty", "octet-param-smuggle"])
      expect(out.find((o) => o.name === n), n).toMatchObject({ status: 400, code: "validation.content_type", created: 0 });
    expect(errorLogs() - before).toBe(0);
  });
});

// ---------------------------------------------------------------------------------- S3 duplicate Content-Type (socket)
describe("S3 duplicate Content-Type headers on a real socket", () => {
  it("the media type checked is the one the parser uses; text/plain + octet in either order never stores rewritten bytes", async () => {
    const out: Array<Record<string, unknown>> = [];
    for (const [name, cts] of [
      ["text-then-octet", ["text/plain", "application/octet-stream"]],
      ["octet-then-text", ["application/octet-stream", "text/plain"]],
      ["json-then-octet", ["application/json", "application/octet-stream"]],
    ] as Array<[string, string[]]>) {
      const f = await newFile(`Synthetic S3 ${name}`);
      const head =
        `POST ${T}/evidence/${f.id}/content HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n` +
        `Cookie: ${p.lead.session.cookie}\r\nOrigin: ${ORIGIN()}\r\nX-CSRF-Token: ${p.lead.session.csrf}\r\n` +
        `If-Match: "${f.version}"\r\nX-File-Name: s3.bin\r\n` +
        cts.map((c) => `Content-Type: ${c}\r\n`).join("") +
        `Transfer-Encoding: chunked\r\n\r\n`;
      const chunk = Buffer.concat([Buffer.from(`${BYTES.length.toString(16)}\r\n`), BYTES, Buffer.from("\r\n0\r\n\r\n")]);
      const r = await rawSocket(Buffer.concat([Buffer.from(head), chunk]));
      out.push({ name, status: r.status, code: /"code":"(validation\.[a-z_]+)"/.exec(r.text)?.[1], stored: await storedOf(f.id) });
    }
    log("S3", { sentSha: sha(BYTES), out });
    for (const o of out) {
      expect(o.status as number, o.name as string).toBeLessThan(500);
      if (o.stored !== null) expect(o.stored).toBe(sha(BYTES));
    }
    expect(out.find((o) => o.name === "text-then-octet")).toMatchObject({ status: 400, stored: null });
    expect(out.find((o) => o.name === "json-then-octet")).toMatchObject({ status: 400, stored: null });
  });
});

// ---------------------------------------------------------------------------------- S4 absent Content-Type / bodiless POSTs
describe("S4 absent Content-Type with a body; the two bodiless POST operations", () => {
  it("JSON op with no Content-Type and a body (both framings) -> 400; logout/activate keep declared statuses", async () => {
    const before = errorLogs();
    const title = "Synthetic S4 none";
    const body = Buffer.from(JSON.stringify({ ownerUserId: p.lead.id, kind: "note", title, noteBody: "Synthetic" }));
    const noneCl = await send("POST", `${T}/evidence`, authHeaders(), body, "cl");
    const noneCh = await send("POST", `${T}/evidence`, authHeaders(), body, "chunked");
    const created = Number((await sql<{ n: string }>`select count(*) n from evidence where title = ${title}`.execute(api.db)).rows[0]!.n);
    const kpi = `${T}/kpi-definitions/${crypto.randomUUID()}/activate`;
    const activateText = await send("POST", kpi, { ...authHeaders(), ...ifm(1), "content-type": "text/plain" }, Buffer.from("x"), "cl");
    const activateJson = await send("POST", kpi, { ...authHeaders(), ...ifm(1), "content-type": "application/json" }, Buffer.from('{"status":"active"}'), "cl");
    const activateNone = await send("POST", kpi, { ...authHeaders(), ...ifm(1) }, null, "cl");
    const activateTextEmpty = await send("POST", kpi, { ...authHeaders(), ...ifm(1), "content-type": "text/plain", "content-length": "0" }, null, "cl");
    const lo = async (h: Record<string, string>, b: Buffer | null) => {
      const s = await (await import("../support/harness.ts")).signIn(api.app, w.office.subject);
      return send("POST", "/api/v1/auth/logout", { ...authHeaders(s), ...h }, b, "cl");
    };
    const logoutNone = await lo({}, null);
    const logoutText = await lo({ "content-type": "text/plain" }, Buffer.from("x"));
    const logoutTextEmpty = await lo({ "content-type": "text/plain", "content-length": "0" }, null);
    const logoutJsonEmpty = await lo({ "content-type": "application/json", "content-length": "0" }, null);
    const r = (x: Awaited<ReturnType<typeof send>>) => ({ status: x.status, code: x.code, declared: x.declared, why: x.why || undefined });
    const out = {
      noneCl: r(noneCl), noneCh: r(noneCh), created,
      activateText: r(activateText), activateJson: r(activateJson), activateNone: r(activateNone), activateTextEmpty: r(activateTextEmpty),
      logoutNone: r(logoutNone), logoutText: r(logoutText), logoutTextEmpty: r(logoutTextEmpty), logoutJsonEmpty: r(logoutJsonEmpty),
    };
    log("S4", { ...out, errorLogsAdded: errorLogs() - before });
    expect(out.noneCl).toMatchObject({ status: 400, code: "validation.content_type", declared: true });
    expect(out.noneCh).toMatchObject({ status: 400, code: "validation.content_type", declared: true });
    expect(created).toBe(0);
    for (const [k, v] of Object.entries(out)) if (typeof v === "object") {
      expect(v.status, k).toBeLessThan(500);
      expect(v.declared, k).toBe(true);
    }
    expect(errorLogs() - before).toBe(0);
  });
});

// ---------------------------------------------------------------------------------- S5 DELETE / OPTIONS / PUT with a body
describe("S5 methods without a declared operation, carrying a body", () => {
  it("DELETE/OPTIONS/PUT with undeclared media types on existing paths -> 404 (not 400, not 500), nothing stored", async () => {
    const f = await newFile("Synthetic S5");
    const out: Array<Record<string, unknown>> = [];
    const before = errorLogs();
    for (const method of ["DELETE", "OPTIONS", "PUT"]) {
      for (const ct of ["text/plain", "application/json", "application/octet-stream", null]) {
        const h: Record<string, string> = { ...authHeaders(), ...ifm(f.version), "x-file-name": "s5.bin" };
        if (ct !== null) h["content-type"] = ct;
        const raw = await api.app.inject({ method: method as "DELETE", url: `${T}/evidence/${f.id}/content`, headers: h, payload: ct === "application/json" ? Buffer.from("{}") : BYTES });
        out.push({ method, ct, status: raw.statusCode, ctOut: raw.headers["content-type"] });
      }
    }
    // OPTIONS with a Content-Type but no body (Fastify 4 skipped parsing for this; 5.6.1 has no such exception).
    const opt = await api.app.inject({ method: "OPTIONS", url: `${T}/evidence`, headers: { "content-type": "text/plain" } });
    out.push({ method: "OPTIONS-nobody", ct: "text/plain", status: opt.statusCode });
    log("S5", { out, stored: await storedOf(f.id), errorLogsAdded: errorLogs() - before });
    for (const o of out) expect(o.status as number, JSON.stringify(o)).toBeLessThan(500);
    expect(await storedOf(f.id)).toBeNull();
    expect(errorLogs() - before).toBe(0);
  });
});

// ---------------------------------------------------------------------------------- S6 GET/HEAD with a body (D-069 a)
describe("S6 GET/HEAD with a body and an undeclared Content-Type (D-069 design choice a)", () => {
  it("the body is never read or acted upon; the response is the normal declared one", async () => {
    const out: Array<Record<string, unknown>> = [];
    for (const method of ["GET", "HEAD"]) {
      for (const framing of ["cl", "chunked"] as const) {
        const r = await send(method, `${T}/evidence`, { cookie: p.lead.session.cookie, "content-type": "text/plain" }, Buffer.from('{"q":"x"}'), framing);
        out.push({ method, framing, status: r.status, declared: r.declared });
      }
    }
    // Real socket, GET with a chunked body, keep-alive: the unread body must not be parsed as a second request.
    const inner = "POST /api/v1/auth/logout HTTP/1.1\r\nHost: x\r\n\r\n";
    const req = `GET ${T}/evidence HTTP/1.1\r\nHost: x\r\nCookie: ${p.lead.session.cookie}\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n` +
      `${Buffer.byteLength(inner).toString(16)}\r\n${inner}\r\n0\r\n\r\n`;
    const s = await rawSocket(Buffer.from(req));
    const responses = (s.text.match(/HTTP\/1\.1 \d{3}/g) ?? []);
    log("S6", { out, socketResponses: responses, socketText: s.text.slice(0, 600) });
    // HEAD is Fastify's automatic sibling of each GET route; the contract lists no HEAD operations, so only the status is checked.
    for (const o of out) expect([o.method, o.status, o.method === "HEAD" ? true : o.declared]).toEqual([o.method, 200, true]);
    expect(responses).toEqual(["HTTP/1.1 200"]);
  });
});

// ---------------------------------------------------------------------------------- S7 rate limiting precedes the refusal
describe("S7 rate limiting still applies to refused media types (onRequest before preParsing)", () => {
  it("with a 3/min limit, the 4th+ text/plain POST is a 429, not a 400", async () => {
    const small = await startApi({ env: { RATE_LIMIT_PER_MINUTE: "3" } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const raw = await small.app.inject({ method: "POST", url: `/api/v1/transformations/${crypto.randomUUID()}/evidence`, headers: { "content-type": "text/plain", origin: ORIGIN() }, payload: "x" });
        statuses.push(raw.statusCode);
      }
      log("S7", { statuses });
      expect(statuses.slice(0, 3)).toEqual([400, 400, 400]);
      expect(statuses.slice(3)).toEqual([429, 429]);
    } finally {
      await small.close();
    }
  });
});

// ---------------------------------------------------------------------------------- S8 round-8 repro on a real socket
describe("S8 the round-8 F-DG2-320 repro on a real socket (chunked text/plain, no session and with a session)", () => {
  it("400 validation.content_type, nothing stored; control octet-stream stores the exact bytes", async () => {
    const out: Array<Record<string, unknown>> = [];
    for (const [name, ct, auth] of [
      ["text-auth", "text/plain", true],
      ["text-noauth", "text/plain", false],
      ["json-auth", "application/json", true],
      ["octet-auth", "application/octet-stream", true],
    ] as Array<[string, string, boolean]>) {
      const f = await newFile(`Synthetic S8 ${name}`);
      const body = ct === "application/json" ? Buffer.from('"Synthetic"') : BYTES;
      const head =
        `POST ${T}/evidence/${f.id}/content HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nOrigin: ${ORIGIN()}\r\n` +
        (auth ? `Cookie: ${p.lead.session.cookie}\r\nX-CSRF-Token: ${p.lead.session.csrf}\r\n` : "") +
        `If-Match: "${f.version}"\r\nX-File-Name: s8.bin\r\nContent-Type: ${ct}\r\nTransfer-Encoding: chunked\r\n\r\n`;
      const chunk = Buffer.concat([Buffer.from(`${body.length.toString(16)}\r\n`), body, Buffer.from("\r\n0\r\n\r\n")]);
      const r = await rawSocket(Buffer.concat([Buffer.from(head), chunk]));
      out.push({ name, status: r.status, code: /"code":"(validation\.[a-z_]+)"/.exec(r.text)?.[1], stored: await storedOf(f.id) });
    }
    log("S8", { sentSha: sha(BYTES), out });
    expect(out.find((o) => o.name === "text-auth")).toMatchObject({ status: 400, code: "validation.content_type", stored: null });
    expect(out.find((o) => o.name === "text-noauth")).toMatchObject({ status: 400, code: "validation.content_type", stored: null });
    expect(out.find((o) => o.name === "json-auth")).toMatchObject({ status: 400, code: "validation.content_type", stored: null });
    expect(out.find((o) => o.name === "octet-auth")).toMatchObject({ status: 200, stored: sha(BYTES) });
  });
});

// ---------------------------------------------------------------------------------- S9 U+FFFD sweep
describe("S9 no U+FFFD anywhere in stored evidence names / audit changes after all probes", () => {
  it("0 rows", async () => {
    const a = (await sql<{ n: string }>`select count(*) n from audit_event where changes::text like ${"%�%"}`.execute(api.db)).rows[0]!.n;
    const e = (await sql<{ n: string }>`select count(*) n from evidence_content where file_name like ${"%�%"}`.execute(api.db)).rows[0]!.n;
    log("S9", { audit: a, evidenceContent: e, errorLogsTotal: errorLogs(), errorLines: logLines.filter((l) => l.level >= 50 || l.msg === "unhandled error") });
    expect([Number(a), Number(e), errorLogs()]).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------------- S10 unmatched route + octet-stream
// The candidate's own test ("an unknown route keeps its 404, whatever the media type") only sends text/plain.
describe("S10 an unmatched route answers 404 whatever the media type (incl. application/octet-stream)", () => {
  it("POST/PUT/DELETE to unmatched URLs with application/octet-stream -> 404, like text/plain and JSON", async () => {
    const out: Array<Record<string, unknown>> = [];
    for (const [method, url] of [
      ["POST", "/api/v1/does-not-exist"],
      ["POST", "/does-not-exist"],
      ["PUT", `${T}/evidence`],
      ["DELETE", `${T}/evidence`],
    ] as Array<[string, string]>) {
      for (const ct of ["text/plain", "application/json", "application/octet-stream"]) {
        for (const auth of [false, true]) {
          const raw = await api.app.inject({
            method: method as "POST",
            url,
            headers: { "content-type": ct, ...(auth ? authHeaders() : { origin: ORIGIN() }) },
            payload: ct === "application/json" ? Buffer.from("{}") : BYTES,
          });
          let j: { code?: string; errors?: Array<{ code: string; message: string }> } = {};
          try { j = raw.json(); } catch { /* */ }
          out.push({ method, url: url.replace(p.transformationId, "{tid}"), ct, auth, status: raw.statusCode, code: j.errors?.[0]?.code ?? j.code, detail: j.errors?.[0]?.message });
        }
      }
    }
    log("S10", { out });
    for (const o of out) expect([o.method, o.url, o.ct, o.auth, o.status]).toEqual([o.method, o.url, o.ct, o.auth, 404]);
  });
});

// ---------------------------------------------------------------------------------- S11 refusal detail on the octet op
describe("S11 every refusal on uploadEvidenceContent names the media type the operation declares", () => {
  it("a Content-Type whose essence is octet-stream but which Fastify cannot match (tab before ';') -> detail names octet-stream", async () => {
    const f = await newFile("Synthetic S11");
    const r = await send("POST", `${T}/evidence/${f.id}/content`, { ...authHeaders(), ...ifm(f.version), "content-type": "application/octet-stream\t; x=1", "x-file-name": "s11.bin" }, BYTES, "cl");
    log("S11", { status: r.status, code: r.code, detail: r.detail, declared: r.declared, stored: await storedOf(f.id) });
    expect([r.status, r.code, r.declared]).toEqual([400, "validation.content_type", true]);
    expect(r.detail).toBe("Send the request body as application/octet-stream.");
  });
});
