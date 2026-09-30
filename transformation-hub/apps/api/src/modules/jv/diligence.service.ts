import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  DD_RELEASE_MACHINE,
  FINDING_MACHINE,
  allowedCommands,
  assertDdReleaseAllowed,
  assertDdReviewAllowed,
  assertFindingRemediation,
  clearanceAllows,
  conflict,
  DomainError,
  externalDdStatus,
  forbidden,
  isMaterialFinding,
  notFound,
  ruleViolation,
  transition,
  Classification,
  DdReleaseStatus,
  FindingCommand,
} from '@hub/domain';
import type { RouteInput, jvRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId } from '../../platform/ids';
import { JvSupport, RoomRow, iso } from './jv.support';

type Q<K extends keyof typeof jvRoutes> = RouteInput<(typeof jvRoutes)[K]>;
type RequestRow = typeof schema.diligenceRequest.$inferSelect;
type FindingRow = typeof schema.diligenceFinding.$inferSelect;

/**
 * Due diligence Q&A (REQ-JV-010) and findings (REQ-JV-011). Requests live in a room; the internal projection needs a
 * room grant (lists filtered in SQL); the counterparty sees only question / status / due date / RELEASED answer. An
 * answer is released only after a separate review approved it, by someone other than the drafter; its evidence
 * documents are disclosed with it. A finding's room is derived from its DD request (ARCH-22).
 */
@Injectable()
export class DiligenceService {
  constructor(private readonly s: JvSupport) {}

  // ---------------------------------------------------------------------------------------------------------
  // helpers

  private async attrsOf(r: { projectId: string; roomId: string | null; classification: string }) {
    let roomIsCleanTeam = false;
    if (r.roomId) roomIsCleanTeam = (await this.s.room(r.projectId, r.roomId)).isCleanTeam;
    return { projectId: r.projectId, classification: r.classification as Classification, roomId: r.roomId, roomIsCleanTeam };
  }

  private async loadRequest(ctx: RequestContext, projectId: string, id: string, permission: string, extra: Record<string, unknown> = {}): Promise<RequestRow> {
    const r = await loadInProject(this.s.db, schema.diligenceRequest, projectId, id);
    // Role-level pre-check (I-R3): subject conditions (not_self) are asserted by the command once the drafter is known.
    this.s.policy.assertGranted(ctx, permission, { ...(await this.attrsOf(r)), ...extra });
    return r;
  }

  private requestDto(r: RequestRow) {
    return {
      id: r.id,
      number: r.number,
      roomId: r.roomId,
      partnerId: r.partnerId,
      origin: r.origin as 'internal' | 'partner',
      question: r.question,
      domain: r.domain,
      requesterLabel: r.requesterLabel,
      assigneeUserId: r.assigneeUserId,
      reviewerUserId: r.reviewerUserId,
      dueDate: r.dueDate,
      releaseStatus: r.releaseStatus,
      classification: r.classification,
      isDemo: r.isDemo,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      version: r.version,
    };
  }

  /**
   * Next request number within the ROOM: every member of a room sees all of its requests, so the number never depends
   * on rows the caller cannot see (and reveals nothing about other rooms).
   */
  private async nextNumber(projectId: string, roomId: string): Promise<number> {
    const r = await this.s.db.query<{ n: number }>(`select coalesce(max(number), 0)::int + 1 as n from diligence_request where project_id = $1 and room_id = $2`, [projectId, roomId]);
    return r.rows[0]?.n ?? 1;
  }

  /** Finding code: per room for room-bound findings (FND-<room>-NNN), per project otherwise — never a hidden count. */
  private async findingCode(projectId: string, roomId: string | null): Promise<string> {
    if (!roomId) return this.s.nextCode('diligence_finding', 'code', projectId, 'FND');
    const r = await this.s.db.query<{ n: number }>(
      `select coalesce(max(nullif(substring(code from '[0-9]+$'), '')::int), 0)::int + 1 as n from diligence_finding where project_id = $1 and room_id = $2`,
      [projectId, roomId],
    );
    return `FND-${roomId.replace(/-/g, '').slice(-6).toUpperCase()}-${String(r.rows[0]?.n ?? 1).padStart(3, '0')}`;
  }

