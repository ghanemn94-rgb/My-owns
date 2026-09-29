# Threat Model — Mobily Transformation & Transactions Hub

| Field | Value |
|---|---|
| Version / date | 0.1 (P0 draft), 2026-09-29 |
| Status | **Draft for P0 review. Designed only.** No control in this document is implemented or tested yet. The code is being scaffolded now. Every control carries status **Designed (P0)** and a target phase. |
| Author | security-privacy-reviewer (authoring mode). An author cannot approve their own work, so independent review is required (solution-architect + qa-test-engineer, separate contexts). |
| Method | STRIDE per trust boundary and per data flow. Inherent ratings (Likelihood × Impact) are given before controls. Every mitigation maps to a named design control (C-xx) and a verification (AT-xx acceptance scenario, SEC-T-xx security test, or AIT-xx AI threat case). |
| Spec inputs | `docs/MASTER_PROMPT.md` §§5, 7.4, 8, 11, 12, 13–17, 20; `CLAUDE.md` (architecture, isolation, API conventions); lead's P0 architecture decisions (modular monolith, PostgreSQL-only jobs, server-side sessions, RBAC+ABAC, RLS, append-only audit, AI modes/gateway) |
| Companion docs | `access-matrix.md` (permissions and conditions), `ai-threat-cases.md` (AIT-xx), `control-applicability-matrix.md`, `incident-response-runbook.md` |
| Not claimed | This is not a compliance statement, a penetration test, or a statement about Mobily's infrastructure. Where the design depends on Mobily systems (IdP, network, backup, SIEM, key management, support model), those parts are recorded as **assumptions requiring Mobily input** (§12). |

---

## 1. Scope

**In scope:**
- Application components: browser clients (internal and external partner), Next.js web tier, NestJS API, worker, PostgreSQL, object storage adapter.
- Integration adapters: IdP (OIDC; SAML via broker), AI policy gateway and model providers, SMTP/Teams adapters, audit/log export.
- The backup store and privileged/support access paths.
- All four deployment modes of master prompt §16.

**Out of scope, recorded only as assumptions:**
- Mobily enterprise controls: network zoning, endpoint security, IdP internals, SOC/SIEM operations, physical security, key management hardware.
- Data-centre devices. The platform never controls DC devices, networks or power (§7.4). It only records evidence.

**Rating scheme (inherent, before controls):**

| | Impact L | Impact M | Impact H |
|---|---|---|---|
| **Likelihood H** | Medium | High | Critical |
| **Likelihood M** | Low | Medium | High |
| **Likelihood L** | Low | Low | Medium |

- Impact **H**: disclosure of confidential or higher transaction data (valuation, negotiation, clean-team, partner identity); an unauthorized approval, waiver or closing; loss of evidence integrity; cross-project/partner leakage; privileged compromise.
- Impact **M**: limited disclosure of internal data, or a recoverable integrity/availability issue.
- Impact **L**: nuisance.

---

## 2. System context

```
                      ┌──────────────────────── Mobily-controlled environment (assumed; Mobily to confirm) ─────────────────────────┐
 Internal users ──TB-01──►│ Ingress / reverse proxy (TLS, WAF?) ──► Next.js web (SSR, same-origin proxy) ──TB-02──► NestJS API (main.ts)   │
 (corporate network)      │                                                                                  │  ▲                         │
                          │                                                                    TB-03 SQL (RLS)│  │ TB-14 jobs/outbox       │
 External partner ─TB-01──►│  (internet-facing path only if external access is approved — MQ-05)              ▼  │                         │
 users (partner rooms)    │                                                  PostgreSQL 16 (source of truth) ◄──── Worker (worker.ts)       │
                          │                                                         │                        │   │   │                    │
                          │                                     TB-09 backup        │      TB-04 objects      │   │   │ TB-08 untrusted    │
                          │                                                         ▼                        ▼   │   │ file parsers       │
                          │                                             Backup store (location: MQ-09)  Object store (S3-compatible / FS) │
                          │                                                                                      │   │                    │
                          │   Operators / DBAs / vendor support ──TB-10──► (shell, DB console, admin UI)         │   │                    │
                          └──────────────────────────────────────────────────────────────────────────────────────┼───┼────────────────────┘
                                                        TB-05                     TB-06                       TB-07    TB-11
                                              Enterprise IdP (OIDC/        AI policy gateway ─► model      SMTP relay /   External log store /
                                              SAML broker, MFA)            provider (local endpoint OR     Teams (Graph)  SIEM (audit export)
                                                                           approved external provider)
   Logical in-app boundaries: TB-12 internal users ↔ partner-room/external users · TB-13 Project A ↔ Project B
```

**Component trust levels**

| Component | Trust | Notes |
|---|---|---|
| Browser (internal) | Untrusted input; authenticated principal | All authorization is server-side. The UI hides nothing that the API would allow. |
| Browser (external partner) | Untrusted; least-privileged principal | Counterparty-bound; room-only (access-matrix §2.8) |
| Next.js web | Semi-trusted presentation tier | Holds **no** secrets or service credentials. It forwards the user's cookie only. It is never an authorization point (C-42). |
| NestJS API | Trusted enforcement point | AuthGuard, `PolicyService.assert`, contract validation, domain rules, a single transaction with audit and outbox |
| Worker | Trusted, but acts **later** | Re-authorizes at execution (C-13). The AI runtime runs here. |
| PostgreSQL | Trusted store | RLS is defence in depth. The owner and superuser bypass RLS (RR-01). |
| Object store | Trusted store, untrusted content | Private bucket; downloads only via the API |
| IdP | Trusted for authentication | MFA is enforced at the IdP (Mobily) |
| AI gateway / provider | **Untrusted output**; trusted only to process data within approved ceilings | Model output is data, never authority |
| SMTP / Teams | Delivery channel outside platform ACL | Once delivered, content is outside the platform's control |
| Backup store, support access | Trusted by assumption | These are separate data flows (DF-11, DF-12) |

---

## 3. Trust boundaries

| ID | Boundary | What crosses | Enforcement at boundary |
|---|---|---|---|
| TB-01 | Browser ↔ ingress/web/API | HTTP requests, cookies, uploads, downloads | TLS, session cookie, CSRF, CSP/headers, rate limits, contract validation |
| TB-02 | Web (Next.js server) ↔ API | Proxied requests with the user's cookie; SSR fetches | The API is the only authorization point; the web tier has no credentials; no shared data cache |
| TB-03 | API/worker ↔ PostgreSQL | SQL under `hub_app` role | Transaction-local `app.org_id/user_id/project_ids`, RLS FORCE, composite FKs, parameterised queries |
| TB-04 | API/worker ↔ object store | Object PUT/GET by random key | Private bucket; credentials only in API/worker; checksum |
| TB-05 | API ↔ IdP | OIDC auth code, tokens, claims | PKCE, state, nonce, token validation, (iss, sub) binding |
| TB-06 | Worker ↔ AI policy gateway ↔ provider | Prompt context (retrieved chunks), tool results, model output | Classification ceiling per destination, DLP, approved destinations, egress allowlist |
| TB-07 | Worker ↔ SMTP/Teams | Notification payloads | Destination allowlist, send authority, recipient re-authorization, content minimisation |
| TB-08 | Uploaded/imported files ↔ parsers | Untrusted bytes (XLSX/CSV/PDF/DOCX/images) | Validation, quarantine, scan, value-only parsing, sandbox, no network |
| TB-09 | Data tier ↔ backup store | Full DB and object copies | Encryption, separate credentials, restore procedure |
| TB-10 | Operators/support ↔ production | Shell, DB console, logs, admin UI | PAM/JIT (Mobily), least-privilege DB roles, audit |
| TB-11 | App ↔ external log store/SIEM | Audit and security events | Payload minimisation, sequence and chain continuity |
| TB-12 | Internal ↔ partner-room/external users (logical) | Disclosed documents/answers, DD questions, submissions | Room grants, counterparty binding, disclosure release, external projections |
| TB-13 | Project A ↔ Project B (logical tenancy) | Any record, count, search hit, AI context, notification | Scope + RLS + composite FK + 404 + in-SQL predicates |
| TB-14 | API ↔ worker via `job` / `outbox_event` / `scheduled_job` | Intents that execute later | Refs only (no permission snapshots), re-authorization at execution, idempotency |

---

## 4. Data flows

### 4.1 Flow inventory

