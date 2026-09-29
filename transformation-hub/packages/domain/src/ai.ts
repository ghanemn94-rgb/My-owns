import { ruleViolation } from './errors';
import { CLASSIFICATIONS } from './enums';
import type { AiMode, AiProvider, Classification } from './enums';
import { POLICY_MATRIX } from './policy';

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
  // Added in P5 (ai-runtime-engineer): assistant-addressed notes, status-setting and closing/permission requests.
  /note to the (ai )?assistant|to the ai assistant|ai assistant shall|dear (ai|assistant)/i,
  /(mark|set|update|record) .{0,40}\b(as )?(satisfied|approved|waived|verified|closed|incorporated)\b/i,
  /(declare|announce) .{0,30}(closing|closed|close)/i,
  /(grant|give) .{0,40}(access|administrator|admin rights)/i,
  /(إلى|الى) المساعد الذكي|يقوم المساعد الذكي/,
  /(حدّث|حدث|قم بتحديث|سجّل|سجل).{0,40}(مستوفى|معتمد|مُعفى|معفى|مؤسسة)/,
  /(أعلن|اعلن).{0,20}(إغلاق|اغلاق)/,
  /(امنح|اجعلني).{0,40}(صلاحية|مسؤول)/,
];

export function detectInstructionLikeContent(text: string): { suspicious: boolean; matches: string[] } {
  const matches = INJECTION_PATTERNS.filter((r) => r.test(text)).map((r) => r.source);
  return { suspicious: matches.length > 0, matches };
}

// =============================================================================================================
// P5 runtime additions (ai-runtime-engineer). Pure rules only — no I/O. The API module wires them to storage.
// =============================================================================================================

/** `ai` usage flag of a permission in the policy matrix (access-matrix §2.7). Unknown permissions → 'none'. */
export type AiFlag = 'none' | 'retrieve' | 'propose';

export function aiFlagOf(permission: string): AiFlag {
  const p = (POLICY_MATRIX.permissions as Record<string, { ai?: AiFlag }>)[permission];
  return p?.ai === 'retrieve' || p?.ai === 'propose' ? p.ai : 'none';
}

/**
 * Underlying permission each proposable action exercises when executed. `null` = AI workspace only (a prepared
 * request text addressed to a human; creates no domain record). Every non-null entry must carry `ai: "propose"`.
 */
export const AI_ACTION_PERMISSION: Record<AiProposableAction, string | null> = {
  create_internal_notification: 'notifications.message.send',
  request_update_from_owner: 'notifications.message.send',
  create_follow_up_task: 'planning.task.manage',
  flag_risk: 'planning.raid.manage',
  draft_agenda: 'governance.agenda_request.create',
  draft_minutes: 'governance.minutes.draft',
  draft_decision_paper: 'governance.decision.draft',
  draft_status_summary: 'planning.status_update.submit',
  prepare_approval_request: null,
};

/** Actions whose execution sends an internal (in-app) message; everything else produces a draft artefact. */
export const AI_MESSAGE_ACTIONS: AiProposableAction[] = ['create_internal_notification', 'request_update_from_owner'];

export interface AiToolDef {
  /** Tool name exposed to the model. */
  name: string;
  kind: 'retrieve' | 'propose';
  /** Permission the delegating user must hold at call time (null only for the prepared-request tool). */
  permission: string | null;
  /** For propose tools: the proposable action created. */
  action?: AiProposableAction;
  description: string;
}

/**
 * The COMPLETE tool catalogue of the runtime AI PM (C-20). Typed, narrow, read-only or propose-only. There is no
 * shell, raw SQL, deployment or "generic update" tool, and no tool for any prohibited action (AI_PROHIBITED_ACTIONS):
 * those are unreachable, not merely forbidden. Project and room scope are bound from the run context — no tool takes a
 * projectId or roomId argument.
 */
