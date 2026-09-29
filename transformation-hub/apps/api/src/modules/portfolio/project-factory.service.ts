import { Injectable } from '@nestjs/common';
import { schema } from '@hub/db';
import type { ProjectTemplateDefinition } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { newId } from '../../platform/ids';

/**
 * Instantiates a project from a pinned template version (spec §5, §6). Everything created is *proposed*:
 * tasks start in `draft`, verification status `proposed`, deliverable weights unapproved, criteria applicability
 * "proposed", readiness checks not started. No dates are invented: planned dates stay empty until the PM plans.
 */
@Injectable()
export class ProjectFactory {
  constructor(private readonly db: DbService) {}

  async instantiate(input: { orgId: string; projectId: string; def: ProjectTemplateDefinition; isDemo: boolean; createdBy: string | null }) {
    const tx = this.db.tx();
    const { orgId, projectId, def, isDemo, createdBy } = input;
    const base = { orgId, projectId };

    // Workstreams
    const wsIds = new Map<string, string>();
    const workstreams = def.workstreams.map((w, i) => {
      const id = newId();
      wsIds.set(w.key, id);
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
        sortOrder: i,
        isDemo,
        createdBy,
      };
    });
    if (workstreams.length) await tx.insert(schema.workstream).values(workstreams);

    // WBS: tasks, milestones, deliverables
    const nodeIds = new Map<string, { id: string; type: 'task' | 'milestone' }>();
    const tasks: (typeof schema.task.$inferInsert)[] = [];
    const milestones: (typeof schema.milestone.$inferInsert)[] = [];
    const deliverables: (typeof schema.deliverable.$inferInsert)[] = [];
    def.wbs.forEach((a, i) => {
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
        return;
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
        status: 'draft',
        proposedOwnerFunction: a.proposedOwnerFunction,
        output: a.output.en,
        acceptanceCriteria: a.acceptanceCriteria.en,
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
    });
    for (const chunk of chunks(tasks, 200)) await tx.insert(schema.task).values(chunk);
    if (milestones.length) await tx.insert(schema.milestone).values(milestones);
    for (const chunk of chunks(deliverables, 200)) await tx.insert(schema.deliverable).values(chunk);

    const deps: (typeof schema.dependency.$inferInsert)[] = [];
    for (const a of def.wbs) {
      const succ = nodeIds.get(a.id)!;
      for (const p of a.prerequisites) {
        const pred = nodeIds.get(p);
        if (!pred) continue;
        deps.push({ ...base, id: newId(), predecessorType: pred.type, predecessorId: pred.id, successorType: succ.type, successorId: succ.id, type: 'FS', lagDays: 0, createdBy });
      }
    }
    for (const chunk of chunks(deps, 300)) await tx.insert(schema.dependency).values(chunk);

    // Gates, criteria, first assessment cycle
    let criteriaCount = 0;
    for (const g of def.gates) {
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

    // KPIs (proposals — no historical values)
    if (def.kpis.length) {
      await tx.insert(schema.kpi).values(
        def.kpis.map((k) => ({
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
    const dims = def.statusDimensions.map((d) => ({ ...base, id: newId(), key: d.key as 'incorporation', state: 'not_assessed', explanation: 'Not yet assessed' }));
    if (dims.length) await tx.insert(schema.statusDimension).values(dims);

    // AI starts OFF for every project (spec §12.3)
    await tx.insert(schema.aiProjectSettings).values({ ...base, id: newId(), mode: 'off', provider: 'off', updatedBy: createdBy });

    return {
      workstreams: workstreams.length,
      tasks: tasks.length,
      milestones: milestones.length,
      deliverables: deliverables.length,
      dependencies: deps.length,
      gates: def.gates.length,
      criteria: criteriaCount,
      kpis: def.kpis.length,
      readinessChecks: checks.length,
      statusDimensions: dims.length,
    };
  }
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
