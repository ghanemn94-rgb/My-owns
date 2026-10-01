import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { addCalendarDays, isTsaAtRisk, readinessBySite, serverMessage, sumMoney, TSA_WARNING_WINDOW_DAYS, type Classification } from '@hub/domain';
import type { ReportCellDto } from '@hub/contracts';
import { evidenceLinkVisibleSql } from '../../../platform/helpers';
import { bi, figure, section, table, type StoredSection } from '../report-model';
import { displayNames, iso, reachWhere, type Gen } from './gen-context';

/** Project header and the independent status dimensions (portfolio.project.read — §2.2.1 project-level read). */
export async function overviewSection(g: Gen): Promise<StoredSection | null> {
  if (!g.access.policy.can(g.ctx, 'portfolio.project.read', { projectId: g.projectId, classification: g.project.classification })) return null;
  const dims = await g.db.tx().select().from(schema.statusDimension).where(eq(schema.statusDimension.projectId, g.projectId)).orderBy(asc(schema.statusDimension.key));
  const order = ['incorporation', 'perimeter_transfer', 'operational_readiness', 'jv_transaction'];
  dims.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return section('overview', g.access.flat('overview', ['portfolio.project.read'], [g.project.classification]), {
    tables: [
      table('project', [['code', 'code'], ['name', 'text'], ['status', 'enum', 'projectStatuses'], ['timezone', 'text'], ['plannedStart', 'date']], [
        { code: g.project.code, name: g.project.name, status: g.project.status, timezone: g.project.timezone, plannedStart: g.project.plannedStart },
      ]),
      table(
        'status_dimensions',
        [['dimension', 'enum', 'statusDimensionKeys'], ['state', 'enum', 'dimensionStates'], ['computedAt', 'text']],
        dims.map((d) => ({ dimension: d.key, state: d.state, computedAt: iso(d.computedAt) })),
      ),
    ],
    sourceRefs: [{ type: 'project', id: g.projectId, label: g.project.code }],
  });
}

/** Gates: current cycle per gate, the next gate and its open blocking criteria (gates.gate.read). */
export async function gatesSection(g: Gen): Promise<StoredSection | null> {
  if (!g.access.policy.can(g.ctx, 'gates.gate.read', { projectId: g.projectId, classification: g.project.classification })) return null;
  const tx = g.db.tx();
  const gates = await tx
    .select({ id: schema.gateDefinition.id, key: schema.gateDefinition.key, name: schema.gateDefinition.name, nameAr: schema.gateDefinition.nameAr, sortOrder: schema.gateDefinition.sortOrder, status: schema.gateAssessment.status, assessmentId: schema.gateAssessment.id })
    .from(schema.gateDefinition)
    .leftJoin(schema.gateAssessment, and(eq(schema.gateAssessment.gateId, schema.gateDefinition.id), eq(schema.gateAssessment.isCurrent, true)))
    .where(eq(schema.gateDefinition.projectId, g.projectId))
    .orderBy(asc(schema.gateDefinition.sortOrder));
  const next = gates.find((x) => !['approved', 'approved_with_exceptions'].includes(x.status ?? 'not_started')) ?? null;
  const crit = next?.assessmentId
    ? await tx
        .select({ key: schema.gateCriterion.key, description: schema.gateCriterion.description, descriptionAr: schema.gateCriterion.descriptionAr, mandatory: schema.gateCriterion.mandatory, blocking: schema.gateCriterion.blocking, status: schema.criterionAssessment.status, ownerRole: schema.gateCriterion.ownerRole })
        .from(schema.criterionAssessment)
        .innerJoin(schema.gateCriterion, eq(schema.gateCriterion.id, schema.criterionAssessment.criterionId))
        .where(and(eq(schema.criterionAssessment.projectId, g.projectId), eq(schema.criterionAssessment.assessmentId, next.assessmentId)))
        .orderBy(asc(schema.gateCriterion.sortOrder))
    : [];
  const open = crit.filter((c) => c.mandatory && !['met', 'waived', 'not_applicable'].includes(c.status));
  const blocking = open.filter((c) => c.blocking);
  return section('gates', g.access.flat('gates', ['gates.gate.read'], [g.project.classification]), {
    figures: [
      figure('gates_approved', gates.filter((x) => x.status === 'approved' || x.status === 'approved_with_exceptions').length),
      figure('next_gate_open_mandatory_criteria', next ? open.length : null),
      figure('next_gate_open_blocking_criteria', next ? blocking.length : null),
    ],
    tables: [
      table('gates', [['key', 'code'], ['name', 'bilingual'], ['status', 'enum', 'gateAssessmentStatuses'], ['next', 'boolean']], gates.map((x) => ({ key: x.key, name: bi(x.name, x.nameAr), status: x.status ?? 'not_started', next: x.id === next?.id }))),
      table(
        'next_gate_open_criteria',
        [['key', 'code'], ['description', 'bilingual'], ['blocking', 'boolean'], ['status', 'enum', 'criterionStatuses'], ['ownerRole', 'enum', 'roleKeys']],
        open.map((c) => ({ key: c.key, description: bi(c.description, c.descriptionAr), blocking: c.blocking, status: c.status, ownerRole: c.ownerRole })),
        40,
      ),
    ],
    notes: next ? [serverMessage('report.next_gate', { gate: next.key })] : [serverMessage('report.no_open_gate')],
    sourceRefs: gates.map((x) => ({ type: 'gate_definition', id: x.id, label: x.key })),
  });
}

