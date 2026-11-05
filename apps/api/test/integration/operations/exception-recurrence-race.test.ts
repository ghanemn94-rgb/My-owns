// A system occurrence between a human's load and the human's acknowledge or resolve (T-DG6-BE-Z6; D-213; ADR-0053 §2,
// §6; REQ-S12-019, REQ-S20-022), against the run's disposable PostgreSQL.
//
// The race (orchestrator verification of 31d5ccea4, a22-p6-operability chromium-en): the API heartbeat watch recurs an
// open `heartbeat_missed` exception every 60 s, which steps its optimistic-concurrency version. An administrator who
// loaded the exception before that tick and then acknowledged it with the loaded version got 409 and the exception
// stayed open. The rule now (exceptions.ts `rebaseOverSystemOccurrences`): an If-Match version that is behind the
// current one ONLY by system recurrences (history events `recurred`, no user) is accepted; the human action applies
// to the current row and its audit event records the true prior version, the new version and the loaded version
// (`changes.based_on_version`). Any other intervening change (a human acknowledgement or resolution, an automatic
// recovery, anything not a system recurrence) or a version ahead of the row stays 409.
//
// Covered here, each deterministically (no timer, no sleep):
//  1. the heartbeat watch itself (heartbeatWatchStep, the D-213 path): load, the watch recurs, acknowledge with the
//     loaded version -> 200; the watch recurs again; resolve with the acknowledged version -> 200;
//  2. every other raiser that recurs: the job failure hook (an automation queue's retries exhausted), the connector
//     consumer's twin (connector_run_failed) and the data_stale raiser (API service with a KPI link);
//  3. the controls: human-vs-human (409), a human change mixed with a recurrence (409), an automatic recovery (409), a
//     version ahead of the row (409); nothing is written by a refusal.
// Every value is SYNTHETIC. Acknowledging or resolving an exception approves nothing (not a business approval, G1-G6)
// and never touches DG0-DG7 or a KPI value.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { captureJobFailure, raiseOperationalExceptionTwin } from "../../../../worker/src/kit.ts";
import { HEARTBEAT_EXCEPTION } from "../../../src/modules/operations/heartbeat.ts";
import {
  heartbeatWatchStep,
  raiseOperationalException,
  recoverOperationalException,
} from "../../../src/modules/operations/index.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  auditOf,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/operations/exceptions";
const SERVICE = { actorUserId: null, actorType: "service" as const, requestId: "be-z6:test" };
const TWIN_ACTOR = {
  actorType: "service" as const,
  actorUserId: null,
  requestId: "be-z6:twin",
  source: "worker" as const,
};

let api: TestApi;
let w: World;
let admin: Session;
let admin2: Session;
let admin2Id: string;
/** The cluster superuser (the owner URL without its role option): used only to simulate elapsed time. */
let su: pg.Pool;

const tag = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join("");

const get = async (id: string, s: Session = admin): Promise<Body> => {
  const r = await call<Body>(api.app, "GET", `${L}/${id}`, { session: s });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const act = (verb: "acknowledge" | "resolve", id: string, version: number, note: string | null, s = admin) =>
  call<Body>(api.app, "POST", `${L}/${id}/${verb}`, { session: s, body: { note }, headers: ifm(version) });
const rowOf = (id: string) =>
  api.db.selectFrom("operational_exception").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const auditTrail = async (id: string) =>
  (await auditOf(api.db, id)).map((a) => [a.action, a.actor_user_id, a.prior_version, a.new_version]);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  const u = await createUser(api.db, w.orgA.id);
  admin2Id = u.id;
  await grant(api.db, w.grantor.id, u.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
  admin2 = await signIn(api.app, u.subject);
  su = new pg.Pool({ connectionString: inject("mthDb").ownerUrl.replace(/\?.*$/, ""), max: 1 });
  su.on("error", () => undefined);
});

afterAll(async () => {
  await su?.end();
  await api?.close();
});

