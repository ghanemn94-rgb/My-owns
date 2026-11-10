// The ImportTargetRegistry port (ADR-0056 §1; p6-plan §2; p6-work-split §B/A.3; T-DG6-BE-M).
//
// An import target is the domain side of a controlled import: its template (columns), the row rules it applies
// read-only at staging and again at commit, the duplicate keys it already holds, and the commit of one valid row
// through its own service. `integrations` imports no domain module: each domain implements its target and registers it
// into the one registry at composition (server.ts), the P5 AutomationActionRegistry pattern. `kpi_actual.v1` (KBE-A,
// `kpi/import-target.ts`) is the only target in P6; `import_batch.target_kind` has a CHECK with that one value, so a
// second target needs a migration.
//
// A target never accepts or approves anything by itself: KPI actuals go through the DG4 submission path (ADR-0027/0028),
// which decides the review route. Nothing here reads or writes DG0-DG7.
import type { DbOrTx, Tx } from "@mth/db";
import type { Permission } from "@mth/shared";

/** The closed set of `import_batch.target_kind` (0105). */
export const IMPORT_TARGET_KINDS = ["kpi_actual"] as const;
export type ImportTargetKind = (typeof IMPORT_TARGET_KINDS)[number];

/** The media types an upload may have (ADR-0056 §3); a webhook batch is `application/json` (§7). */
export const CSV_MEDIA_TYPE = "text/csv";
export const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const IMPORT_FILE_MEDIA_TYPES = [CSV_MEDIA_TYPE, XLSX_MEDIA_TYPE] as const;
export type ImportFileMediaType = (typeof IMPORT_FILE_MEDIA_TYPES)[number];

/** The template column every target has: the source's own row id (ADR-0056 §5; `import_row.source_record_id`). */
export const SOURCE_RECORD_ID_COLUMN = "source_record_id";
/** `import_row.source_record_id` holds at most 200 characters (0105). */
export const SOURCE_RECORD_ID_MAX = 200;

/** One template column (the contract's `ImportTemplateColumn`; ADR-0056 §9). */
export interface ImportColumn {
  /** `^[a-z][a-z0-9_]{0,63}$`: the header text of the column in a CSV or XLSX file and the key of a webhook item. */
  readonly key: string;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly required: boolean;
  readonly kind: "text" | "uuid" | "decimal" | "date" | "boolean" | "enum";
  readonly example: string | null;
  /** Informational columns (ADR-0056 §9 `kpi_name`) are accepted in the header and ignored on import. */
  readonly informational?: boolean;
}

/**
 * One row-level reason (ADR-0056 §5): a code `import.row.*` (an i18n key; the text is rendered in en or ar at render
 * time from `i18n/{en,ar}/imports.json`), the field it concerns, and the params of the text. Never a sentence.
 */
export interface ImportRowReason {
  readonly code: string;
  readonly field?: string | null;
  readonly params?: Readonly<Record<string, string | number>>;
}

/** The cells of one source row, keyed by template column key; every cell is TEXT or null (never a number). */
export type ImportCells = Readonly<Record<string, string | null>>;

/**
 * The cell of `key` (null when empty or absent). Module code reads cells through this helper: the API module checker
 * refuses a computed member with a non-literal key (`cells[key]`, architecture.testkit.ts rule 2).
 */
export function cellValue(cells: ImportCells, key: string): string | null {
  for (const [k, v] of Object.entries(cells)) if (k === key) return v;
  return null;
}

/** What a target's `validateRow` receives: the source row number and its cells. */
export interface ImportRawRow {
  /** The source row (header is row 1 for files; the item's 1-based position plus 1 for webhooks). */
  readonly rowNumber: number;
  readonly cells: ImportCells;
}

/**
 * The verdict of a target on one row. `valid`: the normalized values (decimal strings; never a float) and the
 * duplicate key (the "source/period" of M0334). `invalid`: at least one reason; the duplicate key when it could be
 * derived (it is shown, never used for duplicate detection of an invalid row).
 */
export type RowVerdict =
  | { readonly valid: true; readonly normalized: ImportCells; readonly duplicateKey: string }
  | { readonly valid: false; readonly reasons: readonly ImportRowReason[]; readonly duplicateKey: string | null };

/** The context a target works in. `db` is read-only for `validateRow` and `existingKeys`. */
export interface ImportTargetContext {
  readonly db: DbOrTx;
  readonly organizationId: string;
  readonly transformationId: string;
  /** The form schema version the batch pins (`p5_form_schema_version_for`, ADR-0039 §3: never the latest). */
  readonly formSchemaVersionId: string;
  readonly templateVersion: string;
  /**
   * The user the rows are checked for (ADR-0056 §4 `import.row.not_kpi_updater`): the uploader at staging, the
   * committer (or, for an `auto` commit, `on_behalf_of_user_id`) at commit; null for a machine source without one.
   */
  readonly actorUserId: string | null;
}

/** One valid row handed to `commitRow`, in `row_number` order (ADR-0056 §6 step 3). */
export interface ImportCommitRow {
  readonly importRowId: string;
  readonly rowNumber: number;
  readonly sourceRecordId: string | null;
  readonly normalized: ImportCells;
}

