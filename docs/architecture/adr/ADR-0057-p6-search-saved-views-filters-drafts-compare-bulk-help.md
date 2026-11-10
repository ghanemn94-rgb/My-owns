# ADR-0057: P6 search and productivity: the search document model and index (PostgreSQL text search, en and ar), maintenance from the audit-event feed and a reindex job, `ReadScope` filtering and sensitivity; saved views; server-side register filters and sorts; server-side draft recovery; record comparison and compare-and-reapply; bulk and inline edit; breadcrumbs, contextual help and the six designed states

- **Status:** Proposed for P6 (DG6). Author: solution-architect (T-DG6-ARCH-04), 2026-10-27.
- **Requirements (slice H of `docs/architecture/p6-plan.md`):** REQ-S15-010, REQ-S15-011, REQ-S15-013, REQ-S16-026. Slice G is ADR-0058.
- **Sources (quoted where a design point has one):**
  - M0303 (§15) "Include global search with permission filtering, saved views, filter chips, breadcrumbs, bulk updates, inline editing, draft recovery, record comparison and contextual help. Clearly distinguish saved draft from submitted/approved data. Handle empty, loading, error, stale, conflict and no-permission states."
  - M0304 (§15) "Tables need sorting, filtering, pagination and column selection."
  - M0329 (§16) "Add optimistic concurrency control so simultaneous edits cannot silently overwrite one another."
  - REQ-S15-010 acceptance: "A12;A14: search as a user scoped to transformation X returns no Y records; a bulk update touching a stale record reports a conflict for that record only; a draft survives a browser reload". Procedure: "Search returns only records the user may read; lists support saved views and chips; bulk and inline edits go through the same validation, authorization and concurrency checks as single edits; unsaved drafts are recoverable".
  - REQ-S15-011 acceptance: "A14;A20: component tests render each of the six states; a draft is labelled 'Draft - not submitted' and never counted in approved totals".
  - REQ-S15-013 acceptance: "A20: on a register with 1,000 initiatives, sorting, filtering, paging and hiding a column all work, and the API returns paginated results". Procedure: "Tables use server-side pagination and filtering through the API and persist column choices in saved views".
  - REQ-S16-026 acceptance: "A14: two users edit the same initiative; the second save returns 409 and the UI offers compare and reapply without losing the first change". Procedure: "Every mutation carries the expected version; a mismatch returns 409 with the current version so the user can recover".
  - Playbook: the registers searched here are the playbook's templates (Template 5 Initiative Card B0071, Template 8 Dependency Map B0080, Template 14 Benefits Register B0122, Template 15 RAID, Template 16 Executive Decision Log), which is why those record types are indexed. The playbook names no search, saved-view, draft or comparison control, so nothing below is attributed to it.
- **Decisions applied:** D-195 (the plan; Q3 sensitivity; seams 14, 15, 16 of p6-plan §3), D-196 (migration ids advisory), D-193, D-088 §2, D-141, F-DG3-100, F-DG4-160.
- **Builds on:** ADR-0004 (audit, the `seq` column), ADR-0006 (policy), ADR-0007 §5b (statuses, If-Match, cursors), ADR-0041 §5 (P5 drafts, version history, bulk edit), ADR-0049 §3 (the `english` and `arabic` text search configurations verified on the pinned server), ADR-0051 §1–§2 (`ReadScope`, sensitivity), ADR-0052 §2 (free text, strict UTF-8) and §4 (the `search` rate-limit class), ADR-0053 §1 (service identities for jobs).
- **Physical model:** `packages/db/migrations/0108_p6_search_saved_views_help.sql`, `0109_p6_search_productivity_permissions.sql`, `0110_p6_register_filter_indexes.sql`; probe groups G, S, SD, IS, SV, HT, PM in `docs/delivery/handbacks/DG6/T-DG6-ARCH-04-evidence/probe-output.txt` (71/71 PASS).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Searching, saving a view, recovering a draft, comparing versions or reading help approves nothing; no G1–G6 business approval is involved.

## Context

