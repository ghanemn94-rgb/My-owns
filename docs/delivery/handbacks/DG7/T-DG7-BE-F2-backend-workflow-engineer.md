# Handback T-DG7-BE-F2: configuration bundle residuals (backend-workflow-engineer)

- **Stage:** DG7 (P7 "Independent transfer and release"). Branch `claude/mobily-transformation-platform-dg6-regate`, base `b4f501c3f7519434306efdbc70d15d11e80791c7`. At the start the working tree was clean except for this run's own `docs/delivery/runs/` directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-F2.md` (sha256 `95c59c83…864f5`, verified). Read: p7-work-split §1, §2 and §D, ADR-0065, ADR-0040 §1–§4, p7-plan, D-243–D-266, the BE-F, BE-H and AN-P7 handbacks.
- **Invocation:** `DG7-T-DG7-BE-F2-backend-workflow-engineer-20261114T160053Z-6daaa4fb`, session `6daaa4fb-578f-49e0-8606-feb4a7668f8b`.
- **Time:** `date -u` at the start 16:01:05 UTC; at the end see §3.3.
- **Migrations added:** none.
- **API endpoints added:** none. One existing operation (`createConfigBundleExport`) has a new refusal for one kind. One existing operation (`uploadConfigBundleImport`) answers a malformed body that has no version with the uniform 400 instead of 422. Its request schema no longer requires `bundleSchemaVersion` (§2.3, Q1).
- **Two gate systems:** nothing here grants or records a G1–G6, Finance or IT approval. T-D7 includes a G1 decision and a migration approval, both by **synthetic** people in a disposable test database (demo decisions; they approve nothing real). Nothing reads or writes DG0–DG7.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `packages/shared/src/transfer/config-bundle.ts` | Adds `UNPORTABLE_BUNDLE_KINDS` (`automation_rule` → `/ownerUserId`), the documented exclusion with its ADR-0065 §2 and Residual 1 basis. Updates the header comment on how a missing version is answered. |
| `apps/api/src/modules/transfer/config-bundle/service.ts` | Adds `configBundleRefusals.unportableKind`. Export: a named unportable kind is 422 `config_bundle.unportable_reference` (pointer `/kinds/<i>`), and the default export never includes it. Upload (`checkBundle`): a present non-v1 version is 422 first, as before; an absent version gives the uniform 400 when the rest is not a valid envelope, and 422 when it is. |
| `docs/api/openapi.yaml` | `ConfigBundle` (request schema of `uploadConfigBundleImport`): `bundleSchemaVersion` is removed from `required` and is no longer constrained. The schema now matches its own description and ADR-0065 §2 ("checked by the server, not by this schema"). **Contract change, see Q1.** |
| `apps/api/test/integration/transfer/config-bundle.test.ts` | The export test now expects `unportable_reference` for `automation_rule` (two positions, nothing written). New: the `automation_rule` import refusal test. New T-D1 cases: a future-shaped v2 body and a non-string version give 422; a body with no version and no `exportId`, or a non-object body, gives the uniform 400. Nothing is stored in any of these cases. |
| `apps/api/test/integration/transfer/config-bundle-roundtrip.test.ts` | **T-D7** (new `describe` with two installations of its own). `publishDraft` now also runs the source-coverage check that a `methodology` publish requires. That is the existing operation and changes nothing for T-D6, which publishes no methodology draft. |
| `apps/api/test/integration/contract/p7-exercises-be-f.ts` | T-D9: the new 422 `config_bundle.unportable_reference` export refusal, validated against the contract. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-F2-evidence/*.log` | The check logs listed in §3. |

`apps/api/test/support/p7-pending*.ts`: every list was already empty at the base, so there was nothing to remove.

## 2. Behaviour per requirement: REQ-S19-008 (the three items of AN-P7 §2.2 item 3)

### 2.1 `automation_rule`: a documented exclusion backed by ADR-0065 (no adapter)

I chose the exclusion, not the adapter. ADR-0065 decides this case. §2 says "A reference that has no stable key (for example a user id inside a configuration) fails the export with 422 `config_bundle.unportable_reference`, naming the kind, key and field." Residual 1 says such a kind "is refused at export with `config_bundle.unportable_reference` and listed in BE-F's handback and in known limitations." Every admin rule names its owner by user id (`automation_rule.owner_user_id`; `createAutomationRule` requires an active `ownerUserId`). A transformation-scoped rule also names its transformation by id. Giving an imported rule another owner in the target would be a product decision that the ADR does not make.

Behaviour now:

- **Export naming the kind:** 422 `config_bundle.unportable_reference`, detail = the D.2 English text. The single error has pointer `/kinds/<i>` and a message that names `automation_rule /ownerUserId`. No export row and no stored object are written. Before this task the answer was `kind_unavailable`, which the ADR does not back for this case.
- **Default export (all kinds):** leaves the kind out and lists only the kinds it covered in `kinds` (as before). This is now asserted for the bundle content too.
- **Import of an item of the kind:** upload is accepted (envelope only). Validate plans it `refused` with `config_bundle.kind_unavailable` (no adapter is registered; `kind_unavailable` is one of the three D.2 item codes, while `unportable_reference` is an export code) and the import is `invalid`. Commit is 422 `config_bundle.not_committable`. No `automation_rule` row, no `automation_rule_version` row and no commit row are written. The import's audit trail is `uploaded` and `validated` only.
- `automation_rule_set` (the Studio kind) still travels, so M0356's "automation configuration" is covered for rule sets, not for individual rules.

**Tests (ran, passed):**
- `config-bundle.test.ts`: "automation_rule named in the request is 422 unportable_reference (ADR-0065 §2, Residual 1), never left out", and "plans an automation_rule item refused with kind_unavailable; the import cannot be committed; nothing is written".
- The contract exercise (T-D9) validates the new 422 against the contract.
- Authorization, validation and audit for these paths are unchanged, and the T-D5 tests (403 for AUD and for a user without grants on all nine operations) still pass.

### 2.2 T-D7: publish semantics unchanged after import (work split §D.3)

`config-bundle-roundtrip.test.ts`, "T-D7 an imported draft is published, and migrated to, exactly as a hand-made one". It uses two clean disposable installations, `hand` and `imp`. In each, a running transformation is pinned to the migration-seeded `playbook` version, and its G1 is approved through the real DG2 path.

1. **Hand-made change in `hand`.** A Studio draft is created from the pinned version, and a new mandatory G1 `checklist_item` is added through the element operation. The draft is published through the existing operations: preview, compatibility, source coverage, TO review, publish.
2. **The same change imported into `imp`.** `hand`'s export (kind `methodology`) is uploaded and validated: only `playbook` is `new_draft`, and the rest is `identical`. It is committed as a draft and published through the same operations. The published `contentSha256` equals `hand`'s.
3. **"The pin is unchanged until then."** In both installations, after the commit and after the publish, the methodology pin still names the original version, with zero `methodology_migration` and zero `gate_reapproval` rows.
4. **The publish creates the same records.** The audit events (action, record type) and outbox event types written from the start of the publish pipeline to the publish are compared as sorted multisets without ids, and they are equal in both installations.
5. **The ADR-0040 migration is the same.** Create (plan), submit, SP approves, ADM_METHOD executes, the same steps in both installations. Compared and equal:
   - the plan items: kind, stable key, gate code, resolution and reasons, including `["reapproval","G1","G1","automatic",[{checklist_item, synthetic.t-d7-g1-check, added}]]`;
   - `planReady`;
   - the `gate_reapproval` rows (`[["G1","required",true]]`, with a work item);
   - the pin-history kinds;
   - the audit and outbox multisets of the whole migration (asserted non-empty: they include `methodology_migration.execute`, a `gate_reapproval` event and a `transformation_config_pin` event).

   Each pin then names its own new version.
6. **The test is not vacuous (mutants, recorded).** In mutant 1, the imported draft gets an extra G2 item, and the test fails on the content-hash guard (`02-td7-mutant.log`, exit 1). In mutant 2, it gets an extra G1 item and the hash guard is removed, and the test fails on the migration comparison (`03-td7-mutant2.log`, exit 1). Both mutant files were temporary copies and are deleted.

### 2.3 Route-inventory case 4 (422 vs 400): fixed and recorded

- **Cause.** Case 4 deletes the first `required` property of a generated minimal body. For `uploadConfigBundleImport` that was `bundleSchemaVersion`, and the server answers a missing version with 422 `schema_version_unsupported` (ADR-0065 §2, T-D1). Only removing the field from `required` (the contract now matches its own description) does not help: the generated minimal body then has no version at all, so deleting `exportId` still reached the version check first. Run `04-integration-route-inventory-contract.log` shows this: case 4 `{"400":489,"422":1}`.
- **Change (server, `checkBundle`).**
  - A **present** version other than `mth-config-bundle/1` is still 422 before anything else, whatever the body's shape (another release's format may have another shape).
  - An **absent** version names no other release, so the body is first checked as a v1 envelope. If it is not one (not an object, or a required field is missing or malformed), the answer is the uniform 400 with pointers (ADR-0051 §5; REQ-S16-027). If it is one, the answer is 422 `schema_version_unsupported`, so T-D1's "missing" case is unchanged.
  - Nothing is stored in any of these cases (tested).
- **Recorded run (`05-integration-final.log`).** `[route-inventory] case 4 invalid input: 490 eligible operations swept; statuses {"400":490}; … changed 0 (none)`. Route-inventory 10/10, in a run of 6 files and 286 tests, exit 0.
- **T-D1 stays as specified:** `mth-config-bundle/2`, `""` and a missing field on an otherwise valid bundle each give 422 with nothing stored. Four new cases: a v2 body of another shape (422), a non-string version (422), no version and no `exportId` (400 with `/exportId`), and a non-object body (400).
- This is a nuance to ADR-0065 §2's "reads `bundleSchemaVersion` before anything else", for the absent field only. **Q1 asks the architect to confirm it.**

## 3. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, disposable PostgreSQL 16.15 via `tests/qa/support/with-pg.sh` (ports 27613–27681). Logs are in `docs/delivery/handbacks/DG7/T-DG7-BE-F2-evidence/`. **The authoritative runs are in `final/`.** They ran on the final source, after the last code change. Rows 00–10a are the development history, with every non-zero exit disclosed.

### 3.1 Final source (authoritative)

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 12 | `QA_PG_PORT=27681 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/hardening/route-inventory.test.ts apps/api/test/integration/contract/contract.test.ts apps/api/test/integration/contract/response-validation.test.ts apps/api/test/integration/transfer/config-bundle.test.ts apps/api/test/integration/transfer/config-bundle-roundtrip.test.ts packages/db/test/integration/p7-transfer-guards.test.ts` | 0 | 6 files, **286/286**. `[route-inventory] case 4 invalid input: 490 eligible operations swept; statuses {"400":490}; … changed 0 (none)`. Route-inventory 10/10, contract 111/111, response-validation 119/119, config-bundle 23/23, round trip 2/2 (T-D6, **T-D7**), p7-transfer-guards 21/21 | `final/12-integration.log` |
| 13 | `pnpm -r typecheck` | 0 | every package `Done` | `final/13-typecheck.log` |
| 14 | `pnpm lint` | 0 | no findings | `final/14-lint.log` |
| 15 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `final/15-openapi-lint.log` |
| 16 | `pnpm test` | 0 | unit-node 205 files, 3022 tests; unit-web 130 files, 2175 tests; unit-formula-nocodegen 3 files, 259 passed + 2 skipped | `final/16-pnpm-test.log` |
| 17 | `node tools/gates/validate.mjs --historical --stage DG6` (after the handback's last edit) | see §3.3 | | `final/17-validate-dg6-historical.log` |
| 18 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (after the handback's last edit) | see §3.3 | | `final/18-prettier.log` |

### 3.2 Development history

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 00 | `with-pg.sh npx vitest run --project integration …/config-bundle.test.ts …/config-bundle-roundtrip.test.ts` | 0 | 19/19. This run started while the first exclusion edits were being saved, so it is a reference run, **not** a clean pre-change baseline. | `00-baseline-config-bundle.log` |
| 01 | the same two files, after the exclusion and T-D7 were added | 0 | 21/21 (T-D7 passed on its first run, hence the mutants) | `01-config-bundle-run1.log` |
| 02 | T-D7 mutant 1 (temporary copy, extra G2 item) | **1** (expected) | fails on the content-hash guard | `02-td7-mutant.log` |
| 03 | T-D7 mutant 2 (temporary copy, extra G1 item, hash guard removed) | **1** (expected) | fails on the migration comparison | `03-td7-mutant2.log` |
| 04 | the six integration files of row 12 (contract-only fix) | **1** | 280/282. Case 4 `{"400":489,"422":1}` (`uploadConfigBundleImport`, cause in §2.3). T-D7 failed on a wrong non-vacuity assertion of mine (no `methodology_migration.executed` outbox event, §4.4); the comparisons themselves passed. Both fixed. | `04-integration-route-inventory-contract.log` |
| 05 | the six integration files after the `checkBundle` change | 0 | 286/286, case 4 `{"400":490}` | `05-integration-final.log` |
| 06 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` | `06-validate-dg6-historical.log` |
| 07–09 | `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` | 0, 0, 0 | | `07-typecheck.log`, `08-lint.log`, `09-openapi-lint.log` |
| 10 | `pnpm test` | **1** | one failure, mine: `apps/api/src/architecture.test.ts`, "computed member with a non-literal key (line 489)" in `service.ts` (`named[unportable]!`). It was replaced by a loop over `named.entries()`. unit-web and formula passed in this run. | `10-pnpm-test.log` |
| 10a | `npx vitest run --project unit-node apps/api/src/architecture.test.ts` (after the fix) | 0 | 142/142 | `10a-architecture-after-fix.log` |

That fix changed `service.ts`, so every check above was rerun on the final source (§3.1).

### 3.3 After the handback's last edit

- Row 17, `node tools/gates/validate.mjs --historical --stage DG6`: exit 0, `PASS gate DG6 (historical)`.
- Row 18, the Prettier check over `git ls-files -co --exclude-standard`: exit 0, `All matched files use Prettier code style!`.
- Both were run again after this section was written, and the logs hold that last run.
- Time at the end (`date -u`): 16:58 UTC, about 57 minutes after the start.

## 4. Known gaps

1. **`automation_rule` does not travel.** It is a documented exclusion, not an adapter. M0356's "automation … configuration export/import" is met for `automation_rule_set` only. An adapter needs a product decision on the imported rule's owner (and on transformation-scoped rules and the platform starters), which belongs in an ADR-0065 amendment (Q2).
2. **Known-limitations line not written.** Residual 1 says such a kind is "listed in … known limitations". `docs/handover/known-limitations.md` and its AR summary belong to DOC-B, so I did not edit them. Proposed row: "| ADR-0065 | Automation rules (`automation_rule`) are not carried by configuration bundles: every admin rule names its owner by user id, which has no stable key. An export that names the kind is refused with `config_bundle.unportable_reference`; an imported item of the kind is refused. Automation rule sets (Studio) are carried. |" (Q3).
3. **The web export screen still offers the `automation_rule` checkbox.** FE-B's `ConfigTransferPages.tsx` lists all 12 `CONFIG_BUNDLE_KINDS`. Ticking it now shows the 422 `unportable_reference` text, which already exists in EN and AR in `problems.json`. Hiding it via `UNPORTABLE_BUNDLE_KINDS` is FE-B's file (Q3).
4. **Observation outside my scope: no `methodology_migration.executed` outbox event.** ADR-0040 §4 says execution writes the outbox event `methodology_migration.executed`. In run 04, the outbox events of the hand-made migration were three, starting with `inbox_notification.created` (Vitest truncated the rest), and `methodology_migration.executed` was not among them. `git grep "methodology_migration.executed" -- apps packages` finds only database constraint names, and no code emits that event type. It is identical in both T-D7 installations, so T-D7 is unaffected. It needs a reviewer's or the orchestrator's triage (not a REQ-S19-008 item).
5. **`docs/handover/api/openapi-coverage.json` is stale.** Its `openapiSha256` (`e31b4758…`) already differed from the base's `openapi.yaml` (`791aefa0…`), and my contract edit changes the file again (`aa64d143…f1e7840f` after this task). Nothing checks the pin for equality, but the file should be regenerated by its owner (`tools/release/openapi-coverage.mjs`, DO-H) at the freeze.
6. Unchanged BE-F gaps 3–7 (new Studio key, partial reference checks, canonical stored bytes, kind switch, screen) are still open. This task did not address them.

## 5. Open questions and merge instructions

- **Q1 (architect; contract and ADR-0065 §2 nuance).** Please confirm two things:
  - the `ConfigBundle` request-schema change (`bundleSchemaVersion` neither required nor constrained, matching the schema's own description);
  - the absent-version rule: uniform 400 when the rest is not a v1 envelope, 422 when it is.

  The alternative is to pin `4:uploadConfigBundleImport` in route-inventory's `REPORTED_DEVIATIONS`. That list is documented as "only shrinks", so I did not choose it.
- **Q2 (architect).** Should `automation_rule` get an adapter in a later release? If so, ADR-0065 needs an amendment that decides the owner of an imported rule (for example the importing user or a role), the handling of transformation-scoped rules, and whether the platform starters' settings travel per organization.
- **Q3 (orchestrator, routing).** The known-limitations row (gap 2) goes to DOC-B, and hiding the checkbox (gap 3) goes to FE-B.
- **Merge:** no migrations. Six source and test files plus the contract. Expect a conflict only if another task touches `ConfigBundle` in `openapi.yaml` or the BE-F exercise. The contract test's media-type pins are unchanged (no request body was added).
