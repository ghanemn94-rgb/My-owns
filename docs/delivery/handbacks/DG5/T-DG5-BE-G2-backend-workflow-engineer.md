# Handback: T-DG5-BE-G2 (backend-workflow-engineer)

- **Stage / gate:** P5, DG5 (BUILDING). Task T-DG5-BE-G2, p5-work-split §C.3 follow-up. The binding Added scope is D-160 (c).
- **Invocation:** `DG5-T-DG5-BE-G2-backend-workflow-engineer-20261016T162455Z-60b6ecac`, session `60b6ecac-d07c-4b02-86f1-aa1c0080c4e5`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-G2.md`. Its sha256 was verified as `b5353fb6…14b9f9`.
- **Base:** branch `dg5/be-g2` at `f534d20`.
- **Time:** started 2026-10-16T16:25:09Z, ended 2026-10-16T17:27:06Z.
- **Changes are uncommitted**, as the assignment asks.
- **Approvals:** no business, Finance or IT approval was granted. Nothing here touches DG0–DG7 records. Product G6 is not DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/procedures/coverage.ts` | Adds a coverage-view rule for module-owned targets (`MODULE_OWNED_TARGETS`: `launch_plan` and `health_assessment`). These links resolve to their own module, not to the form registry. Whether each is shipped is read live from the linked element's `source_element.feature_status` (rule A-7). The header comment now states the rule. |
| `apps/api/test/integration/procedures/coverage.test.ts` | The pinned values are now true: `planned` goes from 28 to 0, and totals are `[80, 0, 0]`. The wording now says launch windows and health questions are covered by their own modules. The live test now shows that a module-owned element whose feature has not shipped still reads Planned (never green), and that form-framework targets still follow the registry. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-G2-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-G2-evidence/*` | Logs, plus `diff.patch` (the full diff). |

There is no migration. `0094` is **not** used, and no contract, OpenAPI, zod mirror, route or permission changed.

## 2. The change chosen, and why (D-160 c)

**Choice: a coverage-view rule for module-owned elements.** I did not write repair migration `0094`.

**Why a migration would not work.** `0068`'s CHECK `form_record_type_storage_complete` requires `(table_name IS NULL) = (feature_status = 'planned')`.

- A migration that marks the `launch_plan` and `health_assessment` rows `working` must therefore also give them a `table_name`.
- That would make them form-framework targets. The record and schema routes (`assertWorking`, `recordExists`, provider counts) would start treating the launch plan and health check as form records, and the form builder would list them as working forms.
- The assignment forbids that ("if that does not make them form-framework targets").

**The rule** (`coverage.ts`):

- A `form` link whose `target_code` is in `MODULE_OWNED_TARGETS` is resolved against its module:
  - `resolved: true`: the module is part of this build.
  - `featureStatus` is `working` when the linked element's `source_element.feature_status` is `working`, and `planned` otherwise.
- This is the shipped signal that ADR-0042 Consequences names: "Planned until their tasks move `source_element.feature_status` (p5-work-split §A rule A-7)". `0088` (KBE-G2) moved all 28 rows.
- The form registry is not consulted for these links.
- The `form_record_type` rows stay `planned` with no table, so the form framework still refuses them with 422 `form_record.type_planned`. The test asserts that the registry is unchanged.
- Every other form link and every procedure link keeps its previous rule.

**Contract note (no change made).** `MethodologyCoverageLink.targetKind` only allows `form` or `procedure`. So these links still read `targetKind: "form"`, with `targetCode` naming the module's own screen (`launch_plan`, `health_assessment`), and the web shows "Form launch_plan".

- This is true in the user sense: it is the native launch-plan or health-check screen.
- A distinct `module` kind would be a contract change, which I did not make.
- **For the orchestrator, optional:** add `module` to the enum later if a reviewer wants the kind to say so explicitly. Nothing in this task requires it.

## 3. Behaviour delivered, per requirement row

**REQ-S01-003.** Acceptance text, quoted: "A01;A02: every seeded methodology element shows a linked form or procedure in the coverage view; the guided scenario passes through input, validation, approval, output, monitoring, correction and sustainment on persisted records".

- All 80 elements show at least one link.
- `GET /api/v1/admin/coverage` now returns totals of covered 80, planned 0, not covered 0.
- The 3 `launch_window` elements show `{form, launch_plan, resolved: true, working}`. The 25 `health_question` elements show `{form, health_assessment, resolved: true, working}`. All 28 are Covered.
- The view stays live and never green for unshipped work. A rolled-back transaction that moves the launch windows back to `planned` in the source inventory gives `[77, 3, 0]`, with those three Planned. A form-framework record type set to planned (T15) makes its element Planned.
- The §C.3 test text "launch windows and health questions show **Planned** (never green) until slice H ships" applied *until* slice H ships. Slice H has shipped (0088), so the test now pins the true post-ship state.
- The A02 "guided scenario" clause is the QA-E test. This task does not cover it.

## 4. Checks actually run

Environment: Node 24.21.0, offline. Harness ports were 23450–23499. Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-G2-evidence/`. No empty `.claude/.cc-writes` directories were found inside source folders.

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `validate-historical-DG4.log` |
| `QA_PG_PORT=23450 MTH_PORT_POOL=23451-23499 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/procedures/coverage.test.ts` | 0 | 4/4 passed | `coverage-test.log` |
| `pnpm -r typecheck` | 0 | | `typecheck.log` |
| `pnpm -r build` | 0 | | `build.log` |
| `pnpm lint` | 0 | | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| `pnpm openapi:lint` | 0 | | `openapi.log` |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | 136 files / 2252 passed; 77 / 1470 passed; 3 / 259 passed + 2 skipped | `test-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 136 / 2252; 77 / 1470; 3 / 259 + 2 skipped | `test-cutf8.log` |
| `QA_PG_PORT=23460 MTH_PORT_POOL=23461-23499 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 278 files; **2775 passed + 1 skipped** (2776). PostgreSQL bound port 23460 on the first attempt. Duration 3072 s. | `integration.log` |
| `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-historical-DG4-end.log` |

**Pinned counts:**

- The integration totals are unchanged from D-161 (2775 + 1 skipped). The coverage suite still has 4 tests, rewritten.
- The only pinned value that changed is inside `coverage.test.ts`: planned 28 → 0, covered `rest.length` (52) → 80. The live test's `after.totals.planned` 25 is replaced by `[77, 3, 0]`.
- The media-type pin is unchanged, because no JSON body was added.

**Disclosures:**

- My first run of `coverage.test.ts` failed 1 of 4 tests. The cause was my own test defect: the simulation set a registry row to `planned` without clearing `table_name`, which violates `form_record_type_storage_complete`. I fixed it, and the rerun gave 4/4.
- An early read-only `grep -o` over `decisions.md` (discovery, not a check) ran past its time limit and was stopped by the runner. I read D-160 another way.
- The integration log's six matches for "retry" are test names, not harness retries.
- There were no failed, flaky or timed-out tests in the cited logs.

## 5. Operations routed (delta to the pending list)

None. `getMethodologyCoverage` was already routed by T-DG5-BE-G, and `P5_PENDING_BE_G` stays `[]`. `p5-exercises-be-g.ts` is unchanged and still validates against the unchanged `methodologyCoverage` mirror.

## 6. Contract, schema or dependency needs

- None are required.
- There is no new dependency and no migration.
- The optional `module` value for `targetKind` (§2) is for the orchestrator to decide; I did not change it.

## 7. User-facing texts

- **Made true by this work:** the coverage view no longer shows the 28 launch-window and health-question elements as "Planned". The web's `nav.planned` suffix is shown only when `featureStatus === "planned"`, so it disappears for them with no web change.
- **Searched, nothing untrue found:** `workflowsP5.coverage.*` (en) and the `nav` launch/health strings. No en/ar string calls the coverage of these elements planned.
- **For the ADR owner (not my file):** ADR-0042 §6's example "(e.g. launch windows and health questions until slice H ships)" is historical wording that is still literally true ("until"). It is listed here only for awareness.

## 8. What remains

Nothing in this task's scope. Merge notes:

- There is no migration to order.
- This task touches only `procedures/coverage.ts` and its integration test, so no conflict is expected with BE-T2, FE-E or FE-F.
- FE-F's screens for the launch plan and health check do not depend on this change.
