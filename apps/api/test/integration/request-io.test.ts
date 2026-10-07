// T-DG2-BE17: no client I/O while a pooled database connection or a transaction is held (F-DG2-411), and a request
// body that was not received completely is never a 500 (F-DG2-412). Everything here runs over REAL sockets (llhttp),
// not `inject`, against the run's disposable PostgreSQL. All data is SYNTHETIC. G1-G6 are PRODUCT gates (business
// approvals), unrelated to the engineering gates DG0-DG7.
//   Before (HEAD 18694ca): the upload opened its transaction and took the row lock (FOR UPDATE) BEFORE streaming the
//   body, so N stalled uploads (N = pool size) held every pooled connection: every other user's request and /readyz
//   hung until requestTimeout. A concurrent edit of the item blocked on the row lock for as long as the upload body
//   took. An aborted or timed-out JSON body was an error-level "unhandled error" and a 500.
//   Now: the body is received with no connection held, the write transaction is short and re-checks If-Match on the
//   locked row (409 when the item changed meanwhile), incomplete bodies are 400 validation.malformed_request below
//   error level on every route, and an exhausted pool answers 503 after a bounded wait.
// Each scenario logs one `BE17 {...}` line: the evidence for the handback's before/after table.
import { createHash, randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  APP_ORIGIN,
  call,
  seedWorld,
  startApi,
  testEvidenceDir,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { setupP2World, type P2World } from "../support/p2-fixtures.ts";

interface LogLine {
  level: number;
  msg: string;
  err?: { code?: string; message?: string };
  res?: { statusCode?: number };
}
const logLines: LogLine[] = [];
const logStream = {
  write(line: string) {
    for (const l of line.split("\n").filter(Boolean)) logLines.push(JSON.parse(l) as LogLine);
  },
};
const errorLinesSince = (from: number) =>
  logLines.slice(from).filter((l) => l.level >= 50 || l.msg === "unhandled error");
const serverErrorsSince = (from: number) => logLines.slice(from).filter((l) => (l.res?.statusCode ?? 0) >= 500);

const MiB = 1024 * 1024;
const POOL_SIZE = 5; // the harness pool (startApi: max 5)
/** "Promptly": far below the 5 s the reviewer's probe waited and below every timeout in play. */
const PROMPT_MS = 2_000;

let base: TestApi;
let w: World;
let p: P2World;
let T: string;
beforeAll(async () => {
  base = await startApi({ logStream, env: { LOG_LEVEL: "info" } });
  w = await seedWorld(base.db);
  p = await setupP2World(base, w);
  T = `/api/v1/transformations/${p.transformationId}`;
}, 60_000);
afterAll(async () => {
  await base.close();
}, 60_000);

// ------------------------------------------------------------------------------------------------ helpers

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const log = (key: string, value: unknown) => console.log(`BE17 ${key}: ${JSON.stringify(value)}`);

/** Listens on a free port in 26000-31999 (below the Linux ephemeral range); retries on a collision. */
async function listenBelowEphemeral(listen: (port: number) => Promise<unknown>): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const port = 26000 + Math.floor(Math.random() * 6000);
    try {
      await listen(port);
      return port;
    } catch (err) {
      if ((err as { code?: string }).code !== "EADDRINUSE" || attempt >= 20) throw err;
    }
  }
}

type StartOptions = NonNullable<Parameters<typeof startApi>[0]>;
async function fresh(options: Omit<StartOptions, "logStream"> = {}) {
  const api = await startApi({ logStream, ...options, env: { LOG_LEVEL: "info", ...options.env } });
  const port = await listenBelowEphemeral((p) => api.app.listen({ port: p, host: "127.0.0.1" }));
  return { api, port };
}

/** `app.close()` capped (a stalled request must never hang the run), then the instance's handles. */
async function closeFresh(api: TestApi, capMs = 10_000): Promise<number> {
  const t0 = Date.now();
  const closing = api.close();
  const done = await Promise.race([closing.then(() => true), sleep(capMs).then(() => false)]);
  if (!done) {
    api.app.server.closeAllConnections();
    await closing;
  }
  return Date.now() - t0;
}

