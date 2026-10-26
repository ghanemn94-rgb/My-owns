# ADR-0053: P6 operations: a constrained service identity for every job and connector, operational exceptions linked to stale KPIs, the catalogue triggers, structured logs and the redaction list, the post-suite log scan, the worker heartbeat and error alerts, and Administration > Operations

- **Status:** Proposed for P6 (DG6). Author: solution-architect (T-DG6-ARCH-02), 2026-10-26.
- **Requirements (slice J of `docs/architecture/p6-plan.md`):** REQ-S12-019, REQ-S16-029.
- **Sources (quoted where a design point has one):**
  - M0239 (§12, starter table) "Connector/job fails or data becomes stale | Create a visible operational exception; retain last known values with freshness labels".
  - M0240 (§12) "Use durable background jobs, idempotency keys, bounded retries with backoff, transaction-safe event/outbox handling and an operational failure queue. … Expose last success, next run, failures and repair actions to authorized administrators."
  - M0330 (§16) "Generated exports and search indexes must enforce the same scopes as record views. Use a constrained service identity for each connector and background job. Avoid exposing secrets or private evidence URLs in client code or logs."
  - M0331 (§16) "… a secret-management interface. Production secrets are runtime configuration, not repository content."
  - M0391 (§20, A22) "Operational readiness | Health checks, logs, error alerts, admin job visibility and production/demo separation are demonstrated". M0381 (A12) "Cross-transformation unauthorized reads/writes, exports, search results, evidence URLs and AI retrieval are denied". M0386 (A17) "… unavailable connector shows an actionable error".
  - REQ-S12-019 acceptance: "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date". REQ-S16-029 acceptance: "A12;A22: a log scan after the test suite finds no secrets or storage URLs; a job's identity cannot read records outside its scope".
  - Playbook: Template 2 (B0049/B0050) gives every KPI an "Owner" column; the playbook names no operational monitoring, logging or service-identity control, so nothing below is attributed to it.
- **Decisions applied:** D-195 (Q2 evidence links, Q13 job identities enforced in the application through `ReadScope`, no PostgreSQL row-level security; Q12; R3), D-196 (migration ids), D-193, D-088 §2, D-141, F-DG3-100, F-DG4-160.
- **Builds on:** ADR-0002 rule 5 (the worker imports no API code), ADR-0004 (audit), ADR-0006 (policy), ADR-0008 (jobs, retries), ADR-0016 (P2 guards, lock registry), ADR-0025 (job kit), ADR-0028 (KPI freshness), ADR-0043 (failure queue `operational_failure`, automation service identities), ADR-0044 (starter 16 `starter.job_failed`), ADR-0051 §1 (`ReadScope`), ADR-0052 §5 (`SecretProvider`).
- **Physical model:** `packages/db/migrations/0101_p6_operations_service_identities.sql`, `0103_p6_operations_channels_permissions.sql`; probe groups SI, OE, OEK, WH, PM in `docs/delivery/handbacks/DG6/T-DG6-ARCH-02-evidence/probe-output.txt`.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. A service identity never holds a business-approval or Finance-validation right. Acknowledging an exception approves nothing.

## Context

1. The 35 worker queues (`apps/worker/src/queues/**`) run through the job kit (`apps/worker/src/kit.ts`) as the audit actor `service`/`worker` with no permission and no declared read scope ("a service actor holds no permission"). Their queries are scoped by the code each handler contains, not by a declared identity. Only P5 automation actions have service identities (`automation/identity.ts`, rule-version `service_permission_codes`).
2. The failure queue `operational_failure` (`0074`, ADR-0043) holds one row per failed unit of work and key (open → retrying → resolved | open; open → dismissed). It is per job key, so 50 failing scheduled slots of one queue are 50 rows. Starter 16 (`starter.job_failed`, M0239) records them. There is no record "this source is failing" that an administrator acknowledges, and no link to the KPIs that a failing source makes stale. `grep operational_exception` finds nothing.
3. KPI freshness is computed at read time by DG4 (`kpi/kpi-status.ts`: `freshness { status: fresh | stale | unknown, dataAsOf, staleAfterDays }`, ADR-0028); the panel keeps the last accepted value. Nothing records that data became stale.
4. Logs: pino JSON, with `redact` on four paths only (`req.headers.authorization`, `req.headers.cookie`, `req.headers["x-csrf-token"]`, `res.headers["set-cookie"]`; `server.ts`). No scan checks a test run's logs.
5. The worker has no heartbeat. `/health` and `/ready` (ADR-0011) cover the API only.

