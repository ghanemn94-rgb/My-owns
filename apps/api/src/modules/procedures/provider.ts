// The `procedure` configuration kind's provider (ADR-0042 §1-§2; ADR-0039 §1, §5; REQ-S06-001; p5-work-split §C.1;
// T-DG5-BE-F). Registered into methodology's ConfigKindProvider registry when the procedures module registers
// (methodology imports no P5 module). Procedure definitions are typed rows (procedure_definition,
// procedure_step_definition), not methodology_element rows, so the kind accepts no element type and this provider
// supplies the pipeline's per-kind hooks over those rows:
//  - no default key (see registerProceduresKindProvider);
//  - diffRows: one row per added, removed or changed definition (`procedure`, stable key = code) and step
//    (`procedure_step`, stable key = `<code>.<stepKey>`), with the typed columns as attributes (ADR-0042 §1);
//  - compatibility: every stored definition is re-validated with the builder rules (ADR-0042 §1-§2): an invalid one is
//    a `fail` (blocks publish) with its §10 code; the pipeline's own classification warns on every changed or removed
//    definition and step;
//  - affectedRecords: per lineage transformation, the active procedure instances of each changed procedure (they stay
//    pinned; Unknown is never shown as 0);
//  - preview: each sample `{kind: "record", recordType: <procedure code>, input: {inputValues}}` validates the input
//    values against the definition's input schema (ADR-0041 §3 validators) and evaluates every step condition
//    (decimal.js), reporting which steps would run, which are not applicable and which required inputs are missing;
//    a stored definition that no longer validates fails the run.
// The copy of rows into a new draft and the hash rows are in definitions.ts (lineage rows; see its header).
// Configuration only: nothing here grants a business approval.
import type { DbOrTx } from "@mth/db";
import { defineField, validateRecordValues, type FieldDefinition } from "@mth/shared/calc";
import { evaluateStepCondition, type ConfigElementType, type ConfigPreviewRequest } from "@mth/shared/schemas";
import {
  registerConfigKindProvider,
  type AffectedRecordCount,
  type CompatibilityFinding,
  type ConfigElementChange,
  type PreviewOutcome,
} from "../methodology/index.ts";
import {
  definitionAttributes,
  inputFieldAttributes,
  inputSchemaOf,
  loadDefinitions,
  loadProcedureVersion,
  presentStep,
  stepAttributes,
  toDefinitionInput,
  validateDefinitionBody,
  type DefinitionWithSteps,
} from "./definitions.ts";

/**
 * The element types of this kind's diff and findings. They are not methodology_element types (the kind accepts none),
 * so they are outside `ConfigElementType`; the pipeline carries them as strings (OpenAPI `ConfigDiffEntry.elementType`
 * is a string). Proposed to the orchestrator as a shared type widening in the BE-F handback.
 */
const PROCEDURE_TYPE = "procedure" as unknown as ConfigElementType;
const STEP_TYPE = "procedure_step" as unknown as ConfigElementType;

type Keyed = Map<string, { type: ConfigElementType; attrs: Record<string, unknown> }>;

function keyed(defs: readonly DefinitionWithSteps[]): Keyed {
  const out: Keyed = new Map();
  for (const d of defs) {
    if (d.row.removed) continue;
    out.set(`${PROCEDURE_TYPE}\u0000${d.row.code}`, {
      type: PROCEDURE_TYPE,
      attrs: { ...definitionAttributes(d.row), ordinal: d.row.ordinal },
    });
    for (const s of d.steps)
      if (!s.removed)
        out.set(`${STEP_TYPE}\u0000${d.row.code}.${s.step_key}`, {
          type: STEP_TYPE,
          attrs: { ...stepAttributes(s), ordinal: s.ordinal },
        });
  }
  return out;
}

async function allDefinitions(db: DbOrTx, versionId: string): Promise<DefinitionWithSteps[]> {
  return loadDefinitions(db, await loadProcedureVersion(db, versionId), {
    includeRemoved: true,
    includeRemovedSteps: true,
  });
}

// ------------------------------------------------------------------------------------------------ diff

