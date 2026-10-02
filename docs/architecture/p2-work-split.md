# P2 work split: file ownership, contracts and integration order

- **Task:** T-DG2-ARCH-01 / 01B (solution-architect), 2026-10-02. **Stage:** P2 "Diagnose, define and design" (DG2).
- **Scope:** the three parallel P2 implementation tasks:
  - **backend-workflow-engineer (BE)**;
  - **kpi-benefits-engineer (KBE)**;
  - **frontend-ux-engineer (FE)**.

  qa-verifier writes acceptance tests in its own areas (`tests/qa/**`, `e2e/**`).
- **Rule:** two agents never edit the same file (REQ-DLV-008). Anything not listed under an owner below is **frozen**, and changes go through the orchestrator.
- **Off-limits to every implementer** (the write guard enforces it): `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, `docs/delivery/reviews/**`, `docs/delivery/gates/**`, `docs/delivery/stages.json`, `docs/delivery/findings.json`, `docs/delivery/candidates/**`, `docs/delivery/runs/**`, `docs/delivery/test-evidence/**`, `CLAUDE.md`, `trading_agent/**`.
- **Product gates G1–G6 are business approvals inside the product.** Nothing in P2 reads or writes the engineering gate records DG0–DG7.

## 0. Already delivered by the architect (the shared foundation; do not re-create)

| Artifact | Path | Status |
|---|---|---|
| P2 migrations: guards, catalogue + seeds, evidence, charter/direction, kpi/baseline/value pool, diagnose, design/TOM, decisions/gates, access/instantiation | `packages/db/migrations/0010`–`0018` | Applied 0001→0018 on a fresh PostgreSQL 16.13 and over a populated P1 database; guards proven (handback evidence). **Frozen**: later changes are new migrations `0019+`. |
| Kysely types for all 42 P2 tables | `packages/db/src/schema.ts` | Matches the migrated catalogue (`catalogue.test.ts`) |
| `date` parser (OID 1082 → `YYYY-MM-DD`) | `packages/db/src/pool.ts` | Done |
| P2 permission catalogue and role defaults | `packages/shared/src/permissions.ts` (`P2_PERMISSIONS`, `P2_ROLE_PERMISSIONS`) | Equals 0018 (`seed.test.ts`) |
| Contract: 127 P2 operations, 33 P1 operations unchanged | `docs/api/openapi.yaml` | `pnpm openapi:lint` PASS (160 operations) |
| ADRs | `docs/architecture/adr/ADR-0015`…`ADR-0020` | Decision/gates, registers/guards, charter, evidence, decimal/unquantified, roles |
| ERD + data dictionary | `docs/architecture/erd.md` §1b, `data-dictionary.md` § "P2 tables" | Generated from the migrated catalogue |
| Permissions matrix §8 | `docs/analysis/permissions-matrix.md` | P2 role and entity rights |
| Contract-test seams | `apps/api/test/support/p2-pending.ts`, `p2-pending-kpi.ts`, `apps/api/test/integration/contract/kpi-exercises.ts`; `packages/shared/src/schemas/kpi.ts` (stub, already exported) | See §5 |

## 1. Frozen shared files (owner: solution-architect; changes only via the orchestrator)

| Path | Why frozen |
|---|---|
| `docs/api/openapi.yaml` | The API contract (ADR-0007). A needed change is raised in the handback; the architect amends it. |
| `docs/architecture/**`, `docs/analysis/permissions-matrix.md` | Architecture and access decisions |
| `packages/db/migrations/0010`–`0018` | P2 schema foundation (forward-only once DG2 approves; until then only the architect edits them) |
| `packages/shared/src/permissions.ts`, `constants.ts`, `problem.ts`, `index.ts` | Consumed by db, api, worker and web |
| Root build configuration (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `playwright.config.ts`), `scripts/**` | Shared build and checks |
| `dependencies` / `devDependencies` of every `package.json` and `pnpm-lock.yaml` | One lockfile. **No new dependency is needed for P2.** decimal.js, zod, kysely, React Hook Form, TanStack Query/Table and i18next are already pinned. A request goes in the handback. |

## 2. backend-workflow-engineer (BE)

**Owns (writes):**
- `apps/api/src/modules/transformations/**`, `workflows/**`, `access/**`, `platform/**`, `audit/**`, `identity/**`, `organization/**`, `jobs/**`, `admin/**`.
- New modules `apps/api/src/modules/evidence/**` and `apps/api/src/modules/methodology/**`.
- `apps/api/src/modules.ts`, `apps/api/src/server.ts`, `apps/api/src/architecture.test.ts`, `apps/api/src/architecture.testkit.ts`, `apps/api/src/index.ts`, `apps/api/src/main.ts`.
- `apps/api/test/**`, **except** the KBE paths in §3. This includes `test/integration/contract/contract.test.ts`, `test/support/p2-pending.ts`, `test/support/harness.ts` and `test/support/contract.ts`.
- `apps/worker/**`.
- `packages/db/**` except the frozen 0010–0018. That covers **new migrations `0019+`** (BE is the only migration writer; KBE and FE request schema changes through BE), `schema.ts` entries for 0019+, `dev-seed.ts` (synthetic P2 demo data, marked synthetic), `test/**`, `src/**` and the `scripts` field of `packages/db/package.json`.
- New zod mirrors in `packages/shared/src/schemas/{methodology,charter,direction,diagnose,design,decision,gate,evidence,team}.ts`, plus `packages/shared/src/schemas/index.ts` (the barrel; `kpi.ts` is already exported).

**Resources (OpenAPI operationIds) and their module:**

| Module | Resources |
|---|---|
| `transformations` | `charter` (+ `/charter/versions`), `north-star` (+ `/history`), `strategic-guardrails`, `outcomes`, `diagnostic-items`, `diagnostic-findings`, `workstream-outputs`, `tom-gaps`, `capability-heatmap`, `journeys` (+ `pain-points`); `POST /transformations` calls `p2_instantiate_transformation()` in its transaction (ADR-0016 §4) |
| `workflows` | `/decisions` (+ `options`, `decide`), `tom-workshops` (+ `participants`, `items`, `convert`), `actions`, `dependencies`, `tom-canvas` (the aggregated read model + cell PATCH), `gates` (list, get, configure, submissions, decision), all G1–G3 criterion evaluators |
| `evidence` (new) | `evidence` (+ `content` upload/download, `review`), `evidence-links` |
| `methodology` (new) | `GET /transformations/{id}/methodology`, `PATCH /methodology/tom-dimensions/{dimensionCode}` |
| `access` | `GET /role-accountabilities`, `GET`/`POST /transformations/{id}/scoped-assignments`; record-level rule helpers of ADR-0020 §3 |
| `platform` | Problem mapping of the P2 database guard errors (ADR-0016 §3, ADR-0015): `*_version_step` → 409 version-conflict; `gate_decision_not_submitter` → 403 `gate.submitter_cannot_decide`; `gate_decision_current_submission` → 409 `gate.submission_superseded`; template CHECK/NOT NULL violations → 400/422 with field pointers; `*_audit_required` → 500 (programming error) |

**First change (lands before KBE/FE integrate; small):**
- In `modules.ts`:
  - add `methodology` and `evidence` to the P1/P2 module lists (and the directories with `index.ts` and their own `*.test.ts`);
  - `workflows.dependsOn += ["kpi", "evidence"]`;
  - `transformations` stays free of `workflows` (no cycle).
- Update `architecture.test.ts` accordingly.
- Add the platform problem mapping.

## 3. kpi-benefits-engineer (KBE)

**Owns (writes):**
- `apps/api/src/modules/kpi/**`: routes, services, repository, the module's public interface `index.ts`, and its tests (`kpi.test.ts` etc.).
- `apps/api/test/integration/kpi/**`: KBE's integration tests for kpi resources, incl. AUD 403 on every kpi mutation.
- `apps/api/test/integration/contract/kpi-exercises.ts` (contract exercises of kpi operations, through `ctx.mirrored`) and `apps/api/test/support/p2-pending-kpi.ts` (remove each operation as it becomes routed and exercised).
- `packages/shared/src/schemas/kpi.ts`: zod mirrors of `KpiDefinition*`, `Baseline*`, `OutcomeKpi*`, `ValuePool*`, `ValidationDecision`, `TrajectoryApproval`, `TrajectoryPoint`, `Decimal`, `BusinessDate`.
- New `packages/shared/src/value.ts` (+ `value.test.ts`): decimal helpers (parse/format/compare at a column scale, never a float) and the value-pool total `{ quantifiedTotal: { downside, upside } | null, unquantifiedCount, currency }` (ADR-0019 §5), used by the API and by FE.

**Resources:** `kpi-definitions`, `baselines` (+ `validation`, FIN), `outcome-kpis` (+ `trajectory-approval`, SP/BO), `value-pools` (+ `validation`, FIN).

**Public interface for the gate criteria** (exported from `apps/api/src/modules/kpi/index.ts`; consumed by BE's `workflows` evaluators):

```ts
export interface KpiGateFacts {
  baselines: { id: string; hasValue: boolean; hasSource: boolean; hasDate: boolean; validationStatus: string; status: string }[];
  valuePools: { id: string; quantificationStatus: "quantified" | "unquantified"; materiality: string; status: string }[];
  outcomeKpis: { id: string; outcomeId: string; kpiDefinitionId: string; hasTarget: boolean; targetDate: string; trajectoryStatus: string; status: string }[];
  kpiDefinitions: { id: string; status: string; hasUnit: boolean; polarity: string; ownerUserId: string | null }[];
}
export function loadKpiGateFacts(db: DbOrTx, transformationId: string): Promise<KpiGateFacts>;
```

**Must not touch:**
- `modules.ts` and `server.ts`. The `registerKpiModule` hook is already wired; register routes inside it.
- `contract.test.ts`, `p2-pending.ts`, migrations, `schema.ts`.
- Any `apps/web/**`.

## 4. frontend-ux-engineer (FE)

**Owns (writes):** `apps/web/**` except `package.json` dependencies:
- new pages under `apps/web/src/pages/{diagnose,define,design,decisions,gates,evidence}/**`;
- `app/router.tsx`, `app/nav.ts`;
- `api/client.ts`, `api/queries.ts`, `api/types.ts`;
- `components/**`, `lib/**`;
- new i18n namespaces `i18n/{en,ar}/{diagnose,define,design,decisions,gates,evidence,kpi}.json` (and edits to existing ones);
- the web tests.

**Screens (bilingual AR-RTL / EN-LTR, every string through i18next):**

| Screen | What it shows |
|---|---|
| Diagnose | T01 grid of the 6 seeded dimensions with Confidence H/M/L and Impact SAR or KPI; findings by the six workstreams with their key questions; baselines; value pools (amounts through `@mth/shared` `value.ts`; **"unquantified" label, never 0**; totals "partial: N unquantified") |
| Charter | 14 fields, thesis, the five scope checks with pre-checks, version history and diff, the 3–5 top outcomes warning |
| Define | North Star (one sentence), outcome tree, T02 KPI tree (target date required), guardrails |
| Design | TOM canvas (10 boxes), T03 gap matrix linked to T04, capability heatmap (build/buy/partner), journeys/processes with steps and pain points, workshop mode (convert unresolved items) |
| Decisions | T04 log via `GET /decisions?kind=design` (IDs D-01…, options A/B/C, status default Open) |
| Gates | G1–G3 readiness per criterion with evidence state (unverified shown as such), submit, approver decision with rationale, 403/409 problem messages. Visibly labelled "business approval"; never mentions DG0–DG7. |
| Evidence | Upload, link, review |

Missing or stale data shows Unknown/Stale, never zero or green. AUD sees read-only views (no enabled write controls). The server still returns 403. `#0078FF` stays provisional, with no official Mobily logo.

**Consumes:** `docs/api/openapi.yaml` (P2 schemas), `@mth/shared/schemas` (BE and KBE mirrors), `@mth/shared` `value.ts` (KBE) and `PERMISSIONS` (for UI affordances only; never as security).

**Must not touch:** `apps/api/**`, `apps/worker/**`, `packages/**`, `docs/**`.

## 5. Contract-test seams (no shared-file writes)

`apps/api/test/integration/contract/contract.test.ts` (BE) requires every OpenAPI operation to be routed and exercised:

- P2 operations without a route are listed in `test/support/p2-pending.ts` (BE, 104 operations) and `test/support/p2-pending-kpi.ts` (KBE, 23 operations).
- The test fails if a listed operation is already routed or exercised, so the lists only shrink.
- KBE exercises kpi operations in `kpi-exercises.ts`, which `contract.test.ts` already calls (`exerciseKpiOperations`).
- **Both lists must be empty when the DG2 candidate freezes.** qa-verifier checks this.

## 6. Integration order

1. **BE "first change"** (§2) is merged first: module registry, the `evidence`/`methodology` skeletons, problem mapping, instantiation on create.
2. **In parallel, after step 1:**
   - KBE builds the kpi module and `value.ts`;
   - BE builds the transformations/workflows/evidence/methodology resources;
   - FE builds screens against the contract (with stubbed responses in web unit tests).
3. **KBE merges** the kpi routes and `loadKpiGateFacts`. BE then completes the G1/G2 criterion evaluators that consume it.
4. **BE merges** gates, decisions and evidence.
5. **FE wires the screens** to the live API (merges last).
6. **Integration checks (orchestrator):**
   - `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r build && pnpm lint && pnpm format:check && pnpm openapi:lint`;
   - `pnpm test`;
   - `tests/qa/support/with-pg.sh pnpm test:integration` (both pending lists empty);
   - e2e;
   - `node tools/gates/validate.mjs --stage DG2`.

**Expected merge conflicts:** none by construction. The only cross-owner touch points are the seams in §5 and the KBE public interface in §3, and each is a separate file with one owner.

## 7. Requirement → owner (the 32 rows with final gate DG2)

| Requirement(s) | Owner(s) |
|---|---|
| REQ-S16-013 (entity group: API create+read with authorization for DiagnosticFinding, Baseline, Evidence, ValuePool, Outcome, StrategicGuardrail) | BE (finding, evidence, outcome, guardrail), KBE (baseline, value pool) |
| REQ-PB-023 (workstreams), REQ-PB-024 (heatmap), REQ-PB-025 (journeys), REQ-PB-026 (T01), REQ-PB-038 (TOM seeds), REQ-PB-039 (T03), REQ-PB-041 (canvas), REQ-PB-042 (workshop mode), REQ-PB-043 (T04), REQ-S05-003 (per-dimension canvas view) | BE (API), FE (screens) |
| REQ-PB-027 (baselines), REQ-PB-028 (value pools), REQ-PB-034 (T02) | KBE (API + `value.ts`), FE (screens) |
| REQ-PB-029 (charter), REQ-PB-030 (thesis), REQ-PB-031 (scope checks), REQ-PB-033 (North Star), REQ-PB-035 (3–5 top outcomes), REQ-PB-036 (good outcome test), REQ-PB-037 (guardrails) | BE (API), FE (screens) |
| REQ-PB-016, REQ-PB-017, REQ-PB-018 (G1/G2/G3), REQ-S04-003, REQ-S04-004, REQ-S04-005 (phase procedures + gate decisions), REQ-DLV-034, REQ-S13-012 (unverified evidence; 403/409) | BE (API), FE (screens) |
| REQ-PB-003 (End-to-End / Modular when creating or entering a transformation: P1 API behaviour, P2 adds the verbatim mode guidance on the create screen and instantiation for both modes) | FE (guidance text), BE (instantiation) |
| REQ-PB-012 (six governance roles with source accountabilities, assigned per transformation) | BE (`role_accountability` read API, team assignments), FE (team screen) |
| REQ-S10-001 (roles; AUD write-deny on every P2 mutation) | BE (policy + generated AUD test over all P2 mutations), KBE (kpi part of that test), FE (read-only affordances) |

## 8. P2 increments of rows that complete at later gates

These rows have an increment in P2 (`docs/analysis/stage-plan.md` P2 section). The P2 architecture covers them as follows. Rows not listed are delivery-process rows (REQ-DLV-*, REQ-S20-* acceptance suites, REQ-S21-*), owned by the orchestrator and qa-verifier, or platform-wide rules every owner applies (REQ-S15-007, REQ-S15-011…013, REQ-S16-023, REQ-S16-025…027, REQ-S16-032, REQ-S19-019).

| Row(s) | P2 coverage in this architecture | Owner |
|---|---|---|
| REQ-PB-014, REQ-PB-015, REQ-S04-001, REQ-S04-002, REQ-S04-010, REQ-S10-014, REQ-S10-016, REQ-S10-017, REQ-S10-018, REQ-S12-010, REQ-S16-012 | Gate definitions/instances/submissions/decisions with all seven statuses, approval record (assignee basis, submission number, due date, rationale, comments, timestamp), SoD, staleness, four outcomes, phase advance on approval (ADR-0015) | BE, FE |
| REQ-PB-022, REQ-PB-007 | G1 criteria (diagnostic, baseline, root causes, value pools, charter) | BE |
| REQ-PB-032, REQ-S07-001 (P2 subset), REQ-S16-014 (P2 subset) | Outcome tree, T02, KPI dictionary subset | BE (outcomes), KBE (KPI) |
| REQ-S16-015, REQ-S16-018 (P2 subset), REQ-PB-040 | TOM tables; decision/action/dependency subset; TOM kept separate from any portfolio (no initiative tables in P2) | BE |
| REQ-S12-004 | `p2_instantiate_transformation()` (ADR-0016 §4) | BE |
| REQ-S13-010, REQ-S13-011, REQ-S13-013, REQ-S16-006 | Evidence repository, revisions, links, verification, download through the API with the parent's authorization (ADR-0018) | BE |
| REQ-S10-008 | Team assignments per transformation (named people) | BE, FE |
| REQ-S04-009 | Per-criterion completeness on each submission (`gate_submission_criterion`, `GateCriterionEvaluation`). **Per-criterion reviewer and finding are not modelled in P2.** | BE |
| REQ-S04-012, REQ-S04-013 | Submission is blocked when a mandatory criterion is incomplete. **The "authorized exception / waiver" path is NOT modelled in 0010–0018**: no `waiver` table and no operation. | Gap: the orchestrator decides whether the P2 slice needs it. If it does, BE adds a `0019+` migration and the architect amends the contract. |
| REQ-S05-001 | Version history (charter), drafts (status `draft`), attachments (evidence links), inline validation. **Comments on records are NOT modelled in P2.** | Gap: same rule as above |
| REQ-S12-009 | The submission resolves the approver and stores the exact snapshot. **Notification routing to the approver** (My Work, REQ-S03-008) has no P2 operation; the outbox event `gate.submitted` is the hook. | Gap: same rule as above |
| REQ-S03-011 | Header data are available from the P2 resources (North Star, gate readiness, owners); **no dedicated header endpoint** in P2 | FE composes it from existing operations |
| REQ-PB-002, REQ-S02-001, REQ-S02-004 | Methodology catalogue with source text verbatim and `source_ref` per seed row; `is_source_text` on role accountabilities | BE (methodology module), FE |
| REQ-PB-004, REQ-PB-005, REQ-S03-004, REQ-S03-005, REQ-PB-008, REQ-PB-010, REQ-PB-011, REQ-PB-044, REQ-PB-073, REQ-S03-001, REQ-S03-006…008, REQ-S03-010, REQ-S04-014, REQ-S05-006, REQ-S06-001…003, REQ-S15-010 | Not in the P2 architecture beyond what is listed above (later-stage records: initiatives, readiness, traceability view, procedures, search, change requests). No P2 table blocks them. | Later stages |
