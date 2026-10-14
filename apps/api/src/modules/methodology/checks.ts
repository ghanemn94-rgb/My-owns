// Studio diff, affected records, compatibility, preview and check runs (OpenAPI tag "studio"; ADR-0039 §1, §5, §9,
// §11, §12; REQ-S06-007; p5-work-split §A.2; T-DG5-BE-B):
//   GET  /admin/methodology-versions/{versionId}/diff                  getConfigVersionDiff         (methodology.read)
//   GET  /admin/methodology-versions/{versionId}/affected-records      getConfigAffectedRecords     (methodology.read)
//   GET  /admin/methodology-versions/{versionId}/check-runs            listConfigCheckRuns          (methodology.read)
//   POST /admin/methodology-versions/{versionId}/compatibility-checks  runConfigCompatibilityCheck  (methodology.publish)
//   POST /admin/methodology-versions/{versionId}/preview               runConfigPreview             (methodology.publish)
// The two runs: commit-time authorization inside the write transaction, If-Match on the draft (428 missing, 409
// stale), lock class `configDraft` on "<kind>:<key>", one append-only config_check_run for exactly the current content
// hash with its audit event, no remote I/O. The preview sandbox runs first in its own READ ONLY transaction that is
// rolled back (preview.ts); its run is then recorded only if the draft is still the version the caller named and its
// content is unchanged, and on `pass` the stage moves editing -> preview (one more audited version step). A check run
// tests configuration; it never approves anything.
import { sql, type Tx } from "@mth/db";
import {
  configCheckRunListQuery,
  configDiffQuery,
  configPreviewRequest,
  type ConfigCheckRun,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import type { ConfigCheckRunTable } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
} from "../platform/index.ts";
import { affectedRecords } from "./affected-records.ts";
import { runCompatibility, type CheckOutcome } from "./compatibility.ts";
import { diffVersions } from "./diff.ts";
import {
  assertContentEditable,
  loadVersion,
  lockConfigDraft,
  requireStudioPermission,
  requireStudioWrite,
  studioRefusals,
  versionParams,
  VERSIONS,
  type MethodologyVersionRow,
} from "./drafts.ts";
import { runPreviewSandbox } from "./preview.ts";

const JSON_BODY = ["application/json"] as const;
const ONE = `${VERSIONS}/:versionId`;
const DIFF = `${ONE}/diff`;
const AFFECTED = `${ONE}/affected-records`;
const RUNS = `${ONE}/check-runs`;
const COMPATIBILITY = `${ONE}/compatibility-checks`;
const PREVIEW = `${ONE}/preview`;

type CheckRunRow = Selectable<ConfigCheckRunTable>;

export function toCheckRun(r: CheckRunRow): ConfigCheckRun {
  return {
    id: r.id,
    versionId: r.methodology_version_id,
    checkKind: r.check_kind as ConfigCheckRun["checkKind"],
    contentSha256: r.content_sha256,
    result: r.result as ConfigCheckRun["result"],
    report: r.report as Record<string, unknown>,
    runBy: r.run_by,
    createdAt: iso(r.created_at),
  };
}

/** Locks the version's configuration and re-reads it for update; checks If-Match. */
async function lockedVersion(tx: Tx, versionId: string, expected: number): Promise<MethodologyVersionRow> {
  const probe = await loadVersion(tx, versionId);
  await lockConfigDraft(tx, probe.config_kind, probe.key);
  const current = await loadVersion(tx, versionId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  return current;
}

/** Appends one check run for the version's current hash, with its audit event. */
async function insertRun(
  tx: Tx,
  request: FastifyRequest,
  version: MethodologyVersionRow,
  actor: { userId: string; organizationId: string },
  kind: "preview" | "compatibility",
  outcome: CheckOutcome,
): Promise<CheckRunRow> {
  const id = uuidv7();
  const row = await tx
    .insertInto("config_check_run")
    .values({
      id,
      methodology_version_id: version.id,
      check_kind: kind,
      content_sha256: version.content_sha256,
      result: outcome.result,
      report: JSON.stringify(outcome.report),
      run_by: actor.userId,
      created_by: actor.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: `config_check_run.${kind}`,
    recordType: "config_check_run",
    recordId: id,
    organizationId: actor.organizationId,
    newVersion: 1,
    changes: {
      methodology_version_id: { from: null, to: version.id },
      content_sha256: { from: null, to: version.content_sha256 },
      result: { from: null, to: outcome.result },
    },
  });
  return row;
}

async function compatibilityRun(tx: Tx, request: FastifyRequest, versionId: string): Promise<CheckRunRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.publish");
  const expected = requireIfMatch(request);
  const current = await lockedVersion(tx, versionId, expected);
  // Checks belong to an open draft; a published or discarded version is no longer being edited.
  if (current.status !== "draft" || current.draft_stage === "discarded") throw studioRefusals.notEditable();
  const outcome = await runCompatibility(tx, current, actor.organizationId);
  return insertRun(tx, request, current, actor, "compatibility", outcome);
}

