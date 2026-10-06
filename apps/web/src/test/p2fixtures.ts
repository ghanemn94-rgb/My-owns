// SYNTHETIC P2 fixtures for the web unit tests: a small methodology catalogue in the contract's shape and record
// factories. Nothing here is Mobily data, real people or a real approval; English labels mimic the catalogue's source
// text only so the tests can find them, Arabic labels are placeholders.
import type { Permission } from "@mth/shared";
import type {
  Baseline,
  CharterView,
  Decision,
  DiagnosticItem,
  Evidence,
  GateView,
  MethodologyCatalogue,
  Outcome,
  TomCanvasCellView,
  ValuePool,
} from "../api/types.ts";
import { hasText } from "@mth/shared/schemas";
import { ORG_ID, TR_ID, USER_ID } from "./fixtures.tsx";

export const OTHER_USER = "01920000-0000-7000-9000-000000000299";
const T = "2026-09-30T09:00:00Z";
let seq = 0;
export const id = () => `01920000-0000-7000-a000-${String(++seq).padStart(12, "0")}`;
const stamps = () => ({ version: 1, createdAt: T, createdBy: USER_ID, updatedAt: T, updatedBy: USER_ID });
const catStamps = { version: 1, createdAt: T, createdBy: null, updatedAt: T, updatedBy: null };
const rec = () => ({ id: id(), organizationId: ORG_ID, transformationId: TR_ID, ...stamps() });
const archive = { archivedAt: null, archivedBy: null, archiveReason: null };
const MV = "01920000-0000-7000-b000-000000000001";

const DIMENSIONS = ["financial", "customer", "process", "people_org", "technology", "data"] as const;
const WORKSTREAMS = ["commercial", "customer", "operations", "people", "technology", "finance"] as const;
const TOM = [
  "customer_value_proposition",
  "products_services",
  "journeys_processes",
  "organization",
  "governance_decision_rights",
  "people_capabilities",
  "technology",
  "data_analytics",
  "partners_sourcing",
  "performance_management",
] as const;
const cap = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function criterion(gate: string, key: string, ordinal: number, requiresVerifiedEvidence = false) {
  return {
    id: id(),
    gateDefinitionId: gate,
    key,
    ordinal,
    labelEn: `${cap(key.split(".")[1]!)} ready`,
    labelAr: `جاهزية ${ordinal}`,
    descriptionEn: "Synthetic criterion",
    descriptionAr: "معيار اصطناعي",
    mandatory: true,
    requiresVerifiedEvidence,
    sourceRef: "B0023",
    ...catStamps,
  };
}

function gateDef(code: string, ordinal: number, phase: string, nextPhase: string | null, enabled: boolean) {
  const gid = id();
  const n = code.toLowerCase();
  return {
    id: gid,
    code,
    methodologyVersionId: MV,
    ordinal,
    phase,
    nextPhase,
    // Verbatim B0023 form, as seeded (migration 0011): the source gate name already carries the code (F-DG2-151).
    sourceNameEn: `${code} - ${["Case for Change", "Direction", "Target State", "Mobilization", "Scale", "Sustain"][ordinal - 1]!}`,
    nameAr: `${code} - ${["مبررات التغيير", "التوجّه", "الحالة المستهدفة", "التعبئة", "التوسّع", "الاستدامة"][ordinal - 1]!}`,
    sourceDecisionQuestionEn: `Synthetic decision question ${code}`,
    decisionQuestionAr: `سؤال قرار اصطناعي ${code}`,
    sourceEvidenceRequiredEn: "Synthetic evidence list",
    evidenceRequiredAr: "قائمة أدلة اصطناعية",
    defaultApproverRoleCode: "SP",
    allowedApproverRoleCodes: ["SP", "BO"],
    submissionEnabled: enabled,
    sourceRef: "B0023",
    ...catStamps,
    criteria:
      code === "G1"
        ? [
            criterion(gid, "g1.diagnostic", 1, true),
            criterion(gid, "g1.baseline", 2, true),
            criterion(gid, "g1.value_pools", 3),
          ]
        : code === "G2"
          ? [criterion(gid, "g2.north_star", 1), criterion(gid, "g2.outcome_tree", 2)]
          : [criterion(gid, `${n}.target_operating_model`, 1)],
  };
}

