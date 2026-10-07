// qa-verifier DG2 round 12 — independent regression of D-072 / T-DG2-BE17 (three-phase evidence upload: checks, body
// received with NO database connection held, short write transaction re-checking If-Match; bounded pool; incomplete
// request bodies are the declared 400 on every route) and of F-DG2-430 / T-DG2-FE9 (the Team assign dialog's role
// preview, now reported from an effect) on candidate 5dfecce4 (T-DG2-REV-QA-R12). Authored by qa-verifier, NOT by an
// implementer. Runs in chromium-en and chromium-ar against the REAL built API (apps/api/dist/main.js) + PostgreSQL
// (e2e/support/qa-stack.sh), over raw TCP sockets, and inspects the real database (psql) and the real evidence store.
// No server mocks.
//   QA_SHOT_DIR=<dir> e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-r12.spec.ts --workers=1
//
// R12-01 the item is edited (PATCH) or archived WHILE the upload body streams: the edit is not blocked (< 2 s; no row
//   lock is held during the body); the completed upload gets 409 version_conflict; nothing is stored (no content row,
//   no final or .part file), no audit row for the upload, the item keeps the edit. Two uploads racing with the same
//   If-Match: exactly one 200 and one 409, one content row.
// R12-02 25 stalled uploads (more than the API pool's 20 connections) do not block other users or /readyz: while they
//   stall, no mth-api session is "idle in transaction", /readyz, another user's GET /me and JSON write, and a PATCH of
//   the very item being uploaded each answer within 2 s. Then 3 of them complete (stale If-Match: 409) and the rest
//   are dropped by the client: nothing is stored, no .part file is left.
// R12-03 a SEPARATE API process (LOG_LEVEL=info): aborted JSON bodies (Content-Length and chunked, create and PATCH) and
//   aborted octet-stream uploads: no 500 and no error-level (>= 50) log line; nothing created or stored; the process
//   stays ready and exits 0 on SIGTERM.
// R12-04 normal binary uploads (Content-Length, odd-size chunked, and a SLOW body sent over ~3 s) are stored byte-exact:
//   sha256 = DB = Digest, audited, no .part file left.
// R12-05 Arabic/emoji/ZWJ text cut at every UTF-8 continuation byte, an Arabic PATCH, and an Arabic/emoji file name
//   round-trip verbatim (API and DB).
// R12-06 (UI) the Team assign dialog's role-accountability preview follows the Role select through every assignable
//   role and back, in the page language (text = GET /role-accountabilities), EN LTR and AR RTL; the dialog is
//   cancelled, nothing is assigned.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, SYN_RETAIL, apiSession, fieldLabel, langOf, rowAction, signIn, shot, tr, type ApiSession } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "default" });

type Problem = { code: string; status: number; detail: string; requestId: string };
type Evidence = { id: string; version: number; currentContentId: string | null; fileName: string | null; title: string; noteBody: string | null; status?: string };

const MiB = 1024 * 1024;

