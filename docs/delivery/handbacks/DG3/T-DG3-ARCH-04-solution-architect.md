# Handback T-DG3-ARCH-04: P3 ADR conformance follow-ups from wave 4 (solution-architect)

- **Stage:** P3, gate DG3 (BUILDING). Engineering work only. Nothing here grants or implies a business, Finance or IT approval. No product gate G1–G6 is decided, and nothing touches DG0–DG7 records.
- **Invocation:** `DG3-T-DG3-ARCH-04-solution-architect-20261008T024839Z-e6a5df97`, session `e6a5df97-dbe4-4d3c-8080-b4b5b83b2025`.
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-ARCH-04.md`, sha256 `13a9d152…6b76b78` (checked before starting).
- **Worktree:** `/home/user/wt/dg3-arch-04`, branch `dg3/arch-04`, base `HEAD` `e260f5a818df03e1dfec4dc1bd614c830c053036`. **The changes are not committed**, for the orchestrator to commit or merge, as for ARCH-03.
- **Time:** start `2026-10-08T02:48:47Z`, end `2026-10-08T03:12:55Z` (`date -u`), about 24 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` exited **0** ("PASS gate DG2 (historical)") before implementation and again at the end. Logs: `validate-DG2-start.log`, `validate-DG2-end.log`.
- **No `apps/web/**` file was touched** (D-004, FE-E).

## 1. Decisions and where they now live

### 1.1 The rounding record on the lineage row (ADR-0024 §6 item 11), done

- **Column.** Migration `packages/db/migrations/0027_p3_calculation_rounding.sql` (forward-only) adds `benefit_calculation.rounding jsonb NULL` with `CHECK (rounding IS NULL OR jsonb_typeof(rounding) = 'object')`.
- **Shape bound to the row.** `benefit_calculation_rounding_shape` requires:
  - all eight keys;
  - the constants `numeric(24,6)`, `6`, `ROUND_HALF_UP` and `80`;
  - `exact` to be a string or null, and `inexactIntermediate` a boolean;
  - **`rounding.rounded = rounded`** and **`rounding.stored = result::text`** (JSON null when Unknown).

  The record and the row's columns therefore cannot disagree.
- **NULL means "written before 0027", and nothing else.** `benefit_calculation_rounding_required CHECK (rounding IS NOT NULL) NOT VALID` is enforced on every new row but not checked against existing rows. The migration comment says so.
- **No backfill. The decision and the reasons** (migration comment and ADR-0024 §10):
  1. The table is append-only, so a backfill would have to disable the trigger and rewrite immutable lineage. That is the property the table exists to guarantee.
  2. No information is lost without one. Each pre-0027 row's record is already in its `benefit_calculation.create` audit event, written in the same transaction, and `audit_event` is append-only too.
  3. P3 is unreleased, so no production database holds such rows. A fresh database has none.

  Only dev or demo databases migrated through 0023–0026 can have them, and the API returns `rounding: null` for those rows, never a reconstructed value.
- **Contract (additive).**
  - `docs/api/openapi.yaml`: new component `FormulaRounding`. `BenefitCalculation` gains `rounding` (required, `oneOf [FormulaRounding, null]`).
  - Zod: `formulaRounding` and `benefitCalculation.rounding` in `packages/shared/src/schemas/benefit-formula.ts`.
- **Code.** `apps/api/src/modules/kpi/calculations.ts` writes `rounding: JSON.stringify(evaluation.rounding)` and returns it through `toBenefitCalculation`. The audit event still repeats the record. The header comment is updated.
- **Pinned counts.** No change. OpenAPI has 270 operations, and the `contract.test.ts` pins `[150, 149, 1]` and `>= 270` are untouched (no operation was added).
- **Recorded in:** ADR-0024 §6 item 11 (pointer), the new **§10**, Verification and the header "Physical model"; the data dictionary entry for `benefit_calculation` (column, three CHECKs, a header note on 0027); `p3-work-split.md` §9 item 18.

