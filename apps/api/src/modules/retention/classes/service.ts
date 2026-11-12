// Administration > Retention: the service of the retention-class operations and the module's shared authorization and
// refusals (P7 slice E; ADR-0067 §1, §2, §7; REQ-S16-024; p7-work-split §E.1, §E.5; T-DG7-BE-G).
//
// Authorization: every retention operation needs its slice E code (retention.read, retention.configure, retention.run;
// backup.read) held at ORGANIZATION scope in some organization (installation-wide administration, the storage-settings
// and migration-export rule). A mutation re-checks it on grants reloaded inside its own transaction (commit-time
// authorization, F-DG2-440).
//
// updateRetentionClass, in ONE transaction: the transaction lock of class retentionRun (ADVISORY_LOCK_CLASSES; the registry's one
// class-wide key "retention"), so a class never changes while a run is requested or starts; 404; 409 on a stale
// If-Match; 422 retention.run_in_progress while a run is queued or running; the E.5 422 codes (checked in the order
// retain-only, not-archivable, period, reference; the database refuses the same cases, 0143); the update; the audit
// event retention_class.updated with before/after of action, period and reference, and the reason.
//
// The IT approval reference is TEXT recording an approval Mobily IT gave outside the platform (for example a change
// ticket). Saving it approves nothing: no G1-G6, Finance or IT approval, and nothing here reads or writes DG0-DG7.
import { sql, type DbOrTx, type RetentionClassRow, type RetentionTableClassRow, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import { reason as reasonRule } from "@mth/shared/schemas";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContextOf, authorize, organizationsWith, refreshPrincipal, type Principal } from "../../access/index.ts";
import { record } from "../../audit/index.ts";
import { ADVISORY_LOCK_CLASSES, iso, problems } from "../../platform/index.ts";

/** The registry's one class-wide key of retentionRun (ADR-0016 §6; ADR-0067 §4). */
export const RETENTION_LOCK_KEY = "retention";

