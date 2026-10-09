// Scheduling calculations (P4 slice E; ADR-0031 §7-§8; T-DG4-BE-E): the working-day slip of a milestone and the
// critical path method over the initiative network. Pure functions, exported through the `@mth/shared/calc` subpath.
export {
  CPM_ALGORITHM,
  computeCriticalPath,
  MAX_CRITICAL_PATHS,
  type CriticalPathReason,
  type CriticalPathResult,
  type ScheduleEdgeInput,
  type ScheduleEdgeResult,
  type ScheduleNodeInput,
  type ScheduleNodeResult,
} from "./critical-path.ts";
export {
  MAX_SLIP_RANGE_DAYS,
  computeWorkingDaySlip,
  type SlipUnknownReason,
  type WorkingDaySlipResult,
} from "./working-day-slip.ts";
