import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  DIMENSION_MESSAGES_EN,
  DIMENSION_NOT_YET_ASSESSED,
  renderMessagesEn,
  type ProjectTemplateDefinition,
  type TemplateActivity,
  type TemplateGate,
  type TemplateKpi,
  type TemplateWorkstream,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { newId } from '../../platform/ids';

type Base = { orgId: string; projectId: string };
type Node = { id: string; type: 'task' | 'milestone' };

/** Counts of what was created (project creation and an approved template upgrade). */
export interface CreatedCounts {
  workstreams: number;
  tasks: number;
  milestones: number;
  deliverables: number;
  dependencies: number;
  gates: number;
  criteria: number;
  kpis: number;
}

/**
 * Instantiates a project from a pinned template version (spec §5, §6). Everything created is *proposed*:
 * tasks start in `draft`, verification status `proposed`, deliverable weights unapproved, criteria applicability
 * "proposed", readiness checks not started. No dates are invented: planned dates stay empty until the PM plans.
 *
 * The same row builders add the NEW elements of a newer template version when an upgrade is approved
 * (`applyAdditions`, REQ-ENT-009 / AT-26) — so a project upgraded later holds exactly what a project created on the new
 * version would hold for those elements. Existing records are never modified here.
 */
@Injectable()
export class ProjectFactory {
  constructor(private readonly db: DbService) {}

  async instantiate(input: { orgId: string; projectId: string; def: ProjectTemplateDefinition; isDemo: boolean; createdBy: string | null }) {
    const tx = this.db.tx();
    const { orgId, projectId, def, isDemo, createdBy } = input;
    const base = { orgId, projectId };

    const wsIds = await this.insertWorkstreams(base, def.workstreams.map((w, i) => ({ w, sortOrder: i })), isDemo, createdBy);
    const wbs = await this.insertWbs(base, def, def.wbs, wsIds, new Map(), isDemo, createdBy);
    const gates = await this.insertGates(base, def.gates, createdBy);
    await this.insertKpis(base, def.kpis);

    // Project-level default readiness checks (sites can be added later)
    const checks: (typeof schema.readinessCheck.$inferInsert)[] = [];
    for (const area of def.readinessAreas) {
      for (const c of area.defaultChecks) {
        checks.push({
          ...base,
          id: newId(),
          code: `${area.key}-${c.key}`.slice(0, 32),
          area: area.key as (typeof schema.readinessCheck.$inferInsert)['area'],
          title: c.title.en,
          titleAr: c.title.ar,
          mandatory: c.mandatory,
          blocker: c.blocker,
          signoffRole: c.signoffRole,
          isDemo,
          createdBy,
        });
      }
    }
    for (const chunk of chunks(checks, 200)) await tx.insert(schema.readinessCheck).values(chunk);

    // Status dimensions (only those the template defines)
    const dims = def.statusDimensions.map((d) => ({
      ...base,
      id: newId(),
      key: d.key as 'incorporation',
      state: 'not_assessed',
      explanation: renderMessagesEn(DIMENSION_NOT_YET_ASSESSED, DIMENSION_MESSAGES_EN),
      explanationI18n: DIMENSION_NOT_YET_ASSESSED,
    }));
    if (dims.length) await tx.insert(schema.statusDimension).values(dims);

    // AI starts OFF for every project (spec §12.3)
    await tx.insert(schema.aiProjectSettings).values({ ...base, id: newId(), mode: 'off', provider: 'off', updatedBy: createdBy });

    return {
      workstreams: wsIds.size,
      tasks: wbs.tasks,
      milestones: wbs.milestones,
      deliverables: wbs.deliverables,
      dependencies: wbs.dependencies,
      gates: gates.gates,
      criteria: gates.criteria,
      kpis: def.kpis.length,
      readinessChecks: checks.length,
      statusDimensions: dims.length,
    };
  }

