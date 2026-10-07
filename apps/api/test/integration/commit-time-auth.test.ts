// T-DG2-BE18 (F-DG2-440, F-DG2-441): a write that commits after waiting on the client is authorised AT COMMIT TIME,
// and no database transaction is open while the API waits on a remote IdP. Everything here runs over REAL sockets
// (llhttp) against the run's disposable PostgreSQL; pg_stat_activity is read as the cluster superuser. All data is
// SYNTHETIC. G1-G6 are PRODUCT gates (business approvals), unrelated to the engineering gates DG0-DG7.
//   F-440 before: the identity hook resolved the session and loaded the grants once, when the request started; the
//   upload's phase 3 re-ran the policy on that snapshot, so an upload that was streaming when its grant was revoked,
//   or its session logged out or expired, still committed (200) for up to requestTimeout.
//   F-440 now: phase 3 re-resolves the session and reloads the grants inside its write transaction: 401 when the
//   session ended, 403 (audited as authorization.denied) when the grant was revoked; nothing is committed or stored.
//   F-441 before: GET /auth/login ran OIDC discovery inside db.transaction(): with a never-answering IdP and pool max 3,
//   three logins held every pooled connection "idle in transaction" and a signed-in user's /me waited ~9 s.
//   F-441 now: discovery runs before the transaction; the logins hold no connection and /me answers at once.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { OidcService } from "../../src/modules/identity/index.ts";
import {
  APP_ORIGIN,
  call,
  grant,
  seedWorld,
  signIn,
  startApi,
  testConfig,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { setupP2World, type P2World } from "../support/p2-fixtures.ts";

const MiB = 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let base: TestApi;
let w: World;
let p: P2World;
let T: string;
let leadSubject: string;
beforeAll(async () => {
  base = await startApi();
  w = await seedWorld(base.db);
  p = await setupP2World(base, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  leadSubject = (
    await sql<{ s: string }>`select subject s from user_identity where user_id = ${p.lead.id} limit 1`.execute(base.db)
  ).rows[0]!.s;
}, 60_000);
afterAll(async () => {
  await base.close();
}, 60_000);

// ------------------------------------------------------------------------------------------------ helpers

async function listening(api: TestApi): Promise<number> {
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

async function closeApi(api: TestApi): Promise<void> {
  const closing = api.app.close();
  if (!(await Promise.race([closing.then(() => true), sleep(8_000).then(() => false)]))) {
    api.app.server.closeAllConnections();
    await closing;
  }
  await api.close();
}

interface Client {
  readonly socket: Socket;
  text(): string;
  ended: boolean;
}
function openClient(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const c: Client = { socket, text: () => Buffer.concat(chunks).toString("latin1"), ended: false };
    socket.on("data", (d: Buffer) => chunks.push(d));
    for (const e of ["end", "close", "error"] as const) socket.on(e, () => (c.ended = true));
    socket.once("connect", () => resolve(c));
    socket.once("error", reject);
  });
}

function firstResponse(text: string): { status: number; code: string | undefined; body: string } | null {
  const end = text.indexOf("\r\n\r\n");
  if (!text.startsWith("HTTP/1.1 ") || end < 0) return null;
  const [statusLine, ...lines] = text.slice(0, end).split("\r\n");
  const headers = new Map(
    lines.map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]),
  );
  const body = text.slice(end + 4, end + 4 + Number(headers.get("content-length") ?? 0));
  let code: string | undefined;
  try {
    code = (JSON.parse(body) as { code?: string }).code;
  } catch {
    code = undefined;
  }
  return { status: Number(statusLine!.split(" ")[1]), code, body };
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 >= ms) return false;
    await sleep(25);
  }
  return true;
}

