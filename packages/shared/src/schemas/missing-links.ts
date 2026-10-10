// P4 slice K mirrors of BE-M2 (backend-workflow-engineer, T-DG4-BE-M2; ADR-0038 §7, §10-§12; p4-work-split §J+K
// JK.2): Modular entry: the labelled inherited records (inherited evidence and baselines, and the inherited-approval
// dispensations shown read-only as `prior_approval` entries), the G1-G6 gate labels and the missing-link report.
//
// The ONE rule of ADR-0038 §7.3 lives here as pure functions over facts (`deriveMissingLinks`, `blockingMissingLinks`),
// so the read model (reporting/modular.ts) and the Modular G3 precondition (workflows/gates.ts; D-106 (e)) apply the
// same rule without importing each other (p4-work-split JK.10 item 4). The facts are loaded read-only by
// apps/api transformations/missing-links-facts.ts.
//
// - "Inherited" is never "approved": a gate is labelled `approved` only when the platform recorded the approval
//   (`gate_instance.status = 'approved'`); an inherited approval is `inherited` or `inherited_pending_verification`
//   (ADR-0038 §7.2; REQ-S03-005 "shows G2 as 'inherited' (not Approved)").
// - Free text goes through the shared `freeText` rule (S-1). Labels are keys, translated at render time (S-6).
// - Nothing here grants or records any business approval; nothing reads or writes the engineering gates DG0-DG7.
import { z } from "zod";
import { gateInheritedApproval, type GateInheritedApproval } from "./gate.ts";
import { businessDate } from "./kpi.ts";
import { freeText, phase, timestamp, transformationMode, uuid, version } from "./common.ts";

const nullableUuid = uuid.nullable();

// ------------------------------------------------------------------------------------------------ vocabularies

/** The missing-link codes of ADR-0038 §7.3, in report order (blocking first). */
export const MISSING_LINK_CODES = [
  "baseline_missing",
  "outcome_link_missing",
  "outcome_kpi_missing",
  "initiative_outcome_link_missing",
  "initiative_gap_link_missing",
  "benefit_missing",
  "benefit_outcome_link_missing",
  "inherited_approval_unverified",
] as const;
export type MissingLinkCode = (typeof MISSING_LINK_CODES)[number];
export const MISSING_LINK_SEVERITIES = ["blocking", "warning"] as const;
export type MissingLinkSeverity = (typeof MISSING_LINK_SEVERITIES)[number];

/** Severity per code (ADR-0038 §7.3): only a missing baseline and a missing outcome link block. */
export const MISSING_LINK_SEVERITY: Readonly<Record<MissingLinkCode, MissingLinkSeverity>> = Object.freeze({
  baseline_missing: "blocking",
  outcome_link_missing: "blocking",
  outcome_kpi_missing: "warning",
  initiative_outcome_link_missing: "warning",
  initiative_gap_link_missing: "warning",
  benefit_missing: "warning",
  benefit_outcome_link_missing: "warning",
  inherited_approval_unverified: "warning",
});

/**
 * The JSON pointer and English message of each BLOCKING item in the 422 `gate.modular_links_missing` refusal
 * (ADR-0038 §7.4: "`errors[]` lists each blocking item (`/baseline`, `/outcomes`)"). The `code` of each error is the
 * missing-link code itself, an i18n key translated at render time.
 */
export const MODULAR_BLOCKING_ERROR: Readonly<
  Record<"baseline_missing" | "outcome_link_missing", { pointer: string; message: string }>
> = Object.freeze({
  baseline_missing: { pointer: "/baseline", message: "No active baseline with a value is recorded." },
  outcome_link_missing: { pointer: "/outcomes", message: "No active outcome has an active KPI." },
});

/** The `errors[]` entry of one blocking item in the 422 `gate.modular_links_missing` refusal. */
export function modularBlockingError(code: string): { pointer: string; code: string; message: string } {
  const e =
    code === "baseline_missing" ? MODULAR_BLOCKING_ERROR.baseline_missing : MODULAR_BLOCKING_ERROR.outcome_link_missing;
  return { pointer: e.pointer, code, message: e.message };
}

/** ADR-0038 §12 (D-106 (e)): the exact English detail of the Modular G3 precondition refusal. */
export const MODULAR_LINKS_MISSING_DETAIL =
  "Modular entry: supply the missing baseline and outcome links, or record an authorized waiver, before submitting this gate.";
/**
 * ADR-0038 amendment B1/B4 (T-DG4-BE-R3): the exact English details of the approval-time refusals of a G3 submission
 * whose snapshot records the Modular-links waiver it relied on. `date` is a business date `YYYY-MM-DD`.
 */
export const modularWaiverRevokedDetail = (date: string) =>
  `The waiver of the missing baseline and outcome links was revoked on ${date}; supply them or record a new waiver, then resubmit G3.`;
export const modularWaiverExpiredDetail = (date: string) =>
  `The waiver of the missing baseline and outcome links expired on ${date}; supply them or record a new waiver, then resubmit G3.`;

/** D-106 (e): the precondition applies to this gate of a Modular transformation only. */
export const MODULAR_PRECONDITION_GATE = "G3";

