// Branding (REQ-S15-002, REQ-S15-004, REQ-S01-002; ADR-0009, ADR-0049 §8, §10-§12; p5-work-split §I.3; T-DG5-BE-R):
//   GET  /branding/tokens                    getBrandingTokens     (session; DG1 shape unchanged)
//   GET  /branding                           getBranding           (session: every signed-in user)
//   GET  /branding/logo                      getBrandingLogo       (session; image/png, or 404 branding.logo_not_found)
//   GET  /admin/branding                     getBrandingSettings   (branding.configure; ETag "0" when never saved)
//   PUT  /admin/branding                     putBrandingSettings   (branding.configure; If-Match the head, "0" first)
//   GET  /admin/branding/versions            listBrandingVersions  (branding.configure; newest first)
//   GET  /admin/branding/versions/{no}       getBrandingVersion    (branding.configure)
//   GET  /admin/branding/versions/{no}/contrast getBrandingVersionContrast (branding.configure; P6, ADR-0061 §5)
//
// At DG1 the token set was read-only. Since P5 it is editable through Branding Settings: every save publishes a new
// immutable branding version, and the token route merges the current version's two colours into the static token set
// and derives the accessible action shades from them at read time (the ADR-0009 §3 rule). The token source and the
// derivation are injected by the composition root (server.ts reads @mth/design-tokens, the single token source per
// ADR-0009), so this module imports no workspace package outside the ADR-0002 allow-list.
//
// Publish (ADR-0049 §8, §12): one transaction re-checks branding.configure on grants reloaded in it (commit-time
// authorization), takes the transaction lock of class brandingPublish (the registry's; key: the organization id),
// compares If-Match with the head version (428 missing, 409 stale; "0" creates), inserts version n+1 and the head (or
// steps it), each with its audit event, and writes one outbox event `branding.published`. No remote I/O inside the
// transaction.
//
// P6 contrast rule (T-DG6-BE-W; ADR-0061 §1, §2, §6; REQ-S15-003): after checkBrandingRules() and BEFORE the
// transaction, the publish evaluates every declared token pair with the request's two colours (the injected
// `checkBrandingContrast`, pure) and answers 422 branding.contrast_insufficient with one `errors` item per failing pair
// when any is below its threshold; nothing is written. Inside the transaction, after the version insert, it writes the
// version's branding_contrast_report, its pairs in declared order and the audit event branding_contrast_report.recorded
// (0119 requires the report at COMMIT). Only the declared pairs decide; the prohibited pairs are a build-time check.
//
// #0078FF is a provisional brand token, not a verified Mobily colour; colours count as approved only with the approval
// reference an admin records, and nothing here claims official brand compliance or approves anything. Branding is
// configuration, never a business approval, and nothing here reads or writes the engineering delivery gates.
import { createHash } from "node:crypto";
import { sql, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import {
  BRANDING_FONT_ARABIC,
  BRANDING_FONT_LATIN,
  branding as brandingSchema,
  brandingContrastReport,
  brandingSettings,
  brandingTokens,
  brandingVersion,
  brandingVersionPage,
  freeText,
  type Branding,
  type BrandingContrastReport,
  type BrandingSettings,
  type BrandingTokens,
  type BrandingVersion,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, denialOf, principalOf, refreshPrincipal, type Principal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { enqueueOutboxEvent } from "../jobs/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  cursorSchema,
  decodeCursor,
  etag,
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
  type ModuleDeps,
} from "../platform/index.ts";
import {
  BRANDING_LOGO_URL,
  BRANDING_VERSION_COLUMNS,
  createBrandingReadPort,
  readContrastReport,
  type BrandingReadPort,
  type CurrentBranding,
} from "./branding-port.ts";

const TOKENS = "/api/v1/branding/tokens";
const CURRENT = "/api/v1/branding";
const LOGO = "/api/v1/branding/logo";
const SETTINGS = "/api/v1/admin/branding";
const VERSIONS = "/api/v1/admin/branding/versions";
const VERSION = "/api/v1/admin/branding/versions/:versionNo";
const VERSION_CONTRAST = "/api/v1/admin/branding/versions/:versionNo/contrast";
const CONFIGURE: Permission = "branding.configure";
const JSON_BODY = ["application/json"] as const;
export const BRANDING_PUBLISHED_EVENT = "branding.published";

// ------------------------------------------------------------------------------------------------ the token source
/** Structural view of `@mth/design-tokens` (`colorTokens`, `tokensAreProvisional`, and the derivation of ADR-0009 §3). */
export interface BrandingTokenSource {
  readonly colorTokens: Readonly<
    Record<string, { readonly value: string; readonly purpose: string; readonly provisional: boolean }>
  >;
  readonly tokensAreProvisional: boolean;
  /**
   * The rule-derived tokens of the source (`tokenSource.derived`; `$comment` keys are skipped) and the ADR-0009 §3
   * function that derives them (`deriveDarkerShade`). When both are given, the token route re-derives each shade from
   * the CURRENT branding colours at read time, so a new primary colour changes the action shade too.
   */
  readonly derived?: Readonly<Record<string, unknown>>;
  readonly deriveDarkerShade?: (base: string, against: readonly string[], target: number) => string;
  /**
   * P6 (ADR-0061 §1.1): every declared contrast pair evaluated with the two branding colours, in declared order, each
   * with the field its failure is reported on (`@mth/design-tokens` checkBrandingContrast + contrastPointer). Required
   * when the routes are registered with `deps`: the publish never runs without the contrast rule.
   */
  readonly checkBrandingContrast?: (primary: string, secondary: string) => readonly BrandingContrastResult[];
  /** P6 (ADR-0061 §1.3): the SHA-256 (lower-case hex) of the bytes of the tokens.json the server loaded. */
  readonly tokenSourceSha256?: string;
}

/** One evaluated declared pair (the structural view of `@mth/design-tokens` PairResult plus its pointer). */
export interface BrandingContrastResult {
  readonly fg: string;
  readonly bg: string;
  readonly use: "text" | "large-text" | "ui";
  readonly note: string;
  readonly fgHex: string;
  readonly bgHex: string;
  /** Rounded down to two decimals (floor2). */
  readonly ratio: number;
  readonly threshold: number;
  readonly pass: boolean;
  readonly pointer: "/primaryColour" | "/secondaryColour";
}

/** The contrast members a publish needs (checked once, at registration). */
interface ContrastRule {
  readonly check: (primary: string, secondary: string) => readonly BrandingContrastResult[];
  readonly tokenSourceSha256: string;
}

interface DerivedSpec {
  readonly value: string;
  readonly purpose: string;
  readonly derivedFrom: string;
  readonly rule: { readonly darkenUntil: number; readonly against: readonly string[] };
  readonly provisional: boolean;
}

/** The token names the two branding colours replace (ADR-0049 §8: the secondary colour is `brand.deep`). */
const PRIMARY_TOKEN = "brand.primary";
const SECONDARY_TOKEN = "brand.deep";

/**
 * Maps the token source to the contract shape. Fails safe: provenance is "official" only when the source says the
 * set is not provisional AND no single token is provisional, so a partly unverified set is never reported official.
 * The output is validated against the shared zod mirror, so a drift from the contract fails loudly, not silently.
 *
 * With `current` (a branding version), the two brand colours are that version's (provisional exactly when its colours
 * are), and every derived token of the source is re-derived from them by the ADR-0009 §3 rule and appended.
 */
export function toBrandingTokens(
  source: BrandingTokenSource,
  current?: Pick<Branding, "primaryColour" | "secondaryColour" | "coloursProvisional">,
): BrandingTokens {
  const tokens = Object.entries(source.colorTokens).map(([name, t]) => {
    if (current !== undefined && (name === PRIMARY_TOKEN || name === SECONDARY_TOKEN))
      return {
        name,
        value: name === PRIMARY_TOKEN ? current.primaryColour : current.secondaryColour,
        purpose: t.purpose,
        provisional: t.provisional || current.coloursProvisional,
      };
    return { name, value: t.value, purpose: t.purpose, provisional: t.provisional };
  });
  if (current !== undefined && source.derived !== undefined && source.deriveDarkerShade !== undefined) {
    const valueOf = new Map(tokens.map((t) => [t.name, t] as const));
    for (const [name, raw] of Object.entries(source.derived)) {
      if (name.startsWith("$")) continue;
      const spec = raw as DerivedSpec;
      const base = valueOf.get(spec.derivedFrom);
      const against = spec.rule.against.map((k) => valueOf.get(k)?.value);
      if (base === undefined || against.some((a) => a === undefined)) continue;
      tokens.push({
        name,
        value: source.deriveDarkerShade(base.value, against as string[], spec.rule.darkenUntil),
        purpose: spec.purpose,
        provisional: spec.provisional || base.provisional,
      });
    }
  }
  const provisional = source.tokensAreProvisional || tokens.some((t) => t.provisional);
  return brandingTokens.parse({ provenance: provisional ? "provisional" : "official", tokens });
}

// ------------------------------------------------------------------------------------------------ refusals
/** ADR-0061 §6, verbatim (the same text as platform/db-errors.ts BRANDING_CONTRAST_INSUFFICIENT_DETAIL; a test pins both). */
export const BRANDING_CONTRAST_INSUFFICIENT_TEXT =
  "These colours do not meet the contrast rules: at least one text or control combination is below 4.5:1 (3:1 for large text and controls). Nothing was published.";
/** The stored `numeric(4,2)` ratio text (already rounded down), e.g. "1.40". */
const ratioText = (ratio: number): string => ratio.toFixed(2);
/** The stored `numeric(2,1)` threshold text: "4.5" or "3.0". */
const thresholdText = (threshold: number): string => threshold.toFixed(1);
/** The closed rule set of a stored report (0113). */
export const BRANDING_CONTRAST_RULES = "wcag2x-aa-v1";
export const BRANDING_CONTRAST_REPORT_RECORDED = "branding_contrast_report.recorded";

/**
 * ADR-0061 §1.2: every declared pair with the request's colours; 422 branding.contrast_insufficient when any fails.
 * Runs after checkBrandingRules() (so both colours are valid upper-case #RRGGBB) and before the transaction. Returns
 * the evaluated pairs, which the transaction stores as the version's report.
 */
export function checkBrandingContrastRule(
  rule: Pick<ContrastRule, "check">,
  body: Pick<BrandingSettingsPutBody, "primaryColour" | "secondaryColour">,
): readonly BrandingContrastResult[] {
  const pairs = rule.check(body.primaryColour, body.secondaryColour);
  const failing = pairs.filter((p) => !p.pass);
  if (failing.length > 0) throw brandingRefusals.contrastInsufficient(failing);
  return pairs;
}
/** ADR-0049 §11 (exact English texts). */
export const brandingRefusals = {
  prohibitedClaim: () =>
    problems.businessRule(
      "branding.prohibited_claim",
      "Branding text must not claim official PMI status or certification.",
    ),
  engineeringGate: () =>
    problems.businessRule(
      "branding.engineering_gate_reference",
      "Branding text must not name an engineering delivery gate.",
    ),
  logoInvalid: () =>
    problems.businessRule(
      "branding.logo_invalid",
      "The logo must be a PNG image of at most 256 KiB, with alternative text in English and Arabic.",
    ),
  colourInvalid: () =>
    problems.businessRule("branding.colour_invalid", "Colours must be six-digit hexadecimal values such as #0078FF."),
  fontUnavailable: () =>
    problems.businessRule(
      "branding.font_unavailable",
      "Only the bundled fonts IBM Plex Sans and IBM Plex Sans Arabic can be selected.",
    ),
  textPairRequired: () =>
    problems.businessRule(
      "branding.text_pair_required",
      "Enter the report header and footer in both English and Arabic, or leave both empty.",
    ),
  /** ADR-0061 §6 (exact English; the field-error message is language-neutral data). */
  contrastInsufficient: (failing: readonly BrandingContrastResult[]) =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "branding.contrast_insufficient",
      title: "Business rule violated",
      detail: BRANDING_CONTRAST_INSUFFICIENT_TEXT,
      errors: failing.map((p) => ({
        pointer: p.pointer,
        code: "branding.contrast_pair_below_threshold",
        message: `${p.fg} / ${p.bg} | ${p.use} | ${ratioText(p.ratio)}:1 < ${thresholdText(p.threshold)}:1`,
      })),
    }),
  logoNotFound: () =>
    new HttpProblem({
      status: 404,
      type: PROBLEM_TYPES.notFound,
      code: "branding.logo_not_found",
      title: "Not found",
      detail: "No logo is configured; the provisional text wordmark is shown.",
    }),
} as const;

