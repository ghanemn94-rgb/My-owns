// Playbook Studio configuration versions and drafts (OpenAPI tag "studio"; ADR-0039 §1, §4, §9, §11, §13;
// REQ-S06-004, REQ-S16-012; p5-work-split §A.1; T-DG5-BE-A):
//   GET   /admin/methodology-versions                      listConfigVersions   (methodology.read)
//   POST  /admin/methodology-versions                      createConfigDraft    (methodology.configure)
//   GET   /admin/methodology-versions/{versionId}          getConfigVersion     (methodology.read)
//   PATCH /admin/methodology-versions/{versionId}          updateConfigDraft    (methodology.configure; If-Match)
//   POST  /admin/methodology-versions/{versionId}/discard  discardConfigDraft   (methodology.configure; If-Match)
//
// Versions are platform-wide (no organization column), so the scope check is permission-only: the permission must be
// held in the caller's organization, decided on grants reloaded inside the write transaction (commit-time
// authorization; the job-schedule precedent). Every write: Zod validation, If-Match on the draft (428 missing, 409
// stale; a create is version 1), lock class `configDraft` on "<kind>:<key>", one audit event per row written in
// the same transaction, no remote I/O. The API refuses first with the ADR-0039 §13 codes; the database guards of 0062
// refuse the same things (reaching one is a programming error, mapped in platform/db-errors.ts).
// A Studio version is configuration, not a business approval: publishing configuration grants no approval right.
import { sql, type DbOrTx, type MethodologyVersionTable, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import {
  configDraftCreate,
  configDraftUpdate,
  configKind as configKindSchema,
  configVersionListQuery,
  type ConfigCheckSummary,
  type ConfigVersion,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, denialOf, principalOf, refreshPrincipal, type Principal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { contentSha256, loadHashedElements } from "./content-hash.ts";

export type MethodologyVersionRow = Selectable<MethodologyVersionTable>;

const JSON_BODY = ["application/json"] as const;
export const VERSIONS = "/api/v1/admin/methodology-versions";
const ONE = `${VERSIONS}/:versionId`;
const DISCARD = `${ONE}/discard`;

// ------------------------------------------------------------------------------------------------ refusals (§13)

/** The ADR-0039 §13 refusals with their exact English texts (p5-work-split §2 rule 15). */
export const studioRefusals = {
  notEditable: () =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.invalidTransition,
      code: "config_version.not_editable",
      title: "Not editable",
      detail: "This configuration version is published or no longer being edited. Create a new draft to change it.",
    }),
  draftExists: () =>
    problems.duplicate(
      "config_version.draft_exists",
      "A draft of this configuration already exists. Continue it or discard it first.",
    ),
  stableIdChange: () =>
    problems.businessRule(
      "config_version.stable_id_change",
      "Stable identifiers cannot be changed. Change the label instead.",
    ),
  sourceElementProtected: () =>
    problems.businessRule(
      "config_version.source_element_protected",
      "Source phases, gates and TOM dimensions cannot be added or deleted.",
    ),
  unknownElement: () =>
    problems.businessRule("config_version.unknown_element", "This element does not exist in the methodology."),
  adminApproverForbidden: () =>
    problems.businessRule(
      "config_version.admin_approver_forbidden",
      "An administrator role or the auditor cannot be configured as an approver.",
    ),
  approverNotAllowed: () =>
    problems.businessRule("config_version.approver_not_allowed", "This role is not an allowed approver for this gate."),
  previewRequired: () =>
    problems.businessRule(
      "config_version.preview_required",
      "Run a successful preview and test of the current draft first.",
    ),
  reviewRequired: () =>
    problems.businessRule(
      "config_version.review_required",
      "This change needs an approved review before it can be published.",
    ),
  checksRequired: () =>
    problems.businessRule(
      "config_version.checks_required",
      "Run the compatibility and source-coverage checks for the current draft first.",
    ),
  compatibilityFailed: () =>
    problems.businessRule(
      "config_version.compatibility_failed",
      "The compatibility check failed. Resolve the listed problems before publishing.",
    ),
  sourceIncomplete: () =>
    problems.businessRule(
      "config_version.source_incomplete",
      "The source-completeness check failed: an element set is incomplete. Publishing is blocked.",
    ),
  weightsTotal: () =>
    problems.businessRule(
      "config_version.weights_total",
      "Default weights must total exactly 100% over 2 to 6 criteria.",
    ),
  rollbackTargetInvalid: () =>
    problems.businessRule(
      "config_version.rollback_target_invalid",
      "Only an earlier published version of the same configuration can be restored.",
    ),
  selfReview: () =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "config_review.self_review",
      title: "Forbidden",
      detail: "You cannot review a configuration change you authored or requested.",
    }),
  reviewerNotAllowed: () =>
    problems.businessRule(
      "config_review.reviewer_not_allowed",
      "The auditor or an administrator role cannot be the configured reviewer.",
    ),
} as const;

