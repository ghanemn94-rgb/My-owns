# P3 work split: file ownership, contracts and integration order

- **Task:** T-DG3-ARCH-01 (solution-architect), 2026-10-07. **Stage:** P3 "Mobilization and portfolio" (DG3).
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
| `packages/db/migrations/0001`–`0024` | Schema foundation, forward-only |
| `packages/shared/src/permissions.ts`, `constants.ts`, `problem.ts`, `value.ts` | Consumed by db, api, worker and web (`value.ts` is DG2-approved; KBE-A adds new files instead) |
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

**Resources:** `/initiatives` (CRUD, submit, withdraw, select, deselect, launch, cancel), `/initiatives/{id}/gap-links`, `outcome-contributions`, `decision-links`, `selections`. Launch reads funding through `portfolio/funding.ts`'s exported `latestFundingState()` (BE-E; BE-A's stub returns `unfunded` until BE-E lands).

### BE-C — roadmap, deliverables, milestones, T08 dependencies

**Owns:** `portfolio/waves.ts`, `portfolio/deliverables.ts`, `portfolio/milestones.ts`, `portfolio/roadmap.ts`, `portfolio/schedule.ts` (+ unit test: needed-by conflict, before-predecessor, unknown); `apps/api/src/modules/workflows/t08-dependencies.ts`, `workflows/dependency-types.ts`, `workflows/design-registers.ts` (only the DG2 dependency projection rule: non-DG2 type codes shown as `other`, 422 `dependency.managed_by_t08`); `test/integration/portfolio/roadmap.test.ts`, `test/integration/dependencies/t08.test.ts` (A→B→C→A and A→B→A named; two-connection race, exactly one commits; external From; unknown type; system type DELETE 422); `test/support/p3-pending-be-c.ts`; `test/integration/contract/p3-exercises-be-c.ts`.

**Resources:** `waves`, `roadmap`, `deliverables` (+ submit, acceptance), `milestones` (+ approve-date), `/dependencies` (T08), `/dependency-types`. The cycle check takes `pg_advisory_xact_lock(730221, hashtext(transformation_id))` (export `DEPENDENCY_GRAPH_LOCK_CLASS = 730221`) before its friendly BFS check, then writes; the DB guard re-checks.

### BE-D — prioritization

**Owns:** `portfolio/prioritization.ts`, `portfolio/scores.ts`, `portfolio/rankings.ts`, `portfolio/overrides.ts`; `test/integration/portfolio/prioritization.test.ts` (score 6 → 400; 95%/105% → 422 nothing written; v2 with risk_compliance 10 and strategic fit 15 accepted and approved by SP; v1 results keep v1; history shows 'weight version 2'; override without reason rejected; proposer cannot approve); `test/support/p3-pending-be-d.ts`; `test/integration/contract/p3-exercises-be-d.ts`.

**Consumes:** `@mth/shared` `scoring.ts` (KBE-A) for every calculation; never re-implements the arithmetic.

### BE-E — capacity, funding, G4 (lands last on the backend)

**Owns:** `portfolio/capacity.ts`, `portfolio/resource-demands.ts`, `portfolio/funding.ts`, `portfolio/gate-facts.ts` (the portfolio part of `GateFactsProvider`); `apps/api/src/modules/workflows/g4.ts` (the eight `g4.*` evaluators and the G4 snapshot builder, ADR-0021 §7) and `workflows/criteria.ts` (register the G4 evaluators in `EVALUATORS`); `packages/db/migrations/0026_p3_enable_g4.sql` (`UPDATE gate_definition SET submission_enabled = true … WHERE code = 'G4'`); the DG2 assertion in `apps/api/test/integration/gates.test.ts` that G4 is not submittable (change it to G5/G6 only) — coordinated: BE-A owns `gates.test.ts` until BE-A merges, BE-E edits it afterwards; `test/integration/portfolio/capacity.test.ts`, `funding.test.ts`, `test/integration/gates/g4.test.ts` (G4 submit 422 listing 'Owners', 'Finance validation', the initiative names, funding and capacity; decide 403 not approver, 403 submitter, 409 superseded; approved G4 → phase `transform`; G4 end-to-end with distinct synthetic TL/FIN/SP users); `test/support/p3-pending-be-e.ts`; `test/integration/contract/p3-exercises-be-e.ts`.

**Resources:** `resource-roles`, `/capacity`, `capacity-plan`, `/resource-demands` (+ commit, release), `/funding-decisions` (creates the canonical executive `decision` row and moves `selected → funded`), G4 through the existing gate paths.

## 3. kpi-benefits-engineer

### KBE-A — shared calculation code (lands first, in parallel with BE-A)

**Owns:** `packages/shared/src/scoring.ts` (+ `scoring.test.ts`: 5,4,3,2,1 → 3.3000/3.30; 0–100 of 3.30 → 57.5; 95/105 rejected; incomplete; property test over all 5^5 combinations), `packages/shared/src/formula/**` (`tokenize.ts`, `parse.ts`, `typecheck.ts`, `evaluate.ts`, `index.ts` and tests: grammar table, undefined variable, period mismatch monthly × annual, `to_period`, division by zero → Unknown, revenue example 100000 exact, cost example 500000 exact, limits), the export lines for both in `packages/shared/src/index.ts` (the only edit to that file), and the ESLint override block for `packages/shared/src/formula/**` in `eslint.config.js` (`no-eval`, `no-implied-eval`, `no-new-func`, `no-restricted-imports` vm/node:vm, `no-restricted-syntax` ImportExpression) — the only edit to that file.

### KBE-B — business cases

