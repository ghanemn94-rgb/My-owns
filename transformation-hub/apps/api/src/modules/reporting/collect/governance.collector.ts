import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import { isOverdue, notFound, serverMessage, type Classification } from '@hub/domain';
import { loadInProject } from '../../../platform/helpers';
import { figure, section, table, type StoredSection } from '../report-model';
import { displayNames, iso, type Gen } from './gen-context';

const PERM = 'governance.decision.read';
const OPEN_DECISION: readonly string[] = ['draft', 'submitted', 'under_review', 'recommended'];
const NEEDS_DECISION = ['submitted', 'under_review', 'recommended'] as const;
const OPEN_ACTION: readonly string[] = ['open', 'in_progress', 'done_pending_verification'];
const UNRESOLVED_ESCALATION = ['open', 'decision_requested'] as const;

type Decision = typeof schema.decision.$inferSelect;

/** Governance records are project-level: only a project-wide (or matching) grant of governance.decision.read reads them. */
export function canCollectGovernance(g: Gen): boolean {
  return g.access.policy.can(g.ctx, PERM, { projectId: g.projectId });
}

function decisionWhere(g: Gen): SQL {
  const d = schema.decision;
  return and(eq(d.projectId, g.projectId), g.access.policy.visibilitySql(g.ctx, g.projectId, { classification: d.classification }), g.access.policy.grantSql(g.ctx, PERM, g.projectId, {}))!;
}

async function decisions(g: Gen, extra?: SQL): Promise<Decision[]> {
  return g.db.tx().select().from(schema.decision).where(and(decisionWhere(g), extra)).orderBy(asc(schema.decision.latestSafeDate), asc(schema.decision.code));
}

const decisionColumns: [string, 'code' | 'text' | 'enum' | 'date' | 'person', string?][] = [
  ['code', 'code'],
  ['title', 'text'],
  ['status', 'enum', 'decisionStatuses'],
  ['authorityOutcome', 'enum', 'decisionAuthorityOutcomes'],
  ['requiredAuthority', 'text'],
  ['latestSafeDate', 'date'],
  ['requester', 'person'],
];

function decisionRow(d: Decision, names: Map<string, string>) {
  return {
    code: d.code,
    title: d.title,
    status: d.status,
    authorityOutcome: d.authorityOutcome,
    requiredAuthority: d.requiredAuthority,
    latestSafeDate: d.latestSafeDate,
    requester: d.requesterUserId ? (names.get(d.requesterUserId) ?? null) : null,
  };
}

/** "What decision is needed, who owns it and by when" (executive summary). */
export async function decisionsNeededSection(g: Gen): Promise<StoredSection> {
  const rows = await decisions(g, inArray(schema.decision.status, NEEDS_DECISION));
  const names = await displayNames(g, rows.map((d) => d.requesterUserId));
  return section('decisions_needed', g.access.flat('decisions_needed', [PERM], rows.map((d) => d.classification)), {
    figures: [figure('decisions_pending', rows.length), figure('decisions_overdue', rows.filter((d) => isOverdue(d.latestSafeDate, g.today, true)).length)],
    tables: [table('decisions_needed', decisionColumns, rows.map((d) => decisionRow(d, names)), 15)],
    sourceRefs: rows.map((d) => ({ type: 'decision', id: d.id, label: d.code })),
  });
}

/** Decision register extract (committee pack). */
export async function decisionsSection(g: Gen): Promise<StoredSection> {
  const rows = await decisions(g);
  const names = await displayNames(g, rows.map((d) => d.requesterUserId));
  const open = rows.filter((d) => OPEN_DECISION.includes(d.status));
  return section('decisions', g.access.flat('decisions', [PERM], rows.map((d) => d.classification)), {
    figures: [
      figure('decisions_open', open.length),
      figure('decisions_overdue', open.filter((d) => isOverdue(d.latestSafeDate, g.today, true)).length),
      figure('decisions_pending_external_authority', rows.filter((d) => d.authorityOutcome === 'pending_external_authority').length),
      figure('decisions_approved', rows.filter((d) => ['approved', 'implementation_pending', 'implemented_verified'].includes(d.status)).length),
    ],
    tables: [table('decisions', decisionColumns, rows.map((d) => decisionRow(d, names)), 60)],
    notes: [serverMessage('report.internal_approval_label')],
    sourceRefs: rows.map((d) => ({ type: 'decision', id: d.id, label: d.code })),
  });
}

async function visibleActions(g: Gen, extra?: SQL) {
  const a = schema.actionItem;
  const d = schema.decision;
  return g.db
    .tx()
    .select({ a, decisionClassification: d.classification })
    .from(a)
    .leftJoin(d, eq(d.id, a.decisionId))
    .where(
      and(
        eq(a.projectId, g.projectId),
        g.access.policy.visibilitySql(g.ctx, g.projectId, {}),
        g.access.policy.grantSql(g.ctx, PERM, g.projectId, {}),
        or(sql`${a.decisionId} is null`, g.access.policy.visibilitySql(g.ctx, g.projectId, { classification: d.classification })),
        extra,
      ),
    )
    .orderBy(asc(a.dueDate), asc(a.code));
}