export const AI_TOOLS: readonly AiToolDef[] = [
  { name: 'search_documents', kind: 'retrieve', permission: 'documents.document.read', description: 'Full-text search over indexed document chunks the delegating user may read (ACL applied inside SQL before ranking).' },
  { name: 'list_overdue_work', kind: 'retrieve', permission: 'planning.plan.read', description: 'Tasks and milestones past their forecast/planned finish that are not complete.' },
  { name: 'list_missing_owners', kind: 'retrieve', permission: 'planning.plan.read', description: 'Active tasks and milestones without an accountable owner.' },
  { name: 'list_stale_updates', kind: 'retrieve', permission: 'planning.plan.read', description: 'Workstreams without a submitted/accepted status update in the staleness window.' },
  { name: 'get_delay_impact', kind: 'retrieve', permission: 'planning.plan.read', description: 'Deterministic calendar-based delay impact (CPM engine). The model never computes schedule numbers.' },
  { name: 'list_decisions_awaiting_action', kind: 'retrieve', permission: 'governance.decision.read', description: 'Decisions waiting in review/recommendation/implementation and overdue committee actions.' },
  { name: 'get_gate_blockers', kind: 'retrieve', permission: 'gates.gate.read', description: 'Current gate assessments and mandatory/blocking criteria that are not met.' },
  { name: 'list_closing_conditions', kind: 'retrieve', permission: 'jv.deal.read', description: 'Closing conditions with status, evidence counts, waivability and gate links.' },
  { name: 'list_tsa_expiring', kind: 'retrieve', permission: 'readiness.register.read', description: 'TSA services ending soon without accepted replacement.' },
  { name: 'list_readiness_blockers', kind: 'retrieve', permission: 'readiness.register.read', description: 'Mandatory/blocker readiness checks not passed.' },
  { name: 'get_status_dimensions', kind: 'retrieve', permission: 'portfolio.dashboard.read', description: 'The independent project status dimensions as computed by the platform.' },
  { name: 'get_partner_status', kind: 'retrieve', permission: 'jv.partner.read', description: 'Partner records visible to the user; identity is reported as confirmed only with an approved deal scenario.' },
  { name: 'get_approved_financials', kind: 'retrieve', permission: 'finance.record.read', description: 'Approved financial figures/valuation outputs only, with currency, unit and approval state.' },
  { name: 'propose_internal_notification', kind: 'propose', permission: 'notifications.message.send', action: 'create_internal_notification', description: 'Propose an in-app notification to an internal project member.' },
  { name: 'propose_owner_update_request', kind: 'propose', permission: 'notifications.message.send', action: 'request_update_from_owner', description: 'Propose asking a record owner for an update.' },
  { name: 'propose_follow_up_task', kind: 'propose', permission: 'planning.task.manage', action: 'create_follow_up_task', description: 'Propose a follow-up task draft (stored as a draft; the planning module creates tasks).' },
  { name: 'propose_risk_flag', kind: 'propose', permission: 'planning.raid.manage', action: 'flag_risk', description: 'Propose a risk entry draft.' },
  { name: 'propose_agenda_draft', kind: 'propose', permission: 'governance.agenda_request.create', action: 'draft_agenda', description: 'Draft a committee agenda from records.' },
  { name: 'propose_minutes_draft', kind: 'propose', permission: 'governance.minutes.draft', action: 'draft_minutes', description: 'Draft minutes from records (human review required).' },
  { name: 'propose_decision_paper_draft', kind: 'propose', permission: 'governance.decision.draft', action: 'draft_decision_paper', description: 'Draft a decision paper from records.' },
  { name: 'propose_status_summary_draft', kind: 'propose', permission: 'planning.status_update.submit', action: 'draft_status_summary', description: 'Draft a status summary.' },
  { name: 'prepare_request_for_human', kind: 'propose', permission: null, action: 'prepare_approval_request', description: 'Prepare a request text for an authorised human (used when a prohibited action is asked). Creates no domain record.' },
];

