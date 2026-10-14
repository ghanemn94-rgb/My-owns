# Handback T-DG5-BE-B2: source coverage and the S12-018 revision proposals (backend-workflow-engineer)

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING). **Section:** `docs/architecture/p5-work-split.md` §A.3.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-B2.md`, sha256 `1e0c3d2d…cfac42`. I verified the hash before starting.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-B2-backend-workflow-engineer-20261014T055614Z-e506ed58","session_id":"e506ed58-cd09-4d07-99be-514b59a39737"}`.
- **Working tree:** worktree `/home/user/wt/dg5-be-b2`, branch `dg5/be-b2`, base `HEAD` `8ac7fec` (D-145). The changes are **uncommitted**, as the assignment asks.
- **Time:** started `2026-10-14T05:56:27Z`; the end time is in §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0, at the start and at the end (§4).
- **Scope:** I wrote no migration, added no dependency and added no problem code. Nothing in this task grants or records a business approval (G1–G6), and nothing reads or writes the engineering gate records DG0–DG7. A coverage run tests configuration. A review task asks a person to review, and the DG3 Finance validation and the configuration review stay human decisions. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/methodology/source-coverage.ts` | `getSourceCoverage` and `runSourceCoverageCheck` (ADR-0039 §6). Exports the report function `sourceCoverage` and the M0083 counts `EXPECTED_SOURCE_COUNTS`. |
| `apps/api/src/modules/methodology/revision-impact.ts` | The S12-018 starter (ADR-0039 §8): case 2 (`proposeFormulaRevision`, plus the port wrapper `withRevisionProposals`), case 1 for BE-B3 (`proposeConfigRevision`, `createConfigReviewTasks`), the review-task port (`setReviewTaskWriter`), reviewer routing (`reviewerHolders`), and the `listRevisionProposals` route. |
| `apps/api/src/server.ts` | **Named composition lines only:** two imports and two wiring lines. `setReviewTaskWriter(createWorkItemOnce)` and `setMaterialChangePort(withRevisionProposals(materialChangePortImpl))`. `platform/material-change.ts` and `kpi/benefit-formulas.ts` are not edited. |
| `packages/shared/src/schemas/studio-coverage.ts` | The zod mirrors: `sourceCoverageReport`, `sourceCoverageSet`, `sourceCoverageQuery`, `sourceCoverageRunRequest`, `revisionProposal`, `revisionProposalPage`, `revisionProposalListQuery`, `SOURCE_SET_CODES`. |
| `apps/api/test/support/p5-pending-be-b2.ts` | 3 → 0 pending operations. |
| `apps/api/test/integration/contract/p5-exercises-be-b2.ts` | The contract exercises of the three operations, plus their mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | **Outside my nominal ownership; see §6.** The media-type triple pin moves `[327, 326, 1]` → `[328, 327, 1]`, with one comment line. This follows the BE-A/BE-B precedent that D-145 accepted. |
| `apps/api/test/integration/methodology/source-coverage.test.ts` | New: 8 integration tests (REQ-S02-001). |
| `apps/api/test/integration/methodology/revision-proposals.test.ts` | New: 5 integration tests (REQ-S12-018). |
| `apps/api/src/modules/methodology/source-coverage.test.ts` | New: 1 unit test pinning the set order and the M0083 counts. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-B2-backend-workflow-engineer.md`, `…/T-DG5-BE-B2-evidence/*` | This handback and its logs. |

## 2. Behaviour delivered, per requirement row

### REQ-S02-001: my part is the report and the run (p5-work-split §A.9; BE-B3 owns the publish gate)

Acceptance (verbatim): *"A01;A06: the report shows 2 modes, 6 phases, 6 gates, 16 templates, 10 TOM dimensions, 5 forums, 6 lifecycle steps, 3 launch windows, 1 roaming example and 25 questions; deleting a template in a draft methodology makes the check fail and blocks publish"*.

- **`GET /api/v1/admin/source-coverage?versionId=`** (`methodology.read`). The default is the newest published version of the methodology kind's default key `playbook`. For each of the ten sets, in contract order, it returns:
  - `expected`, the M0083 constant 2/6/6/16/10/5/6/3/1/25;
  - `present`, the inventory (`source_element`) elements the version does not remove;
  - `removed`;
  - `plannedFeatures`, the elements still present whose `feature_status` is `planned`;
  - `result`.
