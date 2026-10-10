// SYNTHETIC fixtures of the slice E screens (T-DG4-FE-D). No real person, organization, risk or decision.
import { TR_ID, USER_ID } from "../../test/fixtures.tsx";
import { T0, id } from "../my-work/p4fixtures.ts";
import type { CorrectiveActionRule, CorrectiveCase, CorrectiveSignal, RaidAction, RaidEntry } from "./api.ts";

export const RISK_ID = id();
export const ISSUE_ID = id();
export const DEP_ID = id();
export const CASE_ID = id();
export const ACTION_ID = id();
export const INITIATIVE_A = id();
export const INITIATIVE_B = id();
export const BENEFIT_ID = id();

export function raidEntry(over: Partial<RaidEntry> = {}): RaidEntry {
  return {
    id: RISK_ID,
    transformationId: TR_ID,
    type: "risk",
    code: "R-01",
    description: "Synthetic vendor delay risk",
    impact: "high",
    probability: "medium",
    ownerUserId: USER_ID,
    dueDate: "2026-11-15",
    mitigation: "Synthetic second supplier",
    status: "open",
    recordStatus: "open",
    recordTable: "raid_entry",
    initiativeId: null,
    closedAt: null,
    closedBy: null,
    closureNote: null,
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export const issueEntry = () =>
  raidEntry({
    id: ISSUE_ID,
    type: "issue",
    code: "I-01",
    description: "Synthetic data feed outage",
    probability: null,
  });

export const dependencyEntry = (over: Partial<RaidEntry> = {}) =>
  raidEntry({
    id: DEP_ID,
    type: "dependency",
    code: "DEP-01",
    description: "Synthetic billing API needed by onboarding",
    probability: null,
    recordTable: "dependency",
    recordStatus: "open",
    ...over,
  });

export function raidAction(over: Partial<RaidAction> = {}): RaidAction {
  return {
    id: ACTION_ID,
    transformationId: TR_ID,
    title: "Synthetic call the vendor",
    description: null,
    ownerUserId: USER_ID,
    dueDate: "2026-10-05",
    followUpDate: "2026-10-08",
    status: "open",
    sourceKind: "raid_entry",
    sourceWorkshopItemId: null,
    raidEntryId: RISK_ID,
    dependencyId: null,
    correctiveCaseId: null,
    overdue: true,
    version: 2,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

export function correctiveCase(over: Partial<CorrectiveCase> = {}): CorrectiveCase {
  return {
    id: CASE_ID,
    transformationId: TR_ID,
    code: "CA-01",
    sourceKind: "benefit_variance",
    sourceScopeKey: `benefit:${BENEFIT_ID}`,
    kpiDefinitionId: null,
    kpiScopeKind: null,
    kpiScopeId: null,
    benefitId: BENEFIT_ID,
    benefitLifecycleStep: "correct",
    sourceRecordType: null,
    sourceRecordId: null,
    title: "Synthetic churn benefit below plan",
    recoveryPlan: null,
    ownerUserId: null,
    ownerStatus: "unassigned",
    followUpDate: null,
    followUpUnknownReason: "calendar_not_configured",
    status: "open",
    consecutiveOffTrack: null,
    signalCount: 2,
    lastSignalAt: T0,
    closedAt: null,
    closedBy: null,
    closureNote: null,
    createdSource: "worker",
    version: 2,
    createdAt: T0,
    createdBy: null,
    updatedAt: T0,
    updatedBy: null,
    ...over,
  };
}

export function signal(over: Partial<CorrectiveSignal> = {}): CorrectiveSignal {
  return {
    id: id(),
    sourceKind: "kpi_deviation",
    sourceEventKey: "kpi.deviation_evaluated:synthetic:1",
    periodKey: "2026-09",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    observedRag: "unknown",
    offTrack: null,
    rulePersistence: 2,
    consecutiveOffTrack: 0,
    outcome: "recorded",
    correctiveCaseId: CASE_ID,
    receivedAt: T0,
    ...over,
  };
}

export const rules = (): CorrectiveActionRule[] => [
  {
    id: null,
    sourceKind: "kpi_deviation",
    minKpiRag: "red",
    persistenceCycles: 2,
    followUpWorkingDays: 5,
    enabled: true,
    isDefault: true,
    version: null,
  },
  {
    id: id(),
    sourceKind: "control_check",
    minKpiRag: null,
    persistenceCycles: 1,
    followUpWorkingDays: 3,
    enabled: true,
    isDefault: false,
    version: 4,
  },
];