describe("the heartbeat watch recurs between the administrator's load and action (D-213)", () => {
  /** The worker_heartbeat rows of the shared run, restored after this block (the table is telemetry, not audited). */
  let saved: Record<string, unknown>[] = [];

  /** Simulates "more than 30 s since the last occurrence" (the watch's RECUR_MIN_GAP_SECONDS) without waiting. */
  async function ageOccurrence(id: string): Promise<void> {
    await su.query(`BEGIN; SET LOCAL session_replication_role = replica;
      UPDATE operational_exception SET first_occurred_at = first_occurred_at - interval '61 seconds',
             last_occurred_at = last_occurred_at - interval '61 seconds' WHERE id = '${id}'; COMMIT;`);
  }

  beforeAll(async () => {
    saved = (await su.query("SELECT * FROM worker_heartbeat")).rows as Record<string, unknown>[];
    await su.query("DELETE FROM worker_heartbeat");
    // A worker that beat 5 minutes ago and stopped: the watch sees `stale`.
    await su.query(`INSERT INTO worker_heartbeat (id, instance_key, app_version, started_at, last_beat_at, beat_count,
      queue_count) VALUES (mth_uuid_v7(), 'bez6-stopped', '0.0.0-synthetic', now() - interval '10 minutes',
      now() - interval '5 minutes', 3, 40)`);
    // A heartbeat exception left active by an earlier file of the shared run is closed first (the system path).
    await api.db.transaction().execute((tx) => recoverOperationalException(tx, SERVICE, HEARTBEAT_EXCEPTION));
  });

  afterAll(async () => {
    await su.query("DELETE FROM worker_heartbeat");
    for (const r of saved)
      await su.query(
        `BEGIN; SET LOCAL session_replication_role = replica;
         INSERT INTO worker_heartbeat SELECT * FROM json_populate_record(NULL::worker_heartbeat, $1::json); COMMIT;`.replace(
          "$1",
          `'${JSON.stringify(r).replace(/'/g, "''")}'`,
        ),
      );
  });

  it("acknowledge with the version loaded before a watch tick succeeds; resolve after a second tick succeeds", async () => {
    const opened = await api.db.transaction().execute((tx) => heartbeatWatchStep(tx));
    expect([opened.state, opened.action]).toEqual(["stale", "opened"]);
    const id = opened.exceptionId!;
    // The administrator loads the exception page (version 1).
    const loaded = await get(id);
    expect([loaded.status, loaded.version, loaded.occurrenceCount]).toEqual(["open", 1, 1]);
    // The next watch tick (more than 30 s later) recurs it: version 2, a system event.
    await ageOccurrence(id);
    const tick = await api.db.transaction().execute((tx) => heartbeatWatchStep(tx));
    expect([tick.action, tick.exceptionId]).toEqual(["recurred", id]);
    expect([(await rowOf(id)).version, (await rowOf(id)).occurrence_count]).toEqual([2, 2]);
    // The administrator acknowledges with the loaded version 1: accepted, applied to version 2.
    const ack = await act("acknowledge", id, loaded.version, "Synthetic: on it.");
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    expect([ack.body.status, ack.body.version, ack.body.occurrenceCount, ack.body.acknowledgedBy]).toEqual([
      "acknowledged",
      3,
      2,
      w.admin.id,
    ]);
    expect(ack.headers["etag"]).toBe('"3"');
    expect(ack.body.events.map((e: Body) => [e.recordVersion, e.eventKind, e.actorUserId])).toEqual([
      [1, "opened", null],
      [2, "recurred", null],
      [3, "acknowledged", w.admin.id],
    ]);
    // Another tick while acknowledged; the administrator resolves with the version the acknowledgement returned (3).
    await ageOccurrence(id);
    expect((await api.db.transaction().execute((tx) => heartbeatWatchStep(tx))).action).toBe("recurred");
    const res = await act("resolve", id, ack.body.version, "Synthetic: worker restarted.");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([res.body.status, res.body.resolution, res.body.version, res.body.occurrenceCount]).toEqual([
      "resolved",
      "manual",
      5,
      3,
    ]);
    // The audit trail records every occurrence and each human action with its prior and new version.
    expect(await auditTrail(id)).toEqual([
      ["operational_exception.opened", null, null, 1],
      ["operational_exception.recurred", null, 1, 2],
      ["operational_exception.acknowledged", w.admin.id, 2, 3],
      ["operational_exception.recurred", null, 3, 4],
      ["operational_exception.resolved", w.admin.id, 4, 5],
    ]);
    const audits = await auditOf(api.db, id);
    expect(audits[2]!.changes).toMatchObject({ based_on_version: { from: 1, to: 2 } });
    expect(audits[4]!.changes).toMatchObject({ based_on_version: { from: 3, to: 4 } });
  });
});