export const METHODOLOGY = {
  methodologyVersion: {
    id: MV,
    key: "playbook",
    versionNo: 1,
    status: "published",
    titleEn: "Synthetic playbook",
    titleAr: "دليل اصطناعي",
    sourceDocument: "synthetic",
    sourceSha256: null,
    definition: {},
    contentSha256: "a".repeat(64),
    publishedAt: T,
    publishedBy: null,
    ...catStamps,
  },
  diagnosticDimensions: DIMENSIONS.map((code, i) => ({
    id: id(),
    code,
    methodologyVersionId: MV,
    ordinal: i + 1,
    sourceLabel: cap(code),
    labelEn: `${cap(code)} dimension`,
    labelAr: `البُعد ${i + 1}`,
    evidenceHintEn: "Evidence hint",
    evidenceHintAr: "تلميح الدليل",
    impactHintEn: "Impact hint",
    impactHintAr: "تلميح الأثر",
    isSourceSeeded: true,
    status: "active",
    ...catStamps,
  })),
  diagnosticWorkstreams: WORKSTREAMS.map((code, i) => ({
    id: id(),
    code,
    methodologyVersionId: MV,
    ordinal: i + 1,
    sourceNameEn: `${cap(code)} workstream`,
    nameAr: `مسار العمل ${i + 1}`,
    sourceKeyQuestionsEn: `Key questions of ${code}?`,
    keyQuestionsAr: `أسئلة رئيسية ${i + 1}؟`,
    sourceTypicalOutputsEn: "Typical outputs",
    typicalOutputsAr: "مخرجات معتادة",
    sourceRef: "B0029",
    status: "active",
    ...catStamps,
  })),
  tomDimensions: TOM.map((code, i) => ({
    id: id(),
    code,
    methodologyVersionId: MV,
    ordinal: i + 1,
    sourceNameEn: cap(code),
    sourceDesignQuestionEn: `Design question ${i + 1}?`,
    sourceCanvasBoxEn: `${cap(code)} box`,
    sourceCanvasPromptEn: "Canvas prompt",
    labelEn: cap(code),
    labelAr: `بُعد التشغيل ${i + 1}`,
    designQuestionAr: `سؤال التصميم ${i + 1}؟`,
    canvasBoxAr: `مربع ${i + 1}`,
    canvasPromptAr: "تلميح اللوحة",
    sourceRef: "B0062",
    ...catStamps,
  })),
  gateDefinitions: [
    gateDef("G1", 1, "diagnose", "define", true),
    gateDef("G2", 2, "define", "design", true),
    gateDef("G3", 3, "design", "mobilize", true),
    gateDef("G4", 4, "mobilize", "transform", false),
    gateDef("G5", 5, "transform", "realize", false),
    gateDef("G6", 6, "realize", null, false),
  ],
  charterScopeChecks: [
    "outcome_linkage",
    "problem_traceability",
    "exclusions_documented",
    "baseline_measurable",
    "executive_decisions_visible",
  ].map((code, i) => ({
    id: id(),
    code,
    methodologyVersionId: MV,
    ordinal: i + 1,
    sourceQuestionEn: `Scope question ${i + 1}?`,
    questionAr: `سؤال النطاق ${i + 1}؟`,
    sourceRef: "B0038",
    systemPrecheck: (
      [
        "none",
        "scope_items_traced",
        "exclusions_present",
        "baseline_measurable",
        "executive_decisions_visible",
      ] as const
    )[i]!,
    ...catStamps,
  })),
  goodOutcomeCriteria: [
    ["specific", "user_attested"],
    ["measurable", "system_kpi_linked"],
    ["strategically_relevant", "user_attested"],
    ["owned_by_business_leader", "system_owner_set"],
    ["causal_chain", "user_attested"],
  ].map(([code, evaluation], i) => ({
    id: id(),
    code: code!,
    methodologyVersionId: MV,
    ordinal: i + 1,
    sourceLabelEn: cap(code!),
    labelAr: `المعيار ${i + 1}`,
    evaluation: evaluation as "user_attested",
    sourceRef: "B0051",
    ...catStamps,
  })),
} as unknown as MethodologyCatalogue;

/** Every P2 permission a Transformation Lead holds on the transformation (UI hints only). */
export const LEAD_P2: Permission[] = [
  "organization.read",
  "business_unit.read",
  "role.read",
  "transformation.read",
  "transformation.update",
  "audit.read",
  "north_star.edit",
  "charter.edit",
  "outcome.edit",
  "kpi_definition.edit",
  "baseline.edit",
  "diagnostic.edit",
  "tom.edit",
  "workshop.facilitate",
  "decision.edit",
  "decision.decide",
  "dependency.edit",
  "action.edit",
  "evidence.create",
  "evidence.review",
  "gate.submit",
  "team.assign",
];
export const leadGrants = (extra: Permission[] = []) => [
  {
    scope: { type: "transformation" as const, id: TR_ID },
    inheritsDownward: false,
    permissions: [...LEAD_P2, ...extra],
  },
];
/** The read-only auditor: reads everything, writes nothing (ADR-0020). */
export const AUDITOR_GRANTS = [
  {
    scope: { type: "organization" as const, id: ORG_ID },
    inheritsDownward: true,
    permissions: [
      "organization.read",
      "business_unit.read",
      "role.read",
      "transformation.read",
      "audit.read",
      "user.read",
      "access.read",
    ] as Permission[],
  },
];