**Owns:** `apps/api/src/modules/kpi/business-cases.ts`, `kpi/business-case-lines.ts`, `kpi/totals.ts` (+ unit test: distinct lines once, roll-up by reference, gross/cost/net separate, Unknown never 0, per currency); `test/integration/kpi/business-cases.test.ts` (ten sections; two classes → 400; mismatch → 422; editing an initiative case changes the roll-up without duplication; FIN baseline validation, author 403; AUD 403); `packages/shared/src/schemas/business-case.ts`; `test/support/p3-pending-kbe-b.ts`; `test/integration/contract/p3-exercises-kbe-b.ts`.

### KBE-C — benefit formulas and the kpi G4 facts

**Owns:** `apps/api/src/modules/kpi/benefit-formulas.ts`, `kpi/formula-versions.ts`, `kpi/calculations.ts`, `kpi/p3-gate-facts.ts` (the `kpi` part of `GateFactsProvider`: business cases, section completeness, baseline validation state incl. Stale, formula version validation per benefit line); the export lines for these in `apps/api/src/modules/kpi/index.ts` and the route registration lines in `kpi/routes.ts` (KBE-B adds its own registration lines first; KBE-C merges after KBE-B, so the two edits are sequential, not concurrent); `test/integration/kpi/benefit-formulas.test.ts` (six T09 columns; confidence X → 400; undefined variable → 422; the two seeded examples; monthly ARPU × annual population → 422; lineage rows; FIN validation, author 403); `packages/shared/src/schemas/benefit-formula.ts`; `test/support/p3-pending-kbe-c.ts`; `test/integration/contract/p3-exercises-kbe-c.ts`.

**Must not touch (all KBE tasks):** `modules.ts`, `server.ts`, `contract.test.ts`, migrations, `schema.ts`, `apps/web/**`.

## 4. frontend-ux-engineer

Shared rules: every string through i18next in `ar` (RTL) and `en` (LTR); RecordForm and the hand-written-form blank rules (one form-level alert in one live region, axe-clean banners); session-bound actions through `apps/web/src/auth/sessionBound.ts` (ESLint forbids raw `navigate` and direct `setQueryData`); amounts, scores, weights and FTE formatted with `@mth/shared` (`formatDecimal`, `scoring.ts`), never `Number()`; Unknown/Stale shown as such, never 0 or green; AUD sees read-only views; `#0078FF` stays provisional; "business approval" labels on selection, funding, weight-set, override, dispensation and G4 actions, never DG0–DG7. Each FE task owns its own i18n namespaces and route files; `app/router.tsx`, `app/nav.ts`, `api/client.ts`, `api/queries.ts`, `api/types.ts` are owned by **FE-A**, which adds the routes, nav entries and query keys for all three FE tasks in its first change (query keys: `["roadmap", transformationId]` is the one cache entry the timeline, table and board share).

### FE-A — portfolio, readiness, G1 agreements, G4

**Owns:** `apps/web/src/pages/portfolio/**` (initiative list with 'Selected - unfunded', initiative card T05 with all 14 fields and the 3–7 deliverable warning, transitions with their 422 texts, gap links and contributions, selection), `pages/readiness/**`, `pages/dispensations/**`, the G1 agreements step in the existing gate decision dialog (`pages/gates/**`) and the G4 view; `app/router.tsx`, `app/nav.ts`, `api/**`; `i18n/{en,ar}/{portfolio,readiness}.json` and the G4/G1 keys in `i18n/{en,ar}/gates.json`; their tests.

### FE-B — prioritization, roadmap, dependencies, capacity

**Owns:** `pages/prioritization/**` (scorecard with read-only weighted score and 'incomplete', weight sets with the 100% check, ranked table, value/feasibility chart, 0–100 view with its label, ranking history with 'weight version N', overrides), `pages/roadmap/**` (timeline, initiative table and work board on the single `["roadmap", id]` entry; moving a milestone updates all three; 409 conflict banner), `pages/dependencies/**` (T08 map, cycle message, schedule flags, types admin), `pages/capacity/**` (role × month grid, conflict indicator, Unknown capacity); `i18n/{en,ar}/{prioritization,roadmap,dependencies,capacity}.json`; their tests.

### FE-C — business cases and T09

**Owns:** `pages/business-cases/**` (ten sections, lines with exactly one class, totals with gross/cost/net separate, roll-up, Finance validation state incl. Stale), `pages/benefit-formulas/**` (T09 register, formula builder using `@mth/shared` `formula` for live parse/type-check/preview, units and periods, fraction vs percentage points, examples marked illustrative, Finance validation); `i18n/{en,ar}/{business-cases,benefit-formulas}.json`; their tests.

**Must not touch (all FE tasks):** `apps/api/**`, `apps/worker/**`, `packages/**`, `docs/**`.

## 5. Contract-test seams (no shared-file writes)

- Every P3 operation is in exactly one `apps/api/test/support/p3-pending-<task>.ts` (BE-A 6, BE-B 20, BE-C 25, BE-D 17, BE-E 17, KBE-B 11, KBE-C 13 = 109). The aggregate `p3-pending.ts` feeds `P2_PENDING_OPERATIONS`, so route coverage, the exercised-operations check, the media-type sweep, the malformed-input sweeps and the rate-limit sweep skip unrouted operations, and the route-coverage test fails if a listed operation is routed or exercised.
- Each task exercises its operations in its own `test/integration/contract/p3-exercises-<task>.ts`; BE-A's first change wires all seven into `contract.test.ts`.
- Pinned counts that move as operations are routed (BE-A owns `contract.test.ts`; the other tasks report their new counts in the handback and BE-A or the integrator updates them): the media-type triple `[87, 86, 1]` (live operations with a body) and the rate-limit floor (`>= 161`).
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
