// The migration export (ADR-0064 §1-§5, §7; T-DG7-BE-C): the encoder and the package writer, shared byte for byte by
// the worker job `transfer.export` (an EvidenceStore sink) and `mth-db export-migration --out <dir>` (a directory sink).
//
// Encoding (ADR-0064 §2.3): one NDJSON line per row, keys = the table's columns in attribute order. Every value is its
// PostgreSQL text output as a JSON string, under pinned settings (TimeZone UTC, DateStyle ISO/YMD, IntervalStyle
// postgres, extra_float_digits 3, bytea_output hex): numeric money and rates stay exact decimal strings (never a JSON
// number), uuids unchanged, timestamptz with microseconds, arrays as array literals, boolean "t"/"f". json/jsonb values
// are their JSON text as PostgreSQL prints it (embedded verbatim, so no number is re-parsed and rounded); SQL NULL is
// null. Rows are sorted by primary key text (code point order). `contentDigest` = SHA-256 over the lines, each ending
// "\n"; the sink reports the SHA-256 of the bytes it stored (`fileSha256`) and the export fails unless they are equal.
//
// SecretRef columns (ADR-0064 §4; transfer_column_rule): {provider, name} becomes {"provider": "unbound", name}, and
// every entry of a credential_refs object likewise. The name stays; it is never a secret value (ADR-0052 §5).
//
// Snapshot and I/O (p7-work-split §2 rule 2, "no remote I/O inside a transaction"): every table, the attachment rows,
// the migration level, the marker and the demo checksum are read in ONE `REPEATABLE READ, READ ONLY` transaction;
// the files are written and the evidence objects read only after it has ended. Evidence objects are immutable once
// recorded (an evidence_content revision is append-only), so reading them after the snapshot reads the bytes the
// snapshot's rows name. A missing or mismatching object fails the export, naming the object; it is never skipped.
//
// No API operation returns what this writes: the package stays in IT-controlled storage (ADR-0064 §7). Exporting
// approves nothing (no G1-G6, Finance or IT approval) and never reads or writes DG0-DG7.
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { sql } from "kysely";
import type { Db, DbOrTx } from "../pool.ts";
import {
  ATTACHMENT_MANIFEST_FILE,
  ATTACHMENT_MANIFEST_SCHEMA_VERSION,
  canonicalAttachmentManifest,
  canonicalManifest,
  demoChecksumFor,
  MANIFEST_FILE,
  MANIFEST_SCHEMA_VERSION,
  packageAppVersion,
  readSourceEnvironment,
  type AttachmentEntry,
  type ManifestTable,
  type MigrationManifest,
  type SourceEnvironment,
} from "./manifest.ts";
import { buildPlan, byCodePoint, type TransferPlan, type TransferPlanTable } from "./plan.ts";

/** The pinned session settings of the encoder (ADR-0064 §2.3), set with SET LOCAL in the snapshot. */
export const ENCODER_SETTINGS: readonly (readonly [string, string])[] = [
  ["TimeZone", "UTC"],
  ["DateStyle", "ISO, YMD"],
  ["IntervalStyle", "postgres"],
  ["extra_float_digits", "3"],
  ["bytea_output", "hex"],
];

/** The EvidenceStore prefix of a package written by the job (ADR-0064 §1, §7): `transfer/migration-exports/<id>/`. */
export const MIGRATION_EXPORT_PREFIX = "transfer/migration-exports";
export const migrationExportKey = (exportId: string, file: string): string =>
  `${MIGRATION_EXPORT_PREFIX}/${exportId}/${file}`;

/** Where a package's files go. Paths are relative to the package root (`tables/x.ndjson`, `manifest.json`, …). */
export interface PackageSink {
  /** Stores the bytes durably; returns the SHA-256 and size of what was stored. */
  write(path: string, bytes: Uint8Array): Promise<{ readonly sha256: string; readonly size: number }>;
}

/** An evidence object a row names. */
export interface ObjectRef {
  readonly objectName: string;
  readonly parentTable: string;
  readonly parentId: string;
  /** The row's `storage_driver` where the table records one (evidence_content), else null. */
  readonly driver: string | null;
}

