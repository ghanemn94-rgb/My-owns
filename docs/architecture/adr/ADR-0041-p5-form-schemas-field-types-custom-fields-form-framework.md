# ADR-0041: Form schema versions, the eleven Studio field types, extension fields and protected source columns, custom-field values validated against the pinned version, the common form framework, and the twelve extension record types

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-02), 2026-10-14.
- **Requirements (slice B of `docs/architecture/p5-plan.md`):** REQ-S05-001, REQ-S05-002, REQ-S05-006, REQ-S06-005, REQ-S16-010. It also supplies the "fields and validation" part of REQ-S06-004 and the "added field" diff rows of REQ-S06-007 that ADR-0039 §4 assigns to this slice, and the "new required field" provider of REQ-S06-008 (ADR-0040).
- **Sources (quoted where a design point has one):**
  - M0127 (§5): "Implement every numbered template as a native structured form/register. Preserve all source columns below; extensions may add fields without deleting their meaning. Include inline help, validation, draft saving, version history, comments, attachments, permissions, bulk editing where suitable and export."
  - M0128–M0144 (§5): the table of the sixteen templates and their "Minimum fields or content".
  - M0145–M0148 (§5): the Charter, the TOM Canvas and the Business Case as "first-class native records".
  - M0149 (§5): "Native operating records added for execution. Structured evidence, baseline registry, value-pool register, resource/capacity plan, funding approvals, process/procedure definitions, change requests, meeting records, corrective plans, lessons learned, BAU handover and controls. Mark these as extensions where the source does not supply a full template."
  - M0150 (§5): "… Avoid duplicate registers that drift."
  - M0154 (§6): "Include field types for text, rich text, number, currency, percentage, date, reference, attachment, lookup, choice and calculated value. Protect stable system identifiers and core data invariants."
  - M0155 (§6): "Existing transformations remain pinned to their methodology and form versions until a deliberate migration is approved."
  - M0315 (§16): "Use typed relational tables for core entities and validated metadata/JSON structures for extensible custom fields and versioned forms. Avoid a single unvalidated JSON blob as the entire database."
  - Playbook template blocks: B0030 (T1), B0049 (T2), B0057 (T3), B0064 (T4), B0071 (T5), B0075 (T6), B0078 (T7), B0080 (T8), B0086 (T9), B0094 (T10), B0098 (T11), B0100 (T12), B0106 (T13), B0122 (T14), B0127 (T15), B0129 (T16) — the `source_element` template labels (0064).
- **Decisions applied:** D-141, D-142 (**Q1** stable identities and version-scoped rows; **Q8** no new dependency), D-143 (ARCH-01 integrated), D-088 §2 and F-DG3-100 (claims enumerated and exactly true).
- **Builds on:** ADR-0003 (optimistic concurrency), ADR-0004 (audit), ADR-0006 (authorization), ADR-0007 (API conventions, §5b statuses), ADR-0014 §4 (custom fields; amended here, §4), ADR-0016 (P2 guards, lock registry), ADR-0018 (evidence and `evidence_link`), ADR-0024 (formula engine, unchanged), ADR-0039 (Studio kinds, `methodology_element`, `ConfigResolver`, publish pipeline), ADR-0040 (migration of pins).
- **Physical model:** `0068_p5_form_schemas_framework.sql`, `0070_p5_forms_procedures_permissions_coverage.sql` (permissions). Probe ids (FS, FE, CV, FD, FC, FA, PM, G) refer to `docs/delivery/handbacks/DG5/T-DG5-ARCH-02-evidence/probe-output.txt`.
- **Two gate systems.** Product gates G1–G6 are business approvals inside the product. Nothing here reads or writes DG0–DG7. A form schema review is a configuration review, not a business approval.

## Context

As built on `HEAD` `7344b25` (DG4 APPROVED; slice A integrated, D-143):

