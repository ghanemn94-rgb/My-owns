# ADR-0055: P6 connector framework: connectors and append-only configuration versions, credentials as `SecretRef`s, field mappings, source ids and cadence, IntegrationRun with counts, retries and reconciliation, the local test adapter, graceful degradation with actionable errors, guarded outbound writes, the deliverable external-change confirmation, and the S16-022 entity group

- **Status:** Proposed for P6 (DG6). Author: solution-architect (T-DG6-ARCH-03), 2026-10-26.
- **Requirements (slice B of `docs/architecture/p6-plan.md`):** REQ-S01-005, REQ-S16-022, REQ-S17-001, REQ-S17-005, REQ-S17-006. Slice A (imports and webhooks) is ADR-0056.
- **Sources (quoted where a design point has one):**
  - M0080 (§1) "The application coordinates business change; it must not imply that a customer system, network upgrade, procurement transaction or other external operational change has happened merely because a task was marked complete. Capture verified evidence or receive a confirmed integration result."
  - M0328 (§16) "FormSchemaVersion, AutomationRuleVersion, Job, Notification, IntegrationRun, ReportSnapshot and AuditEvent."
  - M0329 (§16) "Use canonical reference links, uniqueness constraints, required ownership and explicit status transitions. … Add optimistic concurrency control so simultaneous edits cannot silently overwrite one another."
  - M0334 (§17) "Provide a connector framework with configured credentials, field mappings, source IDs, cadence, last success, reconciliation, errors and retry history."
  - M0335 (§17) "Build working local test adapters and contract tests. List enterprise endpoints and credentials that IT must supply. Do not claim a live integration exists until it has been authenticated and tested. Core workflows must work with native forms and controlled imports while a connector is unavailable. Downstream operational write actions need explicit permission, idempotency and confirmed results."
  - M0239 (§12) "Connector/job fails or data becomes stale | Create a visible operational exception; retain last known values with freshness labels" (ADR-0053 §2 owns the exception).
  - M0386 (§20, A17) "Invalid rows are isolated, duplicates detected, valid rows committed with provenance; unavailable connector shows an actionable error".
  - Acceptance texts (binding, quoted in full in §1–§7 where each is met).
  - Playbook: the traceability chain "Diagnosed issue → Target-state gap → Initiative → Deliverable → Capability change → KPI movement → Benefit" (B0070) is why a deliverable's external change matters for the chain; Template 2 (B0049/B0050) gives every KPI an "Owner", which is the user an automatic commit acts on behalf of (ADR-0056 §6). The playbook names no connector, integration or downstream-write control, so nothing below is attributed to it.
- **Decisions applied:** D-195 (Q12 "creates" = the API mutation that produces the entity; Q13 application-enforced service identities; Q14 downstream writes only as connector-defined actions on the test adapter, no live downstream write claimed; R3), D-196 (migration ids), D-197 §3 (an active connector exception does not force a KPI to `stale`), D-193, D-088 §2, D-141, F-DG3-100, F-DG4-160.
- **Builds on:** ADR-0003/0004 (ids, optimistic concurrency, audit), ADR-0006 (policy), ADR-0008 and ADR-0025 (jobs, the kit, retries), ADR-0016 (P2 guards, lock registry), ADR-0018 (evidence review), ADR-0021/0031 (deliverables), ADR-0028 (KPI freshness), ADR-0043 (failure queue), ADR-0051 §1 (`ReadScope`), ADR-0052 §5 (`SecretProvider`, `SecretRef`), ADR-0053 §1–§2 (service identities, operational exceptions).
- **Physical model:** `packages/db/migrations/0104_p6_connectors_runs_outbound_writes.sql`, `0106_p6_deliverable_external_change.sql`, `0107_p6_integrations_permissions.sql`; probe groups G, CN, IR, OW, DX, PM in `docs/delivery/handbacks/DG6/T-DG6-ARCH-03-evidence/probe-output.txt`.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Confirming an external change approves nothing; no permission here is a business-approval or Finance-validation code.

## Context

