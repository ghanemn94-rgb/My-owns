# ADR-0045: Generated outputs and report snapshots: the ten outputs and their assemblers, live vs issued, ReportSnapshot (as-of, period, record revisions, methodology and calculation versions, approval state), reissue as a new version, provisional labels, presentation mode and printable packs, structured owner updates and the executive pack, evidence fields and linkage

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-04), 2026-10-14.
- **Requirements (slice F of `docs/architecture/p5-plan.md`):** REQ-S13-004, REQ-S13-007, REQ-S13-008, REQ-S13-010, REQ-S09-011, REQ-S10-013. ADR-0046 covers the exporters (REQ-S13-005, REQ-S13-006, REQ-S13-009) and the export jobs.
- **Sources (quoted where a design point has one):**
  - M0253 (§13): "Generate charter, diagnostic, TOM, business cases, roadmap, registers, meeting minutes, gate packs, executive dashboard and handover outputs inside the application. Include native reading/presentation views and actual export functions for relevant PDF, DOCX, XLSX, PPTX and CSV outputs. A report export must contain the selected records, not a generic placeholder."
  - M0254 (§13): "Reporting snapshots must retain as-of time, reporting period, source record revisions, methodology version, calculation versions and approval state. Live reports may refresh; issued snapshots remain immutable. Label provisional/unvalidated values clearly and preserve bilingual layout in exports."
  - M0255 (§13): "Provide a secure evidence repository with record linkage, evidence type, source, owner, observation period, upload date, version, checksum and review status. … A filename or inaccessible external link is not verified evidence. … apply the same authorization to downloads and previews as to the parent record."
  - M0185 (§9): "Owners submit concise structured updates covering achievements, next steps, milestones, outcomes, adoption, risks, dependencies and asks. Generate executive views directly from these updates and canonical metrics. Do not require owners to recreate the same update in a slide deck."
  - M0212 (§10): "Read-only presentation mode and printable packs must use the same underlying records."
  - Playbook: B0015 "One source of truth: keep the transformation charter, roadmap, initiative portfolio and benefits register linked."; the templates behind the outputs: B0034 (Transformation Charter), B0030 (Template 1, Current-State Diagnostic), B0055/B0057 (the 10-dimension TOM, Template 3), B0083 (Transformation Business Case), B0078/B0080 (Templates 7 and 8, Wave Roadmap and Dependency Map), B0122/B0127/B0129 (Templates 14–16: Benefits Register, RAID, Executive Decision Log), B0093 (governance cadence: "Executive SteerCo | Monthly | … | Decisions, unblockers, benefit view"), B0023 (stage gates and their evidence), B0094 (Template 10, Executive Transformation Dashboard), B0100 (Template 12, RACI row "BAU Handover").
- **Decisions applied:** D-141 (carried rules), D-142 (the plan; R1: each row judged on its own acceptance text; Q8 for ADR-0046), D-143, D-144, D-145; D-088 §2 and F-DG3-100 (claims enumerated and exactly true).
- **Builds on:** ADR-0003 (persistence, optimistic concurrency), ADR-0004 (audit), ADR-0006 (authorization), ADR-0007 (API conventions, §5b statuses), ADR-0010 and ADR-0018 (evidence storage and the evidence repository), ADR-0016 (P2 guards, lock registry), ADR-0025 (job kit, work items), ADR-0027/ADR-0028 (KPI versions, staleness), ADR-0029/ADR-0030 (benefit values, Finance validation, value bases), ADR-0032 (meetings, agenda, minutes), ADR-0034 (BAU handover), ADR-0035 (gates G5/G6), ADR-0037 (dashboards and their read models, unit kinds N5), ADR-0039 (pins, `ConfigResolver`).
- **Physical model:** `0080_p5_reports_snapshots_updates.sql`, `0082_p5_reporting_permissions.sql` (shared with ADR-0046). Probe ids (G, S, RS, RC, OU, AO, AD) refer to `docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/probe-output.txt`.
- **Two gate systems.** Product gates G1–G6 are business approvals inside the product. Nothing in this ADR reads or writes the engineering records DG0–DG7, and no output, template or export text names them. Issuing a report snapshot freezes what the records said; it approves nothing. A snapshot only records the approval state its sources had.

## Context

As built on `HEAD` `8ac7fec` (DG4 APPROVED; slices A–E of P5 merged or in flight):

