import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  POLICY_MATRIX,
  ProjectTemplateDefinition,
  RoleKey,
  conflict,
  notFound,
  ruleViolation,
  forbidden,
  invalid,
  clearanceAllows,
  Classification,
  endOfLocalDayUtc,
  EVIDENCE_TARGET_READ_PERMISSION,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import type { RequestContext, ProjectScope } from '../../platform/context';
import { newId } from '../../platform/ids';
import { ProjectFactory } from './project-factory.service';
import { likeContains } from '../../platform/helpers';
import { RecordVisibility } from '../../platform/record-visibility';
import { orderBySort } from '../../platform/sort';
import type { RouteInput, portfolioRoutes } from '@hub/contracts';

/** Roles a project manager may grant (higher-authority roles need portfolio/platform administration). */
const PM_GRANTABLE: RoleKey[] = ['workstream_lead', 'contributor', 'functional_approver', 'finance_restricted', 'legal_restricted', 'clean_team', 'external_partner_limited', 'secretary_cpmo'];
/**
 * Activity feed ALLOWLIST (ARCH-12): entity type → permission required to see its history. Unknown or unlisted
 * types are hidden (deny by default); document/partner-room level history is only visible through audit.event.read.
 */
const ACTIVITY_ENTITY_PERMISSION: Record<string, string> = {
  project: 'portfolio.project.read',
  workstream: 'planning.plan.read',
  project_membership: 'admin.role_assignment.read',
  task: 'planning.plan.read',
  milestone: 'planning.plan.read',
  deliverable: 'planning.plan.read',
  dependency: 'planning.plan.read',
  baseline_version: 'planning.plan.read',
  change_request: 'planning.plan.read',
  risk: 'planning.plan.read',
  issue: 'planning.plan.read',
  assumption: 'planning.plan.read',
  raid_dependency: 'planning.plan.read',
  status_update: 'planning.plan.read',
  rag_override: 'planning.plan.read',
  committee: 'governance.committee.read',
  committee_membership: 'governance.committee.read',
  authority_matrix_version: 'governance.committee.read',
  meeting: 'governance.meeting.read',
  agenda_item: 'governance.meeting.read',
  decision: 'governance.decision.read',
  action_item: 'governance.decision.read',
  escalation: 'governance.decision.read',
  gate_definition: 'gates.gate.read',
  gate_criterion: 'gates.gate.read',
  gate_assessment: 'gates.gate.read',
  criterion_assessment: 'gates.gate.read',
  waiver: 'gates.gate.read',
  perimeter_item: 'carveout.register.read',
  perimeter_version: 'carveout.register.read',
  perimeter_category_review: 'carveout.register.read',
  agreement: 'carveout.register.read',
  consent: 'carveout.register.read',
  legal_entity: 'newco.register.read',
  regulatory_requirement: 'newco.register.read',
  readiness_check: 'readiness.register.read',
  cutover_plan: 'readiness.register.read',
  tsa_service: 'readiness.register.read',
  budget_line: 'finance.record.read',
  benefit: 'finance.record.read',
  closing: 'jv.deal.read',
  closing_condition: 'jv.deal.read',
};

