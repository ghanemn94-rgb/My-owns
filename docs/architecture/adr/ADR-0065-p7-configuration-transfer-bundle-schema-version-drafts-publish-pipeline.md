# ADR-0065: P7 configuration transfer bundle: the kinds it carries, stable keys, `bundleSchemaVersion` and the refusal of unknown versions, import as drafts through the existing publish pipeline, and the "behaves identically" proof by A06 replay

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-02), 2026-11-12. Base `9f161c651883bc2e482a2cf602024fbbacbf759c` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirement (slice D of `docs/architecture/p7-plan.md`):** REQ-S19-008. Slice C is ADR-0064.
- **Sources:**
  - M0356 (§19 item 5): "Workflow, methodology, forms, branding and automation configuration export/import with schema versions."
  - Acceptance (binding, `docs/delivery/requirements.csv`) REQ-S19-008: "A06;A18: a bundle exported from the demo installation imports into a clean one, and its published versions behave identically; a bundle with an unknown schema version is rejected". Screen: "Administration > Configuration transfer".
  - p7-plan §1.2 (REQ-S19-008 is New: "The P5 increment was not delivered"; D-243 Q20 records it).
  - Playbook: no block concerns configuration transfer. Nothing below is attributed to it.
- **Decisions applied:** p7-plan §3 seam 2 ("A bundle import creates **drafts** keyed by stable key, which then go through the existing review and publish pipeline. A published configuration never arrives already published. … If ARCH-02 finds a kind that cannot be expressed as a draft …, it gets its own import path through that kind's existing write API and is listed in the ADR"), seam 4 (job codes, schedules), seam 6 (permissions); D-243 (the plan adopted); "No new runtime dependency is expected in P7".
- **Builds on:** ADR-0014 (pins of running transformations), ADR-0039/ADR-0040 (Studio configuration versions, review policies, reapproval and methodology migrations), ADR-0041 (form schemas), ADR-0043 (automation rules), ADR-0047/ADR-0049 (branding versions), ADR-0052 §1 (upload policy), ADR-0064 §2 (`sourceEnvironment`, canonical JSON, SHA-256 rules).
- **Two gate systems.** A bundle is configuration. Importing it decides nothing: no G1–G6 approval, no Finance validation, no IT approval. A configuration publish after the import is a Studio action with its own review policy, exactly as today. Nothing here reads or writes DG0–DG7.

## Context

What exists at `9f161c65`:

1. **No bundle.** `grep -i 'bundle\|configuration-transfer' docs/api/openapi.yaml` found no operation before this task (p7-plan §1.2).
2. **Configuration kinds with drafts.** `methodology_version.config_kind` (0062) is one of `methodology`, `scoring_defaults`, `form_schema`, `procedure`, `automation_rule_set`, `health_check_scheme`, keyed by (`config_kind`, `key`), at most one open draft per key (`methodology_version_one_open_draft_key`), published through `publishConfigVersion` with the review policy of its kind (ADR-0039 §5). `createConfigDraft` only copies a published base (summary: "Create a draft from a published version of the same kind and key"). Automation rules (`automation_rule.code`, versions in `automation_rule_version` with `draft … published`, 0074) have their own draft and publish operations.
3. **Approval routes are not a separate kind.** `listApprovalRoutes`: "Routes are edited in Studio as approver_route elements" of a methodology version. They travel inside the `methodology` kind. `approval_route_step` (0075) is runtime state of a decision.
4. **Kinds without a draft stage.** Branding (`putBrandingSettings` publishes a new `branding_version` at once, P5/P6, with the P6 contrast check), the notification policy (`putNotificationPolicy`, one row per organization), job schedules (`updateJobSchedule`, rows keyed by `job_schedule.code`, seeded by migrations), review policies (`updateConfigReviewPolicy`, keyed by `config_kind`), the upload policy (`putUploadPolicy`, one per organization). Each write is versioned and audited by its own module.
5. **Pins.** A running transformation keeps its pinned versions (ADR-0014); a new publish triggers the migration and reapproval rules of ADR-0040.

## Decision

### 1. The kinds a bundle carries (12)

