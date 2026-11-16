// Administration > Configuration transfer: the service of the nine configuration-bundle operations (P7 slice D;
// ADR-0065 §2-§9; REQ-S19-008; p7-work-split §D.1, §D.2; T-DG7-BE-F).
//
// Authorization: `config_bundle.export` / `config_bundle.import` (configure; ADM_TECH, ADM_METHOD; 0135) at the
// organization the request names. Every other role, AUD included, gets 403. Every mutation re-checks the right on
// grants reloaded inside its own transaction (commit-time authorization). The commit additionally needs each written
// kind's OWN configure right: the plan marks an item the caller cannot write `refused` (config_bundle.kind_not_permitted)
// and the adapter re-checks the right at write time, so config_bundle.import alone never widens a right (ADR-0065 §8).
//
// Export (createConfigBundleExport): each registered kind's adapter returns its latest PUBLISHED items; a uuid anywhere
// in a content is an unportable reference (422, never dropped); the bundle (canonical JSON) is written to the evidence
// store at transfer/config-bundles/<exportId>.json BEFORE the transaction (no remote I/O inside it), then the row and
// config_bundle_export.created are written in one transaction (the object is removed if that fails).
//
// Import: upload (version first, then size, envelope, checksums, item schemas; nothing in the configuration changes) ->
// validate (If-Match, the configBundleImport lock on the organization, one config_bundle_import_item per item per run) -> commit
// (If-Match, the configBundleImport lock, re-plan; any difference is config_bundle.plan_changed and nothing is written; else every
// create_draft/new_draft item is written through its adapter in ONE transaction). A commit never publishes: a drafting
// kind ends as a draft that goes through the existing review and publish pipeline, and a job schedule ends disabled.
// Nothing here is a business, Finance or IT approval (G1-G6), and nothing reads or writes DG0-DG7.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  confinedPath,
  packageAppVersion,
  readSourceEnvironment,
  sql,
  transferSha256,
  type ConfigBundleExportTable,
  type ConfigBundleImportItemTable,
  type ConfigBundleImportTable,
  type Db,
  type DbOrTx,
  type Tx,
} from "@mth/db";
import { PROBLEM_TYPES, type FieldError, type Permission } from "@mth/shared";
import { reason as reasonRule } from "@mth/shared/schemas";
import {
  BUNDLE_MAX_BYTES,
  BUNDLE_SCHEMA_VERSION,
  byCodePoint,
  canonicalBundleJson,
  CONFIG_BUNDLE_CONTENT_SCHEMAS,
  CONFIG_BUNDLE_KINDS,
  CONFIG_BUNDLE_PROBLEM_TEXTS,
  configBundleEnvelope,
  configBundleKind,
  contentSha256,
  firstUuidPointer,
  SOURCE_ENVIRONMENTS,
  UNPORTABLE_BUNDLE_KINDS,
  type ConfigBundleEnvelope,
  type ConfigBundleKind,
} from "@mth/shared/transfer";
import type { FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  organizationsWith,
  refreshPrincipal,
  requireAction,
  resolveTarget,
  type Principal,
} from "../../access/index.ts";
import { record } from "../../audit/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem, iso, isoOrNull, problems } from "../../platform/index.ts";
import { countPlan, planBundle, samePlan, type PlanRow } from "./plan.ts";
import type { BundleItemInput, ConfigBundleAdapterRegistry } from "./registry.ts";

export const CONFIG_BUNDLE_EXPORT: Permission = "config_bundle.export";
export const CONFIG_BUNDLE_IMPORT: Permission = "config_bundle.import";
export const CONFIG_BUNDLE_EXPORT_PREFIX = "transfer/config-bundles";
export const CONFIG_BUNDLE_IMPORT_PREFIX = "transfer/config-bundle-imports";
export const configBundleExportKey = (id: string) => `${CONFIG_BUNDLE_EXPORT_PREFIX}/${id}.json`;
export const configBundleImportKey = (id: string) => `${CONFIG_BUNDLE_IMPORT_PREFIX}/${id}.json`;
const sha256Text = (text: string) => transferSha256(text);

