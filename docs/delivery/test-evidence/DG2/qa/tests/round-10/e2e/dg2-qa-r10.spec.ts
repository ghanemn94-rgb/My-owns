// qa-verifier DG2 round 10 — independent regression of D-070 / T-DG2-BE15 (one RFC 9110 media-type decision per request;
// every refusal names the operation's declared set; an unmatched route answers 404 whatever its body) on candidate
// 7fd1a89c (T-DG2-REV-QA-R10). Authored by qa-verifier, NOT by an implementer. Runs in chromium-en and chromium-ar against
// the REAL built API + PostgreSQL (e2e/support/qa-stack.sh) over raw TCP sockets (llhttp parsing, not light-my-request),
// and inspects the real database (psql) and the real evidence store. No server mocks.
//   QA_SHOT_DIR=<dir> e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-r10.spec.ts --workers=1
//
// R10-01 unmatched routes: POST/PUT/PATCH/DELETE to paths no operation declares (top-level and nested under a real
//   transformation), each sent octet-stream, JSON, invalid JSON, invalid UTF-8 JSON, text/plain and no Content-Type, with
//   Content-Length and chunked framing, with and without a session, plus duplicate Content-Type lines and a declared
//   body far larger than bodyLimit that is never sent: always 404 problem+json not_found with Connection: close, never
//   400/5xx, no audit row; a body that is itself an HTTP request is never answered as a second request; the server stays
//   ready.
// R10-02 uploads with "application/octet-stream; x=1", HTAB before ";" and HTAB/SP around ";" (Content-Length and
//   chunked split): 200; the downloaded bytes equal the sent bytes; sha256 = DB row = Digest; audit row per upload.
// R10-03 a JSON operation sent "application/json\t; charset=utf-8" (and quoted/upper-case UTF-8 spellings): accepted;
//   Arabic/emoji/ZWJ text cut mid-character across chunks is stored and returned verbatim.
// R10-04 duplicate Content-Type lines (JSON op and upload, same and different values): 400 validation.content_type
//   whose detail names the operation's declared set; nothing written (charter version, transformation rows, evidence
//   content rows, stored files), no audit row.
// R10-05 a JSON charset other than UTF-8 (utf8, iso-8859-1, us-ascii, utf-16, UTF-8 then latin1, quoted latin1):
//   400 validation.content_type naming application/json; nothing written.
// R10-06 every refusal names the declared set: malformed/listed/wildcard media types on a JSON op name application/json
//   only; on the octet-stream-only upload they name application/octet-stream only (never JSON).
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, SYN_RETAIL, apiSession, langOf, type ApiSession } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "default" });

type Problem = { code: string; type: string; status: number; detail: string; requestId: string; errors: { pointer: string; code: string; message: string }[] };
type Evidence = { id: string; version: number; currentContentId: string | null; fileName: string | null; title: string; noteBody: string | null };

let lead: ApiSession;
test.beforeAll(async ({ playwright }) => {
  lead = await apiSession(playwright, "dev.lead");
});

const JSON_ONLY = "Send the request body as application/json.";
const OCTET_ONLY = "Send the request body as application/octet-stream.";

async function newTransformation(name: string): Promise<{ id: string }> {
  return lead.call("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name, mode: "end_to_end" });
}
async function newFileEvidence(transformationId: string, title: string): Promise<Evidence> {
  return lead.call<Evidence>("POST", `/api/v1/transformations/${transformationId}/evidence`, { ownerUserId: lead.userId, kind: "file", title });
}

// ---- the real database (DATABASE_OWNER_URL is exported by qa-stack.sh) -----------------------------------------
function sql(query: string): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url) throw new Error("DATABASE_OWNER_URL not set: run under e2e/support/qa-stack.sh");
  return execFileSync("psql", [url.replace(/\+/g, "%20"), "-qAtX", "-c", query], { encoding: "utf8" }).trim();
}
const safe = (s: string) => {
  if (!/^[0-9A-Za-z._:-]{1,80}$/.test(s)) throw new Error(`unexpected id ${s}`);
  return s;
};
const auditRowsFor = (requestId: string) => Number(sql(`select count(*) from audit_event where request_id = '${safe(requestId)}'`));
const auditTotal = () => Number(sql("select count(*) from audit_event"));
function storedFilesFor(evidenceId: string): string[] {
  const root = process.env["EVIDENCE_STORAGE_PATH"];
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && join(d.parentPath, d.name).includes(evidenceId))
    .map((d) => join(d.parentPath, d.name));
}

