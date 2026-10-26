// integrations job handlers (P6; stub by T-DG6-BE-A, p6-plan §5.1 and §5.3): BE-L (connector runs and retries), then BE-M/BE-N registers its handlers here,
// each idempotent through the kit (../kit.ts). Empty until then.
import type { JobHandler } from "./spec.ts";

export const INTEGRATIONS_HANDLERS: readonly JobHandler[] = [];