/** The transaction lock of class retentionRun (ADVISORY_LOCK_CLASSES), key "retention". */
export const lockRetention = (tx: Tx) =>
  sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.retentionRun}::int, hashtext(${RETENTION_LOCK_KEY}))`.execute(
    tx,
  );

// ------------------------------------------------------------------------------------------------ exact texts (E.5)
export const RETENTION_TEXTS = {
  classRetainOnly: "Records of this class are always kept. Only operational classes can be archived or purged.",
  classNotArchivable: "This class cannot use this action: a table in it has no age date, or cannot be purged.",
  classPeriodRequired: "Enter the retention period agreed with IT before enabling this action.",
  classReferenceRequired:
    "Enter the reference of the IT approval (for example a change ticket) before enabling this action.",
  runInProgress: "A retention run is already queued or running. Wait for it to finish.",
} as const;

export const retentionRefusals = {
  classRetainOnly: () => problems.businessRule("retention.class_retain_only", RETENTION_TEXTS.classRetainOnly),
  classNotArchivable: () => problems.businessRule("retention.class_not_archivable", RETENTION_TEXTS.classNotArchivable),
  classPeriodRequired: () =>
    problems.businessRule("retention.class_period_required", RETENTION_TEXTS.classPeriodRequired),
  classReferenceRequired: () =>
    problems.businessRule("retention.class_reference_required", RETENTION_TEXTS.classReferenceRequired),
  runInProgress: () => problems.businessRule("retention.run_in_progress", RETENTION_TEXTS.runInProgress),
} as const;

// ------------------------------------------------------------------------------------------------ authorization

/**
 * The organization in which the principal holds `permission` at ORGANIZATION scope, or 403. A grant at a narrower
 * scope never admits an installation-wide operation.
 */
export async function requireRetentionRight(db: DbOrTx, principal: Principal, permission: Permission): Promise<string> {
  for (const organizationId of organizationsWith(principal, permission))
    if ((await authorize(db, principal, permission, { type: "organization", id: organizationId })).allowed)
      return organizationId;
  throw problems.forbidden();
}

/** True while a run or dry run is queued or running (also held by the 0144 index retention_run_one_active). */
export async function runActive(db: DbOrTx): Promise<boolean> {
  const row = await db
    .selectFrom("retention_run")
    .select("id")
    .where("status", "in", ["queued", "running"])
    .executeTakeFirst();
  return row !== undefined;
}

// ------------------------------------------------------------------------------------------------ contract mirror
// docs/api/openapi.yaml RetentionClass / RetentionClassPage / RetentionClassUpdate.
const timestamp = z.iso.datetime({ offset: true });
const tableName = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
export const retentionClassCode = z.string().regex(/^[a-z][a-z0-9_]{2,62}$/);
export const retentionAction = z.enum(["retain", "archive", "archive_then_purge"]);

export const retentionClassView = z.strictObject({
  id: z.uuid(),
  code: retentionClassCode,
  category: z.enum(["business", "audit", "snapshot", "system", "derived", "operational"]),
  labelEn: z.string(),
  labelAr: z.string(),
  descriptionEn: z.string(),
  descriptionAr: z.string(),
  managedByJob: z.string().nullable(),
  action: retentionAction,
  periodDays: z.number().int().min(1).max(36500).nullable(),
  itApprovalReference: z.string().nullable(),
  tables: z.array(z.strictObject({ tableName, ageColumn: z.string().nullable(), purgeEligible: z.boolean() })),
  updatedAt: timestamp,
  updatedBy: z.uuid().nullable(),
  version: z.number().int().min(1),
});
export type RetentionClassView = z.infer<typeof retentionClassView>;
export const retentionClassPage = z.strictObject({
  items: z.array(retentionClassView),
  nextCursor: z.string().nullable(),
});

/** The reference: 3-500 characters that are not only white space (the 0143 CHECK trims). */
const reference = z
  .string()
  .min(3)
  .max(500)
  .refine((v) => v.trim().length >= 3, { message: "The reference needs at least 3 characters." });

export const retentionClassUpdate = z.strictObject({
  action: retentionAction,
  periodDays: z.number().int().min(1).max(36500).nullable(),
  itApprovalReference: reference.nullable(),
  reason: reasonRule,
});
export type RetentionClassUpdate = z.infer<typeof retentionClassUpdate>;

type TableRow = Pick<RetentionTableClassRow, "table_name" | "age_column" | "purge_eligible" | "retention_class_id">;

export function presentClass(c: RetentionClassRow, tables: readonly TableRow[]): RetentionClassView {
  return retentionClassView.parse({
    id: c.id,
    code: c.code,
    category: c.category,
    labelEn: c.label_en,
    labelAr: c.label_ar,
    descriptionEn: c.description_en,
    descriptionAr: c.description_ar,
    managedByJob: c.managed_by_job,
    action: c.action,
    // NULL is "not set (IT to agree)": it stays null, never 0 or a default number.
    periodDays: c.period_days,
    itApprovalReference: c.it_approval_reference,
    tables: tables
      .filter((t) => t.retention_class_id === c.id)
      .map((t) => ({ tableName: t.table_name, ageColumn: t.age_column, purgeEligible: t.purge_eligible })),
    updatedAt: iso(c.updated_at),
    updatedBy: c.updated_by,
    version: c.version,
  });
}

/** The table map of the given classes, ordered by table name. */
export async function tablesOf(db: DbOrTx, classIds: readonly string[]): Promise<TableRow[]> {
  if (classIds.length === 0) return [];
  return db
    .selectFrom("retention_table_class")
    .select(["table_name", "age_column", "purge_eligible", "retention_class_id"])
    .where("retention_class_id", "in", [...classIds])
    .orderBy(sql`table_name COLLATE "C"`)
    .execute();
}

export async function findClass(db: DbOrTx, code: string): Promise<RetentionClassRow | undefined> {
  return db.selectFrom("retention_class").selectAll().where("code", "=", code).executeTakeFirst();
}

// ------------------------------------------------------------------------------------------------ the update

/** The E.5 refusals of a requested action on a class (null: allowed). The database refuses the same cases. */
export function classRefusal(
  c: Pick<RetentionClassRow, "category" | "managed_by_job">,
  tables: readonly Pick<TableRow, "age_column" | "purge_eligible">[],
  body: Pick<RetentionClassUpdate, "action" | "periodDays" | "itApprovalReference">,
) {
  if (body.action === "retain") return null;
  if (c.category !== "operational" || c.managed_by_job !== null) return retentionRefusals.classRetainOnly();
  if (tables.some((t) => t.age_column === null)) return retentionRefusals.classNotArchivable();
  if (body.action === "archive_then_purge" && tables.some((t) => !t.purge_eligible))
    return retentionRefusals.classNotArchivable();
  if (body.periodDays === null) return retentionRefusals.classPeriodRequired();
  if (body.itApprovalReference === null) return retentionRefusals.classReferenceRequired();
  return null;
}

/** updateRetentionClass's transaction (see the header). Returns the updated class. */
export async function updateClass(
  tx: Tx,
  request: FastifyRequest,
  code: string,
  expectedVersion: number,
  body: RetentionClassUpdate,
): Promise<RetentionClassView> {
  const principal = await refreshPrincipal(tx, request);
  const organizationId = await requireRetentionRight(tx, principal, "retention.configure");
  const userId = principal.userId;
  if (userId === null) throw problems.forbidden();
  await lockRetention(tx);
  const current = await tx
    .selectFrom("retention_class")
    .selectAll()
    .where("code", "=", code)
    .forUpdate()
    .executeTakeFirst();
  if (current === undefined) throw problems.notFound();
  if (current.version !== expectedVersion) throw problems.versionConflict(current.version);
  if (await runActive(tx)) throw retentionRefusals.runInProgress();
  const tables = await tablesOf(tx, [current.id]);
  const refusal = classRefusal(current, tables, body);
  if (refusal !== null) throw refusal;
  const updated = await tx
    .updateTable("retention_class")
    .set({
      action: body.action,
      period_days: body.periodDays,
      it_approval_reference: body.itApprovalReference,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "retention_class.updated",
    recordType: "retention_class",
    recordId: current.id,
    organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: {
      action: { from: current.action, to: updated.action },
      period_days: { from: current.period_days, to: updated.period_days },
      it_approval_reference: { from: current.it_approval_reference, to: updated.it_approval_reference },
    },
  });
  return presentClass(updated, tables);
}
