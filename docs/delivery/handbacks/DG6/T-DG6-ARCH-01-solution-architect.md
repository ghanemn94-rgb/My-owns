# Handback: T-DG6-ARCH-01 — P6 architecture, slices E + F (solution-architect)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-01-solution-architect-20261026T141307Z-bd4d7c55","session_id":"bd4d7c55-9cd8-47db-b832-764e03013fd3"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-01.md`, sha256 `d0c72b82de5005e39c7a238f98dfbce756d64f6180bd8b80a42ec1e91257ec5f` (verified with `sha256sum` at the start).
- **Base:** branch `claude/mobily-transformation-platform-dg5-regate2`, `HEAD` `fae84756ff2371c61440efc8ba87d7d2caad802a`. Nothing committed (the orchestrator commits).
- **Start:** `date -u` → `Mon Oct 26 14:13:27 UTC 2026`. **End:** `Mon Oct 26 16:06:02 UTC 2026` (§8).
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. No business, Finance or IT approval was granted. Product G6 never implies DG7.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` (Node 24.21.0), run first, before any write:

```
PASS gate DG5 (historical)
EXIT=0
```

Re-run at the end: exit 0 (§8).

## 2. Deliverables

### 2.1 ADRs (deliverable 1)

| File | Content |
|---|---|
| `docs/architecture/adr/ADR-0051-p6-authorization-boundary-read-scope-sensitive-records-deep-links.md` | §1 `ReadScope` (SQL predicate + row filter, derived from the unchanged `scopeFilter`/`decide`; parity test definition); §2 sensitive records (types benefit, business_case, evidence; flag table; grants with active → revoked; the admission clause with the exact named-party fields; the D-195 Q3 rollup label; refusal codes and English texts; 6 operations); §3 deep links (opaque set-once token, lazy issue under 730301, resolver 403 `deep_link.forbidden` "You do not have access to this item." with an identical body, inbox redaction `inbox.restricted`); §4 evidence authorization after ownership transfer (one `requireEvidenceRead`; the 403/404 question raised, §5 below); §5 the S02-006 route-inventory sweep; §6 locks; §7 authorization; §8 decimal/Unknown. |
| `docs/architecture/adr/ADR-0052-p6-request-input-hardening-uploads-preview-secrets-audit-api-sweeps.md` | §1 the ten-type allow-list table by magic bytes + extension, refusal codes (`evidence.type_not_allowed`, `evidence.type_mismatch` 422; `evidence.too_large` 413), `upload_policy`; §2 safe preview (PNG/JPEG/GIF only, exact headers incl. CSP `sandbox`, SVG/HTML never inline, 422 `evidence.preview_unavailable`); §3 rich text stays plain text, the XSS payload set and test definition; §4 the CSRF rule and the rate-limit class matrix; §5 `SecretProvider` (env, file, pluggable; `SecretRef` in the database; `[secret]` printing); §6 dependency audit (CI job + offline snapshot; live audit BLOCKED here); §7 response validation of every operation; §8 `/audit-events` scope and redaction, Administration > Audit; §9 the S16-023 integrity sweep; §10 authorization; §11 the security suite; §12 decimal/Unknown. |

Every claim is enumerated (types, fields, codes, texts, roles, files). Sources quoted: M0090, M0188, M0241, M0255, M0329, M0330, M0331 (anchored file), B0124. The playbook names no access or security control; the ADRs say so and attribute nothing else to it.

### 2.2 Migrations, schema types, permissions, locks (deliverable 2)

| File | Purpose |
|---|---|
| `packages/db/migrations/0098_p6_sensitive_records_deep_links.sql` | `record_sensitivity` (+ trigger-written append-only `record_sensitivity_change`), `sensitive_record_grant` (state machine, one active per record and grantee, no self-grant), the set-once deep-link columns on `inbox_notification`; P2 guards (`p2_attach_guards(…, true)`: version step, deferred audit), `timestamptz`, CHECKed closed sets; locks 730300/730301 in the triggers. |
| `packages/db/migrations/0099_p6_upload_policy_content_types.sql` | `upload_policy` (+ append-only `upload_policy_change`), `p6_upload_media_type()`, `evidence_content.detected_type` with the media-type consistency CHECK. |
| `packages/db/migrations/0100_p6_access_hardening_permissions.sql` | 5 permission codes and 11 role links (TO, AUD, ADM_TECH, ADM_ACCESS); no approval code. |
| `packages/db/src/schema.ts` | 5 new table interfaces + `SCHEMA_COLUMNS`; 3 columns on `InboxNotificationTable`, 1 on `EvidenceContentTable`. |
| `packages/db/test/integration/catalogue.test.ts` | New test "0098-0099: the P6 slice E/F guards are attached" (17 triggers); 3 tables added to the mutable-table pin; 5 privilege pins. |
| `packages/db/src/seed.test.ts` | "0100 seed equals the P6 part of permissions.ts" (3 tests); the numbering rule widened from "at most 0099" to "at most 0133" (p6-plan §4), with a positive (0101) and a negative (0134) example. |
| `packages/shared/src/permissions.ts` | `P6_ACCESS_HARDENING_PERMISSIONS`, `P6_PERMISSIONS` aggregate, `P6_ACCESS_HARDENING_ROLE_PERMISSIONS`; wired into `PERMISSIONS` and `ROLES` (TO, AUD, ADM_TECH, ADM_ACCESS). |
| `apps/api/src/modules/platform/advisory-locks.ts`, `advisory-locks.test.ts` | `sensitiveRecordGrant` 730300, `deepLinkIssue` 730301 (730302–730304 reserved); the pin, the migration-constant map and the "no number outside the registry" scan extended to 7303xx. |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 registry rows 730300, 730301, 730302–730304 and the P6 block sentence. |

### 2.3 ERD, data dictionary (deliverable 4)

- `docs/architecture/erd.md` §1t (diagram, polymorphic-reference note, entity register).
- `docs/architecture/data-dictionary.md` "P6 tables, slices E and F (migrations 0098–0100, DG6)": the 5 table sections **generated from the catalogue of a freshly migrated database** (`T-DG6-ARCH-01-evidence/gen-dictionary.ts`, output `dictionary-section.md`), plus the columns added to `inbox_notification`/`evidence_content` and the 7 functions.

### 2.4 Contract (deliverable 5)

- `docs/api/openapi.yaml`: `info.version` `1.5.0-p6`; one new tag `security`; 13 operations appended (paths, 7 parameters, 15 schemas): `getRecordSensitivity`, `putRecordSensitivity`, `listSensitiveGrants`, `createSensitiveGrant`, `getSensitiveGrant`, `revokeSensitiveGrant`, `resolveDeepLink`, `previewEvidenceContent`, `getUploadPolicy`, `putUploadPolicy`, `getSecurityRateLimits`, `listAuditEvents`, `getAuditEvent`. Each declares the ADR-0007 §5b statuses (400, 401; 403 on mutations; 409/428 with `IfMatch`/`IfMatchOrZero`; 429), `application/json` request bodies, problem+json via the shared responses, ETag headers and cursor pagination on the three lists.
- **The one change to an existing schema:** the response-only `Permission` enum gains the 5 `0100` codes (an additive v1 change, as every P5 ARCH task did). Without it `getMe` fails validation (first targeted run, §4.4). D-195 accepts additive changes; no P1–P5 path changed: `diff` against the pre-task file removes exactly one line (`version: 1.4.0-p5`) and adds 516 + 5 lines.
- The edit is reproducible: `T-DG6-ARCH-01-evidence/openapi-p6-arch01.py` applied to the pre-task file yields a byte-identical file (`cmp` → `REPLAY-IDENTICAL`).
- **Pending seams:** `apps/api/test/support/p6-pending.ts` (P6 aggregate), `p6-pending-arch-01.ts` (slice aggregate), `p6-pending-be-b.ts` (6), `p6-pending-be-c.ts` (1), `p6-pending-be-d.ts` (3), `p6-pending-be-e.ts` (3); `p2-pending.ts` imports the P6 aggregate. `contract.test.ts`: operation count 846 → **859** (the only pin changed; the comment lists the 13).
- `apps/api/test/support/p6-operations.ts` (new): the 13 ids, excluded from the P2-scoped AUD sweeps (§4.4).
- p6-plan §5.1 names `p6-pending.ts` as BE-A's file; I created it so `contract.test.ts` stays green now, following the P5 precedent where T-DG5-ARCH-01 created `p5-pending.ts`. BE-A can take it over unchanged.

### 2.5 Permissions matrix and work split (deliverable 6)

- `docs/analysis/permissions-matrix.md` §24 (codes, per-entity rights for all 14 roles, AUD read-only, technical admins, SoD).
- `docs/architecture/p6-work-split.md` (new): header, §1, §2 shared rules (the 15 assignment lessons plus contract seams, exact refusals, migrations, dependencies, clones), and §E/F: what the architect delivered; BE-A (slice E/F stubs, wiring, the exact `db-errors.ts` mappings), BE-B, BE-B2, BE-C, BE-C2, BE-D, BE-E, BE-E2, BE-F, DO-A, FE-A/FE-B items; migrations left; integration order; requirement → owner; what implementers must know.

## 3. Requirements in scope: what this task delivers and who completes them

| Requirement | Architect delivered | Remaining owner(s) |
|---|---|---|
| REQ-S02-006 | ADR-0051 §5 sweep definition | BE-C2; slice H for server-side drafts |
| REQ-S10-002 | `0098`, `0100`; ADR-0051 §2, §7; probe RS/GR | BE-B, BE-B2, FE-B |
| REQ-S10-004 | ADR-0051 §1 `ReadScope` + parity definition | BE-B, BE-B2; H and D consume |
| REQ-S12-024 | `0098` token columns; ADR-0051 §3; probe DL | BE-C, FE-B |
| REQ-S13-013 | ADR-0051 §4 | BE-C (after the §5 decision) |
| REQ-S13-011 | `0099`; ADR-0052 §1–§2; probe UP/EC | BE-D, FE-B |
| REQ-S16-023 | P6 guards (probe); ADR-0052 §9 | BE-F |
| REQ-S16-027 | contract 1.5.0-p6; ADR-0052 §7 | BE-F |
| REQ-S16-030 | ADR-0052 §3–§6, §11 | BE-E, BE-E2, BE-D, DO-A |
| REQ-S16-032 | `0100`; ADR-0052 §8; probe AU | BE-E, BE-F, FE-B |

No requirement is complete at this point: every row needs its implementer work (this is an architecture task).

## 4. Checks actually run (Node 24.21.0; PostgreSQL 16.13 disposable clusters on ports 23701–23749)

### 4.1 Migration apply and guard probe

`QA_PG_PORT=23701 MTH_PORT_POOL=23702-23709 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-01-evidence/probe.ts` → **70/70 PASS, exit 0** (`probe-output.txt`).

- G01: fresh database, 0001 → 0100 applied (92 files).
- G02–G04: 0001–0097 applied, a synthetic transformation instantiated by the DG3 function, 2 benefits, a business case, 2 evidence items, a pre-P6 octet-stream `.exe` file and 2 notifications; then 0098–0100 on top; every existing row unchanged (notifications without token, the pre-P6 file `detected_type` NULL, no sensitivity/grant/policy row, the benefit still at version 1).
- Guards fire: missing audit fails at COMMIT (RS03, RS06, GR05, UP08, DL07); a non-stepping version fails (RS04, RS05, GR09); UPDATE/DELETE on history fails (RS16–RS18, UP10) and the application cannot write history (RS15); plus every database claim of the ADRs (record types, record references, uniqueness, transitions, immutability, set-once deep links, upload-policy limits, detected-type consistency, audit_event append-only AU01–AU03, permission seeds PM01–PM04, lock constants LK01).

**Disclosed earlier runs (all kept in the evidence folder):**
1. `probe-run1-exit2-fixture-error.txt`: exit 2 before any probe ran: my benefit fixture violated `benefit_mapping_required` (no `financial_statement_line`). Fixed the fixture.
2. `probe-run2-before-record-version-rename.txt`: 70/70 PASS on the first version of the migrations. Afterwards I renamed the history tables' `version` column to `record_version` (the catalogue test's mutable-table rule treats every `version integer NOT NULL` column as a versioned row with default 1), so this run no longer describes the final files.
3. `probe-run3-69of70-RS15-probe-column-name.txt`: 69/70, exit 1: RS15's own INSERT still named the old column (`42703 column "version" … does not exist`), so it never reached the privilege check. A probe error, not a guard failure. Fixed the probe; the final run above shows RS15 `42501 permission denied`.

Migration hashes: `migration-sha256.txt`.

### 4.2 Static checks

| Command | Exit | Log |
|---|---|---|
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `format.log` (`docs/` is in `.prettierignore`) |
| `pnpm openapi:lint` | 0 | `openapi-lint.log`: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 859 operations` |

