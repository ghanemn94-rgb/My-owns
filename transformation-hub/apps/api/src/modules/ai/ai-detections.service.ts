import { Injectable } from '@nestjs/common';
import type { AiDetection } from '@hub/contracts';
import { derivedClassification, type Classification } from '@hub/domain';
import type { RequestContext } from '../../platform/context';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiConfig } from './ai-config';

export type Locale = 'en' | 'ar';
export const tr = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

/** Internal detection with metadata the API never returns (strict response contracts). */
export interface DetectionFull extends AiDetection {
  meta: { ownerUserId: string | null; updatedAt: string | null; verification: string | null; version: number | null; category: DetectionCategory; classification?: Classification };
}

export const DETECTION_CATEGORIES = ['overdue', 'owners', 'stale', 'governance', 'closing', 'tsa', 'readiness'] as const;
export type DetectionCategory = (typeof DETECTION_CATEGORIES)[number];

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Deterministic detections (spec §12.2): lateness, missing owners/evidence, stale updates, approval bottlenecks,
 * predecessor-delay impacts, CP/TSA-to-gate links. Rules only — they work with AI Off, over budget or with the provider
 * down (AT-21) and never call a model. Every detection is computed under the caller's ACL (via AiKnowledgeService).
 */
@Injectable()
export class AiDetectionsService {
  constructor(
    private readonly knowledge: AiKnowledgeService,
    private readonly cfg: AiConfig,
  ) {}

  async compute(ctx: RequestContext, projectId: string, today: string, locale: Locale, categories: readonly DetectionCategory[] = DETECTION_CATEGORIES) {
    const out: DetectionFull[] = [];
    const unavailable: DetectionCategory[] = [];
    for (const c of categories) {
      const r = await this.category(ctx, projectId, today, locale, c);
      if (r === null) unavailable.push(c);
      else out.push(...r);
    }
    return { detections: out, unavailable };
  }

  /** Strip internal metadata for API output. */
  static toDto(d: DetectionFull): AiDetection {
    return { code: d.code, severity: d.severity, entityType: d.entityType, entityId: d.entityId, label: d.label, detail: d.detail, gateKey: d.gateKey, dueDate: d.dueDate, citations: d.citations };
  }