Hosting (DF-13), AI processing (DF-07), backups (DF-11) and technical-support access (DF-12) are modelled as **separate flows**, as required by master prompt §15.

| ID | Flow | Path | Data classes | Boundaries | Can data leave the Mobily-controlled environment? | Key controls |
|---|---|---|---|---|---|---|
| DF-01 | Interactive use | Browser → ingress → web → API → PostgreSQL/object store → back | All classes up to the user's clearance | TB-01/02/03/04 | Only to the user's own device (downloads). Unmanaged devices are Mobily policy (MQ-14). | C-02, C-03, C-05–C-09, C-15, C-26, C-42 |
| DF-02 | Authentication | Browser ↔ IdP ↔ API callback → `session` row | Identity claims (name, email, groups), auth time | TB-05 | **Yes, if the IdP is cloud-hosted.** Identity data is processed by the IdP operator (MQ-02). | C-01, C-02, C-41, C-45 |
| DF-03 | Document upload / download | Browser → API → quarantine → scan → object store; download is streamed by the API | Documents up to strictly_confidential | TB-01/04/08 | Download to the user's device. The scanner could be external if a SaaS scanner is chosen (MQ-11). | C-14, C-15, C-40 |
| DF-04 | Partner disclosure | Internal release → disclosure record → external user views/downloads | Released items only | TB-12, TB-01 | **Yes, by design**: to partner devices and organisations. No recall after download (RR-03). | C-06 (room), C-32, access-matrix §2.4 |
| DF-05 | Import | Browser → API → staging (worker parse) → validation → human approval → merge | Plans, registers, financial outputs, source claims | TB-08 | No; URLs are never fetched | C-16, C-43, C-18 |
| DF-06 | Background jobs / outbox | API transaction → `job`/`outbox_event` → worker claim → effect | References; derived content produced at execution | TB-14 | Only via DF-07/08/10 | C-12, C-13 |
| DF-07 | **AI processing** | Worker: retrieval (in-SQL ACL) → prompt assembly → **policy gateway** → provider → output → proposal → approval → execution | Retrieved chunks, record fields, prompts, outputs, tool results | TB-06, TB-14 | Depends on mode. **Off**: no. **Local**: stays wherever the local endpoint runs (verify it is inside). **Approved gateway**: **yes**, to the provider's processing locations with its retention. Requires Mobily approval (MQ-06, MQ-07). | C-19–C-24 |
| DF-08 | Notifications | Worker → SMTP relay / Teams → recipients | Title-level text + deep links (C-33) | TB-07 | **Yes, potentially.** The mail and Teams tenancy may be cloud-hosted; external recipients are blocked by default (MQ-12). | C-33, C-12 |
| DF-09 | Reporting / export / BI | Snapshot → renderer → download; BI views via `hub_bi` | Aggregates up to snapshot classification | TB-01/03 | Download to device; the BI tool location is Mobily's (MQ-13) | C-17, C-31, access-matrix §2.6 |
| DF-10 | Audit / security event export | `audit_event` → exporter → external log store/SIEM | Event metadata; payloads minimised | TB-11 | Depends on SIEM location (MQ-10) | C-10, C-11 |
| DF-11 | **Backups and restore** | PostgreSQL base backups/WAL + object copies → backup store; restore back | **Everything**, including audit and documents | TB-09 | **Possibly.** Off-site or cloud backup targets, third-party operators, and out-of-Kingdom replicas are Mobily decisions (MQ-09). | C-34 |
| DF-12 | **Technical support and operations access** | Operators/vendor → PAM → shell/DB console/logs/admin UI; diagnostics bundles | Potentially everything (superuser bypasses RLS) | TB-10 | **Possibly.** Remote vendor sessions, support tickets with attachments, screen sharing, vendor staff outside KSA (MQ-08). | C-35, C-36, C-37 |
| DF-13 | **Hosting / platform operation** | Cluster, nodes, storage, network, registry, telemetry | Everything at rest and in memory | All | **Possibly.** A private cloud operated by a third party, image pulls, and platform telemetry (MQ-03, MQ-04) | C-18, C-38 |

### 4.2 Internal hosting does not prove that data stays inside

Even if the application and database are hosted inside Mobily, the following paths can still move data out. Each needs an explicit Mobily decision before production.

| # | Path | What can leave | Default in this design | Mobily decision needed |
|---|---|---|---|---|
| 1 | AI gateway to an external provider (DF-07) | Retrieved chunks, prompts, outputs | AI **Off** by default. The external gateway ceiling is `internal`. Strictly_confidential and clean-team content go to no provider (C-19). | Approved providers, processing location, retention, ceilings (MQ-06/07) |
| 2 | Backups (DF-11) | Full copies | Encrypted; the target is not assumed | Backup location, operator, keys (MQ-09) |
| 3 | Support access (DF-12) | Anything visible to the operator | No standing vendor access; PAM/JIT assumed | Support model and location (MQ-08) |
| 4 | Email / Teams (DF-08) | Notification text | Title-level text only; internal recipients only | Tenant region, destinations (MQ-12) |
| 5 | Cloud IdP (DF-02) | Identity claims | Minimal claims requested | IdP hosting (MQ-02) |
| 6 | Malware scanner / OCR / conversion service (DF-03/05) | Full documents | Local/sandboxed engines preferred (C-44) | Engine choice (MQ-11) |
| 7 | Telemetry and crash reporting | Metadata, sometimes payloads | Disabled: `NEXT_TELEMETRY_DISABLED=1`, no third-party APM; OTel only to an internal collector (C-18, C-37) | Collector location (MQ-10) |
| 8 | Browser-side third parties | IP address, page URLs | No external fonts, CDNs, analytics or maps; CSP `connect-src 'self'` (C-26) | none |
| 9 | Partner disclosure (DF-04) | Released items | Release is explicit, human-approved and audited | Whether partners use the platform or an external VDR (MQ-05) |
| 10 | User downloads to unmanaged devices | Documents, exports | Audited download; no DRM promise | Endpoint/DLP policy (MQ-14) |
| 11 | Build and supply chain | Source and dependency metadata (not business data) | Private registry mirror planned (C-38) | Registry (MQ-04) |

### 4.3 Deployment-mode differences (master prompt §16)

| Mode | DF-07 AI | Egress allowlist (proposed) | Notes |
|---|---|---|---|
| Local development | Off or `mock` (labelled Simulated) | None required | Synthetic data only; dev login allowed only with `HUB_MODE=demo` |
| Mobily Private — AI Off | None | IdP, SMTP relay (if enabled), SIEM, object store | AT-21 and AT-22 must pass |
| Mobily Private — Local AI | `openai-compatible` to an internal endpoint | + local model endpoint (internal) | Verify that the endpoint really is internal (DNS/IP), and measure quality |
| Mobily Private — Approved AI Gateway | `anthropic` through the approved gateway | + gateway host only | Processing location, retention and cost approved by Mobily |

---

## 5. Assets and classification

### 5.1 Assets

| ID | Asset | Default classification | Primary property | Where it lives | Principal threats |
|---|---|---|---|---|---|
| A-01 | Session and CSRF tokens | secret | C, I | Cookie; `session` (hash only, D-02) | T-01, T-02, T-03 |
| A-02 | Secrets: DB roles (owner/app/bi), OIDC client secret, session/CSRF HMAC keys, AI gateway key, object-store keys, SMTP/Graph credentials, webhook secrets, audit-export credentials | secret | C | Secret manager / env (C-25) | T-68, T-50 |
| A-03 | Transaction documents and versions (VDR content) | up to strictly_confidential | C, I | Object store + `document*` tables | T-14, T-22, T-56, T-59 |
| A-04 | Clean-team material and outputs | strictly_confidential + `clean_team` | C | Clean-team rooms | T-59 |
| A-05 | Deal data: valuation references, ownership scenarios, negotiation positions, partner identities and proposals (possibly market-sensitive, MQ-16) | restricted to strictly_confidential | C | `jv_*`, `finance_*` | T-56, T-63, AIT-21 |
| A-06 | Governance records: decisions, votes, recusals, minutes, authority matrix | confidential | **I**, C | `governance_*` | T-03, T-18, T-71, T-72 |
| A-07 | Gates, CPs, waivers, evidence links, closing records | confidential/restricted | **I** | `gates_*`, `jv_cp*` | T-24, AIT-22/23 |
| A-08 | Audit log and security events | inherits subject | **I** | `audit_event`, export | T-19, T-53, T-54 |
| A-09 | Personal data: user identities, employee transfer data (People workstream), partner contact persons | confidential (hr/legal domain) | C | Various | T-73, DF-02, DF-11, DF-12 |
| A-10 | AI artefacts: prompts, outputs, `document_chunk` index, summaries, memory, proposals, approvals | max of sources | C, I | `ai_*`, `document_chunk` | AIT-06…AIT-19 |
| A-11 | Report snapshots, exports, meeting packs | max of inputs | C, I | `report_snapshot`, object store | T-42, SEC-T-34 |
| A-12 | Import files and staging rows | as source | I | Quarantine + staging | T-40–T-45 |
| A-13 | Security-relevant configuration: egress allowlist, AI mode/provider/ceilings, authority-matrix activation, connector destinations, `HUB_MODE` | internal | **I** | Config + DB | T-30, T-32, T-71 |
| A-14 | Jobs and outbox (future intents) | refs | I | `job`, `outbox_event`, `scheduled_job` | T-64–T-67 |
| A-15 | Backups | highest contained | C, A | Backup store | T-47–T-49 |
| A-16 | Source register and verification statuses | internal/confidential | **I** | `source_*`, `source_claim` | T-43, T-45 |
| A-17 | Platform availability (committee operations, reporting) | — | A | All | T-08, T-21, T-66 |

