// transfer job handlers (P7; stub by T-DG7-BE-A, p7-plan §5.1 and §5.3; p7-work-split §C.1, §C.7). T-DG7-BE-C registers
// the transfer.export job here (handlers/transfer/export.ts): exactly once under the migrationExport advisory lock,
// under its own service identity job:transfer.export, writing the package through the EvidenceStore. Empty until then.
// An export approves nothing (no G1-G6, Finance or IT approval) and never reads or writes DG0-DG7.
import type { JobHandler } from "../spec.ts";

export const TRANSFER_HANDLERS: readonly JobHandler[] = [];
