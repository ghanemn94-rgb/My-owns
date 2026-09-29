import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  AuthorityPolicy,
  COMMITTEE_KINDS,
  COMMITTEE_STATUSES,
  Classification,
  CommitteeMemberRole,
  assertMembershipSeat,
  conflict,
  isMemberActiveOn,
  matrixUsable,
  notFound,
  ruleViolation,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { RecordVersionService, assertVersion, loadInProject, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { newId, payloadHash } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';
import { CommitteeRow, GovernanceSupport, MatrixRow, MembershipRow, ProjectInfo, iso } from './governance.support';
import { likeContains } from '../../platform/helpers';

type CommitteeKind = (typeof COMMITTEE_KINDS)[number];
type CommitteeStatus = (typeof COMMITTEE_STATUSES)[number];
type Charter = CommitteeRow['charter'];

const CHARTER_ENTITY = 'committee_charter';

/** Committees / boards, charter versions, memberships and authority-matrix versions (spec §4, §4.1). */
@Injectable()
export class CommitteesService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly versions: RecordVersionService,
    private readonly sup: GovernanceSupport,
  ) {}

  // ---------------------------------------------------------------------------------------------------------
  // Reads

  async list(ctx: RequestContext, projectId: string, q: { page: number; pageSize: number; q?: string; kind?: CommitteeKind; status?: CommitteeStatus }) {
    const tx = this.db.tx();
    const t = schema.committee;
    const where = and(
      eq(t.projectId, projectId),
      this.policy.visibilitySql(ctx, projectId, { classification: t.classification }),
      q.kind ? eq(t.kind, q.kind) : undefined,
      q.status ? eq(t.status, q.status) : undefined,
      q.q ? ilike(t.name, likeContains(q.q)) : undefined,
    );
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const rows = await tx.select().from(t).where(where).orderBy(asc(t.kind), asc(t.createdAt)).limit(q.pageSize).offset(offsetOf(q));
    const p = await this.sup.project(projectId);
    const items = [];
    for (const c of rows) items.push(await this.summary(c, p));
    return pageOf(items, Number(total), q);
  }

  async get(ctx: RequestContext, projectId: string, committeeId: string) {
    const c = await this.sup.committee(ctx, projectId, committeeId);
    const p = await this.sup.project(projectId);
    const today = this.sup.today(p);
    const members = await this.sup.memberships(c.id);
    const names = await this.sup.displayNames(members.map((m) => m.userId));
    return {
      ...(await this.summary(c, p)),
      charter: c.charter,
      charterApprovedBy: c.charterApprovedBy,
      memberships: members.map((m) => this.membershipDto(m, names, today)),
    };
  }

  async charterVersions(ctx: RequestContext, projectId: string, committeeId: string) {
    const c = await this.sup.committee(ctx, projectId, committeeId);
    const rows = await this.versions.history(CHARTER_ENTITY, c.id);
    return {
      items: rows.map((r) => ({
        versionNo: r.versionNo,
        charter: r.snapshot,
        reason: r.reason,
        changedBy: r.changedBy,
        changedAt: r.changedAt.toISOString(),
        approved: c.charterApprovedVersionNo !== null && r.versionNo <= c.charterApprovedVersionNo,
      })),
    };
  }

  async listMatrices(ctx: RequestContext, projectId: string, committeeId: string) {
    const c = await this.sup.committee(ctx, projectId, committeeId);
    const rows = await this.db.tx().select().from(schema.authorityMatrixVersion).where(eq(schema.authorityMatrixVersion.committeeId, c.id)).orderBy(desc(schema.authorityMatrixVersion.versionNo));
    return { items: rows.map((m) => this.matrixDto(m)) };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Committee commands

  async create(ctx: RequestContext, projectId: string, body: { kind: CommitteeKind; name: string; classification: Classification; charter: Charter }) {
    this.policy.assert(ctx, 'governance.committee.manage', { projectId, classification: body.classification });
    const p = await this.sup.project(projectId);
    const [proj] = await this.db.tx().select({ programId: schema.project.programId }).from(schema.project).where(eq(schema.project.id, projectId));
    const id = newId();
    const charter = cleanCharter(body.charter);
    await this.db
      .tx()
      .insert(schema.committee)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        programId: proj?.programId ?? null,
        kind: body.kind,
        name: body.name,
        status: 'draft',
        charter,
        charterVersionNo: 1,
        classification: body.classification,
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      });
    await this.versions.snapshot({ projectId, entityType: CHARTER_ENTITY, entityId: id, versionNo: 1, snapshot: charter, reason: 'Initial draft' });
    await this.audit.record({ action: 'governance.committee.create', entityType: 'committee', entityId: id, projectId, after: { kind: body.kind, name: body.name, classification: body.classification } });
    return { id, version: 1 };
  }

  async updateCharter(ctx: RequestContext, projectId: string, committeeId: string, body: { expectedVersion: number; charter: Charter; reason?: string }) {
    const c = await this.sup.committee(ctx, projectId, committeeId, 'governance.committee.manage');
    if (c.status === 'dissolved') throw ruleViolation('governance.committee.dissolved', 'The committee is dissolved');
    assertVersion(c, body.expectedVersion, 'committee');
    const charter = cleanCharter(body.charter);
    const charterVersionNo = c.charterVersionNo + 1;
    const row = await updateVersioned(this.db, schema.committee, { id: c.id, projectId, expectedVersion: body.expectedVersion }, { charter, charterVersionNo });
    await this.versions.snapshot({ projectId, entityType: CHARTER_ENTITY, entityId: c.id, versionNo: charterVersionNo, snapshot: charter, reason: body.reason });
    await this.audit.record({
      action: 'governance.committee.update_charter',
      entityType: 'committee',
      entityId: c.id,
      projectId,
      before: { charterVersionNo: c.charterVersionNo },
      after: { charterVersionNo, pendingApproval: true },
      reason: body.reason ?? null,
    });
    return { id: c.id, version: row['version'] as number, charterVersionNo };
  }

  async approveCharter(ctx: RequestContext, projectId: string, committeeId: string, body: { expectedVersion: number; approvalReference?: string; note?: string }) {
    const c = await loadInProject(this.db, schema.committee, projectId, committeeId);
    const drafter = await this.charterDrafter(c);
    this.policy.assert(ctx, 'governance.charter.approve', { projectId, classification: c.classification, requesterUserId: drafter });
    if (c.status === 'dissolved') throw ruleViolation('governance.committee.dissolved', 'The committee is dissolved');
    assertVersion(c, body.expectedVersion, 'committee');
    if (c.charterApprovedVersionNo === c.charterVersionNo) {
      throw ruleViolation('governance.charter.already_approved', `Charter version ${c.charterVersionNo} is already approved`);
    }
    const status: CommitteeStatus = c.status === 'draft' ? 'charter_approved' : c.status;
    const row = await updateVersioned(
      this.db,
      schema.committee,
      { id: c.id, projectId, expectedVersion: body.expectedVersion },
      { status, charterApprovedVersionNo: c.charterVersionNo, charterApprovedBy: ctx.principal.userId, charterApprovedAt: new Date() },
    );
    await this.audit.record({
      action: 'governance.charter.approve',
      entityType: 'committee',
      entityId: c.id,
      projectId,
      before: { status: c.status, charterApprovedVersionNo: c.charterApprovedVersionNo },
      after: { status, charterApprovedVersionNo: c.charterVersionNo, approvalReference: body.approvalReference ?? null, method: 'internal_electronic_approval' },
      reason: body.note ?? null,
    });
    return { id: c.id, version: row['version'] as number, status, charterApprovedVersionNo: c.charterVersionNo };
  }

  async activate(ctx: RequestContext, projectId: string, committeeId: string, body: { expectedVersion: number; note?: string }) {
    const c = await this.sup.committee(ctx, projectId, committeeId, 'governance.committee.manage');
    assertVersion(c, body.expectedVersion, 'committee');
    if (c.status !== 'charter_approved' || c.charterApprovedVersionNo === null) {
      throw ruleViolation('governance.committee.invalid_transition', `Only a committee with an approved charter can be activated (current: ${c.status})`);
    }
    const row = await updateVersioned(this.db, schema.committee, { id: c.id, projectId, expectedVersion: body.expectedVersion }, { status: 'active' });
    await this.audit.record({ action: 'governance.committee.activate', entityType: 'committee', entityId: c.id, projectId, before: { status: c.status }, after: { status: 'active' }, reason: body.note ?? null });
    return { id: c.id, version: row['version'] as number };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Memberships (history preserved: memberships are ended, never deleted)

  async addMembership(
    ctx: RequestContext,
    projectId: string,
    committeeId: string,
    body: { userId: string | null; roleLabel: string; memberRole: CommitteeMemberRole; voting: boolean; validFrom: string; validTo?: string | null },
  ) {
    const c = await this.sup.committee(ctx, projectId, committeeId, 'governance.committee.manage');
    if (c.status === 'dissolved') throw ruleViolation('governance.committee.dissolved', 'The committee is dissolved');
    assertMembershipSeat({ memberRole: body.memberRole, voting: body.voting, validFrom: body.validFrom, validTo: body.validTo ?? null });
    const existing = await this.sup.memberships(c.id);
    const overlaps = (m: MembershipRow) => m.validFrom <= (body.validTo ?? '9999-12-31') && (m.validTo ?? '9999-12-31') >= body.validFrom;
    if (body.userId) {
      const [u] = await this.db
        .tx()
        .select({ id: schema.appUser.id })
        .from(schema.appUser)
        .where(and(eq(schema.appUser.id, body.userId), eq(schema.appUser.isActive, true), eq(schema.appUser.isServiceAccount, false)));
      if (!u) throw ruleViolation('governance.membership.user_not_found', 'User not found or inactive');
      if (existing.some((m) => m.userId === body.userId && overlaps(m))) {
        throw ruleViolation('governance.membership.duplicate', 'This person already holds a seat on the committee for an overlapping period');
      }
      if (body.memberRole === 'chair' && existing.some((m) => m.memberRole === 'chair' && m.userId && overlaps(m))) {
        throw ruleViolation('governance.membership.chair_exists', 'The committee already has a chair for an overlapping period');
      }
    }
    const id = newId();
    await this.db
      .tx()
      .insert(schema.committeeMembership)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        committeeId: c.id,
        userId: body.userId,
        roleLabel: body.roleLabel,
        memberRole: body.memberRole,
        voting: body.voting,
        validFrom: body.validFrom,
        validTo: body.validTo ?? null,
        createdBy: ctx.principal.userId,
      });
    await this.audit.record({
      action: 'governance.committee.add_membership',
      entityType: 'committee_membership',
      entityId: id,
      projectId,
      after: { committeeId: c.id, userId: body.userId, roleLabel: body.roleLabel, memberRole: body.memberRole, voting: body.voting, validFrom: body.validFrom, validTo: body.validTo ?? null },
    });
    return { id, version: 1 };
  }

  async endMembership(ctx: RequestContext, projectId: string, committeeId: string, membershipId: string, body: { expectedVersion: number; validTo: string; reason: string }) {
    const c = await this.sup.committee(ctx, projectId, committeeId, 'governance.committee.manage');
    const m = await loadInProject(this.db, schema.committeeMembership, projectId, membershipId);
    if (m.committeeId !== c.id) throw notFound();
    const p = await this.sup.project(projectId);
    assertVersion(m, body.expectedVersion, 'membership');
    if (m.validTo && m.validTo < this.sup.today(p)) throw ruleViolation('governance.membership.already_ended', `The membership already ended on ${m.validTo}`);
    if (body.validTo < m.validFrom) throw ruleViolation('governance.membership.invalid_term', 'Membership end date is before its start date');
    // History is immutable: a (retroactive) end date may not precede attendance or votes already recorded for the seat.
    const later = await this.db.tx().execute<{ n: number }>(sql`
      select (select count(*) from attendance a join meeting mt on mt.id = a.meeting_id
               where a.membership_id = ${m.id} and (mt.scheduled_at at time zone ${p.timezone})::date > ${body.validTo}::date)::int
           + (select count(*) from vote v join meeting mt on mt.id = v.meeting_id
               where v.membership_id = ${m.id} and (mt.scheduled_at at time zone ${p.timezone})::date > ${body.validTo}::date)::int as n`);
    if ((later.rows[0]?.n ?? 0) > 0) {
      throw ruleViolation('governance.membership.history_conflict', 'Attendance or votes are recorded for this seat after the proposed end date; the end date cannot rewrite history');
    }
    const row = await updateVersioned(this.db, schema.committeeMembership, { id: m.id, projectId, expectedVersion: body.expectedVersion }, { validTo: body.validTo });
    await this.audit.record({
      action: 'governance.committee.end_membership',
      entityType: 'committee_membership',
      entityId: m.id,
      projectId,
      before: { validTo: m.validTo },
      after: { validTo: body.validTo },
      reason: body.reason,
    });
    return { id: m.id, version: row['version'] as number };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Authority matrix versions

  async createMatrix(ctx: RequestContext, projectId: string, committeeId: string, body: { policy: AuthorityPolicy; effectiveFrom?: string; effectiveTo?: string }) {
    const c = await this.sup.committee(ctx, projectId, committeeId, 'governance.authority_matrix.manage');
    if (c.status === 'dissolved') throw ruleViolation('governance.committee.dissolved', 'The committee is dissolved');
    if (body.effectiveFrom && body.effectiveTo && body.effectiveTo < body.effectiveFrom) {
      throw ruleViolation('governance.authority_matrix.invalid_window', 'effectiveTo is before effectiveFrom');
    }
    const [{ maxNo }] = (await this.db
      .tx()
      .select({ maxNo: sql<number>`coalesce(max(${schema.authorityMatrixVersion.versionNo}), 0)::int` })
      .from(schema.authorityMatrixVersion)
      .where(eq(schema.authorityMatrixVersion.committeeId, c.id))) as [{ maxNo: number }];
    const id = newId();
    const versionNo = maxNo + 1;
    const policyJson = JSON.parse(JSON.stringify(body.policy)) as Record<string, unknown>;
    const policyHash = payloadHash(policyJson);
    await this.db
      .tx()
      .insert(schema.authorityMatrixVersion)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        committeeId: c.id,
        versionNo,
        status: 'draft',
        isDemoPolicy: body.policy.isDemoPolicy,
        policy: policyJson,
        policyHash,
        effectiveFrom: body.effectiveFrom ?? null,
        effectiveTo: body.effectiveTo ?? null,
        createdBy: ctx.principal.userId,
      });
    await this.audit.record({
      action: 'governance.authority_matrix.create',
      entityType: 'authority_matrix_version',
      entityId: id,
      projectId,
      after: { committeeId: c.id, versionNo, isDemoPolicy: body.policy.isDemoPolicy, policyHash, decisionTypes: body.policy.decisionTypes.length },
    });
    return { id, versionNo, policyHash };
  }

  async approveMatrix(ctx: RequestContext, projectId: string, committeeId: string, versionId: string, body: { approvalReference: string; effectiveFrom?: string; note?: string }) {
    const c = await loadInProject(this.db, schema.committee, projectId, committeeId);
    const m = await loadInProject(this.db, schema.authorityMatrixVersion, projectId, versionId);
    if (m.committeeId !== c.id) throw notFound();
    this.policy.assert(ctx, 'governance.authority_matrix.approve', { projectId, classification: c.classification, requesterUserId: m.createdBy });
    if (m.status !== 'draft') throw ruleViolation('governance.authority_matrix.not_draft', `Only a draft matrix can be approved (current: ${m.status})`);
    const p = await this.sup.project(projectId);
    if (m.isDemoPolicy && !p.isDemo) {
      throw ruleViolation('governance.authority_matrix.demo_policy_non_demo_project', 'A Demo authority policy can only be approved in a demo project — load the approved delegation matrix instead');
    }
    const effectiveFrom = body.effectiveFrom ?? m.effectiveFrom ?? this.sup.today(p);
    if (m.effectiveTo && m.effectiveTo < effectiveFrom) throw ruleViolation('governance.authority_matrix.invalid_window', 'effectiveTo is before effectiveFrom');
    const tx = this.db.tx();
    // Only one approved version per committee: the previous one is superseded (its historical votes keep their reference).
    const superseded = await tx
      .update(schema.authorityMatrixVersion)
      .set({ status: 'superseded' })
      .where(and(eq(schema.authorityMatrixVersion.committeeId, c.id), eq(schema.authorityMatrixVersion.status, 'approved')))
      .returning({ id: schema.authorityMatrixVersion.id });
    const res = await tx
      .update(schema.authorityMatrixVersion)
      .set({ status: 'approved', approvedBy: ctx.principal.userId, approvedAt: new Date(), approvalReference: body.approvalReference, effectiveFrom })
      .where(and(eq(schema.authorityMatrixVersion.id, m.id), eq(schema.authorityMatrixVersion.projectId, projectId), eq(schema.authorityMatrixVersion.status, 'draft')))
      .returning({ id: schema.authorityMatrixVersion.id });
    if (!res[0]) throw conflict('concurrency.version_mismatch', 'The matrix was changed by someone else — reload and review');
    await this.audit.record({
      action: 'governance.authority_matrix.approve',
      entityType: 'authority_matrix_version',
      entityId: m.id,
      projectId,
      before: { status: 'draft' },
      after: { status: 'approved', effectiveFrom, approvalReference: body.approvalReference, isDemoPolicy: m.isDemoPolicy, superseded: superseded.map((s) => s.id), method: 'internal_electronic_approval' },
      reason: body.note ?? null,
    });
    return { id: m.id, status: 'approved' as const, effectiveFrom, supersededIds: superseded.map((s) => s.id) };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Mapping helpers

  private async charterDrafter(c: CommitteeRow): Promise<string | null> {
    const [v] = await this.db
      .tx()
      .select({ changedBy: schema.recordVersion.changedBy })
      .from(schema.recordVersion)
      .where(and(eq(schema.recordVersion.entityType, CHARTER_ENTITY), eq(schema.recordVersion.entityId, c.id), eq(schema.recordVersion.versionNo, c.charterVersionNo)));
    return v?.changedBy ?? c.createdBy;
  }

  private async summary(c: CommitteeRow, p: ProjectInfo) {
    const today = this.sup.today(p);
    const [{ n }] = (await this.db
      .tx()
      .select({ n: count() })
      .from(schema.committeeMembership)
      .where(
        and(
          eq(schema.committeeMembership.committeeId, c.id),
          sql`${schema.committeeMembership.validFrom} <= ${today}`,
          sql`(${schema.committeeMembership.validTo} is null or ${schema.committeeMembership.validTo} >= ${today})`,
        ),
      )) as [{ n: number }];
    const [m] = await this.db
      .tx()
      .select()
      .from(schema.authorityMatrixVersion)
      .where(and(eq(schema.authorityMatrixVersion.committeeId, c.id), inArray(schema.authorityMatrixVersion.status, ['approved'])))
      .orderBy(desc(schema.authorityMatrixVersion.versionNo))
      .limit(1);
    const u = m ? matrixUsable({ status: m.status, isDemoPolicy: m.isDemoPolicy, effectiveFrom: m.effectiveFrom, effectiveTo: m.effectiveTo }, today, p.isDemo) : null;
    return {
      id: c.id,
      kind: c.kind,
      name: c.name,
      status: c.status,
      classification: c.classification,
      charterVersionNo: c.charterVersionNo,
      charterApprovedVersionNo: c.charterApprovedVersionNo,
      charterApprovedAt: iso(c.charterApprovedAt),
      isDemo: c.isDemo,
      version: c.version,
      createdAt: c.createdAt.toISOString(),
      memberCount: Number(n),
      activeMatrix: m
        ? { id: m.id, versionNo: m.versionNo, status: m.status, isDemoPolicy: m.isDemoPolicy, effectiveFrom: m.effectiveFrom, effectiveTo: m.effectiveTo, usable: u!.usable, usableReason: u!.reason }
        : null,
    };
  }

  private membershipDto(m: MembershipRow, names: Map<string, string>, today: string) {
    return {
      id: m.id,
      committeeId: m.committeeId,
      userId: m.userId,
      displayName: m.userId ? (names.get(m.userId) ?? null) : null,
      roleLabel: m.roleLabel,
      isPlaceholder: m.userId === null,
      memberRole: m.memberRole,
      voting: m.voting,
      validFrom: m.validFrom,
      validTo: m.validTo,
      activeToday: isMemberActiveOn({ membershipId: m.id, userId: m.userId, role: m.memberRole, voting: m.voting, validFrom: m.validFrom, validTo: m.validTo }, today),
      version: m.version,
    };
  }

  private matrixDto(m: MatrixRow) {
    return {
      id: m.id,
      committeeId: m.committeeId,
      versionNo: m.versionNo,
      status: m.status,
      isDemoPolicy: m.isDemoPolicy,
      policy: m.policy,
      policyHash: m.policyHash,
      effectiveFrom: m.effectiveFrom,
      effectiveTo: m.effectiveTo,
      approvedBy: m.approvedBy,
      approvedAt: iso(m.approvedAt),
      approvalReference: m.approvalReference,
      createdBy: m.createdBy,
      createdAt: m.createdAt.toISOString(),
    };
  }
}

/** Explicit field mapping for the charter JSON (never spread request bodies — ARCH-19). */
function cleanCharter(c: Charter): Charter {
  const out: Charter = {};
  const keys = ['purpose', 'scope', 'delegatedAuthority', 'exclusions', 'reservedMatters', 'cadence', 'classification', 'minutesRetention', 'escalation', 'conflictsOfInterest', 'circulation'] as const;
  for (const k of keys) if (typeof c[k] === 'string' && c[k]!.length > 0) out[k] = c[k];
  out.cadenceIsProposal = c.cadenceIsProposal !== false;
  return out;
}
