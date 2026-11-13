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
// Amendment 4 (§A4.2-§A4.4; p7-work-split §C.15; T-DG7-BE-R4) adds the lineage steps to the same fixed point:
//
//   L1. an added calculation_run is explained when exactly one explained outbox row carries its idempotency_key, with
//       the event and aggregate of RECHECK_LINEAGE_TABLES.calculation_run.triggers[trigger_kind], its trigger record,
//       its organization and (actual_accepted) its value number; and when its exact counts hold (A4.3);
//   L2. an added kpi_evaluation is explained through kpi_evaluation_run_fkey to an explained run;
//   L3. an added outbox row is explained when it is one of RECHECK_LINEAGE_OUTBOX of an explained run or evaluation,
//       with created_at = the run's completed_at, compared as timestamptz in SQL (the run's transaction);
//
// and every link carries a depth: 0 for E, +1 through an execution (step 3) or a run (L1). An execution deeper than
// RECHECK_CHAIN_MAX_DEPTH is not explained. A schedule or request trigger is never chain-explained (A3.9). Everything here only SELECTs; nothing writes, updates
// or truncates audit_event, and no attribution changes. Nothing here approves anything (no G1-G6, Finance or IT
// approval) and nothing reads or writes DG0-DG7.
import { sql } from "kysely";
import type { DbOrTx } from "../pool.ts";
import {
  RECHECK_CHAIN_MAX_DEPTH,
  RECHECK_LINEAGE_OUTBOX,
  RECHECK_LINEAGE_TABLES,
  type ExplainingSet,
} from "./recheck.ts";

/** One chained execution of the JSON report (A3.2 "Report", with A4.5 `depth`). */
export interface AutomationLink {
  readonly executionId: string;
  readonly triggerCode: string;
  readonly triggerKey: string;
  readonly outboxEventId: string;
  /** The event `e` of A3.2 step 2; null when the outbox row is a lineage row of a run (A4.2 step L3). */
  readonly linkEventId: string | null;
  readonly linkRecordType: string | null;
  readonly linkRecordId: string | null;
  readonly requestIds: readonly string[];
  /** A4.4: the depth of the execution. */
  readonly depth: number;
}

/** What the package holds, for "added" (A3.2 steps 2 and 3, A4.2 L1-L3). */
export interface AutomationPackageKeys {
  /** The ids of the package's outbox_event rows. */
  readonly outboxIds: readonly string[];
  /** The ids of the automation_execution rows that are added or changed against the package. */
  readonly executionIds: readonly string[];
  /** The ids of the package's calculation_run rows (A4.2 L1). */
  readonly runIds?: readonly string[];
  /** The ids of the package's kpi_evaluation rows (A4.2 L2). */
  readonly evaluationIds?: readonly string[];
}

/** Which lineage steps run: L1 only when calculation_run is listed, L2 only when kpi_evaluation is too (A4.5). */
export interface LineageSteps {
  readonly runs: boolean;
  readonly evaluations: boolean;
}

/** One explained outbox row (`O`) with its depth and, for A3.2 step 2, its linking event. */
export interface ExplainedOutbox {
  readonly id: string;
  readonly depth: number;
  readonly linkEventId: string | null;
  readonly linkRecordType: string | null;
  readonly linkRecordId: string | null;
  /** The run it belongs to when it is a lineage outbox row (L3). */
  readonly runId: string | null;
}

/** One explained run (`Run`) of the JSON report's `lineageChain` (A4.5). */
export interface LineageRunLink {
  readonly runId: string;
  readonly outboxEventId: string;
  readonly depth: number;
  readonly evaluations: number;
  readonly findings: number;
  readonly lineageOutboxIds: readonly string[];
}

/** A4.3: an added run whose counts differ; it and every row linked to it stay unexplained. */
export interface LineageRunCounts {
  readonly runId: string;
  readonly evaluations: number;
  readonly expectedEvaluations: number;
  readonly findings: number;
  readonly expectedFindings: number;
  readonly valuesRecalculated: number;
  readonly expectedValuesRecalculated: number;
  readonly deviationEvaluated: number;
  readonly expectedDeviationEvaluated: number;
}

/** The A4.7 line of a run whose counts differ. */
export const lineageRunLine = (c: LineageRunCounts): string =>
  `    lineage run ${c.runId}: ${c.evaluations} evaluations (expected ${c.expectedEvaluations}), ${c.findings} ` +
  `findings (expected ${c.expectedFindings}), ${c.valuesRecalculated} values_recalculated (expected ` +
  `${c.expectedValuesRecalculated}), ${c.deviationEvaluated} deviation_evaluated (expected ${c.expectedDeviationEvaluated})`;

