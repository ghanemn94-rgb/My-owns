# ADR-0026: Groups and role mapping, delegation, the P4 approval record, T11 decision rights and T12 RACI

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-01), 2026-10-09.
- **Requirements:** REQ-PB-008, REQ-PB-065, REQ-PB-066, REQ-PB-067, REQ-S10-003, REQ-S10-007, REQ-S10-008, REQ-S10-009, REQ-S10-010, REQ-S10-014, REQ-S10-016, REQ-S10-017, REQ-S10-018, REQ-S10-019, REQ-S16-011 (slice C of `docs/architecture/p4-plan.md`).
- **Sources:** playbook B0013 ("Operating model before execution"), B0098/B0099 (Template 11), B0100/B0101 (Template 12); master prompt M0139, M0140 (§5 templates), M0188 (§10 access), M0197–M0202 (T11 seed), M0203–M0211 (RACI, mapping, delegation), M0213 (approvals), M0231 (§12 decision SLA), M0317 (§16 identity entities).
- **Decisions applied:** D-089 Q3 (delegation scope), Q6 (SLA types), Q7 (escalation chain), Q10 (one canonical approval table plus a read-only union view).
- **Builds on:** ADR-0006 (authorization, SoD hooks, delegation outline), ADR-0015 (one decision model, one-hop delegation path `actsOnBehalfOf`), ADR-0016 (guards, lock registry §6), ADR-0020 (role catalogue), ADR-0021 §6 (P3 approvals decided in person), ADR-0025 (calendar, job kit, work items).
- **Physical model:** `0029_p4_groups_role_mapping_delegation.sql`, `0030_p4_decision_rights_raci.sql`, `0031_p4_approvals_permissions.sql`.
- **Two gate systems.** The approvals here are **business** approvals inside the product, decided by named people. No agent, seed, job or trigger decides one. Nothing here reads or writes DG0–DG7, and product gate G6 never implies DG7.

## Context

The playbook principle (B0013): "Operating model before execution: make decision rights, ownership and cross-functional ways of working explicit." The master prompt makes it concrete:

- M0203: "Preserve the source RACI as a configurable starting point".
- M0211: "Map roles to named people or governed groups. Require one accountable assignment per deliverable unless a documented governance rule permits otherwise. Finance validates benefits even where the Business Owner remains accountable. Support authorized delegation with effective dates, absence handling and preserved audit identity; delegation must not create approval loops."
- M0213: "Approvals need assignee, request version, due date, rationale, comments and decision timestamp. Support sequential or parallel approval rules and separation of duties. A requester cannot approve their own request when the configured policy prohibits it. Reject stale approvals if the submitted record version changed. Distinguish approval, rejection, request changes and deferral. A timer may escalate an overdue approval; it must never approve it automatically."
- M0188: "Technical administrators do not automatically become business approvers."

As built before P4: `role`, `permission`, `role_permission`, `scoped_assignment` and `delegation` exist (`0001`); the `role_permission_no_admin_approver` trigger (`0001`) refuses any `technical_admin` role holding a `business_approval` or `finance_validation` permission; `actsOnBehalfOf` (`access/records.ts`) implements one-hop delegation for record-owner decisions (ADR-0015, ADR-0021 §6). No group, role mapping, approval or T11/T12 table exists.

Sequential and parallel approval rules (REQ-S10-015) are DG5 (p4-plan R6): every P4 approval has **one** step and one assignee.

## Decision

### 1. Groups (REQ-S16-011, REQ-S10-008)

| Table | Fields |
|---|---|
| `access_group` | `id`, `organization_id`, `code` (unique per organization), `name_en`, `name_ar`, `description`, `owner_user_id`, `status` (`active` \| `archived`), `version`, stamps |
| `access_group_member` | `id`, `organization_id`, `group_id`, `user_id`, `effective_from`, `effective_to`, `removed_at`, `removed_by`, `remove_reason`, `version`, stamps |

- A group is a **routing target**: it names who receives an approval or a task. **It grants no permission.** `scoped_assignment` stays the only source of access (ADR-0006). A technical administrator added to a group therefore still holds no `approval.decide` and is refused when deciding (§8).
- Database invariants: one active membership per (group, user) (unique index); a member belongs to the group's organization (trigger `access_group_member_same_org`; probe G19); removal fields come together (CHECK); audit and version guards on both tables (probe G18).
- Authorization: reading needs `organization.read`; creating, editing, archiving groups and adding or removing members need `group.manage` (TO). A group member "acts as the group" only while `removed_at IS NULL` and `effective_from <= now() < coalesce(effective_to, infinity)`.

### 2. Governance parties and role mapping (REQ-S10-008)

**`governance_party`** (seeded, read-only): the 18 parties named by T11 (B0099) and T12 (B0101), each with `kind` (`role` | `forum` | `office` | `owner_group`), an optional `role_code` (the platform role it usually means), `label_en` (source wording) and `label_ar` (provisional). The six T12 columns map to `SP` (Sponsor), `TL`, `BO`, `WL`, `FIN` (Finance) and `TD` (Tech/Data); T11 adds `TO`, `STEERCO`, `PMO`, `DESIGN_OWNER`, `INITIATIVE_OWNER`, `INITIATIVE_OWNERS`, `BUSINESS_OWNERS`, `WORKSTREAMS`, `RISK`, `TECH`, `OPS` and `CX`.

**`role_mapping`** (per transformation): `id`, `organization_id`, `transformation_id`, `party_code`, `target_kind` (`user` | `group`), `user_id`, `group_id`, `status` (`active` → `ended`), `ended_at`, `ended_by`, `end_reason`, `version`, stamps.

