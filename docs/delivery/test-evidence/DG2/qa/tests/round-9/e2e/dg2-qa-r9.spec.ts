// qa-verifier DG2 round 9 — independent regression of D-069 (F-DG2-320: every operation accepts only its declared
// request media types; anything else is a declared 400 validation.content_type before the body is read) and
// re-verification of F-DG2-340 (FE8: a form-level validation problem is shown ONCE, in one live region) on candidate
// 45ebccc0 (T-DG2-REV-QA-R9). Authored by qa-verifier, NOT by an implementer. Runs in chromium-en (English LTR) and
// chromium-ar (Arabic RTL) against the REAL built SPA + API + PostgreSQL (e2e/support/qa-stack.sh). No server mocks:
// the UI checks only rewrite the browser's outgoing request body, so the REAL server answers.
//   QA_SHOT_DIR=<dir> e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-r9.spec.ts --workers=1
//
// R9-01 (raw socket): uploadEvidenceContent with UNDECLARED media types (text/plain with invalid bytes, text/plain;
//   charset=utf-8, application/json object and string, multipart/form-data, x-www-form-urlencoded, image/png,
//   application/octet-streams, no Content-Type but a body) x Content-Length / chunked, with a session: always 400
//   problem+json validation.content_type at pointer ""; no audit row for the request id (psql on the real DB); the
//   evidence keeps no content (currentContentId null, version unchanged, download 404) and no file is stored.
//   Without a session the same refusal is a 400 too (documented: body parsing precedes authentication).
// R9-02 (raw socket + API): a VALID binary upload (all 256 byte values, invalid-UTF-8 sequences, 64 KiB pseudo-random)
//   with Content-Length, a second revision CHUNKED and split mid-buffer, and a third with "Application/Octet-Stream;
//   charset=binary" (media types are case-insensitive, parameters ignored): 200; the downloaded bytes equal the sent
//   bytes; sha256 of the download = locally computed = Digest header; an audit row exists for each upload request id;
//   an Arabic/emoji X-File-Name (percent-encoded) round-trips.
// R9-03 (raw socket): JSON operations (PATCH charter, POST transformations) sent text/plain, application/octet-stream,
//   x-www-form-urlencoded, text/json, application/jsonp or no Content-Type: 400 validation.content_type, nothing
//   written, no audit row; "application/json; charset=UTF-8" and "APPLICATION/JSON" are accepted (200/201).
// R9-04 (raw socket): Arabic/emoji/ZWJ/combining-mark JSON text sent chunked and cut mid-character round-trips verbatim.
// R9-05 (UI, F-DG2-340 sweep): a tampered invalid-UTF-8 body on the charter, the P1 transformation create form, the
//   P1 admin organization create form and the ReasonDialog (archive) shows the localized validation__json message
//   EXACTLY once (one role=alert, one occurrence in the page text); a field-pointer error (/outOfScope) stays on its
//   field; a genuinely different second message (an error whose pointer maps to no field) is still shown. Axe each.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  BASE,
  SYN_RETAIL,
  apiSession,
  axeSummary,
  escape,
  expectAccessible,
  fieldLabel,
  langOf,
  rowAction,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "default" });

const DIR = process.env["QA_SHOT_DIR"] ?? "test-results/qa-r9";
async function qaShot(page: Page, lang: Lang, name: string) {
  mkdirSync(join(DIR, lang), { recursive: true });
  await page.screenshot({ path: join(DIR, lang, `${name}.png`), fullPage: true });
}

type Problem = { code: string; type: string; status: number; requestId: string; errors: { pointer: string; code: string }[] };
type Evidence = { id: string; version: number; currentContentId: string | null; fileName: string | null; title: string; noteBody: string | null };

let lead: ApiSession;
let admin: ApiSession;

test.beforeAll(async ({ playwright }) => {
  lead = await apiSession(playwright, "dev.lead");
  admin = await apiSession(playwright, "dev.admin");
});

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  const mine = Object.fromEntries(Object.entries(axeSummary).filter(([k]) => k.startsWith(`${lang}/qa-r9-`)));
  mkdirSync(join(DIR, lang), { recursive: true });
  writeFileSync(join(DIR, lang, "axe-summary-qa-r9.json"), `${JSON.stringify(mine, null, 2)}\n`);
  expect(admin.userId).toBeTruthy();
});

