// The configuration transfer bundle format (P7 slice D; ADR-0065 §1-§2; REQ-S19-008; p7-work-split §D.1, T-DG7-BE-F).
//
//   { "bundleSchemaVersion": "mth-config-bundle/1", "exportId": "<uuid>", "sourceEnvironment": "demo",
//     "createdAt": "<RFC 3339 UTC>", "appVersion": "<release>",
//     "items": [ { "kind", "itemCode", "sourceVersionNo", "contentSha256", "content" } ] }
//
// - BUNDLE_SCHEMA_VERSION is the only version this release reads. Any other value (an empty string, a missing field,
//   "mth-config-bundle/2") is refused by the server with 422 config_bundle.schema_version_unsupported before anything
//   else is read (ADR-0065 §2); the envelope schema below therefore accepts any string there.
// - contentSha256 = SHA-256 (hex) of the UTF-8 bytes of canonicalBundleJson(content): object keys sorted by code point,
//   no insignificant whitespace, integers only (decimals are strings). The digest itself is computed by the caller's
//   hasher (this package is dependency-free and has no Node types; the API passes node:crypto through @mth/db's
//   transferSha256), so the rule is defined once here and the bytes are hashed once there.
// - No ids of the source installation: references are stable keys and codes. A uuid anywhere in a content is an
//   unportable reference (ADR-0065 §2).
// A bundle is configuration. Importing it decides nothing: no G1-G6 approval, no Finance validation, no IT approval.
import { z } from "zod";

export const BUNDLE_SCHEMA_VERSION = "mth-config-bundle/1" as const;
/** At most 5 MiB of bundle bytes and 2,000 items (ADR-0065 §2). */
export const BUNDLE_MAX_BYTES = 5 * 1024 * 1024;
export const BUNDLE_MAX_ITEMS = 2000;

/** The 12 kinds, in the ADR-0065 §1 table order (the item order of a bundle: kind, then itemCode). */
export const CONFIG_BUNDLE_KINDS = [
  "methodology",
  "scoring_defaults",
  "form_schema",
  "procedure",
  "automation_rule_set",
  "health_check_scheme",
  "automation_rule",
  "branding",
  "notification_policy",
  "job_schedule",
  "config_review_policy",
  "upload_policy",
] as const;
export type ConfigBundleKind = (typeof CONFIG_BUNDLE_KINDS)[number];
export const configBundleKind = z.enum(CONFIG_BUNDLE_KINDS);

/** The six Studio kinds: `methodology_version` rows keyed by (config_kind, key). */
export const STUDIO_BUNDLE_KINDS = [
  "methodology",
  "scoring_defaults",
  "form_schema",
  "procedure",
  "automation_rule_set",
  "health_check_scheme",
] as const satisfies readonly ConfigBundleKind[];

/** The seven kinds a commit writes as a DRAFT (never published by the commit; ADR-0065 §5). */
export const DRAFTING_BUNDLE_KINDS = [...STUDIO_BUNDLE_KINDS, "automation_rule"] as const;

/** The five kinds without a draft stage, applied through their own write path on commit (ADR-0065 §1, seam 2). */
export const NON_DRAFT_BUNDLE_KINDS = [
  "branding",
  "notification_policy",
  "job_schedule",
  "config_review_policy",
  "upload_policy",
] as const satisfies readonly ConfigBundleKind[];

export const CONFIG_BUNDLE_ACTIONS = ["create_draft", "new_draft", "identical", "conflict", "refused"] as const;
export type ConfigBundleAction = (typeof CONFIG_BUNDLE_ACTIONS)[number];

/** `itemCode`: the stable key of the item within its kind (0134 config_bundle_import_item.item_code). */
export const ITEM_CODE = /^[a-z0-9][a-z0-9_.:-]*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ------------------------------------------------------------------------------------------------ canonical JSON

/** Code-point order (not UTF-16 code units): the two differ only for keys with characters above U+FFFF. */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const d = (x.at(i) ?? 0) - (y.at(i) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
export const byCodePoint = compareCodePoints;

export class CanonicalJsonError extends Error {
  override readonly name = "CanonicalJsonError";
}

/**
 * Canonical JSON (ADR-0065 §2, the ADR-0039 §1 rule): keys sorted by code point, no insignificant whitespace, UTF-8
 * text. A non-integer or non-finite number is refused (decimals travel as strings), so no float formatting ever enters
 * a hash. `undefined` object members are omitted.
 */
export function canonicalBundleJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new CanonicalJsonError("numbers must be integers (decimals are strings)");
    return String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalBundleJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareCodePoints(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalBundleJson(v)}`).join(",")}}`;
  }
  throw new CanonicalJsonError(`unsupported value of type ${typeof value}`);
}

/** SHA-256 (hex) of the UTF-8 text, supplied by the caller (node:crypto in the API). */
export type Sha256Hex = (text: string) => string;