| Kind | Source (latest **published** only) | Stable key (`itemCode`) | Import path |
|---|---|---|---|
| `methodology` | `methodology_version` + its element rows (phases, gates, templates, approver routes, …) | `key` | **draft** |
| `scoring_defaults` | `methodology_version` (kind `scoring_defaults`) | `key` | **draft** |
| `form_schema` | `methodology_version` (kind `form_schema`) + fields | `key` | **draft** |
| `procedure` | `methodology_version` (kind `procedure`) + step definitions | `key` | **draft** |
| `automation_rule_set` | `methodology_version` (kind `automation_rule_set`) | `key` | **draft** |
| `health_check_scheme` | `methodology_version` (kind `health_check_scheme`) | `key` | **draft** |
| `automation_rule` | `automation_rule` + its published `automation_rule_version` | `automation_rule.code` | **draft** (`automation_rule_version` `draft`) |
| `branding` | the organization's published `branding_version` | `branding` (one per organization) | applied through `putBrandingSettings`' service (no draft stage exists) |
| `notification_policy` | `notification_policy` | `notification_policy` (one per organization) | applied through `putNotificationPolicy`' service |
| `job_schedule` | `job_schedule` | `job_schedule.code` | applied through `updateJobSchedule`' service, **always disabled** |
| `config_review_policy` | `config_review_policy` | `config_kind` | applied through `updateConfigReviewPolicy`' service |
| `upload_policy` | the organization's `upload_policy` | `upload_policy` (one per organization) | applied through `putUploadPolicy`' service |

- **Never in a bundle:** drafts, superseded versions, history, business records, users, sessions, secrets and SecretRefs, connectors and webhooks (they carry SecretRefs and belong to the installation; ADR-0064 moves them), and `benefit_formula` versions (per-benefit business records with Finance validation; ADR-0064 moves them). The `benefit_formula` **review policy** row travels as a `config_review_policy` item.
- **Seam 2 (listed as the plan requires):** the five kinds without a draft stage cannot arrive as drafts. They are applied on commit, item by item, through the owning module's existing write service, with that kind's own permission, its version check and its own audit event, after a human has reviewed the plan (§4). A job schedule is always applied **disabled**, so an import never starts a job.

### 2. The bundle format (`bundleSchemaVersion` `mth-config-bundle/1`)

```json
{ "bundleSchemaVersion": "mth-config-bundle/1", "exportId": "<uuid>", "sourceEnvironment": "demo",
  "createdAt": "<RFC 3339 UTC>", "appVersion": "<release>",
  "items": [ { "kind": "form_schema", "itemCode": "charter", "sourceVersionNo": 3,
               "contentSha256": "<hex>", "content": { } } ] }
```

- `sourceEnvironment` is ADR-0064's marker (D-244 O2), with the same three values.
- `content` is the kind's published content in the owning module's own zod schema (`packages/shared/src/transfer/config-bundle.ts` re-exports one schema per kind). It is validated JSON, never an unvalidated blob.
- **No source ids.** References between items, and from an item to a role, permission, record type or another configuration, use stable keys or codes. A reference that has no stable key (for example a user id inside a configuration) fails the export with 422 `config_bundle.unportable_reference`, naming the kind, key and field. It is never silently dropped.
- `contentSha256` is the SHA-256 of the canonical JSON of `content` (keys sorted by code point, no insignificant whitespace, UTF-8). The bundle's SHA-256 is over the file bytes.
- Items are ordered by kind (the table order of §1), then `itemCode`. At most 2,000 items and 5 MiB.

**Unknown versions are rejected (REQ-S19-008).** The upload reads `bundleSchemaVersion` before anything else. Any value other than `mth-config-bundle/1` is 422 `config_bundle.schema_version_unsupported` and nothing is stored. The OpenAPI schema deliberately accepts any string there, so the refusal is this specific code and not a generic 400. The database refuses it too (0134 `CHECK (bundle_schema_version = 'mth-config-bundle/1')`).

### 3. Export

`createConfigBundleExport` (`config_bundle.export`; ADM_TECH, ADM_METHOD) takes an organization, optional kinds (default all) and a reason. Each kind's adapter (§6) returns its latest published items. The bundle is written to the EvidenceStore at `transfer/config-bundles/<exportId>.json`, a `config_bundle_export` row records kinds, count, size and SHA-256, and the audit event `config_bundle_export.created` is written. 422 `config_bundle.nothing_published` when no item exists. `downloadConfigBundleExport` re-hashes the bytes on read; a mismatch is 422 `config_bundle.checksum_mismatch`.