  private async insertRequest(ctx: RequestContext, room: RoomRow, v: { question: string; domain: string; origin: 'internal' | 'partner'; requesterLabel: string | null; dueDate: string | null; classification: Classification }) {
    const project = await this.s.project(room.projectId);
    const id = newId();
    const number = await this.nextNumber(room.projectId, room.id);
    await this.s.db.tx().insert(schema.diligenceRequest).values({
      id,
      orgId: ctx.principal.orgId,
      projectId: room.projectId,
      partnerId: room.partnerId,
      roomId: room.id,
      number,
      origin: v.origin,
      question: v.question,
      domain: v.domain,
      requesterLabel: v.requesterLabel,
      dueDate: v.dueDate,
      classification: v.classification,
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: 'jv.dd_request.create', entityType: 'diligence_request', entityId: id, projectId: room.projectId, after: { roomId: room.id, number, origin: v.origin, domain: v.domain } });
    return { id, number };
  }

  /** The assignee / reviewer of a request works inside the room: internal account with a contribute grant on it. */
  private async assertRoomWorker(projectId: string, roomId: string, userId: string, field: string) {
    const r = await this.s.db.tx().execute<{ ok: boolean }>(sql`
      select exists (select 1 from room_grant g join app_user u on u.id = g.user_id and u.is_active and u.account_type = 'internal'
                      where g.project_id = ${projectId} and g.room_id = ${roomId} and g.user_id = ${userId} and g.revoked_at is null
                        and (g.expires_at is null or g.expires_at > now()) and g.access_level in ('contribute', 'manage')) as ok`);
    if (!r.rows[0]?.ok) throw ruleViolation('jv.dd.not_room_worker', `${field}: the person needs an active contribute grant on the room`);
  }

  // ---------------------------------------------------------------------------------------------------------
  // DD requests — internal projection