### 1.2 ADR-0021 §7, the G4 refusal shape: option (a)

I found no requirement that needs per-item entries in the 422. REQ-PB-019's acceptance is "rejected listing 'Owners'", and REQ-PB-046's is "rejected naming that initiative". Both are met because every label appears literally in the joined `message`. Option (b) would give `gate_criteria_incomplete` two shapes, or break the byte-stable G1–G3 refusals that DG2 approved.

ADR-0021 §7 now states the implemented shape ("The refusal shape"):

- one `errors[]` entry per incomplete mandatory criterion;
- `pointer` `/criteria/<key>`;
- `code` is the criterion's first missing-item code, or `gate.criterion_incomplete`;
- `message` is all of that criterion's labels joined with spaces;
- the `detail` text;
- every label appears literally;
- the per-item list with pointers is `GET /transformations/{id}/gates/G4` → `criteria[].missing[]`.

**The code is unchanged.**

### 1.3 Other wave-4 interpretations, recorded

| Item | Where it now lives |
|---|---|
| BE-E deselect rule (deselecting voids funding; re-selection needs a new decision; G4 reads the same function) | ADR-0021 §11 item 1; ADR-0023 §9 (cross-reference) |
| BE-E new codes and texts (`funding.not_selected`, `.not_revocable`, `.amount_invalid`, `resource_demand.not_planned`, `.not_committed`, `.release_first`, `resource_role.code_taken`, `.archived`, `capacity.duplicate`), checked against the source files | ADR-0023 §9 table |
| Commit authority through `capacity.commit` (the conservative reading; owner alone grants nothing; over-capacity commit allowed; commit-time re-authorisation confirmed in `waves.ts` `lockForWrite`) | ADR-0023 §9; ADR-0021 §11 item 5 |
| Unknown capacity counts as a G4 conflict | ADR-0021 §7 table (`g4.capacity` row) and §11 item 4; ADR-0023 §9 |
| `g4.initiative_card_incomplete` ('Initiative card incomplete: {code} {name} ({fields})', where the fields come from `name`, `objective`, `scopeIn`) | ADR-0021 §7 table (`g4.initiative_cards` row) and §11 item 2 |
| G4 roadmap reading (no cycle re-check because of the write-time guard; `g4.schedule_conflict` = unresolved dependency into an in-scope initiative with `schedule.needed_by_conflict` and a blank mitigation; `schedule.unknown` is not listed) | ADR-0021 §7 table (`g4.roadmap` row) and §11 item 3 |
| FE-A §5.3: unpaged lists refuse `limit` (confirmed as the contract's intent: these operations declare no `cursor`/`limit`, and ADR-0007 §5 uses strict queries) | ADR-0021 §11 item 6; new test `apps/api/test/integration/portfolio/unpaged-lists.test.ts` |
| FE-B §4.2 / FE-A §5.4: shared zod mirrors for `RoadmapWave(+List)`, `RoadmapView`, `DependencyType(Code)(+List)`, `T08Dependency(+Page)`, `PeriodMonth`, `ResourceRole(+List)`, `Capacity(+Page)`, `CapacityPlan(Cell)`, `ResourceDemand(+Page)` | new `packages/shared/src/schemas/roadmap.ts`, exported by `@mth/shared/schemas`; ADR-0021 §11 item 7; work split §9 item 19 |
| FE-B §4.4 cycle path order; §4.5 dependency-type admin at any scope; §4.6 read-only board; §4.7 reason on every approve-date (the contract stands) | ADR-0023 §9 |
| FE-C §4.3 override-source marker | now documented in the contract (`BenefitCalculation.inputs` description); ADR-0024 §10 |
| FE-C §4.4 no single-line business-case GET (intent) | ADR-0024 §10 |
| FE-A §5.5 anticipated BE-E audit action names, checked against the code | `p3-work-split.md` §9 item 21 |
| BE-E edits outside its ownership (`gates.ts`: 4 `loadGateFacts` call sites, checked in `f85eb45`; `workflows.test.ts`; `repository.ts` `precomputedFlags` + `assertInitiativeEditable`; item-13/14 work; `db-errors.ts`; `contract.test.ts` pins). Item 14's open point is closed. | `p3-work-split.md` §9 "Amendments after wave 4", items 16–17 |

**Contract mismatches found genuinely wrong:** none. The one contract edit besides `rounding` is a description: the override marker.

## 2. Files changed

| File | Purpose |
|---|---|
| `packages/db/migrations/0027_p3_calculation_rounding.sql` (new) | `rounding` column, shape and required (NOT VALID) CHECKs, column comment; no-backfill rationale |
| `packages/db/src/schema.ts` | `BenefitCalculationTable.rounding: NullableJson`; `SCHEMA_COLUMNS.benefit_calculation` + `rounding` |
| `packages/db/test/integration/catalogue.test.ts` | 0027 case: column type and nullability; the three CHECKs with `convalidated`; the definitions pinned |
| `apps/api/src/modules/kpi/calculations.ts` | writes and returns `rounding`; header comment |
| `apps/api/test/integration/kpi/benefit-formulas.test.ts` | revenue example: row, POST response and GET list carry the full record; override row; Unknown row (`exact`/`stored` null); DB refuses a missing, non-object, key-less or disagreeing record |
| `docs/api/openapi.yaml` | `FormulaRounding` component; `BenefitCalculation.rounding`; `inputs` description (override marker) |
| `packages/shared/src/schemas/benefit-formula.ts` | `formulaRounding`, `benefitCalculation.rounding` |
| `packages/shared/src/schemas/roadmap.ts` (new) | shared roadmap, T08 and capacity view mirrors |
| `packages/shared/src/schemas/roadmap.test.ts` (new) | 6 unit tests (Unknown capacity cell, FTE strings, strictness, RoadmapView, DependencyType code, FormulaRounding) |
| `packages/shared/src/schemas/index.ts` | `export * from "./roadmap.ts"` |
| `apps/api/src/modules/portfolio/{capacity,resource-demands,waves}.ts`, `apps/api/src/modules/workflows/{dependency-types,t08-dependencies}.ts` | local response mirrors replaced by the shared ones, re-exported under the same names; request schemas unchanged (behaviour unchanged; integration green) |
| `apps/api/test/integration/contract/p3-exercises-be-c.ts` | uses the shared `roadmapView` and mirrors; its local copy removed |
| `apps/api/test/integration/portfolio/unpaged-lists.test.ts` (new) | 8 unpaged lists: 200 `{items}` with no `nextCursor`; `?limit=10` gives 400; a paged list accepts `limit` |
| `docs/architecture/adr/ADR-0021-…md` | §7 refusal shape and table rows; new §11 |
| `docs/architecture/adr/ADR-0023-…md` | new §9 |
| `docs/architecture/adr/ADR-0024-…md` | §6 item 11, new §10, Verification, header |
| `docs/architecture/data-dictionary.md` | `benefit_calculation` entry and header note for 0027 |
| `docs/architecture/p3-work-split.md` | §9 "Amendments after wave 4", items 16–21 |
| `docs/delivery/handbacks/DG3/T-DG3-ARCH-04-*` | this handback and its evidence |

## 3. Checks actually run

Environment: Node `v24.21.0` (`/opt/nvm/versions/node/v24.21.0/bin`) and pnpm 10.33.0 (see `environment.txt`), offline. PostgreSQL 16.13 disposable cluster (UTF8, C locale) on harness ports 23701–23749. Logs are in `docs/delivery/handbacks/DG3/T-DG3-ARCH-04-evidence/`, and the exit summary is in `static-exits.txt`.

| Command | Exit | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` (start and end) | 0 / 0 | PASS gate DG2 (historical) |
| `pnpm -r typecheck` | 0 | also re-run on the final tree: 0 (`pnpm_-r_typecheck-final.log`) |
| `pnpm -r build` | 0 | see note 1 |
| `pnpm lint` | 0 | re-run after the Prettier fix: 0 |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 270 operations` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **123**, then 0 | see note 2 |
| `pnpm test` (LANG/LC_* unset) | 0 | 77 files, **1456 tests passed** |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 77 files, **1456 tests passed** |
| `QA_PG_PORT=23710 MTH_PORT_POOL=23711-23749 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | "applied **27 migrations** to a fresh database" (0001→0027); **55 files, 787 tests passed**; Postgres on 23710 at attempt 1 |

Notes:

1. `pnpm -r build` ran before the Prettier fix to `waves.ts`. That fix only re-wrapped one import list. The final typecheck, lint, unit and integration runs are all on the final tree.
2. Prettier attempt 1 (`prettier-ls-files-attempt1.log`) exited 123 on `apps/api/src/modules/portfolio/waves.ts`: my multi-line import fitted on one line. I fixed it with `prettier --write` (formatting only), and attempt 2 (`prettier-ls-files.log`) exited 0.
3. `integration.log` line 158 contains `"unhandled error","code":"ECONNRESET"`. That is the output of the deliberate BE17 `db-econnreset` fault-injection test, which passed. No hook timed out, and no test failed.
4. Earlier targeted runs during development all exited 0 and their logs are not kept:
   - `benefit-formulas.test.ts` + `catalogue.test.ts`: 27/27;
   - `catalogue.test.ts`: 12/12, run twice, once with a temporary `console.log` to read the constraint definitions, reverted from a copy;
   - `unpaged-lists.test.ts`: 1/1;
   - `roadmap.test.ts`: 6/6.

## 4. Known gaps and not done

- **Recommendation, not decided: should G4 list `schedule.unknown` dependencies?** As built and recorded (ADR-0021 §11 item 3), `g4.roadmap` lists only *known* late predecessors without a mitigation. A dependency into an in-scope initiative whose schedule is Unknown (no needed-by date, or an out-of-scope or external predecessor without a finish) does not block G4. T07 and T08 show it as Unknown.
  - This matches the §7 text literally. It sits uneasily with "Unknown is never 'no conflict'", which BE-E applied to capacity.
  - **My recommendation** is to list it as `g4.schedule_unknown` ('Schedule unknown: {dependency code}'), clearable by a mitigation, like the conflict.
  - Implementing it changes BE-E's `gate-facts.ts`/`g4.ts` and the G4 tests, which is outside this assignment. I raise it to the orchestrator for a decision and did not change it.
- **The web still uses its hand-typed views** for the roadmap, T08 and capacity responses. The shared mirrors exist now, and switching is a web task (FE-E or later), outside my scope.
- **Older databases.** A database migrated through 0023–0026 before this change keeps `rounding` NULL on its existing calculation rows, by decision (§1.1). A fresh database is unaffected.

## 5. Merge instructions

- **Migration:** `0027_p3_calculation_rounding.sql` runs after `0026`. It has no data step, and on an existing database it only adds a column and constraints. The `NOT VALID` constraint must stay `NOT VALID`; do not `VALIDATE` it.
- **Expected conflicts with FE-E:** none in `apps/web/**`. `packages/shared/src/schemas/index.ts` gains one export line at the end. Keep any line another task adds.
- **Changes to BE-C/BE-E/KBE-C files** (listed in §2 and in work split §9 items 18–19): if another task changed those files since `e260f5a`, re-apply them by hand. They swap the local response mirrors for shared re-exports, and add `rounding` in `calculations.ts`.
- **After merging,** run `pnpm -r typecheck`, `pnpm test` and the integration suite. The `contract.test.ts` pins are unaffected.
- **Don't commit** the sandbox-masked root dotfiles (`.bashrc`, `.bash_profile`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`) or any `.claude/.cc-writes/` directory. I removed the empty ones under `docs/architecture/adr/.claude/` and `apps/api/.claude/` before the test runs.
