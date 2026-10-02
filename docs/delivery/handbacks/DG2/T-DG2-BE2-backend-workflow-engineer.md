# Handback T-DG2-BE2: wire the good outcome test (REQ-PB-036) and green the contract (backend-workflow-engineer)

- **Stage:** P2 / DG2 (BUILDING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** `HEAD` = `d22246b117516a7ee272b3f49ae8aba5eac7aef8` (contains `ecb3c0e`, the D-060 contract amendment). I verified it with `git rev-parse HEAD` before writing anything.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-BE2-backend-workflow-engineer-20261002T020418Z-55334bbe","session_id":"55334bbe-a8af-44e9-ae1e-f163d8ff6aa8"}`. Assignment `docs/delivery/assignments/DG2/T-DG2-BE2.md`; I checked its SHA-256 (`1073f0fb…7ddb5`) and it matches.
- **Starting state (reproduced):** `contract.test.ts` was red. It failed with `contract: createOutcome 201 body violates the schema: data must have required property 'goodOutcomeTest', data must have required property 'goodOutcomePass'`, which also caused the coverage test to fail with 79 operations unexercised. It is **green now** (§3).
- **Scope respected:** I did not touch `apps/web/**`, `apps/api/src/modules/kpi/**`, `schemas/kpi.ts`, `value.ts`, migrations `0010`–`0018` or `docs/api/openapi.yaml`. I added **no migration** because the test is computed and nothing is stored. **No new endpoint:** the fields were added to the existing outcome and charter responses.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/transformations/good-outcome.ts` (new) | Holds the good outcome test (B0051). `evaluateGoodOutcome` is a pure evaluator over the catalogue. `loadGoodOutcomeEvaluations` is a batch loader: it reads the pinned methodology's `good_outcome_criterion` rows, counts the active `outcome_kpi` rows and checks owner status. `loadGoodOutcomeFacts` serves G2. `activityLead` detects the wording "launch / implement / deliver". |
| `apps/api/src/modules/transformations/good-outcome.test.ts` (new) | 7 unit tests: pass; A01 "Launch new app" fails with reasons; activity wording overrides an attestation; unknown is never a pass; explicit negatives; fail-closed behaviour (unknown code, empty catalogue); the wording detector. |
| `apps/api/src/modules/transformations/register-kit.ts` | Adds `RegisterPresenter`, so a register gives either a pure `toApi` or an async batch `present(db, rows)`. All list, get, create, update and archive responses go through it. Create and update render inside the write transaction, so the response reflects the new state. Other registers are unchanged (`toApi`). |
| `apps/api/src/modules/transformations/registers.ts` | `toOutcome(row, evaluation)` now adds `goodOutcomeTest` and `goodOutcomePass`. New `presentOutcomes(db, rows)`. `outcomeRegister` uses `present: presentOutcomes`. |
| `apps/api/src/modules/transformations/charter.ts` | The charter view's `topOutcomes` now uses `presentOutcomes`, so they carry the computed fields the `Outcome` schema requires. |
| `apps/api/src/modules/transformations/index.ts` | Exports `presentOutcomes`, the good-outcome API and the new kit types. |
| `apps/api/src/modules/workflows/criteria.ts` | `GateFacts.outcomes` holds the good-outcome facts of every non-archived outcome. `g2.outcome_tree` lists each outcome that does not pass, as `g2.outcome_tree.good_outcome_test_not_passing` with pointer `/outcomes/{id}` and a message naming every failing or unknown criterion. |
| `apps/api/src/modules/workflows/workflows.test.ts` | Fixture gains `outcomes`. New unit test: G2 lists the failing outcome (id plus criteria) and does not list the passing one. |
| `apps/api/test/integration/registers.test.ts` | New describe block with 4 tests: A01 on create, get and list (auditor read), with no stored column and no audited field; the computed fields are not writable (400, nothing audited); pass after linking a KPI; update re-evaluates; a stale If-Match still returns 409; archiving the T02 row makes measurable fail again; the charter `topOutcomes` carry the fields; the REQ-PB-035 warning still applies; explicit negatives; auditor POST returns 403. |
| `apps/api/test/integration/gates.test.ts` | New describe block, one test: G2 lists the failing outcomes (a top outcome and a sub-outcome), not the passing one; zero guardrails gives `g2.guardrails.none`; submission returns 422 `gate_criteria_incomplete` naming `/criteria/g2.outcome_tree` and `/criteria/g2.guardrails`, with no audit written; a guardrail plus archiving the failing outcomes clears both. |
| `packages/shared/src/schemas/direction.ts` | Zod mirror: `goodOutcomeResult` (`GoodOutcomeResult`, `GOOD_OUTCOME_RESULTS`). `outcome` gains `goodOutcomeTest` and `goodOutcomePass`. Both are **not** in `outcomeCreate` or `outcomeUpdate`, which are strict objects, so a client sending them gets 400. |

## 2. Behaviour delivered

### REQ-PB-036 — met

"Apply the good outcome test to every outcome; G2 readiness lists failing outcomes."

**Computation.** The test is computed server-side for every `Outcome` response (list, get, create, update, archive, plus the charter's `topOutcomes`). It is never stored and never writable. It runs against the `good_outcome_criterion` catalogue of the transformation's **pinned** methodology version. If no version is pinned, the catalogue is empty, `goodOutcomeTest` is `[]` and `goodOutcomePass` is `false`.

**Criterion mapping.** This follows the catalogue's `evaluation` kind and the register's interpretation: "system checks measurable (KPI linked), owned (owner set) and flags statements that are only 'launch', 'implement' or 'deliver'".

| # | code | evaluation | pass | fail | unknown |
|---|---|---|---|---|---|
| 1 | `specific` | user_attested | `specificConfirmed = true` and the statement does not lead with an activity verb | The statement leads with launch / implement / deliver (inflections included), even when attested, or `specificConfirmed = false` | `specificConfirmed` not recorded |
| 2 | `measurable` | system_kpi_linked | ≥ 1 **active** `outcome_kpi` row | No active T02 row ("No KPI linked…") | — |
| 3 | `strategically_relevant` | user_attested | `strategicallyRelevantConfirmed = true` | `= false` | Not recorded |
| 4 | `owned_by_business_leader` | system_owner_set | Owner set and an active user of the organization | No owner, or the owner is not active | — |
| 5 | `causal_chain` | user_attested | `causalChain` recorded (non-blank) | — | Not recorded |

**Other rules.**
- Every result has a non-empty `reason` (at most 500 characters).
- A criterion code without an evaluator gives `unknown` (fail closed).
- `goodOutcomePass` is true only when the catalogue is non-empty and every criterion passes.

**Acceptance A01.** "Launch new app" with no KPI gives `specific` fail ("…not specific: it describes an activity ("launch")…"), `measurable` fail ("No KPI linked…"), `owned_by_business_leader` fail, `strategically_relevant` unknown, `causal_chain` unknown, and `goodOutcomePass: false`. Unit and integration tests both cover this.

**G2 readiness.** `g2.outcome_tree` lists **every non-archived outcome** (top or not) whose test does not pass, giving the pointer `/outcomes/{id}` and the criteria with their result. Example: `Outcome "Launch new app" does not pass the good outcome test: specific (fail), measurable (fail), strategically_relevant (unknown), owned_by_business_leader (fail), causal_chain (unknown).`

### REQ-PB-037 and REQ-PB-035 — still hold, now covered by integration tests

- **REQ-PB-037:** with zero active guardrails, G2 reports `g2.guardrails.none` and submission returns 422 with nothing written (new G2 integration test).
- **REQ-PB-035:** a charter with 1 top outcome returns the `charter.top_outcomes_count` warning (existing test plus the new outcome test). This is a warning, not a block.

### Conventions

- No new mutation was added.
- The existing outcome mutations keep their policy check, zod validation, If-Match/409 (re-asserted in the new test) and one audit event. The audit diff contains no computed field (asserted).
- Unknown is never shown as a pass.
- Nothing here relates to DG0–DG7. The G2 test data is synthetic and no gate is decided.

## 3. Checks actually run

**Environment:** sandbox, offline, Linux. Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) unless stated, and Node 22.22.2 (`/opt/node22/bin`). pnpm workspace. Disposable PostgreSQL 16.13 clusters via `tests/qa/support/with-pg.sh`. Logs were kept in the run's `$TMPDIR` (removed when the run ends); the tails below are copied from them.

| Command | Result |
|---|---|
| `QA_PG_PORT=55231 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract` (before any change) | **exit 1 (expected red):** `Tests 2 failed \| 9 passed (11)`; `contract: createOutcome 201 body violates the schema: data must have required property 'goodOutcomeTest', … 'goodOutcomePass'` |
| `pnpm -r typecheck` | **exit 0**: `apps/api typecheck: Done`, `apps/worker typecheck: Done`, all projects Done |
| `pnpm -r build` | **exit 0**: design-tokens, shared, config, web, db, worker and api `build: Done` |
| `pnpm lint` (`eslint . --max-warnings=0`) | **exit 0** |
| `pnpm format:check` | **exit 2, environment only.** Prettier cannot read the untracked sandbox files at the repository root: `[error] EACCES: permission denied, open '/home/user/My-owns/CLAUDE.local.md'`, plus the same for `.bashrc`, `.zshrc`, `.gitconfig`, `.mcp.json`, `.idea`, `.vscode` and others. The same output says `All matched files use Prettier code style!` |
| `npx prettier --check apps packages tests scripts docs/api` | **exit 0**: `All matched files use Prettier code style!` |
| `pnpm openapi:lint` | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 160 operations` (contract not edited by me) |
| `pnpm test` on Node 24.21.0 | **exit 0**: `Test Files 26 passed (26)`, `Tests 422 passed (422)` (includes `good-outcome.test.ts (7)` and `workflows.test.ts (13)`) |
| `pnpm test` on Node 22.22.2 | **exit 0**: `Test Files 26 passed (26)`, `Tests 422 passed (422)` |
| `QA_PG_PORT=55241 tests/qa/support/with-pg.sh pnpm test:integration` (run 1) | **exit 0**: `qa disposable cluster: PostgreSQL 16.13 …`; `Test Files 26 passed (26)`, `Tests 414 passed (414)`. Includes **`contract.test.ts (11)` green**, `gates.test.ts (11)`, `registers.test.ts (19)`, `aud-write-deny.test.ts (127)`, `transformations.test.ts (30)`, KBE's `kpi-resources (23)` and `kpi-aud-write-deny (17)` |
| `QA_PG_PORT=55247 tests/qa/support/with-pg.sh pnpm test:integration` (run 2, fresh cluster) | **exit 0**: `Test Files 26 passed (26)`, `Tests 414 passed (414)` |
| `node tools/gates/validate.mjs --historical --stage DG1` | **exit 0**: `PASS gate DG1 (historical)` |

Integration total moved from 409 to 414: +4 outcome tests in `registers.test.ts` and +1 G2 test in `gates.test.ts`. I could not write under `docs/delivery/test-evidence/` (write scope), so the orchestrator should re-run these commands for evidence.

## 4. Known gaps, interpretations and decisions for the orchestrator

1. **Interpretation: G2 blocks on non-passing outcomes.** I put the good-outcome list into the **mandatory** `g2.outcome_tree` criterion, so any non-archived outcome that does not pass (including `unknown`) makes G2 incomplete and blocks submission.
   - Basis: G2's own question, "Are outcomes specific enough to steer decisions?" (playbook table, B0023 row), and the assignment's "do not silently pass".
   - Side effect: the seeded criterion description in migration 0011 ("At least one top outcome … each with at least one T02 row") does not mention the good outcome test, so the description no longer fully states what the evaluator checks.
   - Options: re-word the description in a 0019+ catalogue migration (BE can write it if the architect or orchestrator agrees), or downgrade the list to non-blocking. The latter needs a contract change, because `GateCriterionEvaluation` has no warnings field.
   - It also applies to **sub-outcomes**, not only top outcomes, because REQ-PB-036 says "every outcome".
2. **Interpretation: which absences count as fail and which as unknown.**
   - Measurable and owned are system checks, so a missing KPI or owner is a definite **fail**. The register's acceptance text expects A01 to "fail with reasons".
   - The user-attested criteria are **unknown** until recorded.
   - The assignment's example of "time-bound needs a linked KPI target date" has **no catalogue criterion** (the seeded 5 are specific, measurable, strategically_relevant, owned_by_business_leader and causal_chain), so I followed the catalogue. `outcome_kpi.target_date` is NOT NULL, so every linked KPI is time-bound anyway.
3. **The activity-wording check is a heuristic.** It only flags a statement that **leads** with launch / implement / deliver (plus inflections, "implementation of", "delivery of"); for example, "Delivery time reduced…" is not flagged. The Arabic equivalents (إطلاق/اطلاق, تنفيذ, تسليم) are a **provisional** rendering that needs business-owner review.
4. **Cost.** Each outcome response costs a few extra queries (catalogue, a grouped `outcome_kpi` count and owner status). These are batched per page and per transformation, not per row, and that is acceptable at P2 volumes.
5. **Carried over from T-DG2-BE §4, unchanged by this task:**
   - Outcome `status` still has no write path (`OutcomeUpdate` has no `status`).
   - The `gate.submitted` / `gate.decided` outbox events are not emitted.
   - The evidence size limit is a constant.
   - No waiver path (REQ-S04-012/013).
   - No synthetic P2 seed.
   - `methodology.configure` labels are global.

## 5. Merge instructions

- **No migrations** to run; no ordering constraints.
- **Contract:** no OpenAPI change. The FE can rely on `Outcome.goodOutcomeTest[] {criterionCode, ordinal, result, reason}` and `goodOutcomePass` on every outcome body, including `CharterView.topOutcomes`. The zod mirror `goodOutcomeResult` and the type `GoodOutcomeResult` are exported from `@mth/shared/schemas`.
- **Possible conflicts:** none expected with FE (`apps/web/**`) or KBE paths. `RegisterSpec` is now a type alias (base interface `RegisterSpecBase` plus `RegisterPresenter`). Existing `toApi` registers compile unchanged, but a new register must give exactly one of `toApi` / `present`.
