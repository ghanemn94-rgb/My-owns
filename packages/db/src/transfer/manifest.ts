// The migration manifest and the attachment manifest (ADR-0064 §2.1, §5; T-DG7-BE-C): their canonical writers and
// strict readers. Canonical JSON: keys in the ADR's order, no insignificant whitespace, one final newline, strict UTF-8.
// Every count that may exceed 2^53 (row counts, byte sizes) is a decimal string, never a JSON number.
//
// `sourceEnvironment` is the environment-marker field (D-244 O2): `demo` / `production` from the source's
// deployment_environment row, `unmarked` when it has none. `demoChecksum` is the ADR-0050 checksum
// (`datasetChecksum`, packages/db/src/demo/checksum.ts) for a demo source and null for every other source. A demo
// package stays labelled synthetic wherever it is imported: the marker row travels with the data.
// A manifest is an engineering artefact of an installation; it approves nothing (no G1-G6, Finance or IT approval) and
// never reads or writes DG0-DG7.
import { readFileSync } from "node:fs";
import { datasetChecksum } from "../demo/checksum.ts";
import { readDeploymentEnvironment } from "../demo/guard.ts";
import type { DbOrTx } from "../pool.ts";
import type { TransferColumnRuleKind, TransferTableRuleKind } from "./plan.ts";

export const MANIFEST_SCHEMA_VERSION = "mth-migration/1";
export const ATTACHMENT_MANIFEST_SCHEMA_VERSION = "mth-attachment-manifest/1";
export const MANIFEST_FILE = "manifest.json";
export const ATTACHMENT_MANIFEST_FILE = "attachments.json";

export type SourceEnvironment = "production" | "demo" | "unmarked";

export interface ManifestTable {
  readonly name: string;
  readonly file: string;
  readonly loadPhase: number;
  readonly rowCount: string;
  readonly fileSha256: string;
  readonly contentDigest: string;
  readonly columns: readonly string[];
  readonly deferredColumns: readonly string[];
}

export interface MigrationManifest {
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  readonly exportId: string;
  readonly sourceEnvironment: SourceEnvironment;
  readonly demoChecksum: string | null;
  readonly migrationLevel: string;
  readonly createdAt: string;
  readonly appVersion: string;
  readonly tables: readonly ManifestTable[];
  readonly excludedTables: readonly {
    readonly name: string;
    readonly rule: TransferTableRuleKind;
    readonly reason: string;
  }[];
  readonly rewrittenColumns: readonly {
    readonly table: string;
    readonly column: string;
    readonly rule: TransferColumnRuleKind;
  }[];
  readonly attachmentManifest: {
    readonly file: typeof ATTACHMENT_MANIFEST_FILE;
    readonly sha256: string;
    readonly count: number;
    readonly bytes: string;
  };
  readonly totals: { readonly tables: number; readonly rows: string };
}

export interface AttachmentEntry {
  readonly objectName: string;
  readonly sizeBytes: string;
  readonly sha256: string;
  readonly parentTable: string;
  readonly parentId: string;
  readonly file: string;
}

export interface AttachmentManifest {
  readonly schemaVersion: typeof ATTACHMENT_MANIFEST_SCHEMA_VERSION;
  readonly exportId: string;
  readonly items: readonly AttachmentEntry[];
}

/** A manifest that is not in the format of this release (the importer's refusal; ADR-0064 §6 step 1). */
export class ManifestFormatError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ManifestFormatError";
  }
}

// ------------------------------------------------------------------------------------------------ canonical writers

/** The manifest's canonical text (keys in ADR-0064 §2.1 order, compact, one final newline). */
export function canonicalManifest(m: MigrationManifest): string {
  const ordered = {
    schemaVersion: m.schemaVersion,
    exportId: m.exportId,
    sourceEnvironment: m.sourceEnvironment,
    demoChecksum: m.demoChecksum,
    migrationLevel: m.migrationLevel,
    createdAt: m.createdAt,
    appVersion: m.appVersion,
    tables: m.tables.map((t) => ({
      name: t.name,
      file: t.file,
      loadPhase: t.loadPhase,
      rowCount: t.rowCount,
      fileSha256: t.fileSha256,
      contentDigest: t.contentDigest,
      columns: [...t.columns],
      deferredColumns: [...t.deferredColumns],
    })),
    excludedTables: m.excludedTables.map((e) => ({ name: e.name, rule: e.rule, reason: e.reason })),
    rewrittenColumns: m.rewrittenColumns.map((c) => ({ table: c.table, column: c.column, rule: c.rule })),
    attachmentManifest: {
      file: m.attachmentManifest.file,
      sha256: m.attachmentManifest.sha256,
      count: m.attachmentManifest.count,
      bytes: m.attachmentManifest.bytes,
    },
    totals: { tables: m.totals.tables, rows: m.totals.rows },
  };
  return `${JSON.stringify(ordered)}\n`;
}

