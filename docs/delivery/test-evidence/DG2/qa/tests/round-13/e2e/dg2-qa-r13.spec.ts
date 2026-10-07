// qa-verifier DG2 round 13 — independent verification of F-DG2-460 / T-DG2-BE18A (graceful shutdown waits for every
// in-flight handler to settle, cleanup included, before db.destroy() and process.exit; the filesystem evidence store
// sweeps `.part` temporaries older than 1 h at start-up) and regression of the other D-073 changes (the upload
// re-checks the session and grants at COMMIT time; /auth/login resolves the IdP before opening a transaction) on
// candidate 6824b8b8 (T-DG2-REV-QA-R13). Authored by qa-verifier, NOT by an implementer. Runs in chromium-en and
// chromium-ar against the REAL built API (apps/api/dist/main.js) + PostgreSQL (e2e/support/qa-stack.sh), over raw TCP
// sockets, and inspects the real database (psql), the real evidence store and the API's own log. No server mocks.
//   e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-r13.spec.ts --workers=1
//
// R13-01 SIGTERM while uploads are ACTIVELY STREAMING (the client keeps sending through the whole grace period) on a
//   separate API process, together with a stalled one: exit 0 inside the backstop, the settle step logs no warning, no
//   error-level line, no content row, no final object and no `.part` left; a restart on the same store finds nothing.
// R13-02 SIGTERM while a short upload streams that FINISHES inside the grace: it commits (200), byte-exact, and the
//   process still exits 0 with no `.part` left (the drain still works).
// R13-03 start-up sweep on a new API process over the shared store: a stale `<uuid>.part` (mtime 2 h ago) is removed and
//   logged (opaque key, size, age); a fresh `.part`, a 50-minute-old `.part`, a 2-hour-old FINAL object, a stale
//   non-UUID `notes.part`, a stale `.part` at the wrong depth, a stale `.part` DIRECTORY, and stale temporaries reached
//   only through symbolic links are all kept; every pre-existing object in the store keeps its bytes (sha256), and a
//   real committed object back-dated to 2 h ago is still downloadable byte-exact.
// R13-04 commit-time authorisation: (a) positive control: a team member's upload commits (200, byte-exact, sha256 = DB);
//   (b) the member's only grant (a KDS team assignment) is revoked through POST /role-assignments/{id}/revoke while
//   the body streams: the product's revoke also ends the member's sessions (audited session.revoke), so 401, nothing
//   stored, version unchanged; (b2) the member's grant ENDS (effectiveTo passes) while the body streams and the session
//   stays valid: 403 forbidden, audited authorization.denied, nothing stored; (c) the uploading session logs out
//   (POST /auth/logout) while the body streams: 401, nothing stored, the user's OTHER session is unaffected.
// R13-05 /auth/login against a never-answering IdP (separate API process, AUTH_MODE=oidc, pool max 20): 25 concurrent
//   logins hold no connection "idle in transaction"; /readyz and a signed-in user's GET /me on the same process stay
//   prompt; every login ends without a 5xx; SIGTERM exits 0.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, SYN_RETAIL, apiSession, langOf, type ApiSession } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "default" });

type Problem = { code: string; status: number; detail: string; requestId: string };
type Evidence = { id: string; version: number; currentContentId: string | null; fileName: string | null; title: string; organizationId?: string };
type Auth = { cookie: string; csrf: string };

const MiB = 1024 * 1024;
const NOBODY = "01920000-0000-7000-9000-000000000205"; // dev.nobody: no grant at all in the synthetic dev seed

let lead: ApiSession;
let admin: ApiSession;
let leadAuth: Auth;
async function authOf(s: ApiSession): Promise<Auth> {
  const state = await s.req.storageState();
  const me = (await (await s.req.get("/api/v1/me")).json()) as { csrfToken: string };
  return { cookie: state.cookies.map((c) => `${c.name}=${c.value}`).join("; "), csrf: me.csrfToken };
}
test.beforeAll(async ({ playwright }) => {
  lead = await apiSession(playwright, "dev.lead");
  admin = await apiSession(playwright, "dev.admin");
  leadAuth = await authOf(lead);
});

