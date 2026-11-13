// Mode 2 explanations for worker automation rows and code counters on PostgreSQL (ADR-0064 Amendment 3 §A3.2, §A3.3;
// p7-work-split §C.14; REQ-S19-014, REQ-S19-017; T-DG7-BE-R3): T-R19 (the automation chain) and T-R20 (the counter
// basis). Source: a scratch database seeded with the SYNTHETIC demo dataset; target: a scratch database prepared with
// the reservation and loaded by import-migration. The API's and the worker's transactions are reproduced here as SQL
// with the same shape (see the handback, "Known gaps"): an API mutation writes its row, its audit event and its outbox
// row in one transaction (equal now()); a worker job writes the execution and its effects as service events under
// request_id `job:<id>` (apps/worker/src/kit.ts jobActor). Every value is synthetic. Nothing here approves anything
// (no G1-G6, Finance or IT approval) or touches DG0-DG7.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "../../src/pool.ts";
import {
  ALLOWANCE_SCHEMA_VERSION,
  runReconcileMigrationCommand,
  type RecheckJsonReport,
} from "../../src/transfer/index.ts";
import { testDatabase } from "../helpers.ts";
import { importInto, RoundtripWorkspace, type RoundtripScratch } from "./transfer-roundtrip.fixture.ts";

const { adminUrl } = testDatabase();
const ws = new RoundtripWorkspace(adminUrl);
let target: RoundtripScratch;
let pkg: string;
let dir: string;
let actor: string;
let other: string;
let tf1: { id: string; org: string };

async function recheck(
  allow: unknown,
): Promise<{ code: number; out: string[]; err: string[]; json: RecheckJsonReport }> {
  const out: string[] = [];
  const err: string[] = [];
  const file = join(dir, `allow-${uuidv7()}.json`);
  writeFileSync(file, JSON.stringify(allow));
  const report = join(dir, `report-${uuidv7()}.txt`);
  const code = await runReconcileMigrationCommand(
    target.db,
    { operator: "Synthetic IT operator", afterUse: true, from: pkg, allow: file, report },
    { out: (l) => out.push(l), err: (l) => err.push(l) },
  );
  const json =
    code === 0 || code === 4 ? (JSON.parse(readFileSync(`${report}.json`, "utf8")) as RecheckJsonReport) : null;
  return { code, out, err, json: json! };
}

const allowance = (over: Record<string, unknown> = {}) => ({
  schemaVersion: ALLOWANCE_SCHEMA_VERSION,
  actors: [actor],
  tables: [],
  audited: [],
  children: [],
  counters: [],
  lineage: [],
  operational: ["outbox_event"],
  ...over,
});
const audited = (...names: string[]) => names.map((name) => ({ name, mustInclude: { added: [], changed: [] } }));

/** An audit event in `tx` (occurred_at is the column default, now(): the transaction timestamp). */
async function event(
  tx: Tx,
  e: {
    by: string | null;
    org: string | null;
    action: string;
    recordType: string;
    recordId: string;
    newVersion: number | null;
    job?: string;
  },
): Promise<void> {
  await tx
    .insertInto("audit_event")
    .values({
      id: uuidv7(),
      actor_type: e.by === null ? "service" : "user",
      actor_user_id: e.by,
      organization_id: e.org,
      action: e.action,
      record_type: e.recordType,
      record_id: e.recordId,
      prior_version: e.newVersion === null || e.newVersion === 1 ? null : e.newVersion - 1,
      new_version: e.newVersion,
      request_id: e.job === undefined ? null : `job:${e.job}`,
      source: e.by === null ? "worker" : "api",
    })
    .execute();
}

/**
 * The API's shape: `by` bumps the transformation's version with its audit event, and the same transaction writes an
 * outbox row on that aggregate (equal now()). Returns the outbox idempotency key.
 */
async function apiMutation(tf: { id: string; org: string }, by: string, eventType: string): Promise<string> {
  const key = `synthetic:${uuidv7()}`;
  await target.db.transaction().execute(async (tx) => {
    const v = (
      await sql<{ version: number }>`UPDATE transformation SET version = version + 1 WHERE id = ${tf.id}::uuid
        RETURNING version`.execute(tx)
    ).rows[0]!.version;
    await event(tx, {
      by,
      org: tf.org,
      action: "transformation.update",
      recordType: "transformation",
      recordId: tf.id,
      newVersion: v,
    });
    await sql`INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type, schema_version,
                payload, idempotency_key)
              VALUES (${uuidv7()}::uuid, ${tf.org}::uuid, 'transformation', ${tf.id}::uuid, ${eventType}, 1,
                      ${JSON.stringify({ transformationId: tf.id, createdBy: by })}::jsonb, ${key})`.execute(tx);
  });
  return key;
}