// ------------------------------------------------------------------------------------------------ request shapes
// The body is parsed for its SHAPE (400 on a missing member, a wrong type, an unknown key, a length or a free-text
// rule); the §11 business rules (colour format, fonts, the logo, the text pairs) answer 422 with their own codes, and
// the two text rules are the database's (branding_version_no_pmi_claim / _no_engineering_gate, mapped in db-errors.ts).
const optionalText = (max: number) => freeText(1, max).nullable().optional();
const logoSet = z.strictObject({
  mode: z.literal("set"),
  pngBase64: z.string().max(349_528),
  altEn: freeText(1, 200).optional(),
  altAr: freeText(1, 200).optional(),
});
export const brandingSettingsPutBody = z.strictObject({
  productNameEn: freeText(1, 80),
  productNameAr: freeText(1, 80),
  primaryColour: z.string().max(64),
  secondaryColour: z.string().max(64),
  colourApprovalReference: optionalText(300),
  fontLatin: z.string().max(120),
  fontArabic: z.string().max(120),
  logo: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("keep") }),
    z.strictObject({ mode: z.literal("none") }),
    logoSet,
  ]),
  reportHeaderEn: optionalText(300),
  reportHeaderAr: optionalText(300),
  reportFooterEn: optionalText(300),
  reportFooterAr: optionalText(300),
  changeNote: optionalText(1000),
});
export type BrandingSettingsPutBody = z.infer<typeof brandingSettingsPutBody>;

