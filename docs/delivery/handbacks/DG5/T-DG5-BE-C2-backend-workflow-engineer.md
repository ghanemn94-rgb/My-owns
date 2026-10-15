# Handback T-DG5-BE-C2 (backend-workflow-engineer): the DG2–DG4 catalogue for methodology versions after v1, and BE-L2's three db-error mappings (D-155 repair task)

- **Stage:** P5 / DG5 (BUILDING). **Task:** T-DG5-BE-C2. The assignment is a repair task (D-155): its Added scope 1 and 2 are binding and replace §A's file list.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-C2-backend-workflow-engineer-20261015T165622Z-ed129944","session_id":"ed129944-8051-4daf-956c-1af52bbc36ae"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-C2.md`, sha256 `e72ff8dcab301c666c79bc118526d83dc410ee89a9dd53488224baf823b7ee6f` (verified).
- **Base:** branch `dg5/be-c2` at `fedb63d`. All changes are **uncommitted**, as the assignment asks.
- **Time:** started `2026-10-15T17:01:34Z` (`date -u`) and ended `2026-10-15T18:57:13Z`, about 116 minutes. I passed the 100-minute mark during verification, so I stopped there per the assignment. What remains is in §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited **0**, both before implementation and at the end.
- No product gate (G1–G6) was approved by me, and nothing here touches DG0–DG7. Every test value is synthetic. A configuration review in a test approves nothing in the business.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/methodology/repository.ts` | **The fix.** `loadMethodologyCatalogue` no longer filters the six catalogue tables (or the gate definitions) by the pinned version id. Their identities are the stable-identity registry rows. Their attributes resolve as the pinned version's `methodology_element` row when it exists, else the catalogue's values, through the `ConfigResolver` (`tom_dimension`, `gate`, `gate_criterion`). New private helpers `resolveTomDimensions` and `resolveGates`. The function gets an optional `resolver` parameter (default `createConfigResolver()`). |
| `apps/api/src/modules/methodology/routes.ts` | The `GET /transformations/{id}/methodology` route passes the composition root's resolver. `registerMethodologyP2Routes` takes it as a third argument, so the resolver is now built before the P2 routes are registered. Header comment updated. |
| `apps/api/src/modules/transformations/good-outcome.ts` | `criteriaOf` (one query site) had the same defect, through a join on `pin.methodology_version_id = criterion.methodology_version_id`. It now reads the registry criteria, still only when the transformation has a methodology pin (fail closed when it has none, as before). |
| `apps/api/src/modules/platform/db-errors.ts` | Added scope 2: new `mapP5CutoffPackError`, with the three mappings, wired into `mapDatabaseGuardError` after the slice I mapper. |
| `apps/api/src/modules/platform/db-errors-p5-cutoff-pack.test.ts` | **New** unit test: one test per mapping (status, type, code, title, English detail). A fourth test checks that the three names are raised by `0075` and that the other `meeting_cutoff_pack_*` constraints are not mapped by this function. |
| `apps/api/test/integration/methodology/catalogue-versions.test.ts` | **New** integration suite on its own scratch database, because it publishes the shared key `playbook`. It covers literal tests 1–4 of Added scope 1, plus a registry precondition test and the good-outcome reader. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-C2-backend-workflow-engineer.md`, `docs/delivery/handbacks/DG5/T-DG5-BE-C2-evidence/*` | This handback and its logs. |

**No migration.** `0094` is **not** taken, because no SQL function filters a catalogue table by a version id (see the sweep, §3). There is no contract, ADR, schema, permission or dependency change.

## 2. Behaviour delivered

### Added scope 1: the catalogue of versions after v1 (FE-B's High defect; REQ-S06-007, REQ-S06-008 in real use)

The design follows ADR-0039 §2 "Resolution" and §3:

- **Identities.** For any version V, the identities are the registry rows.
  - The six catalogue tables carry globally UNIQUE `code` and `ordinal` columns (`0011`), and every row belongs to playbook v1. The new suite asserts both on the migrated database.
  - So "the registry's rows" are all rows of each table. The version filter is removed, and no lineage lookup is needed.
  - This also holds for transformations pinned to synthetic test keys.
- **Attributes.**
  - **Types with an element type (`tom_dimension`, `gate`, `gate_criterion`):** each resolves as V's row when it exists, else the catalogue, through `ConfigResolver.elements(db, V, type)`. The attribute mapping is the inverse of `config-resolver.ts` `loadCatalogue`:
    - TOM: `labelEn`/`labelAr` → `labelEn`/`labelAr`; `helpEn` → `sourceDesignQuestionEn`; `helpAr` → `designQuestionAr`.
    - Gates and criteria: exactly BE-C's `resolveGateDefinitions` mapping in `workflows/criteria.ts`. The default approver is taken only from inside the DG2 allowed set, and removed criteria are left out. So the catalogue and the gate workflow agree.
  - **Types without an element type (diagnostic dimensions and workstreams, charter scope checks, good-outcome criteria; ADR-0039 §2):** these are the registry values for every version.
- **v1 is byte-identical (R2).** Overrides are applied only where a version row exists (`overridden && origin = 'source'`). Playbook v1 has no rows, so a v1-pinned transformation gets exactly the DG4 rows in the DG4 order. Test 3 checks this byte for byte, and the existing `v1-readers.test.ts` and the DG2–DG4 suites run unchanged (§4).
- **`methodologyVersionId` on each catalogue item** stays the registry row's own column (the v1 id). `methodologyVersion` in the response is the pinned version. The contract gives this field no description, so this needs no contract change. It is noted for the architect in §6.

Tests in `apps/api/test/integration/methodology/catalogue-versions.test.ts`. Every version goes through the real Studio API: draft, `putConfigElement`, preview, compatibility, source coverage, submit, TO decision, publish.

| Assignment test | Test name | What it asserts |
|---|---|---|
| 1 | `test 1: a help-text-only v2; …` | v2 changes only the G2 `helpEn` and the first TOM dimension's `helpEn`. A transformation created afterwards is pinned to v2. Its catalogue has the same diagnostic dimensions and workstreams, TOM dimensions, gate definitions (with criterion keys), charter scope checks and good-outcome criteria as v1, by code/key, in order, and by count. Beyond the literal test, the whole body equals v1's except the two help texts. |
| 2 | `test 2: a v3 label override is returned for its element, and only for it` | v3 has label overrides on a TOM dimension (EN and AR), on G3 and on one G3 criterion. They are returned for those elements. The rest equals v1, apart from the G2 help text the v3 draft copied from v2 (ADR-0039 §2). The v2-pinned transformation still renders v2. |
| 3 | `test 3: the v1-pinned transformation is unchanged, byte for byte, …` | After v2 and v3 are published, `JSON.stringify` of the v1-pinned catalogue is identical to the body captured before. The existing v1 regression suites also pass (§4). |
| 4 | `test 4: the instantiation path of a v2-pinned transformation: …` | For a transformation created through `POST /transformations` while v2 is newest: <ul><li>the catalogue has 6 workstreams, in v1's order (the DG2 Diagnose region: `DiagnosePage` reads the catalogue's dimensions and workstreams);</li><li>its `diagnostic_item`, `tom_canvas_cell` and `gate_instance` counts equal the v1 transformation's, with 6 gate instances;</li><li>`GET …/diagnostic-items` lists them;</li><li>`GET …/gates` returns G1–G6, with each instance matched to its definition, and G2 has v2's help text.</li></ul> |
| 4 (second reader) | `test 4 (second reader): the good-outcome test …` | An outcome on the v2-pinned transformation evaluates all five criteria, exactly as on v1. Before the fix it evaluated **none**: the empty criteria list made the outcome "pass" the good-outcome test vacuously. |
| precondition | `v1 is the registry: …` | Every row of the six tables has `methodology_version_id` = playbook v1. The v1 response holds 6 workstreams, 10 TOM dimensions, 6 gates, 5 scope checks and 5 good-outcome criteria. |

