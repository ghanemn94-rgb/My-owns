// transfer job handlers (P7; stub by T-DG7-BE-A, p7-plan §5.1 and §5.3; filled by T-DG7-BE-C, p7-work-split §C.1):
// transfer.export writes the migration package of one export exactly once under the migrationExport advisory lock,
// under its own service identity job:transfer.export (0147), through the evidence store's filesystem root
// (handlers/transfer/export.ts). An export approves nothing (no G1-G6, Finance or IT approval) and never reads or
// writes DG0-DG7.
import type { JobHandler } from "../spec.ts";
import { transferExportHandler } from "./export.ts";

export const TRANSFER_HANDLERS: readonly JobHandler[] = [transferExportHandler()];
