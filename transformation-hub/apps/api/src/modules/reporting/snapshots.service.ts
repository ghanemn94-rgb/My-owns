import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  diffFigures,
  INTERNAL_APPROVAL_LABEL_EN,
  invalid,
  maxClassification,
  notFound,
  REPORT_SCHEMA_VERSION,
  ruleViolation,
  type Classification,
  type ReportKind,
} from '@hub/domain';
import { COMMITTEE_RECORD_REPORT_KINDS, WORKSTREAM_SCOPED_REPORT_KINDS, type GeneratableReportKind, type RouteInput, type reportingRoutes } from '@hub/contracts';
import { DbService } from '../../platform/db.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import { likeContains, loadInProject, pageOf } from '../../platform/helpers';
import { newId, payloadHash } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';
import { ReportAccess } from './report-access';
import { buildView, detailOf, isReportSnapshot, summaryOf, visibleSectionCount, type SnapshotRow } from './report-view';
import type { StoredReportPayload, StoredSection } from './report-model';
import { displayNames, type Gen } from './collect/gen-context';
import { dataQualitySection, delaysSection, loadPlanning, lookAheadSection, milestonesSection, overdueSection, raidSection, statusUpdatesSection } from './collect/planning.collector';
import { actionsSection, canCollectGovernance, decisionsNeededSection, decisionsSection, escalationsSection, meetingSections } from './collect/governance.collector';
import { closingSection, evidenceSection, financialsSection, gatesSection, overviewSection, readinessSection, tsaSection } from './collect/registers.collector';
import { kpiSections } from './collect/kpi.collector';

type R = typeof reportingRoutes;

const KIND_LABEL_EN: Record<GeneratableReportKind, string> = {
  executive_summary: 'Executive summary',
  committee_pack: 'Committee pack',
  workstream_weekly: 'Weekly workstream report',
  look_ahead: 'Look-ahead (2 / 4 / 8 weeks)',
  day1_readiness: 'Day-1 readiness report',
  tsa_exit: 'TSA exit report',
  jv_closing: 'JV signing / closing / CP report',
  health_data_quality: 'Project health & data quality',
  minutes: 'Minutes',
};

/**
 * Report snapshots (spec §11, REQ-RPT-001..006, -015..017). Generation reads the live registers AS THE CALLER (request
 * transaction under the caller's RLS scope, visibility and reach inside every query) at one as-of instant, freezes the
 * result with its metadata and content hash, and never changes it afterwards (append-only table). Reads re-check access
 * per section on every call.
 */
@Injectable()
export class SnapshotsService {
  constructor(
    private readonly db: DbService,
    private readonly access: ReportAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
  ) {}

  private async project(projectId: string) {
    const [p] = await this.db.tx().select().from(schema.project).where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    return p;
  }

  async gen(ctx: RequestContext, projectId: string, workstreamId: string | null): Promise<Gen> {
    const project = await this.project(projectId);
    const holidays = await this.db.tx().select({ date: schema.calendarHoliday.date }).from(schema.calendarHoliday).where(eq(schema.calendarHoliday.projectId, projectId));
    return {
      db: this.db,
      access: this.access,
      ctx,
      projectId,
      project,
      today: this.clock.today(project.timezone),
      calendar: { timezone: project.timezone, workingDays: project.workingDays, holidays: holidays.map((h) => h.date).sort() },
      workstreamId,
      baseClassification: project.classification,
    };
  }

