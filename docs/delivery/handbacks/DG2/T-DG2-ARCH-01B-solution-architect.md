# Handback: T-DG2-ARCH-01B, solution-architect (P2 architecture, continuation of T-DG2-ARCH-01)

- **Stage:** P2 / DG2 (BUILDING). Branch `claude/mobily-transformation-platform-regate`.
- **Base:** `HEAD` = `7b20e0915d6eecf1320bd0d64265f089779a92bf`. The workspace was verified with `git rev-parse HEAD` and `git status` before writing; only additive P2 WIP was present.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-ARCH-01B-solution-architect-20261002T003208Z-13e50500","session_id":"13e50500-e96d-4bb8-ab85-c81ba6184a7e"}`.
- **Assignment:** `docs/delivery/assignments/DG2/T-DG2-ARCH-01B.md` (sha256 `d8ae40fd…ca65`, verified), with the scope of `T-DG2-ARCH-01.md`.
- **Role note:** I am an engineering agent. Nothing here grants a business, Finance or IT approval. Product gates G1–G6 are kept separate from engineering gates DG0–DG7 throughout.

## 1. Changed files

### Verified and kept (salvaged WIP, D-059)

| File | Purpose | Change in this run |
|---|---|---|
| `packages/db/migrations/0010`–`0017_*.sql` | P2 guards, methodology catalogue + seeds, evidence, direction/charter, kpi/baseline/value pool, diagnose, design/TOM, decisions/gates | **None.** Verified sound by a fresh-DB apply and guard probes (§3). |
| `packages/db/migrations/0018_p2_access_instantiation.sql` | P2 permissions, role defaults, accountabilities, `p2_instantiate_transformation()` + backfill | **One fix in place (WIP, not yet gated):** `decision.decide` category `business_approval` → `write` (owner-only), with clarified EN/AR descriptions. Reason in §4.1. |
| `packages/db/src/pool.ts` | `date` (OID 1082) parser | None. Verified correct. |

### Authored or updated in this run

