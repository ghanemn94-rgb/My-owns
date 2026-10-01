import { z } from 'zod';
import {
  ACTION_ITEM_STATUSES,
  AGENDA_ITEM_KINDS,
  AGENDA_SCREENING_STATUSES,
  ATTENDANCE_STATUSES,
  AUTHORITY_MATRIX_STATUSES,
  CADENCE_FREQUENCIES,
  COMMITTEE_KINDS,
  COMMITTEE_MEMBER_ROLES,
  COMMITTEE_STATUSES,
  DECISION_AUTHORITY_OUTCOMES,
  DECISION_STATUSES,
  DECISION_SUBJECT_TYPES,
  ESCALATION_STATUSES,
  INTERNAL_APPROVAL_LABEL_EN,
  INTERNAL_APPROVAL_METHOD,
  MAX_PROPOSED_MEETINGS,
  MEETING_STATUSES,
  VOTE_CHOICES,
} from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import {
  ClassificationSchema,
  Currency,
  DecimalString,
  ExpectedVersion,
  IsoDate,
  IsoInstant,
  MoneySchema,
  PageQuery,
  ProjectParams,
  RequiredText,
  ServerMessageSchema,
  SortParam,
  Text,
  UnitScale,
  Uuid,
  paged,
} from './common';

/**
 * Governance (spec §4): committees, charter versions, memberships, authority matrix versions, meetings, agenda
 * requests & screening, attendance, conflicts/recusals, quorum, minutes, frozen meeting packs, decisions, votes,
 * circulation, outcomes (AT-04/AT-05), external approvals, implementation tracking, actions and escalations.
 * Every status change is an explicit command (`POST .../<verb>`); PATCH routes change descriptive fields only.
 */

// ---------------------------------------------------------------------------------------------------------------
// Shared schemas

const DecisionTypeKey = z.string().regex(/^[a-z0-9_]{2,64}$/, 'lower_snake_case key');

/** Machine-readable authority / delegation policy (docs/governance/authority-matrix.md §2, §4.3). */
export const AuthorityPolicySchema = z
  .object({
    isDemoPolicy: z.boolean(),
    quorum: z.object({ minVotingMembersPresent: z.number().int().min(1).max(100), minFractionPresent: z.number().min(0).max(1) }),
    approvalThreshold: z.object({ type: z.enum(['simple_majority', 'two_thirds']) }),
    tieRule: z.enum(['chair_casting_vote', 'escalate']),
    decisionTypes: z
      .array(
        z.object({
          key: DecisionTypeKey,
          name: z.object({ en: RequiredText(300), ar: RequiredText(300) }).optional(),
          maxAmount: DecimalString.refine((v) => !v.startsWith('-'), 'Limit must not be negative').nullable(),
          currency: Currency,
          unitScale: UnitScale,
          withinCommitteeAuthority: z.boolean(),
          escalateTo: RequiredText(300),
          conditions: z.array(Text(500)).max(20).optional(),
          requiredRecommenders: z.array(Text(200)).max(20).optional(),
          /** Gates whose passage this decision type may approve (DOM-P2-01); a type without gate keys backs no gate. */
          gateKeys: z.array(z.string().trim().regex(/^[A-Za-z0-9_-]{1,16}$/, 'gate key')).max(20).optional(),
        }),
      )
      .min(1)
      .max(200)
      .superRefine((rows, ctx) => {
        const seen = new Set<string>();
        for (const [i, r] of rows.entries()) {
          if (seen.has(r.key)) ctx.addIssue({ code: 'custom', path: [i, 'key'], message: `Duplicate decision type ${r.key}` });
          seen.add(r.key);
        }
      }),
    alternatesPermitted: z.boolean().optional(),
    proxyVotingPermitted: z.boolean().optional(),
    /** Platform invariants — not configurable (authority-matrix.md §2.1). */
    selfApprovalProhibited: z.literal(true),
    recusedMembersExcludedFromQuorum: z.literal(true),
  });
export type AuthorityPolicyDto = z.infer<typeof AuthorityPolicySchema>;

export const CharterSchema = z.object({
  purpose: Text(8000).optional(),
  scope: Text(8000).optional(),
  delegatedAuthority: Text(8000).optional(),
  exclusions: Text(8000).optional(),
  reservedMatters: Text(8000).optional(),
  cadence: Text(2000).optional(),
  /** Cadence is a proposal until confirmed — never presented as a confirmed corporate schedule (REQ-GOV-009). */
  cadenceIsProposal: z.boolean().default(true),
  /**
   * REQ-GOV-009: the cadence as a rule the secretariat can generate PROPOSED meetings from (weekly, every two weeks, monthly);
   * the free-text `cadence` describes it. Part of the charter, so a change needs the charter re-approved.
   */
  cadenceRule: z.object({ frequency: z.enum(CADENCE_FREQUENCIES) }).nullable().optional(),
  classification: Text(200).optional(),
  minutesRetention: Text(2000).optional(),
  escalation: Text(4000).optional(),
  conflictsOfInterest: Text(4000).optional(),
  circulation: Text(4000).optional(),
});

const VersionResult = z.object({ id: Uuid, version: z.number().int() });

/**
 * REQ-GOV-027: the label every approval record carries in API responses — an internal electronic approval, never a legally
 * certified signature (the web translates `method`). Exports carry it too (P6).
 */
export const ApprovalLabelDto = z.object({ method: z.literal(INTERNAL_APPROVAL_METHOD), label: z.literal(INTERNAL_APPROVAL_LABEL_EN) });

// ---------------------------------------------------------------------------------------------------------------
// DTOs

