// code-security-reviewer DG2 round-12 probe (T-DG2-REV-SEC-R12), sweep for "a pooled connection or transaction held
// while waiting on something other than the database". NOT part of the candidate; disposable clone + disposable
// PostgreSQL 16. All data SYNTHETIC. The IdP is a local "blackhole" TCP server that accepts and never answers (a slow or
// unreachable IdP); OidcService uses its DEFAULT discovery timeout (10 s); AUTH_RATE_LIMIT_PER_MINUTE is the product
// default (20 per IP). Observation logged as "PROBE <key>: <json>".
import { createServer, type Server, type Socket } from "node:net";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { OidcService } from "../../src/modules/identity/oidc.ts";
import { seedWorld, startApi, testConfig, type TestApi, type World } from "../support/harness.ts";
import { setupP2World, type P2World } from "../support/p2-fixtures.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
let base: TestApi; let w: World; let p: P2World;
let hole: Server; const held: Socket[] = []; let holePort = 0;
beforeAll(async () => {
  base = await startApi();
  w = await seedWorld(base.db);
  p = await setupP2World(base, w);
  hole = createServer((s) => { held.push(s); s.on("error", () => undefined); });
  await new Promise<void>((r) => hole.listen(0, "127.0.0.1", () => r()));
  holePort = (hole.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { for (const s of held) s.destroy(); hole.close(); await base.close(); }, 60_000);

describe("Q7 OIDC discovery runs inside an open transaction (identity/routes.ts startLogin)", () => {
  it("Q7 IdP unresponsive, pool max 3: 3 unauthenticated GET /auth/login hold every pooled connection 'idle in transaction'; a signed-in user's GET /me must still answer promptly", async () => {
    const svc = new OidcService(testConfig({ OIDC_ISSUER_URL: `http://127.0.0.1:${holePort}/realms/slow`, OIDC_CLIENT_ID: "c", OIDC_CLIENT_SECRET: "s" }));
    const api = await startApi({ oidc: svc, env: { AUTH_RATE_LIMIT_PER_MINUTE: "20" }, pool: { max: 3 } });
    try {
      const t0 = Date.now();
      const logins = [0, 1, 2].map(() => api.app.inject({ method: "GET", url: "/api/v1/auth/login" }).then((r) => ({ status: r.statusCode, location: r.headers.location, ms: Date.now() - t0 })));
      await sleep(1_000);
      const act = await activity(await dbNameOf(base));
      const t1 = Date.now();
      const me = await api.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: p.sponsor.session.cookie } }).then((r) => ({ status: r.statusCode, code: (r.json() as { code?: string }).code, ms: Date.now() - t1 }));
      const loginResults = await Promise.all(logins);
      log("Q7", { pgActivityAt1s: act, meWhileIdpSlow: me, logins: loginResults });
      expect(act.some((r) => r.state === "<null>")).toBe(false); // the query really sees the states
      expect(act.find((r) => r.state === "idle in transaction")).toBeUndefined();
      expect(me.status).toBe(200);
      expect(me.ms).toBeLessThan(1_000);
    } finally {
      await api.close();
    }
  }, 60_000);
});