  private async collect(g: Gen, kind: GeneratableReportKind, meetingId: string | null): Promise<StoredSection[]> {
    const out: (StoredSection | null)[] = [];
    const planning = ['executive_summary', 'committee_pack', 'workstream_weekly', 'look_ahead', 'health_data_quality'].includes(kind) ? await loadPlanning(g) : null;
    const gov = canCollectGovernance(g);
    switch (kind) {
      case 'executive_summary':
        out.push(await overviewSection(g), await gatesSection(g), planning ? delaysSection(g, planning) : null, gov ? await decisionsNeededSection(g) : null, gov ? await escalationsSection(g) : null);
        break;
      case 'committee_pack':
        out.push(
          await overviewSection(g),
          await gatesSection(g),
          planning ? delaysSection(g, planning) : null,
          planning ? milestonesSection(g, planning) : null,
          await readinessSection(g),
          planning ? await raidSection(g, planning) : null,
          await financialsSection(g),
          gov ? await decisionsSection(g) : null,
          gov ? await actionsSection(g) : null,
          await evidenceSection(g),
        );
        break;
      case 'workstream_weekly':
        out.push(
          planning ? await statusUpdatesSection(g, planning) : null,
          planning ? lookAheadSection(g, planning) : null,
          planning ? overdueSection(g, planning) : null,
          planning ? await raidSection(g, planning) : null,
          gov ? await escalationsSection(g) : null,
        );
        break;
      case 'look_ahead':
        out.push(planning ? lookAheadSection(g, planning) : null, planning ? overdueSection(g, planning) : null);
        break;
      case 'day1_readiness':
        out.push(await readinessSection(g), await gatesSection(g));
        break;
      case 'tsa_exit':
        out.push(await tsaSection(g));
        break;
      case 'jv_closing':
        out.push(await closingSection(g), await gatesSection(g));
        break;
      case 'health_data_quality':
        out.push(await overviewSection(g), planning ? await dataQualitySection(g, planning) : null, ...(await kpiSections(g)));
        break;
      case 'minutes':
        if (!meetingId) throw invalid('report.meeting_required', 'Minutes need the meeting');
        out.push(...(await meetingSections(g, meetingId)));
        break;
    }
    return out.filter((s): s is StoredSection => !!s);
  }

  /** The previous snapshot of the same kind and scope (generated earlier in the same project). */
  private async previous(projectId: string, kind: ReportKind, scope: { workstreamId: string | null; meetingId: string | null }, before: Date): Promise<SnapshotRow | null> {
    const S = schema.reportSnapshot;
    const [row] = await this.db
      .tx()
      .select()
      .from(S)
      .where(
        and(
          eq(S.projectId, projectId),
          eq(S.kind, kind),
          isNotNull(S.schemaVersion),
          lt(S.generatedAt, before),
          sql`coalesce(${S.scope}->>'workstreamId', '') = ${scope.workstreamId ?? ''}`,
          sql`coalesce(${S.scope}->>'meetingId', '') = ${scope.meetingId ?? ''}`,
        ),
      )
      .orderBy(desc(S.generatedAt), desc(S.id))
      .limit(1);
    return row ?? null;
  }

