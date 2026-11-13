// T-B2 (T-DG7-BE-B; ADR-0069 §2; p7-work-split §B.1, §B.4; REQ-S19-010): the evidence-storage probe and the worker
// heartbeat in /readyz, on a scratch database of this run's disposable PostgreSQL cluster and the P6 in-process fake
// S3 (SigV4-verifying; SYNTHETIC keys, nothing here is a live store). The probe and the heartbeat reader are the real
// ones (evidence/readiness.ts, operations/heartbeat.ts readWorkerHeartbeat) mounted through registerHealthRoutes:
//   - filesystem root missing, not a directory, or read-only -> fail;
//   - S3 reachable -> ok; the fake stopped -> fail within 2 500 ms; a server that never answers -> fail within 2 500 ms;
//   - an incomplete S3 setting (s3 named by the environment with no saved setting) -> fail; unresolvable credential
//     references -> fail;
//   - two /readyz calls within 5 s -> one storage call;
//   - neither the body nor any log line holds the endpoint, bucket, path or a SecretRef name;
//   - heartbeat <= 90 s -> alive, older -> stale, none -> unknown (and the worker never gates readiness).
// The storage setting is written as the API writes it: the row and its audit event in one transaction (ADR-0004).
// Nothing here approves anything or touches DG0-DG7.
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, createPool, migrate, sql, type Db, listMigrationFiles } from "@mth/db";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { record } from "../../../src/modules/audit/index.ts";
import { createEvidenceStorageProbe, type EvidenceStorageProbe } from "../../../src/modules/evidence/readiness.ts";
import type { EnvironmentStorage } from "../../../src/modules/evidence/store.ts";
import { readWorkerHeartbeat } from "../../../src/modules/operations/heartbeat.ts";
import {
  createSecretProviderRegistry,
  registerHealthRoutes,
  secretValue,
  type ReadinessProbes,
  type SecretProvider,
} from "../../../src/modules/platform/index.ts";
import { FakeS3 } from "../../support/fake-s3.ts";
import { createOrg, createUser } from "../../support/harness.ts";
import { testSecretBindings } from "../../support/secret-bindings.ts";

// Canary names: none of them may appear in a /readyz body or a log line.
const BUCKET = "canary-readiness-bucket";
const ACCESS_REF = "CANARY_READINESS_ACCESS";
const SECRET_REF = "CANARY_READINESS_SECRET";

const fake = new FakeS3({ buckets: [BUCKET] });
const keys = fake.credentials[0]!;

function testSecrets() {
  const provider: SecretProvider = {
    id: "test",
    get: (name) =>
      Promise.resolve(
        name === ACCESS_REF
          ? secretValue(keys.accessKeyId)
          : name === SECRET_REF
            ? secretValue(keys.secretAccessKey)
            : undefined,
      ),
  };
  const registry = createSecretProviderRegistry({
    bindings: () =>
      testSecretBindings(
        [ACCESS_REF, SECRET_REF, "CANARY_UNRESOLVABLE"].map((name) => ({
          provider: "test",
          name,
          consumer: "storage" as const,
          organization: null,
          hosts: ["127.0.0.1"],
        })),
      ),
  });
  registry.register(provider);
  return registry;
}
const secrets = testSecrets();

let scratch: string;
let pool: pg.Pool;
let db: Db;
let owner: Db;
let actorId: string;
let root: string;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_readiness_storage_worker");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  pool = createPool(roleUrl(adminUrl, scratch, "mth_app"), { max: 4 });
  db = createDb(pool);
  owner = createDb(createPool(roleUrl(adminUrl, scratch, "mth_owner"), { max: 2 }));
  const org = await createOrg(db);
  actorId = (await createUser(db, org.id)).id;
  root = await mkdtemp(join(tmpdir(), "mth-readiness-"));
  await fake.start();
}, 240_000);