### 5.2 Handling rules by classification (proposed; mapping to Mobily's scheme is MQ-01)

| Level | Examples | AI: external gateway | AI: local provider | Notification body | Export | External disclosure |
|---|---|---|---|---|---|---|
| public | Approved public statements | allowed | allowed | allowed | allowed | allowed |
| internal | WBS, tasks, RAID, readiness | allowed only if Mobily approves the provider | allowed | title-level | allowed | via release only |
| confidential | Decisions, perimeter, agreements, TSA | **blocked** by default | allowed | title only, no body | audited | via release only |
| restricted | Financial snapshots, DD findings, partner list | blocked | allowed only if the project enables it (MQ-07) | reference only ("You have 1 item to review") | audited, snapshot-bound | release + clearance grant |
| strictly_confidential | Valuation models, negotiation positions, ownership scenarios | blocked | **blocked** by default | reference only | audited; restricted to cleared roles | exceptional; sponsor clearance grant |
| clean_team flag | Clean-team material | blocked | blocked; not indexed (D-09) | none | clean-team room members only | never, except released outputs |

---

## 6. Security control catalogue

All controls are **Designed (P0)**. "Phase" is the phase in which the control must be implemented and verified.

| ID | Control (concrete design) | Phase |
|---|---|---|
| C-01 | **OIDC sign-in** via openid-client: authorization code + PKCE, `state` + `nonce`, ID-token validation (iss, aud, exp, iat, nonce, signing-alg allowlist, never `none`), accounts bound by **(iss, sub)**, never by email. MFA is enforced at the IdP; `acr`/`amr` are checked when the IdP provides them. SAML goes via the IdP broker only. Post-login `returnTo` accepts relative in-app paths only. | P1 (mock IdP) / P7 (enterprise) |
| C-02 | **Server-side sessions**: 256-bit CSPRNG token; only its SHA-256 is stored in `session` (D-02). Cookie `hub_session` is httpOnly, Secure (prod), SameSite=Lax, Path=/. The session is rotated at login and on privilege change. Idle and absolute expiry (proposed internal 30 min / 10 h, external 15 min / 8 h; MQ-15). A DB lookup on every request, so revocation is immediate. | P1 |
| C-03 | **CSRF**: double-submit `hub_csrf` cookie + `x-csrf-token` header on every non-GET/HEAD/OPTIONS request. The token is HMAC-bound to the session id (D-03). `Origin` (or `Sec-Fetch-Site`) must be same-origin. GET never mutates. | P1 |
| C-04 | **Dev-login and unsafe-config guard**: dev login is compiled in but enabled only when `HUB_MODE=demo`. Config validation refuses to boot in production when any of these hold: dev login, `mock` AI provider, default/sample secrets, missing scanner without recorded risk acceptance (D-10), telemetry enabled, non-TLS public URL, demo authority policy. | P1 |
| C-05 | **Deny-by-default policy engine**: every route is declared with `defineRoute` and exactly one permission, and boot fails otherwise. `PolicyService.assert(ctx, permission, resource)` runs in every command and query. The matrix lives in `packages/domain/src/policy/` (`access-matrix.md`). | P1 |
| C-06 | **ABAC conditions** `classification`, `room`, `clean_team`, `not_self`, `authority`, `own_workstream` with the semantics of access-matrix §2.4, plus the universal attribute rule (§2.4.1) | P1 (classification, not_self), P2 (authority), P4 (room, clean_team) |
| C-07 | **Data-model isolation**: `org_id` + `project_id` on project-scoped tables; composite FKs `(project_id, id)`; `assertSameProject` on every submitted foreign ID | P1 |
| C-08 | **PostgreSQL RLS**: policies on every table with `project_id`; `ENABLE` + `FORCE ROW LEVEL SECURITY`. The `hub_app` role is not owner and has `NOBYPASSRLS`. Settings use transaction-local `set_config(..., true)`. Policies read `current_setting('app.project_ids', true)` and **fail closed** (no rows) when it is unset. D-01 adds `app.room_ids` for room-bound tables. | P1 |
| C-09 | **404-not-403 and scoped aggregates**: identical not-found bodies; `total`, facets, dashboards, search and AI retrieval computed in SQL with the same predicates; uniqueness scoped per project; 409 never names the other record | P1 |
| C-10 | **Audit**: append-only `audit_event` (trigger rejects UPDATE/DELETE; `hub_app` has INSERT/SELECT only, no TRUNCATE). Hash chain (`prev_hash`, row hash over canonical JSON), serialised by an advisory lock. Periodic export to an external log store with sequence numbers and chain anchor. Sensitive reads (`auditRead`) audited in the same transaction, so a failed audit write means a failed read. Tamper-**evident**, not tamper-proof. | P1 (append-only + chain) / P7 (export) |
| C-11 | **Audit payload minimisation**: before/after field diffs. For fields classified above `internal`, only field names and hashes are exported to the SIEM. Audit reads are redacted to the reader's clearance. | P1 / P7 |
| C-12 | **Durable jobs/outbox**: written in the same transaction as the change; idempotency keys; `FOR UPDATE SKIP LOCKED` with leases; exponential backoff; max attempts; dead-letter; per-project fairness. The delivery state machine includes `uncertain`, which leads to **reconciliation**, never a blind resend. | P1 / P2 |
| C-13 | **Worker re-authorization**: jobs carry actor/delegator IDs and target refs only (no permission snapshots, no content). At execution the worker recomputes account status, assignments, room grants, clearance and project AI mode. The kill switch and connector status are checked before each side effect. | P2 / P5 |
| C-14 | **Upload pipeline**: size caps; extension allowlist plus magic-byte sniffing; macro-enabled Office files (`.xlsm`, `.docm`, `.pptm`) and executables refused. The filename is NFC-normalised, with bidi/zero-width/control characters stripped and length capped, and it is **never** used as a storage path. The storage key is random (D-05). Files are quarantined until the scanner adapter passes them; per-user quotas apply. | P2 / P6 |
| C-15 | **Download endpoint**: authorize, then stream. `Content-Disposition: attachment` (RFC 5987 filename), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: no-store`. HTML and SVG are never rendered inline. The checksum is verified before evidence is served (C-40). | P2 |
| C-16 | **Spreadsheet import safety**: exceljs reads **values only**. Formulas are never evaluated; a cached result is stored as untrusted text with a flag. External links, data connections and hyperlinks are stored inert. Zip limits (compressed and uncompressed size, entry count, ratio) and row/column/sheet caps apply. Parsing runs in the worker under time and memory limits. The import worker has no network egress, and URLs are **never fetched**. | P6 |
| C-17 | **Export formula-injection neutralisation**: in XLSX and CSV, any text cell whose first non-space character is `=`, `+`, `-`, `@`, TAB or CR (and the full-width `＝＋－＠`) is written as text with a leading `'` | P6 |
| C-18 | **Egress control**: in private mode a default-deny network policy with an allowlist (IdP, SMTP relay, AI gateway, object store, SIEM). An in-app HTTP client wrapper refuses non-allowlisted hosts and private, link-local and metadata IPs for any configured URL; it resolves, checks, then connects to the checked IP (anti-DNS-rebinding). No external fonts, CDNs or telemetry; `next/image` remote patterns are disabled. | P1 (wrapper) / P7 (network) |
| C-19 | **AI policy gateway**: a classification ceiling per destination; domain, room and clean-team exclusions; approved-destination list; DLP pattern scan (secondary control); refusals are logged. Defaults are in §5.2. | P5 |
| C-20 | **AI tool containment**: typed, narrow tools; no shell, raw SQL or deploy credentials; project/room scope bound from the run context (model-supplied IDs are ignored for scoping); prohibited actions have **no tool**; policy `ai` flag enforced (access-matrix §2.7) | P5 |
| C-21 | **AI approval binding**: the proposal stores the canonical-JSON SHA-256 of its payload, target ID and version, recipients, approver ID and expiry. Approval is single-use; any change invalidates it; execution re-checks everything. | P5 |
| C-22 | **AI kill switch, budgets, circuit breaker**: an org/project stop checked at job claim, before each tool call and before each send; unsent messages cancelled; token, cost and time budgets; a circuit breaker on provider errors; deterministic features unaffected | P5 |
| C-23 | **Retrieval ACL in SQL**: `document_chunk` carries denormalised `project_id`, `room_id`, `classification`, `clean_team` and joins the live document/version ACL state. The predicate sits in the `WHERE` clause before ranking. RLS applies on `document_chunk`. Clean-team and partner rooms are not indexed by default (D-09). | P5 |
| C-24 | **Derived-data classification and invalidation**: derived items carry max classification (access-matrix §2.6). A per-user/project permission epoch (D-08) keys all caches and AI memory. Grant, revoke, reclassify and delete events emit outbox events that purge chunks, summaries and memory. | P5 |
| C-25 | **Secrets management**: secrets come only from env or the secret-manager adapter; never in the repo, client bundle, logs or test reports. Log redaction covers cookies, `authorization` and tokens. Rotation runbook in the IR runbook §6.6. | P1 / P7 |
| C-26 | **HTTP security headers**: strict CSP (nonce-based `script-src`, no `unsafe-inline`, `img-src 'self' data:`, `connect-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`), HSTS (prod), `Referrer-Policy: no-referrer`, a minimal `Permissions-Policy`, and `Cache-Control: no-store` on authenticated pages and API responses | P1 — **partial**: `no-store` on every API response, static security headers and CSP without external sources are in place; nonce-based `script-src` (no `unsafe-inline`) is open (SEC-P1-08, target P7) |
| C-27 | **Output encoding**: React escaping. Lint bans `dangerouslySetInnerHTML` except in one sanitised Markdown renderer (no raw HTML, links restricted to internal routes, no external images) used for rich text and AI output. User text is bidi-isolated (`<bdi>` / `unicode-bidi: isolate`). | P1 / P5 |
| C-28 | **Rate and resource limits**: per-user and per-IP limits on the login callback, mutations, search, exports, downloads and AI; `statement_timeout` and `idle_in_transaction_session_timeout` on `hub_app` (D-13); `pageSize ≤ 100`; export size caps | P1 / P7 |
| C-29 | **Separation of duties and governance integrity**: `not_self` and `selfIds` (access-matrix §5); recusal; quorum and majority computed on the server from membership at the vote timestamp; one vote per member per decision (unique constraint); production approvals refused until an approved authority matrix is active; step-up auth for high-impact actions (C-46) | P2 |
| C-30 | **Optimistic concurrency**: `version` + `expectedVersion`; mismatch returns 409 | P1 |
| C-31 | **Retention and legal hold**: a hold blocks archive, dispose and import rollback at DB level (trigger/constraint) and in the service; disposal is authority-conditioned and audited | P3 / P6 |
| C-32 | **External-user hardening**: separate account type bound to one counterparty; **separate external DTO serializers** (not field filtering of internal DTOs); no directory, AI or internal notifications; shorter sessions; distinct IdP issuer/realm (D-14); download watermark where supported; grants expire (D-16) | P4 |
| C-33 | **Notification minimisation**: notifications store references and render at read time with re-authorization. Email/Teams bodies carry title-level text ≤ `internal` plus a deep link. Recipients are re-checked at send time. External domains are blocked by default. | P2 / P6 |
| C-34 | **Backup protection and safe restore**: encryption with Mobily-managed keys; separate backup credentials. The restore runbook invalidates all sessions (rotate the HMAC key and clear `session`), quiesces jobs/outbox (paused state, then reconciliation), and re-applies access revocations recorded after the backup point from the external audit export. Restore tests. | P7 |
| C-35 | **Privileged and support access** (procedural, Mobily PAM): no standing vendor DB access; break-glass accounts; JIT, time-boxed, ticket-linked, recorded sessions; production data never copied to dev/test; support bundles exclude content | P7 |
| C-36 | **DB privilege separation**: `hub_owner` (migrations, table owner), `hub_app` (API + worker; DML only; `NOBYPASSRLS`; no DDL), `hub_bi` (selected views only). Views use `security_invoker = true`. No `SECURITY DEFINER` without security review. A CI schema lint enforces this (SEC-T-40). | P1 |
| C-37 | **Logging hygiene and errors**: structured logs with correlation ID; no document content, prompts, AI outputs, cookies or tokens; RFC 7807 errors without stack traces, SQL or secrets; OTel spans carry no content attributes and export only to an internal collector | P1 |
| C-38 | **Supply chain and runtime hardening**: committed lockfile; SBOM; vulnerability and licence scans; private registry; non-root images compatible with an arbitrary UID; read-only root FS; dropped capabilities; no package managers or shells in production images where feasible | P7 |
| C-39 | **Inbound webhooks**: HMAC signature, timestamp tolerance, nonce replay store, idempotency | P6 |
| C-40 | **Evidence integrity**: SHA-256 per `document_version` recorded at upload and verified on evidence verification and download. A mismatch blocks the file and raises a security event. Object versioning / object lock where available (MQ-11). | P2 / P7 |
| C-41 | **Trusted proxy configuration**: fixed public base URL from config (OIDC redirect, email links); `X-Forwarded-*` trusted only from the configured proxy hop; audit IP taken from the trusted header | P1 |
| C-42 | **Next.js tier constraints**: the web tier holds no secrets or service credentials and forwards the user cookie only. **Authorization is never implemented in Next.js middleware or layouts** (the API decides). No mutating Server Actions. Authenticated fetches are `no-store`, so there is no shared data or full-route cache for user data. Rewrites go only to a fixed internal API origin. `next/image` remote loading is off. | P1 |
| C-43 | **Import merge governance**: an import cannot change approved records (decisions, approvals, baselines, verified CPs) outside change control. Extracted values enter as `proposed` or `historical_unverified`. Approval is `not_self`. Batch history and rollback are kept. | P6 |
| C-44 | **Sandboxed conversion and OCR**: a separate container with no network, seccomp, CPU/memory/time limits and non-root user. Its outputs are untrusted text. | P6 |
| C-45 | **Access lifecycle**: expiring room and clearance grants; a periodic access-review report (assignments, grants, clearances, dormant accounts); IdP deprovisioning triggers session revocation (back-channel logout or SCIM, MQ-02) | P7 |
| C-46 | **Step-up authentication** (D-04) for permissions with `not_self` + `authority` in production: OIDC re-authentication with `max_age` (proposed 10 min) | P7 (depends on MQ-02) |
| C-47 | **Query safety**: parameterised Drizzle queries only; full-text search via `websearch_to_tsquery`/`plainto_tsquery` with bound parameters; sort/filter keys come from contract allowlists; lint forbids `sql.raw`/dynamic identifiers built from request data | P1 |