1. The sixteen templates, the Charter, the TOM canvas, the business case and the M0149 records are typed DG2–DG4 tables with their own routes (e.g. `tom_gap`, `benefit`, `raid_entry`, `evidence`, `lesson`). No migration `0001`–`0064` creates a `custom_field_values` column, although ADR-0014 §4 says custom fields "live in `custom_field_values jsonb` columns".
2. Several of those tables have immutability or frozen-column triggers (e.g. `funding_decision` has no `version` and is append-only; `evidence` and `decision` freeze columns after review or decision).
3. `evidence_link` (`0012`) attaches evidence to twenty DG2 record types through `p2_record_ref_guard`.
4. Slice A declared the `form_schema` configuration kind (`0062`) but no element type for it: `methodology_element_guard` refused every element of that kind.
5. The audit trail (`audit_event`, `0003`) records every mutation of every guarded table with `prior_version`/`new_version` and a `changes` object; it is the existing version history.

## Decision

### 1. Native forms: the record-type registry (REQ-S05-001, REQ-S05-006)

`form_record_type` (`0068`, read-only for `mth_app`) lists the native forms: code, kind, verbatim title, source reference, the typed table that stores the records (with a discriminator for T04/T16 on `decision.kind`), the write permission that authorizes record writes, whether it takes extension fields and bulk edits, the extension badge and the feature status. The 33 rows are (FS01):

| Kind | Rows | Codes |
|---|---|---|
| `template` | 15 | T01–T09, T11–T16. T10 (Executive Transformation Dashboard, B0094) is the DG4 dashboard read model, not a form; its layout is the slice A `report_layout`/`dashboard` element and its export is slice F. |
| `source_deliverable` | 3 | `charter` (M0146), `tom_canvas` (M0147, `tom_canvas_cell`), `business_case` (M0148) |
| `extension` | 12 | the M0149 list, in its order: `evidence`, `baseline`, `value_pool`, `resource_plan` (`resource_demand`), `funding_approval` (`funding_decision`), `procedure_definition` (ADR-0042), `change_request`, `meeting_record` (`meeting`), `corrective_plan` (`corrective_case`), `lesson`, `bau_handover`, `control` |
| `product` | 3 | `phase_step` (P4), `launch_plan` and `health_assessment` (`planned`, no table: slice H) |

`extension_badge` is true exactly for the twelve M0149 rows (CHECK `form_record_type_badge_is_extension`): the playbook supplies a template only for T1–T16, so every M0149 record is an extension (REQ-S05-006 "an 'extension' badge where the playbook supplies no template"). A `planned` row has no table and takes no extension fields (CHECK `form_record_type_storage_complete`). Titles: templates verbatim from the `source_element` labels (playbook blocks above), M0149 rows verbatim from the M0149 list, source deliverables from M0146–M0148; every Arabic title is marked "(ترجمة مؤقتة)" (provisional translation).

**The twelve extension record types are created and read through their existing DG2–DG4 operations** (REQ-S05-006 "all twelve record types can be created and retrieved via the API"): `createEvidence`/`getEvidence`, `createBaseline`/`getBaseline`, `createValuePool`/`getValuePool`, `createResourceDemand`/`getResourceDemand`, `createFundingDecision`/`getFundingDecision`, `putProcedureDefinition`/`getProcedureDefinition` (ADR-0042, new), `createChangeRequest`/`getChangeRequest`, `createMeeting`/`getMeeting`, `createCorrectiveCase`/`getCorrectiveCase`, `createLesson`/`listLessons`, `createBauHandover`/`getBauHandover`, `createControl`/`listControls`. Lessons and controls have no single-record GET in the DG4 contract; they are retrieved through their list operations, which is what the acceptance requires ("retrieved via the API"). The badge is served in `listFormRecordTypes` and `getTransformationFormSchema` (`extensionBadge: true`) and rendered in en and ar by FE-C on each of the twelve forms and in Studio.

### 2. Form schema versions and protected source columns (REQ-S05-002, REQ-S06-004)

Form schemas are Studio configuration kind `form_schema`, one key **`forms`** (the `ConfigResolver` default key of the kind; ADR-0039 §3). `forms` v1 (`0068`, seed, published) has **no element rows**, so every form resolves to the registry: the DG2–DG4 forms exactly, with no extension field (FS05).

`form_source_field` (`0068`, read-only) is the stable-identity registry of the **protected source columns**: 111 rows, one per minimum field of M0129–M0144 (T10 excluded, §1), with `label_en` verbatim from the master-prompt row at `source_ref` (e.g. T03 `gap` = "gap", M0131), a provisional Arabic label, the Studio field type, and where the platform stores it: `column` (one typed column `table.column`; 71 rows, each checked against `information_schema`, FS03), `composite` (several typed columns or related rows) or `computed` (calculated by a DG2–DG4 engine, e.g. T06 "weighted result", T14 "realized").