async function recordPreview(
  tx: Tx,
  request: FastifyRequest,
  versionId: string,
  previewed: MethodologyVersionRow,
  outcome: CheckOutcome,
): Promise<CheckRunRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.publish");
  const expected = requireIfMatch(request);
  const current = await lockedVersion(tx, versionId, expected);
  assertContentEditable(current);
  // The sandbox ran on the content the caller named; a concurrent edit makes the result stale.
  if (current.content_sha256 !== previewed.content_sha256) throw problems.versionConflict(current.version);
  const run = await insertRun(tx, request, current, actor, "preview", outcome);
  if (outcome.result === "pass" && current.draft_stage === "editing") {
    const updated = await tx
      .updateTable("methodology_version")
      .set({
        draft_stage: "preview",
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: actor.userId,
      })
      .where("id", "=", current.id)
      .where("version", "=", current.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, auditContextOf(request), {
      action: "methodology_version.preview",
      recordType: "methodology_version",
      recordId: current.id,
      organizationId: actor.organizationId,
      priorVersion: current.version,
      newVersion: updated.version,
      changes: { draft_stage: { from: "editing", to: "preview" }, preview_run_id: { from: null, to: run.id } },
    });
  }
  return run;
}

function sendRun(reply: FastifyReply, versionId: string, run: CheckRunRow): FastifyReply {
  reply.header("Location", `${VERSIONS}/${versionId}/check-runs`);
  return reply.code(201).send(toCheckRun(run));
}

const listQuery = configCheckRunListQuery.extend({ cursor: cursorSchema, limit: limitSchema });

export function registerConfigCheckRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "methodology.read" as const } };
  const publish = { access: { permission: "methodology.publish" as const } };

  app.get(DIFF, { config: read }, async (request) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const query = parseQuery(configDiffQuery, request.query);
    requireStudioPermission(principalOf(request), "methodology.read");
    const version = await loadVersion(db, versionId);
    const againstId = query.against ?? version.based_on_version_id ?? version.id;
    const against = await loadVersion(db, againstId);
    // Only versions of the same configuration (kind and key) are compared; another one is not found in it.
    if (against.config_kind !== version.config_kind || against.key !== version.key) throw problems.notFound();
    const { changes: _changes, ...diff } = await diffVersions(db, version, against);
    return diff;
  });

  app.get(AFFECTED, { config: read }, async (request) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const actor = requireStudioPermission(principalOf(request), "methodology.read");
    const version = await loadVersion(db, versionId);
    return affectedRecords(db, version, actor.organizationId);
  });

  app.get(RUNS, { config: read }, async (request) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    requireStudioPermission(principalOf(request), "methodology.read");
    await loadVersion(db, versionId);
    const hash = filterHash({ versionId, checkKind: query.checkKind });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("config_check_run").selectAll().where("methodology_version_id", "=", versionId);
    if (query.checkKind !== undefined) q = q.where("check_kind", "=", query.checkKind);
    // Newest first: ids are UUIDv7 (time-ordered).
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const pageRows = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: pageRows.items.map(toCheckRun), nextCursor: pageRows.nextCursor };
  });

  app.post(COMPATIBILITY, { config: publish }, async (request, reply) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const run = await db.transaction().execute((tx) => compatibilityRun(tx, request, versionId));
    return sendRun(reply, versionId, run);
  });

  app.post(PREVIEW, { config: { ...publish, consumes: JSON_BODY } }, async (request, reply) => {
    const { versionId } = parse(versionParams, request.params, "params");
    // Request-time checks before the sandbox runs (each is re-checked in the write transaction).
    requireStudioPermission(principalOf(request), "methodology.publish");
    const body = parseBody(configPreviewRequest, request.body);
    const expected = requireIfMatch(request);
    const previewed = await loadVersion(db, versionId);
    if (previewed.version !== expected) throw problems.versionConflict(previewed.version);
    assertContentEditable(previewed);
    const outcome = await runPreviewSandbox(db, previewed, body.samples);
    const run = await db.transaction().execute((tx) => recordPreview(tx, request, versionId, previewed, outcome));
    return sendRun(reply, versionId, run);
  });

  return [`GET ${DIFF}`, `GET ${AFFECTED}`, `GET ${RUNS}`, `POST ${COMPATIBILITY}`, `POST ${PREVIEW}`];
}