/**
 * The label every inherited record carries (`label: "inherited"`), and its render texts. English verbatim from the
 * REQ-S03-005 procedure (ADR-0038 §7.1); the Arabic text is PROVISIONAL and needs Mobily review.
 */
export const INHERITED_LABEL = "inherited" as const;
export const INHERITED_LABEL_TEXT = Object.freeze({
  en: "Inherited - recorded, not granted in platform",
  ar: "موروث - مُسجَّل، ولم يُمنح في المنصة",
});

/** The gate labels of ADR-0038 §7.2, besides the gate's own status. */
export const GATE_LABEL_APPROVED = "approved";
export const GATE_LABEL_INHERITED = "inherited";
export const GATE_LABEL_INHERITED_PENDING = "inherited_pending_verification";

export const INHERITED_RECORD_KINDS = ["evidence", "baseline", "prior_approval"] as const;
export const inheritedRecordKind = z.enum(INHERITED_RECORD_KINDS);
export type InheritedRecordKind = z.infer<typeof inheritedRecordKind>;

// ------------------------------------------------------------------------------------------------ shapes (mirrors)

/** Mirrors MissingLinkItem. */
export const missingLinkItem = z.strictObject({
  code: z.enum(MISSING_LINK_CODES),
  severity: z.enum(MISSING_LINK_SEVERITIES),
  recordType: z.string().nullable(),
  recordId: nullableUuid,
  label: z.string().nullable(),
  href: z.string().nullable(),
});
export type MissingLinkItem = z.infer<typeof missingLinkItem>;

/** Mirrors MissingLinksGate: `label` is `approved` only for a platform approval (ADR-0038 §7.2). */
export const missingLinksGate = z.strictObject({
  gateCode: z.string().regex(/^G[1-6]$/),
  status: z.string(),
  label: z.string(),
  inheritedApproval: gateInheritedApproval.nullable(),
});
export type MissingLinksGate = z.infer<typeof missingLinksGate>;

/** Mirrors MissingLinks. */
export const missingLinks = z.strictObject({
  transformationId: uuid,
  mode: transformationMode,
  entryPhase: phase.nullable(),
  standaloneDeliverableType: z.string().nullable(),
  gates: z.array(missingLinksGate),
  items: z.array(missingLinkItem),
});
export type MissingLinks = z.infer<typeof missingLinks>;

/** Mirrors InheritedRecord; `prior_approval` entries are read-only views of inherited-approval dispensations. */
export const inheritedRecord = z.strictObject({
  id: uuid,
  transformationId: uuid,
  kind: inheritedRecordKind,
  label: z.literal(INHERITED_LABEL),
  evidenceId: nullableUuid,
  baselineId: nullableUuid,
  gateDispensationId: nullableUuid,
  gateCode: z.string().nullable(),
  approvingBody: z.string().nullable(),
  sourceDescription: z.string().nullable(),
  originalOwner: z.string().nullable(),
  originalDate: businessDate.nullable(),
  recordedBy: nullableUuid,
  status: z.string(),
  withdrawnAt: timestamp.nullable(),
  withdrawnBy: nullableUuid,
  withdrawReason: z.string().nullable(),
  version,
  createdAt: timestamp,
});
export type InheritedRecord = z.infer<typeof inheritedRecord>;

export const inheritedRecordPage = z.strictObject({
  items: z.array(inheritedRecord),
  nextCursor: z.string().nullable(),
});
export type InheritedRecordPage = z.infer<typeof inheritedRecordPage>;

/**
 * Mirrors InheritedRecordCreate. Kind `prior_approval` passes validation on purpose, so that the route answers it with
 * the exact 422 `inherited_record.prior_approval_use_dispensation` (ADR-0038 §7.1, §12) rather than a generic 400.
 * Kind `evidence` needs `evidenceId` (and no `baselineId`); kind `baseline` needs `baselineId` (and no `evidenceId`).
 */
export const inheritedRecordCreate = z
  .strictObject({
    kind: inheritedRecordKind,
    evidenceId: uuid.optional(),
    baselineId: uuid.optional(),
    sourceDescription: freeText(3, 2000),
    originalOwner: freeText(1, 300).nullable().optional(),
    originalDate: businessDate.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (v.kind === "evidence") {
      need(v.evidenceId !== undefined, "evidenceId", "validation.required");
      need(v.baselineId === undefined, "baselineId", "validation.not_allowed_for_kind");
    }
    if (v.kind === "baseline") {
      need(v.baselineId !== undefined, "baselineId", "validation.required");
      need(v.evidenceId === undefined, "evidenceId", "validation.not_allowed_for_kind");
    }
  });
export type InheritedRecordCreate = z.infer<typeof inheritedRecordCreate>;

// ------------------------------------------------------------------------------------------------ the rule (pure)

