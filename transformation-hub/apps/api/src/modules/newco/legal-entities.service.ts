import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  Classification,
  IncorporationStatus,
  VerificationStatus,
  assertIncorporationRecord,
  assertIncorporationVerification,
  conflict,
  invalid,
  notFound,
  verificationAfterRecord,
} from '@hub/domain';
import type { z } from 'zod';
import type { CreateLegalEntityBody, SetupNewcoStatusBody } from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { RecordVersionService, activeEvidenceCount, assertVersion } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { StatusDimensionsService } from '../gates/status-dimensions.service';
import { EvidenceService } from '../documents/evidence.service';
import { NewcoSupport, NewcoProject } from './newco.support';

type Entity = typeof schema.legalEntity.$inferSelect;
type EntityKind = Entity['kind'];
const LE = schema.legalEntity;
const PE = schema.projectEntity;
const READ = 'newco.register.read';

/**
 * Legal entities and incorporation (spec §3, §5, §21 step 2; AT-06; REQ-LCY-007, REQ-SET-010). A legal entity is
 * organization-level and may take part in several projects; a project only sees and edits entities linked to it.
 * Incorporation is recorded with evidence (proposed) and verified by someone else against that evidence. It is its own
 * status dimension: recording or verifying it never touches transfers or operations, and after each change the gates
 * module's StatusDimensionsService recomputes the four dimensions (the carve-out is never marked complete here).
 */
