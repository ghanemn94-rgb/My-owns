// Configuration transfer adapters of the admin module (P7 slice D; ADR-0065 §1, §6; T-DG7-BE-F).
//
// upload_policy: one item per organization, itemCode `upload_policy`, content { allowedTypes, maxBytes } (the
// putUploadPolicy body without its reason; the import's reason names the bundle import). No draft stage: applied on
// commit like putUploadPolicy (upload_policy.configure at the organization, create or version + 1, audit
// upload_policy.changed). An organization still on the default policy exports nothing for this kind.
//
// branding: one item per organization, itemCode `branding`, content = the current branding version's settings (names,
// colours and their approval reference, fonts, the logo as base64 PNG with its alternative texts, report header and
// footer texts). No draft stage: applied on commit through `publishBranding` (branding.ts) exactly like
// putBrandingSettings: branding.configure in the caller's organization, the §11 rules, the ADR-0061 contrast rule, the
// brandingPublish lock, version n+1 made current, audit branding_version.create and its contrast report. An
// organization still on the default branding exports nothing for this kind. #0078FF stays a provisional token.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { UPLOAD_POLICY_MAX_BYTES, UPLOAD_TYPES, uploadType } from "@mth/shared/schemas";
import { canonicalBundleJson, uploadPolicyContent } from "@mth/shared/transfer";
import type { ConfigBundleKindAdapterPort, PlannedBundleItem, WrittenBundleRecord } from "@mth/shared/transfer";
import type { FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  brandingSettingsPutBody,
  brandingPortFor,
  checkBrandingContrastRule,
  checkBrandingRules,
  publishBranding,
  type BrandingSettingsPutBody,
  type BrandingTokenSource,
} from "./branding.ts";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  requireAction,
  resolveTarget,
  type Principal,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import { problems } from "../platform/index.ts";

// The ConfigBundleKindAdapter port with the API's types (@mth/shared/transfer; this module never imports transfer).
type ConfigBundleKindAdapter = ConfigBundleKindAdapterPort<DbOrTx, Tx, FastifyRequest, Principal>;
type PlannedItem = PlannedBundleItem;
type WrittenRecord = WrittenBundleRecord;

export const UPLOAD_POLICY_ITEM = "upload_policy";

const content = uploadPolicyContent.extend({
  allowedTypes: z.array(uploadType).min(1).max(UPLOAD_TYPES.length),
  maxBytes: z.number().int().min(1).max(UPLOAD_POLICY_MAX_BYTES),
});
/** The putUploadPolicy order of the allow-list (UPLOAD_TYPES order, no repeats). */
const sorted = (types: readonly string[]) => {
  const set = new Set(types);
  return UPLOAD_TYPES.filter((t) => set.has(t));
};

async function rowOf(db: DbOrTx, organizationId: string) {
  return db.selectFrom("upload_policy").selectAll().where("organization_id", "=", organizationId).executeTakeFirst();
}

