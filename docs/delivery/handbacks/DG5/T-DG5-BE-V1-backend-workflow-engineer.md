# Handback T-DG5-BE-V1 (backend-workflow-engineer): DG5 round-1 repair of F-DG5-100

- **Stage:** P5, gate DG5, FIXING after round 1 on candidate `sha256:8e7d23a3…` (D-170).
- **Invocation:** run `DG5-T-DG5-BE-V1-backend-workflow-engineer-20261018T051523Z-65d64a5b`, session `65d64a5b-5503-4894-b647-3e720ca6633b`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-V1.md`. Its SHA-256 `d87744297c1c2a28…2467dd` was checked before reading.
- **Working tree:** `/home/user/wt/dg5-be-v1`, branch `dg5/be-v1`, starting `HEAD` `e0cfdafcfbd8c723fbb58809e064fb11e037d9e0`. The changes are **uncommitted**, as instructed.
- **Time:** started `2026-10-18T05:15:46Z`; checks finished `06:02:40Z` (about 47 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited 0 at the start (`PASS gate DG4 (historical)`, `T-DG5-BE-V1-evidence/validate-dg4-historical-start.log`) and at the end (`validate-dg4-historical-end.log`).
- No business, Finance or IT approval was granted. A configuration review is not a G1–G6 approval, and nothing here touches DG0–DG7. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/db/migrations/0097_p5_config_review_contributors.sql` (new) | The two append-only contributor tables. Recording triggers on every content table of a draft. The two named decision refusals. The backfill and its migration audit events. |
| `packages/db/src/schema.ts` | The two new tables only: interfaces, the `Database` block, row types and `SCHEMA_COLUMNS`. |
| `apps/api/src/modules/methodology/contributors.ts` (new) | `configContributors` and `configAuthors`: the creator plus the recorded contributors. Read-only. |
| `apps/api/src/modules/methodology/reviews.ts` | The decision refuses an author, meaning the creator or any contributor (403 `config_review.self_review`). Review tasks of a later round skip authors. Header comments updated. |
| `apps/api/src/modules/methodology/revision-impact.ts` | The first-round review routing of the S12-018 proposal skips every author, not only the creator. |
| `apps/api/src/modules/automation/lifecycle.ts` | `versionAuthors`: the decision refuses `authored_by` and any contributor (403 `automation_rule_version.self_review`). Review tasks skip authors. Header comment updated. |
| `apps/api/src/modules/platform/db-errors.ts` | The two new constraint mappings only (§2.4). |
| `apps/api/test/integration/methodology/studio-coauthor-review.test.ts` (new) | The reviewer's reproduction as a product test, plus 8 further tests (§2.5). |
| `apps/api/test/integration/automation/rule-coauthor-review.test.ts` (new) | The same gap on rule versions: 4 tests. |
| `packages/db/test/integration/catalogue.test.ts` | Adds the `mth_app` privileges of the two tables and a 0097 trigger test. The three older trigger snapshots (0062-0063, 0068-0070, 0074-0075) now exclude `%contributor%` triggers, which the new 0097 test checks instead. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-V1-*` | This handback and its logs. |

No contract change, no new operation, no new response shape, no new dependency. `docs/api/openapi.yaml` and the zod mirrors are untouched.

## 2. F-DG5-100 (Medium, mandatory; REQ-S06-007)

### 2.1 Cause

- `reviews.ts:333` (before the fix) refused only `actor.userId === review.requested_by || actor.userId === current.created_by`.
- The database backstops compared only the same two people:
  - the requester CHECK `config_review_request_reviewer_not_requester`;
  - `config_review_request_reviewer_not_author` (0062:441-444), which reads `methodology_version.created_by`.
- Any `methodology.configure` holder may write another admin's draft. The write paths are:
  - `drafts.ts` `updateDraft` (PATCH);
  - `elements.ts` element PUT and remove;
  - the kind providers' writers, for example the procedure definition PUT.
- So a second admin who also holds TO could write the content, let the creator submit it, approve the review and publish it.
- **The same gap existed on automation rule versions.**
  - Any `automation.configure` holder of the rule's organization may PATCH another author's draft version (`versions.ts` `updateVersion`; `rules.ts` `loadRuleForWrite` checks the organization only).
  - `lifecycle.ts` `decideReview` and the 0074 CHECK `automation_rule_version_review_sod` compared only `authored_by`.

### 2.2 The rule applied (D-170)

- A person who wrote any part of a configuration draft is one of its authors, and an author never decides its review.
- The authors of a Studio draft are its `created_by` plus every recorded contributor.
- The authors of a rule version are its `authored_by` plus every recorded contributor.
- The decider is also never the requester (unchanged).

### 2.3 How contributors are recorded, and why this way

**Why triggers.**
- The database has no session-actor setting. I found no `set_config` or GUC for the actor.
- Writes to a draft's content come from several modules: methodology, the kind providers in `procedures/`, `forms/` and `health/`, and future providers.
- An API-side record would depend on every writer remembering to call it. Database triggers on the content tables cannot be skipped by any write path, including future ones.
- Each write's actor is therefore read from two sources, both inside the writer's own transaction:
  1. **The row's own actor column, at once** (`p5_config_contributor_from_row`, AFTER ROW). This is `updated_by`, or `created_by` on an INSERT that has no `updated_by`. Every API writer stamps it with the acting user.
  2. **The write's audit event, at COMMIT** (`p5_config_contributor_from_audit`, a deferred constraint trigger). It takes `actor_user_id` and `on_behalf_of_user_id` of the `audit_event` whose `record_type` is the table, `record_id` the row and `new_version` the row's version.
     - The deferred P2 guard `p2_audit_required` already makes that event mandatory for every write to these tables.
     - So a writer that forgot to stamp `updated_by` is still recorded under the person its audit event names. This is tested.

**What counts as content.** The tables are the ones the content hash and the diff cover:
- `methodology_version` (0097:155-168): the draft's INSERT, and UPDATEs that change `title_en`, `title_ar`, `definition`, `change_summary` or `content_sha256`;
- `methodology_element` (0097:171-174): every element kind, which covers methodology, scoring defaults, form schemas and health-check schemes;
- `procedure_definition` and `procedure_step_definition` (0097:175-182): the procedure kind's `diffRows`;
- `automation_rule_version` (0097:185-201): INSERT as a draft, and UPDATEs that change the content columns of `versions.ts` `CONTENT_COLUMNS` while it is a draft.

Writes that only move the stage or status do not count: submit, decide, withdraw, publish and discard record nobody. So a TO who requested changes does not become an author by deciding, and can decide the next round. This is tested on both paths.

**The tables** (0097:51-74):
- `methodology_version_contributor (methodology_version_id, user_id, first_written_at)` and `automation_rule_version_contributor (automation_rule_version_id, user_id, first_written_at)`.
- Primary key (version, user); foreign keys to the version and to `app_user`.
- Append-only through `p2_attach_append_only`, which refuses UPDATE, DELETE and TRUNCATE.
- `mth_app` holds `INSERT, SELECT` only. A direct INSERT by the runtime role can only add refusals, never remove one.
- No `SECURITY DEFINER` was introduced, because the repository has no precedent for it.

**Audit coverage (ADR-0004 / ADR-0039).**
- A contributor row has no `id` or `version`. At run time it is derived from an audited write in the same transaction, and that write's audit event names the person. The 0094 precedent likewise records a fact already in the audit trail without a second event.
- The backfill writes one `audit_event` per backfilled draft (0097 §4): `actor_type 'system'`, `source 'migration'`, action `methodology_version.contributors_backfill` or `automation_rule_version.contributors_backfill`, on the version's own record, with `changes.contributors {from: null, to: [user ids]}`.
- The version rows themselves are not written, so their versions, ETags and audit histories do not move.

**The backfill** (0097:250-305): forward-only, run only for drafts open at migration time, idempotent by primary key, and only for existing users.
- **Studio drafts** (`status = 'draft'`, not discarded) record:
  - `created_by` and `updated_by`, as the assignment states;
  - every actor of an audited content write of the version row (an event whose `changes` names a content column);
  - every actor of an audited write of any of the draft's element or procedure rows.
- **Rule versions** (`draft`, `in_review`, `approved`) record `authored_by`, `created_by`, `updated_by`, and the actors of `automation_rule_version.create` and `.update` events.
- **Disclosed effect.** Using `updated_by` errs towards refusing a reviewer. For example, a TO who requested changes on a draft that was open at migration time is stamped as its `updated_by`, so after the backfill that TO is a contributor of that draft. It never errs towards allowing an author.

### 2.4 The refusals

**API.**
- `reviews.ts:339`: `actor.userId === review.requested_by || (await configAuthors(tx, current)).includes(actor.userId)` throws `studioRefusals.selfReview()`. That is `403 config_review.self_review`, with the existing text "You cannot review a configuration change you authored or requested."
- The check runs inside the decision transaction, after the version and the review request are locked (`lockVersion`, `lockedReview` FOR UPDATE), so it is re-checked at commit time.
- `lifecycle.ts:341`: `(await versionAuthors(tx, v)).includes(userId)` throws `lifecycleRefusals.selfReview()`. That is `403 automation_rule_version.self_review`, "You cannot review a version you authored." The version is locked FOR UPDATE first.

**Database**, through the runtime role:
- `config_review_request_sod_contributor` (BEFORE INSERT OR UPDATE; 0097:211-224) raises `config_review_request_reviewer_not_contributor` when `decided_by` is set to a recorded contributor.
- `automation_rule_version_sod_contributor` (0097:226-241) raises `automation_rule_version_reviewer_not_contributor`. It fires when `reviewed_by` is set to a contributor, or on the in_review → approved/draft decision.
- **Firing order.** Trigger names sort after the 0062/0074 guard triggers, so a direct write by a draft's creator still reports `config_review_request_reviewer_not_author`. This is tested.
  - CHECK constraints run after all BEFORE triggers. A direct decision by a rule version's `authored_by`, who is always a contributor, therefore now reports the new constraint before the 0074 CHECK `automation_rule_version_review_sod`. It is the same refusal, and it maps to the same 403.

**Mapping** (`db-errors.ts`):
- `:2628`: `config_review_request_reviewer_not_contributor` joins the existing `self_review` case, giving 403 `config_review.self_review` with the same text.
- `:2712`: `automation_rule_version_reviewer_not_contributor` gives 403 `automation_rule_version.self_review` with the ADR-0043 §9 text.

**Routing.** No review task is created for an author:
- `revision-impact.ts:310` handles the first round;
- `reviews.ts:293` handles a later round of the same content;
- `lifecycle.ts:258` handles rule versions.

**Publish.** Where review is required, publishing needs an approved review of the exact content hash (the unchanged 0062 guard `methodology_version_review_required`). A contributor's decision is refused, so they cannot produce that approval. Tested:
- Studio: the co-author's publish gives `422 config_version.review_required`;
- rule version: publishing an in-review version gives `422 automation_rule_version.invalid_transition`, and the version stays `in_review`;
- in both cases, a non-contributor TO then approves and the version publishes.

**Other "review where configured" paths, checked.**
- **Studio kinds** (methodology, scoring defaults, form schema, procedure, health-check scheme): all go through `config_review_request`. They are covered by the triggers above, and the procedure kind is tested.
- **`automation_rule_set` / rule versions:** the same gap existed. It is closed and tested.
- **`benefit_formula` policy** (S12-018 case 2, `revision-impact.ts` `proposeFormulaRevision`): the policy only routes review tasks to FIN except the editor.
  - The decision is the DG3 Finance validation, outside `config_review_request`, and outside my ownership and D-170's scope. I did not change it.
  - A DG3 formula version is created once by one editor (`benefitFormulaVersionCreated`). I did not find a path where a second person rewrites another editor's formula version, but I did not prove that with a test.
  - Listed in §6 for the orchestrator.
- **`methodology_migration` approval** (`migrations.ts` `decideMigration`): this is a business approval (`methodology_migration.approve`, SP), not a configured review.
  - It refuses the requester and the submitter. Another `methodology_migration.plan` holder can re-plan (`previewMigration`) a migration someone else requested.
  - Whether a re-planner may approve is governed by the DG4 canonical approval SoD, not by D-170. I did not change it. Listed in §6.

### 2.5 Regression tests

**`apps/api/test/integration/methodology/studio-coauthor-review.test.ts`** (9 tests; its own scratch database, because the backfill test runs DDL):
1. **The reviewer's reproduction, with its final assertion kept:** `expect([d.status, d.body?.code]).toEqual([403, "config_review.self_review"])`. It also checks the refusal text, that publish gives 422 `config_version.review_required`, that neither author got a review task, and that an independent TO then approves (200) and the creator publishes (200).
2. An element PUT alone makes its writer a contributor in the same request. Approve and request_changes are both 403.
3. The creator (who also holds TO) and a requester who wrote nothing both get 403. A TO who wrote nothing approves; the draft publishes; publishing records no contributor.
4. Deciding a round (request changes) does not make the reviewer an author. The same TO decides the next round with 200.
5. A procedure definition PUT by a second admin makes them a contributor of the procedure draft.
6. A write that leaves `updated_by` stale is recorded at COMMIT under the actor of its audit event.
7. **Database, runtime role (`mth_app`), rolled back:**
   - a direct `UPDATE config_review_request` recording the co-author's decision is refused with `config_review_request_reviewer_not_contributor`;
   - the creator's is refused with `config_review_request_reviewer_not_author`;
   - an independent decider's passes the SoD triggers.
8. Append-only: the runtime role's UPDATE and DELETE on `methodology_version_contributor` are refused.
9. **The backfill:** 0097 is re-applied exactly as shipped to the pre-0097 schema, in a rolled-back transaction. A co-author whose writes were all overwritten later, so no row's `updated_by` names them, is still recorded through the audit trail. There is exactly one `system`/`migration` audit event, with the contributor list, and no published version is backfilled.

**`apps/api/test/integration/automation/rule-coauthor-review.test.ts`** (4 tests):
1. A second admin (ADM_METHOD + TO) PATCHes another author's v1 and is recorded.
   - Their approve and request_changes are both `403 automation_rule_version.self_review`, with the text checked.
   - Neither author gets a review task.
   - Publishing the in-review version gives 422.
   - An independent TO approves and the version publishes.
2. Deciding a round does not make the reviewer an author: the same reviewer decides the next round with 200.
3. **Database, runtime role, rolled back:** the co-author's and the author's direct decisions are refused with `automation_rule_version_reviewer_not_contributor`; an independent one passes.
4. Append-only for the runtime role.

**`packages/db/test/integration/catalogue.test.ts`:** the new "0097" test lists all 20 contributor triggers with their deferrability, and checks that no backfill audit event is orphaned. The privilege map gives `INSERT,SELECT` on both new tables.

### 2.6 Failing before, passing after

**Before.** The tree was HEAD `e0cfdaf` with the fix set aside: no 0097, and the five API/schema files restored from `HEAD`. Only the new test was added. Command:
`QA_PG_PORT=23001 MTH_PORT_POOL=23002-23049 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/methodology/studio-coauthor-review.test.ts -t "the co-author's approval of their own content"`

The result was exit 1 (`T-DG5-BE-V1-evidence/repro-failing-before.log`):
```
applied 88 migrations to a fresh database
co-author review decision 200 approved publish 200 undefined
× … the co-author's approval of their own content should be 403 config_review.self_review
  → expected [ 200, undefined ] to deeply equal [ 403, 'config_review.self_review' ]