let lead: ApiSession;
let office: ApiSession;
let auth: { cookie: string; csrf: string };
test.beforeAll(async ({ playwright }) => {
  lead = await apiSession(playwright, "dev.lead");
  office = await apiSession(playwright, "dev.office");
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
/** As the cluster superuser (the owner URL without its `-c role=` option): pg_stat_activity shows every session's state. */
function sqlSuper(query: string): string {
  const url = new URL(process.env["DATABASE_OWNER_URL"]!.replace(/\+/g, "%20"));
  url.searchParams.delete("options");
  return execFileSync("psql", [url.toString(), "-qAtX", "-c", query], { encoding: "utf8" }).trim();
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newTransformation(name: string): Promise<{ id: string }> {
  return lead.call("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name, mode: "end_to_end" });
}
async function newFileEvidence(transformationId: string, title: string): Promise<Evidence> {
  return lead.call<Evidence>("POST", `/api/v1/transformations/${transformationId}/evidence`, { ownerUserId: lead.userId, kind: "file", title });
}
async function timed<T>(f: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const v = await f();
  return [v, Date.now() - t];
}

// ---- raw HTTP/1.1 over a real socket ------------------------------------------------------------------------------
type Parsed = { status: number; headers: Record<string, string>; body: Buffer; text: string; json: Problem | null; rest: Buffer };
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

class Conn {
  readonly socket: Socket;
  buf = Buffer.alloc(0);
  responseAt: number | null = null;
  closeAt: number | null = null;
  constructor(port: number) {
    this.socket = connect(port, "127.0.0.1");
    this.socket.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      if (this.responseAt === null && parseOne(this.buf)) this.responseAt = Date.now();
    });
    this.socket.on("close", () => (this.closeAt ??= Date.now()));
    this.socket.on("error", () => undefined);
  }
  ready(): Promise<void> {
    return new Promise((r) => (this.socket.readyState === "open" ? r() : this.socket.once("connect", () => r())));
  }
  async write(data: Buffer, piece = 256 * 1024): Promise<void> {
    for (let at = 0; at < data.length; at += piece) {
      if (this.socket.destroyed || !this.socket.writable) break;
      if (!this.socket.write(data.subarray(at, at + piece)))
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
  }
  async response(ms = 30_000): Promise<Parsed> {
    const end = Date.now() + ms;
    for (;;) {
      const p = parseOne(this.buf);
      if (p) return p;
      if (Date.now() > end || this.closeAt !== null) throw new Error(`no response (closed ${this.closeAt !== null}); raw ${this.buf.toString("latin1").slice(0, 300)}`);
      await sleep(20);
    }
  }
  destroy() {
    this.socket.destroy();
  }
}
function head(method: string, path: string, origin: string, hdrs: Record<string, string>): Buffer {
  const u = new URL(origin);
  const h = [`${method} ${path} HTTP/1.1`, `Host: ${u.host}`, `Origin: ${origin}`];
  for (const [k, v] of Object.entries(hdrs)) h.push(`${k}: ${v}`);
  h.push(`Cookie: ${auth.cookie}`, `X-CSRF-Token: ${auth.csrf}`);
  return Buffer.from(`${h.join("\r\n")}\r\n\r\n`, "latin1");
}
const chunk = (p: Buffer) => Buffer.concat([Buffer.from(`${p.length.toString(16)}\r\n`, "latin1"), p, Buffer.from("\r\n", "latin1")]);
function chunked(body: Buffer, size: number, terminate = true): Buffer {
  const out: Buffer[] = [];
  for (let at = 0; at < body.length; at += size) out.push(chunk(body.subarray(at, at + size)));
  if (terminate) out.push(Buffer.from("0\r\n\r\n", "latin1"));
  return Buffer.concat(out);
}
const portOf = (origin: string) => Number(new URL(origin).port || 80);
const uploadHeaders = (version: number, extra: Record<string, string> = {}) => ({
  "Content-Type": "application/octet-stream",
  "If-Match": `"${version}"`,
  "X-File-Name": "qa-r12.bin",
  Connection: "keep-alive",
  ...extra,
});

// ---- a separate API process from the same build (R12-03) --------------------------------------------------------
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
type Api = { proc: ChildProcess; origin: string; log: () => string; exit: Promise<{ code: number | null; at: number }> };
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
  const exit = new Promise<{ code: number | null; at: number }>((r) => proc.once("exit", (code) => r({ code, at: Date.now() })));
  for (let k = 0; k < 150; k++) {
    try {
      if ((await fetch(`${origin}/readyz`)).ok) return { proc, origin, log: () => log, exit };
    } catch {
      /* not yet listening */
    }
    await sleep(100);
  }
  proc.kill("SIGKILL");
  throw new Error(`second API did not become ready: ${log.slice(-2000)}`);
}
type LogLine = { level?: number; msg?: string; reqId?: string; res?: { statusCode?: number }; err?: { message?: string; code?: string } };
function logLines(text: string): LogLine[] {
  const out: LogLine[] = [];
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l) as LogLine);
    } catch {
      out.push({ level: 60, msg: `NON-JSON LOG LINE: ${l.slice(0, 200)}` });
    }
  }
  return out;
}