export function diagnosticItem(code: string, over: Partial<DiagnosticItem> = {}): DiagnosticItem {
  return {
    ...rec(),
    dimensionCode: code,
    isSeeded: true,
    currentState: null,
    evidenceBaseline: null,
    baselineId: null,
    rootCause: null,
    impactText: null,
    impactAmount: null,
    impactCurrency: null,
    impactKpiDefinitionId: null,
    confidence: null,
    ownerUserId: null,
    status: "active",
    ...archive,
    ...over,
  };
}

export function valuePool(over: Partial<ValuePool> = {}): ValuePool {
  return {
    ...rec(),
    name: "Synthetic pool",
    driver: null,
    workstreamCode: null,
    quantificationStatus: "unquantified",
    upsideAmount: null,
    downsideAmount: null,
    currency: "SAR",
    unquantifiedReason: "Data not yet extracted",
    materiality: "not_assessed",
    confidence: null,
    ownerUserId: null,
    validationStatus: "unvalidated",
    validatedBy: null,
    validatedAt: null,
    validationNote: null,
    validatedRecordVersion: null,
    status: "active",
    ...archive,
    ...over,
  };
}

export function baseline(over: Partial<Baseline> = {}): Baseline {
  return {
    ...rec(),
    metric: "Synthetic churn rate",
    kpiDefinitionId: null,
    value: null,
    unit: "%",
    currency: null,
    source: null,
    baselineDate: null,
    scope: "customer",
    ownerUserId: null,
    validationStatus: "unvalidated",
    validatedBy: null,
    validatedAt: null,
    validationNote: null,
    validatedRecordVersion: null,
    status: "active",
    ...archive,
    ...over,
  };
}

export function outcome(over: Partial<Outcome> = {}): Outcome {
  return {
    ...rec(),
    parentOutcomeId: null,
    statement: "Synthetic outcome",
    description: null,
    ownerUserId: null,
    isTopOutcome: true,
    topRank: 1,
    specificConfirmed: null,
    strategicallyRelevantConfirmed: null,
    causalChain: null,
    goodOutcomeTest: [],
    goodOutcomePass: false,
    status: "active",
    ...archive,
    ...over,
  };
}

export function decision(over: Partial<Decision> = {}): Decision {
  const did = over.id ?? id();
  const option = (label: string, ordinal: number) => ({
    ...rec(),
    decisionId: did,
    label,
    title: `Synthetic option ${label}`,
    description: null,
    ordinal,
    status: "active" as const,
  });
  return {
    ...rec(),
    id: did,
    kind: "design",
    code: "D-01",
    title: "Synthetic design decision",
    context: null,
    ownerUserId: USER_ID,
    dueDate: null,
    status: "open",
    recommendationOptionId: null,
    recommendationText: null,
    chosenOptionId: null,
    outcomeText: null,
    decidedBy: null,
    decidedAt: null,
    tomDimensionCode: null,
    sourceWorkshopItemId: null,
    options: [option("A", 1), option("B", 2), option("C", 3)],
    ...over,
  };
}

export function evidence(over: Partial<Evidence> = {}): Evidence {
  return {
    ...rec(),
    kind: "file",
    title: "Synthetic extract",
    description: null,
    evidenceType: "data_extract",
    source: null,
    ownerUserId: USER_ID,
    observationStart: null,
    observationEnd: null,
    noteBody: null,
    url: null,
    fileName: null,
    currentContentId: null,
    reviewStatus: "unverified",
    accessibilityStatus: "unchecked",
    reviewedContentId: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    status: "active",
    ...archive,
    ...over,
  };
}

