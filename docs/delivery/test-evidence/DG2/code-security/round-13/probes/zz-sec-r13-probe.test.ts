// code-security-reviewer DG2 round-13 adversarial probe (T-DG2-REV-SEC-R13). NOT part of the candidate: copied into a
// disposable clone at apps/api/test/integration/ and run on a disposable PostgreSQL 16. All data SYNTHETIC.
// Targets BE18A (8c0083e): commit-time authorisation of the upload (F-DG2-440), the start-up sweep of stale temporaries
// and the shutdown settle-wait (F-DG2-460 changes) on candidate 6824b8b8 (clone at 5699f72 = source aa0a68f + metadata).
// Every assertion states the secure/declared expectation; every observation is logged as "PROBE <key>: <json>".
// S3 is a MEASUREMENT of the documented residual window (phase 3's own transaction): it asserts consistency, not 403.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { APP_ORIGIN, call, grant, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

const MiB = 1024 * 1024;
type Line = { level: number; msg: string; [k: string]: unknown };
const logLines: Line[] = [];
const logStream = { write(line: string) { for (const l of line.split("\n").filter(Boolean)) logLines.push(JSON.parse(l)); } };
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

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
afterAll(async () => { await base.close(); }, 60_000);

async function fresh(env: Record<string, string> = {}) {
  const api = await startApi({ logStream, env: { LOG_LEVEL: "info", ...env } });
  for (let attempt = 0; ; attempt++) {
    const port = 22000 + Math.floor(Math.random() * 5000);
    try { await api.app.listen({ port, host: "127.0.0.1" }); return { api, port }; }
    catch (err) { if ((err as { code?: string }).code !== "EADDRINUSE" || attempt >= 20) throw err; }
  }
}
async function closeApi(api: TestApi) {
  const closing = api.app.close();
  if (!(await Promise.race([closing.then(() => true), sleep(5_000).then(() => false)]))) { api.app.server.closeAllConnections(); await closing; }
  await api.db.destroy(); await api.owner.end();
}
interface Client { s: Socket; text(): string; ended: boolean }
function client(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const s = connect(port, "127.0.0.1"); const chunks: Buffer[] = [];
    const c: Client = { s, text: () => Buffer.concat(chunks).toString("latin1"), ended: false };
    s.on("data", (d) => chunks.push(d)); s.on("end", () => (c.ended = true)); s.on("close", () => (c.ended = true)); s.on("error", () => (c.ended = true));
    s.once("connect", () => resolve(c)); s.once("error", reject);
  });
}
function first(text: string) {
  const end = text.indexOf("\r\n\r\n"); if (end < 0) return null;
  const [st, ...ls] = text.slice(0, end).split("\r\n"); const h: Record<string, string> = {};
  for (const l of ls) h[l.slice(0, l.indexOf(":")).toLowerCase()] = l.slice(l.indexOf(":") + 1).trim();
  const body = text.slice(end + 4, end + 4 + Number(h["content-length"] ?? 0));
  let code: string | undefined; try { const j = JSON.parse(body); code = j.errors?.[0]?.code ?? j.code; } catch { code = undefined; }
  return { status: Number(st!.split(" ")[1]), code };
}
async function waitFor(cond: () => boolean | Promise<boolean>, ms: number) {
  const t0 = Date.now();
  for (;;) { if (await cond()) return Date.now() - t0; if (Date.now() - t0 >= ms) return -1; await sleep(25); }
}
const authOf = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, Origin: APP_ORIGIN, "X-CSRF-Token": s.csrf });
function head(method: string, url: string, h: Record<string, string | number>) {
  const lines = [`${method} ${url} HTTP/1.1`, "Host: 127.0.0.1", ...Object.entries(h).map(([k, v]) => `${k}: ${v}`)];
  return Buffer.from(lines.join("\r\n") + "\r\n\r\n", "latin1");
}
async function newFile(session: P2World["lead"]["session"], owner: string, title: string) {
  const c = await call(base.app, "POST", `${T}/evidence`, { session, body: { ownerUserId: owner, kind: "file", title } });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  return { id: c.body.id as string, version: c.body.version as number, org: c.body.organizationId as string, t: c.body.transformationId as string };
}
async function state(f: { id: string; org: string; t: string }, storeRoot = String(base.config.evidenceStorage.path)) {
  const rows = (await sql<{ revision: number; storage_key: string }>`select revision, storage_key from evidence_content where evidence_id = ${f.id} order by revision`.execute(base.db)).rows;
  const ev = (await sql<{ version: number; current_content_id: string | null }>`select version, current_content_id from evidence where id = ${f.id}`.execute(base.db)).rows[0]!;
  const dir = join(storeRoot, f.org, f.t, f.id);
  const files = existsSync(dir) ? readdirSync(dir).sort() : [];
  const uploads = Number((await sql<{ n: string }>`select count(*) n from audit_event where record_id = ${f.id} and action = 'evidence.upload_content'`.execute(base.db)).rows[0]!.n);
  return { rows, version: ev.version, current: ev.current_content_id, files, uploads };
}
async function denials(userId: string, since: Date) {
  return (await sql<{ record_type: string; reason: string }>`select record_type, reason from audit_event where actor_user_id = ${userId} and action = 'authorization.denied' and occurred_at >= ${since} order by occurred_at`.execute(base.db)).rows;
}
async function startUpload(port: number, session: P2World["lead"]["session"], f: { id: string; version: number }, bytes: Buffer, firstPart: number) {
  const c = await client(port);
  c.s.write(head("POST", `${T}/evidence/${f.id}/content`, { ...authOf(session), "If-Match": `"${f.version}"`, "X-File-Name": "r13.bin", "Content-Type": "application/octet-stream", "Content-Length": bytes.length }));
  c.s.write(bytes.subarray(0, firstPart));
  return {
    c,
    send() { c.s.write(bytes.subarray(firstPart)); },
    async response(ms = 15_000) { await waitFor(() => first(c.text()) !== null || c.ended, ms); const r = first(c.text()); return r; },
  };
}
const activeAssignments = async (userId: string) => (await sql<{ code: string }>`select r.code from scoped_assignment a join role r on r.id = a.role_id where a.user_id = ${userId} and a.revoked_at is null`.execute(base.db)).rows.map((r) => r.code).sort();
async function revokeAll(api: TestApi, userId: string, why: string) {
  return api.owner.query(`update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = $3 where user_id = $2 and revoked_at is null`, [w.grantor.id, userId, why]);
}
async function restoreContributor(api: TestApi) {
  await revokeAll(api, p.contributor.id, "probe restore");
  await grant(base.db, w.grantor.id, p.contributor.id, "WL", { type: "transformation", id: p.transformationId }, w.orgA.id);
}

