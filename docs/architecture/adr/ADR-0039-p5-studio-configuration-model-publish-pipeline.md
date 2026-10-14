# ADR-0039: Playbook Studio configuration model: stable identities and version-scoped attributes, configuration kinds and pins, ConfigResolver, drafts, preview/test, review where configured, publish, diff, compatibility, source-completeness gate, invariant protection, rollback as a new version, and the "revision proposed" starter

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-01), 2026-10-13.
- **Requirements (slice A of `docs/architecture/p5-plan.md`, this ADR's part):** REQ-S02-001, REQ-S06-004, REQ-S06-006, REQ-S06-007, REQ-S06-009, REQ-S06-010, REQ-S12-018; the MethodologyVersion, Phase and GateDefinition part of REQ-S16-012 (§10); the configuration half of REQ-PB-093 (the scoring-defaults kind; ADR-0040 §5 has the rest). ADR-0040 covers REQ-S06-008 (migration of a pinned transformation).
- **Sources (quoted where a design point has one):**
  - M0154 (§6): "Provide an administrator Playbook Studio that can edit methodology text, phases, gates, mandatory artifacts, checklists, templates, fields, labels, help text, validation, formulas, routing, approvers, reminders, escalation rules, dashboards and reporting layouts through the UI. … Protect stable system identifiers and core data invariants."
  - M0155 (§6): "Publishing a configuration follows Draft → Preview/Test → Review where configured → Publish. Show a side-by-side diff, affected records and compatibility checks. Keep published versions immutable. … Rollback means restoring a prior configuration version through an audited change; it does not erase subsequent business transactions."
  - M0156 (§6): "Owners update their assigned data; methodology admins publish shared rules; only authorized business approvers approve policy or financial changes."
  - M0083 (§2): "Preserve the two usage modes, six phases, six gates, sixteen numbered templates, ten TOM dimensions, governance cadence, benefits lifecycle, 90-day launch plan, roaming example and 25-question health check."
  - M0238 (§12, starter): "Methodology or formula revision is proposed | Show impact, run validation and route the change for the configured review".
  - M0176 (§9): "Make scoring rubrics and approved weights configurable and versioned."
  - Playbook B0009 (two modes), B0021 (phases), B0023 (gates G1–G6), B0030…B0129 (Templates 1–16), B0056 (TOM dimensions), B0093 (governance cadence, five layers), B0121 (benefits lifecycle, six steps), B0134 (three launch windows), B0143 (roaming example), B0150 (25 questions), B0076/B0077 (T06 weights).
- **Decisions applied:** D-141 (P5 starts with the plan; carried rules), D-142 (the plan adopted; **Q1** stable identities vs version-scoped rows; **Q4** "create" for fixed catalogue entities; **Q12** Studio default weights, reopen scoped to `p3_instantiate_transformation`); D-088 §2 and F-DG3-100 (claims enumerated and exactly true).
- **Builds on:** ADR-0003 (persistence, optimistic concurrency), ADR-0004 (audit), ADR-0006 (authorization, technical admins never approve), ADR-0007 (API conventions, §5b statuses), ADR-0014 (configuration versioning outline), ADR-0016 (P2 guards, lock registry), ADR-0020 (role catalogue), ADR-0022 (T06 weight sets), ADR-0024 (formula engine, unchanged), ADR-0026 (canonical approval, work items), ADR-0035 (phases), ADR-0036 (material-change port).
- **Physical model:** `0062_p5_config_versions.sql`, `0063_p5_pins_methodology_migrations.sql` (pins; ADR-0040), `0064_p5_studio_permissions_source_inventory.sql`. Probe ids (MV, ME, RR, RP, RV, SD, SE, G) refer to `docs/delivery/handbacks/DG5/T-DG5-ARCH-01-evidence/probe-output.txt`.
- **Two gate systems.** Product gates G1–G6 are business approvals inside the product. Nothing in this ADR reads or writes the engineering records DG0–DG7. A Studio review is a configuration review, not a business approval; publishing configuration never grants business-approval rights (§9).

## Context

As built on `HEAD` `b30fa5b` (DG4 APPROVED):

1. `methodology_version` (`0011`) holds one row: key `playbook`, version 1, `published`, an object `definition`, a content hash; a trigger refuses a change of `definition`, `content_sha256`, `key` or `version_no` once the status is not `draft`; the CHECK `methodology_version_published_complete` ties `status = 'draft'` to `published_at IS NULL`; `mth_app` had SELECT only.
2. The catalogue rows (`gate_definition`, `gate_criterion_definition`, `tom_dimension`, `diagnostic_dimension`, `diagnostic_workstream`, `charter_scope_check_definition`, `good_outcome_criterion`, `phase_definition` (`0051`), `forum_template` (`0044`), `benefit_formula_example` (`0023`)) have globally UNIQUE codes and one value per code.
3. `transformation_config_pin` (`0011`) has `kind CHECK (kind IN ('methodology'))`; `p2_instantiate_transformation` (`0018`) pins a new transformation to the newest published `playbook` version (`ORDER BY version_no DESC LIMIT 1`).
4. The T06 default weights 25/25/20/15/15 are literals inside `p3_instantiate_transformation` (`0024`, `0025`), with `approval_basis = 'source_default'`; no rubric descriptor is stored anywhere.
5. `PATCH /methodology/tom-dimensions/{dimensionCode}` (`methodology.configure`) edits TOM labels in place (DG2); its trigger allows label and Arabic columns only.

## Decision

### 1. Configuration kinds and the version header (REQ-S06-004, REQ-S06-007)

`methodology_version` becomes the version header of every Studio configuration kind (additive columns, `0062`):

| Column | Meaning |
|---|---|
| `config_kind` | `methodology` (default; the DG2 row), `scoring_defaults` (this ADR, PB-093), `form_schema` (ADR-0041), `procedure` (ADR-0042), `automation_rule_set` (ADR-0043/0044), `health_check_scheme` (ADR-0048). The last four are declared now so pins and reviews can name them; their element types are added by their ADRs (§2). |
| `draft_stage` | `editing`, `preview`, `review`, `approved`, `discarded`; NULL exactly when `status <> 'draft'` (CHECK `methodology_version_draft_stage_complete`). |
| `origin` | `seed` (migration rows), `draft` (Studio), `rollback` (§7). |
| `based_on_version_id` | the published version of the same kind and key a draft starts from (required unless `seed`). |
| `rollback_of_version_id`, `change_summary` | the restored version and the reason (both required for `rollback`). |
| `discarded_at` | set exactly when the stage is `discarded`. |

Versions are platform-wide (no organization column), like the DG2 catalogue. A key belongs to one kind (`methodology_version_kind_key`). `version_no` of a new draft is the next number of its key (`methodology_version_next_number`; MV01, MV03); a discarded draft keeps its number, so numbers can have gaps. At most one open (not discarded) draft per kind and key (unique index `methodology_version_one_open_draft_key`; MV03). Rows with `origin = 'seed'` are inserted by migrations only (`methodology_version_seed_only`; MV04). `methodology_version` and `methodology_element` now carry the P2 guards: version step +1 (MV05) and the deferred audit check (MV02, ME11).

**State machine** (trigger `methodology_version_studio_guard`; the DG2 trigger and CHECK are kept):

```text
status:      draft -> published -> retired            (P5 has no retire operation; 'retired' stays unused)
draft_stage: editing -> preview | discarded
             preview -> editing | review | approved | discarded     (approved directly only when no review is required)
             review  -> editing | approved | discarded
             approved -> editing | discarded
             approved + publish -> status 'published', draft_stage NULL
```

Database invariants: kind, key, version_no, origin, lineage and source columns never change (`methodology_version_identity_fixed`); content (`definition`, `content_sha256`, titles, `change_summary`) changes only in `editing`/`preview` and returns the stage to `editing` (`methodology_version_content_frozen`; MV13, MV19); entering `preview`, `review` or `approved` needs a `pass` preview run for exactly the current `content_sha256` (`methodology_version_preview_required`; MV08, MV09); entering `approved` needs, when the kind's policy requires review, an `approved` review request for exactly that hash (`methodology_version_review_required`; MV11); publishing needs stage `approved`, a named `published_by` (`methodology_version_publish_ready`; MV17), and for exactly that hash a `pass` preview run plus a `pass` or `warn` compatibility run and (methodology kind) source-coverage run (`methodology_version_checks_required`; MV15, MV16, MV18); a published version never returns to draft (MV20) and its content never changes (MV06, MV19).

**Content hash.** The API computes `content_sha256` for every Studio version as SHA-256 (hex) of the UTF-8 bytes of the canonical JSON of `{definition, titleEn, titleAr, elements}`, where `elements` is the array of the version's `methodology_element` rows as `{elementType, stableKey, origin, removed, ordinal, attributes}` sorted by `(elementType, stableKey)`, and canonical JSON sorts object keys by code point and has no insignificant whitespace (numbers in definitions and attributes are integers; decimals are strings). Every element write recomputes it and steps the version row (one audit event each). A seeded version's hash is an opaque identity set by its migration and is never recomputed or compared across versions; diffs compare content, not hashes.

### 2. Stable identities and version-scoped attributes (D-142 Q1; REQ-S06-006)

The DG2–DG4 catalogue rows stay the **stable-identity registry**; their `code`/`key` never change and no P5 migration alters their constraints. Versioned attributes live in **`methodology_element`** (`0062`): `(methodology_version_id, element_type, stable_key)` UNIQUE, `origin` (`source` = an identity from the sources, `admin` = added in Studio), `removed`, `ordinal`, `attributes` (JSON object, validated by the API per element type with Zod; never an unvalidated blob), P2 stamps, `version`.

- **Element types per kind** (trigger `methodology_element_guard`, `methodology_element_kind_type`; ME10): `methodology`: `methodology_text`, `phase`, `gate`, `gate_criterion`, `mandatory_artifact`, `checklist_item`, `template`, `tom_dimension`, `approver_route`, `reminder`, `escalation_rule`, `dashboard`, `report_layout`, `source_element`; `scoring_defaults`: `scoring_weight`, `scoring_rubric`. The other four kinds accept no element type until their ADR widens the CHECK and the trigger's list (a reopen of nothing: those ARCH tasks own the change).
- **Attribute shapes (Zod, `packages/shared/src/schemas/studio.ts`, BE-A):** every type accepts `labelEn`, `labelAr`, `helpEn`, `helpAr` (free text, the shared rules, 1–200 and 1–2000); `gate` adds `defaultApproverRoleCode` (must be one of the gate's DG2 `allowed_approver_role_codes`, refused 422 `config_version.approver_not_allowed`), `submissionEnabled`; `approver_route` (stable key `<recordType>.<action>`, e.g. `gate.G2`, `t13.submission`) has `approverRoleCode` or `approverRoleCodes[]` and `mode` (`any` | `sequential` | `parallel`; sequential/parallel are executed by ADR-0044); `checklist_item`/`mandatory_artifact` have `gateCode` or `phaseCode`, `mandatory`; `reminder`/`escalation_rule` have `offsetWorkingDays` (integer 0–250) and `recipientRoleCode`; `dashboard`/`report_layout` have `sections[]` of stable section keys; `methodology_text` has `bodyEn`/`bodyAr` (1–20000); `scoring_weight` has `weightPercent` (decimal string, §5); `scoring_rubric` has `levels[5]` of `{score 1..5, descriptorEn|null, descriptorAr|null}`.
- **Resolution.** For a version V, the attributes of `(type, key)` are V's row when it exists, else the catalogue's values. A new draft **copies every element row of its base version** (so a version's rows are complete with respect to its lineage); a rollback draft copies the rows of the restored version (§7).
- **Fixed identity sets (REQ-S02-001, REQ-S06-006, D-142 Q4).** Rows of type `phase`, `gate`, `tom_dimension` must be `origin = 'source'` and never `removed` (CHECK `methodology_element_fixed_sets`; ME03, ME04): a seventh gate, an eleventh TOM dimension or a seventh phase is not creatable, and none of the six/six/ten can be removed. A `source` row must name an existing identity: `phase_definition.code`, `gate_definition.code`, `tom_dimension.code`, `gate_criterion_definition.key`, a `source_element` template key, or `<set>.<key>` of `source_element` (`methodology_element_source_identity`; ME09). Version, type, stable key and origin never change (`methodology_element_identity_fixed`; ME02).
- **Removal of other source elements** (a template, a forum, a lifecycle step, a launch window, the roaming example, a health question) is recorded in the draft (`removed = true`; ME08) and makes the source-coverage check `fail`, which blocks publish (§6; MV16). This is how REQ-S02-001's "deleting a template in a draft methodology makes the check fail and blocks publish" and REQ-S06-006's "deleting a TOM dimension … is rejected" both hold literally.
- **No technical admin or auditor as an approver (REQ-S06-006, REQ-S10-003).** Any `approverRoleCode`, `defaultApproverRoleCode` or `approverRoleCodes[]` must name an existing role whose kind is not `technical_admin` and which is not `AUD` (`methodology_element_no_admin_approver`; ME05, ME06). ME07 (BO) commits.
- Elements are written only into a draft in `editing` or `preview` (`methodology_element_draft_only`; ME12); the migration role may write seeds.
- The DG2 `PATCH /methodology/tom-dimensions/{dimensionCode}` is unchanged (it edits the catalogue label in place, as approved at DG2). Studio label changes go into a draft version instead; `listConfigElements` shows both the catalogue label and the version's.

### 3. ConfigResolver and pins (REQ-S06-008 groundwork; ADR-0040 has the migration)

`transformation_config_pin.kind` CHECK is widened to the six kinds (`0063`, additive; the DG2 pins are unchanged, probe G04). Trigger `transformation_config_pin_guard`: a pin names a version of its own kind (`transformation_config_pin_kind_matches`; PN02, PN03); a new pin names a published version; the kind never changes; the pinned version moves only through an approved migration (ADR-0040 §1; PN01).

**`ConfigResolver`** (port in `apps/api/src/modules/methodology/config-resolver.ts`, BE-A; wired in `server.ts`):

```ts
interface ConfigResolver {
  /** The version a transformation uses for a kind: its pin; with no pin of that kind, version 1 of the kind's
   *  default key ('playbook', 'scoring-defaults', and the keys ARCH-02..05 name) — never "the latest". */
  pinnedVersion(db: DbOrTx, transformationId: string, kind: ConfigKind): Promise<{ versionId: string; versionNo: number; key: string }>;
  /** The resolved attributes of one element of a version (row, else catalogue); null when the identity is unknown. */
  element(db: DbOrTx, versionId: string, type: ElementType, stableKey: string): Promise<ResolvedElement | null>;
  /** All resolved elements of a type, catalogue order then admin-added by ordinal; removed ones excluded unless asked. */
  elements(db: DbOrTx, versionId: string, type: ElementType, o?: { includeRemoved?: boolean }): Promise<ResolvedElement[]>;
  /** Preview/test only: resolve as if `transformationId` were pinned to `draftVersionId` (never persisted). */
  withDraft(draftVersionId: string): ConfigResolver;
}
```

`methodology` imports no other module; `forms`, `procedures`, `automation`, `workflows`, `health`, `reporting`, `portfolio` call the port (p5-plan §2). **Pinned v1 is byte-identical:** for a transformation pinned to `playbook` v1 every reader returns exactly the DG2–DG4 catalogue values, because v1 has no element rows; BE-C adds a v1 regression suite per rewired reader (p5-plan R2). New transformations get the newest published methodology version through the DG2 function, unchanged (Context 3), and a `scoring_defaults` pin through KBE-A's `0065` (ADR-0040 §5).

### 4. Drafts and the Studio edit surface (REQ-S06-004)

A methodology admin (`methodology.configure`) creates a draft from a published version (`createConfigDraft`), edits title/summary/definition (`updateConfigDraft`), puts or removes elements (`putConfigElement`, `removeConfigElement`) and may discard it (`discardConfigDraft`). Every write: commit-time re-authorization, Zod validation, `If-Match` on the **draft's** version (409 stale, 428 missing), one audit event (`methodology_version.*`, `methodology_element.*`), lock class 730250 on `"<kind>:<key>"`, no remote I/O. The S06-004 element list maps as: methodology text → `methodology_text`; phases → `phase`; gates → `gate`; mandatory artifacts → `mandatory_artifact`; checklists → `checklist_item`; templates → `template`; labels and help text → the common attributes; formulas → formula references inside `dashboard`/`report_layout`/`scoring_*` attributes, and benefit/KPI formulas keep their DG3/DG4 versioned records (the S12-018 path, §8); routing and approvers → `approver_route` and `gate.defaultApproverRoleCode`; reminders → `reminder`; escalation rules → `escalation_rule`; dashboards → `dashboard`; reporting layouts → `report_layout`; **fields and validation → the `form_schema` kind (ADR-0041)**, published through this pipeline. REQ-S06-004's acceptance therefore completes with slice B (the T13 field and the changed validation rule) and slice E (routing of non-gate submissions through approval routes, ADR-0044); slice A delivers the pipeline, the gate approver route (BE-C reader) and the resolver.

### 5. Preview/Test, compatibility, affected records, diff, review, publish (REQ-S06-007)

- **Preview/Test sandbox** (`runConfigPreview`, `methodology.publish`): the API runs, in a READ ONLY transaction that is rolled back, the kind's invariant checks, the sample inputs the admin supplies (records validated against the draft's form schemas, formulas evaluated through the DG3 engine unchanged, sample submissions routed through the draft's approver routes) with `ConfigResolver.withDraft`, then records one append-only `config_check_run` (`check_kind = 'preview'`, the content hash, `pass`/`fail`, a JSON report) in a separate write transaction and, on `pass`, moves the stage `editing → preview`. Nothing else is written.
- **Compatibility** (`runConfigCompatibilityCheck`): classifies every element change against the base: label/help only → compatible; new required field, removed element, changed formula reference, changed approver → `warn` with the affected pinned transformations listed (they stay pinned; ADR-0040 maps them); an unknown reference (a role, gate, phase, template or criterion that does not exist), an invariant break, or an element the kind's provider rejects → `fail`. `pass`/`warn` are publishable; `fail` is not.
- **Affected records** (`getConfigAffectedRecords`): per pinned transformation of the base lineage, counts per record type the draft's changed elements touch (e.g. T13 records for a T13 field), computed live; Unknown counts are shown as Unknown, never 0.
- **Diff** (`getConfigVersionDiff?against=`): side-by-side, per `(elementType, stableKey)`: `added`, `removed`, `changed` with field-level `from`/`to` of the resolved attributes, plus title/definition changes; the kind provider supplies the rows for its own tables (ADR-0041 lists added fields, which is REQ-S06-007's "the diff lists the added field").
- **Review where configured** (`config_review_policy`, one row per kind, seeded `review_required = true`, reviewer `TO`; `benefit_formula` row reviewer `FIN`, §8): `submitConfigReview` (stage `preview → review`) creates a `config_review_request` for the current hash, a `revision_proposal` (§8) and one `config_review` work item per active holder of the reviewer role in the organization; `decideConfigReview` (`methodology.review`) approves (stage → `approved`) or requests changes (note required; stage → `editing`); `withdrawConfigReview` (stage → `editing`). Database: one pending request per version, only the decision columns move, the reviewer is never the requester (CHECK) nor the draft's author (trigger) (RR01–RR03); the policy's reviewer is never `AUD` (CHECK) nor a technical admin (trigger) (RP01, RP02). For a kind whose policy has `review_required = false`, `publishConfigVersion` on a draft in `preview` performs both steps in one transaction (stage `preview → approved`, then published; two version steps, two audit events).
- **Publish** (`publishConfigVersion`, `methodology.publish`, lock 730251 on `"<kind>:<key>"`): re-runs nothing implicitly; it checks the stored runs and review for the exact hash (the database refuses otherwise, §1), sets `published_at/by`, and writes `methodology_version.publish` to the audit trail. Published versions are immutable: any write to one returns 409 `config_version.not_editable`.

### 6. The source-completeness gate (REQ-S02-001)

`source_element` (`0062`, seeded in `0064`; `mth_app` SELECT only) lists the 80 counted source elements with stable key, verbatim English source label, provisional Arabic label, block reference, the implementing feature and `feature_status`: 2 modes (B0009), 6 phases (B0021), 6 gates (B0023), 16 templates (B0030…B0129), 10 TOM dimensions (B0056), 5 forums (B0093), 6 lifecycle steps (B0121), 3 launch windows (B0134), 1 roaming example (B0143), 25 questions (B0150) (probe SE01). `getSourceCoverage?versionId=` reports per set the expected count, the count present in the resolved version (source elements not `removed`), and the elements whose `feature_status` is `planned`; `runSourceCoverageCheck` (`source_coverage.run`, ADM_METHOD) records the result as a `source_coverage` check run: **`fail`** when any set's present count differs from its expected count; else **`warn`** when an element's feature is `planned`; else **`pass`**. Publishing a methodology version needs a `pass` or `warn` run for its hash (§1), so deleting a template in a draft blocks publish (MV16). At this commit launch windows, the roaming example and the 25 questions are `planned`; BE-P, BE-T and KBE-G move their rows to `working` in a migration of their own range when their feature ships (p5-work-split §A rule A-7). The report labels are bilingual; the counts are integers, never decimals.

### 7. Rollback as a new version (REQ-S06-009)

`rollbackConfigVersion` on a published version P (not the newest of its key), with a reason (3–4000, free-text rules): creates a draft of the same key with `origin = 'rollback'`, `rollback_of_version_id = P`, `based_on_version_id` = the newest published version, `change_summary` = the reason, the content (definition, titles, element rows) of P, and the next `version_no` (MV21, MV22). It then follows the same pipeline (preview, review where configured, publish). Nothing is deleted or edited: earlier versions, pins and every business record created under any version stay as they are and stay readable; the audit trail has `methodology_version.rollback_create` and later `methodology_version.publish` naming the restored version. Transformations pinned to the rolled-back version keep their pin until a migration (ADR-0040).

### 8. The "revision proposed" starter (REQ-S12-018, M0238)

`revision_proposal` (`0062`, append-only, audited): `subject_type` (`methodology_version` | `benefit_formula_version`), `subject_id`, `subject_version`, `content_sha256`, `validation_result` and report, `impact` (JSON: affected transformations, record counts, and **affected benefits**), `reviewer_role_code`, `review_task_count`, and `dedupe_key = "<subject_type>:<subject_id>:<content_sha256>"` (UNIQUE and CHECKed; RV01, RV02). Exactly once: inserted with `ON CONFLICT ON CONSTRAINT revision_proposal_dedupe_key DO NOTHING`; work items use dedupe key `config_review:<proposalId>:<userId>` (the DG4 `work_item_dedupe_key`), so a replay creates nothing (RV01).

1. **Methodology/configuration revision:** in the `submitConfigReview` transaction: validation = the latest preview and compatibility runs for the hash; impact = §5's affected records plus benefits whose formulas or scoring the change touches; routing = the policy's reviewer role; tasks = `config_review` work items.
2. **Formula revision** (DG3 `createBenefitFormulaVersion`, a new version starts `unvalidated`): the composition root wraps the DG4 material-change port so that `benefitFormulaVersionCreated` also calls `methodology/revision-impact.ts` in the same transaction; it validates the expression with `validateFormula` (engine unchanged), lists the benefits bound to the formula as the impact, and creates `config_review` work items for holders of the `benefit_formula` policy's reviewer role (`FIN`) in the transformation — the people who record the DG3 Finance validation. The DG3 request and response are unchanged; the DG4 automatic change request still happens as before.

REQ-S12-018's acceptance ("proposing a formula change lists affected benefits and creates a review task") is case 2. The work-item kind `config_review` (`0063`) is shown in My Work under **Reviews** (`MY_WORK_SECTION_BY_KIND`, ADR-0037 §7, one added line).

### 9. Authorization (REQ-S06-010; permissions matrix "P5 slice A")

`P5_STUDIO_PERMISSIONS` (`0064`; seed test): `methodology.read` (read: SP, TL, TO, AUD, ADM_METHOD), `methodology.publish` (configure: ADM_METHOD), `methodology.review` (write: TO), `config_review_policy.configure` (configure: TO), `source_coverage.run` (configure: ADM_METHOD), `methodology_migration.plan` and `.execute` (configure: ADM_METHOD), `methodology_migration.approve` (**business_approval**: SP only; SE03, SE04). TL holds no business-approval code: the DG1 creator-derived assignment (`0008`, ADR-0006) never derives a role that holds one, and TL is granted at business-unit scope, so an approval code on TL would remove its access to the transformations it creates (found by the integration suite of this task; ADR-0040 §4). The existing `methodology.configure` (ADM_METHOD, DG2) authorizes draft edits.

| Operation group | Permission | Notes |
|---|---|---|
| list/get versions, elements, diff, runs, reviews, affected records, source coverage, review policies, revision proposals | `methodology.read` | AUD reads all, writes nothing (403 on every write). |
| create/update/discard draft, put/remove element, scoring-defaults draft | `methodology.configure` | ADM_METHOD |
| preview, compatibility, submit/withdraw review, publish, rollback | `methodology.publish` | ADM_METHOD |
| decide review | `methodology.review` | TO; never the author or requester (403 `config_review.self_review`) |
| update review policy | `config_review_policy.configure` | TO: an admin cannot switch off the review of its own changes |
| run source coverage | `source_coverage.run` | ADM_METHOD |

Separation (REQ-S06-010, M0156): ADM_METHOD, ADM_TECH and ADM_ACCESS hold no `business_approval` or `finance_validation` code (the `0005` trigger refuses it; SE04), so a methodology admin who publishes a form change gets 403 on `decideApproval` for a funding reallocation (it lacks `approval.decide`) and on `funding.approve`; a KPI owner (BO, KDS) updates assigned KPI actuals (DG4) and gets 403 on every Studio write (it lacks `methodology.configure`/`.publish`). Configuration review is not a business approval: `methodology.review` is a `write` code.

### 10. REQ-S16-012 entity group

| Entity | Table (PK `id`) | Owner column | Status | Create / read through the API |
|---|---|---|---|---|
| Transformation | `transformation` (`0002`) | `created_by` | `status` (draft, active, on_hold, closed) | DG1 `createTransformation` / `getTransformation` |
| PerformanceArea | `performance_area` (`0048`) | `kpi_owner_user_id`, `bau_owner_user_id` (`created_by`) | `status` | DG4 `createPerformanceArea` / `getPerformanceArea` |
| Charter | `charter` (`0013`; versions in `charter_version`) | `transformation_lead_user_id` (`created_by`) | none (not applicable: every saved change appends an immutable `charter_version`; G1–G3 approve it through the gates) | DG2 `createCharter` / `getCharter` |
| MethodologyVersion | `methodology_version` | `created_by` (`published_by`) | `status`, `draft_stage` | **`createConfigDraft`** / `getConfigVersion` (D-142 Q4) |
| Phase | `phase_definition` + `methodology_element(type 'phase')` | `created_by` of the element | version status | **`putConfigElement` (phase) in a draft** / `listConfigElements?elementType=phase` (D-142 Q4: a version-scoped row of an existing identity; a seventh phase is refused) |
| GateDefinition | `gate_definition` + `methodology_element(type 'gate')` | as Phase | version status | **`putConfigElement` (gate)** / `listConfigElements?elementType=gate` |
| GateInstance | `gate_instance` (`0017`) | `created_by` | `status` | DG2 instantiation / `getGate` |
| GateDecision | `gate_decision` (`0017`) | `decided_by` | `outcome` | DG2 `decideGate` / gate history |

BE-C writes the entity-group integration test (create and read each, AUD 403 on write, 404 outside scope).

### 11. Locks, events, jobs

Lock classes (ADR-0016 §6 registry): **730250** `configDraft` (key `"<configKind>:<key>"`): every draft, element, preview, compatibility, review-submit/withdraw/decide and discard write; **730251** `configPublish` (same key): publish and rollback-create; **730252** `methodologyMigration` (ADR-0040); **730253** reserved. Outbox events (schema_version 1): `methodology_version.published` `{versionId, kind, key, versionNo}`, `config_review.requested` `{reviewRequestId, versionId}`. No new job; no scheduled work.

### 12. Decimal and Unknown

Weights are `weightPercent` decimal strings `^(100(\.0{1,2})?|[0-9]{1,2}(\.[0-9]{1,2})?)$` and > 0 (`methodology_element_weight_decimal`; SD01); totals are summed with decimal.js in the API and with `numeric` in the database (`methodology_version_weights_total`; SD02); nothing is a float. Missing rubric descriptors are `null` and render "No descriptor defined", never an invented text or 0. Counts in coverage and affected-records reports are integers; an uncountable set is reported as Unknown with a reason, never 0.

### 13. Refusal codes and English texts (exact)

| Status | Code | English text (exact) |
|---|---|---|
| 409 | `config_version.not_editable` | This configuration version is published or no longer being edited. Create a new draft to change it. |
| 409 | `config_version.draft_exists` | A draft of this configuration already exists. Continue it or discard it first. |
| 422 | `config_version.stable_id_change` | Stable identifiers cannot be changed. Change the label instead. |
| 422 | `config_version.source_element_protected` | Source phases, gates and TOM dimensions cannot be added or deleted. |
| 422 | `config_version.unknown_element` | This element does not exist in the methodology. |
| 422 | `config_version.admin_approver_forbidden` | An administrator role or the auditor cannot be configured as an approver. |
| 422 | `config_version.approver_not_allowed` | This role is not an allowed approver for this gate. |
| 422 | `config_version.preview_required` | Run a successful preview and test of the current draft first. |
| 422 | `config_version.review_required` | This change needs an approved review before it can be published. |
| 422 | `config_version.checks_required` | Run the compatibility and source-coverage checks for the current draft first. |
| 422 | `config_version.compatibility_failed` | The compatibility check failed. Resolve the listed problems before publishing. |
| 422 | `config_version.source_incomplete` | The source-completeness check failed: an element set is incomplete. Publishing is blocked. |
| 422 | `config_version.weights_total` | Default weights must total exactly 100% over 2 to 6 criteria. |
| 422 | `config_version.rollback_target_invalid` | Only an earlier published version of the same configuration can be restored. |
| 403 | `config_review.self_review` | You cannot review a configuration change you authored or requested. |
| 422 | `config_review.reviewer_not_allowed` | The auditor or an administrator role cannot be the configured reviewer. |
| 400 field | `validation.weight_percent` | Enter a weight as a percentage with at most two decimals, greater than 0 and at most 100. |

## Alternatives considered

1. **Widen the DG2 catalogue keys to per-version uniqueness** (one catalogue row per version). Rejected by D-142 Q1: it changes DG2 constraints and every DG2–DG4 reader at once.
2. **One unvalidated JSON `definition` per version holding everything.** Rejected: §16 forbids an unvalidated blob, element-level diff and invariants need typed identity, and the database could not protect stable identifiers.
3. **A separate `config_version` table for the new kinds.** Rejected: pins already reference `methodology_version`; a second header would need a nullable second foreign key on the pin and a DG2 NOT NULL change.
4. **A `review` status inside `methodology_version.status`.** Rejected: the DG2 CHECK `methodology_version_published_complete` ties every non-draft status to `published_at`; a separate `draft_stage` keeps it unchanged.
5. **Rollback by re-pointing pins or reactivating the old row.** Rejected by M0155: rollback is an audited new change that erases nothing.
6. **Refuse template deletion immediately (like TOM dimensions).** Rejected: REQ-S02-001's acceptance requires the deletion to be possible in a draft and the completeness check to block publish.

## Consequences

- `methodology_version` gets INSERT and UPDATE for `mth_app` and the P2 guards; the seeded rows predate the guards and are unchanged (probe G04, G05).
- Every reader rewired through `ConfigResolver` keeps v1 output byte-identical (BE-C's regression suite; p5-plan R2).
- Slices B–E and H register their kinds' element types and providers; until they do, those kinds accept no elements (§2).
- REQ-S06-004 completes with slices B and E (§4); REQ-S12-018 completes with BE-B3's two triggers (§8).

## Verification

- **Database (probe, real output):** G00–G05, SE01–SE04, MV01–MV23, ME01–ME12, RR01–RR03, RV01–RV04, SD01–SD02, RP01–RP03 (`probe-output.txt`).
- **API (implementer tests, p5-work-split §A):** renaming G3's label in a draft succeeds and changing its stable key, deleting a TOM dimension or configuring ADM as approver are rejected with the §13 codes; publish without required review → 422 `config_version.review_required`; editing a published version → 409 `config_version.not_editable`; the diff lists an added element; deleting T13 in a draft → coverage `fail` → publish 422 `config_version.source_incomplete`; coverage report shows 2/6/6/16/10/5/6/3/1/25; rollback creates a new version and earlier records stay retrievable with the rollback in the audit trail; a formula revision lists the affected benefits and creates a review task, exactly once on replay ×3; ADM_METHOD 403 on a funding-reallocation approval; BO 403 on Studio writes; AUD 403 on every write; `If-Match` 428/409; one audit event per mutation.
