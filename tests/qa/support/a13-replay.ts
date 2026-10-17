// qa-verifier acceptance support for A13 "Durable automation" (DG5, T-DG5-QA-F2). Replay and drain helpers shared
// by the F2 suites. Setup and observation only; no assertion about an acceptance outcome lives here.
//
// "Retried events" (A13) are produced the two ways a real deployment produces them:
//  - the relay crash window: the outbox row is set back to unpublished, so the REAL relay sends it again;
//  - pg-boss re-delivery: the same envelope is sent again to every queue that consumes the event type.
// "Re-run jobs" are scheduled jobs sent again to their own queue with the same data (a worker restart that runs the
// slot again, or an operator's run-now).
// All data is SYNTHETIC; nothing here approves anything real or touches the engineering gates DG0-DG7.
import { expect } from "vitest";
import { QUEUES_FOR_EVENT } from "../../../apps/worker/src/queues/index.ts";
import { waitFor, type Body, type ScratchEnv } from "./a13-durable.ts";

type Boss = { send(name: string, data: object): Promise<string | null> };

/** Every pg-boss job that carries the outbox event `eventId` has finished (none created, retrying or active). */
export async function drainedEvent(env: ScratchEnv, eventId: string, ms = 60_000): Promise<void> {
  await waitFor(
    async () => {
      const r = await env.su.query(
        "SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'outboxEventId' = $1 AND state IN ('created','retry','active')",
        [eventId],
      );
      return r.rows[0].n === 0;
    },
    `every job of event ${eventId} finished`,
    ms,
  );
}

/** Every job of the queue `name` has finished. */
export async function drainedQueue(env: ScratchEnv, name: string, ms = 60_000): Promise<void> {
  await waitFor(
    async () => {
      const r = await env.su.query(
        "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state IN ('created','retry','active')",
        [name],
      );
      return r.rows[0].n === 0;
    },
    `every job of queue ${name} finished`,
    ms,
  );
}

/** The envelope the relay publishes for an outbox row (the worker's documented job data). */
export function envelopeOfRow(event: Body) {
  return {
    outboxEventId: event.id,
    eventType: event.event_type,
    schemaVersion: event.schema_version,
    idempotencyKey: event.idempotency_key,
    organizationId: event.organization_id,
    payload: typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload,
  };
}

/** Re-relays the outbox row and re-delivers it to every consuming queue, `times` times, draining in between. */
export async function replayEvent(env: ScratchEnv, boss: Boss, event: Body, times = 3): Promise<void> {
  const queues = QUEUES_FOR_EVENT[event.event_type] ?? [];
  expect(queues.length, `${event.event_type} has consumers`).toBeGreaterThan(0);
  for (let i = 0; i < times; i++) {
    await env.su.query("UPDATE outbox_event SET published_at = NULL WHERE id = $1", [event.id]);
    await waitFor(
      async () => {
        const r = await env.su.query("SELECT published_at FROM outbox_event WHERE id = $1", [event.id]);
        return (r.rows[0].published_at ?? null) !== null;
      },
      `re-relay ${i + 1} of ${event.event_type}`,
    );
    for (const q of queues) await boss.send(q, envelopeOfRow(event));
    await drainedEvent(env, event.id);
  }
}

/** The outbox rows of one event type whose payload member `member` equals `value`. */
export async function outboxByPayload(env: ScratchEnv, eventType: string, member: string, value: string) {
  const r = await env.su.query(
    "SELECT * FROM outbox_event WHERE event_type = $1 AND payload->>$2 = $3 ORDER BY created_at",
    [eventType, member, value],
  );
  return r.rows as Body[];
}

/** Calendar-day arithmetic on business dates (YYYY-MM-DD, UTC midnight). */
export const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