/**
 * The worker's shape: one job (`job:<jobId>`) records an execution of the published version of `triggerCode` with the
 * trigger link `triggerKey`, and its first action's result, as service events. Returns the execution and result ids.
 */
async function workerJob(
  tf: { id: string; org: string },
  triggerCode: string,
  triggerKey: string,
  payload: Record<string, unknown>,
  initiatingUser: string | null = null,
): Promise<{ execution: string; result: string }> {
  const job = uuidv7();
  const execution = uuidv7();
  const result = uuidv7();
  await target.db.transaction().execute(async (tx) => {
    const v = (
      await sql<{ rule: string; version: string; action: string }>`
        SELECT v.automation_rule_id::text AS rule, v.id::text AS version, c.code AS action
          FROM automation_rule_version v
          JOIN automation_action_type c ON c.code = ANY(v.action_types) AND c.action_class <> 'human_only'
         WHERE v.status = 'published' AND ${triggerCode} = ANY(v.trigger_codes)
         ORDER BY v.id, c.code LIMIT 1`.execute(tx)
    ).rows[0];
    if (v === undefined) throw new Error(`no published automation version for ${triggerCode}`);
    await tx
      .insertInto("automation_execution")
      .values({
        id: execution,
        automation_rule_id: v.rule,
        automation_rule_version_id: v.version,
        trigger_code: triggerCode,
        trigger_key: triggerKey,
        trigger_payload: JSON.stringify(payload),
        organization_id: tf.org,
        transformation_id: tf.id,
        run_as: initiatingUser === null ? "service" : "initiating_user",
        initiating_user_id: initiatingUser,
      } as never)
      .execute();
    await event(tx, {
      by: null,
      org: tf.org,
      action: "automation_execution.create",
      recordType: "automation_execution",
      recordId: execution,
      newVersion: 1,
      job,
    });
    await tx
      .insertInto("automation_action_result")
      .values({
        id: result,
        automation_execution_id: execution,
        attempt_no: 1,
        ordinal: 1,
        action_type: v.action,
        idempotency_key: `synthetic:${result}`,
        outcome: "skipped",
      } as never)
      .execute();
    await event(tx, {
      by: null,
      org: tf.org,
      action: "automation_action_result.create",
      recordType: "automation_action_result",
      recordId: result,
      newVersion: null,
      job,
    });
  });
  return { execution, result };
}

beforeAll(async () => {
  const source = await ws.demoSource("mth_ra_source");
  const exported = await ws.exportPackage(source.db);
  pkg = exported.dir;
  dir = ws.tempDir("mth-recheck-automation-");
  target = await ws.reserved("mth_ra_target", pkg);
  const r = await importInto(target.db, pkg);
  if (r.code !== 0) throw new Error(`import failed: ${r.err.join("\n")}`);
  const users = await target.db.selectFrom("app_user").select("id").orderBy("id").limit(2).execute();
  actor = users[0]!.id;
  other = users[1]!.id;
  const tf = await target.db
    .selectFrom("transformation")
    .select(["id", "organization_id"])
    .orderBy("id")
    .executeTakeFirstOrThrow();
  tf1 = { id: tf.id, org: tf.organization_id };
}, 900_000);

afterAll(async () => {
  await ws.close();
}, 120_000);

const AUTOMATION = ["automation_execution", "automation_action_result"];
/** transformation has no _audit_required trigger (it predates the P2 guards), so its changed row is an exact key. */
const transformationChanged = () => [{ name: "transformation", added: [], changed: [[tf1.id]] }];

