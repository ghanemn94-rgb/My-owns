// T-DG2-BE16 (audit round 10, blocking condition 2): a request body the server answers before consuming never holds a
// connection, and shutdown is bounded. Everything here runs over a REAL socket (llhttp), not `inject`, against the
// run's disposable PostgreSQL.
//   Before: a 30 MiB chunked (or Content-Length) over-limit upload got 413 evidence.too_large with
//   `Connection: keep-alive`; the server paused the socket and held it ~72 s (Fastify keepAliveTimeout) after the
//   client went away, and `app.close()` waited for that. A 4xx sent before the body was read drained the whole body
//   (unbounded) and kept the connection. A stalled upload held its connection with no limit, so shutdown never ended.
//   Now: `Connection: close`, the server closes the socket shortly after the response (bounded lingering close),
//   its connection count returns to 0, `app.close()` completes promptly (a stalled request gets at most the shutdown
//   grace period) and SIGTERM exits within the grace period. Unmatched-route 404s are rate limited.
// Each scenario logs one `SWEEP {...}` line: the evidence for the handback's before/after table. All data is
// SYNTHETIC. G1-G6 are PRODUCT gates (business approvals), unrelated to the engineering gates DG0-DG7.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { assertContract } from "../support/contract.ts";
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

const logLines: Array<{ level: number; msg: string; requestId?: string }> = [];
const logStream = {
  write(line: string) {
    for (const l of line.split("\n").filter(Boolean)) logLines.push(JSON.parse(l) as (typeof logLines)[number]);
  },
};
const errorLogs = () => logLines.filter((l) => l.level >= 50 || l.msg === "unhandled error");

const MiB = 1024 * 1024;
/** How long the server may take to close a refused connection after its response (lingering close: 0.5 s). */
const CLOSE_BOUND_MS = 2_000;
/** How long `app.close()` may take once no request is in flight. */
const APP_CLOSE_BOUND_MS = 2_000;
/** The bounded waits used when the server does NOT close (negative control): never a 60 s hang. */
const OBSERVE_MS = 3_000;

let base: TestApi;
let basePort: number;
let w: World;
let p: P2World;
let T: string;
beforeAll(async () => {
  base = await startApi({ logStream, env: { LOG_LEVEL: "info" } });
  w = await seedWorld(base.db);
  p = await setupP2World(base, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  basePort = await listenBelowEphemeral(base);
}, 60_000);
afterAll(async () => {
  await timedClose(base, 10_000);
  await base.close();
}, 60_000);

// ------------------------------------------------------------------------------------------------ helpers

/** Listens on a free port in 26000-31999 (below the Linux ephemeral range); retries on a collision. */
async function listenBelowEphemeral(api: TestApi): Promise<number> {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const connectionsOf = (api: TestApi) =>
  new Promise<number>((resolve) => api.app.server.getConnections((_e, n) => resolve(n)));

/** Polls until `cond()` holds; resolves with the elapsed ms, or -1 after `timeoutMs`. */
async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return Date.now() - t0;
    if (Date.now() - t0 >= timeoutMs) return -1;
    await sleep(25);
  }
}

/**
 * `app.close()` raced against `capMs`. When the cap is hit (the defect), the remaining connections are destroyed so
 * the run never hangs; `completed` then is false and `ms` is the cap.
 */
async function timedClose(api: TestApi, capMs: number): Promise<{ ms: number; completed: boolean }> {
  const t0 = Date.now();
  const closing = api.app.close();
  const done = await Promise.race([closing.then(() => true), sleep(capMs).then(() => false)]);
  if (!done) {
    api.app.server.closeAllConnections();
    await closing;
  }
  return { ms: Date.now() - t0, completed: done };
}

/** A fresh API instance on the same database (each one is closed by its test). */
type ServerSettings = NonNullable<NonNullable<Parameters<typeof startApi>[0]>["server"]>;
async function fresh(server: ServerSettings = {}) {
  const api = await startApi({ logStream, env: { LOG_LEVEL: "info" }, server });
  const port = await listenBelowEphemeral(api);
  return { api, port };
}

interface Client {
  readonly socket: Socket;
  text(): string;
  firstByteAt: number | null;
  /** When the server ended (FIN) or reset the connection; null while it keeps it open. */
  serverClosedAt: number | null;
  readonly closed: Promise<void>;
}