### 4.3 Unit tests

| Command | Exit | Result | Log |
|---|---|---|---|
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | 0 | unit-node 147 files / 2369 tests; unit-web 94 / 1746; unit-formula-nocodegen 3 / 259 passed + 2 skipped | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | identical counts | `unit-c-utf8.log` |

The 2 skipped tests are in `packages/shared/src/formula/fuzz.test.ts` (111 tests, 2 skipped), which this task did not touch. Unit pins I changed: `seed.test.ts` +3 tests (the 0100 block) and 2 assertions in the numbering test; `advisory-locks.test.ts` (the class map, the migration-constant map and the number scan).

### 4.4 Integration tests

- Targeted, run 1: `QA_PG_PORT=23703 MTH_PORT_POOL=23704-23749 tests/qa/support/with-pg.sh npx vitest run --project integration packages/db/test/integration/catalogue.test.ts apps/api/test/integration/contract/contract.test.ts` → **exit 1, 71 failed / 42 passed** (`integration-targeted-run1-71-fail-permission-enum.log`). Cause: `getMe` 200 body violated the contract's `Permission` enum, which did not yet contain the 5 new codes. Every exercise signs in through `getMe`, so it cascaded. Fixed by extending the enum (§2.4).
- Targeted, run 2 (same command) → **exit 0, 113/113** (`integration-targeted-run2.log`).
- Full suite:
  - **Run 1** (before the fixes below): `QA_PG_PORT=23710 MTH_PORT_POOL=23711-23749 tests/qa/support/with-pg.sh pnpm test:integration` → **exit 1: 321 files (3 failed), 3102 tests: 3083 passed, 18 failed, 1 skipped**, 3063 s (`integration-full-run1-18-fail.log`). The 18 failures came from three pins my additions broke. None is a product defect:
    1. `apps/api/test/integration/aud-write-deny.test.ts` (14 tests): the P2-scoped AUD sweeps are generated from the contract and picked up my 13 operations. Fixed by the P3–P5 seam: new `apps/api/test/support/p6-operations.ts` (the 13 ids), excluded in this file and in `kpi/kpi-aud-write-deny.test.ts`.
    2. `apps/api/test/integration/identity.test.ts` (1 test): the pinned TO permission list gains `sensitive_record.grant` and `sensitive_record.read` (from `0100`).
    3. `packages/db/test/integration/migrate.test.ts` (3 tests): the tests used the fixed ids 0098/0099 as "a new id above the highest", and those ids are now taken by `0098`/`0099`. The new id is now derived from the highest shipped file (`NEXT_ID`). The assertions are unchanged.
  - **Re-run of the failed files** plus the contract and catalogue suites: `QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 tests/qa/support/with-pg.sh npx vitest run --project integration <aud-write-deny, kpi-aud-write-deny, identity, migrate, catalogue, contract>` → **exit 0, 6 files, 281/281** (`integration-rerun-6-files.log`).
  - **Run 2** (full suite on the final tree): `QA_PG_PORT=23730 MTH_PORT_POOL=23731-23749 tests/qa/support/with-pg.sh pnpm test:integration`, started about 15:40 UTC → **exit 0: 321/321 files, 3088 passed, 1 skipped (3089)**, 3027 s, finished 16:27:02 UTC (`integration-full-run2.log`). It finished after the handback was first written at 16:06; this line was updated at 16:27 with the real result. The test count differs from run 1 (3102) because run 1 counted the per-operation cases the P2 AUD sweep generated for my 13 operations, which `p6-operations.ts` now excludes.