const HEX_COLOUR = /^#[0-9A-F]{6}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The 0089 bounds: 67 B (the smallest valid PNG) to 256 KiB. */
export const LOGO_MIN_BYTES = 67;
export const LOGO_MAX_BYTES = 262_144;

/** The decoded PNG of a `set` logo, or the 422 (not base64, not a PNG signature, out of bounds, no alt texts). */
export function decodeLogo(logo: z.infer<typeof logoSet>): {
  png: Buffer;
  sha256: string;
  altEn: string;
  altAr: string;
} {
  if (logo.altEn === undefined || logo.altAr === undefined) throw brandingRefusals.logoInvalid();
  if (!BASE64.test(logo.pngBase64)) throw brandingRefusals.logoInvalid();
  const png = Buffer.from(logo.pngBase64, "base64");
  if (png.byteLength < LOGO_MIN_BYTES || png.byteLength > LOGO_MAX_BYTES) throw brandingRefusals.logoInvalid();
  // Only a PNG signature is accepted: an SVG (script-capable content) or any other format is refused (ADR-0049 §8).
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw brandingRefusals.logoInvalid();
  return { png, sha256: createHash("sha256").update(png).digest("hex"), altEn: logo.altEn, altAr: logo.altAr };
}

/** The §11 business rules that need no database: colours, fonts and the header/footer pairs. */
export function checkBrandingRules(body: BrandingSettingsPutBody): void {
  if (!HEX_COLOUR.test(body.primaryColour) || !HEX_COLOUR.test(body.secondaryColour))
    throw brandingRefusals.colourInvalid();
  if (body.fontLatin !== BRANDING_FONT_LATIN || body.fontArabic !== BRANDING_FONT_ARABIC)
    throw brandingRefusals.fontUnavailable();
  const one = (v: string | null | undefined) => v !== null && v !== undefined;
  if (one(body.reportHeaderEn) !== one(body.reportHeaderAr) || one(body.reportFooterEn) !== one(body.reportFooterAr))
    throw brandingRefusals.textPairRequired();
}

