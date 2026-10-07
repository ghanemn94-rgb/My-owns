// code-security-reviewer DG2 round-11 adversarial probe (T-DG2-REV-SEC-R11). NOT part of the candidate: copied into a
// disposable clone at apps/api/test/integration/ and run on a disposable PostgreSQL 16. All data SYNTHETIC.
// Run at BOTH candidates:
//   - round-10 candidate 7fd1a89c (clone at 68fe3394 = source fe22d759 + metadata): reproduces the auditor's defect;
//   - round-11 candidate 23e6c0a2 (clone at 309aff2 = source cbdb4f6 + metadata): verifies the BE16 fix.
// Every assertion states the SECURE/declared expectation, so a failing assertion at 7fd1a89c is the defect, and every
// observation is logged as "PROBE <key>: <json>". At 7fd1a89c the startApi `server` option does not exist and is
// ignored (requestTimeout/shutdown grace are then Fastify/Node defaults); the S-tests that need it are expected to fail
// there and are not used as evidence for that candidate.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

const MiB = 1024 * 1024;
const LIMIT = 25 * MiB;
const logLines: Array<{ level: number; msg: string }> = [];
const logStream = {
  write(line: string) {
    for (const l of line.split("\n").filter(Boolean)) logLines.push(JSON.parse(l));
  },
};
const errorLogs = () => logLines.filter((l) => l.level >= 50 || l.msg === "unhandled error");
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

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

type ServerSettings = Record<string, unknown>;
async function fresh(env: Record<string, string> = {}, server: ServerSettings = {}) {
  const api = await startApi({ logStream, env: { LOG_LEVEL: "info", ...env }, server } as Parameters<typeof startApi>[0]);
  for (let attempt = 0; ; attempt++) {
    const port = 27000 + Math.floor(Math.random() * 5000);
    try {
      await api.app.listen({ port, host: "127.0.0.1" });
      return { api, port };
    } catch (err) {
      if ((err as { code?: string }).code !== "EADDRINUSE" || attempt >= 20) throw err;
    }
  }
}
const connectionsOf = (api: TestApi) => new Promise<number>((r) => api.app.server.getConnections((_e, n) => r(n)));
async function timedClose(api: TestApi, capMs: number) {
  const t0 = Date.now();
  const closing = api.app.close();
  const done = await Promise.race([closing.then(() => true), sleep(capMs).then(() => false)]);
  if (!done) {
    api.app.server.closeAllConnections();
    await closing;
  }
  const ms = Date.now() - t0;
  await api.db.destroy();
  await api.owner.end();
  return { ms, completed: done };
}

interface Client {
  s: Socket;
  t0: number;
  text(): string;
  serverEndAt: number | null;
  closedAt: number | null;
}
function client(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const s = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const c: Client = { s, t0: 0, text: () => Buffer.concat(chunks).toString("latin1"), serverEndAt: null, closedAt: null };
    s.on("data", (d) => chunks.push(d));
    s.on("end", () => (c.serverEndAt ??= Date.now() - c.t0));
    s.on("error", () => (c.serverEndAt ??= Date.now() - c.t0));
    s.on("close", () => (c.closedAt = Date.now() - c.t0));
    s.once("connect", () => {
      c.t0 = Date.now();
      resolve(c);
    });
    s.once("error", reject);
  });
}
function responses(text: string) {
  const out: Array<{ status: number; headers: Record<string, string>; body: string }> = [];
  let rest = text;
  for (;;) {
    const end = rest.indexOf("\r\n\r\n");
    if (end < 0 || !rest.startsWith("HTTP/1.1")) break;
    const [statusLine, ...lines] = rest.slice(0, end).split("\r\n");
    const headers: Record<string, string> = {};
    for (const l of lines) headers[l.slice(0, l.indexOf(":")).toLowerCase()] = l.slice(l.indexOf(":") + 1).trim();
    const len = Number(headers["content-length"] ?? 0);
    out.push({ status: Number(statusLine!.split(" ")[1]), headers, body: rest.slice(end + 4, end + 4 + len) });
    rest = rest.slice(end + 4 + len);
  }
  return out;
}
const auth = () => ({ Cookie: p.lead.session.cookie, Origin: new URL(String(base.config.appBaseUrl)).origin, "X-CSRF-Token": p.lead.session.csrf });
function head(method: string, url: string, h: Record<string, string | number | undefined>) {
  const lines = [`${method} ${url} HTTP/1.1`, "Host: 127.0.0.1"];
  for (const [k, v] of Object.entries(h)) if (v !== undefined) lines.push(`${k}: ${v}`);
  return Buffer.from(lines.join("\r\n") + "\r\n\r\n", "latin1");
}
async function newFile(title: string) {
  const c = await call(base.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { ownerUserId: p.lead.id, kind: "file", title } });
  expect(c.status).toBe(201);
  return { id: c.body.id as string, version: c.body.version as number };
}
const storedOf = async (id: string) =>
  (await sql<{ sha256: string }>`select c.sha256 from evidence e join evidence_content c on c.id = e.current_content_id where e.id = ${id}`.execute(base.db)).rows[0]?.sha256 ?? null;