## 5. Raised to the orchestrator (decisions needed; nothing decided by me)

1. **REQ-S13-013 "403" vs the DG2 404 (ADR-0051 §4).** The acceptance says an outsider "gets 403 on the evidence download URL". The DG2-approved route answers 404 to a caller without `transformation.read` (ADR-0006 non-disclosure), and A12 suites assert that. Option A (recommended): keep 404 for the out-of-scope reader, and use 403 `evidence.parent_forbidden` for an in-scope reader without admission to a sensitive item or parent. Option B: 403 for every unreadable content/preview call, including non-existent ids; this is a DG2 reopen. BE-C must not change the outsider status before this decision.
2. **Migration ranges vs the F-DG5-100 runner rule (work split §2 rule 18, §E/F.9).** p6-plan §4 leaves the rest of each range to that slice's implementers. But the runner refuses a pending id that is not above the highest applied id, and `p5-work-split.md` rule 16 (amended) says a new migration takes an id above the highest shipped one. T-DG6-ARCH-02 (W2) will merge 0104+ before BE-D (W5), so 0101–0103 become unusable in the planned order. The same holds for every later ARCH range. Recommendation: the orchestrator allocates an implementer's migration id at merge time, as the next id above the highest shipped id, and records the retired ids as P5 did. BE-D's only migration is optional (§E/F.6).
3. **Task splits.** BE-B, BE-C and BE-E are split into BE-B/BE-B2, BE-C/BE-C2 and BE-E/BE-E2 to fit 60–75 minutes. This adds 3 runs. They need wave slots: BE-B2 after BE-B (W3), BE-C2 after BE-C (W4), BE-E2 after BE-E and BE-D (W5).
4. **Contract additions BE-B2 will request.** BE-B2 will add optional `includesRestrictedRecords` properties to DG4/DG5 aggregate schemas (inventory in its handback). They are additive, under D-195 Q3.
6. **FE-B boundary.** p6-plan §5.1 FE-B lists `pages/admin/{…,upload-policy,sensitive-grants}`. The work split adds `pages/admin/security/**` (the rate-limit view), `components/sensitivity/**` and `components/evidence-preview/**`, each mounted by one named line in existing detail pages. This is an ownership extension inside slice E/F, for the orchestrator to confirm.
5. **`inbox.restricted` texts.** D-195 accepted inbox title redaction "with its exact en/ar text in its ADR". The texts are in ADR-0051 §3; the Arabic is provisional.