// ---- the real database and store (exported by qa-stack.sh) ------------------------------------------------------
function sql(query: string): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url) throw new Error("DATABASE_OWNER_URL not set: run under e2e/support/qa-stack.sh");
  return execFileSync("psql", [url.replace(/\+/g, "%20"), "-qAtX", "-c", query], { encoding: "utf8" }).trim();
}
function sqlSuper(query: string): string {
  const url = new URL(process.env["DATABASE_OWNER_URL"]!.replace(/\+/g, "%20"));
  url.searchParams.delete("options");
  return execFileSync("psql", [url.toString(), "-qAtX", "-c", query], { encoding: "utf8" }).trim();
}
const safe = (s: string) => {
  if (!/^[0-9A-Za-z._:-]{1,80}$/.test(s)) throw new Error(`unexpected id ${s}`);
  return s;
};
const contentRowsFor = (evidenceId: string) => Number(sql(`select count(*) from evidence_content where evidence_id = '${safe(evidenceId)}'`));
const auditActionsFor = (rid: string) => sql(`select coalesce(string_agg(action, ',' order by action), '') from audit_event where request_id = '${safe(rid)}'`);
const ROOT = () => {
  const r = process.env["EVIDENCE_STORAGE_PATH"];
  if (!r) throw new Error("EVIDENCE_STORAGE_PATH not set: run under e2e/support/qa-stack.sh");
  return r;
};
function storedFilesFor(evidenceId: string): string[] {
  const root = ROOT();
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && join(d.parentPath, d.name).includes(evidenceId))
    .map((d) => join(d.parentPath, d.name).slice(root.length).replace(/[0-9a-f-]{36}/g, (m) => (m === evidenceId ? "<item>" : "<uuid>")) + ` (${statSync(join(d.parentPath, d.name)).size} B)`);
}
/**
 * Every regular file under the store root, relative path -> sha256. Symbolic links are NOT followed (my own walk: Node's
 * `readdirSync(..., { recursive: true })` descends into symlinked directories, which the first round-13 run showed).
 */