interface Client {
  readonly socket: Socket;
  text(): string;
  serverClosedAt: number | null;
}
function openClient(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const client: Client = { socket, text: () => Buffer.concat(chunks).toString("latin1"), serverClosedAt: null };
    socket.on("data", (c: Buffer) => chunks.push(c));
    socket.on("end", () => (client.serverClosedAt ??= Date.now()));
    socket.on("error", () => (client.serverClosedAt ??= Date.now()));
    socket.once("connect", () => resolve(client));
    socket.once("error", reject);
  });
}

function firstResponse(text: string): { status: number; headers: Record<string, string>; body: string } | null {
  const end = text.indexOf("\r\n\r\n");
  if (!text.startsWith("HTTP/1.1 ") || end < 0) return null;
  const [statusLine, ...lines] = text.slice(0, end).split("\r\n");
  const headers: Record<string, string> = {};
  for (const l of lines) {
    const i = l.indexOf(":");
    headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  const length = Number(headers["content-length"] ?? "0");
  const body = text.slice(end + 4, end + 4 + length);
  return body.length < length ? null : { status: Number(statusLine!.split(" ")[1]), headers, body };
}

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return Date.now() - t0;
    if (Date.now() - t0 >= timeoutMs) return -1;
    await sleep(25);
  }
}

function headOf(method: string, url: string, headers: Record<string, string | undefined>): Buffer {
  const lines = Object.entries(headers)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => `${k}: ${v}`);
  return Buffer.from(`${method} ${url} HTTP/1.1\r\nHost: x\r\n${lines.join("\r\n")}\r\n\r\n`, "latin1");
}
const authHeaders = (s: Session) => ({ Cookie: s.cookie, Origin: new URL(APP_ORIGIN).origin, "X-CSRF-Token": s.csrf });
function uploadHead(evidenceId: string, version: number, length: number, fileName = "synthetic.bin"): Buffer {
  return headOf("POST", `${T}/evidence/${evidenceId}/content`, {
    ...authHeaders(p.lead.session),
    "If-Match": `"${version}"`,
    "X-File-Name": fileName,
    "Content-Type": "application/octet-stream",
    "Content-Length": String(length),
  });
}
function jsonHead(length: number): Buffer {
  return headOf("POST", `${T}/evidence`, {
    ...authHeaders(p.lead.session),
    "Content-Type": "application/json",
    "Content-Length": String(length),
  });
}

