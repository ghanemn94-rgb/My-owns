// T-DG7-ARCH-R1: hand-written purposes and column descriptions for the "Coverage repair" sections of
// docs/architecture/data-dictionary.md (rendered by gen-repair.mjs). Each text is taken from the migration that
// creates or changes the column (named), the column's constraints, and the earlier approved section of the table.
// Types, nullability, defaults and constraints are NOT written here: they come from the migrated catalogue.

/** Columns whose meaning is the same on every table (the global rules at the top of the dictionary). */
export const STANDARD = {
  id: "Primary key (uuid).",
  organization_id: "The organization the row belongs to (tenant scope; every read is filtered by it).",
  transformation_id: "The transformation the row belongs to; composite FKs keep linked rows in the same transformation.",
  version:
    "Optimistic-concurrency version: 1 on insert, +1 on every update (served as the ETag, checked against If-Match).",
  created_at: "When the row was inserted.",
  updated_at: "When the row was last changed.",
  created_by: "The user who inserted the row (NULL only for rows written by a migration, the bootstrap CLI or a job).",
  updated_by: "The user who last changed the row (NULL only for rows written by a migration, the bootstrap CLI or a job).",
};

const P1 = "`0001_identity_access.sql`";
const STAMPS_P1 =
  "The P1 row `version, stamps | | standard` (or the list of stamp names) is replaced here by one row per column; the columns are those of the global rules.";

