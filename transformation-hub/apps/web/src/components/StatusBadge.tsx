'use client';

import { CircleCheck, CircleDashed, CircleDot, CircleX, Clock, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useI18n, type StatusEnum } from '@/i18n/provider';
import { cx } from './ui';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const SUCCESS = new Set([
  'approved', 'confirmed', 'verified', 'done', 'passed', 'green', 'accepted', 'met', 'granted', 'signed', 'effective',
  'executed', 'succeeded', 'closed', 'completed', 'implemented', 'implemented_verified', 'achieved_verified',
  'transferred_verified', 'incorporated_verified', 'standalone_accepted', 'day1_ready', 'minutes_approved',
  'charter_approved', 'verified_closed', 'exit_accepted', 'realized_verified', 'released', 'published', 'active',
  'clean', 'go', 'approved_go', 'within_mandate', 'remediated', 'resolved', 'delivered', 'applicable', 'mitigated',
  'transitional_services_exited', 'incorporated', 'success',
]);
const DANGER = new Set([
  'blocked', 'rejected', 'failed', 'red', 'conflicting', 'breached', 'refused', 'missed', 'overdue', 'no_go', 'dead',
  'expired_unresolved', 'quarantined', 'aborted', 'critical', 'escalated', 'invalidated', 'lapsed', 'terminated',
  'budget_exceeded', 'error', 'unmet', 'denied',
]);
const WARNING = new Set([
  'amber', 'at_risk', 'pending', 'on_hold', 'stale', 'not_updated', 'historical_unverified', 'assumed', 'proposed',
  'unconfirmed', 'incorporated_unverified', 'incorporated_evidence_pending', 'transferred_pending_evidence',
  'transferred_evidence_pending', 'achieved_pending_evidence', 'done_pending_verification',
  'completed_pending_evidence', 'realized_unverified', 'configured_unverified', 'uncertain', 'approved_with_exceptions',
  'reopened', 'deferred', 'returned', 'high', 'assessment_pending', 'pending_external_authority', 'partially_closed',
  'partially_transferred', 'expired', 'withheld', 'suppressed', 'simulated', 'conditional', 'granted_with_conditions',
  'waived', 'extended', 'consent_required', 'novation_required',
]);
const INFO = new Set([
  'in_progress', 'submitted', 'under_review', 'in_review', 'in_assessment', 'ready_for_decision', 'ready_for_confirmation',
  'recommended', 'monitoring', 'tracking', 'negotiating', 'drafting', 'in_preparation', 'in_session', 'held',
  'agenda_published', 'minutes_draft', 'planned', 'planning', 'rehearsal', 'running', 'queued', 'sending', 'sent',
  'executing', 'setup', 'closing', 'preparing', 'incorporation_in_progress', 'transfer_in_progress',
  'readiness_in_progress', 'exit_in_progress', 'evidence_submitted', 'submitted_for_acceptance', 'perimeter_draft',
  'perimeter_approved', 'signing_ready', 'closing_conditions_in_progress', 'partner_preparation',
  'diligence_and_negotiation', 'operating_with_transitional_services', 'day1_go_approved', 'implementation_pending',
  'open', 'requested', 'identified',
]);

export function toneOf(value: string | null | undefined): Tone {
  if (!value) return 'neutral';
  if (SUCCESS.has(value)) return 'success';
  if (DANGER.has(value)) return 'danger';
  if (WARNING.has(value)) return 'warning';
  if (INFO.has(value)) return 'info';
  return 'neutral';
}

const TONE_ICON: Record<Tone, LucideIcon> = {
  success: CircleCheck,
  danger: CircleX,
  warning: TriangleAlert,
  info: Clock,
  neutral: CircleDashed,
};

const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-success-soft text-success border-success/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
  info: 'bg-info-soft text-info border-info/30',
  neutral: 'bg-neutral-soft text-neutral border-neutral/25',
};

/**
 * Status shown as text + icon + colour — never colour alone. The label comes from the enum translations
 * (`statuses.<enumName>.<value>`), so the same value reads identically everywhere.
 */
export function StatusBadge({
  enumName,
  value,
  tone,
  label,
  className,
  size = 'sm',
}: {
  enumName: StatusEnum;
  value: string | null | undefined;
  tone?: Tone;
  /** Override the translated label (e.g. a template-specific name). */
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const { tStatus } = useI18n();
  const resolvedTone = tone ?? toneOf(value);
  const Icon = value ? TONE_ICON[resolvedTone] : CircleDot;
  const text = label ?? tStatus(enumName, value);
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        TONE_CLASS[resolvedTone],
        className,
      )}
      data-status={value ?? ''}
    >
      <Icon aria-hidden="true" className={size === 'sm' ? 'size-3.5 shrink-0' : 'size-4 shrink-0'} />
      <span className="truncate">{text}</span>
    </span>
  );
}
