// The `form_schema` configuration kind's provider (ADR-0041 §2-§4, §10; ADR-0040 §2; REQ-S05-002, REQ-S06-005,
// REQ-S06-007, REQ-S06-008; p5-work-split §B.2; T-DG5-BE-D). Registered into methodology's ConfigKindProvider registry
// when the forms module registers (methodology imports no P5 module):
//  - catalogue: the stable identities of the kind's two element types: `form` = a form_record_type code, `form_field`
//    `<recordType>.<fieldKey>` = a protected source column of form_source_field (0068, read-only). ConfigResolver merges
//    a version's rows over them, so a relabelled source column resolves to its new label and keeps its type.
//  - validateElement (Studio putConfigElement): a form is never added (422 form_schema.form_fixed); a source column's
//    type is fixed and it takes no settings (422 form_schema.source_column_type_fixed); an extension field needs a
//    record type that takes extension fields (422 form_schema.extensions_not_allowed), a lowercase key that is not a
//    source column (422 form_schema.extension_key_invalid), one of the eleven types (422 field_type_unknown), its
//    settings (422 field_settings_invalid) and, when calculated, a formula over the record type's numeric fields that
//    the DG3 engine validates (422 form_schema.calculated_formula_invalid; packages/shared/src/formula unchanged).
//  - validateRemove (removeConfigElement): a source column is never removed (422 form_schema.source_column_protected,
//    REQ-S05-002 "attempting to delete the T03 'Gap' column is rejected"); a form neither (422 form_schema.form_fixed).
//  - compatibility: `warn` for a new required field (pinned transformations stay pinned); a calculated field whose
//    formula no longer validates is a `fail` through validateElement (invariants.ts re-runs it over every row).
//  - affectedRecords: per transformation, the live record count of each record type whose form changed.
//  - preview: sample records validated against the draft's fields (and their calculated values evaluated).
//  - migrationItems (ADR-0040 §2): `new_required_field` per required field the target adds for a record type the
//    transformation has records of; `invalidated_calculation` per changed calculated field with stored values.
// The database repeats these rules (0068 methodology_element_guard, form_custom_value_guard); reaching them is a
// programming error, and `mapFormDbError` maps their names to the same §10 refusals. Configuration only: nothing here
// grants a business approval.
import { sql, type DbOrTx, type FormRecordTypeRow } from "@mth/db";
import {
  defineField,
  evaluateCalculatedField,
  FIELD_TYPES,
  isFieldType,
  numericFieldsOf,
  parseFieldSettings,
  toCalculatedEntry,
  validateCalculatedField,
  validateRecordValues,
  type CalculatedSettings,
  type FieldDefinition,
  type FieldType,
  type NumericField,
} from "@mth/shared/calc";
import { FORM_FIELD_KEY_PATTERN, FORM_FIELD_SETTING_ATTRIBUTES, type ConfigPreviewRequest } from "@mth/shared/schemas";
import {
  createConfigResolver,
  registerConfigKindProvider,
  type AffectedRecordCount,
  type CatalogueEntry,
  type CompatibilityFinding,
  type ConfigElementChange,
  type PreviewOutcome,
} from "../methodology/index.ts";
import { problems, type HttpProblem } from "../platform/index.ts";
import { formRefusals } from "./record-types.ts";

const resolver = createConfigResolver();