/** Where the evidence bytes are read from (the EvidenceStore port, or a filesystem root for the CLI). */
export interface ObjectSource {
  /** The object's bytes, or null when it does not exist. */
  read(ref: ObjectRef): Promise<Uint8Array | null>;
}

export interface ExportOptions {
  /** The `migration_export.id` this package belongs to (the manifest's `exportId`). */
  readonly exportId: string;
  readonly objects: ObjectSource;
  /** Default: the @mth/db package version (packageAppVersion). */
  readonly appVersion?: string;
}

export interface ExportResult {
  readonly manifest: MigrationManifest;
  readonly manifestSha256: string;
  readonly attachmentManifestSha256: string;
  readonly sourceEnvironment: SourceEnvironment;
  readonly migrationLevel: string;
  readonly demoChecksum: string | null;
  readonly tableCount: number;
  /** Decimal string (bigint). */
  readonly rowCount: string;
  readonly attachmentCount: number;
  /** Decimal string (bigint). */
  readonly attachmentBytes: string;
}

/** A failed export; `message` is the `<reason>` of `export-migration: failed: <reason>` and of failure_reason. */
export class ExportFailed extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ExportFailed";
  }
}

export const transferSha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

// ------------------------------------------------------------------------------------------------ the encoder

/** The column kinds the encoder distinguishes. */
export type ColumnKind = "text" | "bool" | "json" | "secret_ref" | "secret_refs";

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** The SQL expression that yields a column's encoded text (null for SQL NULL). */
export function columnExpression(column: string, kind: ColumnKind): string {
  const c = ident(column);
  switch (kind) {
    case "bool":
      // boolout's "t"/"f" (a cast to text would say true/false).
      return `CASE WHEN ${c} THEN 't' WHEN NOT ${c} THEN 'f' END`;
    case "json":
      return `${c}::text`;
    case "secret_ref":
      return `(CASE WHEN jsonb_typeof(${c}) = 'object' THEN jsonb_set(${c}, '{provider}', '"unbound"') ELSE ${c} END)::text`;
    case "secret_refs":
      return (
        `(CASE WHEN jsonb_typeof(${c}) = 'object' THEN (SELECT coalesce(jsonb_object_agg(e.key, ` +
        `CASE WHEN jsonb_typeof(e.value) = 'object' THEN jsonb_set(e.value, '{provider}', '"unbound"') ELSE e.value END), ` +
        `'{}'::jsonb) FROM jsonb_each(${c}) AS e) ELSE ${c} END)::text`
      );
    default:
      return `${c}::text`;
  }
}

/** One encoded line (without its "\n"): `{"col":"text",…}`; json kinds embed their JSON text verbatim. */
export function encodeLine(
  columns: readonly { readonly name: string; readonly kind: ColumnKind }[],
  values: readonly (string | null)[],
): string {
  const parts: string[] = [];
  columns.forEach((col, i) => {
    const v = values[i] ?? null;
    const encoded =
      v === null
        ? "null"
        : col.kind === "json" || col.kind === "secret_ref" || col.kind === "secret_refs"
          ? v
          : JSON.stringify(v);
    parts.push(`${JSON.stringify(col.name)}:${encoded}`);
  });
  return `{${parts.join(",")}}`;
}

/** The kinds of a table's columns (bool, json/jsonb, the SecretRef rules; text otherwise). */
export function columnKinds(
  table: TransferPlanTable,
  rewritten: TransferPlan["rewrittenColumns"],
): { readonly name: string; readonly kind: ColumnKind }[] {
  return table.columns.map((c) => {
    const rule = rewritten.find((r) => r.table === table.name && r.column === c.name);
    if (rule !== undefined) {
      if (c.type !== "jsonb")
        throw new ExportFailed(`column ${table.name}.${c.name} has a SecretRef rule but is not jsonb`);
      return { name: c.name, kind: rule.rule === "secret_refs_unbind" ? "secret_refs" : "secret_ref" };
    }
    if (c.type === "bool") return { name: c.name, kind: "bool" };
    if (c.type === "jsonb") return { name: c.name, kind: "json" };
    // A `json` value is stored as typed and may hold raw newlines (which would break NDJSON): none exists today, and
    // a test pins it; a future json column fails the export instead of writing a broken line.
    if (c.type === "json")
      throw new ExportFailed(`column ${table.name}.${c.name} is of type json; only jsonb is supported`);
    return { name: c.name, kind: "text" };
  });
}