async function diffRows(
  db: DbOrTx,
  input: { readonly versionId: string; readonly againstVersionId: string },
): Promise<ConfigElementChange[]> {
  const [to, from] = await Promise.all([
    allDefinitions(db, input.versionId),
    allDefinitions(db, input.againstVersionId),
  ]);
  const a = keyed(from);
  const b = keyed(to);
  const out: ConfigElementChange[] = [];
  for (const k of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(k);
    const y = b.get(k);
    const stableKey = k.slice(k.indexOf("\u0000") + 1);
    if (x === undefined && y !== undefined)
      out.push({ elementType: y.type, stableKey, change: "added", from: null, to: y.attrs });
    else if (x !== undefined && y === undefined)
      out.push({ elementType: x.type, stableKey, change: "removed", from: x.attrs, to: null });
    else if (x !== undefined && y !== undefined && JSON.stringify(x.attrs) !== JSON.stringify(y.attrs))
      out.push({ elementType: y.type, stableKey, change: "changed", from: x.attrs, to: y.attrs });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ compatibility

const codeOfChange = (c: Pick<ConfigElementChange, "stableKey">): string => c.stableKey.split(".")[0] ?? c.stableKey;

async function activeInstanceCounts(
  db: DbOrTx,
  key: string,
  codes: readonly string[],
): Promise<{ transformation_id: string | null; procedure_code: string; n: number }[]> {
  if (codes.length === 0) return [];
  const rows = await db
    .selectFrom("procedure_instance as i")
    .innerJoin("methodology_version as v", "v.id", "i.methodology_version_id")
    .select(["i.transformation_id", "i.procedure_code", (eb) => eb.fn.countAll<string>().as("n")])
    .where("v.key", "=", key)
    .where("i.status", "=", "active")
    .where("i.procedure_code", "in", [...codes])
    .groupBy(["i.transformation_id", "i.procedure_code"])
    .execute();
  return rows.map((r) => ({
    transformation_id: r.transformation_id,
    procedure_code: r.procedure_code,
    n: Number(r.n),
  }));
}

async function compatibility(db: DbOrTx, input: { readonly versionId: string }): Promise<CompatibilityFinding[]> {
  const version = await loadProcedureVersion(db, input.versionId);
  const defs = await loadDefinitions(db, version);
  const out: CompatibilityFinding[] = [];
  for (const d of defs)
    for (const f of validateDefinitionBody(toDefinitionInput(d)))
      out.push({
        severity: "fail",
        code: f.code,
        elementType: PROCEDURE_TYPE,
        stableKey: d.row.code,
        params: { pointer: f.pointer },
      });
  return out;
}

// ------------------------------------------------------------------------------------------------ affected records

async function affectedRecords(
  db: DbOrTx,
  input: {
    readonly versionId: string;
    readonly changes: readonly ConfigElementChange[];
    readonly transformationIds: readonly string[];
  },
): Promise<AffectedRecordCount[]> {
  const version = await loadProcedureVersion(db, input.versionId);
  const codes = [...new Set(input.changes.map(codeOfChange))].sort();
  if (codes.length === 0) return [];
  const counts = await activeInstanceCounts(db, version.key, codes);
  const byTransformation = new Map<string, number>();
  for (const c of counts)
    if (c.transformation_id !== null)
      byTransformation.set(c.transformation_id, (byTransformation.get(c.transformation_id) ?? 0) + c.n);
  return input.transformationIds.map((t) => ({
    transformationId: t,
    recordType: "procedure_instance",
    count: byTransformation.get(t) ?? 0,
    unknownReason: null,
  }));
}

// ------------------------------------------------------------------------------------------------ preview

/** The validator definitions of a stored input schema (required is reported as "missing", not as a failure). */
function inputDefinitions(d: DefinitionWithSteps): FieldDefinition[] {
  const out: FieldDefinition[] = [];
  for (const f of inputSchemaOf(d.row)) {
    const def = defineField(f.key, f.fieldType, inputFieldAttributes(f), { required: false });
    if (def.ok) out.push(def.field);
  }
  return out;
}

async function preview(
  db: DbOrTx,
  input: { readonly versionId: string; readonly samples: unknown },
): Promise<PreviewOutcome> {
  const version = await loadProcedureVersion(db, input.versionId);
  const defs = await loadDefinitions(db, version);
  const byCode = new Map(defs.map((d) => [d.row.code, d]));
  const invalid = defs.flatMap((d) =>
    validateDefinitionBody(toDefinitionInput(d)).map((f) => ({
      procedure: d.row.code,
      code: f.code,
      pointer: f.pointer,
    })),
  );
  const samples = input.samples as ConfigPreviewRequest["samples"];
  const results: Record<string, unknown>[] = [];
  for (const [index, s] of samples.entries()) {
    const d = s.kind === "record" && s.recordType !== undefined ? byCode.get(s.recordType) : undefined;
    if (s.kind !== "record") {
      results.push({ index, kind: s.kind, result: "fail", code: "preview.sample_not_supported" });
      continue;
    }
    if (d === undefined) {
      results.push({ index, kind: s.kind, result: "fail", code: "preview.sample_invalid" });
      continue;
    }
    const raw = new Map(Object.entries(s.input));
    const values = raw.has("inputValues") ? raw.get("inputValues") : s.input;
    const v = validateRecordValues(inputDefinitions(d), values);
    if (!v.ok) {
      results.push({
        index,
        kind: s.kind,
        recordType: d.row.code,
        result: "fail",
        code: v.status === 400 ? "validation" : v.code,
        fields: v.problems.map((p) => ({ field: p.field, code: p.code })),
      });
      continue;
    }
    const given = v.values as Record<string, unknown>;
    const present = (k: string) => {
      const x = new Map(Object.entries(given)).get(k);
      return x !== undefined && x !== null && x !== "";
    };
    const missingInputs = inputSchemaOf(d.row)
      .filter((f) => f.required && !present(f.key))
      .map((f) => ({ key: f.key, labelEn: f.labelEn, labelAr: f.labelAr }));
    const steps = d.steps.map((st) => {
      const p = presentStep(st);
      const runs = p.condition === null ? true : evaluateStepCondition(p.condition, given);
      return {
        stepKey: p.stepKey,
        ordinal: p.ordinal,
        parallelGroup: p.parallelGroup,
        stepKind: p.stepKind,
        status: runs ? "applicable" : "not_applicable",
        missingInputs: p.requiredInputKeys.filter((k) => !present(k)),
      };
    });
    results.push({ index, kind: s.kind, recordType: d.row.code, result: "pass", missingInputs, steps });
  }
  const failed = results.filter((r) => r["result"] === "fail").length;
  return {
    result: failed === 0 && invalid.length === 0 ? "pass" : "fail",
    report: { evaluated: results.length, failed, invalidDefinitions: invalid, results },
  };
}

/** Registers the procedure provider hooks (idempotent replacement; called when the procedures module registers). */
export function registerProceduresKindProvider(): void {
  // No default key is registered: a transformation does not resolve a `procedure` version (instances pin the exact
  // definition row they launched from, ADR-0042 §3), and listTransformationConfigPins keeps its three kinds. Whether
  // `procedures` becomes the kind's default key (so getConfigAffectedRecords lists unpinned transformations and their
  // active instances) is an orchestrator decision named in the BE-F handback.
  registerConfigKindProvider("procedure", {
    diffRows,
    compatibility,
    affectedRecords,
    preview,
  });
}
