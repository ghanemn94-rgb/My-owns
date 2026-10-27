# ADR-0052: P6 request and input hardening: the upload type allow-list by magic bytes and safe preview, rich text and the XSS test definition, the CSRF and rate-limit matrix, the `SecretProvider` interface, the dependency audit, response validation of every operation, the S16-023 integrity sweep, and the global audit API with Administration > Audit

- **Status:** Proposed for P6 (DG6). Author: solution-architect (T-DG6-ARCH-01), 2026-10-26.
- **Requirements (slice F of `docs/architecture/p6-plan.md`):** REQ-S13-011, REQ-S16-023, REQ-S16-027, REQ-S16-030, REQ-S16-032.
- **Sources (quoted where a design point has one):**
  - M0255 (§13) "Support native evidence notes and common documents/images, with file-type/size controls and safe preview/download. A filename or inaccessible external link is not verified evidence."
  - M0329 (§16) "Use canonical reference links, uniqueness constraints, required ownership and explicit status transitions. Protect finalized records and evidence from destructive deletion. … Preserve financial precision with decimal arithmetic. Add optimistic concurrency control so simultaneous edits cannot silently overwrite one another."
  - M0330 (§16) "Expose documented versioned APIs with server-side validation, consistent error handling, pagination and authorization. … Avoid exposing secrets or private evidence URLs in client code or logs."
  - M0331 (§16) "Implement secure sessions, role/scoped authorization, input sanitization, protection against common injection and request attacks, upload restrictions, rate limiting, dependency checks and a secret-management interface. Production secrets are runtime configuration, not repository content. … Audit actor, action, timestamp, record ID, prior/new version and reason; append-only audit data must be protected from ordinary user modification."
  - The playbook names no technical control; nothing below is attributed to it.
- **Decisions applied:** D-195 (Q4 the allow-list, new uploads only; Q10 the dependency audit; reopen candidates), D-193, D-088 §2, D-141, F-DG3-100, F-DG4-160, D-057/D-058 (no live registry or CI here).
- **Builds on:** ADR-0004 (audit), ADR-0005 (sessions, CSRF), ADR-0006, ADR-0007 (§5b platform statuses, problem bodies), ADR-0010 (evidence store; §5 "an allow-list of MIME types checked by magic bytes, size limits, filename sanitisation"), ADR-0011 (configuration and `*_FILE` secrets), ADR-0016 (P2 guards), ADR-0041 (form field types, `rich_text`), ADR-0046 (export injection rules), ADR-0051 (read boundary).
- **Physical model:** `0099_p6_upload_policy_content_types.sql`, `0100_p6_access_hardening_permissions.sql`; probe groups UP, EC, AU, PM in `docs/delivery/handbacks/DG6/T-DG6-ARCH-01-evidence/probe-output.txt`.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Changing an upload policy or reading the audit trail approves nothing.

## Context

1. Every evidence upload is stored as `application/octet-stream` (`evidence/routes.ts`), any type is accepted, and the only control is the 25 MiB ceiling `EVIDENCE_MAX_BYTES` (413 `evidence.too_large`). Downloads are `Content-Disposition: attachment` with `nosniff`. There is no preview route.
2. `rich_text` form fields (`0068`, `packages/shared/src/forms/validate.ts`) are "plain text stored verbatim (no markup is interpreted or stored as HTML; the web renders it escaped)". No test feeds script payloads through them.
3. CSRF: `identity/routes.ts` requires `Origin` equal to `APP_BASE_URL`'s origin and `X-CSRF-Token` equal to the session's token on every POST, PUT, PATCH and DELETE of a non-public route. The routes declared `{ public: true }` are exactly `startOidcLogin`, `completeOidcLogin`, `devLogin` (which checks `Origin` itself), `getHealth` and `getReadiness`.
4. Rate limiting: `@fastify/rate-limit`, global, keyed by the resolved session's user or else the client IP, `RATE_LIMIT_PER_MINUTE`; the three auth routes use `AUTH_RATE_LIMIT_PER_MINUTE` per IP (ADR-0007 §5b).
5. Secrets: `packages/config/src/load.ts` reads `NAME` or `NAME_FILE` (never both), names but never prints values, and `secretVariableNames()` lists the secret variables. There is no interface another secret store could implement.
6. CI checks the SBOM against the lockfile (`licenses/generate-sbom.mjs --check`), but no dependency **audit** against advisories runs.
7. Contract tests validate the responses of the operations each exercise calls; nothing asserts that **every** operation's every returned response was validated.
8. Audit is written in the mutation's transaction and `mth_app` holds only INSERT and SELECT on `audit_event` (`0003`); the only read API is `/transformations/{id}/audit` (`audit.read`).