const chunk = (b: Buffer) => Buffer.concat([Buffer.from(`${b.length.toString(16)}\r\n`), b, Buffer.from("\r\n")]);
async function waitFor(cond: () => boolean | Promise<boolean>, ms: number) {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return Date.now() - t0;
    if (Date.now() - t0 >= ms) return -1;
    await sleep(25);
  }
}

// ------------------------------------------------------------------------------------- R1: the auditor's defect
describe("R1 an over-limit 30 MiB upload over a real socket: 413, then the server lets go of the socket and app.close() is prompt", () => {
  for (const framing of ["chunked", "content-length"] as const) {
    it(`R1 ${framing}: 413 evidence.too_large, connection released <= 2.5 s after the client destroys it, app.close() <= 3 s`, async () => {
      const { api, port } = await fresh();
      const f = await newFile(`Synthetic R1 ${framing}`);
      const c = await client(port);
      const body = randomBytes(30 * MiB);
      c.s.write(
        head("POST", `${T}/evidence/${f.id}/content`, {
          ...auth(),
          ...{ "If-Match": ifm(f.version)["if-match"] },
          "X-File-Name": "r1.bin",
          "Content-Type": "application/octet-stream",
          ...(framing === "chunked" ? { "Transfer-Encoding": "chunked" } : { "Content-Length": body.length }),
        }),
      );
      // Written without waiting for backpressure, like the auditor's repro.
      for (let o = 0; o < body.length; o += 64 * 1024) {
        const part = body.subarray(o, o + 64 * 1024);
        if (!c.s.destroyed) c.s.write(framing === "chunked" ? chunk(part) : part);
      }
      if (framing === "chunked" && !c.s.destroyed) c.s.write("0\r\n\r\n");
      const gotResponse = await waitFor(() => responses(c.text()).length > 0, 15_000);
      const r = responses(c.text())[0];
      // Give the server up to 3 s to close on its own (lingering close cap 2 s).
      await waitFor(() => c.serverEndAt !== null, 3_000);
      const serverClosedOnItsOwn = c.serverEndAt;
      c.s.destroy();
      const releasedMs = await waitFor(async () => (await connectionsOf(api)) === 0, 70_000);
      const conns = await connectionsOf(api);
      const close = await timedClose(api, 100_000);
      const stored = await storedOf(f.id);
      log(`R1-${framing}`, {
        gotResponseMs: gotResponse,
        status: r?.status,
        connection: r?.headers.connection,
        code: r ? (JSON.parse(r.body || "{}") as { errors?: Array<{ code: string }>; code?: string }).errors?.[0]?.code ?? JSON.parse(r.body || "{}").code : null,
        serverClosedOnItsOwnMs: serverClosedOnItsOwn,
        serverReleasedAfterClientDestroyMs: releasedMs,
        connectionsAtClose: conns,
        appClose: close,
        stored,
      });
      expect(r?.status).toBe(413);
      expect(stored).toBeNull();
      expect(r?.headers.connection).toBe("close");
      expect(serverClosedOnItsOwn).not.toBeNull();
      expect(releasedMs).toBeGreaterThanOrEqual(0);
      expect(releasedMs).toBeLessThanOrEqual(2_500);
      expect(close.completed).toBe(true);
      expect(close.ms).toBeLessThanOrEqual(3_000);
    }, 200_000);
  }
});

describe("R1c the auditor's shutdown symptom: app.close() called right after the client destroys an over-limit chunked upload", () => {
  it("R1c chunked 30 MiB: app.close() completes <= 3 s (cap 100 s)", async () => {
    const { api, port } = await fresh();
    const f = await newFile("Synthetic R1c");
    const c = await client(port);
    const body = randomBytes(30 * MiB);
    c.s.write(head("POST", `${T}/evidence/${f.id}/content`, { ...auth(), "If-Match": `"${f.version}"`, "X-File-Name": "r1c.bin", "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" }));
    for (let o = 0; o < body.length; o += 64 * 1024) if (!c.s.destroyed) c.s.write(chunk(body.subarray(o, o + 64 * 1024)));
    if (!c.s.destroyed) c.s.write("0\r\n\r\n");
    await waitFor(() => responses(c.text()).length > 0, 15_000);
    const r = responses(c.text())[0];
    await sleep(1_000);
    c.s.destroy();
    const connsAtClose = await connectionsOf(api);
    const close = await timedClose(api, 100_000);
    log("R1c", { status: r?.status, connection: r?.headers.connection, connsAtClose, appClose: close });
    expect(r?.status).toBe(413);
    expect(close.completed).toBe(true);
    expect(close.ms).toBeLessThanOrEqual(3_000);
  }, 200_000);
});