describe("every other raiser that recurs: the same rule", () => {
  let kds: Session;
  let t1: string;
  let k1: string;

  beforeAll(async () => {
    t1 = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "KDS", { type: "transformation", id: t1 }, w.orgA.id);
    kds = await signIn(api.app, u.subject);
    const r = await call<Body>(api.app, "POST", `/api/v1/transformations/${t1}/kpi-definitions`, {
      session: kds,
      body: {
        name: "Synthetic KPI recurrence",
        unitKind: "count",
        unitLabel: null,
        polarity: "higher_is_better",
        frequency: "monthly",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    k1 = r.body.id as string;
  });

  /** Each raiser, as a function that opens or recurs ITS exception and returns the exception id. */
  const raisers: Record<string, () => () => Promise<string>> = {
    "the job failure hook (an automation queue's retries exhausted)": () => {
      const q = `bezsix.auto_${tag()}`; // letters only (the 0074 queue_name rule)
      return async () => {
        await captureJobFailure(api.db, {
          queue: q,
          jobId: crypto.randomUUID(),
          data: {
            outboxEventId: crypto.randomUUID(),
            eventType: "synthetic.event",
            schemaVersion: 1,
            idempotencyKey: `synthetic:${q}:${tag()}`,
            organizationId: w.orgA.id,
            payload: {},
          },
          attempts: 5,
          error: new Error("Synthetic failure"),
        });
        const row = await api.db
          .selectFrom("operational_exception")
          .select("id")
          .where("source_code", "=", q)
          .where("status", "in", ["open", "acknowledged"])
          .executeTakeFirstOrThrow();
        return row.id;
      };
    },
    "the connector consumer (worker twin, connector_run_failed)": () => {
      const code = `bez6-conn-${tag()}`;
      return async () =>
        (
          await api.db.transaction().execute((tx) =>
            raiseOperationalExceptionTwin(tx, TWIN_ACTOR, {
              organizationId: w.orgA.id,
              sourceKind: "connector",
              sourceCode: code,
              failureClass: "connector_run_failed",
              errorCode: "integrations.run_failed",
              errorMessage: "Synthetic connector failure.",
            }),
          )
        ).exceptionId;
    },
    "the data_stale raiser (API service, KPI linked)": () => {
      return async () =>
        (
          await api.db.transaction().execute((tx) =>
            raiseOperationalException(tx, SERVICE, {
              organizationId: w.orgA.id,
              sourceKind: "data_freshness",
              sourceCode: `kpi:${k1}`,
              failureClass: "data_stale",
              errorCode: "kpi.stale",
              errorMessage: "Synthetic stale data.",
              kpiLinks: [{ kpiDefinitionId: k1, transformationId: t1 }],
            }),
          )
        ).exceptionId;
    },
  };

  for (const [name, make] of Object.entries(raisers))
    it(`${name}: acknowledge and resolve with a version loaded before a recurrence succeed`, async () => {
      const raise = make();
      const id = await raise();
      const loaded = await get(id);
      expect(loaded.status).toBe("open");
      expect(await raise()).toBe(id); // recurrence after the load
      const ack = await act("acknowledge", id, loaded.version, null);
      expect(ack.status, JSON.stringify(ack.body)).toBe(200);
      expect([ack.body.status, ack.body.version]).toEqual(["acknowledged", loaded.version + 2]);
      expect(await raise()).toBe(id); // recurrence while acknowledged, after the acknowledgement's response
      expect(await raise()).toBe(id); // and another one
      const res = await act("resolve", id, ack.body.version, "Synthetic: fixed at the source.");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect([res.body.status, res.body.version]).toEqual(["resolved", loaded.version + 5]);
      expect((await auditTrail(id)).map((a) => a[0])).toEqual([
        "operational_exception.opened",
        "operational_exception.recurred",
        "operational_exception.acknowledged",
        "operational_exception.recurred",
        "operational_exception.recurred",
        "operational_exception.resolved",
      ]);
    });
});

describe("a real conflict is still 409 (the controls)", () => {
  const openJob = async () =>
    (
      await api.db.transaction().execute((tx) =>
        raiseOperationalException(tx, SERVICE, {
          organizationId: w.orgA.id,
          sourceKind: "job",
          sourceCode: `bez6.ctl_${tag()}`,
          failureClass: "job_failed",
          errorCode: "automation.retries_exhausted",
          errorMessage: "Synthetic failure.",
        }),
      )
    ).exceptionId;
  const recur = async (id: string) => {
    const r = await rowOf(id);
    await api.db.transaction().execute((tx) =>
      raiseOperationalException(tx, SERVICE, {
        organizationId: r.organization_id,
        sourceKind: "job",
        sourceCode: r.source_code,
        failureClass: "job_failed",
        errorCode: "automation.retries_exhausted",
        errorMessage: "Synthetic failure.",
      }),
    );
  };
  const expectConflict = (r: { status: number; body: Body }, current: number) => {
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect([r.body.type, r.body.code]).toEqual(["urn:mth:problem:version-conflict", "version_conflict"]);
    expect(r.body.currentVersion).toBe(current);
  };

  it("human vs human: a second administrator acting on the version both loaded gets 409; nothing is written", async () => {
    const id = await openJob();
    const seen = (await get(id)).version;
    expect((await get(id, admin2)).version).toBe(seen);
    const first = await act("acknowledge", id, seen, "Synthetic: mine.");
    expect(first.status).toBe(200);
    const before = await auditOf(api.db, id);
    expectConflict(await act("resolve", id, seen, "Synthetic: also mine.", admin2), seen + 1);
    expectConflict(await act("acknowledge", id, seen, null, admin2), seen + 1);
    expect(await auditOf(api.db, id)).toEqual(before);
    expect((await rowOf(id)).status).toBe("acknowledged");
    expect((await rowOf(id)).acknowledged_by).toBe(w.admin.id);
    expect(admin2Id).not.toBe(w.admin.id);
  });

  it("a human change mixed with system recurrences after the load is still 409 (either order)", async () => {
    const id = await openJob();
    const seen = (await get(id)).version;
    await recur(id);
    expect((await act("acknowledge", id, seen + 1, null, admin2)).status).toBe(200); // the other human, current
    await recur(id);
    expectConflict(await act("resolve", id, seen, "Synthetic: stale view."), seen + 3);
    // Loaded after the human change, then only recurrences: accepted.
    const res = await act("resolve", id, seen + 2, "Synthetic: current view.");
    expect([res.status, res.body.status]).toEqual([200, "resolved"]);
  });

  it("an automatic recovery after the load is 409 (the exception is already resolved); a version ahead is 409", async () => {
    const id = await openJob();
    const seen = (await get(id)).version;
    expectConflict(await act("acknowledge", id, seen + 1, null), seen);
    await recur(id);
    expectConflict(await act("acknowledge", id, seen + 5, null), seen + 1);
    const r = await rowOf(id);
    await api.db.transaction().execute((tx) =>
      recoverOperationalException(tx, SERVICE, {
        organizationId: r.organization_id,
        sourceKind: "job",
        sourceCode: r.source_code,
        failureClass: "job_failed",
      }),
    );
    const before = await auditOf(api.db, id);
    expectConflict(await act("acknowledge", id, seen, null), seen + 2);
    expectConflict(await act("resolve", id, seen + 1, "Synthetic: too late."), seen + 2);
    expect(await auditOf(api.db, id)).toEqual(before);
    expect((await rowOf(id)).resolution).toBe("recovered");
  });
});