  /**
   * An approved template upgrade (REQ-ENT-009): create the listed workstreams, gates (with their criteria and a first
   * not-started cycle), WBS activities (draft tasks / milestones and their deliverables, with the dependencies to existing
   * or added activities) and KPIs of the NEW template version. Only additions: nothing existing is changed or removed.
   * The caller holds the gate and plan-graph locks and has verified the plan the approver saw.
   */
  async applyAdditions(input: {
    orgId: string;
    projectId: string;
    def: ProjectTemplateDefinition;
    isDemo: boolean;
    createdBy: string | null;
    add: { workstreams: string[]; gates: string[]; activities: string[]; kpis: string[] };
  }): Promise<CreatedCounts> {
    const tx = this.db.tx();
    const { orgId, projectId, def, isDemo, createdBy, add } = input;
    const base = { orgId, projectId };
    const [mx] = await tx.select({ m: sql<number>`coalesce(max(${schema.workstream.sortOrder}), -1)::int` }).from(schema.workstream).where(eq(schema.workstream.projectId, projectId));
    let next = Number(mx?.m ?? -1) + 1;
    const newWs = def.workstreams.filter((w) => add.workstreams.includes(w.key)).map((w) => ({ w, sortOrder: next++ }));
    const created = await this.insertWorkstreams(base, newWs, isDemo, createdBy);
    // Existing workstreams by template key (or code), so new activities attach to them.
    const wsIds = new Map(created);
    const existingWs = await tx.select({ id: schema.workstream.id, key: schema.workstream.templateKey, code: schema.workstream.code }).from(schema.workstream).where(eq(schema.workstream.projectId, projectId));
    for (const w of existingWs) if (!wsIds.has(w.key ?? w.code)) wsIds.set(w.key ?? w.code, w.id);
    // Existing WBS nodes by template activity id (tasks) and code (milestones) — the predecessors of new activities.
    const activities = def.wbs.filter((a) => add.activities.includes(a.id));
    const prereqIds = [...new Set(activities.flatMap((a) => a.prerequisites))];
    const existing = new Map<string, Node>();
    if (prereqIds.length) {
      const t = await tx.select({ id: schema.task.id, key: schema.task.templateActivityId }).from(schema.task).where(and(eq(schema.task.projectId, projectId), inArray(schema.task.templateActivityId, prereqIds)));
      for (const r of t) if (r.key) existing.set(r.key, { id: r.id, type: 'task' });
      const m = await tx.select({ id: schema.milestone.id, code: schema.milestone.code }).from(schema.milestone).where(and(eq(schema.milestone.projectId, projectId), inArray(schema.milestone.code, prereqIds)));
      for (const r of m) existing.set(r.code, { id: r.id, type: 'milestone' });
    }
    const wbs = await this.insertWbs(base, def, activities, wsIds, existing, isDemo, createdBy);
    const gates = await this.insertGates(base, def.gates.filter((g) => add.gates.includes(g.key)), createdBy);
    const kpis = def.kpis.filter((k) => add.kpis.includes(k.key));
    await this.insertKpis(base, kpis);
    return { workstreams: created.size, ...wbs, ...gates, kpis: kpis.length };
  }

  // ------------------------------------------------------------------------------------------------- row builders

