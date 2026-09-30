import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  READINESS_CHECK_MACHINE,
  assertAssignedSpecialist,
  assertReadinessDetermination,
  assertReadinessSignoffAllowed,
  assertReadinessWaiverAllowed,
  conflict,
  notFound,
  ruleViolation,
  statusAfterTestRun,
  transition,
  uncoveredReadinessAreas,
  waiverIsEffective,
  ProjectTemplateDefinition,
  ReadinessArea,
  ReadinessStatus,
  RoleKey,
} from '@hub/domain';
import type { RequestContext } from '../../platform/context';
import { likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned, visibleEvidenceCounts } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import type { RouteInput, readinessRoutes } from '@hub/contracts';
import { newId } from '../../platform/ids';
import { WaiverService, WaiverRecord } from '../gates/waiver.service';
import { ReadinessSupport, iso } from './readiness.support';

type CheckRow = typeof schema.readinessCheck.$inferSelect;
type RunRow = typeof schema.readinessTestRun.$inferSelect;

/** States in which a check is cleared and needs no waiver. */
const CLEARED: ReadinessStatus[] = ['passed', 'not_applicable', 'waived'];

export interface CheckListQuery {
  page: number;
  pageSize: number;
  q?: string;
  area?: ReadinessArea;
  status?: ReadinessStatus;
  siteId?: string;
  workstreamId?: string;
  cutoverPlanId?: string;
  blocker?: 'true' | 'false';
  sort?: RouteInput<typeof readinessRoutes.listReadinessChecks>['query']['sort'];
}

/**
 * Day-1 readiness checks (spec §7.4; REQ-RDY-001/002; AT-09, AT-13): site/workstream checklists with mandatory blockers,
 * an append-only test history, specialist sign-off and specialist-determined waivability. Waivers go through the gates
 * module's generic WaiverService (this module registers the `readiness_check` resolver — no second waiver engine).
 */
@Injectable()
export class ReadinessChecksService implements OnModuleInit {
  constructor(
    private readonly s: ReadinessSupport,
    private readonly waivers: WaiverService,
  ) {}