function storeSnapshot(): Map<string, string> {
  const root = ROOT();
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.isFile()) out.set(p.slice(root.length + 1), sha(readFileSync(p)));
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}
const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newTransformation(name: string): Promise<{ id: string }> {
  return lead.call("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name, mode: "end_to_end" });
}
async function newFileEvidence(s: ApiSession, transformationId: string, title: string): Promise<Evidence> {
  return s.call<Evidence>("POST", `/api/v1/transformations/${transformationId}/evidence`, { ownerUserId: s.userId, kind: "file", title });
}

// ---- raw HTTP/1.1 over a real socket ------------------------------------------------------------------------------
type Parsed = { status: number; headers: Record<string, string>; text: string; json: Problem | null };
function parseOne(buf: Buffer): Parsed | null {
  const i = buf.indexOf("\r\n\r\n");
  if (i < 0) return null;
  const [statusLine = "", ...lines] = buf.subarray(0, i).toString("latin1").split("\r\n");
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const j = line.indexOf(":");
    headers[line.slice(0, j).toLowerCase()] = line.slice(j + 1).trim();
  }
  const n = Number(headers["content-length"] ?? 0);
  const rest = buf.subarray(i + 4);
  if (rest.length < n) return null;
  const text = rest.subarray(0, n).toString("utf8");
  let json: Problem | null = null;
  try {
    json = JSON.parse(text) as Problem;
  } catch {
    json = null;
  }
  return { status: Number(statusLine.split(" ")[1]), headers, text, json };
}
class Conn {
  readonly socket: Socket;
  buf = Buffer.alloc(0);
  closeAt: number | null = null;
  constructor(port: number) {
    this.socket = connect(port, "127.0.0.1");
    this.socket.on("data", (d: Buffer) => (this.buf = Buffer.concat([this.buf, d])));
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
  /** Streams `data` at about `bytesPerSecond` until it is all sent or the socket closes; returns the bytes sent. */
  async stream(data: Buffer, bytesPerSecond: number, piece = 32 * 1024): Promise<number> {
    let sent = 0;
    const interval = (piece / bytesPerSecond) * 1000;
    for (let at = 0; at < data.length; at += piece) {
      if (this.socket.destroyed || !this.socket.writable || this.closeAt !== null) break;
      this.socket.write(data.subarray(at, at + piece));
      sent += Math.min(piece, data.length - at);
      await sleep(interval);
    }
    return sent;
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
function head(method: string, path: string, origin: string, auth: Auth, hdrs: Record<string, string>): Buffer {
  const u = new URL(origin);
  const h = [`${method} ${path} HTTP/1.1`, `Host: ${u.host}`, `Origin: ${origin}`];
  for (const [k, v] of Object.entries(hdrs)) h.push(`${k}: ${v}`);
  h.push(`Cookie: ${auth.cookie}`, `X-CSRF-Token: ${auth.csrf}`);
  return Buffer.from(`${h.join("\r\n")}\r\n\r\n`, "latin1");
}
const portOf = (origin: string) => Number(new URL(origin).port || 80);
const uploadHeaders = (version: number, length: number) => ({
  "Content-Type": "application/octet-stream",
  "If-Match": `"${version}"`,
  "X-File-Name": "qa-r13.bin",
  "Content-Length": String(length),
});

// ---- separate API processes from the same build -------------------------------------------------------------------
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
  const exit = new Promise<{ code: number | null; signal: string | null; at: number }>((r) => proc.once("exit", (code, signal) => r({ code, signal, at: Date.now() })));
  for (let k = 0; k < 150; k++) {
    try {
      if ((await fetch(`${origin}/readyz`)).ok) return { proc, origin, log: () => log, exit };
    } catch {
      /* not yet listening */
    }
    await sleep(100);
  }
  proc.kill("SIGKILL");
  throw new Error(`API did not become ready: ${log.slice(-2000)}`);
}
async function stopApi(api: Api): Promise<{ code: number | null; ms: number | null }> {
  const sig = Date.now();
  api.proc.kill("SIGTERM");
  const ex = await Promise.race([api.exit, sleep(25_000).then(() => null)]);
  if (!ex) api.proc.kill("SIGKILL");
  return { code: ex ? ex.code : null, ms: ex ? ex.at - sig : null };
}
type LogLine = { level?: number; msg?: string; [k: string]: unknown };
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
const errorLines = (all: LogLine[]) => all.filter((l) => (l.level ?? 0) >= 50 || l.msg === "unhandled error");

// =================================================================================================================
test("R13-01 SIGTERM while uploads are ACTIVELY STREAMING (and one stalled): exit 0 inside the backstop, no settle warning, no error line, nothing stored, no .part, a restart finds nothing", async ({}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r13 streaming at SIGTERM ${lang.toUpperCase()} (synthetic)`);
  const base = `/api/v1/transformations/${t.id}/evidence`;
  const items = [
    await newFileEvidence(lead, t.id, `QA r13 streaming A ${lang} (synthetic)`),
    await newFileEvidence(lead, t.id, `QA r13 streaming B ${lang} (synthetic)`),
    await newFileEvidence(lead, t.id, `QA r13 stalled C ${lang} (synthetic)`),
  ];
  const api = await startApi();
  const length = 24 * MiB; // at ~1 MiB/s the body would need ~24 s: it is still streaming when the 5 s grace ends
  const conns = items.map(() => new Conn(portOf(api.origin)));
  for (const c of conns) await c.ready();
  items.forEach((ev, i) => conns[i]!.socket.write(head("POST", `${base}/${ev.id}/content`, api.origin, leadAuth, uploadHeaders(ev.version, length))));
  const body = randomBytes(length);
  const streams = [conns[0]!.stream(body, MiB), conns[1]!.stream(body, MiB)];
  await conns[2]!.write(body.subarray(0, MiB)); // C: 1 MiB, then stalls
  await sleep(1_500);
  const during = items.map((ev) => storedFilesFor(ev.id));
  const stop = await stopApi(api);
  const sent = await Promise.all(streams);
  const closedByServer = conns.map((c) => c.closeAt !== null);
  for (const c of conns) c.destroy();
  const all = logLines(api.log());
  const errors = errorLines(all);
  const settleWarnings = all.filter((l) => typeof l.msg === "string" && l.msg.startsWith("shutdown: request handlers still running"));
  const shutDown = all.some((l) => l.msg === "shut down");
  const afterExit = items.map((ev) => storedFilesFor(ev.id));
  const again = await startApi();
  await sleep(1_500);
  const afterRestart = items.map((ev) => storedFilesFor(ev.id));
  const stop2 = await stopApi(again);
  const rows = items.map((ev) => contentRowsFor(ev.id));
  const after = await Promise.all(items.map((ev) => lead.call<Evidence>("GET", `${base}/${ev.id}`)));
  const downloads = await Promise.all(items.map(async (ev) => (await lead.req.get(`${base}/${ev.id}/content`)).status()));
  console.log(
    `QA-R13 [${lang}] R13-01 store during (A,B streaming; C stalled) ${JSON.stringify(during)}; SIGTERM -> exit ${stop.code} in ${stop.ms} ms; bytes the client had streamed when the server closed A,B ${JSON.stringify(sent)} of ${length}; ` +
      `server closed sockets ${JSON.stringify(closedByServer)}; 'shut down' logged ${shutDown}; settle warnings ${settleWarnings.length}; error-level lines ${errors.length}${errors.length ? " " + JSON.stringify(errors.slice(0, 3)) : ""}; ` +
      `store after exit ${JSON.stringify(afterExit)}; after a restart ${JSON.stringify(afterRestart)} (restart SIGTERM -> exit ${stop2.code} in ${stop2.ms} ms); content rows ${JSON.stringify(rows)}; currentContentId ${JSON.stringify(after.map((a) => a.currentContentId))}; versions ${JSON.stringify(after.map((a, i) => `${items[i]!.version}->${a.version}`))}; GET content ${JSON.stringify(downloads)}`,
  );
  expect(during.every((d) => d.some((f) => f.includes(".part")))).toBe(true); // the probe really had temporaries in flight
  expect(sent.every((s) => s > 5 * MiB && s < length)).toBe(true); // A and B were still streaming past the 5 s grace
  expect(stop.code).toBe(0);
  expect(stop.ms!).toBeLessThan(10_000); // inside the backstop (grace 5 s + 5 s)
  expect(closedByServer).toEqual([true, true, true]);
  expect(shutDown).toBe(true);
  expect(settleWarnings).toEqual([]);
  expect(errors).toEqual([]);
  expect(afterExit).toEqual([[], [], []]);
  expect(afterRestart).toEqual([[], [], []]);
  expect(stop2.code).toBe(0);
  expect(rows).toEqual([0, 0, 0]);
  expect(after.map((a) => a.currentContentId)).toEqual([null, null, null]);
  expect(after.map((a) => a.version)).toEqual(items.map((ev) => ev.version));
  expect(downloads.every((s) => s !== 200)).toBe(true);
});

// =================================================================================================================
test("R13-02 SIGTERM while a short upload streams that FINISHES inside the grace: it commits (200) byte-exact, exit 0, no .part left", async ({}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r13 drain ${lang.toUpperCase()} (synthetic)`);
  const base = `/api/v1/transformations/${t.id}/evidence`;
  const ev = await newFileEvidence(lead, t.id, `QA r13 drain ${lang} (synthetic)`);
  const api = await startApi();
  const bytes = randomBytes(3 * MiB + 7);
  const c = new Conn(portOf(api.origin));
  await c.ready();
  c.socket.write(head("POST", `${base}/${ev.id}/content`, api.origin, leadAuth, uploadHeaders(ev.version, bytes.length)));
  const streaming = c.stream(bytes, 2 * MiB); // ~1.5 s
  await sleep(500);
  const stopping = stopApi(api);
  await streaming;
  const res = await c.response(15_000).catch((e: Error) => ({ status: -1, headers: {}, text: e.message, json: null }) as Parsed);
  const stop = await stopping;
  c.destroy();
  const dl = await lead.req.get(`${base}/${ev.id}/content`);
  const got = await dl.body();
  const stored = contentRowsFor(ev.id) ? sql(`select sha256 || ' ' || size_bytes from evidence_content where evidence_id = '${safe(ev.id)}'`) : "";
  const files = storedFilesFor(ev.id);
  const errors = errorLines(logLines(api.log()));
  console.log(`QA-R13 [${lang}] R13-02 upload (${bytes.length} B over ~1.5 s, SIGTERM at +0.5 s) -> ${res.status}; SIGTERM -> exit ${stop.code} in ${stop.ms} ms; download ${dl.status()} byte-exact ${got.equals(bytes)}; DB ${stored.slice(0, 20)}… vs sha256 ${sha(bytes).slice(0, 16)}…; store ${JSON.stringify(files)}; error-level lines ${errors.length}`);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  expect(stop.code).toBe(0);
  expect(dl.status()).toBe(200);
  expect(got.equals(bytes)).toBe(true);
  expect(stored).toBe(`${sha(bytes)} ${bytes.length}`);
  expect(files.length).toBe(1);
  expect(files.some((f) => f.includes(".part"))).toBe(false);
  expect(errors).toEqual([]);
});

// =================================================================================================================
test("R13-03 start-up sweep: only a stale <uuid>.part at the key depth is removed and logged; fresh/near-threshold temporaries, old final objects, look-alikes, wrong depth, directories and symlinked paths are kept", async ({}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const root = ROOT();
  // A real committed object, back-dated to 2 h ago: a FINAL object the sweep must never touch.
  const t = await newTransformation(`QA r13 sweep ${lang.toUpperCase()} (synthetic)`);
  const base = `/api/v1/transformations/${t.id}/evidence`;
  const ev = await newFileEvidence(lead, t.id, `QA r13 sweep ${lang} (synthetic)`);
  const realBytes = randomBytes(200_000);
  const up = await lead.req.post(`${base}/${ev.id}/content`, {
    headers: { "Content-Type": "application/octet-stream", "If-Match": `"${ev.version}"`, "X-File-Name": "qa-r13-final.bin", "X-CSRF-Token": leadAuth.csrf },
    data: realBytes,
  });
  expect(up.status(), await up.text()).toBe(200);
  const [realFinal] = readdirSync(root, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && join(d.parentPath, d.name).includes(ev.id)).map((d) => join(d.parentPath, d.name));
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
  utimesSync(realFinal!, twoHoursAgo, twoHoursAgo);

  // Synthetic objects under synthetic keys (organization/transformation/evidence/uuid), all SYNTHETIC bytes.
  const dir = join(root, randomUUID(), randomUUID(), randomUUID());
  mkdirSync(dir, { recursive: true });
  const put = (path: string, size: number, ageMs: number) => {
    writeFileSync(path, randomBytes(size));
    const at = new Date(Date.now() - ageMs);
    utimesSync(path, at, at);
    return path;
  };
  const stale = put(join(dir, `${randomUUID()}.part`), 4096, 2 * 3600_000);
  const fresh = put(join(dir, `${randomUUID()}.part`), 1000, 0);
  const near = put(join(dir, `${randomUUID()}.part`), 1001, 50 * 60_000);
  const oldFinal = put(join(dir, randomUUID()), 1002, 3 * 3600_000);
  const lookalike = put(join(dir, "notes.part"), 1003, 3 * 3600_000);
  const upper = put(join(dir, `${randomUUID().toUpperCase()}.part`), 1004, 3 * 3600_000);
  const wrongDepth = put(join(dir, "..", `${randomUUID()}.part`), 1005, 3 * 3600_000);
  const deeper = join(dir, randomUUID());
  mkdirSync(deeper);
  const tooDeep = put(join(deeper, `${randomUUID()}.part`), 1006, 3 * 3600_000);
  const partDir = join(dir, `${randomUUID()}.part`);
  mkdirSync(partDir);
  utimesSync(partDir, twoHoursAgo, twoHoursAgo);
  // Symbolic links: a directory link at the organization level to an outside tree, and a `<uuid>.part` link to an
  // outside stale file. The sweep must not follow either (the outside files must survive).
  const outside = `${root}-outside-r13-${lang}`;
  const outsideDir = join(outside, "t", "e");
  mkdirSync(outsideDir, { recursive: true });
  const outsideStale = put(join(outsideDir, `${randomUUID()}.part`), 1007, 3 * 3600_000);
  symlinkSync(outside, join(root, `link-${lang}-${randomUUID()}`));
  const outsideFile = put(join(outside, `${randomUUID()}.part`), 1008, 3 * 3600_000);
  const linkPart = join(dir, `${randomUUID()}.part`);
  symlinkSync(outsideFile, linkPart);

  const before = storeSnapshot();
  const freshParts = [...before.keys()].filter((k) => /\/[0-9a-f-]{36}\.part$/.test(k) && k.split("/").length === 4 && Date.now() - statSync(join(root, k)).mtimeMs <= 3600_000).length;
  const staleParts = [...before.keys()].filter((k) => /^[^/]+\/[^/]+\/[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.part$/.test(k) && Date.now() - statSync(join(root, k)).mtimeMs > 3600_000);
  const api = await startApi();
  let finished: LogLine | undefined;
  for (let k = 0; k < 100 && !finished; k++) {
    finished = logLines(api.log()).find((l) => l.msg === "evidence store: start-up sweep of stale temporary objects finished");
    if (!finished) await sleep(100);
  }
  const all = logLines(api.log());
  const removedLines = all.filter((l) => l.msg === "evidence store: stale temporary object removed");
  const stop = await stopApi(api);
  const after = storeSnapshot();
  const gone = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...before.keys()].filter((k) => after.has(k) && after.get(k) !== before.get(k));
  const rel = (p: string) => p.slice(root.length + 1);
  const exists = (p: string) => {
    try {
      lstatSync(p);
      return true;
    } catch {
      return false;
    }
  };
  const kept = { fresh, near, oldFinal, lookalike, upper, wrongDepth, tooDeep, partDir, outsideStale, outsideFile, linkPart, realFinal: realFinal! };
  const keptState = Object.fromEntries(Object.entries(kept).map(([k, p]) => [k, exists(p)]));
  const dl = await lead.req.get(`${base}/${ev.id}/content`);
  const got = await dl.body();
  const leaksPath = removedLines.some((l) => JSON.stringify(l).includes(root));
  console.log(
    `QA-R13 [${lang}] R13-03 store files before ${before.size} (stale <uuid>.part at key depth ${staleParts.length}, fresh ${freshParts}); sweep finished line ${JSON.stringify(finished && { removed: finished["removed"], keptFresh: finished["keptFresh"], olderThanMs: finished["olderThanMs"] })}; ` +
      `removed lines ${JSON.stringify(removedLines.map((l) => ({ level: l.level, key: l["key"], sizeBytes: l["sizeBytes"], ageMs: l["ageMs"] })))}; absolute path in a removal line ${leaksPath}; ` +
      `gone ${JSON.stringify(gone)} (expected ${JSON.stringify(staleParts)}); bytes changed ${changed.length}; kept ${JSON.stringify(keptState)}; real back-dated final object GET ${dl.status()} byte-exact ${got.equals(realBytes)}; SIGTERM -> exit ${stop.code} in ${stop.ms} ms`,
  );
  expect(staleParts).toContain(rel(stale));
  expect(finished).toBeDefined();
  expect(finished!["removed"]).toBe(staleParts.length);
  expect(finished!["keptFresh"]).toBe(freshParts);
  expect(finished!["olderThanMs"]).toBe(3600_000);
  expect(removedLines.map((l) => l["key"]).sort()).toEqual([...staleParts].sort());
  expect(removedLines.every((l) => l.level === 30 && typeof l["sizeBytes"] === "number" && (l["ageMs"] as number) > 3600_000)).toBe(true);
  expect(removedLines.find((l) => l["key"] === rel(stale))?.["sizeBytes"]).toBe(4096);
  expect(leaksPath).toBe(false);
  expect(exists(stale)).toBe(false);
  expect(gone.sort()).toEqual([...staleParts].sort());
  expect(changed).toEqual([]);
  expect(Object.values(keptState).every(Boolean)).toBe(true);
  expect(dl.status()).toBe(200);
  expect(got.equals(realBytes)).toBe(true);
  expect(stop.code).toBe(0);
});

// =================================================================================================================
test("R13-04 commit-time authorisation: positive control 200; API revoke mid-upload (ends the session) -> 401; grant expiry mid-upload -> 403 audited; logout mid-upload -> 401; nothing stored; the other session unaffected", async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const t = await newTransformation(`QA r13 commit-time auth ${lang.toUpperCase()} (synthetic)`);
  const base = `/api/v1/transformations/${t.id}/evidence`;
  const assigned = await lead.call<{ id: string; version: number }>("POST", `/api/v1/transformations/${t.id}/scoped-assignments`, {
    userId: NOBODY,
    roleCode: "KDS",
    reason: `QA r13 synthetic team member ${lang}`,
  });
  const nobody = await apiSession(playwright, "dev.nobody");
  const nobodyAuth = await authOf(nobody);
  const lines: string[] = [];

  async function upload(auth: Auth, ev: Evidence, bytes: Buffer, midway?: () => Promise<string>): Promise<{ res: Parsed; mid: string }> {
    const c = new Conn(portOf(BASE));
    await c.ready();
    c.socket.write(head("POST", `${base}/${ev.id}/content`, BASE, auth, uploadHeaders(ev.version, bytes.length)));
    await c.write(bytes.subarray(0, MiB));
    await sleep(300);
    const mid = midway ? await midway() : "";
    await sleep(200);
    await c.write(bytes.subarray(MiB));
    const res = await c.response(30_000);
    c.destroy();
    return { res, mid };
  }

  // (a) positive control: the member's own upload, grant and session valid.
  const ctl = await newFileEvidence(nobody, t.id, `QA r13 member control ${lang} (synthetic)`);
  const ctlBytes = randomBytes(2 * MiB + 3);
  const a = await upload(nobodyAuth, ctl, ctlBytes);
  const ctlDl = await nobody.req.get(`${base}/${ctl.id}/content`);
  const ctlGot = await ctlDl.body();
  const ctlDb = sql(`select sha256 || ' ' || size_bytes from evidence_content where evidence_id = '${safe(ctl.id)}'`);
  lines.push(`(a) control -> ${a.res.status}; download ${ctlDl.status()} byte-exact ${ctlGot.equals(ctlBytes)}; DB = sha256 ${ctlDb === `${sha(ctlBytes)} ${ctlBytes.length}`}`);
  expect(a.res.status, a.res.text.slice(0, 300)).toBe(200);
  expect(ctlGot.equals(ctlBytes)).toBe(true);
  expect(ctlDb).toBe(`${sha(ctlBytes)} ${ctlBytes.length}`);

  // (b) the member's ONLY grant is revoked through the product API (POST /role-assignments/{id}/revoke, by the access
  // administrator) while the body streams. The first round-13 run showed (and a separate probe confirmed:
  // audit `scoped_assignment.revoke` then `session.revoke`) that the product's revoke ALSO ends the member's sessions,
  // so at commit the session is gone: the declared answer is 401 unauthenticated, and nothing may be stored.
  const ev = await newFileEvidence(nobody, t.id, `QA r13 member revoked ${lang} (synthetic)`);
  const b = await upload(nobodyAuth, ev, randomBytes(3 * MiB), async () => {
    const r = await admin.call<{ revokedAt: string | null }>("POST", `/api/v1/role-assignments/${assigned.id}/revoke`, { reason: `QA r13 synthetic revoke mid-upload ${lang}` }, { ifMatch: assigned.version });
    return `revokedAt set ${r.revokedAt !== null}`;
  });
  const bRows = contentRowsFor(ev.id);
  const bFiles = storedFilesFor(ev.id);
  const bItem = sql(`select version || ' ' || coalesce(current_content_id::text, 'null') from evidence where id = '${safe(ev.id)}'`);
  const bSessionRevoke = Number(sql(`select count(*) from session where user_id = '${NOBODY}' and revoked_at is not null`));
  const nobodyMe = (await nobody.req.get("/api/v1/me")).status();
  lines.push(`(b) API revoke mid-upload (${b.mid}) -> ${b.res.status} ${b.res.json?.code}; member session rows revoked by the product ${bSessionRevoke}; member GET /me afterwards ${nobodyMe}; content rows ${bRows}; store ${JSON.stringify(bFiles)}; item version/current ${bItem} (was ${ev.version} null)`);
  expect(b.mid).toBe("revokedAt set true");
  expect(b.res.status, b.res.text.slice(0, 300)).toBe(401);
  expect(b.res.json?.code).toBe("unauthenticated");
  expect(nobodyMe).toBe(401);
  expect(bSessionRevoke).toBeGreaterThan(0);
  expect(bRows).toBe(0);
  expect(bFiles).toEqual([]);
  expect(bItem).toBe(`${ev.version} null`);

  // (b2) the grant ENDS while the body streams but the session stays valid: a team assignment with effectiveTo a few
  // seconds ahead (a product path: TeamAssignmentCreate.effectiveTo) that passes during the body. Expected: 403
  // forbidden at commit, audited as authorization.denied, nothing stored; the session still works afterwards.
  const t2 = await newTransformation(`QA r13 grant expiry ${lang.toUpperCase()} (synthetic)`);
  const base2 = `/api/v1/transformations/${t2.id}/evidence`;
  const until = Date.now() + 6_000;
  await lead.call("POST", `/api/v1/transformations/${t2.id}/scoped-assignments`, { userId: NOBODY, roleCode: "KDS", effectiveTo: new Date(until).toISOString(), reason: `QA r13 synthetic expiring grant ${lang}` });
  const nobody2 = await apiSession(playwright, "dev.nobody");
  const nobody2Auth = await authOf(nobody2);
  const ev3 = await nobody2.call<Evidence>("POST", base2, { ownerUserId: NOBODY, kind: "file", title: `QA r13 member grant expiry ${lang} (synthetic)` });
  const c3 = new Conn(portOf(BASE));
  await c3.ready();
  const bytes3 = randomBytes(3 * MiB);
  c3.socket.write(head("POST", `${base2}/${ev3.id}/content`, BASE, nobody2Auth, uploadHeaders(ev3.version, bytes3.length)));
  await c3.write(bytes3.subarray(0, MiB));
  const startedBeforeExpiry = Date.now() < until;
  await sleep(Math.max(0, until - Date.now()) + 1_000);
  await c3.write(bytes3.subarray(MiB));
  const r3 = await c3.response(30_000);
  c3.destroy();
  const rid3 = r3.headers["x-request-id"] ?? "";
  const b2Audit = rid3 ? auditActionsFor(rid3) : "(no request id)";
  const b2Rows = contentRowsFor(ev3.id);
  const b2Files = storedFilesFor(ev3.id);
  const b2Item = sql(`select version || ' ' || coalesce(current_content_id::text, 'null') from evidence where id = '${safe(ev3.id)}'`);
  const b2Me = (await nobody2.req.get("/api/v1/me")).status();
  lines.push(`(b2) grant expired mid-upload (upload started before effectiveTo ${startedBeforeExpiry}) -> ${r3.status} ${r3.json?.code}; audit actions for the request ${JSON.stringify(b2Audit)}; content rows ${b2Rows}; store ${JSON.stringify(b2Files)}; item version/current ${b2Item} (was ${ev3.version} null); session GET /me afterwards ${b2Me}`);
  expect(startedBeforeExpiry).toBe(true);
  expect(r3.status, r3.text.slice(0, 300)).toBe(403);
  expect(r3.json?.code).toBe("forbidden");
  expect(b2Audit).toContain("authorization.denied");
  expect(b2Audit).not.toContain("evidence");
  expect(b2Rows).toBe(0);
  expect(b2Files).toEqual([]);
  expect(b2Item).toBe(`${ev3.version} null`);
  expect(b2Me).toBe(200);

  // (c) the uploading session logs out while the body streams; the same user's OTHER session (lead) is unaffected.
  const second = await apiSession(playwright, "dev.lead");
  const secondAuth = await authOf(second);
  const ev2 = await newFileEvidence(lead, t.id, `QA r13 logout ${lang} (synthetic)`);
  const c = await upload(secondAuth, ev2, randomBytes(3 * MiB), async () => {
    const out = await second.req.post("/api/v1/auth/logout", { headers: { "X-CSRF-Token": secondAuth.csrf } });
    return `logout ${out.status()}`;
  });
  const cRows = contentRowsFor(ev2.id);
  const cFiles = storedFilesFor(ev2.id);
  const cItem = await lead.call<Evidence>("GET", `${base}/${ev2.id}`);
  const secondMe = (await second.req.get("/api/v1/me")).status();
  const leadMe = (await lead.req.get("/api/v1/me")).status();
  lines.push(`(c) logout mid-upload (${c.mid}) -> ${c.res.status} ${c.res.json?.code}; content rows ${cRows}; store ${JSON.stringify(cFiles)}; item v${ev2.version}->v${cItem.version} current ${cItem.currentContentId}; logged-out session GET /me ${secondMe}; the user's other session GET /me ${leadMe}`);
  console.log(`QA-R13 [${lang}] R13-04 ${JSON.stringify(lines)}`);
  expect(c.mid).toBe("logout 200");
  expect(c.res.status, c.res.text.slice(0, 300)).toBe(401);
  expect(c.res.json?.code).toBe("unauthenticated");
  expect(cRows).toBe(0);
  expect(cFiles).toEqual([]);
  expect(cItem.version).toBe(ev2.version);
  expect(cItem.currentContentId).toBeNull();
  expect(secondMe).toBe(401);
  expect(leadMe).toBe(200);
});

