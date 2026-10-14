// Permission catalogue and seeded role defaults (ADR-0006). Source: docs/analysis/permissions-matrix.md.
// These are a CONFIGURABLE STARTING POINT, not a Mobily-approved access policy. The database is the runtime
// source of truth (role, permission, role_permission tables); the seed migrations insert exactly these rows (P1:
// 0005_seed_roles_permissions.sql; P2: 0018_p2_access_instantiation.sql; P3: 0024_p3_gates_access_instantiation.sql; P4 slices I and C: 0031_p4_approvals_permissions.sql; P4 slice A: 0036_p4_kpi_permissions_backfill.sql; P4 slice B: 0040_p4_benefit_permissions.sql; P4 slice E: 0043_p4_raid_permissions.sql; P4 slice D: 0046_p4_governance_permissions.sql; P4 slices F and G: 0049_p4_adoption_sustainment_permissions.sql; P4 slice H: 0053_p4_gates_change_permissions.sql; P4 slices J and K: 0057_p4_dashboards_traceability_permissions.sql; P5 slice A: 0064_p5_studio_permissions_source_inventory.sql), and a unit test in @mth/db asserts each
// seed matches this file.

export const PERMISSION_CATEGORIES = ["read", "write", "configure", "business_approval", "finance_validation"] as const;
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export const P1_PERMISSIONS = {
  "organization.read": "read",
  "organization.manage": "configure",
  "business_unit.read": "read",
  "business_unit.manage": "configure",
  "user.read": "read",
  "user.manage": "configure",
  "role.read": "read",
  "access.read": "read",
  "access.assign": "configure",
  "transformation.read": "read",
  "transformation.create": "write",
  "transformation.update": "write",
  "transformation.archive": "write",
  "audit.read": "read",
  // Catalogue entries that exist from P1 so separation-of-duties constraints are enforced from the start
  // (ADR-0006: a technical_admin role can never hold these). No P1 route uses them.
  "gate.decide": "business_approval",
  "finance.validate": "finance_validation",
} as const satisfies Record<string, PermissionCategory>;

/** P2 catalogue (Diagnose / Define / Design, product gates G1-G3; ADR-0020). Seeded by migration 0018. */
export const P2_PERMISSIONS = {
  "north_star.edit": "write",
  "charter.edit": "write",
  "outcome.edit": "write",
  "kpi_definition.edit": "write",
  "kpi_target.approve": "business_approval",
  "baseline.edit": "write",
  "diagnostic.edit": "write",
  "diagnostic.contribute": "write",
  "tom.edit": "write",
  "tom.contribute": "write",
  "workshop.facilitate": "write",
  "decision.edit": "write",
  "decision.decide": "write",
  "dependency.edit": "write",
  "action.edit": "write",
  "action.update_own": "write",
  "evidence.create": "write",
  "evidence.review": "write",
  "gate.submit": "write",
  "gate.configure": "configure",
  "team.assign": "configure",
  "methodology.configure": "configure",
} as const satisfies Record<string, PermissionCategory>;

