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

/**
 * P5 slices I and J (T-DG5-ARCH-06; ADR-0049 §10, ADR-0050 §8): branding and the demo environment. Seeded by 0091.
 * Two configure codes, both held by ADM_TECH. Reading the reader, provenance, element profiles, branding, navigation,
 * the environment and the walkthrough needs a session only; editing the reader texts, provenance overrides, question
 * tags and block links uses the slice A Studio rights. No code is a business_approval or finance_validation code; AUD
 * gets nothing here and stays read-only.
 */
export const P5_READER_DEMO_PERMISSIONS = {
  "branding.configure": "configure",
  "demo.reset": "configure",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P6 slices E and F (seeded by 0100; ADR-0051 §7, ADR-0052 §9; T-DG6-ARCH-01). A configurable starting point, not a
 * Mobily-approved access policy. sensitive_record.grant marks a benefit, business case or evidence item sensitive and
 * grants or revokes explicit access (REQ-S10-002 "grant:TO,ADM (access admin)"); sensitive_record.read reads the flags
 * and the grant list, never the record itself; audit_event.read is Administration > Audit and /api/v1/audit-events
 * (REQ-S16-032 "view:AUD,ADM(scoped)"); upload_policy.configure changes the upload allow-list and size limit;
 * security.read reads the upload policy and the rate-limit matrix. No code is a business_approval or
 * finance_validation code; AUD gets read codes only.
 */
export const P6_ACCESS_HARDENING_PERMISSIONS = {
  "sensitive_record.grant": "configure",
  "sensitive_record.read": "read",
  "audit_event.read": "read",
  "upload_policy.configure": "configure",
  "security.read": "read",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P6 slices J and C (seeded by 0103; ADR-0053 §9, ADR-0054 §5; T-DG6-ARCH-02). A configurable starting point, not a
 * Mobily-approved access policy. operations.read reads Administration > Operations (operational exceptions, the worker
 * heartbeat, the service identities; REQ-S12-019 "shown to admins and data owners"); operations.acknowledge
 * acknowledges or resolves an exception; service_identity.configure narrows or restores a job's or connector's grant
 * (REQ-S16-029); identity.read reads Administration > Identity, never the client secret (REQ-S16-007);
 * storage.configure reads, changes and tests the evidence-storage setting (REQ-S16-006); notification_channel.configure
 * reads, changes and tests the notification channels (REQ-S12-023). No code is a business_approval or
 * finance_validation code; AUD gets read codes only.
 */
export const P6_OPERATIONS_CHANNELS_PERMISSIONS = {
  "operations.read": "read",
  "operations.acknowledge": "write",
  "service_identity.configure": "configure",
  "identity.read": "read",
  "storage.configure": "configure",
  "notification_channel.configure": "configure",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P6 slices B and A (seeded by 0107; ADR-0055 §9, ADR-0056 §9; T-DG6-ARCH-03). A configurable starting point, not a
 * Mobily-approved access policy. connector.read reads Administration > Integrations (connectors, configuration
 * versions, runs, counts, reconciliation, errors; never staged row values; REQ-S17-001 "view-runs:ADM,KDS");
 * connector.configure creates, changes, enables, disables and tests connectors and mappings ("configure:ADM");
 * connector.run runs a connector now or retries a failed run; webhook.configure manages webhook endpoints and their
 * secret references; import.read, import.create and import.commit are the staged imports (REQ-S17-002 "import:KDS,ADM":
 * KDS; the technical administrators hold no business-record write, REQ-S10-003); outbound_write.read and
 * outbound_write.execute are the guarded downstream writes (REQ-S17-006 "execute-write: explicitly granted role only":
 * TD alone); external_change.flag and external_change.confirm are the deliverable external-change flag and its
 * confirmation with reviewed evidence (REQ-S01-005 "confirm-external: evidence reviewer (BO or TD)"). No code is a
 * business_approval or finance_validation code; AUD gets read codes only.
 */
export const P6_INTEGRATIONS_PERMISSIONS = {
  "connector.read": "read",
  "connector.configure": "configure",
  "connector.run": "write",
  "webhook.configure": "configure",
  "import.read": "read",
  "import.create": "write",
  "import.commit": "write",
  "outbound_write.read": "read",
  "outbound_write.execute": "write",
  "external_change.flag": "write",
  "external_change.confirm": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P6 slices H and G permissions (seeded by 0109; T-DG6-ARCH-04; ADR-0057 §9). saved_view.manage: create, change, set as
 * default and delete one's OWN saved list views; saved_view.share: share one's own view with the organization. Search,
 * help topics and one's own drafts need no new code (search admits exactly what the record views admit, through
 * ReadScope). No business_approval or finance_validation code; AUD gets neither (it applies shared views read-only).
 */
export const P6_SEARCH_PERMISSIONS = {
  "saved_view.manage": "write",
  "saved_view.share": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P6 slice D (seeded by 0112; ADR-0059 §9): the optional assistant. `assistant.use` opens one's own conversations and
 * takes one's own draft suggestions to a draft prefill (retrieval admits exactly what the caller's record-view
 * permissions admit, through ReadScope); `assistant.configure` reads and changes the assistant setting and turns it on
 * or off. Neither is an approval: the assistant approves, validates, certifies and changes nothing (REQ-S17-008).
 */
export const P6_ASSISTANT_PERMISSIONS = {
  "assistant.use": "write",
  "assistant.configure": "configure",
} as const satisfies Record<string, PermissionCategory>;

/** Every P6 permission block (each P6 architecture task appends its block here and to PERMISSIONS). */
export const P6_PERMISSIONS = {
  ...P6_ACCESS_HARDENING_PERMISSIONS,
  ...P6_OPERATIONS_CHANNELS_PERMISSIONS,
  ...P6_INTEGRATIONS_PERMISSIONS,
  ...P6_SEARCH_PERMISSIONS,
  ...P6_ASSISTANT_PERMISSIONS,
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
  ...P5_READER_DEMO_PERMISSIONS,
  ...P6_PERMISSIONS,
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

/**
 * P5 slices I and J role defaults (seeded by 0091; ADR-0049 §10, ADR-0050 §8): branding.configure and demo.reset for
 * ADM_TECH only. Every other role gets none.
 */
export const P5_READER_DEMO_ROLE_PERMISSIONS = {
  SP: [],
  TL: [],
  BO: [],
  WL: [],
  FIN: [],
  TO: [],
  KDS: [],
  TD: [],
  CM: [],
  SEC: [],
  AUD: [],
  ADM_TECH: ["branding.configure", "demo.reset"],
  ADM_ACCESS: [],
  ADM_METHOD: [],
} as const satisfies Record<string, readonly (keyof typeof P5_READER_DEMO_PERMISSIONS)[]>;

/**
 * P6 slices E and F role defaults (seeded by 0100; ADR-0051 §7, ADR-0052 §9). TO and ADM_ACCESS grant; TO, AUD and
 * ADM_ACCESS read the sensitivity metadata; AUD, ADM_TECH and ADM_ACCESS read the global audit list (a technical admin's
 * organization-level assignment does not inherit downward, so it sees organization-level events only: ADR-0052 §8);
 * ADM_TECH configures uploads; ADM_TECH and AUD read the security settings.
 */
export const P6_ACCESS_HARDENING_ROLE_PERMISSIONS = {
  SP: [],
  TL: [],
  BO: [],
  WL: [],
  FIN: [],
  TO: ["sensitive_record.grant", "sensitive_record.read"],
  KDS: [],
  TD: [],
  CM: [],
  SEC: [],
  AUD: ["sensitive_record.read", "audit_event.read", "security.read"],
  ADM_TECH: ["audit_event.read", "upload_policy.configure", "security.read"],
  ADM_ACCESS: ["sensitive_record.grant", "sensitive_record.read", "audit_event.read"],
  ADM_METHOD: [],
} as const satisfies Record<string, readonly (keyof typeof P6_ACCESS_HARDENING_PERMISSIONS)[]>;

/**
 * P6 slices J and C role defaults (seeded by 0103; ADR-0053 §9, ADR-0054 §5). ADM_TECH, TO, KDS, TD and AUD read
 * Administration > Operations; ADM_TECH and KDS acknowledge and resolve exceptions; ADM_TECH, ADM_ACCESS and AUD read
 * Administration > Identity; ADM_TECH alone configures service identities, storage and notification channels.
 */
export const P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS = {
  SP: [],
  TL: [],
  BO: [],
  WL: [],
  FIN: [],
  TO: ["operations.read"],
  KDS: ["operations.read", "operations.acknowledge"],
  TD: ["operations.read"],
  CM: [],
  SEC: [],
  AUD: ["operations.read", "identity.read"],
  ADM_TECH: [
    "operations.read",
    "operations.acknowledge",
    "service_identity.configure",
    "identity.read",
    "storage.configure",
    "notification_channel.configure",
  ],
  ADM_ACCESS: ["identity.read"],
  ADM_METHOD: [],
} as const satisfies Record<string, readonly (keyof typeof P6_OPERATIONS_CHANNELS_PERMISSIONS)[]>;

/**
 * P6 slices B and A role defaults (seeded by 0107; ADR-0055 §9, ADR-0056 §9). ADM_TECH configures connectors and
 * webhooks and runs connectors; KDS runs connectors and stages, commits and cancels imports; TD alone executes outbound
 * writes and, with BO, confirms external changes with reviewed evidence; TL, BO, WL and TO flag external changes;
 * ADM_TECH, KDS, TD, TO and AUD read connectors; KDS, BO, TO and AUD read imports; TD, KDS, TO and AUD read outbound
 * writes.
 */
export const P6_INTEGRATIONS_ROLE_PERMISSIONS = {
  SP: [],
  TL: ["external_change.flag"],
  BO: ["import.read", "external_change.flag", "external_change.confirm"],
  WL: ["external_change.flag"],
  FIN: [],
  TO: ["connector.read", "import.read", "outbound_write.read", "external_change.flag"],
  KDS: ["connector.read", "connector.run", "import.read", "import.create", "import.commit", "outbound_write.read"],
  TD: ["connector.read", "outbound_write.read", "outbound_write.execute", "external_change.confirm"],
  CM: [],
  SEC: [],
  AUD: ["connector.read", "import.read", "outbound_write.read"],
  ADM_TECH: ["connector.read", "connector.configure", "connector.run", "webhook.configure"],
  ADM_ACCESS: [],
  ADM_METHOD: [],
} as const satisfies Record<string, readonly (keyof typeof P6_INTEGRATIONS_PERMISSIONS)[]>;

/**
 * P6 slices H and G role defaults (seeded by 0109; ADR-0057 §9): every role except AUD manages its own saved views;
 * TL, BO, WL, TO, KDS and TD may also share them with their organization.
 */
export const P6_SEARCH_ROLE_PERMISSIONS = {
  SP: ["saved_view.manage"],
  TL: ["saved_view.manage", "saved_view.share"],
  BO: ["saved_view.manage", "saved_view.share"],
  WL: ["saved_view.manage", "saved_view.share"],
  FIN: ["saved_view.manage"],
  TO: ["saved_view.manage", "saved_view.share"],
  KDS: ["saved_view.manage", "saved_view.share"],
  TD: ["saved_view.manage", "saved_view.share"],
  CM: ["saved_view.manage"],
  SEC: ["saved_view.manage"],
  AUD: [],
  ADM_TECH: ["saved_view.manage"],
  ADM_ACCESS: ["saved_view.manage"],
  ADM_METHOD: ["saved_view.manage"],
} as const satisfies Record<string, readonly (keyof typeof P6_SEARCH_PERMISSIONS)[]>;

/**
 * P6 slice D role defaults (seeded by 0112; ADR-0059 §9): every role except AUD uses the assistant (AUD stays read-only:
 * a conversation is a write of the caller's own rows, the saved_view.manage precedent); ADM_TECH alone configures it.
 * Reading the setting is also open to operations.read holders (0103), AUD included.
 */
export const P6_ASSISTANT_ROLE_PERMISSIONS = {
  SP: ["assistant.use"],
  TL: ["assistant.use"],
  BO: ["assistant.use"],
  WL: ["assistant.use"],
  FIN: ["assistant.use"],
  TO: ["assistant.use"],
  KDS: ["assistant.use"],
  TD: ["assistant.use"],
  CM: ["assistant.use"],
  SEC: ["assistant.use"],
  AUD: [],
  ADM_TECH: ["assistant.use", "assistant.configure"],
  ADM_ACCESS: ["assistant.use"],
  ADM_METHOD: ["assistant.use"],
} as const satisfies Record<string, readonly (keyof typeof P6_ASSISTANT_PERMISSIONS)[]>;

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
      ...P6_SEARCH_ROLE_PERMISSIONS.SP,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.SP,
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
      ...P6_INTEGRATIONS_ROLE_PERMISSIONS.TL,
      ...P6_SEARCH_ROLE_PERMISSIONS.TL,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.TL,
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
      ...P6_INTEGRATIONS_ROLE_PERMISSIONS.BO,
      ...P6_SEARCH_ROLE_PERMISSIONS.BO,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.BO,
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
      ...P6_INTEGRATIONS_ROLE_PERMISSIONS.WL,
      ...P6_SEARCH_ROLE_PERMISSIONS.WL,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.WL,
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
      ...P6_SEARCH_ROLE_PERMISSIONS.FIN,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.FIN,
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
      ...P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS.TO,
      ...P6_ACCESS_HARDENING_ROLE_PERMISSIONS.TO,
      ...P6_INTEGRATIONS_ROLE_PERMISSIONS.TO,
      ...P6_SEARCH_ROLE_PERMISSIONS.TO,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.TO,
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
      ...P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS.KDS,
      ...P6_INTEGRATIONS_ROLE_PERMISSIONS.KDS,
      ...P6_SEARCH_ROLE_PERMISSIONS.KDS,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.KDS,
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
      ...P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS.TD,
      ...P6_INTEGRATIONS_ROLE_PERMISSIONS.TD,
      ...P6_SEARCH_ROLE_PERMISSIONS.TD,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.TD,
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
      ...P6_SEARCH_ROLE_PERMISSIONS.CM,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.CM,
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
      ...P6_SEARCH_ROLE_PERMISSIONS.SEC,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.SEC,
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
      ...P6_ACCESS_HARDENING_ROLE_PERMISSIONS.AUD,
      ...P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS.AUD,
      ...P6_INTEGRATIONS_ROLE_PERMISSIONS.AUD,
      ...P6_SEARCH_ROLE_PERMISSIONS.AUD,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.AUD,
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
      ...P5_READER_DEMO_ROLE_PERMISSIONS.ADM_TECH,
      ...P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS.ADM_TECH,
      ...P6_ACCESS_HARDENING_ROLE_PERMISSIONS.ADM_TECH,
      ...P6_INTEGRATIONS_ROLE_PERMISSIONS.ADM_TECH,
      ...P6_SEARCH_ROLE_PERMISSIONS.ADM_TECH,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.ADM_TECH,
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
      ...P6_ACCESS_HARDENING_ROLE_PERMISSIONS.ADM_ACCESS,
      ...P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS.ADM_ACCESS,
      ...P6_SEARCH_ROLE_PERMISSIONS.ADM_ACCESS,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.ADM_ACCESS,
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
      ...P6_SEARCH_ROLE_PERMISSIONS.ADM_METHOD,
      ...P6_ASSISTANT_ROLE_PERMISSIONS.ADM_METHOD,
    ],
  },
} as const satisfies Record<string, RoleDefinition>;
export type RoleCode = keyof typeof ROLES;
export const ROLE_CODES = Object.keys(ROLES) as RoleCode[];

/** Categories a technical_admin role may never hold (enforced again by a DB trigger, ADR-0006). */
export const APPROVAL_CATEGORIES: readonly PermissionCategory[] = ["business_approval", "finance_validation"];
