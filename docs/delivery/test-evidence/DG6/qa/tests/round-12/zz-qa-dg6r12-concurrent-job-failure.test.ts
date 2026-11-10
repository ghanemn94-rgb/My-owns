// qa-verifier DG6 round 12 (T-DG6-REV-QA-R12, session 90a1b667) on candidate c05864ba (source 2495e036); round-11 probe re-used, names r11 -> r12 only unless stated. Earlier header text follows:: round 8's probe re-used (round 9 did not reach it); changes: names r8 -> r10 only (the lines below are the earlier rounds' text). Round 11: names r10 -> r11 only.
// qa-verifier DG6 round 8 (T-DG6-REV-QA-R8) on candidate 6cda8b33: copied from tests/round-7/zz-qa-dg6r7-concurrent-job-failure.test.ts; the only change is the rename of identifiers dg6r7 -> dg6r12 and QA-R7 -> QA-R12 (the comments below are the earlier rounds' text).
// qa-verifier DG6 round 7 (T-DG6-REV-QA-R7) on candidate b64b95ff: copied from tests/round-6/zz-qa-dg6r6-concurrent-job-failure.test.ts; the only change is the rename of identifiers dg6r6 -> dg6r12 and QA-R6 -> QA-R12 (the comments below are the round-6 text).
// qa-verifier DG6 round 6 (T-DG6-REV-QA-R6): independent probe, NOT part of the frozen candidate. Copied into a
// disposable clone as apps/api/test/integration/operations/zz-qa-dg6r12-concurrent-job-failure.test.ts and run on a
// disposable PostgreSQL (tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <file>).
// Re-run of my round-5 reproduction of F-DG6-380 (A13 "failed jobs remain recoverable", REQ-S20-013; REQ-S12-019;
// D-203 WORKER_JOB_CONCURRENCY 4), widened: N = 4, 8 and 16 concurrent last-attempt failures of DISTINCT jobs on ONE
// queue (the worker's own captureJobFailure), 10 bursts each, with the queue's job_failed exception not yet open and
// already open. Each burst must give, with no rejected capture:
//   - N(+1) operational_failure rows on the queue (one per failed job, each retryable);
//   - N(+1) job.failed outbox rows (one per failure row);
//   - exactly ONE open exception whose occurrence_count is N(+1), with N(+1)-1 'recurred' events (no double count);
//   - a final last_occurred_at >= every event's occurred_at (never moved backwards).
// Also: 20 concurrent API raises against one open exception (my round-5 Q2), via the API's raiseOperationalException.
// Every value is SYNTHETIC. Nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureJobFailure } from "../../../../worker/src/kit.ts";
import { raiseOperationalException } from "../../../src/modules/operations/index.ts";
import { seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";

let api: TestApi;
let w: World;
const tag = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join("");

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(async () => {
  await api?.close();
});

async function exceptionFacts(sourceCode: string) {
  const ex = await api.db
    .selectFrom("operational_exception")
    .select(["id", "occurrence_count", "status"])
    .where("source_code", "=", sourceCode)
    .execute();
  let recurred = 0;
  let forward = true;
  for (const x of ex) {
    const r = await api.db
      .selectFrom("operational_exception_event")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("operational_exception_id", "=", x.id)
      .where("event_kind", "=", "recurred")
      .executeTakeFirstOrThrow();
    recurred += Number(r.n);
    const f = await api.db
      .selectFrom("operational_exception_event as e")
      .innerJoin("operational_exception as x", "x.id", "e.operational_exception_id")
      .select((eb) => eb.fn.count<string>("e.id").filterWhere("e.occurred_at", ">", eb.ref("x.last_occurred_at")).as("bad"))
      .where("x.id", "=", x.id)
      .executeTakeFirstOrThrow();
    if (Number(f.bad) > 0) forward = false;
  }
  return { ex, recurred, forward };
}

async function burst(n: number, opened: boolean) {
  const q = `qarsix.burst_${tag()}`;
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
  const events =
    failures.length === 0
      ? []
      : await api.db
          .selectFrom("outbox_event")
          .select("id")
          .where("event_type", "=", "job.failed")
          .where(
            "aggregate_id",
            "in",
            failures.map((f) => f.id),
          )
          .execute();
  const facts = await exceptionFacts(q);
  return { q, total: n + base, rejected, failures: failures.length, events: events.length, ...facts };
}

describe("QA-R12 concurrent last-attempt job failures on one queue (F-DG6-380 re-run)", () => {
  for (const n of [4, 8, 16])
    for (const opened of [false, true])
      it(`N=${n}, exception ${opened ? "already open" : "not yet open"}: 10 bursts, none lost or double-counted`, async () => {
        const lost: string[] = [];
        for (let round = 0; round < 10; round++) {
          const r = await burst(n, opened);
          const occ = r.ex.reduce((s, x) => s + x.occurrence_count, 0);
          console.log(
            `QA-R12 BURST N=${n} opened=${opened} round ${round}: rejected ${r.rejected.length}; failures ${r.failures}/${r.total}; ` +
              `job.failed ${r.events}/${r.total}; exceptions ${r.ex.length} [${r.ex.map((x) => x.status).join(",")}]; ` +
              `occurrences ${occ}/${r.total}; recurred events ${r.recurred}/${r.total - 1}; forward ${r.forward}; ` +
              `reasons ${JSON.stringify([...new Set(r.rejected)])}`,
          );
          const ok =
            r.rejected.length === 0 &&
            r.failures === r.total &&
            r.events === r.total &&
            r.ex.length === 1 &&
            r.ex[0]!.status === "open" &&
            occ === r.total &&
            r.recurred === r.total - 1 &&
            r.forward;
          if (!ok) lost.push(`N=${n} opened=${opened} round ${round}`);
        }
        expect(lost).toEqual([]);
      });

  it("20 concurrent API raises against one open exception: 21 occurrences, no rejection (round-5 Q2)", async () => {
    for (let round = 0; round < 5; round++) {
      const code = `qarsix.api_${tag()}`;
      const raise = () =>
        api.db.transaction().execute((tx) =>
          raiseOperationalException(
            tx,
            { actorUserId: null, actorType: "service", requestId: "qa-r6:probe" },
            {
              organizationId: w.orgA.id,
              sourceKind: "job",
              sourceCode: code,
              failureClass: "job_failed",
              errorCode: "automation.retries_exhausted",
              errorMessage: "Synthetic failure.",
            },
          ),
        );
      await raise();
      const settled = await Promise.allSettled(Array.from({ length: 20 }, () => raise()));
      const rejected = settled.filter((s) => s.status === "rejected").length;
      const f = await exceptionFacts(code);
      const occ = f.ex.reduce((s, x) => s + x.occurrence_count, 0);
      console.log(
        `QA-R12 API-RAISE round ${round}: rejected ${rejected}; exceptions ${f.ex.length}; occurrences ${occ}/21; recurred ${f.recurred}/20; forward ${f.forward}`,
      );
      expect([rejected, f.ex.length, occ, f.recurred, f.forward]).toEqual([0, 1, 21, 20, true]);
    }
  });
});