/** What the fixed point returns: E*, X (the chain), O, Run and K with depths, and the refusals of A4.3 and A4.4. */
export interface AutomationChainResult {
  readonly events: ExplainingSet;
  readonly chain: AutomationLink[];
  readonly outbox: ReadonlyMap<string, ExplainedOutbox>;
  readonly runs: readonly LineageRunLink[];
  /** K: explained evaluation id -> its run and depth. */
  readonly evaluations: ReadonlyMap<string, { readonly runId: string; readonly depth: number }>;
  /** A4.3: added runs whose counts differ (never explained). */
  readonly runCounts: readonly LineageRunCounts[];
  /** A4.4: executions linked to an explained outbox row but deeper than RECHECK_CHAIN_MAX_DEPTH. */
  readonly tooDeep: readonly { readonly executionId: string; readonly depth: number }[];
}

const JOB_REQUEST = /^job:.+$/;

/** The action a starter records at ordinal 1 (apps/worker/src/automation/starters.ts STARTER_HANDLER_ACTION, step 4). */
export const STARTER_HANDLER_ACTION = "starter_handler";

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

const byId =
  <T>(k: (x: T) => string) =>
  (a: T, b: T): number =>
    k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;

const RUN_TRIGGERS = RECHECK_LINEAGE_TABLES.calculation_run.triggers as Readonly<
  Record<string, { readonly eventType: string; readonly aggregateType: string }>
>;
const [FROM_RUN, FROM_EVALUATION] = [
  RECHECK_LINEAGE_OUTBOX.find((o) => o.from === "run")!,
  RECHECK_LINEAGE_OUTBOX.find((o) => o.from === "evaluation")!,
];

/**
 * A4.3: the exact counts of every added run, read once before the fixed point. A run passes when its live evaluations
 * number evaluation_count and are all added, its findings number finding_count, and (completed) it has exactly one
 * kpi.values_recalculated and one kpi.deviation_evaluated per period evaluation, each a valid L3 row, or (failed) none
 * of them. Only passing runs can join Run.
 */
