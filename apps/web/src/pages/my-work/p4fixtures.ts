// SYNTHETIC fixtures of the P4 slice I and C screens (T-DG4-FE-A). No real person, organization or approval.
import type { Permission } from "@mth/shared";
import type {
  Approval,
  BusinessCalendar,
  DecisionRight,
  Delegation,
  GovernanceMatrix,
  GovernanceParty,
  InboxNotification,
  Raci,
  RoleMapping,
  WorkItem,
} from "../../api/p4.ts";
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
import { METHODOLOGY, OTHER_USER, id } from "../../test/p2fixtures.ts";

export const T0 = "2026-10-01T09:00:00Z";
export const TRP = `/api/v1/transformations/${TR_ID}`;
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
export const json = (body: unknown) => ({ status: 200, body });
export { OTHER_USER, id };

export const READ: Permission[] = ["organization.read", "business_unit.read", "role.read", "transformation.read"];

/** Grants on the organization (inheriting downward), e.g. a Sponsor with approval.decide. */
export const orgGrants = (permissions: Permission[]) => [
  {
    scope: { type: "organization" as const, id: ORG_ID },
    inheritsDownward: true,
    permissions: [...READ, ...permissions],
  },
];

export function p4Handlers(locale: "en" | "ar", permissions: Permission[], extra: Handler[] = []): Handler[] {
  return [
    route("GET", /\/api\/v1\/me$/, () => json(makeMe(orgGrants(permissions), { preferredLocale: locale }))),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TRP)}$`), () => json(makeTransformation())),
    route("GET", new RegExp(`${esc(TRP)}/methodology$`), () => json(METHODOLOGY)),
    ...extra,
    route("GET", /\/api\/v1\/me\/inbox/, () => json({ items: [], nextCursor: null, unreadCount: 0 })),
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  ];
}

export function approval(over: Partial<Approval> = {}): Approval {
  return {
    id: id(),
    transformationId: TR_ID,
    approvalType: "decision_request",
    subjectType: "decision",
    subjectId: id(),
    subjectVersion: 3,
    roundNo: 1,
    decisionRightId: id(),
    title: "Synthetic scope change",
    requestNote: null,
    requestedBy: OTHER_USER,
    requestedAt: T0,
    requestBusinessDate: "2026-10-01",
    assignee: { partyCode: "SP", userId: USER_ID, groupId: null },
    slaType: "working_days",
    urgentReason: null,
    dueDate: "2026-10-08",
    dueUnknownReason: null,
    calendarId: id(),
    status: "pending",
    escalationLevel: 0,
    escalatedTo: null,
    decidedBy: null,
    decidedOnBehalfOf: null,
    decidedAt: null,
    decisions: [],
    escalations: [],
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function workItem(over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: id(),
    organizationId: ORG_ID,
    transformationId: TR_ID,
    kind: "kpi_update_due",
    assigneeUserId: USER_ID,
    subjectType: "kpi_definition",
    subjectId: id(),
    linkPath: `/transformations/${TR_ID}/kpis`,
    messageKey: "kpi.update_due",
    messageParams: { kpiName: "Synthetic NPS", periodLabel: "2026-09" },
    dueDate: null,
    periodLabel: "2026-09",
    status: "open",
    completedAt: null,
    completedBy: null,
    createdAt: T0,
    version: 1,
    ...over,
  };
}

export function notification(over: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id: id(),
    transformationId: TR_ID,
    workItemId: null,
    linkPath: "/my-work/approvals/x",
    messageKey: "approvals.task.outcome",
    messageParams: { title: "Synthetic scope change", roundNo: 1, outcome: "approved" },
    readAt: null,
    createdAt: T0,
    version: 1,
    ...over,
  };
}

export function delegation(over: Partial<Delegation> = {}): Delegation {
  return {
    id: id(),
    organizationId: ORG_ID,
    delegatorUserId: USER_ID,
    delegateUserId: OTHER_USER,
    scopeType: null,
    scopeId: null,
    recordTypes: null,
    reasonCode: "absence",
    reasonText: null,
    absenceNote: "Synthetic annual leave",
    requestedByUserId: null,
    effectiveFrom: "2026-10-10T05:00:00Z",
    effectiveTo: "2026-10-20T05:00:00Z",
    status: "active",
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    version: 1,
    createdAt: T0,
    ...over,
  };
}

export function calendar(over: Partial<BusinessCalendar> = {}): BusinessCalendar {
  return {
    id: id(),
    organizationId: ORG_ID,
    code: "DEFAULT",
    nameEn: "Synthetic default calendar",
    nameAr: "تقويم افتراضي اصطناعي",
    timezone: "Asia/Riyadh",
    workweek: [1, 2, 3, 4, 7],
    isDefault: true,
    status: "active",
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export const PARTIES: GovernanceParty[] = [
  {
    code: "SP",
    ordinal: 1,
    kind: "role",
    roleCode: "SP",
    labelEn: "Executive Sponsor",
    labelAr: "الراعي التنفيذي",
    sourceRef: "B0018",
  },
  {
    code: "TL",
    ordinal: 2,
    kind: "role",
    roleCode: "TL",
    labelEn: "Transformation Lead",
    labelAr: "قائد التحوّل",
    sourceRef: "B0018",
  },
  {
    code: "BO",
    ordinal: 3,
    kind: "role",
    roleCode: "BO",
    labelEn: "Business Owner",
    labelAr: "المالك التشغيلي للأعمال",
    sourceRef: "B0018",
  },
  {
    code: "FIN",
    ordinal: 5,
    kind: "office",
    roleCode: "FIN",
    labelEn: "Finance",
    labelAr: "الإدارة المالية",
    sourceRef: "B0018",
  },
];

export function roleMapping(over: Partial<RoleMapping> = {}): RoleMapping {
  return {
    id: id(),
    transformationId: TR_ID,
    partyCode: "SP",
    targetKind: "user",
    userId: OTHER_USER,
    groupId: null,
    targetDisplayName: "Synthetic Sponsor",
    status: "active",
    endedAt: null,
    endedBy: null,
    endReason: null,
    version: 1,
    createdAt: T0,
    ...over,
  };
}

export function matrix(kind: "decision_rights" | "raci", over: Partial<GovernanceMatrix> = {}): GovernanceMatrix {
  return {
    id: id(),
    transformationId: TR_ID,
    kind,
    status: "draft",
    approvedVersion: null,
    approvedAt: null,
    approvedBy: null,
    openApprovalId: null,
    version: 2,
    updatedAt: T0,
    ...over,
  };
}

export function decisionRight(over: Partial<DecisionRight> = {}): DecisionRight {
  return {
    id: id(),
    transformationId: TR_ID,
    templateKey: "business_scope_change",
    ordinal: 1,
    decisionEn: "Business scope change",
    decisionAr: "تغيير نطاق الأعمال",
    recommendLabel: "Transformation Lead",
    approveLabel: "Executive Sponsor",
    consultLabel: "Business Owners, Finance",
    informLabel: "Steering forum",
    slaLabel: "5 working days",
    recommendParties: ["TL"],
    approvePartyCode: "SP",
    consultParties: ["BO", "FIN"],
    informParties: [],
    slaType: "working_days",
    slaWorkingDays: 5,
    urgentWorkingDays: null,
    escalationChain: ["SP"],
    status: "active",
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function raci(m: GovernanceMatrix): Raci {
  const parties = ["SP", "TL", "BO", "FIN"];
  const row = (key: string, en: string, ar: string, values: (string | null)[], v = 1) => ({
    id: id(),
    transformationId: TR_ID,
    templateKey: key,
    ordinal: 1,
    labelEn: en,
    labelAr: ar,
    accountabilityException: null,
    status: "active" as const,
    cells: parties.map((p, i) => ({ partyCode: p, value: values[i] ?? null })),
    version: v,
    updatedAt: T0,
  });
  return {
    transformationId: TR_ID,
    matrix: m,
    parties,
    deliverables: [row("charter", "Transformation charter", "ميثاق التحوّل", ["A", "R", "C", "C"], 4)],
  };
}