**The suite fails against the original readers.** With `repository.ts` and `good-outcome.ts` swapped back to `HEAD` (and then restored), it ran **4 failed | 2 passed (6)**: tests 1, 2, 4 and 4-second-reader failed. Log: `T-DG5-BE-C2-evidence/catalogue-versions-against-HEAD-readers.log`. With the fix it passes 6/6.

### Added scope 2: three `db-errors.ts` mappings (D-155 (c))

The codes and English texts are exactly BE-L2's API refusals (`governance/cut-off.ts` `cutoffRefusals`):

| Constraint (`0075`) | Mapping | English `detail` |
|---|---|---|
| `agenda_item_cutoff_pack_unreviewed` | 422 `agenda_item.pack_not_reviewed` (`problems.businessRule`) | "Review the meeting's cut-off pack before publishing its items." |
| `meeting_cutoff_pack_reviewer` | 403 `meeting_cutoff_pack.not_reviewer` (`urn:mth:problem:forbidden`, title "Forbidden") | "Only the meeting's chair or secretary can review its pack." |
| `meeting_cutoff_pack_transition` | 422 `meeting_cutoff_pack.already_reviewed` (`problems.businessRule`) | "This pack is already reviewed." |

Each has its own unit test in `db-errors-p5-cutoff-pack.test.ts`.

- The architecture rule (ADR-0002) forbids `platform` from importing `governance`, so the test cannot compare against `cutoffRefusals` directly. It writes the expected values out literally instead. I checked them line by line against `cut-off.ts` lines 65–80.
- One thing to know: `0075` also raises `meeting_cutoff_pack_transition` on an INSERT that does not start as a draft for the meeting's own cut-off date. That case now also maps to `already_reviewed`, as D-155 (c) decided. The API's own insert path never reaches it.

## 3. The sweep: every site examined

**API readers** of the ten catalogue tables (`apps/api/src/**`, plus `apps/worker/src/**`, `packages/shared/src/**`, `packages/reporting/src/**`). Line numbers are on the changed tree.

| Site | Affected? | Note |
|---|---|---|
| `methodology/repository.ts` `loadMethodologyCatalogue` (now l.267–301; previously l.169–218: five `.where("methodology_version_id", "=", mv)` and `gates.filter(g => g.methodologyVersionId === mv)`) | **Yes, fixed** | See §2. |
| `transformations/good-outcome.ts` `criteriaOf` (now l.159–175; previously l.154–163: `innerJoin("transformation_config_pin as p", "p.methodology_version_id", "c.methodology_version_id")`) | **Yes, fixed** | See §2, test 4 (second reader). |
| `methodology/repository.ts` l.98–101 `loadGateDefinitions` | No | Unfiltered. It is used by `workflows/criteria.ts`, `gates.ts`, `gate-readiness-read.ts`, `methodology/migration-plan.ts` and `reporting/…/gate-pack.ts`, all unfiltered. |
| `methodology/config-resolver.ts` l.77, 91, 107, 122–123 (`loadCatalogue`) | No | Unfiltered registry, by design. |
| `methodology/providers/methodology-kind.ts` l.33, 73–74 | No | By code. |
| `methodology/routes.ts` l.119, 147, 158 (the DG2 TOM label PATCH) | No | By code/id. |
| `methodology/source-coverage.ts`, `invariants.ts`, `element-profiles.ts` (type names only) | No | No catalogue query by version. |
| `transformations/charter.ts` l.227 (`charter_scope_check_definition`) | No | Unfiltered. |
| `transformations/register-kit.ts` l.194 `assertCatalogueCode`, with its callers `registers.ts` l.265, 334, 390, 451, 516, 575, `workflows/design-registers.ts` l.116 and `workflows/workshops.ts` l.251 | No | By code. |
| `workflows/gate-exceptions.ts` l.396–397 | No | By key and gate code. |
| `workflows/canvas.ts` l.46, 55 | No | By code. |
| `workflows/gate-reviews.ts` l.138, `workflows/gates.ts` l.1578 | No | Join by criterion key. |
| `workflows/phase-steps.ts` l.178, 202 (`phase_definition`) | No | Unfiltered. |
| `governance/forums.ts` l.223 (`forum_template`) | No | Unfiltered. |
| `kpi/benefit-formulas.ts` l.467 (`benefit_formula_example`) | No | Unfiltered. |
| `kpi/repository.ts` l.326 (`diagnostic_workstream`) | No | By code. |
| `forms/custom-values.ts` l.203, 205, 207 | No | By code. |
| `reporting/reports/assemblers/tom.ts` l.70 | No | Join by code. |
| `reporting/reports/assemblers/gate-pack.ts` l.131 | No | Via `loadGateDefinitions`. |
| `apps/worker/src/**` | No | No read of the ten tables (`handlers/escalations.ts` l.693 is a column name only). |