// ---- raw HTTP over the real socket -----------------------------------------------------------------------------
type RawRes = { statuses: number[]; status: number; headers: Record<string, string>; body: Buffer; text: string; json: Problem | null; all: string };
function raw(chunks: Buffer[]): Promise<RawRes> {
  const u = new URL(BASE);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(u.port || 80), u.hostname === "localhost" ? "127.0.0.1" : u.hostname);
    const parts: Buffer[] = [];
    const timer = setTimeout(() => socket.destroy(new Error("raw request timed out (server hung)")), 15_000);
    socket.on("data", (d: Buffer) => parts.push(d));
    socket.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EPIPE" || e.code === "ECONNRESET") return; // the server closed after answering early
      clearTimeout(timer);
      reject(e);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      const all = Buffer.concat(parts);
      const allText = all.toString("latin1");
      const statuses = [...allText.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]));
      const i = all.indexOf("\r\n\r\n");
      const head = (i >= 0 ? all.subarray(0, i) : all).toString("latin1");
      let body = i >= 0 ? all.subarray(i + 4) : Buffer.alloc(0);
      const [statusLine = "", ...lines] = head.split("\r\n");
      const headers: Record<string, string> = {};
      for (const line of lines) {
        const j = line.indexOf(":");
        headers[line.slice(0, j).toLowerCase()] = line.slice(j + 1).trim();
      }
      if (headers["transfer-encoding"] === "chunked") {
        const out: Buffer[] = [];
        let rest = body;
        for (;;) {
          const k = rest.indexOf("\r\n");
          const n = parseInt(rest.subarray(0, k).toString("latin1"), 16);
          if (!n) break;
          out.push(rest.subarray(k + 2, k + 2 + n));
          rest = rest.subarray(k + 2 + n + 2);
        }
        body = Buffer.concat(out);
      } else if (headers["content-length"] !== undefined) body = body.subarray(0, Number(headers["content-length"]));
      const text = body.toString("utf8");
      let json: Problem | null = null;
      try {
        json = JSON.parse(text) as Problem;
      } catch {
        json = null;
      }
      resolve({ statuses, status: Number(statusLine.split(" ")[1]), headers, body, text, json, all: allText });
    });
    (async () => {
      for (const c of chunks) {
        if (socket.destroyed) break;
        socket.write(c);
        await new Promise((r) => setTimeout(r, 15));
      }
    })().catch(() => undefined);
  });
}

type Auth = { cookie: string; csrf: string } | null;
async function authOf(s: ApiSession): Promise<{ cookie: string; csrf: string }> {
  const state = await s.req.storageState();
  const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const me = (await (await s.req.get("/api/v1/me")).json()) as { csrfToken: string };
  return { cookie, csrf: me.csrfToken };
}