- **Results:** `fail` when a present count differs from the expected count; otherwise `warn` when a feature is planned; otherwise `pass`. The overall result is the worst of the sets. Counts are integers.
- **What counts as removed:** an inventory element is absent when the version removes it **either** through its typed element (`template` T13; `phase`/`gate`/`tom_dimension` are refused anyway) **or** through its `source_element` row `<set>.<key>`. The API does not prevent removing the `source_element` row `phase.diagnose`, so I count both paths; no removal path can hide from the check.
- **What never counts:** admin-added elements (for example a template `T99`).
- **Why the expected counts are constants:** they are not the inventory's row count, so a missing inventory row also fails.
- **The test on v1:**
  - the counts are asserted literally: 2/6/6/16/10/5/6/3/1/25, nothing removed;
  - a set is `warn` exactly when its inventory rows are still `planned`. Today these are the launch windows, the roaming example and the health questions, so the overall result is `warn` and never green.
  - The expected `warn` sets are read from the inventory, because BE-P, BE-T and KBE-G move their rows to `working` under rule A-7. The test stays true after they ship.
- **`POST /api/v1/admin/source-coverage/runs`** (`source_coverage.run`, ADM_METHOD; body `{versionId}`). It records one append-only `config_check_run` with `check_kind = 'source_coverage'` and the full report:
  - for exactly the `content_sha256` read under lock class `configDraft` (730250) on `"<kind>:<key>"`;
  - with the audit event `config_check_run.source_coverage` in the same transaction;
  - with commit-time re-authorization, Zod validation and no remote I/O.
  - It answers 201, with `Location` pointing at the version's check runs.
- **Run refusals:**
  - 409 `config_version.not_editable` on a published or discarded version;
  - 404 on an unknown version, and on a version of another kind (source coverage is a property of the methodology; §13 has no code for this, so I used 404 rather than inventing one);
  - 400 on a bad body;
  - 403 for AUD, TO, BO and users without the permission.
- **"Deleting a template … makes the check fail":** the test removes T13 in a draft. The report then shows `template` 15/16, `removed: ["T13"]`, `fail`. The run records `fail` for the draft's current hash, and `getConfigVersion` shows it as `latestChecks.sourceCoverage`.
- **"… and blocks publish":** blocking publish is BE-B3's `publishConfigVersion` (422 `config_version.source_incomplete`; §A.4 lists that test). The 0062 guard `methodology_version_checks_required` (MV16) already refuses to publish a methodology version without a `pass`/`warn` source-coverage run for its exact hash. My run supplies exactly that record, and a `fail` run never satisfies the guard. So this row **completes with BE-B3**, and with rule A-7 (BE-P, KBE-G, BE-T) for the `warn` sets.

### REQ-S12-018: delivered (case 2 end to end; case 1 ready for BE-B3)

Acceptance (verbatim): *"A06;A07: proposing a formula change lists affected benefits and creates a review task"*.

**Case 2, formula revision (ADR-0039 §8 item 2).** `server.ts` wraps the DG4 material-change port, so DG3 `createBenefitFormulaVersion` (a new version, `versionNo > 1`) also calls `proposeFormulaRevision` in the same transaction.

