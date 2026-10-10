// Slice E execution web seams (T-DG4-FE-D2; p4-work-split §E.5 second sentence; ADR-0031 §7-§11): the request paths
// and read hooks of the 9 BE-E operations (budget lines, the initiative execution view, the schedule network and the
// initiative duration). Query keys come from FE-A's `p4Keys.area("budget-lines" | "schedule-network", tid, …)`
// (api/p4.ts), so `useP4Refresh(tid)` refreshes every view of the transformation after a mutation. Writes are sent by
// the panels with `api.send` (If-Match from the record's `version`) inside a session guard. SYNTHETIC data only in
// tests and demos.
//
// Unknown is data, never a default: a null amount, an `unknown` total or slip and a `not_computable` network stay so
// here and render as Unknown with their reason (never 0, never green, never "critical"; S-5, ADR-0031 §13, E.8 item 8).
import { useQuery } from "@tanstack/react-query";
import {
  initiativeExecution,
  scheduleNetwork,
  type BudgetLine,
  type ExecutionAmount,
  type ExecutionBudgetTotal,
  type InitiativeExecution,
  type InitiativeSchedule,
  type ScheduleNetwork,
  type WorkingDaySlip,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  BudgetLine,
  ExecutionAmount,
  ExecutionBudgetTotal,
  InitiativeExecution,
  InitiativeSchedule,
  ScheduleNetwork,
  WorkingDaySlip,
};

/** The page namespace whose `executionP4.problem.*` texts are tried before `problems.*`. */
export const EXECUTION_NS = ["executionP4"] as const;

const v1 = "/api/v1";

/** The paths of the BE-E operations the panels call (operationId in the comment). */
export const executionPaths = {
  budgetLines: (initiativeId: string) => `${v1}/initiatives/${initiativeId}/budget-lines`, // listBudgetLines / createBudgetLine
  budgetLine: (id: string) => `${v1}/budget-lines/${id}`, // getBudgetLine / updateBudgetLine
  budgetLineArchive: (id: string) => `${v1}/budget-lines/${id}/archive`, // archiveBudgetLine
  execution: (initiativeId: string) => `${v1}/initiatives/${initiativeId}/execution`, // getInitiativeExecution
  scheduleNetwork: (tid: string) => `${v1}/transformations/${tid}/schedule-network`, // getScheduleNetwork
  schedule: (initiativeId: string) => `${v1}/initiatives/${initiativeId}/schedule`, // createInitiativeSchedule / updateInitiativeSchedule
} as const;

const opts = { retry: shouldRetry, staleTime: 15_000 } as const;

/** Budget lines of one initiative; `status` "active" (default view) or "archived". */
export function useBudgetLines(tid: string, initiativeId: string, status: "active" | "archived") {
  return useQuery({
    queryKey: p4Keys.area("budget-lines", tid, "lines", initiativeId, status),
    queryFn: () => fetchAllPages<BudgetLine>(executionPaths.budgetLines(initiativeId), { status }),
    enabled: Boolean(tid && initiativeId),
    ...opts,
  });
}

/** One budget line with its current version (the If-Match of an edit or archive). */
export function getBudgetLine(id: string): Promise<BudgetLine> {
  return api.get<BudgetLine>(executionPaths.budgetLine(id));
}

/** The execution view (REQ-S09-007), computed by the API on every read. */
export function useInitiativeExecution(tid: string, initiativeId: string) {
  return useQuery({
    queryKey: p4Keys.area("budget-lines", tid, "execution", initiativeId),
    // Parsed with the shared mirror: an answer that does not follow the contract is this panel's error state, never a
    // crash of the initiative page and never a guessed 0 (S-5).
    queryFn: async () => initiativeExecution.parse(await api.get<unknown>(executionPaths.execution(initiativeId))),
    enabled: Boolean(tid && initiativeId),
    ...opts,
  });
}

/** The transformation's schedule network and critical path (REQ-S09-009), computed by the API on every read. */
export function useScheduleNetwork(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("schedule-network", tid),
    queryFn: async () => scheduleNetwork.parse(await api.get<unknown>(executionPaths.scheduleNetwork(tid))),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** A request amount as the API accepts it: ≥ 0, at most 16 integer and 4 fraction digits (ADR-0031 §7). */
export const BUDGET_AMOUNT_INPUT = /^\d{1,16}(\.\d{1,4})?$/;

/** A month input value ("YYYY-MM") as the API's first-of-month business date, or null when empty. */
export function monthToPeriod(month: string): string | null {
  const s = month.trim();
  return s === "" ? null : `${s}-01`;
}

/** The API's first-of-month business date as a month input value ("YYYY-MM"), or "" for the whole initiative. */
export function periodToMonth(period: string | null): string {
  return period === null ? "" : period.slice(0, 7);
}