---

## 7. Threats by trust boundary (STRIDE)

The L, I and Risk columns give inherent ratings. Verifications are described in §9 (SEC-T), master prompt §20 (AT) and `ai-threat-cases.md` (AIT).

### TB-01 Browser ↔ ingress / web / API

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-01 | S | Session token theft (XSS, endpoint malware, shared device, proxy logs) replayed as the victim, e.g. a sponsor | M | H | High | C-02, C-26, C-27, C-37, C-46 | SEC-T-11, SEC-T-23, SEC-T-24 |
| T-02 | S | Session fixation / login CSRF: the victim is bound to the attacker's account and uploads confidential files into it | L | M | Low | C-01 (state, nonce), C-02 (rotate at login) | SEC-T-11, SEC-T-44 |
| T-03 | T | CSRF on a committee vote, room grant or disclosure release | M | H | High | C-03, C-26 (`form-action`), SameSite=Lax | SEC-T-12 |
| T-04 | E / I | Stored XSS via record titles, comments, Arabic/English mixed text, Markdown, filenames, AI output, or uploaded SVG/HTML, causing actions as the victim | M | H | High | C-26, C-27, C-15 | SEC-T-24, SEC-T-23 |
| T-05 | T | Clickjacking of approve/grant buttons | L | H | Medium | C-26 (`frame-ancestors 'none'`) | SEC-T-23 |
| T-06 | I | Sensitive responses cached by the browser or intermediaries; back button on a shared device | M | M | Medium | C-26, C-15 (`no-store`) | SEC-T-23 |
| T-07 | R | An approver denies having voted, approved or released | M | H | High | C-10 (actor, session ID, auth time, trusted IP, correlation ID), C-41, C-46 | SEC-T-14, SEC-T-38 |
| T-08 | D | Abuse of expensive endpoints (search, exports, report generation, uploads, AI) | M | M | Medium | C-28, C-14, C-22 | SEC-T-25 |
| T-09 | S / I | Bidi or homoglyph spoofing in filenames and partner names (e.g. U+202E) makes users open or approve the wrong item | L | M | Low | C-14, C-27 | SEC-T-16, SEC-T-24 |

