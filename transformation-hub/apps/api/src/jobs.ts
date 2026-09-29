import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from './platform/jobs/job-registry';
import { registerPlatformJobs } from './platform/jobs/platform.jobs';
import { registerDocumentsJobs } from './modules/documents/documents.jobs';
import { registerGovernanceJobs } from './modules/governance/governance.jobs';
import { registerPlanningJobs } from './modules/planning/planning.jobs';
import { registerGatesJobs } from './modules/gates/gates.jobs';
import { registerCarveoutJobs } from './modules/carveout/carveout.jobs';
import { registerNewcoJobs } from './modules/newco/newco.jobs';
import { registerReadinessJobs } from './modules/readiness/readiness.jobs';
import { registerFinanceJobs } from './modules/finance/finance.jobs';
import { registerJvJobs } from './modules/jv/jv.jobs';
import { registerAiJobs } from './modules/ai/ai.jobs';
import { registerReportingJobs } from './modules/reporting/reporting.jobs';
import { registerImportsJobs } from './modules/imports/imports.jobs';
import { registerIntegrationsJobs } from './modules/integrations/integrations.jobs';
import { registerNotificationsJobs } from './modules/notifications/notifications.jobs';
import { registerConfigJobs } from './modules/config/config.jobs';

/** Central registration of job handlers and outbox subscriptions (each module owns its registrar). */
export function registerJobHandlers(app: INestApplicationContext) {
  const registry = app.get(JobRegistry);
  // Idempotent: a context registers its handlers once (tests may call this for the same app several times).
  if (registry.handler('system.noop')) return;
  registry.register('system.noop', async () => ({ ok: true }));
  registerPlatformJobs(app);
  registerDocumentsJobs(app);
  registerGovernanceJobs(app);
  registerPlanningJobs(app);
  registerGatesJobs(app);
  registerCarveoutJobs(app);
  registerNewcoJobs(app);
  registerReadinessJobs(app);
  registerFinanceJobs(app);
  registerJvJobs(app);
  registerAiJobs(app);
  registerReportingJobs(app);
  registerImportsJobs(app);
  registerIntegrationsJobs(app);
  registerNotificationsJobs(app);
  registerConfigJobs(app);
}