type Framing = "length" | "chunked" | { split: number[] } | { declare: number };
/** One raw HTTP/1.1 request; each entry of `contentTypes` becomes one Content-Type field line, in order. */
function request(
  method: string,
  path: string,
  contentTypes: readonly string[],
  body: Buffer,
  auth: Auth,
  framing: Framing,
  extra: Record<string, string> = {},
  connection = "close",
): Buffer[] {
  const host = new URL(BASE).host;
  const h = [`${method} ${path} HTTP/1.1`, `Host: ${host}`, `Origin: ${BASE}`, `Connection: ${connection}`];
  for (const ct of contentTypes) h.push(`Content-Type: ${ct}`);
  if (method === "POST" && !("If-Match" in extra)) h.push(`Idempotency-Key: ${crypto.randomUUID()}`);
  for (const [k, v] of Object.entries(extra)) h.push(`${k}: ${v}`);
  if (auth) h.push(`Cookie: ${auth.cookie}`, `X-CSRF-Token: ${auth.csrf}`);
  if (framing === "length") {
    h.push(`Content-Length: ${body.length}`);
    return [Buffer.from(`${h.join("\r\n")}\r\n\r\n`, "latin1"), body];
  }
  if (typeof framing === "object" && "declare" in framing) {
    // Declares a body of `declare` bytes but sends only `body`: the server must answer without waiting for the rest.
    h.push(`Content-Length: ${framing.declare}`);
    return [Buffer.from(`${h.join("\r\n")}\r\n\r\n`, "latin1"), body];
  }
  h.push("Transfer-Encoding: chunked");
  const cuts = framing === "chunked" ? [] : framing.split;
  const out: Buffer[] = [Buffer.from(`${h.join("\r\n")}\r\n\r\n`, "latin1")];
  let at = 0;
  for (const c of [...cuts, body.length]) {
    const p = body.subarray(at, c);
    at = c;
    if (p.length) out.push(Buffer.concat([Buffer.from(`${p.length.toString(16)}\r\n`, "latin1"), p, Buffer.from("\r\n", "latin1")]));
  }
  out.push(Buffer.from("0\r\n\r\n", "latin1"));
  return out;
}

/** Issues with a response that must be the declared 400 validation.content_type naming exactly `detail`. */
function refusalIssues(res: RawRes, detail: string): string[] {
  const issues: string[] = [];
  const body = res.json;
  if (JSON.stringify(res.statuses) !== "[400]") issues.push(`statuses ${JSON.stringify(res.statuses)}`);
  if (!/^application\/problem\+json/.test(res.headers["content-type"] ?? "")) issues.push(`content-type ${res.headers["content-type"]}`);
  if (!body || body.code !== "validation" || body.status !== 400) issues.push(`body ${res.text.slice(0, 200)}`);
  if (body && body.detail !== detail) issues.push(`detail ${JSON.stringify(body.detail)} (expected ${JSON.stringify(detail)})`);
  if (body && JSON.stringify(body.errors?.map((e) => [e.pointer, e.code, e.message])) !== JSON.stringify([["", "validation.content_type", detail]]))
    issues.push(`errors ${JSON.stringify(body.errors)}`);
  if (body && body.requestId !== res.headers["x-request-id"]) issues.push("requestId != X-Request-Id");
  if (/FST_ERR|statusCode|stack/.test(res.text)) issues.push("internals echoed");
  const rid = res.headers["x-request-id"] ?? "";
  if (!rid) issues.push("no X-Request-Id");
  else if (auditRowsFor(rid) !== 0) issues.push(`audit rows for ${rid}`);
  return issues;
}

const b = (s: string) => Buffer.from(s, "utf8");
const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");
const ILL_FORMED = Buffer.from([0x53, 0x79, 0x6e, 0xff, 0xc3, 0x0a, 0xed, 0xa0, 0x80, 0x41]);

