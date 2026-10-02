# Handback T-DG2-BE: P2 backend (backend-workflow-engineer)

- **Stage / gate:** P2 "Diagnose, define and design" / DG2 (BUILDING). Branch `claude/mobily-transformation-platform-regate`.
- **Assignment:** `docs/delivery/assignments/DG2/T-DG2-BE.md` (sha256 `5266b1d2…12a`, verified before starting).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-BE-backend-workflow-engineer-20261002T011050Z-8dd37162","session_id":"8dd37162-3fb8-4d69-8810-de2346bc957b"}`
- **Base revision:** `HEAD = 23933b5b08855c687e7d9a0436644f2050053f6d` (ef99eb0 + the two assignment files). Working tree shared with kpi-benefits-engineer (KBE), who worked concurrently; I did not edit any KBE file (see §6).
- **Status: COMPLETE for the assigned scope.** Every BE OpenAPI operation (104) is routed, implemented and exercised; `apps/api/test/support/p2-pending.ts` is **empty** (KBE's `p2-pending-kpi.ts` is empty too, so all 160 contract operations are routed and exercised). The known gaps in §4 are outside my write scope or explicitly deferred by the architecture; none is a hidden unfinished item.
- **Gate systems:** G1–G6 here are business approvals inside the product. Nothing I wrote reads or writes the engineering gate records DG0–DG7, and nothing is labelled a DG approval. The G1 decisions in the tests are demo decisions on **synthetic** data by synthetic users; they approve nothing real.

## 1. Changed files

### First change (module registry, skeletons, problem mapping)

| File | Purpose |
|---|---|
| `apps/api/src/modules.ts` | `methodology`, `evidence` exist now (`P2_MODULES`, `IMPLEMENTED_MODULES`); `workflows.dependsOn += kpi, evidence`; `evidence.dependsOn += transformations` (register kit). `transformations` does not depend on `workflows` (no cycle). |
| `apps/api/src/architecture.test.ts` | Module dirs = P1 + P2; P2 modules have their own suites; workflows→kpi/evidence edge and no back-edge asserted. |
| `apps/api/src/modules/platform/db-errors.ts` (new), `hooks.ts`, `index.ts`, `platform.test.ts` | Problem mapping of the P2 DB guards: `*_version_step` → 409 version-conflict; `gate_decision_not_submitter` → 403 `gate.submitter_cannot_decide`; `gate_decision_current_submission` → 409 `gate.submission_superseded`; template CHECK / NOT NULL → 422 with field pointer (column → camelCase); named business rules (workshop close, approver role, evidence verification, outcome cycle/depth, canvas ready, criterion CHECK) → 422; `*_audit_required`, `charter_version_required`, append-only (42501), identity/organization guards → 500; invalid dates (22007/22008) → 400. Unit-tested. |
| `apps/api/src/server.ts`, `apps/api/src/server.test.ts` | Composition root wires `methodology`, `evidence` and the access P2 routes; reports module registrations (workflows/methodology/evidence active, reporting still a route-free P5 scaffold). `server.test.ts` is not in the explicit file list but is server.ts's own unit test; its P1-scaffold assertion had to change with the composition. |

### Modules (API)

| File | Purpose |
|---|---|
| `access/records.ts` (new), `access/index.ts`, `access/assignments.ts` | ADR-0020 §3 record-level helpers: `requireRecordWrite` (write rules incl. `own` scope for `*.contribute` / `action.update_own`, through the policy function, denial audited), `requireTransformationRead`, `holds`, `actsOnBehalfOf` (one-hop delegation, no loops). `selectAssignment` exported for the team view. |
| `access/team.ts` (new) | `GET /role-accountabilities`, `GET/POST /transformations/{id}/scoped-assignments` (team.assign: only WL/KDS/TD/CM/SEC at this transformation, never self, never a role with an approval or assignment permission; canonical `scoped_assignment` rows; audited). |
| `transformations/register-kit.ts` (new) | The P2 register kit: list/create/get/update/archive with read gate (404) → write gate (403, **before** body parsing) → zod validation (400) → business checks (422) → If-Match/lock/version (428/409) → version+1 → one audit event; archived transformation/record read-only (422); Idempotency-Key on create. |
| `transformations/registers.ts` (new) | Strategic guardrails, outcomes, T01 diagnostic items (seeded rows not archivable; SAR amount/currency pair; H/M/L), findings (transitions), workstream outputs (record pair, target required, same-transformation refs), T03 gaps (missing dimension → 422 `/dimensionCode`; design decision must be a T04 of this transformation), capability heatmap, journeys (steps jsonb, cycle-time pair), pain points (step key must exist). |
| `transformations/charter.ts` (new) | Charter create/patch (version + immutable `charter_version` snapshot incl. linked North Star, top outcomes, guardrails + audit, one transaction), view with `warnings[]` (3–5 top outcomes) and scope-check pre-checks (missing data → `unknown`, never `pass`), version history; North Star get/put (supersede, never overwrite; If-Match rules from the contract) and history. |
| `transformations/phase.ts` (new) | `advancePhaseOnGateApproval`: the only phase-advance path (approved G1 → define, G2 → design, G3 → mobilize), audited. |
| `transformations/p2-routes.ts` (new), `routes.ts`, `index.ts` | Registration; `POST /transformations` now calls `p2_instantiate_transformation()` in its transaction (pin, 6 T01 rows, 10 canvas boxes, 6 gate instances, 23 audit events; both modes). |
| `methodology/{index,repository,routes,methodology.test}.ts` (new) | `GET /transformations/{id}/methodology` (pinned catalogue), `PATCH /methodology/tom-dimensions/{code}` (labels/Arabic only, If-Match, audited; `methodology.configure`). |
| `evidence/{index,repository,routes,store,evidence.test}.ts` (new) | Evidence register; filesystem EvidenceStore (atomic temp+fsync+rename, SHA-256 and size while streaming, key confinement; S3 driver fails closed, P6); upload (octet-stream, `X-File-Name`, new revision resets verification), download (parent authorization, `attachment`, `nosniff`, `no-store`); review (never the creator → 403; verified needs accessible content; filename never verifiable); links (edit rights on the target record, same transformation, duplicate → 409, remove with reason); `loadVerifiedEvidenceFacts` for the gate evaluators. |
| `workflows/{codes,decisions,design-registers,workshops,canvas,criteria,gates,index,workflows.test}.ts` | Record codes (`D-nn`, `GD-nn`, `DEP-nn` via `record_code_counter` UPSERT); T04 decisions (options A/B/C, owner-only `decide` or delegate, final once decided); dependencies, actions (update_own), TOM workshops + workshop mode (participants, items, conversion to decision/action in one transaction, close blocked while items open); TOM canvas read model + cell PATCH; the 16 G1–G3 criterion evaluators (pure, fail-closed); gate list/get (live evaluation), configure, submissions (re-evaluated and frozen in the submitting transaction, SHA-256 snapshot, pinned charter version, supersede via one CTE statement), decision (approver → submitter → staleness → rationale, canonical `decision` row kind gate, phase advance). |

### Shared mirrors and tests

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/{methodology,direction,charter,diagnose,design,evidence,decision,gate,team}.ts` (new), `index.ts` | zod mirrors of every BE component (requests strict as the contract; amounts via KBE's `moneyDecimal`/`decimal`, dates via KBE's `businessDate`, imported read-only from `kpi.ts`; cycle time fits numeric(14,4) without rounding). |
| `apps/api/test/support/p2-pending.ts` | Emptied (all 104 BE operations routed and exercised). |
| `apps/api/test/support/contract.ts`, `harness.ts` | Binary media (octet-stream) in the contract validator; private per-process evidence store dir for tests. |
| `apps/api/test/support/p2-fixtures.ts` (new) | Synthetic P2 world (TL creator with derived TL, SP, TO reviewer, WL, ADM_METHOD, AUD) and `makeG1Ready` through the API (incl. KBE's baseline/value-pool endpoints and VERIFIED evidence). |
| `apps/api/test/integration/contract/{contract.test.ts,p2-exercises.ts}` | All 104 BE operations exercised with a success + zod-mirror lockstep (98 mirrors added); stale If-Match 409 per register. |
| `apps/api/test/integration/{gates,evidence,registers,aud-write-deny}.test.ts` (new), `transformations.test.ts` | Behaviour suites (§2); the audit-trail test now expects the 23 starter-structure events. |

## 2. Behaviour delivered (per requirement)

- **REQ-S12-004 / REQ-PB-003 (P2 increment):** create instantiates the starter structure in the same transaction for End-to-End and Modular (registers.test "starter structure": 1/6/10/6 rows, 24 audit events for the request).
- **REQ-PB-026, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-S04-003, REQ-S16-013 (finding, evidence, outcome, guardrail):** T01 (confidence ∉ H/M/L → 400 `/confidence`; amount without currency → 422; seeded rows not archivable → 422), findings with transitions, workstream outputs, capability heatmap, journeys/pain points.
- **REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-S05-003:** methodology labels (source text immutable), T03 (missing dimension → 422 `/dimensionCode`; T04 link), canvas (10 boxes + linked gaps/decisions/dependencies/evidence; ready needs target+owner), workshop mode (close → 422 while unresolved; conversion one transaction, both audits), T04 log via `GET /decisions?kind=design`, `D-nn`, status open by default, owner-only decide.
- **REQ-PB-029/030/031/033/035/036(partial)/037:** charter versioning (create v1+snapshot; stale PATCH 409; v1 and v2 retrievable; snapshot append-only even for the owner role; invalid date 400), thesis and scope-check answers with pre-checks, North Star one sentence and history, 3–5 top-outcome warning, guardrails. **REQ-PB-036 good outcome test: not exposed** (see §4.1).
- **REQ-PB-016/017/018, REQ-S04-004/005, REQ-DLV-034, REQ-S13-012, REQ-S10-016:** G1 without charter → 422 `gate_criteria_incomplete` (nothing written); filename-only / inaccessible evidence → criterion incomplete with `unverifiedEvidenceIds`; non-approver → 403 `gate.not_approver`; submitter (even holding SP) → 403 `gate.submitter_cannot_decide`; decision on superseded submission → 409 `gate.submission_superseded`, `currentVersion` = current submission, nothing written; approved G1 → `currentPhase = define`, canonical `GD-01` decision row, full audit trail; approved gate cannot be resubmitted; G4–G6 → 422 `gate_not_enabled`. G1/G2 evaluators consume KBE's `loadKpiGateFacts` (merged in the tree), so **no kpi-dependent criterion is pending**.
- **REQ-S13-010/011/013, REQ-S16-006:** evidence repository, revisions, links, verification, download through the API.
- **REQ-PB-012, REQ-S10-008:** accountabilities (B0018 verbatim, `isSourceText`), team view with inherited assignments, non-approver team assignment.
- **REQ-S10-001 (AUD write-deny):** `aud-write-deny.test.ts` is generated from the contract: every P2 mutating operation (incl. KBE's) → 403 with only `authorization.denied` audited; the same AUD reads every P2 resource (200). Technical admins hold no P2 write or approval permission.
- **Conventions:** every mutation: policy check (single policy function), zod validation, If-Match/409 (DB guard also enforces +1), audit event (DB guard refuses a commit without it). Decimal strings for money; Unknown stays `null`.

## 3. Checks actually run

Environment: sandbox, offline, Linux; Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) unless stated; Node 22.22.2 (`/opt/node22/bin`); pnpm 10.33.0; PostgreSQL 16.13 disposable clusters via `tests/qa/support/with-pg.sh`.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | **exit 0** (all 7 projects `Done`) |
| `pnpm -r build` | **exit 0** (`apps/api build: Done`, `apps/worker build: Done`) |
| `pnpm lint` (`eslint . --max-warnings=0`) | **exit 0** |
| `pnpm format:check` | **exit 2, environment only**: `[error] EACCES: permission denied, open '/home/user/My-owns/.zshrc'` and `… 'CLAUDE.local.md'` (untracked sandbox files at the repo root that this sandbox cannot read; not project files). Same output also says `All matched files use Prettier code style!` |
| `npx prettier --check apps packages tests scripts docs/api` (every project directory) | **exit 0** — `All matched files use Prettier code style!` |
| `pnpm openapi:lint` | **exit 0** — `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 160 operations` (contract unchanged) |
| `pnpm test` (unit-node + unit-web) on Node 24.21.0 | **exit 0** — `Test Files 25 passed (25)`, `Tests 414 passed (414)` |
| `pnpm test` on Node 22.22.2 | **exit 0** — `Test Files 25 passed (25)`, `Tests 414 passed (414)` |
| `QA_PG_PORT=54917 tests/qa/support/with-pg.sh pnpm test:integration` (run 1) | **exit 0** — `qa disposable cluster: PostgreSQL 16.13 …`; `Test Files 26 passed (26)`, `Tests 409 passed (409)` |
| `QA_PG_PORT=54923 tests/qa/support/with-pg.sh pnpm test:integration` (run 2, fresh cluster) | **exit 0** — `Test Files 26 passed (26)`, `Tests 409 passed (409)`; incl. `contract.test.ts (11)`, `aud-write-deny.test.ts (127)`, `gates.test.ts (10)`, `registers.test.ts (15)`, `evidence.test.ts (6)`, `transformations.test.ts (30)`, KBE's `kpi-resources (23)` and `kpi-aud-write-deny (17)`, db `catalogue (9)`, `protection (17)`, worker `outbox (10)` |
| `node tools/gates/validate.mjs --historical --stage DG1` | **exit 0** — `PASS gate DG1 (historical)` |

Notes on the runs: the integration totals include KBE's suites as they were in the shared tree at that moment. Logs were kept in the run's `$TMPDIR` (removed with the run); the tails above are copied from them. I could not write under `docs/delivery/test-evidence/` (write guard), so the orchestrator should re-run the same commands for evidence.

## 4. Known gaps / not done (stated plainly)

1. **Contract change needed (architect): good outcome test and outcome activation.** The `Outcome` schema description promises `goodOutcomeTest` per outcome (REQ-PB-036), but `Outcome` is `additionalProperties: false` and has no such property; and neither `OutcomeCreate` nor `OutcomeUpdate` carries `status`, so outcomes stay `draft` forever (I treat every non-archived outcome as current). Request: add `goodOutcomeTest` (array of `{code, result: pass|fail|unknown}`) to `Outcome` and `status` (draft/active) to `OutcomeUpdate`.
2. **Outbox events `gate.submitted` / `gate.decided` are not emitted.** `OUTBOX_EVENT_SCHEMAS` lives in `packages/shared/src/schemas/events.ts`, which is not in my write scope, and `enqueueOutboxEvent` refuses unregistered events. Request: add both payload schemas to `events.ts` (orchestrator/architect); then BE adds one `enqueueOutboxEvent` call in `submitGate` / `decideGate` (notification routing is a later stage anyway, REQ-S12-009 gap in the work split).
3. **Evidence upload limit is a constant** (`EVIDENCE_MAX_BYTES` = 25 MiB in `evidence/store.ts`; DB ceiling 1 GiB) because `packages/config` is frozen. Request: a config key. ADR-0010 §5 MIME allow-list by magic bytes and the AV hook are **not** implemented (content is stored and served as `application/octet-stream`, attachment + nosniff); P6 per ADR-0010.
4. **Waiver / authorized exception path (REQ-S04-012/013)**: not modelled in 0010–0018 (work split §8 gap); submission is simply blocked while a mandatory criterion is incomplete. No 0019 migration written (none needed for the delivered scope).
5. **`dev-seed.ts` synthetic P2 demo data**: not added (optional in the assignment; P1 seed unchanged).
6. **`methodology.configure`** is checked as "held in the caller's own organization" because the TOM-dimension catalogue is global (not per organization) in 0011; an ADM_METHOD of one organization changes labels for all. Flag for the architect (per-organization labels would need a new table).
7. **Tool artifact:** the session harness creates `.claude/.cc-writes/` in whatever directory the shell `cd`s into; under `apps/api/src/modules/` this breaks the architecture test ("only mapped module directories"). This is the same "environmental stray directory" the architect's handback reported. I removed them before every test run; none remain in the tree.

## 5. Merge instructions

- **No new migration** (0010–0018 unchanged; no 0019). No dependency or lockfile change. OpenAPI unchanged (160 ops).
- Merge order per work split §6 is satisfied in the shared tree: my first change and KBE's kpi module coexist; `workflows` imports `loadKpiGateFacts` from `apps/api/src/modules/kpi/index.ts` (KBE's interface exactly as in work split §3).
- FE can integrate against the live API now; all BE zod mirrors are exported from `@mth/shared/schemas`.
- Expected conflicts: none by construction. Shared-tree touch points with KBE: `packages/shared/src/schemas/index.ts` (barrel, mine; `kpi.ts` export untouched), `contract.test.ts` (mine; calls KBE's `exerciseKpiOperations` unchanged).

## 6. Ownership statement

I edited only files in my scope (§1). I did **not** edit `docs/api/openapi.yaml`, `docs/architecture/**`, migrations 0010–0018, `packages/shared/src/{permissions,constants,problem,index}.ts`, root build config, dependencies, any `apps/web/**`, or any KBE file (`apps/api/src/modules/kpi/**`, `packages/shared/src/schemas/kpi.ts`, `packages/shared/src/value*.ts`, `test/integration/kpi/**`, `kpi-exercises.ts`, `p2-pending-kpi.ts`). A repo-wide prettier invocation listed some KBE files; their modification times (01:16–01:31 UTC) predate that run (01:47 UTC), i.e. prettier left them unchanged. The one file outside the explicit list that I changed is `apps/api/src/server.test.ts` (server.ts's own unit test), stated in §1.
