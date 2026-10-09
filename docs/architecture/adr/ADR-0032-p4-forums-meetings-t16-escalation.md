# ADR-0032: Forums and meeting series, meetings and the committee workflow, agenda items with executive asks, attendance and quorum, minutes, meeting outputs and action links, the T16 Executive Decision Log, decision-SLA escalation and blocker-red escalation

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-05), 2026-10-09.
- **Requirements (slice D of `docs/architecture/p4-plan.md`):** REQ-PB-060, REQ-PB-061, REQ-PB-068, REQ-PB-081, REQ-PB-082, REQ-S10-005, REQ-S10-011, REQ-S10-012, REQ-S12-011, REQ-S16-019.
- **Sources (quoted where a design point has one):**
  - Playbook B0091 ("Objective: create a fast, disciplined mechanism for cross-functional execution, escalation, learning and decision-making while protecting outcome ownership."), B0092 ("Operating system layers"), B0093 (the table "Layer | Cadence | Purpose | Participants | Outputs" with its five rows, quoted in §1), B0102 ("Governance rule — Escalate decisions, not status. Every executive agenda item should state the decision required, options, recommendation, impact of delay and decision owner."), B0129 ("Template 16 — Executive Decision Log"), B0130 (columns "ID | Decision | Why now | Options | Rec. | Owner | Decision date | Impact if delayed | Outcome"; rows `DEC-01 | [Decision] | [Trigger] | A/B/C | [Rec.] | [Exec] | [Date] | [Impact] | [Decision]`), B0131 ("Escalation principle — A blocker should not remain "red" for multiple cycles without a named decision, decision owner and deadline. Convert recurring issues into explicit executive asks."), B0161 ("… governance cadence …").
  - Master prompt M0083 ("Preserve … governance cadence …"), M0144 (T16: "ID, decision, why now, options, recommendation, owner, decision date, impact if delayed, outcome"), M0150 ("Design decisions and executive decisions should use a shared decision model with appropriate views."), M0189–M0195 (the seeded cadence table: Executive SteerCo "Monthly", Transformation Review "Every two weeks", Workstream Review "Weekly", Rapid Response/Sprint "Daily or 2–3 times per week", Value Review "Monthly"), M0196 ("Make recurrence, participants, cut-off dates and agenda rules configurable. Use Asia/Riyadh for the default business calendar, with configurable workweek, holidays and working-day SLAs. Do not hardcode public holidays or use elapsed calendar days when working days are specified."), M0212 ("Provide an in-app committee workflow: draft agenda → gather linked decision briefs → review materials → record attendance/quorum where configured → record decisions → approve/publish minutes → assign actions → monitor closure. Executive asks require decision, why now, options, recommendation, delay impact, decision owner and required date. Read-only presentation mode and printable packs must use the same underlying records."), M0213 (approvals; "A timer may escalate an overdue approval; it must never approve it automatically."), M0231 ("Decision SLA expires | Escalate to the next configured authority and show delay impact"), M0233 ("Blocker remains red across configured cycles | Require a named executive decision, owner and deadline; avoid duplicating an existing open ask"), M0235 ("Meeting cut-off reached | Generate a draft agenda and pack …"; DG5, see §12), M0325 ("Forum, Meeting, AgendaItem, Attendance, Minutes and MeetingActionLink.").
