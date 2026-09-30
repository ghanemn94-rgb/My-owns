import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  Classification,
  DECISION_AUTHORITY_OUTCOMES,
  DECISION_MACHINE,
  DECISION_STATUSES,
  DecisionCommand,
  DecisionStatus,
  VoteChoice,
  allowedCommands,
  assertApprovalAllowed,
  assertImplementationStartable,
  assertImplementationVerifiable,
  assertMayVote,
  assertVotesUnderMatrix,
  checkAuthority,
  circulationResponders,
  clearanceAllows,
  computeQuorum,
  conflict,

  missingDecisionPaperFields,
  planDecisionOutcome,
  presentUserIds,
  ruleViolation,
  tallyVotes,
  transition,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { RecordVersionService, assertVersion, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import type { RouteInput, governanceRoutes } from '@hub/contracts';
import { newId } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';
import { DecisionRow, GovernanceSupport, MeetingRow, amountOf, iso } from './governance.support';
import { MeetingsService } from './meetings.service';
import { likeContains } from '../../platform/helpers';

type AuthorityOutcome = (typeof DECISION_AUTHORITY_OUTCOMES)[number];
type Money = { amount: string; currency: string; unitScale: 1 | 1000 | 1000000 };

export interface PaperInput {
  title?: string;
  decisionTypeKey?: string | null;
  issue?: string | null;
  whyNow?: string | null;
  alternatives?: { title: string; summary?: string }[];
  recommendation?: string | null;
  impacts?: { financial?: string; operational?: string; schedule?: string };
  amount?: Money | null;
  risks?: string | null;
  dependencies?: string | null;
  latestSafeDate?: string | null;
  requiredAuthority?: string | null;
  classification?: Classification;
  gateKey?: string | null;
}

/** Decision states after which the paper is closed for recusals and votes. */
const CLOSED_STATES: DecisionStatus[] = ['approved', 'rejected', 'superseded', 'implementation_pending', 'implemented_verified', 'recommended'];
const DECIDED_STATES: DecisionStatus[] = ['approved', 'implementation_pending', 'implemented_verified'];

/** Decision papers and their lifecycle (spec §4.2; AT-04, AT-05, AT-16). Every state change is an explicit command. */
@Injectable()
export class DecisionsService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly versions: RecordVersionService,
    private readonly sup: GovernanceSupport,
    private readonly meetings: MeetingsService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------
  // Reads

  async list(
    ctx: RequestContext,
    projectId: string,
    q: {
      page: number;
      pageSize: number;
      q?: string;
      committeeId?: string;
      meetingId?: string;
      status?: DecisionStatus;
      authorityOutcome?: AuthorityOutcome;
      sort?: RouteInput<typeof governanceRoutes.listDecisions>['query']['sort'];
    },
  ) {
    const d = schema.decision;
    const where = and(
      eq(d.projectId, projectId),
      this.policy.visibilitySql(ctx, projectId, { classification: d.classification }),
      q.committeeId ? eq(d.committeeId, q.committeeId) : undefined,
      q.meetingId ? eq(d.meetingId, q.meetingId) : undefined,
      q.status ? eq(d.status, q.status) : undefined,
      q.authorityOutcome ? eq(d.authorityOutcome, q.authorityOutcome) : undefined,
      q.q ? or(ilike(d.title, likeContains(q.q)), ilike(d.code, likeContains(q.q))) : undefined,
    );
    const tx = this.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(d).where(where)) as [{ total: number }];
    const order = orderBySort(
      q.sort,
      { code: d.code, title: d.title, status: d.status, latestSafeDate: d.latestSafeDate, createdAt: d.createdAt, updatedAt: d.updatedAt },
      d.id,
      [desc(d.createdAt), desc(d.id)],
    );
    const rows = await tx.select().from(d).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    const names = await this.sup.displayNames(rows.map((r) => r.requesterUserId));
    return pageOf(
      rows.map((r) => this.summaryDto(r, names)),
      Number(total),
      q,
    );
  }

  async get(ctx: RequestContext, projectId: string, decisionId: string) {
    const d = await this.sup.decision(ctx, projectId, decisionId);
    const recusals = await this.db.tx().select().from(schema.recusal).where(eq(schema.recusal.decisionId, d.id)).orderBy(asc(schema.recusal.declaredAt));
    const names = await this.sup.displayNames([d.requesterUserId, ...recusals.map((r) => r.userId)]);
    return {
      ...this.summaryDto(d, names),
      issue: d.issue,
      whyNow: d.whyNow,
      alternatives: d.alternatives,
      recommendation: d.recommendation,
      impacts: d.impacts,
      amount: amountOf(d),
      risks: d.risks,
      dependencies: d.dependencies,
      requiredAuthority: d.requiredAuthority,
      gateKey: d.gateKey,
      authorityReason: d.authorityReason,
      recommendationRecordedBy: d.recommendationRecordedBy,
      externalAuthorityReference: d.externalAuthorityReference,
      decidedViaCirculation: d.decidedViaCirculation,
      outcomeRecordedAt: iso(d.outcomeRecordedAt),
      outcomeRecordedBy: d.outcomeRecordedBy,
      tallySnapshot: d.tallySnapshot ?? null,
      supersededByDecisionId: d.supersededByDecisionId,
      implementationStartedBy: d.implementationStartedBy,
      implementationStartedAt: iso(d.implementationStartedAt),
      implementationEvidenceNote: d.implementationEvidenceNote,
      implementationVerifiedBy: d.implementationVerifiedBy,
      implementationVerifiedAt: iso(d.implementationVerifiedAt),
      missingFields: d.status === 'draft' ? missingDecisionPaperFields(d) : [],
      recusals: recusals.map((r) => ({ userId: r.userId, displayName: names.get(r.userId) ?? null, reason: r.reason, declaredAt: r.declaredAt.toISOString() })),
      allowedCommands: allowedCommands(DECISION_MACHINE, d.status as DecisionStatus),
    };
  }

  async listVotes(ctx: RequestContext, projectId: string, decisionId: string) {
    const d = await this.sup.decision(ctx, projectId, decisionId);
    const rows = await this.db.tx().select().from(schema.vote).where(eq(schema.vote.decisionId, d.id)).orderBy(asc(schema.vote.round), asc(schema.vote.castAt));
    const names = await this.sup.displayNames(rows.map((v) => v.userId));
    return {
      items: rows.map((v) => ({
        id: v.id,
        userId: v.userId,
        displayName: names.get(v.userId) ?? null,
        membershipId: v.membershipId,
        meetingId: v.meetingId,
        round: v.round,
        memberRoleAtVote: v.memberRoleAtVote,
        choice: v.choice,
        comment: v.comment,
        viaCirculation: v.viaCirculation,
        authorityMatrixVersionId: v.authorityMatrixVersionId,
        castAt: v.castAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Paper

  async create(ctx: RequestContext, projectId: string, body: PaperInput & { committeeId: string; title: string }) {
    const c = await this.sup.committee(ctx, projectId, body.committeeId, 'governance.decision.draft');
    if (c.status === 'dissolved') throw ruleViolation('governance.committee.dissolved', 'The committee is dissolved');
    const classification = body.classification ?? c.classification;
    this.assertClassifiable(ctx, classification);
    const p = await this.sup.project(projectId);
    const id = newId();
    const code = await nextCode(this.db, schema.decision, projectId, 'DEC');
    const values = {
      id,
      orgId: ctx.principal.orgId,
      projectId,
      committeeId: c.id,
      code,
      title: body.title,
      ...this.paperValues(body),
      classification,
      // The requester is always the authenticated drafter (never client-supplied): self-approval checks rely on it.
      requesterUserId: ctx.principal.userId,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    };
    await this.db.tx().insert(schema.decision).values(values as typeof schema.decision.$inferInsert);
    await this.versions.snapshot({ projectId, entityType: 'decision', entityId: id, versionNo: 1, snapshot: this.paperSnapshot({ ...values, version: 1 }), reason: 'draft' });
    await this.audit.record({ action: 'governance.decision.draft', entityType: 'decision', entityId: id, projectId, after: { code, title: body.title, committeeId: c.id, decisionTypeKey: body.decisionTypeKey ?? null } });
    return { id, code, version: 1 };
  }

  async update(ctx: RequestContext, projectId: string, decisionId: string, body: PaperInput & { expectedVersion: number }) {
    const d = await this.sup.decision(ctx, projectId, decisionId, 'governance.decision.draft');
    if (d.status !== 'draft') throw ruleViolation('governance.decision.not_draft', `Only a draft paper can be edited (current: ${d.status}); ask the secretariat to return it`);
    if (body.classification) this.assertClassifiable(ctx, body.classification);
    const values: Record<string, unknown> = this.paperValues(body);
    if (body.title !== undefined) values['title'] = body.title;
    if (body.classification !== undefined) values['classification'] = body.classification;
    const row = (await updateVersioned(this.db, schema.decision, { id: d.id, projectId, expectedVersion: body.expectedVersion }, values)) as unknown as DecisionRow;
    await this.versions.snapshot({ projectId, entityType: 'decision', entityId: d.id, versionNo: row.version, snapshot: this.paperSnapshot(row), reason: 'draft edit' });
    await this.audit.record({ action: 'governance.decision.update', entityType: 'decision', entityId: d.id, projectId, before: pick(d, Object.keys(values)), after: values });
    return { id: d.id, version: row.version };
  }

  async submit(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; note?: string }) {
    const d = await this.sup.decision(ctx, projectId, decisionId, 'governance.decision.submit');
    assertVersion(d, body.expectedVersion, 'decision');
    const to = transition('decision', DECISION_MACHINE, d.status as DecisionStatus, 'submit');
    const missing = missingDecisionPaperFields(d);
    if (missing.length) throw ruleViolation('governance.decision.incomplete_paper', `The decision paper is incomplete: ${missing.join(', ')}`, { missing });
    return this.applyTransition(ctx, d, 'submit', to, body.expectedVersion, {}, body.note);
  }

  async startReview(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; meetingId?: string; note?: string }) {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    this.policy.assert(ctx, 'governance.decision.review', { projectId, classification: d.classification, requesterUserId: d.requesterUserId });
    assertVersion(d, body.expectedVersion, 'decision');
    const to = transition('decision', DECISION_MACHINE, d.status as DecisionStatus, 'start_review');
    const extra: Record<string, unknown> = {};
    if (body.meetingId) extra['meetingId'] = (await this.tableableMeeting(projectId, d, body.meetingId)).id;
    const r = await this.applyTransition(ctx, d, 'start_review', to, body.expectedVersion, extra, body.note);
    await this.emitVotePending(d, (extra['meetingId'] as string | undefined) ?? d.meetingId);
    return r;
  }

  async returnToDraft(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; note: string }) {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    this.policy.assert(ctx, 'governance.decision.review', { projectId, classification: d.classification, requesterUserId: d.requesterUserId });
    assertVersion(d, body.expectedVersion, 'decision');
    const to = transition('decision', DECISION_MACHINE, d.status as DecisionStatus, 'return_to_draft');
    // A paper that may change must not keep votes cast on the previous version (frozen paper rule): new round.
    const extra = d.status === 'under_review' ? { voteRound: d.voteRound + 1 } : {};
    return this.applyTransition(ctx, d, 'return_to_draft', to, body.expectedVersion, extra, body.note);
  }

  async declareRecusal(ctx: RequestContext, projectId: string, decisionId: string, body: { userId?: string; reason: string }) {
    const d = await this.sup.decision(ctx, projectId, decisionId);
    const self = ctx.principal.userId!;
    const target = body.userId ?? self;
    if (target === self) this.policy.assert(ctx, 'governance.conflict.declare', { projectId, classification: d.classification });
    else this.policy.assert(ctx, 'governance.meeting.manage', { projectId, classification: d.classification });
    if (CLOSED_STATES.includes(d.status as DecisionStatus)) throw ruleViolation('governance.recusal.decision_closed', `Recusals are closed for a ${d.status} decision`);
    const recorded = await this.sup.insertRecusal(ctx, d, target, body.reason, d.meetingId);
    if (!recorded) throw conflict('governance.recusal.duplicate', 'This member is already recused from the decision');
    await this.db
      .tx()
      .insert(schema.conflictDeclaration)
      .values({ id: newId(), orgId: ctx.principal.orgId, projectId, committeeId: d.committeeId, meetingId: d.meetingId, decisionId: d.id, userId: target, declaration: 'recused', description: body.reason, recordedBy: self });
    await this.audit.record({ action: 'governance.decision.recusal', entityType: 'decision', entityId: d.id, projectId, after: { userId: target, recordedBy: self }, reason: body.reason });
    return { ok: true as const };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Voting & circulation

  async castVote(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; choice: VoteChoice; comment?: string }) {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    // RBAC + classification + separation of duties (the requester may not vote on their own decision).
    this.policy.assert(ctx, 'governance.decision.vote', { projectId, classification: d.classification, requesterUserId: d.requesterUserId });
    assertVersion(d, body.expectedVersion, 'decision paper');
    if (d.status !== 'under_review') throw ruleViolation('governance.vote.not_open', `Votes are only accepted while the decision is under review (current: ${d.status})`);
    if (!d.meetingId) throw ruleViolation('governance.vote.not_tabled', 'The decision is not tabled at a meeting or circulated');
    const m = await loadInProject(this.db, schema.meeting, projectId, d.meetingId);
    if (m.status !== 'in_session') throw ruleViolation('governance.vote.session_not_open', `Voting is open only during the session / circulation (meeting status: ${m.status})`);
    const p = await this.sup.project(projectId);
    const onDate = this.sup.localDateOf(m.scheduledAt, p);
    if (m.isCirculation && m.responseDeadline && this.sup.today(p) > m.responseDeadline) {
      throw ruleViolation('governance.circulation.deadline_passed', `The circulation response deadline (${m.responseDeadline}) has passed`);
    }
    const mx = this.sup.requireUsable(await this.sup.matrixInForce(d.committeeId, onDate, p));
    const members = this.sup.memberSnapshots(await this.sup.memberships(d.committeeId));
    const recused = await this.sup.recusedUserIds(d.id);
    const voter = ctx.principal.userId!;
    const member = assertMayVote({ voterUserId: voter, members, recusedUserIds: recused, requesterUserId: d.requesterUserId, onDate, policy: mx.policy });
    // The vote must reference the voter's own seat on the decision's committee (also enforced by a DB trigger).
    if (member.userId !== voter || !members.some((x) => x.membershipId === member.membershipId)) {
      throw ruleViolation('governance.vote.membership_mismatch', "The vote must be cast on the voter's own seat of the decision's committee");
    }
    if (!m.isCirculation) {
      const present = presentUserIds(await this.sup.attendance(m.id));
      if (!present.includes(voter)) throw ruleViolation('governance.vote.not_present', 'Only members recorded present (in person or remote) may vote in a meeting');
      const q = computeQuorum({ members, presentUserIds: present, recusedUserIds: recused, onDate, policy: mx.policy, requesterUserId: d.requesterUserId });
      if (!q.met) throw ruleViolation('governance.vote.no_quorum', q.explanation, { quorum: q });
    }
    const [dup] = await this.db
      .tx()
      .select({ id: schema.vote.id })
      .from(schema.vote)
      .where(and(eq(schema.vote.decisionId, d.id), eq(schema.vote.userId, voter), eq(schema.vote.round, d.voteRound)));
    if (dup) throw conflict('governance.vote.duplicate', 'You already voted in this round; votes cannot be changed');
    const id = newId();
    await this.db
      .tx()
      .insert(schema.vote)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        decisionId: d.id,
        meetingId: m.id,
        userId: voter,
        membershipId: member.membershipId,
        round: d.voteRound,
        memberRoleAtVote: member.role,
        choice: body.choice,
        comment: body.comment ?? null,
        viaCirculation: m.isCirculation,
        authorityMatrixVersionId: mx.row.id,
      });
    await this.audit.record({
      action: 'governance.decision.vote',
      entityType: 'decision',
      entityId: d.id,
      projectId,
      after: { voteId: id, choice: body.choice, round: d.voteRound, viaCirculation: m.isCirculation, matrixVersionId: mx.row.id },
    });
    return { id, round: d.voteRound };
  }

  async initiateCirculation(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; responseDeadline: string; note?: string }) {
    const d = await this.sup.decision(ctx, projectId, decisionId, 'governance.circulation.initiate');
    assertVersion(d, body.expectedVersion, 'decision paper');
    if (d.status !== 'under_review') throw ruleViolation('governance.circulation.not_under_review', `Only a decision under review can be circulated (current: ${d.status})`);
    const c = await loadInProject(this.db, schema.committee, projectId, d.committeeId);
    if (c.status !== 'active') throw ruleViolation('governance.committee.not_active', 'The committee is not active');
    const p = await this.sup.project(projectId);
    const today = this.sup.today(p);
    if (body.responseDeadline < today) throw ruleViolation('governance.circulation.deadline_past', 'The response deadline is in the past');
    if (d.meetingId) {
      const cur = await loadInProject(this.db, schema.meeting, projectId, d.meetingId);
      if (cur.isCirculation && cur.status === 'in_session') throw ruleViolation('governance.circulation.already_open', 'A circulation is already open for this decision');
    }
    const mx = this.sup.requireUsable(await this.sup.matrixInForce(c.id, today, p));
    const number = await this.meetings.nextNumber(c.id);
    const meetingId = newId();
    const tx = this.db.tx();
    await tx.insert(schema.meeting).values({
      id: meetingId,
      orgId: ctx.principal.orgId,
      projectId,
      committeeId: c.id,
      number,
      title: `Resolution by circulation — ${d.code}: ${d.title}`,
      scheduledAt: new Date(),
      status: 'in_session',
      isCirculation: true,
      responseDeadline: body.responseDeadline,
      authorityMatrixVersionId: mx.row.id,
      isDemo: p.isDemo,
      createdBy: ctx.principal.userId,
    });
    const row = (await updateVersioned(this.db, schema.decision, { id: d.id, projectId, expectedVersion: body.expectedVersion }, { meetingId })) as unknown as DecisionRow;
    // Frozen circulation packet (the paper version members respond to).
    const [circ] = await tx.select().from(schema.meeting).where(eq(schema.meeting.id, meetingId));
    const pack = await this.meetings.writePack(ctx, projectId, c, circ!, body.note);
    await tx.update(schema.meeting).set({ packSnapshotId: pack.id }).where(and(eq(schema.meeting.id, meetingId), eq(schema.meeting.projectId, projectId)));
    await this.audit.record({
      action: 'governance.circulation.initiate',
      entityType: 'decision',
      entityId: d.id,
      projectId,
      after: { circulationMeetingId: meetingId, number, responseDeadline: body.responseDeadline, packSnapshotId: pack.id },
      reason: body.note ?? null,
    });
    await this.audit.record({ action: 'governance.meeting.create', entityType: 'meeting', entityId: meetingId, projectId, after: { committeeId: c.id, number, isCirculation: true, decisionId: d.id } });
    await this.emitVotePending(d, meetingId);
    return { meetingId, number, packSnapshotId: pack.id, version: row.version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Outcome (AT-04 / AT-05): server-computed quorum, tally and authority

  async recordOutcome(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; note?: string }) {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    this.policy.assert(ctx, 'governance.decision.record_outcome', { projectId, classification: d.classification, requesterUserId: d.requesterUserId });
    assertVersion(d, body.expectedVersion, 'decision');
    if (d.status !== 'under_review') throw ruleViolation('governance.outcome.not_under_review', `An outcome can only be recorded for a decision under review (current: ${d.status})`);
    if (!d.meetingId) throw ruleViolation('governance.vote.not_tabled', 'The decision is not tabled at a meeting or circulated');
    const m = await loadInProject(this.db, schema.meeting, projectId, d.meetingId);
    const allowedMeeting = m.isCirculation ? ['in_session'] : ['in_session', 'held', 'minutes_draft'];
    if (!allowedMeeting.includes(m.status)) throw ruleViolation('governance.outcome.meeting_state', `Cannot record an outcome for a meeting in status ${m.status}`);
    const p = await this.sup.project(projectId);
    const onDate = this.sup.localDateOf(m.scheduledAt, p);
    const mx = this.sup.requireUsable(await this.sup.matrixInForce(d.committeeId, onDate, p));
    const tx = this.db.tx();
    const votes = await tx.select().from(schema.vote).where(and(eq(schema.vote.decisionId, d.id), eq(schema.vote.round, d.voteRound)));
    assertVotesUnderMatrix(votes, mx.row.id);
    const members = this.sup.memberSnapshots(await this.sup.memberships(d.committeeId));
    const recused = await this.sup.recusedUserIds(d.id);
    const present = m.isCirculation ? circulationResponders(votes, d.voteRound) : presentUserIds(await this.sup.attendance(m.id));
    const quorum = computeQuorum({ members, presentUserIds: present, recusedUserIds: recused, onDate, policy: mx.policy, requesterUserId: d.requesterUserId });
    // Votes of members recused after voting are disregarded (vote rows themselves stay immutable).
    const counted = votes.filter((v) => !recused.includes(v.userId) && v.userId !== d.requesterUserId);
    const tally = tallyVotes({ votes: counted.map((v) => ({ userId: v.userId, choice: v.choice })), chairUserId: this.sup.chairOn(members, onDate), quorumMet: quorum.met, policy: mx.policy });
    const amount = amountOf(d);
    const authority = checkAuthority({ policy: mx.policy, decisionTypeKey: d.decisionTypeKey ?? '', amount });
    const plan = planDecisionOutcome({ tally, authority, quorum });
    const snapshot = {
      round: d.voteRound,
      onDate,
      viaCirculation: m.isCirculation,
      meetingId: m.id,
      matrixVersionId: mx.row.id,
      isDemoPolicy: mx.row.isDemoPolicy,
      quorum,
      tally,
      authority,
      disregardedVotes: votes.length - counted.length,
      recordedAt: new Date().toISOString(),
      recordedBy: ctx.principal.userId,
    };
    const recorder = ctx.principal.userId!;
    let to = d.status as DecisionStatus;
    const values: Record<string, unknown> = { tallySnapshot: snapshot };
    if (plan.command) {
      if (plan.command === 'record_approval') {
        assertApprovalAllowed({ from: 'under_review', authorityOutcome: 'within_mandate', matrix: mx.state, projectIsDemo: p.isDemo, onDate, recorderUserId: recorder });
      }
      to = transition('decision', DECISION_MACHINE, d.status as DecisionStatus, plan.command);
      Object.assign(values, {
        status: to,
        authorityOutcome: plan.authorityOutcome,
        authorityReason: authority.reason,
        escalatedTo: plan.command === 'record_recommendation' ? plan.escalateTo : null,
        outcomeRecordedAt: new Date(),
        outcomeRecordedBy: recorder,
        decidedViaCirculation: m.isCirculation,
        recommendationRecordedBy: plan.command === 'record_recommendation' ? recorder : d.recommendationRecordedBy,
      });
    }
    const row = (await updateVersioned(this.db, schema.decision, { id: d.id, projectId, expectedVersion: body.expectedVersion }, values)) as unknown as DecisionRow;
    let escalationId: string | null = null;
    if (plan.escalate) {
      escalationId = await this.systemEscalation(ctx, row, {
        title: plan.command === 'record_recommendation' ? `Recommendation pending external authority — ${d.code}: ${d.title}` : `Tied vote — ${d.code}: ${d.title}`,
        requestedAction:
          plan.command === 'record_recommendation'
            ? `Decide on the committee recommendation ${d.code}. ${authority.reason}`
            : `Resolve the tied committee vote on ${d.code} per the authority matrix tie rule (escalate).`,
        target: plan.escalateTo,
      });
    }
    if (m.isCirculation && plan.command) {
      await tx.update(schema.meeting).set({ status: 'held', updatedAt: new Date() }).where(and(eq(schema.meeting.id, m.id), eq(schema.meeting.projectId, projectId)));
      await this.audit.record({ action: 'governance.circulation.close', entityType: 'meeting', entityId: m.id, projectId, before: { status: m.status }, after: { status: 'held', responders: present.length } });
    }
    await this.audit.record({
      action: 'governance.decision.record_outcome',
      entityType: 'decision',
      entityId: d.id,
      projectId,
      before: { status: d.status },
      after: { status: to, outcome: tally.outcome, approve: tally.approve, reject: tally.reject, abstain: tally.abstain, quorumMet: quorum.met, authorityOutcome: plan.authorityOutcome, escalatedTo: plan.escalateTo, escalationId },
      reason: body.note ?? null,
    });
    if (to !== d.status) {
      await this.emitStatus(row, d.status, to);
      if (to === 'recommended') {
        await this.outbox.emit({
          type: 'approval.pending',
          projectId,
          aggregateType: 'decision',
          aggregateId: d.id,
          payload: { subjectType: 'decision', subjectId: d.id, requiredPermission: 'governance.decision.record_external_approval', escalateTo: plan.escalateTo },
        });
      }
    }
    return {
      status: to,
      outcome: tally.outcome as 'approve' | 'reject' | 'tie_escalate',
      authorityOutcome: (values['authorityOutcome'] as AuthorityOutcome | undefined) ?? (d.authorityOutcome as AuthorityOutcome),
      escalatedTo: plan.escalateTo,
      escalationId,
      explanation: plan.explanation,
      version: row.version,
    };
  }

  async recordExternalApproval(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; externalReference?: string; outcome: 'approved' | 'rejected'; note?: string }) {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    this.policy.assert(ctx, 'governance.decision.record_external_approval', { projectId, classification: d.classification, requesterUserId: d.requesterUserId });
    const p = await this.sup.project(projectId);
    const command: DecisionCommand = body.outcome === 'approved' ? 'record_approval' : 'record_rejection';
    assertVersion(d, body.expectedVersion, 'decision');
    if (d.status !== 'recommended') throw ruleViolation('governance.external.not_recommended', `Only a recommendation pending external authority can receive an external decision (current: ${d.status})`);
    const to = transition('decision', DECISION_MACHINE, d.status as DecisionStatus, command);
    // Same guards for approval and rejection: evidence reference + a different recorder than the recommendation's.
    assertApprovalAllowed({
      from: 'recommended',
      authorityOutcome: d.authorityOutcome as AuthorityOutcome,
      matrix: null,
      projectIsDemo: p.isDemo,
      onDate: this.sup.today(p),
      externalReference: body.externalReference ?? null,
      recorderUserId: ctx.principal.userId!,
      recommendationRecordedBy: d.recommendationRecordedBy,
    });
    const r = await this.applyTransition(ctx, d, command, to, body.expectedVersion, { externalAuthorityReference: body.externalReference!.trim() }, body.note, {
      externalReference: body.externalReference,
      externalOutcome: body.outcome,
    });
    // Close the escalation(s) that routed the recommendation to the external authority.
    const open = await this.db
      .tx()
      .select()
      .from(schema.escalation)
      .where(and(eq(schema.escalation.projectId, projectId), eq(schema.escalation.sourceType, 'decision'), eq(schema.escalation.sourceId, d.id), inArray(schema.escalation.status, ['open', 'decision_requested'])));
    for (const e of open) {
      await updateVersioned(this.db, schema.escalation, { id: e.id, projectId, expectedVersion: e.version }, {
        status: 'resolved',
        resolutionDecisionId: d.id,
        resolutionNote: `External authority ${body.outcome} (${body.externalReference!.trim()})`,
        resolvedBy: ctx.principal.userId,
        resolvedAt: new Date(),
      });
      await this.audit.record({ action: 'governance.escalation.resolve', entityType: 'escalation', entityId: e.id, projectId, before: { status: e.status }, after: { status: 'resolved', resolutionDecisionId: d.id } });
    }
    return { id: d.id, status: to, version: r.version };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Defer / resume / supersede

  async defer(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; note: string; revisitDate?: string }) {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    this.policy.assert(ctx, 'governance.decision.record_outcome', { projectId, classification: d.classification, requesterUserId: d.requesterUserId });
    assertVersion(d, body.expectedVersion, 'decision');
    const to = transition('decision', DECISION_MACHINE, d.status as DecisionStatus, 'defer');
    return this.applyTransition(ctx, d, 'defer', to, body.expectedVersion, {}, body.note, { revisitDate: body.revisitDate ?? null });
  }

  async resume(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; meetingId?: string; note?: string }) {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    this.policy.assert(ctx, 'governance.decision.review', { projectId, classification: d.classification, requesterUserId: d.requesterUserId });
    assertVersion(d, body.expectedVersion, 'decision');
    const to = transition('decision', DECISION_MACHINE, d.status as DecisionStatus, 'resume');
    const meetingId = body.meetingId ? (await this.tableableMeeting(projectId, d, body.meetingId)).id : null;
    const voteRound = d.voteRound + 1;
    const r = await this.applyTransition(ctx, d, 'resume', to, body.expectedVersion, { voteRound, meetingId }, body.note);
    await this.emitVotePending(d, meetingId);
    return { id: d.id, version: r.version, voteRound };
  }

  async supersede(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; supersededByDecisionId: string; note: string }) {
    const d = await this.sup.decision(ctx, projectId, decisionId, 'governance.decision.record_outcome');
    assertVersion(d, body.expectedVersion, 'decision');
    const to = transition('decision', DECISION_MACHINE, d.status as DecisionStatus, 'supersede');
    const other = await this.sup.decision(ctx, projectId, body.supersededByDecisionId);
    if (other.id === d.id) throw ruleViolation('governance.decision.supersede_self', 'A decision cannot supersede itself');
    if (!DECIDED_STATES.includes(other.status as DecisionStatus)) {
      throw ruleViolation('governance.decision.superseding_not_approved', `The superseding decision ${other.code} must be approved (current: ${other.status})`);
    }
    return this.applyTransition(ctx, d, 'supersede', to, body.expectedVersion, { supersededByDecisionId: other.id }, body.note, { supersededBy: other.code });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Implementation tracking (approval ≠ implementation)

  async startImplementation(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; note?: string }) {
    const d = await this.sup.decision(ctx, projectId, decisionId, 'governance.action.manage');
    assertVersion(d, body.expectedVersion, 'decision');
    const to = transition('decision', DECISION_MACHINE, d.status as DecisionStatus, 'start_implementation');
    assertImplementationStartable(await this.linkedActions(d));
    return this.applyTransition(ctx, d, 'start_implementation', to, body.expectedVersion, { implementationStartedBy: ctx.principal.userId, implementationStartedAt: new Date() }, body.note);
  }

  async verifyImplementation(ctx: RequestContext, projectId: string, decisionId: string, body: { expectedVersion: number; evidenceNote?: string }) {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    this.policy.assert(ctx, 'governance.decision.verify_implementation', { projectId, classification: d.classification, requesterUserId: d.implementationStartedBy });
    assertVersion(d, body.expectedVersion, 'decision');
    const to = transition('decision', DECISION_MACHINE, d.status as DecisionStatus, 'verify_implementation');
    assertImplementationVerifiable({ actions: await this.linkedActions(d), verifierUserId: ctx.principal.userId!, evidenceNote: body.evidenceNote });
    return this.applyTransition(
      ctx,
      d,
      'verify_implementation',
      to,
      body.expectedVersion,
      { implementationEvidenceNote: body.evidenceNote!.trim(), implementationVerifiedBy: ctx.principal.userId, implementationVerifiedAt: new Date() },
      body.evidenceNote,
    );
  }

  // ---------------------------------------------------------------------------------------------------------
  // Helpers

  private async applyTransition(
    ctx: RequestContext,
    d: DecisionRow,
    command: DecisionCommand,
    to: DecisionStatus,
    expectedVersion: number,
    extra: Record<string, unknown>,
    note?: string | null,
    auditExtra: Record<string, unknown> = {},
  ) {
    const row = (await updateVersioned(this.db, schema.decision, { id: d.id, projectId: d.projectId, expectedVersion }, { status: to, ...extra })) as unknown as DecisionRow;
    await this.audit.record({
      action: `governance.decision.${command}`,
      entityType: 'decision',
      entityId: d.id,
      projectId: d.projectId,
      before: { status: d.status, version: d.version },
      after: { status: to, version: row.version, ...pick(extra as Record<string, unknown>, Object.keys(extra).filter((k) => !k.endsWith('At'))), ...auditExtra },
      reason: note ?? null,
    });
    if (to !== d.status) await this.emitStatus(row, d.status as DecisionStatus, to);
    return { id: d.id, version: row.version };
  }

  private async emitStatus(d: DecisionRow, from: string, to: string) {
    await this.outbox.emit({ type: 'decision.status_changed', projectId: d.projectId, aggregateType: 'decision', aggregateId: d.id, payload: { decisionId: d.id, code: d.code, from, to, gateKey: d.gateKey } });
  }

  private async emitVotePending(d: DecisionRow, meetingId: string | null) {
    await this.outbox.emit({
      type: 'approval.pending',
      projectId: d.projectId,
      aggregateType: 'decision',
      aggregateId: d.id,
      payload: { subjectType: 'decision', subjectId: d.id, requiredPermission: 'governance.decision.vote', committeeId: d.committeeId, meetingId },
    });
  }

  private async tableableMeeting(projectId: string, d: DecisionRow, meetingId: string): Promise<MeetingRow> {
    const m = await loadInProject(this.db, schema.meeting, projectId, meetingId);
    if (m.committeeId !== d.committeeId) throw ruleViolation('governance.meeting.other_committee', 'The meeting belongs to another committee');
    if (m.isCirculation) throw ruleViolation('governance.meeting.is_circulation', 'Use the circulation command to circulate a decision');
    if (!['planned', 'agenda_published', 'in_session'].includes(m.status)) throw ruleViolation('governance.meeting.closed', `Meeting #${m.number} is ${m.status}`);
    return m;
  }

  private async linkedActions(d: DecisionRow) {
    return this.db
      .tx()
      .select({ status: schema.actionItem.status, ownerUserId: schema.actionItem.ownerUserId, dueDate: schema.actionItem.dueDate })
      .from(schema.actionItem)
      .where(and(eq(schema.actionItem.projectId, d.projectId), eq(schema.actionItem.decisionId, d.id)));
  }

  private async systemEscalation(ctx: RequestContext, d: DecisionRow, e: { title: string; requestedAction: string; target: string | null }): Promise<string> {
    const [existing] = await this.db
      .tx()
      .select({ id: schema.escalation.id })
      .from(schema.escalation)
      .where(and(eq(schema.escalation.projectId, d.projectId), eq(schema.escalation.sourceType, 'decision'), eq(schema.escalation.sourceId, d.id), inArray(schema.escalation.status, ['open', 'decision_requested'])));
    if (existing) return existing.id;
    const id = newId();
    const code = await nextCode(this.db, schema.escalation, d.projectId, 'ESC');
    await this.db
      .tx()
      .insert(schema.escalation)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId: d.projectId,
        code,
        title: e.title,
        sourceType: 'decision',
        sourceId: d.id,
        requestedAction: e.requestedAction,
        decisionDeadline: d.latestSafeDate,
        options: [
          { title: 'Approve the committee recommendation', impact: 'The decision becomes approved; dependent gates may proceed.' },
          { title: 'Reject the recommendation', impact: 'The decision is rejected; the matter returns to the committee.' },
          { title: 'Defer / request more information', impact: 'Dependent gates stay blocked until decided.' },
        ],
        target: e.target,
        status: 'decision_requested',
        raisedBy: ctx.principal.userId,
        isSystemGenerated: true,
        isDemo: d.isDemo,
      });
    await this.audit.record({ action: 'governance.escalation.raise', entityType: 'escalation', entityId: id, projectId: d.projectId, after: { code, sourceType: 'decision', sourceId: d.id, target: e.target, systemGenerated: true } });
    return id;
  }

  private assertClassifiable(ctx: RequestContext, c: Classification) {
    if (!clearanceAllows(ctx.principal.clearance, c)) throw ruleViolation('governance.decision.classification_above_clearance', 'You cannot classify a paper above your own clearance');
  }

  private paperValues(b: PaperInput): Record<string, unknown> {
    const v: Record<string, unknown> = {};
    if (b.decisionTypeKey !== undefined) v['decisionTypeKey'] = b.decisionTypeKey;
    if (b.issue !== undefined) v['issue'] = b.issue;
    if (b.whyNow !== undefined) v['whyNow'] = b.whyNow;
    if (b.alternatives !== undefined) v['alternatives'] = b.alternatives.map((a) => (a.summary ? { title: a.title, summary: a.summary } : { title: a.title }));
    if (b.recommendation !== undefined) v['recommendation'] = b.recommendation;
    if (b.impacts !== undefined) {
      const i: { financial?: string; operational?: string; schedule?: string } = {};
      if (b.impacts.financial) i.financial = b.impacts.financial;
      if (b.impacts.operational) i.operational = b.impacts.operational;
      if (b.impacts.schedule) i.schedule = b.impacts.schedule;
      v['impacts'] = i;
    }
    if (b.amount !== undefined) {
      v['amountAmount'] = b.amount?.amount ?? null;
      v['amountCurrency'] = b.amount?.currency ?? null;
      v['amountUnitScale'] = b.amount?.unitScale ?? null;
    }
    if (b.risks !== undefined) v['risks'] = b.risks;
    if (b.dependencies !== undefined) v['dependencies'] = b.dependencies;
    if (b.latestSafeDate !== undefined) v['latestSafeDate'] = b.latestSafeDate;
    if (b.requiredAuthority !== undefined) v['requiredAuthority'] = b.requiredAuthority;
    if (b.gateKey !== undefined) v['gateKey'] = b.gateKey;
    return v;
  }

  private paperSnapshot(d: Record<string, unknown>) {
    const keys = ['code', 'title', 'decisionTypeKey', 'issue', 'whyNow', 'alternatives', 'recommendation', 'impacts', 'amountAmount', 'amountCurrency', 'amountUnitScale', 'risks', 'dependencies', 'latestSafeDate', 'requiredAuthority', 'requesterUserId', 'classification', 'gateKey', 'version'];
    return pick(d, keys);
  }


  private summaryDto(d: DecisionRow, names: Map<string, string>) {
    return {
      id: d.id,
      code: d.code,
      title: d.title,
      committeeId: d.committeeId,
      status: d.status as (typeof DECISION_STATUSES)[number],
      decisionTypeKey: d.decisionTypeKey,
      requesterUserId: d.requesterUserId,
      requesterName: d.requesterUserId ? (names.get(d.requesterUserId) ?? null) : null,
      latestSafeDate: d.latestSafeDate,
      authorityOutcome: d.authorityOutcome as AuthorityOutcome,
      escalatedTo: d.escalatedTo,
      meetingId: d.meetingId,
      voteRound: d.voteRound,
      classification: d.classification,
      isDemo: d.isDemo,
      version: d.version,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }
}

export function pick(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
}

