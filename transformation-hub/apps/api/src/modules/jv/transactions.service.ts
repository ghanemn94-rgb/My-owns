import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, count, eq, ilike, inArray, or } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  CLOSING_DECISION_TYPE_KEYS,
  CLOSING_MACHINE,
  CONDITION_MACHINE,
  FUNDS_FLOW_MACHINE,
  FUNDS_FLOW_NOTICE,
  SIGNING_DECISION_TYPE_KEYS,
  allowedCommands,
  assertChecklistItemAcceptable,
  assertCpVerifiable,
  assertCpWaivabilityDetermination,
  assertEventConfirmable,
  conflict,
  eventBlockers,
  notFound,
  parseMoney,
  ruleViolation,
  transition,
  waiverIsEffective,
  ClosingCommand,
  ClosingKind,
  ConditionCommand,
  DomainError,
  EventBlocker,
  FundsFlowCommand,
  RoleKey,
} from '@hub/domain';
import type { RouteInput, jvRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId } from '../../platform/ids';
import { WaiverService, WaiverRecord } from '../gates/waiver.service';
import { JvSupport, iso, money, versionUsable } from './jv.support';

type Q<K extends keyof typeof jvRoutes> = RouteInput<(typeof jvRoutes)[K]>;
type EventRow = typeof schema.closing.$inferSelect;
type ItemRow = typeof schema.closingDeliverable.$inferSelect;
type CpRow = typeof schema.closingCondition.$inferSelect;
type FlowRow = typeof schema.fundsFlowItem.$inferSelect;

const PREPARATION_COMMANDS = ['start_preparation', 'mark_ready', 'back_to_preparation', 'abort'] as const;
const FROZEN_EVENT_STATUSES = ['confirmed', 'aborted'];

/**
 * Signing and closing (REQ-LCY-009, REQ-JV-012..018; AT-11, AT-12, AT-13). A signing and each closing are separate
 * events with separate checklists, statuses and authorized confirmations; each closing follows its signing and has its
 * own CP set. Completing tasks never closes anything: a closing is confirmed only by an authorized person (not the
 * requester) with a FINAL approved governance decision, after the server re-evaluated every blocking CP inside the
 * confirm transaction. CP waivers go through the gates module's waiver register (non-waivable CPs are refused and
 * logged). Funds flow is record-only.
 */
@Injectable()
export class TransactionsService implements OnModuleInit {
  constructor(
    private readonly s: JvSupport,
    private readonly waivers: WaiverService,
  ) {}

