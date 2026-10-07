// code-security-reviewer DG2 round-12 adversarial probe (T-DG2-REV-SEC-R12). NOT part of the candidate: copied into a
// disposable clone at apps/api/test/integration/ and run on a disposable PostgreSQL 16. All data SYNTHETIC.
// Targets the BE17 three-phase upload (F-DG2-411) and the central incomplete-body mapping (F-DG2-412) on candidate
// 5dfecce4 (clone at 744af0b = source 8488e7a + metadata). Every assertion states the secure/declared expectation;
// every observation is logged as "PROBE <key>: <json>".
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { call, seedWorld, signIn, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

const MiB = 1024 * 1024;
type Line = { level: number; msg: string; [k: string]: unknown };
const logLines: Line[] = [];
const logStream = { write(line: string) { for (const l of line.split("\n").filter(Boolean)) logLines.push(JSON.parse(l)); } };
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);

/** pg_stat_activity as the cluster SUPERUSER (the owner role cannot see the state of mth_app sessions: it reads null). */
async function activity(dbName: string) {
  const c = new pg.Client({ connectionString: inject("mthDb").adminUrl });
  await c.connect();
  try {
    return (await c.query(`select coalesce(state, '<null>') state, count(*)::int n from pg_stat_activity where application_name = 'api-test' and datname = $1 group by 1 order by 1`, [dbName])).rows as Array<{ state: string; n: number }>;
  } finally { await c.end(); }
}
const dbNameOf = async (api: TestApi) => (await sql<{ d: string }>`select current_database() d`.execute(api.db)).rows[0]!.d;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let base: TestApi;
let w: World;
let p: P2World;
let T: string;
let leadSubject: string;
beforeAll(async () => {
  base = await startApi({ logStream, env: { LOG_LEVEL: "info" } });
  w = await seedWorld(base.db);
  p = await setupP2World(base, w);
  leadSubject = (await sql<{ s: string }>`select subject s from user_identity where user_id = ${p.lead.id} limit 1`.execute(base.db)).rows[0]!.s;
  T = `/api/v1/transformations/${p.transformationId}`;
}, 60_000);
afterAll(async () => { await base.close(); }, 60_000);

type PoolOpt = Parameters<typeof startApi>[0] extends infer O ? (O extends { pool?: infer P } ? P : never) : never;
async function fresh(pool: PoolOpt = {}) {
  const api = await startApi({ logStream, env: { LOG_LEVEL: "info" }, pool });
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
  return { status: Number(st!.split(" ")[1]), connection: h.connection, code };
}
async function waitFor(cond: () => boolean | Promise<boolean>, ms: number) {
  const t0 = Date.now();
  for (;;) { if (await cond()) return Date.now() - t0; if (Date.now() - t0 >= ms) return -1; await sleep(25); }
}
const authOf = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, Origin: new URL(String(base.config.appBaseUrl)).origin, "X-CSRF-Token": s.csrf });
function head(url: string, h: Record<string, string | number>) {
  const lines = [`POST ${url} HTTP/1.1`, "Host: 127.0.0.1", ...Object.entries(h).map(([k, v]) => `${k}: ${v}`)];
  return Buffer.from(lines.join("\r\n") + "\r\n\r\n", "latin1");
}
async function newFile(session: P2World["lead"]["session"], owner: string, title: string, tPath = T) {
  const c = await call(base.app, "POST", `${tPath}/evidence`, { session, body: { ownerUserId: owner, kind: "file", title } });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  return { id: c.body.id as string, version: c.body.version as number, org: c.body.organizationId as string, t: c.body.transformationId as string };
}
async function signInAgain() { return signIn(base.app, leadSubject); }
async function newFileOrStatus(session: P2World["lead"]["session"], owner: string) {
  const c = await call(base.app, "POST", `${T}/evidence`, { session, body: { ownerUserId: owner, kind: "file", title: "Synthetic control" } });
  return c.status;
}
async function state(f: { id: string; org: string; t: string }) {
  const rows = (await sql<{ revision: number; sha256: string; storage_key: string }>`select revision, sha256, storage_key from evidence_content where evidence_id = ${f.id} order by revision`.execute(base.db)).rows;
  const ev = (await sql<{ version: number; current_content_id: string | null }>`select version, current_content_id from evidence where id = ${f.id}`.execute(base.db)).rows[0]!;
  const dir = join(String(base.config.evidenceStorage.path), f.org, f.t, f.id);
  const files = existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).sort() : [];
  const audits = Number((await sql<{ n: string }>`select count(*) n from audit_event where record_id = ${f.id} and action = 'evidence.upload_content'`.execute(base.db)).rows[0]!.n);
  return { rows, version: ev.version, current: ev.current_content_id, files, audits };
}
/** Starts an upload over a real socket, sends `firstPart` bytes of `bytes`, returns a finisher. */
async function startUpload(port: number, session: P2World["lead"]["session"], f: { id: string; version: number }, bytes: Buffer, firstPart: number, name = "p.bin", tPath = T) {
  const c = await client(port);
  c.s.write(head(`${tPath}/evidence/${f.id}/content`, { ...authOf(session), "If-Match": `"${f.version}"`, "X-File-Name": name, "Content-Type": "application/octet-stream", "Content-Length": bytes.length }));
  c.s.write(bytes.subarray(0, firstPart));
  return {
    c,
    async finish() {
      c.s.write(bytes.subarray(firstPart));
      await waitFor(() => first(c.text()) !== null || c.ended, 15_000);
      const r = first(c.text()); c.s.destroy(); return r;
    },
  };
}
const errLogsSince = (n: number) => logLines.slice(n).filter((l) => l.level >= 50);