async function runCounts(
  tx: DbOrTx,
  pkg: AutomationPackageKeys,
): Promise<{ eligible: Set<string>; differ: LineageRunCounts[] }> {
  const outboxPkg = [...pkg.outboxIds];
  const r = await sql<{
    id: string;
    status: string;
    evaluation_count: number;
    finding_count: number;
    evals: string;
    evals_in_pkg: string;
    period_evals: string;
    findings: string;
    v_all: string;
    v_ok: string;
    d_all: string;
    d_ok: string;
  }>`
    SELECT r.id::text AS id, r.status, r.evaluation_count, r.finding_count,
           (SELECT count(*) FROM kpi_evaluation k
             WHERE k.transformation_id = r.transformation_id AND k.calculation_run_id = r.id)::text AS evals,
           (SELECT count(*) FROM kpi_evaluation k
             WHERE k.transformation_id = r.transformation_id AND k.calculation_run_id = r.id
               AND k.id = ANY(${[...(pkg.evaluationIds ?? [])]}::uuid[]))::text AS evals_in_pkg,
           (SELECT count(*) FROM kpi_evaluation k
             WHERE k.transformation_id = r.transformation_id AND k.calculation_run_id = r.id
               AND k.value_basis = ${FROM_EVALUATION.basis})::text AS period_evals,
           (SELECT count(*) FROM data_quality_finding f
             WHERE f.transformation_id = r.transformation_id AND f.detected_by_run_id = r.id)::text AS findings,
           (SELECT count(*) FROM outbox_event o
             WHERE o.event_type = ${FROM_RUN.eventType} AND o.aggregate_type = ${FROM_RUN.aggregateType}
               AND o.aggregate_id = r.id AND NOT (o.id = ANY(${outboxPkg}::uuid[])))::text AS v_all,
           (SELECT count(*) FROM outbox_event o
             WHERE o.event_type = ${FROM_RUN.eventType} AND o.aggregate_type = ${FROM_RUN.aggregateType}
               AND o.aggregate_id = r.id AND NOT (o.id = ANY(${outboxPkg}::uuid[]))
               AND o.idempotency_key = ${FROM_RUN.keyPrefix} || r.id::text AND o.organization_id = r.organization_id
               AND o.created_at = r.completed_at)::text AS v_ok,
           (SELECT count(*) FROM outbox_event o
              JOIN kpi_evaluation k ON k.id = o.aggregate_id
             WHERE k.transformation_id = r.transformation_id AND k.calculation_run_id = r.id
               AND o.event_type = ${FROM_EVALUATION.eventType} AND o.aggregate_type = ${FROM_EVALUATION.aggregateType}
               AND NOT (o.id = ANY(${outboxPkg}::uuid[])))::text AS d_all,
           (SELECT count(*) FROM outbox_event o
              JOIN kpi_evaluation k ON k.id = o.aggregate_id
             WHERE k.transformation_id = r.transformation_id AND k.calculation_run_id = r.id
               AND o.event_type = ${FROM_EVALUATION.eventType} AND o.aggregate_type = ${FROM_EVALUATION.aggregateType}
               AND NOT (o.id = ANY(${outboxPkg}::uuid[])) AND k.value_basis = ${FROM_EVALUATION.basis}
               AND o.idempotency_key = ${FROM_EVALUATION.keyPrefix} || k.id::text
               AND o.organization_id = r.organization_id AND o.created_at = r.completed_at)::text AS d_ok
      FROM calculation_run r
     WHERE NOT (r.id = ANY(${[...(pkg.runIds ?? [])]}::uuid[]))
     ORDER BY r.id`.execute(tx);
  const eligible = new Set<string>();
  const differ: LineageRunCounts[] = [];
  for (const x of r.rows) {
    const n = (v: string) => Number(v);
    const completed = x.status === "completed";
    const c: LineageRunCounts = {
      runId: x.id,
      evaluations: n(x.evals),
      expectedEvaluations: completed ? x.evaluation_count : 0,
      findings: n(x.findings),
      expectedFindings: completed ? x.finding_count : 0,
      valuesRecalculated: n(x.v_all),
      expectedValuesRecalculated: completed ? 1 : 0,
      deviationEvaluated: n(x.d_all),
      expectedDeviationEvaluated: completed ? n(x.period_evals) : 0,
    };
    const ok =
      c.evaluations === c.expectedEvaluations &&
      c.evaluations === x.evaluation_count &&
      c.findings === c.expectedFindings &&
      c.findings === x.finding_count &&
      n(x.evals_in_pkg) === 0 &&
      c.valuesRecalculated === c.expectedValuesRecalculated &&
      n(x.v_ok) === c.valuesRecalculated &&
      c.deviationEvaluated === c.expectedDeviationEvaluated &&
      n(x.d_ok) === c.deviationEvaluated;
    if (ok) eligible.add(x.id);
    else differ.push(c);
  }
  return { eligible, differ };
}

/**
 * A3.2 steps 1-5 with A4.2: E*, O, Run, K and X with depths, to a fixed point, computed once per recheck inside its
 * transaction. Read-only.
 */
