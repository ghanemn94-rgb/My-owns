# Handback T-DG7-BE-F: configuration bundles (backend-workflow-engineer)

- **Stage:** DG7 (P7 "Independent transfer and release"). Branch `claude/mobily-transformation-platform-dg6-regate`, base `294a044df0c7812ff67b1ff237b7d7fa084f33a9`. Working tree was clean at the start apart from this run's own `docs/delivery/runs/` directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-F.md` (sha256 `40390dda…20ed`), p7-work-split §D.1, ADR-0065.
- **Invocation:** `DG7-T-DG7-BE-F-backend-workflow-engineer-20261112T211411Z-f878610b`, session `f878610b-e79a-4e87-b0d8-1dc2de692e6c`.
- **Time:** started 21:14:22 UTC, implementation finished about 21:52 UTC, then checks and this handback.
- **Migrations added:** none. The 0134 bundle tables were enough, so no `0137`+ migration was needed.
- **Two gate systems:** a bundle import is configuration. It approves nothing: no G1–G6, Finance or IT approval. Nothing here reads or writes DG0–DG7. The Studio review used in the round-trip test is the existing configuration review of synthetic data.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `packages/shared/src/transfer/config-bundle.ts` (new) | `BUNDLE_SCHEMA_VERSION = "mth-config-bundle/1"`, the 12 kinds in ADR-0065 §1 order, canonical JSON (code-point key order, integers only) and `contentSha256` (the caller supplies the hasher, see Q1), the envelope and item zod schemas, one floor content schema per kind, the D.2 problem texts (EN), `firstUuidPointer` (the "no source ids" rule), and the generic `ConfigBundleKindAdapterPort` (see Q2). |
| `packages/shared/package.json` | Adds the `./transfer` export line. **The work split makes this an orchestrator merge on request.** I added it so the tree compiles, and I'm requesting it here (Q1). |
| `apps/api/src/modules/transfer/config-bundle/registry.ts` (new) | The adapter registry (`createConfigBundleAdapterRegistry`, `configBundleAdapters`, `setConfigBundleAdapters`) and the API instantiation of the port types. |
| `apps/api/src/modules/transfer/config-bundle/plan.ts` (new) | The plan. Per item: `kind_unavailable` when no adapter is registered, `kind_not_permitted` without the kind's own right, otherwise the adapter's action. Also the counts and the stored-run comparison used for `plan_changed`. |
| `apps/api/src/modules/transfer/config-bundle/service.ts` (new) | Export (assemble, unportable-reference check, store, then row + audit in one transaction), download re-hash, upload checks in ADR order, validate and commit (lock 730405 on the organization, If-Match, re-plan, one transaction), the contract mirrors, the D.2 refusals, and a filesystem `BundleStore` at the evidence root (`transfer/config-bundles/<id>.json`, `transfer/config-bundle-imports/<id>.json`). |
| `apps/api/src/modules/transfer/config-bundle/routes.ts` | The 9 routes (the guard table is unchanged). The upload route has `bodyLimit` 5 MiB, a Content-Length pre-check and a route error mapping, so any oversize body is 413 `config_bundle.too_large`. |
| `apps/api/src/modules/transfer/index.ts` | Re-exports the registry for the composition root. |
| `apps/api/src/modules/methodology/config-bundle-adapter.ts` (new) | The six Studio kinds, `config_review_policy`, and the additive "draft from content" service `createDraftFromContent` (ADR-0065 §5). |
| `apps/api/src/modules/jobs/config-bundle-adapter.ts` (new) | `job_schedule`. Content `{cron, timezone}`; always written `enabled = false`; `job_schedule.update` audit and the `job_schedule.updated` outbox event, like `updateJobSchedule`. |
| `apps/api/src/modules/tasks/config-bundle-adapter.ts` (new) | `notification_policy`. Create or update with `notification_policy.create`/`.update` audit, like `putNotificationPolicy`. |
| `apps/api/src/modules/admin/config-bundle-adapters.ts` (new) | `upload_policy` (`upload_policy.changed`) and `branding` (through the exported `publishBranding`, with the §11 rules and the ADR-0061 contrast rule; `branding_version.create`). |
| `apps/api/src/server.ts` | The registry line and one registration line per adapter in the P7 wiring block. **Beyond the registration lines:** the inline branding token-source object is hoisted into `const brandingTokenSource`, so the branding routes and the branding adapter share it. The content is unchanged. |
| `apps/api/src/architecture.testkit.ts` | Adds `@mth/shared/transfer` to `SHARED_ALLOWED` (Q1). |
| `apps/api/test/support/p7-pending-be-f.ts` | Now empty. |
| `apps/api/test/integration/contract/p7-exercises-be-f.ts` (new) | T-D9: the 9 operations, with successes and every declared refusal they can reach. |
| `apps/api/test/integration/contract/contract.test.ts` | Import, mirrors and one `it` for BE-F. The pinned request-body media-type counts go from 430/428 to 432/430 (+2 JSON bodies). |
| `apps/api/test/integration/transfer/config-bundle.test.ts` (new) | T-D1–T-D5 and T-D8 (18 tests). |
| `apps/api/test/integration/transfer/config-bundle-roundtrip.test.ts` (new) | T-D6 (demo → clean installation). |
| `apps/web/src/i18n/{en,ar}/problems.json` | The 13 D.2 problem codes. EN is verbatim; AR is as given (provisional). `{version}` is written in the i18next form `{{version}}`. **Derived, not in D.2:** `config_bundle__schema_version_unsupported_noParams`, the same sentence without the version. The web renderer needs it for a text with a placeholder (`problems-all.test.ts`), and it is shown when the bundle had no or an empty version (Q7). |
| `docs/delivery/handbacks/DG7/T-DG7-BE-F-evidence/*` | Check logs. |