async function newTransformation(name: string): Promise<{ id: string; organizationId: string; version: number }> {
  return lead.call("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name, mode: "end_to_end" });
}

// ---- the real database (DATABASE_OWNER_URL is exported by qa-stack.sh) -----------------------------------------
function sql(query: string): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url) throw new Error("DATABASE_OWNER_URL not set: run under e2e/support/qa-stack.sh");
  // node-postgres decodes "+" in the URL query as a space; libpq (psql) does not, so spell it %20 for psql.
  return execFileSync("psql", [url.replace(/\+/g, "%20"), "-qAtX", "-c", query], { encoding: "utf8" }).trim();
}
const uuidish = (s: string) => {
  if (!/^[0-9A-Za-z._:-]{1,80}$/.test(s)) throw new Error(`unexpected id ${s}`);
  return s;
};
const auditRowsFor = (requestId: string) => Number(sql(`select count(*) from audit_event where request_id = '${uuidish(requestId)}'`));

function storedFilesFor(evidenceId: string): string[] {
  const root = process.env["EVIDENCE_STORAGE_PATH"];
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && join(d.parentPath, d.name).includes(evidenceId))
    .map((d) => join(d.parentPath, d.name));
}

// ---- raw HTTP over the real socket -----------------------------------------------------------------------------
type RawRes = { status: number; headers: Record<string, string>; body: Buffer; text: string };
function raw(chunks: Buffer[]): Promise<RawRes> {
  const u = new URL(BASE);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(u.port || 80), u.hostname === "localhost" ? "127.0.0.1" : u.hostname);
    const parts: Buffer[] = [];
    const timer = setTimeout(() => socket.destroy(new Error("raw request timed out (server hung)")), 15_000);
    socket.on("data", (d: Buffer) => parts.push(d));
    socket.on("error", (e: NodeJS.ErrnoException) => {
      // The server may close right after its early 400 while we are still writing the unread body (EPIPE/ECONNRESET);
      // what it already answered is kept.
      if (e.code === "EPIPE" || e.code === "ECONNRESET") return;
      clearTimeout(timer);
      reject(e);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      const all = Buffer.concat(parts);
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
      }
      resolve({ status: Number(statusLine.split(" ")[1]), headers, body, text: body.toString("utf8") });
    });
    (async () => {
      for (const c of chunks) {
        if (socket.destroyed) break;
        socket.write(c);
        await new Promise((r) => setTimeout(r, 25));
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

type Framing = "length" | "chunked" | { split: number[] };
function request(
  method: "POST" | "PATCH",
  path: string,
  contentType: string | null,
  body: Buffer,
  auth: Auth,
  framing: Framing,
  extra: Record<string, string> = {},
): Buffer[] {
  const host = new URL(BASE).host;
  const h = [`${method} ${path} HTTP/1.1`, `Host: ${host}`, `Origin: ${BASE}`, "Connection: close"];
  if (contentType !== null) h.push(`Content-Type: ${contentType}`);
  if (method === "POST" && !("If-Match" in extra)) h.push(`Idempotency-Key: ${crypto.randomUUID()}`);
  for (const [k, v] of Object.entries(extra)) h.push(`${k}: ${v}`);
  if (auth) h.push(`Cookie: ${auth.cookie}`, `X-CSRF-Token: ${auth.csrf}`);
  if (framing === "length") {
    h.push(`Content-Length: ${body.length}`);
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

function contentTypeProblemIssues(res: RawRes): string[] {
  const issues: string[] = [];
  let body: Problem | undefined;
  try {
    body = JSON.parse(res.text) as Problem;
  } catch {
    body = undefined;
  }
  if (res.status !== 400) issues.push(`status ${res.status}`);
  if (!/^application\/problem\+json/.test(res.headers["content-type"] ?? "")) issues.push(`content-type ${res.headers["content-type"]}`);
  if (!body || body.code !== "validation" || body.status !== 400) issues.push(`body ${res.text.slice(0, 200)}`);
  if (body && JSON.stringify(body.errors?.map((e) => [e.pointer, e.code])) !== JSON.stringify([["", "validation.content_type"]]))
    issues.push(`errors ${JSON.stringify(body.errors)}`);
  if (body && body.requestId !== res.headers["x-request-id"]) issues.push("requestId != X-Request-Id");
  if (/FST_ERR|statusCode|stack/.test(res.text)) issues.push("internals echoed");
  return issues;
}

const b = (s: string) => Buffer.from(s, "utf8");
const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");

async function newFileEvidence(transformationId: string, title: string): Promise<Evidence> {
  return lead.call<Evidence>("POST", `/api/v1/transformations/${transformationId}/evidence`, {
    ownerUserId: lead.userId,
    kind: "file",
    title,
  });
}

test("R9-01 raw socket: an evidence upload in an undeclared media type is 400 validation.content_type; nothing stored, no audit row", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r9 upload media types ${lang.toUpperCase()} (synthetic)`);
  const ev = await newFileEvidence(t.id, `QA r9 دليل 🧾 ${lang} (synthetic)`);
  const path = `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`;
  const auth = await authOf(lead);
  const cases: [string | null, Buffer][] = [
    ["text/plain", Buffer.from([0x53, 0x79, 0x6e, 0xff, 0xc3, 0x0a, 0xed, 0xa0, 0x80, 0x41])],
    ["text/plain; charset=utf-8", b("Synthetic plain text عينة")],
    ["application/json", b('{"content":"Synthetic"}')],
    ["application/json", b('"Synthetic JSON string"')],
    ["multipart/form-data; boundary=qa", b('--qa\r\nContent-Disposition: form-data; name="f"; filename="a.bin"\r\n\r\nSyn\r\n--qa--\r\n')],
    ["application/x-www-form-urlencoded", b("content=Synthetic")],
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
    ["application/octet-streams", b("Synthetic")],
    [null, b("Synthetic bytes without a media type")],
  ];
  const failures: string[] = [];
  let n = 0;
  for (const [ct, body] of cases) {
    for (const framing of ["length", "chunked"] as const) {
      const res = await raw(
        request("POST", path, ct, body, auth, framing, { "If-Match": `"${ev.version}"`, "X-File-Name": "synthetic.bin" }),
      );
      const issues = contentTypeProblemIssues(res);
      const rid = res.headers["x-request-id"] ?? "";
      const audits = rid ? auditRowsFor(rid) : -1;
      if (audits !== 0) issues.push(`audit rows for ${rid}: ${audits}`);
      if (issues.length) failures.push(`${ct ?? "<none>"} / ${framing}: ${issues.join("; ")}`);
      n++;
    }
  }
  // Without a session: still the media-type refusal (body parsing precedes authentication, D-069), never a 2xx/5xx.
  const anon = await raw(request("POST", path, "text/plain", b("Synthetic"), null, "length", { "If-Match": `"${ev.version}"`, "X-File-Name": "s.bin" }));
  const anonIssues = contentTypeProblemIssues(anon);
  const after = await lead.call<Evidence>("GET", `/api/v1/transformations/${t.id}/evidence/${ev.id}`);
  const download = await lead.req.get(path);
  const files = storedFilesFor(ev.id);
  const contentRows = Number(sql(`select count(*) from evidence_content where evidence_id = '${uuidish(ev.id)}'`));
  console.log(
    `QA-R9 [${lang}] R9-01 ${n} undeclared-media-type uploads (9 types x 2 framings): ${failures.length ? "FAILURES " + JSON.stringify(failures) : "all 400 validation.content_type at pointer \"\", 0 audit rows each"}; ` +
      `no session -> ${anon.status} ${JSON.stringify((JSON.parse(anon.text) as Problem).errors)}; evidence version ${ev.version}->${after.version}, currentContentId ${after.currentContentId}, ` +
      `download ${download.status()}, evidence_content rows ${contentRows}, stored files ${files.length}`,
  );
  expect(failures).toEqual([]);
  expect(anonIssues).toEqual([]);
  expect(after.version).toBe(ev.version);
  expect(after.currentContentId).toBeNull();
  expect(download.status()).toBe(404);
  expect(contentRows).toBe(0);
  expect(files).toEqual([]);
  expect((await lead.req.get("/readyz")).status()).toBe(200);
});

test("R9-02 raw socket: a valid binary upload stores the exact bytes; download bytes, sha256 and Digest match; audited", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r9 binary upload ${lang.toUpperCase()} (synthetic)`);
  const ev = await newFileEvidence(t.id, `QA r9 binary ${lang} (synthetic)`);
  const path = `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`;
  const auth = await authOf(lead);
  const all256 = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xc0, 0x80, 0xed, 0xa0, 0x80, 0xf4, 0x90, 0x80, 0x80, 0xc3]);
  const fileName = `تقرير ${lang} 🧾 synthetic.bin`;
  const revisions: [string, string, Buffer, Framing][] = [
    ["content-length", "application/octet-stream", Buffer.concat([all256, invalidUtf8, randomBytes(64 * 1024)]), "length"],
    ["chunked split", "application/octet-stream", Buffer.concat([invalidUtf8, randomBytes(20_000), all256]), { split: [1, 7, 4096, 9000] }],
    ["case + parameter", "Application/Octet-Stream; charset=binary", Buffer.concat([all256.reverse(), randomBytes(3000)]), "length"],
  ];
  let version = ev.version;
  for (const [label, ct, bytes, framing] of revisions) {
    const res = await raw(
      request("POST", path, ct, bytes, auth, framing, { "If-Match": `"${version}"`, "X-File-Name": encodeURIComponent(fileName) }),
    );
    expect(res.status, `${label}: ${res.text.slice(0, 300)}`).toBe(200);
    const saved = JSON.parse(res.text) as Evidence;
    expect(saved.version).toBeGreaterThan(version);
    version = saved.version;
    expect(saved.fileName).toBe(fileName);
    const rid = res.headers["x-request-id"]!;
    const audits = auditRowsFor(rid);
    expect(audits, `audit rows for upload ${rid}`).toBeGreaterThan(0);
    const dl = await lead.req.get(path);
    expect(dl.status()).toBe(200);
    const got = await dl.body();
    const digest = dl.headers()["digest"] ?? "";
    const stored = sql(`select sha256 || ' ' || size_bytes from evidence_content where id = '${uuidish(saved.currentContentId!)}'`);
    expect(got.equals(bytes), `${label}: downloaded bytes equal the uploaded bytes`).toBe(true);
    expect(sha(got)).toBe(sha(bytes));
    expect(digest).toBe(`sha-256=${createHash("sha256").update(bytes).digest("base64")}`);
    expect(stored).toBe(`${sha(bytes)} ${bytes.length}`);
    expect(dl.headers()["content-disposition"] ?? "").toContain("attachment");
    console.log(
      `QA-R9 [${lang}] R9-02 ${label} (${ct}): 200, ${bytes.length} bytes; download identical; sha256 ${sha(bytes).slice(0, 16)}… = DB = Digest; audit rows ${audits}; ` +
        `fileName round-trips; Content-Disposition ${dl.headers()["content-disposition"]}`,
    );
  }
});

test("R9-03 raw socket: JSON operations refuse undeclared media types (nothing written, no audit) and accept JSON with parameters", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r9 json media types ${lang.toUpperCase()} (synthetic)`);
  const charterPath = `/api/v1/transformations/${t.id}/charter`;
  await lead.call("POST", charterPath, { transformationName: "QA r9 (synthetic)", outOfScope: "Synthetic start" });
  const v0 = (await lead.call<{ charter: { version: number } }>("GET", charterPath)).charter.version;
  const auth = await authOf(lead);
  const json = b(JSON.stringify({ outOfScope: "Synthetic changed" }));
  const bad: (string | null)[] = ["text/plain", "text/plain; charset=utf-8", "application/octet-stream", "application/x-www-form-urlencoded", "text/json", "application/jsonp", null];
  const failures: string[] = [];
  for (const ct of bad) {
    for (const framing of ["length", "chunked"] as const) {
      const res = await raw(request("PATCH", charterPath, ct, json, auth, framing, { "If-Match": `"${v0}"` }));
      const issues = contentTypeProblemIssues(res);
      const rid = res.headers["x-request-id"] ?? "";
      if (rid && auditRowsFor(rid) !== 0) issues.push("audit row written");
      if (issues.length) failures.push(`PATCH charter ${ct ?? "<none>"} / ${framing}: ${issues.join("; ")}`);
    }
  }
  const createName = `QA r9 must-not-exist ${lang} ${crypto.randomUUID()} (synthetic)`;
  for (const ct of ["text/plain", "application/octet-stream"]) {
    const res = await raw(
      request("POST", "/api/v1/transformations", ct, b(JSON.stringify({ businessUnitId: SYN_RETAIL, name: createName, mode: "end_to_end" })), auth, "length"),
    );
    const issues = contentTypeProblemIssues(res);
    if (issues.length) failures.push(`POST transformations ${ct}: ${issues.join("; ")}`);
  }
  const created = Number(sql(`select count(*) from transformation where name = '${createName.replace(/'/g, "''")}'`));
  const v1 = (await lead.call<{ charter: { version: number; outOfScope: string } }>("GET", charterPath)).charter;
  console.log(
    `QA-R9 [${lang}] R9-03 ${bad.length * 2 + 2} undeclared JSON-op requests: ${failures.length ? "FAILURES " + JSON.stringify(failures) : "all 400 validation.content_type, no audit"}; charter version ${v0}->${v1.version} (${v1.outOfScope}); transformations created ${created}`,
  );
  expect(failures).toEqual([]);
  expect(v1.version).toBe(v0);
  expect(v1.outOfScope).toBe("Synthetic start");
  expect(created).toBe(0);
  // Declared JSON with a charset parameter and in upper case is accepted.
  const ok1 = await raw(request("PATCH", charterPath, "application/json; charset=UTF-8", json, auth, "length", { "If-Match": `"${v0}"` }));
  expect(ok1.status, ok1.text).toBe(200);
  const v2 = (JSON.parse(ok1.text) as { charter?: { version: number }; version?: number });
  const ver2 = v2.charter?.version ?? v2.version!;
  const ok2 = await raw(
    request("PATCH", charterPath, "APPLICATION/JSON", b(JSON.stringify({ outOfScope: "Synthetic upper" })), auth, "chunked", { "If-Match": `"${ver2}"` }),
  );
  expect(ok2.status, ok2.text).toBe(200);
  console.log(`QA-R9 [${lang}] R9-03 accepted: "application/json; charset=UTF-8" -> ${ok1.status}, "APPLICATION/JSON" chunked -> ${ok2.status}`);
});

