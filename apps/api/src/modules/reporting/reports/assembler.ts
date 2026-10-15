// The Assembler interface, the registry and the value builders (ADR-0045 §1, §3, §5; p5-work-split §F.1, §F.11 items
// 2-4; T-DG5-KBE-C). One pure-read assembler per report definition turns the records of one transformation into the
// document model; the live view, a generated snapshot, the presentation and every export come from the same assembler,
// so nothing is typed into a report and no copy is edited separately (M0212).
//
// An assembler:
//  - reads only, inside the one REPEATABLE READ read-only transaction the snapshot service opens (`ctx.db`), so every
//    section reads the same database state at `ctx.asOf`;
//  - reads through the owning module's services or the same tables and filters as the owning list route, so a report
//    shows what the screen shows; it computes no new business number (totals with decimal.js only where the screen
//    shows one; value bases and currencies are never summed together);
//  - labels every value through provisional.ts and returns the source records (with their row `version` at the as-of
//    instant), the configuration and calculation versions, and the evidence it cites.
//
// Registry: KBE-C registers `charter` and `registers`; KBE-C2, KBE-D and KBE-D2 each add one line per assembler below
// (p5-work-split §F.2-§F.4). A definition without an assembler answers 404 until its task merges.
import type { Tx } from "@mth/db";
import type {
  ReportApprovalState,
  ReportDefinitionCode,
  ReportSection,
  ReportSourceApprovalState,
  ReportSubjectType,
  ReportUnitKind,
  ReportValidation,
  ReportValue,
  ReportValueBasis,
  ReportVersionKind,
} from "@mth/shared/schemas";
import { businessCasesAssembler } from "./assemblers/business-cases.ts";
import { charterAssembler } from "./assemblers/charter.ts";
import { diagnosticAssembler } from "./assemblers/diagnostic.ts";
import { executivePackAssembler } from "./assemblers/executive-pack.ts";
import { gatePackAssembler } from "./assemblers/gate-pack.ts";
import { registersAssembler } from "./assemblers/registers.ts";
import { roadmapAssembler } from "./assemblers/roadmap.ts";
import { tomAssembler } from "./assemblers/tom.ts";
import { NOT_APPLICABLE, UNKNOWN_MISSING, type ValueState } from "./provisional.ts";

// ------------------------------------------------------------------------------------------------ context and output

export interface AssemblyContext {
  /** The read-only REPEATABLE READ transaction of this assembly. */
  readonly db: Tx;
  readonly organizationId: string;
  readonly transformation: { readonly id: string; readonly code: string; readonly name: string };
  readonly subject: { readonly type: ReportSubjectType; readonly id: string };
  readonly period: {
    readonly id: string;
    readonly label: string;
    readonly start: string;
    readonly end: string;
  } | null;
  /** The parsed parameters (the assembler's own `parseParameters` output). */
  readonly parameters: unknown;
  /** The transaction time of the assembly (ISO 8601) and its business date in the transformation's time zone. */
  readonly asOf: string;
  readonly asOfDate: string;
}

/** A source record used by a section (`report_snapshot_source`). */
export interface SourceRecord {
  readonly sectionKey: string;
  readonly recordType: string;
  readonly recordId: string;
  readonly recordVersion: number;
  readonly recordUpdatedAt: Date | string | null;
  readonly approvalState: ReportSourceApprovalState | null;
  readonly validationState: ReportValidation;
}

/** A configuration or calculation version used (`report_snapshot_version`, besides the methodology row). */
export interface VersionRef {
  readonly versionKind: Exclude<ReportVersionKind, "methodology_version">;
  readonly referenceId: string | null;
  readonly referenceKey: string;
  readonly versionLabel: string;
}

/** An evidence item cited by a section (`report_snapshot_evidence`). */
export interface EvidenceRef {
  readonly sectionKey: string;
  readonly evidenceId: string;
  readonly contentId: string | null;
  readonly contentRevision: number | null;
  readonly contentSha256: string | null;
  readonly reviewStatus: "unverified" | "verified" | "rejected";
}

