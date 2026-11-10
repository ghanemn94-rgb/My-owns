// The search document builders (ADR-0057 §1; REQ-S15-010; T-DG6-BE-P). One DERIVED `search_document` row per indexed
// record, for exactly the 12 record types of `p6_search_record_type_valid` (0108). Each builder reads EXACTLY the
// columns of the ADR-0057 §1 table (plus the scope keys and the record version), never a money, rate, FTE, KPI or score
// column (D-195 Q3; work split §H/G.14 item 2), and cuts free text only through the shared `truncateText`.
//
// Placement: p6-work-split §H/G.1 names `apps/api/src/modules/search/documents.ts`, but the only writers of
// `search_document` are the worker search handlers (ADR-0057 §1 "Writers: the worker search handlers only"), and the
// worker imports no API code (ADR-0002 rule 5; its build has rootDir `src`). The builders therefore live here, next to
// the handlers that use them; the API reads `search_document` directly (BE-P2's query) and needs no builder.
//
// Permission is decided at QUERY time, never here (ADR-0057 §3; work split §H/G.14 item 1): a document stores no
// permission data. The reads below still go through the job's service identity (ADR-0053 §1, D-195 Q13): each row is
// read with `serviceReadScopeFor(principal, "transformation.read").predicate(...)` for the principal of its own
// organization. The ONE declared exception (ADR-0057 §2; D-199 item 3; migration 0115 `reason`) is that the two
// search job codes read sensitive benefits, business cases and evidence too, restricted to these columns.
//
// Upserts honour `search_document_monotonic` (0108): a document never goes back to an older `source_audit_seq` or
// `record_version`, so a replayed or reordered batch changes nothing (exactly once by construction, rule 10).
// Nothing here reads or writes DG0-DG7, and indexing approves nothing.
import { hasText, truncateText } from "@mth/shared/schemas";
import { sql, type DbOrTx, type Tx } from "@mth/db";
import {
  ServiceScopeViolation,
  serviceReadScopeFor,
  type ServicePrincipal,
  type ServiceReadScope,
  type ServiceSensitiveRecordType,
} from "../service-scope.ts";

/** The closed set of indexed record types (0108 `p6_search_record_type_valid`), in the ADR-0057 §1 order. */
export const SEARCH_RECORD_TYPES = [
  "transformation",
  "initiative",
  "kpi_definition",
  "benefit",
  "raid_entry",
  "dependency",
  "decision",
  "deliverable",
  "evidence",
  "business_case",
  "lesson",
  "change_request",
] as const;
export type SearchRecordType = (typeof SEARCH_RECORD_TYPES)[number];

export const isSearchRecordType = (v: string): v is SearchRecordType =>
  (SEARCH_RECORD_TYPES as readonly string[]).includes(v);

/** The read permission every one of the 12 record views checks (ADR-0057 §3; the parity rule of BE-P2). */
export const SEARCH_READ_PERMISSION = "transformation.read";

/** The 0108 CHECK bounds of search_document. */
export const TITLE_MAX = 500;
export const SUMMARY_MAX = 1000;
export const CODE_MAX = 40;

/**
 * ADR-0057 §2 / D-199 item 3: the declared sensitive-read exception. Only these job codes, only these record types,
 * only the columns of SEARCH_DOCUMENT_SPECS. Any other principal reading through `readIndexRows` gets the ADR-0051 §2
 * sensitivity clause unchanged.
 */
export const SEARCH_SENSITIVE_READ_EXCEPTION = Object.freeze({
  jobCodes: Object.freeze(["job:search.index_feed", "job:search.reindex"]),
  recordTypes: Object.freeze(["benefit", "business_case", "evidence"] as const),
});

/** How `is_archived` is derived (ADR-0057 §1, last column). */
type ArchivedRule =
  | { readonly kind: "never" }
  | { readonly kind: "status"; readonly status: string }
  | { readonly kind: "archived_at" };

