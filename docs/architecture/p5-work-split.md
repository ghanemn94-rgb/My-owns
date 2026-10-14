# P5 work split: shared rules, file ownership, contracts and integration order

- **Plan:** `docs/architecture/p5-plan.md` (T-DG5-ARCH-00), adopted by D-142 with the orchestrator's decisions on Q1–Q12. This file holds one section per architecture task (p5-plan §4); each ARCH task writes only its own section. §1–§2 and §A are written by T-DG5-ARCH-01; §B+C by T-DG5-ARCH-02, §D+E by T-DG5-ARCH-03, §F by T-DG5-ARCH-04, §G+H by T-DG5-ARCH-05, §I+J by T-DG5-ARCH-06.
- **Stage:** P5 "Configuration automation and outputs" (DG5).
- **Rule:** two tasks never edit the same file (REQ-DLV-008). Anything not listed under an owner is **frozen**; changes go through the orchestrator (p5-plan §5.3).
- **Off-limits to every implementer** (the write guard enforces it): `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, `docs/delivery/reviews/**`, `docs/delivery/gates/**`, `docs/delivery/stages.json`, `docs/delivery/findings.json`, `trading_agent/`.
- **Product gates G1–G6 are business approvals inside the product.** Nothing in P5 reads or writes the engineering gate records DG0–DG7. Product G6 never implies DG7, and no agent, seed or job grants a real business, Finance or IT approval. Demo approvals are synthetic and labelled so.

## 1. How to read a slice section

Each slice section lists: what the architect already delivered (do not re-create); one block per implementer task with its exact files, the operations it routes, the contracts it consumes and its tests; the migrations left in the slice range and their order; the integration order; a requirement → owner table; and what the implementers must know. Paths are relative to `apps/api/src/modules/` unless they start with `apps/`, `packages/`, `docs/` or `tests/`. Every task also owns its tests, its `apps/api/test/support/p5-pending-<task>.ts` and its `apps/api/test/integration/contract/p5-exercises-<task>.ts`.

## 2. Shared rules for every P5 implementer task (the DG2–DG4 lessons; reviewers check them)

1. **Free text.** Every free-text field goes through the shared `freeText`/`hasText`/`hasInvalidCharacter` rules; truncation only through `truncateText`.
2. **Strict UTF-8.** JSON and query parsing is strict UTF-8 on every route (the BE13 parser); no route-local parser.
3. **`config.consumes`.** Every new route's `config.consumes` equals its operation's request media type in `docs/api/openapi.yaml` (every slice A body is `application/json`; bodiless action POSTs declare none).
4. **Every mutation** has: authorization re-checked at commit time; validation; `If-Match` (428 when missing, 409 when stale; creates are version 1); an audit event in the same transaction; no remote or client I/O inside the transaction; and a test for each of these.
5. **Decimal only.** Money, rates, percentages, weights, FTE and KPI values are decimal strings and `numeric` columns, never floats. Unknown, Stale and Not computable are never shown as 0 or green.
6. **Bilingual text.** Arabic RTL and English LTR, translated at render time; problem `code`s are i18n keys and are translated too. Work items and reminders store `messageKey` + `messageParams`, never sentences.
7. **Web forms and AUD.** One form-level alert per form; actions are session-bound (`auth/sessionBound.ts`); the AUD user sees read-only views and gets 403 on every write (each slice tests AUD on its own operations; the P2 sweep excludes P5 through `apps/api/test/support/p5-operations.ts`); the label is "business approval", never DG0–DG7.
8. **Ports and locale.** Harness ports stay below 32768; verification runs with the locale unset and with `C.UTF-8`.
9. **Formula engine unchanged.** `packages/shared/src/formula/**` is reused as it is (`validateFormula`, `evaluateFormula`). Any change there is a reopen candidate (p5-plan §3 row 20).
10. **Exactly once.** Jobs and automations use the advisory-lock registry (`platform/advisory-locks.ts`), unique backstops and idempotency keys; a replay creates nothing (the DG4 S12-021 pattern; `createWorkItemOnce`, `runOnce`, `ON CONFLICT … DO NOTHING` on a dedupe key).
11. **Value bases never mixed** (D-117, D-119, D-122), and every number states its unit kind (ADR-0037 N5).
12. **True texts.** User-facing text is true for the release it ships in (F-DG4-160): when a P5 feature ships, the texts that called it planned are updated in the same task; texts for P6/P7 features stay.
13. **Deterministic tests.** Tests are deterministic under load (F-DG4-143 to F-DG4-148) and never read growing delivery folders (D-138).
14. **Contract seams.** Each task removes its operations from its own `p5-pending-<task>.ts` in the same change that routes them, and exercises each through the validating client in its own `p5-exercises-<task>.ts` (success and every declared refusal it can reach). The pinned counts in `contract.test.ts` (media-type triple, rate-limit floor) are reconciled by the orchestrator from the handbacks (D-079 precedent): report your deltas.
15. **Exact refusals.** Problem codes and English `detail` texts are exactly those in the slice ADR tables (slice A: ADR-0039 §13, ADR-0040 §8). A code you need that is not there goes in your handback with its proposed text; do not invent it silently.
16. **Migrations.** Forward-only; a merged migration is never edited. P5 ranges have gaps by design: `packages/db/src/seed.test.ts` requires ids below 0058 contiguous and every id from 0058 at most 0099, strictly increasing. Write only the numbers your slice section assigns you, in its order.
17. **No dependency, secret or CDN.** A dependency you need goes in your handback with its official documentation, support window and licence (D-142 Q8).
18. **Clones, not worktrees.** Never run `git worktree add`; use a `git clone` under `$TMPDIR` (D-082).

## §A. Slice A (Playbook Studio core: configuration versions, publish pipeline, pins, migration, re-approval) — T-DG5-ARCH-01

### A.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADRs | `docs/architecture/adr/ADR-0039-p5-studio-configuration-model-publish-pipeline.md`, `ADR-0040-p5-methodology-migration-reapproval-scoring-defaults.md` | Binding design, with the refusal codes and English texts |
| Migrations | `packages/db/migrations/0062_p5_config_versions.sql`, `0063_p5_pins_methodology_migrations.sql`, `0064_p5_studio_permissions_source_inventory.sql` | Applied on a fresh PostgreSQL 16.13 and over a P4-populated database; 76 guard probes PASS (`docs/delivery/handbacks/DG5/T-DG5-ARCH-01-evidence/probe-output.txt`) |
| Kysely types, catalogue pins, seed pins | `packages/db/src/schema.ts` (10 tables; 7 columns on `methodology_version`, 1 on `transformation_config_pin`), `packages/db/test/integration/catalogue.test.ts`, `packages/db/src/seed.test.ts` | Pinned |
| Permissions | `packages/shared/src/permissions.ts` (`P5_STUDIO_PERMISSIONS`, `P5_STUDIO_ROLE_PERMISSIONS`; 8 codes) | Equals `0064` |
| Lock classes | `platform/advisory-locks.ts` (`configDraft` 730250, `configPublish` 730251, `methodologyMigration` 730252; 730253 reserved), ADR-0016 §6 | Registry test updated |
| Contract | `docs/api/openapi.yaml` 1.4.0-p5: 38 operations (tags `studio`, `config-pins`, `methodology-migrations`) | `pnpm openapi:lint` PASS (690 operations); P1–P4 unchanged except `info.version` |
| Contract-test seams | `apps/api/test/support/p5-pending.ts` (P5 aggregate; frozen after ARCH-06), `p5-pending-arch-01.ts` (slice aggregate; frozen), `p5-pending-be-a.ts` (8), `p5-pending-be-b.ts` (7), `p5-pending-be-b2.ts` (3), `p5-pending-be-b3.ts` (8), `p5-pending-be-c.ts` (9), `p5-pending-kbe-a.ts` (3); `p5-operations.ts` (38; frozen per block); `p2-pending.ts` includes P5; `contract.test.ts` operation count 690 | Contract test green with all 38 pending |
| Work-item kinds wired | `config_review` (Reviews) and `gate_reapproval` (Assigned actions) in `reporting/my-work.ts` `MY_WORK_SECTION_BY_KIND`; kind labels in `apps/web/src/i18n/{en,ar}/myWork.json` | The DG4 completeness tests pass (32 kinds) |
| ERD §1l, data dictionary "P5 tables, slice A", permissions matrix §18 | `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | Dictionary generated from the catalogue |

The plan's BE-B is split into **BE-B, BE-B2, BE-B3** (one review/publish engine was too large for one 60–75 minute task, the p4 `-2` precedent); the other tasks are as p5-plan §5.1 names them.

### A.1 BE-A — module registry, ConfigResolver, drafts, resolved elements, pins (backend-workflow-engineer; wave W2)

- **Files:** the p5-plan §5.1 BE-A list (`modules.ts`, `server.ts`, `architecture.test.ts`/`.testkit.ts`, every P5 route-file stub with its registration line, worker stubs, `platform/db-errors.ts` P5 mappings, `contract.test.ts` imports of every `p5-exercises-*.ts`, test harness files); for slice A: `methodology/config-resolver.ts` (the ADR-0039 §3 port), `methodology/kinds.ts` (the `ConfigKindProvider` registry: element types, attribute validation, diff rows, compatibility, affected records, preview hook per kind; `methodology` and `scoring_defaults` registered by BE-B and KBE-A), `methodology/content-hash.ts` (ADR-0039 §1 canonical hash), `methodology/drafts.ts`, `methodology/elements-read.ts`, `methodology/pins.ts`; stub files (`export {}`) and the barrel lines in `packages/shared/src/schemas/index.ts` for `studio.ts` (BE-A fills it), `studio-checks.ts` (BE-B), `studio-coverage.ts` (BE-B2), `studio-review.ts` (BE-B3), `methodology-migrations.ts` (BE-C), `scoring-defaults.ts` (KBE-A); and the registration lines in `methodology/routes.ts` for `drafts.ts`, `elements-read.ts`, `pins.ts`, `elements.ts`, `checks.ts`, `source-coverage.ts`, `revision-impact.ts`, `reviews.ts`, `publish.ts`, `review-policies.ts`, `migrations.ts`, `scoring-defaults.ts` (stubs registering no route until their owner fills them).
- **Operations (8):** `listConfigVersions`, `createConfigDraft`, `getConfigVersion`, `updateConfigDraft`, `listConfigElements`, `discardConfigDraft`, `listTransformationConfigPins`, `listConfigPinHistory`.
- **Consumes:** ADR-0039 §1–§4; lock 730250; `packages/shared/src/schemas/studio.ts` holds the per-element-type attribute schemas of ADR-0039 §2 (Zod) and the mirrors of `ConfigVersion*`, `ConfigElement*`, `ConfigPin*`.
- **Tests:** draft create copies the base's element rows; next version number; one open draft (409 `config_version.draft_exists`); update in preview returns to editing; discard; resolved elements = catalogue overridden by rows (v1 has no rows); pins list shows unpinned kinds as version 1 of the default key; AUD 403 on writes; `If-Match` 428/409; one audit event per mutation.

### A.2 BE-B — element edits, invariants, diff, affected records, compatibility, preview (backend-workflow-engineer; after BE-A)

- **Files:** `methodology/elements.ts` (put/remove), `methodology/invariants.ts` (ADR-0039 §2 refusals before the database guards), `methodology/diff.ts`, `methodology/affected-records.ts`, `methodology/compatibility.ts`, `methodology/preview.ts` (sandbox: read-only transaction rolled back, `ConfigResolver.withDraft`), `methodology/checks.ts` (routes of the four check operations and `listConfigCheckRuns`), `methodology/providers/methodology-kind.ts`, `packages/shared/src/schemas/studio-checks.ts`.
- **Operations (7):** `putConfigElement`, `removeConfigElement`, `getConfigVersionDiff`, `getConfigAffectedRecords`, `listConfigCheckRuns`, `runConfigCompatibilityCheck`, `runConfigPreview`.
- **Tests (REQ-S06-006 literal):** renaming G3's label succeeds; changing its stable key → 422 `config_version.stable_id_change`; deleting a TOM dimension → 422 `config_version.source_element_protected`; ADM_METHOD as approver → 422 `config_version.admin_approver_forbidden`; a gate approver outside the DG2 allowed set → 422 `config_version.approver_not_allowed`; deleting T13 is recorded; the diff lists added/removed/changed elements; preview writes nothing but its run; compatibility `warn` for a changed approver, `fail` for an unknown role.

### A.3 BE-B2 — source coverage and the S12-018 revision proposals (backend-workflow-engineer; after BE-B)

- **Files:** `methodology/source-coverage.ts`, `methodology/revision-impact.ts` (both S12-018 cases, ADR-0039 §8), the composition lines in `server.ts` that wrap the DG4 material-change port so `benefitFormulaVersionCreated` also calls `revision-impact.ts` (named lines; `platform/material-change.ts` and `kpi/benefit-formulas.ts` are not edited), `packages/shared/src/schemas/studio-coverage.ts`.
- **Operations (3):** `listRevisionProposals`, `getSourceCoverage`, `runSourceCoverageCheck`.
- **Tests:** the report shows 2/6/6/16/10/5/6/3/1/25 on v1 (with the three planned sets `warn`); deleting T13 in a draft makes the run `fail`; a formula revision (DG3 `createBenefitFormulaVersion`) records one proposal listing the affected benefits and creates `config_review` work items for FIN holders, and replay ×3 creates nothing more; the DG3 response and the DG4 automatic change request are unchanged.

### A.4 BE-B3 — review where configured, publish, rollback, review policies (backend-workflow-engineer; after BE-B2)

- **Files:** `methodology/reviews.ts` (submit — which calls `revision-impact.ts` for the proposal — decide, withdraw, list; `config_review` work items via `createWorkItemOnce`), `methodology/publish.ts` (publish, rollback; lock 730251), `methodology/review-policies.ts`, `packages/shared/src/schemas/studio-review.ts`.
- **Operations (8):** `submitConfigReview`, `listConfigReviews`, `decideConfigReview`, `withdrawConfigReview`, `publishConfigVersion`, `rollbackConfigVersion`, `listConfigReviewPolicies`, `updateConfigReviewPolicy`.
- **Tests (REQ-S06-007, S06-009 literal):** publish without the required review → 422 `config_version.review_required`; editing a published version → 409 `config_version.not_editable`; publish with a failed coverage run → 422 `config_version.source_incomplete`; the author/requester deciding its review → 403 `config_review.self_review`; a kind with `review_required = false` publishes from preview in one call; rollback creates a new version (reason required), later business records stay retrievable and the audit trail shows `methodology_version.rollback_create` and `.publish`; TO can switch review off, ADM_METHOD gets 403.

### A.5 BE-C — methodology migrations, gate re-approvals, the gates reader, the S16-012 group (backend-workflow-engineer; after BE-B3)

- **Files:** `methodology/migrations.ts`, `methodology/migration-plan.ts` (ADR-0040 §2 items from the kind providers), `methodology/reapproval.ts`; the resolver lines in `workflows/gates.ts` and `workflows/criteria.ts` (approver and label reads through `ConfigResolver`; the `gate.reapproval_required` refusal; resubmission of a gate with a required re-approval; satisfying it on approval); the `decideApprovalInTx` export and the `decideThroughSubject` provider flag lines in `workflows/approvals.ts` (ADR-0040 §4; BE-K edits other lines of that file later, sequentially); `apps/api/test/integration/methodology/entity-group.test.ts` (REQ-S16-012), `apps/api/test/integration/methodology/v1-readers.test.ts` (p5-plan R2: every rewired reader byte-identical for a v1-pinned transformation on the DG4 fixtures); `packages/shared/src/schemas/methodology-migrations.ts`.
- **Operations (9):** `listMethodologyMigrations`, `createMethodologyMigration`, `getMethodologyMigration`, `previewMethodologyMigration`, `submitMethodologyMigration`, `decideMethodologyMigration`, `executeMethodologyMigration`, `withdrawMethodologyMigration`, `listGateReapprovals`.
- **Tests (REQ-S06-008 literal):** after v2 is published an existing transformation still renders v1; the preview lists a required G2 re-approval (and, once slice B's provider is merged, the new required field); execution leaves every historical record, submission, snapshot and decision byte-identical; G2 resubmission allowed while required, G3 submission 422 `gate.reapproval_required`; requester deciding → 403 `methodology_migration.self_approval`; `decideApproval` on the type → 422 `approval.decide_through_record`; stale pin → 409 `methodology_migration.pin_moved`; lock 730252.

### A.6 KBE-A — T06 default weights and rubric, instantiation (kpi-benefits-engineer; after BE-B3)

- **Files:** `methodology/scoring-defaults.ts`, `methodology/providers/scoring-defaults-kind.ts`, migration **`0065`** (ADR-0040 §5: redefine `p3_instantiate_transformation` to pin `scoring_defaults` and to create the v1 weight set from the newest published defaults; widen `scoring_weight_set_approval_basis_check` with `studio_default` and extend `scoring_weight_set_approval_complete`), its schema/catalogue lines, `packages/shared/src/schemas/scoring-defaults.ts`, `apps/api/test/integration/methodology/scoring-defaults.test.ts`.
- **Operations (3):** `putScoringDefaultsDraft`, `getScoringDefaults`, `getTransformationScoringDefaults`.
- **Tests (REQ-PB-093 literal):** the admin changes the Feasibility rubric text and the weights to 30/20/20/15/15 and publishes without a code change; a transformation created afterwards starts with 30/20/20/15/15 (`studio_default`, rationale naming the version); an existing one keeps 25/25/20/15/15 and rubric v1; 95 % → 422 `config_version.weights_total`; with the source defaults the DG3 instantiation output is byte-identical (regression test).

### A.7 Migrations of slice A

`0062`–`0064` are delivered. **`0065`**: KBE-A (above). **`0066`–`0067`**: free; used only if a slice A task's handback shows a database need, in task order (BE-C first). **Rule A-7 (source inventory):** BE-P (launch windows), KBE-G (health questions) and BE-T (roaming example) each add, in a migration of their own range, `UPDATE source_element SET feature_status = 'working' WHERE set_code = '…'` when their feature ships, so the coverage report stays true (F-DG4-160).

### A.8 Integration order

ARCH-01 → BE-A (W2) → BE-B → BE-B2 → BE-B3 → BE-C and KBE-A (parallel; they share no file) → FE-B (Studio, migrations and source-coverage screens; p5-plan §5.1) → QA-A/QA-B. BE-B2 and BE-B3 are new tasks inserted after BE-B; the orchestrator places them in waves W4/W5 (each needs only its predecessor).

### A.9 Requirement → owner (the 10 rows of slice A)

| Requirement | Owner task(s) | Completes with |
|---|---|---|
| REQ-PB-093 | KBE-A (defaults, instantiation), BE-B3 (publish, 100 % rule) | FE-B screens |
| REQ-S02-001 | BE-B2 (report, run), BE-B3 (publish gate) | BE-P, KBE-G, BE-T rule A-7 |
| REQ-S06-004 | BE-A, BE-B (draft edits, gate approver route), BE-C (gate reader) | slice B (T13 field, validation; ADR-0041), slice E (non-gate routes; ADR-0044), FE-B |
| REQ-S06-006 | BE-B (invariants) | — |
| REQ-S06-007 | BE-B (preview, diff, compatibility, affected records), BE-B3 (review, publish, immutability) | slice B (the added field in the diff) |
| REQ-S06-008 | BE-C | slice B provider (new required field) |
| REQ-S06-009 | BE-B3 | — |
| REQ-S06-010 | BE-B3 and BE-C (authorization tests: ADM_METHOD publish yes / funding approval 403; BO Studio 403) | — |
| REQ-S12-018 | BE-B2 | — |
| REQ-S16-012 | BE-C (entity-group test) | — |

### A.10 What the implementers of slice A must know

1. **Versions are global.** `methodology_version` has no organization; scope checks on Studio operations are permission-only (`methodology.*`), on pins/migrations they are per transformation.
2. **The database refuses what the ADR refuses.** Your API checks must come first and return the §13/§8 codes; reaching a database guard is a programming error (map it to 500 in `platform/db-errors.ts` only where ADR-0007 says so).
3. **Hashes.** Recompute `content_sha256` on every content write (ADR-0039 §1) and record check runs against exactly that hash; stale runs never satisfy publish.
4. **No rewriting.** A migration or rollback never updates a business record, a submission, a snapshot or a decision; tests compare them byte for byte.
5. **Formula engine.** S12-018 validates formulas with `validateFormula` unchanged; never edit `packages/shared/src/formula/**`.
6. **Seeds.** The seeded v1 rows have opaque hashes; never recompute or rewrite them. Rubric descriptors are `null` in the seed: render "No descriptor defined", never invent text.
7. **D-142 decisions** are binding: Q1 (stable identities), Q4 ("create" = a draft version containing the element), Q9 (re-approval behaviour), Q12 (`0065`).

## §B. Slice B (form schemas, the eleven field types, custom fields, protected source columns, the common form framework) — T-DG5-ARCH-02

### B.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADR | `docs/architecture/adr/ADR-0041-p5-form-schemas-field-types-custom-fields-form-framework.md` | Binding design, with the refusal codes and English texts (§10) |
| Migrations | `packages/db/migrations/0068_p5_form_schemas_framework.sql`, `0070_p5_forms_procedures_permissions_coverage.sql` (shared with §C) | Applied on a fresh PostgreSQL 16.13 and over a P4-populated database; 116 guard probes PASS for B+C (`docs/delivery/handbacks/DG5/T-DG5-ARCH-02-evidence/probe-output.txt`) |
| Kysely types, catalogue pins, seed pins | `packages/db/src/schema.ts` (12 tables for B+C), `packages/db/test/integration/catalogue.test.ts`, `packages/db/src/seed.test.ts` (0070 block) | Pinned |
| Permissions | `packages/shared/src/permissions.ts` (`P5_FORMS_PROCEDURES_PERMISSIONS`, `P5_FORMS_PROCEDURES_ROLE_PERMISSIONS`; 5 codes) | Equals `0070` |
| Contract | `docs/api/openapi.yaml` 1.4.0-p5: 18 slice B operations (tag `forms`) | `pnpm openapi:lint` PASS (724 operations) |
| Contract-test seams | `apps/api/test/support/p5-pending-arch-02.ts` (B+C aggregate; frozen), `p5-pending-be-d.ts` (5), `p5-pending-be-e.ts` (6), `p5-pending-be-e2.ts` (7); `p5-operations.ts` block (34, B+C); `contract.test.ts` operation count 724 | Contract test green with all 34 pending |
| ERD §1m, data dictionary "P5 tables, slices B and C", permissions matrix §19 | `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | Dictionary generated from the catalogue |

The plan's BE-E is split into **BE-E** and **BE-E2** (thirteen framework operations were too many for one 60–75 minute task, the p4 `-2` precedent). KBE-B and FE-C are as p5-plan §5.1 names them.

### B.1 KBE-B — the eleven field-type validators (kpi-benefits-engineer; first in slice B)

- **Files:** `packages/shared/src/forms/**` (pure: `field-types.ts` with the Zod settings schema per type, `validate.ts` (value → `{ok, value}` or field problem code), `normalize.ts` (percentage `"12%"`/`"12"` → fraction `"0.12"`, currency `{amount, currencyCode}`, dates in the transformation timezone), `calculated.ts` (`validateFormula`/`evaluateFormula` wrapper: allowed variables = the record type's resolved numeric fields; missing input → `not_computable` with the missing names), property tests), the `forms/**` export lines in `packages/shared/src/calc.ts`.
- **Consumes:** ADR-0041 §3 (types, settings, stored shapes, 400 field codes and texts), §7; `packages/shared/src/formula/**` unchanged (rule 9).
- **Tests:** `12%`, `12` and `0.12` normalize to `"0.12"`; `1500000.10` SAR round-trips exactly (no float on any path; property test over random decimal strings); a calculated field referencing an unknown variable is refused; every type's refusal returns its exact code; Arabic-Indic digits are refused with `validation.decimal` (the DG3 decimal rule).

### B.2 BE-D — forms kind provider, form schema reads, custom-field values, the forms pin initializer (backend-workflow-engineer; after BE-A and KBE-B)

- **Files:** `forms/index.ts`, `forms/routes.ts` (first; registration of `forms/schema-reads.ts`, `forms/custom-values.ts` and stubs for BE-E/BE-E2 files), `forms/record-types.ts` (registry reads, `write_permission_code` authorization helper used by every slice B route), `forms/schema-reads.ts`, `forms/custom-values.ts`, `forms/provider.ts` (the `form_schema` `ConfigKindProvider`: Zod attribute schemas for `form`/`form_field`, diff rows "added/removed/changed field", compatibility (`warn` new required field, `fail` invalid calculated formula), affected records per record type, preview of sample records, the ADR-0040 "new required field" plan items; mapping of the `0068` constraint names to the ADR-0041 §10 codes), `forms/pin-initializer.ts` (the `TransformationInitializer` that pins a new transformation to the newest published `forms` version in its create transaction; the `server.ts` registration line is named and owned here), `packages/shared/src/schemas/forms.ts` (+ its barrel line; BE-A creates the stub), `apps/api/test/integration/forms/**` for these operations.
- **Operations (5):** `listFormRecordTypes`, `getFormSchemaAdmin`, `getTransformationFormSchema`, `getFormRecordCustomFields`, `putFormRecordCustomFields`.
- **Consumes:** ADR-0041 §1–§4, §9–§10; `ConfigResolver` (slice A); the slice A element operations (`putConfigElement`/`removeConfigElement`) route form elements through this provider (registered in `methodology/kinds.ts` — the one registration line is BE-D's).
- **Tests (literal):** REQ-S05-002: an extension field added to T03 publishes (Studio pipeline); deleting T03 `gap` → 422 `form_schema.source_column_protected`; changing a source column's type → 422 `form_schema.source_column_type_fixed`. REQ-S06-005: `12%` stores `"0.12"`; a currency value stores decimal SAR exactly; a calculated field naming an unknown field → 422 `form_schema.calculated_formula_invalid`. REQ-S16-010: a value violating its schema → 400/422 before persistence (and the database refuses it when forced: one test with the API check bypassed). A transformation created after the release is pinned to the newest forms version; a DG4 transformation reads forms v1. `If-Match` `"0"` creates, stale → 409 `form_record.conflict` with `currentVersion`; 428 missing; AUD 403; one audit event per write; commit-time re-authorization (permission revoked mid-request → 403, nothing written).

### B.3 BE-E — version history, comments, attachments (backend-workflow-engineer; after BE-D)

- **Files:** `forms/history.ts`, `forms/comments.ts`, `forms/attachments.ts` (writes `evidence_link` for its twenty DG2 record types through the evidence module's exported link function, else `form_record_attachment`), their `forms/routes.ts` lines, `packages/shared/src/schemas/forms-framework.ts`, tests.
- **Operations (6):** `listFormRecordVersions`, `listFormRecordComments`, `createFormRecordComment`, `listFormRecordAttachments`, `attachFormRecordEvidence`, `removeFormRecordAttachment`.
- **Consumes:** ADR-0041 §5, §6, §8; `audit_event` (read only); the evidence module's link service (no edit to `evidence/**`: if no exported function exists, request one in the handback and use the repository read path).
- **Tests (REQ-S05-001 literal, T01 and T14):** after an edit, history lists the new version with the changed fields; a comment and a reply persist and read back; a reply to a reply → 422 `form_comment.parent_invalid`; an attachment on T14 (`benefit`, `form_record_attachment`) and on T01 (`diagnostic_item`, `evidence_link`) persist and list; removal needs a reason; AUD 403 on writes; free-text rules on comment bodies.

### B.4 BE-E2 — export, bulk edit, drafts, the recoverable conflict (backend-workflow-engineer; after BE-E)

- **Files:** `forms/export.ts` (CSV RFC 4180 UTF-8 with BOM and JSON; 5000-row cap), `forms/bulk.ts` (all-or-nothing through each register's exported update function; a register without one is listed in the handback and its record type stays `bulk_edit_allowed` only if served), `forms/drafts.ts`, the `transformations/register-kit.ts` lines that expose each register's update function to `forms/bulk.ts` (named lines only; existing routes unchanged), their `forms/routes.ts` lines, tests.
- **Operations (7):** `exportFormRecords`, `bulkUpdateFormRecords`, `listFormDrafts`, `createFormDraft`, `getFormDraft`, `updateFormDraft`, `closeFormDraft`.
- **Consumes:** ADR-0041 §5–§7, §10; `config.consumes` `application/json` on every body; the export response declares `text/csv` and `application/json`.
- **Tests (REQ-S05-001 literal, T01 and T14):** a saved draft reopens with its payload and `baseChanged` after a concurrent edit; export returns the rows (CSV and JSON, en and ar headers; Unknown marked, never 0); bulk edit of owners on 3 T15 records commits all, and with one stale version commits none (409 `form_record.bulk_conflict` listing it); a conflicting concurrent save returns the recoverable 409; AUD 403; one audit event per record written.

### B.5 Migrations of slice B and C

`0068`–`0070` are delivered. **`0071`–`0073`** are free and are taken, in this order, only by a slice B/C task whose handback shows a database need: **`0071` BE-F2** (expected: the work-item kind `procedure_step` and its My Work section line, if the step assignment is shown in My Work — ADR-0042 §7); **`0072` BE-G** (only if an output adapter needs a constraint or seed change); **`0073` BE-E2** (only if bulk edit or export needs one). A task that needs none leaves its number unused; numbers are never reordered.

### B.6 Integration order (slice B)

ARCH-02 → KBE-B → BE-D (after BE-A) → BE-E → BE-E2 → FE-C (form-builder screens and the form framework on T01 and T14; p5-plan §5.1). BE-E and BE-E2 are sequential on `forms/routes.ts`.

### B.7 Requirement → owner (slice B)

| Requirement | Owner task(s) | Completes with |
|---|---|---|
| REQ-S05-001 | BE-E (history, comments, attachments), BE-E2 (drafts, export, bulk, conflict), BE-D (validation, inline help reads) | FE-C (T01 and T14 screens) |
| REQ-S05-002 | BE-D (provider, protected columns) | FE-C (Studio fields screen) |
| REQ-S05-006 | BE-D (registry reads, badge) | FE-C (badge in en and ar on the twelve forms); the twelve creates/reads are the DG2–DG4 operations of ADR-0041 §1 and BE-F's `putProcedureDefinition` |
| REQ-S06-005 | KBE-B (validators), BE-D (wiring, calculated fields) | — |
| REQ-S16-010 | BE-D (custom values) | — |

## §C. Slice C (procedure definitions, instances, the ten seeded procedures, the coverage view, the S16-015 entity group) — T-DG5-ARCH-02

### C.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADR | `docs/architecture/adr/ADR-0042-p5-procedure-definitions-instances-seeded-procedures-coverage.md` | Binding design, with the refusal codes and English texts (§10) |
| Migrations | `packages/db/migrations/0069_p5_procedures.sql` (tables, guards, the `procedures` v1 seed with the ten procedures and 31 steps), `0070_p5_forms_procedures_permissions_coverage.sql` (permissions, 114 coverage links) | Probe PS, PD, PI, CO, PM: PASS |
| Lock class | `platform/advisory-locks.ts` `procedureInstanceStep` 730254 (730255–730257 reserved), ADR-0016 §6 | Registry test updated (28 classes) |
| Contract | 16 slice C operations (tag `procedures`) | As §B |
| Contract-test seams | `p5-pending-be-f.ts` (5), `p5-pending-be-f2.ts` (10), `p5-pending-be-g.ts` (1) | As §B |

The plan's BE-F is split into **BE-F** (definitions) and **BE-F2** (instances); BE-G is as planned, without the seed migration (the architect delivered the ten seeded procedures in `0069`).

### C.1 BE-F — procedure definitions and the procedures kind provider (backend-workflow-engineer; after BE-D)

- **Files:** `procedures/index.ts`, `procedures/routes.ts` (first; stubs for BE-F2/BE-G files), `procedures/definitions.ts` (reads, put/remove in a draft, the builder validation of ADR-0042 §1–§2 returning every finding), `procedures/provider.ts` (the `procedure` `ConfigKindProvider`: copy of definition and step rows into a new draft, the content-hash rows of ADR-0042 §1, diff rows, compatibility, affected instances (running instances stay pinned), preview), `packages/shared/src/schemas/procedures.ts` (+ barrel line), tests.
- **Operations (5):** `listProcedureDefinitions`, `validateProcedureDefinition`, `getProcedureDefinition`, `putProcedureDefinition`, `removeProcedureDefinition`.
- **Consumes:** ADR-0042 §1–§2, §9–§10; the KBE-B field schemas for `inputSchema`; slice A drafts, lock 730250 and publish (`publishConfigVersion` publishes procedures; no separate publish operation).
- **Tests (REQ-S06-001 literal):** a definition with a conditional and a parallel step validates, is saved in a draft, previewed, reviewed (TO) and published, then launches (with BE-F2); a definition missing a trigger → 422 `procedure_definition.trigger_required`; missing a completion condition → 422 `procedure_definition.completion_required`; ADM_METHOD as a responsible role → 422 `procedure_definition.role_not_allowed`; removing a seeded procedure → 422 `procedure_definition.source_protected`; editing a published version → 409 `config_version.not_editable`; AUD 403; `If-Match` on the draft.

### C.2 BE-F2 — procedure instances, steps and my procedures (backend-workflow-engineer; after BE-F)

- **Files:** `procedures/instances.ts` (launch, read model: current step, assignee, due date through the DG4 business calendar, missing inputs, evidence, next action), `procedures/steps.ts` (activate by ordinal, parallel groups, conditions with decimal.js, complete/skip/assign/evidence, cancel, completion; lock 730254; the output-adapter port `ProcedureOutputAdapter` and its registry that BE-G fills), `procedures/my-steps.ts`, `apps/worker/src/handlers/procedures.ts` (fill BE-A's stub: consume `procedure_step.activated` for the slice E rule actions; no reminder logic here), migration **`0071`** if needed (§B.5), its schema/catalogue lines, tests.
- **Operations (10):** `listProcedureInstances`, `launchProcedureInstance`, `getProcedureInstance`, `updateProcedureInstanceInputs`, `completeProcedureStep`, `skipProcedureStep`, `assignProcedureStep`, `linkProcedureStepEvidence`, `cancelProcedureInstance`, `listMyProcedureSteps`.
- **Consumes:** ADR-0042 §3–§4, §7, §9–§10; the canonical approval (ADR-0026) for approval steps (create the approval when the step activates; complete the step in the approval-decided hook — the `workflows/approvals.ts` provider line is named in the handback for the orchestrator, as BE-C did, because BE-C and BE-K also edit that file).
- **Tests (REQ-S06-002 literal, A02 part):** a `baseline_validation` instance shows `record_baseline` as current step with its assignee and due date; missing inputs listed; completing without them → 422 `procedure_step.inputs_missing` with `missingInputs`; the evidence rule; parallel steps both active; a false condition → `not_applicable`; an approval step completes only after the canonical approval is approved by its business approver; a published v2 does not change a running v1 instance; launch with a launch key twice creates one instance; AUD 403; `If-Match` 428/409; one audit event per mutation; a launch by a role outside the definition's launch roles → 403 `procedure.launch_role`.

### C.3 BE-G — output adapters, the coverage view, the S16-015 entity group (backend-workflow-engineer; after BE-F2)

- **Files:** `procedures/outputs/**` (one adapter per output record type of ADR-0042 §3, each calling the owning module's exported service with the acting user: `transformations` (create), `charter`, `kpi` (baseline create and validate, KPI actual submit and accept), `workflows` (approval, gate submission and decision link, change request), `portfolio` (ranking snapshot), `benefits` (finance validation), `governance` (executive decision), `sustainment` (BAU handover), `evidence`; a missing exported service is requested in the handback, never re-implemented), `procedures/coverage.ts`, its `procedures/routes.ts` line, `apps/api/test/integration/procedures/entity-group.test.ts` (REQ-S16-015), `apps/api/test/integration/procedures/seeded-procedures.test.ts` (REQ-S06-003), migration **`0072`** only if needed.
- **Operations (1):** `getMethodologyCoverage`.
- **Consumes:** ADR-0042 §3, §5, §6, §8; `source_element` and `methodology_coverage_link` (read only).
- **Tests (literal):** REQ-S06-002: completing `baseline_validation` creates a baseline, the FIN step validates it, and the validated baseline is linked to the instance. REQ-S06-003: the ten procedures exist after initialization and each launches and completes with its adapters (synthetic data; approval steps decided by a synthetic business approver). REQ-S01-003: every one of the 80 source elements shows a linked form or procedure; launch windows and health questions show **Planned** (never green) until slice H ships. REQ-S16-015: create and read TOMDimension (draft element), TOMCanvas, Capability, Gap, Journey, Process, ProcedureDefinition, ProcedureInstance through the API with authorization enforced (AUD 403, 404 outside scope).

### C.4 Integration order (slice C)

BE-D → BE-F → BE-F2 → BE-G (sequential on `procedures/routes.ts`) → FE-D (procedure builder, my procedures, instance view; with slice E's screens, p5-plan §5.1) → QA-A/QA-E (A06, A02). Slice E (BE-J) registers the event/schedule launches and the step reminders/escalations as rule actions after BE-F2.

### C.5 Requirement → owner (slice C)

| Requirement | Owner task(s) | Completes with |
|---|---|---|
| REQ-S01-003 | BE-G (coverage view) | QA-E (A02 guided scenario) |
| REQ-S06-001 | BE-F | FE-D (procedure builder) |
| REQ-S06-002 | BE-F2 (instances), BE-G (outputs) | FE-D (instance view, my procedures); slice E (step reminders) |
| REQ-S06-003 | architect (seed in `0069`), BE-G (launch/complete test) | QA-E |
| REQ-S16-015 | BE-G (entity-group test); architect (ERD §1m, `0069`) | — |

### C.6 What the implementers of slices B and C must know

1. **One key per kind.** Form schemas are kind `form_schema`, key `forms`; procedures are kind `procedure`, key `procedures`. Drafts copy every row of their base (ADR-0039 §2); the content hash includes the provider rows (ADR-0042 §1), so recompute it on every write.
2. **The database refuses what the ADRs refuse.** API checks come first and return the ADR-0041 §10 / ADR-0042 §10 codes; reaching a `0068`/`0069` guard is a programming error. The probe (`probe-output.txt`) names each guard and its constraint name.
3. **Decimals.** Every number, percentage and currency value is a decimal string (KBE-B validators); a percentage is stored as a fraction; currency carries its code. Unknown and Not computable are never 0 or green.
4. **No DG2–DG4 change.** Custom values live in `form_custom_value`; attachments of the twenty DG2 record types stay in `evidence_link`; bulk edits and output adapters call the owning modules' existing services. Any change to a DG2–DG4 route, request, response or rule is a reopen candidate: stop and raise it.
5. **Pins.** DG1–DG4 transformations resolve to forms v1 (no back-fill); new ones are pinned at creation by BE-D's initializer. A running procedure instance stays on its definition version.
6. **Approvals.** Procedure approval steps are decided only through the canonical approval by the human business approver; tests use synthetic approvers labelled as such.
7. **Locks.** 730254 for instance step transitions; no lock for comments (append-only); 730255–730257 stay reserved.
8. **Exactly once.** Automation launches carry `launch_key` (UNIQUE); work items use `createWorkItemOnce` with `procedure_step:<stepInstanceId>:<kind>`.
9. **D-142 decisions** are binding: Q1 (stable identities), Q4 ("create" for TOMDimension = a draft element), Q8 (no new dependency).

## §D. Slice D (automation engine: rules, versions, dry run, executions, failure queue, retries, service identity, jobs operations) — T-DG5-ARCH-03

### D.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADRs | `docs/architecture/adr/ADR-0043-p5-automation-engine-rules-executions-failure-queue.md` (slice D), `ADR-0044-p5-starter-automations-approval-routes-notification-policy.md` (slice E) | Binding design, with the refusal codes and English texts (ADR-0043 §9, ADR-0044 §10) |
| Migrations | `packages/db/migrations/0074_p5_automation_engine.sql`, `0075_p5_starters_routes_policies.sql`, `0076_p5_automation_permissions.sql` (shared with §E) | Applied on a fresh PostgreSQL 16.13 and over a P4-populated database; 133 guard probes PASS for D+E (`docs/delivery/handbacks/DG5/T-DG5-ARCH-03-evidence/probe-output.txt`) |
| Kysely types, catalogue pins, seed pins | `packages/db/src/schema.ts` (17 tables; 1 column on `work_item_kind`, 5 on `inbox_notification`), `packages/db/test/integration/catalogue.test.ts`, `packages/db/src/seed.test.ts` (0076 block) | Pinned |
| Permissions | `packages/shared/src/permissions.ts` (`P5_AUTOMATION_PERMISSIONS`, `P5_AUTOMATION_ROLE_PERMISSIONS`; 8 codes) | Equals `0076` |
| Lock classes | `platform/advisory-locks.ts` `automationRuleExecution` 730258, `failureRepair` 730259, `approvalRouteStep` 730260, `digestWindow` 730261 (730262 reserved), ADR-0016 §6 | Registry test updated (32 classes) |
| Work-item kinds wired | `automation_task`, `automation_rule_review`, `role_assignment`, `dependency_slip`, `gate_condition_overdue`, `meeting_pack_review` in `reporting/my-work.ts` `MY_WORK_SECTION_BY_KIND`; labels in `apps/web/src/i18n/{en,ar}/myWork.json` | The completeness test reads every `work_item_kind` row |
| Contract | `docs/api/openapi.yaml` 1.4.0-p5: 39 operations (tags `automation`, `jobs`, `approval-routes`, `gate-conditions`, `dependency-slips`, `meetings`, `notifications`); `TransformationCreate.launchPlan` (optional; p5-plan §3 row 15); `PermissionCode` +8 | `pnpm openapi:lint` PASS (763 operations) |
| Contract-test seams | `apps/api/test/support/p5-pending-arch-03.ts` (D+E aggregate; frozen), `p5-pending-be-h.ts` (11), `p5-pending-be-h2.ts` (6), `p5-pending-be-i.ts` (6), `p5-pending-be-i2.ts` (3), `p5-pending-be-j.ts` (1), `p5-pending-be-k.ts` (5), `p5-pending-be-l.ts` (5), `p5-pending-be-l2.ts` (2); `p5-operations.ts` block (39); `contract.test.ts` operation count 763 | Contract test green with all 39 pending |
| ERD §1n, data dictionary "P5 tables, slices D and E", permissions matrix §20 | `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | Dictionary generated from the catalogue |

The plan's BE-H, BE-I and BE-L are each split in two (**BE-H/BE-H2**, **BE-I/BE-I2**, **BE-L/BE-L2**): 39 operations plus the worker engine were too many for four 60–75 minute tasks (the p4 `-2` precedent). BE-J and BE-K are as p5-plan §5.1 names them.

### D.1 BE-H — rules, versions, the builder catalogue, enable/disable (backend-workflow-engineer; after BE-A)

- **Files:** `automation/routes.ts` (fill BE-A's stub; registration lines for `rules.ts`, `versions.ts`, `catalogue.ts` and stubs for BE-H2's `lifecycle.ts`/`dry-run.ts`), `automation/rules.ts`, `automation/versions.ts` (create draft, update content, content hash, readable summary en/ar), `automation/catalogue.ts`, `automation/registry.ts` (the `AutomationActionRegistry` port and descriptor type; its `server.ts` wiring line is named and owned here; each action's descriptor is registered by the module that owns it: `tasks/automation-actions.ts` (new; `create_task`, `notify`, `escalate`; owned by BE-H), `procedures/automation-actions.ts` (new; `launch_procedure`; owned by BE-J)), `automation/human-only.ts` (the S12-026 refusal before any write), `packages/shared/src/schemas/automation.ts` (+ barrel line: conditions, actions, content, Zod mirrors of the OpenAPI schemas), tests.
- **Operations (11):** `getAutomationCatalogue`, `listAutomationRules`, `createAutomationRule`, `getAutomationRule`, `updateAutomationRule`, `enableAutomationRule`, `disableAutomationRule`, `listAutomationRuleVersions`, `createAutomationRuleVersion`, `getAutomationRuleVersion`, `updateAutomationRuleVersion`.
- **Consumes:** ADR-0043 §1–§4, §8–§10; `0074` guards (map their constraint names to the §9 codes in `platform/db-errors.ts` P5 lines only where reaching them is not a programming error).
- **Tests (literal):** REQ-S12-026: saving a rule whose action is `approve_gate` (and each of the other five human-only codes) → 422 `automation_rule.human_only_action`, nothing written; REQ-S12-002: disabling a starter → 422 `automation_rule.guarantee_protected`, disabling an admin rule needs a reason; enabling without an effective version → 422 `automation_rule.no_effective_version`; a starter version with a condition → 422 `automation_rule.starter_fixed`; `initiating_user` on a schedule trigger → 422; a service permission `approval.decide` → 422; AUD 403 on every write; `If-Match` 428/409; one audit event per row written; commit-time re-authorization.

### D.2 BE-H2 — dry run, review where configured, publish, discard; the evaluation handler (backend-workflow-engineer; after BE-H)

- **Files:** `automation/dry-run.ts` (rolled-back read-only transaction; planners only), `automation/lifecycle.ts` (submit, review, publish, discard; `automation_rule_review` work items), `automation/conditions.ts` (pure evaluation with decimal.js; `automation.condition_unknown_value`), their `automation/routes.ts` lines (after BE-H), `apps/worker/src/handlers/automation.ts` and `apps/worker/src/queues/automation.ts` (fill BE-A's stubs: `automation.evaluate` mapped from every admin-selectable event trigger, `automation.tick_hourly`, `automation.tick_daily`; executions under lock 730258), `apps/worker/src/automation/engine.ts`, `apps/worker/src/automation/actions/{create-task,notify,escalate}.ts` (each with a parity test against its API planner), tests.
- **Operations (6):** `listAutomationDryRuns`, `runAutomationDryRun`, `submitAutomationRuleVersion`, `decideAutomationRuleReview`, `publishAutomationRuleVersion`, `discardAutomationRuleVersion`.
- **Consumes:** ADR-0043 §2, §4, §5; `config_review_policy` row `automation_rule_set` (read only); the kit's `createWorkItemOnce`, `runOnce`, `jobActor`.
- **Tests (literal):** REQ-S12-002: a dry run creates no work item, notification, execution or business record (counts before/after), and records one `automation_dry_run`; submit without a pass dry run → 422 `automation_rule_version.dry_run_required`; the author reviewing → 403 `automation_rule_version.self_review`; publish with review required and none → 422 `automation_rule_version.review_required`; TO switches review off (slice A operation) and a draft publishes after its dry run. REQ-S12-001: an enabled admin rule on `gate.decided` records one execution naming its version, trigger event and outcome; conditions not met → `skipped`. REQ-S12-021: the same event ×3 → one execution, one task.

### D.3 BE-I — executions, the failure queue, retry and dismiss, service identity (backend-workflow-engineer; after BE-H2)

- **Files:** `automation/executions.ts`, `automation/failures.ts` (fill BE-A's stub: list, get, retry, dismiss; lock 730259; `boss.send` after COMMIT), `automation/identity.ts` (initiating user vs constrained service identity; scope check; `automation.action_forbidden` → failure at once), `apps/worker/src/automation/identity.ts` (the worker twin, parity test), the failure-capture lines in `apps/worker/src/kit.ts` and `apps/worker/src/worker.ts` (last attempt → `operational_failure`, then rethrow so `ops.failed` is unchanged; the `job.failed` outbox event), the S12-020/S12-021 kill/replay tests, tests.
- **Operations (6):** `listAutomationExecutions`, `getAutomationExecution`, `listAutomationFailures`, `getAutomationFailure`, `retryAutomationFailure`, `dismissAutomationFailure`.
- **Consumes:** ADR-0043 §3, §5, §7; `RETRY_POLICY` unchanged.
- **Tests (literal):** REQ-S12-003: a rule on transformation A configured to create a task in transformation B fails with `automation.action_forbidden` and appears in the failure queue; REQ-S12-002: a failed execution succeeds on retry without duplicating actions (one `done` result per key); REQ-S12-020: killing the worker mid-job and restarting completes the job once; after the retry limit (5) the job is in the failure queue with its idempotency key; REQ-S12-021: replay ×3 of one event yields one reminder, one action and one approval task; retry of a resolved/dismissed failure → 422 `automation_failure.not_open`; the 21st retry → 422 `automation_failure.retry_limit`; AUD 403; job failures need `job.repair`.

### D.4 BE-I2 — the jobs operations view, job runs, next run, run now (backend-workflow-engineer; after BE-I)

- **Files:** `jobs/operations.ts` (fill BE-A's stub), `packages/shared/src/time/cron-next.ts` (pure five-field cron next-run in a time zone; no dependency; property tests against the DG4 cron strings), the `job_run` recording lines in `apps/worker/src/worker.ts` (scheduled queues only; after BE-I's lines), tests.
- **Operations (3):** `listJobOperations`, `getJobOperation`, `runJobNow`.
- **Consumes:** ADR-0043 §6; DG4 `job_schedule` (read only; `PATCH /admin/job-schedules` unchanged).
- **Tests (literal):** REQ-S12-022: the view shows last success and next run for each scheduled job (a never-run job "Never run", a disabled job "Disabled", never a guessed time); a non-admin (TL, AUD) gets 403; run now on a disabled schedule → 422 `job.schedule_disabled`; run now twice in one minute sends one job.

## §E. Slice E (starter automations as rules, new-transformation instantiation, dependency slips, cut-off packs, approval routes, conditional approval, notification policy) — T-DG5-ARCH-03

### E.0 Already delivered by the architect

See §D.0 (shared artifacts). Slice E's seeds are in `0075`: the sixteen starters with their published version 1, the five schedules of slices D and E, the six work-item kinds and `work_item_kind.urgency`.

### E.1 BE-J — starters as rules, S12-004 instantiation, dependency slips (backend-workflow-engineer; after BE-I)

- **Files:** `apps/worker/src/automation/starters.ts` (`withStarterRule`; the registration of each DG4 handler through it in `apps/worker/src/handlers/index.ts` — named lines only, the DG4 handler files are not edited except the one export below), `automation/request-executions.ts` (`recordRequestExecution` for starters 5, 14, 15) and its one call line each in `workflows/gates.ts` (after BE-C; before BE-K), `sustainment/handovers.ts` and `methodology/revision-impact.ts` (after BE-B2), the `launchPlan` member in the `transformations` create schema and the `transformation.created` v2 payload (`packages/shared/src/schemas/events.ts` named lines; v1 consumer kept), the P5 lines of `handleTransformationCreated` in `apps/worker/src/handlers/platform.ts` (phase checklist, role tasks, launch-plan port), the export of the phase-step instantiation function in `apps/worker/src/handlers/gates.ts` (one line, behaviour unchanged), `automation/ports/launch-plan.ts` (the `LaunchPlanPort` and its no-op default; BE-P registers the implementation), `portfolio/slip-events.ts` + its one call line in the DG4 milestone update service, `portfolio/dependency-slips.ts` (list route; its registration line in `portfolio/routes.ts`), `apps/worker/src/handlers/portfolio.ts` (new file; `portfolio.dependency_slip` notifications) and its one import line in `handlers/index.ts`, the `launch_procedure` action (`procedures/automation-actions.ts` (new) + `apps/worker/src/automation/actions/launch-procedure.ts` with its parity test against BE-F2's launch), tests.
- **Operations (1):** `listDependencySlips`; plus the `createTransformation` extension (`launchPlan`), exercised in `p5-exercises-be-j.ts`.
- **Consumes:** ADR-0044 §1, §2, §7; ADR-0043 §5; ADR-0023 §5, ADR-0031 (scheduling functions unchanged); ADR-0048 (the launch-plan port, implemented by BE-P).
- **Tests (literal):** REQ-S12-001: each of the sixteen starters records one execution per trigger occurrence with its rule version, trigger event and outcome, and its DG4 output is byte-identical to the DG4 test fixtures (one regression test per starter, p5-plan R3); replay ×3 per starter creates nothing more. REQ-S12-004: creating one transformation produces one set of phase-checklist rows and role tasks; a retry creates no duplicates; with the plan flag the 90-day tasks are dated from the start date (stays in `p5-pending-be-j` as a pending test until BE-P merges, p5-plan §5.2). REQ-S12-012: a 5-day slip of a critical dependency notifies each affected owner once and the dependent forecasts read after the change are those of the DG4 logic; a slip below `minimumSlipDays` raises nothing; a non-critical dependency raises nothing.

### E.2 BE-K — approval routes, conditional approval and condition escalation (backend-workflow-engineer; after BE-J)

- **Files:** `workflows/approval-routes.ts` (route resolution from `approver_route` elements and procedure approval modes; step instantiation; decision; completion; locks 730226 then 730260), its named lines in `workflows/approvals.ts` (step creation on request and resubmission; `approval.decide_through_route`; after BE-C's lines), `workflows/conditional-approval.ts` (switch resolution with the G5 catalogue default `true`; `gate.conditional_approval_disabled`; closure), its named lines in `workflows/gates.ts` (after BE-J's line), the `conditionalApprovalEnabled` attribute line in `packages/shared/src/schemas/studio.ts`, `workflows/gate-conditions.ts` (list, close), `apps/worker/src/handlers/approvals.ts` route-step lines (activation work items) and the new `gate.condition_escalation_scan` handler in `apps/worker/src/handlers/gates.ts` (new function only), `packages/shared/src/schemas/approval-routes.ts` (+ barrel line), their route registration lines in `workflows/routes.ts`, tests.
- **Operations (5):** `listApprovalRoutes`, `getApprovalRoute`, `decideApprovalRouteStep`, `listGateConditions`, `closeGateCondition`.
- **Consumes:** ADR-0044 §3, §4, §8–§10; ADR-0026 (canonical approval, SoD, delegation); BE-C's `decideApprovalInTx`; ADR-0035 §5 (scale scope, unchanged).
- **Tests (literal):** REQ-S10-015: in a sequential route step 2 has no work item or notification until step 1 approves; in a parallel route both are notified at once; the requester deciding → 403 `approval_route.self_decision`; one person deciding two steps → 403 `approval_route.one_step_per_person`; DG4 `decideApproval` on a routed approval → 422 `approval.decide_through_route`; a DG4 single-step approval is unchanged (regression). REQ-S04-011: a conditional G5 approval limited to one region blocks a scale transition for another region (DG4, re-run); a conditional approval with no scope → 422 `gate.scale_scope_required`; with the switch off in a published v2, conditions → 422 `gate.conditional_approval_disabled`; v1 transformations unchanged; the owner closes a condition, another user → 403 `gate_condition.not_owner`; an overdue condition escalates once to the approver; AUD 403.

### E.3 BE-L — notification policy, preferences, delivery and digests (backend-workflow-engineer; after BE-J)

- **Files:** `packages/shared/src/notifications/delivery.ts` (pure delivery decision: urgent, quiet hours across midnight, digest times, working days; property tests in Asia/Riyadh and another zone), `tasks/notification-policy.ts` (preferences and policy routes; their registration lines in `tasks/routes.ts`), `tasks/digests.ts` (own digest read), the delivery lines in `tasks/service.ts` `createWorkItemOnce` and its twin in `apps/worker/src/kit.ts` (named lines; the parity test extended), the inbox list filter line (`delivery_state = 'delivered'`) in the DG4 inbox read, `apps/worker/src/handlers/digests.ts` (new file; `notification.digest`, lock 730261) and its import line, `packages/shared/src/schemas/notifications.ts` (+ barrel line), tests.
- **Operations (5):** `getMyNotificationPreferences`, `putMyNotificationPreferences`, `getMyNotificationDigest`, `getNotificationPolicy`, `putNotificationPolicy`.
- **Consumes:** ADR-0044 §5, §9, §10; DG4 business calendars (`loadDefaultWorkingCalendar`).
- **Tests (literal):** REQ-S12-025: a non-urgent reminder created in quiet hours (digest daily) is delivered in the next digest, and the digest job run twice in the window creates one digest; an urgent escalation (`approval_escalated`) in quiet hours is delivered immediately; with no preference and no policy every notification is delivered at once (DG4 regression on the inbox list); quiet start = end → 422 `notification_preference.quiet_hours_invalid`; the work item is visible in My Work while its notification is held; AUD 403 on `PUT /me/notification-preferences`; `If-Match "0"` creates; 409 stale.

### E.4 BE-L2 — meeting cut-off draft agenda and pack (backend-workflow-engineer; after BE-L)

- **Files:** `governance/cut-off.ts` (fill BE-A's stub: pack read and review routes; the generation service), `apps/worker/src/handlers/meetings.ts` — **new function only** `governance.meeting_cutoff_scan` (the DG4 series handler is not edited) and its queue line in `apps/worker/src/queues/meetings.ts`, the `agenda_item.pack_not_reviewed` mapping line in `governance/agenda.ts` (the DG4 publish path maps the `0075` trigger refusal), `packages/shared/src/schemas/cutoff.ts` (+ barrel line), tests.
- **Operations (2):** `getMeetingCutoffPack`, `reviewMeetingCutoffPack`.
- **Consumes:** ADR-0044 §6; ADR-0032 (agenda items, executive asks; the open-asks read through the governance service — name it in the handback if it is not exported).
- **Tests (literal):** REQ-S12-015: cut-off creates one draft agenda containing the current open asks (and only those); a second scan creates nothing; publishing one of its items before review → 422 `agenda_item.pack_not_reviewed`; after the chair reviews, the chair publishes; a non-chair/secretary reviewing → 403 `meeting_cutoff_pack.not_reviewer`; DG4 agenda items outside packs publish as before (regression); AUD 403.

### E.5 Migrations of slices D and E

`0074`–`0076` are delivered. **`0077`–`0079`** are free and are taken, in this order, only by a task whose handback shows a database need: **`0077` BE-J** (expected only if a starter needs a seed change, e.g. a further trigger row a DG4 handler consumes that `0075` missed); **`0078` BE-K** (only if route resolution needs a constraint); **`0079` BE-L/BE-L2** (only if delivery or the cut-off scan needs one). A task that needs none leaves its number unused; numbers are never reordered.

### E.6 Integration order (slices D and E)

ARCH-03 → BE-H (after BE-A) → BE-H2 → BE-I → BE-I2 and BE-J (parallel; they share no file: BE-I2 edits `worker.ts` run-recording lines after BE-I, BE-J edits `handlers/index.ts`) → BE-K and BE-L (parallel; BE-K edits `workflows/**` and `handlers/approvals.ts`/`gates.ts`, BE-L edits `tasks/**`, `kit.ts` and `handlers/digests.ts`) → BE-L2 → FE-D (rule builder, dry run, enable/disable, executions, failure queue, jobs view extension, approval routes, notification preferences; p5-plan §5.1) → QA-A (A06), QA-E (A02). BE-H2, BE-I2, BE-L2 are new tasks inserted after their predecessors; the orchestrator places them in waves (each needs only its predecessor).

### E.7 Requirement → owner (the 13 rows of slices D and E)

| Requirement | Owner task(s) | Completes with |
|---|---|---|
| REQ-S12-001 | BE-H (rules, versions), BE-H2 (engine, execution history), BE-J (sixteen starters as rules) | FE-D (builder, history) |
| REQ-S12-002 | BE-H (builder content, enable/disable), BE-H2 (dry run), BE-I (failure queue, retry) | FE-D |
| REQ-S12-003 | BE-I (identity, out-of-scope → failure queue) | — |
| REQ-S12-020 | BE-I (failure capture, kill/restart test; pg-boss retries unchanged) | — |
| REQ-S12-021 | BE-H2 and BE-I (replay ×3), BE-J (replay ×3 per starter) | — |
| REQ-S12-022 | BE-I2 (jobs view, runs, next run, repair) | FE-D (jobs view extension) |
| REQ-S12-026 | BE-H (refusal; database guard in `0074`) | — |
| REQ-S04-011 | BE-K (switch, closure, escalation) | FE-D (the conditions list; the gate decision screen is DG4's) |
| REQ-S10-015 | BE-K | FE-D (approval routes screen) |
| REQ-S12-004 | BE-J | BE-P (launch-plan port) |
| REQ-S12-012 | BE-J | — |
| REQ-S12-015 | BE-L2 | — |
| REQ-S12-025 | BE-L | FE-D (notification preferences) |

### E.8 What the implementers of slices D and E must know

1. **Human decisions stay human.** No rule, starter, job or service identity decides an approval, a gate, an investment or a Finance attestation; the database refuses it twice (versions and results). Tests use synthetic approvers labelled as such.
2. **Starters are wrapped, never rewritten.** Keep each DG4 handler's queue, consumer name, `runOnce` key, lock class and outputs; prove byte-identical outputs on the DG4 fixtures (p5-plan R3).
3. **Exactly once, three layers.** `(rule version, trigger key)` UNIQUE + lock 730258; one `done` result per action key; the effect's own dedupe key. A retry reuses the original keys.
4. **No remote I/O inside a transaction.** Re-sending a job (`boss.send`) happens after the COMMIT of the `retrying` state; the worker records the outcome.
5. **Authorization failures are not retried.** They go to the failure queue at once with `automation.action_forbidden`.
6. **The database refuses what the ADRs refuse.** API checks come first and return the ADR-0043 §9 / ADR-0044 §10 codes; the probe (`probe-output.txt`) names each guard and constraint.
7. **Unknown is never 0.** Next run, last success, due dates and forecast finishes that cannot be computed are `null` with a reason, shown Unknown/Never run/Disabled.
8. **DG4 behaviour is the default.** No policy and no preference → every notification delivered at once; the G5 switch resolves to `true` for v1; DG4 approvals have no route rows.
9. **D-142 decisions** are binding: Q2 (switch on for v1), Q3 (starters never disableable), Q11 (in-app digests only), and plan row 15 (`launchPlan`).

## §F. Slice F (generated outputs, report snapshots, PDF/DOCX/XLSX/PPTX/CSV exports, presentation mode, owner updates, the evidence register) — T-DG5-ARCH-04

### F.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADRs | `docs/architecture/adr/ADR-0045-p5-generated-outputs-report-snapshots-owner-updates-presentation-evidence.md`, `ADR-0046-p5-exporters-pdf-docx-xlsx-pptx-csv-fonts-rtl-injection-export-jobs.md` | Binding design, with the refusal codes and English texts (ADR-0045 §11, ADR-0046 §8) |
| Migrations | `packages/db/migrations/0080_p5_reports_snapshots_updates.sql`, `0081_p5_export_jobs.sql`, `0082_p5_reporting_permissions.sql` | Applied on a fresh PostgreSQL 16.13 and over a P4-populated database; 93 guard probes PASS (`docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/probe-output.txt`) |
| Kysely types, catalogue pins, seed pins | `packages/db/src/schema.ts` (9 tables), `packages/db/test/integration/catalogue.test.ts` (tables, the slice F trigger set, grants, mutable `version` tables), `packages/db/src/seed.test.ts` (0082 block) | Pinned |
| Permissions | `packages/shared/src/permissions.ts` (`P5_REPORTING_PERMISSIONS`, `P5_REPORTING_ROLE_PERMISSIONS`; 4 codes) | Equals `0082` |
| Lock classes | `platform/advisory-locks.ts` `reportSnapshotIssue` 730263, `exportJob` 730264 (730265 reserved), ADR-0016 §6 | Registry test updated (34 classes) |
| Seeds | 12 `report_definition` rows; work-item kind `owner_update_due`; job schedule `reports.owner_update_tasks` | In `0080` |
| Work-item kind wired | `owner_update_due` → `missing_updates` in `reporting/my-work.ts` `MY_WORK_SECTION_BY_KIND`; labels in `apps/web/src/i18n/{en,ar}/myWork.json` | The completeness tests read every `work_item_kind` row |
| Contract | `docs/api/openapi.yaml` 1.4.0-p5: 26 operations (tags `reports`, `report-snapshots`, `exports`, `owner-updates`; `getMeetingPresentation` under `meetings`; two `evidence` reads); `PermissionCode` +4 | `pnpm openapi:lint` PASS (789 operations) |
| Contract-test seams | `apps/api/test/support/p5-pending-arch-04.ts` (aggregate; frozen), `p5-pending-kbe-c.ts` (11), `p5-pending-kbe-d.ts` (7), `p5-pending-be-m.ts` (5), `p5-pending-be-o.ts` (3); `p5-operations.ts` block (26); `contract.test.ts` operation count 789 | Contract test green with all 26 pending |
| ERD §1o, data dictionary "P5 tables, slice F", permissions matrix §21 | `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | Dictionary generated from the catalogue |
| Export dependency evidence | ADR-0046 §7; `docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/font-tables.txt` | The install request is in the T-DG5-ARCH-04 handback; the orchestrator installs before BE-M/BE-N (D-142 Q8) |

The plan's KBE-C and KBE-D are each split in two (**KBE-C/KBE-C2**, **KBE-D/KBE-D2**): twelve assemblers, the snapshot service and seven owner-update operations are too much for two 60–75 minute tasks (the p4 `-2` precedent). The renderers move from `apps/api/src/modules/reporting/exports/{pdf,docx,xlsx,pptx,csv}.ts` (p5-plan §5.1) to the reserved package `packages/reporting` (`@mth/reporting`), because the worker renders and cannot import API code (ADR-0046 §1; ADR-0002).

### F.1 KBE-C — report definitions, the document model, snapshots, issue, discard, reissue; the charter and registers assemblers (kpi-benefits-engineer; after BE-A)

- **Files:** `reporting/reports/routes.ts` (fill BE-A's stub; first), `reporting/reports/definitions.ts`, `reporting/reports/snapshots.ts` (generate in one `REPEATABLE READ` read-only assembly then one write transaction; captured sources, versions and evidence in the creating transaction; content hash; issue, discard, reissue under lock 730263; the `report_snapshot.issued` outbox event), `reporting/reports/provisional.ts` (ADR-0045 §5 rules, one function per source kind, unit-tested), `reporting/reports/assembler.ts` (the `Assembler` interface and registry; the other tasks add one line each), `reporting/reports/assemblers/charter.ts`, `reporting/reports/assemblers/registers.ts` (the six registers through their DG2–DG4 list services and filter schemas), `packages/shared/src/schemas/report.ts` (+ barrel line: `ReportDocument` v1, values with `validation`, registers parameters), the `report.*`/`report_snapshot.*` lines in `platform/db-errors.ts`, tests.
- **Operations (11):** `listReportDefinitions`, `getLiveReport`, `generateReportSnapshot`, `listReportSnapshots`, `getReportSnapshot`, `listReportSnapshotSources`, `listReportSnapshotVersions`, `listReportSnapshotEvidence`, `issueReportSnapshot`, `discardReportSnapshot`, `reissueReportSnapshot`.
- **Consumes:** ADR-0045 §1–§5, §9–§12; `ConfigResolver` (the methodology pin at the as-of time); the DG2–DG4 register list services and their Zod filter schemas (read only); `0080` guards.
- **Tests (literal):** REQ-S13-004: `charter` and `registers` generate from a seeded transformation and contain its ID and records; REQ-S13-007: after a later change to a KPI shown in a register, the issued snapshot still returns the old values with their `kpi_version` rows, and a reissue issued becomes `issueVersion` 2 while v1 is `superseded` with its content unchanged; REQ-S13-008: a pending benefit value in the benefits register has `validation: provisional` and is counted; a register filtered to RAID rows returns exactly the DG4 list route's rows for the same filters; 5,001 rows → 422 `report.too_large`, nothing written; issue by WL → 403; issuing a non-generated snapshot → 422 `report_snapshot.not_generated`; reissuing a superseded one → 422 `report_snapshot.not_issued`; two concurrent issues of reissues of one series → one 200, one 409 `report_snapshot.series_changed`; AUD 403 on every write; `If-Match` 428/409; one audit event per row written; commit-time re-authorization.

### F.2 KBE-C2 — the diagnostic, TOM, business-case, roadmap and gate-pack assemblers (kpi-benefits-engineer; after KBE-C)

- **Files:** `reporting/reports/assemblers/{diagnostic,tom,business-cases,roadmap,gate-pack}.ts` and their registry lines in `reporting/reports/assembler.ts` (after KBE-C), tests.
- **Operations:** none new (they become reachable through KBE-C's routes).
- **Consumes:** ADR-0045 §1, §3, §5; the DG2 diagnostic/TOM services, DG3 business case, formula versions and roadmap services, the DG2/DG4 gate evaluators' outputs (criteria with state and evidence) — read only; `ENGINE_VERSION` of `packages/shared/src/formula` (read, never changed).
- **Tests (literal):** REQ-S13-004: each of the five generates from a seeded transformation and contains its ID and records; the gate pack lists every criterion of the gate with its state and evidence (the content REQ-S13-005's PPTX test needs); a business case whose formula version is not validated has provisional values; the snapshot records one `formula_version` row per formula used and the `calculation_engine` row; value bases are never summed together (D-117, D-119, D-122).

### F.3 KBE-D — structured owner updates, update tasks and the executive pack (kpi-benefits-engineer; after KBE-C)

- **Files:** `portfolio/updates.ts` (create, update, submit, reopen, revisions; subject ownership) and its registration line in `portfolio/routes.ts`, `reporting/reports/assemblers/executive-pack.ts` and its registry line (after KBE-C2), `apps/worker/src/handlers/reports.ts` and `apps/worker/src/queues/reports.ts` (fill BE-A's stubs: `reports.owner_update_tasks`, exactly once via `createWorkItemOnce`), the `owner_update.*` lines in `platform/db-errors.ts`, tests. (The `owner_update_due` kind is already mapped to `missing_updates` in `reporting/my-work.ts` with its en/ar labels in `myWork.json`; F.0.)
- **Operations (7):** `listOwnerUpdates`, `createOwnerUpdate`, `getOwnerUpdate`, `updateOwnerUpdate`, `submitOwnerUpdate`, `reopenOwnerUpdate`, `listOwnerUpdateRevisions`.
- **Consumes:** ADR-0045 §6, §9, §11; DG4 `reporting_period`, `workstream`, the workstream dashboard read model (ADR-0037); `0080` guards.
- **Tests (literal):** REQ-S09-011: a WL submits the update of their workstream for the open period; the generated executive pack's workstream section contains the submitted text and the workstream's current metrics, with no manual edit; a workstream without an update shows "No update submitted"; a non-lead WL → 403 `owner_update.not_owner`; a closed period → 422 `owner_update.period_not_open`; an empty submit → 422 `owner_update.empty`; editing a submitted update → 422 `owner_update.not_draft`; reopen needs a reason; the task job run twice creates one task per owner and period; AUD 403; `If-Match` 428/409; one audit event per mutation.

### F.4 KBE-D2 — the minutes, executive-dashboard, handover and meeting-pack assemblers (kpi-benefits-engineer; after KBE-D)

- **Files:** `reporting/reports/assemblers/{meeting-minutes,executive-dashboard,handover,meeting-pack}.ts` and their registry lines (after KBE-D), tests.
- **Operations:** none new.
- **Consumes:** ADR-0045 §1, §3, §5, §7; DG4 minutes, agenda, decision briefs, asks and actions services; the dashboards engine (`reporting/dashboards/**`, read only); DG4 BAU handover service — read only.
- **Tests (literal):** REQ-S13-004: each of the four generates from a seeded transformation (with its meeting or handover) and contains the transformation's ID and the records; the executive dashboard needs a period (422 `report.period_required` without one) and shows Unknown/Stale values with no number; the meeting pack lists the agenda items with their linked decisions and asks; approval states as ADR-0045 §3 lists them.

### F.5 BE-M — `@mth/reporting` scaffold, export-file store, formula-injection rule, CSV and XLSX, export jobs (backend-workflow-engineer; after KBE-C and after the orchestrator's install)

- **Files:** `packages/reporting/src/{index.ts,render.ts,storage.ts,injection.ts,csv.ts}`, `packages/reporting/src/xlsx/**`, `packages/reporting/tsconfig.json` and the `src/**` layout (the `package.json` with its dependencies and the `exports` entries `.` and `./storage` is written by the orchestrator with the install, ADR-0046 §7), `reporting/exports/routes.ts` (fill BE-A's stub; first), `reporting/exports/jobs.ts` (create with idempotency, cancel, status, download with re-check), `apps/worker/src/handlers/reports.ts` and `queues/reports.ts` lines for `reports.export` (after KBE-D's lines), `apps/worker/src/reports/export-runner.ts` (lock 730264, progress, retries, failure capture through BE-I's kit lines), the `export.*` lines in `platform/db-errors.ts`, tests.
- **Operations (5):** `createExport`, `listExports`, `getExport`, `downloadExport`, `cancelExport`.
- **Consumes:** ADR-0046 §2, §4–§6, §8–§9; ADR-0045 §3 (the document model); ADR-0043 §5 (failure capture); `RETRY_POLICY` unchanged.
- **Tests (literal):** REQ-S13-006: a RAID description `=HYPERLINK("http://x","y")` is an inline string with `quotePrefix` in XLSX and `'=HYPERLINK(...)` in CSV; each of `=`, `+`, `-`, `@`, TAB and CR is neutralized, other first characters are not (property test); the system SUM total is `<f>SUM(...)</f>` with the decimal.js total as cached value; REQ-S13-005: an XLSX export of the RAID register with a filter contains exactly the filtered rows (cell-by-cell against the DG4 list route); a CSV export is UTF-8 with BOM and CRLF; Unknown is an empty cell with status "Unknown", never 0; the same `Idempotency-Key` → one job (200 on repeat); progress moves forward and ends `done`; a killed worker mid-export completes once; another user's `getExport`/`downloadExport` → 404; a requester who lost `transformation.read` → 404 on download; cancel of a succeeded job → 422 `export.not_cancellable`; download before success → 409 `export.not_ready`; AUD 403 on `POST /exports`.

### F.6 BE-N — PDF, DOCX and PPTX, bidirectional layout and bundled fonts (backend-workflow-engineer; after BE-M)

- **Files:** `packages/reporting/src/pdf/**`, `packages/reporting/src/layout/**` (bidi with `bidi-js`, line breaking, run fonts, RTL tables), `packages/reporting/src/fonts.ts` (loads the bundled `.woff` files from the two `@fontsource` packages), `packages/reporting/src/{docx,pptx}.ts`, their lines in `render.ts` (after BE-M), `packages/reporting/THIRD_PARTY_NOTICES.md` (each library's licence and the OFL text), tests and the A15 sample files under the task's evidence folder.
- **Operations:** none new (rendered through BE-M's jobs).
- **Consumes:** ADR-0046 §2, §3, §7, §9; slice I's branding read port and provenance footer text (BE-R). Until BE-R merges, the header uses the DG1 product name and the footer carries no provenance line; none is invented here, and BE-R's port adds it.
- **Tests (literal):** REQ-S13-009: an Arabic PDF of a register has RTL base direction, embeds IBM Plex Sans Arabic, and its identifiers (`RAID-014`) and numbers keep their left-to-right order (text extraction of the PDF's content stream and the glyph-run check: the Arabic word's glyph ids differ from the isolated forms, proving `GSUB` joining); an English PDF is LTR; REQ-S13-005: a PPTX gate pack contains each criterion of the gate (read back from the PPTX XML); REQ-S13-008: a pending benefit value prints "مؤقت"/"Provisional" in the PDF pack; a generated (not issued) snapshot carries "Draft — not an issued report"; DOCX Arabic paragraphs are `bidi`; the outcome of DOCX font embedding is stated in the handback (ADR-0046 §3).

### F.7 BE-O — meeting presentation, the evidence register and versions (backend-workflow-engineer; after KBE-C)

- **Files:** `governance/presentation.ts` (fill BE-A's stub: live through KBE-D2's `meeting_pack` assembler, or a snapshot's content), `evidence/register.ts` (register and versions; links across `evidence_link` and the domain link tables) and its registration line in `evidence/routes.ts`, tests.
- **Operations (3):** `getMeetingPresentation`, `listEvidenceRegister`, `listEvidenceVersions`.
- **Consumes:** ADR-0045 §7, §8; DG2 evidence repository (unchanged; no evidence column is added); KBE-D2's `meeting_pack` assembler (until it merges, the live mode test stays in `p5-pending-be-o.ts` as a pending test, the BE-J precedent).
- **Tests (literal):** REQ-S10-013: changing a linked decision before cut-off changes the live presentation; the issued meeting-pack snapshot still returns the old decision; a snapshot of another meeting → 422 `presentation.snapshot_mismatch`; REQ-S13-010: an uploaded file appears in the register with its SHA-256 and version 1; a second upload makes version 2, and the versions list shows both with their checksums and upload times; a note shows no checksum and "Not stated" for a missing source; a reader without `transformation.read` → 403; AUD reads.

### F.8 Migrations of slice F

`0080`–`0082` are delivered. **`0083`–`0084`** are free and are taken, in this order, only by a task whose handback shows a database need: **`0083` KBE-C/KBE-D** (expected only if an assembler needs an index on a DG2–DG4 table for the 5,000-row reads); **`0084` BE-M/BE-N** (only if export retention or a further error code needs one). A task that needs none leaves its number unused; numbers are never reordered.

### F.9 Integration order (slice F)

ARCH-04 → orchestrator install of the ADR-0046 §7 packages and `packages/reporting/package.json` → KBE-C (after BE-A) → KBE-C2, KBE-D and BE-O (parallel: KBE-C2 and KBE-D both add one line to `assembler.ts`, merged as appends; BE-O edits `governance/**` and `evidence/**`) → KBE-D2 (after KBE-D) and BE-M (after KBE-D's worker lines) → BE-N (after BE-M) → FE-E (`pages/reports/**`, `pages/exports/**`, `pages/presentation/**`, `pages/updates/**`; p5-plan §5.1) → QA-C (A15). Slice G's restatement (KBE-E) needs KBE-C's reissue and `report_snapshot.issued` event.

### F.10 Requirement → owner (the 9 rows of slice F)

| Requirement | Owner task(s) | Completes with |
|---|---|---|
| REQ-S13-004 | KBE-C (definitions, snapshots, charter, registers), KBE-C2 (diagnostic, TOM, business cases, roadmap, gate pack), KBE-D2 (minutes, executive dashboard, handover) | FE-E (generate screens) |
| REQ-S13-005 | BE-M (jobs, XLSX, CSV), BE-N (PDF, DOCX, PPTX) | FE-E (export dialog, progress), QA-C (A15) |
| REQ-S13-006 | BE-M (injection rule, XLSX/CSV writers) | — |
| REQ-S13-007 | KBE-C (snapshot, issue, reissue; database guards in `0080`) | FE-E (snapshots screen), KBE-E (reissue offer) |
| REQ-S13-008 | KBE-C (rules), KBE-C2/KBE-D/KBE-D2 (per assembler), BE-M/BE-N (labels in files) | FE-E |
| REQ-S13-009 | BE-N (layout, fonts) | QA-C (bilingual inspection) |
| REQ-S13-010 | BE-O (register, versions), KBE-C (snapshot evidence) | FE-E (evidence register screen) |
| REQ-S09-011 | KBE-D (updates, tasks, executive pack) | FE-E (`pages/updates/**`) |
| REQ-S10-013 | BE-O (presentation), KBE-D2 (meeting-pack assembler) | FE-E (`pages/presentation/**`) |

### F.11 What the implementers of slice F must know

1. **A snapshot never changes.** Its content and context are fixed at INSERT; only the status moves. Reissue is a new row in the same series. Do not set `created_at` explicitly on `report_snapshot`: the children's guard compares it with the transaction time.
2. **One assembler, many views.** Live view, generated snapshot, presentation and every export of an output come from the same assembler; nothing is typed into a report, and no copy is edited separately (M0212).
3. **Assemblers read through the owning module's services**, so a report shows what the screen shows. They compute no new business number; totals use decimal.js; value bases and currencies are never mixed.
4. **Provisional, Unknown and Stale are labelled, never 0 or green**, in the content, the native views and every file (ADR-0045 §5, ADR-0046 §4, §9).
5. **Renderers are pure and run in the worker.** No database, no network, no transaction around rendering or storing; the API never loads a renderer library.
6. **Formulas only from the template.** Spreadsheet formulas come only from the document model's declared totals; user text is never a formula (REQ-S13-006).
7. **Exports are authorized like the records.** Create and download re-check `transformation.read`; only the requester sees a job; others get 404.
8. **Exactly once.** Export jobs: requester + idempotency key UNIQUE, `singletonKey` = job id, lock 730264; owner-update tasks: the work-item dedupe key; snapshot issue: lock 730263 + the one-issued-per-series index.
9. **Dependencies come from the orchestrator.** Do not add or upgrade a package; if the ADR-0046 §7 packages are not installed when you start, your rendering checks are BLOCKED and you say so.
10. **Texts.** Labels, legends, "Draft — not an issued report", "No update submitted", "No records" and every problem code are i18n keys in en and ar (FE-E adds the web keys; the export label table lives in the API's i18n source the worker receives); no DG0–DG7 string appears in any template (slice I's scan reads `packages/reporting/src/**`).


## §G. Slice G (KPI prospective change and restatement, formula preview, the optional NPV/ROI/payback extension) — T-DG5-ARCH-05

### G.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADR | `docs/architecture/adr/ADR-0047-p5-kpi-restatement-formula-preview-financial-metrics.md` | Binding design, with the refusal codes and English texts (§8) |
| Migrations | `packages/db/migrations/0085_p5_kpi_restatements_financial_metrics.sql`, `0087_p5_kpi_launch_health_permissions.sql` (shared with §H) | Applied on a fresh PostgreSQL 16.13 and over a P4-populated database; guard probe 157/157 PASS (`docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/probe-output.txt`) |
| Kysely types, catalogue pins, seed pins | `packages/db/src/schema.ts` (7 slice G tables), `packages/db/test/integration/catalogue.test.ts` (tables, the slice G/H triggers, the two added DG4 triggers, grants, mutable `version` tables), `packages/db/src/seed.test.ts` (0087 block) | Pinned |
| Permissions | `packages/shared/src/permissions.ts` `P5_KPI_LAUNCH_HEALTH_PERMISSIONS`/`_ROLE_PERMISSIONS` (7 codes, shared with §H) | Equals `0087` |
| Lock class | `platform/advisory-locks.ts` `kpiRestatement` 730266 (730269 reserved for the block), ADR-0016 §6 | Registry test updated (37 classes) |
| Work-item kinds | `kpi_restatement_to_decide` (My Work Approvals), `report_reissue_offer` (Assigned actions) in `0085`; `reporting/my-work.ts` `MY_WORK_SECTION_BY_KIND` and `apps/web/src/i18n/{en,ar}/myWork.json` labels | The completeness tests read every `work_item_kind` row |
| Contract | `docs/api/openapi.yaml` 1.4.0-p5: 16 slice G operations (tags `kpi-restatements`, `formula-previews`, `financial-metrics`); `PermissionCode` +7 (shared with §H) | `pnpm openapi:lint` PASS (827 operations) |
| Contract-test seams | `apps/api/test/support/p5-pending-arch-05.ts` (aggregate; frozen), `p5-pending-kbe-e.ts` (6), `p5-pending-kbe-e2.ts` (2), `p5-pending-kbe-f.ts` (8); `p5-operations.ts` block (38 with §H); `contract.test.ts` operation count 827 | Contract test green with all 38 pending |
| ERD §1p, data dictionary "P5 tables, slices G and H", permissions matrix §22 | `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | Dictionary generated from the catalogue |

The plan's KBE-E is split in two (**KBE-E/KBE-E2**). Creation, the reconciliation and submission form one 60–75 minute task. The decision, the one-time recalculation and the reissue offers form a second. The p4 `-2` precedent applies.

### G.1 KBE-E — prospective application, restatement create, reconciliation, submit, withdraw (kpi-benefits-engineer; after KBE-C)

- **Files:**
  - `kpi/restatements.ts` (fill BE-A's stub; first): routes, create (lock 730266), get, list, withdraw;
  - `kpi/restatement-reconciliation.ts`: before/after per selected period, scope and basis through the DG4 KPI library, read-only and unchanged; the draft preview; the rows written at submit;
  - the submit transaction: the reconciliation rows, then the status, and the `kpi_restatement_to_decide` work items (dedupe `kpi_restatement:<restatementId>:<userId>`);
  - **the prospective lines** in `apps/worker/src/handlers/kpi.ts` (lines 862–866 as of `f591b7c`): the three non-actual triggers recalculate the latest **open** period only, ADR-0047 §1. This is subject to the orchestrator's decision on that reopen candidate; if it is declined, only `version_activated` changes;
  - `packages/shared/src/schemas/kpi-restatement.ts` (+ barrel line);
  - the `kpi_restatement.*` lines in `platform/db-errors.ts`;
  - tests.
- **Operations (6):** `listKpiRestatements`, `createKpiRestatement`, `getKpiRestatement`, `getKpiRestatementReconciliation`, `submitKpiRestatement`, `withdrawKpiRestatement`.
- **Consumes:** ADR-0047 §1, §2, §6–§9; ADR-0027/ADR-0028 (versions, periods, evaluations; the KPI library in `@mth/shared/calc` `kpi/**`, unchanged); `0085` guards.
- **Tests (literal):**
  - REQ-S07-016 (a): a target change approved through a DG4 change request and activated while Q2 is `scheduled` leaves Q1's latest evaluation and RAG unchanged, and the next opened period is evaluated with the new version.
  - Restating an open period gives 422 `kpi_restatement.period_not_closed`; a draft version gives 422 `kpi_restatement.version_not_approved`; 25 periods give 422 `kpi_restatement.too_many_periods`; a second restatement in progress gives 409 `kpi_restatement.open_exists`; submitting a draft whose periods have no value gives 422 `kpi_restatement.nothing_to_reconcile`.
  - The retained reconciliation equals the draft preview, and Unknown/stale rows carry no number.
  - Withdrawing a decided restatement gives 422 `kpi_restatement.not_withdrawable`.
  - AUD gets 403 on every write; `If-Match` gives 428/409; one audit event per row; commit-time re-authorization.

### G.2 KBE-E2 — decision with authority, recalculation once, reissue offers, the DG4 text (kpi-benefits-engineer; after KBE-E)

- **Files:**
  - `kpi/restatement-decisions.ts` and its registration line in `kpi/restatements.ts` (after KBE-E): `decideKpiRestatement` checks `kpi_restatement.approve` (403 `kpi_restatement.no_authority`), the requester (403 `kpi_restatement.self_decision`) and the recorded authority role, and writes the `kpi_restatement.approved` outbox event;
  - `apps/worker/src/handlers/kpi.ts` restatement lines and `apps/worker/src/queues/kpi.ts` (after KBE-E): `runOnce`, lock 730266, the one restatement run, the applied stamp, the reissue offers and the `report_reissue_offer` work items (dedupe `report_reissue_offer:<restatementId>:<seriesId>:<userId>`);
  - `kpi/restatement-offers.ts` (`listKpiRestatementReissueOffers`);
  - the `change_request.retrospective_not_supported` text line in `packages/shared/src/schemas/change-control.ts` (ADR-0047 §3, a DG4 text change the orchestrator decides). The en/ar `problems.json` key goes to the orchestrator for an append-only merge (§5.3);
  - tests.
- **Operations (2):** `decideKpiRestatement`, `listKpiRestatementReissueOffers`.
- **Consumes:** ADR-0047 §3, §6–§8; ADR-0045 §4 and §10 (reissue; `report_snapshot_version` `kpi_version` rows and `report_snapshot_source`); ADR-0025 (work items, `createWorkItemOnce`); `0085` guards.
- **Tests (literal):**
  - REQ-S07-016 (b): deciding a submitted Q1 restatement as a user without `kpi_restatement.approve` gives 403 `kpi_restatement.no_authority`, and as its requester 403 `kpi_restatement.self_decision`; both write nothing.
  - REQ-S07-016 (c): after approval, the Q1 report snapshot issued earlier returns its old content, versions and approval state; one reissue offer exists; `reissueReportSnapshot` plus issue gives `issueVersion` 2, and v1 is `superseded` with unchanged content.
  - Replaying the event three times writes one run and one set of offers.
  - Rejecting without a note gives 422 `kpi_restatement.note_required`.
  - AUD gets 403; `If-Match` gives 428/409; one audit event.

### G.3 KBE-F — formula preview, the finance functions, settings, cash flows and metrics (kpi-benefits-engineer)

- **Files:**
  - `kpi/formula-preview.ts` (fill BE-A's stub): calls `validateFormula`/`evaluateFormula` only (shared rule 9); the seeded examples come from `benefit_formula_example`;
  - `packages/shared/src/finance/**`: pure NPV, ROI and payback in decimal.js, with property tests;
  - its export line in `packages/shared/src/calc.ts`, after KBE-B's forms line and before KBE-G's health line (§5.3);
  - `benefits/financial-metrics.ts` (fill BE-A's stub): settings, enablement, assumptions, cash flows, metrics;
  - `packages/shared/src/schemas/financial-metrics.ts` (+ barrel line);
  - the `financial_metrics.*`/`financial_cash_flows.*` lines in `platform/db-errors.ts`;
  - tests.
- **Operations (8):** `previewFormula`, `getFinancialMetricSettings`, `putFinancialMetricEnablement`, `putFinancialMetricAssumptions`, `getBusinessCaseCashFlows`, `putBusinessCaseCashFlows`, `getBusinessCaseFinancialMetrics`, `listTransformationFinancialMetrics`.
- **Consumes:** ADR-0047 §4–§9; ADR-0024 §6 (engine codes and texts, unchanged); the DG3 `benefit_formula_example` rows (`0023`); `0085` guards.
- **Tests (literal):**
  - REQ-S08-005: `{exampleCode: "revenue_uplift"}` gives unit kind `currency`, currency `SAR`, and the edge case `arpu` missing → `not_computable` with `formula.missing_input`, never 0.
  - REQ-S08-019: with no settings row, or the extension off, the metrics status is `disabled`; enabled with assumptions but no discount rate gives `npv: null`, `npvReason: discount_rate_missing`; with 0.100000 and `beginning_of_period`, the fixture (outflow 1000 at t=0, inflows 300/400/500) gives NPV `-21.04`, `end_of_period` gives `-19.12`, ROI `0.200000` and payback index 3.
  - The response names the assumptions and `extension: true`.
  - Cash flows in USD for a SAR case give 422 `financial_cash_flows.currency_mismatch`.
  - ADM_METHOD can switch the extension but gets 403 on the assumptions; FIN gets 403 on the switch.
  - AUD gets 403 on every write; `If-Match "0"` creates and is 409 once a row exists.

### G.4 Migrations of slice G

`0085` and `0087` are delivered. Slice G needs no further migration. The one free number of the range, **`0088`**, belongs to §H (H.4).

### G.5 Integration order (slice G)

ARCH-05, then KBE-E after KBE-C, because it reads report snapshots for the reconciliation context, and its prospective lines touch `apps/worker/src/handlers/kpi.ts` before KBE-E2. Then KBE-E2 (after KBE-E, same worker file). KBE-F is independent of KBE-E. Its `calc.ts` line is merged after KBE-B's. FE-F (`pages/kpi-restatement/**`, `pages/formula-preview/**`, `pages/financial-metrics/**`) and QA-B (A07: restatement and snapshots intact) follow.

### G.6 Requirement → owner (the 3 rows of slice G)

| Requirement | Owner task(s) | Completes with |
|---|---|---|
| REQ-S07-016 | KBE-E (prospective rule, restatement, reconciliation), KBE-E2 (authority, recalculation, reissue offer) | FE-F (`pages/kpi-restatement/**`), QA-B (A07) |
| REQ-S08-005 | KBE-F (preview) | FE-F (`pages/formula-preview/**`) |
| REQ-S08-019 | KBE-F (finance functions, settings, cash flows, metrics) | FE-F (`pages/financial-metrics/**`) |

## §H. Slice H (90-day launch plan, Day-90 leadership test, 25-question health check, versioned scoring schemes, HealthAssessment) — T-DG5-ARCH-05

### H.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADR | `docs/architecture/adr/ADR-0048-p5-launch-plan-day-90-test-health-check-scoring-schemes.md` | Binding design, with the refusal codes and English texts (§9) |
| Migrations | `packages/db/migrations/0086_p5_launch_plans_health_checks.sql`, `0087_p5_kpi_launch_health_permissions.sql` | Probe 157/157 PASS (see §G.0) |
| Seeds | `launch_window` (3), `launch_template_item` (33), `day_ninety_question` (6), health-check scheme v1 (key `health-check`; yes/no and the four B0152 bands); work-item kind `day_ninety_test_due`; job schedule `launch.day_ninety_tests` | In `0086` |
| Studio element types | `health_response`, `health_band` in the element-type CHECK and `methodology_element_guard()` (`0086`); `CONFIG_ELEMENT_TYPES`, `ELEMENT_TYPES_BY_KIND.health_check_scheme` and `CONFIG_ELEMENT_ATTRIBUTES` in `packages/shared/src/schemas/studio.ts`; `ConfigElementType` in the contract | Pinned |
| Kysely types, catalogue and seed pins, permissions | as §G.0 (11 slice H tables) | Pinned |
| Lock classes | `launchPlan` 730267, `healthAssessmentSubmit` 730268 (taken by the `0086` triggers) | Registry test updated |
| Contract | 22 slice H operations (tags `launch-plans`, `day-90-tests`, `health-checks`) | `pnpm openapi:lint` PASS |
| Contract-test seams | `p5-pending-be-p.ts` (9), `p5-pending-be-p2.ts` (3), `p5-pending-kbe-g.ts` (3), `p5-pending-kbe-g2.ts` (7) | Contract test green |

The plan's BE-P and KBE-G are each split in two: **BE-P/BE-P2** (plan and tasks / the Day-90 test) and **KBE-G/KBE-G2** (scoring functions, the scheme kind provider and the reads / the assessments). Each pair has 10–12 operations, plus a worker job or a Studio provider.

### H.1 BE-P — the launch plan, tasks, predecessors, the template and the S12-004 port (backend-workflow-engineer; after BE-A; before BE-J's "with the plan flag" test)

- **Files:**
  - `launch/routes.ts` (fill BE-A's stub; first);
  - `launch/plan.ts`: generate under lock 730267 (33 tasks plus the `day_ninety_test` row; day *d* = start + *d* calendar days; the non-working-day flag from the ADR-0025 calendar, never a shift); the start-date change re-dates `not_started` tasks and an open test, with `last_shift_days`;
  - `launch/tasks.ts`: list, create, get, update, the status rules, output links;
  - `launch/predecessors.ts`: the replacement set, stamped removals, `blockedBy`;
  - `launch/template.ts`;
  - `launch/port.ts`: the `LaunchPlanPort` implementation; replay returns the existing plan;
  - its one registration line in `server.ts` (ADR-0044 §1);
  - `packages/shared/src/schemas/launch.ts` (+ barrel line);
  - the `launch_plan.*`/`launch_task.*` lines in `platform/db-errors.ts`;
  - tests.
- **Operations (9):** `getLaunchPlanTemplate`, `getLaunchPlan`, `generateLaunchPlan`, `updateLaunchPlan`, `listLaunchTasks`, `createLaunchTask`, `getLaunchTask`, `updateLaunchTask`, `putLaunchTaskPredecessors`.
- **Consumes:** ADR-0048 §1–§3, §7–§9; ADR-0044 §1 (the port signature and idempotency key); ADR-0025 (working-day calendar); `0086` guards.
- **Tests (literal):**
  - REQ-PB-086: with start 2026-10-01, the Days 31-60 tasks fall between 2026-11-01 and 2026-11-30, and all 17 B0134 actions appear verbatim (rejoined with `; `, they equal `launch_window.actions_source_en` without its final `.`).
  - REQ-S14-004: moving the start date by +7 days moves every unstarted task by 7 days and leaves completed tasks unchanged; a task whose predecessor is incomplete returns `blockedBy` naming it.
  - A loop gives 422 `launch_task.predecessor_cycle`; a second generate gives 409 `launch_plan.exists`; the port replayed three times gives one plan.
  - AUD gets 403 on every write; `If-Match` gives 428/409; one audit event per row.

### H.2 BE-P2 — the Day-90 leadership test and its task job (backend-workflow-engineer; after BE-P)

- **Files:**
  - `launch/day-ninety.ts`: the read with verbatim questions and evidence suggestions (≤ 5 per question from `evidence_record_types`, read through the owning modules' services), responses with `If-Match` of the test, completion;
  - its registration lines in `launch/routes.ts` (after BE-P);
  - `apps/worker/src/handlers/launch.ts` and `apps/worker/src/queues/launch.ts` (fill BE-A's stubs): job `launch.day_ninety_tests`, exactly once via `createWorkItemOnce` (dedupe `day_ninety_test:<testId>:<userId>`);
  - the `day_ninety_test.*` lines in `platform/db-errors.ts`;
  - tests.
- **Operations (3):** `getDayNinetyTest`, `putDayNinetyResponse`, `completeDayNinetyTest`.
- **Consumes:** ADR-0048 §4, §7–§9; ADR-0025 §3–§4 (job kit, work items, time zone); `0086` guards.
- **Tests (literal):**
  - REQ-PB-087: all six questions render verbatim (equal to B0136–B0141); with 5 responses the test reports `completion {answered: 5, total: 6, complete: false}`, and completing gives 422 `day_ninety_test.incomplete`.
  - A response after completion gives 422 `day_ninety_test.completed`.
  - The job run twice on day 90 creates one task per SP/TL holder.
  - AUD gets 403; `If-Match` gives 428/409; one audit event.

### H.3 KBE-G — scoring functions, the health-check scheme kind provider, questions and schemes (kpi-benefits-engineer; after BE-B3, the publish pipeline)

- **Files:**
  - `packages/shared/src/health/**`: pure score, band, completion and the scheme rules of ADR-0048 §6 in decimal.js, mirroring `p5_health_scheme_problem` and `p5_health_assessment_result` exactly, with property tests;
  - its export line in `packages/shared/src/calc.ts` (after KBE-F's, §5.3);
  - `health/routes.ts` (fill BE-A's stub; first);
  - `health/provider.ts`: `registerConfigKindProvider("health_check_scheme", { defaultKey: "health-check", validateElement, preview, compatibility, affectedRecords })`. The preview fails with the §9 `health_scheme.*` codes before the database does, and `affectedRecords` lists draft assessments. Its registration call in `server.ts` follows the `forms/provider.ts` precedent, one line;
  - `health/schemes.ts` and `health/questions.ts`;
  - the `health_scheme.*` lines in `platform/db-errors.ts`;
  - tests.
- **Operations (3):** `listHealthCheckQuestions`, `listHealthCheckSchemes`, `getHealthCheckScheme`.
- **Consumes:** ADR-0048 §5, §6, §9, §10; ADR-0039 §1–§5 (kinds, elements, the publish pipeline, `ConfigResolver`); ADR-0040 §2 (`invalidated_calculation`); `0086` guards and seed.
- **Tests (literal):**
  - REQ-S14-003: a draft scheme with `na` that keeps the source bands fails its preview with 422 `health_scheme.own_bands_required` and cannot be published; with its own bands and `percent_of_applicable` it publishes.
  - The 25 questions are returned verbatim; scheme v1 returns `implementationAssumption: true`.
  - The shared functions agree with the database function on 1,000 generated answer sets.

### H.4 KBE-G2 — assessments, the S16-021 group test, and `0088` (kpi-benefits-engineer; after KBE-G and BE-P)

- **Files:**
  - `health/assessments.ts`: create under the pinned scheme (`ConfigResolver`, else v1) with the previous submitted one; update; answers with `If-Match` of the assessment; actions; submit under lock 730268 with the score and band from `packages/shared/src/health/**`;
  - its registration lines in `health/routes.ts` (after KBE-G);
  - `packages/shared/src/schemas/health.ts` (+ barrel line);
  - the `health_check.*` lines in `platform/db-errors.ts`;
  - `apps/api/test/integration/health/s16-021-group.test.ts`;
  - **migration `0088`**: moves the `source_element` rows of sets `launch_window` and `health_question` to `feature_status = 'working'` (p5-work-split §A rule A-7). It is written only once BE-P and this task have shipped (F-DG4-160);
  - tests.
- **Operations (7):** `listHealthChecks`, `createHealthCheck`, `getHealthCheck`, `updateHealthCheck`, `putHealthCheckAnswer`, `putHealthCheckActions`, `submitHealthCheck`.
- **Consumes:** ADR-0048 §5, §7–§11; KBE-G's shared functions and provider; `0086` guards.
- **Tests (literal):**
  - REQ-PB-091: the 25 questions render verbatim; an assessment with an unanswered question is labelled incomplete and shows no band; submitting without three actions gives 422 `health_check.actions_required`.
  - REQ-S14-002: 24 answers give `completion {answered: 24, total: 25}` and `band: null`.
  - REQ-S14-001: 25 answers with 17 Yes give score `17` and band `16-20`, and `scoringAssumption: true`.
  - REQ-PB-092: scores 21, 16, 10 and 9 map to the four B0152 texts verbatim.
  - REQ-S14-003 (A07 part): an assessment submitted under v1 keeps v1, its score and its band after v2 is published and the pin migrated (ADR-0040).
  - REQ-S16-021: the group test creates and reads BAUHandover, Control, ControlCheck, ImprovementItem, Lesson and HealthAssessment through the API, with 403 for a caller without the write right and for AUD.
  - AUD gets 403; `If-Match` gives 428/409; one audit event.

### H.5 Migrations of slice H

`0086` and `0087` are delivered. **`0088`** is the only free number of the range, and it is KBE-G2's (H.4). A task that needs another migration asks the orchestrator for one from the repair range (`0094`+, D-145).

### H.6 Integration order (slices G and H)

1. ARCH-05.
2. BE-P (after BE-A; in the wave of BE-J, so BE-J's port test leaves `p5-pending-be-j`), then BE-P2.
3. KBE-G (after BE-B3; `calc.ts` after KBE-F), then KBE-G2, after KBE-G and BE-P because of `0088`.
4. KBE-E (after KBE-C), then KBE-E2.
5. KBE-F (independent).
6. FE-F: `pages/launch-plan/**`, `pages/day-90-test/**`, `pages/health-check/**`, `pages/health-schemes/**`, `pages/kpi-restatement/**`, `pages/formula-preview/**`, `pages/financial-metrics/**`. Its texts include the "Incomplete (n/total)" label, "Blocked by", the scoring-assumption notice, "Not computable" and "Extension, not a playbook requirement", in en and ar.
7. QA-D (A16) and QA-B (A07).

`server.ts` gets two one-line registrations, the `LaunchPlanPort` (BE-P) and the health provider call (KBE-G), merged append-only. `calc.ts` gets KBE-F's line, then KBE-G's.

### H.7 Requirement → owner (the 9 rows of slice H)

| Requirement | Owner task(s) | Completes with |
|---|---|---|
| REQ-PB-086 | BE-P (generation, dating, port) | FE-F (`pages/launch-plan/**`), QA-D (A16) |
| REQ-PB-087 | BE-P2 (test, responses, job) | FE-F (`pages/day-90-test/**`), QA-D |
| REQ-PB-091 | KBE-G2 (assessments, three actions, reassessments) | FE-F (`pages/health-check/**`), QA-D |
| REQ-PB-092 | KBE-G (bands), KBE-G2 (band on the assessment) | FE-F, QA-D |
| REQ-S14-001 | KBE-G (scoring), KBE-G2 (score, assumption flag) | FE-F (assumption notice), QA-D |
| REQ-S14-002 | KBE-G (completion), KBE-G2 (`band: null`) | FE-F ("Incomplete (24/25)"), QA-D |
| REQ-S14-003 | KBE-G (provider, schemes), KBE-G2 (assessments keep their scheme) | FE-F (`pages/health-schemes/**` through Studio), QA-D, QA-B |
| REQ-S14-004 | BE-P (tasks, owners, predecessors, re-dating) | FE-F, QA-D |
| REQ-S16-021 | KBE-G2 (HealthAssessment and the group test); DG4 entities already built | — |

### H.8 What the implementers of slices G and H must know

1. **Prospective means open periods only.** A KPI version changes a closed period only through an approved restatement (ADR-0047 §1). Never update or delete an evaluation; a restatement writes a new run.
2. **Authority is a business approval inside the product.** `kpi_restatement.approve` is decided by a person, never the requester, never an agent or a job, and never labelled with DG0–DG7.
3. **The reconciliation is retained, not recomputed.** It is written once, at submission, in the submitting transaction; reads of a submitted restatement return the stored rows.
4. **Issued reports never change.** A restatement only offers a reissue; the person reissues through ADR-0045 §4.
5. **The formula engine is untouched** (shared rule 9). Previews and the finance functions call it or sit beside it in `packages/shared/src/finance/**`.
6. **Extension, not a source requirement.** NPV, ROI and payback are off by default, always show their assumptions, and carry `extension: true`. No NPV without a discount rate; nothing is ever shown as 0 when it is not computed.
7. **Verbatim texts.** B0134 actions and outputs, B0136–B0141, B0150 and B0152 are rendered verbatim from the seeded rows (D-142 Q5). The Arabic texts are provisional translations, labelled so where the UI labels provisional translations.
8. **Calendar days, never a silent shift** (D-142 Q6). Show the non-working-day flag as a warning.
9. **Incomplete is not zero.** An assessment with an unanswered question has `score: null` and `band: null`; a Day-90 test with an unanswered question is incomplete.
10. **The database recomputes the score.** Submit the score and band from `packages/shared/src/health/**`; the database refuses any other value (`health_assessment_score_matches`).
11. **Schemes go through Studio.** Never write `methodology_element` rows of a published scheme; publish a new version and migrate the pin (ADR-0040). Existing assessments keep their scheme forever.
12. **No digits in codes the database checks.** Work-item kinds, job codes, permission codes and audit actions match `^[a-z_]+…`; that is why the tables are `day_ninety_*` and the permission is `day_ninety_test.respond`. API paths and problem-code texts may say "Day-90".
