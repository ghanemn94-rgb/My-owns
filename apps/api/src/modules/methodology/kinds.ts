// The ConfigKindProvider registry (ADR-0039 §1-§2, §5; p5-work-split §A.1; T-DG5-BE-A).
//
// Every Studio configuration kind (methodology_version.config_kind) has one entry: its default key (the version a
// transformation without a pin of the kind resolves to, ADR-0039 §3), the element types it accepts (the database
// trigger methodology_element_guard's list, mirrored in @mth/shared ELEMENT_TYPES_BY_KIND), the Zod attribute schemas
// per element type, and the optional per-kind hooks the publish pipeline calls: extra element validation, diff rows,
// compatibility, affected records, the preview hook and the migration-plan items. The kinds' owners register their
// providers at composition: `methodology` by BE-B (providers/methodology-kind.ts), `scoring_defaults` by KBE-A
// (providers/scoring-defaults-kind.ts), form_schema/procedure/automation_rule_set/health_check_scheme by slices B-H.
// Until a provider registers, a kind has no hooks: its versions resolve and list, and the pipeline reports the hook as
// not available (never a silent pass).
import type { DbOrTx } from "@mth/db";
import {
  CONFIG_ELEMENT_ATTRIBUTES,
  CONFIG_KINDS,
  ELEMENT_TYPES_BY_KIND,
  type ConfigElementType,
  type ConfigKind,
} from "@mth/shared/schemas";
import type { z } from "zod";

/** One element change of a draft against another version (the diff row shape; ADR-0039 §5). */
export interface ConfigElementChange {
  readonly elementType: ConfigElementType;
  readonly stableKey: string;
  readonly change: "added" | "removed" | "changed";
  readonly from: Readonly<Record<string, unknown>> | null;
  readonly to: Readonly<Record<string, unknown>> | null;
}