### TB-02 Web (Next.js server) ↔ API

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-10 | E | Authorization placed in Next.js middleware or layouts is bypassed (e.g. the middleware-bypass class shown by CVE-2025-29927, `x-middleware-subrequest`), so pages render without API checks | M | H | High | C-42 (API is the only authorization point), C-05 | SEC-T-39, SEC-T-01 |
| T-11 | I | Next.js data or full-route cache serves user A's SSR data to user B | M | H | High | C-42 (`no-store`, dynamic rendering for authenticated routes) | SEC-T-39 |
| T-12 | E | Web tier holds a service credential (confused deputy), or SSRF via rewrites or `next/image` | L | H | Medium | C-42, C-18 | SEC-T-39, SEC-T-27 |
| T-13 | T | Spoofed `X-Forwarded-Host`/`Proto` alters the OIDC `redirect_uri`, email links or audit IP | M | M | Medium | C-41 | SEC-T-44 |

### TB-03 API / worker ↔ PostgreSQL

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-14 | E / I | IDOR: another project's ID submitted in a path, body or FK (e.g. linking project-A evidence to a project-B gate) | H | H | **Critical** | C-05, C-07, C-08, C-09 | SEC-T-03, SEC-T-05, **AT-03** |
| T-15 | E | RLS ineffective: app role is owner or has BYPASSRLS; FORCE missing; new table without a policy; session-level `set_config` leaking across pooled connections; a query run outside the request transaction | M | H | High | C-08, C-36 | SEC-T-04, SEC-T-40 |
| T-16 | T / I | SQL injection via full-text search syntax, dynamic sort/filter or `sql.raw` | L | H | Medium | C-47 | SEC-T-41 |
| T-17 | I | Views or functions bypass RLS (`SECURITY DEFINER`, owner-owned views without `security_invoker`), especially BI and reporting views | M | H | High | C-36 | SEC-T-40 |
| T-18 | T | Lost update or race on approvals, baselines or votes (double vote) | M | M | Medium | C-30, C-29 (unique vote) | **AT-16**, SEC-T-31 |
| T-19 | R / T | Audit rows altered or deleted by the DB owner or a DBA; the chain rewritten wholesale | L | H | Medium | C-10, C-11, C-35 | SEC-T-14 (residual RR-02) |
| T-20 | I | Existence disclosure via unique-constraint errors, error details or timing | M | M | Medium | C-09, C-37 | SEC-T-26, SEC-T-03 |
| T-21 | D | Long-running queries (full-text search over a large corpus, reports) exhaust the DB | M | M | Medium | C-28 | SEC-T-25 |

### TB-04 API / worker ↔ object storage

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-22 | I | Direct object access: public bucket, leaked presigned URL, guessable key, or local-FS static serving | M | H | High | C-14 (random keys, D-05), C-15 (stream via API, no presigned URLs to clients), private bucket policy | SEC-T-42 |
| T-23 | T | Path traversal in the local-FS adapter via filename or key | L | H | Medium | C-14 (server-generated keys; resolved path must stay under root) | SEC-T-16, SEC-T-42 |
| T-24 | T | An evidence object replaced after approval | L | H | Medium | C-40 | SEC-T-43, **AT-14** |
| T-25 | I | Quarantined, disposed or revoked objects still served | M | M | Medium | C-14, C-15, C-31 | SEC-T-16, SEC-T-30 |

### TB-05 API ↔ IdP

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-26 | S | ID-token validation flaws (alg `none`/confusion, wrong `aud`, missing `nonce`, expired token); open redirect in `returnTo` | L | H | Medium | C-01 | SEC-T-44 |
| T-27 | S | Account takeover by email-based linking (reused or changed email; external IdP asserting an internal email) | M | H | High | C-01 ((iss, sub) binding), D-14 (distinct external issuer) | SEC-T-44 |
| T-28 | E | IdP group claims auto-mapped to powerful roles; an IdP admin or compromised group elevates access | L | H | Medium | C-05 (roles assigned in-app, scoped; groups at most eligibility) | SEC-T-35; MQ-02 |
| T-29 | S | A leaver or mover keeps a hub session after IdP disablement | M | H | High | C-02 (absolute expiry), C-45 | SEC-T-11; MQ-02 |
| T-30 | S | Dev login active in production, or demo users/secrets copied into production | L | H | Medium | C-04 | SEC-T-13 |
| T-31 | S | MFA fatigue or phishing at the IdP yields a valid session for the attacker | M | H | High | IdP controls (Mobily), C-46, anomaly detection (IR runbook §3) | SEC-T-38 (residual RR-06) |

### TB-06 Worker ↔ AI policy gateway ↔ provider (details in `ai-threat-cases.md`)

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-32 | I | Classified content sent to an unapproved or external provider (misconfigured adapter, gateway bypass) | M | H | High | C-18, C-19 | AIT-29, SEC-T-19 |
| T-33 | E / T | Prompt injection in documents, minutes, OCR or email causes prohibited actions or disclosure | H | H | **Critical** | C-20, C-21, C-23 | AIT-01…AIT-05, **AT-17** |
| T-34 | I | Provider-side retention, training, logging, or processing outside approved locations | M | H | High | Mode choice, gateway config, Mobily contract approval | MQ-06 (residual RR-05) |
| T-35 | D | Token/cost exhaustion or provider outage | M | M | Medium | C-22 | AIT-20, **AT-21** |

### TB-07 Worker ↔ SMTP / Teams

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-36 | I | Notifications leak classified content into mailboxes or Teams channels beyond the ACL (distribution lists, forwarding, external recipients, lock screens) | M | H | High | C-33, `notifications.message.send` authority (access-matrix §5.2) | SEC-T-33, **AT-19** |
| T-37 | T | Duplicate or misdirected sends after a retry or crash, or after a recipient-list change | M | M | Medium | C-12, C-21 | SEC-T-21, **AT-20**, **AT-18** |
| T-38 | S | Phishing that imitates hub notifications ("approve here") | M | M | Medium | No approval via email link or reply; deep links require login; DMARC alignment (Mobily mail team) | MQ-12 |
| T-39 | E | Over-scoped M365/Graph tokens (read all mail or chats) held by a connector | L | H | Medium | Read and send connectors separated; minimal scopes; C-25; honest connection validation (§17) | MQ-12 |

### TB-08 Untrusted files ↔ parsers

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-40 | D / E | Malicious XLSX/CSV: zip bomb, XML entity expansion, huge sheets, macro-enabled workbooks, parser CVEs | M | M | Medium | C-14, C-16, C-44 | SEC-T-16, SEC-T-17, **AT-25** |
| T-41 | I | SSRF via imported hyperlinks, external workbook links, or any "import from URL" feature | M | H | High | C-16 (never fetch), C-18 | SEC-T-17, SEC-T-19, **AT-25** |
| T-42 | T | CSV/Excel formula injection in exports opened by executives | M | H | High | C-17 | SEC-T-18, **AT-24** |
| T-43 | T | An import overwrites approved decisions, approvals or baselines, or promotes historical statuses to current | M | H | High | C-43 | SEC-T-45, **AT-01** |
| T-44 | E | PDF, DOCX or image conversion/OCR engine exploited (RCE) | L | H | Medium | C-44 | P6 review (residual RR-12) |
| T-45 | T | OCR or extraction produces fabricated certainty in official fields | M | M | Medium | C-43 | **AT-01**, AIT-02 |
| T-46 | E | Malware uploaded (including by an external partner via `jv.submission.upload`) and then downloaded internally | M | H | High | C-14 (quarantine + scan, D-10), C-15 | SEC-T-16 |

