# P3 work split: file ownership, contracts and integration order

- **Task:** T-DG3-ARCH-01 (solution-architect), 2026-10-07; amended by T-DG3-ARCH-02 after wave 1 (§9). **Stage:** P3 "Mobilization and portfolio" (DG3).
- **Scope:** the parallel P3 implementation tasks, each sized for about 60–75 minutes of agent time:
  - **backend-workflow-engineer:** BE-A, BE-B, BE-C, BE-D, BE-E;
  - **kpi-benefits-engineer:** KBE-A, KBE-B, KBE-C;
  - **frontend-ux-engineer:** FE-A, FE-B, FE-C.

  qa-verifier writes acceptance tests in its own areas (`tests/qa/**`, `e2e/**`).
- **Rule:** two tasks never edit the same file (REQ-DLV-008). Anything not listed under an owner below is **frozen**; changes go through the orchestrator.
- **Off-limits to every implementer** (the write guard enforces it): `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, `docs/delivery/reviews/**`, `docs/delivery/gates/**`, `docs/delivery/stages.json`, `docs/delivery/findings.json`, `docs/delivery/candidates/**`, `docs/delivery/runs/**`, `docs/delivery/test-evidence/**`, `CLAUDE.md`, `trading_agent/**`.
- **Product gates G1–G6 are business approvals inside the product.** Nothing in P3 reads or writes the engineering gate records DG0–DG7. G4 approval never implies any DG gate.

## 0. Already delivered by the architect (the shared foundation; do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADRs | `docs/architecture/adr/ADR-0021` (portfolio, lifecycle, sequencing, Modular, G4, G1 extension, readiness), `ADR-0022` (prioritization), `ADR-0023` (roadmap, dependencies, capacity, funding), `ADR-0024` (business case, formula foundation) | Binding design; §10 of ADR-0021 lists the implementer rules |
| P3 migrations | `packages/db/migrations/0020`–`0024` | Applied 0001→0024 on a fresh PostgreSQL 16.13 and 0020→0024 over a populated P2 database; every guard proven (handback evidence `docs/delivery/handbacks/DG3/T-DG3-ARCH-01-evidence/probe-output.txt`). **Frozen**: later changes are new migrations `0025+` (§1). |
| Kysely types for the 30 P3 tables (+ 2 dependency columns) | `packages/db/src/schema.ts` | Generated from the migrated catalogue; `catalogue.test.ts` updated |
| P3 permission catalogue and role defaults | `packages/shared/src/permissions.ts` (`P3_PERMISSIONS`, `P3_ROLE_PERMISSIONS`) | Equals 0024 (`seed.test.ts`) |
| Contract: 109 P3 operations; P1/P2 paths byte-stable; G1 extension on `GateDecisionCreate`/`GateDecision` | `docs/api/openapi.yaml` (`info.version` 1.2.0-p3) | `pnpm openapi:lint` PASS (270 operations) |
| ERD §1c, data dictionary "P3 tables", permissions matrix §9 | `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | Dictionary generated from the catalogue |
| Contract-test seams | `apps/api/test/support/p3-pending.ts` (aggregate, frozen) and one `p3-pending-<task>.ts` per task; `p2-pending.ts` includes the P3 set; `malformed-input.ts` and the media-type/rate-limit sweeps skip pending operations | See §5 |

## 1. Frozen shared files (owner: solution-architect; changes only via the orchestrator)

| Path | Why frozen |
|---|---|
| `docs/api/openapi.yaml` | The API contract (ADR-0007). A needed change is raised in the handback; the architect amends it. |
| `docs/architecture/**`, `docs/analysis/permissions-matrix.md` | Architecture and access decisions |
| `packages/db/migrations/0001`–`0024` | Schema foundation, forward-only. *(T-DG3-ARCH-02 corrected the audit `changes` shape in `0024` in place, before any release or gate, §9.)* |
| `packages/shared/src/permissions.ts`, `constants.ts`, `problem.ts`, `value.ts`, `index.ts`, `calc.ts`, `package.json` `exports` | Consumed by db, api, worker and web (`value.ts` is DG2-approved; KBE-A adds new files instead). The top-level entry stays dependency-free; the calculation code is on `@mth/shared/calc` (ADR-0002, ADR-0024 §6). |
| `packages/db/src/schema.ts` entries for 0001–0024, `packages/db/src/seed.test.ts`, `packages/db/test/integration/catalogue.test.ts` lines for 0001–0024 | Catalogue contract (BE-A appends entries for its `0025+` migrations; §2) |
| `apps/api/test/support/p3-pending.ts`, `p2-pending.ts`, `p2-pending-kpi.ts` | Seams; each task edits only its own `p3-pending-<task>.ts` |
| Root build configuration (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `playwright.config.ts`), `scripts/**` | Shared build and checks. Exception: KBE-A adds the ESLint override for `packages/shared/src/formula/**` (§3) |
| `dependencies` / `devDependencies` of every `package.json`, `pnpm-lock.yaml` | **No new dependency is needed for P3.** The formula engine is hand-written on decimal.js 10.6.0, already pinned in `@mth/shared`, `apps/api` and `apps/web`. A request goes in the handback. |

**Migrations after the freeze.** `0025+` are written only by backend tasks, in this order and numbering, so no two tasks pick the same number: `0025_p3_g1_agreement_guard.sql` (BE-A), `0026_p3_enable_g4.sql` (BE-E). KBE and FE request schema changes through the orchestrator.

## 2. backend-workflow-engineer

### Shared rules for every BE task (from ADR-0021 §10; reviewers check them)

1. Free text through the shared `freeText`/`hasText`/`hasInvalidCharacter` rules; truncation only through `truncateText`.
2. Strict UTF-8 JSON and query parsing (BE13) on every new route; no route-local parser.
3. `config.consumes` on every new route equals the operation's `requestBody.content` (all P3 bodies are `application/json`).
4. Every mutation: authorization re-checked at commit (BE18A), validation, If-Match → 409/428 (creates are version 1), an audit event, and a test of each; AUD gets 403 on every P3 mutation.
5. No remote or client I/O inside a database transaction (BE17/BE18A).
6. Money, rates, weights, scores and FTE are decimal strings; `Unknown`/`Stale` is never 0 or green.
7. Problem `code`s are i18n keys; English `detail` texts are exactly those in ADR-0021 §3/§7, ADR-0022, ADR-0023, ADR-0024.
8. Unit tests deterministic with explicit timeouts; harness ports below 32768; verification with the locale unset and with `C.UTF-8`.
9. Each task removes its operations from its own `test/support/p3-pending-<task>.ts` in the same change that routes them, and exercises each through the validating client in its own `test/integration/contract/p3-exercises-<task>.ts`.

### BE-A — foundation, G1 extension, readiness, dispensations (lands first)

**Owns:** `apps/api/src/modules.ts`, `server.ts`, `architecture.test.ts`, `architecture.testkit.ts`, `index.ts`, `main.ts`; `apps/api/src/modules/portfolio/index.ts` (registers every portfolio route file below, created as stubs exporting `register…Routes(app, deps)` that the other tasks fill), `portfolio/sequencing.ts` (+ test), `portfolio/readiness.ts`, `portfolio/dispensations.ts`, `portfolio/hierarchy.ts`; `apps/api/src/modules/platform/db-errors.ts` (problem mapping of the P3 constraint names: `*_version_step` → 409; `initiative_status_transition` → 422 invalid-transition; `dependency_acyclic` → 422 `dependency.cycle` with the cycle; `scoring_weight_set_total` → 422 `prioritization.weights_total`; `*_validator_not_author`, `*_approver_not_proposer`, `*_decider_not_recorder` → 403; CHECK/NOT NULL → 400/422 with pointers; `*_audit_required` → 500); `apps/api/src/modules/workflows/gates.ts` (G1 `agreements`, the snapshot hook calling `workflows/g4.ts`, which BE-A creates as a stub), `apps/api/src/modules/transformations/routes.ts` (the one-line switch of `POST /transformations` to `p3_instantiate_transformation()`); `packages/db/migrations/0025_p3_g1_agreement_guard.sql` (deferred constraint trigger: an approved G1 `gate_decision` needs exactly three `gate_decision_agreement` rows at COMMIT) and its `schema.ts`/`catalogue.test.ts` lines; `apps/api/test/integration/contract/contract.test.ts` (calls every `p3-exercises-<task>.ts`, created as stubs by BE-A), `test/support/harness.ts`, `test/support/contract.ts`, `test/integration/contract/malformed-input.ts` (`wellFormed` for the new path parameters: `criterionCode` → `feasibility`, `snapshotNo`/`versionNo` → `1`, `dependencyTypeCode` → `tech`), `media-types.ts`, `platform-statuses.ts`; `test/integration/portfolio/readiness.test.ts`, `dispensations.test.ts`, `g1-agreements.test.ts`; `test/support/p3-pending-be-a.ts`; `test/integration/contract/p3-exercises-be-a.ts`; the DG2 tests that approve G1 (`gates.test.ts` and helpers under `test/support/**`) to send `agreements`; `packages/shared/src/schemas/portfolio.ts` (zod mirrors of every P3 *portfolio-tag* schema; other tasks import it) and `packages/shared/src/schemas/index.ts`.

**Resources:** `GET /transformations/{id}/readiness`, `GET /transformations/{id}/outcome-hierarchy`, `gate-dispensations` (+ decision, revoke); the G1 decision extension (`decideGate`).

**First change (merge before anyone else integrates):** module registry (`portfolio` with `dependsOn: transformations, kpi, evidence, access, audit, platform, workflows`; `workflows.dependsOn += ["portfolio"]` is **not** allowed — `workflows` reads portfolio facts only through the `GateFactsProvider` interface it defines in `workflows/g4.ts` and that `server.ts` wires with `portfolio`'s and `kpi`'s loaders, so no module cycle), stubs, the problem mapping, `p3_instantiate_transformation` on create, `portfolio.ts` zod mirrors.

### BE-B — initiatives, links, lifecycle, selection

**Owns:** `portfolio/initiatives.ts`, `portfolio/links.ts`, `portfolio/transitions.ts`, `portfolio/selections.ts`, `portfolio/repository.ts`; `test/integration/portfolio/initiatives.test.ts`, `links.test.ts`, `transitions.test.ts` (every ADR-0021 §3 transition, every 422 with its exact text, End-to-End vs Modular, AUD 403); `test/support/p3-pending-be-b.ts`; `test/integration/contract/p3-exercises-be-b.ts`.

**Also owns (T-DG3-ARCH-02):** `latestFundingState()` in `portfolio/funding.ts`, a read-only query over `funding_decision` (the latest decision of the initiative decides; none means `unfunded`, fail closed), with its unit or integration test. BE-B edits only that function and its imports; BE-E later adds the funding routes to the same file, after BE-B has merged.

**Resources:** `/initiatives` (CRUD, submit, withdraw, select, deselect, launch, cancel), `/initiatives/{id}/gap-links`, `outcome-contributions`, `decision-links`, `selections`. Launch reads funding through `portfolio/funding.ts`'s exported `latestFundingState()` (BE-B implements it; BE-A's stub returned `unfunded`).

### BE-C — roadmap, deliverables, milestones, T08 dependencies

**Owns:** `portfolio/waves.ts`, `portfolio/deliverables.ts`, `portfolio/milestones.ts`, `portfolio/roadmap.ts`, `portfolio/schedule.ts` (+ unit test: needed-by conflict, before-predecessor, unknown); `apps/api/src/modules/workflows/t08-dependencies.ts`, `workflows/dependency-types.ts`, `workflows/design-registers.ts` (only the DG2 dependency projection rule: non-DG2 type codes shown as `other`, 422 `dependency.managed_by_t08`); `test/integration/portfolio/roadmap.test.ts`, `test/integration/dependencies/t08.test.ts` (A→B→C→A and A→B→A named; two-connection race, exactly one commits; external From; unknown type; system type DELETE 422); `test/support/p3-pending-be-c.ts`; `test/integration/contract/p3-exercises-be-c.ts`.

**Also edits (T-DG3-ARCH-02):** the T08 and dependency-type route registration lines in `apps/api/src/modules/workflows/index.ts` (BE-A's file), registration lines only.

**Resources:** `waves`, `roadmap`, `deliverables` (+ submit, acceptance), `milestones` (+ approve-date), `/dependencies` (T08), `/dependency-types`. The cycle check takes `pg_advisory_xact_lock(730221, hashtext(transformation_id))` (export `DEPENDENCY_GRAPH_LOCK_CLASS = 730221`) before its friendly BFS check, then writes; the DB guard re-checks.

### BE-D — prioritization

**Owns:** `portfolio/prioritization.ts`, `portfolio/scores.ts`, `portfolio/rankings.ts`, `portfolio/overrides.ts`; `test/integration/portfolio/prioritization.test.ts` (score 6 → 400; 95%/105% → 422 nothing written; v2 with risk_compliance 10 and strategic fit 15 accepted and approved by SP; v1 results keep v1; history shows 'weight version 2'; override without reason rejected; proposer cannot approve); `test/support/p3-pending-be-d.ts`; `test/integration/contract/p3-exercises-be-d.ts`.

**Consumes:** `scoring.ts` (KBE-A) from **`@mth/shared/calc`** for every calculation; never re-implements the arithmetic. The problem-code and status rules are in ADR-0022 §2a.

### BE-E — capacity, funding, G4 (lands last on the backend)

**Owns:** `portfolio/capacity.ts`, `portfolio/resource-demands.ts`, `portfolio/funding.ts` (the funding routes, added after BE-B's `latestFundingState()`; BE-E does not rewrite that function), `portfolio/gate-facts.ts` (the portfolio part of `GateFactsProvider`); `apps/api/src/modules/workflows/g4.ts` (the eight `g4.*` evaluators and the G4 snapshot builder, ADR-0021 §7) and `workflows/criteria.ts` (register the G4 evaluators in `EVALUATORS`); `packages/db/migrations/0026_p3_enable_g4.sql` (`UPDATE gate_definition SET submission_enabled = true … WHERE code = 'G4'`); the DG2 assertion in `apps/api/test/integration/gates.test.ts` that G4 is not submittable (change it to G5/G6 only) — coordinated: BE-A owns `gates.test.ts` until BE-A merges, BE-E edits it afterwards; `test/integration/portfolio/capacity.test.ts`, `funding.test.ts`, `test/integration/gates/g4.test.ts` (G4 submit 422 listing 'Owners', 'Finance validation', the initiative names, funding and capacity; decide 403 not approver, 403 submitter, 409 superseded; approved G4 → phase `transform`; G4 end-to-end with distinct synthetic TL/FIN/SP users); `test/support/p3-pending-be-e.ts`; `test/integration/contract/p3-exercises-be-e.ts`.

**Also edits (T-DG3-ARCH-02), only after the named task has merged:** the one line in `apps/api/src/server.ts` that wires the `kpi` half of `GateFactsProvider` (`kpi: loadKpiP3GateFacts` from `kpi/index.ts`, after KBE-C); and in BE-D's `portfolio/prioritization.ts`, only the lines that inject the schedule flags (BE-C's `schedule.ts`) and the capacity flags (BE-E's `capacity.ts`) into the prioritization view.

**Resources:** `resource-roles`, `/capacity`, `capacity-plan`, `/resource-demands` (+ commit, release), `/funding-decisions` (creates the canonical executive `decision` row and moves `selected → funded`), G4 through the existing gate paths.

## 3. kpi-benefits-engineer

### KBE-A — shared calculation code (lands first, in parallel with BE-A)

**Owns:** `packages/shared/src/scoring.ts` (+ `scoring.test.ts`: 5,4,3,2,1 → 3.3000/3.30; 0–100 of 3.30 → 57.5; 95/105 rejected; incomplete; property test over all 5^5 combinations), `packages/shared/src/formula/**` (`tokenize.ts`, `parse.ts`, `typecheck.ts`, `evaluate.ts`, `index.ts` and tests: grammar table, undefined variable, period mismatch monthly × annual, `to_period`, division by zero → Unknown, revenue example 100000 exact, cost example 500000 exact, limits), the export lines for both in `packages/shared/src/index.ts` (the only edit to that file; T-DG3-ARCH-02 moved them to the `@mth/shared/calc` barrel `packages/shared/src/calc.ts`), and the ESLint override block for `packages/shared/src/formula/**` in `eslint.config.js` (`no-eval`, `no-implied-eval`, `no-new-func`, `no-restricted-imports` vm/node:vm, `no-restricted-syntax` ImportExpression) — the only edit to that file. **Delivered** (T-DG3-KBE-A); its interpretations are confirmed in ADR-0022 §2a and ADR-0024 §6.

### KBE-B — business cases

**Owns:** `apps/api/src/modules/kpi/business-cases.ts`, `kpi/business-case-lines.ts`, `kpi/totals.ts` (+ unit test: distinct lines once, roll-up by reference, gross/cost/net separate, Unknown never 0, per currency); `test/integration/kpi/business-cases.test.ts` (ten sections; two classes → 400; mismatch → 422; editing an initiative case changes the roll-up without duplication; FIN baseline validation, author 403; AUD 403); `packages/shared/src/schemas/business-case.ts`; `test/support/p3-pending-kbe-b.ts`; `test/integration/contract/p3-exercises-kbe-b.ts`.

### KBE-C — benefit formulas and the kpi G4 facts

**Owns:** `apps/api/src/modules/kpi/benefit-formulas.ts`, `kpi/formula-versions.ts`, `kpi/calculations.ts`, `kpi/p3-gate-facts.ts` (the `kpi` part of `GateFactsProvider`: business cases, section completeness, baseline validation state incl. Stale, formula version validation per benefit line); the export lines for these in `apps/api/src/modules/kpi/index.ts` and the route registration lines in `kpi/routes.ts` (KBE-B adds its own registration lines first; KBE-C merges after KBE-B, so the two edits are sequential, not concurrent); `test/integration/kpi/benefit-formulas.test.ts` (six T09 columns; confidence X → 400; undefined variable → 422; the two seeded examples; monthly ARPU × annual population → 422; lineage rows; FIN validation, author 403); `packages/shared/src/schemas/benefit-formula.ts`; `test/support/p3-pending-kbe-c.ts`; `test/integration/contract/p3-exercises-kbe-c.ts`.

KBE-C imports the engine from **`@mth/shared/calc`**. The 400/422 boundary and the lineage `rounding` record are fixed in ADR-0024 §6 ("Engine details confirmed").

**Must not touch (all KBE tasks):** `modules.ts`, `server.ts`, `contract.test.ts`, migrations, `schema.ts`, `apps/web/**`.

## 4. frontend-ux-engineer

Shared rules: every string through i18next in `ar` (RTL) and `en` (LTR); RecordForm and the hand-written-form blank rules (one form-level alert in one live region, axe-clean banners); session-bound actions through `apps/web/src/auth/sessionBound.ts` (ESLint forbids raw `navigate` and direct `setQueryData`); amounts, scores, weights and FTE formatted with `@mth/shared/schemas` (`formatDecimal`) and `@mth/shared/calc` (`scoring.ts`), never `Number()`; Unknown/Stale shown as such, never 0 or green; AUD sees read-only views; `#0078FF` stays provisional; "business approval" labels on selection, funding, weight-set, override, dispensation and G4 actions, never DG0–DG7. Each FE task owns its own i18n namespaces and route files; `app/router.tsx`, `app/nav.ts`, `api/client.ts`, `api/queries.ts`, `api/types.ts` are owned by **FE-A**, which adds the routes, nav entries and query keys for all three FE tasks in its first change (query keys: `["roadmap", transformationId]` is the one cache entry the timeline, table and board share).

### FE-A — portfolio, readiness, G1 agreements, G4

**Owns:** `apps/web/src/pages/portfolio/**` (initiative list with 'Selected - unfunded', initiative card T05 with all 14 fields and the 3–7 deliverable warning, transitions with their 422 texts, gap links and contributions, selection), `pages/readiness/**`, `pages/dispensations/**`, the G1 agreements step in the existing gate decision dialog (`pages/gates/**`) and the G4 view; `app/router.tsx`, `app/nav.ts`, `api/**`; `i18n/{en,ar}/{portfolio,readiness}.json` and the G4/G1 keys in `i18n/{en,ar}/gates.json`; their tests.

### FE-B — prioritization, roadmap, dependencies, capacity

**Owns:** `pages/prioritization/**` (scorecard with read-only weighted score and 'incomplete', weight sets with the 100% check, ranked table, value/feasibility chart, 0–100 view with its label, ranking history with 'weight version N', overrides), `pages/roadmap/**` (timeline, initiative table and work board on the single `["roadmap", id]` entry; moving a milestone updates all three; 409 conflict banner), `pages/dependencies/**` (T08 map, cycle message, schedule flags, types admin), `pages/capacity/**` (role × month grid, conflict indicator, Unknown capacity); `i18n/{en,ar}/{prioritization,roadmap,dependencies,capacity}.json`; their tests.

### FE-C — business cases and T09

**Owns:** `pages/business-cases/**` (ten sections, lines with exactly one class, totals with gross/cost/net separate, roll-up, Finance validation state incl. Stale), `pages/benefit-formulas/**` (T09 register, formula builder using `@mth/shared/calc` (`validateFormula`, `evaluateFormula`, `displayNumber`) for live parse/type-check/preview, units and periods, fraction vs percentage points (suffix text through i18next from `displayNumber`'s suffix code, ADR-0024 §6 item 13), examples marked illustrative, Finance validation); `i18n/{en,ar}/{business-cases,benefit-formulas}.json`; their tests.

**Must not touch (all FE tasks):** `apps/api/**`, `apps/worker/**`, `packages/**`, `docs/**`.

## 5. Contract-test seams (no shared-file writes)

- Every P3 operation is in exactly one `apps/api/test/support/p3-pending-<task>.ts` (BE-A 6, BE-B 20, BE-C 25, BE-D 17, BE-E 17, KBE-B 11, KBE-C 13 = 109). The aggregate `p3-pending.ts` feeds `P2_PENDING_OPERATIONS`, so route coverage, the exercised-operations check, the media-type sweep, the malformed-input sweeps and the rate-limit sweep skip unrouted operations, and the route-coverage test fails if a listed operation is routed or exercised.
- Each task exercises its operations in its own `test/integration/contract/p3-exercises-<task>.ts`; BE-A's first change wires all seven into `contract.test.ts`.
- Pinned counts that move as operations are routed (BE-A owns `contract.test.ts`; the other tasks report their new counts in the handback and BE-A or the integrator updates them): the media-type triple `[87, 86, 1]` (live operations with a body) and the rate-limit floor (`>= 161`). **After BE-A they are `[90, 89, 1]` and `>= 167`** (T-DG3-ARCH-02); each later task reports its own new values in its handback.
- **All pending lists must be empty when the DG3 candidate freezes.** qa-verifier checks this.

## 6. Integration order

1. **BE-A first change** and **KBE-A** (parallel; disjoint files).
2. **In parallel after step 1:** BE-B, BE-C, BE-D, KBE-B; FE-A (first change: router/nav/api, then screens against the contract with stubbed responses), FE-B, FE-C.
3. **KBE-C** after KBE-B (sequential `kpi/routes.ts` and `kpi/index.ts` edits).
4. **BE-E** after BE-B, BE-C, BE-D and KBE-C (it needs every fact loader): capacity, funding, G4 evaluators, `0026` enabling G4.
5. **FE wiring** to the live API (FE-A, FE-B, FE-C merge last).
6. **Integration checks (orchestrator):** `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r build && pnpm lint && pnpm format:check && pnpm openapi:lint`; `pnpm test` (locale unset and `C.UTF-8`); `QA_PG_PORT=<port<32768> tests/qa/support/with-pg.sh pnpm test:integration` (all pending lists empty); e2e; `node tools/gates/validate.mjs --stage DG3`.

**Expected merge conflicts:** none by construction. Shared touch points are sequenced (BE-A before others on `index.ts`/stubs; KBE-B before KBE-C on `kpi/routes.ts`; BE-A before BE-E on `gates.test.ts`).

## 7. Requirement → owner (the 32 rows with final gate DG3)

| Requirement | Owner(s) |
|---|---|
| REQ-S16-016 (entity group; create+read each through the API with authorization) | BE-B (Initiative), BE-C (Deliverable, Milestone, RoadmapWave, Dependency), BE-E (ResourceDemand, Capacity, FundingDecision); ERD/migrations: architect (done) |
| REQ-PB-004 (End-to-End launch 422 'North Star, outcomes and target state not yet approved'; succeeds after G2+G3) | BE-B (transition), BE-A (`sequencing.ts`, waivers), FE-A |
| REQ-PB-006 ('Outcome before activity') | BE-B, FE-A |
| REQ-PB-007 (no leaving Draft before G1; readiness lists missing diagnostic areas) | BE-A (readiness, mapping), BE-B (transition), FE-A |
| REQ-PB-019 (G4 evidence; 'Owners') | BE-E, FE-A |
| REQ-PB-022 (G1 agreements; no portfolio entry before G1) | BE-A (G1 extension, `0025`), BE-B (submit 422), FE-A |
| REQ-PB-032 (five-level hierarchy; contribution needs an outcome) | BE-B (contributions), BE-A (hierarchy view), FE-A |
| REQ-PB-040 (TOM ≠ portfolio; initiative as G3 evidence rejected; 1..n gap links) | BE-B, FE-A |
| REQ-PB-045 (T05 14 fields; 3–7 warning) | BE-B, BE-C (deliverables, milestones), FE-A |
| REQ-PB-046 (gap + outcome trace; G4 names the initiative without a gap link) | BE-B, BE-E (G4), FE-A |
| REQ-PB-047 (T06 persists criteria; weighted score read-only) | BE-D, KBE-A, FE-B |
| REQ-PB-048 (25/25/20/15/15; 3.30 exact; 6 rejected; 'incomplete') | KBE-A (arithmetic), BE-D, FE-B |
| REQ-PB-049 (weights per transformation; 95/105 rejected; v2 with risk/compliance; versioned, immutable) | BE-D, KBE-A, FE-B |
| REQ-PB-050 (four waves verbatim, bilingual; overlap accepted) | architect (seed, done), BE-C, FE-B |
| REQ-PB-051 (T08 7 columns; External; cycles reported) | BE-C, FE-B |
| REQ-PB-052 (system types undeletable; configurable; unknown rejected) | BE-C, FE-B |
| REQ-PB-053 (ten sections; one investment class; SAR decimals) | KBE-B, FE-C |
| REQ-PB-054 (transformation + initiative cases; roll-up without duplication) | KBE-B, FE-C |
| REQ-PB-055 (Finance validation before G4; 'Finance validation') | KBE-B, KBE-C (validation), BE-E (G4), FE-C |
| REQ-PB-056 (T09 6 columns; H/M/L; undefined variable rejected) | KBE-A (engine), KBE-C, FE-C |
| REQ-PB-057 (two examples seeded; 100000 SAR exact; cost exact) | architect (seed, done), KBE-A, KBE-C, FE-C |
| REQ-PB-059 (role-based capacity and demand; conflict indicator; G4 lists initiatives without owners) | BE-E, FE-B |
| REQ-DLV-035 (P3 outputs and evidence: 3.30 tests, 95% rejected, cycles, G4 end to end) | KBE-A, BE-D, BE-C, BE-E; qa-verifier (acceptance and e2e) |
| REQ-S04-006 (Mobilize procedure and G4: funding/capacity named; 403/403/409) | BE-E, FE-A |
| REQ-S05-005 (one class per line; total = distinct lines once) | KBE-B, FE-C |
| REQ-S08-007 (fraction; monthly × annual rejected; 0.02 × 100000 × 50 = 100000) | KBE-A, KBE-C, FE-C |
| REQ-S09-001 (0–100 view (score−1)/4×100, 3.30 → 57.5, labelled) | KBE-A, BE-D, FE-B |
| REQ-S09-003 (ranking ≠ selection ≠ funding; 'Selected - unfunded' cannot launch) | BE-B (selection, launch), BE-D (ranking), BE-E (funding), FE-A |
| REQ-S09-004 (value/feasibility, filters, ranked table, before-predecessor flag, capacity conflict) | BE-D, BE-C (`schedule.ts`), BE-E (capacity), FE-B |
| REQ-S09-005 (history explains changes; 'weight version 2'; override needs a reason) | BE-D, FE-B |
| REQ-S09-006 (timeline, table, board on the same data; 409 on conflicting edits) | BE-C, FE-B |
| REQ-S09-008 (A→B→C→A rejected naming the cycle; race-free; needed-by conflict flagged) | architect (DB guard, done), BE-C, FE-B |

## 8. P3 increments of rows that complete at later gates (listed only; P3 builds what the 32 rows need)

| Row(s) | P3 increment in this architecture | Owner |
|---|---|---|
| REQ-PB-005, REQ-S03-005 | Modular inherited approvals captured as evidence-backed `gate_dispensation` rows, never gate decisions | BE-A, FE-A |
| REQ-S03-004, REQ-S04-012, REQ-S04-013 | End-to-End waivers (`gate_dispensation` kind `waiver`: reason, scope, approver, expiry) for sequencing only; gate-submission waivers remain DG4 | BE-A |
| REQ-PB-010, REQ-PB-044, REQ-S03-006 | Initiative ↔ gap/finding, initiative ↔ outcome/KPI, initiative ↔ decision links; outcome-hierarchy view (the full traceability view and orphan report are DG4) | BE-A, BE-B |
| REQ-PB-014, REQ-PB-015, REQ-S04-001, REQ-S04-002, REQ-S04-009, REQ-S04-010, REQ-S12-010 | G4 criteria, snapshot and phase advance to `transform` on the ADR-0015 engine | BE-E |
| REQ-PB-013 | Finance validation of business-case baselines and formula versions restricted to `finance.validate`, never the author | KBE-B, KBE-C |
| REQ-PB-058, REQ-S08-003, REQ-S08-011, REQ-S16-017 | One formula → one active line; one line → one case; set-based roll-up; gross/cost/net separate. The canonical benefit register, allocations and scenarios are DG4 | KBE-B, KBE-C |
| REQ-S07-011, REQ-S08-004, REQ-S08-006, REQ-S08-008 | Restricted language, typed units/periods, versions and lineage; the cost example uses one period basis | KBE-A, KBE-C |
| REQ-S09-007 | Approved vs forecast milestones, deliverable acceptance, role-based capacity and FTE demand (budget/actual/forecast is DG4) | BE-C, BE-E |
| REQ-S09-009 | Explicitly **out of P3 scope**: no critical-path claim or highlighting (ADR-0023 §5) | — |
| REQ-S16-018 | Funding decisions on the canonical `decision` table (kind `executive`); T08 on the canonical `dependency` | BE-E, BE-C |
| REQ-S16-025, REQ-S16-026, REQ-S16-032, REQ-S16-023, REQ-S16-027 | Decimal columns, version step, audit coverage, CHECKed statuses and documented APIs on every P3 table (DB guards done; API per task) | all |
| REQ-S20-005, REQ-S20-008, REQ-S20-010, REQ-S20-014 | P3 parts of A05 (3.30, 100000), A08 (G4 controls), A10 (line classes, roll-up), A14 (409 on milestone moves) | qa-verifier |
| REQ-S01-*, REQ-S02-006, REQ-S15-*, REQ-S19-*, REQ-S21-*, REQ-DLV-* | Platform-wide and delivery rules applied by every task (bilingual, server-side controls, no builder-hosted services, handbacks, independent reviews) | all / orchestrator |
| REQ-PB-009, REQ-S03-003, REQ-S09-010, REQ-S04-014, REQ-S16-017 (Scenario, Benefit, BenefitAllocation, BenefitMeasurement), REQ-S08-005, REQ-S08-018 | Not built in P3 (`completed` status reserved; rebaseline change control, impact assessment, scenarios, benefit register and studio previews are later stages). No P3 table blocks them. | Later stages |

## 9. Amendments after wave 1 (T-DG3-ARCH-02, 2026-10-07)

Recorded from the T-DG3-BE-A and T-DG3-KBE-A handbacks; wave 2 (BE-B, BE-C, BE-D, KBE-B) builds on them.

1. **BE-A's files outside its "Owns" list are accepted as BE-A's:** `packages/shared/src/schemas/gate.ts` (G1 `agreements`), `apps/api/src/modules/workflows/index.ts`, `workflows/workflows.test.ts`, `apps/api/src/server.test.ts`, `apps/api/test/integration/registers.test.ts` and `transformations.test.ts`. Later edits by other tasks are only those named in this file (BE-C's registration lines in `workflows/index.ts`).
2. **Shared edit points, sequenced** (the "Also owns/edits" notes in §2): BE-C adds its route registration lines to `workflows/index.ts`. BE-B implements `latestFundingState()` in `portfolio/funding.ts`, and BE-E adds the funding routes to that file after BE-B. BE-E wires the `kpi` half of `GateFactsProvider` in `server.ts` (one line, after KBE-C), and the schedule and capacity flag injection lines in BE-D's prioritization view.
3. **Import path:** the T06 arithmetic and the T09 engine are imported from **`@mth/shared/calc`**, not from `@mth/shared` (ADR-0002 "`@mth/shared` entry points", ADR-0024 §6).
4. **`0024` audit shape:** the `scoring_weight_set.create` event now writes `{"weights": {"from": null, "to": {…}}}` in `0024` itself (function and backfill path); `0025`'s identical `CREATE OR REPLACE` is kept and marked redundant. A database that applied the earlier `0024` must be rebuilt, because the migrator refuses checksum drift (unreleased and ungated, so only scratch and dev databases are affected).
5. **Pinned contract counts:** `[90, 89, 1]` and `>= 167` (§5).
6. **Dispensation decisions:** `POST …/gate-dispensations/{dispensationId}/decision` with `AcceptanceDecision`; delegated decisions are refused with 422 `dispensation.on_behalf_not_supported` (ADR-0021 §5).

### Amendments after wave 2 (T-DG3-ARCH-03, 2026-10-08)

Recorded from the BE-B, BE-C, BE-D and KBE-B handbacks. Wave 3 (BE-E, KBE-C, FE-A0, then FE-B and FE-C) builds on them.

7. **Delegation, one rule (ADR-0021 §6).** Every P3 business approval is decided in person. `onBehalfOfUserId` is refused with 422 `{domain}.on_behalf_not_supported` at `/onBehalfOfUserId`, and nothing is written:
   - selection: `selection.on_behalf_not_supported`, **changed** in `selections.ts`;
   - funding: `funding.on_behalf_not_supported`, **for BE-E to implement**;
   - override decisions: `prioritization.on_behalf_not_supported`;
   - dispensations: `dispensation.on_behalf_not_supported`.

   Weight-set approval and the revokes have no such property (strict schema, 400). Record-owner decisions (design decision, `gate_decision` incl. G4, deliverable acceptance) keep the ADR-0015 one-hop path. Delegation for the P3 approvals arrives with REQ-S10-010 (P4).
8. **`getPrioritization` contract:** the `funding` query parameter and `"422": BusinessRule` (`prioritization.portfolio_too_large`) are now declared in `docs/api/openapi.yaml` and exercised over HTTP in `p3-exercises-be-d.ts` (ADR-0022 §7). No other path changed.
9. **Advisory-lock registry (ADR-0016 §6).** The classes are 730219 BU hierarchy, 730220 outcome, 730221 dependency graph, 730222 prioritization and **730223 dependency type** (was 730222: the collision is fixed). The numbers live only in `platform/advisory-locks.ts` (`ADVISORY_LOCK_CLASSES`), which `platform/advisory-locks.test.ts` pins. A new class takes 730224 and adds a row to both.
10. **Shared prioritization mirrors:** `packages/shared/src/schemas/prioritization.ts`, exported by `@mth/shared/schemas`. It holds `criterionCode`, `WeightSet*`, `ScoreResult`, `InitiativeScore*`, `RankingEntry`, `RankingSnapshot*`, `RankingChange`, `RankingOverride*`, `ApprovalDecision`, `PrioritizationItem`/`View` and `prioritizationQuery`. BE-D's route files import them; **FE-B imports from there** and defines no copy.
11. **One cycle-problem class:** `DependencyCycleProblem` (and `CycleNode`) are on `platform/index.ts`. `T08CycleProblem` is deleted. The 422 body is byte-identical (ADR-0023 §8).
12. **T08 schedule flags are injected explicitly** (ADR-0023 §8): `server.ts` passes `t08ScheduleFlags` (exported by `portfolio/index.ts`) to `registerWorkflowsModule`. The Fastify decorator is gone. **BE-E and KBE-C:** the `registerWorkflowsModule(app, deps, { gateFacts, t08ScheduleFlags })` line in `server.ts` changed. The `kpi:` line of `gateFacts` just above it did not.
13. **BE-E consolidates the three initiative presenters.** BE-B's `presentInitiatives` (`portfolio/repository.ts`) is **the** single presenter. BE-E replaces the local copies in BE-C's `portfolio/roadmap.ts` and in BE-D's prioritization view (`portfolio/prioritization.ts` `presentInitiative`) with calls to it, and wires the schedule and capacity `flags[]` there once (BE-B §7.5). The contract tests must keep passing with the shared `initiative` mirror. Note that BE-D's local `displayStatus` (`'Selected - unfunded'`) differs from BE-B's i18n key (`initiative.status.selected_unfunded`); BE-B's form is the contract's.
14. **Open point (ADR-0021 §2):** `assertEditable` (cancelled or completed initiative → 422 `initiative.read_only`) covers the T05 card and BE-B's links only. Scores, deliverables and milestones on a closed initiative are not refused yet. BE-E applies the guard to its resource-demand writes, and the integrator or a repair round extends it to scores (BE-D files) and deliverables and milestones (BE-C files).
15. **ADR alignment, as built:**
    - ADR-0021 §2: no `archived_*` columns on `initiative`; `cancelled` is the terminal retirement.
    - ADR-0022 §8: BE-D's codes and texts; "ranked but now incomplete keeps `ranked`"; scoring a draft is allowed; the prioritization lock.
    - ADR-0023 §8: `GET /dependency-types` is `authenticated`; `varianceDays` stays in calendar days, and the working-day slip of REQ-S09-007 waits for the business calendar.
    - ADR-0024 §9: KBE-B's interpretations and texts.

### Amendments after wave 4 (T-DG3-ARCH-04, 2026-10-08)

Recorded from the T-DG3-BE-E handback (built in wave 3, integrated with wave 4 in `367fa53`) and the T-DG3-FE-A, FE-B and FE-C handbacks. Wave 5 (FE-E) builds on them.

16. **BE-E's edits outside its "Owns" list are accepted as BE-E's** (BE-E handback §3, §6). Each was checked against the merge commit `f85eb45`:
    - **`workflows/gates.ts` (BE-A):** the already-injected `gateFacts` provider is passed to `loadGateFacts(…, gateFacts)` at its four call sites (gates list, gate GET, gate PATCH view, submit), and no other line changed. Without it the G4 evaluators never see the portfolio or kpi facts, because `workflows` must not import `portfolio`. G1–G3 are unchanged: their evaluators ignore the G4 facts, and their snapshots do not include them. The 422 shape is unchanged too (ADR-0021 §7, "The refusal shape").
    - **`workflows/workflows.test.ts` (BE-A):** "one evaluator per seeded criterion" now expects the 16 G1–G3 keys plus the eight `g4.*` keys. This follows directly from registering the G4 evaluators.
    - **`portfolio/repository.ts` (BE-B):** in addition to the single presenter call that item 13 names, it adds the optional `precomputedFlags` parameter of `presentInitiatives` (so the prioritization view keeps its injected flag sources) and the helper `assertInitiativeEditable()`.
    - **The item-13 and item-14 work, done by BE-E as those items assigned:** the presenter consolidation in `portfolio/roadmap.ts` and `portfolio/prioritization.ts`; the closed-initiative guard lines in `portfolio/scores.ts` (BE-D) and in `portfolio/deliverables.ts` and `milestones.ts` (BE-C). Item 14's open point is therefore **closed**: scores, deliverables and milestones on a cancelled or completed initiative answer 422 `initiative.read_only`.
    - **`platform/db-errors.ts` and `.test.ts`:** the `initiative_contribution_kpi_matches_outcome` → `/outcomeKpiId` mapping and its case (BE-B handback §7 item 1).
    - **`contract.test.ts`:** only the two pinned counts, `[150, 149, 1]` and `>= 270`. The orchestrator owns them. T-DG3-ARCH-04 changes neither: `BenefitCalculation.rounding` and `FormulaRounding` are additive schema changes, and no operation is added.

    Later edits to these files by other tasks are only those named in this file.
17. **BE-E's interpretations are recorded in the ADRs.** The deselect rule, `g4.initiative_card_incomplete`, the G4 roadmap reading and Unknown capacity as a G4 conflict are in ADR-0021 §11. Commit authority, the new codes and texts, the cycle-path order, the approve-date reason and the read-only board are in ADR-0023 §9. The G4 422 shape (one entry per incomplete criterion, with the per-item list in the gate view) is in ADR-0021 §7.
18. **The rounding record is on the lineage row.** Migration `0027_p3_calculation_rounding.sql` (solution-architect) adds `benefit_calculation.rounding`, and `kpi/calculations.ts` writes and returns it (ADR-0024 §6 item 11, §10). There is no backfill: pre-0027 rows keep NULL and return `rounding: null`. This touched KBE-C's `kpi/calculations.ts` and its integration test `test/integration/kpi/benefit-formulas.test.ts`.
19. **Shared roadmap, T08 and capacity mirrors** (FE-B handback §4.2, FE-A §5.4): `packages/shared/src/schemas/roadmap.ts`, exported by `@mth/shared/schemas`.
    - The response mirrors moved out of BE-C's `portfolio/waves.ts`, `workflows/t08-dependencies.ts` and `workflows/dependency-types.ts`, and BE-E's `portfolio/capacity.ts` and `resource-demands.ts`. Those files re-export them under the old names and keep their request schemas.
    - `p3-exercises-be-c.ts` uses the shared `roadmapView` instead of its local copy.
    - **FE-E and later web tasks import from there.** The web's hand-typed views (`pages/{roadmap,dependencies,capacity}/api.ts`, the `RoadmapWave` interface in `api/types.ts`) are not changed by T-DG3-ARCH-04 (D-004: FE-E owns `apps/web/**`). They switch in a web task.
20. **Unpaged lists refuse `limit`** (FE-A §5.3; ADR-0021 §11 item 6). This is the contract's intent, and `test/integration/portfolio/unpaged-lists.test.ts` pins it. `fetchAllPages` is for `*Page` operations only.
21. **FE seam notes, as built:**
    - **Problem translations** (FE-A §5.2, FE-B §4.3, FE-C §4.2) live in per-page namespaces, with a fallback to `problems.*`. Moving them into `problems.json`, or giving `RecordDialog`/`ReasonDialog` a message hook, is web-internal and is the web tasks' choice. The API codes are fixed by the ADR tables.
    - **The lineage override marker** (FE-C §4.3) is now documented in the contract (ADR-0024 §10).
    - **There is no single-line business-case GET** (FE-C §4.4), by intent (ADR-0024 §10).
    - **The anticipated BE-E audit action names** (FE-A §5.5) match what BE-E writes: `funding_decision.create` (with `decision.create`), `resource_role.create`, `.update` and `.archive`, `capacity.create`, `.update` and `.archive`, and `resource_demand.create`, `.update`, `.archive`, `.commit` and `.release`. FE-E owns their labels.

### Amendments in wave 6 (T-DG3-BE-F, 2026-10-08)

22. **G4 lists an Unknown schedule (D-079).** `g4.roadmap` adds `g4.schedule_unknown` → 'Schedule unknown: {dependency code}' (pointer `/dependencies/{id}`) for each unresolved dependency into an in-scope initiative with the T08 flag `schedule.unknown` and a blank mitigation; a mitigation or the missing dates clear it (ADR-0021 §7, §11 item 3). ADR-0023 §1 is corrected to the built wave model: no label overrides in P3.