// ------------------------------------------------------------------------------------------------ presentation
type VersionRow = {
  readonly [K in (typeof BRANDING_VERSION_COLUMNS)[number]]: K extends "created_at"
    ? Date
    : K extends "version_no"
      ? number
      : K extends "colours_provisional"
        ? boolean
        : K extends
              | "colour_approval_reference"
              | "logo_sha256"
              | "logo_alt_en"
              | "logo_alt_ar"
              | "report_header_en"
              | "report_header_ar"
              | "report_footer_en"
              | "report_footer_ar"
              | "change_note"
          ? string | null
          : string;
};

function presentVersion(r: VersionRow): BrandingVersion {
  return brandingVersion.parse({
    versionNo: r.version_no,
    productNameEn: r.product_name_en,
    productNameAr: r.product_name_ar,
    primaryColour: r.primary_colour,
    secondaryColour: r.secondary_colour,
    coloursProvisional: r.colours_provisional,
    colourApprovalReference: r.colour_approval_reference,
    fontLatin: r.font_latin,
    fontArabic: r.font_arabic,
    logo:
      r.logo_sha256 === null
        ? null
        : { sha256: r.logo_sha256, altEn: r.logo_alt_en ?? "", altAr: r.logo_alt_ar ?? "", url: BRANDING_LOGO_URL },
    reportHeaderEn: r.report_header_en,
    reportHeaderAr: r.report_header_ar,
    reportFooterEn: r.report_footer_en,
    reportFooterAr: r.report_footer_ar,
    changeNote: r.change_note,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
  });
}

/** The contract body of getBranding (the port's extra members dropped). */
export function presentBranding(c: CurrentBranding): Branding {
  const { logoPng: _png, head: _head, ...rest } = c;
  return brandingSchema.parse(rest);
}

function presentSettings(c: CurrentBranding): BrandingSettings {
  return brandingSettings.parse({
    ...presentBranding(c),
    colourApprovalReference: c.head.colourApprovalReference,
    version: c.head.version,
    updatedAt: isoOrNull(c.head.updatedAt),
    updatedBy: c.head.updatedBy,
  });
}