1. As read at `HEAD` `5e4cbad`: no global search exists. `GET /api/v1/methodology/search` (P5, the playbook reader) and `GET /api/v1/lessons/search` (P4) search one domain each. `grep search_document packages/db/migrations/00*.sql` finds only `lesson.search_document` (`0048`), a generated `tsvector` column of the lesson table.
2. P5 already delivers, for every form record type with a working table (`form_record_type`, `0068`): server-side drafts (`form_draft`, routes `listFormDrafts` … `closeFormDraft`, `forms/drafts.ts`), version history from the audit trail with **changed field names only, never values** (`listFormRecordVersions`, `forms/history.ts`), and bulk edit (`bulkUpdateFormRecords`, `forms/bulk.ts`) that is **all-or-nothing**: "any stale item is 409 form_record.bulk_conflict, listing every stale item as an error at `/items/<i>/version` with the record id and its current version, and NOTHING is saved".
3. `listInitiatives` returns a fixed order (`updatedAt` desc, `id` desc) with the filters `status` and `waveId`; the 9 register-kit lists (`transformations/register-kit.ts`: strategic guardrails, outcomes, diagnostic items, diagnostic findings, workstream outputs, TOM gaps, capability heatmap, journeys, journey pain points) order by `id` in the code (`register-kit.ts` `orderBy("id")`) with `includeArchived` only, while their contract response descriptions say "newest change first (`updatedAt` desc, `id` desc)" (a DG2 description discrepancy, not changed here and raised in the handback); `listTransformations` has filters (`organizationId`, `businessUnitId`, `status`, `mode`, `phase`, `q`) and a fixed order. `components/DataTable.tsx` keeps column visibility per browser.
4. Every mutation writes exactly one `audit_event` row in the same transaction, with `record_type` = the table and `record_id` (the deferred `*_audit_required` constraints of ADR-0004/ADR-0016 refuse a commit without it), and `audit_event.seq` is a `GENERATED ALWAYS AS IDENTITY` column (`0003`).
5. ADR-0051 §1 gives `ReadScope.predicate(cols)` (SQL) and `admits(row)` (memory), both = the ADR-0006 policy plus the sensitivity clause, proven equal to the record view by the parity test.

## Decision

### 1. The search document (REQ-S15-010, REQ-S10-004)

`search_document` (`0108`) holds one **derived** row per indexed record, for exactly 12 record types (the closed set of `p6_search_record_type_valid`): `transformation`, `initiative`, `kpi_definition`, `benefit`, `raid_entry`, `dependency`, `decision`, `deliverable`, `evidence`, `business_case`, `lesson`, `change_request`.