export interface AssembledOutput {
  readonly subject: { readonly code: string | null; readonly label: string };
  readonly approvalState: ReportApprovalState;
  readonly sections: readonly ReportSection[];
  readonly sources: readonly SourceRecord[];
  readonly versions: readonly VersionRef[];
  readonly evidence: readonly EvidenceRef[];
}

export interface Assembler {
  readonly code: ReportDefinitionCode;
  /** Parses the output's settings; throws report.parameters_invalid (definitions.ts `reportRefusals`). */
  parseParameters(raw: unknown): unknown;
  /** Assembles the document of `ctx.subject` (already checked to be a record of the transformation). */
  assemble(ctx: AssemblyContext): Promise<AssembledOutput>;
}

// ------------------------------------------------------------------------------------------------ registry

// Built on first use, not at module load: the assemblers import this file's value builders, so an eager Map would read
// them before their module finished evaluating when an assembler is imported first.
let registry: ReadonlyMap<ReportDefinitionCode, Assembler> | null = null;
function assemblers(): ReadonlyMap<ReportDefinitionCode, Assembler> {
  registry ??= new Map<ReportDefinitionCode, Assembler>([
    ["charter", charterAssembler],
    ["registers", registersAssembler],
    // KBE-C2 (p5-work-split §F.2): diagnostic, tom, business_cases, roadmap, gate_pack.
    ["diagnostic", diagnosticAssembler],
    ["tom", tomAssembler],
    ["business_cases", businessCasesAssembler],
    ["roadmap", roadmapAssembler],
    ["gate_pack", gatePackAssembler],
    // KBE-D (p5-work-split §F.3): executive_pack.
    ["executive_pack", executivePackAssembler],
    // KBE-D2: meeting_minutes, executive_dashboard, handover, meeting_pack.
  ]);
  return registry;
}

/** The assembler of a definition, or undefined while its task has not merged. */
export function assemblerOf(code: ReportDefinitionCode): Assembler | undefined {
  return assemblers().get(code);
}

/** The codes with an assembler (tests and the handback list them). */
export function assembledCodes(): ReportDefinitionCode[] {
  return [...assemblers().keys()];
}

// ------------------------------------------------------------------------------------------------ value builders

/**
 * The state of a value: a missing value is unknown (missing) unless the caller says the field is not applicable (n/a);
 * a present value takes the caller's state (default not_applicable, rule 6). Unknown and stale drop the number.
 */
function stateOf(present: boolean, state: ValueState | undefined): ValueState {
  if (present) return state ?? NOT_APPLICABLE;
  if (state !== undefined && (state.validation === "not_applicable" || noNumber(state))) return state;
  return UNKNOWN_MISSING;
}

/** A user-authored or system text; an absent text is unknown (missing). */
export function textValue(value: string | null, authored: "user" | "system" = "user", state?: ValueState): ReportValue {
  const s = stateOf(value !== null, state);
  return { type: "text", value: noNumber(s) ? null : value, authored, ...s };
}

/**
 * A decimal with its unit kind, currency (money) and value basis. The number is dropped whenever the state is unknown
 * or stale, and a missing number is unknown (missing) unless declared n/a: Unknown and Stale never travel as 0.
 */
export function decimalValue(
  value: string | null,
  o: {
    readonly unitKind: ReportUnitKind;
    readonly currency?: string | null;
    readonly valueBasis?: ReportValueBasis | null;
    readonly state?: ValueState;
  },
): ReportValue {
  const s = stateOf(value !== null, o.state);
  return {
    type: "decimal",
    value: noNumber(s) ? null : value,
    unitKind: o.unitKind,
    currency: o.currency === undefined || o.currency === null ? null : o.currency.trim(),
    valueBasis: o.valueBasis ?? null,
    ...s,
  };
}

export function dateValue(value: string | null, state?: ValueState): ReportValue {
  const s = stateOf(value !== null, state);
  return { type: "date", value: noNumber(s) || value === null ? null : String(value).slice(0, 10), ...s };
}