  private async insertWorkstreams(base: Base, items: { w: TemplateWorkstream; sortOrder: number }[], isDemo: boolean, createdBy: string | null): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    const rows = items.map(({ w, sortOrder }) => {
      const id = newId();
      ids.set(w.key, id);
      return {
        ...base,
        id,
        code: w.key,
        templateKey: w.key,
        name: w.name.en,
        nameAr: w.name.ar,
        objective: w.objective.en,
        scope: w.scope.en,
        proposedLeadFunction: w.proposedLeadFunction,
        raci: w.raci,
        linkedGateKeys: w.linkedGates,
        sortOrder,
        isDemo,
        createdBy,
      };
    });
    if (rows.length) await this.db.tx().insert(schema.workstream).values(rows);
    return ids;
  }

  /** WBS: tasks, milestones, deliverables and Finish-to-Start dependencies (to `existing` nodes or nodes created here). */
  private async insertWbs(base: Base, def: ProjectTemplateDefinition, activities: TemplateActivity[], wsIds: Map<string, string>, existing: Map<string, Node>, isDemo: boolean, createdBy: string | null) {
    const tx = this.db.tx();
    const nodeIds = new Map<string, Node>(existing);
    const tasks: (typeof schema.task.$inferInsert)[] = [];
    const milestones: (typeof schema.milestone.$inferInsert)[] = [];
    const deliverables: (typeof schema.deliverable.$inferInsert)[] = [];
    for (const a of activities) {
      const i = def.wbs.indexOf(a);
      const workstreamId = wsIds.get(a.workstreamKey) ?? null;
      if (a.isMilestone) {
        const id = newId();
        nodeIds.set(a.id, { id, type: 'milestone' });
        milestones.push({
          ...base,
          id,
          workstreamId,
          code: a.id,
          title: a.title.en,
          titleAr: a.title.ar,
          gateKey: a.gateKey,
          isCritical: true,
          weight: a.weight,
          verificationStatus: 'proposed',
          isDemo,
          createdBy,
        });
        continue;
      }
      const id = newId();
      nodeIds.set(a.id, { id, type: 'task' });
      tasks.push({
        ...base,
        id,
        workstreamId,
        wbsCode: a.id,
        title: a.title.en,
        titleAr: a.title.ar,
        description: a.description.en,
        descriptionAr: a.description.ar || null,
        status: 'draft',
        proposedOwnerFunction: a.proposedOwnerFunction,
        output: a.output.en,
        outputAr: a.output.ar || null,
        acceptanceCriteria: a.acceptanceCriteria.en,
        acceptanceCriteriaAr: a.acceptanceCriteria.ar || null,
        approverRole: a.approverRole,
        evidenceType: a.evidenceType,
        effort: a.effort,
        durationDays: a.durationDays,
        durationBasis: a.durationBasis,
        requiresAcceptance: a.requiresAcceptance,
        gateKey: a.gateKey,
        isDeliverable: a.isDeliverable,
        weight: a.weight,
        templateActivityId: a.id,
        verificationStatus: 'proposed',
        sortOrder: i,
        isDemo,
        createdBy,
      });
      if (a.isDeliverable) {
        deliverables.push({
          ...base,
          id: newId(),
          workstreamId,
          taskId: id,
          code: `D-${a.id}`,
          title: a.output.en || a.title.en,
          titleAr: a.output.ar || a.title.ar,
          weight: Math.max(1, a.weight),
          weightApproved: false,
          acceptanceCriteria: a.acceptanceCriteria.en,
          gateKey: a.gateKey,
          isDemo,
          createdBy,
        });
      }
    }
    for (const chunk of chunks(tasks, 200)) await tx.insert(schema.task).values(chunk);
    if (milestones.length) await tx.insert(schema.milestone).values(milestones);
    for (const chunk of chunks(deliverables, 200)) await tx.insert(schema.deliverable).values(chunk);

    const deps: (typeof schema.dependency.$inferInsert)[] = [];
    for (const a of activities) {
      const succ = nodeIds.get(a.id)!;
      for (const p of a.prerequisites) {
        const pred = nodeIds.get(p);
        if (!pred) continue;
        deps.push({ ...base, id: newId(), predecessorType: pred.type, predecessorId: pred.id, successorType: succ.type, successorId: succ.id, type: 'FS', lagDays: 0, createdBy });
      }
    }
    for (const chunk of chunks(deps, 300)) await tx.insert(schema.dependency).values(chunk);
    return { tasks: tasks.length, milestones: milestones.length, deliverables: deliverables.length, dependencies: deps.length };
  }

  /** Gates, criteria and the first (not started) assessment cycle. */
  private async insertGates(base: Base, gates: TemplateGate[], createdBy: string | null) {
    const tx = this.db.tx();
    let criteriaCount = 0;
    for (const g of gates) {
      const gateId = newId();
      await tx.insert(schema.gateDefinition).values({
        ...base,
        id: gateId,
        key: g.key,
        sortOrder: g.order,
        name: g.name.en,
        nameAr: g.name.ar,
        purpose: g.purpose.en,
        prerequisiteGateKeys: g.prerequisiteGateKeys,
        ownerRole: g.ownerRole,
        reviewerRole: g.reviewerRole,
        approverRole: g.approverRole,
      });
      const assessmentId = newId();
      await tx.insert(schema.gateAssessment).values({ ...base, id: assessmentId, gateId, cycle: 1, status: 'not_started', isCurrent: true, createdBy });
      const crits = g.criteria.map((c, i) => ({
        ...base,
        id: newId(),
        gateId,
        key: c.key,
        description: c.description.en,
        descriptionAr: c.description.ar,
        mandatory: c.mandatory,
        blocking: c.blocking,
        waivable: c.waivable,
        waiverAuthorityRole: c.waiverAuthorityRole,
        waivabilityBasis: c.waivabilityBasis ?? null,
        evidenceRequired: c.evidenceRequired,
        evidenceType: c.evidenceType,
        ownerRole: c.ownerRole,
        reviewerRole: c.reviewerRole,
        applicability: c.applicability,
        sortOrder: i,
      }));
      if (crits.length) {
        await tx.insert(schema.gateCriterion).values(crits);
        await tx.insert(schema.criterionAssessment).values(crits.map((c) => ({ ...base, id: newId(), assessmentId, criterionId: c.id, status: 'unmet' as const })));
      }
      criteriaCount += crits.length;
    }
    return { gates: gates.length, criteria: criteriaCount };
  }

  /** KPIs (proposals — no historical values); each carries its template owner role (REQ-RPT-013). */
  private async insertKpis(base: Base, kpis: TemplateKpi[]) {
    if (!kpis.length) return;
    await this.db
      .tx()
      .insert(schema.kpi)
      .values(
        kpis.map((k) => ({
          ...base,
          id: newId(),
          key: k.key,
          name: k.name.en,
          nameAr: k.name.ar,
          definition: k.definition.en,
          formula: k.formula,
          unit: k.unit,
          period: k.period,
          ownerRole: k.ownerRole,
          source: k.source,
          target: k.target,
          thresholds: k.thresholds,
          direction: k.direction,
          frequency: k.frequency,
          verificationStatus: 'proposed' as const,
        })),
      );
  }
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