/** `contentSha256` of an item: the hash of the canonical JSON of its content. */
export function contentSha256(content: unknown, sha256: Sha256Hex): string {
  return sha256(canonicalBundleJson(content));
}

/** The JSON pointer of the first uuid-shaped string (a source id) inside `value`, or null. */
export function firstUuidPointer(value: unknown, pointer = ""): string | null {
  if (typeof value === "string") return UUID.test(value) ? pointer : null;
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const hit = firstUuidPointer(v, `${pointer}/${i}`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (UUID.test(k)) return `${pointer}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      const hit = firstUuidPointer(v, `${pointer}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`);
      if (hit !== null) return hit;
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ envelope

export const SOURCE_ENVIRONMENTS = ["production", "demo", "unmarked"] as const;

/** One item of a bundle (OpenAPI ConfigBundleItem). The content is checked per kind (contentSchemas below). */
export const configBundleItem = z.strictObject({
  kind: configBundleKind,
  itemCode: z.string().min(1).max(200).regex(ITEM_CODE),
  sourceVersionNo: z.number().int().min(1).nullable(),
  contentSha256: z.string().regex(SHA256_HEX),
  content: z.record(z.string(), z.unknown()),
});
export type ConfigBundleItem = z.infer<typeof configBundleItem>;

/** The envelope (OpenAPI ConfigBundle). `bundleSchemaVersion` is any string here; the server refuses unknown ones. */
export const configBundleEnvelope = z.strictObject({
  bundleSchemaVersion: z.string().min(1).max(64),
  exportId: z.uuid(),
  sourceEnvironment: z.enum(SOURCE_ENVIRONMENTS),
  createdAt: z.iso.datetime({ offset: true }),
  appVersion: z.string().min(1).max(64),
  items: z.array(configBundleItem).max(BUNDLE_MAX_ITEMS),
});
export type ConfigBundleEnvelope = z.infer<typeof configBundleEnvelope>;

// ------------------------------------------------------------------------------------------------ content per kind
// The published content of each kind in a shape keyed by stable codes only. The owning module's adapter refines the
// schema it registers (for example the Studio element attribute schemas), so these are the floor every bundle meets.

const integerOnly = (v: unknown): boolean => {
  try {
    canonicalBundleJson(v);
    return true;
  } catch {
    return false;
  }
};
const jsonObject = z.record(z.string(), z.unknown()).refine(integerOnly, "numbers must be integers");

/** A Studio version: exactly the ADR-0039 §1 hashed content, so contentSha256 equals the version's content hash. */
export const studioContent = z.strictObject({
  titleEn: z.string().min(1).max(200),
  titleAr: z.string().min(1).max(200),
  definition: jsonObject,
  elements: z
    .array(
      z.strictObject({
        elementType: z.string().min(1).max(40),
        stableKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/),
        origin: z.enum(["source", "admin"]),
        removed: z.boolean(),
        ordinal: z.number().int().min(1).max(999).nullable(),
        attributes: jsonObject,
      }),
    )
    .max(2000),
});
export type StudioContent = z.infer<typeof studioContent>;

export const jobScheduleContent = z.strictObject({
  cron: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64),
});
export const configReviewPolicyContent = z.strictObject({
  reviewRequired: z.boolean(),
  reviewerRoleCode: z.string().min(1).max(64).nullable(),
});
export const notificationPolicyContent = z.strictObject({
  nonUrgentWorkingDaysOnly: z.boolean(),
  defaultQuietHoursStart: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
    .nullable(),
  defaultQuietHoursEnd: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
    .nullable(),
  defaultDigestMode: z.string().min(1).max(32),
});
export const uploadPolicyContent = z.strictObject({
  allowedTypes: z.array(z.string().min(1).max(64)).min(1).max(64),
  maxBytes: z.number().int().min(1),
});
/** Branding and automation rules: the owning module's adapter registers the exact schema (see the handback). */
export const brandingContent = jsonObject;
export const automationRuleContent = jsonObject;

export const CONFIG_BUNDLE_CONTENT_SCHEMAS: Readonly<Record<ConfigBundleKind, z.ZodType>> = Object.freeze({
  methodology: studioContent,
  scoring_defaults: studioContent,
  form_schema: studioContent,
  procedure: studioContent,
  automation_rule_set: studioContent,
  health_check_scheme: studioContent,
  automation_rule: automationRuleContent,
  branding: brandingContent,
  notification_policy: notificationPolicyContent,
  job_schedule: jobScheduleContent,
  config_review_policy: configReviewPolicyContent,
  upload_policy: uploadPolicyContent,
});

// ------------------------------------------------------------------------------------------------ exact texts (D.2)

/** The problem codes of slice D with their English text (p7-work-split §D.2; the Arabic is in the web i18n files). */
export const CONFIG_BUNDLE_PROBLEM_TEXTS = {
  "config_bundle.schema_version_unsupported":
    'This bundle uses schema version "{version}", which this release cannot read. Export it again from a compatible release.',
  "config_bundle.too_large": "The bundle is larger than 5 MiB.",
  "config_bundle.checksum_mismatch": "The bundle's checksum does not match its content.",
  "config_bundle.item_invalid": "An item of the bundle is not valid for its kind.",
  "config_bundle.nothing_published": "Nothing of the chosen kinds is published in this organization.",
  "config_bundle.unportable_reference": "An item refers to a record that has no stable key, so it cannot be exported.",
  "config_bundle.not_validatable": "This import cannot be validated in its current state.",
  "config_bundle.not_committable": "Only a validated import without conflicts or refused items can be committed.",
  "config_bundle.plan_changed": "The configuration changed since the last validation. Validate again.",
  "config_bundle.open_draft_exists": "An open draft of this item exists. It is never overwritten.",
  "config_bundle.reference_missing":
    "This item refers to another item that is neither in the bundle nor in this installation.",
  "config_bundle.kind_not_permitted": "You do not have the right to change this kind of configuration.",
  "config_bundle.kind_unavailable": "This kind of configuration is not available in this installation.",
} as const;
export type ConfigBundleProblemCode = keyof typeof CONFIG_BUNDLE_PROBLEM_TEXTS;
/** The item-level codes (a planned action's problem_code). */
export type ConfigBundleItemProblem = Extract<
  ConfigBundleProblemCode,
  | "config_bundle.open_draft_exists"
  | "config_bundle.reference_missing"
  | "config_bundle.kind_not_permitted"
  | "config_bundle.kind_unavailable"
>;

// ------------------------------------------------------------------------------------------------ the adapter port
// The ConfigBundleKindAdapter port (ADR-0065 §6), generic over the API's database, transaction, request and principal
// types so that it lives in this dependency-free package: the owning modules implement it and the API's transfer
// module consumes it, and neither imports the other (no module cycle; p7-plan §2).

/** One exported item before hashing: the stable key, its source version number and its published content. */
export interface ExportedBundleItem {
  readonly itemCode: string;
  readonly sourceVersionNo: number | null;
  readonly content: Record<string, unknown>;
}

/** One bundle item as an adapter sees it (validated envelope; content checked against the adapter's schema). */
export interface BundleItemInput {
  readonly kind: ConfigBundleKind;
  readonly itemCode: string;
  readonly sourceVersionNo: number | null;
  readonly contentSha256: string;
  readonly content: Record<string, unknown>;
}

/** What the planner knows about the whole bundle (for reference checks between items). */
export interface BundleContext {
  /** "<kind>:<itemCode>" of every item in the bundle. */
  readonly keys: ReadonlySet<string>;
}

export type PlannedBundleItem =
  | { readonly action: "create_draft" | "new_draft" | "identical" }
  | { readonly action: "conflict"; readonly problemCode: "config_bundle.open_draft_exists" }
  | { readonly action: "refused"; readonly problemCode: ConfigBundleItemProblem };

/** The record a commit wrote for one item (0134 config_bundle_import_commit). */
export interface WrittenBundleRecord {
  readonly targetRecordType:
    | "methodology_version"
    | "automation_rule_version"
    | "branding_version"
    | "notification_policy"
    | "job_schedule"
    | "config_review_policy"
    | "upload_policy";
  readonly targetRecordId: string;
}

export interface BundleWriteContext<Tx, Request, Principal> {
  readonly tx: Tx;
  readonly request: Request;
  /** The caller, with grants reloaded inside the commit's transaction. */
  readonly principal: Principal;
  readonly organizationId: string;
  readonly userId: string;
  readonly importId: string;
}

export interface ConfigBundleKindAdapterPort<Db, Tx, Request, Principal> {
  readonly kind: ConfigBundleKind;
  /** The owning module's schema of a published content (refines the floor schema above). */
  readonly contentSchema: z.ZodType;
  /** True when `principal` holds the kind's OWN configure right (the right its existing route checks). */
  permitted(db: Db, principal: Principal, organizationId: string): Promise<boolean>;
  /** The latest published items of the organization. */
  exportPublished(db: Db, organizationId: string): Promise<ExportedBundleItem[]>;
  /** The planned action of one item (no write). */
  plan(db: Db, organizationId: string, item: BundleItemInput, bundle: BundleContext): Promise<PlannedBundleItem>;
  /** Writes one create_draft / new_draft item through the owning module's path (never a publish). */
  write(
    ctx: BundleWriteContext<Tx, Request, Principal>,
    item: BundleItemInput,
    action: "create_draft" | "new_draft",
  ): Promise<WrittenBundleRecord>;
}