export function timestampValue(value: Date | string | null, state?: ValueState): ReportValue {
  const s = stateOf(value !== null, state);
  const iso = value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return { type: "timestamp", value: noNumber(s) ? null : iso, ...s };
}

/** A closed-set value with its i18n label key (`<prefix>.<value>`). */
export function codeValue(value: string | null, labelPrefix: string | null, state?: ValueState): ReportValue {
  const s = stateOf(value !== null, state);
  const shown = noNumber(s) ? null : value;
  return {
    type: "code",
    value: shown,
    labelKey: shown === null || labelPrefix === null ? null : `${labelPrefix}.${shown}`,
    ...s,
  };
}

export function countValue(value: number | null, state?: ValueState): ReportValue {
  const s = stateOf(value !== null, state);
  return { type: "count", value: noNumber(s) ? null : value, ...s };
}

function noNumber(s: ValueState): boolean {
  return s.validation === "unknown" || s.validation === "stale";
}

/**
 * The approval state of a set of rows (ADR-0045 §3 for `business_cases` and `registers`): `mixed` when their states
 * differ, the common state when they agree, `not_applicable` when no row has one.
 */
export function combinedApprovalState(states: readonly (ReportSourceApprovalState | null)[]): ReportApprovalState {
  const set = new Set(states.filter((s): s is ReportSourceApprovalState => s !== null && s !== "not_applicable"));
  if (set.size === 0) return "not_applicable";
  if (set.size === 1) return [...set][0]!;
  return "mixed";
}

// ------------------------------------------------------------------------------------------------ shared reads

/**
 * The active evidence linked (DG2 `evidence_link`) to records of one type, as cited by `sectionKey`: the item's current
 * content revision and SHA-256 (files) and its review status at the as-of instant (ADR-0045 §3, §8). Notes and links
 * have no content revision. Archived items and removed links are not cited. Ordered by evidence id.
 */
export async function citedEvidence(
  db: Tx,
  transformationId: string,
  recordType: string,
  recordIds: readonly string[],
  sectionKey: string,
): Promise<EvidenceRef[]> {
  if (recordIds.length === 0) return [];
  const rows = await db
    .selectFrom("evidence_link as l")
    .innerJoin("evidence as e", "e.id", "l.evidence_id")
    .leftJoin("evidence_content as c", "c.id", "e.current_content_id")
    .select(["e.id as evidenceId", "c.id as contentId", "c.revision", "c.sha256", "e.review_status as reviewStatus"])
    .where("l.transformation_id", "=", transformationId)
    .where("l.record_type", "=", recordType)
    .where("l.record_id", "in", [...recordIds])
    .where("l.status", "=", "active")
    .where("e.status", "=", "active")
    .orderBy("e.id")
    .execute();
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const r of rows) {
    if (seen.has(r.evidenceId)) continue;
    seen.add(r.evidenceId);
    out.push({
      sectionKey,
      evidenceId: r.evidenceId,
      contentId: r.contentId,
      contentRevision: r.revision,
      contentSha256: r.sha256 === null ? null : r.sha256.trim(),
      reviewStatus: r.reviewStatus as EvidenceRef["reviewStatus"],
    });
  }
  return out;
}

/** Display names of users (a missing or null id maps to nothing; the caller shows Unknown). */
export async function userNames(db: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((i): i is string => i !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db.selectFrom("app_user").select(["id", "display_name"]).where("id", "in", wanted).execute();
  return new Map(rows.map((r) => [r.id, r.display_name] as const));
}

/** The product gate approval state (DG2 `gate_instance.status`) as a snapshot approval state (ADR-0045 §3). */
export function gateApprovalState(status: string | null): ReportSourceApprovalState {
  switch (status) {
    case "approved":
      return "approved";
    case "submitted":
    case "under_review":
      return "pending";
    case "changes_requested":
      return "changes_requested";
    case "rejected":
      return "rejected";
    default:
      return "not_submitted";
  }
}
