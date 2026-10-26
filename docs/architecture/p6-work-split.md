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

## §J/C. Slices J (operations and service identities) and C (identity, storage, notification channels) — T-DG6-ARCH-02

The §2 shared rules apply unchanged. For slices J and C, rule 17's "slice ADR tables" are ADR-0053 §2 (refusal table) and ADR-0054 §4; rule 16's pending files are the ones named below.

### J/C.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADRs | `docs/architecture/adr/ADR-0053-p6-operations-service-identities-exceptions-logs-heartbeat.md`, `ADR-0054-p6-identity-storage-notification-channels.md` | Binding design, with the refusal codes and English texts |
| Migrations | `packages/db/migrations/0101_p6_operations_service_identities.sql`, `0102_p6_storage_notification_channels.sql`, `0103_p6_operations_channels_permissions.sql` | Applied on a fresh PostgreSQL 16.13 and over a P5-populated database (0001–0097, then 0098–0103); 81/81 guard probes PASS (`docs/delivery/handbacks/DG6/T-DG6-ARCH-02-evidence/probe-output.txt`) |
| Kysely types, catalogue and seed pins | `packages/db/src/schema.ts` (11 tables; `evidence_content.storage_driver`), `packages/db/test/integration/catalogue.test.ts` (30 triggers, 6 mutable tables, 11 privilege pins), `packages/db/src/seed.test.ts` (0103 block; the free-id example is now 0104) | Pinned |
| Permissions | `packages/shared/src/permissions.ts` (`P6_OPERATIONS_CHANNELS_PERMISSIONS`, `P6_OPERATIONS_CHANNELS_ROLE_PERMISSIONS`, in `P6_PERMISSIONS`; 6 codes) | Equals `0103` |
| Lock classes | `platform/advisory-locks.ts` (`operationalExceptionUpsert` 730305, `channelDelivery` 730306, `storageSetting` 730307; 730308–730309 reserved), ADR-0016 §6 | Registry test updated (44 classes) |
| Contract | `docs/api/openapi.yaml` 1.5.0-p6: 17 operations (new tags `operations`, `platform-admin`); the `PermissionCode` enum gains the 6 codes | `pnpm openapi:lint` PASS (876 operations); no earlier line changed |
| Contract-test seams | `apps/api/test/support/p6-pending-arch-02.ts` (slice aggregate; frozen), `p6-pending-be-g.ts` (1), `p6-pending-be-h2.ts` (3), `p6-pending-be-i.ts` (4), `p6-pending-be-i2.ts` (1), `p6-pending-be-j.ts` (3), `p6-pending-be-k.ts` (5); one import line in `p6-pending.ts`; `contract.test.ts` count 876; `p6-operations.ts` (+17 ids) | Green |
| ERD §1u, data dictionary "P6 tables, slices J and C", permissions matrix §25 | `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | Dictionary generated from the catalogue |

p6-plan §5.1's BE-J, BE-K, BE-H and BE-I are split (BE-J/J2/J3, BE-K/K2, BE-H/H2, BE-I/I2) so each fits 60–75 minutes. The split adds no file outside the plan's boundaries.

### J/C.1 BE-J — service identities: declarations, seed, worker scope twin, admin routes (backend-workflow-engineer; after BE-A, BE-B)

- **Files:** `apps/api/src/modules/access/service-identities.ts` (load, `putServiceIdentity` service), the `admin/service-identities` route lines in `apps/api/src/modules/operations/routes.ts` (BE-K creates the file; BE-J adds its three routes in a named block), the identity-declaration lines in `apps/worker/src/kit.ts` (`defineJob`, `servicePrincipal`, `requireServiceRead`) and `apps/worker/src/schedules.ts`, new `apps/worker/src/service-scope.ts` (the `ReadScope` twin), the seed migration (next id at merge, D-196: one `service_identity` row per queue of `apps/worker/src/queues/**`, with its audit event, actor `system`, source `migration`), `apps/worker/src/service-identities.test.ts` (declarations = seeded rows), `apps/api/test/integration/operations/service-identity-scope.test.ts`, `apps/api/test/support/p6-exercises-be-j.ts`, `p6-pending-be-j.ts`.
- **Operations:** `listServiceIdentities`, `getServiceIdentity`, `putServiceIdentity`.
- **Consumes:** ADR-0053 §1, §9; ADR-0051 §1 (`readScopeFor`, the parity fixture).
- **Tests:** the out-of-scope proof of ADR-0053 §1 (two organizations: 0 rows of B admitted, `service_identity.out_of_scope` on a direct read); the worker-twin parity against the API `ReadScope`; `putServiceIdentity` (narrow, restore, 422 `service_identity.grant_exceeds_declaration`, 422 `service_identity.reason_required`, 409/428, AUD 403, audit `service_identity.grant_changed`); a missing identity fails the run with `service_identity.missing`.

### J/C.2 BE-J2 and BE-J3 — handlers read through their service principal (backend-workflow-engineer; after BE-J)

- **Files:** BE-J2: `apps/worker/src/handlers/{kpi,benefits,raid,portfolio,gates,approvals,escalations,launch,adoption}.ts`. BE-J3: `apps/worker/src/handlers/{access,automation,branding,demo,digests,meetings,platform,procedures,reports,sustainment}.ts` and `apps/worker/src/reports/**` read lines. One parity regression test per touched handler next to it (DG4/DG5 output identical on the DG5 fixture; the P5 R2 rule).
- **Consumes:** BE-J's `servicePrincipal`/`requireServiceRead`; ADR-0053 §1 (`aggregate_only` only for aggregates).
- **No operation.** A handler that needs a code its declaration lacks reports it in the handback; the declaration changes only by a new migration.

### J/C.3 BE-K — operational exceptions, routes, the failure hook, the heartbeat route and watch (backend-workflow-engineer; after BE-A, BE-J)

- **Files:** `apps/api/src/modules/operations/{exceptions.ts,heartbeat.ts,routes.ts,index.ts}` (BE-A creates the module stub), the failure-hook lines in `apps/worker/src/kit.ts` (after BE-J's lines: open or recur under lock 730305, after the `operational_failure` write; `recovered` on success), the J/C P6 mappings in `apps/api/src/modules/platform/db-errors.ts` (after BE-A): `operational_exception_transition` → 409 `operations.exception_not_open`; `operational_exception_resolved_final` → 409 `operations.exception_resolved`; `service_identity_grant_within_declaration`, `service_identity_permission_category` → 422 `service_identity.grant_exceeds_declaration`; `storage_setting_s3_complete` → 422 `storage.s3_incomplete`; `storage_setting_access_key_ref`, `storage_setting_secret_key_ref`, `notification_channel_username_ref`, `notification_channel_password_ref` → 422 `storage.secret_ref_invalid`; `notification_channel_email_complete`, `notification_channel_credentials_pair` → 422 `notification_channel.email_incomplete`; `notification_channel_no_messaging_adapter` → 422 `notification_channel.adapter_unavailable`; `storage_setting_singleton_key`, `notification_channel_kind_key` → 409 version conflict. Plus `apps/api/test/integration/operations/exceptions.test.ts`, `p6-exercises-be-k.ts`, `p6-pending-be-k.ts`.
- **Operations:** `listOperationalExceptions`, `getOperationalException`, `acknowledgeOperationalException`, `resolveOperationalException`, `getWorkerHeartbeat`.
- **Consumes:** ADR-0053 §2, §6, §9; DO-D's heartbeat writer (the route reads the table; the watch runs in the API process every 60 s).
- **Tests:** one failing job key fails 3 times → exactly one active exception with `occurrence_count` 3; a replay of the same `processed_message` key creates nothing; recovery resolves `recovered`; acknowledge/resolve with every refusal, 409/428, AUD 403, the scope rule (transformation-scope KDS sees only linked exceptions; an exception outside scope is 404); heartbeat `unknown` with no row, `stale` after 90 s, `alive`.

### J/C.4 BE-K2 — catalogue triggers, starter 16 version 2, the freshness scan, KPI links, error alerts (backend-workflow-engineer; after BE-K)

- **Files:** the triggers/starter migration (next id at merge: `connector.run_failed`, `data.stale`, starter 16 version 2), `apps/worker/src/handlers/operations.ts` (BE-A's stub: the `kpi.freshness_scan` job reading DG4 freshness through its service principal and the BE-K raise/resolve service twin), `apps/worker/src/queues/operations.ts`, the alert lines (log line + in-app notification of ADM ADR-0053 §6) in `apps/worker/src/handlers/operations.ts`, `apps/worker/src/handlers/operations.test.ts`.
- **Consumes:** ADR-0053 §2 (links), §3, §6; ADR-0044 starter rules; ADR-0028 freshness (read only, unchanged).
- **Tests:** a KPI whose last accepted actual is older than `staleAfterDays` → one `data_stale` exception linked to it, the KPI still showing Stale with its last value and date (unchanged DG4 response); fresh again → `recovered`; the trigger catalogue lists the two new triggers; starter 16 version 1 is unchanged history; one alert per open, none per recurrence.

### J/C.5 DO-D — redaction, the post-suite log scan, heartbeat writer, alert sink, monitoring document (devops-engineer; after BE-J; before BE-K's heartbeat tests)

- **Files:** the redaction lines in `apps/api/src/server.ts` and `apps/worker/src/main.ts`, `packages/config/src/load.ts` (the redaction set fed by `SecretProvider`, BE-E's interface), the heartbeat writer in `apps/worker/src/main.ts` (`WORKER_HEARTBEAT_SECONDS`, default 30), `deploy/scripts/log-scan.mjs` + `deploy/scripts/tests/log-scan.test.mjs` (negative fixture), the CI step after the integration suite in `deploy/ci/ci.yml` (after DO-A's job lines), `docs/operations/monitoring.md`.
- **Consumes:** ADR-0053 §4, §5, §6; ADR-0052 §5.
- **Tests:** a log line containing each redaction class is censored (unit, per class); the scan fails on the fixture and passes on a clean run; the scan runs on the integration-suite logs with canary secrets set and prints PASS.

### J/C.6 BE-G — issuer and audience rejection, Administration > Identity (backend-workflow-engineer; after BE-A)

- **Files:** the issuer/audience lines in `apps/api/src/modules/identity/oidc.ts`, `apps/api/test/support/fake-idp.ts` (a second issuer `mth-other` with its own key), `apps/api/test/integration/identity/other-realm.test.ts`, `apps/api/src/modules/admin/identity.ts` and its registration line, `p6-exercises-be-g.ts`, `p6-pending-be-g.ts`.
- **Operation:** `getIdentitySettings`.
- **Consumes:** ADR-0054 §1.
- **Tests:** the three rejection cases (other issuer, other audience, other key) → `/login?error=token_invalid`, one `session.login_failed`, no session; the settings response never contains the client secret (a canary value is absent from the body); AUD reads it; a holder without `identity.read` gets 403.

### J/C.7 DO-B — Keycloak realms, image, e2e login, SAML broker document (devops-engineer; after ARCH-02)

- **Files:** `deploy/keycloak/realm-mth-other.json` (SYNTHETIC), the `test-idp` profile lines in `deploy/compose/compose.yaml`, the `keycloak` entry of `deploy/images.lock.json` (through `pin-images.mjs --resolve keycloak` when the orchestrator runs it; never a hand-written digest), `e2e/support/keycloak-login.ts`, `e2e/identity/keycloak-login.spec.ts`, `docs/operations/identity-saml-broker.md`.
- **Consumes:** ADR-0054 §1 (registry decision; the 26.4 → 26.8.1 recommendation).
- **Proof:** the e2e logs in through `mth-test` and is refused with a `mth-other` token where a container runtime exists. Where none exists (this sandbox: no Docker daemon) it is reported **BLOCKED** with the reason, and BE-G's integration test carries the cross-realm proof.

### J/C.8 BE-H — fake S3, the contract suite, the S3 adapter (backend-workflow-engineer; after BE-A, BE-E)

- **Files:** `apps/api/src/modules/evidence/stores/{filesystem,s3,contract}.ts` (filesystem moved without behaviour change; the existing evidence tests stay green unchanged), the interface lines of `evidence/store.ts`, `apps/api/test/support/fake-s3.ts` (SigV4-verifying), `apps/api/test/integration/evidence/store-contract.test.ts` (the suite × 2 adapters).
- **Consumes:** ADR-0054 §2; ADR-0052 §5 `SecretProvider` for the keys. **Dependency:** Option A (`@aws-sdk/client-s3@3.1156.0`) only after the orchestrator decides; otherwise Option B (in-house SigV4). Start with the fake and the suite in either case.
- **Tests:** every contract case of ADR-0054 §2, for both adapters; no URL returned anywhere; anonymous read refused.

### J/C.9 BE-H2 — driver selection, `storage_driver`, Administration > Storage, the export-file store (backend-workflow-engineer; after BE-H and BE-D)

- **Files:** the driver-selection lines of `evidence/store.ts` (setting row, else environment; reads by `evidence_content.storage_driver`), the upload line in `evidence/routes.ts` that writes `storage_driver` (after BE-D), `apps/api/src/modules/admin/storage.ts` and its registration line, the export-file storage port lines in `packages/reporting/src/storage.ts`, the stale DG2 comment in `store.ts` (F-DG4-160), `apps/api/test/integration/admin/storage.test.ts`, `p6-exercises-be-h2.ts`, `p6-pending-be-h2.ts`.
- **Operations:** `getStorageSetting`, `putStorageSetting`, `testStorageSetting`.
- **Tests:** with no row, behaviour equals DG5 (filesystem); after an s3 setting a new upload lands in the fake S3 with `storage_driver = 's3'` and an earlier filesystem file is still downloadable; `putStorageSetting` without a passing test → 422 `storage.test_required`; every refusal of ADR-0054 §4; the test route never returns a URL or key; AUD 403 on PUT and test; the download response never redirects to the store (A12: no public URL).

### J/C.10 BE-I — the channel port, the SMTP adapter, fake SMTP, Administration > Notifications (backend-workflow-engineer; after BE-A, BE-E)

- **Files:** `apps/api/src/modules/tasks/channels/{port,email,render}.ts` and the worker twins `apps/worker/src/channels/{port,email,render}.ts` (ADR-0002 rule 5; parity test on rendering), `apps/api/test/support/fake-smtp.ts`, `apps/api/test/integration/tasks/email-adapter-contract.test.ts`, `apps/api/src/modules/admin/notification-channels.ts` and its registration line, `p6-exercises-be-i.ts`, `p6-pending-be-i.ts`.
- **Operations:** `listNotificationChannels`, `getNotificationChannel`, `putNotificationChannel`, `testNotificationChannel`.
- **Consumes:** ADR-0054 §3, §4; ADR-0051 §3 (`inbox.restricted`, deep-link URL). **Dependency:** `nodemailer@10.2.1` only after the orchestrator provisions it (D-195 Q7); otherwise the in-house client.
- **Tests:** the adapter against the fake (plain, STARTTLS where the fake offers it, AUTH refused, a connection dropped mid-DATA → retryable failure); a restricted recipient gets the `inbox.restricted` text and no `messageParams` value; enterprise messaging cannot be enabled (422); `none` security refused in production; AUD 403 on PUT and test.

### J/C.11 BE-I2 — fan-out after commit, exactly once; A21; the deliveries list (backend-workflow-engineer; after BE-I)

- **Files:** the `inbox_notification.created` outbox line in `apps/api/src/modules/tasks/service.ts` and in `createWorkItemOnce` (`apps/worker/src/kit.ts`, after BE-K's lines), the fan-out line in `tasks/notification-policy.ts`, `apps/worker/src/handlers/notifications.ts` and `apps/worker/src/queues/notifications.ts` (BE-A's stubs), the deliveries route in `admin/notification-channels.ts` (after BE-I), `apps/worker/src/handlers/notifications.test.ts`, `apps/api/test/integration/tasks/channel-fanout.test.ts`, `p6-exercises-be-i2.ts`, `p6-pending-be-i2.ts`.
- **Operation:** `listNotificationDeliveries`.
- **Tests:** no channel row → no delivery row and every DG4/DG5 notification test unchanged (A21); with email enabled, one notification → one `sent` delivery and one message at the fake; a relay replay and a handler retry create no second delivery and send no second message; a send failure never rolls back the producing workflow; a held (quiet-hours) notification fans out only when released.

### J/C.12 DO-C — storage and notification documents, environment residual rows (devops-engineer; after ARCH-02)

- **Files:** `docs/operations/storage.md` (S3-compatible configuration with references; the licence-verified store for IT tests; MinIO not bundled), `docs/operations/notifications.md` (SMTP setting, "in-app always", what IT configures), the residual rows in `docs/delivery/environment.md` for the live IdP, the object store, SMTP and SAML.
- No compose profile is needed for the fakes: both are in-process (D-195 Q6/Q7).

### J/C.13 FE work for slices J and C (frontend-ux-engineer)

- **FE-A (shell):** the i18n keys of every code in ADR-0053 §2 and ADR-0054 §4 (en; ar labelled provisional) in `apps/web/src/i18n/{en,ar}/problems.json`, the nav entries Administration > Operations, Identity, Storage, Notifications, and the API client entries for the 17 operations.
- **FE-B:** `pages/admin/{operations,service-identities,identity,storage,notification-channels}/**` as ADR-0053 §7 and ADR-0054 §1–§3 describe. Stale and Unknown are never 0 or green; the heartbeat `unknown` is never "alive"; credential fields take a provider and a name, never a value; AUD sees read-only pages.

### J/C.14 Migrations left and their order

The architect used 0101–0103. Implementer migrations take the next id above the highest shipped file at merge time (D-196), in this order of need: **BE-J** (service-identity seed rows), then **BE-K2** (the two triggers and starter 16 version 2). ARCH-03's migration adds the foreign key `service_identity.connector_id → connector (id)`.

### J/C.15 Integration order

BE-A → BE-J → (BE-J2, BE-J3 in parallel; disjoint handler files) and BE-K → BE-K2; DO-D after BE-J (its heartbeat writer before BE-K's heartbeat tests). BE-A → BE-G; DO-B and DO-C any time after ARCH-02. BE-A, BE-E → BE-H → BE-H2 (after BE-D on `evidence/routes.ts`); BE-A, BE-E → BE-I → BE-I2. FE-A after BE-A; FE-B after BE-G, BE-H2, BE-I, BE-K. `apps/worker/src/kit.ts` is edited in order BE-J → BE-K → BE-I2; `admin/notification-channels.ts` BE-I → BE-I2; `operations/routes.ts` BE-K (creates) → BE-J's block.

### J/C.16 Requirement → owner

| Requirement | Delivered by the architect | Implementer owner(s) | Proof |
|---|---|---|---|
| REQ-S12-019 | `0101` exceptions and links, `0103`; ADR-0053 §2, §3, §6; probe OE/OEK | BE-K, BE-K2, BE-J (failure on scope), FE-B; ARCH-03/BE-L raise the connector classes | A17/A22: a failing test connector → one exception, the KPI Stale with its last value and date (QA-A/QA-E) |
| REQ-S16-029 | `0101` identities, `0103`; ADR-0053 §1, §4, §5; probe SI | BE-J, BE-J2, BE-J3, DO-D | A12/A22: the out-of-scope test; the post-suite log scan PASS |
| REQ-S12-023 | `0102` channels and deliveries, `0103`; ADR-0054 §3; probe NC/ND | BE-I, BE-I2, FE-B | A21: no channel → all workflows complete, notifications in the inbox; adapter contract test against the fake SMTP |
| REQ-S16-006 | `0102` setting and `storage_driver`, `0103`; ADR-0054 §2; probe ST | BE-H, BE-H2, DO-C, FE-B | contract suite passes for both adapters; A12: no public URL |
| REQ-S16-007 | ADR-0054 §1; `0103` (`identity.read`) | BE-G, DO-B, FE-B | the other-realm integration test; the Keycloak e2e or a disclosed BLOCKED residual |

### J/C.17 What the implementers must know

1. **A service identity's declaration is written by migrations only.** The API can change `granted_permission_codes` and `reason` and nothing else (column privileges; probe SI12). A job never reads with more than its grant.
2. **The worker cannot import `access/read-scope.ts`.** Use the twin `apps/worker/src/service-scope.ts` and keep its parity test green.
3. **Exceptions are one per source and failure class while active.** Always take lock 730305 and update-or-insert. Never insert blindly: the unique index is the backstop, not the logic. A resolved exception is final; a new failure opens a new one.
4. **No KPI value or freshness rule changes in this slice.** Exceptions link KPIs; the KPI panel stays DG4's.
5. **Redact before you store.** `last_error_message` goes through ADR-0053 §4's redactor before it is written.
6. **No URL ever leaves the API for evidence**, in either storage mode. No pre-signed URL, no ACL, no redirect.
7. **Credentials are `SecretRef`s** (`{provider, name}`), never values, in the database, in API bodies and in the UI.
8. **In-app first, channels after commit.** A channel failure never blocks or rolls back a workflow. With no channel row, nothing is written.
9. **Not live:** the corporate IdP, the brokered SAML path, an IT object store, SMTP and enterprise messaging are residuals with ports, fakes and contract tests (§2 rule 14).
