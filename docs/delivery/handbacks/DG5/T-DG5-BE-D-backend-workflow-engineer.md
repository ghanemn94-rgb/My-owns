# Handback T-DG5-BE-D (backend-workflow-engineer): forms kind provider, form schema reads, custom-field values, the forms pin initializer, migration 0071

- **Stage / gate:** P5 "Configuration automation and outputs", DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §B.2 (+ D-145 item 1: migration `0071`).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-D-backend-workflow-engineer-20261014T055634Z-aeeb0de5","session_id":"aeeb0de5-674e-4d99-a5b3-76dca0ed3298"}` (copied from the invocation).
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-BE-D.md`, sha256 `d059b8d4b74be53c986584963fe799abce0b6bd4dd66863da07d209b5f441c8e` (verified with `sha256sum` at the start).
- **Starting revision:** worktree `/home/user/wt/dg5-be-d`, branch `dg5/be-d`, `HEAD` = `8ac7fec8db8d2cfce34c9d3f11c5543800872798`. The changes are **uncommitted** for the orchestrator to integrate.
- **Time:** start `2026-10-14T05:56:48Z`; end `2026-10-14T07:40:32Z` (about 104 minutes; wrapped up under the 100-minute rule).
- **Two gate systems:** nothing here reads or writes DG0–DG7. A form schema change is configuration. The configuration review in one test is a synthetic TO review, written as test data. It is not a business approval, and no G1–G6 approval is granted anywhere.

## 1. Files changed

### Owned by this task (p5-work-split §B.2)

| File | Purpose |
|---|---|
| `apps/api/src/modules/forms/record-types.ts` (new) | Reads the `form_record_type` registry and presents it. Holds the ADR-0041 §10 refusals with their exact texts, the `transformation.read` read helper, and `requireRecordWrite`: scope on the request-start principal (404), then the record type's `write_permission_code` re-checked on the principal reloaded in the transaction (403, commit-time). Also `recordExists`, which applies the T04/T16 discriminator. |
| `apps/api/src/modules/forms/provider.ts` (new) | The `form_schema` `ConfigKindProvider`: catalogue (forms and protected source columns), `validateElement`, `validateRemove`, `compatibility` (`warn` for a new required field), `affectedRecords`, `preview` (sample records), `migrationItems` (`new_required_field`, `invalidated_calculation`), and `mapFormDbError` (0068 constraint names → §10 codes). Also holds the resolved-form model: `resolveForm`, `settingsOf`, `extensionDefinitions`, `numericVariables` and `sourceInputs`. |
| `apps/api/src/modules/forms/schema-reads.ts` (new) | `listFormRecordTypes`, `getFormSchemaAdmin`, `getTransformationFormSchema`. |
| `apps/api/src/modules/forms/custom-values.ts` (new) | `getFormRecordCustomFields` and `putFormRecordCustomFields`: validation before persistence, deferred reference, attachment and lookup checks in the transaction, `If-Match` `"0"` creates, 409 `form_record.conflict`, one audit event per write. |
| `apps/api/src/modules/forms/pin-initializer.ts` (new) | `pinNewTransformationToForms`: pins a new transformation to the newest published `forms` version, with its audit event. |
| `apps/api/src/modules/forms/routes.ts`, `forms/index.ts` | Route registration (BE-E and BE-E2 add their lines below mine), the provider registration, and the initializer export. |
| `packages/shared/src/schemas/forms.ts` (new) + barrel line in `schemas/index.ts` | Zod mirrors of `FormRecordType(List)`, `FormSchema`, `FormField`, `FormCustomValues(Put)`, and the attribute schemas of the `form` / `form_field` element types. |
| `packages/db/migrations/0071_p5_choice_multiple_values.sql` (new) | Forward-only. Redefines `form_custom_value_guard()`: every 0068 rule verbatim, and the `choice` clause widened (multiple → a non-empty array of unique strings of 1–100 characters; else one string of 1–100 characters). `0068` is not edited. |
| `packages/db/src/schema.ts` | A doc comment on `FormCustomValueTable.field_values` (the 0071 shape). No type change. |
| `packages/db/test/integration/catalogue.test.ts` | One new pin: the 0071 function still raises the four 0068 constraint names, has the multiple-choice clause, and its trigger is unchanged. |
| `apps/api/test/integration/forms/form-schemas.test.ts` (new) | 17 integration tests (§2). |
| `apps/api/test/support/forms-fixtures.ts` (new) | Synthetic `form_schema` versions under unique keys, and fixture transformations pinned to them. |
| `apps/api/test/support/p5-pending-be-d.ts` | Emptied (all 5 routed). |
| `apps/api/test/integration/contract/p5-exercises-be-d.ts` | Contract exercises of the 5 operations, with their mirrors. |

### Outside my listed ownership: named, minimal lines needed to deliver §B.2 (please confirm or reassign)

| File | Lines | Why |
|---|---|---|
| `packages/shared/src/schemas/studio.ts` (BE-A) | `form` and `form_field` added to `CONFIG_ELEMENT_TYPES`; their attribute schemas added to `CONFIG_ELEMENT_ATTRIBUTES`; `ELEMENT_TYPES_BY_KIND.form_schema = ["form", "form_field"]` | Without these, `putConfigElement`/`removeConfigElement` refuse `elementType=form_field` at the params parse (400). The OpenAPI `ConfigElementType` enum already lists both, and 0068 widened the DB CHECK. §B.2: "the slice A element operations route form elements through this provider". |
| `apps/api/src/modules/methodology/kinds.ts` (BE-A) | `DEFAULT_KEYS` + `["form_schema", "forms"]` (§B.2 calls this "the one registration line"); two optional hooks added to `ConfigKindProviderHooks`: `catalogue` and `validateRemove` | The registry had no way to supply the catalogue of protected source columns (needed so a put on `T03.gap` derives origin `source`) and no removal hook (needed for 422 `form_schema.source_column_protected`). |
| `apps/api/src/modules/methodology/config-resolver.ts` (BE-A) | `loadCatalogue` `default:` branch asks the providers' `catalogue` hook | ConfigResolver then resolves form elements exactly like the DG2 catalogues: the diff, preview and affected-records hooks all see relabelled source columns. |
| `apps/api/src/modules/methodology/invariants.ts` (BE-B) | `hasCatalogue()` (DG2 catalogue or provider catalogue); `prepareElementRemove` calls the kind's `validateRemove` first | The two refusals above. No behaviour change for the methodology and scoring kinds (their providers register neither hook). |
| `apps/api/src/modules/transformations/initializers.ts` (new), `transformations/index.ts` (export), `transformations/routes.ts` (one call after `p4_instantiate_transformation`) | The `TransformationInitializer` port | ARCH-02's handback asked BE-A for this port, and ADR-0041 §4 says "port wired by BE-A", but BE-A did not deliver it. This is the additive DG1 line that D-144 (a) accepted. The DG1 request and response are unchanged. |
| `apps/api/src/server.ts` | `registerTransformationInitializer("forms.pin", pinNewTransformationToForms)` and its imports | §B.2: "the `server.ts` registration line is named and owned here". |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[327, 326, 1]` → `[328, 327, 1]` (+ `putFormRecordCustomFields`, one JSON body) | The BE-B precedent (it updated the same line). |
| `apps/api/test/integration/methodology/studio-drafts.test.ts` (BE-A) | Adds the `form_schema` entry (unpinned, forms v1) to the expected pins list | By design: the kind now has a default key. |
| `apps/api/src/modules/methodology/studio-core.test.ts` (BE-A) | Default keys now include `"forms"`; `form_schema` element types are `["form", "form_field"]` | By design. |
| `apps/api/src/server.test.ts` (BE-A) | `forms` is `active` (no longer `scaffold`) | By design: the module routes 5 operations. |
| `apps/api/test/integration/transformations.test.ts` (DG1) | The create audit trail gains one `transformation_config_pin.create` | The forms pin of a new transformation (ADR-0041 §4; D-144 (a)). |
| `apps/api/test/integration/registers.test.ts` (DG2) | Starter structure: `pin: "2"`, `audits: "83"` (was 1 and 82) | Same reason. |