@Injectable()
export class PortfolioService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly factory: ProjectFactory,
    private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------------------------------------------------
  async listProjects(ctx: RequestContext, q: RouteInput<typeof portfolioRoutes.listProjects>['query']) {
    const tx = this.db.tx();
    const ids = ctx.projectIds;
    if (ids.length === 0) return { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
    const conds = [inArray(schema.project.id, ids)];
    if (q.q) conds.push(or(ilike(schema.project.name, likeContains(q.q)), ilike(schema.project.code, likeContains(q.q)))!);
    if (q.includeDemo === 'false') conds.push(eq(schema.project.isDemo, false));
    const rows = await tx
      .select({
        p: schema.project,
        tplKey: schema.projectTemplate.key,
        tplKind: schema.projectTemplate.kind,
        versionNo: schema.projectTemplateVersion.versionNo,
        programName: schema.program.name,
      })
      .from(schema.project)
      .innerJoin(schema.projectTemplateVersion, eq(schema.projectTemplateVersion.id, schema.project.templateVersionId))
      .innerJoin(schema.projectTemplate, eq(schema.projectTemplate.id, schema.projectTemplateVersion.templateId))
      .leftJoin(schema.program, eq(schema.program.id, schema.project.programId))
      .where(and(...conds))
      .orderBy(
        ...orderBySort(q.sort, { code: schema.project.code, name: schema.project.name, status: schema.project.status }, schema.project.id, [
          desc(schema.project.isDemo),
          asc(schema.project.code),
          asc(schema.project.id),
        ]),
      );
    // Visibility: project classification vs clearance and project.read permission (no counts for hidden projects).
    // Filtering keeps the SQL order, so the requested sort applies to exactly the visible projects.
    const visible = rows.filter(
      (r) => this.policy.canInProject(ctx, 'portfolio.project.read', r.p.id) && clearanceAllows(ctx.principal.clearance, r.p.classification as Classification),
    );
    const total = visible.length;
    const pageRows = visible.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const items = [];
    for (const r of pageRows) items.push(await this.summarize(ctx, r));
    return { items, page: q.page, pageSize: q.pageSize, total };
  }

  private async summarize(
    ctx: RequestContext,
    r: { p: typeof schema.project.$inferSelect; tplKey: string; tplKind: string; versionNo: number; programName: string | null },
  ) {
    const tx = this.db.tx();
    const pid = r.p.id;
    const dims = await tx.select().from(schema.statusDimension).where(eq(schema.statusDimension.projectId, pid));
    const canPlan = this.policy.canInProject(ctx, 'planning.plan.read', pid);
    // Governance records are committee-level (no workstream): only a project-wide grant sees their counts (ARCH-14).
    const canGov = this.policy.permissionReach(ctx, 'governance.decision.read', pid).all;
    const canGates = this.policy.canInProject(ctx, 'gates.gate.read', pid);
    const today = this.clock.today(r.p.timezone);
    const openRisks = canPlan
      ? Number(
          (
            await tx
              .select({ n: count() })
              .from(schema.risk)
              .where(
                and(
                  eq(schema.risk.projectId, pid),
                  inArray(schema.risk.status, ['open', 'monitoring', 'escalated']),
                  this.policy.reachSql(ctx, 'planning.plan.read', pid, schema.risk.workstreamId),
                ),
              )
          )[0]!.n,
        )
      : null;
    const overdueActions = canGov
      ? Number(
          (
            await tx
              .select({ n: count() })
              .from(schema.actionItem)
              .where(and(eq(schema.actionItem.projectId, pid), inArray(schema.actionItem.status, ['open', 'in_progress']), lt(schema.actionItem.dueDate, today)))
          )[0]!.n,
        )
      : null;
    let nextGate: { key: string; name: string; nameAr: string | null; status: string } | null = null;
    if (canGates) {
      const g = await tx
        .select({ key: schema.gateDefinition.key, name: schema.gateDefinition.name, nameAr: schema.gateDefinition.nameAr, status: schema.gateAssessment.status })
        .from(schema.gateDefinition)
        .innerJoin(schema.gateAssessment, and(eq(schema.gateAssessment.gateId, schema.gateDefinition.id), eq(schema.gateAssessment.isCurrent, true)))
        .where(and(eq(schema.gateDefinition.projectId, pid), sql`${schema.gateAssessment.status} not in ('approved','approved_with_exceptions')`))
        .orderBy(asc(schema.gateDefinition.sortOrder))
        .limit(1);
      nextGate = g[0] ?? null;
    }
    const scope = ctx.principal.projects.get(pid);
    return {
      id: pid,
      code: r.p.code,
      name: r.p.name,
      status: r.p.status,
      classification: r.p.classification,
      isDemo: r.p.isDemo,
      templateKey: r.tplKey,
      templateKind: r.tplKind as 'dc_carveout',
      templateVersionNo: r.versionNo,
      programName: r.programName,
      myRoles: scope ? [...new Set([...scope.roles, ...scope.workstreamRoles.map((w) => w.role)])] : [],
      dimensions: dims.map((d) => ({ key: d.key, state: d.state, explanation: d.explanation, explanationI18n: d.explanationI18n ?? [] })),
      openRisks,
      overdueActions,
      nextGate,
    };
  }

  async getProject(ctx: RequestContext, projectId: string) {
    const tx = this.db.tx();
    const rows = await tx
      .select({
        p: schema.project,
        tplKey: schema.projectTemplate.key,
        tplKind: schema.projectTemplate.kind,
        versionNo: schema.projectTemplateVersion.versionNo,
        definition: schema.projectTemplateVersion.definition,
        programName: schema.program.name,
      })
      .from(schema.project)
      .innerJoin(schema.projectTemplateVersion, eq(schema.projectTemplateVersion.id, schema.project.templateVersionId))
      .innerJoin(schema.projectTemplate, eq(schema.projectTemplate.id, schema.projectTemplateVersion.templateId))
      .leftJoin(schema.program, eq(schema.program.id, schema.project.programId))
      .where(eq(schema.project.id, projectId));
    const r = rows[0];
    if (!r) throw notFound();
    this.policy.assert(ctx, 'portfolio.project.read', { projectId, classification: r.p.classification });
    const summary = await this.summarize(ctx, r);
    const def = r.definition as unknown as ProjectTemplateDefinition;
    const entities = await tx
      .select({ id: schema.legalEntity.id, name: schema.legalEntity.name, role: schema.projectEntity.role, inc: schema.legalEntity.incorporationStatus, ver: schema.legalEntity.incorporationVerification, isDemo: schema.legalEntity.isDemo })
      .from(schema.projectEntity)
      .innerJoin(schema.legalEntity, eq(schema.legalEntity.id, schema.projectEntity.legalEntityId))
      .where(eq(schema.projectEntity.projectId, projectId));
    const counts: Record<string, number> = {};
    if (this.policy.canInProject(ctx, 'planning.plan.read', projectId)) {
      // Counts honour the permission's reach: workstream-scoped users count only their workstreams (ARCH-14).
      const reach = (col: SQL) => this.policy.reachSql(ctx, 'planning.plan.read', projectId, col);
      const c = await tx.execute<{ workstreams: number; tasks: number; milestones: number; deliverables: number }>(sql`
        select (select count(*) from workstream where project_id = ${projectId} and ${reach(sql`id`)})::int as workstreams,
               (select count(*) from task where project_id = ${projectId} and ${reach(sql`workstream_id`)})::int as tasks,
               (select count(*) from milestone where project_id = ${projectId} and ${reach(sql`workstream_id`)})::int as milestones,
               (select count(*) from deliverable where project_id = ${projectId} and ${reach(sql`workstream_id`)})::int as deliverables`);
      Object.assign(counts, c.rows[0]);
    }
    return {
      ...summary,
      description: r.p.description,
      objective: r.p.objective,
      timezone: r.p.timezone,
      workingDays: r.p.workingDays,
      plannedStart: r.p.plannedStart,
      version: r.p.version,
      setupState: { ...(r.p.setupState as Record<string, unknown>), gaps: await this.setupGaps(projectId, r.tplKind, this.clock.today(r.p.timezone)), gapsComputedAt: this.clock.now().toISOString() },
      // Both languages (QA-P1-14): the client picks by its active locale.
      phases: (def.phases ?? []).map((ph) => ({ key: ph.key, name: ph.name.en, nameAr: ph.name.ar || null, gateKeys: ph.gateKeys })),
      entities: entities.map((e) => ({ id: e.id, name: e.name, role: e.role, incorporationStatus: e.inc, verification: e.ver, isDemo: e.isDemo })),
      counts,
    };
  }

  async updateProject(ctx: RequestContext, projectId: string, body: { expectedVersion: number; name?: string; description?: string; objective?: string; plannedStart?: string | null }) {
    const tx = this.db.tx();
    const [p] = await tx.select().from(schema.project).where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    this.policy.assert(ctx, 'portfolio.project.update', { projectId, classification: p.classification });
    const { expectedVersion } = body;
    // Explicit field mapping — never spread request bodies into updates (ARCH-19); status is not updatable here.
    const changes: Partial<typeof schema.project.$inferInsert> = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.description !== undefined) changes.description = body.description;
    if (body.objective !== undefined) changes.objective = body.objective;
    if (body.plannedStart !== undefined) changes.plannedStart = body.plannedStart;
    // A request that changes nothing is not a write: no version bump, no audit row (QA-P1-12).
    const current = p as unknown as Record<string, unknown>;
    const effective = Object.fromEntries(Object.entries(changes).filter(([k, v]) => current[k] !== v));
    if (Object.keys(effective).length === 0) {
      if (p.version !== expectedVersion) throw conflict('concurrency.version_mismatch', 'The project was changed by someone else — reload and review', { expectedVersion, currentVersion: p.version });
      return { version: p.version };
    }
    const res = await tx
      .update(schema.project)
      .set({ ...changes, updatedAt: new Date(), version: sql`${schema.project.version} + 1` })
      .where(and(eq(schema.project.id, projectId), eq(schema.project.version, expectedVersion)))
      .returning({ version: schema.project.version });
    if (!res[0]) throw conflict('concurrency.version_mismatch', 'The project was changed by someone else — reload and review', { expectedVersion, currentVersion: p.version });
    await this.audit.record({ action: 'portfolio.project.update', entityType: 'project', entityId: projectId, projectId, before: pick(p, Object.keys(changes)), after: changes });
    return { version: res[0].version };
  }

  // ---------------------------------------------------------------------------------------------------------
  async listTemplates(ctx: RequestContext) {
    const allowed =
      this.policy.canOrg(ctx, 'config.template.read') ||
      this.policy.canOrg(ctx, 'portfolio.project.create') ||
      [...ctx.principal.projects.keys()].some((pid) => this.policy.canInProject(ctx, 'config.template.read', pid));
    if (!allowed) throw forbidden('policy.forbidden', 'Missing permission config.template.read');
    const tx = this.db.tx();
    const rows = await tx
      .select({ v: schema.projectTemplateVersion, t: schema.projectTemplate })
      .from(schema.projectTemplateVersion)
      .innerJoin(schema.projectTemplate, eq(schema.projectTemplate.id, schema.projectTemplateVersion.templateId))
      .where(eq(schema.projectTemplateVersion.status, 'published'))
      .orderBy(asc(schema.projectTemplate.key), desc(schema.projectTemplateVersion.versionNo));
    return {
      items: rows.map(({ v, t }) => {
        const d = v.definition as unknown as ProjectTemplateDefinition;
        return {
          id: v.id,
          templateId: t.id,
          templateKey: t.key,
          kind: t.kind,
          name: t.name,
          nameAr: d.name?.ar || null,
          versionNo: v.versionNo,
          status: v.status,
          counts: { gates: d.gates?.length ?? 0, workstreams: d.workstreams?.length ?? 0, activities: d.wbs?.length ?? 0, kpis: d.kpis?.length ?? 0 },
          publishedAt: v.publishedAt?.toISOString() ?? null,
        };
      }),
    };
  }

  async listPrograms(ctx: RequestContext) {
    this.policy.assertOrg(ctx, 'portfolio.portfolio.read');
    const tx = this.db.tx();
    const rows = await tx
      .select({ id: schema.program.id, code: schema.program.code, name: schema.program.name, portfolioName: schema.portfolio.name, isDemo: schema.program.isDemo })
      .from(schema.program)
      .innerJoin(schema.portfolio, eq(schema.portfolio.id, schema.program.portfolioId))
      .orderBy(asc(schema.program.code));
    return { items: rows };
  }

  async createProject(
    ctx: RequestContext,
    body: {
      templateVersionId: string;
      programId?: string;
      code: string;
      name: string;
      description?: string;
      objective?: string;
      classification: Classification;
      plannedStart?: string;
      projectManagerUserId: string;
      newco: { mode: 'none' | 'existing' | 'new'; legalEntityId?: string; name?: string; incorporationStatus: 'incorporated' | 'incorporation_in_progress' | 'unconfirmed' | 'not_applicable' };
    },
    /** Internal option (not exposed over HTTP): mark as synthetic demo data — only honoured in demo mode by the seed CLI. */
    opts: { isDemo?: boolean } = {},
  ) {
    this.policy.assertOrg(ctx, 'portfolio.project.create');
    const tx = this.db.tx();
    const [tv] = await tx.select().from(schema.projectTemplateVersion).where(eq(schema.projectTemplateVersion.id, body.templateVersionId));
    if (!tv || tv.status !== 'published') throw invalid('portfolio.template_not_published', 'Template version is not published');
    // access-matrix §2.4: nobody creates content above their own clearance (QA-P1-05).
    if (!clearanceAllows(ctx.principal.clearance, body.classification)) {
      throw forbidden('policy.classification_exceeds_clearance', 'You cannot create a project classified above your own clearance');
    }
    const [pm] = await tx.select().from(schema.appUser).where(and(eq(schema.appUser.id, body.projectManagerUserId), eq(schema.appUser.isActive, true)));
    if (!pm) throw invalid('portfolio.pm_not_found', 'Project manager user not found or inactive');
    // access-matrix §2.8: external (partner) accounts never hold internal roles (QA-P1-04); the DB enforces it too.
    if (pm.accountType !== 'internal') throw ruleViolation('identity.external_account_role', 'An external account cannot be the project manager');
    if (!clearanceAllows(pm.clearance as Classification, body.classification)) {
      throw ruleViolation('portfolio.pm_clearance_too_low', "The project manager's clearance is below the project classification");
    }
    if (body.programId) {
      const [prog] = await tx.select({ id: schema.program.id }).from(schema.program).where(eq(schema.program.id, body.programId));
      if (!prog) throw invalid('portfolio.program_not_found', 'Program not found');
    }
    // Code uniqueness is enforced by the (org_id, code) unique index → 409 (no details about the other project).

    const projectId = newId();
    // Extend the transaction's RLS scope to the new project (creator's authority comes from portfolio.project.create).
    const scope: ProjectScope = { projectId, roles: new Set(['portfolio_admin']), workstreamRoles: [], roomIds: new Set(), cleanTeamRoomIds: new Set(), roomRoles: [] };
    ctx.principal.projects.set(projectId, scope);
    ctx.projectIds = [...ctx.projectIds, projectId];
    await this.db.refreshContext(ctx);

    const isDemo = opts.isDemo === true;
    await tx.insert(schema.project).values({
      id: projectId,
      orgId: ctx.principal.orgId,
      programId: body.programId ?? null,
      templateVersionId: tv.id,
      code: body.code,
      name: body.name,
      description: body.description ?? null,
      objective: body.objective ?? null,
      classification: body.classification,
      plannedStart: body.plannedStart ?? null,
      status: 'setup',
      isDemo,
      createdBy: ctx.principal.userId,
      setupState: { step: 'created', gaps: ['perimeter', 'committee', 'authority_matrix', 'baseline', 'owners'] },
    });
    const created = await this.factory.instantiate({ orgId: ctx.principal.orgId, projectId, def: tv.definition as unknown as ProjectTemplateDefinition, isDemo, createdBy: ctx.principal.userId });

    await tx.insert(schema.projectMembership).values({
      id: newId(),
      orgId: ctx.principal.orgId,
      projectId,
      userId: pm.id,
      role: 'project_manager',
      grantedBy: ctx.principal.userId,
      reason: 'Assigned at project creation',
    });

    if (body.newco.mode !== 'none') {
      let entityId = body.newco.legalEntityId ?? null;
      if (body.newco.mode === 'existing') {
        if (!entityId) throw invalid('portfolio.newco_entity_required', 'Select the existing NewCo legal entity');
        const [le] = await tx.select({ id: schema.legalEntity.id, kind: schema.legalEntity.kind }).from(schema.legalEntity).where(eq(schema.legalEntity.id, entityId));
        if (!le || le.kind !== 'newco') throw invalid('portfolio.newco_entity_invalid', 'Legal entity not found or not a NewCo');
      }
      if (body.newco.mode === 'new') {
        if (!body.newco.name) throw invalid('portfolio.newco_name_required', 'NewCo name is required');
        entityId = newId();
        await tx.insert(schema.legalEntity).values({
          id: entityId,
          orgId: ctx.principal.orgId,
          name: body.newco.name,
          kind: 'newco',
          isDemo,
          incorporationStatus: body.newco.incorporationStatus,
          // Status is self-declared at setup; it stays unverified until evidence is linked and verified.
          incorporationVerification: body.newco.incorporationStatus === 'unconfirmed' ? 'unknown' : 'proposed',
          ownerProjectId: projectId, // the new project owns the NewCo it creates (SEC-P1R-03)
          createdBy: ctx.principal.userId,
        });
      }
      if (entityId) await tx.insert(schema.projectEntity).values({ id: newId(), orgId: ctx.principal.orgId, projectId, legalEntityId: entityId, role: 'newco' });
    }

    await this.audit.record({ action: 'portfolio.project.create', entityType: 'project', entityId: projectId, projectId, after: { code: body.code, name: body.name, templateVersionId: tv.id, projectManager: pm.id, created } });
    await this.outbox.emit({ type: 'permission.changed', projectId, aggregateType: 'project', aggregateId: projectId, payload: { reason: 'project_created' } });
    return { id: projectId, code: body.code, created };
  }

  // ---------------------------------------------------------------------------------------------------------
  async directory(ctx: RequestContext, q: string) {
    const allowed = this.policy.canOrg(ctx, 'admin.directory.search') || [...ctx.principal.projects.keys()].some((pid) => this.policy.canInProject(ctx, 'admin.directory.search', pid));
    if (!allowed) throw forbidden('policy.forbidden', 'Missing permission admin.directory.search');
    const tx = this.db.tx();
    const where = and(
      eq(schema.appUser.isActive, true),
      eq(schema.appUser.isServiceAccount, false),
      q ? or(ilike(schema.appUser.displayName, likeContains(q)), ilike(schema.appUser.email, likeContains(q))) : undefined,
    );
    const rows = await tx
      .select({ id: schema.appUser.id, displayName: schema.appUser.displayName, email: schema.appUser.email, title: schema.appUser.title, isDemo: schema.appUser.isDemo })
      .from(schema.appUser)
      .where(where)
      .orderBy(asc(schema.appUser.displayName))
      .limit(25);
    return { items: rows };
  }

  async listMembers(ctx: RequestContext, projectId: string) {
    this.policy.assert(ctx, 'admin.role_assignment.read', { projectId });
    const tx = this.db.tx();
    const rows = await tx
      .select({ m: schema.projectMembership, u: schema.appUser, wsCode: schema.workstream.code })
      .from(schema.projectMembership)
      .innerJoin(schema.appUser, eq(schema.appUser.id, schema.projectMembership.userId))
      .leftJoin(schema.workstream, eq(schema.workstream.id, schema.projectMembership.workstreamId))
      .where(and(eq(schema.projectMembership.projectId, projectId), isNull(schema.projectMembership.revokedAt)))
      .orderBy(asc(schema.appUser.displayName));
    return {
      items: rows.map(({ m, u, wsCode }) => ({
        id: m.id,
        userId: u.id,
        displayName: u.displayName,
        email: u.email,
        role: m.role,
        workstreamId: m.workstreamId,
        workstreamCode: wsCode ?? null,
        validTo: m.validTo?.toISOString() ?? null,
        grantedAt: m.createdAt.toISOString(),
      })),
    };
  }

  async grantMembership(ctx: RequestContext, projectId: string, body: { userId: string; role: RoleKey; workstreamId?: string; reason: string; validTo?: string }) {
    const tx = this.db.tx();
    const roleDef = POLICY_MATRIX.roles[body.role];
    const scopeType = body.workstreamId ? 'workstream' : 'project';
    if (!roleDef.scopeTypes.includes(scopeType)) {
      throw ruleViolation('membership.scope_not_allowed', `Role ${body.role} cannot be granted at ${scopeType} scope (allowed: ${roleDef.scopeTypes.join(', ')})`);
    }
    const withinAuthority = this.withinGrantAuthority(ctx, projectId, body.role);
    this.policy.assert(ctx, 'admin.role_assignment.manage', { projectId, requesterUserId: body.userId, withinAuthority });
    if (body.workstreamId) {
      const [ws] = await tx.select({ id: schema.workstream.id }).from(schema.workstream).where(and(eq(schema.workstream.id, body.workstreamId), eq(schema.workstream.projectId, projectId)));
      if (!ws) throw notFound();
    }
    const [u] = await tx.select().from(schema.appUser).where(and(eq(schema.appUser.id, body.userId), eq(schema.appUser.isActive, true)));
    if (!u) throw invalid('membership.user_not_found', 'User not found or inactive');
    const id = newId();
    await tx.insert(schema.projectMembership).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      userId: body.userId,
      role: body.role,
      workstreamId: body.workstreamId ?? null,
      grantedBy: ctx.principal.userId,
      reason: body.reason,
      validTo: body.validTo ? endOfLocalDayUtc(body.validTo, await this.projectTimezone(projectId)) : null,
    });
    await this.audit.record({ action: 'admin.role_assignment.grant', entityType: 'project_membership', entityId: id, projectId, after: { userId: body.userId, role: body.role, workstreamId: body.workstreamId ?? null }, reason: body.reason });
    await this.outbox.emit({ type: 'permission.changed', projectId, aggregateType: 'app_user', aggregateId: body.userId, payload: { change: 'grant', role: body.role } });
    return { id };
  }

  async revokeMembership(ctx: RequestContext, projectId: string, membershipId: string, reason: string) {
    const tx = this.db.tx();
    const [m] = await tx.select().from(schema.projectMembership).where(and(eq(schema.projectMembership.id, membershipId), eq(schema.projectMembership.projectId, projectId)));
    if (!m || m.revokedAt) throw notFound();
    // A project manager may only revoke roles it could grant (ARCH-10a) — e.g. not a sponsor or committee chair.
    this.policy.assert(ctx, 'admin.role_assignment.manage', { projectId, requesterUserId: m.userId, withinAuthority: this.withinGrantAuthority(ctx, projectId, m.role) });
    await tx.update(schema.projectMembership).set({ revokedAt: new Date(), revokedBy: ctx.principal.userId }).where(eq(schema.projectMembership.id, membershipId));
    await this.audit.record({ action: 'admin.role_assignment.revoke', entityType: 'project_membership', entityId: membershipId, projectId, before: { userId: m.userId, role: m.role }, reason });
    await this.outbox.emit({ type: 'permission.changed', projectId, aggregateType: 'app_user', aggregateId: m.userId, payload: { change: 'revoke', role: m.role } });
  }

  private async projectTimezone(projectId: string): Promise<string> {
    const [p] = await this.db.tx().select({ tz: schema.project.timezone }).from(schema.project).where(eq(schema.project.id, projectId));
    return p?.tz ?? 'Asia/Riyadh';
  }

  private withinGrantAuthority(ctx: RequestContext, projectId: string, role: RoleKey): boolean {
    const actorScope = ctx.principal.projects.get(projectId);
    const isAdmin = ctx.principal.orgRoles.has('portfolio_admin') || ctx.principal.orgRoles.has('platform_admin') || !!actorScope?.roles.has('portfolio_admin');
    if (isAdmin) return true;
    return PM_GRANTABLE.includes(role);
  }

  async listWorkstreams(ctx: RequestContext, projectId: string) {
    this.policy.assert(ctx, 'planning.plan.read', { projectId });
    const tx = this.db.tx();
    const rows = await tx
      .select({ w: schema.workstream, leadName: schema.appUser.displayName })
      .from(schema.workstream)
      .leftJoin(schema.appUser, eq(schema.appUser.id, schema.workstream.leadUserId))
      .where(and(eq(schema.workstream.projectId, projectId), this.policy.reachSql(ctx, 'planning.plan.read', projectId, schema.workstream.id)))
      .orderBy(asc(schema.workstream.sortOrder));
    const counts = await this.db.tx().execute<{ workstream_id: string; tasks: number; risks: number; deliverables: number }>(sql`
      select w.id as workstream_id,
        (select count(*) from task t where t.workstream_id = w.id)::int as tasks,
        (select count(*) from risk r where r.workstream_id = w.id and r.status in ('open','monitoring','escalated'))::int as risks,
        (select count(*) from deliverable d where d.workstream_id = w.id)::int as deliverables
      from workstream w where w.project_id = ${projectId} and ${this.policy.reachSql(ctx, 'planning.plan.read', projectId, sql`w.id`)}`);
    const cm = new Map(counts.rows.map((c) => [c.workstream_id, c]));
    return {
      items: rows.map(({ w, leadName }) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        nameAr: w.nameAr,
        objective: w.objective,
        scope: w.scope,
        leadUserId: w.leadUserId,
        leadName: leadName ?? null,
        proposedLeadFunction: w.proposedLeadFunction,
        raci: w.raci,
        linkedGateKeys: w.linkedGateKeys,
        version: w.version,
        counts: { tasks: cm.get(w.id)?.tasks ?? 0, openRisks: cm.get(w.id)?.risks ?? 0, deliverables: cm.get(w.id)?.deliverables ?? 0 },
      })),
    };
  }

  async assignWorkstreamLead(ctx: RequestContext, projectId: string, workstreamId: string, userId: string, expectedVersion: number) {
    const tx = this.db.tx();
    const [w] = await tx.select().from(schema.workstream).where(and(eq(schema.workstream.id, workstreamId), eq(schema.workstream.projectId, projectId)));
    if (!w) throw notFound();
    this.policy.assert(ctx, 'planning.ownership.reassign', { projectId, workstreamId });
    const [u] = await tx.select().from(schema.appUser).where(and(eq(schema.appUser.id, userId), eq(schema.appUser.isActive, true)));
    if (!u) throw invalid('workstream.user_not_found', 'User not found or inactive');
    // The lead must be an active member of this project (ARCH-19): grant the membership first.
    const [m] = await tx
      .select({ id: schema.projectMembership.id })
      .from(schema.projectMembership)
      .where(and(eq(schema.projectMembership.projectId, projectId), eq(schema.projectMembership.userId, userId), isNull(schema.projectMembership.revokedAt), sql`(${schema.projectMembership.validTo} is null or ${schema.projectMembership.validTo} > now())`))
      .limit(1);
    if (!m) throw ruleViolation('workstream.lead_not_member', 'The workstream lead must be an active member of this project — grant a project role first');
    const res = await tx
      .update(schema.workstream)
      .set({ leadUserId: userId, updatedAt: new Date(), version: sql`${schema.workstream.version} + 1` })
      .where(and(eq(schema.workstream.id, workstreamId), eq(schema.workstream.version, expectedVersion)))
      .returning({ version: schema.workstream.version });
    if (!res[0]) throw conflict('concurrency.version_mismatch', 'The workstream was changed by someone else — reload and review');
    await this.audit.record({ action: 'planning.workstream.assign_lead', entityType: 'workstream', entityId: workstreamId, projectId, before: { leadUserId: w.leadUserId }, after: { leadUserId: userId } });
    return { version: res[0].version };
  }

  /**
   * Setup gaps computed from CURRENT records (QA-P1-07), never a snapshot taken at creation:
   * committee (none active), authority_matrix (none approved and in date), baseline (none approved), owners (a workstream
   * without an accountable lead), perimeter (carve-out templates only: no APPROVED perimeter version yet).
   * Dates are compared with TODAY IN THE PROJECT TIMEZONE (never the database's UTC current_date).
   */
  private async setupGaps(projectId: string, templateKind: string, today: string): Promise<string[]> {
    const r = await this.db.tx().execute<{ committee: boolean; matrix: boolean; baseline: boolean; owners: boolean; perimeter: boolean }>(sql`
      select exists (select 1 from committee where project_id = ${projectId} and status = 'active') as committee,
             exists (select 1 from authority_matrix_version where project_id = ${projectId} and status = 'approved'
                       and (effective_from is null or effective_from <= ${today}::date) and (effective_to is null or effective_to >= ${today}::date)) as matrix,
             exists (select 1 from baseline_version where project_id = ${projectId} and status = 'approved') as baseline,
             not exists (select 1 from workstream where project_id = ${projectId} and lead_user_id is null) as owners,
             exists (select 1 from perimeter_version where project_id = ${projectId} and status = 'approved') as perimeter`);
    const x = r.rows[0]!;
    const gaps: string[] = [];
    if (templateKind === 'dc_carveout' && !x.perimeter) gaps.push('perimeter');
    if (!x.committee) gaps.push('committee');
    if (!x.matrix) gaps.push('authority_matrix');
    if (!x.baseline) gaps.push('baseline');
    if (!x.owners) gaps.push('owners');
    return gaps;
  }

  /**
   * SEC-P1-03 / SEC-P1R-02: an event about a record is listed only when the caller can see the record itself — its own
   * classification / room, the visibility it INHERITS from its parent (meeting, agenda item, membership, authority matrix →
   * committee; action / escalation → decision; claim → source record; version → document; evidence link → document and
   * target; AI proposal, approval request, waiver, RAG override → target), and — for callers who are not audit readers — the
   * workstream reach of the record's read permission. Resolved inside SQL (list AND total) by RecordVisibility; applies to
   * auditors too (clearance and rooms still bind them).
   */
  private activityVisibility(ctx: RequestContext, projectId: string, canAudit: boolean): SQL {
    const ae = schema.auditEvent;
    const rv = new RecordVisibility(this.policy, ctx, projectId, {
      reach: !canAudit,
      readPermission: canAudit ? undefined : (t) => ACTIVITY_ENTITY_PERMISSION[t] ?? (EVIDENCE_TARGET_READ_PERMISSION as Record<string, string>)[t],
    });
    return rv.caseSql(ae.entityType, ae.entityId);
  }

  async activity(ctx: RequestContext, projectId: string, q: { page: number; pageSize: number; entityType?: string; entityId?: string }) {
    const tx = this.db.tx();
    const canAudit = this.policy.canInProject(ctx, 'audit.event.read', projectId);
    const conds = [eq(schema.auditEvent.projectId, projectId), eq(schema.auditEvent.outcome, 'success')];
    if (q.entityType) conds.push(eq(schema.auditEvent.entityType, q.entityType));
    if (q.entityId) conds.push(eq(schema.auditEvent.entityId, q.entityId));
    if (!canAudit) {
      const visibleTypes = Object.entries(ACTIVITY_ENTITY_PERMISSION)
        .filter(([, perm]) => this.policy.canInProject(ctx, perm, projectId))
        .map(([t]) => t);
      if (q.entityType && !visibleTypes.includes(q.entityType)) throw notFound();
      if (visibleTypes.length === 0) return { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
      conds.push(inArray(schema.auditEvent.entityType, visibleTypes));
    }
    conds.push(this.activityVisibility(ctx, projectId, canAudit));
    const where = and(...conds);
    const [{ total }] = (await tx.select({ total: count() }).from(schema.auditEvent).where(where)) as [{ total: number }];
    const rows = await tx
      .select({ e: schema.auditEvent, actor: schema.appUser.displayName })
      .from(schema.auditEvent)
      .leftJoin(schema.appUser, eq(schema.appUser.id, schema.auditEvent.actorUserId))
      .where(where)
      .orderBy(desc(schema.auditEvent.seq))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return {
      items: rows.map(({ e, actor }) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        actor: actor ?? null,
        actorKind: e.actorKind,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        outcome: e.outcome,
        // Free-text reasons may carry sensitive detail: only auditors see them in the feed.
        reason: canAudit ? e.reason : null,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(total),
    };
  }
}

function pick(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}