async function newFile(title: string): Promise<{ id: string; version: number }> {
  const c = await call(base.app, "POST", `${T}/evidence`, {
    session: p.lead.session,
    body: { ownerUserId: p.lead.id, kind: "file", title },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  return { id: c.body.id as string, version: c.body.version as number };
}
const contentRowsOf = (evidenceId: string) =>
  base.db.selectFrom("evidence_content").selectAll().where("evidence_id", "=", evidenceId).execute();
const versionOf = async (evidenceId: string) =>
  (await base.db.selectFrom("evidence").select("version").where("id", "=", evidenceId).executeTakeFirstOrThrow())
    .version;
/** Files the evidence store holds for one item (final objects and `.part` temporary objects). */
function storedFilesOf(evidenceId: string): string[] {
  return readdirSync(testEvidenceDir(), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.parentPath.includes(evidenceId))
    .map((d) => join(d.parentPath, d.name));
}
/**
 * The states of one pool's database sessions (by application_name), read as the cluster's superuser: the app role
 * sees NULL in pg_stat_activity.state for these sessions (they log in as another user and SET ROLE), so a check made
 * as mth_app would always find "no session idle in transaction".
 */
async function sessionStates(applicationName: string): Promise<{
  sessions: number;
  visible: number;
  idleInTx: number;
  nonIdle: number;
}> {
  const { adminUrl, database } = inject("mthDb");
  const c = new pg.Client({ connectionString: adminUrl });
  c.on("error", () => undefined);
  await c.connect();
  try {
    const r = await c.query<{ sessions: string; visible: string; idle_in_tx: string; non_idle: string }>(
      `select count(*) sessions, count(state) visible,
              count(*) filter (where state like 'idle in transaction%') idle_in_tx,
              count(*) filter (where state <> 'idle') non_idle
         from pg_stat_activity where application_name = $1 and datname = $2`,
      [applicationName, database],
    );
    const row = r.rows[0]!;
    return {
      sessions: Number(row.sessions),
      visible: Number(row.visible),
      idleInTx: Number(row.idle_in_tx),
      nonIdle: Number(row.non_idle),
    };
  } finally {
    await c.end();
  }
}

/** A request through `inject` raced against `ms`: status -1 when it did not answer in time (the defect). */
async function timed(fn: () => Promise<{ statusCode: number }>, ms = 5_000): Promise<{ status: number; ms: number }> {
  const t0 = Date.now();
  const status = await Promise.race([fn().then((r) => r.statusCode), sleep(ms).then(() => -1)]);
  return { status, ms: Date.now() - t0 };
}

// ------------------------------------------------------------------------------------------------ F-DG2-411

describe("F-DG2-411: a stalled upload holds no pooled connection and no row lock", () => {
  it("reviewer's R8: N stalled uploads (N = pool size) leave /me and /readyz answering promptly; nothing is stored", async () => {
    const { api, port } = await fresh({ pool: { max: POOL_SIZE, applicationName: "api-test-r8" } });
    const from = logLines.length;
    const items: Array<{ id: string; version: number }> = [];
    for (let i = 0; i < POOL_SIZE; i++) items.push(await newFile(`Synthetic BE17 R8 ${i}`));
    const stalled: Client[] = [];
    for (const [i, f] of items.entries()) {
      const c = await openClient(port);
      c.socket.write(uploadHead(f.id, f.version, 10 * MiB, `r8-${i}.bin`));
      c.socket.write(Buffer.alloc(1024, 3));
      stalled.push(c);
    }
    await sleep(1_000);
    const sessions = await sessionStates("api-test-r8");
    const me = await timed(() =>
      api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } }),
    );
    const ready = await timed(() => api.app.inject({ method: "GET", url: "/readyz" }));
    // A concurrent edit of a stalled item is not blocked by a row lock either.
    const patch = await timed(() =>
      api.app.inject({
        method: "PATCH",
        url: `${T}/evidence/${items[0]!.id}`,
        headers: {
          cookie: p.lead.session.cookie,
          origin: new URL(APP_ORIGIN).origin,
          "x-csrf-token": p.lead.session.csrf,
          "if-match": `"${items[0]!.version}"`,
          "content-type": "application/json",
        },
        payload: { title: "Synthetic BE17 R8 edited while stalled" },
      }),
    );
    for (const c of stalled) c.socket.destroy();
    await sleep(500);
    const leftovers = items.flatMap((f) => storedFilesOf(f.id));
    const rows = (await Promise.all(items.map((f) => contentRowsOf(f.id)))).flat();
    const closeMs = await closeFresh(api);
    const errors = errorLinesSince(from);
    log("R8", {
      poolSize: POOL_SIZE,
      stalledUploads: POOL_SIZE,
      sessions,
      me,
      ready,
      patch,
      leftovers,
      rows: rows.length,
      closeMs,
      errors,
    });
    expect(sessions.visible).toBe(sessions.sessions); // the check sees every session's state
    expect(sessions.idleInTx).toBe(0);
    expect(me.status).toBe(200);
    expect(me.ms).toBeLessThan(PROMPT_MS);
    expect(ready.status).toBe(200);
    expect(ready.ms).toBeLessThan(PROMPT_MS);
    expect(patch.status).toBe(200);
    expect(patch.ms).toBeLessThan(PROMPT_MS);
    expect(leftovers).toEqual([]);
    expect(rows).toEqual([]);
    expect(errors).toEqual([]);
  }, 60_000);

  it("an upload whose If-Match goes stale during the body: 409 version_conflict, no content row, no object", async () => {
    const { api, port } = await fresh();
    const f = await newFile("Synthetic BE17 stale");
    const content = randomBytes(256 * 1024);
    const c = await openClient(port);
    c.socket.write(uploadHead(f.id, f.version, content.length));
    c.socket.write(content.subarray(0, 1024));
    await sleep(300); // the server is now receiving the body
    const patch = timed(() =>
      call(base.app, "PATCH", `${T}/evidence/${f.id}`, {
        session: p.lead.session,
        headers: { "if-match": `"${f.version}"` },
        body: { title: "Synthetic BE17 edited during the upload" },
      }).then((r) => ({ statusCode: r.status })),
    );
    // On HEAD the edit waits for the upload's row lock; finish the body after a bounded wait either way.
    const patched = await Promise.race([patch, sleep(3_000).then(() => null)]);
    c.socket.write(content.subarray(1024));
    await waitFor(() => firstResponse(c.text()) !== null, 10_000);
    const res = firstResponse(c.text());
    const body = res ? (JSON.parse(res.body) as { code?: string; currentVersion?: number }) : null;
    const patchAfter = patched ?? (await patch);
    c.socket.destroy();
    const rows = await contentRowsOf(f.id);
    const files = storedFilesOf(f.id);
    const version = await versionOf(f.id);
    const closeMs = await closeFresh(api);
    log("stale-if-match", {
      patchDuringBody: patched,
      patch: patchAfter,
      upload: { status: res?.status, ...body },
      rows: rows.length,
      files,
      version,
      closeMs,
    });
    expect(patched?.status).toBe(200);
    expect(patched!.ms).toBeLessThan(PROMPT_MS);
    expect(res?.status).toBe(409);
    expect(body).toMatchObject({ code: "version_conflict", currentVersion: f.version + 1 });
    expect(rows).toEqual([]);
    expect(files).toEqual([]);
    expect(version).toBe(f.version + 1);
  }, 60_000);

  it("valid uploads stay byte-exact with their sha256 (stored, recorded and downloaded), no temporary object left", async () => {
    const { api, port } = await fresh();
    const from = logLines.length;
    const out = [];
    for (const size of [1, 64 * 1024, 3 * MiB]) {
      const f = await newFile(`Synthetic BE17 valid ${size}`);
      const content = randomBytes(size);
      const c = await openClient(port);
      c.socket.write(Buffer.concat([uploadHead(f.id, f.version, content.length, `valid-${size}.bin`), content]));
      await waitFor(() => firstResponse(c.text()) !== null, 10_000);
      const res = firstResponse(c.text());
      c.socket.destroy();
      const rows = await contentRowsOf(f.id);
      const dl = await api.app.inject({
        method: "GET",
        url: `${T}/evidence/${f.id}/content`,
        headers: { cookie: p.auditor.session.cookie },
      });
      const files = storedFilesOf(f.id);
      out.push({ size, status: res?.status, rows: rows.length, sha: rows[0]?.sha256 === sha256(content), files });
      expect(res?.status).toBe(200);
      expect(JSON.parse(res!.body)).toMatchObject({ version: f.version + 1 });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sha256).toBe(sha256(content));
      expect(Number(rows[0]!.size_bytes)).toBe(size);
      expect(dl.statusCode).toBe(200);
      expect(dl.rawPayload.equals(content)).toBe(true);
      expect(files).toHaveLength(1);
      expect(files[0]!.endsWith(".part")).toBe(false);
    }
    const closeMs = await closeFresh(api);
    log("valid-uploads", { out, closeMs });
    expect(errorLinesSince(from)).toEqual([]);
  }, 60_000);

  it("sweep: downloads to slow readers (N+1 paused readers, pool size N) hold no pooled connection", async () => {
    const N = 2;
    const { api, port } = await fresh({ pool: { max: N, applicationName: "api-test-slow" } });
    const from = logLines.length;
    // A file far larger than the loopback socket buffers, so each response really waits on its reader.
    const f = await newFile("Synthetic BE17 slow reader");
    const content = randomBytes(24 * MiB);
    const up = await api.app.inject({
      method: "POST",
      url: `${T}/evidence/${f.id}/content`,
      headers: {
        cookie: p.lead.session.cookie,
        origin: new URL(APP_ORIGIN).origin,
        "x-csrf-token": p.lead.session.csrf,
        "if-match": `"${f.version}"`,
        "x-file-name": "slow-reader.bin",
        "content-type": "application/octet-stream",
      },
      payload: content,
    });
    expect(up.statusCode).toBe(200);
    const readers: Client[] = [];
    for (let i = 0; i <= N; i++) {
      const c = await openClient(port);
      c.socket.pause(); // a reader that reads nothing more: the server's writes back up on the socket
      c.socket.write(headOf("GET", `${T}/evidence/${f.id}/content`, { Cookie: p.auditor.session.cookie }));
      readers.push(c);
    }
    await sleep(1_000);
    const received = readers.map((c) => c.socket.bytesRead);
    const me = await timed(() =>
      api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } }),
    );
    const ready = await timed(() => api.app.inject({ method: "GET", url: "/readyz" }));
    const sessions = await sessionStates("api-test-slow");
    for (const c of readers) c.socket.destroy();
    const closeMs = await closeFresh(api);
    log("slow-readers", {
      poolSize: N,
      readers: N + 1,
      bytesReceivedWhilePaused: received,
      fileBytes: content.length,
      me,
      ready,
      sessions,
      closeMs,
    });
    // Every response is still in flight (the readers stopped long before the end of the file) ...
    for (const r of received) expect(r).toBeLessThan(content.length);
    // ... and none of them holds a pooled connection.
    expect(sessions.visible).toBe(sessions.sessions);
    expect(sessions.nonIdle).toBe(0);
    expect(me.status).toBe(200);
    expect(me.ms).toBeLessThan(PROMPT_MS);
    expect(ready.status).toBe(200);
    expect(ready.ms).toBeLessThan(PROMPT_MS);
    expect(errorLinesSince(from)).toEqual([]);
  }, 60_000);

  it("defence in depth: an exhausted pool answers 503 after the bounded checkout wait (and /readyz 503), never a hang", async () => {
    const { api } = await fresh({ pool: { max: 2, connectionTimeoutMs: 400 } });
    // Hold every pooled connection of this instance through its own Kysely handle (as a stuck handler would).
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holders = [0, 1].map(() => api.db.connection().execute(() => gate));
    await sleep(200);
    const me = await timed(() =>
      api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } }),
    );
    const meBody = (
      await api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } })
    ).json() as { code?: string };
    const ready = await timed(() => api.app.inject({ method: "GET", url: "/readyz" }));
    release();
    await Promise.all(holders);
    const meAfter = await timed(() =>
      api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } }),
    );
    const closeMs = await closeFresh(api);
    log("pool-exhausted", { me, meCode: meBody.code, ready, meAfter, closeMs });
    expect(me.status).toBe(503);
    expect(me.ms).toBeLessThan(PROMPT_MS);
    expect(meBody.code).toBe("unavailable");
    expect(ready.status).toBe(503);
    expect(ready.ms).toBeLessThan(PROMPT_MS);
    expect(meAfter.status).toBe(200);
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------ F-DG2-412