// ------------------------------------------------------------------------------------------------ authorization
/** branding.configure in the caller's own organization (ADR-0049 §10; the jobs-view rule), else 403 (audited denial). */
function requireConfigure(principal: Principal): { userId: string; organizationId: string } {
  principal.tracker.decisions += 1;
  const org = principal.organizationId;
  if (
    org !== null &&
    principal.userId !== null &&
    principal.grants.some((g) => g.permissions.has(CONFIGURE) && g.organizationId === org)
  )
    return { userId: principal.userId, organizationId: org };
  const denied = problems.forbidden();
  throw org === null
    ? denied
    : denied.withDenial(
        denialOf(CONFIGURE, {
          level: "organization",
          organizationId: org,
          businessUnitId: null,
          transformationId: null,
          businessUnitAncestry: [],
        }),
      );
}

/** If-Match of the head version; `"0"` names "never saved" (the IfMatchOrZero rule). */
function ifMatchOrZero(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

function stale(current: number): HttpProblem {
  if (current >= 1) return problems.versionConflict(current);
  // Never saved: the Problem schema's currentVersion starts at 1, so it is left out.
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: "The record was changed by someone else. Review the current version and re-apply your change.",
  });
}

// ------------------------------------------------------------------------------------------------ publish
/**
 * Saves `body` as branding version n+1 of the actor's organization and makes it current (see the header). The caller
 * has checked the body's shape, the §11 rules and the contrast rule (`contrast.pairs` are the evaluated declared pairs,
 * all passing); the text rules are the database's. Returns the new current branding.
 */
