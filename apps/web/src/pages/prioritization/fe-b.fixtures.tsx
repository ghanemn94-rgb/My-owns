// SYNTHETIC test fixtures for the FE-B screens (prioritization, roadmap, dependencies, capacity). Shapes follow the
// contract components (docs/api/openapi.yaml) and the shared mirrors; every value is invented test data.
import type { Permission } from "@mth/shared";
import type {
  Deliverable,
  Initiative,
  Milestone,
  PrioritizationItem,
  PrioritizationView,
  WeightSet,
} from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import {
  BUSINESS_UNIT,
  ORG_ID,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  mockApi,
  renderApp,
  route,
  type Handler,
} from "../../test/fixtures.tsx";
import { AUDITOR_GRANTS, METHODOLOGY, OTHER_USER, leadGrants } from "../../test/p2fixtures.ts";
import type { RoadmapView, RoadmapWave, T08Dependency } from "../roadmap/api.ts";

export const TR = `/api/v1/transformations/${TR_ID}`;
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const T0 = "2026-10-01T08:00:00Z";
const stamps = { version: 1, createdAt: T0, createdBy: USER_ID, updatedAt: T0, updatedBy: USER_ID };

export const INI = (n: number) => `01920000-0000-7000-b000-0000000000${String(n).padStart(2, "0")}`;

export function initiative(n: number, over: Partial<Initiative> = {}): Initiative {
  return {
    id: INI(n),
    organizationId: ORG_ID,
    transformationId: TR_ID,
    code: `INI-0${n}`,
    name: `Synthetic initiative ${n}`,
    executiveOwnerUserId: null,
    workstreamLeadUserId: null,
    problemStatement: null,
    objective: null,
    scopeIn: null,
    scopeOut: null,
    financialBenefitSummary: null,
    customerBenefitSummary: null,
    risksSummary: null,
    waveId: null,
    plannedStart: null,
    plannedEnd: null,
    status: "submitted",
    fundingState: "not_applicable",
    displayStatus: "initiative.status.submitted",
    launchedAt: null,
    launchedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    warnings: [],
    flags: [],
    ...stamps,
    ...over,
  };
}

export const V1: WeightSet = {
  id: "01920000-0000-7000-c000-000000000001",
  organizationId: ORG_ID,
  transformationId: TR_ID,
  versionNo: 1,
  status: "active",
  approvalBasis: "source_default",
  rationale: null,
  weights: [
    { criterionCode: "strategic_fit", weightPercent: "25.00" },
    { criterionCode: "financial_value", weightPercent: "25.00" },
    { criterionCode: "customer_impact", weightPercent: "20.00" },
    { criterionCode: "feasibility", weightPercent: "15.00" },
    { criterionCode: "time_to_value", weightPercent: "15.00" },
  ],
  approvedBy: null,
  approvedAt: null,
  activatedAt: T0,
  supersededAt: null,
  ...stamps,
};

export function proposedV2(proposer: string): WeightSet {
  return {
    ...V1,
    id: "01920000-0000-7000-c000-000000000002",
    versionNo: 2,
    status: "proposed",
    approvalBasis: null,
    rationale: "Regulated context: add risk/compliance",
    weights: [
      { criterionCode: "strategic_fit", weightPercent: "15.00" },
      { criterionCode: "financial_value", weightPercent: "25.00" },
      { criterionCode: "customer_impact", weightPercent: "20.00" },
      { criterionCode: "feasibility", weightPercent: "15.00" },
      { criterionCode: "time_to_value", weightPercent: "15.00" },
      { criterionCode: "risk_compliance", weightPercent: "10.00" },
    ],
    activatedAt: null,
    version: 4,
    createdBy: proposer,
  };
}

/** INI-01 complete at 3.3000 (5,4,3,2,1 under v1), INI-02 incomplete (time_to_value missing). */
export function prioritizationView(): PrioritizationView {
  const complete: PrioritizationItem = {
    initiative: initiative(1, { status: "ranked" }),
    result: {
      weightSetVersionNo: 1,
      completeness: "complete",
      weightedScore: "3.3000",
      weightedScoreDisplay: "3.30",
      display100: "57.5",
      conversion: "(score-1)/4*100",
      missingCriteria: [],
      computedAt: T0,
    },
    rank: 1,
    valueAxis: "3.5556",
    feasibilityAxis: "1.5000",
    selection: "not_selected",
    funding: "not_applicable",
    flags: [],
  };
  const incomplete: PrioritizationItem = {
    initiative: initiative(2),
    result: {
      weightSetVersionNo: 1,
      completeness: "incomplete",
      weightedScore: null,
      weightedScoreDisplay: null,
      display100: null,
      conversion: "(score-1)/4*100",
      missingCriteria: ["time_to_value"],
      computedAt: T0,
    },
    rank: null,
    valueAxis: "4.0000",
    feasibilityAxis: null,
    selection: "not_selected",
    funding: "not_applicable",
    flags: [{ code: "schedule.unknown", message: "Unknown" }],
  };
  return {
    transformationId: TR_ID,
    weightSet: V1,
    conversionLabel: "0–100 view = (weighted score − 1) ÷ 4 × 100",
    items: [complete, incomplete],
  };
}

