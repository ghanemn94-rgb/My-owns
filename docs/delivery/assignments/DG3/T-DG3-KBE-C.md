# Assignment T-DG3-KBE-C: T09 benefit formulas, versions, calculations, examples, Finance validation of benefit logic, and the kpi G4 facts (kpi-benefits-engineer)

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** prepared by the orchestrator. It is your current working directory (the runner's `--cwd`), on branch `dg3/kbe-c` at the integrated `HEAD` of `claude/mobily-transformation-platform-regate`, which already contains ARCH-01/02, wave 1 (BE-A, KBE-A) and wave 2 (BE-B, BE-C, BE-D, KBE-B), merged and verified. `node_modules` is installed and the packages are built. Work only in this tree: the sandbox makes every other tree read-only.
- **Concurrency (D-004):** two other implementers run at the same time in their own worktrees: ARCH-03 (contract amendments, ADRs, platform/portfolio/workflows follow-ups and `packages/shared/src/schemas/prioritization.ts`) and FE-A0 (`apps/web/**`). File ownership is disjoint by construction (`docs/architecture/p3-work-split.md`). Never edit a file outside your ownership list below. If you need one, describe the change in your handback, and the orchestrator applies it at integration.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** your run has a hard limit of about 2 hours. Run `date -u` at the start. Do the work in the order given under Scope. If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback listing exactly what remains. Never leave a half-written file.
- **Environment:** Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 is the floor. Run offline. Do not run `playwright install`. **Your harness ports are 23400–23449 only** (`QA_PG_PORT` and any listener). The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, the delivery records and `trading_agent/`.

## Binding design (read first)

- `docs/architecture/p3-work-split.md`:
  - §1 (frozen files);
  - §2 "Shared rules for every BE task" (rules 1–9), or §3 for KBE tasks;
  - **your section (§3 KBE-C)**;
  - §5 (contract-test seams);
  - §7 (the requirement → owner rows you own).
- ADR-0021 §10: the implementer rules, binding. ADR-0024 §5 (Finance validation: formula versions immutable, `unvalidated|validated|rejected`, validator never the author) and §6 in full (the engine API you call, the T09 tables, versioning and lineage, the routes, the two seeded examples, `fromExample`, the 400/422 boundary confirmed by ARCH-02); ADR-0021 §7 (the `g4.business_cases` and `g4.finance_validation` facts the kpi half of `GateFactsProvider` must supply).
- `docs/delivery/handbacks/DG3/T-DG3-BE-A-backend-workflow-engineer.md`: the module registry, the stubs you fill, the problem mapping in `platform/db-errors.ts`, `sequencing.ts`, the zod mirrors in `packages/shared/src/schemas/portfolio.ts`, and the contract-test wiring.
- `docs/delivery/handbacks/DG3/T-DG3-KBE-A-kpi-benefits-engineer.md` §3: the public API of `scoring.ts` and `formula/`. Import it from **`@mth/shared/calc`** (ARCH-02 moved it there to keep the top-level `@mth/shared` dependency-free). Call it; never re-implement the arithmetic.
- `docs/delivery/handbacks/DG3/T-DG3-ARCH-02-solution-architect.md`: the confirmed interpretations, the ownership notes and the corrected `0024`.
- `docs/api/openapi.yaml` (frozen), the migrations `0020`–`0025` (frozen), and `packages/db/src/schema.ts` (frozen).

## Scope (in this order)

1. **T09 register (REQ-PB-056).** `kpi/benefit-formulas.ts` on `/api/v1/benefit-formulas`, covering create (including `fromExample`), read, list and PATCH.
   - All six T09 columns persist: Benefit, Baseline driver, Change assumption, Formula (the current version's expression), Ramp, and Confidence.
   - Confidence outside H/M/L → 400 (enum and DB CHECK).
   - `BF-nn` codes come from `record_code_counter`.
   - `is_illustrative` is set for an instantiated example until it is edited.
2. **Versions** (`kpi/formula-versions.ts`): `POST /benefit-formulas/{id}/versions`.
   - **Parse and type-check with `@mth/shared/calc` before anything is written.** An invalid expression writes nothing.
   - The schema check gives 400. A body the schema admits but the engine refuses gives 422, with the first error's `code` and `message`. Examples:
     - `formula.undefined_variable` 'Undefined variable: {name}' (REQ-PB-056);
     - `formula.period_mismatch` for monthly ARPU × annual population (REQ-S08-007).
   - Versions are immutable. Variables are append-only per version.
   - Store `expression_sha256`, `result_kind/unit/currency/period`, `preview_result` and `engine_version`.
3. **Validate and preview, calculations and lineage** (`kpi/calculations.ts`).
   - `POST /benefit-formulas/validate` (parse, type-check and preview) writes nothing.
   - `POST …/versions/{versionNo}/preview` appends a `benefit_calculation` lineage row:
     - inputs with kind, unit, currency, period and source;
     - assumptions and the period;
     - the result, null when Unknown;
     - `outcome`, `error_code`, `engine_version` and the `rounding` record as returned.
   - Division by zero and a missing input give an Unknown result, never 0.
4. **The two seeded examples (REQ-PB-057, REQ-S08-007).**
   - Reading the examples shows the B0087 text verbatim, marked *Illustrative calculation, synthetic values*.
   - Instantiating `revenue_uplift` and previewing it gives exactly **100000** SAR per year (0.02 × 100000 × 50).
   - Instantiating `cost_reduction` gives exactly **500000** SAR per year.
   - Changing `arpu` to `period = month` while `eligible_customers` stays `year` → 422 `formula.period_mismatch`.
5. **Finance validation of benefit logic (REQ-PB-055).** `POST …/versions/{versionNo}/validation`: `finance.validate`, the validator is never the author (403, plus the DB CHECK), and the result is `validated` or `rejected` with a note.
6. **kpi G4 facts** (`kpi/p3-gate-facts.ts`): export `loadKpiP3GateFacts`, the `kpi` half of BE-A's `GateFactsProvider` (`workflows/g4.ts`). It returns:
   - the transformation case and the initiative cases with section completeness;
   - the baseline validation state, including **Stale**;
   - for every active financial benefit line, its formula's current version and that version's validation state.

   Export it from `kpi/index.ts`. BE-E wires it into `server.ts` after you merge. Do not edit `server.ts`.
7. **Shared schemas and wiring.**
   - Write `packages/shared/src/schemas/benefit-formula.ts`, plus its export line in `schemas/index.ts`.
   - Add your route-registration lines in `kpi/routes.ts` and your export lines in `kpi/index.ts`. KBE-B has merged, so these edits come after KBE-B's.
   - Add your own export line for `benefit-formula.ts` to `packages/shared/src/schemas/index.ts` (KBE-B handback §6.1). ARCH-03 adds a different line to the same file in parallel, and the orchestrator merges the two.
   - Extend the three pins in `apps/api/src/modules/kpi/kpi.test.ts` for your operations, exports and write permissions (KBE-B handback §6.2).
   - `@mth/shared/calc` is now on the API module allow-list (`architecture.testkit.ts`), so import the engine from it directly.
   - If your shell leaves empty `.claude/.cc-writes` directories inside source folders, remove them before you run the unit suite. They are harness artifacts, and the architecture and migrate tests flag them.
8. **Tests.** `test/integration/kpi/benefit-formulas.test.ts`:
   - the six T09 columns persist;
   - confidence X → 400;
   - an undefined variable → 422;
   - both seeded examples give exact results;
   - monthly ARPU × annual population → 422;
   - lineage rows are append-only;
   - FIN validation works, and the author gets 403;
   - AUD gets 403 on every mutation.

   Add a unit test for `p3-gate-facts.ts`, and a test asserting that `"validateFormula" in await import("@mth/shared")` is **false** while the calc subpath exports it (the ADR-0002 guard ARCH-02 suggested).

## Rules (binding; reviewers check every one)

Every mutation needs all of the following, each with a test:
- authorization re-checked at commit time (the BE18A pattern);
- validation;
- `If-Match` → 409/428 (creates are version 1);
- an audit event;
- a read-only auditor (AUD) gets **403** on every P3 mutation you route.

Also:
- No client or remote I/O inside a database transaction (BE17/BE18A).
- Amounts, weights, scores and FTE are decimal strings on the wire and `numeric` in SQL. Never use `Number()` on them.
- Unknown/Stale is never 0 or green.
- Free text goes through `freeText`/`hasText`/`hasInvalidCharacter`, and truncation only through `truncateText`.
- Strict UTF-8 parsing (BE13) applies. No route-local parser.
- `config.consumes` equals the contract's request media type (`application/json`).
- Every operation declares its §5b statuses.
- Problem `code`s are i18n keys, and the English `detail` texts are exactly the ADR texts.
- Remove each operation from your `test/support/p3-pending-kbe-c.ts` in the same change that routes it. Exercise it through the validating client in `test/integration/contract/p3-exercises-kbe-c.ts`.
- Product gates G1–G6 are business approvals inside the product. Nothing here grants a real business, Finance or IT approval, and nothing touches DG0–DG7 records.

## Acceptance (your self-check; real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes with `env -u LANG -u LC_ALL -u LC_CTYPE` and with `LANG=C.UTF-8 LC_ALL=C.UTF-8`. Report the counts.
3. `QA_PG_PORT=<a port in 23400–23449> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and your new tests. In `apps/api/test/integration/contract/contract.test.ts` you may change **only** the two pinned-count assertions (the media-type triple, currently `[90, 89, 1]`, and the rate-limit floor, currently `>= 167`) to the values your routing produces. Report old → new; the orchestrator reconciles them across tasks at integration.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-KBE-C-kpi-benefits-engineer.md` in your worktree, with logs under `docs/delivery/handbacks/DG3/T-DG3-KBE-C-evidence/`. Include:
- the start and end `date -u`;
- the files changed;
- the behaviour per requirement, quoting the acceptance texts it satisfies;
- the checks with exit codes;
- the pinned-count changes;
- any change you need in a file you do not own;
- anything left undone.