describe("T-R19: the automation chain (A3.2)", () => {
  let positive: { execution: string; result: string };
  let positiveKey: string;

  it("a journalled actor's mutation chains its starter execution and the job's rows (audit_explained)", async () => {
    positiveKey = await apiMutation(tf1, actor, "transformation.created");
    positive = await workerJob(tf1, "transformation.created", positiveKey, { createdBy: actor });
    const r = await recheck(allowance({ tables: transformationChanged(), audited: audited(...AUTOMATION) }));
    expect(r.err, r.out.join("\n")).toEqual([]);
    expect(r.code, r.out.join("\n")).toBe(0);
    for (const t of ["automation_execution", "automation_action_result"])
      expect(r.json.deltas.find((d) => d.tableName === t)).toMatchObject({
        basis: "audit_explained",
        rowsAdded: "1",
        allowed: true,
      });
    expect(r.json.automationChain).toHaveLength(1);
    const link = r.json.automationChain[0]!;
    expect(link).toMatchObject({
      executionId: positive.execution,
      triggerCode: "transformation.created",
      triggerKey: positiveKey,
      linkRecordType: "transformation",
      linkRecordId: tf1.id,
    });
    expect(link.requestIds).toHaveLength(1);
    expect(link.requestIds[0]).toMatch(/^job:/);
    // The link event and the outbox row carry the same timestamptz (compared in SQL, to the microsecond).
    const same = await sql<{ eq: boolean }>`
      SELECT a.occurred_at = o.created_at AS eq FROM audit_event a, outbox_event o
       WHERE a.id = ${link.linkEventId}::uuid AND o.id = ${link.outboxEventId}::uuid`.execute(target.db);
    expect(same.rows[0]!.eq).toBe(true);
    const exec = r.json.audited.find((a) => a.table === "automation_execution")!;
    expect(exec).toMatchObject({ explainingEventsByActor: 0, explainingEventsByAutomation: 1 });
    expect(r.json.deltas.find((d) => d.tableName === "transformation")).toMatchObject({
      basis: "exact_ids",
      allowed: true,
    });
  }, 600_000);

  it("negatives 1-4: an off-by-a-microsecond outbox row, a non-journalled user, a foreign recorded user and a schedule trigger leave their executions unexplained", async () => {
    // Negative 2: the same API shape, signed in as a user not in actors.
    const k2 = await apiMutation(tf1, other, "transformation.created");
    const n2 = await workerJob(tf1, "transformation.created", k2, { createdBy: other });
    // Negative 1: an owner-inserted outbox row on the same aggregate, created one microsecond after the positive link.
    const k1 = `synthetic:${uuidv7()}`;
    await sql`INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type, schema_version,
                payload, idempotency_key, created_at)
              SELECT ${uuidv7()}::uuid, o.organization_id, o.aggregate_type, o.aggregate_id, o.event_type, 1,
                     o.payload, ${k1}, o.created_at + interval '1 microsecond'
                FROM outbox_event o WHERE o.idempotency_key = ${positiveKey}`.execute(target.db);
    const n1 = await workerJob(tf1, "transformation.created", k1, { createdBy: actor });
    // Negative 3: the trigger link holds (the actor's mutation), the recorded user (createdBy) is not journalled.
    const k3 = await apiMutation(tf1, actor, "transformation.created");
    const n3 = await workerJob(tf1, "transformation.created", k3, { createdBy: other });
    // Negative 3 again with initiating_user_id (run_as initiating_user) not journalled.
    const k3b = await apiMutation(tf1, actor, "transformation.created");
    const n3b = await workerJob(tf1, "transformation.created", k3b, { createdBy: actor }, other);
    // Negative 4: a schedule trigger, even with an outbox row linked to the actor's mutation.
    const schedule = (
      await sql<{ code: string }>`
        SELECT t.code FROM automation_trigger t
         WHERE t.trigger_kind = 'schedule' AND EXISTS (SELECT 1 FROM automation_rule_version v
                 WHERE v.status = 'published' AND t.code = ANY(v.trigger_codes))
         ORDER BY t.code LIMIT 1`.execute(target.db)
    ).rows[0]!.code;
    const k4 = await apiMutation(tf1, actor, schedule);
    const n4 = await workerJob(tf1, schedule, k4, {});
    const r = await recheck(allowance({ tables: transformationChanged(), audited: audited(...AUTOMATION) }));
    expect(r.code, r.out.join("\n")).toBe(4);
    expect(r.json.automationChain.map((l) => l.executionId)).toEqual([positive.execution]);
    for (const n of [n1, n2, n3, n3b, n4]) {
      expect(r.out).toContain(`    unexplained added ${JSON.stringify([n.execution])}`);
      expect(r.out).toContain(`    unexplained added ${JSON.stringify([n.result])}`);
    }
    for (const id of [positive.execution, positive.result])
      expect(r.out).not.toContain(`    unexplained added ${JSON.stringify([id])}`);
    expect(r.out).toContain("  automation_execution: 6 added, 0 changed, 0 missing (audit_explained)");
    // The transformation's own difference is still the listed exact key.
    expect(r.json.deltas.find((d) => d.tableName === "transformation")).toMatchObject({ allowed: true });
  }, 600_000);
});