**SQL functions** in `packages/db/migrations/**` that read the ten tables:

| Site | Affected? | Note |
|---|---|---|
| `0018` `p2_instantiate_transformation` l.167 (`diagnostic_dimension`), l.180 (`tom_dimension`), l.193 (`gate_definition`) | No | Unfiltered loops over the registry. It pins the newest published version (l.152), which is correct per ADR-0039 §3. Test 4 exercises it with v2 newest. |
| `0024`/`0025`/`0065` `p3_instantiate_transformation`, `0030`/`0044` `p4_instantiate_transformation` | No | None reads a catalogue table by version. `0065` reads `methodology_element` of the scoring-defaults version, which is a different kind and correct. |
| `0044` `p4_instantiate_forums` l.734 (`forum_template`) | No | Unfiltered. |
| `0017` l.268 `gate_instance_approver_allowed` | No | By gate code. |
| `0026` l.21, 24; `0059` l.23–32 | No | Migration-time assertions by code. |
| `0051` l.455 `gate_exception` guard | No | By key and gate code. |
| `0062` l.311–314, `0068` l.296–299, `0086` l.480–483 (`methodology_element_source_identity`) | No | By code/key. |
| Every other `methodology_version_id =` predicate in `0062`–`0092` | No | All of them are on `methodology_element`, `config_check_run`, `config_review_request`, `procedure_definition` or the pin and migration tables, never on the ten catalogue tables. |

The search patterns used:

- `selectFrom("<table>"…)` and `innerJoin("<table>"…)` over `apps/**`;
- raw `(FROM|JOIN) <table>` over `apps/**`, `packages/*/src` and `migrations/*.sql`;
- every `methodology_version_id` and `methodologyVersionId` in `apps/api/src`;
- every `transformation_config_pin` reader.

## 4. Checks (real exit codes)

Environment:

- Node 24.21.0, offline, in the worktree `/home/user/wt/dg5-be-c2`.
- PostgreSQL through `tests/qa/support/with-pg.sh`, with `QA_PG_PORT=24200` and `MTH_PORT_POOL=24201-24249`.
- Empty `.claude/.cc-writes` directories inside source folders were removed before the tests.

