// The worker heartbeat writer (ADR-0053 §6; REQ-S12-019/REQ-S16-029 A22; T-DG6-DO-D). main.ts starts it after the
// worker's handlers are registered and stops it on shutdown.
//
// Each worker process chooses a random `instance_key` at start, inserts one worker_heartbeat row (beat 1) and then,
// every WORKER_HEARTBEAT_SECONDS (default 30, 1-30), moves it forward by exactly one beat (`worker_heartbeat_forward`,
// probe WH02). Times are the database clock (`now()`), the clock the API's getWorkerHeartbeat and its watch read. The
// table is telemetry: version-stepped, not audited (the job_run precedent), so a beat writes no audit event.
// A failed beat is logged and retried at the next tick; it never stops the worker. A restarted worker writes a new
// instance key (the old row stays as history and turns stale).
import { randomBytes } from "node:crypto";
import { sql, type Db } from "@mth/db";

export interface HeartbeatLogger {
  error(obj: object, msg: string): void;
}

export interface HeartbeatOptions {
  readonly db: Db;
  readonly intervalSeconds: number;
  readonly appVersion: string;
  /** The number of queues this worker process serves. */
  readonly queueCount: number;
  /** Default: `worker-<hostname-free random hex>`; tests pass their own. */
  readonly instanceKey?: string;
  readonly log?: HeartbeatLogger;
}

export interface RunningHeartbeat {
  readonly instanceKey: string;
  /** Writes one beat now (the first call inserts the row). Exposed for tests; the timer calls it. */
  beat(): Promise<void>;
  stop(): Promise<void>;
}

const consoleLogger: HeartbeatLogger = {
  error: (obj, msg) => console.error(JSON.stringify({ level: "error", msg, ...obj })),
};

export function newInstanceKey(): string {
  return `worker-${randomBytes(12).toString("hex")}`;
}

/** Inserts the first beat or moves the row forward by one; re-inserts if the row is missing. */
async function writeBeat(
  db: Db,
  state: { inserted: boolean },
  o: Required<Pick<HeartbeatOptions, "appVersion" | "queueCount">> & { instanceKey: string },
): Promise<void> {
  if (state.inserted) {
    const updated = await db
      .updateTable("worker_heartbeat")
      .set({
        last_beat_at: sql`greatest(now(), last_beat_at)`,
        beat_count: sql`beat_count + 1`,
        version: sql`version + 1`,
        updated_at: sql`now()`,
      })
      .where("instance_key", "=", o.instanceKey)
      .executeTakeFirst();
    if (updated.numUpdatedRows > 0n) return;
  }
  await db
    .insertInto("worker_heartbeat")
    .values({
      id: sql<string>`mth_uuid_v7()`,
      instance_key: o.instanceKey,
      app_version: o.appVersion,
      started_at: sql`now()`,
      last_beat_at: sql`now()`,
      beat_count: 1,
      queue_count: o.queueCount,
    })
    .onConflict((oc) => oc.column("instance_key").doNothing())
    .execute();
  state.inserted = true;
}

export function startHeartbeat(options: HeartbeatOptions): RunningHeartbeat {
  const instanceKey = options.instanceKey ?? newInstanceKey();
  const log = options.log ?? consoleLogger;
  const appVersion = options.appVersion.slice(0, 50) || "unknown";
  const queueCount = Math.max(0, Math.min(1000, Math.trunc(options.queueCount)));
  const state = { inserted: false };
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const beat = (): Promise<void> => {
    // One beat at a time: a slow database never makes two beats race (each must move forward by exactly one).
    inFlight = inFlight.then(() =>
      writeBeat(options.db, state, { instanceKey, appVersion, queueCount }).catch((err: unknown) =>
        log.error(
          { instanceKey, errorCode: "worker.heartbeat_failed", err: err instanceof Error ? err.message : String(err) },
          "worker heartbeat failed",
        ),
      ),
    );
    return inFlight;
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void beat().then(schedule);
    }, options.intervalSeconds * 1000);
  };
  void beat().then(schedule);

  return {
    instanceKey,
    beat,
    async stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      await inFlight;
    },
  };
}
