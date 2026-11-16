// The mode 2 recheck's lineage links (ADR-0064 Amendment 4 §A4.2-§A4.5, §A4.7; p7-work-split §C.15; REQ-S19-014,
// REQ-S19-017; T-DG7-BE-R4): T-R24 (the KPI chain explained to the end), T-R25 (each negative unexplained with its
// A4.7 line) and T-R26 (the catalogue check of the named links).
//
// Fixture: a SYNTHETIC demo source (period anchor: today, so the current period is open), exported and imported into a
// target prepared with the audit reservation. On the target, the real API (in-process, its dev sign-in) takes one KPI
// actual from the demo KDS and its acceptance from the demo SP (a synthetic demo approval; it approves nothing real),
// and the worker's real handlers (DOMAIN_HANDLERS, with the starter wrappers) consume every new outbox row as the relay
// would deliver it (QUEUES_FOR_EVENT, jobsForEvent), until no new row appears. Every value is synthetic. Nothing here
// approves anything (no G1-G6, Finance or IT approval) and nothing reads or writes DG0-DG7. audit_event is only
// appended to through the product's paths and this file's own synthetic INSERTs; it is never updated or truncated.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, signIn, startApi, type Session, type TestApi } from "../../../../apps/api/test/support/harness.ts";
import type { JobHandler } from "../../../../apps/worker/src/handlers/index.ts";
import { DOMAIN_HANDLERS } from "../../../../apps/worker/src/handlers/index.ts";
import { QUEUES_FOR_EVENT } from "../../../../apps/worker/src/queues/index.ts";
import { jobsForEvent } from "../../../../apps/worker/src/relay.ts";
import { DEMO_ANCHORS, DEMO_KPIS, demoPeriodsFor } from "../../src/demo/data/kpis.ts";
import { DEMO_USERS } from "../../src/demo/data/roaming.ts";
import { DEMO_ACTUALS } from "../../src/demo/data/actuals.ts";
import { DEMO_ORGANIZATION_TIMEZONE } from "../../src/demo/guard.ts";
import { resolvePeriodAnchor, seedDemo } from "../../src/demo/seed.ts";
import { DEV_ISSUER } from "../../src/constants.ts";
import { createDb, createPool, type Db } from "../../src/pool.ts";
import { applyRebind, MAPPING_HEADER, rebindLines } from "../../src/transfer/rebind.ts";
import {
  ALLOWANCE_SCHEMA_VERSION,
  runReconcileMigrationCommand,
  type RecheckJsonReport,
} from "../../src/transfer/index.ts";
import { roleUrl, testDatabase } from "../helpers.ts";
import { importInto, RoundtripWorkspace, type RoundtripScratch } from "./transfer-roundtrip.fixture.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

/** The KPIs are ratios: the latest synthetic demo actual's numerator and denominator, re-entered. */
const ratioOf = (kpi: string) => {
  const a = [...DEMO_ACTUALS].reverse().find((x) => x.kpi === kpi)!;
  return { numerator: a.numerator, denominator: a.denominator };
};

const { adminUrl } = testDatabase();
const ws = new RoundtripWorkspace(adminUrl);
let target: RoundtripScratch;
let targetName = "";
let pkg = "";
let dir = "";
let api: TestApi;
let worker: Db;
const s: Record<string, Session> = {};
const user = (role: string) => DEMO_USERS.find((u) => u.role === role)!;
const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const workerErrors: string[] = [];
let actualId = "";
/** The listed actor whose event accepted the value (the KDS on a direct accept, else the SP). */
let acceptor = "";
let runId = "";

const HANDLERS = new Map<string, JobHandler>(DOMAIN_HANDLERS.map((h) => [h.queue, h]));