export interface SearchDocumentSpec {
  readonly recordType: SearchRecordType;
  /** The source table (= the audit `record_type`, ADR-0004). */
  readonly table: string;
  readonly code: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly archived: ArchivedRule;
  /** The ADR-0051 §2 sensitive types (benefit, business case, evidence); null for the others. */
  readonly sensitiveType: ServiceSensitiveRecordType | null;
}

const spec = (
  recordType: SearchRecordType,
  code: string | null,
  title: string,
  summary: string | null,
  archived: ArchivedRule,
  sensitiveType: ServiceSensitiveRecordType | null = null,
): SearchDocumentSpec =>
  Object.freeze({ recordType, table: recordType, code, title, summary, archived, sensitiveType });

const NEVER: ArchivedRule = { kind: "never" };
const ARCHIVED: ArchivedRule = { kind: "status", status: "archived" };

/** ADR-0057 §1, row by row. */
export const SEARCH_DOCUMENT_SPECS: Readonly<Record<SearchRecordType, SearchDocumentSpec>> = Object.freeze({
  transformation: spec("transformation", "code", "name", "description", { kind: "archived_at" }),
  initiative: spec("initiative", "code", "name", "objective", NEVER),
  kpi_definition: spec("kpi_definition", null, "name", "description", ARCHIVED),
  benefit: spec("benefit", "code", "title", "description", ARCHIVED, "benefit"),
  raid_entry: spec("raid_entry", "code", "description", null, NEVER),
  dependency: spec("dependency", "code", "description", null, ARCHIVED),
  decision: spec("decision", "code", "title", "context", NEVER),
  deliverable: spec("deliverable", null, "title", "description", ARCHIVED),
  evidence: spec("evidence", null, "title", "description", ARCHIVED, "evidence"),
  business_case: spec("business_case", "code", "title", null, ARCHIVED, "business_case"),
  lesson: spec("lesson", "code", "title", "context", ARCHIVED),
  change_request: spec("change_request", "code", "reason", null, { kind: "status", status: "withdrawn" }),
});

/**
 * Every source column a builder reads for a type: the scope keys, the version, the status and the §1 columns. Exported
 * for the "no value column is indexed" test.
 */
export function sourceColumnsOf(recordType: SearchRecordType): readonly string[] {
  const s = SEARCH_DOCUMENT_SPECS[recordType];
  const cols = ["id", "organization_id", "version", "status"];
  if (recordType !== "transformation") cols.push("transformation_id");
  if (s.code !== null) cols.push(s.code);
  cols.push(s.title);
  if (s.summary !== null) cols.push(s.summary);
  if (s.archived.kind === "archived_at") cols.push("archived_at");
  return Object.freeze(cols);
}

/** One row as read from the source table (the aliases of `readIndexRows`). */
export interface SourceRow {
  readonly id: string;
  readonly organization_id: string;
  readonly transformation_id: string;
  readonly version: number;
  readonly status: string | null;
  readonly code: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly archived_at: Date | null;
}

/** The content of a document (what the builder derives from one source row). */
export interface SearchDocumentInput {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly recordType: SearchRecordType;
  readonly recordId: string;
  readonly recordVersion: number;
  readonly code: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly recordStatus: string | null;
  readonly isArchived: boolean;
}

/** Free text cut to `max` through the shared rule; blank (no visible content) is absent. */
function text(value: string | null, max: number): string | null {
  if (!hasText(value)) return null;
  return truncateText(value, max);
}

/** The document of one source row (pure; ADR-0057 §1). A row without a title cannot be indexed and throws. */
export function buildDocument(recordType: SearchRecordType, row: SourceRow): SearchDocumentInput {
  const s = SEARCH_DOCUMENT_SPECS[recordType];
  const title = text(row.title, TITLE_MAX);
  if (title === null) throw new Error(`search: ${recordType} ${row.id} has no title to index`);
  const isArchived =
    s.archived.kind === "never"
      ? false
      : s.archived.kind === "archived_at"
        ? row.archived_at !== null
        : row.status === s.archived.status;
  return Object.freeze({
    organizationId: row.organization_id,
    transformationId: recordType === "transformation" ? row.id : row.transformation_id,
    recordType,
    recordId: row.id,
    recordVersion: row.version,
    code: s.code === null ? null : text(row.code, CODE_MAX),
    title,
    summary: s.summary === null ? null : text(row.summary, SUMMARY_MAX),
    recordStatus: row.status,
    isArchived,
  });
}

