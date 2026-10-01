import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  KPI_CALCULATOR_KEYS,
  KPI_SOURCE_PERMISSION,
  kpiActionClosureTime,
  kpiBenefitsRealized,
  kpiContractsAwaitingConsent,
  kpiCpsVerified,
  kpiDay1Readiness,
  kpiDeliverablesAcceptedVsDue,
  kpiMilestoneDelayDays,
  kpiNextGateCriteriaMet,
  kpiOpenBlockers,
  kpiOverdueDecisions,
  kpiPerimeterOutstanding,
  kpiPerimeterTransferred,
  kpiSeparationCostVsBudget,
  kpiTsasAtRisk,
  kpiUpdateFreshness,
  localDate,
  maxClassification,
  serverMessage,
  type Classification,
  type KpiCalculatorKey,
  type KpiComputation,
  type ProjectTemplateDefinition,
} from '@hub/domain';
import type { ReportSectionAccess } from '@hub/db';
import { figure, section, table, type StoredSection } from '../report-model';
import { reachWhere, type Gen } from './gen-context';
import { loadPlanning, type PlanningData } from './planning.collector';

type KpiRow = typeof schema.kpi.$inferSelect;

export interface KpiValue extends KpiComputation {
  /** `restricted`: the caller cannot read the source records (value withheld); `no_calculator`: user-defined KPI. */
  access: 'ok' | 'restricted' | 'no_calculator';
  /** Classifications of the source records that produced the value. */
  sourceClassifications: Classification[];
  /** Permissions the value was computed under (all must be readable to see it). */
  permissions: string[];
  /** Workstreams the value covers ('all' or the generator's reach). */
  workstreamIds: 'all' | 'none' | string[];
  domain: 'finance' | null;
}

const restricted = (perm: string): KpiValue => ({ state: 'no_data', value: null, numerator: null, denominator: null, notes: [], access: 'restricted', sourceClassifications: [], permissions: [perm], workstreamIds: 'none', domain: null });

/** KPI definitions the caller may read (finance.record.read, project-wide — KPIs have no workstream; finance-domain clearance). */
export async function visibleKpis(g: Gen): Promise<KpiRow[]> {
  if (!g.access.policy.permissionReach(g.ctx, 'finance.record.read', g.projectId).all) return [];
  const K = schema.kpi;
  return g.db
    .tx()
    .select()
    .from(K)
    .where(and(eq(K.projectId, g.projectId), g.access.policy.visibilitySql(g.access.fx(g.ctx, g.projectId), g.projectId, { classification: K.classification })))
    .orderBy(asc(K.key), asc(K.id));
}

/** Arabic definitions of the pinned template (kept while the stored definition is still the template's — QA-P34-01h). */
export async function templateKpiDefinitions(g: Gen): Promise<Map<string, { en: string; ar: string }>> {
  if (!g.project.templateVersionId) return new Map();
  const [tv] = await g.db.tx().select({ definition: schema.projectTemplateVersion.definition }).from(schema.projectTemplateVersion).where(eq(schema.projectTemplateVersion.id, g.project.templateVersionId));
  const def = tv?.definition as unknown as ProjectTemplateDefinition | undefined;
  return new Map((def?.kpis ?? []).map((k) => [k.key, k.definition]));
}

/**
 * Deterministic KPI values from the records the caller may read (spec §11). Every calculator reads with the caller's
 * visibility and reach; a source the caller cannot read gives `restricted` (nothing revealed), no records gives `no_data`.
 */
export class KpiEngine {
  private planning: PlanningData | null | undefined;
  constructor(private readonly g: Gen) {}

  private reach(perm: string): 'all' | string[] | null {
    if (!this.g.access.canCollect(this.g.ctx, this.g.projectId, perm)) return null;
    if (this.g.workstreamId) return [this.g.workstreamId];
    const r = this.g.access.policy.permissionReach(this.g.ctx, perm, this.g.projectId);
    return r.all ? 'all' : [...r.workstreamIds].sort();
  }

  private ok(c: KpiComputation, perm: string, cls: Classification[], ws: 'all' | 'none' | string[], domain: 'finance' | null = null, extraPerms: string[] = []): KpiValue {
    const notes = Array.isArray(ws) && !this.g.workstreamId ? [...c.notes, 'kpi.limited_to_your_workstreams'] : c.notes;
    return { ...c, notes, access: 'ok', sourceClassifications: cls, permissions: [perm, ...extraPerms], workstreamIds: ws, domain };
  }

