import { Injectable } from '@nestjs/common';
import type { AiDetection } from '@hub/contracts';
import { aiMessage, derivedClassification, renderAiMessages, type AiDetectionMessageCode, type Classification, type ServerMessage } from '@hub/domain';
import type { RequestContext } from '../../platform/context';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiConfig } from './ai-config';

export type Locale = 'en' | 'ar';
export const tr = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

/** Internal detection with metadata the API never returns (strict response contracts). */
export interface DetectionFull extends AiDetection {
  /** The detail as codes + parameters (always present here; optional in the DTO only for runs stored before QA-P5-04). */
  detailI18n: ServerMessage[];
  meta: { ownerUserId: string | null; updatedAt: string | null; verification: string | null; version: number | null; category: DetectionCategory; classification?: Classification };
}

export const DETECTION_CATEGORIES = ['overdue', 'owners', 'stale', 'governance', 'closing', 'tsa', 'readiness'] as const;
export type DetectionCategory = (typeof DETECTION_CATEGORIES)[number];

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * `<code> <title>` and, only when the record has an Arabic (template) title, its Arabic form — bilingual data, module guide
 * §2. A title typed by a person has no Arabic counterpart: no `labelAr` at all, and it is shown as entered.
 */
const labels = (code: string, title: string, titleAr?: string | null): { label: string; labelAr?: string } => (titleAr ? { label: `${code} ${title}`, labelAr: `${code} ${titleAr}` } : { label: `${code} ${title}` });

/** Detail as codes + parameters and its English sentence (QA-P5-04). The web translates the codes; an Arabic run's model
 * context is rendered from the same codes in Arabic (AiToolsService). */
const detailOf = (...messages: (ServerMessage | null)[]) => {
  const detailI18n = messages.filter((m): m is ServerMessage => m !== null);
  return { detail: renderAiMessages(detailI18n, 'en'), detailI18n };
};
const m = (code: AiDetectionMessageCode, params: Record<string, string | number> = {}) => aiMessage(code, params);

/**
 * Deterministic detections (spec §12.2): lateness, missing owners/evidence, stale updates, approval bottlenecks,
 * predecessor-delay impacts, CP/TSA-to-gate links. Rules only — they work with AI Off, over budget or with the provider
 * down (AT-21) and never call a model. Every detection is computed under the caller's ACL (via AiKnowledgeService).
 * Output (QA-P5-04, module guide §2): `label` (English/primary) + `labelAr` (Arabic template title, or null); `detail`
 * (English) + `detailI18n` (codes + parameters; statuses as enum values the client translates).
 */
@Injectable()
export class AiDetectionsService {
  constructor(
    private readonly knowledge: AiKnowledgeService,
    private readonly cfg: AiConfig,
  ) {}

  async compute(ctx: RequestContext, projectId: string, today: string, categories: readonly DetectionCategory[] = DETECTION_CATEGORIES) {
    const out: DetectionFull[] = [];
    const unavailable: DetectionCategory[] = [];
    for (const c of categories) {
      const r = await this.category(ctx, projectId, today, c);
      if (r === null) unavailable.push(c);
      else out.push(...r);
    }
    return { detections: out, unavailable };
  }

  /** Strip internal metadata for API output. */
  static toDto(d: DetectionFull): AiDetection {
    return { code: d.code, severity: d.severity, entityType: d.entityType, entityId: d.entityId, label: d.label, ...(d.labelAr ? { labelAr: d.labelAr } : {}), detail: d.detail, detailI18n: d.detailI18n, gateKey: d.gateKey, dueDate: d.dueDate, citations: d.citations };
  }