function openClient(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    let resolveClosed!: () => void;
    const client: Client = {
      socket,
      text: () => Buffer.concat(chunks).toString("latin1"),
      firstByteAt: null,
      serverClosedAt: null,
      closed: new Promise<void>((r) => (resolveClosed = r)),
    };
    socket.on("data", (c: Buffer) => {
      client.firstByteAt ??= Date.now();
      chunks.push(c);
    });
    socket.on("end", () => (client.serverClosedAt ??= Date.now()));
    socket.on("error", () => (client.serverClosedAt ??= Date.now()));
    socket.on("close", () => resolveClosed());
    socket.once("connect", () => resolve(client));
    socket.once("error", reject);
  });
}

/** Writes with backpressure; resolves false once the connection is gone. */
async function write(client: Client, data: Buffer | string): Promise<boolean> {
  const s = client.socket;
  if (s.destroyed || client.serverClosedAt !== null) return false;
  if (s.write(data)) return true;
  await Promise.race([new Promise((r) => s.once("drain", r)), client.closed]);
  return !s.destroyed && client.serverClosedAt === null;
}

const chunkOf = (b: Buffer) => Buffer.concat([Buffer.from(`${b.length.toString(16)}\r\n`), b, Buffer.from("\r\n")]);

/** Sends body bytes for as long as the server keeps the connection (an unbounded body), at most `maxMs`. */
async function pumpEndlessBody(client: Client, framing: Framing, maxMs: number): Promise<number> {
  const piece = Buffer.alloc(64 * 1024, 0x61);
  const t0 = Date.now();
  let sent = 0;
  while (Date.now() - t0 < maxMs) {
    if (!(await write(client, framing === "chunked" ? chunkOf(piece) : piece))) break;
    sent += piece.length;
    await sleep(5);
  }
  return sent;
}

/** The first HTTP response on the connection: status, lower-cased headers, body (by Content-Length). */
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
  return { status: Number(statusLine!.split(" ")[1]), headers, body: text.slice(end + 4, end + 4 + length) };
}
const statusesOf = (text: string) => text.match(/HTTP\/1\.1 \d{3}/g) ?? [];

type Framing = "content-length" | "chunked";

interface UploadHead {
  readonly evidenceId: string;
  readonly version?: number | null;
  readonly framing: Framing;
  /** The declared Content-Length (content-length framing). */
  readonly length?: number;
  readonly session?: Session | null;
  readonly csrf?: boolean;
  readonly fileName?: string;
  readonly contentType?: string;
  readonly url?: string;
  readonly keepAlive?: boolean;
}

function headOf(method: string, url: string, headers: Record<string, string | undefined>): Buffer {
  const lines = Object.entries(headers)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => `${k}: ${v}`);
  return Buffer.from(`${method} ${url} HTTP/1.1\r\nHost: x\r\n${lines.join("\r\n")}\r\n\r\n`, "latin1");
}

function uploadHead(o: UploadHead): Buffer {
  const session = o.session === undefined ? p.lead.session : o.session;
  return headOf("POST", o.url ?? `${T}/evidence/${o.evidenceId}/content`, {
    Cookie: session?.cookie,
    Origin: new URL(APP_ORIGIN).origin,
    "X-CSRF-Token": session && o.csrf !== false ? session.csrf : undefined,
    "If-Match": o.version === null ? undefined : `"${o.version ?? 1}"`,
    "X-File-Name": o.fileName ?? "synthetic.bin",
    "Content-Type": o.contentType ?? "application/octet-stream",
    ...(o.framing === "chunked" ? { "Transfer-Encoding": "chunked" } : { "Content-Length": String(o.length ?? 0) }),
    ...(o.keepAlive === false ? { Connection: "close" } : {}),
  });
}

