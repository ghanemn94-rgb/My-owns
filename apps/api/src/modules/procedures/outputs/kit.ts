// The output-adapter kit (ADR-0042 §3; p5-work-split §C.3; T-DG5-BE-G): the checks every adapter of procedures/outputs/**
// shares. An adapter is called by the step engine (steps.ts) inside the step-completion transaction, under the procedureInstanceStep advisory lock,
// after the engine re-authorized the acting person on grants reloaded in that transaction.
//
// WHAT AN ADAPTER DOES, AND WHAT IT NEVER DOES. ADR-0042 §3 has each adapter call the owning module's exported service
// with the acting user. procedures may import only platform, audit, access, organization, transformations,
// methodology, forms, evidence and tasks (modules.ts; the architecture test forbids a P5 module importing workflows),
// and the owning modules of most output types (kpi, workflows, portfolio, benefits, governance, sustainment) export no
// create/decide service. p5-work-split §C.3 says a missing exported service is requested in the handback and NEVER
// re-implemented. So every adapter here VERIFIES AND LINKS: the person produces the record through the owning
// module's own operation (every DG2-DG4 rule, permission, separation of duties and audit event applies there), then
// completes the step naming it in `outputRecordId`; the adapter checks, read-only, that it is the record the step
// expects, and the engine links it (procedure_instance_link; the 0069 guard procedure_instance_link_record_ref repeats
// the type-and-scope check). Nothing here writes a domain table, decides an approval, or grants a business approval:
//   - create:  the record is of the step's type, in the instance's scope, produced since the instance was launched
//              (by whoever holds the right in the owning module: e.g. a baseline is recorded by a baseline.edit holder),
//              not already another instance's output, and in a state that shows it was produced (a KPI actual
//              submitted, a Finance validation decided);
//   - advance: the record an earlier step of this instance linked, now in the state this step records (a baseline
//              validated, a gate submission decided, a change request decided, a handover accepted, ...);
//   - link:    the record is of the step's type and in scope (and complete where the step says so).
// The refusals are the ADR-0042 §10 codes: no record named -> 422 procedure_step.output_required; a record that is not
// of the type, not in scope, or not produced by this step -> 422 procedure_step.output_record_invalid; a record that
// has not reached the state the step records -> 422 procedure_step.output_required (the handback proposes a narrower
// code). The whole completion rolls back on any refusal.
import { sql } from "@mth/db";
import { problems, type HttpProblem } from "../../platform/index.ts";
import type { ProcedureOutputAdapter, ProcedureOutputContext } from "../steps.ts";

/** The exact ADR-0042 §10 texts this kit raises (the same as steps.ts's PROCEDURE_INSTANCE_MESSAGES). */
export const OUTPUT_MESSAGES = {
  "procedure_step.output_required": "This step must produce or link its output record.",
  "procedure_step.output_record_invalid": "The linked record is not of the expected type or not in this scope.",
} as const;

export function outputRequired(): HttpProblem {
  return problems.businessRule("procedure_step.output_required", OUTPUT_MESSAGES["procedure_step.output_required"]);
}

export function outputRecordInvalid(): HttpProblem {
  return problems.businessRule(
    "procedure_step.output_record_invalid",
    OUTPUT_MESSAGES["procedure_step.output_record_invalid"],
  );
}

/** The record the person named (`outputRecordId`), or 422 output_required. */
export function namedRecord(ctx: ProcedureOutputContext): string {
  if (ctx.outputRecordId === null) throw outputRequired();
  return ctx.outputRecordId;
}

/**
 * The record an earlier step of this instance linked as its output of `recordType` (an `advance` acts on it), or
 * 422 output_required when no earlier step produced one.
 */
export function earlierOutput(ctx: ProcedureOutputContext, recordType: string): string {
  const link = ctx.links.find(
    (l) => l.link_kind === "output" && l.record_type === recordType && l.step_instance_id !== ctx.step.id,
  );
  if (link === undefined) throw outputRequired();
  return link.record_id;
}

/** The record an earlier step linked, if any (e.g. the transformation an intake created). */
export function earlierOutputOrNull(ctx: ProcedureOutputContext, recordType: string): string | null {
  return (
    ctx.links.find(
      (l) => l.link_kind === "output" && l.record_type === recordType && l.step_instance_id !== ctx.step.id,
    )?.record_id ?? null
  );
}

/** A record row's common facts, as each adapter reads them from its own table. */
export interface RecordFacts {
  readonly transformationId: string;
  readonly organizationId: string;
  readonly createdBy: string;
  readonly createdAt: Date | string;
}

/**
 * The common scope check: the record exists, is in the instance's organization and transformation (an
 * organization-scope instance: in the transformation an earlier step produced, when there is one), else 422
 * output_record_invalid. Returns the facts for the caller's further checks.
 */