// ------------------------------------------------------------------------------------------------ access and lock

/**
 * `permission` in the caller's organization (Studio versions are global; ADR-0039 §9, p5-work-split §A.10 item 1),
 * else 403 with the denial attached for the failed-mutation audit.
 */
export function requireStudioPermission(
  principal: Principal,
  permission: Permission,
): { userId: string; organizationId: string } {
  principal.tracker.decisions += 1;
  const org = principal.organizationId;
  const allowed =
    org !== null && principal.grants.some((g) => g.permissions.has(permission) && g.organizationId === org);
  if (!allowed || org === null || principal.userId === null) {
    const denied = problems.forbidden();
    throw org === null
      ? denied
      : denied.withDenial(
          denialOf(permission, {
            level: "organization",
            organizationId: org,
            businessUnitId: null,
            transformationId: null,
            businessUnitAncestry: [],
          }),
        );
  }
  return { userId: principal.userId, organizationId: org };
}

/** Commit-time authorization of a Studio write: the grants are reloaded inside the write transaction. */
export async function requireStudioWrite(
  tx: Tx,
  request: FastifyRequest,
  permission: Permission,
): Promise<{ userId: string; organizationId: string }> {
  principalOf(request);
  return requireStudioPermission(await refreshPrincipal(tx, request), permission);
}