- Database invariants: exactly one target, matching `target_kind` (CHECK `role_mapping_one_target`; probe G22); at most one active mapping per (transformation, party) (unique index `role_mapping_active_key`; probe G21); a mapped user is in the organization (trigger); party and target are immutable, and an ended mapping never becomes active again (trigger `role_mapping_guard`; probe G23). To change who a party is, end the mapping and create a new one, so the history stays in the table.
- **Routing** (`access/role-mappings.ts`, `resolveParty(tx, transformationId, partyCode)`): returns the active mapping's user or group. **There is no fallback** (not to `scoped_assignment` holders of the role, not to the creator). An unmapped party is a visible routing error:

  | Status | Code | English text |
  |---|---|---|
  | 422 | `routing.role_unmapped` | "No person or group is mapped to {party} in this transformation. Map the role in the transformation team before routing." |
  | 422 | `routing.assignee_not_approver` | "{target} is mapped to {party} but holds no business-approver role in this transformation. Map an approver or grant the role first." (§8) |

  The refused request writes nothing. `GET /api/v1/transformations/{id}/role-mappings/resolve?party=BO` shows the same error as data (`{ party, status: "unmapped" }`), so the screen can show it before anyone submits.
- REQ-S10-008 acceptance: "a decision routed to 'Business Owner' reaches the mapped person" is `resolveParty(…, 'BO')` returning the mapped user, who then becomes `approval.assignee_user_id` (§4).
- Authorization: reading needs `transformation.read`; creating and ending mappings need `role_mapping.assign` (TL, TO; REQ-S10-008 "assign:TO,TL").

### 3. Delegation (REQ-S10-010; D-089 Q3)