/** Day-1 readiness by site, open blockers and cutover plans (readiness.register.read, workstream reach). */
export async function readinessSection(g: Gen): Promise<StoredSection | null> {
  const PERM = 'readiness.register.read';
  if (!g.access.canCollect(g.ctx, g.projectId, PERM)) return null;
  const tx = g.db.tx();
  const C = schema.readinessCheck;
  const checks = await tx.select().from(C).where(and(eq(C.projectId, g.projectId), reachWhere(g, PERM, C.workstreamId))).orderBy(asc(C.code));
  const plans = await tx.select().from(schema.cutoverPlan).where(and(eq(schema.cutoverPlan.projectId, g.projectId), reachWhere(g, PERM, schema.cutoverPlan.workstreamId))).orderBy(asc(schema.cutoverPlan.code));
  const sites = new Map((await tx.select({ id: schema.site.id, code: schema.site.code, name: schema.site.name }).from(schema.site).where(eq(schema.site.projectId, g.projectId))).map((s) => [s.id, s]));
  const relevant = checks.filter((c) => c.status !== 'not_applicable' || c.mandatory);
  const bySite = readinessBySite(relevant.map((c) => ({ siteKey: c.siteId ? (sites.get(c.siteId)?.code ?? '?') : '—', mandatory: c.mandatory, blocker: c.blocker, status: c.status })));
  const SIGNED = ['passed', 'waived', 'not_applicable'];
  const blockers = checks.filter((c) => c.blocker && !SIGNED.includes(c.status));
  const owners = await displayNames(g, [...blockers.map((c) => c.ownerUserId), ...plans.map((p) => p.accountableUserId)]);
  return section('readiness', g.access.structured(g.ctx, g.projectId, 'readiness', [PERM], [g.baseClassification], { workstreamId: g.workstreamId }), {
    figures: [
      figure('readiness_checks', checks.length),
      figure('mandatory_signed_off_percent', bySite.length ? round1(pct(bySite.reduce((a, s) => a + s.signedOff, 0), bySite.reduce((a, s) => a + s.mandatory, 0))) : null, 'percent'),
      figure('open_blockers', blockers.length),
      figure('failed_checks', checks.filter((c) => c.status === 'failed').length),
      figure('sites_red', bySite.filter((s) => s.rag === 'red').length),
    ],
    tables: [
      table('readiness_by_site', [['site', 'code'], ['mandatory', 'number'], ['signedOff', 'number'], ['percent', 'percent'], ['openBlockers', 'number'], ['rag', 'enum', 'ragStatuses']], bySite.map((s) => ({ site: s.siteKey, mandatory: s.mandatory, signedOff: s.signedOff, percent: s.percent, openBlockers: s.openBlockers, rag: s.rag }))),
      table(
        'open_blockers',
        [['code', 'code'], ['title', 'bilingual'], ['site', 'code'], ['area', 'enum', 'readinessAreas'], ['status', 'enum', 'readinessStatuses'], ['dueDate', 'date'], ['owner', 'person'], ['contingency', 'text']],
        blockers.map((c) => ({ code: c.code, title: bi(c.title, c.titleAr), site: c.siteId ? (sites.get(c.siteId)?.code ?? null) : null, area: c.area, status: c.status, dueDate: c.dueDate, owner: c.ownerUserId ? (owners.get(c.ownerUserId) ?? null) : null, contingency: c.failureContingency })),
        50,
      ),
      table(
        'cutover_plans',
        [['code', 'code'], ['title', 'text'], ['site', 'code'], ['windowStart', 'text'], ['goNoGo', 'enum', 'goNoGo'], ['status', 'enum', 'cutoverStatuses'], ['rehearsalDone', 'boolean'], ['accountable', 'person']],
        plans.map((p) => ({ code: p.code, title: p.title, site: p.siteId ? (sites.get(p.siteId)?.code ?? null) : null, windowStart: iso(p.windowStart), goNoGo: p.goNoGo, status: p.status, rehearsalDone: p.rehearsalDone, accountable: p.accountableUserId ? (owners.get(p.accountableUserId) ?? null) : null })),
      ),
    ],
    notes: [serverMessage('report.blocker_makes_site_red')],
    sourceRefs: [{ type: 'register', id: null, label: 'readiness checklist register' }, ...plans.map((p) => ({ type: 'cutover_plan', id: p.id, label: p.code }))],
  });
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

/** TSA exit: services, end dates, replacement status; Expired-unresolved listed separately (readiness.register.read). */
export async function tsaSection(g: Gen): Promise<StoredSection | null> {
  const PERM = 'readiness.register.read';
  if (!g.access.canCollect(g.ctx, g.projectId, PERM)) return null;
  const T = schema.tsaService;
  const rows = await g.db
    .tx()
    .select()
    .from(T)
    .where(and(eq(T.projectId, g.projectId), g.access.policy.visibilitySql(g.ctx, g.projectId, { classification: T.classification }), g.access.policy.reachSql(g.ctx, PERM, g.projectId, T.workstreamId), g.workstreamId ? eq(T.workstreamId, g.workstreamId) : undefined))
    .orderBy(asc(T.endDate), asc(T.code));
  const owners = await displayNames(g, rows.map((r) => r.ownerUserId));
  const row = (r: (typeof rows)[number]) => ({
    code: r.code,
    name: r.name,
    status: r.status,
    endDate: r.endDate,
    daysToEnd: r.endDate ? daysBetween(g.today, r.endDate) : null,
    replacementAccepted: r.replacementAccepted,
    replacementDueDate: r.replacementDueDate,
    atRisk: isTsaAtRisk({ status: r.status, endDate: r.endDate, replacementAccepted: r.replacementAccepted }, g.today),
    owner: r.ownerUserId ? (owners.get(r.ownerUserId) ?? null) : null,
  });
  const cols: [string, 'code' | 'text' | 'enum' | 'date' | 'number' | 'boolean' | 'person', string?][] = [
    ['code', 'code'],
    ['name', 'text'],
    ['status', 'enum', 'tsaStatuses'],
    ['endDate', 'date'],
    ['daysToEnd', 'number'],
    ['replacementAccepted', 'boolean'],
    ['replacementDueDate', 'date'],
    ['atRisk', 'boolean'],
    ['owner', 'person'],
  ];
  const expired = rows.filter((r) => r.status === 'expired_unresolved');
  return section('tsa', g.access.structured(g.ctx, g.projectId, 'tsa', [PERM], rows.map((r) => r.classification as Classification), { workstreamId: g.workstreamId }), {
    figures: [
      figure('tsas_total', rows.length),
      figure('tsas_active', rows.filter((r) => ['active', 'extended', 'exit_in_progress'].includes(r.status)).length),
      figure('tsas_at_risk', rows.filter((r) => isTsaAtRisk({ status: r.status, endDate: r.endDate, replacementAccepted: r.replacementAccepted }, g.today)).length),
      figure('tsas_expired_unresolved', expired.length),
      figure('tsas_breached', rows.filter((r) => r.status === 'breached').length),
      figure('tsas_exit_accepted', rows.filter((r) => r.status === 'exit_accepted').length),
    ],
    tables: [table('tsas_expired_unresolved', cols, expired.map(row)), table('tsas', cols, rows.filter((r) => r.status !== 'expired_unresolved').map(row), 80)],
    notes: [serverMessage('report.tsa_warning_window', { days: TSA_WARNING_WINDOW_DAYS, until: addCalendarDays(g.today, TSA_WARNING_WINDOW_DAYS) }), serverMessage('report.expired_unresolved_not_exit')],
    sourceRefs: rows.map((r) => ({ type: 'tsa_service', id: r.id, label: r.code })),
  });
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** JV signing / closing events and their conditions precedent; unverified blocking CPs listed apart (jv.deal.read). */
export async function closingSection(g: Gen): Promise<StoredSection | null> {
  const PERM = 'jv.deal.read';
  // Deal records have no workstream: only a project-wide deal reader collects them (SEC-P34R-02 shape).
  if (!g.access.policy.permissionReach(g.ctx, PERM, g.projectId).all) return null;
  const tx = g.db.tx();
  const events = await tx.select().from(schema.closing).where(eq(schema.closing.projectId, g.projectId)).orderBy(asc(schema.closing.kind), asc(schema.closing.sequence));
  const cps = await tx.select().from(schema.closingCondition).where(eq(schema.closingCondition.projectId, g.projectId)).orderBy(asc(schema.closingCondition.reference), asc(schema.closingCondition.id));
  const owners = await displayNames(g, cps.map((c) => c.ownerUserId));
  const code = new Map(events.map((e) => [e.id, e.code]));
  const precedents = cps.filter((c) => c.kind === 'condition_precedent');
  const unverifiedBlocking = precedents.filter((c) => c.blocking && !['verified', 'waived'].includes(c.status));
  const cpRow = (c: (typeof cps)[number]) => ({
    closing: c.closingId ? (code.get(c.closingId) ?? null) : null,
    reference: c.reference,
    title: c.title,
    kind: c.kind,
    blocking: c.blocking,
    status: c.status,
    longStopDate: c.longStopDate,
    pastLongStop: !!c.longStopDate && c.longStopDate < g.today && !['verified', 'waived'].includes(c.status),
    owner: c.ownerUserId ? (owners.get(c.ownerUserId) ?? null) : null,
  });
  const cols: [string, 'code' | 'text' | 'enum' | 'date' | 'boolean' | 'person', string?][] = [
    ['closing', 'code'],
    ['reference', 'code'],
    ['title', 'text'],
    ['kind', 'enum', 'conditionKinds'],
    ['blocking', 'boolean'],
    ['status', 'enum', 'conditionStatuses'],
    ['longStopDate', 'date'],
    ['pastLongStop', 'boolean'],
    ['owner', 'person'],
  ];
  return section('closing', g.access.flat('closing', [PERM], [g.baseClassification]), {
    figures: [
      figure('signings', events.filter((e) => e.kind === 'signing').length),
      figure('closings', events.filter((e) => e.kind === 'closing').length),
      figure('cps_total', precedents.length),
      figure('cps_verified_or_waived', precedents.filter((c) => c.status === 'verified' || c.status === 'waived').length),
      figure('cps_blocking_unverified', unverifiedBlocking.length),
      figure('cps_past_long_stop', precedents.filter((c) => !!c.longStopDate && c.longStopDate < g.today && !['verified', 'waived'].includes(c.status)).length),
    ],
    tables: [
      table(
        'events',
        [['code', 'code'], ['kind', 'enum', 'closingKinds'], ['name', 'text'], ['targetDate', 'date'], ['status', 'enum', 'closingStatuses'], ['confirmedAt', 'text']],
        events.map((e) => ({ code: e.code, kind: e.kind, name: e.name, targetDate: e.targetDate, status: e.status, confirmedAt: iso(e.confirmedAt) })),
      ),
      table('cps_blocking_unverified', cols, unverifiedBlocking.map(cpRow)),
      table('conditions', cols, cps.map(cpRow), 100),
    ],
    notes: [serverMessage('report.closing_needs_verified_cps')],
    sourceRefs: [...events.map((e) => ({ type: 'closing', id: e.id, label: e.code ?? e.name })), ...cps.map((c) => ({ type: 'closing_condition', id: c.id, label: c.reference ?? c.title ?? '' }))],
  });
}

/**
 * Financials within the reader's finance clearance (finance.record.read, finance-domain clearance, workstream reach):
 * budget per currency / unit scale (never summed across them — AT-29) and benefits by status.
 */
export async function financialsSection(g: Gen): Promise<StoredSection | null> {
  const PERM = 'finance.record.read';
  if (!g.access.canCollect(g.ctx, g.projectId, PERM)) return null;
  const fx = g.access.fx(g.ctx, g.projectId);
  const B = schema.budgetLine;
  const BF = schema.benefit;
  const vis = (cls: typeof B.classification | typeof BF.classification, ws: typeof B.workstreamId | typeof BF.workstreamId) =>
    and(g.access.policy.visibilitySql(fx, g.projectId, { classification: cls }), g.access.policy.reachSql(g.ctx, PERM, g.projectId, ws), g.workstreamId ? eq(ws, g.workstreamId) : undefined);
  const tx = g.db.tx();
  const lines = await tx.select().from(B).where(and(eq(B.projectId, g.projectId), vis(B.classification, B.workstreamId))).orderBy(asc(B.currency), asc(B.unitScale), asc(B.code));
  const benefits = await tx.select().from(BF).where(and(eq(BF.projectId, g.projectId), vis(BF.classification, BF.workstreamId))).orderBy(asc(BF.code));
  const groups = new Map<string, typeof lines>();
  for (const l of lines) (groups.get(`${l.currency}|${l.unitScale}`) ?? groups.set(`${l.currency}|${l.unitScale}`, []).get(`${l.currency}|${l.unitScale}`)!).push(l);
  const money = (amount: string, currency: string, unitScale: number) => ({ amount, currency, unitScale: unitScale as 1 | 1000 | 1000000 });
  const sumOf = (ls: typeof lines, pick: (l: (typeof lines)[number]) => string | null, currency: string, unitScale: number) => {
    const vals = ls.map(pick).filter((x): x is string => x !== null).map((amount) => ({ amount, currency, unitScale: unitScale as 1 | 1000 | 1000000 }));
    if (!vals.length) return null;
    return money(sumMoney(vals).total.amount, currency, unitScale);
  };
  const groupRows: Record<string, ReportCellDto>[] = [...groups.entries()].map(([k, ls]) => {
    const [currency, us] = k.split('|') as [string, string];
    const unitScale = Number(us);
    return {
      currency,
      unitScale,
      lines: ls.length,
      approved: sumOf(ls, (l) => (l.approvalState === 'approved' ? l.approvedAmount : null), currency, unitScale),
      committed: sumOf(ls, (l) => l.committedAmount, currency, unitScale),
      spent: sumOf(ls, (l) => l.spentAmount, currency, unitScale),
      proposedNotApproved: ls.filter((l) => l.approvalState !== 'approved').length,
    };
  });
  const byStatus = new Map<string, number>();
  for (const b of benefits) byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1);
  const cls = [...lines.map((l) => l.classification), ...benefits.map((b) => b.classification)] as Classification[];
  return section('financials', g.access.structured(g.ctx, g.projectId, 'financials', [PERM], cls, { domain: 'finance', workstreamId: g.workstreamId }), {
    figures: [
      figure('budget_lines', lines.length),
      figure('budget_currency_groups', groups.size),
      figure('budget_lines_not_approved', lines.filter((l) => l.approvalState !== 'approved').length),
      figure('benefits', benefits.length),
      figure('benefits_realized_verified', benefits.filter((b) => b.status === 'realized_verified').length),
    ],
    tables: [
      table('budget_by_currency', [['currency', 'code'], ['unitScale', 'number'], ['lines', 'number'], ['approved', 'money'], ['committed', 'money'], ['spent', 'money'], ['proposedNotApproved', 'number']], groupRows),
      table('benefits_by_status', [['status', 'enum', 'benefitStatuses'], ['count', 'number']], [...byStatus.entries()].sort().map(([status, count]) => ({ status, count }))),
    ],
    notes: [serverMessage(groups.size > 1 ? 'report.money_not_summed_across_currencies' : 'report.money_single_group'), serverMessage('report.finance_within_clearance')],
    unverified: lines.filter((l) => l.approvalState !== 'approved').slice(0, 50).map((l) => ({ type: 'budget_line', id: l.id, label: l.code, status: l.approvalState })),
    sourceRefs: [...lines.map((l) => ({ type: 'budget_line', id: l.id, label: l.code })), ...benefits.map((b) => ({ type: 'benefit', id: b.id, label: b.code }))],
  });
}

/**
 * Evidence on committee decisions and gate criteria (documents.document.read + the target's read permission); documents
 * the generator may not open and partner-room / clean-team material are never included.
 */
export async function evidenceSection(g: Gen): Promise<StoredSection | null> {
  const canDocs = g.access.policy.can(g.ctx, 'documents.document.read', { projectId: g.projectId });
  const canDecisions = g.access.policy.can(g.ctx, 'governance.decision.read', { projectId: g.projectId });
  const canGates = g.access.policy.can(g.ctx, 'gates.gate.read', { projectId: g.projectId });
  if (!canDocs || !canDecisions || !canGates) return null;
  const r = await g.db.tx().execute<{ id: string; target_type: string; target_id: string; status: string; purpose: string | null; created_at: Date; title: string | null; doc_cls: Classification | null; decision_code: string | null; decision_cls: Classification | null; criterion_key: string | null }>(sql`
    select e.id, e.target_type, e.target_id, e.status, e.purpose, e.created_at, coalesce(d.title, e.note, e.purpose) as title, d.classification as doc_cls,
           dc.code as decision_code, dc.classification as decision_cls, gc.key as criterion_key
      from evidence_link e
      left join document d on d.id = e.document_id and d.project_id = e.project_id
      left join decision dc on e.target_type = 'decision' and dc.id = e.target_id
      left join gate_criterion gc on e.target_type = 'gate_criterion' and gc.id = e.target_id
     where e.project_id = ${g.projectId}
       and e.target_type in ('decision', 'gate_criterion')
       and e.room_id is null and d.room_id is null
       and ${evidenceLinkVisibleSql(g.access.policy, g.ctx, g.projectId)}
       and (e.target_type <> 'decision' or ${g.access.policy.visibilitySql(g.ctx, g.projectId, { classification: sql.raw('dc.classification') as never })})
     order by e.created_at desc, e.id desc`);
  const rows = r.rows;
  const attention = rows.filter((x) => x.status === 'conflicting' || x.status === 'rejected');
  const label = (x: (typeof rows)[number]) => (x.target_type === 'decision' ? (x.decision_code ?? '') : (x.criterion_key ?? ''));
  const cols: [string, 'code' | 'text' | 'enum' | 'date', string?][] = [
    ['targetType', 'enum', 'reportEvidenceTargets'],
    ['target', 'code'],
    ['document', 'text'],
    ['status', 'enum', 'evidenceLinkStatuses'],
    ['linkedAt', 'text'],
  ];
  const row = (x: (typeof rows)[number]) => ({ targetType: x.target_type, target: label(x), document: x.title, status: x.status, linkedAt: iso(new Date(x.created_at)) });
  return section('evidence', g.access.flat('evidence', ['documents.document.read', 'governance.decision.read', 'gates.gate.read'], [...rows.map((x) => x.doc_cls), ...rows.map((x) => x.decision_cls)]), {
    figures: [
      figure('evidence_active', rows.filter((x) => x.status === 'active').length),
      figure('evidence_conflicting', rows.filter((x) => x.status === 'conflicting').length),
      figure('evidence_rejected', rows.filter((x) => x.status === 'rejected').length),
    ],
    tables: [table('evidence_attention', cols, attention.map(row), 40), table('evidence_recent', cols, rows.filter((x) => x.status === 'active').map(row), 20)],
    unverified: attention.map((x) => ({ type: 'evidence_link', id: x.id, label: label(x), status: x.status })),
    sourceRefs: rows.slice(0, 100).map((x) => ({ type: 'evidence_link', id: x.id, label: label(x) })),
  });
}