### 4. Import: upload, validate (plan), commit

1. **Upload** (`uploadConfigBundleImport`, `config_bundle.import`): the version check (§2), the size limit (413 `config_bundle.too_large`), every item's `contentSha256` (422 `config_bundle.checksum_mismatch`) and every item's content against its kind's schema (422 `config_bundle.item_invalid`, with a pointer). The bytes go to `transfer/config-bundle-imports/<importId>.json`; status `uploaded`; audit `config_bundle_import.uploaded`. Nothing in the configuration changes.
2. **Validate** (`validateConfigBundleImport`, If-Match, lock 730405 on the organization): a new validation run (`validation_no + 1`) writes one `config_bundle_import_item` per item with its action:
   - `create_draft`: the key does not exist in the target;
   - `new_draft`: the key exists and the content differs from its latest published version (the draft is based on that version);
   - `identical`: the content hash equals the latest published version's (nothing will be written);
   - `conflict` (`config_bundle.open_draft_exists`): an open draft of the key exists in the target; the import never overwrites someone's draft;
   - `refused`: a referenced key is missing in the bundle and in the target (`config_bundle.reference_missing`), the caller lacks the kind's own configure right (`config_bundle.kind_not_permitted`), or the kind is not enabled in the target (`config_bundle.kind_unavailable`).

   Any `conflict` or `refused` item makes the import `invalid` (terminal; 0134 `config_bundle_import_committable`). Otherwise it is `validated`. Audit `config_bundle_import.validated`. A validated import can be re-validated (the target may have changed).
3. **Commit** (`commitConfigBundleImport`, If-Match, lock 730405): re-runs the plan; if any action differs from the stored latest run, 422 `config_bundle.plan_changed` and nothing is written (validate again). Otherwise, in one transaction, every `create_draft`/`new_draft` item is written through its adapter (§6), one `config_bundle_import_commit` row per written item names the record, each write carries its own module's audit event, and the import becomes `committed` with `config_bundle_import.committed`. Any failure rolls back the whole commit.

### 5. Drafts go through the existing pipeline (seam 2: additive)

- A drafting kind's commit creates a **draft** (`methodology_version` with `status` draft, or an `automation_rule_version` draft) with the bundle content. It is reviewed and published with the existing operations and the kind's review policy. The commit never publishes.
- Publishing an imported draft in an installation with running transformations triggers exactly the ADR-0040 migration and reapproval rules a hand-made publish triggers, because it **is** a hand-made publish. Running transformations keep their pins (ADR-0014).
- No new configuration kind, no change to the publish or migration semantics, no change to the existing operations' requests or responses. The methodology and automation modules each gain one new service function ("create a draft from validated content"), called only by their adapter. That is additive.

### 6. Adapters: `transfer` imports no domain module

`transfer/config-bundle/**` defines a `ConfigBundleKindAdapter` port (the P5 `AutomationActionRegistry` pattern): `kind`, `exportPublished(orgId)`, `contentSchema`, `plan(orgId, item)`, `write(tx, orgId, item, actor)`. Each owning module registers its adapter in a new file, next to the service it calls: `methodology/config-bundle-adapter.ts` (the six Studio kinds and review policies; `methodology/review-policies.ts`), `automation/config-bundle-adapter.ts` (rules; `automation/lifecycle.ts`), `admin/config-bundle-adapters.ts` (branding, `admin/branding.ts`; upload policy, `admin/upload-policy.ts`), `tasks/config-bundle-adapter.ts` (notification policy, `tasks/notification-policy.ts`) and `jobs/config-bundle-adapter.ts` (job schedules, `jobs/schedules.ts`). BE-A adds the registry wiring point; BE-F writes the adapters. So `transfer` imports no domain module (p7-plan §2 "No module cycle").

### 7. "Behaves identically": the proof (REQ-S19-008, A06)

- **BE-F round-trip test:** demo installation → export all kinds → upload into a clean installation (bootstrapped, synthetic) → validate (every item `create_draft`; the migration-seeded job schedules and review policies `new_draft` or `identical`) → commit → publish each draft through the existing operations → the target's published content hashes equal the source's `contentSha256` for every item, and a second export from the target has the same item set and hashes.
- **QA-B's A06 replay:** the A06 assertions (the qa-verifier's existing A06 tests) run against the target after that publish, with the same expected results as on the demo.
- **Unknown version:** `mth-config-bundle/2` and an empty string are rejected with 422 `config_bundle.schema_version_unsupported`, and no row and no object are written.

