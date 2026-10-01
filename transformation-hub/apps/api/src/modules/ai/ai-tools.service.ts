import { Injectable } from '@nestjs/common';
import { aiFlagOf, aiToolByName, citationKey, toolAllowedInMode, type AiMode, type Classification } from '@hub/domain';
import { AuditService } from '../../platform/audit.service';
import { PolicyService } from '../../platform/policy.service';
import type { RequestContext } from '../../platform/context';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiDetectionsService, DetectionCategory, DetectionFull, Locale, tr } from './ai-detections.service';
import { ContextItem, MissingInput } from './providers/model-provider';

export interface ToolRunState {
  projectId: string;
  mode: AiMode;
  today: string;
  locale: Locale;
  projectIsDemo: boolean;
  /** Re-checked before every tool call (C-22). */
  killSwitch: () => Promise<boolean>;
  toolsUsed: string[];
}

export interface ToolResult {
  items: ContextItem[];
  missing: MissingInput[];
  detections: DetectionFull[];
}

export class KillSwitchActiveError extends Error {
  constructor() {
    super('kill_switch');
  }
}

/**
 * Register classification of records that carry none of their own (threat-model §5.2). Committee actions are NOT listed:
 * their classification is derived from their decision and committees (SEC-P5-03, `meta.classification`); a detection of a
 * type that is neither here nor carries a derived classification fails closed (strictly_confidential — never sent).
 * Approval requests carry only their subject type, action and age (no subject content).
 */
const RECORD_CLASSIFICATION: Record<string, Classification> = {
  task: 'internal',
  milestone: 'internal',
  workstream: 'internal',
  readiness_check: 'internal',
  approval_request: 'internal',
  closing_condition: 'confidential',
  tsa_service: 'confidential',
};

const EMPTY: ToolResult = { items: [], missing: [], detections: [] };
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Deterministic question → tool routing (EN + AR keywords). Retrieval is runtime-controlled, never model-initiated. */
const ROUTES: { tools: string[]; re: RegExp }[] = [
  { tools: ['list_overdue_work'], re: /overdue|late|delay|behind|slip|schedule|critical path|تأخر|متأخر|التأخير|الجدول|أسبوعين/i },
  { tools: ['list_missing_owners'], re: /owner|assign|accountab|مالك|مسؤول|المسؤولية/i },
  { tools: ['list_stale_updates'], re: /update|stale|status report|تحديث|قديم/i },
  { tools: ['list_decisions_awaiting_action'], re: /decision|committee|approv|action item|قرار|القرار|اللجنة|اعتماد|موافقة/i },
  { tools: ['get_gate_blockers'], re: /gate|block|بوابة|البوابة|عائق|يمنع/i },
  { tools: ['list_closing_conditions', 'get_gate_blockers'], re: /clos|\bcps?\b|cp-\d|condition|sign|إغلاق|الإغلاق|شرط|الشروط|توقيع/i },
  { tools: ['list_tsa_expiring'], re: /tsa|transition service|الخدمات الانتقالية|الاتفاقية الانتقالية/i },
  { tools: ['list_readiness_blockers', 'list_tsa_expiring', 'get_status_dimensions'], re: /ready|readiness|day[- ]?1|independen|operate|جاهز|جاهزية|مستقل|التشغيل/i },
  { tools: ['get_partner_status'], re: /partner|\bjv\b|joint venture|counterpart|شريك|الشريك|المشروع المشترك/i },
  { tools: ['get_approved_financials'], re: /valuation|value|financ|cost|budget|price|amount|sar|usd|تقييم|التقييم|مالي|المالية|تكلفة|ميزانية|ريال|دولار/i },
  { tools: ['get_status_dimensions', 'list_overdue_work', 'get_gate_blockers'], re: /status|summary|brief|overview|progress|ملخص|حالة|الحالة|موجز|تقدم/i },
];

export function toolsForQuestion(question: string): string[] {
  const out = new Set<string>(['search_documents']);
  for (const r of ROUTES) if (r.re.test(question)) r.tools.forEach((t) => out.add(t));
  if (out.size === 1) out.add('get_status_dimensions');
  return [...out];
}