describe("T-R20: the counter basis (A3.3)", () => {
  const counterValue = async (tf: string, prefix: string): Promise<number> =>
    Number(
      (
        await sql<{ v: number }>`SELECT last_value AS v FROM record_code_counter
          WHERE transformation_id = ${tf}::uuid AND prefix = ${prefix}`.execute(target.db)
      ).rows[0]?.v ?? 0,
    );
  const bump = async (tx: Tx, tf: string, prefix: string): Promise<number> =>
    (
      await sql<{ v: number }>`
        INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${tf}::uuid, ${prefix}, 1)
        ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
        RETURNING last_value AS v`.execute(tx)
    ).rows[0]!.v;
  /** A RAID row by `by`, with its audit event; `n` given means the counter is not moved (the inverse case). */
  const raid = async (
    tf: { id: string; org: string },
    by: string,
    type: "risk" | "assumption" | "issue",
    opts: { bumps?: number; n?: number } = {},
  ): Promise<string> => {
    const prefix = { risk: "R", assumption: "A", issue: "I" }[type];
    const id = uuidv7();
    let code = "";
    await target.db.transaction().execute(async (tx) => {
      let n = opts.n ?? 0;
      for (let i = 0; i < (opts.bumps ?? (opts.n === undefined ? 1 : 0)); i++) {
        const v = await bump(tx, tf.id, prefix);
        if (i === 0 && opts.n === undefined) n = v;
      }
      code = `${prefix}-${String(n).padStart(2, "0")}`;
      await sql`INSERT INTO raid_entry (id, organization_id, transformation_id, entry_type, code, description, impact,
                  probability, owner_user_id, created_by, updated_by)
                VALUES (${id}::uuid, ${tf.org}::uuid, ${tf.id}::uuid, ${type}, ${code},
                        'SYNTHETIC transfer recheck test entry', 'low', ${type === "risk" ? "low" : null},
                        ${by}::uuid, ${by}::uuid, ${by}::uuid)`.execute(tx);
      await event(tx, {
        by,
        org: tf.org,
        action: "raid_entry.create",
        recordType: "raid_entry",
        recordId: id,
        newVersion: 1,
      });
    });
    return code;
  };
  const key = (tf: string, p: string) => JSON.stringify([tf, p]);
  let iPackage = 0;
  const allow = () =>
    allowance({
      tables: transformationChanged(),
      audited: audited(...AUTOMATION, "raid_entry"),
      counters: ["record_code_counter"],
    });

  it("one RAID issue by a journalled actor moves I by one and is explained", async () => {
    const before = await counterValue(tf1.id, "I");
    iPackage = before;
    await raid(tf1, actor, "issue");
    const r = await recheck(allow());
    const c = r.json.counters.find((x) => x.key === key(tf1.id, "I"))!;
    expect(c).toEqual({
      table: "record_code_counter",
      key: key(tf1.id, "I"),
      old: before,
      new: before + 1,
      codes: [before + 1],
      explained: true,
    });
    expect(r.json.deltas.find((d) => d.tableName === "record_code_counter")).toMatchObject({
      basis: "counter",
      allowed: true,
    });
    // T-R19's negatives are still present, so the run as a whole is a mismatch; the counter row is not among them.
    expect(r.out.some((l) => l.startsWith("    counter "))).toBe(false);
  }, 600_000);

  it("a counter moved by 2 for one row, moved with no row, moved by an unexplained row, a row without its step and an unmapped prefix are unexplained", async () => {
    // A: moved by 2 for one explained row.
    const a0 = await counterValue(tf1.id, "A");
    await raid(tf1, actor, "assumption", { bumps: 2 });
    // CR: moved with no coded row.
    const c0 = await counterValue(tf1.id, "CR");
    await target.db.transaction().execute(async (tx) => {
      await bump(tx, tf1.id, "CR");
    });
    // I: a second issue by the non-journalled user moves the counter again; its row is unexplained.
    await raid(tf1, other, "issue");
    // R: an explained coded row whose counter did not move (A3.3 item 5).
    const r0 = await counterValue(tf1.id, "R");
    await raid(tf1, actor, "risk", { n: r0 + 1 });
    // B: an unmapped prefix that changed.
    const b0 = await counterValue(tf1.id, "B");
    await target.db.transaction().execute(async (tx) => {
      await bump(tx, tf1.id, "B");
    });
    const r = await recheck(allow());
    expect(r.code).toBe(4);
    const delta = r.json.deltas.find((d) => d.tableName === "record_code_counter")!;
    expect(delta).toMatchObject({ basis: "counter", allowed: false });
    expect(r.out).toContain(
      `  record_code_counter: ${delta.rowsAdded} added, ${delta.rowsChanged} changed, 0 missing (counter)`,
    );
    const line = (p: string, o: number, n: number, codes: number[]) =>
      `    counter ${key(tf1.id, p)}: moved ${o} -> ${n}, ${codes.length} new coded rows (${
        codes.length === 0 ? "none" : codes.join(", ")
      })`;
    expect(r.out, r.out.join("\n")).toContain(line("A", a0, a0 + 2, [a0 + 1]));
    expect(r.out, r.out.join("\n")).toContain(line("CR", c0, c0 + 1, []));
    expect(r.out, r.out.join("\n")).toContain(line("I", iPackage, iPackage + 2, [iPackage + 1]));
    expect(r.out, r.out.join("\n")).toContain(line("R", r0, r0, [r0 + 1]));
    expect(r.out, r.out.join("\n")).toContain(line("B", b0, b0 + 1, []));
    for (const p of ["A", "CR", "I", "R", "B"])
      expect(r.json.counters.find((x) => x.key === key(tf1.id, p))!.explained, p).toBe(false);
  }, 600_000);
});
