// Publish and rollback of configuration versions (OpenAPI tag "studio"; ADR-0039 §1, §5, §6, §7, §9, §11-§13;
// REQ-S06-007, REQ-S06-009, REQ-S02-001 (the publish gate), REQ-PB-093 (the 100 % rule); p5-work-split §A.4;
// T-DG5-BE-B3):
//   POST /admin/methodology-versions/{versionId}/publish    publishConfigVersion   (methodology.publish; If-Match: the draft)
//   POST /admin/methodology-versions/{versionId}/rollback   rollbackConfigVersion  (methodology.publish; If-Match: the restored version)
//
// Both: commit-time authorization, If-Match (428 missing, 409 stale), lock classes `configDraft` then `configPublish`
// on "<kind>:<key>" (always in that order, so a publish or rollback never interleaves with a draft write of the same
// configuration), one audit event per row written in the same transaction, no remote I/O.
//
// Publish re-runs nothing: it checks the stored runs and the review for exactly the draft's current content hash and
// refuses first with the ADR-0039 §13 codes, in the pipeline's order (the 0062 guard refuses the same things):
//   not a draft (published, retired, discarded)                  -> 409 config_version.not_editable
//   no passing preview of the current content (stage editing)    -> 422 config_version.preview_required
//   review required by the kind's policy and not approved        -> 422 config_version.review_required
//   no compatibility run (or, methodology, no source-coverage run) of the current content
//                                                                -> 422 config_version.checks_required
//   the latest compatibility run of the content failed           -> 422 config_version.compatibility_failed
//   the latest source-coverage run of the content failed         -> 422 config_version.source_incomplete
//   scoring defaults whose weights do not total 100 % over 2-6   -> 422 config_version.weights_total
// A kind whose policy has review_required = false publishes from `preview` in one call: preview -> approved, then
// published (two version steps, two audit events). Published versions are immutable: every Studio write to one answers
// 409 config_version.not_editable (drafts.ts, elements.ts, checks.ts, reviews.ts).
//
// Rollback restores an earlier published version P as a NEW draft (origin `rollback`, rollback_of_version_id = P,
// based_on_version_id = the newest published version of the key, change_summary = the reason, P's definition, titles
// and element rows, the next version_no), which then follows the same pipeline. Nothing is deleted or edited: earlier
// versions, pins and every business record created under any version stay as they are and stay readable. The audit
// trail has `methodology_version.rollback_create` and, when the draft is published, `methodology_version.publish`
// naming the restored version.
//
// Publishing configuration is not a business approval: it grants no approval right and approves no G1-G6 gate.
import { sql, type Tx } from "@mth/db";
import { configRollbackRequest } from "@mth/shared/schemas";
import { Decimal } from "decimal.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  parse,
  parseBody,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { contentSha256, loadHashedElements } from "./content-hash.ts";
import {
  loadVersion,
  lockConfigDraft,
  requireStudioWrite,
  studioRefusals,
  toConfigVersion,
  versionParams,
  VERSIONS,
  type MethodologyVersionRow,
} from "./drafts.ts";
import { reviewRequiredFor, stepDraftStage } from "./reviews.ts";

const JSON_BODY = ["application/json"] as const;
const ONE = `${VERSIONS}/:versionId`;
const PUBLISH = `${ONE}/publish`;
const ROLLBACK = `${ONE}/rollback`;

