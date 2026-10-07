// qa-verifier DG2 round 11 — independent regression of D-071 / T-DG2-BE16 (a response sent before its request body
// arrived closes the connection promptly; bounded shutdown; requestTimeout; unmatched routes rate-limited) on candidate
// 23e6c0a2 (T-DG2-REV-QA-R11). Authored by qa-verifier, NOT by an implementer. Runs in chromium-en and chromium-ar
// against the REAL built API (apps/api/dist/main.js) + PostgreSQL (e2e/support/qa-stack.sh) over raw TCP sockets, and
// inspects the real database (psql) and the real evidence store. No server mocks.
//   QA_SHOT_DIR=<dir> e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-r11.spec.ts --workers=1
//
// R11-01 over-limit uploads (25 MiB + 1 and more) on the shared stack, Content-Length and chunked, fully sent and
//   STALLED (the client never finishes the body and never closes, like the round-10 audit reproduction): exactly one
//   413 evidence.too_large with Connection: close; the SERVER closes the socket within a few seconds (not ~65 s);
//   no evidence_content row, no stored file, no audit row, evidence version unchanged; the stack stays ready.
// R11-02 a SECOND API process from the same build (own port, LOG_LEVEL=info): a stalled over-limit upload (413) plus an
//   idle keep-alive connection, then SIGTERM (main.ts -> app.close()): the process exits 0 promptly and logs "shut down".
//   Then a third process with an under-limit upload stalled IN FLIGHT: SIGTERM exits 0 within the 5 s grace (+ margin)
//   and the server closes the stalled socket.
// R11-03 boundary and normal binary uploads: exactly 25 MiB (200) and 25 MiB + 1 (413); 1 MiB of random bytes + all 256
//   byte values with Content-Length and split chunked framing: 200, downloaded byte-exact, sha256 = DB = Digest, audited.
// R11-04 a keep-alive client keeps its connection after a 200: GET /me, an upload, a JSON create and GET /me again on
//   ONE socket, every response without Connection: close, the socket still open afterwards; a small refusal whose body
//   arrived completely (409 stale If-Match) also keeps the connection.
// R11-05 Arabic/emoji/ZWJ text, cut at every UTF-8 continuation byte over a keep-alive socket, and an Arabic/emoji file
//   name are stored and returned verbatim (API and DB).
// R11-06 a fourth process with RATE_LIMIT_PER_MINUTE=20: a flood on an unmatched route gets 404 then 429 rate_limited
//   (problem+json); then SIGTERM exits 0.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, SYN_RETAIL, apiSession, langOf, type ApiSession } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "default" });

type Problem = { code: string; status: number; detail: string; requestId: string };
type Evidence = { id: string; version: number; currentContentId: string | null; fileName: string | null; title: string; noteBody: string | null };

const MiB = 1024 * 1024;
const LIMIT = 25 * MiB; // apps/api/src/modules/evidence/store.ts EVIDENCE_MAX_BYTES

let lead: ApiSession;
let auth: { cookie: string; csrf: string };
test.beforeAll(async ({ playwright }) => {
  lead = await apiSession(playwright, "dev.lead");
  const state = await lead.req.storageState();
  const me = (await (await lead.req.get("/api/v1/me")).json()) as { csrfToken: string };
  auth = { cookie: state.cookies.map((c) => `${c.name}=${c.value}`).join("; "), csrf: me.csrfToken };
});

// ---- the real database and store (exported by qa-stack.sh) ------------------------------------------------------
function sql(query: string): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url) throw new Error("DATABASE_OWNER_URL not set: run under e2e/support/qa-stack.sh");
  return execFileSync("psql", [url.replace(/\+/g, "%20"), "-qAtX", "-c", query], { encoding: "utf8" }).trim();
}
const safe = (s: string) => {
  if (!/^[0-9A-Za-z._:-]{1,80}$/.test(s)) throw new Error(`unexpected id ${s}`);
  return s;
};
const auditRowsFor = (rid: string) => Number(sql(`select count(*) from audit_event where request_id = '${safe(rid)}'`));
const contentRowsFor = (evidenceId: string) => Number(sql(`select count(*) from evidence_content where evidence_id = '${safe(evidenceId)}'`));
function storedFilesFor(evidenceId: string): string[] {
  const root = process.env["EVIDENCE_STORAGE_PATH"];
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && join(d.parentPath, d.name).includes(evidenceId))
    .map((d) => join(d.parentPath, d.name));
}
const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");
const b = (s: string) => Buffer.from(s, "utf8");