  onModuleInit() {
    this.waivers.registerTarget({
      targetType: 'readiness_check',
      resolve: async (projectId, targetId) => {
        const c = await loadInProject(this.s.db, schema.readinessCheck, projectId, targetId);
        return {
          label: c.code,
          version: c.version,
          waivable: c.waivable,
          waiverAuthorityRole: c.waiverAuthorityRole,
          classification: null,
          requestPermission: 'gates.waiver.request',
          approvePermission: 'gates.waiver.approve',
          assertRequestable: () => {
            if (CLEARED.includes(c.status)) throw ruleViolation('readiness.waiver.not_needed', `Readiness check ${c.code} is already ${c.status}`);
          },
        };
      },
      onApproved: (ctx, projectId, w) => this.applyApprovedWaiver(ctx, projectId, w),
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Reads

  /** Read access to one check (404 when outside the caller's scope or workstream reach — existence is not leaked). */
  private async loadReadable(ctx: RequestContext, projectId: string, checkId: string): Promise<CheckRow> {
    const c = await loadInProject(this.s.db, schema.readinessCheck, projectId, checkId);
    if (!this.s.policy.can(ctx, 'readiness.register.read', { projectId, workstreamId: c.workstreamId })) throw notFound();
    return c;
  }

  /** Visibility + workstream reach predicate for lists and counts (ARCH-02 / ARCH-14). */
  scopeSql(ctx: RequestContext, projectId: string): SQL {
    const c = schema.readinessCheck;
    return and(eq(c.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, {}), this.s.policy.reachSql(ctx, 'readiness.register.read', projectId, c.workstreamId))!;
  }

  async list(ctx: RequestContext, projectId: string, q: CheckListQuery) {
    await this.s.project(projectId);
    this.s.assertListable(ctx, projectId);
    const c = schema.readinessCheck;
    const where = and(
      this.scopeSql(ctx, projectId),
      q.area ? eq(c.area, q.area) : undefined,
      q.status ? eq(c.status, q.status) : undefined,
      q.siteId ? eq(c.siteId, q.siteId) : undefined,
      q.workstreamId ? eq(c.workstreamId, q.workstreamId) : undefined,
      q.cutoverPlanId ? eq(c.cutoverPlanId, q.cutoverPlanId) : undefined,
      q.blocker ? eq(c.blocker, q.blocker === 'true') : undefined,
      q.q ? or(ilike(c.title, likeContains(q.q)), ilike(c.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(c).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: c.code, title: c.title, area: c.area, status: c.status, dueDate: c.dueDate, updatedAt: c.updatedAt }, c.id, [asc(c.code), asc(c.id)]);
    const rows = await tx.select().from(c).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return { ...pageOf(await this.dtos(ctx, projectId, rows), Number(total), q), people: await this.s.people(rows.flatMap((r) => [r.ownerUserId, r.signedOffBy])) };
  }

  async get(ctx: RequestContext, projectId: string, checkId: string) {
    const c = await this.loadReadable(ctx, projectId, checkId);
    const [dto] = await this.dtos(ctx, projectId, [c]);
    const runs = await this.s.db.tx().select().from(schema.readinessTestRun).where(eq(schema.readinessTestRun.readinessCheckId, c.id)).orderBy(asc(schema.readinessTestRun.seq));
    const p = await this.s.project(projectId);
    const ws = await this.waivers.list(projectId, 'readiness_check');
    const own = ws.filter((w) => w.targetId === c.id);
    return {
      ...dto!,
      testRuns: runs.map(runDto),
      waivers: own.map((w) => waiverDto(w, c.code, this.s.today(p))),
      people: await this.s.people([c.ownerUserId, c.createdBy, c.signedOffBy, c.waivabilityDeterminedBy, ...runs.map((r) => r.recordedBy), ...own.flatMap((w) => [w.requestedBy, w.decidedBy])]),
    };
  }

  /** Latest run per check, evidence counts and waiver effectiveness, in three set-based queries. */
  async dtos(ctx: RequestContext, projectId: string, rows: CheckRow[]) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const tx = this.s.db.tx();
    const latest = await tx
      .selectDistinctOn([schema.readinessTestRun.readinessCheckId])
      .from(schema.readinessTestRun)
      .where(and(eq(schema.readinessTestRun.projectId, projectId), inArray(schema.readinessTestRun.readinessCheckId, ids)))
      .orderBy(schema.readinessTestRun.readinessCheckId, desc(schema.readinessTestRun.seq));
    const latestBy = new Map(latest.map((r) => [r.readinessCheckId, r]));
    // Display counters: the evidence list's visibility (SEC-P1R-05); sign-off rules use the unfiltered count.
    const evidence = await visibleEvidenceCounts(this.s.db, this.s.policy, ctx, projectId, 'readiness_check', ids);
    const waiverIds = rows.map((r) => r.waiverId).filter((x): x is string => !!x);
    const ws = waiverIds.length ? await tx.select().from(schema.waiver).where(and(eq(schema.waiver.projectId, projectId), inArray(schema.waiver.id, waiverIds))) : [];
    const wBy = new Map(ws.map((w) => [w.id, w]));
    const today = this.s.today(await this.s.project(projectId));
    return rows.map((c) => {
      const w = c.waiverId ? wBy.get(c.waiverId) : undefined;
      const run = latestBy.get(c.id);
      return {
        id: c.id,
        code: c.code,
        area: c.area,
        title: c.title,
        titleAr: c.titleAr,
        siteId: c.siteId,
        workstreamId: c.workstreamId,
        cutoverPlanId: c.cutoverPlanId,
        ownerUserId: c.ownerUserId,
        templateKey: c.templateKey,
        mandatory: c.mandatory,
        blocker: c.blocker,
        waivable: c.waivable,
        waiverAuthorityRole: c.waiverAuthorityRole,
        waivabilityBasis: c.waivabilityBasis,
        waivabilityDeterminedBy: c.waivabilityDeterminedBy,
        waivabilityDeterminedAt: iso(c.waivabilityDeterminedAt),
        waiverId: c.waiverId,
        waiverEffective: waiverEffectiveFor(c, w, today),
        status: c.status,
        signoffRole: c.signoffRole,
        signedOffBy: c.signedOffBy,
        signedOffAt: iso(c.signedOffAt),
        signoffNote: c.signoffNote,
        testResult: c.testResult,
        failureContingency: c.failureContingency,
        dueDate: c.dueDate,
        latestTest: run ? runDto(run) : null,
        evidence: evidence.get(c.id) ?? { active: 0, conflicting: 0 },
        isDemo: c.isDemo,
        createdAt: c.createdAt.toISOString(),
        createdBy: c.createdBy,
        version: c.version,
      };
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Commands

  private assertManage(ctx: RequestContext, projectId: string, c: Pick<CheckRow, 'workstreamId' | 'ownerUserId' | 'createdBy'>) {
    this.s.policy.assert(ctx, 'readiness.check.manage', { projectId, workstreamId: c.workstreamId, ownerUserIds: [c.ownerUserId, c.createdBy] });
  }

  async create(
    ctx: RequestContext,
    projectId: string,
    body: {
      area: ReadinessArea;
      title: string;
      titleAr?: string | null;
      siteId?: string | null;
      workstreamId?: string | null;
      cutoverPlanId?: string | null;
      ownerUserId?: string | null;
      testResult?: string | null;
      failureContingency?: string | null;
      dueDate?: string | null;
      mandatory: boolean;
      blocker: boolean;
      signoffRole?: RoleKey | null;
    },
  ) {
    const p = await this.s.project(projectId);
    // For a create the actor is the creator; a workstream-scoped grant covers only its own workstream.
    this.s.policy.assert(ctx, 'readiness.check.manage', { projectId, workstreamId: body.workstreamId ?? null, ownerUserIds: [ctx.principal.userId] });
    await this.s.assertRefs(ctx, projectId, { siteId: body.siteId, workstreamId: body.workstreamId, cutoverPlanId: body.cutoverPlanId });
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId, 'ownerUserId');
    const id = newId();
    const code = await nextCode(this.s.db, schema.readinessCheck, projectId, 'RC');
    await this.s.db
      .tx()
      .insert(schema.readinessCheck)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        code,
        area: body.area,
        title: body.title,
        titleAr: body.titleAr ?? null,
        siteId: body.siteId ?? null,
        workstreamId: body.workstreamId ?? null,
        cutoverPlanId: body.cutoverPlanId ?? null,
        ownerUserId: body.ownerUserId ?? null,
        mandatory: body.mandatory,
        blocker: body.blocker,
        signoffRole: body.signoffRole ?? null,
        testResult: body.testResult ?? null,
        failureContingency: body.failureContingency ?? null,
        dueDate: body.dueDate ?? null,
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      });
    await this.s.audit.record({
      action: 'readiness.check.create',
      entityType: 'readiness_check',
      entityId: id,
      projectId,
      after: { code, area: body.area, mandatory: body.mandatory, blocker: body.blocker, signoffRole: body.signoffRole ?? null, siteId: body.siteId ?? null, workstreamId: body.workstreamId ?? null, cutoverPlanId: body.cutoverPlanId ?? null },
    });
    await this.s.enqueueDimensions(ctx, projectId, `check:${id}:1`);
    return { id, code, version: 1 };
  }

  /** REQ-RDY-002: the project template's default Day-1 checklist, idempotent per template check and site. */
  async instantiate(ctx: RequestContext, projectId: string, body: { siteId?: string | null; workstreamId?: string | null; cutoverPlanId?: string | null; areas?: ReadinessArea[] }) {
    const p = await this.s.project(projectId);
    this.s.policy.assert(ctx, 'readiness.check.manage', { projectId, workstreamId: body.workstreamId ?? null, ownerUserIds: [ctx.principal.userId] });
    await this.s.assertRefs(ctx, projectId, { siteId: body.siteId, workstreamId: body.workstreamId, cutoverPlanId: body.cutoverPlanId });
    const [tv] = await this.s.db
      .tx()
      .select({ definition: schema.projectTemplateVersion.definition })
      .from(schema.projectTemplateVersion)
      .where(eq(schema.projectTemplateVersion.id, p.templateVersionId));
    const def = (tv?.definition ?? {}) as unknown as ProjectTemplateDefinition;
    const areas = (def.readinessAreas ?? []).filter((a) => !body.areas || body.areas.includes(a.key as ReadinessArea));
    let created = 0;
    let existing = 0;
    const c = schema.readinessCheck;
    for (const area of areas) {
      for (const d of area.defaultChecks) {
        // The project factory creates the project-level defaults with code `<area>-<key>` (no template_key): recognise both.
        const factoryCode = `${area.key}-${d.key}`.slice(0, 32);
        const [found] = await this.s.db
          .tx()
          .select({ id: c.id })
          .from(c)
          .where(
            and(
              eq(c.projectId, projectId),
              body.siteId ? and(eq(c.siteId, body.siteId), eq(c.templateKey, d.key)) : and(isNull(c.siteId), or(eq(c.templateKey, d.key), and(isNull(c.templateKey), eq(c.code, factoryCode)))),
            ),
          );
        if (found) {
          existing++;
          continue;
        }
        const id = newId();
        const code = await nextCode(this.s.db, c, projectId, 'RC');
        await this.s.db
          .tx()
          .insert(c)
          .values({
            id,
            orgId: ctx.principal.orgId,
            projectId,
            code,
            area: area.key as ReadinessArea,
            title: d.title.en,
            titleAr: d.title.ar,
            siteId: body.siteId ?? null,
            workstreamId: body.workstreamId ?? null,
            cutoverPlanId: body.cutoverPlanId ?? null,
            templateKey: d.key,
            mandatory: d.mandatory,
            blocker: d.blocker,
            signoffRole: d.signoffRole,
            isDemo: p.isDemo,
            createdBy: ctx.principal.userId,
          });
        created++;
      }
    }
    const covered = await this.s.db.tx().selectDistinct({ area: c.area }).from(c).where(eq(c.projectId, projectId));
    const uncovered = uncoveredReadinessAreas(covered.map((r) => r.area));
    await this.s.audit.record({
      action: 'readiness.check.instantiate',
      entityType: 'project',
      entityId: projectId,
      projectId,
      after: { created, existing, siteId: body.siteId ?? null, workstreamId: body.workstreamId ?? null, areas: areas.map((a) => a.key), uncoveredAreas: uncovered },
    });
    if (created > 0) await this.s.enqueueDimensions(ctx, projectId, `instantiate:${ctx.correlationId}`);
    return { created, existing, areas: areas.map((a) => a.key as ReadinessArea), uncoveredAreas: uncovered };
  }

  async update(
    ctx: RequestContext,
    projectId: string,
    checkId: string,
    body: { expectedVersion: number; title?: string; titleAr?: string | null; siteId?: string | null; workstreamId?: string | null; cutoverPlanId?: string | null; ownerUserId?: string | null; testResult?: string | null; failureContingency?: string | null; dueDate?: string | null },
  ) {
    const c = await loadInProject(this.s.db, schema.readinessCheck, projectId, checkId);
    this.assertManage(ctx, projectId, c);
    const { expectedVersion, ...changes } = body;
    const current = c as unknown as Record<string, unknown>;
    const effective = Object.fromEntries(Object.entries(changes).filter(([k, v]) => v !== undefined && current[k] !== v));
    // A request that changes nothing is not a write: no version bump, no audit row (QA-P1-12 convention).
    if (Object.keys(effective).length === 0) {
      if (c.version !== expectedVersion) throw conflict('concurrency.version_mismatch', 'The readiness check was changed by someone else — reload and review', { expectedVersion, currentVersion: c.version });
      return { id: c.id, version: c.version };
    }
    if ('workstreamId' in effective && effective['workstreamId']) {
      // Moving a check into a workstream requires manage rights there too.
      this.s.policy.assert(ctx, 'readiness.check.manage', { projectId, workstreamId: effective['workstreamId'] as string, ownerUserIds: [c.ownerUserId, c.createdBy] });
    }
    await this.s.assertRefs(ctx, projectId, { siteId: effective['siteId'] as string | undefined, workstreamId: effective['workstreamId'] as string | undefined, cutoverPlanId: effective['cutoverPlanId'] as string | undefined });
    if (effective['ownerUserId']) await this.s.assertMember(projectId, effective['ownerUserId'] as string, 'ownerUserId');
    const row = (await updateVersioned(this.s.db, schema.readinessCheck, { id: c.id, projectId, expectedVersion }, effective)) as CheckRow;
    await this.s.audit.record({
      action: 'readiness.check.update',
      entityType: 'readiness_check',
      entityId: c.id,
      projectId,
      before: Object.fromEntries(Object.keys(effective).map((k) => [k, current[k]])),
      after: effective,
    });
    if ('siteId' in effective || 'cutoverPlanId' in effective || 'workstreamId' in effective) await this.s.enqueueDimensions(ctx, projectId, `check:${c.id}:${row.version}`);
    return { id: c.id, version: row.version };
  }

  /** Specialist determination of criticality and waivability (spec §3; the waiver authority role is set here). */
  async determine(
    ctx: RequestContext,
    projectId: string,
    checkId: string,
    body: { expectedVersion: number; mandatory: boolean; blocker: boolean; waivable: boolean; waiverAuthorityRole: RoleKey | null; basis: string },
  ) {
    const c = await loadInProject(this.s.db, schema.readinessCheck, projectId, checkId);
    this.s.policy.assert(ctx, 'readiness.check.signoff', { projectId, workstreamId: c.workstreamId, requesterUserId: c.createdBy });
    assertReadinessDetermination({
      checkCode: c.code,
      signoffRole: c.signoffRole,
      actorRoles: this.s.rolesOf(ctx, projectId, c.workstreamId),
      actorUserId: ctx.principal.userId!,
      creatorUserId: c.createdBy,
      waivable: body.waivable,
      waiverAuthorityRole: body.waiverAuthorityRole,
      basis: body.basis,
    });
    if (c.status === 'waived' && !body.waivable) {
      throw ruleViolation('readiness.determination.waived_check', `${c.code} is waived; reopen it before determining it non-waivable`);
    }
    const row = (await updateVersioned(this.s.db, schema.readinessCheck, { id: c.id, projectId, expectedVersion: body.expectedVersion }, {
      mandatory: body.mandatory,
      blocker: body.blocker,
      waivable: body.waivable,
      waiverAuthorityRole: body.waiverAuthorityRole,
      waivabilityBasis: body.basis,
      waivabilityDeterminedBy: ctx.principal.userId,
      waivabilityDeterminedAt: this.s.clock.now(),
    })) as CheckRow;
    await this.s.audit.record({
      action: 'readiness.check.determine',
      entityType: 'readiness_check',
      entityId: c.id,
      projectId,
      before: { mandatory: c.mandatory, blocker: c.blocker, waivable: c.waivable, waiverAuthorityRole: c.waiverAuthorityRole },
      after: { mandatory: body.mandatory, blocker: body.blocker, waivable: body.waivable, waiverAuthorityRole: body.waiverAuthorityRole },
      reason: body.basis,
    });
    await this.s.enqueueDimensions(ctx, projectId, `check:${c.id}:${row.version}`);
    return { id: c.id, version: row.version };
  }

  /** Append a test run (the run table is append-only in the database). A failed blocker blocks GO (AT-09). */
  async recordTest(ctx: RequestContext, projectId: string, checkId: string, body: { expectedVersion: number; result: 'passed' | 'failed'; note?: string }) {
    const c = await loadInProject(this.s.db, schema.readinessCheck, projectId, checkId);
    this.assertManage(ctx, projectId, c);
    const to = statusAfterTestRun(c.status, body.result);
    const row = (await updateVersioned(this.s.db, schema.readinessCheck, { id: c.id, projectId, expectedVersion: body.expectedVersion }, {
      status: to,
      testResult: `${body.result}${body.note ? `: ${body.note}` : ''}`.slice(0, 4000),
      // A regression invalidates the earlier sign-off (kept in the audit trail).
      ...(to === 'failed' && c.status === 'passed' ? { signedOffBy: null, signedOffAt: null } : {}),
    })) as CheckRow;
    const [{ n }] = (await this.s.db.tx().select({ n: sql<number>`coalesce(max(${schema.readinessTestRun.seq}), 0)::int` }).from(schema.readinessTestRun).where(eq(schema.readinessTestRun.readinessCheckId, c.id))) as [{ n: number }];
    const runId = newId();
    const seq = n + 1;
    await this.s.db.tx().insert(schema.readinessTestRun).values({ id: runId, orgId: ctx.principal.orgId, projectId, readinessCheckId: c.id, result: body.result, note: body.note ?? null, recordedBy: ctx.principal.userId!, seq });
    await this.s.audit.record({
      action: 'readiness.check.test',
      entityType: 'readiness_check',
      entityId: c.id,
      projectId,
      before: { status: c.status },
      after: { status: to, result: body.result, seq, blocker: c.blocker, mandatory: c.mandatory },
      reason: body.note ?? null,
    });
    if (to !== c.status) await this.s.enqueueDimensions(ctx, projectId, `check:${c.id}:${row.version}`);
    return { id: c.id, status: to, version: row.version, testRunId: runId, seq };
  }

  /** REQ-RDY-001: specialist sign-off (assigned role; not the owner / latest recorder; evidence-based). */
  async signOff(ctx: RequestContext, projectId: string, checkId: string, body: { expectedVersion: number; outcome: 'passed' | 'not_applicable'; note?: string }) {
    const c = await loadInProject(this.s.db, schema.readinessCheck, projectId, checkId);
    const latest = await this.latestRun(c.id);
    this.s.policy.assert(ctx, 'readiness.check.signoff', { projectId, workstreamId: c.workstreamId, requesterUserId: latest?.recordedBy ?? c.createdBy });
    const ev = await this.s.evidence(projectId, 'readiness_check', c.id);
    assertReadinessSignoffAllowed({
      checkCode: c.code,
      outcome: body.outcome,
      signoffRole: c.signoffRole,
      actorRoles: this.s.rolesOf(ctx, projectId, c.workstreamId),
      actorUserId: ctx.principal.userId!,
      selfUserIds: [c.ownerUserId, c.createdBy, latest?.recordedBy],
      latestTestResult: latest?.result ?? null,
      activeEvidenceCount: ev.active,
      conflictingEvidenceCount: ev.conflicting,
      note: body.note,
    });
    const to = transition('readiness_check', READINESS_CHECK_MACHINE, c.status, body.outcome === 'passed' ? 'sign_off' : 'determine_not_applicable');
    const row = (await updateVersioned(this.s.db, schema.readinessCheck, { id: c.id, projectId, expectedVersion: body.expectedVersion }, {
      status: to,
      signedOffBy: ctx.principal.userId,
      signedOffAt: this.s.clock.now(),
      signoffNote: body.note ?? null,
    })) as CheckRow;
    await this.s.audit.record({
      action: 'readiness.check.signoff',
      entityType: 'readiness_check',
      entityId: c.id,
      projectId,
      before: { status: c.status },
      after: { status: to, outcome: body.outcome, signoffRole: c.signoffRole, activeEvidence: ev.active, latestTest: latest?.result ?? null },
      reason: body.note ?? null,
    });
    await this.s.enqueueDimensions(ctx, projectId, `check:${c.id}:${row.version}`);
    return { id: c.id, status: to, version: row.version };
  }

  async reopen(ctx: RequestContext, projectId: string, checkId: string, body: { expectedVersion: number; note: string }) {
    const c = await loadInProject(this.s.db, schema.readinessCheck, projectId, checkId);
    // Reopening is not an approval of someone's request: role-level check (no separation-of-duties subject), I-R3.
    this.s.policy.assertGranted(ctx, 'readiness.check.signoff', { projectId, workstreamId: c.workstreamId });
    assertAssignedSpecialist('reopening', c.code, c.signoffRole, this.s.rolesOf(ctx, projectId, c.workstreamId));
    const to = transition('readiness_check', READINESS_CHECK_MACHINE, c.status, 'reopen');
    const row = (await updateVersioned(this.s.db, schema.readinessCheck, { id: c.id, projectId, expectedVersion: body.expectedVersion }, {
      status: to,
      signedOffBy: null,
      signedOffAt: null,
      waiverId: null,
    })) as CheckRow;
    await this.s.audit.record({ action: 'readiness.check.reopen', entityType: 'readiness_check', entityId: c.id, projectId, before: { status: c.status, waiverId: c.waiverId, signedOffBy: c.signedOffBy }, after: { status: to }, reason: body.note });
    await this.s.enqueueDimensions(ctx, projectId, `check:${c.id}:${row.version}`);
    return { id: c.id, status: to, version: row.version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Waivers (gates WaiverService; this module owns only the readiness_check target)

  async requestWaiver(ctx: RequestContext, projectId: string, checkId: string, body: { basis: string; impact: string; conditions?: string; expiresOn?: string }) {
    const c = await this.loadReadable(ctx, projectId, checkId);
    const w = await this.waivers.request(ctx, projectId, 'readiness_check', c.id, body);
    return waiverDto(w, c.code, this.s.today(await this.s.project(projectId)));
  }

  async listWaivers(ctx: RequestContext, projectId: string, status?: string) {
    const p = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId);
    const rows = await this.waivers.list(projectId, 'readiness_check', status);
    const visible = rows.length
      ? await this.s.db
          .tx()
          .select({ id: schema.readinessCheck.id, code: schema.readinessCheck.code })
          .from(schema.readinessCheck)
          .where(and(this.scopeSql(ctx, projectId), inArray(schema.readinessCheck.id, [...new Set(rows.map((w) => w.targetId))])))
      : [];
    const codes = new Map(visible.map((v) => [v.id, v.code]));
    const today = this.s.today(p);
    const items = rows.filter((w) => codes.has(w.targetId));
    return { items: items.map((w) => waiverDto(w, codes.get(w.targetId)!, today)), people: await this.s.people(items.flatMap((w) => [w.requestedBy, w.decidedBy])) };
  }

  async approveWaiver(ctx: RequestContext, projectId: string, waiverId: string, body: { expectedVersion: number; note?: string }) {
    const w = await this.waivers.approve(ctx, projectId, waiverId, body, 'readiness_check');
    return this.waiverResult(projectId, w);
  }

  async rejectWaiver(ctx: RequestContext, projectId: string, waiverId: string, body: { expectedVersion: number; note: string }) {
    const w = await this.waivers.reject(ctx, projectId, waiverId, body, 'readiness_check');
    return this.waiverResult(projectId, w);
  }

  private async waiverResult(projectId: string, w: WaiverRecord) {
    const c = await loadInProject(this.s.db, schema.readinessCheck, projectId, w.targetId);
    return waiverDto(w, c.code, this.s.today(await this.s.project(projectId)));
  }

  /**
   * Applied inside the waiver approval transaction: re-check the readiness waiver rule (N-02: specialist-set authority
   * role held by the approver, not the requester, basis AND impact) and mark the check waived with the waiver reference.
   */
  private async applyApprovedWaiver(ctx: RequestContext, projectId: string, w: WaiverRecord) {
    const c = await loadInProject(this.s.db, schema.readinessCheck, projectId, w.targetId);
    assertReadinessWaiverAllowed({
      checkCode: c.code,
      waivable: c.waivable,
      blocker: c.blocker,
      waiverAuthorityRole: c.waiverAuthorityRole,
      approverRoles: this.s.rolesOf(ctx, projectId, c.workstreamId),
      approverUserId: ctx.principal.userId!,
      requesterUserId: w.requestedBy,
      basis: w.basis,
      impact: w.impact,
    });
    const to = transition('readiness_check', READINESS_CHECK_MACHINE, c.status, 'apply_waiver');
    const row = (await updateVersioned(this.s.db, schema.readinessCheck, { id: c.id, projectId, expectedVersion: c.version }, { status: to, waiverId: w.id })) as CheckRow;
    await this.s.audit.record({
      action: 'readiness.check.waiver_applied',
      entityType: 'readiness_check',
      entityId: c.id,
      projectId,
      before: { status: c.status, waiverId: c.waiverId },
      after: { status: to, waiverId: w.id, authorityRole: c.waiverAuthorityRole, basis: w.basis, impact: w.impact },
    });
    await this.s.enqueueDimensions(ctx, projectId, `check:${c.id}:${row.version}`);
  }

  private async latestRun(checkId: string): Promise<RunRow | null> {
    const [r] = await this.s.db.tx().select().from(schema.readinessTestRun).where(eq(schema.readinessTestRun.readinessCheckId, checkId)).orderBy(desc(schema.readinessTestRun.seq)).limit(1);
    return r ?? null;
  }
}

export function runDto(r: RunRow) {
  return { id: r.id, seq: r.seq, result: r.result, note: r.note, recordedBy: r.recordedBy, recordedAt: r.recordedAt.toISOString() };
}

/** A waiver counts only when the check is (still) waivable and the linked waiver is approved and unexpired (D-02). */
export function waiverEffectiveFor(c: Pick<CheckRow, 'waivable' | 'waiverId' | 'id'>, w: WaiverRecord | undefined | null, today: string): boolean {
  return !!w && c.waivable && w.targetType === 'readiness_check' && w.targetId === c.id && waiverIsEffective(w, today);
}

export function waiverDto(w: WaiverRecord, checkCode: string | null, today: string) {
  return {
    id: w.id,
    checkId: w.targetId,
    checkCode,
    basis: w.basis,
    impact: w.impact,
    conditions: w.conditions,
    expiresOn: w.expiresOn,
    status: w.status,
    authorityRole: w.authorityRole,
    requestedBy: w.requestedBy,
    decidedBy: w.decidedBy,
    decidedAt: iso(w.decidedAt),
    decisionNote: w.decisionNote,
    effective: waiverIsEffective(w, today),
    isDemo: w.isDemo,
    createdAt: w.createdAt.toISOString(),
    version: w.version,
  };
}