export const WAVES: RoadmapWave[] = [
  [
    "wave_0",
    0,
    "Wave 0 — Mobilize",
    "Baseline, governance, design decisions",
    "0-6 weeks",
    "Sponsor + charter",
    "Approved case, owners, stage gates",
    0,
    6,
  ],
  [
    "wave_1",
    1,
    "Wave 1 — Prove",
    "Quick wins / pilots / de-risking",
    "1-3 months",
    "Prioritized initiatives",
    "Measured pilot results",
    4,
    13,
  ],
  [
    "wave_2",
    2,
    "Wave 2 — Scale",
    "Scale validated changes",
    "3-9 months",
    "Evidence + capacity",
    "Adoption + KPI movement",
    13,
    39,
  ],
  [
    "wave_3",
    3,
    "Wave 3 — Embed",
    "BAU integration / optimization",
    "6-18 months",
    "Stable solution",
    "Benefits sustained, ownership transferred",
    26,
    78,
  ],
].map(([code, ordinal, name, purpose, horizon, entry, exit, from, to], i) => ({
  id: `01920000-0000-7000-d000-00000000000${i}`,
  transformationId: TR_ID,
  code: code as string,
  ordinal: ordinal as number,
  isSourceSeeded: true,
  sourceRef: "B0079",
  nameEn: name as string,
  nameAr: `الموجة ${i} (ترجمة مؤقتة)`,
  purposeEn: purpose as string,
  purposeAr: `غرض الموجة ${i}`,
  horizonEn: horizon as string,
  horizonAr: `أفق الموجة ${i}`,
  entryCriteriaEn: entry as string,
  entryCriteriaAr: `معايير دخول ${i}`,
  exitEvidenceEn: exit as string,
  exitEvidenceAr: `أدلة خروج ${i}`,
  horizonFromWeeks: from as number,
  horizonToWeeks: to as number,
  plannedStart: null,
  plannedEnd: null,
  ownerUserId: null,
  notes: null,
  status: "active",
  version: 1,
}));

export const MS_ID = "01920000-0000-7000-e000-000000000001";
export function milestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: MS_ID,
    organizationId: ORG_ID,
    transformationId: TR_ID,
    initiativeId: INI(1),
    waveId: WAVES[1]!.id,
    title: "Pilot go-live",
    description: null,
    ownerUserId: null,
    approvedDate: "2026-11-15",
    approvedBy: OTHER_USER,
    approvedAt: T0,
    approvalReason: "Initial baseline",
    forecastDate: "2026-11-20",
    actualDate: null,
    varianceDays: 5,
    status: "planned",
    ...stamps,
    version: 3,
    ...over,
  };
}

export function deliverable(over: Partial<Deliverable> = {}): Deliverable {
  return {
    id: "01920000-0000-7000-e000-000000000101",
    organizationId: ORG_ID,
    transformationId: TR_ID,
    initiativeId: INI(1),
    title: "Pilot report",
    description: null,
    ownerUserId: null,
    dueDate: "2026-12-01",
    ordinal: 1,
    acceptanceStatus: "submitted",
    submittedBy: OTHER_USER,
    submittedAt: T0,
    decidedBy: null,
    decidedAt: null,
    acceptanceNote: null,
    status: "active",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    ...stamps,
    version: 2,
    ...over,
  };
}

export function dependency(over: Partial<T08Dependency> = {}): T08Dependency {
  return {
    id: "01920000-0000-7000-f000-000000000001",
    transformationId: TR_ID,
    code: "DEP-01",
    description: "Data platform ready",
    fromKind: "initiative",
    fromLabel: null,
    fromInitiativeId: INI(1),
    toKind: "initiative",
    toLabel: null,
    toInitiativeId: INI(2),
    dependencyType: "data",
    neededBy: "2026-11-10",
    ownerUserId: null,
    status: "open",
    mitigation: "Weekly sync",
    decisionId: null,
    flags: [
      { code: "schedule.needed_by_conflict", message: "x", dependencyId: "01920000-0000-7000-f000-000000000001" },
    ],
    archivedAt: null,
    version: 1,
    ...over,
  };
}

export function roadmapView(over: Partial<RoadmapView> = {}): RoadmapView {
  return {
    transformationId: TR_ID,
    waves: WAVES,
    initiatives: [
      initiative(1, { status: "selected", waveId: WAVES[1]!.id, plannedStart: "2026-10-15", plannedEnd: "2027-01-31" }),
      initiative(2, { status: "submitted", flags: [{ code: "schedule.unknown", message: "Unknown" }] }),
    ],
    milestones: [milestone()],
    deliverables: [deliverable()],
    dependencies: [],
    ...over,
  };
}

/** Grants of a Transformation Lead plus the given P3 permissions (UI hints only). */
export const grants = (extra: Permission[]) => leadGrants(extra);
export { AUDITOR_GRANTS, OTHER_USER, TR_ID, USER_ID };

/** Renders a workspace page with the frame's handlers, the page's own handlers and an empty-page fallback. */
export function renderWorkspace(
  path: string,
  locale: "ar" | "en",
  meGrants: Parameters<typeof makeMe>[0],
  handlers: Handler[],
) {
  const all: Handler[] = [
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(meGrants, { preferredLocale: locale }) })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation() })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    ...handlers,
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  ];
  const api = mockApi(...all);
  const app = renderApp(`/transformations/${TR_ID}/${path}`, { i18n: createI18n(locale) });
  return { api, app };
}