export function aiToolByName(name: string): AiToolDef | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}

/** Verbs that indicate a prohibited capability when a model asks for a tool that does not exist. */
const PROHIBITED_TOOL_PATTERN =
  /(approve|decide|vote|waive|waiver|verify|sign|close|closing|grant|release|disclose|assign_role|permission|delete|dispose|pay|payment|contact_partner|send_external|send_email|email|baseline|budget|ownership|declare|admin)/i;

/** True when a requested tool name corresponds to a prohibited action (audited as AI_PROHIBITED_ACTION_REQUESTED). */
export function isProhibitedToolRequest(name: string): boolean {
  if ((AI_PROHIBITED_ACTIONS as readonly string[]).includes(name)) return true;
  return !aiToolByName(name) && PROHIBITED_TOOL_PATTERN.test(name);
}

/** Tools usable in a mode (off → none; advisory+ → retrieve and propose; execution is governed separately). */
export function toolAllowedInMode(tool: AiToolDef, mode: AiMode): boolean {
  if (mode === 'off') return false;
  return tool.kind === 'retrieve' ? modeAllows(mode, 'read') : modeAllows(mode, 'propose');
}

/**
 * Hard classification ceilings per provider type (threat-model §5.2): an external gateway receives at most
 * `internal`; a local endpoint (or the local mock) at most `restricted` and only if the project enables it.
 * strictly_confidential, partner-room and clean-team content never go to any provider.
 */
export const AI_PROVIDER_MAX_CLASSIFICATION: Record<AiProvider, Classification | null> = {
  off: null,
  mock: 'restricted',
  openai_compatible: 'restricted',
  anthropic: 'internal',
};

export function classificationWithinCeiling(classification: Classification, ceiling: Classification): boolean {
  return CLASSIFICATIONS.indexOf(classification) <= CLASSIFICATIONS.indexOf(ceiling);
}

/** Budget evaluation before a provider call (AT-21). A monthly token budget of 0 means "no budget configured" → refuse. */
export function evaluateBudget(b: {
  monthlyTokenBudget: number;
  tokensUsedThisMonth: number;
  estimatedTokens: number;
  perRunTokenLimit: number;
  monthlyCostBudget: string | null;
  costUsedThisMonth: string;
  estimatedCost: string;
}): { ok: true } | { ok: false; reason: 'no_budget' | 'monthly_tokens' | 'per_run_tokens' | 'monthly_cost' } {
  if (b.monthlyTokenBudget <= 0) return { ok: false, reason: 'no_budget' };
  if (b.estimatedTokens > b.perRunTokenLimit) return { ok: false, reason: 'per_run_tokens' };
  if (b.tokensUsedThisMonth + b.estimatedTokens > b.monthlyTokenBudget) return { ok: false, reason: 'monthly_tokens' };
  if (b.monthlyCostBudget !== null && Number(b.costUsedThisMonth) + Number(b.estimatedCost) > Number(b.monthlyCostBudget)) {
    return { ok: false, reason: 'monthly_cost' };
  }
  return { ok: true };
}

export const AI_CIRCUIT_THRESHOLD = 3;
export const AI_CIRCUIT_OPEN_MINUTES = 15;

/** Circuit breaker transition after a provider call (consecutive failures → open for N minutes). */
export function nextCircuitState(
  cur: { consecutiveFailures: number },
  outcome: 'success' | 'failure',
  now: Date,
  threshold = AI_CIRCUIT_THRESHOLD,
  openMinutes = AI_CIRCUIT_OPEN_MINUTES,
): { consecutiveFailures: number; circuitOpenUntil: Date | null } {
  if (outcome === 'success') return { consecutiveFailures: 0, circuitOpenUntil: null };
  const n = cur.consecutiveFailures + 1;
  return { consecutiveFailures: n, circuitOpenUntil: n >= threshold ? new Date(now.getTime() + openMinutes * 60_000) : null };
}