// =================================================================================================================
test("R12-01 the item edited or archived during the upload body: the edit is not blocked, the upload gets 409, nothing is stored; a same-If-Match race has exactly one winner", async ({}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r12 edit-during-body ${lang.toUpperCase()} (synthetic)`);
  const base = `/api/v1/transformations/${t.id}/evidence`;
  const lines: string[] = [];

  for (const [label, framing, interfere] of [
    ["PATCH title during a Content-Length body", "length", "patch"],
    ["PATCH title during a chunked body", "chunked", "patch"],
    ["archive during a Content-Length body", "length", "archive"],
  ] as const) {
    const ev = await newFileEvidence(t.id, `QA r12 ${label} ${lang} (synthetic)`);
    const path = `${base}/${ev.id}/content`;
    const bytes = randomBytes(4 * MiB);
    const c = new Conn(portOf(BASE));
    await c.ready();
    const hdrs = uploadHeaders(ev.version, framing === "length" ? { "Content-Length": String(bytes.length) } : { "Transfer-Encoding": "chunked" });
    c.socket.write(head("POST", path, BASE, hdrs));
    const wire = framing === "length" ? bytes : chunked(bytes, 99_999);
    await c.write(wire.subarray(0, MiB));
    await sleep(400);
    const answeredEarly = c.responseAt !== null;
    // The concurrent edit (another request) while the body is still streaming.
    const newTitle = `QA r12 تعديل أثناء الرفع ✍️ ${lang} (synthetic)`;
    const [edited, editMs] = await timed(() =>
      interfere === "patch"
        ? lead.call<Evidence>("PATCH", `${base}/${ev.id}`, { title: newTitle }, { ifMatch: ev.version })
        : lead.call<Evidence>("POST", `${base}/${ev.id}/archive`, { reason: "Synthetic: archived during an upload (QA r12)" }, { ifMatch: ev.version }),
    );
    const editedWhileOpen = c.responseAt === null && c.closeAt === null;
    await c.write(wire.subarray(MiB));
    const res = await c.response();
    await sleep(300);
    c.destroy();
    const rid = res.headers["x-request-id"] ?? "";
    const after = await lead.call<Evidence>("GET", `${base}/${ev.id}`);
    const rows = contentRowsFor(ev.id);
    const files = storedFilesFor(ev.id);
    const audits = rid ? auditRowsFor(rid) : -1;
    lines.push(
      `${label}: answered before the body finished ${answeredEarly}; edit ${interfere} -> v${edited.version} in ${editMs} ms while the upload was open ${editedWhileOpen}; upload -> ${res.status} ${res.json?.code} (Connection: ${res.headers["connection"] ?? "(none)"}); item v${ev.version}->v${after.version} status ${after.status ?? "?"} title kept ${after.title === (interfere === "patch" ? newTitle : ev.title)} currentContentId ${after.currentContentId}; content rows ${rows}; stored files ${files.length}; audit rows for the upload ${audits}`,
    );
    expect(answeredEarly, label).toBe(false);
    expect(editedWhileOpen, label).toBe(true);
    expect(editMs, `${label}: the edit was not blocked by the upload`).toBeLessThan(2_000);
    expect(res.status, `${label}: ${res.text.slice(0, 300)}`).toBe(409);
    expect(res.json?.code).toBe("version_conflict");
    expect(after.version).toBe(edited.version);
    expect(after.currentContentId).toBeNull();
    if (interfere === "patch") expect(after.title).toBe(newTitle);
    expect(rows).toBe(0);
    expect(files).toEqual([]);
    expect(audits).toBe(0);
  }

  // Two uploads with the same If-Match, bodies interleaved, finishing together: exactly one winner.
  const ev = await newFileEvidence(t.id, `QA r12 race ${lang} (synthetic)`);
  const path = `${base}/${ev.id}/content`;
  const A = randomBytes(2 * MiB);
  const B = randomBytes(2 * MiB);
  const ca = new Conn(portOf(BASE));
  const cb = new Conn(portOf(BASE));
  await Promise.all([ca.ready(), cb.ready()]);
  ca.socket.write(head("POST", path, BASE, uploadHeaders(ev.version, { "Content-Length": String(A.length), "X-File-Name": "race-a.bin" })));
  cb.socket.write(head("POST", path, BASE, uploadHeaders(ev.version, { "Content-Length": String(B.length), "X-File-Name": "race-b.bin" })));
  await ca.write(A.subarray(0, MiB));
  await cb.write(B.subarray(0, MiB));
  await sleep(200);
  await Promise.all([ca.write(A.subarray(MiB)), cb.write(B.subarray(MiB))]);
  const [ra, rb] = await Promise.all([ca.response(), cb.response()]);
  ca.destroy();
  cb.destroy();
  const statuses = [ra.status, rb.status].sort();
  const after = await lead.call<Evidence>("GET", `${base}/${ev.id}`);
  const winner = ra.status === 200 ? A : B;
  const dl = await (await lead.req.get(path)).body();
  const rows = contentRowsFor(ev.id);
  const files = storedFilesFor(ev.id);
  lines.push(`race (same If-Match "${ev.version}"): statuses ${statuses.join(",")} (${[ra, rb].map((r) => r.json?.code ?? "ok").join(",")}); content rows ${rows}; stored files ${files.length} (${files.filter((f) => f.endsWith(".part")).length} .part); item v${ev.version}->v${after.version}; download = winner's bytes ${dl.equals(winner)}`);
  console.log(`QA-R12 [${lang}] R12-01 ${JSON.stringify(lines)}`);
  expect(statuses).toEqual([200, 409]);
  expect([ra, rb].find((r) => r.status === 409)?.json?.code).toBe("version_conflict");
  expect(rows).toBe(1);
  expect(files.length).toBe(1);
  expect(files.some((f) => f.endsWith(".part"))).toBe(false);
  expect(after.version).toBe(ev.version + 1);
  expect(dl.equals(winner)).toBe(true);
});