1. No connector framework exists. `grep -ri "integration_run\|connector" packages/db/migrations/00{01..97}*` finds only `0101`'s forward reference (`service_identity.connector_id`, "its foreign key is added by ADR-0055's migration").
2. KPI actuals are entered by form through the DG4 submission path (`kpi/actuals.ts`, ADR-0027/0028): draft → submitted → accepted | rejected, with the review route's separation of duties. This path is the fallback REQ-S17-005 names ("a KPI actual can still be submitted by form").
3. Deliverables (`0020`) carry a DG3 acceptance (`/deliverables/{id}/acceptance`: pending → submitted → accepted | rejected). Tasks (`action_item`, DG4 work items) complete independently. Neither records whether an external operational change happened.
4. Evidence (`0012`) has `review_status` `unverified | verified | rejected`; `evidence_filename_never_verified` makes a `file_reference` (a filename-only link) never verified, and `evidence_verified_rule` requires an accessible item reviewed by someone other than its creator.
5. The S16-022 entities other than IntegrationRun already exist (FormSchemaVersion `methodology_version` rows of key `forms`, pinned per transformation by `transformation_config_pin` rows of kind `form_schema`, `0011`/`0063`/`0068`; AutomationRuleVersion `automation_rule_version`, `0074`; Job `pgboss.job` with `job_schedule` and `job_run`, `0004`/`0074`; Notification `inbox_notification`, `0028`; ReportSnapshot `report_snapshot`, `0080`; AuditEvent `audit_event`, `0003`). The ERD's §2.12 table names `form_schema_version` and `notification` do not exist; this ADR corrects the ERD rows (§7).

## Decision

### 1. Connectors and configuration versions (REQ-S17-001)

**Entity `connector`** (`0104`): `id`, `organization_id`, `code` (UNIQUE per organization, `^[a-z][a-z0-9_-]{1,62}$`), `name_en`, `name_ar`, `adapter_kind` (`test_adapter` | `webhook` | `http_pull`), `target_kind` (`kpi_actual` | `none`), `status` (`disabled` | `enabled`), `config_version_no` (the current configuration), `status_reason`, `version`, P2 stamps. History `connector_change` (trigger-written, append-only).

**Entity `connector_config_version`** (`0104`, append-only): `connector_id`, `version_no` (1, 2, 3 …), `source_system_id` (the "source ID" of M0334: the identifier of the source system or dataset, `^[A-Za-z0-9][A-Za-z0-9_.:/-]*$`, ≤ 200), `endpoint_url` (`https://` only; set exactly for `http_pull`), `credential_refs` (an object of at most 8 named `SecretRef`s `{provider, name}`, ADR-0052 §5), `field_mappings` (at most 100 `{source, target}` pairs; each target once), `target_transformation_id` (set exactly for `kpi_actual` connectors; same organization), `cadence` (`manual` | `hourly` | `daily` | `weekly`), `retry_max_attempts` (0–5, default 3), `retry_backoff_seconds` (10–3600, default 60), `commit_mode` (`manual` | `auto`) with `commit_on_behalf_of` (set iff `auto`), `outbound_actions` (⊆ {`deliverable_status_push`}), `reconciliation_rule` (`none` | `row_count` | `row_count_and_total`), `adapter_settings` (an object ≤ 4 KiB), `reason`, `created_at`, `created_by`.

- **Why versions:** a run, a staged batch and an outbound write record the configuration version they used (`config_version_no`, composite foreign keys), so a later mapping change never rewrites how an earlier run was read. The import mappings are versioned here, outside Studio (p6-plan §3 row 24): a connector mapping is integration configuration, not a methodology form.
- **Credentials (M0334 "configured credentials"):** only references. The value is resolved by `SecretProvider` (ADR-0052 §5) at the moment of the remote call, outside any transaction, and never written to a row, a response, an audit event or a log (ADR-0053 §4 redaction list). A response shows `{provider, name, resolvable: true | false}`.
- **Adapter kinds:** `test_adapter` is the local adapter of M0335 (§3). `webhook` receives pushed data through ADR-0056 §7. `http_pull` is the generic adapter slot for a corporate source "when access is supplied" (M0334): it ships with the port and a contract test against a local fake HTTP source only; no corporate source is exercised here (p6-plan R3), and `docs/delivery/environment.md` lists the endpoint and credential IT must supply (DO-C row).

**Database invariants (probe):**