test("R10-01 raw socket: an unmatched route answers 404 not_found for every body, media type, framing and session", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r10 unmatched ${lang.toUpperCase()} (synthetic)`);
  const auth = await authOf(lead);
  const smuggled = b(`GET /api/v1/me HTTP/1.1\r\nHost: x\r\n\r\n`);
  const bodies: [string, string[], Buffer][] = [
    ["octet-stream", ["application/octet-stream"], Buffer.concat([ILL_FORMED, randomBytes(512)])],
    ["octet-stream; x=1 (HTAB)", ["application/octet-stream\t; x=1"], ILL_FORMED],
    ["JSON", ["application/json"], b('{"name":"QA r10 synthetic عينة 🚀"}')],
    ["invalid JSON", ["application/json"], b('{"name": "QA r10", ')],
    ["invalid UTF-8 JSON", ["application/json; charset=utf-8"], Buffer.concat([b('{"name":"'), ILL_FORMED, b('"}')])],
    ["text/plain", ["text/plain"], b("QA r10 synthetic text نص")],
    ["text/plain; charset=latin1", ["text/plain; charset=iso-8859-1"], Buffer.from([0x53, 0xe9])],
    ["JSON charset=latin1", ["application/json; charset=iso-8859-1"], b("{}")],
    ["no Content-Type", [], b("QA r10 synthetic bytes")],
    ["malformed Content-Type", ["application/json; charset"], b("{}")],
    ["duplicate Content-Type", ["application/octet-stream", "application/json"], b("{}")],
    ["body is an HTTP request", ["application/octet-stream"], smuggled],
  ];
  const paths = ["/api/v1/qa-r10-does-not-exist", `/api/v1/transformations/${t.id}/qa-r10-nope`, "/api/v1/transformations/charter/x/y"];
  const failures: string[] = [];
  let n = 0;
  const auditBefore = auditTotal();
  for (const path of paths)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      for (const [label, cts, body] of bodies)
        for (const framing of ["length", "chunked"] as const)
          for (const [a, write] of [[auth, "one write"], [null, "one write"], [auth, "delayed body"], [null, "delayed body"]] as const) {
            // "one write": head and body in ONE socket write, so the body (e.g. a complete HTTP request) is already in
            // the server's buffer when the 404 is decided; "delayed body": the body follows 15 ms after the head.
            const chunks = request(method, path, cts, body, a, framing, {}, "keep-alive");
            const res = await raw(write === "one write" ? [Buffer.concat(chunks)] : chunks);
            n++;
            const issues: string[] = [];
            if (JSON.stringify(res.statuses) !== "[404]") issues.push(`statuses ${JSON.stringify(res.statuses)}`);
            if (res.json?.code !== "not_found" || res.json?.status !== 404) issues.push(`body ${res.text.slice(0, 160)}`);
            if (!/^application\/problem\+json/.test(res.headers["content-type"] ?? "")) issues.push(`content-type ${res.headers["content-type"]}`);
            if ((res.headers["connection"] ?? "").toLowerCase() !== "close") issues.push(`connection ${res.headers["connection"]}`);
            if (issues.length) failures.push(`${method} ${path} ${label} ${framing} ${a ? "session" : "anon"} ${write}: ${issues.join("; ")}`);
          }
  // A declared body far beyond bodyLimit that is never sent: the 404 comes at once (the body is not awaited or read).
  const started = Date.now();
  const big = await raw(request("POST", paths[0]!, ["application/octet-stream"], b("x"), auth, { declare: 500_000_000 }, {}, "keep-alive"));
  const bigMs = Date.now() - started;
  n++;
  if (JSON.stringify(big.statuses) !== "[404]" || big.json?.code !== "not_found") failures.push(`declared 500 MB body: ${JSON.stringify(big.statuses)} ${big.text.slice(0, 120)}`);
  const auditAfter = auditTotal();
  const ready = (await lead.req.get("/readyz")).status();
  // Positive control: matched routes on fresh connections are unaffected.
  const me = await raw(request("GET", "/api/v1/me", [], Buffer.alloc(0), auth, "length"));
  console.log(
    `QA-R10 [${lang}] R10-01 ${n} unmatched-route requests (3 paths x 4 methods x ${bodies.length} bodies x 2 framings x session/anon x one-write/delayed-body + 1 declared 500 MB): ` +
      `${failures.length ? "FAILURES " + JSON.stringify(failures.slice(0, 20)) : "all exactly one 404 not_found, problem+json, Connection: close"}; ` +
      `declared-500MB answered in ${bigMs} ms; audit_event rows ${auditBefore}->${auditAfter}; readyz ${ready}; control GET /me ${me.status}`,
  );
  expect(failures).toEqual([]);
  expect(bigMs).toBeLessThan(5000);
  expect(auditAfter).toBe(auditBefore);
  expect(ready).toBe(200);
  expect(me.status).toBe(200);
});

test("R10-02 raw socket: uploads with '; x=1' and HTAB before ';' are stored byte-exact; sha256 = DB = Digest; audited", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r10 upload spellings ${lang.toUpperCase()} (synthetic)`);
  const ev = await newFileEvidence(t.id, `QA r10 دليل 🧾 ${lang} (synthetic)`);
  const path = `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`;
  const auth = await authOf(lead);
  const all256 = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const fileName = `ملف ${lang} 👩🏽‍💻 r10.bin`;
  const revisions: [string, Buffer, Framing][] = [
    ["application/octet-stream; x=1", Buffer.concat([all256, ILL_FORMED, randomBytes(40_000)]), "length"],
    ["application/octet-stream\t; x=1", Buffer.concat([ILL_FORMED, randomBytes(9_000), all256]), "length"],
    ["application/octet-stream\t; x=1", Buffer.concat([randomBytes(30_000), all256]), { split: [1, 5, 4096, 20_000] }],
    ["application/octet-stream \t;\t x=\"quoted; value\"", Buffer.concat([all256, ILL_FORMED]), "chunked"],
    ["APPLICATION/Octet-Stream\t;x=1;\ty=2", randomBytes(5000), "length"],
  ];
  let version = ev.version;
  const lines: string[] = [];
  for (const [ct, bytes, framing] of revisions) {
    const label = `${JSON.stringify(ct)} ${typeof framing === "string" ? framing : "split"}`;
    const res = await raw(request("POST", path, [ct], bytes, auth, framing, { "If-Match": `"${version}"`, "X-File-Name": encodeURIComponent(fileName) }));
    expect(res.status, `${label}: ${res.text.slice(0, 300)}`).toBe(200);
    const saved = JSON.parse(res.text) as Evidence;
    expect(saved.version).toBeGreaterThan(version);
    version = saved.version;
    expect(saved.fileName).toBe(fileName);
    const audits = auditRowsFor(res.headers["x-request-id"]!);
    expect(audits, `${label}: audit rows`).toBeGreaterThan(0);
    const dl = await lead.req.get(path);
    expect(dl.status()).toBe(200);
    const got = await dl.body();
    const stored = sql(`select sha256 || ' ' || size_bytes from evidence_content where id = '${safe(saved.currentContentId!)}'`);
    expect(got.equals(bytes), `${label}: downloaded bytes equal the uploaded bytes`).toBe(true);
    expect(stored).toBe(`${sha(bytes)} ${bytes.length}`);
    expect(dl.headers()["digest"]).toBe(`sha-256=${createHash("sha256").update(bytes).digest("base64")}`);
    lines.push(`${label} -> 200 ${bytes.length} B, sha256 ${sha(bytes).slice(0, 12)}… = DB = Digest, audit ${audits}`);
  }
  console.log(`QA-R10 [${lang}] R10-02 ${JSON.stringify(lines)}`);
});

