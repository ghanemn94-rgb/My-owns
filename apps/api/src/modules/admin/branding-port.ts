// The branding read port (P5 slice I; ADR-0049 §8 "render-time reads"; REQ-S15-004, REQ-S01-002; p5-work-split §I.3;
// T-DG5-BE-R). `BrandingReadPort.current(db, organizationId)` returns the organization's CURRENT published branding
// at the moment it is called: screens read it on every request, and generated outputs read it at generation time, so
// a new branding version reaches the next screen and the next generated file without a code change or redeploy.
//
// Version 0 (no branding_setting row) is the shipped default: the product name "Mobily Transformation Hub" /
// "منصة موبايلي للتحوّل" (the shipped i18n texts), the provisional design-token colours (#0078FF is a PROVISIONAL brand
// token, not a verified Mobily colour), the bundled fonts, no logo (so the shell shows the provisional text wordmark)
// and no report header or footer beyond the ADR-0045 defaults. The default colours are injected by the composition root
// from the single token source (ADR-0009), so this file imports no workspace package outside the ADR-0002 allow-list.
//
// Branding is configuration, never a business approval: colours count as approved only when the admin recorded the
// reference of a brand approval they hold, and nothing here approves anything.
import type { DbOrTx } from "@mth/db";
import { BRANDING_FONT_ARABIC, BRANDING_FONT_LATIN, branding, type Branding } from "@mth/shared/schemas";

/** The shipped product name (the DG1 i18n texts `common.productName`, en and ar). */
export const DEFAULT_PRODUCT_NAME_EN = "Mobily Transformation Hub";
export const DEFAULT_PRODUCT_NAME_AR = "منصة موبايلي للتحوّل";
/** The URL of the current logo (getBrandingLogo). */
export const BRANDING_LOGO_URL = "/api/v1/branding/logo";

/** The version-0 colours: the token source's `brand.primary` and `brand.deep` (both provisional). */
export interface BrandingDefaults {
  readonly primaryColour: string;
  readonly secondaryColour: string;
}

/** The current branding as the contract shows it, plus the logo bytes for a renderer (null without a logo). */
export interface CurrentBranding extends Branding {
  readonly logoPng: Buffer | null;
  /** The head row's version and audit fields (0 / null for version 0). */
  readonly head: {
    readonly version: number;
    readonly colourApprovalReference: string | null;
    readonly updatedAt: Date | null;
    readonly updatedBy: string | null;
  };
}

export interface BrandingReadPort {
  current(db: DbOrTx, organizationId: string | null): Promise<CurrentBranding>;
}

/** The selectable columns of a branding version without the logo bytes (lists never carry them). */
export const BRANDING_VERSION_COLUMNS = [
  "id",
  "organization_id",
  "version_no",
  "product_name_en",
  "product_name_ar",
  "primary_colour",
  "secondary_colour",
  "colours_provisional",
  "colour_approval_reference",
  "font_latin",
  "font_arabic",
  "logo_sha256",
  "logo_alt_en",
  "logo_alt_ar",
  "report_header_en",
  "report_header_ar",
  "report_footer_en",
  "report_footer_ar",
  "change_note",
  "created_at",
  "created_by",
] as const;

/** The version-0 defaults (no row): see the header. */
export function defaultBranding(defaults: BrandingDefaults): CurrentBranding {
  return {
    ...branding.parse({
      versionNo: 0,
      source: "default",
      productNameEn: DEFAULT_PRODUCT_NAME_EN,
      productNameAr: DEFAULT_PRODUCT_NAME_AR,
      primaryColour: defaults.primaryColour,
      secondaryColour: defaults.secondaryColour,
      coloursProvisional: true,
      fontLatin: BRANDING_FONT_LATIN,
      fontArabic: BRANDING_FONT_ARABIC,
      logo: null,
      wordmarkProvisional: true,
      reportHeaderEn: null,
      reportHeaderAr: null,
      reportFooterEn: null,
      reportFooterAr: null,
    }),
    logoPng: null,
    head: { version: 0, colourApprovalReference: null, updatedAt: null, updatedBy: null },
  };
}

/** The port: one read of the head row joined to its current version (with the logo bytes). */
export function createBrandingReadPort(defaults: BrandingDefaults): BrandingReadPort {
  return {
    async current(db, organizationId) {
      if (organizationId === null) return defaultBranding(defaults);
      const row = await db
        .selectFrom("branding_setting as s")
        .innerJoin("branding_version as v", (j) =>
          j.onRef("v.organization_id", "=", "s.organization_id").onRef("v.version_no", "=", "s.current_version_no"),
        )
        .select([
          "s.version",
          "s.updated_at",
          "s.updated_by",
          "v.version_no",
          "v.product_name_en",
          "v.product_name_ar",
          "v.primary_colour",
          "v.secondary_colour",
          "v.colours_provisional",
          "v.colour_approval_reference",
          "v.font_latin",
          "v.font_arabic",
          "v.logo_png",
          "v.logo_sha256",
          "v.logo_alt_en",
          "v.logo_alt_ar",
          "v.report_header_en",
          "v.report_header_ar",
          "v.report_footer_en",
          "v.report_footer_ar",
        ])
        .where("s.organization_id", "=", organizationId)
        .executeTakeFirst();
      if (row === undefined) return defaultBranding(defaults);
      const logo =
        row.logo_sha256 === null
          ? null
          : {
              sha256: row.logo_sha256,
              altEn: row.logo_alt_en ?? "",
              altAr: row.logo_alt_ar ?? "",
              url: BRANDING_LOGO_URL,
            };
      return {
        ...branding.parse({
          versionNo: row.version_no,
          source: "configured",
          productNameEn: row.product_name_en,
          productNameAr: row.product_name_ar,
          primaryColour: row.primary_colour,
          secondaryColour: row.secondary_colour,
          coloursProvisional: row.colours_provisional,
          fontLatin: row.font_latin,
          fontArabic: row.font_arabic,
          logo,
          // The provisional text wordmark is shown exactly while no logo is configured (M0301).
          wordmarkProvisional: logo === null,
          reportHeaderEn: row.report_header_en,
          reportHeaderAr: row.report_header_ar,
          reportFooterEn: row.report_footer_en,
          reportFooterAr: row.report_footer_ar,
        }),
        logoPng: row.logo_png,
        head: {
          version: row.version,
          colourApprovalReference: row.colour_approval_reference,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
        },
      };
    },
  };
}
