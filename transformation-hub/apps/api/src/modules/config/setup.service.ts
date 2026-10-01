import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  CLASSIFICATIONS,
  ONBOARDING_ITEM_PERMISSION,
  POLICY_MATRIX,
  SETUP_DEFAULTS,
  assertLaunchable,
  assertPoliciesStep,
  clearanceAllows,
  conflict,
  forbidden,
  onboardingChecklist,
  ruleViolation,
  type AiMode,
  type Classification,
  type OnboardingItem,
  type OnboardingWarning,
  type RoleKey,
  type SetupFacts,
} from '@hub/domain';
import type { RouteInput, configRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { ConfigSupport, iso, type PinnedProject } from './config.support';

type R = typeof configRoutes;
type SetupState = Record<string, unknown> & {
  policies?: { reviewedAt: string; reviewedBy: string | null; classification: Classification; retentionYears: number | null };
  launch?: { at: string; by: string | null; acknowledgedGaps: OnboardingWarning[]; note: string | null; checklist: { key: string; state: string }[] };
};

/** The read permission that shows WHO approved an item and WHEN (otherwise only its state is shown). */
const EVIDENCE_READ: Partial<Record<OnboardingItem, string>> = {
  newco: 'newco.register.read',
  perimeter: 'carveout.register.read',
  committee: 'governance.committee.read',
  authority_matrix: 'governance.committee.read',
  baseline: 'planning.plan.read',
  policies: 'portfolio.project.read',
};

const rolesHolding = (permission: string): RoleKey[] =>
  (Object.entries(POLICY_MATRIX.roles) as [RoleKey, { permissions: readonly string[] }][]).filter(([, r]) => r.permissions.includes(permission)).map(([k]) => k);

/**
 * Actual-project setup wizard, steps 7 and 8 (spec §21), and the onboarding checklist of real projects (REQ-SET-007):
 *  - the checklist is computed from CURRENT records (never a snapshot): each required item is completed or approved through
 *    its own module's command (`ONBOARDING_ITEM_PERMISSION`) — the wizard approves nothing and names roles, never people;
 *  - step 7 (REQ-SET-015) sets the project's confidentiality (classification) and retention while it is in setup, and shows
 *    the AI mode (Off by default, changed only in the AI PM Center) and the integrations with their honest status;
 *  - step 8 (REQ-SET-016) launches monitoring (setup → active) only when every required item is done and the remaining
 *    gaps are acknowledged; a refused launch returns the gap list (and is audited by the problem filter with it).
 */
@Injectable()
export class SetupService {
  constructor(private readonly s: ConfigSupport) {}

  private async facts(pin: PinnedProject): Promise<{ facts: SetupFacts; evidence: Partial<Record<OnboardingItem, { at: Date | null; by: string | null }>> }> {
    const pid = pin.p.id;
    const today = this.s.clock.today(pin.p.timezone);
    const { rows } = await this.s.db.query<{
      perimeter_at: Date | null;
      perimeter_by: string | null;
      perimeter: boolean;
      ws_total: number;
      ws_no_lead: number;
      pms: number;
      sponsors: number;
      committee: boolean;
      charter_at: Date | null;
      charter_by: string | null;
      matrix: boolean;
      matrix_at: Date | null;
      matrix_by: string | null;
      baseline: boolean;
      baseline_at: Date | null;
      baseline_by: string | null;
      sources: number;
      pending_claims: number;
    }>(
      `with pv as (select decided_at, decided_by from perimeter_version where project_id = $1 and status = 'approved' order by version_no desc limit 1),
            cm as (select charter_approved_at, charter_approved_by from committee where project_id = $1 and status = 'active' and charter_approved_version_no is not null
                    order by charter_approved_at desc nulls last limit 1),
            am as (select approved_at, approved_by from authority_matrix_version where project_id = $1 and status = 'approved'
                     and (effective_from is null or effective_from <= $2::date) and (effective_to is null or effective_to >= $2::date)
                   order by approved_at desc nulls last limit 1),
            bl as (select approved_at, approved_by from baseline_version where project_id = $1 and status = 'approved' order by version_no desc limit 1),
            mem as (select m.role from project_membership m join app_user u on u.id = m.user_id and u.is_active
                     where m.project_id = $1 and m.workstream_id is null and m.revoked_at is null and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
       select (select decided_at from pv) as perimeter_at, (select decided_by from pv) as perimeter_by, exists (select 1 from pv) as perimeter,
              (select count(*) from workstream where project_id = $1)::int as ws_total,
              (select count(*) from workstream where project_id = $1 and lead_user_id is null)::int as ws_no_lead,
              (select count(*) from mem where role = 'project_manager')::int as pms,
              (select count(*) from mem where role = 'sponsor')::int as sponsors,
              exists (select 1 from cm) as committee, (select charter_approved_at from cm) as charter_at, (select charter_approved_by from cm) as charter_by,
              exists (select 1 from am) as matrix, (select approved_at from am) as matrix_at, (select approved_by from am) as matrix_by,
              exists (select 1 from bl) as baseline, (select approved_at from bl) as baseline_at, (select approved_by from bl) as baseline_by,
              (select count(*) from source_record where project_id = $1)::int as sources,
              (select count(*) from source_claim where project_id = $1 and reviewed_at is null)::int as pending_claims`,
      [pid, today],
    );
    const x = rows[0]!;
    const [newco] = await this.s.db
      .tx()
      .select({ status: schema.legalEntity.incorporationStatus, verification: schema.legalEntity.incorporationVerification, verifiedAt: schema.legalEntity.incorporationVerifiedAt, verifiedBy: schema.legalEntity.incorporationVerifiedBy })
      .from(schema.projectEntity)
      .innerJoin(schema.legalEntity, eq(schema.legalEntity.id, schema.projectEntity.legalEntityId))
      .where(and(eq(schema.projectEntity.projectId, pid), eq(schema.projectEntity.role, 'newco')))
      .limit(1);
    const st = (pin.p.setupState ?? {}) as SetupState;
    const facts: SetupFacts = {
      templateKind: pin.templateKind,
      objective: pin.p.objective,
      newco: { linked: !!newco, incorporationStatus: newco?.status ?? null, verification: newco?.verification ?? null },
      sources: { total: x.sources, pendingClaims: x.pending_claims },
      perimeterApproved: x.perimeter,
      workstreams: { total: x.ws_total, withoutLead: x.ws_no_lead },
      members: { projectManagers: x.pms, sponsors: x.sponsors },
      committee: { active: x.committee, charterApproved: x.committee },
      authorityMatrixInForce: x.matrix,
      baselineApproved: x.baseline,
      policiesReviewed: !!st.policies?.reviewedAt,
      retentionYears: pin.p.retentionYears,
    };
    const evidence: Partial<Record<OnboardingItem, { at: Date | null; by: string | null }>> = {
      perimeter: x.perimeter ? { at: x.perimeter_at, by: x.perimeter_by } : undefined,
      committee: x.committee ? { at: x.charter_at, by: x.charter_by } : undefined,
      authority_matrix: x.matrix ? { at: x.matrix_at, by: x.matrix_by } : undefined,
      baseline: x.baseline ? { at: x.baseline_at, by: x.baseline_by } : undefined,
      newco: newco?.verification === 'confirmed' ? { at: newco.verifiedAt, by: newco.verifiedBy } : undefined,
      policies: st.policies?.reviewedAt ? { at: new Date(st.policies.reviewedAt), by: st.policies.reviewedBy } : undefined,
    };
    return { facts, evidence };
  }

  async get(ctx: RequestContext, projectId: string) {
    const pin = await this.s.pinned(projectId);
    this.s.assertProject(ctx, 'portfolio.project.read', pin.p);
    const { facts, evidence } = await this.facts(pin);
    const c = onboardingChecklist(facts);
    const st = (pin.p.setupState ?? {}) as SetupState;
    const names = await this.s.userNames([...Object.values(evidence).map((e) => e?.by), st.launch?.by, st.policies?.reviewedBy]);
    const [ai] = await this.s.db
      .tx()
      .select({ mode: schema.aiProjectSettings.mode, killSwitch: schema.aiProjectSettings.killSwitch })
      .from(schema.aiProjectSettings)
      .where(eq(schema.aiProjectSettings.projectId, projectId));
    const integrations = await this.s.db
      .tx()
      .select({ kind: schema.integrationConnection.kind, name: schema.integrationConnection.name, status: schema.integrationConnection.status, enabled: schema.integrationConnection.enabled })
      .from(schema.integrationConnection)
      .where(eq(schema.integrationConnection.orgId, ctx.principal.orgId))
      .orderBy(schema.integrationConnection.kind, schema.integrationConnection.name);
    const mode = (ai?.mode ?? SETUP_DEFAULTS.aiMode) as AiMode;
    return {
      status: pin.p.status,
      isDemo: pin.p.isDemo,
      templateKind: pin.templateKind,
      version: pin.p.version,
      checklist: {
        items: c.items.map((i) => {
          const e = evidence[i.key];
          const readable = !!e && (EVIDENCE_READ[i.key] ? this.s.can(ctx, EVIDENCE_READ[i.key]!, pin.p) : false);
          return {
            key: i.key,
            step: i.step,
            state: i.state,
            byRoles: rolesHolding(ONBOARDING_ITEM_PERMISSION[i.key]),
            evidence: i.state === 'done' && readable ? { at: iso(e!.at), byName: e!.by ? (names.get(e!.by) ?? null) : null } : null,
          };
        }),
        warnings: c.warnings,
        blockingGaps: c.blockingGaps,
      },
      policies: {
        classification: pin.p.classification as Classification,
        retentionYears: pin.p.retentionYears,
        reviewedAt: st.policies?.reviewedAt ?? null,
        reviewedByName: st.policies?.reviewedBy ? (names.get(st.policies.reviewedBy) ?? null) : null,
      },
      ai: { mode, killSwitch: ai?.killSwitch ?? false, isDefault: mode === SETUP_DEFAULTS.aiMode },
      integrations,
      launch: st.launch ? { at: st.launch.at, byName: st.launch.by ? (names.get(st.launch.by) ?? null) : null, acknowledgedGaps: st.launch.acknowledgedGaps, note: st.launch.note } : null,
    };
  }

  /** Step 7 (REQ-SET-015): confidentiality and retention, while in setup; recorded as reviewed (a required onboarding item). */
  async policies(ctx: RequestContext, projectId: string, body: RouteInput<R['setupPolicies']>['body']) {
    const pin = await this.s.pinned(projectId, { lock: true });
    this.s.assertProject(ctx, 'config.project_settings.manage', pin.p);
    assertPoliciesStep({ projectStatus: pin.p.status, retentionYears: body.retentionYears });
    if (pin.p.version !== body.expectedVersion) throw conflict('concurrency.version_mismatch', 'The project was changed by someone else — reload and review', { expectedVersion: body.expectedVersion, currentVersion: pin.p.version });
    const from = pin.p.classification as Classification;
    const to = body.classification;
    if (to !== from) {
      // access-matrix §2.4: nobody classifies content above their own clearance (as at project creation).
      if (!clearanceAllows(ctx.principal.clearance, to)) throw forbidden('policy.classification_exceeds_clearance', 'You cannot classify the project above your own clearance');
      // Lowering the confidentiality widens who can see the project: a reason is required and audited.
      if (CLASSIFICATIONS.indexOf(to) < CLASSIFICATIONS.indexOf(from) && !body.reason?.trim()) {
        throw ruleViolation('setup.classification_lowered_reason_required', 'Give the reason for lowering the project classification');
      }
      // The project managers must keep access to the project they set up (as at creation, QA-P1-05).
      const { rows } = await this.s.db.query<{ clearance: Classification }>(
        `select u.clearance::text as clearance from project_membership m join app_user u on u.id = m.user_id and u.is_active
          where m.project_id = $1 and m.role = 'project_manager' and m.workstream_id is null and m.revoked_at is null and (m.valid_to is null or m.valid_to > now())`,
        [projectId],
      );
      if (rows.some((r) => !clearanceAllows(r.clearance, to))) throw ruleViolation('setup.pm_clearance_too_low', "A project manager's clearance is below this classification — the project would be hidden from them");
    }
    const now = this.s.clock.now();
    const st = (pin.p.setupState ?? {}) as SetupState;
    const policies = { reviewedAt: now.toISOString(), reviewedBy: ctx.principal.userId, classification: to, retentionYears: body.retentionYears };
    const res = await this.s.db
      .tx()
      .update(schema.project)
      .set({ classification: to, retentionYears: body.retentionYears, setupState: { ...st, policies }, updatedAt: now, version: pin.p.version + 1 })
      .where(and(eq(schema.project.id, projectId), eq(schema.project.version, body.expectedVersion)))
      .returning({ version: schema.project.version });
    if (!res[0]) throw conflict('concurrency.version_mismatch', 'The project was changed by someone else — reload and review');
    await this.s.audit.record({
      action: 'config.setup.policies',
      entityType: 'project',
      entityId: projectId,
      projectId,
      before: { classification: from, retentionYears: pin.p.retentionYears },
      after: { classification: to, retentionYears: body.retentionYears },
      reason: body.reason ?? null,
    });
    // Who may see the project changed: caches / indexes keyed on access re-check (AI knowledge, notifications).
    if (to !== from) await this.s.outbox.emit({ type: 'permission.changed', projectId, aggregateType: 'project', aggregateId: projectId, payload: { change: 'classification', from, to } });
    return { version: res[0].version };
  }

  /** Step 8 (REQ-SET-016, REQ-SET-007): launch monitoring after required-data validation; the gap list is returned and recorded. */
  async launch(ctx: RequestContext, projectId: string, body: RouteInput<R['launch']>['body']) {
    const pin = await this.s.pinned(projectId, { lock: true });
    this.s.assertProject(ctx, 'config.project_settings.manage', pin.p);
    const { facts } = await this.facts(pin);
    const c = onboardingChecklist(facts);
    assertLaunchable(pin.p.status, c, body.acknowledgedGaps);
    if (pin.p.version !== body.expectedVersion) throw conflict('concurrency.version_mismatch', 'The project was changed by someone else — reload and review', { expectedVersion: body.expectedVersion, currentVersion: pin.p.version });
    const now = this.s.clock.now();
    const st = (pin.p.setupState ?? {}) as SetupState;
    const acknowledgedGaps = c.warnings;
    const launch = { at: now.toISOString(), by: ctx.principal.userId, acknowledgedGaps, note: body.note ?? null, checklist: c.items.map((i) => ({ key: i.key, state: i.state })) };
    const res = await this.s.db
      .tx()
      .update(schema.project)
      .set({ status: 'active', setupState: { ...st, launch }, updatedAt: now, version: pin.p.version + 1 })
      .where(and(eq(schema.project.id, projectId), eq(schema.project.version, body.expectedVersion), eq(schema.project.status, 'setup')))
      .returning({ version: schema.project.version });
    if (!res[0]) throw conflict('concurrency.version_mismatch', 'The project was changed by someone else — reload and review');
    await this.s.audit.record({
      action: 'config.setup.launch',
      entityType: 'project',
      entityId: projectId,
      projectId,
      before: { status: 'setup' },
      after: { status: 'active', acknowledgedGaps, checklist: launch.checklist },
      reason: body.note ?? null,
    });
    return { status: 'active' as const, version: res[0].version, launchedAt: launch.at, acknowledgedGaps };
  }
}
