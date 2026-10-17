// The output record of a procedure step, chosen in the UI (T-DG5-FE-D4; D-166; REQ-S06-002, REQ-S06-003, REQ-S18-004;
// ADR-0042 §3; docs/api/openapi.yaml `ProcedureStepComplete`).
//
// The output adapters VERIFY AND LINK; they never produce a record. For a `create` output the person first produces the
// record natively, on its owning module's own screen (with that module's permissions, rules and audit event), and then
// completes the step naming it in `outputRecordId`. A `link` output names an existing record. An `advance` output names
// nothing: the record an earlier step linked must have reached the state this step records.
//
// This file is the table of the closed set of output record types (ADR-0042 §3): for each one, the record type's OWN
// list operation (the only read used to offer records), its native screen, a label, and a pre-filter mirroring the
// adapter's state rules (apps/api/src/modules/procedures/outputs/**). The pre-filter only narrows the choice; the
// server re-checks every rule and answers 422 procedure_step.output_required / output_record_invalid by code.
// `approval` is never chosen here: an approval step's output is its own canonical business approval, linked by the
// engine when the business approver decides (nothing here decides or grants a business approval).
import type { ProcedureDefinition } from "@mth/shared/schemas";
import type { ProcedureInstance } from "./api.ts";

export type OutputMode = "create" | "advance" | "link";
export type OutputRecordType = NonNullable<ProcedureDefinition["steps"][number]["output"]>["recordType"];
export type OutputRow = Readonly<Record<string, unknown>>;

/** How a record type's own list operation is read. */
export type OutputSourceKind = "page" | "charter" | "tomCanvas" | "transformations";

export interface OutputSource {
  /** The record type's own list operation (relative to the transformation unless `kind` is "transformations"). */
  readonly kind: OutputSourceKind;
  /** The resource under `/api/v1/transformations/{tid}/`, or null when it cannot be listed yet (a gate not named). */
  readonly resource: (gateCode: string | null) => string | null;
  /** The native screen where the record is produced (a web route). */
  readonly native: (tid: string | null, gateCode: string | null) => string | null;
  /** When the record was produced (the adapter's `producedAt`; default `createdAt`). */
  readonly producedAt: (row: OutputRow) => string | null;
  /** The adapter's `create` state rule (an omitted rule accepts any state). */
  readonly created?: (row: OutputRow) => boolean;
  /** The adapter's `link` state rule. */
  readonly linked?: (row: OutputRow) => boolean;
  /** The record's label (data, shown as is: codes, titles, metrics). */
  readonly label: (row: OutputRow) => string;
}

const str = (row: OutputRow, key: string): string | null => {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null;
};
const statusIn =
  (...statuses: string[]) =>
  (row: OutputRow): boolean =>
    statuses.includes(str(row, "status") ?? "");
const join = (...parts: (string | null)[]) => parts.filter((p): p is string => p !== null).join(" · ");
const at = (key: string) => (row: OutputRow) => str(row, key);
const route = (tid: string | null, suffix: string) => (tid ? `/transformations/${tid}/${suffix}` : null);