| # | Invariant | Mechanism | Probe |
|---|---|---|---|
| 1 | A connector is created `disabled` at configuration version 1, and its version-1 row exists at COMMIT | trigger `connector_guard` (`connector_transition`); deferred FK `connector_current_config_fkey` | CN04, CN03 |
| 2 | Configuration versions are numbered 1, 2, 3 … without gaps and are append-only | trigger `connector_config_version_guard` (`connector_config_version_sequence`); `p2_attach_append_only`; INSERT/SELECT grant | CN05, CN10 |
| 3 | A credential reference never carries a value; adapter settings carry no key named like a secret (`secret`, `password`, `passwd`, `token`, `apikey`, `api_key`, `credential`) | CHECKs `connector_config_version_credential_refs` (`p6_credential_refs_valid`), `connector_config_version_no_secret_settings` | CN06, CN07 |
| 4 | A test adapter has `adapter_settings.mode` ∈ {`healthy`, `failing`, `stopped`}; an endpoint URL exactly for `http_pull`; a target transformation exactly for `kpi_actual`; outbound actions only on the test adapter (D-195 Q14) | trigger (`connector_config_version_adapter_shape`, `_target_shape`, `_outbound_test_only`) | CN08 |
| 5 | Field mappings name each target once | CHECK `connector_config_version_field_mappings` | CN09 |
| 6 | `code`, `adapter_kind`, `target_kind` never change; the current configuration moves forward one version at a time | trigger (`connector_identity_fixed`, `connector_config_forward`) | CN13 |
| 7 | Version steps by 1; audit event at COMMIT; trigger-written history not writable by the application | `p2_attach_guards(…, true)`, `connector_history`, SELECT-only grant | CN02, CN12, CN14, CN15 |
| 8 | `service_identity.connector_id` names an existing connector | FK `service_identity_connector_fkey` | CN16 |

**Creation (BE-L).** `createConnector` inserts, in one transaction: the connector, configuration version 1, and the connector's service identity (ADR-0053 §1: `code = 'connector:<id>'`, organization scope, `declared = granted = ['transformation.read']`, the read the staging validation needs in the target transformation through `ReadScope`; never a configure, approval or Finance code, which `service_identity_guard` refuses). An automatic commit does not act as this identity: it acts on behalf of the configured user and re-checks that user's rights (ADR-0056 §6), each with its audit event. `putConnector`/`putConnectorMappings` insert the next configuration version and step the connector to it (If-Match on the connector).

**Status machine:** `disabled` → `enabled` (`enableConnector`), `enabled` → `disabled` (`disableConnector`, reason required). No delete. **Verification status** (read-only, shown on the connector page, the REQ-S17-004 rule ahead of DG7): `verified` iff a run with `trigger_kind = 'test'` succeeded on the current configuration version; otherwise `not_verified`. A connector is never labelled "live" or "connected to Mobily".

### 2. IntegrationRun (REQ-S17-001, REQ-S16-022)

