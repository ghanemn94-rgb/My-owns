// T-DG5-BE-T5 (D-167; QA-F2 D-QA-F2-3, REQ-S13-005 "a killed worker mid-export completes once"): an export attempt
// killed AFTER its `store.put` and BEFORE its success commit leaves its per-attempt file (`<job>-a<n>.<ext>`), which
// no job row records. The next attempt removes the earlier attempts' files through the store port when it starts, and
// the succeeding attempt removes any that remain; another job's files are never touched. Against the run's disposable
// PostgreSQL, through the API and the worker's export runner. All data is SYNTHETIC; an export approves nothing.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FilesystemExportStore, type ExportFileStore } from "../../../../../packages/reporting/src/storage.ts";
import { runExport, type ExportRunnerDeps } from "../../../../worker/src/reports/export-runner.ts";
import { call, seedWorld, startApi, testEvidenceDir, type TestApi, type World } from "../../support/harness.ts";
import { setupP2World, type P2World } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let p: P2World;
let snapshotId: string;
const store = () => new FilesystemExportStore(testEvidenceDir());

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

async function work(exportJobId: string, retryCount: number, deps: Partial<ExportRunnerDeps> = {}) {
  const row = await api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("idempotency_key", "=", `export_job.requested:${exportJobId}`)
    .executeTakeFirstOrThrow();
  const envelope = {
    outboxEventId: row.id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    idempotencyKey: row.idempotency_key,
    organizationId: row.organization_id,
    payload: row.payload,
  };
  return runExport(api.db, envelope, row.id, { retryCount, retryLimit: 5 }, { store: store(), ...deps });
}

const newJob = async () =>
  ok(
    await call<Body>(api.app, "POST", "/api/v1/exports", {
      session: p.lead.session,
      body: { snapshotId, format: "csv", language: "en" },
      headers: { "idempotency-key": `it-${crypto.randomUUID()}` },
    }),
    202,
    "createExport",
  );

const dir = () => `${testEvidenceDir()}/exports/${w.orgA.id}`;
const filesOf = async (jobId: string) => (await readdir(dir())).filter((f) => f.startsWith(jobId)).sort();

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  const T = `/api/v1/transformations/${p.transformationId}`;
  ok(
    await call<Body>(api.app, "POST", `${T}/raid`, {
      session: p.lead.session,
      body: {
        type: "risk",
        description: "Synthetic risk",
        impact: "medium",
        probability: "low",
        ownerUserId: p.lead.id,
      },
    }),
    201,
    "createRaidEntry",
  );
  snapshotId = ok(
    await call<Body>(api.app, "POST", `${T}/reports/registers/generate`, {
      session: p.lead.session,
      body: { parameters: { register: "raid", filters: {} } },
    }),
    201,
    "generate",
  ).id;
}, 120_000);
afterAll(() => api.close());

describe("D-QA-F2-3: no orphan export file after a killed attempt", () => {
  it("attempt 1 is killed after store.put: attempt 2 removes its file when it starts; only a2 remains; other jobs untouched", async () => {
    const job = await newJob();
    const other = await newJob();
    // Another job's files (a stored earlier-attempt file and its recorded one) must survive this job's clean-up.
    await mkdir(dir(), { recursive: true });
    await writeFile(`${dir()}/${other.id}-a1.csv`, "other job, attempt 1");

    // Attempt 1 stores its file, then the worker dies before the success commit (put never returns to the runner).
    let stored!: () => void;
    const storedOnce = new Promise<void>((r) => (stored = r));
    const real = store();
    const killedAfterPut: ExportFileStore = {
      put: async (key, bytes, max) => {
        await real.put(key, bytes, max);
        stored();
        return new Promise<never>(() => undefined); // killed: the runner never continues
      },
      get: (k) => real.get(k),
      head: (k) => real.head(k),
      discard: (k) => real.discard(k),
    };
    void work(job.id, 0, { store: killedAfterPut });
    await storedOnce;
    expect(await filesOf(job.id)).toEqual([`${job.id}-a1.csv`]);

    // pg-boss redelivers (attempt 2): by its first section the a1 file is already gone (removed when it started).
    let atFirstSection: string[] | null = null;
    const r = await work(job.id, 1, {
      afterSection: async () => {
        atFirstSection ??= await filesOf(job.id);
      },
    });
    expect(r).toEqual({ exportJobId: job.id, outcome: "succeeded" });
    expect(atFirstSection).toEqual([]);
    expect(await filesOf(job.id)).toEqual([`${job.id}-a2.csv`]);
    const row = await api.db
      .selectFrom("export_job")
      .select(["status", "attempt_count", "storage_key"])
      .where("id", "=", job.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      status: "succeeded",
      attempt_count: 2,
      storage_key: `exports/${w.orgA.id}/${job.id}-a2.csv`,
    });
    const dl = await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}/download`, { session: p.lead.session });
    expect(dl.status).toBe(200);
    // The other job's file is untouched; a replayed delivery of the finished job removes and creates nothing.
    expect(await filesOf(other.id)).toEqual([`${other.id}-a1.csv`]);
    expect(await work(job.id, 1)).toEqual({ exportJobId: job.id, outcome: "already_finished" });
    expect(await filesOf(job.id)).toEqual([`${job.id}-a2.csv`]);
  });

  it("an earlier attempt's file written while the succeeding attempt renders is removed when it succeeds", async () => {
    const job = await newJob();
    // Attempt 1 dies before storing anything; attempt 2 runs, and a late write of a1 lands while it renders.
    void work(job.id, 0, { afterSection: () => new Promise<never>(() => undefined) });
    for (let i = 0; i < 400; i += 1) {
      const g = ok(
        await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: p.lead.session }),
        200,
        "g",
      );
      if (g.stage === "rendering") break;
      await new Promise((res) => setTimeout(res, 10));
    }
    const r = await work(job.id, 1, {
      afterSection: async () => {
        await writeFile(`${dir()}/${job.id}-a1.csv`, "late file of the dead attempt");
      },
    });
    expect(r).toEqual({ exportJobId: job.id, outcome: "succeeded" });
    expect(await filesOf(job.id)).toEqual([`${job.id}-a2.csv`]);
  });
});