describe("Q TOCTOU between phase 1 and phase 3 of the three-phase upload", () => {
  it("Q1 grant revoked while the body streams: 403, no content row, no object, version unchanged", async () => {
    const { api, port } = await fresh();
    const f = await newFile(p.contributor.session, p.contributor.id, "Synthetic Q1");
    const bytes = randomBytes(MiB);
    const u = await startUpload(port, p.contributor.session, f, bytes, 64 * 1024);
    await sleep(500);
    const mid = await state({ ...f });
    const rev = await api.owner.query(`update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'probe Q1' where user_id = $2 and revoked_at is null`, [w.grantor.id, p.contributor.id]);
    const r = await u.finish();
    const s = await state(f);
    // control: a NEW request by the same session after the revocation (a JSON edit of another own item)
    const g = await newFileOrStatus(p.contributor.session, p.contributor.id);
    await closeApi(api);
    log("Q1", { midUpload: mid, revoked: rev.rowCount, response: r, after: s, newRequestAfterRevocation: g });
    expect(g).toBe(404); // the revoked user can no longer read the transformation: 404 (existence not disclosed)
    expect(rev.rowCount).toBeGreaterThan(0);
    expect(mid.files.every((x) => x.endsWith(".part"))).toBe(true); // only a temporary while streaming
    expect(r?.status).toBe(403);
    expect(s.rows).toEqual([]);
    expect(s.version).toBe(f.version);
    expect(s.files).toEqual([]);
    expect(s.audits).toBe(0);
  }, 60_000);

  it("Q1b the uploading SESSION is logged out while the body streams: the upload must not commit (401), nothing stored", async () => {
    const { api, port } = await fresh();
    const f = await newFile(p.lead.session, p.lead.id, "Synthetic Q1b");
    const sess = await signInAgain();
    const g = await call(base.app, "GET", `${T}/evidence/${f.id}`, { session: sess });
    const u = await startUpload(port, sess, { id: f.id, version: g.body.version as number }, randomBytes(MiB), 64 * 1024, "q1b.bin");
    await sleep(400);
    const out = await call(base.app, "POST", "/api/v1/auth/logout", { session: sess });
    const meAfterLogout = (await call(base.app, "GET", "/api/v1/me", { session: sess })).status;
    const r = await u.finish();
    const s = await state(f);
    await closeApi(api);
    log("Q1b", { logout: out.status, meAfterLogout, response: { status: r?.status, code: r?.code }, after: s });
    expect(meAfterLogout).toBe(401);
    expect(r?.status).toBe(401);
    expect(s.rows).toEqual([]);
  }, 60_000);

  it("Q2 transformation archived while the body streams: 422 transformation.archived, nothing stored", async () => {
    const { api, port } = await fresh();
    const t = await call(base.app, "POST", "/api/v1/transformations", { session: p.lead.session, body: { businessUnitId: w.a1, name: "Synthetic Q2 transformation", mode: "end_to_end" } });
    expect(t.status).toBe(201);
    const tPath = `/api/v1/transformations/${t.body.id}`;
    const f = await newFile(p.lead.session, p.lead.id, "Synthetic Q2", tPath);
    const bytes = randomBytes(MiB);
    const u = await startUpload(port, p.lead.session, f, bytes, 64 * 1024, "q2.bin", tPath);
    await sleep(300);
    const cur = await call(base.app, "GET", tPath, { session: p.lead.session });
    const arch = await call(base.app, "POST", `${tPath}/archive`, { session: p.lead.session, headers: ifm(cur.body.version as number), body: { reason: "Synthetic probe Q2" } });
    const r = await u.finish();
    const s = await state(f);
    await closeApi(api);
    log("Q2", { archive: arch.status, response: r, after: s });
    expect(arch.status).toBe(200);
    expect(r?.status).toBe(422);
    expect(r?.code).toBe("transformation.archived");
    expect(s.rows).toEqual([]);
    expect(s.files).toEqual([]);
  }, 60_000);

  it("Q3 two uploads with the same If-Match whose bodies complete together: one 200, one 409, one revision, one object", async () => {
    const { api, port } = await fresh();
    const f = await newFile(p.lead.session, p.lead.id, "Synthetic Q3");
    const a = randomBytes(2 * MiB), b = randomBytes(2 * MiB);
    const ua = await startUpload(port, p.lead.session, f, a, MiB, "q3a.bin");
    const ub = await startUpload(port, p.lead.session, f, b, MiB, "q3b.bin");
    await sleep(300);
    const [ra, rb] = await Promise.all([ua.finish(), ub.finish()]);
    const s = await state(f);
    await closeApi(api);
    const winner = ra?.status === 200 ? a : b;
    log("Q3", { statuses: [ra?.status, rb?.status], codes: [ra?.code, rb?.code], after: s });
    expect([ra?.status, rb?.status].sort()).toEqual([200, 409]);
    expect(s.rows.length).toBe(1);
    expect(s.rows[0]!.revision).toBe(1);
    expect(s.rows[0]!.sha256).toBe(sha(winner));
    expect(s.files).toEqual([s.rows[0]!.storage_key.split("/").pop()]);
    expect(s.audits).toBe(1);
    expect(s.version).toBe(f.version + 1);
  }, 60_000);
});