### TB-09 Data tier ↔ backup store

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-47 | I | Backups readable by backup operators, or stored off-site/out-of-Kingdom without approval | M | H | High | C-34 | MQ-09 |
| T-48 | E | A restore resurrects revoked sessions, grants or users, or redelivers jobs and notifications | M | H | High | C-34, C-12 | SEC-T-22, **AT-23** |
| T-49 | A | Backups unusable or untested; ransomware reaches both primary and backups | M | H | High | C-34, immutable/offline copy (Mobily) | SEC-T-22 |

### TB-10 Operators / support ↔ production

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-50 | I | DB superuser/owner, storage admins or vendor support read all content (RLS and app authorization do not apply to them) | M | H | High | C-35, C-36 | Procedural (residual RR-01) |
| T-51 | I | Support diagnostics (logs, traces, heap dumps, screenshots, DB extracts) exfiltrate content; production data copied to dev/test | M | H | High | C-37, C-35 | SEC-T-27 |
| T-52 | E | platform_admin self-grants content access or creates backdoor accounts | L | H | Medium | `not_self` on assignment and clearance (access-matrix §4–5), C-10 export of security events, C-45 | SEC-T-28 |
| T-53 | R | An operator disables the audit trigger or edits rows, then rebuilds the chain | L | H | Medium | C-10 (external anchor detects), C-36 (trigger owned by `hub_owner`) | SEC-T-14 (residual RR-02) |

### TB-11 App ↔ external log store / SIEM

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-54 | I | Audit or log export carries classified payloads into a system with broader access | M | M | Medium | C-11 | MQ-10 |
| T-55 | T | Export gaps (dropped batches) hide tampering | L | M | Low | Sequence numbers and chain continuity checked by the receiver | SEC-T-14 |

### TB-12 Internal ↔ partner-room / external users

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-56 | I | Materials access implied by NDA or partner stage; an external user sees unreleased versions, internal comments, draft answers, other counterparties' rooms or other partners' identities | M | H | High | C-06 (`room` + counterparty + disclosed-version rule), C-32 | SEC-T-08 |
| T-57 | I | An external user enumerates internal staff via the directory, mentions, notification text or DTO audit fields | M | M | Medium | C-32 | SEC-T-08 |
| T-58 | I | A disclosed item is copied before or after revocation (downloads, screenshots) | H | M | High | C-15 (audit), watermark where supported, disclosure log; **no prevention promised** (§8) | SEC-T-15 (residual RR-03) |
| T-59 | I | Clean-team material leaks via derived data (search snippets, counts, reports, AI summaries, notifications) to the deal team | M | H | High | C-06, C-23, C-24, D-09 | SEC-T-09 |
| T-60 | E | Partner submissions (`jv.submission.upload`) carry malware or active content into internal hands. Rated and mitigated under T-46; listed here because the source is external. | M | H | High | C-14, C-15, C-32 | SEC-T-16 |

### TB-13 Project A ↔ Project B

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-61 | I | Leakage through aggregates: portfolio dashboards, counts, KPI roll-ups, notifications, My Work inbox, global search | M | H | High | C-09, C-24 | SEC-T-03, SEC-T-06, **AT-03** |
| T-62 | I | A cross-project dependency reveals the other project's task titles or dates | M | M | Medium | `portfolio.cross_dependency.manage` minimum-field projection | SEC-T-46 |
| T-63 | I | Demo data or another project's data used to answer questions in a real project | M | H | High | C-07, C-08, `is_demo` exclusion, C-23 | AIT-21, **AT-28** |

### TB-14 API ↔ worker (intents crossing time)

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-64 | E | Confused deputy: a job executes after the scheduling user's access has been revoked | H | H | **Critical** | C-13 | SEC-T-20, AIT-14, **AT-19** |
| T-65 | T | Job/outbox payload tampering, or a payload carrying content that bypasses re-authorization | L | H | Medium | C-12, C-13 (refs only, re-derive at execution) | SEC-T-20 |
| T-66 | D | Poison jobs, retry storms, or queue starvation across projects | M | M | Medium | C-12, C-28 | SEC-T-21 |
| T-67 | E | The dispatcher's cross-project queue access is used to read content across projects | M | H | High | D-06 (queue-only system scope; content work under the actor context) | SEC-T-04, SEC-T-20 |

### Cross-cutting

| ID | STRIDE | Threat | L | I | Risk | Mitigations | Verification |
|---|---|---|---|---|---|---|---|
| T-68 | I | Secrets in source, client bundle, logs, error bodies, test reports or container layers | M | H | High | C-25, C-37 | SEC-T-27, SEC-T-26 |
| T-69 | E | Compromised npm dependency or base image | M | H | High | C-38 | P7 scans (residual RR-16) |
| T-70 | A | Private-mode deployment fails because assets depend on external fonts, CDNs or telemetry | M | M | Medium | C-18 | SEC-T-19, **AT-22** |
| T-71 | E | Production approvals active before an approved authority matrix exists; demo authority policy used in production | M | H | High | C-29, C-04, access-matrix §2.4 `authority` | SEC-T-37, **AT-04** |
| T-72 | T | Client-supplied timestamps or actor fields on votes, approvals or evidence | M | M | Medium | Server clock service; actor taken from the session only; contracts reject these fields | SEC-T-10 |
| T-73 | I | Personal data (employee transfer lists, payroll, contact details) over-collected, retained too long, or exported | M | H | High | `hr` domain classification, C-31 retention, minimisation guidance in import templates | Mobily PDPL assessment (control-applicability-matrix) |

---

## 8. AI-specific threats (summary)

`ai-threat-cases.md` defines AIT-01…AIT-34. The table below maps them to this model.

| Threat family | AIT cases | Key controls | Acceptance |
|---|---|---|---|
| Instruction injection (documents, OCR, minutes, email, record fields, bidi/zero-width) | AIT-01…AIT-05, AIT-33 | C-20, C-21, C-27 | AT-17 |
| Exfiltration via output, tools, citations, caches, embeddings, logs | AIT-06…AIT-11, AIT-29, AIT-30 | C-19, C-23, C-24, C-27, C-37 | AT-03, AT-22 |
| Cross-project/cross-user leakage (session memory, shared briefings) | AIT-12, AIT-13 | C-23, C-24 | AT-03 |
| Confused deputy after revocation; stale derived artefacts | AIT-14, AIT-15 | C-13, C-24 | AT-19 |
| Approval replay/tamper; unauthorized approver; duplicates | AIT-16…AIT-19 | C-21, C-12 | AT-18, AT-20 |
| Budget exhaustion / DoS | AIT-20 | C-22 | AT-21 |
| Hallucinated partner identity / valuation; AI output treated as fact; numbers computed by the model | AIT-21, AIT-31, AIT-32 | C-20, C-23, deterministic engines | AT-28, AT-29 |
| Prohibited actions (closing, waiver, approval, VDR grant); tool-argument IDOR; autopilot creep; kill-switch bypass | AIT-22…AIT-28 | C-20, C-22, access-matrix §8 | AT-12, AT-13, AT-17 |

---

## 9. Security verification catalogue

These are named security tests. None has been executed yet. Each must be recorded with its real result in the phase gate report. "Type" means U unit, I integration (real PostgreSQL), E E2E (Playwright), M manual/procedural.

