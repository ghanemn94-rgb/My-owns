// The output adapters of procedure steps (ADR-0042 §3; p5-work-split §C.3; T-DG5-BE-G): one per output record type of
// the closed set, registered into the step engine's registry (steps.ts registerProcedureOutputAdapter). The `approval`
// output is the step's own canonical approval, linked by the engine itself when its business approver approves.
import { registerProcedureOutputAdapter, type ProcedureOutputAdapter } from "../steps.ts";
import { bauHandoverOutput } from "./sustainment.ts";
import { financeValidationOutput } from "./benefits.ts";
import { decisionOutput } from "./governance.ts";
import { evidenceOutput } from "./evidence.ts";
import { baselineOutput, kpiActualOutput } from "./kpi.ts";
import { rankingSnapshotOutput } from "./portfolio.ts";
import { charterOutput, tomCanvasCellOutput, transformationOutput } from "./transformations.ts";
import { changeRequestOutput, gateSubmissionOutput } from "./workflows.ts";

/** Every adapter, in the ADR-0042 §3 order of the output record types (`approval` is the engine's own). */
export const PROCEDURE_OUTPUT_ADAPTERS: readonly ProcedureOutputAdapter[] = [
  transformationOutput,
  charterOutput,
  baselineOutput,
  kpiActualOutput,
  tomCanvasCellOutput,
  rankingSnapshotOutput,
  gateSubmissionOutput,
  changeRequestOutput,
  financeValidationOutput,
  decisionOutput,
  bauHandoverOutput,
  evidenceOutput,
];

/** Registers every adapter (procedures/routes.ts calls it once per server). */
export function registerProcedureOutputAdapters(): void {
  for (const a of PROCEDURE_OUTPUT_ADAPTERS) registerProcedureOutputAdapter(a);
}