1. The data behind every M0253 output exists as typed DG2–DG4 records: charter, North Star, outcomes and guardrails (ADR-0017), diagnostic items, findings, baselines and value pools (ADR-0019), the TOM canvas and gaps, business cases and benefit formulas (ADR-0024), roadmap waves, initiatives, milestones and dependencies (ADR-0021, ADR-0023), the registers (RAID ADR-0031, benefits ADR-0029/0030, KPIs ADR-0027, decisions and dependencies ADR-0015/0023, actions), meetings, agenda and minutes (ADR-0032), product gates and their evidence snapshots (ADR-0015, ADR-0035), the dashboards' read models (ADR-0037) and BAU handovers (ADR-0034).
2. No output is generated as a document. The P4 dashboards are live read models; the P3 ranking snapshots and the P2/P4 gate evidence snapshots are domain snapshots, not report snapshots.
3. `apps/api/src/modules/reporting/{reports,exports}/routes.ts` and `governance/presentation.ts` are BE-A stubs that register nothing; `apps/worker/src/{handlers,queues}/reports.ts` are empty stubs.
4. The evidence repository (`0012`, `0019`; ADR-0018) already stores, per item: `kind`, `evidence_type`, `source`, `owner_user_id`, `observation_start`/`observation_end`, `review_status` with reviewer and content, and per file revision (`evidence_content`): `revision`, `sha256`, `size_bytes`, `content_type`, `file_name`, `uploaded_by`, `uploaded_at`. Record linkage is `evidence_link` (20 P2 record types) plus the domain link tables of P4 and P5 (`benefit_evidence`, `phase_step_evidence`, BAU handover evidence, form-record attachments). The DG2 `Evidence` API schema does not return the current revision number, checksum or upload date; `downloadEvidenceContent` returns the bytes.
5. `reporting_period` (`0033`) holds the organization's periods (`scheduled` → `open` → `closed`); `kpi.reporting_period_open` opens them daily. `workstream` (`0055`) has a `lead_user_id`.

## Decision

### 1. Report definitions: the ten outputs and two packs (REQ-S13-004)

`report_definition` (read-only catalogue, 12 rows seeded by `0080`, probe S01–S02) lists every output the product generates. The ten M0253 outputs are `output_kind = 'generated_output'`; `executive_pack` (M0185) and `meeting_pack` (M0212) are the two packs.

| Ordinal | `code` | Subject (`subject_type`) | Period | Formats (ADR-0046) | Playbook |
|---|---|---|---|---|---|
| 1 | `charter` | transformation | no | PDF, DOCX | B0034 |
| 2 | `diagnostic` | transformation | no | PDF, DOCX, XLSX | B0030 |
| 3 | `tom` | transformation | no | PDF, DOCX, XLSX | B0055, B0057 |
| 4 | `business_cases` | transformation | no | PDF, DOCX, XLSX | B0083 |
| 5 | `roadmap` | transformation | no | PDF, PPTX, XLSX | B0078, B0080 |
| 6 | `registers` | transformation | no | XLSX, CSV, PDF | B0122, B0127, B0129 |
| 7 | `meeting_minutes` | meeting | no | PDF, DOCX | B0093 |
| 8 | `gate_pack` | gate_instance | no | PDF, PPTX, DOCX | B0023 |
| 9 | `executive_dashboard` | transformation | yes | PDF, PPTX, XLSX | B0094 |
| 10 | `handover` | bau_handover | no | PDF, DOCX | B0100 |
| 11 | `executive_pack` | transformation | yes | PDF, PPTX, DOCX | B0093 |
| 12 | `meeting_pack` | meeting | no | PDF, PPTX | B0093 |

Every output is scoped to **one transformation** (`report_snapshot.transformation_id NOT NULL`); its subject is the transformation itself or one of its records (CHECK `report_snapshot_subject_transformation`, RS10; trigger `report_snapshot_subject_ref`, RS06). This is what REQ-S13-004 tests: "each of the ten outputs … generates from the demo transformation and contains that transformation's ID and records".

**Assemblers.** One pure-read assembler per definition (`apps/api/src/modules/reporting/reports/assemblers/<code>.ts`; KBE-C and KBE-D) turns the records into the document model of §3. Each assembler reads only through the owning module's existing services or read models (the dashboards engine for `executive_dashboard` and the metrics of `executive_pack`; the DG4 minutes service for `meeting_minutes`; the DG2/DG4 gate evaluators' outputs for `gate_pack`), so a report shows the same numbers as the screen. An assembler never computes a business value the screen does not compute.

**`registers` parameters** (`report_snapshot.parameters`, a JSON object ≤ 8 KiB, Zod-validated): `register` ∈ `raid`, `benefits`, `kpis`, `decisions`, `dependencies`, `actions`, and `filters` equal to that register's DG2–DG4 list filters (the same Zod schema as the list route's query). The rows are exactly those the list route returns for the same filters at the as-of instant, without pagination; REQ-S13-005's "an XLSX export of T15 contains exactly the filtered RAID rows" is tested against the DG4 list route.

**Size limit.** A table section holds at most 5,000 rows and the content's canonical JSON at most 10 MiB; above either, generation is refused with 422 `report.too_large` before anything is written (no truncated report exists).

### 2. Live and generated reports; issue (REQ-S13-007)

- **Live** (`GET …/reports/{definitionCode}/live`): assembled at request time, never stored, always current ("Live reports may refresh", M0254). It returns the document model with `asOf` = the request's transaction time and `snapshotId = null`.
- **Generated** (`POST …/reports/{definitionCode}/generate`): the same assembly, stored as a `report_snapshot` in status `generated` with its captured sources, versions and evidence (§3). A generated snapshot is already immutable in content; it is a working copy that may be exported (ADR-0046 marks it "Draft — not an issued report") or discarded.
- **Issued** (`POST …/report-snapshots/{id}/issue`): the official issue of a generated snapshot. Its content does not change at issue time (it is the content generated); the status, `issue_version`, `issued_at`, `issued_by` and an optional note are set.

