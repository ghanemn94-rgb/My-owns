import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  assertUpgradeTarget,
  conflict,
  notFound,
  ruleViolation,
  templateUpgradePlan,
  type Classification,
  type ProjectTemplateDefinition,
  type ProjectTemplateFootprint,
  type TemplateUpgradePlan,
} from '@hub/domain';
import type { RouteInput, configRoutes } from '@hub/contracts';
import { assertVersion, loadInProject } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId, payloadHash } from '../../platform/ids';
import { GatesService } from '../gates/gates.service';
import { StatusDimensionsService } from '../gates/status-dimensions.service';
import { ProjectFactory, type CreatedCounts } from '../portfolio/project-factory.service';
import { ConfigSupport, iso, type PinnedProject } from './config.support';
import { RagThresholdsReader } from './rag-thresholds.reader';

type R = typeof configRoutes;
type MigrationRow = typeof schema.projectTemplateMigration.$inferSelect;
const M = schema.projectTemplateMigration;
const LOCK = 'config.template_upgrade';

/** What the migration row's `preview` holds: the plan the approver decides on, its hash, the reason, the decision note and the result. */
interface StoredPreview {
  plan: TemplateUpgradePlan;
  planHash: string;
  reason: string;
  decisionNote?: string | null;
  result?: CreatedCounts | null;
}

/**
 * Template upgrades (spec §5 "updates require preview and approval and must not silently reshape existing projects",
 * REQ-ENT-009, AT-26). A project stays pinned to its template version. A newer published version of the same template is
 * PREVIEWED per project (what would be created, what is kept as it is, which texts change), PROPOSED by the project manager
 * or a portfolio admin with the hash of the preview they reviewed, and APPLIED only when another person (the sponsor —
 * `config.template_migration.approve`, not the proposer) approves exactly that plan: the approval re-computes the plan and
 * refuses (409) a plan that no longer matches the project or the template. Applying creates only the NEW elements of the
 * new version; existing records are never changed or removed (changes go through each module's own commands).
 */
@Injectable()
export class TemplateUpgradesService {
  constructor(
    private readonly s: ConfigSupport,
    private readonly factory: ProjectFactory,
    private readonly gates: GatesService,
    private readonly dimensions: StatusDimensionsService,
    private readonly thresholds: RagThresholdsReader,
  ) {}

  private async footprint(projectId: string): Promise<ProjectTemplateFootprint> {
    const tx = this.s.db.tx();
    const gates = await tx.select({ k: schema.gateDefinition.key }).from(schema.gateDefinition).where(eq(schema.gateDefinition.projectId, projectId));
    const ws = await tx.select({ k: schema.workstream.templateKey, c: schema.workstream.code }).from(schema.workstream).where(eq(schema.workstream.projectId, projectId));
    const tasks = await tx
      .select({ k: schema.task.templateActivityId })
      .from(schema.task)
      .where(and(eq(schema.task.projectId, projectId), isNotNull(schema.task.templateActivityId)));
    const ms = await tx.select({ k: schema.milestone.code }).from(schema.milestone).where(eq(schema.milestone.projectId, projectId));
    const kpis = await tx.select({ k: schema.kpi.key }).from(schema.kpi).where(eq(schema.kpi.projectId, projectId));
    const inForce = await this.thresholds.inForce(projectId);
    return {
      gateKeys: gates.map((g) => g.k),
      workstreamKeys: ws.map((w) => w.k ?? w.c),
      activityIds: [...tasks.map((t) => t.k!), ...ms.map((m) => m.k)],
      kpiKeys: kpis.map((k) => k.k),
      hasApprovedRagThresholds: inForce.ref.source === 'approved',
    };
  }

  private async version(id: string) {
    const [v] = await this.s.db.tx().select().from(schema.projectTemplateVersion).where(eq(schema.projectTemplateVersion.id, id));
    return v ?? null;
  }