/** A finding of a compatibility check (ADR-0039 §5): `warn` stays publishable, `fail` blocks publish. */
export interface CompatibilityFinding {
  readonly severity: "warn" | "fail";
  readonly code: string;
  readonly elementType: ConfigElementType | null;
  readonly stableKey: string | null;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

/** Per pinned transformation, the count of records of one type a draft's changes touch; null = Unknown (never 0). */
export interface AffectedRecordCount {
  readonly transformationId: string;
  readonly recordType: string;
  readonly count: number | null;
  readonly unknownReason: string | null;
}

/** What the preview sandbox reports for one kind (ADR-0039 §5). */
export interface PreviewOutcome {
  readonly result: "pass" | "fail";
  readonly report: Readonly<Record<string, unknown>>;
}

/** The hooks a kind's owner registers. Each receives the database handle of the caller's transaction. */
export interface ConfigKindProviderHooks {
  /** Validation beyond the Zod shape (e.g. a gate approver inside the DG2 allowed set); throws the §13 refusal. */
  readonly validateElement?: (
    db: DbOrTx,
    input: {
      readonly versionId: string;
      readonly elementType: ConfigElementType;
      readonly stableKey: string;
      readonly origin: "source" | "admin";
      readonly attributes: Readonly<Record<string, unknown>>;
    },
  ) => Promise<void>;
  /** Kind-specific diff rows for the kind's own tables (e.g. ADR-0041's added form fields). */
  readonly diffRows?: (
    db: DbOrTx,
    input: { readonly versionId: string; readonly againstVersionId: string },
  ) => Promise<readonly ConfigElementChange[]>;
  readonly compatibility?: (
    db: DbOrTx,
    input: {
      readonly versionId: string;
      readonly baseVersionId: string;
      readonly changes: readonly ConfigElementChange[];
    },
  ) => Promise<readonly CompatibilityFinding[]>;
  readonly affectedRecords?: (
    db: DbOrTx,
    input: {
      readonly versionId: string;
      readonly baseVersionId: string;
      readonly changes: readonly ConfigElementChange[];
      readonly transformationIds: readonly string[];
    },
  ) => Promise<readonly AffectedRecordCount[]>;
  readonly preview?: (
    db: DbOrTx,
    input: { readonly versionId: string; readonly samples: unknown },
  ) => Promise<PreviewOutcome>;
  /** ADR-0040 §2: the migration-plan items a move from one version to another needs (BE-C consumes them). */
  readonly migrationItems?: (
    db: DbOrTx,
    input: { readonly transformationId: string; readonly fromVersionId: string; readonly toVersionId: string },
  ) => Promise<readonly Readonly<Record<string, unknown>>[]>;
}

export interface ConfigKindProvider extends ConfigKindProviderHooks {
  readonly kind: ConfigKind;
  /**
   * The key whose version 1 an unpinned transformation resolves to (ADR-0039 §3: "never the latest"). null while the
   * kind's ARCH task has not named one (no version of the kind exists yet): such a kind is not resolvable.
   */
  readonly defaultKey: string | null;
  readonly elementTypes: readonly ConfigElementType[];
}

/** The default keys ADR-0039 §3 names; slices B-H add theirs when their ADR seeds a version 1. */
const DEFAULT_KEYS: ReadonlyMap<ConfigKind, string> = new Map<ConfigKind, string>([
  ["methodology", "playbook"],
  ["scoring_defaults", "scoring-defaults"],
]);
const TYPES_BY_KIND = new Map(Object.entries(ELEMENT_TYPES_BY_KIND)) as ReadonlyMap<
  ConfigKind,
  readonly ConfigElementType[]
>;
const ATTRIBUTE_SCHEMAS = new Map(Object.entries(CONFIG_ELEMENT_ATTRIBUTES)) as ReadonlyMap<
  ConfigElementType,
  z.ZodType
>;

function builtIn(kind: ConfigKind): ConfigKindProvider {
  return Object.freeze({
    kind,
    defaultKey: DEFAULT_KEYS.get(kind) ?? null,
    elementTypes: TYPES_BY_KIND.get(kind) ?? [],
  });
}

const registry = new Map<ConfigKind, ConfigKindProvider>(CONFIG_KINDS.map((kind) => [kind, builtIn(kind)]));

/**
 * Registers (or replaces) the hooks of a kind and, when its ADR seeds version 1 of a key, its default key. The element
 * types are fixed by the database trigger and are not changed here. Called at composition (server.ts) or module load.
 */
export function registerConfigKindProvider(
  kind: ConfigKind,
  hooks: ConfigKindProviderHooks & { readonly defaultKey?: string },
): void {
  const current = configKindProvider(kind);
  registry.set(
    kind,
    Object.freeze({
      ...hooks,
      kind,
      defaultKey: hooks.defaultKey ?? current.defaultKey,
      elementTypes: current.elementTypes,
    }),
  );
}

/** The provider of a kind (always present; hooks may be absent). */
export function configKindProvider(kind: ConfigKind): ConfigKindProvider {
  const p = registry.get(kind);
  if (p === undefined) throw new Error(`unknown configuration kind ${kind}`);
  return p;
}

/** Every kind's provider, in the CONFIG_KINDS order. */
export function configKindProviders(): readonly ConfigKindProvider[] {
  return CONFIG_KINDS.map((k) => configKindProvider(k));
}

/** True when `type` belongs to `kind` (the database trigger refuses the others; the API checks first). */
export function kindAcceptsElementType(kind: ConfigKind, type: ConfigElementType): boolean {
  return configKindProvider(kind).elementTypes.includes(type);
}

/** The Zod schema of the attributes of one element type (ADR-0039 §2). */
export function elementAttributeSchema(type: ConfigElementType): z.ZodType {
  const schema = ATTRIBUTE_SCHEMAS.get(type);
  if (schema === undefined) throw new Error(`unknown element type ${type}`);
  return schema;
}

/** Tests only: restores the built-in registry (no hooks). */
export function resetConfigKindProvidersForTest(): void {
  for (const kind of CONFIG_KINDS) registry.set(kind, builtIn(kind));
}