export async function publishBranding(
  tx: Tx,
  port: BrandingReadPort,
  request: FastifyRequest,
  actor: { userId: string; organizationId: string },
  expected: number,
  body: BrandingSettingsPutBody,
  contrast: { readonly pairs: readonly BrandingContrastResult[]; readonly tokenSourceSha256: string },
): Promise<CurrentBranding> {
  const org = actor.organizationId;
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.brandingPublish}::int, hashtext(${org}::text))`.execute(
    tx,
  );
  const head = await tx
    .selectFrom("branding_setting")
    .selectAll()
    .where("organization_id", "=", org)
    .forUpdate()
    .executeTakeFirst();
  const current = head?.version ?? 0;
  if (expected !== current) throw stale(current);
  const previous = await port.current(tx, org);
  const next = current + 1;

  let logo: { png: Buffer | null; sha256: string | null; altEn: string | null; altAr: string | null };
  if (body.logo.mode === "set") logo = decodeLogo(body.logo);
  else if (body.logo.mode === "keep" && previous.logo !== null)
    logo = {
      png: previous.logoPng,
      sha256: previous.logo.sha256,
      altEn: previous.logo.altEn,
      altAr: previous.logo.altAr,
    };
  else logo = { png: null, sha256: null, altEn: null, altAr: null };

  const approval = body.colourApprovalReference ?? null;
  const versionId = uuidv7();
  await tx
    .insertInto("branding_version")
    .values({
      id: versionId,
      organization_id: org,
      version_no: next,
      product_name_en: body.productNameEn,
      product_name_ar: body.productNameAr,
      primary_colour: body.primaryColour,
      secondary_colour: body.secondaryColour,
      colours_provisional: approval === null,
      colour_approval_reference: approval,
      font_latin: body.fontLatin,
      font_arabic: body.fontArabic,
      logo_png: logo.png,
      logo_sha256: logo.sha256,
      logo_alt_en: logo.altEn,
      logo_alt_ar: logo.altAr,
      report_header_en: body.reportHeaderEn ?? null,
      report_header_ar: body.reportHeaderAr ?? null,
      report_footer_en: body.reportFooterEn ?? null,
      report_footer_ar: body.reportFooterAr ?? null,
      change_note: body.changeNote ?? null,
      created_by: actor.userId,
    })
    .execute();
  const ctx = auditContextOf(request);
  // The diff names the fields that changed against the previous current branding (version 0 = the defaults). The logo
  // is described by its presence, never its bytes (and no field name may contain "hash": audit.ts FORBIDDEN_FIELDS).
  const changed: [string, { from: unknown; to: unknown }][] = [];
  const diff = (field: string, from: unknown, to: unknown) => {
    if (from !== to) changed.push([field, { from, to }]);
  };
  diff("product_name_en", previous.productNameEn, body.productNameEn);
  diff("product_name_ar", previous.productNameAr, body.productNameAr);
  diff("primary_colour", previous.primaryColour, body.primaryColour);
  diff("secondary_colour", previous.secondaryColour, body.secondaryColour);
  diff("colour_approval_reference", previous.head.colourApprovalReference, approval);
  diff("logo", previous.logo === null ? "none" : "set", logo.sha256 === null ? "none" : "set");
  diff("report_header_en", previous.reportHeaderEn, body.reportHeaderEn ?? null);
  diff("report_header_ar", previous.reportHeaderAr, body.reportHeaderAr ?? null);
  diff("report_footer_en", previous.reportFooterEn, body.reportFooterEn ?? null);
  diff("report_footer_ar", previous.reportFooterAr, body.reportFooterAr ?? null);
  await record(tx, ctx, {
    action: "branding_version.create",
    recordType: "branding_version",
    recordId: versionId,
    organizationId: org,
    reason: body.changeNote ?? null,
    changes: { version_no: { from: current, to: next }, ...Object.fromEntries(changed) },
  });
  await recordContrastReport(tx, ctx, actor, next, contrast);

  let headId: string;
  if (head === undefined) {
    headId = uuidv7();
    await tx
      .insertInto("branding_setting")
      .values({
        id: headId,
        organization_id: org,
        current_version_no: next,
        version: next,
        created_by: actor.userId,
        updated_by: actor.userId,
      })
      .execute();
  } else {
    headId = head.id;
    await tx
      .updateTable("branding_setting")
      .set({ current_version_no: next, version: next, updated_at: sql<Date>`now()`, updated_by: actor.userId })
      .where("id", "=", head.id)
      .where("version", "=", current)
      .execute();
  }
  await record(tx, ctx, {
    action: head === undefined ? "branding_setting.create" : "branding_setting.update",
    recordType: "branding_setting",
    recordId: headId,
    organizationId: org,
    priorVersion: head === undefined ? null : current,
    newVersion: next,
    changes: { current_version_no: { from: head === undefined ? null : current, to: next } },
  });
  await enqueueOutboxEvent(tx, {
    organizationId: org,
    aggregateType: "branding_setting",
    aggregateId: headId,
    eventType: BRANDING_PUBLISHED_EVENT,
    schemaVersion: 1,
    payload: { organizationId: org, versionNo: next },
    idempotencyKey: `${BRANDING_PUBLISHED_EVENT}:${org}:${next}`,
  });
  return port.current(tx, org);
}

/**
 * ADR-0061 §1.3: the version's contrast report, its pairs in declared order (ordinal 1..n) and the audit event
 * branding_contrast_report.recorded (record id, no version; the after-state of §1.3). Written in the publish
 * transaction, under the brandingPublish lock the caller holds; 0113 refuses a failing pair, 0119 a version without it.
 * The audit diff names the token-source digest `design_source_sha256`: audit field names may not contain "token" or
 * "hash" (@mth/db FORBIDDEN_FIELDS).
 */
async function recordContrastReport(
  tx: Tx,
  ctx: ReturnType<typeof auditContextOf>,
  actor: { userId: string; organizationId: string },
  versionNo: number,
  contrast: { readonly pairs: readonly BrandingContrastResult[]; readonly tokenSourceSha256: string },
): Promise<string> {
  const reportId = uuidv7();
  await tx
    .insertInto("branding_contrast_report")
    .values({
      id: reportId,
      organization_id: actor.organizationId,
      branding_version_no: versionNo,
      rules: BRANDING_CONTRAST_RULES,
      token_source_sha256: contrast.tokenSourceSha256,
      pair_count: contrast.pairs.length,
      created_by: actor.userId,
    })
    .execute();
  await tx
    .insertInto("branding_contrast_pair")
    .values(
      contrast.pairs.map((p, i) => ({
        id: uuidv7(),
        report_id: reportId,
        ordinal: i + 1,
        fg_token: p.fg,
        bg_token: p.bg,
        use: p.use,
        fg_hex: p.fgHex,
        bg_hex: p.bgHex,
        ratio: ratioText(p.ratio),
        threshold: thresholdText(p.threshold),
        usage_note: p.note,
      })),
    )
    .execute();
  const lowest = contrast.pairs.reduce((min, p) => (p.ratio < min ? p.ratio : min), Number.POSITIVE_INFINITY);
  await record(tx, ctx, {
    action: BRANDING_CONTRAST_REPORT_RECORDED,
    recordType: "branding_contrast_report",
    recordId: reportId,
    organizationId: actor.organizationId,
    changes: {
      branding_version_no: { from: null, to: versionNo },
      rules: { from: null, to: BRANDING_CONTRAST_RULES },
      design_source_sha256: { from: null, to: contrast.tokenSourceSha256 },
      pair_count: { from: null, to: contrast.pairs.length },
      lowest_ratio: { from: null, to: ratioText(lowest) },
    },
  });
  return reportId;
}

// ------------------------------------------------------------------------------------------------ routes
const noQuery = z.strictObject({});
const versionParams = z.strictObject({ versionNo: z.coerce.number().int().min(1).max(2_147_483_647) });
const versionListQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/**
 * Registers the branding routes. Without `deps` (the DG1 unit test) only the token route is registered and it serves
 * the static source; with `deps` every route reads the caller's organization's current branding at request time.
 * Returns the registered routes as "METHOD /path".
 */
export function registerBrandingRoutes(
  app: FastifyInstance,
  source: BrandingTokenSource,
  deps?: Pick<ModuleDeps, "db">,
): string[] {
  const staticBody = toBrandingTokens(source);
  if (deps === undefined) {
    // Any signed-in user may read the tokens (the UI themes itself with them); authenticated-only, like /me.
    app.get(TOKENS, { config: { access: { permission: "authenticated" } } }, async () => staticBody);
    return [`GET ${TOKENS}`];
  }
  const { db } = deps;
  const port = brandingPortFor(source);
  const contrast = contrastRuleOf(source);

  app.get(TOKENS, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const principal = principalOf(request);
    return toBrandingTokens(source, await port.current(db, principal.organizationId));
  });

  app.get(CURRENT, { config: { access: { permission: "authenticated" } } }, async (request) => {
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    return presentBranding(await port.current(db, principal.organizationId));
  });

  app.get(LOGO, { config: { access: { permission: "authenticated" } } }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    const current = await port.current(db, principal.organizationId);
    if (current.logoPng === null) throw brandingRefusals.logoNotFound();
    return reply
      .code(200)
      .header("Content-Type", "image/png")
      .header("Content-Length", String(current.logoPng.byteLength))
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-cache")
      .send(current.logoPng);
  });

  app.get(SETTINGS, { config: { access: { permission: CONFIGURE } } }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    const actor = requireConfigure(principalOf(request));
    const body = presentSettings(await port.current(db, actor.organizationId));
    // ETag = the head version, "0" when never saved (the operation's summary; ETagOrZero).
    reply.header("ETag", body.version >= 1 ? etag(body.version) : '"0"');
    return body;
  });

  app.put(SETTINGS, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    requireConfigure(principalOf(request));
    const expected = ifMatchOrZero(request);
    const body = parseBody(brandingSettingsPutBody, request.body);
    checkBrandingRules(body);
    // ADR-0061 §1.2: after the §11 rules, before the transaction (pure; the colours are the request's own).
    const pairs = checkBrandingContrastRule(contrast, body);
    const saved = await db.transaction().execute(async (tx) => {
      const actor = requireConfigure(await refreshPrincipal(tx, request));
      return publishBranding(tx, port, request, actor, expected, body, {
        pairs,
        tokenSourceSha256: contrast.tokenSourceSha256,
      });
    });
    const settings = presentSettings(saved);
    reply.header("ETag", etag(settings.version));
    return reply.code(200).send(settings);
  });

  app.get(VERSIONS, { config: { access: { permission: CONFIGURE } } }, async (request) => {
    const query = parseQuery(versionListQuery, request.query);
    const actor = requireConfigure(principalOf(request));
    const hash = filterHash({ ...query, organizationId: actor.organizationId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("branding_version")
      .select(BRANDING_VERSION_COLUMNS)
      .where("organization_id", "=", actor.organizationId);
    if (after !== null) q = q.where("version_no", "<", Number(after[0]));
    const rows = (await q
      .orderBy("version_no", "desc")
      .limit(query.limit + 1)
      .execute()) as VersionRow[];
    const page = paginate(rows, query.limit, (r) => [r.version_no], hash);
    return brandingVersionPage.parse({ items: page.items.map(presentVersion), nextCursor: page.nextCursor });
  });

  app.get(VERSION, { config: { access: { permission: CONFIGURE } } }, async (request) => {
    const { versionNo } = parse(versionParams, request.params, "params");
    parseQuery(noQuery, request.query);
    const actor = requireConfigure(principalOf(request));
    const row = (await db
      .selectFrom("branding_version")
      .select(BRANDING_VERSION_COLUMNS)
      .where("organization_id", "=", actor.organizationId)
      .where("version_no", "=", versionNo)
      .executeTakeFirst()) as VersionRow | undefined;
    if (row === undefined) throw problems.notFound();
    return presentVersion(row);
  });

  // P6 (T-DG6-BE-W; ADR-0061 §5): the version's contrast report; recorded (stored at publish) or not_recorded (a
  // version published before the P6 rule, evaluated at read time with the same function). ETag of the version.
  app.get(VERSION_CONTRAST, { config: { access: { permission: CONFIGURE } } }, async (request, reply) => {
    const { versionNo } = parse(versionParams, request.params, "params");
    parseQuery(noQuery, request.query);
    const actor = requireConfigure(principalOf(request));
    const version = await db
      .selectFrom("branding_version")
      .select(["version_no", "primary_colour", "secondary_colour"])
      .where("organization_id", "=", actor.organizationId)
      .where("version_no", "=", versionNo)
      .executeTakeFirst();
    if (version === undefined) throw problems.notFound();
    const stored = await readContrastReport(db, actor.organizationId, versionNo);
    const body =
      stored === null
        ? presentEvaluatedContrast(versionNo, contrast.check(version.primary_colour, version.secondary_colour))
        : presentStoredContrast(versionNo, stored);
    reply.header("ETag", etag(versionNo));
    return body;
  });

  return [
    `GET ${TOKENS}`,
    `GET ${CURRENT}`,
    `GET ${LOGO}`,
    `GET ${SETTINGS}`,
    `PUT ${SETTINGS}`,
    `GET ${VERSIONS}`,
    `GET ${VERSION}`,
    `GET ${VERSION_CONTRAST}`,
  ];
}

/** The contrast members of the token source; registering the routes without them is a wiring defect (fail closed). */
function contrastRuleOf(source: BrandingTokenSource): ContrastRule {
  if (source.checkBrandingContrast === undefined || source.tokenSourceSha256 === undefined)
    throw new Error("registerBrandingRoutes: the token source needs checkBrandingContrast and tokenSourceSha256");
  if (!/^[0-9a-f]{64}$/.test(source.tokenSourceSha256))
    throw new Error("registerBrandingRoutes: tokenSourceSha256 must be 64 lower-case hex digits");
  return { check: source.checkBrandingContrast, tokenSourceSha256: source.tokenSourceSha256 };
}

/** A non-negative decimal string with at most two places ("4.5", "12.34") as integer hundredths. */
function hundredths(decimal: string): number {
  const m = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(decimal);
  if (m === null) throw new Error(`not a contrast decimal: ${decimal}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** A stored report (status recorded; every pair passes by the 0113 rule, so failingCount is 0). */