afterAll(async () => {
  await fake.stop();
  await db?.destroy();
  await owner?.destroy();
  if (root) await rm(root, { recursive: true, force: true });
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

/** Writes the singleton storage setting with its audit event (the API's write path). */
async function setStorage(values: {
  driver: "filesystem" | "s3";
  endpoint: string;
  accessRef?: string;
  secretRef?: string;
}): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const current = await tx.selectFrom("storage_setting").select(["id", "version"]).executeTakeFirst();
    const id = current?.id ?? uuidv7();
    const version = (current?.version ?? 0) + 1;
    const row = {
      driver: values.driver,
      s3_endpoint: values.endpoint,
      s3_region: fake.region,
      s3_bucket: BUCKET,
      s3_key_prefix: null,
      s3_force_path_style: true,
      s3_access_key_ref: JSON.stringify({ provider: "test", name: values.accessRef ?? ACCESS_REF }),
      s3_secret_key_ref: JSON.stringify({ provider: "test", name: values.secretRef ?? SECRET_REF }),
      reason: "Synthetic readiness test setting",
      version,
      updated_by: actorId,
    };
    if (current) await tx.updateTable("storage_setting").set(row).where("id", "=", id).execute();
    else
      await tx
        .insertInto("storage_setting")
        .values({ id, created_by: actorId, ...row })
        .execute();
    await record(
      tx,
      { actorUserId: actorId, requestId: "t-b2" },
      {
        action: "storage_setting.changed",
        recordType: "storage_setting",
        recordId: id,
        organizationId: null,
        priorVersion: current ? current.version : null,
        newVersion: version,
      },
    );
  });
}

const fsEnv = (path: string): EnvironmentStorage => ({ driver: "filesystem", path });
/** A probe without the 5 s cache, so each call probes (the cache has its own test below). */
const uncached = (environment: EnvironmentStorage): EvidenceStorageProbe =>
  createEvidenceStorageProbe({ environment, secrets: () => secrets, cacheMs: 0 });

const workerProbe: ReadinessProbes["worker"] = async (d) => {
  const b = await readWorkerHeartbeat(d);
  return { status: b.status, newestBeatAt: b.newestBeatAt, staleAfterSeconds: b.staleAfterSeconds };
};

/** A Fastify app with the real /readyz on the scratch database, capturing every log line. */
function readyzApp(storage: EvidenceStorageProbe): { app: FastifyInstance; lines: string[] } {
  const lines: string[] = [];
  const app = Fastify({ logger: { level: "trace", stream: { write: (l: string) => lines.push(l) } } });
  registerHealthRoutes(app, pool, listMigrationFiles(), { storage, worker: workerProbe });
  return { app, lines };
}

async function readyz(app: FastifyInstance): Promise<{
  status: number;
  body: { status: string; checks: { database: string; migrations: string; storage: string; worker: string } };
}> {
  const res = await app.inject({ method: "GET", url: "/readyz" });
  return { status: res.statusCode, body: res.json() };
}

/** Asserts that none of the canaries (and none of `extra`) appears in any of the texts. */
function expectNoLeak(texts: string[], extra: string[]): void {
  const host = new URL(fake.endpoint).host;
  for (const t of texts)
    for (const canary of [fake.endpoint, host, BUCKET, ACCESS_REF, SECRET_REF, "CANARY_UNRESOLVABLE", ...extra])
      expect(t.includes(canary), `"${canary}" leaked into: ${t}`).toBe(false);
}

