// The KPI actual import target `kpi_actual.v1` (ADR-0056 §1, §4-§6, §9; REQ-S17-002, REQ-S17-003; p6-work-split
// §B/A.4; T-DG6-KBE-A).
//
// A controlled import (CSV, XLSX, a signed webhook or a connector run) stages rows in `integrations`; this target is
// the KPI side of it:
//   - `columns`: the template of ADR-0056 §9 (`kpi_name` is informational: `validateRow` never reads it). The columns
//     carry no `informational` flag: the contract's ImportTemplateColumn (additionalProperties: false) has no such
//     member, and getConnectorMappings / listImportTemplates return the columns as they are;
//   - `validateRow`: the DG4 `submitKpiActual` rules (ADR-0027/0028), READ-ONLY, each failure a row-level reason code
//     `import.row.*` (an i18n key with params, never a sentence; ADR-0056 §5);
//   - `existingKeys`: the duplicate keys whose DG4 slot already exists (`kpi_actual_slot_key`, any status);
//   - `commitRow`: one row through the DG4 submission service (`submitFirstValue`, the function the
//     submitKpiActual route calls). It never accepts a value by itself: the KPI version's submission route decides
//     (review -> submitted, waiting for a reviewer; direct_accept -> accepted with its one kpi.actual_accepted outbox
//     event, which the worker's kpi.recalculate consumer turns into exactly one calculation run per value).
//
// Module boundary: kpi is a P4 module and imports no P6 module (architecture.test.ts "No P1-P5 module imports a P6
// module"), not even type-only. The target therefore implements the `ImportTarget` port of
// integrations/imports/targets.ts STRUCTURALLY with the local mirror types below; the composition root (server.ts)
// registers it, where the compiler checks it against the port.
//
// Decimals stay strings from the cell to numeric(24,6): a value matches ADR-0056 §4's pattern and the measure column,
// and is normalized with the shared decimal helper; nothing is coerced (`12,5` is a reason, never 12.5). A missing
// value is the DG4 "missing reason" path, never 0. Nothing here reads or writes DG0-DG7, and nothing approves anything.
import type { DbOrTx, KpiVersionRow, ReportingPeriodRow, Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import {
  canonicalDecimal,
  freeText,
  isCalendarDate,
  KPI_SCOPE_KINDS,
  kpiActualEntry,
  measureDecimal,
  type KpiActualEntry,
} from "@mth/shared/schemas";
import { resolveTarget } from "../access/index.ts";
import type { AuditContext } from "../audit/index.ts";
import { HttpProblem } from "../platform/index.ts";
import { writableTransformation } from "../transformations/index.ts";
import {
  activeVersionOf,
  EXPECTED_FIELDS,
  maySubmitActuals,
  reviewersOf,
  scopeValid,
  submitFirstValue,
  valueColumnsOf,
} from "./actuals.ts";
import type { KpiDefinitionRow } from "./repository.ts";

// ------------------------------------------------------------------------------------------------ the port, mirrored

/** Mirrors `ImportColumn` (integrations/imports/targets.ts). */
export interface KpiImportColumn {
  readonly key: string;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly required: boolean;
  readonly kind: "text" | "uuid" | "decimal" | "date" | "boolean" | "enum";
  readonly example: string | null;
  readonly informational?: boolean;
}

/** Mirrors `ImportRowReason`: an `import.row.*` code (i18n key), its field and the params of its text. */
export interface KpiImportRowReason {
  readonly code: string;
  readonly field?: string | null;
  readonly params?: Readonly<Record<string, string | number>>;
}

type Cells = Readonly<Record<string, string | null>>;

/** Mirrors `ImportTargetContext`. `audit` is the commit's audit context when the caller passes one (see `commitRow`). */
export interface KpiImportContext {
  readonly db: DbOrTx;
  readonly organizationId: string;
  readonly transformationId: string;
  readonly formSchemaVersionId: string;
  readonly templateVersion: string;
  readonly actorUserId: string | null;
  readonly audit?: AuditContext;
}

/** Mirrors `RowVerdict`. */
export type KpiRowVerdict =
  | { readonly valid: true; readonly normalized: Cells; readonly duplicateKey: string }
  | { readonly valid: false; readonly reasons: readonly KpiImportRowReason[]; readonly duplicateKey: string | null };

/** Mirrors `ImportCommitRow`. */
export interface KpiImportCommitRow {
  readonly importRowId: string;
  readonly rowNumber: number;
  readonly sourceRecordId: string | null;
  readonly normalized: Cells;
}

/** Mirrors `ImportCommitResult`. */
export interface KpiImportCommitResult {
  readonly recordType: "kpi_actual";
  readonly recordId: string;
  readonly valueNo: number;
}

// ------------------------------------------------------------------------------------------------ the template (§9)

export const KPI_ACTUAL_TEMPLATE_VERSION = "kpi_actual.v1";

// Arabic labels are provisional (ADR-0056 §5: "Arabic labelled provisional"), pending Mobily's translation review.
export const KPI_ACTUAL_IMPORT_COLUMNS: readonly KpiImportColumn[] = Object.freeze([
  {
    key: "source_record_id",
    labelEn: "Source record id",
    labelAr: "معرّف السجل في المصدر",
    required: false,
    kind: "text",
    example: "ROW-0001",
  },
  { key: "kpi_id", labelEn: "KPI id", labelAr: "معرّف المؤشر", required: true, kind: "uuid", example: null },
  {
    key: "kpi_name",
    labelEn: "KPI name (ignored on import)",
    labelAr: "اسم المؤشر (يُتجاهل عند الاستيراد)",
    required: false,
    kind: "text",
    example: null,
  },
  {
    key: "scope_kind",
    labelEn: "Scope kind",
    labelAr: "نوع النطاق",
    required: true,
    kind: "enum",
    example: "transformation",
  },
  { key: "scope_id", labelEn: "Scope id", labelAr: "معرّف النطاق", required: true, kind: "uuid", example: null },
  {
    key: "period_label",
    labelEn: "Reporting period",
    labelAr: "فترة التقرير",
    required: true,
    kind: "text",
    example: "2026-09",
  },
  { key: "value", labelEn: "Value", labelAr: "القيمة", required: false, kind: "decimal", example: "12.5" },
  { key: "numerator", labelEn: "Numerator", labelAr: "البسط", required: false, kind: "decimal", example: null },
  { key: "denominator", labelEn: "Denominator", labelAr: "المقام", required: false, kind: "decimal", example: null },
  {
    key: "milestone_achieved",
    labelEn: "Milestone achieved (true or false)",
    labelAr: "تحقق المعلم (true أو false)",
    required: false,
    kind: "boolean",
    example: null,
  },
  {
    key: "achieved_on",
    labelEn: "Achieved on (YYYY-MM-DD)",
    labelAr: "تاريخ التحقق (YYYY-MM-DD)",
    required: false,
    kind: "date",
    example: null,
  },
  { key: "currency", labelEn: "Currency", labelAr: "العملة", required: false, kind: "text", example: "SAR" },
  {
    key: "missing_reason",
    labelEn: "Why the value is not available",
    labelAr: "سبب عدم توفر القيمة",
    required: false,
    kind: "text",
    example: null,
  },
  {
    key: "data_as_of",
    labelEn: "Data as of (YYYY-MM-DD)",
    labelAr: "البيانات حتى تاريخ (YYYY-MM-DD)",
    required: true,
    kind: "date",
    example: "2026-09-30",
  },
  { key: "comment", labelEn: "Comment", labelAr: "تعليق", required: false, kind: "text", example: null },
] satisfies KpiImportColumn[]);

/** ADR-0056 §4: a dot separator, no thousands separator, at most 18 integer and 6 fractional digits. */
const IMPORT_DECIMAL = /^-?[0-9]{1,18}(\.[0-9]{1,6})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOLEANS: ReadonlyMap<string, "true" | "false"> = new Map([
  ["true", "true"],
  ["false", "false"],
]);
const DECIMAL_FIELDS = ["value", "numerator", "denominator"] as const;
/** The DG4 free-text bounds of the entry (kpiActualEntry): missing reason 1-1000, comment 1-4000. */
const TEXT_FIELDS = [
  ["missing_reason", freeText(1, 1000), 1000],
  ["comment", freeText(1, 4000), 4000],
] as const;

/** The duplicate key of a slot: the DG4 `kpi_actual_slot_key` ("source/period" of M0334; ADR-0056 §5). */
export const slotKeyOf = (kpiDefinitionId: string, scopeKind: string, scopeId: string, reportingPeriodId: string) =>
  `kpi_actual:${kpiDefinitionId}:${scopeKind}:${scopeId}:${reportingPeriodId}`;

const SLOT_KEY = /^kpi_actual:([0-9a-f-]{36}):([a-z_]+):([0-9a-f-]{36}):([0-9a-f-]{36})$/;

const cell = (cells: Cells, key: string): string | null => {
  for (const [k, v] of Object.entries(cells)) if (k === key) return v === null || v.length === 0 ? null : v;
  return null;
};

const reason = (
  code: string,
  field: string | null,
  params: Record<string, string | number> = {},
): KpiImportRowReason => ({
  code,
  field,
  params: field === null ? params : { field, ...params },
});

// ------------------------------------------------------------------------------------------------ validateRow

interface Resolved {
  def: KpiDefinitionRow;
  version: KpiVersionRow | undefined;
  period: ReportingPeriodRow | undefined;
  scopeOk: boolean;
}

/**
 * The verdict of one row with the DG4 submitKpiActual rules, read-only (ADR-0056 §4). Every failing rule adds its
 * reason; the row is valid only with none. `actorUserId` null (a machine source without an on-behalf-of user) skips
 * the updater check here; the commit re-checks it for the committer.
 */
export async function validateKpiActualRow(
  ctx: KpiImportContext,
  row: { readonly rowNumber: number; readonly cells: Cells },
): Promise<KpiRowVerdict> {
  const db = ctx.db;
  const reasons: KpiImportRowReason[] = [];
  const c = (key: string) => cell(row.cells, key);

  for (const col of KPI_ACTUAL_IMPORT_COLUMNS)
    if (col.required && c(col.key) === null) reasons.push(reason("import.row.required_missing", col.key));

  // Value fields: decimal text only (never coerced), booleans, dates (ADR-0056 §4, §5).
  const normalizedDecimal = new Map<string, string | null>();
  for (const field of DECIMAL_FIELDS) {
    const v = c(field);
    if (v === null) normalizedDecimal.set(field, null);
    else if (!IMPORT_DECIMAL.test(v) || !measureDecimal.safeParse(v).success)
      reasons.push(reason("import.row.value_not_decimal", field, { value: v.slice(0, 200) }));
    else normalizedDecimal.set(field, canonicalDecimal(v));
  }
  const milestoneRaw = c("milestone_achieved");
  const milestone = milestoneRaw === null ? null : (BOOLEANS.get(milestoneRaw.toLowerCase()) ?? undefined);
  for (const field of ["achieved_on", "data_as_of"] as const) {
    const v = c(field);
    if (v !== null && !isCalendarDate(v))
      reasons.push(reason("import.row.date_invalid", field, { value: v.slice(0, 200) }));
  }
  for (const [field, schema, max] of TEXT_FIELDS) {
    const v = c(field);
    if (v !== null && !schema.safeParse(v).success && v.length <= 4000)
      reasons.push(reason("import.row.text_length", field, { max }));
  }

  // The slot: KPI in this transformation, its active version, the scope, the period (by label, the KPI's frequency).
  const kpiId = c("kpi_id");
  let resolved: Resolved | null = null;
  if (kpiId !== null) {
    const def = UUID.test(kpiId)
      ? await db
          .selectFrom("kpi_definition")
          .selectAll()
          .where("transformation_id", "=", ctx.transformationId)
          .where("id", "=", kpiId.toLowerCase())
          .executeTakeFirst()
      : undefined;
    if (!def) reasons.push(reason("import.row.kpi_unknown", "kpi_id", { value: kpiId.slice(0, 200) }));
    else {
      const version = await activeVersionOf(db, def.id);
      if (!version) reasons.push(reason("import.row.kpi_no_active_version", "kpi_id", { value: def.id }));
      const scopeKind = c("scope_kind");
      const scopeId = c("scope_id");
      let scopeOk = false;
      if (scopeKind !== null && scopeId !== null) {
        scopeOk =
          (KPI_SCOPE_KINDS as readonly string[]).includes(scopeKind) &&
          UUID.test(scopeId) &&
          (version === undefined || version.entry_scope_kind === scopeKind) &&
          (await scopeValid(db, ctx.organizationId, ctx.transformationId, scopeKind, scopeId.toLowerCase()));
        if (!scopeOk)
          reasons.push(
            reason("import.row.scope_invalid", "scope_id", { value: `${scopeKind} ${scopeId}`.slice(0, 200) }),
          );
      }
      const label = c("period_label");
      let period: ReportingPeriodRow | undefined;
      if (label !== null) {
        period = await db
          .selectFrom("reporting_period")
          .selectAll()
          .where("organization_id", "=", ctx.organizationId)
          .where("frequency", "=", def.frequency)
          .where("period_label", "=", label)
          .executeTakeFirst();
        if (!period) reasons.push(reason("import.row.period_unknown", "period_label", { value: label.slice(0, 200) }));
        else if (period.status !== "open")
          reasons.push(reason("import.row.period_not_open", "period_label", { value: period.period_label }));
      }
      resolved = { def, version, period, scopeOk };
      if (version)
        await versionRules(ctx, resolved, version, row.cells, milestoneRaw, milestone, normalizedDecimal, reasons);
    }
  }

  const duplicateKey =
    resolved !== null && resolved.scopeOk && resolved.period !== undefined
      ? slotKeyOf(resolved.def.id, c("scope_kind")!, c("scope_id")!.toLowerCase(), resolved.period.id)
      : null;
  if (reasons.length > 0 || resolved === null || duplicateKey === null || resolved.period === undefined)
    return {
      valid: false,
      reasons: reasons.length > 0 ? reasons : [reason("import.row.required_missing", "kpi_id")],
      duplicateKey,
    };

  const normalized: Record<string, string | null> = {
    source_record_id: c("source_record_id"),
    kpi_id: resolved.def.id,
    scope_kind: c("scope_kind"),
    scope_id: c("scope_id")!.toLowerCase(),
    reporting_period_id: resolved.period.id,
    period_label: resolved.period.period_label,
    value: normalizedDecimal.get("value") ?? null,
    numerator: normalizedDecimal.get("numerator") ?? null,
    denominator: normalizedDecimal.get("denominator") ?? null,
    milestone_achieved: milestone ?? null,
    achieved_on: c("achieved_on"),
    currency: c("currency"),
    missing_reason: c("missing_reason"),
    data_as_of: c("data_as_of"),
    comment: c("comment"),
  };
  return { valid: true, normalized, duplicateKey };
}

/** The rules that need the active version: value shape, currency, evidence, updater, reviewer routing. */
async function versionRules(
  ctx: KpiImportContext,
  r: Resolved,
  version: KpiVersionRow,
  cells: Cells,
  milestoneRaw: string | null,
  milestone: "true" | "false" | null | undefined,
  decimals: ReadonlyMap<string, string | null>,
  reasons: KpiImportRowReason[],
): Promise<void> {
  const c = (key: string) => cell(cells, key);
  const expected = EXPECTED_FIELDS.get(version.value_nature) ?? "a value";
  const decimalsOk = DECIMAL_FIELDS.every((f) => c(f) === null || decimals.has(f));
  if (milestone === undefined)
    reasons.push(
      reason("import.row.value_shape", "milestone_achieved", { expected, value: (milestoneRaw ?? "").slice(0, 200) }),
    );
  else if (decimalsOk) {
    // The DG4 shape and currency rules themselves (valueColumnsOf), mapped to row reasons.
    try {
      valueColumnsOf(version, {
        action: "submit",
        dataAsOf: c("data_as_of") ?? "",
        value: decimals.get("value") ?? null,
        numerator: decimals.get("numerator") ?? null,
        denominator: decimals.get("denominator") ?? null,
        milestoneAchieved: milestone === null ? null : milestone === "true",
        achievedOn: c("achieved_on"),
        currency: c("currency"),
        missingReason: c("missing_reason"),
      });
    } catch (err) {
      if (!(err instanceof HttpProblem)) throw err;
      if (err.code === "kpi_actual.currency_mismatch")
        reasons.push(
          reason("import.row.currency_mismatch", "currency", {
            value: (c("currency") ?? "").slice(0, 200),
            expected: version.currency === null ? "-" : version.currency.trim(),
          }),
        );
      else reasons.push(reason("import.row.value_shape", null, { expected }));
    }
  }
  // An import submits (never a draft), so a KPI that needs evidence with each actual cannot be imported (ADR-0056 §4).
  if (version.dq_evidence_required) reasons.push(reason("import.row.evidence_required", null));
  if (ctx.actorUserId !== null && !(await maySubmitActuals(ctx.db, r.def, ctx.actorUserId)))
    reasons.push(reason("import.row.not_kpi_updater", "kpi_id", { value: r.def.id }));
  // DG4 refuses a review-route submission nobody can decide (routing.role_unmapped / assignee_not_approver); staging
  // reports it per row instead of failing the whole commit (proposed code, see the handback).
  if (version.submission_route === "review" && version.reviewer_party_code !== null) {
    const target = await resolveTarget(ctx.db, { type: "transformation", id: ctx.transformationId });
    const reviewers =
      target === null
        ? "unmapped"
        : await reviewersOf(ctx.db, ctx.transformationId, version.reviewer_party_code, target);
    if (reviewers === "unmapped" || reviewers.length === 0)
      reasons.push(reason("import.row.reviewer_unavailable", "kpi_id", { value: r.def.id }));
  }
}

// ------------------------------------------------------------------------------------------------ existingKeys

/** The keys among `keys` whose DG4 slot already exists in the transformation, with the slot's status (read-only). */
export async function existingKpiActualKeys(
  ctx: KpiImportContext,
  keys: readonly string[],
): Promise<ReadonlyMap<string, Readonly<Record<string, string>>>> {
  const out = new Map<string, Readonly<Record<string, string>>>();
  const tuples = keys
    .map((k) => SLOT_KEY.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ kpi: m[1]!, kind: m[2]!, scope: m[3]!, period: m[4]! }));
  for (let i = 0; i < tuples.length; i += 200) {
    const chunk = tuples.slice(i, i + 200);
    const rows = await ctx.db
      .selectFrom("kpi_actual")
      .select(["kpi_definition_id", "scope_kind", "scope_id", "reporting_period_id", "status"])
      .where("transformation_id", "=", ctx.transformationId)
      .where((eb) =>
        eb.or(
          chunk.map((t) =>
            eb.and([
              eb("kpi_definition_id", "=", t.kpi),
              eb("scope_kind", "=", t.kind),
              eb("scope_id", "=", t.scope),
              eb("reporting_period_id", "=", t.period),
            ]),
          ),
        ),
      )
      .execute();
    for (const r of rows)
      out.set(slotKeyOf(r.kpi_definition_id, r.scope_kind, r.scope_id, r.reporting_period_id), { status: r.status });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ commitRow

/** A defect, never a user error: the commit hands a row this target did not normalize, or no committing user. */
const commitDefect = (why: string) => new Error(`kpi_actual import target: ${why}`);

/**
 * Commits one valid row through the DG4 submission service, inside the caller's commit transaction (ADR-0056 §6
 * step 3). The caller (BE-M2's commit) has already re-authorized the committer (`import.commit` and
 * `kpi_actual.submit`, ReadScope) and re-validated the row; DG4 then applies every rule again (record-level updater,
 * active version, scope, open period, shape, currency, evidence, reviewer routing, the slot's uniqueness) and any
 * refusal aborts the whole commit. The audit events are the DG4 ones (one per slot), attributed to the committing
 * user; `ctx.audit` (the commit request's context) is used when the caller passes it, else the events carry the
 * request id `import:<batch id>`.
 */
export async function commitKpiActualRow(
  tx: Tx,
  ctx: KpiImportContext,
  row: KpiImportCommitRow,
): Promise<KpiImportCommitResult> {
  const userId = ctx.actorUserId;
  if (userId === null) throw commitDefect("a commit needs the committing (or on-behalf-of) user");
  const n = (key: string) => cell(row.normalized, key);
  const kpiId = n("kpi_id");
  if (kpiId === null) throw commitDefect(`row ${row.rowNumber} has no normalized kpi_id`);
  const entry: KpiActualEntry = kpiActualEntry.parse({
    scopeKind: n("scope_kind"),
    scopeId: n("scope_id"),
    reportingPeriodId: n("reporting_period_id"),
    action: "submit",
    value: n("value"),
    numerator: n("numerator"),
    denominator: n("denominator"),
    milestoneAchieved: n("milestone_achieved") === null ? null : n("milestone_achieved") === "true",
    achievedOn: n("achieved_on"),
    currency: n("currency"),
    missingReason: n("missing_reason"),
    dataAsOf: n("data_as_of"),
    comment: n("comment"),
  });
  const t = await writableTransformation(tx, ctx.transformationId);
  const target = await resolveTarget(tx, { type: "transformation", id: ctx.transformationId });
  if (target === null) throw commitDefect("the transformation has no scope node");
  let audit = ctx.audit;
  if (audit === undefined) {
    const owner = await tx
      .selectFrom("import_row")
      .select("import_batch_id")
      .where("id", "=", row.importRowId)
      .executeTakeFirst();
    audit = {
      actorUserId: userId,
      actorType: "user",
      requestId: `import:${owner?.import_batch_id ?? row.importRowId}`,
    };
  }
  const slot = await submitFirstValue(
    { tx, userId, audit, transformationId: ctx.transformationId, organizationId: t.organization_id, target },
    kpiId,
    entry,
  );
  return { recordType: "kpi_actual", recordId: slot.id, valueNo: slot.current_value_no };
}

// ------------------------------------------------------------------------------------------------ the target

const SUBMIT: Permission = "kpi_actual.submit";

/**
 * The `kpi_actual.v1` target, registered once at composition (server.ts, below the ImportTargetRegistry line).
 * `extensionColumns`: the P5 form schema has no `kpi_actual` record type (0068/0069 list none), so the pinned version
 * gives no extension column and any column outside the template is `import.header_mismatch` (ADR-0056 §4).
 */
export function createKpiActualImportTarget() {
  return Object.freeze({
    kind: "kpi_actual" as const,
    templateVersion: KPI_ACTUAL_TEMPLATE_VERSION,
    titleEn: "KPI actuals",
    titleAr: "القيم الفعلية لمؤشرات الأداء",
    columns: KPI_ACTUAL_IMPORT_COLUMNS,
    validateRow: validateKpiActualRow,
    existingKeys: existingKpiActualKeys,
    commitRow: commitKpiActualRow,
    requiredPermissions: Object.freeze([SUBMIT]) as readonly Permission[],
    extensionColumns: async (_ctx: KpiImportContext): Promise<readonly string[]> => [],
  });
}