// ------------------------------------------------------------------------------------- R2: normal keep-alive traffic
describe("R2 normal keep-alive traffic is unchanged", () => {
  it("R2 a 2 MiB upload (CL) is stored byte-exact; response keep-alive; the same socket then serves GET /api/v1/me and a JSON POST", async () => {
    const { api, port } = await fresh();
    const f = await newFile("Synthetic R2");
    const bytes = Buffer.concat([randomBytes(2 * MiB), Buffer.from([0xff, 0xfe, 0xed, 0xa0, 0x80, 0x00])]);
    const c = await client(port);
    c.s.write(head("POST", `${T}/evidence/${f.id}/content`, { ...auth(), "If-Match": `"${f.version}"`, "X-File-Name": "r2.bin", "Content-Type": "application/octet-stream", "Content-Length": bytes.length }));
    c.s.write(bytes);
    await waitFor(() => responses(c.text()).length >= 1, 15_000);
    c.s.write(head("GET", "/api/v1/me", { Cookie: p.lead.session.cookie }));
    await waitFor(() => responses(c.text()).length >= 2, 5_000);
    const json = Buffer.from(JSON.stringify({ ownerUserId: p.lead.id, kind: "note", title: "Synthetic R2 note ✓ عربي", noteBody: "Synthetic note body" }), "utf8");
    c.s.write(Buffer.concat([head("POST", `${T}/evidence`, { ...auth(), "Content-Type": "application/json", "Content-Length": json.length }), json]));
    await waitFor(() => responses(c.text()).length >= 3, 5_000);
    await sleep(300);
    const rs = responses(c.text());
    const stillOpen = c.serverEndAt === null;
    c.s.destroy();
    const close = await timedClose(api, 10_000);
    log("R2", { thirdBody: rs[2]?.body.slice(0, 300), statuses: rs.map((r) => r.status), connection: rs.map((r) => r.headers.connection), stillOpen, sent: sha(bytes), stored: await storedOf(f.id), appClose: close });
    expect(rs.map((r) => r.status)).toEqual([200, 200, 201]);
    for (const r of rs) expect(r.headers.connection).toBe("keep-alive");
    expect(stillOpen).toBe(true);
    expect(await storedOf(f.id)).toBe(sha(bytes));
    expect(close.ms).toBeLessThan(2_000);
  }, 60_000);

  it("R2b an over-limit body sent in full (LIMIT+1 and LIMIT+64 KiB, CL): 413; the connection is either closed by the server or serves the next request; never held", async () => {
    const out: unknown[] = [];
    for (const extra of [1, 64 * 1024]) {
      const { api, port } = await fresh();
      const f = await newFile(`Synthetic R2b ${extra}`);
      const c = await client(port);
      const body = randomBytes(LIMIT + extra);
      c.s.write(head("POST", `${T}/evidence/${f.id}/content`, { ...auth(), "If-Match": `"${f.version}"`, "X-File-Name": "r2b.bin", "Content-Type": "application/octet-stream", "Content-Length": body.length }));
      c.s.write(body);
      await waitFor(() => responses(c.text()).length >= 1, 20_000);
      if (!c.s.destroyed && c.serverEndAt === null) c.s.write(head("GET", "/api/v1/me", { Cookie: p.lead.session.cookie }));
      await waitFor(() => responses(c.text()).length >= 2 || c.serverEndAt !== null, 4_000);
      const rs = responses(c.text());
      const o = { extra, statuses: rs.map((r) => r.status), connection: rs.map((r) => r.headers.connection), serverEndAt: c.serverEndAt };
      out.push(o);
      c.s.destroy();
      const released = await waitFor(async () => (await connectionsOf(api)) === 0, 5_000);
      const close = await timedClose(api, 10_000);
      out.push({ released, appClose: close });
      log(`R2b-${extra}`, out.slice(-2));
      expect(rs[0]?.status).toBe(413);
      expect(rs.length === 2 ? rs[1]!.status === 200 : c.serverEndAt !== null).toBe(true);
      expect(released).toBeGreaterThanOrEqual(0);
      expect(close.ms).toBeLessThan(3_000);
    }
    log("R2b", out);
  }, 120_000);
});