export const TABLES = {
  // ------------------------------------------------------------------------------------------ P1 identity, access --
  organization: {
    purpose:
      "The tenant: one organization per company, with the defaults for timezone (Asia/Riyadh), currency (SAR) and locale (ar) that new transformations and users inherit. The first organization is created by the bootstrap CLI, never by a migration.",
    migrations: P1,
    earlier: `the P1 section \`## Earlier section: organization\`. ${STAMPS_P1}`,
    columns: {
      code: "Stable short code of the organization, unique across the installation.",
      name_en: "English name (1–200 characters).",
      name_ar: "Arabic name (1–200 characters).",
      default_timezone: "IANA timezone that business dates use when a transformation or user sets none (default Asia/Riyadh).",
      default_currency: "ISO 4217 currency code new transformations copy when none is given (default SAR).",
      default_locale: "Default user-interface locale, `ar` (RTL) or `en` (LTR).",
      status: "`active` or `inactive`.",
    },
  },
  business_unit: {
    purpose:
      "A node of the organization's business-unit hierarchy (at most 10 levels, no cycles; enforced by the API and the 0009 trigger `business_unit_hierarchy_guard`). Scoped assignments and transformations hang off it.",
    migrations: `${P1}; \`0009\` (hierarchy guard)`,
    earlier: `the P1 section \`## Earlier section: business_unit\`. The P1 rows \`name_en / name_ar\` and \`version, stamps\` are replaced here by one row per column`,
    columns: {
      parent_business_unit_id:
        "The parent unit in the same organization (composite FK); NULL for a top-level unit directly under the organization.",
      code: "Short code, unique within the organization.",
      name_en: "English name.",
      name_ar: "Arabic name.",
      status: "`active` or `inactive`; an inactive unit cannot receive new transformations (422).",
    },
  },
  app_user: {
    purpose:
      "A person who can sign in (through OIDC, or the dev login bound to `urn:mth:dev-local`). No password column exists. Disabling a user revokes all of their sessions in the same transaction.",
    migrations: P1,
    earlier: `the P1 section \`## Earlier section: app_user\`. ${STAMPS_P1}`,
    columns: {
      organization_id: "The user's home organization. Grants in other organizations are still possible.",
      display_name: "Name shown in the interface and the audit trail (1–200 characters).",
      email: "E-mail address from the identity provider (≤ 320); unique per organization, case-insensitive, when set.",
      preferred_locale: "Interface locale chosen by the user: `ar` or `en`.",
      timezone: "The user's IANA timezone; NULL means the organization default.",
      status: "`active` or `disabled`.",
      last_login_at: "Time of the user's last successful sign-in; NULL if never.",
    },
  },
  user_identity: {
    purpose:
      "The binding of an external identity (OIDC issuer and subject) to one user. Rebinding is an audited admin action (ADR-0005); `mth_app` may DELETE only through that service.",
    migrations: P1,
    earlier: "the P1 section `## Earlier section: user_identity` (the types are now spelled as `format_type()` prints them)",
    columns: {
      user_id: "The bound user.",
      issuer: "OIDC issuer URL (≤ 512).",
      subject: "OIDC `sub` claim (≤ 255); (issuer, subject) is unique.",
      email_at_binding: "The e-mail claim seen when the identity was bound, for audit only.",
      created_at: "When the binding was made.",
      last_login_at: "Last sign-in through this identity.",
    },
  },
  session: {
    purpose:
      "A server-side browser session (ADR-0005). Valid only while not revoked, before both expiries, and while the user is active. Raw tokens are never stored; expired rows are purged by the worker. No `version` column: sessions are not user-editable records.",
    migrations: P1,
    earlier: "the P1 section `## Earlier section: session` (types now spelled as `format_type()` prints them)",
    columns: {
      token_hash: "SHA-256 (32 bytes) of the session cookie value; unique.",
      user_id: "The signed-in user.",
      auth_mode: "`oidc` or `dev` (dev login, development environments only).",
      idp_issuer: "Issuer of the identity provider that authenticated the session (OIDC only).",
      idp_session_id: "The provider's `sid` claim, kept for back-channel logout.",
      csrf_token_hash: "SHA-256 of the session's CSRF token.",
      created_at: "Sign-in time.",
      last_seen_at: "Time of the last authenticated request (drives the idle expiry).",
      idle_expires_at: "The session ends at this time unless activity extends it.",
      absolute_expires_at: "Hard end of the session, never extended; also the purge index.",
      revoked_at: "When the session was revoked (sign-out, user disabled, admin action); NULL while live.",
      user_agent: "Browser user-agent string at sign-in (≤ 512), for the user's own session list.",
    },
  },
  oidc_login_state: {
    purpose:
      "One pending OIDC authorization-code login (PKCE, nonce, return path), single use and browser-bound (migration 0007, F-DG1-103). The callback deletes it with `DELETE … RETURNING`; expired rows are purged.",
    migrations: `${P1}; \`0007\` (browser binding)`,
    earlier: "the P1 section `## Earlier section: oidc_login_state` (types now spelled as `format_type()` prints them)",
    columns: {
      state_hash: "SHA-256 of the OAuth `state` value (primary key).",
      code_verifier: "PKCE code verifier sent with the token request.",
      nonce: "OIDC nonce, checked against the ID token.",
      return_to: "Same-origin path to return to after sign-in; must start with a single `/`.",
      created_at: "When the login started.",
      expires_at: "created_at + 10 minutes; the state is refused after this.",
      browser_binding_hash:
        "SHA-256 of the random `__Host-` pre-session cookie set by `GET /auth/login`; the callback consumes the state only for the same browser.",
    },
  },
  role: {
    purpose:
      "One of the 14 seeded roles (SP, TL, BO, WL, FIN, TO, KDS, TD, CM, SEC, AUD, ADM_TECH, ADM_ACCESS, ADM_METHOD), with fixed UUIDs and permission links from `packages/shared/src/permissions.ts`. Arabic names are provisional translations.",
    migrations: P1,
    earlier: `the P1 section \`## Earlier section: role\`. The P1 rows \`name_en / name_ar\` and \`version, stamps\` are replaced here by one row per column`,
    columns: {
      code: "Role code (unique), for example `TL` or `ADM_ACCESS`.",
      name_en: "English role name.",
      name_ar: "Arabic role name (provisional translation).",
      kind: "`source`, `implementation` or `technical_admin`; a technical-admin role can never hold an approval or Finance-validation permission (trigger `role_permission_no_admin_approver`).",
      inherits_downward: "True when a grant at a scope also applies to every scope below it (organization → business unit → transformation).",
      is_system: "True for the seeded roles, which cannot be deleted.",
    },
  },
  permission: {
    purpose:
      "One permission code (`<area>.<action>`) with its category. Seeded by migrations only; the seed equals `packages/shared/src/permissions.ts`.",
    migrations: `${P1}; later stages insert codes by migration`,
    earlier: "the P1 section `## Earlier section: permission`. The P1 row `description_en / description_ar` is replaced here by one row per column",
    columns: {
      code: "Permission code, `^[a-z_]+\\.[a-z_]+$` (primary key).",
      category: "`read`, `write`, `configure`, `business_approval` or `finance_validation`; the last two are never held by a technical-admin role.",
      description_en: "English description of what the permission allows.",
      description_ar: "Arabic description (provisional translation).",
    },
  },
  role_permission: {
    purpose: "The permissions a role holds. Segregation of duties is enforced on insert and update by `role_permission_no_admin_approver` (ADR-0006).",
    migrations: P1,
    earlier: "the P1 section `## Earlier section: role_permission` (types now spelled as `format_type()` prints them)",
    columns: {
      role_id: "The role (part of the primary key).",
      permission_code: "The permission (part of the primary key).",
      created_at: "When the link was seeded.",
    },
  },
  scoped_assignment: {
    purpose:
      "A grant of one role to one user at one scope node, for an effective period. Revocation never deletes the row. The only source of access: a sponsor or lead field on a record grants nothing.",
    migrations: `${P1}; \`0008\` (derived creator assignment, F-DG1-106)`,
    earlier: `the P1 section \`## Earlier section: scoped_assignment\`. ${STAMPS_P1}`,
    columns: {
      user_id: "The user who receives the role.",
      role_id: "The granted role.",
      scope_type: "Level of the scope node (`organization`, `business_unit`, `transformation`, and the later levels in the CHECK).",
      scope_id: "Id of the scope node; polymorphic, checked by the API to exist in `organization_id`.",
      effective_from: "Start of the grant.",
      effective_to: "End of the grant (exclusive); NULL for open-ended.",
      reason: "Why the grant was made (3–1000 characters).",
      granted_by: "The administrator (or the bootstrap system user) who made the grant.",
      revoked_at: "When the grant was revoked; NULL while active.",
      revoked_by: "Who revoked it (set together with revoked_at and revoke_reason).",
      revoke_reason: "Why it was revoked.",
      derived_from_assignment_id:
        "For a transformation-scope assignment created for the creator of a transformation from a non-inheriting business-unit grant: the source grant (revoking the source revokes it).",
    },
  },
  delegation: {
    purpose:
      "A time-boxed delegation of a user's work items and decisions to another user, optionally limited to a scope and record types. No loops (trigger `delegation_loop_guard`, lock 730224); delegated rights never exceed the delegator's. P4 (0029) added the request and revocation columns.",
    migrations: `${P1}; \`0029_p4_groups_role_mapping_delegation.sql\``,
    earlier:
      "the P1 section `## Earlier section: delegation (P1 table; logic P2/P4)` and the P4 section `## Change section: delegation (0001) — P4 extension (0029)`",
    columns: {
      delegator_user_id: "The user who delegates.",
      delegate_user_id: "The user who acts on the delegator's behalf; never the delegator.",
      scope_type: "Scope level the delegation is limited to; NULL means all of the delegator's scopes.",
      scope_id: "Scope node id; NULL exactly when scope_type is NULL.",
      record_types: "Record types covered; NULL means all.",
      reason_code: "`absence` or `other`.",
      reason_text: "Free-text reason.",
      effective_from: "Start of the delegation.",
      effective_to: "End of the delegation; after effective_from.",
      status: "`active`, `revoked` or `expired`.",
      absence_note: "**Added by 0029.** Note shown to colleagues while the delegator is absent (1–1000 characters).",
      requested_by_user_id:
        "**Added by 0029.** Set when an access administrator recorded the delegation on the delegator's request: that administrator.",
      revoked_at: "**Added by 0029.** When the delegation was revoked; NULL unless status is `revoked`.",
      revoked_by: "**Added by 0029.** Who revoked it.",
      revoke_reason: "**Added by 0029.** Why it was revoked.",
    },
  },
  transformation: {
    purpose:
      "One transformation programme (End-to-End or Modular) in a business unit, with its phase, status, sponsor and lead fields (which grant no access), and its own timezone and currency.",
    migrations: `${P1}; later stages add tables that reference it, not columns`,
    earlier: `the P1 section \`## Earlier section: transformation\`. ${STAMPS_P1}`,
    columns: {
      business_unit_id: "The owning business unit, in the same organization (composite FK).",
      code: "Code unique in the organization; generated as `TR-0001`… when omitted.",
      name: "Name (1–200 characters).",
      description: "Description (≤ 4000 characters).",
      mode: "`end_to_end` or `modular`.",
      entry_phase: "For a Modular transformation, the phase it starts in; NULL exactly for End-to-End.",
      standalone_deliverable_type:
        "For a Modular transformation, the single deliverable it produces (`target_operating_model`, `initiative_business_case`, `benefits_register`); NULL otherwise.",
      status: "`draft`, `active`, `on_hold` or `closed` (transitions: `TRANSFORMATION_STATUS_TRANSITIONS`).",
      current_phase: "Current playbook phase: diagnose, define, design, mobilize, transform or realize.",
      sponsor_user_id: "The named sponsor; informational, grants no access.",
      lead_user_id: "The named transformation lead; informational, grants no access.",
      timezone: "IANA timezone for business dates; copied from the organization when omitted.",
      currency: "ISO 4217 currency; copied from the organization when omitted.",
      archived_at: "When the transformation was archived (read-only afterwards).",
      archived_by: "Who archived it.",
      archive_reason: "Why it was archived (set together with archived_at and archived_by).",
      created_by: "The user who created the transformation (always a real user here).",
      updated_by: "The user who last changed it (always a real user here).",
    },
  },
  audit_event: {
    purpose:
      "The append-only audit trail (ADR-0004): one row per mutation, authorization denial and system action. UPDATE, DELETE and TRUNCATE are refused by `audit_event_immutable`; `mth_app` has INSERT and SELECT only.",
    migrations: P1,
    earlier: "the P1 section `## Earlier section: audit_event (append-only; ADR-0004)` (types now spelled as `format_type()` prints them)",
    columns: {
      seq: "Monotonic sequence (identity), the trail's order.",
      occurred_at: "When the event happened.",
      organization_id: "The organization; NULL only for installation-level events.",
      transformation_id: "The transformation, when the event concerns one; no FK, so the trail outlives any retention of the record.",
      actor_type: "`user` (then actor_user_id is set), `service` (a job identity) or `system`.",
      actor_user_id: "The acting user, when a user acted.",
      on_behalf_of_user_id: "The delegator, when the actor acted under a delegation.",
      action: "Event name, for example `transformation.created` or `authorization.denied`.",
      record_type: "Type of the affected record.",
      record_id: "Id of the affected record.",
      prior_version: "The record's version before the change.",
      new_version: "The record's version after the change.",
      reason: "Reason given by the actor, where the action requires one.",
      request_id: "The HTTP request id, to join with logs.",
      source: "`api`, `worker`, `cli` or `migration`.",
      changes: "JSON object of changed fields (before/after); never secrets or evidence bytes.",
    },
  },
  outbox_event: {
    purpose:
      "The transactional outbox (ADR-0008): domain events inserted in the same transaction as the business change and published to pg-boss by the worker. Payloads never contain secrets, tokens or evidence bytes.",
    migrations: P1,
    earlier: "the P1 section `## Earlier section: outbox_event (ADR-0008)` (types now spelled as `format_type()` prints them)",
    columns: {
      seq: "Monotonic sequence (identity); publishing order.",
      aggregate_type: "Type of the record the event is about.",
      aggregate_id: "Id of that record.",
      event_type: "Event name, for example `transformation.created`.",
      schema_version: "Version of the payload schema (≥ 1); payloads are validated by the zod schema for (event_type, schema_version).",
      payload: "Event body (JSON object).",
      idempotency_key: "Unique key consumers use to process the event once.",
      created_at: "When the event was written.",
      published_at: "When the worker published it; NULL while pending.",
      publish_attempts: "Number of publish attempts so far.",
      last_error: "Error text of the last failed attempt.",
    },
  },
  processed_message: {
    purpose: "The consumer idempotency ledger: inserted in the same transaction as a handler's effects, so a redelivered message is processed once.",
    migrations: P1,
    earlier: "the P1 section `## Earlier section: processed_message (consumer idempotency ledger)`",
    columns: {
      consumer: "Handler name (part of the primary key).",
      idempotency_key: "The message's idempotency key (part of the primary key).",
      processed_at: "When the handler committed.",
      outcome: "`done` or `skipped`.",
    },
  },
  idempotency_record: {
    purpose:
      "Stored responses for the HTTP `Idempotency-Key` header (ADR-0007): a replay with the same key and request returns the stored response; the same key with a different request is refused (422). Expired rows are purged by the worker.",
    migrations: P1,
    earlier: "the P1 section `## Earlier section: idempotency_record (HTTP Idempotency-Key, ADR-0007)`",
    columns: {
      user_id: "The calling user (part of the primary key).",
      key: "The client's Idempotency-Key, 8–128 characters (part of the primary key).",
      request_hash: "SHA-256 (hex) of method, path and canonical body.",
      response_status: "HTTP status of the stored response.",
      response_body: "The stored response body.",
      created_at: "When the first request completed.",
      expires_at: "created_at + 24 hours.",
    },
  },
  schema_migration: {
    purpose:
      "The migration runner's ledger (ADR-0003, forward-only): one row per applied migration file. The runner aborts when a file's checksum differs from the recorded one.",
    migrations: "`0000` runner bootstrap (created by `packages/db/src/migrate.ts`)",
    earlier: "the P1 section `## Earlier section: schema_migration`",
    columns: {
      id: "The migration's `NNNN` number (primary key).",
      name: "File name of the migration (unique).",
      sha256: "SHA-256 (hex) of the file as applied.",
      applied_at: "When it was applied.",
      applied_by: "Database role that applied it (`current_user`).",
    },
  },
  // ------------------------------------------------------------------------------------------------ P1 views ------
  actor_display: {
    purpose:
      "The only user attribute other modules may read (ADR-0002 module boundaries): the audit module joins it to show actor names. One row per user, including disabled users. Source: `SELECT id AS user_id, display_name FROM app_user`.",
    migrations: P1,
    earlier: "the P1 subsection `### actor_display` under `## Views (read models)`",
    columns: { user_id: "`app_user.id`.", display_name: "`app_user.display_name`." },
  },
  business_unit_closure: {
    purpose:
      "The business-unit hierarchy as (ancestor, descendant) pairs, used by the policy function (ADR-0006) to resolve BU ancestry and inheriting grants, and by the organization module for the cycle and depth checks. Recursive, capped at depth 10.",
    migrations: P1,
    earlier: "the P1 subsection `### business_unit_closure` under `## Views (read models)`",
    columns: {
      ancestor_id: "A business unit.",
      descendant_id: "The ancestor itself (depth 0) or a unit below it.",
      organization_id: "The descendant's organization.",
      depth: "Levels from ancestor to descendant (0 = same unit).",
    },
  },
  scope_node: {
    purpose:
      "One row for every scope node a `scoped_assignment` can point at (organization, business unit, transformation), with its position in the hierarchy; used by the policy function and the assignment service.",
    migrations: "`0002`",
    earlier: "the P1 subsection `### scope_node` under `## Views (read models)`",
    columns: {
      scope_type: "`organization`, `business_unit` or `transformation`.",
      scope_id: "Id of the node at that level.",
      organization_id: "The node's organization.",
      business_unit_id: "NULL for an organization; the unit itself for a BU; the owning BU for a transformation.",
      transformation_id: "The transformation id for a transformation node; otherwise NULL.",
    },
  },
  // ------------------------------------------------------------------------------------------- P2–P6 tables --------
  decision: {
    purpose:
      "THE canonical decision record (one decision model): T04 design decisions (kind `design`), gate decisions (kind `gate`, specialised by `gate_decision`) and T16 executive decisions and asks (kind `executive`, P4 0044/0045). Lifecycle open → decided / deferred / cancelled; deferred → open.",
    migrations: "`0017_p2_decisions_gates.sql`; `0045_p4_t16_escalation.sql` (executive ask columns)",
    earlier:
      "the P2 section `## Earlier section: decision` and the P4 note in `## Changes to existing tables (0044, 0045)`",
    columns: {
      kind: "`design`, `gate` or `executive`.",
      code: "Decision code, unique in the transformation: `D-NN` (design), `DEC-NN` (executive), `GD-NN` (gate).",
      title: "Short title of the decision.",
      context: "The question and its background.",
      owner_user_id: "The named decision owner, who decides (`decision.decide`).",
      due_date: "Date the decision is needed by (business date).",
      status: "`open`, `decided`, `deferred` or `cancelled`; a gate decision is always `decided`.",
      recommendation_option_id: "The option recommended to the decider.",
      recommendation_text: "Free-text recommendation when no option row is used.",
      chosen_option_id: "The option chosen when decided.",
      outcome_text: "The recorded outcome; required for a decided executive ask.",
      decided_by: "The user who recorded the decision.",
      decided_at: "When it was decided.",
      tom_dimension_code: "TOM dimension a design decision belongs to.",
      source_workshop_item_id: "The workshop item the decision was converted from.",
      why_now: "**Added by 0045.** T16 ask: why the decision is needed now (1–4000).",
      impact_of_delay: "**Added by 0045.** T16 ask: the impact of not deciding in time (1–4000).",
      ask_origin: "**Added by 0045.** Where an executive ask came from: `api`, `agenda` or `blocker_escalation`; NULL for a decision that is not an ask.",
      created_source: "**Added by 0045.** `api` (a person) or `worker` (a blocker escalation job).",
      source_agenda_item_id: "**Added by 0045.** The agenda item an `agenda` ask was raised from (same transformation).",
      decision_right_id: "**Added by 0045.** The T11 decision right the ask falls under (same transformation).",
      sla_due_date: "**Added by 0045.** The SLA date of the ask (next SteerCo or release date per the calendar).",
      sla_unknown_reason:
        "**Added by 0045.** Why the SLA date is Unknown: `calendar_not_configured`, `no_steerco_scheduled` or `no_release_date`.",
      decided_on_behalf_of_user_id: "**Added by 0045.** The owner, when a delegate decided on the owner's behalf.",
      blocker_record_type:
        "**Added by 0045.** For a blocker escalation: the blocking record's type (`raid_entry`, `dependency`, `corrective_case`, `initiative`, `milestone`).",
      blocker_record_id: "**Added by 0045.** The blocking record's id; at most one open ask per blocker.",
    },
  },
  action_item: {
    purpose:
      "An owned action: from a workshop conversion (P2), or raised from a RAID entry, a dependency or a corrective case (P4 0041). Lifecycle open → in_progress → done / cancelled. At most one source link, fixed once set.",
    migrations: "`0017_p2_decisions_gates.sql`; `0041_p4_raid_actions_corrective.sql`",
    earlier: "the P2 section `## Earlier section: action_item` and the P4 note in `## Changes to existing tables (0041)`",
    columns: {
      title: "Short title of the action.",
      description: "What has to be done.",
      owner_user_id: "The person accountable for the action.",
      due_date: "Due date (business date).",
      status: "`open`, `in_progress`, `done` or `cancelled`.",
      source_workshop_item_id: "The TOM workshop item the action was converted from.",
      raid_entry_id: "**Added by 0041.** The RAID entry the action mitigates or follows up (same transformation).",
      dependency_id: "**Added by 0041.** The dependency the action resolves.",
      corrective_case_id: "**Added by 0041.** The corrective case the action belongs to.",
      follow_up_date: "**Added by 0041.** Date to check progress, before the due date where used.",
    },
  },
  dependency: {
    purpose:
      "THE canonical dependency record shared by T08 and RAID: TOM-level dependencies (P2), initiative endpoints, configurable types and the race-free cycle guard (P3 0022), and the RAID impact (P4 0041). Lifecycle open ↔ at_risk → resolved; → archived.",
    migrations: "`0017_p2_decisions_gates.sql`; `0022_p3_dependency_capacity_funding.sql`; `0041_p4_raid_actions_corrective.sql`",
    earlier: "the P2 section `## Earlier section: dependency` and the P4 note in `## Changes to existing tables (0041)`",
    columns: {
      code: "Dependency code `DEP-NN`, unique in the transformation.",
      description: "What depends on what, in words.",
      from_kind: "Kind of the dependent end: `initiative`, `external`, `tom_dimension`, `decision` or `other`.",
      from_label: "Label of the dependent end when it is not a linked record.",
      to_kind: "Kind of the end depended on (same set as from_kind).",
      to_label: "Label of the end depended on when it is not a linked record.",
      dependency_type: "The configurable dependency type (FK to `dependency_type`).",
      needed_by: "Date the dependency must be met.",
      owner_user_id: "The person managing the dependency.",
      status: "`open`, `at_risk`, `resolved` or `archived`.",
      mitigation: "Mitigation or fallback.",
      tom_dimension_code: "TOM dimension of a TOM-level dependency.",
      decision_id: "A decision that resolves or governs the dependency.",
      archived_at: "When it was archived.",
      archived_by: "Who archived it.",
      archive_reason: "Why it was archived.",
      from_initiative_id: "**Added by 0022.** The dependent initiative, for an initiative-to-initiative dependency (cycle-checked).",
      to_initiative_id: "**Added by 0022.** The initiative depended on.",
      impact: "**Added by 0041.** T15 RAID impact `high`, `medium` or `low`; NULL = Unknown. No probability column (Probability is n/a for a dependency).",
    },
  },
  gate_submission_criterion: {
    purpose:
      "Per-criterion completeness frozen at gate submission (criterion, required evidence, completeness); append-only. A mandatory incomplete criterion passes only with an accepted gate exception (0051).",
    migrations: "`0017_p2_decisions_gates.sql`; `0051_p4_phases_gates_g5_g6_exceptions.sql`",
    earlier: "the P2 section `## Earlier section: gate_submission_criterion` and the note in `## Changes to existing tables (slice H)`",
    columns: {
      gate_submission_id: "The submission the row belongs to.",
      criterion_key: "The gate criterion definition.",
      ordinal: "Display order (1–20).",
      mandatory: "True when the criterion must be complete (or excepted) to submit.",
      completeness: "`complete` or `incomplete` at submission time.",
      detail: "JSON object with the evidence and checks behind the completeness value.",
      evaluated_at: "When completeness was evaluated.",
      gate_exception_id:
        "**Added by 0051.** The accepted gate exception that covers a mandatory incomplete criterion (same gate instance and criterion, not expired at the submission's business date).",
    },
  },
  initiative: {
    purpose:
      "T05 Initiative Card (B0072) and the portfolio lifecycle (ADR-0021 §2–§3): draft → submitted → ranked → selected → funded → launched → completed; cancelled. A vehicle, never part of the TOM (B0059). P4 (0048) adds the delivery-complete stamps and the adoption status.",
    migrations: "`0020_p3_portfolio_roadmap.sql`; `0048_p4_sustainment.sql`",
    earlier: "the P3 section `## Earlier section: initiative` and the P4 note in `## Changes to existing tables (0047, 0048)`",
    columns: {
      code: "Initiative code, unique in the transformation.",
      name: "Initiative name.",
      executive_owner_user_id: "Executive owner (T05).",
      workstream_lead_user_id: "Workstream lead (T05).",
      problem_statement: "T05 problem statement.",
      objective: "T05 objective.",
      scope_in: "What is in scope.",
      scope_out: "What is out of scope.",
      financial_benefit_summary: "Summary of the expected financial benefit (the figures are in the benefit register).",
      customer_benefit_summary: "Summary of the expected customer benefit.",
      risks_summary: "Summary of the main risks.",
      wave_id: "The roadmap wave the initiative is planned in.",
      planned_start: "Planned start date.",
      planned_end: "Planned end date.",
      status: "Portfolio status (edges in `initiative_status_step`).",
      launched_at: "When the initiative was launched.",
      launched_by: "Who launched it (`initiative.launch`).",
      cancelled_at: "When it was cancelled.",
      cancelled_by: "Who cancelled it.",
      cancel_reason: "Why it was cancelled.",
      delivery_completed_at: "**Added by 0048.** When delivery was recorded complete (set once, with the move to `completed`).",
      delivery_completed_by: "**Added by 0048.** Who recorded delivery complete.",
      adoption_status: "**Added by 0048.** `not_assessed`, `on_track`, `at_risk` or `adopted`.",
      adoption_status_note: "**Added by 0048.** Note explaining the adoption status (1–2000).",
      adoption_status_set_at: "**Added by 0048.** When the adoption status was last set.",
      adoption_status_set_by: "**Added by 0048.** Who set it.",
    },
  },
  initiative_outcome_contribution: {
    purpose:
      "T05 'Outcome/KPI contribution', the fifth level of the outcome hierarchy (B0048): the outcome is mandatory; the KPI row is optional and must belong to the outcome. P4 (0055) adds an optional allocation share into the outcome KPI (the set into one KPI totals at most 1).",
    migrations: "`0020_p3_portfolio_roadmap.sql`; `0055_p4_traceability_modular_structure.sql`",
    earlier:
      "the P3 section `## Earlier section: initiative_outcome_contribution` and the note in `## Changes to existing tables (slices J and K)`",
    columns: {
      initiative_id: "The contributing initiative.",
      outcome_id: "The outcome contributed to.",
      outcome_kpi_id: "The outcome's KPI row contributed to (optional).",
      contribution_statement: "How the initiative contributes.",
      expected_kpi_movement: "The expected movement of the KPI, in words.",
      status: "`active` or `removed`.",
      removed_at: "When the contribution was removed.",
      removed_by: "Who removed it.",
      remove_reason: "Why it was removed.",
      allocation_share:
        "**Added by 0055.** Decimal share (0 < share ≤ 1) of the outcome KPI's movement allocated to this initiative; needs `outcome_kpi_id`; NULL = not allocated.",
      allocation_basis: "**Added by 0055.** Basis of the allocation (1–1000); needs a share.",
    },
  },
  evidence_content: {
    purpose:
      "Append-only stored content revisions of a file evidence item: storage key and SHA-256 in the evidence store, size, media type, the detected type (P6 0099) and the store that holds the bytes (P6 0102).",
    migrations: "`0012_p2_evidence.sql`; `0099_p6_upload_policy_content_types.sql`; `0102_p6_storage_notification_channels.sql`; `0118`",
    earlier:
      "the P2 section `## Earlier section: evidence_content` and the notes in `## Columns and triggers added to earlier tables (0098, 0099)` and `## Columns added to earlier tables (0102)`",
    columns: {
      evidence_id: "The evidence item.",
      revision: "Revision number (≥ 1) within the item.",
      storage_key: "Key of the bytes in the evidence store.",
      sha256: "SHA-256 (hex) of the stored bytes.",
      size_bytes: "Size in bytes (≤ 1 GiB).",
      content_type: "Media type served on download.",
      file_name: "Original file name (1–255).",
      uploaded_by: "Who uploaded the revision.",
      uploaded_at: "When it was uploaded.",
      detected_type:
        "**Added by 0099.** Type detected from magic bytes and extension (`pdf`, `docx`, `xlsx`, `pptx`, `csv`, `txt`, `png`, `jpeg`, `gif`, `svg`); NULL for files stored before P6 (\"not checked\"); required on new rows since 0118.",
      storage_driver: "**Added by 0102.** Which store holds the bytes: `filesystem` or `s3`; every pre-P6 row is `filesystem`.",
    },
  },
  work_item_kind: {
    purpose: "Catalogue of My Work item kinds; later slices insert their own kinds by migration (ADR-0025 §4). Read-only seed.",
    migrations: "`0028_p4_calendar_jobs_work_items.sql`; `0075_p5_starters_routes_policies.sql`",
    earlier: "the P4 section `## Earlier section: work_item_kind` and the table `## Columns added to DG4 tables (0075, slice E)`",
    columns: {
      code: "Kind code (`^[a-z_]+$`).",
      owner_module: "API module that creates items of this kind.",
      label_en: "English label.",
      label_ar: "Arabic label (provisional).",
      source_ref: "Source reference of the kind (requirement or template id).",
      urgency: "**Added by 0075.** `normal` or `urgent`; urgent kinds (escalations, overdue approvals and gate conditions) are never held for a digest.",
    },
  },
  inbox_notification: {
    purpose:
      "In-app notification with a direct link (REQ-S12-005; ADR-0025 §4); read once. P5 (0075) adds urgency, digest holding and delivery state; P6 (0098) adds the opaque deep-link token and its target.",
    migrations: "`0028_p4_calendar_jobs_work_items.sql`; `0075_p5_starters_routes_policies.sql`; `0098_p6_sensitive_records_deep_links.sql`",
    earlier:
      "the P4 section `## Earlier section: inbox_notification` and the tables in `## Columns added to DG4 tables (0075, slice E)` and `## Columns and triggers added to earlier tables (0098, 0099)`",
    columns: {
      recipient_user_id: "The user the notification is for.",
      work_item_id: "The My Work item it announces, if any.",
      link_path: "In-app path the notification opens.",
      message_key: "i18n message key of the text (rendered in the reader's locale).",
      message_params: "Parameters of the message.",
      dedupe_key: "Key that prevents a duplicate notification for the same event and recipient.",
      read_at: "When the recipient read it; set once.",
      urgency: "**Added by 0075.** `normal` or `urgent`; an urgent notification is delivered immediately.",
      delivery_state: "**Added by 0075.** `delivered`, `held` (waiting for a digest) or `digested`.",
      deliver_after: "**Added by 0075.** For a held notification: the earliest delivery time.",
      digest_id: "**Added by 0075.** The digest a `digested` notification was folded into.",
      is_digest: "**Added by 0075.** True for the digest notification itself (always delivered and normal).",
      link_token:
        "**Added by 0098.** Opaque 43-character base64url deep-link token, unique when set, set once; an identifier, never a credential (ADR-0051 §3).",
      target_record_type: "**Added by 0098.** Type of the record the deep link opens (set once, with the id).",
      target_record_id: "**Added by 0098.** Id of that record.",
    },
  },
  report_snapshot: {
    purpose:
      "One assembled report output with its as-of time, reporting period, content, methodology version, approval state and provisional/unknown counts; issue, reissue as a new version, discard (REQ-S13-007, REQ-S13-008; ADR-0045). Content immutable after INSERT; never deleted. P6 (0126) records whether its aggregates are stored in `report_snapshot_aggregate`.",
    migrations: "`0080_p5_reports_snapshots_updates.sql`; `0126_p6_report_snapshot_aggregate.sql`",
    earlier: "the P5 section `## Earlier section: report_snapshot` and `## report_snapshot: changes in 0126`",
    columns: {
      definition_code: "The report definition assembled.",
      subject_type: "`transformation`, `meeting`, `gate_instance`, `business_case` or `bau_handover`.",
      subject_id: "Id of the subject (the transformation id when the subject is the transformation).",
      reporting_period_id: "The reporting period, when the report has one.",
      period_label: "Copy of the period's label at assembly (set with the period).",
      period_start: "Copy of the period's start date.",
      period_end: "Copy of the period's end date.",
      parameters: "Assembly parameters (JSON object, ≤ 8 KiB).",
      as_of: "The as-of instant the content reflects.",
      content_schema_version: "Version of the content JSON schema (1).",
      content: "The assembled content (JSON object).",
      content_sha256: "SHA-256 (hex) of the content.",
      methodology_version_id: "The methodology version pinned when assembled.",
      approval_state: "Approval state of the subject's figures (`approved`, `pending`, `not_submitted`, `changes_requested`, `rejected`, `mixed`, `not_applicable`).",
      provisional_value_count: "Number of provisional values in the content.",
      unknown_value_count: "Number of Unknown values in the content.",
      series_id: "Id of the first snapshot of a reissue series (its own id for an original).",
      reissue_of_id: "The snapshot this one reissues.",
      reissue_reason: "Why it was reissued (3–1000).",
      status: "`generated`, `issued`, `superseded` or `discarded`.",
      issue_version: "Issue number within the series, set when issued.",
      issued_at: "When it was issued.",
      issued_by: "Who issued it (`report.issue`).",
      issue_note: "Note given at issue.",
      superseded_at: "When a reissue superseded it.",
      superseded_by_id: "The reissue that superseded it.",
      discarded_at: "When it was discarded.",
      discarded_by: "Who discarded it.",
      discard_reason: "Why it was discarded.",
      aggregates_recorded:
        "**Added by 0126.** True when the snapshot's aggregate records are in `report_snapshot_aggregate` (every snapshot since 0126); false for earlier snapshots. Immutable.",
    },
  },
  export_job: {
    purpose:
      "One export of a snapshot in one format and language, rendered by the worker, with the stored file's name, type, size and SHA-256 (REQ-S13-005, REQ-S13-009; ADR-0046). Since 0124 a live-selection export is created without a snapshot and with its selection; the API's assembly watch assigns the snapshot once. Lifecycle queued → running → succeeded | failed | queued (retry) | cancelled.",
    migrations:
      "`0081_p5_export_jobs.sql`; `0124_p6_export_live_selection_pending.sql`; `0125_p6_export_assembly_attempts.sql`",
    earlier:
      "the P5 section `## Earlier section: export_job`, the 0124 section (where `snapshot_id` became nullable) and `## export_job: changes in 0125`",
    columns: {
      snapshot_id:
        "The snapshot exported. **Nullable since 0124:** NULL only while a live-selection job awaits assembly, or after it failed or was cancelled before assembly; assigned once, while `queued`.",
      requested_by: "The requester (equals created_by).",
      format: "`pdf`, `docx`, `xlsx`, `pptx` or `csv`.",
      language: "`en` or `ar`.",
      idempotency_key: "Client key that makes the request idempotent.",
      status: "`queued`, `running`, `succeeded`, `failed` or `cancelled`.",
      attempt_count: "Render attempts by the worker (0–20).",
      started_at: "When the current or last attempt started.",
      finished_at: "When the job reached a terminal state.",
      storage_key: "Key of the stored file (`exports/…`), set on success.",
      file_name: "Download file name, set on success.",
      content_type: "Media type matching the format, set on success.",
      file_sha256: "SHA-256 (hex) of the file.",
      file_size_bytes: "File size (≤ 200 MiB).",
      error_code: "Failure code, set exactly when failed.",
      cancelled_at: "When the requester cancelled it.",
      cancelled_by: "Who cancelled it.",
      selection: "**Added by 0124.** The stored live selection (JSON object with a string `definitionCode`); NULL for an export of an existing snapshot.",
      assembly_attempt_count:
        "**Added by 0125.** Assembly attempts started for a pending live selection, each counted in its own transaction before the assembly starts.",
    },
  },
  assistant_message: {
    purpose:
      "One message of an assistant conversation: the user's prompt, or the assistant's reply (answer with citations; refusal; no_sources; unavailable; interrupted). Citations are record ids and versions or playbook block references; retrieved record text is never stored (ADR-0059 §5, §8). Append-only. P6 (0128) adds the generation context of an answer.",
    migrations: "`0111_p6_assistant.sql`; `0128_p6_assistant_context_records.sql`; `0129_p6_assistant_context_insert_rule.sql`",
    earlier: "the P6 section `## Earlier section: assistant_message` and the section \"P6 re-gate repair migration 0128\"",
    columns: {
      conversation_id: "The conversation.",
      seq: "Position in the conversation (1–100).",
      author: "`user` or `assistant`.",
      reply_kind: "For an assistant reply: `answer`, `refusal`, `no_sources`, `unavailable` or `interrupted`.",
      refusal_code: "For a refusal: why (approval, benefit validation, value change, evidence).",
      error_code: "For `unavailable`: the provider failure code.",
      content: "The prompt or answer text (1–8000).",
      citations: "The answer's citations (JSON array of record references or playbook blocks).",
      provider_kind: "`http_endpoint` or `test_adapter`.",
      model_name: "Model name reported by the provider.",
      setting_version: "Version of the assistant settings used.",
      latency_ms: "Provider latency in milliseconds.",
      context_records:
        "**Added by 0128.** The `{recordType, recordId}` of every record given to the model for an answer (cited or not); never served, used only for the read-time re-check; NULL on answers stored before 0128.",
    },
  },
  assistant_suggestion: {
    purpose:
      "A labelled suggestion on an assistant answer: a charter or T16 decision-brief draft (text fields only) or advice (recovery action, missing evidence), with its citations (ADR-0059 §6). Lifecycle proposed → taken_to_draft (draft kinds only); content never changes. P6 (0128) adds the generation context.",
    migrations: "`0111_p6_assistant.sql`; `0128_p6_assistant_context_records.sql`; `0129_p6_assistant_context_insert_rule.sql`",
    earlier: "the P6 section `## Earlier section: assistant_suggestion` and the section \"P6 re-gate repair migration 0128\"",
    columns: {
      conversation_id: "The conversation.",
      message_id: "The answer the suggestion belongs to.",
      owner_user_id: "The conversation owner (equals created_by).",
      ordinal: "Order within the answer (1–5).",
      kind: "`charter_draft`, `decision_brief_draft`, `recovery_action` or `missing_evidence`.",
      target_record_type: "For a draft: `charter` or `T16`.",
      fields: "For a draft: the proposed text fields (validated per target).",
      text_content: "For advice: the text (1–4000).",
      citations: "Citations supporting the suggestion (at least one).",
      status: "`proposed` or `taken_to_draft`.",
      taken_at: "When the owner took it to a draft.",
      taken_by: "Who took it.",
      context_records:
        "**Added by 0128.** The generation context of the answer the suggestion belongs to; never served; immutable; NULL on suggestions stored before 0128.",
    },
  },
  // --------------------------------------------------------------------------------------------- P4 views ---------
  approval_decision_record: {
    purpose:
      "Read-only union of the business-approval decisions (D-089 Q10): `approval_decision` (source `approval`), `gate_decision` (source `gate_decision`, kinds `gate_g1`…`gate_g6`) and `funding_decision` (source `funding_decision`, kind `funding`), with outcomes normalized to approved | rejected | changes_requested | deferred | revoked.",
    migrations: "`0031_p4_approvals_permissions.sql`",
    earlier: "the P4 section `## Earlier section: approval_decision_record (view)` (bullet list of columns)",
    columns: {
      source: "`approval`, `gate_decision` or `funding_decision`.",
      record_id: "Id of the decision row in its source table.",
      approval_kind: "Approval type code, `gate_g1`…`gate_g6`, or `funding`.",
      subject_type: "Type of the record decided on.",
      subject_id: "Id of the record decided on.",
      subject_version: "Version of the subject decided on; NULL for funding.",
      outcome: "Normalized outcome.",
      rationale: "The decider's rationale.",
      decided_by: "The deciding user.",
      on_behalf_of_user_id: "The delegator, when decided under a delegation.",
      decided_at: "When it was decided.",
    },
  },
  traceability_edge: {
    purpose:
      "One read model of every active chain edge, reading each canonical table in place (ADR-0038 §1): trace links, initiative–gap links, deliverables, initiative outcome contributions, outcome KPIs, benefits and benefit allocations.",
    migrations: "`0055_p4_traceability_modular_structure.sql`",
    earlier: "the P4 section `## Earlier section: traceability_edge (view)` (bullet list of columns)",
    columns: {
      edge_kind:
        "`issue_gap`, `gap_initiative`, `initiative_deliverable`, `deliverable_capability`, `capability_kpi`, `initiative_kpi`, `outcome_kpi_of`, `kpi_benefit`, `kpi_benefit_measure` or `initiative_benefit`.",
      from_type: "Record type of the edge's source.",
      from_id: "Id of the source.",
      to_type: "Record type of the edge's target.",
      to_id: "Id of the target.",
      link_table: "Table holding the link row.",
      link_id: "Id of the link row.",
      contribution_statement: "The contribution statement, where the link has one.",
      allocation_share: "The allocation share, where the link has one (decimal, 0 < share ≤ 1).",
    },
  },
  my_work_draft: {
    purpose:
      "The Drafts section of My Work: records in status `draft` of 18 record types with their author (ADR-0037 §7; REQ-S03-008).",
    migrations: "`0056`",
    earlier: "the P4 section `## Earlier section: my_work_draft (view)` (bullet list of columns)",
    columns: {
      record_type: "Type of the draft record (one of the 18 listed in the earlier section).",
      record_id: "Id of the draft record.",
      code: "The record's code, where it has one.",
      label: "The record's display label.",
      parent_type: "Type of the parent record, where the draft has one.",
      parent_id: "Id of the parent record.",
      created_by: "The draft's author (whose My Work shows it).",
      updated_at: "When the draft was last changed.",
    },
  },
};
