// Branding design tokens (REQ-S15-002). Zod mirror of the OpenAPI `BrandingTokens` schema (docs/api/openapi.yaml,
// operation getBrandingTokens); keep both in lockstep. `provenance` stays "provisional" while the seeded §15 tokens
// are unverified. #0078FF is a provisional brand token, not a verified Mobily colour.
import { z } from "zod";

export const brandingProvenance = z.enum(["provisional", "official"]);
export type BrandingProvenance = z.infer<typeof brandingProvenance>;

export const brandingToken = z.strictObject({
  name: z.string(),
  value: z.string(),
  purpose: z.string().optional(),
  provisional: z.boolean(),
});
export type BrandingToken = z.infer<typeof brandingToken>;

export const brandingTokens = z.strictObject({
  provenance: brandingProvenance,
  tokens: z.array(brandingToken),
});
export type BrandingTokens = z.infer<typeof brandingTokens>;

// ------------------------------------------------------------------------------------------------ versioned branding
// P5 slice I (T-DG5-BE-R; ADR-0049 §8, §11; REQ-S15-004, REQ-S01-002): zod mirrors of the OpenAPI components
// BrandingLogo, Branding, BrandingSettings, BrandingVersion, BrandingVersionPage and the strict response shapes. Version 0
// is the shipped default ("Mobily Transformation Hub", the provisional design-token colours, the provisional text
// wordmark). Branding is configuration, not a business approval: an approval reference records the admin's own brand
// approval, and the platform approves nothing. #0078FF stays provisional until such a reference is recorded.
const brandingTimestamp = z.iso.datetime({ offset: true });
const brandingUuid = z.uuid();
const hexColour = z.string().regex(/^#[0-9A-F]{6}$/);

/** The only selectable fonts: the locally bundled OFL pair (no font CDN, M0301). */
export const BRANDING_FONT_LATIN = "IBM Plex Sans";
export const BRANDING_FONT_ARABIC = "IBM Plex Sans Arabic";

export const brandingLogo = z.strictObject({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  altEn: z.string(),
  altAr: z.string(),
  url: z.string(),
});
export type BrandingLogo = z.infer<typeof brandingLogo>;

const brandingCurrentShape = {
  versionNo: z.number().int().min(0),
  source: z.enum(["default", "configured"]),
  productNameEn: z.string(),
  productNameAr: z.string(),
  primaryColour: hexColour,
  secondaryColour: hexColour,
  coloursProvisional: z.boolean(),
  fontLatin: z.literal(BRANDING_FONT_LATIN),
  fontArabic: z.literal(BRANDING_FONT_ARABIC),
  logo: brandingLogo.nullable(),
  wordmarkProvisional: z.boolean(),
  reportHeaderEn: z.string().nullable(),
  reportHeaderAr: z.string().nullable(),
  reportFooterEn: z.string().nullable(),
  reportFooterAr: z.string().nullable(),
};

/** `getBranding`: the current published branding (version 0 = the defaults). */
export const branding = z.strictObject(brandingCurrentShape);
export type Branding = z.infer<typeof branding>;

/** `getBrandingSettings` / `putBrandingSettings`: the current branding plus the head row's concurrency fields. */
export const brandingSettings = z.strictObject({
  ...brandingCurrentShape,
  colourApprovalReference: z.string().nullable(),
  version: z.number().int().min(0),
  updatedAt: brandingTimestamp.nullable(),
  updatedBy: brandingUuid.nullable(),
});
export type BrandingSettings = z.infer<typeof brandingSettings>;

/** One immutable branding version. */
export const brandingVersion = z.strictObject({
  versionNo: z.number().int().min(1),
  productNameEn: z.string(),
  productNameAr: z.string(),
  primaryColour: hexColour,
  secondaryColour: hexColour,
  coloursProvisional: z.boolean(),
  colourApprovalReference: z.string().nullable(),
  fontLatin: z.string(),
  fontArabic: z.string(),
  logo: brandingLogo.nullable(),
  reportHeaderEn: z.string().nullable(),
  reportHeaderAr: z.string().nullable(),
  reportFooterEn: z.string().nullable(),
  reportFooterAr: z.string().nullable(),
  changeNote: z.string().nullable(),
  createdAt: brandingTimestamp,
  createdBy: brandingUuid,
});
export type BrandingVersion = z.infer<typeof brandingVersion>;

export const brandingVersionPage = z.strictObject({
  items: z.array(brandingVersion),
  nextCursor: z.string().nullable(),
});
export type BrandingVersionPage = z.infer<typeof brandingVersionPage>;

/**
 * The outbox event `branding.published` (ADR-0049 §12, schema_version 1): a new branding version is current; the web
 * theme cache refreshes. Written with the version's audit events in one transaction.
 */
export const brandingPublishedV1 = z.strictObject({ organizationId: brandingUuid, versionNo: z.number().int().min(1) });
export type BrandingPublishedV1 = z.infer<typeof brandingPublishedV1>;