function presentStoredContrast(
  versionNo: number,
  stored: NonNullable<Awaited<ReturnType<typeof readContrastReport>>>,
): BrandingContrastReport {
  // pass is recomputed from the stored decimals, in integer hundredths (no float): never assumed.
  const pairs = stored.pairs.map((p) => ({ ...p, pass: hundredths(p.ratio) >= hundredths(p.threshold) }));
  return brandingContrastReport.parse({
    versionNo,
    status: "recorded",
    rules: stored.rules,
    tokenSourceSha256: stored.tokenSourceSha256,
    recordedAt: iso(stored.createdAt),
    pairCount: stored.pairCount,
    failingCount: pairs.filter((p) => !p.pass).length,
    pairs,
  });
}

/** A version published before the P6 rule, evaluated at read time (status not_recorded; may list failing pairs). */
function presentEvaluatedContrast(
  versionNo: number,
  evaluated: readonly BrandingContrastResult[],
): BrandingContrastReport {
  return brandingContrastReport.parse({
    versionNo,
    status: "not_recorded",
    rules: BRANDING_CONTRAST_RULES,
    tokenSourceSha256: null,
    recordedAt: null,
    pairCount: evaluated.length,
    failingCount: evaluated.filter((p) => !p.pass).length,
    pairs: evaluated.map((p, i) => ({
      ordinal: i + 1,
      fg: p.fg,
      bg: p.bg,
      use: p.use,
      fgHex: p.fgHex,
      bgHex: p.bgHex,
      ratio: ratioText(p.ratio),
      threshold: thresholdText(p.threshold),
      pass: p.pass,
    })),
  });
}

/** The read port with the token source's version-0 colours (brand.primary, brand.deep). */
export function brandingPortFor(source: BrandingTokenSource): BrandingReadPort {
  const seeds = new Map(Object.entries(source.colorTokens));
  return createBrandingReadPort({
    primaryColour: seeds.get(PRIMARY_TOKEN)?.value ?? "#0078FF",
    secondaryColour: seeds.get(SECONDARY_TOKEN)?.value ?? "#003B73",
  });
}