/** One resolved field of a form in one version (a protected source column or an extension field). */
export interface ResolvedFormField {
  readonly key: string;
  readonly origin: "source" | "admin";
  readonly fieldType: FieldType;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly helpEn: string | null;
  readonly helpAr: string | null;
  readonly required: boolean;
  readonly bulkEditable: boolean;
  readonly storageKind: "column" | "composite" | "computed" | null;
  readonly storageRef: string | null;
  readonly sourceRef: string | null;
  readonly ordinal: number | null;
  readonly removed: boolean;
  /** The element's resolved attributes (labels, help, required, type and settings). */
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface ResolvedForm {
  readonly labelEn: string;
  readonly labelAr: string;
  readonly helpEn: string | null;
  readonly helpAr: string | null;
  readonly fields: readonly ResolvedFormField[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** `<recordType>.<fieldKey>` -> [recordType, fieldKey] (split at the first dot), or null. */
export function splitFieldKey(stableKey: string): readonly [string, string] | null {
  const dot = stableKey.indexOf(".");
  if (dot <= 0 || dot === stableKey.length - 1) return null;
  return [stableKey.slice(0, dot), stableKey.slice(dot + 1)];
}

// ------------------------------------------------------------------------------------------------ catalogue

async function catalogue(db: DbOrTx, type: string): Promise<CatalogueEntry[] | null> {
  if (type === "form") {
    const rows = await db.selectFrom("form_record_type").selectAll().orderBy("ordinal").execute();
    return rows.map((r) => ({
      stableKey: r.code,
      ordinal: r.ordinal,
      sourceRef: r.source_ref,
      attributes: { labelEn: r.title_en, labelAr: r.title_ar },
    }));
  }
  if (type === "form_field") {
    const rows = await db
      .selectFrom("form_source_field as f")
      .innerJoin("form_record_type as t", "t.code", "f.record_type")
      .select(["f.record_type", "f.field_key", "f.ordinal", "f.label_en", "f.label_ar", "f.field_type", "f.source_ref"])
      .orderBy("t.ordinal")
      .orderBy("f.ordinal")
      .execute();
    return rows.map((r) => ({
      stableKey: `${r.record_type}.${r.field_key}`,
      ordinal: r.ordinal,
      sourceRef: r.source_ref,
      attributes: { labelEn: r.label_en, labelAr: r.label_ar, fieldType: r.field_type },
    }));
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ resolution

/** The form of one record type in one form_schema version (ADR-0041 §2, §5 "inline help"). */
export async function resolveForm(
  db: DbOrTx,
  versionId: string,
  recordType: FormRecordTypeRow,
  o: { readonly includeRemoved?: boolean } = {},
): Promise<ResolvedForm> {
  const [form, elements, sources] = await Promise.all([
    resolver.element(db, versionId, "form", recordType.code),
    resolver.elements(db, versionId, "form_field", { includeRemoved: true }),
    db.selectFrom("form_source_field").selectAll().where("record_type", "=", recordType.code).execute(),
  ]);
  const sourceByKey = new Map(sources.map((s) => [s.field_key, s]));
  const prefix = `${recordType.code}.`;
  const fields: ResolvedFormField[] = [];
  for (const e of elements) {
    if (!e.stableKey.startsWith(prefix)) continue;
    if (e.removed && o.includeRemoved !== true) continue;
    const key = e.stableKey.slice(prefix.length);
    const a = new Map(Object.entries(e.attributes));
    const src = e.origin === "source" ? sourceByKey.get(key) : undefined;
    const type = src !== undefined ? src.field_type : a.get("fieldType");
    if (!isFieldType(type)) continue; // an unreadable stored row is reported by compatibility, never served
    fields.push({
      key,
      origin: src !== undefined ? "source" : "admin",
      fieldType: type,
      labelEn: str(a.get("labelEn")) ?? src?.label_en ?? key,
      labelAr: str(a.get("labelAr")) ?? src?.label_ar ?? str(a.get("labelEn")) ?? key,
      helpEn: str(a.get("helpEn")),
      helpAr: str(a.get("helpAr")),
      required: a.get("required") === true,
      bulkEditable: src?.bulk_editable ?? false,
      storageKind: (src?.storage_kind as ResolvedFormField["storageKind"]) ?? null,
      storageRef: src?.storage_ref ?? null,
      sourceRef: src?.source_ref ?? e.sourceRef,
      ordinal: e.ordinal,
      removed: e.removed,
      attributes: e.attributes,
    });
  }
  const fa = new Map(Object.entries(form?.attributes ?? {}));
  return {
    labelEn: str(fa.get("labelEn")) ?? recordType.title_en,
    labelAr: str(fa.get("labelAr")) ?? recordType.title_ar,
    helpEn: str(fa.get("helpEn")),
    helpAr: str(fa.get("helpAr")),
    fields,
  };
}

/** The resolved settings of a field (defaults applied; a source column has none: its register validates it). */
export function settingsOf(f: ResolvedFormField, defaultCurrency: string): Record<string, unknown> {
  if (f.origin === "source") return {};
  const r = parseFieldSettings(f.fieldType, f.attributes, { defaultCurrency });
  return r.ok ? { ...(r.settings as Record<string, unknown>) } : {};
}

/** The active extension fields as validator definitions (calculated ones included: they are refused as values). */
export function extensionDefinitions(form: ResolvedForm, defaultCurrency: string): FieldDefinition[] {
  const out: FieldDefinition[] = [];
  for (const f of form.fields) {
    if (f.origin !== "admin" || f.removed) continue;
    const d = defineField(f.key, f.fieldType, f.attributes, { defaultCurrency, required: f.required });
    if (d.ok) out.push(d.field);
  }
  return out;
}

/**
 * The numeric fields a calculated field may read: the extension number/currency/percentage fields and the source
 * columns of type number or percentage stored in one typed column (T14 `target`), by field key.
 */
export function numericVariables(form: ResolvedForm, defaultCurrency: string, except?: string): NumericField[] {
  const defs = extensionDefinitions(form, defaultCurrency).filter((d) => d.key !== except);
  const out = numericFieldsOf(defs);
  for (const f of form.fields)
    if (
      f.origin === "source" &&
      f.storageKind === "column" &&
      (f.fieldType === "number" || f.fieldType === "percentage") &&
      f.key !== except
    )
      out.push({ key: f.key, fieldType: f.fieldType });
  return out;
}

/** The calculated settings of a field, or null. */
export function calculatedSettingsOf(f: ResolvedFormField): CalculatedSettings | null {
  if (f.fieldType !== "calculated") return null;
  const r = parseFieldSettings("calculated", f.attributes);
  return r.ok ? (r.settings as CalculatedSettings) : null;
}

/** The record's source-column inputs of its calculated fields (typed numeric columns read as decimal strings). */
export async function sourceInputs(
  db: DbOrTx,
  recordType: FormRecordTypeRow,
  form: ResolvedForm,
  recordId: string,
): Promise<Record<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const f of form.fields) {
    if (f.origin !== "source" || f.storageKind !== "column" || f.storageRef === null) continue;
    if (f.fieldType !== "number" && f.fieldType !== "percentage") continue;
    const [table, column] = f.storageRef.split(".");
    if (table === undefined || column === undefined || table !== recordType.table_name) continue;
    // Table and column come from the read-only registry (0068 seed; FS03 checked them against the catalogue).
    const r = await sql<{ v: string | null }>`SELECT ${sql.ref(column)}::text AS v FROM ${sql.table(table)}
       WHERE id = ${recordId}::uuid`.execute(db);
    out.set(f.key, r.rows[0]?.v ?? null);
  }
  return Object.fromEntries(out);
}

// ------------------------------------------------------------------------------------------------ validateElement

async function recordTypeRow(db: DbOrTx, code: string): Promise<FormRecordTypeRow | undefined> {
  return db.selectFrom("form_record_type").selectAll().where("code", "=", code).executeTakeFirst();
}

async function validateElement(
  db: DbOrTx,
  input: {
    readonly versionId: string;
    readonly elementType: string;
    readonly stableKey: string;
    readonly origin: "source" | "admin";
    readonly attributes: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const a = new Map(Object.entries(input.attributes));
  if (input.elementType === "form") {
    if (input.origin !== "source") throw formRefusals.formFixed(); // a form is a registered record type
    return;
  }
  if (input.elementType !== "form_field") return;
  const parts = splitFieldKey(input.stableKey);
  if (parts === null) throw formRefusals.extensionKeyInvalid();
  const [rtCode, fieldKey] = parts;
  const hasSettings = FORM_FIELD_SETTING_ATTRIBUTES.some((k) => a.has(k));

  if (input.origin === "source") {
    const src = await db
      .selectFrom("form_source_field")
      .select("field_type")
      .where("record_type", "=", rtCode)
      .where("field_key", "=", fieldKey)
      .executeTakeFirst();
    // A source column: relabel, help and required only; its type and type semantics are fixed (REQ-S05-002).
    if (src !== undefined && ((a.has("fieldType") && a.get("fieldType") !== src.field_type) || hasSettings))
      throw formRefusals.sourceColumnTypeFixed();
    return;
  }

  const rt = await recordTypeRow(db, rtCode);
  if (rt === undefined)
    throw problems.businessRule("config_version.unknown_element", "This element does not exist in the methodology.");
  if (!rt.custom_fields_allowed) throw formRefusals.extensionsNotAllowed();
  if (!FORM_FIELD_KEY_PATTERN.test(fieldKey)) throw formRefusals.extensionKeyInvalid();
  const fieldType = a.get("fieldType");
  if (!isFieldType(fieldType)) throw formRefusals.fieldTypeUnknown();
  const settings = parseFieldSettings(fieldType, input.attributes);
  if (!settings.ok) throw formRefusals.fieldSettingsInvalid();
  if (fieldType === "reference") {
    const target = await recordTypeRow(db, String(a.get("targetRecordType")));
    if (target === undefined || target.table_name === null || target.feature_status !== "working")
      throw formRefusals.fieldSettingsInvalid();
  }
  if (fieldType === "calculated") {
    const form = await resolveForm(db, input.versionId, rt);
    const check = validateCalculatedField(
      settings.settings as CalculatedSettings,
      numericVariables(form, "SAR", fieldKey),
    );
    if (!check.ok) throw formRefusals.calculatedFormulaInvalid();
  }
}

async function validateRemove(
  db: DbOrTx,
  input: { readonly elementType: string; readonly stableKey: string; readonly origin: "source" | "admin" | null },
): Promise<void> {
  if (input.elementType === "form") throw formRefusals.formFixed();
  if (input.elementType !== "form_field") return;
  const parts = splitFieldKey(input.stableKey);
  if (parts === null) return; // unknown: the generic rule answers config_version.unknown_element
  const src = await db
    .selectFrom("form_source_field")
    .select("id")
    .where("record_type", "=", parts[0])
    .where("field_key", "=", parts[1])
    .executeTakeFirst();
  if (src !== undefined || input.origin === "source") throw formRefusals.sourceColumnProtected();
}

// ------------------------------------------------------------------------------------------------ compatibility

const requiredOf = (attrs: Readonly<Record<string, unknown>> | null) =>
  attrs !== null && new Map(Object.entries(attrs)).get("required") === true;

async function compatibility(
  _db: DbOrTx,
  input: { readonly changes: readonly ConfigElementChange[] },
): Promise<CompatibilityFinding[]> {
  const out: CompatibilityFinding[] = [];
  for (const c of input.changes) {
    if (c.elementType !== "form_field" || c.change === "removed") continue;
    // A new required field (added as required, or an existing field made required): pinned transformations stay pinned
    // and their migration plan asks for a value (ADR-0040 §2).
    if (requiredOf(c.to) && !requiredOf(c.from))
      out.push({
        severity: "warn",
        code: "compatibility.required_field_added",
        elementType: "form_field",
        stableKey: c.stableKey,
        params: {},
      });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ affected records

async function recordCounts(
  db: DbOrTx,
  rt: FormRecordTypeRow,
  ids: readonly string[],
): Promise<Map<string, number> | null> {
  if (rt.table_name === null || rt.table_name === "procedure_definition") return null;
  const where =
    rt.discriminator_column !== null && rt.discriminator_value !== null
      ? sql`AND ${sql.ref(rt.discriminator_column)} = ${rt.discriminator_value}`
      : sql``;
  // Table and column names come from the read-only registry, never from input.
  const r = await sql<{ transformation_id: string; n: number }>`
    SELECT transformation_id, count(*)::int AS n FROM ${sql.table(rt.table_name)}
     WHERE transformation_id = ANY(${[...ids]}::uuid[]) ${where} GROUP BY transformation_id`.execute(db);
  return new Map(r.rows.map((x) => [x.transformation_id, Number(x.n)]));
}

async function affectedRecords(
  db: DbOrTx,
  input: { readonly changes: readonly ConfigElementChange[]; readonly transformationIds: readonly string[] },
): Promise<AffectedRecordCount[]> {
  const codes = new Set<string>();
  for (const c of input.changes) {
    if (c.elementType === "form") codes.add(c.stableKey);
    else if (c.elementType === "form_field") {
      const p = splitFieldKey(c.stableKey);
      if (p !== null) codes.add(p[0]);
    }
  }
  const out: AffectedRecordCount[] = [];
  for (const code of [...codes].sort()) {
    const rt = await recordTypeRow(db, code);
    const counts = rt === undefined ? null : await recordCounts(db, rt, input.transformationIds);
    for (const t of input.transformationIds)
      out.push(
        counts === null
          ? { transformationId: t, recordType: code, count: null, unknownReason: "affected_records.no_counter" }
          : { transformationId: t, recordType: code, count: counts.get(t) ?? 0, unknownReason: null },
      );
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ preview

async function preview(
  db: DbOrTx,
  input: { readonly versionId: string; readonly samples: unknown },
): Promise<PreviewOutcome> {
  const samples = input.samples as ConfigPreviewRequest["samples"];
  const results: Record<string, unknown>[] = [];
  for (const [index, s] of samples.entries()) {
    if (s.kind !== "record") {
      results.push({ index, kind: s.kind, result: "fail", code: "preview.sample_not_supported" });
      continue;
    }
    const inputMap = new Map(Object.entries(s.input));
    const code = s.recordType ?? inputMap.get("recordType");
    const rt = typeof code === "string" ? await recordTypeRow(db, code) : undefined;
    if (rt === undefined || rt.table_name === null) {
      results.push({ index, kind: s.kind, result: "fail", code: "preview.sample_invalid" });
      continue;
    }
    const form = await resolveForm(db, input.versionId, rt);
    const values = inputMap.has("values") ? inputMap.get("values") : s.input;
    const v = validateRecordValues(extensionDefinitions(form, "SAR"), values);
    if (!v.ok) {
      results.push({
        index,
        kind: s.kind,
        recordType: rt.code,
        result: "fail",
        code: v.status === 400 ? "validation" : v.code,
        fields: v.problems.map((p) => ({ field: p.field, code: p.code })),
      });
      continue;
    }
    const calculated = new Map<string, unknown>();
    const vars = numericVariables(form, "SAR");
    for (const f of form.fields) {
      const cs = f.origin === "admin" ? calculatedSettingsOf(f) : null;
      if (cs !== null) calculated.set(f.key, toCalculatedEntry(evaluateCalculatedField(cs, vars, v.values)));
    }
    results.push({
      index,
      kind: s.kind,
      recordType: rt.code,
      result: "pass",
      values: v.values,
      calculated: Object.fromEntries(calculated),
    });
  }
  const failed = results.filter((r) => r["result"] === "fail").length;
  return { result: failed === 0 ? "pass" : "fail", report: { evaluated: results.length, failed, results } };
}

// ------------------------------------------------------------------------------------------------ migration items

async function migrationItems(
  db: DbOrTx,
  input: { readonly transformationId: string; readonly fromVersionId: string; readonly toVersionId: string },
): Promise<Record<string, unknown>[]> {
  const types = await db
    .selectFrom("form_record_type")
    .selectAll()
    .where("custom_fields_allowed", "=", true)
    .orderBy("ordinal")
    .execute();
  const out: Record<string, unknown>[] = [];
  for (const rt of types) {
    const [from, to] = await Promise.all([
      resolveForm(db, input.fromVersionId, rt),
      resolveForm(db, input.toVersionId, rt),
    ]);
    const before = new Map(from.fields.map((f) => [f.key, f]));
    const counts = await recordCounts(db, rt, [input.transformationId]);
    const records = counts?.get(input.transformationId) ?? 0;
    for (const f of to.fields) {
      const old = before.get(f.key);
      if (f.required && f.fieldType !== "calculated" && (old === undefined || !old.required) && records > 0)
        out.push({
          itemKind: "new_required_field",
          elementType: "form_field",
          stableKey: `${rt.code}.${f.key}`,
          recordType: rt.table_name,
          resolution: "needs_input",
          detail: {
            recordTypeCode: rt.code,
            fieldKey: f.key,
            fieldType: f.fieldType,
            labelEn: f.labelEn,
            labelAr: f.labelAr,
            recordCount: records,
          },
        });
    }
    const after = new Map(to.fields.map((f) => [f.key, f]));
    for (const f of from.fields) {
      const was = calculatedSettingsOf(f);
      if (was === null) continue;
      const now = after.get(f.key);
      const nowSettings = now === undefined ? null : calculatedSettingsOf(now);
      if (
        nowSettings !== null &&
        nowSettings.expression === was.expression &&
        nowSettings.resultUnitKind === was.resultUnitKind
      )
        continue;
      const stored = await db
        .selectFrom("form_custom_value")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("transformation_id", "=", input.transformationId)
        .where("record_type", "=", rt.code)
        .executeTakeFirstOrThrow();
      if (Number(stored.n) === 0) continue;
      out.push({
        itemKind: "invalidated_calculation",
        elementType: "form_field",
        stableKey: `${rt.code}.${f.key}`,
        recordType: rt.table_name,
        resolution: "acknowledged",
        detail: {
          recordTypeCode: rt.code,
          fieldKey: f.key,
          fromExpression: was.expression,
          toExpression: nowSettings?.expression ?? null,
        },
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ database guards

/**
 * The 0068 guard names mapped to the ADR-0041 §10 refusals (the API refuses first; a guard reached under a race or a
 * programming error answers the same code, or 500 where no user action can reach it).
 */
export function mapFormDbError(error: unknown): HttpProblem | null {
  const e = error as { code?: string; constraint?: string };
  switch (e.constraint ?? "") {
    case "methodology_element_source_field_protected":
      return formRefusals.sourceColumnProtected();
    case "methodology_element_source_field_type_fixed":
      return formRefusals.sourceColumnTypeFixed();
    case "methodology_element_extension_field_key":
      return formRefusals.extensionKeyInvalid();
    case "methodology_element_field_type":
      return formRefusals.fieldTypeUnknown();
    case "methodology_element_field_settings":
      return formRefusals.fieldSettingsInvalid();
    case "methodology_element_form_fixed":
      return formRefusals.formFixed();
    case "form_custom_value_unknown_field":
      return formRefusals.customFieldUnknown();
    case "form_custom_value_record_type":
      return formRefusals.extensionsNotAllowed();
    case "form_custom_value_type_shape":
    case "form_custom_value_size":
      return problems.validation([], "The request is not valid.");
    case "form_custom_value_record_ref":
      return problems.notFound();
    default:
      return null;
  }
}

/** The eleven field types (re-exported for the forms routes' docs and tests). */
export const FORM_FIELD_TYPES: readonly FieldType[] = FIELD_TYPES;

/** Registers the form_schema provider hooks (idempotent replacement; called when the forms module registers). */
export function registerFormsKindProvider(): void {
  registerConfigKindProvider("form_schema", {
    defaultKey: "forms",
    catalogue,
    validateElement,
    validateRemove,
    compatibility,
    affectedRecords,
    preview,
    migrationItems,
  });
}
