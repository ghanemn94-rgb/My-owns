# T-DG4-ARCH-R2: extended code table (copy of handback §4)


"server" texts are what the API already sends, or will send once BE-R3 implements them; placeholders are named. "authored" texts are written here, because the server sends only the key or stores only the code. Arabic is for FE to write, marked provisional until it is linguistically reviewed.

| # | Code or key | Kind | Owning ADR | Decision | English text | Text origin | Where (as built, or to build) |
|---|---|---|---|---|---|---|---|
| 164 | `dispensation.waiver_requires_end_to_end` (at `/kind`) | 422 | ADR-0021 W5 | recorded (DG3 code; unchanged; now only for Modular waivers that are not Modular-links waivers) | A waiver applies to the End-to-End launch sequencing; a Modular transformation is not held to it. | server | api portfolio/dispensations.ts |
| 165 | `gate.modular_links_missing` | 422 | ADR-0038 §12, B4 | accepted (decided D-106 (e)) | Modular entry: supply the missing baseline and outcome links, or record an authorized waiver, before submitting this gate. | server | shared schemas/missing-links.ts; api workflows/gates.ts |
| 166 | `baseline_missing` (an `errors[]` item of 165, at `/baseline`) | 422 error item | ADR-0038 B4 | accepted (BE-M2) | No active baseline with a value is recorded. | server | shared schemas/missing-links.ts |
| 167 | `outcome_link_missing` (an `errors[]` item of 165, at `/outcomes`) | 422 error item | ADR-0038 B4 | accepted (BE-M2) | No active outcome has an active KPI. | server | shared schemas/missing-links.ts |
| 168 | `inherited_record.record_not_found` (at `/evidenceId` or `/baselineId`) | 422 | ADR-0038 B4 | accepted (BE-M2) | The evidence item or baseline does not exist in this transformation or is archived. | server | api reporting/modular.ts |
| 169 | `gate.modular_waiver_revoked` | 422 | ADR-0038 B1, B4 | **new** (BE-R3) | The waiver of the missing baseline and outcome links was revoked on {date}; supply them or record a new waiver, then resubmit G3. | server (to build) | api workflows/gates.ts (decideGate, approve) |
| 170 | `gate.modular_waiver_expired` | 422 | ADR-0038 B1, B4 | **new** (BE-R3) | The waiver of the missing baseline and outcome links expired on {date}; supply them or record a new waiver, then resubmit G3. | server (to build) | api workflows/gates.ts (decideGate, approve) |
| 171 | `kpi.recalculate_failed` | stored `calculation_run.error_code` | ADR-0027 C3 | accepted (KBE-R1) | The calculation failed after its last retry; the last calculated status is still shown. | authored | worker handlers/kpi.ts |
| 172 | `work_item.system_managed` | 422 | ADR-0025 D3 | **text changed** (BE-R3 API, FE keys) | This task closes automatically when the record it belongs to is decided or closed. | server (to change) | api tasks/routes.ts |
| 173 | `work_item.reschedule` | audit action | ADR-0025 D2, D4 | accepted (BE-R1) | Task due date changed | authored (audit-trail label) | api tasks/service.ts; worker kit.ts |
| 174 | `agenda_item.not_published` | 422 | ADR-0032 G2 | accepted (BE-F2) | Only a published agenda item can take an outcome. | server | api governance/agenda.ts |
| 175 | `agenda_item.outcome_not_ask` | 422 | ADR-0032 G2 | accepted (BE-F2) | Only an executive ask records a decision; record this item as noted or deferred. | server | api governance/agenda.ts |
| 176 | `agenda_item.ordinal_taken` | 409 (`urn:mth:problem:duplicate`) | ADR-0032 G2 | accepted (BE-F2) | Another agenda item of this meeting has this position. | server | api governance/agenda.ts; platform/db-errors.ts |
| 177 | `validation.agenda_ask_shape` (at `/decisionId` or `/brief`) | 400 field | ADR-0032 G2 | accepted (BE-F2) | Only an executive ask links a decision or carries a brief, and never both. | server | api governance/agenda.ts |
| 178 | `validation.evidence_unknown` (at `/materialsEvidenceIds`) | 400 field | ADR-0032 G2 | accepted (BE-F2) | Choose evidence of this transformation. | server | api governance/agenda.ts |
| 179 | `validation.attendance_proxy` (at `/onBehalfOfUserId`) | 400 field | ADR-0032 G2 | accepted (BE-F2) | A representative is recorded only for a present person, and never for themselves. | server | api governance/attendance.ts; platform/db-errors.ts |
| 180 | `validation.record_pair` (at `/recordType` or `/recordId`) | 400 field | ADR-0032 G2 | accepted (BE-F2) | A linked record names both its record type and its record. | server | api governance/meeting-outputs.ts; platform/db-errors.ts |
| 181 | `validation.agenda_item_unknown` (at `/agendaItemId`) | 400 field | ADR-0032 G2 | accepted (BE-F2) | Choose an agenda item of this meeting. | server | api governance/meeting-outputs.ts |
| 182 | `governance.task.meeting_action_due` (params `title`, `meetingDate`) | work-item message key | ADR-0032 G2 | accepted (BE-F2 proposal) | Meeting action assigned to you: {title} (meeting of {meetingDate}). | authored | api governance/meeting-actions.ts |
| 183 | `governance.task.minutes_to_approve` (params `forum`, `meetingDate`) | work-item message key | ADR-0032 G2 | accepted (BE-F2 proposal) | Approve the minutes of the {forum} meeting of {meetingDate}. | authored | api governance/minutes.ts |
| 184 | `approval.subject_unknown` (existing ADR-0026 A5 code; now also on resubmit, pointer `/subjectId`) | 422 | ADR-0026 E1 | accepted reuse | The record to approve does not exist in this transformation. | server | api workflows/approvals.ts |
| 185 | `approval.not_requester` (existing code; now also on the three subjects' round-2 submit and withdraw) | 403 | ADR-0026 E2, E3 | accepted reuse | Only the requester can resubmit or withdraw this approval. | server | api workflows/approvals.ts |

The rows also live in their ADR amendments (ADR-0021 W5, ADR-0025 D4, ADR-0026 E1–E3, ADR-0027 C3, ADR-0032 G2, ADR-0038 B4). `evidence/codes-table.md` is a copy of this table.

