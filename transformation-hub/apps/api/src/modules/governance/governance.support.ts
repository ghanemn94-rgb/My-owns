import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  AuthorityPolicy,
  Classification,
  CommitteeMemberRole,
  MatrixState,
  MemberSnapshot,
  isMemberActiveOn,
  localDate,
  matrixUsable,
  notFound,
  ruleViolation,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService, ResourceAttrs } from '../../platform/policy.service';
import { Clock } from '../../platform/clock';
import { loadInProject } from '../../platform/helpers';
import { newId } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';

export type CommitteeRow = typeof schema.committee.$inferSelect;
export type MeetingRow = typeof schema.meeting.$inferSelect;
export type DecisionRow = typeof schema.decision.$inferSelect;
export type MatrixRow = typeof schema.authorityMatrixVersion.$inferSelect;
export type MembershipRow = typeof schema.committeeMembership.$inferSelect;
export type ActionRow = typeof schema.actionItem.$inferSelect;

export interface ProjectInfo {
  id: string;
  isDemo: boolean;
  timezone: string;
  classification: Classification;
}

export interface MatrixInForce {
  row: MatrixRow | null;
  policy: AuthorityPolicy | null;
  state: MatrixState | null;
  usable: boolean;
  reason: string;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Decision amount (the money columns come from a computed-key helper, so they are read through this accessor). */
export function amountOf(d: DecisionRow): { amount: string; currency: string; unitScale: number } | null {
  const r = d as unknown as { amountAmount: string | null; amountCurrency: string | null; amountUnitScale: number | null };
  return r.amountAmount && r.amountCurrency && r.amountUnitScale ? { amount: String(r.amountAmount), currency: r.amountCurrency, unitScale: Number(r.amountUnitScale) } : null;
}

/**
 * Shared loaders and rule inputs for the governance command services (project info, visibility-checked loads,
 * committee membership snapshots, the authority matrix in force, recusals and attendance).
 */
@Injectable()
export class GovernanceSupport {
  constructor(
    readonly db: DbService,
    readonly policy: PolicyService,
    readonly clock: Clock,
  ) {}

  async project(projectId: string): Promise<ProjectInfo> {
    const [p] = await this.db
      .tx()
      .select({ id: schema.project.id, isDemo: schema.project.isDemo, timezone: schema.project.timezone, classification: schema.project.classification })
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    return p;
  }

  today(p: ProjectInfo): string {
    return this.clock.today(p.timezone);
  }

  localDateOf(instant: Date, p: ProjectInfo): string {
    return localDate(instant, p.timezone);
  }

  /** Load a committee in the project and assert `permission` against its classification (hidden → 404). */
  async committee(ctx: RequestContext, projectId: string, committeeId: string, permission = 'governance.committee.read', extra: Partial<ResourceAttrs> = {}): Promise<CommitteeRow> {
    const c = await loadInProject(this.db, schema.committee, projectId, committeeId);
    this.policy.assert(ctx, permission, { projectId, classification: c.classification, ...extra });
    return c;
  }

  /** Load a meeting and its committee; the meeting inherits the committee's classification. */
  async meeting(ctx: RequestContext, projectId: string, meetingId: string, permission = 'governance.meeting.read', extra: Partial<ResourceAttrs> = {}) {
    const meeting = await loadInProject(this.db, schema.meeting, projectId, meetingId);
    const committee = await loadInProject(this.db, schema.committee, projectId, meeting.committeeId);
    this.policy.assert(ctx, permission, { projectId, classification: committee.classification, ...extra });
    return { meeting, committee };
  }

  /** Load a decision and assert `permission` (defaults to read) with its classification (hidden → 404). */
  async decision(ctx: RequestContext, projectId: string, decisionId: string, permission = 'governance.decision.read', extra: Partial<ResourceAttrs> = {}): Promise<DecisionRow> {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    this.policy.assert(ctx, permission, { projectId, classification: d.classification, ...extra });
    return d;
  }