export const CommitteeMembershipDto = z.object({
  id: Uuid,
  committeeId: Uuid,
  userId: Uuid.nullable(),
  displayName: z.string().nullable(),
  /** Seat label; for seats without a person the UI shows "Role — To be confirmed". */
  roleLabel: z.string(),
  isPlaceholder: z.boolean(),
  memberRole: z.enum(COMMITTEE_MEMBER_ROLES),
  voting: z.boolean(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  activeToday: z.boolean(),
  version: z.number().int(),
});

export const MatrixSummaryDto = z.object({
  id: Uuid,
  versionNo: z.number().int(),
  status: z.enum(AUTHORITY_MATRIX_STATUSES),
  isDemoPolicy: z.boolean(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  usable: z.boolean(),
  usableReason: z.string(),
});

export const CommitteeDto = z.object({
  id: Uuid,
  kind: z.enum(COMMITTEE_KINDS),
  name: z.string(),
  status: z.enum(COMMITTEE_STATUSES),
  classification: ClassificationSchema,
  charterVersionNo: z.number().int(),
  charterApprovedVersionNo: z.number().int().nullable(),
  charterApprovedAt: z.string().nullable(),
  isDemo: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  memberCount: z.number().int(),
  activeMatrix: MatrixSummaryDto.nullable(),
});

export const CommitteeDetailDto = CommitteeDto.extend({
  charter: CharterSchema.partial(),
  charterApprovedBy: Uuid.nullable(),
  /** REQ-GOV-027: label of the charter approval record (null while no charter version is approved). */
  charterApproval: ApprovalLabelDto.nullable(),
  memberships: z.array(CommitteeMembershipDto),
});

export const CharterVersionDto = z.object({
  versionNo: z.number().int(),
  charter: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  changedBy: Uuid.nullable(),
  changedAt: z.string(),
  approved: z.boolean(),
});

export const AuthorityMatrixVersionDto = z.object({
  id: Uuid,
  committeeId: Uuid,
  versionNo: z.number().int(),
  status: z.enum(AUTHORITY_MATRIX_STATUSES),
  isDemoPolicy: z.boolean(),
  policy: z.record(z.string(), z.unknown()),
  policyHash: z.string(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  approvedBy: Uuid.nullable(),
  approvedAt: z.string().nullable(),
  approvalReference: z.string().nullable(),
  /** Approval record (documents module) of a non-demo matrix (DOM-P2-12). */
  approvalDocumentId: Uuid.nullable(),
  approvalDocumentVersionId: Uuid.nullable(),
  /** Second person who verified the approval evidence; a non-demo matrix is in force only after this verification. */
  approvalVerifiedBy: Uuid.nullable(),
  approvalVerifiedAt: z.string().nullable(),
  approvalVerificationNote: z.string().nullable(),
  /** An approval is recorded on this draft and awaits verification of its evidence by a second person. */
  pendingVerification: z.boolean(),
  /** REQ-GOV-027: label of the matrix approval record (null while no approval is recorded). */
  approvalRecord: ApprovalLabelDto.nullable(),
  createdBy: Uuid.nullable(),
  createdAt: z.string(),
});

export const AgendaItemDto = z.object({
  id: Uuid,
  committeeId: Uuid,
  meetingId: Uuid.nullable(),
  number: z.number().int().nullable(),
  title: z.string(),
  kind: z.enum(AGENDA_ITEM_KINDS),
  decisionId: Uuid.nullable(),
  decisionCode: z.string().nullable(),
  requestedBy: Uuid.nullable(),
  screeningStatus: z.enum(AGENDA_SCREENING_STATUSES),
  screeningNote: z.string().nullable(),
  screenedBy: Uuid.nullable(),
  /** REQ-GOV-012: the request of the same meeting this one was merged into (screening status `merged`). */
  mergedIntoAgendaItemId: Uuid.nullable(),
  presenterUserId: Uuid.nullable(),
  version: z.number().int(),
  createdAt: z.string(),
});

export const AttendanceDto = z.object({
  membershipId: Uuid,
  userId: Uuid.nullable(),
  displayName: z.string().nullable(),
  roleLabel: z.string(),
  memberRole: z.enum(COMMITTEE_MEMBER_ROLES),
  voting: z.boolean(),
  status: z.enum(ATTENDANCE_STATUSES),
  recordedAt: z.string(),
});

export const ConflictDeclarationDto = z.object({
  id: Uuid,
  userId: Uuid,
  displayName: z.string().nullable(),
  decisionId: Uuid.nullable(),
  declaration: z.enum(['no_conflict', 'interest_declared', 'recused']),
  description: z.string().nullable(),
  declaredAt: z.string(),
});

export const MeetingDto = z.object({
  id: Uuid,
  committeeId: Uuid,
  committeeName: z.string(),
  number: z.number().int(),
  title: z.string(),
  scheduledAt: z.string(),
  location: z.string().nullable(),
  status: z.enum(MEETING_STATUSES),
  isCirculation: z.boolean(),
  responseDeadline: z.string().nullable(),
  packSnapshotId: Uuid.nullable(),
  minutesApprovedAt: z.string().nullable(),
  /** REQ-GOV-009: the charter version whose cadence proposed this meeting (null = scheduled by hand). */
  cadenceCharterVersionNo: z.number().int().nullable(),
  isDemo: z.boolean(),
  version: z.number().int(),
});

export const MeetingDetailDto = MeetingDto.extend({
  classification: ClassificationSchema,
  quorumSnapshot: z.record(z.string(), z.unknown()).nullable(),
  minutesText: z.string().nullable(),
  minutesDraftedBy: Uuid.nullable(),
  minutesApprovedBy: Uuid.nullable(),
  /** REQ-GOV-027: label of the minutes approval record (null while the minutes are not approved). */
  minutesApproval: ApprovalLabelDto.nullable(),
  authorityMatrixVersionId: Uuid.nullable(),
  agenda: z.array(AgendaItemDto),
  attendance: z.array(AttendanceDto),
  conflicts: z.array(ConflictDeclarationDto),
});

export const QuorumDto = z.object({
  eligibleVoting: z.number().int(),
  presentVoting: z.number().int(),
  required: z.number().int(),
  met: z.boolean(),
  explanation: z.string(),
  onDate: z.string(),
  matrixVersionId: Uuid,
  computedAt: z.string(),
});

export const PackSummaryDto = z.object({
  id: Uuid,
  title: z.string(),
  classification: ClassificationSchema,
  asOf: z.string(),
  contentHash: z.string(),
  previousSnapshotId: Uuid.nullable(),
  generatedBy: Uuid.nullable(),
  generatedAt: z.string(),
  includesDemoData: z.boolean(),
});
export const PackDto = PackSummaryDto.extend({ payload: z.record(z.string(), z.unknown()) });

const MoneyOut = z.object({ amount: z.string(), currency: z.string(), unitScale: z.number().int() });

export const DecisionSummaryDto = z.object({
  id: Uuid,
  code: z.string(),
  title: z.string(),
  committeeId: Uuid,
  status: z.enum(DECISION_STATUSES),
  decisionTypeKey: z.string().nullable(),
  requesterUserId: Uuid.nullable(),
  requesterName: z.string().nullable(),
  latestSafeDate: z.string().nullable(),
  authorityOutcome: z.enum(DECISION_AUTHORITY_OUTCOMES),
  escalatedTo: z.string().nullable(),
  meetingId: Uuid.nullable(),
  voteRound: z.number().int(),
  /** The record this decision authorizes (DOM-P2R-03): change request / baseline version / perimeter version. */
  subjectType: z.enum(DECISION_SUBJECT_TYPES).nullable(),
  subjectId: Uuid.nullable(),
  gateKey: z.string().nullable(),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const RecusalDto = z.object({
  userId: Uuid,
  displayName: z.string().nullable(),
  reason: z.string(),
  declaredAt: z.string(),
  /** Who recorded the recusal; `onBehalf` when recorded by someone other than the member (DOM-P2-06). */
  recordedBy: Uuid.nullable(),
  onBehalf: z.boolean(),
});

/** Voting state of the current round (DOM-P2R-01) — computed by the server from attendance, recusals and votes. */
export const VotingStateDto = z.object({
  round: z.number().int(),
  /** Eligible members expected to vote who have not voted yet (meeting: present; circulation: every appointed member). */
  outstandingUserIds: z.array(Uuid),
  outstanding: z.number().int(),
  /** The outcome may be recorded: nobody outstanding, the chair closed voting, or the circulation deadline passed. */
  complete: z.boolean(),
  closed: z.boolean(),
  closedBy: Uuid.nullable(),
  closedAt: z.string().nullable(),
  closeReason: z.string().nullable(),
  /** The committee chair on the meeting date (the only person who may close voting). */
  chairUserId: Uuid.nullable(),
  /** Members of the committee who declared (own declaration) for this item: no conflict / interest declared. */
  declaredUserIds: z.array(Uuid),
});

export const DecisionDetailDto = DecisionSummaryDto.extend({
  /** Subject record with a display label (code / version) when the caller can see it. */
  subject: z.object({ type: z.enum(DECISION_SUBJECT_TYPES), id: Uuid, label: z.string().nullable() }).nullable(),
  /** First submission (the subject is fixed from then on). */
  firstSubmittedAt: z.string().nullable(),
  /** DOM-P2-14: explicit "no supporting evidence" reason; `supportingEvidenceLinks` = active evidence links on the paper. */
  evidenceNoneReason: z.string().nullable(),
  supportingEvidenceLinks: z.number().int(),
  voting: VotingStateDto.nullable(),
  issue: z.string().nullable(),
  whyNow: z.string().nullable(),
  alternatives: z.array(z.object({ title: z.string(), summary: z.string().optional() })),
  recommendation: z.string().nullable(),
  impacts: z.object({ financial: z.string().optional(), operational: z.string().optional(), schedule: z.string().optional() }),
  amount: MoneyOut.nullable(),
  risks: z.string().nullable(),
  dependencies: z.string().nullable(),
  requiredAuthority: z.string().nullable(),
  authorityReason: z.string().nullable(),
  /**
   * `authorityReason` as codes + parameters (QA-P2-04; web: `governance.messages.<code>`) — from the outcome's tally
   * snapshot when it recorded the same reason; null for older outcomes (the client then shows the English sentence).
   */
  authorityReasonI18n: z.array(ServerMessageSchema).nullable(),
  recommendationRecordedBy: Uuid.nullable(),
  externalAuthorityReference: z.string().nullable(),
  /** Verified evidence link (documents module) of the external authority's decision (DOM-P2-12). */
  externalEvidenceLinkId: Uuid.nullable(),
  decidedViaCirculation: z.boolean(),
  outcomeRecordedAt: z.string().nullable(),
  outcomeRecordedBy: Uuid.nullable(),
  /** REQ-GOV-027: label of the approval record (committee outcome or external decision recorded; null before). */
  approvalRecord: ApprovalLabelDto.nullable(),
  tallySnapshot: z.record(z.string(), z.unknown()).nullable(),
  supersededByDecisionId: Uuid.nullable(),
  implementationStartedBy: Uuid.nullable(),
  implementationStartedAt: z.string().nullable(),
  implementationEvidenceNote: z.string().nullable(),
  implementationVerifiedBy: Uuid.nullable(),
  implementationVerifiedAt: z.string().nullable(),
  /** Paper completeness (server rule) — empty when the paper may be submitted. */
  missingFields: z.array(z.string()),
  recusals: z.array(RecusalDto),
  /** Commands allowed by the state machine (the server still checks permissions and guards). */
  allowedCommands: z.array(z.string()),
});

export const VoteDto = z.object({
  id: Uuid,
  userId: Uuid,
  displayName: z.string().nullable(),
  membershipId: Uuid,
  meetingId: Uuid.nullable(),
  round: z.number().int(),
  memberRoleAtVote: z.enum(COMMITTEE_MEMBER_ROLES),
  choice: z.enum(VOTE_CHOICES),
  comment: z.string().nullable(),
  viaCirculation: z.boolean(),
  authorityMatrixVersionId: Uuid.nullable(),
  castAt: z.string(),
});

export const OutcomeResultDto = z.object({
  status: z.enum(DECISION_STATUSES),
  outcome: z.enum(['approve', 'reject', 'tie_escalate']),
  authorityOutcome: z.enum(DECISION_AUTHORITY_OUTCOMES),
  escalatedTo: z.string().nullable(),
  escalationId: Uuid.nullable(),
  explanation: z.string(),
  /** REQ-GOV-027: the recorded outcome is an internal electronic approval record. */
  approvalRecord: ApprovalLabelDto,
  version: z.number().int(),
});

export const ActionDto = z.object({
  id: Uuid,
  code: z.string(),
  title: z.string(),
  decisionId: Uuid.nullable(),
  meetingId: Uuid.nullable(),
  issueId: Uuid.nullable(),
  ownerUserId: Uuid.nullable(),
  ownerName: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(ACTION_ITEM_STATUSES),
  /** Computed in the project timezone. */
  overdue: z.boolean(),
  closureEvidenceNote: z.string().nullable(),
  reportedDoneBy: Uuid.nullable(),
  reportedDoneAt: z.string().nullable(),
  verifiedBy: Uuid.nullable(),
  verifiedAt: z.string().nullable(),
  isDemo: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
});

export const ESCALATION_SOURCE_TYPES = ['decision', 'issue', 'risk', 'action_item', 'meeting', 'gate_definition', 'other'] as const;

export const EscalationDto = z.object({
  id: Uuid,
  code: z.string(),
  title: z.string(),
  sourceType: z.string(),
  sourceId: Uuid.nullable(),
  requestedAction: z.string(),
  /**
   * QA-P5-06: the requested action / routing target of a SYSTEM escalation as codes + parameters when the stored English
   * text was rendered from a known template (the TSA escalation texts, `tsa.*`, as on the TSA page — QA-P34-01b); empty
   * otherwise (text typed by a person is never parsed and is shown as entered).
   */
  requestedActionI18n: z.array(ServerMessageSchema),
  decisionDeadline: z.string().nullable(),
  options: z.array(z.object({ title: z.string(), impact: z.string().optional() })),
  target: z.string().nullable(),
  targetI18n: z.array(ServerMessageSchema),
  raisedToCommitteeId: Uuid.nullable(),
  status: z.enum(ESCALATION_STATUSES),
  resolutionDecisionId: Uuid.nullable(),
  resolutionNote: z.string().nullable(),
  resolvedBy: Uuid.nullable(),
  resolvedAt: z.string().nullable(),
  raisedBy: Uuid.nullable(),
  isSystemGenerated: z.boolean(),
  isDemo: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
});

// ---------------------------------------------------------------------------------------------------------------
// Params & bodies

const CommitteeParams = ProjectParams.extend({ committeeId: Uuid });
const MembershipParams = CommitteeParams.extend({ membershipId: Uuid });
const MatrixParams = CommitteeParams.extend({ versionId: Uuid });
const MeetingParams = ProjectParams.extend({ meetingId: Uuid });
const PackParams = MeetingParams.extend({ packId: Uuid });
const AgendaParams = ProjectParams.extend({ agendaItemId: Uuid });
const DecisionParams = ProjectParams.extend({ decisionId: Uuid });
const ActionParams = ProjectParams.extend({ actionId: Uuid });
const EscalationParams = ProjectParams.extend({ escalationId: Uuid });

const Cmd = z.object({ expectedVersion: ExpectedVersion, note: Text(4000).optional() });
const CmdWithReason = z.object({ expectedVersion: ExpectedVersion, note: RequiredText(4000) });

const paperFields = {
  decisionTypeKey: DecisionTypeKey.nullable().optional(),
  issue: Text(8000).nullable().optional(),
  whyNow: Text(8000).nullable().optional(),
  alternatives: z.array(z.object({ title: RequiredText(300), summary: Text(4000).optional() })).max(20).optional(),
  recommendation: Text(8000).nullable().optional(),
  impacts: z.object({ financial: Text(4000).optional(), operational: Text(4000).optional(), schedule: Text(4000).optional() }).optional(),
  amount: MoneySchema.nullable().optional(),
  risks: Text(8000).nullable().optional(),
  dependencies: Text(8000).nullable().optional(),
  latestSafeDate: IsoDate.nullable().optional(),
  requiredAuthority: Text(500).nullable().optional(),
  classification: ClassificationSchema.optional(),
  gateKey: z.string().trim().max(16).nullable().optional(),
  /**
   * DOM-P2R-03: the record this paper authorizes — both or neither. Set while drafting; fixed from the first submission.
   * An approval of that record can rest only on a decision raised for it.
   */
  subjectType: z.enum(DECISION_SUBJECT_TYPES).nullable().optional(),
  subjectId: Uuid.nullable().optional(),
  /** DOM-P2-14: "no supporting evidence or attachment — reason" (otherwise at least one evidence link on the paper). */
  evidenceNoneReason: Text(2000).nullable().optional(),
};

const subjectPair = <T extends { subjectType?: string | null; subjectId?: string | null }>(b: T, ctx: z.RefinementCtx) => {
  const t = b.subjectType === undefined ? undefined : b.subjectType === null;
  const i = b.subjectId === undefined ? undefined : b.subjectId === null;
  if (t !== i) ctx.addIssue({ code: 'custom', path: ['subjectId'], message: 'subjectType and subjectId are given (or cleared) together' });
};

export const CreateDecisionBody = z.object({ committeeId: Uuid, title: RequiredText(300), ...paperFields }).superRefine(subjectPair);
/** Strict (REQ-DAT-013): an unknown field — `status` included — is refused with 400, never silently dropped. */
export const UpdateDecisionBody = z.object({ expectedVersion: ExpectedVersion, title: RequiredText(300).optional(), ...paperFields }).strict().superRefine(subjectPair);

export const SCREENING_OUTCOMES = ['accept', 'return', 'defer', 'merge', 'reject'] as const;
/**
 * REQ-GOV-012: accept onto a numbered agenda (meeting), return, defer, merge into another request of the same meeting
 * (`mergeIntoAgendaItemId`; the meeting is `meetingId` or the request's own), or reject (screen out). A reason is required
 * for every outcome but accept.
 */
export const ScreenAgendaBody = z
  .object({
    expectedVersion: ExpectedVersion,
    outcome: z.enum(SCREENING_OUTCOMES),
    meetingId: Uuid.optional(),
    mergeIntoAgendaItemId: Uuid.optional(),
    note: Text(2000).optional(),
  })
  .superRefine((b, ctx) => {
    if (b.outcome !== 'accept' && !b.note?.trim()) ctx.addIssue({ code: 'custom', path: ['note'], message: 'A reason is required to return, defer, merge or reject a request' });
    if (b.outcome === 'merge' && !b.mergeIntoAgendaItemId) ctx.addIssue({ code: 'custom', path: ['mergeIntoAgendaItemId'], message: 'Choose the request this one is merged into' });
    if (b.outcome !== 'merge' && b.mergeIntoAgendaItemId) ctx.addIssue({ code: 'custom', path: ['mergeIntoAgendaItemId'], message: 'Only a merge names a target request' });
  });

/** REQ-GOV-009: generate PROPOSED meetings from the charter cadence; the first meeting (date and time) is given by the user. */
export const ProposeMeetingSeriesBody = z.object({
  expectedVersion: ExpectedVersion,
  firstMeetingAt: IsoInstant,
  count: z.number().int().min(1).max(MAX_PROPOSED_MEETINGS),
  title: RequiredText(300),
  location: Text(300).optional(),
});

const listOf = <T extends z.ZodTypeAny>(t: T) => z.object({ items: z.array(t) });

// ---------------------------------------------------------------------------------------------------------------
// Routes

const P = '/api/v1/projects/:projectId';
const tags = ['governance'];

export const governanceRoutes = registerRoutes({
  // ---- Committees ------------------------------------------------------------------------------------------
  listCommittees: defineRoute({
    id: 'governance.listCommittees',
    method: 'GET',
    path: `${P}/committees`,
    summary: 'Committees and boards of the project (program committee, NewCo board, JV board kept distinct)',
    tags,
    access: 'governance.committee.read',
    params: ProjectParams,
    // Default order: kind, then creation.
    query: PageQuery.extend({ kind: z.enum(COMMITTEE_KINDS).optional(), status: z.enum(COMMITTEE_STATUSES).optional(), sort: SortParam(['name', 'kind', 'status', 'createdAt']) }),
    response: paged(CommitteeDto),
  }),
  getCommittee: defineRoute({
    id: 'governance.getCommittee',
    method: 'GET',
    path: `${P}/committees/:committeeId`,
    summary: 'Committee workspace: charter, memberships (history kept), authority matrix in force',
    tags,
    access: 'governance.committee.read',
    params: CommitteeParams,
    response: CommitteeDetailDto,
  }),
  createCommittee: defineRoute({
    id: 'governance.createCommittee',
    method: 'POST',
    path: `${P}/committees`,
    summary: 'Create a committee or board (kind is immutable after creation)',
    tags,
    access: 'governance.committee.manage',
    command: true,
    params: ProjectParams,
    body: z.object({
      kind: z.enum(COMMITTEE_KINDS),
      name: RequiredText(200),
      classification: ClassificationSchema.default('confidential'),
      charter: CharterSchema.default({ cadenceIsProposal: true }),
    }),
    response: VersionResult,
  }),
  updateCharter: defineRoute({
    id: 'governance.updateCharter',
    method: 'POST',
    path: `${P}/committees/:committeeId/charter`,
    summary: 'Save a new charter version (snapshot kept; an approved charter needs re-approval after amendment)',
    tags,
    access: 'governance.committee.manage',
    command: true,
    params: CommitteeParams,
    body: z.object({ expectedVersion: ExpectedVersion, charter: CharterSchema, reason: Text(1000).optional() }),
    response: z.object({ id: Uuid, version: z.number().int(), charterVersionNo: z.number().int() }),
  }),
  listCharterVersions: defineRoute({
    id: 'governance.listCharterVersions',
    method: 'GET',
    path: `${P}/committees/:committeeId/charter/versions`,
    summary: 'Charter version history',
    tags,
    access: 'governance.committee.read',
    params: CommitteeParams,
    response: listOf(CharterVersionDto),
  }),
  approveCharter: defineRoute({
    id: 'governance.approveCharter',
    method: 'POST',
    path: `${P}/committees/:committeeId/charter/approve`,
    summary: 'Approve the current charter version (not by its drafter). Internal electronic approval — not a legal signature',
    tags,
    access: 'governance.charter.approve',
    command: true,
    params: CommitteeParams,
    body: z.object({ expectedVersion: ExpectedVersion, approvalReference: Text(300).optional(), note: Text(2000).optional() }),
    response: z.object({ id: Uuid, version: z.number().int(), status: z.enum(COMMITTEE_STATUSES), charterApprovedVersionNo: z.number().int(), approvalRecord: ApprovalLabelDto }),
  }),
  activateCommittee: defineRoute({
    id: 'governance.activateCommittee',
    method: 'POST',
    path: `${P}/committees/:committeeId/activate`,
    summary: 'Activate a committee whose charter is approved',
    tags,
    access: 'governance.committee.manage',
    command: true,
    params: CommitteeParams,
    body: Cmd,
    response: VersionResult,
  }),
  addMembership: defineRoute({
    id: 'governance.addMembership',
    method: 'POST',
    path: `${P}/committees/:committeeId/memberships`,
    summary: 'Add a committee seat (userId null = "Role — To be confirmed")',
    tags,
    access: 'governance.committee.manage',
    command: true,
    params: CommitteeParams,
    body: z.object({
      userId: Uuid.nullable().default(null),
      roleLabel: RequiredText(200),
      memberRole: z.enum(COMMITTEE_MEMBER_ROLES),
      voting: z.boolean(),
      validFrom: IsoDate,
      validTo: IsoDate.nullable().optional(),
    }),
    response: VersionResult,
  }),
  endMembership: defineRoute({
    id: 'governance.endMembership',
    method: 'POST',
    path: `${P}/committees/:committeeId/memberships/:membershipId/end`,
    summary: 'End a membership term (never deleted; historical attendance and votes unchanged)',
    tags,
    access: 'governance.committee.manage',
    command: true,
    params: MembershipParams,
    body: z.object({ expectedVersion: ExpectedVersion, validTo: IsoDate, reason: RequiredText(1000) }),
    response: VersionResult,
  }),

  // ---- Authority matrix ------------------------------------------------------------------------------------
  listAuthorityMatrixVersions: defineRoute({
    id: 'governance.listAuthorityMatrixVersions',
    method: 'GET',
    path: `${P}/committees/:committeeId/authority-matrix-versions`,
    summary: 'Authority / delegation matrix versions of a committee',
    tags,
    access: 'governance.committee.read',
    params: CommitteeParams,
    response: listOf(AuthorityMatrixVersionDto),
  }),
  createAuthorityMatrixVersion: defineRoute({
    id: 'governance.createAuthorityMatrixVersion',
    method: 'POST',
    path: `${P}/committees/:committeeId/authority-matrix-versions`,
    summary: 'Draft an authority matrix version (validated policy; not in force until approved)',
    tags,
    access: 'governance.authority_matrix.manage',
    command: true,
    params: CommitteeParams,
    body: z.object({ policy: AuthorityPolicySchema, effectiveFrom: IsoDate.optional(), effectiveTo: IsoDate.optional() }),
    response: z.object({ id: Uuid, versionNo: z.number().int(), policyHash: z.string() }),
  }),
  approveAuthorityMatrixVersion: defineRoute({
    id: 'governance.approveAuthorityMatrixVersion',
    method: 'POST',
    path: `${P}/committees/:committeeId/authority-matrix-versions/:versionId/approve`,
    summary:
      'Approve a draft matrix (not by its drafter; demo policies only in demo projects). A non-demo matrix needs the approval record as a document and comes into force (supersedes the previous one) only when a second person verifies it',
    tags,
    access: 'governance.authority_matrix.approve',
    command: true,
    params: MatrixParams,
    body: z.object({ approvalReference: RequiredText(300), approvalDocumentId: Uuid.optional(), effectiveFrom: IsoDate.optional(), note: Text(2000).optional() }),
    response: z.object({ id: Uuid, status: z.enum(AUTHORITY_MATRIX_STATUSES), effectiveFrom: z.string(), supersededIds: z.array(Uuid), pendingVerification: z.boolean(), approvalRecord: ApprovalLabelDto }),
  }),
  verifyAuthorityMatrixApproval: defineRoute({
    id: 'governance.verifyAuthorityMatrixApproval',
    method: 'POST',
    path: `${P}/committees/:committeeId/authority-matrix-versions/:versionId/verify-approval`,
    summary:
      'Verify (accept) or reject the approval evidence of a non-demo matrix — by a second person: not the drafter, not the approver, not the uploader of the approval document. Accept brings the matrix into force',
    tags,
    access: 'documents.evidence.verify',
    command: true,
    params: MatrixParams,
    body: z.object({ decision: z.enum(['accept', 'reject']), note: Text(2000).optional() }),
    response: z.object({ id: Uuid, status: z.enum(AUTHORITY_MATRIX_STATUSES), supersededIds: z.array(Uuid), approvalVerifiedBy: Uuid.nullable() }),
  }),

  // ---- Meetings --------------------------------------------------------------------------------------------
  listMeetings: defineRoute({
    id: 'governance.listMeetings',
    method: 'GET',
    path: `${P}/meetings`,
    summary: 'Meetings and resolutions by circulation',
    tags,
    access: 'governance.meeting.read',
    params: ProjectParams,
    // Default order: latest scheduled first (then number, descending).
    query: PageQuery.extend({
      committeeId: Uuid.optional(),
      status: z.enum(MEETING_STATUSES).optional(),
      isCirculation: z.enum(['true', 'false']).optional(),
      sort: SortParam(['number', 'title', 'scheduledAt', 'status']),
    }),
    response: paged(MeetingDto),
  }),
  getMeeting: defineRoute({
    id: 'governance.getMeeting',
    method: 'GET',
    path: `${P}/meetings/:meetingId`,
    summary: 'Meeting with numbered agenda, attendance, conflict declarations, quorum snapshot and minutes',
    tags,
    access: 'governance.meeting.read',
    params: MeetingParams,
    response: MeetingDetailDto,
  }),
  createMeeting: defineRoute({
    id: 'governance.createMeeting',
    method: 'POST',
    path: `${P}/committees/:committeeId/meetings`,
    summary: 'Schedule a meeting (numbered sequentially per committee)',
    tags,
    access: 'governance.meeting.manage',
    command: true,
    params: CommitteeParams,
    body: z.object({ title: RequiredText(300), scheduledAt: IsoInstant, location: Text(300).optional() }),
    response: z.object({ id: Uuid, number: z.number().int(), version: z.number().int() }),
  }),
  proposeMeetingSeries: defineRoute({
    id: 'governance.proposeMeetingSeries',
    method: 'POST',
    path: `${P}/committees/:committeeId/cadence/proposed-meetings`,
    summary:
      'Generate a series of PROPOSED meetings from the charter cadence and the first meeting given by the secretariat (never scheduled or published automatically; idempotent — a slot that already has a meeting is skipped)',
    tags,
    access: 'governance.meeting.manage',
    command: true,
    params: CommitteeParams,
    body: ProposeMeetingSeriesBody,
    response: z.object({
      frequency: z.enum(CADENCE_FREQUENCIES),
      charterVersionNo: z.number().int(),
      created: z.array(z.object({ id: Uuid, number: z.number().int(), scheduledAt: z.string(), localDate: z.string(), nonWorkingDay: z.boolean() })),
      skipped: z.array(z.object({ scheduledAt: z.string(), localDate: z.string(), existingMeetingId: Uuid })),
    }),
  }),
  confirmMeeting: defineRoute({
    id: 'governance.confirmMeeting',
    method: 'POST',
    path: `${P}/meetings/:meetingId/confirm`,
    summary: 'Confirm a proposed (cadence-generated) meeting into the schedule (Proposed → Planned)',
    tags,
    access: 'governance.meeting.manage',
    command: true,
    params: MeetingParams,
    body: Cmd,
    response: VersionResult,
  }),
  publishAgenda: defineRoute({
    id: 'governance.publishAgenda',
    method: 'POST',
    path: `${P}/meetings/:meetingId/publish-agenda`,
    summary: 'Publish the numbered agenda',
    tags,
    access: 'governance.meeting.manage',
    command: true,
    params: MeetingParams,
    body: Cmd,
    response: VersionResult,
  }),
  startSession: defineRoute({
    id: 'governance.startSession',
    method: 'POST',
    path: `${P}/meetings/:meetingId/start`,
    summary: 'Open the session (attendance, conflicts, votes)',
    tags,
    access: 'governance.meeting.manage',
    command: true,
    params: MeetingParams,
    body: Cmd,
    response: VersionResult,
  }),
  closeSession: defineRoute({
    id: 'governance.closeSession',
    method: 'POST',
    path: `${P}/meetings/:meetingId/close`,
    summary: 'Close the session',
    tags,
    access: 'governance.meeting.manage',
    command: true,
    params: MeetingParams,
    body: Cmd,
    response: VersionResult,
  }),
  cancelMeeting: defineRoute({
    id: 'governance.cancelMeeting',
    method: 'POST',
    path: `${P}/meetings/:meetingId/cancel`,
    summary: 'Cancel a proposed or planned meeting (reason required)',
    tags,
    access: 'governance.meeting.manage',
    command: true,
    params: MeetingParams,
    body: CmdWithReason,
    response: VersionResult,
  }),
  recordAttendance: defineRoute({
    id: 'governance.recordAttendance',
    method: 'POST',
    path: `${P}/meetings/:meetingId/attendance`,
    summary: 'Record attendance of active members (only while the session is open; frozen while votes of an open round exist at the meeting)',
    tags,
    access: 'governance.meeting.manage',
    command: true,
    params: MeetingParams,
    body: z.object({ entries: z.array(z.object({ membershipId: Uuid, status: z.enum(ATTENDANCE_STATUSES) })).min(1).max(100) }),
    response: listOf(AttendanceDto),
  }),
  declareConflict: defineRoute({
    id: 'governance.declareConflict',
    method: 'POST',
    path: `${P}/meetings/:meetingId/conflicts`,
    summary: 'Declare no conflict / an interest / a recusal (own: conflict.declare; on behalf: meeting.manage)',
    tags,
    access: 'governance.meeting.read',
    command: true,
    params: MeetingParams,
    body: z.object({
      userId: Uuid.optional(),
      decisionId: Uuid.optional(),
      declaration: z.enum(['no_conflict', 'interest_declared', 'recused']),
      description: Text(2000).optional(),
    }),
    response: z.object({ id: Uuid, recusalRecorded: z.boolean() }),
  }),
  quorumCheck: defineRoute({
    id: 'governance.quorumCheck',
    method: 'POST',
    path: `${P}/meetings/:meetingId/quorum-check`,
    summary: 'Compute and record the meeting quorum from attendance and the approved matrix (server-side only)',
    tags,
    access: 'governance.meeting.manage',
    command: true,
    params: MeetingParams,
    body: z.object({ expectedVersion: ExpectedVersion }),
    response: z.object({ quorum: QuorumDto, version: z.number().int() }),
  }),
  draftMinutes: defineRoute({
    id: 'governance.draftMinutes',
    method: 'POST',
    path: `${P}/meetings/:meetingId/minutes`,
    summary: 'Draft minutes (a correction of approved minutes creates a new version with a reason)',
    tags,
    access: 'governance.minutes.draft',
    command: true,
    params: MeetingParams,
    body: z.object({ expectedVersion: ExpectedVersion, text: RequiredText(50000), reason: Text(1000).optional() }),
    response: VersionResult,
  }),
  approveMinutes: defineRoute({
    id: 'governance.approveMinutes',
    method: 'POST',
    path: `${P}/meetings/:meetingId/minutes/approve`,
    summary: 'Approve minutes (not by their drafter). Internal electronic approval — not a legal signature',
    tags,
    access: 'governance.minutes.approve',
    command: true,
    params: MeetingParams,
    body: Cmd,
    response: VersionResult.extend({ approvalRecord: ApprovalLabelDto }),
  }),
  freezePack: defineRoute({
    id: 'governance.freezePack',
    method: 'POST',
    path: `${P}/meetings/:meetingId/packs`,
    summary: 'Freeze the meeting pack as an immutable snapshot (re-freezing creates a new version)',
    tags,
    access: 'governance.meeting.manage',
    command: true,
    params: MeetingParams,
    body: Cmd,
    response: z.object({ id: Uuid, contentHash: z.string(), previousSnapshotId: Uuid.nullable(), version: z.number().int() }),
  }),
  listPacks: defineRoute({
    id: 'governance.listPacks',
    method: 'GET',
    path: `${P}/meetings/:meetingId/packs`,
    summary: 'Frozen pack versions of a meeting (visible to cleared readers only)',
    tags,
    access: 'governance.meeting.read',
    params: MeetingParams,
    response: listOf(PackSummaryDto),
  }),
  getPack: defineRoute({
    id: 'governance.getPack',
    method: 'GET',
    path: `${P}/meetings/:meetingId/packs/:packId`,
    summary: 'A frozen meeting pack',
    tags,
    access: 'governance.meeting.read',
    params: PackParams,
    response: PackDto,
  }),

  // ---- Agenda requests -------------------------------------------------------------------------------------
  listAgendaRequests: defineRoute({
    id: 'governance.listAgendaRequests',
    method: 'GET',
    path: `${P}/agenda-requests`,
    summary: 'Agenda requests and their screening status',
    tags,
    access: 'governance.meeting.read',
    params: ProjectParams,
    // Default order: newest request first.
    query: PageQuery.extend({
      committeeId: Uuid.optional(),
      meetingId: Uuid.optional(),
      screeningStatus: z.enum(AGENDA_SCREENING_STATUSES).optional(),
      sort: SortParam(['number', 'title', 'screeningStatus', 'createdAt']),
    }),
    response: paged(AgendaItemDto),
  }),
  createAgendaRequest: defineRoute({
    id: 'governance.createAgendaRequest',
    method: 'POST',
    path: `${P}/agenda-requests`,
    summary: 'Request an agenda item (optionally linked to a decision paper and a preferred meeting)',
    tags,
    access: 'governance.agenda_request.create',
    command: true,
    params: ProjectParams,
    body: z.object({
      committeeId: Uuid,
      title: RequiredText(300),
      kind: z.enum(AGENDA_ITEM_KINDS),
      decisionId: Uuid.optional(),
      meetingId: Uuid.optional(),
      presenterUserId: Uuid.optional(),
    }),
    response: VersionResult,
  }),
  screenAgendaRequest: defineRoute({
    id: 'governance.screenAgendaRequest',
    method: 'POST',
    path: `${P}/agenda-requests/:agendaItemId/screen`,
    summary: 'Secretariat screening: accept onto a numbered agenda, return, defer, merge into another request of the same meeting, or reject — with a reason except for accept (not by the requester)',
    tags,
    access: 'governance.agenda_request.screen',
    command: true,
    params: AgendaParams,
    body: ScreenAgendaBody,
    response: z.object({ id: Uuid, screeningStatus: z.enum(AGENDA_SCREENING_STATUSES), number: z.number().int().nullable(), mergedIntoAgendaItemId: Uuid.nullable(), version: z.number().int() }),
  }),

  // ---- Decisions -------------------------------------------------------------------------------------------
  listDecisions: defineRoute({
    id: 'governance.listDecisions',
    method: 'GET',
    path: `${P}/decisions`,
    summary: 'Decision register (visible classifications only; totals in scope)',
    tags,
    access: 'governance.decision.read',
    params: ProjectParams,
    // Default order: newest first. `status` sorts in lifecycle (enum) order.
    query: PageQuery.extend({
      committeeId: Uuid.optional(),
      meetingId: Uuid.optional(),
      status: z.enum(DECISION_STATUSES).optional(),
      authorityOutcome: z.enum(DECISION_AUTHORITY_OUTCOMES).optional(),
      /** Decisions raised for one record (DOM-P2R-03 — the approval pickers offer only matching decisions). */
      subjectType: z.enum(DECISION_SUBJECT_TYPES).optional(),
      subjectId: Uuid.optional(),
      decisionTypeKey: DecisionTypeKey.optional(),
      gateKey: z.string().trim().regex(/^[A-Za-z0-9_-]{1,16}$/, 'gate key').optional(),
      sort: SortParam(['code', 'title', 'status', 'latestSafeDate', 'createdAt', 'updatedAt']),
    }),
    response: paged(DecisionSummaryDto),
  }),
  getDecision: defineRoute({
    id: 'governance.getDecision',
    method: 'GET',
    path: `${P}/decisions/:decisionId`,
    summary: 'Decision paper, state, recusals, tally snapshot and allowed commands',
    tags,
    access: 'governance.decision.read',
    params: DecisionParams,
    response: DecisionDetailDto,
  }),
  createDecision: defineRoute({
    id: 'governance.createDecision',
    method: 'POST',
    path: `${P}/decisions`,
    summary: 'Draft a decision paper (the caller is the requester)',
    tags,
    access: 'governance.decision.draft',
    command: true,
    params: ProjectParams,
    body: CreateDecisionBody,
    response: z.object({ id: Uuid, code: z.string(), version: z.number().int() }),
  }),
  updateDecision: defineRoute({
    id: 'governance.updateDecision',
    method: 'PATCH',
    path: `${P}/decisions/:decisionId`,
    summary: 'Edit a draft decision paper (descriptive fields only; never the status)',
    tags,
    access: 'governance.decision.draft',
    params: DecisionParams,
    body: UpdateDecisionBody,
    response: VersionResult,
  }),
  submitDecision: defineRoute({
    id: 'governance.submitDecision',
    method: 'POST',
    path: `${P}/decisions/:decisionId/submit`,
    summary: 'Submit a complete decision paper (422 lists missing fields)',
    tags,
    access: 'governance.decision.submit',
    command: true,
    params: DecisionParams,
    body: Cmd,
    response: VersionResult,
  }),
  startReview: defineRoute({
    id: 'governance.startReview',
    method: 'POST',
    path: `${P}/decisions/:decisionId/start-review`,
    summary: 'Secretariat accepts the paper for deliberation (optionally tabled at a meeting); not by the requester',
    tags,
    access: 'governance.decision.review',
    command: true,
    params: DecisionParams,
    body: z.object({ expectedVersion: ExpectedVersion, meetingId: Uuid.optional(), note: Text(2000).optional() }),
    response: VersionResult,
  }),
  returnToDraft: defineRoute({
    id: 'governance.returnToDraft',
    method: 'POST',
    path: `${P}/decisions/:decisionId/return`,
    summary: 'Return a paper to Draft with reasons (opens a new voting round if votes existed)',
    tags,
    access: 'governance.decision.review',
    command: true,
    params: DecisionParams,
    body: CmdWithReason,
    response: VersionResult,
  }),
  declareRecusal: defineRoute({
    id: 'governance.declareRecusal',
    method: 'POST',
    path: `${P}/decisions/:decisionId/recusals`,
    summary:
      'Record a recusal (own: conflict.declare; on behalf: meeting.manage, reason required). Refused once the member voted in the current round (restart the round instead). Recused members neither vote nor count to quorum',
    tags,
    access: 'governance.decision.read',
    command: true,
    params: DecisionParams,
    body: z.object({ userId: Uuid.optional(), reason: RequiredText(2000) }),
    response: z.object({ ok: z.literal(true) }),
  }),
  listVotes: defineRoute({
    id: 'governance.listVotes',
    method: 'GET',
    path: `${P}/decisions/:decisionId/votes`,
    summary: 'Immutable vote records (all rounds)',
    tags,
    access: 'governance.decision.read',
    params: DecisionParams,
    response: listOf(VoteDto),
  }),
  castVote: defineRoute({
    id: 'governance.castVote',
    method: 'POST',
    path: `${P}/decisions/:decisionId/votes`,
    summary:
      'Cast a vote (active voting member, present, quorum present, not recused, not the requester, own conflict-of-interest declaration for the item recorded — or given now as "no conflict" — and voting not closed by the chair)',
    tags,
    access: 'governance.decision.vote',
    command: true,
    params: DecisionParams,
    body: z.object({
      expectedVersion: ExpectedVersion,
      choice: z.enum(VOTE_CHOICES),
      comment: Text(2000).optional(),
      /**
       * REQ-GOV-015: the voter's own declaration for this item, recorded (append-only, audited) just before the vote in the
       * same transaction. A conflict is not declared here: the member recuses instead (recusal command). Not needed when the
       * member already declared for the item.
       */
      conflictDeclaration: z.literal('no_conflict').optional(),
    }),
    response: z.object({ id: Uuid, round: z.number().int() }),
  }),
  closeVoting: defineRoute({
    id: 'governance.closeVoting',
    method: 'POST',
    path: `${P}/decisions/:decisionId/close-voting`,
    summary:
      "Close voting on the current round (the committee's chair only, with a reason; DOM-P2R-01). Members who have not voted are listed in the tally snapshot and not counted; no further vote is accepted in the round",
    tags,
    access: 'governance.decision.record_outcome',
    command: true,
    params: DecisionParams,
    body: z.object({ expectedVersion: ExpectedVersion, reason: RequiredText(2000) }),
    response: z.object({ id: Uuid, version: z.number().int(), round: z.number().int(), notVoted: z.number().int() }),
  }),
  initiateCirculation: defineRoute({
    id: 'governance.initiateCirculation',
    method: 'POST',
    path: `${P}/decisions/:decisionId/circulate`,
    summary: 'Start a resolution by circulation (frozen paper, response deadline)',
    tags,
    access: 'governance.circulation.initiate',
    command: true,
    params: DecisionParams,
    body: z.object({ expectedVersion: ExpectedVersion, responseDeadline: IsoDate, note: Text(2000).optional() }),
    response: z.object({ meetingId: Uuid, number: z.number().int(), packSnapshotId: Uuid, version: z.number().int() }),
  }),
  recordOutcome: defineRoute({
    id: 'governance.recordOutcome',
    method: 'POST',
    path: `${P}/decisions/:decisionId/record-outcome`,
    summary: 'Record the outcome from the server-computed quorum, tally and authority check (AT-04, AT-05)',
    tags,
    access: 'governance.decision.record_outcome',
    command: true,
    params: DecisionParams,
    body: Cmd,
    response: OutcomeResultDto,
  }),
  recordExternalApproval: defineRoute({
    id: 'governance.recordExternalApproval',
    method: 'POST',
    path: `${P}/decisions/:decisionId/record-external-approval`,
    summary:
      'Record the external authority decision on a recommendation (reference and a verified evidence link on the decision required; not by the recommendation recorder, not by the evidence verifier)',
    tags,
    access: 'governance.decision.record_external_approval',
    command: true,
    params: DecisionParams,
    body: z.object({
      expectedVersion: ExpectedVersion,
      externalReference: Text(500).optional(),
      /** Evidence link (documents module) on this decision, verified by a second person (DOM-P2-12). */
      evidenceLinkId: Uuid.optional(),
      outcome: z.enum(['approved', 'rejected']).default('approved'),
      note: Text(2000).optional(),
    }),
    response: z.object({ id: Uuid, status: z.enum(DECISION_STATUSES), version: z.number().int(), approvalRecord: ApprovalLabelDto }),
  }),
  deferDecision: defineRoute({
    id: 'governance.deferDecision',
    method: 'POST',
    path: `${P}/decisions/:decisionId/defer`,
    summary: 'Defer a decision (reason required)',
    tags,
    access: 'governance.decision.record_outcome',
    command: true,
    params: DecisionParams,
    body: z.object({ expectedVersion: ExpectedVersion, note: RequiredText(2000), revisitDate: IsoDate.optional() }),
    response: VersionResult,
  }),
  resumeDecision: defineRoute({
    id: 'governance.resumeDecision',
    method: 'POST',
    path: `${P}/decisions/:decisionId/resume`,
    summary: 'Re-table a deferred decision (new voting round)',
    tags,
    access: 'governance.decision.review',
    command: true,
    params: DecisionParams,
    body: z.object({ expectedVersion: ExpectedVersion, meetingId: Uuid.optional(), note: Text(2000).optional() }),
    response: z.object({ id: Uuid, version: z.number().int(), voteRound: z.number().int() }),
  }),
  supersedeDecision: defineRoute({
    id: 'governance.supersedeDecision',
    method: 'POST',
    path: `${P}/decisions/:decisionId/supersede`,
    summary: 'Mark a decision superseded by an approved decision of the same project',
    tags,
    access: 'governance.decision.record_outcome',
    command: true,
    params: DecisionParams,
    body: z.object({ expectedVersion: ExpectedVersion, supersededByDecisionId: Uuid, note: RequiredText(2000) }),
    response: VersionResult,
  }),
  startImplementation: defineRoute({
    id: 'governance.startImplementation',
    method: 'POST',
    path: `${P}/decisions/:decisionId/start-implementation`,
    summary: 'Start implementation tracking of an approved decision (needs an owned, dated action)',
    tags,
    access: 'governance.action.manage',
    command: true,
    params: DecisionParams,
    body: Cmd,
    response: VersionResult,
  }),
  verifyImplementation: defineRoute({
    id: 'governance.verifyImplementation',
    method: 'POST',
    path: `${P}/decisions/:decisionId/verify-implementation`,
    summary: 'Verify implementation with evidence (actions verified closed; not by the person who started tracking)',
    tags,
    access: 'governance.decision.verify_implementation',
    command: true,
    params: DecisionParams,
    body: z.object({ expectedVersion: ExpectedVersion, evidenceNote: Text(4000).optional() }),
    response: VersionResult,
  }),

  // ---- Actions ---------------------------------------------------------------------------------------------
  listActions: defineRoute({
    id: 'governance.listActions',
    method: 'GET',
    path: `${P}/actions`,
    summary: 'Committee actions (overdue computed in the project timezone)',
    tags,
    access: 'governance.decision.read',
    params: ProjectParams,
    // Default order: newest first.
    query: PageQuery.extend({
      status: z.enum(ACTION_ITEM_STATUSES).optional(),
      decisionId: Uuid.optional(),
      meetingId: Uuid.optional(),
      ownerUserId: Uuid.optional(),
      overdue: z.enum(['true', 'false']).optional(),
      sort: SortParam(['code', 'title', 'dueDate', 'status', 'createdAt']),
    }),
    response: paged(ActionDto),
  }),
  getAction: defineRoute({
    id: 'governance.getAction',
    method: 'GET',
    path: `${P}/actions/:actionId`,
    summary: 'A committee action',
    tags,
    access: 'governance.decision.read',
    params: ActionParams,
    response: ActionDto,
  }),
  createAction: defineRoute({
    id: 'governance.createAction',
    method: 'POST',
    path: `${P}/actions`,
    summary: 'Create an action with one accountable owner and a due date (linked to decision / meeting / issue)',
    tags,
    access: 'governance.action.manage',
    command: true,
    params: ProjectParams,
    body: z.object({
      title: RequiredText(300),
      decisionId: Uuid.optional(),
      meetingId: Uuid.optional(),
      issueId: Uuid.optional(),
      ownerUserId: Uuid,
      dueDate: IsoDate,
    }),
    response: z.object({ id: Uuid, code: z.string(), version: z.number().int() }),
  }),
  updateAction: defineRoute({
    id: 'governance.updateAction',
    method: 'PATCH',
    path: `${P}/actions/:actionId`,
    summary: 'Re-title, re-assign or re-date an open action (versioned; never the status)',
    tags,
    access: 'governance.action.manage',
    params: ActionParams,
    body: z
      .object({
        expectedVersion: ExpectedVersion,
        title: RequiredText(300).optional(),
        ownerUserId: Uuid.optional(),
        dueDate: IsoDate.optional(),
        reason: Text(1000).optional(),
      })
      .strict(),
    response: VersionResult,
  }),
  startAction: defineRoute({
    id: 'governance.startAction',
    method: 'POST',
    path: `${P}/actions/:actionId/start`,
    summary: 'Owner starts the action',
    tags,
    access: 'governance.action.update',
    command: true,
    params: ActionParams,
    body: Cmd,
    response: VersionResult,
  }),
  reportActionDone: defineRoute({
    id: 'governance.reportActionDone',
    method: 'POST',
    path: `${P}/actions/:actionId/report-done`,
    summary: 'Owner reports the action done with closure evidence',
    tags,
    access: 'governance.action.update',
    command: true,
    params: ActionParams,
    body: z.object({ expectedVersion: ExpectedVersion, closureEvidenceNote: Text(4000).optional() }),
    response: VersionResult,
  }),
  verifyActionClosure: defineRoute({
    id: 'governance.verifyActionClosure',
    method: 'POST',
    path: `${P}/actions/:actionId/verify-closure`,
    summary: 'Verify closure (not by the reporter or the owner)',
    tags,
    access: 'governance.action.verify_closure',
    command: true,
    params: ActionParams,
    body: Cmd,
    response: VersionResult,
  }),
  rejectActionClosure: defineRoute({
    id: 'governance.rejectActionClosure',
    method: 'POST',
    path: `${P}/actions/:actionId/reject-closure`,
    summary: 'Return an action whose closure evidence is insufficient',
    tags,
    access: 'governance.action.verify_closure',
    command: true,
    params: ActionParams,
    body: CmdWithReason,
    response: VersionResult,
  }),
  cancelAction: defineRoute({
    id: 'governance.cancelAction',
    method: 'POST',
    path: `${P}/actions/:actionId/cancel`,
    summary: 'Cancel an action (reason required; never counted as complete)',
    tags,
    access: 'governance.action.manage',
    command: true,
    params: ActionParams,
    body: CmdWithReason,
    response: VersionResult,
  }),

  // ---- Escalations -----------------------------------------------------------------------------------------
  listEscalations: defineRoute({
    id: 'governance.listEscalations',
    method: 'GET',
    path: `${P}/escalations`,
    summary: 'Escalations with requested action, decision deadline and options',
    tags,
    access: 'governance.decision.read',
    params: ProjectParams,
    // Default order: newest first.
    query: PageQuery.extend({
      status: z.enum(ESCALATION_STATUSES).optional(),
      /** `true` = still awaiting a resolution (open or decision requested) — the Committee Hub tile's filter (REQ-UX-024). */
      unresolved: z.enum(['true', 'false']).optional(),
      sourceType: z.enum(ESCALATION_SOURCE_TYPES).optional(),
      sourceId: Uuid.optional(),
      sort: SortParam(['code', 'title', 'decisionDeadline', 'status', 'createdAt']),
    }),
    response: paged(EscalationDto),
  }),
  getEscalation: defineRoute({
    id: 'governance.getEscalation',
    method: 'GET',
    path: `${P}/escalations/:escalationId`,
    summary: 'An escalation',
    tags,
    access: 'governance.decision.read',
    params: EscalationParams,
    response: EscalationDto,
  }),
  raiseEscalation: defineRoute({
    id: 'governance.raiseEscalation',
    method: 'POST',
    path: `${P}/escalations`,
    summary: 'Raise an escalation (requested action, decision deadline and at least one option are required)',
    tags,
    access: 'governance.escalation.raise',
    command: true,
    params: ProjectParams,
    body: z.object({
      title: RequiredText(300),
      sourceType: z.enum(ESCALATION_SOURCE_TYPES),
      sourceId: Uuid.optional(),
      requestedAction: RequiredText(2000),
      decisionDeadline: IsoDate,
      options: z.array(z.object({ title: RequiredText(300), impact: Text(2000).optional() })).min(1).max(10),
      target: Text(300).optional(),
      raisedToCommitteeId: Uuid.optional(),
    }),
    response: z.object({ id: Uuid, code: z.string(), version: z.number().int() }),
  }),
  resolveEscalation: defineRoute({
    id: 'governance.resolveEscalation',
    method: 'POST',
    path: `${P}/escalations/:escalationId/resolve`,
    summary: 'Resolve an escalation (optionally linked to the resolving decision; not by the person who raised it)',
    tags,
    access: 'governance.decision.record_outcome',
    command: true,
    params: EscalationParams,
    body: z.object({ expectedVersion: ExpectedVersion, resolutionDecisionId: Uuid.optional(), note: RequiredText(2000) }),
    response: VersionResult,
  }),
});