/** Committee actions: open, overdue, awaiting verification (committee pack). */
export async function actionsSection(g: Gen, key = 'actions', extra?: SQL): Promise<StoredSection> {
  const all = await visibleActions(g, extra);
  const rows = key === 'actions' ? all.filter((r) => OPEN_ACTION.includes(r.a.status)) : all;
  const names = await displayNames(g, rows.map((r) => r.a.ownerUserId));
  const overdue = rows.filter((r) => isOverdue(r.a.dueDate, g.today, r.a.status === 'open' || r.a.status === 'in_progress'));
  const cls: (Classification | null)[] = rows.map((r) => r.decisionClassification);
  return section(key, g.access.flat(key, [PERM], cls), {
    figures: [
      figure('actions_open', rows.filter((r) => r.a.status === 'open' || r.a.status === 'in_progress').length),
      figure('actions_overdue', overdue.length),
      figure('actions_pending_verification', rows.filter((r) => r.a.status === 'done_pending_verification').length),
    ],
    tables: [
      table(
        key,
        [['code', 'code'], ['title', 'text'], ['owner', 'person'], ['dueDate', 'date'], ['status', 'enum', 'actionItemStatuses'], ['overdue', 'boolean']],
        rows.map((r) => ({
          code: r.a.code,
          title: r.a.title,
          owner: r.a.ownerUserId ? (names.get(r.a.ownerUserId) ?? null) : null,
          dueDate: r.a.dueDate,
          status: r.a.status,
          overdue: isOverdue(r.a.dueDate, g.today, r.a.status === 'open' || r.a.status === 'in_progress'),
        })),
        60,
      ),
    ],
    sourceRefs: rows.map((r) => ({ type: 'action_item', id: r.a.id, label: r.a.code })),
  });
}

/** Unresolved escalations (executive summary, weekly report). */
export async function escalationsSection(g: Gen): Promise<StoredSection> {
  const e = schema.escalation;
  const d = schema.decision;
  const rows = await g.db
    .tx()
    .select({ e, decisionClassification: d.classification })
    .from(e)
    .leftJoin(d, and(eq(e.sourceType, 'decision'), eq(d.id, e.sourceId)))
    .where(
      and(
        eq(e.projectId, g.projectId),
        inArray(e.status, UNRESOLVED_ESCALATION),
        g.access.policy.visibilitySql(g.ctx, g.projectId, {}),
        g.access.policy.grantSql(g.ctx, PERM, g.projectId, {}),
        or(sql`${e.sourceType} <> 'decision'`, g.access.policy.visibilitySql(g.ctx, g.projectId, { classification: d.classification })),
        // A report limited to one workstream lists the escalations raised from that workstream's risks and issues.
        g.workstreamId
          ? or(
              and(eq(e.sourceType, 'risk'), inArray(e.sourceId, g.db.tx().select({ id: schema.risk.id }).from(schema.risk).where(eq(schema.risk.workstreamId, g.workstreamId)))),
              and(eq(e.sourceType, 'issue'), inArray(e.sourceId, g.db.tx().select({ id: schema.issue.id }).from(schema.issue).where(eq(schema.issue.workstreamId, g.workstreamId)))),
            )
          : undefined,
      ),
    )
    .orderBy(asc(e.decisionDeadline), asc(e.code));
  const list = rows;
  return section('escalations', g.access.flat('escalations', [PERM], list.map((r) => r.decisionClassification)), {
    figures: [figure('escalations_unresolved', list.length), figure('escalations_past_deadline', list.filter((r) => isOverdue(r.e.decisionDeadline, g.today, true)).length)],
    tables: [
      table(
        'escalations',
        [['code', 'code'], ['title', 'text'], ['requestedAction', 'text'], ['target', 'text'], ['decisionDeadline', 'date'], ['status', 'enum', 'escalationStatuses'], ['systemGenerated', 'boolean']],
        list.map((r) => ({ code: r.e.code, title: r.e.title, requestedAction: r.e.requestedAction, target: r.e.target, decisionDeadline: r.e.decisionDeadline, status: r.e.status, systemGenerated: r.e.isSystemGenerated })),
        30,
      ),
    ],
    sourceRefs: list.map((r) => ({ type: 'escalation', id: r.e.id, label: r.e.code })),
  });
}

/**
 * Minutes of one meeting (DOCX minutes, REQ-RPT-010): header, attendance, agenda with minutes notes and the minutes text,
 * with the approval state labelled as an internal electronic approval (REQ-GOV-027). The meeting must be readable by the
 * generator (governance.meeting.read at the committee's classification) — otherwise 404.
 */