| ID | Proves | Type | Phase | Linked |
|---|---|---|---|---|
| SEC-T-01 | Every registered route returns 401 without a session (registry-driven sweep) | I | P1 | T-10 |
| SEC-T-02 | Boot fails if a controller route lacks a contract or permission | I | P1 | C-05 |
| SEC-T-03 | Cross-project sweep: a project-B user requesting every project-A resource type (GET, commands, lists, search, exports, snapshot, AI, worker-generated outputs) gets 404; totals and facets are unchanged; no A titles appear in bodies or logs | I + E | P1 → extended each phase | AT-03 |
| SEC-T-04 | RLS direct: as `hub_app` with `app.project_ids={B}`, SELECT/UPDATE/DELETE on A rows touch 0 rows; with the setting unset, 0 rows; role attributes are not-owner and NOBYPASSRLS; FORCE is on | I | P1 | T-15 |
| SEC-T-05 | Linking a B child to an A parent is refused: 404 via the API, FK violation via SQL | I | P1 | T-14 |
| SEC-T-06 | Search/count leakage: a unique token in an A document yields 0 hits for B. An internal-clearance user searching for a confidential-only token in their own project gets 0 hits and unchanged facets | I | P2 / P5 | T-61 |
| SEC-T-07 | Classification: internal-clearance users cannot list, read or download confidential items, cannot upload or classify above their clearance, and cannot view derived snapshots containing confidential inputs | I | P2 | C-06 |
| SEC-T-08 | Partner isolation: counterparty P1's user cannot reach P2's room; undisclosed versions and internal projections stay hidden; NDA without a grant gives no access; a locked room gives no access; grant revocation takes effect on the next request; no directory or mentions for external users | I + E | P4 | T-56, T-57 |
| SEC-T-09 | Clean team: a sponsor without a clean_team assignment gets 404 on clean-team documents, search, AI, reports and notifications; release clears the flag only on the released output | I | P4 | T-59 |
| SEC-T-10 | For every `not_self` permission, a requester attempt returns 403 `SELF_APPROVAL_PROHIBITED` plus an audit row; a recused vote and a missing quorum are refused; client-supplied actor/timestamp fields are rejected | I | P2+ | AT-05 |
| SEC-T-11 | Session lifecycle: cookie flags; token hashed at rest; rotation at login; idle and absolute expiry; revocation and disabled accounts rejected on the next request | I | P1 | T-01, T-29 |
| SEC-T-12 | CSRF: a non-GET request without the header, with a mismatched header, or with a foreign `Origin` returns 403; no GET mutates | I | P1 | T-03 |
| SEC-T-13 | Boot refused in production with dev login, `mock` AI, default secrets, no scanner without risk acceptance, telemetry, or the demo authority policy | I | P1 / P7 | C-04 |
| SEC-T-14 | `hub_app` UPDATE/DELETE/TRUNCATE on `audit_event` fail; an owner-modified row is detected by chain verification; an export gap is detected | I | P1 / P7 | T-19, T-53 |
| SEC-T-15 | Every `auditRead` permission writes an audit row (actor, resource, version, correlation ID); if the audit write fails, the read fails | I | P2 / P4 | C-10 |
| SEC-T-16 | Upload validation: oversized files, magic mismatch, polyglots, `.xlsm`, traversal names (`../../x`), bidi-spoofed names and zip bombs are refused or quarantined; quarantined files cannot be downloaded | I | P2 / P6 | AT-25 |
| SEC-T-17 | Import: formulas are not evaluated; links are inert; URLs are never fetched (a stub server records zero hits); entity expansion is blocked; an oversized sheet is limited without service disruption | I | P6 | AT-25 |
| SEC-T-18 | Export neutralisation of `= + - @ TAB CR` and the full-width variants in XLSX and CSV | U + I | P6 | AT-24 |
| SEC-T-19 | Private mode with egress denied: core journeys pass; the browser HAR shows same-origin requests only; the AI provider is unreachable and AI degrades cleanly | E | P7 | AT-22 |
| SEC-T-20 | Worker re-authorization: after a user, room or document is revoked post-scheduling, the job does not output or send and records the denial | I | P2 / P5 | AT-19 |
| SEC-T-21 | Crash injection before and after a send produces no duplicates; `uncertain` deliveries are reconciled | I | P2 / P5 | AT-20 |
| SEC-T-22 | Backup and restore preserve permissions, audit and evidence checksums; sessions are invalidated; jobs are quiesced (no mass redelivery); post-backup revocations are re-applied | M + I | P7 | AT-23 |
| SEC-T-23 | Security headers (CSP, HSTS, frame-ancestors, nosniff, no-store) are present on pages, API responses and downloads | I | P1 | T-04–T-06 |
| SEC-T-24 | Stored XSS and bidi payloads (titles, comments, Arabic text, Markdown, filenames, AI output) render inert; no external image loads | E | P1 / P5 | T-04, T-09 |
| SEC-T-25 | Rate limits return 429; `statement_timeout` is enforced | I | P7 | T-08, T-21 |
| SEC-T-26 | Errors are RFC 7807 with no stack, SQL or secret; 404 bodies for missing and forbidden resources are identical | I | P1 | T-20 |
| SEC-T-27 | Secret scan of the repo, built client bundle (`.next/static`), images, logs and test reports finds nothing | I | P1 / P7 | T-68 |
| SEC-T-28 | platform_admin gets 404 on documents, decisions, rooms and finance; AI returns no content; audit payloads are redacted; self-assignment and self-clearance are refused | I | P1 | T-52 |
| SEC-T-29 | The auditor gets 403 on every mutating route (registry-driven) | I | P1+ | access-matrix §10 |
| SEC-T-30 | Archive, dispose and rollback under legal hold are refused and audited, including via direct SQL as `hub_app` | I | P3 / P6 | AT-27 |
| SEC-T-31 | Concurrent approval or baseline update returns 409 for one request | I | P2 | AT-16 |
| SEC-T-32 | Webhooks with a bad signature, stale timestamp or replayed nonce are refused | I | P6 | C-39 |
| SEC-T-33 | Email/Teams payloads contain nothing above `internal`; recipients without access are not sent to; external domains are blocked | I | P2 / P6 | T-36 |
| SEC-T-34 | Snapshot view and export re-check permissions; a revoked user is denied | I | P6 | §11 of spec |
| SEC-T-35 | Policy invariants (access-matrix §10) and the AI tool registry: no tool maps to an `ai:none` permission | U | P1 / P5 | access-matrix |
| SEC-T-36 | Containers run as non-root with an arbitrary UID and read-only root FS | I | P7 | C-38 |
| SEC-T-37 | With no active authority matrix in production mode, authority-conditioned approvals return `AUTHORITY_MATRIX_NOT_ACTIVE`; the demo policy is refused outside demo | I | P2 | T-71, AT-04 |
| SEC-T-38 | A high-impact action with a stale `auth_time` requires re-authentication (if D-04 is adopted) | E | P7 | T-07, T-31 |
| SEC-T-39 | SSR isolation: two users rendering back-to-back each see only their own data; a request carrying `x-middleware-subrequest` does not change what the API returns | E | P1 | T-10, T-11 |
| SEC-T-40 | Schema lint: every table with `project_id` has RLS enabled, forced and with a policy; no `SECURITY DEFINER`; views are `security_invoker`; `hub_app` has no DDL | I | P1 | T-15, T-17 |
| SEC-T-41 | Fuzzing of full-text search, sort and filter parameters; lint finds no `sql.raw` with request data | I | P1 / P2 | T-16 |
| SEC-T-42 | The bucket refuses anonymous access; responses never carry object-store or presigned URLs; the local adapter refuses traversal | I | P2 / P7 | T-22, T-23 |
| SEC-T-43 | A tampered object (checksum mismatch) is blocked and raises a security event | I | P2 | T-24 |
| SEC-T-44 | Tampered ID tokens (aud, iss, nonce, alg `none`, expired) and an open-redirect `returnTo` are refused; binding is by (iss, sub) | I | P1 / P7 | T-26, T-27 |
| SEC-T-45 | An import cannot overwrite approved decisions, approvals or baselines; historical statuses stay `historical_unverified` | I | P6 | AT-01 |
| SEC-T-46 | The cross-project dependency counterpart sees only the permitted fields | I | P2 | T-62 |
| SEC-T-47 | Containment controls (IR runbook §5) take effect within one request/job cycle | I + M | P7 | IR runbook |

---

## 10. Design deltas proposed to the lead (not yet decided)

These go beyond the decided architecture facts. Each needs a lead decision (ADR) before P1 closes, or an explicit rejection recorded with its risk.