| Command | Exit | Result / log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` (first, and again after the last edit) | 0, 0 | `lint.log`, `lint-final.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log`. After my last test edit, `npx prettier --check` on every changed file also exited 0: `prettier-final-changed.log`. |
| `pnpm openapi:lint` | 0 | `openapi-lint.log` |
| `tsc -p apps/api/tsconfig.json --noEmit` after the last edit | 0 | `typecheck-final-api.log` |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`), run 1 | **1** | `attempt1-unit-locale-unset.log`. unit-node failed 1 of 1973: `architecture.test.ts`, a **real violation in my first test version** (fixed, see below). unit-web 1429/1429. formula 259 + 2 skipped. |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`, run 1 | **1** | `attempt1-unit-c-utf8.log`. The same `architecture.test.ts` violation, plus unit-web 1 of 1429 (`raid.test.tsx`, a timeout). Formula 259 + 2 skipped. |
| `pnpm test`, locale unset, run 2 (after the fix) | **1** | `unit-locale-unset.log`. **Only timeouts under machine load**, in files I did not change: <ul><li>unit-node 1972/1973: `architecture.test.ts` hit `Test timed out in 30000ms` (vitest reported collect 403 s);</li><li>unit-web 1418/1429: 11 tests in 8 files, all `Test timed out in 20000ms` or `findBy` waits;</li><li>formula 259 + 2 skipped, all passed.</li></ul> |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`, run 2 | **not completed** | `unit-c-utf8.log`. unit-node 1972/1973, the same `architecture.test.ts` 30 s timeout. The run was then **stopped by the 1-hour background-command limit** partway through unit-web, so it has **no complete result**. |
| Isolation re-run of **every** unit file that failed in any full run, locale unset | 0 | `rerun-unset-node.log`: `architecture.test.ts` + `db-errors-p5-cutoff-pack.test.ts`, 2 files / 143 passed. `rerun-unset-web.log`: the 8 web files, 162 passed. |
| The same isolation re-run, C.UTF-8 | 0 | `rerun-cutf8-node.log`: 143 passed. `rerun-cutf8-web.log`: 162 passed. |
| `QA_PG_PORT=24210 MTH_PORT_POOL=24211-24249 tests/qa/support/with-pg.sh pnpm test:integration` | **1 (crash)** | `attempt1-integration-crashed.log`. 705 tests passed and **0 failed** before the vitest fork died: `Unhandled Rejection: Error: Channel closed`, `ERR_IPC_CHANNEL_CLOSED`. At that point the machine was at load average about 28 on 4 CPUs, with 12.8 of 16 GB of memory used and no swap. This is **not a pass**: the full integration suite did not complete. |
| Integration subset, `QA_PG_PORT=24220 MTH_PORT_POOL=24221-24249 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/methodology apps/api/test/integration/registers.test.ts apps/api/test/integration/gates.test.ts apps/api/test/integration/governance/agenda.test.ts` | 0 | `integration-subset.log`: **15 files, 167/167 passed**. It covers every methodology suite (the new `catalogue-versions.test.ts`, `v1-readers.test.ts`, `entity-group.test.ts`, the migrations, studio, coverage and scoring-defaults suites), the registers suite (the good-outcome test A01 on v1), the gates suite and the cut-off agenda suite. |
| `catalogue-versions.test.ts` alone, with the fix | 0 | 6/6 passed |
| `catalogue-versions.test.ts` alone, against the `HEAD` readers (demonstration) | 1 (expected) | 4 failed / 2 passed: `catalogue-versions-against-HEAD-readers.log` |
| `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` |

**Disclosed non-zero exits, explained.**

1. **My defect (fixed).** In run 1, `apps/api/src/architecture.test.ts` "every import respects dependsOn …" found a real violation in both locales. The first version of my new unit test imported `../governance/cut-off.ts` from the `platform` module, which ADR-0002 forbids. I rewrote the test with literal expected values. The isolation re-runs show `architecture.test.ts` passing in both locales.
2. **Load timeouts, not caused by my change.**
   - The other failures are timeouts in files I did not change: the architecture walk at its 30 s limit, and web `findBy` waits at 20 s. My change touches no web code.
   - Four W11 tasks ran at once on this 4-CPU machine, at load average 28–29.
   - Every one of these files passes when run alone, in both locales (the isolation rows).
   - I count none of them as a pass of the full suite.
3. **The full integration crash.** It is an infrastructure failure (the IPC channel of the vitest fork closed under memory pressure), not a test failure. No integration test failed. The full suite still has to be run (§8).

**Acceptance status, plainly:**