/** The facts of ADR-0038 §7.3, loaded read-only by transformations/missing-links-facts.ts. */
export interface MissingLinkFacts {
  /** Active baselines (inherited or not); `hasValue` = a value is recorded. */
  readonly baselines: readonly { readonly id: string; readonly hasValue: boolean }[];
  /** Active (not archived) outcomes with their count of active outcome KPI rows. */
  readonly outcomes: readonly { readonly id: string; readonly label: string; readonly activeKpiCount: number }[];
  /** Initiatives that are neither draft nor cancelled. */
  readonly initiatives: readonly {
    readonly id: string;
    readonly label: string;
    readonly hasActiveContribution: boolean;
    readonly hasActiveTomGapLink: boolean;
  }[];
  /** Active benefits; `hasUpstream` = the §5 benefit upstream rule finds a KPI movement or allocation. */
  readonly benefits: readonly { readonly id: string; readonly label: string; readonly hasUpstream: boolean }[];
  /** Inherited-approval dispensations still pending verification. */
  readonly pendingInheritedApprovals: readonly { readonly id: string; readonly gateCode: string }[];
}

/** One derived item before the API adds its `href` (the API knows the paths; the rule does not). */
export type DerivedMissingLink = Omit<MissingLinkItem, "href">;

const item = (
  code: MissingLinkCode,
  recordType: string | null = null,
  recordId: string | null = null,
  label: string | null = null,
): DerivedMissingLink => ({ code, severity: MISSING_LINK_SEVERITY[code], recordType, recordId, label });

/**
 * ADR-0038 §7.3: every missing link of a transformation, blocking items first, then the warnings in the table's order;
 * within one code, in the order the facts list the records. Pure and deterministic.
 */
export function deriveMissingLinks(f: MissingLinkFacts): DerivedMissingLink[] {
  const out: DerivedMissingLink[] = [];
  if (!f.baselines.some((b) => b.hasValue)) out.push(item("baseline_missing"));
  if (!f.outcomes.some((o) => o.activeKpiCount > 0)) out.push(item("outcome_link_missing"));
  for (const o of f.outcomes)
    if (o.activeKpiCount === 0) out.push(item("outcome_kpi_missing", "outcome", o.id, o.label));
  for (const i of f.initiatives)
    if (!i.hasActiveContribution) out.push(item("initiative_outcome_link_missing", "initiative", i.id, i.label));
  for (const i of f.initiatives)
    if (!i.hasActiveTomGapLink) out.push(item("initiative_gap_link_missing", "initiative", i.id, i.label));
  if (f.benefits.length === 0) out.push(item("benefit_missing"));
  for (const b of f.benefits)
    if (!b.hasUpstream) out.push(item("benefit_outcome_link_missing", "benefit", b.id, b.label));
  for (const d of f.pendingInheritedApprovals)
    out.push(item("inherited_approval_unverified", "gate_dispensation", d.id, d.gateCode));
  return out;
}

/** The blocking items only (the Modular G3 precondition refuses while one exists; ADR-0038 §7.4). */
export function blockingMissingLinks(f: MissingLinkFacts): DerivedMissingLink[] {
  return deriveMissingLinks(f).filter((i) => i.severity === "blocking");
}

/** One inherited-approval fact as the gate annotation reads it (the DG3 `InheritedApprovalFact` shape). */
export interface InheritedApprovalLabelFact {
  readonly dispensationId: string;
  readonly gateCode: string;
  readonly status: string;
  readonly counts: boolean;
  readonly approvingBody: string;
  readonly approvedOn: string;
  readonly createdAt: string;
}

const newestFirst = (a: string, b: string) => (a === b ? 0 : a < b ? 1 : -1);

/**
 * The inherited-approval annotation of one gate, by the DG3 rule (ADR-0021 §5; F-DG3-120; workflows
 * `inheritedApprovalOf`, which reporting may not import): the one that counts, else the newest pending one, else the
 * newest; null when there is none; `pending` is shown as pending_verification. The integration test asserts that
 * `getMissingLinks` and the DG3 gate list show the same annotation.
 */
export function inheritedApprovalAnnotation(
  facts: readonly InheritedApprovalLabelFact[],
  gateCode: string,
): GateInheritedApproval | null {
  const mine = facts
    .filter((f) => f.gateCode === gateCode)
    .sort((a, b) => newestFirst(a.createdAt, b.createdAt) || newestFirst(a.dispensationId, b.dispensationId));
  const shown = mine.find((f) => f.counts) ?? mine.find((f) => f.status === "pending") ?? mine[0];
  if (shown === undefined) return null;
  return {
    dispensationId: shown.dispensationId,
    status: (shown.status === "pending" ? "pending_verification" : shown.status) as GateInheritedApproval["status"],
    counts: shown.counts,
    approvingBody: shown.approvingBody,
    approvedOn: shown.approvedOn,
  };
}

/**
 * ADR-0038 §7.2: `approved` only when the platform recorded the approval; else `inherited` when the annotation counts;
 * else `inherited_pending_verification` when it is pending; else the gate's own status. Never `approved` from an
 * inherited approval.
 */
export function gateLabelOf(gateStatus: string, annotation: GateInheritedApproval | null): string {
  if (gateStatus === "approved") return GATE_LABEL_APPROVED;
  if (annotation?.counts === true) return GATE_LABEL_INHERITED;
  if (annotation?.status === "pending_verification") return GATE_LABEL_INHERITED_PENDING;
  return gateStatus;
}
