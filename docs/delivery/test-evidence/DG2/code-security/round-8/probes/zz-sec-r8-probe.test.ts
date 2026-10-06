// code-security-reviewer DG2 round-8 adversarial probe (T-DG2-REV-SEC-R8). NOT part of the candidate: copied into a
// disposable clone (4053630c = source cf3446e4 + delivery metadata) at apps/api/test/integration/ and run on a
// disposable PostgreSQL 16. All data SYNTHETIC. Each assertion states the secure/declared expectation (a failing test
// shows a defect); every observation is also logged as "PROBE <key>: <json>".
// Scope: remaining paths where client bytes could be silently rewritten, or answered with an undeclared status or 500,
// after BE13's strict UTF-8 JSON parser and query-string parser (F-DG2-290).
import { createHash } from "node:crypto";
import { connect, type AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertContract } from "../support/contract.ts";
import { call, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

const logLines: Array<{ level: number; msg: string; reqId?: string; requestId?: string }> = [];
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
const FFFD = "�";
const errorLogs = () => logLines.filter((l) => l.level >= 50).length;

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

/** inject with Content-Length (Buffer) or without (stream, arrives like chunked); returns status/body + contract check. */
async function send(method: string, url: string, headers: Record<string, string>, body: Buffer, framing: "cl" | "chunked") {
  const raw = await api.app.inject({
    method: method as "POST",
    url,
    headers,
    payload: framing === "cl" ? body : Readable.from([body.subarray(0, 3), body.subarray(3)]),
  });
  let declared = true;
  let why = "";
  try {
    assertContract(method, url, { statusCode: raw.statusCode, headers: raw.headers, body: raw.body });
  } catch (e) {
    declared = false;
    why = String((e as Error).message).slice(0, 200);
  }
  let json: { code?: string; errors?: Array<{ pointer: string; code: string }> } = {};
  try {
    json = raw.json();
  } catch {
    /* not JSON */
  }
  return { status: raw.statusCode, code: json.code, errors: json.errors, declared, why, raw };
}

const charterCount = async (tid: string) =>
  Number((await sql<{ n: string }>`select count(*) n from charter where transformation_id = ${tid}`.execute(api.db)).rows[0]!.n);

// ---------------------------------------------------------------------------------- R1 strict decoding matrix
describe("R1 JSON body: every ill-formed UTF-8 class, both framings -> 400 validation.json, nothing stored", () => {
  const CASES: Record<string, number[]> = {
    overlong_C0AF: [0xc0, 0xaf],
    overlong_E080AF: [0xe0, 0x80, 0xaf],
    above_10FFFF_F4908080: [0xf4, 0x90, 0x80, 0x80],
    five_byte_F888808080: [0xf8, 0x88, 0x80, 0x80, 0x80],
    lone_continuation_80: [0x80],
    truncated_E282: [0xe2, 0x82],
    cesu_low_EDB080: [0xed, 0xb0, 0x80],
    latin1_E9: [0xe9],
  };
  it("charter create", async () => {
    const out: unknown[] = [];
    const before = errorLogs();
    for (const [name, bytes] of Object.entries(CASES)) {
      for (const framing of ["cl", "chunked"] as const) {
        const q = await setupP2World(api, w);
        const body = Buffer.concat([Buffer.from('{"transformationName":"Synthetic","outOfScope":"S'), Buffer.from(bytes), Buffer.from('x"}')]);
        const r = await send("POST", `/api/v1/transformations/${q.transformationId}/charter`, { ...authHeaders(q.lead.session), "content-type": "application/json" }, body, framing);
        out.push({ name, framing, status: r.status, code: r.errors?.[0]?.code ?? r.code, pointer: r.errors?.[0]?.pointer, declared: r.declared, stored: await charterCount(q.transformationId) });
      }
    }
    // Truncated sequence at the very END of the body (after the closing brace).
    const q = await setupP2World(api, w);
    const tail = Buffer.concat([Buffer.from('{"transformationName":"Synthetic"}'), Buffer.from([0xe2, 0x82])]);
    for (const framing of ["cl", "chunked"] as const) {
      const r = await send("POST", `/api/v1/transformations/${q.transformationId}/charter`, { ...authHeaders(q.lead.session), "content-type": "application/json" }, tail, framing);
      out.push({ name: "trailing_truncated", framing, status: r.status, code: r.errors?.[0]?.code ?? r.code, declared: r.declared, stored: await charterCount(q.transformationId) });
    }
    log("R1", { out, errorLogsAdded: errorLogs() - before });
    for (const o of out as Array<{ status: number; code: string; declared: boolean; stored: number }>) {
      expect(o, JSON.stringify(o)).toMatchObject({ status: 400, code: "validation.json", declared: true, stored: 0 });
    }
    expect(errorLogs() - before).toBe(0);
  });
});

// ---------------------------------------------------------------------------------- R2 BOM variants
describe("R2 BOM handling", () => {
  it("one BOM ok; two BOMs, BOM+invalid, BOM only, UTF-16 BOMs -> 400 validation.json", async () => {
    const valid = Buffer.from('{"transformationName":"Synthetic BOM"}');
    const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
    const cases: Record<string, Buffer> = {
      one_bom: Buffer.concat([BOM, valid]),
      two_boms: Buffer.concat([BOM, BOM, valid]),
      bom_then_FF: Buffer.concat([BOM, Buffer.from([0xff]), valid]),
      bom_only: BOM,
      utf16le_bom: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"transformationName":"S"}', "utf16le")]),
      utf16be_bom: Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('{"transformationName":"S"}', "utf16le").swap16()]),
      bom_mid_string: Buffer.concat([Buffer.from('{"transformationName":"Syn'), BOM, Buffer.from('thetic"}')]),
    };
    const out: Record<string, unknown> = {};
    for (const [name, body] of Object.entries(cases)) {
      const q = await setupP2World(api, w);
      const r = await send("POST", `/api/v1/transformations/${q.transformationId}/charter`, { ...authHeaders(q.lead.session), "content-type": "application/json" }, body, "cl");
      const name2 = (await sql<{ n: string }>`select transformation_name n from charter where transformation_id = ${q.transformationId}`.execute(api.db)).rows[0]?.n;
      out[name] = { status: r.status, code: r.errors?.[0]?.code ?? r.code, declared: r.declared, storedName: name2 === undefined ? null : JSON.stringify(name2) };
    }
    log("R2", out);
    expect(out["one_bom"]).toMatchObject({ status: 201, storedName: JSON.stringify("Synthetic BOM") });
    for (const k of ["two_boms", "bom_then_FF", "bom_only", "utf16le_bom", "utf16be_bom"]) {
      expect(out[k], k).toMatchObject({ status: 400, code: "validation.json", declared: true, storedName: null });
    }
    // A U+FEFF inside a string value is valid JSON text; it must be stored verbatim (never stripped).
    expect(out["bom_mid_string"]).toMatchObject({ status: 201, storedName: JSON.stringify("Syn﻿thetic") });
  });
});