// =================================================================================================================
test("R12-02 25 stalled uploads (pool max 20) do not block other users, /readyz or an edit of the same item; no session idles in a transaction; nothing is stored", async ({}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r12 stalled ${lang.toUpperCase()} (synthetic)`);
  const base = `/api/v1/transformations/${t.id}/evidence`;
  const ev = await newFileEvidence(t.id, `QA r12 stalled ${lang} (synthetic)`);
  const path = `${base}/${ev.id}/content`;
  const N = 25;
  const conns: Conn[] = [];
  for (let k = 0; k < N; k++) {
    const c = new Conn(portOf(BASE));
    await c.ready();
    c.socket.write(head("POST", path, BASE, uploadHeaders(ev.version, { "Content-Length": String(10 * MiB), "X-File-Name": `stall-${k}.bin` })));
    await c.write(randomBytes(64 * 1024));
    conns.push(c);
  }
  await sleep(1_000);
  const answered = conns.filter((c) => c.responseAt !== null).length;
  const whoami = sqlSuper("select current_user || ' superuser=' || (select rolsuper from pg_roles where rolname = current_user)");
  const sessions = sqlSuper(
    "select coalesce(string_agg(state || ':' || n, ' '), 'none') from (select coalesce(state, '?') as state, count(*) as n from pg_stat_activity where application_name = 'mth-api' group by 1 order by 1) s",
  );
  const unknownState = Number(sqlSuper("select count(*) from pg_stat_activity where application_name = 'mth-api' and state is null"));
  const idleInTx = Number(sqlSuper("select count(*) from pg_stat_activity where application_name = 'mth-api' and state like 'idle in transaction%'"));
  const openSockets = conns.filter((c) => c.closeAt === null).length;
  // Positive control for the probe: a psql session named mth-api that opens a transaction and then idles in it.
  const ctlUrl = new URL(process.env["DATABASE_OWNER_URL"]!.replace(/\+/g, "%20"));
  ctlUrl.searchParams.delete("options"); // URLSearchParams re-encodes spaces as '+', which libpq would read literally
  ctlUrl.searchParams.set("application_name", "mth-api");
  const ctl = spawn("psql", [ctlUrl.toString(), "-qAtX"], { stdio: ["pipe", "ignore", "pipe"] });
  let ctlErr = "";
  ctl.stderr!.on("data", (d: Buffer) => (ctlErr += d.toString("utf8")));
  const ctlExit = new Promise<number | null>((r) => ctl.once("exit", (code) => r(code)));
  ctl.stdin!.write("begin;\nselect 1;\n");
  let controlSeen = 0;
  for (let k = 0; k < 50 && controlSeen === 0; k++) {
    await sleep(100);
    controlSeen = Number(sqlSuper("select count(*) from pg_stat_activity where application_name = 'mth-api' and state like 'idle in transaction%'"));
  }
  ctl.stdin!.end("rollback;\n");
  const ctlCode = await Promise.race([ctlExit, sleep(5_000).then(() => "no exit")]);
  if (ctlCode === "no exit") ctl.kill("SIGKILL");
  if (ctlErr) console.log(`QA-R12 [${lang}] R12-02 control psql stderr: ${ctlErr.slice(0, 300)}`);
  const [ready, readyMs] = await timed(async () => (await fetch(`${BASE}/readyz`)).status);
  const [me, meMs] = await timed(async () => (await office.req.get("/api/v1/me")).status());
  const [note, noteMs] = await timed(() =>
    lead.call<Evidence>("POST", base, { ownerUserId: lead.userId, kind: "note", title: `QA r12 note while 25 uploads stall ${lang} (synthetic)`, noteBody: "synthetic" }),
  );
  const [edited, editMs] = await timed(() => lead.call<Evidence>("PATCH", `${base}/${ev.id}`, { title: `QA r12 edited while stalled ${lang} (synthetic)` }, { ifMatch: ev.version }));
  // 3 stalled uploads now complete (their If-Match is stale after the edit): 409 each; the others are dropped.
  const finishing = conns.slice(0, 3);
  await Promise.all(finishing.map((c) => c.write(randomBytes(10 * MiB - 64 * 1024))));
  const finished = await Promise.all(finishing.map((c) => c.response()));
  for (const c of conns) c.destroy();
  await sleep(1_500);
  const rows = contentRowsFor(ev.id);
  const files = storedFilesFor(ev.id);
  const after = await lead.call<Evidence>("GET", `${base}/${ev.id}`);
  const readyAfter = (await fetch(`${BASE}/readyz`)).status;
  console.log(
    `QA-R12 [${lang}] R12-02 ${N} uploads stalled (64 KiB of 10 MiB each; API pool max 20): answered while stalled ${answered}; client sockets still open ${openSockets}; pg_stat_activity read as ${whoami}: mth-api sessions ${sessions} (state unknown ${unknownState}); idle in transaction ${idleInTx} (positive control, a psql session idling in a transaction: detected ${controlSeen}, psql exit ${ctlCode}); ` +
      `/readyz ${ready} in ${readyMs} ms; dev.office GET /me ${me} in ${meMs} ms; dev.lead JSON create ${note.id ? 201 : "?"} in ${noteMs} ms; PATCH of the uploading item -> v${edited.version} in ${editMs} ms; ` +
      `3 completed uploads -> ${finished.map((r) => `${r.status} ${r.json?.code}`).join(", ")}; others dropped by the client; content rows ${rows}; stored files ${files.length}; item v${after.version} currentContentId ${after.currentContentId}; /readyz after ${readyAfter}`,
  );
  expect(answered).toBe(0);
  expect(openSockets).toBe(N);
  expect(whoami).toMatch(/superuser=(t|true)$/);
  expect(unknownState).toBe(0);
  expect(idleInTx).toBe(0);
  expect(controlSeen).toBe(1);
  expect(ready).toBe(200);
  expect(readyMs).toBeLessThan(2_000);
  expect(me).toBe(200);
  expect(meMs).toBeLessThan(2_000);
  expect(noteMs).toBeLessThan(2_000);
  expect(editMs).toBeLessThan(2_000);
  expect(finished.map((r) => r.status)).toEqual([409, 409, 409]);
  expect(finished.every((r) => r.json?.code === "version_conflict")).toBe(true);
  expect(rows).toBe(0);
  expect(files).toEqual([]);
  expect(after.currentContentId).toBeNull();
  expect(readyAfter).toBe(200);
});

// =================================================================================================================
test("R12-03 aborted JSON bodies and aborted uploads on a separate API process: no 500, no error-level log, nothing created or stored; SIGTERM exits 0", async ({}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r12 aborted ${lang.toUpperCase()} (synthetic)`);
  const base = `/api/v1/transformations/${t.id}/evidence`;
  const ev = await newFileEvidence(t.id, `QA r12 aborted ${lang} (synthetic)`);
  const api = await startApi();
  const evidenceBefore = Number(sql(`select count(*) from evidence where transformation_id = '${safe(t.id)}'`));
  const json = b(JSON.stringify({ ownerUserId: lead.userId, kind: "note", title: `ملاحظة مقطوعة 🚧 ${lang} (synthetic)`, noteBody: "x".repeat(400) }));
  const patchJson = b(JSON.stringify({ title: `عنوان مقطوع ${lang} (synthetic)` }));
  const cases: [string, string, string, Record<string, string>, Buffer][] = [
    ["JSON create, Content-Length, half sent", "POST", base, { "Content-Type": "application/json; charset=utf-8", "Idempotency-Key": crypto.randomUUID(), "Content-Length": String(json.length) }, json.subarray(0, 60)],
    ["JSON create, chunked, no terminator", "POST", base, { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "Transfer-Encoding": "chunked" }, chunked(json.subarray(0, 70), 33, false)],
    ["JSON create, cut inside an Arabic character", "POST", base, { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "Content-Length": String(json.length) }, json.subarray(0, json.indexOf(b("ملاحظة")) + 1)],
    ["JSON PATCH, Content-Length, half sent", "PATCH", `${base}/${ev.id}`, { "Content-Type": "application/json", "If-Match": `"${ev.version}"`, "Content-Length": String(patchJson.length) }, patchJson.subarray(0, 10)],
    ["upload, Content-Length 5 MiB, 1 MiB sent", "POST", `${base}/${ev.id}/content`, uploadHeaders(ev.version, { "Content-Length": String(5 * MiB) }), randomBytes(MiB)],
    ["upload, chunked, no terminator", "POST", `${base}/${ev.id}/content`, uploadHeaders(ev.version, { "Transfer-Encoding": "chunked" }), chunked(randomBytes(MiB), 65_536, false)],
  ];
  const lines: string[] = [];
  for (const [label, method, path, hdrs, sent] of cases) {
    const c = new Conn(portOf(api.origin));
    await c.ready();
    c.socket.write(head(method, path, api.origin, hdrs));
    await c.write(sent);
    await sleep(500);
    const early = parseOne(c.buf);
    c.destroy(); // the client goes away mid-body
    await sleep(300);
    lines.push(`${label}: response before the abort ${early ? early.status : "none"}`);
  }
  await sleep(1_500);
  const readyz = (await fetch(`${api.origin}/readyz`)).status;
  const sig = Date.now();
  api.proc.kill("SIGTERM");
  const ex = await Promise.race([api.exit, sleep(20_000).then(() => null)]);
  const all = logLines(api.log());
  const errors = all.filter((l) => (l.level ?? 0) >= 50 || l.msg === "unhandled error");
  const fiveHundreds = all.filter((l) => (l.res?.statusCode ?? 0) >= 500);
  const incomplete = all.filter((l) => l.msg === "request body not received completely");
  const completedStatuses = all.filter((l) => l.res?.statusCode !== undefined && l.msg === "request completed").map((l) => l.res!.statusCode);
  const levels = [...new Set(incomplete.map((l) => l.level))];
  const evidenceAfter = Number(sql(`select count(*) from evidence where transformation_id = '${safe(t.id)}'`));
  const after = await lead.call<Evidence>("GET", `${base}/${ev.id}`);
  const rows = contentRowsFor(ev.id);
  const files = storedFilesFor(ev.id);
  console.log(
    `QA-R12 [${lang}] R12-03 ${JSON.stringify(lines)}; log lines ${all.length}; error-level (>=50) or 'unhandled error' ${errors.length}${errors.length ? " " + JSON.stringify(errors.slice(0, 3)) : ""}; ` +
      `responses >= 500 ${fiveHundreds.length}; 'request body not received completely' lines ${incomplete.length} at level(s) ${levels.join(",")}; logged response statuses ${JSON.stringify(completedStatuses)}; ` +
      `evidence rows in the transformation ${evidenceBefore}->${evidenceAfter}; item v${ev.version}->v${after.version} title unchanged ${after.title === ev.title}; content rows ${rows}; stored files ${files.length}; readyz ${readyz}; SIGTERM -> exit ${ex?.code} in ${ex ? ex.at - sig : "?"} ms`,
  );
  expect(lines.every((l) => l.endsWith("none"))).toBe(true);
  expect(errors).toEqual([]);
  expect(fiveHundreds).toEqual([]);
  expect(incomplete.length).toBeGreaterThanOrEqual(1);
  expect(incomplete.every((l) => (l.level ?? 99) < 50)).toBe(true);
  expect(completedStatuses.every((s) => s !== undefined && s < 500)).toBe(true);
  expect(evidenceAfter).toBe(evidenceBefore);
  expect(after.version).toBe(ev.version);
  expect(after.title).toBe(ev.title);
  expect(rows).toBe(0);
  expect(files).toEqual([]);
  expect(readyz).toBe(200);
  expect(ex?.code).toBe(0);
});

