// /readyz encoding check (ADR-0003 "Database encoding", T-DG2-BE9) and, from P7, the storage and worker checks (T-B1;
// ADR-0069 §2; p7-work-split §B.4), without a database: a fake pool counts the queries and fake probes count calls. The real-PostgreSQL behaviour (SQL_ASCII vs UTF8 scratch databases) is in test/integration/platform.test.ts.
//  - a UTF8 answer is cached: one `SHOW server_encoding` per process, however many probes;
//  - a non-UTF8 answer is NOT cached and reports database: fail; once the database answers UTF8 it becomes ready.
import Fastify from "fastify";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import {
  registerHealthRoutes,
  type ReadinessProbes,
  type StorageProbeOutcome,
  type WorkerProbeOutcome,
} from "./health.ts";

function fakePool(encoding: () => string) {
  const seen: string[] = [];
  const client = {
    query: async (text: string) => {
      seen.push(text);
      if (text === "SHOW server_encoding") return { rows: [{ server_encoding: encoding() }] };
      if (text.includes("to_regclass")) return { rows: [{ exists: false }] };
      return { rows: [{ "?column?": 1 }] };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  return { pool, shows: () => seen.filter((q) => q === "SHOW server_encoding").length };
}

async function probe(app: ReturnType<typeof Fastify>) {
  const res = await app.inject({ method: "GET", url: "/readyz" });
  return [res.statusCode, res.json()];
}

const STORAGE_OK: StorageProbeOutcome = { status: "ok", driver: "filesystem", source: "environment", errorCode: null };
const STORAGE_FAIL: StorageProbeOutcome = {
  status: "fail",
  driver: "filesystem",
  source: "environment",
  errorCode: "ENOENT",
};
const beat = (status: WorkerProbeOutcome["status"]): WorkerProbeOutcome => ({
  status,
  newestBeatAt: status === "unknown" ? null : "2026-11-12T00:00:00.000Z",
  staleAfterSeconds: 90,
});

/** Fake probes that count their calls; `storage` and `worker` are read at each call. */
function fakeProbes(state: { storage: StorageProbeOutcome; worker: WorkerProbeOutcome["status"] }) {
  const calls = { storage: 0, worker: 0 };
  const probes: ReadinessProbes = {
    storage: async () => {
      calls.storage += 1;
      return state.storage;
    },
    worker: async () => {
      calls.worker += 1;
      return beat(state.worker);
    },
  };
  return { probes, calls };
}
const okProbes = () => fakeProbes({ storage: STORAGE_OK, worker: "alive" }).probes;

const READY = [200, { status: "ready", checks: { database: "ok", migrations: "ok", storage: "ok", worker: "alive" } }];
const NOT_UTF8 = [
  503,
  { status: "not_ready", checks: { database: "fail", migrations: "fail", storage: "unknown", worker: "unknown" } },
];

describe("/readyz database encoding", () => {
  it("is ready on UTF8 and asks for the encoding only once per process", async () => {
    const { pool, shows } = fakePool(() => "UTF8");
    const app = Fastify();
    registerHealthRoutes(app, pool, [], okProbes());
    for (let i = 0; i < 3; i++) expect(await probe(app)).toEqual(READY);
    expect(shows()).toBe(1);
    await app.close();
  });

  it("reports database: fail on SQL_ASCII, re-checks every probe, and recovers once the database is UTF8", async () => {
    let encoding = "SQL_ASCII";
    const { pool, shows } = fakePool(() => encoding);
    const app = Fastify();
    registerHealthRoutes(app, pool, [], okProbes());
    expect(await probe(app)).toEqual(NOT_UTF8);
    expect(await probe(app)).toEqual(NOT_UTF8);
    expect(shows()).toBe(2);
    encoding = "UTF8";
    expect(await probe(app)).toEqual(READY);
    expect(await probe(app)).toEqual(READY);
    expect(shows()).toBe(3);
    await app.close();
  });
});

describe("T-B1: /readyz storage and worker (ADR-0069 §2)", () => {
  it("storage fail -> 503 not_ready with storage: fail (storage gates readiness)", async () => {
    const { pool } = fakePool(() => "UTF8");
    const { probes } = fakeProbes({ storage: STORAGE_FAIL, worker: "alive" });
    const app = Fastify();
    registerHealthRoutes(app, pool, [], probes);
    expect(await probe(app)).toEqual([
      503,
      { status: "not_ready", checks: { database: "ok", migrations: "ok", storage: "fail", worker: "alive" } },
    ]);
    await app.close();
  });

  it("storage ok with worker stale or unknown -> 200 ready (the worker never gates)", async () => {
    for (const worker of ["stale", "unknown"] as const) {
      const { pool } = fakePool(() => "UTF8");
      const { probes } = fakeProbes({ storage: STORAGE_OK, worker });
      const app = Fastify();
      registerHealthRoutes(app, pool, [], probes);
      expect(await probe(app)).toEqual([
        200,
        { status: "ready", checks: { database: "ok", migrations: "ok", storage: "ok", worker } },
      ]);
      await app.close();
    }
  });

  it("database fail -> storage: unknown, worker: unknown, and neither probe is called", async () => {
    const pool = {
      connect: async () => {
        throw new Error("connection refused");
      },
    } as unknown as pg.Pool;
    const { probes, calls } = fakeProbes({ storage: STORAGE_OK, worker: "alive" });
    const app = Fastify();
    registerHealthRoutes(app, pool, [], probes);
    expect(await probe(app)).toEqual(NOT_UTF8);
    expect(calls).toEqual({ storage: 0, worker: 0 });
    // A non-UTF8 database is `database: fail` too: no probe either.
    const sqlAscii = fakePool(() => "SQL_ASCII");
    const app2 = Fastify();
    registerHealthRoutes(app2, sqlAscii.pool, [], probes);
    expect(await probe(app2)).toEqual(NOT_UTF8);
    expect(calls).toEqual({ storage: 0, worker: 0 });
    await app.close();
    await app2.close();
  });

  it("both keys are always present, and a failing heartbeat read is unknown (never alive)", async () => {
    const { pool } = fakePool(() => "UTF8");
    const app = Fastify();
    registerHealthRoutes(app, pool, [], {
      storage: async () => STORAGE_OK,
      worker: async () => {
        throw new Error("heartbeat read failed");
      },
    });
    const [status, body] = await probe(app);
    expect(status).toBe(200);
    expect(Object.keys((body as { checks: object }).checks).sort()).toEqual([
      "database",
      "migrations",
      "storage",
      "worker",
    ]);
    expect((body as { checks: { worker: string } }).checks.worker).toBe("unknown");
    await app.close();
  });

  it("a storage probe that throws is fail (503), never ok", async () => {
    const { pool } = fakePool(() => "UTF8");
    const app = Fastify();
    registerHealthRoutes(app, pool, [], {
      storage: async () => {
        throw new Error("boom");
      },
      worker: async () => beat("alive"),
    });
    const [status, body] = await probe(app);
    expect(status).toBe(503);
    expect((body as { checks: { storage: string } }).checks.storage).toBe("fail");
    await app.close();
  });

  it("logs the storage failure once per state change (warn) and the recovery once (info), with the B.5 texts", async () => {
    const lines: { level: number; msg: string }[] = [];
    const stream = { write: (l: string) => lines.push(JSON.parse(l) as { level: number; msg: string }) };
    const { pool } = fakePool(() => "UTF8");
    const state = { storage: STORAGE_FAIL, worker: "alive" as const };
    const { probes } = fakeProbes(state);
    const app = Fastify({ logger: { level: "info", stream } });
    registerHealthRoutes(app, pool, [], probes);
    await probe(app);
    await probe(app);
    state.storage = STORAGE_OK;
    await probe(app);
    await probe(app);
    state.storage = STORAGE_FAIL;
    await probe(app);
    const readiness = lines.filter((l) => l.msg.startsWith("readiness: evidence storage"));
    expect(readiness).toEqual([
      expect.objectContaining({
        level: 40,
        msg: "readiness: evidence storage (filesystem) did not answer the probe: ENOENT",
      }),
      expect.objectContaining({ level: 30, msg: "readiness: evidence storage (filesystem) answers again" }),
      expect.objectContaining({
        level: 40,
        msg: "readiness: evidence storage (filesystem) did not answer the probe: ENOENT",
      }),
    ]);
    await app.close();
  });
});