  onModuleInit() {
    this.waivers.registerTarget({
      targetType: 'closing_condition',
      resolve: async (projectId, targetId) => {
        const c = await loadInProject(this.s.db, schema.closingCondition, projectId, targetId);
        return {
          label: `Condition ${c.reference}`,
          version: c.version,
          waivable: c.waivable,
          waiverAuthorityRole: c.waiverAuthorityRole as RoleKey | null,
          classification: null,
          requestPermission: 'jv.cp.manage',
          approvePermission: 'jv.cp.waive',
          assertRequestable: () => {
            if (c.status === 'verified' || c.status === 'waived') throw ruleViolation('jv.cp.waiver_not_needed', `Condition ${c.reference} is already ${c.status}`);
            if (!CONDITION_MACHINE.waive.from.includes(c.status)) throw ruleViolation('jv.cp.waiver_not_applicable', `Condition ${c.reference} is ${c.status}`);
          },
        };
      },
      onApproved: (ctx, projectId, w) => this.applyWaiver(ctx, projectId, w),
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // helpers

  private async loadEvent(ctx: RequestContext, projectId: string, eventId: string, kind: ClosingKind | null, permission = 'jv.deal.read'): Promise<EventRow> {
    if (this.s.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    const e = await loadInProject(this.s.db, schema.closing, projectId, eventId);
    if (kind && e.kind !== kind) throw notFound();
    // Role-level pre-check (I-R3): confirmation asserts not_self / authority with the requester and the decision.
    this.s.policy.assertGranted(ctx, permission, { projectId });
    return e;
  }

  private eventDto(e: EventRow) {
    return {
      id: e.id,
      kind: e.kind,
      code: e.code,
      sequence: e.sequence,
      name: e.name,
      partnerId: e.partnerId,
      signingId: e.signingId,
      targetDate: e.targetDate,
      status: e.status,
      confirmedBy: e.confirmedBy,
      confirmedAt: iso(e.confirmedAt),
      isDemo: e.isDemo,
      createdAt: e.createdAt.toISOString(),
      version: e.version,
    };
  }

  private itemDto(i: ItemRow, evidence: { active: number; conflicting: number }) {
    return {
      id: i.id,
      eventId: i.closingId,
      code: i.code,
      title: i.title,
      responsibleParty: i.responsibleParty,
      ownerUserId: i.ownerUserId,
      dueDate: i.dueDate,
      decisionId: i.decisionId,
      status: i.status,
      documentId: i.documentId,
      executedVersionId: i.executedVersionId,
      deliveredBy: i.deliveredBy,
      deliveredAt: iso(i.deliveredAt),
      verifiedBy: i.verifiedBy,
      verifiedAt: iso(i.verifiedAt),
      statusNote: i.statusNote,
      evidence,
      isDemo: i.isDemo,
      version: i.version,
    };
  }

  private cpDto(c: CpRow, evidence: { active: number; conflicting: number }, waiverEffective: boolean) {
    return {
      id: c.id,
      closingId: c.closingId,
      reference: c.reference,
      kind: c.kind,
      title: c.title,
      description: c.description,
      ownerUserId: c.ownerUserId,
      parties: c.parties,
      blocking: c.blocking,
      waivable: c.waivable,
      waiverAuthorityRole: c.waiverAuthorityRole as RoleKey | null,
      waivabilityBasis: c.waivabilityBasis,
      waivabilityDeterminedBy: c.waivabilityDeterminedBy,
      validTo: c.validTo,
      longStopDate: c.longStopDate,
      status: c.status,
      evidenceSubmittedBy: c.evidenceSubmittedBy,
      verifiedBy: c.verifiedBy,
      verifiedAt: iso(c.verifiedAt),
      statusNote: c.statusNote,
      waiverId: c.waiverId,
      waiverEffective,
      gateKey: c.gateKey,
      evidence,
      allowedCommands: allowedCommands(CONDITION_MACHINE, c.status).filter((x) => x !== 'waive' && x !== 'mark_failed' && x !== 'mark_lapsed'),
      isDemo: c.isDemo,
      updatedAt: c.updatedAt.toISOString(),
      version: c.version,
    };
  }

  private flowDto(f: FlowRow) {
    return {
      id: f.id,
      closingId: f.closingId,
      code: f.code,
      description: f.description,
      payer: f.payer,
      payee: f.payee,
      amount: money(f.amount, f.currency, f.unitScale),
      valueDate: f.valueDate,
      status: f.status,
      confirmedBy: f.confirmedBy,
      confirmedAt: iso(f.confirmedAt),
      settlementReference: f.settlementReference,
      settlementReportedBy: f.settlementReportedBy,
      settlementReportedAt: iso(f.settlementReportedAt),
      statusNote: f.statusNote,
      isDemo: f.isDemo,
      version: f.version,
    };
  }

  /** Waivers of the CPs that are approved and unexpired today (project timezone). */
  private async waiverEffectiveMap(projectId: string, cps: CpRow[], today: string): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    const ids = cps.map((c) => c.waiverId).filter((x): x is string => !!x);
    if (!ids.length) return out;
    const ws = await this.s.db.tx().select().from(schema.waiver).where(and(eq(schema.waiver.projectId, projectId), inArray(schema.waiver.id, ids)));
    const byId = new Map(ws.map((w) => [w.id, w]));
    for (const c of cps) {
      const w = c.waiverId ? byId.get(c.waiverId) : undefined;
      out.set(c.id, !!w && w.targetType === 'closing_condition' && w.targetId === c.id && waiverIsEffective(w, today));
    }
    return out;
  }

  /** Everything the confirm rule needs, read inside the current transaction (REQ-JV-018). */
  private async readiness(e: EventRow, today: string) {
    const tx = this.s.db.tx();
    const items = await tx.select().from(schema.closingDeliverable).where(and(eq(schema.closingDeliverable.projectId, e.projectId), eq(schema.closingDeliverable.closingId, e.id))).orderBy(asc(schema.closingDeliverable.code), asc(schema.closingDeliverable.id));
    const cps = e.kind === 'closing' ? await tx.select().from(schema.closingCondition).where(and(eq(schema.closingCondition.projectId, e.projectId), eq(schema.closingCondition.closingId, e.id))).orderBy(asc(schema.closingCondition.reference)) : [];
    const signing = e.kind === 'closing' && e.signingId ? await loadInProject(this.s.db, schema.closing, e.projectId, e.signingId) : null;
    const cpEvidence = await this.s.evidenceMap(e.projectId, 'closing_condition', cps.map((c) => c.id));
    const itemEvidence = await this.s.evidenceMap(e.projectId, 'closing_deliverable', items.map((i) => i.id));
    const waiverOk = await this.waiverEffectiveMap(e.projectId, cps, today);
    const blockers = eventBlockers({
      kind: e.kind,
      signing: signing ? { code: signing.code ?? signing.name, status: signing.status } : null,
      conditions: cps.map((c) => ({
        reference: c.reference,
        blocking: c.blocking,
        waivable: c.waivable,
        status: c.status,
        waiverEffective: waiverOk.get(c.id) ?? false,
        activeEvidence: cpEvidence.get(c.id)?.active ?? 0,
        validTo: c.validTo,
        longStopDate: c.longStopDate,
      })),
      items: items.map((i) => ({ ref: i.code ?? i.title, status: i.status })),
      today,
    });
    return { items, cps, signing, cpEvidence, itemEvidence, waiverOk, blockers };
  }

  private async assertEventOpen(e: EventRow) {
    if (FROZEN_EVENT_STATUSES.includes(e.status)) throw ruleViolation('jv.event.frozen', `The ${e.kind} is ${e.status}; its checklist and conditions are frozen`);
  }

  private async dimensionsChanged(projectId: string, key: string) {
    // The gates module owns the JV status dimension; cp.changed triggers its recompute job.
    await this.s.outbox.emit({ type: 'cp.changed', projectId, aggregateType: 'closing', aggregateId: key.split(':')[1] ?? projectId, payload: { reason: key }, dedupeKey: `cp.changed:${projectId}:${key}`.slice(0, 200) });
  }

  private async partnerRef(ctx: RequestContext, projectId: string, partnerId: string | null | undefined) {
    if (!partnerId) return;
    const p = await loadInProject(this.s.db, schema.partner, projectId, partnerId);
    if (!this.s.policy.canSee(ctx, { projectId, classification: p.classification })) throw notFound();
  }

  private async nextSequence(projectId: string, kind: ClosingKind): Promise<number> {
    const r = await this.s.db.query<{ n: number }>(`select coalesce(max(sequence), 0)::int + 1 as n from closing where project_id = $1 and kind = $2`, [projectId, kind]);
    return r.rows[0]?.n ?? 1;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Events

  async listEvents(ctx: RequestContext, projectId: string, kind: ClosingKind, q: Q<'listClosings'>['query']) {
    await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.deal.read');
    const t = schema.closing;
    const where = and(
      eq(t.projectId, projectId),
      eq(t.kind, kind),
      kind === 'closing' && q.signingId ? eq(t.signingId, q.signingId) : undefined,
      q.q ? or(ilike(t.name, likeContains(q.q)), ilike(t.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { sequence: t.sequence, targetDate: t.targetDate, status: t.status }, t.id, [asc(t.sequence), asc(t.id)]);
    const rows = await tx.select().from(t).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(rows.map((r) => this.eventDto(r)), Number(total), q);
  }

  async createEvent(ctx: RequestContext, projectId: string, kind: ClosingKind, body: { name: string; partnerId?: string; targetDate?: string; description?: string; signingId?: string }) {
    const project = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.closing_checklist.manage');
    this.s.policy.assert(ctx, 'jv.closing_checklist.manage', { projectId });
    await this.partnerRef(ctx, projectId, body.partnerId);
    let partnerId = body.partnerId ?? null;
    if (kind === 'closing') {
      const sig = await loadInProject(this.s.db, schema.closing, projectId, body.signingId!);
      if (sig.kind !== 'signing') throw ruleViolation('jv.closing.signing_required', 'A closing follows a SIGNING event');
      if (sig.status === 'aborted') throw ruleViolation('jv.closing.signing_aborted', 'The signing was aborted');
      if (partnerId && sig.partnerId && partnerId !== sig.partnerId) throw ruleViolation('jv.closing.partner_mismatch', 'A closing concerns the partner of its signing');
      partnerId = partnerId ?? sig.partnerId;
    }
    const code = await this.s.nextCode('closing', 'code', projectId, kind === 'signing' ? 'SIG' : 'CLO');
    const id = newId();
    await this.s.db.tx().insert(schema.closing).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      partnerId,
      kind,
      code,
      sequence: await this.nextSequence(projectId, kind),
      name: body.name,
      description: body.description ?? null,
      signingId: kind === 'closing' ? body.signingId! : null,
      targetDate: body.targetDate ?? null,
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: `jv.${kind}.create`, entityType: 'closing', entityId: id, projectId, after: { kind, code, signingId: body.signingId ?? null } });
    await this.dimensionsChanged(projectId, `event:${id}:created`);
    return { id, code, version: 1 };
  }

  async detail(ctx: RequestContext, projectId: string, eventId: string, kind: ClosingKind) {
    const e = await this.loadEvent(ctx, projectId, eventId, kind);
    const p = await this.s.project(projectId);
    const r = await this.readiness(e, this.s.today(p));
    const tx = this.s.db.tx();
    const flows = kind === 'closing' ? await tx.select().from(schema.fundsFlowItem).where(and(eq(schema.fundsFlowItem.projectId, projectId), eq(schema.fundsFlowItem.closingId, e.id))).orderBy(asc(schema.fundsFlowItem.code), asc(schema.fundsFlowItem.id)) : [];
    const closings = kind === 'signing' ? await tx.select().from(schema.closing).where(and(eq(schema.closing.projectId, projectId), eq(schema.closing.signingId, e.id))).orderBy(asc(schema.closing.sequence)) : [];
    const req = await this.s.approvalRequest(projectId, e.confirmationRequestId);
    const decision = await this.s.decisionRow(projectId, e.confirmationDecisionId);
    // Blockers use every piece of evidence (r.*Evidence); the displayed counters only what the caller may see.
    const itemEv = await this.s.visibleEvidenceMap(ctx, projectId, 'closing_deliverable', r.items.map((i) => i.id));
    const cpEv = await this.s.visibleEvidenceMap(ctx, projectId, 'closing_condition', r.cps.map((c) => c.id));
    return {
      ...this.eventDto(e),
      description: e.description,
      executedDocumentId: e.executedDocumentId,
      confirmationDecisionId: e.confirmationDecisionId,
      confirmationAuthority: e.confirmationAuthority,
      confirmationRequest: this.s.approvalStep(req),
      decision: this.s.decisionSummary(ctx, projectId, decision, kind === 'closing' ? CLOSING_DECISION_TYPE_KEYS : SIGNING_DECISION_TYPE_KEYS, `the ${kind} confirmation`),
      statusReason: e.statusReason,
      allowedCommands: allowedCommands(CLOSING_MACHINE, e.status).filter((c) => c !== 'confirm'),
      blockers: r.blockers,
      ready: r.blockers.length === 0,
      checklist: r.items.map((i) => this.itemDto(i, itemEv.get(i.id) ?? { active: 0, conflicting: 0 })),
      conditions: r.cps.map((c) => this.cpDto(c, cpEv.get(c.id) ?? { active: 0, conflicting: 0 }, r.waiverOk.get(c.id) ?? false)),
      fundsFlows: flows.map((f) => this.flowDto(f)),
      closings: closings.map((c) => ({ id: c.id, code: c.code, status: c.status })),
      people: await this.s.people([e.createdBy, e.confirmedBy, req?.requestedBy, ...r.items.flatMap((i) => [i.ownerUserId, i.deliveredBy, i.verifiedBy]), ...r.cps.flatMap((c) => [c.ownerUserId, c.verifiedBy, c.evidenceSubmittedBy])]),
    };
  }

  async checklist(ctx: RequestContext, projectId: string, eventId: string, kind: ClosingKind) {
    const e = await this.loadEvent(ctx, projectId, eventId, kind);
    const items = await this.s.db.tx().select().from(schema.closingDeliverable).where(and(eq(schema.closingDeliverable.projectId, projectId), eq(schema.closingDeliverable.closingId, e.id))).orderBy(asc(schema.closingDeliverable.code), asc(schema.closingDeliverable.id));
    const ev = await this.s.visibleEvidenceMap(ctx, projectId, 'closing_deliverable', items.map((i) => i.id));
    return { eventId: e.id, kind: e.kind, items: items.map((i) => this.itemDto(i, ev.get(i.id) ?? { active: 0, conflicting: 0 })) };
  }

  async transitionEvent(ctx: RequestContext, projectId: string, eventId: string, body: Q<'transitionEvent'>['body']) {
    const e = await this.loadEvent(ctx, projectId, eventId, null, 'jv.closing_checklist.manage');
    const cmd = body.command as (typeof PREPARATION_COMMANDS)[number] & ClosingCommand;
    if (cmd === 'abort' && !body.note?.trim()) throw ruleViolation('jv.event.reason_required', 'A reason is required to abort');
    if (cmd === 'mark_ready') {
      const p = await this.s.project(projectId);
      const { blockers } = await this.readiness(e, this.s.today(p));
      if (blockers.length) throw ruleViolation('jv.closing.not_ready', `The ${e.kind} is not ready: ${blockers.map((b) => b.message).join('; ')}`, { blockers: blockers.map(blockerJson) });
    }
    const to = transition(e.kind, CLOSING_MACHINE, e.status, cmd);
    const row = (await updateVersioned(this.s.db, schema.closing, { id: e.id, projectId, expectedVersion: body.expectedVersion }, { status: to, statusReason: body.note ?? null })) as EventRow;
    if (to !== 'ready_for_confirmation') await this.s.invalidateApproval(projectId, await this.s.approvalRequest(projectId, e.confirmationRequestId), `${e.kind} moved to ${to}`);
    await this.s.audit.record({ action: `jv.${e.kind}.${cmd}`, entityType: 'closing', entityId: e.id, projectId, before: { status: e.status }, after: { status: to }, reason: body.note ?? null });
    await this.dimensionsChanged(projectId, `event:${e.id}:${row.version}`);
    return { id: e.id, status: row.status, version: row.version };
  }

  async requestConfirmation(ctx: RequestContext, projectId: string, eventId: string, body: Q<'requestEventConfirmation'>['body']) {
    const e = await this.loadEvent(ctx, projectId, eventId, null, 'jv.closing_checklist.manage');
    if (e.status !== 'ready_for_confirmation') throw ruleViolation('jv.closing.not_ready', `The ${e.kind} must be ready for confirmation (it is ${e.status})`);
    const p = await this.s.project(projectId);
    const { blockers } = await this.readiness(e, this.s.today(p));
    if (blockers.length) throw ruleViolation('jv.closing.not_ready', `The ${e.kind} is not ready: ${blockers.map((b) => b.message).join('; ')}`, { blockers: blockers.map(blockerJson) });
    const types = e.kind === 'closing' ? CLOSING_DECISION_TYPE_KEYS : SIGNING_DECISION_TYPE_KEYS;
    const d = await this.s.decision(ctx, projectId, body.decisionId);
    if (!d.decisionTypeKey || !types.includes(d.decisionTypeKey)) throw ruleViolation('jv.closing.decision_wrong_type', `The ${e.kind} confirmation needs a governance decision of type ${types.join(' / ')}`);
    if (d.status === 'rejected' || d.status === 'superseded') throw ruleViolation('jv.closing.decision_not_linkable', `A ${d.status} decision cannot authorize the ${e.kind}`);
    const executedDocumentId = body.executedDocumentId ?? e.executedDocumentId;
    if (e.kind === 'signing' && !executedDocumentId) throw ruleViolation('jv.signing.executed_copy_required', 'Recording a signing requires the executed copy of the agreement');
    if (body.executedDocumentId) await this.s.visibleDocument(ctx, projectId, body.executedDocumentId);
    assertVersion(e, body.expectedVersion, e.kind);
    const prev = await this.s.approvalRequest(projectId, e.confirmationRequestId);
    if (prev?.status === 'pending') await this.s.invalidateApproval(projectId, prev, 'superseded by a new confirmation request');
    const permission = e.kind === 'closing' ? 'jv.closing.declare' : 'jv.signing.record';
    const reqId = await this.s.createApprovalRequest(ctx, projectId, {
      subjectType: 'closing',
      subjectId: e.id,
      subjectVersion: e.version + 1,
      action: permission,
      requiredPermission: permission,
      payload: { eventId: e.id, kind: e.kind, decisionId: d.id, executedDocumentId: executedDocumentId ?? null },
      note: body.note ?? `Confirmation of ${e.code ?? e.name}`,
    });
    const row = (await updateVersioned(this.s.db, schema.closing, { id: e.id, projectId, expectedVersion: body.expectedVersion }, { confirmationRequestId: reqId, confirmationDecisionId: d.id, executedDocumentId: executedDocumentId ?? null })) as EventRow;
    await this.s.audit.record({ action: `jv.${e.kind}.request_confirmation`, entityType: 'closing', entityId: e.id, projectId, after: { approvalRequestId: reqId, decisionId: d.id, executedDocumentId: executedDocumentId ?? null }, reason: body.note ?? null });
    return { id: e.id, version: row.version, approvalRequestId: reqId };
  }

  /**
   * recordSigning / confirmClosing (REQ-JV-017/018, AT-12): human only; a pending request by ANOTHER person; every
   * blocking CP and checklist item re-evaluated INSIDE this transaction (a refusal is logged against the event); a FINAL
   * approved decision of the right type (authority); the approval bound to the event version.
   */
  async confirm(ctx: RequestContext, projectId: string, eventId: string, kind: ClosingKind, body: Q<'confirmClosing'>['body']) {
    const permission = kind === 'closing' ? 'jv.closing.declare' : 'jv.signing.record';
    const e = await this.loadEvent(ctx, projectId, eventId, kind, permission);
    this.s.assertHuman(ctx, kind === 'closing' ? 'Confirming a closing' : 'Recording a signing');
    const req = await this.s.approvalRequest(projectId, e.confirmationRequestId);
    if (!req || req.status !== 'pending') throw ruleViolation('jv.closing.not_requested', `No pending confirmation request exists for this ${kind} (a request by another person is required)`);
    // Role (loadEvent) → state (pending request above; separation, blockers and the decision below, audited on refusal) →
    // policy not_self + authority once the requester and the decision are known (I-R3).
    const p = await this.s.project(projectId);
    const r = await this.readiness(e, this.s.today(p));
    const decision = await this.s.decisionRow(projectId, e.confirmationDecisionId);
    try {
      assertEventConfirmable({ kind, blockers: r.blockers, confirmerUserId: ctx.principal.userId!, requesterUserId: req.requestedBy, decision: this.s.decisionState(decision) });
    } catch (err) {
      const denied = err instanceof DomainError && err.kind === 'forbidden';
      await this.s.audit.recordDetached(ctx, {
        action: permission,
        entityType: 'closing',
        entityId: e.id,
        projectId,
        outcome: denied ? 'denied' : 'rejected',
        reason: (err as Error).message.slice(0, 1000),
        before: { status: e.status, blockers: r.blockers.map((b) => ({ kind: b.kind, ref: b.ref, message: b.message })) },
      });
      throw err;
    }
    // Decision-bound authority: assertEventConfirmable above refused unless the linked decision is a FINAL approval of the
    // right type (within the committee mandate or approved by the authorized body) — `withinAuthority` is that evaluation.
    this.s.policy.assert(ctx, permission, { projectId, requesterUserId: req.requestedBy, withinAuthority: true });
    assertVersion(e, body.expectedVersion, kind);
    if (req.subjectVersion !== e.version) throw conflict('jv.closing.confirmation_stale', `The ${kind} changed after the confirmation was requested — a fresh request is required`);
    const to = transition(kind, CLOSING_MACHINE, e.status, 'confirm');
    const now = this.s.clock.now();
    const authority = `${decision!.code} (${decision!.decisionTypeKey}) — ${decision!.authorityOutcome === 'within_mandate' ? 'within the committee mandate' : `approved by the authorized body: ${decision!.externalAuthorityReference}`}`;
    const snapshot = {
      evaluatedAt: now.toISOString(),
      conditions: r.cps.map((c) => ({ reference: c.reference, status: c.status, blocking: c.blocking, evidence: r.cpEvidence.get(c.id)?.active ?? 0, waiverEffective: r.waiverOk.get(c.id) ?? false })),
      checklist: r.items.map((i) => ({ ref: i.code ?? i.title, status: i.status })),
      signing: r.signing ? { code: r.signing.code, status: r.signing.status } : null,
    };
    const row = (await updateVersioned(this.s.db, schema.closing, { id: e.id, projectId, expectedVersion: body.expectedVersion }, { status: to, confirmedBy: ctx.principal.userId, confirmedAt: now, confirmationAuthority: authority, readinessSnapshot: snapshot })) as EventRow;
    await this.s.decideApproval(ctx, projectId, req, 'approve', body.note ?? null, authority);
    await this.s.audit.record({ action: permission, entityType: 'closing', entityId: e.id, projectId, before: { status: e.status }, after: { status: to, decisionId: decision!.id, authority }, reason: body.note ?? null });
    await this.dimensionsChanged(projectId, `event:${e.id}:${row.version}`);
    return { id: e.id, status: row.status, version: row.version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Checklist items / closing deliverables (REQ-JV-012, REQ-JV-014)

  async createItem(ctx: RequestContext, projectId: string, body: Q<'createChecklistItem'>['body']) {
    const project = await this.s.project(projectId);
    const e = await this.loadEvent(ctx, projectId, body.eventId, null, 'jv.closing_checklist.manage');
    await this.assertEventOpen(e);
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId, 'ownerUserId');
    if (body.decisionId) await this.s.decision(ctx, projectId, body.decisionId);
    const code = await this.s.nextCode('closing_deliverable', 'code', projectId, e.kind === 'signing' ? 'SCL' : 'CCL');
    const id = newId();
    await this.s.db.tx().insert(schema.closingDeliverable).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      closingId: e.id,
      code,
      title: body.title,
      responsibleParty: body.responsibleParty ?? null,
      ownerUserId: body.ownerUserId ?? null,
      dueDate: body.dueDate ?? null,
      decisionId: body.decisionId ?? null,
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: 'jv.checklist_item.create', entityType: 'closing_deliverable', entityId: id, projectId, after: { eventId: e.id, kind: e.kind, code } });
    return { id, code, version: 1 };
  }

  private async loadItem(ctx: RequestContext, projectId: string, id: string, permission: string) {
    if (this.s.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    const i = await loadInProject(this.s.db, schema.closingDeliverable, projectId, id);
    this.s.policy.assertGranted(ctx, permission, { projectId }); // role-level; acceptance asserts not_self with the deliverer
    const e = await loadInProject(this.s.db, schema.closing, projectId, i.closingId);
    return { i, e };
  }

  async deliverItem(ctx: RequestContext, projectId: string, id: string, body: Q<'deliverChecklistItem'>['body']) {
    const { i, e } = await this.loadItem(ctx, projectId, id, 'jv.closing_checklist.manage');
    await this.assertEventOpen(e);
    if (i.status !== 'pending') throw ruleViolation('jv.checklist_item.not_pending', `Only a pending item can be delivered (it is ${i.status})`);
    const doc = await this.s.visibleDocument(ctx, projectId, body.documentId);
    const { version, usable } = await this.s.documentVersion(projectId, doc.id, body.documentVersionId, doc.currentVersionId);
    if (!usable) throw ruleViolation('jv.checklist_item.executed_document_required', 'The executed document version is quarantined, pending or rejected');
    const row = (await updateVersioned(this.s.db, schema.closingDeliverable, { id, projectId, expectedVersion: body.expectedVersion }, { status: 'delivered', documentId: doc.id, executedVersionId: version.id, deliveredBy: ctx.principal.userId, deliveredAt: this.s.clock.now(), statusNote: body.note ?? null })) as ItemRow;
    await this.s.audit.record({ action: 'jv.checklist_item.deliver', entityType: 'closing_deliverable', entityId: id, projectId, before: { status: i.status }, after: { status: 'delivered', documentId: doc.id, executedVersionId: version.id } });
    return { id, status: row.status, version: row.version };
  }

  async acceptItem(ctx: RequestContext, projectId: string, id: string, body: Q<'acceptChecklistItem'>['body']) {
    this.s.assertHuman(ctx, 'Accepting a closing deliverable');
    const { i, e } = await this.loadItem(ctx, projectId, id, 'jv.cp.verify');
    await this.assertEventOpen(e);
    let usable: boolean | null = null;
    if (i.executedVersionId && i.documentId) {
      const [v] = await this.s.db.tx().select().from(schema.documentVersion).where(and(eq(schema.documentVersion.id, i.executedVersionId), eq(schema.documentVersion.projectId, projectId)));
      const [d] = await this.s.db.tx().select({ deletedAt: schema.document.deletedAt }).from(schema.document).where(and(eq(schema.document.id, i.documentId), eq(schema.document.projectId, projectId)));
      usable = !!v && !!d && !d.deletedAt && versionUsable(v.scanStatus, this.s.config.storage.allowUnscanned);
    }
    // Role → state (delivered, executed document usable: 422) → separation from the deliverer (not_self, I-R3).
    this.s.policy.assertApproval(ctx, 'jv.cp.verify', { projectId, requesterUserId: i.deliveredBy }, () =>
      assertChecklistItemAcceptable({ status: i.status, executedVersionUsable: usable, acceptorUserId: ctx.principal.userId!, ownerUserId: i.ownerUserId, deliveredBy: i.deliveredBy }),
    );
    const row = (await updateVersioned(this.s.db, schema.closingDeliverable, { id, projectId, expectedVersion: body.expectedVersion }, { status: 'verified', verifiedBy: ctx.principal.userId, verifiedAt: this.s.clock.now(), statusNote: body.note ?? i.statusNote })) as ItemRow;
    await this.s.audit.record({ action: 'jv.checklist_item.accept', entityType: 'closing_deliverable', entityId: id, projectId, before: { status: i.status }, after: { status: 'verified', executedVersionId: i.executedVersionId }, reason: body.note ?? null });
    return { id, status: row.status, version: row.version };
  }

  async itemNotRequired(ctx: RequestContext, projectId: string, id: string, body: Q<'setChecklistItemNotRequired'>['body']) {
    const { i, e } = await this.loadItem(ctx, projectId, id, 'jv.closing_checklist.manage');
    await this.assertEventOpen(e);
    if (i.status !== 'pending' && i.status !== 'delivered') throw ruleViolation('jv.checklist_item.invalid_state', `The item is ${i.status}`);
    const row = (await updateVersioned(this.s.db, schema.closingDeliverable, { id, projectId, expectedVersion: body.expectedVersion }, { status: 'not_required', statusNote: body.reason })) as ItemRow;
    await this.s.audit.record({ action: 'jv.checklist_item.not_required', entityType: 'closing_deliverable', entityId: id, projectId, before: { status: i.status }, after: { status: 'not_required' }, reason: body.reason });
    return { id, status: row.status, version: row.version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Conditions precedent (REQ-JV-013, AT-12, AT-13)

  private async loadCp(ctx: RequestContext, projectId: string, id: string, permission: string, extra: Record<string, unknown> = {}): Promise<CpRow> {
    if (this.s.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    const c = await loadInProject(this.s.db, schema.closingCondition, projectId, id);
    this.s.policy.assertGranted(ctx, permission, { projectId, ...extra }); // role-level; verify asserts not_self with the submitter
    return c;
  }

  private async assertCpEditable(c: CpRow) {
    if (!c.closingId) return;
    const e = await loadInProject(this.s.db, schema.closing, c.projectId, c.closingId);
    await this.assertEventOpen(e);
  }

  async listCps(ctx: RequestContext, projectId: string, q: Q<'listConditions'>['query']) {
    const p = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.deal.read');
    const t = schema.closingCondition;
    const where = and(
      eq(t.projectId, projectId),
      q.closingId ? eq(t.closingId, q.closingId) : undefined,
      q.status ? eq(t.status, q.status) : undefined,
      q.blocking ? eq(t.blocking, q.blocking === 'true') : undefined,
      q.q ? or(ilike(t.title, likeContains(q.q)), ilike(t.reference, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { reference: t.reference, status: t.status, longStopDate: t.longStopDate, updatedAt: t.updatedAt }, t.id, [asc(t.reference), asc(t.id)]);
    const rows = await tx.select().from(t).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    const ev = await this.s.visibleEvidenceMap(ctx, projectId, 'closing_condition', rows.map((r) => r.id));
    const wv = await this.waiverEffectiveMap(projectId, rows, this.s.today(p));
    return {
      ...pageOf(rows.map((c) => this.cpDto(c, ev.get(c.id) ?? { active: 0, conflicting: 0 }, wv.get(c.id) ?? false)), Number(total), q),
      people: await this.s.people(rows.flatMap((c) => [c.ownerUserId, c.verifiedBy, c.evidenceSubmittedBy])),
    };
  }

  async getCp(ctx: RequestContext, projectId: string, id: string) {
    const c = await this.loadCp(ctx, projectId, id, 'jv.deal.read');
    const p = await this.s.project(projectId);
    const ev = (await this.s.visibleEvidenceMap(ctx, projectId, 'closing_condition', [c.id])).get(c.id) ?? { active: 0, conflicting: 0 };
    const wv = await this.waiverEffectiveMap(projectId, [c], this.s.today(p));
    const ws = (await this.waivers.list(projectId, 'closing_condition')).filter((w) => w.targetId === c.id);
    return {
      ...this.cpDto(c, ev, wv.get(c.id) ?? false),
      waivers: ws.map((w) => ({
        id: w.id,
        conditionId: c.id,
        basis: w.basis,
        impact: w.impact,
        conditions: w.conditions,
        expiresOn: w.expiresOn,
        status: w.status,
        authorityRole: w.authorityRole as RoleKey | null,
        requestedBy: w.requestedBy,
        decidedBy: w.decidedBy,
        decidedAt: iso(w.decidedAt),
        version: w.version,
      })),
      people: await this.s.people([c.ownerUserId, c.verifiedBy, c.evidenceSubmittedBy, c.waivabilityDeterminedBy, c.createdBy, ...ws.flatMap((w) => [w.requestedBy, w.decidedBy])]),
    };
  }

  async createCp(ctx: RequestContext, projectId: string, body: Q<'createCondition'>['body']) {
    const project = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.cp.manage');
    this.s.policy.assert(ctx, 'jv.cp.manage', { projectId });
    const e = await loadInProject(this.s.db, schema.closing, projectId, body.closingId);
    if (e.kind !== 'closing') throw ruleViolation('jv.cp.closing_only', 'Conditions precedent belong to a closing (a signing has its own checklist)');
    await this.assertEventOpen(e);
    await this.s.assertMember(projectId, body.ownerUserId, 'ownerUserId');
    const reference = body.reference ?? (await this.s.nextCode('closing_condition', 'reference', projectId, 'CP'));
    const id = newId();
    await this.s.db.tx().insert(schema.closingCondition).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      closingId: e.id,
      reference,
      title: body.title,
      description: body.description ?? null,
      ownerUserId: body.ownerUserId,
      parties: body.parties ?? null,
      blocking: body.blocking,
      waivable: false, // specialist determination required (never assumed)
      validTo: body.validTo ?? null,
      longStopDate: body.longStopDate ?? null,
      gateKey: body.gateKey ?? 'G6',
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: 'jv.cp.create', entityType: 'closing_condition', entityId: id, projectId, after: { closingId: e.id, reference, blocking: body.blocking, waivable: false } });
    await this.dimensionsChanged(projectId, `cp:${id}:1`);
    return { id, code: reference, version: 1 };
  }

  async updateCp(ctx: RequestContext, projectId: string, id: string, body: Q<'updateCondition'>['body']) {
    const c = await this.loadCp(ctx, projectId, id, 'jv.cp.manage');
    await this.assertCpEditable(c);
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId, 'ownerUserId');
    const values: Record<string, unknown> = {};
    for (const k of ['title', 'description', 'ownerUserId', 'parties', 'validTo', 'longStopDate'] as const) if (body[k] !== undefined) values[k] = body[k];
    const row = await updateVersioned(this.s.db, schema.closingCondition, { id, projectId, expectedVersion: body.expectedVersion }, values);
    await this.s.audit.record({ action: 'jv.cp.update', entityType: 'closing_condition', entityId: id, projectId, before: Object.fromEntries(Object.keys(values).map((k) => [k, (c as Record<string, unknown>)[k]])), after: values });
    await this.dimensionsChanged(projectId, `cp:${id}:${row['version']}`);
    return { id, version: row['version'] as number };
  }

  async determineWaivability(ctx: RequestContext, projectId: string, id: string, body: Q<'determineConditionWaivability'>['body']) {
    this.s.assertHuman(ctx, 'Determining waivability');
    const c = await this.loadCp(ctx, projectId, id, 'gates.criterion.set_waivability');
    await this.assertCpEditable(c);
    assertCpWaivabilityDetermination(body);
    if (c.status === 'waived' && !body.waivable) throw ruleViolation('jv.cp.waived_reopen_first', `${c.reference} is waived; reopen it before determining it non-waivable`);
    const row = await updateVersioned(this.s.db, schema.closingCondition, { id, projectId, expectedVersion: body.expectedVersion }, {
      blocking: body.blocking,
      waivable: body.waivable,
      waiverAuthorityRole: body.waiverAuthorityRole,
      waivabilityBasis: body.basis,
      waivabilityDeterminedBy: ctx.principal.userId,
      waivabilityDeterminedAt: this.s.clock.now(),
    });
    await this.s.audit.record({ action: 'jv.cp.determine_waivability', entityType: 'closing_condition', entityId: id, projectId, before: { blocking: c.blocking, waivable: c.waivable, waiverAuthorityRole: c.waiverAuthorityRole }, after: { blocking: body.blocking, waivable: body.waivable, waiverAuthorityRole: body.waiverAuthorityRole }, reason: body.basis });
    await this.dimensionsChanged(projectId, `cp:${id}:${row['version']}`);
    return { id, version: row['version'] as number };
  }

  private async applyCp(ctx: RequestContext, c: CpRow, cmd: ConditionCommand, expectedVersion: number, values: Record<string, unknown>, reason: string | null) {
    const to = transition('closing_condition', CONDITION_MACHINE, c.status, cmd);
    const row = (await updateVersioned(this.s.db, schema.closingCondition, { id: c.id, projectId: c.projectId, expectedVersion }, { status: to, ...values })) as CpRow;
    await this.s.audit.record({ action: `jv.cp.${cmd}`, entityType: 'closing_condition', entityId: c.id, projectId: c.projectId, before: { status: c.status }, after: { status: to }, reason });
    await this.dimensionsChanged(c.projectId, `cp:${c.id}:${row.version}`);
    return { id: c.id, status: row.status, version: row.version };
  }

  async submitEvidence(ctx: RequestContext, projectId: string, id: string, body: Q<'submitConditionEvidence'>['body']) {
    const c = await this.loadCp(ctx, projectId, id, 'jv.cp.manage');
    await this.assertCpEditable(c);
    const ev = await this.s.evidence(projectId, 'closing_condition', c.id);
    if (ev.active <= 0) throw ruleViolation('jv.cp.evidence_required', 'Link evidence to the condition before submitting it for verification');
    return this.applyCp(ctx, c, 'submit_evidence', body.expectedVersion, { evidenceSubmittedBy: ctx.principal.userId, evidenceSubmittedAt: this.s.clock.now(), statusNote: body.note ?? null }, body.note ?? null);
  }

  /**
   * verifyCP: role → evidence and state (a refusal is logged against the CP) → separation of duties from the evidence
   * submitter and the owner (policy not_self, fail-closed when the submitter is unknown — I-R3).
   */
  async verify(ctx: RequestContext, projectId: string, id: string, body: Q<'verifyCondition'>['body']) {
    this.s.assertHuman(ctx, 'Verifying a condition');
    const c = await this.loadCp(ctx, projectId, id, 'jv.cp.verify');
    await this.assertCpEditable(c);
    const cmd = body.outcome === 'reject_evidence' ? 'reject_evidence' : 'verify';
    const ev = await this.s.evidence(projectId, 'closing_condition', c.id);
    try {
      this.s.policy.assertApproval(ctx, 'jv.cp.verify', { projectId, requesterUserId: c.evidenceSubmittedBy }, () => {
        if (cmd === 'verify') assertCpVerifiable({ activeEvidence: ev.active, verifierUserId: ctx.principal.userId!, ownerUserId: c.ownerUserId, evidenceSubmittedBy: c.evidenceSubmittedBy });
        transition('closing_condition', CONDITION_MACHINE, c.status, cmd);
      });
    } catch (e) {
      if (cmd === 'verify') {
        await this.s.audit.recordDetached(ctx, { action: 'jv.cp.verify', entityType: 'closing_condition', entityId: c.id, projectId, outcome: e instanceof DomainError && e.kind === 'forbidden' ? 'denied' : 'rejected', reason: (e as Error).message, before: { status: c.status, activeEvidence: ev.active } });
      }
      throw e;
    }
    if (cmd === 'reject_evidence') return this.applyCp(ctx, c, 'reject_evidence', body.expectedVersion, { statusNote: body.note ?? null }, body.note ?? null);
    return this.applyCp(ctx, c, 'verify', body.expectedVersion, { verifiedBy: ctx.principal.userId, verifiedAt: this.s.clock.now(), statusNote: body.note ?? null }, body.note ?? null);
  }

  async reopen(ctx: RequestContext, projectId: string, id: string, body: Q<'reopenCondition'>['body']) {
    const c = await this.loadCp(ctx, projectId, id, 'jv.cp.manage');
    await this.assertCpEditable(c);
    return this.applyCp(ctx, c, 'reopen', body.expectedVersion, { verifiedBy: null, verifiedAt: null, waiverId: null, evidenceSubmittedBy: null, evidenceSubmittedAt: null, statusNote: body.reason }, body.reason);
  }

  async requestWaiver(ctx: RequestContext, projectId: string, id: string, body: Q<'requestConditionWaiver'>['body']) {
    const c = await this.loadCp(ctx, projectId, id, 'jv.cp.manage');
    await this.assertCpEditable(c);
    const w = await this.waivers.request(ctx, projectId, 'closing_condition', c.id, body);
    return { id: w.id, status: w.status, version: w.version };
  }

  async approveWaiver(ctx: RequestContext, projectId: string, waiverId: string, body: Q<'approveConditionWaiver'>['body']) {
    if (this.s.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    const w = await this.waivers.approve(ctx, projectId, waiverId, body, 'closing_condition');
    return { id: w.id, status: w.status, version: w.version };
  }

  async rejectWaiver(ctx: RequestContext, projectId: string, waiverId: string, body: Q<'rejectConditionWaiver'>['body']) {
    if (this.s.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    const w = await this.waivers.reject(ctx, projectId, waiverId, body, 'closing_condition');
    return { id: w.id, status: w.status, version: w.version };
  }

  /** Called by the waiver register inside the approval transaction (waivable CPs only — non-waivable never get here). */
  private async applyWaiver(ctx: RequestContext, projectId: string, w: WaiverRecord) {
    const c = await loadInProject(this.s.db, schema.closingCondition, projectId, w.targetId);
    if (!c.waivable) throw ruleViolation('gates.waiver.non_waivable', `Condition ${c.reference} is not waivable`);
    await this.applyCp(ctx, c, 'waive', c.version, { waiverId: w.id, statusNote: `Waived — ${w.basis}`.slice(0, 2000) }, w.basis);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Funds flow — RECORD ONLY (REQ-JV-015)

  async listFlows(ctx: RequestContext, projectId: string, eventId: string) {
    const e = await this.loadEvent(ctx, projectId, eventId, 'closing');
    const rows = await this.s.db.tx().select().from(schema.fundsFlowItem).where(and(eq(schema.fundsFlowItem.projectId, projectId), eq(schema.fundsFlowItem.closingId, e.id))).orderBy(asc(schema.fundsFlowItem.code), asc(schema.fundsFlowItem.id));
    return { items: rows.map((f) => this.flowDto(f)), notice: FUNDS_FLOW_NOTICE };
  }

  async createFlow(ctx: RequestContext, projectId: string, eventId: string, body: Q<'createFundsFlow'>['body']) {
    const project = await this.s.project(projectId);
    const e = await this.loadEvent(ctx, projectId, eventId, 'closing', 'jv.funds_flow.manage');
    if (e.status === 'aborted') throw ruleViolation('jv.event.frozen', 'The closing was aborted');
    if (body.amount) parseMoney(body.amount);
    const code = await this.s.nextCode('funds_flow_item', 'code', projectId, 'FF');
    const id = newId();
    await this.s.db.tx().insert(schema.fundsFlowItem).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      closingId: e.id,
      code,
      description: body.description,
      payer: body.payer,
      payee: body.payee,
      amount: body.amount?.amount ?? null,
      currency: body.amount?.currency ?? null,
      unitScale: body.amount?.unitScale ?? null,
      valueDate: body.valueDate ?? null,
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: 'jv.funds_flow.create', entityType: 'funds_flow_item', entityId: id, projectId, after: { closingId: e.id, code, amount: body.amount ?? null, recordOnly: true } });
    return { id, code, version: 1 };
  }

  async transitionFlow(ctx: RequestContext, projectId: string, flowId: string, body: Q<'transitionFundsFlow'>['body']) {
    if (this.s.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    const f = await loadInProject(this.s.db, schema.fundsFlowItem, projectId, flowId);
    this.s.policy.assert(ctx, 'jv.funds_flow.manage', { projectId });
    const cmd = body.command as FundsFlowCommand;
    if (cmd === 'report_settled' && !body.settlementReference?.trim()) throw ruleViolation('jv.funds_flow.settlement_reference_required', 'Reporting a settlement requires the external settlement reference (the platform never pays)');
    if (cmd === 'cancel' && !body.note?.trim()) throw ruleViolation('jv.funds_flow.reason_required', 'A reason is required to cancel');
    const to = transition('funds_flow_item', FUNDS_FLOW_MACHINE, f.status, cmd);
    const now = this.s.clock.now();
    const values: Record<string, unknown> = { status: to, statusNote: body.note ?? null };
    if (cmd === 'confirm') Object.assign(values, { confirmedBy: ctx.principal.userId, confirmedAt: now });
    if (cmd === 'report_settled') Object.assign(values, { settlementReference: body.settlementReference, settlementReportedBy: ctx.principal.userId, settlementReportedAt: now });
    const row = (await updateVersioned(this.s.db, schema.fundsFlowItem, { id: f.id, projectId, expectedVersion: body.expectedVersion }, values)) as FlowRow;
    await this.s.audit.record({ action: `jv.funds_flow.${cmd}`, entityType: 'funds_flow_item', entityId: f.id, projectId, before: { status: f.status }, after: { status: to, settlementReference: body.settlementReference ?? null, recordOnly: true }, reason: body.note ?? null });
    return { id: f.id, status: row.status, version: row.version };
  }
}

function blockerJson(b: EventBlocker) {
  return { kind: b.kind, ref: b.ref, message: b.message, messageI18n: b.messageI18n };
}

