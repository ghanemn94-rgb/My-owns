// SYNTHETIC P3 fixtures for the FE-A unit tests (portfolio, initiative card, readiness, dispensations, G4). Not real
// Mobily data; ids follow the shared test fixtures.
import type { Permission } from "@mth/shared";
import type {
  GateDispensation,
  Initiative,
  OutcomeHierarchy,
  RoadmapWave,
  TransformationReadiness,
} from "../../api/types.ts";
import {
  BUSINESS_UNIT,
  ORG_ID,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  route,
  type Handler,
} from "../../test/fixtures.tsx";
import { AUDITOR_GRANTS, METHODOLOGY, OTHER_USER, id, leadGrants } from "../../test/p2fixtures.ts";

export const T = "2026-10-01T09:00:00Z";
export const TR = `/api/v1/transformations/${TR_ID}`;
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });

const stamps = () => ({ version: 1, createdAt: T, createdBy: USER_ID, updatedAt: T, updatedBy: USER_ID });

export const P3_LEAD: Permission[] = ["initiative.edit", "initiative.launch", "portfolio.select", "gate.decide"];

export function wave(over: Partial<RoadmapWave> = {}): RoadmapWave {
  return {
    id: id(),
    transformationId: TR_ID,
    code: "wave_1",
    ordinal: 1,
    isSourceSeeded: true,
    nameEn: "Wave 1 - Prove",
    nameAr: "الموجة 1 - الإثبات",
    horizonEn: "6-16 weeks",
    horizonAr: "6-16 أسبوعاً",
    plannedStart: null,
    plannedEnd: null,
    status: "active",
    version: 1,
    ...over,
  };
}

export function initiative(over: Partial<Initiative> = {}): Initiative {
  return {
    id: id(),
    organizationId: ORG_ID,
    transformationId: TR_ID,
    code: "INI-01",
    name: "Synthetic digital onboarding",
    executiveOwnerUserId: USER_ID,
    workstreamLeadUserId: null,
    problemStatement: "Synthetic problem statement",
    objective: "Synthetic objective",
    scopeIn: "Synthetic scope in",
    scopeOut: null,
    financialBenefitSummary: null,
    customerBenefitSummary: "Synthetic customer benefit",
    risksSummary: null,
    waveId: null,
    plannedStart: null,
    plannedEnd: null,
    status: "draft",
    fundingState: "not_applicable",
    displayStatus: "initiative.status.draft",
    launchedAt: null,
    launchedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    warnings: [],
    flags: [],
    ...stamps(),
    ...over,
  };
}

export function dispensation(over: Partial<GateDispensation> = {}): GateDispensation {
  return {
    id: id(),
    organizationId: ORG_ID,
    transformationId: TR_ID,
    kind: "waiver",
    gateCode: "G3",
    initiativeId: null,
    reason: "Synthetic pilot waiver",
    approvingBody: null,
    approvedOn: null,
    evidenceId: null,
    evidenceVerified: null,
    expiresOn: "2026-12-31",
    status: "pending",
    counts: false,
    recordedBy: OTHER_USER,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    revokedBy: null,
    revokedAt: null,
    revokeReason: null,
    ...stamps(),
    ...over,
  };
}

export function readiness(over: Partial<TransformationReadiness> = {}): TransformationReadiness {
  const areas = [
    ["economics", ["financial"]],
    ["customer", ["customer"]],
    ["operations", ["process"]],
    ["capability", ["people_org"]],
    ["technology", ["technology", "data"]],
  ] as const;
  return {
    transformationId: TR_ID,
    mode: "end_to_end",
    entryPhase: null,
    currentPhase: "diagnose",
    gates: (["G1", "G2", "G3", "G4"] as const).map((g) => ({ gateCode: g, status: "draft", dispensations: [] })),
    diagnostic: areas.map(([area, dims]) => ({ area, covered: false, dimensions: [...dims], missing: [...dims] })),
    missingDiagnosticAreas: ["economics", "customer", "operations", "capability", "technology"],
    sequencing: {
      canSubmitInitiatives: false,
      canLaunchInitiatives: false,
      blockers: [
        {
          code: "initiative.g1_not_approved",
          message: "Case for change not yet approved (G1): leadership agreement …",
        },
      ],
    },
    ...over,
  };
}

export const EMPTY_HIERARCHY: OutcomeHierarchy = { northStar: null, outcomes: [] };

export type Grants = "lead" | "auditor";

/** The workspace frame (session, units, transformation, catalogue), then `extra`, then empty pages for the rest. */
export function frameHandlers(
  locale: "en" | "ar",
  grants: Grants = "lead",
  extra: Handler[] = [],
  transformation: Parameters<typeof makeTransformation>[0] = {},
): Handler[] {
  return [
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(grants === "lead" ? leadGrants(P3_LEAD) : AUDITOR_GRANTS, { preferredLocale: locale }),
    })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation(transformation) })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    ...extra,
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  ];
}

/** An ApiError-shaped problem body (`problem()` of the shared fixtures plus `type` overrides). */
export function problemBody(
  status: number,
  type: string,
  code: string,
  detail: string,
  errors: { pointer: string; code: string; message: string }[] = [],
) {
  return { status, body: { type, title: "Business rule violated", status, code, detail, errors, requestId: "req-1" } };
}