// =================================================================================================================
test("R12-04 binary uploads (Content-Length, odd-size chunked, slow body over ~3 s) are stored byte-exact: sha256 = DB = Digest, audited, no .part left", async ({}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r12 binary ${lang.toUpperCase()} (synthetic)`);
  const ev = await newFileEvidence(t.id, `QA r12 binary ${lang} (synthetic)`);
  const path = `/api/v1/transformations/${t.id}/evidence/${ev.id}/content`;
  const all256 = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  let version = ev.version;
  const lines: string[] = [];
  for (const [label, bytes, mode] of [
    ["3 MiB random + all 256 byte values, Content-Length", Buffer.concat([all256, randomBytes(3 * MiB), all256]), "length"],
    ["1 MiB + CRLF/0-CRLF lookalikes, chunked 77 777-byte pieces", Buffer.concat([randomBytes(MiB), all256, Buffer.from("\r\n0\r\n\r\n", "latin1")]), "chunked"],
    ["512 KiB sent in 16 pieces over ~3 s (slow body)", Buffer.concat([randomBytes(512 * 1024), all256]), "slow"],
  ] as const) {
    const c = new Conn(portOf(BASE));
    await c.ready();
    const hdrs = uploadHeaders(version, mode === "chunked" ? { "Transfer-Encoding": "chunked", "X-File-Name": `qa-r12-${lang}.bin` } : { "Content-Length": String(bytes.length), "X-File-Name": `qa-r12-${lang}.bin` });
    c.socket.write(head("POST", path, BASE, hdrs));
    const t0 = Date.now();
    if (mode === "chunked") await c.write(chunked(bytes, 77_777));
    else if (mode === "slow") {
      const piece = Math.ceil(bytes.length / 16);
      for (let at = 0; at < bytes.length; at += piece) {
        await c.write(bytes.subarray(at, at + piece));
        await sleep(200);
      }
    } else await c.write(bytes);
    const res = await c.response(60_000);
    const ms = Date.now() - t0;
    c.destroy();
    expect(res.status, `${label}: ${res.text.slice(0, 300)}`).toBe(200);
    const saved = JSON.parse(res.text) as Evidence;
    expect(saved.version).toBe(version + 1);
    version = saved.version;
    const audits = auditRowsFor(res.headers["x-request-id"]!);
    const dl = await lead.req.get(path);
    const got = await dl.body();
    const stored = sql(`select sha256 || ' ' || size_bytes from evidence_content where id = '${safe(saved.currentContentId!)}'`);
    const files = storedFilesFor(ev.id);
    lines.push(`${label} -> 200 in ${ms} ms, ${bytes.length} B, sha256 ${sha(bytes).slice(0, 16)}… DB ${stored.slice(0, 16)}… Digest ${dl.headers()["digest"]?.slice(0, 20)}…; byte-exact ${got.equals(bytes)}; audit ${audits}; files ${files.length} (.part ${files.filter((f) => f.endsWith(".part")).length})`);
    expect(dl.status()).toBe(200);
    expect(got.equals(bytes)).toBe(true);
    expect(stored).toBe(`${sha(bytes)} ${bytes.length}`);
    expect(dl.headers()["digest"]).toBe(`sha-256=${createHash("sha256").update(bytes).digest("base64")}`);
    expect(audits).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith(".part"))).toBe(false);
  }
  expect(contentRowsFor(ev.id)).toBe(3);
  console.log(`QA-R12 [${lang}] R12-04 ${JSON.stringify(lines)}; content rows ${contentRowsFor(ev.id)}`);
});

// =================================================================================================================
test("R12-05 Arabic/emoji/ZWJ text cut at every UTF-8 continuation byte, an Arabic PATCH and an Arabic/emoji file name round-trip verbatim", async ({}, info) => {
  test.setTimeout(60_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r12 unicode ${lang.toUpperCase()} (synthetic)`);
  const base = `/api/v1/transformations/${t.id}/evidence`;
  const title = `دليل اصطناعي 🚀 👨‍👩‍👧‍👦 ${lang} ‏(r12) é`;
  const noteBody = `ملاحظة 🇸🇦 Synthétic — نص عربي مع تشكيل: مُحَمَّد ${lang}`;
  const json = b(JSON.stringify({ ownerUserId: lead.userId, kind: "note", title, noteBody }));
  const c = new Conn(portOf(BASE));
  await c.ready();
  c.socket.write(head("POST", base, BASE, { "Content-Type": "application/json; charset=utf-8", "Idempotency-Key": crypto.randomUUID(), "Transfer-Encoding": "chunked", Connection: "close" }));
  let at = 0;
  let pieces = 0;
  for (let i = 1; i <= json.length; i++)
    if (i === json.length || (json[i]! & 0xc0) === 0x80) {
      c.socket.write(chunk(json.subarray(at, i)));
      pieces++;
      at = i;
      await sleep(1);
    }
  c.socket.write("0\r\n\r\n");
  const res = await c.response();
  c.destroy();
  expect(res.status, res.text.slice(0, 300)).toBe(201);
  const id = (JSON.parse(res.text) as Evidence).id;
  const got = await lead.call<Evidence>("GET", `${base}/${id}`);
  expect(got.title).toBe(title);
  expect(got.noteBody).toBe(noteBody);
  expect(sql(`select title from evidence where id = '${safe(id)}'`)).toBe(title);
  expect(b(sql(`select note_body from evidence where id = '${safe(id)}'`)).equals(b(noteBody))).toBe(true);
  const newTitle = `عنوان مُعدَّل 🧾‍ ${lang} — ✓ (synthetic)`;
  const patched = await lead.call<Evidence>("PATCH", `${base}/${id}`, { title: newTitle }, { ifMatch: got.version });
  expect(patched.title).toBe(newTitle);
  expect(sql(`select title from evidence where id = '${safe(id)}'`)).toBe(newTitle);
  const fev = await newFileEvidence(t.id, `QA r12 file name ${lang} (synthetic)`);
  const fileName = `ملف ${lang} 👩🏽‍💻 r12.bin`;
  const bytes = randomBytes(10_000);
  const up = await lead.req.post(`${base}/${fev.id}/content`, {
    headers: { "Content-Type": "application/octet-stream", "If-Match": `"${fev.version}"`, "X-File-Name": encodeURIComponent(fileName), "X-CSRF-Token": auth.csrf },
    data: bytes,
  });
  const upText = await up.text();
  expect(up.status(), upText.slice(0, 300)).toBe(200);
  const saved = JSON.parse(upText) as Evidence;
  expect(saved.fileName).toBe(fileName);
  expect(sql(`select file_name from evidence_content where id = '${safe(saved.currentContentId!)}'`)).toBe(fileName);
  console.log(`QA-R12 [${lang}] R12-05 JSON create in ${pieces} chunks cut at continuation bytes -> 201, title/note verbatim (API and DB); Arabic PATCH verbatim; file name ${JSON.stringify(fileName)} verbatim (API and DB)`);
});

