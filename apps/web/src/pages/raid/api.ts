// Slice E web seams (T-DG4-FE-D; p4-work-split §E.5; ADR-0031): the request paths and read hooks of the T15 RAID
// register, the integrated RAID + decision log, the action register, corrective-action cases and their rules. Query
// keys come from FE-A's `p4Keys.area(<slice E area>, tid, …)` (api/p4.ts), so `useP4Refresh(tid)` refreshes every
// view of the transformation after a mutation. Writes are sent by the screens with `api.send` (If-Match from the
// record's `version`) inside a session guard. SYNTHETIC data only in tests and demos.
//
// Unknown is data, never a default: a null follow-up date, owner or probability stays null here and renders as
// Unknown, "unassigned" or "n/a" (never 0, never green; S-5, ADR-0031 §13).
import { useQuery } from "@tanstack/react-query";
import type {
  CorrectiveActionRule,
  CorrectiveCase,
  CorrectiveSignal,
  RaidAction,
  RaidDecisionLogItem,
  RaidEntry,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";
import type { Initiative } from "../../api/types.ts";

export type {
  CorrectiveActionRule,
  CorrectiveCase,
  CorrectiveSignal,
  Initiative,
  RaidAction,
  RaidDecisionLogItem,
  RaidEntry,
};

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;

/** The paths of the slice E operations the screens call (operationId in the comment). */
export const raidPaths = {
  // T15 register (BE-D)
  entries: (tid: string) => `${tBase(tid)}/raid`, // listRaidEntries / createRaidEntry
  entry: (tid: string, id: string) => `${tBase(tid)}/raid/${id}`, // getRaidEntry / updateRaidEntry
  close: (tid: string, id: string) => `${tBase(tid)}/raid/${id}/close`, // closeRaidEntry
  entryActions: (tid: string, id: string) => `${tBase(tid)}/raid/${id}/actions`, // listRaidEntryActions / createRaidEntryAction
  decisionLog: (tid: string) => `${tBase(tid)}/raid-decision-log`, // getRaidDecisionLog
  // action register (BE-D)
  actions: (tid: string) => `${tBase(tid)}/action-register`, // listActionRegister
  action: (tid: string, id: string) => `${tBase(tid)}/action-register/${id}`, // getActionRegisterItem / updateActionRegisterItem
  // corrective-action cases and rules (BE-D2)
  cases: (tid: string) => `${tBase(tid)}/corrective-actions`, // listCorrectiveCases / createCorrectiveCase
  case: (tid: string, id: string) => `${tBase(tid)}/corrective-actions/${id}`, // getCorrectiveCase / updateCorrectiveCase
  caseClose: (tid: string, id: string) => `${tBase(tid)}/corrective-actions/${id}/close`, // closeCorrectiveCase
  caseSignals: (tid: string, id: string) => `${tBase(tid)}/corrective-actions/${id}/signals`, // listCorrectiveCaseSignals
  caseActions: (tid: string, id: string) => `${tBase(tid)}/corrective-actions/${id}/actions`, // listCorrectiveCaseActions / createCorrectiveCaseAction
  rules: (tid: string) => `${tBase(tid)}/corrective-action-rules`, // listCorrectiveActionRules / createCorrectiveActionRule
  rule: (tid: string, kind: string) => `${tBase(tid)}/corrective-action-rules/${kind}`, // updateCorrectiveActionRule
} as const;

const opts = { retry: shouldRetry, staleTime: 15_000 } as const;

export function useRaidEntries(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("raid", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<RaidEntry>(raidPaths.entries(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useRaidEntry(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("raid", tid, "entry", id),
    queryFn: () => api.get<RaidEntry>(raidPaths.entry(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useRaidEntryActions(tid: string, id: string, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("actions", tid, "raid-entry", id),
    queryFn: () => fetchAllPages<RaidAction>(raidPaths.entryActions(tid, id)),
    enabled: Boolean(tid && id) && enabled,
    ...opts,
  });
}

export function useRaidDecisionLog(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("raid", tid, "decision-log"),
    queryFn: () => fetchAllPages<RaidDecisionLogItem>(raidPaths.decisionLog(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useActionRegister(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("actions", tid, "register", JSON.stringify(query)),
    queryFn: () => fetchAllPages<RaidAction>(raidPaths.actions(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useActionRegisterItem(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("actions", tid, "item", id),
    queryFn: () => api.get<RaidAction>(raidPaths.action(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useCorrectiveCases(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("corrective-actions", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<CorrectiveCase>(raidPaths.cases(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useCorrectiveCase(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("corrective-actions", tid, "case", id),
    queryFn: () => api.get<CorrectiveCase>(raidPaths.case(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useCorrectiveSignals(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("corrective-actions", tid, "signals", id),
    queryFn: () => fetchAllPages<CorrectiveSignal>(raidPaths.caseSignals(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useCorrectiveCaseActions(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("actions", tid, "corrective-case", id),
    queryFn: () => fetchAllPages<RaidAction>(raidPaths.caseActions(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useCorrectiveRules(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("corrective-actions", tid, "rules"),
    queryFn: () => fetchAllPages<CorrectiveActionRule>(raidPaths.rules(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** The transformation's initiatives (DG3): the From/To of a Dependency entry. */
export function useRaidInitiativeOptions(tid: string, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("raid", tid, "initiative-options"),
    queryFn: () => fetchAllPages<Initiative>(`${v1}/initiatives`, { transformationId: tid }),
    enabled: Boolean(tid) && enabled,
    ...opts,
  });
}
