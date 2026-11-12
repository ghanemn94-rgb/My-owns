// P7 contract exercises of BE-C (p7-work-split §C.1, §C.6 T-C7; §2 rule 1 with p6-work-split §2 rule 16; T-DG7-BE-C):
// the five migration-export operations, each with its success and the declared refusals it can reach, through the
// contract-validating client `mirrored` (success bodies also checked against the zod mirrors below).
// The contract suite shares one database with other suites, and a real export reads the whole installation (including
// other suites' evidence objects, stored in their own processes' directories), so the job's two later transitions are
// simulated here as the owner role, with SYNTHETIC manifests in the canonical format written where the job writes them;
// the real job is exercised in transfer/export.test.ts (T-C6). Every value is SYNTHETIC. An export approves nothing
// (no G1-G6, Finance or IT approval) and touches no DG0-DG7 record.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ATTACHMENT_MANIFEST_SCHEMA_VERSION,
  canonicalAttachmentManifest,
  canonicalManifest,
  MANIFEST_SCHEMA_VERSION,
  migrationExportKey,
  transferSha256,
} from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import { migrationExportPage, migrationExportView } from "../../../src/modules/transfer/export/service.ts";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P7_MIRRORS_BE_C: Readonly<Record<string, z.ZodType>> = {
  listMigrationExports: migrationExportPage,
  createMigrationExport: migrationExportView,
  getMigrationExport: migrationExportView,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const BASE = "/api/v1/admin/migration-exports";
const MISSING = "01900000-0000-7000-8000-00000000beef";

/** One owner-role step of the export state machine, with its audit event (p2_audit_required). */
async function ownerStep(ctx: P6ExerciseContext, id: string, set: string, version: number, action: string) {
  const c = await ctx.api.owner.connect();
  try {
    await c.query("BEGIN");
    await c.query(`UPDATE migration_export SET ${set}, version = $2, updated_at = now() WHERE id = $1`, [id, version]);
    await c.query(
      `INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source)
       VALUES ($1, 'system', $2, 'migration_export', $3, $4, $5, 'worker')`,
      [uuidv7(), action, id, version - 1, version],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Writes a SYNTHETIC package's two manifests where the job writes them; returns their SHA-256 values. */
function writeSyntheticManifests(root: string, id: string): { manifest: string; attachments: string } {
  const attachmentsText = canonicalAttachmentManifest({
    schemaVersion: ATTACHMENT_MANIFEST_SCHEMA_VERSION,
    exportId: id,
    items: [],
  });
  const attachments = transferSha256(attachmentsText);
  const manifestText = canonicalManifest({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportId: id,
    sourceEnvironment: "unmarked",
    demoChecksum: null,
    migrationLevel: "0147_p7_transfer_export_job",
    createdAt: new Date().toISOString(),
    appVersion: "0.1.0",
    tables: [
      {
        name: "organization",
        file: "tables/organization.ndjson",
        loadPhase: 1,
        rowCount: "0",
        fileSha256: transferSha256(""),
        contentDigest: transferSha256(""),
        columns: ["id"],
        deferredColumns: [],
      },
    ],
    excludedTables: [{ name: "session", rule: "exclude_credential", reason: "Synthetic contract exercise" }],
    rewrittenColumns: [],
    attachmentManifest: { file: "attachments.json", sha256: attachments, count: 0, bytes: "0" },
    totals: { tables: 1, rows: "0" },
  });
  for (const [file, text] of [
    ["manifest.json", manifestText],
    ["attachments.json", attachmentsText],
  ] as const) {
    const path = join(root, migrationExportKey(id, file));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  }
  return { manifest: transferSha256(manifestText), attachments };
}

export async function exerciseP7BeCOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  const tech = await signIn(api.app, w.admin.subject); // ADM_TECH + ADM_ACCESS at org A
  const auditor = await signIn(api.app, w.auditor.subject);
  const status = async (p: Promise<{ status: number; body: Body }>, expected: number, code?: string) => {
    const res = await p;
    expect(res.status, JSON.stringify(res.body)).toBe(expected);
    if (code) expect(res.body.code).toBe(code);
    return res;
  };

  // createMigrationExport: 400, 403 (AUD), 202, 200 (same Idempotency-Key), 422 in progress.
  await status(m("POST", BASE, { session: tech, body: { reason: "x" } }), 400);
  await status(m("POST", BASE, { session: auditor, body: { reason: "Synthetic contract export" } }), 403, "forbidden");
  const key = { "idempotency-key": `contract-${uuidv7()}` };
  const created = await status(
    m("POST", BASE, { session: tech, body: { reason: "Synthetic contract export" }, headers: key }),
    202,
  );
  const id = created.body.id as string;
  await status(m("POST", BASE, { session: tech, body: { reason: "Synthetic contract export" }, headers: key }), 200);
  await status(
    m("POST", BASE, { session: tech, body: { reason: "Synthetic second export" } }),
    422,
    "migration.export_in_progress",
  );

  // The downloads before the export finished: 409 not ready; 403 (AUD); 404; 400 (malformed id).
  await status(m("GET", `${BASE}/${id}/manifest`, { session: tech }), 409, "migration.export_not_ready");
  await status(m("GET", `${BASE}/${id}/attachment-manifest`, { session: tech }), 409, "migration.export_not_ready");
  await status(m("GET", `${BASE}/${id}/manifest`, { session: auditor }), 403, "forbidden");
  await status(m("GET", `${BASE}/${MISSING}/manifest`, { session: tech }), 404, "not_found");
  await status(m("GET", `${BASE}/${MISSING}/attachment-manifest`, { session: tech }), 404, "not_found");

  // The job's transitions (simulated as the owner; see the header), then the downloads.
  const sha = writeSyntheticManifests(api.config.evidenceStorage.path, id);
  await ownerStep(ctx, id, "status = 'running', started_at = now()", 2, "migration_export.started");
  await ownerStep(
    ctx,
    id,
    `status = 'succeeded', source_environment = 'unmarked', migration_level = '0147_p7_transfer_export_job',
     table_count = 1, row_count = 0, attachment_count = 0, attachment_bytes = 0, manifest_sha256 = '${sha.manifest}',
     attachment_manifest_sha256 = '${sha.attachments}', finished_at = now()`,
    3,
    "migration_export.succeeded",
  );
  const manifest = await status(m("GET", `${BASE}/${id}/manifest`, { session: tech }), 200);
  expect(manifest.body).toMatchObject({ schemaVersion: "mth-migration/1", exportId: id });
  const attachments = await status(m("GET", `${BASE}/${id}/attachment-manifest`, { session: tech }), 200);
  expect(attachments.body).toEqual({ schemaVersion: "mth-attachment-manifest/1", exportId: id, items: [] });

  // getMigrationExport: 200, 403, 404. listMigrationExports: 200, 400 (bad cursor), 403.
  const got = await status(m("GET", `${BASE}/${id}`, { session: tech }), 200);
  expect(got.body).toMatchObject({ status: "succeeded", version: 3, manifestSha256: sha.manifest });
  await status(m("GET", `${BASE}/${id}`, { session: auditor }), 403, "forbidden");
  await status(m("GET", `${BASE}/${MISSING}`, { session: tech }), 404, "not_found");
  const list = await status(m("GET", `${BASE}?limit=1`, { session: tech }), 200);
  expect(list.body.items).toHaveLength(1);
  await status(m("GET", `${BASE}?cursor=not-a-cursor`, { session: tech }), 400);
  await status(m("GET", BASE, { session: auditor }), 403, "forbidden");

  // A failed export: 422 migration.export_failed on both downloads.
  const failed = await status(m("POST", BASE, { session: tech, body: { reason: "Synthetic failed export" } }), 202);
  await ownerStep(
    ctx,
    failed.body.id,
    "status = 'failed', failure_reason = 'synthetic failure', finished_at = now()",
    2,
    "migration_export.failed",
  );
  await status(m("GET", `${BASE}/${failed.body.id}/manifest`, { session: tech }), 422, "migration.export_failed");
  await status(
    m("GET", `${BASE}/${failed.body.id}/attachment-manifest`, { session: tech }),
    422,
    "migration.export_failed",
  );
}