  /** The plan (and its hash) of moving the project from its pinned version to `toVersionId`, from current records. */
  private async plan(pin: PinnedProject, toVersionId: string): Promise<{ plan: TemplateUpgradePlan; planHash: string; to: NonNullable<Awaited<ReturnType<TemplateUpgradesService['version']>>> }> {
    const to = await this.version(toVersionId);
    if (!to) throw notFound();
    assertUpgradeTarget({ templateId: pin.templateId, versionNo: pin.versionNo }, { templateId: to.templateId, versionNo: to.versionNo, status: to.status });
    const plan = templateUpgradePlan(pin.def, to.definition as unknown as ProjectTemplateDefinition, { templateKey: pin.templateKey, fromVersionNo: pin.versionNo, toVersionNo: to.versionNo }, await this.footprint(pin.p.id));
    return { plan, planHash: payloadHash({ fromVersionId: pin.p.templateVersionId, toVersionId: to.id, plan }), to };
  }

  private async dto(pin: PinnedProject, rows: MigrationRow[]) {
    const versions = await this.s.db
      .tx()
      .select({ id: schema.projectTemplateVersion.id, no: schema.projectTemplateVersion.versionNo })
      .from(schema.projectTemplateVersion)
      .where(inArray(schema.projectTemplateVersion.id, [...new Set(rows.flatMap((r) => [r.fromVersionId, r.toVersionId]))].concat(pin.p.templateVersionId)));
    const vno = new Map(versions.map((v) => [v.id, v.no]));
    const names = await this.s.userNames(rows.flatMap((r) => [r.proposedBy, r.decidedBy]));
    const out = [];
    for (const r of rows) {
      const pv = r.preview as unknown as StoredPreview;
      let current = true;
      if (r.status === 'proposed') {
        current = r.fromVersionId === pin.p.templateVersionId;
        if (current) {
          try {
            current = (await this.plan(pin, r.toVersionId)).planHash === pv.planHash;
          } catch {
            current = false;
          }
        }
      }
      out.push({
        id: r.id,
        fromVersionId: r.fromVersionId,
        fromVersionNo: vno.get(r.fromVersionId) ?? pv.plan.fromVersionNo,
        toVersionId: r.toVersionId,
        toVersionNo: vno.get(r.toVersionId) ?? pv.plan.toVersionNo,
        status: r.status,
        plan: pv.plan,
        planHash: pv.planHash,
        reason: pv.reason ?? null,
        proposedBy: r.proposedBy,
        proposedByName: r.proposedBy ? (names.get(r.proposedBy) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        decidedBy: r.decidedBy,
        decidedByName: r.decidedBy ? (names.get(r.decidedBy) ?? null) : null,
        decidedAt: iso(r.decidedAt),
        decisionNote: pv.decisionNote ?? null,
        appliedAt: iso(r.appliedAt),
        result: pv.result ?? null,
        current,
        version: r.version,
      });
    }
    return out;
  }

  async list(ctx: RequestContext, projectId: string) {
    const pin = await this.s.pinned(projectId);
    this.s.assertProject(ctx, 'config.template.read', pin.p);
    const newer = await this.s.db
      .tx()
      .select({ id: schema.projectTemplateVersion.id, no: schema.projectTemplateVersion.versionNo, publishedAt: schema.projectTemplateVersion.publishedAt })
      .from(schema.projectTemplateVersion)
      .where(and(eq(schema.projectTemplateVersion.templateId, pin.templateId), eq(schema.projectTemplateVersion.status, 'published'), gt(schema.projectTemplateVersion.versionNo, pin.versionNo)))
      .orderBy(asc(schema.projectTemplateVersion.versionNo));
    const rows = await this.s.db.tx().select().from(M).where(eq(M.projectId, projectId)).orderBy(desc(M.createdAt), desc(M.id));
    return {
      current: { templateId: pin.templateId, templateKey: pin.templateKey, kind: pin.templateKind, name: pin.templateName, nameAr: pin.def.name?.ar || null, versionId: pin.p.templateVersionId, versionNo: pin.versionNo },
      available: newer.map((v) => ({ versionId: v.id, versionNo: v.no, publishedAt: iso(v.publishedAt) })),
      items: await this.dto(pin, rows),
    };
  }

  async preview(ctx: RequestContext, projectId: string, body: RouteInput<R['previewTemplateUpgrade']>['body']) {
    const pin = await this.s.pinned(projectId);
    this.s.assertProject(ctx, 'config.template.read', pin.p);
    const { plan, planHash } = await this.plan(pin, body.toVersionId);
    return { toVersionId: body.toVersionId, plan, planHash };
  }

  async get(ctx: RequestContext, projectId: string, upgradeId: string) {
    const pin = await this.s.pinned(projectId);
    this.s.assertProject(ctx, 'config.template.read', pin.p);
    const m = await loadInProject(this.s.db, M, projectId, upgradeId);
    return (await this.dto(pin, [m]))[0]!;
  }

  async propose(ctx: RequestContext, projectId: string, body: RouteInput<R['proposeTemplateUpgrade']>['body']) {
    const pin = await this.s.pinned(projectId, { lock: true });
    this.s.assertProject(ctx, 'config.template_migration.propose', pin.p);
    await this.s.lock(LOCK, projectId);
    const [open] = await this.s.db.tx().select({ id: M.id }).from(M).where(and(eq(M.projectId, projectId), eq(M.status, 'proposed')));
    if (open) throw conflict('config.template_upgrade.proposal_pending', 'Another template upgrade of this project awaits a decision', { pendingId: open.id });
    const { plan, planHash, to } = await this.plan(pin, body.toVersionId);
    // The proposer proposes the plan they reviewed: a preview that no longer matches is refused (reload the preview).
    if (planHash !== body.planHash) throw conflict('config.template_upgrade.preview_changed', 'The project or the template changed since this preview — preview again before proposing', { planHash });
    const id = newId();
    const preview: StoredPreview = { plan, planHash, reason: body.reason };
    await this.s.db
      .tx()
      .insert(M)
      .values({ id, orgId: ctx.principal.orgId, projectId, fromVersionId: pin.p.templateVersionId, toVersionId: to.id, preview: preview as unknown as Record<string, unknown>, status: 'proposed', proposedBy: ctx.principal.userId });
    await this.s.audit.record({
      action: 'config.template_upgrade.propose',
      entityType: 'project_template_migration',
      entityId: id,
      projectId,
      after: { fromVersionNo: pin.versionNo, toVersionNo: to.versionNo, planHash, add: counts(plan), kept: plan.keep.length },
      reason: body.reason,
    });
    await this.s.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'project_template_migration', aggregateId: id, payload: { kind: 'template_upgrade', fromVersionNo: pin.versionNo, toVersionNo: to.versionNo } });
    return this.get(ctx, projectId, id);
  }

  /** Role → state → separation of duties (the proposer never approves), then optimistic concurrency. */
  private async loadForDecision(ctx: RequestContext, projectId: string, upgradeId: string, expectedVersion: number) {
    const pin = await this.s.pinned(projectId, { lock: true });
    await this.s.lock(LOCK, projectId);
    const m = await loadInProject(this.s.db, M, projectId, upgradeId);
    this.s.policy.assertApproval(
      ctx,
      'config.template_migration.approve',
      // authority (explicit, I-R3): a template upgrade carries no amount or delegated mandate — the approving role's grant
      // (sponsor) is the authority; separation of duties applies to the proposer.
      { projectId, classification: pin.p.classification as Classification, requesterUserId: m.proposedBy, withinAuthority: true },
      () => {
        if (m.status !== 'proposed') throw ruleViolation('config.template_upgrade.invalid_transition', `The template upgrade is ${m.status} — only a proposed upgrade can be decided`, { current: m.status });
      },
    );
    assertVersion(m, expectedVersion, 'template upgrade');
    return { pin, m, pv: m.preview as unknown as StoredPreview };
  }

  async approve(ctx: RequestContext, projectId: string, upgradeId: string, body: RouteInput<R['approveTemplateUpgrade']>['body']) {
    const { pin, m, pv } = await this.loadForDecision(ctx, projectId, upgradeId, body.expectedVersion);
    // The approval binds to the plan the approver saw: the project must still be on the version the plan starts from, and
    // the plan re-computed now must be identical (no element added meanwhile, no other template change).
    if (m.fromVersionId !== pin.p.templateVersionId) throw conflict('config.template_upgrade.preview_stale', 'The project is no longer on the version this upgrade starts from — reject it and propose again');
    const { plan, planHash, to } = await this.plan(pin, m.toVersionId);
    if (planHash !== pv.planHash) throw conflict('config.template_upgrade.preview_stale', 'The project or the template changed since the preview the approval refers to — reject it and propose again', { planHash });
    const toDef = to.definition as unknown as ProjectTemplateDefinition;
    // One writer of the project's gate state (module guide): take the gate lock before any gate write, refresh after.
    if (plan.add.gates.length) await this.gates.refreshEvaluations(projectId);
    const result = await this.factory.applyAdditions({
      orgId: pin.p.orgId,
      projectId,
      def: toDef,
      isDemo: pin.p.isDemo,
      createdBy: ctx.principal.userId,
      add: { workstreams: plan.add.workstreams.map((w) => w.key), gates: plan.add.gates.map((g) => g.key), activities: plan.add.activities.map((a) => a.id), kpis: plan.add.kpis.map((k) => k.key) },
    });
    // Re-pin the project (explicit command; the project row is locked).
    const now = this.s.clock.now();
    const upd = await this.s.db
      .tx()
      .update(schema.project)
      .set({ templateVersionId: to.id, updatedAt: now, version: pin.p.version + 1 })
      .where(and(eq(schema.project.id, projectId), eq(schema.project.version, pin.p.version)))
      .returning({ id: schema.project.id });
    if (!upd[0]) throw conflict('concurrency.version_mismatch', 'The project was changed by someone else — reload and review');
    if (plan.add.gates.length) await this.gates.refreshEvaluations(projectId);
    if (plan.statusDimensionsAdded.length) await this.dimensions.recomputeDimensions(projectId);
    const stored: StoredPreview = { ...pv, decisionNote: body.note ?? null, result };
    const res = await this.s.db
      .tx()
      .update(M)
      .set({ status: 'applied', decidedBy: ctx.principal.userId, decidedAt: now, appliedAt: now, preview: stored as unknown as Record<string, unknown>, version: m.version + 1 })
      .where(and(eq(M.id, upgradeId), eq(M.projectId, projectId), eq(M.version, m.version)))
      .returning({ id: M.id });
    if (!res[0]) throw conflict('concurrency.version_mismatch', 'The template upgrade was changed by someone else — reload and review');
    await this.s.versions.snapshot({ projectId, entityType: 'project_template_migration', entityId: upgradeId, versionNo: m.version + 1, snapshot: { status: 'applied', fromVersionNo: pin.versionNo, toVersionNo: to.versionNo, planHash, result }, reason: 'approved and applied' });
    await this.s.audit.record({
      action: 'config.template_upgrade.approve',
      entityType: 'project_template_migration',
      entityId: upgradeId,
      projectId,
      before: { status: 'proposed', templateVersionNo: pin.versionNo },
      after: { status: 'applied', templateVersionNo: to.versionNo, planHash, created: result, kept: plan.keep.length },
      reason: body.note ?? null,
    });
    return this.get(ctx, projectId, upgradeId);
  }

  async reject(ctx: RequestContext, projectId: string, upgradeId: string, body: RouteInput<R['rejectTemplateUpgrade']>['body']) {
    const { m, pv } = await this.loadForDecision(ctx, projectId, upgradeId, body.expectedVersion);
    const now = this.s.clock.now();
    const stored: StoredPreview = { ...pv, decisionNote: body.reason };
    await this.s.db
      .tx()
      .update(M)
      .set({ status: 'rejected', decidedBy: ctx.principal.userId, decidedAt: now, preview: stored as unknown as Record<string, unknown>, version: m.version + 1 })
      .where(and(eq(M.id, upgradeId), eq(M.projectId, projectId), eq(M.version, m.version)));
    await this.s.audit.record({ action: 'config.template_upgrade.reject', entityType: 'project_template_migration', entityId: upgradeId, projectId, before: { status: 'proposed' }, after: { status: 'rejected' }, reason: body.reason });
    return this.get(ctx, projectId, upgradeId);
  }
}

function counts(plan: TemplateUpgradePlan) {
  return { workstreams: plan.add.workstreams.length, gates: plan.add.gates.length, activities: plan.add.activities.length, kpis: plan.add.kpis.length };
}