/** The relay and the worker in-process: every outbox row after `seq`, to every queue of its event, until none is new. */
async function drainWorker(fromSeq: string): Promise<void> {
  const done = new Set<string>();
  for (let round = 0; round < 20; round += 1) {
    const rows = await target.db
      .selectFrom("outbox_event")
      .select(["id", "seq", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
      .where("seq", ">", fromSeq)
      .orderBy("seq")
      .execute();
    const fresh = rows.filter((r) => !done.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) {
      done.add(r.id);
      const envelope = {
        outboxEventId: r.id,
        eventType: r.event_type,
        schemaVersion: r.schema_version,
        idempotencyKey: r.idempotency_key,
        organizationId: r.organization_id,
        payload: r.payload,
      };
      for (const job of jobsForEvent(r.id, QUEUES_FOR_EVENT[r.event_type] ?? [])) {
        const h = HANDLERS.get(job.queue);
        if (h === undefined) continue;
        try {
          await h.handle(worker, envelope, job.id, { retryCount: 0, retryLimit: 2 });
        } catch (err) {
          workerErrors.push(`${job.queue} ${r.event_type}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  throw new Error("the in-process worker did not settle in 20 rounds");
}

async function recheck(allow: unknown) {
  const file = join(dir, `allow-${uuidv7()}.json`);
  writeFileSync(file, JSON.stringify(allow));
  const report = join(dir, `report-${uuidv7()}.txt`);
  const out: string[] = [];
  const err: string[] = [];
  const code = await runReconcileMigrationCommand(
    target.db,
    { operator: "Synthetic IT operator", afterUse: true, from: pkg, allow: file, report },
    { out: (l) => out.push(l), err: (l) => err.push(l) },
  );
  const json =
    code === 0 || code === 4 ? (JSON.parse(readFileSync(`${report}.json`, "utf8")) as RecheckJsonReport) : null;
  return { code, out, err, json: json! };
}

const audited = (...names: string[]) => names.map((name) => ({ name, mustInclude: { added: [], changed: [] } }));
const lineage = (names: readonly string[], evaluationKeys: string[][] = []) =>
  names.map((name) => ({ name, mustInclude: { added: name === "kpi_evaluation" ? evaluationKeys : [] } }));
const ALL_LINEAGE = ["calculation_run", "kpi_evaluation", "data_quality_finding", "corrective_signal"];
/** The tables the KPI chain touches, as the drill would list them (A4.2, A4.5; measured on this fixture). */
const AUDITED = [
  "kpi_actual",
  "automation_execution",
  "automation_action_result",
  "corrective_case",
  "raid_entry",
  "adoption_indicator",
  "benefit_measurement",
];
const CHILDREN = [
  { name: "kpi_actual_value", parent: "kpi_actual", fkey: "kpi_actual_value_actual_fkey" },
  { name: "kpi_actual_review", parent: "kpi_actual", fkey: "kpi_actual_review_actual_fkey" },
];
let auditedPresent: string[] = AUDITED.slice(0, 4);
let periodKeys: string[][] = [];

const allowance = (over: Record<string, unknown> = {}) => ({
  schemaVersion: ALLOWANCE_SCHEMA_VERSION,
  actors: [user("KDS").id, user("SP").id],
  // The two journalled actors signed in (their app_user rows changed): exact keys, as the drill lists them.
  tables: [{ name: "app_user", added: [], changed: [[user("KDS").id], [user("SP").id]].sort() }],
  audited: audited(...auditedPresent),
  children: CHILDREN,
  counters: ["record_code_counter"],
  lineage: lineage(ALL_LINEAGE, periodKeys),
  operational: ["outbox_event", "processed_message", "inbox_notification", "job_run", "notification_delivery"],
  ...over,
});

const deltaOf = (r: { json: RecheckJsonReport }, table: string) => r.json.deltas.find((d) => d.tableName === table);
const keyOf = (id: string) => JSON.stringify([id]);

/** Owner-inserts a copy of `table` row `id` with `over` (identity `seq` overridden to the next value). */
async function cloneRow(table: string, id: string, over: Record<string, unknown>): Promise<string> {
  const newId = uuidv7();
  const hasSeq = (
    await sql<{ n: string }>`SELECT count(*)::text AS n FROM pg_attribute
      WHERE attrelid = to_regclass(${`public.${table}`}) AND attname = 'seq' AND NOT attisdropped`.execute(target.db)
  ).rows[0]!.n;
  const extra = { ...over, id: newId };
  await sql`INSERT INTO ${sql.table(table)} ${sql.raw(hasSeq === "1" ? "OVERRIDING SYSTEM VALUE" : "")}
    SELECT (jsonb_populate_record(NULL::${sql.table(table)},
             to_jsonb(t) || ${JSON.stringify(extra)}::jsonb
             ${sql.raw(hasSeq === "1" ? `|| jsonb_build_object('seq', (SELECT max(seq) + 1 FROM ${table}))` : "")})).*
      FROM ${sql.table(table)} t WHERE t.id = ${id}::uuid`.execute(target.db);
  return newId;
}

beforeAll(async () => {
  const source = await ws.migrated("mth_rl_source");
  await seedDemo(source.ownerUrl, {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: false,
  });
  pkg = (await ws.exportPackage(source.db)).dir;
  dir = ws.tempDir("mth-recheck-lineage-");
  target = await ws.reserved("mth_rl_target", pkg);
  targetName = decodeURIComponent(new URL(target.ownerUrl).pathname.replace(/^\//, ""));
  const r = await importInto(target.db, pkg);
  if (r.code !== 0) throw new Error(`import failed: ${r.err.join("\n")}`);
  // ADR-0064 §8: imported identities are held until IT rebinds them; the two journalled actors are rebound to the
  // dev issuer of this test stack (their demo names as subjects), through the product's own rebind.
  const mapping = [
    MAPPING_HEADER,
    ...["KDS", "SP"].map((role) => `${user(role).id},rebind,${DEV_ISSUER},${user(role).name}`),
  ];
  const rebound = await applyRebind(
    target.db,
    new TextEncoder().encode(`${mapping.join("\n")}\n`),
    "Synthetic IT operator",
  );
  expect(rebindLines(rebound).join("\n")).toMatch(/^rebind-identity: rebound 2, retained 0;/);
  worker = createDb(createPool(roleUrl(adminUrl, targetName, "mth_app"), { max: 2 }));
  api = await startApi({ database: targetName });
  for (const role of ["KDS", "SP"]) s[role] = await signIn(api.app, user(role).name);
}, 900_000);

afterAll(async () => {
  await api?.close();
  await worker?.destroy();
  await ws.close();
}, 120_000);

describe("T-R24: the KPI chain explained through its lineage links (A4.2-A4.5)", () => {
  it("a journalled actor accepts one KPI actual through the route; the worker runs; mode 2 gives allowed", async () => {
    const before = (await sql<{ m: string | null }>`SELECT max(seq)::text AS m FROM outbox_event`.execute(target.db))
      .rows[0]!.m;
    const anchor = resolvePeriodAnchor(undefined).anchor;
    const current = demoPeriodsFor(anchor, DEMO_ORGANIZATION_TIMEZONE).find((p) => p.key === anchor)!;
    const kpi = DEMO_KPIS[0]!;
    const base = `/api/v1/transformations/${T}`;
    const submitted = await call<Body>(api.app, "POST", `${base}/kpi-definitions/${kpi.definitionId}/actuals`, {
      session: s["KDS"]!,
      body: {
        scopeKind: "transformation",
        scopeId: T,
        reportingPeriodId: current.id,
        ...ratioOf(kpi.key),
        dataAsOf: current.start,
        action: "submit",
      },
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    actualId = submitted.body.actual.id;
    // The configured reviewer accepts a submitted value; a value the KDS may accept directly is accepted on submit
    // (A4.3: the event of acceptKpiActual, or of a direct-accept submitKpiActual).
    acceptor = user("KDS").id;
    if (submitted.body.actual.status !== "accepted") {
      acceptor = user("SP").id;
      expect(submitted.body.actual.status, JSON.stringify(submitted.body)).toBe("submitted");
      const accepted = await call<Body>(api.app, "POST", `${base}/kpi-actuals/${actualId}/accept`, {
        session: s["SP"]!,
        headers: { "if-match": `"${submitted.body.actual.version}"` },
        body: {},
      });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    }
    await drainWorker(before ?? "0");
    const run = (
      await sql<{ id: string; evaluation_count: number; status: string }>`
        SELECT id::text AS id, evaluation_count, status FROM calculation_run
         WHERE trigger_kind = 'actual_accepted' AND trigger_record_id = ${actualId}::uuid`.execute(target.db)
    ).rows;
    expect(run, workerErrors.join("\n")).toHaveLength(1);
    expect(run[0]!.status).toBe("completed");
    runId = run[0]!.id;
    periodKeys = (
      await sql<{ id: string }>`SELECT id::text AS id FROM kpi_evaluation
        WHERE calculation_run_id = ${runId}::uuid AND value_basis = 'period' ORDER BY id`.execute(target.db)
    ).rows.map((x) => [x.id]);
    // Measure which audited tables the chain touched (each must have an _audit_required trigger to be listed).
    const probe = await recheck(allowance({ audited: audited(...AUDITED.slice(0, 4)) }));
    const touched = new Set(probe.json.deltas.filter((d) => d.basis === "unexplained").map((d) => d.tableName));
    auditedPresent = [...AUDITED.slice(0, 4), ...AUDITED.slice(4).filter((t) => touched.has(t))];

    const r = await recheck(allowance());
    expect(r.err, r.out.join("\n")).toEqual([]);
    expect(r.code, `${r.out.join("\n")}\n${workerErrors.join("\n")}`).toBe(0);
    for (const t of ALL_LINEAGE) {
      const d = deltaOf(r, t);
      if (d !== undefined) expect([d.basis, d.allowed], t).toEqual(["lineage", true]);
    }
    expect(deltaOf(r, "calculation_run")).toMatchObject({ rowsAdded: "1", rowsChanged: "0", rowsMissing: "0" });
    // The run at depth 1, with evaluation_count evaluations (period and cumulative) and one lineage outbox row of each
    // kind (one kpi.values_recalculated, one kpi.deviation_evaluated per period evaluation).
    expect(r.json.lineageChain).toHaveLength(1);
    const link = r.json.lineageChain[0]!;
    expect([link.runId, link.depth, link.evaluations]).toEqual([runId, 1, run[0]!.evaluation_count]);
    expect(run[0]!.evaluation_count).toBe(2 * periodKeys.length);
    const kinds = (
      await sql<{ event_type: string }>`SELECT event_type FROM outbox_event
        WHERE id = ANY(${link.lineageOutboxIds}::uuid[]) ORDER BY event_type`.execute(target.db)
    ).rows.map((x) => x.event_type);
    expect(kinds).toEqual([...periodKeys.map(() => "kpi.deviation_evaluated"), "kpi.values_recalculated"]);
    // The first-hop execution at depth 1, the second-hop executions at depth 2, each with exactly one action result.
    const firstHop = r.json.automationChain.filter((x) => x.triggerCode === "kpi.actual_accepted");
    expect(firstHop.map((x) => x.depth)).toContain(1);
    const second = r.json.automationChain.filter((x) => link.lineageOutboxIds.includes(x.outboxEventId));
    expect(second.length).toBeGreaterThanOrEqual(2);
    for (const x of second) {
      expect(x.depth, x.executionId).toBe(2);
      expect(x.linkEventId).toBeNull();
      const results = await sql<{ n: string }>`SELECT count(*)::text AS n FROM automation_action_result
        WHERE automation_execution_id = ${x.executionId}::uuid`.execute(target.db);
      expect(results.rows[0]!.n, x.executionId).toBe("1");
    }
    // One signal per deviation outbox row with a consuming execution, each through its own source event key.
    const signals = (
      await sql<{ id: string; source_event_key: string }>`SELECT id::text AS id, source_event_key FROM corrective_signal
        WHERE source_event_key LIKE 'kpi.deviation_evaluated:%'
          AND source_event_key = ANY(${periodKeys.map((k) => `kpi.deviation_evaluated:${k[0]}`)}::text[])`.execute(
        target.db,
      )
    ).rows;
    expect(r.json.signals.map((x) => x.signalId).sort()).toEqual(signals.map((x) => x.id).sort());
    for (const sg of r.json.signals) expect(link.lineageOutboxIds).toContain(sg.outboxEventId);
    console.log(
      `T-R24 measured: audited ${JSON.stringify(auditedPresent)}; chain depths ${JSON.stringify(
        r.json.automationChain.map((x) => [x.triggerCode, x.depth]),
      )}; run ${link.evaluations} evaluations, ${link.findings} findings, ${link.lineageOutboxIds.length} lineage outbox ` +
        `rows; ${r.json.signals.length} signals; acceptance by ${acceptor === user("KDS").id ? "KDS (direct)" : "SP"}`,
    );
  }, 600_000);
});

describe("T-R25: each negative is unexplained with its A4.7 line (A4.2-A4.5)", () => {
  /** A worker job in the shape of apps/worker: an execution (left `running`) of a published version of `triggerCode`,
   * its first result, and an outbox row on the execution itself (event `next`), all in one transaction. */
  async function chainedJob(triggerCode: string, key: string, next: string | null) {
    const job = uuidv7();
    const execution = uuidv7();
    const result = uuidv7();
    const nextKey = next === null ? null : `synthetic:${uuidv7()}`;
    await target.db.transaction().execute(async (tx) => {
      const v = (
        await sql<{ rule: string; version: string; action: string }>`
          SELECT v.automation_rule_id::text AS rule, v.id::text AS version, c.code AS action
            FROM automation_rule_version v
            JOIN automation_rule r ON r.id = v.automation_rule_id
            JOIN automation_action_type c ON c.code = ANY(v.action_types) AND c.action_class <> 'human_only'
           WHERE v.status = 'published' AND ${triggerCode} = ANY(v.trigger_codes)
           ORDER BY v.id, c.code LIMIT 1`.execute(tx)
      ).rows[0];
      if (v === undefined) throw new Error(`no published version for ${triggerCode}`);
      await sql`INSERT INTO automation_execution (id, automation_rule_id, automation_rule_version_id, trigger_code,
                  trigger_key, trigger_payload, organization_id, transformation_id, run_as)
                VALUES (${execution}::uuid, ${v.rule}::uuid, ${v.version}::uuid, ${triggerCode}, ${key}, '{}'::jsonb,
                        ${ORG}::uuid, ${T}::uuid, 'service')`.execute(tx);
      await sql`INSERT INTO audit_event (id, actor_type, organization_id, action, record_type, record_id, new_version,
                  request_id, source)
                VALUES (${uuidv7()}::uuid, 'service', ${ORG}::uuid, 'automation_execution.create',
                        'automation_execution', ${execution}::uuid, 1, ${`job:${job}`}, 'worker')`.execute(tx);
      await sql`INSERT INTO automation_action_result (id, automation_execution_id, attempt_no, ordinal, action_type,
                  idempotency_key, outcome)
                VALUES (${result}::uuid, ${execution}::uuid, 1, 1, ${v.action}, ${`synthetic:${result}`},
                        'skipped')`.execute(tx);
      await sql`INSERT INTO audit_event (id, actor_type, organization_id, action, record_type, record_id, request_id,
                  source)
                VALUES (${uuidv7()}::uuid, 'service', ${ORG}::uuid, 'automation_action_result.create',
                        'automation_action_result', ${result}::uuid, ${`job:${job}`}, 'worker')`.execute(tx);
      if (next !== null)
        await sql`INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type,
                    schema_version, payload, idempotency_key)
                  VALUES (${uuidv7()}::uuid, ${ORG}::uuid, 'automation_execution', ${execution}::uuid, ${next}, 1,
                          '{}'::jsonb, ${nextKey})`.execute(tx);
    });
    return { execution, result, job, nextKey };
  }

  /** An event trigger with a published rule (for the owner-built chain; its executions stay `running`). */
  async function eventTrigger(): Promise<string> {
    const r = await sql<{ code: string }>`
      SELECT t.code FROM automation_trigger t
       WHERE t.trigger_kind = 'event'
         AND EXISTS (SELECT 1 FROM automation_rule_version v
                      JOIN automation_action_type c ON c.code = ANY(v.action_types) AND c.action_class <> 'human_only'
                      WHERE v.status = 'published' AND t.code = ANY(v.trigger_codes))
       ORDER BY t.code LIMIT 1`.execute(target.db);
    if (r.rows[0] === undefined) throw new Error("no event trigger with a published rule");
    return r.rows[0].code;
  }

  let deepChain: { execution: string; result: string; job: string }[] = [];

  it("a chain of depth 6 (owner-built): the sixth execution is unexplained, with its depth line", async () => {
    expect(runId, "T-R24 must run first").not.toBe("");
    const code = await eventTrigger();
    // Depth 0: an API-shaped mutation by a listed actor writes the first outbox row in its transaction.
    const key0 = `synthetic:${uuidv7()}`;
    await target.db.transaction().execute(async (tx) => {
      await sql`INSERT INTO audit_event (id, actor_type, actor_user_id, organization_id, action, record_type,
                  record_id, new_version, source)
                VALUES (${uuidv7()}::uuid, 'user', ${user("KDS").id}::uuid, ${ORG}::uuid, 'synthetic.probe',
                        'synthetic_probe', ${T}::uuid, NULL, 'api')`.execute(tx);
      await sql`INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type,
                  schema_version, payload, idempotency_key)
                VALUES (${uuidv7()}::uuid, ${ORG}::uuid, 'synthetic_probe', ${T}::uuid, ${code}, 1, '{}'::jsonb,
                        ${key0})`.execute(tx);
    });
    let key = key0;
    deepChain = [];
    for (let d = 1; d <= 6; d += 1) {
      const j = await chainedJob(code, key, d < 6 ? code : null);
      deepChain.push(j);
      key = j.nextKey ?? "";
    }
    const r = await recheck(allowance());
    expect(r.code, r.out.join("\n")).toBe(4);
    const depths = new Map(r.json.automationChain.map((x) => [x.executionId, x.depth]));
    expect(deepChain.slice(0, 5).map((j) => depths.get(j.execution))).toEqual([1, 2, 3, 4, 5]);
    expect(depths.has(deepChain[5]!.execution)).toBe(false);
    expect(r.out).toContain(`    chain depth 6 exceeds 5 at ${keyOf(deepChain[5]!.execution)}`);
    expect(r.out).toContain(`    unexplained added ${keyOf(deepChain[5]!.execution)}`);
  }, 300_000);

  it("an action result whose event's request_id is another job's is unexplained", async () => {
    const x1 = deepChain[0]!;
    const other = deepChain[1]!;
    const extra = uuidv7();
    await target.db.transaction().execute(async (tx) => {
      const action = (
        await sql<{
          a: string;
        }>`SELECT action_type AS a FROM automation_action_result WHERE id = ${x1.result}::uuid`.execute(tx)
      ).rows[0]!.a;
      await sql`INSERT INTO automation_action_result (id, automation_execution_id, attempt_no, ordinal, action_type,
                  idempotency_key, outcome)
                VALUES (${extra}::uuid, ${x1.execution}::uuid, 1, 2, ${action}, ${`synthetic:${extra}`}, 'skipped')`.execute(
        tx,
      );
      await sql`INSERT INTO audit_event (id, actor_type, organization_id, action, record_type, record_id, request_id,
                  source)
                VALUES (${uuidv7()}::uuid, 'service', ${ORG}::uuid, 'automation_action_result.create',
                        'automation_action_result', ${extra}::uuid, ${`job:${other.job}`}, 'worker')`.execute(tx);
    });
    const r = await recheck(allowance());
    expect(r.code).toBe(4);
    expect(r.out).toContain(`    unexplained added ${keyOf(extra)}`);
    // The execution's own first result is still explained.
    expect(r.out).not.toContain(`    unexplained added ${keyOf(x1.result)}`);
  }, 300_000);

  it("an extra action result (ordinal 2) on a starter execution makes its results unexplained, with the line", async () => {
    const r0 = await recheck(allowance());
    const starter = (
      await sql<{ id: string; action: string; result: string; request_id: string }>`
        SELECT x.id::text AS id, ar.action_type AS action, ar.id::text AS result, a.request_id
          FROM automation_execution x
          JOIN automation_rule ru ON ru.id = x.automation_rule_id AND ru.code LIKE 'starter.%'
          JOIN automation_action_result ar ON ar.automation_execution_id = x.id
          JOIN audit_event a ON a.record_type = 'automation_action_result' AND a.record_id = ar.id
         WHERE x.id = ANY(${r0.json.automationChain.filter((c) => c.depth === 2).map((c) => c.executionId)}::uuid[])
           AND x.status <> 'running'
         ORDER BY x.id LIMIT 1`.execute(target.db)
    ).rows[0]!;
    expect(starter, "a finished second-hop starter execution").toBeDefined();
    const extra = uuidv7();
    // The guard admits results only for a running attempt, so the owner-built extra row is written with the triggers
    // of this one session in replica mode (a superuser session of the disposable cluster). audit_event is untouched by
    // that mode: its event is appended in an ordinary transaction below.
    const admin = new pg.Client({ connectionString: roleUrl(adminUrl, targetName, null) });
    await admin.connect();
    try {
      await admin.query("BEGIN");
      await admin.query("SET LOCAL session_replication_role = replica");
      await admin.query(
        `INSERT INTO automation_action_result (id, automation_execution_id, attempt_no, ordinal, action_type,
           idempotency_key, outcome) VALUES ($1, $2, 1, 2, $3, $4, 'skipped')`,
        [extra, starter.id, starter.action, `synthetic:${extra}`],
      );
      await admin.query("COMMIT");
    } finally {
      await admin.end();
    }
    await sql`INSERT INTO audit_event (id, actor_type, organization_id, action, record_type, record_id, request_id,
                source)
              VALUES (${uuidv7()}::uuid, 'service', ${ORG}::uuid, 'automation_action_result.create',
                      'automation_action_result', ${extra}::uuid, ${starter.request_id}, 'worker')`.execute(target.db);
    const r = await recheck(allowance());
    expect(r.code).toBe(4);
    expect(r.out).toContain(`    execution ${starter.id}: attempt 1 ordinals 1, 2 (expected 1..1)`);
    expect(r.out).toContain(`    unexplained added ${keyOf(extra)}`);
    expect(r.out).toContain(`    unexplained added ${keyOf(starter.result)}`);
  }, 300_000);

  it("an owner-inserted kpi.deviation_evaluated row 1 µs off, and the execution it triggers, are unexplained", async () => {
    const lineageRow = (
      await sql<{ id: string; created_at: string }>`
        SELECT o.id::text AS id, o.created_at::text AS created_at FROM outbox_event o
         WHERE o.aggregate_type = 'calculation_run' AND o.aggregate_id = ${runId}::uuid`.execute(target.db)
    ).rows[0]!;
    const fakeEvaluation = uuidv7();
    const key = `kpi.deviation_evaluated:${fakeEvaluation}`;
    await sql`INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type, schema_version,
                payload, idempotency_key, created_at)
              SELECT ${uuidv7()}::uuid, ${ORG}::uuid, 'kpi_evaluation', ${fakeEvaluation}::uuid,
                     'kpi.deviation_evaluated', 1, '{}'::jsonb, ${key}, created_at + interval '1 microsecond'
                FROM outbox_event WHERE id = ${lineageRow.id}::uuid`.execute(target.db);
    const code = "kpi.deviation_evaluated";
    const j = await chainedJob(code, key, null);
    const r = await recheck(allowance());
    expect(r.code).toBe(4);
    expect(r.json.automationChain.map((x) => x.executionId)).not.toContain(j.execution);
    expect(r.out).toContain(`    unexplained added ${keyOf(j.execution)}`);
  }, 300_000);

  it("a run whose acceptance event is by an actor not in actors is unexplained", async () => {
    const others = [user("KDS").id, user("SP").id].filter((a) => a !== acceptor);
    const r = await recheck(allowance({ actors: others }));
    expect(r.code).toBe(4);
    expect(r.json.lineageChain.map((x) => x.runId)).not.toContain(runId);
    expect(r.out).toContain(`    unexplained added ${keyOf(runId)}`);
  }, 300_000);

  it("a run whose trigger kind's map entry does not match its outbox row is never explained", async () => {
    // calculation_run_trigger_pair admits only the four mapped kinds, so a kind outside the map cannot be stored; the
    // nearest constructible case is a mapped kind whose outbox row (explained, in O) carries another event.
    const values = (
      await sql<{ id: string; key: string }>`SELECT aggregate_id::text AS id, idempotency_key AS key FROM outbox_event
        WHERE aggregate_type = 'calculation_run' AND aggregate_id = ${runId}::uuid`.execute(target.db)
    ).rows[0]!;
    const fake = await cloneRow("calculation_run", runId, {
      trigger_kind: "threshold_changed",
      trigger_record_type: "kpi_rag_threshold",
      trigger_record_id: values.id,
      trigger_slot: 1,
      idempotency_key: values.key,
      status: "failed",
      error_code: "kpi.recalculate_failed",
      evaluation_count: 0,
      finding_count: 0,
    });
    const r = await recheck(allowance());
    expect(r.code).toBe(4);
    expect(r.json.lineageChain.map((x) => x.runId)).not.toContain(fake);
    expect(r.out).toContain(`    unexplained added ${keyOf(fake)}`);
  }, 300_000);

  it("a corrective_signal whose source_event_key names no explained outbox row is unexplained", async () => {
    const r0 = await recheck(allowance());
    const some = r0.json.signals[0];
    expect(some, "T-R24 produced at least one explained signal").toBeDefined();
    const fake = await cloneRow("corrective_signal", some!.signalId, {
      source_event_key: `kpi.deviation_evaluated:${uuidv7()}`,
      outcome: "recorded",
      corrective_case_id: null,
    });
    const r = await recheck(allowance());
    expect(r.code).toBe(4);
    expect(r.json.signals.map((x) => x.signalId)).not.toContain(fake);
    expect(r.out).toContain(`    unexplained added ${keyOf(fake)}`);
  }, 300_000);

  it("kpi_evaluation listed in tables (not in lineage) gives exact_ids unexplained added keys", async () => {
    const r = await recheck(
      allowance({
        tables: [{ name: "kpi_evaluation", added: periodKeys, changed: [] }],
        lineage: lineage(["calculation_run", "data_quality_finding", "corrective_signal"]),
      }),
    );
    expect(r.code).toBe(4);
    expect(deltaOf(r, "kpi_evaluation")).toMatchObject({ basis: "exact_ids", allowed: false });
    const cumulative = (
      await sql<{ id: string }>`SELECT id::text AS id FROM kpi_evaluation
        WHERE calculation_run_id = ${runId}::uuid AND value_basis = 'cumulative'`.execute(target.db)
    ).rows;
    for (const c of cumulative) expect(r.out).toContain(`    unexpected added ${keyOf(c.id)}`);
  }, 300_000);

  it("an owner-inserted extra kpi_evaluation on an explained run: the run's count differs (A4.3 line)", async () => {
    const one = (
      await sql<{ id: string; period: string }>`SELECT id::text AS id, reporting_period_id::text AS period
        FROM kpi_evaluation WHERE calculation_run_id = ${runId}::uuid AND value_basis = 'cumulative' LIMIT 1`.execute(
        target.db,
      )
    ).rows[0]!;
    const other = (
      await sql<{ id: string }>`SELECT id::text AS id FROM reporting_period
        WHERE organization_id = ${ORG}::uuid AND id <> ${one.period}::uuid ORDER BY period_start DESC LIMIT 1`.execute(
        target.db,
      )
    ).rows[0]!.id;
    const fake = await cloneRow("kpi_evaluation", one.id, { reporting_period_id: other, previous_period_id: null });
    const r = await recheck(allowance());
    expect(r.code).toBe(4);
    const run = (
      await sql<{ e: number; f: number }>`SELECT evaluation_count AS e, finding_count AS f FROM calculation_run
        WHERE id = ${runId}::uuid`.execute(target.db)
    ).rows[0]!;
    expect(r.out).toContain(
      `    lineage run ${runId}: ${run.e + 1} evaluations (expected ${run.e}), ${run.f} findings (expected ${run.f}), ` +
        `1 values_recalculated (expected 1), ${periodKeys.length} deviation_evaluated (expected ${periodKeys.length})`,
    );
    expect(r.out).toContain(`    unexplained added ${keyOf(runId)}`);
    expect(r.out).toContain(`    unexplained added ${keyOf(fake)}`);
  }, 300_000);
});

describe("T-R26: the catalogue check of the named lineage links (A4.2 'At run time')", () => {
  it("renaming kpi_evaluation_run_fkey gives exit 2 with the A4.7 line", async () => {
    await sql`ALTER TABLE kpi_evaluation RENAME CONSTRAINT kpi_evaluation_run_fkey TO kpi_evaluation_run_fkey_renamed`.execute(
      target.db,
    );
    try {
      const r = await recheck(allowance());
      expect(r.code).toBe(2);
      expect(r.err).toEqual([
        "reconcile-migration: refused: lineage link kpi_evaluation_run_fkey does not match the schema",
      ]);
    } finally {
      await sql`ALTER TABLE kpi_evaluation RENAME CONSTRAINT kpi_evaluation_run_fkey_renamed TO kpi_evaluation_run_fkey`.execute(
        target.db,
      );
    }
  }, 300_000);
});