// ------------------------------------------------------------------------------------- R3: refusals before body read
describe("R3 refusals before the body is read close the connection promptly and do not drain an endless body", () => {
  it("R3 401 (no cookie) / 403 (no CSRF) / 428 (no If-Match) / 404 (unknown id) / 400 (content type) / unmatched POST: Connection: close, server FIN <= 2.5 s while the client keeps sending", async () => {
    const { api, port } = await fresh();
    const f = await newFile("Synthetic R3");
    const a = auth();
    const cases: Array<[string, string, Record<string, string | number | undefined>]> = [
      ["401-no-cookie", `${T}/evidence/${f.id}/content`, { "Content-Type": "application/octet-stream", "X-File-Name": "x" }],
      ["403-no-csrf", `${T}/evidence/${f.id}/content`, { Cookie: a.Cookie, Origin: a.Origin, "Content-Type": "application/octet-stream", "If-Match": `"${f.version}"`, "X-File-Name": "x" }],
      ["428-no-if-match", `${T}/evidence/${f.id}/content`, { ...a, "Content-Type": "application/octet-stream", "X-File-Name": "x" }],
      ["404-unknown", `${T}/evidence/0190f0f0-0000-7000-8000-000000000000/content`, { ...a, "Content-Type": "application/octet-stream", "If-Match": '"1"', "X-File-Name": "x" }],
      ["400-content-type", `${T}/evidence/${f.id}/content`, { ...a, "Content-Type": "text/plain", "If-Match": `"${f.version}"`, "X-File-Name": "x" }],
      ["404-unmatched", `/api/v1/no-such-route`, { ...a, "Content-Type": "application/json" }],
    ];
    const out: Array<Record<string, unknown>> = [];
    for (const [name, url, h] of cases) {
      const c = await client(port);
      c.s.write(head("POST", url, { ...h, "Transfer-Encoding": "chunked" }));
      let sent = 0;
      const pump = (async () => {
        while (!c.s.destroyed && c.serverEndAt === null && Date.now() - c.t0 < 6_000) {
          const ok = c.s.write(chunk(Buffer.alloc(64 * 1024, 0x41)));
          sent += 64 * 1024;
          if (!ok) await Promise.race([new Promise((r) => c.s.once("drain", r)), sleep(200)]);
          else await sleep(1);
        }
      })();
      await waitFor(() => responses(c.text()).length > 0 || c.serverEndAt !== null, 6_000);
      const respAt = Date.now() - c.t0;
      await waitFor(() => c.serverEndAt !== null, 4_000);
      await pump;
      const r = responses(c.text())[0];
      out.push({ name, status: r?.status, connection: r?.headers.connection, respAt, serverEndAt: c.serverEndAt, sentMiB: +(sent / MiB).toFixed(1) });
      c.s.destroy();
    }
    log("R3", out);
    const released = await waitFor(async () => (await connectionsOf(api)) === 0, 5_000);
    const close = await timedClose(api, 15_000);
    log("R3-close", { released, close });
    const expected: Record<string, number> = { "401-no-cookie": 401, "403-no-csrf": 403, "428-no-if-match": 428, "404-unknown": 404, "400-content-type": 400, "404-unmatched": 404 };
    for (const o of out) {
      expect([o.name, o.status]).toEqual([o.name, expected[o.name as string]]);
      expect([o.name, o.connection]).toEqual([o.name, "close"]);
      expect(o.serverEndAt).not.toBeNull();
      expect((o.serverEndAt as number) - (o.respAt as number)).toBeLessThanOrEqual(2_500);
    }
    expect(close.ms).toBeLessThan(3_000);
  }, 120_000);
});