### 8. Permissions (seeded by 0135)

| Code | Category | Roles | Grants |
|---|---|---|---|
| `config_bundle.export` | configure | ADM_TECH, ADM_METHOD | `createConfigBundleExport`, `listConfigBundleExports`, `getConfigBundleExport`, `downloadConfigBundleExport` |
| `config_bundle.import` | configure | ADM_TECH, ADM_METHOD | `uploadConfigBundleImport`, `listConfigBundleImports`, `getConfigBundleImport`, `validateConfigBundleImport`, `commitConfigBundleImport` |

The commit also needs each written kind's own right (`methodology.configure` for the six Studio kinds, `automation.configure` for rules, `branding.configure`, `notification_policy.configure`, `job.configure`, `config_review_policy.configure`, `upload_policy.configure`; each verified in `packages/shared/src/permissions.ts` at the base). The adapter checks the same code the kind's existing route checks, and the plan marks items the caller cannot write as `refused`. So ADM_METHOD can import Studio configuration but not job schedules, and ADM_TECH the reverse, unless an organization grants more. AUD holds neither code: configuration transfer is a write.

### 9. Advisory lock

730405 `configBundleImport` (ADR-0016 §6), key `<organizationId>`: a validation and a commit for the same organization never interleave.

### 10. Schema (0134) and contract

- **0134:** `config_bundle_export` (append-only, audited), `config_bundle_import` (state machine `config_bundle_import_guard`, audited, column grants), `config_bundle_import_item` (append-only, one set per validation run), `config_bundle_import_commit` (append-only; only drafting actions; `config_bundle_import_commit_guard`). Probe: `packages/db/test/integration/p7-transfer-guards.test.ts`.
- **Contract:** 9 operations (tag `transfer`), pending in `p7-pending-be-f.ts`.

## Consequences

- Positive: configuration moves between installations by stable key without ever bypassing review: the kinds with drafts cannot arrive published, and the others need the same right and leave the same audit trail as a manual change.
- Negative: two installations' configurations can only be compared through content hashes, not ids. That is intended (ids are installation-local).
- Negative: the five non-draft kinds become live at commit. The plan step shows them, and the commit needs each kind's own right; job schedules arrive disabled.

## Residuals (honest)

1. **The per-kind content schemas are BE-F's**, written against each module's existing published content. If a kind's content cannot be expressed without a source id that has no stable key, that kind is refused at export with `config_bundle.unportable_reference` and listed in BE-F's handback and in known limitations. It is never silently dropped.
2. **`createConfigDraft` copies a published base only.** A `create_draft` of a new key needs the methodology module's new "draft from content" service (§5). If BE-F finds that a kind cannot get one without changing an existing operation, that is a reopen question for the orchestrator (DG5), not an implementer decision.
3. **"Behaves identically" is proven by the A06 assertions and content hashes**, not by an exhaustive behavioural comparison of every configuration path.
4. **`config_review_policy.configure` is held by TO by default, not by ADM_METHOD or ADM_TECH** (`updateConfigReviewPolicy`: "config_review_policy.configure; TO"). With the default roles, a review-policy item is therefore `refused` (`config_bundle.kind_not_permitted`) for both bundle roles unless the organization grants the code. That is intended: the import never widens a right.

## Alternatives considered

1. **Import as published.** Rejected by seam 2: it would bypass review policies and reapproval.
2. **One bundle per kind.** Rejected: references between kinds (a methodology referencing form schemas) must resolve in one plan.
3. **Reuse ADR-0064's package.** Rejected: that format preserves ids and needs an empty database; a bundle goes into an installation with its own records and must use stable keys.
4. **A `bundleSchemaVersion` enum in OpenAPI.** Rejected: the request validator would answer a generic 400 and REQ-S19-008 needs a specific, testable refusal.

## Version evidence (M0314)

No new dependency. Canonical JSON and SHA-256 use Node built-ins (`JSON`, `node:crypto`); the content schemas use the pinned zod (ADR-0001).