  private async plan(): Promise<PlanningData | null> {
    if (this.planning === undefined) this.planning = await loadPlanning(this.g);
    return this.planning;
  }

  async compute(key: string): Promise<KpiValue> {
    if (!(KPI_CALCULATOR_KEYS as readonly string[]).includes(key)) return { ...restricted('none'), access: 'no_calculator', permissions: [] };
    const k = key as KpiCalculatorKey;
    const perm = KPI_SOURCE_PERMISSION[k];
    const g = this.g;
    const base = g.baseClassification;
    switch (k) {
      case 'deliverables_accepted_vs_due':
      case 'milestone_delay_days': {
        const ws = this.reach(perm);
        const d = ws ? await this.plan() : null;
        if (!ws || !d) return restricted(perm);
        if (k === 'deliverables_accepted_vs_due') return this.ok(kpiDeliverablesAcceptedVsDue(d.deliverables.map((x) => ({ status: x.status, dueDate: x.dueDate, weight: x.weight, weightApproved: x.weightApproved })), g.today), perm, [base], ws);
        return this.ok(
          kpiMilestoneDelayDays(
            d.milestones.map((m) => ({ status: m.status, isCritical: m.isCritical, plannedDate: m.plannedDate, forecastDate: m.forecastDate, actualDate: m.actualDate, baselineDate: d.baselineDates.get(m.id) ?? null })),
            g.calendar,
          ),
          perm,
          [base],
          ws,
        );
      }
      case 'update_freshness': {
        const ws = this.reach(perm);
        if (!ws) return restricted(perm);
        const W = schema.workstream;
        const wsRows = await g.db.tx().select({ id: W.id, code: W.code }).from(W).where(and(eq(W.projectId, g.projectId), g.workstreamId ? eq(W.id, g.workstreamId) : undefined));
        const reachable = wsRows.filter((w) => ws === 'all' || ws.includes(w.id));
        const U = schema.statusUpdate;
        const acc = await g.db.tx().select({ w: U.workstreamId, p: U.periodEnd }).from(U).where(and(eq(U.projectId, g.projectId), eq(U.status, 'accepted'), reachWhere(g, perm, U.workstreamId)));
        const last = new Map<string, string>();
        for (const a of acc) if (a.w && (!last.has(a.w) || last.get(a.w)! < a.p)) last.set(a.w, a.p);
        return this.ok(kpiUpdateFreshness(reachable.map((w) => ({ key: w.code, lastAcceptedPeriodEnd: last.get(w.id) ?? null })), g.today), perm, [base], ws);
      }
      case 'overdue_decisions':
      case 'action_closure_time': {
        if (!g.access.policy.can(g.ctx, perm, { projectId: g.projectId })) return restricted(perm);
        const d = schema.decision;
        const vis = and(eq(d.projectId, g.projectId), g.access.policy.visibilitySql(g.ctx, g.projectId, { classification: d.classification }), g.access.policy.grantSql(g.ctx, perm, g.projectId, {}));
        if (k === 'overdue_decisions') {
          const rows = await g.db.tx().select({ status: d.status, latestSafeDate: d.latestSafeDate, c: d.classification }).from(d).where(vis);
          return this.ok(kpiOverdueDecisions(rows, g.today), perm, rows.map((r) => r.c), 'none');
        }
        const a = schema.actionItem;
        const rows = await g.db
          .tx()
          .select({ status: a.status, createdAt: a.createdAt, verifiedAt: a.verifiedAt, c: d.classification })
          .from(a)
          .leftJoin(d, eq(d.id, a.decisionId))
          .where(and(eq(a.projectId, g.projectId), g.access.policy.grantSql(g.ctx, perm, g.projectId, {}), sql`(${a.decisionId} is null or ${g.access.policy.visibilitySql(g.ctx, g.projectId, { classification: d.classification })})`));
        const tz = g.project.timezone;
        return this.ok(
          kpiActionClosureTime(rows.map((r) => ({ status: r.status, createdOn: localDate(r.createdAt, tz), verifiedOn: r.verifiedAt ? localDate(r.verifiedAt, tz) : null })), g.calendar),
          perm,
          rows.map((r) => r.c).filter((x): x is Classification => !!x),
          'none',
        );
      }
      case 'perimeter_items_transferred':
      case 'perimeter_items_outstanding': {
        const ws = this.reach(perm);
        if (!ws) return restricted(perm);
        const PI = schema.perimeterItem;
        const rows = await g.db
          .tx()
          .select({ disposition: PI.disposition, transferStatus: PI.transferStatus, plan: PI.plannedEffectiveDate, mech: PI.transferMechanism, c: PI.classification })
          .from(PI)
          .where(and(eq(PI.projectId, g.projectId), g.access.policy.visibilitySql(g.ctx, g.projectId, { classification: PI.classification }), reachWhere(g, perm, PI.workstreamId)));
        const input = rows.map((r) => ({ disposition: r.disposition, transferStatus: r.transferStatus, hasPlan: !!r.plan || !!r.mech }));
        return this.ok(k === 'perimeter_items_transferred' ? kpiPerimeterTransferred(input) : kpiPerimeterOutstanding(input), perm, rows.map((r) => r.c), ws);
      }
      case 'contracts_awaiting_consent': {
        // Consents carry no workstream: project-wide carve-out readers only.
        if (!g.access.policy.permissionReach(g.ctx, perm, g.projectId).all || g.workstreamId) return restricted(perm);
        const C = schema.consent;
        const PI = schema.perimeterItem;
        const rows = await g.db
          .tx()
          .select({ status: C.status, interim: PI.interimArrangement, c: C.classification })
          .from(C)
          .leftJoin(PI, eq(PI.id, C.perimeterItemId))
          .where(and(eq(C.projectId, g.projectId), g.access.policy.visibilitySql(g.ctx, g.projectId, { classification: C.classification })));
        return this.ok(kpiContractsAwaitingConsent(rows.map((r) => ({ status: r.status, hasInterimArrangement: !!r.interim && r.interim.trim() !== '' }))), perm, rows.map((r) => r.c), 'all');
      }
      case 'day1_readiness_by_site': {
        const ws = this.reach(perm);
        if (!ws) return restricted(perm);
        const C = schema.readinessCheck;
        const rows = await g.db.tx().select({ siteId: C.siteId, mandatory: C.mandatory, blocker: C.blocker, status: C.status }).from(C).where(and(eq(C.projectId, g.projectId), reachWhere(g, perm, C.workstreamId)));
        return this.ok(kpiDay1Readiness(rows.map((r) => ({ siteKey: r.siteId ?? '-', mandatory: r.mandatory, blocker: r.blocker, status: r.status }))), perm, [base], ws);
      }
      case 'tsas_at_risk': {
        const ws = this.reach(perm);
        if (!ws) return restricted(perm);
        const T = schema.tsaService;
        const rows = await g.db
          .tx()
          .select({ status: T.status, endDate: T.endDate, replacementAccepted: T.replacementAccepted, c: T.classification })
          .from(T)
          .where(and(eq(T.projectId, g.projectId), g.access.policy.visibilitySql(g.ctx, g.projectId, { classification: T.classification }), reachWhere(g, perm, T.workstreamId)));
        return this.ok(kpiTsasAtRisk(rows, g.today), perm, rows.map((r) => r.c as Classification), ws);
      }
      case 'cps_verified': {
        if (!g.access.policy.permissionReach(g.ctx, perm, g.projectId).all) return restricted(perm);
        const rows = await g.db.tx().select({ status: schema.closingCondition.status }).from(schema.closingCondition).where(and(eq(schema.closingCondition.projectId, g.projectId), eq(schema.closingCondition.kind, 'condition_precedent')));
        return this.ok(kpiCpsVerified(rows), perm, [base], 'none');
      }
      case 'separation_cost_vs_budget':
      case 'benefits_realized': {
        const ws = this.reach(perm);
        if (!ws) return restricted(perm);
        const fx = g.access.fx(g.ctx, g.projectId);
        if (k === 'separation_cost_vs_budget') {
          const B = schema.budgetLine;
          const rows = await g.db
            .tx()
            .select({ currency: B.currency, unitScale: B.unitScale, approved: B.approvedAmount, state: B.approvalState, committed: B.committedAmount, spent: B.spentAmount, c: B.classification })
            .from(B)
            .where(and(eq(B.projectId, g.projectId), eq(B.category, 'one_off_separation'), g.access.policy.visibilitySql(fx, g.projectId, { classification: B.classification }), reachWhere(g, perm, B.workstreamId)));
          const groups = new Map<string, { currency: string; unitScale: number; approved: number; committed: number; spent: number }>();
          for (const r of rows) {
            const key = `${r.currency}|${r.unitScale}`;
            const x = groups.get(key) ?? groups.set(key, { currency: r.currency, unitScale: r.unitScale, approved: 0, committed: 0, spent: 0 }).get(key)!;
            if (r.state === 'approved') x.approved += Number(r.approved ?? 0);
            x.committed += Number(r.committed ?? 0);
            x.spent += Number(r.spent ?? 0);
          }
          return this.ok(kpiSeparationCostVsBudget([...groups.values()]), perm, rows.map((r) => r.c as Classification), ws, 'finance');
        }
        const BF = schema.benefit;
        const rows = await g.db
          .tx()
          .select({ status: BF.status, currency: BF.valueCurrency, unitScale: BF.valueUnitScale, planned: BF.valueAmount, realized: BF.realizedAmount, rc: BF.realizedCurrency, rs: BF.realizedUnitScale, c: BF.classification })
          .from(BF)
          .where(and(eq(BF.projectId, g.projectId), g.access.policy.visibilitySql(fx, g.projectId, { classification: BF.classification }), reachWhere(g, perm, BF.workstreamId)));
        const mixedRealized = rows.some((r) => r.status === 'realized_verified' && r.realized !== null && (r.rc !== r.currency || r.rs !== r.unitScale));
        const result = mixedRealized
          ? { state: 'no_data' as const, value: null, numerator: null, denominator: null, notes: ['kpi.mixed_currency_no_single_value'] }
          : kpiBenefitsRealized(rows.map((r) => ({ status: r.status, currency: r.currency, unitScale: r.unitScale, planned: r.planned === null ? null : Number(r.planned), realizedVerified: r.realized === null ? null : Number(r.realized) })));
        return this.ok(result, perm, rows.map((r) => r.c as Classification), ws, 'finance');
      }
      case 'next_gate_mandatory_criteria_met':
      case 'open_blockers': {
        if (!g.access.policy.can(g.ctx, perm, { projectId: g.projectId })) return restricted(perm);
        const gates = await g.db
          .tx()
          .select({ status: schema.gateAssessment.status, assessmentId: schema.gateAssessment.id })
          .from(schema.gateDefinition)
          .innerJoin(schema.gateAssessment, and(eq(schema.gateAssessment.gateId, schema.gateDefinition.id), eq(schema.gateAssessment.isCurrent, true)))
          .where(eq(schema.gateDefinition.projectId, g.projectId))
          .orderBy(asc(schema.gateDefinition.sortOrder));
        const open = gates.filter((x) => !['approved', 'approved_with_exceptions'].includes(x.status));
        const ids = (k === 'next_gate_mandatory_criteria_met' ? open.slice(0, 1) : open).map((x) => x.assessmentId);
        const crit = ids.length
          ? await g.db
              .tx()
              .select({ mandatory: schema.gateCriterion.mandatory, blocking: schema.gateCriterion.blocking, status: schema.criterionAssessment.status })
              .from(schema.criterionAssessment)
              .innerJoin(schema.gateCriterion, eq(schema.gateCriterion.id, schema.criterionAssessment.criterionId))
              .where(and(eq(schema.criterionAssessment.projectId, g.projectId), inArray(schema.criterionAssessment.assessmentId, ids)))
          : [];
        if (k === 'next_gate_mandatory_criteria_met') return this.ok(kpiNextGateCriteriaMet(crit), perm, [base], 'none');
        // Open blockers combine three registers; a part the caller cannot read project-wide is left out (and said so).
        const gateCriteria = crit.filter((c) => c.blocking && !['met', 'waived', 'not_applicable'].includes(c.status)).length;
        const perms = [perm];
        let readinessChecks: number | null = null;
        if (g.access.policy.permissionReach(g.ctx, 'readiness.register.read', g.projectId).all && !g.workstreamId) {
          const C = schema.readinessCheck;
          const rows = await g.db.tx().select({ n: sql<number>`count(*)::int` }).from(C).where(and(eq(C.projectId, g.projectId), eq(C.blocker, true), sql`${C.status} not in ('passed', 'waived', 'not_applicable')`));
          readinessChecks = Number(rows[0]?.n ?? 0);
          perms.push('readiness.register.read');
        }
        let cps: number | null = null;
        if (g.access.policy.permissionReach(g.ctx, 'jv.deal.read', g.projectId).all) {
          const CC = schema.closingCondition;
          const rows = await g.db.tx().select({ n: sql<number>`count(*)::int` }).from(CC).where(and(eq(CC.projectId, g.projectId), eq(CC.blocking, true), sql`${CC.status} not in ('verified', 'waived')`));
          cps = Number(rows[0]?.n ?? 0);
          perms.push('jv.deal.read');
        }
        return this.ok(kpiOpenBlockers({ gateCriteria, readinessChecks, cps }), perm, [base], 'none', null, perms.slice(1));
      }
    }
  }
}