test("R10-03 raw socket: 'application/json\\t; charset=utf-8' is accepted; Arabic/emoji text cut mid-character round-trips verbatim", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r10 json spellings ${lang.toUpperCase()} (synthetic)`);
  const auth = await authOf(lead);
  const lines: string[] = [];
  const spellings = ["application/json\t; charset=utf-8", 'application/json ;\tcharset="UTF-8"', "Application/JSON\t;\tCharset=Utf-8", "application/json\t"];
  for (const [k, ct] of spellings.entries()) {
    const title = `دليل اصطناعي ${k} 🚀 👨‍👩‍👧‍👦 ${lang} ‏(r10)`;
    const noteBody = `ملاحظة 🇸🇦 é Synthétic — نص عربي ${k}`;
    const body = b(JSON.stringify({ ownerUserId: lead.userId, kind: "note", title, noteBody }));
    const cuts: number[] = [];
    for (let i = 1; i < body.length; i++) if ((body[i]! & 0xc0) === 0x80) cuts.push(i);
    const res = await raw(request("POST", `/api/v1/transformations/${t.id}/evidence`, [ct], body, auth, k % 2 ? "length" : { split: cuts }));
    expect(res.status, `${JSON.stringify(ct)}: ${res.text.slice(0, 300)}`).toBe(201);
    const id = (JSON.parse(res.text) as Evidence).id;
    const got = await lead.call<Evidence>("GET", `/api/v1/transformations/${t.id}/evidence/${id}`);
    const dbTitle = sql(`select title from evidence where id = '${safe(id)}'`);
    expect(got.title).toBe(title);
    expect(dbTitle).toBe(title);
    expect(b(got.noteBody ?? "").equals(b(noteBody))).toBe(true);
    lines.push(`${JSON.stringify(ct)} ${k % 2 ? "length" : `${cuts.length + 1} chunks`} -> 201; title/note verbatim (API and DB)`);
  }
  // The charter (PATCH, If-Match) with the HTAB spelling.
  const charterPath = `/api/v1/transformations/${t.id}/charter`;
  await lead.call("POST", charterPath, { transformationName: "QA r10 (synthetic)", outOfScope: "Synthetic start" });
  const v0 = (await lead.call<{ charter: { version: number } }>("GET", charterPath)).charter.version;
  const oos = "خارج النطاق: 🚫 البيع بالجملة ‎(synthetic)";
  const res = await raw(request("PATCH", charterPath, ["application/json\t; charset=utf-8"], b(JSON.stringify({ outOfScope: oos })), auth, "chunked", { "If-Match": `"${v0}"` }));
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  const c = (await lead.call<{ charter: { version: number; outOfScope: string } }>("GET", charterPath)).charter;
  expect(c.outOfScope).toBe(oos);
  expect(c.version).toBeGreaterThan(v0);
  lines.push(`PATCH charter HTAB spelling -> 200; version ${v0}->${c.version}; outOfScope verbatim`);
  console.log(`QA-R10 [${lang}] R10-03 ${JSON.stringify(lines)}`);
});

test("R10-04 raw socket: duplicate Content-Type lines are the declared 400 naming the declared set; nothing is written", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r10 duplicate CT ${lang.toUpperCase()} (synthetic)`);
  const auth = await authOf(lead);
  const failures: string[] = [];
  let n = 0;
  // JSON op: POST transformations (a unique name must never appear) and PATCH charter (the version must not move).
  const name = `QA r10 must-not-exist ${lang} ${crypto.randomUUID()} (synthetic)`;
  const createBody = b(JSON.stringify({ businessUnitId: SYN_RETAIL, name, mode: "end_to_end" }));
  const charterPath = `/api/v1/transformations/${t.id}/charter`;
  await lead.call("POST", charterPath, { transformationName: "QA r10 dup (synthetic)", outOfScope: "Synthetic start" });
  const v0 = (await lead.call<{ charter: { version: number } }>("GET", charterPath)).charter.version;
  const jsonPairs = [
    ["application/json", "application/json"],
    ["application/json", "application/octet-stream"],
    ["application/octet-stream", "application/json"],
    ["application/json; charset=utf-8", "application/json; charset=utf-8"],
    ["application/json", "text/plain"],
  ];
  for (const pair of jsonPairs)
    for (const framing of ["length", "chunked"] as const) {
      const r1 = await raw(request("POST", "/api/v1/transformations", pair, createBody, auth, framing));
      const r2 = await raw(request("PATCH", charterPath, pair, b(JSON.stringify({ outOfScope: "Synthetic changed" })), auth, framing, { "If-Match": `"${v0}"` }));
      n += 2;
      for (const [op, r] of [["POST transformations", r1], ["PATCH charter", r2]] as const) {
        const issues = refusalIssues(r, JSON_ONLY);
        if (issues.length) failures.push(`${op} ${JSON.stringify(pair)} ${framing}: ${issues.join("; ")}`);
      }
    }
  const created = Number(sql(`select count(*) from transformation where name = '${name.replace(/'/g, "''")}'`));
  const c1 = (await lead.call<{ charter: { version: number; outOfScope: string } }>("GET", charterPath)).charter;
  // Upload (declared: application/octet-stream only).
  const ev = await newFileEvidence(t.id, `QA r10 dup upload ${lang} (synthetic)`);
  const path = `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`;
  const octPairs = [
    ["application/octet-stream", "application/octet-stream"],
    ["application/octet-stream", "text/plain"],
    ["text/plain", "application/octet-stream"],
    ["application/octet-stream", "application/json"],
    ["application/octet-stream\t; x=1", "application/octet-stream; x=1"],
  ];
  for (const pair of octPairs)
    for (const framing of ["length", "chunked"] as const) {
      const r = await raw(request("POST", path, pair, ILL_FORMED, auth, framing, { "If-Match": `"${ev.version}"`, "X-File-Name": "dup.bin" }));
      n++;
      const issues = refusalIssues(r, OCTET_ONLY);
      if (issues.length) failures.push(`upload ${JSON.stringify(pair)} ${framing}: ${issues.join("; ")}`);
    }
  const after = await lead.call<Evidence>("GET", `/api/v1/transformations/${t.id}/evidence/${ev.id}`);
  const contentRows = Number(sql(`select count(*) from evidence_content where evidence_id = '${safe(ev.id)}'`));
  const files = storedFilesFor(ev.id);
  console.log(
    `QA-R10 [${lang}] R10-04 ${n} duplicate-Content-Type requests: ${failures.length ? "FAILURES " + JSON.stringify(failures) : "all 400 validation.content_type naming the declared set, 0 audit rows each"}; ` +
      `transformations created ${created}; charter version ${v0}->${c1.version} (${c1.outOfScope}); evidence version ${ev.version}->${after.version}, currentContentId ${after.currentContentId}, content rows ${contentRows}, stored files ${files.length}`,
  );
  expect(failures).toEqual([]);
  expect(created).toBe(0);
  expect(c1.version).toBe(v0);
  expect(c1.outOfScope).toBe("Synthetic start");
  expect(after.version).toBe(ev.version);
  expect(after.currentContentId).toBeNull();
  expect(contentRows).toBe(0);
  expect(files).toEqual([]);
});