  async memberships(committeeId: string): Promise<MembershipRow[]> {
    return this.db.tx().select().from(schema.committeeMembership).where(eq(schema.committeeMembership.committeeId, committeeId)).orderBy(asc(schema.committeeMembership.createdAt));
  }

  memberSnapshots(rows: MembershipRow[]): MemberSnapshot[] {
    return rows.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      role: m.memberRole as CommitteeMemberRole,
      voting: m.voting,
      validFrom: m.validFrom,
      validTo: m.validTo,
    }));
  }

  chairOn(members: MemberSnapshot[], onDate: string): string | null {
    return members.find((m) => m.role === 'chair' && m.userId && isMemberActiveOn(m, onDate))?.userId ?? null;
  }

  /**
   * The authority matrix in force for a committee on a date: the approved version (only one is approved at a time;
   * older ones are superseded). Usability also checks the effective window and the demo-policy restriction.
   */
  async matrixInForce(committeeId: string, onDate: string, p: ProjectInfo): Promise<MatrixInForce> {
    const [row] = await this.db
      .tx()
      .select()
      .from(schema.authorityMatrixVersion)
      .where(and(eq(schema.authorityMatrixVersion.committeeId, committeeId), eq(schema.authorityMatrixVersion.status, 'approved')))
      .orderBy(desc(schema.authorityMatrixVersion.versionNo))
      .limit(1);
    const state: MatrixState | null = row ? { status: row.status, isDemoPolicy: row.isDemoPolicy, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo } : null;
    const u = matrixUsable(state, onDate, p.isDemo);
    return { row: row ?? null, policy: row ? (row.policy as unknown as AuthorityPolicy) : null, state, usable: u.usable, reason: u.reason };
  }

  requireUsable(m: MatrixInForce): { row: MatrixRow; policy: AuthorityPolicy; state: MatrixState } {
    if (!m.usable || !m.row || !m.policy || !m.state) {
      throw ruleViolation('governance.matrix.not_usable', `${m.reason} — votes and outcomes need an approved, effective authority matrix`);
    }
    return { row: m.row, policy: m.policy, state: m.state };
  }

  async recusedUserIds(decisionId: string): Promise<string[]> {
    const rows = await this.db.tx().select({ userId: schema.recusal.userId }).from(schema.recusal).where(eq(schema.recusal.decisionId, decisionId));
    return rows.map((r) => r.userId);
  }

  async attendance(meetingId: string) {
    return this.db.tx().select().from(schema.attendance).where(eq(schema.attendance.meetingId, meetingId));
  }

  /**
   * Record a recusal (append-only) plus the matching conflict declaration (evidence of the conflict check).
   * Returns false when the user was already recused on the decision.
   */
  async insertRecusal(ctx: RequestContext, d: DecisionRow, userId: string, reason: string, meetingId: string | null): Promise<boolean> {
    const tx = this.db.tx();
    const [existing] = await tx
      .select({ id: schema.recusal.id })
      .from(schema.recusal)
      .where(and(eq(schema.recusal.decisionId, d.id), eq(schema.recusal.userId, userId)));
    if (existing) return false;
    await tx.insert(schema.recusal).values({ id: newId(), orgId: ctx.principal.orgId, projectId: d.projectId, decisionId: d.id, userId, reason, recordedBy: ctx.principal.userId });
    return true;
  }

  async displayNames(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return new Map();
    const rows = await this.db.tx().select({ id: schema.appUser.id, name: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Active (non-revoked, unexpired) project membership — owners of actions must be project members. */
  async isActiveProjectMember(projectId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .tx()
      .select({ id: schema.projectMembership.id, validTo: schema.projectMembership.validTo, revokedAt: schema.projectMembership.revokedAt })
      .from(schema.projectMembership)
      .where(and(eq(schema.projectMembership.projectId, projectId), eq(schema.projectMembership.userId, userId)));
    const now = this.clock.now();
    return rows.some((r) => !r.revokedAt && (!r.validTo || r.validTo > now));
  }
}
