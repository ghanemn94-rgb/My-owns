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
- **Stored result** (`0099`): the new `evidence_content` row has `detected_type` and `content_type` = its canonical media type (`evidence_content_detected_media_type`; probe EC01–EC07). BE-D's migration adds the BEFORE INSERT rule "a new row needs `detected_type`", merged with the upload change, so the DG2 path keeps working until then (probe EC04). It shipped as `0118_p6_evidence_content_detected_type_required.sql` (trigger `evidence_content_detected_type_required`; `0101` was taken by T-DG6-ARCH-02, D-196 item 2).
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
export interface SecretRef { readonly provider: string; readonly name: string } // e.g. { provider: "env", name: "MTH_SECRET_SMTP_PASSWORD" }
export interface SecretProvider {
  readonly id: string;                                  // "env" (default), "file"; IT may register another
  get(name: string): Promise<SecretValue | undefined>;  // never logs, never throws with the value in the message
}
export interface SecretValue { reveal(): string; toString(): "[secret]"; toJSON(): "[secret]" }
```

- **Built-in providers:** `env` reads `NAME` or `NAME_FILE` exactly as ADR-0011 does today (both set = configuration error naming the variable); `file` reads a file under a configured directory (`SECRETS_DIR`, a container secret mount). With no new variable set the installation behaves exactly as DG5 (p6-plan §3 row 10).
- **Namespace (F-DG6-120, T-DG6-BE-Y2):** a SecretRef names only a secret IT provisioned for a setting, never a platform variable. `env` resolves only `MTH_SECRET_<NAME>` (`A–Z 0–9 _`, first character a letter or digit, at most 128 characters, not ending in `_FILE`; `MTH_SECRET_<NAME>_FILE` is read as ADR-0011 does); `file` resolves only a plain file name (`A–Z a–z 0–9 _ . -`, first character a letter or digit, at most 128 characters, so no path, no `..` and no leading dot) whose real path stays inside a `SECRETS_DIR` dedicated to these secrets (a `SECRETS_DIR` holding the target of a platform `<VARIABLE>_FILE` other than `MTH_SECRET_*_FILE` is a configuration error when the `file` provider resolves a reference; the error names the variable, never a path or value). A provider IT registers owns its own namespace. Every consumer (connector credentials, webhook signing secrets on create and rotate, SMTP, S3 storage on save and test, the assistant) refuses a reference outside the namespace with `400 validation`, field error `validation.secret_ref_namespace` at the field, before any row is written; a stored one resolves as unset. Confirmed by the solution-architect on 2026-11-02 (amendment at the end of this ADR). The rule is `secretRefInNamespace` in `platform/secrets.ts` (and its worker twin); the answer depends on the name only, so it is no existence oracle.
- **Binding (F-DG6-181, amended 2026-11-04, T-DG6-ARCH-14; implemented by T-DG6-BE-Z2):** the namespace says only *what kind* of name a reference may carry. The binding says *which setting* may use it. IT declares, in a binding manifest outside the database and without any value (`SECRET_BINDINGS_FILE`), each secret's one consumer kind (`connector`, `webhook_signing`, `smtp`, `storage`, `assistant`), its one scope (an organization code, or the installation for `storage` and `assistant`) and the hosts it may be sent to. A reference resolves for a setting only when a binding matches the setting's consumer kind, its organization and the host it is sent to. The check runs at write time (`400 validation`, field error `validation.secret_ref_not_bound` or `validation.secret_ref_host_not_bound`, audit event `secret_ref.refused`) and again at resolve time, fail closed (an unbound reference resolves as unset and the provider is never asked). `resolvable` is computed only through the binding, so it is no existence oracle. No manifest means no reference is bound. The exact rules are in the amendment of 2026-11-04 at the end of this ADR.
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

**Amendment (DG6, T-DG6-ARCH-05, 2026-10-27; D-199): "pagination (`nextCursor`) on every list operation" applies to every list operation except the bounded collections that ADR-0007 §4a names one by one, each with its bound and the reason it holds (21 operations).** The 17 unbounded lists that ADR-0007 §4a also names stay in `UNPAGINATED_LISTS_AT_HEAD` until T-DG6-BE-V (`p6-work-split.md` §D.5) paginates them; the test's pin is the enforcement (a new unpaginated list fails, a paginated one must leave the pin). T-DG6-BE-V has shipped, so the pin now equals the 21 names of ADR-0007 §4a (stated 2026-10-30, T-DG6-ARCH-07).

### 8. Global audit API and Administration > Audit (REQ-S16-032)

**Entity:** `audit_event` (`0003`), unchanged: `id`, `seq`, `occurred_at`, `organization_id`, `transformation_id`, `actor_type`, `actor_user_id`, `on_behalf_of_user_id`, `action`, `record_type`, `record_id`, `prior_version`, `new_version`, `reason`, `request_id`, `source`, `changes`. Append-only: mth_app holds INSERT and SELECT only, and `audit_event_immutable` raises on UPDATE/DELETE/TRUNCATE for every role including the owner (probe AU01–AU03; REQ-S16-032 "an UPDATE on the audit table by the application role fails").

**Operations** (tag `audit`; owner BE-E; `audit/routes.ts`). `access` depends on `audit` (ADR-0002 rule 5), so `audit/routes.ts` reaches the scope check through the injected port `AuditRouteAccess`, which BE-E fills at composition (the GateFactsProvider pattern), and never imports `access` (D-197 item 5; T-DG6-BE-A §4.1):
- `listAuditEvents` `GET /api/v1/audit-events?organizationId=&transformationId=&recordType=&recordId=&actorUserId=&action=&from=&to=&cursor=&limit=` (`audit_event.read`); newest first by `seq`; cursor pagination bound to the filter hash (ADR-0007).
- `getAuditEvent` `GET /api/v1/audit-events/{auditEventId}`.

**Scope ("view:AUD,ADM(scoped)").** An event is visible iff `audit_event.read` applies to its target under ADR-0006: an event with a `transformation_id` targets that transformation; an event without one targets its `organization_id` at organization level. Consequences, stated exactly: AUD (inherits downward) sees every event of the organizations, business units and transformations it is assigned to; ADM_TECH and ADM_ACCESS (non-inheriting, `audit_event.read` is not structural) see the **organization-level** events of their organization and the events of a transformation only where they hold an assignment at that transformation. **Sensitive records (ADR-0051 §2):** an event whose `record_type`/`record_id` is a sensitive record the caller is not admitted to is listed with `changes: null` and `reason: null` and `redacted: true`; actor, action, time, record id and versions remain (they are what the audit trail must show).

**Screen:** Administration > Audit (`pages/admin/audit/**`, FE-B), read-only for everyone (no action exists), with filters for the parameters above and en/ar labels.

**One audit event per mutation (the P6 assertion):** every P6 mutation test asserts exactly one `audit_event` row for the mutated record with `prior_version` and `new_version` (P2 guards make a missing one fail at COMMIT on every new table: probe RS03, GR05, UP08), and BE-F's integrity sweep (§9) asserts it across all P6 entity types.

### 9. The S16-023 integrity sweep

`apps/api/test/integration/hardening/integrity-sweep.test.ts` (owner BE-F), the acceptance trio literally plus the P6 entities:
1. **Deleting an approved gate decision or its evidence returns 409.** For evidence the code is 409 `evidence.finalized`, "This evidence supports an approved gate decision and cannot be archived or unlinked.", on `archiveEvidence` and `removeEvidenceLink` (D-199, T-DG6-BE-F2; the refusal is in the API, and `mth_app` holds no DELETE privilege; no database trigger was added). For each finalized type that has a DELETE or archive operation in the contract (the approved gate decision and its evidence first; BE-F lists every other finalized type it finds and the operation used), the call on a finalized record returns 409 with its problem code, and the row is unchanged. Where no DELETE operation exists, the test asserts that none exists in the contract and that mth_app has no DELETE privilege on the table (catalogue test).
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

## Amendment (2026-11-02, T-DG6-ARCH-12; F-DG6-120): §5, the SecretRef namespace confirmed by the architect

T-DG6-BE-Y2 (backend-workflow-engineer) edited §5 while repairing F-DG6-120: the `SecretRef` example became `MTH_SECRET_SMTP_PASSWORD`, and a "Namespace" bullet was added. As the architect I confirm both edits, with the corrections below, after checking them against the shipped code at the integrated `HEAD` `a973b5673`:

- **The rule** is `secretRefInNamespace` in `apps/api/src/modules/platform/secrets.ts`, with the identical worker twin `apps/worker/src/secrets.ts` (D-198):
  - `env`: `/^MTH_SECRET_[A-Z0-9][A-Z0-9_]{0,116}$/`, and the name does not end in `_FILE` (128 characters at most). `MTH_SECRET_<NAME>_FILE` is still read through ADR-0011's `readSecretVariable`.
  - `file`: `/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/`, one plain file name directly in `SECRETS_DIR`. A file whose real path leaves the directory (a symbolic link out) resolves nothing. A `SECRETS_DIR` that holds the real target of any `<VARIABLE>_FILE` other than `MTH_SECRET_*_FILE` raises a `ConfigError` naming that variable. The check runs **when the `file` provider resolves a reference**, not at startup. So the platform's own `/run/secrets` mount can never be used as `SECRETS_DIR`.
  - Any other provider is one IT registers at composition. It owns its namespace (`secretRefInNamespace` returns true), and its adapter is responsible for it.
  - Out-of-namespace names resolve exactly as an unset secret (`undefined`), so resolution is no existence oracle.
- **Write time.** `assertSecretRefInNamespace(ref, pointer)` in `apps/api/src/modules/platform/secret-namespace.ts` answers **400** with the generic problem code `validation`, and one field error with code `validation.secret_ref_namespace` at the field's JSON pointer. It runs after each consumer's own shape check and before any write. The call sites are `integrations/connectors.ts` (`/config/credentialRefs/<key>`), `integrations/webhooks.ts` (`/signingSecretRef`, on create and rotate), `admin/notification-channels.ts` (`/smtp/usernameRef`, `/smtp/passwordRef`), `admin/storage.ts` (`/s3/…` and `/candidate/…`, on save and test) and `assistant/settings.ts` (`/credentialRef`). The answer depends on the name only. No operation, status code or top-level problem code changes. `docs/api/openapi.yaml` `SecretRef` states the rule in its description, with no schema or pattern change.
- **The field error code** (p6-work-split §2 rule 17 asks for every new code to be listed in an ADR):

  | Where | Code | English text (exact, `SECRET_REF_NAMESPACE_MESSAGE`) |
  |---|---|---|
  | field error inside 400 `validation` | `validation.secret_ref_namespace` | `Name a secret IT provisioned for this setting: for the env provider a variable MTH_SECRET_<NAME>, for the file provider a plain file name in the secrets directory.` |

  Field-error messages of `validation` are not web i18n keys today, the same as `validation.credential_refs`. If a form shows this message as text, the web owner adds an Arabic text. This ADR does not require one.
- **The database stays at shape level.** `p6_secret_ref_valid` (migration `0102`) checks the shape only (exactly `provider` and `name`, both strings). No database CHECK is added for the namespace, for two reasons. First, an IT-registered provider's namespace is open, so the database cannot state the whole rule. Second, the resolve-time half is the boundary that matters: a reference stored before the fix, or written past the API, resolves as unset and is never sent anywhere. This is decided, not a gap.
- **Unchanged by the namespace.** The platform's own configuration (ADR-0011: `DATABASE_URL`, `DATABASE_OWNER_URL`, `OIDC_CLIENT_SECRET` and the other `packages/config` variables) is read by `packages/config`, not through a `SecretRef`, so the "with no new variable set, the installation behaves exactly as DG5" sentence in §5 still holds. A deployment that pointed a P6 `SecretRef` at a variable outside `MTH_SECRET_*` must rename that variable. A `SECRETS_DIR` must be a directory of its own (`docs/operations/configuration.md`, "The namespace (F-DG6-120)").

REQ-S16-029 ("never expose secrets") and REQ-S16-030 ("a secret-management interface"). This is an engineering design record: it grants no business, Finance or IT approval (G1–G6), and it implies no DG0–DG7 result.

## Amendment (2026-11-04, T-DG6-ARCH-14; F-DG6-181): §5, a SecretRef is bound to its setting, its organization and its hosts

**Problem (F-DG6-181, High, mandatory; REQ-S16-029, REQ-S10-004).** After the F-DG6-120 repair, the `env` provider resolves any `MTH_SECRET_<NAME>` for any consumer, and every write-time check tests the name's shape only. Nothing records which setting or organization IT provisioned a secret for, so §5's "a SecretRef names a secret IT holds for this setting" was not enforced.

The code-security reviewer reproduced it (candidate `cf40705b`, `docs/delivery/test-evidence/DG6/code-security/round-2/42-probe-secret-cross-org.log`). Organization A's ADM_TECH, who gets 404 on organization B's connector, still did two things:

- created an organization-A `http_pull` connector naming B's `MTH_SECRET_*` bearer (201, `resolvable: true`);
- ran its test, and the API sent `Authorization: Bearer <B's token>` to a host A chose.

The same path reaches the installation's S3 secret access key, the SMTP password, the assistant key and the webhook signing secrets. `resolvable` also told the caller whether a guessed name exists.

The decision below enforces the sentence. It replaces nothing in the namespace rule (amendment of 2026-11-02), which stays the first check.

### A. The binding manifest: declared by IT, outside the database, without values

- **Variable:** `SECRET_BINDINGS_FILE`, added to `ENV_VARS` in `packages/config/src/index.ts`, with `.env.example` regenerated.
  - `required: false`, `secret: false`, `usedBy: ["api", "worker"]`.
  - It is the path of a UTF-8 JSON file that IT maintains and mounts read-only into both containers, for example `/run/mth-config/secret-bindings.json`.
  - The file holds names, scopes and hosts, **never a value**. It is not a secret.
  - It is IT-controlled configuration: no API operation reads or writes it, no table mirrors it, and no product role (ADM_TECH included) can change it.
  - The repository ships no manifest for production. Test and demo fixtures are synthetic.
- **Format, version 1.** The parse is strict: any key not shown is refused.

  ```json
  {
    "version": 1,
    "bindings": [
      { "provider": "env",  "name": "MTH_SECRET_ORGB_ERP_TOKEN",       "consumer": "connector",       "organization": "ORGB",                  "hosts": ["erp.orgb.example"] },
      { "provider": "env",  "name": "MTH_SECRET_ORGB_WEBHOOK_SIGNING", "consumer": "webhook_signing", "organization": "ORGB" },
      { "provider": "env",  "name": "MTH_SECRET_ORGB_SMTP_PASSWORD",   "consumer": "smtp",            "organization": "ORGB",                  "hosts": ["smtp.orgb.example:587"] },
      { "provider": "file", "name": "s3_secret_access_key",            "consumer": "storage",         "organization": null,                    "hosts": ["objects.it.example"] },
      { "provider": "env",  "name": "MTH_SECRET_ASSISTANT_KEY",        "consumer": "assistant",       "organization": null,                    "hosts": ["llm.it.example"] }
    ]
  }
  ```

- **Rules.** Any violation stops the API and the worker at start with exit 78 and a `ConfigError`. The error names `SECRET_BINDINGS_FILE`, the entry's index and the field, and never prints file content.
  1. `version` is `1`. At most 1,000 bindings, and the file is at most 1 MiB.
  2. `provider` matches the provider-id pattern. `name` is inside that provider's namespace (`secretRefInNamespace`), so a binding can never name a platform variable such as `DATABASE_URL` or `OIDC_CLIENT_SECRET`.
  3. `consumer` is one of the closed set `connector` | `webhook_signing` | `smtp` | `storage` | `assistant`. A new consumer kind needs an amendment of this ADR.
  4. `organization` depends on the consumer.
     - The tenant settings `connector`, `webhook_signing` and `smtp` are stored per organization. For them it is the organization's `code` (`^[A-Z0-9][A-Z0-9_-]{0,31}$`, unique: `organization_code_key`). IT knows the code before the organization has any setting: it is given at bootstrap (`--org-code`) or on create.
     - **The code is immutable in the product.** `OrganizationUpdate` has no `code` property, and no operation, job or seed step updates `organization.code`. The binding relies on this invariant. T-DG6-BE-Z2 pins it with a test, and an operation that changes `organization.code` needs an amendment of this ADR.
     - The UUID was not chosen, because it is generated at creation, so a test stack or a newly created organization could not be bound before it starts.
     - The installation settings `storage` and `assistant` are one row per installation. For them it is exactly `null`.
     - So **an installation secret can never be named by a tenant setting**, and the reverse is also true (rule B).
  5. `hosts` depends on the consumer.
     - For `connector`, `smtp`, `storage` and `assistant` it is required, with 1 to 16 entries.
     - For `webhook_signing` it is absent, because that secret is only used to verify and is never sent.
     - An entry is `host` or `host:port`. The host is lower-case, in the form the WHATWG `URL` parser serializes a hostname (an IDN in punycode, an IPv6 address in brackets), with no scheme, path, user information or wildcard.
     - The port is 1–65535. An entry without a port allows any port of that host.
  6. A `(provider, name)` pair appears **at most once**. One secret has one consumer kind and one scope. IT provisions a separate secret for each organization and each use. A duplicate is a start error, not a merge.
  7. An unset `SECRET_BINDINGS_FILE` is an empty manifest, so **no reference is bound** (fail closed). An unreadable or invalid file is a start error.
  8. The file is read once at start. A change needs a restart of the API and the worker, as with any other variable.
  9. An `organization` code that matches no organization binds nothing. The loader does not query the database.
- **Where the code lives.** One parser and one match function are shared by both processes: `packages/config/src/secret-bindings.ts`, exported by `@mth/config`. They are not a twin, so they cannot drift (D-198). ADR-0002 rule 5 holds, because the worker imports `@mth/config`, not API code.

### B. The match rule

`secretBinding(ref, use)`, with `use = { consumer, organizationCode: string | null, host: { hostname, port } | null }`, answers `bound`, `not_bound` or `host_not_bound`.

- **Where the code comes from.** The caller fills in `organizationCode` from the setting's own `organization_id`, by reading `organization.code`. Because the code is immutable, a per-process cache of id to code is safe. A setting's organization comes from its stored row (or, on create, from the validated target organization that authorization already checked), never from a request field that has not been authorized.

- **`not_bound`** in each of these cases:
  - the reference is outside its namespace;
  - no binding has the same `(provider, name)`;
  - the binding's `consumer` differs from `use.consumer`;
  - the binding's `organization` differs from `use.organizationCode` (`null` matches only `null`; the comparison is exact).

  Each of the following is therefore `not_bound`, the same answer as for a name nobody bound:
  - another organization's secret;
  - a secret of another kind (for example B's webhook signing secret named as A's connector bearer);
  - an installation secret named by a tenant setting;
  - a tenant secret named by an installation setting.
- **`host_not_bound`**: the reference is bound, but `use.host` matches none of `hosts`.
  - The hostname is compared after WHATWG canonicalization, lower-case and **exact**. There is no suffix match: `erp.orgb.example` does not admit `x.erp.orgb.example`.
  - An entry with a port matches only that effective port, with the scheme default applied (`https` 443).
- **`use.host` is `null`** only in two cases:
  - for `webhook_signing`;
  - for a connector whose adapter has no network destination (`test_adapter`, `endpointUrl` null).

  Every adapter kind that sends a credential must pass its destination. An adapter that sends a credential with `use.host = null` is a defect of that adapter.
- **What the answer depends on.** It depends only on the manifest and the setting. It **never asks a provider**, and it never reads the variable or the file. So it is no existence oracle.

### C. The consumers

| Setting (pointer) | `consumer` | `organization` | `host` | Write-time check | Resolve-time check |
|---|---|---|---|---|---|
| Connector credentials, every key (`/config/credentialRefs/<key>`; host field `/config/endpointUrl`) | `connector` | the code of `connector.organization_id` | host and port of `endpointUrl`; `null` without one | `integrations/connectors.ts` `checkConfig`, on create and on every new configuration version, so changing **either** the references **or** the endpoint re-checks | `integrations/secret-refs.ts` `resolveCredentials`, used by the test (`connectors.ts` `fetchForTest`), the run (`runs.ts`) and the outbound dispatch (`outbound.ts`); and `credentialRefViews` (`resolvable`) |
| Webhook signing secret (`/signingSecretRef`; the carried-over `previousSecretRef`) | `webhook_signing` | the code of the endpoint's organization (= its connector's) | `null` | `integrations/webhooks.ts` `checkSecretRef`, on create and rotate | `receiveWebhook` `resolveRef`, current and previous |
| SMTP (`/smtp/usernameRef`, `/smtp/passwordRef`; host field `/smtp/host`) | `smtp` | the code of the channel's organization | `smtp.host` and `smtp.port` | `admin/notification-channels.ts` PUT | API test send (`notification-channels.ts`, `tasks/channels/email.ts`) and worker delivery (`apps/worker/src/channels/email.ts` through `handlers/notifications.ts`) |
| Evidence storage S3 (`<pointer>/accessKeyRef`, `<pointer>/secretKeyRef`, where `<pointer>` is `/s3` or `/candidate`; host field `<pointer>/endpoint`) | `storage` | `null` | host and port of the S3 `endpoint` | `admin/storage.ts` PUT and test | `evidence/stores/s3.ts`, at each use and in the storage test |
| Assistant (`/credentialRef`; host field `/endpointUrl`) | `assistant` | `null` | host and port of `endpointUrl`; `null` for the test-adapter provider kind | `assistant/settings.ts` PUT, and again on enable | `assistant/provider.ts`, per call |

**The host checked is the host called.** The use's host is parsed with WHATWG `URL` from the same value the adapter is about to call (`adapterConfigOf(...).endpointUrl`, the SMTP settings, the store's endpoint, the assistant endpoint). Redirects stay refused: `http_pull` and the assistant use `redirect: "error"`, and the S3 probe uses `redirect: "manual"`. So a credential never follows a redirect to an unbound host. That invariant is part of this rule, and a change to it needs this ADR.

### D. Write time

**Order of the checks:**

1. Authorization (403/404, unchanged; a foreign organization's record is still 404).
2. The consumer's own shape check (422 `connector.secret_value_refused` / `storage.secret_ref_invalid` / `assistant.credential_ref_invalid`, unchanged).
3. The namespace (400, `validation.secret_ref_namespace`, unchanged).
4. **The binding.**

Every failing reference of the request gives its field error in the **same** `400 validation`. Nothing is written.

**The field errors** (p6-work-split §2 rule 17). The English texts are exact: `SECRET_REF_NOT_BOUND_MESSAGE` and `SECRET_REF_HOST_NOT_BOUND_MESSAGE` in `@mth/config`.

| Where | Code | When | English text |
|---|---|---|---|
| field error inside 400 `validation`, at the reference's pointer | `validation.secret_ref_not_bound` | `not_bound` | `Name a secret IT bound to this setting. IT binds each secret to one kind of setting and one organization.` |
| field error inside 400 `validation`, at the host field's pointer | `validation.secret_ref_host_not_bound` | `host_not_bound` | `IT has not bound this setting's secret to this host. A secret is sent only to the hosts IT names for it.` |

- **`not_bound` is one answer for every cause.** The body is byte-identical whether the name is unset, set, bound to another organization or kind, or unknown.
- **`host_not_bound` discloses nothing about another organization.** It is answered only for a reference bound to the caller's own setting kind and organization.
- **i18n.** Field-error messages are not web i18n keys today, as for `validation.secret_ref_namespace`. If a form shows them as text, the web owner adds the Arabic.
- **No contract shape changes.** No operation, status code, schema or top-level problem code changes. `docs/api/openapi.yaml` changes descriptions only: `SecretRef`, and `CredentialRefView.resolvable` (rule F).

**The audit event `secret_ref.refused`.** A binding refusal is the refusal of a mutation on authorization grounds (the secret is not the caller's to use), so it is audited like `authorization.denied` (ADR-0004 coverage rule; `apps/api/src/modules/access/denials.ts`).

- **How it is written.** The 400 `HttpProblem` carries a `secretRefusal` attachment. An `onError` hook writes the event in a separate short transaction after the request's own transaction rolled back.
- **When.** One event per refused request, including the POST tests (storage test).
- **Fields:**
  - `action`: `secret_ref.refused`;
  - actor: the user;
  - `recordType`: `user`, and `recordId`: the actor's user id. The event is about the attempt; a create has no row yet, and the installation settings have no organization.
  - `organizationId`: the setting's organization (`null` for `storage` and `assistant`);
  - `reason`: `<METHOD> <route>: <consumer> reference <provider>:<name> not bound`, or `… not bound to host <hostname>[:<port>]`.
  - No `changes`. Field names such as `secretRef` are forbidden in audit diffs (`FORBIDDEN_FIELDS`), and there is nothing to diff.
- **No value.** No value is read, so none can be logged.
- **A namespace refusal (step 3) is not audited.** It depends on the name's shape only, unchanged from 2026-11-02.

### E. Resolve time, fail closed

- **No resolve without a use.** `SecretProviderRegistry.resolve(ref)` becomes `resolve(ref, use)`. The registry is created with the loaded bindings and a cached `organization.code` lookup: `createSecretProviderRegistry({ bindings, organizationCodeOf })`, with a test setter as for the providers. There is **no resolve without a use**: the type has no such overload, so a missed call site does not compile. The worker twin `apps/worker/src/secrets.ts` follows (D-198).
- **What it checks.** It checks the namespace, then `secretBinding`. On `not_bound` or `host_not_bound` it returns `undefined` **without calling the provider**, exactly as for an unset secret.
- **What the consumer sees.** Each consumer keeps its existing outcome for an unresolvable secret, so no user-facing code is added at resolve time:
  - `connector.secret_unresolvable` (test and run);
  - `no_response` with nothing dispatched (outbound);
  - the single 401 `webhook.unauthenticated` (webhooks);
  - `smtp.secret_unavailable` (SMTP);
  - the storage test's existing credential-reference failure;
  - "no request is made" (the assistant).
- **The log line.** One structured line at level `warn`: `{ event: "secret_ref.refused", consumer, organizationId, provider, name, reason: "not_bound" | "host_not_bound" }`. It holds no value.
- **No audit event here.** Resolution happens in reads, runs and the worker. A stored unbound reference arises only when IT removed or changed a binding, or a row was written past the API. The run's own failure record, and the connector exception of ADR-0053, already show it.

### F. `resolvable`: no existence oracle

`credentialRefViews` computes `resolvable` through `resolve(ref, use)` with the connector's own use (rule C).

- An unbound reference, or one whose host does not match, is `false`, and the provider is not asked.
- A bound reference reports whether IT has set the value. That is the caller's own organization's secret, which the setting's reader may know about.
- A caller can store only a bound reference (rule D), so `resolvable` can never report on another organization's or the installation's secret.
- `null` keeps its meaning ("not checked": no registry composed).
- The other settings (webhook, SMTP, storage, assistant) expose no `resolvable` flag today. If one is added, it must use the same function.

### G. Egress: the binding's `hosts` is the credential egress rule; no global endpoint allow-list in this repair

- **Decision.** A credential leaves the process only towards a host that IT listed for that very secret (rules B and E), and redirects are refused (rule C). That closes the reproduced path: A's connector naming B's secret, or any connector naming an installation secret.
- **Why the binding alone is enough here:**
  - Without the host rule, an organization's own ADM_TECH could still redirect that organization's bound ERP token to a host of their choice by changing `endpointUrl`. With it, they cannot.
  - A connector, assistant or store **without** a credential carries no secret to its host.
- **What stays outside this decision.** Reaching internal services from the API through an arbitrary `endpointUrl` (server-side request forgery) is outside F-DG6-181. The control for it remains the deployment's network egress policy (`docs/operations/restricted-network.md`). A product-level allow-list for credential-less endpoints is not decided here. It is proposed to the orchestrator as an observation (handback T-DG6-ARCH-14 §7).

### H. Migration, database and compatibility

- **No migration.** The binding is configuration, not data. `p6_secret_ref_valid` (`0102`) stays a shape check, for the reasons of 2026-11-02, and because the binding lives outside the database by design.
- **Existing rows.** A reference stored before this rule that no binding covers resolves as unset (fail closed). The setting shows `resolvable: false`, and runs fail with the existing codes until IT adds the binding.
- **"With no new variable set the installation behaves exactly as DG5"** still holds. DG5 had no `SecretRef` setting, and a P6 installation without a manifest simply has no usable `SecretRef`.

### I. Operations text

- **`docs/operations/configuration.md`, "Secret providers":**
  - add a subsection "The binding (F-DG6-181)" with the manifest format, rules A1–A9 and the two field errors;
  - extend the `ENV_VARS` table with `SECRET_BINDINGS_FILE`;
  - replace "A reference outside the namespace stored before this rule resolves as 'not set'" with the unbound-reference sentence of rule H.
- **`notifications.md`** (SMTP references) **and `storage.md`** (S3 references): add "IT also binds the secret to this setting and its hosts in `SECRET_BINDINGS_FILE` (`configuration.md`, 'The binding')".
- **Implementer:** T-DG6-BE-Z2 makes these edits, so that they are true only when the code ships. The exact texts are in handback T-DG6-ARCH-14 §5.

REQ-S16-029 ("never expose secrets"; "a job's identity cannot read records outside its scope"), REQ-S16-030 ("a secret-management interface") and REQ-S10-004 (organization scoping). Proposed by the solution-architect. It becomes binding when the orchestrator records the decision (proposed D-entry in the handback). This is an engineering design record: it grants no business, Finance or IT approval (G1–G6), and it implies no DG0–DG7 result.