  async category(ctx: RequestContext, projectId: string, today: string, c: DetectionCategory): Promise<DetectionFull[] | null> {
    switch (c) {
      case 'overdue': {
        const r = await this.knowledge.overdueWork(ctx, projectId, today);
        if (!r) return null;
        const out: DetectionFull[] = [];
        for (const t of r.tasks) {
          const l = labels(t.code, t.title, t.titleAr);
          out.push({
            code: 'task_overdue',
            severity: t.gateKey ? 'critical' : 'warning',
            entityType: 'task',
            entityId: t.id,
            ...l,
            ...detailOf(m('ai.detection.task_overdue', { code: t.code, due: t.due, status: t.status }), t.ownerUserId ? null : m('ai.detection.no_owner'), t.gateKey ? m('ai.detection.gate_link', { gateKey: t.gateKey }) : null),
            gateKey: t.gateKey,
            dueDate: t.due,
            citations: [{ type: 'task', id: t.id, version: t.version, ...l, isDemo: t.isDemo }],
            meta: { ownerUserId: t.ownerUserId, updatedAt: iso(t.updatedAt), verification: t.verificationStatus, version: t.version, category: c },
          });
        }
        for (const ms of r.milestones) {
          const l = labels(ms.code, ms.title, ms.titleAr);
          out.push({
            code: 'milestone_overdue',
            severity: 'critical',
            entityType: 'milestone',
            entityId: ms.id,
            ...l,
            ...detailOf(m('ai.detection.milestone_overdue', { code: ms.code, due: ms.due }), ms.gateKey ? m('ai.detection.gate_link', { gateKey: ms.gateKey }) : null),
            gateKey: ms.gateKey,
            dueDate: ms.due,
            citations: [{ type: 'milestone', id: ms.id, version: ms.version, ...l, isDemo: ms.isDemo }],
            meta: { ownerUserId: ms.ownerUserId, updatedAt: iso(ms.updatedAt), verification: ms.verificationStatus, version: ms.version, category: c },
          });
        }
        for (const ms of r.pendingEvidence) {
          const l = labels(ms.code, ms.title, ms.titleAr);
          out.push({
            code: 'milestone_pending_evidence',
            severity: 'warning',
            entityType: 'milestone',
            entityId: ms.id,
            ...l,
            ...detailOf(m('ai.detection.milestone_pending_evidence', { code: ms.code })),
            gateKey: ms.gateKey,
            dueDate: null,
            citations: [{ type: 'milestone', id: ms.id, version: ms.version, ...l }],
            meta: { ownerUserId: ms.ownerUserId, updatedAt: iso(ms.updatedAt), verification: null, version: ms.version, category: c },
          });
        }
        // Predecessor-delay impacts: deterministic CPM (the model never computes schedule numbers — AT-15).
        const impacts = await this.knowledge.predecessorDelays(ctx, projectId, today, r.tasks.map((t) => ({ id: t.id, due: t.due })));
        for (const i of impacts) {
          const t = r.tasks.find((x) => x.id === i.taskId)!;
          const l = labels(t.code, t.title, t.titleAr);
          const affected = i.impact.affected.filter((a) => a.id !== i.taskId);
          if (i.impact.status !== 'computed') {
            out.push({
              code: 'predecessor_delay',
              severity: 'info',
              entityType: 'task',
              entityId: t.id,
              ...l,
              ...detailOf(m(i.impact.status === 'incomplete' ? 'ai.detection.delay_impact_incomplete' : 'ai.detection.delay_impact_invalid', { code: t.code })),
              gateKey: t.gateKey,
              dueDate: t.due,
              citations: [{ type: 'task', id: t.id, version: t.version, ...l }],
              meta: { ownerUserId: t.ownerUserId, updatedAt: iso(t.updatedAt), verification: null, version: t.version, category: c },
            });
            continue;
          }
          if (!affected.length) continue;
          const slip = i.impact.projectSlipWorkingDays;
          out.push({
            code: 'predecessor_delay',
            severity: affected.some((a) => a.critical) ? 'critical' : 'warning',
            entityType: 'task',
            entityId: t.id,
            ...l,
            ...detailOf(
              slip === null || slip === undefined
                ? m('ai.detection.delay_impact_no_slip', { code: t.code, delay: i.delay, successors: affected.length })
                : m('ai.detection.delay_impact', { code: t.code, delay: i.delay, successors: affected.length, slip }),
            ),
            gateKey: t.gateKey,
            dueDate: t.due,
            citations: [
              { type: 'task', id: t.id, version: t.version, ...l },
              { type: 'computation', id: `delay_impact:${t.id}:${i.delay}`, label: 'CPM delay impact (deterministic)', labelAr: 'أثر التأخر وفق المسار الحرج (حتمي)' },
            ],
            meta: { ownerUserId: t.ownerUserId, updatedAt: iso(t.updatedAt), verification: null, version: t.version, category: c },
          });
        }
        return out;
      }
      case 'owners': {
        const r = await this.knowledge.missingOwners(ctx, projectId);
        if (!r) return null;
        const out: DetectionFull[] = r.tasks.map((t) => {
          const l = labels(t.code, t.title, t.titleAr);
          return {
            code: 'owner_missing' as const,
            severity: t.status === 'draft' ? ('info' as const) : ('warning' as const),
            entityType: 'task',
            entityId: t.id,
            ...l,
            ...detailOf(m('ai.detection.task_owner_missing', { code: t.code, status: t.status })),
            gateKey: t.gateKey,
            dueDate: null,
            citations: [{ type: 'task', id: t.id, version: t.version, ...l }],
            meta: { ownerUserId: null, updatedAt: iso(t.updatedAt), verification: null, version: t.version, category: c },
          };
        });
        for (const ms of r.milestones) {
          const l = labels(ms.code, ms.title, ms.titleAr);
          out.push({
            code: 'owner_missing',
            severity: 'warning',
            entityType: 'milestone',
            entityId: ms.id,
            ...l,
            ...detailOf(m('ai.detection.milestone_owner_missing', { code: ms.code })),
            gateKey: ms.gateKey,
            dueDate: null,
            citations: [{ type: 'milestone', id: ms.id, version: ms.version, ...l }],
            meta: { ownerUserId: null, updatedAt: iso(ms.updatedAt), verification: null, version: ms.version, category: c },
          });
        }
        return out;
      }
      case 'stale': {
        const r = await this.knowledge.staleUpdates(ctx, projectId, today);
        if (!r) return null;
        return r.map((w) => {
          const l = labels(w.code, w.name, w.name_ar);
          return {
            code: 'stale_update' as const,
            severity: 'info' as const,
            entityType: 'workstream',
            entityId: w.id,
            ...l,
            ...detailOf(w.last_period ? m('ai.detection.stale_update', { code: w.code, date: w.last_period, days: this.cfg.staleUpdateDays }) : m('ai.detection.stale_update_never', { code: w.code })),
            gateKey: null,
            dueDate: null,
            citations: [{ type: 'workstream', id: w.id, version: w.version, ...l }],
            meta: { ownerUserId: null, updatedAt: iso(w.updated_at), verification: null, version: w.version, category: c },
          };
        });
      }
      case 'governance': {
        const r = await this.knowledge.decisionsAwaiting(ctx, projectId, today);
        if (!r) return null;
        const out: DetectionFull[] = [];
        const bottleneckMs = this.cfg.bottleneckDays * 86_400_000;
        for (const d of r.decisions) {
          const waitingDays = Math.floor((Date.parse(today) - new Date(d.updatedAt).getTime()) / 86_400_000);
          const late = d.latestSafeDate && d.latestSafeDate < today;
          if (!late && Date.parse(today) - new Date(d.updatedAt).getTime() < bottleneckMs) continue;
          // Decision titles are user-entered text (no Arabic field): shown as entered.
          const l = labels(d.code, d.title);
          out.push({
            code: 'decision_bottleneck',
            severity: late ? 'critical' : 'warning',
            entityType: 'decision',
            entityId: d.id,
            ...l,
            ...detailOf(late ? m('ai.detection.decision_late', { code: d.code, status: d.status, date: d.latestSafeDate! }) : m('ai.detection.decision_waiting', { code: d.code, status: d.status, days: waitingDays })),
            gateKey: d.gateKey,
            dueDate: d.latestSafeDate,
            citations: [{ type: 'decision', id: d.id, version: d.version, ...l, isDemo: d.isDemo }],
            meta: { ownerUserId: null, updatedAt: iso(d.updatedAt), verification: null, version: d.version, category: c, classification: d.classification as Classification },
          });
        }
        for (const a of r.actions) {
          const l = labels(a.code, a.title);
          out.push({
            code: 'action_overdue',
            severity: 'warning',
            entityType: 'action_item',
            entityId: a.id,
            ...l,
            ...detailOf(m('ai.detection.action_overdue', { code: a.code, due: a.dueDate! })),
            gateKey: null,
            dueDate: a.dueDate,
            citations: [{ type: 'action_item', id: a.id, version: a.version, ...l }],
            // SEC-P5-03: derived classification for the provider ceiling — the action's decision, that decision's committee and
            // its meeting's committee (a linked parent that cannot be read fails closed to strictly_confidential).
            meta: {
              ownerUserId: a.ownerUserId,
              updatedAt: iso(a.updatedAt),
              verification: null,
              version: a.version,
              category: c,
              classification: derivedClassification('internal', [
                ...(a.decisionId ? [a.decisionClassification, a.decisionCommitteeClassification] : []),
                ...(a.meetingId ? [a.meetingCommitteeClassification] : []),
              ]),
            },
          });
        }
        for (const p of r.approvals) {
          out.push({
            code: 'approval_bottleneck',
            severity: 'warning',
            entityType: 'approval_request',
            entityId: p.id,
            label: `Approval request (${p.subjectType}: ${p.action})`,
            labelAr: `طلب اعتماد (${p.subjectType}: ${p.action})`,
            ...detailOf(m('ai.detection.approval_waiting', { date: iso(p.createdAt)!.slice(0, 10) })),
            gateKey: null,
            dueDate: null,
            citations: [{ type: 'approval_request', id: p.id, version: p.version }],
            meta: { ownerUserId: null, updatedAt: iso(p.createdAt), verification: null, version: p.version, category: c },
          });
        }
        return out;
      }
      case 'closing': {
        const r = await this.knowledge.closingConditions(ctx, projectId);
        if (!r) return null;
        const out: DetectionFull[] = [];
        for (const cp of r) {
          const l = labels(cp.reference, cp.title);
          const cite = [{ type: 'closing_condition', id: cp.id, version: cp.version, ...l, isDemo: cp.is_demo }];
          if (cp.blocking && cp.active_evidence === 0) {
            out.push({
              code: 'cp_missing_evidence',
              severity: 'critical',
              entityType: 'closing_condition',
              entityId: cp.id,
              ...l,
              ...detailOf(m(cp.waivable ? 'ai.detection.cp_missing_evidence' : 'ai.detection.cp_missing_evidence_non_waivable', { code: cp.reference, status: cp.status })),
              gateKey: cp.gate_key,
              dueDate: cp.long_stop_date,
              citations: cite,
              meta: { ownerUserId: cp.owner_user_id, updatedAt: iso(cp.updated_at), verification: cp.conflicting_evidence > 0 ? 'conflicting' : null, version: cp.version, category: c },
            });
          }
          if (cp.gate_key) {
            out.push({
              code: 'cp_open_gate_link',
              severity: cp.blocking ? 'critical' : 'warning',
              entityType: 'closing_condition',
              entityId: cp.id,
              ...l,
              ...detailOf(m('ai.detection.cp_gate_link', { code: cp.reference, status: cp.status, gateKey: cp.gate_key })),
              gateKey: cp.gate_key,
              dueDate: cp.long_stop_date,
              citations: cite,
              meta: { ownerUserId: cp.owner_user_id, updatedAt: iso(cp.updated_at), verification: null, version: cp.version, category: c },
            });
          }
        }
        return out;
      }
      case 'tsa': {
        const r = await this.knowledge.tsaExpiring(ctx, projectId, today);
        if (!r) return null;
        return r.map((s) => {
          const l = labels(s.code, s.name);
          return {
            code: 'tsa_expiring' as const,
            severity: s.endDate && s.endDate < today ? ('critical' as const) : ('warning' as const),
            entityType: 'tsa_service',
            entityId: s.id,
            ...l,
            ...detailOf(m('ai.detection.tsa_expiring', { code: s.code, date: s.endDate ?? '', status: s.status })),
            gateKey: null,
            dueDate: s.endDate,
            citations: [{ type: 'tsa_service', id: s.id, version: s.version, ...l, isDemo: s.isDemo }],
            // The TSA's own classification (provider ceiling, derived classification — access-matrix §2.6).
            meta: { ownerUserId: s.ownerUserId, updatedAt: iso(s.updatedAt), verification: null, version: s.version, category: c, classification: s.classification as Classification },
          };
        });
      }
      case 'readiness': {
        const r = await this.knowledge.readinessBlockers(ctx, projectId);
        if (!r) return null;
        return r.map((x) => {
          const l = labels(x.code, x.title, x.titleAr);
          return {
            code: 'readiness_blocker' as const,
            severity: x.blocker ? ('critical' as const) : ('warning' as const),
            entityType: 'readiness_check',
            entityId: x.id,
            ...l,
            ...detailOf(m(x.blocker ? 'ai.detection.readiness_blocker' : 'ai.detection.readiness_open', { code: x.code, area: x.area, status: x.status })),
            gateKey: null,
            dueDate: x.dueDate,
            citations: [{ type: 'readiness_check', id: x.id, version: x.version, ...l, isDemo: x.isDemo }],
            meta: { ownerUserId: null, updatedAt: iso(x.updatedAt), verification: null, version: x.version, category: c },
          };
        });
      }
    }
  }
}