## Decision

### 1. Upload type allow-list by magic bytes (REQ-S13-011)

**The closed set (D-195 Q4)** and its detection rule. Detection reads the stored bytes after the size check (the first 8 KiB, and for OOXML the ZIP central directory), never the client's `Content-Type` and never only the extension:

| Type | Extension(s), case-insensitive | Magic-byte rule | Canonical media type (`p6_upload_media_type`) | Inline preview |
|---|---|---|---|---|
| `pdf` | `.pdf` | starts with `%PDF-` | `application/pdf` | no (download) |
| `docx` | `.docx` | ZIP local header `PK\x03\x04`; the central directory names `[Content_Types].xml` and `word/document.xml`, and no `vbaProject.bin` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | no |
| `xlsx` | `.xlsx` | as docx with `xl/workbook.xml` | `…spreadsheetml.sheet` | no |
| `pptx` | `.pptx` | as docx with `ppt/presentation.xml` | `…presentationml.presentation` | no |
| `csv` | `.csv` | strict UTF-8 (optional BOM), no NUL byte, no other row's signature | `text/csv` | no |
| `txt` | `.txt` | as csv | `text/plain` | no |
| `png` | `.png` | `89 50 4E 47 0D 0A 1A 0A` | `image/png` | **yes** |
| `jpeg` | `.jpg`, `.jpeg` | `FF D8 FF` | `image/jpeg` | **yes** |
| `gif` | `.gif` | `GIF87a` or `GIF89a` | `image/gif` | **yes** |
| `svg` | `.svg` | strict UTF-8; after an optional BOM, whitespace, XML declaration and comments, the root element is `<svg` | `image/svg+xml` | **never** (download only) |