// ---------------------------------------------------------------------------------- R3 media types / charset params
describe("R3 Content-Type variants", () => {
  it("charset params never switch the decoder; unknown JSON-ish types are 400 content_type; never 500", async () => {
    const latin = Buffer.concat([Buffer.from('{"transformationName":"Caf'), Buffer.from([0xe9]), Buffer.from('"}')]);
    const u16 = Buffer.from('{"transformationName":"S"}', "utf16le");
    const cases: Array<[string, string, Buffer, number, string]> = [
      ["latin1-param", "application/json; charset=iso-8859-1", latin, 400, "validation.json"],
      ["utf16-param", "application/json; charset=utf-16le", u16, 400, "validation.json"],
      ["upper", "APPLICATION/JSON", latin, 400, "validation.json"],
      ["vnd-json", "application/vnd.api+json", Buffer.from("{}"), 400, "validation.content_type"],
      ["merge-patch", "application/merge-patch+json", Buffer.from("{}"), 400, "validation.content_type"],
      ["garbage-ct", "application/json;;;=", Buffer.from('{"transformationName":"S"}'), 400, ""],
    ];
    const out: unknown[] = [];
    for (const [name, ct, body, wantStatus, wantCode] of cases) {
      const q = await setupP2World(api, w);
      const r = await send("POST", `/api/v1/transformations/${q.transformationId}/charter`, { ...authHeaders(q.lead.session), "content-type": ct }, body, "cl");
      out.push({ name, ct, status: r.status, code: r.errors?.[0]?.code ?? r.code, declared: r.declared, stored: await charterCount(q.transformationId), wantStatus, wantCode });
    }
    log("R3", out);
    for (const o of out as Array<{ name: string; status: number; code: string; declared: boolean; stored: number; wantStatus: number; wantCode: string }>) {
      expect(o.status, o.name).toBeLessThan(500);
      expect(o.declared, o.name).toBe(true);
      if (o.name !== "garbage-ct") {
        expect([o.name, o.status, o.code, o.stored]).toEqual([o.name, o.wantStatus, o.wantCode, 0]);
      }
    }
  });
});