export interface EncodedTable {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly rowCount: number;
  readonly contentDigest: string;
}

/** Encodes one table in the caller's transaction (which must have the pinned settings). */
export async function encodeTable(
  db: DbOrTx,
  table: TransferPlanTable,
  rewritten: TransferPlan["rewrittenColumns"],
  opts: { readonly where?: string } = {},
): Promise<EncodedTable> {
  const kinds = columnKinds(table, rewritten);
  const select = kinds.map((k, i) => `${columnExpression(k.name, k.kind)} AS c${i}`).join(", ");
  const order = table.primaryKey.map((c) => `${ident(c)}::text COLLATE "C"`).join(", ");
  const r = await sql<Record<string, string | null>>`${sql.raw(
    `SELECT ${select} FROM ${ident(table.name)}${opts.where !== undefined ? ` WHERE ${opts.where}` : ""} ORDER BY ${order}`,
  )}`.execute(db);
  const hash = createHash("sha256");
  const lines: string[] = [];
  for (const row of r.rows) {
    const line = `${encodeLine(
      kinds,
      kinds.map((_, i) => row[`c${i}`] ?? null),
    )}\n`;
    hash.update(line, "utf8");
    lines.push(line);
  }
  return {
    name: table.name,
    bytes: Buffer.from(lines.join(""), "utf8"),
    rowCount: r.rows.length,
    contentDigest: hash.digest("hex"),
  };
}

// ------------------------------------------------------------------------------------------------ attachments

/** An attachment row read in the snapshot, with what the row says the object is. */
export interface AttachmentRow extends ObjectRef {
  readonly sha256: string;
  readonly sizeBytes: string;
}

/** The expected checksum and size columns of a table that names objects (ADR-0064 §5). */
function checksumColumns(table: TransferPlanTable): { sha: string; size: string } {
  const has = (n: string) => table.columns.some((c) => c.name === n);
  if (has("sha256") && has("size_bytes")) return { sha: "sha256", size: "size_bytes" };
  if (has("file_sha256") && has("file_size_bytes")) return { sha: "file_sha256", size: "file_size_bytes" };
  throw new ExportFailed(`table ${table.name} names evidence objects but records no SHA-256 and size`);
}

async function attachmentRows(db: DbOrTx, plan: TransferPlan): Promise<AttachmentRow[]> {
  const out: AttachmentRow[] = [];
  for (const oc of plan.objectColumns) {
    const table = plan.tables.find((t) => t.name === oc.table)!;
    if (!table.columns.some((c) => c.name === "id")) throw new ExportFailed(`table ${table.name} has no id column`);
    const { sha, size } = checksumColumns(table);
    const driver = table.columns.some((c) => c.name === "storage_driver") ? `${ident("storage_driver")}::text` : "NULL";
    const r = await sql<{ id: string; key: string; sha: string; size: string; driver: string | null }>`${sql.raw(
      `SELECT id::text AS id, ${ident(oc.column)} AS key, ${ident(sha)}::text AS sha, ${ident(size)}::text AS size, ` +
        `${driver} AS driver FROM ${ident(table.name)} WHERE ${ident(oc.column)} IS NOT NULL ORDER BY id::text COLLATE "C"`,
    )}`.execute(db);
    for (const row of r.rows)
      out.push({
        objectName: row.key,
        parentTable: table.name,
        parentId: row.id,
        driver: row.driver,
        sha256: row.sha.trim(),
        sizeBytes: row.size,
      });
  }
  return out.sort(
    (a, b) =>
      byCodePoint(a.parentTable, b.parentTable) ||
      byCodePoint(a.parentId, b.parentId) ||
      byCodePoint(a.objectName, b.objectName),
  );
}

// ------------------------------------------------------------------------------------------------ the export