  async generate(ctx: RequestContext, projectId: string, body: RouteInput<R['generateReport']>['body']) {
    this.access.assertProjectReader(ctx, projectId, 'reports.report.generate');
    const project = await this.project(projectId);
    this.access.policy.assert(ctx, 'reports.report.generate', { projectId, classification: 'internal' });
    if (COMMITTEE_RECORD_REPORT_KINDS.includes(body.kind)) this.access.policy.assert(ctx, 'reports.snapshot.create', { projectId, classification: 'internal' });
    if (body.workstreamId && !WORKSTREAM_SCOPED_REPORT_KINDS.includes(body.kind)) throw invalid('report.workstream_not_applicable', 'This report kind is not limited to a workstream');
    if (body.meetingId && body.kind !== 'minutes') throw invalid('report.meeting_not_applicable', 'Only minutes refer to a meeting');
    if (body.kind === 'minutes' && !body.meetingId) throw invalid('report.meeting_required', 'Minutes need the meeting');
    let ws: typeof schema.workstream.$inferSelect | null = null;
    if (body.workstreamId) {
      ws = await loadInProject(this.db, schema.workstream, projectId, body.workstreamId);
      const reach = this.access.policy.permissionReach(ctx, 'planning.plan.read', projectId);
      if (!reach.all && !reach.workstreamIds.includes(ws.id)) throw notFound();
    }
    const g = await this.gen(ctx, projectId, ws?.id ?? null);
    const asOf = this.clock.now();
    const sections = await this.collect(g, body.kind, body.meetingId ?? null);
    if (!sections.length) throw ruleViolation('report.nothing_to_report', 'You cannot read any of the records this report is made of');

    const scope = { workstreamId: ws?.id ?? null, workstreamCode: ws?.code ?? null, workstreamName: ws?.name ?? null, workstreamNameAr: ws?.nameAr ?? null, meetingId: body.meetingId ?? null };
    // Changes since the previous snapshot of the same kind and scope — only for sections the generator may read in it.
    const prev = await this.previous(projectId, body.kind, scope, asOf);
    if (prev && isReportSnapshot(prev)) {
      const prevSections = new Map((prev.payload as unknown as StoredReportPayload).sections.map((s) => [s.key, s]));
      for (const s of sections) {
        const p = prevSections.get(s.key);
        if (!p || !this.access.canSee(ctx, projectId, p.access)) continue;
        const changes = new Map(diffFigures(p.figures.map((f) => ({ section: s.key, key: f.key, value: f.value })), s.figures.map((f) => ({ section: s.key, key: f.key, value: f.value }))).map((c) => [c.key, c]));
        const before = new Map(p.figures.map((f) => [f.key, f.value]));
        s.figures = s.figures.map((f) => (before.has(f.key) ? { ...f, compared: true, previous: changes.has(f.key) ? changes.get(f.key)!.before : (before.get(f.key) ?? null) } : f));
      }
    }
    const [b] = await this.db.tx().select().from(schema.baselineVersion).where(and(eq(schema.baselineVersion.projectId, projectId), eq(schema.baselineVersion.status, 'approved'))).limit(1);
    const generatedByName = ctx.principal.userId ? ((await displayNames(g, [ctx.principal.userId])).get(ctx.principal.userId) ?? null) : null;
    const payload: StoredReportPayload = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      kind: body.kind,
      project: { id: project.id, code: project.code, name: project.name, timezone: project.timezone, isDemo: project.isDemo },
      asOf: asOf.toISOString(),
      asOfLocalDate: g.today,
      scope,
      baseline: b ? { id: b.id, versionNo: b.versionNo, approvedAt: b.approvedAt ? b.approvedAt.toISOString() : null } : null,
      generatedBy: { id: ctx.principal.userId, name: generatedByName },
      sections,
    };
    const contentHash = payloadHash(payload);
    const classification: Classification = maxClassification(sections.map((s) => s.access.classification));
    const titleParts = [KIND_LABEL_EN[body.kind], project.code, ws?.code, g.today].filter(Boolean);
    const id = newId();
    await this.db
      .tx()
      .insert(schema.reportSnapshot)
      .values({
        id,
        orgId: project.orgId,
        projectId,
        kind: body.kind,
        title: titleParts.join(' — '),
        locale: ctx.locale,
        asOf,
        asOfLocalDate: g.today,
        scope,
        baselineVersionId: b?.id ?? null,
        baselineVersionNo: b?.versionNo ?? null,
        classification,
        payload: payload as unknown as Record<string, unknown>,
        unverifiedData: sections.flatMap((s) => s.unverified.map((u) => `${s.key}:${u.type}:${u.label}:${u.status}`)).slice(0, 1000),
        sourceRefs: sections.flatMap((s) => s.sourceRefs.map((r) => ({ type: r.type, id: r.id ?? '', label: r.label }))).slice(0, 1000),
        contentHash,
        previousSnapshotId: prev?.id ?? null,
        includesDemoData: project.isDemo,
        schemaVersion: REPORT_SCHEMA_VERSION,
        sections: sections.map((s) => s.access),
        generatedBy: ctx.principal.userId,
      });
    await this.audit.record({
      action: 'reports.report.generate',
      entityType: 'report_snapshot',
      entityId: id,
      projectId,
      after: { kind: body.kind, contentHash, classification, sections: sections.map((s) => s.key), workstreamId: scope.workstreamId, meetingId: scope.meetingId, previousSnapshotId: prev?.id ?? null },
    });
    await this.outbox.emit({ type: 'report.generated', projectId, aggregateType: 'report_snapshot', aggregateId: id, payload: { snapshotId: id, kind: body.kind } });
    const [row] = await this.db.tx().select().from(schema.reportSnapshot).where(eq(schema.reportSnapshot.id, id));
    return summaryOf(row!, { included: sections.length, total: sections.length, classification }, generatedByName);
  }

  /** Load a report snapshot and the caller's view of it; 404 when the caller may see nothing of it. */
  async view(ctx: RequestContext, projectId: string, snapshotId: string, permission: 'reports.snapshot.read' | 'reports.snapshot.export') {
    this.access.assertProjectReader(ctx, projectId, permission);
    const row = await loadInProject(this.db, schema.reportSnapshot, projectId, snapshotId);
    const v = buildView(this.access, ctx, row);
    if (!v) throw notFound();
    // RBAC + room / clean-team conditions of the route permission; classification was checked per section above (with
    // the finance-domain clearance where it applies), so the snapshot-level check uses the floor.
    this.access.policy.assert(ctx, permission, { projectId, classification: 'internal' });
    return v;
  }

  async list(ctx: RequestContext, projectId: string, q: RouteInput<R['listReportSnapshots']>['query']) {
    this.access.assertProjectReader(ctx, projectId, 'reports.snapshot.read');
    const S = schema.reportSnapshot;
    // Section metadata only (no payloads); each row is re-checked for THIS caller, and totals count only what remains.
    const rows = await this.db
      .tx()
      .select()
      .from(S)
      .where(and(eq(S.projectId, projectId), isNotNull(S.schemaVersion), q.kind ? eq(S.kind, q.kind) : undefined, q.q ? ilike(S.title, likeContains(q.q)) : undefined));
    const visible = rows.map((r) => ({ r, c: visibleSectionCount(this.access, ctx, r) })).filter((x) => x.c.included > 0);
    const sort = q.sort ?? '-generatedAt';
    const dir = sort.startsWith('-') ? -1 : 1;
    const key = sort.replace(/^-/, '') as 'generatedAt' | 'kind' | 'asOfLocalDate';
    const val = (x: (typeof visible)[number]) => (key === 'generatedAt' ? x.r.generatedAt.toISOString() : key === 'kind' ? x.r.kind : x.r.asOfLocalDate);
    visible.sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : a.r.id < b.r.id ? -dir : dir));
    const page = visible.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const names = await this.names(page.map((x) => x.r.generatedBy));
    return pageOf(
      page.map((x) => summaryOf(x.r, x.c, x.r.generatedBy ? (names.get(x.r.generatedBy) ?? null) : null)),
      visible.length,
      q,
    );
  }

  private async names(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map<string, string>();
    const rows = await this.db.tx().select({ id: schema.appUser.id, name: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, list));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async get(ctx: RequestContext, projectId: string, snapshotId: string) {
    const v = await this.view(ctx, projectId, snapshotId, 'reports.snapshot.read');
    const name = v.row.generatedBy ? ((await this.names([v.row.generatedBy])).get(v.row.generatedBy) ?? null) : null;
    const canExport = this.access.policy.can(ctx, 'reports.snapshot.export', { projectId, classification: 'internal' });
    return detailOf(v, name, INTERNAL_APPROVAL_LABEL_EN, canExport);
  }

  /** Figures that changed between two snapshots; only sections the caller may read in BOTH are compared. */
  async diff(ctx: RequestContext, projectId: string, snapshotId: string, against?: string) {
    const v = await this.view(ctx, projectId, snapshotId, 'reports.snapshot.read');
    const otherId = against ?? v.row.previousSnapshotId;
    if (!otherId) return { snapshotId, againstSnapshotId: null, comparedSections: [], changes: [] };
    const o = await this.view(ctx, projectId, otherId, 'reports.snapshot.read');
    if (o.row.kind !== v.row.kind) throw invalid('report.diff_kind_mismatch', 'Only snapshots of the same report kind can be compared');
    const other = new Map(o.included.map((s) => [s.key, s]));
    const compared = v.included.filter((s) => other.has(s.key));
    const changes = compared.flatMap((s) =>
      diffFigures(
        other.get(s.key)!.figures.map((f) => ({ section: s.key, key: f.key, value: f.value })),
        s.figures.map((f) => ({ section: s.key, key: f.key, value: f.value })),
      ),
    );
    return { snapshotId, againstSnapshotId: otherId, comparedSections: compared.map((s) => s.key), changes };
  }
}