export function charterView(over: Partial<CharterView["charter"]> = {}, topOutcomes: Outcome[] = []): CharterView {
  const fields = {
    transformationName: "Synthetic retail journey",
    executiveSponsorUserId: null,
    transformationLeadUserId: USER_ID,
    caseForChange: "Synthetic case for change",
    northStarId: null,
    inScope: null,
    outOfScope: null,
    baselineDate: null,
    targetHorizonValue: 18,
    targetHorizonUnit: "months" as const,
    governanceForum: null,
    decisionRights: null,
    successDefinition: null,
    thesisChange: "the retail onboarding",
    thesisOutcomes: null,
    thesisBenefits: null,
    thesisBecause: null,
    scOutcomeLinkage: "yes" as const,
    scOutcomeLinkageEvidence: null,
    scProblemTraceability: null,
    scProblemTraceabilityEvidence: null,
    scExclusionsDocumented: null,
    scExclusionsDocumentedEvidence: null,
    scBaselineMeasurable: null,
    scBaselineMeasurableEvidence: null,
    scExecutiveDecisionsVisible: null,
    scExecutiveDecisionsVisibleEvidence: null,
  };
  const charter = { ...rec(), ...fields, version: 2, ...over };
  return {
    charter,
    northStar: null,
    topOutcomes,
    guardrails: [],
    warnings:
      topOutcomes.length < 3 || topOutcomes.length > 5
        ? [{ code: "charter.top_outcomes_count", message: "Synthetic warning" }]
        : [],
    scopeCheckPrechecks: [
      { code: "outcome_linkage", result: "not_applicable", detail: "x" },
      { code: "problem_traceability", result: "unknown", detail: "x" },
      // Mirrors the server (F-DG2-150, F-DG2-160: the shared `hasText`): an empty or blank Out of scope FAILS the check ("attention"), never "unknown".
      {
        code: "exclusions_documented",
        result: hasText(charter.outOfScope) ? "pass" : "attention",
        detail: "x",
      },
      { code: "baseline_measurable", result: "attention", detail: "x" },
      { code: "executive_decisions_visible", result: "pass", detail: "x" },
    ],
  };
}

export function canvasCell(i: number): TomCanvasCellView {
  const dim = METHODOLOGY.tomDimensions[i]!;
  return {
    cell: {
      ...rec(),
      dimensionCode: dim.code,
      currentDesign: null,
      targetDesign: i === 0 ? "Synthetic target design" : null,
      ownerUserId: null,
      status: "draft",
    },
    dimension: dim,
    gaps: [],
    decisions: [],
    dependencies: [],
    evidence: [],
  };
}

/** Gate views G1-G6; G1 has one incomplete criterion with unverified evidence; G2 lists a failing outcome. */
export function gateViews(
  opts: {
    g1Status?: string;
    pending?: boolean;
    canSubmit?: boolean;
    canDecide?: boolean;
    evidenceId?: string;
    outcomeId?: string;
  } = {},
): GateView[] {
  return METHODOLOGY.gateDefinitions.map((def) => {
    const criteria = def.criteria.map((c) => {
      const incomplete =
        (def.code === "G1" && c.key === "g1.baseline") || (def.code === "G2" && c.key === "g2.outcome_tree");
      return {
        key: c.key,
        ordinal: c.ordinal,
        labelEn: c.labelEn,
        labelAr: c.labelAr,
        mandatory: c.mandatory,
        requiresVerifiedEvidence: c.requiresVerifiedEvidence,
        completeness: incomplete ? ("incomplete" as const) : ("complete" as const),
        missing:
          def.code === "G1" && incomplete
            ? [{ code: "g1.baseline.verified_evidence_missing", message: "x" }]
            : def.code === "G2" && incomplete
              ? [
                  {
                    code: "g2.outcome_tree.good_outcome_test_not_passing",
                    message: "x",
                    pointer: `/outcomes/${opts.outcomeId ?? "none"}`,
                  },
                ]
              : [],
        unverifiedEvidenceIds: def.code === "G1" && incomplete && opts.evidenceId ? [opts.evidenceId] : [],
      };
    });
    const pending = def.code === "G1" && opts.pending;
    return {
      gate: {
        ...rec(),
        gateCode: def.code,
        status: (def.code === "G1"
          ? (opts.g1Status ?? (pending ? "submitted" : "draft"))
          : "draft") as GateView["gate"]["status"],
        approverRoleCode: "SP",
        approverUserId: null,
        currentSubmissionId: pending ? id() : null,
        latestSubmissionNo: pending ? 1 : 0,
        approvedAt: null,
        version: 3,
      },
      definition: def,
      criteria,
      currentSubmission: pending
        ? {
            ...rec(),
            gateInstanceId: id(),
            gateCode: def.code,
            submissionNo: 1,
            status: "pending" as const,
            submittedBy: OTHER_USER,
            submittedAt: T,
            submissionNote: null,
            approverRoleCode: "SP",
            approverUserId: null,
            dueDate: null,
            charterId: null,
            charterVersionNo: null,
            snapshot: {},
            snapshotSha256: "b".repeat(64),
            supersededAt: null,
            supersededBySubmissionId: null,
          }
        : null,
      submissionEnabled: def.submissionEnabled,
      canSubmit: def.code === "G1" ? (opts.canSubmit ?? false) : false,
      canDecide: def.code === "G1" ? (opts.canDecide ?? false) : false,
    };
  });
}