- **A file is accepted iff** its detected type is in this set, its extension (from `X-File-Name`, after the DG2 filename rules) is one of that type's extensions, the type is in the organization's effective policy, and its size is at most the policy's `max_bytes`. An OOXML ZIP is read through its central directory only (at most 10,000 entries; nothing is decompressed). The ZIP reader and the detector are new code in `evidence/content-policy.ts` (BE-D) with **no new dependency**.
- **Refusals** (problem+json; i18n en/ar under `problems.`):

  | Status | Code | English text |
  |---|---|---|
  | 422 | `evidence.type_not_allowed` | "This file type is not allowed. Allowed types: {allowedTypes}." |
  | 422 | `evidence.type_mismatch` | "The file's content does not match its extension {extension}." |
  | 413 | `evidence.too_large` | "Evidence content is limited to {maxBytes} bytes per revision." (the DG2 code and text; `maxBytes` is now the policy's limit) |

  An `.exe` (`MZ` header) is `evidence.type_not_allowed`; an `.exe` renamed `.pdf` is `evidence.type_mismatch` (its bytes do not start `%PDF-`). The DG2 upload operation already declares 413 and 422, so its contract is unchanged; the behaviour change (a type DG2 accepted becomes 422) is the D-195-accepted reopen candidate p6-plan §3 row 3, for **new uploads only**.
- **Stored result** (`0099`): the new `evidence_content` row has `detected_type` and `content_type` = its canonical media type (`evidence_content_detected_media_type`; probe EC01–EC07). BE-D's migration `0101` adds the BEFORE INSERT rule "a new row needs `detected_type`", merged with the upload change, so the DG2 path keeps working until then (probe EC04).
- **Files stored before P6** keep `detected_type` NULL and `application/octet-stream`; they stay downloadable as attachments exactly as in DG2 and are never previewed (§2). No migration rewrites them (`evidence_content` is append-only: EC06).
- **Downloads are unchanged:** `downloadEvidenceContent` keeps `Content-Type: application/octet-stream`, `Content-Disposition: attachment` and `nosniff` for every type.

**Entity `upload_policy`** (`0099`; mutable, P2 guards, audited; probe UP01–UP11): `id`, `organization_id` (unique), `allowed_types` (non-empty subset of the ten, no NULL: `upload_policy_allowed_types`), `max_bytes` (1–26214400: `upload_policy_max_bytes`), `reason` (3–1000), `version`, stamps. **No row = the default**: all ten types, 26214400 bytes. A row can only narrow the default. History `upload_policy_change` (append-only, trigger-written, `record_version`; UP02, UP10).

**Operations** (tag `admin`; owner BE-D):
- `getUploadPolicy` `GET /api/v1/admin/upload-policy?organizationId=` (`security.read` or `upload_policy.configure` on the organization): `{allowedTypes, maxBytes, isDefault, reason, version, updatedAt}`, `ETag "0"` when no row.
- `putUploadPolicy` `PUT` same path, `IfMatchOrZero`, body `{allowedTypes, maxBytes, reason}` (`upload_policy.configure`); audit `upload_policy.changed` with prior and new version. `maxBytes` above 26214400 or a type outside the set: 400 `validation`.

### 2. Safe preview (REQ-S13-011 "an SVG with script is not executed in preview")

`previewEvidenceContent` `GET /api/v1/transformations/{transformationId}/evidence/{evidenceId}/preview` (owner BE-D; authorization: ADR-0051 §4 `requireEvidenceRead`, the same function as download):
- **200 only when** the current content's `detected_type` is `png`, `jpeg` or `gif` **and** its first bytes still match that type's magic (re-checked on read). The response streams the bytes through the API (never an object-store URL, ADR-0010 §2) with exactly these headers: `Content-Type` = the canonical raster type; `Content-Disposition: inline; filename="<sanitised>"`; `X-Content-Type-Options: nosniff`; `Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox`; `Cross-Origin-Resource-Policy: same-origin`; `Cache-Control: private, no-store`.
- **Otherwise 422** `evidence.preview_unavailable` "No preview is available for this file. Download it instead." This covers SVG (always), PDF, the OOXML types, CSV, TXT, a note or link item, an item without content, and every file stored before P6 (`detected_type` NULL).
- **Why SVG and HTML are never inline:** an SVG can carry `<script>` and event handlers that run when the document is rendered as a top-level resource. Serving SVG only as `attachment` with `application/octet-stream` (the DG2 download) means the browser never renders it. The web shows a file-type icon and "Download" for every non-raster type. The A12 test uploads an SVG containing `<script>` and an `onload` handler: the upload succeeds (svg is allowed), preview answers 422, and download answers `application/octet-stream` + `attachment`; the e2e asserts no dialog or script execution on the evidence page.

### 3. Rich text and the XSS test definition (REQ-S16-030)

- **Rule (unchanged from DG2/P5, restated as binding):** `rich_text` fields and every free-text column are stored **verbatim as plain text**; the API never interprets, stores or returns HTML. The web renders them as React text nodes. **No** `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` in `apps/web/src/**` (BE-E's suite adds a source scan that fails on any of them outside test files). The CSP (`server.ts` `HELMET_OPTIONS`: `script-src 'self'`, no `unsafe-inline`, `object-src 'none'`, `frame-ancestors 'none'`) is defence in depth, not the primary control. Exports use the ADR-0046 injection rules (formula neutralisation in CSV/XLSX).
- **XSS test definition** (BE-E, `apps/api/test/integration/security/xss.test.ts`; QA-D adds the e2e): the payload set is exactly `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `<svg onload=alert(1)>`, `<a href="javascript:alert(1)">x</a>`, `"><iframe srcdoc="<script>alert(1)</script>">`, and `{{constructor.constructor('alert(1)')()}}`. For each payload, written into (a) a P5 `rich_text` form field, (b) the T03 `gap` text, (c) an evidence note body and (d) an inbox-visible title: the API accepts or refuses it under the free-text rules, and an accepted value round-trips **byte-identical** in the JSON response (never HTML-encoded or stripped); the e2e opens the rendering page and asserts the payload appears as visible text, no element created from it exists (`script`, `img[onerror]`, `svg[onload]`, `iframe`, `a[href^=javascript]`), and no `dialog` event fires.

### 4. The CSRF and rate-limit matrix (REQ-S16-030)

**CSRF.** Unchanged rule (§Context 3). P6 adds exactly one exemption class: ADR-0056's webhook receivers (`webhooks/{endpointKey}`), which are `{ public: true }` and authenticated by HMAC signature, timestamp window and idempotency, enumerated in ADR-0056 and pinned by the contract test. No other P6 route is public. BE-E's security suite asserts, for a sample of one mutation per module (the route-inventory sweep of ADR-0051 §5 covers all): no `Origin` → 403 `csrf`; foreign `Origin` → 403 `csrf`; missing or wrong `X-CSRF-Token` → 403 `csrf`; correct → not 403 `csrf`.

**Rate limits.** The global limit and key are unchanged. P6 adds **route classes**, each a per-route `config.rateLimit` with its own budget, keyed like the global limit (user, else IP). The budgets are configuration (`packages/config`, BE-E; defaults below, each `positiveInt`):

| Class | Operations (by owner ADR) | Variable | Default per minute |
|---|---|---|---|
| global | every operation without a class | `RATE_LIMIT_PER_MINUTE` | unchanged |
| auth | `startOidcLogin`, `completeOidcLogin`, `devLogin` | `AUTH_RATE_LIMIT_PER_MINUTE` | unchanged |
| upload | `uploadEvidenceContent`, import upload (ADR-0056) | `UPLOAD_RATE_LIMIT_PER_MINUTE` | 30 |
| search | global search (ADR-0057) | `SEARCH_RATE_LIMIT_PER_MINUTE` | 120 |
| assistant | assistant message post (ADR-0059) | `ASSISTANT_RATE_LIMIT_PER_MINUTE` | 20 |
| webhook | webhook receive (ADR-0056), keyed by endpoint key | `WEBHOOK_RATE_LIMIT_PER_MINUTE` | 600 |
| export | export start (ADR-0046 operations) | `EXPORT_RATE_LIMIT_PER_MINUTE` | 10 |

A class limit is applied **in addition to** the global limit (whichever is reached first answers 429 `rate_limited` with `Retry-After`). Every operation keeps declaring 429 (ADR-0007 §5b). The classes whose operations do not exist yet are wired by their owner tasks; BE-E creates the configuration and the `platform/hooks.ts` helper `rateLimitClass(name)`.

**Read model** `getSecurityRateLimits` `GET /api/v1/admin/security/rate-limits?organizationId=` (`security.read` on the organization; owner BE-E): the effective budget per class and the operation ids in each class, read from configuration; no counters, no client IPs, no user ids.

### 5. `SecretProvider` (REQ-S16-030 "a secret-management interface")

`apps/api/src/modules/platform/secrets.ts` (owner BE-E) and its use in `packages/config/src/load.ts`:

```ts
export interface SecretRef { readonly provider: string; readonly name: string } // e.g. { provider: "env", name: "SMTP_PASSWORD" }
export interface SecretProvider {
  readonly id: string;                                  // "env" (default), "file"; IT may register another
  get(name: string): Promise<SecretValue | undefined>;  // never logs, never throws with the value in the message
}
export interface SecretValue { reveal(): string; toString(): "[secret]"; toJSON(): "[secret]" }
```

- **Built-in providers:** `env` reads `NAME` or `NAME_FILE` exactly as ADR-0011 does today (both set = configuration error naming the variable); `file` reads a file under a configured directory (`SECRETS_DIR`, a container secret mount). With no new variable set the installation behaves exactly as DG5 (p6-plan §3 row 10).
- **Pluggable:** another provider (for example Mobily IT's vault) is registered at composition (`server.ts`, `apps/worker/src/main.ts`) by an adapter IT supplies; the product ships none and claims no vault integration.
- **References, never values, in the database:** P6 settings that need a secret (connector credentials ADR-0055, SMTP ADR-0054, assistant endpoint ADR-0059) store a `SecretRef` (`{provider, name}`), never the value. `SecretValue.toString`/`toJSON` print `[secret]`, so a value that reaches a logger or a JSON response prints the placeholder. ADR-0053 adds every resolved value to the log redaction list.
- No secret is in the repository; `.env.example` is regenerated by `deploy/scripts/generate-env-example.mjs` with names only (DO-A).

### 6. Dependency audit (REQ-S16-030 "dependency checks"; D-195 Q10)

- **CI job** `dependency-audit` in `deploy/ci/ci.yml` (owner DO-A): `pnpm audit --audit-level high --prod` against the configured registry, gated like the other jobs; a High or Critical advisory on a production dependency fails the job. It runs where CI has network.
- **Offline check** `deploy/scripts/dep-audit.mjs` (DO-A): compares the SBOM (`licenses/**`) with a **dated advisory snapshot** committed as `deploy/advisories/snapshot-<yyyy-mm-dd>.json`, recording its source and retrieval date; it fails on a matching High/Critical advisory and prints the snapshot age. It runs in `pnpm test` (no network).
- ~~**In this sandbox the live audit is BLOCKED** (no registry advisory service: D-057/D-058 class) and is reported so; the offline check is never described as the live audit.~~
  - **Amendment (DG6, T-DG6-ARCH-05, 2026-10-27; D-199): the sentence above is struck.** In the DG6 build sandbox the live audit is **not** BLOCKED: T-DG6-DO-A ran `pnpm audit --audit-level high --prod` through the build environment's egress proxy (with `registry.npmjs.org` allowed for that one command and npm's `noproxy` setting overridden), exit 1, 20 High advisories on shipped packages (`docs/delivery/handbacks/DG6/T-DG6-DO-A-devops-engineer.md` §0; `T-DG6-DO-A-evidence/pnpm-audit-live-prod.txt`, 2026-10-27). D-199 decided to upgrade them (T-DG6-DO-A2). **Where a network has no route to the registry's advisory service** (a disconnected installation, a CI runner without egress), the live audit is reported **BLOCKED** with that reason, never PASS; the offline snapshot check still runs and is never described as the live audit.

### 7. Response validation of every operation (REQ-S16-027)

`apps/api/test/integration/contract/response-validation.test.ts` (owner BE-F):
- wraps the contract harness's `call` so **every** response returned during the contract suite is validated against the operation's declared response (status declared; body against its schema; media type equals the declared one; problem bodies against `Problem`), and records `(operationId, status)`;
- fails when any operation outside the pending aggregate has **no** validated response, and lists it;
- asserts the three acceptance clauses literally: a sample invalid input per module returns the uniform 400 body (`type urn:mth:problem:validation`, `code`, `errors[]` with JSON pointers); an unauthorized call returns 403 (or the ADR-0006 404 for an unreadable record); responses carry pagination (`nextCursor`) on every list operation.
A defect found in another owner's route is reported in BE-F's handback, not fixed by BE-F (p6-plan §5.1).

**Amendment (DG6, T-DG6-ARCH-05, 2026-10-27; D-199): "pagination (`nextCursor`) on every list operation" applies to every list operation except the bounded collections that ADR-0007 §4a names one by one, each with its bound and the reason it holds (21 operations).** The 17 unbounded lists that ADR-0007 §4a also names stay in `UNPAGINATED_LISTS_AT_HEAD` until T-DG6-BE-V (`p6-work-split.md` §D.5) paginates them; the test's pin is the enforcement (a new unpaginated list fails, a paginated one must leave the pin). After T-DG6-BE-V the pin equals the 21 names of ADR-0007 §4a.

### 8. Global audit API and Administration > Audit (REQ-S16-032)

**Entity:** `audit_event` (`0003`), unchanged: `id`, `seq`, `occurred_at`, `organization_id`, `transformation_id`, `actor_type`, `actor_user_id`, `on_behalf_of_user_id`, `action`, `record_type`, `record_id`, `prior_version`, `new_version`, `reason`, `request_id`, `source`, `changes`. Append-only: mth_app holds INSERT and SELECT only, and `audit_event_immutable` raises on UPDATE/DELETE/TRUNCATE for every role including the owner (probe AU01–AU03; REQ-S16-032 "an UPDATE on the audit table by the application role fails").

**Operations** (tag `audit`; owner BE-E; `audit/routes.ts`):
- `listAuditEvents` `GET /api/v1/audit-events?organizationId=&transformationId=&recordType=&recordId=&actorUserId=&action=&from=&to=&cursor=&limit=` (`audit_event.read`); newest first by `seq`; cursor pagination bound to the filter hash (ADR-0007).
- `getAuditEvent` `GET /api/v1/audit-events/{auditEventId}`.

**Scope ("view:AUD,ADM(scoped)").** An event is visible iff `audit_event.read` applies to its target under ADR-0006: an event with a `transformation_id` targets that transformation; an event without one targets its `organization_id` at organization level. Consequences, stated exactly: AUD (inherits downward) sees every event of the organizations, business units and transformations it is assigned to; ADM_TECH and ADM_ACCESS (non-inheriting, `audit_event.read` is not structural) see the **organization-level** events of their organization and the events of a transformation only where they hold an assignment at that transformation. **Sensitive records (ADR-0051 §2):** an event whose `record_type`/`record_id` is a sensitive record the caller is not admitted to is listed with `changes: null` and `reason: null` and `redacted: true`; actor, action, time, record id and versions remain (they are what the audit trail must show).

**Screen:** Administration > Audit (`pages/admin/audit/**`, FE-B), read-only for everyone (no action exists), with filters for the parameters above and en/ar labels.

**One audit event per mutation (the P6 assertion):** every P6 mutation test asserts exactly one `audit_event` row for the mutated record with `prior_version` and `new_version` (P2 guards make a missing one fail at COMMIT on every new table: probe RS03, GR05, UP08), and BE-F's integrity sweep (§9) asserts it across all P6 entity types.

### 9. The S16-023 integrity sweep

`apps/api/test/integration/hardening/integrity-sweep.test.ts` (owner BE-F), the acceptance trio literally plus the P6 entities:
1. **Deleting an approved gate decision or its evidence returns 409.** For each finalized type that has a DELETE or archive operation in the contract (the approved gate decision and its evidence first; BE-F lists every other finalized type it finds and the operation used), the call on a finalized record returns 409 with its problem code, and the row is unchanged. Where no DELETE operation exists, the test asserts that none exists in the contract and that mth_app has no DELETE privilege on the table (catalogue test).
2. **An illegal status transition returns 422 `invalid_transition`** (ADR-0007): for every state machine of a P6 entity (sensitive grant `revoked → active`; and those ADR-0053–0059 define) and one per DG1–DG5 state machine module.
3. **A duplicate unique key returns 409** (`problems.duplicate`): for every P6 unique key reachable through the API (`sensitive_record_grant_one_active_key` → 409 `sensitive_grant.duplicate`; `record_sensitivity_record_key` is reached only through PUT with `IfMatchOrZero` `"0"` → 409 `version_conflict`; the others of ADR-0053–0059).
4. **Required ownership and canonical references:** every P6 table with an owner or record reference rejects a missing owner (NOT NULL) and a dangling reference (FK or `*_record_ref` trigger: probe RS10, GR06).

### 10. Authorization summary (permissions matrix rows; `0100`)

| Action | Permission (category) | Seeded roles | AUD |
|---|---|---|---|
| Read the global audit list | `audit_event.read` (read) | AUD, ADM_TECH, ADM_ACCESS | read |
| Read the upload policy and the rate-limit matrix | `security.read` (read) | ADM_TECH, AUD | read |
| Change the upload policy | `upload_policy.configure` (configure) | ADM_TECH | none |
| Preview evidence | ADR-0051 §4 | as download | read (if readable) |
| Nobody modifies audit data | (none) | — | — |

No code is `business_approval` or `finance_validation` (probe PM01–PM04); technical admins gain no business approval (REQ-S10-003).

### 11. The security suite (REQ-S16-030 acceptance, literally)

`apps/api/test/integration/security/**` (owner BE-E) runs one named test per clause, all on the API without the UI: **CSRF** (§4), **SQL injection** (payloads `' OR 1=1 --`, `'; DROP TABLE audit_event; --`, `1) OR (1=1` in every free-text query parameter of the list and search operations and in a free-text body field: no 500, no extra rows, the payload round-trips as text where stored; Kysely parameterised SQL is the control), **XSS in rich text** (§3), **disallowed upload type** (`.exe` → 422 `evidence.type_not_allowed`; renamed `.exe` → 422 `evidence.type_mismatch`), **oversized upload** (policy limit + 1 byte → 413 `evidence.too_large`), **rate limiting** (each class of §4 with its budget set to 1: the second call is 429 with `Retry-After`). The suite prints one PASS line per clause.

### 12. Decimal and Unknown semantics

`upload_policy.max_bytes` is a byte count (bigint, an integer quantity, not money); no entity here holds money, a rate, FTE or a KPI value. Audit `changes` keeps decimal values as the strings the mutations wrote.

## Alternatives

- **Trusting the client's `Content-Type` or the extension alone.** Rejected: both are attacker-controlled (M0331 "upload restrictions").
- **Server-side image re-encoding for previews.** Stronger against malformed-image exploits, but needs an image library (a new dependency, D-195). Deferred; the raster-only, magic-checked, CSP-sandboxed, `nosniff` response is the P6 control.
- **An HTML sanitizer for rich text.** Rejected: the product stores no HTML at all, which is simpler and stronger than sanitizing it.
- **`pnpm audit` only.** Rejected for the sandbox: it needs the registry's advisory service; the offline snapshot check keeps a runnable control here and is labelled as such.

## Consequences

- A DG2-accepted upload of a type outside the set now fails (accepted reopen for new uploads, D-195). Existing files are untouched.
- New environment variables (§4, §5) are optional; with none set, behaviour equals DG5 except the allow-list.
- The pending aggregate keeps `contract.test.ts` green until the owners route the operations.

## Verification

- **Database (this task):** probe groups UP01–UP11, EC01–EC07, AU01–AU03, PM01–PM04: PASS within the 70/70 run (`probe-output.txt`).
- **Implementers:** BE-D (allow-list unit tests per row of §1, preview headers, SVG case), BE-E (security suite §11, audit API scope tests, SecretProvider tests including `[secret]` printing), BE-F (§7, §9), DO-A (CI job; offline check with a negative fixture). QA-B/QA-E re-run A07/A12.
- **Dependencies:** none added by this ADR. The offline advisory snapshot is data, not a dependency; its source and date are recorded with it.