| ID | Proposal | Why | Affects |
|---|---|---|---|
| D-01 | Add `app.room_ids` (and a clean-team room list) as RLS keys on room-bound tables (`document`, `document_version`, `document_chunk`, DD request/answer, disclosure, finding) | Defence in depth on the most sensitive boundary (TB-12) | DB context, RLS SQL |
| D-02 | Store only the SHA-256 of the session token | A DB read (backup, support) must not yield live sessions | `session` table |
| D-03 | HMAC-bind the CSRF token to the session ID and check `Origin`; use the `__Host-` cookie prefix in production if the deployment allows it | Plain double-submit is bypassable by cookie injection from a sibling subdomain | Auth platform |
| D-04 | Step-up authentication for `not_self` + `authority` actions | Non-repudiation and session-theft resistance for votes, gate decisions, waivers, closing and room grants | IdP (MQ-02) |
| D-05 | Object-store keys from a CSPRNG (not UUIDv7, which is time-ordered) | Keys must never be the control, but predictable keys widen the impact of any misconfiguration | Storage adapter |
| D-06 | A worker "queue scope": claim `job`/`outbox_event` under a narrow system scope limited to queue tables; do content work in a fresh transaction under the job's actor context | Prevents the dispatcher from becoming a cross-project reader (T-67) | Jobs platform, RLS |
| D-07 | FORCE RLS, `security_invoker` views, a `hub_bi` role, and the CI schema lint | T-15, T-17 | Migrations |
| D-08 | A permission epoch per (user, project) keying caches and AI memory | Deterministic invalidation on revoke/reclassify (AIT-15) | Policy, AI |
| D-09 | Partner and clean-team rooms excluded from AI indexing by default; enabling needs `ai.settings.manage` plus a legal decision | T-59, AIT-10 | AI ingestion |
| D-10 | Production refuses to start without a malware-scanner adapter unless a recorded risk acceptance flag is set | T-46 | Config validation |
| D-11 | Audit payload minimisation for external export | T-54 | Audit exporter |
| D-12 | AI classification ceilings per destination (§5.2 defaults) | T-32 | AI gateway |
| D-13 | `statement_timeout` and `idle_in_transaction_session_timeout` on `hub_app` | T-21 | DB roles |
| D-14 | External users from a distinct IdP issuer/realm; bind by (iss, sub) | T-27 | Identity |
| D-15 | Notification bodies ≤ `internal`; content only via deep link | T-36 | Notifications |
| D-16 | Room grants expire by default (proposed ≤ 90 days) | T-56 | JV module |
| D-17 | Clearance model with `domainClearance` (access-matrix §2.3) | Least privilege for finance/legal | Policy schema |
| D-18 | Policy `ai` flag (`none | retrieve | propose`), deny-by-default for AI | Prohibited actions become unreachable at the policy layer, not only by tool absence | Policy schema, AI tools |

---

## 11. Residual risks (after designed controls)

| ID | Residual risk | Why it remains | Owner (Role — To be confirmed) |
|---|---|---|---|
| RR-01 | DB superuser/owner, storage and infrastructure operators can read all data | RLS and application authorization do not bind them; encryption at rest does not stop them. Field-level encryption for strictly_confidential content is not in scope (it could be assessed). | Mobily Cybersecurity / IT Operations |
| RR-02 | The audit log is tamper-evident only, and only up to the last external anchor | Same-database chain; a privileged actor can rewrite the tail between exports | Mobily Cybersecurity (SIEM) |
| RR-03 | Disclosed or downloaded documents can be copied, forwarded or photographed | No DRM; watermarking is deterrence only (spec §8) | Mobily Legal / Deal Sponsor |
| RR-04 | Prompt injection cannot be prevented in general | Containment (no prohibited tools, bound approvals, ACL-first retrieval) limits the impact, but misleading summaries remain possible, so human review is required | AI Product Owner (TBC) |
| RR-05 | With an approved external provider, data leaves Mobily's environment | Location, retention and sub-processing depend on contract and provider controls | Mobily Cybersecurity / Privacy / Procurement |
| RR-06 | IdP compromise or MFA phishing leads to account takeover | The platform relies on the IdP; step-up only reduces the risk | Mobily Identity team |
| RR-07 | Concentration of authority in `sponsor` (waive CP, declare closing, release disclosures) | `not_self` stops self-approval, not collusion; the authority matrix governs | Mobily Governance / CPMO |
| RR-08 | Uploads before a scanner is configured | Mitigated by D-10; risk acceptance required otherwise | Mobily Cybersecurity |
| RR-09 | Timing side channels between "missing" and "forbidden" 404s | Not fully equalised | Engineering (low) |
| RR-10 | A restore to an earlier point resurrects revoked access until reconciliation completes | Depends on the external audit export being available | Mobily IT Operations |
| RR-11 | Clean-team leakage by people re-typing outputs | A human control, not a technical one | Mobily Legal (clean-team protocol) |
| RR-12 | Parser/converter vulnerabilities | Sandboxing reduces but does not remove them | Engineering / DevOps |
| RR-13 | Delivered email/Teams messages cannot be recalled | Channel limitation | Mobily Communications / IT |
| RR-14 | Metadata exposure to platform_admin (user names, project and room names) | Admin needs identity metadata; recommend code names for rooms and projects | Program Sponsor (TBC) |
| RR-15 | Model hallucination in advisory answers | Citations are required and validated, but a user may still over-trust an answer | AI Product Owner (TBC) |
| RR-16 | Dependency and supply-chain compromise between scans | Ongoing risk | DevOps |

---

## 12. Assumptions and questions requiring Mobily input

| ID | Question / assumption | Mobily function (Role — To be confirmed) | Needed by |
|---|---|---|---|
| MQ-01 | Classification scheme and labels, and how they map to the five levels; handling rules; declassification authority | Data Governance / Cybersecurity | P2 (prod defaults) |
| MQ-02 | IdP product and hosting location; MFA policy; `acr`/`max_age` support for step-up; back-channel logout or SCIM; external-partner identity (separate tenant/realm); group-claim use | Identity & Access Management | P7 |
| MQ-03 | Hosting environment (Kubernetes/OpenShift/VMs), operator (internal or third party), network zones, ingress/WAF | IT Infrastructure / Cybersecurity | P7 |
| MQ-04 | Container registry, egress proxy, custom CA, private DNS | IT Infrastructure | P7 |
| MQ-05 | Whether external partners access this platform directly (internet-facing path) or through an external VDR | Legal / Corporate Development / Cybersecurity | P4 |
| MQ-06 | AI mode per environment; approved providers and gateway; processing locations; retention; contractual terms | Cybersecurity / Privacy / Procurement | P5 |
| MQ-07 | Classification ceilings per AI destination; whether restricted content may be processed by the local model | Cybersecurity / Data Governance | P5 |
| MQ-08 | Technical support model: who, from where, access method (PAM/JIT), recording, screen sharing | IT Operations / Cybersecurity | P7 |
| MQ-09 | Backup target, location (in-Kingdom?), operator, encryption keys, retention, immutability, RPO/RTO | IT Operations / Cybersecurity | P7 |
| MQ-10 | SIEM/log store for audit export: location, retention, access | Cybersecurity (SOC) | P7 |
| MQ-11 | Malware-scanning engine; sandboxed conversion/OCR service; object-lock/versioning availability | Cybersecurity / IT Infrastructure | P2 / P6 |
| MQ-12 | SMTP relay and Teams tenant (region), allowed destinations, DMARC, connector scopes | IT Collaboration / Cybersecurity | P6 |
| MQ-13 | BI tool and service-account model | Data & Analytics | P6 |
| MQ-14 | Endpoint/DLP policy for downloads to devices; watermarking requirements | Cybersecurity | P4 |
| MQ-15 | Session idle/absolute lifetimes (internal and external) | Cybersecurity | P1 (defaults) / P7 |
| MQ-16 | Whether deal information must be treated as market-sensitive (insider-list handling) | Legal / Compliance | P4 |
| MQ-17 | Key management (KMS/HSM) for DB, object and backup encryption; rotation periods | Cybersecurity | P7 |
| MQ-18 | Penetration test and security acceptance requirements before production | Cybersecurity | P8 |
| MQ-19 | Personal-data inventory for People/HR workstream imports; whether a DPIA is required; controller/processor roles | Privacy Office / Legal | P3 |
| MQ-20 | Retention periods and legal-hold policy for minutes, evidence, DD material and audit | Legal / Records Management | P3 |

**Working assumptions used until answered** (reversible, per master prompt §1.3):
- AI is Off in private modes.
- External access is disabled until MQ-05 is answered.
- Session defaults per C-02.
- Backups stay in the same environment and are encrypted.
- No vendor has standing access.
- No external notification destinations.

---

## 13. Maintenance

Update this model when any of the following happens:
- a new module, route family or integration is added;
- an assumption in §12 is answered;
- a design delta in §10 is decided;
- a security finding or incident occurs (IR runbook §8);
- entering P5 (AI), P6 (imports/exports) or P7 (deployment).

Every change needs an independent reviewer who did not write it.