export const BRIEFING_TOOLS = ['list_overdue_work', 'list_missing_owners', 'list_stale_updates', 'list_decisions_awaiting_action', 'get_gate_blockers', 'list_closing_conditions', 'list_tsa_expiring', 'list_readiness_blockers', 'get_status_dimensions'];

const TOOL_CATEGORY: Record<string, DetectionCategory | undefined> = {
  list_overdue_work: 'overdue',
  list_missing_owners: 'owners',
  list_stale_updates: 'stale',
  list_decisions_awaiting_action: 'governance',
  list_closing_conditions: 'closing',
  list_tsa_expiring: 'tsa',
  list_readiness_blockers: 'readiness',
};

/**
 * Typed, narrow, read-only tools (C-20). Invoked by the RUNTIME for the delegating user — the model cannot initiate
 * retrieval, pass a project/room id, or reach any write path. Every call re-checks the kill switch, the mode and the
 * delegating user's CURRENT permission for the tool's `ai: retrieve` permission.
 */
@Injectable()
export class AiToolsService {
  constructor(
    private readonly knowledge: AiKnowledgeService,
    private readonly detections: AiDetectionsService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async run(ctx: RequestContext, name: string, args: { query?: string }, st: ToolRunState): Promise<ToolResult> {
    const tool = aiToolByName(name);
    if (!tool || tool.kind !== 'retrieve' || !tool.permission) throw new Error(`not a retrieval tool: ${name}`);
    if (await st.killSwitch()) throw new KillSwitchActiveError();
    const L = (en: string, ar: string) => tr(st.locale, en, ar);
    const notAvailable = (key: string, en: string, ar: string, ownerRole: string | null = null): MissingInput => ({ key, description: L(en, ar), ownerRole });
    // Mode + ai flag + delegating user's current permission (effective AI permission = ai flag ∩ user ∩ mode).
    if (!toolAllowedInMode(tool, st.mode) || aiFlagOf(tool.permission) !== 'retrieve' || !this.policy.canInProject(ctx, tool.permission, st.projectId)) {
      await this.audit.record({ action: 'AI_TOOL_DENIED', entityType: 'ai_tool', projectId: st.projectId, outcome: 'denied', reason: `${name}: permission ${tool.permission} not available to the delegating user in mode ${st.mode}` });
      return { ...EMPTY, missing: [notAvailable(`tool:${name}`, `Information for "${name}" is not available in sources you are authorized to see.`, `المعلومات الخاصة بـ «${name}» غير متاحة في المصادر المصرح لك بالاطلاع عليها.`)] };
    }
    st.toolsUsed.push(name);

    const category = TOOL_CATEGORY[name];
    if (category) {
      const d = await this.detections.category(ctx, st.projectId, st.today, st.locale, category);
      if (d === null) return { ...EMPTY, missing: [notAvailable(`tool:${name}`, `Information for "${name}" is not available in sources you are authorized to see.`, `المعلومات الخاصة بـ «${name}» غير متاحة في المصادر المصرح لك بالاطلاع عليها.`)] };
      return { items: d.map((x) => this.detectionItem(x, name)), missing: [], detections: d };
    }

    switch (name) {
      case 'search_documents': {
        const rows = await this.knowledge.searchDocuments(ctx, st.projectId, args.query ?? '');
        if (rows === null || rows.length === 0) {
          return { ...EMPTY, missing: [notAvailable('documents', 'No indexed document you are authorized to see matches the question.', 'لا توجد وثيقة مفهرسة مصرح لك بالاطلاع عليها تطابق السؤال.')] };
        }
        // One context item per document (chunks of the same document are merged, best rank first).
        const byDoc = new Map<string, ContextItem>();
        for (const c of rows) {
          const existing = byDoc.get(c.document_id);
          const location = [c.page ? `p.${c.page}` : null, c.section ? `§ ${c.section}` : null].filter(Boolean).join(' ') || null;
          if (existing) {
            existing.text = `${existing.text}\n…\n${c.text}`.slice(0, 4000);
            existing.suspicious = existing.suspicious || c.suspicious;
            continue;
          }
          const ref = { type: 'document', id: c.document_id, version: c.version_no, location, label: c.title, isDemo: c.is_demo };
          byDoc.set(c.document_id, {
            key: citationKey(ref),
            ref,
            kind: 'document_chunk',
            tool: name,
            classification: c.classification,
            roomId: c.room_id,
            title: c.title,
            text: c.text.slice(0, 4000),
            suspicious: c.suspicious,
            sourceUpdatedAt: iso(c.uploaded_at),
          });
        }
        return { items: [...byDoc.values()], missing: [], detections: [] };
      }
      case 'get_gate_blockers': {
        const gates = await this.knowledge.gateBlockers(ctx, st.projectId);
        if (gates === null) return { ...EMPTY, missing: [notAvailable('tool:get_gate_blockers', 'Gate information is not available in sources you are authorized to see.', 'معلومات البوابات غير متاحة في المصادر المصرح لك بالاطلاع عليها.')] };
        const items = gates.map((g): ContextItem => {
          const ref = { type: 'gate_definition', id: g.gate_id, version: g.version, label: `${g.key} ${g.name}` };
          const crit = g.criteria.map((c) => `${c.key} (${c.status})`).join('; ');
          return {
            key: citationKey(ref),
            ref,
            kind: 'record',
            tool: name,
            classification: 'internal',
            roomId: null,
            title: `${g.key} ${st.locale === 'ar' && g.name_ar ? g.name_ar : g.name}`,
            text: L(
              `Gate ${g.key} assessment status ${g.status}; ${g.blocking_unmet} mandatory blocking criteria not met${crit ? `: ${crit}` : ''}.`,
              `حالة تقييم البوابة ${g.key}: ${g.status}؛ ${g.blocking_unmet} معيارًا إلزاميًا مانعًا غير مستوفى${crit ? `: ${crit}` : ''}.`,
            ),
            facts: { gateKey: g.key, status: g.status, blockingUnmet: g.blocking_unmet },
            suspicious: false,
            sourceUpdatedAt: iso(g.updated_at),
          };
        });
        return { items, missing: [], detections: [] };
      }
      case 'get_status_dimensions': {
        const dims = await this.knowledge.statusDimensions(ctx, st.projectId);
        if (dims === null) return { ...EMPTY, missing: [notAvailable('tool:get_status_dimensions', 'Status dimensions are not available in sources you are authorized to see.', 'أبعاد الحالة غير متاحة في المصادر المصرح لك بالاطلاع عليها.')] };
        if (!dims.length) return { ...EMPTY, missing: [notAvailable('status_dimensions', 'Status dimensions have not been computed for this project yet.', 'لم تُحسب أبعاد الحالة لهذا المشروع بعد.', 'project_manager')] };
        return {
          items: dims.map((d): ContextItem => {
            const ref = { type: 'status_dimension', id: d.id, version: d.version, label: d.key };
            return { key: citationKey(ref), ref, kind: 'record', tool: name, classification: 'internal', roomId: null, title: L(`Status dimension ${d.key}`, `بُعد الحالة ${d.key}`), text: `${d.state}${d.explanation ? ` — ${d.explanation}` : ''}`, facts: { state: d.state }, suspicious: false, sourceUpdatedAt: iso(d.computedAt) };
          }),
          missing: [],
          detections: [],
        };
      }
      case 'get_partner_status': {
        const r = await this.knowledge.partners(ctx, st.projectId, st.projectIsDemo);
        const missingPartner = notAvailable(
          'confirmed_partner',
          'No confirmed partner identity exists in sources you are authorized to see. Required evidence: an approved deal scenario / partner decision recorded in the JV register.',
          'لا توجد هوية شريك مؤكدة في المصادر المصرح لك بالاطلاع عليها. الدليل المطلوب: سيناريو صفقة معتمد أو قرار شريك مسجّل في سجل المشروع المشترك.',
          'sponsor',
        );
        if (r === null) return { ...EMPTY, missing: [missingPartner] };
        const confirmed = r.partners.filter((p) => r.approvedScenarios.some((s) => s.partnerId === p.id));
        if (!confirmed.length) return { ...EMPTY, missing: [missingPartner] };
        return {
          items: confirmed.map((p): ContextItem => {
            const ref = { type: 'partner', id: p.id, version: p.version, label: `${p.code} ${p.name}`, isDemo: p.isDemo };
            return { key: citationKey(ref), ref, kind: 'record', tool: name, classification: p.classification as Classification, roomId: null, title: `${p.code} ${p.name}${p.isDemo ? ' (Demo)' : ''}`, text: L(`Partner ${p.code} stage ${p.stage}; an approved deal scenario exists.`, `الشريك ${p.code} في مرحلة ${p.stage}؛ يوجد سيناريو صفقة معتمد.`), facts: { stage: p.stage }, suspicious: false, sourceUpdatedAt: iso(p.updatedAt) };
          }),
          missing: [],
          detections: [],
        };
      }
      case 'get_approved_financials': {
        const r = await this.knowledge.approvedFinancials(ctx, st.projectId, st.projectIsDemo);
        const missingVal = notAvailable(
          'approved_valuation',
          'No approved valuation exists in sources you are authorized to see. Required evidence: an approved valuation model version (finance) with its value basis, currency and unit. The assistant does not compute valuations.',
          'لا يوجد تقييم معتمد في المصادر المصرح لك بالاطلاع عليها. الدليل المطلوب: نسخة نموذج تقييم معتمدة (المالية) مع أساس القيمة والعملة والوحدة. المساعد لا يحسب التقييمات.',
          'finance_restricted',
        );
        if (r === null) return { ...EMPTY, missing: [missingVal] };
        const items: ContextItem[] = [];
        for (const v of r.valuations) {
          const ref = { type: 'financial_model_version', id: v.id, version: v.version, label: `Valuation ${v.versionLabel} (${v.modelCase})`, isDemo: v.isDemo };
          const outs = (v.outputs ?? []).map((o) => `${o.label}: ${o.amount} ${o.currency} ×${o.unitScale} (${o.basis})`).join('; ');
          items.push({ key: citationKey(ref), ref, kind: 'record', tool: name, classification: v.classification as Classification, roomId: null, title: ref.label, text: L(`Approved valuation version ${v.versionLabel}: ${outs || 'no outputs recorded'}.`, `نسخة التقييم المعتمدة ${v.versionLabel}: ${outs || 'لا توجد مخرجات مسجلة'}.`), suspicious: false, sourceUpdatedAt: iso(v.approvedAt) });
        }
        for (const f of r.figures) {
          const ref = { type: 'financial_snapshot', id: f.id, version: f.version, label: `${f.label} ${f.period}`, isDemo: f.isDemo };
          items.push({ key: citationKey(ref), ref, kind: 'record', tool: name, classification: f.classification as Classification, roomId: null, title: ref.label, text: L(`Approved ${f.kind} figure ${f.label} (${f.period}): ${f.amount} ${f.currency} ×${f.unitScale}.`, `رقم ${f.kind} معتمد ${f.label} (${f.period}): ${f.amount} ${f.currency} ×${f.unitScale}.`), suspicious: false, sourceUpdatedAt: iso(f.approvedAt) });
        }
        return { items, missing: r.valuations.length ? [] : [missingVal], detections: [] };
      }
      default:
        return EMPTY;
    }
  }

  private detectionItem(d: DetectionFull, tool: string): ContextItem {
    const primary = d.citations.find((c) => c.type === 'computation') ?? d.citations[0]!;
    return {
      key: citationKey(primary),
      ref: primary,
      kind: primary.type === 'computation' ? 'computation' : 'record',
      tool,
      // Derived classification for the provider ceiling (threat-model §5.2 examples): plan/readiness records are
      // internal; decisions and TSAs carry their own classification; committee actions their decision's and committees'
      // (SEC-P5-03); the CP register is confidential; anything else fails closed.
      classification: d.meta.classification ?? RECORD_CLASSIFICATION[d.entityType] ?? 'strictly_confidential',
      roomId: null,
      title: d.label,
      text: d.detail,
      facts: { detection: d.code, ownerUserId: d.meta.ownerUserId, gateKey: d.gateKey, dueDate: d.dueDate, severity: d.severity },
      suspicious: false,
      sourceUpdatedAt: d.meta.updatedAt,
      verificationStatus: d.meta.verification,
    };
  }
}