// ---------------------------------------------------------------------------------- R4 prototype poisoning
describe("R4 prototype-poisoning protection survives the new parser", () => {
  it("__proto__ / constructor.prototype (plain and \\u-escaped) -> 400 validation.json; no pollution", async () => {
    const bodies: Record<string, string> = {
      proto: '{"transformationName":"S","__proto__":{"polluted":"yes"}}',
      proto_escaped: '{"transformationName":"S","\\u005f_proto__":{"polluted":"yes"}}',
      ctor: '{"transformationName":"S","constructor":{"prototype":{"polluted":"yes"}}}',
    };
    const out: Record<string, unknown> = {};
    for (const [name, b] of Object.entries(bodies)) {
      const q = await setupP2World(api, w);
      const r = await send("POST", `/api/v1/transformations/${q.transformationId}/charter`, { ...authHeaders(q.lead.session), "content-type": "application/json" }, Buffer.from(b), "chunked");
      out[name] = { status: r.status, code: r.errors?.[0]?.code ?? r.code, declared: r.declared, stored: await charterCount(q.transformationId) };
    }
    const polluted = ({} as Record<string, unknown>)["polluted"];
    log("R4", { out, polluted: polluted ?? null });
    for (const [k, v] of Object.entries(out)) expect(v, k).toMatchObject({ status: 400, code: "validation.json", declared: true, stored: 0 });
    expect(polluted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------- R5 body limit on raw bytes
describe("R5 bodyLimit counts raw bytes (1 MiB)", () => {
  it("multibyte body < limit in chars but > limit in bytes -> 400 body_too_large for both framings", async () => {
    const LIMIT = 1_048_576;
    const n = Math.ceil((LIMIT + 10) / 3); // n chars of U+0627 (2 bytes) ... use a 3-byte char: U+0646? use U+20AC (3 bytes)
    const big = Buffer.from(JSON.stringify({ transformationName: "S", outOfScope: "€".repeat(n) }));
    const out: unknown[] = [];
    for (const framing of ["cl", "chunked"] as const) {
      const q = await setupP2World(api, w);
      const r = await send("POST", `/api/v1/transformations/${q.transformationId}/charter`, { ...authHeaders(q.lead.session), "content-type": "application/json" }, big, framing);
      out.push({ framing, bytes: big.length, chars: big.toString("utf8").length, status: r.status, code: r.errors?.[0]?.code ?? r.code, declared: r.declared });
    }
    // Control: a body just UNDER the limit in bytes is not refused as too large (it may fail field validation instead).
    const under = Buffer.from(JSON.stringify({ transformationName: "S", outOfScope: "€".repeat(Math.floor((LIMIT - 200) / 3)) }));
    const q = await setupP2World(api, w);
    const r = await send("POST", `/api/v1/transformations/${q.transformationId}/charter`, { ...authHeaders(q.lead.session), "content-type": "application/json" }, under, "chunked");
    out.push({ framing: "chunked-under", bytes: under.length, status: r.status, code: r.errors?.[0]?.code ?? r.code, declared: r.declared });
    log("R5", out);
    for (const o of (out as Array<{ framing: string; status: number; code: string; declared: boolean }>).slice(0, 2)) {
      expect(o, o.framing).toMatchObject({ status: 400, code: "validation.body_too_large", declared: true });
    }
    expect((out[2] as { code: string }).code).not.toBe("validation.body_too_large");
    expect((out[2] as { status: number }).status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------------- R6 evidence upload media types
describe("R6 evidence content upload (contract: application/octet-stream only)", () => {
  it("octet-stream bytes are stored verbatim; other media types are a declared 4xx and never store rewritten bytes", async () => {
    const sent = Buffer.from([0x53, 0x79, 0x6e, 0xff, 0x00, 0xc3, 0x0a, 0xed, 0xa0, 0x80, 0x41]); // "Syn" FF 00 C3 LF ED A0 80 "A"
    const sentSha = createHash("sha256").update(sent).digest("hex");
    const out: unknown[] = [];
    const variants: Array<[string, string, "cl" | "chunked", Buffer]> = [
      ["octet-cl", "application/octet-stream", "cl", sent],
      ["octet-chunked", "application/octet-stream", "chunked", sent],
      ["text-cl", "text/plain", "cl", sent],
      ["text-chunked", "text/plain", "chunked", sent],
      ["text-chunked-valid", "text/plain; charset=utf-8", "chunked", Buffer.from("Synthetic text\n")],
      // Same ill-formed bytes WITHOUT the 0x00 (which the central U+0000 check refuses first): isolates the U+FFFD rewrite.
      ["text-chunked-noNUL", "text/plain", "chunked", Buffer.from([0x53, 0x79, 0x6e, 0xff, 0xc3, 0x0a, 0xed, 0xa0, 0x80, 0x41])],
      ["json-object", "application/json", "cl", Buffer.from('{"a":1}')],
      ["json-array", "application/json", "cl", Buffer.from("[1,2,3]")],
      ["json-string", "application/json", "cl", Buffer.from('"Synthetic"')],
    ];
    for (const [name, ct, framing, body] of variants) {
      const created = await call(api.app, "POST", `${T}/evidence`, {
        session: p.lead.session,
        body: { ownerUserId: p.lead.id, kind: "file", title: `Synthetic ${name}` },
      });
      expect(created.status).toBe(201);
      const before = errorLogs();
      const r = await send("POST", `${T}/evidence/${created.body.id}/content`, { ...authHeaders(), ...ifm(created.body.version), "content-type": ct, "x-file-name": `${name}.bin` }, body, framing);
      const stored = (await sql<{ sha256: string; size_bytes: string }>`select c.sha256, c.size_bytes from evidence e join evidence_content c on c.id = e.current_content_id where e.id = ${created.body.id}`.execute(api.db)).rows[0];
      let downloadedHex: string | null = null;
      if (stored) {
        const d = await api.app.inject({ method: "GET", url: `${T}/evidence/${created.body.id}/content`, headers: { cookie: p.lead.session.cookie } });
        downloadedHex = d.rawPayload.toString("hex");
      }
      out.push({ name, ct, framing, status: r.status, code: r.errors?.[0]?.code ?? r.code, declared: r.declared, why: r.why || undefined, sentHex: body.toString("hex"), storedSha: stored?.sha256 ?? null, sentSha: createHash("sha256").update(body).digest("hex"), downloadedHex, errorLogsAdded: errorLogs() - before });
    }
    log("R6", { sentSha, out });
    for (const o of out as Array<{ name: string; status: number; declared: boolean; storedSha: string | null; sentSha: string; downloadedHex: string | null; sentHex: string }>) {
      expect(o.status, o.name).toBeLessThan(500);
      expect(o.declared, o.name).toBe(true);
      // Whatever is stored must be exactly the bytes the client sent (never a U+FFFD rewrite).
      if (o.storedSha !== null) expect([o.name, o.storedSha, o.downloadedHex]).toEqual([o.name, o.sentSha, o.sentHex]);
    }
  });
});

// ---------------------------------------------------------------------------------- R7 query strings
describe("R7 query-string edge cases", () => {
  it("pointers, stray %, __proto__, repeated keys, health, unmatched route: declared statuses only", async () => {
    const urls = [
      "/api/v1/transformations?q=%FF",
      "/api/v1/transformations?%FF=1",
      "/api/v1/transformations?q=ok&q=%ED%A0%80",
      "/api/v1/transformations?a~b%2Fc=%C3",
      "/api/v1/transformations?q=%",
      "/api/v1/transformations?q=50%25",
      "/api/v1/transformations?q=a+b",
      "/api/v1/transformations?__proto__=x",
      "/api/v1/transformations?constructor=x",
      "/api/v1/transformations?q=%00",
      "/api/v1/transformations?q=%F0%9F%9A%80",
      "/api/v1/me?x=%FF",
      "/healthz?x=%FF",
      "/readyz?%FF",
    ];
    const out: unknown[] = [];
    const before = errorLogs();
    for (const u of urls) {
      const raw = await api.app.inject({ method: "GET", url: u, headers: { cookie: p.lead.session.cookie } });
      let declared = true;
      try { assertContract("GET", u, { statusCode: raw.statusCode, headers: raw.headers, body: raw.body }); } catch { declared = false; }
      const j = raw.headers["content-type"]?.toString().includes("json") ? raw.json() : {};
      out.push({ u, status: raw.statusCode, code: j.errors?.[0]?.code ?? j.code, pointer: j.errors?.[0]?.pointer, declared });
    }
    const unauth = await api.app.inject({ method: "GET", url: "/api/v1/transformations?q=%FF" });
    const unmatched = await api.app.inject({ method: "GET", url: "/api/v1/nope?q=%FF" });
    log("R7", { out, unauth: unauth.statusCode, unmatched: [unmatched.statusCode, unmatched.headers["content-type"]], errorLogsAdded: errorLogs() - before });
    for (const o of out as Array<{ u: string; status: number; declared: boolean }>) {
      expect(o.status, o.u).toBeLessThan(500);
      expect(o.declared, o.u).toBe(true);
    }
    const by = (u: string) => out.find((o) => (o as { u: string }).u === u) as { status: number; code: string; pointer: string };
    expect(by("/api/v1/transformations?q=%FF")).toMatchObject({ status: 400, code: "validation.format", pointer: "/query/q" });
    expect(by("/api/v1/transformations?%FF=1")).toMatchObject({ status: 400, pointer: "/query" });
    expect(by("/api/v1/transformations?q=ok&q=%ED%A0%80")).toMatchObject({ status: 400, pointer: "/query/q" });
    expect(by("/api/v1/transformations?a~b%2Fc=%C3")).toMatchObject({ status: 400, pointer: "/query/a~0b~1c" });
    expect(by("/healthz?x=%FF").status).toBe(400);
    expect(unauth.statusCode).toBe(401);
    expect(unmatched.statusCode).toBe(404);
    expect(errorLogs() - before).toBe(0);
  });
});

// ---------------------------------------------------------------------------------- R8 X-File-Name ordering
describe("R8 X-File-Name refusal never precedes authorization", () => {
  it("a user who may not edit the item gets 403/404 (not 400) for an undecodable name; literal % is kept", async () => {
    const created = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { ownerUserId: p.lead.id, kind: "file", title: "Synthetic R8" } });
    const hdr = (v: number, name: string) => ({ ...ifm(v), "content-type": "application/octet-stream", "x-file-name": name });
    const contrib = await send("POST", `${T}/evidence/${created.body.id}/content`, { ...authHeaders(p.contributor.session), ...hdr(created.body.version, "x%FF.csv") }, Buffer.from("a"), "cl");
    const auditor = await send("POST", `${T}/evidence/${created.body.id}/content`, { ...authHeaders(p.auditor.session), ...hdr(created.body.version, "x%FF.csv") }, Buffer.from("a"), "cl");
    const mixed = await send("POST", `${T}/evidence/${created.body.id}/content`, { ...authHeaders(), ...hdr(created.body.version, "%41%.csv") }, Buffer.from("a"), "cl");
    const literal = await send("POST", `${T}/evidence/${created.body.id}/content`, { ...authHeaders(), ...hdr(created.body.version, "50%.csv") }, Buffer.from("a"), "cl");
    const literalName = literal.status === 200 ? literal.raw.json().currentContent?.fileName ?? literal.raw.body.match(/50%\.csv/)?.[0] : null;
    log("R8", { contributor: [contrib.status, contrib.code], auditor: [auditor.status, auditor.code], mixed: [mixed.status, mixed.errors?.[0]], literal: [literal.status, literalName], declared: [contrib.declared, auditor.declared, mixed.declared, literal.declared] });
    expect([403, 404]).toContain(contrib.status);
    expect([403, 404]).toContain(auditor.status);
    expect(mixed).toMatchObject({ status: 400 });
    expect(literal.status).toBe(200);
    expect(literal.raw.body).toContain("50%.csv");
  });
});

// ---------------------------------------------------------------------------------- R9 real-socket chunked, unauth
describe("R9 real socket, chunked, no session: invalid UTF-8 JSON on a mutation -> declared 4xx, never 5xx", () => {
  it("401 precedence vs 400 parser error is consistent and declared", async () => {
    const body = Buffer.concat([Buffer.from('{"transformationName":"S'), Buffer.from([0xff]), Buffer.from('"}')]);
    const head = `POST ${T}/charter HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n`;
    const text = await new Promise<string>((resolve) => {
      const s = connect(port, "127.0.0.1");
      const chunks: Buffer[] = [];
      const done = () => resolve(Buffer.concat(chunks).toString("latin1"));
      const t = setTimeout(() => { s.destroy(); done(); }, 3000);
      s.on("data", (c) => chunks.push(c));
      s.on("close", () => { clearTimeout(t); done(); });
      s.on("error", () => undefined);
      s.write(Buffer.concat([Buffer.from(head), Buffer.from(body.length.toString(16) + "\r\n"), body, Buffer.from("\r\n0\r\n\r\n")]));
    });
    const status = text.split("\r\n")[0];
    log("R9", { status, body: text.split("\r\n\r\n").slice(1).join("").slice(0, 300) });
    expect(status).toMatch(/^HTTP\/1\.1 4\d\d/);
  });
});

// ---------------------------------------------------------------------------------- R10 global sweep
describe("R10 U+FFFD sweep after R1-R9", () => {
  it("no U+FFFD in any probe-written charter, evidence or audit row", async () => {
    const charter = (await sql<{ n: string }>`select count(*) n from charter where position(${FFFD} in coalesce(out_of_scope,'') || coalesce(transformation_name,'')) > 0`.execute(api.db)).rows[0]!.n;
    const audit = (await sql<{ n: string }>`select count(*) n from audit_event where position(${FFFD} in coalesce(changes::text,'')) > 0`.execute(api.db)).rows[0]!.n;
    const evidence = (await sql<{ n: string }>`select count(*) n from evidence_content where position(${FFFD} in file_name) > 0`.execute(api.db)).rows[0]!.n;
    log("R10", { charter, audit, evidence, errorLogsTotal: errorLogs(), errorMsgs: logLines.filter((l) => l.level >= 50).map((l) => l.msg) });
    expect([charter, audit, evidence]).toEqual(["0", "0", "0"]);
  });
});