/** P3 catalogue (Mobilize: portfolio, prioritization, roadmap, capacity, funding, business case, T09, G4; ADR-0021..0024). Seeded by migration 0024. */
export const P3_PERMISSIONS = {
  "initiative.edit": "write",
  "initiative.launch": "write",
  "portfolio.select": "business_approval",
  "prioritization.score": "write",
  "prioritization.edit": "write",
  "prioritization.approve": "business_approval",
  "roadmap.edit": "write",
  "roadmap.approve": "write",
  "deliverable.accept": "write",
  "capacity.edit": "write",
  "capacity.commit": "write",
  "funding.approve": "business_approval",
  "business_case.edit": "write",
  "benefit_formula.edit": "write",
  "dependency_type.configure": "configure",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P4 catalogue, slices I and C (business calendar, job schedules, groups, role mapping, delegation, approvals, T11 and
 * T12; ADR-0025, ADR-0026 §8). Seeded by migration 0031. Later P4 slices append their own blocks here and in their own
 * migrations. approval.decide is a business approval: no technical_admin role may hold it (REQ-S10-003).
 */
export const P4_PERMISSIONS = {
  "calendar.configure": "configure",
  "job.read": "read",
  "job.configure": "configure",
  "group.manage": "configure",
  "role_mapping.assign": "configure",
  "delegation.create_own": "write",
  "delegation.manage": "configure",
  "approval.request": "write",
  "approval.decide": "business_approval",
  "decision_right.configure": "configure",
  "raci.edit": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P4 catalogue, slice A (KPI engine; ADR-0027 §11). Seeded by migration 0036. Every code is 'write' or 'configure':
 * none is a business approval, so the DG1/DG2 rules keyed on "a role holding an approval permission" (creator-derived
 * assignment, F-DG1-106; team roles, ADR-0020 §3) are unchanged. Trajectory approval reuses kpi_target.approve (P2).
 */
export const P4_KPI_PERMISSIONS = {
  "kpi_version.edit": "write",
  "kpi_version.activate": "write",
  "kpi_threshold.configure": "write",
  "target_trajectory.edit": "write",
  "reporting_period.manage": "configure",
  "kpi_actual.submit": "write",
  "kpi_actual.accept": "write",
  "rag.override": "write",
  "data_quality.manage": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P4 catalogue, slice B (benefits register and Finance validation; ADR-0029 §9, ADR-0030 §9). Seeded by migration
 * 0040. Every code is 'write': none is a business approval or a Finance validation, so the DG1/DG2 rules keyed on "a
 * role holding an approval permission" are unchanged. Finance validation, corrections (amendments and reversals),
 * overlap resolution, baseline validation and valuation-method decisions reuse finance.validate (P1; FIN only).
 */
export const P4_BENEFIT_PERMISSIONS = {
  "benefit.edit": "write",
  "benefit.advance": "write",
  "benefit.allocate": "write",
  "benefit.measure": "write",
  "benefit_scenario.edit": "write",
  "benefit_group.manage": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P4 catalogue, slice E (RAID, corrective actions, budget lines; ADR-0031 §9). Seeded by migration 0043. Every code is
 * 'write' or 'configure': none is a business approval or a Finance validation, so the DG1/DG2 rules keyed on "a role
 * holding an approval permission" are unchanged. Actions reuse action.edit / action.update_own (P2); initiative
 * durations reuse roadmap.edit (P3); a RAID Dependency entry also needs dependency.edit (P2).
 */
export const P4_RAID_PERMISSIONS = {
  "raid.edit": "write",
  "corrective_action.manage": "write",
  "corrective_rule.configure": "configure",
  "budget.edit": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P4 catalogue, slice D (forums, meetings, T16 executive decisions, escalation; ADR-0032 §9). Seeded by migration 0046.
 * One code is a business approval: executive_decision.decide (recording a T16 Outcome), granted only to SP, BO and FIN,
 * which already hold a business_approval or finance_validation code, so the DG1/DG2 rules keyed on "a role holding an
 * approval permission" (F-DG1-106; ADR-0020 §3; ADR-0026 §8) are unchanged. Every other code is 'write' or 'configure'.
 */
export const P4_GOVERNANCE_PERMISSIONS = {
  "forum.configure": "configure",
  "meeting.prepare": "write",
  "meeting.chair": "write",
  "executive_decision.create": "write",
  "executive_decision.decide": "business_approval",
  "escalation_rule.configure": "configure",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P4 slices F and G catalogue (adoption, sustainment, BAU, closure; ADR-0033 §9, ADR-0034 §10). Seeded by migration
 * 0049. One business_approval code: bau_handover.accept (receiving-owner acceptance, REQ-S11-005), held only by BO.
 * lesson.search is a read code (cross-transformation lesson search, REQ-S11-008), also held by AUD.
 */
export const P4_ADOPTION_SUSTAINMENT_PERMISSIONS = {
  "adoption.edit": "write",
  "assessment_form.manage": "write",
  "assessment.respond": "write",
  "assessment.review": "write",
  "proficiency.record": "write",
  "champion_constraint.raise": "write",
  "adoption_status.set": "write",
  "initiative.complete_delivery": "write",
  "initiative.close": "write",
  "transformation.close": "write",
  "performance_area.manage": "write",
  "performance_area.reopen": "write",
  "bau_handover.prepare": "write",
  "bau_handover.accept": "business_approval",
  "control.manage": "write",
  "control_check.record": "write",
  "sustainment_review.complete": "write",
  "improvement.edit": "write",
  "lesson.edit": "write",
  "lesson.search": "read",
  "transition_decision.propose": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P4 slice H catalogue (phases and phase steps, gate reviews and exceptions, G5 scale, risk dispositions, change
 * control; ADR-0035 §8, ADR-0036 §7). Seeded by migration 0053. One business_approval code: gate_exception.decide,
 * held only by SP and BO (the roles that already hold gate.decide). Change requests and risk dispositions are decided
 * through the canonical approval (approval.decide). AUD gets nothing here (every slice H read is transformation.read).
 */
export const P4_GATES_CHANGE_PERMISSIONS = {
  "phase_step.manage": "write",
  "phase_step.progress": "write",
  "phase_step.review": "write",
  "gate.review": "write",
  "gate_exception.request": "write",
  "gate_exception.decide": "business_approval",
  "scale.transition": "write",
  "risk_disposition.propose": "write",
  "change_request.raise": "write",
  "change_control.configure": "configure",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P4 slices J and K (T-DG4-ARCH-08; ADR-0037 §8, ADR-0038 §8): dashboards, traceability, inherited records of a
 * Modular entry, portfolios and workstreams. Seeded by migration 0057. No business_approval or finance_validation
 * code: every dashboard, My Work, header, traceability, orphan, missing-link and impact read is transformation.read
 * (or the caller's own items), which AUD already holds read-only. AUD and the technical admins get nothing here.
 */
export const P4_DASHBOARD_TRACE_PERMISSIONS = {
  "traceability.link": "write",
  "inherited_record.record": "write",
  "workstream.manage": "write",
  "portfolio.manage": "configure",
  "dashboard.configure": "configure",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P5 slice A (T-DG5-ARCH-01; ADR-0039 §9, ADR-0040 §6): Playbook Studio, configuration review, source coverage and the
 * methodology migration of a pinned transformation. Seeded by migration 0064. One business_approval code,
 * methodology_migration.approve, held only by SP (TL stays approval-free: the DG1 creator-derived assignment, 0008,
 * never derives a role that holds an approval code). ADM_METHOD configures, previews, publishes and plans/executes
 * approved migrations; it never reviews configuration and never approves (REQ-S06-010, REQ-S10-003). AUD reads only.
 */
export const P5_STUDIO_PERMISSIONS = {
  "methodology.read": "read",
  "methodology.publish": "configure",
  "methodology.review": "write",
  "config_review_policy.configure": "configure",
  "source_coverage.run": "configure",
  "methodology_migration.plan": "configure",
  "methodology_migration.approve": "business_approval",
  "methodology_migration.execute": "configure",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P5 slices B and C (T-DG5-ARCH-02; ADR-0041 §9, ADR-0042 §9), seeded by migration 0070. No business_approval or
 * finance_validation code: an approval step of a procedure is decided through the canonical approval by the holder of
 * that business approval right. Authoring form schemas and procedures uses the existing methodology.configure
 * (ADM_METHOD) and the slice A publish pipeline. Custom-field values, drafts and attachments are authorized by the
 * record type's own write permission (form_record_type.write_permission_code). AUD and the technical admins read only.
 */
export const P5_FORMS_PROCEDURES_PERMISSIONS = {
  "form_record.comment": "write",
  "procedure.read": "read",
  "procedure.launch": "write",
  "procedure.act": "write",
  "procedure.manage": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P5 slices D and E (T-DG5-ARCH-03; ADR-0043 §8, ADR-0044 §7), seeded by migration 0076. No business_approval or
 * finance_validation code: an approval route step is decided with the existing approval.decide, and automation.review
 * is a configuration review, not a business approval. ADM_METHOD authors rules; ADM_TECH repairs jobs and failures and
 * configures the notification policy; TO reviews rule versions; AUD reads automation only (the jobs view stays job.read,
 * ADM_TECH). A rule's service identity never holds an approval right (database guard in 0074).
 */
export const P5_AUTOMATION_PERMISSIONS = {
  "automation.read": "read",
  "automation.configure": "configure",
  "automation.review": "write",
  "automation.repair": "configure",
  "job.repair": "configure",
  "notification_policy.configure": "configure",
  "notification.preferences": "write",
  "gate_condition.close": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P5 slice F (T-DG5-ARCH-04; ADR-0045 §8, ADR-0046 §6): reports, snapshots, exports and owner updates. Seeded by 0082.
 * Reading needs transformation.read (DG1). No code is a business_approval or finance_validation code.
 */
export const P5_REPORTING_PERMISSIONS = {
  "report.generate": "write",
  "report.issue": "write",
  "export.create": "write",
  "owner_update.submit": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P5 slices G and H (T-DG5-ARCH-05; ADR-0047 §6, ADR-0048 §7): KPI restatements, the optional NPV/ROI/payback
 * extension, the 90-day launch plan, the Day-90 leadership test and the health check. Seeded by migration 0087. One
 * business_approval code, kpi_restatement.approve (D-142 Q10: SP, BO, FIN, the approval.decide holders; never the
 * requester). TL holds none (ADR-0039 §9). ADM_METHOD only switches the financial extension on or off; AUD gets
 * nothing here and stays read-only. Publishing a health-check scheme uses the slice A Studio rights.
 */
export const P5_KPI_LAUNCH_HEALTH_PERMISSIONS = {
  "kpi_restatement.request": "write",
  "kpi_restatement.approve": "business_approval",
  "financial_metrics.enable": "configure",
  "financial_metrics.define": "write",
  "launch_plan.edit": "write",
  "day_ninety_test.respond": "write",
  "health_check.assess": "write",
} as const satisfies Record<string, PermissionCategory>;

export const PERMISSIONS = {
  ...P1_PERMISSIONS,
  ...P2_PERMISSIONS,
  ...P3_PERMISSIONS,
  ...P4_PERMISSIONS,
  ...P4_KPI_PERMISSIONS,
  ...P4_BENEFIT_PERMISSIONS,
  ...P4_RAID_PERMISSIONS,
  ...P4_GOVERNANCE_PERMISSIONS,
  ...P4_ADOPTION_SUSTAINMENT_PERMISSIONS,
  ...P4_GATES_CHANGE_PERMISSIONS,
  ...P4_DASHBOARD_TRACE_PERMISSIONS,
  ...P5_STUDIO_PERMISSIONS,
  ...P5_FORMS_PROCEDURES_PERMISSIONS,
  ...P5_AUTOMATION_PERMISSIONS,
  ...P5_REPORTING_PERMISSIONS,
  ...P5_KPI_LAUNCH_HEALTH_PERMISSIONS,
} as const satisfies Record<string, PermissionCategory>;
export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_KINDS = ["source", "implementation", "technical_admin"] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];

export interface RoleDefinition {
  readonly kind: RoleKind;
  /** A grant at a wider scope also applies to narrower scopes inside it (permissions matrix rule 1). */
  readonly inheritsDownward: boolean;
  readonly permissions: readonly Permission[];
}

const BASE_READ = ["organization.read", "business_unit.read", "role.read", "transformation.read"] as const;

/**
 * P2 role defaults (seeded by 0018). Kept separate so each seed migration can be compared with its own part.
 * AUD (read-only auditor), CM, SEC, ADM_TECH and ADM_ACCESS get no P2 write permission (ADR-0020).
 */
export const P2_ROLE_PERMISSIONS = {
  SP: ["kpi_target.approve", "decision.decide", "action.update_own"],
  TL: [
    "north_star.edit",
    "charter.edit",
    "outcome.edit",
    "kpi_definition.edit",
    "baseline.edit",
    "diagnostic.edit",
    "tom.edit",
    "workshop.facilitate",
    "decision.edit",
    "decision.decide",
    "dependency.edit",
    "action.edit",
    "evidence.create",
    "evidence.review",
    "gate.submit",
    "team.assign",
  ],
  BO: [
    "outcome.edit",
    "kpi_target.approve",
    "tom.edit",
    "decision.decide",
    "action.update_own",
    "evidence.create",
    "evidence.review",
  ],
  WL: [
    "diagnostic.contribute",
    "tom.contribute",
    "decision.edit",
    "decision.decide",
    "dependency.edit",
    "action.update_own",
    "evidence.create",
  ],
  FIN: ["action.update_own", "evidence.create", "evidence.review"],
  TO: [
    "charter.edit",
    "diagnostic.edit",
    "dependency.edit",
    "action.edit",
    "evidence.create",
    "evidence.review",
    "gate.configure",
    "team.assign",
  ],
  KDS: ["outcome.edit", "kpi_definition.edit", "baseline.edit", "action.update_own", "evidence.create"],
  TD: ["tom.contribute", "dependency.edit", "action.update_own", "evidence.create"],
  ADM_METHOD: ["methodology.configure"],
} as const satisfies Record<string, readonly (keyof typeof P2_PERMISSIONS)[]>;

/**
 * P3 role defaults (seeded by 0024; ADR-0021 §6, permissions matrix "P3"). Business approvals (portfolio selection,
 * weight sets and overrides, funding) go to SP, and funding also to FIN; finance.validate (P1 catalogue) stays FIN's.
 * AUD, CM, SEC, TD, ADM_TECH and ADM_ACCESS get no P3 permission.
 */
export const P3_ROLE_PERMISSIONS = {
  SP: ["portfolio.select", "prioritization.approve", "deliverable.accept", "funding.approve"],
  TL: [
    "initiative.edit",
    "initiative.launch",
    "prioritization.score",
    "prioritization.edit",
    "roadmap.edit",
    "roadmap.approve",
    "deliverable.accept",
    "capacity.edit",
    "business_case.edit",
    "benefit_formula.edit",
  ],
  BO: ["prioritization.score", "deliverable.accept", "capacity.commit", "benefit_formula.edit"],
  WL: ["initiative.edit", "prioritization.score", "roadmap.edit", "capacity.edit", "business_case.edit"],
  FIN: ["funding.approve"],
  TO: [
    "initiative.edit",
    "prioritization.edit",
    "roadmap.edit",
    "roadmap.approve",
    "capacity.edit",
    "capacity.commit",
    "business_case.edit",
  ],
  KDS: ["benefit_formula.edit"],
  ADM_METHOD: ["dependency_type.configure"],
} as const satisfies Record<string, readonly (keyof typeof P3_PERMISSIONS)[]>;

/**
 * P4 role defaults, slices I and C (seeded by 0031; ADR-0026 §8, permissions matrix "P4"). approval.decide
 * (business_approval) goes ONLY to SP, BO and FIN, the roles that already hold an approval permission: TL, TO, WL and CM
 * must stay non-approver roles (creator-derived assignments, F-DG1-106; team roles, ADR-0020 §3). Deciding also needs
 * the approval to be assigned to the caller, their group or someone they act for (record-level rule).
 * ADM_TECH configures calendars and jobs, ADM_ACCESS records delegations on request; neither decides anything.
 * AUD gets no P4 permission (read-only through BASE_READ and its scope).
 */
export const P4_ROLE_PERMISSIONS = {
  SP: ["delegation.create_own", "approval.request", "approval.decide"],
  TL: ["role_mapping.assign", "delegation.create_own", "approval.request", "decision_right.configure", "raci.edit"],
  BO: ["delegation.create_own", "approval.request", "approval.decide"],
  WL: ["delegation.create_own", "approval.request"],
  FIN: ["delegation.create_own", "approval.request", "approval.decide"],
  TO: [
    "group.manage",
    "role_mapping.assign",
    "delegation.create_own",
    "approval.request",
    "decision_right.configure",
    "raci.edit",
  ],
  KDS: ["delegation.create_own"],
  TD: ["delegation.create_own"],
  CM: ["delegation.create_own"],
  SEC: ["delegation.create_own"],
  ADM_TECH: ["calendar.configure", "job.read", "job.configure"],
  ADM_ACCESS: ["delegation.manage"],
} as const satisfies Record<string, readonly (keyof typeof P4_PERMISSIONS)[]>;

/**
 * P4 role defaults, slice A (seeded by 0036; ADR-0027 §11, permissions matrix §11). Owner roles of REQ-S07-001/-003/
 * -007/-009/-012: KDS and TL define KPIs, versions, thresholds and trajectories; KDS and BO submit actuals; SP, TL and
 * BO may accept as the configured reviewer (record-level: they must resolve to the version's reviewer party); TL and BO
 * override RAG. TO manages reporting periods. AUD, CM, SEC, TD, WL, FIN and the technical admins get none.
 */
export const P4_KPI_ROLE_PERMISSIONS = {
  SP: ["kpi_actual.accept"],
  TL: [
    "kpi_version.edit",
    "kpi_version.activate",
    "kpi_threshold.configure",
    "target_trajectory.edit",
    "kpi_actual.accept",
    "rag.override",
    "data_quality.manage",
  ],
  BO: ["kpi_actual.submit", "kpi_actual.accept", "rag.override"],
  TO: ["reporting_period.manage"],
  KDS: [
    "kpi_version.edit",
    "kpi_version.activate",
    "kpi_threshold.configure",
    "target_trajectory.edit",
    "kpi_actual.submit",
    "data_quality.manage",
  ],
} as const satisfies Record<string, readonly (keyof typeof P4_KPI_PERMISSIONS)[]>;

/**
 * P4 role defaults, slice B (seeded by 0040; ADR-0029 §9, ADR-0030 §9, permissions matrix §12). Owner roles of
 * REQ-PB-058/-074/-075, REQ-S08-001/-003/-013/-018 and REQ-PB-013: TL and BO create and edit benefits, allocate and
 * manage shared-benefit groups; BO advances the lifecycle; BO, WL and KDS record and submit measurements; TL and FIN
 * edit scenarios. Finance decisions stay finance.validate (FIN only). AUD, SP, TO, CM, SEC, TD and the technical admins
 * get none.
 */
export const P4_BENEFIT_ROLE_PERMISSIONS = {
  TL: ["benefit.edit", "benefit.allocate", "benefit_scenario.edit", "benefit_group.manage"],
  BO: ["benefit.edit", "benefit.advance", "benefit.allocate", "benefit.measure", "benefit_group.manage"],
  WL: ["benefit.measure"],
  FIN: ["benefit_scenario.edit"],
  KDS: ["benefit.measure"],
} as const satisfies Record<string, readonly (keyof typeof P4_BENEFIT_PERMISSIONS)[]>;

/**
 * P4 role defaults, slice E (seeded by 0043; ADR-0031 §9, permissions matrix §13). Owner roles of REQ-PB-079 ("create/
 * edit:WL,TL,TO"), REQ-PB-085 ("create:BO,TL,FIN") and REQ-S09-007 ("budget:FIN,TL"); TL and TO configure the
 * corrective-action rules. AUD, SP, KDS, TD, CM, SEC and the technical admins get none.
 */
export const P4_RAID_ROLE_PERMISSIONS = {
  TL: ["raid.edit", "corrective_action.manage", "corrective_rule.configure", "budget.edit"],
  BO: ["corrective_action.manage"],
  WL: ["raid.edit"],
  FIN: ["corrective_action.manage", "budget.edit"],
  TO: ["raid.edit", "corrective_rule.configure"],
} as const satisfies Record<string, readonly (keyof typeof P4_RAID_PERMISSIONS)[]>;

/**
 * P4 role defaults, slice D (seeded by 0046; ADR-0032 §9, permissions matrix §14). Owner roles of REQ-PB-060 and
 * REQ-S10-005 ("configure:TO"), REQ-S10-011 ("prepare:SEC"; "approve-minutes:chair"), REQ-PB-068 and REQ-PB-081
 * ("create:TL,SEC"; "decide:Owner(executive)"). Chairing is a record-level right: holding meeting.chair is necessary,
 * and the caller must also be the meeting's chair. Deciding needs executive_decision.decide AND being the decision's
 * owner or that owner's active delegate. AUD, KDS, TD, CM and the technical admins get none.
 */
export const P4_GOVERNANCE_ROLE_PERMISSIONS = {
  SP: ["meeting.chair", "executive_decision.decide"],
  TL: ["meeting.prepare", "meeting.chair", "executive_decision.create", "escalation_rule.configure"],
  BO: ["meeting.chair", "executive_decision.decide"],
  WL: ["meeting.chair"],
  FIN: ["meeting.chair", "executive_decision.decide"],
  TO: ["forum.configure", "meeting.prepare", "meeting.chair", "executive_decision.create", "escalation_rule.configure"],
  SEC: ["meeting.prepare", "executive_decision.create"],
} as const satisfies Record<string, readonly (keyof typeof P4_GOVERNANCE_PERMISSIONS)[]>;

/** Slices F and G role defaults (0049). No technical admin; AUD only the read code lesson.search. */
export const P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS = {
  SP: ["assessment.respond", "lesson.search"],
  TL: [
    "adoption.edit",
    "assessment.respond",
    "initiative.complete_delivery",
    "initiative.close",
    "transformation.close",
    "performance_area.reopen",
    "bau_handover.prepare",
    "lesson.search",
  ],
  BO: [
    "adoption.edit",
    "assessment_form.manage",
    "assessment.respond",
    "assessment.review",
    "proficiency.record",
    "champion_constraint.raise",
    "adoption_status.set",
    "performance_area.manage",
    "performance_area.reopen",
    "bau_handover.accept",
    "control.manage",
    "control_check.record",
    "sustainment_review.complete",
    "improvement.edit",
    "lesson.edit",
    "lesson.search",
    "transition_decision.propose",
  ],
  WL: [
    "adoption.edit",
    "assessment_form.manage",
    "assessment.respond",
    "proficiency.record",
    "champion_constraint.raise",
    "initiative.complete_delivery",
    "bau_handover.prepare",
    "lesson.search",
  ],
  FIN: ["assessment.respond", "sustainment_review.complete", "lesson.search", "transition_decision.propose"],
  TO: [
    "assessment.respond",
    "performance_area.manage",
    "control.manage",
    "control_check.record",
    "improvement.edit",
    "lesson.edit",
    "lesson.search",
  ],
  KDS: ["assessment.respond", "sustainment_review.complete", "lesson.search"],
  TD: ["assessment.respond", "lesson.search"],
  CM: ["assessment.respond", "lesson.search"],
  SEC: ["assessment.respond", "lesson.search"],
  AUD: ["lesson.search"],
} as const satisfies Record<string, readonly (keyof typeof P4_ADOPTION_SUSTAINMENT_PERMISSIONS)[]>;

/** Slice H role defaults (0053). No technical admin; nothing for AUD. */
export const P4_GATES_CHANGE_ROLE_PERMISSIONS = {
  SP: ["phase_step.review", "gate.review", "gate_exception.decide"],
  TL: [
    "phase_step.manage",
    "phase_step.progress",
    "gate_exception.request",
    "scale.transition",
    "risk_disposition.propose",
    "change_request.raise",
    "change_control.configure",
  ],
  BO: [
    "phase_step.progress",
    "phase_step.review",
    "gate.review",
    "gate_exception.decide",
    "risk_disposition.propose",
    "change_request.raise",
  ],
  WL: ["phase_step.progress", "risk_disposition.propose", "change_request.raise"],
  FIN: ["phase_step.progress", "phase_step.review", "gate.review", "change_request.raise"],
  TO: [
    "phase_step.manage",
    "phase_step.progress",
    "phase_step.review",
    "gate.review",
    "change_request.raise",
    "change_control.configure",
  ],
  KDS: ["phase_step.progress", "change_request.raise"],
} as const satisfies Record<string, readonly (keyof typeof P4_GATES_CHANGE_PERMISSIONS)[]>;

/** Slices J and K role defaults (0057). No technical admin; nothing for AUD. */
export const P4_DASHBOARD_TRACE_ROLE_PERMISSIONS = {
  TL: ["traceability.link", "inherited_record.record", "workstream.manage"],
  BO: ["traceability.link"],
  WL: ["traceability.link"],
  TO: ["traceability.link", "inherited_record.record", "workstream.manage", "portfolio.manage", "dashboard.configure"],
  KDS: ["dashboard.configure"],
} as const satisfies Record<string, readonly (keyof typeof P4_DASHBOARD_TRACE_PERMISSIONS)[]>;

/** P5 slice A role defaults (0064). AUD gets methodology.read only; no technical admin gets a business approval. */
export const P5_STUDIO_ROLE_PERMISSIONS = {
  SP: ["methodology.read", "methodology_migration.approve"],
  TL: ["methodology.read"],
  TO: ["methodology.read", "methodology.review", "config_review_policy.configure"],
  AUD: ["methodology.read"],
  ADM_METHOD: [
    "methodology.read",
    "methodology.publish",
    "source_coverage.run",
    "methodology_migration.plan",
    "methodology_migration.execute",
  ],
} as const satisfies Record<string, readonly (keyof typeof P5_STUDIO_PERMISSIONS)[]>;

/** P5 slices B and C role defaults (0070). AUD and the technical admins get procedure.read only. */
export const P5_FORMS_PROCEDURES_ROLE_PERMISSIONS = {
  SP: ["form_record.comment", "procedure.read", "procedure.launch", "procedure.act"],
  TL: ["form_record.comment", "procedure.read", "procedure.launch", "procedure.act", "procedure.manage"],
  BO: ["form_record.comment", "procedure.read", "procedure.launch", "procedure.act"],
  WL: ["form_record.comment", "procedure.read", "procedure.launch", "procedure.act"],
  FIN: ["form_record.comment", "procedure.read", "procedure.launch", "procedure.act"],
  TO: ["form_record.comment", "procedure.read", "procedure.launch", "procedure.act", "procedure.manage"],
  KDS: ["form_record.comment", "procedure.read", "procedure.launch", "procedure.act"],
  TD: ["form_record.comment", "procedure.read", "procedure.act"],
  CM: ["form_record.comment", "procedure.read", "procedure.act"],
  SEC: ["procedure.read"],
  AUD: ["procedure.read"],
  ADM_TECH: ["procedure.read"],
  ADM_ACCESS: ["procedure.read"],
  ADM_METHOD: ["procedure.read"],
} as const satisfies Record<string, readonly (keyof typeof P5_FORMS_PROCEDURES_PERMISSIONS)[]>;

/** P5 slices D and E role defaults (0076). AUD gets automation.read only; no technical admin gets a business approval. */
export const P5_AUTOMATION_ROLE_PERMISSIONS = {
  SP: ["notification.preferences", "gate_condition.close"],
  TL: ["notification.preferences", "gate_condition.close"],
  BO: ["notification.preferences", "gate_condition.close"],
  WL: ["notification.preferences", "gate_condition.close"],
  FIN: ["notification.preferences", "gate_condition.close"],
  TO: ["automation.read", "automation.review", "notification.preferences", "gate_condition.close"],
  KDS: ["notification.preferences", "gate_condition.close"],
  TD: ["notification.preferences", "gate_condition.close"],
  CM: ["notification.preferences", "gate_condition.close"],
  SEC: ["notification.preferences"],
  AUD: ["automation.read"],
  ADM_TECH: [
    "automation.read",
    "automation.repair",
    "job.repair",
    "notification_policy.configure",
    "notification.preferences",
  ],
  ADM_ACCESS: ["notification.preferences"],
  ADM_METHOD: ["automation.read", "automation.configure", "automation.repair", "notification.preferences"],
} as const satisfies Record<string, readonly (keyof typeof P5_AUTOMATION_PERMISSIONS)[]>;

/**
 * P5 slice F role defaults (seeded by 0082; ADR-0045 §8). Issue: TL, TO, SEC (REQ-S13-007); owner updates: TL, WL
 * (REQ-S09-011). AUD and the technical administrators get none (AUD stays read-only).
 */
export const P5_REPORTING_ROLE_PERMISSIONS = {
  SP: ["report.generate", "export.create"],
  TL: ["report.generate", "report.issue", "export.create", "owner_update.submit"],
  BO: ["report.generate", "export.create"],
  WL: ["report.generate", "export.create", "owner_update.submit"],
  FIN: ["report.generate", "export.create"],
  TO: ["report.generate", "report.issue", "export.create"],
  KDS: ["report.generate", "export.create"],
  TD: ["report.generate", "export.create"],
  CM: ["report.generate", "export.create"],
  SEC: ["report.generate", "report.issue", "export.create"],
  AUD: [],
  ADM_TECH: [],
  ADM_ACCESS: [],
  ADM_METHOD: [],
} as const satisfies Record<string, readonly (keyof typeof P5_REPORTING_PERMISSIONS)[]>;

/**
 * P5 slices G and H role defaults (seeded by 0087; ADR-0047 §6, ADR-0048 §7). Restatement: request TL, BO, FIN, KDS;
 * approve SP, BO, FIN. Launch plan and health check: TL, TO; Day-90 test: SP, TL; financial extension: enable
 * ADM_METHOD, define FIN. AUD and ADM_TECH/ADM_ACCESS get none.
 */
export const P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS = {
  SP: ["kpi_restatement.approve", "day_ninety_test.respond"],
  TL: ["kpi_restatement.request", "launch_plan.edit", "day_ninety_test.respond", "health_check.assess"],
  BO: ["kpi_restatement.request", "kpi_restatement.approve"],
  WL: [],
  FIN: ["kpi_restatement.request", "kpi_restatement.approve", "financial_metrics.define"],
  TO: ["launch_plan.edit", "health_check.assess"],
  KDS: ["kpi_restatement.request"],
  TD: [],
  CM: [],
  SEC: [],
  AUD: [],
  ADM_TECH: [],
  ADM_ACCESS: [],
  ADM_METHOD: ["financial_metrics.enable"],
} as const satisfies Record<string, readonly (keyof typeof P5_KPI_LAUNCH_HEALTH_PERMISSIONS)[]>;

export const ROLES = {
  SP: {
    kind: "source",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      "gate.decide",
      ...P2_ROLE_PERMISSIONS.SP,
      ...P3_ROLE_PERMISSIONS.SP,
      ...P4_ROLE_PERMISSIONS.SP,
      ...P4_KPI_ROLE_PERMISSIONS.SP,
      ...P4_GOVERNANCE_ROLE_PERMISSIONS.SP,
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.SP,
      ...P4_GATES_CHANGE_ROLE_PERMISSIONS.SP,
      ...P5_STUDIO_ROLE_PERMISSIONS.SP,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.SP,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.SP,
      ...P5_REPORTING_ROLE_PERMISSIONS.SP,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.SP,
    ],
  },
  TL: {
    kind: "source",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      "transformation.create",
      "transformation.update",
      "transformation.archive",
      "audit.read",
      ...P2_ROLE_PERMISSIONS.TL,
      ...P3_ROLE_PERMISSIONS.TL,
      ...P4_ROLE_PERMISSIONS.TL,
      ...P4_KPI_ROLE_PERMISSIONS.TL,
      ...P4_BENEFIT_ROLE_PERMISSIONS.TL,
      ...P4_RAID_ROLE_PERMISSIONS.TL,
      ...P4_GOVERNANCE_ROLE_PERMISSIONS.TL,
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.TL,
      ...P4_GATES_CHANGE_ROLE_PERMISSIONS.TL,
      ...P4_DASHBOARD_TRACE_ROLE_PERMISSIONS.TL,
      ...P5_STUDIO_ROLE_PERMISSIONS.TL,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.TL,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.TL,
      ...P5_REPORTING_ROLE_PERMISSIONS.TL,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.TL,
    ],
  },
  BO: {
    kind: "source",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      "gate.decide",
      ...P2_ROLE_PERMISSIONS.BO,
      ...P3_ROLE_PERMISSIONS.BO,
      ...P4_ROLE_PERMISSIONS.BO,
      ...P4_KPI_ROLE_PERMISSIONS.BO,
      ...P4_BENEFIT_ROLE_PERMISSIONS.BO,
      ...P4_RAID_ROLE_PERMISSIONS.BO,
      ...P4_GOVERNANCE_ROLE_PERMISSIONS.BO,
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.BO,
      ...P4_GATES_CHANGE_ROLE_PERMISSIONS.BO,
      ...P4_DASHBOARD_TRACE_ROLE_PERMISSIONS.BO,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.BO,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.BO,
      ...P5_REPORTING_ROLE_PERMISSIONS.BO,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.BO,
    ],
  },
  WL: {
    kind: "source",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      ...P2_ROLE_PERMISSIONS.WL,
      ...P3_ROLE_PERMISSIONS.WL,
      ...P4_ROLE_PERMISSIONS.WL,
      ...P4_BENEFIT_ROLE_PERMISSIONS.WL,
      ...P4_RAID_ROLE_PERMISSIONS.WL,
      ...P4_GOVERNANCE_ROLE_PERMISSIONS.WL,
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.WL,
      ...P4_GATES_CHANGE_ROLE_PERMISSIONS.WL,
      ...P4_DASHBOARD_TRACE_ROLE_PERMISSIONS.WL,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.WL,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.WL,
      ...P5_REPORTING_ROLE_PERMISSIONS.WL,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.WL,
    ],
  },
  FIN: {
    kind: "source",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      "finance.validate",
      ...P2_ROLE_PERMISSIONS.FIN,
      ...P3_ROLE_PERMISSIONS.FIN,
      ...P4_ROLE_PERMISSIONS.FIN,
      ...P4_BENEFIT_ROLE_PERMISSIONS.FIN,
      ...P4_RAID_ROLE_PERMISSIONS.FIN,
      ...P4_GOVERNANCE_ROLE_PERMISSIONS.FIN,
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.FIN,
      ...P4_GATES_CHANGE_ROLE_PERMISSIONS.FIN,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.FIN,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.FIN,
      ...P5_REPORTING_ROLE_PERMISSIONS.FIN,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.FIN,
    ],
  },
  TO: {
    kind: "source",
    inheritsDownward: true,
    permissions: [
      ...BASE_READ,
      "transformation.create",
      "transformation.update",
      "transformation.archive",
      "audit.read",
      ...P2_ROLE_PERMISSIONS.TO,
      ...P3_ROLE_PERMISSIONS.TO,
      ...P4_ROLE_PERMISSIONS.TO,
      ...P4_KPI_ROLE_PERMISSIONS.TO,
      ...P4_RAID_ROLE_PERMISSIONS.TO,
      ...P4_GOVERNANCE_ROLE_PERMISSIONS.TO,
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.TO,
      ...P4_GATES_CHANGE_ROLE_PERMISSIONS.TO,
      ...P4_DASHBOARD_TRACE_ROLE_PERMISSIONS.TO,
      ...P5_STUDIO_ROLE_PERMISSIONS.TO,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.TO,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.TO,
      ...P5_REPORTING_ROLE_PERMISSIONS.TO,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.TO,
    ],
  },
  KDS: {
    kind: "implementation",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      ...P2_ROLE_PERMISSIONS.KDS,
      ...P3_ROLE_PERMISSIONS.KDS,
      ...P4_ROLE_PERMISSIONS.KDS,
      ...P4_KPI_ROLE_PERMISSIONS.KDS,
      ...P4_BENEFIT_ROLE_PERMISSIONS.KDS,
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.KDS,
      ...P4_GATES_CHANGE_ROLE_PERMISSIONS.KDS,
      ...P4_DASHBOARD_TRACE_ROLE_PERMISSIONS.KDS,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.KDS,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.KDS,
      ...P5_REPORTING_ROLE_PERMISSIONS.KDS,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.KDS,
    ],
  },
  TD: {
    kind: "implementation",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      ...P2_ROLE_PERMISSIONS.TD,
      ...P4_ROLE_PERMISSIONS.TD,
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.TD,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.TD,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.TD,
      ...P5_REPORTING_ROLE_PERMISSIONS.TD,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.TD,
    ],
  },
  CM: {
    kind: "implementation",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      ...P4_ROLE_PERMISSIONS.CM,
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.CM,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.CM,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.CM,
      ...P5_REPORTING_ROLE_PERMISSIONS.CM,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.CM,
    ],
  },
  SEC: {
    kind: "implementation",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      ...P4_ROLE_PERMISSIONS.SEC,
      ...P4_GOVERNANCE_ROLE_PERMISSIONS.SEC,
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.SEC,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.SEC,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.SEC,
      ...P5_REPORTING_ROLE_PERMISSIONS.SEC,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.SEC,
    ],
  },
  AUD: {
    kind: "implementation",
    inheritsDownward: true,
    permissions: [
      ...BASE_READ,
      "audit.read",
      "user.read",
      "access.read",
      ...P4_ADOPTION_SUSTAINMENT_ROLE_PERMISSIONS.AUD,
      ...P5_STUDIO_ROLE_PERMISSIONS.AUD,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.AUD,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.AUD,
    ],
  },
  // Technical administrators: configuration only, no business-record access and never an approver
  // (REQ-S10-003, REQ-S06-010; permissions matrix: Transformation row "— (technical support only)").
  ADM_TECH: {
    kind: "technical_admin",
    inheritsDownward: false,
    permissions: [
      "organization.read",
      "organization.manage",
      "business_unit.read",
      "business_unit.manage",
      "role.read",
      ...P4_ROLE_PERMISSIONS.ADM_TECH,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.ADM_TECH,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.ADM_TECH,
    ],
  },
  ADM_ACCESS: {
    kind: "technical_admin",
    inheritsDownward: false,
    permissions: [
      "organization.read",
      "business_unit.read",
      "role.read",
      "user.read",
      "user.manage",
      "access.read",
      "access.assign",
      ...P4_ROLE_PERMISSIONS.ADM_ACCESS,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.ADM_ACCESS,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.ADM_ACCESS,
    ],
  },
  ADM_METHOD: {
    kind: "technical_admin",
    inheritsDownward: false,
    permissions: [
      "organization.read",
      "role.read",
      ...P2_ROLE_PERMISSIONS.ADM_METHOD,
      ...P3_ROLE_PERMISSIONS.ADM_METHOD,
      ...P5_STUDIO_ROLE_PERMISSIONS.ADM_METHOD,
      ...P5_FORMS_PROCEDURES_ROLE_PERMISSIONS.ADM_METHOD,
      ...P5_AUTOMATION_ROLE_PERMISSIONS.ADM_METHOD,
      ...P5_KPI_LAUNCH_HEALTH_ROLE_PERMISSIONS.ADM_METHOD,
    ],
  },
} as const satisfies Record<string, RoleDefinition>;
export type RoleCode = keyof typeof ROLES;
export const ROLE_CODES = Object.keys(ROLES) as RoleCode[];

/** Categories a technical_admin role may never hold (enforced again by a DB trigger, ADR-0006). */
export const APPROVAL_CATEGORIES: readonly PermissionCategory[] = ["business_approval", "finance_validation"];
