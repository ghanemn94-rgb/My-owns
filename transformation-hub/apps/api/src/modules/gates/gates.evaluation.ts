import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  evaluateGate,
  gateReviewBasis,
  waiverIsEffective,
  CriterionState,
  CriterionEvidenceLink,
  GateEvaluation,
  GateAssessmentStatus,
  GateReviewRecord,
  ReassessmentReason,
  notFound,
} from '@hub/domain';
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
  /** Active links independently verified in the documents module (accepted by a verifier who neither linked nor uploaded them). */
  verified: number;
  /** Ids of the active links (recorded in the decision snapshot as the evidence relied upon — DOM-P2-05). */
  activeLinkIds: string[];
  /** Every link of the criterion with its status and timestamps (evidence-change reassessment). */
  links: CriterionEvidenceLink[];
  /** Every link with its row version (the gate-level review basis — DOM-P2-16). */
  linkVersions: { id: string; status: string; version: number }[];
}

/**
 * DOM-P2R-04: the governance decision the approval relied on lost the evidence of its external approval (the evidence link
 * was rejected as defective, superseded or marked conflicting).
 */
export interface DecisionEvidenceFlag {
  decisionId: string;
  code: string;
  evidenceLinkId: string;
  reason: ReassessmentReason;
}

/** Stored reassessment flags on a decided cycle's `evaluation` JSON (AT-14, DOM-P2-05, DOM-P2R-04). */
export interface ReassessmentFlags {
  needsReassessment: boolean;
  requestedAt: string | null;
  /** `reason`: conflicting evidence, evidence rejected as defective, or superseded evidence relied upon at the decision. */
  criteria: { criterionId: string; key: string; evidenceLinkIds: string[]; reason: ReassessmentReason }[];
  /** The backing decision's external-approval evidence changed (DOM-P2R-04); null when not. */
  decisionEvidence: DecisionEvidenceFlag | null;
  escalationId: string | null;
  upstreamGateKeys: string[];
}

export const NO_EVIDENCE: EvidenceCounts = { active: 0, conflicting: 0, conflictingLinkIds: [], submitters: [], verified: 0, activeLinkIds: [], links: [], linkVersions: [] };

/** The gate-level review recorded on a cycle (DOM-P2-16). */
export function reviewOf(a: AssessmentRow): GateReviewRecord {
  return { outcome: a.reviewOutcome ?? null, reviewedBy: a.reviewedBy ?? null, basis: a.reviewBasis ?? null };
}

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

  /**
   * SHA-256 of the current cycle's criterion state (domain gateReviewBasis — DOM-P2-16): criterion definition versions, the
   * cycle's criterion assessment row versions, every evidence link and every waiver of the gate's criteria. A gate
   * endorsement is current only while this value is unchanged.
   */
  reviewBasis(gate: GateRow): string {
    const cur = this.current(gate.id);
    const crits = this.criteriaOf(gate.id);
    const ids = new Set(crits.map((c) => c.id));
    const canonical = gateReviewBasis({
      criteria: crits.map((c) => ({ id: c.id, version: c.version, assessmentVersion: this.ca(cur.id, c.id)?.version ?? null })),
      evidence: crits.flatMap((c) => this.evidenceOf(c.id).linkVersions.map((l) => ({ id: l.id, criterionId: c.id, status: l.status, version: l.version }))),
      waivers: this.waivers.filter((w) => ids.has(w.targetId)).map((w) => ({ id: w.id, criterionId: w.targetId, status: w.status, version: w.version })),
    });
    return createHash('sha256').update(canonical).digest('hex');
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
    // Flags written before DOM-P2-05 carry no reason: they were all raised for conflicting evidence.
    criteria: (r?.reassessment?.criteria ?? []).map((c) => ({ criterionId: c.criterionId, key: c.key, evidenceLinkIds: c.evidenceLinkIds ?? [], reason: c.reason ?? 'evidence_conflict' })),
    decisionEvidence: r?.reassessment?.decisionEvidence ?? null,
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
    const ev = await tx.execute<{ id: string; target_id: string; status: CriterionEvidenceLink['status']; added_by: string; reviewed_by: string | null; created_at: Date | string; reviewed_at: Date | string | null; version: number }>(sql`
      select id::text as id, target_id::text as target_id, status, added_by::text as added_by, reviewed_by::text as reviewed_by, created_at, reviewed_at, version
        from evidence_link
       where project_id = ${projectId} and target_type = 'gate_criterion'
       order by created_at, id`);
    const evidence = new Map<string, EvidenceCounts>();
    const ms = (v: Date | string | null) => (v === null ? null : new Date(v).getTime());
    for (const r of ev.rows) {
      const e = evidence.get(r.target_id) ?? { ...NO_EVIDENCE, conflictingLinkIds: [], submitters: [], activeLinkIds: [], links: [], linkVersions: [] };
      e.links.push({ id: r.id, status: r.status, createdAtMs: ms(r.created_at)!, reviewedAtMs: ms(r.reviewed_at) });
      e.linkVersions.push({ id: r.id, status: r.status, version: Number(r.version) });
      if (r.status === 'active') {
        e.active++;
        e.activeLinkIds.push(r.id);
        if (!e.submitters.includes(r.added_by)) e.submitters.push(r.added_by);
        if (r.reviewed_by) e.verified++;
      } else if (r.status === 'conflicting') {
        e.conflicting++;
        e.conflictingLinkIds.push(r.id);
      }
      evidence.set(r.target_id, e);
    }
    const waivers = await tx
      .select()
      .from(schema.waiver)
      .where(and(eq(schema.waiver.projectId, projectId), eq(schema.waiver.targetType, 'gate_criterion')));
    return new GateBundle(project, this.clock.today(project.timezone), gates, criteria, assessments, cas, evidence, waivers);
  }
}