async function newTransformation(name: string): Promise<{ id: string }> {
  return lead.call("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name, mode: "end_to_end" });
}
async function newFileEvidence(transformationId: string, title: string): Promise<Evidence> {
  return lead.call<Evidence>("POST", `/api/v1/transformations/${transformationId}/evidence`, { ownerUserId: lead.userId, kind: "file", title });
}

// ---- raw HTTP/1.1 over a real socket, with timings ---------------------------------------------------------------
type Parsed = { status: number; headers: Record<string, string>; body: Buffer; text: string; json: Problem | null; rest: Buffer };
/** Parses ONE response from the start of `buf` (Content-Length or chunked); null if incomplete. */
function parseOne(buf: Buffer): Parsed | null {
  const i = buf.indexOf("\r\n\r\n");
  if (i < 0) return null;
  const [statusLine = "", ...lines] = buf.subarray(0, i).toString("latin1").split("\r\n");
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const j = line.indexOf(":");
    headers[line.slice(0, j).toLowerCase()] = line.slice(j + 1).trim();
  }
  let rest = buf.subarray(i + 4);
  let body: Buffer;
  if (headers["transfer-encoding"] === "chunked") {
    const out: Buffer[] = [];
    for (;;) {
      const k = rest.indexOf("\r\n");
      if (k < 0) return null;
      const n = parseInt(rest.subarray(0, k).toString("latin1"), 16);
      if (n === 0) {
        if (rest.length < k + 4) return null;
        rest = rest.subarray(k + 4);
        break;
      }
      if (rest.length < k + 2 + n + 2) return null;
      out.push(rest.subarray(k + 2, k + 2 + n));
      rest = rest.subarray(k + 2 + n + 2);
    }
    body = Buffer.concat(out);
  } else {
    const n = Number(headers["content-length"] ?? 0);
    if (rest.length < n) return null;
    body = rest.subarray(0, n);
    rest = rest.subarray(n);
  }
  const text = body.toString("utf8");
  let json: Problem | null = null;
  try {
    json = JSON.parse(text) as Problem;
  } catch {
    json = null;
  }
  return { status: Number(statusLine.split(" ")[1]), headers, body, text, json, rest };
}