**Entity `integration_run`** (`0104`): `connector_id`, `config_version_no`, `trigger_kind` (`schedule` | `manual` | `retry` | `test` | `webhook`), `status`, `attempt_no` (1–6), `retry_of_run_id`, `idempotency_key` (UNIQUE per connector), `requested_by` (required for `manual` and `test`), `service_identity_id` (the connector's own), `queued_at`, `started_at`, `finished_at`, the counts `rows_read`, `rows_staged`, `rows_committed`, `rows_rejected`, `rows_duplicate`, `error_count`, `error_code`, `error_message` (redacted before it is stored, ADR-0053 §4), `reconciliation_status` (`not_checked` | `matched` | `mismatched` | `not_applicable`), `source_row_count`, `source_control_total`, `staged_control_total` (`numeric(24,6)`), `import_batch_id` (FK added by `0105`), `version`, stamps. History `integration_run_event` (trigger-written status and counts per version).

**State machine** (trigger `integration_run_guard`): `queued` → `running` | `cancelled`; `running` → `succeeded` | `failed`. `succeeded`, `failed`, `cancelled` never change (`integration_run_final`). A retry is a new run.

**Database invariants (probe):** one active (`queued` or `running`) run per connector (`integration_run_one_active`, IR02); one run per idempotency key (IR03); a run acts as its own connector's service identity (IR18); a retry follows a `failed` run of the same connector as attempt + 1 (IR08), at most once per failed run (`integration_run_one_retry_key`, IR10); `succeeded` needs every count (IR11); `committed + rejected + duplicates ≤ staged ≤ read` (IR12); `matched`/`mismatched` need `source_row_count` (IR13); version step, audit at COMMIT, append-only history (IR05, IR15, IR16).

**The run (BE-L, `apps/worker/src/handlers/integrations.ts`, queue `integrations.connector_run`; job identity declared by BE-L's migration per ADR-0053 §1):**
1. In transaction 1 under lock 730310 (`connectorRun`, key connector id): load the connector and its current configuration; if `disabled`, the run is `cancelled`. Otherwise `queued` → `running`, `started_at`.
2. Outside any transaction: resolve the credential references, call the adapter (`fetch(config, since)`), which returns rows as **strings** plus the source's control figures (`sourceRowCount`, `sourceControlTotal` as a decimal string or null).
3. In transaction 2: stage the rows into an `import_batch` with `source_kind = 'connector'` through ADR-0056 §3–§5 (validation, duplicates, row reasons), set the run counts from the batch, compute reconciliation (`row_count`: `source_row_count = rows_read`; `row_count_and_total`: also `source_control_total = staged_control_total`, compared as decimals), then `succeeded`. With `commit_mode = 'auto'` and a `matched` (or `not_applicable`) reconciliation, the commit of ADR-0056 §6 runs after transaction 2 on behalf of `commit_on_behalf_of`; a `mismatched` reconciliation never auto-commits and leaves the batch `staged` for a human.
4. On an adapter or validation-infrastructure error: `failed` with the error code of §4; then, if `attempt_no ≤ retry_max_attempts`, a `retry` run is queued with `retry_backoff_seconds × 2^(attempt_no − 1)` delay (bounded retries with backoff, M0240); the last failure raises the operational exception of ADR-0053 §2 (`source_kind = 'connector'`, classes `connector_run_failed`, `connector_unreachable`, `connector_credentials_rejected`) and the `connector.run_failed` catalogue trigger. **Exactly once:** the scheduled slot's idempotency key is `schedule:<connector id>:<slot start ISO>`; a manual run's is `manual:<request id>`; a retry's `retry:<retried run id>`. A replay of the job creates nothing (unique backstops; DG4 S12-021 pattern).

**"Last success"** is derived, never stored: the newest `finished_at` of a `succeeded` run of the connector (index `integration_run_last_success_idx`); with no such run the UI shows "Never succeeded" (Unknown), never a date of 0. **Retry history** is the `retry_of_run_id` chain plus each run's `integration_run_event` rows. **Counts not known yet are NULL and shown "Unknown"**, never 0.

### 3. The local test adapter (M0335 "working local test adapters and contract tests")

`apps/api/src/modules/integrations/adapters/test-adapter.ts` (BE-L) implements the adapter port with no network I/O. Its behaviour is chosen by `adapter_settings.mode` of the current configuration version:

| Mode | `fetch` returns | `dispatch` (outbound) returns | Run result |
|---|---|---|---|
| `healthy` | the deterministic fixture rows of `adapter_settings.fixture` (default: the A17 10-row KPI fixture: 8 valid, 1 invalid, 1 duplicate), `sourceRowCount = 10`, a control total | `{outcome: 'confirmed', externalReference: 'TEST-<idempotency key hash 12>'}`; the same key returns the same reference and increments a per-key effect counter **once** | `succeeded` |
| `failing` | throws `connector.source_unavailable` | throws `connector.source_unavailable` | `failed`, retried up to the bound |
| `stopped` | throws `connector.stopped` | returns `{outcome: 'no_response'}` | `failed` |

`adapter_settings.confirm` (`immediate` default | `never`) makes `dispatch` in `healthy` mode return `{outcome: 'accepted_unconfirmed'}`, so the "pending confirmation" path is testable. The adapter's effect counter is the A13 proof "replaying an outbound write with the same key produces one downstream effect". The `http_pull` adapter has the same port and a contract test against a local fake source (BE-L); the same contract suite runs against both adapters.

### 4. Graceful degradation and actionable errors (REQ-S17-005)

Acceptance: "A17;A21: with the test connector stopped, a KPI actual can still be submitted by form, and the connector page shows an actionable error message."

- **Native forms and imports never depend on a connector.** No DG4 KPI route, form route or ADR-0056 upload route reads a connector's status. With a connector `failed`, `stopped` or `disabled`, `submitKpiActual` (DG4, `POST /api/v1/transformations/{transformationId}/kpi-definitions/{kpiDefinitionId}/actuals`) and `createImport` behave exactly as without a connector (BE-O proves both with the test connector in `stopped` mode).
- **Actionable error.** The connector page and the run detail show, for the newest failed run: which run (`runId`, trigger, attempt, time), why (the error code's text), and what to do (the code's action text), plus the two fallback links "Enter the KPI actual by form" and "Import a file" (Strategy and KPIs > Imports, D-195 Q1). Texts (English verbatim; Arabic in the catalogues, labelled provisional):

| Error code | Why (en) | What to do (en) |
|---|---|---|
| `connector.source_unavailable` | "The source system did not respond." | "Retry the run later. Until the source is back, enter the values by form or import a file." |
| `connector.stopped` | "The connector's test adapter is stopped." | "Start the adapter (set its mode to healthy), or enter the values by form or import a file." |
| `connector.credentials_rejected` | "The source system rejected the connector's credentials." | "Ask IT to renew the secret named in the connector's credential reference, then retry." |
| `connector.secret_unresolvable` | "The secret reference {name} could not be resolved." | "Ask IT to provide the secret {name} to the application's secret provider, then retry." |
| `connector.mapping_mismatch` | "The source did not provide the mapped column {column}." | "Update the field mappings to match the source, then retry." |
| `connector.response_invalid` | "The source returned data the connector cannot read." | "Check the source export with its owner; meanwhile enter the values by form or import a file." |

- The failure also opens or recurs the operational exception (ADR-0053 §2) and notifies the connector's data owners through the starter rule (`connector.run_failed`, ADR-0053 §3; REQ-S17-005 "Connector failure -> notify owner"). Per D-197 §3 a connector exception never forces a KPI to `stale`; the KPI keeps its DG4 freshness label and last value.

### 5. Guarded outbound writes (REQ-S17-006)

Acceptance: "A13;A12: replaying an outbound write with the same key produces one downstream effect; a write without confirmation stays 'pending confirmation'."

**Entity `outbound_write`** (`0104`): `transformation_id`, `connector_id`, `config_version_no`, `action_code` (`deliverable_status_push`, D-195 Q14), `deliverable_id` (composite FK to the deliverable of the same transformation), `idempotency_key` (UNIQUE per connector), `payload` (an object ≤ 16 KiB; never a secret), `payload_sha256`, `status`, `attempt_count` (0–10), `last_attempt_at`, `external_reference`, `confirmed_at`, `failure_code`, `failure_message`, `requested_by`, `service_identity_id` (the connector's own), `version`, stamps. History `outbound_write_event`.

**State machine** (trigger `outbound_write_guard`): `requested` → `pending_confirmation` | `confirmed` | `failed`; `pending_confirmation` → `confirmed` | `failed`. `confirmed` and `failed` never change. `confirmed` requires `external_reference` and `confirmed_at` (CHECK `outbound_write_confirmed_shape`, OW04); the action, subject, payload and key never change (OW07); each dispatch counts once (OW08). The insert requires an `enabled` connector whose **current** configuration lists the action (OW01).

**Flow (BE-N, `integrations/outbound.ts`):**
1. `executeOutboundWrite` (permission `outbound_write.execute`, held by TD only by default and implied by no other code; plus `transformation.read` on the deliverable through `ReadScope`). **Explicit permission** also means the request names the action and the idempotency key; the UI generates the key once per user intent and shows it.
2. Transaction 1 under lock 730313 (key `<connectorId>:<idempotencyKey>`): if a write with the key exists and its `payload_sha256` equals the request's, return it (**replay: 200, no new row, no dispatch**); if the hash differs, 409 `outbound_write.idempotency_key_reused`. Otherwise insert `requested` with its audit event.
3. Outside any transaction: `dispatch(action, payload, idempotencyKey)` through the adapter with the same key (the downstream deduplicates by key; the test adapter counts one effect per key).
4. Transaction 2: `confirmed` only on an adapter outcome `confirmed` with a reference; `failed` on a definitive rejection; otherwise (`accepted_unconfirmed`, `no_response`, a timeout, a crash between steps) the row is or stays `pending_confirmation` (shown "Pending confirmation"). A row left `requested` by a crash is re-dispatched with the same key by `confirmOutboundWrite` or the retry job, so the downstream effect stays one.
5. `confirmOutboundWrite` asks the adapter for the outcome of the key (no new effect) and applies step 4. **There is no manual "mark confirmed"**: a write is marked done only on a confirmed response (M0335).

### 6. Deliverable external-change confirmation (REQ-S01-005)

Acceptance: "A11;A17: marking the task complete leaves the deliverable Unconfirmed; a filename-only link does not confirm it; reviewed evidence or a test-adapter confirmation sets it and records the source."

**Entity `deliverable_external_change`** (`0106`; additive on DG3: the deliverable table, its acceptance and every task table are unchanged and never write it): one row per deliverable (UNIQUE `deliverable_id`; no row = not flagged). Fields: `is_external_change`, `change_type` (`customer_system` | `network_upgrade` | `procurement_transaction` | `other`, the four kinds named by M0080; `other` needs a `description`), `description`, `confirmation_status` (`unconfirmed` | `confirmed`), `confirmation_source` (`reviewed_evidence` | `connector_result`), `evidence_id`, `outbound_write_id`, `connector_id`, `source_system_id`, `source_reference`, `source_confirmed_at`, `service_identity_id`, `confirmed_at`, `confirmed_by`, `confirmation_note`, `version`, stamps. History `deliverable_external_change_event`.

**State machine:** `unconfirmed` → `confirmed` (terminal, `deliverable_external_change_final`, DX09). A flag can be withdrawn (`is_external_change = false`) only while `unconfirmed`.

**Database invariants (probe DX):**

| # | Invariant | Mechanism | Probe |
|---|---|---|---|
| 1 | A flag is created `unconfirmed`; one flag per deliverable | trigger (`deliverable_external_change_transition`); UNIQUE | DX01, DX03 |
| 2 | A change of the deliverable (e.g. its DG3 acceptance) or of a task never sets the confirmation | no trigger or route of DG3/DG4 writes the table | DX04 |
| 3 | `reviewed_evidence` confirms only with an `active`, `verified` evidence item of the same transformation that is not a `file_reference` (a filename-only link never does) | trigger (`deliverable_external_change_evidence_verified`) plus `0012`'s `evidence_filename_never_verified` | DX05, DX06, DX08 |
| 4 | `connector_result` confirms only by copying a **confirmed** outbound write **of this deliverable**: its connector, the configuration's source system id, its reference, its confirmed time and its service identity | trigger (`deliverable_external_change_connector_confirmed`) | DX11, DX12, DX13 |
| 5 | Exactly one source's provenance fields are set, and none while unconfirmed | CHECK `deliverable_external_change_source_shape` | DX01, DX08, DX13 |
| 6 | Version step, audit at COMMIT, append-only history | P2 guards, `deliverable_external_change_history` | DX07, DX14 |

**Routes (BE-O):** `getDeliverableConfirmation` (scoped read), `putDeliverableExternalChange` (flag, change type, description, withdraw; `external_change.flag`), `confirmDeliverableExternalChange` (body `{evidenceId, note}`; `external_change.confirm`, held by BO and TD: REQ-S01-005 "confirm-external: evidence reviewer (BO or TD)"), each under lock 730314. The **connector** confirmation is written by the `confirmOutboundWrite` path when a `deliverable_status_push` write for a flagged deliverable becomes `confirmed` (actor `service`, the connector's service identity; REQ-S01-005 "Connector result received -> record confirmation with provenance"). Display labels (en; ar provisional): "Unconfirmed", "Confirmed by reviewed evidence", "Confirmed by connector result". The deliverable page shows the confirmation next to (never instead of) the DG3 acceptance; a completed task or an accepted deliverable never shows "Confirmed".

### 7. The S16-022 entity group (REQ-S16-022)

Acceptance: "A06;A13: the ERD and migrations contain every entity listed (FormSchemaVersion, AutomationRuleVersion, Job, Notification, IntegrationRun, ReportSnapshot, AuditEvent) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced."

| Entity | Table (migration) | Primary key; owner; status | "Creates" (D-195 Q12) | Reads |
|---|---|---|---|---|
| FormSchemaVersion | `methodology_version` rows with `key = 'forms'` (`0011`, seeded v1 in `0068`), pinned per transformation by `transformation_config_pin` rows of kind `form_schema` (`0063`) | `id`; `created_by`/`published_by`; `status` draft/published/retired | the P5 Studio publish of a form-schema version | `getFormSchemaAdmin`, `getTransformationFormSchema` |
| AutomationRuleVersion | `automation_rule_version` (`0074`) | `id`; `created_by`; `status` draft/in_review/approved/published/superseded/discarded | `createAutomationRuleVersion` | `getAutomationRuleVersion` |
| Job | `pgboss.job` (`0006`) with `job_schedule` and `job_run` (`0074`) | `job_run.id`; the job's service identity (ADR-0053 §1); `job_run.outcome` | `runJobNow` | `getJobOperation` |
| Notification | `inbox_notification` (`0028`) | `id`; `recipient_user_id`; `read_at` (unread/read) | any mutation that notifies (e.g. a KPI actual submission) | `listMyInbox` |
| IntegrationRun | `integration_run` (`0104`) | `id`; the connector's service identity and `requested_by`; `status` | `runConnector` | `getIntegrationRun` |
| ReportSnapshot | `report_snapshot` (`0080`) | `id`; `created_by`/`issued_by`; `status` generated/issued/superseded/discarded | `issueReportSnapshot` | `getReportSnapshot` |
| AuditEvent | `audit_event` (`0003`) | `id`; `actor_user_id`; append-only (no status) | any mutation | `getAuditEvent` (ADR-0052 §8) |

BE-O writes `apps/api/test/integration/integrations/s16-022-entity-group.test.ts`: for each row, the producing mutation as an authorized user, then the read as that user (200) and as an out-of-scope user (403/404), and an AUD read (200, no write). The ERD §2.12 rows `form_schema_version` and `notification` are corrected to the physical tables above (§ "Consequences").

### 8. Advisory locks (ADR-0016 §6 registry)

730310 `connectorRun` (key `<connectorId>`); 730313 `outboundWrite` (key `<connectorId>:<idempotencyKey>`); 730314 `deliverableConfirmation` (key `<deliverableId>`). 730311 and 730312 are ADR-0056's. 730315–730317 are reserved for this block.

### 9. Authorization summary (`0107`; permissions matrix §26)

| Code | Category | Role defaults | Used by |
|---|---|---|---|
| `connector.read` | read | ADM_TECH, KDS, TD, TO, AUD | list/get connectors, configuration versions, mappings, runs (counts, errors, reconciliation; never staged values) |
| `connector.configure` | configure | ADM_TECH | create, put, put mappings, enable, disable, test |
| `connector.run` | write | ADM_TECH, KDS | run now, retry |
| `outbound_write.read` | read | TD, KDS, TO, AUD | list/get outbound writes (scoped by transformation through `ReadScope`) |
| `outbound_write.execute` | write | TD only | execute, re-check confirmation |
| `external_change.flag` | write | TL, BO, WL, TO | flag, change type, withdraw (scoped to the deliverable's transformation) |
| `external_change.confirm` | write | BO, TD | confirm with reviewed evidence |

- **AUD** gets the three read codes only and every mutation answers 403 (AUD write-deny sweep, p6-work-split §2 rule 7). **Technical administrators** (ADM_TECH) configure, test and run connectors but hold no import, outbound-write or external-change right (REQ-S10-003: no business-record write); the `0001` trigger still refuses any approval code for them (PM05). **SoD:** the connector service identity holds read/write codes only (`service_identity_guard`); outbound writes are executed by TD and never by the configuring administrator by default. Every mutation re-checks authorization at commit time, validates, requires `If-Match` (409/428) except `createConnector`, `createImport`, `createWebhookEndpoint` and `executeOutboundWrite` (creates; the last carries its idempotency key), `testConnector`, `runConnector` and `retryIntegrationRun` (each creates a new run; `runConnector` takes the optional `Idempotency-Key`) and `receiveWebhook` (signature-authenticated; its delivery id is the key), and writes one audit event per changed record.
- A connector's organization scope: an organization-level holder of `connector.*` sees and acts on the connectors of that organization; a transformation-level holder sees the connectors whose current configuration targets that transformation (read only).

**Refusal codes** (problem+json; English verbatim; Arabic in `i18n/ar/problems.json`, labelled provisional):

| Code | Status | English text |
|---|---|---|
| `connector.code_taken` | 409 | "A connector with this code already exists in this organization." |
| `connector.secret_value_refused` | 422 | "Credentials are stored only as references to a secret that IT holds. Enter a secret reference, not the secret itself." |
| `connector.mappings_invalid` | 422 | "The field mappings are invalid: name each target field once, and give every source column a name." |
| `connector.adapter_settings_invalid` | 422 | "These settings do not fit this connector type." |
| `connector.target_invalid` | 422 | "Choose a transformation of this organization as the import target." |
| `connector.disabled` | 409 | "This connector is disabled. Enable it, or enter the data by form or import a file." |
| `connector.run_active` | 409 | "A run of this connector is already queued or running. Wait for it to finish." |
| `integration_run.not_retryable` | 409 | "Only a failed run can be retried, and only once." |
| `integration_run.retry_limit_reached` | 422 | "This run reached the retry limit of {max} attempts." |
| `outbound_write.idempotency_key_reused` | 409 | "This idempotency key was already used for a different request." |
| `outbound_write.action_not_allowed` | 422 | "The connector's current configuration does not allow this action." |
| `outbound_write.final` | 409 | "This write is already confirmed or failed and cannot change." |
| `external_change.not_flagged` | 409 | "This deliverable is not flagged as an external change." |
| `external_change.already_confirmed` | 409 | "This external change is already confirmed. A confirmation never changes." |
| `external_change.evidence_not_verified` | 422 | "Only reviewed (verified) evidence confirms an external change. A filename-only link never does." |
| `external_change.withdraw_confirmed` | 409 | "A confirmed external change cannot be withdrawn." |

### 10. Decimal and Unknown semantics

- `source_control_total` and `staged_control_total` are `numeric(24,6)`; the control total of `row_count_and_total` is the decimal sum of the staged rows' normalized values, computed with the shared decimal helper (`packages/shared/src/calc.ts`), never a float. Reconciliation compares decimals exactly.
- Counts not known (a queued, running, cancelled or failed run) are NULL and render "Unknown"; "Last success" with no succeeded run renders "Never succeeded"; reconciliation `not_checked` renders "Not checked", never "matched" or green.
- An outbound write in `requested` or `pending_confirmation` renders "Pending confirmation", never "Done"; a deliverable with no confirmation renders "Unconfirmed", never green.

## Alternatives

1. **Store credentials encrypted in the database.** Rejected: M0331 makes secrets runtime configuration, and ADR-0052 §5 defines `SecretProvider`; a reference keeps every value out of rows, backups and audit.
2. **One mutable connector row holding the mappings.** Rejected: a run could not prove which mapping it used, and M0329 asks for explicit history; append-only configuration versions cost one table.
3. **An `external_change` column on `deliverable`.** Rejected: the DG3 deliverable PUT and its frozen-column rules would change (a DG3 reopen); a side table is additive (p6-plan §3 row 5).
4. **A manual "mark confirmed" for outbound writes.** Rejected: M0335 "confirmed results" and REQ-S17-006 "marked done only on a confirmed response".
5. **Last success as a stored connector column.** Rejected: every run would step the connector's version and audit it; a derived value from an index is exact.

## Consequences

- 7 new tables in `0104` (`connector`, `connector_config_version`, `connector_change`, `integration_run`, `integration_run_event`, `outbound_write`, `outbound_write_event`), 2 in `0106` (`deliverable_external_change`, `deliverable_external_change_event`), 11 permission codes and 26 role links in `0107`; 3 functions (`p6_credential_refs_valid`, `p6_field_mappings_valid`, `p6_settings_without_secret_keys`) and the FK on `service_identity`.
- No DG1–DG5 table, column, constraint, trigger, route or text changes. With no connector row every DG5 behaviour is unchanged (probe G04).
- The ERD §2.12 physical-table column for FormSchemaVersion and Notification is corrected (documentation only).
- New worker queue `integrations.connector_run` (and its job service identity) is added by BE-L's migration (next id at merge, D-196).
- Residuals (p6-plan R3): no corporate source and no downstream system is exercised; `http_pull` ships with its port, the local fake source and the contract test, and is documented as "not verified" until IT supplies an endpoint and a credential.

## Verification

- `probe-output.txt` (110/110 PASS, exit 0): G00–G05, CN01–CN16, IR01–IR18, OW01–OW11, DX01–DX14, PM01–PM05 (the WH and IM groups are ADR-0056's).
- `packages/db/test/integration/catalogue.test.ts` "0104-0106: the P6 slice B/A guards are attached" and the privilege and mutable-table pins; `packages/db/src/seed.test.ts` "0107 seed equals the P6 part of permissions.ts (slices B and A)".
- Implementer tests named in `p6-work-split.md` §B/A: the test-adapter contract suite (BE-L), the A13 replay test (BE-N), the S17-005 stopped-connector form test (BE-O), the S01-005 four-case test (BE-O), the S16-022 entity-group test (BE-O); QA-A's A17 suite.
