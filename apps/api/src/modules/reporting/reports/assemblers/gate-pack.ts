// The `gate_pack` assembler (ADR-0045 §1, §3, §5; B0023 Phase gates; REQ-S13-004, REQ-S13-008; the content
// REQ-S13-005's PPTX gate pack renders; T-DG5-KBE-C2).
//
// Subject: one product gate instance (`gate_instance`) of the transformation. Product gates G1-G6 are BUSINESS
// approvals inside the product, decided only by their configured human approver; this pack records what the gate
// evaluators and the decision say and approves nothing. It is unrelated to the engineering delivery gates DG0-DG7.
//
// What it reads (all read only):
//  - the gate instance (status, approver) and its CURRENT submission (`gate_instance.current_submission_id`, as the
//    gate view's `currentSubmission`), with the submission's decision if one was recorded;
//  - the criteria: the gate evaluators' output recorded with that submission (`gate_submission_criterion`: the
//    DG2/DG4 `evaluateGate` result at submission time - completeness, the missing items, the unverified evidence, and
//    the accepted gate exception that covers an incomplete mandatory criterion, ADR-0035 §4), exactly the `criteria`
//    of GET …/gates/{code}/submissions/{no}; every criterion of the gate appears, with the catalogue texts
//    (`gate_criterion_definition`, through methodology's `loadGateDefinitions`) and the latest DG4 criterion review;
//  - the evidence: the evidence list of the submission's snapshot (`gate_submission.snapshot.evidence`: each item, the
//    record it supports and whether it was verified when submitted) with each item's current content revision and
//    SHA-256, cited as the pack's evidence.
// A gate that was never submitted has no evaluator output on record. The live evaluation (workflows' `evaluateGate`
// with the GateFactsProvider) is out of `reporting`'s reach (modules.ts: reporting may not import workflows; the
// WorkflowsReadPort carries the readiness summary and, since T-DG5-KBE-D4, the effective approver), so such a pack
// lists every criterion of the gate with its state Unknown (not computable), never "complete", and no evidence; see
// the T-DG5-KBE-C2 handback for the port request.
//
// Approver (T-DG5-KBE-D4, D-164 c): the submission's recorded approver; without a submission, the effective approver
// through the WorkflowsReadPort (a pinned methodology's default role), and the stored value only when it cannot be read.
//
// Approval state (ADR-0045 §3): the gate decision's state through `gateApprovalState` (approved, rejected,
// changes_requested, pending for a submitted gate, not_submitted). A recorded fact, never an approval.
import { emptyReportParameters, type ReportColumn, type ReportField, type ReportRow } from "@mth/shared/schemas";
import { loadGateDefinitions } from "../../../methodology/index.ts";
import {
  codeValue,
  countValue,
  dateValue,
  gateApprovalState,
  textValue,
  timestampValue,
  userNames,
  type Assembler,
  type AssemblyContext,
  type AssembledOutput,
  type EvidenceRef,
  type SourceRecord,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";
import { NOT_APPLICABLE, UNKNOWN_NOT_COMPUTABLE } from "../provisional.ts";
import { workflowsReadPort } from "../../ports.ts";

const S = { gate: "gate", criteria: "criteria", evidence: "evidence" } as const;
const L = (k: string) => `report.gate_pack.${k}`;
const column = (key: string, valueKind: ReportColumn["valueKind"]): ReportColumn => ({
  key,
  labelKey: L(key),
  valueKind,
  unitKind: null,
});

/** The recorded evaluator output of one criterion (`gate_submission_criterion.detail`). */
interface CriterionDetail {
  readonly missing: readonly { readonly code: string; readonly message: string }[];
  readonly unverifiedEvidenceIds: readonly string[];
}

/** Pure: the detail column as stored (a malformed or absent member reads as empty, never as complete). */
export function criterionDetail(raw: unknown): CriterionDetail {
  const o = (typeof raw === "string" ? safeJson(raw) : raw) as {
    readonly missing?: unknown;
    readonly unverifiedEvidenceIds?: unknown;
  } | null;
  const missing = Array.isArray(o?.missing)
    ? (o!.missing as unknown[]).flatMap((m) =>
        typeof m === "object" && m !== null && typeof (m as { code?: unknown }).code === "string"
          ? [{ code: (m as { code: string }).code, message: String((m as { message?: unknown }).message ?? "") }]
          : [],
      )
    : [];
  const unverified = Array.isArray(o?.unverifiedEvidenceIds)
    ? (o!.unverifiedEvidenceIds as unknown[]).filter((i): i is string => typeof i === "string")
    : [];
  return { missing, unverifiedEvidenceIds: unverified };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

/**
 * Pure: the state of a recorded criterion. `complete`; `covered_by_exception` for an incomplete mandatory criterion
 * covered by an accepted gate exception at submission (ADR-0035 §4); else `incomplete`.
 */
export function criterionState(c: {
  readonly completeness: string;
  readonly mandatory: boolean;
  readonly gateExceptionId: string | null;
}): "complete" | "incomplete" | "covered_by_exception" {
  if (c.completeness === "complete") return "complete";
  return c.mandatory && c.gateExceptionId !== null ? "covered_by_exception" : "incomplete";
}

/** Pure: the submission snapshot's evidence list (`{evidenceId, record, verified}`), in snapshot order, deduplicated. */
export function snapshotEvidence(
  snapshot: unknown,
): { readonly evidenceId: string; readonly recordType: string | null; readonly verified: boolean }[] {
  const list = (snapshot as { evidence?: unknown } | null)?.evidence;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: { evidenceId: string; recordType: string | null; verified: boolean }[] = [];
  for (const e of list as { evidenceId?: unknown; record?: unknown; verified?: unknown }[]) {
    if (typeof e?.evidenceId !== "string" || seen.has(e.evidenceId)) continue;
    seen.add(e.evidenceId);
    const record = typeof e.record === "string" ? e.record : null;
    out.push({
      evidenceId: e.evidenceId,
      recordType: record === null ? null : (record.split(":")[0] ?? null),
      verified: e.verified === true,
    });
  }
  return out;
}

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  const { db } = ctx;
  const tId = ctx.transformation.id;
  const instance = await db
    .selectFrom("gate_instance")
    .selectAll()
    .where("id", "=", ctx.subject.id)
    .where("transformation_id", "=", tId)
    .executeTakeFirstOrThrow();
  const approvalState = gateApprovalState(instance.status);
  const def = (await loadGateDefinitions(db)).find((d) => d.code === instance.gate_code) ?? null;
  const submission =
    instance.current_submission_id === null
      ? undefined
      : await db
          .selectFrom("gate_submission")
          .selectAll()
          .where("id", "=", instance.current_submission_id)
          .executeTakeFirst();
  const decision =
    submission === undefined
      ? undefined
      : await db
          .selectFrom("gate_decision")
          .selectAll()
          .where("gate_submission_id", "=", submission.id)
          .orderBy("decided_at", "desc")
          .orderBy("id", "desc")
          .executeTakeFirst();
  const recorded =
    submission === undefined
      ? []
      : await db
          .selectFrom("gate_submission_criterion")
          .selectAll()
          .where("gate_submission_id", "=", submission.id)
          .orderBy("ordinal")
          .orderBy("criterion_key")
          .execute();
  const reviews =
    submission === undefined
      ? []
      : await db
          .selectFrom("gate_criterion_review")
          .select(["criterion_key", "review_no", "recommendation", "finding"])
          .where("gate_submission_id", "=", submission.id)
          .orderBy("criterion_key")
          .orderBy("review_no", "desc")
          .execute();
  const latestReview = new Map<string, { recommendation: string; finding: string }>();
  for (const r of reviews) if (!latestReview.has(r.criterion_key)) latestReview.set(r.criterion_key, r);
  const catalogue = new Map((def?.criteria ?? []).map((c) => [c.key, c] as const));
  // T-DG5-KBE-D4 (D-164 c; ADR-0039 §3): the approver the pack names. A submission's recorded approver first (the one
  // it was routed to); without one, the EFFECTIVE approver through the WorkflowsReadPort (workflows' routing rule, so a
  // pinned methodology's default role is named, not the stored catalogue default); the stored value only when the port
  // is unwired or cannot read it.
  const approverRoleCode =
    submission?.approver_role_code ??
    (await workflowsReadPort().gateApprover(db, tId, instance.gate_code))?.roleCode ??
    instance.approver_role_code;
  const names = await userNames(db, [submission?.submitted_by ?? null, decision?.decided_by ?? null]);
  const userText = (id: string | null | undefined, applies: boolean) =>
    !applies
      ? textValue(null, "system", NOT_APPLICABLE)
      : id === null || id === undefined
        ? textValue(null)
        : textValue(names.get(id) ?? null, "system");

  const sources: SourceRecord[] = [
    {
      sectionKey: S.gate,
      recordType: "gate_instance",
      recordId: instance.id,
      recordVersion: instance.version,
      recordUpdatedAt: instance.updated_at,
      approvalState,
      validationState: "not_applicable",
    },
  ];
  if (submission !== undefined)
    sources.push({
      sectionKey: S.gate,
      recordType: "gate_submission",
      recordId: submission.id,
      recordVersion: submission.version,
      recordUpdatedAt: submission.updated_at,
      approvalState,
      validationState: "not_applicable",
    });
  // Gate decisions and recorded criteria are append-only rows without a version column: version 1 is the only one.
  if (decision !== undefined)
    sources.push({
      sectionKey: S.gate,
      recordType: "gate_decision",
      recordId: decision.id,
      recordVersion: 1,
      recordUpdatedAt: decision.decided_at,
      approvalState,
      validationState: "not_applicable",
    });

  // ---------------------------------------------------------------------------------------------- the gate
  const submitted = submission !== undefined;
  const decided = decision !== undefined;
  const fields: ReportField[] = [
    { key: "gate", labelKey: L("gate"), value: codeValue(instance.gate_code, "report.gate") },
    { key: "phase", labelKey: L("phase"), value: codeValue(def?.phase ?? null, "report.phase") },
    { key: "status", labelKey: L("status"), value: codeValue(instance.status, "report.gate_status") },
    { key: "approval_state", labelKey: L("approval_state"), value: codeValue(approvalState, "report.approval_state") },
    {
      key: "approver_role",
      labelKey: L("approver_role"),
      value: codeValue(approverRoleCode, "report.role"),
    },
    {
      key: "submission_no",
      labelKey: L("submission_no"),
      value: countValue(submission?.submission_no ?? null, submitted ? undefined : NOT_APPLICABLE),
    },
    {
      key: "submitted_at",
      labelKey: L("submitted_at"),
      value: timestampValue(submission?.submitted_at ?? null, submitted ? undefined : NOT_APPLICABLE),
    },
    { key: "submitted_by", labelKey: L("submitted_by"), value: userText(submission?.submitted_by, submitted) },
    {
      key: "submission_note",
      labelKey: L("submission_note"),
      // A submission without a note: n/a (the note is optional).
      value: textValue(submission?.submission_note ?? null, "user", NOT_APPLICABLE),
    },
    {
      key: "due_date",
      labelKey: L("due_date"),
      value: dateValue(
        submission?.due_date === null || submission?.due_date === undefined ? null : String(submission.due_date),
        NOT_APPLICABLE,
      ),
    },
    {
      key: "snapshot_sha256",
      labelKey: L("snapshot_sha256"),
      value: textValue(submission?.snapshot_sha256.trim() ?? null, "system", submitted ? undefined : NOT_APPLICABLE),
    },
    {
      key: "decision_outcome",
      labelKey: L("decision_outcome"),
      value: codeValue(decision?.outcome ?? null, "report.gate_outcome", decided ? undefined : NOT_APPLICABLE),
    },
    {
      key: "decided_at",
      labelKey: L("decided_at"),
      value: timestampValue(decision?.decided_at ?? null, decided ? undefined : NOT_APPLICABLE),
    },
    { key: "decided_by", labelKey: L("decided_by"), value: userText(decision?.decided_by, decided) },
    {
      key: "rationale",
      labelKey: L("rationale"),
      value: textValue(decision?.rationale ?? null, "user", decided ? undefined : NOT_APPLICABLE),
    },
  ];

  // ---------------------------------------------------------------------------------------------- criteria
  const criterionRows: ReportRow[] = [];
  if (submitted) {
    for (const c of recorded) {
      const d = criterionDetail(c.detail);
      const cat = catalogue.get(c.criterion_key);
      const state = criterionState({
        completeness: c.completeness,
        mandatory: c.mandatory,
        gateExceptionId: c.gate_exception_id,
      });
      const review = latestReview.get(c.criterion_key);
      // The recorded state is the evaluator's output, a fact with no validation state of its own (ADR-0045 §5 rule 6):
      // not_applicable. It is never labelled validated, and an incomplete criterion is never shown as complete.
      const stateLabel = NOT_APPLICABLE;
      criterionRows.push({
        recordType: "gate_submission_criterion",
        recordId: c.id,
        recordVersion: 1,
        cells: [
          countValue(c.ordinal),
          codeValue(c.criterion_key, "report.gate_criterion"),
          textValue(cat?.labelEn ?? null, "system"),
          textValue(cat?.labelAr ?? null, "system"),
          codeValue(c.mandatory ? "mandatory" : "optional", "report.criterion_mandatory"),
          codeValue(
            cat === undefined ? null : cat.requiresVerifiedEvidence ? "required" : "not_required",
            "report.criterion_verified_evidence",
          ),
          codeValue(state, "report.criterion_state", stateLabel),
          countValue(d.missing.length),
          textValue(
            d.missing.length === 0 ? null : d.missing.map((m) => m.code).join("; "),
            "system",
            d.missing.length === 0 ? NOT_APPLICABLE : undefined,
          ),
          countValue(d.unverifiedEvidenceIds.length),
          codeValue(
            review?.recommendation ?? null,
            "report.criterion_recommendation",
            review ? undefined : NOT_APPLICABLE,
          ),
          textValue(review?.finding ?? null, "user", review ? undefined : NOT_APPLICABLE),
        ],
      });
      sources.push({
        sectionKey: S.criteria,
        recordType: "gate_submission_criterion",
        recordId: c.id,
        recordVersion: 1,
        recordUpdatedAt: c.evaluated_at,
        approvalState: null,
        validationState: stateLabel.validation,
      });
    }
  } else {
    // Never submitted: every criterion of the gate, not evaluated in this pack (Unknown, never complete).
    for (const c of def?.criteria ?? []) {
      criterionRows.push({
        recordType: "gate_criterion_definition",
        recordId: c.id,
        recordVersion: c.version,
        cells: [
          countValue(c.ordinal),
          codeValue(c.key, "report.gate_criterion"),
          textValue(c.labelEn, "system"),
          textValue(c.labelAr, "system"),
          codeValue(c.mandatory ? "mandatory" : "optional", "report.criterion_mandatory"),
          codeValue(c.requiresVerifiedEvidence ? "required" : "not_required", "report.criterion_verified_evidence"),
          codeValue(null, "report.criterion_state", UNKNOWN_NOT_COMPUTABLE),
          countValue(null, UNKNOWN_NOT_COMPUTABLE),
          textValue(null, "system", UNKNOWN_NOT_COMPUTABLE),
          countValue(null, UNKNOWN_NOT_COMPUTABLE),
          codeValue(null, null, NOT_APPLICABLE),
          textValue(null, "user", NOT_APPLICABLE),
        ],
      });
      sources.push({
        sectionKey: S.criteria,
        recordType: "gate_criterion_definition",
        recordId: c.id,
        recordVersion: c.version,
        recordUpdatedAt: c.updatedAt,
        approvalState: null,
        validationState: "unknown",
      });
    }
  }

  // ---------------------------------------------------------------------------------------------- evidence
  const listed = submission === undefined ? [] : snapshotEvidence(submission.snapshot);
  const items =
    listed.length === 0
      ? []
      : await db
          .selectFrom("evidence as e")
          .leftJoin("evidence_content as c", "c.id", "e.current_content_id")
          .select([
            "e.id",
            "e.title",
            "e.kind",
            "e.review_status",
            "e.version",
            "c.id as contentId",
            "c.revision",
            "c.sha256",
          ])
          .where("e.transformation_id", "=", tId)
          .where(
            "e.id",
            "in",
            listed.map((l) => l.evidenceId),
          )
          .execute();
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const evidenceRows: ReportRow[] = [];
  const evidence: EvidenceRef[] = [];
  for (const l of listed) {
    const e = byId.get(l.evidenceId);
    if (e === undefined) continue;
    evidenceRows.push({
      recordType: "evidence",
      recordId: e.id,
      recordVersion: e.version,
      cells: [
        textValue(e.title),
        codeValue(e.kind, "report.evidence_kind"),
        codeValue(l.recordType, "report.record_type"),
        codeValue(l.verified ? "verified" : "unverified", "report.evidence_verified_at_submission"),
        codeValue(e.review_status, "report.evidence_review_status"),
        countValue(e.revision ?? null, e.contentId === null ? NOT_APPLICABLE : undefined),
        textValue(
          e.sha256 === null ? null : e.sha256.trim(),
          "system",
          e.contentId === null ? NOT_APPLICABLE : undefined,
        ),
      ],
    });
    evidence.push({
      sectionKey: S.evidence,
      evidenceId: e.id,
      contentId: e.contentId,
      contentRevision: e.revision,
      contentSha256: e.sha256 === null ? null : e.sha256.trim(),
      reviewStatus: e.review_status as EvidenceRef["reviewStatus"],
    });
  }

  const criteriaSources = criterionRows.map((r) => ({
    recordType: r.recordType,
    recordId: r.recordId,
    recordVersion: r.recordVersion,
  }));
  return {
    subject: { code: instance.gate_code, label: `${ctx.transformation.code} ${instance.gate_code}` },
    approvalState,
    sections: [
      {
        key: S.gate,
        titleKey: L("title"),
        kind: "fields",
        sources: sources
          .filter((s) => s.sectionKey === S.gate)
          .map((s) => ({ recordType: s.recordType, recordId: s.recordId, recordVersion: s.recordVersion })),
        fields,
      },
      {
        key: S.criteria,
        titleKey: L("criteria"),
        kind: "table",
        sources: criteriaSources,
        columns: [
          column("ordinal", "count"),
          column("criterion", "code"),
          column("label_en", "text"),
          column("label_ar", "text"),
          column("mandatory", "code"),
          column("verified_evidence", "code"),
          column("state", "code"),
          column("missing_count", "count"),
          column("missing", "text"),
          column("unverified_evidence_count", "count"),
          column("review_recommendation", "code"),
          column("review_finding", "text"),
        ],
        rows: criterionRows,
        totals: [],
        emptyKey: "report.empty.no_records",
      },
      {
        key: S.evidence,
        titleKey: L("evidence"),
        kind: "table",
        sources: evidenceRows.map((r) => ({
          recordType: r.recordType,
          recordId: r.recordId,
          recordVersion: r.recordVersion,
        })),
        columns: [
          column("title", "text"),
          column("kind", "code"),
          column("record_type", "code"),
          column("verified_at_submission", "code"),
          column("review_status", "code"),
          column("content_revision", "count"),
          column("content_sha256", "text"),
        ],
        rows: evidenceRows,
        totals: [],
        emptyKey: submitted ? "report.empty.no_records" : "report.gate_pack.not_submitted",
      },
    ],
    sources,
    versions: [],
    evidence,
  };
}

export const gatePackAssembler: Assembler = {
  code: "gate_pack",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