Two element types are added to the `form_schema` kind (`0068` widens the element-type CHECK and redefines `methodology_element_guard()` with every slice A rule kept verbatim):

- **`form`** (stable key = a `form_record_type` code): form-level `labelEn/labelAr`, `helpEn/helpAr`. Always `origin = 'source'`, never removed (CHECK `methodology_element_form_fixed`; FE12): a form is neither added nor deleted in Studio.
- **`form_field`** (stable key `<recordType>.<fieldKey>`):
  - `origin = 'source'` names a `form_source_field` (`methodology_element_source_identity`; FE13). An admin may relabel it, add help and mark it required (FE03). It is **never removed** (CHECK `methodology_element_source_field_protected`; FE04 — this is REQ-S05-002's "attempting to delete the T03 'Gap' column is rejected") and its `fieldType`, when present, must equal the registry type (`methodology_element_source_field_type_fixed`; FE05: "change their type semantics" is refused).
  - `origin = 'admin'` is an **extension field**: its key is lowercase `^[a-z][a-z0-9_]{0,39}$`, is not a source column key of the record type, and the record type must allow extension fields (`methodology_element_extension_field_key`; FE06, FE07). It names one of the eleven field types (CHECK `methodology_element_field_type`; FE08) with the settings §3 requires (`methodology_element_field_settings`; FE09, FE10). An extension field may be removed in a draft (`removed = true`); its stored values stay in history and are no longer accepted for that version (§4).
- Element writes follow slice A: only in a draft being edited (FE16 after publish), one audit event each (FE14), lock 730250, `If-Match` on the draft. Studio edits use slice A's `putConfigElement`/`removeConfigElement` with `elementType` `form` or `form_field`; the forms kind provider (BE-D, `forms/provider.ts`, registered in `methodology/kinds.ts`) validates the attributes with the Zod schemas of §3 and maps database refusals to the §10 codes. Publish, preview, review where configured, diff, compatibility and rollback are the slice A pipeline unchanged (FE15).
- **Diff and compatibility (REQ-S06-007, REQ-S06-008).** The provider lists added, removed and changed fields as diff rows ("the diff lists the added field"); compatibility is `warn` for a new required extension field (pinned transformations stay pinned; ADR-0040's migration preview lists "new required field" from this provider) and `fail` for a calculated field whose formula does not validate.

Adding an extension field to T03 and publishing it succeeds (FE02, FE15); this is REQ-S05-002's first clause.

### 3. The eleven field types and their server-side validation (REQ-S06-005)

Pure validators and normalizers in `packages/shared/src/forms/**` (KBE-B; exported through `@mth/shared/calc`), used by the API for extension-field values and procedure inputs (ADR-0042 §2), and by the web for the same messages. Every value is stored as JSON in the shape below; decimals are **strings**, never JSON numbers.

| Type | Settings (attributes) | Accepted input → stored value | Server-side refusal (400 field code) |
|---|---|---|---|
| `text` | `maxLength` 1–2000 (default 2000) | shared `freeText` rules → string | `validation.text` |
| `rich_text` | `maxLength` 1–20000 | the DG2 sanitized rich-text subset → string | `validation.rich_text` |
| `number` | `min`, `max` (decimal strings), `scale` 0–6 | decimal string `^-?\d{1,15}(\.\d{1,6})?$` → same string, decimal.js comparison | `validation.decimal` |
| `currency` | `currencyCode` (default the transformation currency, SAR), `scale` 0–2 | `{amount: decimal string, currencyCode: ISO 4217 letters}` → same; no float on any path ("a currency field stores decimal SAR without float error") | `validation.currency_amount`, `validation.currency_code` |
| `percentage` | `min`, `max` as fractions (default 0–1) | `"12%"`, `"12"` (percent) or the fraction in the API body `"0.12"` is normalized to the **fraction string** `"0.12"` with decimal.js (`12% → 0.12`); the API body carries the fraction | `validation.percentage` |
| `date` | `min`, `max` | `YYYY-MM-DD`, a real calendar date, in the transformation timezone (default Asia/Riyadh) | `validation.date` |
| `reference` | `targetRecordType` (a `form_record_type` code) | uuid of a record of that type in the same transformation (checked in the transaction) | `validation.reference` |
| `attachment` | `maxCount` 1–20 | array of evidence uuids of the same transformation | `validation.attachment` |
| `lookup` | `lookupSet` ∈ {`users`, `roles`, `tom_dimensions`, `phases`, `gates`, `currencies`, `business_units`} | the code or id of an active member | `validation.lookup` |
| `choice` | `options[]` 1–100 of `{value, labelEn, labelAr}` | one `value` (or an array when `multiple: true`) | `validation.choice` |
| `calculated` | `expression` (1–2000), `resultUnitKind` (ADR-0037 N5) | never stored; evaluated at read with `evaluateFormula` over the record's number/currency/percentage fields | definition time: 422 `form_schema.calculated_formula_invalid` |

**Calculated fields** use the DG3 formula engine unchanged (`validateFormula`, `evaluateFormula` in `packages/shared/src/formula/**`; no file there changes). The provider validates the expression at element write with the record type's resolved numeric fields as the allowed variables; an unknown variable is refused 422 `form_schema.calculated_formula_invalid` ("a calculated field referencing an unknown field is rejected"). At read, a missing input gives **Not computable** with the missing field named, never 0 (§7).

### 4. Custom-field values (REQ-S16-010; amends ADR-0014 §4)

Extension-field values live in **`form_custom_value`** (`0068`): one row per record (`UNIQUE (record_type, record_id)`; CV12), with `transformation_id`, the `form_schema_version_id` they were validated against, `field_values` (JSON object ≤ 64 KiB), P2 stamps and `version`. Core entity columns stay typed and unchanged; no DG2–DG4 table gets a column.

*Amendment of ADR-0014 §4 (documented reason):* a side table instead of a `custom_field_values` column on each register table, because a column would put new writes on DG2–DG4 tables whose frozen-column, append-only or immutability triggers (Context 2) would refuse them or would have to be reopened. The side table is additive and keeps every DG2–DG4 trigger unchanged.

Validation happens **before persistence** in the API (`forms/custom-values.ts`, BE-D): the record type's write permission and scope; the version = `ConfigResolver.pinnedVersion(transformationId, 'form_schema')`; each key an active extension field of the record type in that version; each value validated by §3; required extension fields present; calculated fields not accepted. The database repeats the structural part as the last line of defence (trigger `form_custom_value_guard` and `p5_form_record_ref_guard`):

- the version equals the transformation's `form_schema` pin, or forms v1 when there is no pin (`form_custom_value_pinned_version`; CV01, CV09);
- every key is an `admin`, not removed `form_field` of the record type in that version (`form_custom_value_unknown_field`; CV01, CV08);
- every non-null value has its type's JSON shape: decimal strings for number and percentage, `{amount, currencyCode}` with exactly those two keys for currency, `YYYY-MM-DD` for date, a uuid for reference, an array of at most 20 items for attachment, strings for text/rich text/lookup/choice; a calculated value is refused (`form_custom_value_type_shape`; CV05, CV06, CV07); JSON null clears a value (CV15);
- the record exists in the transformation, of the right T04/T16 kind (`form_custom_value_record_ref`; CV10); record type and id never change (`form_custom_value_record_fixed`; CV11);
- P2 guards: version +1 (CV14), audit at COMMIT (CV13).

The decimal shape check proves REQ-S06-005's storage clauses at the database: `"0.12"` for 12 % and `"1500000.10"` SAR are stored and read back exactly (CV03, CV04).

**Pins.** A transformation without a `form_schema` pin resolves to forms v1 (ADR-0039 §3, "never the latest"), so every DG1–DG4 transformation keeps the DG4 forms (G04: no pin is back-filled). A transformation **created after this release** is pinned to the newest published `forms` version in its create transaction: BE-D registers a `TransformationInitializer` (port wired by BE-A in `server.ts`) that inserts the `form_schema` pin with its audit event; DG1's `createTransformation` request and response are unchanged. Moving an existing transformation to a newer forms version is a methodology migration (ADR-0040; M0155).

### 5. The common form framework (REQ-S05-001)

All operations are scoped `/transformations/{transformationId}/form-records/{recordType}/…` with `recordType` a `form_record_type` code (planned types → 422 `form_record.type_planned`), so one implementation serves every native form; the existing register routes stay byte-stable.

| Capability | Design |
|---|---|
| **Inline help** | `getTransformationFormSchema` returns, for the pinned version, every field (source and extension, ordered) with resolved labels and help in en and ar, type, settings, `required`, `protected` (source) and `extension` flags, and the form's badge. FE-C renders help beside each field and translates at render time. |
| **Validation** | Server-side: the existing register validation for source columns (unchanged) and §3/§4 for extension fields; the web runs the same pure validators for immediate messages; one form-level alert per form. |
| **Draft saving** | `form_draft` (`0068`): the author's partial request body (`payload` ≤ 256 KiB) for a new record or an existing one (with its `base_record_version`). `open → closed` (`saved` after the record write succeeded, or `discarded`); a closed draft never changes (FD05, FD06); one open draft per user and existing record (FD02); the owner is the creator (FD03); planned record types refused (FD04). Only the owner reads its drafts (others get 404). "A saved draft reopens" = `getFormDraft` returns the stored payload; when the record's version moved past `base_record_version`, the response says so (`baseChanged: true`) and the client offers the §5 conflict view. |
| **Version history** | `listFormRecordVersions` reads `audit_event` for `(record_type = table, record_id)` ordered by `seq`: each entry has `newVersion`, actor, time, action and the changed field names from `changes`. No back-fill and no new table (p5-plan §3 row 6). A new version appears in history because every register write already writes its audit event (ADR-0004). |
| **Comments** | `form_record_comment` (`0068`): append-only (FC04, FC05), body 1–4000 (free-text rules), one reply level on the same record (FC02, FC03), audited (FC06), record in the same transformation (FC07). |
| **Attachments** | Evidence links. For the twenty record types of the DG2 `evidence_link` (T01–T04, T16, charter, TOM canvas, baseline, value pool, …) the operations read and write `evidence_link` unchanged; for all other record types they use `form_record_attachment` (`0068`), which refuses the `evidence_link` types (`form_record_attachment_use_evidence_link`; FA03) so each record type has exactly one attachment place (M0150). `active → removed` with a reason (FA05, FA06), only the removal columns change (FA04), one active link per evidence and record (FA02). |
| **Permissions** | Reads: `transformation.read` in scope (and the register's own read rule where stricter). Writes: the record type's `write_permission_code` in scope, re-checked at commit time. Comments: `form_record.comment`. |
| **Bulk editing where suitable** | `bulkUpdateFormRecords`: 1–100 items `{recordId, version, sourceFields?, customFieldValues?}`, all-or-nothing in one transaction; allowed only where `form_record_type.bulk_edit_allowed` (422 `form_record.bulk_not_allowed`) and only for source columns marked `bulk_editable` (owner, due dates, impact/probability/stance, confidence; 422 `form_record.bulk_field_not_editable`). Each item goes through the register's own update function (same validation, audit and events as a single edit). Any stale item → 409 `form_record.bulk_conflict` listing `{recordId, currentVersion}` and nothing is saved. |
| **Export** | `exportFormRecords` (`text/csv` or `application/json`; at most 5000 rows, else 422 `form_export.too_large`): the source columns of `column` storage plus the extension fields of the pinned version, header labels in the requested language, decimals as strings, Unknown as an empty cell plus a `<field>_status` column (`unknown`/`not_computable`), never 0. CSV is RFC 4180 UTF-8 with BOM (Arabic in Excel). Large and formatted exports are slice F. |
| **Recoverable conflict** | Every P5 write with a stale `If-Match` returns 409 `form_record.conflict` with `currentVersion` and the current representation, so FE-C shows "theirs vs yours" and re-applies the user's changes on the current version. The DG2–DG4 register routes keep their own 409 codes; FE-C's conflict view re-reads the record with its GET on any 409 (no change to those routes). |

### 6. State machines

```text
form_draft:              open -> closed (closed_reason 'saved' | 'discarded'); closed is final
form_record_attachment:  active -> removed; removed is final
form_record_comment:     append-only (no state)
form_custom_value:       one mutable row per record; version +1 per write
form_schema versions:    the slice A machine (ADR-0039 §1), unchanged
```

### 7. Decimal and Unknown semantics

Number, currency and percentage values are decimal strings validated and compared with decimal.js and stored as JSON strings (CV03–CV05); percentages are fractions (`0.12`), shown as `12 %` at render; currency always carries its code, default the transformation currency (SAR). A field with no value is **Unknown** (blank with "Unknown" in en/ar), never 0. A calculated field with a missing or Unknown input is **Not computable** with the missing field named, never 0 or green. The export marks both (§5). Counts are integers.

### 8. Locks, events, jobs

No new lock: custom values, drafts and attachments are single rows guarded by `If-Match` and the P2 version step; comments are append-only inserts (ordering by `created_at, id`). **730255 stays reserved** (p5-plan §4 offered it for a comment thread "only if the ADR shows a need"; it shows none). Studio element writes use 730250/730251 (slice A). Outbox events (schema_version 1): `form_record.custom_values_updated` `{recordType, recordId, version}`, `form_record.commented` `{recordType, recordId, commentId}` (for slice E notifications). No job.

### 9. Authorization (permissions matrix §19)

`P5_FORMS_PROCEDURES_PERMISSIONS` (`0070`; seed test; PM01): `form_record.comment` (write: SP, TL, BO, WL, FIN, TO, KDS, TD, CM). Everything else reuses existing codes:

| Operation group | Permission | Notes |
|---|---|---|
| list record types, admin form schema | `methodology.read` | AUD reads |
| Studio field edits (slice A element operations) | `methodology.configure` (ADM_METHOD); publish `methodology.publish`; review `methodology.review` (TO, never the author) | slice A rules |
| transformation form schema, versions, comments list, attachments list, drafts list, export | `transformation.read` in scope | AUD reads; drafts: own only |
| custom values, drafts, attachments, bulk | the record type's `write_permission_code` in scope | e.g. T03 `tom.edit`, T14 `benefit.edit`, funding `funding.approve` (a business approval code, held by SP: only the approver annotates a funding decision) |
| comment | `form_record.comment` + read scope | |

AUD holds no write code here and gets 403 on every write. ADM_METHOD, ADM_TECH and ADM_ACCESS hold no business-approval or finance code (0005 trigger), configure forms only through Studio, and hold no register write permission, so a methodology admin cannot edit business records through the form framework. No SoD rule beyond the registers' own applies (comments and drafts approve nothing).

### 10. Refusal codes and English texts (exact)

| Status | Code | English text (exact) |
|---|---|---|
| 422 | `form_schema.source_column_protected` | Source columns cannot be deleted. Relabel the column or add help instead. |
| 422 | `form_schema.source_column_type_fixed` | The type of a source column cannot be changed. |
| 422 | `form_schema.extension_key_invalid` | An extension field needs a new key of lowercase letters, digits and underscores that is not a source column. |
| 422 | `form_schema.extensions_not_allowed` | This form does not take extension fields. |
| 422 | `form_schema.field_type_unknown` | Choose one of the eleven field types. |
| 422 | `form_schema.field_settings_invalid` | This field type is missing a required setting. |
| 422 | `form_schema.calculated_formula_invalid` | The calculated field's formula is invalid or refers to an unknown field. |
| 422 | `form_schema.form_fixed` | Native forms cannot be added or removed. |
| 422 | `form_record.type_planned` | This form is not available in this release. |
| 422 | `form_record.custom_field_unknown` | This field is not an extension field of this form in the version your transformation uses. |
| 422 | `form_record.custom_field_required` | Fill in the required extension fields. |
| 409 | `form_record.conflict` | This record changed since you opened it. Review the current version, then apply your changes again. |
| 422 | `form_record.bulk_not_allowed` | Bulk editing is not available for this form. |
| 422 | `form_record.bulk_field_not_editable` | This field cannot be bulk edited. |
| 422 | `form_record.bulk_too_many` | Edit at most 100 records at a time. |
| 409 | `form_record.bulk_conflict` | One of the selected records changed. Nothing was saved; reload and try again. |
| 422 | `form_export.too_large` | This export has more than 5000 rows. Narrow the filter or use a report export. |
| 422 | `form_draft.closed` | This draft is closed. Start a new draft. |
| 409 | `form_draft.open_exists` | You already have an open draft of this record. Continue it or discard it first. |
| 422 | `form_attachment.evidence_unknown` | Choose evidence from this transformation. |
| 422 | `form_attachment.already_removed` | This attachment is already removed. |
| 422 | `form_comment.parent_invalid` | A reply must answer a top-level comment on the same record. |
| 400 field | `validation.text` | Enter text within the allowed length. |
| 400 field | `validation.rich_text` | Enter formatted text within the allowed length. |
| 400 field | `validation.decimal` | Enter a number within the allowed range, with at most the allowed decimals. |
| 400 field | `validation.currency_amount` | Enter an amount with at most two decimals. |
| 400 field | `validation.currency_code` | Enter a three-letter currency code. |
| 400 field | `validation.percentage` | Enter a percentage within the allowed range, for example 12%. |
| 400 field | `validation.date` | Enter a valid date as YYYY-MM-DD. |
| 400 field | `validation.reference` | Choose an existing record of the expected type in this transformation. |
| 400 field | `validation.attachment` | Choose evidence from this transformation (at most the allowed number). |
| 400 field | `validation.lookup` | Choose an active value from the list. |
| 400 field | `validation.choice` | Choose one of the listed options. |

Missing `If-Match` → 428 and stale on non-form operations → 409 with the ADR-0007 standard codes; AUD and missing permission → 403 `auth.forbidden`; outside scope → 404.

## Alternatives considered

1. **A `custom_field_values jsonb` column on every register table (ADR-0014 §4 wording).** Rejected: new writes on DG2–DG4 tables with frozen-column, append-only or immutability triggers (`funding_decision`, `evidence`, `decision`) would need those triggers reopened; the side table needs none (§4 amendment).
2. **One form schema key per record type.** Rejected: `transformation_config_pin` is unique per `(transformation, kind)` (`0011`), so a transformation could pin only one of them; one `forms` key keeps one pin per kind and one migration path.
3. **Extension fields as typed columns created by DDL at publish.** Rejected: runtime DDL from the application role contradicts ADR-0003 (no DDL by `mth_app`) and makes rollback destructive.
4. **Refusing deletion of a source column only in the API.** Rejected: REQ-S16-010 and M0154 "protect … core data invariants" ask for the database as the last line of defence (FE04).
5. **A new attachments table for every record type.** Rejected: it would duplicate `evidence_link` for the twenty DG2 types (M0150).
6. **Adding `customFieldValues` to the existing register request bodies.** Rejected: P1–P4 paths stay byte-stable except the D-142 extensions; a separate operation is additive.

## Consequences

- Every native form gets drafts, history, comments, attachments, export, bulk edit where suitable and a recoverable conflict through one set of P5 operations; the DG2–DG4 register routes are unchanged.
- Existing transformations keep forms v1 until a migration; new ones are pinned to the newest published forms version at creation (BE-D initializer).
- `methodology_element_guard()` now also guards `form_schema` elements; every slice A rule is kept (the ARCH-01 integration suite must stay green).
- The DG4 export of a register (if any) is unchanged; the P5 export is additive.

## Verification

- **Database (probe, real output):** G00–G05, FS01–FS05, FE01–FE16, CV00–CV15, FD01–FD07, FC01–FC07, FA01–FA06, PM01 (`probe-output.txt`, 116/116 PASS with ADR-0042's probes).
- **API (implementer tests, p5-work-split §B):** T01 and T14 literal (REQ-S05-001): a saved draft reopens; after an edit, history lists the new version; a comment and an attachment persist; export returns the rows; a second save with the old `If-Match` returns the recoverable 409 with `currentVersion`. REQ-S05-002: adding an extension field to T03 publishes; deleting T03 `gap` → 422 `form_schema.source_column_protected`. REQ-S06-005: `12%` stores `"0.12"`; `1500000.10` SAR reads back exactly; a calculated field naming an unknown field → 422 `form_schema.calculated_formula_invalid`. REQ-S16-010: a value violating its schema → 400/422 before persistence and the database refuses it too. REQ-S05-006: the twelve types are created and read through the operations of §1, and their forms show the badge in en and ar. AUD 403 on every write; `If-Match` 428/409; one audit event per mutation; commit-time re-authorization.
