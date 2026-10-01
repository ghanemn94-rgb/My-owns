import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, sql, SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { schema } from '@hub/db';
import {
  addCalendarDays,
  CLASSIFICATIONS,
  clearanceAllows,
  delayImpact,
  EVIDENCE_TARGET_READ_PERMISSION,
  detectInstructionLikeContent,
  extractSearchTerms,
  notFound,
  workingDaySlip,
  type Classification,
  type DelayImpact,
  type ScheduleEdge,
  type ScheduleNode,
  type WorkingCalendar,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import type { RequestContext } from '../../platform/context';
import { evidenceLinkVisibleSql } from '../../platform/helpers';
import { RecordVisibility } from '../../platform/record-visibility';
import { AiConfig } from './ai-config';

/**
 * Read-only knowledge access for the AI PM. EVERY method runs as the delegating human principal inside the current
 * transaction (RLS context set) and:
 *   1. checks the permission (RBAC) of the corresponding tool — a missing permission returns `null` (callers report
 *      "not available in sources you are authorized to see" without revealing whether data exists);
 *   2. applies the OWNING MODULE's read rule INSIDE the SQL WHERE clause — never fetch-then-filter (ADR-0008, C-23;
 *      access-matrix §2.5 "AI retrieval … inside SQL with the same predicates"): classification, rooms and room-only
 *      principals (`policy.visibilitySql`), AND the coverage of the read permission's grant (SEC-P34-02 / SEC-P34-03):
 *      the workstream reach for workstream-structured records, a project-wide grant for project-level registers, the
 *      finance-domain clearance for finance records — through `RecordVisibility` (the rules the activity feed and the
 *      evidence targets use, which mirror each module's list) or `policy.grantSql` for registers without a record rule.
 * Other modules' tables are only read, never written.
 */
@Injectable()
export class AiKnowledgeService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly cfg: AiConfig,
  ) {}

  private can(ctx: RequestContext, permission: string, projectId: string) {
    return this.policy.canInProject(ctx, permission, projectId);
  }

  /**
   * The owning module's record rule for `type` (SEC-P34-02 / SEC-P34-03): own or inherited classification (finance records:
   * finance-domain clearance), room, and the reach of the type's read permission — e.g. a TSA needs its classification and
   * the readiness reach of its workstream (`TsaService.scopeSql`); an approved figure the finance-domain clearance and the
   * finance reach (`FinanceSupport.visibleSql`); a valuation a project-wide finance grant.
   */
  private readable(ctx: RequestContext, projectId: string, type: string, id: PgColumn | SQL): SQL {
    const rec = new RecordVisibility(this.policy, ctx, projectId, { reach: true, readPermission: (t) => (EVIDENCE_TARGET_READ_PERMISSION as Record<string, string>)[t] }).exists(type, id);
    return and(this.projectSql(ctx, projectId), rec)!;
  }

  /**
   * QA-P5-03: record visibility inside the project AND the project itself visible to the reader — the same predicates the
   * owning modules apply (`policy.visibilitySql` + the project's classification against the reader's clearance, as
   * `PlanningSupport.readScope` / the portfolio list do).
   */
  private vis(ctx: RequestContext, projectId: string, cols: Parameters<PolicyService['visibilitySql']>[2]): SQL {
    return and(this.policy.visibilitySql(ctx, projectId, cols), this.projectSql(ctx, projectId))!;
  }

  /**
   * QA-P5-03 (SQL form): the reader may see the PROJECT — its classification within the reader's clearance (a service
   * principal: always). A member cleared below the project's classification is refused the project, the plan and every
   * record by the owning modules (404); the AI channel applies the same rule to every retrieval, citation and proposal.
   */
  projectSql(ctx: RequestContext, projectId: string): SQL {
    if (ctx.principal.kind === 'service') return sql`true`;
    const allowed = CLASSIFICATIONS.filter((c) => clearanceAllows(ctx.principal.clearance, c));
    return sql`exists (select 1 from project hub_pj where hub_pj.id = ${projectId} and hub_pj.classification in (${sql.join(allowed.map((c) => sql`${c}`), sql`, `)}))`;
  }

  /** The project's classification (null when the project does not exist in the caller's RLS scope). */
  async projectClassification(projectId: string): Promise<Classification | null> {
    const [p] = await this.db.tx().select({ classification: schema.project.classification }).from(schema.project).where(eq(schema.project.id, projectId));
    return (p?.classification as Classification | undefined) ?? null;
  }

  /**
   * QA-P5-03: the reader may see the project — `policy.canSee` with the project's classification (full scope, clearance),
   * exactly as the planning and portfolio modules. Every AI route, worker path and recipient check calls it.
   */
  async projectVisible(ctx: RequestContext, projectId: string): Promise<boolean> {
    const classification = await this.projectClassification(projectId);
    return !!classification && this.policy.canSee(ctx, { projectId, classification });
  }

  /**
   * QA-P5-03 route gate: 404 (like an unknown id) when the caller may not see the project — called first by every AI route
   * method, as the owning modules check the project before the record.
   */
  async assertProjectVisible(ctx: RequestContext, projectId: string): Promise<void> {
    if (!(await this.projectVisible(ctx, projectId))) throw notFound();
  }

  /** A project-level register without a workstream: only a project-wide grant of its read permission covers it (§2.2). */
  private projectWide(ctx: RequestContext, permission: string, projectId: string): SQL {
    return this.policy.grantSql(ctx, permission, projectId, {});
  }

  async project(projectId: string) {
    const [p] = await this.db
      .tx()
      .select({ id: schema.project.id, isDemo: schema.project.isDemo, timezone: schema.project.timezone, workingDays: schema.project.workingDays, plannedStart: schema.project.plannedStart, code: schema.project.code })
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    return p ?? null;
  }

  async calendar(projectId: string): Promise<WorkingCalendar> {
    const p = await this.project(projectId);
    const hol = await this.db
      .tx()
      .select({ date: schema.calendarHoliday.date })
      .from(schema.calendarHoliday)
      .where(and(eq(schema.calendarHoliday.projectId, projectId), eq(schema.calendarHoliday.isProposed, false)));
    return { timezone: p?.timezone ?? 'Asia/Riyadh', workingDays: p?.workingDays ?? [0, 1, 2, 3, 4], holidays: hol.map((h) => h.date) };
  }

  // ---------------------------------------------------------------------------------------------------------
  /**
   * Full-text retrieval over document chunks: ONE SQL statement. ACL (chunk AND live document classification/room,
   * soft-delete, current version, scan status) sits in WHERE before `ts_rank` ordering and LIMIT (AIT-10, AIT-15).
   */
  async searchDocuments(ctx: RequestContext, projectId: string, query: string, limit = 8) {
    if (!this.can(ctx, 'documents.document.read', projectId)) return null;
    const terms = extractSearchTerms(query);
    if (!terms.length) return [];
    const tsq = sql.join(
      terms.map((t) => sql`plainto_tsquery('simple', ${t})`),
      sql` || `,
    );
    const visChunk = this.vis(ctx, projectId, { classification: schema.documentChunk.classification, room: schema.documentChunk.roomId });
    const visDoc = this.vis(ctx, projectId, { classification: schema.document.classification, room: schema.document.roomId });
    // The documents list's grant coverage (documents.service list): a workstream-scoped reader reaches room-less documents only.
    const grantDoc = this.policy.grantSql(ctx, 'documents.document.read', projectId, { room: schema.document.roomId });
    const r = await this.db.tx().execute<{
      id: string;
      document_id: string;
      document_version_id: string;
      version_no: number;
      page: number | null;
      section: string | null;
      text: string;
      classification: Classification;
      room_id: string | null;
      suspicious_instructions: boolean;
      title: string;
      kind: string;
      is_demo: boolean;
      uploaded_at: Date;
      rank: number;
    }>(sql`
      select document_chunk.id, document_chunk.document_id, document_chunk.document_version_id, document_version.version_no,
             document_chunk.page, document_chunk.section, document_chunk.text, document_chunk.classification, document_chunk.room_id,
             document_chunk.suspicious_instructions, document.title, document.kind, document.is_demo, document_version.created_at as uploaded_at,
             ts_rank(document_chunk.tsv, hub_q.query) as rank
        from document_chunk
        join document on document.id = document_chunk.document_id and document.project_id = document_chunk.project_id
        join document_version on document_version.id = document_chunk.document_version_id and document_version.project_id = document_chunk.project_id
        cross join (select (${tsq}) as query) as hub_q
       where document_chunk.project_id = ${projectId}
         and document.project_id = ${projectId}
         and document.deleted_at is null
         and document.current_version_id = document_chunk.document_version_id
         and document_version.scan_status in ('clean', 'not_scanned')
         and ${visChunk}
         and ${visDoc}
         and ${grantDoc}
         and document_chunk.tsv @@ hub_q.query
       order by rank desc, document_chunk.id
       limit ${limit}`);
    return r.rows.map((c) => ({
      ...c,
      // Re-check at read time as well: indexing may predate the detector or the chunk flag may be missing.
      suspicious: c.suspicious_instructions || detectInstructionLikeContent(c.text).suspicious,
    }));
  }

  /** Conflicting evidence recorded against documents that were cited (documents module owns the rows). */
  async conflictingEvidence(ctx: RequestContext, projectId: string, documentIds: string[]) {
    if (!documentIds.length || !this.can(ctx, 'documents.document.read', projectId)) return [];
    return this.db
      .tx()
      .select({ documentId: schema.evidenceLink.documentId, targetType: schema.evidenceLink.targetType, targetId: schema.evidenceLink.targetId, conflictWith: schema.evidenceLink.conflictWithLinkId })
      .from(schema.evidenceLink)
      .where(and(eq(schema.evidenceLink.projectId, projectId), eq(schema.evidenceLink.status, 'conflicting'), inArray(schema.evidenceLink.documentId, documentIds), this.readable(ctx, projectId, 'evidence_link', schema.evidenceLink.id)));
  }

  // ---------------------------------------------------------------------------------------------------------
  async overdueWork(ctx: RequestContext, projectId: string, today: string) {
    if (!this.can(ctx, 'planning.plan.read', projectId)) return null;
    const tx = this.db.tx();
    const vis = this.vis(ctx, projectId, {});
    const reachT = this.policy.reachSql(ctx, 'planning.plan.read', projectId, schema.task.workstreamId);
    const reachM = this.policy.reachSql(ctx, 'planning.plan.read', projectId, schema.milestone.workstreamId);
    const due = sql<string>`coalesce(${schema.task.forecastFinish}, ${schema.task.plannedFinish})`;
    const tasks = await tx
      .select({
        id: schema.task.id,
        code: schema.task.wbsCode,
        title: schema.task.title,
        titleAr: schema.task.titleAr,
        status: schema.task.status,
        ownerUserId: schema.task.accountableUserId,
        due,
        plannedStart: schema.task.plannedStart,
        gateKey: schema.task.gateKey,
        version: schema.task.version,
        updatedAt: schema.task.updatedAt,
        isDemo: schema.task.isDemo,
        verificationStatus: schema.task.verificationStatus,
      })
      .from(schema.task)
      .where(and(eq(schema.task.projectId, projectId), vis, reachT, inArray(schema.task.status, ['not_started', 'in_progress', 'blocked', 'submitted_for_acceptance']), lt(due, today)))
      .orderBy(asc(due))
      .limit(50);
    const mdue = sql<string>`coalesce(${schema.milestone.forecastDate}, ${schema.milestone.plannedDate})`;
    const milestones = await tx
      .select({
        id: schema.milestone.id,
        code: schema.milestone.code,
        title: schema.milestone.title,
        titleAr: schema.milestone.titleAr,
        status: schema.milestone.status,
        ownerUserId: schema.milestone.ownerUserId,
        due: mdue,
        gateKey: schema.milestone.gateKey,
        version: schema.milestone.version,
        updatedAt: schema.milestone.updatedAt,
        isDemo: schema.milestone.isDemo,
        verificationStatus: schema.milestone.verificationStatus,
      })
      .from(schema.milestone)
      .where(and(eq(schema.milestone.projectId, projectId), vis, reachM, inArray(schema.milestone.status, ['planned', 'at_risk']), lt(mdue, today)))
      .orderBy(asc(mdue))
      .limit(50);
    const pendingEvidence = await tx
      .select({ id: schema.milestone.id, code: schema.milestone.code, title: schema.milestone.title, titleAr: schema.milestone.titleAr, gateKey: schema.milestone.gateKey, version: schema.milestone.version, ownerUserId: schema.milestone.ownerUserId, updatedAt: schema.milestone.updatedAt })
      .from(schema.milestone)
      .where(and(eq(schema.milestone.projectId, projectId), vis, reachM, eq(schema.milestone.status, 'achieved_pending_evidence')))
      .limit(50);
    return { tasks, milestones, pendingEvidence };
  }

  async missingOwners(ctx: RequestContext, projectId: string) {
    if (!this.can(ctx, 'planning.plan.read', projectId)) return null;
    const tx = this.db.tx();
    const vis = this.vis(ctx, projectId, {});
    const reachT = this.policy.reachSql(ctx, 'planning.plan.read', projectId, schema.task.workstreamId);
    const reachM = this.policy.reachSql(ctx, 'planning.plan.read', projectId, schema.milestone.workstreamId);
    const where = and(eq(schema.task.projectId, projectId), vis, reachT, isNull(schema.task.accountableUserId), inArray(schema.task.status, ['draft', 'not_started', 'in_progress', 'blocked']));
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(schema.task).where(where)) as [{ n: number }];
    const tasks = await tx
      .select({ id: schema.task.id, code: schema.task.wbsCode, title: schema.task.title, titleAr: schema.task.titleAr, status: schema.task.status, gateKey: schema.task.gateKey, version: schema.task.version, updatedAt: schema.task.updatedAt })
      .from(schema.task)
      .where(where)
      .orderBy(asc(schema.task.sortOrder))
      .limit(20);
    const milestones = await tx
      .select({ id: schema.milestone.id, code: schema.milestone.code, title: schema.milestone.title, titleAr: schema.milestone.titleAr, status: schema.milestone.status, gateKey: schema.milestone.gateKey, version: schema.milestone.version, updatedAt: schema.milestone.updatedAt })
      .from(schema.milestone)
      .where(and(eq(schema.milestone.projectId, projectId), vis, reachM, isNull(schema.milestone.ownerUserId), inArray(schema.milestone.status, ['planned', 'at_risk'])))
      .limit(20);
    return { taskTotal: n, tasks, milestones };
  }

  async staleUpdates(ctx: RequestContext, projectId: string, today: string) {
    if (!this.can(ctx, 'planning.plan.read', projectId)) return null;
    const cutoff = addCalendarDays(today, -this.cfg.staleUpdateDays);
    const vis = this.vis(ctx, projectId, {});
    const reach = this.policy.reachSql(ctx, 'planning.plan.read', projectId, schema.workstream.id);
    const r = await this.db.tx().execute<{ id: string; code: string; name: string; name_ar: string | null; version: number; last_period: string | null; updated_at: Date }>(sql`
      select workstream.id, workstream.code, workstream.name, workstream.name_ar, workstream.version, workstream.updated_at,
             (select max(status_update.period_end) from status_update
               where status_update.project_id = workstream.project_id and status_update.workstream_id = workstream.id
                 and status_update.status in ('submitted', 'accepted'))::text as last_period
        from workstream
       where workstream.project_id = ${projectId} and ${vis} and ${reach}
       order by workstream.sort_order`);
    return r.rows.filter((w) => !w.last_period || w.last_period < cutoff).map((w) => ({ ...w, cutoff }));
  }

  // ---------------------------------------------------------------------------------------------------------
  async decisionsAwaiting(ctx: RequestContext, projectId: string, today: string) {
    if (!this.can(ctx, 'governance.decision.read', projectId)) return null;
    const tx = this.db.tx();
    const vis = this.vis(ctx, projectId, { classification: schema.decision.classification });
    // Governance registers are project-level: the lists require a project-wide grant (decisions.service / actions.service).
    const grant = this.projectWide(ctx, 'governance.decision.read', projectId);
    const decisions = await tx
      .select({ id: schema.decision.id, code: schema.decision.code, title: schema.decision.title, status: schema.decision.status, latestSafeDate: schema.decision.latestSafeDate, gateKey: schema.decision.gateKey, version: schema.decision.version, updatedAt: schema.decision.updatedAt, classification: schema.decision.classification, isDemo: schema.decision.isDemo })
      .from(schema.decision)
      .where(and(eq(schema.decision.projectId, projectId), vis, grant, inArray(schema.decision.status, ['submitted', 'under_review', 'recommended', 'implementation_pending'])))
      .orderBy(asc(schema.decision.updatedAt))
      .limit(30);
    const visProject = this.vis(ctx, projectId, {});
    // SEC-P5-03: an action inherits the classification of its decision, of that decision's committee and of its meeting's
    // committee for the provider ceiling (read here; combined — fail closed — by the detection, `derivedClassification`).
    const A = schema.actionItem;
    const actions = await tx
      .select({
        id: A.id,
        code: A.code,
        title: A.title,
        status: A.status,
        ownerUserId: A.ownerUserId,
        dueDate: A.dueDate,
        version: A.version,
        updatedAt: A.updatedAt,
        decisionId: A.decisionId,
        meetingId: A.meetingId,
        // Column references are qualified by hand: inside a select field drizzle renders them unqualified.
        decisionClassification: sql<string | null>`(select hub_ad.classification::text from decision hub_ad where hub_ad.id = action_item.decision_id and hub_ad.project_id = action_item.project_id)`,
        decisionCommitteeClassification: sql<string | null>`(select hub_adc.classification::text from decision hub_ad join committee hub_adc on hub_adc.id = hub_ad.committee_id and hub_adc.project_id = hub_ad.project_id where hub_ad.id = action_item.decision_id and hub_ad.project_id = action_item.project_id)`,
        meetingCommitteeClassification: sql<string | null>`(select hub_amc.classification::text from meeting hub_am join committee hub_amc on hub_amc.id = hub_am.committee_id and hub_amc.project_id = hub_am.project_id where hub_am.id = action_item.meeting_id and hub_am.project_id = action_item.project_id)`,
      })
      .from(schema.actionItem)
      .where(and(eq(schema.actionItem.projectId, projectId), visProject, grant, this.readable(ctx, projectId, 'action_item', schema.actionItem.id), inArray(schema.actionItem.status, ['open', 'in_progress']), lt(schema.actionItem.dueDate, today)))
      .orderBy(asc(schema.actionItem.dueDate))
      .limit(30);
    const approvals = await tx
      .select({ id: schema.approvalRequest.id, subjectType: schema.approvalRequest.subjectType, action: schema.approvalRequest.action, createdAt: schema.approvalRequest.createdAt, version: schema.approvalRequest.version })
      .from(schema.approvalRequest)
      .where(
        and(
          eq(schema.approvalRequest.projectId, projectId),
          visProject,
          grant,
          this.readable(ctx, projectId, 'approval_request', schema.approvalRequest.id), // its subject must be readable (SEC-P34-16)
          eq(schema.approvalRequest.status, 'pending'),
          lt(schema.approvalRequest.createdAt, sql`now() - (${this.cfg.approvalBottleneckDays}::int * interval '1 day')`),
        ),
      )
      .limit(30);
    return { decisions, actions, approvals };
  }

  async gateBlockers(ctx: RequestContext, projectId: string) {
    if (!this.can(ctx, 'gates.gate.read', projectId)) return null;
    const vis = this.vis(ctx, projectId, {});
    const r = await this.db.tx().execute<{
      gate_id: string;
      key: string;
      name: string;
      name_ar: string | null;
      status: string;
      version: number;
      updated_at: Date;
      blocking_unmet: number;
      criteria: { key: string; description: string; status: string }[] | null;
    }>(sql`
      select gate_definition.id as gate_id, gate_definition.key, gate_definition.name, gate_definition.name_ar, gate_assessment.status,
             gate_assessment.version, gate_assessment.updated_at,
             count(criterion_assessment.id) filter (where gate_criterion.mandatory and gate_criterion.blocking
                                                    and criterion_assessment.status in ('unmet', 'evidence_submitted', 'conflicting'))::int as blocking_unmet,
             (jsonb_agg(jsonb_build_object('key', gate_criterion.key, 'description', gate_criterion.description, 'status', criterion_assessment.status)
                order by gate_criterion.sort_order)
               filter (where gate_criterion.mandatory and gate_criterion.blocking and criterion_assessment.status in ('unmet', 'evidence_submitted', 'conflicting'))) as criteria
        from gate_definition
        join gate_assessment on gate_assessment.gate_id = gate_definition.id and gate_assessment.project_id = gate_definition.project_id and gate_assessment.is_current
        left join criterion_assessment on criterion_assessment.assessment_id = gate_assessment.id and criterion_assessment.project_id = gate_definition.project_id
        left join gate_criterion on gate_criterion.id = criterion_assessment.criterion_id and gate_criterion.project_id = gate_definition.project_id
       where gate_definition.project_id = ${projectId} and ${vis}
         and gate_assessment.status not in ('approved', 'approved_with_exceptions', 'superseded')
       group by gate_definition.id, gate_definition.key, gate_definition.name, gate_definition.name_ar, gate_assessment.status, gate_assessment.version, gate_assessment.updated_at, gate_definition.sort_order
       order by gate_definition.sort_order`);
    return r.rows.map((g) => ({ ...g, criteria: (g.criteria ?? []).slice(0, 5) }));
  }

  async closingConditions(ctx: RequestContext, projectId: string) {
    if (!this.can(ctx, 'jv.deal.read', projectId)) return null;
    const vis = this.vis(ctx, projectId, {});
    const grant = this.projectWide(ctx, 'jv.deal.read', projectId); // JV registers carry no workstream (§2.2 strict rule)
    const evVis = evidenceLinkVisibleSql(this.policy, ctx, projectId); // counters = what the evidence list shows (SEC-P1R-05)
    const r = await this.db.tx().execute<{
      id: string;
      reference: string;
      title: string;
      status: string;
      blocking: boolean;
      waivable: boolean;
      gate_key: string | null;
      owner_user_id: string | null;
      long_stop_date: string | null;
      version: number;
      updated_at: Date;
      is_demo: boolean;
      active_evidence: number;
      conflicting_evidence: number;
    }>(sql`
      select closing_condition.id, closing_condition.reference, closing_condition.title, closing_condition.status, closing_condition.blocking,
             closing_condition.waivable, closing_condition.gate_key, closing_condition.owner_user_id, closing_condition.long_stop_date::text,
             closing_condition.version, closing_condition.updated_at, closing_condition.is_demo,
             (select count(*) from evidence_link e left join document d on d.id = e.document_id and d.project_id = e.project_id
               where e.project_id = closing_condition.project_id and e.target_type = 'closing_condition'
                 and e.target_id = closing_condition.id and e.status = 'active' and ${evVis})::int as active_evidence,
             (select count(*) from evidence_link e left join document d on d.id = e.document_id and d.project_id = e.project_id
               where e.project_id = closing_condition.project_id and e.target_type = 'closing_condition'
                 and e.target_id = closing_condition.id and e.status = 'conflicting' and ${evVis})::int as conflicting_evidence
        from closing_condition
       where closing_condition.project_id = ${projectId} and ${vis} and ${grant} and closing_condition.status not in ('verified', 'waived')
       order by closing_condition.reference
       limit 50`);
    return r.rows;
  }

  /** SEC-P34-02: the TSA register's own rule — the TSA's classification and the readiness reach of its workstream. */
  async tsaExpiring(ctx: RequestContext, projectId: string, today: string) {
    if (!this.can(ctx, 'readiness.register.read', projectId)) return null;
    const until = addCalendarDays(today, this.cfg.tsaWindowDays);
    const vis = this.vis(ctx, projectId, {});
    return this.db
      .tx()
      .select({ id: schema.tsaService.id, code: schema.tsaService.code, name: schema.tsaService.name, status: schema.tsaService.status, endDate: schema.tsaService.endDate, ownerUserId: schema.tsaService.ownerUserId, replacementAccepted: schema.tsaService.replacementAccepted, version: schema.tsaService.version, updatedAt: schema.tsaService.updatedAt, isDemo: schema.tsaService.isDemo, classification: schema.tsaService.classification })
      .from(schema.tsaService)
      .where(
        and(
          eq(schema.tsaService.projectId, projectId),
          vis,
          this.readable(ctx, projectId, 'tsa_service', schema.tsaService.id),
          inArray(schema.tsaService.status, ['approved', 'active', 'extended', 'exit_in_progress', 'breached']),
          eq(schema.tsaService.replacementAccepted, false),
          sql`${schema.tsaService.endDate} <= ${until}`,
        ),
      )
      .orderBy(asc(schema.tsaService.endDate))
      .limit(30);
  }

  async readinessBlockers(ctx: RequestContext, projectId: string) {
    if (!this.can(ctx, 'readiness.register.read', projectId)) return null;
    const vis = this.vis(ctx, projectId, {});
    return this.db
      .tx()
      .select({ id: schema.readinessCheck.id, code: schema.readinessCheck.code, title: schema.readinessCheck.title, titleAr: schema.readinessCheck.titleAr, area: schema.readinessCheck.area, status: schema.readinessCheck.status, blocker: schema.readinessCheck.blocker, dueDate: schema.readinessCheck.dueDate, version: schema.readinessCheck.version, updatedAt: schema.readinessCheck.updatedAt, isDemo: schema.readinessCheck.isDemo })
      .from(schema.readinessCheck)
      .where(and(eq(schema.readinessCheck.projectId, projectId), vis, this.readable(ctx, projectId, 'readiness_check', schema.readinessCheck.id), sql`(${schema.readinessCheck.blocker} or ${schema.readinessCheck.mandatory})`, inArray(schema.readinessCheck.status, ['not_started', 'in_progress', 'failed'])))
      .orderBy(desc(schema.readinessCheck.blocker), asc(schema.readinessCheck.code))
      .limit(30);
  }

  async statusDimensions(ctx: RequestContext, projectId: string) {
    if (!this.can(ctx, 'portfolio.dashboard.read', projectId)) return null;
    const vis = this.vis(ctx, projectId, {});
    return this.db
      .tx()
      .select({ id: schema.statusDimension.id, key: schema.statusDimension.key, state: schema.statusDimension.state, explanation: schema.statusDimension.explanation, computedAt: schema.statusDimension.computedAt, version: schema.statusDimension.version })
      .from(schema.statusDimension)
      .where(and(eq(schema.statusDimension.projectId, projectId), vis));
  }

  /** Partner identity is only "confirmed" with an approved deal scenario visible to the user. Demo rows never leak into non-demo projects. */
  async partners(ctx: RequestContext, projectId: string, projectIsDemo: boolean) {
    if (!this.can(ctx, 'jv.partner.read', projectId)) return null;
    const tx = this.db.tx();
    const grant = this.projectWide(ctx, 'jv.partner.read', projectId); // JV registers carry no workstream (§2.2 strict rule)
    const visP = this.vis(ctx, projectId, { classification: schema.partner.classification });
    const demo: SQL = projectIsDemo ? sql`true` : eq(schema.partner.isDemo, false);
    const partners = await tx
      .select({ id: schema.partner.id, code: schema.partner.code, name: schema.partner.name, stage: schema.partner.stage, version: schema.partner.version, updatedAt: schema.partner.updatedAt, isDemo: schema.partner.isDemo, classification: schema.partner.classification })
      .from(schema.partner)
      .where(and(eq(schema.partner.projectId, projectId), visP, grant, demo))
      .limit(20);
    const visS = this.vis(ctx, projectId, { classification: schema.dealScenario.classification });
    const approvedScenarios = await tx
      .select({ id: schema.dealScenario.id, partnerId: schema.dealScenario.partnerId, name: schema.dealScenario.name, versionLabel: schema.dealScenario.versionLabel, version: schema.dealScenario.version, approvedAt: schema.dealScenario.approvedAt, isDemo: schema.dealScenario.isDemo })
      .from(schema.dealScenario)
      .where(and(eq(schema.dealScenario.projectId, projectId), visS, grant, eq(schema.dealScenario.approvalState, 'approved'), projectIsDemo ? sql`true` : eq(schema.dealScenario.isDemo, false)));
    return { partners, approvedScenarios };
  }

  /**
   * Approved figures only (the model never computes them; aggregation is the money engine's job). SEC-P34-03 (P4 exit
   * criterion "financial data only with the finance-domain clearance AND reach"): the finance module's own predicate —
   * finance-domain clearance, and the reach of `finance.record.read` (a workstream-scoped reader: its workstreams' figures
   * only; valuations — no workstream — need a project-wide grant), as `FinanceSupport.visibleSql`.
   */
  async approvedFinancials(ctx: RequestContext, projectId: string, projectIsDemo: boolean) {
    if (!this.can(ctx, 'finance.record.read', projectId)) return null;
    const tx = this.db.tx();
    const visM = this.readable(ctx, projectId, 'financial_model_version', schema.financialModelVersion.id);
    const valuations = await tx
      .select({
        id: schema.financialModelVersion.id,
        versionLabel: schema.financialModelVersion.versionLabel,
        modelCase: schema.financialModelVersion.modelCase,
        outputs: schema.financialModelVersion.outputs,
        headlineBasis: schema.financialModelVersion.headlineBasis,
        approvedAt: schema.financialModelVersion.approvedAt,
        version: schema.financialModelVersion.version,
        isDemo: schema.financialModelVersion.isDemo,
        classification: schema.financialModelVersion.classification,
      })
      .from(schema.financialModelVersion)
      .where(
        and(
          eq(schema.financialModelVersion.projectId, projectId),
          visM,
          eq(schema.financialModelVersion.kind, 'valuation'),
          eq(schema.financialModelVersion.approvalState, 'approved'),
          projectIsDemo ? sql`true` : eq(schema.financialModelVersion.isDemo, false),
        ),
      )
      .limit(5);
    const visS = this.readable(ctx, projectId, 'financial_snapshot', schema.financialSnapshot.id);
    const figures = await tx
      .select({
        id: schema.financialSnapshot.id,
        label: schema.financialSnapshot.label,
        kind: schema.financialSnapshot.kind,
        period: schema.financialSnapshot.period,
        amount: schema.financialSnapshot.amount,
        currency: schema.financialSnapshot.currency,
        unitScale: schema.financialSnapshot.unitScale,
        version: schema.financialSnapshot.version,
        approvedAt: schema.financialSnapshot.approvedAt,
        isDemo: schema.financialSnapshot.isDemo,
        classification: schema.financialSnapshot.classification,
      })
      .from(schema.financialSnapshot)
      .where(and(eq(schema.financialSnapshot.projectId, projectId), visS, eq(schema.financialSnapshot.approvalState, 'approved'), projectIsDemo ? sql`true` : eq(schema.financialSnapshot.isDemo, false)))
      .limit(10);
    return { valuations, figures };
  }

  // ---------------------------------------------------------------------------------------------------------
  /**
   * Delay impact of one task/milestone via the deterministic CPM engine (AT-15). The model never computes schedule
   * numbers. Returns null without planning.plan.read; `unknown_node` when the node is not a visible record.
   */
  async delayImpactFor(ctx: RequestContext, projectId: string, nodeId: string, delayWorkingDays: number, fallbackStart: string): Promise<DelayImpact | null> {
    if (!this.can(ctx, 'planning.plan.read', projectId)) return null;
    const { nodes, edges, start, cal } = await this.scheduleModel(ctx, projectId);
    if (!nodes.some((n) => n.id === nodeId)) return null;
    return delayImpact(nodes, edges, start ?? fallbackStart, nodeId, delayWorkingDays, cal);
  }

  async scheduleModel(ctx: RequestContext, projectId: string) {
    const tx = this.db.tx();
    const vis = this.vis(ctx, projectId, {});
    const tasks = await tx
      .select({ id: schema.task.id, title: schema.task.title, code: schema.task.wbsCode, durationDays: schema.task.durationDays, plannedStart: schema.task.plannedStart, actualStart: schema.task.actualStart, actualFinish: schema.task.actualFinish, forecastFinish: schema.task.forecastFinish, status: schema.task.status })
      .from(schema.task)
      .where(and(eq(schema.task.projectId, projectId), vis, this.policy.reachSql(ctx, 'planning.plan.read', projectId, schema.task.workstreamId)));
    const milestones = await tx
      .select({ id: schema.milestone.id, title: schema.milestone.title, code: schema.milestone.code, actualDate: schema.milestone.actualDate, status: schema.milestone.status })
      .from(schema.milestone)
      .where(and(eq(schema.milestone.projectId, projectId), vis, this.policy.reachSql(ctx, 'planning.plan.read', projectId, schema.milestone.workstreamId)));
    const deps = await tx
      .select({ predecessorId: schema.dependency.predecessorId, successorId: schema.dependency.successorId, type: schema.dependency.type, lagDays: schema.dependency.lagDays })
      .from(schema.dependency)
      .where(and(eq(schema.dependency.projectId, projectId), vis));
    const nodes: ScheduleNode[] = [
      ...tasks.map((t) => ({ id: t.id, label: `${t.code} ${t.title}`, durationDays: t.durationDays, earliestStart: t.plannedStart, actualStart: t.actualStart, actualFinish: t.actualFinish, forecastFinish: t.forecastFinish, cancelled: t.status === 'cancelled' })),
      ...milestones.map((m) => ({ id: m.id, label: `${m.code} ${m.title}`, durationDays: 0, actualFinish: m.actualDate, cancelled: m.status === 'cancelled' })),
    ];
    const known = new Set(nodes.map((n) => n.id));
    const edges: ScheduleEdge[] = deps
      .filter((d) => known.has(d.predecessorId) && known.has(d.successorId))
      .map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type, lagDays: d.lagDays }));
    const p = await this.project(projectId);
    const cal = await this.calendar(projectId);
    return { nodes, edges, start: p?.plannedStart ?? null, cal, tasks };
  }

  /** Predecessor-delay impacts for the most overdue tasks (bounded compute). */
  async predecessorDelays(ctx: RequestContext, projectId: string, today: string, overdue: { id: string; due: string | null }[], max = 3) {
    if (!this.can(ctx, 'planning.plan.read', projectId) || !overdue.length) return [];
    const { nodes, edges, start, cal } = await this.scheduleModel(ctx, projectId);
    if (!start) return [];
    const out: { taskId: string; delay: number; impact: DelayImpact }[] = [];
    for (const t of overdue.slice(0, max)) {
      if (!t.due || !edges.some((e) => e.predecessorId === t.id)) continue;
      const delay = Math.max(1, workingDaySlip(t.due, today, cal));
      const impact = delayImpact(nodes, edges, start, t.id, delay, cal);
      out.push({ taskId: t.id, delay, impact });
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------
  /**
   * SQL form of the citation re-check for ONE (type, id) pair given as text expressions (SEC-P34R-05): the reader may see
   * the cited record — the same per-type rule as {@link visibleCitationKeys} (the owning module's read rule: classification,
   * finance-domain clearance, workstream reach, project-wide registers, the documents list's grant coverage). Unknown types
   * and malformed ids are not visible (deny by default). Used to filter AI proposals by their target and by the records
   * their run gave the model, inside the list query (access-matrix §2.5, §2.6).
   */
  refVisibleSql(ctx: RequestContext, projectId: string, typeText: SQL, idText: SQL): SQL {
    const uuid = sql`(${idText})::uuid`;
    const isUuid = sql`coalesce((${idText}) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)`;
    const no = sql`false`;
    // CASE, not AND: PostgreSQL does not guarantee the evaluation order of AND, and a malformed id must never reach `::uuid`.
    const ifUuid = (cond: SQL) => sql`(case when ${isUuid} then (${cond}) else false end)`;
    const rec = (type: string, permission: string | null, extra: SQL = sql`true`) =>
      permission && !this.can(ctx, permission, projectId) ? no : ifUuid(sql`${this.readable(ctx, projectId, type, uuid)} and ${extra}`);
    const row = (table: string, permission: string, extra: SQL = sql`true`) =>
      this.can(ctx, permission, projectId) ? ifUuid(sql`exists (select 1 from ${sql.identifier(table)} hub_rr where hub_rr.id = ${uuid} and hub_rr.project_id = ${projectId}) and ${extra}`) : no;
    const raw = (c: string) => sql.raw(c) as unknown as PgColumn;
    const doc = this.can(ctx, 'documents.document.read', projectId)
      ? ifUuid(sql`exists (select 1 from document hub_rd where hub_rd.id = ${uuid} and hub_rd.project_id = ${projectId} and hub_rd.deleted_at is null
          and ${this.vis(ctx, projectId, { classification: raw('hub_rd.classification'), room: raw('hub_rd.room_id') })}
          and ${this.policy.grantSql(ctx, 'documents.document.read', projectId, { room: raw('hub_rd.room_id') })})`)
      : no;
    const decisionWide = this.projectWide(ctx, 'governance.decision.read', projectId);
    const statusDims = this.can(ctx, 'portfolio.dashboard.read', projectId) ? 'portfolio.dashboard.read' : 'portfolio.project.read';
    const computationNode = sql`substring((${idText}) from '^delay_impact:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):')`;
    const computation = this.can(ctx, 'planning.plan.read', projectId)
      ? sql`(case when ${computationNode} is not null then ${this.readable(ctx, projectId, 'task', sql`(${computationNode})::uuid`)} else false end)`
      : no;
    return sql`(${this.projectSql(ctx, projectId)} and case ${typeText}
      when 'document' then ${doc}
      when 'task' then ${rec('task', 'planning.plan.read')}
      when 'milestone' then ${rec('milestone', 'planning.plan.read')}
      when 'workstream' then ${rec('workstream', 'planning.plan.read')}
      when 'decision' then ${rec('decision', 'governance.decision.read')}
      when 'action_item' then ${rec('action_item', 'governance.decision.read', decisionWide)}
      when 'approval_request' then ${rec('approval_request', 'governance.decision.read', decisionWide)}
      when 'gate_definition' then ${row('gate_definition', 'gates.gate.read', this.policy.grantSql(ctx, 'gates.gate.read', projectId, {}))}
      when 'closing_condition' then ${row('closing_condition', 'jv.deal.read', this.projectWide(ctx, 'jv.deal.read', projectId))}
      when 'tsa_service' then ${rec('tsa_service', 'readiness.register.read')}
      when 'readiness_check' then ${rec('readiness_check', 'readiness.register.read')}
      when 'status_dimension' then ${row('status_dimension', statusDims, this.policy.grantSql(ctx, statusDims, projectId, {}))}
      when 'partner' then ${rec('partner', 'jv.partner.read', this.projectWide(ctx, 'jv.partner.read', projectId))}
      when 'deal_scenario' then ${rec('deal_scenario', 'jv.partner.read', this.projectWide(ctx, 'jv.partner.read', projectId))}
      when 'financial_model_version' then ${rec('financial_model_version', 'finance.record.read')}
      when 'financial_snapshot' then ${rec('financial_snapshot', 'finance.record.read')}
      when 'computation' then ${computation}
      else false end)`;
  }

  /**
   * The reader may read EVERY record a run gave the model (SEC-P5-01, SEC-P5-05): the run inputs sent to the provider, each
   * under {@link refVisibleSql} for `reader` — the rule 2 of the AI proposals' reader visibility, for one reader. `refs` are
   * passed by the runtime before the run's snapshot is stored; otherwise the run's stored evidence snapshot is read (items
   * with `sentToProvider`, absent flag = sent). Fails closed when the inputs are unknown (no run, or a run without a
   * snapshot); an empty input set passes. One SQL statement in the current transaction.
   */
  async inputsVisible(reader: RequestContext, projectId: string, content: ContentInputs): Promise<boolean> {
    if (!(await this.projectVisible(reader, projectId))) return false; // QA-P5-03: not even an empty input set
    let items: SQL;
    if ('refs' in content) {
      const refs = content.refs.map((r) => ({ type: String(r.type), id: String(r.id), sentToProvider: true }));
      items = sql`${JSON.stringify(refs)}::jsonb`;
    } else {
      if (!content.runId) return false;
      items = sql`(select case when jsonb_typeof(hub_cr.evidence_snapshot->'items') = 'array' then hub_cr.evidence_snapshot->'items' end
                     from ai_run hub_cr where hub_cr.id = ${content.runId}::uuid and hub_cr.project_id = ${projectId})`;
    }
    const r = await this.db.tx().execute<{ ok: boolean }>(sql`
      select case when hub_ci.items is null then false else not exists (
               select 1 from jsonb_array_elements(hub_ci.items) hub_it
                where coalesce((hub_it->>'sentToProvider')::boolean, true)
                  and not ${this.refVisibleSql(reader, projectId, sql`(hub_it->>'type')`, sql`(hub_it->>'id')`)}) end as ok
        from (select ${items} as items) hub_ci`);
    return r.rows[0]?.ok === true;
  }

  // ---------------------------------------------------------------------------------------------------------
  /**
   * Visibility re-check of cited items for the CURRENT principal (before output and on every read — §12.1).
   * Returns the set of citation keys still visible. Unknown types are treated as not visible (deny by default).
   */
  async visibleCitationKeys(ctx: RequestContext, projectId: string, refs: { type: string; id: string }[]): Promise<Set<string>> {
    const out = new Set<string>();
    // QA-P5-03: nothing of a project is visible to a reader who may not see the project (its classification).
    if (refs.length && !(await this.projectVisible(ctx, projectId))) return out;
    const byType = new Map<string, string[]>();
    for (const r of refs) {
      if (r.type === 'computation') continue;
      if (!/^[0-9a-f-]{36}$/i.test(r.id)) continue;
      (byType.get(r.type) ?? byType.set(r.type, []).get(r.type)!).push(r.id);
    }
    const tx = this.db.tx();
    const add = (type: string, ids: { id: string }[]) => ids.forEach((x) => out.add(`${type}:${x.id}`));
    const projectVis = this.vis(ctx, projectId, {});
    for (const [type, ids] of byType) {
      switch (type) {
        case 'document':
          if (!this.can(ctx, 'documents.document.read', projectId)) break;
          add(
            type,
            await tx
              .select({ id: schema.document.id })
              .from(schema.document)
              .where(
                and(
                  eq(schema.document.projectId, projectId),
                  inArray(schema.document.id, ids),
                  isNull(schema.document.deletedAt),
                  this.vis(ctx, projectId, { classification: schema.document.classification, room: schema.document.roomId }),
                  this.policy.grantSql(ctx, 'documents.document.read', projectId, { room: schema.document.roomId }),
                ),
              ),
          );
          break;
        case 'task':
        case 'milestone':
        case 'workstream': {
          if (!this.can(ctx, 'planning.plan.read', projectId)) break;
          const t = type === 'task' ? schema.task : type === 'milestone' ? schema.milestone : schema.workstream;
          const wsCol = type === 'task' ? schema.task.workstreamId : type === 'milestone' ? schema.milestone.workstreamId : schema.workstream.id;
          add(type, await tx.select({ id: t.id }).from(t).where(and(eq(t.projectId, projectId), inArray(t.id, ids), projectVis, this.policy.reachSql(ctx, 'planning.plan.read', projectId, wsCol))));
          break;
        }
        case 'decision':
          if (!this.can(ctx, 'governance.decision.read', projectId)) break;
          add(type, await tx.select({ id: schema.decision.id }).from(schema.decision).where(and(eq(schema.decision.projectId, projectId), inArray(schema.decision.id, ids), this.vis(ctx, projectId, { classification: schema.decision.classification }), this.projectWide(ctx, 'governance.decision.read', projectId))));
          break;
        case 'action_item':
        case 'approval_request': {
          if (!this.can(ctx, 'governance.decision.read', projectId)) break;
          const t = type === 'action_item' ? schema.actionItem : schema.approvalRequest;
          add(type, await tx.select({ id: t.id }).from(t).where(and(eq(t.projectId, projectId), inArray(t.id, ids), projectVis, this.projectWide(ctx, 'governance.decision.read', projectId), this.readable(ctx, projectId, type, t.id))));
          break;
        }
        case 'gate_definition':
          if (!this.can(ctx, 'gates.gate.read', projectId)) break;
          add(type, await tx.select({ id: schema.gateDefinition.id }).from(schema.gateDefinition).where(and(eq(schema.gateDefinition.projectId, projectId), inArray(schema.gateDefinition.id, ids), projectVis)));
          break;
        case 'closing_condition':
          if (!this.can(ctx, 'jv.deal.read', projectId)) break;
          add(type, await tx.select({ id: schema.closingCondition.id }).from(schema.closingCondition).where(and(eq(schema.closingCondition.projectId, projectId), inArray(schema.closingCondition.id, ids), projectVis, this.projectWide(ctx, 'jv.deal.read', projectId))));
          break;
        case 'tsa_service':
        case 'readiness_check': {
          if (!this.can(ctx, 'readiness.register.read', projectId)) break;
          const t = type === 'tsa_service' ? schema.tsaService : schema.readinessCheck;
          // SEC-P34-02: the record rule (TSA: classification + readiness reach; check: readiness reach).
          add(type, await tx.select({ id: t.id }).from(t).where(and(eq(t.projectId, projectId), inArray(t.id, ids), projectVis, this.readable(ctx, projectId, type, t.id))));
          break;
        }
        case 'status_dimension':
          if (!this.can(ctx, 'portfolio.dashboard.read', projectId)) break;
          add(type, await tx.select({ id: schema.statusDimension.id }).from(schema.statusDimension).where(and(eq(schema.statusDimension.projectId, projectId), inArray(schema.statusDimension.id, ids), projectVis)));
          break;
        case 'partner':
          if (!this.can(ctx, 'jv.partner.read', projectId)) break;
          add(type, await tx.select({ id: schema.partner.id }).from(schema.partner).where(and(eq(schema.partner.projectId, projectId), inArray(schema.partner.id, ids), this.vis(ctx, projectId, { classification: schema.partner.classification }), this.projectWide(ctx, 'jv.partner.read', projectId))));
          break;
        case 'deal_scenario':
          if (!this.can(ctx, 'jv.partner.read', projectId)) break;
          add(type, await tx.select({ id: schema.dealScenario.id }).from(schema.dealScenario).where(and(eq(schema.dealScenario.projectId, projectId), inArray(schema.dealScenario.id, ids), this.vis(ctx, projectId, { classification: schema.dealScenario.classification }), this.projectWide(ctx, 'jv.partner.read', projectId))));
          break;
        case 'financial_model_version':
          if (!this.can(ctx, 'finance.record.read', projectId)) break;
          // SEC-P34-03: finance-domain clearance + finance reach (FinanceSupport.visibleSql), as in retrieval.
          add(type, await tx.select({ id: schema.financialModelVersion.id }).from(schema.financialModelVersion).where(and(eq(schema.financialModelVersion.projectId, projectId), inArray(schema.financialModelVersion.id, ids), this.readable(ctx, projectId, type, schema.financialModelVersion.id))));
          break;
        case 'financial_snapshot':
          if (!this.can(ctx, 'finance.record.read', projectId)) break;
          add(type, await tx.select({ id: schema.financialSnapshot.id }).from(schema.financialSnapshot).where(and(eq(schema.financialSnapshot.projectId, projectId), inArray(schema.financialSnapshot.id, ids), this.readable(ctx, projectId, type, schema.financialSnapshot.id))));
          break;
        default:
          break; // unknown types: not visible (deny by default)
      }
    }
    // Computations are visible when the node they were computed for is visible.
    for (const r of refs) {
      if (r.type !== 'computation') continue;
      const node = /^delay_impact:([0-9a-f-]{36}):/.exec(r.id)?.[1];
      if (node && (out.has(`task:${node}`) || (await this.visibleCitationKeys(ctx, projectId, [{ type: 'task', id: node }])).size)) out.add(`computation:${r.id}`);
    }
    return out;
  }

  /** Current version of a proposal target (for approval binding); null = no target, 'missing' = not in this project. */
  async targetVersion(projectId: string, targetType: string | null, targetId: string | null): Promise<number | null | 'missing'> {
    if (!targetType || !targetId) return null;
    if (!(PROPOSAL_TARGET_TYPES as readonly string[]).includes(targetType) || !/^[0-9a-f-]{36}$/i.test(targetId)) return 'missing';
    // Table name comes from the fixed allowlist above (never from input); ids are bound parameters.
    const r = await this.db.query<{ v: number }>(`select version as v from ${targetType} where project_id = $1 and id = $2`, [projectId, targetId]);
    return r.rows[0] ? r.rows[0].v : 'missing';
  }
}

/** A record reference (type + id) as stored in a run's evidence snapshot. */
export interface ContentRef {
  type: string;
  id: string;
}

/**
 * What derived content (a proposal, a draft, a stored run's model text) was produced from (SEC-P5-01): the records its run
 * sent to the model — explicit refs while the run is being finalized, the run's stored evidence snapshot afterwards.
 */
export type ContentInputs = { refs: ContentRef[] } | { runId: string | null };

export const PROPOSAL_TARGET_TYPES = ['task', 'milestone', 'decision', 'action_item', 'closing_condition', 'readiness_check', 'tsa_service', 'gate_definition', 'workstream'] as const;
