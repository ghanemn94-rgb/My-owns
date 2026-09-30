import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  AGENDA_ITEM_KINDS,
  AGENDA_SCREENING_MACHINE,
  AGENDA_SCREENING_STATUSES,
  ATTENDANCE_STATUSES,
  CADENCE_FREQUENCIES,
  Classification,
  INTERNAL_APPROVAL_LABEL_EN,
  INTERNAL_APPROVAL_METHOD,
  MEETING_MACHINE,
  MEETING_STATUSES,
  MeetingCommand,
  assertAgendaMerge,
  assertAttendanceChangeable,
  clearanceAllows,
  CLASSIFICATIONS,
  computeQuorum,
  isMemberActiveOn,
  notFound,
  internalApprovalLabel,
  presentUserIds,
  proposedMeetingSeries,
  ruleViolation,
  screeningReasonRequired,
  transition,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { RecordVersionService, assertVersion, loadInProject, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import type { RouteInput, governanceRoutes } from '@hub/contracts';
import { newId, payloadHash } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';
import { CommitteeRow, GovernanceSupport, MeetingRow, ProjectInfo, amountOf, iso } from './governance.support';
import { likeContains } from '../../platform/helpers';

type MeetingStatus = (typeof MEETING_STATUSES)[number];
type AgendaKind = (typeof AGENDA_ITEM_KINDS)[number];
type ScreeningStatus = (typeof AGENDA_SCREENING_STATUSES)[number];
type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
type CadenceFrequency = (typeof CADENCE_FREQUENCIES)[number];
type ScreeningOutcome = 'accept' | 'return' | 'defer' | 'merge' | 'reject';

const MINUTES_ENTITY = 'meeting_minutes';
/** Decision states whose tabling at a meeting can still change. */
const TABLEABLE = ['draft', 'submitted', 'under_review', 'deferred'] as const;
const maxClassification = (list: Classification[]): Classification => list.reduce((a, b) => (CLASSIFICATIONS.indexOf(b) > CLASSIFICATIONS.indexOf(a) ? b : a));

/** Meetings, circulations, agenda requests, attendance, conflicts, quorum, minutes and frozen packs (spec §4.2). */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly versions: RecordVersionService,
    private readonly sup: GovernanceSupport,
  ) {}

  // ---------------------------------------------------------------------------------------------------------
  // Reads

  async list(
    ctx: RequestContext,
    projectId: string,
    q: { page: number; pageSize: number; q?: string; committeeId?: string; status?: MeetingStatus; isCirculation?: 'true' | 'false'; sort?: RouteInput<typeof governanceRoutes.listMeetings>['query']['sort'] },
  ) {
    const tx = this.db.tx();
    const m = schema.meeting;
    const c = schema.committee;
    const where = and(
      eq(m.projectId, projectId),
      this.policy.visibilitySql(ctx, projectId, { classification: c.classification }),
      // Workstream-only grants do not cover project-level governance records (access-matrix §2.2 strict rule): lists show
      // only what the detail would open (SEC-P2-08 shape, residual of the §2.2 change).
      this.policy.grantSql(ctx, 'governance.meeting.read', projectId, {}),
      q.committeeId ? eq(m.committeeId, q.committeeId) : undefined,
      q.status ? eq(m.status, q.status) : undefined,
      q.isCirculation ? eq(m.isCirculation, q.isCirculation === 'true') : undefined,
      q.q ? ilike(m.title, likeContains(q.q)) : undefined,
    );
    const [{ total }] = (await tx.select({ total: count() }).from(m).innerJoin(c, eq(c.id, m.committeeId)).where(where)) as [{ total: number }];
    const rows = await tx
      .select({ m, committeeName: c.name })
      .from(m)
      .innerJoin(c, eq(c.id, m.committeeId))
      .where(where)
      .orderBy(...orderBySort(q.sort, { number: m.number, title: m.title, scheduledAt: m.scheduledAt, status: m.status }, m.id, [desc(m.scheduledAt), desc(m.number), desc(m.id)]))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    return pageOf(
      rows.map((r) => this.meetingDto(r.m, r.committeeName)),
      Number(total),
      q,
    );
  }

  async get(ctx: RequestContext, projectId: string, meetingId: string) {
    const { meeting: m, committee: c } = await this.sup.meeting(ctx, projectId, meetingId);
    const agenda = await this.agendaRows(ctx, projectId, { meetingId: m.id, acceptedOnly: true });
    const members = await this.sup.memberships(c.id);
    const byMembership = new Map(members.map((x) => [x.id, x]));
    const att = await this.sup.attendance(m.id);
    const conflicts = await this.db.tx().select().from(schema.conflictDeclaration).where(eq(schema.conflictDeclaration.meetingId, m.id)).orderBy(asc(schema.conflictDeclaration.declaredAt));
    const names = await this.sup.displayNames([...att.map((a) => a.userId), ...conflicts.map((x) => x.userId)]);
    return {
      ...this.meetingDto(m, c.name),
      classification: c.classification,
      quorumSnapshot: m.quorumSnapshot ?? null,
      minutesText: m.minutesText,
      minutesDraftedBy: m.minutesDraftedBy,
      minutesApprovedBy: m.minutesApprovedBy,
      // REQ-GOV-027: approved minutes are an internal electronic approval record.
      minutesApproval: m.minutesApprovedBy ? internalApprovalLabel() : null,
      authorityMatrixVersionId: m.authorityMatrixVersionId,
      agenda,
      attendance: att.map((a) => {
        const ms = byMembership.get(a.membershipId)!;
        return {
          membershipId: a.membershipId,
          userId: a.userId,
          displayName: a.userId ? (names.get(a.userId) ?? null) : null,
          roleLabel: ms.roleLabel,
          memberRole: ms.memberRole,
          voting: ms.voting,
          status: a.status,
          recordedAt: a.recordedAt.toISOString(),
        };
      }),
      conflicts: conflicts.map((x) => ({
        id: x.id,
        userId: x.userId,
        displayName: names.get(x.userId) ?? null,
        decisionId: x.decisionId,
        declaration: x.declaration as 'no_conflict' | 'interest_declared' | 'recused',
        description: x.description,
        declaredAt: x.declaredAt.toISOString(),
      })),
    };
  }

  async listAgenda(
    ctx: RequestContext,
    projectId: string,
    q: { page: number; pageSize: number; q?: string; committeeId?: string; meetingId?: string; screeningStatus?: ScreeningStatus; sort?: RouteInput<typeof governanceRoutes.listAgendaRequests>['query']['sort'] },
  ) {
    const a = schema.agendaItem;
    const c = schema.committee;
    const where = and(
      eq(a.projectId, projectId),
      this.policy.visibilitySql(ctx, projectId, { classification: c.classification }),
      this.policy.grantSql(ctx, 'governance.meeting.read', projectId, {}), // §2.2 strict rule (see list above)
      q.committeeId ? eq(a.committeeId, q.committeeId) : undefined,
      q.meetingId ? eq(a.meetingId, q.meetingId) : undefined,
      q.screeningStatus ? eq(a.screeningStatus, q.screeningStatus) : undefined,
      q.q ? ilike(a.title, likeContains(q.q)) : undefined,
    );
    const tx = this.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(a).innerJoin(c, eq(c.id, a.committeeId)).where(where)) as [{ total: number }];
    const rows = await tx
      .select({ a, decisionCode: schema.decision.code, decisionClass: schema.decision.classification })
      .from(a)
      .innerJoin(c, eq(c.id, a.committeeId))
      .leftJoin(schema.decision, eq(schema.decision.id, a.decisionId))
      .where(where)
      .orderBy(...orderBySort(q.sort, { number: a.number, title: a.title, screeningStatus: a.screeningStatus, createdAt: a.createdAt }, a.id, [desc(a.createdAt), desc(a.id)]))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    return pageOf(
      rows.map((r) => this.agendaDto(r.a, this.visibleCode(ctx, r.decisionCode, r.decisionClass))),
      Number(total),
      q,
    );
  }

  private visibleCode(ctx: RequestContext, code: string | null, cls: Classification | null) {
    return code && cls && clearanceAllows(ctx.principal.clearance, cls) ? code : null;
  }

  private async agendaRows(ctx: RequestContext, projectId: string, f: { meetingId: string; acceptedOnly: boolean }) {
    const a = schema.agendaItem;
    const rows = await this.db
      .tx()
      .select({ a, decisionCode: schema.decision.code, decisionClass: schema.decision.classification })
      .from(a)
      .leftJoin(schema.decision, eq(schema.decision.id, a.decisionId))
      .where(and(eq(a.projectId, projectId), eq(a.meetingId, f.meetingId), f.acceptedOnly ? eq(a.screeningStatus, 'accepted') : undefined))
      .orderBy(asc(a.sortOrder), asc(a.createdAt));
    return rows.map((r) => this.agendaDto(r.a, this.visibleCode(ctx, r.decisionCode, r.decisionClass)));
  }

  // ---------------------------------------------------------------------------------------------------------
  // Meeting commands

  async create(ctx: RequestContext, projectId: string, committeeId: string, body: { title: string; scheduledAt: string; location?: string }) {
    const c = await this.sup.committee(ctx, projectId, committeeId, 'governance.meeting.manage');
    if (c.status !== 'active') throw ruleViolation('governance.committee.not_active', `Meetings can only be scheduled for an active committee (current: ${c.status})`);
    const p = await this.sup.project(projectId);
    const number = await this.nextNumber(c.id);
    const id = newId();
    await this.db
      .tx()
      .insert(schema.meeting)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        committeeId: c.id,
        number,
        title: body.title,
        scheduledAt: new Date(body.scheduledAt),
        location: body.location ?? null,
        status: 'planned',
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      });
    await this.audit.record({ action: 'governance.meeting.create', entityType: 'meeting', entityId: id, projectId, after: { committeeId: c.id, number, title: body.title, scheduledAt: body.scheduledAt } });
    return { id, number, version: 1 };
  }

  /**
   * REQ-GOV-009: a series of PROPOSED meetings from the charter's cadence rule and the first meeting given by the
   * secretariat. Nothing is scheduled, published or opened automatically (each meeting stays `proposed` until the explicit
   * `confirm` command). Idempotent: a slot where the committee already has a meeting (any status, a declined one included)
   * is skipped. Generation of one committee is serialized on the committee row.
   */
  async proposeSeries(ctx: RequestContext, projectId: string, committeeId: string, body: { expectedVersion: number; firstMeetingAt: string; count: number; title: string; location?: string }) {
    const c = await this.sup.committee(ctx, projectId, committeeId, 'governance.meeting.manage');
    if (c.status !== 'active') throw ruleViolation('governance.committee.not_active', `Meetings can only be proposed for an active committee (current: ${c.status})`);
    assertVersion(c, body.expectedVersion, 'committee');
    const frequency = c.charter.cadenceRule?.frequency as CadenceFrequency | undefined;
    if (!frequency) {
      throw ruleViolation('governance.cadence.not_configured', 'The committee charter has no cadence rule — set it in the charter (weekly, every two weeks or monthly) before proposing meetings');
    }
    const tx = this.db.tx();
    await tx.execute(sql`select id from committee where id = ${c.id} and project_id = ${projectId} for update`);
    const calendar = await this.sup.calendar(projectId);
    const slots = proposedMeetingSeries({ frequency, firstMeetingAt: new Date(body.firstMeetingAt), count: body.count, calendar });
    const existing = await tx
      .select({ id: schema.meeting.id, scheduledAt: schema.meeting.scheduledAt })
      .from(schema.meeting)
      .where(and(eq(schema.meeting.projectId, projectId), eq(schema.meeting.committeeId, c.id), eq(schema.meeting.isCirculation, false), inArray(schema.meeting.scheduledAt, slots.map((s) => s.scheduledAt))));
    const byInstant = new Map(existing.map((e) => [e.scheduledAt.getTime(), e.id]));
    const p = await this.sup.project(projectId);
    const created: { id: string; number: number; scheduledAt: string; localDate: string; nonWorkingDay: boolean }[] = [];
    const skipped: { scheduledAt: string; localDate: string; existingMeetingId: string }[] = [];
    for (const s of slots) {
      const at = s.scheduledAt.toISOString();
      const other = byInstant.get(s.scheduledAt.getTime());
      if (other) {
        skipped.push({ scheduledAt: at, localDate: s.localDate, existingMeetingId: other });
        continue;
      }
      const number = await this.nextNumber(c.id);
      const id = newId();
      await tx.insert(schema.meeting).values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        committeeId: c.id,
        number,
        title: body.title,
        scheduledAt: s.scheduledAt,
        location: body.location ?? null,
        status: 'proposed',
        cadenceCharterVersionNo: c.charterVersionNo,
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      });
      await this.audit.record({
        action: 'governance.meeting.create',
        entityType: 'meeting',
        entityId: id,
        projectId,
        after: { committeeId: c.id, number, title: body.title, scheduledAt: at, status: 'proposed', origin: 'cadence', frequency, charterVersionNo: c.charterVersionNo, nonWorkingDay: s.nonWorkingDay },
      });
      created.push({ id, number, scheduledAt: at, localDate: s.localDate, nonWorkingDay: s.nonWorkingDay });
    }
    await this.audit.record({
      action: 'governance.meeting.propose_series',
      entityType: 'committee',
      entityId: c.id,
      projectId,
      after: { frequency, charterVersionNo: c.charterVersionNo, firstMeetingAt: new Date(body.firstMeetingAt).toISOString(), count: body.count, created: created.map((x) => x.id), skipped: skipped.length },
    });
    return { frequency, charterVersionNo: c.charterVersionNo, created, skipped };
  }

  async nextNumber(committeeId: string): Promise<number> {
    const [{ n }] = (await this.db
      .tx()
      .select({ n: sql<number>`coalesce(max(${schema.meeting.number}), 0)::int` })
      .from(schema.meeting)
      .where(eq(schema.meeting.committeeId, committeeId))) as [{ n: number }];
    return n + 1;
  }

  async command(ctx: RequestContext, projectId: string, meetingId: string, cmd: Exclude<MeetingCommand, 'draft_minutes' | 'approve_minutes'>, body: { expectedVersion: number; note?: string }) {
    const { meeting: m } = await this.sup.meeting(ctx, projectId, meetingId, 'governance.meeting.manage');
    if (m.isCirculation) throw ruleViolation('governance.meeting.is_circulation', 'Resolutions by circulation are opened and closed through their decision');
    assertVersion(m, body.expectedVersion, 'meeting');
    const to = transition('meeting', MEETING_MACHINE, m.status, cmd);
    if (cmd === 'publish_agenda') {
      const [{ n }] = (await this.db
        .tx()
        .select({ n: count() })
        .from(schema.agendaItem)
        .where(and(eq(schema.agendaItem.meetingId, m.id), eq(schema.agendaItem.screeningStatus, 'accepted')))) as [{ n: number }];
      if (Number(n) === 0) throw ruleViolation('governance.meeting.empty_agenda', 'The agenda has no accepted items');
    }
    const row = await updateVersioned(this.db, schema.meeting, { id: m.id, projectId, expectedVersion: body.expectedVersion }, { status: to });
    await this.audit.record({ action: `governance.meeting.${cmd}`, entityType: 'meeting', entityId: m.id, projectId, before: { status: m.status }, after: { status: to }, reason: body.note ?? null });
    return { id: m.id, version: row['version'] as number };
  }

  /**
   * Attendance (quorum basis). DOM-P2-20: frozen while voting is open on a decision tabled at the meeting (current-round
   * votes, no outcome yet) — quorum and the tally are evaluated on the attendance the votes were cast under; a correction
   * needs the outcome recorded first, or the round restarted (defer → resume).
   */
  async recordAttendance(ctx: RequestContext, projectId: string, meetingId: string, body: { entries: { membershipId: string; status: AttendanceStatus }[] }) {
    const { meeting: m, committee: c } = await this.sup.meeting(ctx, projectId, meetingId, 'governance.meeting.manage');
    if (m.isCirculation) throw ruleViolation('governance.attendance.circulation', 'Circulations have responses, not attendance');
    if (m.status !== 'agenda_published' && m.status !== 'in_session') {
      throw ruleViolation('governance.attendance.closed', `Attendance can be recorded only before or during the session (current: ${m.status})`);
    }
    assertAttendanceChangeable(await this.sup.openVotingAtMeeting(projectId, m.id));
    const p = await this.sup.project(projectId);
    const onDate = this.sup.localDateOf(m.scheduledAt, p);
    const tx = this.db.tx();
    const seen = new Set<string>();
    for (const e of body.entries) {
      if (seen.has(e.membershipId)) throw ruleViolation('governance.attendance.duplicate_entry', 'A membership appears twice in the request');
      seen.add(e.membershipId);
      const ms = await loadInProject(this.db, schema.committeeMembership, projectId, e.membershipId);
      if (ms.committeeId !== c.id) throw ruleViolation('governance.attendance.other_committee', 'The membership belongs to another committee');
      if (!ms.userId) throw ruleViolation('governance.attendance.placeholder', 'A seat whose holder is "Role — To be confirmed" cannot attend');
      if (!isMemberActiveOn({ membershipId: ms.id, userId: ms.userId, role: ms.memberRole, voting: ms.voting, validFrom: ms.validFrom, validTo: ms.validTo }, onDate)) {
        throw ruleViolation('governance.attendance.member_inactive', `The membership is not active on the meeting date ${onDate}`);
      }
      await tx
        .insert(schema.attendance)
        .values({ id: newId(), orgId: ctx.principal.orgId, projectId, meetingId: m.id, membershipId: ms.id, userId: ms.userId, status: e.status, recordedBy: ctx.principal.userId })
        .onConflictDoUpdate({ target: [schema.attendance.meetingId, schema.attendance.membershipId], set: { status: e.status, recordedBy: ctx.principal.userId, recordedAt: new Date() } });
    }
    await this.audit.record({ action: 'governance.meeting.record_attendance', entityType: 'meeting', entityId: m.id, projectId, after: { entries: body.entries } });
    const detail = await this.get(ctx, projectId, meetingId);
    return { items: detail.attendance };
  }

  async declareConflict(
    ctx: RequestContext,
    projectId: string,
    meetingId: string,
    body: { userId?: string; decisionId?: string; declaration: 'no_conflict' | 'interest_declared' | 'recused'; description?: string },
  ) {
    const { meeting: m, committee: c } = await this.sup.meeting(ctx, projectId, meetingId);
    const self = ctx.principal.userId!;
    const target = body.userId ?? self;
    if (target === self) this.policy.assert(ctx, 'governance.conflict.declare', { projectId, classification: c.classification });
    else this.policy.assert(ctx, 'governance.meeting.manage', { projectId, classification: c.classification });
    if (m.status === 'cancelled' || m.status === 'minutes_approved') throw ruleViolation('governance.conflict.meeting_closed', `Declarations are closed for this meeting (${m.status})`);
    const members = await this.sup.memberships(c.id);
    if (!members.some((x) => x.userId === target)) throw ruleViolation('governance.conflict.not_member', 'Declarations are recorded for committee members only');
    let decision = null;
    if (body.decisionId) {
      decision = await this.sup.decision(ctx, projectId, body.decisionId);
      if (decision.committeeId !== c.id) throw ruleViolation('governance.conflict.other_committee', 'The decision belongs to another committee');
    }
    if (body.declaration === 'recused' && !decision) throw ruleViolation('governance.conflict.decision_required', 'A recusal must name the decision (agenda item) concerned');
    let recusalRecorded = false;
    if (body.declaration === 'recused' && decision) {
      // DOM-P2-06 guards apply here too (not after the member's vote in the round; a reason when recorded on behalf).
      recusalRecorded = await this.sup.insertRecusal(ctx, decision, target, body.description, m.id);
    }
    const id = newId();
    await this.db
      .tx()
      .insert(schema.conflictDeclaration)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        committeeId: c.id,
        meetingId: m.id,
        decisionId: decision?.id ?? null,
        userId: target,
        declaration: body.declaration,
        description: body.description ?? null,
        recordedBy: self,
      });
    await this.audit.record({
      action: 'governance.conflict.declare',
      entityType: 'meeting',
      entityId: m.id,
      projectId,
      after: { userId: target, decisionId: decision?.id ?? null, declaration: body.declaration, recusalRecorded },
    });
    if (decision && recusalRecorded) {
      await this.audit.record({
        action: 'governance.decision.recusal',
        entityType: 'decision',
        entityId: decision.id,
        projectId,
        after: { userId: target, recordedBy: self, onBehalf: target !== self, round: decision.voteRound, via: 'meeting_declaration', meetingId: m.id },
        reason: body.description ?? null,
      });
    }
    return { id, recusalRecorded };
  }

  async quorumCheck(ctx: RequestContext, projectId: string, meetingId: string, body: { expectedVersion: number }) {
    const { meeting: m, committee: c } = await this.sup.meeting(ctx, projectId, meetingId, 'governance.meeting.manage');
    if (m.isCirculation) throw ruleViolation('governance.meeting.is_circulation', 'Circulation quorum is computed from responses when the outcome is recorded');
    const p = await this.sup.project(projectId);
    const onDate = this.sup.localDateOf(m.scheduledAt, p);
    const mx = this.sup.requireUsable(await this.sup.matrixInForce(c.id, onDate, p));
    const members = this.sup.memberSnapshots(await this.sup.memberships(c.id));
    const present = presentUserIds(await this.sup.attendance(m.id));
    const q = computeQuorum({ members, presentUserIds: present, recusedUserIds: [], onDate, policy: mx.policy });
    const snapshot = { ...q, onDate, matrixVersionId: mx.row.id, computedAt: new Date().toISOString(), computedBy: ctx.principal.userId };
    const row = await updateVersioned(this.db, schema.meeting, { id: m.id, projectId, expectedVersion: body.expectedVersion }, { quorumSnapshot: snapshot, authorityMatrixVersionId: mx.row.id });
    await this.audit.record({ action: 'governance.meeting.quorum_check', entityType: 'meeting', entityId: m.id, projectId, after: { met: q.met, presentVoting: q.presentVoting, required: q.required, eligibleVoting: q.eligibleVoting } });
    return {
      quorum: { eligibleVoting: q.eligibleVoting, presentVoting: q.presentVoting, required: q.required, met: q.met, explanation: q.explanation, onDate, matrixVersionId: mx.row.id, computedAt: snapshot.computedAt },
      version: row['version'] as number,
    };
  }

  async draftMinutes(ctx: RequestContext, projectId: string, meetingId: string, body: { expectedVersion: number; text: string; reason?: string }) {
    const { meeting: m } = await this.sup.meeting(ctx, projectId, meetingId, 'governance.minutes.draft');
    if (m.isCirculation) throw ruleViolation('governance.meeting.is_circulation', 'Circulated resolutions are noted in the next meeting minutes');
    assertVersion(m, body.expectedVersion, 'meeting');
    const to = transition('meeting', MEETING_MACHINE, m.status, 'draft_minutes');
    if (m.status === 'minutes_approved' && !body.reason?.trim()) {
      throw ruleViolation('governance.minutes.correction_reason_required', 'Correcting approved minutes creates a new version and requires a reason');
    }
    const row = await updateVersioned(
      this.db,
      schema.meeting,
      { id: m.id, projectId, expectedVersion: body.expectedVersion },
      { status: to, minutesText: body.text, minutesDraftedBy: ctx.principal.userId, minutesApprovedBy: null, minutesApprovedAt: null },
    );
    const version = row['version'] as number;
    await this.versions.snapshot({ projectId, entityType: MINUTES_ENTITY, entityId: m.id, versionNo: version, snapshot: { status: to, text: body.text, draftedBy: ctx.principal.userId }, reason: body.reason ?? (m.status === 'minutes_approved' ? 'correction' : 'draft') });
    await this.audit.record({ action: 'governance.minutes.draft', entityType: 'meeting', entityId: m.id, projectId, before: { status: m.status }, after: { status: to, minutesVersion: version }, reason: body.reason ?? null });
    return { id: m.id, version };
  }

  async approveMinutes(ctx: RequestContext, projectId: string, meetingId: string, body: { expectedVersion: number; note?: string }) {
    const { meeting: m, committee: c } = await this.sup.meeting(ctx, projectId, meetingId);
    // Role → state → not the drafter (unknown → fail closed), I-R3.
    this.policy.assertApproval(ctx, 'governance.minutes.approve', { projectId, classification: c.classification, requesterUserId: m.minutesDraftedBy }, () => transition('meeting', MEETING_MACHINE, m.status, 'approve_minutes'));
    assertVersion(m, body.expectedVersion, 'meeting');
    const to = transition('meeting', MEETING_MACHINE, m.status, 'approve_minutes');
    const row = await updateVersioned(this.db, schema.meeting, { id: m.id, projectId, expectedVersion: body.expectedVersion }, { status: to, minutesApprovedBy: ctx.principal.userId, minutesApprovedAt: new Date() });
    const version = row['version'] as number;
    await this.versions.snapshot({ projectId, entityType: MINUTES_ENTITY, entityId: m.id, versionNo: version, snapshot: { status: to, text: m.minutesText, draftedBy: m.minutesDraftedBy, approvedBy: ctx.principal.userId }, reason: 'approved' });
    await this.audit.record({ action: 'governance.minutes.approve', entityType: 'meeting', entityId: m.id, projectId, before: { status: m.status }, after: { status: to, method: 'internal_electronic_approval' }, reason: body.note ?? null });
    return { id: m.id, version, approvalRecord: internalApprovalLabel() };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Frozen meeting packs (report_snapshot kind committee_pack — immutable, hashed, versioned)

  async freezePack(ctx: RequestContext, projectId: string, meetingId: string, body: { expectedVersion: number; note?: string }) {
    const { meeting: m, committee: c } = await this.sup.meeting(ctx, projectId, meetingId, 'governance.meeting.manage');
    if (m.status === 'cancelled') throw ruleViolation('governance.meeting.cancelled', 'The meeting is cancelled');
    assertVersion(m, body.expectedVersion, 'meeting');
    const snap = await this.writePack(ctx, projectId, c, m, body.note);
    const row = await updateVersioned(this.db, schema.meeting, { id: m.id, projectId, expectedVersion: body.expectedVersion }, { packSnapshotId: snap.id });
    return { id: snap.id, contentHash: snap.contentHash, previousSnapshotId: m.packSnapshotId, version: row['version'] as number };
  }

  /** Build and insert a pack snapshot (also used for circulation packets). Does not touch the meeting row. */
  async writePack(ctx: RequestContext, projectId: string, c: CommitteeRow, m: MeetingRow, note?: string) {
    const p = await this.sup.project(projectId);
    const tx = this.db.tx();
    const agenda = await tx
      .select()
      .from(schema.agendaItem)
      .where(and(eq(schema.agendaItem.meetingId, m.id), eq(schema.agendaItem.screeningStatus, 'accepted')))
      .orderBy(asc(schema.agendaItem.sortOrder));
    const decisionIds = [...new Set(agenda.map((a) => a.decisionId).filter((x): x is string => !!x))];
    const decisions = await tx
      .select()
      .from(schema.decision)
      .where(and(eq(schema.decision.projectId, projectId), or(eq(schema.decision.meetingId, m.id), decisionIds.length ? inArray(schema.decision.id, decisionIds) : sql`false`)))
      .orderBy(asc(schema.decision.code));
    const committeeDecisionIds = tx.select({ id: schema.decision.id }).from(schema.decision).where(eq(schema.decision.committeeId, c.id));
    const committeeMeetingIds = tx.select({ id: schema.meeting.id }).from(schema.meeting).where(eq(schema.meeting.committeeId, c.id));
    const openActions = await tx
      .select()
      .from(schema.actionItem)
      .where(
        and(
          eq(schema.actionItem.projectId, projectId),
          inArray(schema.actionItem.status, ['open', 'in_progress', 'done_pending_verification']),
          or(inArray(schema.actionItem.decisionId, committeeDecisionIds), inArray(schema.actionItem.meetingId, committeeMeetingIds)),
        ),
      )
      .orderBy(asc(schema.actionItem.code));
    const today = this.sup.today(p);
    const onDate = this.sup.localDateOf(m.scheduledAt, p);
    const mx = await this.sup.matrixInForce(c.id, onDate, p);
    const [prevCount] = (await tx
      .select({ n: count() })
      .from(schema.reportSnapshot)
      .where(and(eq(schema.reportSnapshot.projectId, projectId), eq(schema.reportSnapshot.kind, 'committee_pack'), sql`${schema.reportSnapshot.scope}->>'meetingId' = ${m.id}`))) as [{ n: number }];
    const packVersion = Number(prevCount.n) + 1;
    const classification = maxClassification([c.classification, ...decisions.map((d) => d.classification)]);
    const payload = {
      packVersion,
      meeting: { id: m.id, number: m.number, title: m.title, scheduledAt: m.scheduledAt.toISOString(), location: m.location, status: m.status, isCirculation: m.isCirculation, responseDeadline: m.responseDeadline },
      committee: { id: c.id, name: c.name, kind: c.kind, charterApprovedVersionNo: c.charterApprovedVersionNo },
      agenda: agenda.map((a) => ({ number: a.number, title: a.title, kind: a.kind, decisionId: a.decisionId, presenterUserId: a.presenterUserId })),
      decisionPapers: decisions.map((d) => ({
        id: d.id,
        code: d.code,
        version: d.version,
        title: d.title,
        status: d.status,
        decisionTypeKey: d.decisionTypeKey,
        issue: d.issue,
        whyNow: d.whyNow,
        alternatives: d.alternatives,
        recommendation: d.recommendation,
        impacts: d.impacts,
        amount: amountOf(d),
        risks: d.risks,
        dependencies: d.dependencies,
        latestSafeDate: d.latestSafeDate,
        requiredAuthority: d.requiredAuthority,
        requesterUserId: d.requesterUserId,
        classification: d.classification,
        // DOM-P2R-03 / DOM-P2-14: the record the paper authorizes and its supporting-evidence statement.
        subjectType: d.subjectType,
        subjectId: d.subjectId,
        evidenceNoneReason: d.evidenceNoneReason,
      })),
      openActions: openActions.map((a) => ({ id: a.id, code: a.code, title: a.title, ownerUserId: a.ownerUserId, dueDate: a.dueDate, status: a.status, decisionId: a.decisionId, overdue: !!a.dueDate && a.dueDate < today && (a.status === 'open' || a.status === 'in_progress') })),
      quorum: m.quorumSnapshot ?? null,
      authorityMatrix: mx.row ? { id: mx.row.id, versionNo: mx.row.versionNo, isDemoPolicy: mx.row.isDemoPolicy, usable: mx.usable, reason: mx.reason } : null,
      // REQ-GOV-027: every approval in the pack is an internal electronic approval, never a legally certified signature.
      labels: { isDemo: p.isDemo, approvals: INTERNAL_APPROVAL_LABEL_EN, approvalMethod: INTERNAL_APPROVAL_METHOD },
    };
    const contentHash = payloadHash(payload);
    const id = newId();
    const now = new Date();
    await tx.insert(schema.reportSnapshot).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      kind: 'committee_pack',
      title: `${m.isCirculation ? 'Circulation packet' : 'Committee pack'} — ${c.name} — #${m.number} (v${packVersion})`,
      locale: ctx.locale,
      asOf: now,
      asOfLocalDate: today,
      scope: { meetingId: m.id, committeeId: c.id },
      classification,
      payload,
      sourceRefs: decisions.map((d) => ({ type: 'decision', id: d.id, label: d.code })),
      contentHash,
      previousSnapshotId: m.packSnapshotId,
      includesDemoData: p.isDemo,
      generatedBy: ctx.principal.userId,
    });
    await this.audit.record({ action: 'governance.meeting.freeze_pack', entityType: 'meeting', entityId: m.id, projectId, after: { snapshotId: id, packVersion, contentHash, classification }, reason: note ?? null });
    return { id, contentHash };
  }

  async listPacks(ctx: RequestContext, projectId: string, meetingId: string) {
    const { meeting: m } = await this.sup.meeting(ctx, projectId, meetingId);
    const s = schema.reportSnapshot;
    const rows = await this.db
      .tx()
      .select()
      .from(s)
      .where(and(eq(s.projectId, projectId), eq(s.kind, 'committee_pack'), sql`${s.scope}->>'meetingId' = ${m.id}`, this.policy.visibilitySql(ctx, projectId, { classification: s.classification })))
      .orderBy(desc(s.generatedAt));
    return { items: rows.map((r) => this.packSummary(r)) };
  }

  async getPack(ctx: RequestContext, projectId: string, meetingId: string, packId: string) {
    const { meeting: m } = await this.sup.meeting(ctx, projectId, meetingId);
    const r = await loadInProject(this.db, schema.reportSnapshot, projectId, packId);
    if (r.kind !== 'committee_pack' || (r.scope as { meetingId?: string }).meetingId !== m.id) throw notFound();
    this.policy.assert(ctx, 'governance.meeting.read', { projectId, classification: r.classification });
    return { ...this.packSummary(r), payload: r.payload };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Agenda requests & screening

  async createAgendaRequest(ctx: RequestContext, projectId: string, body: { committeeId: string; title: string; kind: AgendaKind; decisionId?: string; meetingId?: string; presenterUserId?: string }) {
    const c = await this.sup.committee(ctx, projectId, body.committeeId, 'governance.agenda_request.create');
    if (c.status === 'dissolved') throw ruleViolation('governance.committee.dissolved', 'The committee is dissolved');
    if (body.decisionId) {
      const d = await this.sup.decision(ctx, projectId, body.decisionId);
      if (d.committeeId !== c.id) throw ruleViolation('governance.agenda.other_committee', 'The decision belongs to another committee');
    }
    if (body.meetingId) {
      const m = await loadInProject(this.db, schema.meeting, projectId, body.meetingId);
      this.assertAgendaOpen(m, c.id);
    }
    if (body.presenterUserId) {
      const [u] = await this.db.tx().select({ id: schema.appUser.id }).from(schema.appUser).where(and(eq(schema.appUser.id, body.presenterUserId), eq(schema.appUser.isActive, true)));
      if (!u) throw ruleViolation('governance.agenda.presenter_not_found', 'Presenter not found or inactive');
    }
    const id = newId();
    await this.db
      .tx()
      .insert(schema.agendaItem)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        committeeId: c.id,
        meetingId: body.meetingId ?? null,
        title: body.title,
        kind: body.kind,
        decisionId: body.decisionId ?? null,
        requestedBy: ctx.principal.userId,
        screeningStatus: 'requested',
        presenterUserId: body.presenterUserId ?? null,
        createdBy: ctx.principal.userId,
      });
    await this.audit.record({ action: 'governance.agenda_request.create', entityType: 'agenda_item', entityId: id, projectId, after: { committeeId: c.id, title: body.title, kind: body.kind, decisionId: body.decisionId ?? null, preferredMeetingId: body.meetingId ?? null } });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'agenda_item', aggregateId: id, payload: { subjectType: 'agenda_item', subjectId: id, requiredPermission: 'governance.agenda_request.screen', committeeId: c.id } });
    return { id, version: 1 };
  }

  /**
   * Secretariat screening (REQ-GOV-012): accept onto a numbered agenda, return, defer, merge into another request of the
   * same meeting, or reject — every outcome but accept with a reason. Emits `agenda_request.screened` (ids + outcome) for
   * the requester's notification (P6, REQ-PLT-008).
   */
  async screenAgendaRequest(ctx: RequestContext, projectId: string, agendaItemId: string, body: { expectedVersion: number; outcome: ScreeningOutcome; meetingId?: string; mergeIntoAgendaItemId?: string; note?: string }) {
    const a = await loadInProject(this.db, schema.agendaItem, projectId, agendaItemId);
    const c = await loadInProject(this.db, schema.committee, projectId, a.committeeId);
    this.policy.assert(ctx, 'governance.agenda_request.screen', { projectId, classification: c.classification, requesterUserId: a.requestedBy });
    assertVersion(a, body.expectedVersion, 'agenda request');
    const to = transition('agenda_request', AGENDA_SCREENING_MACHINE, a.screeningStatus, body.outcome);
    if (screeningReasonRequired(body.outcome) && !body.note?.trim()) {
      throw ruleViolation('governance.agenda.reason_required', 'A reason is required to return, defer, merge or reject a request');
    }
    const values: Record<string, unknown> = { screeningStatus: to, screenedBy: ctx.principal.userId, screeningNote: body.note ?? null };
    let number: number | null = a.number;
    let mergedInto: string | null = null;
    if (body.outcome === 'accept') {
      const meetingId = body.meetingId ?? a.meetingId;
      if (!meetingId) throw ruleViolation('governance.agenda.meeting_required', 'Choose the meeting whose agenda the item joins');
      const m = await loadInProject(this.db, schema.meeting, projectId, meetingId);
      this.assertAgendaOpen(m, c.id);
      // F-03 (REQ-GOV-013): concurrent acceptances onto the same meeting are serialized on the meeting row, so each gets
      // the next number (a partial unique index on (meeting_id, number) backs it up → 409).
      await this.db.tx().execute(sql`select id from meeting where id = ${m.id} and project_id = ${projectId} for update`);
      const [{ n }] = (await this.db
        .tx()
        .select({ n: sql<number>`coalesce(max(${schema.agendaItem.number}), 0)::int` })
        .from(schema.agendaItem)
        .where(and(eq(schema.agendaItem.meetingId, m.id), eq(schema.agendaItem.screeningStatus, 'accepted')))) as [{ n: number }];
      number = n + 1;
      Object.assign(values, { meetingId: m.id, number, sortOrder: number });
      if (a.decisionId) {
        const d = await loadInProject(this.db, schema.decision, projectId, a.decisionId);
        if ((TABLEABLE as readonly string[]).includes(d.status) && d.meetingId !== m.id) {
          await updateVersioned(this.db, schema.decision, { id: d.id, projectId, expectedVersion: d.version }, { meetingId: m.id });
          await this.audit.record({ action: 'governance.decision.table', entityType: 'decision', entityId: d.id, projectId, before: { meetingId: d.meetingId }, after: { meetingId: m.id, agendaItemId: a.id } });
        }
      }
    } else if (body.outcome === 'merge') {
      // The target is locked, then read, so it cannot be closed or merged elsewhere while this request joins it.
      if (!body.mergeIntoAgendaItemId) throw ruleViolation('governance.agenda.merge_target_required', 'Choose the request this one is merged into');
      await this.db.tx().execute(sql`select id from agenda_item where id = ${body.mergeIntoAgendaItemId} and project_id = ${projectId} for update`);
      const target = await loadInProject(this.db, schema.agendaItem, projectId, body.mergeIntoAgendaItemId);
      const meetingId = body.meetingId ?? a.meetingId;
      assertAgendaMerge({ source: a, target, meetingId });
      this.assertAgendaOpen(await loadInProject(this.db, schema.meeting, projectId, meetingId!), c.id);
      mergedInto = target.id;
      Object.assign(values, { meetingId, number: null, mergedIntoAgendaItemId: target.id });
      number = null;
    } else if (body.outcome === 'return' || body.outcome === 'reject') {
      Object.assign(values, { number: null });
      number = null;
    }
    const row = await updateVersioned(this.db, schema.agendaItem, { id: a.id, projectId, expectedVersion: body.expectedVersion }, values);
    const meetingId = (values['meetingId'] as string | null | undefined) ?? a.meetingId;
    await this.audit.record({
      action: 'governance.agenda_request.screen',
      entityType: 'agenda_item',
      entityId: a.id,
      projectId,
      before: { screeningStatus: a.screeningStatus },
      after: { screeningStatus: to, meetingId, number, mergedIntoAgendaItemId: mergedInto },
      reason: body.note ?? null,
    });
    // The requester is told the outcome (notification: P6). Ids and the outcome only — the reason stays on the record.
    await this.outbox.emit({
      type: 'agenda_request.screened',
      projectId,
      aggregateType: 'agenda_item',
      aggregateId: a.id,
      payload: { agendaItemId: a.id, committeeId: c.id, meetingId, requesterUserId: a.requestedBy, outcome: body.outcome, screeningStatus: to, number, mergedIntoAgendaItemId: mergedInto },
    });
    return { id: a.id, screeningStatus: to, number, mergedIntoAgendaItemId: mergedInto, version: row['version'] as number };
  }

  private assertAgendaOpen(m: MeetingRow, committeeId: string) {
    if (m.committeeId !== committeeId) throw ruleViolation('governance.agenda.other_committee', 'The meeting belongs to another committee');
    if (m.isCirculation) throw ruleViolation('governance.agenda.circulation', 'Items cannot be added to a circulation');
    if (m.status === 'proposed') {
      throw ruleViolation('governance.agenda.meeting_proposed', `Meeting #${m.number} is only proposed — the secretariat confirms it before items join its agenda`);
    }
    if (m.status !== 'planned' && m.status !== 'agenda_published') throw ruleViolation('governance.agenda.closed', `The agenda of meeting #${m.number} is closed (${m.status})`);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Mapping

  meetingDto(m: MeetingRow, committeeName: string) {
    return {
      id: m.id,
      committeeId: m.committeeId,
      committeeName,
      number: m.number,
      title: m.title,
      scheduledAt: m.scheduledAt.toISOString(),
      location: m.location,
      status: m.status,
      isCirculation: m.isCirculation,
      responseDeadline: m.responseDeadline,
      packSnapshotId: m.packSnapshotId,
      minutesApprovedAt: iso(m.minutesApprovedAt),
      cadenceCharterVersionNo: m.cadenceCharterVersionNo,
      isDemo: m.isDemo,
      version: m.version,
    };
  }

  private agendaDto(a: typeof schema.agendaItem.$inferSelect, decisionCode: string | null) {
    return {
      id: a.id,
      committeeId: a.committeeId,
      meetingId: a.meetingId,
      number: a.number,
      title: a.title,
      kind: a.kind,
      decisionId: a.decisionId,
      decisionCode,
      requestedBy: a.requestedBy,
      screeningStatus: a.screeningStatus,
      screeningNote: a.screeningNote,
      screenedBy: a.screenedBy,
      mergedIntoAgendaItemId: a.mergedIntoAgendaItemId,
      presenterUserId: a.presenterUserId,
      version: a.version,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private packSummary(r: typeof schema.reportSnapshot.$inferSelect) {
    return {
      id: r.id,
      title: r.title,
      classification: r.classification,
      asOf: r.asOf.toISOString(),
      contentHash: r.contentHash,
      previousSnapshotId: r.previousSnapshotId,
      generatedBy: r.generatedBy,
      generatedAt: r.generatedAt.toISOString(),
      includesDemoData: r.includesDemoData,
    };
  }
}

export type { ProjectInfo };
