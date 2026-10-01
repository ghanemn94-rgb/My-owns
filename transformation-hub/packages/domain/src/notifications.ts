/**
 * In-app notifications produced from outbox events (REQ-PLT-008, REQ-INT-012, C-33) — pure rules.
 *
 * A notification stores a message CODE with parameters (record codes, enum values, numbers — never record titles or
 * content) and a deep link; the content itself is read behind the link with a fresh permission check. The worker checks
 * the recipient's CURRENT access before every delivery (forUser + the source record's visibility), and the inbox checks
 * it again at read time. In-app is the only channel enabled by default; email and Teams are adapters that stay Not
 * configured until a verified connector and an approved sending authority exist.
 */
import { formatMessage } from './messages';

export const NOTIFICATION_KINDS = [
  'agenda_request.screened',
  'change_request.decided',
  'decision.outcome',
  'import.awaiting_approval',
  'import.decided',
  'integration.alert',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** English templates (the web translates `notifications.messages.<code>`; stored `title` = this English rendering). */
export const NOTIFICATION_MESSAGES_EN: Readonly<Record<string, string>> = {
  'notifications.agenda_request.screened': 'Your agenda request was screened by the secretariat: {outcome}',
  'notifications.change_request.decided': 'Change request {code} was {status}',
  'notifications.decision.outcome': 'Decision {code}: outcome recorded ({status})',
  'notifications.import.awaiting_approval': 'Import {code} awaits approval by a second person',
  'notifications.import.decided': 'Your import {code} was {outcome}',
  'notifications.integration.alert': 'Connector {adapter} needs attention: {problem}',
};

export function renderNotificationEn(code: string, params: Record<string, string | number>): string {
  const t = NOTIFICATION_MESSAGES_EN[code];
  if (t === undefined) throw new Error(`No English template for notification code ${code}`);
  return formatMessage(t, params);
}

/** Decision outcomes worth telling the requester about (status reached through an outcome command). */
export const DECISION_OUTCOME_STATUSES = ['recommended', 'approved', 'rejected', 'deferred'] as const;

/** Dedupe key of one delivery: exactly once per event, kind and recipient (a retried job never notifies twice — AT-20). */
export function notificationDedupeKey(eventId: string, kind: string, userId: string): string {
  return `evt:${eventId}:${kind}:${userId}`.slice(0, 200);
}

/** Why a delivery was suppressed (audited; the recipient receives nothing — AT-19, REQ-INT-012). */
export const SUPPRESSION_REASONS = ['recipient_inactive_or_out_of_project', 'recipient_cannot_read_source', 'source_missing', 'recipient_is_actor'] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];
