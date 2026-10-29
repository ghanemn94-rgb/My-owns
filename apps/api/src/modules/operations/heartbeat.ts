// The worker heartbeat: its status read and the API's watch (ADR-0053 §6; REQ-S12-019 A22; T-DG6-BE-K).
//
// The worker writes worker_heartbeat (DO-D's writer, apps/worker/src/main.ts, every WORKER_HEARTBEAT_SECONDS, default
// 30). The table is telemetry, not audited. This file only READS it:
//   - status (getWorkerHeartbeat): `alive` when the newest beat is at most 90 s old (3 intervals), `stale` when older,
//     `unknown` when no worker ever beat. `unknown` and `stale` are never reported as alive.
//   - the watch: every 60 s the API process checks the newest beat. When one exists and is older than 90 s it opens (or
//     recurs) the platform exception `worker:worker:heartbeat_missed` under lock `operationalExceptionUpsert` (raiseOperationalException);
//     when beats are fresh again it resolves it `recovered`. With no beat at all (`unknown`, e.g. a deployment whose
//     worker never started) it raises nothing: ADR-0053 §6 raises on a beat "older than 90 s", and `unknown` is shown as
//     unknown on the heartbeat card instead. Several API instances share the lock; a check within 30 s of the last
//     recorded occurrence does not count again, so N instances do not multiply the occurrence count.
// The opening writes one structured log line at level error with `alert: true` (ADR-0053 §6 (a)); the in-app alert to
// the `operations.acknowledge` holders is BE-K2's (p6-work-split §J/C.4).
import { sql, type Db, type DbOrTx, type Tx } from "@mth/db";
import type { AuditContext } from "../audit/index.ts";
import { iso } from "../platform/index.ts";
import { raiseOperationalException, recoverOperationalException, type RaiseResult } from "./exceptions.ts";

/** 3 intervals of the default 30 s beat (ADR-0053 §6). */
export const HEARTBEAT_STALE_AFTER_SECONDS = 90;
/** How often the API checks (ADR-0053 §6). */
export const HEARTBEAT_WATCH_INTERVAL_MS = 60_000;
/** A check this soon after the last recorded occurrence does not recur (several API instances). */
const RECUR_MIN_GAP_SECONDS = 30;

export const HEARTBEAT_EXCEPTION = {
  organizationId: null,
  sourceKind: "worker",
  sourceCode: "worker",
  failureClass: "heartbeat_missed",
} as const;

export type HeartbeatState = "alive" | "stale" | "unknown";

export interface WorkerHeartbeatBody {
  readonly status: HeartbeatState;
  readonly checkedAt: string;
  readonly staleAfterSeconds: number;
  readonly newestBeatAt: string | null;
  readonly instances: {
    readonly instanceKey: string;
    readonly appVersion: string;
    readonly startedAt: string;
    readonly lastBeatAt: string;
    readonly beatCount: string;
    readonly queueCount: number;
    readonly status: "alive" | "stale";
  }[];
}

/** The pure rule: alive within the window, stale after it, unknown without a beat. */
export function heartbeatState(
  newestBeatAt: Date | null,
  now: Date,
  staleAfterSeconds = HEARTBEAT_STALE_AFTER_SECONDS,
): HeartbeatState {
  if (newestBeatAt === null) return "unknown";
  return now.getTime() - newestBeatAt.getTime() <= staleAfterSeconds * 1000 ? "alive" : "stale";
}

/** Instances listed on the card: the 50 most recent beats (older instances are history, not shown). */
const MAX_INSTANCES = 50;

