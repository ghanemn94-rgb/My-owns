// T-DG7-ARCH-02 guard probe (ADR-0064, ADR-0065; migrations 0133-0134): the state machines, write rules and audit rule
// of the P7 slice C/D tables, exercised on a real PostgreSQL as the runtime role (mth_app) and the owner role
// (mth_owner, which the migration CLI uses). Everything here is SYNTHETIC test data. Nothing here is a business
// approval (G1-G6) or touches DG0-DG7.
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRole, ownerRole, pgError } from "../helpers.ts";

const app = appRole();
const owner = ownerRole();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const HEX = "a".repeat(64);
const HEX2 = "b".repeat(64);
const LEVEL = "0135_p7_transfer_permissions";

async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

async function audit(c: PoolClient, recordType: string, recordId: string, version: number | null): Promise<void> {
  await c.query(
    `INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
     VALUES ($1, 'system', 'test.transfer_probe', $2, $3, $4, 'cli')`,
    [uuidv7(), recordType, recordId, version],
  );
}

let orgId: string;
let userId: string;
beforeAll(async () => {
  orgId = uuidv7();
  userId = uuidv7();
  const code = `P7PROBE${orgId.slice(-6).toUpperCase()}`;
  await owner.pool.query(`INSERT INTO organization (id, code, name_en, name_ar) VALUES ($1, $2, 'P7 probe', 'فحص')`, [
    orgId,
    code,
  ]);
  await owner.pool.query(`INSERT INTO app_user (id, organization_id, display_name) VALUES ($1, $2, 'P7 probe user')`, [
    userId,
    orgId,
  ]);
});

describe("0133 migration_export (ADR-0064 §7)", () => {
  async function queued(): Promise<string> {
    const id = uuidv7();
    await inTx(app.pool, async (c) => {
      await c.query(`INSERT INTO migration_export (id, requested_via, created_by) VALUES ($1, 'api', $2)`, [
        id,
        userId,
      ]);
      await audit(c, "migration_export", id, 1);
    });
    return id;
  }
  async function step(id: string, version: number, set: string, values: unknown[] = []): Promise<void> {
    await inTx(app.pool, async (c) => {
      await c.query(`UPDATE migration_export SET ${set}, version = ${version} WHERE id = $1`, [id, ...values]);
      await audit(c, "migration_export", id, version);
    });
  }

  it("queued -> running -> succeeded, with the counts and both checksums; then immutable", async () => {
    const id = await queued();
    await step(id, 2, "status = 'running', started_at = now()");
    await step(
      id,
      3,
      `status = 'succeeded', source_environment = 'production', migration_level = '${LEVEL}', table_count = 1,
       row_count = 2, attachment_count = 0, attachment_bytes = 0, manifest_sha256 = '${HEX}',
       attachment_manifest_sha256 = '${HEX2}', finished_at = now()`,
    );
    const err = await pgError(step(id, 4, "status = 'failed', failure_reason = 'x'"));
    expect(err.constraint).toBe("migration_export_terminal_immutable");
  });

  it("refuses a succeeded export without its checksums, and a demo checksum on a non-demo export (D-244 O2)", async () => {
    const id = await queued();
    await step(id, 2, "status = 'running', started_at = now()");
    expect((await pgError(step(id, 3, "status = 'succeeded', finished_at = now()"))).constraint).toBe(
      "migration_export_succeeded_shape",
    );
    const full = `status = 'succeeded', migration_level = '${LEVEL}', table_count = 1, row_count = 2,
      attachment_count = 0, attachment_bytes = 0, manifest_sha256 = '${HEX}', attachment_manifest_sha256 = '${HEX2}',
      finished_at = now()`;
    expect(
      (await pgError(step(id, 3, `${full}, source_environment = 'production', demo_checksum = '${HEX}'`))).constraint,
    ).toBe("migration_export_demo_checksum");
    expect((await pgError(step(id, 3, `${full}, source_environment = 'demo'`))).constraint).toBe(
      "migration_export_demo_checksum",
    );
    await step(id, 3, `${full}, source_environment = 'demo', demo_checksum = '${HEX}'`);
  });

  it("starts queued, never skips running to succeed, and needs its audit event", async () => {
    const bad = uuidv7();
    const err = await pgError(
      inTx(app.pool, async (c) => {
        await c.query(
          `INSERT INTO migration_export (id, status, requested_via, created_by) VALUES ($1, 'running', 'api', $2)`,
          [bad, userId],
        );
        await audit(c, "migration_export", bad, 1);
      }),
    );
    expect(err.constraint).toBe("migration_export_transition");
    const id = await queued();
    expect((await pgError(step(id, 2, `status = 'succeeded'`))).constraint).toBe("migration_export_transition");
    const noAudit = await pgError(
      app.pool.query(`INSERT INTO migration_export (id, requested_via, created_by) VALUES ($1, 'api', $2)`, [
        uuidv7(),
        userId,
      ]),
    );
    expect(noAudit.constraint).toBe("migration_export_audit_required");
  });

  it("mth_app cannot change the request columns or delete", async () => {
    const id = await queued();
    expect(
      (await pgError(app.pool.query(`UPDATE migration_export SET requested_via = 'cli' WHERE id = $1`, [id]))).code,
    ).toBe("42501");
    expect((await pgError(app.pool.query(`DELETE FROM migration_export WHERE id = $1`, [id]))).code).toBe("42501");
  });
});

