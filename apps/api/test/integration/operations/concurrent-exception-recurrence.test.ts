// Concurrent recurrences of ONE operational exception (T-DG6-BE-Z8; F-DG6-380; ADR-0053 §2; ADR-0043 failure queue;
// REQ-S20-013 "failed jobs remain recoverable", REQ-S12-019), against the run's disposable PostgreSQL.
//
// The defect (qa-verifier round 5, probe zz-qa-dg6r5-concurrent-job-failure): when several jobs of one queue failed
// their last attempt at once (runJobBatch, WORKER_JOB_CONCURRENCY lanes, D-203), the recurrence of the queue's
// job_failed exception wrote last_occurred_at = greatest(now(), <the stored value read back as a JavaScript Date>).
// A Date has millisecond precision, the column microsecond precision; a transaction that STARTED before a concurrent
// recurrence committed (so its now() is older) wrote back the truncated copy, which is earlier than the stored value,
// and migration 0101's guard (operational_exception_occurrence_step: "each recurrence counts once and moves
// last_occurred_at forward") rejected it. captureJobFailure runs the raise in the same transaction as the
// operational_failure row and the job.failed outbox row, so all three were lost.
//
// The fix (exceptions.ts raiseOperationalException, worker kit.ts raiseOperationalExceptionTwin): the recurrence reads
// the stored value in SQL (greatest(now(), operational_exception.last_occurred_at)), under the lock the raise already
// holds (advisory lock per exception key, then FOR UPDATE on the row), so it never moves backwards and the guard is
// unchanged.
//
// Covered here:
//  1. the QA burst, ported: N = 4 (the shipped default) and N = 8 concurrent last-attempt failures of distinct jobs on
//     ONE queue, with the exception not yet open and already open, 5 rounds each: N operational_failure rows, N
//     job.failed outbox rows, the occurrence count rises by N on ONE open exception, one `recurred` history event per
//     recurrence, no rejection, and last_occurred_at never decreases along the history;
//  2. deterministic interleaving (no timer): a transaction that started BEFORE another recurrence committed recurs
//     after it, for the worker twin (connector, freshness, job raisers) and the API raise (heartbeat, data_stale);
//  3. deterministic precision: a stored last_occurred_at with sub-millisecond digits later than now() is kept exactly
//     by the next recurrence (the guard's intent holds: a recurrence counts once and never moves it backwards).
// Every value is SYNTHETIC. Nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { captureJobFailure, raiseOperationalExceptionTwin } from "../../../../worker/src/kit.ts";
import { raiseOperationalException } from "../../../src/modules/operations/index.ts";
import { seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";

let api: TestApi;
let w: World;
/** The cluster superuser (the owner URL without its role option): used only to pin a stored timestamp. */
let su: pg.Pool;
const tag = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join("");
const SERVICE = { actorUserId: null, actorType: "service" as const, requestId: "be-z8:test" };
const TWIN_ACTOR = {
  actorType: "service" as const,
  actorUserId: null,
  requestId: "be-z8:twin",
  source: "worker" as const,
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  su = new pg.Pool({ connectionString: inject("mthDb").ownerUrl.replace(/\?.*$/, ""), max: 1 });
  su.on("error", () => undefined);
});
afterAll(async () => {
  await su?.end();
  await api?.close();
});