test("R10-05 raw socket: a JSON charset other than UTF-8 is the declared 400 naming application/json; nothing is written", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r10 charset ${lang.toUpperCase()} (synthetic)`);
  const auth = await authOf(lead);
  const charterPath = `/api/v1/transformations/${t.id}/charter`;
  await lead.call("POST", charterPath, { transformationName: "QA r10 charset (synthetic)", outOfScope: "Synthetic start" });
  const v0 = (await lead.call<{ charter: { version: number } }>("GET", charterPath)).charter.version;
  const name = `QA r10 charset must-not-exist ${lang} ${crypto.randomUUID()} (synthetic)`;
  const ascii = b(JSON.stringify({ outOfScope: "Synthetic changed" }));
  const cases: [string, Buffer][] = [
    ["application/json; charset=utf8", ascii],
    ["application/json; charset=iso-8859-1", Buffer.concat([b('{"outOfScope":"Synth'), Buffer.from([0xe9]), b('tic"}')])],
    ["application/json; charset=us-ascii", ascii],
    ["application/json; charset=utf-16", Buffer.from('{"outOfScope":"Synthetic"}', "utf16le")],
    ["application/json; charset=UTF-16LE", Buffer.from('{"outOfScope":"Synthetic"}', "utf16le")],
    ['application/json; charset="windows-1256"', ascii],
    ["application/json; charset=utf-8; charset=latin1", ascii],
    ["application/json\t; charset=utf-8\t;\tcharset=iso-8859-1", ascii],
    ["application/json; charset=\"utf-8 \"", ascii],
  ];
  const failures: string[] = [];
  let n = 0;
  for (const [ct, body] of cases)
    for (const framing of ["length", "chunked"] as const) {
      const r = await raw(request("PATCH", charterPath, [ct], body, auth, framing, { "If-Match": `"${v0}"` }));
      const r2 = await raw(
        request("POST", "/api/v1/transformations", [ct], b(JSON.stringify({ businessUnitId: SYN_RETAIL, name, mode: "end_to_end" })), auth, framing),
      );
      n += 2;
      for (const [op, res] of [["PATCH charter", r], ["POST transformations", r2]] as const) {
        const issues = refusalIssues(res, JSON_ONLY);
        if (issues.length) failures.push(`${op} ${JSON.stringify(ct)} ${framing}: ${issues.join("; ")}`);
      }
    }
  const c1 = (await lead.call<{ charter: { version: number; outOfScope: string } }>("GET", charterPath)).charter;
  const created = Number(sql(`select count(*) from transformation where name = '${name.replace(/'/g, "''")}'`));
  console.log(
    `QA-R10 [${lang}] R10-05 ${n} non-UTF-8 JSON charset requests: ${failures.length ? "FAILURES " + JSON.stringify(failures) : "all 400 validation.content_type naming application/json, 0 audit rows each"}; charter version ${v0}->${c1.version} (${c1.outOfScope}); transformations created ${created}`,
  );
  expect(failures).toEqual([]);
  expect(c1.version).toBe(v0);
  expect(c1.outOfScope).toBe("Synthetic start");
  expect(created).toBe(0);
});