// ------------------------------------------------------------------------------------- R4: unmatched-route rate limiting
describe("R4 unmatched-route rate limiting: one count per request, same bucket, SPA fallback intact, no CSRF/authz bypass", () => {
  it("R4 limit 6/min", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "mth-spa-r11-"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Synthetic SPA R11</title>");
    writeFileSync(join(webRoot, "app.js"), "/* synthetic */");
    const api = await startApi({ logStream, env: { LOG_LEVEL: "info", RATE_LIMIT_PER_MINUTE: "6" }, server: { webRoot } } as Parameters<typeof startApi>[0]);
    const s = p.lead.session;
    const origin = new URL(String(base.config.appBaseUrl)).origin;
    const rec: Array<Record<string, unknown>> = [];
    const go = async (name: string, o: Parameters<typeof api.app.inject>[0]) => {
      const r = await api.app.inject(o);
      rec.push({ name, status: r.statusCode, remaining: r.headers["x-ratelimit-remaining"], ct: String(r.headers["content-type"]), csp: r.headers["content-security-policy"] !== undefined, nosniff: r.headers["x-content-type-options"], rid: r.headers["x-request-id"] !== undefined, body: r.body.slice(0, 60) });
      return r;
    };
    const auditBefore = Number((await sql<{ n: string }>`select count(*) n from audit_event`.execute(base.db)).rows[0]!.n);
    await go("me", { method: "GET", url: "/api/v1/me", headers: { cookie: s.cookie } });
    await go("spa-deep-link", { method: "GET", url: "/transformations/x/deep" });
    await go("unmatched-api-get", { method: "GET", url: "/api/v1/nope", headers: { cookie: s.cookie } });
    await go("unmatched-post-no-csrf", { method: "POST", url: "/api/v1/nope", headers: { cookie: s.cookie, "content-type": "application/json" }, payload: "{}" });
    await go("matched-post-csrf", { method: "POST", url: "/api/v1/transformations", headers: { cookie: s.cookie, origin, "x-csrf-token": s.csrf, "content-type": "application/json" }, payload: "{}" });
    await go("static-asset", { method: "GET", url: "/app.js" });
    await go("over-limit-unmatched", { method: "GET", url: "/api/v1/nope2", headers: { cookie: s.cookie } });
    await go("over-limit-spa", { method: "GET", url: "/x/y" });
    await go("over-limit-me", { method: "GET", url: "/api/v1/me", headers: { cookie: s.cookie } });
    await go("healthz", { method: "GET", url: "/healthz" });
    await go("anon-unmatched", { method: "GET", url: "/api/v1/nope3" });
    const auditAfter = Number((await sql<{ n: string }>`select count(*) n from audit_event`.execute(base.db)).rows[0]!.n);
    await api.close();
    log("R4", { rec, auditDelta: auditAfter - auditBefore });
    const by = Object.fromEntries(rec.map((r) => [r.name, r]));
    expect(by["me"]!.status).toBe(200);
    expect(by["spa-deep-link"]!.status).toBe(200);
    expect(String(by["spa-deep-link"]!.body)).toContain("Synthetic SPA R11");
    expect(by["unmatched-api-get"]!.status).toBe(404);
    expect(String(by["unmatched-api-get"]!.ct)).toMatch(/problem\+json/);
    expect(by["unmatched-post-no-csrf"]!.status).toBe(404);
    expect(by["healthz"]!.status).toBe(200);
    expect(auditAfter - auditBefore).toBe(0);
  }, 60_000);
});

describe("R4b anonymous (one IP bucket): exactly one count per unmatched request; 429 after the limit everywhere but /healthz", () => {
  it("R4b limit 5/min", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "mth-spa-r11b-"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Synthetic SPA R11b</title>");
    const api = await startApi({ logStream, env: { LOG_LEVEL: "info", RATE_LIMIT_PER_MINUTE: "5" }, server: { webRoot } } as Parameters<typeof startApi>[0]);
    const rec: Array<Record<string, unknown>> = [];
    for (const [name, o] of [
      ["spa", { method: "GET", url: "/a/b" }],
      ["unmatched-get", { method: "GET", url: "/api/v1/nope" }],
      ["unmatched-post", { method: "POST", url: "/api/v1/nope", headers: { "content-type": "application/json" }, payload: "{}" }],
      ["unmatched-head", { method: "HEAD", url: "/api/v1/nope" }],
      ["matched-me-401", { method: "GET", url: "/api/v1/me" }],
      ["unmatched-429", { method: "GET", url: "/api/v1/nope" }],
      ["spa-429", { method: "GET", url: "/c/d" }],
      ["me-429", { method: "GET", url: "/api/v1/me" }],
      ["healthz", { method: "GET", url: "/healthz" }],
    ] as Array<[string, Parameters<typeof api.app.inject>[0]]>) {
      const r = await api.app.inject(o);
      rec.push({ name, status: r.statusCode, remaining: r.headers["x-ratelimit-remaining"], code: r.statusCode === 429 ? r.json().code : undefined, csp: r.headers["content-security-policy"] !== undefined, retryAfter: r.headers["retry-after"] });
    }
    await api.close();
    log("R4b", rec);
    expect(rec.map((r) => r.status)).toEqual([200, 404, 404, 404, 401, 429, 429, 429, 200]);
    expect(rec.slice(0, 5).map((r) => Number(r.remaining))).toEqual([4, 3, 2, 1, 0]);
    for (const r of rec.slice(5, 8)) expect([r.code, r.csp, r.retryAfter !== undefined]).toEqual(["rate_limited", true, true]);
  }, 60_000);
});

