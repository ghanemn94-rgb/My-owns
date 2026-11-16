// T-B4, T-B5, T-B6 (T-DG7-BE-B; ADR-0069 §1, §3; p7-work-split §B.1, §B.4; REQ-S19-010, REQ-S01-006):
// getDeploymentStatus on a scratch database of this run's disposable PostgreSQL cluster.
//   T-B4: the body validates against the contract's DeploymentStatus; `origin` and `basePath` match APP_BASE_URL;
//         `schema.latestApplied` is the highest shipped migration file; 200 for ADM_TECH, TO, KDS, TD and AUD; 403 for
//         SP, TL, BO, WL, FIN, CM, SEC, ADM_METHOD, ADM_ACCESS and a user without grants; 401 without a session.
//   T-B5: with an S3 setting holding canary endpoint, bucket and SecretRef names, none of them appears in the body.
//   T-B6: APP_BASE_URL with the path /hub/: the configuration loader refuses it (DG1 behaviour, unchanged); a
//         configuration with that path reaching buildServer starts (listens), logs the B.5 warning exactly once, and
//         reports basePath "/hub/" (see the describe block and the BE-B handback, open question 1).
// The route is a read: no audit event. Every user and value is SYNTHETIC. Nothing here approves anything or touches
// DG0-DG7.
import { createDb, createPool, listMigrationFiles, migrate, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { record } from "../../../src/modules/audit/index.ts";
import { CONTRACT_VERSION, deploymentStatusView } from "../../../src/modules/platform/index.ts";
import { buildServer } from "../../../src/server.ts";
import { matchesComponent, openapi } from "../../support/contract.ts";
import {
  APP_ORIGIN,
  call,
  createOrg,
  createUser,
  grant,
  signIn,
  startApi,
  testConfig,
  type Session,
  type TestApi,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const PATH = "/api/v1/admin/deployment";
const READERS = ["ADM_TECH", "TO", "KDS", "TD", "AUD"];
const REFUSED = ["SP", "TL", "BO", "WL", "FIN", "CM", "SEC", "ADM_METHOD", "ADM_ACCESS"];

// T-B5 canaries (a closed loopback port, so the probe fails fast without any network).
const CANARY_ENDPOINT = "http://127.0.0.9:9";
const CANARY_BUCKET = "canary-deployment-bucket";
const CANARY_ACCESS = "CANARY_DEPLOYMENT_ACCESS";
const CANARY_SECRET = "CANARY_DEPLOYMENT_SECRET";

let api: TestApi;
let scratch: string;
let owner: Db;
let actorId: string;
const sessions: { role: string; session: Session }[] = [];

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_deployment_status_api");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  owner = createDb(createPool(roleUrl(adminUrl, scratch, "mth_owner"), { max: 2 }));
  api = await startApi({ database: scratch });
  const org = await createOrg(api.db);
  const grantor = await createUser(api.db, org.id);
  actorId = grantor.id;
  for (const { code } of await api.db.selectFrom("role").select("code").orderBy("code").execute()) {
    const u = await createUser(api.db, org.id);
    await grant(api.db, grantor.id, u.id, code, { type: "organization", id: org.id }, org.id);
    sessions.push({ role: code, session: await signIn(api.app, u.subject) });
  }
  const nobody = await createUser(api.db, org.id);
  sessions.push({ role: "(no grant)", session: await signIn(api.app, nobody.subject) });
}, 240_000);

