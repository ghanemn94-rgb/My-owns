import { ruleViolation } from './errors';
import type { AiMode } from './enums';

/**
 * AI runtime authority model (spec §12.3). The *runtime* AI PM is distinct from the Claude Code build agents.
 * Prohibited actions are never exposed as tools in any mode; they can only be prepared as *requests* that a
 * human with the right authority executes through the normal product commands.
 */
export const AI_PROHIBITED_ACTIONS = [
  'approve_gate',
  'approve_decision',
  'record_vote',
  'change_baseline',
  'change_budget',
  'change_ownership',
  'grant_vdr_access',
  'contact_partner',
  'sign_agreement',
  'execute_payment',
  'change_permissions',
  'delete_evidence',
  'declare_closing',
  'create_waiver',
  'verify_condition',
] as const;
export type AiProhibitedAction = (typeof AI_PROHIBITED_ACTIONS)[number];

/** Actions the runtime may *propose*. Execution depends on mode + approval (assisted) or allowlist (autopilot). */
export const AI_PROPOSABLE_ACTIONS = [
  'create_internal_notification',
  'create_follow_up_task',
  'draft_agenda',
  'draft_minutes',
  'draft_decision_paper',
  'draft_status_summary',
  'request_update_from_owner',
  'flag_risk',
  'prepare_approval_request',
] as const;
export type AiProposableAction = (typeof AI_PROPOSABLE_ACTIONS)[number];

/** Low-impact actions an org may allowlist for policy-limited autopilot. */
export const AI_AUTOPILOT_ELIGIBLE: AiProposableAction[] = ['create_internal_notification', 'request_update_from_owner', 'draft_status_summary', 'flag_risk'];

export type AiCapability = 'read' | 'analyze' | 'draft' | 'propose' | 'execute_approved' | 'execute_autopilot';

export function modeAllows(mode: AiMode, cap: AiCapability): boolean {
  switch (mode) {
    case 'off':
      return false;
    case 'advisory':
      return cap === 'read' || cap === 'analyze' || cap === 'draft' || cap === 'propose';
    case 'assisted':
      return cap !== 'execute_autopilot';
    case 'autopilot':
      return true;
  }
}

export interface AutopilotPolicy {
  allowlist: string[];
  maxActionsPerDay: number;
  expiresOn: string | null; // ISO date
  revoked: boolean;
}

export function assertActionExecutable(input: {
  mode: AiMode;
  killSwitch: boolean;
  action: string;
  approved: boolean;
  autopilot: AutopilotPolicy | null;
  actionsToday: number;
  today: string;
}): 'approved' | 'autopilot' {
  if ((AI_PROHIBITED_ACTIONS as readonly string[]).includes(input.action)) {
    throw ruleViolation('ai.prohibited_action', `The AI project manager may not perform "${input.action}"`);
  }
  if (!(AI_PROPOSABLE_ACTIONS as readonly string[]).includes(input.action)) {
    throw ruleViolation('ai.unknown_action', `Unknown AI action "${input.action}"`);
  }
  if (input.killSwitch) throw ruleViolation('ai.kill_switch', 'AI emergency stop is active');
  if (input.mode === 'off' || input.mode === 'advisory') {
    throw ruleViolation('ai.mode_forbids_execution', `AI mode "${input.mode}" does not allow execution`);
  }
  if (input.approved && (input.mode === 'assisted' || input.mode === 'autopilot')) return 'approved';
  if (input.mode === 'autopilot' && input.autopilot) {
    const p = input.autopilot;
    if (p.revoked) throw ruleViolation('ai.autopilot_revoked', 'Autopilot policy revoked');
    if (p.expiresOn && p.expiresOn < input.today) throw ruleViolation('ai.autopilot_expired', 'Autopilot policy expired');
    if (!p.allowlist.includes(input.action) || !AI_AUTOPILOT_ELIGIBLE.includes(input.action as AiProposableAction)) {
      throw ruleViolation('ai.not_allowlisted', `Action "${input.action}" is not allowlisted for autopilot`);
    }
    if (input.actionsToday >= p.maxActionsPerDay) throw ruleViolation('ai.rate_limited', 'Autopilot daily action limit reached');
    return 'autopilot';
  }
  throw ruleViolation('ai.approval_required', 'This action requires human approval');
}

/**
 * Approval binding (AT-18): approval is valid only for the exact payload hash, target version and recipients,
 * by the approving identity, before expiry.
 */
export function isApprovalStillValid(a: {
  approvedPayloadHash: string;
  currentPayloadHash: string;
  approvedTargetVersion: number | null;
  currentTargetVersion: number | null;
  expiresAt: string; // ISO instant
  now: string;
  approverStillAuthorized: boolean;
}): { valid: boolean; reason?: string } {
  if (a.approvedPayloadHash !== a.currentPayloadHash) return { valid: false, reason: 'payload_changed' };
  if (a.approvedTargetVersion !== a.currentTargetVersion) return { valid: false, reason: 'target_version_changed' };
  if (a.now > a.expiresAt) return { valid: false, reason: 'expired' };
  if (!a.approverStillAuthorized) return { valid: false, reason: 'approver_no_longer_authorized' };
  return { valid: true };
}

/**
 * Heuristic detector for instruction-like text inside untrusted content (AT-17). Detection only labels content;
 * the security property comes from the architecture (prohibited tools are unreachable), not from this regex.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /you are now/i,
  /system prompt/i,
  /(send|email|forward|share|export) .{0,40}(financial|valuation|confidential|all documents)/i,
  /(approve|waive|verify|sign) .{0,30}(cp|condition|gate|decision|closing)/i,
  /تجاهل.{0,20}(التعليمات|الأوامر)/,
  /(أرسل|ارسل|شارك).{0,40}(المالية|السرية|التقييم)/,
  /(وافق|اعتمد|تنازل).{0,30}(الشرط|البوابة|القرار|الإغلاق)/,
];

export function detectInstructionLikeContent(text: string): { suspicious: boolean; matches: string[] } {
  const matches = INJECTION_PATTERNS.filter((r) => r.test(text)).map((r) => r.source);
  return { suspicious: matches.length > 0, matches };
}