- **Decisions applied:** D-088 §2 (claims enumerated and exactly true); D-089 Q6 ("Next SteerCo" = the next scheduled Executive SteerCo meeting, or Unknown), Q7 (escalation chain per T11 row; default Approve role then SP; an unmapped authority is a visible routing error), Q8 (cut-off dates are configuration; automatic agenda generation is DG5's REQ-S12-015), R4 (rows citing later A-tests are judged on their own acceptance text), R5 (starter automations are code-defined handlers with configuration values in data); D-090 (S-12 contiguity); D-092 (7) (transformation-scoped paths); D-093 (4) (ADR-0031 §5.4 event-payload conventions, reused in §7 and §8).
- **Builds on:** ADR-0003 (UUIDv7, optimistic concurrency), ADR-0004 (audit), ADR-0006 (authorization; 404 outside scope), ADR-0007 (API conventions), ADR-0015 (one decision model: `decision` kind `executive` reserved for T16, prefix `DEC`; `decision_option`; `action_item`), ADR-0016 (record guards `0010`; lock registry §6), ADR-0025 (business calendar, `addWorkingDays`, `p4_business_date`, job kit `runOnce`, `createWorkItemOnce`, inbox), ADR-0026 (governance parties, `resolveParty`, delegation, T11 rows and their `escalation_chain`, the SLA types, the `NextForumDateProvider` interface, the business-approver rule of §8), ADR-0031 (RAID entries, dependencies and corrective cases as blocker records; §5.4 payload conventions).
- **Physical model:** `0044_p4_forums_meetings.sql`, `0045_p4_t16_escalation.sql`, `0046_p4_governance_permissions.sql`. Probe ids below refer to `docs/delivery/handbacks/DG4/T-DG4-ARCH-05-evidence/probe-output.txt` (101 PASS, 0 FAIL).
- **Two gate systems.** Recording the Outcome of a T16 executive decision is a business decision made by a person in the product (category `business_approval`, §9); it is not a G1–G6 gate decision and approves no gate. Nothing in this ADR reads or writes the engineering records DG0–DG7. No job, trigger or seed records an Outcome: every Outcome is a person's API call (§6). All probe data is synthetic.

## Context

As built before slice D:

1. `decision` (`0017`) is the one decision model. Kind `executive` is "T16 executive decisions (kind = executive, P4)" (its migration comment), with codes `DEC-nn` (`decision_code_format`). Its columns cover title, context, owner, `due_date`, status (`open`, `decided`, `deferred`, `cancelled`), recommendation (option or text), chosen option, `outcome_text`, `decided_by`/`decided_at`. It has no column for "why now" or "impact if delayed".
2. DG3's funding decisions (`portfolio/funding.ts`) already insert `decision` rows of kind `executive`, code `DEC-nn`, created `decided` with an outcome text and no options (`0022` `funding_decision` specialises them). The DG2 operation `listDecisions` (`?kind=executive`) returns them with the DG2 `Decision` schema, whose `createdBy` is a required UUID.
3. `decision_option` (`0017`) holds options A/B/C ("also used by T16 in P4", its comment).
4. `action_item` (`0017`, extended by `0041`) is the canonical action; `created_by` is NOT NULL (ADR-0031 §4, §6).
5. ADR-0026 §5 leaves the SLA type `next_steerco_or_urgent` Unknown "until slice D lands" through a `NextForumDateProvider` interface that BE-F implements.
6. No table stores forums, meetings, agenda items, attendance, minutes, meeting outputs, escalations of executive decisions or blocker RAG observations.

## Decision

### 1. The five operating-system layers, seeded verbatim (REQ-PB-060)

**Entity `forum_template`** (`0044`, read-only for `mth_app`; probes S01, S05) holds the five B0093 rows **exactly** as the playbook writes them (`source_*_en` columns):

| `key` | Layer | Cadence | Purpose | Participants | Outputs |
|---|---|---|---|---|---|
| `executive_steerco` | Executive SteerCo | Monthly | Outcomes, major trade-offs, funding, escalation | Sponsor + CxOs + Transformation Lead | Decisions, unblockers, benefit view |
| `transformation_review` | Transformation Review | Bi-weekly | Portfolio health, dependencies, risks, decisions | Transformation Lead + workstream leads | Integrated status, decision log |
| `workstream_review` | Workstream Review | Weekly | Delivery, issues, actions | Workstream lead + team | Milestones, actions, RAID |
| `rapid_response` | Rapid Response / Sprint | Daily / 2-3x week | Solve high-priority cross-functional issue | Small empowered team | Test, evidence, recommendation |
| `value_review` | Value Review | Monthly | Validate realized benefits vs plan | Finance + benefit owners | Benefit evidence, forecast, corrective action |

The cadence text "Bi-weekly" is B0093's; the master prompt paraphrases it as "Every two weeks" (M0192). REQ-PB-060 cites B0093 and its acceptance says "cadence text verbatim", so the playbook text is stored. Arabic columns (`layer_ar`, `cadence_ar`, `purpose_ar`, `participants_ar`, `outputs_ar`) are **provisional** (`ar_provisional = true`) until a Mobily reviewer confirms them.

Beside the verbatim texts, each template row carries the platform's structured reading, which is configuration and never replaces the text: the chair party (`SP`, `TL`, `WL`, `TL`, `FIN`), the participant parties (SteerCo `SP, TL`; Transformation Review `TL, WL`; Workstream Review `WL`; Rapid Response none; Value Review `FIN, BUSINESS_OWNERS`; "CxOs", "team" and "Small empowered team" name no governance party and are added as named participants, §1.2), the output kinds (§4), the publication rule (§5.3: Value Review only), `executive_asks_only` (SteerCo only, §3.2), and the default recurrence (Monthly → monthly ×1; Bi-weekly → weekly ×2; Weekly → weekly ×1; "Daily / 2-3x week" → daily ×1 on working days; Monthly → monthly ×1).

#### 1.1 Entity `forum` (per transformation; REQ-PB-060, REQ-S10-005, REQ-S16-019 "Forum")

`id`, `organization_id`, `transformation_id`, `template_key` (NULL for a forum a team adds; immutable, `forum_template_immutable`, probe F07; one copy of each layer per transformation, unique index `forum_template_key`, probe F08), `ordinal`, `name_en`, `name_ar`, `cadence_label`, `purpose`, `participants_label`, `outputs_label`, `chair_party_code`, `secretary_user_id`, `participant_parties` (known parties only, `forum_participant_parties_known`, probe F04), `output_kinds` (non-empty subset of the closed set of §4, `forum_output_kinds_valid`, probe F05), `publish_requires_any_output` (a subset of `output_kinds`, `forum_publish_outputs_subset`, probe F06), `executive_asks_only`, `quorum_min` (NULL = not configured; 1–100), `cutoff_working_days` (0–20, default 2), `agenda_max_items` (NULL = no limit; 1–50), `late_items_rule` (`flag` | `refuse`), `status` (`active` → `archived`, final: `forum_archived_final`), `version`, stamps. Guards: `p2_attach_guards('forum', true)` (probes F01, F02).

- **Instantiation.** `p4_instantiate_forums(transformation, actor, request, source)` (`0044`) copies the five layers into `forum` with the template's verbatim English texts as labels; idempotent (probe G06), serialized by the transformation row lock, each row audited (`forum.create`; actor `user` from the API, `system` on behalf of the creator in the backfill). `0044` redefines `p4_instantiate_transformation` (`0030`) with one added line at its end that calls it, so the single P4 instantiation call also creates the forums (probe G07); the rest of that function body is byte-for-byte the `0030` text. `0044` backfills every existing transformation (probe G04).
- **Configuration (REQ-S10-005).** Recurrence is the meeting series (§2); participants are `participant_parties` plus `forum_participant` rows (§1.2); cut-off is `cutoff_working_days`; agenda rules are `executive_asks_only`, `agenda_max_items`, `late_items_rule` and `publish_requires_any_output`. Every change is versioned and audited (probe F03). The template is never changed by a forum edit (`mth_app` has SELECT only on it).

#### 1.2 Entity `forum_participant` (REQ-S10-005 "participants")

`id`, `organization_id`, `transformation_id`, `forum_id`, exactly one of `user_id` / `group_id` (`forum_participant_one_target`, probe FP01; a group of the same organization, `forum_participant_same_org`), `counts_for_quorum` (default true), `status` (`active` → `removed`, final), `removed_at`, `removed_by`, `version`, stamps. One active participation per (forum, person) and per (forum, group) (probe FP02). A participant row names who is invited; it grants no permission (ADR-0026 §1: groups are routing targets only).

### 2. Meeting series and recurrence, with future-only regeneration (REQ-PB-060, REQ-S10-005)

**Entity `meeting_series`** (`0044`): `forum_id` (immutable), `frequency` (`daily` | `weekly` | `monthly`), `interval_count` (1–12), `weekdays` (ISO 1 = Monday … 7 = Sunday; required for weekly and only for weekly), `month_day` (1–28; required for monthly and only for monthly) (`meeting_series_rule_shape`, probe MS01), `start_date`, `end_date`, `start_time` (local), `duration_minutes` (15–480), `timezone` (default `Asia/Riyadh`, a known zone), `non_working_day_rule` (`next_working_day` default | `skip` | `keep`), `horizon_days` (7–366, default 90), `location`, `rule_version`, `generated_through`, `status` (`active` → `ended`, final), `ended_at`, `ended_by`, `version`, stamps. At most one active series per forum (`meeting_series_one_active_key`, probe MS03). A person creates a series and changes its recurrence (`meeting_series_author_required`, probe MS06); the generation job (actor service, `updated_by` NULL) only advances `generated_through` (probe MS07). Every change to a recurrence field steps `rule_version` by exactly 1, and `rule_version` changes only with the recurrence (`meeting_series_rule_version_step`, probes MS04, MS05). Guards: probes MS02.

**Occurrences.** For each nominal date `d` from `max(start_date, today + 1)` to `min(end_date, today + horizon_days)`, where "today" is the business date in the series timezone (`p4_business_date`, ADR-0025 §1):

- daily: every `interval_count`-th day counted from `start_date`, **working days only** (the organization's default calendar, ADR-0025 §1), so "Daily" never produces a weekend or holiday meeting;
- weekly: the listed weekdays of every `interval_count`-th week, weeks counted from the week of `start_date` (Monday-based ISO weeks);
- monthly: day `month_day` of every `interval_count`-th month counted from the month of `start_date`.

A nominal date that is not a working day follows `non_working_day_rule`: `next_working_day` moves `scheduled_date` to the next working day (the nominal date stays `occurrence_date`); `skip` creates no meeting; `keep` keeps the date. Without an active default calendar, daily and `next_working_day`/`skip` cannot be evaluated: the job creates nothing for such a series and records the inbox notification `calendar_not_configured` to the series author (Unknown, never a guessed date). `starts_at`/`ends_at` are `scheduled_date` + `start_time` (+ duration) in the series timezone, stored as `timestamptz`.

**Generation (BE-F; job `governance.meeting_series_generate`, daily schedule in `Asia/Riyadh`, ADR-0025 §3).** Under `pg_advisory_xact_lock(730238, hashtext('<seriesId>'))` it inserts the missing occurrences as `meeting` rows (`created_source = 'worker'`, `created_by` NULL, audit actor service) and sets `generated_through`. The partial unique index `meeting_series_occurrence_key` on (`series_id`, `occurrence_date`) WHERE `status <> 'cancelled'` makes a second insert of the same occurrence fail (probe M03), so a retried or re-run job creates no duplicate. `createMeetingSeries` runs the same generation in its own transaction, so the first meetings exist when the call returns.

**Regeneration on a recurrence change (REQ-S10-005 acceptance "changing Workstream Review from weekly to fortnightly regenerates future meetings only").** `updateMeetingSeries`, in one transaction under lock 730238:

1. steps `rule_version`;
2. cancels (`status = 'cancelled'`, `cancel_reason = 'series_regenerated'`, audit actor the person) every meeting of the series that is `scheduled`, whose `scheduled_date` is **after** today's business date, and that has no agenda item, attendance row, output, action link, blocker status or minutes;
3. generates the occurrences of the new rule from tomorrow, skipping any nominal date still held by a kept meeting.

Meetings on or before today, meetings already past `scheduled`, and future meetings with content are kept unchanged (the response lists them as `keptMeetingIds`). The database refuses a `series_regenerated` or `series_ended` cancellation of a meeting that is not a future `scheduled` series meeting (`meeting_regenerate_future_only`, probe M05) and accepts it for a future one (probe M06, which then inserts the regenerated occurrence for the same date). `endMeetingSeries` cancels the same set with `cancel_reason = 'series_ended'`.

### 3. Meetings, agenda items and the committee workflow (REQ-S10-011, REQ-PB-068, REQ-S10-012)

#### 3.1 Entity `meeting` (REQ-S16-019 "Meeting")

`forum_id`, `series_id`, `series_rule_version`, `occurrence_date` (all three NULL for an ad-hoc meeting, all set for a series meeting: `meeting_series_fields`), `scheduled_date`, `starts_at`, `ends_at` (`meeting_times`), `timezone`, `location`, `chair_user_id`, `secretary_user_id`, `quorum_min` (copied from the forum when the meeting is created; editable until the session starts), `cutoff_date` or `cutoff_unknown_reason` (`calendar_not_configured`) (`meeting_cutoff_known_or_reason`), `status`, cancellation fields, `started_at`, `held_at`, `created_source` (`api` with a person author, or `worker` from a series with no author: `meeting_created_source`, probe M01), `version`, stamps (probe M02).

- **Cut-off date (M0196 configurable cut-off; D-089 Q8):** `scheduled_date` minus `cutoff_working_days` working days on the organization's default calendar; Unknown with `calendar_not_configured` when there is none. DG4 generates no agenda at the cut-off (M0235 is REQ-S12-015, DG5); the cut-off governs late items (§3.2).
- **Chair and secretary:** at creation, `chair_user_id` = `resolveParty(forum.chair_party_code)` when it resolves to a person (ADR-0026 §2; a group or an unmapped party leaves it NULL), `secretary_user_id` = `forum.secretary_user_id`. `updateMeeting` may set either. A chair-only action on a meeting without a chair is refused (`meeting.chair_unassigned`).
- **State machine** (`meeting_status_transition`, probe M08): `scheduled → agenda_published → in_session → held → minutes_published`; `scheduled → in_session` (a meeting run without a published agenda); `scheduled | agenda_published → cancelled`. A new meeting is `scheduled` (probe M04). `minutes_published` and `cancelled` are **final**: no column changes (`meeting_final`, probes M07, MN06). `minutes_published` needs published minutes (`meeting_minutes_required`, probe M10). A manual cancellation needs who and a 3–2000 character note (`meeting_cancelled_complete`, probe M09).
- **Frozen children.** Once a meeting is `minutes_published` or `cancelled`, no agenda item, attendance row, output, action link or blocker status of it can be inserted or updated (`p4_meeting_child_editable`, constraint name `<table>_meeting_frozen`; probe MN05).

Workflow steps of M0212 and the operations that perform them:

| M0212 step | Operation(s) | Rule |
|---|---|---|
| draft agenda | `createAgendaItem`, `updateAgendaItem`, `withdrawAgendaItem` | items start `draft` |
| gather linked decision briefs | `createAgendaItem` with `decisionId` (an open T16 ask) or a draft brief (§3.2) | — |
| review materials | `materialsEvidenceIds` on the item (P2 evidence ids, ≤ 20) | evidence is read through its own scope rules |
| record attendance/quorum where configured | `recordMeetingAttendance`, `updateMeetingAttendance` | §3.3 |
| record decisions | `recordAgendaItemOutcome` | §3.3 quorum; §6 Outcome |
| approve/publish minutes | `approveMeetingMinutes`, `publishMeetingMinutes` | §5 |
| assign actions | `createMeetingAction` | §5.4 |
| monitor closure | `listMeetingActions` (with each action's status and overdue flag) | — |

"Read-only presentation mode and printable packs must use the same underlying records" (M0212): the meeting read model (`getMeeting` with its agenda, attendance, outputs, minutes and actions) is the only source of both; no pack is stored in DG4.

#### 3.2 Entity `agenda_item` (REQ-S16-019 "AgendaItem"; REQ-PB-068; REQ-S10-012)

`meeting_id`, `ordinal` (unique per meeting, deferrable), `item_kind` (`executive_ask` | `discussion` | `information`), `title`, `description`, `presenter_user_id`, `duration_minutes`, `materials_evidence_ids`, `decision_id`, the draft brief `ask_decision_required`, `ask_why_now`, `ask_options` (1–26 texts), `ask_recommendation`, `ask_impact_of_delay`, `ask_owner_user_id`, `ask_required_date`, `late`, `status`, `published_at`/`published_by`, `outcome` (`decided` | `deferred` | `noted`), `outcome_quorum_present`, `outcome_recorded_at`/`outcome_recorded_by`, `version`, stamps (probe A02).

- **One copy of an ask.** Only an `executive_ask` item links a decision or carries a brief, and a linked item carries no brief (`agenda_item_ask_shape`, probe A03). Publishing a brief creates the T16 row (`ask_origin = 'agenda'`, §6) **and clears the brief in the same UPDATE**, so after publication the five elements exist once, on the T16 record.
- **"Escalate decisions, not status" (B0102).** In a forum with `executive_asks_only` (seeded true for Executive SteerCo only), an item of another kind is refused (`agenda_item_executive_asks_only`, probe A01; API 422 `agenda_item.executive_asks_only`).
- **Publication (REQ-PB-068 acceptance "publishing an agenda item missing 'Impact of delay' is rejected by the API"; REQ-S10-012 "validates all seven fields before it can be added to an agenda").** `publishAgendaItem` on an `executive_ask` checks, before any write, that the five B0102 elements (decision required, options ≥ 2, recommendation, impact of delay, decision owner) and the two REQ-S10-012 additions (why now, required date) are present, either on the brief or on the linked decision. Any missing element is a 422 `agenda_item.executive_ask_incomplete` listing each missing element as an error (§11). The database refuses a published `executive_ask` without a linked decision (`agenda_item_published_ask_linked`, probe A04); the linked decision's elements are themselves enforced by `decision_ask_complete` and `decision_ask_options` (§6; probes D01–D03), except on a blocker escalation (§8), whose missing elements the API check above refuses.
- **State machine** (`agenda_item_status_transition`): `draft → published → closed`; `draft | published → withdrawn`; a new item is `draft`; `closed` and `withdrawn` are final (`agenda_item_final`, probe A10). A published item is frozen except for the status edge and the outcome fields (`agenda_item_published_frozen`, probe A06). Only `draft` items can be edited through `updateAgendaItem`. `publishAgendaItem` and `publishMeetingAgenda` are chair actions (REQ-PB-068 "publish:chair").
- **Late items and limits:** an item created after the meeting's `cutoff_date` gets `late = true` when the forum's `late_items_rule` is `flag`, and is refused (422 `agenda_item.after_cutoff`) when it is `refuse`; an item beyond `agenda_max_items` (counting items not withdrawn) is refused (422 `agenda_item.max_items`).
- `publishMeetingAgenda` moves the meeting `scheduled → agenda_published` when it has at least one published item and no draft item (422 `meeting.agenda_empty`, `meeting.agenda_has_drafts`).

#### 3.3 Attendance and quorum (REQ-S10-011 "with quorum configured, decisions cannot be recorded below quorum")

**Entity `meeting_attendance`** (REQ-S16-019 "Attendance"): `meeting_id`, `user_id` (one row per person and meeting, `meeting_attendance_person_key`, probe AT01), `attendance` (`present` | `absent` | `apologies`), `counts_for_quorum` (default true; the API sets it from the person's `forum_participant` row when one exists, else false for a non-participant), `on_behalf_of_user_id` (a representative is present; `meeting_attendance_proxy_present`, probe AT02; not oneself), `note`, `version`, stamps.

**Quorum rule.** The present count is the number of the meeting's attendance rows with `attendance = 'present'` and `counts_for_quorum`. When `meeting.quorum_min` is set, an agenda item's `outcome` becomes `decided` only if the present count is at least `quorum_min` **and** the request states that count in `outcome_quorum_present`; the database recounts and refuses otherwise (`agenda_item_quorum_met`, probes A08, A09). A decision is recorded only while the meeting is `in_session` or `held` (`agenda_item_meeting_not_in_session`, probe A07). When `quorum_min` is NULL ("where configured", M0212) there is no quorum check. The API returns 422 `meeting.quorum_not_met` with both numbers before any write. The `deferred` and `noted` outcomes have no quorum check.

### 4. Meeting outputs linked to canonical records (REQ-PB-061)

**Entity `meeting_output`** (`0044`): `meeting_id`, `agenda_item_id`, `output_kind`, `record_type`, `record_id`, `note`, `created_at`, `created_by`. Append-only (probes O04, O05) and audited (probe O06). The kind must be one of the meeting's forum `output_kinds` (`meeting_output_kind_of_forum`, probe O01). The closed set of kinds and the canonical record each links (`meeting_output_record_type`, probe O02; the linked record must exist in the same transformation, `meeting_output_record_ref`, probe O03):

| Kind (B0093 output) | Linked record | Record required |
|---|---|---|
| `decision` (Decisions) | `decision` | yes |
| `decision_log` (Decision log) | `decision` or none | no |
| `unblocker` (unblockers) | `raid_entry`, `dependency`, `decision` or none | no |
| `benefit_view` (benefit view) | `benefit` or none | no |
| `integrated_status` (Integrated status) | none | no (note) |
| `milestone` (Milestones) | `milestone` | yes |
| `action` (actions) | `action_item` | yes |
| `raid` (RAID) | `raid_entry` or `dependency` | yes |
| `test` (Test) | `evidence` or none | no |
| `evidence` (evidence) | `evidence` | yes |
| `recommendation` (recommendation) | `decision` or none | no |
| `benefit_evidence` (Benefit evidence) | `benefit_evidence` or `benefit_measurement` | yes |
| `forecast` (forecast) | `benefit` or `benefit_measurement` | yes |
| `corrective_action` (corrective action) | `corrective_case` | yes |

An output without a record states a note (`meeting_output_note_or_record`). Outputs are references, never copies: a forecast output points at the benefit whose forecast is shown from the benefit register.

**Decisions flow into T16 (REQ-PB-061 "decisions recorded appear in T16").** A meeting decision is always a `decision` row of kind `executive` (an executive ask on the agenda, §3.2, §6); `recordAgendaItemOutcome` with `decided` records its Outcome (§6) and inserts a `decision` output linking it, in one transaction. So every decision recorded in a meeting is a T16 entry.

### 5. Minutes (REQ-S10-011, REQ-PB-061, REQ-S16-019 "Minutes")

#### 5.1 Entity `meeting_minutes`

One per meeting (`meeting_minutes_meeting_key`): `body` (1–50 000 characters, the shared free-text rules), `status`, `approved_at`/`approved_by`, `published_at`/`published_by`, `version`, stamps.

#### 5.2 State machine

`draft → approved → published`; `approved → draft` (returned for edits) (`meeting_minutes_status_transition`). New minutes are `draft`. Approved minutes are not edited in place (`meeting_minutes_approved_frozen`, probe MN01). **Published minutes are immutable**: every UPDATE is refused (`meeting_minutes_published_immutable`, probe MN04); DELETE and TRUNCATE are refused by trigger (`meeting_minutes_no_delete`) and `mth_app` has no DELETE grant (probe P01). Approve and publish are chair actions; draft and edit are `meeting.prepare` actions.

#### 5.3 Publication rule (REQ-PB-061 acceptance "a Value Review meeting cannot be published without a benefit evidence or forecast entry")

Minutes are published only for a `held` meeting (`meeting_minutes_meeting_held`, probe MN07). When the forum's `publish_requires_any_output` is not empty, at least one output of one of those kinds must exist for the meeting (`meeting_minutes_required_output`, probe MN02); with a `forecast` output linked to a benefit, publication succeeds (probe MN03). The Value Review template sets `{benefit_evidence, forecast}`; the other four layers set none (a forum's rule is configurable, REQ-S10-005). `publishMeetingMinutes` publishes the minutes and moves the meeting to `minutes_published` in one transaction ("publishing the meeting record"). The API returns 422 `meeting_minutes.required_output_missing` before any write.

#### 5.4 Meeting actions and My Work (REQ-S10-011 "actions appear in owners' My Work"; REQ-S16-019 "MeetingActionLink")

**Entity `meeting_action_link`** (`0044`): `meeting_id`, `agenda_item_id`, `action_item_id`, `link_kind` (`assigned` | `reviewed`), `created_at`, `created_by`; one per (meeting, action) (probe L01); append-only (probe L02); audited. `createMeetingAction` creates the canonical `action_item` (person-authored, the caller; DG2 statuses; ADR-0031 §4) and the `assigned` link in one transaction, and creates the owner's My Work item through `createWorkItemOnce` (kind `meeting_action_due`, subject `action_item`, due date = the action's due date, dedupe key `meeting.action:<actionItemId>:<ownerUserId>`). `linkMeetingAction` is not provided in DG4: an existing action reviewed in a meeting is recorded as an `action` output (§4). "Monitor closure": `listMeetingActions` returns each linked action with its current status and `overdue` (due date before today's business date and status `open` or `in_progress`).

### 6. The T16 Executive Decision Log on the canonical decision (REQ-PB-081, REQ-S10-012)

**No new table.** `0045` adds nullable columns to `decision` (additive; ADR-0015 "P4 adds columns and views, not a new table"): `why_now`, `impact_of_delay`, `ask_origin` (`api` | `agenda` | `blocker_escalation`), `created_source` (`api` | `worker`), `source_agenda_item_id`, `decision_right_id` (a T11 row of the transformation), `sla_due_date`, `sla_unknown_reason` (`calendar_not_configured` | `no_steerco_scheduled` | `no_release_date`), `decided_on_behalf_of_user_id`, `blocker_record_type`, `blocker_record_id`. Every pre-P4 row and every DG3 funding decision keeps `ask_origin` NULL, so none of the new CHECKs applies to them and none changes (probe G05).

**T16 columns (B0130) on the record:**

| T16 column | Field | Rule for an ask (`ask_origin` `api` or `agenda`) |
|---|---|---|
| ID | `code` | `DEC-nn` from `record_code_counter` prefix `DEC` (shared with funding decisions; B0130 "DEC-01…") |
| Decision | `title` | 1–500 characters, required |
| Why now | `why_now` | 1–4000, required (`decision_ask_complete`, probe D01) |
| Options | `decision_option` rows A, B, C … | at least two active options, checked at the commit of every transaction that inserts or updates the ask row (`decision_ask_options`, deferred; probe D03) |
| Rec. | `recommendation_option_id` or `recommendation_text` | one required |
| Owner | `owner_user_id` | required; must hold `executive_decision.decide` in the transformation (API, 422 `executive_decision.owner_not_executive`; B0130 "[Exec]") |
| Decision date | `due_date` | the required date (REQ-S10-012 note "Required date = Decision date"); required; not before today's business date on create |
| Impact if delayed | `impact_of_delay` | 1–4000, required (probe D02) |
| Outcome | `outcome_text` (+ `chosen_option_id`) | required once `decided` (`decision_ask_outcome_recorded`, probe D06) |

The ask columns exist only on kind `executive` (`decision_ask_executive_only`, probe D05); origin and source are immutable (`decision_ask_origin_immutable`, probe D07); the SLA due date is known or carries its reason (`decision_ask_sla_known_or_reason`, probe D08); guards: probe D04.

**REQ-S10-012 acceptance "an ask without 'why now' is rejected by the API":** `createExecutiveDecision` declares `title`, `whyNow`, `options` (2–26), `recommendation` (an option label or a text), `impactOfDelay`, `ownerUserId` and `requiredDate` as required; a request without `whyNow` is a 400 `urn:mth:problem:validation` with the error `{ pointer: "/whyNow", code: "executive_decision.field_required", message: "Why now is required." }`, before any write; the database refuses the same row as a second line (probe D01).

**SLA due date** (computed once at creation and again when `requiredDate` or `decisionRightId` changes): without a T11 row, `sla_due_date = due_date`. With `decisionRightId`, ADR-0026 §5's SLA computation for that row applies to the ask's creation business date (`working_days` → `addWorkingDays`; `next_steerco_or_urgent` → the next Executive SteerCo meeting through `NextForumDateProvider`, §10, or the urgent route; `release_plan` → the named milestone's approved date); an Unknown result is stored as `sla_unknown_reason` and is never escalated (§7).

**Outcome (REQ-PB-081 acceptance "a decision with Outcome recorded is closed and leaves the overdue list").** `recordExecutiveDecisionOutcome` (`If-Match`) with `{ outcome: "decided" | "deferred" | "cancelled", chosenOptionLabel?, outcomeText, deferUntil? }`:

- `decided`: `status = 'decided'`, `chosen_option_id` (when a label is given; it must be an active option), `outcome_text` (required), `decided_by` = the caller, `decided_on_behalf_of_user_id` = the owner when the caller acts as the owner's active delegate (ADR-0026 §3), `decided_at`.
- `deferred`: needs `deferUntil`, a business date after today; `due_date` and `sla_due_date` become that date, so an expired deferral escalates once more (§7).
- `cancelled`: needs `outcomeText` as the reason.
- Only the owner, or the owner's active delegate, holding `executive_decision.decide` may record it (403 `executive_decision.not_owner`). A `decided` or `cancelled` ask is final (422 `executive_decision.closed`).
- **Overdue list:** an ask is overdue when its status is `open` or `deferred` and its `due_date` is before today's business date in the organization's default calendar timezone (Asia/Riyadh by default). `listExecutiveDecisions?overdue=true` returns exactly those rows, so a decided ask leaves it. The overdue flag is computed on read and never stored.
- The owner of a new or re-owned open ask gets one My Work item (kind `executive_decision_due`, subject `decision`, due date = `due_date`, dedupe key `t16.decision:<decisionId>:<ownerUserId>`), closed when the ask is decided or cancelled.

**The register view `executive_decision_log`** (`0045`, SELECT-only for `mth_app`; probe P03) lists every `decision` of kind `executive` with the nine T16 columns (`t16_id`, `decision`, `why_now`, `options` as "A/B/…", `recommendation`, `owner_user_id`, `decision_date`, `impact_of_delay`, `outcome`), plus `status`, `ask_origin`, the SLA and blocker fields, `version` and stamps (probe V01 checks all nine on a decided ask). DG3 funding decisions are listed with `askOrigin: null` (shown as origin "funding decision" when a `funding_decision` row references them, else "earlier record"); a T16 column they do not have is NULL and shown as Unknown, never blank-as-zero. The API's `ExecutiveDecision` representation reads this view plus the options; the DG2 `listDecisions?kind=executive` and its `Decision` schema are unchanged and keep returning the same rows (they do not show the new columns).

### 7. Decision-SLA escalation (REQ-S12-011; M0231; D-089 Q7)

**Entity `decision_escalation`** (`0045`): `decision_id`, `sla_due_date`, `business_date`, `level` (1–5), `party_code`, `target_user_id` / `target_group_id`, `routing_error` (`party_unmapped` | `party_not_executive` | `no_next_authority`), `delay_impact`, `escalated_at`. Append-only (probe E05) and audited with actor service (probe E03); `mth_app` has INSERT and SELECT only (probe P02).

**The job `governance.decision_sla_scan`** (BE-G, `apps/worker/src/handlers/escalations.ts`; daily schedule in `Asia/Riyadh`, ADR-0025 §3). It runs on a working day of the organization's default calendar and does nothing on a non-working day or without a calendar. It selects executive asks (`ask_origin` NOT NULL) whose status is `open` or `deferred` and whose `sla_due_date` is before today's business date. An ask with an Unknown SLA date (`sla_due_date` NULL) is never selected. For each, in one transaction under `runOnce(job, 'decision.escalate:<decisionId>:<slaDueDate>', …)` and `pg_advisory_xact_lock(730240, hashtext('<decisionId>'))`:

1. **Next authority.** The chain is the T11 row's `escalation_chain` when `decision_right_id` is set, else the transformation's `decision_sla` rule chain (`governance_escalation_rule`, §8.1), else the default `['SP']`. The next level is `(the highest existing level for the ask, else 0) + 1`; its party is the chain entry at that position. The party is resolved with `resolveParty` (ADR-0026 §2). A resolved person who is the ask's owner is skipped to the next entry.
2. **Insert one `decision_escalation` row** with the target, or `routing_error`: `party_unmapped` (no mapping), `party_not_executive` (the mapped person, or every current member of the mapped group, lacks `executive_decision.decide`), `no_next_authority` (the chain is exhausted; `party_code` NULL). `delay_impact` is the ask's `impact_of_delay` at that moment (NULL for a blocker escalation without one, shown "Impact of delay not stated").
3. **Notify.** A found target gets one My Work item (kind `executive_decision_escalated`, dedupe key `t16.escalated:<decisionId>:<slaDueDate>:<targetUserId>`; for a group, one per current member) and an inbox notification naming the delay impact; the owner and the ask's creator get an inbox notification naming the delay impact and any routing error (a visible routing error, never a silent skip).

**Database invariants:** at most one escalation per (ask, SLA due date) (`decision_escalation_once`, probe E04: a retried or re-run job escalates once); the SLA due date is before the escalation's business date (`decision_escalation_expired`, probe E01); the ask is an open or deferred executive ask whose current `sla_due_date` is the one escalated (`decision_escalation_open_ask`, probes E02, E09); levels step by exactly 1 (`decision_escalation_level_step`, probe E07); a routing error has no target and a found target has no error (`decision_escalation_target`, probe E06). **An escalation never decides**: the job writes no `decision` column (it inserts escalation, work-item and inbox rows only), and an Outcome needs a person's `recordExecutiveDecisionOutcome` (§6). A deferral to a new date allows one further escalation for that date.

**REQ-S12-011 acceptance "an SLA expiring on a working day escalates once to the next authority and shows the delay impact text":** an ask with `sla_due_date` = a working day `D` is selected by the first working-day run after `D`, gets one escalation row with `delay_impact`, and a second run creates none (the unique constraint and the `runOnce` key). `listDecisionEscalations` and `getExecutiveDecision` show the escalation with its target and delay impact.

### 8. Blocker-red escalation (REQ-PB-082; B0131; M0233)

#### 8.1 Entity `governance_escalation_rule` (`0045`)

One optional row per transformation and kind (`governance_escalation_rule_kind_key`, probe R03): `decision_sla` (`escalation_chain`, 1–5 known parties) or `blocker_red` (`red_cycles` 2–12, "multiple cycles" (probe R02); `deadline_working_days` 1–60; `owner_party_code`) (`governance_escalation_rule_shape`, probe R01); `enabled`; kind immutable (probe R04); versioned and audited. **Defaults** (when no row exists; constants in `governance/escalation-rules.ts`; `listEscalationRules` returns both kinds with `isDefault: true`): `decision_sla` chain `['SP']`, enabled; `blocker_red` `red_cycles` 2, `deadline_working_days` 10, owner party `SP`, enabled.

#### 8.2 Entity `blocker_status` (`0045`): the RAG history by cycle

One row per (meeting, blocker) (`blocker_status_once_per_cycle`, probe B04): `meeting_id`, `forum_id` and `cycle_date` (the meeting's own forum and `scheduled_date`, `blocker_status_cycle_of_meeting`, probe B02), `source_record_type` (`raid_entry` | `dependency` | `corrective_case` | `initiative` | `milestone`), `source_record_id` (must exist in the transformation, `blocker_status_record_ref`), `rag` (`red` | `amber` | `green` | `unknown`), `note`, `created_at`, `created_by`. Recorded only while the meeting is `in_session` or `held` (`blocker_status_meeting_in_session`, probe B01); append-only (probe B05); audited (probe B03). A **cycle** is one meeting of one forum.

#### 8.3 The rule and the job

`recordBlockerStatus` (BE-G) writes the row and an outbox event `blocker_status.recorded` (payload `{ blockerStatusId, transformationId, forumId, meetingId, cycleDate, sourceRecordType, sourceRecordId, rag }`, idempotency key `blocker_status.recorded:<blockerStatusId>`, the ADR-0031 §5.4 conventions). The consumer `governance.blocker_escalation` and a daily scan `governance.blocker_escalation_scan` (both BE-G) evaluate a blocker in a forum the same way, under `runOnce` and `pg_advisory_xact_lock(730239, hashtext('<transformationId>:<sourceRecordType>:<sourceRecordId>'))`:

1. Read the rule (or default). If disabled, stop.
2. Take the forum's latest `N = red_cycles` meetings with status `in_session`, `held` or `minutes_published` and `scheduled_date` on or before the observation's `cycle_date`, newest first. The blocker is "red for N cycles" only if there are N such meetings and each has a `blocker_status` row for the blocker with `rag = 'red'`. A cycle without an observation, or with `amber`, `green` or `unknown`, ends the run (an Unknown cycle is never counted as red).
3. If red for N cycles and no executive ask that is `open` or `deferred` exists for the blocker: **create one** `decision` row of kind `executive` with `ask_origin = 'blocker_escalation'`, `created_source = 'worker'`, `blocker_record_type`/`blocker_record_id`, a `DEC-nn` code, `title` = the blocker's own name (the RAID description, dependency description, case title, initiative or milestone name; truncated to 500), `owner_user_id` = `resolveParty(owner_party_code)` when it resolves to a person who holds `executive_decision.decide` (else NULL, listed as `ownerStatus: "unassigned"` with the routing error, never a guessed owner), `due_date` = `sla_due_date` = `addWorkingDays(cycle_date, deadline_working_days)` on the organization's default calendar. Without an active default calendar the deadline cannot be computed, and `decision_ask_source` requires one: the job then creates no ask and sends the inbox notification `calendar_not_configured` to the transformation lead (a visible gap, never a guessed deadline); the next evaluation after a calendar is configured creates it. `created_by`/`updated_by` = the person who recorded the N-th red observation (the act that triggered the escalation); the audit event's actor is `system` on behalf of that person (the `0030` backfill precedent), with `reason` "Blocker red for N consecutive cycles". The owner gets the `executive_decision_due` work item.
4. Otherwise do nothing.

**"Without duplicating an existing open ask":** the partial unique index `decision_one_open_blocker_ask` on (`transformation_id`, `blocker_record_type`, `blocker_record_id`) WHERE status is `open` or `deferred` holds at most one open ask per blocker, whatever its origin (probe D09); after that ask is decided or cancelled, a new red run may create a new one (probe E10). A person may also link a person-raised ask to a blocker (`blockerRecordType`/`blockerRecordId` on `createExecutiveDecision`); the index then counts it, so the job creates none. Only the worker creates `blocker_escalation` asks (`decision_ask_source`, probe D10); the blocker must exist (probe D11).

**REQ-PB-082 acceptance "a blocker Red in 2 consecutive cycles (N=2) produces exactly one open T16 ask; re-running the job creates no duplicate":** with the default rule, red observations in two consecutive meetings of a forum create one ask at the second observation; the scan and a redelivered event find the open ask (step 3) and create none; a concurrent run is serialized by lock 730239 and, as a second line, refused by the unique index.

**Completing a blocker escalation.** The created ask names the decision, owner and deadline (B0131, M0233); its why now, options, recommendation and impact of delay are completed by a person through `updateExecutiveDecision` before it can be added to an agenda (§3.2). Until then `getExecutiveDecision` lists the missing elements as `missingElements`, so the gap is visible.

### 9. Authorization (permissions matrix §14)

New codes (`0046`, `P4_GOVERNANCE_PERMISSIONS`): `forum.configure` (configure), `meeting.prepare` (write), `meeting.chair` (write), `executive_decision.create` (write), `executive_decision.decide` (**business_approval**), `escalation_rule.configure` (configure). Probes S02–S04.

| Operation | Permission (role defaults) | Record-level rule |
|---|---|---|
| Read forums, participants, series, meetings, agenda, attendance, outputs, minutes, actions, blocker statuses, the T16 log, escalations, rules | `transformation.read` (every role in scope, AUD included) | scope; 404 outside it (ADR-0006) |
| Create, update, archive a forum; add or remove participants; create, update, end a series | `forum.configure` (TO; REQ-S10-005 "configure:TO") | — |
| Create or update an ad-hoc meeting; start, close (held) or cancel a meeting; create, edit, withdraw agenda items; record attendance; record outputs and blocker statuses; create and edit draft minutes; create meeting actions | `meeting.prepare` (TL, TO, SEC; REQ-S10-011 "prepare:SEC") | — |
| Publish an agenda item or the agenda; approve or publish minutes; return approved minutes to draft | `meeting.chair` (SP, TL, BO, WL, FIN, TO) | the caller is the meeting's `chair_user_id` (403 `meeting.not_chair`); none set → 422 `meeting.chair_unassigned` |
| Create or update an executive ask (T16) | `executive_decision.create` (TL, TO, SEC; REQ-PB-081/-068 "create:TL,SEC") | — |
| Record an Outcome (T16 or `recordAgendaItemOutcome` with `decided`) | `executive_decision.decide` (SP, BO, FIN; REQ-PB-081 "decide:Owner(executive)") | the caller is the decision owner or the owner's active delegate (403 `executive_decision.not_owner`) |
| Record an agenda outcome `deferred` or `noted` | `meeting.prepare` | — |
| Create or update an escalation rule | `escalation_rule.configure` (TL, TO) | — |

- **Why `executive_decision.decide` is a business approval held only by SP, BO and FIN.** Recording a T16 Outcome is an executive business decision (B0130 Owner "[Exec]"), so an ADM-only user must get 403 on it (REQ-S10-003, "all new P4 approval endpoints"). ADR-0026 §8 explains why a `business_approval` code is granted only to roles that already hold one (the creator-derived assignment and team-view rules of F-DG1-106 and ADR-0020 §3 key on it); SP, BO and FIN are those roles. A forum chair who is TL, WL or TO chairs (publishes and approves minutes) but records no Outcome.
- **REQ-PB-060 lists "configure:TO,ADM".** No technical-admin role receives `forum.configure`: technical admins hold no `transformation.read` and no business-record access (ADR-0006, REQ-S06-010), and forums are transformation records. This is a deliberate narrowing of that row's role column, recorded here for the reviewers; the acceptance text does not test it.
- **AUD** holds none of these codes: every slice D write by an AUD user is 403, and every read in its scope succeeds read-only.
- **Technical admins** hold none, and no `transformation.read`, so they get 404 on these transformation-scoped operations; the `0001` trigger refuses `executive_decision.decide` for a technical-admin role (probe S04).
- **SoD.** An Outcome is recorded by the decision's owner (or delegate), which the API checks; the creator of an ask is not barred from owning it, because REQ-S10-012 names the owner, not a separate approver, and ADR-0026's requester-cannot-approve policy applies to the P4 `approval` record, not to T16. Minutes are approved by the chair; the same person may have drafted them (no SoD is required by M0212).
- Every mutation re-checks authorization at commit time, validates, needs `If-Match` (428/409; creates are version 1), writes its audit event in the same transaction, and does no remote I/O inside it (S-4).

### 10. Lock classes, events, jobs and the `NextForumDateProvider`

| Lock class | Resource | Key | Users |
|---|---|---|---|
| 730238 `meetingSeriesGeneration` | generation and regeneration of one series | `<meetingSeriesId>` | `createMeetingSeries`, `updateMeetingSeries`, `endMeetingSeries`, `governance.meeting_series_generate` |
| 730239 `executiveAskBlocker` | the executive ask of one blocker | `<transformationId>:<blockerRecordType>:<blockerRecordId>` | `governance.blocker_escalation` (consumer and scan); `createExecutiveDecision` with a blocker link |
| 730240 `decisionEscalation` | the SLA escalation of one ask | `<decisionId>` | `governance.decision_sla_scan` |
| 730241 | reserved for this block | — | — |

Jobs (ADR-0025 §3; all `runOnce`, all schedules in the organization's timezone, default `Asia/Riyadh`): `governance.meeting_series_generate` (daily), `governance.decision_sla_scan` (daily, working days only), `governance.blocker_escalation_scan` (daily). Event: `blocker_status.recorded` (§8.3). **`NextForumDateProvider`** (ADR-0026 §5; BE-F, `governance/meetings.ts`): the `scheduled_date` of the earliest meeting of the transformation's forum with `template_key = 'executive_steerco'` whose status is `scheduled` or `agenda_published` and whose `scheduled_date` is on or after the given business date; none → Unknown (`no_steerco_scheduled`), never a guessed date.

### 11. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` (or error `message`) |
|---|---|---|
| 400 | `executive_decision.field_required` (errors at `/title`, `/whyNow`, `/options`, `/recommendation`, `/impactOfDelay`, `/ownerUserId`, `/requiredDate`) | "{Element} is required." with Element ∈ "Decision", "Why now", "Options", "Recommendation", "Impact of delay", "Decision owner", "Required date" |
| 400 | `executive_decision.options_too_few` (at `/options`) | "An executive ask states at least two options." |
| 422 | `executive_decision.owner_not_executive` (at `/ownerUserId`) | "The decision owner must be an executive who holds the decision right in this transformation." |
| 422 | `executive_decision.required_date_past` (at `/requiredDate`) | "The required date cannot be before today." |
| 422 | `executive_decision.option_unknown` (at `/chosenOptionLabel` or `/recommendation`) | "This option is not one of the decision's options." |
| 422 | `executive_decision.closed` | "This executive decision is {status} and can no longer be changed." |
| 422 | `executive_decision.defer_date_required` (at `/deferUntil`) | "A deferral needs a new date after today." |
| 403 | `executive_decision.not_owner` | "Only the decision owner, or an active delegate acting for them, can record the outcome." |
| 409 | `executive_decision.blocker_ask_open` (`urn:mth:problem:duplicate`) | "An open executive ask already exists for this blocker: {code}." |
| 422 | `agenda_item.executive_ask_incomplete` (one error per missing element, pointer to the element) | "An executive agenda item must state the decision required, why now, options, recommendation, impact of delay, decision owner and required date before it is published. Missing: {elements}." |
| 422 | `agenda_item.executive_asks_only` | "Escalate decisions, not status: this forum's agenda takes executive asks only." |
| 422 | `agenda_item.after_cutoff` | "The agenda cut-off for this meeting has passed, and this forum does not accept late items." |
| 422 | `agenda_item.max_items` | "This forum's agenda takes at most {max} items." |
| 422 | `agenda_item.not_draft` | "Only a draft agenda item can be changed." |
| 422 | `agenda_item.final` | "This agenda item is {status} and can no longer be changed." |
| 422 | `agenda_item.decision_not_linkable` (at `/decisionId`) | "Only an open executive ask of this transformation can be linked." |
| 422 | `meeting.quorum_not_met` | "This meeting has not reached its quorum: {present} of {quorum} counted present. Decisions cannot be recorded below quorum." |
| 422 | `meeting.not_in_session` | "Decisions and blocker status are recorded while the meeting is in session or held." |
| 422 | `meeting.status_transition` | "This meeting cannot move from {from} to {to}." |
| 422 | `meeting.final` | "This meeting is {status} and can no longer be changed." |
| 422 | `meeting.agenda_empty` | "The agenda has no published item." |
| 422 | `meeting.agenda_has_drafts` | "Publish or withdraw every draft agenda item before publishing the agenda." |
| 422 | `meeting.chair_unassigned` | "This meeting has no chair. Map the forum's chair role or name a chair first." |
| 403 | `meeting.not_chair` | "Only the meeting's chair can do this." |
| 422 | `meeting.frozen` | "This meeting is {status}; its records can no longer be changed." |
| 409 | `meeting_attendance.exists` (`urn:mth:problem:duplicate`) | "Attendance for this person is already recorded; update it instead." |
| 409 | `meeting_minutes.exists` (`urn:mth:problem:duplicate`) | "This meeting already has minutes; update them instead." |
| 422 | `meeting_minutes.status_transition` | "These minutes cannot move from {from} to {to}." |
| 422 | `meeting_minutes.published` | "Published minutes are immutable." |
| 422 | `meeting_minutes.approved_frozen` | "Approved minutes are edited only after they are returned to draft." |
| 422 | `meeting_minutes.meeting_not_held` | "Minutes are published after the meeting is held." |
| 422 | `meeting_minutes.required_output_missing` | "A {forum} meeting cannot be published without at least one of: {outputs}." |
| 422 | `meeting_output.kind_not_in_forum` (at `/outputKind`) | "{kind} is not an output of this forum." |
| 422 | `meeting_output.record_required` (at `/recordType`) | "This output links a record of type {recordTypes}." |
| 422 | `meeting_output.record_not_found` (at `/recordId`) | "The linked record does not exist in this transformation." |
| 422 | `forum.party_unknown` | "{party} is not a known governance role." |
| 422 | `forum.output_kind_invalid` (at `/outputKinds`) | "Outputs are chosen from: decisions, unblockers, benefit view, integrated status, decision log, milestones, actions, RAID, test, evidence, recommendation, benefit evidence, forecast, corrective action." |
| 422 | `forum.publish_output_not_listed` (at `/publishRequiresAnyOutput`) | "A required publication output must be one of this forum's outputs." |
| 422 | `forum.archived` | "This forum is archived and can no longer be changed." |
| 409 | `forum_participant.exists` (`urn:mth:problem:duplicate`) | "This person or group is already a participant of the forum." |
| 422 | `forum_participant.removed` | "This participant was removed and can no longer be changed." |
| 400 | `meeting_series.rule_invalid` (at `/weekdays` or `/monthDay`) | "A weekly series needs its weekdays, a monthly series a day of the month (1–28), and a daily series neither." |
| 409 | `meeting_series.exists` (`urn:mth:problem:duplicate`) | "This forum already has an active meeting series; change it instead." |
| 422 | `meeting_series.ended` | "This meeting series has ended and can no longer be changed." |
| 409 | `blocker_status.exists` (`urn:mth:problem:duplicate`) | "A RAG for this blocker is already recorded in this meeting." |
| 422 | `blocker_status.record_not_found` (at `/sourceRecordId`) | "The blocker does not exist in this transformation." |
| 409 | `escalation_rule.exists` (`urn:mth:problem:duplicate`) | "A rule of this kind already exists in this transformation; update it instead." |
| 422 | `escalation_rule.shape` | "A decision-SLA rule takes an escalation chain only; a blocker rule takes red cycles (2–12), a deadline in working days and an owner role." |

Generic refusals keep their platform texts: 403 `urn:mth:problem:forbidden`, 404 (outside scope), 409 `urn:mth:problem:version-conflict` with `currentVersion`, 428 (no `If-Match`). Database last-line mappings for `platform/db-errors.ts` (BE-F and BE-G add their lines): `agenda_item_quorum_met` → `meeting.quorum_not_met`; `agenda_item_meeting_not_in_session`, `blocker_status_meeting_in_session` → `meeting.not_in_session`; `agenda_item_executive_asks_only` → `agenda_item.executive_asks_only`; `agenda_item_published_ask_linked` → `agenda_item.executive_ask_incomplete`; `agenda_item_final` → `agenda_item.final`; `agenda_item_published_frozen` → `agenda_item.not_draft`; `meeting_status_transition` → `meeting.status_transition`; `meeting_final` → `meeting.final`; `*_meeting_frozen` → `meeting.frozen`; `meeting_minutes_published_immutable` → `meeting_minutes.published`; `meeting_minutes_status_transition` → `meeting_minutes.status_transition`; `meeting_minutes_approved_frozen` → `meeting_minutes.approved_frozen`; `meeting_minutes_meeting_held` → `meeting_minutes.meeting_not_held`; `meeting_minutes_required_output` → `meeting_minutes.required_output_missing`; `meeting_minutes_meeting_key` → 409 `meeting_minutes.exists`; `meeting_attendance_person_key` → 409 `meeting_attendance.exists`; `meeting_output_kind_of_forum` → `meeting_output.kind_not_in_forum`; `meeting_output_record_type` → `meeting_output.record_required`; `meeting_output_record_ref`, `blocker_status_record_ref` → the `record_not_found` codes; `forum_participant_active_user_key`, `forum_participant_active_group_key` → 409 `forum_participant.exists`; `forum_archived_final` → `forum.archived`; `forum_participant_parties_known` → `forum.party_unknown`; `forum_output_kinds_valid` → `forum.output_kind_invalid`; `forum_publish_outputs_subset` → `forum.publish_output_not_listed`; `meeting_series_one_active_key` → 409 `meeting_series.exists`; `meeting_series_ended_final` → `meeting_series.ended`; `meeting_series_rule_shape` → 400 `meeting_series.rule_invalid`; `blocker_status_once_per_cycle` → 409 `blocker_status.exists`; `decision_one_open_blocker_ask` → 409 `executive_decision.blocker_ask_open`; `decision_ask_complete` → 400 `executive_decision.field_required`; `decision_ask_options` → 400 `executive_decision.options_too_few`; `decision_ask_outcome_recorded` → 400 `executive_decision.field_required` (at `/outcomeText`); `governance_escalation_rule_kind_key` → 409 `escalation_rule.exists`; `governance_escalation_rule_shape`, `governance_escalation_rule_red_cycles_check` → `escalation_rule.shape`; `decision_code_key` → 409 version-conflict (a concurrent code allocation; retry); `*_version_step` → 409; `*_audit_required`, `*_identity_immutable`, `*_starts_*`, `forum_template_immutable`, `meeting_series_rule_version_step`, `meeting_series_author_required`, `meeting_regenerate_future_only`, `meeting_created_source`, `meeting_series_fields`, `meeting_minutes_required`, `agenda_item_ask_shape`, `decision_ask_*` (other), `decision_blocker_*`, `decision_escalation_*`, `blocker_status_cycle_of_meeting` → 500 (a programming error: the API never sends such a write).

### 12. What DG4 does not build (stated so it is not claimed)

1. **Automatic draft agenda and pack at the cut-off** (M0235): REQ-S12-015, final gate DG5 (D-089 Q8). DG4 stores and shows the cut-off date and applies the late-item rule.
2. **Stored printable packs and a presentation mode** (M0212 last sentence): DG4 serves the meeting read model they would use; no pack file is generated.
3. **Rule-builder configurability** of the two starter automations (REQ-S12-011 note; D-089 R5): DG5's REQ-S12-001/-002. DG4's rules are data rows read by code-defined handlers (§8.1).
4. **Linking an existing action to a meeting** (`linkMeetingAction`): an existing action reviewed in a meeting is an `action` output (§5.4).

### 13. REQ-S16-019: the entity group

| Entity (M0325) | Table | Primary key | Owner | Status | Built by |
|---|---|---|---|---|---|
| Forum | `forum` (+ `forum_participant`, `forum_template`) | `id` | `chair_party_code` (resolved per meeting); configured by TO | `active`, `archived` | `0044`; BE-F |
| Meeting | `meeting` (+ `meeting_series`) | `id` | `chair_user_id`, `secretary_user_id` | `scheduled`, `agenda_published`, `in_session`, `held`, `minutes_published`, `cancelled` | `0044`; BE-F |
| AgendaItem | `agenda_item` | `id` | `presenter_user_id`; an ask's owner on its decision | `draft`, `published`, `closed`, `withdrawn` | `0044`; BE-F2 |
| Attendance | `meeting_attendance` | `id` | `user_id` | `present`, `absent`, `apologies` | `0044`; BE-F2 |
| Minutes | `meeting_minutes` | `id` | the meeting's chair (approves) | `draft`, `approved`, `published` | `0044`; BE-F2 |
| MeetingActionLink | `meeting_action_link` | `id` | the action's `owner_user_id` | the action's status (`open`, `in_progress`, `done`, `cancelled`) | `0044`; BE-F2 |

The A09 clause "an integration test creates and reads each one through the API with authorization enforced" is `apps/api/test/integration/governance/entity-group.test.ts` (BE-F2, after BE-F): it creates and reads a Forum, a Meeting, an AgendaItem, an Attendance row, Minutes and a MeetingActionLink through the API, each with a 403 for an AUD user on the write and a 404 outside scope. The ERD lists the group in §1h (`docs/architecture/erd.md`).

### 14. Decimal and Unknown

- Slice D stores **no money, rate, FTE or KPI value**; quorum counts and durations are integers. No decimal arithmetic is introduced.
- Unknown is explicit and never shown as a date, as "on time" or as complete: a cut-off date without a calendar (`cutoff_unknown_reason`), an SLA due date that cannot be computed (`sla_unknown_reason`; never escalated), a "next SteerCo" without a scheduled SteerCo (`no_steerco_scheduled`), an unresolved chair or blocker-ask owner (`ownerStatus: "unassigned"`, a visible routing error), an escalation routing error, a blocker cycle without an observation or with `unknown` (never counted as red), a T16 column a DG3 funding decision does not have (Unknown), an escalated ask without a stated impact ("Impact of delay not stated"). "Quorum not configured" is shown as such, never as "quorum met".

## Alternatives considered

1. **A separate `executive_decision` table for T16.** Rejected: ADR-0015 and M0150 require one decision model with views; the `0017` comment reserves kind `executive` for T16; a second table would drift from the decision links (`initiative_decision_link`, T08 `decision` dependencies, RAID + decision log).
2. **T16 asks created in a `draft` status with optional fields.** Rejected: REQ-S10-012's acceptance "an ask without 'why now' is rejected by the API" is tested on the create call. Drafting happens on the agenda item's brief instead (§3.2), and only a blocker escalation (created by the worker, M0233 "require") may lack the narrative fields.
3. **Copying the five elements onto the agenda item permanently.** Rejected: the published agenda and T16 would hold two copies of one ask; publication moves the brief into the T16 row and clears it (§3.2).
4. **Deleting future meetings on a recurrence change.** Rejected: cancellation with a reason keeps the history explainable (audit) and lets the regeneration rule be a database invariant (§2).
5. **Escalating by reassigning the decision owner.** Rejected (the ADR-0026 §6 reasoning): the owner keeps the decision; the escalation target is added and notified, and nothing about the outcome changes.
6. **A worker-authored decision with `created_by` NULL.** Rejected: the DG2 `Decision` schema (served by `listDecisions?kind=executive`) requires `createdBy`; changing it would be a DG2 contract reopen. The ask names the person whose red observation triggered it, with a `system` audit actor on their behalf (§8.3).
7. **Counting a cycle without an observation as "still red".** Rejected: "red for multiple cycles" must be observed red in each cycle; a gap cannot be claimed as persistence (the ADR-0031 §5.4 rule for Unknown periods).

## Consequences

- One decision model serves T04, gate, funding and T16 records; the DG2 decision operations and schema are unchanged.
- Slice D adds 13 tables (`forum_template`, `forum`, `forum_participant`, `meeting_series`, `meeting`, `agenda_item`, `meeting_attendance`, `meeting_output`, `meeting_action_link`, `meeting_minutes`, `governance_escalation_rule`, `decision_escalation`, `blocker_status`), one view (`executive_decision_log`), 11 `decision` columns, six permission codes, four work-item kinds, three lock classes (730238–730240; 730241 reserved).
- ADR-0026 §5's `next_steerco_or_urgent` SLA becomes computable once BE-F implements `NextForumDateProvider`.
- The implementer split adds one task, BE-F2 (agenda, attendance, minutes, outputs, actions), because the slice has 49 operations (p4-work-split §D).

## Verification

- Probe (`probe.ts`, `probe-output.txt`; 101 PASS, 0 FAIL): migrations on a fresh database and over a P3-populated one (G00–G07); seeds and grants (S01–S05); forums and participants (F01–F08, FP01–FP02); series (MS01–MS07); meetings (M01–M10); agenda, executive asks and quorum (A01–A10, AT01–AT02); outputs and minutes (O01–O06, MN01–MN07); action links (L01–L02); T16 asks (D01–D11); escalations (E01–E10); blocker statuses (B01–B05); rules (R01–R04); the T16 view (V01); privileges (P01–P03).
- `catalogue.test.ts` pins the slice D triggers, the versioned tables and the grants; `seed.test.ts` pins `0046` against `P4_GOVERNANCE_PERMISSIONS`/`P4_GOVERNANCE_ROLE_PERMISSIONS`; `advisory-locks.test.ts` pins 730238–730240.
- Not verified by this task (assigned in p4-work-split §D): every API refusal and its English text, the generation and regeneration service, the quorum and publication API checks, the two escalation jobs end to end, the `NextForumDateProvider`, the REQ-S16-019 entity-group API test, and the screens (FE-D).

## Amendment (2026-10-09, T-DG4-ARCH-R1): the job schedules in `0060`, and the codes added outside §11

### A1. Job schedules (D-102, D-105)

`0060` inserts the three `job_schedule` rows §10 names, each audited (`job_schedule.create`, actor system, source migration), enabled, timezone `Asia/Riyadh`, owner module `governance`, `queue_name` = `code` (the queue names of `apps/worker/src/queues/meetings.ts` and `escalations.ts`):

| Code | Cron (minute hour …) | Cadence (§10) |
|---|---|---|
| `governance.meeting_series_generate` | `35 0 * * *` | daily |
| `governance.decision_sla_scan` | `40 0 * * *` | daily; the handler acts on working days only (§7) |
| `governance.blocker_escalation_scan` | `45 0 * * *` | daily |

The minutes follow the existing rows (00:05, 00:20, 00:25, 00:30). `job.configure` (ADM_TECH) can change the cron, timezone or enabled flag as for every row (ADR-0025 §3). The worker registers a row only when its handler exists; BE-F and BE-G registered these handlers.

### A2. Codes and keys added outside §11 (accepted, with their exact English texts)

`validation.user_unknown` and `validation.group_unknown` are built in `governance/forums.ts` as `validation.${what}_unknown`.

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `meeting.quorum_locked` | 422 | accepted | The quorum is set before the session starts; this meeting is {status}. |
| `validation.user_unknown` | 400 field | accepted | Choose an active user of this transformation's organization. |
| `validation.group_unknown` | 400 field | accepted | Choose an active group of this transformation's organization. |
| `validation.forum_unknown` | 400 field | accepted | Choose a forum of this transformation. |
| `validation.end_before_start` | 400 field | accepted | The end date cannot be before the start date. |
| `validation.decision_right_unknown` | 400 field | accepted | Choose an active decision-rights row of this transformation. |
| `validation.blocker_pair` | 400 field | accepted | A blocker link names both its record type and its record. |
| `validation.empty_patch` | 400 field | accepted | Change at least one field. |
| `validation.local_time` | 400 field | accepted | Enter a time as HH:MM (24-hour clock). |
| `validation.option_label` | 400 field | accepted | An option label is one capital letter, A to Z. |
| `governance.task.executive_decision_due` | message key | accepted | Decide the executive ask {code}: {title}. |
| `governance.task.executive_decision_escalated` | message key | accepted | Escalated to you: executive ask {code} ({title}) passed its SLA date {slaDueDate} (level {level}). |
| `governance.notice.executive_decision_escalated` | notice key | accepted | The executive ask {code} ({title}) passed its SLA date {slaDueDate} and was escalated (level {level}). |
| `governance.notice.blocker_ask_calendar_not_configured` | notice key | accepted | A blocker has been red for {redCycles} cycles, but no executive ask was raised: the organization has no business calendar to set its SLA date. |
| `governance.notice.blocker_ask_owner_unassigned` | notice key | accepted | The executive ask {code} ({title}) has no owner: {partyCode} has no mapped person ({routingError}). |
| `governance.notice.series_calendar_not_configured` | notice key | accepted | No meetings were generated for this series: the organization has no business calendar for working days. |