afterAll(async () => {
  await api?.close();
  await owner?.destroy();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

const sessionOf = (role: string) => sessions.find((s) => s.role === role)!.session;

describe("T-B4: getDeploymentStatus", () => {
  it("the body validates against DeploymentStatus; origin, basePath, versions and the schema level are right", async () => {
    const res = await call<Body>(api.app, "GET", PATH, { session: sessionOf("ADM_TECH") });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const checked = matchesComponent("DeploymentStatus", res.body);
    expect(checked.ok, checked.errors).toBe(true);
    expect(deploymentStatusView.safeParse(res.body).success).toBe(true);
    const base = new URL(APP_ORIGIN);
    expect(res.body.baseUrl).toBe(base.href);
    expect(res.body.origin).toBe(base.origin);
    expect(res.body.basePath).toBe("/");
    expect(res.body.release).toEqual({ appVersion: "0.1.0", contractVersion: (openapi as Body).info.version });
    const files = listMigrationFiles();
    expect(res.body.schema).toEqual({
      status: "ok",
      shippedCount: files.length,
      appliedCount: files.length,
      pendingCount: 0,
      latestApplied: files[files.length - 1]!.name.replace(/\.sql$/, ""),
    });
    // The readiness detail is /readyz's own body (the same rule), and storage/worker agree with it.
    const readyz = await api.app.inject({ method: "GET", url: "/readyz" });
    expect(res.body.readiness).toEqual(readyz.json());
    expect(res.body.readiness.checks.storage).toBe("ok");
    expect(res.body.storage).toEqual({ status: "ok", driver: "filesystem", source: "environment" });
    expect(res.body.worker).toEqual({ status: "unknown", newestBeatAt: null, staleAfterSeconds: 90 });
    // Not initialized through bootstrap or seed-demo: no deployment_environment row.
    expect(res.body.environmentKind).toBeNull();
    expect(Date.parse(res.body.checkedAt)).not.toBeNaN();
  });

  it("CONTRACT_VERSION equals info.version of docs/api/openapi.yaml", () => {
    expect(CONTRACT_VERSION).toBe((openapi as Body).info.version);
  });

  it("200 for ADM_TECH, TO, KDS, TD and AUD; 403 for SP, TL, BO, WL, FIN, CM, SEC, ADM_METHOD, ADM_ACCESS and no grant", async () => {
    expect(sessions.map((s) => s.role)).toEqual(expect.arrayContaining([...READERS, ...REFUSED]));
    for (const role of READERS) {
      const res = await call<Body>(api.app, "GET", PATH, { session: sessionOf(role) });
      expect(res.status, role).toBe(200);
    }
    for (const role of [...REFUSED, "(no grant)"]) {
      const res = await call<Body>(api.app, "GET", PATH, { session: sessionOf(role) });
      expect(res.status, role).toBe(403);
      expect(res.body.code, role).toBe("forbidden");
    }
  });

  it("401 without a session; 400 for an undeclared query parameter", async () => {
    const anonymous = await call<Body>(api.app, "GET", PATH);
    expect(anonymous.status).toBe(401);
    const bad = await call<Body>(api.app, "GET", `${PATH}?x=1`, { session: sessionOf("ADM_TECH") });
    expect(bad.status).toBe(400);
  });

  it("is a read: no audit event is written", async () => {
    const count = async () =>
      Number(
        (await api.db
          .selectFrom("audit_event")
          .select(({ fn }) => fn.countAll().as("n"))
          .executeTakeFirst())!.n,
      );
    const before = await count();
    await call<Body>(api.app, "GET", PATH, { session: sessionOf("AUD") });
    expect(await count()).toBe(before);
  });
});

describe("T-B5: no storage endpoint, bucket or SecretRef name in the body", () => {
  it("with an S3 setting holding canary names, the body names none of them (storage: fail, driver s3)", async () => {
    const id = uuidv7();
    await api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("storage_setting")
        .values({
          id,
          driver: "s3",
          s3_endpoint: CANARY_ENDPOINT,
          s3_region: "me-central-1",
          s3_bucket: CANARY_BUCKET,
          s3_key_prefix: null,
          s3_force_path_style: true,
          s3_access_key_ref: JSON.stringify({ provider: "env", name: CANARY_ACCESS }),
          s3_secret_key_ref: JSON.stringify({ provider: "env", name: CANARY_SECRET }),
          reason: "Synthetic canary setting (T-B5)",
          version: 1,
          created_by: actorId,
          updated_by: actorId,
        })
        .execute();
      await record(
        tx,
        { actorUserId: actorId, requestId: "t-b5" },
        {
          action: "storage_setting.changed",
          recordType: "storage_setting",
          recordId: id,
          organizationId: null,
          newVersion: 1,
        },
      );
    });
    // The probe caches for 5 s; wait it out so this request probes the canary setting.
    await new Promise((r) => setTimeout(r, 5_100));
    const res = await call<Body>(api.app, "GET", PATH, { session: sessionOf("ADM_TECH") });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(matchesComponent("DeploymentStatus", res.body).ok).toBe(true);
    expect(res.body.storage).toEqual({ status: "fail", driver: "s3", source: "setting" });
    expect(res.body.readiness.status).toBe("not_ready");
    const text = JSON.stringify(res.body);
    for (const canary of [CANARY_ENDPOINT, "127.0.0.9", CANARY_BUCKET, CANARY_ACCESS, CANARY_SECRET])
      expect(text.includes(canary), canary).toBe(false);
    const readyz = await api.app.inject({ method: "GET", url: "/readyz" });
    for (const canary of [CANARY_ENDPOINT, "127.0.0.9", CANARY_BUCKET, CANARY_ACCESS, CANARY_SECRET])
      expect(readyz.body.includes(canary), canary).toBe(false);
  }, 30_000);
});

