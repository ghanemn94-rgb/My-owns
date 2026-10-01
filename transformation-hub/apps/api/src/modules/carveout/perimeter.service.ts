import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, notInArray, or, sql, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  Classification,
  ConsentStatus,
  ContractTransferClass,
  ImpactEntry,
  ImpactInput,
  ImpactRef,
  PerimeterDisposition,
  PerimeterItemType,
  PerimeterScope,
  TRANSFER_MACHINE,
  TransferStatus,
  allowedCommands,
  assertTransferCommand,
  changeRequestImpacts,
  combinedTransferStatus,
  conflict,
  day1ContractPosition,
  derivePerimeterImpacts,
  forbidden,
  invalid,
  isContractLike,
  isInScope,
  notFound,
  perimeterChangeControl,
  perimeterHistoryReason,
  perimeterHistoryReasonI18n,
  reconcilePerimeterRegister,
  ruleViolation,
  sameScope,
  withheldImpactEntry,
} from '@hub/domain';
import type { z } from 'zod';
import type {
  ClassifyPerimeterItemBody,
  CreatePerimeterItemBody,
  CreateSiteBody,
  ImpactNarrative,
  InterimArrangementBody,
  PerimeterListQuery,
  TransferabilityBody,
  UpdatePerimeterItemBody,
  UpdateSiteBody,
} from '@hub/contracts';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { RecordVersionService, assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { ChangeControlService } from '../planning/change-control.service';
import { CarveoutProject, CarveoutSupport, iso } from './carveout.support';

type Item = typeof schema.perimeterItem.$inferSelect;
type Narrative = z.infer<typeof ImpactNarrative>;
const PI = schema.perimeterItem;
const READ = 'carveout.register.read';
const MANAGE = 'carveout.perimeter.manage';
/** Specialist transferability classes that need a counterparty consent / novation (AT-08). */
const CLASSES_REQUIRING_CONSENT: readonly ContractTransferClass[] = ['consent_required', 'novation_required'];

/** Scope attributes of an item (bound to change requests). */
const scopeOf = (i: Pick<Item, 'disposition' | 'siteId' | 'currentEntityId' | 'targetEntityId'>): PerimeterScope => ({
  disposition: i.disposition as PerimeterDisposition,
  siteId: i.siteId ?? null,
  currentEntityId: i.currentEntityId ?? null,
  targetEntityId: i.targetEntityId ?? null,
});

/**
 * Transaction perimeter register (spec §7.1; AT-07, AT-08; REQ-PER-001..006, REQ-AGR-006/008): sites, perimeter items,
 * scope changes under change control, cross-module impact assessments, specialist transferability, Day-1 contract
 * positions, category coverage and reconciliation. Transfers are in TransfersService; versions in PerimeterVersionsService.
 */
@Injectable()
export class PerimeterService {
  constructor(
    private readonly s: CarveoutSupport,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly versions: RecordVersionService,
    private readonly changeControl: ChangeControlService,
  ) {}

  private get tx() {
    return this.s.db.tx();
  }

  // =========================================================================================================
  // Sites

  async listSites(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertRead(ctx, READ, { projectId, classification: p.classification });
    const rows = await this.tx.select().from(schema.site).where(eq(schema.site.projectId, projectId)).orderBy(asc(schema.site.code));
    return { items: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, city: r.city, kind: r.kind, notes: r.notes, isDemo: r.isDemo, version: r.version })) };
  }

  async createSite(ctx: RequestContext, projectId: string, body: z.infer<typeof CreateSiteBody>) {
    const p = await this.s.project(ctx, projectId);
    this.s.policy.assert(ctx, MANAGE, { projectId, classification: p.classification, ownerUserIds: [ctx.principal.userId] });
    const code = await nextCode(this.s.db, schema.site, projectId, 'SITE');
    const id = newId();
    await this.tx.insert(schema.site).values({ id, orgId: p.orgId, projectId, code, name: body.name, city: body.city ?? null, kind: body.kind, notes: body.notes ?? null, isDemo: p.isDemo, createdBy: ctx.principal.userId });
    await this.audit.record({ action: 'carveout.site.create', entityType: 'site', entityId: id, projectId, after: { code, name: body.name, kind: body.kind } });
    return { id, code, version: 1 };
  }

  async updateSite(ctx: RequestContext, projectId: string, siteId: string, body: z.infer<typeof UpdateSiteBody>) {
    const p = await this.s.project(ctx, projectId);
    const site = await loadInProject(this.s.db, schema.site, projectId, siteId);
    this.s.policy.assert(ctx, MANAGE, { projectId, classification: p.classification, ownerUserIds: [site.createdBy] });
    const u: Partial<typeof schema.site.$inferInsert> = {};
    if (body.name !== undefined) u.name = body.name;
    if (body.city !== undefined) u.city = body.city;
    if (body.kind !== undefined) u.kind = body.kind;
    if (body.notes !== undefined) u.notes = body.notes;
    if (Object.keys(u).length === 0) throw invalid('carveout.no_changes', 'No changes supplied');
    const row = await updateVersioned(this.s.db, schema.site, { id: siteId, projectId, expectedVersion: body.expectedVersion }, u);
    await this.audit.record({ action: 'carveout.site.update', entityType: 'site', entityId: siteId, projectId, before: pick(site, Object.keys(u)), after: u });
    return { id: siteId, version: row['version'] as number };
  }

  // =========================================================================================================
  // Authorization helpers

  private itemAttrs(p: CarveoutProject, item: Pick<Item, 'classification' | 'workstreamId' | 'ownerUserId' | 'createdBy'>) {
    return { projectId: p.id, classification: item.classification as Classification, workstreamId: item.workstreamId, ownerUserIds: [item.ownerUserId, item.createdBy] };
  }

  /** Load an item the caller may read (404 otherwise — classification, workstream reach). */
  async loadReadable(ctx: RequestContext, p: CarveoutProject, itemId: string): Promise<Item> {
    const item = await loadInProject(this.s.db, PI, p.id, itemId);
    this.s.assertRead(ctx, READ, { projectId: p.id, classification: item.classification as Classification, workstreamId: item.workstreamId });
    return item;
  }

  /** Load an item for a mutation with `permission` (visible first → 404; then RBAC/ABAC → 403). */
  async loadForManage(ctx: RequestContext, p: CarveoutProject, itemId: string, permission: string): Promise<Item> {
    const item = await this.loadReadable(ctx, p, itemId);
    this.s.policy.assert(ctx, permission, this.itemAttrs(p, item));
    return item;
  }

  private canSeeReferenceValues(ctx: RequestContext, projectId: string) {
    return this.s.policy.permissionReach(ctx, 'finance.record.read', projectId).all;
  }

  // =========================================================================================================
  // Reads

  async listItems(ctx: RequestContext, projectId: string, q: z.infer<typeof PerimeterListQuery>) {
    const p = await this.s.project(ctx, projectId);
    const conds: SQL[] = [
      eq(PI.projectId, projectId),
      this.s.policy.visibilitySql(ctx, projectId, { classification: PI.classification }),
      this.s.policy.reachSql(ctx, READ, projectId, PI.workstreamId),
    ];
    if (q.type) conds.push(eq(PI.type, q.type));
    if (q.disposition) conds.push(eq(PI.disposition, q.disposition));
    if (q.siteId) conds.push(eq(PI.siteId, q.siteId));
    if (q.workstreamId) conds.push(eq(PI.workstreamId, q.workstreamId));
    if (q.q) conds.push(or(ilike(PI.name, likeContains(q.q)), ilike(PI.code, likeContains(q.q)))!);
    const where = and(...conds);
    const [{ n }] = (await this.tx.select({ n: count() }).from(PI).where(where)) as [{ n: number }];
    const order = orderBySort(q.sort, { code: PI.code, name: PI.name, type: PI.type, disposition: PI.disposition, updatedAt: PI.updatedAt }, PI.id, [asc(PI.code), asc(PI.id)]);
    const rows = await this.tx.select().from(PI).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    void p;
    return pageOf(await this.summaries(projectId, rows), Number(n), q);
  }

  private async summaries(projectId: string, rows: Item[]) {
    const siteIds = rows.map((r) => r.siteId).filter((x): x is string => !!x);
    const wsIds = rows.map((r) => r.workstreamId).filter((x): x is string => !!x);
    const crIds = rows.map((r) => r.pendingChangeRequestId).filter((x): x is string => !!x);
    const sites = siteIds.length ? await this.tx.select({ id: schema.site.id, code: schema.site.code }).from(schema.site).where(and(eq(schema.site.projectId, projectId), inArray(schema.site.id, siteIds))) : [];
    const wss = wsIds.length ? await this.tx.select({ id: schema.workstream.id, code: schema.workstream.code }).from(schema.workstream).where(and(eq(schema.workstream.projectId, projectId), inArray(schema.workstream.id, wsIds))) : [];
    const crs = crIds.length
      ? await this.tx.select({ id: schema.changeRequest.id, code: schema.changeRequest.code, status: schema.changeRequest.status }).from(schema.changeRequest).where(and(eq(schema.changeRequest.projectId, projectId), inArray(schema.changeRequest.id, crIds)))
      : [];
    const names = await this.s.userNames(rows.map((r) => r.ownerUserId));
    const scope = await this.s.baselineScope(projectId);
    const siteM = new Map(sites.map((x) => [x.id, x.code]));
    const wsM = new Map(wss.map((x) => [x.id, x.code]));
    const crM = new Map(crs.map((x) => [x.id, x]));
    return rows.map((r) => {
      const legal = r.transferStatus as TransferStatus;
      const economic = r.economicTransferStatus as TransferStatus;
      const cr = r.pendingChangeRequestId ? crM.get(r.pendingChangeRequestId) : undefined;
      return {
        id: r.id,
        code: r.code,
        type: r.type as PerimeterItemType,
        name: r.name,
        siteId: r.siteId,
        siteCode: r.siteId ? (siteM.get(r.siteId) ?? null) : null,
        workstreamId: r.workstreamId,
        workstreamCode: r.workstreamId ? (wsM.get(r.workstreamId) ?? null) : null,
        owner: this.s.person(names, r.ownerUserId),
        disposition: r.disposition as PerimeterDisposition,
        transfer: { legal, economic, combined: combinedTransferStatus(legal, economic) },
        transferClass: r.transferClass as ContractTransferClass,
        consentRequired: r.consentRequired,
        pendingChange: cr ? { id: cr.id, code: cr.code, status: cr.status as string } : null,
        inApprovedBaseline: !!scope.planning?.itemIds.has(r.id) || !!scope.perimeterVersion?.itemIds.has(r.id),
        classification: r.classification as Classification,
        isDemo: r.isDemo,
        version: r.version,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  /**
   * SEC-P34-07: consents shown with a perimeter item / Day-1 position — only those the CALLER may read in the consent
   * register (project-wide `carveout.register.read`, consent classification ≤ clearance), filtered in SQL. Rules (Day-1
   * position, transfer guards, reconciliation) keep using `consentsOf`, which sees every consent.
   */
  async visibleConsentsOf(ctx: RequestContext, projectId: string, itemIds: string[]) {
    if (itemIds.length === 0 || !this.s.policy.permissionReach(ctx, READ, projectId).all) return new Map<string, { id: string; code: string; kind: string; counterparty: string; status: ConsentStatus; dueDate: string | null }[]>();
    return this.consentsOf(projectId, itemIds, this.s.policy.visibilitySql(ctx, projectId, { classification: schema.consent.classification }));
  }

  async consentsOf(projectId: string, itemIds: string[], visible?: SQL) {
    if (itemIds.length === 0) return new Map<string, { id: string; code: string; kind: string; counterparty: string; status: ConsentStatus; dueDate: string | null }[]>();
    const rows = await this.tx
      .select({ id: schema.consent.id, code: schema.consent.code, kind: schema.consent.kind, counterparty: schema.consent.counterparty, status: schema.consent.status, dueDate: schema.consent.dueDate, itemId: schema.consent.perimeterItemId })
      .from(schema.consent)
      .where(and(eq(schema.consent.projectId, projectId), inArray(schema.consent.perimeterItemId, itemIds), visible))
      .orderBy(asc(schema.consent.code));
    const m = new Map<string, { id: string; code: string; kind: string; counterparty: string; status: ConsentStatus; dueDate: string | null }[]>();
    for (const r of rows) {
      const list = m.get(r.itemId!) ?? [];
      list.push({ id: r.id, code: r.code, kind: r.kind, counterparty: r.counterparty, status: r.status as ConsentStatus, dueDate: r.dueDate });
      m.set(r.itemId!, list);
    }
    return m;
  }

  day1Dto(item: Item, consentStatuses: ConsentStatus[], names: Map<string, string>) {
    const pos = day1ContractPosition(
      {
        type: item.type as PerimeterItemType,
        disposition: item.disposition as PerimeterDisposition,
        transferClass: item.transferClass as ContractTransferClass,
        transferClassAssessedBy: item.transferClassAssessedBy,
        interimArrangement: item.interimArrangement,
        serviceAccountableUserId: item.serviceAccountableUserId,
        billingAccountableUserId: item.billingAccountableUserId,
        slaAccountableUserId: item.slaAccountableUserId,
        remediationPlan: item.remediationPlan,
      },
      consentStatuses,
    );
    return {
      applicable: pos.applicable,
      consentGranted: pos.consentGranted,
      ok: pos.ok,
      missing: pos.missing,
      interimArrangement: item.interimArrangement,
      serviceAccountable: this.s.person(names, item.serviceAccountableUserId),
      billingAccountable: this.s.person(names, item.billingAccountableUserId),
      slaAccountable: this.s.person(names, item.slaAccountableUserId),
      remediationPlan: item.remediationPlan,
    };
  }

  async getItem(ctx: RequestContext, projectId: string, itemId: string) {
    const p = await this.s.project(ctx, projectId);
    const item = await this.loadReadable(ctx, p, itemId);
    return this.detail(ctx, p, item);
  }

  private async detail(ctx: RequestContext, p: CarveoutProject, item: Item) {
    const [summary] = await this.summaries(p.id, [item]);
    // The Day-1 rule sees every consent; the list shown is filtered by the caller's register read (SEC-P34-07).
    const consents = (await this.consentsOf(p.id, [item.id])).get(item.id) ?? [];
    const shownConsents = (await this.visibleConsentsOf(ctx, p.id, [item.id])).get(item.id) ?? [];
    const names = await this.s.userNames([item.ownerUserId, item.transferClassAssessedBy, item.serviceAccountableUserId, item.billingAccountableUserId, item.slaAccountableUserId]);
    const ents = await this.s.entityNames([item.currentEntityId, item.targetEntityId]);
    let agreement: { id: string; code: string } | null = null;
    if (item.agreementId) {
      const [a] = await this.tx.select({ id: schema.agreement.id, code: schema.agreement.code, classification: schema.agreement.classification }).from(schema.agreement).where(and(eq(schema.agreement.projectId, p.id), eq(schema.agreement.id, item.agreementId)));
      if (a && this.s.policy.canSee(ctx, { projectId: p.id, classification: a.classification as Classification })) agreement = { id: a.id, code: a.code };
    }
    const transfers = await this.transferRows(p.id, [item.id], item.code);
    // Display counters: the evidence list's visibility (SEC-P1R-05).
    const ev = await this.s.visibleEvidenceCounts(ctx, p.id, 'perimeter_item', [item.id]);
    const evT = await this.s.visibleEvidenceCounts(ctx, p.id, 'transfer', [item.id]);
    const hist = await this.versions.history('perimeter_item', item.id);
    const histNames = await this.s.userNames(hist.map((h) => h.changedBy));
    const seeValue = this.canSeeReferenceValues(ctx, p.id);
    const hasValue = !!item.reference_valueAmount;
    return {
      ...summary!,
      description: item.description,
      currentEntity: item.currentEntityId ? { id: item.currentEntityId, name: ents.get(item.currentEntityId) ?? '' } : null,
      targetEntity: item.targetEntityId ? { id: item.targetEntityId, name: ents.get(item.targetEntityId) ?? '' } : null,
      resolutionPath: item.resolutionPath,
      targetGateKey: item.targetGateKey,
      legalOwner: item.legalOwner,
      operator: item.operator,
      economicBeneficiary: item.economicBeneficiary,
      legalDates: { planned: item.plannedEffectiveDate, actual: item.actualEffectiveDate },
      economicDates: { planned: item.economicPlannedEffectiveDate, actual: item.economicActualEffectiveDate },
      transferMechanism: item.transferMechanism,
      agreement,
      referenceValue: seeValue && hasValue ? { amount: item.reference_valueAmount!, currency: item.reference_valueCurrency!, unitScale: item.reference_valueUnitScale as 1 | 1000 | 1000000 } : null,
      referenceValueRestricted: !seeValue && hasValue,
      referenceValueSource: seeValue ? item.referenceValueSource : null,
      dependencies: item.dependencies,
      risks: item.risks,
      acceptanceEvidenceNote: item.acceptanceEvidenceNote,
      transferClassAssessment: { assessedBy: this.s.person(names, item.transferClassAssessedBy), assessedAt: iso(item.transferClassAssessedAt), basis: item.transferClassBasis },
      day1: this.day1Dto(item, consents.map((c) => c.status), names),
      consents: shownConsents,
      transfers,
      evidence: { item: ev.get(item.id) ?? { active: 0, conflicting: 0 }, transfer: evT.get(item.id) ?? { active: 0, conflicting: 0 } },
      history: hist.map((h) => ({ versionNo: h.versionNo, reason: h.reason, reasonI18n: perimeterHistoryReasonI18n(h.reason), changedByName: h.changedBy ? (histNames.get(h.changedBy) ?? null) : null, changedAt: h.changedAt.toISOString() })),
      allowedTransferCommands: {
        legal: allowedCommands(TRANSFER_MACHINE, item.transferStatus as TransferStatus),
        economic: allowedCommands(TRANSFER_MACHINE, item.economicTransferStatus as TransferStatus),
      },
      verificationStatus: item.verificationStatus,
      createdAt: item.createdAt.toISOString(),
    };
  }

  async transferRows(projectId: string, itemIds: string[], code: string) {
    const TR = schema.transferRecord;
    const rows = await this.tx.select().from(TR).where(and(eq(TR.projectId, projectId), inArray(TR.perimeterItemId, itemIds))).orderBy(desc(TR.recordedAt), desc(TR.id));
    const names = await this.s.userNames(rows.map((r) => r.recordedBy));
    return rows.map((r) => ({
      id: r.id,
      perimeterItemId: r.perimeterItemId,
      itemCode: code,
      aspect: r.aspect as 'legal' | 'economic',
      command: r.command,
      fromStatus: r.fromStatus as TransferStatus,
      toStatus: r.toStatus as TransferStatus,
      mechanism: r.mechanism,
      effectiveDate: r.effectiveDate,
      note: r.note,
      evidenceCount: r.evidenceCount,
      reviewsRecordId: r.reviewsRecordId,
      recordedBy: r.recordedBy,
      recordedByName: names.get(r.recordedBy) ?? null,
      recordedAt: r.recordedAt.toISOString(),
    }));
  }

  // =========================================================================================================
  // Validation of references

  private async validateRefs(
    ctx: RequestContext,
    p: CarveoutProject,
    b: { siteId?: string | null; workstreamId?: string | null; ownerUserId?: string | null; currentEntityId?: string | null; targetEntityId?: string | null; agreementId?: string | null },
  ) {
    if (b.siteId) await loadInProject(this.s.db, schema.site, p.id, b.siteId);
    if (b.workstreamId) await loadInProject(this.s.db, schema.workstream, p.id, b.workstreamId);
    if (b.ownerUserId) await this.s.assertMember(p.id, b.ownerUserId, 'owner');
    if (b.currentEntityId) await this.s.assertEntityInProject(p.id, b.currentEntityId, 'current entity');
    if (b.targetEntityId) await this.s.assertEntityInProject(p.id, b.targetEntityId, 'target entity');
    if (b.agreementId) {
      const a = await loadInProject(this.s.db, schema.agreement, p.id, b.agreementId);
      if (!this.s.policy.canSee(ctx, { projectId: p.id, classification: a.classification as Classification })) throw notFound();
    }
  }

  // =========================================================================================================
  // Change control (AT-07)

  /**
   * Whether a scope change needs a change request. Existence of an approved baseline is read directly; when one exists,
   * the authoritative membership check is ChangeControlService.isInApprovedBaseline / currentBaseline (planning).
   */
  private async changeControlFor(ctx: RequestContext, p: CarveoutProject, item: Item | null, toDisposition: PerimeterDisposition, newItemWorkstreamId: string | null = null) {
    const scope = await this.s.baselineScope(p.id);
    let planningApproved = false;
    let inPlanning = false;
    if (scope.planning) {
      if (item) {
        const r = await this.changeControl.isInApprovedBaseline(ctx, p.id, 'perimeter_item', item.id);
        planningApproved = r.baselineExists;
        inPlanning = r.inBaseline;
      } else {
        // A new item: read the baseline through the item's workstream (workstream-scoped leads — planning reach).
        planningApproved = !!(await this.changeControl.currentBaseline(ctx, p.id, { workstreamId: newItemWorkstreamId })).baseline;
      }
    }
    const inVersion = !!item && !!scope.perimeterVersion?.itemIds.has(item.id);
    const cc = perimeterChangeControl({
      baselineApproved: planningApproved || !!scope.perimeterVersion,
      planningBaselineApproved: planningApproved,
      itemInBaseline: inPlanning || inVersion,
      itemInPlanningBaseline: inPlanning,
      isNewItem: !item,
      fromDisposition: (item?.disposition as PerimeterDisposition | undefined) ?? null,
      toDisposition,
    });
    return { ...cc, scope };
  }

  /** Gather cross-module references the CALLER may see (null = register not visible → no titles, no counts). */
  private async impactInput(ctx: RequestContext, p: CarveoutProject, item: Item, change: ImpactInput['change']): Promise<ImpactInput> {
    const pid = p.id;
    const reach = (perm: string) => this.s.policy.permissionReach(ctx, perm, pid);
    const agreementsVisible = reach(READ).all;
    let agreements: ImpactRef[] | null = null;
    let consents: ImpactRef[] | null = null;
    if (agreementsVisible) {
      agreements = [];
      if (item.agreementId) {
        const [a] = await this.tx
          .select({ id: schema.agreement.id, code: schema.agreement.code })
          .from(schema.agreement)
          .where(and(eq(schema.agreement.projectId, pid), eq(schema.agreement.id, item.agreementId), this.s.policy.visibilitySql(ctx, pid, { classification: schema.agreement.classification })));
        if (a) agreements.push({ type: 'agreement', id: a.id, code: a.code });
      }
      const cs = await this.tx
        .select({ id: schema.consent.id, code: schema.consent.code })
        .from(schema.consent)
        .where(and(eq(schema.consent.projectId, pid), eq(schema.consent.perimeterItemId, item.id), this.s.policy.visibilitySql(ctx, pid, { classification: schema.consent.classification })));
      consents = cs.map((c) => ({ type: 'consent', id: c.id, code: c.code }));
    }
    let tsaServices: ImpactRef[] | null = null;
    let readinessChecks: ImpactRef[] | null = null;
    if (reach('readiness.register.read').all) {
      tsaServices = item.agreementId
        ? (await this.tx.select({ id: schema.tsaService.id, code: schema.tsaService.code }).from(schema.tsaService).where(and(eq(schema.tsaService.projectId, pid), eq(schema.tsaService.agreementId, item.agreementId)))).map((t) => ({ type: 'tsa_service', id: t.id, code: t.code }))
        : [];
      readinessChecks = item.siteId
        ? (await this.tx.select({ id: schema.readinessCheck.id, code: schema.readinessCheck.code }).from(schema.readinessCheck).where(and(eq(schema.readinessCheck.projectId, pid), eq(schema.readinessCheck.siteId, item.siteId))).orderBy(asc(schema.readinessCheck.code))).map((r) => ({ type: 'readiness_check', id: r.id, code: r.code }))
        : [];
    }
    let milestones: ImpactRef[] | null = null;
    const planReach = this.s.policy.permissionReach(ctx, 'planning.plan.read', pid);
    if (planReach.all || (item.workstreamId && planReach.workstreamIds.includes(item.workstreamId))) {
      milestones = item.workstreamId
        ? (
            await this.tx
              .select({ id: schema.milestone.id, code: schema.milestone.code })
              .from(schema.milestone)
              .where(and(eq(schema.milestone.projectId, pid), eq(schema.milestone.workstreamId, item.workstreamId), notInArray(schema.milestone.status, ['achieved_verified', 'cancelled'])))
              .orderBy(asc(schema.milestone.code))
          ).map((m) => ({ type: 'milestone', id: m.id, code: m.code }))
        : [];
    }
    let budgetLines: ImpactRef[] | null = null;
    if (reach('finance.record.read').all) {
      budgetLines = item.workstreamId
        ? (
            await this.tx
              .select({ id: schema.budgetLine.id, code: schema.budgetLine.code })
              .from(schema.budgetLine)
              .where(and(eq(schema.budgetLine.projectId, pid), eq(schema.budgetLine.workstreamId, item.workstreamId), this.s.policy.visibilitySql(ctx, pid, { classification: schema.budgetLine.classification })))
              .orderBy(asc(schema.budgetLine.code))
          ).map((b) => ({ type: 'budget_line', id: b.id, code: b.code }))
        : [];
    }
    return { change, agreements, consents, tsaServices, readinessChecks, milestones, budgetLines, hasSite: !!item.siteId, hasWorkstream: !!item.workstreamId };
  }

  private async recordImpact(ctx: RequestContext, p: CarveoutProject, itemId: string, entries: ImpactEntry[], narrative: Narrative | undefined, trigger: 'manual' | 'change_request', changeRequestId: string | null) {
    const id = newId();
    const clean = Object.fromEntries(Object.entries(narrative ?? {}).filter(([, v]) => typeof v === 'string' && v.trim().length > 0)) as Record<string, string>;
    await this.tx.insert(schema.perimeterImpactAssessment).values({
      id,
      orgId: p.orgId,
      projectId: p.id,
      perimeterItemId: itemId,
      changeRequestId,
      trigger,
      entries: entries as unknown as Record<string, unknown>[],
      narrative: clean,
      assessedBy: ctx.principal.userId!,
    });
    return { id, narrative: clean };
  }

  /** Raise the change request (planning) for a post-baseline scope change and hold the item's scope unchanged. */
  private async raiseChangeRequest(
    ctx: RequestContext,
    p: CarveoutProject,
    item: Item,
    kind: 'add' | 'reclassify',
    from: PerimeterScope,
    to: PerimeterScope,
    cc: { rebaseline: boolean; entersScope: boolean; leavesScope: boolean; scope: Awaited<ReturnType<CarveoutSupport['baselineScope']>> },
    justification: string,
    narrative: Narrative | undefined,
  ) {
    const scopeAttributesChanged = from.siteId !== to.siteId || from.currentEntityId !== to.currentEntityId || from.targetEntityId !== to.targetEntityId;
    const entries = derivePerimeterImpacts(await this.impactInput(ctx, p, item, { kind, itemCode: item.code, itemType: item.type as PerimeterItemType, fromDisposition: kind === 'add' ? null : from.disposition, toDisposition: to.disposition, scopeAttributesChanged }));
    const summary =
      kind === 'add'
        ? `Add perimeter item ${item.code} (${item.type}) as ${to.disposition} after baseline approval.`
        : `Change perimeter item ${item.code}: disposition ${from.disposition} → ${to.disposition}${scopeAttributesChanged ? '; site/entity attributes changed' : ''}.`;
    const impacts = changeRequestImpacts(entries, `${summary} ${justification}`.trim());
    for (const [area, text] of Object.entries(narrative ?? {})) {
      if (!text?.trim()) continue;
      const key = area === 'financial_statements' || area === 'valuation' ? 'financial' : area === 'agreements' ? 'transaction' : area === 'schedule' ? 'time' : area === 'budget' ? 'cost' : (area as 'tsa' | 'readiness' | 'transaction');
      impacts[key] = `${impacts[key]} Specialist note: ${text}`.slice(0, 2000);
    }
    const cr = await this.changeControl.createChangeRequestFor(ctx, {
      projectId: p.id,
      subjectType: 'perimeter_item',
      subjectId: item.id,
      title: kind === 'add' ? `Perimeter addition ${item.code} after baseline` : `Perimeter change ${item.code} after baseline`,
      rationale: justification,
      impacts,
      proposedChange: {
        kind,
        perimeterItemId: item.id,
        itemCode: item.code,
        from,
        to,
        entersScope: cc.entersScope,
        leavesScope: cc.leavesScope,
        planningBaselineId: cc.scope.planning?.id ?? null,
        perimeterVersionId: cc.scope.perimeterVersion?.id ?? null,
      },
      rebaseline: cc.rebaseline,
      submit: true,
    });
    const impact = await this.recordImpact(ctx, p, item.id, entries, narrative, 'change_request', cr.id);
    return { cr, impactId: impact.id };
  }

  /** The item is frozen into the approved planning baseline or the approved perimeter version (AT-07). */
  async inApprovedBaseline(projectId: string, itemId: string): Promise<boolean> {
    const scope = await this.s.baselineScope(projectId);
    return !!scope.planning?.itemIds.has(itemId) || !!scope.perimeterVersion?.itemIds.has(itemId);
  }

  /**
   * DOM-P3-05 / AT-07: after baseline approval, declaring that an aspect of an in-baseline Included / Shared item does not
   * transfer changes the transferring scope — raised as a change request (impact assessment recorded), the item held
   * unchanged until the approved request is applied (`applyChange`, kind `transfer_not_applicable`).
   */
  async raiseTransferNotApplicableChange(ctx: RequestContext, p: CarveoutProject, item: Item, aspect: 'legal' | 'economic', fromStatus: TransferStatus, note: string) {
    const scope = scopeOf(item);
    const entries = derivePerimeterImpacts(
      await this.impactInput(ctx, p, item, { kind: 'reclassify', itemCode: item.code, itemType: item.type as PerimeterItemType, fromDisposition: scope.disposition, toDisposition: scope.disposition, scopeAttributesChanged: true }),
    );
    const summary = `Declare the ${aspect} transfer of perimeter item ${item.code} (${item.disposition}) not applicable after baseline approval.`;
    const cr = await this.changeControl.createChangeRequestFor(ctx, {
      projectId: p.id,
      subjectType: 'perimeter_item',
      subjectId: item.id,
      title: `Transfer not applicable (${aspect}) ${item.code} after baseline`,
      rationale: note,
      impacts: changeRequestImpacts(entries, `${summary} ${note}`.trim()),
      proposedChange: { kind: 'transfer_not_applicable', perimeterItemId: item.id, itemCode: item.code, aspect, fromStatus, note, scope },
      rebaseline: false,
      submit: true,
    });
    await this.recordImpact(ctx, p, item.id, entries, undefined, 'change_request', cr.id);
    const row = await updateVersioned(this.s.db, PI, { id: item.id, projectId: p.id, expectedVersion: item.version }, { pendingChangeRequestId: cr.id });
    const itemVersion = row['version'] as number;
    await this.versions.snapshot({ projectId: p.id, entityType: 'perimeter_item', entityId: item.id, versionNo: itemVersion, snapshot: row, reason: perimeterHistoryReason('perimeter.history.aspect_not_applicable_requested', { cr: cr.code, aspect, note }) });
    await this.audit.record({
      action: 'carveout.transfer.not_applicable_requested',
      entityType: 'perimeter_item',
      entityId: item.id,
      projectId: p.id,
      before: { aspect, status: fromStatus },
      after: { aspect, requested: 'not_applicable', changeRequestId: cr.id, applied: false },
      reason: note,
    });
    await this.outbox.emit({ type: 'perimeter.changed', projectId: p.id, aggregateType: 'perimeter_item', aggregateId: item.id, payload: { change: 'change_requested', changeRequestId: cr.id } });
    return { itemVersion, changeRequest: { id: cr.id, code: cr.code, status: cr.status as string } };
  }

  // =========================================================================================================
  // Commands

  async createItem(ctx: RequestContext, projectId: string, body: z.infer<typeof CreatePerimeterItemBody>) {
    const p = await this.s.project(ctx, projectId);
    const classification = body.classification ?? 'confidential';
    this.s.assertClassificationAllowed(ctx, classification);
    this.s.policy.assert(ctx, MANAGE, { projectId, classification, workstreamId: body.workstreamId ?? null, ownerUserIds: [ctx.principal.userId] });
    await this.validateRefs(ctx, p, body);
    if (body.referenceValue && !this.canSeeReferenceValues(ctx, projectId)) {
      throw forbidden('carveout.reference_value_restricted', 'Reference values are recorded by holders of finance.record.read');
    }
    const cc = await this.changeControlFor(ctx, p, null, body.disposition, body.workstreamId ?? null);
    if (cc.requiresChangeRequest && !body.justification?.trim()) {
      throw ruleViolation('perimeter.justification_required', 'An approved baseline exists: adding an item raises a change request — state the justification');
    }
    const id = newId();
    const code = await nextCode(this.s.db, PI, projectId, 'PI');
    const requested: PerimeterScope = { disposition: body.disposition, siteId: body.siteId ?? null, currentEntityId: body.currentEntityId ?? null, targetEntityId: body.targetEntityId ?? null };
    // After baseline approval the new item is held Pending until the change request is approved and applied.
    const initialDisposition: PerimeterDisposition = cc.requiresChangeRequest ? 'pending' : body.disposition;
    await this.tx.insert(PI).values({
      id,
      orgId: p.orgId,
      projectId,
      code,
      type: body.type,
      name: body.name,
      description: body.description ?? null,
      siteId: body.siteId ?? null,
      workstreamId: body.workstreamId ?? null,
      ownerUserId: body.ownerUserId ?? null,
      currentEntityId: body.currentEntityId ?? null,
      targetEntityId: body.targetEntityId ?? null,
      disposition: initialDisposition,
      resolutionPath: body.resolutionPath ?? null,
      targetGateKey: body.targetGateKey ?? null,
      legalOwner: body.legalOwner ?? null,
      operator: body.operator ?? null,
      economicBeneficiary: body.economicBeneficiary ?? null,
      plannedEffectiveDate: body.plannedEffectiveDate ?? null,
      economicPlannedEffectiveDate: body.economicPlannedEffectiveDate ?? null,
      transferMechanism: body.transferMechanism ?? null,
      agreementId: body.agreementId ?? null,
      reference_valueAmount: body.referenceValue?.amount ?? null,
      reference_valueCurrency: body.referenceValue?.currency ?? null,
      reference_valueUnitScale: body.referenceValue?.unitScale ?? null,
      referenceValueSource: body.referenceValueSource ?? null,
      consentRequired: body.consentRequired,
      dependencies: body.dependencies ?? null,
      risks: body.risks ?? null,
      classification,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    });
    const item = await loadInProject(this.s.db, PI, projectId, id);
    await this.versions.snapshot({ projectId, entityType: 'perimeter_item', entityId: id, versionNo: 1, snapshot: item as unknown as Record<string, unknown>, reason: perimeterHistoryReason(cc.requiresChangeRequest ? 'perimeter.history.created_pending' : 'perimeter.history.created') });
    let changeRequest: { id: string; code: string; status: string; rebaseline: boolean } | null = null;
    let impactAssessmentId: string | null = null;
    let version = 1;
    if (cc.requiresChangeRequest) {
      const raised = await this.raiseChangeRequest(ctx, p, item, 'add', scopeOf(item), requested, cc, body.justification!.trim(), body.impactNarrative);
      const row = await updateVersioned(this.s.db, PI, { id, projectId, expectedVersion: 1 }, { pendingChangeRequestId: raised.cr.id });
      version = row['version'] as number;
      changeRequest = { id: raised.cr.id, code: raised.cr.code, status: raised.cr.status, rebaseline: cc.rebaseline };
      impactAssessmentId = raised.impactId;
      await this.versions.snapshot({ projectId, entityType: 'perimeter_item', entityId: id, versionNo: version, snapshot: row, reason: perimeterHistoryReason('perimeter.history.change_request_raised', { cr: raised.cr.code, disposition: requested.disposition }) });
    }
    await this.audit.record({
      action: 'carveout.perimeter.create',
      entityType: 'perimeter_item',
      entityId: id,
      projectId,
      after: { code, type: body.type, disposition: initialDisposition, requestedDisposition: body.disposition, changeRequestId: changeRequest?.id ?? null },
      reason: body.justification ?? null,
    });
    await this.outbox.emit({ type: 'perimeter.changed', projectId, aggregateType: 'perimeter_item', aggregateId: id, payload: { change: 'created', changeRequestId: changeRequest?.id ?? null } });
    return { id, code, version, disposition: initialDisposition, applied: !changeRequest, changeRequest, impactAssessmentId };
  }

  async updateItem(ctx: RequestContext, projectId: string, itemId: string, body: z.infer<typeof UpdatePerimeterItemBody>) {
    const p = await this.s.project(ctx, projectId);
    const item = await this.loadForManage(ctx, p, itemId, MANAGE);
    assertVersion(item, body.expectedVersion, 'perimeter item');
    const u: Partial<typeof schema.perimeterItem.$inferInsert> = {};
    const set = <K extends keyof typeof u>(k: K, v: (typeof u)[K] | undefined) => {
      if (v !== undefined) u[k] = v;
    };
    set('name', body.name);
    set('description', body.description);
    set('workstreamId', body.workstreamId);
    set('ownerUserId', body.ownerUserId);
    set('resolutionPath', body.resolutionPath);
    set('targetGateKey', body.targetGateKey);
    set('legalOwner', body.legalOwner);
    set('operator', body.operator);
    set('economicBeneficiary', body.economicBeneficiary);
    set('plannedEffectiveDate', body.plannedEffectiveDate);
    set('economicPlannedEffectiveDate', body.economicPlannedEffectiveDate);
    set('transferMechanism', body.transferMechanism);
    set('agreementId', body.agreementId);
    set('referenceValueSource', body.referenceValueSource);
    set('consentRequired', body.consentRequired);
    set('dependencies', body.dependencies);
    set('risks', body.risks);
    set('acceptanceEvidenceNote', body.acceptanceEvidenceNote);
    set('classification', body.classification);
    if (body.referenceValue !== undefined || body.referenceValueSource !== undefined) {
      if (!this.canSeeReferenceValues(ctx, projectId)) throw forbidden('carveout.reference_value_restricted', 'Reference values are recorded by holders of finance.record.read');
      if (body.referenceValue !== undefined) {
        u.reference_valueAmount = body.referenceValue?.amount ?? null;
        u.reference_valueCurrency = body.referenceValue?.currency ?? null;
        u.reference_valueUnitScale = body.referenceValue?.unitScale ?? null;
      }
    }
    if (body.classification) this.s.assertClassificationAllowed(ctx, body.classification);
    // DOM-P3-15: a consent need set by the specialist transferability class is not undone by a descriptive edit.
    if (body.consentRequired === false && CLASSES_REQUIRING_CONSENT.includes(item.transferClass as ContractTransferClass)) {
      throw ruleViolation('perimeter.consent_required_by_class', `The specialist classified this contract "${item.transferClass}": the consent need follows that class (re-assess the transferability to change it)`, { transferClass: item.transferClass });
    }
    // Moving the item to another workstream requires the grant in the target workstream too.
    if (body.workstreamId !== undefined && body.workstreamId !== item.workstreamId) {
      this.s.policy.assert(ctx, MANAGE, { projectId, classification: (body.classification ?? item.classification) as Classification, workstreamId: body.workstreamId, ownerUserIds: [item.ownerUserId, item.createdBy] });
    }
    await this.validateRefs(ctx, p, { workstreamId: body.workstreamId, ownerUserId: body.ownerUserId, agreementId: body.agreementId });
    if (Object.keys(u).length === 0) throw invalid('carveout.no_changes', 'No changes supplied');
    const row = await updateVersioned(this.s.db, PI, { id: itemId, projectId, expectedVersion: body.expectedVersion }, u);
    const version = row['version'] as number;
    await this.versions.snapshot({ projectId, entityType: 'perimeter_item', entityId: itemId, versionNo: version, snapshot: row, reason: perimeterHistoryReason('perimeter.history.descriptive_update') });
    await this.audit.record({ action: 'carveout.perimeter.update', entityType: 'perimeter_item', entityId: itemId, projectId, before: pick(item, Object.keys(u)), after: u as Record<string, unknown> });
    await this.outbox.emit({ type: 'perimeter.changed', projectId, aggregateType: 'perimeter_item', aggregateId: itemId, payload: { change: 'updated' } });
    return { id: itemId, version };
  }

  /** REQ-PER-002/005: justified, versioned scope change — or a change request after baseline approval (AT-07). */
  async classify(ctx: RequestContext, projectId: string, itemId: string, body: z.infer<typeof ClassifyPerimeterItemBody>) {
    const p = await this.s.project(ctx, projectId);
    const item = await this.loadForManage(ctx, p, itemId, MANAGE);
    assertVersion(item, body.expectedVersion, 'perimeter item');
    if (item.pendingChangeRequestId) throw conflict('perimeter.change_pending', 'A change request for this item is still open — resolve it (apply-change) first');
    const from = scopeOf(item);
    const to: PerimeterScope = {
      disposition: body.disposition,
      siteId: body.siteId !== undefined ? body.siteId : from.siteId,
      currentEntityId: body.currentEntityId !== undefined ? body.currentEntityId : from.currentEntityId,
      targetEntityId: body.targetEntityId !== undefined ? body.targetEntityId : from.targetEntityId,
    };
    if (sameScope(from, to)) throw invalid('carveout.no_changes', 'Disposition and scope attributes are unchanged');
    await this.validateRefs(ctx, p, to);
    const cc = await this.changeControlFor(ctx, p, item, to.disposition);
    if (cc.requiresChangeRequest) {
      const raised = await this.raiseChangeRequest(ctx, p, item, 'reclassify', from, to, cc, body.justification, body.impactNarrative);
      const row = await updateVersioned(this.s.db, PI, { id: itemId, projectId, expectedVersion: body.expectedVersion }, { pendingChangeRequestId: raised.cr.id });
      const version = row['version'] as number;
      await this.versions.snapshot({ projectId, entityType: 'perimeter_item', entityId: itemId, versionNo: version, snapshot: row, reason: perimeterHistoryReason('perimeter.history.change_requested', { cr: raised.cr.code, justification: body.justification }) });
      await this.audit.record({ action: 'carveout.perimeter.classify', entityType: 'perimeter_item', entityId: itemId, projectId, before: { ...from }, after: { requested: to, changeRequestId: raised.cr.id, applied: false }, reason: body.justification });
      await this.outbox.emit({ type: 'perimeter.changed', projectId, aggregateType: 'perimeter_item', aggregateId: itemId, payload: { change: 'change_requested', changeRequestId: raised.cr.id } });
      return { id: itemId, code: item.code, version, disposition: item.disposition as PerimeterDisposition, applied: false, changeRequest: { id: raised.cr.id, code: raised.cr.code, status: raised.cr.status, rebaseline: cc.rebaseline }, impactAssessmentId: raised.impactId };
    }
    const row = await updateVersioned(this.s.db, PI, { id: itemId, projectId, expectedVersion: body.expectedVersion }, { disposition: to.disposition, siteId: to.siteId, currentEntityId: to.currentEntityId, targetEntityId: to.targetEntityId });
    const version = row['version'] as number;
    await this.versions.snapshot({ projectId, entityType: 'perimeter_item', entityId: itemId, versionNo: version, snapshot: row, reason: perimeterHistoryReason('perimeter.history.classified', { justification: body.justification }) });
    await this.audit.record({ action: 'carveout.perimeter.classify', entityType: 'perimeter_item', entityId: itemId, projectId, before: { ...from }, after: { ...to, applied: true }, reason: body.justification });
    await this.outbox.emit({ type: 'perimeter.changed', projectId, aggregateType: 'perimeter_item', aggregateId: itemId, payload: { change: 'classified', disposition: to.disposition } });
    return { id: itemId, code: item.code, version, disposition: to.disposition, applied: true, changeRequest: null, impactAssessmentId: null };
  }

  /** Apply an approved change request bound to this item (or close a rejected / withdrawn one without change). */
  async applyChange(ctx: RequestContext, projectId: string, itemId: string, body: { expectedVersion: number; changeRequestId: string; note?: string }) {
    const p = await this.s.project(ctx, projectId);
    const item = await this.loadForManage(ctx, p, itemId, MANAGE);
    assertVersion(item, body.expectedVersion, 'perimeter item');
    if (item.pendingChangeRequestId !== body.changeRequestId) throw ruleViolation('perimeter.change_request_mismatch', 'This change request is not the open change of the item');
    const cr = await this.changeControl.getChangeRequest(ctx, projectId, body.changeRequestId);
    if (cr.subjectType !== 'perimeter_item' || cr.subjectId !== item.id) throw ruleViolation('perimeter.change_request_mismatch', 'The change request refers to another record');
    const proposed = (cr.proposedChange ?? {}) as { kind?: string; from?: PerimeterScope; to?: PerimeterScope; aspect?: 'legal' | 'economic'; fromStatus?: TransferStatus; note?: string; scope?: PerimeterScope };
    let outcome: 'applied' | 'closed_without_change';
    const u: Partial<typeof schema.perimeterItem.$inferInsert> = { pendingChangeRequestId: null };
    let transferNa: { aspect: 'legal' | 'economic'; from: TransferStatus; note: string } | null = null;
    if ((cr.status === 'approved' || cr.status === 'implemented') && proposed.kind === 'transfer_not_applicable') {
      // DOM-P3-05: the approved change declares one aspect "not applicable" — bound to the aspect's status and the item's
      // scope when it was raised; the transfer rules are applied again (never both aspects).
      const aspect = proposed.aspect;
      if ((aspect !== 'legal' && aspect !== 'economic') || !proposed.fromStatus || !proposed.scope) throw ruleViolation('perimeter.change_request_payload', 'The change request carries no transfer change');
      const col = aspect === 'legal' ? 'transferStatus' : 'economicTransferStatus';
      const other = (aspect === 'legal' ? item.economicTransferStatus : item.transferStatus) as TransferStatus;
      if (item[col] !== proposed.fromStatus || !sameScope(scopeOf(item), proposed.scope)) throw conflict('perimeter.change_request_stale', 'The item changed since the change request was raised — raise a new request');
      assertTransferCommand({
        command: 'mark_not_applicable',
        aspect,
        current: item[col] as TransferStatus,
        otherAspect: other,
        disposition: item.disposition as PerimeterDisposition,
        itemType: item.type as PerimeterItemType,
        mechanism: item.transferMechanism,
        effectiveDate: null,
        note: proposed.note ?? cr.rationale ?? null,
        activeEvidence: 0,
        conflictingEvidence: 0,
        actorUserId: ctx.principal.userId!,
        reportedBy: null,
        transferClass: item.transferClass as ContractTransferClass,
        transferClassAssessed: !!item.transferClassAssessedBy,
        consentGranted: false,
        today: this.s.today(p),
      });
      u[col] = 'not_applicable';
      transferNa = { aspect, from: item[col] as TransferStatus, note: `${cr.code}: ${proposed.note ?? cr.rationale ?? ''}`.slice(0, 2000) };
      outcome = 'applied';
    } else if (cr.status === 'approved' || cr.status === 'implemented') {
      if (!proposed.from || !proposed.to) throw ruleViolation('perimeter.change_request_payload', 'The change request carries no perimeter change');
      // The approval is bound to the scope it was raised against: a concurrent scope change invalidates it.
      if (!sameScope(scopeOf(item), proposed.from)) throw conflict('perimeter.change_request_stale', 'The item scope changed since the change request was raised — raise a new request');
      await this.validateRefs(ctx, p, proposed.to);
      Object.assign(u, { disposition: proposed.to.disposition, siteId: proposed.to.siteId, currentEntityId: proposed.to.currentEntityId, targetEntityId: proposed.to.targetEntityId });
      outcome = 'applied';
    } else if (cr.status === 'rejected' || cr.status === 'withdrawn') {
      outcome = 'closed_without_change';
    } else {
      throw ruleViolation('perimeter.change_request_not_decided', `Change request ${cr.code} is ${cr.status}; it must be approved (or rejected / withdrawn) first`);
    }
    const row = await updateVersioned(this.s.db, PI, { id: itemId, projectId, expectedVersion: body.expectedVersion }, u);
    const version = row['version'] as number;
    if (transferNa) {
      // The applied change is also a transfer record of that aspect (append-only transfer history).
      await this.tx.insert(schema.transferRecord).values({
        id: newId(),
        orgId: p.orgId,
        projectId,
        perimeterItemId: itemId,
        aspect: transferNa.aspect,
        command: 'mark_not_applicable',
        fromStatus: transferNa.from,
        toStatus: 'not_applicable',
        mechanism: item.transferMechanism,
        effectiveDate: null,
        note: transferNa.note,
        evidenceCount: 0,
        reviewsRecordId: null,
        recordedBy: ctx.principal.userId!,
      });
    }
    await this.versions.snapshot({ projectId, entityType: 'perimeter_item', entityId: itemId, versionNo: version, snapshot: row, reason: perimeterHistoryReason(outcome === 'applied' ? 'perimeter.history.applied' : 'perimeter.history.closed_without_change', { cr: cr.code }) });
    await this.audit.record({ action: 'carveout.perimeter.apply_change', entityType: 'perimeter_item', entityId: itemId, projectId, before: { ...scopeOf(item), pendingChangeRequestId: item.pendingChangeRequestId }, after: { ...scopeOf(row as unknown as Item), outcome, changeRequestId: cr.id, changeRequestStatus: cr.status }, reason: body.note ?? null });
    await this.outbox.emit({ type: 'perimeter.changed', projectId, aggregateType: 'perimeter_item', aggregateId: itemId, payload: { change: outcome, changeRequestId: cr.id } });
    return { id: itemId, version, disposition: row['disposition'] as PerimeterDisposition, outcome };
  }

  /** REQ-PER-004: record the cross-module impact of the item as it stands (append-only snapshot). */
  async assessImpact(ctx: RequestContext, projectId: string, itemId: string, body: { narrative?: Narrative }) {
    const p = await this.s.project(ctx, projectId);
    const item = await this.loadForManage(ctx, p, itemId, MANAGE);
    const entries = derivePerimeterImpacts(
      await this.impactInput(ctx, p, item, { kind: 'review', itemCode: item.code, itemType: item.type as PerimeterItemType, fromDisposition: item.disposition as PerimeterDisposition, toDisposition: item.disposition as PerimeterDisposition, scopeAttributesChanged: false }),
    );
    const r = await this.recordImpact(ctx, p, itemId, entries, body.narrative, 'manual', null);
    await this.audit.record({ action: 'carveout.perimeter.impact_assessment', entityType: 'perimeter_item', entityId: itemId, projectId, after: { impactAssessmentId: r.id, areas: entries.map((e) => `${e.area}:${e.status}`) } });
    return { id: r.id, perimeterItemId: itemId, changeRequestId: null, trigger: 'manual' as const, entries: entries.map((e) => this.entryDto(e)), narrative: r.narrative, assessedBy: ctx.principal.userId!, assessedByName: ctx.principal.displayName ?? null, createdAt: new Date().toISOString() };
  }

  async listImpacts(ctx: RequestContext, projectId: string, itemId: string) {
    const p = await this.s.project(ctx, projectId);
    await this.loadReadable(ctx, p, itemId);
    const A = schema.perimeterImpactAssessment;
    const rows = await this.tx.select().from(A).where(and(eq(A.projectId, projectId), eq(A.perimeterItemId, itemId))).orderBy(desc(A.createdAt));
    const names = await this.s.userNames(rows.map((r) => r.assessedBy));
    return {
      items: rows.map((r) => ({
        id: r.id,
        perimeterItemId: r.perimeterItemId,
        changeRequestId: r.changeRequestId,
        trigger: r.trigger as 'manual' | 'change_request',
        // Entries are frozen at assessment time; references of registers the reader cannot see are withheld.
        entries: (r.entries as unknown as ImpactEntry[]).map((e) => this.entryDto(this.redactEntry(ctx, projectId, e))),
        narrative: r.narrative ?? {},
        assessedBy: r.assessedBy,
        assessedByName: names.get(r.assessedBy) ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  private redactEntry(ctx: RequestContext, projectId: string, e: ImpactEntry): ImpactEntry {
    const perm: Record<string, string> = { tsa: 'readiness.register.read', readiness: 'readiness.register.read', budget: 'finance.record.read', schedule: 'planning.plan.read', agreements: READ };
    const needed = perm[e.area];
    if (needed && e.references.length && !this.s.policy.permissionReach(ctx, needed, projectId).all) return withheldImpactEntry(e.area);
    return e;
  }

  /** Stored entries keep their codes; entries stored before the codes existed carry none (the web shows the English). */
  private entryDto(e: ImpactEntry) {
    return { area: e.area, status: e.status, summary: e.summary, summaryI18n: e.summaryI18n ?? [], references: e.references };
  }

  /** REQ-AGR-006: specialist transferability (carveout.contract.classify); the assessor is recorded (D-17). */
  async setTransferability(ctx: RequestContext, projectId: string, itemId: string, body: z.infer<typeof TransferabilityBody>) {
    const p = await this.s.project(ctx, projectId);
    const item = await this.loadForManage(ctx, p, itemId, 'carveout.contract.classify');
    assertVersion(item, body.expectedVersion, 'perimeter item');
    if (!isContractLike(item.type as PerimeterItemType)) throw ruleViolation('perimeter.not_contract', 'Transferability is assessed for contracts and licences');
    const assessed = body.transferClass !== 'unknown';
    const row = await updateVersioned(this.s.db, PI, { id: itemId, projectId, expectedVersion: body.expectedVersion }, {
      transferClass: body.transferClass,
      transferClassAssessedBy: assessed ? ctx.principal.userId : null,
      transferClassAssessedAt: assessed ? new Date() : null,
      transferClassBasis: body.basis,
      consentRequired: body.transferClass === 'consent_required' || body.transferClass === 'novation_required' ? true : item.consentRequired,
    });
    const version = row['version'] as number;
    await this.versions.snapshot({ projectId, entityType: 'perimeter_item', entityId: itemId, versionNo: version, snapshot: row, reason: perimeterHistoryReason('perimeter.history.transferability', { transferClass: body.transferClass }) });
    await this.audit.record({ action: 'carveout.contract.classify', entityType: 'perimeter_item', entityId: itemId, projectId, before: { transferClass: item.transferClass, assessedBy: item.transferClassAssessedBy }, after: { transferClass: body.transferClass, assessedBy: assessed ? ctx.principal.userId : null }, reason: body.basis });
    await this.outbox.emit({ type: 'perimeter.changed', projectId, aggregateType: 'perimeter_item', aggregateId: itemId, payload: { change: 'transferability', transferClass: body.transferClass } });
    const fresh = row as unknown as Item;
    const consents = (await this.consentsOf(projectId, [itemId])).get(itemId) ?? [];
    const names = await this.s.userNames([fresh.serviceAccountableUserId, fresh.billingAccountableUserId, fresh.slaAccountableUserId]);
    return { id: itemId, version, transferClass: body.transferClass, day1: this.day1Dto(fresh, consents.map((c) => c.status), names) };
  }

  /** AT-08: interim arrangement, service / billing / SLA accountable owners and remediation for a non-transferring contract. */
  async setInterimArrangement(ctx: RequestContext, projectId: string, itemId: string, body: z.infer<typeof InterimArrangementBody>) {
    const p = await this.s.project(ctx, projectId);
    const item = await this.loadForManage(ctx, p, itemId, 'carveout.consent.manage');
    assertVersion(item, body.expectedVersion, 'perimeter item');
    if (!isContractLike(item.type as PerimeterItemType)) throw ruleViolation('perimeter.not_contract', 'A Day-1 contract position applies to contracts and licences');
    const u: Partial<typeof schema.perimeterItem.$inferInsert> = {};
    if (body.interimArrangement !== undefined) u.interimArrangement = body.interimArrangement;
    if (body.remediationPlan !== undefined) u.remediationPlan = body.remediationPlan;
    for (const k of ['serviceAccountableUserId', 'billingAccountableUserId', 'slaAccountableUserId'] as const) {
      const v = body[k];
      if (v === undefined) continue;
      if (v) await this.s.assertMember(projectId, v, k.replace('UserId', ' owner'));
      u[k] = v;
    }
    if (Object.keys(u).length === 0) throw invalid('carveout.no_changes', 'No changes supplied');
    const row = await updateVersioned(this.s.db, PI, { id: itemId, projectId, expectedVersion: body.expectedVersion }, u);
    const version = row['version'] as number;
    await this.versions.snapshot({ projectId, entityType: 'perimeter_item', entityId: itemId, versionNo: version, snapshot: row, reason: perimeterHistoryReason('perimeter.history.day1_updated') });
    await this.audit.record({ action: 'carveout.perimeter.interim_arrangement', entityType: 'perimeter_item', entityId: itemId, projectId, before: pick(item, Object.keys(u)), after: u as Record<string, unknown> });
    await this.outbox.emit({ type: 'perimeter.changed', projectId, aggregateType: 'perimeter_item', aggregateId: itemId, payload: { change: 'day1_position' } });
    const fresh = row as unknown as Item;
    const consents = (await this.consentsOf(projectId, [itemId])).get(itemId) ?? [];
    const names = await this.s.userNames([fresh.serviceAccountableUserId, fresh.billingAccountableUserId, fresh.slaAccountableUserId]);
    return { id: itemId, version, day1: this.day1Dto(fresh, consents.map((c) => c.status), names) };
  }

  // =========================================================================================================
  // Reconciliation, categories, Day-1 positions (computed inside the caller's scope)

  private async visibleItems(ctx: RequestContext, projectId: string): Promise<Item[]> {
    return this.tx
      .select()
      .from(PI)
      .where(and(eq(PI.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, { classification: PI.classification }), this.s.policy.reachSql(ctx, READ, projectId, PI.workstreamId)))
      .orderBy(asc(PI.code));
  }

  async reconciliation(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertRead(ctx, READ, { projectId, classification: p.classification });
    const items = await this.visibleItems(ctx, projectId);
    const ids = items.map((i) => i.id);
    const consents = await this.consentsOf(projectId, ids);
    const evidence = await this.s.evidenceCounts(projectId, 'transfer', ids);
    const reviews = await this.tx.select().from(schema.perimeterCategoryReview).where(eq(schema.perimeterCategoryReview.projectId, projectId));
    const names = new Map<string, string>();
    const r = reconcilePerimeterRegister({
      items: items.map((it) => {
        const statuses = (consents.get(it.id) ?? []).map((c) => c.status);
        const day1 = this.day1Dto(it, statuses, names);
        return {
          id: it.id,
          code: it.code,
          type: it.type as PerimeterItemType,
          disposition: it.disposition as PerimeterDisposition,
          transferStatus: it.transferStatus as TransferStatus,
          economicTransferStatus: it.economicTransferStatus as TransferStatus,
          transferMechanism: it.transferMechanism,
          plannedEffectiveDate: it.plannedEffectiveDate,
          // DOM-P3-15: the specialist class also says whether a consent is needed (never undone by the descriptive flag).
          consentRequired: it.consentRequired || CLASSES_REQUIRING_CONSENT.includes(it.transferClass as ContractTransferClass),
          consentGranted: day1.consentGranted,
          evidenceCount: evidence.get(it.id)?.active ?? 0,
          hasInterimArrangement: !!it.interimArrangement?.trim(),
          ownerUserId: it.ownerUserId,
          resolutionPath: it.resolutionPath,
          targetGateKey: it.targetGateKey,
          pendingChangeRequest: !!it.pendingChangeRequestId,
          day1: day1.applicable ? { ok: day1.ok, missing: day1.missing } : null,
        };
      }),
      reviewedCategories: reviews.map((x) => x.category as PerimeterItemType),
    });
    const conclusion = new Map(reviews.map((x) => [x.category, x.conclusion]));
    const reviewVersion = new Map(reviews.map((x) => [x.category, x.version]));
    return { findings: r.findings, categories: r.categories.map((c) => ({ ...c, conclusion: conclusion.get(c.category) ?? null, reviewVersion: reviewVersion.get(c.category) ?? null })), summary: r.summary };
  }

  async reviewCategory(ctx: RequestContext, projectId: string, category: PerimeterItemType, body: { conclusion: string; expectedVersion?: number }) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertProjectWide(ctx, MANAGE, projectId);
    this.s.policy.assert(ctx, MANAGE, { projectId, classification: p.classification, ownerUserIds: [ctx.principal.userId] });
    const R = schema.perimeterCategoryReview;
    const [existing] = await this.tx.select().from(R).where(and(eq(R.projectId, projectId), eq(R.category, category)));
    let version: number;
    const reviewId = existing?.id ?? newId();
    if (existing) {
      if (body.expectedVersion === undefined) throw conflict('concurrency.version_required', 'This category was already reviewed — pass expectedVersion to update the review');
      const row = await updateVersioned(this.s.db, R, { id: existing.id, projectId, expectedVersion: body.expectedVersion }, { conclusion: body.conclusion, reviewedBy: ctx.principal.userId!, reviewedAt: new Date() });
      version = row['version'] as number;
    } else {
      await this.tx.insert(R).values({ id: reviewId, orgId: p.orgId, projectId, category, conclusion: body.conclusion, reviewedBy: ctx.principal.userId!, isDemo: p.isDemo });
      version = 1;
    }
    await this.audit.record({ action: 'carveout.perimeter.category_review', entityType: 'perimeter_category_review', entityId: reviewId, projectId, before: existing ? { category, conclusion: existing.conclusion } : null, after: { category, conclusion: body.conclusion } });
    return { category, version };
  }

  async day1Positions(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(ctx, projectId);
    this.s.assertRead(ctx, READ, { projectId, classification: p.classification });
    const items = (await this.visibleItems(ctx, projectId)).filter((i) => isContractLike(i.type as PerimeterItemType) && isInScope(i.disposition as PerimeterDisposition));
    const consents = await this.consentsOf(projectId, items.map((i) => i.id));
    // SEC-P34-07: the position is computed on every consent; only consents the caller may read are listed.
    const shown = await this.visibleConsentsOf(ctx, projectId, items.map((i) => i.id));
    const names = await this.s.userNames(items.flatMap((i) => [i.serviceAccountableUserId, i.billingAccountableUserId, i.slaAccountableUserId]));
    const out = items.map((i) => {
      const cs = consents.get(i.id) ?? [];
      return {
        id: i.id,
        code: i.code,
        name: i.name,
        type: i.type as PerimeterItemType,
        disposition: i.disposition as PerimeterDisposition,
        transferClass: i.transferClass as ContractTransferClass,
        classAssessed: !!i.transferClassAssessedBy && i.transferClass !== 'unknown',
        consents: shown.get(i.id) ?? [],
        position: this.day1Dto(i, cs.map((c) => c.status), names),
      };
    });
    return { items: out, summary: { total: out.length, ok: out.filter((x) => x.position.ok).length, incomplete: out.filter((x) => !x.position.ok).length } };
  }

  /** Items that still await a change-request decision (used by the seed and reporting). */
  async pendingChanges(projectId: string) {
    return this.tx.select({ id: PI.id, code: PI.code, changeRequestId: PI.pendingChangeRequestId, version: PI.version }).from(PI).where(and(eq(PI.projectId, projectId), isNotNull(PI.pendingChangeRequestId)));
  }

  /** Raw item row inside the project (for sibling services). */
  async row(projectId: string, itemId: string): Promise<Item> {
    return loadInProject(this.s.db, PI, projectId, itemId);
  }
}

export function pick(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