export async function meetingSections(g: Gen, meetingId: string): Promise<StoredSection[]> {
  const m = await loadInProject(g.db, schema.meeting, g.projectId, meetingId);
  const c = await loadInProject(g.db, schema.committee, g.projectId, m.committeeId);
  if (!g.access.policy.can(g.ctx, 'governance.meeting.read', { projectId: g.projectId, classification: c.classification })) throw notFound();
  const tx = g.db.tx();
  const agenda = await tx
    .select()
    .from(schema.agendaItem)
    .where(and(eq(schema.agendaItem.projectId, g.projectId), eq(schema.agendaItem.meetingId, m.id), eq(schema.agendaItem.screeningStatus, 'accepted')))
    .orderBy(asc(schema.agendaItem.number), asc(schema.agendaItem.sortOrder));
  const attendance = await tx
    .select({ status: schema.attendance.status, userId: schema.committeeMembership.userId, roleLabel: schema.committeeMembership.roleLabel, memberRole: schema.committeeMembership.memberRole, voting: schema.committeeMembership.voting })
    .from(schema.attendance)
    .innerJoin(schema.committeeMembership, eq(schema.committeeMembership.id, schema.attendance.membershipId))
    .where(and(eq(schema.attendance.projectId, g.projectId), eq(schema.attendance.meetingId, m.id)));
  const names = await displayNames(g, [...attendance.map((a) => a.userId), m.minutesDraftedBy, m.minutesApprovedBy]);
  attendance.sort((a, b) => ((a.userId ? (names.get(a.userId) ?? '') : '') < (b.userId ? (names.get(b.userId) ?? '') : '') ? -1 : 1));
  const meetingAccess = g.access.flat('meeting', ['governance.meeting.read'], [c.classification]);
  const meeting = section('meeting', meetingAccess, {
    figures: [figure('attendees_present', attendance.filter((a) => a.status === 'present' || a.status === 'remote' || a.status === 'delegated').length), figure('agenda_items', agenda.length)],
    tables: [
      table(
        'meeting_header',
        [['committee', 'text'], ['number', 'number'], ['title', 'text'], ['scheduledAt', 'text'], ['location', 'text'], ['status', 'enum', 'meetingStatuses'], ['minutesApprovedBy', 'person'], ['minutesApprovedAt', 'text']],
        [
          {
            committee: c.name,
            number: m.number,
            title: m.title,
            scheduledAt: iso(m.scheduledAt),
            location: m.location,
            status: m.status,
            minutesApprovedBy: m.minutesApprovedBy ? (names.get(m.minutesApprovedBy) ?? null) : null,
            minutesApprovedAt: iso(m.minutesApprovedAt),
          },
        ],
      ),
      table(
        'attendance',
        [['member', 'person'], ['role', 'text'], ['voting', 'boolean'], ['status', 'enum', 'attendanceStatuses']],
        attendance.map((a) => ({ member: a.userId ? (names.get(a.userId) ?? null) : null, role: a.roleLabel ?? a.memberRole, voting: a.voting, status: a.status })),
      ),
      table(
        'agenda',
        [['number', 'number'], ['title', 'text'], ['kind', 'enum', 'agendaItemKinds'], ['minutesNote', 'text']],
        agenda.map((a) => ({ number: a.number, title: a.title, kind: a.kind, minutesNote: a.minutesNote })),
      ),
      table('minutes_text', [['text', 'text']], [{ text: m.minutesText }]),
    ],
    notes: [serverMessage(m.status === 'minutes_approved' ? 'report.minutes_approved_internal' : 'report.minutes_not_approved'), serverMessage('report.internal_approval_label')],
    sourceRefs: [{ type: 'meeting', id: m.id, label: `#${m.number}` }],
  });
  const decisionsOfMeeting = await decisions(g, eq(schema.decision.meetingId, m.id));
  const dn = await displayNames(g, decisionsOfMeeting.map((d) => d.requesterUserId));
  const decided = section('minutes_decisions', g.access.flat('minutes_decisions', [PERM], decisionsOfMeeting.map((d) => d.classification)), {
    figures: [figure('decisions_at_meeting', decisionsOfMeeting.length)],
    tables: [table('minutes_decisions', [...decisionColumns, ['outcomeRecordedAt', 'text']], decisionsOfMeeting.map((d) => ({ ...decisionRow(d, dn), outcomeRecordedAt: iso(d.outcomeRecordedAt) })))],
    notes: [serverMessage('report.internal_approval_label')],
    sourceRefs: decisionsOfMeeting.map((d) => ({ type: 'decision', id: d.id, label: d.code })),
  });
  const ids = decisionsOfMeeting.map((d) => d.id);
  const actions = await actionsSection(g, 'minutes_actions', or(eq(schema.actionItem.meetingId, m.id), ids.length ? inArray(schema.actionItem.decisionId, ids) : sql`false`));
  return [meeting, decided, actions];
}