- Item 1 (typecheck, build, lint, prettier, openapi:lint): **met**.
- Item 2 (`pnpm test` in both locales): **not met as a full-suite pass**. Both full runs failed only on load timeouts in unchanged files, the C.UTF-8 run did not complete, and every failed file passes in isolation in both locales.
- Item 3 (full `pnpm test:integration`): **not met**. The run crashed after 705 passes and 0 failures. The affected-area subset passed 167/167.
- Item 4 (DG4 validator): **met**.

**Pinned counts:** no change. I routed no operation, so the media-type triple, the rate-limit floor and the operation count of `contract.test.ts` are unchanged.

## 5. Operations routed (delta to the pending list)

None. This repair task routes no new operation: `getTransformationMethodology` (the DG2 catalogue route) and the db-error mappings are not P5 pending operations. I have no `p5-pending-be-c2.ts` or `p5-exercises-be-c2.ts`, and `contract.test.ts` is untouched.

## 6. For the orchestrator: contract, schema, dependency, follow-ups

- **No contract, ADR, schema or dependency change is needed.** The fix fits ADR-0039 §2 and §3 as written.
- **For the architect (no action needed for DG5):**
  - `MethodologyCatalogue` items carry `methodologyVersionId` = the registry row's version (playbook v1), while `methodologyVersion` is the pinned version. A one-line description in the next ADR-0039 or openapi touch would make this explicit, for example "the registry version of the identity; see `methodologyVersion` for the pinned version".
- **Duplication (Low, my note).** `methodology/repository.ts` `resolveGates` repeats BE-C's mapping in `workflows/criteria.ts` `resolveGateDefinitions`. The reason: `methodology` imports no other module, and `criteria.ts` is outside my ownership and not an affected site. A later owner of `criteria.ts` could import the methodology version instead, but that needs a public export through `methodology/index.ts`.
- **The write semantics a reviewer may notice.** `putConfigElement` replaces an element's row (`config-resolver.ts`: "a full row therefore replaces them"). So a later draft that puts only a label on an element drops the help text an earlier version put on it, and that element's help falls back to the catalogue. Test 2 shows and asserts this behaviour. It is the existing BE-A/BE-B design, not something this task changed.

- **Worktree artifacts, not mine.** The worktree holds untracked, empty, read-only files that were present at the start or were created by the sandbox: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`.
  - Do not integrate them.
  - My files are only those listed in §1.

## 7. User-facing texts made untrue

- **No en/ar user-facing string** calls this behaviour planned or broken. I searched `apps/web/src/i18n/**` for the catalogue and versions and found none.
- **A comment, not user-facing, is now out of date:** `apps/web/e2e/p5-studio.spec.ts` l.7–10 (FE-B's file) says it does NOT publish a methodology version because a transformation pinned to a later version "gets empty DG2 catalogues …". That is no longer true after this fix.
  - The owner of that e2e file (FE-B, or the QA task that next touches it) may update the comment.
  - They may also add a methodology publish to the journey.
  - I did not edit it, because it is outside my ownership.

## 8. What remains

**The code and tests are complete. The full-suite verification is not.**

1. **Full `pnpm test` in both locales on a less-loaded machine.** Expected: unit-node 1973 tests (+4 new), unit-web 1429, formula 259 + 2 skipped. The orchestrator's merged-tree verification will cover this.
2. **Full `QA_PG_PORT=… MTH_PORT_POOL=… tests/qa/support/with-pg.sh pnpm test:integration`.** Expected: the previous merged count + 6, from the new `catalogue-versions.test.ts`. No pinned count changes.

Nothing else in my scope remains: no separable second half. The merge needs no migration and has no ordering constraint. A conflict is unlikely: the files I touched are owned by no other W11 task (BE-P, KBE-E, KBE-F). The one exception is `platform/db-errors.ts`, where another W11 task may also append a mapper near `mapDatabaseGuardError`. If both did, the conflict is a trivial two-line one in the wiring block.
