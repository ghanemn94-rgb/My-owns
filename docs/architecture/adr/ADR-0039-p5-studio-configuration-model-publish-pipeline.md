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
- **Review where configured** (`config_review_policy`, one row per kind, seeded `review_required = true`, reviewer `TO`; `benefit_formula` row reviewer `FIN`, §8): `submitConfigReview` (stage `preview → review`) creates a `config_review_request` for the current hash, a `revision_proposal` (§8) and one `config_review` work item per active holder of the reviewer role in the organization; `decideConfigReview` (`methodology.review`) approves (stage → `approved`) or requests changes (note required; stage → `editing`); `withdrawConfigReview` (stage → `editing`). Database: one pending request per version, only the decision columns move, the reviewer is never the requester (CHECK) nor the draft's author (trigger) (RR01–RR03; _amended 2026-10-18, T-DG5-ARCH-R4: "author" means the draft's creator or any recorded contributor, and review tasks skip every author; see amendment F1–F4_); the policy's reviewer is never `AUD` (CHECK) nor a technical admin (trigger) (RP01, RP02). For a kind whose policy has `review_required = false`, `publishConfigVersion` on a draft in `preview` performs both steps in one transaction (stage `preview → approved`, then published; two version steps, two audit events).
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
| decide review | `methodology.review` | TO; never an author (the draft's creator or any recorded contributor; amendment F1, 2026-10-18) or the requester (403 `config_review.self_review`) |
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

## Amendment (2026-10-14, T-DG5-ARCH-05; D-146): §9, who may list revision proposals

D-146 accepts the scope BE-B2 implemented, and §9 is read with it. `listRevisionProposals` lists a proposal only to a caller who holds `methodology.read` **and** can read the transformation it names (`transformation.read` in that transformation's scope). A proposal about a transformation the caller cannot read is left out of the list; it is not returned as a 403. This is least privilege: a proposal's `impact` names that transformation's affected records and benefits. The row "list/get … revision proposals | `methodology.read`" in the §9 table therefore means `methodology.read` plus `transformation.read` for each listed proposal. AUD holds both read rights and reads every proposal in its scope. No other §9 row changes, and no contract operation, status or code changes.

## Amendment (2026-10-17, T-DG5-ARCH-R1; D-163, D-164 (a) (b), D-166): §3, the approver every gate read names, and `gate_instance.approver_configured`

Sources: D-163 (F-DG5-QA-A-1), D-164 (a) and (b), and D-166 (accepted edits and the `0094` backfill); the T-DG5-BE-C3 handback §2 and the T-DG5-BE-C4 handback §2.1. Nothing above is removed. Where this amendment and §3 differ, this amendment wins. The ADR-0015 §2 amendment of the same date points here.

### C1. One approver rule for display, routing and authorization (T-DG5-BE-C3; D-163, D-164 (a))

A gate's approver is resolved **at run time** by `routedApproverOf(instance, catalogue, resolved)` (`apps/api/src/modules/workflows/gates.ts:276`). `catalogue` is the DG2 gate definition, and `resolved` is the definition of the transformation's pinned methodology version (through the `ConfigResolver` above).

- When the instance was **never configured** (`approver_configured` false, C2), names no user, and its role is the catalogue default, while the pinned version sets another default: the result is the pinned version's default role, with basis `default_role`.
- Otherwise the result is the stored approver (`approverOf`): the named user (`configured_user`), else the stored role (`default_role` when it equals the resolved default, else `configured_role`).

**Every read that names a gate's approver reports this routed approver.** Nothing stored is rewritten:

| Read | Where |
|---|---|
| `GET …/gates`, `GET …/gates/{gateCode}` and the `PATCH …/gates/{gateCode}` response (`GateInstance.approverRoleCode`, `approverUserId`) | `gateView` → `toGateInstance` (`gates.ts:159`, `:461`) |
| a new submission's approver | `submitGate` (`gates.ts:952`), unchanged since T-DG5-BE-C |
| "is this caller the gate's approver" (gate exceptions in person, dispensations) | `isGateApprover` (`gates.ts:398`) |
| the routing of `gate_exception_to_decide` work items and the on-behalf-of decide check | `gate-exceptions.ts` `gateApproverConfig` |
| the G5 disposition party | `scale.ts` `dispositionParty` |
| the recipients of the gate-exception expiry notices (worker) | `apps/worker/src/handlers/gates.ts` `effectiveGateApproverOf`, the SQL twin (the worker imports no API code, ADR-0002); parity is tested against the API for every gate |
| the gate pack of a gate with no submission | `WorkflowsReadPort.gateApprover` (ADR-0045 amendment of the same date) |

`effectiveGateApprovers` and `effectiveGateApprover` (`gates.ts:307` onwards) give this per gate. `workflows/index.ts` exports `effectiveGateApprover`, for the composition root only.

What does not change:
- A **pending submission** is decided by the approver recorded on it (`canDecide`, `gates.ts:452–455`). A submission keeps the approver it was routed to.
- The `gate.submitted` work items take the approver from the event payload, which is the submission's approver.
- For a transformation pinned to `playbook` v1, `resolved` is the catalogue, so every read returns the stored row byte for byte (p5-plan R2). The `PATCH` approver check reads the resolved definition's `allowedApproverRoleCodes`, which no version overrides, so its result is unchanged.
- The `GateInstance` schema is unchanged.

Requirement rows: REQ-S06-004 (A06: "a submission is routed to the new approver", and now the gate screens name that approver) and REQ-S20-006 (records pinned to the old version are unchanged). Tests: `apps/api/test/integration/methodology/effective-approver.test.ts`.

### C2. `gate_instance.approver_configured` (`0094`; T-DG5-BE-C4; D-164 (b), D-166)

Before this column, "no named user and the catalogue default role" could not be told apart from "never configured" (BE-C3 handback §2.4). An explicit role-only choice of the catalogue default (for example SP for G3, on a transformation whose pinned version defaults G3 to BO) was therefore overridden by the pinned default.

- **Column** (`packages/db/migrations/0094_p5_gate_approver_configured.sql`, additive): `approver_configured boolean NOT NULL DEFAULT false`, with a column comment. `packages/db/src/schema.ts` carries the type (an edit D-166 accepts).
- **Who sets it:** only the approver configuration, `PATCH /api/v1/transformations/{transformationId}/gates/{gateCode}` (`gate.configure`; audit action `gate_instance.configure`). It sets `approver_configured = true` in the same `UPDATE` as the role and user (`gates.ts:714`), and records `changes.approverConfigured {from, to}` in the same audit event (`gates.ts:732`). The version step, `If-Match` (428 missing, 409 stale), the commit-time re-authorization and the validation are unchanged. A refused configuration (403, 409 or 428) leaves the flag false.
- **How it is read:** when it is true, `routedApproverOf` keeps the stored approver (C1, second case). The worker twin reads the same column (`apps/worker/src/handlers/gates.ts:519`); D-166 accepts that edit for parity.
- **Not in the contract:** the flag is not exposed, and `GateInstance` is unchanged.
- **Backfill.** `0094` sets `approver_configured = true` for every instance that has at least one `audit_event` with `record_type = 'gate_instance'`, `record_id` = the instance and `action = 'gate_instance.configure'`. The backfill changes **only** the new column. `version`, `updated_at`, `updated_by` and every other value stay byte-identical, so ETags and the audit history do not move. No audit event is written, because the flag records a fact already in the audit trail.
- **The narrow trigger disable (accepted by D-166).** For the backfill statement only, `0094` runs `ALTER TABLE gate_instance DISABLE TRIGGER gate_instance_row_guard` and `… DISABLE TRIGGER gate_instance_audit_required`, and re-enables both before the migration's own transaction commits (`mth-db migrate` runs each migration in one transaction). Without this, the P2 guards would force a version step and a new audit event, and would change every configured row's ETag. `gate_instance_approver_allowed` fires only on `UPDATE OF approver_role_code`, so it is not involved.
  - `0094` is the first migration that disables a trigger. This ADR records it as a **one-off exception, not a pattern**: any further use needs its own decision.
  - _Confirmed 2026-10-17 by D-167 (T-DG5-ARCH-R2): the orchestrator confirms this framing. The text above is kept unchanged. The disable and re-enable are `packages/db/migrations/0094_p5_gate_approver_configured.sql:27–28` and `:39–40`._
  - The test `apps/api/test/integration/methodology/approver-configured.test.ts` re-applies the shipped `0094` to the pre-`0094` table, in a transaction that is rolled back. A configured instance becomes true and a never-configured one stays false. The stamps are unchanged, and an update without a version step is refused again afterwards (the guards are back on).
- The data dictionary (`gate_instance`) and the ERD list the column.

Requirement row: REQ-S06-004. Product gates G1–G6 are business approvals inside the product. Nothing here grants one, and nothing here touches the engineering gates DG0–DG7.

## Amendment (2026-10-18, T-DG5-ARCH-R4; D-170, F-DG5-100): §1, §5 and §9, who is an author of a configuration draft (`0097`)

Sources: D-170 (F-DG5-100, decided) and the T-DG5-BE-V1 handback §2 and §5, checked against the merged tree (`9c96ee3`). Nothing above is removed. Where this amendment and §1, §5 or §9 differ, this amendment wins. The same rule for automation rule versions is ADR-0043 amendment F1. Migration: `packages/db/migrations/0097_p5_config_review_contributors.sql` (cited below as `0097:<line>`).

### F1. "Author" means the creator and every recorded contributor (§1, §5, §9)

- **The rule (D-170).** A person who wrote any part of a configuration draft is one of its authors, and an author never decides its configured review. The authors of a Studio draft are its `created_by` plus every person recorded in `methodology_version_contributor` for it (`apps/api/src/modules/methodology/contributors.ts:23–31`, `configAuthors`). The requester is still refused as before.
- **Why it was needed.** Any `methodology.configure` holder may write another admin's draft (`updateConfigDraft`, the element PUT and remove, the kind providers' writers such as the procedure definition PUT). Before `0097`, the decision compared the decider only with `requested_by` and `created_by`, so a co-author could approve and publish content they wrote (F-DG5-100).

### F2. §1: the contributor record (data model)

- **The table** `methodology_version_contributor (methodology_version_id, user_id, first_written_at)` (`0097:51–61`): primary key (version, user); foreign keys to `methodology_version` and `app_user`; index on `user_id`; append-only through `p2_attach_append_only` (UPDATE, DELETE and TRUNCATE refused; `0097:58`); `mth_app` holds `SELECT, INSERT` only (`0097:59`), so a direct insert by the runtime role can only add refusals. Its rule-version twin is ADR-0043 amendment F1.
- **How it is written: database triggers, in the writer's own transaction.** The database has no session-actor setting, and a draft's content is written by several modules (methodology, and the kind providers in `procedures/`, `forms/` and `health/`). Triggers on every content table therefore record the writer whatever the write path (`0097:16–35`):
  - **at once** (AFTER ROW, `p5_config_contributor_from_row`, `0097:114–128`): the row's `updated_by`, or `created_by` on an INSERT without `updated_by`;
  - **at COMMIT** (deferred constraint trigger, `p5_config_contributor_from_audit`, `0097:131–152`): the `actor_user_id` and `on_behalf_of_user_id` of the write's own `audit_event` (same `record_type`, `record_id` and `new_version`). The deferred P2 guard `p2_audit_required` already makes that event mandatory, so a writer that forgot to stamp `updated_by` is still recorded.
  - `p5_add_config_contributor` (`0097:77–88`) records nothing for a NULL person or a version that is not `draft`. `p5_config_content_version` (`0097:101–111`) maps a content row to its draft.
- **What counts as content** (the tables the content hash and the diff cover):
  - `methodology_version`: the draft's INSERT, and an UPDATE that changes `title_en`, `title_ar`, `definition`, `change_summary` or `content_sha256` (`0097:155–168`);
  - `methodology_element`: every insert and update (every element kind: methodology, scoring defaults, form schemas, health-check schemes; `0097:171–174`);
  - `procedure_definition` and `procedure_step_definition`: the procedure kind's rows (`0097:175–182`).
  - An UPDATE that only moves the stage or status (submit, decide, withdraw, publish, discard) records nobody. So a TO who requested changes does not become an author by deciding, and may decide the next round (`apps/api/test/integration/methodology/studio-coauthor-review.test.ts:247`).
- **Backfill** (`0097:250–277`, `:295–300`): for each Studio draft open at migration time (`status = 'draft'`, not discarded), its `created_by` and `updated_by`, every actor of an audited content write of the version row, and every actor of an audited write of its element and procedure rows; only existing users; idempotent by the primary key. One `audit_event` per backfilled draft (`actor_type 'system'`, `source 'migration'`, action `methodology_version.contributors_backfill`, `changes.contributors {from: null, to: [...]}`). The version rows are not written, so their versions, ETags and audit histories do not move. Using `updated_by` errs towards refusing a reviewer, never towards allowing an author (BE-V1 handback §2.3).
- **Audit.** A contributor row has no `id` or `version`. At run time it is derived from an audited write in the same transaction, whose audit event already names the person, so no second event is written (the `0094` precedent).

### F3. §5: the reviewer is never an author or the requester, at the API and in the database

- **API.** `decideConfigReview` locks the version and the review request (`lockVersion`, `lockedReview`), then refuses `actor.userId === review.requested_by` or any member of `configAuthors` with **403 `config_review.self_review`** and the existing §13 text "You cannot review a configuration change you authored or requested." (`apps/api/src/modules/methodology/reviews.ts:334–340`). The check runs inside the decision transaction, so it is re-checked at commit time.
- **Database** (runtime role). `config_review_request_contributor_guard()` (`0097:211–221`), trigger `config_review_request_sod_contributor` BEFORE INSERT OR UPDATE (`0097:222–223`), raises constraint **`config_review_request_reviewer_not_contributor`** when `decided_by` is set to a recorded contributor of the draft. The `0062` refusals stay: the CHECK `config_review_request_reviewer_not_requester` and the trigger refusal `config_review_request_reviewer_not_author` (the creator).
- **Mapping.** `apps/api/src/modules/platform/db-errors.ts:2626–2628`: all three constraints give the same 403 `config_review.self_review`.
- **Publish.** Where review is required, publishing still needs an approved review for the exact hash (`methodology_version_review_required`, §1, unchanged). An author's decision is refused, so an author cannot produce that approval: the co-author's publish gives 422 `config_version.review_required` (`apps/api/test/integration/methodology/studio-coauthor-review.test.ts:175`).
- **No contract change.** The code and the text are the §13 ones. The `decideConfigReview` summary in `docs/api/openapi.yaml` now spells out "author" (description text only).

### F4. §5 and §8: review tasks skip every author

§5 says one `config_review` work item goes to each active holder of the reviewer role. It now excludes every author as well as the requester:

- the first round (the §8 revision proposal): `reviewerHolders(…, [input.requestedBy, ...configAuthors])` (`apps/api/src/modules/methodology/revision-impact.ts:310`);
- a later round of the same content: `reviewerHolders(…, [actor.userId, ...configAuthors])` (`reviews.ts:289–294`).

### F5. The firing order of the BEFORE triggers (BE-V1 handback §2.4)

PostgreSQL fires BEFORE triggers of the same event in name order, and evaluates CHECK constraints after every BEFORE trigger (`0097:205–210`). On `config_review_request`, `config_review_request_guard` (`0062`) and `config_review_request_row_guard` sort before `config_review_request_sod_contributor`, so a direct decision by the draft's creator still reports `config_review_request_reviewer_not_author` (tested, `studio-coauthor-review.test.ts:338`). Both map to the same 403. The rule-version case is ADR-0043 amendment F1.

### F6. Not changed by `0097` (BE-V1 handback §2.4 and §7, for the orchestrator)

- The `benefit_formula` revision path (§8 case 2) routes `config_review` tasks to FIN except the editor; its decision is the DG3 Finance validation, outside `config_review_request`. BE-V1 found no co-editor write path but did not prove it with a test.
- `methodology_migration` approval (ADR-0040) is a business approval governed by the DG4 canonical-approval SoD (requester and submitter refused), not a configured review. A re-planner is not recorded as a co-author.

Requirement row: REQ-S06-007 (and REQ-S06-010 for §9). Tests: `apps/api/test/integration/methodology/studio-coauthor-review.test.ts` (9 tests) and the "0097" test of `packages/db/test/integration/catalogue.test.ts` (`:850`). The data dictionary section "P5 repair migration 0097" lists the tables, functions and triggers. A configuration review is not a business approval. Nothing here grants a G1–G6 approval, and nothing here touches the engineering gates DG0–DG7.