## Decision

### 1. A service identity for every job queue and connector (REQ-S16-029)

**Entity `service_identity`** (`0101`): `id`, `code` (UNIQUE; `job:<queue name>` or `connector:<connector id>`), `subject_kind` (`job` | `connector`), `queue_name` (jobs), `connector_id` (connectors; its foreign key is added by ADR-0055's migration when `connector` exists), `scope_level` (`platform` | `organization`), `organization_id` (NULL iff platform), `declared_permission_codes` (the ceiling), `granted_permission_codes` (the effective grant), `sensitive_access` (`none` | `aggregate_only`), `label_en`, `label_ar`, `reason`, `version`, P2 stamps. History `service_identity_change` (trigger-written, append-only; `record_version`, both code lists, `sensitive_access`, `reason`, `changed_by`, `changed_at`).

**Database invariants (each proved by the probe):**

| # | Invariant | Mechanism | Probe |
|---|---|---|---|
| 1 | Every declared code is a `read` or `write` permission; `configure`, `business_approval`, `finance_validation` and unknown codes are refused, also for a migration | trigger `service_identity_guard` (constraint name `service_identity_permission_category`) | SI03, SI04, SI05 |
| 2 | `granted_permission_codes ⊆ declared_permission_codes` | CHECK `service_identity_grant_within_declaration` | SI11 |
| 3 | A job identity is inserted only by a migration (role `mth_owner` or a superuser) | trigger (`service_identity_job_by_migration`, SQLSTATE 42501) | SI02 |
| 4 | The application can UPDATE only `granted_permission_codes`, `reason`, `version`, `updated_at`, `updated_by` | column-level `GRANT UPDATE (…)`; the declaration is also fixed by the trigger for non-owners (`service_identity_declaration_fixed`) | SI12 |
| 5 | `code` names its subject (`job:` + queue, `connector:` + id); a connector identity has organization scope | CHECK `service_identity_subject_shape`, `service_identity_scope_shape` | SI08, SI09 |
| 6 | Version steps by 1; every insert and update has its audit event at COMMIT; the history is append-only and not writable by the application | `p2_attach_guards(…, true)`, `p2_attach_append_only`, SELECT-only grant | SI07, SI10, SI13–SI17 |

**Who writes what.**
- **Job identities:** BE-J declares one identity per queue in code (`apps/worker/src/kit.ts`: `defineJob({ queue, identity: { permissions, scope, sensitiveAccess } })`, defaulting to the narrowest set the DG4/DG5 handler already reads) and seeds the same rows in its migration (the next id at merge, D-196). A unit test requires the code declarations and the seeded rows to be equal (the `seed.test.ts` pattern). The 35 queue names of `apps/worker/src/queues/**` at this revision are the set to declare; a queue added later declares its identity in the same change.
- **Connector identities:** created by the connector's creation (ADR-0055, BE-L) in the same transaction, with `granted = declared`.
- **Administrators** narrow or restore the grant (`putServiceIdentity`). They never widen it beyond the declaration and never change the declaration.

**How a job reads (D-195 Q13: application enforcement, no row-level security).** At the start of each run the kit loads the identity row by code and builds a service principal: the granted codes at organization scope for the organization the job names (a platform job iterates organizations and builds one principal per organization). Every business-record read of the handler goes through that principal:
- list and aggregate reads through `ReadScope` (ADR-0051 §1). ADR-0002 rule 5 forbids the worker to import `apps/api/src/modules/access/read-scope.ts`, so BE-J writes the worker twin `apps/worker/src/service-scope.ts` and a parity test against the API `ReadScope` on the ADR-0051 §1 fixture (the ADR-0043 identity-twin precedent);
- a single-record read through `requireServiceRead(principal, record)`, which throws `ServiceScopeViolation` with code `service_identity.out_of_scope` for a record outside the scope.
- **Sensitive records (ADR-0051 §2):** `sensitive_access = 'none'` excludes them like a reader without a grant. `aggregate_only` admits them **only** into aggregate computations (for example the benefit recalculation, so totals stay identical for every user, D-195 Q3) and never into a per-record output (a notification title, a work item, an export row).
- A missing identity row makes the run fail with `service_identity.missing`. A missing permission or an out-of-scope record makes it fail with `service_identity.out_of_scope`. Both are never retried (the ADR-0043 forbidden rule) and open an operational exception (§2).

**Acceptance proof (BE-J, `apps/api/test/integration/operations/service-identity-scope.test.ts`):** two organizations; for each job code that reads business records, the handler's scoped reads for organization A return no row of organization B (`ReadScope` predicate admits 0 rows), and `requireServiceRead` of an organization-B record id throws `service_identity.out_of_scope`. **Parity (P5 R2 rule):** for each touched handler, the output on the DG5 fixture is identical before and after the change (one regression test per handler).

### 2. Operational exceptions (REQ-S12-019)

**Entity `operational_exception`** (`0101`): `id`, `organization_id` (NULL for platform sources), `source_kind` (`job` | `connector` | `data_freshness` | `worker`), `source_code` (the queue name, the connector code, `kpi:<kpi definition id>`, or `worker`), `failure_class` (closed set below), `dedup_key` (= `source_kind:source_code:failure_class`, CHECK), `service_identity_id`, `operational_failure_id` (the latest failure-queue row for a job), `status`, `occurrence_count`, `first_occurred_at`, `last_occurred_at`, `last_error_code`, `last_error_message` (redacted before it is written, §4), `acknowledged_at/by`, `acknowledge_note`, `resolved_at/by`, `resolution` (`manual` | `recovered`), `resolution_note`, `version`, stamps. History `operational_exception_event` (trigger-written, append-only: `event_kind` `opened` | `recurred` | `acknowledged` | `resolved` | `updated`, status, count, error code, actor, note, time). Links `operational_exception_kpi` (append-only: exception, organization, transformation, `kpi_definition_id`, `linked_at`).

| `source_kind` | `failure_class` | Raised by | Organization |
|---|---|---|---|
| `job` | `job_failed` | the kit's last-attempt failure hook (`kit.ts`, after it writes `operational_failure`) | the job's, or NULL |
| `connector` | `connector_run_failed`, `connector_unreachable`, `connector_credentials_rejected` | the connector run (ADR-0055, BE-L) | required |
| `data_freshness` | `data_stale` | the freshness scan job (BE-K) when a KPI's DG4 freshness becomes `stale` | required |
| `worker` | `heartbeat_missed` | the API heartbeat watch (§6) | NULL (CHECK) |

**State machine** (trigger `operational_exception_guard`): created `open` with `occurrence_count = 1` and `first = last`; `open → acknowledged | resolved`; `acknowledged → resolved`; `resolved` is final (`operational_exception_resolved_final`). Source, class, key and first occurrence never change. A recurrence while active increments the count by exactly 1 and moves `last_occurred_at` forward (`operational_exception_occurrence_step`). An acknowledgement is recorded once. `manual` resolution needs the resolver and a note; `recovered` (the source succeeded again, written by the system) has no user (`operational_exception_resolved_complete`).

**One per source and failure class (dedup):** at most one ACTIVE (`open` or `acknowledged`) row per `(organization_id, dedup_key)`: partial unique index `operational_exception_one_active_key` with `NULLS NOT DISTINCT`, so platform rows are unique too (probe OE02). The raising code takes lock **730305** on `<organizationId or 'platform'>:<dedup key>`, then updates the active row (recurrence) or inserts a new one, in the same transaction as the failure it reports, with one audit event (`operational_exception.opened` or `operational_exception.recurred`, actor `service`). After resolution, a new failure opens a new row (OE16). A replay of the same failed job (same `processed_message` key) creates nothing new (the kit's ledger).

**Automatic recovery:** when a job queue, connector or KPI that has an active exception succeeds (a job completes, a connector run succeeds, the KPI's freshness is `fresh` again), the same code resolves the exception with `resolution = 'recovered'`.

**Last known values and freshness labels (M0239 "retain last known values with freshness labels").** No KPI value is written, cleared or zeroed by this slice. The KPI panel keeps DG4's `actual` and `freshness` exactly (ADR-0028). An exception links the KPIs whose data it concerns (`data_stale`: that KPI; connector classes: the KPIs the connector's mappings feed, ADR-0055). `getOperationalException` shows each linked KPI the caller can read with its DG4 `freshness`, last value (decimal string or null = Unknown) and `dataAsOf`; unreadable ones only increase `hiddenKpiCount`. **Acceptance fixture (QA-A/QA-E, A17/A22):** a KPI whose last accepted actual is older than its `staleAfterDays`, fed by the failing test connector: the run fails → exactly one exception (`connector_run_failed`) linked to the KPI, and the KPI shows Stale with its last value and date. Whether an active connector exception should also force `stale` on a KPI whose actual is still within `staleAfterDays` is **not** decided here: it would change the DG4 freshness rule (raised to the orchestrator, handback §5).

**Visibility (M0239 "visible"; REQ-S12-019 "shown to admins and data owners"):** Administration > Operations (`/admin/operations`, FE-B) lists exceptions, newest occurrence first, filterable by status, source kind and class. Error alerts (§6) notify on open.

**Refusal codes (problem+json; English texts; Arabic labelled provisional in the i18n catalogues, translated at render time):**

| Status | Code | English text | Arabic (provisional) |
|---|---|---|---|
| 409 | `operations.exception_not_open` | "Only an open operational exception can be acknowledged." | "لا يمكن الإقرار إلا باستثناء تشغيلي مفتوح." |
| 409 | `operations.exception_resolved` | "This operational exception is already resolved." | "تم إغلاق هذا الاستثناء التشغيلي مسبقاً." |
| 422 | `operations.note_required` | "Enter a note of 3 to 1,000 characters." | "أدخل ملاحظة من 3 إلى 1000 حرف." |
| 422 | `service_identity.grant_exceeds_declaration` | "A service identity can be granted only permissions that its job or connector declares." | "لا يمكن منح هوية الخدمة إلا الصلاحيات التي تعلنها المهمة أو الموصل." |
| 422 | `service_identity.reason_required` | "Enter a reason of 3 to 1,000 characters." | "أدخل سبباً من 3 إلى 1000 حرف." |
| job error | `service_identity.out_of_scope` | "The job tried to read a record outside its service identity's scope." | "حاولت المهمة قراءة سجل خارج نطاق هوية الخدمة الخاصة بها." |
| job error | `service_identity.missing` | "The job has no service identity, so it did not run." | "لا توجد هوية خدمة للمهمة، لذلك لم تُشغَّل." |

404 (`not_found`), 409 version conflict and 428 precondition required are the ADR-0007 §5b shared problems. An exception outside the caller's scope answers 404.

### 3. Catalogue triggers (p6-plan §3 row 8; additive)

BE-K's migration adds to `automation_trigger` (owner modules as named; `admin_selectable = true`; `source_ref` `M0239`):
- `connector.run_failed` (event, `integrations`, condition fields `{connectorId, failureClass}`), emitted by the connector run on failure;
- `data.stale` (event, `kpi`, condition fields `{kpiId}`), emitted by the freshness scan when a KPI becomes stale.
`import.committed` (§3 row 8, third kind) belongs to slice A (ADR-0056) and is added there. Starter 16 (`starter.job_failed`, M0239) gets a seeded rule **version 2** whose triggers are `{job.failed, connector.run_failed, data.stale}` and whose action opens or recurs the exception (§2) through the action registry; version 1 stays as published history. The human-only boundary and the other starters are unchanged.

### 4. Structured logs and the redaction list (REQ-S16-029 "never expose secrets or private evidence URLs … in logs")

Every API and worker log line is one pino JSON object with `time`, `level`, `msg` and, where known, `requestId`, `jobId`, `queue`, `serviceIdentity` (the code), `organizationId`, `errorCode`. Request and response bodies are never logged.

The redaction list (DO-D: `server.ts`, `apps/worker/src/main.ts`, `packages/config/src/load.ts`):
1. **Secrets from `SecretProvider`:** every value resolved through ADR-0052 §5 is registered at resolution in a process-wide redaction set; a log serializer replaces any occurrence with `[secret]`. `SecretValue` already prints `[secret]`.
2. **Storage keys and URLs:** the fields `storageKey`, `storage_key`, `key`, `Key`, `Bucket`, `bucket`, `endpoint` and `s3_*` are censored by path; any URL whose host equals the configured object-store endpoint becomes `[storage-url]`; any absolute path under `EVIDENCE_STORAGE_PATH` becomes `[storage-path]`; `X-Amz-Signature`, `X-Amz-Credential` and `X-Amz-Security-Token` query parameters are removed.
3. **Tokens:** the existing four paths, plus `req.headers["x-mth-signature"]` (webhooks, ADR-0056), the deep-link token segment (`/links/<token>` → `/links/[token]` in `req.url`, ADR-0051 §3), and the OIDC `code`, `state`, `id_token`, `access_token`, `refresh_token` parameters of `req.url`.
4. `operational_exception.last_error_message` and `operational_failure.error_message` are passed through the same redactor before they are written.

### 5. The post-suite log scan (REQ-S16-029 acceptance)

`deploy/scripts/log-scan.mjs` (DO-D) reads the log files that the test harness writes for the run (API and worker output, under the run's `$TMPDIR`; never `docs/delivery/**`, D-138) and fails (exit 1, listing file and line with the match masked) on:
- the literal value of every canary secret the test environment sets (each prefixed `mth-canary-`, configured for the database password, the OIDC client secret, the S3 keys and the SMTP password);
- the patterns `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `AKIA[0-9A-Z]{16}`, `X-Amz-Signature=`, `X-Amz-Credential=`, `Bearer [A-Za-z0-9._~+/-]{20,}`, `eyJ[A-Za-z0-9_-]{10,}\.eyJ`, `/links/[A-Za-z0-9_-]{43}`, the configured object-store host, and the `EVIDENCE_STORAGE_PATH` prefix.
It has a negative fixture (a log line with each pattern makes it fail) and runs after `pnpm test:integration` in CI. QA-E runs it in A22.

### 6. Worker heartbeat and error alerts (A22)

- **Heartbeat:** each worker process writes `worker_heartbeat` (`instance_key` = a random id chosen at start; `app_version`, `started_at`, `last_beat_at`, `beat_count`, `queue_count`) every `WORKER_HEARTBEAT_SECONDS` (default 30). A beat moves forward by exactly 1 (`worker_heartbeat_forward`, probe WH02). The table is telemetry: version-stepped, **not audited** (the `job_run` precedent), so beats write no audit event.
- **Status** (`getWorkerHeartbeat`): `alive` when the newest beat is at most 90 s old (3 intervals), `stale` when older, `unknown` when no beat exists. `unknown` and `stale` are never shown as alive.
- **Watch:** the API process checks every 60 s; when the newest beat is older than 90 s it opens (or recurs) the `worker:worker:heartbeat_missed` exception under lock 730305, and resolves it `recovered` when beats resume.
- **Error alerts:** opening an exception (not a recurrence) (a) writes one structured log line at level `error` with `alert: true` and `alertCode = <failure_class>`, and (b) sends one in-app notification to each active holder of `operations.acknowledge` at the exception's organization scope (platform exceptions: every organization's holders), dedupe key `operational_exception:<id>:opened:<userId>`. Email follows through the ADR-0054 §3 fan-out when a channel is configured.

### 7. Administration > Operations

FE-B, `pages/admin/operations/**` and `pages/admin/service-identities/**`: the exception list and detail (events, linked KPIs with their DG4 freshness label and last value; Unknown and Stale never shown as 0 or green), acknowledge and resolve forms (one form-level alert, `sessionBound`), the heartbeat card, and the service-identity list and grant form. AUD sees every page read-only. Labels say "operational exception", never DG0–DG7.

### 8. Advisory locks (ADR-0016 §6 registry)

730305 `operationalExceptionUpsert` (key `<organizationId or 'platform'>:<dedupKey>`); 730306 and 730307 are ADR-0054's; 730308–730309 are reserved for this block.

### 9. Authorization summary (`0103`; permissions matrix §25)

| Action | Permission (category) | Seeded roles | AUD |
|---|---|---|---|
| Read exceptions, heartbeat, service identities | `operations.read` (read) | ADM_TECH, TO, KDS, TD, AUD | read |
| Acknowledge or resolve an exception | `operations.acknowledge` (write) | ADM_TECH, KDS | none |
| Narrow or restore a service identity's grant | `service_identity.configure` (configure) | ADM_TECH | none |

- **Scope:** an organization-scope holder sees the organization's exceptions and the platform ones. A transformation-scope holder (for example a KDS assigned to one transformation) sees only exceptions linked to a KPI of a transformation in scope. The check is re-run at commit time on every mutation.
- **SoD:** no code is `business_approval` or `finance_validation` (probe PM04, PM03); a technical admin gains no business approval (REQ-S10-003). A service identity never holds `configure`, `business_approval` or `finance_validation` (invariant 1).
- **Every mutation:** authorization re-checked at commit, validation, `If-Match` (409/428), one audit event (`operational_exception.acknowledged`, `operational_exception.resolved`, `service_identity.grant_changed`), no remote I/O in the transaction, a test for each.

### 10. Decimal and Unknown semantics

No entity here holds money, a rate or FTE. `occurrence_count`, `beat_count` and `queue_count` are integer counts. A linked KPI's last value is the DG4 decimal string or null (Unknown, never 0); freshness is DG4's label. The heartbeat is `unknown`, never `alive`, when no beat exists.

## Alternatives

- **Reuse `operational_failure` as the exception.** Rejected: it is one row per job key with retry semantics (ADR-0043); the exception is one per source and class with acknowledge/resolve, and links KPIs. The two are linked by `operational_failure_id`.
- **PostgreSQL row-level security per service role.** Rejected by D-195 Q13 (it would touch every DG1–DG5 table).
- **One database role per job.** Rejected for the same reason; one application role `mth_app` stays.
- **Auditing every heartbeat.** Rejected: 2,880 audit events per worker per day with no business meaning.

## Consequences

- Handlers that read business records change their queries to the service principal: a DG4/DG5 code-path change with one parity test per touched handler (P5 R2).
- A narrowed grant can make a job fail visibly; that is the intended least-privilege behaviour, and restoring is one PUT.
- With no failure, no row is written; every DG5 response is unchanged (probe G04).

## Verification

- **Database (this task):** probe groups SI01–SI17, OE01–OE20, OEK01–OEK04, WH01–WH03, PM01–PM04: PASS in the 81/81 run (`probe-output.txt`).
- **Implementers:** BE-J (§1 scope and parity tests), BE-K (§2, §3, §6 watch, routes, an exactly-once test: a replayed failure creates no second exception), DO-D (§4, §5 with its negative fixture, heartbeat writer, alert line), FE-B (§7). QA-A/QA-E: A17/A22 and the A12 out-of-scope case.
- **Dependencies:** none added by this ADR.