/** What `commitRow` created: the lineage target (`import_row_commit`). */
export interface ImportCommitResult {
  readonly recordType: ImportTargetKind;
  readonly recordId: string;
  readonly valueNo: number;
}

/** An import target (ADR-0056 §1). Implemented and registered by the owning domain module. */
export interface ImportTarget {
  readonly kind: ImportTargetKind;
  /** `^[a-z][a-z0-9_]*\.v[1-9][0-9]*$`, for example "kpi_actual.v1". */
  readonly templateVersion: string;
  readonly titleEn: string;
  readonly titleAr: string;
  /** The template (§9). Must contain `source_record_id`. */
  readonly columns: readonly ImportColumn[];
  /**
   * Pure plus read-only queries: the row's verdict. Called by the engine only with the cells the engine itself did
   * not refuse (a formula cell, an over-long cell or a cell with an invalid character reaches the target as null, and
   * the target's own reason for that field is dropped so the row shows the engine's reason once).
   */
  validateRow(ctx: ImportTargetContext, row: ImportRawRow): Promise<RowVerdict>;
  /**
   * The duplicate keys among `keys` that the target already holds (its own uniqueness; for KPI actuals the DG4 slot
   * `kpi_actual_slot_key`), each with the params of `import.row.duplicate_committed` (ADR-0056 §5: the existing
   * record's `status`). Read-only.
   */
  existingKeys(
    ctx: ImportTargetContext,
    keys: readonly string[],
  ): Promise<ReadonlyMap<string, Readonly<Record<string, string>>>>;
  /** Commits one valid row through the domain's own service, inside the commit transaction (BE-M2). */
  commitRow(tx: Tx, ctx: ImportTargetContext, row: ImportCommitRow): Promise<ImportCommitResult>;
  /** Re-checked at commit time for the committer, in the batch's transformation (ADR-0056 §6 step 1). */
  readonly requiredPermissions: readonly Permission[];
  /**
   * Optional: the extension-field column keys of the pinned form schema version (ADR-0056 §4, ADR-0041 §4) that the
   * header may carry in addition to `columns`. A header column that is neither is `import.header_mismatch`.
   */
  extensionColumns?(ctx: ImportTargetContext): Promise<readonly string[]>;
}

export interface ImportTargetRegistry {
  /** Registers a target; registering the same template version again replaces it (idempotent wiring). */
  register(target: ImportTarget): void;
  get(templateVersion: string): ImportTarget | undefined;
  /** The registered targets, by template version. */
  list(): ImportTarget[];
  /** The columns of the newest registered template of a target kind (the connector mappings' target columns). */
  columnsOf(kind: string): readonly ImportColumn[];
}

const TEMPLATE_VERSION = /^[a-z][a-z0-9_]*\.v([1-9][0-9]*)$/;
const COLUMN_KEY = /^[a-z][a-z0-9_]{0,63}$/;

function checkTarget(target: ImportTarget): void {
  const fail = (why: string) => {
    throw new Error(`import target registry: ${target.templateVersion}: ${why}`);
  };
  if (!(IMPORT_TARGET_KINDS as readonly string[]).includes(target.kind)) fail(`unknown target kind ${target.kind}`);
  const m = TEMPLATE_VERSION.exec(target.templateVersion);
  if (!m || !target.templateVersion.startsWith(`${target.kind}.`)) fail("the template version is <kind>.v<n>");
  if (target.columns.length === 0 || target.columns.length > 50) fail("a template has 1 to 50 columns");
  const keys = new Set<string>();
  for (const c of target.columns) {
    if (!COLUMN_KEY.test(c.key)) fail(`column key ${c.key} is not ^[a-z][a-z0-9_]{0,63}$`);
    if (keys.has(c.key)) fail(`column ${c.key} appears twice`);
    keys.add(c.key);
  }
  if (!keys.has(SOURCE_RECORD_ID_COLUMN)) fail(`the template has no ${SOURCE_RECORD_ID_COLUMN} column`);
}

const versionNo = (templateVersion: string): number => Number(TEMPLATE_VERSION.exec(templateVersion)?.[1] ?? 0);

/** A new, empty registry. */
export function createImportTargetRegistry(): ImportTargetRegistry {
  const byVersion = new Map<string, ImportTarget>();
  return {
    register(target) {
      checkTarget(target);
      byVersion.set(target.templateVersion, target);
    },
    get: (templateVersion) => byVersion.get(templateVersion),
    list: () => [...byVersion.values()].sort((a, b) => a.templateVersion.localeCompare(b.templateVersion)),
    columnsOf(kind) {
      let newest: ImportTarget | undefined;
      for (const t of byVersion.values())
        if (t.kind === kind && (!newest || versionNo(t.templateVersion) > versionNo(newest.templateVersion)))
          newest = t;
      return newest ? newest.columns : [];
    },
  };
}

let current: ImportTargetRegistry = createImportTargetRegistry();

/**
 * Installs the composition root's registry (server.ts) and returns the previous one (tests restore it). Until it is
 * called the registry is empty: an import of an unregistered template is `import.template_unknown`.
 */
export function setImportTargetRegistry(registry: ImportTargetRegistry): ImportTargetRegistry {
  const previous = current;
  current = registry;
  return previous;
}

/** The registry of this process. */
export function importTargetRegistry(): ImportTargetRegistry {
  return current;
}