/** The attachment manifest's canonical text (ADR-0064 §5). */
export function canonicalAttachmentManifest(a: AttachmentManifest): string {
  const ordered = {
    schemaVersion: a.schemaVersion,
    exportId: a.exportId,
    items: a.items.map((i) => ({
      objectName: i.objectName,
      sizeBytes: i.sizeBytes,
      sha256: i.sha256,
      parentTable: i.parentTable,
      parentId: i.parentId,
      file: i.file,
    })),
  };
  return `${JSON.stringify(ordered)}\n`;
}

// ------------------------------------------------------------------------------------------------ strict readers

const SHA = /^[0-9a-f]{64}$/;
const COUNT = /^(0|[1-9][0-9]{0,18})$/;
const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEVEL = /^[0-9]{4}_[a-z0-9_]+$/;

const fail = (detail: string): never => {
  throw new ManifestFormatError(detail);
};
const obj = (v: unknown, at: string): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail(`${at}: not an object`);
const str = (v: unknown, at: string, re?: RegExp): string =>
  typeof v === "string" && (re === undefined || re.test(v)) ? v : fail(`${at}: invalid`);
const int = (v: unknown, at: string, min: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= min ? v : fail(`${at}: invalid`);
const strs = (v: unknown, at: string, re: RegExp): string[] =>
  Array.isArray(v) ? v.map((x, i) => str(x, `${at}[${i}]`, re)) : fail(`${at}: not an array`);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[], at: string): void => {
  const got = Object.keys(o);
  if (got.length !== keys.length || got.some((k, i) => k !== keys[i])) fail(`${at}: keys differ from the format`);
};

/** Decodes strict UTF-8 (a malformed byte sequence is refused, never replaced). */
export function decodeStrictUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return fail("not valid UTF-8");
  }
}

/** The schema version of a manifest text, or null when it has none (the importer's first check). */
export function manifestSchemaVersion(text: string): string | null {
  try {
    const v = (JSON.parse(text) as Record<string, unknown>)["schemaVersion"];
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Reads a manifest (strict: the exact format of ADR-0064 §2.1, canonical bytes). */
export function parseManifest(text: string): MigrationManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("manifest.json: not JSON");
  }
  const m = obj(raw, "manifest");
  if (m["schemaVersion"] !== MANIFEST_SCHEMA_VERSION)
    fail(`unsupported manifest schema version '${String(m["schemaVersion"])}'`);
  exactKeys(
    m,
    [
      "schemaVersion",
      "exportId",
      "sourceEnvironment",
      "demoChecksum",
      "migrationLevel",
      "createdAt",
      "appVersion",
      "tables",
      "excludedTables",
      "rewrittenColumns",
      "attachmentManifest",
      "totals",
    ],
    "manifest",
  );
  const sourceEnvironment = str(m["sourceEnvironment"], "sourceEnvironment") as SourceEnvironment;
  if (!["production", "demo", "unmarked"].includes(sourceEnvironment)) fail("sourceEnvironment: invalid");
  const demoChecksum = m["demoChecksum"] === null ? null : str(m["demoChecksum"], "demoChecksum", SHA);
  if ((demoChecksum !== null) !== (sourceEnvironment === "demo")) fail("demoChecksum: set exactly for a demo source");
  if (!Array.isArray(m["tables"])) fail("tables: not an array");
  const tables = (m["tables"] as unknown[]).map((v, i): ManifestTable => {
    const t = obj(v, `tables[${i}]`);
    exactKeys(
      t,
      ["name", "file", "loadPhase", "rowCount", "fileSha256", "contentDigest", "columns", "deferredColumns"],
      `tables[${i}]`,
    );
    const name = str(t["name"], `tables[${i}].name`, NAME);
    return {
      name,
      file: str(t["file"], `tables[${i}].file`, /^tables\/[a-z][a-z0-9_]{0,62}\.ndjson$/),
      loadPhase: int(t["loadPhase"], `tables[${i}].loadPhase`, 1),
      rowCount: str(t["rowCount"], `tables[${i}].rowCount`, COUNT),
      fileSha256: str(t["fileSha256"], `tables[${i}].fileSha256`, SHA),
      contentDigest: str(t["contentDigest"], `tables[${i}].contentDigest`, SHA),
      columns: strs(t["columns"], `tables[${i}].columns`, NAME),
      deferredColumns: strs(t["deferredColumns"], `tables[${i}].deferredColumns`, NAME),
    };
  });
  if (!Array.isArray(m["excludedTables"]) || !Array.isArray(m["rewrittenColumns"])) fail("rules: not arrays");
  const excludedTables = (m["excludedTables"] as unknown[]).map((v, i) => {
    const e = obj(v, `excludedTables[${i}]`);
    exactKeys(e, ["name", "rule", "reason"], `excludedTables[${i}]`);
    return {
      name: str(e["name"], `excludedTables[${i}].name`, NAME),
      rule: str(e["rule"], `excludedTables[${i}].rule`) as TransferTableRuleKind,
      reason: str(e["reason"], `excludedTables[${i}].reason`),
    };
  });
  const rewrittenColumns = (m["rewrittenColumns"] as unknown[]).map((v, i) => {
    const c = obj(v, `rewrittenColumns[${i}]`);
    exactKeys(c, ["table", "column", "rule"], `rewrittenColumns[${i}]`);
    return {
      table: str(c["table"], `rewrittenColumns[${i}].table`, NAME),
      column: str(c["column"], `rewrittenColumns[${i}].column`, NAME),
      rule: str(c["rule"], `rewrittenColumns[${i}].rule`) as TransferColumnRuleKind,
    };
  });
  const am = obj(m["attachmentManifest"], "attachmentManifest");
  exactKeys(am, ["file", "sha256", "count", "bytes"], "attachmentManifest");
  if (am["file"] !== ATTACHMENT_MANIFEST_FILE) fail("attachmentManifest.file: invalid");
  const totals = obj(m["totals"], "totals");
  exactKeys(totals, ["tables", "rows"], "totals");
  const manifest: MigrationManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportId: str(m["exportId"], "exportId", UUID),
    sourceEnvironment,
    demoChecksum,
    migrationLevel: str(m["migrationLevel"], "migrationLevel", LEVEL),
    createdAt: str(m["createdAt"], "createdAt"),
    appVersion: str(m["appVersion"], "appVersion"),
    tables,
    excludedTables,
    rewrittenColumns,
    attachmentManifest: {
      file: ATTACHMENT_MANIFEST_FILE,
      sha256: str(am["sha256"], "attachmentManifest.sha256", SHA),
      count: int(am["count"], "attachmentManifest.count", 0),
      bytes: str(am["bytes"], "attachmentManifest.bytes", COUNT),
    },
    totals: { tables: int(totals["tables"], "totals.tables", 0), rows: str(totals["rows"], "totals.rows", COUNT) },
  };
  if (canonicalManifest(manifest) !== text) fail("manifest.json: not in canonical form");
  return manifest;
}

