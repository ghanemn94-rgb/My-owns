// KPI formulas and the KPI reference graph (ADR-0027 §4, ADR-0028 §8; REQ-S07-011; T-DG4-KBE-B). No routes of its own:
// kpi-versions.ts calls these checks when a formula version is created and when any version is activated.
//
//   - Units: the formula is validated by the DG3 engine through KBE-A's binding (`validateKpiFormula`, which types each
//     variable from its source KPI and requires the result type to equal the KPI's own). The engine's own refusals pass
//     through with their ADR-0024 §6 codes and texts (SAR + count = 422 formula.kind_mismatch); a result in another unit
//     is 422 kpi_formula.unit_mismatch. The engine (packages/shared/src/formula/**) is used unchanged (S-9).
//   - Inputs: each variable names a KPI of the same transformation (422 kpi_formula.input_unknown_kpi).
//   - Cycles: under the kpiFormulaGraph advisory lock (key: the transformation id; the class the kpi_formula_input and kpi_version
//     triggers take), the graph whose edges are "KPI X's ACTIVE version reads KPI Y" is walked from each input; an input
//     that is the KPI itself, or reaches it, is 422 kpi_formula.circular naming the path ("A → B → A"). On activation the
//     KPI's own active version (the one being replaced) is ignored. The database triggers run the same rule as the
//     last line (constraint kpi_formula_no_cycle).
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { validateKpiFormula, type KpiFormulaInputBinding, type KpiTypeSource } from "@mth/shared/calc";
import type { KpiFormulaInput } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { ADVISORY_LOCK_CLASSES, type ModuleDeps } from "../platform/index.ts";
import { ruleProblem } from "./support.ts";

/** The typing fields of a KPI definition (unit kind, currency and frequency are fixed once it has a version). */
interface KpiTypeRow {
  readonly id: string;
  readonly name: string;
  readonly unit_kind: string;
  readonly unit_label: string | null;
  readonly currency: string | null;
  readonly frequency: string;
}

export function kpiTypeOf(row: Pick<KpiTypeRow, "unit_kind" | "unit_label" | "currency" | "frequency">): KpiTypeSource {
  return {
    unitKind: row.unit_kind as KpiTypeSource["unitKind"],
    unitLabel: row.unit_label,
    currency: row.currency === null ? null : row.currency.trim(),
    frequency: row.frequency as KpiTypeSource["frequency"],
  };
}