export const uploadPolicyBundleAdapter: ConfigBundleKindAdapter = {
  kind: "upload_policy",
  contentSchema: content,
  async permitted(db, principal, organizationId) {
    const target = await resolveTarget(db, { type: "organization", id: organizationId });
    return target !== null && (await authorize(db, principal, "upload_policy.configure", target)).allowed;
  },
  async exportPublished(db, organizationId) {
    const r = await rowOf(db, organizationId);
    if (r === undefined) return [];
    return [
      {
        itemCode: UPLOAD_POLICY_ITEM,
        sourceVersionNo: r.version,
        content: { allowedTypes: sorted(r.allowed_types), maxBytes: Number(r.max_bytes) },
      },
    ];
  },
  async plan(db, organizationId, item): Promise<PlannedItem> {
    if (item.itemCode !== UPLOAD_POLICY_ITEM)
      return { action: "refused", problemCode: "config_bundle.kind_unavailable" };
    const c = content.parse(item.content);
    const r = await rowOf(db, organizationId);
    if (r === undefined) return { action: "create_draft" };
    const same =
      canonicalBundleJson({ allowedTypes: sorted(r.allowed_types), maxBytes: Number(r.max_bytes) }) ===
      canonicalBundleJson({ allowedTypes: sorted(c.allowedTypes), maxBytes: c.maxBytes });
    return { action: same ? "identical" : "new_draft" };
  },
  async write(ctx, item): Promise<WrittenRecord> {
    const { tx, request, principal, organizationId, userId } = ctx;
    const target = await resolveTarget(tx, { type: "organization", id: organizationId });
    if (target === null) throw problems.notFound();
    try {
      await requireAction(tx, principal, "upload_policy.configure", target);
    } catch (err) {
      throw commitTimeDenial(err);
    }
    const c = content.parse(item.content);
    const allowedTypes = sorted(c.allowedTypes);
    const reason = `Configuration bundle import ${ctx.importId}`;
    const current = await tx
      .selectFrom("upload_policy")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .forUpdate()
      .executeTakeFirst();
    const values = { allowed_types: allowedTypes, max_bytes: c.maxBytes, reason };
    const row = current
      ? await tx
          .updateTable("upload_policy")
          .set({ ...values, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: userId })
          .where("id", "=", current.id)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await tx
          .insertInto("upload_policy")
          .values({ id: uuidv7(), organization_id: organizationId, ...values, created_by: userId, updated_by: userId })
          .returningAll()
          .executeTakeFirstOrThrow();
    await record(tx, auditContextOf(request), {
      action: "upload_policy.changed",
      recordType: "upload_policy",
      recordId: row.id,
      organizationId,
      priorVersion: current?.version ?? null,
      newVersion: row.version,
      reason,
      changes: {
        allowed_types: { from: current ? sorted(current.allowed_types) : null, to: allowedTypes },
        max_bytes: { from: current ? Number(current.max_bytes) : null, to: c.maxBytes },
      },
    });
    return { targetRecordType: "upload_policy", targetRecordId: row.id };
  },
};

// ------------------------------------------------------------------------------------------------ branding

export const BRANDING_ITEM = "branding";

/** The transferable settings of a branding version (the putBrandingSettings body, the logo inline, no change note). */
const brandingContent = z.strictObject({
  productNameEn: z.string(),
  productNameAr: z.string(),
  primaryColour: z.string(),
  secondaryColour: z.string(),
  colourApprovalReference: z.string().nullable(),
  fontLatin: z.string(),
  fontArabic: z.string(),
  logo: z
    .strictObject({ pngBase64: z.string(), altEn: z.string().nullable(), altAr: z.string().nullable() })
    .nullable(),
  reportHeaderEn: z.string().nullable(),
  reportHeaderAr: z.string().nullable(),
  reportFooterEn: z.string().nullable(),
  reportFooterAr: z.string().nullable(),
});
type BrandingContent = z.infer<typeof brandingContent>;

function putBodyOf(c: BrandingContent, importId: string): BrandingSettingsPutBody {
  return brandingSettingsPutBody.parse({
    productNameEn: c.productNameEn,
    productNameAr: c.productNameAr,
    primaryColour: c.primaryColour,
    secondaryColour: c.secondaryColour,
    colourApprovalReference: c.colourApprovalReference,
    fontLatin: c.fontLatin,
    fontArabic: c.fontArabic,
    logo:
      c.logo === null
        ? { mode: "none" }
        : {
            mode: "set",
            pngBase64: c.logo.pngBase64,
            ...(c.logo.altEn !== null ? { altEn: c.logo.altEn } : {}),
            ...(c.logo.altAr !== null ? { altAr: c.logo.altAr } : {}),
          },
    reportHeaderEn: c.reportHeaderEn,
    reportHeaderAr: c.reportHeaderAr,
    reportFooterEn: c.reportFooterEn,
    reportFooterAr: c.reportFooterAr,
    changeNote: `Imported from configuration bundle import ${importId}.`,
  });
}

