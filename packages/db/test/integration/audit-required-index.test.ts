// 0120 (T-DG6-BE-S; ADR-0058 §6; REQ-S20-029): p2_audit_required compares audit_event.record_type with
// TG_TABLE_NAME::text COLLATE "default", so the deferred audit check can use both leading keys of audit_event_record_idx
// (record_type, record_id, seq DESC; 0003) instead of scanning the whole index (DO-F run-1 EXPLAIN digest, statement 3).
// The check must accept and refuse exactly the rows 0010's version did: an audited write commits, an unaudited write
// and a write audited at another version or under another record type are refused with <table>_audit_required.
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { afterAll, describe, expect, it } from "vitest";
import { insertAuditEvent } from "../../src/audit.ts";
import { ownerRole, pgError } from "../helpers.ts";

const owner = ownerRole();
afterAll(async () => {
  await owner.close();
});

const actor = { actorType: "system", actorUserId: null, source: "cli" } as const;

/**
 * One transaction on a temporary table guarded by p2_audit_required exactly as the product tables are (a deferred
 * constraint trigger), so the probe touches no product table. `audit` names the record type and version to audit, or
 * null for none.
 */
async function write(table: string, version: number, audit: { recordType: string; version: number } | null) {
  const id = uuidv7();
  await owner.db.transaction().execute(async (tx) => {
    await sql`CREATE TEMP TABLE IF NOT EXISTS ${sql.id(table)} (id uuid PRIMARY KEY, version integer NOT NULL)`.execute(
      tx,
    );
    await sql`DROP TRIGGER IF EXISTS ${sql.id(`${table}_audit_required`)} ON ${sql.id(table)}`.execute(tx);
    await sql`CREATE CONSTRAINT TRIGGER ${sql.id(`${table}_audit_required`)} AFTER INSERT OR UPDATE ON ${sql.id(table)}
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p2_audit_required()`.execute(tx);
    await sql`INSERT INTO ${sql.id(table)} (id, version) VALUES (${id}::uuid, ${version})`.execute(tx);
    if (audit !== null)
      await insertAuditEvent(tx, actor, {
        action: `${audit.recordType}.create`,
        recordType: audit.recordType,
        recordId: id,
        organizationId: null,
        newVersion: audit.version,
      });
  });
  return id;
}

describe("0120: p2_audit_required uses audit_event_record_idx (T-DG6-BE-S)", () => {
  it('compares record_type with TG_TABLE_NAME::text COLLATE "default", and keeps 0010\'s message, code and constraint', async () => {
    const { rows } = await sql<{ def: string }>`SELECT pg_get_functiondef('p2_audit_required()'::regprocedure) AS def`
      .execute(owner.db)
      .then((r) => r);
    const def = rows[0]!.def;
    expect(def).toContain('a.record_type = TG_TABLE_NAME::text COLLATE "default" AND a.record_id = rid');
    expect(def).not.toMatch(/a\.record_type = TG_TABLE_NAME AND/);
    expect(def).toContain(
      "ERRCODE = 'integrity_constraint_violation', CONSTRAINT = TG_TABLE_NAME || '_audit_required'",
    );
  });

  it("an audited write commits (positive)", async () => {
    const id = await write("be_s_probe_ok", 1, { recordType: "be_s_probe_ok", version: 1 });
    const { rows } = await sql<{
      n: number;
    }>`SELECT count(*)::int AS n FROM be_s_probe_ok WHERE id = ${id}::uuid`.execute(owner.db);
    expect(rows[0]!.n).toBe(1);
  });

  it.each([
    ["no audit event", null],
    ["an audit event at another version", { recordType: "be_s_probe_no", version: 2 }],
    ["an audit event of another record type", { recordType: "be_s_probe_other", version: 1 }],
  ])("a write with %s is refused at commit (negative)", async (_label, audit) => {
    const err = await pgError(write("be_s_probe_no", 1, audit));
    expect(err.code).toBe("23000");
    expect(err.constraint).toBe("be_s_probe_no_audit_required");
    expect(err.message).toMatch(/^no audit_event for be_s_probe_no .* at version 1 \(ADR-0004/);
  });

  // The function body cannot be EXPLAINed from SQL, so these plan the same comparison with a `name` value, as
  // TG_TABLE_NAME is: 0120's form is an index condition on both leading keys; 0010's form (and a bare ::text, which
  // keeps the "C" collation of `name`) leaves record_type as a filter over the whole index (the run-1 evidence).
  async function planOf(recordTypeExpression: ReturnType<typeof sql>) {
    return owner.db.transaction().execute(async (tx) => {
      await sql`SET LOCAL enable_seqscan = off`.execute(tx);
      const r = await sql<{ "QUERY PLAN": string }>`EXPLAIN SELECT 1 FROM audit_event a
        WHERE a.record_type = ${recordTypeExpression} AND a.record_id = ${uuidv7()}::uuid AND a.new_version = 1`.execute(
        tx,
      );
      return r.rows.map((x) => x["QUERY PLAN"]).join("\n");
    });
  }

  it("0120's comparison is an index condition on both leading keys of audit_event_record_idx", async () => {
    const plan = await planOf(sql`${"saved_view"}::name::text COLLATE "default"`);
    expect(plan).toContain("audit_event_record_idx");
    expect(plan).toMatch(/Index Cond: \(\(record_type = 'saved_view'::text\) AND \(record_id = /);
  });

  it.each([
    ["0010's text = name", sql`${"saved_view"}::name`],
    ["a bare ::text (collation C)", sql`${"saved_view"}::name::text`],
  ])("negative control: %s leaves record_type out of the index condition", async (_label, expression) => {
    const plan = await planOf(expression);
    expect(plan).not.toMatch(/Index Cond: \(\(record_type = /);
    expect(plan).toMatch(/Filter: .*record_type = 'saved_view'/);
  });
});
