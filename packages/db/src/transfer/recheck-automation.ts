// The explaining set of the mode 2 recheck (ADR-0064 Amendment 2 §A2.6 rule 3 with Amendment 3 §A3.2; p7-work-split
// §C.14; T-DG7-BE-R3). `explainingEvents` gives E: the events after the import's baseline, source api or worker, by or
// on behalf of a listed actor. `automationChain` extends E to E* through recorded links only, to a fixed point:
//
//   2. an added outbox_event row is explained when an event of E* sits on its aggregate (record_type, record_id,
//      organization_id) with occurred_at = created_at, compared as timestamptz in SQL (the same transaction);
//   3. an added or changed automation_execution of an `event` trigger is chain-explained when exactly one explained
//      outbox row has idempotency_key = trigger_key and event_type = trigger_code, and its recorded user (the
//      initiating_user_id, else the trigger payload member named by the catalogue's initiating_user_field), if any,
//      is a listed actor;
//   4. the worker service events of that execution's job (request_id `job:<id>`) join E*, when on_behalf_of_user_id is
//      NULL or a listed actor.
//
// A schedule or request trigger is never chain-explained (A3.9). Everything here only SELECTs; nothing writes, updates
// or truncates audit_event, and no attribution changes. Nothing here approves anything (no G1-G6, Finance or IT
// approval) and nothing reads or writes DG0-DG7.
import { sql } from "kysely";
import type { DbOrTx } from "../pool.ts";
import type { ExplainingSet } from "./recheck.ts";

/** One chained execution of the JSON report (A3.2 "Report"). */
export interface AutomationLink {
  readonly executionId: string;
  readonly triggerCode: string;
  readonly triggerKey: string;
  readonly outboxEventId: string;
  /** The event `e` of A3.2 step 2. */
  readonly linkEventId: string;
  readonly linkRecordType: string;
  readonly linkRecordId: string;
  readonly requestIds: readonly string[];
}

/** What the package holds, for "added" (A3.2 steps 2 and 3). */
export interface AutomationPackageKeys {
  /** The ids of the package's outbox_event rows. */
  readonly outboxIds: readonly string[];
  /** The ids of the automation_execution rows that are added or changed against the package. */
  readonly executionIds: readonly string[];
}

const JOB_REQUEST = /^job:.+$/;

/** A3.2 step 1: E, the `seq` of every event after `B` by or on behalf of a listed actor, source api or worker. */
export async function explainingEvents(
  tx: DbOrTx,
  baselineSeqMax: bigint,
  actors: readonly string[],
): Promise<string[]> {
  const r = await sql<{ seq: string }>`
    SELECT seq::text AS seq FROM audit_event
     WHERE seq > ${baselineSeqMax.toString()}::bigint AND source IN ('api', 'worker')
       AND (actor_user_id = ANY(${[...actors]}::uuid[]) OR on_behalf_of_user_id = ANY(${[...actors]}::uuid[]))
     ORDER BY seq`.execute(tx);
  return r.rows.map((x) => x.seq);
}

/** A3.2 steps 1–5: E* and the chain, computed once per recheck inside its transaction. */
export async function automationChain(
  tx: DbOrTx,
  baselineSeqMax: bigint,
  actors: readonly string[],
  pkg: AutomationPackageKeys,
): Promise<{ events: ExplainingSet; chain: AutomationLink[] }> {
  const B = baselineSeqMax.toString();
  const base = await explainingEvents(tx, baselineSeqMax, actors);
  const byActor = new Set(base);
  const all = new Set(base);
  const chain: AutomationLink[] = [];
  const pending = new Set(pkg.executionIds);
  // Each round chains at least one execution, so the rounds are bounded by the candidates (A3.2 step 5).
  for (;;) {
    if (pending.size === 0) break;
    // Steps 2 and 3 in one statement: the candidate executions of an event trigger, with every explained outbox row of
    // their trigger link and the linking event.
    const links = await sql<{
      execution_id: string;
      trigger_code: string;
      trigger_key: string;
      recorded_user: string | null;
      outbox_id: string;
      link_event_id: string;
      link_record_type: string;
      link_record_id: string;
    }>`
      SELECT x.id::text AS execution_id, x.trigger_code, x.trigger_key,
             COALESCE(x.initiating_user_id::text,
                      CASE WHEN t.initiating_user_field IS NULL THEN NULL
                           ELSE x.trigger_payload ->> t.initiating_user_field END) AS recorded_user,
             o.id::text AS outbox_id, e.id::text AS link_event_id, e.record_type AS link_record_type,
             e.record_id::text AS link_record_id
        FROM automation_execution x
        JOIN automation_trigger t ON t.code = x.trigger_code AND t.trigger_kind = 'event'
        JOIN outbox_event o ON o.idempotency_key = x.trigger_key AND o.event_type = x.trigger_code
                           AND NOT (o.id = ANY(${[...pkg.outboxIds]}::uuid[]))
        JOIN LATERAL (
          SELECT a.id, a.record_type, a.record_id FROM audit_event a
           WHERE a.seq = ANY(${[...all]}::bigint[]) AND a.record_type = o.aggregate_type
             AND a.record_id = o.aggregate_id AND a.organization_id = o.organization_id
             AND a.occurred_at = o.created_at
           ORDER BY a.seq LIMIT 1) e ON true
       WHERE x.id = ANY(${[...pending]}::uuid[])
       ORDER BY x.id, o.id`.execute(tx);
    const byExecution = new Map<string, typeof links.rows>();
    for (const l of links.rows) byExecution.set(l.execution_id, [...(byExecution.get(l.execution_id) ?? []), l]);
    let grew = false;
    for (const [id, ls] of byExecution) {
      // Exactly one explained outbox row (the idempotency key is unique, so more than one cannot occur; kept strict).
      if (new Set(ls.map((l) => l.outbox_id)).size !== 1) continue;
      const l = ls[0]!;
      if (l.recorded_user !== null && !actors.includes(l.recorded_user)) continue;
      // Step 4: R(x), the job request ids of the execution's own service events after the baseline.
      const req = await sql<{ request_id: string | null }>`
        SELECT DISTINCT request_id FROM audit_event
         WHERE seq > ${B}::bigint AND source = 'worker' AND actor_type = 'service'
           AND record_type = 'automation_execution' AND record_id = ${id}::uuid
         ORDER BY request_id`.execute(tx);
      const requestIds = req.rows.map((r) => r.request_id);
      if (requestIds.length === 0 || !requestIds.every((r) => r !== null && JOB_REQUEST.test(r))) continue;
      const joined = await sql<{ seq: string }>`
        SELECT seq::text AS seq FROM audit_event
         WHERE seq > ${B}::bigint AND source = 'worker' AND actor_type = 'service'
           AND request_id = ANY(${requestIds as string[]}::text[])
           AND (on_behalf_of_user_id IS NULL OR on_behalf_of_user_id = ANY(${[...actors]}::uuid[]))`.execute(tx);
      for (const j of joined.rows) all.add(j.seq);
      pending.delete(id);
      chain.push({
        executionId: id,
        triggerCode: l.trigger_code,
        triggerKey: l.trigger_key,
        outboxEventId: l.outbox_id,
        linkEventId: l.link_event_id,
        linkRecordType: l.link_record_type,
        linkRecordId: l.link_record_id,
        requestIds: requestIds as string[],
      });
      grew = true;
    }
    if (!grew) break;
  }
  chain.sort((a, b) => (a.executionId < b.executionId ? -1 : a.executionId > b.executionId ? 1 : 0));
  return {
    events: { all: [...all].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)), byActor },
    chain,
  };
}
