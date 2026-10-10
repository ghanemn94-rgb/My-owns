// SYNTHETIC fixtures of the slice D screens (T-DG4-FE-D). No real person, organization, meeting or decision.
import { TR_ID, USER_ID } from "../../test/fixtures.tsx";
import { OTHER_USER, T0, id } from "../my-work/p4fixtures.ts";
import type {
  AgendaItem,
  DecisionEscalation,
  EscalationRule,
  ExecutiveDecision,
  Forum,
  Meeting,
  MeetingMinutes,
  MeetingSeries,
} from "./api.ts";

export const FORUM_ID = id();
export const SERIES_ID = id();
export const MEETING_ID = id();
export const PAST_MEETING_ID = id();
export const ITEM_ID = id();
export const DECISION_ID = id();

const LAYERS = [
  ["executive_steerco", "Executive SteerCo", "Monthly"],
  ["transformation_review", "Transformation Review", "Bi-weekly"],
  ["workstream_review", "Workstream Review", "Weekly"],
  ["rapid_response", "Rapid Response / Sprint", "Daily / 2-3x week"],
  ["value_review", "Value Review", "Monthly"],
] as const;

export function forum(i = 2, over: Partial<Forum> = {}): Forum {
  const [key, layer, cadence] = LAYERS[i]!;
  return {
    id: i === 2 ? FORUM_ID : id(),
    transformationId: TR_ID,
    templateKey: key,
    source: {
      layerEn: layer,
      cadenceEn: cadence,
      purposeEn: `Synthetic purpose of ${layer}`,
      participantsEn: `Synthetic participants of ${layer}`,
      outputsEn: `Synthetic outputs of ${layer}`,
      layerAr: `طبقة ${i + 1}`,
      cadenceAr: `إيقاع ${i + 1}`,
      purposeAr: "غرض اصطناعي",
      participantsAr: "مشاركون اصطناعيون",
      outputsAr: "مخرجات اصطناعية",
      arProvisional: true,
      sourceRef: "B0093",
    },
    ordinal: i + 1,
    nameEn: layer,
    nameAr: `منتدى ${i + 1}`,
    cadenceLabel: cadence,
    purpose: `Synthetic purpose of ${layer}`,
    participantsLabel: "Synthetic participants",
    outputsLabel: "Synthetic outputs",
    chairPartyCode: "TL",
    secretaryUserId: null,
    participantParties: [],
    outputKinds: ["decision", "action", "raid"],
    publishRequiresAnyOutput: i === 4 ? ["benefit_evidence", "forecast"] : [],
    executiveAsksOnly: i === 0,
    quorumMin: null,
    cutoffWorkingDays: 2,
    agendaMaxItems: null,
    lateItemsRule: "flag",
    status: "active",
    activeSeriesId: i === 2 ? SERIES_ID : null,
    version: 1,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

export const fiveForums = () => [0, 1, 2, 3, 4].map((i) => forum(i));

export function series(over: Partial<MeetingSeries> = {}): MeetingSeries {
  return {
    id: SERIES_ID,
    transformationId: TR_ID,
    forumId: FORUM_ID,
    frequency: "weekly",
    intervalCount: 1,
    weekdays: [7],
    monthDay: null,
    startDate: "2026-10-04",
    endDate: null,
    startTime: "10:00",
    durationMinutes: 60,
    timezone: "Asia/Riyadh",
    nonWorkingDayRule: "next_working_day",
    horizonDays: 90,
    location: null,
    ruleVersion: 1,
    generatedThrough: "2026-12-31",
    status: "active",
    endedAt: null,
    endedBy: null,
    version: 3,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

export function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: MEETING_ID,
    transformationId: TR_ID,
    forumId: FORUM_ID,
    seriesId: SERIES_ID,
    seriesRuleVersion: 1,
    occurrenceDate: "2026-10-11",
    scheduledDate: "2026-10-11",
    startsAt: "2026-10-11T07:00:00Z",
    endsAt: "2026-10-11T08:00:00Z",
    timezone: "Asia/Riyadh",
    location: null,
    chairUserId: USER_ID,
    secretaryUserId: null,
    quorumMin: null,
    presentCount: 1,
    quorumState: "not_configured",
    cutoffDate: null,
    cutoffUnknownReason: "calendar_not_configured",
    status: "in_session",
    cancelReason: null,
    cancelNote: null,
    cancelledAt: null,
    cancelledBy: null,
    startedAt: T0,
    heldAt: null,
    createdSource: "worker",
    version: 4,
    createdAt: T0,
    createdBy: null,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

export function agendaItem(over: Partial<AgendaItem> = {}): AgendaItem {
  return {
    id: ITEM_ID,
    meetingId: MEETING_ID,
    ordinal: 1,
    itemKind: "executive_ask",
    title: "Synthetic vendor switch ask",
    description: null,
    presenterUserId: null,
    durationMinutes: null,
    materialsEvidenceIds: [],
    decisionId: null,
    brief: {
      decisionRequired: "Synthetic switch vendor?",
      whyNow: "Synthetic contract renewal",
      options: ["Stay", "Switch"],
      recommendation: "Switch",
      impactOfDelay: null,
      ownerUserId: USER_ID,
      requiredDate: null,
    },
    missingElements: ["impact_of_delay", "required_date"],
    late: false,
    status: "draft",
    publishedAt: null,
    publishedBy: null,
    outcome: null,
    outcomeQuorumPresent: null,
    outcomeRecordedAt: null,
    outcomeRecordedBy: null,
    version: 1,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

export function minutes(over: Partial<MeetingMinutes> = {}): MeetingMinutes {
  return {
    id: id(),
    meetingId: MEETING_ID,
    body: "Synthetic minutes body",
    status: "published",
    approvedAt: T0,
    approvedBy: USER_ID,
    publishedAt: T0,
    publishedBy: USER_ID,
    version: 3,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

const option = (label: string, title: string) => ({
  id: id(),
  organizationId: "01920000-0000-7000-9000-000000000001",
  transformationId: TR_ID,
  decisionId: DECISION_ID,
  label,
  title,
  description: null,
  ordinal: label.charCodeAt(0) - 64,
  status: "active" as const,
  version: 1,
  createdAt: T0,
  createdBy: USER_ID,
  updatedAt: T0,
  updatedBy: USER_ID,
});

export function executiveDecision(over: Partial<ExecutiveDecision> = {}): ExecutiveDecision {
  return {
    id: DECISION_ID,
    transformationId: TR_ID,
    code: "DEC-01",
    decision: "Synthetic fund the second wave?",
    whyNow: "Synthetic budget cycle closes",
    options: [option("A", "Fund now"), option("B", "Defer a quarter")],
    recommendationOptionLabel: "A",
    recommendationText: "Synthetic fund now",
    ownerUserId: USER_ID,
    ownerStatus: "assigned",
    decisionDate: "2026-10-05",
    impactOfDelay: "Synthetic three-month slip",
    outcome: null,
    chosenOptionLabel: null,
    status: "open",
    overdue: true,
    askOrigin: "api",
    createdSource: "api",
    sourceAgendaItemId: null,
    decisionRightId: null,
    slaDueDate: null,
    slaUnknownReason: null,
    blockerRecordType: null,
    blockerRecordId: null,
    missingElements: [],
    escalationLevel: 1,
    decidedAt: null,
    decidedBy: null,
    decidedOnBehalfOfUserId: null,
    version: 2,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

/** A DG3 funding decision listed in T16 without the T16 columns it never had. */
export const earlierDecision = () =>
  executiveDecision({
    id: id(),
    code: "DEC-02",
    decision: "Synthetic earlier funding decision",
    whyNow: null,
    options: [],
    recommendationOptionLabel: null,
    recommendationText: null,
    impactOfDelay: null,
    askOrigin: "earlier_record",
    overdue: false,
    status: "decided",
    outcome: "Synthetic funded",
  });

export function escalation(over: Partial<DecisionEscalation> = {}): DecisionEscalation {
  return {
    id: id(),
    decisionId: DECISION_ID,
    decisionCode: "DEC-01",
    slaDueDate: "2026-10-05",
    businessDate: "2026-10-06",
    level: 1,
    partyCode: "SP",
    targetUserId: null,
    targetGroupId: null,
    routingError: "party_unmapped",
    delayImpact: "Synthetic three-month slip",
    escalatedAt: T0,
    ...over,
  };
}

export const escalationRules = (): EscalationRule[] => [
  {
    id: null,
    ruleKind: "decision_sla",
    isDefault: true,
    enabled: true,
    escalationChain: ["SP"],
    redCycles: null,
    deadlineWorkingDays: null,
    ownerPartyCode: null,
    version: null,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: id(),
    ruleKind: "blocker_red",
    isDefault: false,
    enabled: true,
    escalationChain: null,
    redCycles: 2,
    deadlineWorkingDays: 10,
    ownerPartyCode: "SP",
    version: 2,
    createdAt: T0,
    updatedAt: T0,
  },
];

export { OTHER_USER };