/** A client connection that records when the response arrived and when the SERVER ended/closed the socket. */
class Conn {
  readonly socket: Socket;
  readonly t0 = Date.now();
  buf = Buffer.alloc(0);
  responseAt: number | null = null;
  endAt: number | null = null; // server FIN seen
  closeAt: number | null = null;
  writeError: string | null = null;
  constructor(port: number) {
    this.socket = connect(port, "127.0.0.1");
    this.socket.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      if (this.responseAt === null && parseOne(this.buf)) this.responseAt = Date.now();
    });
    this.socket.on("end", () => (this.endAt ??= Date.now()));
    this.socket.on("close", () => (this.closeAt ??= Date.now()));
    this.socket.on("error", (e: NodeJS.ErrnoException) => (this.writeError ??= e.code ?? e.message));
  }
  ready(): Promise<void> {
    return new Promise((r) => (this.socket.readyState === "open" ? r() : this.socket.once("connect", () => r())));
  }
  /** Writes with backpressure; stops (without error) once the socket is gone. */
  async write(data: Buffer, piece = 256 * 1024): Promise<number> {
    let sent = 0;
    for (let at = 0; at < data.length; at += piece) {
      if (this.socket.destroyed || !this.socket.writable) break;
      const ok = this.socket.write(data.subarray(at, at + piece));
      sent += Math.min(piece, data.length - at);
      if (!ok)
        await new Promise<void>((r) => {
          const done = () => {
            this.socket.off("drain", done);
            this.socket.off("close", done);
            r();
          };
          this.socket.on("drain", done);
          this.socket.on("close", done);
        });
    }
    return sent;
  }
  async until(pred: () => boolean, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) return false;
      await new Promise((r) => setTimeout(r, 20));
    }
    return true;
  }
  /** Waits for `n` complete responses (pipelining-free: one at a time). */
  async responses(n: number, ms = 20_000): Promise<Parsed[]> {
    const got: Parsed[] = [];
    let rest = this.buf;
    const end = Date.now() + ms;
    for (;;) {
      got.length = 0;
      rest = this.buf;
      for (let k = 0; k < n; k++) {
        const p = parseOne(rest);
        if (!p) break;
        got.push(p);
        rest = p.rest;
      }
      if (got.length === n) return got;
      if (Date.now() > end || this.closeAt !== null) {
        if (got.length === n) return got;
        throw new Error(`only ${got.length}/${n} responses (closed ${this.closeAt !== null}); raw ${this.buf.toString("latin1").slice(0, 300)}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  destroy() {
    this.socket.destroy();
  }
}

function head(method: string, path: string, origin: string, hdrs: Record<string, string>, withAuth = true): Buffer {
  const u = new URL(origin);
  const h = [`${method} ${path} HTTP/1.1`, `Host: ${u.host}`, `Origin: ${origin}`];
  for (const [k, v] of Object.entries(hdrs)) h.push(`${k}: ${v}`);
  if (withAuth) h.push(`Cookie: ${auth.cookie}`, `X-CSRF-Token: ${auth.csrf}`);
  return Buffer.from(`${h.join("\r\n")}\r\n\r\n`, "latin1");
}
const chunk = (p: Buffer) => Buffer.concat([Buffer.from(`${p.length.toString(16)}\r\n`, "latin1"), p, Buffer.from("\r\n", "latin1")]);
function chunked(body: Buffer, size = 256 * 1024, terminate = true): Buffer {
  const out: Buffer[] = [];
  for (let at = 0; at < body.length; at += size) out.push(chunk(body.subarray(at, at + size)));
  if (terminate) out.push(Buffer.from("0\r\n\r\n", "latin1"));
  return Buffer.concat(out);
}
const portOf = (origin: string) => Number(new URL(origin).port || 80);

// ---- extra API processes from the same build (R11-02, R11-06) ---------------------------------------------------
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}
type Api = { proc: ChildProcess; origin: string; log: () => string; exit: Promise<{ code: number | null; signal: string | null; at: number }> };
async function startApi(extraEnv: Record<string, string> = {}): Promise<Api> {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  let log = "";
  const proc = spawn(process.execPath, ["apps/api/dist/main.js"], {
    env: { ...process.env, PORT: String(port), APP_BASE_URL: origin, LOG_LEVEL: "info", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout!.on("data", (d: Buffer) => (log += d.toString("utf8")));
  proc.stderr!.on("data", (d: Buffer) => (log += d.toString("utf8")));
  const exit = new Promise<{ code: number | null; signal: string | null; at: number }>((r) =>
    proc.once("exit", (code, signal) => r({ code, signal, at: Date.now() })),
  );
  for (let k = 0; k < 150; k++) {
    try {
      const res = await fetch(`${origin}/readyz`);
      if (res.ok) return { proc, origin, log: () => log, exit };
    } catch {
      /* not yet listening */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill("SIGKILL");
  throw new Error(`second API did not become ready: ${log.slice(-2000)}`);
}

/** Starts an over-limit upload and leaves it STALLED: never finishes the body, never closes the client side. */
async function stalledOverLimit(
  origin: string,
  path: string,
  version: number,
  framing: "length" | "chunked",
  sendBytes: number,
  declared?: number,
  opts: { contentType?: string; oneWrite?: boolean; terminate?: boolean } = {},
): Promise<Conn> {
  const c = new Conn(portOf(origin));
  await c.ready();
  const hdrs: Record<string, string> = { "Content-Type": opts.contentType ?? "application/octet-stream", "If-Match": `"${version}"`, "X-File-Name": "qa-r11-over.bin", Connection: "keep-alive" };
  if (framing === "length") hdrs["Content-Length"] = String(declared ?? sendBytes);
  else hdrs["Transfer-Encoding"] = "chunked";
  const body = randomBytes(sendBytes);
  const payload = framing === "length" ? body : chunked(body, 256 * 1024, opts.terminate ?? false);
  if (opts.oneWrite) {
    // Like the round-10 audit reproduction: head + whole body handed to the socket at once, no backpressure handling.
    c.socket.write(Buffer.concat([head("POST", path, origin, hdrs), payload]));
  } else {
    c.socket.write(head("POST", path, origin, hdrs));
    await c.write(payload);
  }
  return c;
}

/**
 * The 413 must close the connection promptly when the body was NOT completely received. When the client had already
 * sent the WHOLE over-limit body (`bodyComplete`), BE16's policy keeps the connection (the body is read and bounded):
 * then the same socket must still SERVE a next request (GET /me 200 within 3 s), i.e. it is not left paused/held.
 */
async function checkRefusal(c: Conn, label: string, status: number, code: string, failures: string[], bodyComplete: boolean): Promise<string> {
  const p = parseOne(c.buf);
  const keptAlive = (p?.headers["connection"] ?? "keep-alive").toLowerCase() !== "close" && c.closeAt === null;
  if (!(bodyComplete && keptAlive)) return checkClosedRefusal(c, label, status, code, failures);
  const issues: string[] = [];
  const statuses = [...c.buf.toString("latin1").matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]));
  if (JSON.stringify(statuses) !== JSON.stringify([status])) issues.push(`statuses ${JSON.stringify(statuses)}`);
  if (!p || p.json?.code !== code) issues.push(`body ${p?.text.slice(0, 200)}`);
  const rid = p?.headers["x-request-id"] ?? "";
  if (rid && auditRowsFor(rid) !== 0) issues.push(`audit rows for ${rid}`);
  const t = Date.now();
  c.socket.write(head("GET", "/api/v1/me", `http://${c.socket.remoteAddress === "127.0.0.1" ? "localhost" : c.socket.remoteAddress}:${c.socket.remotePort}`, { Connection: "keep-alive" }));
  let next: Parsed | undefined;
  try {
    next = (await c.responses(2, 3_000))[1];
  } catch (e) {
    issues.push(`the kept-alive socket did not serve a next request within 3 s: ${(e as Error).message.slice(0, 160)}`);
  }
  if (next && next.status !== 200) issues.push(`next request ${next.status}`);
  if (issues.length) failures.push(`${label}: ${issues.join("; ")}`);
  return `${label} -> ${statuses.join(",")} ${p?.json?.code} Connection: ${p?.headers["connection"] ?? "(none)"} (body fully received: kept alive); next GET /me on the same socket ${next?.status ?? "none"} in ${Date.now() - t} ms`;
}

function checkClosedRefusal(c: Conn, label: string, status: number, code: string, failures: string[]): string {
  const p = parseOne(c.buf);
  const issues: string[] = [];
  const statuses = [...c.buf.toString("latin1").matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]));
  if (JSON.stringify(statuses) !== JSON.stringify([status])) issues.push(`statuses ${JSON.stringify(statuses)}`);
  if (!p || p.json?.code !== code) issues.push(`body ${p?.text.slice(0, 200)}`);
  if ((p?.headers["connection"] ?? "").toLowerCase() !== "close") issues.push(`connection ${p?.headers["connection"]}`);
  if (c.responseAt === null) issues.push("no response");
  if (c.closeAt === null) issues.push("server never closed the socket");
  const closeMs = c.closeAt !== null && c.responseAt !== null ? c.closeAt - c.responseAt : null;
  if (closeMs !== null && closeMs > 3_000) issues.push(`closed ${closeMs} ms after the response (> 3000)`);
  const rid = p?.headers["x-request-id"] ?? "";
  if (rid && auditRowsFor(rid) !== 0) issues.push(`audit rows for ${rid}`);
  if (issues.length) failures.push(`${label}: ${issues.join("; ")}`);
  return `${label} -> ${statuses.join(",")} ${p?.json?.code} Connection: ${p?.headers["connection"]}; server FIN +${c.endAt !== null && c.responseAt !== null ? c.endAt - c.responseAt : "?"} ms, closed +${closeMs ?? "?"} ms after the response (${c.closeAt! - c.t0} ms after connect); client write error ${c.writeError ?? "none"}`;
}

test("R11-01 over-limit uploads (Content-Length, chunked; fully sent and STALLED): 413, the server closes the socket promptly, nothing stored, no audit row", async ({}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r11 over-limit ${lang.toUpperCase()} (synthetic)`);
  const ev = await newFileEvidence(t.id, `QA r11 دليل كبير 🧾 ${lang} (synthetic)`);
  const path = `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`;
  const auditBefore = Number(sql(`select count(*) from audit_event where record_id = '${safe(ev.id)}'`));
  const failures: string[] = [];
  const lines: string[] = [];
  const cases: [string, "length" | "chunked", number, number | undefined, boolean][] = [
    // label, framing, bytes the client sends, declared Content-Length, the client then stays silent and open (stalled)
    ["Content-Length 26 MiB, fully sent", "length", 26 * MiB, undefined, false],
    ["chunked 26 MiB + terminator, fully sent", "chunked", 26 * MiB, undefined, false],
    ["chunked 25 MiB + 64 KiB then STALLED (no terminator, client open)", "chunked", LIMIT + 64 * 1024, undefined, true],
    ["Content-Length 100 MiB declared, 26 MiB sent then STALLED", "length", 26 * MiB, 100 * MiB, true],
    ["Content-Length 25 MiB + 1 declared, 25 MiB + 1 sent", "length", LIMIT + 1, undefined, false],
  ];
  {
    // The round-10 audit reproduction itself: 30 MiB CHUNKED, HTAB spelling, one write without backpressure, the client
    // then waits 8 s without closing. Before BE16 the server held this connection ~65 s.
    const label = "audit repro: 30 MiB chunked 'application/octet-stream\\t; x=1', one write, client waits";
    const c = await stalledOverLimit(BASE, path, ev.version, "chunked", 30 * MiB, undefined, { contentType: "application/octet-stream\t; x=1", oneWrite: true, terminate: true });
    await c.until(() => c.closeAt !== null, 8_000);
    lines.push(await checkRefusal(c, label, 413, "evidence.too_large", failures, false));
    c.destroy();
  }
  for (const [label, framing, sendBytes, declared, stall] of cases) {
    const c = await stalledOverLimit(BASE, path, ev.version, framing, sendBytes, declared);
    if (!stall && framing === "chunked" && !c.socket.destroyed) c.socket.write("0\r\n\r\n");
    // Like the audit reproduction the client waits (8 s) without closing; the server must close well before.
    await c.until(() => c.closeAt !== null, 8_000);
    lines.push(await checkRefusal(c, label, 413, "evidence.too_large", failures, !stall));
    c.destroy();
  }
  const after = await lead.call<Evidence>("GET", `/api/v1/transformations/${t.id}/evidence/${ev.id}`);
  const rows = contentRowsFor(ev.id);
  const files = storedFilesFor(ev.id);
  const auditAfter = Number(sql(`select count(*) from audit_event where record_id = '${safe(ev.id)}'`));
  const ready = (await lead.req.get("/readyz")).status();
  console.log(
    `QA-R11 [${lang}] R11-01 ${JSON.stringify(lines)}; ${failures.length ? "FAILURES " + JSON.stringify(failures) : "all exactly one 413 evidence.too_large; incomplete bodies: Connection: close and server-closed within 3 s; complete bodies: kept alive and the socket serves a next request"}; ` +
      `evidence version ${ev.version}->${after.version}, currentContentId ${after.currentContentId}, content rows ${rows}, stored files ${files.length}, audit rows for the item ${auditBefore}->${auditAfter}; readyz ${ready}`,
  );
  expect(failures).toEqual([]);
  expect(after.version).toBe(ev.version);
  expect(after.currentContentId).toBeNull();
  expect(rows).toBe(0);
  expect(files).toEqual([]);
  expect(auditAfter).toBe(auditBefore);
  expect(ready).toBe(200);
});

test("R11-02 SIGTERM -> app.close() after a stalled over-limit upload is prompt; with an upload stalled IN FLIGHT it is bounded by the grace period", async ({}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r11 shutdown ${lang.toUpperCase()} (synthetic)`);
  const ev = await newFileEvidence(t.id, `QA r11 shutdown ${lang} (synthetic)`);
  const path = `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`;
  const failures: string[] = [];

  // (a) a stalled over-limit chunked upload (413) + an idle keep-alive connection after a 200, then SIGTERM.
  const a = await startApi();
  const idle = new Conn(portOf(a.origin));
  await idle.ready();
  idle.socket.write(head("GET", "/api/v1/me", a.origin, { Connection: "keep-alive" }));
  const [meRes] = await idle.responses(1);
  const over = await stalledOverLimit(a.origin, path, ev.version, "chunked", LIMIT + 64 * 1024);
  await over.until(() => over.responseAt !== null, 10_000);
  const overStatus = parseOne(over.buf)?.status;
  // ... and an over-limit body sent COMPLETELY (25 MiB + 1, Content-Length): its 413 may keep the connection (see
  // checkRefusal); a kept connection is then idle and must not delay the shutdown either.
  const full = await stalledOverLimit(a.origin, path, ev.version, "length", LIMIT + 1);
  await full.until(() => full.responseAt !== null, 10_000);
  const fullRes = parseOne(full.buf);
  const sigA = Date.now();
  a.proc.kill("SIGTERM");
  const exA = await Promise.race([a.exit, new Promise<null>((r) => setTimeout(() => r(null), 20_000))]);
  const msA = exA ? exA.at - sigA : null;
  await over.until(() => over.closeAt !== null, 3_000);
  await idle.until(() => idle.closeAt !== null, 3_000);
  await full.until(() => full.closeAt !== null, 3_000);
  if (meRes?.status !== 200) failures.push(`(a) GET /me ${meRes?.status}`);
  if (overStatus !== 413) failures.push(`(a) over-limit status ${overStatus}`);
  if (fullRes?.status !== 413) failures.push(`(a) fully-sent over-limit status ${fullRes?.status}`);
  if (full.closeAt === null) failures.push("(a) fully-sent over-limit socket still open after the shutdown");
  if (!exA || exA.code !== 0) failures.push(`(a) exit ${JSON.stringify(exA)}`);
  if (msA === null || msA > 3_000) failures.push(`(a) SIGTERM->exit ${msA} ms (> 3000)`);
  if (!/"shut down"/.test(a.log())) failures.push("(a) no 'shut down' log line");
  if (over.closeAt === null || idle.closeAt === null) failures.push(`(a) sockets still open: over ${over.closeAt === null}, idle ${idle.closeAt === null}`);
  const lineA = `(a) GET /me ${meRes?.status} on an idle keep-alive socket + stalled over-limit chunked upload ${overStatus} + fully-sent 25 MiB + 1 upload ${fullRes?.status} (Connection: ${fullRes?.headers["connection"] ?? "(none)"}); SIGTERM -> exit code ${exA?.code} in ${msA} ms; both sockets closed: ${over.closeAt !== null && idle.closeAt !== null}; 'shut down' logged: ${/"shut down"/.test(a.log())}`;
  over.destroy();
  idle.destroy();
  full.destroy();

  // (b) an under-limit upload stalled IN FLIGHT (2 MiB of a declared 10 MiB; no response yet), then SIGTERM.
  const bApi = await startApi();
  const stalled = new Conn(portOf(bApi.origin));
  await stalled.ready();
  stalled.socket.write(
    head("POST", path, bApi.origin, { "Content-Type": "application/octet-stream", "If-Match": `"${ev.version}"`, "X-File-Name": "qa-r11-stall.bin", "Content-Length": String(10 * MiB), Connection: "keep-alive" }),
  );
  await stalled.write(randomBytes(2 * MiB));
  await new Promise((r) => setTimeout(r, 500));
  const respondedBefore = stalled.responseAt !== null;
  const sigB = Date.now();
  bApi.proc.kill("SIGTERM");
  const exB = await Promise.race([bApi.exit, new Promise<null>((r) => setTimeout(() => r(null), 30_000))]);
  const msB = exB ? exB.at - sigB : null;
  await stalled.until(() => stalled.closeAt !== null, 3_000);
  if (respondedBefore) failures.push("(b) the stalled upload was answered before SIGTERM");
  if (!exB || exB.code !== 0) failures.push(`(b) exit ${JSON.stringify(exB)}`);
  if (msB === null || msB > 8_000) failures.push(`(b) SIGTERM->exit ${msB} ms (> 8000; grace 5 s)`);
  if (stalled.closeAt === null) failures.push("(b) stalled socket not closed by the server");
  const graceLogged = /grace period elapsed/.test(bApi.log());
  const lineB = `(b) 2 MiB of a declared 10 MiB upload stalled in flight; SIGTERM -> exit code ${exB?.code} in ${msB} ms; stalled socket closed +${stalled.closeAt !== null ? stalled.closeAt - sigB : "?"} ms after SIGTERM; grace warning logged: ${graceLogged}; response on the stalled socket: ${parseOne(stalled.buf)?.status ?? "none"}`;
  stalled.destroy();
  const rows = contentRowsFor(ev.id);
  const files = storedFilesFor(ev.id);
  if (rows !== 0 || files.length !== 0) failures.push(`content rows ${rows}, stored files ${files.length}`);
  const ready = (await lead.req.get("/readyz")).status();
  console.log(`QA-R11 [${lang}] R11-02 ${lineA}; ${lineB}; content rows ${rows}, stored files ${files.length}; shared stack readyz ${ready}; ${failures.length ? "FAILURES " + JSON.stringify(failures) : "OK"}`);
  expect(failures).toEqual([]);
  expect(ready).toBe(200);
});