/** Whether the declared exception admits sensitive rows of this type for this principal. */
export function exceptionAdmits(principal: ServicePrincipal, recordType: SearchRecordType): boolean {
  const s = SEARCH_DOCUMENT_SPECS[recordType];
  return (
    s.sensitiveType !== null &&
    SEARCH_SENSITIVE_READ_EXCEPTION.jobCodes.includes(principal.code) &&
    (SEARCH_SENSITIVE_READ_EXCEPTION.recordTypes as readonly string[]).includes(s.sensitiveType)
  );
}

/** The scope keys of some rows of one type (id and organization only: what the scope decision needs). */
export async function scopeKeysOf(
  tx: DbOrTx,
  recordType: SearchRecordType,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const table = sql.table(SEARCH_DOCUMENT_SPECS[recordType].table);
  const rows = await sql<{ id: string; organization_id: string }>`
    SELECT id, organization_id FROM ${table} WHERE id = ANY(${[...ids]}::uuid[])`.execute(tx);
  return new Map(rows.rows.map((r) => [r.id, r.organization_id]));
}

/**
 * Reads the §1 columns of `ids` (all of one organization) through the principal's scope. A principal without
 * `transformation.read` throws `service_identity.out_of_scope` before anything is read; a row the scope does not
 * admit (another organization, or a sensitive row outside the declared exception) throws too, so an out-of-scope row
 * is never mistaken for a removed one (whose document would be deleted).
 */
export async function readIndexRows(
  tx: DbOrTx,
  recordType: SearchRecordType,
  scope: ServiceReadScope,
  ids: readonly string[],
): Promise<SourceRow[]> {
  if (ids.length === 0) return [];
  if (!scope.principal.permissions.has(SEARCH_READ_PERMISSION) || scope.permission !== SEARCH_READ_PERMISSION)
    throw new ServiceScopeViolation();
  const s = SEARCH_DOCUMENT_SPECS[recordType];
  const table = sql.table(s.table);
  const col = (name: string | null) => (name === null ? sql`NULL::text` : sql.ref(`r.${name}`));
  const predicate = scope.predicate({
    recordType: exceptionAdmits(scope.principal, recordType) ? null : s.sensitiveType,
    recordId: sql.ref("r.id"),
    organizationId: sql.ref("r.organization_id"),
  });
  const rows = await sql<SourceRow>`
    SELECT r.id, r.organization_id,
           ${recordType === "transformation" ? sql.ref("r.id") : sql.ref("r.transformation_id")} AS transformation_id,
           r.version, r.status::text AS status,
           ${col(s.code)}::text AS code, ${col(s.title)}::text AS title, ${col(s.summary)}::text AS summary,
           ${s.archived.kind === "archived_at" ? sql.ref("r.archived_at") : sql`NULL::timestamptz`} AS archived_at
      FROM ${table} r
     WHERE r.id = ANY(${[...ids]}::uuid[]) AND ${predicate}
     ORDER BY r.id`.execute(tx);
  if (rows.rows.length !== ids.length) throw new ServiceScopeViolation();
  return rows.rows;
}

/** The scope of each organization's principal, built once per transaction (never cached across runs). */
export class ScopeCache {
  private readonly scopes = new Map<string, ServiceReadScope>();
  private readonly tx: DbOrTx;
  private readonly principalOf: (organizationId: string) => ServicePrincipal;
  constructor(tx: DbOrTx, principalOf: (organizationId: string) => ServicePrincipal) {
    this.tx = tx;
    this.principalOf = principalOf;
  }
  async of(organizationId: string): Promise<ServiceReadScope> {
    const hit = this.scopes.get(organizationId);
    if (hit !== undefined) return hit;
    const scope = await serviceReadScopeFor(this.tx, this.principalOf(organizationId), SEARCH_READ_PERMISSION);
    this.scopes.set(organizationId, scope);
    return scope;
  }
}