describe("Q4 a failure at COMMIT after the object was finalised", () => {
  it("Q4 deferred constraint fails the commit: 500 (not a 4xx), error-level log, no content row, no final object and no temporary", async () => {
    const { api, port } = await fresh();
    await api.owner.query(`create or replace function zz_probe_q4() returns trigger language plpgsql as $$ begin if new.file_name = 'commit-fail.bin' then raise exception 'probe Q4 commit failure'; end if; return null; end $$`);
    await api.owner.query(`drop trigger if exists zz_probe_q4 on evidence_content`);
    await api.owner.query(`create constraint trigger zz_probe_q4 after insert on evidence_content deferrable initially deferred for each row execute function zz_probe_q4()`);
    try {
      const f = await newFile(p.lead.session, p.lead.id, "Synthetic Q4");
      const before = logLines.length;
      const u = await startUpload(port, p.lead.session, f, randomBytes(256 * 1024), 1024, "commit-fail.bin");
      const r = await u.finish();
      const s = await state(f);
      const errs = errLogsSince(before).map((l) => l.msg);
      log("Q4", { response: r, after: s, errs });
      expect(r?.status).toBe(500);
      expect(errs.length).toBeGreaterThan(0);
      expect(s.rows).toEqual([]);
      expect(s.files).toEqual([]);
      expect(s.version).toBe(f.version);
    } finally {
      await api.owner.query(`drop trigger if exists zz_probe_q4 on evidence_content`);
      await closeApi(api);
    }
  }, 60_000);
});