export async function automationChain(
  tx: DbOrTx,
  baselineSeqMax: bigint,
  actors: readonly string[],
  pkg: AutomationPackageKeys,
  steps: LineageSteps = { runs: false, evaluations: false },
): Promise<AutomationChainResult> {
  const B = baselineSeqMax.toString();
  const base = await explainingEvents(tx, baselineSeqMax, actors);
  const byActor = new Set(base);
  /** E* with depths: seq -> d(e). */
  const all = new Map(base.map((s) => [s, 0]));
  const outbox = new Map<string, ExplainedOutbox>();
  const runs = new Map<string, { depth: number; outboxEventId: string }>();
  const evaluations = new Map<string, { runId: string; depth: number }>();
  const chain: AutomationLink[] = [];
  const tooDeep: { executionId: string; depth: number }[] = [];
  const pending = new Set(pkg.executionIds);
  const counts = steps.runs ? await runCounts(tx, pkg) : { eligible: new Set<string>(), differ: [] };
  const pendingRuns = new Set(counts.eligible);
  const outboxPkg = [...pkg.outboxIds];
  // Each round adds at least one row to E*, O, Run, K or X, and the candidates are finite (A4.2).
  for (;;) {
    let grew = false;
    // S2: added outbox rows explained through events of E* on their aggregate, in the same transaction.
    const s2 = await sql<{ id: string; seq: string; event_id: string; record_type: string; record_id: string }>`
      SELECT o.id::text AS id, a.seq::text AS seq, a.id::text AS event_id, a.record_type,
             a.record_id::text AS record_id
        FROM outbox_event o
        JOIN audit_event a ON a.record_type = o.aggregate_type AND a.record_id = o.aggregate_id
                          AND a.organization_id = o.organization_id AND a.occurred_at = o.created_at
       WHERE a.seq = ANY(${[...all.keys()]}::bigint[]) AND NOT (o.id = ANY(${outboxPkg}::uuid[]))
         AND NOT (o.id = ANY(${[...outbox.keys()]}::uuid[]))
       ORDER BY o.id, a.seq`.execute(tx);
    for (const row of s2.rows) {
      const d = all.get(row.seq)!;
      const prev = outbox.get(row.id);
      if (prev !== undefined && prev.depth <= d) continue;
      outbox.set(row.id, {
        id: row.id,
        depth: d,
        linkEventId: row.event_id,
        linkRecordType: row.record_type,
        linkRecordId: row.record_id,
        runId: null,
      });
      grew = true;
    }
    // L1: runs, through exactly one explained outbox row with their idempotency key (A4.2).
    if (steps.runs && pendingRuns.size > 0 && outbox.size > 0) {
      const l1 = await sql<{ id: string; trigger_kind: string; outbox_id: string; event_type: string; agg: string }>`
        SELECT r.id::text AS id, r.trigger_kind, o.id::text AS outbox_id, o.event_type, o.aggregate_type AS agg
          FROM calculation_run r
          JOIN outbox_event o ON o.idempotency_key = r.idempotency_key
         WHERE r.id = ANY(${[...pendingRuns]}::uuid[]) AND o.id = ANY(${[...outbox.keys()]}::uuid[])
           AND o.aggregate_id = r.trigger_record_id AND o.organization_id = r.organization_id
           AND (r.trigger_kind <> 'actual_accepted' OR (o.payload ->> 'valueNo') = r.trigger_slot::text)
         ORDER BY r.id, o.id`.execute(tx);
      const byRun = new Map<string, typeof l1.rows>();
      for (const x of l1.rows) byRun.set(x.id, [...(byRun.get(x.id) ?? []), x]);
      for (const [id, xs] of byRun) {
        if (xs.length !== 1) continue;
        const x = xs[0]!;
        const want = Object.hasOwn(RUN_TRIGGERS, x.trigger_kind) ? RUN_TRIGGERS[x.trigger_kind]! : null;
        if (want === null || want.eventType !== x.event_type || want.aggregateType !== x.agg) continue;
        runs.set(id, { depth: outbox.get(x.outbox_id)!.depth + 1, outboxEventId: x.outbox_id });
        pendingRuns.delete(id);
        grew = true;
      }
    }
    // L2: evaluations through kpi_evaluation_run_fkey.
    if (steps.evaluations && runs.size > 0) {
      const l2 = await sql<{ id: string; run_id: string }>`
        SELECT k.id::text AS id, r.id::text AS run_id
          FROM kpi_evaluation k
          JOIN calculation_run r ON r.transformation_id = k.transformation_id AND r.id = k.calculation_run_id
         WHERE r.id = ANY(${[...runs.keys()]}::uuid[])
           AND NOT (k.id = ANY(${[...(pkg.evaluationIds ?? [])]}::uuid[]))
           AND NOT (k.id = ANY(${[...evaluations.keys()]}::uuid[]))
         ORDER BY k.id`.execute(tx);
      for (const k of l2.rows) {
        evaluations.set(k.id, { runId: k.run_id, depth: runs.get(k.run_id)!.depth });
        grew = true;
      }
    }
    // L3: the lineage outbox rows of explained runs and evaluations, at the run's transaction timestamp.
    if (runs.size > 0) {
      const l3 = await sql<{ id: string; run_id: string }>`
        SELECT o.id::text AS id, r.id::text AS run_id
          FROM outbox_event o
          JOIN calculation_run r ON o.aggregate_id = r.id
         WHERE r.id = ANY(${[...runs.keys()]}::uuid[]) AND r.status = 'completed'
           AND o.aggregate_type = ${FROM_RUN.aggregateType} AND o.event_type = ${FROM_RUN.eventType}
           AND o.idempotency_key = ${FROM_RUN.keyPrefix} || r.id::text
           AND o.organization_id = r.organization_id AND o.created_at = r.completed_at
           AND NOT (o.id = ANY(${outboxPkg}::uuid[])) AND NOT (o.id = ANY(${[...outbox.keys()]}::uuid[]))
        UNION ALL
        SELECT o.id::text AS id, r.id::text AS run_id
          FROM outbox_event o
          JOIN kpi_evaluation k ON o.aggregate_id = k.id
          JOIN calculation_run r ON r.transformation_id = k.transformation_id AND r.id = k.calculation_run_id
         WHERE k.id = ANY(${[...evaluations.keys()]}::uuid[]) AND k.value_basis = ${FROM_EVALUATION.basis}
           AND o.aggregate_type = ${FROM_EVALUATION.aggregateType} AND o.event_type = ${FROM_EVALUATION.eventType}
           AND o.idempotency_key = ${FROM_EVALUATION.keyPrefix} || k.id::text
           AND o.organization_id = r.organization_id AND o.created_at = r.completed_at
           AND NOT (o.id = ANY(${outboxPkg}::uuid[])) AND NOT (o.id = ANY(${[...outbox.keys()]}::uuid[]))
         ORDER BY id`.execute(tx);
      for (const o of l3.rows) {
        if (outbox.has(o.id)) continue;
        outbox.set(o.id, {
          id: o.id,
          depth: runs.get(o.run_id)!.depth,
          linkEventId: null,
          linkRecordType: null,
          linkRecordId: null,
          runId: o.run_id,
        });
        grew = true;
      }
    }
    // S3 and S4: executions of an event trigger chained through exactly one row of O; their jobs' events join E*.
    if (pending.size > 0 && outbox.size > 0) {
      const links = await sql<{
        execution_id: string;
        trigger_code: string;
        trigger_key: string;
        recorded_user: string | null;
        outbox_id: string;
      }>`
        SELECT x.id::text AS execution_id, x.trigger_code, x.trigger_key,
               COALESCE(x.initiating_user_id::text,
                        CASE WHEN t.initiating_user_field IS NULL THEN NULL
                             ELSE x.trigger_payload ->> t.initiating_user_field END) AS recorded_user,
               o.id::text AS outbox_id
          FROM automation_execution x
          JOIN automation_trigger t ON t.code = x.trigger_code AND t.trigger_kind = 'event'
          JOIN outbox_event o ON o.idempotency_key = x.trigger_key AND o.event_type = x.trigger_code
         WHERE x.id = ANY(${[...pending]}::uuid[]) AND o.id = ANY(${[...outbox.keys()]}::uuid[])
         ORDER BY x.id, o.id`.execute(tx);
      const byExecution = new Map<string, typeof links.rows>();
      for (const l of links.rows) byExecution.set(l.execution_id, [...(byExecution.get(l.execution_id) ?? []), l]);
      for (const [id, ls] of byExecution) {
        // Exactly one explained outbox row (the idempotency key is unique, so more than one cannot occur; kept strict).
        if (new Set(ls.map((l) => l.outbox_id)).size !== 1) continue;
        const l = ls[0]!;
        if (l.recorded_user !== null && !actors.includes(l.recorded_user)) continue;
        const o = outbox.get(l.outbox_id)!;
        const depth = o.depth + 1;
        if (depth > RECHECK_CHAIN_MAX_DEPTH) {
          // A4.4: deeper than the constant; never explained, and its job's events do not join E*.
          tooDeep.push({ executionId: id, depth });
          pending.delete(id);
          continue;
        }
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
        for (const j of joined.rows) if (!all.has(j.seq) || all.get(j.seq)! > depth) all.set(j.seq, depth);
        pending.delete(id);
        chain.push({
          executionId: id,
          triggerCode: l.trigger_code,
          triggerKey: l.trigger_key,
          outboxEventId: l.outbox_id,
          linkEventId: o.linkEventId,
          linkRecordType: o.linkRecordType,
          linkRecordId: o.linkRecordId,
          requestIds: requestIds as string[],
          depth,
        });
        grew = true;
      }
    }
    if (!grew) break;
  }
  chain.sort(byId<AutomationLink>((x) => x.executionId));
  tooDeep.sort(byId<{ executionId: string; depth: number }>((x) => x.executionId));
  const runList: LineageRunLink[] = [];
  for (const [runId, r] of runs) {
    const ev = [...evaluations.values()].filter((k) => k.runId === runId).length;
    const fn = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM data_quality_finding f JOIN calculation_run r
          ON r.transformation_id = f.transformation_id AND r.id = f.detected_by_run_id
       WHERE r.id = ${runId}::uuid`.execute(tx);
    runList.push({
      runId,
      outboxEventId: r.outboxEventId,
      depth: r.depth,
      evaluations: ev,
      findings: Number(fn.rows[0]?.n ?? "0"),
      lineageOutboxIds: [...outbox.values()]
        .filter((o) => o.runId === runId)
        .map((o) => o.id)
        .sort(),
    });
  }
  runList.sort(byId<LineageRunLink>((x) => x.runId));
  const seqs = [...all.keys()].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
  return {
    events: { all: seqs, byActor },
    chain,
    outbox,
    runs: runList,
    evaluations,
    runCounts: counts.differ,
    tooDeep,
  };
}

// ------------------------------------------------------------------------------------------------ A4.4, L4, L5

/** The A4.7 line of an execution whose result ordinals break A4.4. */
export const ordinalLine = (executionId: string, attempt: number, ordinals: readonly number[], m: number): string =>
  `    execution ${executionId}: attempt ${attempt} ordinals ${ordinals.length === 0 ? "none" : ordinals.join(", ")} ` +
  `(expected 1..${m})`;

/**
 * A4.4 "Execution -> action results": the added automation_action_result rows that the rules refuse, beyond A3.2 step
 * 6. `explainedExecutions` holds the explained added or changed executions; `chain` is X. A result is kept only when
 * an event of E* sits on it, its execution is explained, and that event's request_id is in R(x) (x in X) or the event
 * is in E (x explained by E). For each execution: no result above its attempt, ordinals 1..m per attempt, and a
 * finished starter's current attempt holds exactly one `starter_handler` row at ordinal 1. A violation makes every
 * result row of the execution unexplained.
 */
export async function explainActionResults(
  tx: DbOrTx,
  events: ExplainingSet,
  chain: readonly AutomationLink[],
  explainedExecutions: ReadonlySet<string>,
  addedResultIds: readonly string[],
  starterAction: string,
): Promise<{ unexplained: Set<string>; lines: string[] }> {
  const unexplained = new Set<string>();
  const lines: string[] = [];
  if (addedResultIds.length === 0) return { unexplained, lines };
  const added = new Set(addedResultIds);
  const r = await sql<{
    id: string;
    execution_id: string;
    attempt_no: number;
    ordinal: number;
    action_type: string;
    x_attempt: number;
    x_status: string;
    rule_code: string;
    evs: string[];
  }>`
    SELECT ar.id::text AS id, ar.automation_execution_id::text AS execution_id, ar.attempt_no, ar.ordinal,
           ar.action_type, x.attempt_no AS x_attempt, x.status AS x_status, ru.code AS rule_code,
           array(SELECT a.seq::text || '|' || COALESCE(a.request_id, '') FROM audit_event a
                  WHERE a.seq = ANY(${[...events.all]}::bigint[]) AND a.record_type = 'automation_action_result'
                    AND a.record_id = ar.id ORDER BY a.seq) AS evs
      FROM automation_action_result ar
      JOIN automation_execution x ON x.id = ar.automation_execution_id
      JOIN automation_rule ru ON ru.id = x.automation_rule_id
     WHERE ar.automation_execution_id IN (
             SELECT automation_execution_id FROM automation_action_result WHERE id = ANY(${addedResultIds}::uuid[]))
     ORDER BY ar.automation_execution_id, ar.attempt_no, ar.ordinal, ar.id`.execute(tx);
  const inChain = new Map(chain.map((c) => [c.executionId, new Set(c.requestIds)]));
  const byExecution = new Map<string, typeof r.rows>();
  for (const x of r.rows) byExecution.set(x.execution_id, [...(byExecution.get(x.execution_id) ?? []), x]);
  for (const [executionId, rows] of byExecution) {
    const mine = rows.filter((x) => added.has(x.id));
    if (!explainedExecutions.has(executionId)) {
      for (const x of mine) unexplained.add(x.id);
      continue;
    }
    const req = inChain.get(executionId);
    for (const x of mine) {
      const ok = x.evs.some((e) => {
        const [seq, requestId] = e.split("|") as [string, string];
        return req !== undefined ? req.has(requestId) : events.byActor.has(seq);
      });
      if (!ok) unexplained.add(x.id);
    }
    const head = rows[0]!;
    let violated = mine.some((x) => x.attempt_no > head.x_attempt);
    const attempts = [...new Set(mine.map((x) => x.attempt_no))].sort((a, b) => a - b);
    for (const a of attempts) {
      const ords = mine
        .filter((x) => x.attempt_no === a)
        .map((x) => x.ordinal)
        .sort((p, q) => p - q);
      const starterCurrent =
        head.rule_code.startsWith("starter.") && head.x_status !== "running" && a === head.x_attempt;
      const m = starterCurrent ? 1 : ords.length;
      const gap = ords.length !== m || ords.some((o, i) => o !== i + 1);
      const starterBad = starterCurrent && mine.some((x) => x.attempt_no === a && x.action_type !== starterAction);
      if (gap || starterBad) {
        violated = true;
        if (lines.length < 20) lines.push(ordinalLine(executionId, a, ords, m));
      }
    }
    if (head.rule_code.startsWith("starter.") && head.x_status !== "running" && !attempts.includes(head.x_attempt)) {
      const prior = rows.filter((x) => x.attempt_no === head.x_attempt);
      if (prior.length !== 1 || prior[0]!.ordinal !== 1 || prior[0]!.action_type !== starterAction) violated = true;
    }
    if (violated) for (const x of rows) if (added.has(x.id)) unexplained.add(x.id);
  }
  return { unexplained, lines };
}

/** A4.2 L4: the added findings whose run is not in Run. */
export async function unexplainedFindings(
  tx: DbOrTx,
  addedIds: readonly string[],
  runIds: readonly string[],
): Promise<Set<string>> {
  if (addedIds.length === 0) return new Set();
  const r = await sql<{ id: string }>`
    SELECT f.id::text AS id FROM data_quality_finding f
     WHERE f.id = ANY(${[...addedIds]}::uuid[])
       AND NOT EXISTS (SELECT 1 FROM calculation_run r
                        WHERE r.transformation_id = f.transformation_id AND r.id = f.detected_by_run_id
                          AND r.id = ANY(${[...runIds]}::uuid[]))`.execute(tx);
  return new Set(r.rows.map((x) => x.id));
}

/** One explained signal of the JSON report (A4.5). */
export interface LineageSignalLink {
  readonly signalId: string;
  readonly outboxEventId: string;
  readonly executionIds: readonly string[];
  readonly depth: number;
}

/**
 * A4.2 L5: an added corrective_signal is explained through exactly one row of O carrying its source_event_key with
 * the event of its source_kind and its organization, at least one execution of X consuming that row, and its case
 * NULL or an explained added or changed corrective_case. Returns the explained signals; the rest are unexplained.
 */
export async function explainSignals(
  tx: DbOrTx,
  addedIds: readonly string[],
  outbox: ReadonlyMap<string, ExplainedOutbox>,
  chain: readonly AutomationLink[],
  explainedCases: ReadonlySet<string>,
): Promise<LineageSignalLink[]> {
  if (addedIds.length === 0) return [];
  const kinds = RECHECK_LINEAGE_TABLES.corrective_signal.sourceKinds as Readonly<Record<string, string>>;
  const r = await sql<{
    id: string;
    source_kind: string;
    case_id: string | null;
    outbox_id: string;
    event_type: string;
    key: string;
  }>`
    SELECT s.id::text AS id, s.source_kind, s.corrective_case_id::text AS case_id, o.id::text AS outbox_id,
           o.event_type, o.idempotency_key AS key
      FROM corrective_signal s
      JOIN outbox_event o ON o.idempotency_key = s.source_event_key AND o.organization_id = s.organization_id
     WHERE s.id = ANY(${[...addedIds]}::uuid[]) AND o.id = ANY(${[...outbox.keys()]}::uuid[])
     ORDER BY s.id`.execute(tx);
  const out: LineageSignalLink[] = [];
  for (const s of r.rows) {
    if (!Object.hasOwn(kinds, s.source_kind) || kinds[s.source_kind] !== s.event_type) continue;
    const xs = chain.filter((x) => x.triggerKey === s.key && x.triggerCode === s.event_type);
    if (xs.length === 0) continue;
    if (s.case_id !== null && !explainedCases.has(s.case_id)) continue;
    out.push({
      signalId: s.id,
      outboxEventId: s.outbox_id,
      executionIds: xs.map((x) => x.executionId).sort(),
      depth: Math.min(...xs.map((x) => x.depth)),
    });
  }
  return out;
}