describe("S commit-time authorisation, adversarial (F-DG2-440)", () => {
  it("S1 role DOWNGRADE (WL -> AUD, read kept, evidence.create lost) while the body streams: 403, denial audited, nothing stored", async () => {
    const { api, port } = await fresh();
    try {
      const f = await newFile(p.contributor.session, p.contributor.id, "Synthetic S1");
      const since = (await sql<{ t: Date }>`select now() t`.execute(base.db)).rows[0]!.t;
      const u = await startUpload(port, p.contributor.session, f, randomBytes(MiB), 64 * 1024);
      await sleep(400);
      await revokeAll(api, p.contributor.id, "probe S1 downgrade");
      await grant(base.db, w.grantor.id, p.contributor.id, "AUD", { type: "transformation", id: p.transformationId }, w.orgA.id);
      const roles = await activeAssignments(p.contributor.id);
      const read = (await call(base.app, "GET", `${T}/evidence/${f.id}`, { session: p.contributor.session })).status;
      u.send();
      const r = await u.response();
      const s = await state(f);
      const d = await denials(p.contributor.id, since);
      log("S1", { roles, readAfterDowngrade: read, response: r, after: s, denials: d });
      expect(roles).toEqual(["AUD"]);
      expect(read).toBe(200);
      expect(r?.status).toBe(403);
      expect(r?.code).toBe("forbidden");
      expect(s.rows).toEqual([]);
      expect(s.version).toBe(f.version);
      expect(s.files).toEqual([]);
      expect(s.uploads).toBe(0);
      expect(d.length).toBe(1);
      expect(d[0]!.reason).toMatch(/evidence\.create/);
    } finally { await restoreContributor(api); await closeApi(api); }
  }, 60_000);

  it("S2 the item's owner is reassigned away from the uploader while the body streams: never 200, nothing stored", async () => {
    const { api, port } = await fresh();
    try {
      // created by the lead, owned by the contributor: the contributor may upload only as the named owner
      const f = await newFile(p.lead.session, p.contributor.id, "Synthetic S2");
      const u = await startUpload(port, p.contributor.session, f, randomBytes(MiB), 64 * 1024);
      await sleep(400);
      const patch = await call(base.app, "PATCH", `${T}/evidence/${f.id}`, { session: p.lead.session, headers: ifm(f.version), body: { ownerUserId: p.lead.id } });
      u.send();
      const r = await u.response();
      const s = await state(f);
      log("S2", { patch: patch.status, response: r, after: { rows: s.rows.length, files: s.files, version: s.version } });
      expect(patch.status).toBe(200);
      expect([403, 409]).toContain(r?.status);
      expect(s.rows).toEqual([]);
      expect(s.files).toEqual([]);
    } finally { await closeApi(api); }
  }, 60_000);

  it("S3 MEASUREMENT of the residual: phase 3 authorises, then waits for the item's row lock; a revocation committed during that wait", async () => {
    const { api, port } = await fresh();
    const holder = await api.owner.connect();
    try {
      const f = await newFile(p.contributor.session, p.contributor.id, "Synthetic S3");
      const u = await startUpload(port, p.contributor.session, f, randomBytes(MiB), 64 * 1024);
      await sleep(300);
      await holder.query("begin");
      await holder.query("select id from evidence where id = $1 for key share", [f.id]);
      u.send();
      await sleep(800); // body received; phase 3 has authorised and now waits for FOR UPDATE on the item
      const waiting = (await api.owner.query(`select count(*)::int n from pg_locks where not granted`)).rows[0].n as number;
      await revokeAll(api, p.contributor.id, "probe S3 revoke during lock wait");
      const t0 = Date.now();
      await holder.query("commit");
      const r = await u.response();
      const s = await state(f);
      log("S3", { lockWaiters: waiting, response: r, msAfterRelease: Date.now() - t0, after: { rows: s.rows.length, files: s.files, uploads: s.uploads } });
      // consistency, not a security expectation: either refused with nothing stored, or committed with its object
      expect([200, 403]).toContain(r?.status);
      if (r?.status === 200) { expect(s.rows.length).toBe(1); expect(s.files).toEqual([s.rows[0]!.storage_key.split("/").pop()]); }
      else { expect(s.rows).toEqual([]); expect(s.files).toEqual([]); }
    } finally { holder.release(); await restoreContributor(api); await closeApi(api); }
  }, 60_000);
});