describe("Q5 incomplete-body mapping: no over-match, no leftovers", () => {
  it("Q5a client aborts mid-upload: released, info-level 'request body not received completely', no error log, no .part left", async () => {
    const { api, port } = await fresh();
    const f = await newFile(p.lead.session, p.lead.id, "Synthetic Q5a");
    const before = logLines.length;
    const u = await startUpload(port, p.lead.session, f, randomBytes(4 * MiB), MiB);
    await sleep(400);
    u.c.s.destroy();
    await sleep(800);
    const conns = await new Promise<number>((r) => api.app.server.getConnections((_e, n) => r(n)));
    const s = await state(f);
    const lines = logLines.slice(before).filter((l) => l.level >= 30 && /body|error|fail/i.test(l.msg)).map((l) => ({ level: l.level, msg: l.msg, code: l.code }));
    await closeApi(api);
    log("Q5a", { conns, after: s, lines });
    expect(conns).toBe(0);
    expect(s.files).toEqual([]);
    expect(s.rows).toEqual([]);
    expect(lines.filter((l) => l.level >= 50)).toEqual([]);
    expect(lines.some((l) => l.level === 30 && l.msg === "request body not received completely")).toBe(true);
  }, 60_000);

  it("Q5b a genuine store fault while the body is still incomplete is NOT hidden as 400 (the store answers 503 unavailable, logged at error level)", async () => {
    const { api, port } = await fresh();
    const f = await newFile(p.lead.session, p.lead.id, "Synthetic Q5b");
    // the item's directory cannot be created: a plain FILE sits where it would go (server-side fault, not the client)
    const parent = join(String(base.config.evidenceStorage.path), f.org, f.t);
    mkdirSync(parent, { recursive: true });
    writeFileSync(join(parent, f.id), "blocker");
    const before = logLines.length;
    const u = await startUpload(port, p.lead.session, f, randomBytes(2 * MiB), 1024, "q5b.bin");
    await waitFor(() => first(u.c.text()) !== null || u.c.ended, 5_000);
    const r = first(u.c.text());
    u.c.s.destroy();
    const errs = errLogsSince(before).map((l) => l.msg);
    const s = await state({ ...f, id: f.id });
    await closeApi(api);
    log("Q5b", { response: { status: r?.status, code: r?.code }, errs, rows: s.rows });
    expect(r?.status).toBe(503);
    expect(r?.status).not.toBe(400);
    expect(errs.length).toBeGreaterThan(0);
    expect(s.rows).toEqual([]);
  }, 60_000);
});

describe("Q6 pool settings and stalled uploads", () => {
  it("Q6a every API pool session carries idle_in_transaction_session_timeout 30s and statement_timeout 30s", async () => {
    const r = await sql<{ i: string; s: string }>`select current_setting('idle_in_transaction_session_timeout') i, current_setting('statement_timeout') s`.execute(base.db);
    log("Q6a", r.rows[0]);
    expect(r.rows[0]).toEqual({ i: "30s", s: "30s" });
  });

  it("Q6b pool max 2, 6 stalled uploads: no session idle in transaction, another user's /me answers promptly, no row lock held", async () => {
    const { api, port } = await fresh({ max: 2 });
    const stalled: Client[] = []; const files: Array<{ id: string }> = [];
    for (let i = 0; i < 6; i++) {
      const f = await newFile(p.lead.session, p.lead.id, `Synthetic Q6b ${i}`); files.push(f);
      const u = await startUpload(port, p.lead.session, f, Buffer.alloc(10 * MiB, 7), 1024, `q6b-${i}.bin`);
      stalled.push(u.c);
    }
    await sleep(1_000);
    const act = { rows: await activity(await dbNameOf(api)) };
    const t0 = Date.now();
    const me = await Promise.race([api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } }).then((x) => x.statusCode), sleep(5_000).then(() => -1)]);
    const meMs = Date.now() - t0;
    // a row lock on a stalled item would make NOWAIT fail
    const lock = await api.owner.query(`select id from evidence where id = $1 for update nowait`, [files[0]!.id]).then(() => "free", (e: Error) => e.message);
    for (const c of stalled) c.s.destroy();
    await closeApi(api);
    log("Q6b", { pgActivity: act.rows, me, meMs, lock });
    expect(act.rows.find((r) => r.state.startsWith("idle in transaction"))).toBeUndefined();
    expect(act.rows.some((r) => r.state === "<null>")).toBe(false); // the query really sees the states
    expect(me).toBe(200);
    expect(meMs).toBeLessThan(1_000);
    expect(lock).toBe("free");
  }, 60_000);
});
