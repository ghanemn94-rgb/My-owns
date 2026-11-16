// retention job handlers (P7; stub by T-DG7-BE-A, p7-plan §5.1 and §5.3; filled by T-DG7-BE-G, p7-work-split §E.1,
// §E.7): retention.archive (handlers/retention/archive.ts) runs one retention run exactly once (queued -> running once
// under the retentionRun advisory lock 730410), under its own service identity job:retention.archive (0148), with one
// audit event per action and a dry-run mode. Its schedule ships DISABLED, and every class ships `retain`, so a fresh
// installation archives and purges nothing. A run approves nothing and never reads or writes DG0-DG7.
import type { JobHandler } from "../spec.ts";
import { retentionArchiveHandler } from "./archive.ts";

export const RETENTION_HANDLERS: readonly JobHandler[] = [retentionArchiveHandler()];