/** Section key of a KPI value in a snapshot: one section per set of permissions the values need. */
function groupKey(v: KpiValue): string {
  return `kpis.${v.permissions[0]?.split('.')[0] ?? 'other'}${v.permissions.length > 1 ? '_combined' : ''}`;
}

/**
 * KPI sections of a snapshot (health & data quality report): one section per source, each needing finance.record.read
 * (the KPI definitions are finance records) plus the source permission(s). Restricted values are left out entirely.
 */
export async function kpiSections(g: Gen): Promise<StoredSection[]> {
  const defs = await visibleKpis(g);
  if (!defs.length) return [];
  const engine = new KpiEngine(g);
  const groups = new Map<string, { v: KpiValue; k: KpiRow }[]>();
  for (const k of defs) {
    const v = await engine.compute(k.key);
    if (v.access !== 'ok') continue;
    const key = groupKey(v);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push({ v, k });
  }
  const out: StoredSection[] = [];
  for (const [key, items] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const first = items[0]!.v;
    const permissions = ['finance.record.read', ...first.permissions];
    const cls = maxClassification([...items.map((i) => i.k.classification as Classification), ...items.flatMap((i) => i.v.sourceClassifications)]);
    const workstreamIds = first.workstreamIds;
    const access: ReportSectionAccess = { key, permissions, classification: cls, domain: first.domain, workstreamIds };
    out.push(
      section(key, access, {
        figures: items.map(({ v, k }) => figure(`kpi.${k.key}`, v.value, k.unit === 'percent' ? 'percent' : k.unit === 'days' ? 'days' : 'count')),
        tables: [
          table(
            'kpis',
            [['key', 'code'], ['name', 'bilingual'], ['unit', 'text'], ['value', 'number'], ['state', 'enum', 'reportKpiStates'], ['numerator', 'number'], ['denominator', 'number'], ['target', 'text'], ['direction', 'enum', 'kpiDirections'], ['frequency', 'text'], ['ownerRole', 'enum', 'roleKeys'], ['lastVerifiedAt', 'text'], ['definitionStatus', 'enum', 'verificationStatuses']],
            items.map(({ v, k }) => ({
              key: k.key,
              name: { en: k.name, ar: k.nameAr },
              unit: k.unit,
              value: v.value,
              state: v.state,
              numerator: v.numerator,
              denominator: v.denominator,
              target: k.target,
              direction: k.direction,
              frequency: k.frequency,
              ownerRole: k.ownerRole,
              lastVerifiedAt: k.lastVerifiedAt ? k.lastVerifiedAt.toISOString() : null,
              definitionStatus: k.verificationStatus,
            })),
          ),
        ],
        notes: [serverMessage('report.kpi_proposals'), ...[...new Set(items.flatMap((i) => i.v.notes))].map((c) => serverMessage(c))],
        unverified: items.filter(({ k }) => k.verificationStatus !== 'confirmed').map(({ k }) => ({ type: 'kpi', id: k.id, label: k.key, status: k.verificationStatus })),
        sourceRefs: items.map(({ k }) => ({ type: 'kpi', id: k.id, label: `${k.key}: ${k.source}` })),
      }),
    );
  }
  return out;
}
