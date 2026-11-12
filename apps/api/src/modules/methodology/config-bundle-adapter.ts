// Configuration transfer adapters of the methodology module (P7 slice D; ADR-0065 §1, §5, §6; T-DG7-BE-F): the six
// Studio kinds (methodology, scoring_defaults, form_schema, procedure, automation_rule_set, health_check_scheme) and
// config_review_policy. Registered by server.ts into transfer's ConfigBundleKindAdapter registry, so transfer imports no
// domain module.
//
// Studio kinds. Content = exactly the ADR-0039 §1 hashed content { titleEn, titleAr, definition, elements }, so an
// item's contentSha256 equals the content hash a Studio draft of that content has. The commit writes a DRAFT through
// `createDraftFromContent` below (the module's one additive "draft from content" service, ADR-0065 §5): stage editing,
// based on the key's latest published version, one audit event per row written (methodology_version.create_draft,
// methodology_element.put). It NEVER publishes: the draft goes through the existing preview, compatibility, review and
// publish operations, so a publish in an installation with running transformations triggers exactly the ADR-0040
// migration and reapproval rules, and pins are unchanged until then (ADR-0014).
//   A key with no published version cannot get a draft: methodology_version_draft_lineage (0062) requires a published
//   base for every non-seed version, and changing that is a reopen question (ADR-0065 residual 2). Such an item is
//   planned `refused` with config_bundle.kind_unavailable and listed in the T-DG7-BE-F handback.
//
// config_review_policy (no draft stage). Content { reviewRequired, reviewerRoleCode }, keyed by config_kind. Applied on
// commit like updateConfigReviewPolicy: config_review_policy.configure in the caller's organization, the reviewer rules
// (never AUD or a technical_admin role), version + 1, audit config_review_policy.update. TO holds the right by default,
// not ADM_TECH or ADM_METHOD, so with the default roles a review-policy item is refused (ADR-0065 residual 4).
// Nothing here grants a business, Finance or IT approval.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import {
  configReviewPolicyContent,
  studioContent,
  type ConfigBundleKind,
  type StudioContent,
} from "@mth/shared/transfer";
import type {
  BundleItemInput,
  BundleWriteContext,
  ConfigBundleKindAdapterPort,
  ExportedBundleItem,
  PlannedBundleItem,
  WrittenBundleRecord,
} from "@mth/shared/transfer";
import type { FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, type Principal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { contentSha256, loadHashedElements } from "./content-hash.ts";
import { lockConfigDraft, requireStudioPermission, studioRefusals, type MethodologyVersionRow } from "./drafts.ts";
import { elementAttributeSchema, kindAcceptsElementType } from "./kinds.ts";

// The ConfigBundleKindAdapter port with the API's types (@mth/shared/transfer; this module never imports transfer).
type ConfigBundleKindAdapter = ConfigBundleKindAdapterPort<DbOrTx, Tx, FastifyRequest, Principal>;
type PlannedItem = PlannedBundleItem;
type WrittenRecord = WrittenBundleRecord;
type ExportedItem = ExportedBundleItem;
type WriteContext = BundleWriteContext<Tx, FastifyRequest, Principal>;

type StudioKind = Extract<
  ConfigBundleKind,
  "methodology" | "scoring_defaults" | "form_schema" | "procedure" | "automation_rule_set" | "health_check_scheme"
>;

/** The right the kind's existing route checks, held in the caller's own organization (requireStudioPermission). */
function holdsInOwnOrganization(principal: Principal, permission: Permission, organizationId: string): boolean {
  const org = principal.organizationId;
  return (
    org !== null &&
    org === organizationId &&
    principal.userId !== null &&
    principal.grants.some((g) => g.permissions.has(permission) && g.organizationId === org)
  );
}

// ------------------------------------------------------------------------------------------------ Studio kinds

/** The owning module's schema: the shared floor plus each element's own attribute schema and kind membership. */
function studioContentSchema(kind: StudioKind): z.ZodType {
  return studioContent.superRefine((c, ctx) => {
    for (const [i, e] of c.elements.entries()) {
      let ok = false;
      try {
        ok = kindAcceptsElementType(kind, e.elementType as never);
      } catch {
        ok = false;
      }
      if (!ok) {
        ctx.addIssue({ code: "custom", path: ["elements", i, "elementType"], message: "not an element of this kind" });
        continue;
      }
      if (e.removed) continue;
      const parsed = elementAttributeSchema(e.elementType as never).safeParse(e.attributes);
      if (!parsed.success)
        ctx.addIssue({ code: "custom", path: ["elements", i, "attributes"], message: "invalid attributes" });
    }
  });
}

async function latestPublished(db: DbOrTx, kind: string, key: string): Promise<MethodologyVersionRow | undefined> {
  return db
    .selectFrom("methodology_version")
    .selectAll()
    .where("config_kind", "=", kind)
    .where("key", "=", key)
    .where("status", "=", "published")
    .orderBy("version_no", "desc")
    .limit(1)
    .executeTakeFirst();
}

/** The ADR-0039 §1 content of a stored version (elements in (elementType, stableKey) code-point order). */
export async function studioContentOf(db: DbOrTx, v: MethodologyVersionRow): Promise<StudioContent> {
  const elements = (await loadHashedElements(db, v.id))
    .map((e) => ({
      elementType: e.elementType,
      stableKey: e.stableKey,
      origin: e.origin as "source" | "admin",
      removed: e.removed,
      ordinal: e.ordinal,
      attributes: e.attributes as Record<string, unknown>,
    }))
    .sort((a, b) =>
      a.elementType === b.elementType
        ? a.stableKey < b.stableKey
          ? -1
          : a.stableKey > b.stableKey
            ? 1
            : 0
        : a.elementType < b.elementType
          ? -1
          : 1,
    );
  return {
    titleEn: v.title_en,
    titleAr: v.title_ar,
    definition: v.definition as Record<string, unknown>,
    elements,
  };
}

/** The role codes an approver attribute names (approverRoleCodes), for the reference check. */
function namedRoleCodes(content: StudioContent): string[] {
  const out = new Set<string>();
  for (const e of content.elements) {
    const codes = (e.attributes as { approverRoleCodes?: unknown }).approverRoleCodes;
    if (Array.isArray(codes)) for (const c of codes) if (typeof c === "string") out.add(c);
  }
  return [...out];
}

async function missingRoles(db: DbOrTx, codes: readonly string[]): Promise<boolean> {
  if (codes.length === 0) return false;
  const found = await db.selectFrom("role").select("code").where("code", "in", codes).execute();
  return found.length !== new Set(codes).size;
}

/**
 * "Draft from content" (ADR-0065 §5; additive): a new Studio draft of `kind`/`key` holding `content`, based on the
 * key's latest published version. The caller holds the configDraft lock and has checked that no open draft exists.
 * Audited per row (methodology_version.create_draft, methodology_element.put). Never publishes.
 */
export async function createDraftFromContent(
  ctx: WriteContext,
  kind: StudioKind,
  key: string,
  content: StudioContent,
): Promise<MethodologyVersionRow> {
  const { tx, request, userId } = ctx;
  const actor = requireStudioPermission(ctx.principal, "methodology.configure");
  const base = await latestPublished(tx, kind, key);
  if (base === undefined) throw studioRefusals.unknownElement();
  const open = await tx
    .selectFrom("methodology_version")
    .select("id")
    .where("config_kind", "=", kind)
    .where("key", "=", key)
    .where("status", "=", "draft")
    .where("draft_stage", "<>", "discarded")
    .executeTakeFirst();
  if (open !== undefined) throw studioRefusals.draftExists();
  const max = await tx
    .selectFrom("methodology_version")
    .select(sql<number>`max(version_no)`.as("n"))
    .where("key", "=", key)
    .executeTakeFirstOrThrow();
  const versionNo = Number(max.n) + 1;
  const id = uuidv7();
  const row = await tx
    .insertInto("methodology_version")
    .values({
      id,
      key,
      version_no: versionNo,
      status: "draft",
      title_en: content.titleEn,
      title_ar: content.titleAr,
      source_document: base.source_document,
      source_sha256: base.source_sha256,
      definition: JSON.stringify(content.definition),
      content_sha256: contentSha256(content),
      config_kind: kind,
      draft_stage: "editing",
      origin: "draft",
      based_on_version_id: base.id,
      change_summary: `Imported from configuration bundle import ${ctx.importId}.`,
      created_by: userId,
      updated_by: userId,
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
      config_kind: { from: null, to: kind },
      key: { from: null, to: key },
      config_bundle_import_id: { from: null, to: ctx.importId },
    },
  });
  for (const e of content.elements) {
    const elementId = uuidv7();
    await tx
      .insertInto("methodology_element")
      .values({
        id: elementId,
        methodology_version_id: id,
        element_type: e.elementType,
        stable_key: e.stableKey,
        origin: e.origin,
        removed: e.removed,
        ordinal: e.ordinal,
        attributes: JSON.stringify(e.attributes),
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await record(tx, audit, {
      action: "methodology_element.put",
      recordType: "methodology_element",
      recordId: elementId,
      organizationId: actor.organizationId,
      newVersion: 1,
      changes: {
        element_type: { from: null, to: e.elementType },
        stable_key: { from: null, to: e.stableKey },
        origin: { from: null, to: e.origin },
        removed: { from: null, to: e.removed },
        attributes: { from: null, to: e.attributes },
        ordinal: { from: null, to: e.ordinal },
      },
    });
  }
  return row;
}

export function studioBundleAdapter(kind: StudioKind): ConfigBundleKindAdapter {
  return {
    kind,
    contentSchema: studioContentSchema(kind),
    permitted: async (_db, principal, organizationId) =>
      holdsInOwnOrganization(principal, "methodology.configure", organizationId),
    async exportPublished(db): Promise<ExportedItem[]> {
      const keys = await db
        .selectFrom("methodology_version")
        .select("key")
        .distinct()
        .where("config_kind", "=", kind)
        .where("status", "=", "published")
        .orderBy("key")
        .execute();
      const out: ExportedItem[] = [];
      for (const { key } of keys) {
        const v = await latestPublished(db, kind, key);
        if (v === undefined) continue;
        out.push({ itemCode: key, sourceVersionNo: v.version_no, content: await studioContentOf(db, v) });
      }
      return out;
    },
    async plan(db, _organizationId, item): Promise<PlannedItem> {
      const content = studioContent.parse(item.content);
      if (await missingRoles(db, namedRoleCodes(content)))
        return { action: "refused", problemCode: "config_bundle.reference_missing" };
      const open = await db
        .selectFrom("methodology_version")
        .select("id")
        .where("config_kind", "=", kind)
        .where("key", "=", item.itemCode)
        .where("status", "=", "draft")
        .where("draft_stage", "<>", "discarded")
        .executeTakeFirst();
      if (open !== undefined) return { action: "conflict", problemCode: "config_bundle.open_draft_exists" };
      const published = await latestPublished(db, kind, item.itemCode);
      // No published base: a draft cannot be created without one (0062 lineage; ADR-0065 residual 2).
      if (published === undefined) return { action: "refused", problemCode: "config_bundle.kind_unavailable" };
      const current = contentSha256(await studioContentOf(db, published));
      return { action: current === item.contentSha256 ? "identical" : "new_draft" };
    },
    async write(ctx: WriteContext, item: BundleItemInput): Promise<WrittenRecord> {
      await lockConfigDraft(ctx.tx, kind, item.itemCode);
      const row = await createDraftFromContent(ctx, kind, item.itemCode, studioContent.parse(item.content));
      return { targetRecordType: "methodology_version", targetRecordId: row.id };
    },
  };
}

// ------------------------------------------------------------------------------------------------ review policies

const reviewPolicyContent = configReviewPolicyContent.extend({ reviewerRoleCode: z.string().min(1).max(64) });

export const configReviewPolicyBundleAdapter: ConfigBundleKindAdapter = {
  kind: "config_review_policy",
  contentSchema: reviewPolicyContent,
  permitted: async (_db, principal, organizationId) =>
    holdsInOwnOrganization(principal, "config_review_policy.configure", organizationId),
  async exportPublished(db): Promise<ExportedItem[]> {
    const rows = await db.selectFrom("config_review_policy").selectAll().orderBy("config_kind").execute();
    return rows.map((r) => ({
      itemCode: r.config_kind,
      sourceVersionNo: r.version,
      content: { reviewRequired: r.review_required, reviewerRoleCode: r.reviewer_role_code },
    }));
  },
  async plan(db, _organizationId, item): Promise<PlannedItem> {
    const content = reviewPolicyContent.parse(item.content);
    const row = await db
      .selectFrom("config_review_policy")
      .selectAll()
      .where("config_kind", "=", item.itemCode)
      .executeTakeFirst();
    // The rows are seeded per kind; updateConfigReviewPolicy never creates one.
    if (row === undefined) return { action: "refused", problemCode: "config_bundle.kind_unavailable" };
    if (await missingRoles(db, [content.reviewerRoleCode]))
      return { action: "refused", problemCode: "config_bundle.reference_missing" };
    const same = row.review_required === content.reviewRequired && row.reviewer_role_code === content.reviewerRoleCode;
    return { action: same ? "identical" : "new_draft" };
  },
  async write(ctx, item): Promise<WrittenRecord> {
    const { tx, request, userId } = ctx;
    const actor = requireStudioPermission(ctx.principal, "config_review_policy.configure");
    const content = reviewPolicyContent.parse(item.content);
    const current = await tx
      .selectFrom("config_review_policy")
      .selectAll()
      .where("config_kind", "=", item.itemCode)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const role = await tx
      .selectFrom("role")
      .select(["code", "kind"])
      .where("code", "=", content.reviewerRoleCode)
      .executeTakeFirst();
    // The updateConfigReviewPolicy rule: the auditor reads only; an administrator role would review its own work.
    if (role === undefined || role.code === "AUD" || role.kind === "technical_admin")
      throw studioRefusals.reviewerNotAllowed();
    const updated = await tx
      .updateTable("config_review_policy")
      .set({
        review_required: content.reviewRequired,
        reviewer_role_code: content.reviewerRoleCode,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: userId,
      })
      .where("id", "=", current.id)
      .where("version", "=", current.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    const changes = new Map<string, { from: unknown; to: unknown }>();
    if (content.reviewRequired !== current.review_required)
      changes.set("review_required", { from: current.review_required, to: content.reviewRequired });
    if (content.reviewerRoleCode !== current.reviewer_role_code)
      changes.set("reviewer_role_code", { from: current.reviewer_role_code, to: content.reviewerRoleCode });
    await record(tx, auditContextOf(request), {
      action: "config_review_policy.update",
      recordType: "config_review_policy",
      recordId: current.id,
      organizationId: actor.organizationId,
      priorVersion: current.version,
      newVersion: updated.version,
      reason: `Configuration bundle import ${ctx.importId}`,
      changes: Object.fromEntries(changes),
    });
    return { targetRecordType: "config_review_policy", targetRecordId: current.id };
  },
};

/** Every adapter of the methodology module, in the ADR-0065 §1 order (server.ts registers them). */
export const METHODOLOGY_BUNDLE_ADAPTERS: readonly ConfigBundleKindAdapter[] = [
  studioBundleAdapter("methodology"),
  studioBundleAdapter("scoring_defaults"),
  studioBundleAdapter("form_schema"),
  studioBundleAdapter("procedure"),
  studioBundleAdapter("automation_rule_set"),
  studioBundleAdapter("health_check_scheme"),
  configReviewPolicyBundleAdapter,
];
