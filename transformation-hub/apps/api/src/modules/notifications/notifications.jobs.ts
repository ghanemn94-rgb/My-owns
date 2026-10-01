import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { NotificationsService } from './notifications.service';

/** Outbox event → notification job kind (one job per event and kind; idempotent by the outbox dispatcher's key). */
export const NOTIFICATION_JOBS = {
  'agenda_request.screened': 'notifications.agenda_request_screened',
  'change_request.decided': 'notifications.change_request_decided',
  'decision.status_changed': 'notifications.decision_outcome',
  'approval.pending': 'notifications.approval_pending',
  'import.decided': 'notifications.import_decided',
  'integration.alert': 'notifications.integration_alert',
} as const;

/**
 * Register the notification jobs (called by src/jobs.ts in the worker). Each handler re-resolves every recipient at
 * execution time (AT-19) and delivers in-app notifications exactly once per event (AT-20).
 */
export function registerNotificationsJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const n = app.get(NotificationsService);
  const handlers: Record<(typeof NOTIFICATION_JOBS)[keyof typeof NOTIFICATION_JOBS], (job: ClaimedJob) => Promise<Record<string, unknown>>> = {
    'notifications.agenda_request_screened': (j) => n.onAgendaScreened(j),
    'notifications.change_request_decided': (j) => n.onChangeRequestDecided(j),
    'notifications.decision_outcome': (j) => n.onDecisionStatusChanged(j),
    'notifications.approval_pending': (j) => n.onApprovalPending(j),
    'notifications.import_decided': (j) => n.onImportDecided(j),
    'notifications.integration_alert': (j) => n.onIntegrationAlert(j),
  };
  for (const [kind, handler] of Object.entries(handlers)) registry.register(kind, handler);
  for (const [event, kind] of Object.entries(NOTIFICATION_JOBS)) registry.subscribe(event, kind);
}