test("R10-06 raw socket: every refusal names exactly the operation's declared set (JSON op vs octet-stream-only upload)", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r10 detail ${lang.toUpperCase()} (synthetic)`);
  const auth = await authOf(lead);
  const ev = await newFileEvidence(t.id, `QA r10 detail upload ${lang} (synthetic)`);
  const upload = `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`;
  const odd = [
    "application/json; charset", // parameter without "="
    "application/json;=x", // empty parameter name
    "application/json, text/plain", // a list
    "application/json; x=\"unterminated", // unterminated quoted-string
    "application/json x", // trailing text
    "application /json", // whitespace inside type/subtype
    "*/*",
    "application/*",
    "application/octet-stream; charset", // malformed octet-stream
    "application/octet-stream\t;;\t=", // malformed octet-stream (empty name)
    "text/plain\t; charset=utf-8",
    "application/x-www-form-urlencoded",
  ];
  const failures: string[] = [];
  let n = 0;
  for (const ct of odd)
    for (const framing of ["length", "chunked"] as const) {
      const json = await raw(request("POST", `/api/v1/transformations/${t.id}/evidence`, [ct], b(JSON.stringify({ ownerUserId: lead.userId, kind: "note", title: "QA r10 must-not-exist (synthetic)", noteBody: "x" })), auth, framing));
      const up = await raw(request("POST", upload, [ct], ILL_FORMED, auth, framing, { "If-Match": `"${ev.version}"`, "X-File-Name": "d.bin" }));
      n += 2;
      const i1 = refusalIssues(json, JSON_ONLY);
      const i2 = refusalIssues(up, OCTET_ONLY);
      if (i1.length) failures.push(`JSON op ${JSON.stringify(ct)} ${framing}: ${i1.join("; ")}`);
      if (i2.length) failures.push(`upload ${JSON.stringify(ct)} ${framing}: ${i2.join("; ")}`);
    }
  const notes = Number(sql(`select count(*) from evidence where transformation_id = '${safe(t.id)}' and title = 'QA r10 must-not-exist (synthetic)'`));
  const contentRows = Number(sql(`select count(*) from evidence_content where evidence_id = '${safe(ev.id)}'`));
  console.log(
    `QA-R10 [${lang}] R10-06 ${n} malformed/undeclared requests: ${failures.length ? "FAILURES " + JSON.stringify(failures) : `JSON op always "${JSON_ONLY}", upload always "${OCTET_ONLY}"`}; notes created ${notes}; upload content rows ${contentRows}`,
  );
  expect(failures).toEqual([]);
  expect(notes).toBe(0);
  expect(contentRows).toBe(0);
});