Fields: `organization_id`, `transformation_id` (both copied from the record's immutable columns; for a transformation its own id, `search_document_transformation_self`), `record_type`, `record_id`, `record_version`, `code`, `title` (1–500), `summary` (≤ 1000), `record_status`, `is_archived`, `source_audit_seq` (the audit sequence the document reflects), the stored generated `search_en`, `search_ar` and `search_simple` (`to_tsvector('english' | 'arabic' | 'simple', code ‖ title ‖ summary)`) with one GIN index each, `version`, `created_at`, `updated_at`.

What each type contributes (the index job, BE-P, reads exactly these columns; free text through the shared `truncateText`):

| Record type | `code` | `title` | `summary` | `is_archived` when `status` = (`record_status` = the row's `status`) |
|---|---|---|---|---|
| transformation | `code` | `name` | `description` | — (`is_archived` = `archived_at IS NOT NULL`; the transformation has no archived status) |
| initiative | `code` | `name` | `objective` | — (never) |
| kpi_definition | NULL | `name` | `description` | `archived` |
| benefit | `code` | `title` | `description` | `archived` |
| raid_entry | `code` | `description` (first 500 characters) | NULL | — |
| dependency | `code` | `description` (first 500 characters) | NULL | `archived` |
| decision | `code` | `title` | `context` | — |
| deliverable | NULL | `title` | `description` | `archived` |
| evidence | NULL | `title` | `description` | `archived` |
| business_case | `code` | `title` | NULL | `archived` |
| lesson | `code` | `title` | `context` | `archived` |
| change_request | `code` | `reason` (first 500 characters) | NULL | `withdrawn` |

**No numeric value is indexed:** no money, rate, FTE, KPI or score column of any type is read by the index job, so a search hit can never disclose an individual value (D-195 Q3). **Database invariants** (probe): one document per record (`search_document_record_key`, SD07); only the 12 types (SD08); the organization equals the transformation's (`p2_row_guard`, SD10); the record identity never changes (`search_document_identity_fixed`, SD06); a document never goes back to an older `source_audit_seq` or `record_version` (`search_document_monotonic`, SD04, SD05), so a replayed or reordered feed event cannot overwrite a newer document; the version steps by exactly 1 (`search_document_version_step`, SD02, SD03).

**Not audited, by design.** A document is a rebuildable copy. The source record's own write is the audited event; auditing every index write would double the audit volume for no evidential value. The table is version-stepped but has no `*_audit_required` trigger (the `worker_heartbeat` precedent, `0101`). Writers: the worker search handlers only; `mth_app` holds SELECT, INSERT, UPDATE, DELETE (a removed record's document is deleted, SD11).

**Text search configuration (verified on the pinned server).** Probe S01: PostgreSQL 16.13 lists `english`, `arabic` and `simple` in `pg_ts_config` (as ADR-0049 §3 found). Probe S02: `websearch_to_tsquery('english', 'initiative tower')` finds "Synthetic network initiatives roll-out … Upgrade towers"; `websearch_to_tsquery('arabic', 'تحسين')` finds "مبادرات تحسين تجربة العملاء"; `websearch_to_tsquery('simple', 'ini-02')` finds code `INI-02`. The Arabic Snowball stemmer is light: `to_tsvector('arabic', 'مبادرات تحسين')` = `'تحسين':2 'مبادرا':1` (S02 output), so an Arabic plural and its singular are not always matched. That is the stated limit of the shipped configuration; no extension and no dependency is added (Alternatives 1).

### 2. Index maintenance: the audit-event feed, a feed job and a reindex job

- **The feed is the audit trail.** `audit_event` is written in the same transaction as every change (Context 4), so it is a transactional outbox that already covers every DG1–DG5 write path. Writing new `outbox_event` rows instead would change every write path of 12 record types (a DG1–DG5 code change, p6-plan R1). This is a deliberate refinement of p6-plan §4's "maintenance by outbox": the feed is the audit outbox, read by sequence. `0110` adds `audit_event_feed_idx` (`seq` INCLUDE `record_type, record_id`, partial on the 12 types).
- **`search.index_feed`** (BE-P; `apps/worker/src/handlers/search.ts`; a `job_schedule` row in BE-P's migration, cron `* * * * *`, `owner_module` `search`): per record type, under advisory lock 730318 (key = the record type), read up to 500 audit events with `seq > search_index_state.last_audit_seq` in `seq` order; for each distinct record, read its current row; upsert the document with `source_audit_seq` = the record's highest `seq` in the batch, or delete the document when the row no longer exists; then advance `last_audit_seq` to the batch's highest `seq` and set `last_incremental_at`, in the same transaction. Replaying a batch changes nothing (the upsert is keyed by record and the monotonic guard refuses older content): exactly once by construction.
- **`search.reindex`** (BE-P; a second `job_schedule` row, enabled, cron `30 2 * * 0`): run weekly and on demand through the P5 `runJobNow` (`POST /api/v1/admin/jobs/search.reindex/run`, `job.repair`, ADM_TECH; no new operation). Per record type under lock 730318: capture `S0` = the current maximum audit `seq`; set `status = 'reindexing'`, `last_audit_seq = 0`, `reindex_started_at` (the only backward move `search_index_state_guard` allows, IS02, IS03); upsert a document for every row in `id` order in batches of 500 with `source_audit_seq = greatest(existing, S0)`; delete the documents of that type not written in this run; set `last_audit_seq = S0`, `status = 'idle'`, `reindex_finished_at`, `documents_count`. A failure sets `status = 'failed'` with `last_error_code` and `last_error_at` (`search_index_state_failed_coded`, IS04); the next run starts over.
- **Service identity.** Both job codes act as a service identity declared by BE-P under ADR-0053 §1: organization scope, the read permissions of §3 for the 12 types, no write right outside `search_document` and `search_index_state`. Indexing must read sensitive benefits, business cases and evidence (ADR-0051 §2 says a job never reads a sensitive record "unless ADR-0053 declares an explicit exception for that job code"): this ADR **declares that exception** for `search.index_feed` and `search.reindex`, restricted to the columns of the §1 table. It is safe because nothing is filtered at index time: every reader is filtered at query time (§3), and no value column is indexed. BE-P's per-job test proves the declared scope (ADR-0053 Q13 rule). **As shipped (T-DG6-BE-P §5 items 1 and 5):** the document builders are in `apps/worker/src/search/documents.ts`, not under `apps/api/src/modules/search/`, because only the worker handlers write `search_document` and the worker imports no API code (ADR-0002 rule 5); the API's query reads `search_document` directly. The two identities are seeded by `0115_p6_search_index_jobs.sql` with `sensitive_access = 'none'`, because the `0101` CHECK allows only `none | aggregate_only` and `aggregate_only` would admit sensitive rows into aggregates. The exception is stated in each row's `reason`, and it is enforced in code by `SEARCH_SENSITIVE_READ_EXCEPTION`, which admits sensitive rows only for these two job codes and only through the §1 column reads. Showing the exception as data (a value such as `index_columns` in the CHECK) would need a later migration and is not in P6.
- **Freshness (REQ-S15-011 "stale").** `searchRecords` returns `indexedThrough` (the oldest `last_incremental_at` of the requested types, null if any is null) and `stale` = true when any requested type is `reindexing` or `failed`, or `indexedThrough` is older than 120 seconds. The UI then shows the designed stale state above the results; results are never hidden or shown as empty because the index is behind.

### 3. The query and its permission filter (REQ-S15-010 "Search returns only records the user may read")

`GET /api/v1/search` (`searchRecords`; module `search`; rate-limit class `search` of ADR-0052 §4): `q` (2–200 characters after trimming, shared free-text rules, strict UTF-8), `recordType` (repeatable, the 12), `transformationId` (optional), `includeArchived` (default false), `cursor`, `limit`.

- **Match:** `search_en @@ websearch_to_tsquery('english', q) OR search_ar @@ websearch_to_tsquery('arabic', q) OR search_simple @@ websearch_to_tsquery('simple', q)`. **Order:** relevance (`ts_rank_cd` over the three vectors, as an integer `floor(rank × 1,000,000)`, so the cursor carries no float), then `record_type`, then `record_id`; the cursor is the keyset of these three and is bound to `q` and the filters (`filterHash`, ADR-0007).
- **Permission filter, at query time, never at index time (p6-plan R2):** the query joins `transformation` (for the transformation code and name of each hit) and applies `ReadScope.predicate` for the **read permission each type's record view checks**, with `recordType` set for `benefit`, `business_case` and `evidence` (the ADR-0051 §2 sensitive types) and `partyUserIds` taken from a `LEFT JOIN` of the **live** source row (the §2 named parties: `owner_user_id`, `finance_validator_user_id`, `created_by` for benefit; `benefit_owner_user_id`, `initiative_owner_user_id`, `finance_validator_user_id`, `created_by` for business case; `owner_user_id`, `created_by` for evidence). A grant revoked or a scope removed after indexing applies to the next request, because no permission data is copied into the document. **Parity rule (BE-P):** for each of the 12 types and every reader of the BE-B parity fixture, a document is returned iff the record's own GET returns 200; the permission per type is the one that GET checks, and the test fails if they differ.
- **Response item:** `recordType`, `recordId`, `recordVersion`, `transformationId`, `transformationCode`, `transformationName`, `code`, `title`, `summary` (plain text, no markup; highlighting is done by the client on the query terms), `recordStatus`, `isArchived`. Page: `items`, `nextCursor`, `indexedThrough`, `stale`.
- A user scoped to transformation X therefore never receives a document of transformation Y (the A12 assertion of REQ-S15-010; QA-B).

### 4. Saved views (REQ-S15-010 "saved views", REQ-S15-013 "persist column choices in saved views")

**Entity** `saved_view` (`0108`): `organization_id`, `owner_user_id` (= `created_by`, `saved_view_owner_is_creator`), `list_key` (12 lists, closed CHECK: `transformations`, `initiatives`, `strategic_guardrails`, `outcomes`, `diagnostic_items`, `diagnostic_findings`, `workstream_outputs`, `tom_gaps`, `capability_heatmap`, `journeys`, `journey_pain_points`, `search`), `transformation_id` (optional; NULL = the view applies in every transformation; always NULL for `transformations`, `saved_view_cross_transformation_lists`), `name` (1–120), `visibility` (`personal` | `shared`), `columns` (JSON array of 1–50 distinct camelCase keys), `filters` (JSON object of ≤ 20 camelCase keys, each value a string of 1–200 characters or an array of 1–20 such strings), `sort` (JSON array of ≤ 3 `{key, direction: asc|desc}`, keys distinct), `is_default`, `shared_at`, `shared_by`, `status`, `deleted_at`, `version`, stamps. History `saved_view_event` (trigger-written, append-only).

**State machine:** `active` → `deleted` (terminal; `saved_view_transition`, `saved_view_final`). Visibility `personal` ⇄ `shared` while active.

**Database invariants** (probe SV): only the owner changes or shares a view (`saved_view_owner_only`, SV13, SV16); owner, list and transformation never change (`saved_view_identity_fixed`, SV14); the view, its owner and its transformation are in one organization (`saved_view_organization_matches`, SV20, SV21); one active view per owner, list, transformation and case-insensitive name (`saved_view_name_key`, SV11); one default per owner, list and transformation (`saved_view_one_default_key`, SV12); a deleted view is never the default (SV23); sharing records who and when (`saved_view_shared_shape`, SV15); JSON shapes (SV05–SV10); audit at COMMIT (SV03); version step (SV04); history append-only (SV28, SV29); no physical DELETE for `mth_app` (SV30).

**The list registry.** `packages/shared/src/saved-views.ts` (BE-Q; imported by API and web) declares, per `list_key`, the column keys, the filter keys with their value format (UUID, enum member, ISO date, decimal string), and the sort keys the list offers (for the API lists, exactly the parameters of §5). The API refuses a view naming any other key with 422 `saved_view.unknown_key`. A view saved before a list dropped a key is still returned; the client drops the unknown key and shows the notice text of §10.

**Operations** (`search/saved-views.ts`, BE-Q): `listSavedViews` (`?listKey=&transformationId=`: the caller's active views plus the active shared views of the caller's organization for that list; AUD included), `createSavedView`, `getSavedView` (owner, or anyone in the organization if shared; else 404), `putSavedView` (owner; If-Match; setting `isDefault` clears the owner's previous default for that list and transformation in the same transaction), `deleteSavedView` (`DELETE`, owner, If-Match; returns the deleted view), `shareSavedView` (`POST …/share` `{shared: boolean}`, owner, If-Match, lock 730319; `shared: true` needs `saved_view.share` re-checked at commit time; `shared: false` needs only ownership). Each write: authorization at commit, validation, If-Match (428 missing, 409 stale with `currentVersion`), one audit event (`saved_view.created`, `.updated`, `.deleted`, `.shared`, `.unshared`), no remote I/O.

**A view grants no data.** Applying a view sets the list's query parameters; the list is filtered by its own read rules as before. A shared view whose transformation the reader cannot read is not listed for that reader.

**Column choices move to saved views (p6-plan §3 row 14).** `DataTable` (FE-D) reads the old per-browser choice once, as the unsaved initial state of the list, and stores choices only in saved views from then on; no DG behaviour is lost.

### 5. Server-side filters and sorts on register lists (REQ-S15-013; no new operation)

Optional query parameters, each absent by default; **an absent parameter returns exactly today's result and order**:

| Operation | New parameters |
|---|---|
| `listInitiatives` | `q` (code or name, case-insensitive substring, 1–200), `executiveOwnerUserId`, `workstreamLeadUserId`, `sort` ∈ {`-updatedAt` (today's order), `updatedAt`, `code`, `-code`, `name`, `-name`, `plannedEnd`, `-plannedEnd`} |
| `listTransformations` | `sort` ∈ {`-updatedAt`, `updatedAt`, `code`, `-code`}; absent = today's order |
| the 9 register-kit lists (`listStrategicGuardrails`, `listOutcomes`, `listDiagnosticItems`, `listDiagnosticFindings`, `listWorkstreamOutputs`, `listTomGaps`, `listCapabilityHeatmapEntries`, `listJourneies`, `listJourneyPainPoints`; the operation ids as they are in the contract) | `q` (case-insensitive substring over the text columns the spec declares in a new `RegisterSpec.searchColumns`), `sort` (a key of the new `RegisterSpec.sortColumns`, optionally prefixed `-`; absent = today's `id` order) |

Rules: pagination stays cursor-based; with `sort` the cursor is the keyset `(sort value, id)`; the cursor is bound to every filter and the sort through `filterHash`, so a cursor from another filter is 400 (the existing `decodeCursor` behaviour). An unknown `sort` value is 400 at `/query/sort`. Nulls sort last ascending and first descending. `0110` adds the indexes for the initiative and transformation sorts and owner filters (`initiative_owner_idx`, `initiative_lead_idx`, `initiative_code_sort_idx`, `initiative_name_sort_idx`, `initiative_planned_end_sort_idx`, `transformation_code_sort_idx`, `transformation_updated_sort_idx`; probe G05). Other register lists (benefits, RAID, KPIs, decisions, dependencies, deliverables) keep their DG2–DG5 filters, pagination and fixed documented order in P6 (handback, raised).

**Filter chips** (FE-D, `components/filter-chips/**`): one chip per active filter parameter, with a remove control; the chip label is the filter's translated name and value (render-time translation, en/ar).

### 6. Draft recovery (REQ-S15-010 "unsaved drafts are recoverable"; REQ-S15-011 "Draft - not submitted")

- **One draft model.** The P5 `form_draft` (`0068`) is the server-side draft for every form record type with a working table. P6 adds **no new draft table** and no draft write path, and lock class 730320 stays unallocated (§10).
- **New read:** `listMyFormDrafts` `GET /api/v1/me/form-drafts` (BE-Q, `forms/drafts.ts` read lines): the caller's **open** drafts across transformations, newest first, each with `transformationId`, `transformationCode`, `transformationName`, `recordType`, `recordId`, `baseRecordVersion`, `baseChanged`, `updatedAt`, `version`; drafts in a transformation the caller can no longer read (`ReadScope`, `transformation.read`) are left out of the list and are not changed. Cursor-paginated.
- **Recovery flow (FE-D, `components/draft-recovery/**`):** an editor of a form record autosaves its body with `createFormDraft` then `updateFormDraft` (If-Match) at most every 10 seconds and on blur; on opening an editor, the client asks `listFormDrafts` for that record and offers "Restore draft" or "Discard"; `baseChanged` shows the conflict state (ADR-0041 §5). The draft is on the server, so a browser reload or cleared browser storage loses no draft (the e2e of REQ-S15-010; REQ-S02-006).
- **Labelled and never counted.** A draft shows the badge "Draft - not submitted" (REQ-S15-011, exact text). `form_draft` is read only by `forms/drafts.ts`; BE-Q adds a static test that no other API module and no reporting or dashboard query selects from `form_draft`, so a draft cannot enter an approved total.
- **Scope of P6 draft recovery:** the form-record editors. Other editors (for example KPI actual entry, which has its own DG4 statuses) keep their DG behaviour; this is stated, not claimed (handback, raised).

### 7. Record comparison and compare-and-reapply (REQ-S15-010 "record comparison"; REQ-S16-026)

**Compare-and-reapply needs no new endpoint.** Every PATCH already answers 409 with `currentVersion` (ADR-0007). FE-D's `components/compare/**` and the `useVersionedSave.ts` lines do a three-way comparison in the client: B = the record as loaded (kept with its ETag), M = the user's edited values, C = the current record from a fresh GET. "My changes" = fields where M ≠ B; "their changes" = fields where C ≠ B; a field in both is a conflict. The screen lists the three groups field by field (en/ar labels). **Reapply** sends a PATCH with If-Match = C's version containing only "my changes", with each conflicting field resolved by the user (mine or theirs). Fields only they changed are never sent, so the first change stays intact (the A14 assertion; QA-C).

**Version comparison** `compareFormRecordVersions` `GET /api/v1/transformations/{transformationId}/form-records/{recordType}/{recordId}/compare?fromVersion=&toVersion=` (BE-Q, `forms/compare.ts`): `toVersion` > `fromVersion` ≥ 1, both ≤ the current version (else 422 `form_record.compare_versions_invalid`). Built from the audit trail (no new table): for every audit event of the record with `new_version` in (`fromVersion`, `toVersion`], the `changes` object is folded per field, keeping the first `from` and the last `to`. Only fields the record's resolved form shows are returned. Each field: `fieldKey`, `label` (en, ar), `changed` (true), and `from`/`to` values **only for a caller who holds `audit.read` in scope** (D-199 item 6, the `audit.read`-only variant; amended 2026-10-30 by T-DG6-ARCH-07 from T-DG6-BE-Q2 §5 item 2). Every other reader, including an editor of the record type, gets `valuesWithheld: true` and field names only. That is the rule `listFormRecordVersions` already applies (its header in `apps/api/src/modules/forms/history.ts`: "a reader of a form is not an auditor: `audit.read` stays the only way to see before/after values"), so the DG5 rule is not widened. A field changed by a write whose audit event recorded no diff for it is reported with `recorded: false` (Unknown), never guessed. Sensitive records follow ADR-0051 (no admission → 404 as for the record).

### 8. Bulk and inline edit (REQ-S15-010 "go through the same validation, authorization and concurrency checks as single edits")

- **Bulk:** the DG5 `bulkUpdateFormRecords` is unchanged (p6-plan §3 row 15 asked which it is: it is all-or-nothing). It already reports a conflict **for each stale record only**: the 409 `form_record.bulk_conflict` problem lists one error per stale item at `/items/<i>/version` with that record's id and current version; non-stale records are not listed, and nothing is saved. That is how this ADR reads the acceptance "a bulk update touching a stale record reports a conflict for that record only" (the A14 proof: three items, one stale, the problem names only the stale one, and all three versions are unchanged). The UI (FE-D) then reloads the stale record, offers compare (§7) and lets the user resubmit. No per-record partial-commit mode is added in P6 (Alternatives 4; raised in the handback with an additive option).
- **Inline edit** (FE-D, `components/inline-edit/**`): a cell edit is one PATCH of that record through its existing route, with If-Match from the row's ETag, so validation, authorization at commit, audit and the 409 path are the single edit's. A 409 shows the conflict state in the row and opens compare (§7).

### 9. Breadcrumbs, contextual help and the six designed states

- **Breadcrumbs** (FE-D, `components/breadcrumbs/**`): built in the client from the route and the names the page has already loaded (area → transformation → register → record). No API. In Arabic the trail runs right to left (`dir="rtl"`); record codes stay LTR-isolated (`<bdi>`).
- **Help topics** `help_topic` (`0108`, 11 seeded topics on 5 screens): `listHelpTopics` `GET /api/v1/help-topics?screenKey=` and `getHelpTopic` `GET /api/v1/help-topics/{topicKey}` (BE-Q, `search/help-topics.ts`; any signed-in user; read-only). Each topic carries `titleEn`, `titleAr`, `bodyEn`, `bodyAr`, `arabicProvisional` (true for all 11) and `sourceRefs`. The Arabic of every seed ends with "(ترجمة مؤقتة)" (probe HT01). The English texts are product help written for this release, true for P6 (F-DG4-160); none claims PMI or any certification (HT01).
- **The six states (REQ-S15-011):** `components/States.tsx` keeps empty, loading, error and no-permission and gains **stale** (data older than its refresh rule, or a stale search index: "This information may be out of date. Last updated {time}.") and **conflict** ("Someone else saved this record after you opened it. Compare the changes before saving again."); one component test renders each of the six in en and ar (FE-D).

### 10. Authorization, advisory locks, refusal codes

**Permissions (`0109`; permissions matrix §27):**

| Action | Permission | Role defaults | AUD |
|---|---|---|---|
| `searchRecords` | the read permission of each record type's own view, through `ReadScope` | every reader, per record | reads (in its scope) |
| `getSearchIndexStatus` | `operations.read` (ADR-0053) | as `0103` | as `0103` |
| reindex | `job.repair` through `runJobNow` | ADM_TECH | no |
| `listSavedViews`, `getSavedView` | signed in; own views and the organization's shared views | everyone | reads and applies |
| `createSavedView`, `putSavedView`, `deleteSavedView`, unshare | `saved_view.manage` (own views only) | the 13 roles other than AUD | 403 |
| share | `saved_view.share` (own views only) | TL, BO, WL, TO, KDS, TD | 403 |
| `listMyFormDrafts` | signed in; own drafts, `transformation.read` per draft | everyone | sees its own (it can create none: P5 drafts need the record type's write code) |
| `compareFormRecordVersions` | `transformation.read`; values need `audit.read` (D-199 item 6) | per record type | field names; values with `audit.read` |
| `listHelpTopics`, `getHelpTopic` | signed in | everyone | reads |

Technical administrators (ADM_TECH, ADM_ACCESS, ADM_METHOD) get `saved_view.manage` only; neither code is a business-approval or Finance-validation code (REQ-S10-003; probe PM01, PM04). No separation-of-duties rule applies: nothing here approves.

**Advisory locks (ADR-0016 §6):** 730318 `searchReindex` (key `<recordType>`), 730319 `savedViewShare` (key `<savedViewId>`); 730320–730322 reserved for this block (730320 is not needed: the P5 unique index `form_draft_open_record_key` serializes drafts and P6 adds no draft write).

**Refusal codes** (problem+json; English verbatim; Arabic provisional, in `i18n/{en,ar}/problems.json` by FE-A):

| Code | Status | English text |
|---|---|---|
| `search.query_too_short` | 400 | "Enter at least 2 characters to search." |
| `saved_view.unknown_key` | 422 | "This view uses a column, filter or sort that the list does not offer: {key}." |
| `saved_view.name_taken` | 409 | "You already have a view with this name for this list." |
| `saved_view.not_owner` | 403 | "Only the person who created this view can change it." |
| `saved_view.deleted` | 409 | "This view was deleted." |
| `saved_view.default_conflict` | 409 | "Another view was made the default for this list at the same time. Reload the list and try again." |
| `form_record.compare_versions_invalid` | 422 | "Choose two different versions of this record, the older one first." |

**Codes added after this table was pinned (T-DG6-ARCH-07, 2026-10-30).** The web catalogue tests read the rows above verbatim and pin their number, so later codes are listed here instead of as rows. Folding them into the table is for the owner of those tests. Each code below is emitted by the shipped API, and its en/ar texts are in the web catalogue (Arabic provisional):
- `validation.transformation_not_allowed` (400, pointer `/transformationId`): on `createSavedView` with `listKey = transformations` (T-DG6-BE-Q). API detail: "A view of the transformations list applies to every transformation; leave transformationId empty." Web text: "A view of the transformations list applies to every transformation; leave the transformation empty."

| `search.index_unavailable` | 503 | "Search is not available right now. Try again later." (every requested type `failed`) |

Client notice (not a problem code): "Some settings of this view are no longer available and were ignored." The DG5 codes reused unchanged: `form_record.conflict`, `form_record.bulk_conflict`, `form_draft.open_exists`.

### 11. Decimal and Unknown semantics

- No money, rate, FTE, KPI or score value is stored in `search_document`, `saved_view` or `help_topic`. Filter values in a saved view are strings (`p6_saved_view_filters_valid`); a decimal filter value travels as a decimal string and is parsed by the list's own decimal rules.
- `search_index_state.documents_count` is NULL until a reindex counts it and renders "Unknown", never 0. A stale or failed index renders the stale state, never an empty result. A compare field without a recorded diff is `recorded: false` (Unknown), never a guessed value.

## Alternatives

1. **`pg_trgm`, `unaccent` or an external search engine (OpenSearch, Meilisearch).** Rejected: a new extension or a new runtime service; the three shipped configurations meet the acceptance, and the Arabic stemming limit is stated (§1).
2. **New `outbox_event` emits from every write path.** Rejected: it changes 12 record types' DG1–DG5 write code; the audit trail is already a transactional change feed (§2).
3. **Filter by permission at index time (per-user or per-role documents).** Rejected: a revoked grant would leak until reindexed (p6-plan R2); query-time `ReadScope` applies it on the next request.
4. **A per-record partial bulk commit.** Not adopted in P6: the DG5 response already names only the stale records, and a partial commit changes the DG5-approved all-or-nothing behaviour of `bulkUpdateFormRecords` (a reopen candidate). An additive opt-in (`mode: per_record`) is described in the handback for the orchestrator.
5. **A generic `drafts` table for every editor.** Rejected for P6: two draft models for form records would break "one canonical record"; non-form editors are listed as not covered (§6).
6. **Server-side three-way merge.** Rejected: the client already holds B and M; the server holds only C and the audit diffs.

## Consequences

- `0108`: 6 tables (`search_document`, `search_index_state`, `saved_view`, `saved_view_event`, `help_topic`, `load_dataset_marker` of ADR-0058), 4 validation functions (`p6_search_record_type_valid`, `p6_saved_view_columns_valid`, `p6_saved_view_filters_valid`, `p6_saved_view_sort_valid`), 5 trigger functions (`search_document_guard`, `search_index_state_guard`, `saved_view_guard`, `saved_view_history`, `load_dataset_marker_guard`), 12 seeded index states, 11 seeded help topics. `0109`: 2 permission codes, 19 role links. `0110`: 8 indexes.
- No DG1–DG5 table, column, constraint, trigger, row, route response or text changes (probe G04: initiatives and transformations byte-identical, audit count unchanged). The contract adds optional query parameters to 11 existing list operations (D-195 seam 14) and 13 operations.
- New strings: the problem texts above, the stale and conflict state texts, the help topics, and the FE catalogues of FE-D.
- Residual: the Arabic stemming limit (§1).

## Verification

- `probe-output.txt` (71/71 PASS, exit 0): G00–G05, S01–S02, SD01–SD12, IS01–IS06, SV01–SV30, HT01–HT04, PM01–PM04 (and LM01–LM07 of ADR-0058).
- `catalogue.test.ts` "0108: the P6 slice H/G guards are attached", the mutable-table and privilege pins; `seed.test.ts` "0109 seed equals the P6 part of permissions.ts (slices H and G)".
- Implementer tests (`p6-work-split.md` §H/G): BE-P the feed and reindex idempotence, the 12-type parity test and the A12 scoped search; BE-Q saved-view, share, compare and drafts route tests with one audit event per write and AUD 403; BE-R the 1,000-initiative filter, sort and paging API test; FE-D the six-state component test, the draft-reload e2e and the compare-and-reapply e2e; QA-B (A12) and QA-C (A14).