@Injectable()
export class LegalEntitiesService {
  constructor(
    private readonly s: NewcoSupport,
    private readonly audit: AuditService,
    private readonly versions: RecordVersionService,
    private readonly dims: StatusDimensionsService,
    private readonly evidence: EvidenceService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  /** Entity linked to the project (404 otherwise — other projects' entities are invisible). */
  async loadLinked(ctx: RequestContext, p: NewcoProject, entityId: string): Promise<{ entity: Entity; role: EntityKind }> {
    this.s.assertProjectRead(ctx, p, READ);
    const [r] = await this.tx
      .select({ e: LE, role: PE.role })
      .from(PE)
      .innerJoin(LE, eq(LE.id, PE.legalEntityId))
      .where(and(eq(PE.projectId, p.id), eq(PE.legalEntityId, entityId)))
      .orderBy(asc(PE.createdAt))
      .limit(1);
    if (!r) throw notFound();
    return { entity: r.e, role: r.role };
  }

  private async dtos(projectId: string, rows: { e: Entity; role: EntityKind }[]) {
    const names = await this.s.userNames(rows.flatMap((r) => [r.e.incorporationRecordedBy, r.e.incorporationVerifiedBy]));
    const ev = await this.s.evidenceCounts(projectId, 'legal_entity', rows.map((r) => r.e.id));
    return rows.map(({ e, role }) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      role,
      registrationRef: e.registrationRef,
      jurisdiction: e.jurisdiction,
      incorporation: {
        status: e.incorporationStatus as IncorporationStatus,
        verification: e.incorporationVerification as VerificationStatus,
        evidenceNote: e.incorporationEvidenceNote,
        recordedBy: this.s.person(names, e.incorporationRecordedBy),
        recordedAt: e.incorporationRecordedAt?.toISOString() ?? null,
        verifiedBy: this.s.person(names, e.incorporationVerifiedBy),
        verifiedAt: e.incorporationVerifiedAt?.toISOString() ?? null,
        verificationNote: e.incorporationVerificationNote,
      },
      evidence: ev.get(e.id) ?? { active: 0, conflicting: 0 },
      isDemo: e.isDemo,
      version: e.version,
    }));
  }

  async list(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectRead(ctx, p, READ);
    const rows = await this.tx.select({ e: LE, role: PE.role }).from(PE).innerJoin(LE, eq(LE.id, PE.legalEntityId)).where(eq(PE.projectId, projectId)).orderBy(asc(PE.role), asc(LE.name));
    return { items: await this.dtos(projectId, rows) };
  }

  async get(ctx: RequestContext, projectId: string, entityId: string) {
    const p = await this.s.project(ctx, projectId);
    const r = await this.loadLinked(ctx, p, entityId);
    const [dto] = await this.dtos(projectId, [{ e: r.entity, role: r.role }]);
    const RR = schema.regulatoryRequirement;
    const reqs = await this.tx
      .select({ id: RR.id, code: RR.code, title: RR.title, status: RR.status, applicability: RR.applicability })
      .from(RR)
      .where(and(eq(RR.projectId, projectId), eq(RR.legalEntityId, entityId), this.s.policy.visibilitySql(ctx, projectId, { classification: RR.classification })))
      .orderBy(asc(RR.code));
    // History: only snapshots recorded in THIS project (other projects' notes stay private to them).
    const hist = (await this.versions.history('legal_entity', entityId)).filter((h) => h.projectId === projectId);
    const hn = await this.s.userNames(hist.map((h) => h.changedBy));
    return {
      ...dto!,
      requirements: reqs,
      history: hist.map((h) => ({ versionNo: h.versionNo, reason: h.reason, changedByName: h.changedBy ? (hn.get(h.changedBy) ?? null) : null, changedAt: h.changedAt.toISOString() })),
    };
  }

  private async hasNewco(projectId: string) {
    const [x] = await this.tx.select({ id: PE.id }).from(PE).where(and(eq(PE.projectId, projectId), eq(PE.role, 'newco'))).limit(1);
    return !!x;
  }

  private async linkRow(ctx: RequestContext, p: NewcoProject, entityId: string, role: EntityKind) {
    if (role === 'newco' && (await this.hasNewco(p.id))) throw conflict('newco.already_linked', 'This project already has a NewCo legal entity');
    await this.tx.insert(PE).values({ id: newId(), orgId: ctx.principal.orgId, projectId: p.id, legalEntityId: entityId, role });
  }

  async create(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateLegalEntityBody>) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertManage(ctx, p, 'newco.legal_entity.manage');
    const id = newId();
    const role = body.role ?? body.kind;
    await this.tx.insert(LE).values({
      id,
      orgId: ctx.principal.orgId,
      name: body.name,
      kind: body.kind,
      registrationRef: body.registrationRef ?? null,
      jurisdiction: body.jurisdiction ?? null,
      // Never assumed: every entity starts unconfirmed with unknown verification (REQ-SET-010).
      incorporationStatus: 'unconfirmed',
      incorporationVerification: 'unknown',
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.linkRow(ctx, p, id, role);
    await this.versions.snapshot({ projectId, entityType: 'legal_entity', entityId: id, versionNo: 1, snapshot: { name: body.name, kind: body.kind, role, incorporationStatus: 'unconfirmed' }, reason: 'Created' });
    await this.audit.record({ action: 'newco.legal_entity.create', entityType: 'legal_entity', entityId: id, projectId, after: { name: body.name, kind: body.kind, role } });
    return { id, version: 1 };
  }

  /**
   * Link an existing entity: allowed only when the caller already sees it through another project where it holds
   * newco.register.read (so no entity of a project the caller cannot see is revealed).
   */
  async link(ctx: RequestContext, projectId: string, body: { legalEntityId: string; role: EntityKind }) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertManage(ctx, p, 'newco.legal_entity.manage');
    const links = await this.tx.select({ projectId: PE.projectId, role: PE.role }).from(PE).where(eq(PE.legalEntityId, body.legalEntityId));
    if (links.some((l) => l.projectId === projectId && l.role === body.role)) throw conflict('newco.already_linked', 'The entity is already linked with this role');
    const visibleElsewhere = links.some((l) => l.projectId !== projectId && this.s.policy.canInProject(ctx, READ, l.projectId));
    const alreadyHere = links.some((l) => l.projectId === projectId);
    if (!visibleElsewhere && !alreadyHere) throw notFound();
    const [e] = await this.tx.select().from(LE).where(eq(LE.id, body.legalEntityId));
    if (!e) throw notFound();
    await this.linkRow(ctx, p, e.id, body.role);
    await this.audit.record({ action: 'newco.legal_entity.link', entityType: 'legal_entity', entityId: e.id, projectId, after: { role: body.role } });
    return { id: e.id, version: e.version };
  }

  private async updateEntity(entity: Entity, expectedVersion: number, values: Partial<typeof schema.legalEntity.$inferInsert>): Promise<Entity> {
    assertVersion(entity, expectedVersion, 'legal entity');
    const r = await this.tx
      .update(LE)
      .set({ ...values, updatedAt: new Date(), version: sql`${LE.version} + 1` })
      .where(and(eq(LE.id, entity.id), eq(LE.version, expectedVersion)))
      .returning();
    if (!r[0]) throw conflict('concurrency.version_mismatch', 'The legal entity was changed by someone else — reload and review', { expectedVersion });
    return r[0];
  }

  async update(ctx: RequestContext, projectId: string, entityId: string, body: { expectedVersion: number; name?: string; registrationRef?: string | null; jurisdiction?: string | null }) {
    const p = await this.s.project(ctx, projectId);
    const { entity } = await this.loadLinked(ctx, p, entityId);
    this.s.assertManage(ctx, p, 'newco.legal_entity.manage');
    const u: Partial<typeof schema.legalEntity.$inferInsert> = {};
    if (body.name !== undefined) u.name = body.name;
    if (body.registrationRef !== undefined) u.registrationRef = body.registrationRef;
    if (body.jurisdiction !== undefined) u.jurisdiction = body.jurisdiction;
    if (Object.keys(u).length === 0) throw invalid('newco.no_changes', 'No changes supplied');
    const row = await this.updateEntity(entity, body.expectedVersion, u);
    await this.versions.snapshot({ projectId, entityType: 'legal_entity', entityId, versionNo: row.version, snapshot: row as unknown as Record<string, unknown>, reason: 'Descriptive update' });
    await this.audit.record({ action: 'newco.legal_entity.update', entityType: 'legal_entity', entityId, projectId, before: Object.fromEntries(Object.keys(u).map((k) => [k, (entity as Record<string, unknown>)[k]])), after: u as Record<string, unknown> });
    return { id: entityId, version: row.version };
  }

  /** Recompute the four status dimensions (gates module) and return them — incorporation alone never completes the carve-out. */
  private async dimensions(ctx: RequestContext, projectId: string) {
    await this.dims.recomputeDimensions(projectId);
    const v = await this.dims.get(ctx, projectId);
    return { items: v.items.map((d) => ({ key: d.key, state: d.state, explanation: d.explanation })), carveOutComplete: v.carveOutComplete };
  }

  async recordIncorporation(ctx: RequestContext, projectId: string, entityId: string, body: { expectedVersion: number; status: IncorporationStatus; evidenceNote?: string; note?: string }) {
    const p = await this.s.project(ctx, projectId);
    const { entity } = await this.loadLinked(ctx, p, entityId);
    this.s.assertManage(ctx, p, 'newco.incorporation.manage');
    const ev = await activeEvidenceCount(this.s.db, projectId, 'legal_entity', entityId);
    assertIncorporationRecord({ status: body.status, activeEvidence: ev.active, conflictingEvidence: ev.conflicting, note: body.note ?? null });
    const verification = verificationAfterRecord(body.status);
    const row = await this.updateEntity(entity, body.expectedVersion, {
      incorporationStatus: body.status,
      incorporationVerification: verification,
      incorporationEvidenceNote: body.evidenceNote ?? entity.incorporationEvidenceNote,
      incorporationRecordedBy: ctx.principal.userId,
      incorporationRecordedAt: new Date(),
      incorporationVerifiedBy: null,
      incorporationVerifiedAt: null,
      incorporationVerificationNote: null,
    });
    await this.versions.snapshot({ projectId, entityType: 'legal_entity', entityId, versionNo: row.version, snapshot: { incorporationStatus: body.status, incorporationVerification: verification, evidence: ev.active }, reason: `Incorporation recorded: ${body.status}` });
    await this.audit.record({
      action: 'newco.incorporation.record',
      entityType: 'legal_entity',
      entityId,
      projectId,
      before: { status: entity.incorporationStatus, verification: entity.incorporationVerification },
      after: { status: body.status, verification, activeEvidence: ev.active },
      reason: body.note ?? null,
    });
    return { id: entityId, version: row.version, status: body.status, verification, statusDimensions: await this.dimensions(ctx, projectId) };
  }

  async verifyIncorporation(ctx: RequestContext, projectId: string, entityId: string, body: { expectedVersion: number; outcome: 'confirm' | 'reject'; note?: string }) {
    const p = await this.s.project(ctx, projectId);
    const { entity } = await this.loadLinked(ctx, p, entityId);
    const recordedBy = entity.incorporationRecordedBy ?? entity.createdBy;
    // Separation of duties (not_self): the recorder of the status cannot verify it.
    this.s.policy.assert(ctx, 'newco.incorporation.verify', { projectId, classification: p.classification, requesterUserId: recordedBy });
    const ev = await activeEvidenceCount(this.s.db, projectId, 'legal_entity', entityId);
    const verification = assertIncorporationVerification({
      outcome: body.outcome,
      status: entity.incorporationStatus as IncorporationStatus,
      verification: entity.incorporationVerification as VerificationStatus,
      activeEvidence: ev.active,
      conflictingEvidence: ev.conflicting,
      verifierUserId: ctx.principal.userId!,
      recordedBy,
      note: body.note ?? null,
    });
    const row = await this.updateEntity(entity, body.expectedVersion, {
      incorporationVerification: verification,
      incorporationVerifiedBy: ctx.principal.userId,
      incorporationVerifiedAt: new Date(),
      incorporationVerificationNote: body.note ?? null,
    });
    await this.versions.snapshot({ projectId, entityType: 'legal_entity', entityId, versionNo: row.version, snapshot: { incorporationStatus: entity.incorporationStatus, incorporationVerification: verification, evidence: ev.active }, reason: `Incorporation ${body.outcome === 'confirm' ? 'verified' : 'verification rejected'}` });
    await this.audit.record({
      action: 'newco.incorporation.verify',
      entityType: 'legal_entity',
      entityId,
      projectId,
      before: { verification: entity.incorporationVerification },
      after: { status: entity.incorporationStatus, verification, outcome: body.outcome, activeEvidence: ev.active },
      reason: body.note ?? null,
    });
    return { id: entityId, version: row.version, status: entity.incorporationStatus as IncorporationStatus, verification, statusDimensions: await this.dimensions(ctx, projectId) };
  }

  /** Setup wizard step 2 (REQ-SET-010): NewCo status with evidence; "incorporated" without evidence is rejected. */
  async setupNewcoStatus(ctx: RequestContext, projectId: string, body: z.infer<typeof SetupNewcoStatusBody>) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertManage(ctx, p, 'newco.incorporation.manage');
    let entityId: string;
    if (body.mode === 'existing') {
      const { entity, role } = await this.loadLinked(ctx, p, body.legalEntityId!);
      if (role !== 'newco' && entity.kind !== 'newco') throw invalid('newco.not_newco', 'The selected entity is not the project NewCo');
      entityId = entity.id;
    } else {
      this.s.assertManage(ctx, p, 'newco.legal_entity.manage');
      entityId = (await this.create(ctx, projectId, { name: body.name!.trim(), kind: 'newco', role: 'newco', registrationRef: body.registrationRef })).id;
    }
    if (body.evidence && (body.evidence.documentId || body.evidence.documentVersionId || body.evidence.note?.trim())) {
      // Evidence is written by the documents module (it owns evidence_link).
      await this.evidence.link(ctx, projectId, { targetType: 'legal_entity', targetId: entityId, documentId: body.evidence.documentId, documentVersionId: body.evidence.documentVersionId, note: body.evidence.note, purpose: 'Incorporation status (setup wizard step 2)' });
    }
    const [e] = await this.tx.select().from(LE).where(eq(LE.id, entityId));
    if (body.mode === 'existing' && body.registrationRef !== undefined && e!.registrationRef !== body.registrationRef) {
      await this.update(ctx, projectId, entityId, { expectedVersion: e!.version, registrationRef: body.registrationRef });
    }
    const [fresh] = await this.tx.select().from(LE).where(eq(LE.id, entityId));
    return this.recordIncorporation(ctx, projectId, entityId, { expectedVersion: fresh!.version, status: body.status, note: body.note });
  }
}

export type { Classification };