/**
 * Reads the current rows of `ids` of one type through each row's organization scope. Returns the rows found and the ids
 * that no longer exist (their documents are deleted).
 */
export async function readCurrent(
  tx: DbOrTx,
  recordType: SearchRecordType,
  ids: readonly string[],
  scopes: ScopeCache,
): Promise<{ rows: SourceRow[]; removed: string[] }> {
  const keys = await scopeKeysOf(tx, recordType, ids);
  const removed = ids.filter((id) => !keys.has(id));
  const byOrg = new Map<string, string[]>();
  for (const [id, org] of keys) {
    const list = byOrg.get(org) ?? [];
    list.push(id);
    byOrg.set(org, list);
  }
  const rows: SourceRow[] = [];
  for (const [org, orgIds] of [...byOrg].sort(([a], [b]) => (a < b ? -1 : 1)))
    rows.push(...(await readIndexRows(tx, recordType, await scopes.of(org), orgIds)));
  return { rows, removed };
}

export type UpsertMode = "feed" | "reindex";

/**
 * Inserts or updates the document of one record. `feed`: an existing document changes only when this write reflects a
 * newer audit sequence (a replay changes nothing). `reindex`: it changes when the content differs or the sequence is
 * newer, and its sequence becomes greatest(existing, sourceAuditSeq). Either way it never goes back to an older
 * `record_version` or `source_audit_seq` (0108 `search_document_monotonic`), and the version steps by exactly 1.
 * Returns true when a row was inserted or changed.
 */
export async function upsertDocument(
  tx: Tx,
  doc: SearchDocumentInput,
  sourceAuditSeq: string,
  mode: UpsertMode,
): Promise<boolean> {
  const changedWhen =
    mode === "feed"
      ? sql`search_document.source_audit_seq < EXCLUDED.source_audit_seq`
      : sql`(search_document.source_audit_seq < EXCLUDED.source_audit_seq
             OR (search_document.organization_id, search_document.transformation_id, search_document.record_version,
                 search_document.code, search_document.title, search_document.summary, search_document.record_status,
                 search_document.is_archived)
                IS DISTINCT FROM
                (EXCLUDED.organization_id, EXCLUDED.transformation_id, EXCLUDED.record_version, EXCLUDED.code,
                 EXCLUDED.title, EXCLUDED.summary, EXCLUDED.record_status, EXCLUDED.is_archived))`;
  const res = await sql<{ id: string }>`
    INSERT INTO search_document (id, organization_id, transformation_id, record_type, record_id, record_version, code,
                                 title, summary, record_status, is_archived, source_audit_seq)
    VALUES (mth_uuid_v7(), ${doc.organizationId}::uuid, ${doc.transformationId}::uuid, ${doc.recordType},
            ${doc.recordId}::uuid, ${doc.recordVersion}, ${doc.code}, ${doc.title}, ${doc.summary}, ${doc.recordStatus},
            ${doc.isArchived}, ${sourceAuditSeq}::bigint)
    ON CONFLICT ON CONSTRAINT search_document_record_key DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      transformation_id = EXCLUDED.transformation_id,
      record_version = EXCLUDED.record_version,
      code = EXCLUDED.code,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      record_status = EXCLUDED.record_status,
      is_archived = EXCLUDED.is_archived,
      source_audit_seq = GREATEST(search_document.source_audit_seq, EXCLUDED.source_audit_seq),
      version = search_document.version + 1,
      updated_at = now()
    WHERE EXCLUDED.record_version >= search_document.record_version AND ${changedWhen}
    RETURNING id`.execute(tx);
  return res.rows.length > 0;
}

/** Deletes the document of a removed record (0108 SD11). Returns true when one existed. */
export async function deleteDocument(tx: Tx, recordType: SearchRecordType, recordId: string): Promise<boolean> {
  const res = await tx
    .deleteFrom("search_document")
    .where("record_type", "=", recordType)
    .where("record_id", "=", recordId)
    .executeTakeFirst();
  return Number(res.numDeletedRows) > 0;
}