Not mine and not touched: `trading_agent/`, `tools/**`, `.claude/**`, `docs/source/**`, reviews, gates, `stages.json`, `findings.json`. The untracked files at the worktree top level (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`) were already there when I started (first `git status`). I did not create, edit or delete them.

## 2. Behaviour delivered, per requirement row

All tests named here are in `apps/api/test/integration/forms/form-schemas.test.ts` unless marked otherwise. They run against a real PostgreSQL 16 started by `tests/qa/support/with-pg.sh`.

### REQ-S05-002: acceptance "A06: adding an extension field to T03 publishes successfully; attempting to delete the T03 'Gap' column is rejected"

- An extension field `T03.risk_owner_note` (text, `maxLength` 500) is added to a Studio draft through `putConfigElement` (200), and `T03.gap` is relabelled with help added (200).
  - `runConfigPreview` with a T03 sample record → `pass`.
  - `runConfigCompatibilityCheck` → `pass`/`warn`.
  - `getConfigVersionDiff` lists `added:form_field:T03.risk_owner_note` and `changed:form_field:T03.gap`.
  - **The publish step is written as the owner role.** `publishConfigVersion` is BE-B3's and is not merged (its file `methodology/publish.ts` is still a stub). The owner writes a synthetic TO configuration review (pending → approved), then `approved`, then `published`. The 0062 publish guards accept it: a passing preview and compatibility for the current hash, plus the approved review.
  - `getFormSchemaAdmin?versionId=` then serves the field (`extension: true`, `settings {maxLength: 500}`) and the relabelled, `protected` gap column.
  - A later edit of the published version → 409 `config_version.not_editable`.
  - **The end-to-end API publish of a forms draft is proven only once BE-B3 lands** (§6).
- `removeConfigElement` on `form_field/T03.gap` → 422 `form_schema.source_column_protected`. A type change (`fieldType: number`) or a setting on a source column → 422 `form_schema.source_column_type_fixed`. Nothing is written (no element row).
- The other §10 definition-time refusals are tested with their exact code and English text: `extensions_not_allowed` (procedure_definition), `extension_key_invalid`, `field_type_unknown` (unknown or missing type), `field_settings_invalid` (choice without options; a reference to a planned type), `form_fixed` (adding a form, removing T03).
- An extension field can be removed in a draft (recorded). AUD and TO get 403 on element writes.

### REQ-S06-005: acceptance "a percentage field entered as 12% stores 0.12; a currency field stores decimal SAR without float error; a calculated field referencing an unknown field is rejected"

- `PUT …/custom-fields` with `adoption: "12%"` stores `"0.12"` (asserted on the database row and in the response).
- `budget: {amount: "1500000.10", currencyCode: "SAR"}` is stored and read back exactly. No float on any path: the KBE-B validators and decimal strings, and JSON numbers are refused with 400 `validation.decimal`.
- A calculated field `score * unknown_field` → 422 `form_schema.calculated_formula_invalid`, with the exact text; `score * 2` saves.
- Removing a calculated field's input makes compatibility `fail`. A new required field is a compatibility `warn` (`compatibility.required_field_added`).
- Calculated values are computed at read through the DG3 engine, unchanged (`3.50 × 0.12` → `0.42`). With an input cleared, the value is `not_computable` with `missingFields: ["risk_score", "adoption"]`, never 0.

### REQ-S16-010: acceptance "A06: a custom field value violating its schema is rejected by the API; core entities have typed columns and foreign keys"

- **API refusals before persistence (no row written):** each returns 400 with the field code:
  - a JSON number, Arabic-Indic digits → `validation.decimal`;
  - 250 % → `validation.percentage`;
  - three decimals in SAR → `validation.currency_amount`;
  - a lowercase currency code → `validation.currency_code`;
  - a duplicate, empty or wrong-shape choice → `validation.choice`.
  - The 422 cases: an unknown key and a calculated key → `form_record.custom_field_unknown`; a missing required field → `form_record.custom_field_required`.
- **The database refuses when the API is bypassed:** direct inserts are refused with `form_custom_value_type_shape`: JSON number, `"12%"`, a float amount, and the 0071 refused shapes. An unknown key is refused with `form_custom_value_unknown_field`.
- **Migration 0071 on PostgreSQL:**
  - Accepted: `["retail","online"]`, `["retail"]` (multiple), `"gold"` (single).
  - Refused: `[]`, `["retail","retail"]`, `["retail",7]`, a 101-character item, `[""]`, `"retail"` for a multiple field, `["gold"]` and `""` for a single field.
- Core entities keep their typed columns. Values live in the `form_custom_value` side table (ADR-0041 §4); no DG2–DG4 table changed.

### REQ-S05-006: acceptance "all twelve record types can be created and retrieved via the API; extension-type forms show the extension badge in en and ar" (BE-D part: registry reads, badge)

- `listFormRecordTypes` serves 33 native forms. `extensionBadge` is true for exactly the twelve M0149 types, in M0149 order. `getTransformationFormSchema` serves `recordType.extensionBadge` (e.g. `baseline`).
- Creating and reading the twelve types goes through their DG2–DG4 operations (ADR-0041 §1). The en/ar badge rendering is FE-C's.

### REQ-S05-001 (BE-D part: "validation, inline help reads")

- `getTransformationFormSchema` returns every field with resolved en/ar labels, help, type, settings, and the `required`, `protected` and `extension` flags, for the pinned version.
- Server-side validation of extension values as above. Drafts, history, comments, attachments, export, bulk edit and the recoverable conflict of the DG2 routes are BE-E/BE-E2's.

### Pins (ADR-0041 §4)

- A transformation created through `POST /transformations` is pinned to the newest published `forms` version, in the create transaction, with one `transformation_config_pin.create` audit event in the same request.
- A DG4-style transformation (no pin) reads forms v1 (`01920005-0200-…0001`, `versionNo 1`), and its custom values validate against v1, which has no extension fields (422 `custom_field_unknown`; an empty set saves).

### Mutation rules (p5-work-split §2 rule 4)

- `If-Match` `"0"` creates (200, ETag `"1"`).
- A second `"0"` → 409 `form_record.conflict` with `currentVersion: 1` and the exact text. A stale version with no row → 409 without `currentVersion` (the Problem schema's `Version` starts at 1).
- Missing `If-Match` → 428.
- Exactly one audit event per write, in the same request: `form_custom_value.create`, then `.update` with prior/new version.
- Authorization:
  - AUD (reads, cannot write) → 403;
  - TO on T14 (no `benefit.edit`) → 403;
  - ADM_METHOD, `nobody` and the other organization's TO → 404 (outside scope);
  - an unknown record or a record of another type → 404;
  - planned type → 422 `form_record.type_planned`;
  - `phase_step` → 422 `form_schema.extensions_not_allowed`.
- Commit-time re-authorization: grants revoked while the request waits → 403, and nothing is written.
- **Provider hooks:**
  - `getConfigAffectedRecords` on a forms draft counts the 6 T01 records of the pinned transformation.
  - `migrationItems` from base to draft lists `new_required_field` for `T01.sponsor_note`, with `recordType: diagnostic_item` (the `methodology_migration_item.record_type` CHECK accepts only `^[a-z_]+$`) and `recordCount: 6`.

## 3. Checks actually run (real exit codes; logs in `docs/delivery/handbacks/DG5/T-DG5-BE-D-evidence/`)

Environment: Node 24.21.0, offline. PostgreSQL from `/usr/lib/postgresql/*/bin` through `tests/qa/support/with-pg.sh` (ports 23850–23899 only). The machine's load average was about 17–19 on 4 CPUs throughout (other W4 runs).

| # | Command | Result | Log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 05:57Z) | **exit 0**: `PASS gate DG4 (historical)` | console (start of run) |
| 0' | the same, on the final tree (07:24Z) | **exit 0**: `PASS gate DG4 (historical)` | `validate-dg4-historical.log` |
| 1a | `pnpm -r typecheck` | **exit 0** | `typecheck.log` |
| 1b | `pnpm -r build` | **exit 0** | `build.log` |
| 1c | `pnpm lint` | **exit 0** | `lint.log` |
| 1d | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** (handback re-checked after writing: clean) | `prettier.log` |
| 1e | `pnpm openapi:lint` | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 763 operations` | `openapi-lint.log` |
| 2a | `pnpm test`, locale unset (`LANG`/`LC_ALL` unset) | **exit 1**. unit-node 1811/1812 (1 failed); unit-web 1384/1385 (1 failed); unit-formula-nocodegen 259 + 2 skipped. **Both failures are load timeouts, not assertions** (see below) | `unit-locale-unset.log` |
| 2b | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | **exit 1**. unit-node 1811/1812 (1 failed: the same timeout); unit-web **1385/1385**; unit-formula-nocodegen 259 + 2 skipped | `unit-c-utf8.log` |
| 2c | Isolated rerun: `npx vitest run --project unit-node apps/api/src/architecture.test.ts` | **exit 0**, 139/139. The walk test took 20.6 s of its 30 s limit, at a machine load of about 12 | `isolated-rerun-architecture.log` |
| 2d | Isolated rerun: `npx vitest run --project unit-web apps/web/src/pages/raid/raid.test.tsx` | **exit 0**, 18/18 (the failing case took 3.3 s alone) | `isolated-rerun-raid-web.log` |
| 3 | `QA_PG_PORT=23880 MTH_PORT_POOL=23881-23899 tests/qa/support/with-pg.sh pnpm test:integration` (final tree) | **exit 0**: 212/212 files, **2067/2067 tests** (07:03:55Z → 07:39:51Z, 2143 s) | `integration.log` |
| 4 | Focused integration during development: `…with-pg.sh npx vitest run --project integration apps/api/test/integration/forms` | final: exit 0, 17/17 | console |

**The `pnpm test` failures, disclosed.**

1. `apps/api/src/architecture.test.ts` › "every import respects dependsOn, public surfaces and allowed packages" timed out at its explicit 30 000 ms limit in both locale runs (F-DG2-143 set that limit). It walks every module file, and I added about 900 lines in six forms files plus the methodology hook lines. While it ran, the machine was at load 17–19 on 4 CPUs (other W4 agents), and my own integration run was in parallel. Alone (2c) it passes in 20.6 s. **The margin is thin on a loaded machine.** If the orchestrator's merged-tree verification shows the same, the limit (or the walk's cost) needs a decision. I did not change it: that test file's timeout is not mine.
2. `apps/web/src/pages/raid/raid.test.tsx` › "RAID and actions screens (en) › action register…" could not find a link within the default query timeout, under the same load. It is unrelated to this task (no web file changed), and it passes alone (2d) and in the C.UTF-8 run (2b, 1385/1385). It also failed (en and ar) in my first, superseded unit run under load.
3. **Acceptance 2 is therefore not demonstrated as a clean exit 0 in this run.** Re-run `pnpm test` in both locales on an unloaded machine; that is the first item of §7.

**Superseded runs (kept for honesty, `superseded-1-*.log`).** They ran on an intermediate tree and their failures were fixed afterwards:
- First unit run: 4 unit-node failures.
  - The architecture rule against computed member access with a non-literal key: fixed with `Map`s.
  - Three BE-A pins that changed by design: updated, §1.
  - Plus the raid load timeout, en and ar.
- First full integration run: 2066 tests, 2 failed.
  - The DG2 starter-structure pin (now 2 pins / 83 audits): updated, §1.
  - My own authorization test (T14 is a 403, permission before lookup): corrected.
- First static checks: all exit 0.
- Focused integration iterations (console only), each failure fixed:
  - the review row must start `pending`;
  - `nobody` on the registry needs 403 (`holdsAnywhere`);
  - out-of-scope PUT was 403 instead of 404 (scope now checked on the request-start principal before the commit-time check);
  - by-design pins in `studio-drafts` and `transformations`;
  - the media-type pin.

End time: 2026-10-14T07:40:32Z (`date -u`).

## 4. Operations routed (delta to my pending list)

`apps/api/test/support/p5-pending-be-d.ts`: 5 → 0. Removed: `listFormRecordTypes`, `getFormSchemaAdmin`, `getTransformationFormSchema`, `getFormRecordCustomFields`, `putFormRecordCustomFields`. Each is exercised in `p5-exercises-be-d.ts` through the validating client:

| Operation | Success | Refusals exercised |
|---|---|---|
| `listFormRecordTypes` | 200 | 400 (`kind=nope`), 403 |
| `getFormSchemaAdmin` | 200 (default version and `versionId`) | 400, 403, 404 |
| `getTransformationFormSchema` | 200 | 400, 404, 422 `type_planned` |
| `getFormRecordCustomFields` | 200 | 400, 404 |
| `putFormRecordCustomFields` | 200 (create with `"0"`, update) | 428, 409 `form_record.conflict`, 400 (field code and body shape), 422 `custom_field_unknown`, 422 `custom_field_required`, 403 (AUD), 404 |

The declared 403 of the two transformation-scoped GETs is not reachable by a scoped read: a caller without `transformation.read` in scope gets 404, by the platform rule.

**Pinned counts:**
- Media-type triple: `[327, 326, 1]` → `[328, 327, 1]`.
- Operation count unchanged (763).
- I made no rate-limit floor change.

## 5. Contract, schema and dependency needs for the orchestrator

1. **The outbox events of ADR-0041 §8 (`form_record.custom_values_updated`) are not emitted.** It needs two things outside my ownership: a payload schema in `packages/shared/src/schemas/events.ts` (`OUTBOX_EVENT_SCHEMAS`), and `jobs` in the `forms` `dependsOn` of `apps/api/src/modules.ts`. I tried the second, then reverted it so as not to edit both frozen files. The consumers are slice E notifications. Proposed: give the two lines to BE-E (which also emits `form_record.commented`) or to me in a repair.
2. **"409 … with the current representation" (ADR-0041 §5):** the 409 carries `currentVersion` and the exact text, but not the current values. `HttpProblem` has no extension member, and the Problem schema defines none. The client re-reads with `getFormRecordCustomFields` (ETag). If the representation is required, it needs an ADR/contract decision on a Problem extension member.
3. **`mapFormDbError`** maps the 0068 guard names to the §10 codes. It is used by the custom-values route only. The Studio element routes go through `platform/db-errors.ts`, which does not know the 0068 names. Those guards are unreachable there, because the API refuses first. If the orchestrator wants them mapped globally, one call line in `mapDatabaseGuardError` is needed (owner: whoever holds `db-errors.ts` P5 lines).
4. **No new dependency.** No contract change. Migration `0071` is the only schema change.
5. **The slice A lines in §1 ("outside my listed ownership")** need the orchestrator's confirmation. BE-B2 runs at the same time but owns other files, so I expect no textual conflict. BE-B3 and BE-C will build on `kinds.ts` and `invariants.ts` with the two new optional hooks.

## 6. User-facing texts

- No en/ar string is made untrue by this API-only task.
- `admin.plannedSections` (en: "Methodology, forms, workflows, automation and branding settings are planned for later releases.") stays true until the Studio and forms screens ship. It describes UI settings, and none ships here. **Owner: FE-B/FE-C**, who must correct it in both languages when the screens ship (as BE-A also noted).
- The problem keys my refusals use (`form_schema__*`, `form_record__*`) already exist in en and ar (FE-A, D-145 (2)).

## 7. What remains

0. **Re-run `pnpm test` in both locales on an unloaded machine** (acceptance 2). Both runs here exit 1 on load timeouts only (§3). The architecture walk's 30 s margin needs watching.
1. **End-to-end publish of a forms draft through `publishConfigVersion`:** BE-B3's operation (W5). My test proves the pipeline up to the database publish. A BE-B3 or QA test should add the API publish of a T03 extension field (REQ-S05-002 first clause).
2. **Outbox event** `form_record.custom_values_updated` (§5.1).
3. **409 representation** (§5.2).
4. **REQ-S05-006 en/ar badge rendering, the Studio fields screen, and the T01/T14 form screens:** FE-C.
5. **REQ-S06-008's "new required field" in the migration preview:** BE-C consumes `migrationItems` (provided and tested here).

## 8. Merge instructions

- Apply migration `0071` after `0070` and before `0074`. `listMigrationFiles` only requires strictly increasing ids, and the `seed.test.ts` range rule (ids from 0058 at most 0099) holds.
- Merge after BE-A, BE-B and KBE-B (all merged in `HEAD`).
- **Expected conflicts:**
  - `contract.test.ts` media-type pin line, if another W4 task adds a JSON body. Add the counts.
  - `server.ts` P5 wiring block: BE-B2 adds the material-change composition lines nearby.
  - `transformations/routes.ts`: none expected.
- The empty `.claude/.cc-writes` directories created by the write guard inside source folders were removed before each test run. Remove them again on integration (the migrate test copies the migrations folder non-recursively).