describe("0133 imports, reconciliation and identity holds are written by the CLI (owner) only (ADR-0064 §6, §8)", () => {
  let importId: string;
  beforeAll(async () => {
    importId = uuidv7();
    await inTx(owner.pool, async (c) => {
      await c.query(
        `INSERT INTO migration_import (id, schema_version, source_environment, source_export_reference, migration_level,
           manifest_sha256, attachment_manifest_sha256, demo_checksum, table_count, row_count, attachment_count,
           attachment_bytes, operator_name, started_at, imported_at)
         VALUES ($1, 'mth-migration/1', 'demo', $2, $3, $4, $5, $4, 1, 2, 0, 0, 'probe operator', now(), now())`,
        [importId, uuidv7(), LEVEL, HEX, HEX2],
      );
      await audit(c, "migration_import", importId, null);
    });
  });

  it("mth_app reads but cannot write an import, a reconciliation or a hold", async () => {
    expect((await app.pool.query(`SELECT id FROM migration_import WHERE id = $1`, [importId])).rows).toHaveLength(1);
    for (const sql of [
      `INSERT INTO migration_import (id) VALUES ('${uuidv7()}')`,
      `INSERT INTO migration_reconciliation (id) VALUES ('${uuidv7()}')`,
      `INSERT INTO identity_binding_hold (id) VALUES ('${uuidv7()}')`,
      `INSERT INTO identity_rebind_event (id) VALUES ('${uuidv7()}')`,
      `INSERT INTO transfer_table_rule (table_name, rule, reason) VALUES ('x', 'exclude_derived', 'xyz')`,
    ])
      expect((await pgError(app.pool.query(sql))).code, sql).toBe("42501");
  });

  it("an import is append-only, even for the owner", async () => {
    const err = await pgError(
      owner.pool.query(`UPDATE migration_import SET operator_name = 'x' WHERE id = $1`, [importId]),
    );
    expect(err.message).toMatch(/append-only/);
  });

  it("a reconciliation's result must agree with its counts", async () => {
    const run = (result: string, mismatched: number) =>
      inTx(owner.pool, async (c) => {
        const id = uuidv7();
        await c.query(
          `INSERT INTO migration_reconciliation (id, migration_import_id, run_kind, result, tables_checked,
             tables_mismatched, rows_expected, rows_actual, attachments_checked, attachments_mismatched, operator_name, run_at)
           VALUES ($1, $2, 'recheck', $3, 2, $4, 2, 2, 0, 0, 'probe operator', now())`,
          [id, importId, result, mismatched],
        );
        await audit(c, "migration_reconciliation", id, null);
      });
    expect((await pgError(run("matched", 1))).constraint).toBe("migration_reconciliation_result");
    await run("mismatched", 1);
    await run("matched", 0);
  });

  it("a hold goes unbound -> rebound once; rebound is terminal", async () => {
    const holdId = uuidv7();
    await inTx(owner.pool, async (c) => {
      await c.query(`INSERT INTO identity_binding_hold (id, user_id, migration_import_id) VALUES ($1, $2, $3)`, [
        holdId,
        userId,
        importId,
      ]);
      await audit(c, "identity_binding_hold", holdId, 1);
    });
    const resolve = (state: string, version: number) =>
      inTx(owner.pool, async (c) => {
        await c.query(
          `UPDATE identity_binding_hold SET state = $2, mapping_sha256 = $3, operator_name = 'probe operator',
             resolved_at = now(), version = $4, updated_at = now() WHERE id = $1`,
          [holdId, state, HEX, version],
        );
        await audit(c, "identity_binding_hold", holdId, version);
      });
    await resolve("rebound", 2);
    expect((await pgError(resolve("retained", 3))).constraint).toBe("identity_binding_hold_transition");
  });
});