  async category(ctx: RequestContext, projectId: string, today: string, locale: Locale, c: DetectionCategory): Promise<DetectionFull[] | null> {
    const L = (en: string, ar: string) => tr(locale, en, ar);
    switch (c) {
      case 'overdue': {
        const r = await this.knowledge.overdueWork(ctx, projectId, today);
        if (!r) return null;
        const out: DetectionFull[] = [];
        for (const t of r.tasks) {
          out.push({
            code: 'task_overdue',
            severity: t.gateKey ? 'critical' : 'warning',
            entityType: 'task',
            entityId: t.id,
            label: `${t.code} ${locale === 'ar' && t.titleAr ? t.titleAr : t.title}`,
            detail: L(
              `Task ${t.code} is overdue (due ${t.due}, status ${t.status})${t.ownerUserId ? '' : ', no accountable owner'}${t.gateKey ? `; linked to gate ${t.gateKey}` : ''}.`,
              `المهمة ${t.code} متأخرة (الاستحقاق ${t.due}، الحالة ${t.status})${t.ownerUserId ? '' : '، بلا مالك مسؤول'}${t.gateKey ? `؛ مرتبطة بالبوابة ${t.gateKey}` : ''}.`,
            ),
            gateKey: t.gateKey,
            dueDate: t.due,
            citations: [{ type: 'task', id: t.id, version: t.version, label: `${t.code} ${t.title}`, isDemo: t.isDemo }],
            meta: { ownerUserId: t.ownerUserId, updatedAt: iso(t.updatedAt), verification: t.verificationStatus, version: t.version, category: c },
          });
        }
        for (const m of r.milestones) {
          out.push({
            code: 'milestone_overdue',
            severity: 'critical',
            entityType: 'milestone',
            entityId: m.id,
            label: `${m.code} ${locale === 'ar' && m.titleAr ? m.titleAr : m.title}`,
            detail: L(`Milestone ${m.code} passed its date (${m.due}) without being achieved${m.gateKey ? `; gate ${m.gateKey}` : ''}.`, `تجاوز المعلم ${m.code} تاريخه (${m.due}) دون تحقيقه${m.gateKey ? `؛ البوابة ${m.gateKey}` : ''}.`),
            gateKey: m.gateKey,
            dueDate: m.due,
            citations: [{ type: 'milestone', id: m.id, version: m.version, label: `${m.code} ${m.title}`, isDemo: m.isDemo }],
            meta: { ownerUserId: m.ownerUserId, updatedAt: iso(m.updatedAt), verification: m.verificationStatus, version: m.version, category: c },
          });
        }
        for (const m of r.pendingEvidence) {
          out.push({
            code: 'milestone_pending_evidence',
            severity: 'warning',
            entityType: 'milestone',
            entityId: m.id,
            label: `${m.code} ${m.title}`,
            detail: L(`Milestone ${m.code} is reported achieved but its evidence is not yet verified.`, `أُبلغ عن تحقيق المعلم ${m.code} لكن أدلته لم تُتحقق بعد.`),
            gateKey: m.gateKey,
            dueDate: null,
            citations: [{ type: 'milestone', id: m.id, version: m.version, label: `${m.code} ${m.title}` }],
            meta: { ownerUserId: m.ownerUserId, updatedAt: iso(m.updatedAt), verification: null, version: m.version, category: c },
          });
        }
        // Predecessor-delay impacts: deterministic CPM (the model never computes schedule numbers — AT-15).
        const impacts = await this.knowledge.predecessorDelays(ctx, projectId, today, r.tasks.map((t) => ({ id: t.id, due: t.due })));
        for (const i of impacts) {
          const t = r.tasks.find((x) => x.id === i.taskId)!;
          const affected = i.impact.affected.filter((a) => a.id !== i.taskId);
          if (i.impact.status !== 'computed') {
            out.push({
              code: 'predecessor_delay',
              severity: 'info',
              entityType: 'task',
              entityId: t.id,
              label: `${t.code} ${t.title}`,
              detail: L(`Delay impact of ${t.code} cannot be computed: the schedule is ${i.impact.status} (${i.impact.issues.map((x) => x.code).join(', ') || 'missing data'}).`, `تعذّر حساب أثر تأخر ${t.code}: الجدول ${i.impact.status === 'incomplete' ? 'غير مكتمل' : 'غير صالح'}.`),
              gateKey: t.gateKey,
              dueDate: t.due,
              citations: [{ type: 'task', id: t.id, version: t.version, label: `${t.code} ${t.title}` }],
              meta: { ownerUserId: t.ownerUserId, updatedAt: iso(t.updatedAt), verification: null, version: t.version, category: c },
            });
            continue;
          }
          if (!affected.length) continue;
          out.push({
            code: 'predecessor_delay',
            severity: affected.some((a) => a.critical) ? 'critical' : 'warning',
            entityType: 'task',
            entityId: t.id,
            label: `${t.code} ${t.title}`,
            detail: L(
              `A ${i.delay}-working-day delay of ${t.code} moves ${affected.length} successor(s); project finish slip ${i.impact.projectSlipWorkingDays ?? 'n/a'} working day(s) (schedule-based forecast, no probability).`,
              `تأخر ${t.code} بمقدار ${i.delay} يوم عمل يؤثر على ${affected.length} نشاطًا لاحقًا؛ انزياح نهاية المشروع ${i.impact.projectSlipWorkingDays ?? 'غير متاح'} يوم عمل (توقع مبني على الجدول، دون احتمالات).`,
            ),
            gateKey: t.gateKey,
            dueDate: t.due,
            citations: [
              { type: 'task', id: t.id, version: t.version, label: `${t.code} ${t.title}` },
              { type: 'computation', id: `delay_impact:${t.id}:${i.delay}`, label: 'CPM delay impact (deterministic)' },
            ],
            meta: { ownerUserId: t.ownerUserId, updatedAt: iso(t.updatedAt), verification: null, version: t.version, category: c },
          });
        }
        return out;
      }
      case 'owners': {
        const r = await this.knowledge.missingOwners(ctx, projectId);
        if (!r) return null;
        const out: DetectionFull[] = r.tasks.map((t) => ({
          code: 'owner_missing' as const,
          severity: t.status === 'draft' ? ('info' as const) : ('warning' as const),
          entityType: 'task',
          entityId: t.id,
          label: `${t.code} ${t.title}`,
          detail: L(`Task ${t.code} has no accountable owner (status ${t.status}).`, `المهمة ${t.code} بلا مالك مسؤول (الحالة ${t.status}).`),
          gateKey: t.gateKey,
          dueDate: null,
          citations: [{ type: 'task', id: t.id, version: t.version, label: `${t.code} ${t.title}` }],
          meta: { ownerUserId: null, updatedAt: iso(t.updatedAt), verification: null, version: t.version, category: c },
        }));
        for (const m of r.milestones) {
          out.push({
            code: 'owner_missing',
            severity: 'warning',
            entityType: 'milestone',
            entityId: m.id,
            label: `${m.code} ${m.title}`,
            detail: L(`Milestone ${m.code} has no owner.`, `المعلم ${m.code} بلا مالك.`),
            gateKey: m.gateKey,
            dueDate: null,
            citations: [{ type: 'milestone', id: m.id, version: m.version, label: `${m.code} ${m.title}` }],
            meta: { ownerUserId: null, updatedAt: iso(m.updatedAt), verification: null, version: m.version, category: c },
          });
        }
        return out;
      }
      case 'stale': {
        const r = await this.knowledge.staleUpdates(ctx, projectId, today);
        if (!r) return null;
        return r.map((w) => ({
          code: 'stale_update' as const,
          severity: 'info' as const,
          entityType: 'workstream',
          entityId: w.id,
          label: `${w.code} ${w.name}`,
          detail: w.last_period
            ? L(`No submitted/accepted status update for ${w.code} since ${w.last_period} (older than ${this.cfg.staleUpdateDays} days).`, `لا يوجد تحديث حالة مقدم/مقبول لمسار ${w.code} منذ ${w.last_period}.`)
            : L(`No submitted/accepted status update recorded for ${w.code}.`, `لم يُسجل أي تحديث حالة مقدم/مقبول لمسار ${w.code}.`),
          gateKey: null,
          dueDate: null,
          citations: [{ type: 'workstream', id: w.id, version: w.version, label: `${w.code} ${w.name}` }],
          meta: { ownerUserId: null, updatedAt: iso(w.updated_at), verification: null, version: w.version, category: c },
        }));
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
          out.push({
            code: 'decision_bottleneck',
            severity: late ? 'critical' : 'warning',
            entityType: 'decision',
            entityId: d.id,
            label: `${d.code} ${d.title}`,
            detail: late
              ? L(`Decision ${d.code} (${d.status}) is past its latest safe date ${d.latestSafeDate}.`, `القرار ${d.code} (${d.status}) تجاوز آخر تاريخ آمن ${d.latestSafeDate}.`)
              : L(`Decision ${d.code} has been ${d.status} for ${waitingDays} day(s).`, `القرار ${d.code} في حالة ${d.status} منذ ${waitingDays} يومًا.`),
            gateKey: d.gateKey,
            dueDate: d.latestSafeDate,
            citations: [{ type: 'decision', id: d.id, version: d.version, label: `${d.code} ${d.title}`, isDemo: d.isDemo }],
            meta: { ownerUserId: null, updatedAt: iso(d.updatedAt), verification: null, version: d.version, category: c, classification: d.classification as Classification },
          });
        }
        for (const a of r.actions) {
          out.push({
            code: 'action_overdue',
            severity: 'warning',
            entityType: 'action_item',
            entityId: a.id,
            label: `${a.code} ${a.title}`,
            detail: L(`Committee action ${a.code} is overdue (due ${a.dueDate}).`, `إجراء اللجنة ${a.code} متأخر (الاستحقاق ${a.dueDate}).`),
            gateKey: null,
            dueDate: a.dueDate,
            citations: [{ type: 'action_item', id: a.id, version: a.version, label: `${a.code} ${a.title}` }],
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
            label: L(`Approval request (${p.subjectType}: ${p.action})`, `طلب اعتماد (${p.subjectType}: ${p.action})`),
            detail: L(`An approval request has been pending since ${iso(p.createdAt)!.slice(0, 10)}.`, `طلب اعتماد معلق منذ ${iso(p.createdAt)!.slice(0, 10)}.`),
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
          const cite = [{ type: 'closing_condition', id: cp.id, version: cp.version, label: `${cp.reference} ${cp.title}`, isDemo: cp.is_demo }];
          if (cp.blocking && cp.active_evidence === 0) {
            out.push({
              code: 'cp_missing_evidence',
              severity: 'critical',
              entityType: 'closing_condition',
              entityId: cp.id,
              label: `${cp.reference} ${cp.title}`,
              detail: L(
                `Blocking condition ${cp.reference} (${cp.status}) has no active evidence${cp.waivable ? '' : '; it is recorded as non-waivable'}. Closing cannot be confirmed while it is unmet.`,
                `الشرط المانع ${cp.reference} (${cp.status}) بلا أدلة سارية${cp.waivable ? '' : '؛ ومسجّل كغير قابل للإعفاء'}. لا يمكن تأكيد الإغلاق طالما لم يُستوفَ.`,
              ),
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
              label: `${cp.reference} ${cp.title}`,
              detail: L(`Open condition ${cp.reference} (${cp.status}) blocks gate ${cp.gate_key}.`, `الشرط المفتوح ${cp.reference} (${cp.status}) يعيق البوابة ${cp.gate_key}.`),
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
        return r.map((s) => ({
          code: 'tsa_expiring' as const,
          severity: s.endDate && s.endDate < today ? ('critical' as const) : ('warning' as const),
          entityType: 'tsa_service',
          entityId: s.id,
          label: `${s.code} ${s.name}`,
          detail: L(
            `TSA service ${s.code} ends ${s.endDate} without an accepted replacement (status ${s.status}). Exit is not declared; extension/continuity options need approval. No gate link is recorded for TSAs — check the readiness gate.`,
            `تنتهي خدمة الاتفاقية الانتقالية ${s.code} في ${s.endDate} دون بديل مقبول (الحالة ${s.status}). لم يُعلن الخروج؛ خيارات التمديد/الاستمرارية تتطلب اعتمادًا.`,
          ),
          gateKey: null,
          dueDate: s.endDate,
          citations: [{ type: 'tsa_service', id: s.id, version: s.version, label: `${s.code} ${s.name}`, isDemo: s.isDemo }],
          // The TSA's own classification (provider ceiling, derived classification — access-matrix §2.6).
          meta: { ownerUserId: s.ownerUserId, updatedAt: iso(s.updatedAt), verification: null, version: s.version, category: c, classification: s.classification as Classification },
        }));
      }
      case 'readiness': {
        const r = await this.knowledge.readinessBlockers(ctx, projectId);
        if (!r) return null;
        return r.map((x) => ({
          code: 'readiness_blocker' as const,
          severity: x.blocker ? ('critical' as const) : ('warning' as const),
          entityType: 'readiness_check',
          entityId: x.id,
          label: `${x.code} ${x.title}`,
          detail: L(`Readiness check ${x.code} (${x.area}) is ${x.status}${x.blocker ? ' and is a go-live blocker' : ''}.`, `فحص الجاهزية ${x.code} (${x.area}) حالته ${x.status}${x.blocker ? ' وهو مانع للتشغيل' : ''}.`),
          gateKey: null,
          dueDate: x.dueDate,
          citations: [{ type: 'readiness_check', id: x.id, version: x.version, label: `${x.code} ${x.title}`, isDemo: x.isDemo }],
          meta: { ownerUserId: null, updatedAt: iso(x.updatedAt), verification: null, version: x.version, category: c },
        }));
      }
    }
  }
}