- **Ordering:** the DG4 behaviour runs **first and unchanged**. The automatic `benefit_logic` change request is raised exactly as before.
- **What it records:** one `revision_proposal`:
  - validation by `validateFormula` (engine unchanged; `pass`/`fail` with the engine's report);
  - `impact`: the formula and its from/to version, the affected transformation, `affectedRecords` (`benefit` count, `business_case_line` count) and **`affectedBenefits`** (`benefitId`, `code`) of the benefits bound to the formula;
  - `reviewer_role_code` from the `benefit_formula` policy (FIN);
  - `review_task_count`;
  - its audit event `revision_proposal.create`.
- **Review tasks:** one `config_review` work item per active holder of the reviewer role whose grant covers the transformation (ADR-0006 rules), **except the editor** (SoD). Each item:
  - is written through `createWorkItemOnce` with dedupe key `config_review:<proposalId>:<userId>`;
  - has subject `benefit_formula_version`;
  - links to `/transformations/<id>/benefit-formulas/<formulaId>`;
  - uses `messageKey` `methodology.task.formula_revision_review` with params `{formulaCode, versionNo, benefitCount}`;
  - has no due date.
- **Tests:**
  - the test binds a benefit to the formula, saves version 2, and asserts the proposal lists that benefit and that FIN gets exactly one task;
  - the DG3 response still parses with the strict DG3 mirror `benefitFormulaVersion`;
  - a first version proposes nothing;
  - the editor is not tasked even when it holds FIN;
  - another transformation's FIN is not tasked.
- **Exactly once:** the proposal uses `ON CONFLICT ON CONSTRAINT revision_proposal_dedupe_key DO NOTHING` on `benefit_formula_version:<versionId>:<sha256 of the canonical JSON of {expression, variables}>`. A replay finds the proposal and creates nothing. The test runs the starter ×3 directly and ×3 through the wrapped port: proposals, work items and notifications stay the same count. The wrapped DG4 stub ran once per call, first.
- **The DG4 automatic change request unchanged:** `workflows/change-requests.test.ts` (10) and `change-requests-in-tx.test.ts` (6) pass through the wrapped port (targeted run, §4). The full integration run includes them.
- **Review switched off:** a policy with `review_required = false` routes no task (`review_task_count` 0); the proposal is still recorded. I did not test this, because changing a shared policy row would race other suites on the shared run database.

**Case 1, configuration revision (ADR-0039 §8 item 1), for BE-B3's `submitConfigReview`.**

- `proposeConfigRevision(tx, audit, {version, organizationId, requestedBy})` records the proposal of the draft's current hash:
  - validation is `pass` only when the latest preview run for that hash is `pass` and the latest compatibility run is `pass`/`warn`; missing runs give `fail`, never an assumed green;
  - impact is BE-B's `affectedRecords`, plus `affectedBenefits: []` with `affectedBenefitsBasis: "not_applicable"` (no Studio element type binds a benefit formula, ADR-0039 §4), stated as such and never as a count of 0;
  - the reviewers are the active holders of the kind's policy role (TO) in the organization, except the requester and the draft's author.
- `createConfigReviewTasks(tx, audit, proposal, reviewerUserIds, {subjectType, subjectId, linkPath, messageKey, messageParams})` then creates the tasks once BE-B3 knows its review request: the request carries `revision_proposal_id`, so the proposal comes first.
- A replay returns `created: false` with no reviewers. The function-level test covers routing, the dedupe keys and replay ×3. BE-B3 wires it into the route (ADR-0039 Consequences: "REQ-S12-018 completes with BE-B3's two triggers").

**`GET /api/v1/admin/revision-proposals`** (`methodology.read`; filters `subjectType`, `subjectId`; cursor pagination, newest first).

- It lists the caller organization's proposals.
- A formula proposal is transformation data (its benefits), so it is listed only where the caller may also read that transformation. The ADR-0006 `scopeFilter` on `transformation.read` applies, in the database.
- AUD and the transformation's TL see it. A methodology admin with only `methodology.read` and another organization's reader do not. Without the permission the answer is 403, and bad filters get 400.

## 3. Operations routed (delta to my pending list)

`apps/api/test/support/p5-pending-be-b2.ts`: **3 → 0**. Removed: `listRevisionProposals`, `getSourceCoverage`, `runSourceCoverageCheck`. Each is exercised through the validating client in `p5-exercises-be-b2.ts`:

- `getSourceCoverage`: 200 (default and named), 400, 403, 404.
- `runSourceCoverageCheck`: 201, 400, 403, 404, 409 `config_version.not_editable`.
- `listRevisionProposals`: 200 (with and without filters), 400, 403.

Declared but not reachable: `runSourceCoverageCheck` 422 (no §13 refusal applies to a run; a failing coverage is a recorded `fail`, and its 422 belongs to publish, BE-B3), and 429 (the rate limiter's own suite).

**Pinned counts (rule 14):**
- Media-type triple: `[327, 326, 1]` → `[328, 327, 1]` (+1 JSON body: `runSourceCoverageCheck`).
- Rate-limit floor: unchanged (the contract test passed without touching it).
- Operation count: unchanged (763; `openapi:lint` reports 763 operations).

## 4. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, worktree `/home/user/wt/dg5-be-b2`. PostgreSQL is the disposable cluster of `tests/qa/support/with-pg.sh` on my port range (`QA_PG_PORT=23800`, `MTH_PORT_POOL=23801-23849`). I removed empty `.claude/.cc-writes` folders inside source trees before the test runs (none were found). Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-B2-evidence/`, and every exit code is in `exit-codes.txt`.

| # | Command | Result |
|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | exit 0, `PASS gate DG4 (historical)` |
| 1 | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| 2 | `pnpm -r build` | exit 0 (`build.log`) |
| 3 | `pnpm lint` | exit 0 (`lint.log`) |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" (`prettier.log`) |
| 5 | `pnpm openapi:lint` | exit 0, "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 763 operations" (`openapi-lint.log`) |
| 6 | `pnpm test`, with `LANG`, `LC_ALL`, `LC_CTYPE` and `LANGUAGE` unset | exit 0. unit-node 98 files / **1813** passed; unit-web 71 / **1385** passed; unit-formula-nocodegen 3 / **259** passed + 2 skipped (by design, as in D-144/D-145) (`unit-locale-unset.log`) |
| 7 | `LC_ALL=C.UTF-8 pnpm test` | exit 0. Same counts: 1813, 1385, 259 + 2 skipped (`unit-c-utf8.log`) |
| 8 | `QA_PG_PORT=23800 MTH_PORT_POOL=23801-23849 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0. 213 files / **2062** passed, 0 failed (the D-145 baseline 2049 + my 13 new tests); duration 1991.6 s on the shared machine (`integration.log`) |
| 9 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | exit 0, `PASS gate DG4 (historical)` (`validate-dg4-end.log`) |

Rows 1–7 are the second, final pass, after the fix described below. Their logs overwrite the first pass's logs for the same commands (rows 1–5 also exited 0 in the first pass).

**Non-zero exits and intermediate runs (disclosed):**

- **Unit, first pass (both locales): exit 1**, kept as `run1-unit-locale-unset.FAILED-superseded.log` and `run1-unit-c-utf8.FAILED-superseded.log`. Two tests failed in both locales, from one cause in my code:
  - the failing tests were `architecture.test.ts` "every import respects dependsOn, public surfaces and allowed packages" and `methodology.test.ts` "its declared boundary holds";
  - the cause was that `source-coverage.ts` looked up `EXPECTED_SOURCE_COUNTS[setCode]`, a computed member with a non-literal key, which the module-interface rule forbids;
  - the fix was to make the constant an ordered list of `[set, expected]` pairs that the report iterates, and to add a unit test pinning its order to `SOURCE_SET_CODES` and the counts.
  - A targeted run of the two suites plus the methodology unit tests then passed 154/154. The second pass is rows 6–7.
  - The first pass counted 1810 of 1812 passing in unit-node; the second counts 1813 (+1, the new unit test).
- **First targeted integration run of `revision-proposals.test.ts`: exit 1, 4/5.** The list test expected `reviewTaskCount: 1` but got 2. That was correct behaviour: the earlier SoD test in the same file grants a second user FIN on the same transformation. I made the assertion order-independent (it now equals the tasks written for that subject). The re-run of both new files passed 13/13.
- **First targeted contract-test run: exit 1, 103/104** (with `benefit-formulas.test.ts` 16/16, `change-requests.test.ts` 10/10 and `change-requests-in-tx.test.ts` 6/6 passing). The triple pin was `[328, 327, 1]` vs `[327, 326, 1]`, exactly the +1 for `runSourceCoverageCheck`. I updated the pin (§6). The full integration run includes the contract test.
- No timeout, retry or flaky test occurred beyond these. One unit command ran past the tool's 600 s foreground limit and the harness moved it to the background, where it completed normally. It was the first pass and is disclosed above.

## 5. Contract, schema and dependency items for the orchestrator

1. **`runSourceCoverageCheck` declares no `If-Match`/428** (`docs/api/openapi.yaml`, owned by ARCH-01). Shared rule 4 asks for `If-Match` on every mutation, with "creates are version 1". This operation creates an append-only check run, and its body names the version.
   - I did not edit the contract. What I implemented: the run binds to the content hash read under the `configDraft` lock, so a stale run can never satisfy publish (MV16). An `If-Match` the client does send is honoured (409 when stale; tested), and a missing one is accepted, because 428 is undeclared.
   - **Decision needed:** either accept this as "a create" for this operation, or have the contract owner add the `IfMatch` parameter and 428 (as `runConfigCompatibilityCheck` has), after which I or BE-B3 make it required.
2. **The scope of `listRevisionProposals` for formula proposals:** I restrict them to callers who may also read the transformation (`transformation.read`). ADR-0039 §9 lists only `methodology.read` for the operation group. I chose least privilege, because a formula proposal names a transformation's benefits. I'd ask for an ADR note confirming this.
3. **A non-methodology version on the coverage operations returns 404** (no §13 code exists). If a 422 code is preferred, it needs a §13 row; I added none.
4. No migration, no new problem code, no new dependency, no new permission and no new lock class.

## 6. Files outside my nominal ownership

- `apps/api/test/integration/contract/contract.test.ts`: only the triple pin and one comment line, following the BE-A/BE-B precedent accepted in D-145. Rule 14 says the orchestrator reconciles pins. Acceptance 3 requires a green integration run, which needs the pin. BE-D and BE-H run in parallel and may move the same line. **Keep the sum: +1 JSON body from BE-B2.**

## 7. User-facing texts

- **Made untrue by my work: none.**
  - The `p5.revisionProposals` and `p5.sourceCoverage` placeholders say the screens are "being built … not available yet", and `admin.plannedSections` says methodology settings are planned. Both are still true: I shipped API operations, not screens, and D-144 keeps `plannedSections` until FE-B ships the Studio screens.
  - The en/ar problem texts `config_version__source_incomplete` and `config_version__checks_required` already exist and are unchanged.
- **New My Work message keys need en/ar texts** (for the owner of `apps/web/src/i18n/{en,ar}/myWork.json` and `apps/web/src/pages/my-work/message-keys.test.ts`, FE):
  - `methodology.task.formula_revision_review`, with params `{formulaCode, versionNo, benefitCount}`. Proposed EN: "Review revision {{versionNo}} of benefit formula {{formulaCode}} ({{benefitCount}} benefits affected)".
  - `methodology.task.config_revision_review`, for BE-B3's case-1 tasks; the params are BE-B3's choice.
  - Until they exist, these items render the existing kind label "Configuration change to review" / its Arabic label through `myWork.message.fallback`. That is true, but generic.

## 8. What remains

- **REQ-S02-001 "blocks publish":** BE-B3's `publishConfigVersion` refusal 422 `config_version.source_incomplete` and its test (§A.4). Rule A-7: BE-P, KBE-G and BE-T move their inventory rows to `working`.
- **REQ-S12-018 case 1 trigger:** BE-B3 calls `proposeConfigRevision` and then `createConfigReviewTasks` from `submitConfigReview`.
- **FE-B:** the Source coverage and Revision proposals screens. **FE:** the two message-key texts (§7).
- The orchestrator's decisions in §5 items 1–2.
- Nothing in my section is left unimplemented. There is no separable second half.

**Merge instructions:** no migrations and no ordering constraints within W4. Expect a conflict only on the `contract.test.ts` triple pin; keep the sum, as in §6. `server.ts` gains two imports after the T-DG4-BE-L block and replaces the line `setMaterialChangePort(materialChangePortImpl);` with two lines. A later task that wraps the same port must wrap `withRevisionProposals(materialChangePortImpl)` rather than replace it.

**Environment note:** the worktree root shows untracked entries (`.bashrc`, `.bash_profile`, `.profile`, `.zprofile`, `.zshrc`, `.gitconfig`, `.gitmodules`, `.mcp.json`, `.ripgreprc`, `.idea`, `.vscode`, `CLAUDE.local.md`). They are `/dev/null` character devices that the run sandbox bind-mounts; they are not files of mine and must not be committed. I did not touch them. The prettier acceptance command passes with them present.

**End time:** `2026-10-14T07:46:35Z` (about 110 minutes, within the 2-hour limit).