## 6. DG1–DG5 artifacts changed, and why (D-195)

| Artifact (approved at) | Change | Why |
|---|---|---|
| `docs/api/openapi.yaml` (DG1–DG5) | `info.version`; tag `security`; 13 appended operations; `Permission` enum +5 values | Deliverable 5. The enum addition is response-only and additive (needed for `getMe`). No P1–P5 path changed. |
| `packages/db/src/schema.ts` | `InboxNotificationTable` +3, `EvidenceContentTable` +1 columns, 5 tables | Mirrors `0098`/`0099` (catalogue test). |
| `packages/db/test/integration/catalogue.test.ts` | new trigger test; mutable-table and privilege pins extended | P6 tables (the established append-only pattern). |
| `packages/db/src/seed.test.ts` | 0100 block; numbering limit 0099 → 0133; the "free id" example changed from 0098 (now taken) to 0101 plus a 0134 negative | p6-plan §4 ranges and repair block, adopted by D-195. Without it, `0100` fails "above 0099". |
| `packages/shared/src/permissions.ts` | P6 block, aggregates, role wiring | `0100` equality (seed test). No existing grant removed. |
| `apps/api/src/modules/platform/advisory-locks.ts`, `.test.ts` | 2 classes; pin, constants and number scan extended; the test title's stale "twenty-eight" corrected to "forty-one (twenty-eight before P5)" | ADR-0016 §6 registry rule. |
| `docs/architecture/adr/ADR-0016-…md` | registry rows, P6 block sentence | Same. |
| `apps/api/test/support/p2-pending.ts`, `apps/api/test/integration/contract/contract.test.ts` | P6 aggregate import; count 846 → 859 | The P3–P5 pending precedent. |
| `apps/api/test/integration/aud-write-deny.test.ts`, `kpi/kpi-aud-write-deny.test.ts` (+ new `apps/api/test/support/p6-operations.ts`) | P6 operation ids excluded from the P2-scoped AUD sweeps | The `p3/p4/p5-operations.ts` precedent; each P6 slice tests AUD on its own operations (work split §2 rule 7). |
| `apps/api/test/integration/identity.test.ts` | TO's pinned permission list +2 codes | The `0100` role defaults. |
| `packages/db/test/integration/migrate.test.ts` | "a new id" derived from the highest shipped file instead of the fixed 0098/0099 | P6 ships 0098–0100; the assertions are unchanged. |
| `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | appended P6 sections | Deliverables 4 and 6. |

No DG1–DG5 behaviour changes in this task. Every new column is nullable, and with no sensitivity, grant or policy row the API answers exactly as at DG5 (probe G04; full integration run 1 in §4.4, whose only failures were the three test pins named there).

## 7. What the implementers of this slice must know

These are in `p6-work-split.md` §E/F.15 and §2. The main points:

- Sensitivity lives in its own table. A benefit's version never changes when it is marked.
- The deep-link token is not a credential. Re-authorize on every resolve, and never put `messageParams` in a 403 body or a channel message.
- Downloads stay `application/octet-stream` with `attachment`. Only the new preview route renders inline, and only PNG, JPEG and GIF.
- Histories are written by triggers. Technical admins see organization-level audit events only, unless they are assigned to the transformation.
- `evidence/routes.ts` is edited sequentially: BE-B2, then BE-C, then BE-D, then BE-E's one line.
- No new dependency is needed for slices E/F (the ZIP central-directory reader and the magic-byte detector are new code).

## 8. End

- `date -u` at the end: `Mon Oct 26 16:06:02 UTC 2026` (1 h 53 min); the integration result was added at `Mon Oct 26 16:27:07 UTC 2026`.
- `node tools/gates/validate.mjs --historical --stage DG5` at the end → `PASS gate DG5 (historical)`, exit 0 (`validate-dg5-historical-end.log`). The start result is in §1; `validate-dg5-historical-start.log` is my transcription of that console output, labelled as such, because I did not redirect it to a file at the time.

### Left for a continuation or the orchestrator

1. None from the checks: integration run 2 passed after the first handback write (§4.4).
2. The decisions of §5: items 1 (403/404) and 2 (migration ids) are needed before BE-C and BE-D; items 3 and 6 are needed before the waves are scheduled.
3. Nothing else in deliverables 1–6 is outstanding.

### Merge instructions

- Apply as one change. Order inside the change does not matter. The migrations are `0098`, `0099`, `0100`, forward-only, and apply on top of `0097` (probe G03).
- No conflict is expected with other tasks: ARCH-01 runs alone (W1).
- After merge: `pnpm test`, `pnpm test:integration` (full), `pnpm openapi:lint`, and `node tools/gates/validate.mjs --historical --stage DG5`.
- Evidence: `docs/delivery/handbacks/DG6/T-DG6-ARCH-01-evidence/` (probe script and outputs, including the disclosed runs; dictionary generator; contract script; check logs).