async function currentBrandingVersion(db: DbOrTx, organizationId: string) {
  const head = await db
    .selectFrom("branding_setting")
    .select(["current_version_no", "version"])
    .where("organization_id", "=", organizationId)
    .executeTakeFirst();
  if (head === undefined) return undefined;
  const v = await db
    .selectFrom("branding_version")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("version_no", "=", head.current_version_no)
    .executeTakeFirstOrThrow();
  const content: BrandingContent = {
    productNameEn: v.product_name_en,
    productNameAr: v.product_name_ar,
    primaryColour: v.primary_colour,
    secondaryColour: v.secondary_colour,
    colourApprovalReference: v.colour_approval_reference,
    fontLatin: v.font_latin,
    fontArabic: v.font_arabic,
    logo:
      v.logo_png === null
        ? null
        : { pngBase64: Buffer.from(v.logo_png).toString("base64"), altEn: v.logo_alt_en, altAr: v.logo_alt_ar },
    reportHeaderEn: v.report_header_en,
    reportHeaderAr: v.report_header_ar,
    reportFooterEn: v.report_footer_en,
    reportFooterAr: v.report_footer_ar,
  };
  return { head, version: v, content };
}

const holdsBrandingConfigure = (principal: Principal, organizationId: string): boolean =>
  principal.organizationId === organizationId &&
  principal.userId !== null &&
  principal.grants.some((g) => g.permissions.has("branding.configure") && g.organizationId === organizationId);

/** The branding adapter, bound to the token source the branding routes use (server.ts passes the same object). */
export function brandingBundleAdapter(source: BrandingTokenSource): ConfigBundleKindAdapter {
  const port = brandingPortFor(source);
  const contrastRule = () => {
    if (source.checkBrandingContrast === undefined || source.tokenSourceSha256 === undefined)
      throw new Error("branding bundle adapter: the token source needs checkBrandingContrast and tokenSourceSha256");
    return { check: source.checkBrandingContrast, tokenSourceSha256: source.tokenSourceSha256 };
  };
  return {
    kind: "branding",
    // The shape here; the §11 rules and the contrast rule are the branding module's own (checked at upload, again at
    // commit inside publishBranding's path).
    contentSchema: brandingContent.superRefine((c, ctx) => {
      try {
        const body = putBodyOf(c, "upload");
        checkBrandingRules(body);
        checkBrandingContrastRule(contrastRule(), body);
      } catch {
        ctx.addIssue({ code: "custom", message: "branding settings refused by the branding rules" });
      }
    }),
    permitted: async (_db, principal, organizationId) => holdsBrandingConfigure(principal, organizationId),
    async exportPublished(db, organizationId) {
      const cur = await currentBrandingVersion(db, organizationId);
      return cur === undefined
        ? []
        : [{ itemCode: BRANDING_ITEM, sourceVersionNo: cur.version.version_no, content: cur.content }];
    },
    async plan(db, organizationId, item): Promise<PlannedItem> {
      if (item.itemCode !== BRANDING_ITEM) return { action: "refused", problemCode: "config_bundle.kind_unavailable" };
      const cur = await currentBrandingVersion(db, organizationId);
      if (cur === undefined) return { action: "create_draft" };
      return {
        action: canonicalBundleJson(cur.content) === canonicalBundleJson(item.content) ? "identical" : "new_draft",
      };
    },
    async write(ctx, item): Promise<WrittenRecord> {
      const { tx, request, principal, organizationId, userId } = ctx;
      if (!holdsBrandingConfigure(principal, organizationId)) throw problems.forbidden();
      const body = putBodyOf(brandingContent.parse(item.content), ctx.importId);
      checkBrandingRules(body);
      const contrast = contrastRule();
      const pairs = checkBrandingContrastRule(contrast, body);
      const head = await tx
        .selectFrom("branding_setting")
        .select("version")
        .where("organization_id", "=", organizationId)
        .executeTakeFirst();
      await publishBranding(tx, port, request, { userId, organizationId }, head?.version ?? 0, body, {
        pairs,
        tokenSourceSha256: contrast.tokenSourceSha256,
      });
      const cur = await currentBrandingVersion(tx, organizationId);
      return { targetRecordType: "branding_version", targetRecordId: cur!.version.id };
    },
  };
}