  async list(ctx: RequestContext, projectId: string, q: Q<'listDdRequests'>['query']) {
    await this.s.project(projectId);
    const t = schema.diligenceRequest;
    const where = and(
      eq(t.projectId, projectId),
      this.s.policy.visibilitySql(ctx, projectId, { classification: t.classification, room: t.roomId }),
      q.roomId ? eq(t.roomId, q.roomId) : undefined,
      q.releaseStatus ? eq(t.releaseStatus, q.releaseStatus) : undefined,
      q.q ? or(ilike(t.question, likeContains(q.q)), ilike(t.domain, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { number: t.number, dueDate: t.dueDate, createdAt: t.createdAt }, t.id, [desc(t.createdAt), desc(t.id)]);
    const rows = await tx.select().from(t).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return { ...pageOf(rows.map((r) => this.requestDto(r)), Number(total), q), people: await this.s.people(rows.flatMap((r) => [r.assigneeUserId, r.reviewerUserId, r.createdBy])) };
  }

  async get(ctx: RequestContext, projectId: string, id: string) {
    const r = await this.loadRequest(ctx, projectId, id, 'jv.dd_request.read');
    return {
      ...this.requestDto(r),
      answerDraft: r.answerDraft,
      draftedBy: r.draftedBy,
      evidenceDocumentIds: r.evidenceDocumentIds,
      submittedForReviewBy: r.submittedForReviewBy,
      submittedForReviewAt: iso(r.submittedForReviewAt),
      releaseApprovedBy: r.releaseApprovedBy,
      releaseApprovedAt: iso(r.releaseApprovedAt),
      reviewNote: r.reviewNote,
      releasedBy: r.releasedBy,
      releasedAnswer: r.releasedAnswer,
      releasedVersion: r.releasedVersion,
      releasedAt: iso(r.releasedAt),
      allowedCommands: allowedCommands(DD_RELEASE_MACHINE, r.releaseStatus),
      people: await this.s.people([r.assigneeUserId, r.reviewerUserId, r.createdBy, r.draftedBy, r.submittedForReviewBy, r.releaseApprovedBy, r.releasedBy]),
    };
  }

  async create(ctx: RequestContext, projectId: string, body: Q<'createDdRequest'>['body']) {
    const room = await this.s.room(projectId, body.roomId);
    this.s.assertClassification(ctx, body.classification);
    this.s.policy.assert(ctx, 'jv.dd_request.create', this.s.roomAttrs(room, body.classification));
    await this.s.assertLevel(ctx, room, 'contribute');
    if (room.lockedAt) throw ruleViolation('jv.room.locked', 'The room is locked');
    return this.insertRequest(ctx, room, { question: body.question, domain: body.domain, origin: 'internal', requesterLabel: body.requesterLabel ?? null, dueDate: body.dueDate ?? null, classification: body.classification });
  }

  async assign(ctx: RequestContext, projectId: string, id: string, body: Q<'assignDdRequest'>['body']) {
    const r = await this.loadRequest(ctx, projectId, id, 'jv.dd_request.assign');
    if (!r.roomId) throw ruleViolation('jv.dd.no_room', 'The request is not filed in a room');
    if (r.releaseStatus === 'released') throw ruleViolation('jv.dd.already_released', 'A released answer is not reassigned');
    await this.assertRoomWorker(projectId, r.roomId, body.assigneeUserId, 'assigneeUserId');
    if (body.reviewerUserId) {
      if (body.reviewerUserId === body.assigneeUserId) throw ruleViolation('jv.dd.reviewer_is_assignee', 'The reviewer must be a different person from the answer owner');
      await this.assertRoomWorker(projectId, r.roomId, body.reviewerUserId, 'reviewerUserId');
    }
    const values: Record<string, unknown> = { assigneeUserId: body.assigneeUserId };
    if (body.reviewerUserId !== undefined) values['reviewerUserId'] = body.reviewerUserId;
    if (body.dueDate !== undefined) values['dueDate'] = body.dueDate;
    const row = await updateVersioned(this.s.db, schema.diligenceRequest, { id, projectId, expectedVersion: body.expectedVersion }, values);
    await this.s.audit.record({ action: 'jv.dd_request.assign', entityType: 'diligence_request', entityId: id, projectId, before: { assigneeUserId: r.assigneeUserId, reviewerUserId: r.reviewerUserId, dueDate: r.dueDate }, after: values });
    return { id, version: row['version'] as number };
  }

  async draftAnswer(ctx: RequestContext, projectId: string, id: string, body: Q<'draftDdAnswer'>['body']) {
    const r = await this.loadRequest(ctx, projectId, id, 'jv.dd_request.read');
    this.s.policy.assert(ctx, 'jv.dd_answer.draft', { ...(await this.attrsOf(r)), ownerUserIds: [r.assigneeUserId] });
    const room = await this.s.room(projectId, r.roomId!);
    await this.s.assertLevel(ctx, room, 'contribute');
    if (r.releaseStatus !== 'draft') throw ruleViolation('jv.dd.not_draft', `The answer can be edited only in draft (it is ${r.releaseStatus})`);
    for (const docId of body.evidenceDocumentIds) {
      const d = await this.s.visibleDocument(ctx, projectId, docId);
      if (d.roomId !== r.roomId) throw ruleViolation('jv.dd.evidence_not_in_room', 'Evidence documents of an answer must be filed in the same room');
    }
    const row = await updateVersioned(this.s.db, schema.diligenceRequest, { id, projectId, expectedVersion: body.expectedVersion }, { answerDraft: body.answerDraft, draftedBy: ctx.principal.userId, evidenceDocumentIds: [...new Set(body.evidenceDocumentIds)] });
    await this.s.audit.record({ action: 'jv.dd_answer.draft', entityType: 'diligence_request', entityId: id, projectId, after: { evidenceDocuments: body.evidenceDocumentIds.length } });
    return { id, version: row['version'] as number };
  }

  async submitForReview(ctx: RequestContext, projectId: string, id: string, body: Q<'submitDdAnswer'>['body']) {
    const r = await this.loadRequest(ctx, projectId, id, 'jv.dd_request.read');
    this.s.policy.assert(ctx, 'jv.dd_answer.draft', { ...(await this.attrsOf(r)), ownerUserIds: [r.assigneeUserId, r.draftedBy] });
    if (!r.answerDraft?.trim()) throw ruleViolation('jv.dd.answer_missing', 'Draft an answer before submitting it for review');
    const to = transition('diligence_request', DD_RELEASE_MACHINE, r.releaseStatus, 'submit_for_review');
    const row = await updateVersioned(this.s.db, schema.diligenceRequest, { id, projectId, expectedVersion: body.expectedVersion }, { releaseStatus: to, submittedForReviewBy: ctx.principal.userId, submittedForReviewAt: this.s.clock.now() });
    await this.s.audit.record({ action: 'jv.dd_answer.submit', entityType: 'diligence_request', entityId: id, projectId, before: { releaseStatus: r.releaseStatus }, after: { releaseStatus: to }, reason: body.note ?? null });
    return { id, version: row['version'] as number };
  }

  async review(ctx: RequestContext, projectId: string, id: string, body: Q<'reviewDdAnswer'>['body']) {
    this.s.assertHuman(ctx, 'Reviewing a DD answer');
    const r = await this.loadRequest(ctx, projectId, id, 'jv.dd_answer.review');
    const cmd = body.outcome === 'approve' ? 'approve_release' : body.outcome === 'return' ? 'return_to_draft' : 'withhold';
    // Role → state (an answer not submitted for review has nothing to review: 422) → separation from the drafter (I-R3).
    let to = r.releaseStatus;
    this.s.policy.assertApproval(ctx, 'jv.dd_answer.review', { ...(await this.attrsOf(r)), requesterUserId: r.draftedBy }, () => {
      to = transition('diligence_request', DD_RELEASE_MACHINE, r.releaseStatus, cmd);
    });
    assertDdReviewAllowed({ reviewerUserId: ctx.principal.userId!, drafterUserId: r.draftedBy });
    if (r.reviewerUserId && r.reviewerUserId !== ctx.principal.userId) throw forbidden('jv.dd.not_designated_reviewer', 'Only the designated reviewer may review this answer');
    const values: Record<string, unknown> = { releaseStatus: to, reviewNote: body.note ?? null };
    if (cmd === 'approve_release') Object.assign(values, { releaseApprovedBy: ctx.principal.userId, releaseApprovedAt: this.s.clock.now() });
    else Object.assign(values, { releaseApprovedBy: null, releaseApprovedAt: null });
    const row = await updateVersioned(this.s.db, schema.diligenceRequest, { id, projectId, expectedVersion: body.expectedVersion }, values);
    await this.s.audit.record({ action: `jv.dd_answer.${cmd}`, entityType: 'diligence_request', entityId: id, projectId, before: { releaseStatus: r.releaseStatus }, after: { releaseStatus: to }, reason: body.note ?? null });
    return { id, releaseStatus: to as DdReleaseStatus, version: row['version'] as number };
  }

  /**
   * Release to the partner room: ONLY an answer whose review approved the release, by someone other than the drafter.
   * A refusal is audited against the request (autonomous transaction) and the answer stays unreleased.
   */
  async release(ctx: RequestContext, projectId: string, id: string, body: Q<'releaseDdAnswer'>['body']) {
    this.s.assertHuman(ctx, 'Releasing a DD answer');
    const r = await this.loadRequest(ctx, projectId, id, 'jv.disclosure.release');
    const attrs = await this.attrsOf(r);
    const room = await this.s.room(projectId, r.roomId!);
    try {
      // Role → state (no approved review: 422 jv.dd.release_requires_approval) → separation from the drafter (I-R3).
      this.s.policy.assertApproval(ctx, 'jv.disclosure.release', { ...attrs, requesterUserId: r.draftedBy }, () => {
        assertDdReleaseAllowed({ status: r.releaseStatus, releaserUserId: ctx.principal.userId!, drafterUserId: r.draftedBy, reviewerUserId: r.releaseApprovedBy, answer: r.answerDraft });
        if (this.s.roomType(room) !== 'partner') throw ruleViolation('jv.dd.release_partner_room_only', 'Answers are released into a partner room');
        if (room.lockedAt) throw ruleViolation('jv.room.locked', 'The room is locked');
      });
    } catch (e) {
      const outcome = e instanceof DomainError && e.kind === 'forbidden' ? 'denied' : 'rejected';
      await this.s.audit.recordDetached(ctx, { action: 'jv.dd_answer.release', entityType: 'diligence_request', entityId: r.id, projectId, outcome, reason: (e as Error).message, before: { releaseStatus: r.releaseStatus } });
      throw e;
    }
    assertVersion(r, body.expectedVersion, 'DD request');
    // Evidence documents are disclosed with the answer (their current, usable versions — never a quarantined file).
    const project = await this.s.project(projectId);
    const releasedDocs: { disclosureId: string; versionId: string }[] = [];
    for (const docId of r.evidenceDocumentIds) {
      const d = await this.s.visibleDocument(ctx, projectId, docId);
      if (d.roomId !== room.id) throw ruleViolation('jv.dd.evidence_not_in_room', 'An evidence document was moved out of the room — update the answer');
      const { version, usable } = await this.s.documentVersion(projectId, d.id, null, d.currentVersionId);
      if (!usable) throw ruleViolation('jv.disclosure.version_not_usable', `Evidence document "${d.title}" has no usable version`);
      if (version.uploadedBy === ctx.principal.userId) throw forbidden('jv.disclosure.self_release', 'The uploader of an evidence document cannot release it');
      const [live] = await this.s.db
        .tx()
        .select({ id: schema.roomDisclosure.id, status: schema.roomDisclosure.status })
        .from(schema.roomDisclosure)
        .where(and(eq(schema.roomDisclosure.projectId, projectId), eq(schema.roomDisclosure.roomId, room.id), eq(schema.roomDisclosure.documentVersionId, version.id), inArray(schema.roomDisclosure.status, ['requested', 'released'])));
      if (live?.status === 'released') continue;
      if (live) throw conflict('jv.disclosure.already_live', `A release of "${d.title}" is pending separately — decide it first`);
      const disclosureId = newId();
      const now = this.s.clock.now();
      await this.s.db.tx().insert(schema.roomDisclosure).values({
        id: disclosureId,
        orgId: ctx.principal.orgId,
        projectId,
        documentId: d.id,
        documentVersionId: version.id,
        diligenceRequestId: r.id,
        status: 'released',
        requestNote: `Evidence of DD answer #${r.number}`,
        requestedBy: r.draftedBy ?? r.releaseApprovedBy!,
        releasedBy: ctx.principal.userId,
        releasedAt: now,
        isDemo: project.isDemo,
      });
      await this.s.roomEvent(ctx, { projectId, roomId: room.id, kind: 'disclosure_released', disclosureId, diligenceRequestId: r.id, documentVersionId: version.id, note: `Evidence of DD answer #${r.number}` });
      releasedDocs.push({ disclosureId, versionId: version.id });
    }
    const to = transition('diligence_request', DD_RELEASE_MACHINE, r.releaseStatus, 'release');
    const row = await updateVersioned(this.s.db, schema.diligenceRequest, { id, projectId, expectedVersion: body.expectedVersion }, {
      releaseStatus: to,
      releasedBy: ctx.principal.userId,
      releasedAt: this.s.clock.now(),
      releasedAnswer: r.answerDraft,
      releasedVersion: r.version + 1,
    });
    await this.s.roomEvent(ctx, { projectId, roomId: room.id, kind: 'dd_answer_released', diligenceRequestId: r.id, note: body.note ?? null });
    await this.s.audit.record({ action: 'jv.dd_answer.release', entityType: 'diligence_request', entityId: id, projectId, before: { releaseStatus: r.releaseStatus }, after: { releaseStatus: to, releasedVersion: r.version + 1, disclosures: releasedDocs.length }, reason: body.note ?? null });
    await this.s.permissionChanged(projectId, room.id, 'dd_answer_released', { diligenceRequestId: r.id });
    return { id, releaseStatus: to as DdReleaseStatus, version: row['version'] as number, disclosures: releasedDocs.length };
  }

  // ---------------------------------------------------------------------------------------------------------
  // DD requests — counterparty projection (never drafts, assignees or reviewers)

  private async externalRoom(ctx: RequestContext, projectId: string, roomId: string, permission: string) {
    const room = await this.s.room(projectId, roomId);
    this.s.policy.assert(ctx, permission, this.s.roomAttrs(room));
    if (this.s.roomType(room) !== 'partner') throw notFound();
    return room;
  }

  async externalList(ctx: RequestContext, projectId: string, roomId: string) {
    await this.externalRoom(ctx, projectId, roomId, 'jv.dd_request.read_external');
    const t = schema.diligenceRequest;
    const rows = await this.s.db
      .tx()
      .select()
      .from(t)
      .where(and(eq(t.projectId, projectId), eq(t.roomId, roomId), this.s.policy.visibilitySql(ctx, projectId, { classification: t.classification, room: t.roomId })))
      .orderBy(asc(t.number), asc(t.id));
    return {
      items: rows.map((r) => ({
        id: r.id,
        number: r.number,
        question: r.question,
        domain: r.domain,
        dueDate: r.dueDate,
        status: externalDdStatus(r.releaseStatus),
        answer: r.releaseStatus === 'released' ? r.releasedAnswer : null,
        answeredAt: r.releaseStatus === 'released' ? iso(r.releasedAt) : null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async externalCreate(ctx: RequestContext, projectId: string, roomId: string, body: Q<'createExternalDdRequest'>['body']) {
    const room = await this.externalRoom(ctx, projectId, roomId, 'jv.dd_request.create');
    await this.s.assertLevel(ctx, room, 'contribute');
    // The counterparty's question is classified at most at its own clearance (so it can always see its own question).
    const classification: Classification = clearanceAllows(ctx.principal.clearance, 'confidential') ? 'confidential' : ctx.principal.clearance;
    return this.insertRequest(ctx, room, { question: body.question, domain: body.domain, origin: 'partner', requesterLabel: 'Counterparty', dueDate: null, classification });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Findings (REQ-JV-011, ARCH-22)

  private findingDto(f: FindingRow) {
    return {
      id: f.id,
      code: f.code,
      title: f.title,
      description: f.description,
      materiality: f.materiality,
      material: isMaterialFinding(f.materiality),
      partnerId: f.partnerId,
      roomId: f.roomId,
      diligenceRequestId: f.diligenceRequestId,
      riskId: f.riskId,
      remediation: f.remediation,
      remediationOwnerUserId: f.remediationOwnerUserId,
      remediationDueDate: f.remediationDueDate,
      valuationImplication: f.valuationImplication,
      documentImplication: f.documentImplication,
      cpImplication: f.cpImplication,
      conditionId: f.conditionId,
      status: f.status,
      statusReason: f.statusReason,
      allowedCommands: allowedCommands(FINDING_MACHINE, f.status),
      classification: f.classification,
      isDemo: f.isDemo,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
      version: f.version,
    };
  }

  private async loadFinding(ctx: RequestContext, projectId: string, id: string, permission: string): Promise<FindingRow> {
    const f = await loadInProject(this.s.db, schema.diligenceFinding, projectId, id);
    this.s.policy.assert(ctx, permission, await this.attrsOf(f));
    return f;
  }

  private async findingRefs(ctx: RequestContext, projectId: string, refs: { riskId?: string | null; conditionId?: string | null; remediationOwnerUserId?: string | null }) {
    if (refs.riskId) await loadInProject(this.s.db, schema.risk, projectId, refs.riskId);
    if (refs.conditionId) await loadInProject(this.s.db, schema.closingCondition, projectId, refs.conditionId);
    if (refs.remediationOwnerUserId) await this.s.assertMember(projectId, refs.remediationOwnerUserId, 'remediationOwnerUserId');
    void ctx;
  }

  async listFindings(ctx: RequestContext, projectId: string, q: Q<'listFindings'>['query']) {
    await this.s.project(projectId);
    const t = schema.diligenceFinding;
    const where = and(
      eq(t.projectId, projectId),
      this.s.policy.visibilitySql(ctx, projectId, { classification: t.classification, room: t.roomId }),
      q.materiality ? eq(t.materiality, q.materiality) : undefined,
      q.status ? eq(t.status, q.status) : undefined,
      q.roomId ? eq(t.roomId, q.roomId) : undefined,
      q.q ? or(ilike(t.title, likeContains(q.q)), ilike(t.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: t.code, materiality: t.materiality, status: t.status, updatedAt: t.updatedAt }, t.id, [asc(t.code), asc(t.id)]);
    const rows = await tx.select().from(t).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(rows.map((r) => this.findingDto(r)), Number(total), q);
  }

  async getFinding(ctx: RequestContext, projectId: string, id: string) {
    return this.findingDto(await this.loadFinding(ctx, projectId, id, 'jv.dd_request.read'));
  }

  async createFinding(ctx: RequestContext, projectId: string, body: Q<'createFinding'>['body']) {
    const project = await this.s.project(projectId);
    this.s.assertClassification(ctx, body.classification);
    let roomId: string | null = body.roomId ?? null;
    let partnerId: string | null = body.partnerId ?? null;
    if (body.diligenceRequestId) {
      const r = await this.loadRequest(ctx, projectId, body.diligenceRequestId, 'jv.dd_request.read');
      if (body.roomId && body.roomId !== r.roomId) throw ruleViolation('jv.finding.room_mismatch', "A finding raised from a DD request belongs to the request's room");
      roomId = r.roomId; // the database derives it again (never client-set)
      partnerId = r.partnerId;
    }
    const room = roomId ? await this.s.room(projectId, roomId) : null;
    if (room && partnerId && room.partnerId && partnerId !== room.partnerId) throw ruleViolation('jv.finding.partner_mismatch', "The finding's partner differs from the room's partner");
    if (room) partnerId = partnerId ?? room.partnerId;
    this.s.policy.assert(ctx, 'jv.finding.manage', room ? this.s.roomAttrs(room, body.classification) : { projectId, classification: body.classification });
    if (room) await this.s.assertLevel(ctx, room, 'contribute');
    if (partnerId && !room) {
      const p = await loadInProject(this.s.db, schema.partner, projectId, partnerId);
      if (!this.s.policy.canSee(ctx, { projectId, classification: p.classification as Classification })) throw notFound();
    }
    assertFindingRemediation({ materiality: body.materiality, remediationOwnerUserId: body.remediationOwnerUserId, remediation: body.remediation });
    await this.findingRefs(ctx, projectId, body);
    const code = await this.findingCode(projectId, roomId);
    const id = newId();
    await this.s.db.tx().insert(schema.diligenceFinding).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      partnerId,
      roomId,
      diligenceRequestId: body.diligenceRequestId ?? null,
      code,
      title: body.title,
      description: body.description ?? null,
      materiality: body.materiality,
      riskId: body.riskId ?? null,
      remediation: body.remediation ?? null,
      remediationOwnerUserId: body.remediationOwnerUserId ?? null,
      remediationDueDate: body.remediationDueDate ?? null,
      valuationImplication: body.valuationImplication ?? null,
      documentImplication: body.documentImplication ?? null,
      cpImplication: body.cpImplication ?? null,
      conditionId: body.conditionId ?? null,
      classification: body.classification,
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: 'jv.finding.create', entityType: 'diligence_finding', entityId: id, projectId, after: { code, materiality: body.materiality, roomId, diligenceRequestId: body.diligenceRequestId ?? null } });
    return { id, code, version: 1 };
  }

  async updateFinding(ctx: RequestContext, projectId: string, id: string, body: Q<'updateFinding'>['body']) {
    const f = await this.loadFinding(ctx, projectId, id, 'jv.finding.manage');
    if (f.roomId) await this.s.assertLevel(ctx, await this.s.room(projectId, f.roomId), 'contribute');
    const merged = {
      materiality: body.materiality ?? f.materiality,
      remediationOwnerUserId: body.remediationOwnerUserId === undefined ? f.remediationOwnerUserId : body.remediationOwnerUserId,
      remediation: body.remediation === undefined ? f.remediation : body.remediation,
    };
    assertFindingRemediation(merged);
    await this.findingRefs(ctx, projectId, body);
    const values: Record<string, unknown> = {};
    for (const k of ['title', 'description', 'materiality', 'riskId', 'remediation', 'remediationOwnerUserId', 'remediationDueDate', 'valuationImplication', 'documentImplication', 'cpImplication', 'conditionId'] as const) if (body[k] !== undefined) values[k] = body[k];
    const row = await updateVersioned(this.s.db, schema.diligenceFinding, { id, projectId, expectedVersion: body.expectedVersion }, values);
    await this.s.audit.record({ action: 'jv.finding.update', entityType: 'diligence_finding', entityId: id, projectId, before: Object.fromEntries(Object.keys(values).map((k) => [k, (f as Record<string, unknown>)[k]])), after: values });
    return { id, version: row['version'] as number };
  }

  async transitionFinding(ctx: RequestContext, projectId: string, id: string, body: Q<'transitionFinding'>['body']) {
    const f = await this.loadFinding(ctx, projectId, id, 'jv.finding.manage');
    if (f.roomId) await this.s.assertLevel(ctx, await this.s.room(projectId, f.roomId), 'contribute');
    const cmd = body.command as FindingCommand;
    if (cmd === 'plan_remediation' && (!f.remediationOwnerUserId || !f.remediation?.trim())) {
      throw ruleViolation('jv.finding.remediation_owner_required', 'Planning remediation requires a remediation owner and plan');
    }
    if ((cmd === 'accept_risk' || cmd === 'reopen') && !body.note?.trim()) throw ruleViolation('jv.finding.reason_required', `A reason is required to ${cmd.replace('_', ' ')}`);
    const to = transition('diligence_finding', FINDING_MACHINE, f.status, cmd);
    const row = (await updateVersioned(this.s.db, schema.diligenceFinding, { id, projectId, expectedVersion: body.expectedVersion }, { status: to, statusReason: body.note ?? null })) as FindingRow;
    await this.s.audit.record({ action: `jv.finding.${cmd}`, entityType: 'diligence_finding', entityId: id, projectId, before: { status: f.status }, after: { status: to }, reason: body.note ?? null });
    return { id, status: row.status, version: row.version };
  }
}