describe("T-R9: 0149 the import load's audit ranges and the recheck deltas (ADR-0064 A1.6; T-DG7-BE-R1)", () => {
  const insertImport = (c: PoolClient, id: string, ranges: (string | null)[]) =>
    c.query(
      `INSERT INTO migration_import (id, schema_version, source_environment, source_export_reference, migration_level,
         manifest_sha256, attachment_manifest_sha256, demo_checksum, table_count, row_count, attachment_count,
         attachment_bytes, operator_name, started_at, imported_at, audit_carried_rows, audit_carried_seq_max,
         audit_baseline_rows, audit_baseline_seq_min, audit_baseline_seq_max, audit_baseline_digest, seed_rows_replaced)
       VALUES ($1, 'mth-migration/1', 'unmarked', $2, $3, $4, $5, NULL, 1, 2, 0, 0, 'probe operator', now(), now(),
               $6, $7, $8, $9, $10, $11, $12)`,
      [id, uuidv7(), LEVEL, HEX, HEX2, ...ranges],
    );
  const withImport = (ranges: (string | null)[]) =>
    inTx(owner.pool, async (c) => {
      const id = uuidv7();
      await insertImport(c, id, ranges);
      await audit(c, "migration_import", id, null);
      return id;
    });

  it("migration_import_audit_ranges: all seven or none; the baseline strictly above the carried maximum", async () => {
    await withImport([null, null, null, null, null, null, null]);
    await withImport(["10", "10", "3", "11", "13", HEX, "5"]);
    await withImport(["0", "0", "0", null, null, HEX, "0"]);
    for (const partial of [
      ["10", "10", "3", "11", "13", null, "5"],
      ["10", null, null, null, null, null, null],
      ["10", "10", "0", "11", null, HEX, "5"],
      ["10", "10", "3", null, null, HEX, "5"],
    ])
      expect((await pgError(withImport(partial))).constraint, JSON.stringify(partial)).toBe(
        "migration_import_audit_ranges",
      );
    expect((await pgError(withImport(["10", "10", "3", "10", "13", HEX, "5"]))).constraint).toBe(
      "migration_import_audit_ranges",
    );
    expect((await pgError(withImport(["10", "10", "3", "12", "11", HEX, "5"]))).constraint).toBe(
      "migration_import_audit_ranges",
    );
  });

  it("recheck_after_use may count unequal rows when no table is disallowed; never with a disallowed table", async () => {
    const importId = await withImport([null, null, null, null, null, null, null]);
    const run = (kind: string, result: string, mismatched: number, expected: number, actual: number) =>
      inTx(owner.pool, async (c) => {
        const id = uuidv7();
        await c.query(
          `INSERT INTO migration_reconciliation (id, migration_import_id, run_kind, result, tables_checked,
             tables_mismatched, rows_expected, rows_actual, attachments_checked, attachments_mismatched, operator_name, run_at)
           VALUES ($1, $2, $3, $4, 2, $5, $6, $7, 0, 0, 'probe operator', now())`,
          [id, importId, kind, result, mismatched, expected, actual],
        );
        await audit(c, "migration_reconciliation", id, null);
        return id;
      });
    await run("recheck_after_use", "matched", 0, 2, 5);
    expect((await pgError(run("recheck_after_use", "matched", 1, 2, 5))).constraint).toBe(
      "migration_reconciliation_result",
    );
    expect((await pgError(run("recheck", "matched", 0, 2, 5))).constraint).toBe("migration_reconciliation_result");
    expect((await pgError(run("other", "matched", 0, 2, 2))).constraint).toBe(
      "migration_reconciliation_run_kind_check",
    );
  });

  it("migration_reconciliation_delta is append-only; mth_app reads it and cannot insert; unexplained is never allowed", async () => {
    const importId = await withImport([null, null, null, null, null, null, null]);
    const runId = await inTx(owner.pool, async (c) => {
      const id = uuidv7();
      await c.query(
        `INSERT INTO migration_reconciliation (id, migration_import_id, run_kind, result, tables_checked,
           tables_mismatched, rows_expected, rows_actual, attachments_checked, attachments_mismatched, operator_name, run_at)
         VALUES ($1, $2, 'recheck', 'matched', 1, 0, 1, 1, 0, 0, 'probe operator', now())`,
        [id, importId],
      );
      await audit(c, "migration_reconciliation", id, null);
      return id;
    });
    const delta = (basis: string, allowed: boolean, pool = owner.pool) =>
      pool.query(
        `INSERT INTO migration_reconciliation_delta (migration_reconciliation_id, table_name, basis, rows_added,
           rows_changed, rows_missing, allowed) VALUES ($1, 'audit_event', $2, 3, 0, 0, $3)`,
        [runId, basis, allowed],
      );
    await delta("audit_additions", true);
    expect((await pgError(delta("unexplained", true))).constraint).toBe("migration_reconciliation_delta_unexplained");
    expect((await pgError(delta("rebind", true, app.pool))).code).toBe("42501");
    expect(
      (
        await app.pool.query(
          `SELECT basis FROM migration_reconciliation_delta WHERE migration_reconciliation_id = $1`,
          [runId],
        )
      ).rows,
    ).toEqual([{ basis: "audit_additions" }]);
    for (const sql of [
      `UPDATE migration_reconciliation_delta SET allowed = false WHERE migration_reconciliation_id = '${runId}'`,
      `DELETE FROM migration_reconciliation_delta WHERE migration_reconciliation_id = '${runId}'`,
    ])
      expect((await pgError(owner.pool.query(sql))).message, sql).toMatch(/append-only/);
  });

  it("transfer_table_rule has the new row: the delta table never travels", async () => {
    const r = await owner.pool.query(
      `SELECT rule, reason FROM transfer_table_rule WHERE table_name = 'migration_reconciliation_delta'`,
    );
    expect(r.rows).toEqual([
      { rule: "exclude_transfer", reason: "Written by the import and the rechecks on the target" },
    ]);
  });
});