interface Snapshot {
  readonly plan: TransferPlan;
  readonly tables: readonly EncodedTable[];
  readonly attachments: readonly AttachmentRow[];
  readonly migrationLevel: string;
  readonly sourceEnvironment: SourceEnvironment;
  readonly demoChecksum: string | null;
  readonly createdAt: string;
}

/** The highest applied migration's name without `.sql` (ADR-0064 §2.1 `migrationLevel`). */
export async function readMigrationLevel(db: DbOrTx): Promise<string> {
  const r = await sql<{ name: string }>`SELECT name FROM schema_migration ORDER BY id DESC LIMIT 1`.execute(db);
  const name = r.rows[0]?.name;
  if (name === undefined) throw new ExportFailed("the source database is not migrated");
  return name.replace(/\.sql$/, "");
}

/** Reads everything in one REPEATABLE READ, READ ONLY transaction. */
export async function takeSnapshot(db: Db): Promise<Snapshot> {
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (tx) => {
      for (const [name, value] of ENCODER_SETTINGS) await sql`SELECT set_config(${name}, ${value}, true)`.execute(tx);
      const at = await sql<{ at: Date }>`SELECT now() AS at`.execute(tx);
      const plan = await buildPlan(tx);
      const tables: EncodedTable[] = [];
      for (const t of plan.tables) tables.push(await encodeTable(tx, t, plan.rewrittenColumns));
      const attachments = await attachmentRows(tx, plan);
      const migrationLevel = await readMigrationLevel(tx);
      const sourceEnvironment = await readSourceEnvironment(tx);
      // Last: datasetChecksum re-pins some settings for the rest of the transaction.
      const demoChecksum = await demoChecksumFor(tx, sourceEnvironment);
      return {
        plan,
        tables,
        attachments,
        migrationLevel,
        sourceEnvironment,
        demoChecksum,
        createdAt: at.rows[0]!.at.toISOString(),
      };
    });
}

/**
 * Writes the whole package of `db`'s current state to `sink` (ADR-0064 §1): the table files, one file per distinct
 * evidence object, attachments.json and, last, manifest.json. Throws ExportFailed with the reason on any failure.
 */