test("R11-03 binary uploads: exactly 25 MiB is accepted, 25 MiB + 1 is refused; 1 MiB random + all 256 byte values stored byte-exact, sha256 = DB = Digest, audited", async ({}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r11 binary ${lang.toUpperCase()} (synthetic)`);
  const ev = await newFileEvidence(t.id, `QA r11 binary ${lang} (synthetic)`);
  const path = `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`;
  const all256 = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const revisions: [string, Buffer, "length" | "chunked"][] = [
    ["1 MiB random + all 256 byte values, Content-Length", Buffer.concat([all256, randomBytes(MiB), all256]), "length"],
    ["1 MiB random + all 256 byte values, chunked (odd chunk sizes)", Buffer.concat([randomBytes(MiB), all256, Buffer.from([0x0d, 0x0a, 0x30, 0x0d, 0x0a])]), "chunked"],
    ["exactly 25 MiB, Content-Length", randomBytes(LIMIT), "length"],
  ];
  let version = ev.version;
  const lines: string[] = [];
  for (const [label, bytes, framing] of revisions) {
    const c = new Conn(portOf(BASE));
    await c.ready();
    const hdrs: Record<string, string> = { "Content-Type": "application/octet-stream", "If-Match": `"${version}"`, "X-File-Name": `qa-r11-${lang}.bin`, Connection: "close" };
    if (framing === "length") hdrs["Content-Length"] = String(bytes.length);
    else hdrs["Transfer-Encoding"] = "chunked";
    c.socket.write(head("POST", path, BASE, hdrs));
    await c.write(framing === "length" ? bytes : chunked(bytes, 77_777));
    const [res] = await c.responses(1, 60_000);
    c.destroy();
    expect(res!.status, `${label}: ${res!.text.slice(0, 300)}`).toBe(200);
    const saved = JSON.parse(res!.text) as Evidence;
    expect(saved.version).toBeGreaterThan(version);
    version = saved.version;
    const audits = auditRowsFor(res!.headers["x-request-id"]!);
    const dl = await lead.req.get(path);
    const got = await dl.body();
    const stored = sql(`select sha256 || ' ' || size_bytes from evidence_content where id = '${safe(saved.currentContentId!)}'`);
    expect(dl.status()).toBe(200);
    expect(got.equals(bytes), `${label}: downloaded bytes equal the uploaded bytes`).toBe(true);
    expect(stored).toBe(`${sha(bytes)} ${bytes.length}`);
    expect(dl.headers()["digest"]).toBe(`sha-256=${createHash("sha256").update(bytes).digest("base64")}`);
    expect(audits).toBeGreaterThan(0);
    lines.push(`${label} -> 200 ${bytes.length} B, sha256 ${sha(bytes).slice(0, 12)}… = DB = Digest, downloaded byte-exact, audit ${audits}`);
  }
  // The boundary + 1, chunked: refused, nothing changes.
  const rowsBefore = contentRowsFor(ev.id);
  const c = new Conn(portOf(BASE));
  await c.ready();
  c.socket.write(head("POST", path, BASE, { "Content-Type": "application/octet-stream", "If-Match": `"${version}"`, "X-File-Name": "qa-r11-over.bin", "Transfer-Encoding": "chunked", Connection: "keep-alive" }));
  await c.write(chunked(randomBytes(LIMIT + 1)));
  await c.until(() => c.closeAt !== null, 8_000);
  const failures: string[] = [];
  lines.push(await checkRefusal(c, "25 MiB + 1 chunked (terminated)", 413, "evidence.too_large", failures, true));
  c.destroy();
  const after = await lead.call<Evidence>("GET", `/api/v1/transformations/${t.id}/evidence/${ev.id}`);
  console.log(`QA-R11 [${lang}] R11-03 ${JSON.stringify(lines)}; content rows ${rowsBefore}->${contentRowsFor(ev.id)}; version ${version}->${after.version}; ${failures.length ? "FAILURES " + JSON.stringify(failures) : "OK"}`);
  expect(failures).toEqual([]);
  expect(contentRowsFor(ev.id)).toBe(rowsBefore);
  expect(after.version).toBe(version);
});

test("R11-04/05 one keep-alive socket: 200s keep the connection; Arabic/emoji text cut mid-character and an Arabic file name round-trip verbatim", async ({}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r11 keep-alive ${lang.toUpperCase()} (synthetic)`);
  const ev = await newFileEvidence(t.id, `QA r11 keep-alive ${lang} (synthetic)`);
  const c = new Conn(portOf(BASE));
  await c.ready();
  const steps: string[] = [];
  let seen = 0;
  const next = async (label: string, request: Buffer[], expectStatus: number): Promise<Parsed> => {
    for (const piece of request) {
      c.socket.write(piece);
      await new Promise((r) => setTimeout(r, 2));
    }
    const all = await c.responses(seen + 1);
    seen++;
    const res = all[seen - 1]!;
    steps.push(`${label} -> ${res.status} Connection: ${res.headers["connection"] ?? "(none)"}`);
    expect(res.status, `${label}: ${res.text.slice(0, 300)}`).toBe(expectStatus);
    expect((res.headers["connection"] ?? "keep-alive").toLowerCase(), `${label}: Connection`).not.toBe("close");
    expect(c.closeAt, `${label}: socket still open`).toBeNull();
    return res;
  };
  await next("GET /me", [head("GET", "/api/v1/me", BASE, { Connection: "keep-alive" })], 200);
  // Upload with an Arabic/emoji file name (percent-encoded UTF-8, as the web client sends it).
  const fileName = `ملف ${lang} 👩🏽‍💻 r11.bin`;
  const bytes = Buffer.concat([randomBytes(200_000), Buffer.from(Array.from({ length: 256 }, (_, i) => i))]);
  const up = await next(
    "upload 200 KB (Content-Length)",
    [head("POST", `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`, BASE, { "Content-Type": "application/octet-stream", "If-Match": `"${ev.version}"`, "X-File-Name": encodeURIComponent(fileName), "Content-Length": String(bytes.length), Connection: "keep-alive" }), bytes],
    200,
  );
  const saved = JSON.parse(up.text) as Evidence;
  expect(saved.fileName).toBe(fileName);
  expect(sql(`select file_name from evidence_content where id = '${safe(saved.currentContentId!)}'`)).toBe(fileName);
  // A small refusal whose body arrived completely (stale If-Match): bounded and already read, the connection stays.
  const small = randomBytes(1000);
  const stale = await next(
    "upload with a stale If-Match (409 version_conflict), body complete in one write",
    [Buffer.concat([head("POST", `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`, BASE, { "Content-Type": "application/octet-stream", "If-Match": `"${ev.version}"`, "X-File-Name": "x.bin", "Content-Length": String(small.length), Connection: "keep-alive" }), small])],
    409,
  );
  expect(stale.json?.code).toBe("version_conflict");
  // Arabic/emoji/ZWJ text, chunked at every UTF-8 continuation byte, on the same socket.
  const title = `دليل اصطناعي 🚀 👨‍👩‍👧‍👦 ${lang} ‏(r11) é`;
  const noteBody = `ملاحظة 🇸🇦 Synthétic — نص عربي مع تشكيل: مُحَمَّد ${lang}`;
  const json = b(JSON.stringify({ ownerUserId: lead.userId, kind: "note", title, noteBody }));
  const pieces: Buffer[] = [head("POST", `/api/v1/transformations/${t.id}/evidence`, BASE, { "Content-Type": "application/json; charset=utf-8", "Idempotency-Key": crypto.randomUUID(), "Transfer-Encoding": "chunked", Connection: "keep-alive" })];
  let at = 0;
  for (let i = 1; i <= json.length; i++)
    if (i === json.length || (json[i]! & 0xc0) === 0x80) {
      pieces.push(chunk(json.subarray(at, i)));
      at = i;
    }
  pieces.push(Buffer.from("0\r\n\r\n", "latin1"));
  const created = await next(`JSON create, ${pieces.length - 2} chunks cut at continuation bytes`, pieces, 201);
  const id = (JSON.parse(created.text) as Evidence).id;
  const got = await lead.call<Evidence>("GET", `/api/v1/transformations/${t.id}/evidence/${id}`);
  expect(got.title).toBe(title);
  expect(got.noteBody).toBe(noteBody);
  expect(sql(`select title from evidence where id = '${safe(id)}'`)).toBe(title);
  expect(b(sql(`select note_body from evidence where id = '${safe(id)}'`)).equals(b(noteBody))).toBe(true);
  await next("GET /me again", [head("GET", "/api/v1/me", BASE, { Connection: "keep-alive" })], 200);
  await new Promise((r) => setTimeout(r, 1000));
  const stillOpen = c.closeAt === null && c.endAt === null;
  c.destroy();
  console.log(`QA-R11 [${lang}] R11-04/05 one socket: ${JSON.stringify(steps)}; still open 1 s after the last 200: ${stillOpen}; file name, title and note verbatim (API and DB)`);
  expect(stillOpen).toBe(true);
});