// =================================================================================================================
test("R12-06 (UI) the Team assign dialog's role-accountability preview follows the Role select through every assignable role and back, in the page language", async ({ page }, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r12 team preview ${lang.toUpperCase()} (synthetic)`);
  const acc = (await (await lead.req.get("/api/v1/role-accountabilities")).json()) as unknown;
  const list = (Array.isArray(acc) ? acc : ((acc as { items?: unknown[]; data?: unknown[] }).items ?? (acc as { data?: unknown[] }).data ?? [])) as {
    roleCode: string;
    accountabilityEn: string;
    accountabilityAr: string;
  }[];
  const text = new Map(list.map((a) => [a.roleCode, lang === "ar" ? a.accountabilityAr : a.accountabilityEn]));
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleErrors.push(m.text());
  });
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.request().method()} ${new URL(r.url()).pathname.replace(t.id, "<t>")} ${r.status()}`);
  });
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${t.id}/team`);
  const wlName = tr(lang, "transformations.audit.role.WL");
  await page.getByRole("button", { name: rowAction(lang, "team.assign.action", wlName) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-preview-role='WL']")).toBeVisible();
  const roleSelect = dialog.getByLabel(fieldLabel(lang, "team.assign.role"));
  const seen: string[] = [];
  for (const role of ["KDS", "TD", "CM", "SEC", "WL", "KDS", "WL"]) {
    await roleSelect.selectOption(role);
    const preview = dialog.locator(`[data-preview-role='${role}']`);
    await expect(preview).toBeVisible();
    await expect(dialog.locator("[data-preview-role]")).toHaveCount(1);
    const expected = text.get(role);
    if (expected) await expect(preview.locator(".accountability__text")).toHaveText(expected);
    seen.push(`${role}:${expected ? "text=API" : "no catalogue text"}`);
    if (role === "SEC") await shot(page, lang, "qa-r12-06-team-preview-sec");
  }
  const dir = await page.locator("html").getAttribute("dir");
  const previewDir = await dialog.locator("[data-preview-role]").evaluate((e) => getComputedStyle(e).direction);
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const team = (await (await lead.req.get(`/api/v1/transformations/${t.id}/scoped-assignments`)).json()) as unknown;
  const teamText = JSON.stringify(team);
  const wlAssigned = /"roleCode":"WL"/.test(teamText);
  const reactWarnings = consoleErrors.filter((m) => /Cannot update a component|not wrapped in act/.test(m));
  console.log(`QA-R12 [${lang}] R12-06 preview sequence ${JSON.stringify(seen)}; html dir ${dir}, preview direction ${previewDir}; cancelled, WL assigned ${wlAssigned}; browser console errors/warnings ${consoleErrors.length} ${JSON.stringify(consoleErrors.map((m) => m.slice(0, 160)))}, React update warnings ${reactWarnings.length}; HTTP responses >= 400 seen by the page ${JSON.stringify(failed)}`);
  expect(dir).toBe(lang === "ar" ? "rtl" : "ltr");
  expect(previewDir).toBe(lang === "ar" ? "rtl" : "ltr");
  expect(wlAssigned).toBe(false);
  expect(reactWarnings).toEqual([]);
});

// =================================================================================================================
// R12-07 (added after the round-12 full run showed R11-02(b) "stored files 1"): an upload stalled IN FLIGHT when the
// API gets SIGTERM. Names every file the store holds for the item after the process exits, checks that no row
// references it and that it is not downloadable, then starts a NEW API process on the same store and database and
// checks whether anything removes it. Control: the same stall, but the CLIENT aborts while the process stays up.
function filesWithSizes(evidenceId: string): string[] {
  const root = process.env["EVIDENCE_STORAGE_PATH"]!;
  return storedFilesFor(evidenceId).map((f) => `${f.slice(root.length).replace(/[0-9a-f-]{36}/g, (m) => (m === evidenceId ? "<item>" : "<uuid>"))} (${statSync(f).size} B)`);
}
test("R12-07 an upload stalled in flight at SIGTERM: what the evidence store keeps after exit and after a restart (control: client abort while the process stays up)", async ({}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r12 shutdown leftovers ${lang.toUpperCase()} (synthetic)`);
  const base = `/api/v1/transformations/${t.id}/evidence`;
  const lines: string[] = [];
  const results: { label: string; afterExit: string[]; afterRestart: string[] | null; rows: number; current: string | null; download: number }[] = [];
  for (const mode of ["control: client aborts, process stays up", "SIGTERM with the upload stalled in flight"] as const) {
    const ev = await newFileEvidence(t.id, `QA r12 leftovers ${mode.slice(0, 7)} ${lang} (synthetic)`);
    const api = await startApi();
    const c = new Conn(portOf(api.origin));
    await c.ready();
    c.socket.write(head("POST", `${base}/${ev.id}/content`, api.origin, uploadHeaders(ev.version, { "Content-Length": String(10 * MiB) })));
    await c.write(randomBytes(2 * MiB));
    await sleep(700);
    const during = filesWithSizes(ev.id);
    let exitLine = "";
    if (mode.startsWith("control")) {
      c.destroy();
      await sleep(1_500);
      const sig = Date.now();
      api.proc.kill("SIGTERM");
      const ex = await Promise.race([api.exit, sleep(20_000).then(() => null)]);
      exitLine = `client destroyed, 1.5 s later SIGTERM -> exit ${ex?.code} in ${ex ? ex.at - sig : "?"} ms`;
    } else {
      const sig = Date.now();
      api.proc.kill("SIGTERM");
      const ex = await Promise.race([api.exit, sleep(20_000).then(() => null)]);
      exitLine = `SIGTERM -> exit ${ex?.code} in ${ex ? ex.at - sig : "?"} ms; client socket closed by the server ${c.closeAt !== null}`;
      c.destroy();
    }
    const afterExit = filesWithSizes(ev.id);
    let afterRestart: string[] | null = null;
    if (afterExit.length > 0) {
      const again = await startApi();
      await sleep(2_000);
      afterRestart = filesWithSizes(ev.id);
      again.proc.kill("SIGTERM");
      await Promise.race([again.exit, sleep(20_000)]);
    }
    const rows = contentRowsFor(ev.id);
    const after = await lead.call<Evidence>("GET", `${base}/${ev.id}`);
    const download = (await lead.req.get(`${base}/${ev.id}/content`)).status();
    results.push({ label: mode, afterExit, afterRestart, rows, current: after.currentContentId, download });
    lines.push(`${mode}: store during the stall ${JSON.stringify(during)}; ${exitLine}; store after exit ${JSON.stringify(afterExit)}; after a restart on the same store (+2 s) ${afterRestart ? JSON.stringify(afterRestart) : "(not needed)"}; content rows ${rows}; currentContentId ${after.currentContentId}; GET content ${download}`);
  }
  console.log(`QA-R12 [${lang}] R12-07 ${JSON.stringify(lines)}`);
  for (const r of results) {
    expect(r.rows, r.label).toBe(0);
    expect(r.current, r.label).toBeNull();
    expect(r.download, r.label).not.toBe(200);
    // "nothing stored": no final object and no temporary object may outlive a failed upload.
    expect(r.afterExit, `${r.label}: files left in the evidence store after the process exited`).toEqual([]);
  }
});