// ------------------------------------------------------------------------------------- R5: bounded shutdown
describe("R5 shutdown: idle keep-alive closed at once; an in-flight upload that completes within grace succeeds; a stalled one is cut at grace", () => {
  it("R5 idle socket + slow-but-finishing upload (1.5 s) + stalled upload, grace 3 s", async () => {
    const { api, port } = await fresh({}, { shutdownGraceMs: 3_000 });
    const idle = await client(port);
    idle.s.write(head("GET", "/api/v1/me", { Cookie: p.lead.session.cookie }));
    await waitFor(() => responses(idle.text()).length >= 1, 5_000);
    const f1 = await newFile("Synthetic R5 finishing");
    const f2 = await newFile("Synthetic R5 stalled");
    const bytes = randomBytes(512 * 1024);
    const up = await client(port);
    up.s.write(head("POST", `${T}/evidence/${f1.id}/content`, { ...auth(), "If-Match": `"${f1.version}"`, "X-File-Name": "r5.bin", "Content-Type": "application/octet-stream", "Content-Length": bytes.length }));
    up.s.write(bytes.subarray(0, 1024));
    const st = await client(port);
    st.s.write(head("POST", `${T}/evidence/${f2.id}/content`, { ...auth(), "If-Match": `"${f2.version}"`, "X-File-Name": "r5s.bin", "Content-Type": "application/octet-stream", "Content-Length": 10 * MiB }));
    st.s.write(Buffer.alloc(4096, 1));
    await sleep(300);
    const t0 = Date.now();
    const closing = api.app.close().then(() => Date.now() - t0);
    // finish the slow upload over ~1.5 s
    for (let i = 1; i <= 15; i++) {
      await sleep(100);
      up.s.write(bytes.subarray(Math.floor(((i - 1) * (bytes.length - 1024)) / 15) + 1024, Math.floor((i * (bytes.length - 1024)) / 15) + 1024));
    }
    await waitFor(() => responses(up.text()).length >= 1, 5_000);
    const closeMs = await Promise.race([closing, sleep(15_000).then(() => -1)]);
    const r = responses(up.text())[0];
    await waitFor(() => st.serverEndAt !== null, 1_000);
    const o = {
      idleClosedAt: idle.serverEndAt !== null ? idle.serverEndAt : null,
      idleClosedRelToClose: idle.serverEndAt !== null ? idle.t0 + idle.serverEndAt - t0 : null,
      upload: { status: r?.status, connection: r?.headers.connection },
      stalledClosedRelToClose: st.serverEndAt !== null ? st.t0 + st.serverEndAt - t0 : null,
      appCloseMs: closeMs,
      stored: (await storedOf(f1.id)) === sha(bytes),
      stalledStored: await storedOf(f2.id),
    };
    for (const c of [idle, up, st]) c.s.destroy();
    await api.db.destroy();
    await api.owner.end();
    log("R5", o);
    expect(o.idleClosedRelToClose).not.toBeNull();
    expect(o.idleClosedRelToClose as number).toBeLessThan(500);
    expect(o.upload).toEqual({ status: 200, connection: "close" });
    expect(o.stored).toBe(true);
    expect(o.stalledStored).toBeNull();
    expect(o.stalledClosedRelToClose as number).toBeGreaterThanOrEqual(2_900);
    expect(o.appCloseMs).toBeGreaterThanOrEqual(2_900);
    expect(o.appCloseMs).toBeLessThan(4_500);
  }, 60_000);
});