/** Takes the KPI formula graph lock of a transformation (ADVISORY_LOCK_CLASSES.kpiFormulaGraph; the database triggers take the same). */
export async function lockFormulaGraph(tx: Tx, transformationId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.kpiFormulaGraph}::integer, hashtext(${transformationId}))`.execute(
    tx,
  );
}

const circular = (path: string, pointer: string) =>
  ruleProblem({
    code: "kpi_formula.circular",
    detail: `The formula would create a circular reference: ${path}.`,
    pointer,
  });

/**
 * Validates a formula version's expression and inputs against the engine (units) and the transformation's KPIs. Throws
 * the first refusal as a 422; writes nothing.
 */
export async function checkKpiFormula(
  tx: Tx,
  transformationId: string,
  kpi: KpiTypeRow,
  expression: string,
  inputs: readonly KpiFormulaInput[],
): Promise<void> {
  const names = new Set<string>();
  for (const [i, input] of inputs.entries()) {
    if (names.has(input.variableName))
      throw ruleProblem({
        code: "validation.constraint",
        detail: `The formula input ${input.variableName} is listed twice.`,
        pointer: `/formulaInputs/${i}/variableName`,
      });
    names.add(input.variableName);
  }
  const ids = [...new Set(inputs.map((i) => i.sourceKpiDefinitionId))];
  const sources =
    ids.length === 0
      ? []
      : await tx
          .selectFrom("kpi_definition")
          .select(["id", "name", "unit_kind", "unit_label", "currency", "frequency"])
          .where("transformation_id", "=", transformationId)
          .where("id", "in", ids)
          .execute();
  const byId = new Map(sources.map((s) => [s.id, s]));
  const bindings: KpiFormulaInputBinding[] = [];
  for (const [i, input] of inputs.entries()) {
    const source = byId.get(input.sourceKpiDefinitionId);
    if (!source)
      throw ruleProblem({
        code: "kpi_formula.input_unknown_kpi",
        detail: `The formula input ${input.variableName} must name a KPI of this transformation.`,
        pointer: `/formulaInputs/${i}/sourceKpiDefinitionId`,
      });
    bindings.push({
      variableName: input.variableName,
      source: kpiTypeOf(source),
      inputBasis: input.inputBasis,
      sourceKpiDefinitionId: source.id,
    });
  }
  const v = validateKpiFormula(expression, bindings, kpiTypeOf(kpi));
  if (!v.ok) {
    const first = v.errors[0]!;
    const pointer = first.code === "formula.invalid_variable" ? "/formulaInputs" : "/formulaExpression";
    throw ruleProblem({ code: first.code, detail: first.message, pointer });
  }
}

/**
 * The edges of the active graph of a transformation: KPI definition id -> the KPI ids its active version reads.
 * `skip` (the KPI whose active version is being replaced) contributes no edges.
 */
async function activeEdges(tx: Tx, transformationId: string, skip: string): Promise<Map<string, string[]>> {
  const rows = await tx
    .selectFrom("kpi_formula_input as i")
    .innerJoin("kpi_version as v", "v.id", "i.kpi_version_id")
    .select(["v.kpi_definition_id as from_id", "i.source_kpi_definition_id as to_id"])
    .where("v.transformation_id", "=", transformationId)
    .where("v.status", "=", "active")
    .where("v.kpi_definition_id", "<>", skip)
    .orderBy("i.variable_name")
    .execute();
  const edges = new Map<string, string[]>();
  for (const r of rows) edges.set(r.from_id, [...(edges.get(r.from_id) ?? []), r.to_id]);
  return edges;
}

/** A path from `from` to `target` through `edges` (breadth-first, so the shortest), or null. */
export function findPath(edges: ReadonlyMap<string, readonly string[]>, from: string, target: string): string[] | null {
  if (from === target) return [from];
  const previous = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of edges.get(node) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, node);
      if (next === target) {
        const path = [next];
        let at = next;
        while (at !== from) {
          at = previous.get(at)!;
          path.unshift(at);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Refuses (422 kpi_formula.circular, naming the path by KPI names) an input of `kpiDefinitionId` that is the KPI
 * itself or reaches it through the active graph. Takes the graph lock first.
 */
export async function assertNoFormulaCycle(
  tx: Tx,
  transformationId: string,
  kpiDefinitionId: string,
  sourceIds: readonly string[],
  pointer: string,
): Promise<void> {
  if (sourceIds.length === 0) return;
  await lockFormulaGraph(tx, transformationId);
  const edges = await activeEdges(tx, transformationId, kpiDefinitionId);
  for (const source of sourceIds) {
    const tail = findPath(edges, source, kpiDefinitionId);
    if (tail === null) continue;
    const ids = [kpiDefinitionId, ...tail];
    const names = await tx
      .selectFrom("kpi_definition")
      .select(["id", "name"])
      .where("id", "in", [...new Set(ids)])
      .execute();
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    throw circular(ids.map((id) => nameOf.get(id) ?? id).join(" → "), pointer);
  }
}

/** Inserts the formula inputs of a new draft version (append-only; the trigger re-checks the cycle rule). */
export async function insertFormulaInputs(
  tx: Tx,
  ids: { organizationId: string; transformationId: string; kpiVersionId: string; userId: string },
  inputs: readonly KpiFormulaInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  await tx
    .insertInto("kpi_formula_input")
    .values(
      inputs.map((i) => ({
        id: uuidv7(),
        organization_id: ids.organizationId,
        transformation_id: ids.transformationId,
        kpi_version_id: ids.kpiVersionId,
        variable_name: i.variableName,
        source_kpi_definition_id: i.sourceKpiDefinitionId,
        input_basis: i.inputBasis,
        created_by: ids.userId,
      })),
    )
    .execute();
}

/** Formula inputs of versions, by version id, in variable-name order. */
export async function formulaInputsOf(
  tx: DbOrTx,
  versionIds: readonly string[],
): Promise<
  Map<string, { variableName: string; sourceKpiDefinitionId: string; inputBasis: "period" | "cumulative" }[]>
> {
  const out = new Map<
    string,
    { variableName: string; sourceKpiDefinitionId: string; inputBasis: "period" | "cumulative" }[]
  >();
  if (versionIds.length === 0) return out;
  const rows = await tx
    .selectFrom("kpi_formula_input")
    .select(["kpi_version_id", "variable_name", "source_kpi_definition_id", "input_basis"])
    .where("kpi_version_id", "in", [...versionIds])
    .orderBy("variable_name")
    .execute();
  for (const r of rows)
    out.set(r.kpi_version_id, [
      ...(out.get(r.kpi_version_id) ?? []),
      {
        variableName: r.variable_name,
        sourceKpiDefinitionId: r.source_kpi_definition_id,
        inputBasis: r.input_basis as "period" | "cumulative",
      },
    ]);
  return out;
}

/** No routes of its own: kpi-versions.ts calls the checks above (create and activate). */
export function registerKpiFormulaRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
