// P7 contract exercises of BE-D (p7-work-split §C.2, §C.6; §2 rule 1 with p6-work-split §2 rule 16; T-DG7-BE-D): the
// five read-only migration-import operations, each with its success and the declared refusals it can reach, through
// the contract-validating client `mirrored` (success bodies also checked against the zod mirrors below).
//
// The import itself is CLI-only (mth-db import-migration) and writes into an EMPTY database, which the shared contract
// database is not, so `seedSyntheticImport` writes what an import records (the migration_import row, an `import` and a
// `recheck` reconciliation run with their table and attachment rows, two identity holds of two NEW synthetic users, one
// still unbound and one rebound with its rebind event) as the owner role, with the audit events 0133's
// p2_audit_required demands. No existing user is held, so no other suite's sign-in changes. Every value is SYNTHETIC;
// the digests are SHA-256 values of fixed synthetic strings. Reading these approves nothing (no G1-G6, Finance or IT
// approval) and touches no DG0-DG7 record.
import { createHash } from "node:crypto";
import type { Db } from "@mth/db";
import type pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import {
  identityRebindPage,
  migrationImportPage,
  migrationImportView,
  reconciliationPage,
  reconciliationView,
} from "../../../src/modules/transfer/import/service.ts";
import { createUser, signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P7_MIRRORS_BE_D: Readonly<Record<string, z.ZodType>> = {
  listMigrationImports: migrationImportPage,
  getMigrationImport: migrationImportView,
  listMigrationReconciliations: reconciliationPage,
  getMigrationReconciliation: reconciliationView,
  listIdentityRebinds: identityRebindPage,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const IMPORTS = "/api/v1/admin/migration-imports";
const REBINDS = "/api/v1/admin/identity-rebinds";
const MISSING = "01900000-0000-7000-8000-00000000d0d0";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");

export interface SyntheticImport {
  readonly importId: string;
  readonly importRunId: string;
  readonly recheckRunId: string;
  readonly unbound: { readonly id: string; readonly subject: string; readonly holdId: string };
  readonly rebound: { readonly id: string; readonly subject: string; readonly holdId: string };
}

async function audit(
  c: pg.PoolClient,
  recordType: string,
  recordId: string,
  action: string,
  versions: { prior: number | null; next: number | null } = { prior: null, next: null },
) {
  await c.query(
    `INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source, reason)
     VALUES ($1, 'system', $2, $3, $4, $5, $6, 'cli', 'Synthetic test fixture of a migration import')`,
    [uuidv7(), action, recordType, recordId, versions.prior, versions.next],
  );
}

/** Writes a SYNTHETIC recorded import (see the header) as the owner role; `db` (mth_app) creates the two users. */
export async function seedSyntheticImport(owner: pg.Pool, db: Db, organizationId: string): Promise<SyntheticImport> {
  const unboundUser = await createUser(db, organizationId);
  const reboundUser = await createUser(db, organizationId);
  const importId = uuidv7();
  const importRunId = uuidv7();
  const recheckRunId = uuidv7();
  const unboundHold = uuidv7();
  const reboundHold = uuidv7();
  const c = await owner.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO migration_import (id, schema_version, source_environment, source_export_reference, migration_level,
         manifest_sha256, attachment_manifest_sha256, demo_checksum, table_count, row_count, attachment_count,
         attachment_bytes, operator_name, started_at, imported_at, audit_carried_rows, audit_carried_seq_max,
         audit_baseline_rows, audit_baseline_seq_min, audit_baseline_seq_max, audit_baseline_digest, seed_rows_replaced,
         audit_already_present_rows)
       VALUES ($1, 'mth-migration/1', 'demo', $2, '0148_p7_retention_job', $3, $4, $5, 2, 7, 1, 11,
         'Synthetic operator', now() - interval '1 minute', now(), 40, 52, 60, 53, 112, $6, 9, 3)`,
      [
        importId,
        uuidv7(),
        digest("synthetic manifest"),
        digest("synthetic attachments"),
        digest("synthetic demo"),
        digest("synthetic baseline"),
      ],
    );
    await audit(c, "migration_import", importId, "migration.imported");
    await c.query(
      `INSERT INTO migration_reconciliation (id, migration_import_id, run_kind, result, tables_checked, tables_mismatched,
         rows_expected, rows_actual, attachments_checked, attachments_mismatched, operator_name, run_at)
       VALUES ($1, $2, 'import', 'matched', 2, 0, 7, 7, 1, 0, 'Synthetic operator', now() - interval '30 seconds'),
              ($3, $2, 'recheck', 'mismatched', 2, 1, 7, 6, 1, 1, 'Synthetic operator', now())`,
      [importRunId, importId, recheckRunId],
    );
    await audit(c, "migration_reconciliation", importRunId, "migration.reconciled");
    await audit(c, "migration_reconciliation", recheckRunId, "migration.reconciled");
    await c.query(
      `INSERT INTO migration_reconciliation_table (migration_reconciliation_id, table_name, expected_rows, actual_rows,
         expected_digest, actual_digest, matched)
       VALUES ($1, 'organization', 1, 1, $3, $3, true), ($1, 'app_user', 6, 6, $4, $4, true),
              ($2, 'organization', 1, 1, $3, $3, true), ($2, 'app_user', 6, 5, $4, $5, false)`,
      [importRunId, recheckRunId, digest("org rows"), digest("user rows"), digest("user rows changed")],
    );
    // T-R12: two delta rows of the recheck (ADR-0064 A1.6, A2.4; the counter basis of A3.5).
    await c.query(
      `INSERT INTO migration_reconciliation_delta (migration_reconciliation_id, table_name, basis, rows_added,
         rows_changed, rows_missing, allowed)
       VALUES ($1, 'audit_event', 'audit_already_present', 0, 3, 0, true),
              ($1, 'record_code_counter', 'counter', 0, 1, 0, true)`,
      [recheckRunId],
    );
    await c.query(
      `INSERT INTO migration_reconciliation_attachment (id, migration_reconciliation_id, parent_table, object_name,
         problem, expected_size, actual_size, expected_sha256, actual_sha256)
       VALUES ($1, $2, 'evidence_content', 'synthetic/object-1', 'sha256_mismatch', 11, 11, $3, $4)`,
      [uuidv7(), recheckRunId, digest("synthetic bytes"), digest("synthetic bytes changed")],
    );
    for (const [hold, user] of [
      [unboundHold, unboundUser],
      [reboundHold, reboundUser],
    ] as const) {
      await c.query(`INSERT INTO identity_binding_hold (id, user_id, migration_import_id) VALUES ($1, $2, $3)`, [
        hold,
        user.id,
        importId,
      ]);
      await audit(c, "identity_binding_hold", hold, "identity.binding_held", { prior: null, next: 1 });
    }
    await c.query(
      `UPDATE identity_binding_hold SET state = 'rebound', mapping_sha256 = $2, operator_name = 'Synthetic operator',
         resolved_at = now(), version = 2, updated_at = now() WHERE id = $1`,
      [reboundHold, digest("synthetic mapping")],
    );
    await c.query(
      `INSERT INTO identity_rebind_event (id, identity_binding_hold_id, user_id, action, old_issuer, old_subject,
         new_issuer, new_subject, mapping_sha256, operator_name, applied_at)
       VALUES ($1, $2, $3, 'rebound', 'https://synthetic-old-idp.invalid', $4, 'https://synthetic-new-idp.invalid', $5,
         $6, 'Synthetic operator', now())`,
      [
        uuidv7(),
        reboundHold,
        reboundUser.id,
        `old-${reboundUser.subject}`,
        `new-${reboundUser.subject}`,
        digest("synthetic mapping"),
      ],
    );
    await audit(c, "identity_binding_hold", reboundHold, "identity.rebound", { prior: 1, next: 2 });
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  return {
    importId,
    importRunId,
    recheckRunId,
    unbound: { ...unboundUser, holdId: unboundHold },
    rebound: { ...reboundUser, holdId: reboundHold },
  };
}

export async function exerciseP7BeDOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  const seeded = await seedSyntheticImport(api.owner, api.db, w.orgA.id);
  const tech = await signIn(api.app, w.admin.subject); // ADM_TECH + ADM_ACCESS at org A
  const auditor = await signIn(api.app, w.auditor.subject); // AUD at org A: reads
  const office = await signIn(api.app, w.office.subject); // no migration_import.read
  const status = async (p: Promise<{ status: number; body: Body }>, expected: number, code?: string) => {
    const res = await p;
    expect(res.status, JSON.stringify(res.body)).toBe(expected);
    if (code) expect(res.body.code).toBe(code);
    return res;
  };

  // listMigrationImports: 200 (ADM_TECH, AUD), 400 (bad cursor), 403.
  const list = await status(m("GET", `${IMPORTS}?limit=100`, { session: auditor }), 200);
  expect(list.body.items.map((i: Body) => i.id)).toContain(seeded.importId);
  await status(m("GET", `${IMPORTS}?cursor=not-a-cursor`, { session: tech }), 400);
  await status(m("GET", IMPORTS, { session: office }), 403, "forbidden");

  // getMigrationImport: 200 (latest run is the recheck; identity counts), 403, 404, 400 (malformed id).
  const got = await status(m("GET", `${IMPORTS}/${seeded.importId}`, { session: tech }), 200);
  expect(got.body.latestReconciliation).toMatchObject({ id: seeded.recheckRunId, result: "mismatched" });
  expect(got.body.identities).toEqual({ unbound: 1, rebound: 1, retained: 0 });
  expect(got.body.rowCount).toBe("7");
  await status(m("GET", `${IMPORTS}/${seeded.importId}`, { session: office }), 403, "forbidden");
  await status(m("GET", `${IMPORTS}/${MISSING}`, { session: tech }), 404, "not_found");
  await status(m("GET", `${IMPORTS}/not-a-uuid`, { session: tech }), 400);

  // listMigrationReconciliations: 200 (newest first), 403, 404, 400.
  const runs = await status(m("GET", `${IMPORTS}/${seeded.importId}/reconciliations`, { session: auditor }), 200);
  expect(runs.body.items.map((r: Body) => r.id)).toEqual([seeded.recheckRunId, seeded.importRunId]);
  await status(m("GET", `${IMPORTS}/${seeded.importId}/reconciliations`, { session: office }), 403, "forbidden");
  await status(m("GET", `${IMPORTS}/${MISSING}/reconciliations`, { session: tech }), 404, "not_found");
  await status(m("GET", `${IMPORTS}/${seeded.importId}/reconciliations?limit=0`, { session: tech }), 400);

  // getMigrationReconciliation: 200 (per-table counts and digests, attachment mismatches), 403, 404, 400.
  const report = await status(
    m("GET", `${IMPORTS}/${seeded.importId}/reconciliations/${seeded.recheckRunId}`, { session: tech }),
    200,
  );
  expect(report.body.tables).toHaveLength(2);
  expect(report.body.tables.find((t: Body) => t.tableName === "app_user")).toMatchObject({
    expectedRows: "6",
    actualRows: "5",
    matched: false,
  });
  expect(report.body.attachmentMismatches).toEqual([
    expect.objectContaining({ objectName: "synthetic/object-1", problem: "sha256_mismatch", expectedSize: "11" }),
  ]);
  // T-R12 (ADR-0064 A1.6, A2.4, A3.5): the delta rows (the counter basis round-trips), and the import's audit fields
  // as decimal strings.
  expect(report.body.deltas).toEqual([
    {
      tableName: "audit_event",
      basis: "audit_already_present",
      rowsAdded: "0",
      rowsChanged: "3",
      rowsMissing: "0",
      allowed: true,
    },
    {
      tableName: "record_code_counter",
      basis: "counter",
      rowsAdded: "0",
      rowsChanged: "1",
      rowsMissing: "0",
      allowed: true,
    },
  ]);
  const imported = await status(m("GET", `${IMPORTS}/${seeded.importId}`, { session: tech }), 200);
  expect(imported.body).toMatchObject({
    auditCarriedRows: "40",
    auditCarriedSeqMax: "52",
    auditBaselineRows: "60",
    auditBaselineSeqMin: "53",
    auditBaselineSeqMax: "112",
    seedRowsReplaced: "9",
    auditAlreadyPresentRows: "3",
  });
  await status(
    m("GET", `${IMPORTS}/${seeded.importId}/reconciliations/${seeded.recheckRunId}`, { session: office }),
    403,
    "forbidden",
  );
  await status(m("GET", `${IMPORTS}/${MISSING}/reconciliations/${seeded.recheckRunId}`, { session: tech }), 404);
  await status(m("GET", `${IMPORTS}/${seeded.importId}/reconciliations/bad`, { session: tech }), 400);

  // listIdentityRebinds: 200 (all; filtered by state), 400 (unknown state), 403.
  const holds = await status(m("GET", `${REBINDS}?limit=100`, { session: tech }), 200);
  const mine = holds.body.items.filter((h: Body) => h.migrationImportId === seeded.importId);
  expect(mine.map((h: Body) => h.state).sort()).toEqual(["rebound", "unbound"]);
  const unbound = await status(m("GET", `${REBINDS}?state=unbound&limit=100`, { session: auditor }), 200);
  expect(unbound.body.items.find((h: Body) => h.id === seeded.unbound.holdId)).toMatchObject({
    userId: seeded.unbound.id,
    subject: seeded.unbound.subject,
    newIssuer: null,
  });
  await status(m("GET", `${REBINDS}?state=elsewhere`, { session: tech }), 400);
  await status(m("GET", REBINDS, { session: office }), 403, "forbidden");
}