Tests  1 failed | 5 skipped (6)
exit=1
```
This matches the reviewer's log: the decision gave 200 `approved`, and publish gave 200.

**After.** The same command gave exit 0 (`repro-passing-after.log`):
```
co-author review decision 403 config_review.self_review publish 422 config_version.review_required
Tests  1 passed | 8 skipped (9)
exit=0
```

## 3. Checks actually run

Environment: Node 24.21.0, offline, PostgreSQL 16.13 disposable cluster (`tests/qa/support/with-pg.sh`, port 23001, pool 23002–23049, UTF8/C). The heavy checks ran one at a time (D-164). Logs are under `docs/delivery/handbacks/DG5/T-DG5-BE-V1-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | PASS gate DG4 (historical) | `validate-dg4-historical-start.log` |
| 2 | `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | all packages Done | `build.log` |
| 4 | `pnpm lint`, first attempt | **1** | 1 error: unused `requesterId` in my new test | `lint-attempt1-exit1.log` |
| 4b | `pnpm lint`, after the fix (the variable now backs an assertion that the review request records the requester) | 0 | clean (`--max-warnings=0`) | `lint.log` |
| 4c | `pnpm typecheck` in `apps/api` (its tsconfig includes `test`), re-run because 4b edited a test after #2 | 0 | — | `typecheck-api-after-lint-fix.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All matched files use Prettier code style | `prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | PASS, OpenAPI 3.1.1, 846 operations | `openapi-lint.log` |
| 7 | `npx vitest run --configLoader runner --project unit-node apps/api/src/modules/methodology apps/api/src/modules/automation apps/api/src/modules/platform packages/db/src`, with LANG/LC_* unset | 0 | 31 files, **270 passed** | `unit-locale-unset.log` |
| 8 | the same with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | 31 files, **270 passed** | `unit-c-utf8.log` |
| 9 | `with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/methodology apps/api/test/integration/automation apps/api/test/integration/contract.test.ts packages/db/test/integration` | 0 | 37 files, **424 passed**, 310.9 s. Includes both new files (9 + 4) and catalogue (29). | `integration-required.log` |
| 10 | `with-pg.sh npx vitest run … --project integration apps/api/test/integration/contract/contract.test.ts apps/api/test/integration/procedures apps/api/test/integration/forms apps/api/test/integration/health` | 0 | 16 files, **234 passed**, 222.5 s. `contract/contract.test.ts` 83 passed. | `integration-contract-and-trigger-reach.log` |
| 11 | the reproduction alone, before (§2.6) | **1** | expected failure: the regression test failing before the fix | `repro-failing-before.log` |
| 12 | the reproduction alone, after | 0 | 1 passed | `repro-passing-after.log` |
| 13 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | PASS gate DG4 (historical) | `validate-dg4-historical-end.log` |

**Disclosures.**
- **The contract path in the assignment does not exist.** `apps/api/test/integration/contract.test.ts` is actually at `apps/api/test/integration/contract/contract.test.ts`. Vitest path arguments are substring filters, so run #9 matched no contract file (its file list has none). I ran the real file in #10, where it passed 83/83. Run #10 also covers `procedures`, `forms` and `health`, because the 0097 triggers fire on their draft writes.
- **Development runs.** Before the final runs, I ran the new files individually several times while writing them. One of those runs failed on an assertion of mine: I expected `review_required` when publishing an in-review rule version, but the product returns `invalid_transition`. I corrected the expectation, not the product. The three older catalogue trigger snapshots also failed until I excluded the new triggers from them, as described in §1. No final run shows a failure, flake or timeout.
- **Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. They are reserved for the orchestrator's verification of the merged tree. No e2e spec is reached, because there is no web change.

## 4. Contract, schema and dependency needs

- **Contract:** none. No operation and no response shape changed. The 403 codes and texts are the existing ADR-0039 §13 and ADR-0043 §9 ones.
- **Schema:** the new migration `0097_p5_config_review_contributors.sql`, the only one in this wave. Two new tables, each with `INSERT, SELECT` for `mth_app`.
- **Dependency:** none.

## 5. ADR and data-dictionary statements made untrue or incomplete (for T-DG5-ARCH-R4)

**ADR-0039:**
- §5 (line 105): "the reviewer is never the requester (CHECK) nor the draft's author (trigger) (RR01–RR03)". Add: nor any recorded contributor of the draft (0097 `config_review_request_reviewer_not_contributor`). Define "author" as the creator plus every person who wrote content (0097 contributor record).
- §5 (line 105) also says one `config_review` work item goes per active holder of the reviewer role. It now excludes every author, not only the creator and requester.
- §9 table (line 134): "TO; never the author or requester" stays true under the D-170 definition of author. Spell the definition out.
- §1 / data model: add `methodology_version_contributor`, its triggers and its backfill.

**ADR-0043:**
- §4/§8 (line 89): "a holder of `automation.review` … other than the author approves (`automation_rule_version_review_sod`, AV13)". Add the contributor rule and constraint `automation_rule_version_reviewer_not_contributor`. Also note that the author's own direct decision now reports that constraint before the CHECK, because BEFORE triggers run before CHECKs.
- Review tasks exclude every author.

**Data dictionary:**
- New tables `methodology_version_contributor` and `automation_rule_version_contributor`: columns, primary key, foreign keys, append-only, privileges.
- New functions `p5_add_config_contributor`, `p5_add_rule_contributor`, `p5_config_content_version`, `p5_config_contributor_from_row`, `p5_config_contributor_from_audit`, `config_review_request_contributor_guard` and `automation_rule_version_contributor_guard`, and the 20 triggers that the 0097 catalogue test lists.
- Line 9431: the `config_review_request_guard()` row ("reviewer is not the draft's author") is complete for the creator only. Add the 0097 trigger row.
- Line 10136: `automation_rule_version_review_sod`. Add the 0097 trigger.

**`p5-work-split.md`:** if it restates "never the draft's author nor the requester", it should use the same D-170 definition.

## 6. User-facing texts

- **"You cannot review a configuration change you authored or requested."** (en `problems.json:634`, and its ar counterpart): still true. A contributor authored part of the change. Unchanged.
- **"You cannot review a version you authored."** (en `problems.json:718`, and ar): still true for a co-author of a rule version. Unchanged.
- **`workflowsP5.json:423` "A configuration review by someone other than the author. It is not a business approval."**: still true. Unchanged, and `apps/web/**` is not mine.
- **The OpenAPI summary for decideConfigReview,** "never the author or the requester": still true under D-170. It is a contract document and I did not change it. ARCH-R4 may want to spell out "author" there.
- I added no new user-facing text, so there was no en or ar string to add.

## 7. What remains, and observations for the orchestrator

1. **Merge.** Apply `0097` after `0096`. It is forward-only and runs in the migration's single transaction.
   - The catalogue test's privilege map and trigger lists change. If another wave adds triggers whose names contain `contributor` on the snapshot tables, the 0097 test needs them.
   - **Possible conflict:** T-DG5-BE-V3 (`packages/db/src/demo/**`). The demo record counts are computed over every public base table (`checksum.ts` `countedTables`), so the two new tables appear in `record_counts`. The demo tests in `packages/db/test/integration` passed here (run #9: `demo.test.ts`, `demo-numbers*`, `demo-roaming`, `demo-dev-binding`). If V3's demo seeds drafts, its counts will include contributor rows.
   - **Possible conflict:** T-DG5-BE-V2 edits `procedures/**`. My triggers on `procedure_definition` and `procedure_step_definition` need no code there. The procedures suite passed on this tree (run #10).
2. **Not changed (outside D-170 and my scope), for a decision:**
   - (a) **The `benefit_formula` review path.** Decided by the DG3 Finance validation; I have not proved there is no co-editor write path.
   - (b) **`methodology_migration` approval.** A second `methodology_migration.plan` holder who re-plans another person's migration (`previewMigration`) is not recorded as a co-author. The approval is a business approval governed by the DG4 canonical-approval SoD (requester and submitter refused), not a configured review.
3. **Backfill conservatism** (§2.3). For drafts open at migration time, `updated_by` is treated as a contributor, as the assignment states. This can refuse a reviewer whose stage step stamped `updated_by`; it never allows an author. On a fresh deployment there are no such drafts.
4. **Untracked files.** The worktree holds untracked files I did not create or touch: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. Do not integrate them as part of this task.
5. Round-2 verification of F-DG5-100 belongs to the code-security reviewer. I do not close my own finding.