export function circuitIsOpen(circuitOpenUntil: Date | string | null, now: Date): boolean {
  return !!circuitOpenUntil && new Date(circuitOpenUntil).getTime() > now.getTime();
}

/** Quiet hours as local hours [start, end) — wraps midnight when start > end. Null/equal = no quiet hours. */
export function isWithinQuietHours(localHour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null || start === end) return false;
  return start < end ? localHour >= start && localHour < end : localHour >= start || localHour < end;
}

/** Organisation caps for autopilot policies (proposed defaults; to be confirmed — AIQ-05). */
export const AI_AUTOPILOT_CAPS = { maxActionsPerDay: 50, maxValidityDays: 90 };

export function validateAutopilotPolicy(p: { allowlist: string[]; maxActionsPerDay: number; expiresOn: string | null }, today: string): string[] {
  const errors: string[] = [];
  if (!p.allowlist.length) errors.push('allowlist_empty');
  for (const a of p.allowlist) {
    if (!AI_AUTOPILOT_ELIGIBLE.includes(a as AiProposableAction)) errors.push(`not_eligible:${a}`);
  }
  if (!Number.isInteger(p.maxActionsPerDay) || p.maxActionsPerDay < 1 || p.maxActionsPerDay > AI_AUTOPILOT_CAPS.maxActionsPerDay) errors.push('max_actions_out_of_range');
  if (!p.expiresOn) errors.push('expiry_required');
  else {
    if (p.expiresOn <= today) errors.push('expiry_in_past');
    const days = (Date.parse(`${p.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
    if (days > AI_AUTOPILOT_CAPS.maxValidityDays) errors.push('expiry_too_far');
  }
  return errors;
}

/** Canonical citation reference. */
export interface AiCitationRef {
  type: string;
  id: string;
  version?: number | null;
  location?: string | null;
  label?: string | null;
  isDemo?: boolean;
}
export const citationKey = (c: { type: string; id: string }) => `${c.type}:${c.id}`;

export interface AiClaim {
  text: string;
  kind: 'fact' | 'inference';
  citations: AiCitationRef[];
}

/**
 * Output validator (E4, §12.5): every claim must cite at least one item of the evidence set retrieved for this run
 * under the caller's ACL. Citations outside the set are removed; claims left without a valid citation are dropped.
 * Returns the invalid citation keys so the caller can audit AI_CITATION_INVALID.
 */
export function validateClaims(claims: AiClaim[], evidence: Map<string, AiCitationRef>): { claims: AiClaim[]; dropped: number; invalidCitations: string[] } {
  const out: AiClaim[] = [];
  const invalid: string[] = [];
  let dropped = 0;
  for (const c of claims) {
    const valid: AiCitationRef[] = [];
    for (const ref of Array.isArray(c?.citations) ? c.citations : []) {
      const known = ref && typeof ref.type === 'string' && typeof ref.id === 'string' ? evidence.get(citationKey(ref)) : undefined;
      if (known) {
        if (!valid.includes(known)) valid.push(known);
      } else invalid.push(ref && typeof ref === 'object' ? citationKey({ type: String(ref.type), id: String(ref.id) }) : 'malformed');
    }
    if (!valid.length || typeof c?.text !== 'string' || !c.text.trim()) {
      dropped++;
      continue;
    }
    out.push({ text: c.text, kind: c.kind === 'inference' ? 'inference' : 'fact', citations: valid });
  }
  return { claims: out, dropped, invalidCitations: invalid };
}

/**
 * Output sanitiser (C-27, AIT-06, AIT-33): removes Markdown images, links to external URLs, raw HTML tags and
 * bidi / zero-width control characters from model text.
 */
export function sanitizeAiText(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  let t = String(text ?? '');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, () => {
    removed.push('markdown_image');
    return '';
  });
  t = t.replace(/\[([^\]]*)\]\((?:[a-z][a-z0-9+.-]*:)?\/\/[^)]*\)/gi, (_m, label: string) => {
    removed.push('external_link');
    return label;
  });
  t = t.replace(/\b(?:https?|ftp|data|javascript):[^\s)]*/gi, () => {
    removed.push('external_url');
    return '[link removed]';
  });
  t = t.replace(/<\/?[a-z][^>]*>/gi, () => {
    removed.push('html_tag');
    return '';
  });
  t = t.replace(/[​-‏‪-‮⁦-⁩﻿]/g, () => {
    removed.push('control_char');
    return '';
  });
  return { text: t.replace(/[ \t]{3,}/g, '  ').trim().slice(0, 2000), removed };
}

/** Secondary DLP control: redact e-mail addresses, IBANs, national-ID-like numbers and phone numbers before egress. */
export function redactSensitive(text: string): { text: string; redactions: number } {
  let n = 0;
  const r = (label: string) => () => {
    n++;
    return `[redacted-${label}]`;
  };
  const t = String(text ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, r('email'))
    .replace(/\bSA\d{2}[0-9A-Z]{20}\b/g, r('iban'))
    .replace(/\b[12]\d{9}\b/g, r('national-id'))
    .replace(/(?:\+966|00966|\b0)5\d{8}\b/g, r('phone'));
  return { text: t, redactions: n };
}

/** Destination allowlist check (AT-22, AIT-29): the provider host must be explicitly allowlisted. */
export function hostAllowed(url: string, allowlist: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowlist
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .some((h) => host === h || (h.startsWith('.') && host.endsWith(h)));
}

/** Rough token estimate (≈4 characters per token) used for budgeting before a call; providers report actuals. */
export function estimateTokens(text: string): number {
  return Math.ceil(String(text ?? '').length / 4);
}

const STOPWORDS = new Set(
  (
    'the a an and or of to in on for is are was were be been what which who whom whose how when where why do does did ' +
    'this that these those it its with from by as at about into our we you your me my i can could should would will ' +
    'tell show give list please any all there their them us has have had not no yes than then so if'
  ).split(' '),
);
const AR_STOPWORDS = new Set('في من على إلى الى عن ما ماذا هو هي هل كل التي الذي هذه هذا ذلك مع أو او ثم قد لا لم لن كان كانت هناك أن ان إن'.split(' '));

/** Search terms for full-text retrieval (EN + AR tokens, stopwords removed, bounded). Always bound as SQL parameters. */
export function extractSearchTerms(q: string, max = 12): string[] {
  const tokens = String(q ?? '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu);
  const out: string[] = [];
  for (const t of tokens ?? []) {
    if (t.length < 2 || STOPWORDS.has(t) || AR_STOPWORDS.has(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Numeric grounding (AIT-32, §12.1 "deterministic engines compute numbers"): every multi-digit number in a claim must
 * appear in one of the cited sources. Returns the numbers that do not (claim must be dropped). Arabic-Indic digits and
 * thousands separators are normalised first.
 */
export function ungroundedNumbers(claim: string, sources: string[]): string[] {
  const norm = (s: string) =>
    String(s ?? '')
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/(\d)[,٬](?=\d{3}\b)/g, '$1');
  const nums = norm(claim).match(/\d+(?:\.\d+)?/g) ?? [];
  const src = norm(sources.join(' \n '));
  return [...new Set(nums.filter((n) => n.replace('.', '').length >= 2 && !src.includes(n)))];
}

/** Stable JSON (sorted keys) — the canonical form hashed for approval binding (C-21). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

/** Canonical input of the ACL fingerprint that keys derived AI artefacts (hash it with SHA-256 in the API). */
export function aclFingerprintInput(p: { userId: string; clearance: string; roomIds: string[]; roles: string[] }): string {
  return canonicalJson({ u: p.userId, c: p.clearance, r: [...new Set(p.roomIds)].sort(), p: [...new Set(p.roles)].sort() });
}