export function inScope<T extends RecordFacts>(ctx: ProcedureOutputContext, row: T | undefined): T {
  if (row === undefined) throw outputRecordInvalid();
  if (row.organizationId !== ctx.instance.organization_id) throw outputRecordInvalid();
  if (ctx.instance.transformation_id !== null) {
    if (row.transformationId !== ctx.instance.transformation_id) throw outputRecordInvalid();
  } else {
    const produced = earlierOutputOrNull(ctx, "transformation");
    if (produced !== null && row.transformationId !== produced) throw outputRecordInvalid();
  }
  return row;
}

/**
 * The `create` check: the record was produced (through the owning module's operation, by whoever holds that right
 * there) since the instance was launched, and no other procedure instance already took it as its output. A record that
 * existed before the launch is not this step's output (a step that reuses one uses `link`).
 */
export async function producedHere(
  ctx: ProcedureOutputContext,
  recordId: string,
  producedAt: Date | string,
): Promise<void> {
  if (new Date(producedAt).getTime() < new Date(ctx.instance.launched_at).getTime()) throw outputRecordInvalid();
  const elsewhere = await ctx.tx
    .selectFrom("procedure_instance_link")
    .select("id")
    .where("link_kind", "=", "output")
    .where("record_type", "=", ctx.stepDefinition.output_record_type ?? "")
    .where("record_id", "=", recordId)
    .where("procedure_instance_id", "<>", ctx.instance.id)
    .executeTakeFirst();
  if (elsewhere !== undefined) throw outputRecordInvalid();
}

// ------------------------------------------------------------------------------------------------ the adapter factory

/** The output record types (the closed set of ADR-0042 §3, CHECK on both 0069 tables) that have a domain table. */
export type OutputTable =
  | "transformation"
  | "charter"
  | "baseline"
  | "kpi_actual"
  | "tom_canvas_cell"
  | "ranking_snapshot"
  | "gate_submission"
  | "change_request"
  | "finance_validation"
  | "decision"
  | "bau_handover"
  | "evidence";

/** One record as an adapter reads it: the common facts plus the state columns its spec names. */
export type OutputRecord = RecordFacts & { readonly state: Readonly<Record<string, unknown>> };

/**
 * The declarative spec of one adapter: the record type (= its table), the state columns it reads, and the state each
 * mode requires. `producedAt` names when the record was produced (default: created_at); `created`,
 * `advanced` and `linked` are the state predicates of the three modes (an omitted one accepts any state). An `advance`
 * always acts on the record an earlier step of the instance linked.
 */
export interface OutputSpec {
  readonly recordType: OutputTable;
  readonly stateColumns: readonly string[];
  readonly producedAt?: (r: OutputRecord) => Date | string | null;
  readonly created?: (r: OutputRecord, ctx: ProcedureOutputContext) => boolean;
  readonly advanced?: (r: OutputRecord) => boolean;
  readonly linked?: (r: OutputRecord) => boolean;
}

/** Reads one record of `table` with its common facts and state columns (read-only; never a domain write). */
export async function readOutputRecord(
  ctx: ProcedureOutputContext,
  table: OutputTable,
  id: string,
  stateColumns: readonly string[],
): Promise<OutputRecord | undefined> {
  const transformationColumn = table === "transformation" ? "id" : "transformation_id";
  const extra = stateColumns.length === 0 ? sql`` : sql`, ${sql.join(stateColumns.map((c) => sql.ref(c)))}`;
  const res = await sql<Record<string, unknown>>`
    SELECT organization_id, ${sql.ref(transformationColumn)} AS transformation_id, created_by, created_at ${extra}
      FROM ${sql.table(table)} WHERE id = ${id}`.execute(ctx.tx);
  const row = res.rows[0];
  if (row === undefined) return undefined;
  const state: Readonly<Record<string, unknown>> = Object.fromEntries(
    Object.entries(row).filter(([column]) => stateColumns.includes(column)),
  );
  return {
    organizationId: row["organization_id"] as string,
    transformationId: row["transformation_id"] as string,
    createdBy: row["created_by"] as string,
    createdAt: row["created_at"] as Date | string,
    state,
  };
}

/** Builds the adapter of one spec (create / advance / link, as the kit's header describes). */
export function outputAdapter(spec: OutputSpec): ProcedureOutputAdapter {
  return {
    recordType: spec.recordType,
    produce: async (ctx) => {
      const id = ctx.mode === "advance" ? earlierOutput(ctx, spec.recordType) : namedRecord(ctx);
      const row = inScope(ctx, await readOutputRecord(ctx, spec.recordType, id, spec.stateColumns));
      if (ctx.mode === "create") {
        const at = spec.producedAt === undefined ? row.createdAt : spec.producedAt(row);
        if (at === null) throw outputRequired();
        await producedHere(ctx, id, at);
        if (spec.created !== undefined && !spec.created(row, ctx)) throw outputRequired();
      } else if (ctx.mode === "advance") {
        // An advance step names nothing, or the same record the earlier step produced.
        if (ctx.outputRecordId !== null && ctx.outputRecordId !== id) throw outputRecordInvalid();
        if (spec.advanced !== undefined && !spec.advanced(row)) throw outputRequired();
      } else if (spec.linked !== undefined && !spec.linked(row)) {
        throw outputRecordInvalid();
      }
      return { recordId: id };
    },
  };
}