/** The closed set of ADR-0042 §3 (except `approval`, the engine's own). */
export const OUTPUT_SOURCES: Readonly<Record<Exclude<OutputRecordType, "approval">, OutputSource>> = {
  transformation: {
    kind: "transformations",
    resource: () => "transformations",
    native: () => "/transformations/new",
    producedAt: at("createdAt"),
    label: (r) => join(str(r, "code"), str(r, "name")),
  },
  charter: {
    kind: "charter",
    resource: () => "charter",
    native: (tid) => route(tid, "charter"),
    producedAt: at("createdAt"),
    label: (r) => join(str(r, "transformationName"), str(r, "version") ? `v${str(r, "version")}` : null),
  },
  baseline: {
    kind: "page",
    resource: () => "baselines",
    native: (tid) => (tid ? `/transformations/${tid}/diagnose#baselines` : null),
    producedAt: at("createdAt"),
    created: statusIn("active"),
    label: (r) => join(str(r, "metric"), join(str(r, "value"), str(r, "unit")) || null, str(r, "baselineDate")),
  },
  kpi_actual: {
    kind: "page",
    resource: () => "kpi-actual-reviews",
    native: (tid) => route(tid, "kpis"),
    producedAt: at("submittedAt"),
    created: statusIn("submitted", "accepted", "rejected"),
    label: (r) => join(str(r, "periodLabel"), str(r, "currentValueNo")),
  },
  tom_canvas_cell: {
    kind: "tomCanvas",
    resource: () => "tom-canvas",
    native: (tid) => route(tid, "design"),
    producedAt: at("createdAt"),
    linked: statusIn("ready"),
    label: (r) => join(str(r, "dimensionCode")),
  },
  ranking_snapshot: {
    kind: "page",
    resource: () => "prioritization/rankings",
    native: (tid) => route(tid, "prioritization"),
    producedAt: at("proposedAt"),
    created: statusIn("current"),
    label: (r) => join(str(r, "snapshotNo") ? `#${str(r, "snapshotNo")}` : null, str(r, "note")),
  },
  gate_submission: {
    kind: "page",
    resource: (gateCode) => (gateCode ? `gates/${gateCode}/submissions` : null),
    native: (tid, gateCode) => route(tid, gateCode ? `gates/${gateCode}` : "gates"),
    producedAt: at("submittedAt"),
    created: statusIn("pending", "decided"),
    label: (r) => join(str(r, "gateCode"), str(r, "submissionNo") ? `#${str(r, "submissionNo")}` : null),
  },
  change_request: {
    kind: "page",
    resource: () => "change-requests",
    native: (tid) => route(tid, "change-requests"),
    producedAt: at("createdAt"),
    created: (r) => !["draft", "withdrawn"].includes(str(r, "status") ?? ""),
    label: (r) => join(str(r, "code"), str(r, "reason")),
  },
  finance_validation: {
    kind: "page",
    resource: () => "finance-validations",
    native: (tid) => route(tid, "finance-validations"),
    producedAt: at("decidedAt"),
    created: statusIn("approved", "rejected"),
    label: (r) => join(str(r, "kind"), str(r, "approvedAmount"), (str(r, "id") ?? "").slice(0, 8) || null),
  },
  decision: {
    kind: "page",
    resource: () => "executive-decisions",
    native: (tid) => route(tid, "executive-decisions"),
    producedAt: at("createdAt"),
    created: statusIn("open", "decided", "deferred"),
    label: (r) => join(str(r, "code"), str(r, "decision")),
  },
  bau_handover: {
    kind: "page",
    resource: () => "bau-handovers",
    native: (tid) => route(tid, "bau-handovers"),
    producedAt: at("createdAt"),
    created: statusIn("draft", "submitted", "accepted"),
    label: (r) => join(str(r, "code")),
  },
  evidence: {
    kind: "page",
    resource: () => "evidence",
    native: (tid) => route(tid, "evidence"),
    producedAt: at("createdAt"),
    created: statusIn("active"),
    linked: statusIn("active"),
    label: (r) => join(str(r, "title")),
  },
};

/** The output a step must name in `outputRecordId` (create or link, not approval), or null (advance / none). */
export function chosenOutputOf(
  definition: ProcedureDefinition | null | undefined,
  stepKey: string,
): { recordType: Exclude<OutputRecordType, "approval">; mode: "create" | "link" } | null {
  const output = definition?.steps.find((s) => s.stepKey === stepKey)?.output ?? null;
  if (output === null || output.recordType === "approval") return null;
  if (output.mode !== "create" && output.mode !== "link") return null;
  return { recordType: output.recordType, mode: output.mode };
}

/**
 * The transformation whose records the step names (kit.inScope): the instance's own, or, for an organization-scope
 * instance, the transformation an earlier step produced; null when neither is known yet.
 */
export function scopeTransformationOf(i: ProcedureInstance): string | null {
  return (
    i.transformationId ??
    i.links.find((l) => l.linkKind === "output" && l.recordType === "transformation")?.recordId ??
    null
  );
}

/** The gate the instance names in its `gateCode` input (the gate_submission adapter reads the same input). */
export function gateCodeOf(i: ProcedureInstance): string | null {
  const v = i.inputValues["gateCode"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * The records offered for the step: the adapter's state rule for the mode, and for `create` produced since the
 * launch and not already an output of this instance. The server re-checks all of it (and that no other instance took
 * the record); this only narrows the list.
 */
export function eligibleRecords(
  rows: readonly OutputRow[],
  recordType: Exclude<OutputRecordType, "approval">,
  mode: "create" | "link",
  instance: Pick<ProcedureInstance, "launchedAt" | "links">,
): OutputRow[] {
  const source = OUTPUT_SOURCES[recordType];
  const launched = new Date(instance.launchedAt).getTime();
  const taken = new Set(
    instance.links.filter((l) => l.linkKind === "output" && l.recordType === recordType).map((l) => l.recordId),
  );
  return rows.filter((r) => {
    const id = str(r, "id");
    if (id === null) return false;
    if (mode === "link") return source.linked === undefined || source.linked(r);
    if (taken.has(id)) return false;
    const produced = source.producedAt(r);
    if (produced === null || new Date(produced).getTime() < launched) return false;
    return source.created === undefined || source.created(r);
  });
}

/** The body of `completeProcedureStep` (`ProcedureStepComplete`): the note when given, the output when chosen. */
export function completeBody(note: string, outputRecordId: string | null): { note?: string; outputRecordId?: string } {
  return {
    ...(note ? { note } : {}),
    ...(outputRecordId ? { outputRecordId } : {}),
  };
}