describe("T-R9: 0150 the shared migration audit events and the nine delta bases (ADR-0064 A2.4; T-DG7-BE-R2)", () => {
  const withImport = (ranges: (string | null)[], present: string | null) =>
    inTx(owner.pool, async (c) => {
      const id = uuidv7();
      await c.query(
        `INSERT INTO migration_import (id, schema_version, source_environment, source_export_reference, migration_level,
           manifest_sha256, attachment_manifest_sha256, demo_checksum, table_count, row_count, attachment_count,
           attachment_bytes, operator_name, started_at, imported_at, audit_carried_rows, audit_carried_seq_max,
           audit_baseline_rows, audit_baseline_seq_min, audit_baseline_seq_max, audit_baseline_digest, seed_rows_replaced,
           audit_already_present_rows)
         VALUES ($1, 'mth-migration/1', 'unmarked', $2, $3, $4, $5, NULL, 1, 2, 0, 0, 'probe operator', now(), now(),
                 $6, $7, $8, $9, $10, $11, $12, $13)`,
        [id, uuidv7(), LEVEL, HEX, HEX2, ...ranges, present],
      );
      await audit(c, "migration_import", id, null);
      return id;
    });
  const RANGES = ["10", "10", "3", "11", "13", HEX, "5"];

  it("migration_import_audit_present: NULL, or 0..min(carried, baseline) with the carried rows recorded", async () => {
    await withImport(RANGES, null);
    await withImport(RANGES, "0");
    await withImport(RANGES, "3");
    for (const bad of ["-1", "4"])
      expect((await pgError(withImport(RANGES, bad))).constraint, bad).toBe("migration_import_audit_present");
    expect((await pgError(withImport(["2", "10", "3", "11", "13", HEX, "5"], "3"))).constraint).toBe(
      "migration_import_audit_present",
    );
    expect((await pgError(withImport([null, null, null, null, null, null, null], "0"))).constraint).toBe(
      "migration_import_audit_present",
    );
  });

  it("migration_reconciliation_delta.basis takes exactly the nine A2.4 values", async () => {
    const importId = await withImport(RANGES, "0");
    const runId = await inTx(owner.pool, async (c) => {
      const id = uuidv7();
      await c.query(
        `INSERT INTO migration_reconciliation (id, migration_import_id, run_kind, result, tables_checked,
           tables_mismatched, rows_expected, rows_actual, attachments_checked, attachments_mismatched, operator_name, run_at)
         VALUES ($1, $2, 'recheck', 'matched', 1, 0, 1, 1, 0, 0, 'probe operator', now())`,
        [id, importId],
      );
      await audit(c, "migration_reconciliation", id, null);
      return id;
    });
    const delta = (table: string, basis: string, allowed: boolean) =>
      owner.pool.query(
        `INSERT INTO migration_reconciliation_delta (migration_reconciliation_id, table_name, basis, rows_added,
           rows_changed, rows_missing, allowed) VALUES ($1, $2, $3, 0, 1, 0, $4)`,
        [runId, table, basis, allowed],
      );
    const nine = [
      "audit_baseline",
      "audit_additions",
      "audit_already_present",
      "rebind",
      "exact_ids",
      "audit_explained",
      "child_of",
      "operational",
      "unexplained",
    ];
    for (const b of nine) await delta("audit_event", b, b !== "unexplained");
    expect((await pgError(delta("audit_event", "renumbered", true))).constraint).toBe(
      "migration_reconciliation_delta_basis_check",
    );
    const r = await owner.pool.query(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'migration_reconciliation_delta_basis_check'`,
    );
    for (const b of nine) expect(r.rows[0].d).toContain(`'${b}'`);
  });
});

describe("0134 configuration bundle imports (ADR-0065 §4)", () => {
  async function uploaded(): Promise<string> {
    const id = uuidv7();
    await inTx(app.pool, async (c) => {
      await c.query(
        `INSERT INTO config_bundle_import (id, organization_id, bundle_schema_version, source_environment, file_name,
           byte_size, sha256, item_count, created_by)
         VALUES ($1, $2, 'mth-config-bundle/1', 'demo', 'bundle.json', 10, $3, 1, $4)`,
        [id, orgId, HEX, userId],
      );
      await audit(c, "config_bundle_import", id, 1);
    });
    return id;
  }
  async function validate(id: string, version: number, status: string, conflicts: number, no: number): Promise<void> {
    await inTx(app.pool, async (c) => {
      await c.query(
        `UPDATE config_bundle_import SET status = $2, validation_no = $3, items_create = 1, items_new_draft = 0,
           items_identical = 0, items_conflict = $4, items_refused = 0, validated_at = now(), validated_by = $5,
           version = $6, updated_at = now(), updated_by = $5 WHERE id = $1`,
        [id, status, no, conflicts, userId, version],
      );
      await audit(c, "config_bundle_import", id, version);
    });
  }

  it("refuses an unknown bundle schema version in the database too", async () => {
    const id = uuidv7();
    const err = await pgError(
      app.pool.query(
        `INSERT INTO config_bundle_import (id, organization_id, bundle_schema_version, source_environment, file_name,
           byte_size, sha256, item_count, created_by)
         VALUES ($1, $2, 'mth-config-bundle/2', 'demo', 'bundle.json', 10, $3, 1, $4)`,
        [id, orgId, HEX, userId],
      ),
    );
    expect(err.code).toBe("23514");
  });

  it("uploaded -> validated -> committed; a validated import with a conflict is refused; committed is terminal", async () => {
    const id = await uploaded();
    expect((await pgError(validate(id, 2, "validated", 1, 1))).constraint).toBe("config_bundle_import_committable");
    await validate(id, 2, "validated", 0, 1);
    await validate(id, 3, "validated", 0, 2);
    const commit = (version: number) =>
      inTx(app.pool, async (c) => {
        await c.query(
          `UPDATE config_bundle_import SET status = 'committed', committed_at = now(), committed_by = $2, version = $3,
             updated_at = now(), updated_by = $2 WHERE id = $1`,
          [id, userId, version],
        );
        await audit(c, "config_bundle_import", id, version);
      });
    await commit(4);
    expect((await pgError(commit(5))).constraint).toBe("config_bundle_import_terminal_immutable");
  });

  it("validation_no steps by one per run; items are append-only; only drafting items are committed", async () => {
    const id = await uploaded();
    expect((await pgError(validate(id, 2, "validated", 0, 2))).constraint).toBe("config_bundle_import_validation_step");
    await validate(id, 2, "validated", 0, 1);
    const item = uuidv7();
    const identical = uuidv7();
    await app.pool.query(
      `INSERT INTO config_bundle_import_item (id, config_bundle_import_id, validation_no, ordinal, kind, item_code,
         source_version_no, content_sha256, action)
       VALUES ($1, $3, 1, 1, 'methodology', 'playbook', 1, $4, 'create_draft'),
              ($2, $3, 1, 2, 'form_schema', 'charter', 1, $4, 'identical')`,
      [item, identical, id, HEX],
    );
    expect(
      (await pgError(app.pool.query(`UPDATE config_bundle_import_item SET ordinal = 3 WHERE id = $1`, [item]))).message,
    ).toMatch(/append-only|permission denied/);
    expect(
      (
        await pgError(
          app.pool.query(
            `INSERT INTO config_bundle_import_commit (config_bundle_import_item_id, target_record_type, target_record_id)
             VALUES ($1, 'methodology_version', $2)`,
            [identical, uuidv7()],
          ),
        )
      ).constraint,
    ).toBe("config_bundle_import_commit_action");
    await app.pool.query(
      `INSERT INTO config_bundle_import_commit (config_bundle_import_item_id, target_record_type, target_record_id)
       VALUES ($1, 'methodology_version', $2)`,
      [item, uuidv7()],
    );
    const problem = await pgError(
      app.pool.query(
        `INSERT INTO config_bundle_import_item (id, config_bundle_import_id, validation_no, ordinal, kind, item_code,
           content_sha256, action)
         VALUES ($1, $2, 1, 3, 'branding', 'org', $3, 'conflict')`,
        [uuidv7(), id, HEX],
      ),
    );
    expect(problem.constraint).toBe("config_bundle_import_item_problem");
  });
});
