// A13 "Durable automation" on the P6 jobs (T-DG6-QA-C; REQ-S20-013, REQ-DLV-038): kill and restart the worker DURING
// a search reindex. Acceptance (master prompt §20 A13; requirements.csv REQ-S20-013): "Retried events, worker restarts
// and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable". The
// assignment's reading for P6: the job resumes or fails cleanly, exactly once, with no partial data.
//
// Derived from docs/api/openapi.yaml (runJobNow: "Run a scheduled job now once"; getSearchIndexStatus: status idle,
// reindexing or failed, documentsCount; searchRecords: "`stale` is true when the index is behind or rebuilding") and
// ADR-0057 §2 ("A failure sets status = 'failed' ...; the next run starts over").
//
// The drill, against the REAL API (inject) and the REAL production worker in a separate OS process (a13c-child-worker):
//  1. three synthetic transformations exist; an administrator (ADM_TECH) starts search.reindex with runJobNow;
//  2. the worker is SIGKILLed while it is inside the transaction that writes the transformation documents (the
//     disclosed blocking trigger of tests/qa/support/a13c.ts);
//  3. at that point nothing of the killed batch is visible: no transformation document exists, and the index state
//     says `reindexing` (never `idle` with a short count), so search answers `stale: true`;
//  4. the worker restarts (a new process); the killed job is delivered again after its expiry, and the reindex
//     completes: every type `idle`, the transformation documentsCount equals the number of transformations, one
//     document per transformation, each found once by search, `stale` false.
// pg-boss's job expiry for search.reindex is shortened to 5 s in THIS scratch database (instead of 15 min), so the
// redelivery happens within the test (disclosed; the a13-durable-automation precedent). All data is SYNTHETIC.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureQueues } from "../../../apps/worker/src/index.ts";
import { QA_QUEUE_POLICY, qaBoss, scratchEnv, waitFor, type Body, type ScratchEnv } from "../support/a13-durable.ts";
import {
  holdBlockLock,
  installBlock,
  killHard,
  setBlock,
  spawnChild,
  stopChild,
  waitBlocked,
  type Child,
} from "../support/a13c.ts";
import { call, signIn, uniq, type Session } from "../support/api.ts";
import { seedWorld, type World } from "../support/p4.ts";

let env: ScratchEnv;
let w: World;
let tech: Session;
let office: Session;
let child: Child | null = null;
const label = uniq("QARIX").toLowerCase();
const names = ["alpha", "beta", "gamma"].map((n) => `Synthetic ${label} reindex ${n}`);

beforeAll(async () => {
  env = await scratchEnv("mth_qa_a13c_rix");
  const boss = qaBoss(env.appUrl, "qa-a13c-rix-boss");
  await boss.start();
  await ensureQueues(boss, QA_QUEUE_POLICY);
  await env.su.query("UPDATE pgboss.queue SET expire_seconds = 5 WHERE name = 'search.reindex'");
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  w = await seedWorld(env.api.db);
  tech = await signIn(env.api.app, w.admin.subject);
  office = await signIn(env.api.app, w.office.subject);
  for (const name of names) {
    const r = await call<Body>(env.api.app, "POST", "/api/v1/transformations", {
      session: office,
      body: { businessUnitId: w.a1, name, mode: "end_to_end" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  await installBlock(env.su, "rix", "search_document", "NEW.record_type = 'transformation'");
}, 180_000);

afterAll(async () => {
  await stopChild(child);
  await env?.close();
});

const status = async () => {
  const r = await call<Body>(env.api.app, "GET", "/api/v1/admin/search/index", { session: tech });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.types as Body[];
};
const typeState = async (t: string) => (await status()).find((x) => x.recordType === t)!;
const search = async (q: string) => {
  const r = await call<Body>(
    env.api.app,
    "GET",
    `/api/v1/search?q=${encodeURIComponent(q)}&recordType=transformation&limit=50`,
    {
      session: office,
    },
  );
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const transformationDocs = async () =>
  (await env.su.query("SELECT record_id FROM search_document WHERE record_type = 'transformation'")).rows as {
    record_id: string;
  }[];
const transformationRows = async () =>
  Number((await env.su.query("SELECT count(*)::int AS n FROM transformation")).rows[0].n);

describe("A13 (REQ-S20-013): the worker is killed during a search reindex and restarted", () => {
  it(
    "the killed reindex leaves no partial documents and says `reindexing`; after the restart it completes once",
    { timeout: 240_000 },
    async () => {
      const lock = await holdBlockLock(env.su);
      try {
        await setBlock(env.su, "rix", true);
        child = await spawnChild("a13c-child-worker.ts", {
          QA_CHILD_DB_URL: env.appUrl,
          QA_CHILD_APP_NAME: "qa-a13c-rix-w1",
          QA_CHILD_POLICY: JSON.stringify(QA_QUEUE_POLICY),
        });
        const run = await call<Body>(env.api.app, "POST", "/api/v1/admin/jobs/search.reindex/run", { session: tech });
        expect(run.status, JSON.stringify(run.body)).toBe(202);
        expect(run.body.code).toBe("search.reindex");

        await waitBlocked(env.su, child, "the worker blocked inside the transformation documents' batch");
        await killHard(env.su, child);
        child = null;

        // Mid-job state: nothing of the killed batch is committed, and the state does not pretend completion.
        expect(await transformationDocs(), "no transformation document from the killed batch").toEqual([]);
        const mid = await typeState("transformation");
        expect(mid.status, "the type is marked reindexing, not idle with a short count").toBe("reindexing");
        const midSearch = await search(label);
        expect(midSearch.stale, "search says the index is rebuilding").toBe(true);
        expect(midSearch.items).toEqual([]);
      } finally {
        await setBlock(env.su, "rix", false);
        await lock.release();
      }

      // Restart: a new worker process. The cause is gone (switch off); the killed job is redelivered after expiry.
      child = await spawnChild("a13c-child-worker.ts", {
        QA_CHILD_DB_URL: env.appUrl,
        QA_CHILD_APP_NAME: "qa-a13c-rix-w2",
        QA_CHILD_POLICY: JSON.stringify(QA_QUEUE_POLICY),
      });
      const done = await waitFor(
        async () => {
          const s = await status();
          return s.every((t) => t.status === "idle") &&
            s.find((t) => t.recordType === "transformation")!.reindexFinishedAt
            ? s
            : null;
        },
        "every index type idle after the restarted reindex",
        150_000,
      ).catch(async (e) => {
        throw new Error(`${String(e)}\n${JSON.stringify(await status())}\nchild:\n${child?.output()}`);
      });
      const tState = done.find((t) => t.recordType === "transformation")!;
      const n = await transformationRows();
      expect(tState.documentsCount, "documentsCount = the number of transformations").toBe(n);
      expect(tState.lastErrorCode).toBeNull();
      const docs = await transformationDocs();
      expect(docs, "one document per transformation").toHaveLength(n);
      expect(new Set(docs.map((d) => d.record_id)).size).toBe(n);
      const after = await search(label);
      expect(after.stale).toBe(false);
      expect(after.items.map((i: Body) => i.title).sort(), "each transformation found exactly once").toEqual(
        [...names].sort(),
      );
    },
  );
});