/** Lock class `configPublish` on "<kind>:<key>" (ADR-0016 §6 registry; ADR-0039 §11). */
async function lockConfigPublish(tx: Tx, kind: string, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.configPublish}::int4, hashtext(${`${kind}:${key}`}::text))`.execute(
    tx,
  );
}

/** Both configuration locks, in the fixed order, then the version re-read for update. */
async function lockForPublish(tx: Tx, versionId: string): Promise<MethodologyVersionRow> {
  const probe = await loadVersion(tx, versionId);
  await lockConfigDraft(tx, probe.config_kind, probe.key);
  await lockConfigPublish(tx, probe.config_kind, probe.key);
  return loadVersion(tx, versionId, true);
}

/** The newest run of each check kind recorded for exactly `hash`. */
async function latestRuns(tx: Tx, versionId: string, hash: string): Promise<Map<string, string>> {
  const runs = await tx
    .selectFrom("config_check_run")
    .select(["check_kind", "result"])
    .where("methodology_version_id", "=", versionId)
    .where("content_sha256", "=", hash)
    .orderBy("id", "desc")
    .execute();
  const latest = new Map<string, string>();
  for (const r of runs) if (!latest.has(r.check_kind)) latest.set(r.check_kind, r.result);
  return latest;
}

/** REQ-PB-093's 100 % rule over the draft's scoring weights (decimal arithmetic; ADR-0039 §12). */
async function assertWeightsTotal(tx: Tx, versionId: string): Promise<void> {
  const rows = await tx
    .selectFrom("methodology_element")
    .select("attributes")
    .where("methodology_version_id", "=", versionId)
    .where("element_type", "=", "scoring_weight")
    .where("removed", "=", false)
    .execute();
  let total = new Decimal(0);
  for (const r of rows) {
    const value = (r.attributes as { weightPercent?: unknown }).weightPercent;
    if (typeof value !== "string") throw studioRefusals.weightsTotal();
    total = total.plus(new Decimal(value));
  }
  if (rows.length < 2 || rows.length > 6 || !total.equals(100)) throw studioRefusals.weightsTotal();
}

/** The publish preconditions, in the pipeline's order; returns whether the review step is skipped by policy. */
async function assertPublishable(tx: Tx, current: MethodologyVersionRow): Promise<{ reviewRequired: boolean }> {
  if (current.status !== "draft" || current.draft_stage === null || current.draft_stage === "discarded")
    throw studioRefusals.notEditable();
  const runs = await latestRuns(tx, current.id, current.content_sha256);
  if (current.draft_stage === "editing" || runs.get("preview") !== "pass") throw studioRefusals.previewRequired();
  const reviewRequired = await reviewRequiredFor(tx, current.config_kind);
  // A pending review (stage `review`) must be decided or withdrawn first; with review required only `approved` passes.
  if (current.draft_stage === "review" || (reviewRequired && current.draft_stage !== "approved"))
    throw studioRefusals.reviewRequired();
  if (current.draft_stage === "approved" && reviewRequired) {
    const approved = await tx
      .selectFrom("config_review_request")
      .select("id")
      .where("methodology_version_id", "=", current.id)
      .where("content_sha256", "=", current.content_sha256)
      .where("status", "=", "approved")
      .executeTakeFirst();
    if (approved === undefined) throw studioRefusals.reviewRequired();
  }
  const needed = current.config_kind === "methodology" ? ["compatibility", "source_coverage"] : ["compatibility"];
  if (needed.some((k) => !runs.has(k))) throw studioRefusals.checksRequired();
  if (runs.get("compatibility") === "fail") throw studioRefusals.compatibilityFailed();
  if (current.config_kind === "methodology" && runs.get("source_coverage") === "fail")
    throw studioRefusals.sourceIncomplete();
  if (current.config_kind === "scoring_defaults") await assertWeightsTotal(tx, current.id);
  return { reviewRequired };
}

async function publishVersion(tx: Tx, request: FastifyRequest, versionId: string): Promise<MethodologyVersionRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.publish");
  const expected = requireIfMatch(request);
  let current = await lockForPublish(tx, versionId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const { reviewRequired } = await assertPublishable(tx, current);
  const audit = auditContextOf(request);
  if (current.draft_stage === "preview" && !reviewRequired)
    current = await stepDraftStage(
      tx,
      audit,
      actor,
      current,
      "approved",
      "methodology_version.approve_without_review",
      { review_required: { from: null, to: false } },
      "the kind's review policy does not require a review",
    );
  const published = await tx
    .updateTable("methodology_version")
    .set({
      status: "published",
      draft_stage: null,
      published_at: sql<Date>`now()`,
      published_by: actor.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "methodology_version.publish",
    recordType: "methodology_version",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: published.version,
    changes: {
      status: { from: "draft", to: "published" },
      draft_stage: { from: current.draft_stage, to: null },
      published_by: { from: null, to: actor.userId },
      content_sha256: { from: current.content_sha256, to: published.content_sha256 },
      ...(current.rollback_of_version_id !== null
        ? { rollback_of_version_id: { from: null, to: current.rollback_of_version_id } }
        : {}),
    },
  });
  return published;
}

async function rollbackVersion(tx: Tx, request: FastifyRequest, targetId: string): Promise<MethodologyVersionRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.publish");
  const body = parseBody(configRollbackRequest, request.body);
  const expected = requireIfMatch(request);
  const target = await lockForPublish(tx, targetId);
  if (target.version !== expected) throw problems.versionConflict(target.version);
  if (target.status !== "published") throw studioRefusals.rollbackTargetInvalid();
  const newest = await tx
    .selectFrom("methodology_version")
    .selectAll()
    .where("config_kind", "=", target.config_kind)
    .where("key", "=", target.key)
    .where("status", "=", "published")
    .orderBy("version_no", "desc")
    .limit(1)
    .executeTakeFirstOrThrow();
  // Only an EARLIER published version is restored: the newest one is already in force.
  if (newest.id === target.id) throw studioRefusals.rollbackTargetInvalid();
  const open = await tx
    .selectFrom("methodology_version")
    .select("id")
    .where("config_kind", "=", target.config_kind)
    .where("key", "=", target.key)
    .where("status", "=", "draft")
    .where("draft_stage", "<>", "discarded")
    .executeTakeFirst();
  if (open !== undefined) throw studioRefusals.draftExists();
  const max = await tx
    .selectFrom("methodology_version")
    .select(sql<number>`max(version_no)`.as("n"))
    .where("key", "=", target.key)
    .executeTakeFirstOrThrow();
  const versionNo = Number(max.n) + 1;
  const elements = await loadHashedElements(tx, target.id);
  const id = uuidv7();
  const row = await tx
    .insertInto("methodology_version")
    .values({
      id,
      key: target.key,
      version_no: versionNo,
      status: "draft",
      title_en: target.title_en,
      title_ar: target.title_ar,
      source_document: target.source_document,
      source_sha256: target.source_sha256,
      definition: JSON.stringify(target.definition),
      content_sha256: contentSha256({
        definition: target.definition,
        titleEn: target.title_en,
        titleAr: target.title_ar,
        elements,
      }),
      config_kind: target.config_kind,
      draft_stage: "editing",
      origin: "rollback",
      based_on_version_id: newest.id,
      rollback_of_version_id: target.id,
      change_summary: body.reason,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const audit = auditContextOf(request);
  await record(tx, audit, {
    action: "methodology_version.rollback_create",
    recordType: "methodology_version",
    recordId: id,
    organizationId: actor.organizationId,
    newVersion: 1,
    reason: body.reason,
    changes: {
      rollback_of_version_id: { from: null, to: target.id },
      based_on_version_id: { from: null, to: newest.id },
      version_no: { from: null, to: versionNo },
      config_kind: { from: null, to: target.config_kind },
      key: { from: null, to: target.key },
    },
  });
  // The restored content: P's element rows, each its own audited insert (the 0062 deferred audit guard).
  const rows = await tx
    .selectFrom("methodology_element")
    .selectAll()
    .where("methodology_version_id", "=", target.id)
    .orderBy("element_type")
    .orderBy("stable_key")
    .execute();
  for (const e of rows) {
    const elementId = uuidv7();
    await tx
      .insertInto("methodology_element")
      .values({
        id: elementId,
        methodology_version_id: id,
        element_type: e.element_type,
        stable_key: e.stable_key,
        origin: e.origin,
        removed: e.removed,
        ordinal: e.ordinal,
        attributes: JSON.stringify(e.attributes),
        created_by: actor.userId,
        updated_by: actor.userId,
      })
      .execute();
    await record(tx, audit, {
      action: "methodology_element.copy",
      recordType: "methodology_element",
      recordId: elementId,
      organizationId: actor.organizationId,
      newVersion: 1,
      changes: { copied_from: { from: null, to: e.id } },
    });
  }
  return row;
}

export function registerConfigPublishRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const publish = { access: { permission: "methodology.publish" as const } };

  app.post(PUBLISH, { config: publish }, async (request, reply) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const row = await db.transaction().execute((tx) => publishVersion(tx, request, versionId));
    return sendVersioned(reply, 200, await toConfigVersion(db, row));
  });

  app.post(ROLLBACK, { config: { ...publish, consumes: JSON_BODY } }, async (request, reply) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const row = await db.transaction().execute((tx) => rollbackVersion(tx, request, versionId));
    return sendVersioned(reply, 201, await toConfigVersion(db, row), `${VERSIONS}/${row.id}`);
  });

  return [`POST ${PUBLISH}`, `POST ${ROLLBACK}`];
}
