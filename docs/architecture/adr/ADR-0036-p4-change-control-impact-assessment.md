# ADR-0036: Change control: change requests to approved records, impact assessment and preview, KPI and rebaseline change requests, T11 routing, and preserved original approvals and snapshots

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-07), 2026-10-09.
- **Requirements (slice H of `docs/architecture/p4-plan.md`, this ADR's part):** REQ-S04-014, REQ-S07-015, REQ-S09-010; the ChangeRequest entity of REQ-S16-018 (ADR-0031 §12, D-093 (6)); the change-request half of REQ-PB-065's literal acceptance (ADR-0026 §5, D-090).
- **Sources (quoted where a design point has one):**
  - Master prompt M0125 ("Material changes to approved scope, baseline, target, TOM, cost or benefit logic trigger an impact assessment and the appropriate reapproval. Preserve the original approval and evidence snapshot."); M0163 ("Changing a KPI definition, baseline or target creates a versioned change request with reason and impact preview. Show affected outcomes, benefits, gates, reports and formulas. Approved changes take effect prospectively by default. A retrospective restatement requires explicit period selection, authority and a retained reconciliation. Previously issued reports remain unchanged and can be reissued as a new version."); M0184 ("Track approved vs forecast milestone dates … Record material rebaselines through change control.").
  - Playbook B0099 (T11: "Business scope change | … | Sponsor"; "Funding reallocation"; "Target-state design"; "Go-live / scale"), B0095 (T10 areas: Outcomes, Value, Portfolio, Dependencies, Decisions, People & adoption).
- **Decisions applied:** D-088 §2 (claims enumerated and exactly true); D-089 Q10 (the canonical `approval` serves new P4 approval types; existing approval tables are not migrated), R4 (rows citing A07 are judged on their own acceptance text); D-090 (REQ-PB-065 completes with BE-L); D-091 (KPI versions; an additive 422 on a P4 operation that already declares 422 is not a reopen).
- **Builds on:** ADR-0003, ADR-0004, ADR-0006, ADR-0007, ADR-0015 (gate submissions and decisions are append-only/frozen), ADR-0016 (lock registry), ADR-0023 (milestones: approved vs forecast dates), ADR-0024 (benefit formulas and versions), ADR-0025 (working-day calendar), ADR-0026 (§4 approval engine and subject providers, §5 T11 routing), ADR-0027 (KPI versions; "A new version is how a KPI definition, baseline or target changes … slice H's"), ADR-0031 §7 (budget lines), ADR-0035 (gates, phases).
- **Physical model:** `0052_p4_change_control.sql`, `0053_p4_gates_change_permissions.sql` (approval type `change_request`, permissions). Probe ids refer to `docs/delivery/handbacks/DG4/T-DG4-ARCH-07-evidence/probe-output.txt`.
- **Two gate systems.** A change request's approval is a business approval inside the product, decided by a person through the canonical approval. Nothing here reads or writes DG0–DG7. A product gate stays `approved` when a change to its evidence is approved; its submission, snapshot and decision rows are never edited (they are frozen/append-only since `0017`).

## Context

As built (checked on `HEAD` `76e128e`):

1. `milestone.approved_date` is written only by `POST /milestones/{id}/approve-date` (`roadmap.approve`, DG3); a re-approval overwrites it with its own reason and audit event. `forecast_date` is a separate column edited by `PATCH /milestones/{id}`. The DG3 code comment says "formal rebaseline through change control is P4".
2. A KPI definition, baseline or target changes through a new `kpi_version` that is activated by `POST …/kpi-versions/{id}/activate` (ADR-0027 §2); activation supersedes the previous active version, which stays readable.
3. A benefit formula changes through `POST /benefit-formulas/{id}/versions` (DG3, ADR-0024); earlier versions stay readable; an approved G4 submission snapshot pins the formula versions it used (`buildG4Snapshot`, ADR-0021 §7).
4. `budget_line.budget_amount` (`0042`, numeric(20,4)) is edited by BE-E's P4 budget routes (ADR-0031 §7).
5. The T11 rows `business_scope_change` (Approve: SP), `funding_reallocation`, `target_state_design` and `go_live_scale` exist per transformation (`0030`); `routeByDecisionRight` resolves their Approve party (ADR-0026 §5).
6. No table records a change request or an impact assessment. ADR-0031 §12 lists ChangeRequest as "not yet built: slice H".

## Decision

### 1. The change request (REQ-S04-014, REQ-S07-015, REQ-S09-010, REQ-S16-018)

**Entity `change_request`** (`0052`; probes CR01–CR17): `code` (`CR-nn`, `record_code_counter` prefix `CR`), `change_kind`, `subject_type`, `subject_id`, `subject_version` (the subject's version the request is against), `proposed_record_type`/`proposed_record_id` (a draft `kpi_version` or a new `benefit_formula_version`), `proposed_change` (JSON object validated per kind, §2), `reason` (3–4000), `origin` (`manual` | `automatic`), `materiality` (`material` | `not_material`) and `materiality_basis`, `route_party_code`, `decision_right_id`, `status`, `raised_by`, `submitted_by/at`, `current_impact_assessment_id`, `decided_at`, `applied_at`, `applied_record_type/id`, `applied_version`, `withdrawn_at`, P2 stamps, `version`. Owner: `raised_by`. CHECK `change_request_kind_subject` fixes which subject each kind names (CR02).

**State machine** (trigger `change_request_guard`; CR01, CR06–CR09, CR13, CR15–CR16):

```text
draft -> submitted | withdrawn
submitted -> approved | rejected | changes_requested | withdrawn
changes_requested -> submitted | withdrawn
approved, rejected, withdrawn: final
```

Database invariants: a new row is `draft`; code, origin, requester, kind and subject never change; content changes only in `draft`/`changes_requested` (`change_request_content_frozen`); `submitted` and later need submitter, materiality, route and an impact assessment frozen for **exactly** the current version (`change_request_assessment_current`; CR07); `approved`, `rejected` and `changes_requested` each need a person's matching `approval_decision` on the request's `change_request` approval (`change_request_outcome_needs_decision`; CR13 — no job or trigger can approve); `approved` records the application (`applied_*`, CR15); one open request (`draft`, `submitted`, `changes_requested`) per subject (`change_request_one_open_per_subject`; CR05).

### 2. Kinds, subjects and what "apply" does

| `change_kind` | Subject | `proposed_change` (validated by Zod) | Applied on approval (same transaction as the approval decision) |
|---|---|---|---|
| `business_scope` | `charter`, `initiative` | `{ scopeIn?, scopeOut?, name?, objective? }` each `{from, to}` | a new charter version (DG2 charter versioning) or the initiative fields, version + 1; audit `…change_request_applied` |
| `baseline`, `target`, `kpi_definition` | `kpi_definition` with `proposed_record_type = 'kpi_version'` | `{ field: {from, to} }` for the changed version fields | the draft KPI version is activated through the kpi module's activation service (ADR-0027 §2); the previous version becomes `superseded` and stays readable; prospective by default (M0163) |
| `baseline`, `target` | `outcome_kpi` | `{ baselineValue?, targetValue?, targetDate? }` each `{from, to}` (decimal strings) | the DG2 `outcome_kpi` fields, version + 1 (the earlier values stay in the CR and the audit log) |
| `tom` | `tom_canvas_cell` | `{ targetDesign: {from, to} }` | the DG2 canvas cell, version + 1 |
| `cost` | `initiative`, `budget_line` | `{ budgetAmount: {from, to}, currency }` | the budget line amount, version + 1 |
| `budget_rebaseline` | `budget_line` | as `cost` | as `cost` |
| `benefit_logic` | `benefit_formula` with `proposed_record_type = 'benefit_formula_version'` | `{ fromVersionNo, toVersionNo }` | records the approved basis (`applied_record` = the new formula version); no DG3 row changes |
| `schedule_rebaseline` | `milestone` | `{ approvedDate: {from, to} }` | `milestone.approved_date`, `approved_by` = the approver, `approval_reason` = "Change request {code}: {reason}" (truncated to 1000), version + 1 |

**Preserved originals** (REQ-S04-014 "the original approval and snapshot remain unchanged and viewable"): applying never updates `gate_submission`, `gate_submission_criterion` or `gate_decision` (frozen/append-only since `0017`; probe CR20 reads the approved G5 decision and its snapshot hash unchanged after a change is approved), never deletes a superseded KPI version or formula version, and records the replaced values in `proposed_change.from` and the audit event. The affected gate stays `approved`; the change request's own approval is the reapproval (§4). **Stale subject:** if the subject's version moved after the request was submitted, the approval decision is refused 409 `change_request.subject_moved` and nothing is applied; the requester withdraws and raises a new request.

**Retrospective restatement** (M0163) is not built in DG4: every applied change is prospective; a request whose `proposed_change` names a past effective period is refused 422 `change_request.retrospective_not_supported`.

### 3. Materiality (REQ-S09-010)

`change_control_policy` (`0052`; one optional row per transformation; probes CR18, CR19): `material_date_shift_working_days` (0–250) and `material_budget_change_ratio` (numeric(9,6), a fraction, 0–10). **No row, or a NULL threshold, means every change of that kind is material** — the sources give no threshold, so none is seeded. At submit, the service computes and stores `materiality` and `materiality_basis`:

- `schedule_rebaseline`: shift = working days between the approved and the proposed date (ADR-0025 `addWorkingDays` calendar of the organization); material when shift > threshold; with no active calendar the basis records `calendar_not_configured` and the change is material (never silently non-material).
- `cost`, `budget_rebaseline`: ratio = |to − from| / |from| in decimal.js; material when ratio > threshold; `from` = 0 or NULL (Unknown) → material.
- every other kind: material (M0125 names those changes as material).

**Direct edits beyond the threshold** (the two hook lines BE-L owns, §6):

- `POST /milestones/{id}/approve-date` (DG3): a re-approval (an approved date already exists) whose shift is greater than a **configured** `material_date_shift_working_days` is refused 422 `milestone.rebaseline_requires_change_request`. With no policy row the DG3 behaviour is unchanged, and no existing transformation has a policy row, so DG3 behaviour on existing data is unchanged (the D-091 (2) pattern). REQ-S09-010's acceptance "a material date change without approval leaves the approved date unchanged and shows the forecast separately" is the change-request path: until the request is approved, `approved_date` keeps its value and `forecast_date` (DG3) is shown beside it.
- BE-E's budget-line update: a change of `budget_amount` beyond a configured `material_budget_change_ratio` is refused 422 `budget_line.rebaseline_requires_change_request`.

### 4. Routing and the reapproval (REQ-PB-065, REQ-S04-014 "routed to the appropriate approver")

At submit the service requests one canonical approval of type `change_request` (`0053`; subject = the request, `subject_version` = its version; SoD `requester_excluded`) through `requestApprovalInTx` (ADR-0026 §4):

| Kind | T11 row (`routeByDecisionRight`) | Party when no T11 row applies |
|---|---|---|
| `business_scope` | `business_scope_change` (Approve: SP) | — |
| `cost`, `budget_rebaseline` | `funding_reallocation` | — |
| `tom` | `target_state_design` | — |
| `baseline`, `target`, `kpi_definition` | — | `BO` (the ADR-0027 KPI-version approver default) |
| `benefit_logic` | — | `FIN` (Finance validates benefit logic, B0084/B0139) |
| `schedule_rebaseline` | — | `SP` |

A T11 row that is missing in the transformation's copy falls back to the party column above (`SP` for the T11 kinds) and records `decision_right_id = NULL`. An unmapped party is the ADR-0026 422 `routing.role_unmapped` (visible). Deciding uses the existing `POST /approvals/{approvalId}/decision` (`approval.decide`; SP, BO, FIN; delegation per ADR-0026); BE-L registers the `change_request` approval subject provider (`registerApprovalSubject`), whose `onOutcome` sets the request's status in the same transaction (`approved` → apply §2; `rejected`; `changes_requested`; `withdrawn`). A resubmission after changes requested is the approval engine's resubmission on the new request version with a new impact assessment. REQ-PB-065's literal acceptance: a request of kind `business_scope` routes to the person or group mapped to SP.

### 5. Impact assessment and preview (REQ-S04-014, REQ-S07-015)

`POST …/change-requests/impact-preview` (body = a change-request draft; no write) and `GET …/change-requests/{id}/impact-preview` compute the items; **submit** freezes them as `impact_assessment` + `impact_assessment_item` rows (`0052`, append-only; CR10–CR12) with `content_sha256` over the canonical JSON of the items. Item derivation (each a typed row with `item_type`, `record_type`/`record_id`/`record_code`, `label`, `effect`):

| Changed subject | Items |
|---|---|
| KPI (`kpi_definition`, `outcome_kpi`) | **outcomes**: each `outcome` linked through `outcome_kpi`; **KPIs**: KPIs whose formula has this KPI as input (ADR-0027 §4) (`recalculation`); **benefits**: benefits with `measurement_kpi_definition_id` = the KPI, or a valuation method on it (`value_changes`); **formulas**: those KPI formulas and the benefit formula versions bound to those benefits; **gates**: G1 (baseline changes), G2 (every KPI change) and G5 (when approved) — each gate that has an approved decision or a pending submission, as a `gate` item naming that submission and, when approved, the decision (`reapproval_required`); **reports**: the T10 Outcomes area (`T10.outcomes`, `informational`) |
| `tom_canvas_cell` | gaps of that dimension, decisions linked to it, G3 (`reapproval_required` when approved), `T10.portfolio` |
| `charter`, `initiative` (scope) | outcomes and initiatives in scope, G1 and G4 when approved, `T10.portfolio` |
| `budget_line`, `initiative` (cost) | the initiative, its business case lines, G4 when approved, `T10.value` |
| `benefit_formula` | business case lines and benefits using the formula, G4 when approved (`reapproval_required`; the snapshot's pinned version is named in `detail`), `T10.value` |
| `milestone` | the initiative, dependent initiatives (T08), G4 when approved, `T10.portfolio`, `T10.dependencies` |

"Reports" in DG4 are the fixed T10 read-model areas (B0095); no report entity exists before DG5/DG6, so no issued report is changed (M0163 "Previously issued reports remain unchanged"). REQ-S07-015's acceptance "changing a target shows the affected benefit and G2 approval in the preview": a target change on a KPI bound to a benefit lists that benefit (`value_changes`) and the G2 `gate` item naming the approved G2 decision; "the old version remains retrievable": the superseded KPI version is readable through ADR-0027's version routes.

### 6. Automatic change requests (REQ-S04-014 automation "Material change → create change request and route")

A port `MaterialChangePort` (defined in `workflows/change-requests.ts`, wired in `server.ts`, the `GateFactsProvider` pattern; the kpi and portfolio modules import only the interface type from `platform`, never `workflows`) is called in the editing transaction by these hook lines:

1. **`kpi/benefit-formulas.ts`, new formula version** (DG3 `POST /benefit-formulas/{id}/versions`): when any version of the formula is pinned by an **approved** G4 submission snapshot, the port raises and submits one `benefit_logic` request (`origin = 'automatic'`, `raised_by` = the editor, `proposed_record` = the new version) under lock 730246. The DG3 response body is unchanged. REQ-S04-014's acceptance: "changing an approved G4 benefit formula creates a change request; the prior G4 approval and snapshot are still retrievable unchanged".
2. **`kpi/kpi-versions.ts`, activation** (ADR-0027 §2): activating a version of a KPI that already has an `active` version, other than through an approved change request, is refused 422 `kpi_version.change_request_required` (§10); the first activation is unchanged.
3. **`portfolio/milestones.ts` approve-date** and **`portfolio/budget.ts` update**: the threshold refusals of §3.

Items 2 and 3 are refusals, not silent conversions: the caller raises the request explicitly (`POST …/change-requests`), which keeps the reason and impact preview a person's input (M0163 "with reason and impact preview").

### 7. Authorization (permissions matrix §16)

| Action | Permission (category) | Default roles | Record-level rule |
|---|---|---|---|
| Read requests, assessments, previews, policy | `transformation.read` | every business role, AUD | 404 outside scope |
| Raise, edit, submit, withdraw | `change_request.raise` (write) | TL, BO, WL, FIN, TO, KDS | edit/submit/withdraw: the requester (`raised_by`), or TL/TO of the transformation |
| Decide (approve, reject, request changes, defer) | `approval.decide` (business approval, ADR-0026) | SP, BO, FIN | the routed assignee (person, group member or delegate); ≠ requester |
| Configure materiality thresholds | `change_control.configure` (configure) | TL, TO | — |

AUD holds `transformation.read` only (403 on every write). No technical-admin role holds `change_request.raise`, `change_control.configure` or `approval.decide`; an ADM-only caller gets 403 on the approval decision (D-094 rule). Every mutation re-authorises at commit, requires `If-Match` (428/409), writes one audit event, and follows the p4-work-split §1 free-text and UTF-8 rules.

### 8. Lock class and events

- **730246 `changeRequestSubject`** (`<subjectType>:<subjectId>`): raise (manual and automatic), submit and apply. 730248 reserved (ADR-0035 §9).
- No new outbox event: the approval engine's own work items and reminders (ADR-0026 §4) notify the assignee; the requester's `approval_changes_requested` item exists since `0028`.

### 9. Decimal and Unknown

Money (`budgetAmount`) and ratios are decimal strings, computed with decimal.js and stored as `numeric`; never floats. An Unknown `from` value (NULL budget, NULL baseline) is shown "Unknown" in the preview and makes a cost change material (§3), never a ratio of 0. A preview item whose record cannot be read in the caller's scope is omitted from the response and counted in `hiddenItemCount` (never shown as "no impact").

### 10. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` (or error `message`) |
|---|---|---|
| 422 | `change_request.kind_subject_mismatch` (at `/subjectType`) | "This kind of change does not apply to that record." |
| 422 | `change_request.subject_not_approved` | "Only an approved record goes through change control; edit the draft directly." |
| 409 | `change_request.already_open` (duplicate) | "This record already has an open change request ({code})." |
| 400 | `change_request.reason_required` (at `/reason`) | "A reason is required for a change request." |
| 422 | `change_request.proposed_change_invalid` (at `/proposedChange`) | "The proposed change does not match the fields of this kind of change." |
| 422 | `change_request.not_editable` (invalid-transition) | "Only a draft change request, or one returned for changes, can be edited." |
| 422 | `change_request.not_submittable` (invalid-transition) | "Only a draft change request, or one returned for changes, can be submitted." |
| 422 | `change_request.not_withdrawable` (invalid-transition) | "A decided change request cannot be withdrawn." |
| 409 | `change_request.subject_moved` (version-conflict) | "The record changed after this request was submitted; withdraw it and raise a new one." |
| 422 | `change_request.retrospective_not_supported` | "A retrospective restatement is not supported; changes take effect from now on." |
| 403 | `change_request.not_requester` | "Only the requester or the transformation lead can change this request." |
| 422 | `kpi_version.change_request_required` | "This KPI already has an active version; changing its definition, baseline or target needs an approved change request." |
| 422 | `milestone.rebaseline_requires_change_request` | "This date change exceeds the material threshold; raise a change request to rebaseline it." |
| 422 | `budget_line.rebaseline_requires_change_request` | "This budget change exceeds the material threshold; raise a change request to rebaseline it." |
| 422 | `change_control.threshold_invalid` (at the field) | "Thresholds are a number of working days from 0 to 250 and a ratio from 0 to 10." |

### 11. REQ-S16-018: ChangeRequest

ChangeRequest = `change_request` (PK `id`, code `CR-nn`, owner `raised_by`, status per §1). BE-L adds the ChangeRequest case to `apps/api/test/integration/raid/entity-group.test.ts` (create, read, AUD 403 on write, 404 outside scope; ADR-0031 §12), which completes the entity group.

## Alternatives considered

1. **Edit approved records in place and keep the old values in audit only.** Rejected: M0125 requires an impact assessment and reapproval before the change takes effect, and audit rows are not a reviewable proposal.
2. **Convert every direct edit into an automatic change request silently.** Rejected for KPI versions, milestones and budget lines: a request needs a person's reason (M0163); a refusal with a code points the caller to the request. Kept for benefit formula versions, because the DG3 version route already carries a change note and the REQ-S04-014 acceptance names that automation.
3. **A separate approval table for change requests.** Rejected by D-089 Q10.
4. **Seed a default materiality threshold (e.g. 10 working days, 5 %).** Rejected: no source gives one; "every change is material" is the safe default and a configured value is a team decision.
5. **Re-open the approved gate (status back to `submitted`).** Rejected: it would edit a DG2 terminal state and lose the "approved" record; the request's approval is the reapproval and the gate item in the assessment names the preserved decision.

## Consequences

- REQ-S16-018 completes when BE-L's entity-group case merges.
- Three hook lines in files owned by other slices (kpi versions, benefit formulas, milestones/budget) are assigned to BE-L by name (p4-work-split §H); the KPI-version refusal adds a 422 to a P4 operation that already declares 422 (D-091 (2) pattern; for the orchestrator to confirm).
- The DG3 `approve-date` behaviour is unchanged unless a transformation configures a date threshold (§3).

## Verification

- **Database (probe, real output):** CR01–CR20 (`probe-output.txt`).
- **API (BE-L tests, p4-work-split §H):** changing an approved G4 benefit formula creates a change request and the G4 decision and snapshot read back byte-identical; a KPI target change preview lists the bound benefit and the G2 approval, and after approval the old KPI version is still readable; a material date change via a request leaves `approved_date` unchanged until approved and shows `forecastDate` separately; a re-approval beyond a configured threshold → 422; a `business_scope` request is routed to the SP-mapped person; the requester cannot decide (403/SoD); AUD 403 on every write; `If-Match` 428/409; one audit event per mutation; the ChangeRequest entity-group case.

## Amendment (2026-10-09, T-DG4-ARCH-R1): the version-0 policy, withdrawal of a request in approval, and the codes added outside §10

### A1. The change-control policy before it is configured

**The defaulted-record ETag rule (applies to three records only).** A record that exists by default before anyone writes it (one phase step per transformation and step key, ADR-0035 §1; one change-control policy per transformation, ADR-0036; one dashboard RAG policy per organization, ADR-0037 §3) is read with `version: 0` and `ETag: "0"` while no row exists, and the body shows the defaults (Unknown/null where the ADR says so). The first write sends `If-Match: "0"` and inserts the row at version 1; `If-Match: "0"` once a row exists is 409 `urn:mth:problem:version-conflict` with `currentVersion`; `If-Match: "<n ≥ 1>"` while no row exists is 409 without `currentVersion` (its schema starts at 1, and the BE-L behaviour is kept); a missing `If-Match` is 428. The contract declares this with two components used **only** by these six operations: the response header `ETagOrZero` (pattern `^"(0|[1-9][0-9]{0,9})"$`) on `getPhaseStep`, `getChangeControlPolicy` and `getDashboardRagPolicy`, and the parameter `IfMatchOrZero` (same pattern) on `updatePhaseStep`, `putChangeControlPolicy` and `putDashboardRagPolicy`. Every other operation keeps `ETag`/`IfMatch` starting at 1, and "creates are version 1" still holds for every row that is inserted. A 404 was rejected for these reads because the defaults are real, displayable values and the screen needs the ETag to make the first write. The three `contract: false` skips added for this (`workflows/phases.test.ts`, `workflows/change-requests.test.ts`, `reporting/rag-policy.test.ts`, one GET each) are removed by ARCH-R1, so these reads are contract-checked.

### A2. Resubmission and withdrawal of a request in approval

ADR-0026 amendment A4 gives the corrected flows: `submitChangeRequest` resubmits through `resubmitApprovalInTx` in its own transaction, and `withdrawChangeRequest` on a request in approval withdraws its approval through `withdrawApprovalInTx` and then the request, in one transaction. `change_request` sets `resubmitThroughSubject`. Until BE-R2 lands, the as-built 422 `change_request.withdraw_via_approval` is accepted with the text below; after BE-R2 it is no longer produced (the code is retired, not reused).

### A3. Codes added outside §10

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `change_request.withdraw_via_approval` | 422 | accepted until BE-R2, then retired (replaced by the in-transaction withdraw) | This change request is in approval; withdraw its approval instead. |
| `validation.proposed_change` | 400 field | accepted | This proposed change does not fit the kind of change requested. |
| `validation.proposed_change_size` | 400 field | accepted | A change request proposes between 1 and 20 changes. |