// ------------------------------------------------------------------------------------------------ refusals (D.2)
const T = CONFIG_BUNDLE_PROBLEM_TEXTS;
const CONTENT_SCHEMAS = new Map(Object.entries(CONFIG_BUNDLE_CONTENT_SCHEMAS));
const TEXTS = new Map<string, string>(Object.entries(CONFIG_BUNDLE_PROBLEM_TEXTS));
const rule = (code: keyof typeof T, errors?: readonly FieldError[]) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail: TEXTS.get(code) ?? code,
    ...(errors ? { errors } : {}),
  });

export const configBundleRefusals = {
  schemaVersionUnsupported: (version: string) =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "config_bundle.schema_version_unsupported",
      title: "Business rule violated",
      detail: T["config_bundle.schema_version_unsupported"].replace("{version}", version),
      errors: [
        {
          pointer: "/bundleSchemaVersion",
          code: "config_bundle.schema_version_unsupported",
          message: T["config_bundle.schema_version_unsupported"].replace("{version}", version),
        },
      ],
      params: { version },
    }),
  tooLarge: () =>
    new HttpProblem({
      status: 413,
      type: PROBLEM_TYPES.validation,
      code: "config_bundle.too_large",
      title: "Content too large",
      detail: T["config_bundle.too_large"],
    }),
  checksumMismatch: (pointer?: string) =>
    rule(
      "config_bundle.checksum_mismatch",
      pointer === undefined
        ? undefined
        : [{ pointer, code: "config_bundle.checksum_mismatch", message: T["config_bundle.checksum_mismatch"] }],
    ),
  itemInvalid: (pointer: string) =>
    rule("config_bundle.item_invalid", [
      { pointer, code: "config_bundle.item_invalid", message: T["config_bundle.item_invalid"] },
    ]),
  nothingPublished: () => rule("config_bundle.nothing_published"),
  unportableReference: (kind: string, itemCode: string, field: string) =>
    rule("config_bundle.unportable_reference", [
      {
        pointer: `/${kind}/${itemCode}${field}`,
        code: "config_bundle.unportable_reference",
        message: `${T["config_bundle.unportable_reference"]} (${kind} ${itemCode} ${field || "/"})`,
      },
    ]),
  /** A kind this release never exports (UNPORTABLE_BUNDLE_KINDS; ADR-0065 §2, Residual 1): `index` into `kinds`. */
  unportableKind: (kind: ConfigBundleKind, index: number) =>
    rule("config_bundle.unportable_reference", [
      {
        pointer: `/kinds/${index}`,
        code: "config_bundle.unportable_reference",
        message: `${T["config_bundle.unportable_reference"]} (${kind} ${UNPORTABLE_BUNDLE_KINDS.get(kind) ?? "/"})`,
      },
    ]),
  kindUnavailable: (kind: string) =>
    rule("config_bundle.kind_unavailable", [
      {
        pointer: "/kinds",
        code: "config_bundle.kind_unavailable",
        message: `${T["config_bundle.kind_unavailable"]} (${kind})`,
      },
    ]),
  notValidatable: () => rule("config_bundle.not_validatable"),
  notCommittable: () => rule("config_bundle.not_committable"),
  planChanged: () => rule("config_bundle.plan_changed"),
} as const;

// ------------------------------------------------------------------------------------------------ the object store

/** Where bundle bytes live: the evidence store's filesystem layout (`<root>/<key>`), like the migration package. */
export interface BundleStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
}