/** The exception rows of one source code, with their history (record_version order) and the stored microseconds. */
async function exceptionsOf(sourceCode: string) {
  const r = await su.query<{ id: string; status: string; occurrence_count: number; last_us: string }>(
    `SELECT id, status, occurrence_count, (extract(epoch FROM last_occurred_at) * 1000000)::bigint::text AS last_us
       FROM operational_exception WHERE source_code = $1`,
    [sourceCode],
  );
  return r.rows;
}
async function recurredEvents(exceptionId: string): Promise<number> {
  const r = await su.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM operational_exception_event WHERE operational_exception_id = $1 AND event_kind = 'recurred'`,
    [exceptionId],
  );
  return Number(r.rows[0]!.n);
}
/** last_occurred_at as recorded by each recurred audit event's row version is never below the one before it. */
async function lastOccurredNeverBackwards(exceptionId: string): Promise<boolean> {
  // operational_exception_history stores updated_at (now()) per version; the row's last_occurred_at is the running
  // greatest. The invariant checked: the final stored value is >= every version's updated_at.
  const r = await su.query<{ ok: boolean }>(
    `SELECT bool_and(e.occurred_at <= x.last_occurred_at) AS ok
       FROM operational_exception_event e JOIN operational_exception x ON x.id = e.operational_exception_id
      WHERE x.id = $1`,
    [exceptionId],
  );
  return r.rows[0]!.ok === true;
}

describe("concurrent last-attempt job failures on one queue are each captured once (F-DG6-380)", () => {
  async function burst(n: number, opened: boolean) {
    const q = `bezeight.burst_${tag()}`; // lower-case letters, '_' and '.' only (the 0101 queue_name rule)
    const fail = (i: number) =>
      captureJobFailure(api.db, {
        queue: q,
        jobId: crypto.randomUUID(),
        data: {
          outboxEventId: crypto.randomUUID(),
          eventType: "synthetic.event",
          schemaVersion: 1,
          idempotencyKey: `synthetic:${q}:${i}:${tag()}`,
          organizationId: w.orgA.id,
          payload: {},
        },
        attempts: 3,
        error: new Error(`Synthetic downstream outage (job ${i}).`),
      });
    let base = 0;
    if (opened) {
      await fail(-1);
      base = 1;
    }
    const settled = await Promise.allSettled(Array.from({ length: n }, (_, i) => fail(i)));
    const rejected = settled
      .filter((s): s is PromiseRejectedResult => s.status === "rejected")
      .map((s) => String((s.reason as Error)?.message ?? s.reason).slice(0, 200));
    const failures = await api.db.selectFrom("operational_failure").select("id").where("queue_name", "=", q).execute();
    const events = await api.db
      .selectFrom("outbox_event")
      .select("id")
      .where("event_type", "=", "job.failed")
      .where(
        "aggregate_id",
        "in",
        failures.length > 0 ? failures.map((f) => f.id) : ["00000000-0000-0000-0000-000000000000"],
      )
      .execute();
    const ex = await exceptionsOf(q);
    return { q, total: n + base, rejected, failures: failures.length, events: events.length, ex };
  }

  for (const n of [4, 8])
    for (const opened of [false, true])
      it(`${n} concurrent failures, exception ${opened ? "already open" : "not yet open"}: 5 rounds, none lost`, async () => {
        const lost: string[] = [];
        for (let round = 0; round < 5; round++) {
          const r = await burst(n, opened);
          const occ = r.ex.reduce((s, x) => s + x.occurrence_count, 0);
          const ok =
            r.rejected.length === 0 &&
            r.failures === r.total &&
            r.events === r.total &&
            r.ex.length === 1 &&
            r.ex[0]!.status === "open" &&
            occ === r.total &&
            (await recurredEvents(r.ex[0]!.id)) === r.total - 1 &&
            (await lastOccurredNeverBackwards(r.ex[0]!.id));
          if (!ok)
            lost.push(
              `round ${round}: rejected ${r.rejected.length} ${JSON.stringify([...new Set(r.rejected)])}; ` +
                `failures ${r.failures}/${r.total}; job.failed ${r.events}/${r.total}; exceptions ${r.ex.length}; ` +
                `occurrences ${occ}/${r.total}`,
            );
        }
        expect(lost).toEqual([]);
      });
});

/** A gate the test opens by hand: deterministic interleaving without a timer. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}

describe("a recurrence whose transaction started before another committed is kept (F-DG6-380)", () => {
  type Raise = (tx: Parameters<typeof raiseOperationalExceptionTwin>[0], code: string) => Promise<unknown>;
  const twin: Raise = (tx, code) =>
    raiseOperationalExceptionTwin(tx, TWIN_ACTOR, {
      organizationId: w.orgA.id,
      sourceKind: "connector",
      sourceCode: code,
      failureClass: "connector_run_failed",
      errorCode: "integrations.run_failed",
      errorMessage: "Synthetic connector failure.",
    });
  const apiRaise: Raise = (tx, code) =>
    raiseOperationalException(tx, SERVICE, {
      organizationId: w.orgA.id,
      sourceKind: "job",
      sourceCode: code,
      failureClass: "job_failed",
      errorCode: "automation.retries_exhausted",
      errorMessage: "Synthetic failure.",
    });

  for (const [name, raise] of [
    ["the worker twin (connector, freshness, job-failure raisers)", twin],
    ["the API raise (heartbeat watch, data_stale)", apiRaise],
  ] as const)
    it(`${name}: early-started transaction recurs after a later one, 5 rounds`, async () => {
      for (let round = 0; round < 5; round++) {
        const code = `bez8.order_${tag()}`;
        await api.db.transaction().execute((tx) => raise(tx, code)); // opened, occurrence 1
        const started = gate();
        const laterCommitted = gate();
        // A: starts first (its now() is the older one), then waits until B has committed, then recurs.
        const a = api.db.transaction().execute(async (tx) => {
          await tx.selectFrom("operational_exception").select("id").where("source_code", "=", code).execute();
          started.open();
          await laterCommitted.p;
          return raise(tx, code);
        });
        await started.p;
        // B: starts after A and commits its recurrence first (a later, microsecond-precise last_occurred_at).
        await api.db.transaction().execute((tx) => raise(tx, code));
        laterCommitted.open();
        await expect(a).resolves.toBeDefined();
        const ex = await exceptionsOf(code);
        expect(ex.map((x) => [x.status, x.occurrence_count])).toEqual([["open", 3]]);
        expect(await recurredEvents(ex[0]!.id)).toBe(2);
        expect(await lastOccurredNeverBackwards(ex[0]!.id)).toBe(true);
      }
    });

  it("a stored last_occurred_at with sub-millisecond digits, later than now(), is kept exactly by a recurrence", async () => {
    for (const raise of [twin, apiRaise]) {
      const code = `bez8.precise_${tag()}`;
      await api.db.transaction().execute((tx) => raise(tx, code));
      // Simulates a concurrent recurrence that committed with a later now(): 10 s ahead with 123 microseconds.
      await su.query(
        `BEGIN; SET LOCAL session_replication_role = replica;
         UPDATE operational_exception SET last_occurred_at = date_trunc('milliseconds', now()) + interval '10.000123 seconds'
          WHERE source_code = '${code}'; COMMIT;`,
      );
      const before = (await exceptionsOf(code))[0]!;
      expect(Number(BigInt(before.last_us) % 1000n)).toBe(123);
      await api.db.transaction().execute((tx) => raise(tx, code));
      const after = (await exceptionsOf(code))[0]!;
      expect([after.occurrence_count, after.last_us]).toEqual([2, before.last_us]);
    }
  });
});