### API endpoints added (tag `transfer`)

`GET/POST /api/v1/admin/config-bundles/exports`, `GET …/exports/{configBundleExportId}`, `GET …/exports/{configBundleExportId}/download`, `GET/POST /api/v1/admin/config-bundles/imports`, `GET …/imports/{configBundleImportId}`, `POST …/imports/{configBundleImportId}/validate`, `POST …/imports/{configBundleImportId}/commit`. These are `listConfigBundleExports`, `createConfigBundleExport`, `getConfigBundleExport`, `downloadConfigBundleExport`, `listConfigBundleImports`, `uploadConfigBundleImport`, `getConfigBundleImport`, `validateConfigBundleImport` and `commitConfigBundleImport`.

## 2. Behaviour per requirement (REQ-S19-008)

| Clause | Delivered | Test (ran, passed) |
| --- | --- | --- |
| "a bundle with an unknown schema version is rejected" | `bundleSchemaVersion` is read before anything else. `mth-config-bundle/2`, `""` and a missing field are all 422 `config_bundle.schema_version_unsupported` (with `params.version`). No row and no object are written. | T-D1 (3 cases); contract exercise |
| "a bundle exported from the demo installation imports into a clean one" | Export (latest **published** only, stable keys, canonical JSON, SHA-256 stored and re-hashed on download), upload, validate and commit. | T-D6 |
| "and its published versions behave identically" | The commit writes Studio **drafts** only. They are published through the existing preview, compatibility, review and publish operations. Every published `content_sha256` in the target equals the source item's `contentSha256`, and a re-export from the target has the same `(kind, itemCode, contentSha256)` set. | T-D6; T-D7 **not done** (§4); the A06 replay is QA-B's |
| M0356 "workflow, methodology, forms, branding and automation configuration export/import with schema versions" | 11 of 12 kinds have adapters and are written through their own paths. **`automation_rule` is not implemented** (§4). | T-D4 (Studio ×4, branding, notification, job, review policy, upload policy), T-D6 |

Rules covered by tests:

- **Permissions.** ADM_TECH and ADM_METHOD hold both bundle rights. AUD and a user without grants get 403 on all 9 operations (T-D5). The kind's **own** right decides each item: ADM_METHOD's job-schedule item and ADM_TECH's methodology item are `refused` with `config_bundle.kind_not_permitted` (T-D5). Every mutation re-checks the right on grants reloaded inside its transaction, and the adapter re-checks the kind's right at write time.
- **Validation and refusals.**
  - Changed content under the old hash: 422 `checksum_mismatch` with pointer `/items/i/contentSha256`.
  - Invalid item: 422 `item_invalid` with pointer `/items/i/content/...`.
  - 5 MiB + 1 byte: 413 `too_large`.
  - Duplicate `(kind, itemCode)`: `item_invalid`.
  - Altered stored export: 422 `checksum_mismatch` on download.
  - Nothing published: 422 `nothing_published`.
  - A uuid in a content: 422 `unportable_reference`, naming kind, key and field (pointer `/job_schedule/<code>/cron`); the value is never echoed and no row is written.
  - A kind requested by name that has no adapter: 422 `kind_unavailable`, never left out silently (T-D2, the export tests and T-D8).