describe("T-B2: the evidence-storage probe", () => {
  it("filesystem: a readable and writable directory -> ok; missing, not a directory, read-only -> fail", async () => {
    expect(await uncached(fsEnv(root))(db)).toEqual({
      status: "ok",
      driver: "filesystem",
      source: "environment",
      errorCode: null,
    });
    const missing = join(root, "does-not-exist");
    expect(await uncached(fsEnv(missing))(db)).toMatchObject({ status: "fail", errorCode: "ENOENT" });
    const file = join(root, "a-file");
    await writeFile(file, "x");
    expect(await uncached(fsEnv(file))(db)).toMatchObject({ status: "fail", errorCode: "ENOTDIR" });

    // Read-only: mode 0555 for a non-root process. uid 0 bypasses mode bits, so as root the read-only case is a
    // read-only MOUNT (EROFS); if no such mount exists the test fails rather than skip the case.
    const readOnly = join(root, "read-only");
    await (await import("node:fs/promises")).mkdir(readOnly);
    await chmod(readOnly, 0o555);
    let target = readOnly;
    if (process.getuid?.() === 0) {
      target = "";
      for (const candidate of ["/usr", "/sys", "/proc/sys"])
        try {
          await access(candidate, constants.W_OK);
        } catch (err) {
          if ((err as { code?: string }).code === "EROFS") {
            target = candidate;
            break;
          }
        }
      expect(target, "uid 0 and no read-only mount found: the read-only case cannot be constructed").not.toBe("");
    }
    const ro = await uncached(fsEnv(target))(db);
    expect(ro.status).toBe("fail");
    expect(["EACCES", "EROFS"]).toContain(ro.errorCode);
    await chmod(readOnly, 0o755);
  });

  it("an incomplete S3 setting (s3 named by the environment, no saved setting) -> fail NotConfigured", async () => {
    expect(await db.selectFrom("storage_setting").select("id").executeTakeFirst()).toBeUndefined();
    expect(await uncached({ driver: "s3", path: root })(db)).toEqual({
      status: "fail",
      driver: "s3",
      source: "environment",
      errorCode: "NotConfigured",
    });
  });

  it("S3 reachable -> ok (an absent probe key is a valid answer); one HeadObject of mth-readiness-probe", async () => {
    await setStorage({ driver: "s3", endpoint: fake.endpoint });
    const before = fake.requests.length;
    expect(await uncached(fsEnv(root))(db)).toEqual({ status: "ok", driver: "s3", source: "setting", errorCode: null });
    const sent = fake.requests.slice(before);
    // Authenticated (a refused signature is 403) and answered "no such key" (404): the store answers.
    expect(sent.map((r) => [r.method, r.status])).toEqual([["HEAD", 404]]);
    expect(sent[0]!.path.endsWith("/mth-readiness-probe")).toBe(true);
  });

  it("credential references that resolve to nothing -> fail", async () => {
    await setStorage({ driver: "s3", endpoint: fake.endpoint, accessRef: "CANARY_UNRESOLVABLE" });
    expect(await uncached(fsEnv(root))(db)).toMatchObject({ status: "fail", driver: "s3", source: "setting" });
    await setStorage({ driver: "s3", endpoint: fake.endpoint });
  });

  it("the fake S3 stopped -> fail within 2 500 ms", async () => {
    const gone = new FakeS3({ buckets: [BUCKET], credentials: fake.credentials });
    await gone.start();
    const endpoint = gone.endpoint;
    await gone.stop();
    await setStorage({ driver: "s3", endpoint });
    const t0 = performance.now();
    const r = await uncached(fsEnv(root))(db);
    const ms = performance.now() - t0;
    expect(r).toMatchObject({ status: "fail", driver: "s3" });
    expect(ms).toBeLessThan(2_500);
  });

  it("a store that accepts the connection and never answers -> fail Timeout within 2 500 ms", async () => {
    const sockets: Socket[] = [];
    const silent: Server = createServer((s) => {
      sockets.push(s);
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as { port: number };
    try {
      await setStorage({ driver: "s3", endpoint: `http://127.0.0.1:${port}` });
      const t0 = performance.now();
      const r = await uncached(fsEnv(root))(db);
      const ms = performance.now() - t0;
      expect(r.status).toBe("fail");
      expect(ms).toBeLessThan(2_500);
      expect(ms).toBeGreaterThanOrEqual(1_900);
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
      await setStorage({ driver: "s3", endpoint: fake.endpoint });
    }
  });
});

describe("T-B2: /readyz with the real probes", () => {
  it("two /readyz calls within 5 s cause one storage call", async () => {
    await setStorage({ driver: "s3", endpoint: fake.endpoint });
    const { app } = readyzApp(createEvidenceStorageProbe({ environment: fsEnv(root), secrets: () => secrets }));
    try {
      const heads = () => fake.requests.filter((r) => r.method === "HEAD").length;
      const before = heads();
      const a = await readyz(app);
      const b = await readyz(app);
      expect(a.body.checks.storage).toBe("ok");
      expect(b.body.checks.storage).toBe("ok");
      expect(heads() - before).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("a storage failure is 503 with storage: fail, and neither body nor log names the endpoint, bucket, path or SecretRef", async () => {
    const gone = new FakeS3({ buckets: [BUCKET], credentials: fake.credentials });
    await gone.start();
    const goneEndpoint = gone.endpoint;
    await gone.stop();
    await setStorage({ driver: "s3", endpoint: goneEndpoint });
    const s3App = readyzApp(uncached(fsEnv(root)));
    const missing = join(root, "canary-missing-evidence-dir");
    const fsApp = readyzApp(uncached(fsEnv(missing)));
    try {
      const s3 = await readyz(s3App.app);
      expect(s3.status).toBe(503);
      expect(s3.body).toEqual({
        status: "not_ready",
        checks: { database: "ok", migrations: "ok", storage: "fail", worker: s3.body.checks.worker },
      });
      // One warn line, in the B.5 form, naming the driver and an error code only.
      const s3Lines = s3App.lines.filter((l) => l.includes("readiness: evidence storage"));
      expect(s3Lines).toHaveLength(1);
      expect(JSON.parse(s3Lines[0]!)).toMatchObject({ level: 40 });
      expect(JSON.parse(s3Lines[0]!).msg).toMatch(
        /^readiness: evidence storage \(s3\) did not answer the probe: [A-Za-z0-9_.-]+$/,
      );
      expectNoLeak([JSON.stringify(s3.body), ...s3App.lines], [new URL(goneEndpoint).host, root]);

      await setStorage({ driver: "filesystem", endpoint: fake.endpoint });
      const fsr = await readyz(fsApp.app);
      expect(fsr.status).toBe(503);
      expect(fsr.body.checks.storage).toBe("fail");
      const fsLines = fsApp.lines.filter((l) => l.includes("readiness: evidence storage"));
      expect(JSON.parse(fsLines[0]!).msg).toBe(
        "readiness: evidence storage (filesystem) did not answer the probe: ENOENT",
      );
      expectNoLeak([JSON.stringify(fsr.body), ...fsApp.lines], [missing, root]);
    } finally {
      await s3App.app.close();
      await fsApp.app.close();
      await setStorage({ driver: "filesystem", endpoint: fake.endpoint });
    }
  });

  it("worker: no beat -> unknown; a beat <= 90 s old -> alive; older -> stale; the worker never gates", async () => {
    await setStorage({ driver: "filesystem", endpoint: fake.endpoint });
    const { app } = readyzApp(uncached(fsEnv(root)));
    try {
      await sql`DELETE FROM worker_heartbeat`.execute(owner);
      expect(await readyz(app)).toEqual({
        status: 200,
        body: { status: "ready", checks: { database: "ok", migrations: "ok", storage: "ok", worker: "unknown" } },
      });
      await sql`INSERT INTO worker_heartbeat (id, instance_key, app_version, started_at, last_beat_at, beat_count, queue_count)
        VALUES (${uuidv7()}, 'synthetic-worker-1', '0.1.0', now() - interval '10 minutes', now() - interval '60 seconds', 3, 5)`.execute(
        owner,
      );
      expect((await readyz(app)).body.checks.worker).toBe("alive");
      // A beat never moves backwards (worker_heartbeat_guard): the stale case is a fresh table with an older beat.
      await sql`DELETE FROM worker_heartbeat`.execute(owner);
      await sql`INSERT INTO worker_heartbeat (id, instance_key, app_version, started_at, last_beat_at, beat_count, queue_count)
        VALUES (${uuidv7()}, 'synthetic-worker-2', '0.1.0', now() - interval '10 minutes', now() - interval '91 seconds', 3, 5)`.execute(
        owner,
      );
      const stale = await readyz(app);
      expect(stale).toEqual({
        status: 200,
        body: { status: "ready", checks: { database: "ok", migrations: "ok", storage: "ok", worker: "stale" } },
      });
    } finally {
      await sql`DELETE FROM worker_heartbeat`.execute(owner);
      await app.close();
    }
  });
});