test("R11-06 unmatched routes are rate-limited (RATE_LIMIT_PER_MINUTE=20 on a separate process): 404 then 429 rate_limited; SIGTERM exits 0", async ({}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const api = await startApi({ RATE_LIMIT_PER_MINUTE: "20" });
  const statuses: number[] = [];
  let lastProblem: Problem | null = null;
  let lastType = "";
  for (let k = 0; k < 30; k++) {
    const res = await fetch(`${api.origin}/api/v1/qa-r11-no-such-route-${k}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: api.origin }, body: "{}" });
    statuses.push(res.status);
    lastType = res.headers.get("content-type") ?? "";
    lastProblem = (await res.json()) as Problem;
  }
  const sig = Date.now();
  api.proc.kill("SIGTERM");
  const ex = await Promise.race([api.exit, new Promise<null>((r) => setTimeout(() => r(null), 20_000))]);
  const n404 = statuses.filter((s) => s === 404).length;
  const n429 = statuses.filter((s) => s === 429).length;
  console.log(`QA-R11 [${lang}] R11-06 30 unmatched POSTs: ${n404}x404, ${n429}x429, others ${statuses.filter((s) => s !== 404 && s !== 429)}; last ${lastProblem?.code} (${lastType}); SIGTERM -> exit ${ex?.code} in ${ex ? ex.at - sig : "?"} ms`);
  expect(n404).toBeGreaterThan(0);
  expect(n404).toBeLessThanOrEqual(20);
  expect(n429).toBe(30 - n404);
  expect(lastProblem?.code).toBe("rate_limited");
  expect(lastType).toMatch(/^application\/problem\+json/);
  expect(ex?.code).toBe(0);
});