// ------------------------------------------------------------------------------------- R6: requestTimeout and client abort
describe("R6 requestTimeout and client abort (one instance per case, error-level logs attributed)", () => {
  const cases: Array<[string, boolean, (port: number, ids: { id: string; version: number }) => Promise<Client>]> = [
    ["R6a stalled JSON body -> requestTimeout 408", true, async (port) => {
      const c = await client(port);
      c.s.write(head("POST", `${T}/evidence`, { ...auth(), "Content-Type": "application/json", "Content-Length": 100 }));
      c.s.write('{"title":');
      return c;
    }],
    ["R6b stalled headers (slowloris) -> requestTimeout 408", true, async (port) => {
      const c = await client(port);
      c.s.write("GET /api/v1/me HTTP/1.1\r\nHost: 127.0.0.1\r\nX-A: ");
      return c;
    }],
    ["R6c stalled upload body -> requestTimeout 408", true, async (port, f) => {
      const c = await client(port);
      c.s.write(head("POST", `${T}/evidence/${f.id}/content`, { ...auth(), "If-Match": `"${f.version}"`, "X-File-Name": "r6.bin", "Content-Type": "application/octet-stream", "Content-Length": MiB }));
      c.s.write(Buffer.alloc(1000, 2));
      return c;
    }],
    ["R6d client aborts a JSON body mid-way (no timeout)", false, async (port) => {
      const c = await client(port);
      c.s.write(head("POST", `${T}/evidence`, { ...auth(), "Content-Type": "application/json", "Content-Length": 100 }));
      c.s.write('{"title":');
      await sleep(300);
      c.s.destroy();
      return c;
    }],
    ["R6e client aborts an upload mid-way (no timeout)", false, async (port, f) => {
      const c = await client(port);
      c.s.write(head("POST", `${T}/evidence/${f.id}/content`, { ...auth(), "If-Match": `"${f.version}"`, "X-File-Name": "r6e.bin", "Content-Type": "application/octet-stream", "Content-Length": 10 * MiB }));
      c.s.write(randomBytes(2 * MiB));
      await sleep(300);
      c.s.destroy();
      return c;
    }],
  ];
  for (const [name, timeout, run] of cases) {
    it(`${name}: ${timeout ? "408 and connection closed" : "connection released"}; no error-level log; nothing stored`, async () => {
      const { api, port } = await fresh({}, timeout ? { requestTimeoutMs: 1_500, connectionsCheckingIntervalMs: 200 } : {});
      const f = await newFile(`Synthetic ${name.slice(0, 3)}`);
      const before = logLines.length;
      const c = await run(port, f);
      if (timeout) await waitFor(() => c.serverEndAt !== null, 6_000);
      await sleep(800);
      const released = await waitFor(async () => (await connectionsOf(api)) === 0, 3_000);
      const errs = logLines.slice(before).filter((l) => l.level >= 50 || l.msg === "unhandled error");
      const close = await timedClose(api, 10_000);
      const o = { status: responses(c.text())[0]?.status ?? null, serverEndAt: c.serverEndAt, released, errs, stored: await storedOf(f.id), close };
      c.s.destroy();
      log(name.slice(0, 3), o);
      if (timeout) {
        expect(o.status).toBe(408);
        expect(o.serverEndAt).not.toBeNull();
      }
      expect(released).toBeGreaterThanOrEqual(0);
      expect(o.stored).toBeNull();
      expect(close.ms).toBeLessThan(3_000);
      expect(errs).toEqual([]);
    }, 60_000);
  }
});

