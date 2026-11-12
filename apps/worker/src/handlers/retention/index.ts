// retention job handlers (P7; stub by T-DG7-BE-A, p7-plan §5.1 and §5.3; p7-work-split §E.1, §E.7). T-DG7-BE-G
// registers the retention.archive job here (handlers/retention/archive.ts): queued -> running once under the
// retentionRun advisory lock, under its own service identity job:retention.archive, one audit event per action, dry-run
// mode. Its schedule ships DISABLED, and every class ships `retain`, so a fresh installation archives and purges
// nothing. Empty until then.
import type { JobHandler } from "../spec.ts";

export const RETENTION_HANDLERS: readonly JobHandler[] = [];