| File | Purpose |
|---|---|
| `packages/db/src/schema.ts` | Kysely types and `SCHEMA_COLUMNS` for all **42** P2 tables, generated from the migrated catalogue. Adds `JsonDefault` and Row aliases. P1 part unchanged except the header comment. |
| `packages/shared/src/permissions.ts` | `P1_PERMISSIONS`, `P2_PERMISSIONS` (22), `P2_ROLE_PERMISSIONS`, merged into `PERMISSIONS`/`ROLES`. Exactly equal to 0005 + 0018. |
| `packages/db/src/seed.test.ts` | 0005 = P1 part; 0018 = P2 part; AUD holds only `read` permissions. Robust statement-end parsing. |
| `packages/db/test/integration/catalogue.test.ts` | Expected `version` tables and `mth_app` grants extended with the P2 tables (generated from the live catalogue). |
| `apps/api/test/integration/identity.test.ts` | TO's effective permissions = P1 + P2 defaults. |
| `apps/api/test/integration/contract/contract.test.ts` | Excludes only the explicitly pending P2 operations from route coverage and exercise coverage, and fails if a pending operation is routed or exercised. Total 160 operations. Calls `exerciseKpiOperations`. |
| `apps/api/test/support/p2-pending.ts` (new) | BE-owned list of 104 pending P2 operations. It merges in the kpi list. |
| `apps/api/test/support/p2-pending-kpi.ts` (new) | KBE-owned list of 23 pending kpi operations. |
| `apps/api/test/integration/contract/kpi-exercises.ts` (new) | KBE-owned contract-exercise seam (no-op scaffold). |
| `packages/shared/src/schemas/kpi.ts` (new) + `schemas/index.ts` | KBE-owned zod-mirror stub, already exported, so the barrel needs no KBE edit. |
| `docs/api/openapi.yaml` | +127 P2 operations, +P2 schemas/parameters/tags, +22 response-only `PermissionCode` values, info version `1.1.0-p2`. **P1 paths block byte-identical** (checked; only `info.version`/`info.summary` lines changed). |
| `docs/architecture/adr/ADR-0015-decision-and-product-gate-model.md` (new) | One decision model; product-gate engine (required outputs per G1/G2/G3, versioned submissions, unverified-evidence rule, approver resolution, **403** non-approver/submitter, **409** superseded); separation from DG0–DG7 |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` (new) | Typed table per register (T01–T04, TOM canvas, heatmap, journeys) vs EAV; record guards; catalogue seeds; starter structure |
| `docs/architecture/adr/ADR-0017-charter-versioning-and-direction.md` (new) | Charter current row + immutable `charter_version` snapshots; North Star; outcomes; good outcome test; guardrails |
| `docs/architecture/adr/ADR-0018-evidence-repository-and-verification.md` (new) | Evidence kinds, content revisions, links, verification rule |
| `docs/architecture/adr/ADR-0019-value-pool-quantification-decimal-unknown.md` (new) | Decimal upside/downside or explicit `unquantified` (never 0); totals with an unquantified count; Unknown rule |
| `docs/architecture/adr/ADR-0020-role-catalogue-p2-authorization.md` (new) | P2 permission catalogue, role defaults, record-level rules, AUD write-deny, team-assignment path |
| `docs/architecture/erd.md` | New §1b P2 physical ERD (6 mermaid diagrams + entity register) matching 0010–0018; conceptual rows updated (**P2**) |
| `docs/architecture/data-dictionary.md` | New "P2 tables" section: all 42 tables with columns, constraints, indexes, triggers, grants, module, writer and lifecycle. Generated from the migrated catalogue. |
| `docs/architecture/p2-work-split.md` (new) | File ownership for BE/KBE/FE, frozen files, seams, the KBE public interface, integration order, requirement → owner |
| `docs/architecture/README.md` | Index of the new documents |
| `docs/analysis/permissions-matrix.md` | New §8: role catalogue (14 codes), P2 permission catalogue, per-entity C/E/V/D rights incl. the AUD write-deny |
| `docs/delivery/handbacks/DG2/T-DG2-ARCH-01B-evidence/*` | Probe scripts and SQL, plus the real outputs of every check below |

## 2. Behaviour delivered (per requirement; architecture and data layer only, no routes)

| Requirement(s) | What this run delivers |
|---|---|
| REQ-S16-013 | Tables, PK, owner role, status and `version` for DiagnosticFinding, Baseline, Evidence, ValuePool, Outcome and StrategicGuardrail; ERD, data dictionary and OpenAPI create/read operations. **The API integration test (create+read with authorization) is the implementers' work.** |
| REQ-PB-026, REQ-PB-034, REQ-PB-039, REQ-PB-043 | Source-faithful columns. The database enforces: T01 confidence H/M/L + six seeded rows; T02 target date NOT NULL; T03 dimension NOT NULL + FK to T04; T04 codes D-nn, default `open`, options A/B/C. Probes P10–P12 show the enforcement. |
| REQ-PB-029, REQ-PB-030, REQ-PB-031 | Charter with the 14 fields, the thesis, the 5 scope checks and versioned snapshots. Proven: a snapshot is required (P6/P7), snapshots are immutable (P8), invalid dates are rejected (P9). |
| REQ-PB-033, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-027, REQ-PB-028, REQ-PB-041, REQ-PB-042 | Modelled and seeded (6 dimensions, 6 workstreams, 10 TOM dimensions, 5 scope checks, 5 good-outcome criteria). Unquantified value pools carry no amount (P1/P5). |
| REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-DLV-034, REQ-S13-012 | Gate engine model and contract. Criteria seeded (16). A filename is never verified (P15). The submitter cannot decide (P13 → 403). A stale submission is refused (P14 → 409). |
| REQ-S10-001, REQ-PB-012 | 14 role codes with P2 defaults; AUD read-only (asserted); accountabilities seeded; matrix §8 |
| REQ-S12-004 (P2 increment) | `p2_instantiate_transformation()`: 23 rows per transformation, idempotent, audited; backfill proven |

## 3. Checks actually run

**Environment:**
- Linux sandbox; Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`); pnpm 10.33.0; offline.
- PostgreSQL **16.13** disposable clusters via `tests/qa/support/with-pg.sh` with unique `QA_PG_PORT`s (55471–55480).
- All evidence is under `docs/delivery/handbacks/DG2/T-DG2-ARCH-01B-evidence/`.

| # | Command | Result |
|---|---|---|
| 1 | `QA_PG_PORT=55478 tests/qa/support/with-pg.sh <evidence>/migration-apply-and-guard-probe.sh` (final run, after the 0018 fix) | exit 0. `mth-db migrate` applied **18 migrations on an empty DB** (`migrate exit=0`). Seeds: `diagnostic_dimension=6 diagnostic_workstream=6 tom_dimension=10 gate_definition=6 gate_criterion_definition=16 scope_checks=5 good_outcome=5 permissions=38 role_permission=126`. Backfill path (0001–0009 + a pre-P2 transformation, then `mth-db migrate`): `applied 9 migration(s)`, `pins=1 t01_rows=6 tom_cells=10 gate_instances=6 audit_events(system,migration)=23`. Instantiation: `created 23 rows`, re-run `created 0 rows`. |
| 2 | Guard probes (same run, as `mth_app`; output excerpt below) | Every guard fired as expected. 19 expected ERRORs, 0 unexpected. |
| 3 | `pnpm install --frozen-lockfile --offline` | exit 0 ("Already up to date") |
| 4 | `pnpm -r typecheck` | exit 0 (all 7 packages) |
| 5 | `pnpm -r build` | exit 0 |
| 6 | `pnpm openapi:lint` | exit 0: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 160 operations` |
| 7 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0: `PASS gate DG1 (historical)` |
| 8 | `pnpm lint` | exit 0 |
| 9 | Prettier over all tracked + new readable files (`xargs npx prettier --check --ignore-unknown`) | exit 0: "All matched files use Prettier code style!" `pnpm format:check` itself exits 2 only because the sandbox's unreadable placeholder files at the repo root (`.bashrc`, `.vscode`, `CLAUDE.local.md`, …; EACCES) are not mine and not in git. |
| 10 | `pnpm test` (unit-node + unit-web) | exit 0: **329/329** passed, 21 files (incl. `seed.test.ts` 7/7) |
| 11 | `QA_PG_PORT=55479 tests/qa/support/with-pg.sh pnpm test:integration` (in tree) | 207/210 passed. The 3 failures are all in `packages/db/test/integration/migrate.test.ts` (`copyMigrations`): `Error: Recursive option not enabled, cannot copy a directory: …/packages/db/migrations/.claude/`. That is an environmental stray directory (§5.1). |
| 12 | Same suite in a fresh copy of this working tree without that stray directory (`QA_PG_PORT=55480`) | exit 0: **210/210 passed, 20 files** |

**Guard probe output** (excerpt from `migration-apply-and-guard-probe.out`):

```
-- P2: INSERT a value_pool WITHOUT an audit event -> must FAIL at COMMIT (audit_required)
 insert accepted inside the transaction (check deferred to COMMIT)
ERROR:  no audit_event for value_pool 01920000-2000-7000-8000-000000000002 at version 1 (ADR-0004: ...)
 value_pool rows after failed commit: 1
-- P3: UPDATE with version not stepping by 1 -> must FAIL (version_step)
ERROR:  value_pool: version must increase by exactly 1 on every update (optimistic concurrency, ADR-0003)
-- P3b: UPDATE keeping the same version -> must FAIL (version_step)
ERROR:  value_pool: version must increase by exactly 1 on every update (optimistic concurrency, ADR-0003)
-- P4: UPDATE stepping by 1 but without audit event -> must FAIL at COMMIT
ERROR:  no audit_event for value_pool 01920000-2000-7000-8000-000000000001 at version 2 (...)
-- P6: charter INSERT with audit event but WITHOUT a charter_version snapshot -> must FAIL at COMMIT
ERROR:  charter 01920000-2000-7000-8000-000000000010 version 1 has no charter_version snapshot
-- P13: gate decision by the SUBMITTER -> must FAIL (gate_decision_not_submitter, maps to 403)
ERROR:  gate submission 01920000-2000-7000-8000-000000000040: the submitter cannot decide it (separation of duties)
-- P14: gate decision on a stale submission_no -> must FAIL (gate_decision_current_submission, maps to 409)
ERROR:  gate submission 01920000-2000-7000-8000-000000000040 (no 1) is not the current pending submission
=== append-only trigger as the OWNER (privileges bypassed) ===
ERROR:  charter_version is append-only: UPDATE is not allowed
ERROR:  charter_version is append-only: DELETE is not allowed
```

P1 (with audit → commits; unquantified pool has `upside NULL`), P5, P7–P12 and P15–P17 are in the same file.

## 4. Fixes and decisions taken in this run

1. **0018 `decision.decide` reclassified to `write` (owner-only).** With `business_approval`, TL and WL became approval-holding roles. The DG1-approved F-DG1-106 rule (`grantCreatorTransformationRoles` never derives a creator assignment from a role with an approval permission) then stopped deriving TL's transformation assignment, and a BU-scoped TL got **404 on a transformation it had just created**. I observed this in the integration suite (7 failures in `access-scope.test.ts` and `access-derived-race.test.ts`). The fix keeps the DG1 invariant and code untouched. The decision owner's choice is record-level and is not a G1–G6 or Finance approval. Documented in ADR-0015 §1 and ADR-0020.
2. **Migrations otherwise sound.** No other migration edit was needed. Everything applied cleanly and every guard fired.
3. **`schema.ts` had not been updated** by the interrupted run. It now covers all 42 tables. Without the shared-catalogue updates the P1 integration suite went red (catalogue, `/me`, admin and contract tests), and it is green now.

## 5. Known gaps and items for the orchestrator (stated plainly)

1. **Environmental:** `packages/db/migrations/.claude/.cc-writes/` (empty directory, created 00:26 by the interrupted run's harness, not in git) breaks `migrate.test.ts`'s `copyMigrations` in this working tree. `.claude/**` is protected for me, so I did not remove it. It should be deleted by the orchestrator. In a clean copy the suite is 210/210.
2. **Deviation from the literal register path `/api/v1/scoped-assignments`.** P1 already exposes the canonical scoped-assignment resource as `/api/v1/role-assignments` (DG1-approved, byte-stable). I did not add a duplicate top-level resource. Team assignment is `GET/POST /api/v1/transformations/{transformationId}/scoped-assignments` (ADR-0020 §6). Please confirm or direct otherwise.
3. **Contract change against the DG1 contract (additive):** 22 new values in the response-only `PermissionCode` enum, plus `info.version`/`summary`. The contract's own versioning rule allows this within v1. No P1 path or request schema changed. I'm flagging it because the gate rule asks for breaking changes to be raised; I assess this one as non-breaking.
4. **Contract-test pending lists:** 127 P2 operations are declared but not routed. They are listed in `p2-pending.ts` (BE) and `p2-pending-kpi.ts` (KBE). The contract test stays green only through this explicit, shrinking allowance. **Both lists must be empty at DG2 freeze.**
5. **Not modelled in 0010–0018** (P2 *increments* of rows that complete later; work split §8):
   - waivers / authorized exceptions (REQ-S04-012/013);
   - record comments (REQ-S05-001);
   - per-criterion reviewer/finding (REQ-S04-009);
   - approver notification / My Work routing (REQ-S12-009; only the `gate.submitted` outbox hook is designed).

   The orchestrator decides whether the P2 slice needs them. If it does: BE `0019+` migration + an architect contract amendment.
6. **Not done by design (implementer scope):**
   - no API routes, zod mirrors for P2 bodies (except the kpi stub), UI or worker code;
   - the REQ-S16-013 create+read integration test;
   - the generated AUD write-deny test.
7. **Arabic seed text** (catalogue labels, accountabilities, permission descriptions) is a **provisional translation** and needs linguistic review. `#0078FF` remains provisional. Nothing claims PMI certification or Mobily approval.
8. **No new dependency** was added, so there was no version or licence re-verification to do. decimal.js 10.6.0 keeps its existing ADR-0003 [UNVERIFIED] support flag.

## 6. P2 work split summary (`docs/architecture/p2-work-split.md`)

- **backend-workflow-engineer:**
  - API modules: `transformations` (charter, North Star, guardrails, outcomes, T01, findings, workstream outputs, T03, heatmap, journeys, instantiation on create), `workflows` (decisions/T04, workshops, actions, dependencies, TOM canvas read model, gates G1–G3 + evaluators), new `evidence` and `methodology`, `access` (accountabilities, team assignments), `platform` (DB-guard problem mapping);
  - also `modules.ts`/`server.ts`/`architecture.test.ts`, `apps/worker/**`, `packages/db/**` (migrations **0019+ only**, `dev-seed.ts`), the P2 zod mirrors except kpi, `contract.test.ts` + `p2-pending.ts`.
  - Its **first change** (module registry incl. `workflows → kpi, evidence`, new module skeletons, problem mapping) lands before the others integrate.
- **kpi-benefits-engineer:**
  - `apps/api/src/modules/kpi/**` (kpi-definitions, baselines + FIN validation, outcome-kpis/T02 + trajectory approval, value pools + FIN validation);
  - `apps/api/test/integration/kpi/**`, `kpi-exercises.ts`, `p2-pending-kpi.ts`, `packages/shared/src/schemas/kpi.ts`;
  - new `packages/shared/src/value.ts` (decimal helpers, unquantified-aware totals);
  - exports `loadKpiGateFacts()` for the G1/G2 evaluators.
- **frontend-ux-engineer:** `apps/web/**` only. Bilingual Diagnose / Charter / Define / Design / Decisions / Gates / Evidence screens against the contract. Unknown, never 0. Unquantified labelled. AUD read-only affordances.
- **Frozen (architect, via orchestrator):** `openapi.yaml`, `docs/architecture/**`, permissions matrix, migrations 0010–0018, `permissions.ts`, root config, dependencies and lockfile.
- **Off-limits to all:** `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, reviews and gate records.
- **Integration order:** BE first change → (KBE ∥ BE ∥ FE) → KBE merge → BE gates/decisions/evidence → FE live wiring → full checks with both pending lists empty.

## 7. Merge instructions

- Commit the files in §1 together. They depend on each other: `permissions.ts` ⇄ 0018 ⇄ `seed.test.ts`/`identity.test.ts`; `openapi.yaml` ⇄ `contract.test.ts` + pending lists; `schema.ts` ⇄ `catalogue.test.ts`.
- Remove `packages/db/migrations/.claude/` (§5.1) before running `migrate.test.ts` in the integration tree.
- Migrations: `mth-db migrate` applies 0010–0018 in order on fresh and existing databases. No manual step; the backfill is inside 0018.
- After this commit, migrations 0010–0018 must not be edited by implementers. Changes go in `0019+` (BE).
- Expected conflicts: none. No other agent is active on these files.