/** Lock class `configDraft` on "<kind>:<key>" (ADR-0016 §6 registry; ADR-0039 §11). */
export async function lockConfigDraft(tx: Tx, kind: string, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.configDraft}::int4, hashtext(${`${kind}:${key}`}::text))`.execute(
    tx,
  );
}

/** A draft whose content may change (stage editing or preview), else 409 `config_version.not_editable`. */
export function assertContentEditable(v: Pick<MethodologyVersionRow, "status" | "draft_stage">): void {
  if (v.status !== "draft" || (v.draft_stage !== "editing" && v.draft_stage !== "preview"))
    throw studioRefusals.notEditable();
}

// ------------------------------------------------------------------------------------------------ presenter

type CheckKind = "preview" | "compatibility" | "source_coverage";

interface VersionFacts {
  readonly checks: ReadonlyMap<string, ConfigCheckSummary>;
  readonly pendingReviews: ReadonlyMap<string, string>;
  readonly reviewRequired: ReadonlyMap<string, boolean>;
  readonly newestPublished: ReadonlyMap<string, number>;
}

async function loadVersionFacts(db: DbOrTx, rows: readonly MethodologyVersionRow[]): Promise<VersionFacts> {
  if (rows.length === 0)
    return { checks: new Map(), pendingReviews: new Map(), reviewRequired: new Map(), newestPublished: new Map() };
  const ids = rows.map((r) => r.id);
  const keys = [...new Set(rows.map((r) => r.key))];
  const [runs, reviews, policies, newest] = await Promise.all([
    db
      .selectFrom("config_check_run as r")
      .innerJoin("methodology_version as v", "v.id", "r.methodology_version_id")
      .select(["r.id", "r.methodology_version_id", "r.check_kind", "r.result", "r.created_at"])
      .where("r.methodology_version_id", "in", ids)
      .whereRef("r.content_sha256", "=", "v.content_sha256")
      .orderBy("r.created_at", "desc")
      .orderBy("r.id", "desc")
      .execute(),
    db
      .selectFrom("config_review_request")
      .select(["id", "methodology_version_id"])
      .where("methodology_version_id", "in", ids)
      .where("status", "=", "pending")
      .execute(),
    db.selectFrom("config_review_policy").select(["config_kind", "review_required"]).execute(),
    db
      .selectFrom("methodology_version")
      .select(["key", sql<number>`max(version_no)`.as("max_no")])
      .where("key", "in", keys)
      .where("status", "=", "published")
      .groupBy("key")
      .execute(),
  ]);
  const checks = new Map<string, ConfigCheckSummary>();
  for (const r of runs) {
    const k = `${r.methodology_version_id}:${r.check_kind}`;
    if (!checks.has(k))
      checks.set(k, {
        checkRunId: r.id,
        result: r.result as ConfigCheckSummary["result"],
        createdAt: iso(r.created_at),
      });
  }
  return {
    checks,
    pendingReviews: new Map(reviews.map((r) => [r.methodology_version_id, r.id])),
    reviewRequired: new Map(policies.map((p) => [p.config_kind, p.review_required])),
    newestPublished: new Map(newest.map((n) => [n.key, Number(n.max_no)])),
  };
}

function present(r: MethodologyVersionRow, f: VersionFacts): ConfigVersion {
  const check = (kind: CheckKind) => f.checks.get(`${r.id}:${kind}`) ?? null;
  return {
    id: r.id,
    configKind: configKindSchema.parse(r.config_kind),
    key: r.key,
    versionNo: r.version_no,
    status: r.status as ConfigVersion["status"],
    draftStage: r.draft_stage as ConfigVersion["draftStage"],
    origin: r.origin as ConfigVersion["origin"],
    basedOnVersionId: r.based_on_version_id,
    rollbackOfVersionId: r.rollback_of_version_id,
    titleEn: r.title_en,
    titleAr: r.title_ar,
    changeSummary: r.change_summary,
    definition: r.definition as Record<string, unknown>,
    contentSha256: r.content_sha256,
    isNewestPublished: r.status === "published" && f.newestPublished.get(r.key) === r.version_no,
    latestChecks: {
      preview: check("preview"),
      compatibility: check("compatibility"),
      sourceCoverage: check("source_coverage"),
    },
    pendingReviewId: f.pendingReviews.get(r.id) ?? null,
    // A missing policy row reads as "review required" (the 0062 guard's coalesce(..., true)).
    reviewRequired: f.reviewRequired.get(r.config_kind) ?? true,
    publishedAt: isoOrNull(r.published_at),
    publishedBy: r.published_by,
    discardedAt: isoOrNull(r.discarded_at),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/** One version as the contract's ConfigVersion (latest checks for its current hash, pending review, policy). */
export async function toConfigVersion(db: DbOrTx, row: MethodologyVersionRow): Promise<ConfigVersion> {
  return present(row, await loadVersionFacts(db, [row]));
}

/** Several versions as ConfigVersion, with one query per fact kind. */
export async function toConfigVersions(db: DbOrTx, rows: readonly MethodologyVersionRow[]): Promise<ConfigVersion[]> {
  const facts = await loadVersionFacts(db, rows);
  return rows.map((r) => present(r, facts));
}

/** The version row, or 404. */
export async function loadVersion(db: DbOrTx, versionId: string, forUpdate = false): Promise<MethodologyVersionRow> {
  let q = db.selectFrom("methodology_version").selectAll().where("id", "=", versionId);
  if (forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  return row;
}

// ------------------------------------------------------------------------------------------------ writes

const AUDITED_FIELDS = ["title_en", "title_ar", "change_summary", "definition", "draft_stage"] as const;

function changesOf(before: MethodologyVersionRow, after: MethodologyVersionRow) {
  const b = new Map(Object.entries(before));
  const a = new Map(Object.entries(after));
  const out = new Map<string, { from: unknown; to: unknown }>();
  for (const f of AUDITED_FIELDS) {
    const from = b.get(f);
    const to = a.get(f);
    if (JSON.stringify(from) !== JSON.stringify(to)) out.set(f, { from, to });
  }
  return out.size > 0 ? Object.fromEntries(out) : null;
}

async function createDraft(tx: Tx, request: FastifyRequest): Promise<MethodologyVersionRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.configure");
  const body = parseBody(configDraftCreate, request.body);
  const base = await loadVersion(tx, body.basedOnVersionId);
  // OpenAPI createConfigDraft: a base that is not a published version is 422 config_version.unknown_element.
  if (base.status !== "published") throw studioRefusals.unknownElement();
  await lockConfigDraft(tx, base.config_kind, base.key);
  const open = await tx
    .selectFrom("methodology_version")
    .select("id")
    .where("config_kind", "=", base.config_kind)
    .where("key", "=", base.key)
    .where("status", "=", "draft")
    .where("draft_stage", "<>", "discarded")
    .executeTakeFirst();
  if (open !== undefined) throw studioRefusals.draftExists();
  const max = await tx
    .selectFrom("methodology_version")
    .select(sql<number>`max(version_no)`.as("n"))
    .where("key", "=", base.key)
    .executeTakeFirstOrThrow();
  const versionNo = Number(max.n) + 1;
  const elements = await loadHashedElements(tx, base.id);
  const titleEn = body.titleEn ?? base.title_en;
  const titleAr = body.titleAr ?? base.title_ar;
  const id = uuidv7();
  const row = await tx
    .insertInto("methodology_version")
    .values({
      id,
      key: base.key,
      version_no: versionNo,
      status: "draft",
      title_en: titleEn,
      title_ar: titleAr,
      source_document: base.source_document,
      source_sha256: base.source_sha256,
      definition: JSON.stringify(base.definition),
      content_sha256: contentSha256({ definition: base.definition, titleEn, titleAr, elements }),
      config_kind: base.config_kind,
      draft_stage: "editing",
      origin: "draft",
      based_on_version_id: base.id,
      change_summary: body.changeSummary ?? null,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const audit = auditContextOf(request);
  await record(tx, audit, {
    action: "methodology_version.create_draft",
    recordType: "methodology_version",
    recordId: id,
    organizationId: actor.organizationId,
    newVersion: 1,
    changes: {
      based_on_version_id: { from: null, to: base.id },
      version_no: { from: null, to: versionNo },
      config_kind: { from: null, to: base.config_kind },
      key: { from: null, to: base.key },
    },
  });
  // A draft copies every element row of its base (ADR-0039 §2), so a version's rows are complete for its lineage. Each
  // copied row is its own audited insert (the 0062 deferred audit guard of methodology_element).
  const baseRows = await tx
    .selectFrom("methodology_element")
    .selectAll()
    .where("methodology_version_id", "=", base.id)
    .orderBy("element_type")
    .orderBy("stable_key")
    .execute();
  for (const e of baseRows) {
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

async function updateDraft(tx: Tx, request: FastifyRequest, versionId: string): Promise<MethodologyVersionRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.configure");
  const body = parseBody(configDraftUpdate, request.body);
  const expected = requireIfMatch(request);
  const probe = await loadVersion(tx, versionId);
  await lockConfigDraft(tx, probe.config_kind, probe.key);
  const current = await loadVersion(tx, versionId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  assertContentEditable(current);
  const titleEn = body.titleEn ?? current.title_en;
  const titleAr = body.titleAr ?? current.title_ar;
  const definition = body.definition ?? current.definition;
  const hash = contentSha256({ definition, titleEn, titleAr, elements: await loadHashedElements(tx, versionId) });
  const updated = await tx
    .updateTable("methodology_version")
    .set({
      title_en: titleEn,
      title_ar: titleAr,
      ...(body.changeSummary !== undefined ? { change_summary: body.changeSummary } : {}),
      definition: JSON.stringify(definition),
      content_sha256: hash,
      // A content change in preview returns the draft to editing (ADR-0039 §1; the 0062 guard requires it).
      draft_stage: "editing",
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "methodology_version.update_draft",
    recordType: "methodology_version",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: changesOf(current, updated),
  });
  return updated;
}

async function discardDraft(tx: Tx, request: FastifyRequest, versionId: string): Promise<MethodologyVersionRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.configure");
  const expected = requireIfMatch(request);
  const probe = await loadVersion(tx, versionId);
  await lockConfigDraft(tx, probe.config_kind, probe.key);
  const current = await loadVersion(tx, versionId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "draft" || current.draft_stage === "discarded") throw studioRefusals.notEditable();
  const audit = auditContextOf(request);
  // A draft under review: its pending review request is withdrawn in the same transaction (audited), so no reviewer
  // decides a discarded draft. Its config_review work items are BE-B3's (reviews.ts) to close.
  const pending = await tx
    .selectFrom("config_review_request")
    .selectAll()
    .where("methodology_version_id", "=", current.id)
    .where("status", "=", "pending")
    .forUpdate()
    .executeTakeFirst();
  if (pending !== undefined) {
    const withdrawn = await tx
      .updateTable("config_review_request")
      .set({
        status: "withdrawn",
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: actor.userId,
      })
      .where("id", "=", pending.id)
      .where("version", "=", pending.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action: "config_review_request.withdraw",
      recordType: "config_review_request",
      recordId: pending.id,
      organizationId: actor.organizationId,
      priorVersion: pending.version,
      newVersion: withdrawn.version,
      reason: "draft discarded",
      changes: { status: { from: "pending", to: "withdrawn" } },
    });
  }
  const updated = await tx
    .updateTable("methodology_version")
    .set({
      draft_stage: "discarded",
      discarded_at: sql<Date>`now()`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "methodology_version.discard",
    recordType: "methodology_version",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: { draft_stage: { from: current.draft_stage, to: "discarded" } },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = configVersionListQuery.extend({ cursor: cursorSchema, limit: limitSchema });
export const versionParams = z.strictObject({ versionId: z.uuid() });

export function registerConfigDraftRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "methodology.read" as const } };
  const configure = { access: { permission: "methodology.configure" as const } };

  app.get(VERSIONS, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    requireStudioPermission(principalOf(request), "methodology.read");
    const hash = filterHash({ kind: query.kind, status: query.status });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("methodology_version").selectAll();
    if (query.kind !== undefined) q = q.where("config_kind", "=", query.kind);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    // Newest first: ids are UUIDv7 (time-ordered); the seeded rows carry low fixed ids, so they sort last.
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const pageRows = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await toConfigVersions(db, pageRows.items), nextCursor: pageRows.nextCursor };
  });

  app.post(VERSIONS, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => createDraft(tx, request));
    return sendVersioned(reply, 201, await toConfigVersion(db, row), `${VERSIONS}/${row.id}`);
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { versionId } = parse(versionParams, request.params, "params");
    requireStudioPermission(principalOf(request), "methodology.read");
    const row = await loadVersion(db, versionId);
    return sendVersioned(reply, 200, await toConfigVersion(db, row));
  });

  app.patch(ONE, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const row = await db.transaction().execute((tx) => updateDraft(tx, request, versionId));
    return sendVersioned(reply, 200, await toConfigVersion(db, row));
  });

  app.post(DISCARD, { config: configure }, async (request, reply) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const row = await db.transaction().execute((tx) => discardDraft(tx, request, versionId));
    return sendVersioned(reply, 200, await toConfigVersion(db, row));
  });

  return [`GET ${VERSIONS}`, `POST ${VERSIONS}`, `GET ${ONE}`, `PATCH ${ONE}`, `POST ${DISCARD}`];
}