test("R9-04 raw socket: Arabic/emoji/ZWJ/combining text sent chunked and cut mid-character round-trips verbatim", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r9 roundtrip ${lang.toUpperCase()} (synthetic)`);
  const auth = await authOf(lead);
  const title = `دليل ‏اصطناعي 🚀 👩🏽‍💻 ${lang}`;
  const noteBody = "ملاحظة 👨‍👩‍👧‍👦 Synthétic café — نص عربي";
  const body = b(JSON.stringify({ ownerUserId: lead.userId, kind: "note", title, noteBody }));
  const cuts: number[] = [];
  for (let i = 1; i < body.length; i++) if ((body[i]! & 0xc0) === 0x80) cuts.push(i);
  const res = await raw(request("POST", `/api/v1/transformations/${t.id}/evidence`, "application/json; charset=utf-8", body, auth, { split: cuts }));
  expect(res.status, res.text).toBe(201);
  const id = (JSON.parse(res.text) as Evidence).id;
  const got = await lead.call<Evidence>("GET", `/api/v1/transformations/${t.id}/evidence/${id}`);
  expect(got.title).toBe(title);
  expect(got.noteBody).toBe(noteBody);
  expect(b(got.noteBody ?? "").equals(b(noteBody))).toBe(true);
  console.log(`QA-R9 [${lang}] R9-04 ${cuts.length + 1} chunks cut mid-character: 201; title and note stored verbatim (${b(title).length}+${b(noteBody).length} bytes)`);
});

test("R9-06 raw socket edges: a bodiless operation with an undeclared body; JSON declared with a non-UTF-8 charset", async ({ playwright }, info) => {
  const lang = langOf(info);
  // logout declares no request body: a text/plain body is refused BEFORE the handler, so the session stays signed in.
  const victim = await apiSession(playwright, "dev.lead");
  const vAuth = await authOf(victim);
  const res = await raw(request("POST", "/api/v1/auth/logout", "text/plain", b("Synthetic"), vAuth, "length"));
  const issues = contentTypeProblemIssues(res);
  const stillIn = (await victim.req.get("/api/v1/me")).status();
  console.log(`QA-R9 [${lang}] R9-06 logout + text/plain body -> ${res.status} ${res.text.slice(0, 160)}; GET /me afterwards ${stillIn}`);
  expect(issues).toEqual([]);
  expect(stillIn).toBe(200);
  // JSON with a charset other than UTF-8: the bytes are still read as UTF-8 (strict, D-068); never a 5xx; nothing written.
  const t = await newTransformation(`QA r9 charset ${lang.toUpperCase()} (synthetic)`);
  const path = `/api/v1/transformations/${t.id}/charter`;
  const auth = await authOf(lead);
  const latin1 = Buffer.concat([b('{"outOfScope":"Synth'), Buffer.from([0xe9]), b('tic"}')]);
  const utf16 = Buffer.from('{"outOfScope":"Synthetic"}', "utf16le");
  const out: string[] = [];
  for (const [label, ct, body] of [
    ["iso-8859-1 byte E9", "application/json; charset=iso-8859-1", latin1],
    ["utf-16le body", "application/json; charset=utf-16", utf16],
  ] as const) {
    const r = await raw(request("POST", path, ct, body, auth, "length"));
    out.push(`${label} -> ${r.status} ${r.text.slice(0, 140)}`);
    expect(r.status, label).toBeGreaterThanOrEqual(400);
    expect(r.status, label).toBeLessThan(500);
    const rid = r.headers["x-request-id"] ?? "";
    if (rid) expect(auditRowsFor(rid)).toBe(0);
  }
  console.log(`QA-R9 [${lang}] R9-06 ${JSON.stringify(out)}`);
  expect((await lead.req.get(path)).status()).toBe(404);
  // and the same charset label with valid UTF-8 bytes is accepted (the parameter never changes the media type)
  const ok = await raw(request("POST", path, "application/json; charset=utf-8", b('{"outOfScope":"Synthétic عينة"}'), auth, "length"));
  expect(ok.status, ok.text).toBe(201);
});

// ---- F-DG2-340 sweep through the UI ------------------------------------------------------------------------------
/** Rewrites the next matching request body: inserts FF FE right after the first occurrence of `marker`. */
async function tamperInvalidUtf8(page: Page, url: string, method: string, marker: string) {
  await page.route(url, async (route) => {
    const req = route.request();
    if (req.method() !== method) return route.continue();
    const text = req.postData() ?? "";
    const at = text.indexOf(marker);
    if (at < 0) return route.continue();
    const bytes = Buffer.from(text, "utf8");
    const cut = Buffer.byteLength(text.slice(0, at + marker.length), "utf8");
    return route.continue({ postData: Buffer.concat([bytes.subarray(0, cut), Buffer.from([0xff, 0xfe]), bytes.subarray(cut)]) });
  });
}

function answersOf(page: Page, pathname: string, method: string) {
  const answers: { status: number; body: string }[] = [];
  page.on("response", async (r) => {
    if (r.request().method() === method && new URL(r.url()).pathname === pathname)
      answers.push({ status: r.status(), body: await r.text().catch(() => "") });
  });
  return answers;
}

/** The message appears exactly once: one role=alert carries it and the page text contains it once. */
async function expectSaidOnce(page: Page, message: string, label: string) {
  const alerts = page.getByRole("alert").filter({ hasText: message });
  await expect(alerts.first()).toBeVisible();
  const count = await alerts.count();
  const text = await page.locator("body").innerText();
  const occurrences = text.split(message).length - 1;
  const allAlerts = await page.getByRole("alert").allInnerTexts();
  console.log(`QA-R9 ${label}: alerts with the message ${count}; occurrences in page text ${occurrences}; all alerts ${JSON.stringify(allAlerts)}`);
  expect(count, `${label}: alerts carrying the message`).toBe(1);
  expect(occurrences, `${label}: occurrences in the page text`).toBe(1);
}

test("R9-05a UI charter: invalid-UTF-8 body -> validation__json said once; nothing saved", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const t = await newTransformation(`QA r9 UI charter once ${lang.toUpperCase()} (synthetic)`);
  const charterPath = `/api/v1/transformations/${t.id}/charter`;
  await signIn(page, lang, "dev.lead");
  const answers = answersOf(page, charterPath, "POST");
  await tamperInvalidUtf8(page, `**${charterPath}`, "POST", "Synthetic ");
  await page.goto(`/transformations/${t.id}/charter`);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill("Synthetic out of scope");
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0]!.status).toBe(400);
  expect((JSON.parse(answers[0]!.body) as Problem).errors).toEqual([expect.objectContaining({ pointer: "", code: "validation.json" })]);
  await expectSaidOnce(page, tr(lang, "problems.validation__json"), `[${lang}] R9-05a charter`);
  expect((await lead.req.get(charterPath)).status()).toBe(404);
  await qaShot(page, lang, "qa-r9-05a-charter-said-once");
  await expectAccessible(page, lang, "qa-r9-charter-said-once");
  expect(foreign).toEqual([]);
});

test("R9-05b UI charter: a field-pointer error stays on its field; a distinct unmapped message is still shown", async ({ page }, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r9 UI charter field ${lang.toUpperCase()} (synthetic)`);
  const charterPath = `/api/v1/transformations/${t.id}/charter`;
  await signIn(page, lang, "dev.lead");
  const answers = answersOf(page, charterPath, "POST");
  // 1st submit: outOfScope rewritten to invisible-only text (server: /outOfScope blank) -> the error is on the field.
  // 2nd submit: an extra property the form has no field for is added -> its message is unmapped (form-level list).
  let mode: "blank" | "extra" = "blank";
  await page.route(`**${charterPath}`, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
    if (mode === "blank") body["outOfScope"] = "‏‏‏";
    else body["qaUnknownProperty"] = "Synthetic";
    return route.continue({ postData: JSON.stringify(body), headers: { ...req.headers(), "content-type": "application/json" } });
  });
  await page.goto(`/transformations/${t.id}/charter`);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  const field = page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope"));
  await field.fill("Synthetic out of scope");
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect.poll(() => answers.length).toBe(1);
  const p1 = JSON.parse(answers[0]!.body) as Problem;
  console.log(`QA-R9 [${lang}] R9-05b server answer 1: ${answers[0]!.status} ${JSON.stringify(p1.errors)}`);
  expect(answers[0]!.status).toBe(400);
  expect(p1.errors.map((e) => e.pointer)).toEqual(["/outOfScope"]);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await field.getAttribute("aria-describedby")) ?? "";
  const fieldMsgs = await Promise.all(describedBy.split(/\s+/).filter(Boolean).map((id) => page.locator(`[id="${id}"]`).innerText().catch(() => "")));
  const fieldMsg = fieldMsgs.join(" | ");
  const formErrors = await page.locator("[data-state='form-errors']").allInnerTexts();
  console.log(`QA-R9 [${lang}] R9-05b field message(s) "${fieldMsg}"; form-errors list ${JSON.stringify(formErrors)}; alerts ${JSON.stringify(await page.getByRole("alert").allInnerTexts())}`);
  expect(fieldMsg.trim().length).toBeGreaterThan(0);
  // the field's own message is not repeated in the form-level list
  for (const m of fieldMsgs.filter((x) => x.trim())) for (const fe of formErrors) expect(fe).not.toContain(m.trim());
  await qaShot(page, lang, "qa-r9-05b-charter-field-pointer");
  await expectAccessible(page, lang, "qa-r9-charter-field-pointer");

  mode = "extra";
  await field.fill("Synthetic out of scope again");
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect.poll(() => answers.length).toBe(2);
  const p2 = JSON.parse(answers[1]!.body) as Problem;
  const alerts = await page.getByRole("alert").allInnerTexts();
  const formErrors2 = await page.locator("[data-state='form-errors']").allInnerTexts();
  const banner = await page.locator("[data-state='error']").allInnerTexts();
  console.log(`QA-R9 [${lang}] R9-05b server answer 2: ${answers[1]!.status} ${JSON.stringify(p2.errors)}; banner ${JSON.stringify(banner)}; form-errors ${JSON.stringify(formErrors2)}`);
  expect(answers[1]!.status).toBe(400);
  if (p2.errors.length > 0 && p2.errors[0]!.pointer !== "") {
    // banner = the generic problem message; the unmapped error = a different message: both must be shown, once each.
    expect(formErrors2.length, "a genuinely different second message is still shown").toBe(1);
    expect(banner.length).toBe(1);
    expect(formErrors2[0]!.trim()).not.toBe(banner[0]!.trim());
  }
  for (const a of alerts) expect(alerts.filter((x) => x === a).length, `alert text repeated: ${a}`).toBe(1);
  // The real server answers an unknown property with pointer "" (validation.unknown_field): that message is said once.
  if (p2.errors.length === 1 && p2.errors[0]!.pointer === "") {
    await expectSaidOnce(page, tr(lang, `problems.${p2.errors[0]!.code.replace(/\./g, "__")}`), `[${lang}] R9-05b unknown_field (real server)`);
  }
  expect((await lead.req.get(charterPath)).status()).toBe(404);
  await qaShot(page, lang, "qa-r9-05b-charter-unknown-field-once");
  await expectAccessible(page, lang, "qa-r9-charter-unknown-field-once");

  // A genuinely different second message. The real server never pairs a pointer-"" error with an error whose pointer
  // maps to no field, so THIS sub-check (only) fulfils the response in the browser with such a problem: the banner says
  // validation__json once, the repeated pointer-"" entry is dropped, and the distinct unmapped message is still listed.
  await page.unroute(`**${charterPath}`);
  await page.route(`**${charterPath}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 400,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "urn:mth:problem:validation",
        title: "Validation failed",
        status: 400,
        code: "validation",
        requestId: "qa-r9-synthetic",
        errors: [
          { pointer: "", code: "validation.json", message: "x" },
          { pointer: "/qaNotAField", code: "validation.too_big", message: "x" },
          { pointer: "", code: "validation.json", message: "x" },
        ],
      }),
    });
  });
  await field.fill("Synthetic out of scope third");
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  const jsonMsg = tr(lang, "problems.validation__json");
  const tooBig = tr(lang, "problems.validation__too_big");
  await expect(page.locator("[data-state='form-errors']")).toHaveCount(1);
  const list = await page.locator("[data-state='form-errors'] li").allInnerTexts();
  const banner3 = await page.locator("[data-state='error']").allInnerTexts();
  console.log(`QA-R9 [${lang}] R9-05b distinct second message (fulfilled problem): banner ${JSON.stringify(banner3)}; form-errors list ${JSON.stringify(list)}`);
  expect(list.map((x) => x.trim())).toEqual([tooBig]);
  expect(banner3.map((x) => x.trim())).toEqual([jsonMsg]);
  await expectSaidOnce(page, jsonMsg, `[${lang}] R9-05b validation__json with a distinct second message`);
  await expectSaidOnce(page, tooBig, `[${lang}] R9-05b distinct second message`);
  await qaShot(page, lang, "qa-r9-05b-charter-distinct-second-message");
  await expectAccessible(page, lang, "qa-r9-charter-distinct-second-message");
});

test("R9-05c UI P1 transformation create: invalid-UTF-8 body -> said once; nothing created", async ({ page }, info) => {
  const lang = langOf(info);
  const name = `Synthetic QA r9 create ${lang} ${Date.now()}`;
  await signIn(page, lang, "dev.lead");
  const answers = answersOf(page, "/api/v1/transformations", "POST");
  await tamperInvalidUtf8(page, "**/api/v1/transformations", "POST", "Synthetic ");
  await page.goto("/transformations/new");
  const bu = page.getByLabel(fieldLabel(lang, "transformations.field.businessUnit"));
  await bu.selectOption({ index: 1 });
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(name);
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0]!.status).toBe(400);
  expect((JSON.parse(answers[0]!.body) as Problem).errors).toEqual([expect.objectContaining({ pointer: "", code: "validation.json" })]);
  await expectSaidOnce(page, tr(lang, "problems.validation__json"), `[${lang}] R9-05c transformation create`);
  await expect(page).toHaveURL(/\/transformations\/new$/);
  expect(Number(sql(`select count(*) from transformation where name like 'Synthetic QA r9 create ${lang}%'`))).toBe(0);
  await qaShot(page, lang, "qa-r9-05c-transformation-create-said-once");
  await expectAccessible(page, lang, "qa-r9-transformation-create-said-once");
});

test("R9-05d UI P1 admin organization create: invalid-UTF-8 body -> said once; nothing created", async ({ page }, info) => {
  const lang = langOf(info);
  const code = `QA9${lang.toUpperCase()}${Date.now().toString().slice(-6)}`;
  await signIn(page, lang, "dev.admin");
  const answers = answersOf(page, "/api/v1/organizations", "POST");
  await tamperInvalidUtf8(page, "**/api/v1/organizations", "POST", "Synthetic ");
  await page.goto("/admin/organizations");
  await page.getByRole("button", { name: tr(lang, "admin.organizations.new") }).or(page.getByRole("link", { name: tr(lang, "admin.organizations.new") })).first().click();
  await page.getByLabel(fieldLabel(lang, "common.field.code")).fill(code);
  await page.getByLabel(fieldLabel(lang, "common.field.nameEn")).fill("Synthetic QA r9 organization");
  await page.getByLabel(fieldLabel(lang, "common.field.nameAr")).fill("منظمة اصطناعية");
  await page.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0]!.status).toBe(400);
  expect((JSON.parse(answers[0]!.body) as Problem).errors).toEqual([expect.objectContaining({ pointer: "", code: "validation.json" })]);
  await expectSaidOnce(page, tr(lang, "problems.validation__json"), `[${lang}] R9-05d organization create`);
  expect(Number(sql(`select count(*) from organization where code = '${code}'`))).toBe(0);
  await qaShot(page, lang, "qa-r9-05d-organization-create-said-once");
  await expectAccessible(page, lang, "qa-r9-organization-create-said-once");
});

test("R9-05e UI ReasonDialog (archive value pool): invalid-UTF-8 body -> said once; nothing archived", async ({ page }, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r9 UI reason ${lang.toUpperCase()} (synthetic)`);
  const poolName = `Synthetic QA r9 pool ${lang}`;
  const pool = await lead.call<{ id: string; version: number }>("POST", `/api/v1/transformations/${t.id}/value-pools`, {
    name: poolName,
    quantificationStatus: "unquantified",
    unquantifiedReason: "Synthetic: not sized yet",
    materiality: "material",
  });
  await signIn(page, lang, "dev.lead");
  const archivePath = `/api/v1/transformations/${t.id}/value-pools/${pool.id}/archive`;
  const answers = answersOf(page, archivePath, "POST");
  await tamperInvalidUtf8(page, `**${archivePath}`, "POST", "Synthetic ");
  await page.goto(`/transformations/${t.id}/diagnose`);
  await page.getByRole("button", { name: rowAction(lang, "common.action.archive", poolName) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "common.form.reason")).fill("Synthetic reason to archive");
  await dialog.getByRole("button", { name: tr(lang, "common.action.archive"), exact: true }).click();
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0]!.status).toBe(400);
  expect((JSON.parse(answers[0]!.body) as Problem).errors).toEqual([expect.objectContaining({ pointer: "", code: "validation.json" })]);
  await expectSaidOnce(page, tr(lang, "problems.validation__json"), `[${lang}] R9-05e reason dialog`);
  const after = await lead.call<{ status: string; version: number; archivedAt: string | null }>(
    "GET",
    `/api/v1/transformations/${t.id}/value-pools/${pool.id}`,
  );
  expect(after.version).toBe(pool.version);
  expect(after.archivedAt ?? null).toBeNull();
  await qaShot(page, lang, "qa-r9-05e-reason-dialog-said-once");
  await expectAccessible(page, lang, "qa-r9-reason-dialog-said-once");
  expect(escape("x")).toBe("x");
});