describe("F-DG2-412: an aborted or stalled body is never a 500 and never an error-level log", () => {
  type Case = {
    name: string;
    timeout: boolean;
    send: (c: Client, f: { id: string; version: number }) => Promise<void>;
  };
  const cases: Case[] = [
    {
      name: "R6a stalled JSON body, requestTimeout 408",
      timeout: true,
      send: async (c) => {
        c.socket.write(jsonHead(100));
        c.socket.write('{"title":');
      },
    },
    {
      name: "R6d JSON body aborted by the client",
      timeout: false,
      send: async (c) => {
        c.socket.write(jsonHead(100));
        c.socket.write('{"title":');
        await sleep(300);
        c.socket.destroy();
      },
    },
    {
      name: "R6c stalled upload body, requestTimeout 408",
      timeout: true,
      send: async (c, f) => {
        c.socket.write(uploadHead(f.id, f.version, MiB));
        c.socket.write(Buffer.alloc(1000, 2));
      },
    },
    {
      name: "R6e upload body aborted by the client",
      timeout: false,
      send: async (c, f) => {
        c.socket.write(uploadHead(f.id, f.version, 10 * MiB));
        c.socket.write(randomBytes(2 * MiB));
        await sleep(300);
        c.socket.destroy();
      },
    },
  ];
  for (const k of cases) {
    it(`${k.name}: answered (if at all) below 500, logged below error level, nothing stored`, async () => {
      const { api, port } = await fresh(
        k.timeout ? { server: { requestTimeoutMs: 1_500, connectionsCheckingIntervalMs: 200 } } : {},
      );
      const f = await newFile(`Synthetic BE17 ${k.name.slice(0, 3)}`);
      const from = logLines.length;
      const c = await openClient(port);
      await k.send(c, f);
      if (k.timeout) await waitFor(() => c.serverClosedAt !== null, 6_000);
      // The incomplete-body line is the mapping's evidence that the error reached the handler and was classified.
      const classified = await waitFor(
        () => logLines.slice(from).some((l) => l.msg === "request body not received completely"),
        3_000,
      );
      await sleep(300);
      const res = firstResponse(c.text());
      c.socket.destroy();
      const errors = errorLinesSince(from);
      const serverErrors = serverErrorsSince(from);
      const rows = await contentRowsOf(f.id);
      const files = storedFilesOf(f.id);
      const closeMs = await closeFresh(api);
      const completed = logLines
        .slice(from)
        .filter((l) => l.msg === "request completed")
        .map((l) => l.res?.statusCode);
      log(k.name.slice(0, 3), {
        status: res?.status ?? null,
        classified,
        completed,
        errors,
        rows: rows.length,
        files,
        closeMs,
      });
      if (k.timeout) expect(res?.status).toBe(408);
      expect(classified).toBeGreaterThanOrEqual(0);
      expect(errors).toEqual([]);
      expect(serverErrors).toEqual([]);
      expect(completed.every((s) => s === 400)).toBe(true);
      expect(rows).toEqual([]);
      expect(files).toEqual([]);
    }, 60_000);
  }

  it("no over-match: a database-side ECONNRESET while the request body is still arriving is a 500 with an error log", async () => {
    const proxy = await resettingProxy(new URL(inject("mthDb").appUrl));
    const target = new URL(inject("mthDb").appUrl);
    target.hostname = "127.0.0.1";
    target.port = String(proxy.port);
    const { api, port } = await fresh({ env: { DATABASE_URL: target.toString() } });
    try {
      // Warm the pool through the proxy, then reset every database connection (and every new one).
      const warm = await api.app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: { cookie: p.sponsor.session.cookie },
      });
      expect(warm.statusCode).toBe(200);
      const f = await newFile("Synthetic BE17 db reset");
      const from = logLines.length;
      proxy.resetAll();
      await sleep(300); // the pool sees its idle connections fail and drops them
      const c = await openClient(port);
      c.socket.write(uploadHead(f.id, f.version, MiB));
      c.socket.write(Buffer.alloc(1024, 1)); // the body is incomplete while the session lookup hits the reset
      await waitFor(() => firstResponse(c.text()) !== null, 10_000);
      const res = firstResponse(c.text());
      c.socket.destroy();
      const errors = errorLinesSince(from);
      log("db-econnreset", {
        status: res?.status,
        resets: proxy.resets(),
        errors: errors.map((e) => ({ msg: e.msg, code: e.err?.code, message: e.err?.message })),
      });
      expect(proxy.resets()).toBeGreaterThan(0);
      expect(res?.status).toBe(500);
      expect(JSON.parse(res!.body)).toMatchObject({ code: "internal" });
      expect(errors.some((e) => e.err?.code === "ECONNRESET")).toBe(true);
      expect(logLines.slice(from).some((l) => l.msg === "request body not received completely")).toBe(false);
    } finally {
      await closeFresh(api);
      await proxy.close();
    }
  }, 60_000);
});

