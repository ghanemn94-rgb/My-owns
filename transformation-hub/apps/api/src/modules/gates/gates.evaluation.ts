import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { evaluateGate, waiverIsEffective, CriterionState, GateEvaluation, GateAssessmentStatus, notFound } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { Clock } from '../../platform/clock';

export type GateRow = typeof schema.gateDefinition.$inferSelect;
export type CriterionRow = typeof schema.gateCriterion.$inferSelect;
export type AssessmentRow = typeof schema.gateAssessment.$inferSelect;
export type CriterionAssessmentRow = typeof schema.criterionAssessment.$inferSelect;
export type WaiverRow = typeof schema.waiver.$inferSelect;
export type ProjectRow = typeof schema.project.$inferSelect;

export interface EvidenceCounts {
  active: number;
  conflicting: number;
  conflictingLinkIds: string[];
  /** Users who added the active evidence (the "evidence owners" — a reviewer must be someone else). */
  submitters: string[];
}

/** Stored reassessment flags on a decided cycle's `evaluation` JSON (AT-14). */
export interface ReassessmentFlags {
  needsReassessment: boolean;
  requestedAt: string | null;
  criteria: { criterionId: string; key: string; evidenceLinkIds: string[] }[];
  escalationId: string | null;
  upstreamGateKeys: string[];
}

export const NO_EVIDENCE: EvidenceCounts = { active: 0, conflicting: 0, conflictingLinkIds: [], submitters: [] };

/**
 * Everything needed to evaluate a project's gates in a handful of queries (runs inside the caller's transaction and
 * RLS scope). Task completion is deliberately not loaded: it is not an input to gate evaluation (REQ-LCY-011).
 */
export class GateBundle {
  readonly caByKey = new Map<string, CriterionAssessmentRow>();
  constructor(
    readonly project: ProjectRow,
    readonly today: string,
    readonly gates: GateRow[],
    readonly criteria: CriterionRow[],
    readonly assessments: AssessmentRow[],
    readonly criterionAssessments: CriterionAssessmentRow[],
    readonly evidence: Map<string, EvidenceCounts>,
    readonly waivers: WaiverRow[],
  ) {
    for (const ca of criterionAssessments) this.caByKey.set(`${ca.assessmentId}:${ca.criterionId}`, ca);
  }

  gate(gateId: string): GateRow {
    const g = this.gates.find((x) => x.id === gateId);
    if (!g) throw notFound();
    return g;
  }

  gateByKey(key: string): GateRow | undefined {
    return this.gates.find((g) => g.key === key);
  }

  current(gateId: string): AssessmentRow {
    const a = this.assessments.find((x) => x.gateId === gateId && x.isCurrent);
    if (!a) throw notFound('gates.no_current_assessment', 'Gate has no current assessment');
    return a;
  }

  cycles(gateId: string): AssessmentRow[] {
    return this.assessments.filter((a) => a.gateId === gateId).sort((a, b) => a.cycle - b.cycle);
  }