/** getWorkerHeartbeat's body, on the database clock. */
export async function readWorkerHeartbeat(db: DbOrTx): Promise<WorkerHeartbeatBody> {
  const nowRow = await sql<{ now: Date }>`SELECT now() AS now`.execute(db);
  const now = nowRow.rows[0]!.now;
  const rows = await db
    .selectFrom("worker_heartbeat")
    .select(["instance_key", "app_version", "started_at", "last_beat_at", "beat_count", "queue_count"])
    .orderBy("last_beat_at", "desc")
    .orderBy("instance_key")
    .limit(MAX_INSTANCES)
    .execute();
  const newest = rows[0]?.last_beat_at ?? null;
  return {
    status: heartbeatState(newest, now),
    checkedAt: iso(now),
    staleAfterSeconds: HEARTBEAT_STALE_AFTER_SECONDS,
    newestBeatAt: newest === null ? null : iso(newest),
    instances: rows.map((r) => ({
      instanceKey: r.instance_key,
      appVersion: r.app_version,
      startedAt: iso(r.started_at),
      lastBeatAt: iso(r.last_beat_at),
      beatCount: String(r.beat_count),
      queueCount: r.queue_count,
      status: heartbeatState(r.last_beat_at, now) === "alive" ? "alive" : "stale",
    })),
  };
}

export interface WatchOutcome {
  readonly state: HeartbeatState;
  readonly action: "none" | "opened" | "recurred" | "recovered" | "skipped";
  readonly exceptionId: string | null;
}

const WATCH_ACTOR: AuditContext = { actorUserId: null, actorType: "service", requestId: "operations:heartbeat-watch" };

/** One watch step in the caller's transaction (the test runs it in a rolled-back one). */
export async function heartbeatWatchStep(tx: Tx): Promise<WatchOutcome> {
  const r = await sql<{ newest: Date | null; now: Date }>`
    SELECT (SELECT max(last_beat_at) FROM worker_heartbeat) AS newest, now() AS now`.execute(tx);
  const { newest, now } = r.rows[0]!;
  const state = heartbeatState(newest, now);
  if (state === "unknown") return { state, action: "none", exceptionId: null };
  if (state === "alive") {
    const id = await recoverOperationalException(tx, WATCH_ACTOR, HEARTBEAT_EXCEPTION);
    return { state, action: id === null ? "none" : "recovered", exceptionId: id };
  }
  const recent = await tx
    .selectFrom("operational_exception")
    .select("id")
    .where("organization_id", "is", null)
    .where("dedup_key", "=", "worker:worker:heartbeat_missed")
    .where("status", "in", ["open", "acknowledged"])
    .where(sql<boolean>`last_occurred_at > now() - make_interval(secs => ${RECUR_MIN_GAP_SECONDS})`)
    .executeTakeFirst();
  if (recent !== undefined) return { state, action: "skipped", exceptionId: recent.id };
  const seconds = Math.floor((now.getTime() - newest!.getTime()) / 1000);
  const raised: RaiseResult = await raiseOperationalException(tx, WATCH_ACTOR, {
    ...HEARTBEAT_EXCEPTION,
    errorCode: "operations.heartbeat_missed",
    errorMessage: `No worker heartbeat for ${seconds} seconds (newest beat ${iso(newest!)}).`,
  });
  return { state, action: raised.outcome, exceptionId: raised.exceptionId };
}

export interface WatchLogger {
  error(obj: object, msg: string): void;
}

/**
 * Starts the watch: one step every `intervalMs` in its own transaction. A failed step is logged and retried at the
 * next tick (the watch never stops the API). The timer is unref'd; `stop` clears it and waits for a running step.
 */
export function startHeartbeatWatch(
  db: Db,
  log: WatchLogger,
  intervalMs = HEARTBEAT_WATCH_INTERVAL_MS,
): { stop(): Promise<void> } {
  let running: Promise<void> = Promise.resolve();
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    running = db
      .transaction()
      .execute((tx) => heartbeatWatchStep(tx))
      .then((o) => {
        if (o.action === "opened")
          log.error(
            {
              alert: true,
              alertCode: "heartbeat_missed",
              exceptionId: o.exceptionId,
              errorCode: "operations.heartbeat_missed",
            },
            "operational exception opened",
          );
      })
      .catch((err: unknown) =>
        log.error({ err: err instanceof Error ? err.message : String(err) }, "heartbeat watch failed"),
      );
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