export function filesystemBundleStore(root: () => string): BundleStore {
  return {
    async put(key, bytes) {
      const path = confinedPath(root(), key);
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${uuidv7()}.tmp`;
      await writeFile(tmp, bytes, { flag: "wx" });
      await rename(tmp, path);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(confinedPath(root(), key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async remove(key) {
      await rm(confinedPath(root(), key), { force: true });
    },
  };
}

// ------------------------------------------------------------------------------------------------ contract mirror
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const integerText = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);

export const configBundleExportView = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  bundleSchemaVersion: z.literal(BUNDLE_SCHEMA_VERSION),
  sourceEnvironment: z.enum(SOURCE_ENVIRONMENTS),
  kinds: z.array(configBundleKind),
  itemCount: z.number().int().min(0),
  byteSize: integerText,
  sha256: sha,
  createdAt: timestamp,
  createdBy: z.uuid(),
});
export type ConfigBundleExportView = z.infer<typeof configBundleExportView>;
export const configBundleExportPage = z.strictObject({
  items: z.array(configBundleExportView),
  nextCursor: z.string().nullable(),
});

const TARGET_TYPES = [
  "methodology_version",
  "automation_rule_version",
  "branding_version",
  "notification_policy",
  "job_schedule",
  "config_review_policy",
  "upload_policy",
] as const;

export const configBundleImportItemView = z.strictObject({
  id: z.uuid(),
  ordinal: z.number().int().min(1),
  kind: configBundleKind,
  itemCode: z.string(),
  sourceVersionNo: z.number().int().min(1).nullable(),
  contentSha256: sha,
  action: z.enum(["create_draft", "new_draft", "identical", "conflict", "refused"]),
  problemCode: z
    .string()
    .regex(/^config_bundle\.[a-z_]+$/)
    .nullable(),
  targetRecordType: z.enum(TARGET_TYPES).nullable(),
  targetRecordId: z.uuid().nullable(),
});

export const configBundleImportView = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  bundleSchemaVersion: z.literal(BUNDLE_SCHEMA_VERSION),
  sourceEnvironment: z.enum(SOURCE_ENVIRONMENTS),
  fileName: z.string(),
  byteSize: integerText,
  sha256: sha,
  itemCount: z.number().int().min(0),
  status: z.enum(["uploaded", "validated", "invalid", "committed"]),
  validationNo: z.number().int().min(0),
  counts: z
    .strictObject({
      createDraft: z.number().int().min(0),
      newDraft: z.number().int().min(0),
      identical: z.number().int().min(0),
      conflict: z.number().int().min(0),
      refused: z.number().int().min(0),
    })
    .nullable(),
  items: z.array(configBundleImportItemView),
  validatedAt: timestamp.nullable(),
  validatedBy: z.uuid().nullable(),
  committedAt: timestamp.nullable(),
  committedBy: z.uuid().nullable(),
  createdAt: timestamp,
  createdBy: z.uuid(),
  version: z.number().int().min(1),
});
export type ConfigBundleImportView = z.infer<typeof configBundleImportView>;
export const configBundleImportPage = z.strictObject({
  items: z.array(configBundleImportView),
  nextCursor: z.string().nullable(),
});

export const configBundleExportCreate = z.strictObject({
  kinds: z
    .array(configBundleKind)
    .min(1)
    .max(12)
    .refine((k) => new Set(k).size === k.length, "kinds must be unique")
    .optional(),
  reason: reasonRule,
});

type ExportRow = Selectable<ConfigBundleExportTable>;
type ImportRow = Selectable<ConfigBundleImportTable>;
type ImportItemRow = Selectable<ConfigBundleImportItemTable>;

/** 0134 `kinds` (text[]): node-postgres returns an array; the literal form `{a,b}` is accepted defensively. */
function kindsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  const text = String(raw);
  return text === "{}" ? [] : text.replace(/^\{|\}$/g, "").split(",");
}

export function presentExport(r: ExportRow): ConfigBundleExportView {
  return configBundleExportView.parse({
    id: r.id,
    organizationId: r.organization_id,
    bundleSchemaVersion: r.bundle_schema_version,
    sourceEnvironment: r.source_environment,
    kinds: kindsOf(r.kinds as unknown),
    itemCount: r.item_count,
    byteSize: String(r.byte_size),
    sha256: r.sha256,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
  });
}

/** The import with the items of its latest validation run and, after the commit, the record each item wrote. */
export async function presentImport(db: DbOrTx, r: ImportRow): Promise<ConfigBundleImportView> {
  const items =
    r.validation_no === 0
      ? []
      : await db
          .selectFrom("config_bundle_import_item as i")
          .leftJoin("config_bundle_import_commit as c", "c.config_bundle_import_item_id", "i.id")
          .select([
            "i.id",
            "i.ordinal",
            "i.kind",
            "i.item_code",
            "i.source_version_no",
            "i.content_sha256",
            "i.action",
            "i.problem_code",
            "c.target_record_type",
            "c.target_record_id",
          ])
          .where("i.config_bundle_import_id", "=", r.id)
          .where("i.validation_no", "=", r.validation_no)
          .orderBy("i.ordinal")
          .execute();
  return configBundleImportView.parse({
    id: r.id,
    organizationId: r.organization_id,
    bundleSchemaVersion: r.bundle_schema_version,
    sourceEnvironment: r.source_environment,
    fileName: r.file_name,
    byteSize: String(r.byte_size),
    sha256: r.sha256,
    itemCount: r.item_count,
    status: r.status,
    validationNo: r.validation_no,
    counts:
      r.items_create === null
        ? null
        : {
            createDraft: r.items_create,
            newDraft: r.items_new_draft,
            identical: r.items_identical,
            conflict: r.items_conflict,
            refused: r.items_refused,
          },
    items: items.map((i) => ({
      id: i.id,
      ordinal: i.ordinal,
      kind: i.kind,
      itemCode: i.item_code,
      sourceVersionNo: i.source_version_no,
      contentSha256: i.content_sha256,
      action: i.action,
      problemCode: i.problem_code,
      targetRecordType: i.target_record_type ?? null,
      targetRecordId: i.target_record_id ?? null,
    })),
    validatedAt: isoOrNull(r.validated_at),
    validatedBy: r.validated_by,
    committedAt: isoOrNull(r.committed_at),
    committedBy: r.committed_by,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    version: r.version,
  });
}

// ------------------------------------------------------------------------------------------------ authorization

/** 403 unless the principal holds `permission` in some organization (AUD and every other role: 403 everywhere). */
export function requireSomeRight(principal: Principal, permission: Permission): void {
  if (organizationsWith(principal, permission).length === 0) throw problems.forbidden();
}

/** `permission` at the organization (404 when it does not exist, 403 without the right). */
export async function requireRightAt(
  db: DbOrTx,
  principal: Principal,
  permission: Permission,
  organizationId: string,
): Promise<void> {
  const target = await resolveTarget(db, { type: "organization", id: organizationId });
  if (target === null) {
    principal.tracker.decisions += 1;
    throw problems.notFound();
  }
  await requireAction(db, principal, permission, target);
}

/** The commit-time re-check: the caller's grants reloaded inside `tx`. */
async function freshRightAt(
  tx: Tx,
  request: FastifyRequest,
  permission: Permission,
  organizationId: string,
): Promise<{ principal: Principal; userId: string }> {
  const principal = await refreshPrincipal(tx, request);
  try {
    await requireRightAt(tx, principal, permission, organizationId);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  if (principal.userId === null) throw problems.forbidden();
  return { principal, userId: principal.userId };
}

// ------------------------------------------------------------------------------------------------ reads

export async function findExport(db: DbOrTx, id: string): Promise<ExportRow | undefined> {
  return db.selectFrom("config_bundle_export").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function findImport(db: DbOrTx, id: string, forUpdate = false): Promise<ImportRow | undefined> {
  let q = db.selectFrom("config_bundle_import").selectAll().where("id", "=", id);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

// ------------------------------------------------------------------------------------------------ export

/** The bundle of an organization's published configuration of `kinds` (ADR-0065 §2-§3). Pure read. */
export async function assembleBundle(
  db: DbOrTx,
  registry: ConfigBundleAdapterRegistry,
  organizationId: string,
  kinds: readonly ConfigBundleKind[],
  exportId: string,
): Promise<{ bundle: ConfigBundleEnvelope; bytes: Uint8Array }> {
  const wanted = new Set(kinds);
  const items: ConfigBundleEnvelope["items"] = [];
  for (const kind of CONFIG_BUNDLE_KINDS) {
    if (!wanted.has(kind)) continue;
    const adapter = registry.get(kind);
    if (adapter === undefined) continue;
    const exported = [...(await adapter.exportPublished(db, organizationId))].sort((a, b) =>
      byCodePoint(a.itemCode, b.itemCode),
    );
    for (const e of exported) {
      // No source ids in a bundle: a uuid is a reference without a stable key (ADR-0065 §2), refused, never dropped.
      const unportable = firstUuidPointer(e.content);
      if (unportable !== null) throw configBundleRefusals.unportableReference(kind, e.itemCode, unportable);
      items.push({
        kind,
        itemCode: e.itemCode,
        sourceVersionNo: e.sourceVersionNo,
        contentSha256: contentSha256(e.content, sha256Text),
        content: e.content,
      });
    }
  }
  if (items.length === 0) throw configBundleRefusals.nothingPublished();
  const bundle: ConfigBundleEnvelope = {
    bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
    exportId,
    sourceEnvironment: await readSourceEnvironment(db),
    createdAt: new Date().toISOString(),
    appVersion: packageAppVersion().slice(0, 64),
    items,
  };
  return { bundle, bytes: new TextEncoder().encode(canonicalBundleJson(bundle)) };
}

export async function createExport(
  db: Db,
  registry: ConfigBundleAdapterRegistry,
  store: BundleStore,
  request: FastifyRequest,
  organizationId: string,
  body: z.infer<typeof configBundleExportCreate>,
): Promise<ExportRow> {
  // Default: every kind available in this installation. A kind asked for by name is never silently left out of the
  // bundle: a kind this release never exports (UNPORTABLE_BUNDLE_KINDS, ADR-0065 §2 and Residual 1) is 422
  // config_bundle.unportable_reference, and one that has no adapter here is 422 config_bundle.kind_unavailable.
  const named = body.kinds ?? [];
  for (const [index, kind] of named.entries())
    if (UNPORTABLE_BUNDLE_KINDS.has(kind)) throw configBundleRefusals.unportableKind(kind, index);
  const available = new Set(registry.kinds().filter((k) => !UNPORTABLE_BUNDLE_KINDS.has(k)));
  const missing = named.find((k) => !available.has(k));
  if (missing !== undefined) throw configBundleRefusals.kindUnavailable(missing);
  const kinds = CONFIG_BUNDLE_KINDS.filter(
    (k) => available.has(k) && (body.kinds === undefined || body.kinds.includes(k)),
  );
  const id = uuidv7();
  const { bundle, bytes } = await assembleBundle(db, registry, organizationId, kinds, id);
  const key = configBundleExportKey(id);
  await store.put(key, bytes);
  try {
    return await db.transaction().execute(async (tx) => {
      const { userId } = await freshRightAt(tx, request, CONFIG_BUNDLE_EXPORT, organizationId);
      const row = await tx
        .insertInto("config_bundle_export")
        .values({
          id,
          organization_id: organizationId,
          bundle_schema_version: BUNDLE_SCHEMA_VERSION,
          source_environment: bundle.sourceEnvironment,
          // text[] (0134); the generated column type says string, so the array is bound explicitly.
          kinds: sql<string>`${sql.val([...kinds])}::text[]`,
          item_count: bundle.items.length,
          byte_size: String(bytes.byteLength),
          sha256: transferSha256(bytes),
          created_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "config_bundle_export.created",
        recordType: "config_bundle_export",
        recordId: id,
        organizationId,
        newVersion: 1,
        reason: body.reason,
        changes: {
          kinds: { from: null, to: [...kinds] },
          item_count: { from: null, to: bundle.items.length },
          sha256: { from: null, to: row.sha256 },
        },
      });
      return row;
    });
  } catch (err) {
    await store.remove(key);
    throw err;
  }
}

/** The stored bytes of an export, re-hashed on read: a mismatch is 422, never a silent download (ADR-0065 §3). */
export async function readExportBytes(store: BundleStore, row: ExportRow): Promise<Uint8Array> {
  const bytes = await store.get(configBundleExportKey(row.id));
  if (bytes === null || transferSha256(bytes) !== row.sha256) throw configBundleRefusals.checksumMismatch();
  return bytes;
}

// ------------------------------------------------------------------------------------------------ upload

/**
 * The checks of an uploaded bundle, in the ADR-0065 §4 order: the schema version BEFORE anything else of the envelope
 * (422 config_bundle.schema_version_unsupported; nothing is stored), the envelope shape (400), then every item's
 * contentSha256 (422 checksum_mismatch) and its content against its kind's schema (422 item_invalid, with a pointer).
 * The declared size was refused before the body was read (413, routes.ts). The stored object is the canonical JSON of
 * the checked bundle (keys by code point, no whitespace): byte for byte the file an export writes, so an unchanged
 * exported bundle keeps its SHA-256; the size limit applies to it too.
 *
 * T-DG7-BE-F2 (route-inventory case 4; ADR-0051 §5 and REQ-S16-027 "invalid input returns the uniform 400 body"):
 * - a PRESENT bundleSchemaVersion other than mth-config-bundle/1 (any value, "" included) is 422 before anything else,
 *   whatever the rest of the body looks like, because another release's bundle may have another shape;
 * - an ABSENT bundleSchemaVersion names no version, so it cannot be another release's format: a body that is
 *   otherwise a valid mth-config-bundle/1 envelope is 422 schema_version_unsupported (T-D1 "missing"), and a body that
 *   is not one (not an object, or a required field missing or malformed) is plain invalid input, the uniform 400.
 */
export function checkBundle(
  registry: ConfigBundleAdapterRegistry,
  body: unknown,
  parseEnvelope: (body: unknown) => ConfigBundleEnvelope,
): { bundle: ConfigBundleEnvelope; bytes: Uint8Array } {
  const record =
    body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (record !== null && Object.hasOwn(record, "bundleSchemaVersion")) {
    const version = record["bundleSchemaVersion"];
    if (version !== BUNDLE_SCHEMA_VERSION)
      throw configBundleRefusals.schemaVersionUnsupported(typeof version === "string" ? version.slice(0, 64) : "");
  } else {
    // No version: the uniform 400 when the body is not otherwise a v1 envelope; else 422 (the version is missing).
    parseEnvelope(record === null ? body : { ...record, bundleSchemaVersion: BUNDLE_SCHEMA_VERSION });
    throw configBundleRefusals.schemaVersionUnsupported("");
  }
  const bundle = parseEnvelope(body);
  const seen = new Set<string>();
  for (const [i, item] of bundle.items.entries()) {
    const at = `/items/${i}`;
    let hash: string;
    try {
      hash = contentSha256(item.content, sha256Text);
    } catch {
      throw configBundleRefusals.itemInvalid(`${at}/content`);
    }
    if (hash !== item.contentSha256) throw configBundleRefusals.checksumMismatch(`${at}/contentSha256`);
    const schema = registry.get(item.kind)?.contentSchema ?? CONTENT_SCHEMAS.get(item.kind)!;
    const parsed = schema.safeParse(item.content);
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path ?? [];
      throw configBundleRefusals.itemInvalid(`${at}/content${path.map((p) => `/${String(p)}`).join("")}`);
    }
    const key = `${item.kind}:${item.itemCode}`;
    if (seen.has(key)) throw configBundleRefusals.itemInvalid(`${at}/itemCode`);
    seen.add(key);
  }
  const bytes = new TextEncoder().encode(canonicalBundleJson(bundle));
  if (bytes.byteLength > BUNDLE_MAX_BYTES) throw configBundleRefusals.tooLarge();
  return { bundle, bytes };
}

export async function uploadImport(
  db: Db,
  store: BundleStore,
  request: FastifyRequest,
  organizationId: string,
  fileName: string,
  bytes: Uint8Array,
  bundle: ConfigBundleEnvelope,
): Promise<ImportRow> {
  const id = uuidv7();
  const key = configBundleImportKey(id);
  await store.put(key, bytes);
  try {
    return await db.transaction().execute(async (tx) => {
      const { userId } = await freshRightAt(tx, request, CONFIG_BUNDLE_IMPORT, organizationId);
      const row = await tx
        .insertInto("config_bundle_import")
        .values({
          id,
          organization_id: organizationId,
          bundle_schema_version: BUNDLE_SCHEMA_VERSION,
          source_environment: bundle.sourceEnvironment,
          file_name: fileName,
          byte_size: String(bytes.byteLength),
          sha256: transferSha256(bytes),
          item_count: bundle.items.length,
          created_by: userId,
          updated_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "config_bundle_import.uploaded",
        recordType: "config_bundle_import",
        recordId: id,
        organizationId,
        newVersion: row.version,
        changes: {
          status: { from: null, to: "uploaded" },
          file_name: { from: null, to: fileName },
          item_count: { from: null, to: bundle.items.length },
          sha256: { from: null, to: row.sha256 },
          source_environment: { from: null, to: bundle.sourceEnvironment },
        },
      });
      return row;
    });
  } catch (err) {
    await store.remove(key);
    throw err;
  }
}

// ------------------------------------------------------------------------------------------------ validate / commit

/** The stored items of an import (re-checked against the recorded SHA-256; read OUTSIDE any transaction). */
export async function readImportItems(store: BundleStore, row: ImportRow): Promise<BundleItemInput[]> {
  const bytes = await store.get(configBundleImportKey(row.id));
  if (bytes === null || transferSha256(bytes) !== row.sha256) throw configBundleRefusals.checksumMismatch();
  const bundle = configBundleEnvelope.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  return bundle.items.map((i) => ({
    kind: i.kind,
    itemCode: i.itemCode,
    sourceVersionNo: i.sourceVersionNo,
    contentSha256: i.contentSha256,
    content: i.content,
  }));
}

async function lockOrganization(tx: Tx, organizationId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.configBundleImport}::int, hashtext(${organizationId}::text))`.execute(
    tx,
  );
}

/** Locks the import (the organization's configBundleImport lock first) and checks If-Match. */
async function lockedImport(tx: Tx, id: string, organizationId: string, expected: number): Promise<ImportRow> {
  await lockOrganization(tx, organizationId);
  const row = await findImport(tx, id, true);
  if (row === undefined) throw problems.notFound();
  if (row.version !== expected) throw problems.versionConflict(row.version);
  return row;
}

export async function validateImport(
  tx: Tx,
  registry: ConfigBundleAdapterRegistry,
  request: FastifyRequest,
  probe: ImportRow,
  items: readonly BundleItemInput[],
  expected: number,
): Promise<ImportRow> {
  const { principal, userId } = await freshRightAt(tx, request, CONFIG_BUNDLE_IMPORT, probe.organization_id);
  const current = await lockedImport(tx, probe.id, probe.organization_id, expected);
  if (current.status !== "uploaded" && current.status !== "validated") throw configBundleRefusals.notValidatable();
  const plan = await planBundle(tx, registry, principal, current.organization_id, items);
  const run = current.validation_no + 1;
  for (const p of plan) {
    await tx
      .insertInto("config_bundle_import_item")
      .values({
        id: uuidv7(),
        config_bundle_import_id: current.id,
        validation_no: run,
        ordinal: p.ordinal,
        kind: p.item.kind,
        item_code: p.item.itemCode,
        source_version_no: p.item.sourceVersionNo,
        content_sha256: p.item.contentSha256,
        action: p.action,
        problem_code: p.problemCode,
      })
      .execute();
  }
  const counts = countPlan(plan);
  const status = counts.conflict > 0 || counts.refused > 0 ? "invalid" : "validated";
  const updated = await tx
    .updateTable("config_bundle_import")
    .set({
      status,
      validation_no: run,
      items_create: counts.createDraft,
      items_new_draft: counts.newDraft,
      items_identical: counts.identical,
      items_conflict: counts.conflict,
      items_refused: counts.refused,
      validated_at: sql<Date>`now()`,
      validated_by: userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "config_bundle_import.validated",
    recordType: "config_bundle_import",
    recordId: current.id,
    organizationId: current.organization_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      status: { from: current.status, to: status },
      validation_no: { from: current.validation_no, to: run },
      counts: { from: null, to: counts },
    },
  });
  return updated;
}

export async function commitImport(
  tx: Tx,
  registry: ConfigBundleAdapterRegistry,
  request: FastifyRequest,
  probe: ImportRow,
  items: readonly BundleItemInput[],
  expected: number,
): Promise<ImportRow> {
  const { principal, userId } = await freshRightAt(tx, request, CONFIG_BUNDLE_IMPORT, probe.organization_id);
  const current = await lockedImport(tx, probe.id, probe.organization_id, expected);
  if (current.status !== "validated") throw configBundleRefusals.notCommittable();
  const stored: ImportItemRow[] = await tx
    .selectFrom("config_bundle_import_item")
    .selectAll()
    .where("config_bundle_import_id", "=", current.id)
    .where("validation_no", "=", current.validation_no)
    .orderBy("ordinal")
    .execute();
  const plan: PlanRow[] = await planBundle(tx, registry, principal, current.organization_id, items);
  const storedPlan = stored.map((s) => ({ ordinal: s.ordinal, action: s.action, problemCode: s.problem_code }));
  // Anything planned differently since the latest validation: nothing is written (the transaction rolls back).
  if (!samePlan(plan, storedPlan as never)) throw configBundleRefusals.planChanged();
  const itemIds = new Map(stored.map((s) => [s.ordinal, s.id]));
  for (const p of plan) {
    if (p.action !== "create_draft" && p.action !== "new_draft") continue;
    const adapter = registry.get(p.item.kind);
    if (adapter === undefined) throw configBundleRefusals.planChanged();
    const written = await adapter.write(
      { tx, request, principal, organizationId: current.organization_id, userId, importId: current.id },
      p.item,
      p.action,
    );
    await tx
      .insertInto("config_bundle_import_commit")
      .values({
        config_bundle_import_item_id: itemIds.get(p.ordinal)!,
        target_record_type: written.targetRecordType,
        target_record_id: written.targetRecordId,
      })
      .execute();
  }
  const updated = await tx
    .updateTable("config_bundle_import")
    .set({
      status: "committed",
      committed_at: sql<Date>`now()`,
      committed_by: userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const counts = countPlan(plan);
  await record(tx, auditContextOf(request), {
    action: "config_bundle_import.committed",
    recordType: "config_bundle_import",
    recordId: current.id,
    organizationId: current.organization_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      status: { from: "validated", to: "committed" },
      written: { from: null, to: counts.createDraft + counts.newDraft },
    },
  });
  return updated;
}

/** The kinds as stored (0134 text[]) narrowed to the contract enum. */
export const asKinds = (kinds: readonly string[]): ConfigBundleKind[] => kinds.map((k) => configBundleKind.parse(k));