/** Reads an attachment manifest (strict; canonical bytes). */
export function parseAttachmentManifest(text: string): AttachmentManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("attachments.json: not JSON");
  }
  const a = obj(raw, "attachments");
  if (a["schemaVersion"] !== ATTACHMENT_MANIFEST_SCHEMA_VERSION)
    fail(`unsupported attachment manifest schema version '${String(a["schemaVersion"])}'`);
  exactKeys(a, ["schemaVersion", "exportId", "items"], "attachments");
  if (!Array.isArray(a["items"])) fail("items: not an array");
  const items = (a["items"] as unknown[]).map((v, i): AttachmentEntry => {
    const e = obj(v, `items[${i}]`);
    exactKeys(e, ["objectName", "sizeBytes", "sha256", "parentTable", "parentId", "file"], `items[${i}]`);
    const sha256 = str(e["sha256"], `items[${i}].sha256`, SHA);
    const file = str(e["file"], `items[${i}].file`, /^attachments\/[0-9a-f]{64}$/);
    if (file !== `attachments/${sha256}`) fail(`items[${i}].file: does not name its SHA-256`);
    return {
      objectName: str(e["objectName"], `items[${i}].objectName`),
      sizeBytes: str(e["sizeBytes"], `items[${i}].sizeBytes`, COUNT),
      sha256,
      parentTable: str(e["parentTable"], `items[${i}].parentTable`, NAME),
      parentId: str(e["parentId"], `items[${i}].parentId`, UUID),
      file,
    };
  });
  const manifest: AttachmentManifest = {
    schemaVersion: ATTACHMENT_MANIFEST_SCHEMA_VERSION,
    exportId: str(a["exportId"], "exportId", UUID),
    items,
  };
  if (canonicalAttachmentManifest(manifest) !== text) fail("attachments.json: not in canonical form");
  return manifest;
}

// ------------------------------------------------------------------------------------------------ source facts

/** The environment-marker value of a source (D-244 O2). */
export async function readSourceEnvironment(db: DbOrTx): Promise<SourceEnvironment> {
  const env = await readDeploymentEnvironment(db);
  if (!env.marked) return "unmarked";
  return env.kind === "demo" ? "demo" : "production";
}

/** `demoChecksum`: the ADR-0050 checksum for a demo source, null otherwise (computed in the caller's snapshot). */
export async function demoChecksumFor(db: DbOrTx, environment: SourceEnvironment): Promise<string | null> {
  return environment === "demo" ? datasetChecksum(db) : null;
}

/** The release version that writes a package: the version of @mth/db (its package.json), `unknown` if unreadable. */
export function packageAppVersion(): string {
  try {
    // Two levels above both src/transfer/ and dist/transfer/.
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" && pkg.version !== "" ? pkg.version.slice(0, 64) : "unknown";
  } catch {
    return "unknown";
  }
}
