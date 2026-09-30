import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  computeStatusDimensions,
  isCarveOutComplete,
  waiverIsEffective,
  APPROVED_GATE_STATUSES,
  DimensionInput,
  DimensionState,
  notFound,
  StatusDimensionKey,
  ProjectTemplateDefinition,
  IncorporationStatus,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { Clock } from '../../platform/clock';
import { RecordVersionService } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';

/** Gate whose approval means "standalone operation accepted" in the DC template (business-gates.md §3 G4). */
export const STANDALONE_GATE_KEY = 'G4';

type DimRow = typeof schema.statusDimension.$inferSelect;

/**
 * Key-order-independent JSON: jsonb does not keep object key order, so a stored value read back must compare equal to
 * the same freshly computed value (otherwise every recompute would re-version and re-audit an unchanged dimension).
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

/**
 * Owner of the four independent status dimensions (spec §3, AT-06, REQ-LCY-006/007/014). Each dimension is computed from
 * its own registers and evidence — never from task completion and never from another dimension — and each change is
 * versioned (record_version) and audited. The carve-out is complete only when every dimension reaches its terminal state.
 */
@Injectable()
export class StatusDimensionsService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly versions: RecordVersionService,
  ) {}

  async get(ctx: RequestContext, projectId: string) {
    const [p] = await this.db.tx().select({ classification: schema.project.classification }).from(schema.project).where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    this.policy.assert(ctx, 'portfolio.project.read', { projectId, classification: p.classification });
    return this.view(projectId);
  }

  /** HTTP entry point (explicit recompute by an authorized user). */
  async recompute(ctx: RequestContext, projectId: string) {
    const [p] = await this.db.tx().select({ classification: schema.project.classification }).from(schema.project).where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    this.policy.assert(ctx, 'gates.definition.manage', { projectId, classification: p.classification });
    await this.recomputeDimensions(projectId);
    return this.view(projectId);
  }

  private async view(projectId: string) {
    const rows = await this.db.tx().select().from(schema.statusDimension).where(eq(schema.statusDimension.projectId, projectId)).orderBy(asc(schema.statusDimension.key));
    const order = ['incorporation', 'perimeter_transfer', 'operational_readiness', 'jv_transaction'];
    rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const dims: DimensionState[] = rows.map((r) => ({ key: r.key, state: r.state, explanation: r.explanation ?? '', explanationI18n: r.explanationI18n ?? [] }));
    return {
      items: rows.map((r) => ({
        id: r.id,
        key: r.key,
        state: r.state,
        explanation: r.explanation,
        explanationI18n: r.explanationI18n ?? [],
        counts: r.counts ?? null,
        computedAt: r.computedAt.toISOString(),
        version: r.version,
      })),
      carveOutComplete: rows.length > 0 && isCarveOutComplete(dims),
    };
  }

  /** Build the domain input from the registers (read-only use of other modules' tables). */
  async buildInput(projectId: string): Promise<DimensionInput> {
    const tx = this.db.tx();
    const [project] = await tx.select().from(schema.project).where(eq(schema.project.id, projectId));
    if (!project) throw notFound();
    const today = this.clock.today(project.timezone);

    const newco = await tx.execute<{ status: IncorporationStatus; verification: string }>(sql`
      select le.incorporation_status as status, le.incorporation_verification as verification
        from project_entity pe join legal_entity le on le.id = pe.legal_entity_id
       where pe.project_id = ${projectId} and pe.role = 'newco'
       order by pe.created_at limit 1`);
    const perimeter = await tx
      .select({ disposition: schema.perimeterItem.disposition, transferStatus: schema.perimeterItem.transferStatus, economicTransferStatus: schema.perimeterItem.economicTransferStatus })
      .from(schema.perimeterItem)
      .where(eq(schema.perimeterItem.projectId, projectId));
    const readiness = await tx
      .select({ r: schema.readinessCheck, w: schema.waiver })
      .from(schema.readinessCheck)
      .leftJoin(
        schema.waiver,
        and(eq(schema.waiver.id, schema.readinessCheck.waiverId), eq(schema.waiver.targetType, 'readiness_check'), eq(schema.waiver.targetId, schema.readinessCheck.id)),
      )
      .where(eq(schema.readinessCheck.projectId, projectId));
    const g4 = await tx
      .select({ status: schema.gateAssessment.status })
      .from(schema.gateAssessment)
      .innerJoin(schema.gateDefinition, eq(schema.gateDefinition.id, schema.gateAssessment.gateId))
      .where(and(eq(schema.gateAssessment.projectId, projectId), eq(schema.gateDefinition.key, STANDALONE_GATE_KEY), eq(schema.gateAssessment.isCurrent, true)));
    const closings = await tx.select({ kind: schema.closing.kind, status: schema.closing.status }).from(schema.closing).where(eq(schema.closing.projectId, projectId));
    const tsas = await tx
      .select({ status: schema.tsaService.status, isEnduringArrangement: schema.tsaService.isEnduringArrangement })
      .from(schema.tsaService)
      .where(eq(schema.tsaService.projectId, projectId));
    const defs = await tx.select({ status: schema.operatingModelDefinition.status }).from(schema.operatingModelDefinition).where(eq(schema.operatingModelDefinition.projectId, projectId));

    const n = newco.rows[0];
    return {
      newcoIncorporation: n ? { status: n.status, evidenceVerified: n.verification === 'confirmed' } : null,
      perimeter,
      readiness: readiness.map(({ r, w }) => ({
        mandatory: r.mandatory,
        blocker: r.blocker,
        status: r.status,
        waivedValid: r.status === 'waived' && r.waivable && waiverIsEffective(w, today),
      })),
      standaloneAccepted: g4.some((a) => APPROVED_GATE_STATUSES.includes(a.status)),
      closings,
      tsas,
      independenceDefinitionApproved: defs.length ? defs.some((d) => d.status === 'approved') : undefined,
    };
  }

  /**
   * Recompute and upsert the project's dimensions (only those its template defines). Changes bump the row version,
   * are snapshotted in record_version and audited; unchanged dimensions only refresh `computedAt`.
   * Service method other modules/jobs may call inside a project-scoped context.
   */
  async recomputeDimensions(projectId: string): Promise<{ changed: StatusDimensionKey[] }> {
    const tx = this.db.tx();
    const [tv] = await tx
      .select({ definition: schema.projectTemplateVersion.definition, orgId: schema.project.orgId })
      .from(schema.project)
      .innerJoin(schema.projectTemplateVersion, eq(schema.projectTemplateVersion.id, schema.project.templateVersionId))
      .where(eq(schema.project.id, projectId));
    if (!tv) throw notFound();
    const keys = new Set(((tv.definition as unknown as ProjectTemplateDefinition).statusDimensions ?? []).map((d) => d.key));
    if (keys.size === 0) return { changed: [] };
    const computed = computeStatusDimensions(await this.buildInput(projectId)).filter((d) => keys.has(d.key));
    const existing = await tx.select().from(schema.statusDimension).where(eq(schema.statusDimension.projectId, projectId));
    const byKey = new Map<string, DimRow>(existing.map((r) => [r.key, r]));
    const changed: StatusDimensionKey[] = [];
    const now = new Date();
    for (const d of computed) {
      const counts = d.counts ?? null;
      const prev = byKey.get(d.key);
      const snap = (r: { state: string; explanation: string | null; explanationI18n: DimensionState['explanationI18n'] | null; counts: Record<string, number> | null }) => ({
        state: r.state,
        explanation: r.explanation,
        explanationI18n: r.explanationI18n,
        counts: r.counts,
        computedAt: now.toISOString(),
      });
      const next = { state: d.state, explanation: d.explanation, explanationI18n: d.explanationI18n, counts };
      if (!prev) {
        const id = newId();
        await tx.insert(schema.statusDimension).values({ id, orgId: tv.orgId, projectId, key: d.key, ...next, computedAt: now });
        await this.versions.snapshot({ projectId, entityType: 'status_dimension', entityId: id, versionNo: 1, snapshot: snap(next), reason: 'recomputed' });
        await this.audit.record({ action: 'gates.status_dimension.recompute', entityType: 'status_dimension', entityId: id, projectId, after: { key: d.key, state: d.state, explanation: d.explanation } });
        changed.push(d.key);
        continue;
      }
      // Key-order-insensitive (canonicalJson): jsonb returns object keys in its own order, so a plain JSON.stringify
      // comparison reported a change (new version, history row, audit event) on every recompute (REQ-SET-001, QA-P1-14).
      const same =
        prev.state === d.state &&
        (prev.explanation ?? '') === d.explanation &&
        canonicalJson(prev.explanationI18n ?? null) === canonicalJson(d.explanationI18n) &&
        canonicalJson(prev.counts ?? null) === canonicalJson(counts);
      if (same) {
        await tx.update(schema.statusDimension).set({ computedAt: now }).where(eq(schema.statusDimension.id, prev.id));
        continue;
      }
      await this.versions.snapshot({
        projectId,
        entityType: 'status_dimension',
        entityId: prev.id,
        versionNo: prev.version,
        snapshot: snap({ state: prev.state, explanation: prev.explanation, explanationI18n: prev.explanationI18n ?? null, counts: prev.counts ?? null }),
        reason: 'previous state',
      });
      await tx
        .update(schema.statusDimension)
        .set({ ...next, computedAt: now, version: sql`${schema.statusDimension.version} + 1` })
        .where(eq(schema.statusDimension.id, prev.id));
      await this.versions.snapshot({ projectId, entityType: 'status_dimension', entityId: prev.id, versionNo: prev.version + 1, snapshot: snap(next), reason: 'recomputed' });
      await this.audit.record({
        action: 'gates.status_dimension.recompute',
        entityType: 'status_dimension',
        entityId: prev.id,
        projectId,
        before: { key: prev.key, state: prev.state, explanation: prev.explanation },
        after: { key: d.key, state: d.state, explanation: d.explanation },
      });
      changed.push(d.key);
    }
    return { changed };
  }
}