async function newEvidence(kind: "file" | "note", title: string): Promise<{ id: string; version: number }> {
  const c = await call(base.app, "POST", `${T}/evidence`, {
    session: p.lead.session,
    body: { ownerUserId: p.lead.id, kind, title, ...(kind === "note" ? { noteBody: "Synthetic note" } : {}) },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  return { id: c.body.id as string, version: c.body.version as number };
}

async function contentRowsOf(evidenceId: string) {
  return base.db.selectFrom("evidence_content").selectAll().where("evidence_id", "=", evidenceId).execute();
}
async function versionOf(evidenceId: string): Promise<number> {
  const r = await base.db
    .selectFrom("evidence")
    .select("version")
    .where("id", "=", evidenceId)
    .executeTakeFirstOrThrow();
  return r.version;
}
/** Files the evidence store holds for one evidence item (final objects and `.part` temp files). */
function storedFilesOf(evidenceId: string): string[] {
  return readdirSync(testEvidenceDir(), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.parentPath.includes(evidenceId))
    .map((d) => join(d.parentPath, d.name));
}
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

interface Observation {
  status: number | null;
  code: string | undefined;
  connection: string | undefined;
  /** ms from the first response byte to the server's FIN/RST; -1 when the server kept the connection. */
  serverCloseMs: number;
  /** ms (after the client is gone) until the server's connection count is 0; -1 when it was not within the wait. */
  connectionsZeroMs: number;
}

/**
 * Waits for the response and for the server to close (at most OBSERVE_MS), then destroys the client and waits for the
 * server's connection count to return to 0 (at most OBSERVE_MS). Logs a SWEEP line.
 */
async function observe(api: TestApi, client: Client, path: string, method = "POST", url = ""): Promise<Observation> {
  await waitFor(() => client.firstByteAt !== null && client.serverClosedAt !== null, OBSERVE_MS);
  const res = firstResponse(client.text());
  const serverCloseMs =
    client.firstByteAt !== null && client.serverClosedAt !== null ? client.serverClosedAt - client.firstByteAt : -1;
  client.socket.destroy();
  const connectionsZeroMs = await waitFor(async () => (await connectionsOf(api)) === 0, OBSERVE_MS);
  let code: string | undefined;
  try {
    const body = JSON.parse(res?.body ?? "") as { code?: string; errors?: Array<{ code: string }> };
    code = body.errors?.[0]?.code ?? body.code;
  } catch {
    code = undefined;
  }
  if (res && url) assertContract(method, url, { statusCode: res.status, headers: res.headers, body: res.body });
  const o: Observation = {
    status: res?.status ?? null,
    code,
    connection: res?.headers["connection"],
    serverCloseMs,
    connectionsZeroMs,
  };
  console.log(`SWEEP ${JSON.stringify({ path, ...o })}`);
  return o;
}

/** The refused-body expectation: declared status, Connection: close, the server closes, nothing left open. */
/**
 * The refused-body expectation: declared status, Connection: close, the server closes, nothing left open. Soft
 * assertions, so one run records (SWEEP lines) and reports every path, also on the pre-fix code (negative control).
 */
function expectClosedRefusal(o: Observation, status: number, code?: string) {
  const label = JSON.stringify(o);
  expect.soft(o.status, label).toBe(status);
  if (code !== undefined) expect.soft(o.code, label).toBe(code);
  expect.soft(o.connection, label).toBe("close");
  expect.soft(o.serverCloseMs, label).toBeGreaterThanOrEqual(0);
  expect.soft(o.serverCloseMs, label).toBeLessThanOrEqual(CLOSE_BOUND_MS);
  expect.soft(o.connectionsZeroMs, label).toBeGreaterThanOrEqual(0);
  expect.soft(o.connectionsZeroMs, label).toBeLessThanOrEqual(CLOSE_BOUND_MS);
}

function expectPromptClose(c: { ms: number; completed: boolean }, label: string, bound = APP_CLOSE_BOUND_MS) {
  console.log(`SWEEP-CLOSE ${JSON.stringify({ label, ...c })}`);
  expect.soft(c.completed, label).toBe(true);
  expect.soft(c.ms, label).toBeLessThanOrEqual(bound);
}

// ------------------------------------------------------------------------------------------------ the auditor's scenario

describe("an over-limit upload (413 evidence.too_large) closes its connection and never stalls app.close()", () => {
  for (const framing of ["chunked", "content-length"] as const) {
    it(`30 MiB ${framing}, written without backpressure like the audit repro: 413, Connection: close, server closes, 0 connections, app.close() prompt`, async () => {
      const { api, port } = await fresh();
      try {
        const f = await newEvidence("file", `Synthetic over-limit ${framing}`);
        const errorsBefore = errorLogs().length;
        const client = await openClient(port);
        const mb = Buffer.alloc(MiB, 0xfe);
        // As in the audit repro (zz-aud-diag P5s): every byte is queued at once, ignoring backpressure.
        client.socket.write(uploadHead({ evidenceId: f.id, version: f.version, framing, length: 30 * MiB }));
        for (let i = 0; i < 30; i += 1) client.socket.write(framing === "chunked" ? chunkOf(mb) : mb);
        if (framing === "chunked") client.socket.write("0\r\n\r\n");
        const o = await observe(
          api,
          client,
          `upload 30 MiB ${framing} over the limit`,
          "POST",
          `${T}/evidence/${f.id}/content`,
        );
        expectClosedRefusal(o, 413, "evidence.too_large");
        expect(await contentRowsOf(f.id)).toEqual([]);
        expect(storedFilesOf(f.id)).toEqual([]);
        expect(await versionOf(f.id)).toBe(f.version);
        expect(errorLogs().length - errorsBefore).toBe(0);
        expectPromptClose(await timedClose(api, OBSERVE_MS * 2), `after upload 30 MiB ${framing} over the limit`);
      } finally {
        await timedClose(api, 10_000);
        await api.close();
      }
    }, 60_000);
  }
});

// ------------------------------------------------------------------------------------------------ refused before the body is read

describe("a response sent before the body is read closes the connection and never drains the (unbounded) body", () => {
  it("upload route 401/403/404/409/428/400/422, JSON bodyLimit (CL and chunked), media type, unmatched 404, bad URL; then app.close() is prompt", async () => {
    const { api, port } = await fresh();
    try {
      const f = await newEvidence("file", "Synthetic refusals");
      const note = await newEvidence("note", "Synthetic note refusal");
      const errorsBefore = errorLogs().length;
      const upload = (h: Omit<UploadHead, "framing">) => ({ ...h, framing: "chunked" as const });
      const UP = `${T}/evidence/${f.id}/content`;
      // `contract`: the operation URL the response is asserted against; none for the unmatched route and the bad URL
      // (no operation matched: outside the contract by design, ADR-0007 §5b).
      const cases: Array<{
        name: string;
        head: Buffer;
        framing: Framing;
        status: number;
        code?: string;
        contract?: string;
      }> = [
        {
          name: "upload 401 no session",
          head: uploadHead(upload({ evidenceId: f.id, session: null })),
          framing: "chunked",
          contract: UP,
          status: 401,
        },
        {
          name: "upload 403 no CSRF token",
          head: uploadHead(upload({ evidenceId: f.id, csrf: false })),
          framing: "chunked",
          contract: UP,
          status: 403,
        },
        {
          name: "upload 404 unknown evidence",
          head: uploadHead(upload({ evidenceId: uuidv7() })),
          framing: "chunked",
          contract: UP,
          status: 404,
        },
        {
          name: "upload 409 stale If-Match",
          head: uploadHead(upload({ evidenceId: f.id, version: f.version + 7 })),
          framing: "chunked",
          contract: UP,
          status: 409,
        },
        {
          name: "upload 428 no If-Match",
          head: uploadHead(upload({ evidenceId: f.id, version: null })),
          framing: "chunked",
          contract: UP,
          status: 428,
        },
        {
          name: "upload 400 bad X-File-Name",
          head: uploadHead(upload({ evidenceId: f.id, fileName: "%FF.bin" })),
          framing: "chunked",
          contract: UP,
          status: 400,
          code: "validation.file_name",
        },
        {
          name: "upload 422 not a file",
          head: uploadHead(upload({ evidenceId: note.id, version: note.version })),
          framing: "chunked",
          contract: UP,
          status: 422,
          code: "validation.evidence.not_a_file",
        },
        {
          name: "upload 400 undeclared media type (text/plain)",
          head: uploadHead(upload({ evidenceId: f.id, contentType: "text/plain" })),
          framing: "chunked",
          contract: UP,
          status: 400,
          code: "validation.content_type",
        },
        {
          name: "upload 401 Content-Length 30 MiB",
          head: uploadHead({ evidenceId: f.id, session: null, framing: "content-length", length: 30 * MiB }),
          framing: "content-length",
          contract: UP,
          status: 401,
        },
        {
          name: "upload 428 Content-Length 30 MiB",
          head: uploadHead({ evidenceId: f.id, version: null, framing: "content-length", length: 30 * MiB }),
          framing: "content-length",
          contract: UP,
          status: 428,
        },
      ];
      const json = (framing: Framing, length?: number) =>
        headOf("POST", `${T}/evidence`, {
          Cookie: p.lead.session.cookie,
          Origin: new URL(APP_ORIGIN).origin,
          "X-CSRF-Token": p.lead.session.csrf,
          "Content-Type": "application/json",
          ...(framing === "chunked" ? { "Transfer-Encoding": "chunked" } : { "Content-Length": String(length) }),
        });
      cases.push(
        {
          name: "JSON over bodyLimit, chunked",
          head: json("chunked"),
          framing: "chunked",
          status: 400,
          code: "validation.body_too_large",
          contract: `${T}/evidence`,
        },
        {
          name: "JSON over bodyLimit, Content-Length",
          head: json("content-length", 30 * MiB),
          framing: "content-length",
          status: 400,
          code: "validation.body_too_large",
          contract: `${T}/evidence`,
        },
        {
          name: "unmatched route 404, chunked",
          head: headOf("POST", "/api/v1/no-such-route", {
            "Content-Type": "application/octet-stream",
            "Transfer-Encoding": "chunked",
          }),
          framing: "chunked",
          status: 404,
        },
        {
          name: "unmatched route 404, Content-Length 30 MiB",
          head: headOf("PUT", "/api/v1/no-such-route", { "Content-Length": String(30 * MiB) }),
          framing: "content-length",
          status: 404,
        },
        {
          name: "router-level 400 bad URL (FST_ERR_BAD_URL), chunked",
          head: headOf("POST", `${T}/evidence/%ZZ/content`, {
            "Content-Type": "application/octet-stream",
            "Transfer-Encoding": "chunked",
          }),
          framing: "chunked",
          status: 400,
          code: "validation.format",
        },
      );
      for (const c of cases) {
        const client = await openClient(port);
        await write(client, c.head);
        // The body never ends: a server that drained it would never answer the close the policy requires.
        const pumping = pumpEndlessBody(client, c.framing, OBSERVE_MS + 1_000);
        const o = await observe(api, client, c.name, "POST", c.contract ?? "");
        await pumping;
        expectClosedRefusal(o, c.status, c.code);
      }
      expect(await contentRowsOf(f.id)).toEqual([]);
      expect(storedFilesOf(f.id)).toEqual([]);
      expect(await versionOf(f.id)).toBe(f.version);
      expect(errorLogs().length - errorsBefore).toBe(0);
      expectPromptClose(await timedClose(api, OBSERVE_MS * 2), "after the refusals sweep");
    } finally {
      await timedClose(api, 10_000);
      await api.close();
    }
  }, 180_000);

  it("app.close() while a refused client (403, no CSRF token) KEEPS SENDING its body completes promptly", async () => {
    const { api, port } = await fresh();
    try {
      const f = await newEvidence("file", "Synthetic refused sender");
      const client = await openClient(port);
      await write(client, uploadHead({ evidenceId: f.id, csrf: false, framing: "chunked" }));
      const pumping = pumpEndlessBody(client, "chunked", 12_000);
      await waitFor(() => client.firstByteAt !== null, OBSERVE_MS);
      await sleep(200); // the client is still sending
      const c = await timedClose(api, 8_000);
      client.socket.destroy();
      await pumping;
      expect.soft(firstResponse(client.text())?.status).toBe(403);
      expectPromptClose(c, "while a refused (403) client keeps sending its body");
    } finally {
      await timedClose(api, 10_000);
      await api.close();
    }
  }, 60_000);

  it("a small refused body that arrived completely keeps the keep-alive connection (it is bounded and already read)", async () => {
    const f = await newEvidence("file", "Synthetic small refusal");
    const client = await openClient(basePort);
    const body = Buffer.from("tiny");
    await write(
      client,
      Buffer.concat([
        uploadHead({ evidenceId: f.id, version: null, framing: "content-length", length: body.length }),
        body,
      ]),
    );
    await waitFor(() => statusesOf(client.text()).length === 1, OBSERVE_MS);
    await sleep(100);
    await write(client, headOf("GET", "/healthz", {}));
    await waitFor(() => statusesOf(client.text()).length === 2, OBSERVE_MS);
    expect(statusesOf(client.text())).toEqual(["HTTP/1.1 428", "HTTP/1.1 200"]);
    expect(client.serverClosedAt).toBeNull();
    client.socket.destroy();
  });
});

// ------------------------------------------------------------------------------------------------ client abort

describe("a client that aborts mid-upload leaves no partial object and no leaked socket", () => {
  for (const framing of ["content-length", "chunked"] as const) {
    it(`${framing}: 2 MiB of a 10 MiB upload, then the client destroys the socket`, async () => {
      const f = await newEvidence("file", `Synthetic abort ${framing}`);
      const errorsBefore = errorLogs().length;
      const client = await openClient(basePort);
      await write(client, uploadHead({ evidenceId: f.id, version: f.version, framing, length: 10 * MiB }));
      const piece = randomBytes(256 * 1024);
      for (let i = 0; i < 8; i += 1) await write(client, framing === "chunked" ? chunkOf(piece) : piece);
      await sleep(300); // the handler is streaming into the store
      client.socket.destroy();
      const connectionsZeroMs = await waitFor(async () => (await connectionsOf(base)) === 0, OBSERVE_MS);
      const settled = await waitFor(() => storedFilesOf(f.id).length === 0, OBSERVE_MS);
      console.log(
        `SWEEP ${JSON.stringify({ path: `client abort mid-upload ${framing}`, connectionsZeroMs, partialFilesGoneMs: settled })}`,
      );
      expect(connectionsZeroMs).toBeGreaterThanOrEqual(0);
      expect(connectionsZeroMs).toBeLessThanOrEqual(CLOSE_BOUND_MS);
      expect(settled).toBeGreaterThanOrEqual(0);
      expect(storedFilesOf(f.id)).toEqual([]);
      expect(await contentRowsOf(f.id)).toEqual([]);
      expect(await versionOf(f.id)).toBe(f.version);
      expect(errorLogs().slice(errorsBefore)).toEqual([]);
      // The row lock and the transaction are gone: the same If-Match uploads normally.
      const ok = await call(base.app, "POST", `${T}/evidence/${f.id}/content`, {
        session: p.lead.session,
        headers: {
          "if-match": `"${f.version}"`,
          "content-type": "application/octet-stream",
          "x-file-name": "after-abort.bin",
        },
        body: Buffer.from("synthetic after abort"),
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    });
  }
});

// ------------------------------------------------------------------------------------------------ positive controls

describe("normal traffic is unchanged", () => {
  it("a valid 3 MiB upload over a real socket is stored byte-exact with its sha256, and the keep-alive connection serves the next request", async () => {
    const f = await newEvidence("file", "Synthetic valid upload");
    const bytes = randomBytes(3 * MiB);
    const client = await openClient(basePort);
    await write(
      client,
      uploadHead({ evidenceId: f.id, version: f.version, framing: "content-length", length: bytes.length }),
    );
    for (let i = 0; i < bytes.length; i += 128 * 1024) await write(client, bytes.subarray(i, i + 128 * 1024));
    await waitFor(() => firstResponse(client.text()) !== null, 10_000);
    const res = firstResponse(client.text())!;
    expect(res.status, res.body).toBe(200);
    expect(res.headers["connection"]).toBe("keep-alive");
    assertContract("POST", `${T}/evidence/${f.id}/content`, {
      statusCode: res.status,
      headers: res.headers,
      body: res.body,
    });
    const rows = await contentRowsOf(f.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sha256).toBe(sha256(bytes));
    expect(Number(rows[0]!.size_bytes)).toBe(bytes.length);
    // The same connection is kept and serves the next request.
    await sleep(700); // longer than the lingering-close delay: a wrongly closed connection would be gone by now
    expect(client.serverClosedAt).toBeNull();
    await write(client, headOf("GET", "/healthz", {}));
    await waitFor(() => statusesOf(client.text()).length === 2, OBSERVE_MS);
    expect(statusesOf(client.text())).toEqual(["HTTP/1.1 200", "HTTP/1.1 200"]);
    expect(client.serverClosedAt).toBeNull();
    const download = await base.app.inject({
      method: "GET",
      url: `${T}/evidence/${f.id}/content`,
      headers: { cookie: p.lead.session.cookie },
    });
    expect(download.statusCode).toBe(200);
    expect(sha256(download.rawPayload)).toBe(sha256(bytes));
    client.socket.destroy();
  });
});

// ------------------------------------------------------------------------------------------------ bounded shutdown

describe("shutdown is bounded", () => {
  it("app.close() with a STALLED upload in flight completes within the grace period (default 5 s); the stalled socket is closed by the server", async () => {
    const { api, port } = await fresh();
    try {
      const f = await newEvidence("file", "Synthetic stalled upload");
      const client = await openClient(port);
      await write(
        client,
        uploadHead({ evidenceId: f.id, version: f.version, framing: "content-length", length: 10 * MiB }),
      );
      await write(client, randomBytes(256 * 1024));
      await sleep(300); // headers and part of the body are in; the client then sends nothing more
      const c = await timedClose(api, 15_000);
      console.log(`SWEEP-CLOSE ${JSON.stringify({ label: "stalled upload in flight (default grace 5 s)", ...c })}`);
      expect(c.completed).toBe(true);
      expect(c.ms).toBeLessThanOrEqual(5_000 + 1_500);
      expect(await waitFor(() => client.serverClosedAt !== null, 1_000)).toBeGreaterThanOrEqual(0);
      expect(await contentRowsOf(f.id)).toEqual([]);
      expect(await waitFor(() => storedFilesOf(f.id).length === 0, OBSERVE_MS)).toBeGreaterThanOrEqual(0);
      client.socket.destroy();
    } finally {
      await timedClose(api, 10_000);
      await api.close();
    }
  }, 60_000);

  it("an in-flight upload that finishes within the grace period completes normally (200, stored byte-exact, Connection: close), then app.close() returns", async () => {
    const { api, port } = await fresh({ shutdownGraceMs: 4_000 });
    try {
      const f = await newEvidence("file", "Synthetic in-flight upload");
      const bytes = randomBytes(2 * MiB);
      const client = await openClient(port);
      await write(
        client,
        uploadHead({ evidenceId: f.id, version: f.version, framing: "content-length", length: bytes.length }),
      );
      const quarter = bytes.length / 4;
      await write(client, bytes.subarray(0, quarter));
      await sleep(200);
      const t0 = Date.now();
      const closing = timedClose(api, 15_000);
      for (let i = 1; i < 4; i += 1) {
        await sleep(150);
        await write(client, bytes.subarray(i * quarter, (i + 1) * quarter));
      }
      const c = await closing;
      console.log(`SWEEP-CLOSE ${JSON.stringify({ label: "in-flight upload finishing during shutdown", ...c })}`);
      const res = firstResponse(client.text());
      expect(res?.status, res?.body).toBe(200);
      expect(res?.headers["connection"]).toBe("close");
      expect((await contentRowsOf(f.id))[0]?.sha256).toBe(sha256(bytes));
      expect(c.completed).toBe(true);
      expect(Date.now() - t0).toBeLessThan(4_000);
      client.socket.destroy();
    } finally {
      await timedClose(api, 10_000);
      await api.close();
    }
  }, 60_000);

  it("a body that stalls outside shutdown is cut by Node's requestTimeout (408, connection closed), nothing stored, no error log", async () => {
    const { api, port } = await fresh({ requestTimeoutMs: 1_500, connectionsCheckingIntervalMs: 250 });
    try {
      const f = await newEvidence("file", "Synthetic request timeout");
      const errorsBefore = errorLogs().length;
      const client = await openClient(port);
      await write(client, uploadHead({ evidenceId: f.id, version: f.version, framing: "chunked" }));
      await write(client, chunkOf(randomBytes(64 * 1024)));
      const closedMs = await waitFor(() => client.serverClosedAt !== null, 6_000);
      console.log(
        `SWEEP ${JSON.stringify({ path: "stalled body, requestTimeout 1.5 s", status: statusesOf(client.text()), closedMs })}`,
      );
      expect(closedMs).toBeGreaterThanOrEqual(0);
      expect(statusesOf(client.text())).toEqual(["HTTP/1.1 408"]);
      expect(await waitFor(async () => (await connectionsOf(api)) === 0, CLOSE_BOUND_MS)).toBeGreaterThanOrEqual(0);
      expect(await waitFor(() => storedFilesOf(f.id).length === 0, OBSERVE_MS)).toBeGreaterThanOrEqual(0);
      expect(await contentRowsOf(f.id)).toEqual([]);
      expect(errorLogs().slice(errorsBefore)).toEqual([]);
      client.socket.destroy();
    } finally {
      await timedClose(api, 10_000);
      await api.close();
    }
  }, 60_000);

  it("SIGTERM: the API process (src/main.ts) exits 0 within the grace period with a stalled upload in flight", async () => {
    const f = await newEvidence("file", "Synthetic SIGTERM");
    const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    const { appUrl } = inject("mthDb");
    let child: ReturnType<typeof spawn> | null = null;
    let port = 0;
    let out = "";
    for (let attempt = 0; attempt < 10 && child === null; attempt += 1) {
      port = 26000 + Math.floor(Math.random() * 6000);
      const proc = spawn(process.execPath, ["--conditions=@mth/source", "apps/api/src/main.ts"], {
        cwd: repoRoot,
        env: {
          PATH: process.env["PATH"] ?? "",
          NODE_ENV: "test",
          APP_BASE_URL: APP_ORIGIN,
          DATABASE_URL: appUrl,
          AUTH_MODE: "dev",
          PORT: String(port),
          LOG_LEVEL: "info",
          RATE_LIMIT_PER_MINUTE: "100000",
          AUTH_RATE_LIMIT_PER_MINUTE: "100000",
          EVIDENCE_STORAGE_PATH: testEvidenceDir(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      out = "";
      proc.stdout!.on("data", (d: Buffer) => (out += d.toString()));
      proc.stderr!.on("data", (d: Buffer) => (out += d.toString()));
      const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
      const ready = await Promise.race([
        waitFor(() => out.includes("mth-api listening"), 20_000).then((ms) => ms >= 0),
        exited.then(() => false),
      ]);
      if (ready) child = proc;
      else {
        proc.kill("SIGKILL");
        if (!out.includes("EADDRINUSE")) throw new Error(`API process failed to start:\n${out}`);
      }
    }
    expect(child).not.toBeNull();
    const proc = child!;
    const exited = new Promise<{ code: number | null; at: number }>((r) =>
      proc.once("exit", (code) => r({ code, at: Date.now() })),
    );
    try {
      const client = await openClient(port);
      await write(
        client,
        uploadHead({ evidenceId: f.id, version: f.version, framing: "content-length", length: 10 * MiB }),
      );
      await write(client, randomBytes(256 * 1024));
      await sleep(500);
      const t0 = Date.now();
      proc.kill("SIGTERM");
      const r = await Promise.race([exited, sleep(15_000).then(() => null)]);
      const ms = r ? r.at - t0 : -1;
      console.log(
        `SWEEP-CLOSE ${JSON.stringify({ label: "SIGTERM with a stalled upload (main.ts)", ms, exitCode: r?.code ?? null })}`,
      );
      expect(r).not.toBeNull();
      expect(r!.code).toBe(0);
      expect(ms).toBeLessThanOrEqual(5_000 + 2_000);
      expect(out).toContain('"msg":"shut down"');
      expect(await contentRowsOf(f.id)).toEqual([]);
      client.socket.destroy();
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    }
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------ unmatched-route rate limiting

describe("unmatched-route 404s are rate limited (audit round 10 observation P3)", () => {
  it("a flood on unmatched routes gets 429 rate_limited after the limit (same key and limit as the routes); the SPA fallback still serves index.html", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "mth-spa-it-"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Synthetic SPA</title>");
    const api = await startApi({
      logStream,
      env: { LOG_LEVEL: "info", RATE_LIMIT_PER_MINUTE: "4" },
      server: { webRoot },
    });
    try {
      const spa = await api.app.inject({ method: "GET", url: "/transformations/synthetic/deep-link" });
      expect(spa.statusCode).toBe(200);
      expect(spa.body).toContain("Synthetic SPA");
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const url = `/api/v1/no-such-route-${i}`;
        const r = await (i % 2
          ? api.app.inject({ method: "POST", url, payload: "x", headers: { "content-type": "text/plain" } })
          : api.app.inject({ method: "GET", url }));
        statuses.push(r.statusCode);
        if (r.statusCode === 429) {
          expect(r.headers["content-type"]).toMatch(/^application\/problem\+json/);
          expect(r.json()).toMatchObject({ status: 429, code: "rate_limited" });
          expect(r.headers["retry-after"]).toBeDefined();
        }
      }
      // 1 SPA load + 3 unmatched = the limit of 4; then 429 (the unmatched 429 is outside the contract by design,
      // like the unmatched 404: ADR-0007 §5b).
      console.log(`SWEEP ${JSON.stringify({ path: "unmatched-route flood, limit 4/min", statuses })}`);
      expect(statuses).toEqual([404, 404, 404, 429]);
      const spaAfter = await api.app.inject({ method: "GET", url: "/another/deep-link" });
      expect(spaAfter.statusCode).toBe(429); // the SPA fallback is metered like the static assets
      // A matched route shares the bucket (same key: the client IP here).
      expect((await api.app.inject({ method: "GET", url: "/api/v1/me" })).statusCode).toBe(429);
    } finally {
      await api.close();
    }
  });
});