// ------------------------------------------------------------------------------------- R7: no regression of the refusals
describe("R7 bodyLimit, strict UTF-8 JSON, media type and CSRF answers are unchanged (statuses/codes compared across candidates)", () => {
  it("R7 refusal matrix over a real socket", async () => {
    const { api, port } = await fresh();
    const a = auth();
    const big = Buffer.from(JSON.stringify({ title: "x".repeat(2 * MiB) }));
    const badUtf8 = Buffer.concat([Buffer.from('{"ownerUserId":"' + p.lead.id + '","kind":"note","noteBody":"n","title":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
    const f = await newFile("Synthetic R7");
    const cases: Array<[string, Buffer]> = [
      ["json-over-bodylimit-cl", Buffer.concat([head("POST", `${T}/evidence`, { ...a, "Content-Type": "application/json", "Content-Length": big.length }), big])],
      ["json-over-bodylimit-chunked", Buffer.concat([head("POST", `${T}/evidence`, { ...a, "Content-Type": "application/json", "Transfer-Encoding": "chunked" }), chunk(big), Buffer.from("0\r\n\r\n")])],
      ["json-invalid-utf8", Buffer.concat([head("POST", `${T}/evidence`, { ...a, "Content-Type": "application/json", "Content-Length": badUtf8.length }), badUtf8])],
      ["json-as-text-plain", Buffer.concat([head("POST", `${T}/evidence`, { ...a, "Content-Type": "text/plain", "Content-Length": 2 }), Buffer.from("{}")])],
      ["json-no-csrf", Buffer.concat([head("POST", `${T}/evidence`, { Cookie: a.Cookie, Origin: a.Origin, "Content-Type": "application/json", "Content-Length": 2 }), Buffer.from("{}")])],
      ["json-bad-origin", Buffer.concat([head("POST", `${T}/evidence`, { ...a, Origin: "http://evil.example", "Content-Type": "application/json", "Content-Length": 2 }), Buffer.from("{}")])],
      ["upload-json-type", Buffer.concat([head("POST", `${T}/evidence/${f.id}/content`, { ...a, "If-Match": `"${f.version}"`, "X-File-Name": "a", "Content-Type": "application/json", "Content-Length": 2 }), Buffer.from("{}")])],
      ["upload-other-user-403", Buffer.concat([head("POST", `${T}/evidence/${f.id}/content`, { Cookie: p.auditor.session.cookie, Origin: a.Origin, "X-CSRF-Token": p.auditor.session.csrf, "If-Match": `"${f.version}"`, "X-File-Name": "a", "Content-Type": "application/octet-stream", "Content-Length": 3 }), Buffer.from("abc")])],
    ];
    const out: Array<Record<string, unknown>> = [];
    for (const [name, bytes] of cases) {
      const c = await client(port);
      c.s.write(bytes);
      await waitFor(() => responses(c.text()).length > 0 || c.serverEndAt !== null, 5_000);
      const r = responses(c.text())[0];
      let code: string | undefined;
      try {
        const j = JSON.parse(r?.body ?? "{}");
        code = j.errors?.[0]?.code ?? j.code;
      } catch {
        code = undefined;
      }
      out.push({ name, status: r?.status, code, connection: r?.headers.connection });
      c.s.destroy();
    }
    const close = await timedClose(api, 10_000);
    log("R7", { out, close, stored: await storedOf(f.id) });
    expect(await storedOf(f.id)).toBeNull();
    for (const o of out) expect((o.status as number) >= 400 && (o.status as number) < 500).toBe(true);
  }, 60_000);
});

// ------------------------------------------------------------------------------------- R8: stalled uploads vs the DB pool
describe("R8 stalled uploads hold pooled DB connections (pre-existing class check; harness pool max 5)", () => {
  it("R8 6 stalled uploads (6 distinct items) by one authorized user, then another user's GET /api/v1/me and /readyz within 5 s", async () => {
    const { api, port } = await fresh();
    const stalled: Client[] = [];
    for (let i = 0; i < 6; i++) {
      const f = await newFile(`Synthetic R8 ${i}`);
      const c = await client(port);
      c.s.write(head("POST", `${T}/evidence/${f.id}/content`, { ...auth(), "If-Match": `"${f.version}"`, "X-File-Name": `r8-${i}.bin`, "Content-Type": "application/octet-stream", "Content-Length": 10 * MiB }));
      c.s.write(Buffer.alloc(1024, 3));
      stalled.push(c);
    }
    await sleep(1_000);
    const pg = await sql<{ n: string; s: string }>`select count(*) n, string_agg(distinct state, ',') s from pg_stat_activity where application_name = 'api-test' and datname = current_database()`.execute(base.db);
    const timed = async (fn: () => Promise<{ statusCode: number }>) => {
      const t0 = Date.now();
      const r = await Promise.race([fn().then((x) => x.statusCode), sleep(5_000).then(() => -1)]);
      return { status: r, ms: Date.now() - t0 };
    };
    const me = await timed(() => api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } }));
    const ready = await timed(() => api.app.inject({ method: "GET", url: "/readyz" }));
    for (const c of stalled) c.s.destroy();
    const meAfter = await timed(() => api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } }));
    const close = await timedClose(api, 10_000);
    log("R8", { pgSessions: pg.rows[0], meWhileStalled: me, readyWhileStalled: ready, meAfterRelease: meAfter, close });
    expect(meAfter.status).toBe(200);
    expect(me.status).toBe(200);
  }, 60_000);
});

describe("R8b on the round-11 candidate the hold ends at requestTimeout (here 3 s): the stalled uploads get 408 and the pool recovers", () => {
  it("R8b 6 stalled uploads, requestTimeoutMs 3000", async () => {
    const { api, port } = await fresh({}, { requestTimeoutMs: 3_000, connectionsCheckingIntervalMs: 250 });
    const stalled: Client[] = [];
    for (let i = 0; i < 6; i++) {
      const f = await newFile(`Synthetic R8b ${i}`);
      const c = await client(port);
      c.s.write(head("POST", `${T}/evidence/${f.id}/content`, { ...auth(), "If-Match": `"${f.version}"`, "X-File-Name": `r8b-${i}.bin`, "Content-Type": "application/octet-stream", "Content-Length": 10 * MiB }));
      c.s.write(Buffer.alloc(1024, 3));
      stalled.push(c);
    }
    await sleep(500);
    const t0 = Date.now();
    const meStatus = await Promise.race([api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } }).then((r) => r.statusCode), sleep(15_000).then(() => -1)]);
    const meMs = Date.now() - t0;
    const statuses = stalled.map((c) => responses(c.text())[0]?.status ?? null);
    for (const c of stalled) c.s.destroy();
    const close = await timedClose(api, 10_000);
    log("R8b", { meStatus, meMsAfterStallStart: meMs + 500, stalledStatuses: statuses, close });
    expect(meStatus).toBe(200);
    expect(meMs).toBeGreaterThan(1_500);
  }, 60_000);
});