async function newFile(session: Session, ownerId: string, title: string) {
  const c = await call(base.app, "POST", `${T}/evidence`, {
    session,
    body: { ownerUserId: ownerId, kind: "file", title },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  return { id: c.body.id as string, version: c.body.version as number, org: c.body.organizationId as string };
}

/** Starts an upload over a real socket and sends the first `firstPart` bytes; `finish()` sends the rest. */
async function startUpload(
  port: number,
  session: Session,
  f: { id: string; version: number },
  bytes: Buffer,
  firstPart: number,
) {
  const client = await openClient(port);
  const head = [
    `POST ${T}/evidence/${f.id}/content HTTP/1.1`,
    "Host: 127.0.0.1",
    `Cookie: ${session.cookie}`,
    `Origin: ${APP_ORIGIN}`,
    `X-CSRF-Token: ${session.csrf}`,
    `If-Match: "${f.version}"`,
    "X-File-Name: synthetic.bin",
    "Content-Type: application/octet-stream",
    `Content-Length: ${bytes.length}`,
  ].join("\r\n");
  client.socket.write(Buffer.from(`${head}\r\n\r\n`, "latin1"));
  client.socket.write(bytes.subarray(0, firstPart));
  return {
    client,
    async finish() {
      client.socket.write(bytes.subarray(firstPart));
      await waitFor(() => firstResponse(client.text()) !== null || client.ended, 15_000);
      const r = firstResponse(client.text());
      client.socket.destroy();
      return r;
    },
  };
}

/** What the item has after the upload: content rows, version, stored files, upload audits, denial audits. */
async function stateOf(f: { id: string; org: string }) {
  const rows = (
    await sql<{
      revision: number;
      sha256: string;
    }>`select revision, sha256 from evidence_content where evidence_id = ${f.id} order by revision`.execute(base.db)
  ).rows;
  const ev = (
    await sql<{
      version: number;
      current: string | null;
    }>`select version, current_content_id current from evidence where id = ${f.id}`.execute(base.db)
  ).rows[0]!;
  const dir = join(String(base.config.evidenceStorage.path), f.org, p.transformationId, f.id);
  const files = existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).sort() : [];
  const uploads = Number(
    (
      await sql<{
        n: string;
      }>`select count(*) n from audit_event where record_id = ${f.id} and action = 'evidence.upload_content'`.execute(
        base.db,
      )
    ).rows[0]!.n,
  );
  return { rows, version: ev.version, current: ev.current, files, uploads };
}

/** A new Workstream Lead assignment for the contributor at the transformation (as setupP2World grants it). */
async function regrantContributor(): Promise<void> {
  await grant(
    base.db,
    w.grantor.id,
    p.contributor.id,
    "WL",
    { type: "transformation", id: p.transformationId },
    w.orgA.id,
  );
}

async function denialAudits(actorId: string, since: Date) {
  return (
    await sql<{
      record_type: string;
      record_id: string;
      reason: string;
    }>`select record_type, record_id, reason from audit_event
      where action = 'authorization.denied' and actor_user_id = ${actorId} and occurred_at >= ${since} order by seq`.execute(
      base.db,
    )
  ).rows;
}

// ------------------------------------------------------------------------------------------------ F-DG2-440

describe("F-DG2-440: an upload is authorised again at commit time (session re-resolved, grants reloaded)", () => {
  it("Q1 the uploader's only grant is revoked while the body streams: 403 forbidden, audited as authorization.denied, nothing committed or stored", async () => {
    const api = await startApi();
    const port = await listening(api);
    try {
      const f = await newFile(p.contributor.session, p.contributor.id, "Synthetic Q1 revoked grant");
      const since = (await sql<{ t: Date }>`select now() t`.execute(base.db)).rows[0]!.t;
      const u = await startUpload(port, p.contributor.session, f, randomBytes(MiB), 64 * 1024);
      await sleep(400);
      const during = await stateOf(f);
      const revoked = await api.owner.query(
        `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic Q1' where user_id = $2 and revoked_at is null returning id`,
        [w.grantor.id, p.contributor.id],
      );
      try {
        const r = await u.finish();
        const after = await stateOf(f);
        const denials = await denialAudits(p.contributor.id, since);
        console.log(
          `BE18 Q1 ${JSON.stringify({ during: during.files, revoked: revoked.rowCount, response: r && { status: r.status, code: r.code }, after, denials })}`,
        );
        expect(revoked.rowCount).toBeGreaterThan(0);
        expect(during.files.every((x) => x.endsWith(".part"))).toBe(true);
        expect(r?.status).toBe(403);
        expect(r?.code).toBe("forbidden");
        expect(after.rows).toEqual([]);
        expect(after.version).toBe(f.version);
        expect(after.current).toBeNull();
        expect(after.files).toEqual([]);
        expect(after.uploads).toBe(0);
        expect(denials).toHaveLength(1);
        expect(denials[0]).toMatchObject({ record_type: "transformation", record_id: p.transformationId });
        expect(denials[0]!.reason).toMatch(/^POST .*\/content requires transformation\.read$/);
      } finally {
        await regrantContributor(); // the other tests use the contributor's Workstream Lead grant
      }
    } finally {
      await closeApi(api);
    }
  }, 60_000);

  it("Q1b the uploading session is logged out while the body streams: 401 unauthenticated, nothing committed or stored", async () => {
    const api = await startApi();
    const port = await listening(api);
    try {
      const f = await newFile(p.lead.session, p.lead.id, "Synthetic Q1b logout");
      const session = await signIn(base.app, leadSubject);
      const u = await startUpload(port, session, f, randomBytes(MiB), 64 * 1024);
      await sleep(400);
      const out = await call(base.app, "POST", "/api/v1/auth/logout", { session });
      const me = await call(base.app, "GET", "/api/v1/me", { session });
      const r = await u.finish();
      const after = await stateOf(f);
      console.log(
        `BE18 Q1b ${JSON.stringify({ logout: out.status, me: me.status, response: r && { status: r.status, code: r.code }, after })}`,
      );
      expect(out.status).toBe(200);
      expect(me.status).toBe(401);
      expect(r?.status).toBe(401);
      expect(r?.code).toBe("unauthenticated");
      expect(after.rows).toEqual([]);
      expect(after.version).toBe(f.version);
      expect(after.files).toEqual([]);
      expect(after.uploads).toBe(0);
    } finally {
      await closeApi(api);
    }
  }, 60_000);

  for (const expiry of ["idle", "absolute"] as const) {
    it(`the uploading session reaches its ${expiry} expiry while the body streams: 401 unauthenticated, nothing committed or stored`, async () => {
      const api = await startApi();
      const port = await listening(api);
      try {
        const f = await newFile(p.lead.session, p.lead.id, `Synthetic ${expiry} expiry`);
        const session = await signIn(base.app, leadSubject);
        const u = await startUpload(port, session, f, randomBytes(MiB), 64 * 1024);
        await sleep(400);
        // The session's expiry passes while the body streams (as a shortened idle timeout / lifetime would make it).
        const column = expiry === "idle" ? "idle_expires_at" : "absolute_expires_at";
        const expired = await api.owner.query(
          `update session set ${column} = now() - interval '1 second' where token_hash = $1 and revoked_at is null`,
          [createHash("sha256").update(session.cookie.split("=")[1]!, "utf8").digest()],
        );
        const r = await u.finish();
        const after = await stateOf(f);
        console.log(
          `BE18 ${expiry}-expiry ${JSON.stringify({ expired: expired.rowCount, response: r && { status: r.status, code: r.code }, after })}`,
        );
        expect(expired.rowCount).toBe(1);
        expect(r?.status).toBe(401);
        expect(r?.code).toBe("unauthenticated");
        expect(after.rows).toEqual([]);
        expect(after.files).toEqual([]);
        expect(after.uploads).toBe(0);
      } finally {
        await closeApi(api);
      }
    }, 60_000);
  }

  it("the uploader's user account is disabled while the body streams: 401, nothing committed", async () => {
    const api = await startApi();
    const port = await listening(api);
    try {
      const f = await newFile(p.contributor.session, p.contributor.id, "Synthetic disabled user");
      const u = await startUpload(port, p.contributor.session, f, randomBytes(MiB), 64 * 1024);
      await sleep(400);
      await api.owner.query(`update app_user set status = 'disabled' where id = $1`, [p.contributor.id]);
      try {
        const r = await u.finish();
        const after = await stateOf(f);
        expect(r?.status).toBe(401);
        expect(after.rows).toEqual([]);
        expect(after.files).toEqual([]);
      } finally {
        await api.owner.query(`update app_user set status = 'active' where id = $1`, [p.contributor.id]);
      }
    } finally {
      await closeApi(api);
    }
  }, 60_000);

  it("positive control: an upload whose session and grant stay valid commits (200), byte-exact, audited once", async () => {
    const api = await startApi();
    const port = await listening(api);
    try {
      const f = await newFile(p.contributor.session, p.contributor.id, "Synthetic normal upload");
      const bytes = randomBytes(MiB);
      const u = await startUpload(port, p.contributor.session, f, bytes, 64 * 1024);
      await sleep(300);
      const r = await u.finish();
      const after = await stateOf(f);
      expect(r?.status, r?.body).toBe(200);
      expect(after.rows).toEqual([{ revision: 1, sha256: sha256(bytes) }]);
      expect(after.version).toBe(f.version + 1);
      expect(after.files).toHaveLength(1);
      expect(after.files[0]!.endsWith(".part")).toBe(false);
      expect(after.uploads).toBe(1);
    } finally {
      await closeApi(api);
    }
  }, 60_000);

  it("a grant revoked and granted again (a new assignment) while the body streams: the commit sees the CURRENT grants and succeeds", async () => {
    const api = await startApi();
    const port = await listening(api);
    try {
      const f = await newFile(p.contributor.session, p.contributor.id, "Synthetic re-granted");
      const u = await startUpload(port, p.contributor.session, f, randomBytes(MiB), 64 * 1024);
      await sleep(300);
      await api.owner.query(
        `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic re-grant' where user_id = $2 and revoked_at is null`,
        [w.grantor.id, p.contributor.id],
      );
      await regrantContributor();
      const r = await u.finish();
      expect(r?.status, r?.body).toBe(200);
      expect((await stateOf(f)).rows).toHaveLength(1);
    } finally {
      await closeApi(api);
    }
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------ F-DG2-441

/** pg_stat_activity as the cluster SUPERUSER (the owner role cannot see the state of mth_app sessions). */
async function activityOf(applicationName: string): Promise<Array<{ state: string; n: number }>> {
  const c = new pg.Client({ connectionString: inject("mthDb").adminUrl });
  await c.connect();
  try {
    const db = (await sql<{ d: string }>`select current_database() d`.execute(base.db)).rows[0]!.d;
    return (
      await c.query(
        `select coalesce(state, '<null>') state, count(*)::int n from pg_stat_activity where application_name = $1 and datname = $2 group by 1 order by 1`,
        [applicationName, db],
      )
    ).rows as Array<{ state: string; n: number }>;
  } finally {
    await c.end();
  }
}

describe("F-DG2-441: no transaction is open while the API waits on the IdP", () => {
  let hole: Server;
  const held: Socket[] = [];
  let holePort = 0;
  beforeAll(async () => {
    // A "blackhole" IdP: accepts TCP connections and never answers (a slow or unreachable IdP).
    hole = createServer((s) => {
      held.push(s);
      s.on("error", () => undefined);
    });
    await new Promise<void>((r) => hole.listen(0, "127.0.0.1", () => r()));
    holePort = (hole.address() as { port: number }).port;
  });
  afterAll(() => {
    for (const s of held) s.destroy();
    hole.close();
  });

  it("Q7 never-answering IdP, pool max 3: three concurrent logins hold no connection or transaction; a signed-in user's /me stays prompt; the logins end in 302 idp_unavailable", async () => {
    const appName = "api-test-oidc-q7";
    // Default discovery timeout (10 s), shortened here only to keep the run short; the observation is made at 1 s.
    const svc = new OidcService(
      testConfig({
        OIDC_ISSUER_URL: `http://127.0.0.1:${holePort}/realms/slow`,
        OIDC_CLIENT_ID: "c",
        OIDC_CLIENT_SECRET: "s",
      }),
      { discoveryTimeoutSeconds: 4 },
    );
    const api = await startApi({
      oidc: svc,
      env: { AUTH_RATE_LIMIT_PER_MINUTE: "20" },
      pool: { max: 3, applicationName: appName },
    });
    try {
      // Warm the pool so pg_stat_activity shows its sessions.
      expect(
        (await api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } }))
          .statusCode,
      ).toBe(200);
      const t0 = Date.now();
      const logins = [0, 1, 2].map(() =>
        api.app
          .inject({ method: "GET", url: "/api/v1/auth/login" })
          .then((r) => ({ status: r.statusCode, location: r.headers.location, ms: Date.now() - t0 })),
      );
      await sleep(1_000);
      const act = await activityOf(appName);
      const t1 = Date.now();
      const me = await api.app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: { cookie: p.sponsor.session.cookie },
      });
      const meMs = Date.now() - t1;
      const results = await Promise.all(logins);
      console.log(`BE18 Q7 ${JSON.stringify({ pgActivityAt1s: act, me: me.statusCode, meMs, logins: results })}`);
      expect(act.length).toBeGreaterThan(0);
      expect(act.some((r) => r.state === "<null>")).toBe(false); // the query really sees the states
      expect(act.filter((r) => r.state.startsWith("idle in transaction"))).toEqual([]);
      expect(act.filter((r) => r.state === "active")).toEqual([]);
      expect(me.statusCode).toBe(200);
      expect(meMs).toBeLessThan(1_000);
      for (const r of results) {
        expect(r.status).toBe(302);
        expect(r.location).toBe("/login?error=idp_unavailable");
      }
    } finally {
      await api.close();
    }
  }, 60_000);
});