describe("T-B6: APP_BASE_URL with a sub-path", () => {
  // The configuration loader (packages/config, DG1) refuses an APP_BASE_URL with a path before the API is built, so a
  // deployment configured from the environment never runs under a sub-path. That stays (changing it would loosen DG1
  // behaviour; see the BE-B handback, open question 1). The B.5 warning and `basePath` are the API's own defence for a
  // configuration that reaches buildServer with a path anyway: it still starts, warns once and reports the path.
  it("the configuration loader refuses APP_BASE_URL with the path /hub/", () => {
    expect(() => testConfig({ APP_BASE_URL: "http://127.0.0.1:25001/hub/" })).toThrow(
      /APP_BASE_URL is invalid \(must be an origin without path, query or fragment\)/,
    );
  });

  it("a configuration with the path /hub/ reaching buildServer: it starts, logs the B.5 warning exactly once, reports basePath /hub/", async () => {
    const lines: string[] = [];
    const { adminUrl } = inject("mthDb");
    const loaded = testConfig({ DATABASE_URL: roleUrl(adminUrl, scratch, "mth_app") });
    const port = 25_000 + Math.floor(Math.random() * 7_000);
    const base = `http://127.0.0.1:${port}/hub/`;
    const config = { ...loaded, appBaseUrl: new URL(base) };
    const pool = createPool(config.databaseUrl!, { max: 3, applicationName: "api-test-subpath" });
    const hub = await buildServer({
      config,
      pool,
      logger: true,
      logStream: { write: (l: string) => void lines.push(l) },
      webRoot: null,
    });
    try {
      await hub.app.listen({ port: 0, host: "127.0.0.1" });
      const warning = `config: APP_BASE_URL has the path '/hub/'; serving under a sub-path is not supported, so the hub is served from the origin root (see the deployment guide)`;
      // The CSRF Origin check compares with the configured origin, so the dev login sends this hub's own origin.
      const subject = (await createTechUser(hub.db)).subject;
      const login = await hub.app.inject({
        method: "POST",
        url: "/api/v1/auth/dev-login",
        headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
        payload: JSON.stringify({ username: subject }),
      });
      expect(login.statusCode, login.body).toBe(204);
      const cookie = String([login.headers["set-cookie"]].flat()[0]).split(";")[0]!;
      const res = await call<Body>(hub.app, "GET", PATH, { session: { cookie, csrf: "", userId: "" } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(matchesComponent("DeploymentStatus", res.body).ok).toBe(true);
      expect(res.body.baseUrl).toBe(base);
      expect(res.body.origin).toBe(`http://127.0.0.1:${port}`);
      expect(res.body.basePath).toBe("/hub/");
      const warnings = lines
        .map((l) => JSON.parse(l) as { level: number; msg: string })
        .filter((l) => l.msg === warning);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.level).toBe(40);
    } finally {
      await hub.app.close();
      await hub.db.destroy();
    }
  }, 60_000);

  it("an origin-root APP_BASE_URL logs no sub-path warning", async () => {
    const lines: string[] = [];
    const root = await startApi({ database: scratch, logStream: { write: (l: string) => void lines.push(l) } });
    await root.close();
    expect(lines.some((l) => l.includes("serving under a sub-path is not supported"))).toBe(false);
  });
});

async function createTechUser(db: Db): Promise<{ subject: string }> {
  const org = await createOrg(db);
  const grantor = await createUser(db, org.id);
  const u = await createUser(db, org.id);
  await grant(db, grantor.id, u.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
  return u;
}