`delegation` (`0001`) gains, in `0029`: `absence_note`, `requested_by_user_id` (set when an access administrator records it on the delegator's request), `revoked_at`, `revoked_by`, `revoke_reason`, and the CHECK `delegation_revocation_complete` (the revocation fields come together and only with `status = 'revoked'`; probe G30). Existing fields keep their meaning: `delegator_user_id`, `delegate_user_id`, optional `scope_type`/`scope_id`, optional `record_types`, `reason_code` (`absence` | `other`), `reason_text`, `effective_from`, `effective_to`, `status` (`active` | `revoked` | `expired`).

**State machine:** `active` → `revoked` (by the delegator, or by an access administrator on request, with a reason) | `expired` (by the `delegation.expiry_sweep` job once `effective_to` has passed). Both are final.

**Rules** (numbered; the database enforces 1–3, the API enforces 4–9):

1. **No self-delegation:** CHECK `delegation_not_self` (`0001`).
2. **No loop** (trigger `delegation_loop_guard`, `0029`): an `active` delegation whose `effective_to` is in the future may not close a path back to its delegator through other `active`, not-yet-ended delegations of the same organization, **whatever their scopes and windows** (stricter than needed, so A→B and B→A are refused even with different scopes). Serialized per organization with advisory-lock class **730224** (ADR-0016 §6). Probes: A→B then B→A refused (G25); A→B→C then C→A refused (G27); a revoked delegation is not part of the graph (G28); two concurrent connections each inserting one half of a loop: the first commits, the second waits on the lock and is refused (C01).
3. **Row guard:** `p2_row_guard` is attached, so `version` steps by 1 and identity columns are immutable (probe G29). The audit-required trigger is **not** attached: DG3 integration fixtures (`portfolio/transitions.test.ts`, `portfolio/roadmap.test.ts`) insert `delegation` rows without audit events, and attaching it would change a DG1-approved table's write contract. Every API write to `delegation` writes its audit event, and BE-B's tests assert it.
4. **Who creates:** the delegator, for themselves (`delegation.create_own`; every business role except AUD), or an access administrator on the delegator's request (`delegation.manage`; ADM_ACCESS), with `requested_by_user_id` = the delegator and a reason. An access administrator never records a delegation to themselves.
5. **Window:** `effective_from < effective_to`, `effective_to` in the future, at most 366 days apart.
6. **Not to a pending requester:** refused when the delegate requested an approval that is pending with the delegator (ADR-0006 "Delegating to the requester of a pending item is rejected").
7. **Capability = the delegator's, at use time:** the delegate acts for the delegator only where the delegator currently holds the needed permission and assignment, and only while the delegation is `active` and `effective_from <= now() < effective_to`. The check reads the window, not the sweep, so **after expiry B loses the capability** at the instant `effective_to` passes, whether or not the sweep has run.
8. **One hop:** a delegate never re-delegates what they received (they can only delegate their own capabilities, and rule 2 refuses loops).
9. **Audit identity:** a decision made by B for A writes `audit_event.actor_user_id = B` and `on_behalf_of_user_id = A`; the decision row stores `decided_by = B`, `on_behalf_of_user_id = A`. The audit view renders "{B} on behalf of {A}" (en) and "{B} نيابةً عن {A}" (ar, provisional).

**Where delegation applies (D-089 Q3):** the P4 approvals (§4) and the existing ADR-0015 one-hop paths (design-decision owner, product-gate decision, deliverable acceptance). The P3 approvals (selection, funding, weight-set and override decisions, dispensations) keep their DG3 422 `*.on_behalf_not_supported`. That is unchanged and not a reopen.

**Refusals:**

| Status | Code | English text |
|---|---|---|
| 422 | `delegation.loop` | "This delegation would create a loop: {delegate} already delegates, directly or through others, to {delegator}." |
| 422 | `delegation.self` | "You cannot delegate to yourself." |
| 422 | `delegation.window_invalid` | "A delegation needs a start before its end, an end in the future, and at most 366 days in between." |
| 422 | `delegation.delegate_is_requester` | "{delegate} requested an approval that is pending with {delegator}, so they cannot act on {delegator}'s behalf." |
| 422 | `delegation.admin_self` | "An access administrator cannot record a delegation to themselves." |
| 403 | `delegation.not_delegator` | "Only the delegator, or an access administrator on the delegator's request, can create or revoke this delegation." |
| 422 | `delegation.not_active` | "This delegation is {status} and can no longer be revoked." |

### 4. The P4 approval record (REQ-S10-014, REQ-S10-016, REQ-S10-017, REQ-S10-018; D-089 Q10)

**One canonical table for the new P4 approval types.** Existing approval records (`gate_decision`, `funding_decision`, `portfolio_selection`, dispensations, weight-set and override decisions) are not migrated. The read-only view `approval_decision_record` unions the decisions of `approval_decision`, `gate_decision` and `funding_decision`, with outcomes normalized to `approved | rejected | changes_requested | deferred | revoked` (probe A27). My Work and the S16-018 test read it.

**`approval_type`** (seeded, read-only): `code`, `subject_table`, `default_sod_policy`, `requires_decision_right`, `owner_module`, `label_en/ar`, `source_ref`. `0031` seeds `decision_request` (subject `decision`; routed by a T11 row) and `governance_matrix_change` (subject `governance_matrix`; T11/T12 approval by SP). Slice H adds `change_request` in its own migration.

**`approval`:** `id`, `organization_id`, `transformation_id`, `approval_type`, `subject_type`, `subject_id`, **`subject_version`** (the request version), `round_no`, `decision_right_id`, `title`, `request_note`, `requested_by`, `requested_at`, `request_business_date`, **assignee** (`assignee_party_code` plus exactly one of `assignee_user_id` / `assignee_group_id`), `sla_type`, `urgent_reason`, **`due_date`** or `due_unknown_reason`, `calendar_id`, `calendar_version`, `sod_policy`, `status`, escalation fields (`escalation_level`, `escalated_to_party_code`, `escalated_to_user_id`, `escalated_to_group_id`), `decided_by`, `decided_on_behalf_of`, **`decided_at`**, `version`, stamps.

**`approval_decision`** (append-only): `id`, `approval_id`, `round_no`, **`outcome`** (`approve` | `reject` | `request_changes` | `defer`), **`rationale`** (required), **`comments`**, `subject_version`, `decided_by`, `on_behalf_of_user_id`, **`decided_at`** (event instant), `business_date`, `defer_until`.

**State machine** (trigger `approval_guard`):

```text
pending ──approve──► approved (final)      deferred ──approve/reject──► approved / rejected (final)
pending ──reject───► rejected (final)      deferred ──request_changes─► changes_requested
pending ──request_changes──► changes_requested ──resubmit (round+1, newer subject version)──► pending
pending ──defer (new date)─► deferred ──defer (new date)──► deferred
pending / deferred / changes_requested ──withdraw (requester)──► withdrawn (final)
```

**Outcome behaviour** (REQ-S10-018: each outcome is distinct):

| Outcome | Status after | Downstream (BE-B) |
|---|---|---|
| approve | `approved`, final | The subject's module applies the approval in the same transaction (e.g. the governance matrix becomes `approved`). The assignee's task closes. The requester gets an inbox reminder. |
| reject | `rejected`, final | The subject stays unapproved. The task closes. The requester gets a reminder. |
| request changes | `changes_requested`, **open** | Returns to the requester: a work item `approval_changes_requested` for the requester. The assignee's task closes. Nothing is closed; the requester resubmits a newer subject version (round + 1) or withdraws. |
| defer | `deferred`, open | Needs `deferUntil`, a business date after today. `due_date` becomes that date, so the escalation timer counts from it. The assignee's task stays open with the new due date. |

**Database invariants** (each fired by the probe):

1. A new approval starts `pending`, round 1, not escalated, on the subject's **current** version; the subject must exist in the same transformation (trigger; probe A01).
2. At most one open (`pending`, `changes_requested`, `deferred`) approval per (type, subject) (unique index; probe A04).
3. A decision is accepted only while the approval is `pending` or `deferred` (probe A12), only for the current round and request version, and only while the subject is **still at that version**. The trigger reads the subject `FOR SHARE` under advisory-lock class **730226** (per subject id), so a concurrent subject update waits for the decision (probes A08, A15).
4. Under `sod_policy = 'requester_excluded'`, neither the requester nor anyone acting on the requester's behalf can record any outcome (trigger, plus CHECK `approval_sod` on the final row; probes A05, A06).
5. `rationale` must contain a non-blank character (CHECK `approval_decision_rationale_required`; probe A07); `defer` needs `defer_until` after the decision's business date, and only `defer` has one (CHECK; probe A09).
6. The status may become `approved`, `rejected`, `changes_requested` or `deferred` only when a decision row of the current round with that outcome exists, and for a final outcome it must be by `decided_by`, a user (`approval_outcome_needs_decision`; probe A10). `approved`/`rejected` exactly when `decided_at` and `decided_by` are set (CHECK).
7. A final approval (`approved`, `rejected`, `withdrawn`) is immutable (probe A23). Type, subject, requester and SoD policy never change. A resubmission is the only status step that changes the round, and it needs a newer subject version (probes A13, A14).
8. `approval_decision` and `approval_escalation` are append-only (probes A21, A24, A25). Audit-required and version guards on `approval` (probe A26).

**API rules** (BE-B, `workflows/approvals.ts`), checked in this order on `POST /api/v1/approvals/{approvalId}/decisions` (`If-Match` on the approval):

| # | Check | Refusal |
|---|---|---|
| 1 | Caller can read the transformation | 404 |
| 2 | Caller holds `approval.decide` in the transformation's scope (ADM-only users never do: REQ-S10-003) | 403 `forbidden` |
| 3 | Caller is the assignee user, an effective member of the assignee group, the escalation target (user or group member), or an active delegate of one of these (§3 rule 7) | 403 `approval.not_assignee` |
| 4 | SoD: caller (and the person they act for) is not the requester under `requester_excluded` | 403 `approval.sod_requester` |
| 5 | `If-Match` present and current | 428 / 409 `urn:mth:problem:version-conflict` |
| 6 | Status `pending` or `deferred` | 422 `approval.not_open` |
| 7 | Body `subjectVersion` equals the approval's `subject_version` **and** the subject's current version | **409** `approval.stale_version` |
| 8 | `rationale` has text (shared `hasText` rule); `defer` has `deferUntil` after today's business date | 422 `approval.rationale_required` / 422 `approval.defer_date_required` |

Rules 2–4 are re-checked inside the transaction at commit time (DG3 lesson 4). Refusals:

| Status | Code | English text |
|---|---|---|
| 403 | `approval.not_assignee` | "This approval is not assigned to you, your group or anyone you act for." |
| 403 | `approval.sod_requester` | "You requested this change, so you cannot decide it. The separation-of-duties policy requires a different approver." |
| 409 | `approval.stale_version` | "The record changed after this approval was requested: version {requestedVersion} was submitted and the record is now at version {currentVersion}. Review the changes before deciding." |
| 422 | `approval.not_open` | "This approval is {status} and can no longer be decided." |
| 422 | `approval.rationale_required` | "Enter a rationale for this decision." |
| 422 | `approval.defer_date_required` | "A deferral needs a new date after today." |
| 409 | `approval.already_open` (`urn:mth:problem:duplicate`) | "An approval for this record is already open." |
| 422 | `approval.resubmit_needs_new_version` | "Resubmit after changing the record: the request must be for a newer version." |
| 403 | `approval.not_requester` | "Only the requester can resubmit or withdraw this approval." |

The 409 stale body carries `currentVersion` (the subject's) and `requestedVersion`, so the screen can link to the record's history "diff" (REQ-S10-017 procedure).

**Authorization summary:** request: `approval.request` (SP, TL, BO, WL, FIN, TO) and read access to the subject; decide: as above; resubmit and withdraw: the requester (`approval.not_requester` otherwise); read: anyone who can read the transformation. `GET /api/v1/approvals` lists the caller's approvals (assigned to them, their groups or people they act for, or requested by them). AUD can read and gets 403 on every write.

### 5. T11 Decision Rights Matrix (REQ-PB-065, REQ-PB-066)

**Seed, verbatim (B0099):** `decision_right_template` holds the four rows exactly as the playbook writes them (probe S01):

| `key` | Decision | Recommend | Approve | Consult | Inform | SLA | `sla_type` | Approve party | Escalation chain |
|---|---|---|---|---|---|---|---|---|---|
| `business_scope_change` | Business scope change | Transformation Lead | Sponsor | Business owners / Finance | Workstreams | 5 working days | `working_days` (5) | SP | SP |
| `funding_reallocation` | Funding reallocation | Transformation Lead + Finance | SteerCo | Initiative owners | PMO | Next SteerCo / urgent route | `next_steerco_or_urgent` | STEERCO | STEERCO, SP |
| `target_state_design` | Target-state design | Design owner | Business owner | Tech / Ops / CX / Finance | Transformation Office | 10 working days | `working_days` (10) | BO | BO, SP |
| `go_live_scale` | Go-live / scale | Initiative owner | Business owner | Risk / Tech / CX | SteerCo | Per release plan | `release_plan` | BO | BO, SP |

The playbook text (B0099) is used rather than the master-prompt paraphrase (M0199–M0202, e.g. "Business Owners and Finance"), because REQ-PB-065 cites B0099 and requires the seed "verbatim". Arabic is provisional.

**Per transformation:** `transformation_decision_right` copies the four rows (with `template_key`) when a transformation is instantiated (`p4_instantiate_transformation`, `0030`; backfilled for existing transformations, audited `system` on behalf of the creator). Teams edit their copy (labels, parties, SLA, escalation chain, `status` `active`/`retired`) and may add rows. The template is read-only for `mth_app`. Party arrays must name known parties (trigger). `sla_working_days` is set exactly for `working_days` rows; `urgent_working_days` only on `next_steerco_or_urgent` rows (CHECK). Rows are frozen while their matrix is in approval (§7).

**SLA types (D-089 Q6)**, computed by `governance/decision-rights.ts` (BE-C) when an approval is requested:

| `sla_type` | Due date | Unknown when |
|---|---|---|
| `working_days` | `addWorkingDays(request_business_date, sla_working_days, the organization's default calendar)` (ADR-0025 §1) | no active default calendar → `calendar_not_configured` |
| `next_steerco_or_urgent` | the date of the next scheduled Executive SteerCo meeting of the transformation (slice D's meeting table, through a `NextForumDateProvider` interface that BE-F implements); or, when the requester marks the request urgent **with a reason** (`urgent_reason`), `addWorkingDays(…, urgent_working_days)` | no SteerCo meeting is scheduled → `no_steerco_scheduled` (until slice D lands, the provider returns none, so the due date is Unknown, never guessed); urgent without `urgent_working_days` configured → 422 `decision_right.urgent_not_configured` |
| `release_plan` | the `approved_date` of the milestone named in the request (`releaseMilestoneId`, P3 `milestone`) | no milestone, or a milestone without an approved date → `no_release_date` |

A **Unknown** due date is stored as `due_date = NULL` with `due_unknown_reason` (CHECK `approval_due_known_or_reason`). It is shown as "Unknown", never as on time, and an approval with an Unknown due date is never escalated by the timer (§6).

**Routing (REQ-PB-065):** `routeByDecisionRight(tx, transformationId, key)` reads the active row with that `template_key` (or id), resolves its Approve party through `resolveParty` (§2) and returns the assignee, the SLA and the escalation chain. A `decision_request` approval stores `decision_right_id`. REQ-PB-065's acceptance "a change request of type Business scope change routes approval to the Sponsor" is met when slice H's change request (type `business_scope_change`) calls `routeByDecisionRight(…, 'business_scope_change')`: the Approve party is `SP`, and the approval's assignee is the person or group mapped to SP. Until slice H lands, BE-C proves the same routing with a `decision_request` approval.

**Refusals:** 422 `decision_right.party_unknown` "{party} is not a known governance role."; 422 `decision_right.sla_invalid` "A working-days SLA needs a number of working days between 1 and 250; other SLA types take none."; 422 `decision_right.urgent_not_configured` "This decision has no urgent route configured, so it cannot be raised as urgent."; 422 `decision_right.urgent_reason_required` "An urgent request needs a reason."; 422 `routing.role_unmapped` (§2).

**Authorization:** read: `transformation.read`; edit: `decision_right.configure` (TO, TL; REQ-PB-065 "edit:TO,TL"); approving a matrix version: §7 (SP).

### 6. Timer escalation (REQ-S10-019; D-089 Q7; M0231)

- The `approval.escalation_scan` job (ADR-0025 §3; BE-B, `apps/worker/src/handlers/approvals.ts`) selects open approvals (`pending`, `deferred`) whose `due_date` is **before** today's business date in the approval's calendar timezone. An approval with an Unknown due date is never selected.
- For each, in one transaction under the kit's `runOnce` with key `approval.escalate:<approvalId>:<round>:<dueDate>`:
  1. Take the next party after the current level in the row's `escalation_chain` (level 0 = the Approve party, so the first escalation goes to entry 2). Resolve it with `resolveParty`.
  2. Insert one `approval_escalation` row: the target, or `routing_error = 'party_unmapped'` (the party is unmapped), `'party_not_approver'` (the mapped person or group holds no approver role, §8) or `'no_next_authority'` (the chain is exhausted, e.g. Business scope change, whose default chain is `SP` alone).
  3. If a target was found, set the escalation fields and `escalation_level + 1` on the approval, and create an `approval_escalated` work item for the target. In every case the requester and the current assignee get an inbox reminder naming the delay impact and any routing error, so the error is visible, never a silent skip.
  4. **Nothing else.** The status is unchanged and no decision row is written.
- **Database invariants:** at most one escalation per (approval, round, due date) (unique `approval_escalation_once`; probe A19: a retried escalation is refused); an escalation row needs an open approval whose due date is before today's business date (trigger `approval_escalation_guard`; probe A16); an update that changes `escalation_level` cannot change `status` (probe A20); `approved`/`rejected` needs a user's decision row (§4 invariant 6, probe A10). So **a timer escalates exactly once per due date and never approves**. A deferral to a new date allows one further escalation for that date.
- The escalation target can decide (§4 rule 3). The original assignee also keeps the right to decide.

### 7. T12 RACI per transformation (REQ-PB-067, REQ-S10-007, REQ-S10-009)

**Seed, verbatim (B0101):** `raci_template_deliverable` (6 rows) and `raci_template_cell` (36 cells), read-only (probe S03):

| Deliverable | Sponsor | Transformation Lead | Business Owner | Workstream Lead | Finance | Tech/Data |
|---|---|---|---|---|---|---|
| Charter | A | R | C | I | C | I |
| Target Operating Model | C | R | A | C | C | C |
| Business Case | A | R | C | C | R | C |
| Initiative Delivery | I | C | A | R | C | C |
| Benefits Validation | I | C | A | C | R | I |
| BAU Handover | I | C | A/R | R | C | C |

**Per transformation:** `transformation_raci_deliverable` (`template_key`, `ordinal`, `label_en`, `label_ar`, `accountability_exception`, `status`) and `transformation_raci_assignment` (`deliverable_id`, `party_code`, `value`), copied from the template at instantiation and backfilled. **Copies are independent:** changing a transformation's cell changes neither the template nor another transformation (REQ-S10-007; probe R06).

- **Values:** a cell is `A`, `R`, `C`, `I`, `A/R` or empty (`NULL`, no involvement). Anything else, e.g. `X`, is refused (CHECK `transformation_raci_assignment_value`; probe R02; API 422 `raci.invalid_value`).
- **One accountable (REQ-S10-009, M0211):** at COMMIT, an active deliverable has exactly one cell whose value is `A` or `A/R`; `A/R` counts as one (deferred constraint triggers on both tables, serialized per deliverable with advisory-lock class **730225**). Two `A` entries are refused (probe R03), as is zero (probe R04). Moving the `A` between cells in one save passes (probe R05). The exception: when `accountability_exception` documents the governance rule that permits otherwise (10–2,000 characters), the deliverable may have zero or several (probe R07). BAU Handover's single `A/R` satisfies the rule (probe R01).
- Cell party and deliverable are immutable (trigger). The API saves a deliverable's cells as one request (`PATCH …/raci-deliverables/{id}` with `cells[]`), so the check runs once per save.

**Governance matrix approval (REQ-S10-007 "versioned, approved changes"; REQ-PB-065 "approve-matrix: SP"; REQ-PB-067 "approve: SP"):** `governance_matrix` holds one header per transformation and kind (`decision_rights` = T11, `raci` = T12): `status` (`draft` | `in_approval` | `approved`), `approved_version`, `approved_at`, `approved_by`, `version`.

- Every row edit (T11 row or T12 deliverable/cell) bumps the header's `version` in the same transaction. An edit to an `approved` matrix sets it back to `draft`, and the earlier approval stays in the history.
- `POST /api/v1/transformations/{id}/governance-matrices/{kind}/submit` sets `in_approval` and requests a `governance_matrix_change` approval on the header's current version, routed to the party `SP` (§2). While `in_approval`, its rows are frozen (trigger `governance_matrix_rows_editable`; probe A03). Approve → `approved`, `approved_version` = the approved version. Reject, request changes or withdraw → `draft`.
- Seeded matrices start `draft`. **Readiness does not require an approved matrix** (§9): REQ-PB-008 checks content, not approval.

**Refusals:**

| Status | Code | English text |
|---|---|---|
| 422 | `raci.invalid_value` | "A RACI cell accepts A, R, C, I or A/R." |
| 422 | `raci.accountable_count` | "Each deliverable needs exactly one accountable (A or A/R), unless a documented governance rule permits otherwise. {deliverable} has {count}." |
| 422 | `governance_matrix.in_approval` | "This matrix is waiting for approval. It can change again once the approval is decided or withdrawn." |
| 422 | `governance_matrix.not_draft` | "Only a draft matrix can be submitted for approval." |

**Authorization:** read: `transformation.read`; edit cells and deliverables, submit: `raci.edit` (TO, TL); approve: the SP-mapped person through `approval.decide`.

### 8. Permissions and the technical-administrator rule (REQ-S10-003; seam 8)

`0031` seeds eleven permissions (`P4_PERMISSIONS`, `packages/shared/src/permissions.ts`; `seed.test.ts` compares them):

| Permission | Category | Granted to |
|---|---|---|
| `calendar.configure` | configure | ADM_TECH |
| `job.read` | read | ADM_TECH |
| `job.configure` | configure | ADM_TECH |
| `group.manage` | configure | TO |
| `role_mapping.assign` | configure | TL, TO |
| `delegation.create_own` | write | SP, TL, BO, WL, FIN, TO, KDS, TD, CM, SEC |
| `delegation.manage` | configure | ADM_ACCESS |
| `approval.request` | write | SP, TL, BO, WL, FIN, TO |
| `approval.decide` | **business_approval** | SP, BO, FIN |
| `decision_right.configure` | configure | TL, TO |
| `raci.edit` | write | TL, TO |

- AUD gets none of them, so AUD is read-only on every P4 resource of this slice (403 on every write).
- **No technical-admin role holds `approval.decide`.** The `0001` trigger refuses it (probe A28: inserting `ADM_TECH`→`approval.decide` fails with `role_permission_no_admin_approver`), and after `0031` no technical-admin role holds any `business_approval` or `finance_validation` permission (probe A29). An ADM-only user therefore gets **403** on `POST /approvals/{id}/decisions` (§4 rule 2), and the DG1–DG3 gate and Finance endpoints keep their 403. A person who is also a business approver gets that right only through a separate, audited business-role `scoped_assignment` (ADR-0006).
- **Why only SP, BO and FIN.** They are the roles that already hold a `business_approval` or `finance_validation` permission (`gate.decide`, `kpi_target.approve`, `portfolio.select`, `funding.approve`, `finance.validate`). Two DG1/DG2 rules key on "a role holding an approval permission": the creator-derived assignment never carries such a role (F-DG1-106, `access/assignments.ts`), and the team view never assigns one (ADR-0020 §3, `access/team.ts`, team roles WL, KDS, TD, CM, SEC). Granting `approval.decide` to TL, TO, WL or CM would change both behaviours. The first integration run of this task showed it: 273 integration tests failed, starting with the F-DG1-106 creator tests (log `docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/integration-first-run.log`). With the narrowed grant both rules are unchanged.
- Holding `approval.decide` is necessary but not sufficient: deciding also needs the approval to be assigned to the caller, their group, an escalation target or someone they act for (§4 rule 3).
- **Routing checks the approver.** When an approval is requested, or an escalation resolves its target, a mapped **person** must hold `approval.decide` in the transformation's scope, and a mapped **group** must have at least one current member who does. Otherwise routing is refused with 422 `routing.assignee_not_approver` "{person or group} is mapped to {party} but holds no business-approver role in this transformation. Map an approver or grant the role first." (for an escalation, the row records `routing_error = 'party_not_approver'` and the reminders name the reason). A SteerCo group therefore needs members who hold SP, BO or FIN in the transformation.

### 9. Operating model before execution: Transform readiness (REQ-PB-008)

New operation `GET /api/v1/transformations/{transformationId}/readiness/transform` (`getTransformReadiness`, `transformation.read`; BE-C, `portfolio/readiness.ts` P4 lines). The DG3 operation `getTransformationReadiness` stays byte-stable. The new response is `{ transformationId, phase: "transform", status: "ready" | "not_ready", checks[] }`. `status` is `ready` only when every check passes:

| Check `code` | Passes when |
|---|---|
| `charter_decision_rights` | the transformation's current charter version has a non-blank `decision_rights` (`0013`) |
| `t11_seeded_decisions` | each of the four seeded T11 rows (`template_key` = the four keys) exists with `status = 'active'` (each has an Approve party: `approve_party_code` is NOT NULL) |
| `t11_approvers_mapped` | the Approve party of each of those four rows has an active role mapping (§2) |
| `t12_accountable` | every active T12 deliverable has exactly one A or A/R, or a documented `accountability_exception` (always true for committed data, because of §7's guard; listed so the screen shows it) |

Each failing check lists what is missing (`missing[]`: the seeded keys, parties or deliverables). REQ-PB-008's acceptance reads: "readiness for Transform shows 'not ready' when T11 or charter decision rights are empty and 'ready' once they are completed". The output for existing data changes by design (seam 16): a transformation without charter decision rights or mappings is `not_ready` until they are filled.

### 10. REQ-S16-011: the identity and access entity group

| Entity | Table | Primary key | Owner | Status | Created and read through the API |
|---|---|---|---|---|---|
| Organization | `organization` (0001) | `id` | — (top level) | `status` | P1 (`/organizations`) |
| BusinessUnit | `business_unit` (0001) | `id` | `organization_id` | `status` | P1 (`/organizations/{id}/business-units`, `/business-units/{id}`) |
| User | `app_user` (0001) | `id` | `organization_id` | `status` | P1 (`/users`) |
| Group | `access_group` (0029) + `access_group_member` | `id` | `organization_id`, `owner_user_id` | `status`; member `removed_at` | P4 (`/groups`, BE-B) |
| Role | `role` (0001) | `id` (`code` unique) | — (catalogue) | — (system rows) | P1 (`/roles`, read) |
| Permission | `permission` (0001) | `code` | — (catalogue) | — | P1 (`/permissions`, read) |
| ScopedAssignment | `scoped_assignment` (0001) | `id` | `organization_id`, `granted_by` | `revoked_at` | P1 (`/role-assignments`) |
| Delegation | `delegation` (0001, 0029) | `id` | `organization_id`, `delegator_user_id` | `status` | P4 (`/delegations`, BE-B) |

The REQ-S16-011 integration test (BE-B) creates and reads a Group and a Delegation through the API with authorization enforced, and reads the other six through their P1 operations. Role and Permission are read-only catalogues (the seeded rows are the "create"; P5 makes roles configurable).

### 11. Decimal and Unknown

Slice C stores no money, rate or FTE value. Its Unknowns: a due date that cannot be computed (`due_unknown_reason`, §5), an unmapped party (a visible routing error, §2) and an exhausted escalation chain (`no_next_authority`, §6). None of them is shown as a date, as "on time" or as approved.

## Alternatives considered

- **Fall back to holders of the role when a party is unmapped.** Rejected: REQ-S10-008 requires a visible routing error, and a fallback would route business approvals to whoever holds a role broadly.
- **Groups that grant permissions.** Rejected for P4: it would create a second source of access beside `scoped_assignment` and a path for a technical administrator to gain an approval right.
- **Migrate the DG2/DG3 approval tables into `approval`.** Rejected (D-089 Q10): it would reopen approved invariants. The union view gives one read model.
- **Escalation that reassigns the approval.** Rejected: the original assignee keeps the decision, and the escalation target is added. Nothing about the outcome changes.
- **Loop check scoped by record type and window.** Rejected: stricter-than-needed refusal of any cycle is simpler to prove and matches the acceptance literally.

## Consequences

- `0029`–`0031` add 15 tables and one view and extend `delegation` with five columns. `0032` stays free for slice C/I implementers (work split §I+C, "Migrations").
- Three advisory-lock classes are registered (730224 delegation graph, 730225 RACI deliverable, 730226 approval subject); 730227 stays reserved for this block.
- Slice H (`change_request`) and later slices add their own `approval_type` rows and call `routeByDecisionRight`; they never write `approval` directly.
- A transformation that was "ready" in DG3 terms is `not_ready` for Transform until its charter decision rights and mappings are filled (§9, by design).

## Verification

Evidence: `docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/probe-output.txt`. Probes for this ADR: "backfill: per transformation 2 matrices, 4 T11 rows, 6 T12 deliverables, 36 cells", "the DG3-style delegation row survives", "p4_instantiate_transformation is idempotent", S01–S03, G18–G30, R01–R07, A01–A29, C01. Not verified by this task (assigned in the work split): every API refusal and its English text, the routing service, the SLA computation, the escalation job and the REQ-S16-011 API test (BE-B, BE-C), and the screens (FE-A).

## Amendment (2026-10-09, T-DG4-ARCH-R1): in-transaction resubmit and withdraw, and the codes added outside §4

This amendment answers the gap reported by BE-C (handback §4.1), BE-J (§5 item 3) and BE-L (§5 item 2), recorded in D-107. Nothing above is removed; where this amendment and §4 differ, this amendment wins. BE-R2 implements it (the approval service is BE-B's `workflows/approvals.ts`).

### A1. What the database already allows (no migration)

The `0031` trigger `approval_guard` checks `subject_version` against the subject's current version only on INSERT and when `subject_version` changes, and it lets a resubmission (`changes_requested → pending`, round + 1) take any newer subject version. So both services below need no schema change. A subject module that steps its own row in the same transaction must step it **before** it calls the service (resubmit) or **after** it (withdraw), as each flow in A4 states; otherwise the approval is stale at once.

### A2. `resubmitApprovalInTx(tx, audit, input)` (exported from `workflows/index.ts`)

- **Input:** `{ approvalId, subjectVersion, requestNote?: string | null, expectedApprovalVersion?: number }`. `audit.actorUserId` is the person resubmitting. The caller has already authorised its own subject action; the service checks only what is below.
- **Checks, in this order (nothing is written on a refusal):**
  1. the approval exists and is read `FOR UPDATE` → else 404 `not_found`;
  2. `audit.actorUserId` equals `requested_by` → else 403 `approval.not_requester`;
  3. `expectedApprovalVersion`, when given, equals the approval's `version` → else 409 `urn:mth:problem:version-conflict` with `currentVersion`;
  4. status is `changes_requested` → else 422 `invalid_transition` with the existing `notResubmittable` text ("This approval is {status}; only an approval with changes requested can be resubmitted.");
  5. `subjectVersion` > the approval's `subject_version` → else 422 `approval.resubmit_needs_new_version`;
  6. under `pg_advisory_xact_lock(730226, hashtext(subjectId))`, the subject's current version equals `subjectVersion` → else 409 `approval.stale_version`.
- **Effects:** exactly the effects of today's route body: status `pending`, `round_no + 1`, `subject_version`, `request_note` when given, `version + 1`, `updated_by`; the audit event `approval.resubmit` with the same `changes` (status, round_no, subject_version); the requester's open `approval_changes_requested` items closed `done`; one `approval_decision` task per approver of the current assignee. **It does not call the subject provider's `onOutcome`**: the caller is the subject's own module and has already applied its subject change in this transaction.
- **Returns** the updated approval row.

### A3. `withdrawApprovalInTx(tx, audit, input)` (exported from `workflows/index.ts`)

- **Input:** `{ approvalId, reason, expectedApprovalVersion?: number }`. `reason` must have text (the shared `hasText` rule) → else 400 `validation` at `/reason`.
- **Checks, in this order:** 1 and 2 as in A2 (404; 403 `approval.not_requester`); 3 as in A2 (409); status is `pending`, `deferred` or `changes_requested` → else 422 `approval.not_open`.
- **Effects:** exactly the effects of today's route body: status `withdrawn` (final), `version + 1`; the audit event `approval.withdraw` with `reason` and `changes.status`; every open work item of the approval closed `cancelled`. **It does not call `onOutcome`** (as A2). The subject module then steps its own subject in the same transaction; a withdrawn approval is final, so a later subject update cannot make it stale.

### A4. The routes and each subject's corrected flow

- **The routes** `POST /api/v1/approvals/{approvalId}/resubmit` and `/withdraw` keep their contract and responses. Each becomes: the existing authorization and `If-Match` checks, then the in-transaction service with `expectedApprovalVersion` = the `If-Match` value, then `emitOutcome` (`resubmitted` / `withdrawn`) to the subject provider, as today.
- **A provider may set `resubmitThroughSubject: true`.** For such an approval type, `POST …/resubmit` refuses with 422 `approval.resubmit_through_record`: "Resubmit this request by submitting its record again." (nothing written). The three types below set it. `withdraw` stays available on the route for every type, because its `onOutcome('withdrawn')` runs after the approval is final.
- **`governance_matrix_change` (BE-C, §7).** `submitGovernanceMatrix` accepts a `draft` matrix whose approval is `changes_requested`: it sets the header `in_approval` (header `version + 1`, audited) and then calls `resubmitApprovalInTx` with that new header version, in one transaction. Rows are frozen again from that moment (`governance_matrix_rows_editable`), which closes BE-C's gap for rounds 2 and later. `onOutcome('resubmitted')` is no longer reached for this type.
- **`benefit_transition_decision` (BE-J; ADR-0034 §3).** The stored status stays `draft` while the approval is open, and the API presents `submitted` with `approvalId` (BE-J as built; accepted, because the `0048` CHECK needs `approval_id` on a stored `submitted` row and the approval cannot exist before the request). Withdrawing a decision whose approval is open: `updateTransitionDecision` with `status: withdrawn` calls `withdrawApprovalInTx` first, then moves the row `draft → withdrawn` (audited `transition_decision.withdraw`), in one transaction. This removes the approval that "can never be decided". Resubmitting after changes requested: `submitTransitionDecision` on a draft whose approval is `changes_requested` calls `resubmitApprovalInTx` with the decision's current row version (content edits made while changes were requested step that version).
- **`change_request` (BE-L; ADR-0036).** Resubmission: `submitChangeRequest` freezes the new assessment and returns the request to `submitted` (version + 1), then calls `resubmitApprovalInTx` with that version, in one transaction (today it is two calls). Withdrawal: `withdrawChangeRequest` on a request in approval calls `withdrawApprovalInTx`, then sets the request `withdrawn`, in one transaction. The 422 `change_request.withdraw_via_approval` is then no longer produced (ADR-0036 amendment).
- **Every other approval type** (`decision_request`, `kpi_version_activation`, `kpi_actual_review`, `kpi_actual_rejected`, `adoption_intervention_due`, `risk_disposition`) is unchanged.
- **Tests BE-R2 must add:** for each of the three subjects, (a) a round-2 resubmission through the subject's submit leaves one open approval, round 2, bound to the subject's new version, and a decision on it succeeds; (b) a subject-side withdraw leaves the approval `withdrawn` and the subject withdrawn (or draft for a matrix), with both audit events, in one transaction; (c) `POST …/resubmit` on these types is 422 `approval.resubmit_through_record` and writes nothing; (d) a revoked requester between the request and commit gets 403 and nothing is written.

### A5. Codes and keys added outside §4–§7 (accepted, with their exact English texts)

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `group.code_taken` | 409 | accepted | A group with the code {code} already exists in this organization. |
| `group.member_exists` | 409 | accepted | This person is already a current member of the group. |
| `group.member_other_organization` | 422 | accepted | Only an active user of the group's organization can be a member. |
| `group.owner_invalid` | 422 | accepted | The owner must be an active user of the group's organization. |
| `group.archived` | 422 | accepted | This group is archived. Reactivate it before adding members. |
| `group.member_removed` | 422 | accepted | This member has already been removed. |
| `group.member_window_invalid` | 422 | accepted | A membership must end after it starts. |
| `role_mapping.already_mapped` | 409 | accepted | This party is already mapped in this transformation. End the current mapping first. |
| `role_mapping.party_unknown` | 422 | accepted | {party} is not a known governance role. |
| `role_mapping.target_invalid` | 422 | accepted | Map the party to an active user, or an active group, of this transformation's organization. |
| `role_mapping.ended` | 422 | accepted | This mapping has already ended. Create a new mapping instead. |
| `validation.party_unknown` | 400 field | accepted | {party} is not a known governance role. |
| `validation.party_code` | 400 field | accepted | A governance role code starts with a capital letter and uses A-Z, 0-9 and '_' (up to 32 characters). |
| `validation.duplicate_party` | 400 field | accepted | Each governance role can appear only once in a row. |
| `raci.party_unknown` | 422 | accepted | {party} is not a known governance role. |
| `delegation.delegate_unknown` | 422 | accepted | The delegate must be an active user of the delegator's organization. |
| `delegation.scope_invalid` | 422 | accepted | The scope must be the delegator's organization, one of its business units or one of its transformations. |
| `validation.scope_pair` | 400 field | accepted | Give scopeType and scopeId together. |
| `approval.decision_right_unknown` | 422 | accepted | Choose an active decision right of this transformation. |
| `approval.subject_unknown` | 422 | accepted | The record to approve does not exist in this transformation. |
| `approval.calendar_not_configured` | 422 | accepted | Configure the organization's default business calendar before deferring this approval. |
| `validation.defer_only` | 400 field | accepted | Only a deferral takes a new date. |
| `approval.resubmit_through_record` | 422 | new (§4.1 amendment; BE-R2 implements) | Resubmit this request by submitting its record again. |
| `approvals.task.decide` | message key | accepted | Decide: {title} (round {roundNo}), due {dueDate}. |
| `approvals.task.changes_requested` | message key | accepted | Changes were requested on {title} (round {roundNo}). Update the record and resubmit, or withdraw. |
| `approvals.task.outcome` | message key | accepted | Your approval request {title} (round {roundNo}) was {outcome}. |
| `approvals.task.escalated` | message key | accepted | Escalated to you: {title}, due {dueDate} (level {level}, from {fromParty} to {toParty}). |
| `approvals.task.overdue` | message key | accepted | {title} (round {roundNo}) is overdue since {dueDate} and was escalated to {escalatedToParty} (level {level}). |
| `approvals.task.overdue_routing_error` | message key | accepted | {title} (round {roundNo}) is overdue since {dueDate}, but it could not be escalated: {routingParty} has no mapped person ({routingError}). |
| `charter.decision_rights` | missing-item key | accepted | Charter decision rights |