/**
 * A TCP proxy in front of the run's PostgreSQL. `resetAll()` resets (TCP RST) every open database connection and from
 * then on answers the first packet of every new connection (the startup message) with a RST, so node-postgres reports
 * a real socket error `read ECONNRESET` (syscall "read") to the query that needed a connection. (A RST in the middle of
 * an extended-protocol query surfaces in pg 8.16.3 as "Connection terminated unexpectedly" instead, which carries no
 * ECONNRESET code and is no test of the over-match rule.)
 */
async function resettingProxy(upstream: URL) {
  let resetting = false;
  let resets = 0;
  const open = new Set<Socket>();
  const server: Server = createServer((down) => {
    open.add(down);
    down.on("close", () => open.delete(down));
    if (resetting) {
      down.once("data", () => {
        resets++;
        down.resetAndDestroy();
      });
      down.on("error", () => undefined);
      return;
    }
    const up = connect(
      Number(upstream.port || 5432),
      upstream.hostname === "localhost" ? "127.0.0.1" : upstream.hostname,
    );
    down.on("data", (d: Buffer) => up.write(d));
    up.on("data", (d: Buffer) => down.write(d));
    up.on("error", () => down.destroy());
    up.on("close", () => {
      if (!resetting && !down.destroyed) down.destroy();
    });
    down.on("error", () => up.destroy());
    down.on("close", () => up.destroy());
  });
  const port = await listenBelowEphemeral(
    (p) =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(p, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      }),
  );
  return {
    port,
    resetAll: () => {
      resetting = true;
      for (const s of open) {
        resets++;
        s.resetAndDestroy();
      }
    },
    resets: () => resets,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of open) s.destroy();
        server.close(() => resolve());
      }),
  };
}