// =================================================================================================================
test("R13-05 /auth/login against a never-answering IdP (AUTH_MODE=oidc, pool max 20): 25 concurrent logins hold no transaction; /readyz and a signed-in GET /me stay prompt; no 5xx; SIGTERM exits 0", async ({}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const sockets: Socket[] = [];
  const idp: Server = createServer((s) => {
    sockets.push(s); // accept and never answer
    s.on("error", () => undefined);
  });
  const idpPort = await new Promise<number>((r) => idp.listen(0, "127.0.0.1", () => r((idp.address() as { port: number }).port)));
  const api = await startApi({ AUTH_MODE: "oidc", OIDC_ISSUER_URL: `http://127.0.0.1:${idpPort}/realms/qa-r13`, OIDC_CLIENT_ID: "qa-r13-synthetic", OIDC_CLIENT_SECRET: "qa-r13-synthetic-not-a-secret" });
  const logins = Array.from({ length: 25 }, () =>
    fetch(`${api.origin}/api/v1/auth/login?returnTo=%2F`, { redirect: "manual" }).then(
      async (r) => ({ status: r.status, location: r.headers.get("location") ?? "" }),
      (e: Error) => ({ status: -1, location: e.message }),
    ),
  );
  await sleep(1_500);
  const idleInTx = Number(sqlSuper(`select count(*) from pg_stat_activity where application_name = 'mth-api' and state like 'idle in transaction%'`));
  const t0 = Date.now();
  const readyz = (await fetch(`${api.origin}/readyz`)).status;
  const readyMs = Date.now() - t0;
  const t1 = Date.now();
  const me = (await fetch(`${api.origin}/api/v1/me`, { headers: { Cookie: leadAuth.cookie } })).status;
  const meMs = Date.now() - t1;
  const results = await Promise.all(logins);
  const statuses = [...new Set(results.map((r) => `${r.status} ${r.location.replace(/\?.*/, "?…")}`))];
  const all = logLines(api.log());
  const fiveHundreds = all.filter((l) => ((l["res"] as { statusCode?: number } | undefined)?.statusCode ?? 0) >= 500);
  const stop = await stopApi(api);
  for (const s of sockets) s.destroy();
  idp.close();
  console.log(`QA-R13 [${lang}] R13-05 IdP connections accepted ${sockets.length}; mth-api sessions idle in transaction while 25 logins wait ${idleInTx}; /readyz ${readyz} in ${readyMs} ms; signed-in GET /me ${me} in ${meMs} ms; login outcomes ${JSON.stringify(statuses)}; logged 5xx ${fiveHundreds.length}; SIGTERM -> exit ${stop.code} in ${stop.ms} ms`);
  expect(sockets.length).toBeGreaterThan(0); // discovery really reached the stalled IdP
  expect(idleInTx).toBe(0);
  expect(readyz).toBe(200);
  expect(readyMs).toBeLessThan(2_000);
  expect(me).toBe(200);
  expect(meMs).toBeLessThan(2_000);
  expect(results.every((r) => r.status > 0 && r.status < 500)).toBe(true);
  expect(fiveHundreds).toEqual([]);
  expect(stop.code).toBe(0);
});
