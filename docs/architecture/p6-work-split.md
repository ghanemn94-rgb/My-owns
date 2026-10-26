# P6 work split: shared rules, file ownership, contracts and integration order

- **Plan:** `docs/architecture/p6-plan.md` (T-DG6-ARCH-00), adopted by D-195 with the user's decisions on Q1–Q14 and the reopen candidates. This file holds one section per architecture task (p6-plan §4); each ARCH task writes only its own section. §1–§2 and §E/F are written by T-DG6-ARCH-01; §J/C by T-DG6-ARCH-02, §B/A by T-DG6-ARCH-03, §H/G by T-DG6-ARCH-04, §D by T-DG6-ARCH-05, §I/K by T-DG6-ARCH-06.
- **Stage:** P6 "Integration and system hardening" (DG6).
- **Rule:** two tasks never edit the same file at the same time (REQ-DLV-008). Anything not listed under an owner is **frozen**; changes go through the orchestrator (p6-plan §5.3).
- **Off-limits to every implementer** (the write guard enforces it): `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, `docs/delivery/reviews/**`, `docs/delivery/gates/**`, `docs/delivery/stages.json`, `docs/delivery/findings.json`, `trading_agent/`.
- **Product gates G1–G6 are business approvals inside the product.** Nothing in P6 reads or writes the engineering gate records DG0–DG7. Product G6 never implies DG7, and no agent, seed or job grants a real business, Finance or IT approval. Demo approvals are synthetic and labelled so. An "IT-approved" provider, store or endpoint is a configuration slot that Mobily IT fills; no P6 task claims IT approved anything.

## 1. How to read a slice section

Each slice section lists: what the architect already delivered (do not re-create); one block per implementer task with its exact files, the operations it routes, the contracts it consumes and its tests; the migrations left in the slice range and their order; the integration order; a requirement → owner table; and what the implementers must know. Paths are relative to `apps/api/src/modules/` unless they start with `apps/`, `packages/`, `deploy/`, `docs/`, `e2e/` or `tests/`. Every API task also owns its tests, its `apps/api/test/support/p6-pending-<task>.ts` and its `apps/api/test/integration/contract/p6-exercises-<task>.ts`.

## 2. Shared rules for every P6 implementer task (the DG2–DG5 lessons; reviewers check them)

1. **Free text.** Every free-text field goes through the shared `freeText`/`hasText`/`hasInvalidCharacter` rules; truncation only through `truncateText`.
2. **Strict UTF-8.** JSON and query parsing is strict UTF-8 on every route (the BE13 parser); no route-local parser.
3. **`config.consumes`.** Every new route's `config.consumes` equals its operation's request media type in `docs/api/openapi.yaml` (every slice E/F body is `application/json`; bodiless GETs declare none). Imports and webhooks (slice A) add `text/csv`, the XLSX media type and `application/json`, each pinned in the contract test.
4. **Every mutation** has: authorization re-checked at commit time (inside the transaction, after the row lock); validation; `If-Match` (428 when missing, 409 when stale; creates are version 1; `IfMatchOrZero` `"0"` creates a defaulted row); one audit event with prior and new version in the same transaction; **no remote I/O inside a transaction** (connector calls, SMTP sends, object-store writes, webhook verification and model calls happen before or after it, recorded through the outbox); and a test for each of these.
5. **Decimal only.** Money, rates, percentages, FTE and KPI values are decimal strings and `numeric` columns, never floats; imported values are decimal strings, never a spreadsheet's binary double. Unknown, Stale and Not computable are never shown as 0 or green.
6. **Bilingual text.** Arabic RTL and English LTR, translated at render time; problem `code`s are i18n keys and are translated too (`Accept-Language`). Notifications store `messageKey` + `messageParams`, never sentences.
7. **Web forms and AUD.** One form-level alert per form; actions are session-bound (`auth/sessionBound.ts`); the AUD user sees read-only views and gets 403 on every write (each slice tests AUD on its own operations); the label is "business approval", never DG0–DG7.
8. **Ports and locale.** Harness ports stay below 32768; verification runs with the locale unset and with `C.UTF-8`.
9. **Formula engine unchanged.** `packages/shared/src/formula/**` is reused as it is. Any change there is a reopen candidate.
10. **Exactly once.** Jobs and automations use the advisory-lock registry (`platform/advisory-locks.ts`), unique backstops and idempotency keys; a replay creates nothing (the DG4 S12-021 pattern).
11. **Value bases never mixed** (D-117, D-119, D-122), and every number states its unit kind (ADR-0037 N5).
12. **True texts.** User-facing text is true for the release it ships in (F-DG4-160): when a P6 feature ships, the texts that called it planned are updated in the same task; texts for P7 features stay.
13. **Deterministic tests.** Tests are deterministic under load (F-DG4-143 to F-DG4-148) and never read growing delivery folders (D-138). Every new e2e spec states its budget from a loaded measurement, at least 2x the measured loaded worst case where the default 30 s is tight (F-DG5-145/146/151 class).
14. **Honest live-integration status.** An adapter that cannot be exercised live here (enterprise IdP, an IT object store, SMTP or enterprise messaging, an AI model endpoint, corporate sources) ships with its port, a working local test adapter, contract tests and a documented residual; it is never called "live", "integrated with Mobily" or "tested against production" (p6-plan R3).
15. **e2e budgets are measured** (F-DG5-145/146/151): every new spec states a budget from a loaded measurement.
16. **Contract seams.** Each task removes its operations from its own `p6-pending-<task>.ts` in the same change that routes them, and exercises each through the validating client in its own `p6-exercises-<task>.ts` (success and every declared refusal it can reach). The pinned counts in `contract.test.ts` (operation count, media types, rate-limit floor, CSRF-exempt webhook routes) are reconciled by the orchestrator from the handbacks (D-079 precedent): report your deltas.
17. **Exact refusals.** Problem codes and English texts are exactly those in the slice ADR tables (slice E: ADR-0051 §2–§4; slice F: ADR-0052 §1, §2). A code you need that is not there goes in your handback with its proposed text.
18. **Migrations.** Forward-only; a merged migration is never edited. The eight retired P5 ids (0066, 0067, 0073, 0077, 0078, 0079, 0083, 0084) are never filled. `packages/db/src/seed.test.ts` accepts ids up to 0133 (p6-plan §4: ranges 0098–0127, repairs 0128–0133). **The migration runner refuses a pending file whose id is not above the highest applied id (ADR-0003; F-DG5-100).** A number left in a slice range is therefore usable only while no higher id has shipped; once a later ARCH task's migration is merged, the lower free numbers of earlier ranges are permanently unused. An implementer who needs a migration asks the orchestrator for the id at merge time (see §E/F.9).
19. **No dependency, secret or CDN.** A dependency you need goes in your handback with its official documentation, support window and licence (D-195). No secret in the repository; no public CDN.
20. **Clones, not worktrees.** Never run `git worktree add`; use a `git clone` under `$TMPDIR` (D-082).

## §E/F. Slices E (authorization boundary) and F (request, input and integrity hardening) — T-DG6-ARCH-01

### E/F.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADRs | `docs/architecture/adr/ADR-0051-p6-authorization-boundary-read-scope-sensitive-records-deep-links.md`, `ADR-0052-p6-request-input-hardening-uploads-preview-secrets-audit-api-sweeps.md` | Binding design, with the refusal codes and English texts |
| Migrations | `packages/db/migrations/0098_p6_sensitive_records_deep_links.sql`, `0099_p6_upload_policy_content_types.sql`, `0100_p6_access_hardening_permissions.sql` | Applied on a fresh PostgreSQL 16.13 and over a P5-populated database; 70/70 guard probes PASS (`docs/delivery/handbacks/DG6/T-DG6-ARCH-01-evidence/probe-output.txt`) |
| Kysely types, catalogue and seed pins | `packages/db/src/schema.ts` (5 tables; 3 columns on `inbox_notification`, 1 on `evidence_content`), `packages/db/test/integration/catalogue.test.ts` (triggers, mutable tables, privileges), `packages/db/src/seed.test.ts` (0100 block; numbering rule up to 0133) | Pinned |
| Permissions | `packages/shared/src/permissions.ts` (`P6_ACCESS_HARDENING_PERMISSIONS`, `P6_ACCESS_HARDENING_ROLE_PERMISSIONS`, the `P6_PERMISSIONS` aggregate; 5 codes) | Equals `0100` |
| Lock classes | `platform/advisory-locks.ts` (`sensitiveRecordGrant` 730300, `deepLinkIssue` 730301; 730302–730304 reserved), ADR-0016 §6 | Registry test updated |
| Contract | `docs/api/openapi.yaml` 1.5.0-p6: 13 operations (tags `access`, `tasks`, `evidence`, `security` (new), `audit`); the `Permission` enum gains the 5 codes | `pnpm openapi:lint` PASS (859 operations); P1–P5 paths unchanged |
| Contract-test seams | `apps/api/test/support/p6-pending.ts` (P6 aggregate; each later ARCH task adds one import line; frozen after ARCH-06), `p6-pending-arch-01.ts` (slice aggregate; frozen), `p6-pending-be-b.ts` (6), `p6-pending-be-c.ts` (1), `p6-pending-be-d.ts` (3), `p6-pending-be-e.ts` (3); `p2-pending.ts` includes P6; `contract.test.ts` operation count 859; `p6-operations.ts` (the 13 ids, frozen per block; each later ARCH task appends its block) excluded from the P2-scoped AUD sweeps `aud-write-deny.test.ts` and `kpi/kpi-aud-write-deny.test.ts` | Contract test green with all 13 pending |
| ERD §1t, data dictionary "P6 tables, slices E and F", permissions matrix §24 | `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | Dictionary generated from the catalogue |

p6-plan §5.1's BE-B, BE-C and BE-E are each split into two tasks (BE-B/BE-B2, BE-C/BE-C2, BE-E/BE-E2) so that each fits 60–75 minutes (the P4/P5 `-2` precedent). The split adds no file to the plan's boundaries; it only orders them.

### E/F.1 BE-A — P6 registry, stubs and wiring points (backend-workflow-engineer; W2; first)

The p6-plan §5.1 BE-A list. For slices E and F specifically:
- **Stub files** (`export {}` or a route plugin registering no route until its owner fills it), each with its registration line: `access/read-scope.ts`, `access/sensitivity.ts`, `tasks/deep-links.ts`, `evidence/access.ts`, `evidence/content-policy.ts`, `evidence/preview.ts`, `admin/upload-policy.ts`, `admin/security.ts`, `platform/secrets.ts`, `audit/routes.ts`; schema mirror stubs and barrel lines in `packages/shared/src/schemas/index.ts` for `sensitivity.ts` (BE-B), `deep-links.ts` (BE-C), `uploads.ts` (BE-D), `security.ts` and `audit-events.ts` (BE-E).
- **Wiring points** in `server.ts`: the `SecretProvider` registry (default providers `env` and `file`, filled by BE-E), and the `ReadScope` factory export used by later slices.
- **`platform/db-errors.ts` P6 mappings** (exact): `sensitive_record_grant_one_active_key` → 409 `sensitive_grant.duplicate`; `sensitive_record_grant_not_self` → 422 `sensitive_grant.not_self`; `sensitive_record_grant_transition` → 422 `invalid_transition`; `record_sensitivity_record_ref`, `sensitive_record_grant_record_ref` → 404 `not_found`; `record_sensitivity_record_key`, `upload_policy_organization_key` → 409 `version_conflict` (a concurrent `If-Match "0"` create); `upload_policy_allowed_types`, `upload_policy_max_bytes` → 400 `validation`. `inbox_notification_deep_link_once`, `inbox_notification_link_token_key`, `evidence_content_detected_type` and `evidence_content_detected_media_type` stay unmapped (500): the API never sends values that violate them, and a test of BE-C/BE-D proves it.
- **`contract.test.ts`** imports of every `p6-exercises-*.ts`.

### E/F.2 BE-B — `ReadScope`, the parity test, sensitivity and grants (backend-workflow-engineer; W3; after BE-A)

- **Files:** `access/read-scope.ts` (ADR-0051 §1), `access/sensitivity.ts` (the §2 clause `sensitiveAdmits`, `requireSensitiveRead`, and the six routes), the two `STRUCTURAL_PERMISSIONS` lines in `access/rules.ts` (`sensitive_record.grant`, `sensitive_record.read`), the export lines in `access/index.ts`, `packages/shared/src/schemas/sensitivity.ts`; tests `access/read-scope.test.ts`, `apps/api/test/integration/access/read-scope-parity.test.ts`, `apps/api/test/integration/access/sensitivity.test.ts`.
- **Operations (6):** `getRecordSensitivity`, `putRecordSensitivity`, `listSensitiveGrants`, `createSensitiveGrant`, `getSensitiveGrant`, `revokeSensitiveGrant`.
- **Consumes:** ADR-0051 §1, §2, §6, §7; lock 730300 (`ADVISORY_LOCK_CLASSES.sensitiveRecordGrant`); `0098`.
- **Tests:** the parity test of ADR-0051 §1 (prints the pair count); mark/unmark with `IfMatchOrZero`; grant, duplicate 409, self 422, grantee in another organization 422, revoke and revoke-again 422 `invalid_transition`; ADM_ACCESS with an organization-level assignment grants (structural) but reads no title it is not admitted to; AUD 403 on every write and 200 on the reads; one audit event per mutation with prior/new version; commit-time re-authorization (a grant right revoked between load and commit → 403, nothing written).

### E/F.3 BE-B2 — sensitivity on the record reads, rollups and export selection (backend-workflow-engineer; after BE-B)

- **Files (named lines only):** the read and list lines of `benefits/**` (benefit GET and lists), `kpi/business-cases.ts` (business-case GET and list read lines), `evidence/routes.ts` **metadata** read and list lines (before BE-C's content lines; sequential), the aggregate lines that add `includesRestrictedRecords` in `benefits/**` totals and `reporting/dashboards/**`, the `ReadScope` line in `reporting/exports/jobs.ts`; the BE-B2 inventory of every aggregate response that includes a benefit or business-case value, in its handback with the schema additions it requests (`includesRestrictedRecords: boolean`, optional), which the orchestrator merges into the contract.
- **Operations:** none new.
- **Tests:** REQ-S10-002 literal: "a sensitive benefit is hidden from a workstream member without the grant" (list and GET 404) and visible after a grant; the benefit total is identical for both users, with `includesRestrictedRecords` true only for the one without admission; Unknown stays Unknown; an export of the portfolio report by a user without admission contains no row of the sensitive benefit; one regression test per touched DG4/DG5 read path proving the non-sensitive response is byte-identical (the transcript wrapper `apps/api/test/support/response-transcript.ts`).

### E/F.4 BE-C — deep links, inbox redaction, evidence access after ownership transfer (backend-workflow-engineer; W4; after BE-B2)

- **Files:** `tasks/deep-links.ts` (`deepLinkTarget(linkPath)`, lazy `issueDeepLink` under lock 730301, `resolveDeepLink` route), the redaction lines in `tasks/routes.ts` `listMyInbox` (ADR-0051 §3: `messageKey` `inbox.restricted`, `messageParams` `{}`), `evidence/access.ts` (`requireEvidenceRead`, ADR-0051 §4), the **content** read lines of `evidence/routes.ts` (`downloadEvidenceContent` calls `requireEvidenceRead`), `packages/shared/src/schemas/deep-links.ts`; tests `apps/api/test/integration/tasks/deep-links.test.ts`, `apps/api/test/integration/evidence/ownership-transfer.test.ts`.
- **Operations (1):** `resolveDeepLink`.
- **Consumes:** ADR-0051 §3, §4; `0098` columns; `ReadScope`/`requireSensitiveRead` (BE-B).
- **Tests:** REQ-S12-024 literal: a forwarded link opened by an unauthorized user returns 403 `deep_link.forbidden` and the body (minus `requestId`) is byte-identical for a sensitive target, a target in another transformation and a deleted target; an authorized colleague resolves it; the recipient who lost access sees `inbox.restricted` with empty params, and sees the title again when access is restored; concurrent lazy issue ×5 yields one token. REQ-S13-013 literal, per ADR-0051 §4 (a)–(e). **Before changing the outsider's 404, wait for the orchestrator's decision on ADR-0051 §4 (Option A or B).**
- **Notification writers are not edited** (ADR-0051 §3: seven insert sites at `HEAD`).

### E/F.5 BE-C2 — the S02-006 route-inventory sweep (backend-workflow-engineer; after BE-C)

- **Files:** `apps/api/test/integration/hardening/route-inventory.test.ts` and its helper `apps/api/test/support/route-inventory.ts` (request generation from the contract schemas).
- **Consumes:** ADR-0051 §5 (cases 1–4, the exclusions, the "nothing persisted" audit-count assertion).
- **Tests:** the sweep itself; it prints the eligible operation count per case. A DG1–DG5 operation that fails a case is reported in the handback as a finding with its file, not fixed here (p6-plan R1).

### E/F.6 BE-D — upload allow-list, upload policy, safe preview (backend-workflow-engineer; W5; after BE-C)

- **Files:** `evidence/content-policy.ts` (ADR-0052 §1 detector: magic bytes, extension, OOXML central directory with ≤ 10,000 entries and no decompression, `vbaProject.bin` refusal, strict UTF-8 for csv/txt/svg; the effective policy = row or default), `evidence/preview.ts` (ADR-0052 §2 route and headers), the **upload** lines of `evidence/routes.ts` (after BE-C: detection after the size check, `detected_type` and canonical `content_type` stored, policy `max_bytes`), `admin/upload-policy.ts` (two routes), `packages/shared/src/schemas/uploads.ts`; tests `evidence/content-policy.test.ts` (one case per row of the §1 table plus `.exe`, renamed `.exe`, HTML, a ZIP that is not OOXML, a macro-enabled OOXML), `apps/api/test/integration/evidence/preview.test.ts`, `apps/api/test/integration/admin/upload-policy.test.ts`.
- **Operations (3):** `previewEvidenceContent`, `getUploadPolicy`, `putUploadPolicy`.
- **Consumes:** ADR-0052 §1, §2; `0099` (`upload_policy`, `evidence_content.detected_type`, `p6_upload_media_type`); `requireEvidenceRead` (BE-C).
- **Tests:** REQ-S13-011 literal: an `.exe` → 422 `evidence.type_not_allowed`; oversized → 413 `evidence.too_large`; an SVG with `<script>` uploads, preview → 422 `evidence.preview_unavailable`, download → `application/octet-stream` + `attachment`; a PNG preview has exactly the §2 headers; a pre-P6 file (detected_type NULL) is never previewed; a narrowed policy refuses a type the default allows.
- **Optional migration** (§E/F.9): "a new `evidence_content` row needs `detected_type`" (BEFORE INSERT), merged with the upload change.

### E/F.7 BE-E — `SecretProvider`, rate-limit classes, the security view, the global audit API (backend-workflow-engineer; W3; after BE-A)

- **Files:** `platform/secrets.ts` (ADR-0052 §5) and its lines in `packages/config/src/load.ts` (`SECRETS_DIR`; the class budget variables of ADR-0052 §4 with their defaults; `ENV_VARS` entries), the `rateLimitClass(name)` helper lines in `platform/hooks.ts` and the `upload` class line on `uploadEvidenceContent` in `evidence/routes.ts` (a one-line route config change; sequential with BE-B2/BE-C/BE-D on that file), `admin/security.ts` (`getSecurityRateLimits`), `audit/routes.ts` and the query in `audit/index.ts` (`listAuditEvents`, `getAuditEvent`, ADR-0052 §8 scope and redaction), `packages/shared/src/schemas/{security,audit-events}.ts`; tests `platform/secrets.test.ts`, `apps/api/test/integration/audit/audit-events.test.ts`, `apps/api/test/integration/admin/security.test.ts`.
- **Operations (3):** `getSecurityRateLimits`, `listAuditEvents`, `getAuditEvent`.
- **Consumes:** ADR-0052 §4, §5, §8; `ReadScope`/`sensitiveAdmits` (BE-B) for audit redaction — if BE-B has not merged, BE-E lands the routes with redaction behind the BE-B export and the redaction test marked pending in the handback (never skipped silently).
- **Tests:** a `SecretValue` prints `[secret]` in `String()`, `JSON.stringify` and a pino log line; `NAME` and `NAME_FILE` both set → configuration error naming the variable only; the audit scope rules (AUD sees its scope; ADM_TECH with an organization assignment sees organization-level events only; a sensitive record's events redacted); REQ-S16-032 literal "an UPDATE on the audit table by the application role fails" (also probe AU01); AUD 200 on reads; no write operation exists.

### E/F.8 BE-E2 — the security suite (backend-workflow-engineer; after BE-E and BE-D)

- **Files:** `apps/api/test/integration/security/{csrf,sql-injection,xss,uploads,rate-limits}.test.ts`, the web source scan `apps/web/src/security-source-scan.test.ts` (no `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` outside test files).
- **Consumes:** ADR-0052 §3, §4, §11 (the exact payload sets).
- **Tests:** one PASS line per REQ-S16-030 clause (CSRF, SQL injection, XSS in rich text, disallowed upload type, oversized upload, rate limiting). QA-D adds the XSS e2e.

### E/F.9 Migrations left in the range and their order

The range is 0098–0103; the architect used 0098–0100. **0101–0103 are usable only while no migration above 0103 has been merged** (§2 rule 18). T-DG6-ARCH-02 (W2) is planned to merge 0104+ before BE-D (W5), so in the planned order 0101–0103 become permanently unused. BE-D's optional migration ("a new `evidence_content` row needs `detected_type`") therefore takes **the id the orchestrator allocates at merge time** (the next id above the highest shipped id, from the repair block 0128–0133 or as the orchestrator decides). Without it, the rule is enforced by the API and BE-D's tests only, and the handback says so. No other E/F migration is planned.

### E/F.10 BE-F — response validation of every operation and the S16-023 integrity sweep (backend-workflow-engineer; W4; after BE-A)

- **Files:** `apps/api/test/integration/contract/response-validation.test.ts` and its wrapper in `apps/api/test/support/contract.ts` (named lines: record `(operationId, status)` per validated response), `apps/api/test/integration/hardening/integrity-sweep.test.ts`.
- **Consumes:** ADR-0052 §7, §9. Defects in another owner's route are reported in the handback, not fixed (p6-plan §5.1).
- **Tests:** every operation outside the pending aggregate has at least one validated response (the test lists any that has none); the uniform 400 body; 403/404 for unauthorized; `nextCursor` on lists; the S16-023 trio literally (approved gate decision or its evidence delete → 409; illegal transition → 422 `invalid_transition`; duplicate → 409), and the P6 entity rows as later ARCH sections add them.

### E/F.11 DO-A — dependency audit and environment template (devops-engineer; W4; after ARCH-01)

- **Files:** `deploy/ci/ci.yml` (the `dependency-audit` job, ADR-0052 §6), `deploy/scripts/dep-audit.mjs` (offline SBOM check against `deploy/advisories/snapshot-<yyyy-mm-dd>.json`, with a negative fixture test), the snapshot file with its source and retrieval date, `deploy/scripts/generate-env-example.mjs` and the regenerated `.env.example` (P6 variables of BE-E: names only).
- **Tests:** the offline check fails on a fixture advisory matching an SBOM entry and passes on the committed snapshot; the CI job is structure-checked by the existing CI structure test. The live `pnpm audit` is **BLOCKED** in the sandbox (no registry advisory service) and is reported so.

### E/F.12 FE work for slices E and F (frontend-ux-engineer)

- **FE-A (W3, shell):** the i18n keys up front in `apps/web/src/i18n/{en,ar}/{nav,problems}.json` and the P6 API client entries for the 13 operations: problem codes `sensitive_grant.not_self`, `sensitive_grant.grantee_not_in_organization`, `sensitive_grant.duplicate`, `sensitivity.reason_required`, `deep_link.forbidden`, `evidence.parent_forbidden`, `evidence.type_not_allowed`, `evidence.type_mismatch`, `evidence.preview_unavailable` (and the existing `evidence.too_large` with the policy limit); texts `access.includesRestrictedRecords` ("Includes restricted records" / "يشمل سجلات مقيدة"), `inbox.restricted` ("You no longer have access to this item." / "لم تعد لديك صلاحية الوصول إلى هذا العنصر."); Administration entries Audit, Security (upload policy, rate limits) and Sensitive grants; the deep-link route `/l/{token}`. Arabic texts are provisional and labelled so in the catalogue comments.
- **FE-B (after FE-A, BE-C, BE-E, BE-D):** `pages/admin/{audit,upload-policy,sensitive-grants,security}/**`, `pages/deep-link/**`, `components/sensitivity/**` (the flag and grant panel, mounted by one named line each on the benefit, business-case and evidence detail pages), `components/evidence-preview/**` (raster preview in an `<img>` from the preview URL; a file-type icon and "Download" for every other type; never an `<iframe>` or `<object>`), and the restricted-records label component used by the totals. AUD sees every page read-only.

### E/F.13 Integration order

BE-A → BE-B → BE-B2 → BE-C → BE-C2 and BE-D (BE-D after BE-C on `evidence/routes.ts`) → BE-E2. In parallel: BE-A → BE-E (W3) → BE-E2; BE-A → BE-F (W4); DO-A (W4). FE-A after BE-A; FE-B last. `evidence/routes.ts` is edited sequentially: BE-B2 (metadata read lines) → BE-C (content read lines) → BE-D (upload lines) → BE-E's one-line `upload` rate-limit class (if BE-E runs before BE-D, BE-D keeps that line). `access/rules.ts` is edited only by BE-B.

### E/F.14 Requirement → owner

| Requirement | Delivered by the architect | Implementer owner(s) | Proof |
|---|---|---|---|
| REQ-S02-006 | ADR-0051 §5 | BE-C2 (sweep); slice H for draft recovery | route-inventory sweep; QA-D draft e2e |
| REQ-S10-002 | `0098`, `0100`, ADR-0051 §2, §7 | BE-B, BE-B2, FE-B | A12: sensitive benefit hidden without grant; 403/404 across transformations |
| REQ-S10-004 | ADR-0051 §1 | BE-B (port, parity), BE-B2 (exports); search H and assistant D consume it | parity test; QA-B A12 extension |
| REQ-S12-024 | `0098` deep-link columns, ADR-0051 §3 | BE-C, FE-B | forwarded link 403 without title |
| REQ-S13-013 | ADR-0051 §4 | BE-C | post-handover download; outsider refused |
| REQ-S13-011 | `0099`, ADR-0052 §1, §2 | BE-D, FE-B | .exe and oversized rejected; SVG never executed in preview |
| REQ-S16-023 | probe guards; ADR-0052 §9 | BE-F | integrity sweep |
| REQ-S16-027 | contract 1.5.0-p6; ADR-0052 §7 | BE-F | response-validation test |
| REQ-S16-030 | ADR-0052 §3–§6, §11 | BE-E, BE-E2, BE-D, DO-A | security suite; dependency-audit job (live audit BLOCKED in the sandbox) |
| REQ-S16-032 | `0100`, ADR-0052 §8; probe AU01–AU03 | BE-E, FE-B, BE-F | audit API scope tests; one audit event per mutation |

### E/F.15 What the implementers must know

1. **Sensitivity is a separate table.** No sensitivity column exists on `benefit`, `business_case` or `evidence`; marking never changes those records' versions (probe G04).
2. **The deep-link token is not a credential.** Never skip re-authorization because the caller holds a token; never put `messageParams` content in a 403 body or a channel message.
3. **The 403/404 question of ADR-0051 §4 is open** for callers without `transformation.read`; BE-C keeps the DG2 404 until the orchestrator decides.
4. **Downloads stay `application/octet-stream` + `attachment` for every type.** Only the new preview route serves inline, and only PNG, JPEG and GIF.
5. **Histories are written by triggers.** `record_sensitivity_change` and `upload_policy_change` are never inserted by the application (mth_app has SELECT only; probe RS15).
6. **Technical admins.** `sensitive_record.grant`/`.read` are structural (BE-B's `rules.ts` line); `audit_event.read` is not, so an ADM's organization-level assignment covers organization-level audit events only.
7. **Pending lists.** Remove your operation ids from your own `p6-pending-<task>.ts` in the same change that routes and exercises them; the aggregates are frozen.