**State machine** (trigger `report_snapshot_guard`; RS04, RS14–RS19, RS24–RS29):

```text
generated -> issued (issue_version = the next number of its series) | discarded (reason required)
issued    -> superseded (only by the issue of a reissue in the same series; checked at COMMIT)
superseded, discarded: terminal
```

Snapshots are never deleted (mth_app has no DELETE grant; RS30).

**Immutability (REQ-S13-007 "issued snapshots are immutable").** After the INSERT, these columns never change, whatever the status: `definition_code`, `subject_type`, `subject_id`, `reporting_period_id` and its copies `period_label`/`period_start`/`period_end`, `parameters`, `as_of`, `content_schema_version`, `content`, `content_sha256`, `methodology_version_id`, `approval_state`, `provisional_value_count`, `unknown_value_count`, `series_id`, `reissue_of_id`, `reissue_reason` (constraint `report_snapshot_content_immutable`; RS11–RS13). The issue, supersede and discard stamps change only with their own transition (`report_snapshot_stamps_frozen`, RS18). The captured children (§3) are append-only and can be written only in the snapshot's creating transaction (RC02–RC05).

### 3. What a snapshot retains (REQ-S13-007, M0254)

| M0254 item | Where it lives |
|---|---|
| as-of time | `report_snapshot.as_of` (the assembling transaction's time; one read-only `REPEATABLE READ` transaction assembles the whole output, so every section reads the same database state) |
| reporting period | `reporting_period_id` plus the copies `period_label`, `period_start`, `period_end` (all-or-none, CHECK `report_snapshot_period_copy`, RS09; equal to the period row, `report_snapshot_period_matches`, RS08); required exactly for `executive_dashboard` and `executive_pack` (`report_snapshot_period_required`, RS07) |
| source record revisions | `report_snapshot_source`: one row per record used (`record_type`, `record_id`, `record_version` = the row's `version` at the as-of instant, `record_updated_at`, `section_key`), UNIQUE per snapshot and record |
| methodology version | `report_snapshot.methodology_version_id` (NOT NULL: the transformation's `methodology` pin at the as-of instant, read through `ConfigResolver`, ADR-0039) and one `report_snapshot_version` row of kind `methodology_version` |
| calculation versions | `report_snapshot_version` rows (closed set `version_kind`): `kpi_version` (each KPI definition version used), `formula_version` (each benefit or business-case formula version used), `weight_set` (the T06 weight set used by a ranking shown), `calculation_engine` (`ENGINE_VERSION` of `packages/shared/src/formula`, read, never changed), `config_version` (form schema and procedure pins that shaped a section), `scoring_scheme` (reserved for slice H's health-check scheme) |
| approval state | `report_snapshot.approval_state` (closed set: `approved`, `pending`, `not_submitted`, `changes_requested`, `rejected`, `mixed`, `not_applicable`) and, per source record, `report_snapshot_source.approval_state` (same set without `mixed`; NULL when the record type has no approval) |
| evidence cited | `report_snapshot_evidence`: per section and evidence item, the cited `content_id`, `content_revision` and `content_sha256` (equal to the `evidence_content` row, trigger `report_snapshot_evidence_content_matches`, RC06) and the `review_status` at the as-of instant |

**Snapshot approval state**, by definition: `charter` = the charter's approval state; `gate_pack` = the gate decision's state (`approved`, `rejected`, `changes_requested`, `pending` for a submitted gate, `not_submitted`); `meeting_minutes` = `approved` once the DG4 minutes are approved, else `pending`; `handover` = `approved` when accepted, `pending` when submitted, `changes_requested` when returned, `not_submitted` in draft; `business_cases` and `registers` = `mixed` when their rows' states differ, else the common state, `not_applicable` when no row has one; `diagnostic`, `tom`, `roadmap`, `executive_dashboard`, `executive_pack`, `meeting_pack` = `not_applicable`. These are recorded facts; none is an approval.

**Content (document model, `content_schema_version = 1`).** A JSON object validated by the Zod schema `ReportDocument` in `packages/shared/src/schemas/report.ts` (KBE-C) before the INSERT; the database checks only `jsonb_typeof = 'object'`. Members: `definitionCode`; `transformation {id, code, name}`; `subject {type, id, code, label}`; `period` (or null); `asOf`; `methodology {versionId, key, versionNo}`; `approvalState`; `sections[]`. A section has `key`, `titleKey` (an i18n key, translated at render time), `kind` (`fields`, `table`, `text`, `metrics`, `list`), its source records and its values. A table has `columns[]` (`key`, `labelKey`, `valueKind`, `unitKind`) and `rows[]` (`recordType`, `recordId`, `recordVersion`, `cells[]`) and optional `totals[]` (`columnKey`, `formula: 'sum'`, `value`). **Every value** is one of: `text` (`text`, `authored: 'user' | 'system'`), `decimal` (`value` as a canonical decimal string, `unitKind` per ADR-0037 N5, `currency` for money, `valueBasis` for benefit values (D-117, D-119, D-122), never mixed in one column), `date`, `timestamp`, `code` (a closed-set value with its i18n key), `count` (integer), and each carries `validation` ∈ `validated`, `provisional`, `unknown`, `stale`, `not_applicable`. An `unknown` or `stale` value has no number (`value: null`, with `reason` `missing`, `stale` or `not_computable`). `content_sha256` = SHA-256 (hex) of the UTF-8 canonical JSON (keys sorted by code point, no insignificant whitespace; the ADR-0039 §1 rules), recomputed by the API before the INSERT.

**Labels are translated at render time.** The content holds i18n keys and parameters for every system label; user-authored text is stored as authored (one language, not machine-translated). The same snapshot renders in English LTR or Arabic RTL (ADR-0046 §3).

### 4. Reissue as a new version (REQ-S13-007; used by REQ-S07-016, ADR-0047)

`POST …/report-snapshots/{id}/reissue` (body `reason`, 3–1000 characters) on the **current issued** snapshot assembles the same definition, subject, period and parameters again from the current records and stores a new `generated` snapshot with `reissue_of_id` = the issued one, `series_id` = its series and `reissue_reason` (CHECK `report_snapshot_reissue_shape`, RS22; trigger `report_snapshot_reissue_of_issued`, RS21). Issuing that reissue, in one transaction under lock 730263: (1) the previous issued snapshot → `superseded` with `superseded_by_id` = the reissue; (2) the reissue → `issued` with `issue_version` = previous + 1 (`report_snapshot_issue_next`). The partial unique index `report_snapshot_one_issued_key` keeps one issued snapshot per series (RS24), and the deferred check `report_snapshot_superseded_by_issued` refuses a supersede that no later issue explains (RS19). The superseded v1 keeps its content, hash, versions and approval state (RS26): REQ-S13-007's "after a later KPI change, the issued snapshot still shows the old values and their versions".

### 5. Provisional, unknown and stale labels (REQ-S13-008)

The assembler sets each value's `validation` from the source record's own DG2–DG4 state, by this rule (the source states are the existing ones; KBE-C names the exact column per assembler in its handback):

1. A benefit value (forecast, realized) whose measurement is not `validated` by Finance (ADR-0030) is `provisional`.
2. A business-case value or benefit formula whose formula version is not `validated` (ADR-0024, ADR-0030) is `provisional`.
3. A baseline whose validation status is not `validated` (ADR-0019, ADR-0029) is `provisional`.
4. A KPI actual that is not accepted (ADR-0027 pipeline) is `provisional`; a KPI whose latest actual is stale by the DG4 staleness rule (ADR-0028) is `stale`.
5. A value the source does not have, or cannot compute, is `unknown` with no number.
6. Every other value is `validated` when its source has a validation state that is validated, and `not_applicable` when its source has none (e.g. a text field, a date, a count).

`report_snapshot.provisional_value_count` and `unknown_value_count` count rule 1–4 and rule 5 values (stale is counted in `unknown_value_count`, because it shows no current number). Native views and every exporter print the label **"Provisional"** / **"مؤقت"** next to each provisional value, **"Unknown"** / **"غير معروف"** or **"Stale"** / **"قديم"** in place of the number, and a legend on the first page or sheet. A provisional, unknown or stale value is never shown as 0 and never coloured green (rule 5 of the shared rules). REQ-S13-008's test: "a pending benefit value is labelled provisional in the PDF pack".

### 6. Structured owner updates and the executive pack (REQ-S09-011)

**Entity** `owner_update` (one per subject and reporting period; UNIQUE `owner_update_subject_period_key`, OU06): `subject_type` ∈ `transformation`, `workstream` (a workstream of the same transformation, OU07; the transformation itself, OU17), `reporting_period_id`, `owner_user_id`, the eight M0185 fields `achievements`, `next_steps`, `milestones`, `outcomes`, `adoption`, `risks`, `dependencies`, `asks` (each NULL or 1–2000 characters, free text through the shared rules), `status`, `revision_no`, `submitted_at`/`submitted_by`, `reopen_reason`, P2 stamps and `version`. **History** `owner_update_revision` (append-only, OU15): the eight fields of each submission.

**State machine** (trigger `owner_update_guard`; OU01, OU08–OU14, OU16):

```text
draft     -> submitted (revision_no + 1; at least one field written; the revision row in the same transaction)
submitted -> draft (reopen; reason required)
```

Every write needs the period `open` (`owner_update_period_open`; OU04, OU05). A submitted update does not change until it is reopened (`owner_update_submitted_frozen`, OU11); each submission writes its revision row (deferred `owner_update_revision_present`, OU08).

**Who writes.** `owner_update.submit` (TL, WL) and, in the subject's scope: for a workstream, its `lead_user_id`; for the transformation, a holder of the TL role in the transformation. Anyone else gets 403 `owner_update.not_owner`. Reading needs `transformation.read`.

**Update tasks** ("Reporting period opens -> update tasks"): the daily job `reports.owner_update_tasks` (00:40 Asia/Riyadh, seeded by `0080`, S03) creates, for each open `monthly` reporting period (the Executive SteerCo cadence of B0093) and each active transformation of the organization, one `owner_update_due` work item per subject owner without a submitted update (dedupe key `owner_update_due:<periodId>:<subjectType>:<subjectId>:<userId>`, `createWorkItemOnce`; a replay creates nothing). A subject without an owner (a workstream with no lead) gets no task, and the executive pack shows it as "No owner".

**Executive pack** (`executive_pack`, needs a period): one section for the transformation and one per active workstream, each with (a) the latest submitted revision of its update for the period, the eight fields verbatim, or "No update submitted" / "لم يُقدَّم تحديث" when there is none, never a blank or an older period's text; and (b) its current canonical metrics from the DG4 workstream dashboard read model (ADR-0037: KPI status, benefit totals per value basis, open RAID counts, milestones), with their validation labels (§5). Nothing is typed into the pack: REQ-S09-011's "the executive pack's workstream section contains the submitted update text and current metrics without manual editing". The source rows include each `owner_update` with its `version` and `revision_no`.

### 7. Presentation mode and printable packs (REQ-S10-013, M0212)

`GET …/meetings/{meetingId}/presentation` returns the `meeting_pack` document model of the meeting, read-only:

- without `snapshotId`: **live**, assembled from the agenda items, their linked decision briefs and executive asks and the meeting's actions at request time; a linked decision changed before cut-off appears changed;
- with `snapshotId`: the stored content of that snapshot, which must be a `meeting_pack` snapshot of this meeting (else 422 `presentation.snapshot_mismatch`).

The **printable pack** is the `meeting_pack` snapshot generated and issued like any output and exported as PDF or PPTX (ADR-0046). Presentation and pack are both produced from the same assembler over the same records; there is no separately editable copy. REQ-S10-013's test: "changing a linked decision before cut-off changes the presentation; the issued pack remains the snapshot". Authorization: `transformation.read` in the meeting's transformation (the DG4 meeting read rule); generating and issuing need `report.generate` and `report.issue`.

### 8. Evidence fields and linkage (REQ-S13-010)

Every M0255 field already exists in `0012`/`0019` (Context 4); **no column is added to `evidence`** and no DG2 constraint changes. P5 adds read paths and report linkage:

| M0255 field | Column | P5 exposure |
|---|---|---|
| record linkage | `evidence_link` and the domain link tables | the register lists every active link of each item |
| evidence type | `evidence.evidence_type` | register |
| source | `evidence.source` (NULL = "Not stated", never blank) | register |
| owner | `evidence.owner_user_id` | register |
| observation period | `observation_start`, `observation_end` (NULL = "Not stated") | register |
| upload date | `evidence_content.uploaded_at` of the current revision; for a note or link, `evidence.created_at` | register, versions |
| version | `evidence_content.revision` of the current content (files); notes and links have no content revision and show the record `version` | register, versions |
| checksum | `evidence_content.sha256` (files only) | register, versions |
| review status | `evidence.review_status` (a `file_reference` or inaccessible link is never `verified`: `evidence_filename_never_verified`, `evidence_verified_rule`, DG2) | register |

- `GET …/evidence-register`: one row per evidence item with the fields above and its links (cursor pagination; filters `reviewStatus`, `evidenceType`, `recordType`).
- `GET …/evidence/{evidenceId}/versions`: every content revision (revision, SHA-256, size, content type, file name, uploaded by, uploaded at), newest first. REQ-S13-010's test: "an uploaded file stores a SHA-256 checksum and version 1; a second upload becomes version 2" (DG2 upload path, unchanged).
- `GET …/report-snapshots/{id}/evidence`: the evidence a snapshot cites (§3), with the revision and checksum it had.

Authorization equals the parent record's: `transformation.read` in the transformation (M0255 "the same authorization … as to the parent record"); the DG2 download route is unchanged. Exports never embed evidence bytes; they list the cited items with revision, checksum and review status.

### 9. Authorization (permissions matrix §21)

| Operation group | Permission | Role defaults (`0082`) |
|---|---|---|
| Read definitions, live reports, snapshots and their sources/versions/evidence, presentation, owner updates, evidence register and versions | `transformation.read` (DG1) in the transformation | every role holding it in scope, AUD included |
| Generate a snapshot (and reissue's assembly) | `report.generate` | SP, TL, BO, WL, FIN, TO, KDS, TD, CM, SEC |
| Issue, reissue, discard | `report.issue` | TL, TO, SEC (REQ-S13-007 "issue:TL,TO,SEC") |
| Create, update, submit, reopen an owner update | `owner_update.submit` + subject owner (§6) | TL, WL |

AUD and the technical administrators hold none of the four codes; AUD reads through `transformation.read` and gets 403 on every write. No code is a `business_approval` or `finance_validation` code (seed test, probe S04). Every mutation re-checks its permission and the subject's scope inside its transaction (commit-time re-authorization), validates, requires `If-Match` on every change of an existing row (428 missing, 409 stale; the creates `generateReportSnapshot` and `createOwnerUpdate` take none and return version 1), writes one audit event per mutated row of `report_snapshot` and `owner_update` (`report_snapshot.generate|issue|reissue|discard|supersede`, `owner_update.create|update|submit|reopen`), and does no remote I/O inside the transaction. The captured children and the revision rows carry no audit event of their own: the parent's event covers them (the `job_run` precedent; RC01). There is no separation-of-duties rule on issuing: an issue is not an approval.

### 10. Locks, jobs and events

- Lock **730263** `reportSnapshotIssue` (key `<definitionCode>:<transformationId>:<subjectId>:<reportingPeriodId or ->`): issue, reissue and discard of the snapshots of one output and subject. Generation takes no lock (each generation is a new row).
- Job `reports.owner_update_tasks` (queue of the same name, daily 00:40 Asia/Riyadh; `0080`).
- Outbox event (schema_version 1): `report_snapshot.issued` `{snapshotId, definitionCode, transformationId, seriesId, issueVersion}` (consumed by slice G's restatement flow, ADR-0047, to offer reissue).

### 11. Refusal codes and English texts (exact)

| Status | Code | English text (exact) |
|---|---|---|
| 422 | `report.subject_invalid` | The subject must be a record of this transformation of the type this output reports on. |
| 422 | `report.period_required` | This output needs a reporting period. |
| 422 | `report.period_not_allowed` | This output takes no reporting period. |
| 422 | `report.parameters_invalid` | The report settings are not valid for this output. |
| 422 | `report.too_large` | The selection is too large for one report (more than 5,000 rows in a table); narrow the filters. |
| 422 | `report_snapshot.not_generated` | Only a generated snapshot can be issued or discarded. |
| 422 | `report_snapshot.not_issued` | Only the current issued snapshot can be reissued. |
| 409 | `report_snapshot.series_changed` | This report was issued or reissued meanwhile; reload it. |
| 403 | `owner_update.not_owner` | Only the workstream lead, or for the transformation its Transformation Lead, can write this update. |
| 409 | `owner_update.exists` | An update for this subject and reporting period already exists. |
| 422 | `owner_update.period_not_open` | Updates can be written only while their reporting period is open. |
| 422 | `owner_update.not_draft` | Only a draft update can be changed or submitted. |
| 422 | `owner_update.empty` | Write at least one of the eight fields before submitting. |
| 422 | `owner_update.not_submitted` | Only a submitted update can be reopened. |
| 422 | `presentation.snapshot_mismatch` | This snapshot is not a pack of this meeting. |

Generic codes (401, 403 `forbidden`, 404, 409 `version_conflict`, 428 `precondition_required`, 400 validation) are ADR-0007's. The database constraint names above (probe output) map to these codes in `platform/db-errors.ts` (P5 lines, KBE-C) only where reaching them is not a programming error.

### 12. Decimal and Unknown semantics

Every number in the content is a canonical decimal string produced by the source's own decimal code (decimal.js; `@mth/shared/calc`), with its unit kind and, for money, its currency (default SAR, configurable per transformation). Assemblers never sum across value bases or currencies; a total is shown only where the source screen shows one. Totals in tables are computed with decimal.js. A missing value is `unknown` with `value: null`; a stale KPI is `stale` with no number; neither is 0 or green. Counts are integers. Dates are business dates in the transformation's time zone (default Asia/Riyadh); `as_of` is a `timestamptz`.

## Alternatives considered

1. **Store only a pointer to the live data and re-read it on demand.** Rejected: M0254 requires issued snapshots to stay as they were after later changes; the content is stored, and its sources and versions are recorded beside it.
2. **One unvalidated blob per snapshot.** Rejected (solution-architect rule): the M0254 items are typed columns and typed child tables; only the rendered document model is JSON, Zod-validated with a schema version.
3. **Rendering exports from live data in the worker.** Rejected: the worker cannot import API code (ADR-0002 rule 5), and an export must contain exactly the records the user saw. Every export renders a snapshot (ADR-0046 §2).
4. **Owner updates as free-text notes on the workstream.** Rejected: M0185 lists eight structured parts, and the pack must cite a fixed revision per period.
5. **Adding missing evidence columns as NOT NULL.** Not needed: every M0255 field exists (§8); a NOT NULL addition would be a DG2 reopen.

## Consequences

- Each generation stores one snapshot with its sources; P5 does not purge generated (not issued) snapshots. A retention rule is a later decision (the `job_run` precedent, D-145).
- Assemblers depend on the DG2–DG4 read services; a later change to a screen's numbers changes live reports and new snapshots, never issued ones.
- `executive_pack` and `meeting_pack` reuse the snapshot and export machinery, so slice G's reissue offer (ADR-0047) and slice J's demo reports need no new mechanism.

## Verification

- **Database (probe, 93/93 PASS on PostgreSQL 16.13):** G00–G04 (migrations, fresh and over P4 data), S01–S04 (seeds), RS01–RS30, RC01–RC08, OU01–OU17, AO and AD (grants) in `docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/probe-output.txt`; EJ01–EJ20 are ADR-0046's.
- **Catalogue and seed pins:** `packages/db/test/integration/catalogue.test.ts` (tables, the slice F triggers, grants, mutable `version` tables), `packages/db/src/seed.test.ts` (`0082` equals `P5_REPORTING_PERMISSIONS`/`_ROLE_PERMISSIONS`; no approval code; AUD and technical admins none; issue = TL, TO, SEC), `apps/api/src/modules/platform/advisory-locks.test.ts` (distinct classes).
- **Implementer tests (literal, p5-work-split §F):** each of the ten outputs generates from a seeded transformation and contains its ID and records (REQ-S13-004); after a later KPI change the issued snapshot still shows the old values and versions, and a reissue is v2 (REQ-S13-007); a pending benefit value is labelled provisional (REQ-S13-008, with ADR-0046 for the PDF); the executive pack's workstream section contains the submitted update text and current metrics (REQ-S09-011); a changed linked decision changes the presentation and not the issued pack (REQ-S10-013); a second upload is version 2 with its SHA-256 in the versions list and the register (REQ-S13-010); AUD 403 on every write; `If-Match` 428/409; one audit event per mutation.

## Amendment (2026-10-17, T-DG5-ARCH-R1; D-163, D-164 (c) (e) (g) (h), D-165, D-166): `synthetic`, `ReportEnvironmentPort`, declared totals, the dashboard's KPI lineage, `WorkflowsReadPort.gateApprover` and the benefit totals by reference

Sources:
- D-163 (F-DG5-qa-c-2, F-DG5-qa-c-3);
- D-164 (c), (e), (g), (h);
- D-165 (QA-B P-1);
- D-166 (W20 integrated);
- the handbacks of T-DG5-BE-N2 (§1, §6.1), T-DG5-KBE-D3 (§1–§3) and T-DG5-KBE-D4 (§2).

Nothing above is removed. Where this amendment and §1, §3 or §12 differ, this amendment wins. No migration was needed. `content_schema_version` stays 1.

### O1. The optional `synthetic` member of the document (D-163; T-DG5-BE-N2)

- **§3, content members.** `ReportDocument` has one more optional member: `synthetic`, which is `true` or absent (`packages/shared/src/schemas/report.ts:308`, `z.literal(true).optional()`; `docs/api/openapi.yaml`, `ReportDocument.synthetic`, `enum: [true]`).
- **Where it is set.** `assembleReport` (`apps/api/src/modules/reporting/reports/snapshots.ts:298`, `:326`) reads the environment in its `REPEATABLE READ` transaction. In a demo database it adds `synthetic: true` **before** validation and hashing, so `content_sha256` covers it. In a production database, or one with no marker (fail-safe), the member is absent. Production content and its hash are then exactly the content-schema-v1 document of §3 (p5-plan R2).
- **Who sets it.** It applies to every generated snapshot, reissue and live report.
- **Effect.** The renderers decide on the illustrative label from the snapshot's own recorded member, never from the worker's environment (ADR-0046 amendment). Requirement rows: REQ-PB-089 and REQ-S18-001.

### O2. `ReportEnvironmentPort` (D-164 (e))

- **Contract.** `snapshots.ts:70` exports `ReportEnvironmentPort { read(db): Promise<{ synthetic: boolean }> }`. It is the `synthetic` slice of admin's `EnvironmentReadPort` (ADR-0050 §2), which satisfies it as it is.
- **Why not `EnvironmentReadPort` itself.** ADR-0002 keeps `reporting` from importing `admin` (`modules.ts`; the architecture test). So the default `reportEnvironmentPort` (`snapshots.ts:74`) wraps the same `@mth/db` `readDeploymentEnvironment` that `EnvironmentReadPort` wraps, with the same rule.
- **Test.** `apps/api/test/integration/reporting/report-synthetic.test.ts` proves the two ports agree on a demo database and on a production database, also inside a transaction. A compile-time assignment proves that the admin port satisfies the reporting port.

### O3. Declared table totals, "only where the source screen shows one", as built (T-DG5-KBE-D3; D-163 F-DG5-qa-c-3)

**The rule** (`apps/api/src/modules/reporting/reports/assemblers/table-totals.ts`, `columnTotal` / `columnTotals`, pure and unit-tested). A table section declares `totals[]` (`{columnKey, formula: "sum", value}`, §3) only for a column whose source screen shows a total. The helper refuses where a total would be wrong:

- **Column type.** Only a `decimal` column is totalled, and a table with no rows has no total.
- **Mixed cells.** A column whose cells mix unit kinds, value bases or currencies gets **no** total. Currencies are never converted (D-117, D-119, D-122).
- **Unknown or stale cells.** Either makes the total **Unknown** (`value: null`, reason `not_computable`). A partial sum is never shown as complete.
- **Not-applicable cells.** A `not_applicable` cell with no number, for example an unmonetised benefit or a value held back by an open overlap, is left out.
- **The value.** It is the screen's own figure, read by reference from the owning module's engine, when the assembler passes one. Otherwise it is the decimal.js sum of the cells, never a JavaScript number.
- **The label.** `provisional` when any summed cell is provisional; `validated` only when every labelled cell is validated; otherwise `not_applicable` (§5).

**The tables that declare totals:**

| Assembler | Table (section key) | Column(s) totalled | The screen figure it equals |
|---|---|---|---|
| `diagnostic` | `value_pools` | `upside_amount`, `downside_amount`, only when every pool is in one currency | the T01 Diagnose screen's per-currency value-pool total (`totalValuePools`) |
| `business_cases` | `group_<case#>_<value basis>_<ccy>` (new) | `amount` | `grossBenefitsByValueBasis[basis][ccy]` of the DG3 case totals (`loadCaseTotals`), the screen's "By value basis" |
| `business_cases` | `group_<case#>_cost_cash_<ccy>`, `group_<case#>_cost_non_cash_<ccy>` (new) | `amount` | `implementationCostCash` / `implementationCostNonCash` |
| `registers` with `{register: "benefits"}` | `totals_<ccy>_<value class>` (new) | `realized_validated`, `realized_sustained`, `pending` | `GET /benefit-totals`, one line per class × state × currency (O6) |

Every other table declares no total, with the reason recorded in the KBE-D3 handback §3. Examples:
- the business-case `lines` table mixes bases and currencies;
- the business-case `totals` table lists different measures, and gross and net stay figures, never SUM tables (D-117, F-DG4-121);
- the registers' own tables mix units;
- the executive dashboard's rows are different KPIs.

**§12 is read with this.** "A total is shown only where the source screen shows one" holds exactly for the four tables above.

**XLSX.** ADR-0046 §4 turns a declared total into `SUM(<col>first:<col>last)` with the decimal.js value cached. That happens only when every data cell of the column is a number whose decimal sum equals the total. Otherwise (an Unknown row, a number written as text) the value is written without a formula, and an Unknown total is an empty cell with its status (`packages/reporting/src/model.ts:264` `totalRowCells`).

**Regression.** A stored snapshot's content is fixed at INSERT. Only snapshots generated after W18 contain the new tables.

Requirement rows: REQ-S13-006 ("a system SUM total remains a formula"), REQ-S13-008 and REQ-S13-004.

### O4. The executive dashboard records its KPI versions and sources (T-DG5-KBE-D4; D-165 QA-B P-1)

- **Before.** `executive-dashboard.ts` recorded `versions: []`.
- **Now.** For every dashboard item that shows a KPI value (an outcome KPI or an adoption indicator), `kpiLineage` (`apps/api/src/modules/reporting/reports/assemblers/executive-dashboard.ts:229`) reads that KPI status's `kpi_evaluation` and records the following.
  - **Versions** (`report_snapshot_version`, §3):
    - `kpi_version`: reference id = the evaluation's `kpi_version_id`, key `kpi_definition:<id>`, label `v<n>`, as the KPI register records it;
    - `calculation_engine`: the evaluation's `calculation_run` `kpi_rules_version` and `formula_engine_version`.
  - **Sources:**
    - each `kpi_definition` shown;
    - the period's `kpi_actual` for the evaluation's scope, labelled `validated` once accepted, else `provisional`.
  - **Uniqueness.** Sources are deduplicated against the item sources (`report_snapshot_source_record_key`), and versions have unique keys (`uniqueVersions`, `:207`; `report_snapshot_version_key`).
- **Effect (§4, ADR-0047).** The worker's restatement run (`apps/worker/src/handlers/kpi.ts`) matches a snapshot on a `kpi_version` row or a `kpi_definition` source. So an approved KPI restatement now offers the issued dashboard for reissue.
- Requirement rows: REQ-S13-007 and REQ-S07-016. Test: `tests/qa/integration/a07-historical-integrity.test.ts`, the two REQ-S13-007 dashboard tests, which pass unchanged.

### O5. `WorkflowsReadPort.gateApprover` (T-DG5-KBE-D4; D-164 (c))

- **Port.** `apps/api/src/modules/reporting/ports.ts:17` adds `gateApprover(db, transformationId, gateCode) → {roleCode, userId} | null` to the existing `WorkflowsReadPort`. The unwired port answers null.
- **Wiring.** The composition root wires it to workflows' `effectiveGateApprover` (`apps/api/src/server.ts:386`), which is the routed approver of the ADR-0039 amendment C1. `reporting` still imports no `workflows` code.
- **Use in the gate pack** (`assemblers/gate-pack.ts:182–185`). The approver it names is the submission's recorded approver first. With no submission, it is `gateApprover`'s answer. It is the stored `gate_instance.approver_role_code` only when the port is unwired or answers null. A new transformation pinned to a version whose G3 default is BO therefore prints BO, as `GET …/gates/G3` does.
- Requirement row: REQ-S13-004. Test: `apps/api/test/integration/reporting/gate-pack-approver.test.ts`.

### O6. The benefit totals are taken by reference (T-DG5-KBE-D4; D-164 (h))

- **Barrel.** `apps/api/src/modules/benefits/index.ts:31` exports `computeTotals`, `totalsOf` and their types from the module-private `totals.ts`.
- **Totals block** (`registers.ts` `benefitTotalSections`, `:368` and `:374`). It no longer restates the counting rules.
  - Each row's cells are `computeTotals` of that one benefit: the engine decides whether it is counted and monetised, and an unmonetised benefit is in no table, never 0.
  - Each declared total is `totalsOf(db, [t], null)`'s line for that currency × class × state, the figure `GET /benefit-totals` returns. It is passed to `columnTotals` as the screen's value.
- **Boundary.** `reporting` already imported `benefits` (`dashboards/engine.ts`), so the module boundary is unchanged.
- Requirement rows: REQ-S13-006 and REQ-S13-008. Tests: `registers-report.test.ts` and `table-totals-demo.test.ts`, which pass unchanged.

Nothing here approves anything. Product gates G1–G6 are business approvals inside the product, and nothing here touches the engineering gates DG0–DG7. Demo content is synthetic and illustrative, not Mobily performance.