describe("V start-up sweep of stale temporaries: traversal, symlinks, names, live uploads on shared storage", () => {
  const old = new Date(Date.now() - 2 * 3600_000);
  const sweepDone = (since: number) => waitFor(() => logLines.slice(since).some((l) => /start-up sweep of stale temporary objects (finished|failed)/.test(l.msg)), 15_000);

  it("V1 only a REAL stale <uuid>.part exactly 3 levels deep is removed; symlinks, wrong depth, wrong names, directories and outside files survive", async () => {
    const root = mkdtempSync(join(tmpdir(), "mth-r13-sweep-"));
    const outside = mkdtempSync(join(tmpdir(), "mth-r13-outside-"));
    const e = join(root, "o1", "t1", "e1"); mkdirSync(e, { recursive: true });
    const mk = (path: string, mtime = old) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, "synthetic"); utimesSync(path, mtime, mtime); return path; };
    const victims = { staleReal: mk(join(e, `${randomUUID()}.part`)) };
    const keep = {
      fresh: mk(join(e, `${randomUUID()}.part`), new Date()),
      finalStale: mk(join(e, randomUUID())),
      depth2: mk(join(root, "o1", "t1", `${randomUUID()}.part`)),
      depth4: mk(join(e, "sub", `${randomUUID()}.part`)),
      upper: mk(join(e, `${randomUUID().toUpperCase()}.part`)),
      suffix: mk(join(e, `${randomUUID()}.part.bak`)),
      outsideViaDirLink: mk(join(outside, "o", "t", "e", `${randomUUID()}.part`)),
      outsideFileTarget: mk(join(outside, "target.part")),
    };
    const dirNamedPart = join(e, `${randomUUID()}.part`); mkdirSync(dirNamedPart); utimesSync(dirNamedPart, old, old);
    symlinkSync(join(outside, "o"), join(root, "linked-org")); // depth-0 directory symlink to an outside tree
    const fileLink = join(e, `${randomUUID()}.part`); symlinkSync(join(outside, "target.part"), fileLink); lutimesSync(fileLink, old, old);
    const before = logLines.length;
    const { api } = await fresh({ EVIDENCE_STORAGE_PATH: root });
    const waited = await sweepDone(before);
    const removedLogs = logLines.slice(before).filter((l) => l.msg === "evidence store: stale temporary object removed");
    const finished = logLines.slice(before).find((l) => /sweep of stale temporary objects (finished|failed)/.test(l.msg));
    await closeApi(api);
    const present = Object.fromEntries(Object.entries(keep).map(([k, v]) => [k, existsSync(v)]));
    log("V1", { waited, finished: finished && { msg: finished.msg, removed: finished.removed, keptFresh: finished.keptFresh }, removedLogs: removedLogs.map((l) => l.key), staleRealGone: !existsSync(victims.staleReal), present, dirNamedPart: existsSync(dirNamedPart), fileLink: existsSync(fileLink) });
    expect(waited).toBeGreaterThanOrEqual(0);
    expect(finished?.msg).toMatch(/finished/);
    expect(existsSync(victims.staleReal)).toBe(false);
    expect(Object.values(present).every(Boolean)).toBe(true);
    expect(existsSync(dirNamedPart)).toBe(true);
    expect(existsSync(fileLink)).toBe(true);
    expect(removedLogs.length).toBe(1);
    expect(String(removedLogs[0]!.key)).toMatch(/^o1\/t1\/e1\/[0-9a-f-]{36}\.part$/);
  }, 60_000);

  it("V2 a LIVE upload on shared storage: a second instance's sweep keeps its fresh .part; the upload then commits (200)", async () => {
    const root = mkdtempSync(join(tmpdir(), "mth-r13-shared-"));
    const A = await fresh({ EVIDENCE_STORAGE_PATH: root });
    try {
      const f = await newFile(p.lead.session, p.lead.id, "Synthetic V2");
      const bytes = randomBytes(MiB);
      const u = await startUpload(A.port, p.lead.session, f, bytes, 64 * 1024);
      await sleep(300);
      const before = logLines.length;
      const B = await fresh({ EVIDENCE_STORAGE_PATH: root });
      await sweepDone(before);
      const fin = logLines.slice(before).find((l) => /sweep of stale temporary objects finished/.test(l.msg));
      await closeApi(B.api);
      u.send();
      const r = await u.response();
      const s = await state(f, root);
      log("V2", { sweep: fin && { removed: fin.removed, keptFresh: fin.keptFresh }, response: r, after: { rows: s.rows.length, files: s.files } });
      expect(fin?.removed).toBe(0);
      expect(Number(fin?.keptFresh)).toBeGreaterThanOrEqual(1);
      expect(r?.status).toBe(200);
      expect(s.rows.length).toBe(1);
    } finally { await closeApi(A.api); }
  }, 60_000);

  it("V3 a LIVE .part whose mtime is >1 h in the past (clock skew beyond the margin) IS swept: the upload must then fail closed (no content row pointing at a missing object)", async () => {
    const root = mkdtempSync(join(tmpdir(), "mth-r13-skew-"));
    const A = await fresh({ EVIDENCE_STORAGE_PATH: root });
    try {
      const f = await newFile(p.lead.session, p.lead.id, "Synthetic V3");
      const u = await startUpload(A.port, p.lead.session, f, randomBytes(MiB), 64 * 1024);
      await sleep(300);
      const dir = join(root, f.org, f.t, f.id);
      const part = readdirSync(dir).find((n) => n.endsWith(".part"))!;
      utimesSync(join(dir, part), old, old);
      const before = logLines.length;
      const B = await fresh({ EVIDENCE_STORAGE_PATH: root });
      await sweepDone(before);
      const fin = logLines.slice(before).find((l) => /sweep of stale temporary objects finished/.test(l.msg));
      await closeApi(B.api);
      const errBefore = logLines.length;
      u.send();
      const r = await u.response();
      const s = await state(f, root);
      const errs = logLines.slice(errBefore).filter((l) => l.level >= 50).map((l) => l.msg);
      log("V3", { sweptRemoved: fin?.removed, response: r, after: s, errs });
      expect(fin?.removed).toBe(1);
      expect(r?.status).not.toBe(200);
      expect(s.rows).toEqual([]);
      expect(s.current).toBeNull();
      expect(s.files).toEqual([]);
    } finally { await closeApi(A.api); }
  }, 60_000);
});