export async function exportPackage(db: Db, sink: PackageSink, opts: ExportOptions): Promise<ExportResult> {
  const snap = await takeSnapshot(db);

  // Tables (after the snapshot ended: no I/O inside a transaction).
  const tables: ManifestTable[] = [];
  let rows = 0n;
  for (const t of snap.plan.tables) {
    const enc = snap.tables.find((e) => e.name === t.name)!;
    const file = `tables/${t.name}.ndjson`;
    const stored = await sink.write(file, enc.bytes);
    if (stored.sha256 !== enc.contentDigest)
      throw new ExportFailed(`the stored file ${file} does not match its content digest`);
    rows += BigInt(enc.rowCount);
    tables.push({
      name: t.name,
      file,
      loadPhase: t.loadPhase,
      rowCount: String(enc.rowCount),
      fileSha256: stored.sha256,
      contentDigest: enc.contentDigest,
      columns: t.columns.map((c) => c.name),
      deferredColumns: [...t.deferredColumns],
    });
  }

  // Evidence objects: verified against their rows, written once per distinct SHA-256.
  const items: AttachmentEntry[] = [];
  const written = new Set<string>();
  let bytes = 0n;
  for (const a of snap.attachments) {
    const data = await opts.objects.read(a);
    if (data === null)
      throw new ExportFailed(`evidence object ${a.objectName} (${a.parentTable} ${a.parentId}) is missing`);
    const sha = transferSha256(data);
    if (sha !== a.sha256 || String(data.byteLength) !== a.sizeBytes)
      throw new ExportFailed(
        `evidence object ${a.objectName} (${a.parentTable} ${a.parentId}) does not match its recorded SHA-256 and size`,
      );
    const file = `attachments/${sha}`;
    if (!written.has(sha)) {
      const stored = await sink.write(file, data);
      if (stored.sha256 !== sha) throw new ExportFailed(`the stored file ${file} does not match its SHA-256`);
      written.add(sha);
    }
    bytes += BigInt(data.byteLength);
    items.push({
      objectName: a.objectName,
      sizeBytes: a.sizeBytes,
      sha256: sha,
      parentTable: a.parentTable,
      parentId: a.parentId,
      file,
    });
  }
  const attachmentText = canonicalAttachmentManifest({
    schemaVersion: ATTACHMENT_MANIFEST_SCHEMA_VERSION,
    exportId: opts.exportId,
    items,
  });
  const attachmentBytes = Buffer.from(attachmentText, "utf8");
  const attachmentSha = transferSha256(attachmentBytes);
  const storedAttachments = await sink.write(ATTACHMENT_MANIFEST_FILE, attachmentBytes);
  if (storedAttachments.sha256 !== attachmentSha)
    throw new ExportFailed(`the stored file ${ATTACHMENT_MANIFEST_FILE} does not match its SHA-256`);

  const manifest: MigrationManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportId: opts.exportId,
    sourceEnvironment: snap.sourceEnvironment,
    demoChecksum: snap.demoChecksum,
    migrationLevel: snap.migrationLevel,
    createdAt: snap.createdAt,
    appVersion: opts.appVersion ?? packageAppVersion(),
    tables,
    excludedTables: snap.plan.excludedTables,
    rewrittenColumns: snap.plan.rewrittenColumns,
    attachmentManifest: {
      file: ATTACHMENT_MANIFEST_FILE,
      sha256: attachmentSha,
      count: items.length,
      bytes: String(bytes),
    },
    totals: { tables: tables.length, rows: String(rows) },
  };
  const manifestBytes = Buffer.from(canonicalManifest(manifest), "utf8");
  const manifestSha = transferSha256(manifestBytes);
  const storedManifest = await sink.write(MANIFEST_FILE, manifestBytes);
  if (storedManifest.sha256 !== manifestSha)
    throw new ExportFailed(`the stored file ${MANIFEST_FILE} does not match its SHA-256`);

  return {
    manifest,
    manifestSha256: manifestSha,
    attachmentManifestSha256: attachmentSha,
    sourceEnvironment: snap.sourceEnvironment,
    migrationLevel: snap.migrationLevel,
    demoChecksum: snap.demoChecksum,
    tableCount: tables.length,
    rowCount: String(rows),
    attachmentCount: items.length,
    attachmentBytes: String(bytes),
  };
}

// ------------------------------------------------------------------------------------------------ filesystem adapters

/** Resolves `relative` under `root`, refusing any path that escapes it. */
export function confinedPath(root: string, relative: string): string {
  const base = resolve(root);
  if (relative.length === 0 || isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
    throw new ExportFailed(`invalid path ${JSON.stringify(relative)}`);
  const p = resolve(join(base, relative));
  if (!p.startsWith(base + sep)) throw new ExportFailed(`path ${JSON.stringify(relative)} escapes its root`);
  return p;
}

/**
 * A sink that writes under a directory (the CLI's `--out <dir>`; the worker's store root plus the export prefix).
 * Atomic per file (temporary file, fsync, rename); it re-reads the stored file to report its SHA-256.
 */
export function directorySink(root: string): PackageSink {
  return {
    async write(path, bytes) {
      const target = confinedPath(root, path);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.part`;
      const handle = await open(temporary, "w", 0o640);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      const stored = await readFile(target);
      return { sha256: transferSha256(stored), size: stored.byteLength };
    },
  };
}

/**
 * Reads evidence objects from a filesystem store root (the layout of the API's filesystem adapter: `<root>/<key>`).
 * An object recorded under another driver (s3) is refused with its name: this reader has no S3 client.
 */
export function filesystemObjectSource(root: string): ObjectSource {
  return {
    async read(ref) {
      if (ref.driver !== null && ref.driver !== "filesystem")
        throw new ExportFailed(
          `evidence object ${ref.objectName} (${ref.parentTable} ${ref.parentId}) is in the ${ref.driver} store, which this export cannot read`,
        );
      try {
        return new Uint8Array(await readFile(confinedPath(root, ref.objectName)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
  };
}