- **The plan (T-D3).** `identical`, `new_draft`, `conflict` (`open_draft_exists`), `create_draft`, and `refused` (`reference_missing` for an unknown reviewer role; `kind_unavailable`). The open draft is byte-for-byte untouched. `invalid` is terminal: re-validate is 422 `not_validatable`, commit is 422 `not_committable`.
- **The commit (T-D4).**
  - Studio rows are `status = draft`, `draft_stage = editing`, `origin = draft`, `published_at = null`, with `content_sha256` equal to the item hash. Audit `methodology_version.create_draft`, plus `methodology_element.put` per element.
  - The job schedule ends `enabled = false` with `job_schedule.update`.
  - Notification policy: `notification_policy.create`. Upload policy: `upload_policy.changed`. Review policy: `config_review_policy.update`. Branding: `branding_version.create`; `#0078FF` stays provisional (`colours_provisional = true`).
  - The import itself is audited `config_bundle_import.uploaded`, `.validated` and `.committed`. The export is audited `config_bundle_export.created`.
  - `plan_changed`: a draft opened between validate and commit gives 422. Nothing is written (no commit rows, job schedule unchanged, import still `validated` v2), and re-validation marks the import `invalid`.
- **Concurrency.** Validate and commit need If-Match (428 without it, 409 when stale) and take lock 730405 on the organization. Optimistic `version` applies on every update.
- **T-D8.** The only uuid in an exported file is `exportId`.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, disposable PostgreSQL 16 via `tests/qa/support/with-pg.sh`. Logs are in `docs/delivery/handbacks/DG7/T-DG7-BE-F-evidence/`.