describe("X shutdown: a handler stuck on the database cannot hold the process past the backstop", () => {
  it("X1 PATCH blocked on a row lock, then SIGTERM: the process exits within grace+settle+backstop (<= ~10.5 s), and the PATCH does not commit", async () => {
    const { appUrl } = inject("mthDb");
    const store = mkdtempSync(join(tmpdir(), "mth-r13-x1-"));
    let proc: ChildProcess | null = null; let out = ""; let port = 0;
    for (let attempt = 0; attempt < 10 && !proc; attempt++) {
      port = 26000 + Math.floor(Math.random() * 6000);
      const pr = spawn(process.execPath, ["--conditions=@mth/source", "apps/api/src/main.ts"], {
        cwd: repoRoot,
        env: { PATH: process.env["PATH"] ?? "", NODE_ENV: "test", APP_BASE_URL: APP_ORIGIN, DATABASE_URL: appUrl, AUTH_MODE: "dev", PORT: String(port), LOG_LEVEL: "info", RATE_LIMIT_PER_MINUTE: "100000", AUTH_RATE_LIMIT_PER_MINUTE: "100000", EVIDENCE_STORAGE_DRIVER: "filesystem", EVIDENCE_STORAGE_PATH: store },
        stdio: ["ignore", "pipe", "pipe"],
      });
      out = ""; pr.stdout!.on("data", (d: Buffer) => (out += d.toString())); pr.stderr!.on("data", (d: Buffer) => (out += d.toString()));
      const ok = await waitFor(() => out.includes("mth-api listening") || out.includes("EADDRINUSE") || pr.exitCode !== null, 20_000);
      if (ok >= 0 && out.includes("mth-api listening")) proc = pr; else pr.kill("SIGKILL");
    }
    expect(proc).not.toBeNull();
    const exited = new Promise<{ code: number | null; at: number }>((r) => proc!.once("exit", (code) => r({ code, at: Date.now() })));
    const f = await newFile(p.lead.session, p.lead.id, "Synthetic X1");
    const holder = await base.owner.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from evidence where id = $1 for update", [f.id]);
      const c = await client(port);
      const body = Buffer.from(JSON.stringify({ title: "Synthetic X1 changed" }));
      c.s.write(Buffer.concat([head("PATCH", `${T}/evidence/${f.id}`, { ...authOf(p.lead.session), "If-Match": `"${f.version}"`, "Content-Type": "application/json", "Content-Length": body.length }), body]));
      await sleep(800);
      const t0 = Date.now();
      proc!.kill("SIGTERM");
      const ex = await Promise.race([exited, sleep(20_000).then(() => null)]);
      if (!ex) proc!.kill("SIGKILL");
      await holder.query("commit");
      await sleep(300);
      const v = (await sql<{ version: number; title: string }>`select version, title from evidence where id = ${f.id}`.execute(base.db)).rows[0]!;
      const lines = out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Line).filter((l) => /shut|settle|backstop|still running/i.test(l.msg)).map((l) => ({ level: l.level, msg: l.msg, pending: l.pending }));
      log("X1", { exit: ex && { code: ex.code, ms: ex.at - t0 }, response: first(c.text()), after: v, lines });
      c.s.destroy();
      expect(ex).not.toBeNull();
      expect(ex!.at - t0).toBeLessThan(11_500);
      expect(v.version).toBe(f.version);
      expect(v.title).toBe("Synthetic X1");
    } finally { holder.release(); }
  }, 60_000);
});