  criteriaOf(gateId: string): CriterionRow[] {
    return this.criteria.filter((c) => c.gateId === gateId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  ca(assessmentId: string, criterionId: string): CriterionAssessmentRow | undefined {
    return this.caByKey.get(`${assessmentId}:${criterionId}`);
  }

  evidenceOf(criterionId: string): EvidenceCounts {
    return this.evidence.get(criterionId) ?? NO_EVIDENCE;
  }

  waiver(id: string | null | undefined): WaiverRow | undefined {
    return id ? this.waivers.find((w) => w.id === id) : undefined;
  }

  /** Effective (approved, unexpired) waiver for this criterion assessment, if any. */
  effectiveWaiverId(criterionId: string, ca: CriterionAssessmentRow | undefined): string | null {
    const w = this.waiver(ca?.waiverId);
    return w && w.targetId === criterionId && w.targetType === 'gate_criterion' && waiverIsEffective(w, this.today) ? w.id : null;
  }

  prerequisites(gate: GateRow): { gateKey: string; status: GateAssessmentStatus | 'none' }[] {
    return (gate.prerequisiteGateKeys ?? []).map((k) => {
      const pg = this.gateByKey(k);
      const pa = pg ? this.assessments.find((a) => a.gateId === pg.id && a.isCurrent) : undefined;
      return { gateKey: k, status: pa?.status ?? 'none' };
    });
  }

  criterionStates(gate: GateRow, assessmentId: string): CriterionState[] {
    return this.criteriaOf(gate.id).map((c) => {
      const ca = this.ca(assessmentId, c.id);
      const ev = this.evidenceOf(c.id);
      const status = ca?.status ?? 'unmet';
      return {
        key: c.key,
        mandatory: c.mandatory,
        blocking: c.blocking,
        waivable: c.waivable,
        evidenceRequired: c.evidenceRequired,
        status,
        activeEvidenceCount: ev.active,
        conflictingEvidenceCount: ev.conflicting,
        approvedWaiverId: status === 'waived' ? this.effectiveWaiverId(c.id, ca) : null,
        naDetermination:
          status === 'not_applicable' && ca ? { approved: ca.naApproved, basis: ca.naBasis ?? '', byUserId: ca.naDeterminedBy ?? '' } : null,
      };
    });
  }

  /** Live evaluation of the gate's current cycle (criteria + evidence + prerequisites). */
  evaluate(gate: GateRow): GateEvaluation {
    const current = this.current(gate.id);
    return evaluateGate({ criteria: this.criterionStates(gate, current.id), prerequisites: this.prerequisites(gate) });
  }

  /** Transitive downstream gates (those listing this gate as a prerequisite, directly or indirectly). */
  downstreamOf(gateKey: string): GateRow[] {
    const out = new Map<string, GateRow>();
    const visit = (k: string) => {
      for (const g of this.gates) {
        if ((g.prerequisiteGateKeys ?? []).includes(k) && !out.has(g.key)) {
          out.set(g.key, g);
          visit(g.key);
        }
      }
    };
    visit(gateKey);
    return [...out.values()];
  }
}

export function reassessmentOf(a: AssessmentRow): ReassessmentFlags {
  const r = (a.evaluation as { reassessment?: Partial<ReassessmentFlags>; needsReassessment?: boolean } | null) ?? null;
  return {
    needsReassessment: r?.needsReassessment === true,
    requestedAt: r?.reassessment?.requestedAt ?? null,
    criteria: r?.reassessment?.criteria ?? [],
    escalationId: r?.reassessment?.escalationId ?? null,
    upstreamGateKeys: r?.reassessment?.upstreamGateKeys ?? [],
  };
}

@Injectable()
export class GateLoader {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
  ) {}

  async project(projectId: string): Promise<ProjectRow> {
    const [p] = await this.db.tx().select().from(schema.project).where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    return p;
  }

  /** Load the project's gates with all cycles; criterion assessments of the given cycles (default: current cycles). */
  async bundle(projectId: string, opts: { allCycles?: boolean } = {}): Promise<GateBundle> {
    const tx = this.db.tx();
    const project = await this.project(projectId);
    const gates = await tx.select().from(schema.gateDefinition).where(eq(schema.gateDefinition.projectId, projectId)).orderBy(asc(schema.gateDefinition.sortOrder));
    const criteria = await tx.select().from(schema.gateCriterion).where(eq(schema.gateCriterion.projectId, projectId)).orderBy(asc(schema.gateCriterion.sortOrder));
    const assessments = await tx
      .select()
      .from(schema.gateAssessment)
      .where(eq(schema.gateAssessment.projectId, projectId))
      .orderBy(asc(schema.gateAssessment.cycle));
    const ids = (opts.allCycles ? assessments : assessments.filter((a) => a.isCurrent)).map((a) => a.id);
    const cas = ids.length
      ? await tx
          .select()
          .from(schema.criterionAssessment)
          .where(and(eq(schema.criterionAssessment.projectId, projectId), inArray(schema.criterionAssessment.assessmentId, ids)))
      : [];
    const ev = await tx.execute<{ target_id: string; active: number; conflicting: number; conflicting_ids: string[] | null; submitters: string[] | null }>(sql`
      select target_id::text as target_id,
             count(*) filter (where status = 'active')::int as active,
             count(*) filter (where status = 'conflicting')::int as conflicting,
             array_agg(id::text) filter (where status = 'conflicting') as conflicting_ids,
             array_agg(distinct added_by::text) filter (where status = 'active') as submitters
        from evidence_link
       where project_id = ${projectId} and target_type = 'gate_criterion'
       group by target_id`);
    const evidence = new Map<string, EvidenceCounts>();
    for (const r of ev.rows) {
      evidence.set(r.target_id, { active: r.active, conflicting: r.conflicting, conflictingLinkIds: r.conflicting_ids ?? [], submitters: r.submitters ?? [] });
    }
    const waivers = await tx
      .select()
      .from(schema.waiver)
      .where(and(eq(schema.waiver.projectId, projectId), eq(schema.waiver.targetType, 'gate_criterion')));
    return new GateBundle(project, this.clock.today(project.timezone), gates, criteria, assessments, cas, evidence, waivers);
  }
}