| Command | Result | Log |
| --- | --- | --- |
| `pnpm -r typecheck` (final tree) | exit 0 | `typecheck.log` |
| `pnpm lint` (final tree) | exit 0 | `lint.log` |
| `pnpm openapi:lint` | exit 0 (`PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations`) | `openapi-lint.log` |
| `pnpm test`, run 1 | **exit 1**, two failures, both mine: `advisory-locks.test.ts` (a doc comment spelled the lock class number) and `problems-all.test.ts` (`schema_version_unsupported` had no `_noParams` text). Both fixed. | `pnpm-test-run1.log` |
| `pnpm test`, run 2 (final tree) | exit 0. unit-node 198 files, 2944 tests; unit-web 125 files, 2113 tests; unit-formula-nocodegen 3 files, 259 passed + 2 skipped | `pnpm-test.log` |
| `tests/qa/support/with-pg.sh npx vitest run --project integration` on `apps/api/test/integration/contract/contract.test.ts`, `…/transfer/config-bundle.test.ts`, `…/transfer/config-bundle-roundtrip.test.ts`, `…/transfer/export.test.ts`, `packages/db/test/integration/p7-transfer-guards.test.ts` (final tree) | exit 0: 5 files, 147 tests | `integration-final.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | exit 0 (`PASS gate DG6 (historical)`) | `validate-dg6.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 ("All matched files use Prettier code style!"; re-run after this handback's last edit) | `prettier.log` |

Intermediate runs during development, all on disposable PostgreSQL:

- `config-bundle.test.ts`: the first run had 2 failures, both test-setup bugs (the owner-role plant needed a version step and its audit event; an order-dependent expectation). Fixed, then 17/17 passed.
- Contract run 1 failed only on the pinned media-type count (expected 430/428, got 432/430). The pin was updated, then contract + transfer suites passed 134/134.
- After the branding adapter, the two config-bundle suites passed 19/19.

## 4. Known gaps / not done

1. **`automation_rule` kind not implemented.** No adapter is registered. An export that names it is 422 `config_bundle.kind_unavailable`, the default "all kinds" export carries none and records only the kinds it covered, and an imported item is planned `refused` with `kind_unavailable`. The blockers are real:
   - an `automation_rule` row carries `owner_user_id` and possibly `transformation_id` (business records with no stable key);
   - new codes need `createRule`, which is private to `automation/rules.ts`;
   - stored condition literals have the D-222 restricted-token handling, which needs a decision before it travels in a file.
   This leaves M0356's "automation" part only partly met: `automation_rule_set` (Studio) travels, rules do not.
2. **T-D7 not written** (an imported methodology draft published in an installation with a running transformation triggers the ADR-0040 migration and reapproval exactly like a hand-made publish, and the pin is unchanged until then). The implementation calls no new publish path: the draft is published through the existing operations. But the test asserting identical migration and reapproval records does not exist.
3. **`create_draft` of a new Studio key is impossible.** `methodology_version_draft_lineage` (0062) requires a published base for every non-seed version, so a key the target has never published is planned `refused` with `config_bundle.kind_unavailable`, not `create_draft`. Between installations at the same migration level this never happens (every published Studio key is migration-seeded); T-D6 confirms that. It is ADR-0065 residual 2: a reopen question (Q3), not something I changed.
4. **Reference checks are partial.** `reference_missing` is checked for role codes (Studio `approverRoleCodes`, review-policy `reviewerRoleCode`). Other cross-references are not pre-checked by the plan: Studio `source` element identities, and form or procedure keys named inside a methodology definition. A missing one is refused by the database guard at commit, which rolls back the whole commit (422 `validation.constraint`) instead of showing it in the plan.
5. **Stored import bytes are canonical, not the raw upload.** The module allow-list has no `node:stream`, so the raw body is not teed. The stored object is the canonical JSON of the checked bundle. For an unchanged exported bundle the bytes and SHA-256 equal the export's (tested). For a hand-formatted file, `sha256`/`byteSize` describe the canonical form, not the file as uploaded. ADR-0065 §2 says "over the file bytes" (Q4).
6. **Kind availability is "has an adapter".** No per-installation kind switch is consulted.
7. **The screen is FE-B's.** The D.2 screen texts are not added; only the problem codes are.

## 5. Open questions and merge instructions

- **Q1 (orchestrator merge request).** Please confirm the `./transfer` export line in `packages/shared/package.json` and the `@mth/shared/transfer` entry in `SHARED_ALLOWED` (`architecture.testkit.ts`). Both are needed for the work split's "`packages/shared/src/transfer/config-bundle.ts`" to be importable. `@mth/shared` has `types: []` (no Node types), so `contentSha256(content, sha256)` takes the hasher as a parameter; the API passes `transferSha256` (`node:crypto`).
- **Q2.** The adapter **port types** live in `@mth/shared/transfer` (generic over Db, Tx, Request and Principal). The alternative, adapters importing `transfer/config-bundle/registry.ts`, would make `jobs → transfer → jobs` a declared-module cycle and break `architecture.test.ts`. `transfer` still imports no domain module.
- **Q3 (reopen, ADR-0065 residual 2).** Should an imported Studio key that the target never published become a draft? That needs a migration relaxing `methodology_version_draft_lineage` (for example an `origin = 'import'` value). Today it is refused with `kind_unavailable`.
- **Q4.** Is the canonical stored form acceptable for the import's `sha256` (gap 5), or should `node:stream` (PassThrough) be allow-listed so the raw upload bytes are kept?
- **Q5.** `kind_unavailable` is used at **export** level for a named kind without an adapter (D.2 marks it as an item code). Please confirm, or name another code.
- **Q6.** The branding adapter makes a branding item live on commit, as the ADR's non-draft rule says. It needs `branding.configure` (ADM_TECH by default).
- **Q7.** The `_noParams` EN and AR texts of `schema_version_unsupported` are my derivation of the D.2 text. Please confirm or replace them.
- **Merge:**
  - No migrations to run.
  - Expect conflicts with other W5 tasks in `contract.test.ts` (the media-type pin: reconcile by summing deltas, BE-F is +2/+2), in `apps/web/src/i18n/{en,ar}/problems.json` (appended keys) and in `server.ts` (the P7 wiring block).
  - `p7-pending-be-f.ts` is empty.
