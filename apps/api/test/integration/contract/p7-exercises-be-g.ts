// P7 contract exercises of BE-G (p7-work-split §E.1, §E.4 T-E21; §2 rule 1 with p6-work-split §2 rule 16;
// T-DG7-BE-G): the 10 retention and backup-status operations, each with its success and the declared refusals it can
// reach, through the contract-validating client `mirrored` (success bodies also checked against the zod mirrors).
// The contract suite shares one database with other suites, so the exercise leaves nothing active behind: its dry run
// is finished by the real job (every class is `retain` again by then, so it selects nothing), and the class it enables
// is set back to `retain`. Every value is SYNTHETIC; the IT reference text begins with TEST-ONLY. Nothing here approves
// anything (no G1-G6, Finance or IT approval) or touches DG0-DG7.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import { retentionStoreDeps, runRetention } from "../../../../worker/src/handlers/retention/archive.ts";
import { backupSetPage } from "../../../src/modules/retention/backups/routes.ts";
import { retentionClassPage, retentionClassView } from "../../../src/modules/retention/classes/service.ts";
import {
  retentionArchivedRecordPage,
  retentionRunActionPage,
  retentionRunPage,
  retentionRunView,
} from "../../../src/modules/retention/runs/service.ts";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P7_MIRRORS_BE_G: Readonly<Record<string, z.ZodType>> = {
  listRetentionClasses: retentionClassPage,
  getRetentionClass: retentionClassView,
  updateRetentionClass: retentionClassView,
  listRetentionRuns: retentionRunPage,
  createRetentionRun: retentionRunView,
  createRetentionDryRun: retentionRunView,
  getRetentionRun: retentionRunView,
  listRetentionRunActions: retentionRunActionPage,
  listRetentionArchivedRecords: retentionArchivedRecordPage,
  listBackupSets: backupSetPage,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const CLASSES = "/api/v1/admin/retention/classes";
const RUNS = "/api/v1/admin/retention/runs";
const DRY = "/api/v1/admin/retention/dry-runs";
const ARCHIVED = "/api/v1/admin/retention/archived";
const BACKUPS = "/api/v1/admin/backups";
const MISSING = "01900000-0000-7000-8000-00000000beef";
const REF = "TEST-ONLY synthetic change ticket";

export async function exerciseP7BeGOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  const tech = await signIn(api.app, w.admin.subject); // ADM_TECH + ADM_ACCESS at org A
  const auditor = await signIn(api.app, w.auditor.subject); // AUD: reads only
  const office = await signIn(api.app, w.office.subject); // TO: no retention or backup code
  const status = async (
    p: Promise<{ status: number; body: Body; headers?: Body }>,
    expected: number,
    code?: string,
  ) => {
    const res = await p;
    expect(res.status, JSON.stringify(res.body)).toBe(expected);
    if (code) expect(res.body.code).toBe(code);
    return res;
  };

  // listRetentionClasses: 200 (AUD), 400 (bad cursor), 403 (TO).
  const classes = await status(m("GET", `${CLASSES}?limit=100`, { session: auditor }), 200);
  expect(classes.body.items).toHaveLength(12);
  await status(m("GET", `${CLASSES}?cursor=not-a-cursor`, { session: tech }), 400);
  await status(m("GET", CLASSES, { session: office }), 403, "forbidden");

  // getRetentionClass: 200, 400, 403, 404.
  const current = await status(m("GET", `${CLASSES}/processed_message_log`, { session: tech }), 200);
  const version = current.body.version as number;
  await status(m("GET", `${CLASSES}/X`, { session: tech }), 400);
  await status(m("GET", `${CLASSES}/processed_message_log`, { session: office }), 403, "forbidden");
  await status(m("GET", `${CLASSES}/no_such_class`, { session: tech }), 404, "not_found");

  // updateRetentionClass: 400, 403 (AUD), 404, 409, 422, 428, 200 (enable), 200 (back to retain).
  const url = `${CLASSES}/processed_message_log`;
  const enable = { action: "archive", periodDays: 30, itApprovalReference: REF, reason: "Synthetic contract change" };
  const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
  await status(m("PUT", url, { session: tech, body: { ...enable, periodDays: 0 }, headers: ifMatch(version) }), 400);
  await status(m("PUT", url, { session: auditor, body: enable, headers: ifMatch(version) }), 403, "forbidden");
  await status(
    m("PUT", `${CLASSES}/no_such_class`, { session: tech, body: enable, headers: ifMatch(version) }),
    404,
    "not_found",
  );
  await status(m("PUT", url, { session: tech, body: enable, headers: ifMatch(version + 7) }), 409);
  await status(
    m("PUT", `${CLASSES}/business_record`, { session: tech, body: enable, headers: ifMatch(1) }),
    422,
    "retention.class_retain_only",
  );
  await status(m("PUT", url, { session: tech, body: enable }), 428);
  const enabled = await status(m("PUT", url, { session: tech, body: enable, headers: ifMatch(version) }), 200);
  expect(enabled.body).toMatchObject({ action: "archive", periodDays: 30, version: version + 1 });
  await status(
    m("PUT", url, {
      session: tech,
      body: { action: "retain", periodDays: null, itApprovalReference: null, reason: "Synthetic contract revert" },
      headers: ifMatch(version + 1),
    }),
    200,
  );

  // createRetentionDryRun / createRetentionRun: 400, 403 (AUD), 202, 200 (same Idempotency-Key), 422 in progress.
  await status(m("POST", DRY, { session: tech, body: { reason: "x" } }), 400);
  await status(m("POST", RUNS, { session: tech, body: { reason: "x" } }), 400);
  await status(m("POST", DRY, { session: auditor, body: { reason: "Synthetic contract dry run" } }), 403, "forbidden");
  await status(m("POST", RUNS, { session: auditor, body: { reason: "Synthetic contract run" } }), 403, "forbidden");
  const key = { "idempotency-key": `contract-${uuidv7()}` };
  const dry = await status(
    m("POST", DRY, { session: tech, body: { reason: "Synthetic contract dry run" }, headers: key }),
    202,
  );
  const id = dry.body.id as string;
  await status(m("POST", DRY, { session: tech, body: { reason: "Synthetic contract dry run" }, headers: key }), 200);
  await status(
    m("POST", RUNS, { session: tech, body: { reason: "Synthetic contract run" } }),
    422,
    "retention.run_in_progress",
  );
  await status(
    m("POST", DRY, { session: tech, body: { reason: "Synthetic second dry run" } }),
    422,
    "retention.run_in_progress",
  );

  // The job finishes the dry run (nothing is enabled, so it selects nothing), then a real run is accepted (202) and
  // finished the same way, so nothing stays queued in the shared database.
  const root = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "mth-retention-contract-"));
  try {
    expect(
      await runRetention(
        api.db,
        id,
        `contract-${id}`,
        retentionStoreDeps(() => root),
      ),
    ).toMatchObject({
      outcome: "succeeded",
    });
    const real = await status(m("POST", RUNS, { session: tech, body: { reason: "Synthetic contract run" } }), 202);
    expect(
      await runRetention(
        api.db,
        real.body.id,
        `contract-${real.body.id}`,
        retentionStoreDeps(() => root),
      ),
    ).toMatchObject({ outcome: "succeeded" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // getRetentionRun: 200, 400, 403, 404. listRetentionRuns: 200, 400, 403.
  const got = await status(m("GET", `${RUNS}/${id}`, { session: auditor }), 200);
  expect(got.body).toMatchObject({ mode: "dry_run", status: "succeeded", candidateCount: 0 });
  await status(m("GET", `${RUNS}/not-a-uuid`, { session: tech }), 400);
  await status(m("GET", `${RUNS}/${id}`, { session: office }), 403, "forbidden");
  await status(m("GET", `${RUNS}/${MISSING}`, { session: tech }), 404, "not_found");
  const runs = await status(m("GET", `${RUNS}?limit=1`, { session: tech }), 200);
  expect(runs.body.items).toHaveLength(1);
  await status(m("GET", `${RUNS}?cursor=not-a-cursor`, { session: tech }), 400);
  await status(m("GET", RUNS, { session: office }), 403, "forbidden");

  // listRetentionRunActions: 200, 400, 403, 404.
  await status(m("GET", `${RUNS}/${id}/actions`, { session: auditor }), 200);
  await status(m("GET", `${RUNS}/${id}/actions?cursor=not-a-cursor`, { session: tech }), 400);
  await status(m("GET", `${RUNS}/${id}/actions`, { session: office }), 403, "forbidden");
  await status(m("GET", `${RUNS}/${MISSING}/actions`, { session: tech }), 404, "not_found");

  // listRetentionArchivedRecords: 200 (with filters), 400, 403.
  await status(m("GET", `${ARCHIVED}?table=processed_message&retentionRunId=${id}`, { session: auditor }), 200);
  await status(m("GET", `${ARCHIVED}?table=Bad-Name`, { session: tech }), 400);
  await status(m("GET", ARCHIVED, { session: office }), 403, "forbidden");

  // listBackupSets: 200 (AUD), 400, 403 (TO).
  await status(m("GET", BACKUPS, { session: auditor }), 200);
  await status(m("GET", `${BACKUPS}?cursor=not-a-cursor`, { session: tech }), 400);
  await status(m("GET", BACKUPS, { session: office }), 403, "forbidden");
}
