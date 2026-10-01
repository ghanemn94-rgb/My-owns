# Imports, integrations and notifications — security design (P6)

Spec §17 (imports and integrations), §11 (snapshots, unchanged here), §12.4 (notifications). Threat model controls C-16,
C-18, C-31, C-39, C-43; threats T-41, T-43. Requirements REQ-INT-001..010, REQ-INT-012..015, REQ-SRC-009, REQ-SEC-014,
REQ-SEC-015, REQ-PLT-008, REQ-SET-011.

Status words follow the project vocabulary: **Implemented / Tested / Simulated / Not configured / Blocked**. Nothing in
this build connects to an external system. Every connector is **Not configured** until an administrator saves a
configuration *and* a real connectivity check succeeds.

## 1. Import pipeline (REQ-INT-001..005, REQ-SEC-015, AT-25)

| Step | What happens | Where |
| --- | --- | --- |
| Upload | Raw octet-stream route (`POST /api/v1/projects/:projectId/imports?target=&classification=`), size limit of the document path, classification capped by the uploader's clearance. The client file name never reaches a storage path (server-generated UUID keys). | `imports.service.ts` `upload` |
| Pre-scan | Dangerous signatures (EICAR test string, executables, scripts) and PDF active content → **quarantine** area; the batch is `quarantined`, never parsed, served or imported; `security.file_quarantined` audited. | `file-checks.ts` |
| Type check | Magic bytes + extension allowlist; macro-enabled Office refused; the target accepts only its own file types. | `@hub/domain` `detectFileType`, `IMPORT_TARGET_FILE_TYPES` |
| Preservation | The file goes through the existing safe document path (scanner adapter, SHA-256, object storage) and is registered as a **source** (`source_record`) with its hash; the batch keeps `sha256`, `documentId`, `documentVersionId`, `sourceId`. | `imports.service.ts`, documents module |
| Parse | A worker job runs the parser **in a separate Node.js process** (see §2). Spreadsheets give sheets + cells; DOCX gives paragraphs; PDF and images are kept as sources only (no OCR / PDF text extractor is configured). | `imports.jobs.ts`, `sandbox/` |
| Map | Uploader chooses sheet, header row (1–5) and column → field mapping; an automatic suggestion recognises English and Arabic header names. | `@hub/domain` `suggestMapping`, `assertMapping` |
| Validate / preview | Every row is checked (values only), duplicates are detected inside the file and against the register (in the uploader's visibility), and the plan is computed: create / proposed change (claim) / change request / skip / error. A row refused by its own checks lists every field it would need. | `import-planner.ts` |
| Submit | The uploader submits the preview; its hash (`previewHash`) is stored. Approvers are notified in-app. | `submit` |
| Approve | A **second person** (`not_self`) holding `imports.batch.approve` approves item by item (declined rows are recorded). The plan is rebuilt as the uploader sees the records *now*; if it differs from the submitted preview → `409 imports.preview_stale`. The approver applies with **their own authority**: the record permissions the accepted rows need (`importApplyPermissions`) must be held, otherwise `422 imports.approver_lacks_authority` before anything is applied. | `approve`, `@hub/domain` `importApplyPermissions` |
| Apply | One transaction with audit + outbox: new risks; new tasks as **Draft / proposed**; differences on existing records as **source claims**; committee decisions and baselined tasks as **draft change requests**; reported statuses as **historical-unverified claims**. Never an update of an existing record (REQ-INT-015, C-43). Every output is linked to the batch (`import_output`). | `import-apply.ts` |
| Rollback | Feasible only when no created record changed or is referenced since, and the preserved file is not on legal hold (C-31). Created risks / tasks are **cancelled**, change requests **withdrawn**, claims removed; codes are never reused and history stays. | `rollback`, `rollbackBlockers` |

Batch history: every batch keeps its status, mapping, findings, summary, approver, decision note and outputs; every
command writes an `audit_event`. Isolation: `import_batch`, `import_sheet`, `import_row`, `import_output` carry
`org_id` + `project_id`, composite foreign keys and RLS; outside-scope batches return 404 (tested in
`test/imports/at-03-imports-notifications-isolation.spec.ts`).

### Values only, never evaluated (C-16)

- Formulas are **never evaluated**. A cached result is kept as untrusted text and flagged; a cell whose formula calls a
  blocked function (`WEBSERVICE`, `HYPERLINK`, `IMPORTDATA`, `CALL`, `REGISTER`, DDE, …) blocks its row.
- Text that starts like a formula (`=`, `+`, `-`, `@`, full-width variants, tab / CR) is kept as text and flagged.
- External workbook links, data connections and hyperlinks are stored **inert** and never followed or refreshed.
- URLs inside cells are never fetched; a URL naming an internal, private, link-local or metadata address (e.g.
  `http://169.254.169.254`, `[fd00:ec2::254]`) blocks its row (`imports.row.internal_url`).
- XML parts that declare a DTD or entities are refused (XXE / billion laughs); relationship targets that leave the package
  are refused (path traversal).

## 2. Isolated parser (REQ-SEC-015)

`runSandboxedParse` serialises a self-contained parser function into a child process:

- `spawn(process.execPath, ['--max-old-space-size=<heapMb>', '--permission' (Node ≥ 22: no file-system, child-process
  or worker access), '-e', <source>], { env: {}, stdio: ['ignore','ignore','pipe','ipc'] })` — an **empty environment**
  (no database URL, no secrets), the bytes are passed over IPC, the result returned over IPC.
- Wall-clock timeout → `SIGKILL` → `imports.parse.timeout`; heap exhaustion (V8 abort) → `imports.parse.memory_limit`;
  any other exit → `imports.parse.crashed`. The API and worker keep serving (tested).
- Bounded ZIP reader: entries ≤ `maxZipEntries`, per-part and total uncompressed bytes measured on the **actual** inflate
  (`maxOutputLength`), compression ratio ≤ `maxRatio` — a central directory that lies about sizes does not help.

| Limit | Value |
| --- | --- |
| Sheets / rows / columns / cells | 20 / 5 000 / 100 / 250 000 |
| Characters per cell / per formula | 10 000 / 500 |
| ZIP entries / per part / total / ratio | 2 000 / 40 MB / 80 MB / 150 |
| DOCX paragraphs | 500 |
| Time / heap | 20 s / 192 MB |

**Not configured — operating-system isolation.** The Node permission model removes file-system and process access, but
network isolation of the parser process is a deployment control (run the worker in a network namespace without egress,
or a seccomp / container policy). It is reported as `osNetworkIsolation: 'not_configured'` by `GET …/imports/policy` and
on the wizard screen.

**Not configured — malware engine and OCR.** The built-in signature check is not an antivirus; files are never certified
clean. No OCR or PDF text extractor is configured: scanned documents and images are kept as sources and reviewed by hand
(REQ-INT-005: extracted text, when any, becomes **unverified claims**, never field values).

## 3. Compare before merge (REQ-SRC-009)

A new version of a source is uploaded as a new batch that *supersedes* the previous source (the previous source and its
claims are retained). The preview lists, row by row, the current value of a matched record next to the value in the file;
the approver accepts items individually; only accepted items produce claims or change requests.

## 4. Integrations (REQ-INT-006..010, REQ-INT-013/014, REQ-SEC-014, REQ-UX-020)

### Adapter registry (`@hub/domain` `INTEGRATION_ADAPTERS`)

| Key | Direction | OAuth scopes (least privilege) | Check | Manual alternative while unavailable |
| --- | --- | --- | --- | --- |
| `m365_outlook_mail_send` | send | `Mail.Send` | outbound endpoint | in-app notifications |
| `m365_teams_message_send` | send | `ChannelMessage.Send` | outbound endpoint | in-app notifications |
| `m365_teams_meetings_read` | read | `OnlineMeetings.Read` | outbound endpoint | import wizard |
| `m365_sharepoint_read` | read | `Sites.Selected` | outbound endpoint | upload documents |
| `m365_sharepoint_write` | write | `Sites.Selected` | outbound endpoint | export and upload |
| `inbound_webhook` | read | — | signed ping from the sender | import wizard |

Honest status: `not_configured` → (save) `configured_unverified` → (real check succeeds) `verified` / (fails) `failed`;
`disabled` by an administrator. Saving a configuration always resets to *configured — not verified* and disables the
connector. Only a successful check (an outbound HTTPS request through the egress guard, or a validly signed inbound ping)
sets `verified`; enabling requires `verified`. Nothing else can mark a connector verified (tested).

- **Read vs write / send (REQ-INT-007).** Read connectors never hold a write/send scope and `sendRefusal` refuses any send
  through them, whatever their status. A send additionally needs `verified` + `enabled` + an approved sending authority +
  an approved destination. None exists in this build, so every external send is refused and recorded.
- **Secrets.** Only a *reference* to a secret-store entry is stored (`HUB_INTEGRATION_SECRET_<NAME>`); a value that is
  not a reference is refused. Secrets never appear in responses, logs or audit.
- **Execution log.** Every configure / test / enable / disable / receive / process / reconcile / retry / send attempt is
  written to `integration_execution_log` (append-only: UPDATE/DELETE revoked and refused by trigger), with outcome and
  code; refusals are logged even though the command's transaction is rolled back.

### Egress guard — SSRF prevention (C-18)

`EgressClient.probe` is the only outbound HTTP client of the module:

1. URL guard: `https:` only, port 443 only, no credentials in the URL, host never internal (loopback, private, link-local,
   carrier-grade NAT, unique-local, IPv4-mapped / NAT64 / 6to4 forms, cloud metadata names and addresses), host on the
   organisation **egress allow-list** (`HUB_EGRESS_ALLOWLIST`, empty by default → no outbound connection is possible).
2. DNS resolution; **every** resolved address must be public (anti DNS-rebinding).
3. Connect to the **checked address** with the URL's host for SNI / `Host`.
4. Redirects are a failure, never followed; timeouts and HTTP errors are recorded.

### Inbound signed webhooks (REQ-INT-009/010, C-39)

`POST /api/v1/webhooks/:adapterKey` (public route, raw body ≤ 256 KiB) with headers `x-hub-timestamp` (unix seconds),
`x-hub-delivery-id` and `x-hub-signature: sha256=<hex>` = HMAC-SHA256(secret, `<timestamp>.<deliveryId>.<raw body>`).

- Unsigned, wrongly signed, or timestamp outside ±300 s → refused (401) and logged; the comparison is constant-time.
- The delivery id is the replay nonce (unique per organisation and connector): a duplicate is acknowledged
  (`duplicate`) and **not processed again**.
- Processing is a worker job (idempotency key per delivery, up to 4 attempts, exponential backoff with jitter,
  dead-letter). A reconciliation schedule (every 10 minutes, created with the first inbound connector) marks deliveries
  that never completed as `failed`; failures raise an `integration.alert` outbox event → in-app notification to platform
  administrators (failure monitoring). A failed delivery can be retried explicitly.
- Tested with a local test sender only (`test/integrations/integrations.spec.ts`); no external service is contacted.

### Future integrations — documented only (REQ-INT-008)

No adapter code, credential, endpoint or network path exists for these. They appear in the registry as
`documented_only` (status *Not configured*, cannot be configured) so that the screen shows what is missing.

| System | Intended use (later phase) | Direction | Missing before any access |
| --- | --- | --- | --- |
| ERP / Finance | Budget and actuals feed for the finance module | read | approved endpoint, agreed data contract, security and owner approval |
| HR | People and organisation data for transfers and readiness (personal data: PDPL assessment MQ-19 first) | read | approved endpoint, data contract, approval, privacy assessment |
| ITSM / service desk | Incidents and changes linked to cut-over and transitional services | read | approved endpoint, data contract, approval |
| DCIM | Data-centre asset inventory for the carve-out perimeter | read | approved endpoint, data contract, approval |
| External VDR | Exchange with an external data room for due diligence | read | approved endpoint, data contract, approval, clean-team rules |

Until then the manual alternatives are the import wizard (exported files), document upload, and manual entry.

## 5. Notifications (REQ-PLT-008, REQ-INT-012, REQ-GOV-012)

- Produced by worker jobs from **outbox events** (`agenda_request.screened`, `change_request.decided`,
  `decision.status_changed` (outcomes), `approval.pending` (import batches), `import.decided`, `integration.alert`) into
  the existing `notification` table — one row per event, kind and recipient (dedupe key `evt:<eventId>:<kind>:<user>`).
- A notification stores a **message code + parameters** (record codes, enum values, counts — never titles or content)
  and a deep link; the web composes the text in the reader's language. The content is read behind the link with a fresh
  permission check.
- **Recheck at every send (REQ-INT-012):** the recipient is re-resolved now (`forUser`: active, still a member, current
  roles and clearance) and must still be able to read the source record; otherwise nothing is delivered and
  `notifications.delivery.suppressed` is audited with the reason.
- **Recheck at read:** the inbox and unread count list only notifications whose source the reader can still see (SQL
  visibility per project), so a revoked recipient sees nothing.
- **External channels:** e-mail and Teams go through the connector send gate and the delivery ledger; with no verified
  connector and no sending authority the ledger records `disabled` and no message is sent. SMS has no adapter. The
  channels panel shows these statuses honestly.
- AI notifications keep their own semantics (platform-marked text, `ai_proposal` linkage); the AI suites pass unchanged.

## 6. Evidence

| Rule | Test |
| --- | --- |
| Wizard, validation report, duplicates, preservation with hash, approval | `test/imports/import-wizard.spec.ts` |
| Governed records → change requests; AT-01; rollback; approver authority | `test/imports/import-governance.spec.ts` |
| AT-25 (quarantine, zip bomb, XXE, path traversal, formulas, internal URLs, time and memory limits) | `test/imports/at-25-import-safety.spec.ts` |
| Documents → unverified claims; compare-before-merge | `test/imports/import-documents.spec.ts` |
| Isolation of imports, notifications and jobs | `test/imports/at-03-imports-notifications-isolation.spec.ts` |
| Notifications from the outbox, suppression, revocation | `test/notifications/notifications.spec.ts` |
| Honest status, scopes, read/send separation, SSRF, webhooks | `test/integrations/integrations.spec.ts` |
| Wizard happy path, parser refusal, egress refusal, Arabic screens (detector + axe) | `e2e/tests/p6-imports.spec.ts` |
