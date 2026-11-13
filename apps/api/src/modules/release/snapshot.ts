// The build-time register snapshot as the `release` module reads it (ADR-0071 §2, §3 "Loading", G4, G7;
// p7-work-split §I.1; T-DG7-BE-H). The build writes `dist/release/register-snapshot.json` from
// docs/delivery/requirements.csv (apps/api/scripts/register-snapshot.mjs); at run time this is the ONLY file the module
// opens: no file under docs/, no database table and no network (G7, T-I9).
//  - Resolution: relative to the compiled module (`dist/modules/release/snapshot.js` -> `dist/release/...`). In source
//    mode (`src/modules/release/snapshot.ts`) that path does not exist, and the fallback is the package's
//    `dist/release/register-snapshot.json` (the snapshot of the last build).
//  - Lazy, cached on success only: a missing or invalid file is retried on the next request, so a fixed file is picked
//    up without a restart (G4, T-I6). A failure logs one `warn` line per process (§I.3).
//  - Validation: strict UTF-8 JSON, `schemaVersion` `mth-register-snapshot/1`, the 19 columns in order, `rowCount`
//    equal to `rows.length`, every row of 19 strings with a valid id, class, status and final gate, unique ids, and
//    `externalDependencies` an array of ExternalDependency or null. The parsed rows are frozen.
// A register status is an engineering delivery state, never a DG0-DG7 gate decision or a G1-G6 business approval.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const SNAPSHOT_SCHEMA_VERSION = "mth-register-snapshot/1";
export const REGISTER_SOURCE_PATH = "docs/delivery/requirements.csv";
export const REGISTER_COLUMNS = [
  "req_id",
  "class",
  "title",
  "source_ref",
  "source_heading",
  "template_id",
  "input_fields",
  "procedure",
  "output",
  "owner_roles",
  "permissions",
  "automation",
  "screen_api",
  "acceptance",
  "increments",
  "final_gate",
  "status",
  "evidence",
  "notes",
] as const;
export const REQUIREMENT_STATUSES = ["PLANNED", "SPECIFIED", "IMPLEMENTED", "BLOCKED"] as const;
export const REQUIREMENT_CLASSES = ["SOURCE", "USER", "ENGINEERING"] as const;
export const REQ_ID_PATTERN = /^REQ-([A-Z0-9]+)-[0-9]{3}$/;
export const AREA_PATTERN = /^(PB|DLV|S(0[1-9]|1[0-9]|2[01]))$/;
export const FINAL_GATE_PATTERN = /^DG[0-7]$/;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export type RequirementClass = (typeof REQUIREMENT_CLASSES)[number];

/** One register row: the 19 columns verbatim, plus the derived area. */
export interface RegisterRow {
  readonly reqId: string;
  readonly class: RequirementClass;
  readonly area: string;
  readonly title: string;
  readonly sourceRef: string;
  readonly sourceHeading: string;
  readonly templateId: string;
  readonly inputFields: string;
  readonly procedure: string;
  readonly output: string;
  readonly ownerRoles: string;
  readonly permissions: string;
  readonly automation: string;
  readonly screenApi: string;
  readonly acceptance: string;
  readonly increments: string;
  readonly finalGate: string;
  readonly status: RequirementStatus;
  readonly evidence: string;
  readonly notes: string;
}

export interface ExternalDependency {
  readonly key: string;
  readonly title: string;
  readonly owner: string;
  readonly status: "not_configured" | "not_verified" | "blocked";
}

/** RegisterSnapshotInfo of the contract. */
export interface SnapshotInfo {
  readonly schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  readonly sourcePath: typeof REGISTER_SOURCE_PATH;
  readonly sourceSha256: string;
  readonly rowCount: number;
  readonly generatedAt: string;
}

export interface Snapshot {
  readonly info: SnapshotInfo;
  /** Ordered by reqId ascending (code-point order), frozen. */
  readonly rows: readonly RegisterRow[];
  readonly byId: ReadonlyMap<string, RegisterRow>;
  readonly externalDependencies: readonly ExternalDependency[] | null;
}

export interface RegisterSnapshotSource {
  /** Resolves the snapshot, or rejects with SnapshotUnavailable. `log` receives the §I.3 warn line (once per source). */
  load(log?: SnapshotWarnLog): Promise<Snapshot>;
}

/** The snapshot is missing or invalid (G4): 503 for the register, null fields for About. */
export class SnapshotUnavailable extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = "SnapshotUnavailable";
  }
}

const cell = z.string();
const snapshotFile = z.strictObject({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  sourcePath: z.literal(REGISTER_SOURCE_PATH),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  rowCount: z.number().int().min(0),
  generatedAt: z.iso.datetime({ offset: true }),
  columns: z.array(z.string()),
  rows: z.array(z.array(cell)),
  externalDependencies: z
    .array(
      z.strictObject({
        key: z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
        title: z.string().max(500),
        owner: z.string().max(200),
        status: z.enum(["not_configured", "not_verified", "blocked"]),
      }),
    )
    .nullable(),
});

const codePointOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Validates a decoded snapshot document (G4) and builds the frozen, reqId-ordered view. Throws SnapshotUnavailable. */
export function snapshotFromJson(value: unknown): Snapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new SnapshotUnavailable("not a JSON object");
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (version !== SNAPSHOT_SCHEMA_VERSION) throw new SnapshotUnavailable("wrong schemaVersion");
  const parsed = snapshotFile.safeParse(value);
  if (!parsed.success) throw new SnapshotUnavailable("invalid snapshot document");
  const doc = parsed.data;
  if (JSON.stringify(doc.columns) !== JSON.stringify(REGISTER_COLUMNS))
    throw new SnapshotUnavailable("columns differ from the 19 register columns");
  if (doc.rowCount !== doc.rows.length) throw new SnapshotUnavailable("rowCount differs from the rows");
  const byId = new Map<string, RegisterRow>();
  for (const r of doc.rows) {
    if (r.length !== REGISTER_COLUMNS.length) throw new SnapshotUnavailable("a row does not have 19 fields");
    const [reqId, cls, title, sourceRef, sourceHeading, templateId, inputFields, procedure, output] = r as string[];
    const area = REQ_ID_PATTERN.exec(reqId!)?.[1];
    if (area === undefined || !AREA_PATTERN.test(area)) throw new SnapshotUnavailable("a row has an invalid req_id");
    if (byId.has(reqId!)) throw new SnapshotUnavailable("a req_id is duplicated");
    if (!(REQUIREMENT_CLASSES as readonly string[]).includes(cls!))
      throw new SnapshotUnavailable("a row has an invalid class");
    if (!(REQUIREMENT_STATUSES as readonly string[]).includes(r[16]!))
      throw new SnapshotUnavailable("a row has an invalid status");
    if (!FINAL_GATE_PATTERN.test(r[15]!)) throw new SnapshotUnavailable("a row has an invalid final_gate");
    byId.set(
      reqId!,
      Object.freeze({
        reqId: reqId!,
        class: cls as RequirementClass,
        area,
        title: title!,
        sourceRef: sourceRef!,
        sourceHeading: sourceHeading!,
        templateId: templateId!,
        inputFields: inputFields!,
        procedure: procedure!,
        output: output!,
        ownerRoles: r[9]!,
        permissions: r[10]!,
        automation: r[11]!,
        screenApi: r[12]!,
        acceptance: r[13]!,
        increments: r[14]!,
        finalGate: r[15]!,
        status: r[16] as RequirementStatus,
        evidence: r[17]!,
        notes: r[18]!,
      }),
    );
  }
  const rows = Object.freeze([...byId.values()].sort((a, b) => codePointOrder(a.reqId, b.reqId)));
  return Object.freeze({
    info: Object.freeze({
      schemaVersion: doc.schemaVersion,
      sourcePath: doc.sourcePath,
      sourceSha256: doc.sourceSha256,
      rowCount: doc.rowCount,
      generatedAt: doc.generatedAt,
    }),
    rows,
    byId,
    externalDependencies:
      doc.externalDependencies === null
        ? null
        : Object.freeze(doc.externalDependencies.map((d) => Object.freeze({ ...d }))),
  });
}

/** Parses the snapshot file's bytes: strict UTF-8 (no BOM), JSON, then snapshotFromJson. */
export function snapshotFromBytes(bytes: Uint8Array): Snapshot {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SnapshotUnavailable("not valid UTF-8");
  }
  if (text.charCodeAt(0) === 0xfeff) throw new SnapshotUnavailable("byte order mark not allowed");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SnapshotUnavailable("not valid JSON");
  }
  return snapshotFromJson(value);
}

/**
 * The snapshot path of this build: next to the compiled module tree (`dist/release/register-snapshot.json`), or, in
 * source mode, the package's last build output (`apps/api/dist/release/register-snapshot.json`).
 */
export function defaultSnapshotPath(moduleUrl: string = import.meta.url): string {
  const compiled = fileURLToPath(new URL("../../release/register-snapshot.json", moduleUrl));
  if (existsSync(compiled) || !/[\\/]src[\\/]modules[\\/]release[\\/]snapshot\.ts$/.test(fileURLToPath(moduleUrl)))
    return compiled;
  return fileURLToPath(new URL("../../../dist/release/register-snapshot.json", moduleUrl));
}

export interface SnapshotWarnLog {
  warn(line: string): void;
}

/** The §I.3 warn line (one per process). */
export const snapshotUnavailableLine = (reason: string): string =>
  `release: the register snapshot is unavailable (${reason}); the register and About show it as unavailable`;

/**
 * A file-backed source: reads `path` lazily, caches the snapshot after the first successful load only, and logs the
 * §I.3 warn line at most once for the life of the source (the default source is one per process), through the logger
 * the caller passes (the routes pass the request logger) or `fallbackLog`.
 */
export function fileRegisterSnapshotSource(path: string, fallbackLog?: SnapshotWarnLog): RegisterSnapshotSource {
  let cached: Snapshot | null = null;
  let warned = false;
  return {
    async load(log?: SnapshotWarnLog) {
      if (cached !== null) return cached;
      try {
        let bytes: Uint8Array;
        try {
          bytes = await readFile(path);
        } catch (error) {
          throw new SnapshotUnavailable(
            (error as NodeJS.ErrnoException).code === "ENOENT" ? "file not found" : "file not readable",
          );
        }
        cached = snapshotFromBytes(bytes);
        return cached;
      } catch (error) {
        if (!(error instanceof SnapshotUnavailable)) throw error;
        const out = log ?? fallbackLog;
        if (!warned && out !== undefined) {
          warned = true;
          out.warn(snapshotUnavailableLine(error.reason));
        }
        throw error;
      }
    },
  };
}

let processDefault: RegisterSnapshotSource | null = null;

/** The process-wide default source (the build's snapshot path); one per process, so the warn line is once per process. */
export function defaultRegisterSnapshotSource(): RegisterSnapshotSource {
  processDefault ??= fileRegisterSnapshotSource(defaultSnapshotPath());
  return processDefault;
}
